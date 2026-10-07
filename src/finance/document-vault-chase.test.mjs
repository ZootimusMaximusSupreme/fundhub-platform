// The vault's chase: the plan (one ask per window, three asks per line, then a
// person, nothing once complete) and the runner that enqueues through
// money_agent_tasks. Stubbed db; send and createTask are spies, so nothing is sent.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planChase, askContext, runVaultChase, sendAsk, closeStaleAsks, slotOfTaskKey, askTaskKey,
  ASK_STEPS, MAX_ASKS, TEMPLATE_KEYS, TASK_SOURCE, STAFF_SOURCE, REVIEW_SOURCE, REVIEW_TASK_ROLE, BRAIN, QUIET_HOURS
} from "./document-vault-chase.mjs";
import { buildVault } from "./document-vault.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const BIZ_A = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-07T16:45:00Z");

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const doc = (subtype, over = {}) => ({
  id: uuid(), kind: "client_upload", subtype, title: subtype, generated_at: "2026-09-01T10:00:00Z",
  expires_at: null, metadata: {}, ...over
});
const review = (d, over = {}) => ({
  document_id: d.id, status: "accepted", item_key: null, entity_id: null, covers: 1, period_end: null,
  reason: null, reviewed_at: "2026-09-02T10:00:00Z", reviewed_by_name: null, ...over
});
const core = (o = {}) => buildVault({ env: {}, now: NOW, ...o });
const ask = (slot, createdAt, status = "done") => ({ task_key: `vault:${slot}`, status, created_at: createdAt });
const plan = (c, asks = [], facts = {}, env = {}) => planChase({ core: c, asks, facts, now: NOW, env });

describe("the ladder is three constants, then a person", () => {
  test("a text, an email, a text — and no fourth ask can be written", () => {
    assert.deepEqual(ASK_STEPS.map((s) => [s.rung, s.channel, s.templateKey]), [
      [1, "sms", "SMS-VAULT-ASK-1"], [2, "email", "EMAIL-VAULT-ASK-2"], [3, "sms", "SMS-VAULT-ASK-3"]
    ]);
    assert.equal(MAX_ASKS, 3);
    assert.deepEqual([...TEMPLATE_KEYS], ["SMS-VAULT-ASK-1", "EMAIL-VAULT-ASK-2", "SMS-VAULT-ASK-3"]);
    assert.ok(Object.isFrozen(ASK_STEPS));
  });

  test("the task key is the line's own, and reads back", () => {
    assert.equal(askTaskKey("id_document:client"), "vault:id_document:client");
    assert.equal(slotOfTaskKey("vault:ein_letter:11111111-1111-4111-8111-111111111111"), "ein_letter:11111111-1111-4111-8111-111111111111");
    assert.equal(slotOfTaskKey("something:else"), null);
    assert.match(askTaskKey(`bank_statements_business:${BIZ_A}`), /^[a-z][a-z0-9_-]{0,40}:[A-Za-z0-9:._-]{1,200}$/, "must satisfy money_agent_tasks_task_key_check");
    assert.match(askTaskKey("bank_statements_business:business"), /^[a-z][a-z0-9_-]{0,40}:[A-Za-z0-9:._-]{1,200}$/);
  });
});

