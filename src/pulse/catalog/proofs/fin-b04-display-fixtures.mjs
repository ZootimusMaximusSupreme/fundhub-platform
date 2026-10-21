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
//
// Repair cycle 1 (2026-10-15): every break the independent checker found green is
// a break here now (a text that failed or sat stuck, sent to an opted-out client,
// sent at night, with restricted words; a hold a day too long; a card dropped on a
// funding column whose event was lost; a wrong wording for the offer; a typed
// price; a signing email to a stranger; and the rest).

import { OFFERS } from "../../../config/offers.mjs";
import {
  PORTAL_MESSAGE_SQL, PORTAL_CALL_REQUEST_SQL, STAFF_MESSAGE_SQL, CHAT_WIDGET_SQL,
  MESSAGE_BLOCKED_SQL, MESSAGE_HELD_SQL, THREAD_LINK_SQL
} from "./fin-b04-sql-messages.mjs";
import {
  CONTRACT_SENT_SQL, CONTRACT_BLANKS_SQL, CONTRACT_DECK_SEND_SQL, CONTRACT_WORDINGS_SQL, VAULT_REJECT_SQL,
  DECK_LETTERS_SQL, DECK_DELIVERABLES_SQL, ROUND_STARTED_SQL, ROUND_SUBMITTED_NOTIFY_SQL,
  ROUND_APPROVED_SQL, ROUND_CLOSEOUT_NOTIFY_SQL, PIPELINE_NEW_CLIENT_SQL,
  SOCIAL_APPROVED_SQL, SOCIAL_QUEUED_SQL,
  CORE_PACK_SUBTYPES, CONTRACT_DEFAULTS, COMBINED_CONTRACT_KEY, DECK_CONTRACT_KEYS, SALE_CONTRACT_KEYS,
  LETTERS_EMAIL_KEY, DELIVERABLES_EMAIL_KEY
} from "./fin-b04-sql-flows.mjs";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
export const NOW = "2026-10-14T20:00:00.000Z";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RECENT = "2026-10-13T20:00:00.000Z";
const LONG_AGO = "2026-08-01T20:00:00.000Z";
const JUST_NOW = "2026-10-14T19:50:00.000Z";
const THREE_DAYS_AGO = "2026-10-11T20:00:00.000Z";

const CLIENT = id(100);
const STAFF = id(101);
const OTHER_STAFF = id(103);
const CONVO = id(110);
const INTERNAL_CONVO = id(111);
const SHIFT = id(120);

const client = (extra = {}) => ({
  id: CLIENT, org_id: ORG, email: "pat@example.test", phone: "+15555550100", first_name: "Pat", last_name: "Example",
  custom_fields: {}, tags: [], is_demo: false, created_at: LONG_AGO, ...extra
});
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
  for (const r of out.orgs || []) r.id = OTHER_ORG;
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

// last_attempt_at is the claim that sent it: 13:00:05 in Arizona, in the middle of the day.
const staffText = (extra = {}) => ({
  id: id(2), org_id: ORG, client_id: CLIENT, conversation_id: CONVO, direction: "outbound", channel: "sms",
  rendered_body: "Your documents are in.", provider: "twilio", provider_message_id: "SM-FAKE-1", status: "sent",
  sender_kind: "staff", sender_staff_id: STAFF, scheduled_at: null, attempts: 1, is_demo: false,
  created_at: RECENT, last_attempt_at: "2026-10-13T20:00:05.000Z", ...extra
});

const staffSendTables = () => ({
  messages: [staffText()], staff: [staff()], clients: [client()], conversations: [thread()],
  staff_events: [{ id: id(3), org_id: ORG, kind: "text_sent", shift_id: SHIFT, detail: { message_id: id(2) } }],
  shifts: [{ id: SHIFT, org_id: ORG, staff_id: STAFF, started_at: "2026-10-13T15:00:00.000Z", ended_at: null }],
  opt_outs: []
});

/** Put the text out of the building at this moment (and write it then). */
const sentAt = (t, iso) => {
  t.messages[0].created_at = iso;
  t.messages[0].last_attempt_at = iso;
  t.shifts[0].started_at = "2026-10-12T00:00:00.000Z";
};

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
  ["the text_sent event is on a shift that began after the text, though another shift covers it", (t) => {
    t.shifts.push({ id: id(121), org_id: ORG, staff_id: STAFF, started_at: "2026-10-13T21:00:00.000Z", ended_at: null });
    t.staff_events[0].shift_id = id(121);
  }],
  ["the text_sent event is on a shift that ended before the text, though another shift covers it", (t) => {
    t.shifts.push({ id: id(122), org_id: ORG, staff_id: STAFF, started_at: "2026-10-13T10:00:00.000Z", ended_at: "2026-10-13T19:00:00.000Z" });
    t.staff_events[0].shift_id = id(122);
  }],
  ["an inbox text with its own idempotency key still needs the shift", (t) => {
    t.messages[0].provider_ref = "staff:inbox-key-9"; t.staff_events = [];
  }],
  ["an email was written with nobody clocked in (email logs no event, the shift gate still held)", (t) => {
    t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = []; t.shifts = [];
  }],
  ["an email was written while only another person had a shift open", (t) => {
    t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = []; t.shifts[0].staff_id = id(777);
  }],
  ["the text failed and nothing reached the client after it", (t) => {
    Object.assign(t.messages[0], { status: "failed", provider: null, provider_message_id: null, last_error: "provider said no" });
    t.staff_events = [];
  }],
  ["the text failed and only an email went out after it", (t) => {
    Object.assign(t.messages[0], { status: "failed", provider: null, provider_message_id: null, last_error: "provider said no" });
    t.staff_events = [];
    t.messages.push({ id: id(60), org_id: ORG, client_id: CLIENT, channel: "email", direction: "outbound", sender_kind: "system",
      status: "sent", created_at: "2026-10-13T21:00:00.000Z" });
  }],
  ["the text failed and only a text sent before it had gone out", (t) => {
    Object.assign(t.messages[0], { status: "failed", provider: null, provider_message_id: null, last_error: "provider said no" });
    t.staff_events = [];
    t.messages.push({ id: id(60), org_id: ORG, client_id: CLIENT, channel: "sms", direction: "outbound", sender_kind: "system",
      status: "sent", created_at: "2026-10-13T10:00:00.000Z" });
  }],
  ["the text failed and a text went to another client after it", (t) => {
    Object.assign(t.messages[0], { status: "failed", provider: null, provider_message_id: null, last_error: "provider said no" });
    t.staff_events = [];
    t.messages.push({ id: id(60), org_id: ORG, client_id: id(998), channel: "sms", direction: "outbound", sender_kind: "system",
      status: "sent", created_at: "2026-10-13T21:00:00.000Z" });
  }],
  ["the text failed and a text after it failed too", (t) => {
    Object.assign(t.messages[0], { status: "failed", provider: null, provider_message_id: null, last_error: "provider said no" });
    t.staff_events = [];
    t.messages.push({ id: id(60), org_id: ORG, client_id: CLIENT, channel: "sms", direction: "outbound", sender_kind: "system",
      status: "failed", created_at: "2026-10-13T21:00:00.000Z" });
  }],
  ["a queued text sat in the queue for three days", (t) => {
    Object.assign(t.messages[0], { status: "queued", provider: null, provider_message_id: null, created_at: THREE_DAYS_AGO, attempts: 0 });
    t.shifts[0].started_at = "2026-10-10T00:00:00.000Z"; t.staff_events = [];
  }],
  ["a text stuck in sending for three days", (t) => {
    Object.assign(t.messages[0], { status: "sending", provider: null, provider_message_id: null, created_at: THREE_DAYS_AGO, attempts: 1 });
    t.shifts[0].started_at = "2026-10-10T00:00:00.000Z"; t.staff_events = [];
  }],
  ["the text went to a client who had opted out of texts", (t) => {
    t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: null }];
  }],
  ["the client opted back in only after the text went out", (t) => {
    t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: "2026-10-13T22:00:00.000Z" }];
  }],
  ["the email went to a client who had opted out of email", (t) => {
    t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = [];
    t.opt_outs = [{ client_id: CLIENT, channel: "email", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: null }];
  }],
  ["a text went out at 3 am Arizona with no schedule", (t) => { sentAt(t, "2026-10-14T10:00:00.000Z"); }],
  ["a text went out at 8:05 pm Arizona with no schedule", (t) => { sentAt(t, "2026-10-15T03:05:00.000Z"); }],
  ["a text went out at 7:50 am Arizona with no schedule", (t) => { sentAt(t, "2026-10-14T14:50:00.000Z"); }]
];

