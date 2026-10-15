// Practice scenarios for the remaining live checks: the money vault upload door, the Plaid link,
// the lenders Apply proxy, the soft-pull business fields, staff employment agreements and the
// social Connect buttons. Each scenario runs the EXACT SQL text of the contract over stand-in rows
// built from the real column names. See fin-b07-case-runner.mjs.

import { ORG, OTHER_ORG, ago, id, runCases } from "./fin-b07-case-runner.mjs";

const client = (n, extra = {}) => ["clients", { id: id(n), org_id: ORG, first_name: "Dana", last_name: "Whitfield", is_demo: false, ...extra }];

const doc = (n, c, extra = {}) => ["documents", {
  id: id(500 + n), org_id: ORG, client_id: id(c), kind: "vault", subtype: "bank_statement", storage_key: `k/${n}`,
  current_version_id: id(600 + n), generated_by: "client:abc", created_at: ago(2), is_demo: false, ...extra,
}];
const version = (n, extra = {}) => ["document_versions", {
  id: id(600 + n), org_id: ORG, document_id: id(500 + n), storage_key: `k/${n}`, byte_size: 4096, checksum: "sha:abc", mime_type: "application/pdf", ...extra,
}];

const item = (n, c, extra = {}) => ["plaid_items", {
  id: id(700 + n), org_id: ORG, client_id: id(c), plaid_item_id: `pi_${n}`, link_state: "active",
  encrypted_access_token: "v1:enc:tok:ct", consent_granted_at: ago(3), created_at: ago(3), ...extra,
}];
const account = (n, itemN, c, extra = {}) => ["bank_accounts", {
  id: id(800 + n), org_id: ORG, client_id: id(c), plaid_item_id: id(700 + itemN), provider: "plaid", created_at: ago(3), ...extra,
}];

const proxy = (n, c, extra = {}) => ["proxy_sessions", {
  id: id(900 + n), org_id: ORG, client_id: id(c), staff_id: id(50), lender_id: id(60), application_id: null, status: "active",
  application_url: "https://bank.example/apply", exit_ip: "203.0.113.10", granted_city: "Phoenix", granted_region: "AZ",
  started_at: ago(1), ...extra,
}];

const biz = (n, c, entity = {}, extra = {}) => ["businesses", {
  id: id(1000 + n), org_id: ORG, client_id: id(c), name: "Whitfield Holdings LLC", age_months: 48, created_at: ago(2),
  entity_data: {
    source: "soft_pull_approve", address_line1: "12 Main St", city: "Phoenix", state: "AZ", postal_code: "85001",
    ein: "12-3456789", incorporated_date: "2020-03", ...entity,
  },
  ...extra,
}];

const contract = (n, extra = {}) => ["contracts", {
  id: id(1100 + n), org_id: ORG, staff_id: id(50), title: "Employment agreement", status: "signed", document_id: id(1200),
  signed_at: ago(4), signer_name: "Alex Rivera", signed_document_id: id(1201), updated_at: ago(4), is_demo: false, ...extra,
}];

const channel = (n, p, extra = {}) => ["social_channels", {
  id: id(1300 + n), org_id: ORG, partner_id: id(p), channel: "facebook", external_account_id: "1234567890",
  connection_state: "active", encrypted_access_token: "enc:tok", created_at: ago(2), ...extra,
}];

