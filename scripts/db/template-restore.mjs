#!/usr/bin/env node
// template-restore — builds and checks db/migrations/497_restore_missing_sql_templates.sql.
//
// WHAT HAPPENED. On 2026-10-20 a read-only production read found 137 of the 163
// message templates that the repo's SQL files seed for the Fundhub company missing.
// A PG test (src/messaging/seed/seed.pg.test.mjs) deleted every Fundhub template
// whenever it ran with a DATABASE_URL, and src/messaging/cutover-acceptance.pg.test.mjs
// deleted the two N06 renewal templates of the default company. Both now refuse
// anything but a local scratch database. The seed files are already marked applied
// in schema_migrations, so re-running migrate cannot bring the copy back.
//
// WHAT 497 DOES. Inserts the 125 missing ACTIVE keys for org 'fundhub' with the exact
// copy, channel, subject and approval flag the repo's own SQL produces, and nothing
// else. ON CONFLICT DO NOTHING: a key that exists (an owner edit, or a later seed) is
// never touched. It never updates or deletes a template and sends nothing — the only
// trigger on message_templates is BEFORE UPDATE set_updated_at.
//
// Left out on purpose: the 12 missing keys the coverage catalog marks inactive (no
// sender; see ops/workflows/coverage-every-surface-2026-10-10/messages.json), and
// every key that exists live, even where its copy differs from the seed.
//
// HOW THE COPY IS MADE (never typed by hand). Every repo SQL statement that writes
// message_templates is replayed, in db/migrate.mjs order, into a temporary table
// shaped like message_templates. The Fundhub rows for RESTORE_KEYS become one JSON
// literal inside 497. Measured 2026-10-20: replaying in production's own apply order
// (schema_migrations.applied_at) gives byte-identical rows.
//
//   Check 497 matches the repo SQL (scratch database only, rolled back):
//     DATABASE_URL=postgres://…@127.0.0.1/fundhub_scratch node scripts/db/template-restore.mjs
//   Rewrite 497 from the repo SQL:
//     DATABASE_URL=postgres://…@127.0.0.1/fundhub_scratch node scripts/db/template-restore.mjs --write

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const MIGRATION = "db/migrations/497_restore_missing_sql_templates.sql";
export const ORG_SLUG = "fundhub";
export const STAGE_TABLE = "fh_tpl_restore_stage";
// Migration 497 is historical. Later seeds change these templates after 497 has run.
export const RESTORE_SNAPSHOT_EXCLUDE_FILES = Object.freeze([
  "db/seed/298_s04_booking_app_confirm_email.sql",
  "db/seed/301_followup_flows_copy.sql",
  "db/seed/302_containment_plain_survey_copy.sql",
  "db/seed/303_no_josh_chris.sql"
]);
const JSON_TAG = "$fh_tpl_restore$";

