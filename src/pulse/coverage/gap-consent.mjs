// Consent capture — one tripwire for the morning pulse.
// Read only. It never records consent and it never starts another monitor.
// The morning pulse already pings the consent page and the consent API.
// This file reads that ping when the caller passes it. It does not ping the
// whole site, and it does not call the site unless the caller hands in fetch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const CONSENT_PAGE_PATH = "/app/consent-capture.html";
export const CONSENT_API_PATH = "/api/consent/capture";
export const SOFT_PULL_KIND = "soft_pull_consent";
export const CHECK_IDS = Object.freeze([
  "consent:doors",
  "consent:required",
  "consent:store"
]);

const PAGE_FILE = path.join(ROOT, "public/app/consent-capture.html");
const HANDLER_FILE = path.join(ROOT, "api/consent/capture.mjs");
const ROUTES_FILE = path.join(ROOT, "netlify/functions/api.mjs");

const DOOR_FIX =
  "Restore the consent page or the consent capture API. Do not record consent for a real person from this check. Do not auto-fix.";
const REQUIRED_FIX =
  "A client who paid for a credit report has no live written permission. Use the consent page with that client before any credit pull. Do not record consent for a real person from this check. Do not auto-fix.";
const STORE_FIX =
  "A signed soft-pull paper has no stored consent row. Store it only through the existing capture path after a real yes. Do not record consent for a real person from this check. Do not auto-fix.";

/* Same population as needs_consent in src/fulfillment/read-signals.mjs.
   Paid for the report, credit not already in, no fraud chip ahead of consent,
   and no live soft-pull consent. The validity predicate is the one in
   src/consent/index.mjs — not a second copy. */
export const REQUIRED_SQL = `
SELECT count(*)::int AS n
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND ($2::boolean OR COALESCE(c.is_demo, false) = false)
   AND c.custom_fields->>'crs_paid' = 'true'
   AND TRIM(c.custom_fields->>'crs_status') IS DISTINCT FROM 'Complete'
   AND NOT EXISTS (
     SELECT 1 FROM crs_results cr
      WHERE cr.client_id = c.id
        AND cr.org_id = c.org_id
        AND COALESCE(cr.is_demo, false) = false)
   AND NOT (
     'fraud:alert-present' = ANY(COALESCE(c.tags, ARRAY[]::text[]))
     OR TRIM(COALESCE(c.custom_fields->>'round_hold_reason', '')) = 'Fraud Alert'
     OR EXISTS (
       SELECT 1 FROM inquiry_removal_cases irc
        WHERE irc.client_id = c.id
          AND irc.org_id = c.org_id
          AND NULLIF(TRIM(COALESCE(irc.fraud_alert_after, '')), '') IS NOT NULL))
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.client_id = c.id
        AND cc.org_id = c.org_id
        AND cc.kind = $3
        AND (${CONSENT_VALID_SQL}))`;

/* A signed soft-pull paper whose consent row never landed.
   A later withdrawal is not a failed store: the handler is supposed to refuse
   that replay. A missing signed PDF is a failed store — the paper path
   refuses to write a row when signed_document_id is null. */
export const STORE_SQL = `
SELECT count(*)::int AS n
  FROM contracts ct
  JOIN clients c ON c.id = ct.client_id AND c.org_id = ct.org_id
 WHERE ct.org_id = $1::uuid
   AND ($2::boolean OR COALESCE(ct.is_demo, false) = false)
   AND ($2::boolean OR COALESCE(c.is_demo, false) = false)
   AND ct.status = 'signed'
   AND lower(trim(ct.kind)) = 'authorization'
   AND lower(trim(ct.subtype)) = 'soft_pull_consent'
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.org_id = ct.org_id
        AND cc.client_id = ct.client_id
        AND cc.kind = 'soft_pull_consent'
        AND cc.revoked_at IS NOT NULL
        AND ct.signed_at IS NOT NULL
        AND cc.revoked_at >= ct.signed_at)
   AND (
     ct.signed_document_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM client_consents cc
        WHERE cc.org_id = ct.org_id
          AND cc.document_id = ct.signed_document_id))`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

export function doorUp(kind, status) {
  const n = Number(status);
  if (!Number.isInteger(n)) return false;
  if (kind === "page") return n >= 200 && n < 300;
  return (n >= 200 && n < 300) || n === 400 || n === 401 || n === 403 || n === 405;
}

