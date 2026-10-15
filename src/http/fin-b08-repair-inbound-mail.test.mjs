// finish-853 batch 08: POST /api/repair/inbound-mail. The real handler, the real response reader,
// the real round-advance rules and the real repair event handler run over stand-in dispute items,
// responses and decision log. The row's words: process a bureau response (pasted text or an
// uploaded document): parses it, updates dispute items and responses, advances the repair file.
// For the uploaded-document half the one model call is a recording stand-in on the web call; no real
// key, no spend. Practice test, fake data, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/repair/inbound-mail.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const CASE = "ca000000-0000-4000-8000-000000000001";
const ITEM_CHASE = "d1000000-0000-4000-8000-000000000001";
const ITEM_AMEX = "d2000000-0000-4000-8000-000000000002";
const FOREIGN_ITEM = "d9000000-0000-4000-8000-000000000009";
const DOC = "d0c00000-0000-4000-8000-000000000001";
const PIPE = "0b110000-0000-4000-8000-000000000001";
const STAGE_KEYS = ["intake", "analysis", "letters_generated", "in_transit", "awaiting_response", "response_received", "round_complete", "stalled"];
const STAGE_ID = (key) => `57a60000-0000-4000-8000-${String(STAGE_KEYS.indexOf(key) + 1).padStart(12, "0")}`;
// The approved wording the company would have on file for each repair email. The tags are the ones the
// product's own merge fills, so an email that skipped a field or filled it wrong reads wrong here.
const TEMPLATES = {
  "EMAIL-REPAIR-RESPONSE-RESULTS": { subject: "Your results", body: "Results:\n{{repair.outcomes_list}}\n{{outcomes}}" },
  "EMAIL-REPAIR-ROUND-ADVANCED": { subject: "Next round", body: "Round {{repair.round}} for:\n{{repair.escalated_list}}" },
  "EMAIL-REPAIR-RETAKE-PHOTO": { subject: "Retake", body: "Retake: {{message_to_client}}" },
};

const KEYS = ["OPENAI_API_KEY", "COMPANY_BRAIN_OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN", "INNGEST_EVENT_KEY"];
const saved = {};
const realFetch = globalThis.fetch;
const realWarn = console.warn;
const modelCalls = [];
let modelAnswer = null;
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  delete process.env.COMPANY_BRAIN_OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.INNGEST_EVENT_KEY;
  process.env.OPENAI_API_KEY = "test-model-key";
  process.env.MESSAGING_DRY_RUN = "1";
  process.env.ADAPTERS_DRY_RUN = "1";
  console.warn = () => {};
  globalThis.fetch = async (url, init) => {
    modelCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    const content = JSON.stringify(modelAnswer);
    return {
      ok: true, status: 200, headers: { get: () => null, forEach() {} },
      text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }),
      json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }),
    };
  };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});
beforeEach(() => { modelCalls.length = 0; modelAnswer = null; });

const item = (over = {}) => ({
  id: ITEM_CHASE, case_id: CASE, org_id: ORG_ID, client_id: CLIENT, creditor: "Chase", account_last4: "4242", round: "R1", status: "sent",
  rule_id: "r1", outcome: null, bureau: "EX", created_at: "2026-09-01T00:00:00Z", ...over,
});

