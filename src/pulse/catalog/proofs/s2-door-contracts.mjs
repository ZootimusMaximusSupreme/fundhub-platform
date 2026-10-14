// Slice 2 (customer messages): route rows proved by a real api/ handler run with
// a stand-in database, no network, and the in-memory provider. Each entry names
// the exact catalog row and the handler tests that judge its exact result.
//
// One row is NOT here on purpose: route:closer-deck action=generate_letters. Its
// letters pack needs a document store and a PDF build that a stand-in database
// cannot answer honestly, so it stays not proved.
export const S2_DOOR_CONTRACTS_EVIDENCE =
  "src/pulse/catalog/proofs/s2-door-contracts.test.mjs";

export function s2DoorKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return `${file}::${String(row?.surface || "").trim()}::${String(row?.control || "").trim()}`;
}

const DEFINITIONS = [
  { sourceFile: "routes-0.json",
    surface: "route:agent-call",
    control: "action=call: places a real Bland phone call to a client with the agent prompt, after 5 gates; MESSAGING_DRY_RUN holds it unless switched off.",
    tests: ["src/http/s2-message-routes-calls.test.mjs"] },
  { sourceFile: "routes-0.json",
    surface: "route:auth/authorized-rep",
    control: "Add or replace the authorized representative on a client file: makes a login for them and emails them a sign-in link.",
    tests: ["src/http/s2-message-routes-reset-rep.test.mjs"] },
  { sourceFile: "routes-0.json",
    surface: "route:chat/messages",
    control: "kind=client: staff sends an SMS or email to a client through composeAndSend (compliance gate, shift required).",
    tests: ["src/http/chat-messages-handler.test.mjs","src/http/s2-message-routes-chat.test.mjs"] },
  { sourceFile: "routes-0.json",
    surface: "route:contracts",
    control: "remind (one contract) and run_reminders (org-wide chase of every unsigned contract): queue reminder emails to signers who have not signed (max chases).",
    tests: ["src/http/s2-message-routes-contracts.test.mjs"] },
  { sourceFile: "routes-0.json",
    surface: "route:partners/approve",
    control: "Approve a white-label applicant: creates the partner login, brand row, published page at /sites/{id}, sets status active, sends the welcome email (and a text only if the applicant ticked consent); emits partner.approved.",
    tests: ["src/http/s2-message-routes-funnel-partner.test.mjs"] },
  { sourceFile: "routes-1.json",
    surface: "route:auth/reset",
    control: "POST action=request (email a password-reset link to a staff, affiliate or partner login; always answers ok)",
    tests: ["src/http/s2-message-routes-reset-rep.test.mjs"] },
  { sourceFile: "routes-1.json",
    surface: "route:messages-outbound",
    control: "POST action=dispatch (send every message that is due right now, subject to the send switch, daily cap and compliance gate)",
    tests: ["src/http/s2-message-routes-outbound.test.mjs"] },
  { sourceFile: "routes-1.json",
    surface: "route:messages-outbound",
    control: "POST action=email_invoice {invoice_id} and action=email_invoice_backlog (email one invoice, or up to 200 never-sent invoices)",
    tests: ["src/http/s2-message-routes-outbound.test.mjs"] },
  { sourceFile: "routes-1.json",
    surface: "route:messages-outbound",
    control: "POST action=settings {outbound_enabled, daily_send_cap, alert_email} (the company switch for every customer text and email)",
    tests: ["src/http/s2-message-routes-outbound.test.mjs"] },
  { sourceFile: "routes-1.json",
    surface: "route:payment-links",
    control: "POST action=send {id} (text the checkout link to the client) and action=expire {id} (kill a live ask)",
    tests: ["src/http/s2-message-routes-money.test.mjs"] },
  { sourceFile: "routes-2.json",
    surface: "route:auth/magic-link",
    control: "POST /api/auth/magic-link — client types their email; if it matches a portal account a 15-minute single-use sign-in link is queued as an email. Always answers the same 200 text (no account enumeration), 429 on rate limit. Caller: public.",
    tests: ["src/http/s2-message-routes-auth.test.mjs"] },
  { sourceFile: "routes-2.json",
    surface: "route:auth/send-portal-link",
    control: "POST /api/auth/send-portal-link — owner/admin sends a client the portal sign-in link: queues the magic-link email and returns the URL so staff can read it on the phone. 409 when no email on file, 429 when sent a moment ago. Caller: owner, admin.",
    tests: ["src/http/s2-message-routes-auth.test.mjs"] },
  { sourceFile: "routes-2.json",
    surface: "route:chat/portal-message",
    control: "GET/POST /api/chat/portal-message — the client portal chat widget: GET reads the client's own thread; POST saves the client's note as an inbound message on their sms/email conversation, then saves an assistant (or canned fallback) reply on the same thread with status delivered so it is not texted. Caller: signed-in client only.",
    tests: ["src/http/s2-message-routes-chat.test.mjs"] },
  { sourceFile: "routes-2.json",
    surface: "route:money/helper (POST send)",
    control: "POST /api/money/helper {action:send, message} — a client (or staff role-playing) sends a message to the money helper; the turn is saved, queued for the helper brain, and answered in the app. The helper is shadow: it never texts, and a transfer is only ever a proposal. Caller: client (own file) or staff ROLE_SETS.FINANCE_OS.",
    tests: ["src/http/s2-message-routes-money.test.mjs"] },
  { sourceFile: "routes-3.json",
    surface: "route:journeys",
    control: "GET reads the Journeys editor's saved automation step trees (client, setter, closer, advisor, affiliate, partner); PUT saves one journey. A journey's steps are live SMS and email copy and pipeline wiring. Scoped by org.",
    tests: ["src/http/s2-message-routes-write.test.mjs"] },
  { sourceFile: "routes-3.json",
    surface: "route:marketing/funnels/push-live",
    control: "POST {request_id, id, confirm_url} puts a built funnel live on ClickFunnels as NEW pages after a two-tap confirm; queues job funnel_push and wakes the funnel worker. The confirm address must equal the funnel's address.",
    tests: ["src/http/s2-message-routes-funnel-partner.test.mjs"] },
  { sourceFile: "routes-3.json",
    surface: "route:message-templates",
    control: "POST save or approve a message template. Save changes the words and switches the message OFF (compliance_passed false) until approved; approve sets compliance_passed true, which is the whole send gate; rename and delete are refused. The template editor's write door.",
    tests: ["src/http/s2-message-routes-write.test.mjs"] },
];

export const S2_DOOR_CONTRACTS = Object.freeze(DEFINITIONS.map((definition) => Object.freeze({
  ...definition,
  key: s2DoorKey(definition.sourceFile, definition),
  proof: Object.freeze({
    depth: "deep",
    evidence: [S2_DOOR_CONTRACTS_EVIDENCE, ...definition.tests].join(" "),
    asserts: definition.control,
  }),
})));

const PROOF_BY_KEY = new Map(S2_DOOR_CONTRACTS.map((entry) => [entry.key, entry.proof]));

export function s2DoorProof(sourceFile, row) {
  return PROOF_BY_KEY.get(s2DoorKey(sourceFile, row)) || null;
}