runCases({
  "fin-b07-vault-upload": {
    tables: ["documents", "document_versions", "clients", "entities"],
    good: [client(1), ["entities", { id: id(40), org_id: ORG, client_id: id(1), kind: "business", name: "Whitfield Holdings" }],
      doc(1, 1, { metadata: { entity_id: id(40) } }), version(1)],
    bad: [
      { name: "an upload whose client is gone", rows: [doc(2, 9), version(2)], breaks: "OR cl.id IS NULL" },
      { name: "an upload whose current version belongs to another document", rows: [doc(3, 1), version(3, { document_id: id(599) })], breaks: "OR v.document_id IS DISTINCT FROM d.id" },
      { name: "an upload whose file key differs from its version's", rows: [doc(4, 1, { storage_key: "k/other" }), version(4)], breaks: "OR v.storage_key IS DISTINCT FROM d.storage_key" },
      { name: "an upload with a size of zero", rows: [doc(5, 1), version(5, { byte_size: 0 })], breaks: "OR COALESCE(v.byte_size, 0) <= 0" },
      { name: "an upload whose bytes were not a pdf or image", rows: [doc(6, 1), version(6, { mime_type: "text/html" })], breaks: "OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg')" },
      {
        name: "an upload filed under another client's business",
        rows: [client(2), ["entities", { id: id(41), org_id: ORG, client_id: id(2), kind: "business", name: "Other LLC" }],
          doc(7, 1, { metadata: { entity_id: id(41) } }), version(7)],
        breaks: "OR (d.metadata->>'entity_id' IS NOT NULL AND NOT EXISTS (",
      },
    ],
  },

  "fin-b07-link-exchange": {
    tables: ["plaid_items", "bank_accounts", "clients"],
    good: [client(1), item(1, 1), account(1, 1, 1), account(2, 1, 1)],
    bad: [
      { name: "a link whose client is gone", rows: [item(2, 9), account(3, 2, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "a link with no Plaid item id", rows: [item(3, 1, { plaid_item_id: null }), account(4, 3, 1)], breaks: "OR i.plaid_item_id IS NULL" },
      { name: "an active link with no token", rows: [item(4, 1, { encrypted_access_token: " " }), account(5, 4, 1)], breaks: "NULLIF(BTRIM(COALESCE(i.encrypted_access_token, '')), '') IS NULL" },
      { name: "an active link with no consent stamp", rows: [item(5, 1, { consent_granted_at: null }), account(6, 5, 1)], breaks: "OR i.consent_granted_at IS NULL" },
      { name: "an active link that saved no account", rows: [item(6, 1)], breaks: "OR NOT EXISTS ( SELECT 1 FROM bank_accounts b WHERE b.org_id = i.org_id AND b.plaid_item_id = i.id)" },
      { name: "an errored link with no error code", rows: [item(7, 1, { link_state: "error", last_error_code: null }), account(7, 7, 1)], breaks: "OR (i.link_state = 'error' AND NULLIF(BTRIM(COALESCE(i.last_error_code, '')), '') IS NULL)" },
      { name: "an account saved under another client", rows: [client(2), item(8, 1), account(8, 8, 2)], breaks: "OR EXISTS ( SELECT 1 FROM bank_accounts b WHERE b.plaid_item_id = i.id AND (b.client_id IS DISTINCT FROM i.client_id OR b.org_id IS DISTINCT FROM i.org_id))", },
    ],
  },

  "fin-b07-lender-apply": {
    tables: ["proxy_sessions", "clients", "applications"],
    good: [client(1), proxy(1, 1)],
    bad: [
      { name: "a session whose client is gone", rows: [proxy(2, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "a session with no application address", rows: [proxy(3, 1, { application_url: " " })], breaks: "OR NULLIF(BTRIM(COALESCE(ps.application_url, '')), '') IS NULL" },
      { name: "a session naming no lender and no application", rows: [proxy(4, 1, { lender_id: null })], breaks: "OR (ps.lender_id IS NULL AND ps.application_id IS NULL)" },
      {
        name: "a session using another client's application",
        rows: [client(2), ["applications", { id: id(70), org_id: ORG, client_id: id(2) }], proxy(5, 1, { application_id: id(70) })],
        breaks: "OR (ps.application_id IS NOT NULL AND (ap.id IS NULL OR ap.client_id IS DISTINCT FROM ps.client_id))",
      },
      { name: "an active session with no exit address", rows: [proxy(6, 1, { exit_ip: null })], breaks: "OR (ps.status = 'active' AND (ps.exit_ip IS NULL OR ps.granted_city IS NULL AND ps.granted_region IS NULL))" },
      { name: "a session left verifying for half an hour", rows: [proxy(7, 1, { status: "verifying", started_at: ago(30, "minutes") })], breaks: "OR (ps.status = 'verifying' AND ps.started_at < now() - interval '15 minutes')" },
      { name: "a failed session with no error code", rows: [proxy(8, 1, { status: "failed", error_code: null, ended_at: ago(1) })], breaks: "OR (ps.status IN ('failed', 'mismatch') AND NULLIF(BTRIM(COALESCE(ps.error_code, '')), '') IS NULL)" },
    ],
  },

  "fin-b07-apply-dialog": {
    tables: ["proxy_sessions"],
    good: [proxy(1, 1, { status: "ended", started_at: ago(3, "hours"), ended_at: ago(2, "hours") })],
    bad: [
      { name: "an ended session with no end time", rows: [proxy(2, 1, { status: "ended", ended_at: null })], breaks: "FILTER (WHERE ps.ended_at IS NULL" },
      { name: "an ended session that ended before it started", rows: [proxy(3, 1, { status: "ended", started_at: ago(1, "hours"), ended_at: ago(2, "hours") })], breaks: "OR ps.ended_at < ps.started_at" },
      { name: "an ended session no staff member launched", rows: [proxy(4, 1, { status: "ended", staff_id: null, ended_at: ago(1, "minutes") })], breaks: "OR ps.staff_id IS NULL" },
    ],
  },

  "fin-b07-business-fields": {
    tables: ["businesses", "clients"],
    good: [client(1), biz(1, 1)],
    bad: [
      { name: "a business whose client is gone", rows: [biz(2, 9)], breaks: "FILTER (WHERE cl.id IS NULL" },
      { name: "a business with no name", rows: [biz(3, 1, {}, { name: " " })], breaks: "OR NULLIF(BTRIM(COALESCE(b.name, '')), '') IS NULL" },
      { name: "a business with no street", rows: [biz(4, 1, { address_line1: "" })], breaks: "OR NULLIF(BTRIM(COALESCE(b.entity_data->>'address_line1', '')), '') IS NULL" },
      { name: "a business with no ZIP", rows: [biz(5, 1, { postal_code: null })], breaks: "OR NULLIF(BTRIM(COALESCE(b.entity_data->>'postal_code', '')), '') IS NULL" },
      { name: "a business with an EIN of the wrong shape", rows: [biz(6, 1, { ein: "123456789" })], breaks: "OR COALESCE(b.entity_data->>'ein', '') NOT LIKE '__-_______'" },
      { name: "a business with no incorporated month", rows: [biz(7, 1, { incorporated_date: null })], breaks: ["OR COALESCE(b.entity_data->>'incorporated_date', '') NOT LIKE '____-__%'", { piece: "OR b.age_months > (date_part('year', now())", with: "OR 1 = 0 AND b.age_months > (date_part('year', now())" }] },
      { name: "a business with no age in months", rows: [biz(8, 1, {}, { age_months: null })], breaks: "OR b.age_months IS NULL OR b.age_months < 0" },
      { name: "a business older on paper than its incorporated month allows", rows: [biz(9, 1, { incorporated_date: "2025-06" }, { age_months: 400 })], breaks: "OR b.age_months > (date_part('year', now())" },
    ],
  },

  "fin-b07-agreements": {
    tables: ["contracts", "staff", "documents"],
    good: [["staff", { id: id(50), org_id: ORG, name: "Alex Rivera", role: "closer" }],
      ["documents", { id: id(1201), org_id: ORG, kind: "contract", title: "Signed agreement" }], contract(1)],
    bad: [
      { name: "an agreement for a staff member who is not there", rows: [contract(2, { staff_id: id(77) })], breaks: "FILTER (WHERE s.id IS NULL" },
      { name: "a sent agreement with no file to open", rows: [contract(3, { status: "sent", document_id: null, signed_at: null, signed_document_id: null })], breaks: "OR (k.status IN ('sent', 'viewed', 'signed') AND k.document_id IS NULL)" },
      { name: "a signed agreement with no signed time", rows: [contract(4, { signed_at: null })], breaks: "k.signed_at IS NULL" },
      { name: "a signed agreement with no signer name", rows: [contract(5, { signer_name: "" })], breaks: "OR NULLIF(BTRIM(COALESCE(k.signer_name, '')), '') IS NULL" },
      { name: "a signed agreement with no signed copy named", rows: [contract(6, { signed_document_id: null })], breaks: ["OR k.signed_document_id IS NULL", "OR sd.id IS NULL"] },
      { name: "a signed agreement whose signed copy is missing", rows: [contract(7, { signed_document_id: id(1299) })], breaks: "OR sd.id IS NULL" },
    ],
  },

  "fin-b07-social-connect": {
    tables: ["social_channels", "partners"],
    good: [["partners", { id: id(80), org_id: ORG, name: "Northwind Partners", is_demo: false }], channel(1, 80)],
    bad: [
      { name: "a channel whose partner is gone", rows: [channel(2, 99)], breaks: ["FILTER (WHERE p.id IS NULL", "OR p.org_id IS DISTINCT FROM sc.org_id"] },
      { name: "a channel whose partner belongs to another company", rows: [["partners", { id: id(81), org_id: OTHER_ORG, name: "Other", is_demo: false }], channel(3, 81)], breaks: "OR p.org_id IS DISTINCT FROM sc.org_id" },
      { name: "a channel of an unknown kind", rows: [channel(4, 80, { channel: "tiktok" })], breaks: "OR sc.channel NOT IN ('facebook', 'instagram', 'linkedin')" },
      { name: "a channel with no account", rows: [channel(5, 80, { external_account_id: " " })], breaks: "OR NULLIF(BTRIM(COALESCE(sc.external_account_id, '')), '') IS NULL" },
      { name: "a LinkedIn channel that kept the urn prefix", rows: [channel(6, 80, { channel: "linkedin", external_account_id: "urn:li:organization:123" })], breaks: "OR (sc.channel = 'linkedin' AND lower(sc.external_account_id) LIKE 'urn:%')" },
      { name: "an active channel with no token", rows: [channel(7, 80, { encrypted_access_token: null })], breaks: "OR (sc.connection_state = 'active' AND NULLIF(BTRIM(COALESCE(sc.encrypted_access_token, '')), '') IS NULL)" },
    ],
  },
});
