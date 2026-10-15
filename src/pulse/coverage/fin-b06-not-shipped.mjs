// A screen control that a journey lists but the live page does not carry (batch 06, owner order 2026-10-14).
//
// The climate lead-magnet journey (docs/journeys/climate-lead-magnet-intended.md) lists a button, "See how many
// banks in our book fit your state", that scrolls to a four-answers form. The page that ships at /climate/ is the
// lending-climate dashboard. It has no such button and no form, and nothing it loads reaches the lead door.
// A scroll saves nothing, so there is no saved result to read. The honest answer is "nothing to judge", and
// "nothing to judge" is only allowed when the computer can check it again. This file is that check:
//
//   - It reads the LIVE page with one GET (redirects are not followed), then everything the page leads to on
//     the same site (GET only): script tags, preloaded modules, iframe pages, dynamic import() targets, static
//     imports, workers, and any script or page path named in a string (a chunk map, a Next build payload).
//     It follows what it finds, a few levels deep, under one cap.
//   - It looks for the control's words and for the lead door it would call in what it read, AFTER undoing the
//     easy ways to hide a word: tags between the words, entities, escapes, "a" + "b", "a".concat("b"),
//     ["a","b"].join(" "), atob("..."), String.fromCharCode(...). Letter case and runs of spaces do not matter.
//   - Neither found, and every file read: the control is not on the live page. The row says "na" with the
//     code below, and the morning audit asks this file again before it lets "na" stand.
//   - Found anywhere: the control ships now. The claim is false. The row goes back to NOT_PROVED, which is
//     where it was, and a person attaches a real check for the scroll and the form.
//   - Anything could not be read (no GET client, bad address, non-200, a file that failed, more files than the
//     cap): the row is "skip" with the reason. Absence is never claimed from a partial read.
//
// What this cannot see, said plainly: words that are built at run time from pieces that are not literals in any
// file (a value from an API, a template with computed parts, a character table). A page that does that can ship
// the button and this read will not find it. The lead form's SAVED result is judged separately by the
// climate-lead-saved live check, so a form that works still shows up there the first time someone files a lead.
//
// READ ONLY. GET only. Nothing is written, sent, or called except the public page and its own files.
// This file imports nothing and reads no repo file at run time, so it is safe inside the live bundle.

export const NOT_SHIPPED_CODE = "catalog-display-control-not-shipped";

const READ_TIMEOUT_MS = 4000;
// The whole read gets one budget, so a slow site cannot eat the lane's step (Netlify cuts a step at 26 seconds).
const TOTAL_BUDGET_MS = 8000;
const MAX_FILES = 40;
const MAX_DEPTH = 5;

const isText = (value) => typeof value === "string" && value.trim() !== "";
const isPath = (value) => isText(value) && value.startsWith("/") && !value.startsWith("//");

const squash = (text) => String(text).toLowerCase().replace(/\s+/g, " ");

/** The claim a display contract carries in `contract.notShipped`: the live page(s), and the words and doors that must be absent. */
export function shipClaim(entry) {
  const claim = entry?.contract?.notShipped;
  if (!claim || !isPath(claim.path)) return null;
  if (!Array.isArray(claim.markers) || claim.markers.length === 0 || !claim.markers.every(isText)) return null;
  const paths = claim.paths === undefined ? [] : claim.paths;
  if (!Array.isArray(paths) || !paths.every(isPath)) return null;
  return {
    path: claim.path,
    paths: [...new Set([claim.path, ...paths])],
    markers: claim.markers.map(String)
  };
}

function unread(reason) {
  return { state: "unread", reason, found: [], scripts: 0 };
}

// ── undoing the easy ways to hide a word ────────────────────────────────────────────────────────────

