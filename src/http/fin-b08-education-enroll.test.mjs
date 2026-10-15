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

/* Every WHERE of a statement this file answers is READ from its own text: the conditions it names are applied
   to the rows, and a condition this reader does not know throws. Nothing about company, client, pipeline or
   stage is decided by a parameter's position. */
function conditionRows(sql, params, rows) {
  const text = String(sql).replace(/\s+/g, " ").replace(/lower\(email\)/gi, "email_lower");
  const m = /\bWHERE\b(.*?)(?:\bLIMIT\b|$)/i.exec(text);
  if (!m) throw new Error(`the enroll stand-in cannot read a WHERE: ${text.slice(0, 120)}`);
  const re = /(?:\b(p|ps|c)\.)?\b([a-z_]+)\s*=\s*\$(\d+)/gi;
  const conds = [...m[1].matchAll(re)].map((x) => ({ key: x[1] ? `${x[1]}.${x[2]}` : x[2], param: params[Number(x[3]) - 1] }));
  const rest = m[1].replace(re, " ").replace(/\bAND\b/gi, " ").replace(/\s+/g, " ").trim();
  if (rest) throw new Error(`the enroll stand-in cannot read this condition: ${rest}`);
  return rows.filter((r) => conds.every((c) => {
    if (!(c.key in r)) throw new Error(`the enroll stand-in has no column ${c.key}`);
    return r[c.key] === c.param;
  }));
}

