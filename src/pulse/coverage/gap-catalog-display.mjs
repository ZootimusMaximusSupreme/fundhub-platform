// Exact read-only saved-result judges for display controls. Browser contracts
// prove the click. This lane proves the named durable result, or says it is not proved.

import catalog from "../catalog/generated.json" with { type: "json" };
import { LIVE_PAGE_JUDGES } from "./fin-b07-leads-page.mjs";

// Compiled from the approved map and proof recipes at build time. Proof recipe
// modules may read the checkout, so the live lane imports only their saved data.
export const DISPLAY_RESULT_CASES = Object.freeze(catalog.displayResultCases);
export const DISPLAY_TRACKING_CASES = Object.freeze(catalog.displayTrackingCases);

export const CHECK_IDS = Object.freeze(DISPLAY_TRACKING_CASES.map((entry) => entry.id));
export const PASS_CAPABLE_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "query").length;
export const UNMEASURED_CONTRACT_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "always-red").length;
// A "live-page" contract has no SQL. The lane GETs the live page once and judges its shape.
export const LIVE_PAGE_CONTRACT_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "live-page").length;
export const SQL_BATCHES = Object.freeze([
  ...new Set(DISPLAY_RESULT_CASES
    .filter((entry) => entry.contract.mode === "query")
    .map((entry) => entry.contract.sql)),
]);

function result(id, status, detail, suggestedFix = null, na = undefined) {
  return { id, status, detail, suggestedFix, ...(na ? { na } : {}) };
}

export function judgeDisplayResult(entry, stats = null) {
  if (entry.retired) {
    return result(entry.id, "na", `${entry.control}: the Decline Autopsy page is retired and redirected to the active offer menu.`, null, {
      code: "catalog-display-retired-autopsy",
      args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control },
    });
  }
  if (!entry.contract) {
    return result(
      entry.id,
      "NOT_PROVED",
      `${entry.surface} — ${entry.control}: no exact safe action/result contract is attached yet.`,
      `Add a receipt that links this exact control's input to its saved result, then let the read-only pulse judge it.`,
    );
  }
  if (entry.contract.mode === "always-red") {
    return result(
      entry.id,
      "NOT_PROVED",
      `${entry.surface} — ${entry.control}: ${entry.contract.requirement}`,
      `Add the missing exact input-to-result receipt for this control, then let the read-only pulse judge it.`,
    );
  }

  if (entry.contract.mode === "live-page") {
    // gapChecks judges these from the live page. A bare call here has no page to read.
    return result(entry.id, "skip", `${entry.control} was not read: it is judged from the live page.`);
  }

  const samples = Number(stats?.sample_count || 0);
  const bad = Number(stats?.bad_count || 0);
  if (samples === 0 && entry.contract.emptyAs === "quiet") {
    // A control nobody has used yet leaves nothing to judge. It is green until the first wrong result,
    // and it says so in plain words (owner-set 2026-10-14: deep checks that wait for the first real result).
    return result(entry.id, "PASS", `${entry.control}: no saved results yet, so none are wrong. This check goes red on the first wrong result. ${entry.contract.requirement}`);
  }
  if (samples === 0) {
    return result(
      entry.id,
      "FAIL",
      `${entry.control}: no saved receipt or linked result exists for this exact check. Required: ${entry.contract.requirement}`,
      `Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.`,
    );
  }
  if (bad === 0) {
    return result(entry.id, "PASS", `${entry.control}: ${samples} saved result${samples === 1 ? "" : "s"} passed the exact check. ${entry.contract.requirement}`);
  }
  return result(
    entry.id,
    "FAIL",
    `${entry.control}: ${bad} of ${samples} saved result${samples === 1 ? "" : "s"} failed the exact check. Required: ${entry.contract.requirement}`,
    `Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds.`,
  );
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

function skipped(entry, error) {
  const message = String(error?.message || error || "unknown read error").replace(/\s+/g, " ").slice(0, 160);
  return result(entry.id, "skip", `${entry.control} was not read: ${message}.`);
}

