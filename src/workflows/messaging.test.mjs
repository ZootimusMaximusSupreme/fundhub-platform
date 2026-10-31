import { test } from "node:test";
import assert from "node:assert";
import { sendTemplated, formatAppointmentStart } from "./messaging.mjs";
import { verifyUnsubscribeRequest } from "../messaging/unsubscribe.mjs";

// In-memory DB fake covering message_templates, messages, opt_outs, conversations
// and the client record sendTemplated reads merge-tag context from.
function pgFake({ templates = [], optOuts = [], clients = [], openShift = null, failOn = null, rep = null } = {}) {
  const messages = [];
  const events = [];          // staff_events, the telemetry seam's output
  const conversations = [];   // the thread the Messaging screen lists
  const sql = [];             // every statement issued, so a test can assert one was NOT
  return {
    messages,
    events,
    conversations,
    sql,
    optOuts,
    clients,
    async query(statement, params = []) {
      const sql = statement;
      this.sql.push(String(statement));
      if (failOn && failOn.test(sql)) throw Object.assign(new Error("simulated outage"), { code: "08006" });
      if (/client_authorized_reps/.test(sql)) {
        return { rows: rep ? [rep] : [] };
      }
      if (/SELECT first_name, last_name, email, phone, custom_fields FROM clients/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [c] : [] };
      }
      if (/SELECT body,\s*subject(?:\s*,\s*compliance_passed)?[\s\S]*?FROM message_templates/.test(sql)) {
        const [orgId, key] = params;
        const t = templates.find((t) => t.org_id === orgId && t.template_key === key);
        return { rows: t ? [{ body: t.body, subject: t.subject || null, compliance_passed: !!t.compliance_passed }] : [] };
      }
      if (/SELECT 1 FROM opt_outs/.test(sql)) {
        const r = optOuts.find((o) => o.client_id === params[0] && o.channel === params[1] && !o.opted_in_at);
        return { rows: r ? [{ 1: 1 }] : [] };
      }
      // staff_events before the generic branches: its statement also RETURNINGs.
      if (/INSERT INTO staff_events/.test(sql)) {
        const ev = { staff_id: params[0], org_id: params[1], shift_id: params[2], kind: params[3], detail: JSON.parse(params[4]) };
        events.push(ev);
        return { rows: [{ id: "ev-" + events.length, ...ev }] };
      }
      if (/FROM shifts/.test(sql)) return { rows: openShift ? [{ id: openShift }] : [] };
      if (/INSERT INTO messages/.test(sql)) {
        // ON CONFLICT (org_id, provider_ref) DO NOTHING, modelled: a replay of
        // the same event writes nothing and RETURNS no row.
        const dup = messages.some((m) => m.org_id === params[0] && m.provider_ref === params[5]);
        if (dup) return { rows: [] };
        messages.push({
          id: "msg-" + (messages.length + 1),
          org_id: params[0], client_id: params[1], channel: params[2], template_key: params[3],
          rendered_body: params[4], provider_ref: params[5],
          to_address: params[6],
          created_at: WROTE_AT, conversation_id: null
        });
        const row = messages[messages.length - 1];
        return { rows: [{ id: row.id, created_at: row.created_at }] };
      }
      // The message row a replay deduped against — sendTemplated looks it up so
      // it can still be threaded. See the threading block in messaging.mjs.
      if (/SELECT id, created_at FROM messages WHERE org_id/.test(sql)) {
        const m = messages.find((m) => m.org_id === params[0] && m.provider_ref === params[1]);
        return { rows: m ? [{ id: m.id, created_at: m.created_at }] : [] };
      }
      // conversations — one row per (client_id, channel), the shape
      // uq_conversations_client_channel enforces. GREATEST on the pulse.
      if (/INSERT INTO conversations/.test(sql)) {
        const [orgId, clientId, channel, , pulse] = params;
        let c = conversations.find((c) => c.client_id === clientId && c.channel === channel);
        if (!c) {
          c = { id: "convo-" + (conversations.length + 1), org_id: orgId, client_id: clientId, channel, last_pulse_at: pulse || null };
          conversations.push(c);
        } else if (pulse && (!c.last_pulse_at || pulse > c.last_pulse_at)) {
          c.last_pulse_at = pulse;
        }
        return { rows: [{ ...c }] };
      }
      if (/UPDATE messages m\s*\n?\s*SET conversation_id/.test(sql)) {
        const [messageId, conversationId] = params;
        const m = messages.find((m) => m.id === messageId);
        const c = conversations.find((c) => c.id === conversationId);
        if (!m || !c || c.client_id !== m.client_id || c.org_id !== m.org_id) return { rows: [] };
        m.conversation_id = c.id;
        return { rows: [{ id: m.id }] };
      }
      return { rows: [] };
    }
  };
}

