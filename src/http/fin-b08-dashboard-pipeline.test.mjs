// finish-853 batch 08: GET /api/dashboard/pipeline. The real handler runs over a stand-in database.
// The stand-in cannot run the board's joined statement (that is proved on a scratch Postgres in
// pipeline.pg.test.mjs), so it hands back the rows that statement returns and the test judges what
// the handler does with them: stages in order, each card under its own stage, the column money
// (a sum of known amounts, unknown not 0, an empty column a real 0), the company from the session
// only, and it pins the clauses of the statement that carry the company, the demo filter, the
// last-message-inbound facts and the newest-round-only funding flag. The stages are kept in a scrambled
// order and the stand-in hands them back in the order the statement's own ORDER BY names, so a board
// whose stage statement lost or changed that clause comes back out of order. The second half of this
// file hands the board's OWN statements to a real SQL engine over in-memory tables (see
// ../testing/fin-b08-sqlite-board.mjs), so a clause that is dropped or pointed at the wrong column
// changes the rows that come back. Practice test, fake data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { stageAmount } from "../../api/dashboard/pipeline.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { assertSqlHas, bindProblem } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { sqliteBoard } from "../testing/fin-b08-sqlite-board.mjs";

const STAGE_NEW = "a1000000-0000-4000-8000-000000000001";
const STAGE_CALL = "a2000000-0000-4000-8000-000000000002";
const STAGE_WON = "a3000000-0000-4000-8000-000000000003";
const stage = (id, key, name, sort_order) => ({ id, key, name, sort_order });
// Kept out of order on purpose: the order the board shows comes from the statement's ORDER BY, not from here.
const STAGES = [stage(STAGE_WON, "closed_won", "Closed Won", 3), stage(STAGE_NEW, "new_lead", "New Lead", 1), stage(STAGE_CALL, "booked_call", "Booked Call", 2)];

/** Rows in the order the statement's own ORDER BY terms name (column, ASC or DESC). No ORDER BY keeps the stored order. */
function orderedBy(rows, sql) {
  const m = /ORDER BY\s+([^\n]+?)\s*$/i.exec(String(sql).trim());
  if (!m) return [...rows];
  const terms = m[1].split(",").map((t) => t.trim().split(/\s+/)).map(([col, dir]) => ({ col: col.replace(/^\w+\./, ""), desc: /^desc$/i.test(dir || "") }));
  return [...rows].sort((a, b) => {
    for (const { col, desc } of terms) {
      const x = a[col];
      const y = b[col];
      if (x === y) continue;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return desc ? -c : c;
    }
    return 0;
  });
}
const card = (over) => ({
  id: "c-1", stage_id: STAGE_NEW, owner: "closer-1", entered_at: "2026-10-10T10:00:00Z", client_id: "k-1", first_name: "Dana", last_name: "Whitfield",
  email: "dana@example.test", phone: "+16025550100", outcome_tier: null, funded: false, funded_amount: null, is_demo: false,
  total_funding_estimate: null, survey_fico_raw: null, survey_fico_label: null, partner_name: null, partner_email: null,
  sms_needs_reply: false, email_needs_reply: false, approval_amount_missing: false, ...over,
});

