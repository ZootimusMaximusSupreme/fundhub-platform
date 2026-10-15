// A screen control that a journey lists but the live page does not carry (batch 06, owner order 2026-10-14).
//
// The climate lead-magnet journey (docs/journeys/climate-lead-magnet-intended.md) lists a button, "See how many
// banks in our book fit your state", that scrolls to a four-answers form. The page that ships at /climate/ is the
// lending-climate dashboard. It has no such button and no form, and nothing it loads reaches the lead door.
// A scroll saves nothing, so there is no saved result to read. The honest answer is "nothing to judge", and
// "nothing to judge" is only allowed when the computer can check it again. This file is that check:
//
//   - It reads the LIVE page with one GET (redirects are not followed), then the page's own scripts (same
//     site only, GET only), and looks for the control's words and for the lead door it would call.
//   - Neither found, and every file read: the control is not on the live page. The row says "na" with the
//     code below, and the morning audit asks this file again before it lets "na" stand.
//   - Found in the page or in a script: the control ships now. The claim is false. The row goes back to
//     NOT_PROVED, which is where it was, and a person attaches a real check for the scroll and the form.
//   - Anything could not be read (no GET client, bad address, non-200, a script that failed, more scripts
//     than the cap): the row is "skip" with the reason. Absence is never claimed from a partial read.
//
// READ ONLY. GET only. Nothing is written, sent, or called except the public page and its own scripts.
// This file imports nothing and reads no repo file at run time, so it is safe inside the live bundle.

export const NOT_SHIPPED_CODE = "catalog-display-control-not-shipped";

const READ_TIMEOUT_MS = 4000;
const MAX_SCRIPTS = 12;

const isText = (value) => typeof value === "string" && value.trim() !== "";

function squash(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ");
}

/** The claim a display contract carries in `contract.notShipped`: the live page, and the words and doors that must be absent. */
export function shipClaim(entry) {
  const claim = entry?.contract?.notShipped;
  if (!claim || !isText(claim.path) || !claim.path.startsWith("/") || claim.path.startsWith("//")) return null;
  if (!Array.isArray(claim.markers) || claim.markers.length === 0 || !claim.markers.every(isText)) return null;
  return { path: claim.path, markers: claim.markers.map(String) };
}

function unread(reason) {
  return { state: "unread", reason, found: [], scripts: 0 };
}

/** Same-site script files the page asks for, in order, without repeats. Other sites are not read. */
function scriptUrls(html, pageUrl) {
  const seen = new Set();
  const out = [];
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isScript = /^<script/i.test(tag);
    const ref = isScript
      ? /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
      : (/\bas\s*=\s*["']?script["']?/i.test(tag) || /\brel\s*=\s*["']?modulepreload["']?/i.test(tag))
        ? /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
        : null;
    const raw = ref && (ref[1] ?? ref[2]);
    if (!isText(raw)) continue;
    let url;
    try { url = new URL(raw, pageUrl); } catch { continue; }
    if (url.origin !== pageUrl.origin) continue;
    url.hash = "";
    if (!seen.has(url.href)) {
      seen.add(url.href);
      out.push(url.href);
    }
  }
  return out;
}

/**
 * Read the live page and its own scripts once.
 * Returns { state: "absent" | "present" | "unread", found, scripts, reason? }.
 * ctx follows the lane's own pattern: ctx.fetchImpl (own property, may be null) and ctx.baseUrl.
 */
export async function readShipState(claim, ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx || {}, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return unread("this run has no GET client");
  let pageUrl;
  try {
    pageUrl = new URL(claim.path, new URL((ctx && ctx.baseUrl) || "https://fundhub.ai").origin);
  } catch {
    return unread("the base address is not a web address");
  }
  const get = (url) => fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  try {
    const page = await get(pageUrl.href);
    if (page.status !== 200) return unread(`the live page answered ${page.status}`);
    const html = await page.text();
    if (!/<html[\s>]/i.test(html)) return unread("the live page did not come back as a web page");
    const files = scriptUrls(html, pageUrl);
    if (files.length > MAX_SCRIPTS) return unread(`the page loads ${files.length} scripts and only ${MAX_SCRIPTS} are read`);
    const bodies = await Promise.all(files.map(async (url) => {
      const res = await get(url);
      if (res.status !== 200) throw new Error(`a page script answered ${res.status}`);
      return res.text();
    }));
    const hay = squash([html, ...bodies].join("\n"));
    const found = claim.markers.filter((marker) => hay.includes(squash(marker)));
    return { state: found.length ? "present" : "absent", found, scripts: files.length };
  } catch (error) {
    return unread(String(error?.message || error).replace(/\s+/g, " ").slice(0, 120));
  }
}

function resultRow(entry, claim, read) {
  const label = `${entry.surface} — ${entry.control}`;
  if (read.state === "absent") {
    return {
      id: entry.id,
      status: "na",
      detail: `${entry.control}: this control is not on the live page. ${claim.path} opens, and neither the page nor its ${read.scripts} own script${read.scripts === 1 ? "" : "s"} carry it or the door it would call. Judged the day it goes live.`,
      suggestedFix: null,
      na: { code: NOT_SHIPPED_CODE, args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control } },
    };
  }
  if (read.state === "present") {
    return {
      id: entry.id,
      status: "NOT_PROVED",
      detail: `${label}: the live page carries this control now (found ${read.found.map((m) => JSON.stringify(m)).join(", ")}). No check yet judges where it leads or what it saves.`,
      suggestedFix: "Take the not-shipped claim off this control and attach a check on the saved result it leads to. Do not auto-fix. Chris fixes reds.",
    };
  }
  return {
    id: entry.id,
    status: "skip",
    detail: `${entry.control} was not read: ${read.reason}.`,
    suggestedFix: null,
  };
}

/** One live read per distinct page, then one result row per control that carries a claim. Map of entry id to row. */
export async function judgeNotShipped(entries, ctx = {}) {
  const out = new Map();
  const reads = new Map();
  for (const entry of entries) {
    const claim = shipClaim(entry);
    if (!claim) continue;
    const key = JSON.stringify([claim.path, claim.markers]);
    if (!reads.has(key)) reads.set(key, readShipState(claim, ctx));
    out.set(entry.id, resultRow(entry, claim, await reads.get(key)));
  }
  return out;
}

/** The morning audit's question: is this control STILL not on the live page? True only when every file was read and none carries it. */
export async function verifyNotShipped(entries, args, ctx = {}) {
  const entry = entries.find((item) => shipClaim(item)
    && item.sourceFile === args?.sourceFile && item.surface === args?.surface && item.control === args?.control);
  if (!entry) return false;
  return (await readShipState(shipClaim(entry), ctx)).state === "absent";
}