const STAFF_SEND_OK = [
  ["a pay link text from the closer deck is sent with no shift", (t) => {
    t.messages[0].provider_ref = "staff:pay-link-sms:link-1"; t.staff_events[0].shift_id = null;
  }],
  ["a soft-pull text from the closer deck is sent with no shift", (t) => {
    t.messages[0].provider_ref = "staff:soft-pull-sms:link-2"; t.staff_events = [];
  }],
  ["a pay link email from the closer deck is sent with nobody clocked in", (t) => {
    t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = []; t.shifts = [];
    t.messages[0].provider_ref = "staff:pay-link-send:link-3";
  }],
  ["a soft-pull email from the closer deck is sent with nobody clocked in", (t) => {
    t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = []; t.shifts = [];
    t.messages[0].provider_ref = "staff:soft-pull-send:link-4";
  }],
  ["a blocked text to a client who opted out is the gate doing its job", (t) => {
    t.messages[0].status = "blocked"; t.messages[0].provider = null; t.messages[0].provider_message_id = null; t.staff_events = [];
    t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: null }];
  }],
  ["a text that is still queued, written before an opt-out that came later", (t) => {
    Object.assign(t.messages[0], { status: "queued", provider: null, provider_message_id: null, created_at: JUST_NOW });
    t.staff_events = [];
    t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: null }];
  }],
  ["an owner is not asked for a shift", (t) => { t.staff[0].role = "owner"; t.staff_events = []; t.shifts = []; }],
  ["a text held overnight and still waiting, claimed at night", (t) => {
    Object.assign(t.messages[0], { status: "queued", provider: null, provider_message_id: null, attempts: 0,
      created_at: "2026-10-14T05:00:00.000Z", last_attempt_at: "2026-10-14T05:00:30.000Z", scheduled_at: "2026-10-14T15:00:00.000Z" });
    t.staff_events = []; t.shifts[0].started_at = "2026-10-14T00:00:00.000Z";
  }],
  ["a text held overnight is sent later by the sweeper, with no event", (t) => {
    t.staff_events = []; t.messages[0].scheduled_at = "2026-10-13T15:00:00.000Z";
    t.messages[0].created_at = "2026-10-13T05:00:00.000Z"; t.shifts[0].started_at = "2026-10-13T00:00:00.000Z";
  }],
  ["a text sent on a retry is sent by the sweeper, with no event", (t) => { t.staff_events = []; t.messages[0].attempts = 2; }],
  ["a queued text has no receipt and no event yet", (t) => {
    Object.assign(t.messages[0], { status: "queued", provider: null, provider_message_id: null, created_at: JUST_NOW });
    t.staff_events = [];
  }],
  ["a text being sent right now", (t) => {
    Object.assign(t.messages[0], { status: "sending", provider: null, provider_message_id: null, created_at: JUST_NOW });
    t.staff_events = [];
  }],
  ["a blocked text has no receipt", (t) => {
    t.messages[0].status = "blocked"; t.messages[0].provider = null; t.messages[0].provider_message_id = null; t.staff_events = [];
  }],
  ["an email needs no text_sent event", (t) => { t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = []; }],
  ["the text failed but a text reached the client after it", (t) => {
    Object.assign(t.messages[0], { status: "failed", provider: null, provider_message_id: null, last_error: "provider said no" });
    t.staff_events = [];
    t.messages.push({ id: id(60), org_id: ORG, client_id: CLIENT, channel: "sms", direction: "outbound", sender_kind: "system",
      status: "sent", created_at: "2026-10-13T21:00:00.000Z" });
  }],
  ["the client opted out only after the text went out", (t) => {
    t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T21:00:00.000Z", opted_in_at: null }];
  }],
  ["the client had opted out and opted back in before the text", (t) => {
    t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: "2026-10-13T12:00:00.000Z" }];
  }],
  ["the client opted out of email only, and this is a text", (t) => {
    t.opt_outs = [{ client_id: CLIENT, channel: "email", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: null }];
  }],
  ["a text at 7:59:30 am Arizona is inside the minute left on the edge", (t) => { sentAt(t, "2026-10-14T14:59:30.000Z"); }],
  ["a text at 8:00:30 pm Arizona is inside the minute left on the edge", (t) => { sentAt(t, "2026-10-15T03:00:30.000Z"); }],
  ["a prove file may be texted at night", (t) => {
    sentAt(t, "2026-10-14T10:00:00.000Z"); t.clients[0].email = "e2e+night@example.test";
  }],
  ["a sim file may be texted at night", (t) => {
    sentAt(t, "2026-10-14T10:00:00.000Z"); t.clients[0].email = "pat+sim-1@example.test";
  }],
  ["an email at night is not a text", (t) => {
    sentAt(t, "2026-10-14T10:00:00.000Z");
    t.messages[0].channel = "email"; t.conversations[0].channel = "email"; t.staff_events = [];
  }]
];