// The production read of 2026-10-20 (BEGIN READ ONLY): SQL-seeded, active, and absent
// for org 'fundhub'. A fixed list, so a later seed can never widen what 497 inserts.
export const RESTORE_KEYS = Object.freeze([
  "CONTRACT-REMIND-EMAIL", "CONTRACT-SEND-EMAIL",
  "EMAIL-AX07-FUNDING-PAUSED",
  "EMAIL-CANDIDATE-EEO-INVITE", "EMAIL-CANDIDATE-OUTREACH-1", "EMAIL-CANDIDATE-OUTREACH-2",
  "EMAIL-CANDIDATE-OUTREACH-3", "EMAIL-CANDIDATE-OUTREACH-4",
  "EMAIL-COMMISSION-PAID",
  "EMAIL-DOC-01-REQUEST", "EMAIL-DOC-03-APPROVED",
  "EMAIL-DPC05-NO-PROGRESS-72H",
  "EMAIL-F02-ID-PORTAL-NEEDED", "EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP", "EMAIL-F03-ROUND-SUBMITTED",
  "EMAIL-F04-ROUND-APPROVALS", "EMAIL-F06-MISSING-DOCS", "EMAIL-F07-FUNDING-LOCKED",
  "EMAIL-N04-POST-FUNDING", "EMAIL-N06-RENEWAL",
  "EMAIL-NOBOOK-01", "EMAIL-NOBOOK-02", "EMAIL-NOBOOK-03",
  "EMAIL-OFFER-FUNDING-DFY", "EMAIL-OFFER-FUNDING-MASTERY", "EMAIL-OFFER-NONE", "EMAIL-OFFER-REPAIR-DFY",
  "EMAIL-OFFER-REPAIR-TRIAL", "EMAIL-OFFER-SOFT-PULL", "EMAIL-OFFER-UWIQ-DELIVERABLES",
  "EMAIL-PARTNER-WELCOME",
  "EMAIL-REPAIR-LETTERS-SENT", "EMAIL-REPAIR-RESPONSE-RESULTS", "EMAIL-REPAIR-RETAKE-PHOTO",
  "EMAIL-REPAIR-ROUND-ADVANCED", "EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL", "EMAIL-REPAIR-WELCOME",
  "EMAIL-S00-WELCOME", "EMAIL-S02-FINISH-APPLICATION", "EMAIL-S04-01-CONFIRM",
  "EMAIL-S05A-NOSHOW-02", "EMAIL-S05A-NOSHOW-03", "EMAIL-S05A-NOSHOW-04",
  "EMAIL-SLO-197", "EMAIL-SLO-COUPON-01",
  "EMAIL-SLO-DRIP-COLD-1", "EMAIL-SLO-DRIP-COLD-2", "EMAIL-SLO-DRIP-COLD-3", "EMAIL-SLO-DRIP-COLD-4",
  "EMAIL-SLO-DRIP-COLD-5", "EMAIL-SLO-DRIP-COLD-6", "EMAIL-SLO-DRIP-COLD-7",
  "EMAIL-SLO-DRIP-HOT-1", "EMAIL-SLO-DRIP-HOT-2", "EMAIL-SLO-DRIP-HOT-3", "EMAIL-SLO-DRIP-HOT-4",
  "EMAIL-SLO-DRIP-HOT-5", "EMAIL-SLO-DRIP-HOT-6", "EMAIL-SLO-DRIP-HOT-7",
  "EMAIL-SLO-DRIP-WARM-1", "EMAIL-SLO-DRIP-WARM-2", "EMAIL-SLO-DRIP-WARM-3", "EMAIL-SLO-DRIP-WARM-4",
  "EMAIL-SLO-DRIP-WARM-5", "EMAIL-SLO-DRIP-WARM-6", "EMAIL-SLO-DRIP-WARM-7",
  "EMAIL-SLO-FIRST5-01", "EMAIL-SLO-FIRST5-REPLY", "EMAIL-SLO-GENUINE-01", "EMAIL-SLO-GIFT-01",
  "EMAIL-SLO-PAID-FORM-01",
  "EMAIL-U02-ANALYZER-FUNDING-DELIVERY",
  "EMAIL-VAULT-ASK-2", "EMAIL-WAYPOINT-NUDGE-1",
  "SMS-AISET03-MSG1", "SMS-AISET03-MSG2", "SMS-AISET03-MSG3", "SMS-AISET04-HANDOFF",
  "SMS-AX07-FUNDING-PAUSED",
  "SMS-BS01-02-PRECALL",
  "SMS-CANDIDATE-OUTREACH-1", "SMS-CANDIDATE-OUTREACH-2", "SMS-CANDIDATE-OUTREACH-3", "SMS-CANDIDATE-OUTREACH-4",
  "SMS-DEAL-CLOSE-WIN",
  "SMS-DOC-01-REQUEST", "SMS-DOC-02-REQUEST-MORE", "SMS-DOC-03-APPROVED",
  "SMS-DPC04-RESCHEDULE-REBOOKING", "SMS-DPC05-NO-PROGRESS-72H",
  "SMS-F02-ID-PORTAL-NEEDED", "SMS-F03-ROUND-SUBMITTED", "SMS-F04-ROUND-APPROVALS", "SMS-F06-MISSING-DOCS",
  "SMS-F07-FUNDING-LOCKED",
  "SMS-FILE-PROTECT-CASH-RESERVE", "SMS-FILE-PROTECT-NEW-CREDIT", "SMS-FILE-PROTECT-PAY-BEFORE-CLOSE",
  "SMS-FILE-PROTECT-PROMO-END",
  "SMS-FINANCE-OS-CARD-DUE",
  "SMS-MONEY-AGENT-LATE-1", "SMS-MONEY-AGENT-LATE-2", "SMS-MONEY-AGENT-REMINDER",
  "SMS-NOBOOK-01", "SMS-NOBOOK-02", "SMS-NOBOOK-03",
  "SMS-PARTNER-WELCOME", "SMS-ROUND-STARTED-NOTIFY",
  "SMS-S00-WELCOME", "SMS-S04C-STAFF-BOOKED",
  "SMS-S05A-NOSHOW-02", "SMS-S05A-NOSHOW-03", "SMS-S05A-NOSHOW-04",
  "SMS-SLO-197", "SMS-SLO-COUPON-01", "SMS-SLO-FIRST5-01", "SMS-SLO-FIRST5-REPLY", "SMS-SLO-GENUINE-01",
  "SMS-SLO-GIFT-01", "SMS-SLO-PAID-FORM-01",
  "SMS-VAULT-ASK-1", "SMS-VAULT-ASK-3",
  "SMS-WAYPOINT-DUE", "SMS-WAYPOINT-NUDGE-2",
  "payment_link_notice",
]);