async function retiredPageState(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return { status: "FAIL", detail: "the live retired-page redirect could not be proved because this run has no GET client." };
  try {
    const base = new URL(ctx.baseUrl || "https://fundhub.ai").origin;
    const oldUrl = `${base}/partner/autopsy/`;
    const menuUrl = `${base}/partner/menu/`;
    const response = await fetchImpl(oldUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    const location = response.headers.get("location");
    if (response.status !== 302 || !location || new URL(location, oldUrl).href !== menuUrl) {
      return { status: "FAIL", detail: "the live Decline Autopsy page does not redirect to the active offer menu with the expected temporary redirect." };
    }
    const menu = await fetchImpl(menuUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (menu.status !== 200) return { status: "FAIL", detail: "the retired page redirects, but the active offer menu does not open." };
    const html = await menu.text();
    if (!/<h1\b[^>]*>\s*Four Ways In\. You Can Start Anywhere\.\s*<\/h1>/i.test(html)
      || !/<a\b[^>]*href=["']\/partner\/["']/i.test(html)) {
      return { status: "FAIL", detail: "the retired page redirects, but its destination is not the active offer menu." };
    }
    return { status: "na", detail: "the live retired page redirects to the active offer menu, and that menu opens." };
  } catch (error) {
    return { status: "FAIL", detail: `the live retired-page redirect could not be proved by GET: ${String(error?.message || error).slice(0, 120)}.` };
  }
}

// A live-page contract: GET the page once (no body, redirects not followed, 5 second limit) and hand what
// came back to its judge. A read that cannot be made is skip with the reason, never PASS.
async function livePageRow(entry, ctx = {}) {
  const judge = LIVE_PAGE_JUDGES[entry.contract.page];
  if (!judge) return skipped(entry, "no judge is named for this live page");
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return skipped(entry, "this run has no GET client");
  const path = judge.path(ctx.registry);
  if (!path) return skipped(entry, "the registry does not name exactly one page for it");
  let origin;
  try {
    origin = new URL(ctx.baseUrl || "https://fundhub.ai").origin;
  } catch {
    return skipped(entry, "the base address is not a web address");
  }
  try {
    const response = await fetchImpl(`${origin}${path}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    const status = Number(response?.status);
    const html = status === 200 ? await response.text() : "";
    return judge.judge(entry, { status, html, robotsHeader: response.headers?.get?.("x-robots-tag") || "" });
  } catch (error) {
    return skipped(entry, error);
  }
}

export async function gapChecks(ctx = {}) {
  // One live read for all controls on this retired page, even without a DB.
  const retired = DISPLAY_TRACKING_CASES.some((entry) => entry.retired) ? await retiredPageState(ctx) : null;
  const judge = (entry, stats) => {
    if (!entry.retired || retired?.status === "na") return judgeDisplayResult(entry, stats);
    return result(entry.id, retired.status, `${entry.control}: ${retired.detail}`,
      retired.status === "FAIL" ? "Restore the retired-page redirect and active menu. Do not auto-fix. Chris fixes reds." : null);
  };
  // One GET per live-page contract, with or without a database (the page is read over the web).
  const pages = new Map();
  for (const entry of DISPLAY_TRACKING_CASES) {
    if (entry.contract?.mode === "live-page") pages.set(entry.id, await livePageRow(entry, ctx));
  }
  const run = reader(ctx);
  if (!run) {
    return DISPLAY_TRACKING_CASES.map((entry) => {
      if (pages.has(entry.id)) return pages.get(entry.id);
      return entry.contract?.mode === "query" ? skipped(entry, "no database in this run") : judge(entry);
    });
  }

  const bySql = new Map();
  for (const sql of SQL_BATCHES) {
    try {
      const answer = await run((db) => db.query(sql, [ctx.orgId || null]));
      bySql.set(sql, answer?.rows?.[0] || { sample_count: 0, bad_count: 0 });
    } catch (error) {
      bySql.set(sql, { error });
    }
  }

  return DISPLAY_TRACKING_CASES.map((entry) => {
    if (pages.has(entry.id)) return pages.get(entry.id);
    if (entry.contract?.mode !== "query") return judge(entry);
    const stats = bySql.get(entry.contract.sql);
    if (stats?.error) return skipped(entry, stats.error);
    return judge(entry, stats);
  });
}

export const naVerify = Object.freeze({
  "catalog-display-retired-autopsy": async (args, ctx = {}) => {
    const entry = DISPLAY_TRACKING_CASES.find((item) => item.retired
      && item.sourceFile === args?.sourceFile && item.surface === args?.surface && item.control === args?.control);
    if (!entry) return false;
    return (await retiredPageState(ctx)).status === "na";
  },
});
