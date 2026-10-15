// Practice scenarios for the Specialist desk live checks: the case drawer, the work queue and
// the identity line. Each scenario runs the EXACT SQL text of the contract over stand-in rows
// built from the real column names. See fin-b07-case-runner.mjs for what a scenario proves.

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

runCases({
  "fin-b07-case-close": {
    tables: ["inquiry_removal_cases", "clients", "events"],
    good: [client(1), kase(1, 1, { case_status: "Canceled", closed_at: ago(1) })],
    bad: [
      { name: "a canceled case with no closed stamp", rows: [kase(2, 1, { case_status: "Canceled", closed_at: null })], breaks: "c.closed_at IS NULL" },
      { name: "a canceled case whose client is gone", rows: [kase(3, 9, { case_status: "Canceled", closed_at: ago(1) })], breaks: "OR cl.id IS NULL" },
      {
        name: "a case canceled before it completed that still has an inquiry.removed receipt",
        rows: [kase(4, 1, { case_status: "Canceled", closed_at: ago(1), completed_at: null }),
          removedEvent(1, 1, { payload: { inquiryRemovalCaseId: id(104) } })],
        breaks: "c.completed_at IS NULL AND EXISTS",
      },
    ],
  },

  "fin-b07-case-cleared": {
    tables: ["inquiry_removal_cases", "clients", "events"],
    good: [client(1), kase(1, 1, { case_status: "Completed", completed_at: ago(1) }), removedEvent(1, 1)],
    bad: [
      { name: "a completed case with no completed stamp", rows: [kase(2, 1, { case_status: "Completed", completed_at: null }), removedEvent(2, 1)], breaks: "c.completed_at IS NULL" },
      { name: "a completed case whose client is gone", rows: [kase(3, 9, { case_status: "Completed", completed_at: ago(1) }), removedEvent(3, 9)], breaks: "OR cl.id IS NULL" },
      {
        name: "a completed case nobody was told about (no inquiry.removed receipt)",
        rows: [client(2), kase(4, 2, { case_status: "Completed", completed_at: ago(1) })],
        breaks: "OR NOT EXISTS (",
      },
      {
        name: "a completed case whose only receipt is older than the request",
        rows: [client(3), kase(5, 3, { case_status: "Completed", completed_at: ago(1), requested_at: ago(2) }),
          removedEvent(5, 3, { created_at: ago(20) })],
        breaks: { piece: "AND e.created_at >= COALESCE(c.requested_at, c.created_at)", with: "AND 1 = 1" },
      },
    ],
  },

  "fin-b07-case-generate": {
    tables: ["inquiry_log", "inquiry_removal_cases"],
    good: [kase(1, 1, { selected_bureaus_raw: "EX/EQ" }), inquiry(1, 1, { case_id: id(101), bureau: "EX" }),
      inquiry(2, 1, { case_id: id(101), bureau: "EQ" })],
    bad: [
      { name: "an inquiry of another bureau attached to the case", rows: [inquiry(3, 1, { case_id: id(101), bureau: "TU" })], breaks: "(upper(COALESCE(l.bureau, '')) IN ('EX', 'EQ', 'TU') AND NOT (" },
      { name: "an inquiry of another client attached to the case", rows: [inquiry(4, 2, { case_id: id(101), bureau: "EX" })], breaks: "l.client_id IS DISTINCT FROM c.client_id" },
      {
        name: "an inquiry attached to a case that is not there",
        rows: [inquiry(5, 1, { case_id: id(150), bureau: "EX" })],
        breaks: ["FILTER (WHERE c.id IS NULL", "OR l.client_id IS DISTINCT FROM c.client_id", "OR l.org_id IS DISTINCT FROM c.org_id",
          "OR (upper(COALESCE(l.bureau, '')) IN ('EX', 'EQ', 'TU') AND NOT ("],
      },
    ],
  },

  "fin-b07-case-send": {
    tables: ["inquiry_removal_cases", "clients", "inquiry_log", "inquiry_attempts", "staff"],
    good: [
      client(1), staff(1), inquiry(1, 1, { case_id: id(101) }),
      kase(1, 1, { case_status: "In Progress", letter_provider_id: "lt_1" }), attempt(1, 1, 1, { kind: "letter", outcome: "sent" }),
      kase(2, 1, { case_status: "In Progress", portal_confirmation: "EX-9981" }), attempt(2, 1, 1, { kind: "portal", outcome: "uploaded", note: "experian_ref:EX-9981" }),
    ],
    bad: [
      { name: "a mailed case that reads Queued", rows: [kase(3, 1, { case_status: "Queued", letter_provider_id: "lt_3" }), attempt(3, 1, 1, { kind: "letter", outcome: "sent" })], breaks: "c.case_status::text = 'Queued'" },
      {
        name: "a provider id with no sent letter attempt",
        rows: [client(2), kase(4, 2, { case_status: "In Progress", letter_provider_id: "lt_4" })],
        breaks: "(c.letter_provider_id IS NOT NULL AND NOT EXISTS (",
      },
      {
        name: "a portal reference with no matching portal attempt",
        rows: [client(3), kase(5, 3, { case_status: "In Progress", portal_confirmation: "EX-0001" })],
        breaks: "(c.portal_confirmation IS NOT NULL AND NOT EXISTS (",
      },
      {
        name: "a sent case whose client is gone",
        rows: [kase(6, 9, { case_status: "In Progress", letter_provider_id: "lt_6" }), inquiry(7, 9), attempt(8, 7, 1, { kind: "letter", outcome: "sent" })],
        breaks: "FILTER (WHERE cl.id IS NULL",
      },
    ],
  },

  "fin-b07-case-upload": {
    tables: ["documents", "document_versions", "clients"],
    good: [client(1),
      ["documents", { id: id(501), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(601), created_at: ago(2), is_demo: false }],
      ["document_versions", { id: id(601), org_id: ORG, document_id: id(501), storage_key: "k/1", byte_size: 2048, checksum: "abc", mime_type: "application/pdf" }]],
    bad: [
      {
        name: "a version with no storage key",
        rows: [["documents", { id: id(502), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(602), created_at: ago(2), is_demo: false }],
          ["document_versions", { id: id(602), org_id: ORG, document_id: id(502), storage_key: "", byte_size: 10, checksum: "abc", mime_type: "image/png" }]],
        breaks: "OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL",
      },
      {
        name: "a file whose current version row is missing",
        rows: [["documents", { id: id(506), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(699), created_at: ago(2), is_demo: false }]],
        breaks: ["OR v.id IS NULL", "OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL", "OR COALESCE(v.byte_size, 0) <= 0",
          "OR NULLIF(BTRIM(COALESCE(v.checksum, '')), '') IS NULL", "OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg')"],
      },
      {
        name: "a version with no size",
        rows: [["documents", { id: id(503), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(603), created_at: ago(2), is_demo: false }],
          ["document_versions", { id: id(603), org_id: ORG, document_id: id(503), storage_key: "k/3", byte_size: 0, checksum: "abc", mime_type: "image/png" }]],
        breaks: "OR COALESCE(v.byte_size, 0) <= 0",
      },
      {
        name: "a version whose bytes were not a pdf or image",
        rows: [["documents", { id: id(504), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(604), created_at: ago(2), is_demo: false }],
          ["document_versions", { id: id(604), org_id: ORG, document_id: id(504), storage_key: "k/4", byte_size: 10, checksum: "abc", mime_type: "text/html" }]],
        breaks: "OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg')",
      },
      {
        name: "a version with no checksum",
        rows: [["documents", { id: id(505), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(605), created_at: ago(2), is_demo: false }],
          ["document_versions", { id: id(605), org_id: ORG, document_id: id(505), storage_key: "k/5", byte_size: 10, checksum: "", mime_type: "image/jpeg" }]],
        breaks: "NULLIF(BTRIM(COALESCE(v.checksum, '')), '') IS NULL",
      },
    ],
  },

  "fin-b07-case-queue": {
    tables: ["inquiry_removal_cases", "clients", "funding_rounds"],
    good: [client(1), ["funding_rounds", { id: id(701), org_id: ORG, client_id: id(1), round_number: 1, status: "open" }],
      kase(1, 1, { funding_round_id: id(701) })],
    bad: [
      { name: "an open case whose client is gone", rows: [kase(2, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "an open case with no requested time", rows: [kase(3, 1, { requested_at: null })], breaks: "OR c.requested_at IS NULL" },
      { name: "an open case with no bureau", rows: [kase(4, 1, { selected_bureaus_raw: " " })], breaks: "OR NULLIF(BTRIM(COALESCE(c.selected_bureaus_raw, '')), '') IS NULL" },
      { name: "an open case with a negative item count", rows: [kase(5, 1, { open_inquiry_count: -1 })], breaks: "OR COALESCE(c.open_inquiry_count, 0) < 0" },
      { name: "an open case naming a funding round that is not there", rows: [kase(6, 1, { funding_round_id: id(799) })], breaks: "OR (c.funding_round_id IS NOT NULL AND fr.id IS NULL)" },
    ],
  },

  "fin-b07-case-statuses": {
    tables: ["inquiry_removal_cases"],
    good: [kase(1, 1, { case_status: "Completed", completed_at: ago(1) }), kase(2, 1, { case_status: "Canceled", closed_at: ago(1) }),
      kase(3, 1, { case_status: "Scheduled", ai_call_scheduled_for: ago(-1) })],
    bad: [
      { name: "a Completed case with no completed stamp", rows: [kase(4, 1, { case_status: "Completed", completed_at: null })], breaks: "(c.case_status::text = 'Completed' AND c.completed_at IS NULL)" },
      { name: "a Canceled case with no closed stamp", rows: [kase(5, 1, { case_status: "Canceled", closed_at: null })], breaks: "(c.case_status::text = 'Canceled' AND c.closed_at IS NULL)" },
      { name: "a Scheduled case with no call time", rows: [kase(6, 1, { case_status: "Scheduled", ai_call_scheduled_for: null, call_due_at: null })], breaks: "(c.case_status::text = 'Scheduled' AND c.ai_call_scheduled_for IS NULL AND c.call_due_at IS NULL)" },
    ],
  },

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
    tables: ["erasure_requests", "pii_identity", "plaid_items", "bank_accounts", "clients"],
    good: [client(1, { first_name: "[erased]", last_name: "[erased]", email: null, phone: null, updated_at: ago(10) }),
      ["erasure_requests", { id: id(1001), org_id: ORG, kind: "client_erasure", subject_client_id: id(1), status: "completed", completed_at: ago(10), reason: "client asked in writing" }]],
    bad: [
      {
        name: "an erased client whose identity row is still there",
        rows: [client(2, { first_name: "[erased]", email: null, phone: null, updated_at: ago(10) }),
          ["erasure_requests", { id: id(1002), org_id: ORG, kind: "client_erasure", subject_client_id: id(2), status: "completed", completed_at: ago(10), reason: "client asked in writing" }],
          ["pii_identity", { id: id(1003), org_id: ORG, client_id: id(2), ssn_enc: "v1:a:b:c", updated_at: ago(30) }]],
        breaks: "FILTER (WHERE EXISTS ( SELECT 1 FROM pii_identity p",
      },
      {
        name: "an erased client whose bank login is still there",
        rows: [client(3, { first_name: "[erased]", email: null, phone: null, updated_at: ago(10) }),
          ["erasure_requests", { id: id(1004), org_id: ORG, kind: "client_erasure", subject_client_id: id(3), status: "completed", completed_at: ago(10), reason: "client asked in writing" }],
          ["plaid_items", { id: id(1005), org_id: ORG, client_id: id(3), created_at: ago(40) }]],
        breaks: "OR EXISTS ( SELECT 1 FROM plaid_items pi",
      },
      {
        name: "an erased client whose bank account is still there",
        rows: [client(4, { first_name: "[erased]", email: null, phone: null, updated_at: ago(10) }),
          ["erasure_requests", { id: id(1006), org_id: ORG, kind: "client_erasure", subject_client_id: id(4), status: "completed", completed_at: ago(10), reason: "client asked in writing" }],
          ["bank_accounts", { id: id(1007), org_id: ORG, client_id: id(4), created_at: ago(40) }]],
        breaks: "OR EXISTS ( SELECT 1 FROM bank_accounts b",
      },
      {
        name: "an erased client whose email is still on the row",
        rows: [client(5, { first_name: "[erased]", email: "dana@example.com", phone: null, updated_at: ago(10) }),
          ["erasure_requests", { id: id(1008), org_id: ORG, kind: "client_erasure", subject_client_id: id(5), status: "completed", completed_at: ago(10), reason: "client asked in writing" }]],
        breaks: "OR EXISTS ( SELECT 1 FROM clients c",
      },
    ],
  },
});