function repairFile({ items = [item()], roundsCap = null, stage = "awaiting_response", templates = TEMPLATES } = {}) {
  const state = {
    items: items.map((i) => ({ ...i })), responses: [], decisions: [], eventsSeen: [], messages: [],
    cards: [{ id: "k1000000-0000-4000-8000-000000000001", org_id: ORG_ID, client_id: CLIENT, pipeline_id: PIPE, stage_id: STAGE_ID(stage) }],
  };
  const stageKeyOf = (card) => STAGE_KEYS.find((k) => STAGE_ID(k) === card?.stage_id) || null;
  state.stageOf = (clientId = CLIENT) => stageKeyOf(state.cards.find((c) => c.client_id === clientId));
  const fake = fakeDb([
    // The open items: this company, this client, and ONLY the statuses the statement asks for.
    [/^\s*SELECT di\.id, di\.case_id, di\.org_id, di\.client_id, di\.creditor,/i, (s, p) => rowsWhere(state.items, s.slice(s.indexOf("WHERE")), p)
      .filter((r) => !/di\.status\s*=\s*ANY\(\$3::text\[\]\)/.test(s) || p[2].includes(r.status))],
    // The card mover: the stage by its pipeline key, stage key and company; the client's card by client and pipeline.
    [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id\s+FROM pipeline_stages ps/i, (_s, p) => (p[0] === "optimization" && p[2] === ORG_ID && STAGE_KEYS.includes(p[1])
      ? [{ stage_id: STAGE_ID(p[1]), pipeline_id: PIPE }] : [])],
    [/^\s*SELECT id FROM cards WHERE client_id = \$1 AND pipeline_id = \$2/i, (_s, p) => state.cards.filter((c) => c.client_id === p[0] && c.pipeline_id === p[1]).map((c) => ({ id: c.id }))],
    [/^\s*UPDATE cards SET stage_id = \$2 WHERE id = \$1/i, (_s, p) => { const c = state.cards.find((x) => x.id === p[0]); if (c) c.stage_id = p[1]; return { rows: [], rowCount: c ? 1 : 0 }; }],
    [/^\s*INSERT INTO cards \(org_id, client_id, pipeline_id, stage_id\)/i, (_s, p) => { state.cards.push({ id: `k${state.cards.length + 1}`, org_id: p[0], client_id: p[1], pipeline_id: p[2], stage_id: p[3] }); return { rows: [], rowCount: 1 }; }],
    // The company's approved wording for each email key; nothing else is sent.
    [/^\s*SELECT body, subject, compliance_passed\s+FROM message_templates/i, (_s, p) => (p[0] === ORG_ID && templates[p[1]] ? [{ ...templates[p[1]], compliance_passed: true }] : [])],
    [/^\s*INSERT INTO messages \(org_id, client_id, direction, channel, template_key, rendered_body/i, (_s, p) => {
      if (state.messages.some((m) => m.org_id === p[0] && m.provider_ref === p[5])) return [];
      const row = { id: `e${state.messages.length + 1}000000-0000-4000-8000-000000000000`, org_id: p[0], client_id: p[1], channel: p[2], template_key: p[3], rendered_body: p[4], provider_ref: p[5], to_address: p[6], subject: p[7] };
      state.messages.push(row);
      return [{ id: row.id, created_at: "2026-09-10T00:00:00Z" }];
    }],
    [/^\s*SELECT rounds_cap FROM repair_programs/i, roundsCap == null ? [] : [{ rounds_cap: roundsCap }]],
    [/^\s*INSERT INTO repair_decision_log/i, (_s, p) => { state.decisions.push({ org_id: p[0], client_id: p[1], case_id: p[2], decision: p[3], payload: JSON.parse(p[4]) }); return { rows: [], rowCount: 1 }; }],
    [/^\s*UPDATE dispute_items SET status = \$2, round = \$3, outcome = \$4/i, (_s, p) => {
      const r = state.items.find((x) => x.id === p[0]);
      if (r) Object.assign(r, { status: p[1], round: p[2], outcome: p[3] });
      return { rows: [], rowCount: r ? 1 : 0 };
    }],
    [/^\s*INSERT INTO dispute_responses/i, (_s, p) => {
      const row = { id: `a${state.responses.length + 1}000000-0000-4000-8000-000000000000`, case_id: p[0], org_id: p[1], client_id: p[2], raw_text: p[3], parse_json: JSON.parse(p[4]), confidence: p[5], confirmed: p[6], confirmed_by: p[7] };
      state.responses.push(row);
      return [row];
    }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.state = state;
  return fake;
}

async function call(body, fake, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res, { db: combined }));
  return { res, fake };
}
const DELETED = "Your dispute of the Chase account ending 4242 has been deleted from your file.";

describe("POST /api/repair/inbound-mail", () => {
  test("pasted text that says the account was deleted advances that item, stores the response as confirmed, and logs the decision", async () => {
    const fake = repairFile();
    const { res } = await call({ client_id: CLIENT, text: DELETED }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, "advanced");
    assert.deepEqual(res.body.result.parseResult.outcomes, [{ itemId: ITEM_CHASE, outcome: "deleted", evidence: "deleted_language" }]);
    const row = fake.state.items[0];
    assert.equal(row.status, "deleted");
    assert.equal(row.outcome, "deleted");
    assert.equal(fake.state.responses.length, 1);
    assert.equal(fake.state.responses[0].confirmed, true);
    assert.equal(fake.state.responses[0].raw_text, DELETED);
    assert.equal(fake.state.responses[0].client_id, CLIENT);
    assert.equal(fake.state.responses[0].org_id, ORG_ID);
    assert.equal(fake.state.responses[0].case_id, CASE);
    assert.equal(res.body.result.responseId, fake.state.responses[0].id);
    assert.ok(fake.state.decisions.some((d) => d.case_id === CASE && d.client_id === CLIENT), "the decision is logged on the case");
    const write = fake.calls.find((c) => /UPDATE dispute_items SET status/.test(c.sql));
    assertSqlHas(write.sql, { "one item, by its id": "WHERE id = $1" });
    assert.deepEqual(write.params, [ITEM_CHASE, "deleted", "R1", "deleted"]);
  });

  test("verified language keeps the account (verified) and updated language marks it updated; a letter that does not name it is unaddressed", async () => {
    const cases = [
      ["The Chase account ending 4242 has been verified as accurate.", "verified"],
      ["The Chase account ending 4242 was updated with corrected information.", "updated"],
    ];
    for (const [text, outcome] of cases) {
      const fake = repairFile();
      const { res } = await call({ client_id: CLIENT, text }, fake);
      assert.equal(res.body.result.parseResult.outcomes[0].outcome, outcome, text);
      assert.equal(fake.state.items[0].outcome, outcome);
      // A bureau that verified the account sends it on to the next round; an update closes this one.
      assert.deepEqual([fake.state.items[0].status, fake.state.items[0].round], outcome === "verified" ? ["escalated", "R2"] : ["updated", "R1"]);
    }
    const none = repairFile();
    const { res } = await call({ client_id: CLIENT, text: "Thank you for contacting us. We received your letter." }, none);
    assert.equal(res.body.result.parseResult.outcomes[0].outcome, "unaddressed");
    assert.equal(res.body.result.status, "held", "a letter that says nothing about the account is not a confident read");
    assert.equal(none.state.items[0].status, "sent", "nothing is advanced on a held read");
  });

  test("a read that is not confident enough is held for a person: nothing advances, the response is stored unconfirmed", async () => {
    const fake = repairFile({ items: [item(), item({ id: ITEM_AMEX, creditor: "Amex", account_last4: "1111" })] });
    const { res } = await call({ client_id: CLIENT, text: "Thank you for contacting us. We received your letter and are reviewing it." }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, "held");
    assert.equal(res.body.result.event, "repair.parse.low_confidence");
    assert.deepEqual(fake.state.items.map((i) => i.status), ["sent", "sent"]);
    assert.equal(fake.state.responses.length, 1);
    assert.equal(fake.state.responses[0].confirmed, false);
    assert.ok(fake.state.responses[0].confidence < 0.85);
  });

  test("a confident read that would cross into the escalation rounds is held for a person, never advanced by the machine", async () => {
    const fake = repairFile({ items: [item({ round: "R3", status: "verified" })] });
    const { res } = await call({ client_id: CLIENT, text: "The Chase account ending 4242 has been verified as accurate." }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, "held");
    assert.equal(res.body.result.heldForEscalation, true);
    assert.equal(fake.state.items[0].round, "R3", "the item did not move into round 4");
    assert.equal(fake.state.responses[0].confirmed, false);
    assert.equal(fake.state.responses[0].parse_json.heldForEscalation, true, "the hold is stamped so the exceptions queue can show it");
  });

  test("only this company's and this client's open items are read; another client's or company's items are never touched", async () => {
    const fake = repairFile({ items: [
      item(),
      item({ id: "d3000000-0000-4000-8000-000000000003", client_id: OTHER_CLIENT, creditor: "Chase", account_last4: "4242" }),
      item({ id: FOREIGN_ITEM, org_id: OTHER_ORG_ID, creditor: "Chase", account_last4: "4242" }),
      item({ id: "d4000000-0000-4000-8000-000000000004", status: "deleted", creditor: "Closed", account_last4: "0000" }),
    ] });
    const { res } = await call({ client_id: CLIENT, text: DELETED }, fake);
    assert.deepEqual(res.body.result.parseResult.outcomes.map((o) => o.itemId), [ITEM_CHASE]);
    assert.deepEqual(fake.state.items.map((i) => [i.id, i.status]), [
      [ITEM_CHASE, "deleted"],
      ["d3000000-0000-4000-8000-000000000003", "sent"],
      [FOREIGN_ITEM, "sent"],
      ["d4000000-0000-4000-8000-000000000004", "deleted"],
    ]);
  });

  test("with no open items nothing is written; with no text and no document it is 400; a bad client id is 400", async () => {
    const empty = repairFile({ items: [] });
    const a = await call({ client_id: CLIENT, text: DELETED }, empty);
    assert.equal(a.res.body.result.ok, false);
    assert.equal(a.res.body.result.reason, "no_open_items");
    assert.equal(empty.state.responses.length, 0);
    const b = await call({ client_id: CLIENT, text: "   " }, repairFile());
    assert.equal(b.res.statusCode, 400);
    assert.equal(b.res.body.error, "text_or_document_required");
    const c = await call({ client_id: "nope", text: DELETED }, repairFile());
    assert.equal(c.res.statusCode, 400);
    assert.equal(c.res.body.error, "client_id_required");
  });

  test("an uploaded document is read by the model, then goes down the same road: a clear letter advances the item", async () => {
    modelAnswer = { quality: "pass", text: DELETED, bureau_guess: "EX", message_to_client: "" };
    const fake = repairFile();
    const { res } = await call({ client_id: CLIENT, document_id: DOC, mime_type: "image/png", bytes: Buffer.from("not-a-real-image").toString("base64") }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(modelCalls.length, 1, "one read of the upload");
    assert.equal(res.body.result.status, "advanced");
    assert.equal(res.body.result.quality, "pass");
    assert.equal(res.body.result.bureau_guess, "EX");
    assert.equal(fake.state.items[0].status, "deleted");
    assert.equal(fake.state.responses[0].confirmed, true);
  });

  test("an unreadable photo is sent back for a retake and no item is touched", async () => {
    modelAnswer = { quality: "retake", text: "", bureau_guess: "unknown", message_to_client: "Please retake the photo with all four corners in the frame." };
    const fake = repairFile();
    const { res } = await call({ client_id: CLIENT, document_id: DOC, mime_type: "image/jpeg", bytes: Buffer.from("blurry").toString("base64") }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, "retake");
    assert.match(res.body.result.message_to_client, /all four corners/);
    assert.equal(fake.state.items[0].status, "sent");
    assert.equal(fake.state.responses.length, 0);
  });

  test("only owner, admin, closer and inquiry specialist may process a response; a client login and no login are refused first", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const fake = repairFile();
      const { res } = await call({ client_id: CLIENT, text: DELETED }, fake, [staffSession({ role })]);
      if (res.statusCode === 403) {
        assert.equal(fake.state.items[0].status, "sent", role);
        assert.equal(fake.calls.filter((c) => /FROM dispute_items/.test(c.sql)).length, 0, role);
      } else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "inquiry_specialist", "owner"]);
    const client = await call({ client_id: CLIENT, text: DELETED }, repairFile(), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.res.statusCode, 401);
    const none = await call({ client_id: CLIENT, text: DELETED }, repairFile(), []);
    assert.equal(none.res.statusCode, 401);
  });
});