export function consentDoorsListed(registry = PULSE_REGISTRY) {
  const keys = new Set((registry || []).map((row) => coverageKey(row)));
  return keys.has("consent-capture.html") && keys.has("consent/capture");
}

function assertSelect(sql) {
  const s = String(sql || "").trim();
  if (!/^select\b/i.test(s) || /\b(insert|update|delete|drop|alter|truncate)\b/i.test(s)) {
    throw new Error("consent gap check refused a write");
  }
}

function readBuild(ctx) {
  if (ctx.build && typeof ctx.build === "object") {
    return {
      page: ctx.build.page !== false,
      api: ctx.build.api !== false,
      registry: ctx.build.registry !== false
    };
  }
  let api = false;
  try {
    api = fs.existsSync(HANDLER_FILE)
      && fs.readFileSync(ROUTES_FILE, "utf8").includes('"consent/capture"');
  } catch {
    api = false;
  }
  return {
    page: fs.existsSync(PAGE_FILE),
    api,
    registry: consentDoorsListed(ctx.registry || PULSE_REGISTRY)
  };
}

function readDoorValue(value, kind) {
  if (typeof value === "number") {
    return { known: true, up: doorUp(kind, value), detail: `${kind === "page" ? CONSENT_PAGE_PATH : CONSENT_API_PATH} ${value}` };
  }
  if (!value || typeof value !== "object") return { known: false };
  if (typeof value.up === "boolean") {
    return { known: true, up: value.up, detail: clip(value.detail || (value.up ? "up" : "down")) };
  }
  const label = String(value.status ?? "");
  if (label === "up" || label === "PASS") {
    return { known: true, up: true, detail: clip(value.detail || label) };
  }
  if (label === "down" || label === "FAIL") {
    return { known: true, up: false, detail: clip(value.detail || label) };
  }
  if (typeof value.status === "number" || typeof value.httpStatus === "number") {
    const n = value.httpStatus ?? value.status;
    const pathName = kind === "page" ? CONSENT_PAGE_PATH : CONSENT_API_PATH;
    return { known: true, up: doorUp(kind, n), detail: `${pathName} ${n}` };
  }
  return { known: false };
}

function liveFromRegistry(rows) {
  if (!Array.isArray(rows)) return null;
  const page = rows.find((row) => row && (
    row.path === CONSENT_PAGE_PATH
    || row.id === "reg:consent-capture"
    || row.id === "consent-capture"
  ));
  const api = rows.find((row) => row && (
    row.path === CONSENT_API_PATH
    || String(row.path || "").startsWith("/api/consent/capture")
    || row.id === "reg:consent/capture"
    || row.id === "consent/capture"
  ));
  if (!page && !api) return null;
  return {
    page: page ? readDoorValue(page, "page") : { known: false },
    api: api ? readDoorValue(api, "api") : { known: false }
  };
}

function liveFromDoors(doors) {
  if (!doors || typeof doors !== "object" || Array.isArray(doors)) return null;
  return {
    page: readDoorValue(doors.page, "page"),
    api: readDoorValue(doors.api, "api")
  };
}

async function probe(fetchImpl, baseUrl) {
  const origin = String(baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  const out = {};
  for (const [kind, pathName] of [["page", CONSENT_PAGE_PATH], ["api", CONSENT_API_PATH]]) {
    const url = `${origin}${pathName}`;
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { accept: kind === "page" ? "text/html" : "application/json" },
        signal: AbortSignal.timeout(15000)
      });
      const status = res && res.status;
      out[kind] = {
        known: true,
        up: doorUp(kind, status),
        detail: `${pathName} ${status}`
      };
    } catch (err) {
      out[kind] = {
        known: true,
        up: false,
        detail: `${pathName} unreachable: ${clip(err && err.message)}`
      };
    }
  }
  return out;
}

async function liveReading(ctx, buildOk) {
  const fromDoors = liveFromDoors(ctx.doors);
  if (fromDoors) return fromDoors;
  const fromRegistry = liveFromRegistry(ctx.registryChecks);
  if (fromRegistry) return fromRegistry;
  if (!buildOk) return null;
  const fetchImpl = ctx.fetchImpl || ctx.fetch;
  if (typeof fetchImpl !== "function") return null;
  return probe(fetchImpl, ctx.baseUrl);
}