// A fixed write time, so a test can assert the thread pulse is the message's own
// timestamp rather than "now".
const WROTE_AT = "2026-08-27T07:28:33.273Z";

async function quietly(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try { return { value: await fn(), lines }; } finally { console.error = real; }
}

const BASE = { orgId: "org-1", clientId: "cl-1", channel: "sms", eventId: "evt-1" };

const tpl = (key, body) => ({ org_id: "org-1", template_key: key, body, compliance_passed: true });

test("sendTemplated: a linked representative gets the text, and the kid's name stays", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hi {{contact.first_name}}")],
    clients: [{
      id: "cl-1", first_name: "Kid", last_name: "File",
      email: "kid@x.io", phone: "+15551110000", custom_fields: {}
    }],
    rep: { email: "dad@x.io", phone: "+15552220000", name: "Dad" }
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].to_address, "+15552220000");
  assert.equal(db.messages[0].rendered_body, "Hi Kid");
});

test("sendTemplated: normal send queues a message with rendered body", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hi {{first_name}}, apply now!")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { first_name: "Alice" } });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].rendered_body, "Hi Alice, apply now!");
});

test("sendTemplated: opted-out contact is suppressed (not dispatched)", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hi {{first_name}}")],
    optOuts: [{ client_id: "cl-1", channel: "sms", opted_in_at: null }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { first_name: "Alice" } });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "opted_out");
  assert.equal(db.messages.length, 0, "no message row inserted for opted-out contact");
});

test("sendTemplated: opted-in contact (opted_in_at set) sends normally", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey!")],
    optOuts: [{ client_id: "cl-1", channel: "sms", opted_in_at: new Date() }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1);
});

test("sendTemplated: missing template returns template_pending", async () => {
  const db = pgFake({ templates: [] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "GHOST" });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "template_pending");
});

test("sendTemplated: unknown merge token renders blank, send still queued", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Score: {{score}} — {{unknown}}")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { score: "720" } });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Score: 720 — ");
});

// --- merge-tag context off the client record --------------------------------
// THE BUG: every sendTemplated call site in src/workflows passes no `context`, so the
// ported the CRM copy's `{{contact.*}}` tags had nothing to resolve against — and with the
// old TOKEN_RE they rendered literally into live SMS and email.

const client = (over = {}) => ({
  id: "cl-1", first_name: "Alice", last_name: "Nguyen", email: "alice@example.com",
  phone: "+15551234567", custom_fields: {}, ...over
});

test("REGRESSION: {{contact.first_name}} resolves from the client record with no context passed", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}, ready?")], clients: [client()] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Hey Alice, ready?");
});

test("REGRESSION: no merge tag survives into the queued body with braces intact", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}, pre-approved for {{contact.analyzer_prequal_amount}}.")],
    clients: [client({ custom_fields: { analyzer_prequal_amount: 50000 } })]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  const body = db.messages[0].rendered_body;
  assert.equal(body, "Hey Alice, pre-approved for 50000.");
  assert.ok(!body.includes("{{"), "an unrendered merge tag must never reach an outbound body");
});

test("custom_fields are reachable as contact.* — the 252 ported the CRM fields", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "{{contact.business_name}} owes {{contact.total_funding_estimate}}")],
    clients: [client({ custom_fields: { business_name: "Acme LLC", total_funding_estimate: 50000 } })]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.messages[0].rendered_body, "Acme LLC owes 50000");
});

test("identity columns win over a stale same-named custom field", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hi {{contact.first_name}}")],
    clients: [client({ first_name: "Alice", custom_fields: { first_name: "STALE" } })]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.messages[0].rendered_body, "Hi Alice");
});