/** Splits SQL into statements. Quoted text, $tag$ bodies (DO blocks, HTML copy) stay whole; comments go. */
export function sqlStatements(source) {
  const out = [];
  let cur = "";
  let quote = false;
  let dollar = "";
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const n = source[i + 1];
    if (lineComment) { if (c === "\n") { lineComment = false; cur += "\n"; } continue; }
    if (blockComment) { if (c === "*" && n === "/") { blockComment = false; i += 1; } continue; }
    if (dollar) {
      if (source.startsWith(dollar, i)) { cur += dollar; i += dollar.length - 1; dollar = ""; } else cur += c;
      continue;
    }
    if (quote) {
      cur += c;
      if (c === "'" && n === "'") { cur += n; i += 1; } else if (c === "'") quote = false;
      continue;
    }
    if (c === "-" && n === "-") { lineComment = true; i += 1; continue; }
    if (c === "/" && n === "*") { blockComment = true; i += 1; continue; }
    if (c === "'") { quote = true; cur += c; continue; }
    if (c === "$") {
      const m = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(source.slice(i, i + 64));
      if (m) { dollar = m[0]; cur += dollar; i += dollar.length - 1; continue; }
    }
    cur += c;
    if (c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  if (quote || dollar || blockComment) throw new Error("SQL ended inside a quote, $tag$ body or comment");
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const TABLE_RE = /\b(?:public\.)?message_templates\b/gi;
const WRITE_RE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?message_templates\b/i;

/** Does this one statement write message_templates (directly, in a WITH, or inside a DO body)? */
export function writesTemplates(statement) {
  return WRITE_RE.test(statement);
}

/**
 * Every repo SQL statement that writes message_templates, in db/migrate.mjs order (schema,
 * migrations, seed; filename order), each rewritten to write `table` instead. 497 itself is skipped.
 */
export function templateWriteStatements(root = ROOT, table = STAGE_TABLE) {
  const out = [];
  for (const dir of ["schema", "migrations", "seed"]) {
    const full = path.join(root, "db", dir);
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort()) {
      const file = `db/${dir}/${name}`;
      if (file === MIGRATION) continue;
      const text = fs.readFileSync(path.join(full, name), "utf8");
      if (!/message_templates/i.test(text)) continue;
      for (const statement of sqlStatements(text)) {
        if (!writesTemplates(statement)) continue;
        if (/^\s*(?:CREATE|ALTER|DROP|COMMENT)\b/i.test(statement)) continue; // schema, not copy
        out.push({ file, sql: statement.replace(TABLE_RE, table) });
      }
    }
  }
  return out;
}

function unescapeE(raw) {
  return raw.replace(/\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|.)/g, (_, c) => {
    if (c[0] === "x") return String.fromCharCode(parseInt(c.slice(1), 16));
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" }[c] ?? c;
  });
}

/**
 * Every piece of text the repo's template SQL spells out: each quoted or $tag$ literal, and each
 * run of literals joined with || (E'' escapes and chr(n) decoded). A restored subject or body
 * must be one of these, so 497 cannot carry copy nobody wrote in a seed. Needs no database.
 */
