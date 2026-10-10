// Messages truth — did the customer get the right message? Read only. Report only.
//
// W4 of the 2026-10-10 coverage batch (ops/workflows/coverage-every-surface-2026-10-10.md).
// The older lanes ask "did a message leave" (gap-sms.mjs: queue, receipts, blocks; gap-email.mjs: sending
// stuck, provider fails, magic links; gap-opt-out.mjs: STOP). This lane asks what the customer actually
// READ and whether the whole path worked, template by template. Nine yes-or-no questions:
//
//   msg:sent-body-blanks         Did any message that left (or is about to) carry an empty merge spot?
//   msg:staff-template-to-client Did a message written for staff go to someone who is not staff?
//   msg:links-in-body            Does every link in a sent message point at us, and does it open?
//   msg:per-template-path        Does each template reach an inbox, and does each event make its email?
//   msg:brakes                   Did a send go out past the pause switch, the daily cap, or twice?
//   msg:dead-senders             Did anything queue a template that nothing is supposed to send?
//   msg:owner-alerts-unsent      Is an owner alert text still queued with nobody to send it?
//   msg:hiring-outreach-blocked  Is candidate outreach stuck at the gate?
//   msg:help-reply               Did a person who texted HELP get an answer?
//
// RULES (heartbeat law, .claude/rules/heartbeat-on-every-build.md):
//   * SELECT only. Web calls are HEAD (and GET only for a page that refuses HEAD), never anything else.
//   * No text, no email, no AI call. This file imports no provider and holds no send.
//   * A failed read is a skip with the reason. A skip is never a PASS.
//   * A claim of "nothing to judge" carries a code the audit re-reads every morning (naVerify below).
//   * No repo file is read at run time. The dead-template list is data in msg-dead-templates.mjs.
//   * Test traffic is not a customer: demo flag, synthetic client, test address (same filter as gap-sms.mjs).
//   * Under 20 seconds. The reads run side by side; the link opens are capped in number and in time.
//
// Not duplicated here (already read by the gap-sms, gap-email and gap-opt-out lanes, and by pipeline:outbound):
// queued past 30 minutes, stuck on sending, sent with no delivery receipt, failed at the provider, blocked by our
// own gate, a customer reply that got lost, approved copy with lorem or [DRAFT], a STOP that did not stick, and the
// seven text journeys.

import { TEST_ADDRESS_RE } from "./gap-sms.mjs";
import { DEAD_TEMPLATE_KEYS } from "./msg-dead-templates.mjs";

export const CHECK_IDS = Object.freeze([
  "msg:sent-body-blanks",
  "msg:staff-template-to-client",
  "msg:links-in-body",
  "msg:per-template-path",
  "msg:brakes",
  "msg:dead-senders",
  "msg:owner-alerts-unsent",
  "msg:hiring-outreach-blocked",
  "msg:help-reply"
]);

// ── windows and caps ─────────────────────────────────────────────────────────

export const BLANKS_LOOKBACK_HOURS = 24;
export const STAFF_LOOKBACK_DAYS = 7;
export const LINKS_LOOKBACK_HOURS = 24;
export const PATH_LOOKBACK_DAYS = 7;
/** A message younger than this may still be waiting on its receipt. It is not judged. */
export const PATH_GRACE_HOURS = 24;
/** One bounce to one bad address is not a dead path. A template needs this many aged rows to be judged. */
export const PATH_MIN_ROWS = 2;
export const EVENT_GRACE_MINUTES = 15;
export const BRAKE_LOOKBACK_DAYS = 3;
export const DUPLICATE_WINDOW_HOURS = 24;
export const DEAD_LOOKBACK_DAYS = 7;
export const OWNER_ALERT_GRACE_HOURS = 1;
export const HELP_LOOKBACK_DAYS = 7;
export const HELP_GRACE_MINUTES = 30;
export const HELP_ANSWER_HOURS = 24;

/** The hosts a customer message may link to. A host is allowed when it is one of these or ends in ".<one>". */
export const ALLOWED_LINK_HOSTS = Object.freeze(["fundhub.ai", "fanbasis.com", "meet.google.com"]);
/** Only hosts we own are opened. A third party's page is not ours to poke, and may refuse a robot. */
export const OWNED_LINK_HOSTS = Object.freeze(["fundhub.ai"]);
export const LINK_CAP = 30;
export const LINK_CONCURRENCY = 6;
export const LINK_TIMEOUT_MS = 5000;
export const LINK_BUDGET_MS = 10000;
export const LINK_ROW_CAP = 300;

/** The statuses that mean a message left, or is about to. The same three the daily cap counts (outbox.mjs). */
const LEFT = Object.freeze(["sent", "delivered", "complained"]);
const GOING = Object.freeze(["queued", "sending"]);
const LEFT_OR_GOING = Object.freeze([...GOING, ...LEFT]);

const TAIL = "Do not send from this check. Do not change the outbound switch. Do not edit a template from here.";

// ── patterns (Postgres regex, written once, inlined as code constants) ───────

/** A dollar sign with no number after it: "Total funding secured: $". "$ 3,000" and "$.50" are fine. */
export const RE_DOLLAR = String.raw`\$(?!\s*\.?[0-9])`;
/** Two spaces between words, where a value was blanked. Not after a full stop, not inside an HTML page. */
export const RE_SPACES = String.raw`[^[:space:].!?]  +[^[:space:]]`;
export const RE_BRACES = String.raw`\{\{|\}\}`;
export const RE_WORDS = String.raw`placeholder|lorem[[:space:]]+ipsum|\[DRAFT`;
/** "Hi ," or "Hello !": a greeting whose name is blank. */
export const RE_GREETING = String.raw`(^|[^a-z])(hi|hey|hello|dear)[[:space:]]+[,!.]`;
export const RE_HTML_TAG = String.raw`<[a-zA-Z/][^>]*>`;
/** Words that only staff copy uses (seed 015: "Internal alert", "Employee Next Action", "mechanical control alert"). */
export const RE_STAFF_COPY = String.raw`internal alert|internal use only|internal only|employee next action|mechanical control alert|\[internal\]`;

/** Templates written for staff, not for a customer. Every one must go to a staff address. */
export const STAFF_TEMPLATE_KEYS = Object.freeze([
  "DPC-05",
  "EMAIL-DPC05-NO-PROGRESS-72H",
  "EMAIL-COMMISSION-PAID",
  "SMS-DEAL-CLOSE-WIN",
  "SMS-S04C-STAFF-BOOKED"
]);

// ── small helpers ────────────────────────────────────────────────────────────

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function naRow(id, code, args, detail) {
  return { id, status: "na", detail, suggestedFix: null, na: { code, args } };
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function clip(value, max = 120) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A count the database really sent: a whole number, or null. A missing answer is never zero. */
function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 0 ? 0 : Math.floor(n);
}

function canQuery(db) {
  return !!(db && typeof db.query === "function");
}

function nowOf(ctx) {
  return ctx && ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();
}