test("contact.name / contact.full_name compose from the identity columns", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "{{contact.name}} | {{contact.full_name}}")], clients: [client()] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.messages[0].rendered_body, "Alice Nguyen | Alice Nguyen");
});

test("an explicitly passed context still wins over the record, per key", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "{{contact.first_name}} / {{contact.last_name}}")],
    clients: [client()]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { contact: { first_name: "Override" } } });
  assert.equal(db.messages[0].rendered_body, "Override / Nguyen", "override wins, un-overridden keys survive");
});

test("a client row that cannot be loaded renders blank, it does not throw or leak braces", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}!")], clients: [] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Hey !");
});

test("a send with no clientId still renders (no client lookup attempted)", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}!")], clients: [client()] });
  const res = await sendTemplated(db, { ...BASE, clientId: null, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Hey !");
});

test("template_pending short-circuits before the client record is loaded", async () => {
  let loaded = false;
  const db = pgFake({ templates: [], clients: [client()] });
  const inner = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM clients/.test(sql)) loaded = true;
    return inner(sql, params);
  };
  const res = await sendTemplated(db, { ...BASE, templateKey: "GHOST" });
  assert.equal(res.reason, "template_pending");
  assert.equal(loaded, false, "a no-op send must not cost a client query");
});

// =============================================================================
// STAFF TELEMETRY — the `text_sent` seam.
//
// It is EMPTY in production: all 39 call sites of this function are Inngest
// workflows with no staff member, and there is no staff-facing send endpoint in
// the product. These tests pin the seam's shape so the day one is built, the
// row is right — and, more importantly, pin that a workflow send writes NOTHING,
// which is the behaviour every existing caller depends on.
// =============================================================================

const SHIFT = "55555555-5555-4555-8555-555555555555";
const STAFF = "22222222-2222-4222-8222-222222222222";

test("a workflow send — no staffId — never even ATTEMPTS a staff_events write", async () => {
  // The whole of production, and asserted on the statement rather than on the
  // outcome. logStaffEvent() would refuse an absent staff id by itself, so a
  // test that only checks "no row landed" passes with the guard deleted — and
  // 39 workflows would each issue a doomed write and log a failure line per
  // send. What must be true is that the seam is not entered at all.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const { value: res, lines } = await quietly(() => sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" }));
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1, "the message still queues");
  assert.equal(db.events.length, 0, "a workflow has nobody to attribute the send to");
  assert.ok(!db.sql.some((s) => /staff_events/.test(s)),
    "an unattributed telemetry write must not be attempted, not merely refused downstream");
  assert.ok(!db.sql.some((s) => /FROM shifts/.test(s)),
    "and it must not cost a shift lookup for a person who does not exist");
  // The guard's real teeth. Without it logStaffEvent still refuses the write —
  // and logs a skip line for it. Every outbound message in the product goes
  // through here, so that is a warning on every send, forever, about a person
  // who was never supposed to exist. Silence is the requirement.
  assert.deepEqual(lines, [], `a workflow send must be silent, got: ${JSON.stringify(lines)}`);
});

test("a staff-initiated sms writes one text_sent event on that person's shift", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  assert.equal(res.sent, true);
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].kind, "text_sent");
  assert.equal(db.events[0].staff_id, STAFF);
  assert.equal(db.events[0].shift_id, SHIFT);
  assert.equal(db.events[0].detail.template_key, "N-01-SMS");
  assert.equal(db.events[0].detail.client_id, "cl-1");
});

test("an email is not a text — no kind covers it, so none is written", async () => {
  const db = pgFake({ templates: [tpl("F-07-EMAIL", "Funded.")] });
  await sendTemplated(db, { ...BASE, channel: "email", templateKey: "F-07-EMAIL", staffId: STAFF, shiftId: SHIFT });
  assert.equal(db.messages.length, 1, "the email still queues");
  assert.equal(db.events.length, 0, "filing an email under text_sent would make the count a lie");
});

test("a suppressed send writes no event — nothing was sent", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey!")],
    optOuts: [{ client_id: "cl-1", channel: "sms", opted_in_at: null }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  assert.equal(res.sent, false);
  assert.equal(db.events.length, 0);
});

test("a missing template writes no event — nothing was sent", async () => {
  const db = pgFake({ templates: [] });
  await sendTemplated(db, { ...BASE, templateKey: "GHOST", staffId: STAFF, shiftId: SHIFT });
  assert.equal(db.events.length, 0);
});

