// SMS and email opt-out. Read only. Report only.
//
// Three breaks, and no others:
//   a STOP or unsubscribe that did not stick
//   the opt-out table cannot be read
//   a client text or email send path skips opt-out, or a person who opted
//   out still got a message after that time
//
// Voice is not this lane. Consent papers are not this lane. The SMS gap
// already skips people who opted out of texts. This file does not check
// whether a text was queued. It checks the opt-out itself.
//
// The send is src/messaging/dispatch.mjs. It must call the gate first.
// The gate must read opt-out for the channel on the message (text or email).
// A direct Twilio, Resend, or Mailgun send that is not the owner or staff
// alert list is a send that skips opt-out.
//
// Owner and staff alerts are not client opt-out. They are listed in
// NOT_CLIENT_SENDS and this file does not call them a miss.
//
// One tripwire stays Recon. No second watchdog. This file does not send a
// message. It does not change an opt-out row.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

export const LOOKBACK_DAYS = 30;
export const STOP_GRACE_MINUTES = 5;

/** Whole-body words. Same lists as src/handlers/comms.mjs. */
export const SMS_STOP_WORDS = Object.freeze([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"
]);
export const EMAIL_STOP_WORDS = Object.freeze([
  "STOP", "STOPALL", "UNSUBSCRIBE", "REMOVE", "OPT OUT", "OPTOUT", "OPT-OUT"
]);

export const CHECK_IDS = Object.freeze([
  "opt-out:table-unreadable",
  "opt-out:stop-did-not-stick",
  "opt-out:send-ignores"
]);

export const GATE_FILE = "src/messaging/gate.mjs";
export const DISPATCH_FILE = "src/messaging/dispatch.mjs";

/** These text or email the owner or staff. They are not a client opt-out. */
export const NOT_CLIENT_SENDS = Object.freeze([
  Object.freeze({ file: "src/pulse/notify.mjs", why: "texts the owner" }),
  Object.freeze({ file: "src/pulse/instant-watch.mjs", why: "texts the owner" }),
  Object.freeze({ file: "src/ad-videos/notify-fanout.mjs", why: "texts the owner" }),
  Object.freeze({ file: "src/staff/blake-lead-watch.mjs", why: "texts the owner about a lead" }),
  Object.freeze({ file: "src/staff/comp-alerts.mjs", why: "emails staff about pay" }),
  Object.freeze({ file: "src/auth/staff-mail.mjs", why: "emails staff a login link" })
]);

const LEFT_STATUSES = Object.freeze(["sent", "delivered", "complained"]);

const TAIL =
  "Recon stays the one tripwire. Do not send a message. Do not change an opt-out row.";

const FIX = Object.freeze({
  table: `The opt-out table could not be read. Fix that read. ${TAIL}`,
  stop: `A STOP or unsubscribe did not land on an opt-out row. Read that inbound message and the opt-out row. ${TAIL}`,
  send: `A text or email left after an opt-out, or a send path does not read opt-out. Read that path and those message rows. ${TAIL}`
});