const queued = (fake, key) => fake.state.messages.filter((m) => m.template_key === key);
const decided = (fake, name) => fake.state.decisions.filter((d) => d.decision === name);

describe("which items a reply is read against", () => {
  test("every item still waiting on an answer is read, in whatever open state it sits; items already closed are not", async () => {
    const open = [
      item({ id: "d5000000-0000-4000-8000-000000000001", creditor: "Open Co", account_last4: "0001", status: "open" }),
      item({ id: "d5000000-0000-4000-8000-000000000002", creditor: "Sent Co", account_last4: "0002", status: "sent" }),
      item({ id: "d5000000-0000-4000-8000-000000000003", creditor: "Quiet Co", account_last4: "0003", status: "unaddressed" }),
      item({ id: "d5000000-0000-4000-8000-000000000004", creditor: "Next Co", account_last4: "0004", status: "escalated", round: "R2" }),
      item({ id: "d5000000-0000-4000-8000-000000000005", creditor: "Held Co", account_last4: "0005", status: "verified" }),
    ];
    const closed = ["deleted", "updated", "closed"].map((status, i) => item({
      id: `d6000000-0000-4000-8000-00000000000${i + 1}`, creditor: `Done Co ${i}`, account_last4: `900${i}`, status,
    }));
    const fake = repairFile({ items: [...closed, ...open] });
    const { res } = await call({ client_id: CLIENT, text: "Thank you for contacting us." }, fake);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.result.parseResult.outcomes.map((o) => o.itemId).sort(), open.map((o) => o.id).sort());
    const read = fake.calls.find((c) => /FROM dispute_items di/.test(c.sql));
    assert.deepEqual([...read.params[2]].sort(), ["escalated", "open", "sent", "unaddressed", "verified"]);
    assert.deepEqual(fake.state.items.filter((i) => i.id.startsWith("d6")).map((i) => i.status), ["deleted", "updated", "closed"]);
  });
});