test("a replayed event queues nothing the second time and counts nothing the second time", async () => {
  // The dedupe index makes the second insert a no-op. Counting it anyway would
  // inflate one person's numbers every time a provider retried.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const args = { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT };
  await sendTemplated(db, args);
  await sendTemplated(db, args);
  assert.equal(db.messages.length, 1, "the dedupe index is what stops the second queue");
  assert.equal(db.events.length, 1, "and the replay must not count as a second text");
});

test("with no shift named, the sender's open shift is looked up", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], openShift: SHIFT });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF });
  assert.equal(db.events[0].shift_id, SHIFT);
});

test("sending off the clock is logged with a NULL shift, not refused", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], openShift: null });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF });
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].shift_id, null);
});

test("a broken telemetry write does NOT fail the send it observes", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], failOn: /INSERT INTO staff_events/ });
  const { value: res, lines } = await quietly(() =>
    sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT })
  );
  assert.equal(res.sent, true, "telemetry took the send down with it");
  assert.equal(db.messages.length, 1, "the message is the record; it must survive a broken observer");
  assert.equal(db.events.length, 0);
  assert.ok(lines.some((l) => /\[telemetry\].*write_failed/.test(l)), JSON.stringify(lines));
});

test("formatAppointmentStart: ISO-Z becomes a human string, not raw ISO", () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const human = formatAppointmentStart(iso, "America/Phoenix");
  assert.notEqual(human, iso);
  assert.doesNotMatch(human, /T\d{2}:\d{2}:\d{2}/);
  assert.match(human, /Aug/);
  assert.match(human, /7:49/);
});

test("sendTemplated: appointment.start_time ISO-Z renders as a human time", async () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const db = pgFake({
    templates: [tpl("SMS-S04-01-CONFIRM", "booked for {{appointment.start_time}}")],
    clients: [{ id: "cl-1", first_name: "Chris", last_name: "S", email: "a@b.com", phone: "+15551234567", custom_fields: {} }]
  });
  await sendTemplated(db, {
    ...BASE,
    templateKey: "SMS-S04-01-CONFIRM",
    context: { appointment: { start_time: iso } }
  });
  const body = db.messages[0].rendered_body;
  assert.notEqual(body, `booked for ${iso}`);
  assert.doesNotMatch(body, /2026-08-23T02:49:58/);
  assert.match(body, /booked for /);
  assert.match(body, /Aug/);
});

test("the rendered body is never copied into the telemetry detail", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Your score is 512 and you were denied.")] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  const detail = JSON.stringify(db.events[0].detail);
  assert.ok(!/512|denied/.test(detail), `client-facing copy leaked into telemetry: ${detail}`);
});

const CONFIRM_EMAIL_BODY = `<table>
  <tr>
    <td>When</td>
    <td>{{appointment.start_time}}</td>
  </tr>
  <tr>
    <td>Where</td>
    <td>{{appointment.meeting_location}}</td>
  </tr>
</table>`;

test("sendTemplated: confirm email omits a blank Where row", async () => {
  const db = pgFake({
    templates: [{
      org_id: "org-1",
      template_key: "EMAIL-S04-01-CONFIRM",
      channel: "email",
      subject: "You're booked",
      body: CONFIRM_EMAIL_BODY,
      compliance_passed: true
    }],
    clients: [{ id: "cl-1", first_name: "Chris", last_name: "S", email: "a@b.com", phone: "+15551234567", custom_fields: {} }]
  });
  await sendTemplated(db, {
    ...BASE,
    channel: "email",
    templateKey: "EMAIL-S04-01-CONFIRM",
    context: { appointment: { start_time: "2026-08-25T20:00:00Z", meeting_location: null } }
  });
  const body = db.messages[0].rendered_body;
  assert.match(body, /When/);
  assert.doesNotMatch(body, />\s*Where\s*</);
});