function agoIso(now, ms) {
  return new Date(now.getTime() - ms).toISOString();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

/** SELECT only. One failed read is one error value, never a throw and never zero. */
async function readRows(db, sql, params) {
  try {
    const got = await db.query(sql, params);
    return { rows: got && Array.isArray(got.rows) ? got.rows : null };
  } catch (err) {
    return { error: clip((err && err.message) || err, 160) };
  }
}

/** `a x2, b x1`, biggest first, at most `max` shown. */
function tally(items, max = 5) {
  const by = new Map();
  for (const [key, n] of items) {
    if (!n) continue;
    by.set(key, (by.get(key) || 0) + n);
  }
  const list = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = list.slice(0, max).map(([k, n]) => `${k} x${n}`);
  if (list.length > max) shown.push(`${list.length - max} more`);
  return shown.join(", ");
}

/* Test traffic is not a customer. A message flagged demo, a message whose client is demo or synthetic or
   has a test address, and a message sent to a test address are all left out. `p` is the number of the query
   parameter that holds TEST_ADDRESS_RE. Same rule as gap-sms.mjs (realMessageSql). */
function real(alias, p) {
  return `COALESCE(${alias}.is_demo, false) = false
   AND NOT EXISTS (
     SELECT 1 FROM clients d
      WHERE d.id = ${alias}.client_id
        AND (COALESCE(d.is_demo, false) = true
          OR COALESCE(d.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(d.email, '') ~* ${p}::text)
   )
   AND COALESCE(${alias}.to_address, '') !~* ${p}::text`;
}

function list(values) {
  return values.map((v) => {
    if (!/^[a-z]+$/.test(v)) throw new Error("bad status word");
    return `'${v}'`;
  }).join(", ");
}

const LEFT_SQL = list(LEFT);
const LEFT_OR_GOING_SQL = list(LEFT_OR_GOING);
const GOING_SQL = list(GOING);

// ── 1. msg:sent-body-blanks ──────────────────────────────────────────────────

const BLANKS_FLAGS = `
      txt ~ '${RE_DOLLAR}' AS dollar,
      (txt !~ '${RE_HTML_TAG}' AND txt ~ '${RE_SPACES}') AS spaces,
      txt ~ '${RE_BRACES}' AS braces,
      txt ~* '${RE_WORDS}' AS words,
      txt ~* '${RE_GREETING}' AS greeting`;

/** $1 org, $2 since, $3 TEST_ADDRESS_RE. Rows come back per template: only the ones with a blank. */
export const BLANKS_SQL = `
SELECT f.template_key, f.channel,
       count(*)::int AS n,
       count(*) FILTER (WHERE f.dollar)::int AS dollar_n,
       count(*) FILTER (WHERE f.spaces)::int AS spaces_n,
       count(*) FILTER (WHERE f.braces)::int AS braces_n,
       count(*) FILTER (WHERE f.words)::int AS words_n,
       count(*) FILTER (WHERE f.greeting)::int AS greeting_n
  FROM (
    SELECT b.template_key, b.channel, ${BLANKS_FLAGS}
      FROM (
        SELECT m.template_key, m.channel, concat_ws(E'\\n', m.subject, m.rendered_body) AS txt
          FROM messages m
         WHERE m.org_id = $1::uuid
           AND m.direction = 'outbound'
           AND m.channel IN ('sms', 'email')
           AND m.template_key IS NOT NULL
           AND m.status IN (${LEFT_OR_GOING_SQL})
           AND m.created_at >= $2::timestamptz
           AND ${real("m", "$3")}
      ) b
  ) f
 WHERE f.dollar OR f.spaces OR f.braces OR f.words OR f.greeting
 GROUP BY f.template_key, f.channel
 ORDER BY n DESC, f.template_key
 LIMIT 50`.trim();

/** How many messages the blanks read looked at, so "none found" says out of how many. */
export const BLANKS_TOTAL_SQL = `
SELECT count(*)::int AS n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.template_key IS NOT NULL
   AND m.status IN (${LEFT_OR_GOING_SQL})
   AND m.created_at >= $2::timestamptz
   AND ${real("m", "$3")}`.trim();

const BLANK_KINDS = Object.freeze([
  ["dollar_n", "a dollar sign with no number"],
  ["spaces_n", "two spaces where a value belongs"],
  ["braces_n", "a leftover {{ }}"],
  ["words_n", "placeholder or draft words"],
  ["greeting_n", "a greeting with no name"]
]);

const BLANKS_FIX =
  "Read the saved body of that message and the template it came from. A blank spot means a merge tag had no value " +
  "for that person, or the template names a tag nothing supplies. Fix the data or the template (a person does that, " +
  `not this check). The sender does not stop a blank spot. ${TAIL}`;

function judgeBlanks(flagged, total, hours) {
  const id = "msg:sent-body-blanks";
  let messages = 0;
  const pieces = [];
  for (const r of flagged) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The blank-spot count came back unreadable.");
    if (n === 0) continue;
    messages += n;
    const kinds = BLANK_KINDS.filter(([col]) => num(r[col]) > 0).map(([, label]) => label);
    pieces.push([`${clip(r.template_key, 60)} (${kinds.join(", ") || "blank spot"})`, n]);
  }
  if (messages > 0) {
    return row(
      id,
      "FAIL",
      `${messages} ${plural(messages, "message", "messages")} in the last ${hours} hours ${plural(messages, "has", "have")} an empty spot where a value belongs: ${tally(pieces, 5)}.`,
      BLANKS_FIX
    );
  }
  const seen = num(total && total.n);
  if (seen === null) return row(id, "skip", "The count of messages read came back unreadable.");
  return row(
    id,
    "PASS",
    `${seen} ${plural(seen, "message", "messages")} that left or were queued in the last ${hours} hours, none with a dollar sign with no number, a leftover {{ }}, a blank greeting, placeholder words, or a blank gap in plain text.`
  );
}

async function checkBlanks(db, orgId, now) {
  const since = agoIso(now, BLANKS_LOOKBACK_HOURS * HOUR);
  const [flagged, total] = await Promise.all([
    readRows(db, BLANKS_SQL, [orgId, since, TEST_ADDRESS_RE]),
    readRows(db, BLANKS_TOTAL_SQL, [orgId, since, TEST_ADDRESS_RE])
  ]);
  const bad = flagged.error || total.error;
  if (bad || !flagged.rows || !total.rows) {
    return row("msg:sent-body-blanks", "skip", `Message bodies not read: ${bad || "no rows came back"}.`);
  }
  return judgeBlanks(flagged.rows, total.rows[0], BLANKS_LOOKBACK_HOURS);
}

// ── 2. msg:staff-template-to-client ──────────────────────────────────────────

/** $1 org, $2 since, $3 staff template keys, $4 staff copy markers, $5 TEST_ADDRESS_RE, $6 company alert email. */
export const STAFF_TO_CLIENT_SQL = `
SELECT m.template_key, m.channel,
       count(*)::int AS n,
       count(*) FILTER (WHERE m.client_id IS NOT NULL)::int AS client_n
  FROM messages m
  LEFT JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.status IN (${LEFT_OR_GOING_SQL})
   AND m.created_at >= $2::timestamptz
   AND (
        m.template_key = ANY($3::text[])
     OR concat_ws(E'\\n', m.subject, m.rendered_body) ~* $4::text
   )
   AND ${real("m", "$5")}
   AND NOT EXISTS (
     SELECT 1 FROM staff s
      WHERE s.org_id = m.org_id
        AND (
          (m.channel = 'email'
            AND btrim(COALESCE(s.email, '')) <> ''
            AND lower(btrim(s.email)) = lower(btrim(COALESCE(NULLIF(m.to_address, ''), c.email, ''))))
          OR
          (m.channel = 'sms'
            AND length(regexp_replace(COALESCE(s.phone, ''), '[^0-9]', '', 'g')) >= 10
            AND right(regexp_replace(s.phone, '[^0-9]', '', 'g'), 10)
              = right(regexp_replace(COALESCE(NULLIF(m.to_address, ''), c.phone, ''), '[^0-9]', '', 'g'), 10))
        )
   )
   AND (
        btrim(COALESCE($6::text, '')) = ''
     OR lower(btrim(COALESCE(NULLIF(m.to_address, ''), c.email, ''))) <> lower(btrim($6::text))
   )
 GROUP BY m.template_key, m.channel
 ORDER BY n DESC, m.template_key
 LIMIT 50`.trim();

