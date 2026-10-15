// Practice scenarios for the Specialist desk live checks, part 2: the work queue, the work strip, the
// identity line, the recent letters and the erasure. Each scenario runs the EXACT SQL text of the
// contract over stand-in rows built from the real column names. See fin-b07-case-runner.mjs.

import { ORG, OTHER_ORG, ago, id, runCases } from "./fin-b07-case-runner.mjs";

const client = (n, extra = {}) => ["clients", { id: id(n), org_id: ORG, first_name: "Dana", last_name: "Whitfield", is_demo: false, ...extra }];
const staff = (n, extra = {}) => ["staff", { id: id(n), org_id: ORG, name: "Alex Rivera", role: "inquiry_specialist", ...extra }];
const kase = (n, c, extra = {}) => ["inquiry_removal_cases", {
  id: id(100 + n), org_id: ORG, client_id: id(c), case_id: `IRC-${n}`, case_status: "Queued",
  selected_bureaus_raw: "EX", requested_at: ago(3), created_at: ago(3), updated_at: ago(1), is_demo: false, open_inquiry_count: 2, ...extra,
}];
const inquiry = (n, c, extra = {}) => ["inquiry_log", {
  id: id(200 + n), org_id: ORG, client_id: id(c), bureau: "EX", inquiry: "ACME BANK", inquiry_name: "ACME BANK",
  status: "open", is_open: true, call_attempts: 0, created_at: ago(5), updated_at: ago(1), is_demo: false, ...extra,
}];
const attempt = (n, inq, st, extra = {}) => ["inquiry_attempts", {
  id: id(300 + n), org_id: ORG, inquiry_id: id(200 + inq), staff_id: id(st), kind: "call", outcome: "no_answer", created_at: ago(1), ...extra,
}];
const removedEvent = (n, c, extra = {}) => ["events", {
  id: id(400 + n), org_id: ORG, name: "inquiry.removed", client_id: id(c), payload: {}, created_at: ago(1), ...extra,
}];
/** A client row the way eraseClient leaves it. */
const erasedClient = (n, extra = {}) => client(n, {
  first_name: "[erased]", last_name: "[erased]", email: null, phone: null, ghl_contact_id: null, custom_fields: {}, tags: "{}", updated_at: ago(10), ...extra,
});
const erasure = (rowId, c, extra = {}) => ["erasure_requests", {
  id: id(rowId), org_id: ORG, kind: "client_erasure", subject_client_id: id(c), status: "completed", completed_at: ago(10), reason: "client asked in writing", ...extra,
}];
/** The same event, naming the case it closed the way api/inquiry-cases.mjs writes it. */
const removedFor = (n, c, caseN, extra = {}) => removedEvent(n, c, { payload: { inquiryRemovalCaseId: id(100 + caseN) }, ...extra });

