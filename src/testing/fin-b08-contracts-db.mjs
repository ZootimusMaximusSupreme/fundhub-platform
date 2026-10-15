// The contract tables for the finish-853 batch 08 route tests (contracts, contracts/sign, read/contracts):
// clients, staff, contract_templates, contracts, contract_signers, documents, document_versions and
// events, answered from memory by the conditions each statement names. A contract row is frozen the
// way the database's trigger freezes it: once it leaves draft, its wording columns do not change.
// Tests only; nothing here is product code.
import { tablesDb } from "./fin-b08-tables.mjs";
import { rowsWhere } from "./s3-scoped-rows.mjs";

export const FROZEN_COLUMNS = ["rendered_body", "body_sha", "merge_values", "template_id", "template_key", "title", "fields", "signature_statement"];

export function contractsDb({
  clients = [], staff = [], templates = [], contracts = [], signers = [], documents = [], versions = [], extraRules = [],
} = {}) {
  const tables = {
    clients, staff, contract_templates: templates, contracts, contract_signers: signers,
    documents, document_versions: versions, events: [], messages: [], message_templates: [],
  };
  const rules = [
    ...extraRules,
    [/^\s*SELECT id FROM orgs WHERE slug/i, [{ id: clients[0] ? clients[0].org_id : null }]],
    // The contract list: this company's contracts, filtered by the statement's own optional parameters
    // ($2 client, $3 status, $5 document ids, $6 staff), newest first, bounded by $4, with the client's
    // name and the sender's name joined on.
    [/FROM contracts c\s+JOIN clients cl ON cl\.id = c\.client_id/i, (_sql, p) => {
      const [org, clientId, status, limit, docIds, staffId] = p;
      return tables.contracts
        .filter((c) => c.org_id === org)
        .filter((c) => clientId === null || c.client_id === clientId)
        .filter((c) => status === null || c.status === status)
        .filter((c) => docIds === null || docIds.includes(c.document_id) || docIds.includes(c.signed_document_id))
        .filter((c) => staffId === null || c.staff_id === staffId)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, limit)
        .map((c) => {
          const cl = tables.clients.find((x) => x.id === c.client_id) || {};
          return { ...c, first_name: cl.first_name, last_name: cl.last_name, client_email: cl.email, sent_by_name: (tables.staff.find((x) => x.id === c.sent_by) || {}).name || null };
        });
    }],
    // A known contact by email, inside the company.
    [/^\s*SELECT id, first_name, last_name, email FROM clients\s+WHERE org_id = \$1::uuid AND lower\(email\) = lower\(\$2\)/i,
      (_s, p) => tables.clients.filter((c) => c.org_id === p[0] && String(c.email || "").toLowerCase() === String(p[1]).toLowerCase())
        .map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email }))],
    [/^\s*SELECT count\(\*\)::int AS n FROM messages/i, [{ n: 0 }]],
  ];
  const fake = tablesDb({
    tables, rules, autoInsert: true, autoUpdate: true,
    // The column defaults the database fills in when a statement does not name the column.
    defaults: {
      contracts: { status: "draft", view_count: 0, signing_order: "sequential", source_kind: "text" },
      contract_signers: { status: "pending", view_count: 0, signed_at: null, field_values: {} },
      contract_templates: { active: true, source_kind: "text" },
      documents: { delivery_status: "not_delivered" },
    },
  });
  // The trigger: a contract that is not a draft keeps its words.
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const m = /^\s*UPDATE\s+contracts\s+SET\s+([\s\S]*?)\s+WHERE\s/i.exec(text);
    if (m) {
      const touched = FROZEN_COLUMNS.filter((c) => new RegExp(`\\b${c}\\s*=`).test(m[1]));
      if (touched.length) {
        const where = text.slice(text.search(/\bWHERE\b/i));
        const hit = rowsWhere(tables.contracts, where, params).filter((r) => r.status !== "draft");
        if (hit.length) {
          throw Object.assign(new Error(`contract ${hit[0].id} is frozen: ${touched.join(", ")} cannot change after send`), { code: "P0001" });
        }
      }
    }
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.tables = tables;
  return fake;
}

export const IDS = Object.freeze({
  client: "c1000000-0000-4000-8000-000000000001",
  otherClient: "c2000000-0000-4000-8000-000000000002",
  foreignClient: "c9000000-0000-4000-8000-000000000009",
  template: "e1000000-0000-4000-8000-000000000001",
  archived: "e2000000-0000-4000-8000-000000000002",
  foreignTemplate: "e9000000-0000-4000-8000-000000000009",
});

/** One company's book: a client, a second client, a foreign client, a text template with one required blank. */
export function baseBook({ orgId, otherOrgId, staffId }) {
  return {
    clients: [
      { id: IDS.client, org_id: orgId, first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100", custom_fields: {}, is_demo: false },
      { id: IDS.otherClient, org_id: orgId, first_name: "Pat", last_name: "Counter", email: "pat@example.test", phone: null, custom_fields: {}, is_demo: false },
      { id: IDS.foreignClient, org_id: otherOrgId, first_name: "Foreign", last_name: "Person", email: "foreign@example.test", phone: null, custom_fields: { secret_note: "other company" }, is_demo: false },
    ],
    staff: [{ id: staffId, org_id: orgId, name: "Olive Owner" }],
    templates: [
      {
        id: IDS.template, org_id: orgId, template_key: "SETUP", name: "Setup Agreement", kind: "contract", subtype: null,
        body: "Hello {{contact.first_name}}, you agree to the setup of {{field.service}}.",
        manual_fields: [{ key: "service", label: "Service", required: true }],
        signature_required: true, signature_statement: "I have read this and I agree.", active: true, source_kind: "text",
        document_id: null, document_version_id: null, original_filename: null, page_count: null, page_sizes: [], fields: [], signer_roles: [], created_by: staffId,
      },
      {
        id: IDS.archived, org_id: orgId, template_key: "OLD-ONE", name: "Old Agreement", kind: "contract", subtype: null, body: "Old words.",
        manual_fields: [], signature_required: true, signature_statement: "I agree.", active: false, source_kind: "text",
        document_id: null, document_version_id: null, original_filename: null, page_count: null, page_sizes: [], fields: [], signer_roles: [], created_by: staffId,
      },
      {
        id: IDS.foreignTemplate, org_id: otherOrgId, template_key: "FOREIGN", name: "Foreign Agreement", kind: "contract", subtype: null, body: "Foreign words.",
        manual_fields: [], signature_required: true, signature_statement: "I agree.", active: true, source_kind: "text",
        document_id: null, document_version_id: null, original_filename: null, page_count: null, page_sizes: [], fields: [], signer_roles: [], created_by: staffId,
      },
    ],
  };
}