function safeChar(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripTags(html, glue) {
  return String(html).replace(/<[^>]*>/g, glue);
}

function unescapeJs(text) {
  return String(text)
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'`/\\])/g, "$1");
}

const LITERAL = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

function arrayJoins(text) {
  return text.replace(/\[([^[\]]*)\]\s*\.join\(\s*(["'`])((?:(?!\2)[^\\\n]|\\.)*)\2\s*\)/g, (whole, body, _q, sep) => {
    const parts = [];
    const rest = body.replace(LITERAL, (_m, _quote, inner) => { parts.push(inner); return ""; });
    if (parts.length === 0 || rest.replace(/[\s,]/g, "") !== "") return whole;
    return `"${parts.join(sep)}"`;
  });
}

/** Join literals that are put together in code: "a" + "b", "a".concat("b"), ["a","b"].join(" "), atob(...), fromCharCode(...). */
function joinLiterals(text) {
  let out = String(text);
  for (let pass = 0; pass < 6; pass += 1) {
    const next = arrayJoins(out)
      .replace(/(["'`])\s*\+\s*(["'`])/g, "")
      .replace(/(["'`])\s*\.concat\(\s*(["'`])/g, "")
      .replace(/atob\(\s*(["'`])([A-Za-z0-9+/=]+)\1\s*\)/g, (whole, _q, b64) => {
        try { return `"${Buffer.from(b64, "base64").toString("utf8")}"`; } catch { return whole; }
      })
      .replace(/String\.fromCharCode\(\s*((?:\d+\s*,\s*)*\d+)\s*\)/g, (_whole, list) =>
        `"${list.split(",").map((n) => safeChar(Number(n))).join("")}"`);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Every reading of a file worth searching: raw, tags stripped (two ways), and code with its literals joined. */
function readings(body) {
  const raw = String(body);
  const textual = decodeEntities(stripTags(raw, ""));
  const spaced = decodeEntities(stripTags(raw, " "));
  const code = joinLiterals(unescapeJs(decodeEntities(raw)));
  return [raw, textual, spaced, code, joinLiterals(unescapeJs(textual))];
}

function carries(reads, marker) {
  const flat = squash(marker);
  return reads.some((text) => squash(text).includes(flat));
}

// ── following what the page leads to ────────────────────────────────────────────────────────────────

const SCRIPT_FILE = /\.(?:m?js|html?)(?:[?#].*)?$/i;

/** Same-site files this document leads to. `required` means a failed read must stop the claim, not be skipped. */
function leadsTo(body, docUrl, nextRoots) {
  const out = new Map();
  const add = (raw, required, { bare = false } = {}) => {
    const value = String(raw || "").trim();
    if (!value || /^(?:data|blob|javascript|mailto|tel):/i.test(value)) return;
    const relative = /^(?:\/|\.\.?\/|[a-z][a-z0-9+.-]*:)/i.test(value);
    if (!relative && !bare) return;
    const candidates = [];
    // "static/chunks/x.js" is relative to the build's own _next/ folder, not to the page that names it.
    const underBuild = bare && !relative && /^static\//.test(value) && nextRoots.size > 0;
    if (!underBuild) {
      try { candidates.push(new URL(value, docUrl)); } catch { return; }
    }
    if (bare && !relative) {
      for (const root of nextRoots) {
        try { candidates.push(new URL(value, root)); } catch { /* skip */ }
      }
    }
    for (const url of candidates) {
      if (url.origin !== docUrl.origin) continue;
      url.hash = "";
      const prior = out.get(url.href);
      out.set(url.href, prior === undefined ? required : prior || required);
    }
  };

  const html = String(body);
  // Where this build keeps its files: any "…/_next/" path the document names ("static/chunks/x.js" is under it).
  for (const hit of html.matchAll(/["'(=]\s*((?:https?:\/\/[^/"'\s]+)?(?:\/[A-Za-z0-9._~-]+)*\/_next\/)/g)) {
    try { nextRoots.add(new URL(hit[1], docUrl).href); } catch { /* not a path */ }
  }
  for (const tag of html.match(/<(?:script|link|iframe|frame|embed|object)\b[^>]*>/gi) || []) {
    const name = /^<([a-z]+)/i.exec(tag)[1].toLowerCase();
    const attr = (key) => {
      const hit = new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
      return hit ? (hit[1] ?? hit[2]) : null;
    };
    if (name === "link") {
      const rel = (attr("rel") || "").toLowerCase();
      const as = (attr("as") || "").toLowerCase();
      if (rel.includes("modulepreload") || (rel.includes("preload") && as === "script")) add(attr("href"), true);
    } else if (name === "object") {
      add(attr("data"), true);
    } else {
      add(attr("src"), true);
    }
  }

  const code = unescapeJs(decodeEntities(html));
  for (const hit of code.matchAll(/\bimport\s*\(\s*(["'`])([^"'`\n]{1,300})\1/g)) add(hit[2], true);
  for (const hit of code.matchAll(/\b(?:import|export)\b[^"'`;]{0,200}?\bfrom\s*(["'`])([^"'`\n]{1,300})\1/g)) add(hit[2], true);
  for (const hit of code.matchAll(/\bimport\s*(["'`])([^"'`\n]{1,300})\1/g)) add(hit[2], true);
  for (const hit of code.matchAll(/\b(?:importScripts|new\s+(?:Shared)?Worker)\s*\(\s*(["'`])([^"'`\n]{1,300})\1/g)) add(hit[2], true);
  // Any string that names a script or a page of this site. Speculative: a file that is not there is not a failure.
  for (const hit of code.matchAll(/(["'`])([A-Za-z0-9_@./~+%-][^"'`\s<>]{0,240}?\.(?:m?js|html?)(?:\?[^"'`\s<>]*)?)\1/g)) {
    if (SCRIPT_FILE.test(hit[2])) add(hit[2], false, { bare: true });
  }
  // A webpack chunk map: { 117: "92e5c7d1…", … } next to "static/chunks/". Ids and hashes make the file names.
  if (/static\/chunks\//.test(code)) {
    for (const map of code.matchAll(/\{((?:\s*\d+\s*:\s*"[0-9a-f]{6,}"\s*,?)+)\}/g)) {
      for (const pair of map[1].matchAll(/(\d+)\s*:\s*"([0-9a-f]{6,})"/g)) {
        add(`static/chunks/${pair[1]}-${pair[2]}.js`, false, { bare: true });
        add(`static/chunks/${pair[1]}.${pair[2]}.js`, false, { bare: true });
      }
    }
  }
  return out;
}

/**
 * Read the live page(s) and what they lead to, once.
 * Returns { state: "absent" | "present" | "unread", found, scripts, reason? }.
 * ctx follows the lane's own pattern: ctx.fetchImpl (own property, may be null) and ctx.baseUrl.
 */
export async function readShipState(claim, ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx || {}, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return unread("this run has no GET client");
  let origin;
  try {
    origin = new URL((ctx && ctx.baseUrl) || "https://fundhub.ai").origin;
  } catch {
    return unread("the base address is not a web address");
  }
  const paths = claim.paths && claim.paths.length ? claim.paths : [claim.path];
  let pages;
  try {
    pages = paths.map((p) => new URL(p, origin));
  } catch {
    return unread("the base address is not a web address");
  }
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const get = (url) => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("the read ran out of time");
    return fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(Math.min(READ_TIMEOUT_MS, left)) });
  };

  try {
    const seen = new Set();
    const nextRoots = new Set();
    const reads = [];
    let fetched = 0;
    let level = pages.map((url) => ({ url, required: true, page: true }));
    for (const item of level) seen.add(item.url.href);

    for (let depth = 0; level.length && depth <= MAX_DEPTH; depth += 1) {
      // A file the page really loads must be read: too many of those is "not read", never "absent".
      // A path that was only guessed from a string (speculative) fills what room is left and is otherwise dropped.
      const must = level.filter((item) => item.required);
      if (fetched + must.length > MAX_FILES) {
        return unread(`the page leads to more than ${MAX_FILES} files and only ${MAX_FILES} are read`);
      }
      const room = MAX_FILES - fetched - must.length;
      level = [...must, ...level.filter((item) => !item.required).slice(0, room)];
      fetched += level.length;
      const answers = await Promise.all(level.map(async (item) => {
        const res = await get(item.url.href);
        if (res.status !== 200) {
          if (!item.required && (res.status === 404 || res.status === 410)) return null;
          throw new Error(item.page
            ? `the live page answered ${res.status}`
            : `a file the page leads to answered ${res.status}`);
        }
        const body = await res.text();
        if (item.page && !/<html[\s>]/i.test(body)) throw new Error("the live page did not come back as a web page");
        return { item, body };
      }));

      const next = [];
      for (const answer of answers) {
        if (!answer) continue;
        reads.push(...readings(answer.body));
        const rootAt = answer.item.url.pathname.indexOf("/_next/");
        if (rootAt >= 0) nextRoots.add(`${answer.item.url.origin}${answer.item.url.pathname.slice(0, rootAt + "/_next/".length)}`);
        for (const [href, required] of leadsTo(answer.body, answer.item.url, nextRoots)) {
          if (seen.has(href)) continue;
          seen.add(href);
          next.push({ url: new URL(href), required, page: false });
        }
      }
      level = next;
    }

    const found = claim.markers.filter((marker) => carries(reads, marker));
    return { state: found.length ? "present" : "absent", found, scripts: Math.max(0, fetched - pages.length) };
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
      detail: `${entry.control}: this control is not on the live page. ${claim.path} opens, and neither the page nor the ${read.scripts} file${read.scripts === 1 ? "" : "s"} it leads to carry it or the door it would call. Judged the day it goes live.`,
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

/** One live read per distinct page set, then one result row per control that carries a claim. Map of entry id to row. */
export async function judgeNotShipped(entries, ctx = {}) {
  const out = new Map();
  const reads = new Map();
  for (const entry of entries) {
    const claim = shipClaim(entry);
    if (!claim) continue;
    const key = JSON.stringify([claim.paths, claim.markers]);
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
