// Closer and setter calendar setup. The 6 a.m. reminder lane. Read only.
//
// WHY IT EXISTS (owner, 2026-10-09). Chris emailed Justice Nikkel and Sarah
// Blankstein on 2026-10-07 and asked each to connect a calendar so booked calls
// can land on it. The email left from Gmail. Nothing in our system wrote it
// down, so the pulse had nothing to watch. This lane watches the ask, and it
// reads the live booking page to see who is a host there yet.
//
// WHAT THE PRODUCT CANNOT DO. ClickFunnels has no API call to invite a team
// member, connect a calendar, add a host or set hours. A person must click those
// steps inside ClickFunnels. ClickFunnels lists a host on a booking page only
// after that person's calendar is connected, so "is a host there" is the proof.
//
// NOT A TRIPWIRE. No buyer is hurt when the first row is red: the owner still
// takes every booked call. So this lane has no entry in TRIPWIRES and no hourly
// beat. It is a reminder with a due day. A person's setup step does not get
// done faster by the hour.
//
// ONE SELECT AND ONE GET, side by side. The SELECT reads the open ask rows (the
// writer is scripts/closer-setup-ask.mjs; this lane never writes). The GET reads
// the booking page. Both rows are emitted in every case, as a skip with a reason
// when the lane cannot judge. A skip is never a pass: it lands in
// audit:not-checked, so it is never hidden.
//
// WHAT THE SERVER CANNOT SEE. A reply to the email (this lane may only read web
// pages and rows). Which closer got a call once there are two hosts. The Meet
// link. A name that ClickFunnels spells another way keeps the first row red.
//
// Read only: no write statement, no transaction control, no web write, no file
// read, no text, no email, no notify, no task creation.

export const CHECK_IDS = Object.freeze([
  "closer-setup:calendar-late",
  "closer-setup:booking-page-host"
]);

/** The source_workflow written on every ask row by scripts/closer-setup-ask.mjs. */
export const ASK_SOURCE = "closer-calendar-ask";
/** Every ask body is "closer-calendar:<staff id>:<asked ISO time>". */
export const ASK_BODY_PREFIX = "closer-calendar:";
/** Days from the ask to the day it turns red. The writer sets due_at from this. */
export const GRACE_DAYS = 3;

export const DEFAULT_FUNNEL_URL = "https://apply.fundhub.ai";
export const PAGE_PATH = "/funding-book-call";
export const PAGE_TIMEOUT_MS = 10000;
export const READ_TIMEOUT_MS = 8000;

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "America/Phoenix";
const ASK_LIMIT = 50;

const SKIP_NOTE = "A skip is not a pass. It shows inside audit:not-checked.";

/* One question, one read. The staff row is joined on the id inside the body, so
   the join compares text with text and a bad body cannot throw a cast error. A
   LEFT JOIN keeps an ask whose staff row is gone, so it cannot vanish into a
   false green. Open means done is false. Demo rows are left out. */
export const ASKS_SQL = `/* gap-closer-setup:asks */
SELECT t.id::text AS task_id,
       t.body,
       t.due_at,
       t.created_at,
       s.id::text AS staff_id,
       s.name AS staff_name,
       s.role AS staff_role,
       s.status AS staff_status,
       s.active AS staff_active
  FROM tasks t
  LEFT JOIN staff s
    ON s.org_id = t.org_id
   AND s.id::text = substring(t.body from ('^' || $3::text || '([0-9a-fA-F-]{36}):'))
 WHERE t.org_id = $1::uuid
   AND t.source_workflow = $2::text
   AND t.done = false
   AND t.is_demo = false
   AND left(t.body, char_length($3::text)) = $3::text
 ORDER BY t.due_at NULLS LAST, t.created_at
 LIMIT ${ASK_LIMIT}`;

function check(id, status, detail, suggestedFix = null, customerSees = null) {
  const row = { id, status, detail, suggestedFix };
  if (customerSees) row.customerSees = customerSees;
  return row;
}

