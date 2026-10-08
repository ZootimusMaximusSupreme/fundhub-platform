// Closer desk, Present, and closer context. Read only.
// One tripwire. Do not add another watcher. Do not start a call.
//
// slice-27-closer.mjs already names the registry doors (closer dashboard,
// Present, closer-deck, call-outcomes). slice-20-sales.mjs already names
// s-offer-bucket. This file does not repeat those. It does not watch
// bookings or recordings.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const CHECK_IDS = Object.freeze(["closer:held-disposition"]);

const TRIP =
  "Present log_disposition is the one tripwire. It writes the call_outcomes row. " +
  "fetchContext reads that row. Do not start a call. Do not auto-fix.";

const DOORS = [
  "/app/closer-dashboard.html",
  "/app/closer-dashboard",
  "/app/present.html",
  "/app/present"
];

/** Disposition saved, call_outcomes row missing. fetchContext recent_calls would be empty. */
export const DISPOSITION_SQL = `
  /* gap:closer-held-disposition */
  SELECT count(*)::int AS n
    FROM clients c
   WHERE c.org_id = $1::uuid
     AND COALESCE(c.is_demo, false) = false
     AND (
       (
         jsonb_typeof(c.custom_fields->'closer_deck_disposition') = 'object'
         AND (
           COALESCE(c.custom_fields->'closer_deck_disposition'->>'offer_key', '') <> ''
           OR COALESCE(c.custom_fields->'closer_deck_disposition'->>'route', '') <> ''
           OR COALESCE(c.custom_fields->'closer_deck_disposition'->>'at', '') <> ''
         )
       )
       OR EXISTS (
         SELECT 1
           FROM events e
          WHERE e.org_id = c.org_id
            AND e.client_id = c.id
            AND e.name = 'call.completed'
            AND e.payload->>'disposition' = 'closer'
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM call_outcomes o
        WHERE o.org_id = c.org_id
          AND o.client_id = c.id
     )
`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function tryRead(readText, rel) {
  try {
    return { text: String(readText(rel) ?? ""), error: null };
  } catch (err) {
    return {
      text: "",
      error: `${rel} missing (${String(err?.message || err).slice(0, 120)})`
    };
  }
}

function arrayBlock(src, name) {
  const m = String(src).match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`));
  return m ? m[1] : "";
}

function homeBlock(src) {
  const m = String(src).match(/var HOME = \{([\s\S]*?)\};/);
  return m ? m[1] : "";
}

function redirectBlocks(toml) {
  return String(toml).split("[[redirects]]").slice(1).map((part) => part.split(/\n\[\[/)[0]);
}

function tomlField(block, key) {
  const m = block.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"));
  return m ? m[1] : "";
}

function redirectHits(from, door) {
  if (!from || !door) return false;
  if (from === door) return true;
  if (from.endsWith("*")) {
    const prefix = from.slice(0, -1);
    return prefix.length > 0 && door.startsWith(prefix);
  }
  return false;
}

function stolenDoors(toml) {
  const stolen = [];
  for (const block of redirectBlocks(toml)) {
    const from = tomlField(block, "from");
    const to = tomlField(block, "to");
    if (!from || !to) continue;
    for (const door of DOORS) {
      if (!redirectHits(from, door)) continue;
      if (to === door || to === `${door}/`) continue;
      if (!stolen.includes(door)) stolen.push(door);
    }
  }
  return stolen;
}

function publishIsPublic(toml) {
  return /publish\s*=\s*"public"/.test(String(toml));
}

/**
 * Page routes for Closer Dashboard and Present. Reads files. No HTTP.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function closerDeskRouteReport(readText = defaultReadText) {
  const reasons = [];
  const dash = tryRead(readText, "public/app/closer-dashboard.html");
  const present = tryRead(readText, "public/app/present.html");
  const presentJs = tryRead(readText, "public/app/present.js");
  const shell = tryRead(readText, "public/app/shell.js");
  const toml = tryRead(readText, "netlify.toml");

  if (dash.error) reasons.push(dash.error);
  else if (!/src=["']shell\.js["']/.test(dash.text)) {
    reasons.push("closer-dashboard.html does not load shell.js");
  }

  if (shell.error) reasons.push(shell.error);
  else {
    const all = arrayBlock(shell.text, "ALL");
    if (!all.includes('"closer-dashboard.html"')) {
      reasons.push("shell.js ALL does not include closer-dashboard.html");
    }
    if (!/closer:\s*"closer-dashboard\.html"/.test(homeBlock(shell.text))) {
      reasons.push("shell.js home for closer is not closer-dashboard.html");
    }
  }

  if (present.error) reasons.push(present.error);
  else {
    if (!/src=["']present\.js["']/.test(present.text)) {
      reasons.push("present.html does not load present.js");
    }
    if (/src=["']shell\.js["']/.test(present.text)) {
      reasons.push("present.html loads shell.js, so the deck bounces");
    }
  }

  if (presentJs.error) reasons.push(presentJs.error);
  else if (!/log_disposition/.test(presentJs.text) || !/\/api\/closer-deck/.test(presentJs.text)) {
    reasons.push("present.js does not post log_disposition to /api/closer-deck");
  }

  if (toml.error) reasons.push(toml.error);
  else {
    if (!publishIsPublic(toml.text)) reasons.push("netlify publish is not public");
    const stolen = stolenDoors(toml.text);
    if (stolen.length) reasons.push(`a redirect steals ${stolen.join(", ")}`);
  }

  return { ok: reasons.length === 0, reasons };
}

function dispositionDetail(n) {
  return `${plural(n, "held call")} saved a closer disposition and call_outcomes has no row, so fetchContext has no recent call.`;
}

function compose({ route, count, error }) {
  const id = CHECK_IDS[0];
  const dead = route.ok ? "" : `Closer Dashboard or Present page route is dead (${route.reasons.join("; ")}).`;
  if (!route.ok && count == null && !error) {
    return row(id, "FAIL", dead, TRIP);
  }
  if (error && !route.ok) {
    return row(id, "FAIL", `${dead} Could not read dispositions: ${error}`, TRIP);
  }
  if (error) {
    return row(id, "FAIL", `could not read dispositions: ${error}`, TRIP);
  }
  if (count == null) {
    return row(
      id,
      "skip",
      "Closer Dashboard and Present are wired. No database in this run — dispositions not read."
    );
  }
  if (!route.ok && count > 0) {
    return row(id, "FAIL", `${dead} ${dispositionDetail(count)}`, TRIP);
  }
  if (!route.ok) {
    return row(id, "FAIL", dead, TRIP);
  }
  if (count === 0) {
    return row(
      id,
      "PASS",
      "Closer Dashboard and Present are wired, and no held call has a closer disposition without a call_outcomes row."
    );
  }
  return row(id, "FAIL", dispositionDetail(count), TRIP);
}

/**
 * One read-only tripwire. ctx: { db, orgId, readText }.
 * The row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  const route = closerDeskRouteReport(readText);
  if (!db || !orgId) return [compose({ route, count: null, error: null })];
  try {
    const result = await db.query(DISPOSITION_SQL, [orgId]);
    return [compose({ route, count: countOf(result), error: null })];
  } catch (err) {
    return [compose({
      route,
      count: null,
      error: String(err?.message || err).slice(0, 180)
    })];
  }
}