test("sendTemplated: confirm email keeps Where when a join URL is present", async () => {
  const db = pgFake({
    templates: [{
      org_id: "org-1",
      template_key: "EMAIL-S04-01-CONFIRM",
      channel: "email",
      subject: "You're booked",
      body: CONFIRM_EMAIL_BODY,
      compliance_passed: true
    }],
    clients: [{ id: "cl-1", first_name: "Chris", last_name: "S", email: "a@b.com", phone: "+15551234567", custom_fields: {} }]
  });
  await sendTemplated(db, {
    ...BASE,
    channel: "email",
    templateKey: "EMAIL-S04-01-CONFIRM",
    context: { appointment: { start_time: "2026-08-25T20:00:00Z", meeting_location: "https://meet.example.com/abc" } }
  });
  const body = db.messages[0].rendered_body;
  assert.match(body, />\s*Where\s*</);
  assert.match(body, /https:\/\/meet\.example\.com\/abc/);
});

// =============================================================================
// THE THREAD — why a sent message has to land on one.
//
// api/read/inbox.mjs, the staff Messaging list, reads `conversations`. Every
// send from here used to write conversation_id NULL, so a client whose only
// messages were automatic — the welcome email, the welcome text — had no row on
// that screen at all. Searching their name found nothing while the company had
// already texted them twice. Measured on production 2026-08-27: 600 of 844
// message rows unthreaded, 15 clients invisible.
// =============================================================================

test("a workflow send puts the client on a thread, so Messaging can find them", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.conversations.length, 1, "the send left the client off the Messaging screen");
  assert.equal(db.conversations[0].client_id, "cl-1");
  assert.equal(db.conversations[0].channel, "sms");
  assert.equal(db.messages[0].conversation_id, db.conversations[0].id, "the message is not on the thread");
});

test("the thread's clock is the message's own time, not now()", async () => {
  // A replayed event must not drag an old thread to the top of the inbox.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.conversations[0].last_pulse_at, WROTE_AT);
});

test("two sends on one channel share one thread; the other channel gets its own", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "One"), tpl("N-02-EMAIL", "Two")] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", eventId: "evt-1" });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", eventId: "evt-2" });
  await sendTemplated(db, { ...BASE, channel: "email", templateKey: "N-02-EMAIL", eventId: "evt-3" });
  assert.equal(db.conversations.length, 2, "one thread per (client, channel) — no more, no fewer");
  assert.deepEqual(db.conversations.map((c) => c.channel).sort(), ["email", "sms"]);
});

test("a replay threads the row it deduped against, rather than leaving it loose", async () => {
  // The first send's row is the one that may still be unthreaded — a thread
  // write can fail on its own without failing the send. If the replay skipped
  // threading because it queued nothing, that message would stay off the
  // Messaging screen forever.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  db.messages[0].conversation_id = null;
  db.conversations.length = 0;

  const again = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(again.sent, true);
  assert.equal(db.messages.length, 1, "a replay must still not queue a second message");
  assert.equal(db.conversations.length, 1);
  assert.equal(db.messages[0].conversation_id, db.conversations[0].id, "the replay left the row loose");
});

test("a send with no client writes no thread and says nothing about it", async () => {
  // conversations.client_id is NOT NULL. No client is not a failure to report.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const { value: res, lines } = await quietly(
    () => sendTemplated(db, { ...BASE, clientId: null, templateKey: "N-01-SMS" }));
  assert.equal(res.sent, true);
  assert.equal(db.conversations.length, 0);
  assert.deepEqual(lines, [], `no client is a normal state, got: ${JSON.stringify(lines)}`);
});

test("a thread write that fails does NOT fail the message it observes", async () => {
  // The message row is already committed. A list that could not be updated must
  // never turn into a client who was never told anything.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], failOn: /INSERT INTO conversations/ });
  const { value: res, lines } = await quietly(
    () => sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" }));
  assert.equal(res.sent, true, "the send must survive a threading failure");
  assert.equal(db.messages.length, 1);
  assert.equal(lines.length, 1, "and it must say so once, so the gap is findable");
});

/* GAP 27, measured on the 2026-09-17 live walk. Two clients had their welcome
 * text, their booking confirmation and a pay link all fail with "destination is
 * not an E.164 phone number", because their record holds the number the way the
 * sign-up form typed it — "(661) 605-4248". Twilio refuses that outright.
 * The address is pinned here, and this is the last point it is frozen before a
 * provider sees it, so it is pinned in the shape a provider can dial. */
test("sendTemplated: a phone destination is pinned in international form", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey")],
    clients: [{ id: "cl-1", first_name: "Sim", last_name: "Ten", email: "ten@example.com",
      phone: "(661) 605-4248", custom_fields: {} }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].to_address, "+16616054248");
});

