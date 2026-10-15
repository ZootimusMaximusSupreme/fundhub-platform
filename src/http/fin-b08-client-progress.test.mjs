// finish-853 batch 08: GET /api/read/client-progress. The real handler runs the real reader
// (src/progress/read.mjs) over stand-in tables that answer by the client and company each
// statement names. The row's words: every fact the progress page draws (scores, checklist, next
// step), facts not copy. Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/client-progress.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { orderAndLimit } from "../testing/fin-b08-tables.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const FOREIGN = "c9000000-0000-4000-8000-000000000009";
const pull = (id, at, ex, eq, tu, over = {}) => ({
  id, client_id: CLIENT, org_id: ORG_ID, created_at: at,
  result: { scores: { ex, eq, tu }, scoreModels: { ex: "FICO", eq: "FICO", tu: "FICO" }, environment: "production" }, ...over,
});
const waypoint = (over = {}) => ({
  id: "w1", client_id: CLIENT, org_id: ORG_ID, key: "a", position: 1, title: "Upload your ID", owner_kind: "client",
  state: "not_started", due_at: null, completed_at: null, ...over,
});

/* The counts a statement asks for, read from its own text: `COUNT(*)[ FILTER ( WHERE a = 'x' OR b = 'x' )]::int AS name`
   over the rows its WHERE keeps. A select item this reader does not know throws. */
function countsOf(sql, rows) {
  const text = String(sql).replace(/\s+/g, " ");
  const select = /SELECT (.*?) FROM dispute_items/i.exec(text)[1];
  const out = {};
  for (const item of select.split(/,(?![^()]*\))/)) {
    const m = /^\s*COUNT\(\*\)(?: FILTER \( WHERE (.*?) \))?::int AS (\w+)\s*$/i.exec(item);
    if (!m) throw new Error(`the progress stand-in cannot read the select item: ${item}`);
    const terms = m[1] ? m[1].split(/\s+OR\s+/i).map((t) => {
      const e = /^(\w+)\s*=\s*'([^']*)'$/.exec(t.trim());
      if (!e) throw new Error(`the progress stand-in cannot read the filter term: ${t}`);
      return [e[1], e[2]];
    }) : null;
    out[m[2]] = rows.filter((r) => !terms || terms.some(([col, lit]) => r[col] === lit)).length;
  }
  return out;
}

function fileTables({ pulls = [pull("p1", "2026-08-01T00:00:00Z", 640, 655, 648), pull("p2", "2026-09-30T00:00:00Z", 690, 700, 695)], items = [], waypoints = [waypoint()], stage = null } = {}) {
  const clients = [
    { id: CLIENT, org_id: ORG_ID, custom_fields: {} },
    { id: OTHER_CLIENT, org_id: ORG_ID, custom_fields: {} },
    { id: FOREIGN, org_id: OTHER_ORG_ID, custom_fields: {} },
  ];
  const fake = fakeDb([
    [/^\s*SELECT 1 FROM clients/i, (s, p) => rowsWhere(clients, s, p).map(() => ({ "?column?": 1 }))],
    // The statement's own conditions, its demo filter and its ORDER BY decide what comes back.
    [/FROM crs_results/i, (s, p) => {
      let rows = rowsWhere(pulls, s, p);
      if (/\bis_demo IS NOT TRUE\b/i.test(s)) rows = rows.filter((r) => r.is_demo !== true);
      return orderAndLimit(rows, s, p);
    }],
    [/FROM dispute_items/i, (s, p) => [countsOf(s, rowsWhere(items, s.slice(s.indexOf("FROM dispute_items")), p))]],
    [/FROM client_waypoints/i, (s, p) => orderAndLimit(rowsWhere(waypoints, s, p), s, p)],
    [/^\s*SELECT ps\.key AS stage_key\s+FROM cards c/i, (s, p) => {
      const where = s.replace(/\s+/g, " ");
      if (!/WHERE c\.org_id = \$1::uuid AND c\.client_id = \$2::uuid/.test(where)) throw new Error("the progress stand-in cannot read the stage conditions");
      return stage && p[0] === stage.org_id && p[1] === stage.client_id ? [{ stage_key: stage.key }] : [];
    }],
    [/SELECT custom_fields FROM clients/i, (s, p) => rowsWhere(clients, s, p)],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  return fake;
}

async function call(query, files, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: files.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text)
      ? session.query(sql, params) : files.query(sql, params)),
    connect: () => files.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("GET", { query }), res));
  return { res, files };
}
const ownFile = (clientId = CLIENT) => accountSession({ kind: "client", clientId });