export const SETTINGS_SQL =
  "SELECT outbound_enabled, daily_send_cap, alert_email, updated_at FROM messaging_settings WHERE org_id = $1::uuid LIMIT 1";

const STAFF_FIX =
  "That template is staff copy, and it was queued to an address that is not on the staff list. Find the send that " +
  "addresses it (for the 72-hour no-progress alert it is src/workflows/dpc-05-no-progress-escalation.mjs, which " +
  "sends through sendTemplated to the client). Point it at the staff person, or stop it. A person fixes that, " +
  `not this check. ${TAIL}`;

function judgeStaff(rows, days) {
  const id = "msg:staff-template-to-client";
  let total = 0;
  const pieces = [];
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The staff-template count came back unreadable.");
    if (n === 0) continue;
    total += n;
    pieces.push([`${clip(r.template_key, 60)} (${r.channel === "sms" ? "text" : "email"})`, n]);
  }
  if (total === 0) {
    return row(
      id,
      "PASS",
      `No staff-written template went to an address that is not staff in the last ${days} days (${STAFF_TEMPLATE_KEYS.length} named templates, plus any copy that says "internal alert").`
    );
  }
  return row(
    id,
    "FAIL",
    `${total} ${plural(total, "message", "messages")} written for staff ${plural(total, "was", "were")} queued to someone who is not staff in the last ${days} days: ${tally(pieces, 5)}.`,
    STAFF_FIX
  );
}

async function checkStaffToClient(db, orgId, now, settings) {
  const got = await readRows(db, STAFF_TO_CLIENT_SQL, [
    orgId,
    agoIso(now, STAFF_LOOKBACK_DAYS * DAY),
    [...STAFF_TEMPLATE_KEYS],
    RE_STAFF_COPY,
    TEST_ADDRESS_RE,
    settings && settings.alert_email ? String(settings.alert_email) : ""
  ]);
  if (got.error || !got.rows) {
    return row("msg:staff-template-to-client", "skip", `Staff templates not read: ${got.error || "no rows came back"}.`);
  }
  return judgeStaff(got.rows, STAFF_LOOKBACK_DAYS);
}

// ── 3. msg:links-in-body ─────────────────────────────────────────────────────

/** $1 org, $2 since, $3 TEST_ADDRESS_RE. Only bodies that carry a link or an href. */
export const LINK_BODIES_SQL = `
SELECT m.template_key, m.channel, m.rendered_body
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.template_key IS NOT NULL
   AND m.status IN (${LEFT_OR_GOING_SQL})
   AND m.created_at >= $2::timestamptz
   AND m.rendered_body ~* 'https?://|href|src=|www\\.'
   AND ${real("m", "$3")}
 ORDER BY m.created_at DESC
 LIMIT ${LINK_ROW_CAP}`.trim();

const HREF_RE = /\bhref\s*=\s*(["'])([\s\S]*?)\1/gi;
const URL_RE = /https?:\/\/[^\s"'<>)\]]*/gi;

function trimUrl(raw) {
  return String(raw).replace(/[.,;:!?]+$/, "");
}

/**
 * Pull the links out of one message body. Pure.
 * blank   how many links have no address at all (href="", href="#", href="{{x}}", a bare "https://", a relative path).
 * urls    the distinct absolute http(s) links.
 */
export function extractLinks(body) {
  const text = String(body == null ? "" : body);
  let blank = 0;
  const urls = new Set();
  for (const m of text.matchAll(HREF_RE)) {
    const v = String(m[2]).trim();
    if (/^(mailto:|tel:|sms:)/i.test(v)) continue;
    if (v === "" || v === "#" || /\{\{|\}\}/.test(v) || /^(undefined|null|javascript:)/i.test(v)) {
      blank += 1;
    } else if (v.startsWith("/") || /^[a-z0-9_-]+\.html?(\?|#|$)/i.test(v)) {
      blank += 1;
    } else if (/^https?:\/\//i.test(v)) {
      urls.add(trimUrl(v));
    }
  }
  for (const m of text.matchAll(URL_RE)) {
    const u = trimUrl(m[0]);
    if (/^https?:\/\/$/i.test(u)) blank += 1;
    else urls.add(u);
  }
  return { blank, urls: [...urls] };
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), path: u.pathname || "/" };
  } catch {
    return null;
  }
}

function hostMatches(host, domains) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The page behind a link, with the person's token and any query or fragment taken off. Null when it is not ours to open. */
export function openableUrl(url) {
  const parsed = hostOf(url);
  if (!parsed || !hostMatches(parsed.host, OWNED_LINK_HOSTS)) return null;
  // An API door may act on the person's own token. Never poke one.
  if (/^\/api(\/|$)/i.test(parsed.path)) return null;
  return `https://${parsed.host}${parsed.path}`;
}

const LINKS_FIX =
  "Read the saved body of the message named. A blank link means a merge tag had no value. A host we do not list means " +
  "the base address came from a wrong setting (a preview site, or a typo). A dead page means the link points at a page " +
  "that does not exist. To allow a new host, add it to ALLOWED_LINK_HOSTS in src/pulse/coverage/gap-msg.mjs. " +
  `A person fixes the link, not this check. ${TAIL}`;

function fetchOf(ctx) {
  if (ctx && typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (ctx && typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

/** HEAD first. A page that refuses HEAD (405 or 501) is read once with GET. Returns { status } or { error }. */
async function openOne(fetchImpl, url) {
  const attempt = async (method) => {
    const res = await fetchImpl(url, {
      method,
      redirect: "follow",
      headers: { accept: "text/html,*/*" },
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS)
    });
    return Number(res && res.status);
  };
  try {
    let status = await attempt("HEAD");
    if (status === 405 || status === 501) status = await attempt("GET");
    return { status };
  } catch {
    // One more try when the request itself failed (a dropped connection). A status code is never retried.
    try {
      let status = await attempt("HEAD");
      if (status === 405 || status === 501) status = await attempt("GET");
      return { status };
    } catch (err) {
      return { error: clip((err && err.message) || err, 80) };
    }
  }
}

function isDead(status) {
  return status === 404 || status === 410 || status >= 500;
}

async function openAll(fetchImpl, urls, deadline) {
  const out = new Map();
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++];
      if (Date.now() > deadline) {
        out.set(url, { skipped: true });
        continue;
      }
      out.set(url, await openOne(fetchImpl, url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(LINK_CONCURRENCY, Math.max(urls.length, 1)) }, worker));
  return out;
}

/**
 * Judge the link rows. Pure apart from `fetchImpl`. Returns a check row.
 * Definite breaks (a blank link, a host we do not list, a page that answers 404, 410 or 5xx) are FAIL.
 * A link we could not open at all is a skip, never a PASS.
 */
export async function judgeLinks(rows, { fetchImpl = null, now = Date.now() } = {}) {
  const id = "msg:links-in-body";
  const blankBy = [];
  const hostBy = [];
  const urlTemplates = new Map();
  let messages = 0;
  for (const r of rows) {
    messages += 1;
    const key = clip(r.template_key, 60) || "(no template)";
    const { blank, urls } = extractLinks(r.rendered_body);
    if (blank > 0) blankBy.push([key, blank]);
    for (const url of urls) {
      const parsed = hostOf(url);
      if (!parsed || !parsed.host) {
        blankBy.push([key, 1]);
        continue;
      }
      if (!hostMatches(parsed.host, ALLOWED_LINK_HOSTS)) {
        hostBy.push([`${parsed.host} in ${key}`, 1]);
        continue;
      }
      const open = openableUrl(url);
      if (open) {
        const set = urlTemplates.get(open) || new Set();
        set.add(key);
        urlTemplates.set(open, set);
      }
    }
  }

  const problems = [];
  const blankTotal = blankBy.reduce((s, [, n]) => s + n, 0);
  const hostTotal = hostBy.length;
  if (blankTotal > 0) {
    problems.push(`${blankTotal} ${plural(blankTotal, "link has", "links have")} no address (${tally(blankBy, 4)})`);
  }
  if (hostTotal > 0) {
    problems.push(`${hostTotal} ${plural(hostTotal, "link goes", "links go")} to a host we do not list (${tally(hostBy, 4)})`);
  }

  // The pages. Most-used first, capped in number and in time.
  const ranked = [...urlTemplates.entries()]
    .sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))
    .map(([u]) => u);
  const toOpen = ranked.slice(0, LINK_CAP);
  let opened = new Map();
  if (toOpen.length && fetchImpl) {
    opened = await openAll(fetchImpl, toOpen, now + LINK_BUDGET_MS);
  }
  const dead = [];
  let answered = 0;
  let failedToOpen = 0;
  let notOpened = ranked.length - toOpen.length;
  for (const [url, res] of opened) {
    if (res.skipped) {
      notOpened += 1;
    } else if (res.error) {
      failedToOpen += 1;
    } else if (isDead(res.status)) {
      const where = [...(urlTemplates.get(url) || [])].slice(0, 2).join(", ");
      dead.push(`${url} answered ${res.status}${where ? ` (in ${where})` : ""}`);
    } else {
      answered += 1;
    }
  }
  if (dead.length > 0) {
    problems.push(`${dead.length} ${plural(dead.length, "page is", "pages are")} dead: ${dead.slice(0, 3).join("; ")}${dead.length > 3 ? `; ${dead.length - 3} more` : ""}`);
  }
  if (problems.length > 0) {
    return row(id, "FAIL", `Links in the last ${LINKS_LOOKBACK_HOURS} hours of messages: ${problems.join(". ")}.`, LINKS_FIX);
  }
  if (messages === 0) {
    return row(id, "PASS", `No message with a link left or was queued in the last ${LINKS_LOOKBACK_HOURS} hours, so no link was wrong.`);
  }
  if (toOpen.length > 0 && !fetchImpl) {
    return row(id, "skip", `${ranked.length} ${plural(ranked.length, "page", "pages")} of ours are linked and none could be opened, because this run has no web call. No link is blank and every host is on the list.`);
  }
  if (failedToOpen > 0) {
    return row(id, "skip", `${failedToOpen} of ${toOpen.length} ${plural(toOpen.length, "page", "pages")} did not answer at all, so they could not be judged. ${answered} opened fine. No link is blank and every host is on the list.`);
  }
  const capNote = notOpened > 0 ? ` ${notOpened} more distinct ${plural(notOpened, "page was", "pages were")} left for another day (cap ${LINK_CAP}).` : "";
  return row(
    id,
    "PASS",
    `${messages} ${plural(messages, "message", "messages")} with links in the last ${LINKS_LOOKBACK_HOURS} hours: no blank link, every host is listed, ${answered} of our ${plural(answered, "page", "pages")} opened fine.${capNote}`
  );
}