/* A number that cannot be converted is NOT dropped and NOT guessed at. It goes
 * to the provider exactly as it was typed, is rejected there, and the row keeps
 * the error — which is how a bad number stays visible instead of going quiet. */
test("sendTemplated: an unconvertible phone number is kept exactly as typed", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey")],
    clients: [{ id: "cl-1", first_name: "Sim", last_name: "Ten", email: "ten@example.com",
      phone: "not a phone", custom_fields: {} }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].to_address, "not a phone");
});

test("sendTemplated: an email destination is left alone", async () => {
  const db = pgFake({
    templates: [tpl("N-01-EMAIL", "Hey")],
    clients: [{ id: "cl-1", first_name: "Sim", last_name: "Ten", email: "ten@example.com",
      phone: "(661) 605-4248", custom_fields: {} }]
  });
  const res = await sendTemplated(db, { ...BASE, channel: "email", templateKey: "N-01-EMAIL" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].to_address, "ten@example.com");
});

/* N11, measured on live 2026-09-18. EMAIL-NOBOOK-01 and 21 other live email
 * templates end with a line holding {{unsubscribe}}. Nothing supplied that
 * tag, so every send logged "unknown token: {{unsubscribe}}" and the stored
 * copy had a blank line where the link belongs (all 70 stored EMAIL-NOBOOK-01
 * rows, 0 with a link). The tag must render the client's own signed link. */
const UNSUB_SECRET = "unit-test-unsub-secret-0123456789abcdef0123456789";
const NOBOOK_HTML = `<!DOCTYPE html>
<html lang="en"><body style="margin:0;background-color:#F4F4F5;">
<table role="presentation" width="100%"><tr><td>
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
</td></tr></table></body></html>`;
const AX07_PLAIN = " Hi {{contact.first_name}},\n\n fundhub.ai • Funding Intelligence for Entrepreneurs\n\n {{unsubscribe}}";

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k];
  }
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  try { return { value: await fn(), warnings }; } finally {
    console.warn = realWarn;
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const EMAIL = { ...BASE, channel: "email" };
const linkIn = (body) => {
  const m = String(body).match(/https:\/\/fundhub\.ai\/unsubscribe\.html\?[^"\s<]+/);
  return m ? m[0].replace(/&amp;/g, "&") : null;
};

test("REGRESSION N11: {{unsubscribe}} in an HTML email renders the client's signed link", async () => {
  const db = pgFake({ templates: [tpl("EMAIL-NOBOOK-01", NOBOOK_HTML)], clients: [client()] });
  const { value: res, warnings } = await withEnv(
    { UNSUBSCRIBE_TOKEN_SECRET: UNSUB_SECRET, APP_BASE_URL: "https://fundhub.ai" },
    () => sendTemplated(db, { ...EMAIL, templateKey: "EMAIL-NOBOOK-01" }));
  assert.equal(res.sent, true);
  const body = db.messages[0].rendered_body;
  assert.ok(!body.includes("{{"), "no merge tag may survive");
  assert.match(body, /Entrepreneurs<br>\s*<a href="https:\/\/fundhub\.ai\/unsubscribe\.html\?[^"]+"[^>]*>Unsubscribe<\/a><\/p>/,
    "the token's own line must carry a real Unsubscribe link, not a blank");
  const v = verifyUnsubscribeRequest(linkIn(body), { secret: UNSUB_SECRET });
  assert.ok(v, "the link must verify against the signing secret");
  assert.deepEqual([v.orgId, v.clientId, v.channel], ["org-1", "cl-1", "email"]);
  assert.deepEqual(warnings.filter((w) => /unsubscribe/.test(w)), [], `no unknown-token warning: ${warnings}`);
});

test("N11: {{unsubscribe}} in a plain-text email renders 'Unsubscribe: <link>'", async () => {
  const db = pgFake({ templates: [tpl("EMAIL-AX07-FUNDING-PAUSED", AX07_PLAIN)], clients: [client()] });
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: UNSUB_SECRET, APP_BASE_URL: "https://fundhub.ai" },
    () => sendTemplated(db, { ...EMAIL, templateKey: "EMAIL-AX07-FUNDING-PAUSED" }));
  const body = db.messages[0].rendered_body;
  assert.match(body, /\n\n Unsubscribe: https:\/\/fundhub\.ai\/unsubscribe\.html\?\S+$/);
  assert.ok(!body.includes("<a "), "plain copy is escaped later, so no HTML tag goes in");
  assert.ok(verifyUnsubscribeRequest(linkIn(body), { secret: UNSUB_SECRET }));
});

