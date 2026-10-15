// A route row whose named action the owner switched off (finish-the-853, batch 03, 2026-10-14).
//
// The catalog row says: closer-deck POST action=send_ebook "mint an ad-hoc priced pay link and send it".
// The owner retired that offer on 2026-10-11 (docs/journeys/CHANGELOG.md, commit 9b9f6fa88). The handler now
// refuses the action as unknown_action. So the named result no longer exists, and there is nothing to prove
// about "mint a link and send it".
//
// What can still be judged is that it STAYS off, and that is a read of saved data. The old action left three
// traces, in the order it wrote them (src/sales/closer-deck.mjs, git 9b9f6fa88^, sendDeckEbook):
//   1. a pay link: payment_links, purpose custom, the description "Fundhub e-book" unless the closer typed one
//   2. an email: messages, provider_ref staff:ebook-send:<link id> (the idempotency key was fixed in code)
//   3. a marker on the client file: clients.custom_fields.closer_deck_ebook_sent_at, written LAST
// Nothing writes any of them now. A send that stops half way (the email goes and the marker write fails, or a
// re-implementation never writes the marker) still leaves the first two, so all three are read. Any one of them
// at or after the first live ship without the action, or a marker with no readable time, is a retired offer
// that was sent.
//
// Good state is "na" (nothing to judge) with a closed, re-checked reason. The first send after the cutoff is a
// FAIL by name. A read that fails is "skip". Nothing here can say PASS: the named result is not proved, it is
// gone. Read only. No handler is called, nothing is sent, nothing is written.
//
// HOW THE SQL IS HELD. The SQL here judges nothing. Each trace is one plain SELECT that returns the saved time
// of every matching row, and the judging (before or after the cutoff, readable or not) is plain code. The
// statements stay in the subset that Postgres and SQLite both run (no casts, no regex operator, no collation),
// so fin-b03-route-retired.test.mjs executes these exact strings on a real SQL engine against made-up tables,
// and fin-b03-route-retired.pg.test.mjs executes them on real Postgres where a database is set. A SQL break
// (wrong table, a condition added or flipped, a column dropped) therefore changes what those tests read.

export const RETIRED_ROUTE_CODE = "catalog-route-retired-action";

/* The first production ship that carried the retirement commit: bfd16774, logged 2026-10-12 09:36 Arizona in
   ops/ship-log.md (Arizona is UTC-7, no daylight saving). Sends before then were legitimate. With the Z, so no
   machine reads it as its own local time. */
const EBOOK_LIVE_SINCE = "2026-10-12T16:36:00.000Z";

/* The most rows one trace may return. The old action is retired and nothing writes these traces, so the real
   number is a handful. Past the cap the read stops and says so (the row goes "skip") rather than judge a part. */
export const TRACE_ROW_CAP = 1000;

/* The three traces. `select` returns one column, `saved_at`: the saved time. `orgColumn` scopes it to one company
   (the `$1` parameter), and with no company named the statement has no parameter at all. */
export const EBOOK_TRACES = Object.freeze([
  Object.freeze({
    key: "marker",
    noun: "client file",
    said: "carrying an e-book send marker",
    field: "closer_deck_ebook_sent_at",
    select:
`SELECT c.custom_fields->>'closer_deck_ebook_sent_at' AS saved_at
  FROM clients c
 WHERE c.custom_fields->>'closer_deck_ebook_sent_at' IS NOT NULL`,
    orgColumn: "c.org_id",
  }),
  /* The description is typed by staff, so this is the looser trace. "ebook" is matched at the start of a word
     only: "Facebook" contains the letters e-b-o-o-k and must not count. */
  Object.freeze({
    key: "link",
    noun: "pay link",
    said: "described as an e-book",
    field: "payment_links.description",
    select:
`SELECT p.created_at AS saved_at
  FROM payment_links p
 WHERE p.purpose = 'custom'
   AND (lower(p.description) LIKE '%e-book%'
        OR lower(p.description) LIKE 'ebook%'
        OR lower(p.description) LIKE '% ebook%')`,
    orgColumn: "p.org_id",
  }),
  Object.freeze({
    key: "message",
    noun: "email",
    said: "sent as an e-book send",
    field: "messages.provider_ref",
    select:
`SELECT m.created_at AS saved_at
  FROM messages m
 WHERE m.provider_ref LIKE 'staff:ebook-send:%'`,
    orgColumn: "m.org_id",
  }),
]);

/** The statement for one trace. `scoped` adds the company filter and its one parameter ($1). */
export function ebookTraceSql(trace, scoped) {
  return `${trace.select}${scoped ? `\n   AND ${trace.orgColumn} = $1` : ""}\n LIMIT ${TRACE_ROW_CAP + 1}`;
}

export const RETIRED_ROUTE_ACTIONS = Object.freeze([
  Object.freeze({
    sourceFile: "routes-1.json",
    surface: "route:closer-deck",
    control: "POST action=send_ebook {client_id, amount_cents} (mint an ad-hoc priced pay link and send it)",
    action: "send_ebook",
    what: "e-book",
    field: "closer_deck_ebook_sent_at",
    retiredOn: "2026-10-11",
    liveSince: EBOOK_LIVE_SINCE,
    liveSinceSaid: "2026-10-12 09:36 Arizona",
    traces: EBOOK_TRACES,
  }),
]);