function doorRow(build, live) {
  const problems = [];
  if (!build.page) problems.push("Consent page file public/app/consent-capture.html is missing.");
  if (!build.api) problems.push("Consent API route consent/capture is missing.");
  if (!build.registry) problems.push("Consent page or API is missing from the morning pulse list.");
  if (live) {
    if (live.page && live.page.known && !live.page.up) problems.push(live.page.detail);
    if (live.api && live.api.known && !live.api.up) problems.push(live.api.detail);
  }
  if (problems.length) return check("consent:doors", "FAIL", problems.join(" "), DOOR_FIX);
  const pageKnown = !!(live && live.page && live.page.known);
  const apiKnown = !!(live && live.api && live.api.known);
  if (!pageKnown || !apiKnown) {
    return check(
      "consent:doors",
      "skip",
      "Consent page file, API route, and morning pulse list are in place. No live ping was passed in, so the site was not called."
    );
  }
  return check(
    "consent:doors",
    "PASS",
    `Consent page and API are up. ${live.page.detail}. ${live.api.detail}.`
  );
}

function orgIdOf(ctx) {
  const id = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  return UUID_RE.test(id) ? id : "";
}

function canQuery(ctx) {
  return typeof ctx.scope === "function" || !!(ctx.db && typeof ctx.db.query === "function");
}

async function readCount(ctx, sql, params) {
  assertSelect(sql);
  if (typeof ctx.scope === "function") return ctx.scope((tx) => tx.query(sql, params));
  return ctx.db.query(sql, params);
}

function countRow(id, result, passDetail, failDetail, failFix, skipDetail) {
  if (result.skip) return check(id, "skip", skipDetail);
  if (result.fail) return check(id, "FAIL", result.fail, failFix);
  if (result.n > 0) return check(id, "FAIL", failDetail(result.n), failFix);
  return check(id, "PASS", passDetail);
}

async function countReading(ctx, sql, params) {
  try {
    const res = await readCount(ctx, sql, params);
    const n = Number(res && res.rows && res.rows[0] && res.rows[0].n);
    if (!Number.isFinite(n)) return { fail: "The consent read did not return a count." };
    return { n };
  } catch (err) {
    return { fail: `Could not read consent rows: ${clip(err && err.message)}` };
  }
}

/**
 * Consent capture gap. One tripwire, three readings.
 * @param {object} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  try {
    const build = readBuild(ctx);
    const buildOk = build.page && build.api && build.registry;
    const live = await liveReading(ctx, buildOk);
    const doors = doorRow(build, live);

    const orgId = orgIdOf(ctx);
    const demoOn = ctx.demoOn === true;
    let required;
    let store;
    if (!canQuery(ctx)) {
      required = { skip: true };
      store = { skip: true };
    } else if (!orgId) {
      required = { skip: true };
      store = { skip: true };
    } else {
      [required, store] = await Promise.all([
        countReading(ctx, REQUIRED_SQL, [orgId, demoOn, SOFT_PULL_KIND]),
        countReading(ctx, STORE_SQL, [orgId, demoOn])
      ]);
    }

    const noDb = "No database was passed in, so consent rows were not read.";
    const noOrg = "No company was passed in, so consent rows were not read.";
    const skipDetail = canQuery(ctx) && !orgId ? noOrg : noDb;

    return [
      doors,
      countRow(
        "consent:required",
        required,
        "No paid client is missing live soft-pull consent.",
        (n) => `${n} ${n === 1 ? "client" : "clients"} paid for a credit report and ${n === 1 ? "has" : "have"} no live soft-pull consent.`,
        REQUIRED_FIX,
        skipDetail
      ),
      countRow(
        "consent:store",
        store,
        "No signed soft-pull paper is missing its consent row.",
        (n) => `${n} signed soft-pull ${n === 1 ? "paper has" : "papers have"} no consent row.`,
        STORE_FIX,
        skipDetail
      )
    ];
  } catch (err) {
    const detail = `Consent check stopped: ${clip(err && err.message)}`;
    return [
      check("consent:doors", "FAIL", detail, DOOR_FIX),
      check("consent:required", "FAIL", detail, REQUIRED_FIX),
      check("consent:store", "FAIL", detail, STORE_FIX)
    ];
  }
}