async function checkLinks(db, orgId, now, fetchImpl) {
  const got = await readRows(db, LINK_BODIES_SQL, [orgId, agoIso(now, LINKS_LOOKBACK_HOURS * HOUR), TEST_ADDRESS_RE]);
  if (got.error || !got.rows) {
    return row("msg:links-in-body", "skip", `Message links not read: ${got.error || "no rows came back"}.`);
  }
  return judgeLinks(got.rows, { fetchImpl, now: Date.now() });
}

// ── 4. msg:per-template-path ─────────────────────────────────────────────────

/** $1 org, $2 since, $3 aged-before, $4 TEST_ADDRESS_RE. One row per template, with each stage counted. */
export const TEMPLATE_PATH_SQL = `
SELECT m.template_key, m.channel,
       count(*) FILTER (WHERE m.created_at < $3::timestamptz)::int AS aged_n,
       count(*) FILTER (WHERE m.status IN ('delivered', 'complained'))::int AS delivered_n,
       count(*) FILTER (WHERE m.status IN (${GOING_SQL}))::int AS waiting_n,
       count(*) FILTER (WHERE m.status = 'sent')::int AS sent_n,
       count(*) FILTER (WHERE m.status IN ('failed', 'bounced'))::int AS failed_n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.template_key IS NOT NULL
   AND m.status IN (${list([...LEFT_OR_GOING, "failed", "bounced"])})
   AND m.created_at >= $2::timestamptz
   AND ${real("m", "$4")}
 GROUP BY m.template_key, m.channel
 ORDER BY m.template_key
 LIMIT 400`.trim();

/**
 * Event steps that make one email every time, with nothing but the common stops in between. Each is the email twin
 * of a text step the gap-sms lane already reads (its journey-zero row). The text steps are not read again here.
 * oncePerClient: a one-shot lock (the welcome). needsRound / needsAmount: the step's own early return.
 */
export const EMAIL_EVENT_STEPS = Object.freeze([
  step("entry.captured", "EMAIL-S00-WELCOME", { oncePerClient: true }),
  step("booking.created", "EMAIL-S04-01-CONFIRM"),
  step("booking.rescheduled", "EMAIL-S04-01-CONFIRM"),
  step("round.submitted", "EMAIL-F03-ROUND-SUBMITTED", { needsRound: true }),
  step("round.approved", "EMAIL-F04-ROUND-APPROVALS", { needsAmount: true })
]);

function step(eventName, templateKey, flags = {}) {
  return Object.freeze({
    eventName,
    templateKey,
    oncePerClient: flags.oncePerClient === true,
    needsAmount: flags.needsAmount === true,
    needsRound: flags.needsRound === true
  });
}

function assertToken(value, re, label) {
  if (typeof value !== "string" || !re.test(value)) throw new Error(`bad email step ${label}`);
}

/**
 * $1 org, $2 events older than this, $3 events newer than this.
 * Built the way gap-sms.mjs builds its journey read, for the email channel. The message is matched by the start
 * of its reference, workflow:<template>:<event id>, because a send may add a suffix (":confirm-email").
 * An email is queued even for a person who unsubscribed (sendTemplated checks opt-out for texts only), so
 * there is no email opt-out filter here.
 */