const STAFF_SEND_IGNORED = [
  ["an internal note is not a client text or email", (t) => { t.messages[0].channel = "internal"; t.messages[0].client_id = null; }],
  ["a demo message is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].client_id = null; }],
  ["a message older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].client_id = null; }],
  ["a workflow message is not a staff reply", (t) => { t.messages[0].sender_kind = "system"; t.messages[0].client_id = null; }]
];

// ── contracts ───────────────────────────────────────────────────────────────

const CONTRACT = id(200);
const TEMPLATE = id(210);
const SIGNER = id(220);
const SECOND_SIGNER = id(221);
const PRODUCT = id(240);
const PAY_LINK = id(250);

// A funding sale: the funding agreement, the funding pay link, and the values the
// price list fills (src/config/offers.mjs defaultContractValues).
const contractTables = () => ({
  contracts: [{
    id: CONTRACT, org_id: ORG, client_id: CLIENT, template_id: TEMPLATE, template_key: "FUNDING-AGREEMENT",
    status: "sent", sent_at: RECENT, sent_by: STAFF, link_expires_at: "2026-10-20T20:00:00.000Z", document_id: id(260),
    merge_values: { deposit: "$3,000", success_fee: "10% of approved funding", fee_due: "within 7 days of funding" },
    source_kind: "text", is_demo: false
  }],
  contract_templates: [{
    id: TEMPLATE, org_id: ORG, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement", active: true,
    source_kind: "text", body: "This agreement is made between the parties.", signature_statement: "I agree.",
    manual_fields: [{ key: "deposit", label: "Deposit", required: true }, { key: "note", label: "Note", required: false }],
    is_demo: false
  }],
  clients: [client()],
  staff: [staff()],
  contract_signers: [{ id: SIGNER, org_id: ORG, contract_id: CONTRACT, signer_index: 0, name: "Pat", email: "pat@example.test" }],
  messages: [{
    id: id(230), org_id: ORG, provider_ref: `contract:${CONTRACT}:${SIGNER}:send`, to_address: "pat@example.test",
    status: "sent", created_at: RECENT
  }],
  payment_links: [{ id: PAY_LINK, org_id: ORG, client_id: CLIENT, product_id: PRODUCT }],
  products: [{ id: PRODUCT, org_id: ORG, code: "card-stacking-dfy" }],
  client_authorized_reps: [],
  accounts: []
});

/** The wording of the contract. With one wording row (the contract's own) the row is
    renamed; on the deck's company table the contract is pointed at that wording's
    row (made if the company has none), so the deck's list stays whole. */
let wordingRowSeed = 5000;
const useWording = (t, key) => {
  t.contracts[0].template_key = key;
  if (!t.orgs) { t.contract_templates[0].template_key = key; return; }
  let row = t.contract_templates.find((w) => w.template_key === key);
  if (!row) {
    row = { id: id(wordingRowSeed += 1), org_id: ORG, template_key: key, name: key, active: true, source_kind: "text",
      body: "This agreement is made between the parties.", signature_statement: "I agree.", manual_fields: [], is_demo: false };
    t.contract_templates.push(row);
  }
  t.contracts[0].template_id = row.id;
};

/** Use this wording and fill it the way the price list does, so only the wording
    can be wrong. The contract's single required blank is dropped. */
const useWordingFilled = (t, key) => {
  useWording(t, key);
  t.contracts[0].merge_values = { ...CONTRACT_DEFAULTS[key] };
  const row = t.contract_templates.find((w) => w.id === t.contracts[0].template_id);
  row.manual_fields = [];
};

const OFFERS_WITH_CONTRACT = Object.values(OFFERS).filter((o) => o.contractTemplateKey);
/** A wording that is not one of this offer's. */
const WRONG_FOR = (offer) => (offer.key === "FUNDING_DFY" ? "CREDIT-REPAIR-AGREEMENT" : "FUNDING-AGREEMENT");
const SOLD_FOR = (offer) => [offer.contractTemplateKey, ...(offer.key === "FUNDING_DFY" ? [COMBINED_CONTRACT_KEY] : [])];
const chooseByPayLink = (t, offer) => { t.products[0].code = offer.productCode; };
const chooseByCall = (t, offer) => {
  t.payment_links = [];
  t.clients[0].custom_fields = { closer_deck_disposition: { offer_key: offer.key, route: "ROUTE" } };
};

const CONTRACT_IGNORED = [
  ["a draft was never sent", (t) => { t.contracts[0].sent_at = null; t.clients = []; }],
  ["a demo contract is not judged", (t) => { t.contracts[0].is_demo = true; t.clients = []; }],
  ["a contract sent over 30 days ago is not judged", (t) => { t.contracts[0].sent_at = LONG_AGO; t.clients = []; }],
  // A test fixture on a demo client, broken on purpose: counted, it would be red.
  ["a broken contract on a demo client is not judged", (t) => { t.clients[0].is_demo = true; t.contracts[0].document_id = null; }]
];

/** Breaks and ok variants about WHICH wording went out, shared by the contract queries. */
const CONTRACT_WORDING_BREAKS = [
  ["a funding sale was sent the credit-repair agreement", (t) => { useWording(t, "CREDIT-REPAIR-AGREEMENT"); }],
  ["a funding sale was sent the funding mastery agreement", (t) => { useWording(t, "FUNDING-MASTERY-AGREEMENT"); }],
  ["the client chose repair only and was sent the funding agreement", (t) => {
    t.products[0].code = "repair-bundle";
  }],
  ["the call was logged as funding and the repair agreement went out", (t) => {
    t.payment_links = []; t.clients[0].custom_fields = { closer_deck_disposition: { offer_key: "FUNDING_DFY", route: "FULL_FUNDING" } };
    useWording(t, "CREDIT-REPAIR-AGREEMENT");
  }]
];

// One break per offer and per way the file shows it: the offer was chosen (a pay link
// for its product, or the call logged with its key) and a wording it does not sell went out.
const CONTRACT_WORDING_BREAKS_BY_OFFER = OFFERS_WITH_CONTRACT.flatMap((offer) => [
  [`${offer.key} was chosen by its pay link and the wrong agreement went out`, (t) => {
    chooseByPayLink(t, offer); useWordingFilled(t, WRONG_FOR(offer));
  }],
  [`${offer.key} was logged on the call and the wrong agreement went out`, (t) => {
    chooseByCall(t, offer); useWordingFilled(t, WRONG_FOR(offer));
  }]
]);
const CONTRACT_WORDING_OK_BY_OFFER = OFFERS_WITH_CONTRACT.flatMap((offer) => SOLD_FOR(offer).flatMap((key) => [
  [`${offer.key} was chosen by its pay link and ${key} went out`, (t) => { chooseByPayLink(t, offer); useWordingFilled(t, key); }],
  [`${offer.key} was logged on the call and ${key} went out`, (t) => { chooseByCall(t, offer); useWordingFilled(t, key); }]
]));

CONTRACT_WORDING_BREAKS.push(
  ["another client's funding link does not make this client's repair sale a funding one", (t) => {
    t.products[0].code = "repair-bundle";
    t.products.push({ id: id(242), org_id: ORG, code: "card-stacking-dfy" });
    t.payment_links.push({ id: id(252), org_id: ORG, client_id: id(998), product_id: id(242) });
  }]
);

const CONTRACT_WORDING_OK = [
  ["a funding sale sent the combined funding plus repair agreement", (t) => { useWording(t, "REPAIR-AND-FUNDING-AGREEMENT"); }],
  ["the client has a funding link and a repair-trial link, and the funding agreement went out", (t) => {
    t.products.push({ id: id(241), org_id: ORG, code: "repair-trial" });
    t.payment_links.push({ id: id(251), org_id: ORG, client_id: CLIENT, product_id: id(241) });
  }],
  ["the client stepped down to the trial and the trial agreement went out", (t) => {
    t.products.push({ id: id(241), org_id: ORG, code: "repair-trial" });
    t.payment_links.push({ id: id(251), org_id: ORG, client_id: CLIENT, product_id: id(241) });
    useWording(t, "REPAIR-TRIAL-AGREEMENT");
  }],
  ["the call was logged as funding and the funding agreement went out", (t) => {
    t.payment_links = []; t.clients[0].custom_fields = { closer_deck_disposition: { offer_key: "FUNDING_DFY", route: "FULL_FUNDING" } };
  }],
  ["nothing on the file says what was chosen yet", (t) => { t.payment_links = []; useWording(t, "CREDIT-REPAIR-AGREEMENT"); }],
  ["a wording the catalogue does not sell is not judged against the offer", (t) => { useWording(t, "PARTNER-LICENSE"); }],
  ["a mismatched wording sent less than an hour ago may still have its pay link coming", (t) => {
    useWording(t, "CREDIT-REPAIR-AGREEMENT"); t.contracts[0].sent_at = JUST_NOW; t.messages = [];
  }]
];

// ── funding rounds ──────────────────────────────────────────────────────────

const PIPELINE = id(340);
const STAGE = id(341);

function roundTables({ event, stage, texts = [], emails = [], amount = null }) {
  const eventId = id(300);
  const rn = 2;
  return {
    cards: [{ id: id(330), org_id: ORG, client_id: CLIENT, pipeline_id: PIPELINE, stage_id: STAGE, entered_at: RECENT }],
    pipelines: [{ id: PIPELINE, org_id: ORG, key: "funding_card_stacking" }],
    pipeline_stages: [{ id: STAGE, org_id: ORG, pipeline_id: PIPELINE, key: stage }],
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
    messages: [...texts, ...emails].map((key, i) => ({
      id: id(320 + i), org_id: ORG, provider_ref: `workflow:${key}:${eventId}`, status: "sent", created_at: RECENT
    })),
    opt_outs: []
  };
}

function roundBreaks({ texts, emails, stage, event }) {
  const out = [
    ["the card was dropped and its round event was lost: no event, no round row, no text", (t) => {
      t.events = []; t.funding_rounds = []; t.messages = [];
    }],
    ["the event is for another client", (t) => { t.events[0].client_id = id(999); }],
    ["the stage word is wrong", (t) => { t.events[0].payload.stage = "funded"; }],
    ["the source is wrong", (t) => { t.events[0].payload.source = "lendflow"; }],
    ["the rail is wrong", (t) => { t.events[0].payload.rail = "alt_fin"; }],
    ["the product is wrong", (t) => { t.events[0].payload.product = "diy"; }],
    ["the round number is not a positive whole number", (t) => {
      t.events[0].payload.roundNumber = 0;
      t.events[0].idempotency_key = `card_stacking:${CLIENT}:0:${stage}:${event}`;
      t.funding_rounds[0].round_number = 0;
    }],
    ["the saved key does not match client, round, stage and event", (t) => { t.events[0].idempotency_key = "card_stacking:wrong"; }],
    ["the saved key names another round from the one in the event", (t) => {
      t.events[0].idempotency_key = `card_stacking:${CLIENT}:7:${stage}:${event}`;
    }],
    ["only a different round event exists for the card", (t) => {
      t.events[0].name = "round.funded"; t.events[0].idempotency_key = `card_stacking:${CLIENT}:2:${stage}:round.funded`;
    }],
    ["opted out of email only: the text is still owed", (t) => {
      t.messages = t.messages.filter((m) => !m.provider_ref.includes(":SMS-"));
      t.opt_outs = [{ client_id: CLIENT, channel: "email", opted_in_at: null }];
    }],
    ["opted out of texts and back in: the text is owed", (t) => {
      t.messages = t.messages.filter((m) => !m.provider_ref.includes(":SMS-"));
      t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_in_at: "2026-10-13T22:00:00.000Z" }];
    }],
    ["no round row an hour later", (t) => { t.funding_rounds = []; }],
    ["the round row is for another round number", (t) => { t.funding_rounds[0].round_number = 1; }]
  ];
  for (const key of texts) {
    out.push([`no text (${key}) an hour later`, (t) => { t.messages = t.messages.filter((m) => !m.provider_ref.includes(key)); }]);
    out.push([`the text (${key}) failed`, (t) => {
      for (const m of t.messages) if (m.provider_ref.includes(key)) m.status = "failed";
    }]);
    out.push([`the text (${key}) sat queued for three days`, (t) => {
      for (const m of t.messages) if (m.provider_ref.includes(key)) { m.status = "queued"; m.created_at = THREE_DAYS_AGO; }
    }]);
  }
  for (const key of emails) {
    out.push([`no email (${key}) an hour later`, (t) => { t.messages = t.messages.filter((m) => !m.provider_ref.includes(key)); }]);
    out.push([`the email (${key}) failed`, (t) => {
      for (const m of t.messages) if (m.provider_ref.includes(key)) m.status = "failed";
    }]);
    out.push([`the email (${key}) sat sending for three days`, (t) => {
      for (const m of t.messages) if (m.provider_ref.includes(key)) { m.status = "sending"; m.created_at = THREE_DAYS_AGO; }
    }]);
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
    ["the topic is only a colon", (t) => { t.messages[0].rendered_body = "I would like a call about:"; }],
    ["the topic is the word undefined", (t) => { t.messages[0].rendered_body = "I would like a call about: undefined"; }],
    ["the topic is the word null", (t) => { t.messages[0].rendered_body = "I would like a call about: null"; }],
    ["the topic is NaN", (t) => { t.messages[0].rendered_body = "I would like a call about: NaN"; }],
    ["the topic is [object Object]", (t) => { t.messages[0].rendered_body = "I would like a call about: [object Object]"; }],
    ["the topic is undefined with trailing spaces", (t) => { t.messages[0].rendered_body = "I would like a call about: Undefined  "; }],
    ["no client on the request", (t) => { t.messages[0].client_id = null; }],
    ["the request is not on a thread", (t) => { t.messages[0].conversation_id = null; }],
    ["the thread is another client's", (t) => { t.conversations[0].client_id = id(999); }],
    ["the thread is on another channel", (t) => { t.conversations[0].channel = "email"; }]
  ],
  { ok: [
    ["a topic that only starts like a broken word", (t) => { t.messages[0].rendered_body = "I would like a call about: Nullifying a lien"; }],
    ["a topic that has more words after undefined", (t) => { t.messages[0].rendered_body = "I would like a call about: undefined behavior in my file"; }]
  ], ignored: [
    ["an ordinary note is not a call request", (t) => { t.messages[0].rendered_body = "Thanks!"; t.messages[0].client_id = null; }],
    ["an outbound row is not a client request", (t) => { t.messages[0].direction = "outbound"; t.messages[0].client_id = null; }],
    ["a staff row is not a client request", (t) => { t.messages[0].sender_kind = "staff"; t.messages[0].client_id = null; }],
    ["a row from a text provider is not a portal request", (t) => { t.messages[0].provider = "twilio"; t.messages[0].client_id = null; }],
    ["a demo request is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].client_id = null; }],
    ["a request older than 30 days is not judged", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].client_id = null; }]
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
    conversation_participants: note.conversation_participants,
    opt_outs: []
  };
};