/** The retired entry for a gap row ({ sourceFile, surface, control }), or null. All three must match. */
export function retiredRouteEntry(row) {
  return RETIRED_ROUTE_ACTIONS.find((entry) =>
    entry.sourceFile === row?.sourceFile && entry.surface === row?.surface && entry.control === row?.control) || null;
}

/** The retired entry a N/A proof names (its args), or null. The proof cannot name a field or a cutoff of its own. */
export function retiredRouteEntryForArgs(args) {
  return RETIRED_ROUTE_ACTIONS.find((entry) =>
    entry.sourceFile === args?.sourceFile && entry.surface === args?.surface
    && entry.control === args?.control && entry.action === args?.action) || null;
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/* A saved time as milliseconds, or NaN when it cannot be read. A Date (what Postgres hands back) is read as is.
   Text must be a full ISO time ("2026-10-13T20:10:00.000Z"); text with no zone is read as UTC, never as the
   machine's own time. Anything else (empty, a word, a number, null) is not a time. */
function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return Number.NaN;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/.test(value)) return Number.NaN;
  const zoned = /(Z|[+-][0-9]{2}(:?[0-9]{2})?)$/i.test(value) ? value : `${value}Z`;
  return Date.parse(zoned);
}

/* How many saved results there are, and how many are wrong: at or after the cutoff, or with no readable time. */
function judgeTimes(values, sinceMs) {
  let bad = 0;
  for (const value of values) {
    if (!(toMillis(value) < sinceMs)) bad += 1;
  }
  return { sample: values.length, bad };
}

/** { marker, link, message } each { sample, bad }, or null when this run has no database. Throws when a read fails. */
export async function readRetiredSends(entry, ctx = {}) {
  const run = reader(ctx);
  if (!run) return null;
  const orgId = ctx.orgId || null;
  const sinceMs = Date.parse(entry.liveSince);
  return run(async (db) => {
    const out = {};
    for (const trace of entry.traces) {
      const answer = await db.query(ebookTraceSql(trace, Boolean(orgId)), orgId ? [orgId] : []);
      const rows = answer?.rows || [];
      if (rows.length > TRACE_ROW_CAP) {
        throw new Error(`more than ${TRACE_ROW_CAP} ${trace.noun}s carry this trace, so it was not judged`);
      }
      out[trace.key] = judgeTimes(rows.map((row) => row.saved_at), sinceMs);
    }
    return out;
  });
}

function totalBad(entry, stats) {
  return entry.traces.reduce((sum, trace) => sum + (stats[trace.key]?.bad || 0), 0);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function result(id, status, detail, suggestedFix = null, na = undefined) {
  return { id, status, detail, suggestedFix, ...(na ? { na } : {}) };
}

/** The gap row for a retired route action. Only "na", "FAIL" or "skip". Never "PASS". */
export async function judgeRetiredRoute(row, entry, ctx = {}) {
  const head = `${row.surface} — ${row.control}`;
  let stats;
  try {
    stats = await readRetiredSends(entry, ctx);
  } catch (error) {
    const why = String(error?.message || error || "unknown read error").replace(/\s+/g, " ").slice(0, 160);
    return result(row.id, "skip", `${head}: the saved ${entry.what} sends were not read: ${why}.`);
  }
  if (!stats) {
    return result(row.id, "skip", `${head}: the saved ${entry.what} sends were not read: no database in this run.`);
  }
  if (totalBad(entry, stats) > 0) {
    const found = entry.traces
      .filter((trace) => stats[trace.key].bad > 0)
      .map((trace) => `${plural(stats[trace.key].bad, trace.noun)} ${trace.said}`);
    return result(
      row.id,
      "FAIL",
      `${head}: the owner switched this ${entry.what} offer off on ${entry.retiredOn}. A send was saved at or after ` +
        `${entry.liveSinceSaid}, or with no readable time: ${found.join("; ")}. ` +
        `The closer deck sent an offer that was retired.`,
      `Open what the send left: client files with custom field ${entry.field}, pay links described as an ` +
        `${entry.what}, and emails whose provider_ref starts with staff:ebook-send:. Find what served ` +
        `${entry.action} again. Do not auto-fix. Chris fixes reds.`,
    );
  }
  const before = entry.traces
    .filter((trace) => stats[trace.key].sample > 0)
    .map((trace) => plural(stats[trace.key].sample, trace.noun));
  return result(
    row.id,
    "na",
    `${head}: the owner switched this ${entry.what} offer off on ${entry.retiredOn}, so there is no result left to prove. ` +
      `${before.length ? `Saved before it went off: ${before.join(", ")}` : `No ${entry.what} send was ever saved`}, ` +
      `and none was saved since ${entry.liveSinceSaid}. This goes red on the first one.`,
    null,
    { code: RETIRED_ROUTE_CODE, args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control, action: entry.action } },
  );
}

/** The lane's answer when the pulse asks "is this still nothing to judge?". False when it cannot tell. */
export async function verifyRetiredRoute(args, ctx = {}) {
  const entry = retiredRouteEntryForArgs(args);
  if (!entry) return false;
  try {
    const stats = await readRetiredSends(entry, ctx);
    return !!stats && totalBad(entry, stats) === 0;
  } catch {
    return false;
  }
}