describe("GET /api/read/client-progress", () => {
  test("scores are the newest real number per bureau with its pull date, and movement runs from the first pull to the newest", async () => {
    const { res } = await call({ client_id: CLIENT }, fileTables());
    assert.equal(res.statusCode, 200);
    const byBureau = Object.fromEntries(res.body.scores.personal.map((p) => [p.bureau, p]));
    assert.equal(byBureau.experian.score, 690);
    assert.equal(byBureau.equifax.score, 700);
    assert.equal(byBureau.transunion.score, 695);
    assert.equal(byBureau.experian.pulledAt, "2026-09-30T00:00:00.000Z");
    assert.equal(res.body.movement.middleScoreNow, 695);
    assert.equal(res.body.movement.middleScoreBaseline, 648);
    assert.equal(res.body.movement.baselineAt, "2026-08-01T00:00:00.000Z");
    assert.deepEqual(res.body.movement.series.map((s) => s.experian), [640, 690]);
  });

  test("a bureau with no score is null, never 0, and a file with no pull has no movement", async () => {
    const partial = await call({ client_id: CLIENT }, fileTables({ pulls: [pull("p1", "2026-09-30T00:00:00Z", 690, null, null)] }));
    const byBureau = Object.fromEntries(partial.res.body.scores.personal.map((p) => [p.bureau, p.score]));
    assert.equal(byBureau.experian, 690);
    assert.equal(byBureau.equifax, null);
    assert.equal(byBureau.transunion, null);
    const none = await call({ client_id: CLIENT }, fileTables({ pulls: [] }));
    assert.deepEqual(none.res.body.scores.personal.map((p) => p.score), [null, null, null]);
    assert.equal(none.res.body.movement.middleScoreNow, null);
    assert.equal(none.res.body.movement.middleScoreBaseline, null);
    assert.deepEqual(none.res.body.movement.series, []);
  });

  test("another company's pull for the same client id is not shown", async () => {
    const files = fileTables({ pulls: [pull("p1", "2026-08-01T00:00:00Z", 640, 655, 648), pull("px", "2026-10-10T00:00:00Z", 800, 800, 800, { org_id: OTHER_ORG_ID })] });
    const { res } = await call({ client_id: CLIENT }, files);
    assert.equal(res.body.movement.middleScoreNow, 648);
  });

  test("items disputed and items removed are counted for this client only; a deleted status or a deleted outcome both count as removed", async () => {
    const mine = (over) => ({ client_id: CLIENT, org_id: ORG_ID, status: "open", outcome: null, ...over });
    const items = [
      mine({ status: "deleted" }), mine({ outcome: "deleted" }), mine({ status: "verified" }), mine(),
      { client_id: OTHER_CLIENT, org_id: ORG_ID, status: "deleted", outcome: "deleted" },
      { client_id: CLIENT, org_id: OTHER_ORG_ID, status: "deleted", outcome: "deleted" },
    ];
    const files = fileTables({ items });
    const { res } = await call({ client_id: CLIENT }, files);
    assert.equal(res.body.movement.itemsDisputed, 4);
    assert.equal(res.body.movement.itemsRemoved, 2);
    // The stand-in counts for itself, so the words of the count are pinned in the statement it was sent.
    const counted = files.calls.find((c) => /FROM dispute_items/.test(c.sql));
    assertSqlHas(counted.sql, {
      "removed means the status or the outcome says deleted": "COUNT(*) FILTER ( WHERE status = 'deleted' OR outcome = 'deleted' )::int AS removed",
      "this client and this company": "WHERE client_id = $1::uuid AND org_id = $2::uuid",
    });
  });

  test("the next step is the client's own open work first, even when Fundhub owes an earlier step", async () => {
    const files = fileTables({ waypoints: [
      waypoint({ id: "wf", key: "f", position: 1, title: "We review your file", owner_kind: "fundhub" }),
      waypoint({ id: "wc", key: "c", position: 2, title: "Upload your ID", owner_kind: "client" }),
      waypoint({ id: "wd", key: "d", position: 3, title: "Done step", owner_kind: "client", state: "done", completed_at: "2026-09-01T00:00:00Z" }),
      waypoint({ id: "wx", key: "x", position: 1, title: "Someone else's", client_id: OTHER_CLIENT }),
    ] });
    const { res } = await call({ client_id: CLIENT }, files);
    assert.deepEqual(res.body.nextStep, { waypointId: "wc", owner: "client" });
    assert.deepEqual(res.body.waypoints.map((w) => w.id), ["wf", "wc", "wd"], "only this client's steps");
    assert.equal(res.body.stage.waitingOn, "client");
    const noClientWork = await call({ client_id: CLIENT }, fileTables({ waypoints: [waypoint({ id: "wf", owner_kind: "fundhub" })] }));
    assert.deepEqual(noClientWork.res.body.nextStep, { waypointId: "wf", owner: "fundhub" });
    const nothing = await call({ client_id: CLIENT }, fileTables({ waypoints: [] }));
    assert.equal(nothing.res.body.nextStep, null);
  });

  test("a client sees their own file only: a client_id in the address is ignored", async () => {
    const files = fileTables({ pulls: [pull("p1", "2026-09-30T00:00:00Z", 690, 700, 695), pull("po", "2026-09-30T00:00:00Z", 500, 500, 500, { client_id: OTHER_CLIENT })] });
    const { res } = await call({ client_id: OTHER_CLIENT }, files, ownFile(CLIENT));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.movement.middleScoreNow, 695);
  });

  test("staff of another company get 404 for this client and nothing about the file is read", async () => {
    const files = fileTables();
    const { res } = await call({ client_id: FOREIGN }, files, [staffSession({ role: "owner", org_id: ORG_ID })]);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "client_not_found");
    assert.equal(files.calls.filter((c) => /FROM crs_results|FROM client_waypoints/.test(c.sql)).length, 0);
    const own = await call({ client_id: CLIENT }, fileTables(), [staffSession({ role: "owner", org_id: OTHER_ORG_ID })]);
    assert.equal(own.res.statusCode, 404, "a company-B owner cannot read company A's client");
  });

  test("staff must name a client; a bad id is 400; a partner staff role and no session are refused", async () => {
    assert.equal((await call({}, fileTables())).res.body.error, "client_id_required");
    assert.equal((await call({ client_id: "nope" }, fileTables())).res.body.error, "invalid_client_id");
    const partner = await call({ client_id: CLIENT }, fileTables(), [staffSession({ role: "partner" })]);
    assert.equal(partner.res.statusCode, 403);
    const none = await call({ client_id: CLIENT }, fileTables(), []);
    assert.equal(none.res.statusCode, 401);
    for (const role of STAFF_ROLES) {
      const ok = await call({ client_id: CLIENT }, fileTables(), [staffSession({ role })]);
      assert.equal(ok.res.statusCode, 200, role);
    }
  });

  const NOW_STAGE = (key) => ({ org_id: ORG_ID, client_id: CLIENT, key });
  test("a step is open while it is not started, in progress or blocked; done and skipped steps are never the next step", async () => {
    // Done and skipped steps come first on the list and are the client's: they must not be offered.
    const closed = await call({ client_id: CLIENT }, fileTables({ waypoints: [
      waypoint({ id: "w1", key: "a", position: 1, owner_kind: "client", state: "done", completed_at: "2026-09-01T00:00:00Z" }),
      waypoint({ id: "w2", key: "b", position: 2, owner_kind: "client", state: "skipped" }),
      waypoint({ id: "w3", key: "c", position: 3, owner_kind: "fundhub", state: "not_started" }),
    ] }));
    assert.deepEqual(closed.res.body.nextStep, { waypointId: "w3", owner: "fundhub" });
    // A blocked step is still the client's open work.
    const blocked = await call({ client_id: CLIENT }, fileTables({ waypoints: [
      waypoint({ id: "w1", key: "a", position: 1, owner_kind: "client", state: "blocked" }),
      waypoint({ id: "w2", key: "b", position: 2, owner_kind: "fundhub", state: "not_started" }),
    ] }));
    assert.deepEqual(blocked.res.body.nextStep, { waypointId: "w1", owner: "client" });
    // So is one already under way, even when Fundhub's own step is earlier.
    const underway = await call({ client_id: CLIENT }, fileTables({ waypoints: [
      waypoint({ id: "w1", key: "a", position: 1, owner_kind: "fundhub", state: "not_started" }),
      waypoint({ id: "w2", key: "b", position: 2, owner_kind: "client", state: "in_progress" }),
    ] }));
    assert.deepEqual(underway.res.body.nextStep, { waypointId: "w2", owner: "client" });
    assert.equal(underway.res.body.stage.waitingOn, "client");
  });

  test("the checklist comes back in plan order: by position, then by key, whatever order the rows were stored in", async () => {
    const files = fileTables({ waypoints: [
      waypoint({ id: "w9", key: "z", position: 3 }),
      waypoint({ id: "w2", key: "m", position: 1 }),
      waypoint({ id: "w1", key: "a", position: 1 }),
      waypoint({ id: "w5", key: "b", position: 2 }),
    ] });
    const { res } = await call({ client_id: CLIENT }, files);
    assert.deepEqual(res.body.waypoints.map((w) => w.id), ["w1", "w2", "w5", "w9"]);
    assert.deepEqual(res.body.waypoints.map((w) => w.order), [1, 1, 2, 3]);
    const read = files.calls.find((c) => /FROM client_waypoints/.test(c.sql));
    assertSqlHas(read.sql, { "this client and this company": "WHERE org_id = $1::uuid AND client_id = $2::uuid" });
  });

  test("items disputed counts every item on the file and items removed only the deleted ones, from the statement's own two counts", async () => {
    const mine = (over) => ({ client_id: CLIENT, org_id: ORG_ID, status: "open", outcome: null, ...over });
    const files = fileTables({ items: [
      mine({ status: "deleted" }), mine({ status: "verified", outcome: "deleted" }), mine({ status: "verified" }), mine({ status: "sent" }), mine({ status: "updated", outcome: "updated" }),
    ] });
    const { res } = await call({ client_id: CLIENT }, files);
    assert.equal(res.body.movement.itemsDisputed, 5, "every item, not only the open ones");
    assert.equal(res.body.movement.itemsRemoved, 2);
    const noItems = await call({ client_id: CLIENT }, fileTables({ items: [] }));
    assert.equal(noItems.res.body.movement.itemsDisputed, 0);
    assert.equal(noItems.res.body.movement.itemsRemoved, 0);
  });

  test("the middle score needs all three bureaus: two scores on file give no middle, and a demo pull is never counted", async () => {
    const two = await call({ client_id: CLIENT }, fileTables({ pulls: [pull("p1", "2026-09-30T00:00:00Z", 690, 700, null)] }));
    assert.equal(two.res.body.movement.middleScoreNow, null, "two numbers have a higher and a lower, not a middle");
    assert.equal(two.res.body.movement.middleScoreBaseline, null);
    assert.equal(two.res.body.movement.series.length, 1, "the pull still makes a point on the chart");
    const demo = await call({ client_id: CLIENT }, fileTables({ pulls: [
      pull("p1", "2026-08-01T00:00:00Z", 640, 655, 648),
      pull("pd", "2026-10-10T00:00:00Z", 850, 850, 850, { is_demo: true }),
    ] }));
    assert.equal(demo.res.body.movement.middleScoreNow, 648, "a demo pull is not this client's score");
    assert.equal(demo.res.body.movement.series.length, 1);
    assert.deepEqual(demo.res.body.scores.personal.map((s) => s.score), [640, 655, 648]);
  });

  test("a pull whose scores were erased leaves no point on the chart and cannot be the baseline", async () => {
    const files = fileTables({ pulls: [
      pull("p0", "2026-07-01T00:00:00Z", 0, 0, 0, { result: {} }),
      pull("p0b", "2026-07-15T00:00:00Z", 0, 0, 0, { result: null }),
      pull("p1", "2026-08-01T00:00:00Z", 640, 655, 648),
      pull("p2", "2026-09-30T00:00:00Z", 690, 700, 695),
    ] });
    const { res } = await call({ client_id: CLIENT }, files);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.movement.series.map((p) => p.at), ["2026-08-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z"]);
    assert.equal(res.body.movement.baselineAt, "2026-08-01T00:00:00.000Z");
    assert.equal(res.body.movement.middleScoreBaseline, 648);
  });

  test("while the letters are out the file is waiting on the bureaus, whatever is on the client's checklist", async () => {
    const open = [waypoint({ id: "wc", key: "c", position: 1, owner_kind: "client", state: "not_started" })];
    for (const key of ["in_transit", "awaiting_response"]) {
      const { res } = await call({ client_id: CLIENT }, fileTables({ waypoints: open, stage: NOW_STAGE(key) }));
      assert.equal(res.body.stage.key, key);
      assert.equal(res.body.stage.waitingOn, "bureaus", key);
      assert.deepEqual(res.body.nextStep, { waypointId: "wc", owner: "client" }, "the step is still named");
    }
    const analysis = await call({ client_id: CLIENT }, fileTables({ waypoints: open, stage: NOW_STAGE("analysis") }));
    assert.equal(analysis.res.body.stage.waitingOn, "client");
    const fundhub = await call({ client_id: CLIENT }, fileTables({ waypoints: [waypoint({ id: "wf", owner_kind: "fundhub" })], stage: NOW_STAGE("analysis") }));
    assert.equal(fundhub.res.body.stage.waitingOn, "fundhub");
    const nobody = await call({ client_id: CLIENT }, fileTables({ waypoints: [], stage: null }));
    assert.equal(nobody.res.body.stage.waitingOn, null, "no stage and no open step: nobody is guessed");
  });
});
