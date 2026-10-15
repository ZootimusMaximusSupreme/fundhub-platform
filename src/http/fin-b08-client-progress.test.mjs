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

function fileTables({ pulls = [pull("p1", "2026-08-01T00:00:00Z", 640, 655, 648), pull("p2", "2026-09-30T00:00:00Z", 690, 700, 695)], items = [], waypoints = [waypoint()] } = {}) {
  const clients = [
    { id: CLIENT, org_id: ORG_ID, custom_fields: {} },
    { id: OTHER_CLIENT, org_id: ORG_ID, custom_fields: {} },
    { id: FOREIGN, org_id: OTHER_ORG_ID, custom_fields: {} },
  ];
  const fake = fakeDb([
    [/^\s*SELECT 1 FROM clients/i, (s, p) => rowsWhere(clients, s, p).map(() => ({ "?column?": 1 }))],
    // Rows come back in the order the statement's own ORDER BY names (pulls are stored oldest first).
    [/FROM crs_results/i, (s, p) => orderAndLimit(rowsWhere(pulls, s, p), s, p)],
    [/FROM dispute_items/i, (s, p) => {
      const rows = rowsWhere(items, s.slice(s.indexOf("FROM dispute_items")), p);
      return [{ disputed: rows.length, removed: rows.filter((r) => r.status === "deleted" || r.outcome === "deleted").length }];
    }],
    [/FROM client_waypoints/i, (s, p) => rowsWhere(waypoints, s, p)],
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
});