export async function seedTextPieces(root = ROOT) {
  const { tokenize } = await import("../../src/pulse/catalog/proofs/fin-b22-sql-template-keys.mjs");
  const pieces = new Set();
  const isWord = (t, v) => t && t.t === "word" && t.v.toLowerCase() === v;
  const isP = (t, v) => t && t.t === "p" && t.v === v;
  const term = (toks, i) => {
    if (isWord(toks[i], "e") && toks[i + 1]?.t === "str") return { v: unescapeE(toks[i + 1].v), next: i + 2 };
    if (toks[i]?.t === "str") return { v: toks[i].v, next: i + 1 };
    if (isWord(toks[i], "chr") && isP(toks[i + 1], "(") && toks[i + 2]?.t === "num" && isP(toks[i + 3], ")")) {
      return { v: String.fromCharCode(Number(toks[i + 2].v)), next: i + 4 };
    }
    return null;
  };
  const walk = (sql) => {
    const toks = tokenize(sql);
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i].t === "str" && /message_templates/i.test(toks[i].v)) walk(toks[i].v);
      let t = term(toks, i);
      if (!t) continue;
      let value = t.v;
      pieces.add(value);
      while (isP(toks[t.next], "|") && isP(toks[t.next + 1], "|")) {
        const more = term(toks, t.next + 2);
        if (!more) break;
        value += more.v;
        pieces.add(value);
        t = more;
      }
    }
  };
  for (const { file } of templateWriteStatements(root)) {
    walk(fs.readFileSync(path.join(root, file), "utf8"));
  }
  return pieces;
}

const FIELDS = ["template_key", "channel", "subject", "body", "compliance_passed"];

/**
 * Replays the seed SQL into a temporary table on `client` and returns the Fundhub rows for
 * RESTORE_KEYS. The caller must hold an open transaction; ON COMMIT DROP and the caller's
 * ROLLBACK leave nothing behind. Writes only the temporary table.
 */
export async function stageSeedRows(client, { root = ROOT, keys = RESTORE_KEYS, excludeFiles = [] } = {}) {
  await client.query(
    `CREATE TEMP TABLE ${STAGE_TABLE} (LIKE message_templates INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT DROP`
  );
  for (const { file, sql } of templateWriteStatements(root, STAGE_TABLE)) {
    if (excludeFiles.includes(file)) continue;
    try {
      await client.query(sql);
    } catch (err) {
      throw new Error(`replaying ${file} failed: ${err.message}`);
    }
  }
  const { rows } = await client.query(
    `SELECT ${FIELDS.map((f) => `t.${f}`).join(", ")}
       FROM ${STAGE_TABLE} t JOIN orgs o ON o.id = t.org_id AND o.slug = $1
      WHERE t.template_key = ANY($2::text[])
      ORDER BY t.template_key COLLATE "C"`,
    [ORG_SLUG, [...keys]]
  );
  return rows.map((r) => Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? null])));
}

/** The migration text for these rows. Copy rides as one JSON literal, decoded by Postgres. */
export function buildRestoreSql(rows) {
  const sorted = [...rows].sort((a, b) => (a.template_key < b.template_key ? -1 : 1));
  const json = "[\n" + sorted.map((r) => JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? null])))).join(",\n") + "\n]";
  if (json.includes(JSON_TAG)) throw new Error(`template copy contains ${JSON_TAG}`);
  const approved = sorted.filter((r) => r.compliance_passed).length;
  return `-- 497_restore_missing_sql_templates.sql — GENERATED by scripts/db/template-restore.mjs. Do not edit by hand.
--
-- Puts back the ${sorted.length} message templates the Fundhub company lost (read-only production
-- read, 2026-10-20). A PG test that ran against the live database deleted them; their seed files
-- are already marked applied, so migrate alone could not restore them. Without them the welcome
-- email and text, the booking confirmation, the contract email and the document asks never send.
--
-- The copy, channel, subject and approval flag are exactly what the repo's own SQL seeds
-- produce (${approved} approved as seeded, ${sorted.length - approved} left unapproved as seeded).
--
-- INSERT ONLY. ON CONFLICT DO NOTHING: a template that already exists, edited or not, is never
-- touched. Nothing is updated or deleted. Inserting a template sends nothing: the only trigger on
-- message_templates is BEFORE UPDATE, and a send reads a template only when a workflow fires.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, r.template_key, r.channel, r.subject, r.body, r.compliance_passed
  FROM orgs o
 CROSS JOIN jsonb_to_recordset(${JSON_TAG}${json}${JSON_TAG}::jsonb)
         AS r(template_key text, channel text, subject text, body text, compliance_passed boolean)
 WHERE o.slug = '${ORG_SLUG}'
ON CONFLICT (org_id, template_key) DO NOTHING;
`;
}