export function buildEmailStepsSql(steps = EMAIL_EVENT_STEPS) {
  const values = steps.map((s) => {
    assertToken(s.eventName, /^[a-z0-9.]+$/, "event");
    assertToken(s.templateKey, /^EMAIL-[A-Z0-9-]+$/, "template");
    return `('${s.eventName}'::text, '${s.templateKey}'::text, ${s.oncePerClient ? "true" : "false"}, ${s.needsAmount ? "true" : "false"}, ${s.needsRound ? "true" : "false"})`;
  });
  return `
SELECT count(*)::int AS n,
       COALESCE(array_agg(DISTINCT s.template_key), ARRAY[]::text[]) AS names
  FROM events e
  JOIN (
    VALUES
      ${values.join(",\n      ")}
  ) AS s(event_name, template_key, once_per_client, needs_amount, needs_round)
    ON s.event_name = e.name
  JOIN message_templates t
    ON t.org_id = e.org_id
   AND t.template_key = s.template_key
   AND t.channel = 'email'
   AND t.compliance_passed = true
   AND COALESCE(t.body, '') !~* '\\[DRAFT'
   AND COALESCE(t.subject, '') !~* '\\[DRAFT'
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      e.client_id,
      (SELECT c.id FROM clients c
        WHERE c.org_id = e.org_id
          AND lower(c.email) = lower(btrim(COALESCE(e.payload->>'email', '')))
        LIMIT 1)
    ) AS id
  ) rc
 WHERE e.org_id = $1::uuid
   AND COALESCE(e.is_demo, false) = false
   AND (rc.id IS NOT NULL OR btrim(COALESCE(e.payload->>'email', '')) <> '')
   AND NOT EXISTS (
     SELECT 1 FROM clients d WHERE d.id = rc.id AND COALESCE(d.is_demo, false) = true
   )
   AND e.created_at < $2::timestamptz
   AND e.created_at >= $3::timestamptz
   AND NOT EXISTS (
     SELECT 1 FROM messages m
      WHERE m.org_id = e.org_id
        AND m.channel = 'email'
        AND m.direction = 'outbound'
        AND m.provider_ref LIKE 'workflow:' || s.template_key || ':' || e.id::text || '%'
   )
   AND (
     s.once_per_client = false
     OR NOT EXISTS (
       SELECT 1 FROM messages p
        WHERE p.org_id = e.org_id
          AND p.client_id = rc.id
          AND p.channel = 'email'
          AND p.direction = 'outbound'
          AND p.template_key = s.template_key
     )
   )
   AND (
     s.needs_amount = false
     OR (
       e.payload ? 'approvedAmount'
       AND COALESCE(e.payload->>'approvedAmount', '') ~ '^[0-9]+(\\.[0-9]+)?$'
       AND (e.payload->>'approvedAmount')::numeric > 0
     )
   )
   AND (
     s.needs_round = false
     OR COALESCE(e.payload->>'roundNumber', e.payload->>'round_number') IS NOT NULL
   )`.trim();
}

const PATH_FIX =
  "Read the message rows for the template named. If none was delivered, check the provider for that channel, the " +
  "delivery receipt door (email events, text status callback), and the address on the rows. If an event made no email, " +
  "read that event and the workflow that handles it. A person fixes it, not this check. " + TAIL;

function judgePath(pathRows, pathError, stepsRow, stepsError) {
  const id = "msg:per-template-path";
  const parts = [];
  let skipped = null;
  if (!pathRows) {
    skipped = `the per-template read failed: ${pathError || "no rows came back"}`;
  } else {
    let templates = 0;
    const dead = [];
    const byChannel = new Map();
    for (const r of pathRows) {
      const aged = num(r && r.aged_n);
      const delivered = num(r && r.delivered_n);
      const sent = num(r && r.sent_n);
      const waiting = num(r && r.waiting_n);
      const failed = num(r && r.failed_n);
      if ([aged, delivered, sent, waiting, failed].some((x) => x === null)) {
        skipped = "the per-template counts came back unreadable";
        break;
      }
      templates += 1;
      const ch = String(r.channel) === "sms" ? "text" : "email";
      const tot = byChannel.get(ch) || { aged: 0, delivered: 0 };
      tot.aged += aged;
      tot.delivered += delivered;
      byChannel.set(ch, tot);
      if (aged >= PATH_MIN_ROWS && delivered === 0) {
        const bits = [];
        if (sent) bits.push(`${sent} sent with no receipt`);
        if (waiting) bits.push(`${waiting} still waiting`);
        if (failed) bits.push(`${failed} failed or bounced`);
        dead.push(`${clip(r.template_key, 60)} (${ch}, ${aged} old ${plural(aged, "row", "rows")}, 0 delivered${bits.length ? `: ${bits.join(", ")}` : ""})`);
      }
    }
    if (!skipped) {
      const silent = [...byChannel.entries()].filter(([, t]) => t.aged >= PATH_MIN_ROWS && t.delivered === 0).map(([c]) => c);
      if (dead.length > 0) {
        const lead = silent.length
          ? `Every ${silent.join(" and every ")} template read zero delivered in ${PATH_LOOKBACK_DAYS} days, so the whole channel is not reaching people (or its receipts are silent). `
          : "";
        parts.push({
          fail: `${lead}${dead.length} ${plural(dead.length, "template", "templates")} queued mail that never arrived in the last ${PATH_LOOKBACK_DAYS} days: ${dead.slice(0, 4).join("; ")}${dead.length > 4 ? `; ${dead.length - 4} more` : ""}.`
        });
      } else {
        parts.push({ pass: `${templates} ${plural(templates, "template", "templates")} sent in ${PATH_LOOKBACK_DAYS} days, each with at least one delivered (a template needs ${PATH_MIN_ROWS} old rows to be judged)` });
      }
    }
  }

  if (stepsError || !stepsRow) {
    skipped = skipped || `the email-step read failed: ${stepsError || "no row came back"}`;
  } else {
    const n = num(stepsRow.n);
    if (n === null) {
      skipped = skipped || "the email-step count came back unreadable";
    } else if (n > 0) {
      const names = Array.isArray(stepsRow.names) ? stepsRow.names.map(String).filter(Boolean) : [];
      parts.push({
        fail: `${n} ${plural(n, "event", "events")} should have made an email and no email was queued (${names.slice(0, 4).join(", ") || "unnamed"}).`
      });
    } else {
      parts.push({ pass: `every watched event in ${PATH_LOOKBACK_DAYS} days made its email (${EMAIL_EVENT_STEPS.length} steps)` });
    }
  }

  const fails = parts.filter((p) => p.fail);
  if (fails.length > 0) {
    const tail = skipped ? ` Not read: ${skipped}.` : "";
    return row(id, "FAIL", `${fails.map((p) => p.fail).join(" ")}${tail}`, PATH_FIX);
  }
  if (skipped) return row(id, "skip", `Template paths not fully read: ${skipped}.`);
  return row(id, "PASS", `${parts.map((p) => p.pass).join("; ")}.`);
}

async function checkPath(db, orgId, now) {
  const since = agoIso(now, PATH_LOOKBACK_DAYS * DAY);
  const [path, steps] = await Promise.all([
    readRows(db, TEMPLATE_PATH_SQL, [orgId, since, agoIso(now, PATH_GRACE_HOURS * HOUR), TEST_ADDRESS_RE]),
    readRows(db, buildEmailStepsSql(), [orgId, agoIso(now, EVENT_GRACE_MINUTES * MINUTE), since])
  ]);
  if (path.error && steps.error) {
    return row("msg:per-template-path", "skip", `Template paths not read: ${path.error}; ${steps.error}.`);
  }
  return judgePath(path.error ? null : path.rows, path.error, steps.rows && steps.rows[0], steps.error);
}

