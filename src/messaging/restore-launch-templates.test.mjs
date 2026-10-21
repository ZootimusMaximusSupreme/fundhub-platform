// db/seed/298_restore_launch_templates_2026_10_20.sql puts back five launch messages that a test run
// deleted from the live database (2026-10-11/12). These checks need no database: they read the SQL files
// and prove the restore carries the SAME words the original seeds wrote, byte for byte, and that the
// pulse's own template check goes green on them and red without them.
// The database half (delete, run the file, compare every column) is restore-launch-templates.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMAIL_PATH, TEXT_PATH, judgeTemplates } from "../pulse/beats/lib/send-path.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEED_DIR = path.join(ROOT, "db/seed");
const RESTORE_FILE = "298_restore_launch_templates_2026_10_20.sql";
const read = (dir, f) => fs.readFileSync(path.join(ROOT, dir, f), "utf8");
const RESTORE = read("db/seed", RESTORE_FILE);

/* Where each key's last approved words live. For EMAIL-S04-01-CONFIRM, seed/012 already holds the portal
   link that seed/016 added on live (016 changes nothing on a body that has it, checked below). For
   SMS-S00-WELCOME, seed/295 runs after seed/013 and rewrites it (checked below). */
const SOURCES = {
  "EMAIL-S00-WELCOME": { file: "013_section4_message_templates.sql", channel: "email" },
  "EMAIL-S04-01-CONFIRM": { file: "012_s04_booking_confirm_email.sql", channel: "email" },
  "CONTRACT-SEND-EMAIL": { file: "008_contract_messages.sql", channel: "email" },
  "SMS-S00-WELCOME": { file: "295_sms_copy_2026_09.sql", channel: "sms" },
  "SMS-DOC-01-REQUEST": { file: "013_section4_message_templates.sql", channel: "sms" }
};
const KEYS = Object.keys(SOURCES);

/* ---- a small reader for SQL values: NULL, '...', E'...', $tag$...$tag$, joined with || ---- */