add("chat-widget", CHAT_WIDGET_SQL, chatWidgetTables,
  [
    ...STAFF_SEND_BREAKS.map(([label, fn, want]) => [`client text: ${label}`, fn, want ? { sample: want.sample + 1, bad: want.bad } : undefined]),
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
    ["a staff voice row is not a text or a note", (t) => { t.messages[1].channel = "voice"; t.messages[1].client_id = CLIENT; }],
    ["an owner-ops text to the owner's own phone is not a widget send", (t) => {
      Object.assign(t.messages[1], { channel: "sms", client_id: null, conversation_id: null, provider: "twilio", provider_ref: "owner-ops:teleprompter-2026-10-07" });
    }]
  ].map(([label, fn]) => [label, (t) => { fn(t); t.messages = [t.messages[1]]; }]) });

const RULE = (extra = {}) => ({
  id: id(70), org_id: ORG, active: true, match_type: "phrase", pattern: "guaranteed funding", severity: "block",
  platforms: [], updated_at: LONG_AGO, ...extra
});
const OPT_OUT_SMS = { client_id: CLIENT, channel: "sms", opted_out_at: "2026-10-13T10:00:00.000Z", opted_in_at: null };
// the blocked text (message 0), and below, a text that went out (message 1)
const blockedTables = () => ({
  messages: [staffText({ status: "blocked", provider: null, provider_message_id: null, blocked_reason: "guaranteed_funding", blocked_at: RECENT })],
  tasks: [{ id: id(500), org_id: ORG, source_workflow: "messaging-gate", body: `${id(2)}:guaranteed_funding`, assignee_role: "admin" }],
  compliance_rules: [
    RULE({ pattern: "no match anywhere in these words" }),
    RULE({ id: id(71), match_type: "regex", pattern: "(guarantee\\w*|assured)[^.!?]{0,30}(approv|accept)" })
  ],
  opt_outs: []
});
const withSent = (t, extra = {}) => {
  t.messages.push(staffText({ id: id(4), rendered_body: "Your documents are in.", ...extra }));
};
const TWO = { sample: 2, bad: 1 };
const TWO_CLEAN = { sample: 2, bad: 0 };

add("message-blocked", MESSAGE_BLOCKED_SQL, blockedTables,
  [
    ["the words are blank", (t) => { t.messages[0].rendered_body = ""; }],
    ["no reason is recorded", (t) => { t.messages[0].blocked_reason = null; t.messages[0].last_error = null; }],
    ["a reason with no time", (t) => { t.messages[0].blocked_at = null; }],
    ["restricted wording and no task raised", (t) => { t.tasks = []; }],
    ["restricted wording and the task has no owner", (t) => { t.tasks[0].assignee_role = null; }],
    ["restricted wording and the task is given to a role nobody holds", (t) => { t.tasks[0].assignee_role = "janitor"; }],
    ["the task is for a different message", (t) => { t.tasks[0].body = `${id(999)}:guaranteed_funding`; }],
    ["two codes, one of them restricted, no task", (t) => { t.messages[0].blocked_reason = "opted_out,guaranteed_funding"; t.tasks = []; }],
    ["a text went out to a client who was opted out", (t) => { withSent(t); t.opt_outs = [OPT_OUT_SMS]; }, TWO],
    ["an email went out to a client who was opted out of email", (t) => {
      withSent(t, { channel: "email" }); t.opt_outs = [{ ...OPT_OUT_SMS, channel: "email" }];
    }, TWO],
    ["a delivered text went out to a client who was opted out", (t) => {
      withSent(t, { status: "delivered" }); t.opt_outs = [OPT_OUT_SMS];
    }, TWO],
    ["a text went out with a restricted phrase in it (upper case words)", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE()];
    }, TWO],
    ["a text went out with words a restricted pattern matches", (t) => {
      withSent(t, { rendered_body: "We guarantee approval by Friday." });
    }, TWO]
  ],
  { ok: [
    ["opt-out only: no task is the right answer", (t) => { t.messages[0].blocked_reason = "opted_out"; t.tasks = []; }],
    ["two clearing codes: no task is the right answer", (t) => { t.messages[0].blocked_reason = "opted_out,quiet_hours"; t.tasks = []; }],
    ["a dispatcher block keeps its reason in last_error", (t) => {
      t.messages[0].blocked_reason = null; t.messages[0].blocked_at = null; t.messages[0].last_error = "draft_template"; t.tasks = [];
    }],
    ["a blank reason with the cause kept in last_error", (t) => {
      t.messages[0].blocked_reason = ""; t.messages[0].blocked_at = null; t.messages[0].last_error = "placeholder_copy"; t.tasks = [];
    }],
    ["a person closed the task after reading it", (t) => { t.tasks[0].done = true; }],
    ["a text to an opted-out client was blocked: the gate did its job", (t) => {
      t.opt_outs = [OPT_OUT_SMS]; t.messages[0].blocked_reason = "opted_out"; t.tasks = [];
    }],
    ["a text with a restricted phrase was blocked: the gate did its job", (t) => {
      t.messages[0].rendered_body = "We offer GUARANTEED FUNDING for you."; t.compliance_rules = [RULE()];
    }],
    ["a text went out cleanly", (t) => { withSent(t); }, TWO_CLEAN],
    ["a text went out and the client opted out only after it", (t) => {
      withSent(t); t.opt_outs = [{ ...OPT_OUT_SMS, opted_out_at: "2026-10-13T21:00:00.000Z" }];
    }, TWO_CLEAN],
    ["a text went out and the client had opted back in", (t) => {
      withSent(t); t.opt_outs = [{ ...OPT_OUT_SMS, opted_in_at: "2026-10-13T12:00:00.000Z" }];
    }, TWO_CLEAN],
    ["a text went out to a client opted out of email only", (t) => {
      withSent(t); t.opt_outs = [{ ...OPT_OUT_SMS, channel: "email" }];
    }, TWO_CLEAN],
    ["a text went out with words only a warning rule matches", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE({ severity: "warn" })];
    }, TWO_CLEAN],
    ["a text went out with words an ad-only rule matches", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE({ platforms: ["meta"] })];
    }, TWO_CLEAN],
    ["a text went out with words only another company's rule matches", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE({ org_id: OTHER_ORG })];
    }, TWO_CLEAN],
    ["a text went out with words an inactive rule matches", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE({ active: false })];
    }, TWO_CLEAN],
    ["a text went out and the rule was written after it", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE({ updated_at: "2026-10-14T09:00:00.000Z" })];
    }, TWO_CLEAN],
    ["a text went out with words a presence rule asks for", (t) => {
      withSent(t, { rendered_body: "We offer GUARANTEED FUNDING for you." });
      t.compliance_rules = [RULE({ match_type: "required" })];
    }, TWO_CLEAN]
  ], ignored: [
    ["an inbound row is not a staff reply", (t) => { t.messages[0].direction = "inbound"; t.messages[0].rendered_body = ""; }],
    ["a voice row is not a text or email", (t) => { t.messages[0].channel = "voice"; t.messages[0].rendered_body = ""; }],
    ["a demo block is not judged", (t) => { t.messages[0].is_demo = true; t.messages[0].rendered_body = ""; }],
    ["a workflow's blocked text is not a staff reply", (t) => { t.messages[0].sender_kind = "system"; t.messages[0].rendered_body = ""; }],
    ["a text still waiting is not a result yet", (t) => { t.messages[0].status = "queued"; t.messages[0].rendered_body = ""; }],
    ["a failed text is judged by the reply query, not this one", (t) => { t.messages[0].status = "failed"; t.messages[0].rendered_body = ""; }],
    ["a blocked text older than 30 days", (t) => { t.messages[0].created_at = LONG_AGO; t.messages[0].rendered_body = ""; }]
  ] });