describe("planning an ask", () => {
  test("a complete vault asks for nothing", () => {
    const ds = [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")];
    const p = plan(core({ documents: ds, reviews: new Map(ds.map((d) => [d.id, review(d)])) }));
    assert.equal(p.reason, "complete");
    assert.equal(p.ask, null);
    assert.equal(p.csm, null);
  });

  test("a vault whose only gaps are files waiting for review is not the client's to chase", () => {
    const ds = [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")];
    const p = plan(core({ documents: ds }));
    assert.equal(p.reason, "waiting_on_review");
    assert.equal(p.ask, null);
  });

  test("a fresh client is asked about ONE line — the first open one — by text, and told how many come after", () => {
    const p = plan(core());
    assert.equal(p.reason, "ask_1");
    assert.deepEqual(
      [p.ask.slot, p.ask.rung, p.ask.channel, p.ask.templateKey, p.ask.more],
      ["id_document:client", 1, "sms", "SMS-VAULT-ASK-1", 2]
    );
  });

  test("it skips the lines that are done and the ones waiting on us", () => {
    const id = doc("id_document");
    const addr = doc("proof_of_address");
    const p = plan(core({ documents: [id, addr], reviews: new Map([[id.id, review(id)]]) }));
    assert.equal(p.ask.slot, "tax_returns_personal:client", "ID is accepted, address is waiting on review");
    assert.equal(p.ask.more, 0);
  });

  test("a rejected line and an expired line are asked again", () => {
    const bad = doc("id_document");
    const p = plan(core({ documents: [bad], reviews: new Map([[bad.id, review(bad, { status: "rejected", reason: "blurry" })]]) }));
    assert.equal(p.ask.slot, "id_document:client");
    assert.equal(p.ask.status, "rejected");
  });

  test("ONE ASK PER CLIENT PER WINDOW, counted in calendar days (a cron a minute early still counts the day)", () => {
    const c = core();
    assert.equal(plan(c, [ask("id_document:client", "2026-10-06T16:45:00Z")]).reason, "asked_recently");
    assert.equal(plan(c, [ask("id_document:client", "2026-10-05T16:45:00Z")]).reason, "asked_recently");
    const day3 = plan(c, [ask("id_document:client", "2026-10-04T16:46:30Z")]);
    assert.equal(day3.reason, "ask_2", "three calendar days later is due even though it is 71h58m by the clock");
    assert.equal(day3.ask.channel, "email");
    assert.equal(day3.ask.slot, "id_document:client");
  });

  test("an ask about ANOTHER line counts toward the same window: the client is not texted twice", () => {
    const c = core();
    assert.equal(plan(c, [ask("tax_returns_personal:client", "2026-10-06T16:45:00Z")]).reason, "asked_recently");
  });

  test("the window can be moved with DOCUMENT_VAULT_ASK_EVERY_DAYS", () => {
    const c = core();
    const asks = [ask("id_document:client", "2026-10-04T16:45:00Z")];
    assert.equal(plan(c, asks, {}, { DOCUMENT_VAULT_ASK_EVERY_DAYS: "5" }).reason, "asked_recently");
    assert.equal(plan(c, asks, {}, { DOCUMENT_VAULT_ASK_EVERY_DAYS: "2" }).reason, "ask_2");
  });

  test("the second ask is the email and the third is a text, on the same line", () => {
    const c = core();
    const two = plan(c, [ask("id_document:client", "2026-09-28T16:45:00Z"), ask("id_document:client", "2026-10-01T16:45:00Z")]);
    assert.deepEqual([two.ask.slot, two.ask.rung, two.ask.channel], ["id_document:client", 3, "sms"]);
  });

  test("after three asks the line is handed to a person, and while that happens the client is NOT also texted about something else", () => {
    const c = core();
    const asks = ["2026-09-22", "2026-09-25", "2026-09-28"].map((d) => ask("id_document:client", `${d}T16:45:00Z`));
    const p = plan(c, asks);
    assert.deepEqual(p.csm.slots, ["id_document:client"]);
    assert.deepEqual(p.csm.labels, ["Government photo ID"]);
    assert.equal(p.csm.cycle, "2026-09-28");
    assert.equal(p.ask, null);
    assert.equal(p.reason, "handed_to_a_person");
  });

  test("once a CSM has dealt with that round the chase goes on with the NEXT line, so it never stalls — and never makes the same hand-off twice", () => {
    const c = core();
    const asks = ["2026-09-22", "2026-09-25", "2026-09-28"].map((d) => ask("id_document:client", `${d}T16:45:00Z`));
    const p = plan(c, asks, { handoffs: ["2026-09-28"], openStaffTask: false });
    assert.equal(p.csm, null, "that round already had its task");
    assert.deepEqual([p.ask.slot, p.ask.rung], ["proof_of_address:client", 1]);
    assert.equal(p.counts.exhausted, 1, "the ID line stays used up: it is never asked a fourth time");
  });

  test("a LATER line running out opens a new round for a person", () => {
    const c = core();
    const id = ["2026-09-01", "2026-09-04", "2026-09-07"].map((d) => ask("id_document:client", `${d}T16:45:00Z`));
    const poa = ["2026-09-10", "2026-09-13", "2026-09-16"].map((d) => ask("proof_of_address:client", `${d}T16:45:00Z`));
    const p = plan(c, [...id, ...poa], { handoffs: ["2026-09-07"] });
    assert.equal(p.csm.cycle, "2026-09-16");
    assert.deepEqual(p.csm.labels.sort(), ["Government photo ID", "Proof of current address"]);
    assert.equal(p.ask, null);
  });

  test("the hand-off waits out the window after the third ask, like every other step", () => {
    const c = core();
    const asks = ["2026-10-01", "2026-10-04", "2026-10-06"].map((d) => ask("id_document:client", `${d}T16:45:00Z`));
    const p = plan(c, asks);
    assert.equal(p.csm, null);
    assert.equal(p.reason, "asked_recently");
  });

  test("every line used up: a person first, then the chase has nothing left to say", () => {
    const c = core();
    const d = ["2026-09-01", "2026-09-04", "2026-09-07"];
    const asks = ["id_document:client", "proof_of_address:client", "tax_returns_personal:client"].flatMap((slot) =>
      d.map((day) => ask(slot, `${day}T16:45:00Z`)));
    const first = plan(c, asks);
    assert.equal(first.ask, null);
    assert.equal(first.reason, "handed_to_a_person");
    assert.equal(first.csm.slots.length, 3);
    assert.equal(first.counts.exhausted, 3);
    const after = plan(c, asks, { handoffs: ["2026-09-07"] });
    assert.equal(after.ask, null);
    assert.equal(after.csm, null);
    assert.equal(after.reason, "ladder_done");
  });

  test("files waiting for review tell a PERSON: one task at a time, never the client", () => {
    const id = doc("id_document");
    const c = core({ documents: [id] });   // uploaded, nobody has accepted it
    const p = plan(c);
    assert.deepEqual(p.review.labels, ["Government photo ID"]);
    assert.deepEqual(p.review.slots, ["id_document:client"]);
    assert.equal(p.ask.slot, "proof_of_address:client", "the client is still asked for what is missing");
    assert.equal(plan(c, [], { openReviewTask: true }).review, null, "one open at a time");
    const allWaiting = core({ documents: [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")] });
    const w = plan(allWaiting);
    assert.equal(w.reason, "waiting_on_review");
    assert.equal(w.ask, null);
    assert.equal(w.review.labels.length, 3);
    assert.equal(plan(core()).review, null, "nothing waiting, nothing to review");
    assert.equal(plan(c, [], { escalated: true }).review.labels.length, 1, "an escalation stops messages to the client, not staff looking at a file");
    assert.equal(REVIEW_TASK_ROLE, "admin");
  });

  test("a person already on it (an open CSM task from the chase) stops all messages", () => {
    const asks = ["2026-09-01", "2026-09-04", "2026-09-07"].map((d) => ask("id_document:client", `${d}T16:45:00Z`));
    const p = plan(core(), asks, { openStaffTask: true });
    assert.equal(p.reason, "a_person_has_this");
    assert.equal(p.ask, null);
    assert.equal(p.csm, null, "one person at a time: no second task while one is open");
  });

  test("an escalation on file (a lawyer, a threat) means nothing at all", () => {
    const p = plan(core(), [], { escalated: true });
    assert.equal(p.reason, "escalation_on_file");
    assert.equal(p.ask, null);
    assert.equal(p.csm, null);
  });

  test("a message already sent on that channel today, by anyone, holds the ask until tomorrow", () => {
    assert.equal(plan(core(), [], { recent: { sms: true, email: false } }).reason, "recent_message");
    const email = plan(core(), [ask("id_document:client", "2026-10-04T16:45:00Z")], { recent: { sms: true, email: false } });
    assert.equal(email.ask.channel, "email", "rung 2 is an email, and a recent TEXT does not block it");
    assert.equal(plan(core(), [ask("id_document:client", "2026-10-04T16:45:00Z")], { recent: { sms: false, email: true } }).reason, "recent_message");
    assert.equal(QUIET_HOURS, 20);
  });

  test("a file that arrives ends the round: asks are counted from the newest file on that line", () => {
    const stale = doc("business_bank_statement", { generated_at: "2026-09-30T10:00:00Z", metadata: { entity_id: BIZ_A } });
    const c = core({
      scopes: [{ kind: "business", id: BIZ_A, name: "Alpha LLC" }],
      documents: [stale],
      reviews: new Map([[stale.id, review(stale, { period_end: "2026-06-01" })]])
    });
    const slot = `bank_statements_business:${BIZ_A}`;
    const open = c.items.find((i) => i.slot === slot);
    assert.equal(open.status, "expired");
    // Three asks, all BEFORE the file arrived: that was a different round.
    const before = ["2026-09-01", "2026-09-04", "2026-09-07"].map((d) => ask(slot, `${d}T16:45:00Z`));
    const idAsks = ["2026-10-01", "2026-10-02"].map((d) => ask("id_document:client", `${d}T16:45:00Z`));
    const p = plan(c, [...before, ...idAsks.slice(0, 0)]);
    assert.equal(p.csm, null, "asks before the newest file do not count toward the cap");
    assert.equal(p.ask.slot, "id_document:client", "ID is first in line and has no asks");
  });

  test("the ask names the business when there is one, and the count of what comes after", () => {
    const c = core({ scopes: [{ kind: "business", id: BIZ_A, name: "Alpha LLC" }], waivers: [
      { item_key: "id_document", entity_id: null, note: "x" }, { item_key: "proof_of_address", entity_id: null, note: "x" },
      { item_key: "tax_returns_personal", entity_id: null, note: "x" }
    ] });
    const p = plan(c);
    assert.equal(p.ask.slot, `bank_statements_business:${BIZ_A}`);
    assert.equal(p.ask.more, 4);
    const ctx = askContext(c, p.ask);
    assert.equal(ctx.what, "your last 3 months of business bank statements for Alpha LLC");
    assert.equal(ctx.more_phrase, " After that, 4 more documents.");
  });
});

describe("the words in a message", () => {
  test("the email lists every open line, with business names escaped", () => {
    const c = core({ scopes: [{ kind: "business", id: BIZ_A, name: "Tom & <Jerry> \"LLC\"" }] });
    const ctx = askContext(c, plan(c).ask);
    assert.match(ctx.list_html, /^<ul /);
    assert.match(ctx.list_html, /Tom &amp; &lt;Jerry&gt; &quot;LLC&quot;/);
    assert.ok(!ctx.list_html.includes("<Jerry>"));
    assert.equal((ctx.list_html.match(/<li>/g) || []).length, 8);
  });

  test("a rejected paper's reason travels with the ask, so the client knows what to fix", () => {
    const bad = doc("id_document");
    const c = core({ documents: [bad], reviews: new Map([[bad.id, review(bad, { status: "rejected", reason: "Photo is cut off" })]]) });
    const ctx = askContext(c, plan(c).ask);
    assert.equal(ctx.what, "a photo of your driver's license or passport (the last copy could not be used: Photo is cut off)");
  });

  test("a long reject reason is clipped so a text stays a text", () => {
    const bad = doc("id_document");
    const long = "The photo is cut off at the bottom and the glare hides the address. ".repeat(6);
    const c = core({ documents: [bad], reviews: new Map([[bad.id, review(bad, { status: "rejected", reason: long })]]) });
    const what = askContext(c, plan(c).ask).what;
    assert.ok(what.length < 230, `${what.length} characters`);
    assert.match(what, /…\)$/);
  });

  test("an out-of-date paper is asked for again as out of date, not as if it had never been sent", () => {
    const old = doc("business_bank_statement", { generated_at: "2026-01-05T10:00:00Z", metadata: { entity_id: BIZ_A } });
    const c = core({
      scopes: [{ kind: "business", id: BIZ_A, name: "Alpha LLC" }],
      documents: [old], reviews: new Map([[old.id, review(old, { covers: 3 })]]),
      waivers: ["id_document", "proof_of_address", "tax_returns_personal"].map((k) => ({ item_key: k, entity_id: null, note: "x" }))
    });
    const p = plan(c);
    assert.equal(p.ask.status, "expired");
    assert.equal(askContext(c, p.ask).what, "your last 3 months of business bank statements for Alpha LLC (the ones we have are too old now)");
  });

  test("one more is 'document', not 'documents'", () => {
    const c = core({ waivers: [{ item_key: "tax_returns_personal", entity_id: null, note: "x" }] });
    assert.equal(askContext(c, plan(c).ask).more_phrase, " After that, 1 more document.");
  });

  test("the last open line has no 'after that' sentence", () => {
    const c = core({ waivers: [
      { item_key: "proof_of_address", entity_id: null, note: "x" }, { item_key: "tax_returns_personal", entity_id: null, note: "x" }
    ] });
    assert.equal(askContext(c, plan(c).ask).more_phrase, "");
  });
});

/* ───────────────────────────── the runner ───────────────────────────── */

function stubDb(state = {}) {
  const s = {
    client: { id: CLIENT, first_name: "Sim", last_name: "Eleven" },
    containers: [], businesses: [], documents: [], reviews: [], items: [], ident: null,
    asks: [], escalated: false, openStaff: false, recent: [], csm: null, insertConflict: false,
    ...state
  };
  const calls = [];
  return {
    calls, state: s,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        if (/assigned_csm_staff_id/.test(sql)) return { rows: [{ assigned_csm_staff_id: s.csm }] };
        return { rows: s.client ? [s.client] : [] };
      }
      if (/FROM entities/.test(sql)) return { rows: s.containers };
      if (/FROM businesses/.test(sql)) return { rows: s.businesses };
      if (/FROM documents/.test(sql)) return { rows: s.documents };
      if (/FROM document_vault_reviews/.test(sql)) return { rows: s.reviews };
      if (/FROM document_vault_items/.test(sql)) return { rows: s.items };
      if (/FROM pii_identity/.test(sql)) return { rows: s.ident ? [s.ident] : [] };
      if (/FROM money_agent_tasks/.test(sql)) return { rows: s.asks };
      if (/FROM client_escalations/.test(sql)) return { rows: s.escalated ? [{ "?column?": 1 }] : [] };
      if (/FROM tasks/.test(sql)) {
        const rows = s.staffTasks || (s.openStaff ? [{ source_workflow: STAFF_SOURCE, body: "x", done: false }] : []);
        return { rows };
      }
      if (/FROM messages/.test(sql)) return { rows: s.recent.map((channel) => ({ channel })) };
      if (/INSERT INTO money_agent_tasks/.test(sql)) return { rows: s.insertConflict ? [] : [{ id: "ask-1" }] };
      if (/SET status = 'failed'/.test(sql)) return { rows: s.staleRows || [] };
      return { rows: [] };
    }
  };
}
const writes = (db) => db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));
const finishCall = (db) => db.calls.find((c) => /SET status = \$2/.test(c.sql));

