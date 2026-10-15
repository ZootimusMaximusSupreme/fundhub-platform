// Batch 04 test data. For each saved-result query: rows that are healthy, and
// three lists of changes to them.
//
//   breaks      change ONE thing a person would call wrong. The query must then
//               count exactly that result as bad (bad_count goes from 0 to 1).
//   okVariants  change something that looks odd but is right. Still counted,
//               still not bad.
//   ignored     rows the query must not count at all (another kind, a demo row,
//               older than 30 days).
//
// A break may carry a third value, { sample, bad }, when one change legitimately
// touches more than one saved result. The company's rows are also copied into
// another company, which the query must never see.
// Shared by fin-b04-display-results.test.mjs. Fake ids and fake words only.

import {
  PORTAL_MESSAGE_SQL, PORTAL_CALL_REQUEST_SQL, PUSH_DEVICE_SQL, STAFF_MESSAGE_SQL,
  CHAT_WIDGET_SQL, MESSAGE_BLOCKED_SQL, MESSAGE_HELD_SQL, THREAD_LINK_SQL
} from "./fin-b04-sql-messages.mjs";
import {
  CONTRACT_SENT_SQL, CONTRACT_BLANKS_SQL, CONTRACT_WORDINGS_SQL, VAULT_REJECT_SQL,
  DECK_LETTERS_SQL, DECK_DELIVERABLES_SQL, ROUND_STARTED_SQL, ROUND_SUBMITTED_NOTIFY_SQL,
  ROUND_APPROVED_SQL, ROUND_CLOSEOUT_NOTIFY_SQL, PIPELINE_NEW_CLIENT_SQL,
  SOCIAL_APPROVED_SQL, SOCIAL_QUEUED_SQL, SOCIAL_FAILED_SQL,
  CORE_PACK_SUBTYPES, LETTERS_EMAIL_KEY, DELIVERABLES_EMAIL_KEY
} from "./fin-b04-sql-flows.mjs";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
export const NOW = "2026-10-14T20:00:00.000Z";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RECENT = "2026-10-13T20:00:00.000Z";
const LONG_AGO = "2026-08-01T20:00:00.000Z";
const JUST_NOW = "2026-10-14T19:50:00.000Z";

const CLIENT = id(100);
const STAFF = id(101);
const OTHER_STAFF = id(103);
const CONVO = id(110);
const INTERNAL_CONVO = id(111);
const SHIFT = id(120);

const client = (extra = {}) => ({ id: CLIENT, org_id: ORG, email: "pat@example.test", phone: "+15555550100", custom_fields: {}, tags: [], is_demo: false, ...extra });
const staff = (extra = {}) => ({ id: STAFF, org_id: ORG, role: "closer", ...extra });
const thread = (extra = {}) => ({ id: CONVO, org_id: ORG, client_id: CLIENT, channel: "sms", kind: "client", ...extra });
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * The same rows in another company, with every id replaced everywhere it
 * appears (so the copy hangs together like a real company), and the company
 * changed. The query must never count them, good or bad.
 */
export function otherCompany(tables) {
  let text = JSON.stringify(tables);
  const ids = new Set(text.match(/00000000-0000-4000-8000-\d{12}/g) || []);
  let n = 0;
  for (const old of ids) text = text.split(old).join(id(50000 + (n += 1)));
  const out = JSON.parse(text);
  for (const rows of Object.values(out)) for (const r of rows) if (r.org_id) r.org_id = OTHER_ORG;
  return out;
}

export function together(a, b) {
  const out = clone(a);
  for (const [name, rows] of Object.entries(b)) out[name] = [...(out[name] || []), ...clone(rows)];
  return out;
}

// ── messages ────────────────────────────────────────────────────────────────

const portalNote = (extra = {}) => ({
  id: id(1), org_id: ORG, client_id: CLIENT, conversation_id: CONVO, direction: "inbound", channel: "sms",
  rendered_body: "Can someone call me about my file?", provider: null, status: "received",
  compliance_check_passed: true, sender_kind: "client", is_demo: false, created_at: RECENT, ...extra
});

const staffText = (extra = {}) => ({
  id: id(2), org_id: ORG, client_id: CLIENT, conversation_id: CONVO, direction: "outbound", channel: "sms",
  rendered_body: "Your documents are in.", provider: "twilio", provider_message_id: "SM-FAKE-1", status: "sent",
  sender_kind: "staff", sender_staff_id: STAFF, scheduled_at: null, attempts: 1, is_demo: false, created_at: RECENT, ...extra
});

const staffSendTables = () => ({
  messages: [staffText()], staff: [staff()], clients: [client()], conversations: [thread()],
  staff_events: [{ id: id(3), org_id: ORG, kind: "text_sent", shift_id: SHIFT, detail: { message_id: id(2) } }],
  shifts: [{ id: SHIFT, org_id: ORG, staff_id: STAFF, started_at: "2026-10-13T15:00:00.000Z", ended_at: null }]
});

const STAFF_SEND_BREAKS = [
  ["no staff member recorded as the sender", (t) => { t.messages[0].sender_staff_id = null; }],
  ["the sender is not on this company's staff", (t) => { t.staff = t.staff.filter((s) => s.id !== STAFF); }],
  ["no client on the message", (t) => { t.messages[0].client_id = null; }],
  ["the client row is gone", (t) => { t.clients = []; }],
  ["the message is not on a thread", (t) => { t.messages[0].conversation_id = null; }],
  ["the thread belongs to a different client", (t) => { t.conversations[0].client_id = id(999); }],
  ["the thread is on a different channel", (t) => { t.conversations[0].channel = "email"; }],
  ["the thread is an internal thread", (t) => { t.conversations[0].kind = "internal"; }],
  ["the row is not outbound", (t) => { t.messages[0].direction = "inbound"; }],
  ["the words are blank", (t) => { t.messages[0].rendered_body = "   "; }],
  ["sent with no provider", (t) => { t.messages[0].provider = null; }],
  ["sent with no provider receipt", (t) => { t.messages[0].provider_message_id = ""; }],
  ["delivered with no provider receipt", (t) => { t.messages[0].status = "delivered"; t.messages[0].provider_message_id = null; }],
  ["a sent text has no text_sent event", (t) => { t.staff_events = []; }],
  ["the text_sent event has no shift", (t) => { t.staff_events[0].shift_id = null; }],
  ["the shift is another person's", (t) => { t.shifts[0].staff_id = id(777); }],
  ["the text went out before the shift began", (t) => { t.shifts[0].started_at = "2026-10-13T21:00:00.000Z"; }],
  ["the text went out after the shift ended", (t) => { t.shifts[0].ended_at = "2026-10-13T19:00:00.000Z"; }],
  ["an inbox text with its own idempotency key still needs the shift", (t) => {
    t.messages[0].provider_ref = "staff:inbox-key-9"; t.staff_events = [];
  }]
];

