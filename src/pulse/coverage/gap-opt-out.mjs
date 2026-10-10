// SMS and email opt-out. Read only. Report only.
//
// Four breaks, and no others:
//   a STOP, an unsubscribe, or a spam complaint that did not stick
//   the opt-out table cannot be used (read, or take a STOP)
//   a client text or email send path skips opt-out, or a person who opted
//   out still got a message after that time
//   an email unsubscribe link cannot be made or checked (no secret, or a
//   broken signer): the mail would go out with no way to unsubscribe
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
//
// Review notes (Claude, 2026-10-08):
//   * The shipped function holds no repo folder next to this file. REPO_ROOT
//     pointed at a folder that is not there, so the code scan read nothing and
//     the send row read FAIL every morning ("gate.mjs does not read opt-out").
//     The scan now looks where the shipped function keeps src/ (see
//     sourceRoots). Source it cannot find is a skipped scan, never a FAIL.
//   * The gate and the dispatcher are now run for real, against an in-memory
//     database that says "this person opted out". A comment in a file cannot
//     fool that. A gate that lets an opted-out person through is a FAIL.
//   * The STOP read counted a person twice-over: someone who sent STOP two times
//     more than five minutes apart looked like a STOP that did not stick,
//     because the later STOP moved the opt-out time. It now asks the real
//     question: is that person opted out now, or did they opt back in after?
//   * A STOP from a number that matched no client has no person to opt out. The
//     old read dropped those rows. They are now counted (273 of 274 inbound
//     texts in production match no client).
//   * The table read now also proves a STOP can be saved: the app can add and
//     change rows, and the unique key (client, channel) that the save needs is
//     still there. Drop that key and every STOP throws, with no STOP in the
//     history to show it.
//   * A message sent while someone was opted out, and then they opted back in,
//     used to fall out of the count. It is counted now.
//   * A second place that imports a provider under another name than send is
//     now seen, as is a provider loaded with import().
// Second review (Claude, 2026-10-08):
//   * A spam complaint is an unsubscribe. The mail webhooks write the opt-out
//     and then mark the message complained. An outbound email marked complained
//     whose person has no email opt-out is now counted (COMPLAINT_SQL).
//   * Nothing watched the unsubscribe link itself. dispatch.mjs signs one for
//     every client email, and if the secret is missing it sends the mail anyway,
//     with no link, and only logs a warning. A new row signs a link here, puts it
//     in the footer, checks it, and checks that a forged one is refused. No
//     database and no network. The secret itself is never printed.
//   * The SQL is now run for real in gap-opt-out.test.mjs (a few made-up rows
//     shadow the tables inside one SELECT), and the text of each SQL is pinned
//     line by line, so a flipped test in the SQL turns a test red.
//   * When the opt-out table could not be read, the send row said "No database
//     in this run". It now says why.

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
  "opt-out:send-ignores",
  "opt-out:unsubscribe-link"
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
  table: `The opt-out table could not take a STOP. Fix that table. ${TAIL}`,
  stop: `A STOP, unsubscribe, or spam complaint did not land on an opt-out row. Read that message and the opt-out row. ${TAIL}`,
  send: `A text or email left after an opt-out, or a send path does not read opt-out. Read that path and those message rows. ${TAIL}`,
  link: `The email unsubscribe link could not be made or checked. Look at the signing secret in the function settings (UNSUBSCRIBE_TOKEN_SECRET, 32 or more characters) and at src/messaging/unsubscribe.mjs. ${TAIL}`
});