runCases({
  "fin-b07-work-queue": {
    tables: ["inquiry_log", "clients"],
    good: [client(1), inquiry(1, 1)],
    bad: [
      { name: "an open line whose client is gone", rows: [inquiry(2, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "an open line with no bureau", rows: [inquiry(3, 1, { bureau: "" })], breaks: "OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL" },
      { name: "an open line with no name", rows: [inquiry(4, 1, { inquiry: null, inquiry_name: " " })], breaks: "OR NULLIF(BTRIM(COALESCE(l.inquiry_name, l.inquiry, '')), '') IS NULL" },
      { name: "an open line with a negative attempt count", rows: [inquiry(5, 1, { call_attempts: -2 })], breaks: "OR COALESCE(l.call_attempts, 0) < 0" },
    ],
  },

  "fin-b07-work-row": {
    tables: ["inquiry_attempts", "inquiry_log", "staff", "pii_identity", "clients"],
    good: [client(1), staff(1), inquiry(1, 1), attempt(1, 1, 1),
      ["pii_identity", { id: id(801), org_id: ORG, client_id: id(1), ssn_enc: "v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCC", updated_at: ago(2) }]],
    bad: [
      {
        name: "an attempt by a staff member who is not there",
        rows: [attempt(2, 1, 99)],
        breaks: ["OR s.id IS NULL", "OR s.org_id IS DISTINCT FROM a.org_id", "OR NULLIF(BTRIM(COALESCE(s.name, '')), '') IS NULL"],
      },
      { name: "an attempt by a staff member of another company", rows: [staff(2, { org_id: OTHER_ORG }), attempt(3, 1, 2)], breaks: "OR s.org_id IS DISTINCT FROM a.org_id" },
      { name: "an attempt by a staff member with no name", rows: [staff(3, { name: "  " }), attempt(4, 1, 3)], breaks: "OR NULLIF(BTRIM(COALESCE(s.name, '')), '') IS NULL" },
      {
        name: "a social security number stored as plain digits",
        rows: [client(2), ["pii_identity", { id: id(802), org_id: ORG, client_id: id(2), ssn_enc: "123456789", updated_at: ago(2) }]],
        breaks: { piece: "AND length(p.ssn_enc) < 30", with: "AND 1 = 0" },
      },
    ],
  },

  "fin-b07-log-attempt": {
    tables: ["inquiry_attempts", "inquiry_log", "staff"],
    good: [staff(1), inquiry(1, 1, { call_attempts: 2 }), attempt(1, 1, 1), attempt(2, 1, 1, { kind: "letter" }), attempt(3, 1, 1, { kind: "note" })],
    bad: [
      { name: "an inquiry whose counter is higher than its attempts", rows: [inquiry(2, 1, { call_attempts: 5 }), attempt(4, 2, 1)], breaks: "OR COALESCE(l.call_attempts, 0) IS DISTINCT FROM (" },
      { name: "an inquiry whose counter is lower than its attempts", rows: [inquiry(3, 1, { call_attempts: 0 }), attempt(5, 3, 1, { kind: "portal" })], breaks: "OR COALESCE(l.call_attempts, 0) IS DISTINCT FROM (" },
      {
        name: "an attempt by a staff member who is not there",
        rows: [inquiry(4, 1, { call_attempts: 1 }), attempt(6, 4, 98)],
        breaks: ["OR s.id IS NULL", "OR s.org_id IS DISTINCT FROM a.org_id"],
      },
      { name: "an attempt against an inquiry of another company", rows: [inquiry(5, 1, { org_id: OTHER_ORG, call_attempts: 1 }), attempt(7, 5, 1)], breaks: "OR l.org_id IS DISTINCT FROM a.org_id" },
    ],
  },

  "fin-b07-mark-confirmed": {
    tables: ["inquiry_log", "inquiry_removal_cases", "clients"],
    good: [client(1), kase(1, 1, { case_status: "Completed", completed_at: ago(1) }),
      inquiry(1, 1, { case_id: id(101), is_open: false, cleared_at: ago(1), confirmed_at: ago(1), status: "Removed" })],
    bad: [
      { name: "a confirmed inquiry still counted open", rows: [inquiry(2, 1, { is_open: true, cleared_at: ago(1), confirmed_at: ago(1), status: "Removed" })], breaks: "OR COALESCE(l.is_open, true) = true" },
      { name: "a confirmed inquiry with no cleared stamp", rows: [inquiry(3, 1, { is_open: false, cleared_at: null, confirmed_at: ago(1), status: "Removed" })], breaks: "OR l.cleared_at IS NULL" },
      { name: "a confirmed inquiry whose client is gone", rows: [inquiry(4, 9, { is_open: false, cleared_at: ago(1), confirmed_at: ago(1) })], breaks: "FILTER (WHERE cl.id IS NULL" },
      {
        name: "a confirmed inquiry attached to another client's case",
        rows: [client(2), kase(2, 2, { case_status: "Completed", completed_at: ago(1) }),
          inquiry(5, 1, { case_id: id(102), is_open: false, cleared_at: ago(1), confirmed_at: ago(1) })],
        breaks: "c.client_id IS DISTINCT FROM l.client_id",
      },
      {
        name: "the last open inquiry was confirmed and the case still reads In Progress",
        rows: [kase(3, 1, { case_status: "In Progress" }),
          inquiry(6, 1, { case_id: id(103), is_open: false, cleared_at: ago(1), confirmed_at: ago(1) })],
        breaks: "OR (c.case_status::text IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked')",
      },
    ],
  },

  "fin-b07-set-status": {
    tables: ["inquiry_log"],
    good: [inquiry(1, 1, { status: "Pending Removal" }), inquiry(2, 1, { status: "Removed", confirmed_at: ago(1) })],
    bad: [
      { name: "a status with trailing spaces", rows: [inquiry(3, 1, { status: "Pending  " })], breaks: "l.status <> TRIM(l.status)" },
      { name: "a blank status", rows: [inquiry(4, 1, { status: "   " })], breaks: ["l.status <> TRIM(l.status)", "OR NULLIF(TRIM(l.status), '') IS NULL"] },
      { name: "a removed status with no confirmed stamp", rows: [inquiry(5, 1, { status: "Removed by bureau", confirmed_at: null })], breaks: "OR (l.confirmed_at IS NULL AND (" },
    ],
  },

  "fin-b07-save-expected": {
    tables: ["inquiry_log"],
    good: [inquiry(1, 1, { expected_name: "ACME BANK NA" })],
    bad: [
      { name: "an expected name that is only spaces", rows: [inquiry(2, 1, { expected_name: "   " })], breaks: ["FILTER (WHERE NULLIF(TRIM(l.expected_name), '') IS NULL", "OR l.expected_name <> TRIM(l.expected_name)"] },
      { name: "an expected name with spaces around it", rows: [inquiry(3, 1, { expected_name: " ACME " })], breaks: "OR l.expected_name <> TRIM(l.expected_name)" },
      { name: "an expected name over 200 characters", rows: [inquiry(4, 1, { expected_name: "A".repeat(201) })], breaks: "OR length(l.expected_name) > 200" },
    ],
  },

  "fin-b07-reveal": {
    tables: ["pii_access_log", "clients", "staff"],
    good: [client(1), staff(1), ["pii_access_log", { id: id(901), org_id: ORG, client_id: id(1), accessed_by: id(1), field: "ssn (bureau dispute letter)", created_at: ago(1) }],
      ["pii_access_log", { id: id(902), org_id: ORG, client_id: id(1), accessed_by: "inquiry-bureau-call", field: "ssn (bureau_dispute_call)", created_at: ago(1) }]],
    bad: [
      { name: "a reveal with no reason in the log", rows: [["pii_access_log", { id: id(903), org_id: ORG, client_id: id(1), accessed_by: id(1), field: "ssn", created_at: ago(1) }]], breaks: "OR a.field NOT LIKE 'ssn (%)'" },
      { name: "a reveal by a staff id that is not there", rows: [["pii_access_log", { id: id(904), org_id: ORG, client_id: id(1), accessed_by: id(77), field: "ssn (call prep)", created_at: ago(1) }]], breaks: "OR (length(a.accessed_by) = 36 AND s.id IS NULL)" },
      { name: "a reveal for a client that is not there", rows: [["pii_access_log", { id: id(905), org_id: ORG, client_id: id(88), accessed_by: id(1), field: "ssn (call prep)", created_at: ago(1) }]], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "a reveal with nobody named", rows: [["pii_access_log", { id: id(906), org_id: ORG, client_id: id(1), accessed_by: " ", field: "ssn (call prep)", created_at: ago(1) }]], breaks: "OR NULLIF(BTRIM(COALESCE(a.accessed_by, '')), '') IS NULL" },
    ],
  },

  "fin-b07-recent-letters": {
    tables: ["inquiry_attempts", "inquiry_log", "clients", "staff"],
    good: [client(1), staff(1), inquiry(1, 1), attempt(1, 1, 1, { kind: "letter", outcome: "sent" }), attempt(2, 1, 1, { kind: "portal", outcome: "uploaded" })],
    bad: [
      {
        name: "a listed letter whose inquiry is gone",
        rows: [attempt(3, 55, 1, { kind: "letter", outcome: "sent" })],
        breaks: ["FILTER (WHERE l.id IS NULL", "OR cl.id IS NULL", "OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL"],
      },
      { name: "a listed letter whose client is gone", rows: [inquiry(2, 9), attempt(4, 2, 1, { kind: "letter", outcome: "sent" })], breaks: "OR cl.id IS NULL" },
      { name: "a listed letter with no bureau", rows: [inquiry(3, 1, { bureau: "" }), attempt(5, 3, 1, { kind: "letter", outcome: "sent" })], breaks: "OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL" },
      { name: "a listed letter by a staff member who is not there", rows: [inquiry(4, 1), attempt(6, 4, 66, { kind: "letter", outcome: "sent" })], breaks: "OR s.id IS NULL" },
      {
        name: "a mail that failed and was never sent again",
        rows: [inquiry(5, 1), attempt(7, 5, 1, { kind: "letter", outcome: "mail_failed:return_address_required" })],
        breaks: "OR (a.kind = 'letter' AND a.outcome LIKE 'mail_failed%' AND NOT EXISTS (",
      },
    ],
  },

  "fin-b07-clean-personal": {
    tables: ["erasure_requests", "pii_identity", "plaid_items", "bank_accounts", "bank_transactions", "clients"],
    good: [client(1, { first_name: "[erased]", last_name: "[erased]", email: null, phone: null, ghl_contact_id: null, custom_fields: {}, tags: "{}", updated_at: ago(10) }),
      ["erasure_requests", { id: id(1001), org_id: ORG, kind: "client_erasure", subject_client_id: id(1), status: "completed", completed_at: ago(10), reason: "client asked in writing" }],
      // a scrubbed ledger row: the money stays, the merchant name and raw payload are gone
      ["bank_transactions", { id: id(1010), org_id: ORG, client_id: id(1), subject_client_id: id(1), amount_cents: 1250, merchant_name: null, raw: {}, updated_at: ago(10) }]],
    bad: [
      {
        name: "an erased client whose identity row is still there",
        rows: [erasedClient(2), erasure(1002, 2),
          ["pii_identity", { id: id(1003), org_id: ORG, client_id: id(2), ssn_enc: "v1:a:b:c", updated_at: ago(30) }]],
        breaks: "FILTER (WHERE EXISTS ( SELECT 1 FROM pii_identity p",
      },
      {
        name: "an erased client whose bank login is still there",
        rows: [erasedClient(3), erasure(1004, 3), ["plaid_items", { id: id(1005), org_id: ORG, client_id: id(3), created_at: ago(40) }]],
        breaks: "OR EXISTS ( SELECT 1 FROM plaid_items pi",
      },
      {
        name: "an erased client whose bank account is still there",
        rows: [erasedClient(4), erasure(1006, 4), ["bank_accounts", { id: id(1007), org_id: ORG, client_id: id(4), created_at: ago(40) }]],
        breaks: "OR EXISTS ( SELECT 1 FROM bank_accounts b",
      },
      {
        name: "an erased client whose email is still on the row",
        rows: [erasedClient(5, { email: "dana@example.com" }), erasure(1008, 5)],
        breaks: "OR EXISTS ( SELECT 1 FROM clients c",
      },
      {
        name: "an erased client whose phone is still on the row",
        rows: [erasedClient(6, { phone: "+15555550100" }), erasure(1009, 6)],
        breaks: "(c.email IS NOT NULL OR c.phone IS NOT NULL",
      },
      {
        name: "an erased client whose last name is still on the row",
        rows: [erasedClient(7, { last_name: "Whitfield" }), erasure(1011, 7)],
        breaks: "OR c.last_name IS DISTINCT FROM '[erased]'",
      },
      {
        name: "an erased client whose CRM contact id is still on the row",
        rows: [erasedClient(8, { ghl_contact_id: "ghl_8841" }), erasure(1012, 8)],
        breaks: "OR c.ghl_contact_id IS NOT NULL",
      },
      {
        name: "an erased client whose CRM field bag is still full",
        rows: [erasedClient(9, { custom_fields: { cf_dob: "1980-02-01" } }), erasure(1013, 9)],
        breaks: "OR COALESCE(c.custom_fields::text, '{}') <> '{}'",
      },
      {
        name: "an erased client whose tags are still on the row",
        rows: [erasedClient(10, { tags: "{docs:missing}" }), erasure(1014, 10)],
        breaks: "OR COALESCE(c.tags::text, '{}') NOT IN ('{}', '[]')",
      },
      {
        name: "an erased client with a bank transaction that still names its merchant",
        rows: [erasedClient(11), erasure(1015, 11),
          ["bank_transactions", { id: id(1016), org_id: ORG, client_id: id(11), subject_client_id: id(11), amount_cents: 500, merchant_name: "Mesa Dental", raw: {}, updated_at: ago(40) }]],
        breaks: "(t.merchant_name IS NOT NULL OR COALESCE(t.raw::text, '{}') <> '{}')",
      },
      {
        name: "an erased client with a bank transaction that still holds the provider payload",
        rows: [erasedClient(12), erasure(1017, 12),
          ["bank_transactions", { id: id(1018), org_id: ORG, client_id: null, subject_client_id: id(12), amount_cents: 500, merchant_name: null, raw: { counterparty: "x" }, updated_at: ago(40) }]],
        breaks: "OR COALESCE(t.raw::text, '{}') <> '{}'",
      },
    ],
    ignored: [
      {
        name: "a client row written after the erasure finished (new data, not a leftover)",
        rows: [client(13, { first_name: "Dana", last_name: "Whitfield", email: "new@example.com", updated_at: ago(1) }), erasure(1019, 13, { completed_at: ago(10) })],
        breaks: { piece: "AND c.updated_at <= e.completed_at", with: "AND 1 = 1" },
        extraSamples: 1,
      },
      {
        name: "a bank transaction written after the erasure finished",
        rows: [erasedClient(14), erasure(1020, 14),
          ["bank_transactions", { id: id(1021), org_id: ORG, client_id: id(14), subject_client_id: id(14), amount_cents: 500, merchant_name: "Late Cafe", raw: {}, updated_at: ago(1) }]],
        breaks: { piece: "AND t.updated_at <= e.completed_at", with: "AND 1 = 1" },
        extraSamples: 1,
      },
    ],
  },
});
