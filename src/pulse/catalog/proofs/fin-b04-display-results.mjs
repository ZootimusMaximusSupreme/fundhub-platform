// Batch 04 of "finish the 853": live checks for 27 customer-message screen
// controls (client chat, texts, contracts, letters, funding rounds, new clients,
// social posts). The 28th control in the batch, the closer's cockpit script,
// leaves no saved result, so a browser practice test holds it instead (below).
//
// Each entry ties ONE control, by its exact words in the coverage map, to a
// read-only query (fin-b04-sql-messages.mjs, fin-b04-sql-flows.mjs). The display
// lane runs the query for the company and goes red on the first wrong saved
// result. A control nobody has used yet has no results; those are green until the
// first wrong one (emptyAs "quiet"). The send-panel row has no such grace: a
// company with no sendable wording at all is red.
//
// This file must not import display-saved-result.mjs (that file imports this one).


import {
  CHAT_WIDGET_SQL,
  MESSAGE_BLOCKED_SQL,
  MESSAGE_HELD_SQL,
  PORTAL_CALL_REQUEST_SQL,
  PORTAL_MESSAGE_SQL,
  PUSH_DEVICE_SQL,
  STAFF_MESSAGE_SQL,
  THREAD_LINK_SQL
} from "./fin-b04-sql-messages.mjs";
import {
  CONTRACT_BLANKS_SQL,
  CONTRACT_SENT_SQL,
  CONTRACT_WORDINGS_SQL,
  DECK_DELIVERABLES_SQL,
  DECK_LETTERS_SQL,
  PIPELINE_NEW_CLIENT_SQL,
  ROUND_APPROVED_SQL,
  ROUND_CLOSEOUT_NOTIFY_SQL,
  ROUND_STARTED_SQL,
  ROUND_SUBMITTED_NOTIFY_SQL,
  SOCIAL_APPROVED_SQL,
  SOCIAL_FAILED_SQL,
  SOCIAL_QUEUED_SQL,
  VAULT_REJECT_SQL
} from "./fin-b04-sql-flows.mjs";

const LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B04_TEST = "src/pulse/catalog/proofs/fin-b04-display-results.test.mjs";

function result(row) {
  return Object.freeze({
    control: row.control,
    mode: "query",
    requirement: row.requirement,
    sql: `/* display-result:${row.key} */\n${row.sql.trim()}`,
    ...(row.strict ? {} : { emptyAs: "quiet" })
  });
}

