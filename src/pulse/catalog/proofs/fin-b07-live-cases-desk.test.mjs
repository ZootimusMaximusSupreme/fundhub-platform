// Practice scenarios for the Specialist desk live checks, part 1: the case drawer and the case queue.
// Each scenario runs the EXACT SQL text of the contract over stand-in rows built from the real
// column names. See fin-b07-case-runner.mjs for what a scenario proves. Part 2 (the work queue, the
// work strip, the identity line and the erasure) is fin-b07-live-cases-work.test.mjs.

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
    good: [client(1), kase(1, 1, { case_status: "Completed", completed_at: ago(1) }), removedFor(1, 1, 1),
      // the path src/inquiries/work.mjs writes: the case row id in payload.caseId
      kase(7, 1, { case_status: "Completed", completed_at: ago(1) }), removedEvent(7, 1, { payload: { caseId: id(107) } })],
    bad: [
      { name: "a completed case with no completed stamp", rows: [kase(2, 1, { case_status: "Completed", completed_at: null }), removedFor(2, 1, 2)], breaks: "c.completed_at IS NULL" },
      { name: "a completed case whose client sits in another company", rows: [kase(3, 9, { case_status: "Completed", completed_at: ago(1) }), removedFor(3, 9, 3), ["clients", { id: id(9), org_id: OTHER_ORG, first_name: "Sam", last_name: "Rivera" }]], breaks: "OR cl.id IS NULL" },
      {
        name: "a completed case nobody was told about (no inquiry.removed receipt)",
        rows: [client(2), kase(4, 2, { case_status: "Completed", completed_at: ago(1) })],
        breaks: "OR NOT EXISTS (",
      },
      {
        name: "a completed case whose only receipt is older than the request",
        rows: [client(3), kase(5, 3, { case_status: "Completed", completed_at: ago(1), requested_at: ago(2) }),
          removedFor(5, 3, 5, { created_at: ago(20) })],
        breaks: { piece: "AND e.created_at >= COALESCE(c.requested_at, c.created_at)", with: "AND 1 = 1" },
      },
      {
        // A client has up to three open cases, one per bureau. Case 1 already has its receipt (the good
        // rows), so a check that only asked "did this client get an inquiry.removed?" would read this
        // case, whose own emit was lost, as covered.
        name: "a completed case whose only receipt belongs to a sibling case of the same client",
        rows: [kase(6, 1, { case_status: "Completed", completed_at: ago(1), selected_bureaus_raw: "EQ" })],
        breaks: { piece: "AND (e.payload->>'inquiryRemovalCaseId' = c.id::text OR e.payload->>'caseId' = c.id::text)", with: "AND 1 = 1" },
      },
      {
        name: "a completed case whose only receipt names another client",
        rows: [client(4), kase(8, 4, { case_status: "Completed", completed_at: ago(1) }), removedFor(8, 1, 8)],
        breaks: { piece: "AND e.client_id = c.client_id", with: "AND 1 = 1" },
      },
    ],
    ignored: [
      {
        name: "a completed case untouched for 70 days",
        rows: [client(5), kase(9, 5, { case_status: "Completed", completed_at: ago(70), updated_at: ago(70) })],
        breaks: { piece: "AND c.updated_at >= now() - interval '60 days'", with: "AND 1 = 1" },
      },
      {
        name: "a completed demo case",
        rows: [client(6), kase(10, 6, { case_status: "Completed", completed_at: ago(1), is_demo: true })],
        breaks: { piece: "AND COALESCE(c.is_demo, false) = false", with: "AND 1 = 1" },
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
      // a mail that failed and was then sent again: the case holds the provider id and a sent attempt
      client(7), inquiry(11, 7, { bureau: "TU" }),
      kase(9, 7, { case_status: "In Progress", selected_bureaus_raw: "TU", letter_provider_id: "lt_9" }),
      attempt(12, 11, 1, { kind: "letter", outcome: "mail_failed:return_address_required", created_at: ago(2) }),
      attempt(13, 11, 1, { kind: "letter", outcome: "sent", created_at: ago(1) }),
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
        name: "a sent case whose client sits in another company",
        rows: [["clients", { id: id(9), org_id: OTHER_ORG, first_name: "Sam", last_name: "Rivera" }],
          kase(6, 9, { case_status: "In Progress", letter_provider_id: "lt_6" }), inquiry(7, 9), attempt(8, 7, 1, { kind: "letter", outcome: "sent" })],
        breaks: "FILTER (WHERE cl.id IS NULL",
      },
      {
        // Same client, another bureau. The old check asked only "did this CLIENT have a sent letter?",
        // so a sibling case's attempt covered this case, which holds a provider id and no attempt of its own.
        name: "a provider id whose only sent attempt is another bureau's",
        rows: [client(4), inquiry(8, 4, { bureau: "EQ" }), attempt(9, 8, 1, { kind: "letter", outcome: "sent" }),
          kase(7, 4, { case_status: "In Progress", selected_bureaus_raw: "EX", letter_provider_id: "lt_7" })],
        breaks: { piece: "AND upper(COALESCE(l.bureau, '')) = upper(COALESCE(c.selected_bureaus_raw, ''))", with: "AND 1 = 1" },
      },
      {
        name: "a provider id whose only sent attempt came before the case was requested",
        rows: [client(5), inquiry(9, 5), attempt(10, 9, 1, { kind: "letter", outcome: "sent", created_at: ago(30) }),
          kase(8, 5, { case_status: "In Progress", letter_provider_id: "lt_8", requested_at: ago(3) })],
        breaks: { piece: "AND a.created_at >= c.requested_at", with: "AND 1 = 1" },
      },
      {
        // sendCase logs the failed mail, writes no provider id, then sets the case In Progress, and the
        // screen reads In Progress as Sent. This case has no provider id, so it is only in view by its attempt.
        name: "a mail that failed and was never sent, on a case that now reads In Progress",
        rows: [client(6), inquiry(10, 6), kase(10, 6, { case_status: "In Progress" }),
          attempt(11, 10, 1, { kind: "letter", outcome: "mail_failed:return_address_required" })],
        breaks: "OR (c.case_status::text = 'In Progress'",
      },
    ],
    ignored: [
      {
        name: "a case with a provider id and no attempt, untouched for 70 days",
        rows: [client(8), kase(11, 8, { case_status: "In Progress", letter_provider_id: "lt_11", updated_at: ago(70) })],
        breaks: { piece: "AND c.updated_at >= now() - interval '60 days'", with: "AND 1 = 1" },
      },
      {
        name: "a demo case with a provider id and no attempt",
        rows: [client(9), kase(12, 9, { case_status: "In Progress", letter_provider_id: "lt_12", is_demo: true })],
        breaks: { piece: "AND COALESCE(c.is_demo, false) = false", with: "AND 1 = 1" },
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
        // The button posts subtype additional_fraud_docs. api/documents-upload.mjs files a subtype it
        // does not know as "other" and keeps what was asked for in metadata.label.given.
        name: "a file the button sent that was filed under another subtype",
        rows: [["documents", { id: id(507), org_id: ORG, client_id: id(1), subtype: "other", current_version_id: id(607), created_at: ago(2), is_demo: false,
            metadata: { label: { given: "additional_fraud_docs", filed_as: "other", source: "unrecognised" } } }],
          ["document_versions", { id: id(607), org_id: ORG, document_id: id(507), storage_key: "k/7", byte_size: 10, checksum: "abc", mime_type: "application/pdf" }]],
        breaks: "OR d.subtype IS DISTINCT FROM 'additional_fraud_docs'",
      },

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
    ignored: [
      {
        name: "an ordinary upload filed as other, with no fraud-document label",
        rows: [["documents", { id: id(508), org_id: ORG, client_id: id(1), subtype: "other", current_version_id: id(608), created_at: ago(2), is_demo: false,
            metadata: { label: { given: null, filed_as: "other", source: "none_given" } } }]],
        breaks: { piece: "AND (d.subtype = 'additional_fraud_docs' OR d.metadata->'label'->>'given' = 'additional_fraud_docs')", with: "AND 1 = 1" },
      },
      {
        name: "a fraud document uploaded 70 days ago",
        rows: [["documents", { id: id(509), org_id: ORG, client_id: id(1), subtype: "additional_fraud_docs", current_version_id: id(699), created_at: ago(70), is_demo: false }]],
        breaks: { piece: "AND d.created_at >= now() - interval '60 days'", with: "AND 1 = 1" },
      },
    ],
  },

  "fin-b07-case-queue": {
    tables: ["inquiry_removal_cases", "clients", "funding_rounds", "inquiry_log"],
    good: [client(1), ["funding_rounds", { id: id(701), org_id: ORG, client_id: id(1), round_number: 1, status: "open" }],
      kase(1, 1, { funding_round_id: id(701), open_inquiry_count: 2 }),
      inquiry(1, 1, { case_id: id(101) }), inquiry(2, 1, { case_id: id(101) }),
      // a count HIGHER than the lines attached is normal before letters are staged
      kase(7, 1, { selected_bureaus_raw: "EQ", open_inquiry_count: 4 })],
    bad: [
      { name: "an open case whose client sits in another company", rows: [["clients", { id: id(9), org_id: OTHER_ORG, first_name: "Sam", last_name: "Rivera" }], kase(2, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "an open case with no bureau", rows: [kase(4, 1, { selected_bureaus_raw: " " })], breaks: "OR NULLIF(BTRIM(COALESCE(c.selected_bureaus_raw, '')), '') IS NULL" },
      { name: "an open case with a negative item count", rows: [kase(5, 1, { open_inquiry_count: -1 })], breaks: "OR COALESCE(c.open_inquiry_count, 0) < (" },
      {
        // Send adds inquiry lines to the case and never refreshes the number, so the Items column reads 0
        // while the case holds an open line.
        name: "an open case whose Items count is lower than the open inquiries attached to it",
        rows: [kase(8, 1, { selected_bureaus_raw: "TU", open_inquiry_count: 0 }), inquiry(3, 1, { case_id: id(108), is_open: true })],
        breaks: "OR COALESCE(c.open_inquiry_count, 0) < (",
      },
      { name: "an open case naming a funding round that is not there", rows: [kase(6, 1, { funding_round_id: id(799) })], breaks: "OR (c.funding_round_id IS NOT NULL AND fr.client_id IS DISTINCT FROM c.client_id)" },
      {
        name: "an open case naming another client's funding round",
        rows: [client(2), ["funding_rounds", { id: id(702), org_id: ORG, client_id: id(2), round_number: 1, status: "open" }],
          kase(3, 1, { selected_bureaus_raw: "TU", funding_round_id: id(702) })],
        breaks: "OR (c.funding_round_id IS NOT NULL AND fr.client_id IS DISTINCT FROM c.client_id)",
      },
    ],
    ignored: [
      {
        name: "a completed case with no bureau",
        rows: [kase(9, 1, { case_status: "Completed", completed_at: ago(1), selected_bureaus_raw: "" })],
        breaks: { piece: "AND c.case_status::text IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked')", with: "AND 1 = 1" },
      },
      {
        name: "an open case with no bureau untouched for 70 days",
        rows: [kase(10, 1, { selected_bureaus_raw: "", updated_at: ago(70) })],
        breaks: { piece: "AND c.updated_at >= now() - interval '60 days'", with: "AND 1 = 1" },
      },
      {
        name: "a demo case with no bureau",
        rows: [kase(11, 1, { selected_bureaus_raw: "", is_demo: true })],
        breaks: { piece: "AND COALESCE(c.is_demo, false) = false", with: "AND 1 = 1" },
      },
    ],
  },

  "fin-b07-case-statuses": {
    tables: ["inquiry_removal_cases"],
    good: [kase(1, 1, { case_status: "Completed", completed_at: ago(1) }), kase(2, 1, { case_status: "Canceled", closed_at: ago(1) }),
      kase(3, 1, { case_status: "Scheduled" }), kase(8, 1, { case_status: "Escalated" })],
    bad: [
      { name: "a Completed case with no completed stamp", rows: [kase(4, 1, { case_status: "Completed", completed_at: null })], breaks: "(c.case_status::text = 'Completed' AND c.completed_at IS NULL)" },
      { name: "a Canceled case with no closed stamp", rows: [kase(5, 1, { case_status: "Canceled", closed_at: null })], breaks: "(c.case_status::text = 'Canceled' AND c.closed_at IS NULL)" },
      { name: "a case holding a status the column does not know", rows: [kase(6, 1, { case_status: "Cleared" })], breaks: "OR (c.case_status::text NOT IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked', 'Completed', 'Canceled'))" },
    ],
  },

});