// ── 5. msg:brakes ────────────────────────────────────────────────────────────

/** $1 org, $2 since the pause began, $3 TEST_ADDRESS_RE. Only run when the switch is off. */
export const PAUSED_SENDS_SQL = `
SELECT count(*)::int AS n,
       min(COALESCE(m.last_attempt_at, m.created_at)) AS first_at
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel IN ('sms', 'email')
   AND m.status IN (${LEFT_SQL})
   AND COALESCE(m.last_attempt_at, m.created_at) > $2::timestamptz
   AND ${real("m", "$3")}`.trim();

/** $1 org, $2 since. Messages that left, by day (the day the app's own cap counts: created_at, day of the database clock). */
export const DAILY_SENDS_SQL = `
SELECT date_trunc('day', m.created_at) AS day, count(*)::int AS n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status IN (${LEFT_SQL})
   AND m.created_at >= date_trunc('day', $2::timestamptz)
 GROUP BY 1
 ORDER BY 1`.trim();

/** $1 org, $2 since, $3 window hours, $4 TEST_ADDRESS_RE. The same text to the same phone twice inside the window. */
export const DUPLICATE_TEXTS_SQL = `
SELECT COALESCE(a.template_key, '(no template)') AS template_key,
       count(DISTINCT b.id)::int AS n,
       count(DISTINCT right(regexp_replace(a.to_address, '[^0-9]', '', 'g'), 10))::int AS phones
  FROM messages a
  JOIN messages b
    ON b.org_id = a.org_id
   AND b.direction = 'outbound'
   AND b.channel = 'sms'
   AND b.id <> a.id
   AND b.status IN (${LEFT_SQL})
   AND b.created_at > a.created_at
   AND b.created_at < a.created_at + make_interval(hours => $3::int)
   AND right(regexp_replace(COALESCE(b.to_address, ''), '[^0-9]', '', 'g'), 10)
     = right(regexp_replace(COALESCE(a.to_address, ''), '[^0-9]', '', 'g'), 10)
   AND (
        (a.template_key IS NOT NULL AND b.template_key = a.template_key)
     OR (a.template_key IS NULL AND b.template_key IS NULL AND b.rendered_body = a.rendered_body)
   )
 WHERE a.org_id = $1::uuid
   AND a.direction = 'outbound'
   AND a.channel = 'sms'
   AND a.status IN (${LEFT_SQL})
   AND a.created_at >= $2::timestamptz
   AND length(regexp_replace(COALESCE(a.to_address, ''), '[^0-9]', '', 'g')) >= 10
   AND a.sender_staff_id IS NULL
   AND b.sender_staff_id IS NULL
   AND ${real("a", "$4")}
   AND ${real("b", "$4")}
 GROUP BY 1
 ORDER BY n DESC, 1
 LIMIT 20`.trim();

const BRAKES_FIX =
  "Read the messages named. A send after the pause means a path that skips the switch (staff replies, closer sends, " +
  "agent replies and the staff job do not read it today). A day over the cap means the same. A repeated text means " +
  "src/messaging/sms-dedup.mjs is written and never called from the dispatcher. A person fixes the path, not this " +
  `check. ${TAIL}`;

function dayWord(day) {
  const d = day instanceof Date ? day : new Date(day);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(day).slice(0, 10);
}

function judgeBrakes({ settings, paused, daily, dupes }) {
  const id = "msg:brakes";
  const fails = [];
  const passes = [];
  const unread = [];

  const enabled = settings && settings.outbound_enabled !== false;
  if (!settings) {
    passes.push("no settings row, so the switch is on by default and there is no pause to break");
  } else if (enabled) {
    passes.push("the send switch is on, so there is no pause to break");
  } else if (paused.error || !paused.rows) {
    unread.push(`the send switch is off and the sends after it could not be read (${paused.error || "no rows"})`);
  } else {
    const n = num(paused.rows[0] && paused.rows[0].n);
    if (n === null) unread.push("the sends after the pause came back unreadable");
    else if (n > 0) {
      fails.push(`the send switch is off and ${n} ${plural(n, "message", "messages")} left after it was turned off (${dayWord(settings.updated_at)})`);
    } else {
      passes.push("the send switch is off and nothing has left since");
    }
  }

  // A missing cap is no ceiling, the same reading outbox.mjs gives it. A row with none is the default of 500.
  const cap = !settings ? 500 : settings.daily_send_cap == null ? 0 : num(settings.daily_send_cap);
  if (cap === null) {
    unread.push("the daily cap came back unreadable");
  } else if (cap === 0) {
    passes.push("no daily cap is set");
  } else if (daily.error || !daily.rows) {
    unread.push(`the daily sends could not be read (${daily.error || "no rows"})`);
  } else {
    let worst = null;
    let bad = false;
    for (const d of daily.rows) {
      const n = num(d && d.n);
      if (n === null) {
        bad = true;
        break;
      }
      if (n > cap && (!worst || n > worst.n)) worst = { n, day: d.day };
    }
    if (bad) unread.push("the daily send counts came back unreadable");
    else if (worst) fails.push(`${worst.n} messages left on ${dayWord(worst.day)}, over the daily cap of ${cap}`);
    else passes.push(`no day went over the cap of ${cap}`);
  }

  if (dupes.error || !dupes.rows) {
    unread.push(`repeated texts could not be read (${dupes.error || "no rows"})`);
  } else {
    let total = 0;
    const pieces = [];
    let bad = false;
    for (const r of dupes.rows) {
      const n = num(r && r.n);
      if (n === null) {
        bad = true;
        break;
      }
      total += n;
      pieces.push([clip(r.template_key, 50), n]);
    }
    if (bad) unread.push("the repeated-text count came back unreadable");
    else if (total > 0) {
      fails.push(`${total} ${plural(total, "text was", "texts were")} the same text to the same phone twice inside ${DUPLICATE_WINDOW_HOURS} hours (${tally(pieces, 4)})`);
    } else {
      passes.push(`no phone got the same text twice inside ${DUPLICATE_WINDOW_HOURS} hours`);
    }
  }

  if (fails.length > 0) {
    const tail = unread.length ? ` Not read: ${unread.join("; ")}.` : "";
    return row(id, "FAIL", `${fails.join(". ")}.${tail}`, BRAKES_FIX);
  }
  if (unread.length > 0) return row(id, "skip", `Send brakes not fully read: ${unread.join("; ")}.`);
  return row(id, "PASS", `${passes.join("; ")}.`);
}

async function checkBrakes(db, orgId, now, settingsRead) {
  const id = "msg:brakes";
  if (settingsRead.error || !settingsRead.rows) {
    return row(id, "skip", `Send brakes not read: could not read the send settings (${settingsRead.error || "no rows came back"}).`);
  }
  const settings = settingsRead.rows[0] || null;
  const enabled = !settings || settings.outbound_enabled !== false;
  const sinceDays = agoIso(now, BRAKE_LOOKBACK_DAYS * DAY);
  const pausedSince = settings && settings.updated_at ? new Date(settings.updated_at).toISOString() : null;
  const [paused, daily, dupes] = await Promise.all([
    !enabled && pausedSince ? readRows(db, PAUSED_SENDS_SQL, [orgId, pausedSince, TEST_ADDRESS_RE]) : Promise.resolve({ rows: [] }),
    readRows(db, DAILY_SENDS_SQL, [orgId, sinceDays]),
    readRows(db, DUPLICATE_TEXTS_SQL, [orgId, sinceDays, DUPLICATE_WINDOW_HOURS, TEST_ADDRESS_RE])
  ]);
  return judgeBrakes({ settings, paused, daily, dupes });
}