function readLiteral(sql, i) {
  const dollar = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
  if (dollar) {
    const tag = dollar[0];
    const end = sql.indexOf(tag, i + tag.length);
    if (end < 0) throw new Error(`unclosed ${tag} at ${i}`);
    return { value: sql.slice(i + tag.length, end), end: end + tag.length };
  }
  const escaped = sql[i] === "E" && sql[i + 1] === "'";
  let j = i + (escaped ? 2 : 1);
  if (sql[j - 1] !== "'") throw new Error(`no string literal at ${i}: ${sql.slice(i, i + 30)}`);
  let out = "";
  for (;;) {
    const ch = sql[j];
    if (ch === undefined) throw new Error(`unclosed string at ${i}`);
    if (ch === "'" && sql[j + 1] === "'") { out += "'"; j += 2; continue; }
    if (ch === "'") return { value: out, end: j + 1 };
    if (escaped && ch === "\\") {
      const n = sql[j + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      j += 2;
      continue;
    }
    out += ch;
    j += 1;
  }
}

function readExpr(sql, i) {
  const skip = (k) => { while (/\s/.test(sql[k] ?? "")) k += 1; return k; };
  i = skip(i);
  if (/^NULL\b/i.test(sql.slice(i))) {
    i += 4;
    const cast = /^::text\b/.exec(sql.slice(i));
    return { value: null, end: cast ? i + cast[0].length : i };
  }
  let value = "";
  for (;;) {
    const lit = readLiteral(sql, i);
    value += lit.value;
    i = skip(lit.end);
    if (sql.startsWith("||", i)) { i = skip(i + 2); continue; }
    return { value, end: i };
  }
}

/** The n values that follow the quoted key, e.g. 'email', subject, body. */
function valuesAfterKey(sql, key, n) {
  const at = sql.indexOf(`'${key}'`);
  if (at < 0) throw new Error(`${key} is not in the file`);
  let i = at + key.length + 2;
  const out = [];
  while (out.length < n) {
    while (/\s/.test(sql[i] ?? "")) i += 1;
    if (sql[i] !== ",") throw new Error(`${key}: expected a comma at ${i}, found ${JSON.stringify(sql.slice(i, i + 20))}`);
    const e = readExpr(sql, i + 1);
    out.push(e.value);
    i = e.end;
  }
  return out;
}

/** What the restore file writes for a key. */
function restored(sql, key) {
  const [channel, subject, body] = valuesAfterKey(sql, key, 3);
  return { channel, subject, body };
}

/** What the original seed wrote. Email seeds carry channel, subject, body; text seeds carry only the body. */
function original(key) {
  const src = SOURCES[key];
  const sql = read("db/seed", src.file);
  if (src.channel === "sms") return { channel: "sms", subject: null, body: valuesAfterKey(sql, key, 1)[0] };
  const [channel, subject, body] = valuesAfterKey(sql, key, 3);
  return { channel, subject, body };
}

/** Every key whose restored words differ from the original, with the first column that differs. */
function mismatches(sql) {
  const bad = [];
  for (const key of KEYS) {
    const a = restored(sql, key);
    const b = original(key);
    for (const col of ["channel", "subject", "body"]) {
      if (a[col] !== b[col]) { bad.push(`${key}.${col}`); break; }
    }
  }
  return bad;
}

/* ---------------------------------------------------------------- */

test("restore: it names exactly the five keys the pulse found missing, each on the launch path it guards", () => {
  const named = [...RESTORE.matchAll(/^\s*\('([A-Z0-9-]+)',\s*'(email|sms)'/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(named.map(([k]) => k).sort(), [...KEYS].sort());
  for (const [key, channel] of named) {
    assert.equal(channel, SOURCES[key].channel, `${key} channel`);
    const pathList = channel === "email" ? EMAIL_PATH.templates : TEXT_PATH.templates;
    assert.ok(pathList.includes(key), `${key} is not on the ${channel} launch path the beat checks`);
  }
});

test("restore PASS: every subject and body is the original seed's, byte for byte", () => {
  assert.deepEqual(mismatches(RESTORE), []);
  // spot-check the reader on each kind of literal it decodes
  assert.match(restored(RESTORE, "EMAIL-S00-WELCOME").subject, /^You're in — here's what happens next$/);
  assert.match(restored(RESTORE, "CONTRACT-SEND-EMAIL").body, /^Hi \{\{contact\.first_name\}\},\n\n\{\{contract\.sender\}\} has sent you/);
  assert.match(restored(RESTORE, "SMS-S00-WELCOME").body, /Josh at Fundhub\. Your application is in\./);
  assert.match(restored(RESTORE, "SMS-DOC-01-REQUEST").body, /Before we can start, we need a few documents from you\./);
});

test("restore FAIL: one changed character in any message is caught", () => {
  const changes = [
    ["what's realistically fundable", "what's really fundable"],             // EMAIL-S00-WELCOME body
    ["'You''re booked — {{appointment.start_time}}'", "'You''re booked - {{appointment.start_time}}'"], // EMAIL-S04 subject
    ["It works for 30 days.", "It works for 31 days."],                       // CONTRACT-SEND-EMAIL body
    ["Nothing is reviewed yet; that", "Nothing is reviewed yet, that"],       // SMS-S00-WELCOME body
    ["Or just reply to this text with photos.", "Or reply to this text with photos."] // SMS-DOC-01-REQUEST body
  ];
  for (const [from, to] of changes) {
    assert.ok(RESTORE.includes(from), `fixture text not found: ${from}`);
    assert.equal(mismatches(RESTORE.replace(from, to)).length, 1, `a change to "${from}" was not caught`);
  }
});

test("restore: the sources really are the last word for each key", () => {
  // 016 only rewrites a confirm email that has no portal link; 012 already has it, so 016 changes nothing.
  const s016 = read("db/seed", "016_s04_confirm_portal_link.sql");
  assert.match(s016, /AND body NOT LIKE '%\{\{magic_link\.url\}\}%'/);
  assert.ok(original("EMAIL-S04-01-CONFIRM").body.includes("{{magic_link.url}}"));
  // 295 rewrites the welcome text after 013 (name order) with DO UPDATE, so its words are the live ones.
  assert.ok("295_sms_copy_2026_09.sql" > "013_section4_message_templates.sql");
  assert.match(read("db/seed", "295_sms_copy_2026_09.sql"), /ON CONFLICT \(org_id, template_key\) DO UPDATE SET\s+body = EXCLUDED\.body/);
  assert.notEqual(valuesAfterKey(read("db/seed", "013_section4_message_templates.sql"), "SMS-S00-WELCOME", 1)[0], original("SMS-S00-WELCOME").body);
});

test("restore: safe to run again, never overwrites, Fundhub company only, runs after every other seed", () => {
  const sqlOnly = RESTORE.replace(/^--.*$/gm, "");
  assert.match(sqlOnly, /ON CONFLICT \(org_id, template_key\) DO NOTHING;\s*$/);
  assert.doesNotMatch(sqlOnly, /DO UPDATE|\bUPDATE\b|\bDELETE\b/i);
  assert.match(sqlOnly, /WHERE o\.slug = 'fundhub'/);
  const seeds = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(seeds.at(-1), RESTORE_FILE, "a fresh database must run the original seeds first");
});

test("restore PASS and FAIL through the pulse's own check (template-ready)", () => {
  const rows = (channel) => KEYS.filter((k) => SOURCES[k].channel === channel)
    .map((k) => ({ template_key: k, compliance_passed: true, ...restored(RESTORE, k) }));
  const magic = { template_key: "EMAIL-PORTAL-MAGIC-LINK", compliance_passed: true, subject: "Sign in", body: "Your link" };
  const confirm = { template_key: "SMS-S04-01-CONFIRM", compliance_passed: true, subject: null, body: "You're booked" };
  // green: the restored words, next to the two launch rows that were never deleted
  assert.deepEqual(judgeTemplates({ rows: [...rows("email"), magic], path: EMAIL_PATH }).problems, []);
  assert.deepEqual(judgeTemplates({ rows: [...rows("sms"), confirm], path: TEXT_PATH }).problems, []);
  // red: the live state before this fix
  assert.deepEqual(judgeTemplates({ rows: [magic], path: EMAIL_PATH }).problems,
    ["EMAIL-S00-WELCOME is missing.", "EMAIL-S04-01-CONFIRM is missing.", "CONTRACT-SEND-EMAIL is missing."]);
  assert.deepEqual(judgeTemplates({ rows: [confirm], path: TEXT_PATH }).problems,
    ["SMS-S00-WELCOME is missing.", "SMS-DOC-01-REQUEST is missing."]);
});
