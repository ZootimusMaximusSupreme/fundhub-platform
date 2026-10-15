// Fake answers shared by the Specialist desk page tests (fin-b07-desk-page.test.mjs and
// fin-b07-desk-buttons.test.mjs). Tests only: the live bundle never imports this file.
//
// Every row here is built so its cells are all DIFFERENT, so a cell wired to the wrong field, a
// column dropped, or an order changed turns a test red.

import { isNeedMeStage } from "../../../repair/cases.mjs";
import { json } from "./s4-screen-harness.mjs";

export { json };

export const SPECIALIST = {
  ok: true,
  staff: { id: "staff-3", name: "Robin Ellis", email: "robin@fundhub.test", role: "inquiry_specialist", org_id: "org-1", status: "active" },
};

export const DAY = 86400000;
export const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const cellsOf = (page, selector) => page.evaluate((sel) =>
  [...document.querySelectorAll(sel)].map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\s+/g, " ").trim())), selector);

export const NOTHING = { "/api/pii": { ok: true, identity: null }, "/api/repair/exceptions": { ok: true, stalled: [], lowConfidenceParses: [] } };

// ── Case queue ───────────────────────────────────────────────────────────────────────────────

export const CASES = [
  {
    id: uuid(102), client_id: uuid(11), client_name: "Sam Rivera", case_id: "IRC-2", case_status: "In Progress",
    selected_bureaus_raw: "EQ", requested_at: iso(2), open_inquiry_count: 1, funding_round_id: null,
    letter_provider_id: "lt_77", first_delivery_channel: "mail", first_delivery_at: iso(1), call_due_at: iso(1), call_fired_at: null,
    docs_complete: false, docs_missing: ["id_document"],
  },
  {
    id: uuid(101), client_id: uuid(10), client_name: "Dana Whitfield", case_id: "IRC-1", case_status: "Queued",
    selected_bureaus_raw: "EX", requested_at: iso(5), open_inquiry_count: 3, funding_round_id: "abcdef12-0000-4000-8000-000000000001",
    letter_provider_id: null, call_due_at: null, call_fired_at: null, docs_complete: true, docs_missing: [],
  },
  {
    id: uuid(103), client_id: uuid(12), client_name: "Ada Lee", case_id: "IRC-3", case_status: "Blocked",
    selected_bureaus_raw: "TU", requested_at: iso(10), open_inquiry_count: 0, funding_round_id: null,
    letter_provider_id: null, call_due_at: null, call_fired_at: null, docs_complete: false, docs_missing: [],
  },
];

export const INQUIRIES = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: uuid(201), client_id: uuid(10), client_name: "Dana Whitfield", bureau: "EX", inquiry_name: "CAPITAL ONE BANK USA", expected_name: "Capital One", call_state: "on_hold", call_attempts: 2, status: "Filed", outcome: null },
    { id: uuid(202), client_id: uuid(11), client_name: "Sam Rivera", bureau: "EQ", inquiry_name: "CHASE CARD SERVICES", expected_name: null, call_state: "not_started", call_attempts: 0, status: "Pending Removal", outcome: null },
  ],
};

export function workHandlers(extra = {}) {
  return {
    "/api/read/inquiries": INQUIRIES,
    "/api/read/inquiry-cases": { ok: true, cases: [], total: 0 },
    "/api/inquiries": (route, { url }) => {
      if (url.includes("recent=letters")) return { ok: true, letters: [] };
      if (url.includes(`inquiry_id=${uuid(201)}`)) {
        return {
          ok: true,
          // newest first, the order api/inquiries.mjs (listAttempts) answers in
          attempts: [
            { kind: "letter", outcome: "sent", staff_name: "Sam Closer", created_at: "2026-10-13T16:00:00Z" },
            { kind: "call", outcome: "no_answer", staff_name: "Robin Ellis", created_at: "2026-10-12T16:00:00Z" },
          ],
        };
      }
      return { ok: true, attempts: [] };
    },
    "/api/pii": (route, { url }) => (url.includes(`client_id=${uuid(10)}`)
      ? { ok: true, identity: { ssn_present: true, ssn_last4: "6789" } }
      : { ok: true, identity: null }),
    ...extra,
  };
}