const WORD_RE = /^[A-Z0-9 -]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A provider file pulled in by a static import or by import(). Any name for the
// send function counts, because the file is there to send.
const PROVIDER_IMPORT_RE = /^\s*import\s[^;]*providers\/(?:twilio|resend|mailgun)\.mjs|\bimport\s*\(\s*["'][^"']*providers\/(?:twilio|resend|mailgun)\.mjs/m;
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
 *
 * Covered means the person is opted out right now, or they opted back in at or
 * after the STOP (a START). A person who sent STOP twice is opted out, so both
 * STOPs are covered. A person who opted back in BEFORE the STOP and has no new
 * opt-out is not covered: the STOP did not stick.
 *
 * n is people. unlinked is STOP messages that matched no client at all: there
 * is nobody to opt out, so nothing was written.
 */
export function buildStopSql() {
  const grace = graceMinutes();
  return `
SELECT /* gap:opt-out-stop */
       count(DISTINCT s.client_id) FILTER (WHERE s.client_id IS NOT NULL AND NOT s.covered)::int AS n,
       count(*) FILTER (WHERE s.client_id IS NULL)::int AS unlinked
  FROM (
    SELECT m.client_id,
           EXISTS (
             SELECT 1 FROM opt_outs o
              WHERE o.client_id = m.client_id
                AND o.org_id = m.org_id
                AND o.channel = m.channel
                AND (o.opted_in_at IS NULL
                     OR o.opted_in_at >= m.created_at - interval '${grace} minutes')
           ) AS covered
      FROM messages m
      LEFT JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
     WHERE m.org_id = $1::uuid
       AND m.direction = 'inbound'
       AND m.channel IN ('sms', 'email')
       AND m.created_at >= $2::timestamptz
       AND ($3::boolean OR COALESCE(m.is_demo, false) = false)
       AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
       AND (
         (m.channel = 'sms' AND upper(regexp_replace(coalesce(m.rendered_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) IN (${sqlWords(SMS_STOP_WORDS)}))
         OR
         (m.channel = 'email' AND upper(regexp_replace(coalesce(m.rendered_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) IN (${sqlWords(EMAIL_STOP_WORDS)}))
       )
  ) s`.trim();
}

/**
 * People who were opted out and still got a text or email while that was true:
 * after the opt-out time, and before they opted back in (if they did).
 */
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
  JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.status IN (${statusList()})
   AND COALESCE(m.last_attempt_at, m.created_at) > o.opted_out_at
   AND (o.opted_in_at IS NULL OR COALESCE(m.last_attempt_at, m.created_at) < o.opted_in_at)
   AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
   AND ($3::boolean OR COALESCE(m.is_demo, false) = false)
   AND ($3::boolean OR COALESCE(c.is_demo, false) = false)`.trim();
}

/**
 * People whose email was marked as spam and who have no email opt-out that covers it.
 * The mail webhooks (resend-events, mailgun) write the opt-out first and then mark the
 * message complained, so a complained message with no opt-out means the save did not
 * stick. Covered means opted out now, or opted back in at or after the complaint.
 * A complaint on a message with no client has nobody to count and is not read here.
 */
export function buildComplaintSql() {
  const grace = graceMinutes();
  return `
SELECT /* gap:opt-out-complaint */
       count(DISTINCT m.client_id)::int AS n
  FROM messages m
  JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel = 'email'
   AND m.status = 'complained'
   AND m.updated_at >= $2::timestamptz
   AND ($3::boolean OR COALESCE(m.is_demo, false) = false)
   AND ($3::boolean OR COALESCE(c.is_demo, false) = false)
   AND NOT EXISTS (
     SELECT 1 FROM opt_outs o
      WHERE o.client_id = m.client_id
        AND o.org_id = m.org_id
        AND o.channel = 'email'
        AND (o.opted_in_at IS NULL
             OR o.opted_in_at >= m.updated_at - interval '${grace} minutes')
   )`.trim();
}

/**
 * Can the app use the opt-out table for a STOP? One row of facts:
 *   n          rows for this company (the read itself)
 *   can_add    the app role may add rows        ($2 names the privilege)
 *   can_change the app role may change rows     ($3 names the privilege)
 *   has_key    the unique key on (client, channel) is there. The save is an
 *              add that falls back to a change on that pair; without the key it throws.
 * The privilege names ride in as parameters so this text stays a plain read.
 */
export const TABLE_SQL = `
SELECT /* gap:opt-out-table */
       (SELECT count(*)::int FROM opt_outs WHERE org_id = $1::uuid) AS n,
       has_table_privilege(current_user, 'opt_outs', $2::text) AS can_add,
       has_table_privilege(current_user, 'opt_outs', $3::text) AS can_change,
       EXISTS (
         SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'opt_outs'
            AND indexdef ~* 'unique'
            AND indexdef ~* '[(](client_id, channel|channel, client_id)[)]'
            AND indexdef !~* ' where '
       ) AS has_key`.trim();

export const TABLE_PRIVILEGES = Object.freeze(["insert", "update"]);

export const STOP_SQL = buildStopSql();
export const SENT_AFTER_SQL = buildSentAfterSql();
export const COMPLAINT_SQL = buildComplaintSql();

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

// Line and block comments out, so a note that names isOptedOut( is not a read.
// A // counts as a comment only after a space or at the start of a line, so a
// web address inside a string is left whole.
function withoutComments(src) {
  return String(src || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * True when this source imports Twilio, Resend, or Mailgun and never reads
 * opt-out or hands the row to the dispatcher.
 * A comment that only names the provider file is not a send.
 */
export function directSendIgnoresOptOut(src) {
  const text = withoutComments(src);
  if (!PROVIDER_IMPORT_RE.test(text)) return false;
  return !OPT_OUT_READ_RE.test(text);
}

/**
 * Send paths that skip opt-out, read from source text.
 * sources: { "src/messaging/gate.mjs": "<file text>", ... }
 * A missing gate or dispatch file is a miss. Owner and staff alerts are not.
 * skipGate / skipDispatch: that file was run for real, so its text is not judged.
 */
export function ignoredSendPaths(sources = {}, { skipGate = false, skipDispatch = false } = {}) {
  const misses = [];
  const gate = sources[GATE_FILE];
  if (!skipGate && (typeof gate !== "string" || gateIgnoresOptOut(gate))) {
    misses.push({ file: GATE_FILE, why: "does not read opt-out for the message channel" });
  }
  const dispatch = sources[DISPATCH_FILE];
  if (!skipDispatch && (typeof dispatch !== "string" || dispatchIgnoresOptOut(dispatch))) {
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

/**
 * Where src/ can live. In a checkout it is three folders above this file. The
 * shipped function is bundled into netlify/functions/<name>.mjs, so this file's
 * own folder is gone and src/ sits next to netlify/ at the function root, which
 * is also LAMBDA_TASK_ROOT and the working folder. An explicit root (tests) is
 * the only root.
 */
export function sourceRoots({ root, env = process.env, cwd = process.cwd() } = {}) {
  if (root) return [root];
  const list = [REPO_ROOT, path.resolve(HERE, "../.."), env && env.LAMBDA_TASK_ROOT, cwd];
  return [...new Set(list.filter((r) => typeof r === "string" && r))];
}

/** First root that holds src/messaging, or null when none does. */
export function findSourceRoot(roots) {
  for (const root of roots || []) {
    try {
      if (fs.statSync(path.join(root, "src", "messaging")).isDirectory()) return root;
    } catch {
      // not under this root; try the next
    }
  }
  return null;
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
    if (rel === GATE_FILE || rel === DISPATCH_FILE || PROVIDER_IMPORT_RE.test(withoutComments(text))) {
      out[rel] = text;
    }
  }
}

/** root is one folder, or a list of folders (the first that holds src/messaging wins). */
export function loadSendSources(rootArg = REPO_ROOT) {
  const roots = Array.isArray(rootArg) ? rootArg : [rootArg];
  const root = findSourceRoot(roots) || roots[0];
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

// ---- Run the gate and the dispatcher for real, on an in-memory database ----
//
// The database here is made up inside this file. It says "this person opted out
// of one channel" and answers every other read with nothing. The gate and the
// dispatcher are the real ones. Nothing is sent: the network is closed, and a
// dispatcher that skipped the gate would stop at "no route" because the made-up
// database holds no routing row.

const PROBE_ORG = "00000000-0000-4000-8000-0000000000a1";
const PROBE_CLIENT = "00000000-0000-4000-8000-0000000000a2";
const PROBE_MESSAGE = "00000000-0000-4000-8000-0000000000a3";
// Noon in Arizona, so quiet hours are closed and a text is not put off.
const PROBE_NOON = () => new Date("2026-10-07T19:00:00.000Z");
const PROBE_CHANNELS = Object.freeze(["sms", "email"]);
const PROBE_BODY = "Opt-out probe. This message is never sent.";

function closedFetch() {
  return Promise.reject(new Error("opt-out probe: the network is closed"));
}

function probeDb(optedOutChannel, seen) {
  return {
    async query(sql, params) {
      const text = String(sql);
      seen.push(text);
      if (/\bopt_outs\b/i.test(text)) {
        const asked = Array.isArray(params) && params.includes(optedOutChannel);
        return { rows: asked ? [{ "?column?": 1 }] : [], rowCount: asked ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function codes(verdict) {
  return Array.isArray(verdict && verdict.reasons) ? verdict.reasons.map((r) => r && r.code) : [];
}

function channelWord(channel) {
  return channel === "sms" ? "text" : "email";
}

function aMessage(channel) {
  return channel === "sms" ? "a text" : "an email";
}

/** { ran, why, misses } — the real gate(), on a person who opted out of one channel. */
export async function probeGate(mod) {
  if (!mod || typeof mod.gate !== "function") {
    return { ran: false, why: "gate() could not be loaded", misses: [] };
  }
  try {
    const verdicts = [];
    for (const optedOut of PROBE_CHANNELS) {
      for (const channel of PROBE_CHANNELS) {
        const verdict = await mod.gate(
          probeDb(optedOut, []),
          { orgId: PROBE_ORG, clientId: PROBE_CLIENT, channel, body: PROBE_BODY, messageId: null },
          { now: PROBE_NOON }
        );
        verdicts.push({ optedOut, channel, verdict });
      }
    }
    // Same channel: the person opted out of it, so the message must be held.
    const misses = [];
    for (const { optedOut, channel, verdict } of verdicts) {
      if (optedOut !== channel) continue;
      if (!(verdict && verdict.state === "blocked")) {
        misses.push({ file: GATE_FILE, why: `lets ${aMessage(channel)} through to a person who opted out of ${channelWord(channel)}` });
      }
    }
    if (misses.length) return { ran: true, why: "", misses };
    // Other channel: opted out of text only, so an email must still be allowed. If it
    // is held, this probe cannot tell an opt-out hold from any other hold.
    const control = verdicts.find((v) => v.optedOut !== v.channel && !(v.verdict && v.verdict.state === "allowed"));
    if (control) {
      return {
        ran: false,
        why: `gate() held ${aMessage(control.channel)} for someone who opted out of ${channelWord(control.optedOut)} only (${codes(control.verdict).join(", ") || "no reason"})`,
        misses: []
      };
    }
    return { ran: true, why: "", misses: [] };
  } catch (err) {
    return { ran: false, why: `gate() probe stopped: ${clip(err && err.message)}`, misses: [] };
  }
}

function probeMessage(channel) {
  return {
    id: PROBE_MESSAGE,
    org_id: PROBE_ORG,
    client_id: PROBE_CLIENT,
    channel,
    rendered_body: PROBE_BODY,
    template_key: null,
    to_address: null,
    subject: null,
    attempts: 1,
    provider_ref: null,
    attachments: null
  };
}

/** { ran, why, misses } — the real dispatchOne(), on a person who opted out of one channel. */
export async function probeDispatch(mod) {
  if (!mod || typeof mod.dispatchOne !== "function") {
    return { ran: false, why: "dispatchOne() could not be loaded", misses: [] };
  }
  const blockedWord = (mod.OUTCOME && mod.OUTCOME.BLOCKED) || "blocked";
  try {
    const runs = [];
    for (const optedOut of PROBE_CHANNELS) {
      for (const channel of PROBE_CHANNELS) {
        const seen = [];
        const result = await mod.dispatchOne(probeDb(optedOut, seen), probeMessage(channel), {
          now: PROBE_NOON,
          env: {},
          fetchImpl: closedFetch
        });
        runs.push({ optedOut, channel, result, reachedRouting: seen.some((t) => /message_channel_routing/i.test(t)) });
      }
    }
    const misses = [];
    let unclear = null;
    for (const { optedOut, channel, result, reachedRouting } of runs) {
      if (optedOut !== channel) continue;
      if (reachedRouting) {
        misses.push({ file: DISPATCH_FILE, why: `goes past the opt-out gate to the send step with ${aMessage(channel)} for a person who opted out of ${channelWord(channel)}` });
      } else if (!result || result.outcome !== blockedWord) {
        unclear = unclear || `dispatchOne() answered "${clip(result && result.outcome)}" for ${aMessage(channel)} to someone who opted out of ${channelWord(channel)}`;
      }
    }
    if (misses.length) return { ran: true, why: "", misses };
    if (unclear) return { ran: false, why: unclear, misses: [] };
    // Opted out of one channel only: a message on the other channel must get past the
    // gate to the routing step. If it does not, the probe is not trustworthy.
    const control = runs.find((r) => r.optedOut !== r.channel && !r.reachedRouting);
    if (control) {
      return {
        ran: false,
        why: `dispatchOne() stopped ${aMessage(control.channel)} for someone who opted out of ${channelWord(control.optedOut)} only (${clip(control.result && control.result.outcome)})`,
        misses: []
      };
    }
    return { ran: true, why: "", misses: [] };
  } catch (err) {
    return { ran: false, why: `dispatchOne() probe stopped: ${clip(err && err.message)}`, misses: [] };
  }
}

const PROBE_BASE_URL = "https://fundhub.ai";

/**
 * { ran, why, problem } — the real link code, with the signing secret this run has.
 * Sign a link, put it in the footer the way dispatch.mjs does, check it, and check that
 * a link with a changed signature is refused. No database. No network. Nothing is sent.
 */
export function probeUnsubscribeLink(mod, { env, now } = {}) {
  const names = ["signUnsubscribeUrl", "verifyUnsubscribeRequest", "withUnsubscribeFooter"];
  if (!mod || names.some((name) => typeof mod[name] !== "function")) {
    return { ran: false, why: "the unsubscribe link code could not be loaded", problem: null };
  }
  const at = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const clock = () => at;
  try {
    let signed;
    try {
      signed = mod.signUnsubscribeUrl({
        orgId: PROBE_ORG,
        clientId: PROBE_CLIENT,
        channel: "email",
        baseUrl: PROBE_BASE_URL,
        env,
        now: clock
      });
    } catch (err) {
      // Only the shape is said, never the value: a masked copy starts with asterisks.
      const used = env && (env.UNSUBSCRIBE_TOKEN_SECRET || env.DOCUMENT_URL_SECRET);
      const mask = typeof used === "string" && /^\*{4,}/.test(used)
        ? "; the setting in use is a masked placeholder (it starts with asterisks), not a real secret"
        : "";
      return {
        ran: true,
        why: "",
        problem: `a link cannot be signed, so email goes out with no unsubscribe link (${clip(err && err.message)}${mask})`
      };
    }
    const url = signed && typeof signed.url === "string" ? signed.url : "";
    const sig = (url.match(/[?&]sig=([0-9a-f]+)/i) || [])[1] || "";
    if (!url || !sig) {
      return { ran: true, why: "", problem: "the signer answered with no link" };
    }
    const footer = mod.withUnsubscribeFooter(PROBE_BODY, url, env);
    if (typeof footer !== "string" || !footer.includes(sig)) {
      return { ran: true, why: "", problem: "the email footer does not carry the signed link" };
    }
    const back = mod.verifyUnsubscribeRequest(url, { env, now: clock });
    if (!back || back.orgId !== PROBE_ORG || back.clientId !== PROBE_CLIENT || back.channel !== "email") {
      return { ran: true, why: "", problem: "a link that was just signed does not check out" };
    }
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    const forged = mod.verifyUnsubscribeRequest(url.replace(sig, flipped), { env, now: clock });
    if (forged) {
      return { ran: true, why: "", problem: "a link with a changed signature is accepted" };
    }
    return { ran: true, why: "", problem: null };
  } catch (err) {
    return { ran: false, why: `the link probe stopped: ${clip(err && err.message)}`, problem: null };
  }
}

async function loadProbeModules(ctx) {
  const load = async (given, path_) => {
    if (given !== undefined) return given;
    try {
      return await path_();
    } catch {
      return null;
    }
  };
  const gate = await load(ctx.gateModule, () => import("../../messaging/gate.mjs"));
  const dispatch = await load(ctx.dispatchModule, () => import("../../messaging/dispatch.mjs"));
  const unsubscribe = await load(ctx.unsubscribeModule, () => import("../../messaging/unsubscribe.mjs"));
  return { gate, dispatch, unsubscribe };
}

function orgIdOf(ctx) {
  const id = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  return UUID_RE.test(id) ? id : "";
}

function canQuery(db) {
  return !!(db && typeof db.query === "function");
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

async function readRow(db, sql, params) {
  assertSelect(sql);
  try {
    const res = await db.query(sql, params);
    const row = res && res.rows && res.rows[0];
    if (!row) return { ok: false, error: "The read did not return a count." };
    return { ok: true, row };
  } catch (err) {
    return { ok: false, error: clip(err && err.message) || "read failed" };
  }
}

async function readCounts(db, sql, params) {
  const got = await readRow(db, sql, params);
  if (!got.ok) return got;
  const n = count(got.row.n);
  if (n == null) return { ok: false, error: "The read did not return a count." };
  return { ok: true, n, people: count(got.row.people), unlinked: count(got.row.unlinked) || 0, row: got.row };
}

function personWord(n) {
  return n === 1 ? "person" : "people";
}

function stopRow(result, complaint = null) {
  if (!result.ok) {
    return check("opt-out:stop-did-not-stick", "FAIL", `Could not read STOP replies: ${result.error}`, FIX.stop);
  }
  if (complaint && !complaint.ok) {
    return check("opt-out:stop-did-not-stick", "FAIL", `Could not read spam complaints: ${complaint.error}`, FIX.stop);
  }
  const complained = complaint && complaint.ok ? complaint.n : 0;
  if (result.n > 0 || result.unlinked > 0 || complained > 0) {
    const parts = [];
    if (result.n > 0) {
      parts.push(`${result.n} ${personWord(result.n)} sent STOP or unsubscribe in the last ${LOOKBACK_DAYS} days and the opt-out did not stick.`);
    }
    if (result.unlinked > 0) {
      const msgs = result.unlinked === 1 ? "1 STOP reply" : `${result.unlinked} STOP replies`;
      parts.push(`${msgs} in the last ${LOOKBACK_DAYS} days matched no client, so no opt-out was saved.`);
    }
    if (complained > 0) {
      parts.push(`${complained} ${personWord(complained)} marked an email as spam in the last ${LOOKBACK_DAYS} days and ${complained === 1 ? "is" : "are"} not opted out of email.`);
    }
    return check("opt-out:stop-did-not-stick", "FAIL", parts.join(" "), FIX.stop);
  }
  return check(
    "opt-out:stop-did-not-stick",
    "PASS",
    `No STOP, unsubscribe, or spam complaint in the last ${LOOKBACK_DAYS} days is missing its opt-out.`
  );
}

const NO_DB_COUNT = "No database in this run, so messages after an opt-out were not counted.";

function sendRow(codeMisses, count_, notes = [], unproven = [], noCount = NO_DB_COUNT) {
  const codeFail = codeMisses.length > 0;
  const countFail = !!(count_ && count_.ok && ((count_.people != null ? count_.people : count_.n) > 0));
  const countBroken = !!(count_ && count_.ok === false);
  const noteText = notes.length ? ` ${notes.join(" ")}` : "";
  if (!codeFail && !countFail && !countBroken) {
    if (unproven.length) {
      // Nothing showed that this code reads opt-out: it was not run and its text was not read.
      const counted = count_
        ? ` In the last ${LOOKBACK_DAYS} days, nobody who was opted out got a message after that time.`
        : ` ${noCount}`;
      return check(
        "opt-out:send-ignores",
        "skip",
        `The send code was not checked this run (${unproven.join(", ")}).${counted}${noteText}`
      );
    }
    if (!count_) {
      return check(
        "opt-out:send-ignores",
        "skip",
        `Client text and email sends read opt-out. ${noCount}${noteText}`
      );
    }
    return check(
      "opt-out:send-ignores",
      "PASS",
      `Client text and email sends read opt-out. In the last ${LOOKBACK_DAYS} days, nobody who was opted out got a message after that time.${noteText}`
    );
  }
  const parts = [];
  for (const miss of codeMisses) parts.push(`${miss.file} ${miss.why}.`);
  if (countBroken) parts.push(`Could not count messages after an opt-out: ${count_.error}`);
  if (countFail) {
    const people = count_.people != null ? count_.people : count_.n;
    const who = `${people} ${personWord(people)} who opted out still got a message after the opt-out time`;
    const extra = count_.n > people ? ` (${count_.n} messages)` : "";
    parts.push(`${who}${extra}.`);
  }
  return check("opt-out:send-ignores", "FAIL", parts.join(" "), FIX.send);
}

function linkRow(probe) {
  const id = "opt-out:unsubscribe-link";
  if (!probe.ran) {
    return check(id, "skip", `The email unsubscribe link was not tried this run: ${probe.why}.`);
  }
  if (probe.problem) {
    return check(id, "FAIL", `Email unsubscribe links are broken: ${probe.problem}.`, FIX.link);
  }
  return check(
    id,
    "PASS",
    "An email unsubscribe link can be signed, put in the email footer, and checked. A link with a changed signature is refused."
  );
}

function tableRow(result) {
  if (!result.ok) {
    return check("opt-out:table-unreadable", "FAIL", `The opt-out table could not be read: ${result.error}`, FIX.table);
  }
  const row = result.row || {};
  const broken = [];
  if (row.can_add !== true) broken.push("the app cannot add opt-out rows");
  if (row.can_change !== true) broken.push("the app cannot change opt-out rows");
  if (row.has_key !== true) broken.push("the unique key on client and channel is gone, so a STOP cannot be saved");
  if (broken.length) {
    return check("opt-out:table-unreadable", "FAIL", `The opt-out table can be read, but ${broken.join(" and ")}.`, FIX.table);
  }
  return check("opt-out:table-unreadable", "PASS", "The opt-out table can be read, and a STOP can be saved to it.");
}

/**
 * gapChecks — SMS and email opt-out only.
 * ctx: { db, orgId, now, env, demoOn, root, sources, gateModule, dispatchModule,
 * unsubscribeModule }.
 * sources replaces the send-path file read, gateModule, dispatchModule and
 * unsubscribeModule replace the real code (tests). env is the signing secret holder for
 * the link row (the function's own settings when the pulse does not pass one).
 * SELECT only. Never sends. Never writes an opt-out row.
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  try {
    const mods = await loadProbeModules(ctx);
    const gateProbe = await probeGate(mods.gate);
    const dispatchProbe = await probeDispatch(mods.dispatch);
    const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;
    const linkProbe = probeUnsubscribeLink(mods.unsubscribe, {
      env,
      now: ctx.now instanceof Date ? ctx.now : new Date()
    });
    const link = linkRow(linkProbe);

    let sources = ctx.sources || null;
    if (!sources) {
      const root = findSourceRoot(sourceRoots({ root: ctx.root }));
      sources = root ? loadSendSources(root) : null;
    }
    const notes = [];
    if (!sources) notes.push("The scan for other senders was skipped: no source files in this run.");
    for (const probe of [gateProbe, dispatchProbe]) {
      if (!probe.ran) notes.push(`A send path was not run: ${probe.why}.`);
    }
    const codeMisses = [
      ...gateProbe.misses,
      ...dispatchProbe.misses,
      ...(sources ? ignoredSendPaths(sources, { skipGate: gateProbe.ran, skipDispatch: dispatchProbe.ran }) : [])
    ];
    // A file counts as shown only if it was run for real or its text was read.
    const unproven = [];
    if (!gateProbe.ran && !(sources && typeof sources[GATE_FILE] === "string")) unproven.push(GATE_FILE);
    if (!dispatchProbe.ran && !(sources && typeof sources[DISPATCH_FILE] === "string")) unproven.push(DISPATCH_FILE);

    const db = ctx.db;
    const orgId = orgIdOf(ctx);
    if (!canQuery(db) || !orgId) {
      const why = !canQuery(db) ? "No database in this run." : "No company in this run.";
      return [
        check("opt-out:table-unreadable", "skip", `${why} The opt-out table was not read.`),
        check("opt-out:stop-did-not-stick", "skip", `${why} STOP replies were not read.`),
        sendRow(codeMisses, null, notes, unproven, `${why.replace(/\.$/, "")}, so messages after an opt-out were not counted.`),
        link
      ];
    }
    const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const demoOn = ctx.demoOn === true;
    const table = await readCounts(db, TABLE_SQL, [orgId, ...TABLE_PRIVILEGES]);
    if (!table.ok) {
      return [
        tableRow(table),
        check(
          "opt-out:stop-did-not-stick",
          "skip",
          "The opt-out table could not be read, so STOP replies were not checked."
        ),
        sendRow(codeMisses, null, notes, unproven, "The opt-out table could not be read, so messages after an opt-out were not counted."),
        link
      ];
    }
    const [stop, sent, complaint] = await Promise.all([
      readCounts(db, STOP_SQL, [orgId, since, demoOn]),
      readCounts(db, SENT_AFTER_SQL, [orgId, since, demoOn]),
      readCounts(db, COMPLAINT_SQL, [orgId, since, demoOn])
    ]);
    return [
      tableRow(table),
      stopRow(stop, complaint),
      sendRow(codeMisses, sent, notes, unproven),
      link
    ];
  } catch (err) {
    const detail = `Opt-out check stopped: ${clip(err && err.message)}`;
    return [
      check("opt-out:table-unreadable", "FAIL", detail, FIX.table),
      check("opt-out:stop-did-not-stick", "FAIL", detail, FIX.stop),
      check("opt-out:send-ignores", "FAIL", detail, FIX.send),
      check("opt-out:unsubscribe-link", "FAIL", detail, FIX.link)
    ];
  }
}