function spies(sendResult = { sent: true }) {
  const sent = [];
  const tasks = [];
  return {
    sent, tasks,
    send: async (_db, args) => { sent.push(args); if (sendResult instanceof Error) throw sendResult; return sendResult; },
    createTask: async (_db, args) => { tasks.push(args); return { created: true, id: "task-1" }; }
  };
}
const go = (db, sp, over = {}) => runVaultChase(db, { orgId: ORG, clientId: CLIENT, now: NOW, env: {}, send: sp.send, createTask: sp.createTask, ...over });

describe("runVaultChase", () => {
  test("a first ask: one row enqueued, claimed, worked, finished — and one queued text", async () => {
    const db = stubDb();
    const sp = spies();
    const r = await go(db, sp);
    assert.equal(r.reason, "ask_1");
    assert.deepEqual([r.ask.asked, r.ask.rung, r.ask.channel, r.ask.templateKey], [true, 1, "sms", "SMS-VAULT-ASK-1"]);

    const insert = db.calls.find((c) => /INSERT INTO money_agent_tasks/.test(c.sql));
    assert.match(insert.sql, /'other'/, "kind other: there is no document kind in the contract");
    assert.match(insert.sql, /'agent', 'claimed'/, "born claimed: never visible to the money helper's claim of 'queued' rows");
    assert.ok(!/'queued'/.test(insert.sql), "the row is never queued");
    assert.equal(insert.params[2], "vault:id_document:client");
    assert.equal(insert.params[3], "Send a photo of your driver's license or passport");
    assert.equal(insert.params[5], TASK_SOURCE);
    assert.equal(insert.params[6], BRAIN, "claimed_by");
    assert.deepEqual(JSON.parse(insert.params[7]), {
      vault: true, slot: "id_document:client", item_key: "id_document", rung: 1, channel: "sms",
      status_at_ask: "missing", need: 1, have: 0, requested_by: "doc-vault"
    });
    assert.ok(!db.calls.some((c) => /SET status = 'claimed'/.test(c.sql)), "there is no separate claim step to race");

    assert.equal(sp.sent.length, 1);
    assert.equal(sp.sent[0].channel, "sms");
    assert.equal(sp.sent[0].templateKey, "SMS-VAULT-ASK-1");
    assert.equal(sp.sent[0].eventId, "vault-ask:ask-1");
    assert.equal(sp.sent[0].context.vault.what, "a photo of your driver's license or passport");
    assert.equal(sp.sent[0].context.vault.more_phrase, " After that, 2 more documents.");

    const fin = finishCall(db);
    assert.equal(fin.params[1], "done");
    assert.deepEqual(JSON.parse(fin.params[2]), { asked: true, queued: true, rung: 1, channel: "sms", template: "SMS-VAULT-ASK-1" });
  });

  test("a dry run reads and plans and writes NOTHING and sends NOTHING", async () => {
    const db = stubDb();
    const sp = spies();
    const r = await go(db, sp, { dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.plan.ask.slot, "id_document:client");
    assert.equal(writes(db).length, 0);
    assert.equal(sp.sent.length, 0);
    assert.equal(sp.tasks.length, 0);
  });

  test("a complete vault reads nothing about asks and asks for nothing", async () => {
    const ds = [doc("id_document"), doc("proof_of_address"), doc("tax_return"), doc("tax_return")];
    const db = stubDb({ documents: ds, reviews: ds.map((d) => review(d)) });
    const sp = spies();
    const r = await go(db, sp);
    assert.equal(r.reason, "complete");
    assert.equal(r.vault.complete, true);
    assert.equal(writes(db).length, 0);
    assert.ok(!db.calls.some((c) => /money_agent_tasks/.test(c.sql)));
    assert.equal(sp.sent.length, 0);
  });

  test("the same day twice asks once: the first ask is on the books", async () => {
    const db = stubDb({ asks: [{ task_key: "vault:id_document:client", status: "done", created_at: "2026-10-07T16:45:03Z" }] });
    const sp = spies();
    const r = await go(db, sp);
    assert.equal(r.reason, "asked_recently");
    assert.equal(sp.sent.length, 0);
    assert.equal(writes(db).filter((w) => /INSERT INTO money_agent_tasks/.test(w.sql)).length, 0);
  });

  test("another scheduler holding the line's open row means this pass does not ask", async () => {
    const db = stubDb({ insertConflict: true });
    const sp = spies();
    const r = await go(db, sp);
    assert.deepEqual(r.ask, { asked: false, reason: "already_open" });
    assert.equal(sp.sent.length, 0);
  });

  test("a client who cannot be messaged leaves a cancelled row that still counts as an attempt", async () => {
    const db = stubDb();
    const sp = spies({ sent: false, reason: "opted_out" });
    const r = await go(db, sp);
    assert.deepEqual([r.ask.asked, r.ask.reason], [false, "opted_out"]);
    const fin = finishCall(db);
    assert.equal(fin.params[1], "cancelled");
    assert.equal(JSON.parse(fin.params[2]).reason, "opted_out");
  });

  test("a template nobody has approved is a cancelled row too, not a crash", async () => {
    const db = stubDb();
    const r = await go(db, spies({ sent: false, reason: "template_pending" }));
    assert.equal(r.ask.reason, "template_pending");
    assert.equal(finishCall(db).params[1], "cancelled");
  });

  test("a send that throws leaves a FAILED row, so the line is never stuck open", async () => {
    const db = stubDb();
    const r = await go(db, spies(new Error("provider down")));
    assert.deepEqual([r.ask.asked, r.ask.reason], [false, "send_failed"]);
    const fin = finishCall(db);
    assert.equal(fin.params[1], "failed");
    assert.match(JSON.parse(fin.params[2]).error, /provider down/);
  });

  test("a pass first closes any vault ask still open after an hour, so one crash cannot silence a line forever", async () => {
    const db = stubDb({ staleRows: [{ id: "old" }] });
    await go(db, spies());
    const stale = db.calls.find((c) => /SET status = 'failed'/.test(c.sql));
    assert.ok(stale, "the stale closer ran");
    assert.match(stale.sql, /status IN \('queued', 'claimed'\)/);
    assert.ok(db.calls.indexOf(stale) < db.calls.findIndex((c) => /FROM money_agent_tasks/.test(c.sql) && /SELECT/.test(c.sql)),
      "it runs before the asks are read");
    const dry = stubDb();
    await go(dry, spies(), { dryRun: true });
    assert.ok(!dry.calls.some((c) => /SET status = 'failed'/.test(c.sql)), "a dry run never writes");
    assert.equal(await closeStaleAsks(stubDb({ staleRows: [{ id: 1 }, { id: 2 }] }), { orgId: ORG, clientId: CLIENT, now: NOW }), 2);
  });

  test("three asks and a quiet window: one task for the client's CSM listing what is open — and no text that day", async () => {
    const asks = ["2026-09-22", "2026-09-25", "2026-09-28"].map((d) => ({
      task_key: "vault:id_document:client", status: "done", created_at: `${d}T16:45:00Z`
    }));
    const db = stubDb({ asks, csm: "6ec4e592-4e60-4501-a3ee-ecc2b4b88146" });
    const sp = spies();
    const r = await go(db, sp);
    assert.equal(sp.tasks.length, 1);
    const t = sp.tasks[0];
    assert.equal(t.sourceWorkflow, STAFF_SOURCE);
    assert.equal(t.assigneeRole, "csm");
    assert.equal(t.assigneeStaffId, "6ec4e592-4e60-4501-a3ee-ecc2b4b88146");
    assert.equal(t.body, `vault-csm:${CLIENT}:2026-09-28`);
    assert.equal(t.eventId, t.body, "the dedupe key: the same round is one task, however many passes see it");
    assert.match(t.detail, /Asked three times with no new file\. Still open: Government photo ID\./);
    assert.match(t.detail, /Document vault: 0 of 3 items done/);
    assert.deepEqual(r.csm, { created: true, taskId: "task-1", key: t.body });
    // While a person is being handed the client, the chase says nothing more.
    assert.equal(r.ask, null);
    assert.equal(r.reason, "handed_to_a_person");
    assert.equal(sp.sent.length, 0);
    assert.equal(db.calls.filter((c) => /INSERT INTO money_agent_tasks/.test(c.sql)).length, 0);
  });

  test("the next pass, with that task still open, says nothing; once the CSM closes it the chase asks the next line", async () => {
    const asks = ["2026-09-22", "2026-09-25", "2026-09-28"].map((d) => ({
      task_key: "vault:id_document:client", status: "done", created_at: `${d}T16:45:00Z`
    }));
    const key = `vault-csm:${CLIENT}:2026-09-28`;
    const open = stubDb({ asks, staffTasks: [{ source_workflow: STAFF_SOURCE, body: key, done: false }] });
    const sp1 = spies();
    const r1 = await go(open, sp1);
    assert.equal(r1.reason, "a_person_has_this");
    assert.equal(sp1.sent.length + sp1.tasks.length, 0);

    const closed = stubDb({ asks, staffTasks: [{ source_workflow: STAFF_SOURCE, body: key, done: true }] });
    const sp2 = spies();
    const r2 = await go(closed, sp2);
    assert.equal(sp2.tasks.length, 0, "that round already had its task: not made twice");
    assert.equal(r2.ask.asked, true);
    assert.equal(sp2.sent[0].context.vault.what, "a recent utility bill or bank statement with your name and address");
    assert.equal(sp2.sent[0].templateKey, "SMS-VAULT-ASK-1", "the next line starts at its own first ask");
  });

  test("an upload waiting for review opens ONE task for the role that can accept it, and the next pass opens no second", async () => {
    const id = doc("id_document");
    const db = stubDb({ documents: [id] });
    const sp = spies();
    const r = await go(db, sp);
    assert.equal(sp.tasks.length, 1);
    const t = sp.tasks[0];
    assert.equal(t.title, "Documents are waiting for your review");
    assert.equal(t.sourceWorkflow, REVIEW_SOURCE);
    assert.equal(t.assigneeRole, REVIEW_TASK_ROLE);
    assert.equal(t.body, `vault-review:${CLIENT}:2026-10-07`);
    assert.equal(t.eventId, t.body);
    assert.match(t.detail, /^Uploaded and not yet accepted or rejected: Government photo ID\. Open the client's document vault/);
    assert.deepEqual(r.review, { created: true, taskId: "task-1", key: t.body });
    assert.equal(r.ask.asked, true, "and the missing papers are still asked for");

    const open = stubDb({ documents: [id], staffTasks: [{ source_workflow: REVIEW_SOURCE, body: t.body, done: false }] });
    const sp2 = spies();
    const r2 = await go(open, sp2);
    assert.equal(sp2.tasks.length, 0);
    assert.equal(r2.review, null);
  });

  test("a dry run says it would open a review task but opens none", async () => {
    const db = stubDb({ documents: [doc("id_document")] });
    const sp = spies();
    const r = await go(db, sp, { dryRun: true });
    assert.deepEqual(r.plan.review.labels, ["Government photo ID"]);
    assert.equal(sp.tasks.length, 0);
  });

  test("a client who has been escalated gets nothing, not even a hand-off task", async () => {
    const db = stubDb({ escalated: true });
    const sp = spies();
    const r = await go(db, sp);
    assert.equal(r.reason, "escalation_on_file");
    // The one write is the stale-row sweep, which changes nothing here: no ask, no task, no message.
    assert.deepEqual(writes(db).filter((w) => !/SET status = 'failed'/.test(w.sql)), []);
    assert.equal(sp.sent.length + sp.tasks.length, 0);
  });

  test("a client not in this org is reported, not chased", async () => {
    const db = stubDb({ client: null });
    assert.deepEqual(await go(db, spies()), { ok: false, reason: "no_client" });
    assert.deepEqual(await runVaultChase(db, { orgId: ORG, clientId: "nope" }), { ok: false, reason: "missing_ids" });
  });

  test("sendAsk is exported for the sweeper tests and refuses nothing it was not asked", async () => {
    const db = stubDb();
    const sp = spies();
    const c = core();
    const out = await sendAsk(db, { orgId: ORG, clientId: CLIENT, core: c, ask: plan(c).ask, now: NOW, send: sp.send });
    assert.equal(out.asked, true);
    assert.equal(sp.sent.length, 1);
  });
});