// need_me is what src/repair/cases.mjs (mapFile) puts on every file: the stage is one of the four a person works.
const withNeedMe = (f) => ({ ...f, need_me: isNeedMeStage(f.stage_key) });
export const FILES = [
  { client_id: uuid(31), name: "Quiet Waiting", program: "full", round: "R2", rounds_cap: 6, stage_key: "awaiting_response", stage_label: "Waiting on the bureau",
    letters_ready: 0, letters_sent: 3, can_send: false, authorization_ok: true, address_ok: true, response_due_at: new Date(Date.now() + 10 * DAY).toISOString() },
  { client_id: uuid(32), name: "Needs Ready", program: "trial", round: "R1", rounds_cap: 2, stage_key: "ready_to_send", stage_label: "Ready to send",
    letters_ready: 2, letters_sent: 0, can_send: true, authorization_ok: true, address_ok: true, response_due_at: null },
  { client_id: uuid(33), name: "Needs Late", program: "full", round: "R3", rounds_cap: 6, stage_key: "response_received", stage_label: "Answer in",
    letters_ready: 0, letters_sent: 3, can_send: false, authorization_ok: true, address_ok: true, response_due_at: new Date(Date.now() - 5 * DAY).toISOString() },
  { client_id: uuid(34), name: "Needs Later", program: "trial", round: "R2", rounds_cap: 2, stage_key: "stalled", stage_label: "Stuck",
    letters_ready: 0, letters_sent: 1, can_send: false, authorization_ok: true, address_ok: true, response_due_at: new Date(Date.now() - 2 * DAY).toISOString() },
].map(withNeedMe);

export const DETAIL = {
  ok: true,
  file: FILES[1],
  letters: [
    { id: uuid(41), bureau: "EX", round: "R1", status: "generated", target: "bureau", can_send: true, html: "<p>Round 1</p>", rule_ids: ["r-1"] },
    { id: uuid(42), bureau: "EQ", round: "R1", status: "ready", target: "furnisher", can_send: true, html: "<p>Round 1 furnisher</p>", rule_ids: ["r-2"] },
    // already mailed: the server sends no words for it, and it cannot be offered for sending again
    { id: uuid(43), bureau: "TU", round: "R1", status: "sent", target: "bureau", can_send: false, html: null, rule_ids: ["r-3"] },
  ],
  items: [
    { id: uuid(51), rule_id: "METRO2-17", severity: "deletion", creditor: "ACME COLLECTIONS", account_last4: "4412", round: "R1", bureau: "EX" },
    { id: uuid(52), rule_id: "METRO2-04", severity: "moderate", creditor: "FIRST CARD BANK", account_last4: null, round: "R1", bureau: "EQ" },
  ],
  timeline: [{ words: "Letters made for round 1 on October 12" }, { words: "Analysis finished on October 11" }],
  rounds: [
    { round: "R1", status: "current", title: "Round 1: first challenge", when: "this week", attacks: ["ACME COLLECTIONS", "FIRST CARD BANK"] },
    { round: "R2", status: "later", title: "Round 2: method of verification", when: "after the bureau answers", attacks: [] },
  ],
};

export const repairHandlers = () => ({
  ...NOTHING,
  "/api/read/inquiries": { ok: true, count: 0, limit: 200, offset: 0, hasMore: false, items: [] },
  "/api/read/inquiry-cases": { ok: true, cases: [], total: 0 },
  "/api/read/repair-cases": (route, { url }) => (url.includes("client_id=")
    ? DETAIL
    : { ok: true, files: FILES, total: 4, need_me: 3, ready: 1, waiting: 1, stalled: 1, trial_ending: 0 }),
});

