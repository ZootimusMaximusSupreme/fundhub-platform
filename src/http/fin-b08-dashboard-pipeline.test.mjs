// finish-853 batch 08: GET /api/dashboard/pipeline. The real handler runs over a stand-in database.
// The stand-in cannot run the board's joined statement (that is proved on a scratch Postgres in
// pipeline.pg.test.mjs), so it hands back the rows that statement returns and the test judges what
// the handler does with them: stages in order, each card under its own stage, the column money
// (a sum of known amounts, unknown not 0, an empty column a real 0), the company from the session
// only, and it pins the clauses of the statement that carry the company, the demo filter, the
// last-message-inbound facts and the newest-round-only funding flag. The stages are kept in a scrambled
// order and the stand-in hands them back in the order the statement's own ORDER BY names, so a board
// whose stage statement lost or changed that clause comes back out of order. Practice test, fake data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { stageAmount } from "../../api/dashboard/pipeline.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { assertSqlHas, bindProblem } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

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
