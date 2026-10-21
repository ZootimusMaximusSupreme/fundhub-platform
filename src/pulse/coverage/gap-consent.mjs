// Consent capture — one tripwire for the morning pulse.
// Read only. It never records consent and it never starts another monitor.
//
// The morning pulse already pings the consent page and the consent API
// (reg:consent-capture and reg:consent/capture in the registry). This file does
// not ping the API again. It reads the page body once, to see that the page
// still talks to the capture API, and it reads the database for the four ways
// a consent goes missing.
//
// It does NOT look at files on disk. The pulse runs inside the deployed
// function, where public/ and api/ are not there to read.

// ONE JUDGE, TWO CLOCKS (2026-10-20). The four database readings, their SQL and their verdicts
// live in src/pulse/beats/lib/consent-truth.mjs, so this morning lane and the hourly beat
// consent-capture run the same code. The page read (it needs a fetch) and the registry check stay here.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  PAGE_FIX, REQUIRED_FIX, STORE_FIX, SLO_FIX, DISPUTE_FIX, check, clip, consentDbChecks
} from "../beats/lib/consent-truth.mjs";

export {
  SOFT_PULL_KIND,
  PAID_GRACE_HOURS,
  STORE_GRACE_HOURS,
  SLO_LOOKBACK_DAYS,
  DISPUTE_GRACE_DAYS,
  TEST_CLIENT_EMAIL_RE,
  REQUIRED_SQL,
  STORE_SQL,
  SLO_STORE_SQL,
  DISPUTE_SQL,
  READ_ONLY_SQL,
  assertSelect
} from "../beats/lib/consent-truth.mjs";

export const CONSENT_PAGE_PATH = "/app/consent-capture.html";
export const CONSENT_API_PATH = "/api/consent/capture";
export const CHECK_IDS = Object.freeze([
  "consent:page",
  "consent:required",
  "consent:store",
  "consent:slo-store",
  "consent:dispute-required"
]);

/** Page: any 2xx. API: also 400, 401, 403, 405 (a bare GET is refused on purpose). */
export function doorUp(kind, status) {
  const n = Number(status);
  if (!Number.isInteger(n)) return false;
  if (kind === "page") return n >= 200 && n < 300;
  return (n >= 200 && n < 300) || n === 400 || n === 401 || n === 403 || n === 405;
}

/* Not read by the morning run: registry.test.mjs already fails when a door is
   missing from the list. Kept because the test file proves it from here too. */
export function consentDoorsListed(registry = PULSE_REGISTRY) {
  const keys = new Set((registry || []).map((row) => coverageKey(row)));
  return keys.has("consent-capture.html") && keys.has("consent/capture");
}

/**
 * GET the consent page once. The API door itself is the registry's job.
 * What this adds: a 200 that is not the capture page (or a page that no longer
 * calls the capture API) is a dead page the plain ping calls up.
 */
async function pageRow(ctx) {
  const id = "consent:page";
  const fetchImpl = ctx.fetchImpl || ctx.fetch;
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "No fetch was passed in, so the consent page was not read.");
  }
  const origin = String(ctx.baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  const url = `${origin}${CONSENT_PAGE_PATH}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(15000)
    });
    const status = res && res.status;
    if (!doorUp("page", status)) {
      return check(id, "FAIL", `${CONSENT_PAGE_PATH} answered ${status}.`, PAGE_FIX);
    }
    const text = res && typeof res.text === "function" ? String(await res.text()) : "";
    if (!text.includes(CONSENT_API_PATH)) {
      return check(
        id,
        "FAIL",
        `${CONSENT_PAGE_PATH} answered ${status} but does not call ${CONSENT_API_PATH}.`,
        PAGE_FIX
      );
    }
    return check(id, "PASS", `${CONSENT_PAGE_PATH} answered ${status} and calls the capture API.`);
  } catch (err) {
    return check(id, "FAIL", `${CONSENT_PAGE_PATH} unreachable: ${clip(err && err.message)}`, PAGE_FIX);
  }
}

/**
 * Consent capture gap. One tripwire, five readings.
 * @param {object} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  try {
    const page = await pageRow(ctx);
    const rows = await consentDbChecks(ctx);
    return [page, ...rows];
  } catch (err) {
    const detail = `Consent check stopped: ${clip(err && err.message)}`;
    return [
      check("consent:page", "FAIL", detail, PAGE_FIX),
      check("consent:required", "FAIL", detail, REQUIRED_FIX),
      check("consent:store", "FAIL", detail, STORE_FIX),
      check("consent:slo-store", "FAIL", detail, SLO_FIX),
      check("consent:dispute-required", "FAIL", detail, DISPUTE_FIX)
    ];
  }
}