function clip(value, n = 160) {
  return String(value && value.message ? value.message : value).replace(/\s+/g, " ").trim().slice(0, n);
}

function words(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/* "Justice  Nikkel" and "justice nikkel" are the same person. So are "Mary-Ann"
   and "Mary Ann". Part of a name ("Justice N.") is not a match and stays red. */
function norm(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* One strict reading of a time written as text: a full ISO time with a zone, like
   2026-10-07T17:41:33Z. Nothing looser. "7", "2026-10-07" and a time with no zone
   are not times here, and a day that does not exist (Feb 31) is not rolled into
   the next month. The writer scripts/closer-setup-ask.mjs uses this too. */
const ISO_TIME_RE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function parseIsoTime(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const m = ISO_TIME_RE.exec(text);
  if (!m) return null;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.getUTCMonth() !== Number(m[2]) - 1 || day.getUTCDate() !== Number(m[3])) return null;
  return d;
}

/* "Oct 10" in Arizona time, the clock Chris reads. The year shows only when it
   is not this year. */
function dayLabel(date, now) {
  const fmt = (d) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" })
        .formatToParts(d).map((x) => [x.type, x.value])
    );
    return p;
  };
  const a = fmt(date);
  const b = fmt(now);
  return a.year === b.year ? `${a.month} ${a.day}` : `${a.month} ${a.day}, ${a.year}`;
}

/* Whole calendar days from one day to another on the Arizona clock: asked Oct 7,
   read Oct 11 is 4, whatever the hour. A count of 24 hour blocks would say 3. */
function arizonaDay(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY_MS;
}

function daysAgo(from, now) {
  return Math.max(0, Math.round(arizonaDay(now) - arizonaDay(from)));
}