test("N11: a text message never gets an email unsubscribe link", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{unsubscribe}}")], clients: [client()] });
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: UNSUB_SECRET },
    () => sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" }));
  assert.equal(db.messages[0].rendered_body, "Hey ");
});

test("N11: an email template without the tag is rendered exactly as before", async () => {
  const db = pgFake({ templates: [tpl("N-01-EMAIL", "Hi {{contact.first_name}}")], clients: [client()] });
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: UNSUB_SECRET },
    () => sendTemplated(db, { ...EMAIL, templateKey: "N-01-EMAIL" }));
  assert.equal(db.messages[0].rendered_body, "Hi Alice");
});

test("N11: no signing secret — the email still queues, the gap is logged", async () => {
  const db = pgFake({ templates: [tpl("EMAIL-NOBOOK-01", NOBOOK_HTML)], clients: [client()] });
  const { value: res, warnings } = await withEnv(
    { UNSUBSCRIBE_TOKEN_SECRET: null, DOCUMENT_URL_SECRET: null },
    () => sendTemplated(db, { ...EMAIL, templateKey: "EMAIL-NOBOOK-01" }));
  assert.equal(res.sent, true, "a missing secret must not stop the email");
  assert.ok(!db.messages[0].rendered_body.includes("{{"));
  assert.ok(warnings.some((w) => /\{\{unsubscribe\}\} left blank in EMAIL-NOBOOK-01/.test(w)), String(warnings));
});

// Text and email links pick the funding calendar from the saved score answer
// (owner-set 2026-10-30). /apply frames the first calendar for 700-749 or 750+ and the
// second for every other answer; a text link opens in a tab that never saw /apply.
const BOOK_TPL = "Pick a time: {{custom_values.booking_link}}";
async function bookingLinkFor(cf) {
  const db = pgFake({ templates: [tpl("SMS-NOBOOK-01", BOOK_TPL)], clients: [client({ custom_fields: cf })] });
  await withEnv({ SALES_MEET_BOOKING_URL: null }, () => sendTemplated(db, { ...BASE, templateKey: "SMS-NOBOOK-01" }));
  return db.messages[0].rendered_body.replace("Pick a time: ", "");
}

test("a 700+ score answer gets the first calendar, marked q", async () => {
  assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: "750+" }), "https://apply.fundhub.ai/funding-book-call?fh_tier=q");
  assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: "700-749" }), "https://apply.fundhub.ai/funding-book-call?fh_tier=q");
  assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: 1234567, cf_svy_self_reported_fico_label: "700-749" }),
    "https://apply.fundhub.ai/funding-book-call?fh_tier=q", "the saved label wins over a ClickFunnels option id");
});

test("every other score answer, Not sure too, gets the second calendar, marked u", async () => {
  for (const band of ["650-699", "580-649", "500-579", "Not sure"]) {
    assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: band }),
      "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u", band);
  }
});

test("no readable score answer keeps today's link with no mark", async () => {
  assert.equal(await bookingLinkFor({}), "https://apply.fundhub.ai/funding-book-call");
  assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: "" }), "https://apply.fundhub.ai/funding-book-call");
  assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: 1234567 }), "https://apply.fundhub.ai/funding-book-call",
    "a ClickFunnels option id is not a band, so no calendar is guessed");
});

test("a link saved on the lead's file still wins over the score", async () => {
  assert.equal(await bookingLinkFor({ cf_svy_self_reported_fico: "580-649", calendar_booking_link: "https://example.com/own" }),
    "https://example.com/own");
});

test("the score never rides in the link, only the one-letter mark", async () => {
  const link = await bookingLinkFor({ cf_svy_self_reported_fico: "580-649" });
  assert.ok(!/580|649|unqualified|score|credit/i.test(link), link);
});