describe("how the words of a reply are read", () => {
  const PHRASES = [
    ["deleted", "The Chase account ending 4242 has been deleted from your file.", "deleted"],
    ["removed", "The Chase account ending 4242 was removed from your file.", "deleted"],
    ["no longer report", "The Chase account ending 4242 will no longer report on your file.", "deleted"],
    ["verified", "The Chase account ending 4242 has been verified.", "verified"],
    ["remains", "The Chase account ending 4242 remains on your file.", "verified"],
    ["accurate", "The Chase account ending 4242 is accurate.", "verified"],
    ["updated", "The Chase account ending 4242 was updated.", "updated"],
    ["modified", "The Chase account ending 4242 was modified.", "updated"],
    ["corrected", "The Chase account ending 4242 was corrected.", "updated"],
    ["changed", "The Chase account ending 4242 was changed.", "updated"],
  ];
  const AFTER = { deleted: ["deleted", "R1"], verified: ["escalated", "R2"], updated: ["updated", "R1"] };

  test("each phrase a bureau uses reads as its own answer, advances the item that way and names the language it relied on", async () => {
    for (const [phrase, text, outcome] of PHRASES) {
      const fake = repairFile();
      const { res } = await call({ client_id: CLIENT, text }, fake);
      assert.equal(res.body.result.status, "advanced", phrase);
      assert.deepEqual(res.body.result.parseResult.outcomes, [{ itemId: ITEM_CHASE, outcome, evidence: `${outcome}_language` }], phrase);
      assert.deepEqual([fake.state.items[0].status, fake.state.items[0].round], AFTER[outcome], phrase);
      assert.equal(fake.state.items[0].outcome, outcome, phrase);
    }
  });

  test("when one reply holds two answers, a deletion wins over a verification, and a verification wins over an update", async () => {
    const a = repairFile();
    const ra = await call({ client_id: CLIENT, text: "The Chase account ending 4242 was verified last year but has now been deleted." }, a);
    assert.equal(ra.res.body.result.parseResult.outcomes[0].outcome, "deleted");
    assert.equal(a.state.items[0].status, "deleted");
    const b = repairFile();
    const rb = await call({ client_id: CLIENT, text: "The Chase account ending 4242 was corrected and then verified as accurate." }, b);
    assert.equal(rb.res.body.result.parseResult.outcomes[0].outcome, "verified");
    assert.deepEqual([b.state.items[0].status, b.state.items[0].round], ["escalated", "R2"]);
  });

  test("the confidence is saved with the response, on the row and in the reading: 0.9 for a read that found every account", async () => {
    const fake = repairFile();
    await call({ client_id: CLIENT, text: DELETED }, fake);
    assert.equal(fake.state.responses[0].confidence, 0.9);
    assert.equal(fake.state.responses[0].parse_json.confidence, 0.9);
    assert.equal(fake.state.responses[0].parse_json.needsConfirm, false);
    assert.equal(fake.state.responses[0].confirmed_by, null, "a machine read is not a person");
    const half = repairFile({ items: [item(), item({ id: ITEM_AMEX, creditor: "Amex", account_last4: "1111" })] });
    // The letter names the Chase account far down the page; the Amex account is never named.
    await call({ client_id: CLIENT, text: `${"Thank you for contacting us. ".repeat(20)}${DELETED}` }, half);
    assert.equal(half.state.responses[0].confidence, 0.625, "one of two accounts found");
    assert.equal(half.state.responses[0].confirmed, false);
  });
});

