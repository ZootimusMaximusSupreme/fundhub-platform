// A route row whose named action the owner switched off (finish-the-853, batch 03, 2026-10-14).
//
// The catalog row says: closer-deck POST action=send_ebook "mint an ad-hoc priced pay link and send it".
// The owner retired that offer on 2026-10-11 (docs/journeys/CHANGELOG.md, commit 9b9f6fa88). The handler now
// refuses the action as unknown_action. So the named result no longer exists, and there is nothing to prove
// about "mint a link and send it".
//
// What can still be judged is that it STAYS off, and that is a read of saved data:
//   the old action wrote `closer_deck_ebook_sent_at` on the client file (src/sales/closer-deck.mjs, before
//   9b9f6fa88). Nothing writes that field now. So a client file that carries it with a time at or after the
//   first live ship without the action, or carries it with no readable time, is a retired offer that was sent.
//
// Good state is "na" (nothing to judge) with a closed, re-checked reason. The first send after the cutoff is a
// FAIL by name. A read that fails is "skip". Nothing here can say PASS: the named result is not proved, it is
// gone. Read only. No handler is called, nothing is sent, nothing is written.

export const RETIRED_ROUTE_CODE = "catalog-route-retired-action";

/* The first production ship that carried the retirement commit: bfd16774, logged 2026-10-12 09:36 Arizona in
   ops/ship-log.md (Arizona is UTC-7, no daylight saving). Sends before then were legitimate. */
const EBOOK_LIVE_SINCE = "2026-10-12T16:36:00";

/* One row: the saved send marker for the retired e-book action. The SQL takes the company ($1, null reads
   every company, the same way gap-catalog-data does) and the cutoff text ($2). It returns how many client
   files carry the marker at all (history) and how many carry it at or after the cutoff or with no readable
   time (wrong). ISO times compare as text in the "C" collation (plain byte order, so the punctuation in a
   time cannot reorder it), and a strange value cannot make the read throw. */
const EBOOK_SENDS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (
         WHERE NOT (c.custom_fields->>'closer_deck_ebook_sent_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T')
            OR (c.custom_fields->>'closer_deck_ebook_sent_at') COLLATE "C" >= $2::text
       )::int AS bad_count
  FROM clients c
 WHERE ($1::uuid IS NULL OR c.org_id = $1::uuid)
   AND c.custom_fields->>'closer_deck_ebook_sent_at' IS NOT NULL`;

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
    sql: EBOOK_SENDS_SQL,
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

/** { sample, bad } from the saved client files, or null when this run has no database. Throws when the read fails. */
export async function readRetiredSends(entry, ctx = {}) {
  const run = reader(ctx);
  if (!run) return null;
  const answer = await run((db) => db.query(entry.sql, [ctx.orgId || null, entry.liveSince]));
  const row = answer?.rows?.[0] || {};
  return { sample: Number(row.sample_count || 0), bad: Number(row.bad_count || 0) };
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
  if (stats.bad > 0) {
    return result(
      row.id,
      "FAIL",
      `${head}: the owner switched this ${entry.what} offer off on ${entry.retiredOn}. ${plural(stats.bad, "client file")} ` +
        `show${stats.bad === 1 ? "s" : ""} a ${entry.what} send saved at or after ${entry.liveSinceSaid}, or with no readable time. ` +
        `The closer deck sent an offer that was retired.`,
      `Open the client files that carry custom field ${entry.field} on or after that time. Find what served ` +
        `${entry.action} again. Do not auto-fix. Chris fixes reds.`,
    );
  }
  return result(
    row.id,
    "na",
    `${head}: the owner switched this ${entry.what} offer off on ${entry.retiredOn}, so there is no result left to prove. ` +
      `${stats.sample ? `${plural(stats.sample, "send")} saved before it went off` : "No send was ever saved"}, ` +
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
    return !!stats && stats.bad === 0;
  } catch {
    return false;
  }
}