const STAFF_SEND_OK = [
  ["a pay link text from the closer deck is sent with no shift", (t) => {
    t.messages[0].provider_ref = "staff:pay-link-sms:link-1"; t.staff_events[0].shift_id = null;
  }],
  ["a soft-pull text from the closer deck is sent with no shift", (t) => {
    t.messages[0].provider_ref = "staff:soft-pull-sms:link-2"; t.staff_events = [];
  }],
  ["an owner is not asked for a shift", (t) => { t.staff[0].role = "owner"; t.staff_events = []; }],
  ["a text held overnight is sent later by the sweeper, with no event", (t) => {
    t.staff_events = []; t.messages[0].scheduled_at = "2026-10-13T15:00:00.000Z"; t.messages[0].created_at = "2026-10-13T05:00:00.000Z";
  }],
  ["a text sent on a retry is sent by the sweeper, with no event", (t) => { t.staff_events = []; t.messages[0].attempts = 2; }],
  ["a queued text has no receipt and no event yet", (t) => {
    t.messages[0].status = "queued"; t.messages[0].provider = null; t.messages[0].provider_message_id = null; t.staff_events = [];
  }],
  ["a blocked text has no receipt", (t) => {
    t.messages[0].status = "blocked"; t.messages[0].provider = null; t.messages[0].provider_message_id = null; t.staff_events = [];
  }],
  ["an email needs no text_sent event", (t) => { t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = []; }]
];