// ── 6. msg:dead-senders ──────────────────────────────────────────────────────

/**
 * $1 org (null reads the default company), $2 since, $3 the dead keys, $4 TEST_ADDRESS_RE.
 * Also the naVerify read: the claim "nothing sends these" is true exactly when this finds no row.
 */
export const DEAD_QUEUED_SQL = `
SELECT m.template_key, m.channel, count(*)::int AS n, max(m.created_at) AS last_at
  FROM messages m
 WHERE m.org_id = COALESCE($1::uuid, (SELECT id FROM orgs WHERE is_default LIMIT 1))
   AND m.direction = 'outbound'
   AND m.template_key = ANY($3::text[])
   AND m.created_at >= $2::timestamptz
   AND ${real("m", "$4")}
 GROUP BY m.template_key, m.channel
 ORDER BY n DESC, m.template_key
 LIMIT 50`.trim();

const DEAD_FIX =
  "A template this list calls dead was queued, so something sends it now. Read the message rows. Either the sender is " +
  "new (build its checks like a live template's, then remove the key from src/pulse/coverage/msg-dead-templates.mjs) " +
  `or it is a test that reached the real queue. A person decides which. ${TAIL}`;

function judgeDead(rows, now) {
  const id = "msg:dead-senders";
  let total = 0;
  const pieces = [];
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The dead-template count came back unreadable.");
    if (n === 0) continue;
    total += n;
    pieces.push([clip(r.template_key, 60), n]);
  }
  if (total > 0) {
    return row(
      id,
      "FAIL",
      `${total} ${plural(total, "message", "messages")} used a template the list says nothing sends, in the last ${DEAD_LOOKBACK_DAYS} days: ${tally(pieces, 5)}.`,
      DEAD_FIX
    );
  }
  return naRow(
    id,
    "no-sender",
    { count: DEAD_TEMPLATE_KEYS.length, days: DEAD_LOOKBACK_DAYS, since: agoIso(now, DEAD_LOOKBACK_DAYS * DAY) },
    `${DEAD_TEMPLATE_KEYS.length} templates have no sender or are retired. None was queued in the last ${DEAD_LOOKBACK_DAYS} days. Judged the day one is.`
  );
}

async function checkDead(db, orgId, now) {
  const got = await readRows(db, DEAD_QUEUED_SQL, [
    orgId,
    agoIso(now, DEAD_LOOKBACK_DAYS * DAY),
    [...DEAD_TEMPLATE_KEYS],
    TEST_ADDRESS_RE
  ]);
  if (got.error || !got.rows) {
    return row("msg:dead-senders", "skip", `Dead templates not read: ${got.error || "no rows came back"}.`);
  }
  return judgeDead(got.rows, now);
}

/**
 * The audit calls this to prove a "nothing to judge" row again. It reads with the same SQL the lane used and
 * answers true only when the read really finds no queued message from a dead template. A throw is left to throw:
 * the audit counts a throw as false.
 * @param {{ since?: string, days?: number }} args
 * @param {{ db?: any, scope?: Function, now?: Date|string|number }} ctx
 */
export const naVerify = Object.freeze({
  "no-sender": async (args, ctx = {}) => {
    const run = bind(ctx);
    if (!run) return false;
    const now = ctx.now != null && Number.isFinite(new Date(ctx.now).getTime()) ? new Date(ctx.now) : new Date();
    const since = args && args.since ? new Date(args.since) : null;
    const days = Number(args && args.days);
    // A claim over less than a day proves nothing. The verifier does not trust the producer's window.
    const floor = new Date(now.getTime() - DAY);
    const from = since && Number.isFinite(since.getTime()) && since.getTime() <= floor.getTime()
      ? since
      : Number.isFinite(days) && days >= 1 ? new Date(now.getTime() - days * DAY) : null;
    if (!from) return false;
    const out = await run((tx) => tx.query(DEAD_QUEUED_SQL, [null, from.toISOString(), [...DEAD_TEMPLATE_KEYS], TEST_ADDRESS_RE]));
    const rows = out && Array.isArray(out.rows) ? out.rows : null;
    if (!rows) return false;
    return rows.every((r) => num(r && r.n) === 0);
  }
});

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

// ── 6b. msg:owner-alerts-unsent ──────────────────────────────────────────────

/** $1 org, $2 queued-before. An owner alert is a row that waits for a sender (108_owner_notifications.sql). */
export const OWNER_ALERTS_SQL = `
SELECT status, count(*)::int AS n, min(created_at) AS oldest
  FROM owner_notifications
 WHERE org_id = $1::uuid
   AND (status = 'failed' OR (status = 'queued' AND created_at < $2::timestamptz))
 GROUP BY status
 ORDER BY status`.trim();

const OWNER_FIX =
  "Owner alert texts are written to owner_notifications and nothing sends them (sent_at stays empty until a sender is " +
  "built). Read the rows. A person builds the sender or clears the rows, not this check. " + TAIL;

function judgeOwnerAlerts(rows) {
  const id = "msg:owner-alerts-unsent";
  let queued = 0;
  let failed = 0;
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The owner-alert count came back unreadable.");
    if (r.status === "failed") failed += n;
    else queued += n;
  }
  if (queued + failed === 0) {
    return row(id, "PASS", `No owner alert text is waiting more than ${OWNER_ALERT_GRACE_HOURS} hour for a sender, and none failed.`);
  }
  const bits = [];
  if (queued) bits.push(`${queued} still queued with no sender`);
  if (failed) bits.push(`${failed} failed`);
  return row(id, "FAIL", `${queued + failed} owner alert ${plural(queued + failed, "text was", "texts were")} never sent: ${bits.join(", ")}.`, OWNER_FIX);
}

async function checkOwnerAlerts(db, orgId, now) {
  const got = await readRows(db, OWNER_ALERTS_SQL, [orgId, agoIso(now, OWNER_ALERT_GRACE_HOURS * HOUR)]);
  if (got.error || !got.rows) {
    return row("msg:owner-alerts-unsent", "skip", `Owner alerts not read: ${got.error || "no rows came back"}.`);
  }
  return judgeOwnerAlerts(got.rows);
}

// ── 6c. msg:hiring-outreach-blocked ──────────────────────────────────────────

/** $1 org, $2 queued-before. Candidate outreach has no client row, so the gate holds it as recipient_unknown. */
export const HIRING_BLOCKED_SQL = `
SELECT m.template_key, m.status, count(*)::int AS n, min(m.created_at) AS oldest
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND (m.template_key LIKE 'EMAIL-CANDIDATE-OUTREACH-%' OR m.template_key LIKE 'SMS-CANDIDATE-OUTREACH-%')
   AND (
        (m.status = 'blocked' AND m.blocked_reason = 'recipient_unknown')
     OR (m.status = 'queued' AND m.created_at < $2::timestamptz)
   )
   AND COALESCE(m.is_demo, false) = false
 GROUP BY m.template_key, m.status
 ORDER BY n DESC, m.template_key
 LIMIT 20`.trim();

const HIRING_FIX =
  "The gate refuses a message with no client on it unless its template key is on the allow-list in " +
  "src/messaging/gate.mjs (see the note at the bottom of src/hiring/outreach.mjs). A person adds the keys, not this " +
  `check. ${TAIL}`;