describe("where the repair file goes, and what is written down and sent", () => {
  test("a confident reply that is acted on moves the repair card to round complete and writes the confirmation to the case log", async () => {
    const fake = repairFile();
    await call({ client_id: CLIENT, text: DELETED }, fake);
    assert.equal(fake.state.stageOf(), "round_complete");
    const [d] = decided(fake, "parse.confirmed");
    assert.ok(d, "the confirmation is logged");
    assert.deepEqual([d.org_id, d.client_id, d.case_id], [ORG_ID, CLIENT, CASE]);
    assert.equal(d.payload.confidence, 0.9);
    assert.equal(d.payload.confirmedBy, null);
    assert.equal(d.payload.roundsCap, 6);
    assert.deepEqual(d.payload.log.map((l) => [l.itemId, l.from, l.to, l.outcome]), [[ITEM_CHASE, "sent", "deleted", "deleted"]]);
  });

  test("a bureau that verified the account sends it on: the client is told the next round, and the card still ends on round complete", async () => {
    const fake = repairFile();
    const { res } = await call({ client_id: CLIENT, text: "The Chase account ending 4242 has been verified as accurate." }, fake);
    assert.equal(res.body.result.status, "advanced");
    assert.equal(fake.state.stageOf(), "round_complete", "the response being parsed is the last word on the card");
    const next = queued(fake, "EMAIL-REPAIR-ROUND-ADVANCED");
    assert.equal(next.length, 1, "one next-round email");
    assert.equal(next[0].org_id, ORG_ID);
    assert.equal(next[0].client_id, CLIENT);
    assert.match(next[0].rendered_body, /^Round 2 for:\n• Chase ending 4242 \(Experian\)/);
    const results = queued(fake, "EMAIL-REPAIR-RESPONSE-RESULTS").find((m) => /Chase ending 4242 \(Experian\)/.test(m.rendered_body));
    assert.ok(results, "a results email that names the account");
    assert.match(results.rendered_body, /bureau says they verified it/);
  });

  test("a deletion tells the client the account is no longer listed; nothing about a next round goes out", async () => {
    const fake = repairFile();
    await call({ client_id: CLIENT, text: DELETED }, fake);
    const results = queued(fake, "EMAIL-REPAIR-RESPONSE-RESULTS").find((m) => /Chase ending 4242 \(Experian\)/.test(m.rendered_body));
    assert.ok(results, "a results email that names the account");
    assert.match(results.rendered_body, /no longer listed on that bureau letter/);
    assert.equal(results.client_id, CLIENT);
    assert.equal(queued(fake, "EMAIL-REPAIR-ROUND-ADVANCED").length, 0);
  });

  test("a held read leaves the card on response received, sends the client nothing and advances no item", async () => {
    const fake = repairFile({ items: [item(), item({ id: ITEM_AMEX, creditor: "Amex", account_last4: "1111" })] });
    const { res } = await call({ client_id: CLIENT, text: "Thank you for contacting us. We received your letter." }, fake);
    assert.equal(res.body.result.status, "held");
    assert.equal(fake.state.stageOf(), "response_received");
    assert.equal(fake.state.messages.length, 0);
    assert.equal(fake.state.decisions.length, 0);
  });

  test("a confident read held at the escalation rounds is logged as held for a person with the round it wanted, and nothing is told to the client", async () => {
    const fake = repairFile({ items: [item({ round: "R3", status: "verified" })] });
    const { res } = await call({ client_id: CLIENT, text: "The Chase account ending 4242 has been verified as accurate." }, fake);
    assert.equal(res.body.result.heldForEscalation, true);
    const [d] = decided(fake, "parse.held_escalation_needs_human");
    assert.ok(d, "the hold is logged");
    assert.deepEqual([d.org_id, d.client_id, d.case_id], [ORG_ID, CLIENT, CASE]);
    assert.equal(d.payload.log[0].would_advance_to, "R4");
    assert.equal(d.payload.log[0].held_for_human, true);
    assert.equal(decided(fake, "parse.confirmed").length, 0, "nothing was confirmed");
    assert.equal(fake.state.messages.length, 0, "the client is not told of a round that has not happened");
  });
});