const WORD_RE = /^[A-Z0-9 -]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_IMPORT_RE = /^\s*import\s[^;]*messaging\/providers\/(?:twilio|resend|mailgun)\.mjs/m;
const OPT_OUT_READ_RE = /isOptedOut\s*\(|\bopt_outs\b|gateAndRecord\s*\(|\bdispatchOne\s*\(|\bdispatchMessage\s*\(|\bdispatchDue\s*\(|\bdrain\s*\(/;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(value, n = 160) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, n);
}

function assertSelect(sql) {
  const s = String(sql || "").trim();
  if (!/^select\b/i.test(s) || /[;]/.test(s) || /\b(insert|update|delete|drop|alter|truncate)\b/i.test(s)) {
    throw new Error("opt-out gap check refused a write");
  }
}

function sqlWords(words) {
  return words.map((word) => {
    if (typeof word !== "string" || !WORD_RE.test(word)) throw new Error("bad stop word");
    return `'${word}'`;
  }).join(", ");
}

function graceMinutes(n = STOP_GRACE_MINUTES) {
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error("bad stop grace");
  return n;
}

function statusList(statuses = LEFT_STATUSES) {
  return statuses.map((status) => {
    if (!/^[a-z]+$/.test(status)) throw new Error("bad message status");
    return `'${status}'`;
  }).join(", ");
}

/**
 * Inbound STOP / unsubscribe with no opt-out that covers it.
 * A later START counts as stuck: the row was written, then they opted back in.
 * Already opted out before this STOP also counts as stuck.
 */
export function buildStopSql() {
  const grace = graceMinutes();
  return `
SELECT /* gap:opt-out-stop */ count(DISTINCT m.client_id)::int AS n
  FROM messages m
  LEFT JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'inbound'
   AND m.channel IN ('sms', 'email')
   AND m.client_id IS NOT NULL
   AND m.created_at >= $2::timestamptz
   AND ($3::boolean OR COALESCE(m.is_demo, false) = false)
   AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
   AND (
     (m.channel = 'sms' AND upper(regexp_replace(coalesce(m.rendered_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) IN (${sqlWords(SMS_STOP_WORDS)}))
     OR
     (m.channel = 'email' AND upper(regexp_replace(coalesce(m.rendered_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) IN (${sqlWords(EMAIL_STOP_WORDS)}))
   )
   AND NOT EXISTS (
     SELECT 1 FROM opt_outs o
      WHERE o.client_id = m.client_id
        AND o.org_id = m.org_id
        AND o.channel = m.channel
        AND (
          (o.opted_in_at IS NULL AND o.opted_out_at <= m.created_at + interval '${grace} minutes')
          OR
          (o.opted_in_at IS NOT NULL
           AND o.opted_out_at >= m.created_at - interval '${grace} minutes'
           AND o.opted_in_at >= o.opted_out_at)
        )
   )`.trim();
}

/** People who were still opted out and still got a text or email after that time. */
export function buildSentAfterSql() {
  return `
SELECT /* gap:opt-out-sent-after */
       count(DISTINCT m.client_id)::int AS people,
       count(*)::int AS n
  FROM messages m
  JOIN opt_outs o
    ON o.client_id = m.client_id
   AND o.org_id = m.org_id
   AND o.channel = m.channel
   AND o.opted_in_at IS NULL
  JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.status IN (${statusList()})
   AND COALESCE(m.last_attempt_at, m.created_at) > o.opted_out_at
   AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
   AND ($3::boolean OR COALESCE(m.is_demo, false) = false)
   AND ($3::boolean OR COALESCE(c.is_demo, false) = false)`.trim();
}

export const TABLE_SQL = `
SELECT /* gap:opt-out-table */ count(*)::int AS n
  FROM opt_outs
 WHERE org_id = $1::uuid`.trim();

export const STOP_SQL = buildStopSql();
export const SENT_AFTER_SQL = buildSentAfterSql();

/** True when this gate source does not read opt-out for the message channel. */
export function gateIgnoresOptOut(src) {
  const text = String(src || "");
  if (!text.trim()) return true;
  return !/isOptedOut\s*\([^)]*\bchannel\b/.test(text);
}

/** True when this dispatch source sends without the gate. */
export function dispatchIgnoresOptOut(src) {
  const text = String(src || "");
  if (!text.trim()) return true;
  if (!/provider\.send\s*\(/.test(text)) return true;
  return !/gateAndRecord\s*\(/.test(text);
}

/**
 * True when this source imports Twilio, Resend, or Mailgun and sends,
 * and never reads opt-out or hands the row to the dispatcher.
 * A comment that only names the provider file is not a send.
 */
export function directSendIgnoresOptOut(src) {
  const text = String(src || "");
  if (!PROVIDER_IMPORT_RE.test(text)) return false;
  if (!/\bsend(?:Sms|Resend|Impl)?\s*\(/.test(text)) return false;
  return !OPT_OUT_READ_RE.test(text);
}

/**
 * Send paths that skip opt-out.
 * sources: { "src/messaging/gate.mjs": "<file text>", ... }
 * A missing gate or dispatch file is a miss. Owner and staff alerts are not.
 */
export function ignoredSendPaths(sources = {}) {
  const misses = [];
  const gate = sources[GATE_FILE];
  if (typeof gate !== "string" || gateIgnoresOptOut(gate)) {
    misses.push({ file: GATE_FILE, why: "does not read opt-out for the message channel" });
  }
  const dispatch = sources[DISPATCH_FILE];
  if (typeof dispatch !== "string" || dispatchIgnoresOptOut(dispatch)) {
    misses.push({ file: DISPATCH_FILE, why: "sends without the opt-out gate" });
  }
  const exempt = new Set(NOT_CLIENT_SENDS.map((row) => row.file));
  for (const [file, src] of Object.entries(sources)) {
    if (file === GATE_FILE || file === DISPATCH_FILE || exempt.has(file)) continue;
    if (typeof src !== "string") continue;
    if (directSendIgnoresOptOut(src)) {
      misses.push({ file, why: "sends a text or email and does not read opt-out" });
    }
  }
  return misses;
}

function walkSendFiles(dir, root, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const relDir = path.relative(root, abs).split(path.sep).join("/");
      if (relDir === "src/messaging/providers" || relDir === "src/pulse/coverage") continue;
      walkSendFiles(abs, root, out);
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith(".mjs") || ent.name.endsWith(".test.mjs")) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (rel === GATE_FILE || rel === DISPATCH_FILE || PROVIDER_IMPORT_RE.test(text)) {
      out[rel] = text;
    }
  }
}

export function loadSendSources(root = REPO_ROOT) {
  const out = {};
  walkSendFiles(path.join(root, "src"), root, out);
  for (const file of [GATE_FILE, DISPATCH_FILE]) {
    if (typeof out[file] === "string") continue;
    try {
      out[file] = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      out[file] = null;
    }
  }
  return out;
}

function orgIdOf(ctx) {
  const id = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  return UUID_RE.test(id) ? id : "";
}

function canQuery(db) {
  return !!(db && typeof db.query === "function");
}

async function safeQuery(db, sql, params) {
  assertSelect(sql);
  try {
    const res = await db.query(sql, params);
    const row = res && res.rows && res.rows[0];
    if (!row) return { ok: false, error: "The read did not return a count." };
    const n = Number(row.n);
    if (!Number.isFinite(n)) return { ok: false, error: "The read did not return a count." };
    const people = Number(row.people);
    return {
      ok: true,
      n: Math.max(0, Math.floor(n)),
      people: Number.isFinite(people) ? Math.max(0, Math.floor(people)) : null
    };
  } catch (err) {
    return { ok: false, error: clip(err && err.message) || "read failed" };
  }
}

function personWord(n) {
  return n === 1 ? "person" : "people";
}

function stopRow(result) {
  if (!result.ok) {
    return check("opt-out:stop-did-not-stick", "FAIL", `Could not read STOP replies: ${result.error}`, FIX.stop);
  }
  if (result.n > 0) {
    const who = `${result.n} ${personWord(result.n)}`;
    return check(
      "opt-out:stop-did-not-stick",
      "FAIL",
      `${who} sent STOP or unsubscribe in the last ${LOOKBACK_DAYS} days and the opt-out did not stick.`,
      FIX.stop
    );
  }
  return check(
    "opt-out:stop-did-not-stick",
    "PASS",
    `No STOP or unsubscribe in the last ${LOOKBACK_DAYS} days is missing its opt-out.`
  );
}

function sendRow(codeMisses, count) {
  const codeFail = codeMisses.length > 0;
  const countFail = !!(count && count.ok && ((count.people != null ? count.people : count.n) > 0));
  const countBroken = !!(count && count.ok === false);
  if (!codeFail && !countFail && !countBroken) {
    if (!count) {
      return check(
        "opt-out:send-ignores",
        "skip",
        "Client text and email sends read opt-out. No database in this run, so messages after an opt-out were not counted."
      );
    }
    return check(
      "opt-out:send-ignores",
      "PASS",
      `Client text and email sends read opt-out. In the last ${LOOKBACK_DAYS} days, nobody who was opted out got a message after that time.`
    );
  }
  const parts = [];
  for (const miss of codeMisses) parts.push(`${miss.file} ${miss.why}.`);
  if (countBroken) parts.push(`Could not count messages after an opt-out: ${count.error}`);
  if (countFail) {
    const people = count.people != null ? count.people : count.n;
    const who = `${people} ${personWord(people)} who opted out still got a message after the opt-out time`;
    const extra = count.n > people ? ` (${count.n} messages)` : "";
    parts.push(`${who}${extra}.`);
  }
  return check("opt-out:send-ignores", "FAIL", parts.join(" "), FIX.send);
}

function tableRow(result) {
  if (!result.ok) {
    return check("opt-out:table-unreadable", "FAIL", `The opt-out table could not be read: ${result.error}`, FIX.table);
  }
  return check("opt-out:table-unreadable", "PASS", "The opt-out table can be read.");
}

/**
 * gapChecks — SMS and email opt-out only.
 * ctx: { db, orgId, now, demoOn, root, sources }.
 * sources replaces the send-path file read (tests).
 * SELECT only. Never sends. Never writes an opt-out row.
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  try {
    const sources = ctx.sources || loadSendSources(ctx.root || REPO_ROOT);
    const codeMisses = ignoredSendPaths(sources);
    const db = ctx.db;
    const orgId = orgIdOf(ctx);
    if (!canQuery(db) || !orgId) {
      const why = !canQuery(db) ? "No database in this run." : "No company in this run.";
      return [
        check("opt-out:table-unreadable", "skip", `${why} The opt-out table was not read.`),
        check("opt-out:stop-did-not-stick", "skip", `${why} STOP replies were not read.`),
        sendRow(codeMisses, null)
      ];
    }
    const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const demoOn = ctx.demoOn === true;
    const table = await safeQuery(db, TABLE_SQL, [orgId]);
    if (!table.ok) {
      return [
        tableRow(table),
        check(
          "opt-out:stop-did-not-stick",
          "skip",
          "The opt-out table could not be read, so STOP replies were not checked."
        ),
        sendRow(codeMisses, null)
      ];
    }
    const [stop, sent] = await Promise.all([
      safeQuery(db, STOP_SQL, [orgId, since, demoOn]),
      safeQuery(db, SENT_AFTER_SQL, [orgId, since, demoOn])
    ]);
    return [
      tableRow(table),
      stopRow(stop),
      sendRow(codeMisses, sent)
    ];
  } catch (err) {
    const detail = `Opt-out check stopped: ${clip(err && err.message)}`;
    return [
      check("opt-out:table-unreadable", "FAIL", detail, FIX.table),
      check("opt-out:stop-did-not-stick", "FAIL", detail, FIX.stop),
      check("opt-out:send-ignores", "FAIL", detail, FIX.send)
    ];
  }
}