// sourceFile + surface + control are the three words the coverage map keys a row by.
export const FIN_B04_ROWS = Object.freeze([
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "client-portal.html",
    control: "Chat button (floating widget from shell.js: send message to staff)",
    key: "portal-message",
    sql: PORTAL_MESSAGE_SQL,
    requirement: "A note a client sends from the portal chat button must be saved as an inbound client message on that client's own text or email thread, marked received, with the words kept."
  }),
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "client-portal.html",
    control: "Turn on / off notifications button (web push subscribe)",
    key: "push-device",
    sql: PUSH_DEVICE_SQL,
    requirement: "Every saved notification device must belong to a real client of this company, hold its three saved secrets, be turned off or expired only after it was made, and be live for one client only."
  }),
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "client-portal.html",
    control: "Unlock modal: Ask an advisor / Talk to an advisor buttons (open chat with topic)",
    key: "portal-call-request",
    sql: PORTAL_CALL_REQUEST_SQL,
    requirement: "A call request sent from the unlock modal must land on the client's own thread with a real topic after the words 'I would like a call about:'."
  }),
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "closer-dashboard.html",
    control: "Contract panel: Send button",
    key: "contract-sent",
    sql: CONTRACT_SENT_SQL,
    requirement: "Every contract sent in the last 30 days must have its client, its wording, a named sender, a link expiry after the send time and a signer, and the signing email must be queued within an hour when an address is on file."
  }),
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "closer-dashboard.html",
    control: "Contract panel: wording select and blank-field inputs",
    key: "contract-blanks",
    sql: CONTRACT_BLANKS_SQL,
    requirement: "Every sent contract must hold a value for each blank its wording marks as required, so no agreement goes out with a required blank empty."
  }),
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "closer-dashboard.html",
    control: "Send contract button (opens panel)",
    key: "contract-wordings",
    sql: CONTRACT_WORDINGS_SQL,
    requirement: "Every active wording the panel can list must have a key, a name, a signature sentence and real agreement words, never the placeholder text that send refuses.",
    strict: true
  }),
  Object.freeze({
    sourceFile: "desks-b.json",
    surface: "financeos.html#vault",
    control: "Staff only: 'Reject' with a reason the client reads, then 'Reject file'",
    key: "vault-reject",
    sql: VAULT_REJECT_SQL,
    requirement: "Every rejected vault file must link to that client's own upload, name the staff member who rejected it, and carry a written reason the client reads."
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "messaging.html",
    control: "Blocked result: opt-out or restricted wording refused and a task raised for a human",
    viaStaffUi: true,
    key: "message-blocked",
    sql: MESSAGE_BLOCKED_SQL,
    requirement: "Every staff text or email that was blocked in the last 30 days must keep a reason and the words, and a block for restricted wording must have a task with an owner raised for a person."
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "messaging.html",
    control: "Held-for-quiet-hours result: text deferred to the next window and the words stay in the box",
    viaStaffUi: true,
    key: "message-held",
    sql: MESSAGE_HELD_SQL,
    requirement: "Every staff text with a saved send time must be an outbound text whose time is the next 8:00 am Arizona after it was written, with its words kept; email is never held."
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "messaging.html",
    control: "Send button (staff reply to a client by text or email; shift clock-in required)",
    key: "staff-message",
    sql: STAFF_MESSAGE_SQL,
    requirement: "Every staff reply must name the staff member, sit on the client's own thread and channel, keep its words, show a provider receipt once sent, and a text sent at once must be logged on that person's open shift."
  }),
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "present.html (+ present.js, contract-send.js)",
    control: "'Generate letters and email now' (offer allows letters, not education)",
    key: "deck-letters",
    sql: DECK_LETTERS_SQL,
    requirement: "Every letter file the deck saved in the last 30 days must be a real PDF with bytes, a storage key and a checksum, on an offer that allows letters, and the letters email must be queued within an hour."
  }),
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "present.html (+ present.js, contract-send.js)",
    control: "'Send contract': picks the agreement that matches the offer, creates the draft, sends it, returns the sign link",
    key: "contract-sent",
    sql: CONTRACT_SENT_SQL,
    requirement: "Every contract sent in the last 30 days must have its client, its wording, a named sender, a link expiry after the send time and a signer, and the signing email must be queued within an hour when an address is on file."
  }),
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "present.html (+ present.js, contract-send.js)",
    control: "'Send deliverables package now' (education route): saves the 5 UnderwriteIQ files to the portal and emails the client",
    key: "deck-deliverables",
    sql: DECK_DELIVERABLES_SQL,
    requirement: "Every client who got a deliverables package must have the four core UnderwriteIQ pages saved as real files on an offer that allows letters, and the funding delivery email queued within an hour."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/chat-widget.js (mounted by shell.js on the same desks; skipped for partner and affiliate roles)",
    control: "Message > Client: paste a client id and send (goes through the compliance gate as a text)",
    key: "staff-message",
    sql: STAFF_MESSAGE_SQL,
    requirement: "Every staff text or email sent from the chat widget must name the staff member, sit on the client's own thread and channel, keep its words, show a provider receipt once sent, and a text sent at once must be logged on that person's open shift."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "Card: SMS and email lines (links to messaging.html?client_id=&channel=, red 1 badge when the client wrote last)",
    key: "thread-link",
    sql: THREAD_LINK_SQL,
    requirement: "Every inbound text or email from a known client must sit on that client's own thread for that channel, because the red 1 badge on the card is read from the newest message on that thread."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "Funding: Card Stacking column 'Apply Now' (apply_now): shows count and funding est.; accepts a dropped card",
    key: "round-started",
    sql: ROUND_STARTED_SQL,
    requirement: "Every card-stacking round.started event must carry the client, the apply_now stage, the round number and its key, and an hour later the round row and the client text must exist."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "Funding: Card Stacking column 'Approved' (approved): shows count and funding est.; accepts a dropped card",
    key: "round-approved",
    sql: ROUND_APPROVED_SQL,
    requirement: "Every card-stacking round.approved event must carry the client, the approved stage, the round number and its key, and an hour later the round row and the client text and email must exist."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "Funding: Card Stacking column 'Closed' (closed): shows count and funding est.; accepts a dropped card",
    key: "round-closeout",
    sql: ROUND_CLOSEOUT_NOTIFY_SQL,
    requirement: "Every card-stacking round.closeout event must carry the client, the closed stage, the round number and its key, and an hour later the round row and the client text and email must exist."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "Funding: Card Stacking column 'Round Submitted' (round_submitted): shows count and funding est.; accepts a dropped card",
    key: "round-submitted",
    sql: ROUND_SUBMITTED_NOTIFY_SQL,
    requirement: "Every card-stacking round.submitted event must carry the client, the round_submitted stage, the round number and its key, and an hour later the round row and the client text and email must exist."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "MOVE menu: Card Stacking -> funding_card_stacking / apply_now (starts a funding round and texts the client)",
    key: "round-started",
    sql: ROUND_STARTED_SQL,
    requirement: "Every card-stacking round.started event must carry the client, the apply_now stage, the round number and its key, and an hour later the round row and the client text must exist."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "New Client (button opens the modal: name, email, phone, product with 6 choices; Save / Cancel; same save as the apply form)",
    viaStaffUi: true,
    key: "pipeline-new-client",
    sql: PIPELINE_NEW_CLIENT_SQL,
    requirement: "Every client saved from the pipeline New Client form must keep the name, a real email, the phone and a listed product on the client file, and an hour later the board card and the welcome email and text must exist."
  }),
  Object.freeze({
    sourceFile: "desks-e.json",
    surface: "public/app/pipeline.html",
    control: "pipeline-clients (server): creates or finds the client through the funnel door and emits entry.captured, which sends the welcome email and text and places the Sales card",
    viaStaffUi: true,
    key: "pipeline-new-client",
    sql: PIPELINE_NEW_CLIENT_SQL,
    requirement: "Every entry.captured event the pipeline-clients route emits must carry the client and keep the name, email, phone and product, and an hour later the board card and the welcome email and text must exist."
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "shell.js (shared chrome on every staff desk)",
    control: "Chat widget on every desk: Ask (AI answer), Knowledge, Message staff, Message a client",
    key: "chat-widget",
    sql: CHAT_WIDGET_SQL,
    requirement: "Every message sent from the chat widget by staff must be a delivered note on an internal thread the sender is on, or a client text or email that meets the staff reply rules; Ask and Knowledge save nothing."
  }),
  Object.freeze({
    sourceFile: "desks-b.json",
    surface: "shell.js shared chrome (on every desk here except financeos.html)",
    control: "Chat widget launcher and its modes (Ask, Knowledge, Message: a teammate, or an SMS to a client by id)",
    key: "chat-widget",
    sql: CHAT_WIDGET_SQL,
    requirement: "Every message sent from the chat widget by staff must be a delivered note on an internal thread the sender is on, or a client text or email that meets the staff reply rules; Ask and Knowledge save nothing."
  }),
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "social-studio.html",
    control: "Held row (owner and admin only): 'Approve it' (asks first; the post goes out at its time)",
    key: "social-approved",
    sql: SOCIAL_APPROVED_SQL,
    requirement: "Every post a person approved in the last 30 days must name the staff member who approved it, be on its way out or already gone, and be mirrored as scheduled on that partner's queue."
  }),
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "social-studio.html",
    control: "Tab 'Could not be sent' (posts that gave up after 3 tries, plus the one open 'job to fix' strip)",
    key: "social-failed",
    sql: SOCIAL_FAILED_SQL,
    requirement: "Every post that gave up must show at least 3 tries and the reason, belong to a real partner, and have a social_post_failed job opened for a person."
  }),
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "social-studio.html",
    control: "Waiting row: 'Queue it' with its own time box (sets or keeps the send time, no account needed)",
    key: "social-queued",
    sql: SOCIAL_QUEUED_SQL,
    requirement: "Every post waiting in the queue must have its words and a real partner and must not be handed to a social account, because queue it picks no account."
  }),
]);