const STAFF_SEND_IGNORED = [
  ["an internal note is judged by the chat widget query, not this one", (t) => { t.messages[0].channel = "internal"; t.messages[0].client_id = null; }],
  ["a demo message is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].client_id = null; }],
  ["a message older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].client_id = null; }],
  ["a workflow message is not a staff reply", (t) => { t.messages[0].sender_kind = "system"; t.messages[0].client_id = null; }]
];

// ── contracts ───────────────────────────────────────────────────────────────

const CONTRACT = id(200);
const TEMPLATE = id(210);
const contractTables = () => ({
  contracts: [{
    id: CONTRACT, org_id: ORG, client_id: CLIENT, template_id: TEMPLATE, template_key: "FUNDING-AGREEMENT",
    status: "sent", sent_at: RECENT, sent_by: STAFF, link_expires_at: "2026-10-20T20:00:00.000Z",
    merge_values: { deposit: "5000", company_name: "Fundhub LLC" }, source_kind: "text", is_demo: false
  }],
  contract_templates: [{
    id: TEMPLATE, org_id: ORG, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement", active: true,
    source_kind: "text", body: "This agreement is made between the parties.", signature_statement: "I agree.",
    manual_fields: [{ key: "deposit", label: "Deposit", required: true }, { key: "note", label: "Note", required: false }],
    is_demo: false
  }],
  clients: [client()],
  staff: [staff()],
  contract_signers: [{ id: id(220), org_id: ORG, contract_id: CONTRACT, signer_index: 0, name: "Pat", email: "pat@example.test" }],
  messages: [{ id: id(230), org_id: ORG, provider_ref: `contract:${CONTRACT}:${id(220)}:send` }]
});

const CONTRACT_IGNORED = [
  ["a draft was never sent", (t) => { t.contracts[0].sent_at = null; t.clients = []; }],
  ["a demo contract is not judged", (t) => { t.contracts[0].is_demo = true; t.clients = []; }],
  ["a contract sent over 30 days ago is not judged", (t) => { t.contracts[0].sent_at = LONG_AGO; t.clients = []; }]
];

// ── funding rounds ──────────────────────────────────────────────────────────

function roundTables({ event, stage, texts = [], emails = [], amount = null }) {
  const eventId = id(300);
  const rn = 2;
  return {
    events: [{
      id: eventId, org_id: ORG, name: event, client_id: CLIENT, created_at: RECENT, is_demo: false,
      idempotency_key: `card_stacking:${CLIENT}:${rn}:${stage}:${event}`,
      payload: {
        stage, source: "card_stacking", rail: "card_stacking", product: "card_stacking", roundNumber: rn,
        ...(amount === null ? {} : { approvedAmount: amount })
      }
    }],
    clients: [client()],
    funding_rounds: [{ id: id(310), org_id: ORG, client_id: CLIENT, round_number: rn }],
    messages: [...texts, ...emails].map((key, i) => ({ id: id(320 + i), org_id: ORG, provider_ref: `workflow:${key}:${eventId}` })),
    opt_outs: []
  };
}

function roundBreaks({ texts, emails, stage, event }) {
  const out = [
    ["the event carries no client", (t) => { t.events[0].client_id = null; }],
    ["the client row is gone", (t) => { t.clients = []; }],
    ["the stage word is wrong", (t) => { t.events[0].payload.stage = "funded"; }],
    ["the rail is wrong", (t) => { t.events[0].payload.rail = "alt_fin"; }],
    ["the product is wrong", (t) => { t.events[0].payload.product = "diy"; }],
    ["the round number is not a positive whole number", (t) => {
      t.events[0].payload.roundNumber = 0;
      t.events[0].idempotency_key = `card_stacking:${CLIENT}:0:${stage}:${event}`;
      t.funding_rounds[0].round_number = 0;
    }],
    ["the saved key does not match client, round, stage and event", (t) => { t.events[0].idempotency_key = "card_stacking:wrong"; }],
    ["no round row an hour later", (t) => { t.funding_rounds = []; }],
    ["the round row is for another round number", (t) => { t.funding_rounds[0].round_number = 1; }]
  ];
  for (const key of texts) {
    out.push([`no text (${key}) an hour later`, (t) => { t.messages = t.messages.filter((m) => !m.provider_ref.includes(key)); }]);
  }
  for (const key of emails) {
    out.push([`no email (${key}) an hour later`, (t) => { t.messages = t.messages.filter((m) => !m.provider_ref.includes(key)); }]);
  }
  return out;
}

// ── the cases ───────────────────────────────────────────────────────────────

export const CASES = [];

function add(key, sql, good, breaks, { ok = [], ignored = [], sample = 1 } = {}) {
  CASES.push({ key, sql, good, breaks, ok, ignored, sample });
}

add("portal-message", PORTAL_MESSAGE_SQL,
  () => ({ messages: [portalNote()], conversations: [thread()] }),
  [
    ["no client on the note", (t) => { t.messages[0].client_id = null; }],
    ["the note is not on a thread", (t) => { t.messages[0].conversation_id = null; }],
    ["the thread is another client's", (t) => { t.conversations[0].client_id = id(999); }],
    ["the thread is on another channel", (t) => { t.conversations[0].channel = "email"; }],
    ["the thread is an internal thread", (t) => { t.conversations[0].kind = "internal"; }],
    ["the channel is not sms or email", (t) => { t.messages[0].channel = "voice"; t.conversations[0].channel = "voice"; }],
    ["the status is not received", (t) => { t.messages[0].status = "queued"; }],
    ["the compliance flag is off", (t) => { t.messages[0].compliance_check_passed = false; }],
    ["the words are blank", (t) => { t.messages[0].rendered_body = ""; }]
  ],
  { ignored: [
    ["a note from a text provider is not a portal note", (t) => { t.messages[0].provider = "twilio"; t.messages[0].client_id = null; }],
    ["a demo note is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].client_id = null; }],
    ["a note older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].client_id = null; }],
    ["a staff reply is not a client note", (t) => { t.messages[0].sender_kind = "staff"; t.messages[0].client_id = null; }],
    ["an outbound row is not a client note", (t) => { t.messages[0].direction = "outbound"; t.messages[0].client_id = null; }]
  ] });

add("portal-call-request", PORTAL_CALL_REQUEST_SQL,
  () => ({ messages: [portalNote({ rendered_body: "I would like a call about: More funding" })], conversations: [thread()] }),
  [
    ["the topic is empty", (t) => { t.messages[0].rendered_body = "I would like a call about: "; }],
    ["no client on the request", (t) => { t.messages[0].client_id = null; }],
    ["the request is not on a thread", (t) => { t.messages[0].conversation_id = null; }],
    ["the thread is another client's", (t) => { t.conversations[0].client_id = id(999); }],
    ["the thread is on another channel", (t) => { t.conversations[0].channel = "email"; }]
  ],
  { ignored: [
    ["an ordinary note is not a call request", (t) => { t.messages[0].rendered_body = "Thanks!"; t.messages[0].client_id = null; }],
    ["an outbound row is not a client request", (t) => { t.messages[0].direction = "outbound"; t.messages[0].client_id = null; }],
    ["a staff row is not a client request", (t) => { t.messages[0].sender_kind = "staff"; t.messages[0].client_id = null; }],
    ["a row from a text provider is not a portal request", (t) => { t.messages[0].provider = "twilio"; t.messages[0].client_id = null; }],
    ["a demo request is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].client_id = null; }],
    ["a request older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].client_id = null; }]
  ] });

add("push-device", PUSH_DEVICE_SQL,
  () => ({
    client_push_subscriptions: [{
      id: id(400), org_id: ORG, client_id: CLIENT, account_id: id(410), endpoint_hash: "a".repeat(64),
      encrypted_endpoint: "v1:x", encrypted_p256dh: "v1:y", encrypted_auth: "v1:z",
      created_at: RECENT, revoked_at: null, expired_at: null
    }],
    clients: [client()],
    accounts: [{ id: id(410), org_id: ORG, client_id: CLIENT, kind: "client" }]
  }),
  [
    ["the client row is gone", (t) => { t.clients = []; }],
    ["the saved endpoint is blank", (t) => { t.client_push_subscriptions[0].encrypted_endpoint = " "; }],
    ["the saved key is missing", (t) => { t.client_push_subscriptions[0].encrypted_p256dh = null; }],
    ["the saved auth secret is blank", (t) => { t.client_push_subscriptions[0].encrypted_auth = ""; }],
    ["the sign-in account is gone", (t) => { t.accounts = []; }],
    ["the sign-in account belongs to another client", (t) => { t.accounts[0].client_id = id(999); }],
    ["the sign-in account is a partner's, not a client's", (t) => { t.accounts[0].kind = "partner"; t.accounts[0].client_id = null; }],
    ["turned off before it was created", (t) => { t.client_push_subscriptions[0].revoked_at = "2026-10-01T00:00:00.000Z"; }],
    ["expired before it was created", (t) => { t.client_push_subscriptions[0].expired_at = "2026-10-01T00:00:00.000Z"; }],
    ["the same phone is live for a second client", (t) => {
      t.client_push_subscriptions.push({ ...t.client_push_subscriptions[0], id: id(401), client_id: id(998), account_id: null });
      t.clients.push(client({ id: id(998) }));
    }, { sample: 2, bad: 2 }]
  ],
  { ok: [
    ["an authorized rep's account carries no client id", (t) => { t.accounts[0].kind = "authorized_rep"; t.accounts[0].client_id = null; }],
    ["expired after it was created", (t) => { t.client_push_subscriptions[0].expired_at = "2026-10-14T00:00:00.000Z"; }],
    ["an expired device and a live one on the same phone", (t) => {
      t.client_push_subscriptions[0].expired_at = "2026-10-14T00:00:00.000Z";
      t.client_push_subscriptions.push({ ...t.client_push_subscriptions[0], id: id(401), expired_at: null, account_id: null });
    }, { sample: 2, bad: 0 }],
    ["a turned-off device and a live one on the same phone", (t) => {
      t.client_push_subscriptions.push({ ...t.client_push_subscriptions[0], id: id(401), revoked_at: "2026-10-13T21:00:00.000Z", account_id: null });
    }, { sample: 2, bad: 0 }]
  ] });

add("staff-message", STAFF_MESSAGE_SQL, staffSendTables, STAFF_SEND_BREAKS,
  { ok: STAFF_SEND_OK, ignored: STAFF_SEND_IGNORED });

const internalTables = () => ({
  messages: [{
    id: id(5), org_id: ORG, client_id: null, conversation_id: INTERNAL_CONVO, direction: "outbound", channel: "internal",
    rendered_body: "Heads up on the Pat file.", status: "delivered", sender_kind: "staff", sender_staff_id: OTHER_STAFF,
    is_demo: false, created_at: RECENT
  }],
  staff: [staff({ id: OTHER_STAFF, role: "admin" })],
  conversations: [{ id: INTERNAL_CONVO, org_id: ORG, client_id: null, channel: "internal", kind: "internal" }],
  conversation_participants: [{ conversation_id: INTERNAL_CONVO, staff_id: OTHER_STAFF }]
});

// message 0 is the client text, message 1 is the staff note
const chatWidgetTables = () => {
  const text = staffSendTables();
  const note = internalTables();
  return {
    messages: [...text.messages, ...note.messages],
    staff: [...text.staff, ...note.staff],
    clients: text.clients,
    conversations: [...text.conversations, ...note.conversations],
    staff_events: text.staff_events,
    shifts: text.shifts,
    conversation_participants: note.conversation_participants
  };
};

add("chat-widget", CHAT_WIDGET_SQL, chatWidgetTables,
  [
    ...STAFF_SEND_BREAKS.map(([label, fn]) => [`client text: ${label}`, fn]),
    ["staff note: no sender recorded", (t) => { t.messages[1].sender_staff_id = null; }],
    ["staff note: sender is not on staff", (t) => { t.staff = t.staff.filter((s) => s.id !== OTHER_STAFF); }],
    ["staff note: carries a client", (t) => { t.messages[1].client_id = CLIENT; }],
    ["staff note: thread is a client thread", (t) => { t.conversations[1].kind = "client"; t.conversations[1].client_id = CLIENT; }],
    ["staff note: not on a thread", (t) => { t.messages[1].conversation_id = null; }],
    ["staff note: sender is not on the thread", (t) => { t.conversation_participants = []; }],
    ["staff note: not delivered", (t) => { t.messages[1].status = "queued"; }],
    ["staff note: blank words", (t) => { t.messages[1].rendered_body = ""; }],
    ["staff note: marked inbound", (t) => { t.messages[1].direction = "inbound"; }]
  ],
  { sample: 2, ok: STAFF_SEND_OK.map(([label, fn]) => [`client text: ${label}`, fn]), ignored: [
    ["a demo staff note is not judged", (t) => { t.messages[1].is_demo = true; t.messages[1].client_id = CLIENT; }],
    ["a staff note older than 30 days is not judged", (t) => { t.messages[1].created_at = LONG_AGO; t.messages[1].client_id = CLIENT; }],
    ["a message from a workflow is not a staff note", (t) => { t.messages[1].sender_kind = "system"; t.messages[1].client_id = CLIENT; }],
    ["a staff voice row is not a text or a note", (t) => { t.messages[1].channel = "voice"; t.messages[1].client_id = CLIENT; }]
  ].map(([label, fn]) => [label, (t) => { fn(t); t.messages = [t.messages[1]]; }]) });

add("message-blocked", MESSAGE_BLOCKED_SQL,
  () => ({
    messages: [staffText({ status: "blocked", provider: null, provider_message_id: null, blocked_reason: "guaranteed_funding", blocked_at: RECENT })],
    tasks: [{ id: id(500), org_id: ORG, source_workflow: "messaging-gate", body: `${id(2)}:guaranteed_funding`, assignee_role: "admin" }]
  }),
  [
    ["the words are blank", (t) => { t.messages[0].rendered_body = ""; }],
    ["no reason is recorded", (t) => { t.messages[0].blocked_reason = null; t.messages[0].last_error = null; }],
    ["a reason with no time", (t) => { t.messages[0].blocked_at = null; }],
    ["restricted wording and no task raised", (t) => { t.tasks = []; }],
    ["restricted wording and the task has no owner", (t) => { t.tasks[0].assignee_role = null; }],
    ["the task is for a different message", (t) => { t.tasks[0].body = `${id(999)}:guaranteed_funding`; }],
    ["two codes, one of them restricted, no task", (t) => { t.messages[0].blocked_reason = "opted_out,guaranteed_funding"; t.tasks = []; }]
  ],
  { ok: [
    ["opt-out only: no task is the right answer", (t) => { t.messages[0].blocked_reason = "opted_out"; t.tasks = []; }],
    ["two clearing codes: no task is the right answer", (t) => { t.messages[0].blocked_reason = "opted_out,quiet_hours"; t.tasks = []; }],
    ["a dispatcher block keeps its reason in last_error", (t) => {
      t.messages[0].blocked_reason = null; t.messages[0].blocked_at = null; t.messages[0].last_error = "draft_template"; t.tasks = [];
    }],
    ["a blank reason with the cause kept in last_error", (t) => {
      t.messages[0].blocked_reason = ""; t.messages[0].blocked_at = null; t.messages[0].last_error = "placeholder_copy"; t.tasks = [];
    }]
  ], ignored: [
    ["an inbound row is not a staff reply", (t) => { t.messages[0].direction = "inbound"; t.messages[0].rendered_body = ""; }],
    ["a voice row is not a text or email", (t) => { t.messages[0].channel = "voice"; t.messages[0].rendered_body = ""; }],
    ["a demo block is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].rendered_body = ""; }],
    ["a workflow's blocked text is not a staff reply", (t) => { t.messages[0].sender_kind = "system"; t.messages[0].rendered_body = ""; }],
    ["a text that was not blocked", (t) => { t.messages[0].status = "sent"; t.messages[0].rendered_body = ""; }],
    ["a blocked text older than 30 days", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].rendered_body = ""; }]
  ] });

add("message-held", MESSAGE_HELD_SQL,
  () => ({ messages: [staffText({ status: "queued", provider: null, provider_message_id: null,
    created_at: "2026-10-14T05:00:00.000Z", scheduled_at: "2026-10-14T15:00:00.000Z", attempts: 0 })] }),
  [
    ["an email was held", (t) => { t.messages[0].channel = "email"; }],
    ["an inbound row was held", (t) => { t.messages[0].direction = "inbound"; }],
    ["held to a time before it was written", (t) => { t.messages[0].scheduled_at = "2026-10-14T04:00:00.000Z"; }],
    ["held to an 8 am that had already passed", (t) => {
      t.messages[0].created_at = "2026-10-14T19:00:00.000Z"; t.messages[0].scheduled_at = "2026-10-14T15:00:00.000Z";
    }],
    ["held to 9 am Arizona, not 8", (t) => { t.messages[0].scheduled_at = "2026-10-14T16:00:00.000Z"; }],
    ["held to 8:30 am Arizona", (t) => { t.messages[0].scheduled_at = "2026-10-14T15:30:00.000Z"; }],
    ["held to 8 am UTC, not Arizona", (t) => { t.messages[0].scheduled_at = "2026-10-14T08:00:00.000Z"; }],
    ["the words are blank", (t) => { t.messages[0].rendered_body = ""; }]
  ],
  { ok: [
    ["the held text went out at 8 am", (t) => { t.messages[0].status = "sent"; t.messages[0].provider = "twilio"; }]
  ], ignored: [
    ["a text with no schedule is not held", (t) => { t.messages[0].scheduled_at = null; t.messages[0].channel = "email"; }],
    ["a workflow text is not a staff reply", (t) => { t.messages[0].sender_kind = "system"; t.messages[0].channel = "email"; }],
    ["a demo text is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].channel = "email"; }],
    ["a text older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].scheduled_at = "2026-08-02T15:00:00.000Z"; t.messages[0].channel = "email"; }]
  ] });

add("thread-link", THREAD_LINK_SQL,
  () => ({ messages: [portalNote({ provider: "twilio", sender_kind: "system" })], conversations: [thread()] }),
  [
    ["the inbound text is not on a thread", (t) => { t.messages[0].conversation_id = null; }],
    ["the thread is another client's", (t) => { t.conversations[0].client_id = id(999); }],
    ["the thread is on the other channel", (t) => { t.conversations[0].channel = "email"; }],
    ["the thread is an internal thread", (t) => { t.conversations[0].kind = "internal"; }]
  ],
  { ignored: [
    ["a text from an unknown number has no client", (t) => { t.messages[0].client_id = null; t.messages[0].conversation_id = null; }],
    ["a text from ten seconds ago may not be threaded yet", (t) => { t.messages[0].created_at = "2026-10-14T19:59:50.000Z"; t.messages[0].conversation_id = null; }],
    ["an outbound text is not judged", (t) => { t.messages[0].direction = "outbound"; t.messages[0].conversation_id = null; }],
    ["a voice call is not judged", (t) => { t.messages[0].channel = "voice"; t.messages[0].conversation_id = null; }],
    ["a demo text is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].conversation_id = null; }],
    ["a text older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].conversation_id = null; }]
  ] });

add("contract-sent", CONTRACT_SENT_SQL, contractTables,
  [
    ["the client row is gone", (t) => { t.clients = []; }],
    ["the wording row is gone", (t) => { t.contract_templates = []; }],
    ["the wording key differs from the contract's key", (t) => { t.contract_templates[0].template_key = "OTHER"; }],
    ["nobody is recorded as the sender", (t) => { t.contracts[0].sent_by = null; }],
    ["the sender is not on staff", (t) => { t.staff = []; }],
    ["no link expiry", (t) => { t.contracts[0].link_expires_at = null; }],
    ["the link expires before it was sent", (t) => { t.contracts[0].link_expires_at = "2026-10-12T00:00:00.000Z"; }],
    ["nobody to sign it", (t) => { t.contract_signers = []; }],
    ["the client has an email and no email was queued", (t) => { t.messages = []; }],
    ["a signer has an email, the client has none, and no email was queued", (t) => { t.clients[0].email = null; t.messages = []; }],
    ["the client has an email, no signer does, and no email was queued", (t) => { t.contract_signers[0].email = null; t.messages = []; }]
  ],
  { ok: [
    ["no email on file anywhere: the link was handed over", (t) => {
      t.clients[0].email = null; t.contract_signers[0].email = null; t.messages = [];
    }],
    ["sent less than an hour ago: the email may still be coming", (t) => { t.contracts[0].sent_at = JUST_NOW; t.messages = []; }],
    ["a contract the client already signed", (t) => { t.contracts[0].status = "signed"; }]
  ], ignored: CONTRACT_IGNORED });

add("contract-blanks", CONTRACT_BLANKS_SQL, contractTables,
  [
    ["a required blank is empty", (t) => { t.contracts[0].merge_values = { deposit: "" }; }],
    ["a required blank is missing", (t) => { t.contracts[0].merge_values = {}; }],
    ["a required blank is only spaces", (t) => { t.contracts[0].merge_values = { deposit: "   " }; }],
    ["the wording row is gone", (t) => { t.contract_templates = []; }],
    ["a second required blank is empty", (t) => {
      t.contract_templates[0].manual_fields.push({ key: "days", label: "Days", required: true });
    }]
  ],
  { ok: [
    ["an optional blank may stay empty", (t) => { t.contracts[0].merge_values = { deposit: "5000", note: "" }; }]
  ], ignored: [
    ["an uploaded PDF has its boxes, not blanks", (t) => { t.contracts[0].source_kind = "pdf"; t.contracts[0].merge_values = {}; }],
    ...CONTRACT_IGNORED.map(([label, fn]) => [label, (t) => { fn(t); t.contracts[0].merge_values = {}; }])
  ] });

add("contract-wordings", CONTRACT_WORDINGS_SQL,
  () => ({ contract_templates: [{
    id: TEMPLATE, org_id: ORG, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement", active: true,
    source_kind: "text", body: "This agreement is made between the parties.", signature_statement: "I agree.", is_demo: false
  }] }),
  [
    ["the key is blank", (t) => { t.contract_templates[0].template_key = " "; }],
    ["the name is blank", (t) => { t.contract_templates[0].name = ""; }],
    ["no signature sentence", (t) => { t.contract_templates[0].signature_statement = null; }],
    ["the words are blank", (t) => { t.contract_templates[0].body = ""; }],
    ["the words are still placeholder text", (t) => { t.contract_templates[0].body = ">>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. <<<"; }],
    ["the placeholder marker in lower case", (t) => { t.contract_templates[0].body = "this is not the real agreement text"; }]
  ],
  { ok: [
    ["an uploaded PDF wording has boxes, not words", (t) => { t.contract_templates[0].source_kind = "pdf"; t.contract_templates[0].body = null; }]
  ], ignored: [
    ["an inactive wording is not on the panel", (t) => { t.contract_templates[0].active = false; t.contract_templates[0].body = ""; }],
    ["a demo wording is not judged", (t) => { t.contract_templates[0].is_demo = true; t.contract_templates[0].body = ""; }]
  ] });

add("vault-reject", VAULT_REJECT_SQL,
  () => ({
    document_vault_reviews: [{ id: id(600), org_id: ORG, client_id: CLIENT, document_id: id(610), status: "rejected",
      reason: "The photo is blurry. Please send it again.", reviewed_by_staff_id: STAFF, covers: 1, period_end: null }],
    documents: [{ id: id(610), org_id: ORG, client_id: CLIENT, kind: "client_upload" }],
    staff: [staff()]
  }),
  [
    ["the document is gone", (t) => { t.documents = []; }],
    ["the document is another client's", (t) => { t.documents[0].client_id = id(999); }],
    ["the document is not a client upload", (t) => { t.documents[0].kind = "contract"; }],
    ["nobody is recorded as the reviewer", (t) => { t.document_vault_reviews[0].reviewed_by_staff_id = null; }],
    ["the reviewer is not on staff", (t) => { t.staff = []; }],
    ["covers more than one", (t) => { t.document_vault_reviews[0].covers = 3; }],
    ["a period end on a reject", (t) => { t.document_vault_reviews[0].period_end = "2026-09-30"; }],
    ["no reason the client can read", (t) => { t.document_vault_reviews[0].reason = " "; }]
  ],
  { ok: [
    ["a file the client sent for an inquiry", (t) => { t.documents[0].kind = "inquiry_doc"; }]
  ], ignored: [
    ["an accepted file is not a reject", (t) => { t.document_vault_reviews[0].status = "accepted"; t.documents = []; }]
  ] });

const LETTER_DOC = (extra = {}) => ({
  id: id(700), org_id: ORG, client_id: CLIENT, kind: "deliverable", mime_type: "application/pdf", byte_size: 52000,
  storage_key: "docs/letter.pdf", checksum: "sha256:ab12", generated_by: "closer-deck",
  source_event_id: `closer-deck-letters:${CLIENT}:REPAIR_DFY:round1/ex.pdf`, generated_at: RECENT, is_demo: false, ...extra
});
add("deck-letters", DECK_LETTERS_SQL,
  () => ({
    documents: [LETTER_DOC()],
    clients: [client()],
    messages: [{ id: id(710), org_id: ORG, client_id: CLIENT, template_key: LETTERS_EMAIL_KEY,
      provider_ref: `workflow:${LETTERS_EMAIL_KEY}:closer-deck-letters:${CLIENT}:REPAIR_DFY` }]
  }),
  [
    ["the client row is gone", (t) => { t.clients = []; }],
    ["not saved as a deliverable", (t) => { t.documents[0].kind = "client_upload"; }],
    ["not a PDF", (t) => { t.documents[0].mime_type = "text/plain"; }],
    ["an empty file", (t) => { t.documents[0].byte_size = 0; }],
    ["no file size", (t) => { t.documents[0].byte_size = null; }],
    ["no storage key", (t) => { t.documents[0].storage_key = ""; }],
    ["no checksum", (t) => { t.documents[0].checksum = null; }],
    ["letters on an offer that does not allow letters", (t) => {
      t.documents[0].source_event_id = `closer-deck-letters:${CLIENT}:FUNDING_DFY:round1/ex.pdf`;
    }],
    ["no email an hour later", (t) => { t.messages = []; }],
    ["the email is for another client", (t) => { t.messages[0].client_id = id(999); }],
    ["the email is the deliverables email, not the letters email", (t) => { t.messages[0].template_key = DELIVERABLES_EMAIL_KEY; }]
  ],
  { ok: [
    ["less than an hour old: the email may still be coming", (t) => { t.documents[0].generated_at = JUST_NOW; t.messages = []; }]
  ], ignored: [
    ["another workflow's letters", (t) => { t.documents[0].generated_by = "ds-02-diy-letters"; t.documents[0].byte_size = 0; }],
    ["a deliverables file belongs to the other button", (t) => {
      t.documents[0].source_event_id = `closer-deck-deliverables:${CLIENT}:UWIQ_DELIVERABLES:funding_snapshot`; t.documents[0].byte_size = 0;
    }],
    ["a demo file is not judged", (t) => { t.documents[0].is_demo = true; t.documents[0].byte_size = 0; }],
    ["a file older than 30 days is not judged", (t) => { t.documents[0].generated_at = LONG_AGO; t.documents[0].byte_size = 0; }]
  ] });

const deliverablesTables = () => {
  const docs = CORE_PACK_SUBTYPES.map((subtype, i) => ({
    id: id(800 + i), org_id: ORG, client_id: CLIENT, kind: "deliverable", subtype, byte_size: 90000,
    storage_key: `docs/${subtype}.pdf`, checksum: "sha256:cd34", generated_by: "closer-deck",
    source_event_id: `closer-deck-deliverables:${CLIENT}:UWIQ_DELIVERABLES:${subtype}`, generated_at: RECENT, is_demo: false
  }));
  return {
    documents: docs,
    clients: [client()],
    messages: [{ id: id(810), org_id: ORG, client_id: CLIENT, template_key: DELIVERABLES_EMAIL_KEY,
      provider_ref: `workflow:${DELIVERABLES_EMAIL_KEY}:closer-deck-letters:${CLIENT}:UWIQ_DELIVERABLES` }]
  };
};
add("deck-deliverables", DECK_DELIVERABLES_SQL, deliverablesTables,
  [
    ...CORE_PACK_SUBTYPES.map((subtype) => [`the ${subtype} file is missing`, (t) => {
      t.documents = t.documents.filter((d) => d.subtype !== subtype);
    }]),
    ["a file is empty", (t) => { t.documents[0].byte_size = 0; }],
    ["a file has no storage key", (t) => { t.documents[1].storage_key = null; }],
    ["a file has no checksum", (t) => { t.documents[2].checksum = null; }],
    ["a file is on an offer that does not allow letters", (t) => {
      t.documents[3].source_event_id = `closer-deck-deliverables:${CLIENT}:FUNDING_DFY:bank_lender_match_list`;
    }],
    ["no delivery email an hour later", (t) => { t.messages = []; }],
    ["the delivery email is the letters email", (t) => { t.messages[0].template_key = LETTERS_EMAIL_KEY; }]
  ],
  { ok: [
    ["less than an hour old: the email may still be coming", (t) => {
      for (const d of t.documents) d.generated_at = JUST_NOW;
      t.messages = [];
    }]
  ], ignored: [
    ["a client with no closer-deck deliverables is not judged", (t) => {
      for (const d of t.documents) d.generated_by = "c-06-crs-results-router";
      t.documents[0].byte_size = 0;
    }],
    ["a demo client is not judged", (t) => { t.clients[0].is_demo = true; t.documents[0].byte_size = 0; }]
  ] });

const ROUND_SPECS = [
  ["round-started", ROUND_STARTED_SQL, { event: "round.started", stage: "apply_now", texts: ["SMS-ROUND-STARTED-NOTIFY"], emails: [] }],
  ["round-submitted", ROUND_SUBMITTED_NOTIFY_SQL, { event: "round.submitted", stage: "round_submitted", texts: ["SMS-F03-ROUND-SUBMITTED"], emails: ["EMAIL-F03-ROUND-SUBMITTED"] }],
  ["round-approved", ROUND_APPROVED_SQL, { event: "round.approved", stage: "approved", amount: 15000, texts: ["SMS-F04-ROUND-APPROVALS"], emails: ["EMAIL-F04-ROUND-APPROVALS"] }],
  ["round-closeout", ROUND_CLOSEOUT_NOTIFY_SQL, { event: "round.closeout", stage: "closed", texts: ["SMS-N04-POST-FUNDING"], emails: ["EMAIL-N04-POST-FUNDING"] }]
];
for (const [key, sql, spec] of ROUND_SPECS) {
  add(key, sql, () => roundTables(spec), roundBreaks(spec), {
    ignored: [
      ["an event from another source is not card stacking", (t) => { t.events[0].payload.source = "lendflow"; t.events[0].client_id = null; }],
      ["a demo event is not judged", (t) => { t.events[0].is_demo = true; t.events[0].client_id = null; }],
      ["an old event is not judged", (t) => { t.events[0].created_at = LONG_AGO; t.events[0].client_id = null; }],
      ["another event name is not judged", (t) => { t.events[0].name = "round.funded"; t.events[0].client_id = null; }]
    ],
    ok: [
      ["less than an hour old: the follow-up may still be running", (t) => {
        t.events[0].created_at = JUST_NOW; t.messages = []; t.funding_rounds = [];
      }],
      ...(spec.amount ? [
        ["no approved amount: the approvals workflow sends nothing", (t) => { delete t.events[0].payload.approvedAmount; t.messages = []; }],
        ["an approved amount of zero: the approvals workflow sends nothing", (t) => { t.events[0].payload.approvedAmount = 0; t.messages = []; }]
      ] : []),
      ...(spec.texts.length ? [["opted out of texts: no text is right", (t) => {
        t.messages = t.messages.filter((m) => !m.provider_ref.includes(":SMS-"));
        t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_in_at: null }];
      }]] : [])
    ]
  });
}

const newClientTables = () => {
  const eventId = id(900);
  return {
    events: [{
      id: eventId, org_id: ORG, name: "entry.captured", client_id: CLIENT, created_at: RECENT, is_demo: false,
      idempotency_key: `pipeline-client:${ORG}:pat@example.test`,
      payload: { name: "Pat Example", email: "pat@example.test", phone: "(555) 555-0100", product: "diagnostic", source: "pipeline" }
    }],
    clients: [client({ custom_fields: { product: "diagnostic" } })],
    cards: [{ id: id(910), org_id: ORG, client_id: CLIENT }],
    messages: [
      { id: id(920), org_id: ORG, client_id: CLIENT, template_key: "EMAIL-S00-WELCOME", provider_ref: `workflow:EMAIL-S00-WELCOME:${eventId}` },
      { id: id(921), org_id: ORG, client_id: CLIENT, template_key: "SMS-S00-WELCOME", provider_ref: `workflow:SMS-S00-WELCOME:${eventId}` }
    ],
    opt_outs: []
  };
};
add("pipeline-new-client", PIPELINE_NEW_CLIENT_SQL, newClientTables,
  [
    ["the event carries no client", (t) => { t.events[0].client_id = null; }],
    ["the client row is gone", (t) => { t.clients = []; }],
    ["no name", (t) => { t.events[0].payload.name = " "; }],
    ["a bad email", (t) => {
      t.events[0].payload.email = "not-an-email";
      t.events[0].idempotency_key = `pipeline-client:${ORG}:not-an-email`;
    }],
    ["no phone", (t) => { t.events[0].payload.phone = ""; }],
    ["a product that is not on the list", (t) => {
      t.events[0].payload.product = "gold-plan"; t.clients[0].custom_fields.product = "gold-plan";
    }],
    ["the client file holds a different product", (t) => { t.clients[0].custom_fields.product = "repair-bundle"; }],
    ["the saved key does not match company and email", (t) => { t.events[0].idempotency_key = "pipeline-client:wrong"; }],
    ["no card on the board an hour later", (t) => { t.cards = []; }],
    ["no welcome email an hour later", (t) => { t.messages = t.messages.filter((m) => m.template_key !== "EMAIL-S00-WELCOME"); }],
    ["no welcome text an hour later", (t) => { t.messages = t.messages.filter((m) => m.template_key !== "SMS-S00-WELCOME"); }],
    ["the welcome went to a different client", (t) => { for (const m of t.messages) m.client_id = id(999); }]
  ],
  { ok: [
    ["an archived client has no cards", (t) => { t.cards = []; t.clients[0].custom_fields.crm_archived_at = "2026-10-13T00:00:00.000Z"; }],
    ["welcomed earlier through another door: this event was locked out", (t) => {
      for (const m of t.messages) m.provider_ref = `workflow:${m.template_key}:${id(1)}`;
    }],
    ["opted out of texts: no welcome text is right", (t) => {
      t.messages = t.messages.filter((m) => m.template_key !== "SMS-S00-WELCOME");
      t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_in_at: null }];
    }],
    ["less than an hour old: the welcome may still be coming", (t) => { t.events[0].created_at = JUST_NOW; t.messages = []; t.cards = []; }]
  ], ignored: [
    ["a funnel sign-up is not a pipeline save", (t) => { t.events[0].payload.source = "funnel"; t.events[0].client_id = null; }],
    ["a demo event is not judged", (t) => { t.events[0].is_demo = true; t.events[0].client_id = null; }],
    ["an old event is not judged", (t) => { t.events[0].created_at = LONG_AGO; t.events[0].client_id = null; }],
    ["another event name is not judged", (t) => { t.events[0].name = "entry.updated"; t.events[0].client_id = null; }]
  ] });

const POST = id(1000);
const PARTNER = id(1010);
add("social-approved", SOCIAL_APPROVED_SQL,
  () => ({
    social_posts: [{ id: POST, org_id: ORG, partner_id: PARTNER, status: "queued", approved_at: RECENT, approved_by: STAFF }],
    staff: [staff({ role: "owner" })],
    marketing_content_queue: [{ id: id(1020), org_id: ORG, partner_id: PARTNER, social_post_id: POST, status: "scheduled" }]
  }),
  [
    ["nobody is recorded as the approver", (t) => { t.social_posts[0].approved_by = null; }],
    ["the approver is not on staff", (t) => { t.staff = []; }],
    ["the post is still waiting for approval", (t) => { t.social_posts[0].status = "awaiting_approval"; }],
    ["the post was blocked after approval", (t) => { t.social_posts[0].status = "blocked"; }],
    ["no queue row mirrors the post", (t) => { t.marketing_content_queue = []; }],
    ["the queue row still says awaiting approval", (t) => { t.marketing_content_queue[0].status = "awaiting_approval"; }],
    ["the queue row is a different partner's", (t) => { t.marketing_content_queue[0].partner_id = id(1011); }]
  ],
  { ok: [
    ["an approved post that has gone out", (t) => { t.social_posts[0].status = "posted"; }],
    ["an approved post that gave up", (t) => { t.social_posts[0].status = "failed"; }]
  ], ignored: [
    ["a post nobody approved is not judged", (t) => { t.social_posts[0].approved_at = null; t.social_posts[0].approved_by = null; }],
    ["an approval older than 30 days is not judged", (t) => { t.social_posts[0].approved_at = LONG_AGO; t.social_posts[0].approved_by = null; }]
  ] });

add("social-queued", SOCIAL_QUEUED_SQL,
  () => ({
    marketing_content_queue: [{ id: id(1030), org_id: ORG, partner_id: PARTNER, social_post_id: null, status: "queued", caption: "Funding tips" }],
    partners: [{ id: PARTNER, org_id: ORG }]
  }),
  [
    ["a queued row that was also handed to an account", (t) => { t.marketing_content_queue[0].social_post_id = id(1040); }],
    ["a queued row with no words", (t) => { t.marketing_content_queue[0].caption = "  "; }],
    ["the partner is gone", (t) => { t.partners = []; }]
  ],
  { ignored: [
    ["a draft is not queued", (t) => { t.marketing_content_queue[0].status = "draft"; t.marketing_content_queue[0].social_post_id = id(1040); }],
    ["a scheduled row is not queued", (t) => { t.marketing_content_queue[0].status = "scheduled"; t.marketing_content_queue[0].social_post_id = id(1040); }]
  ] });

add("social-failed", SOCIAL_FAILED_SQL,
  () => ({
    social_posts: [{ id: id(1050), org_id: ORG, partner_id: PARTNER, status: "failed", attempt: 3, last_error: "token expired" }],
    partners: [{ id: PARTNER, org_id: ORG }],
    partner_onboarding_tasks: [{ id: id(1060), org_id: ORG, partner_id: PARTNER, task_key: "social_post_failed" }]
  }),
  [
    ["gave up before three tries", (t) => { t.social_posts[0].attempt = 2; }],
    ["no reason recorded", (t) => { t.social_posts[0].last_error = " "; }],
    ["the partner is gone", (t) => { t.partners = []; }],
    ["no job opened for a person", (t) => { t.partner_onboarding_tasks = []; }],
    ["the job is for another partner", (t) => { t.partner_onboarding_tasks[0].partner_id = id(1011); }],
    ["the job is a different kind", (t) => { t.partner_onboarding_tasks[0].task_key = "connect_account"; }]
  ],
  { ok: [
    ["the job was already closed by a person", (t) => { t.partner_onboarding_tasks[0].resolved_at = RECENT; }]
  ], ignored: [
    ["a queued post is not failed", (t) => { t.social_posts[0].status = "queued"; t.social_posts[0].attempt = 0; }]
  ] });

export { LONG_AGO, RECENT, JUST_NOW };