function boardDb({ stages = STAGES, cards = [], demoMode = false } = {}) {
  const fake = fakeDb([
    [/FROM pipeline_stages s\s+JOIN pipelines p/i, (sql, p) => (p[1] === ORG_ID ? orderedBy(stages, sql) : [])],
    [/SELECT demo_mode_enabled FROM orgs WHERE id = \$1/i, [{ demo_mode_enabled: demoMode }]],
    [/FROM cards cd\s+JOIN pipelines p/i, (_s, p) => (p[1] === ORG_ID ? cards : [])],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    // The board's statement carries /* ... */ notes with apostrophes; Postgres drops them before it binds.
    const problem = bindProblem(text.replace(/\/\*[\s\S]*?\*\//g, " "), args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  return fake;
}
async function call(query, fake, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("GET", { query }), res));
  return { res, fake };
}
const col = (res, key) => res.body.stages.find((s) => s.key === key);

describe("GET /api/dashboard/pipeline", () => {
  test("the board is the pipeline's stages in order, each card under the stage its row says, and a stage with no cards is still a column", async () => {
    const fake = boardDb({ cards: [
      card({ id: "c-1", stage_id: STAGE_NEW }),
      card({ id: "c-2", stage_id: STAGE_CALL, client_id: "k-2", first_name: "Pat", last_name: "Lee" }),
      card({ id: "c-3", stage_id: STAGE_NEW, client_id: "k-3", first_name: "Sam", last_name: null }),
      card({ id: "c-x", stage_id: "ffffffff-0000-4000-8000-000000000000", client_id: "k-9" }),
    ] });
    const { res } = await call({ key: "sales" }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.pipeline, "sales");
    assert.deepEqual(res.body.stages.map((s) => [s.key, s.count]), [["new_lead", 2], ["booked_call", 1], ["closed_won", 0]]);
    assert.deepEqual(col(res, "new_lead").cards.map((c) => c.id), ["c-1", "c-3"]);
    assert.equal(col(res, "booked_call").cards[0].name, "Pat Lee");
    assert.equal(res.body.total, 4, "the total counts the rows read; a card with no such stage is dropped, never re-homed");
    assert.equal(JSON.stringify(res.body.stages).includes("c-x"), false);
  });

  test("a card's money is the funded amount, else the funding estimate, else unknown; a column sums the known ones", async () => {
    const fake = boardDb({ cards: [
      card({ id: "c-1", stage_id: STAGE_NEW, funded_amount: "50000", total_funding_estimate: "99999" }),
      card({ id: "c-2", stage_id: STAGE_NEW, client_id: "k-2", total_funding_estimate: "25000" }),
      card({ id: "c-3", stage_id: STAGE_NEW, client_id: "k-3" }),
      card({ id: "c-4", stage_id: STAGE_CALL, client_id: "k-4" }),
    ] });
    const { res } = await call({}, fake);
    assert.deepEqual(col(res, "new_lead").cards.map((c) => c.amount), [50000, 25000, null]);
    assert.equal(col(res, "new_lead").amount, 75000);
    assert.equal(col(res, "new_lead").amount_known, 2);
    assert.equal(col(res, "booked_call").amount, null, "cards with no known amount make an unknown column, not $0");
    assert.equal(col(res, "closed_won").amount, 0, "an empty column is a real zero");
    assert.equal(stageAmount([]), 0);
    assert.equal(stageAmount([{ amount: null }]), null);
  });

  test("the card shows who it is, the unread-message and missing-amount flags, the owner and the survey credit band as the database holds them", async () => {
    const fake = boardDb({ cards: [
      card({ id: "c-1", sms_needs_reply: true, approval_amount_missing: true, owner: "closer-9", outcome_tier: "FULL_FUNDING", funded: true, survey_fico_label: "700-749" }),
      card({ id: "c-2", client_id: "k-2", first_name: null, last_name: null, email: null, partner_name: "Acme Partner", partner_email: "ops@acme.example.test", email_needs_reply: true, is_demo: true }),
    ] });
    const { res } = await call({}, fake);
    const [a, b] = col(res, "new_lead").cards;
    assert.equal(a.sms_needs_reply, true);
    assert.equal(a.email_needs_reply, false);
    assert.equal(a.approval_amount_missing, true);
    assert.equal(a.owner, "closer-9");
    assert.equal(a.funded, true);
    assert.equal(a.outcome_tier, "FULL_FUNDING");
    assert.equal(a.survey_fico, "700-749");
    assert.equal(b.name, "DEMO · Acme Partner", "a partner card with no person falls back to the partner, and a demo row says so");
    assert.equal(b.email, "ops@acme.example.test");
    assert.equal(b.email_needs_reply, true);
    assert.equal(b.is_demo, true);
  });

  test("the company comes from the session only, and the demo switch is the company's own", async () => {
    const fake = boardDb({ cards: [card({})], demoMode: true });
    const { res } = await call({ key: "sales", org_id: OTHER_ORG_ID, limit: "50" }, fake);
    assert.equal(res.statusCode, 200);
    const cardsCall = fake.calls.find((c) => /FROM cards cd/.test(c.sql));
    assert.deepEqual(cardsCall.params, ["sales", ORG_ID, 50, true], "key, the session's company, the limit and Demo Mode");
    const stagesCall = fake.calls.find((c) => /FROM pipeline_stages/.test(c.sql));
    assert.deepEqual(stagesCall.params, ["sales", ORG_ID]);
    const off = boardDb({ cards: [card({})], demoMode: false });
    await call({ key: "sales" }, off);
    assert.equal(off.calls.find((c) => /FROM cards cd/.test(c.sql)).params[3], false, "Demo Mode off asks for no demo rows");
    const wide = boardDb({ cards: [] });
    await call({ limit: "999999" }, wide);
    assert.equal(wide.calls.find((c) => /FROM cards cd/.test(c.sql)).params[2], 2000, "the limit is capped");
    const none = boardDb({ cards: [] });
    await call({}, none);
    assert.equal(none.calls.find((c) => /FROM pipeline_stages/.test(c.sql)).params[0], "sales", "no key reads the sales board");
  });

  test("the statement keeps this company's cards only and carries the rules the board's facts rest on", async () => {
    const fake = boardDb({ cards: [card({})] });
    await call({}, fake);
    const stagesSql = fake.calls.find((c) => /FROM pipeline_stages/.test(c.sql)).sql;
    assertSqlHas(stagesSql, {
      "this pipeline of this company only": "WHERE p.key = $1 AND p.org_id = $2",
      "stages in their set order, then by name": "ORDER BY s.sort_order ASC, s.name ASC",
    });
    const sql = fake.calls.find((c) => /FROM cards cd/.test(c.sql)).sql;
    assertSqlHas(sql, {
      "the pipeline and the company, on the pipeline and on the card": "WHERE p.key = $1 AND p.org_id = $2 AND cd.org_id = $2",
      "the client is joined inside the same company": "LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id",
      "demo rows only when Demo Mode is on": "AND ($4::boolean OR COALESCE(c.is_demo, false) = false)",
      "archived clients are off the board": "AND (c.custom_fields->>'crm_archived_at' IS NULL)",
      "newest cards first, bounded": "ORDER BY cd.entered_at DESC LIMIT $3",
      "a text needs a reply when the last message is inbound": "AND conv.channel IN ('sms', 'text') AND last.direction = 'inbound'",
      "an email needs a reply when the last message is inbound": "AND conv.channel = 'email' AND last.direction = 'inbound'",
      "the last message of a conversation is the newest one": "ORDER BY m.created_at DESC, m.id DESC LIMIT 1",
      "the amount flag is on the funding rails only": "p.key IN ('funding_card_stacking', 'funding_altfin')",
      "an approval with no amount, not excluded": "status = 'Approved' AND a.approval_excluded_at IS NULL AND (a.approved_amount IS NULL OR a.approved_amount <= 0)",
      "the newest funding round only": "ORDER BY fr.round_number DESC, fr.created_at DESC LIMIT 1",
    });
    // The text flag and the email flag each read their own conversation's newest message: two places, both pinned.
    const newestMessage = "ORDER BY m.created_at DESC, m.id DESC LIMIT 1";
    assert.equal(sql.replace(/\s+/g, " ").split(newestMessage).length - 1, 2, "text and email each judge the newest message");
  });

  test("an unknown pipeline key is 404 and the cards are never read", async () => {
    const fake = boardDb({ stages: [] });
    const { res } = await call({ key: "nope" }, fake);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "unknown_pipeline");
    assert.equal(fake.calls.filter((c) => /FROM cards cd/.test(c.sql)).length, 0);
  });

  test("every staff role may read; a partner staff row, a client login and no login are refused; only GET is served", async () => {
    for (const role of STAFF_ROLES) {
      const { res } = await call({}, boardDb({ cards: [] }), [staffSession({ role })]);
      assert.equal(res.statusCode, 200, role);
    }
    const partner = await call({}, boardDb(), [staffSession({ role: "partner" })]);
    assert.equal(partner.res.statusCode, 403);
    const client = await call({}, boardDb(), accountSession({ kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }));
    assert.equal(client.res.statusCode, 401);
    const none = await call({}, boardDb(), []);
    assert.equal(none.res.statusCode, 401);
    const noOrg = await call({}, boardDb(), [staffSession({ role: "closer", org_id: null })]);
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(noOrg.res.body.error, "no_org_on_session");
    const res = makeRes();
    const fake = boardDb();
    await runWithSharedDb(fake, () => handler(req("POST", { body: {} }), res));
    assert.equal(res.statusCode, 405);
  });

  test("it only reads: every statement is a SELECT", async () => {
    const fake = boardDb({ cards: [card({})] });
    await call({}, fake);
    for (const c of fake.calls) {
      if (/FROM live JOIN staff|WITH live AS/.test(c.sql)) continue;
      assert.match(c.sql.trim(), /^SELECT\b/i, c.sql.slice(0, 50));
    }
  });
});

/* ── THE BOARD'S OWN SQL, RUN BY A SQL ENGINE ─────────────────────────────────────────────────────
   Company A has a sales board and a funding board. Company B has its own "sales" board with the SAME
   key. Every row below is placed so that one dropped condition in the board's statements puts a wrong
   row on the board, or takes a right one off it. */
const A = ORG_ID;
const B = OTHER_ORG_ID;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P_SALES_A = id(101);
const P_FUND_A = id(102);
const P_SALES_B = id(103);
const S_NEW = id(201);
const S_CALL = id(202);
const S_WON = id(203);
const S_FUND = id(204);
const S_B = id(205);
const K = { ann: id(301), ben: id(302), cal: id(303), dan: id(304), eve: id(305), demo: id(306), arch: id(307), foreign: id(308), frank: id(309), gina: id(310) };
const PARTNER_A = id(401);
const PARTNER_B = id(402);

function engineBoard({ demoMode = false } = {}) {
  const e = sqliteBoard();
  e.insert("orgs", { id: A, demo_mode_enabled: demoMode });
  e.insert("orgs", { id: B, demo_mode_enabled: false });
  e.insert("pipelines", { id: P_SALES_A, org_id: A, key: "sales", name: "Sales" });
  e.insert("pipelines", { id: P_FUND_A, org_id: A, key: "funding_card_stacking", name: "Card stacking" });
  e.insert("pipelines", { id: P_SALES_B, org_id: B, key: "sales", name: "Sales" });
  // Stored out of order on purpose: only the statement's ORDER BY puts the columns right.
  e.insert("pipeline_stages", { id: S_WON, pipeline_id: P_SALES_A, org_id: A, key: "closed_won", name: "Closed Won", sort_order: 3 });
  e.insert("pipeline_stages", { id: S_NEW, pipeline_id: P_SALES_A, org_id: A, key: "new_lead", name: "New Lead", sort_order: 1 });
  e.insert("pipeline_stages", { id: S_CALL, pipeline_id: P_SALES_A, org_id: A, key: "booked_call", name: "Booked Call", sort_order: 2 });
  e.insert("pipeline_stages", { id: S_FUND, pipeline_id: P_FUND_A, org_id: A, key: "approvals", name: "Approvals", sort_order: 1 });
  e.insert("pipeline_stages", { id: S_B, pipeline_id: P_SALES_B, org_id: B, key: "their_only", name: "Their Only", sort_order: 1 });

  const client = (key, over) => e.insert("clients", { id: K[key], org_id: A, funded: false, is_demo: false, custom_fields: {}, ...over });
  client("ann", { first_name: "Ann", last_name: "Rivers", email: "ann@example.test", phone: "+16025550101", outcome_tier: "FULL_FUNDING", funded: true, funded_amount: 50000, custom_fields: { total_funding_estimate: 99999 } });
  client("ben", { first_name: "Ben", last_name: "Okafor", email: "ben@example.test", custom_fields: { total_funding_estimate: 25000, cf_svy_self_reported_fico_label: "700-749" } });
  client("cal", { first_name: "Cal", last_name: "Mora", email: "cal@example.test" });
  client("dan", { first_name: "Dan", last_name: "Price", email: "dan@example.test" });
  client("eve", { first_name: "Eve", last_name: "Stone", email: "eve@example.test" });
  client("demo", { first_name: "Demo", last_name: "Person", email: "demo@example.test", is_demo: true });
  client("arch", { first_name: "Archie", last_name: "Gone", email: "arch@example.test", custom_fields: { crm_archived_at: "2026-10-01T00:00:00Z" } });
  client("frank", { first_name: "Frank", last_name: "Lund", email: "frank@example.test" });
  client("gina", { first_name: "Gina", last_name: "Hale", email: "gina@example.test" });
  e.insert("clients", { id: K.foreign, org_id: B, first_name: "Fiona", last_name: "Other", email: "fiona@example.test", funded: false, is_demo: false, custom_fields: {} });
  e.insert("partners", { id: PARTNER_A, org_id: A, name: "Acme Partner", contact_email: "ops@acme.example.test" });
  e.insert("partners", { id: PARTNER_B, org_id: B, name: "Their Partner", contact_email: "ops@their.example.test" });

  const card = (cid, over) => e.insert("cards", { id: cid, org_id: A, client_id: null, partner_id: null, pipeline_id: P_SALES_A, stage_id: S_NEW, owner: null, entered_at: "2026-10-01T00:00:00Z", ...over });
  card("card-ann", { client_id: K.ann, stage_id: S_NEW, owner: "closer-1", entered_at: "2026-10-12T00:00:00Z" });
  card("card-cal", { client_id: K.cal, stage_id: S_NEW, entered_at: "2026-10-11T00:00:00Z" });
  card("card-ben", { client_id: K.ben, stage_id: S_CALL, entered_at: "2026-10-13T00:00:00Z" });
  card("card-dan", { client_id: K.dan, stage_id: S_CALL, entered_at: "2026-10-09T00:00:00Z" });
  card("card-eve", { client_id: K.eve, stage_id: S_WON, entered_at: "2026-10-08T00:00:00Z" });
  card("card-demo", { client_id: K.demo, stage_id: S_NEW, entered_at: "2026-10-07T00:00:00Z" });
  card("card-arch", { client_id: K.arch, stage_id: S_NEW, entered_at: "2026-10-06T00:00:00Z" });
  card("card-orphan", { stage_id: S_NEW, entered_at: "2026-10-05T00:00:00Z" });
  card("card-foreign-client", { client_id: K.foreign, stage_id: S_NEW, entered_at: "2026-10-04T00:00:00Z" });
  card("card-partner", { partner_id: PARTNER_A, stage_id: S_CALL, entered_at: "2026-10-03T00:00:00Z" });
  card("card-foreign-partner", { partner_id: PARTNER_B, stage_id: S_CALL, entered_at: "2026-10-02T00:00:00Z" });
  card("card-wrong-org", { org_id: B, client_id: K.gina, stage_id: S_NEW, entered_at: "2026-10-10T00:00:00Z" });
  // A card that claims this company but sits on the OTHER company's pipeline, with that company's client.
  card("card-a-on-b", { client_id: K.foreign, pipeline_id: P_SALES_B, stage_id: S_NEW, entered_at: "2026-10-14T00:00:00Z" });
  e.insert("cards", { id: "card-b-only", org_id: B, client_id: K.foreign, partner_id: null, pipeline_id: P_SALES_B, stage_id: S_B, owner: null, entered_at: "2026-10-12T00:00:00Z" });
  // The same people also sit on the funding board.
  for (const [cid, who] of [["f-ann", "ann"], ["f-ben", "ben"], ["f-cal", "cal"], ["f-dan", "dan"], ["f-eve", "eve"], ["f-frank", "frank"]]) {
    e.insert("cards", { id: cid, org_id: A, client_id: K[who], partner_id: null, pipeline_id: P_FUND_A, stage_id: S_FUND, owner: null, entered_at: "2026-10-10T00:00:00Z" });
  }

  const conv = (cid, org, who, channel, msgs) => {
    e.insert("conversations", { id: cid, org_id: org, client_id: K[who], channel });
    msgs.forEach(([dir, at], i) => e.insert("messages", { id: `${cid}-m${i}`, conversation_id: cid, direction: dir, created_at: at }));
  };
  // Ann: the text thread ends with her message; the email thread ends with ours.
  conv("c-ann-sms", A, "ann", "sms", [["outbound", "2026-10-12T10:00:00Z"], ["inbound", "2026-10-12T11:00:00Z"]]);
  conv("c-ann-mail", A, "ann", "email", [["inbound", "2026-10-12T09:00:00Z"], ["outbound", "2026-10-12T10:00:00Z"]]);
  // Ben: the email thread ends with his message. A newer message in a DIFFERENT thread must not count.
  conv("c-ben-mail", A, "ben", "email", [["outbound", "2026-10-13T08:00:00Z"], ["inbound", "2026-10-13T09:00:00Z"]]);
  conv("c-ben-sms", A, "ben", "sms", [["inbound", "2026-10-13T07:00:00Z"], ["outbound", "2026-10-13T08:30:00Z"]]);
  // Cal: a thread whose channel is called "text".
  conv("c-cal-text", A, "cal", "text", [["inbound", "2026-10-11T12:00:00Z"]]);
  // Eve has threads, but in the OTHER company: they are not hers on this board.
  conv("c-eve-sms-b", B, "eve", "sms", [["inbound", "2026-10-08T12:00:00Z"]]);
  conv("c-eve-mail-b", B, "eve", "email", [["inbound", "2026-10-08T12:30:00Z"]]);

  const round = (rid, org, who, n, at) => e.insert("funding_rounds", { id: rid, org_id: org, client_id: K[who], round_number: n, created_at: at });
  const app = (aid, org, who, rid, over) => e.insert("applications", { id: aid, org_id: org, client_id: K[who], funding_round_id: rid, status: "Approved", approval_excluded_at: null, approved_amount: null, ...over });
  // Ann: round 1 holds a bank yes with no amount. Another client's higher round number, and her own round
  // in the other company, must not become "the newest round".
  round("r-ann", A, "ann", 1, "2026-09-01T00:00:00Z");
  app("a-ann", A, "ann", "r-ann", {});
  round("r-frank", A, "frank", 3, "2026-09-20T00:00:00Z");
  round("r-ann-b", B, "ann", 9, "2026-09-25T00:00:00Z");
  // Ben: his only approval has an amount. Ann's approval filed against Ben's round is not Ben's.
  round("r-ben", A, "ben", 1, "2026-09-02T00:00:00Z");
  app("a-ben", A, "ben", "r-ben", { approved_amount: 15000 });
  app("a-misfiled", A, "ann", "r-ben", {});
  // Cal: the bank yes was marked as not counting, and a second one was declined.
  round("r-cal", A, "cal", 1, "2026-09-03T00:00:00Z");
  app("a-cal-ex", A, "cal", "r-cal", { approval_excluded_at: "2026-10-01T00:00:00Z" });
  app("a-cal-no", A, "cal", "r-cal", { status: "Declined" });
  // Dan: round 1 had a blank amount; round 2 is the one anybody is working and it is clean.
  round("r-dan-1", A, "dan", 1, "2026-08-01T00:00:00Z");
  app("a-dan-1", A, "dan", "r-dan-1", {});
  round("r-dan-2", A, "dan", 2, "2026-09-10T00:00:00Z");
  app("a-dan-2", A, "dan", "r-dan-2", { approved_amount: 9000 });
  // Eve: the only unpriced yes on her round belongs to the other company.
  round("r-eve", A, "eve", 1, "2026-09-04T00:00:00Z");
  app("a-eve-b", B, "eve", "r-eve", {});
  // Frank: a zero amount is as unpriced as a blank one.
  app("a-frank", A, "frank", "r-frank", { approved_amount: 0 });
  return e;
}

async function callEngine(query, e, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: e.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : e.query(sql, params)),
    connect: () => e.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("GET", { query }), res));
  return res;
}
const cardsOf = (res) => res.body.stages.flatMap((s) => s.cards.map((c) => ({ ...c, stage: s.key })));
const byId = (res) => Object.fromEntries(cardsOf(res).map((c) => [c.id, c]));