export const FIN_B04_RESULT_CONTRACTS = Object.freeze(FIN_B04_ROWS.map(result));

// The same rows as proof cases: compile-catalog reads them as deep display rows
// (depth "deep"), and display-proof-cases lists them with the lane as evidence.
// Four rows already sit in display-batch-staff-ui.mjs (a browser spec presses
// them, and that makes them deep rows). They get this query through the control
// name alone, so they are left out here to keep their browser evidence.
const CONTRACT_CASES = FIN_B04_ROWS.filter((row) => !row.viaStaffUi).map((row) => Object.freeze({
  sourceFile: row.sourceFile,
  surface: row.surface,
  control: row.control,
  depth: "deep",
  evidence: `${FIN_B04_TEST}; ${LANE}`,
  tests: Object.freeze([FIN_B04_TEST])
}));

// One control leaves nothing saved: the closer's cockpit script is drawn on the
// screen and written nowhere. It is held by a browser practice test instead of a
// live check, so it carries no query and does not list the lane as evidence.
export const FIN_B04_COCKPIT_TEST = "src/pulse/catalog/proofs/fin-b04-present-cockpit.test.mjs";
export const FIN_B04_PRACTICE_ROWS = Object.freeze([
  Object.freeze({
    sourceFile: "desks-f.json",
    surface: "present.html (+ present.js, contract-send.js)",
    control: "Cockpit script ('Say this', 'Watch for'): lines filtered by funding / repair / education route, [First Name] filled in, close wrap keyed to the offer actually chosen"
  })
]);
const PRACTICE_CASES = FIN_B04_PRACTICE_ROWS.map((row) => Object.freeze({
  ...row,
  depth: "deep",
  evidence: FIN_B04_COCKPIT_TEST,
  tests: Object.freeze([FIN_B04_COCKPIT_TEST])
}));

// The same rows as proof cases: compile-catalog reads the contract ones as deep
// display rows, and display-proof-cases lists them all.
export const FIN_B04_DISPLAY_PROOF_CASES = Object.freeze([...CONTRACT_CASES, ...PRACTICE_CASES]);
