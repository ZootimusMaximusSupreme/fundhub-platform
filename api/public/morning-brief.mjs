// GET /api/public/morning-brief?date=YYYY-MM-DD[&kind=evening]&k=<code>
//
// The data behind the "Full report" link in Chris's morning and evening text.
// No login: Chris taps the link on his phone and the page opens. The report holds
// company numbers, so the door is shut without the exact code the text carries
// (src/ops/brief-link.mjs). One code opens one org, one kind, one day, for 14 days.
//
// NO ORACLE. Every failure answers the same 404 { ok:false, error:"not_found" }:
// a bad or missing code, a bad date or kind, an old date, no brief that day, or no
// secret on the server. A stranger cannot tell which. Two exceptions, both
// carrying no data: a method other than GET is 405, and a database that does not
// answer is the shared 503 from src/http/db-down.mjs.
//
// WHAT COMES BACK. A safe copy of the brief: the sections the page draws. Never
// org_id, row ids, the phone's last 4, delivery status or error, the provider
// message id, the stored report_url, or any code (the "Full report" line is cut
// from the text, and any k= left in a string is removed). A row id (a UUID) inside
// a sentence becomes "(id hidden)".
//
// It reads (the default org, then the one brief) and writes nothing.
// Every answer: Cache-Control: no-store, X-Robots-Tag: noindex, nofollow,
// Referrer-Policy: no-referrer. Never print or log the code or the secret.

import { db as defaultDb } from "../../src/db.mjs";
import { readMorningBrief } from "../../src/ops/morning-brief.mjs";
import { briefRequestPlausible, verifyBriefToken } from "../../src/ops/brief-link.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export const NOT_FOUND = Object.freeze({ ok: false, error: "not_found" });

export const PUBLIC_BRIEF_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer"
});

/** Keys never sent, at any depth. */
const FORBIDDEN_KEYS = new Set([
  "org_id",
  "sent_to_last4",
  "delivery_status",
  "delivery_error",
  "provider_message_id",
  "report_url",
  "token",
  "k"
]);

/** Top-level fields of the brief row the page may see. Everything else is dropped. */
const ALLOWED_TOP = ["kind", "systems", "marketing", "money", "team", "suggestions", "today", "sent_at", "created_at", "updated_at"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_CODE = /([?&])k=[^&\s#"']*(&?)/g;
/** Any UUID anywhere in a string: a row id inside a sentence ("Look at <uuid> (analysis"). */
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const ID_HIDDEN = "(id hidden)";

/* Cut any k=<code> out of a link inside a string, keeping the rest of the link:
   "?date=x&k=y" → "?date=x", "?k=y&date=x" → "?date=x", "?k=y" → "".
   Then swap any row id (a UUID) left in the words for "(id hidden)". */
function scrubString(s) {
  return s.replace(LINK_CODE, (_m, sep, amp) => (amp ? sep : "")).replace(UUID_IN_TEXT, ID_HIDDEN);
}

/* Deep copy without the forbidden keys. An `id` that is a row id (a UUID) goes
   too; an `id` that is a check name ("login", "reg:auth/login") stays, because
   the page shows it. */
function scrub(value, depth = 0) {
  if (depth > 40) return null;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (key === "id" && typeof v === "string" && UUID.test(v)) continue;
      out[key] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** The brief row cut down to what the page draws. */
export function safeBrief(row) {
  if (!row || typeof row !== "object") return null;
  const out = { date: row.brief_date ?? null };
  for (const key of ALLOWED_TOP) {
    if (!(key in row)) continue;
    out[key] = scrub(row[key]);
  }
  // The page never draws the full check list (about 173 KB of 193 KB) or the text copy. Do not send what is not
  // shown: less to download on a phone, and a held link reveals the report, not the internal check map.
  if (out.systems && typeof out.systems === "object" && !Array.isArray(out.systems)) {
    const { scorecard, ...rest } = out.systems;
    out.systems = rest;
  }
  return out;
}

function single(v) {
  return typeof v === "string" ? v.trim() : v == null ? undefined : null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || defaultDb;
  const env = deps.env || process.env;
  const clock = deps.now || (() => new Date());

  for (const [k, v] of Object.entries(PUBLIC_BRIEF_HEADERS)) res.setHeader(k, v);
  const notFound = () => res.status(404).json({ ...NOT_FOUND });

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const q = req.query || {};
  const date = single(q.date);
  const rawKind = single(q.kind);
  const token = single(q.k);
  if (rawKind === null) return notFound();
  const kind = rawKind === undefined || rawKind === "" ? "morning" : rawKind;
  const now = clock();

  // Cheap checks first, so junk never reaches the database.
  if (!briefRequestPlausible({ kind, date, token, env, now })) return notFound();

  try {
    const org = await database.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
    const orgId = org?.rows?.[0]?.id ? String(org.rows[0].id) : null;
    if (!orgId) return notFound();
    if (!verifyBriefToken({ orgId, kind, date, token, env, now })) return notFound();

    const row = await readMorningBrief(database, { orgId, date, kind });
    if (!row) return notFound();

    return res.status(200).json({ ok: true, date, kind, brief: safeBrief(row) });
  } catch (e) {
    if (dbDown(res, e)) return;
    // Any other fault is still the same 404: a 500 would tell a stranger the code
    // got past the check. The reason goes to the server log only, never the code.
    console.error("[public/morning-brief] read failed:", String((e && e.message) || e).slice(0, 200));
    return notFound();
  }
}
