// Exact read-only saved-result judges for display controls. Browser contracts
// prove the click. This lane proves the named durable result, or says it is not proved.

import catalog from "../catalog/generated.json" with { type: "json" };
import { retiredControlFor, retiredControlState } from "./fin-b01-retired-controls.mjs";
import { NOT_SHIPPED_CODE, judgeNotShipped, verifyNotShipped } from "./fin-b06-not-shipped.mjs";
import { LIVE_PAGE_JUDGES } from "./fin-b07-leads-page.mjs";
import { leadsResetResults } from "./fin-b09-leads-reset.mjs";
import { judgeLinkGate, linkGateState } from "./fin-b10-link-gate.mjs";
import { HIDDEN_HEAD_CODE, judgeHiddenHeads, verifyHiddenHead } from "./fin-b19-hidden-head.mjs";
import { ownerRemovedFor, ownerRemovedResults, ownerRemovedState } from "./fin-b21-owner-removed.mjs";
import { countRealFunding, noRealFundingNa } from "../real-funding.mjs";

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
const SQL_READ_BATCH_SIZE = 20;

function result(id, status, detail, suggestedFix = null, na = undefined) {
  return { id, status, detail, suggestedFix, ...(na ? { na } : {}) };
}

// realFunding: { total } from countRealFunding, read once per run, or null when it was not read.
export function judgeDisplayResult(entry, stats = null, realFunding = null) {
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
  if (entry.contract.mode === "link-gate") return judgeLinkGate(entry, stats);
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
  // A read that leaves files on owner hold out (src/pulse/owner-hold.mjs) says so on its green line.
  const held = typeof entry.contract.heldNote === "string" && entry.contract.heldNote ? ` ${entry.contract.heldNote}` : "";
  if (samples === 0 && entry.contract.emptyAs === "quiet") {
    // A control nobody has used yet leaves nothing to judge. It is green until the first wrong result,
    // and it says so in plain words (owner-set 2026-10-14: deep checks that wait for the first real result).
    return result(entry.id, "PASS", `${entry.control}: no saved results yet, so none are wrong. This check goes red on the first wrong result. ${entry.contract.requirement}${held}`);
  }
  if (samples === 0 && entry.contract.emptyAs === "no-real-funding") {
    // Owner fact 2026-10-20: there are zero real funding rounds. With no real round, receipt or bank
    // decision there is nothing to judge, and the morning audit re-counts before this may stand
    // (na-conditions.mjs "no-real-funding-round"). Real work with no receipt here stays red below.
    if (!realFunding || !Number.isFinite(Number(realFunding.total))) {
      return result(entry.id, "skip", `${entry.control} was not read: the count of real funding rounds could not be read.`);
    }
    if (Number(realFunding.total) === 0) {
      return result(entry.id, "na", `${entry.control}: no real funding round exists yet, so there is nothing to judge. Test rounds are not judged.`, null, noRealFundingNa(entry.orgId));
    }
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
    return result(entry.id, "PASS", `${entry.control}: ${samples} saved result${samples === 1 ? "" : "s"} passed the exact check. ${entry.contract.requirement}${held}`);
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
async function retiredControlResults(ctx, trackingCases = DISPLAY_TRACKING_CASES) {
  const retiredCache = new Map();
  const out = new Map();
  await Promise.all(trackingCases.map(async (entry) => {
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

// A live-page contract: GET the page once (no body, redirects not followed, 5 second limit) and hand what
// came back to its judge. A read that cannot be made is skip with the reason, never PASS.
async function livePageRow(entry, ctx = {}, readPage = livePageReader(ctx)) {
  const judge = LIVE_PAGE_JUDGES[entry.contract.page];
  if (!judge) return skipped(entry, "no judge is named for this live page");
  const path = judge.path(ctx.registry);
  if (!path) return skipped(entry, "the registry does not name exactly one page for it");
  const read = await readPage(path);
  if (read.error) return skipped(entry, read.error);
  return judge.judge(entry, { status: read.status, html: read.html, robotsHeader: read.robotsHeader || "" });
}

// One GET of a live page for fin-b09-leads-reset.mjs: no body, redirects not followed, 5 second limit.
// Never throws. Answers { status, html } or { error }.
function livePageReader(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  return async (path) => {
    if (typeof fetchImpl !== "function") return { error: "this run has no GET client" };
    let origin;
    try {
      origin = new URL(ctx.baseUrl || "https://fundhub.ai").origin;
    } catch {
      return { error: "the base address is not a web address" };
    }
    try {
      const response = await fetchImpl(`${origin}${path}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
      const status = Number(response?.status);
      return { status, html: status === 200 ? await response.text() : "", robotsHeader: response.headers?.get?.("x-robots-tag") || "" };
    } catch (error) {
      return { error: String(error?.message || error).replace(/\s+/g, " ").slice(0, 120) };
    }
  };
}

// One GET of a live file for fin-b21-owner-removed.mjs: { get, base }. get(path) never throws and answers
// { ok: true, text } or { ok: false, why }. It is null when this run has no GET client.
function liveFileReader(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  let base = null;
  try { base = new URL(ctx.baseUrl || "https://fundhub.ai").origin; } catch { base = null; }
  if (typeof fetchImpl !== "function") return { get: null, base };
  const get = async (path) => {
    const url = new URL(path, base).href;
    try {
      const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(5000) });
      if (response.status !== 200) return { ok: false, why: `${url} answered ${response.status}` };
      return { ok: true, text: String(await response.text()) };
    } catch (error) {
      return { ok: false, why: `${url} could not be read: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 120)}` };
    }
  };
  return { get, base };
}

export async function gapChecks(ctx = {}, runtime = null) {
  // Batch branches compile their changed proof registry in memory and exercise this exact lane without
  // rewriting generated.json. Integration regenerates the shared catalog once after all batches merge.
  const trackingCases = runtime?.displayTrackingCases || DISPLAY_TRACKING_CASES;
  const resultCases = runtime?.displayResultCases || DISPLAY_RESULT_CASES;
  const sqlBatches = runtime
    ? [...new Set(resultCases.filter((entry) => entry.contract.mode === "query").map((entry) => entry.contract.sql))]
    : SQL_BATCHES;
  // The reset control and the live-page contract inspect the same private page.
  // Share the result within this one run so both judge the same response after one GET.
  const fetchLivePage = livePageReader(ctx);
  const livePageReads = new Map();
  const readLivePage = (path) => {
    if (!livePageReads.has(path)) livePageReads.set(path, fetchLivePage(path));
    return livePageReads.get(path);
  };
  // Two GETs (the deployed shell and the deployed Client Control Panel) serve every link-gate contract: the
  // shell is RUN against the page's own links, once per staff role, because the live file is what decides
  // what a person sees. Started first so it overlaps the retired-page reads below; linkGateState never throws.
  const gateRead = trackingCases.some((entry) => entry.contract?.mode === "link-gate") ? linkGateState(ctx) : null;
  // One live read for all controls on this retired page, even without a DB.
  const retired = trackingCases.some((entry) => entry.retired) ? await retiredPageState(ctx) : null;
  const retiredControls = await retiredControlResults(ctx, trackingCases);
  // A control the live page does not carry is read from the live page, not from a table (fin-b06-not-shipped.mjs).
  const notShipped = await judgeNotShipped(trackingCases, ctx);
  // The Reset button on the private lead list is read from the live page (fin-b09-leads-reset.mjs).
  const leadsReset = await leadsResetResults(trackingCases, readLivePage, ctx.registry);
  // A sidebar head that no role is shown is read from the live shared chrome, not from a table (fin-b19-hidden-head.mjs).
  const hiddenHeads = await judgeHiddenHeads(trackingCases, ctx);
  // Controls the owner took off the phone on purpose (fin-b21-owner-removed.mjs): read live, GET only.
  const removed = await ownerRemovedResults(trackingCases, liveFileReader(ctx));
  const gate = gateRead ? await gateRead : null;
  let realFunding = null;
  const judge = (entry, stats) => {
    if (retiredControls.has(entry.id)) return retiredControls.get(entry.id);
    if (notShipped.has(entry.id)) return notShipped.get(entry.id);
    if (leadsReset.has(entry.id)) return leadsReset.get(entry.id);
    if (hiddenHeads.has(entry.id)) return hiddenHeads.get(entry.id);
    if (removed.has(entry.id)) return removed.get(entry.id);
    if (entry.contract?.mode === "link-gate") return judgeLinkGate(entry, gate);
    if (!entry.retired || retired?.status === "na") return judgeDisplayResult({ ...entry, orgId: ctx.orgId }, stats, realFunding);
    return result(entry.id, retired.status, `${entry.control}: ${retired.detail}`,
      retired.status === "FAIL" ? "Restore the retired-page redirect and active menu. Do not auto-fix. Chris fixes reds." : null);
  };
  // One GET per live-page contract, with or without a database (the page is read over the web).
  const pages = new Map();
  for (const entry of trackingCases) {
    if (entry.contract?.mode === "live-page") pages.set(entry.id, await livePageRow(entry, ctx, readLivePage));
  }
  const run = reader(ctx);
  if (!run) {
    return trackingCases.map((entry) => {
      if (pages.has(entry.id)) return pages.get(entry.id);
      return entry.contract?.mode === "query" ? skipped(entry, "no database in this run") : judge(entry);
    });
  }

  const bySql = new Map();
  for (let start = 0; start < sqlBatches.length; start += SQL_READ_BATCH_SIZE) {
    const batch = sqlBatches.slice(start, start + SQL_READ_BATCH_SIZE);
    const query = batch.map((sql, index) =>
      `SELECT ${index}::int AS probe_index, sample_count, bad_count FROM (${sql}) AS result`
    ).join("\nUNION ALL\n");
    try {
      const answer = await run((db) => db.query(query, [ctx.orgId || null]));
      const indexed = new Map((answer?.rows || []).map((row) => [Number(row.probe_index), row]));
      if (indexed.size !== batch.length || batch.some((_, index) => !indexed.has(index))) {
        throw new Error("a grouped display read returned fewer results than requested");
      }
      batch.forEach((sql, index) => bySql.set(sql, indexed.get(index)));
    } catch (error) {
      batch.forEach((sql) => bySql.set(sql, { error }));
    }
  }

  // One read of how much REAL funding work exists, only when a funding contract has nothing saved.
  const needsRealFunding = trackingCases.some((entry) => entry.contract?.emptyAs === "no-real-funding"
    && Number(bySql.get(entry.contract.sql)?.sample_count || 0) === 0 && !bySql.get(entry.contract.sql)?.error);
  if (needsRealFunding) {
    try {
      realFunding = await run((db) => countRealFunding(async (text, params) => (await db.query(text, params)).rows, ctx.orgId));
    } catch {
      realFunding = null;
    }
  }

  return trackingCases.map((entry) => {
    if (pages.has(entry.id)) return pages.get(entry.id);
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
  "catalog-display-owner-removed": async (args, ctx = {}) => {
    const control = ownerRemovedFor(args);
    if (!control) return false;
    const entry = DISPLAY_TRACKING_CASES.find((item) => item.sourceFile === args.sourceFile
      && item.surface === args.surface && item.control === args.control);
    if (!entry) return false;
    return (await ownerRemovedState(control, liveFileReader(ctx))).status === "na";
  },
  "catalog-display-retired-autopsy": async (args, ctx = {}) => {
    const entry = DISPLAY_TRACKING_CASES.find((item) => item.retired
      && item.sourceFile === args?.sourceFile && item.surface === args?.surface && item.control === args?.control);
    if (!entry) return false;
    return (await retiredPageState(ctx)).status === "na";
  },
  [NOT_SHIPPED_CODE]: (args, ctx = {}) => verifyNotShipped(DISPLAY_TRACKING_CASES, args, ctx),
  [HIDDEN_HEAD_CODE]: (args, ctx = {}) => verifyHiddenHead(DISPLAY_TRACKING_CASES, args, ctx),
});