function enrollDb({ clients = [], cards = [], cardFails = false, board = true, clientReadFails = false, template = false } = {}) {
  const state = { clients: clients.map((c) => ({ custom_fields: {}, ...c })), cards: cards.slice(), enrollments: [], events: [], messages: [] };
  const stage = (id, pipelineId, pipelineOrg, org, key, order, pipelineKey = "sales") => ({ id, pipeline_id: pipelineId, pipeline_org_id: pipelineOrg, org_id: org, key, sort_order: order, pipeline_key: pipelineKey });
  const stages = board ? [
    // A stage row filed under another company on this company's own pipeline (bad data): never the target.
    stage("57a60000-0000-4000-8000-0000000000ee", SALES, ORG, OTHER_ORG, "new_lead", 9),
    stage(STAGE_NEW, SALES, ORG, ORG, "new_lead", 1),
    stage(STAGE_BOOKED, SALES, ORG, ORG, "booked_call", 3),
    // Another company's board with the same keys must never receive this card.
    stage("57a60000-0000-4000-8000-0000000000ff", "5a1e0000-0000-4000-8000-0000000000ff", OTHER_ORG, OTHER_ORG, "new_lead", 1),
  ] : [];
  const stageRows = () => stages.map((s) => ({ ...s, "p.key": s.pipeline_key, "ps.key": s.key, "p.org_id": s.pipeline_org_id, "ps.org_id": s.org_id }));
  const cardRows = () => state.cards.map((c) => {
    const s = stages.find((x) => x.id === c.stage_id) || {};
    return { ...c, "c.client_id": c.client_id, "p.key": c.pipeline_key, "p.org_id": c.pipeline_org_id ?? c.org_id, stage_key: s.key, sort_order: s.sort_order };
  });
  const fake = fakeDb([
    [/^\s*SELECT id FROM orgs WHERE slug = \$1/i, [{ id: ORG }]],
    [/^\s*SELECT id, ghl_contact_id FROM clients WHERE/i, (s, p) => {
      if (clientReadFails) return new Error("clients table is down");
      return conditionRows(s, p, state.clients.map((c) => ({ ...c, email_lower: String(c.email).toLowerCase() })))
        .map((c) => ({ id: c.id, ghl_contact_id: c.ghl_contact_id || null }));
    }],
    [/^\s*INSERT INTO clients/i, (_s, p) => {
      const c = { id: `c${state.clients.length + 1}0000000-0000-4000-8000-000000000000`, org_id: p[0], email: p[1], first_name: p[2], last_name: p[3], phone: p[4], channel_source: p[5], custom_fields: {} };
      state.clients.push(c);
      return [{ id: c.id }];
    }],
    [/^\s*SELECT id, ghl_contact_id, email, phone, first_name, last_name FROM clients WHERE id = \$1/i, (_s, p) => state.clients.filter((c) => c.id === p[0])],
    [/^\s*SELECT body, subject, compliance_passed\s+FROM message_templates/i, () => (template ? [{ body: "Welcome {{contact.first_name}}", subject: "Welcome", compliance_passed: true }] : [])],
    [/^\s*INSERT INTO education_enrollments/i, (_s, p) => {
      const row = { id: `e${state.enrollments.length + 1}0000000-0000-4000-8000-000000000000`, org_id: p[0], client_id: p[1], program: p[2], full_name: p[3], email: p[4], phone: p[5], sms_consent: p[6], page_url: p[7], status: "pending_payment" };
      state.enrollments.push(row);
      return [row];
    }],
    [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id(?:, ps\.sort_order)?\s+FROM pipeline_stages ps/i, (s, p) => conditionRows(s, p, stageRows())
      .map((r) => ({ stage_id: r.id, pipeline_id: r.pipeline_id, sort_order: r.sort_order }))],
    [/^\s*SELECT ps\.key AS stage_key, ps\.sort_order\s+FROM cards c/i, (s, p) => conditionRows(s, p, cardRows())
      .map((c) => ({ stage_key: c.stage_key, sort_order: c.sort_order }))],
    [/^\s*SELECT id FROM cards WHERE/i, (s, p) => conditionRows(s, p, state.cards).map((c) => ({ id: c.id }))],
    [/^\s*UPDATE cards SET stage_id = \$2 WHERE id = \$1/i, (_s, p) => { const c = state.cards.find((x) => x.id === p[0]); if (c) c.stage_id = p[1]; return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO cards \(org_id, client_id, pipeline_id, stage_id\)/i, (_s, p) => {
      if (cardFails) return new Error("card table is down");
      const owner = stages.find((x) => x.pipeline_id === p[2]);
      state.cards.push({ id: `k${state.cards.length + 1}`, org_id: p[0], client_id: p[1], pipeline_id: p[2], stage_id: p[3], pipeline_key: "sales", pipeline_org_id: owner ? owner.pipeline_org_id : p[0] });
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

  test("a welcome email would show: with an approved template on file for any key, an enrollment still queues no message", async () => {
    const fake = enrollDb({ template: true });
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200);
    assert.equal(fake.state.messages.length, 0, "no message is queued");
    assert.equal(fake.calls.filter((c) => /message_templates/.test(c.sql)).length, 0, "no template is even looked up");
    assert.equal(fake.state.events.length, 0);
    assert.deepEqual(asked, []);
  });

  test("when the person cannot be resolved the enrollment is still stored, with no client and no card, and the form still says yes", async () => {
    const fake = enrollDb({ clientReadFails: true });
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.clientId, null);
    assert.equal(res.body.carded, false);
    assert.equal(fake.state.enrollments.length, 1, "the row is not lost");
    assert.equal(fake.state.enrollments[0].client_id, null);
    assert.equal(fake.state.enrollments[0].email, "dana@example.test");
    assert.equal(fake.state.cards.length, 0);
  });

  test("a company whose sales board has no new_lead stage is not told its card was placed, and its enrollment is still saved", async () => {
    const fake = enrollDb({ board: false });
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.carded, false, "no stage, no card, and the answer says so");
    assert.equal(fake.state.cards.length, 0);
    assert.equal(fake.state.enrollments.length, 1);
    assert.ok(res.body.clientId);
  });

  test("the card goes on this company's own new_lead stage, never another company's stage or a stage filed under another company, and another company's card for the same person does not count", async () => {
    const person = "c0000000-0000-4000-8000-0000000000aa";
    const fake = enrollDb({
      clients: [{ id: person, org_id: ORG, email: "dana@example.test" }],
      // The same person id has a card far along on ANOTHER company's sales board: it must not make this one "already past".
      cards: [{ id: "kX", org_id: OTHER_ORG, client_id: person, pipeline_id: "5a1e0000-0000-4000-8000-0000000000ff", stage_id: STAGE_BOOKED, pipeline_key: "sales", pipeline_org_id: OTHER_ORG }],
    });
    const res = await post(form(), fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const mine = fake.state.cards.find((c) => c.org_id === ORG);
    assert.ok(mine, "this company's card was made");
    assert.equal(mine.stage_id, STAGE_NEW);
    assert.equal(mine.pipeline_id, SALES);
    assert.equal(res.body.carded, true);
  });

  test("a returning email is matched inside this company only: the lookup carries the company and the lower-cased address", async () => {
    const person = "c0000000-0000-4000-8000-0000000000cc";
    const fake = enrollDb({ clients: [
      { id: "c0000000-0000-4000-8000-0000000000dd", org_id: OTHER_ORG, email: "dana@example.test" },
      { id: person, org_id: ORG, email: "DANA@example.test" },
    ] });
    const res = await post(form({ email: " DANA@EXAMPLE.TEST " }), fake);
    assert.equal(res.body.clientId, person);
    assert.equal(fake.state.clients.length, 2, "nobody new was made");
    const lookup = fake.calls.find((c) => /SELECT id, ghl_contact_id FROM clients/.test(c.sql));
    assert.deepEqual(lookup.params, [ORG, "dana@example.test"]);
  });
});
