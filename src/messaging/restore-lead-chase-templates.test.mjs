// db/seed/299_restore_lead_chase_templates_2026_10_20.sql puts back seven new-lead messages that a test run
// deleted from the live database (2026-10-11/12): the finish-the-application email and the six never-booked
// chase messages. These checks need no database: they read the SQL files and prove the restore carries the
// SAME words the original seeds left on live, byte for byte, for every template the two workflows send.
// The database half (delete, run the file, compare every column) is restore-lead-chase-templates.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMAIL_TEMPLATE_KEY as NUDGE_KEY } from "../workflows/s-02-incomplete-survey-nudge.mjs";
import * as nobook from "../workflows/s-nobook-chase.mjs";
import { TEMPLATES as HANDOFF_TEMPLATES } from "../pulse/coverage/gap-handoff.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, "db/seed", f), "utf8");
const RESTORE = read("299_restore_lead_chase_templates_2026_10_20.sql");
const S013 = read("013_section4_message_templates.sql");
const S015 = read("015_live_template_backfill.sql");
const S295 = read("295_sms_copy_2026_09.sql");

const NOBOOK_KEYS = [
  nobook.SMS_NOBOOK_01, nobook.SMS_NOBOOK_02, nobook.SMS_NOBOOK_03,
  nobook.EMAIL_NOBOOK_01, nobook.EMAIL_NOBOOK_02, nobook.EMAIL_NOBOOK_03
];
const KEYS = [NUDGE_KEY, ...NOBOOK_KEYS].sort();

/* ---- a small reader for SQL values: NULL, '...', $tag$...$tag$ ---- */

function readLiteral(sql, i) {
  const dollar = /^\$([A-Za-z_0-9]*)\$/.exec(sql.slice(i));
  if (dollar) {
    const tag = dollar[0];
    const end = sql.indexOf(tag, i + tag.length);
    if (end < 0) throw new Error(`unclosed ${tag} at ${i}`);
    return { value: sql.slice(i + tag.length, end), end: end + tag.length };
  }
  if (sql[i] !== "'") throw new Error(`no string literal at ${i}: ${sql.slice(i, i + 30)}`);
  let j = i + 1;
  let out = "";
  for (;;) {
    const ch = sql[j];
    if (ch === undefined) throw new Error(`unclosed string at ${i}`);
    if (ch === "'" && sql[j + 1] === "'") { out += "'"; j += 2; continue; }
    if (ch === "'") return { value: out, end: j + 1 };
    out += ch;
    j += 1;
  }
}

function readExpr(sql, i) {
  while (/\s/.test(sql[i] ?? "")) i += 1;
  if (/^NULL\b/i.test(sql.slice(i))) {
    i += 4;
    const cast = /^::text\b/.exec(sql.slice(i));
    return { value: null, end: cast ? i + cast[0].length : i };
  }
  return readLiteral(sql, i);
}

/** The n values that follow the LAST quoted occurrence of the key in a file (the last write wins). */
function valuesAfter(sql, key, n) {
  const at = sql.lastIndexOf(`'${key}'`);
  assert.ok(at >= 0, `${key} is not in the file`);
  let i = at + key.length + 2;
  const out = [];
  for (let k = 0; k < n; k += 1) {
    i = sql.indexOf(",", i) + 1;
    const e = readExpr(sql, i);
    out.push(e.value);
    i = e.end;
  }
  return out;
}

/** What the restore writes: { key: { channel, subject, body } }. */
function restored() {
  const start = RESTORE.indexOf("CROSS JOIN (VALUES");
  const end = RESTORE.indexOf(") AS k(template_key, channel, subject, body)");
  const block = RESTORE.slice(start, end);
  const out = {};
  for (const m of block.matchAll(/\(\s*'([A-Z0-9-]+)',/g)) {
    const [channel, subject, body] = valuesAfter(block, m[1], 3);
    out[m[1]] = { channel, subject, body };
  }
  return out;
}

/** What the original seeds left on live, in the order they ran (013, 015, 295). */
function seeded() {
  const out = {};
  const [c2, s2, b2] = valuesAfter(S015, NUDGE_KEY, 3);
  out[NUDGE_KEY] = { channel: c2, subject: s2, body: b2 };
  for (const key of [nobook.EMAIL_NOBOOK_01, nobook.EMAIL_NOBOOK_02, nobook.EMAIL_NOBOOK_03]) {
    const [channel, subject, body] = valuesAfter(S013, key, 3);
    out[key] = { channel, subject, body };
  }
  // seed/295 renames the first chase email's subject on live, and only when it still holds the old one.
  const rename = /UPDATE message_templates\s+SET subject = ('(?:[^']|'')*'),[\s\S]*?WHERE template_key = 'EMAIL-NOBOOK-01'\s+AND subject = ('(?:[^']|'')*');/.exec(S295);
  assert.ok(rename, "seed/295 no longer renames the EMAIL-NOBOOK-01 subject the way this test reads it");
  const [renamedTo, renamedFrom] = [readLiteral(rename[1], 0).value, readLiteral(rename[2], 0).value];
  assert.equal(out[nobook.EMAIL_NOBOOK_01].subject, renamedFrom, "seed/013's subject is the one seed/295 renames");
  out[nobook.EMAIL_NOBOOK_01].subject = renamedTo;
  // seed/295 rewrites the three chase texts that seed/011 first wrote; its words win.
  for (const key of [nobook.SMS_NOBOOK_01, nobook.SMS_NOBOOK_02, nobook.SMS_NOBOOK_03]) {
    const [body] = valuesAfter(S295, key, 1);
    out[key] = { channel: "sms", subject: null, body };
  }
  return out;
}

test("restore 299 holds exactly the templates the finish-application nudge and the never-booked chase send", () => {
  assert.deepEqual(Object.keys(restored()).sort(), KEYS);
  assert.equal(HANDOFF_TEMPLATES.nudge, NUDGE_KEY, "the pulse's nudge template is the one the workflow sends");
  assert.equal(HANDOFF_TEMPLATES.nobook, nobook.EMAIL_NOBOOK_01, "the pulse's chase template is the one the workflow sends");
});

test("restore 299 carries the original seeds' words byte for byte: channel, subject and body", () => {
  const got = restored();
  const want = seeded();
  for (const key of KEYS) assert.deepEqual(got[key], want[key], key);
});

test("restore 299 changes nothing that is there and writes the Fundhub company only", () => {
  assert.match(RESTORE, /ON CONFLICT \(org_id, template_key\) DO NOTHING;\s*$/);
  assert.doesNotMatch(RESTORE, /DO UPDATE|^\s*UPDATE |^\s*DELETE /im);
  assert.match(RESTORE, /WHERE o\.slug = 'fundhub'\n/);
  assert.equal((RESTORE.match(/INSERT INTO message_templates/g) || []).length, 1);
});

test("the reader is not fooled: a changed word in the restore is caught", () => {
  const want = seeded();
  const tampered = { ...want[nobook.SMS_NOBOOK_02], body: want[nobook.SMS_NOBOOK_02].body.replace("20 minutes", "30 minutes") };
  assert.notDeepEqual(tampered, want[nobook.SMS_NOBOOK_02]);
  assert.notDeepEqual(restored()[nobook.SMS_NOBOOK_02], tampered);
});