describe("an uploaded reply: what the client is sent", () => {
  const png = Buffer.from("not-a-real-image").toString("base64");

  test("a retake request goes to the client by email with the instructions the reader wrote", async () => {
    modelAnswer = { quality: "retake", text: "", bureau_guess: "unknown", message_to_client: "Please retake the photo with all four corners in the frame." };
    const fake = repairFile();
    await call({ client_id: CLIENT, document_id: DOC, mime_type: "image/jpeg", bytes: png }, fake);
    const [mail] = queued(fake, "EMAIL-REPAIR-RETAKE-PHOTO");
    assert.ok(mail, "a retake email was queued");
    assert.equal(mail.channel, "email");
    assert.equal(mail.client_id, CLIENT);
    assert.equal(mail.provider_ref, `workflow:EMAIL-REPAIR-RETAKE-PHOTO:bureau-retake:${DOC}`);
    assert.equal(mail.rendered_body, "Retake: Please retake the photo with all four corners in the frame.");
    assert.equal(queued(fake, "EMAIL-REPAIR-RESPONSE-RESULTS").length, 0);
  });

  test("a clear upload that is acted on sends the client the results, with the outcome words of this reading", async () => {
    modelAnswer = { quality: "pass", text: DELETED, bureau_guess: "EX", message_to_client: "" };
    const fake = repairFile();
    const { res } = await call({ client_id: CLIENT, document_id: DOC, mime_type: "image/png", bytes: png }, fake);
    assert.equal(res.body.result.status, "advanced");
    const mail = fake.state.messages.find((m) => m.provider_ref === `workflow:EMAIL-REPAIR-RESPONSE-RESULTS:bureau-results:${DOC}`);
    assert.ok(mail, "the results email for this upload");
    assert.equal(mail.client_id, CLIENT);
    assert.match(mail.rendered_body, /deleted/);
    assert.equal(queued(fake, "EMAIL-REPAIR-RETAKE-PHOTO").length, 0);
  });

  test("a clear upload that is only held for a person sends no results email", async () => {
    modelAnswer = { quality: "pass", text: "Thank you for contacting us. We received your letter.", bureau_guess: "EX", message_to_client: "" };
    const fake = repairFile();
    const { res } = await call({ client_id: CLIENT, document_id: DOC, mime_type: "image/png", bytes: png }, fake);
    assert.equal(res.body.result.status, "held");
    assert.equal(fake.state.messages.length, 0);
    assert.equal(fake.state.stageOf(), "response_received");
  });
});
