// finish-853 batch 08: POST /api/public/education-enroll. The real handler, the real enrollment
// writer, the real client resolver and the real card mover run over stand-in tables. The row's
// words: the /education/enroll/ form saves an enrollment, resolves or creates the client, and drops
// a Sales / new_lead card; no email, no event. Practice test, fake data; the outbound fences are
// held up and the network is refused for the whole file.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/public/education-enroll.mjs";
import { fakeDb, makeRes, runWithSharedDb } from "../testing/handler-harness.mjs";
import { bindProblem } from "../testing/s3-scoped-rows.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const SALES = "5a1e0000-0000-4000-8000-000000000001";
const STAGE_NEW = "57a60000-0000-4000-8000-000000000001";
const STAGE_BOOKED = "57a60000-0000-4000-8000-000000000002";
const KEYS = ["ADAPTERS_DRY_RUN", "MESSAGING_DRY_RUN", "INNGEST_EVENT_KEY"];
const saved = {};
const realFetch = globalThis.fetch;
const asked = [];
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.ADAPTERS_DRY_RUN = "1";
  process.env.MESSAGING_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
beforeEach(() => { asked.length = 0; });

function enrollDb({ clients = [], cards = [], cardFails = false } = {}) {
  const state = { clients: clients.map((c) => ({ custom_fields: {}, ...c })), cards: cards.slice(), enrollments: [], events: [], messages: [] };
  const stages = [
    { id: STAGE_NEW, pipeline_id: SALES, org_id: ORG, key: "new_lead", sort_order: 1, pipeline_key: "sales" },
    { id: STAGE_BOOKED, pipeline_id: SALES, org_id: ORG, key: "booked_call", sort_order: 3, pipeline_key: "sales" },
    // Another company's board with the same keys must never receive this card.
    { id: "57a60000-0000-4000-8000-0000000000ff", pipeline_id: "5a1e0000-0000-4000-8000-0000000000ff", org_id: OTHER_ORG, key: "new_lead", sort_order: 1, pipeline_key: "sales" },
  ];
  const fake = fakeDb([
    [/^\s*SELECT id FROM orgs WHERE slug = \$1/i, [{ id: ORG }]],
    [/^\s*SELECT id, ghl_contact_id FROM clients WHERE org_id = \$1 AND lower\(email\) = \$2/i, (_s, p) => state.clients.filter((c) => c.org_id === p[0] && String(c.email).toLowerCase() === p[1]).map((c) => ({ id: c.id, ghl_contact_id: c.ghl_contact_id || null }))],
    [/^\s*INSERT INTO clients/i, (_s, p) => {
      const c = { id: `c${state.clients.length + 1}0000000-0000-4000-8000-000000000000`, org_id: p[0], email: p[1], first_name: p[2], last_name: p[3], phone: p[4], channel_source: p[5], custom_fields: {} };
      state.clients.push(c);
      return [{ id: c.id }];
    }],
    [/^\s*SELECT id, ghl_contact_id, email, phone, first_name, last_name FROM clients WHERE id = \$1/i, (_s, p) => state.clients.filter((c) => c.id === p[0])],
    [/^\s*INSERT INTO education_enrollments/i, (_s, p) => {
      const row = { id: `e${state.enrollments.length + 1}0000000-0000-4000-8000-000000000000`, org_id: p[0], client_id: p[1], program: p[2], full_name: p[3], email: p[4], phone: p[5], sms_consent: p[6], page_url: p[7], status: "pending_payment" };
      state.enrollments.push(row);
      return [row];
    }],
    [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id, ps\.sort_order\s+FROM pipeline_stages ps/i, (_s, p) => stages.filter((s) => s.pipeline_key === p[0] && s.key === p[1] && s.org_id === p[2])
      .map((s) => ({ stage_id: s.id, pipeline_id: s.pipeline_id, sort_order: s.sort_order }))],
    [/^\s*SELECT ps\.key AS stage_key, ps\.sort_order\s+FROM cards c/i, (_s, p) => state.cards.filter((c) => c.client_id === p[0] && c.pipeline_key === p[1] && c.org_id === p[2])
      .map((c) => { const s = stages.find((x) => x.id === c.stage_id); return { stage_key: s.key, sort_order: s.sort_order }; })],
    [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id FROM pipeline_stages ps/i, (_s, p) => stages.filter((s) => s.pipeline_key === p[0] && s.key === p[1] && s.org_id === p[2]).map((s) => ({ stage_id: s.id, pipeline_id: s.pipeline_id }))],
    [/^\s*SELECT id FROM cards WHERE client_id = \$1 AND pipeline_id = \$2/i, (_s, p) => state.cards.filter((c) => c.client_id === p[0] && c.pipeline_id === p[1]).map((c) => ({ id: c.id }))],
    [/^\s*UPDATE cards SET stage_id = \$2 WHERE id = \$1/i, (_s, p) => { const c = state.cards.find((x) => x.id === p[0]); if (c) c.stage_id = p[1]; return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO cards \(org_id, client_id, pipeline_id, stage_id\)/i, (_s, p) => {
      if (cardFails) return new Error("card table is down");
      state.cards.push({ id: `k${state.cards.length + 1}`, org_id: p[0], client_id: p[1], pipeline_id: p[2], stage_id: p[3], pipeline_key: "sales" });
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*INSERT INTO events/i, (_s, p) => { state.events.push({ name: p[1] }); return [{ id: "e" }]; }],
    [/^\s*INSERT INTO messages/i, (_s, p) => { state.messages.push(p); return [{ id: "m" }]; }],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.state = state;
  return fake;
}
async function post(body, fake) {
  const res = makeRes();
  await runWithSharedDb(fake, () => handler({ method: "POST", body, headers: {}, query: {} }, res));
  return res;
}
const form = (over = {}) => ({ program: "credit-mastery", full_name: "Dana Whitfield", email: "  Dana@Example.test ", phone: "6025550100", sms_consent: true, page_url: "https://fundhub.ai/education/enroll/", ...over });

describe("POST /api/public/education-enroll", () => {
  test("it saves the enrollment as typed (cleaned), waiting for payment, and answers with its id and the client it resolved", async () => {
    const fake = enrollDb();
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "pending_payment");
    assert.equal(fake.state.enrollments.length, 1);
    const row = fake.state.enrollments[0];
    assert.equal(res.body.id, row.id);
    assert.deepEqual([row.org_id, row.program, row.full_name, row.email, row.phone, row.sms_consent, row.page_url],
      [ORG, "credit-mastery", "Dana Whitfield", "dana@example.test", "+16025550100", true, "https://fundhub.ai/education/enroll/"]);
    assert.equal(row.client_id, res.body.clientId);
    const insert = fake.calls.find((c) => /INSERT INTO education_enrollments/.test(c.sql));
    assert.doesNotMatch(insert.sql.split("VALUES")[0], /status/, "nothing here sets the status: the column's own default is what says waiting for payment");
  });

  test("text consent is stored as given: false stays false, and nothing typed becomes consent", async () => {
    const fake = enrollDb();
    await post(form({ sms_consent: false, email: "a@example.test" }), fake);
    await post(form({ sms_consent: undefined, email: "b@example.test" }), fake);
    await post(form({ sms_consent: "yes please", email: "c@example.test" }), fake);
    assert.deepEqual(fake.state.enrollments.map((e) => e.sms_consent), [false, false, true]);
  });

  test("it resolves the person: a new email makes one client, a known email is the same client, and the source is named", async () => {
    const fake = enrollDb();
    const first = await post(form(), fake);
    const second = await post(form({ program: "capital-strategy" }), fake);
    assert.equal(fake.state.clients.length, 1, "one person, one client row");
    assert.equal(first.body.clientId, second.body.clientId);
    assert.equal(fake.state.clients[0].channel_source, "website:education-enroll");
    assert.equal(fake.state.clients[0].org_id, ORG);
    assert.equal(fake.state.enrollments.length, 2);
    assert.deepEqual(fake.state.enrollments.map((e) => e.program), ["credit-mastery", "capital-strategy"]);
    const known = enrollDb({ clients: [{ id: "c0000000-0000-4000-8000-0000000000aa", org_id: ORG, email: "dana@example.test" }] });
    const res = await post(form(), known);
    assert.equal(res.body.clientId, "c0000000-0000-4000-8000-0000000000aa");
    assert.equal(known.state.clients.length, 1);
    const otherCompany = enrollDb({ clients: [{ id: "c0000000-0000-4000-8000-0000000000bb", org_id: OTHER_ORG, email: "dana@example.test" }] });
    const fresh = await post(form(), otherCompany);
    assert.notEqual(fresh.body.clientId, "c0000000-0000-4000-8000-0000000000bb", "another company's client of the same email is not reused");
    assert.equal(otherCompany.state.clients.length, 2);
  });

  test("it drops a Sales new_lead card for the client on this company's board, once", async () => {
    const fake = enrollDb();
    const res = await post(form(), fake);
    assert.equal(res.body.carded, true);
    assert.equal(fake.state.cards.length, 1);
    assert.deepEqual([fake.state.cards[0].org_id, fake.state.cards[0].client_id, fake.state.cards[0].pipeline_id, fake.state.cards[0].stage_id],
      [ORG, res.body.clientId, SALES, STAGE_NEW]);
    await post(form(), fake);
    assert.equal(fake.state.cards.length, 1, "a second enrollment does not make a second card");
  });

  test("a card further along the board is never dragged back to new_lead", async () => {
    const fake = enrollDb({
      clients: [{ id: "c0000000-0000-4000-8000-0000000000aa", org_id: ORG, email: "dana@example.test" }],
      cards: [{ id: "k0", org_id: ORG, client_id: "c0000000-0000-4000-8000-0000000000aa", pipeline_id: SALES, stage_id: STAGE_BOOKED, pipeline_key: "sales" }],
    });
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.carded, true, "already at or past new_lead counts as placed");
    assert.equal(fake.state.cards[0].stage_id, STAGE_BOOKED);
  });

  test("a card that cannot be placed does not lose the enrollment", async () => {
    const fake = enrollDb({ cardFails: true });
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.carded, false);
    assert.equal(fake.state.enrollments.length, 1);
  });

  test("no email and no event: nothing is emitted, no message is queued, nothing leaves the process", async () => {
    const fake = enrollDb();
    await post(form(), fake);
    assert.equal(fake.state.events.length, 0);
    assert.equal(fake.state.messages.length, 0);
    assert.deepEqual(asked, []);
  });

  test("an unknown program, no name or a bad email is 400 and nothing is written", async () => {
    for (const [over, error] of [[{ program: "get-rich" }, "unknown_program"], [{ full_name: "  " }, "name_required"], [{ email: "nope" }, "email_required"]]) {
      const fake = enrollDb();
      const res = await post(form(over), fake);
      assert.equal(res.statusCode, 400, error);
      assert.equal(res.body.error, error);
      assert.equal(fake.state.enrollments.length + fake.state.clients.length + fake.state.cards.length, 0);
    }
    const res = makeRes();
    await runWithSharedDb(enrollDb(), () => handler({ method: "GET", headers: {}, query: {} }, res));
    assert.equal(res.statusCode, 405);
  });
});