/* A name that ends in a period ("Justice N.") must not make two periods in a row. */
function noDot(text) {
  return String(text).replace(/[.\s]+$/, "");
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/* ---------------------------------------------------------------- the asks */

const PREFIX_SOURCE = ASK_BODY_PREFIX.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
const UUID_SOURCE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const BODY_RE = new RegExp("^" + PREFIX_SOURCE + "(" + UUID_SOURCE + "):(.+)$");

/**
 * "closer-calendar:<staff id>:<asked ISO>" -> { staffId, askedAt }.
 * The ISO time has colons in it, so the staff id is the first part and the rest
 * is the time. askedAt is null when the time part is not a full ISO time with a
 * zone (parseIsoTime), so the saved day is used instead.
 */
export function parseAskBody(body) {
  const m = BODY_RE.exec(String(body == null ? "" : body).trim());
  if (!m) return null;
  return { staffId: m[1].toLowerCase(), askedAt: parseIsoTime(m[2]) };
}

function askOf(row) {
  const parsed = parseAskBody(row && row.body);
  const askedAt = (parsed && parsed.askedAt) || validDate(row && row.created_at);
  if (!askedAt) return null;
  const due = validDate(row.due_at) || new Date(askedAt.getTime() + GRACE_DAYS * DAY_MS);
  const staffId = row.staff_id || (parsed && parsed.staffId) || null;
  const name = words(row.staff_name);
  const status = words(row.staff_status);
  const notActive = !row.staff_id
    ? "no staff row is on file for this ask"
    : (status && status.toLowerCase() !== "active") || row.staff_active === false
      ? `the staff row is ${status || "not active"}`
      : null;
  return {
    taskId: row.task_id ? String(row.task_id) : null,
    staffId,
    name: name || (staffId ? `staff ${String(staffId).slice(0, 8)}` : "an unknown person"),
    knownName: Boolean(name),
    role: words(row.staff_role).replace(/_/g, " ") || null,
    askedAt,
    askedFromBody: Boolean(parsed && parsed.askedAt),
    dueAt: due,
    notActive
  };
}

async function within(start, ms, label, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      (async () => start())(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (typeof onTimeout === "function") {
            try { onTimeout(); } catch { /* the wall is already up */ }
          }
          reject(new Error(label));
        }, ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* Through ctx.scope (the staff runner) when it is given, else ctx.db. Never
   throws: a read that fails is { ok: false, reason }. */
async function readAsks(ctx) {
  const orgId = ctx.orgId || null;
  const scoped = typeof ctx.scope === "function";
  const plain = Boolean(ctx.db && typeof ctx.db.query === "function");
  if (!orgId) return { ok: false, reason: "no company in this run" };
  if (!scoped && !plain) return { ok: false, reason: "no database in this run" };
  const params = [orgId, ASK_SOURCE, ASK_BODY_PREFIX];
  const ms = Number.isFinite(ctx.readTimeoutMs) && ctx.readTimeoutMs > 0 ? ctx.readTimeoutMs : READ_TIMEOUT_MS;
  try {
    const res = await within(
      () => (scoped ? ctx.scope((tx) => tx.query(ASKS_SQL, params)) : ctx.db.query(ASKS_SQL, params)),
      ms,
      "the ask read took too long"
    );
    const rows = res && Array.isArray(res.rows) ? res.rows : [];
    const asks = [];
    for (const row of rows) {
      const ask = askOf(row);
      if (ask) asks.push(ask);
    }
    return { ok: true, asks, unreadable: rows.length - asks.length };
  } catch (err) {
    return { ok: false, reason: clip(err) };
  }
}

/* ----------------------------------------------------------- the booking page */

/* The type of a script tag, read from its attributes one by one, so that
   data-type="application/json" is not the type, a value with "type=" written
   inside it is not the type, and application/json; charset=utf-8 is JSON. The
   first type attribute wins, as it does in a browser. */
function isJsonScript(attrs) {
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a;
  while ((a = re.exec(attrs))) {
    if (a[1].toLowerCase() !== "type") continue;
    const value = [a[2], a[3], a[4]].find((v) => typeof v === "string") || "";
    return /^application\/json\s*(?:;.*)?$/i.test(value.trim());
  }
  return false;
}

/**
 * The event block from a booking page: the first <script type="application/json">
 * (any attribute order, any other attributes in between) whose JSON holds an
 * event_type object. Returns that event_type object, or null.
 */
export function readBookingBlock(html) {
  const text = String(html == null ? "" : html);
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(text))) {
    if (!isJsonScript(m[1])) continue;
    let data;
    try {
      data = JSON.parse(m[2]);
    } catch {
      continue;
    }
    const type = data && typeof data === "object" ? data.event_type : null;
    if (type && typeof type === "object" && !Array.isArray(type)) return type;
  }
  return null;
}

/* FUNNEL_URL is the funnel's address. Only its origin is used (scheme, host and
   port), so a path or a query on it cannot bend the booking page address. */
function pageUrl(env) {
  const given = env && typeof env === "object" ? words(env.FUNNEL_URL) : "";
  let origin = DEFAULT_FUNNEL_URL;
  if (/^https?:\/\/[^\s*]+$/i.test(given)) {
    try {
      origin = new URL(given).origin;
    } catch {
      origin = DEFAULT_FUNNEL_URL;
    }
  }
  return new URL(PAGE_PATH, origin).href;
}