/** The rows 497 carries, read back out of its JSON literal. */
export function parseRestoreRows(sql) {
  const start = sql.indexOf(JSON_TAG);
  const end = sql.indexOf(JSON_TAG, start + JSON_TAG.length);
  if (start < 0 || end < 0) throw new Error("no restore JSON literal found");
  return JSON.parse(sql.slice(start + JSON_TAG.length, end));
}

/** Everything that would make 497 more than an insert-only restore. [] means it is safe. */
export function insertOnlyProblems(sql, keys = RESTORE_KEYS) {
  const problems = [];
  const statements = sqlStatements(sql);
  if (statements.length !== 1) problems.push(`expected exactly one statement, found ${statements.length}`);
  for (const st of statements) {
    const outside = st.replace(/\$fh_tpl_restore\$[\s\S]*?\$fh_tpl_restore\$/g, "''");
    if (/\b(?:UPDATE|DELETE|TRUNCATE|ALTER|DROP|MERGE)\b/i.test(outside)) problems.push("updates, deletes or reshapes something");
    if (!/^INSERT\s+INTO\s+message_templates\b/i.test(st)) problems.push("is not an INSERT INTO message_templates");
    if (!/ON\s+CONFLICT\s*\(\s*org_id\s*,\s*template_key\s*\)\s*DO\s+NOTHING\s*;?\s*$/i.test(outside)) problems.push("is not ON CONFLICT (org_id, template_key) DO NOTHING");
    if (!new RegExp(`WHERE\\s+o\\.slug\\s*=\\s*'${ORG_SLUG}'`, "i").test(outside)) problems.push(`is not limited to org '${ORG_SLUG}'`);
  }
  let rows = [];
  try { rows = parseRestoreRows(sql); } catch (err) { problems.push(err.message); }
  const got = rows.map((r) => r.template_key);
  const want = new Set(keys);
  const extra = got.filter((k) => !want.has(k));
  const missing = [...want].filter((k) => !got.includes(k));
  if (extra.length) problems.push(`keys outside the restore list: ${extra.join(", ")}`);
  if (missing.length) problems.push(`restore keys with no row: ${missing.join(", ")}`);
  if (new Set(got).size !== got.length) problems.push("a key appears twice");
  for (const r of rows) {
    if (!["sms", "email"].includes(r.channel)) problems.push(`${r.template_key}: channel ${r.channel}`);
    if (typeof r.body !== "string" || !r.body.trim()) problems.push(`${r.template_key}: empty body`);
    if (typeof r.compliance_passed !== "boolean") problems.push(`${r.template_key}: approval flag is not true/false`);
    if (/\[DRAFT/i.test(r.body || "")) problems.push(`${r.template_key}: DRAFT copy`);
  }
  return problems;
}

async function main() {
  const { isLocalScratchDatabaseUrl } = await import("../../src/verification/scratch-guard.mjs");
  if (!isLocalScratchDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error("template-restore runs on a local scratch database only (127.0.0.1/localhost, name with ci, test or scratch)");
  }
  const { pool, close } = await import("../../src/db.mjs");
  const client = await pool().connect();
  let rows;
  try {
    await client.query("BEGIN");
    rows = await stageSeedRows(client, { excludeFiles: RESTORE_SNAPSHOT_EXCLUDE_FILES });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await close();
  }
  const built = buildRestoreSql(rows);
  const problems = insertOnlyProblems(built);
  if (problems.length) throw new Error(`generated restore is not insert-only: ${problems.join("; ")}`);
  const target = path.join(ROOT, MIGRATION);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(target, built);
    console.log(`wrote ${MIGRATION} (${rows.length} templates)`);
    return;
  }
  const saved = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (saved !== built) throw new Error(`${MIGRATION} does not match the repo SQL; review, then run with --write`);
  console.log(`${MIGRATION} matches the repo SQL (${rows.length} templates)`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