function judgeHiring(rows) {
  const id = "msg:hiring-outreach-blocked";
  let total = 0;
  const pieces = [];
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The candidate-outreach count came back unreadable.");
    if (n === 0) continue;
    total += n;
    pieces.push([`${clip(r.template_key, 50)} (${r.status})`, n]);
  }
  if (total === 0) return row(id, "PASS", "No candidate outreach message is blocked as recipient unknown or stuck in the queue.");
  return row(
    id,
    "FAIL",
    `${total} candidate outreach ${plural(total, "message is", "messages are")} held at the gate or stuck: ${tally(pieces, 4)}. No candidate got them.`,
    HIRING_FIX
  );
}

async function checkHiring(db, orgId, now) {
  const got = await readRows(db, HIRING_BLOCKED_SQL, [orgId, agoIso(now, OWNER_ALERT_GRACE_HOURS * HOUR)]);
  if (got.error || !got.rows) {
    return row("msg:hiring-outreach-blocked", "skip", `Candidate outreach not read: ${got.error || "no rows came back"}.`);
  }
  return judgeHiring(got.rows);
}

// ── 7. msg:help-reply ────────────────────────────────────────────────────────

/**
 * $1 org, $2 since, $3 judged-before (the grace), $4 answer window in hours, $5 left-statuses.
 * Starts from the door (the message.inbound event, which carries the sender's number and the words), because the
 * saved inbound row keeps no phone. A number that has ever been the "to" of an inbound event is one of ours.
 * Answered means: a text of ours went to that number after the HELP, inside the window, and did not fail or get held.
 */
export const HELP_SQL = `
SELECT count(*)::int AS asked,
       count(*) FILTER (WHERE r.answered)::int AS answered,
       count(*) FILTER (WHERE NOT r.answered)::int AS unanswered,
       min(r.created_at) FILTER (WHERE NOT r.answered) AS oldest
  FROM (
    SELECT e.created_at,
           EXISTS (
             SELECT 1 FROM messages o
              WHERE o.org_id = e.org_id
                AND o.direction = 'outbound'
                AND o.channel = 'sms'
                AND o.status IN (${LEFT_OR_GOING_SQL})
                AND o.created_at >= e.created_at
                AND o.created_at < e.created_at + make_interval(hours => $4::int)
                AND length(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g')) >= 10
                AND right(regexp_replace(COALESCE(o.to_address, ''), '[^0-9]', '', 'g'), 10)
                  = right(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g'), 10)
           ) AS answered
      FROM events e
     WHERE e.org_id = $1::uuid
       AND e.name = 'message.inbound'
       AND e.created_at >= $2::timestamptz
       AND e.created_at < $3::timestamptz
       AND COALESCE(e.is_demo, false) = false
       AND COALESCE(e.payload->>'channel', 'sms') = 'sms'
       AND upper(regexp_replace(btrim(COALESCE(e.payload->>'body', '')), '[[:punct:][:space:]]+$', '')) = 'HELP'
       AND NOT (
         length(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g')) >= 10
         AND right(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g'), 10) IN (
           SELECT right(regexp_replace(ev.payload->>'to', '[^0-9]', '', 'g'), 10)
             FROM events ev
            WHERE ev.org_id = $1::uuid
              AND ev.name = 'message.inbound'
              AND COALESCE(ev.payload->>'to', '') <> ''
         )
       )
  ) r`.trim();

const HELP_FIX =
  "Several of our texts tell people to reply HELP, and nothing in the app answers it (src/handlers/comms.mjs reads " +
  "STOP and START only). Read the message.inbound event. A person builds the HELP answer, not this check. " + TAIL;

function judgeHelp(r) {
  const id = "msg:help-reply";
  if (!r) return row(id, "skip", "The HELP count did not come back.");
  const asked = num(r.asked);
  const unanswered = num(r.unanswered);
  if (asked === null || unanswered === null) return row(id, "skip", "The HELP count came back unreadable.");
  if (unanswered > 0) {
    return row(
      id,
      "FAIL",
      `${unanswered} of ${asked} ${plural(asked, "person", "people")} who texted HELP in the last ${HELP_LOOKBACK_DAYS} days got no text back inside ${HELP_ANSWER_HOURS} hours. Only a text of ours on our own record counts, so a reply the phone company sends by itself is not seen.`,
      HELP_FIX
    );
  }
  if (asked === 0) {
    return row(id, "PASS", `No one texted HELP in the last ${HELP_LOOKBACK_DAYS} days (our own test lines left out), so no HELP went unanswered.`);
  }
  return row(id, "PASS", `${asked} ${plural(asked, "person", "people")} texted HELP in the last ${HELP_LOOKBACK_DAYS} days and each got a text back.`);
}

async function checkHelp(db, orgId, now) {
  const got = await readRows(db, HELP_SQL, [
    orgId,
    agoIso(now, HELP_LOOKBACK_DAYS * DAY),
    agoIso(now, HELP_GRACE_MINUTES * MINUTE),
    HELP_ANSWER_HOURS
  ]);
  if (got.error || !got.rows) {
    return row("msg:help-reply", "skip", `HELP texts not read: ${got.error || "no rows came back"}.`);
  }
  return judgeHelp(got.rows[0]);
}

// ── the lane ─────────────────────────────────────────────────────────────────

function allSkips(detail) {
  return CHECK_IDS.map((id) => row(id, "skip", detail));
}

/** One check that throws is one skip row with the reason. It never becomes a PASS and never takes the others down. */
async function guarded(id, fn) {
  try {
    return await fn();
  } catch (err) {
    return row(id, "skip", `${id} could not run: ${clip((err && err.message) || err, 160)}.`);
  }
}

/**
 * gapChecks — nine read-only rows, in CHECK_IDS order.
 * ctx: { db, orgId, now, fetch | fetchImpl }. SELECT only. HEAD (or GET) only. Never sends.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = ctx.orgId;
  if (!canQuery(db)) return allSkips("No database in this run. Message truth not read.");
  if (!orgId) return allSkips("No company in this run. Message truth not read.");
  const now = nowOf(ctx);
  const fetchImpl = fetchOf(ctx);

  // The send settings are read inside the brakes check and the company alert address is needed by the staff check,
  // so the settings read is shared: one read, then the checks run side by side.
  const settingsRead = await readRows(db, SETTINGS_SQL, [orgId]);
  const settings = settingsRead.rows ? settingsRead.rows[0] || null : null;

  const [blanks, staff, links, path, brakes, dead, owner, hiring, help] = await Promise.all([
    guarded(CHECK_IDS[0], () => checkBlanks(db, orgId, now)),
    guarded(CHECK_IDS[1], () => checkStaffToClient(db, orgId, now, settings)),
    guarded(CHECK_IDS[2], () => checkLinks(db, orgId, now, fetchImpl)),
    guarded(CHECK_IDS[3], () => checkPath(db, orgId, now)),
    guarded(CHECK_IDS[4], () => checkBrakes(db, orgId, now, settingsRead)),
    guarded(CHECK_IDS[5], () => checkDead(db, orgId, now)),
    guarded(CHECK_IDS[6], () => checkOwnerAlerts(db, orgId, now)),
    guarded(CHECK_IDS[7], () => checkHiring(db, orgId, now)),
    guarded(CHECK_IDS[8], () => checkHelp(db, orgId, now))
  ]);
  return [blanks, staff, links, path, brakes, dead, owner, hiring, help];
}