/* One GET. Never throws: { ok: false, reason } or { ok: true, ...hosts }. */
async function readPage(ctx) {
  const get = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : typeof ctx.fetch === "function" ? ctx.fetch : null;
  if (!get) return { ok: false, reason: "no web access in this run" };
  const url = pageUrl(ctx.env);
  const ms = Number.isFinite(ctx.pageTimeoutMs) && ctx.pageTimeoutMs > 0 ? ctx.pageTimeoutMs : PAGE_TIMEOUT_MS;
  const stop = typeof AbortController === "function" ? new AbortController() : null;
  let status = NaN;
  let html = "";
  try {
    await within(
      async () => {
        const res = await get(url, {
          method: "GET",
          headers: { accept: "text/html" },
          ...(stop ? { signal: stop.signal } : {})
        });
        status = Number(res && res.status);
        if (status >= 200 && status < 300) {
          html = res && typeof res.text === "function" ? String(await res.text()) : "";
        }
      },
      ms,
      `the page did not answer in ${ms >= 1000 ? `${Math.round(ms / 1000)} seconds` : `${ms} ms`}`,
      () => stop && stop.abort()
    );
  } catch (err) {
    return { ok: false, reason: clip(err) };
  }
  if (!(status >= 200 && status < 300)) {
    return { ok: false, reason: `the page answered ${Number.isFinite(status) ? status : "with no status"}` };
  }
  const block = readBookingBlock(html);
  if (!block) {
    return {
      ok: false,
      reason: "the page answered but its booking block is not in it; ClickFunnels may have changed the page code"
    };
  }
  if (!Array.isArray(block.event_hosts)) {
    return { ok: false, reason: "the booking block has no host list; ClickFunnels may have changed the page code" };
  }
  const names = block.event_hosts.map((h) => words(h && h.name)).filter(Boolean);
  const sel = block.selected_host && typeof block.selected_host === "object" ? block.selected_host : null;
  return {
    ok: true,
    eventName: words(block.name) || null,
    hostCount: block.event_hosts.length,
    hostNames: names,
    selected: sel
      ? { name: words(sel.name) || null, place: words(sel.pretty_location) || words(sel.location_description) || "" }
      : null
  };
}

/* ------------------------------------------------------------------ the rows */

const FIX_LATE =
  "A team member is past due to join the booking page. Send the ClickFunnels invite, nudge, give more days, or drop the ask.\n" +
  "Only a ClickFunnels team admin can send the invite and add a host. The API cannot. The pulse sends nothing.\n" +
  "To give more days or drop the ask: node scripts/closer-setup-ask.mjs snooze or close, with --staff and the staff id.";

const SEES_LATE = "No buyer is hurt yet. Booked calls still go to the hosts already on the booking page.";

function listNames(list) {
  return list.map((a) => a.name).join(", ");
}

function dayOfTotal(ask, now) {
  const total = Math.max(1, Math.round((ask.dueAt.getTime() - ask.askedAt.getTime()) / DAY_MS));
  const day = Math.max(1, Math.floor((now.getTime() - ask.askedAt.getTime()) / DAY_MS) + 1);
  return `day ${Math.min(day, total)} of ${total}`;
}

function judgeLate(asksRead, page, now) {
  const id = CHECK_IDS[0];
  if (!asksRead.ok) {
    return check(id, "skip", `open asks not read (${asksRead.reason}), so a late closer is unchecked. ${SKIP_NOTE}`);
  }
  const asks = asksRead.asks;
  if (asks.length === 0) {
    const bad = asksRead.unreadable > 0
      ? ` ${asksRead.unreadable} ask ${plural(asksRead.unreadable, "row has", "rows have")} no usable date and ${plural(asksRead.unreadable, "was", "were")} left out.`
      : "";
    return check(id, "PASS", `no closer or setter is waiting to join the booking page (no open ask on file).${bad}`);
  }

  const hostsKnown = page.ok;
  const onPage = new Set(hostsKnown ? page.hostNames.map(norm) : []);
  const joined = [];
  const waiting = [];
  const late = [];
  const unknown = [];
  for (const ask of asks) {
    if (hostsKnown && ask.knownName && onPage.has(norm(ask.name))) joined.push(ask);
    else if (now.getTime() < ask.dueAt.getTime()) waiting.push(ask);
    else if (hostsKnown) late.push(ask);
    else unknown.push(ask);
  }

  const hostsSeen = hostsKnown
    ? page.hostNames.length > 0 ? noDot(page.hostNames.join(", ")) : "no host is listed"
    : "not read";
  const note = (ask) => {
    const since = daysAgo(ask.askedAt, now);
    const ago = since === 0 ? "today" : `${since} ${plural(since, "day", "days")} ago`;
    const role = ask.role ? ` (${ask.role})` : "";
    const when = ask.askedFromBody ? "asked" : "ask saved";
    const extra = ask.notActive ? ` Note: ${ask.notActive}.` : "";
    return (
      `${ask.name}${role}: ${when} ${dayLabel(ask.askedAt, now)}, ${ago}, ` +
      `due ${dayLabel(ask.dueAt, now)}, not a host on the booking page.${extra}`
    );
  };

  if (late.length > 0) {
    return check(
      id,
      "FAIL",
      `${late.length} ${plural(late.length, "person is", "people are")} past due to join the booking page. ` +
        `${late.map(note).join(" ")} Hosts on the page now: ${hostsSeen}.`,
      FIX_LATE,
      SEES_LATE
    );
  }
  if (unknown.length > 0) {
    return check(
      id,
      "skip",
      `${listNames(unknown)} ${plural(unknown.length, "is", "are")} past due, but the booking page was not read ` +
        `(${page.reason}), so this check cannot say who joined. ${SKIP_NOTE}`
    );
  }

  const parts = [];
  if (waiting.length > 0) {
    parts.push(
      `Not late yet: ${waiting.map((a) => `${a.name} is on ${dayOfTotal(a, now)} (due ${dayLabel(a.dueAt, now)})`).join("; ")}.`
    );
  }
  if (joined.length > 0) {
    parts.push(`On the booking page now, so the ask can be closed: ${noDot(listNames(joined))}.`);
  }
  return check(id, "PASS", parts.join(" "));
}

