// The contract tables for the finish-853 batch 08 route tests (contracts, contracts/sign, read/contracts):
// clients, staff, contract_templates, contracts, contract_signers, documents, document_versions and
// events, answered from memory by the conditions each statement names. A contract row is frozen the
// way the database's trigger freezes it: once it leaves draft, its wording columns do not change.
// Tests only; nothing here is product code.
import { tablesDb, orderAndLimit } from "./fin-b08-tables.mjs";
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
    // The contract list. The statement's own text decides the answer: its joins (inner for the client, left for
    // the sender), every condition of its WHERE (read below; one it cannot read throws), its select list, its
    // ORDER BY and its LIMIT. Nothing about company, client, status, staff, document ids or order is decided here.
    [/FROM contracts c\s+JOIN clients cl ON cl\.id = c\.client_id/i, (sql, p) => answerContractList(sql, p, tables)],
    // The template list, read the same way (company, the active-only flag, ORDER BY and LIMIT are the statement's).
    [/FROM contract_templates\s+WHERE org_id = \$1::uuid\s+AND \(\$2::boolean IS NOT TRUE OR active\)/i, (sql, p) => answerTemplateList(sql, p, tables)],
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
  let stamp = 0;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    if (/^\s*INSERT\s+INTO\s+contracts\b/i.test(text)) {
      // The database fills created_at itself: every new contract is later than the one before.
      const out = await inner(sql, params);
      const row = tables.contracts.at(-1);
      if (row && row.created_at === undefined) row.created_at = new Date(Date.UTC(2026, 9, 1) + (stamp += 1) * 1000).toISOString();
      return out;
    }
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


/* ── reading a list statement's own text ─────────────────────────────────────────────────────────── */

/** The text of the WHERE clause, up to ORDER BY or LIMIT. */
function whereOf(sql) {
  const i = sql.search(/\bWHERE\b/i);
  if (i < 0) return "";
  const rest = sql.slice(i + 5);
  const j = rest.search(/\b(?:ORDER\s+BY|LIMIT)\b/i);
  return j < 0 ? rest : rest.slice(0, j);
}

/** Every condition of a WHERE, as a predicate. A condition the readers do not know throws. */
function readConditions(where, readers) {
  const found = [];
  let left = where;
  for (const { re, make } of readers) {
    left = left.replace(re, (...m) => { found.push(make(m)); return " "; });
  }
  const rest = left.replace(/\bAND\b/gi, " ").replace(/\s+/g, " ").trim();
  if (rest) throw new Error(`the contracts stand-in cannot read this condition of the statement: ${rest.slice(0, 160)}`);
  return found;
}
const param = (p, m) => p[Number(m[1]) - 1];
const isNull = (v) => v === null || v === undefined;

const CONTRACT_LIST_READERS = [
  { re: /\bc\.org_id\s*=\s*\$(\d+)::uuid/gi, make: (m) => (c, p) => c.org_id === param(p, m) },
  { re: /\(\s*\$(\d+)::uuid\s+IS\s+NULL\s+OR\s+c\.client_id\s*=\s*\$\1::uuid\s*\)/gi, make: (m) => (c, p) => isNull(param(p, m)) || c.client_id === param(p, m) },
  { re: /\(\s*\$(\d+)::text\s+IS\s+NULL\s+OR\s+c\.status\s*=\s*\$\1\s*\)/gi, make: (m) => (c, p) => isNull(param(p, m)) || c.status === param(p, m) },
  {
    re: /\(\s*\$(\d+)::uuid\[\]\s+IS\s+NULL\s+OR\s+c\.document_id\s*=\s*ANY\(\$\1::uuid\[\]\)\s+OR\s+c\.signed_document_id\s*=\s*ANY\(\$\1::uuid\[\]\)\s*\)/gi,
    make: (m) => (c, p) => isNull(param(p, m)) || param(p, m).includes(c.document_id) || param(p, m).includes(c.signed_document_id),
  },
  { re: /\(\s*\$(\d+)::uuid\s+IS\s+NULL\s+OR\s+c\.staff_id\s*=\s*\$\1::uuid\s*\)/gi, make: (m) => (c, p) => isNull(param(p, m)) || c.staff_id === param(p, m) },
];

/** Split a select list on top-level commas. */
function splitList(list) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function answerContractList(sql, params, tables) {
  const text = String(sql).replace(/--[^\n]*/g, " ");
  const select = /^\s*SELECT([\s\S]*?)\bFROM\s+contracts\s+c\b/i.exec(text);
  if (!select) throw new Error("the contracts stand-in cannot read the select list");
  const clientJoin = /\bJOIN\s+clients\s+cl\s+ON\s+cl\.id\s*=\s*c\.client_id\b/i.test(text);
  const staffJoin = /\b(LEFT\s+)?JOIN\s+staff\s+s\s+ON\s+s\.id\s*=\s*c\.sent_by\b/i.exec(text);
  if (!clientJoin || !staffJoin) throw new Error("the contracts stand-in cannot read the joins of the statement");
  const staffIsLeft = !!staffJoin[1];
  const conditions = readConditions(whereOf(text), CONTRACT_LIST_READERS);
  const items = splitList(select[1]).map((item) => {
    const m = /^(c|cl|s)\.(\w+)(?:\s+AS\s+(\w+))?$/i.exec(item);
    if (!m) throw new Error(`the contracts stand-in cannot read the select item: ${item}`);
    return { alias: m[1].toLowerCase(), column: m[2], as: m[3] || m[2] };
  });
  const kept = tables.contracts.filter((c) => conditions.every((ok) => ok(c, params)));
  const joined = [];
  for (const c of kept) {
    const cl = tables.clients.find((x) => x.id === c.client_id);
    if (!cl) continue; // inner join: no client, no row
    const st = tables.staff.find((x) => x.id === c.sent_by) || null;
    if (!st && !staffIsLeft) continue;
    joined.push({ c, cl, st });
  }
  // ORDER BY reads columns of the contract (c.created_at); orderAndLimit ignores the alias, so sort the contract rows.
  const ordered = orderAndLimit(joined.map((j) => ({ ...j.c, __j: j })), text, params);
  return ordered.map((row) => {
    const { c, cl, st } = row.__j;
    const src = { c, cl, s: st || {} };
    return Object.fromEntries(items.map((it) => [it.as, src[it.alias][it.column] === undefined ? null : src[it.alias][it.column]]));
  });
}

const TEMPLATE_LIST_READERS = [
  { re: /\borg_id\s*=\s*\$(\d+)::uuid/gi, make: (m) => (t, p) => t.org_id === param(p, m) },
  { re: /\(\s*\$(\d+)::boolean\s+IS\s+NOT\s+TRUE\s+OR\s+active\s*\)/gi, make: (m) => (t, p) => param(p, m) !== true || t.active === true },
];

function answerTemplateList(sql, params, tables) {
  const text = String(sql).replace(/--[^\n]*/g, " ");
  const conditions = readConditions(whereOf(text), TEMPLATE_LIST_READERS);
  const kept = tables.contract_templates.filter((t) => conditions.every((ok) => ok(t, params)));
  return orderAndLimit(kept, text, params).map((t) => ({ ...t }));
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