// A text held overnight: written at 10:00 pm Arizona the night before, claimed and
// put back on the queue at that moment, due at the next 8:00 am Arizona (15:00 UTC).
const heldTables = () => ({
  messages: [staffText({
    status: "queued", provider: null, provider_message_id: null, created_at: "2026-10-14T05:00:00.000Z",
    last_attempt_at: "2026-10-14T05:00:30.000Z", scheduled_at: "2026-10-14T15:00:00.000Z", attempts: 0
  })],
  clients: [client()]
});
const wentOut = (t, iso, extra = {}) => {
  Object.assign(t.messages[0], { status: "sent", provider: "twilio", provider_message_id: "SM-1", scheduled_at: null,
    created_at: iso, last_attempt_at: iso, attempts: 1, ...extra });
};
add("message-held", MESSAGE_HELD_SQL, heldTables,
  [
    ["an email was held", (t) => { t.messages[0].channel = "email"; }],
    ["an inbound row was held", (t) => { t.messages[0].direction = "inbound"; }],
    ["held to a time before it was written", (t) => { t.messages[0].scheduled_at = "2026-10-14T04:00:00.000Z"; }],
    ["held to an 8 am that had already passed", (t) => {
      t.messages[0].created_at = "2026-10-14T19:00:00.000Z"; t.messages[0].last_attempt_at = "2026-10-14T19:00:30.000Z";
      t.messages[0].scheduled_at = "2026-10-14T15:00:00.000Z";
    }],
    ["held to 9 am Arizona, not 8", (t) => { t.messages[0].scheduled_at = "2026-10-14T16:00:00.000Z"; }],
    ["held to 8:30 am Arizona", (t) => { t.messages[0].scheduled_at = "2026-10-14T15:30:00.000Z"; }],
    ["held to 8 am UTC, not Arizona", (t) => { t.messages[0].scheduled_at = "2026-10-14T08:00:00.000Z"; }],
    ["held a whole day too long (8 am Arizona the day after next)", (t) => { t.messages[0].scheduled_at = "2026-10-15T15:00:00.000Z"; }],
    ["held a week too long", (t) => { t.messages[0].scheduled_at = "2026-10-21T15:00:00.000Z"; }],
    ["held with no claim time recorded", (t) => { t.messages[0].last_attempt_at = null; }],
    ["the words are blank", (t) => { t.messages[0].rendered_body = ""; }],
    ["a text went out at 3 am Arizona with nothing holding it", (t) => { wentOut(t, "2026-10-14T10:00:00.000Z"); }],
    ["a delivered text went out at 9:30 pm Arizona with nothing holding it", (t) => {
      wentOut(t, "2026-10-15T04:30:00.000Z", { status: "delivered" });
    }],
    ["a text was blocked for quiet hours and will never go out", (t) => {
      Object.assign(t.messages[0], { status: "blocked", scheduled_at: null, blocked_reason: "quiet_hours", blocked_at: "2026-10-14T05:00:00.000Z" });
    }],
    ["a text was blocked for opt-out and for quiet hours together", (t) => {
      Object.assign(t.messages[0], { status: "blocked", scheduled_at: null, blocked_reason: "opted_out,quiet_hours", blocked_at: "2026-10-14T05:00:00.000Z" });
    }]
  ],
  { ok: [
    ["the held text went out at 8 am", (t) => {
      Object.assign(t.messages[0], { status: "sent", provider: "twilio", provider_message_id: "SM-1", attempts: 1,
        last_attempt_at: "2026-10-14T15:00:05.000Z" });
    }],
    ["held at 8:00 pm on the dot: the next 8 am is exactly 12 hours on", (t) => {
      t.messages[0].created_at = "2026-10-14T03:00:00.000Z"; t.messages[0].last_attempt_at = "2026-10-14T03:00:00.000Z";
      t.messages[0].scheduled_at = "2026-10-14T15:00:00.000Z";
    }],
    ["a text went out at 11 am Arizona", (t) => { wentOut(t, "2026-10-14T18:00:00.000Z"); }],
    ["an older sent text with no claim time recorded and no schedule", (t) => {
      wentOut(t, "2026-10-14T18:00:00.000Z"); t.messages[0].last_attempt_at = null;
    }],
    ["a text went out at 7:59:30 am Arizona, inside the minute left on the edge", (t) => { wentOut(t, "2026-10-14T14:59:30.000Z"); }],
    ["a prove file texted at night", (t) => { wentOut(t, "2026-10-14T10:00:00.000Z"); t.clients[0].email = "e2e+night@example.test"; }],
    ["a text blocked for opt-out only is the other control's", (t) => {
      Object.assign(t.messages[0], { status: "blocked", scheduled_at: null, blocked_reason: "opted_out", blocked_at: "2026-10-14T05:00:00.000Z" });
    }, { sample: 0, bad: 0 }]
  ], ignored: [
    ["an email with no schedule is not held", (t) => { t.messages[0].scheduled_at = null; t.messages[0].channel = "email"; }],
    ["an email sent at night is not a text", (t) => { wentOut(t, "2026-10-14T10:00:00.000Z", { channel: "email" }); }],
    ["a text still waiting with no schedule is not a result", (t) => { t.messages[0].scheduled_at = null; t.messages[0].last_attempt_at = null; }],
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

const CONTRACT_SENT_BREAKS = [
  ["the client row is gone", (t) => { t.clients = []; }],
  ["the wording row is gone", (t) => { t.contract_templates = []; }],
  ["the wording key differs from the contract's key", (t) => { t.contract_templates[0].template_key = "OTHER"; }],
  ["nobody is recorded as the sender", (t) => { t.contracts[0].sent_by = null; }],
  ["the sender is not on staff", (t) => { t.staff = []; }],
  ["no document was registered", (t) => { t.contracts[0].document_id = null; }],
  ["no link expiry", (t) => { t.contracts[0].link_expires_at = null; }],
  ["the link expires before it was sent", (t) => { t.contracts[0].link_expires_at = "2026-10-12T00:00:00.000Z"; }],
  ["nobody to sign it", (t) => {
    t.contract_signers = []; t.messages = []; t.clients[0].email = null;
  }],
  ["the client has an email and no email was queued", (t) => { t.messages = []; }],
  ["a signer has an email, the client has none, and no email was queued", (t) => { t.clients[0].email = null; t.messages = []; }],
  ["the client has an email, no signer does, and no email was queued", (t) => { t.contract_signers[0].email = null; t.messages = []; }],
  ["the signing email was addressed to a stranger", (t) => { t.messages[0].to_address = "stranger@example.test"; }],
  ["the signer's address was changed to a stranger's after the email was queued", (t) => {
    t.contract_signers[0].email = "stranger@example.test";
  }],
  ["the signing email belongs to a signer this contract does not have", (t) => {
    t.messages[0].provider_ref = `contract:${CONTRACT}:${id(999)}:send`;
  }],
  ["the signing email has no address", (t) => { t.messages[0].to_address = null; }],
  ["the signing email failed", (t) => { t.messages[0].status = "failed"; }],
  ["the signing email sat queued for three days", (t) => { t.messages[0].status = "queued"; t.messages[0].created_at = THREE_DAYS_AGO; }],
  ["the signing email sat sending for three days", (t) => { t.messages[0].status = "sending"; t.messages[0].created_at = THREE_DAYS_AGO; }],
  ["the second signer's email failed while the first signer's went out", (t) => {
    t.contract_signers.push({ id: SECOND_SIGNER, org_id: ORG, contract_id: CONTRACT, signer_index: 1, name: "Sam", email: "sam@example.test" });
    t.messages.push({ id: id(231), org_id: ORG, provider_ref: `contract:${CONTRACT}:${SECOND_SIGNER}:send`,
      to_address: "sam@example.test", status: "failed", created_at: RECENT });
  }],
  ["the signing email went to another client's representative", (t) => {
    t.messages[0].to_address = "rep@example.test";
    t.accounts = [{ id: id(270), org_id: ORG, email: "rep@example.test", kind: "authorized_rep", status: "active" }];
    t.client_authorized_reps = [{ client_id: id(998), account_id: id(270), org_id: ORG, removed_at: null }];
  }],
  ["the signing email went to a representative who has since been removed", (t) => {
    t.messages[0].to_address = "rep@example.test";
    t.accounts = [{ id: id(270), org_id: ORG, email: "rep@example.test", kind: "authorized_rep", status: "active" }];
    t.client_authorized_reps = [{ client_id: CLIENT, account_id: id(270), org_id: ORG, removed_at: "2026-10-13T00:00:00.000Z" }];
  }],
  ...CONTRACT_WORDING_BREAKS,
  ...CONTRACT_WORDING_BREAKS_BY_OFFER
];

const CONTRACT_SENT_OK = [
  ["no email on file anywhere: the link was handed over", (t) => {
    t.clients[0].email = null; t.contract_signers[0].email = null; t.messages = [];
  }],
  ["sent less than an hour ago: the email may still be coming", (t) => { t.contracts[0].sent_at = JUST_NOW; t.messages = []; }],
  ["a contract the client already signed", (t) => { t.contracts[0].status = "signed"; }],
  ["the first email failed and a resend went out to the same signer", (t) => {
    t.messages[0].status = "failed";
    t.messages.push({ id: id(231), org_id: ORG, provider_ref: `contract:${CONTRACT}:${SIGNER}:resend1`,
      to_address: "pat@example.test", status: "sent", created_at: "2026-10-13T21:00:00.000Z" });
  }],
  ["the signer's address differs only in capital letters", (t) => { t.messages[0].to_address = "Pat@Example.TEST"; }],
  ["the signing email went to the client's live representative", (t) => {
    t.messages[0].to_address = "rep@example.test";
    t.accounts = [{ id: id(270), org_id: ORG, email: "rep@example.test", kind: "authorized_rep", status: "active" }];
    t.client_authorized_reps = [{ client_id: CLIENT, account_id: id(270), org_id: ORG, removed_at: null }];
  }],
  ["the signing email is queued and an hour old", (t) => { t.messages[0].status = "queued"; t.messages[0].created_at = JUST_NOW; }],
  ["the signing email was blocked because the client opted out", (t) => { t.messages[0].status = "blocked"; }],
  ...CONTRACT_WORDING_OK,
  ...CONTRACT_WORDING_OK_BY_OFFER
];

add("contract-sent", CONTRACT_SENT_SQL, contractTables, CONTRACT_SENT_BREAKS,
  { ok: CONTRACT_SENT_OK, ignored: CONTRACT_IGNORED });

// The deck's Send contract row reads the company: every wording the deck can pick
// must exist and be real, and every contract sent lately must be right. The
// contract keeps its own wording row (index 0, the funding agreement); the deck's
// six wordings are separate rows beside it, so changing the contract's wording
// does not touch the list.
const deckSendTables = () => {
  const t = contractTables();
  t.orgs = [{ id: ORG }];
  // the contract's own wording row is the funding agreement's row on the deck's list
  t.contract_templates.push(...DECK_CONTRACT_KEYS.filter((key) => key !== "FUNDING-AGREEMENT").map((key, i) => ({
    id: id(400 + i), org_id: ORG, template_key: key, name: key, active: true,
    source_kind: "text", body: "This agreement is made between the parties.", signature_statement: "I agree.",
    manual_fields: [], is_demo: false
  })));
  return t;
};
const deckRowsOf = (t, key) => t.contract_templates.filter((w) => w.template_key === key);
// the same contract breaks, each one a break of the company-level row too
const CONTRACT_DECK_BREAKS = CONTRACT_SENT_BREAKS.map(([label, fn]) => [label, (t) => { fn(t); }]);
const CONTRACT_DECK_OK = [...CONTRACT_SENT_OK, ...CONTRACT_IGNORED];

add("contract-deck-send", CONTRACT_DECK_SEND_SQL, deckSendTables,
  [
    ...CONTRACT_DECK_BREAKS,
    ...DECK_CONTRACT_KEYS.flatMap((key) => [
      [`no wording exists for ${key}`, (t) => { t.contract_templates = t.contract_templates.filter((w) => w.template_key !== key); }],
      [`the wording for ${key} is switched off`, (t) => { for (const w of deckRowsOf(t, key)) w.active = false; }],
      [`the wording for ${key} is still placeholder text`, (t) => {
        for (const w of deckRowsOf(t, key)) w.body = ">>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. <<<";
      }],
      [`the wording for ${key} has no words`, (t) => { for (const w of deckRowsOf(t, key)) w.body = "  "; }],
      [`the only wording for ${key} is a demo one`, (t) => { for (const w of deckRowsOf(t, key)) w.is_demo = true; }]
    ])
  ],
  { ok: [
    ...CONTRACT_DECK_OK,
    ["an uploaded PDF wording has boxes, not words", (t) => {
      for (const w of deckRowsOf(t, "CREDIT-REPAIR-AGREEMENT")) { w.source_kind = "pdf"; w.body = null; }
    }],
    ["the soft-pull consent has no wording on the deck's list", (t) => {
      t.contract_templates.push({ id: id(498), org_id: ORG, template_key: "SOFT-PULL-CONSENT", name: "Consent",
        active: false, source_kind: "text", body: "", is_demo: false });
    }],
    ["the contract was sent on the combined agreement and the funding wording is on the list too", (t) => {
      useWording(t, "REPAIR-AND-FUNDING-AGREEMENT");
    }]
  ] });

add("contract-blanks", CONTRACT_BLANKS_SQL, contractTables,
  [
    ["a required blank is empty", (t) => { t.contracts[0].merge_values.deposit = ""; }],
    ["a required blank is missing", (t) => { delete t.contracts[0].merge_values.deposit; }],
    ["a required blank is only spaces", (t) => { t.contracts[0].merge_values.deposit = "   "; }],
    ["the wording row is gone", (t) => { t.contract_templates = []; }],
    ["a second required blank is empty", (t) => {
      t.contract_templates[0].manual_fields.push({ key: "days", label: "Days", required: true });
    }],
    ["the deposit was typed as 1, with no dollar sign", (t) => { t.contracts[0].merge_values.deposit = "1"; }],
    ["the deposit was typed as abc", (t) => { t.contracts[0].merge_values.deposit = "abc"; }],
    ["the deposit is the word undefined", (t) => { t.contracts[0].merge_values.deposit = "undefined"; }],
    ["the deposit is zero dollars", (t) => { t.contracts[0].merge_values.deposit = "$0"; }],
    ["the deposit has a bad comma", (t) => { t.contracts[0].merge_values.deposit = "$3,00"; }],
    ["the success fee names the funded amount, not approved funding", (t) => {
      t.contracts[0].merge_values.success_fee = "5% of funded amount";
    }],
    ["the success fee is zero percent", (t) => { t.contracts[0].merge_values.success_fee = "0% of approved funding"; }],
    ["the success fee is over 100 percent", (t) => { t.contracts[0].merge_values.success_fee = "150% of approved funding"; }],
    ["the success fee is missing on the funding agreement", (t) => { delete t.contracts[0].merge_values.success_fee; }],
    ["the success fee is words, not a percent", (t) => { t.contracts[0].merge_values.success_fee = "ten percent"; }],
    ["the due date wording was changed", (t) => { t.contracts[0].merge_values.fee_due = "on signing"; }],
    ["a repair agreement's fee was typed as a monthly figure", (t) => {
      useWording(t, "CREDIT-REPAIR-AGREEMENT");
      t.contract_templates[0].manual_fields = [{ key: "one_time_fee", label: "Fee", required: true }];
      t.contracts[0].merge_values = { one_time_fee: "$1,000 a month" };
      t.payment_links = []; t.clients[0].custom_fields = { closer_deck_disposition: { offer_key: "REPAIR_DFY", route: "REPAIR_ONLY" } };
    }],
    ["the repair-plus-funding agreement is missing the repair figure", (t) => {
      useWording(t, "REPAIR-AND-FUNDING-AGREEMENT");
      t.contracts[0].merge_values = { deposit: "$3,000", success_fee: "10% of approved funding", fee_due: "within 7 days of funding" };
    }],
    ...CONTRACT_WORDING_BREAKS,
    ...CONTRACT_WORDING_BREAKS_BY_OFFER,
    // each blank the price list fills, typed over once, on its own wording
    ...SALE_CONTRACT_KEYS.flatMap((key) => Object.keys(CONTRACT_DEFAULTS[key]).map((field) => [
      `${key}: ${field} was typed over`, (t) => {
        useWordingFilled(t, key); t.payment_links = [];
        t.contracts[0].merge_values = { ...CONTRACT_DEFAULTS[key], [field]: "typed over" };
      }
    ]))
  ],
  { ok: [
    ["an optional blank may stay empty", (t) => { t.contracts[0].merge_values.note = ""; }],
    // Owner-set 2026-10-20: the closer may set the deposit and the success-fee percent on the call.
    ["the closer set a lower deposit on the call", (t) => { t.contracts[0].merge_values.deposit = "$2,000"; }],
    ["the closer set a larger deposit without commas", (t) => { t.contracts[0].merge_values.deposit = "$10000.00"; }],
    ["the closer set another percent of approved funding", (t) => {
      t.contracts[0].merge_values.success_fee = "12.5% of approved funding";
    }],
    ["the closer typed the percent alone", (t) => { t.contracts[0].merge_values.success_fee = "8%"; }],
    ["the combined agreement carries closer-set figures", (t) => {
      useWording(t, "REPAIR-AND-FUNDING-AGREEMENT");
      t.contracts[0].merge_values = {
        deposit: "$1,500", repair_fee: "$1,000", success_fee: "15% of approved funding", fee_due: "within 7 days of funding",
        term_days: "180", repair_scope: "Parallel credit repair on limiting bureaus while funding rounds run.",
        funding_scope: "Full done-for-you funding program: matching, rounds, and inquiry sweeps."
      };
    }],
    ["a blank the price list does not fill may hold any words", (t) => { t.contracts[0].merge_values.note = "Call after 3 pm"; }],
    ["a wording the price list has no values for keeps what was typed", (t) => {
      useWording(t, "PARTNER-LICENSE");
      t.contract_templates[0].manual_fields = [{ key: "partner_name", label: "Partner", required: true }];
      t.contracts[0].merge_values = { partner_name: "Acme Partners" };
    }],
    ["the repair-plus-funding agreement holds every figure", (t) => {
      useWording(t, "REPAIR-AND-FUNDING-AGREEMENT");
      t.contracts[0].merge_values = {
        deposit: "$3,000", repair_fee: "$1,000", success_fee: "10% of approved funding", fee_due: "within 7 days of funding",
        term_days: "180", repair_scope: "Parallel credit repair on limiting bureaus while funding rounds run.",
        funding_scope: "Full done-for-you funding program: matching, rounds, and inquiry sweeps."
      };
    }],
    ["the client has a funding link and a repair-trial link, and the funding agreement went out", CONTRACT_WORDING_OK[1][1]],
    ["the call was logged as funding and the funding agreement went out", CONTRACT_WORDING_OK[3][1]],
    ["nothing on the file says what was chosen yet", (t) => { t.payment_links = []; useWordingFilled(t, "FUNDING-MASTERY-AGREEMENT"); }],
    ["a mismatched wording sent less than an hour ago may still have its pay link coming", (t) => {
      useWordingFilled(t, "CREDIT-REPAIR-AGREEMENT"); t.contracts[0].sent_at = JUST_NOW;
    }],
    ...CONTRACT_WORDING_OK_BY_OFFER
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
    messages: [{ id: id(810), org_id: ORG, client_id: CLIENT, template_key: DELIVERABLES_EMAIL_KEY, status: "sent", created_at: RECENT,
      provider_ref: `workflow:${DELIVERABLES_EMAIL_KEY}:closer-deck-letters:${CLIENT}:UWIQ_DELIVERABLES` }]
  };
};
const EDUCATION_ROUTE = { closer_deck_disposition: { route: "EDUCATION", offer_key: "UWIQ_DELIVERABLES" } };
const asRepairLetters = (t) => {
  t.documents = [LETTER_DOC({ source_event_id: `closer-deck-letters:${CLIENT}:UWIQ_DELIVERABLES:round1/ex.pdf` })];
  t.messages[0].template_key = LETTERS_EMAIL_KEY;
  t.messages[0].provider_ref = `workflow:${LETTERS_EMAIL_KEY}:closer-deck-letters:${CLIENT}:UWIQ_DELIVERABLES`;
};
add("deck-deliverables", DECK_DELIVERABLES_SQL, deliverablesTables,
  [
    ...CORE_PACK_SUBTYPES.map((subtype) => [`the ${subtype} file is missing`, (t) => {
      t.documents = t.documents.filter((d) => d.subtype !== subtype);
    }]),
    ...CORE_PACK_SUBTYPES.map((subtype, i) => [`the ${subtype} file only exists from an earlier workflow, not this button`, (t) => {
      t.documents[i].generated_by = "c-06-crs-results-router";
      t.documents[i].source_event_id = `c-06:${CLIENT}:${subtype}`;
    }]),
    ["a file is empty", (t) => { t.documents[0].byte_size = 0; }],
    ["a file has no storage key", (t) => { t.documents[1].storage_key = null; }],
    ["a file has no checksum", (t) => { t.documents[2].checksum = null; }],
    ["a file is on an offer that does not allow letters", (t) => {
      t.documents[3].source_event_id = `closer-deck-deliverables:${CLIENT}:FUNDING_DFY:bank_lender_match_list`;
    }],
    ["no delivery email an hour later", (t) => { t.messages = []; }],
    ["the delivery email is the letters email", (t) => { t.messages[0].template_key = LETTERS_EMAIL_KEY; }],
    ["the delivery email failed", (t) => { t.messages[0].status = "failed"; }],
    ["the delivery email sat queued for three days", (t) => { t.messages[0].status = "queued"; t.messages[0].created_at = THREE_DAYS_AGO; }],
    ["the education button saved the repair letter pack and no deliverables", (t) => {
      asRepairLetters(t); t.clients[0].custom_fields = EDUCATION_ROUTE;
    }],
    ["the education button saved the repair letter pack and no email went", (t) => {
      asRepairLetters(t); t.clients[0].custom_fields = EDUCATION_ROUTE; t.messages = [];
    }]
  ],
  { ok: [
    ["less than an hour old: the email may still be coming", (t) => {
      for (const d of t.documents) d.generated_at = JUST_NOW;
      t.messages = [];
    }],
    ["the delivery email is queued and an hour old", (t) => { t.messages[0].status = "queued"; t.messages[0].created_at = JUST_NOW; }],
    ["an earlier workflow also wrote a copy of a core file", (t) => {
      t.documents.push({ ...t.documents[0], id: id(899), generated_by: "c-06-crs-results-router", source_event_id: `c-06:${CLIENT}:x` });
    }]
  ], ignored: [
    ["a client with no closer-deck deliverables is not judged", (t) => {
      for (const d of t.documents) d.generated_by = "c-06-crs-results-router";
      t.documents[0].byte_size = 0;
    }],
    ["a repair-route client who got the letter pack is the other button's", (t) => {
      asRepairLetters(t); t.clients[0].custom_fields = { closer_deck_disposition: { route: "REPAIR_ONLY", offer_key: "REPAIR_DFY" } };
      t.documents[0].byte_size = 0;
    }],
    ["an education-route client whose letter pack is more than 30 days old", (t) => {
      asRepairLetters(t); t.clients[0].custom_fields = EDUCATION_ROUTE; t.documents[0].generated_at = LONG_AGO;
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
      ["a card in another column is another control's", (t) => { t.pipeline_stages[0].key = "funded"; t.events = []; }],
      ["a card on another board's column of the same name", (t) => { t.pipelines[0].key = "sales"; t.events = []; }],
      ["a card of a demo client", (t) => { t.clients[0].is_demo = true; t.events = []; }],
      ["a card that entered the column over 30 days ago", (t) => { t.cards[0].entered_at = LONG_AGO; t.events = []; }]
    ],
    ok: [
      ["less than an hour old: the follow-up may still be running", (t) => {
        t.cards[0].entered_at = JUST_NOW; t.events[0].created_at = JUST_NOW; t.messages = []; t.funding_rounds = [];
      }],
      ["a card dropped less than an hour ago whose event is not there yet", (t) => {
        t.cards[0].entered_at = JUST_NOW; t.events = []; t.messages = []; t.funding_rounds = [];
      }],
      ["the card re-entered the column after its round event was written", (t) => {
        t.cards[0].entered_at = "2026-10-14T18:00:00.000Z";
      }],
      ["a text queued an hour ago is still on its way", (t) => {
        for (const m of t.messages) { m.status = "queued"; m.created_at = JUST_NOW; }
      }],
      ["the text was delivered", (t) => { for (const m of t.messages) m.status = "delivered"; }],
      ...(spec.amount ? [
        ["no approved amount: the approvals workflow sends nothing", (t) => { delete t.events[0].payload.approvedAmount; t.messages = []; }],
        ["an approved amount of zero: the approvals workflow sends nothing", (t) => { t.events[0].payload.approvedAmount = 0; t.messages = []; }]
      ] : []),
      ...(spec.texts.length ? [
        ["opted out of texts: no text is right", (t) => {
          t.messages = t.messages.filter((m) => !m.provider_ref.includes(":SMS-"));
          t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_in_at: null }];
        }],
        ["opted out of texts and the text that existed failed", (t) => {
          for (const m of t.messages) if (m.provider_ref.includes(":SMS-")) m.status = "failed";
          t.opt_outs = [{ client_id: CLIENT, channel: "sms", opted_in_at: null }];
        }]
      ] : [])
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
    pipelines: [{ id: id(920), org_id: ORG, key: "sales" }],
    cards: [{ id: id(910), org_id: ORG, client_id: CLIENT, pipeline_id: id(920) }],
    messages: [
      { id: id(930), org_id: ORG, client_id: CLIENT, template_key: "EMAIL-S00-WELCOME", status: "sent", created_at: RECENT,
        provider_ref: `workflow:EMAIL-S00-WELCOME:${eventId}` },
      { id: id(931), org_id: ORG, client_id: CLIENT, template_key: "SMS-S00-WELCOME", status: "sent", created_at: RECENT,
        provider_ref: `workflow:SMS-S00-WELCOME:${eventId}` }
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
      t.clients[0].email = "not-an-email";
    }],
    ["no phone", (t) => { t.events[0].payload.phone = ""; }],
    ["the event carries a product that is not on the list", (t) => { t.events[0].payload.product = "gold-plan"; }],
    ["the client file holds a product that is not on the list", (t) => { t.clients[0].custom_fields.product = "gold-plan"; }],
    ["the client file holds no product", (t) => { t.clients[0].custom_fields = {}; }],
    ["the saved key does not match company and email", (t) => { t.events[0].idempotency_key = "pipeline-client:wrong"; }],
    ["the client file holds a different email from the one typed", (t) => { t.clients[0].email = "someone.else@example.test"; }],
    ["the client file has no email", (t) => { t.clients[0].email = null; }],
    ["the client file has an empty email", (t) => { t.clients[0].email = ""; }],
    ["the client file has no first name", (t) => { t.clients[0].first_name = null; t.clients[0].last_name = null; }],
    ["the client file has no phone", (t) => { t.clients[0].phone = null; }],
    ["the client file kept the phone as typed, not dialable", (t) => { t.clients[0].phone = "555-0100"; }],
    ["the client file kept a formatted phone, not dialable", (t) => { t.clients[0].phone = "(555) 555-0100"; }],
    ["a client this save created has a different first name from the one typed", (t) => {
      t.clients[0].created_at = "2026-10-13T19:59:50.000Z"; t.clients[0].first_name = "Zed";
    }],
    ["no card on the board an hour later", (t) => { t.cards = []; }],
    ["the only card is on another board", (t) => { t.pipelines[0].key = "funding_card_stacking"; }],
    ["no welcome email an hour later", (t) => { t.messages = t.messages.filter((m) => m.template_key !== "EMAIL-S00-WELCOME"); }],
    ["no welcome text an hour later", (t) => { t.messages = t.messages.filter((m) => m.template_key !== "SMS-S00-WELCOME"); }],
    ["the welcome went to a different client", (t) => { for (const m of t.messages) m.client_id = id(999); }],
    ["the welcome email failed", (t) => { t.messages[0].status = "failed"; }],
    ["the welcome text failed", (t) => { t.messages[1].status = "failed"; }],
    ["the welcome email sat queued for three days", (t) => { t.messages[0].status = "queued"; t.messages[0].created_at = THREE_DAYS_AGO; }],
    ["the welcome text sat sending for three days", (t) => { t.messages[1].status = "sending"; t.messages[1].created_at = THREE_DAYS_AGO; }]
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
    ["less than an hour old: the welcome may still be coming", (t) => { t.events[0].created_at = JUST_NOW; t.messages = []; t.cards = []; }],
    ["a second save of the same email with another product: the file holds that listed product", (t) => {
      t.clients[0].custom_fields.product = "repair-bundle";
    }],
    ["a found client keeps the name already on the file", (t) => { t.clients[0].first_name = "Zed"; t.clients[0].last_name = "Other"; }],
    ["a client this save created has the typed first name", (t) => {
      t.clients[0].created_at = "2026-10-13T19:59:50.000Z";
    }],
    ["the typed email in capital letters", (t) => {
      t.events[0].payload.email = "Pat@Example.test"; t.events[0].idempotency_key = `pipeline-client:${ORG}:pat@example.test`;
    }],
    ["the welcome email is queued and an hour old", (t) => { t.messages[0].status = "queued"; t.messages[0].created_at = JUST_NOW; }]
  ], ignored: [
    ["a funnel sign-up is not a pipeline save", (t) => { t.events[0].payload.source = "funnel"; t.events[0].client_id = null; }],
    ["a demo event is not judged", (t) => { t.events[0].is_demo = true; t.events[0].client_id = null; }],
    ["an old event is not judged", (t) => { t.events[0].created_at = LONG_AGO; t.events[0].client_id = null; }],
    ["another event name is not judged", (t) => { t.events[0].name = "entry.updated"; t.events[0].client_id = null; }]
  ] });

const POST = id(1000);
const PARTNER = id(1010);
const CHANNEL = id(1070);
add("social-approved", SOCIAL_APPROVED_SQL,
  () => ({
    social_posts: [{ id: POST, org_id: ORG, partner_id: PARTNER, channel_id: CHANNEL, status: "queued",
      approved_at: RECENT, approved_by: STAFF, scheduled_for: "2026-10-15T20:00:00.000Z" }],
    staff: [staff({ role: "owner" })],
    marketing_content_queue: [{ id: id(1020), org_id: ORG, partner_id: PARTNER, social_post_id: POST, status: "scheduled" }],
    social_channels: [{ id: CHANNEL, connection_state: "active" }]
  }),
  [
    ["nobody is recorded as the approver", (t) => { t.social_posts[0].approved_by = null; }],
    ["the approver is not on staff", (t) => { t.staff = []; }],
    ["the approver is a closer", (t) => { t.staff[0].role = "closer"; }],
    ["the approver is a csm", (t) => { t.staff[0].role = "csm"; }],
    ["the post is still waiting for approval", (t) => { t.social_posts[0].status = "awaiting_approval"; }],
    ["the post was blocked after approval", (t) => { t.social_posts[0].status = "blocked"; }],
    ["no queue row mirrors the post", (t) => { t.marketing_content_queue = []; }],
    ["the queue row still says awaiting approval", (t) => { t.marketing_content_queue[0].status = "awaiting_approval"; }],
    ["the queue row is a different partner's", (t) => { t.marketing_content_queue[0].partner_id = id(1011); }],
    ["the approved post has no send time, so it never goes out", (t) => { t.social_posts[0].scheduled_for = null; }],
    ["the approved post is still queued five days past its time on an active account", (t) => {
      t.social_posts[0].scheduled_for = "2026-10-09T20:00:00.000Z";
    }],
    ["the approved post is still queued two hours past its time on an active account", (t) => {
      t.social_posts[0].scheduled_for = "2026-10-14T17:30:00.000Z";
    }]
  ],
  { ok: [
    ["approved by an admin", (t) => { t.staff[0].role = "admin"; }],
    ["an approved post that has gone out", (t) => { t.social_posts[0].status = "posted"; t.social_posts[0].scheduled_for = "2026-10-09T20:00:00.000Z"; }],
    ["an approved post that gave up", (t) => { t.social_posts[0].status = "failed"; }],
    ["an approved post that gave up and had no send time", (t) => { t.social_posts[0].status = "failed"; t.social_posts[0].scheduled_for = null; }],
    ["an approved post being sent right now", (t) => { t.social_posts[0].status = "posting"; t.social_posts[0].scheduled_for = "2026-10-09T20:00:00.000Z"; }],
    ["queued thirty minutes past its time: the sender runs every five minutes", (t) => {
      t.social_posts[0].scheduled_for = "2026-10-14T19:30:00.000Z";
    }],
    ["queued days past its time on an account that cannot post: it waits by design", (t) => {
      t.social_posts[0].scheduled_for = "2026-10-09T20:00:00.000Z"; t.social_channels[0].connection_state = "expired";
    }]
  ], ignored: [
    ["a post nobody approved is not judged", (t) => { t.social_posts[0].approved_at = null; t.social_posts[0].approved_by = null; }],
    ["an approval older than 30 days is not judged", (t) => { t.social_posts[0].approved_at = LONG_AGO; t.social_posts[0].approved_by = null; }]
  ] });

add("social-queued", SOCIAL_QUEUED_SQL,
  () => ({
    marketing_content_queue: [{ id: id(1030), org_id: ORG, partner_id: PARTNER, social_post_id: null, status: "queued",
      caption: "Funding tips", scheduled_for: "2026-10-16T20:00:00.000Z", updated_at: RECENT }],
    partners: [{ id: PARTNER, org_id: ORG }]
  }),
  [
    ["a queued row that was also handed to an account", (t) => { t.marketing_content_queue[0].social_post_id = id(1040); }],
    ["a queued row with no words", (t) => { t.marketing_content_queue[0].caption = "  "; }],
    ["the partner is gone", (t) => { t.partners = []; }],
    ["queued with no send time an hour ago", (t) => { t.marketing_content_queue[0].scheduled_for = null; }],
    ["queued with a send time in 2020", (t) => { t.marketing_content_queue[0].scheduled_for = "2020-01-01T00:00:00.000Z"; }],
    ["queued with a send time two days past", (t) => { t.marketing_content_queue[0].scheduled_for = "2026-10-12T20:00:00.000Z"; }]
  ],
  { ok: [
    ["queued just now with no send time yet", (t) => {
      t.marketing_content_queue[0].scheduled_for = null; t.marketing_content_queue[0].updated_at = JUST_NOW;
    }],
    ["queued with a send time a few hours past: the next send may not have run", (t) => {
      t.marketing_content_queue[0].scheduled_for = "2026-10-14T10:00:00.000Z";
    }],
    ["queued with a send time in the future", (t) => { t.marketing_content_queue[0].scheduled_for = "2026-12-01T00:00:00.000Z"; }]
  ], ignored: [
    ["a draft is not queued", (t) => { t.marketing_content_queue[0].status = "draft"; t.marketing_content_queue[0].social_post_id = id(1040); }],
    ["a scheduled row is not queued", (t) => { t.marketing_content_queue[0].status = "scheduled"; t.marketing_content_queue[0].social_post_id = id(1040); }],
    ["a thrown-away row is not queued", (t) => { t.marketing_content_queue[0].status = "discarded"; t.marketing_content_queue[0].scheduled_for = null; }]
  ] });

export { LONG_AGO, RECENT, JUST_NOW };
