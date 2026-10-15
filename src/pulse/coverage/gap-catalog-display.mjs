// Exact read-only saved-result judges for display controls. Browser contracts
// prove the click. This lane proves the named durable result, or says it is not proved.

import catalog from "../catalog/generated.json" with { type: "json" };
import { retiredControlFor, retiredControlState } from "./fin-b01-retired-controls.mjs";
import { NOT_SHIPPED_CODE, judgeNotShipped, verifyNotShipped } from "./fin-b06-not-shipped.mjs";

// Compiled from the approved map and proof recipes at build time. Proof recipe
// modules may read the checkout, so the live lane imports only their saved data.
export const DISPLAY_RESULT_CASES = Object.freeze(catalog.displayResultCases);
export const DISPLAY_TRACKING_CASES = Object.freeze(catalog.displayTrackingCases);

export const CHECK_IDS = Object.freeze(DISPLAY_TRACKING_CASES.map((entry) => entry.id));
export const PASS_CAPABLE_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "query").length;
export const UNMEASURED_CONTRACT_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "always-red").length;
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

// Controls the map lists that the product no longer has (fin-b01-retired-controls.mjs). Each is read
// live, GET only. It is "nothing to judge" only while the live files still hold none of it.
async function retiredControlResults(ctx) {
  const retiredCache = new Map();
  const out = new Map();
  await Promise.all(DISPLAY_TRACKING_CASES.map(async (entry) => {
    const control = retiredControlFor(entry);
    if (!control) return;
    const state = await retiredControlState(control, { ...ctx, retiredCache });
    // "pass" is a control that is only half retired: the live half is read here too (see the record).
    if (state.status === "pass") {
      out.set(entry.id, result(entry.id, "PASS", state.detail));
      return;
    }
    out.set(entry.id, state.status === "na"
      ? result(entry.id, "na", state.detail, null, {
        code: "catalog-display-retired-control",
        args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control },
      })
      : result(entry.id, state.status, state.detail, state.status === "FAIL"
        ? "Open the named control and attach a real check to it, or take it out again. Do not auto-fix. Chris fixes reds."
        : null));
  }));
  return out;
}

export async function gapChecks(ctx = {}) {
  // One live read for all controls on this retired page, even without a DB.
  const retired = DISPLAY_TRACKING_CASES.some((entry) => entry.retired) ? await retiredPageState(ctx) : null;
  const retiredControls = await retiredControlResults(ctx);
  // A control the live page does not carry is read from the live page, not from a table (fin-b06-not-shipped.mjs).
  const notShipped = await judgeNotShipped(DISPLAY_TRACKING_CASES, ctx);
  const judge = (entry, stats) => {
    if (retiredControls.has(entry.id)) return retiredControls.get(entry.id);
    if (notShipped.has(entry.id)) return notShipped.get(entry.id);
    if (!entry.retired || retired?.status === "na") return judgeDisplayResult(entry, stats);
    return result(entry.id, retired.status, `${entry.control}: ${retired.detail}`,
      retired.status === "FAIL" ? "Restore the retired-page redirect and active menu. Do not auto-fix. Chris fixes reds." : null);
  };
  const run = reader(ctx);
  if (!run) {
    return DISPLAY_TRACKING_CASES.map((entry) => (
      entry.contract?.mode === "query" ? skipped(entry, "no database in this run") : judge(entry)
    ));
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
    if (entry.contract?.mode !== "query") return judge(entry);
    const stats = bySql.get(entry.contract.sql);
    if (stats?.error) return skipped(entry, stats.error);
    return judge(entry, stats);
  });
}

export const naVerify = Object.freeze({
  "catalog-display-retired-control": async (args, ctx = {}) => {
    const control = retiredControlFor(args);
    if (!control) return false;
    const entry = DISPLAY_TRACKING_CASES.find((item) => item.sourceFile === args.sourceFile
      && item.surface === args.surface && item.control === args.control);
    if (!entry) return false;
    return (await retiredControlState(control, ctx)).status === "na";
  },
  "catalog-display-retired-autopsy": async (args, ctx = {}) => {
    const entry = DISPLAY_TRACKING_CASES.find((item) => item.retired
      && item.sourceFile === args?.sourceFile && item.surface === args?.surface && item.control === args?.control);
    if (!entry) return false;
    return (await retiredPageState(ctx)).status === "na";
  },
  [NOT_SHIPPED_CODE]: (args, ctx = {}) => verifyNotShipped(DISPLAY_TRACKING_CASES, args, ctx),
});