describe("GET /api/dashboard/pipeline, the board's own statements run by a SQL engine", () => {
  test("Sales cards use their own next active booking and fall back to the latest past one", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const next = new Date(Date.now() + 86_400_000).toISOString();
    const later = new Date(Date.now() + 172_800_000).toISOString();
    const e = engineBoard();
    for (const row of [
      { id: "past", org_id: A, client_id: K.ann, starts_at: past, status: "booked" },
      { id: "next", org_id: A, client_id: K.ann, starts_at: next, status: "rescheduled" },
      { id: "cancelled", org_id: A, client_id: K.ann, starts_at: later, status: "cancelled" },
      { id: "foreign", org_id: B, client_id: K.ann, starts_at: later, status: "booked" },
    ]) e.insert("bookings", { ...row, created_at: row.starts_at });
    const nextCard = byId(await callEngine({ key: "sales" }, e))["card-ann"];
    assert.equal(nextCard.booked_starts_at, next);
    assert.equal(nextCard.booked_kind, "rescheduled");
    const funding = byId(await callEngine({ key: "funding_card_stacking" }, e))["f-ann"];
    assert.equal(funding.booked_starts_at, null);
    assert.equal(funding.booked_kind, null);

    const pastOnly = engineBoard();
    pastOnly.insert("bookings", { id: "past", org_id: A, client_id: K.ann, starts_at: past, status: "booked", created_at: past });
    const previousCard = byId(await callEngine({ key: "sales" }, pastOnly))["card-ann"];
    assert.equal(previousCard.booked_starts_at, past);
    assert.equal(previousCard.booked_kind, "booked");

    const repeat = engineBoard();
    repeat.insert("bookings", {
      id: "original", org_id: A, client_id: K.ann,
      starts_at: past, status: "completed", created_at: past
    });
    repeat.insert("bookings", {
      id: "second", org_id: A, client_id: K.ann,
      starts_at: next, status: "booked", created_at: next
    });
    assert.equal(byId(await callEngine({ key: "sales" }, repeat))["card-ann"].booked_kind, "rebooked");
  });

  test("the stages come in their set order and each card sits under the stage its own row names, newest first", async () => {
    const res = await callEngine({ key: "sales" }, engineBoard());
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.stages.map((s) => s.key), ["new_lead", "booked_call", "closed_won"]);
    const ids = (key) => res.body.stages.find((s) => s.key === key).cards.map((c) => c.id);
    assert.deepEqual(ids("new_lead"), ["card-ann", "card-cal"]);
    assert.deepEqual(ids("booked_call"), ["card-ben", "card-dan", "card-partner"]);
    assert.deepEqual(ids("closed_won"), ["card-eve"]);
    assert.equal(res.body.total, 6);
  });

  test("the card carries the client's own name, owner, funded flag and money; the money is the funded amount, else the estimate", async () => {
    const res = await callEngine({ key: "sales" }, engineBoard());
    const c = byId(res);
    assert.deepEqual([c["card-ann"].client_id, c["card-ann"].name, c["card-ann"].email, c["card-ann"].phone], [K.ann, "Ann Rivers", "ann@example.test", "+16025550101"]);
    assert.equal(c["card-ann"].owner, "closer-1");
    assert.equal(c["card-ann"].funded, true);
    assert.equal(c["card-ann"].outcome_tier, "FULL_FUNDING");
    assert.equal(c["card-ann"].amount, 50000, "the funded amount");
    assert.equal(c["card-ben"].amount, 25000, "no funded amount: the funding estimate");
    assert.equal(c["card-ben"].survey_fico, "700-749");
    assert.equal(c["card-cal"].amount, null, "nothing known is unknown, not 0");
    assert.equal(c["card-cal"].funded, false);
    assert.equal(c["card-cal"].owner, null);
    const newLead = res.body.stages.find((s) => s.key === "new_lead");
    assert.equal(newLead.amount, 50000);
    assert.equal(newLead.amount_known, 1);
  });

  test("only this company's board of this key is read: another company's same-key board, cards and stages never appear", async () => {
    const res = await callEngine({ key: "sales" }, engineBoard());
    const all = cardsOf(res).map((c) => c.id);
    for (const foreign of ["card-b-only", "card-foreign-client", "card-foreign-partner", "card-wrong-org", "card-a-on-b"]) {
      assert.equal(all.includes(foreign), false, foreign);
    }
    assert.equal(res.body.stages.some((s) => s.key === "their_only"), false);
    // The funding board's cards are not on the sales board.
    assert.equal(all.some((x) => x.startsWith("f-")), false);
    const other = await callEngine({ key: "sales" }, engineBoard(), [staffSession({ role: "closer", org_id: B })]);
    assert.deepEqual(other.body.stages.map((s) => s.key), ["their_only"]);
    assert.deepEqual(cardsOf(other).map((c) => c.id), ["card-b-only"]);
    assert.equal(cardsOf(other)[0].name, "Fiona Other");
    const none = await callEngine({ key: "nope" }, engineBoard());
    assert.equal(none.statusCode, 404);
  });

  test("a card needs a person or a partner of this company; an orphan, an other-company client and an other-company partner are left off", async () => {
    const res = await callEngine({ key: "sales" }, engineBoard());
    const c = byId(res);
    assert.equal(c["card-partner"].name, "Acme Partner");
    assert.equal(c["card-partner"].email, "ops@acme.example.test");
    assert.equal(c["card-partner"].client_id, null);
    for (const gone of ["card-orphan", "card-foreign-client", "card-foreign-partner"]) assert.equal(c[gone], undefined, gone);
  });

  test("demo clients are hidden unless Demo Mode is on, and say so when shown; an archived client is never on the board", async () => {
    const off = await callEngine({ key: "sales" }, engineBoard({ demoMode: false }));
    assert.equal(byId(off)["card-demo"], undefined);
    assert.equal(byId(off)["card-arch"], undefined);
    const on = await callEngine({ key: "sales" }, engineBoard({ demoMode: true }));
    assert.equal(byId(on)["card-demo"].name, "DEMO · Demo Person");
    assert.equal(byId(on)["card-demo"].is_demo, true);
    assert.equal(byId(on)["card-arch"], undefined, "archived stays off even with Demo Mode on");
  });

  test("the limit keeps the newest cards", async () => {
    const res = await callEngine({ key: "sales", limit: "3" }, engineBoard());
    assert.equal(res.body.total, 3);
    assert.deepEqual(cardsOf(res).map((c) => c.id).sort(), ["card-ann", "card-ben", "card-cal"]);
  });

  test("a text needs a reply when the newest message in this client's own text thread of this company is inbound; an email the same way", async () => {
    const res = await callEngine({ key: "sales" }, engineBoard());
    const c = byId(res);
    assert.deepEqual([c["card-ann"].sms_needs_reply, c["card-ann"].email_needs_reply], [true, false], "Ann: text thread ends with her, email thread ends with us");
    assert.deepEqual([c["card-ben"].sms_needs_reply, c["card-ben"].email_needs_reply], [false, true], "Ben: his inbound email is the newest in its own thread");
    assert.deepEqual([c["card-cal"].sms_needs_reply, c["card-cal"].email_needs_reply], [true, false], "Cal: a thread on the text channel counts as a text");
    assert.deepEqual([c["card-dan"].sms_needs_reply, c["card-dan"].email_needs_reply], [false, false], "Dan has no threads; other people's threads are not his");
    assert.deepEqual([c["card-eve"].sms_needs_reply, c["card-eve"].email_needs_reply], [false, false], "Eve's threads sit in the other company");
  });

  test("the missing-amount flag is on the funding boards only, and counts a yes with no usable amount in the client's newest round of this company", async () => {
    const funding = await callEngine({ key: "funding_card_stacking" }, engineBoard());
    assert.equal(funding.statusCode, 200, JSON.stringify(funding.body));
    const f = byId(funding);
    assert.equal(f["f-ann"].approval_amount_missing, true, "a blank amount on her newest round");
    assert.equal(f["f-ben"].approval_amount_missing, false, "his amount is known; Ann's approval filed on his round is not his");
    assert.equal(f["f-cal"].approval_amount_missing, false, "excluded and declined yeses do not flag");
    assert.equal(f["f-dan"].approval_amount_missing, false, "the blank amount is on an older round");
    assert.equal(f["f-eve"].approval_amount_missing, false, "the only blank yes is the other company's");
    assert.equal(f["f-frank"].approval_amount_missing, true, "a zero amount is no amount");
    const sales = await callEngine({ key: "sales" }, engineBoard());
    assert.equal(byId(sales)["card-ann"].approval_amount_missing, false, "the same client's Sales card carries no funding chip");
  });

  test("it only reads: every statement the board runs is a SELECT", async () => {
    const e = engineBoard();
    await callEngine({ key: "sales" }, e);
    for (const c of e.calls) assert.match(c.sql.trim(), /^SELECT\b/i, c.sql.slice(0, 40));
  });
});