function judgeHost(page) {
  const id = CHECK_IDS[1];
  if (!page.ok) {
    return check(id, "skip", `booking page not read (${page.reason}), so its hosts are unchecked. ${SKIP_NOTE}`);
  }
  const event = page.eventName ? ` for "${page.eventName}"` : "";
  if (page.hostCount === 0) {
    return check(
      id,
      "FAIL",
      `the booking page lists no host${event}. If ClickFunnels dropped the block from the page instead, this row shows as not checked, not red.`,
      "The booking page lists no host. Add a host to the booking event in ClickFunnels.\n" +
        "ClickFunnels may also drop the host block from the page. That shows as not checked, not red. The pulse sends nothing.",
      "A buyer cannot book a call: the booking page lists no host."
    );
  }
  const who = page.hostNames.length > 0 ? page.hostNames.join(", ") : "an unnamed host";
  const lead = `the booking page lists ${page.hostCount} ${plural(page.hostCount, "host", "hosts")}${event}: ${who}`;
  if (!page.selected) {
    return check(id, "PASS", `${lead}; no host is picked yet, so no place is read`);
  }
  const picked = page.selected.name || "the picked host";
  if (!page.selected.place) {
    return check(
      id,
      "FAIL",
      `${lead}; no place shown for ${picked}`,
      "The booking page lists a host but shows no place for the call. Set the place on the booking event in ClickFunnels.\n" +
        "Pick where the call happens, for example Google Meet. The pulse sends nothing.",
      "A buyer sees no place for the call on the booking page."
    );
  }
  return check(id, "PASS", `${lead}; place shown for ${picked}: ${page.selected.place}`);
}

/**
 * gapChecks(ctx) -> exactly two rows, in CHECK_IDS order, in every case.
 * ctx: { db, scope, orgId, now, fetchImpl | fetch, env } (the pulse's gap context).
 * Test hooks: ctx.readTimeoutMs, ctx.pageTimeoutMs.
 */
export async function gapChecks(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const now = c.now instanceof Date && !Number.isNaN(c.now.getTime()) ? c.now : new Date();
  const [asksRead, page] = await Promise.all([
    readAsks(c).catch((err) => ({ ok: false, reason: clip(err) })),
    readPage(c).catch((err) => ({ ok: false, reason: clip(err) }))
  ]);
  const rows = [];
  for (const [id, judge] of [
    [CHECK_IDS[0], () => judgeLate(asksRead, page, now)],
    [CHECK_IDS[1], () => judgeHost(page)]
  ]) {
    try {
      rows.push(judge());
    } catch (err) {
      rows.push(check(id, "skip", `this check could not be judged (${clip(err)}). ${SKIP_NOTE}`));
    }
  }
  return rows;
}
