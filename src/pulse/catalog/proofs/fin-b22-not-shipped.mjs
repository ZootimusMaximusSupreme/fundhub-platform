// Finish-853 batch 22, generation 3: Flow rows whose named control or words are not on the live site.
//
// Seven Flow rows name something a visitor or an operator should see on a page. The live page does not carry it.
// Nothing is saved by a control that is not there, so there is no saved result to read, and a check of "the
// page still lacks it" can only say "absent". "Nothing to judge" is only allowed when the computer can check it
// again every run. This file is that check:
//
//   journey:climate-lead-magnet-intended#1-headline-button   the "See how many banks..." headline and its button
//   journey:climate-lead-magnet-intended#3-state-click       the state card with its plain sentence
//   journey:climate-lead-magnet-intended#4-form              the four answers and the lead door they post to
//   journey:climate-lead-magnet-intended#6-gate              the $32 Business Financial Assessment gate
//       The visitor page these four steps describe was reverted by the owner on 2026-09-18 (f39cec357). The page
//       that ships at /climate/ is the lending-climate dashboard. docs/tracking/page-inventory.md lists the visitor
//       page as "spec and mock only, not deployed".
//   journey:fh-consulting-intended#2-education-only          "education for business operations, not a lender"
//   journey:fh-consulting-intended#3-three-prices            three posted prices
//       The owner rewrote /consulting/ as marketing consulting for agencies on 2026-10-05 (a9af08158, 159a537a2,
//       c66504716). The intended journey (2026-09-17) was not updated, and agents may not edit it.
//   message:ui:ops-admin outbound mail panel                 the alert-address field
//       The panel has three buttons. The row also names an alert-address field. No page has one (the alert address
//       is set only by posting alert_email to /api/messages-outbound). The three buttons are judged by their own
//       screen rows (e2e/ops-admin-outbound.spec.mjs), and the server action by its own door row.
//
// How a claim is judged (the same reader as batch 06's fin-b06-not-shipped.mjs, kept here so this branch stands
// alone):
//   - It reads the LIVE page with one GET (redirects are not followed), then everything the page leads to on the
//     same site (GET only): script tags, preloaded modules, iframe pages, dynamic import() targets, static
//     imports, workers, and any script or page path named in a string (a chunk map, a Next build payload).
//   - It looks for the step's words and doors in what it read, AFTER undoing the easy ways to hide a word: tags
//     between the words, entities, escapes, "a" + "b", "a".concat("b"), ["a","b"].join(" "), atob("..."),
//     String.fromCharCode(...). Letter case and runs of spaces do not matter.
//   - An ANCHOR is a word the page must carry for the read to count at all (the page is the one the claim is
//     about, not an error page or a login page that happens to answer 200).
//   - Anchors found, no marker found, every file read: "na", code catalog-flow-step-not-shipped. The morning
//     audit asks this file again before it lets "na" stand.
//   - A marker found: the page carries the step now. The claim is false and the row goes back to NOT_PROVED,
//     where it was; a person attaches a real check for what the step saves.
//   - A claim may also name the page's OWN IDENTITY (`identity`): the words its <title> must carry, and, with
//     `noControls`, that its page document holds no <form>, <input>, <textarea> or <select>. The four climate
//     steps are "nothing to judge" because the page that ships is the lending-climate DASHBOARD, which has a
//     title and no form. Words alone cannot say that: a rebuilt visitor page that words its headline, button or
//     gate a little differently carries none of the markers and would stay "na". So if the page that answers is
//     no longer that dashboard (a new title, or a form on it) the claim was written for a different page: the
//     row goes back to NOT_PROVED and the audit's question is false, whatever words the new page uses.
//   - Anything not read (no GET client, bad address, non-200, a file that failed, more files than the cap) or an
//     anchor missing: "skip" with the reason. Absence is never claimed from a partial read.
//
// What this cannot see, said plainly: words built at run time from pieces that are not literals in any file (a
// value from an API, a template with computed parts, a character table). A page that does that can ship the step
// and this read will not find it.
//
// READ ONLY. GET only. Nothing is written, sent, or called except the public pages and their own files.
// This file imports nothing and reads no repo file at run time, so it is safe inside the live bundle.

export const NOT_SHIPPED_CODE = "catalog-flow-step-not-shipped";

export const FIN_B22_NOT_SHIPPED_TEST = "src/pulse/catalog/proofs/fin-b22-not-shipped.test.mjs";
export const DEFAULT_BASE_URL = "https://fundhub.ai";

const READ_TIMEOUT_MS = 4000;
// One site read gets one budget, so a slow site cannot eat the lane's step (Netlify cuts a step at 26 seconds).
const TOTAL_BUDGET_MS = 8000;
const MAX_FILES = 40;
const MAX_DEPTH = 5;
const VERIFY_CACHE_MS = 30000;

const CLIMATE_PAGES = Object.freeze(["/climate/", "/climate/lender-climate/"]);
const CLIMATE_ANCHORS = Object.freeze(["/api/climate"]);
// What the page at /climate/ IS today (the owner's dashboard): its title, and no form of any kind on its document.
const CLIMATE_IDENTITY = Object.freeze({ title: "Lending Climate Dashboard", noControls: true });

/**
 * Every claim. `family` and `surface` are the Flow row's own (the row id is flow:<family>:<surface>).
 * `noun` is what the row's step names, in plain words, for the detail line.
 */
export const NOT_SHIPPED_CLAIMS = Object.freeze([
  Object.freeze({
    family: "journey",
    surface: "journey:climate-lead-magnet-intended#1-headline-button",
    noun: "the headline \"See how many banks in our book fit your state\" and its button",
    pages: CLIMATE_PAGES,
    anchors: CLIMATE_ANCHORS,
    identity: CLIMATE_IDENTITY,
    markers: Object.freeze(["See how many banks in our book fit your state", "Get your number"]),
    reason: "the visitor page was reverted by the owner on 2026-09-18; /climate/ is the lending-climate dashboard",
  }),
  Object.freeze({
    family: "journey",
    surface: "journey:climate-lead-magnet-intended#3-state-click",
    noun: "the state card with its name and its plain sentence (\"not a decision about you\")",
    pages: CLIMATE_PAGES,
    anchors: CLIMATE_ANCHORS,
    identity: CLIMATE_IDENTITY,
    markers: Object.freeze(["not a decision about you", "wider picture", "Pick a state"]),
    reason: "the visitor page was reverted by the owner on 2026-09-18; /climate/ is the lending-climate dashboard",
  }),
  Object.freeze({
    family: "journey",
    surface: "journey:climate-lead-magnet-intended#4-form",
    noun: "the four answers and contact form, and the lead door it posts to",
    pages: CLIMATE_PAGES,
    anchors: CLIMATE_ANCHORS,
    identity: CLIMATE_IDENTITY,
    markers: Object.freeze(["climate-match", "climate_match", "Show my number", "website:climate"]),
    reason: "the visitor page was reverted by the owner on 2026-09-18; no page calls the lead door",
  }),
  Object.freeze({
    family: "journey",
    surface: "journey:climate-lead-magnet-intended#6-gate",
    noun: "the $32 Business Financial Assessment gate and its button",
    pages: CLIMATE_PAGES,
    anchors: CLIMATE_ANCHORS,
    markers: Object.freeze([
      "Business Financial Assessment", "Get the full list", "more names are in the full list", "/api/public/optimize",
    ]),
    reason: "the visitor page was reverted by the owner on 2026-09-18; no page calls the checkout door",
  }),
  Object.freeze({
    family: "journey",
    surface: "journey:fh-consulting-intended#2-education-only",
    noun: "the words \"education for business operations\" and \"not a lender\"",
    pages: Object.freeze(["/consulting/"]),
    anchors: Object.freeze(["consult"]),
    markers: Object.freeze(["education for business operations", "education only", "not a lender"]),
    reason: "the owner rewrote /consulting/ as marketing consulting for agencies on 2026-10-05; the journey was not updated",
  }),
  Object.freeze({
    family: "journey",
    surface: "journey:fh-consulting-intended#3-three-prices",
    noun: "the three posted prices ($5,000, $5,000, $10,000) and the three program names",
    pages: Object.freeze(["/consulting/"]),
    anchors: Object.freeze(["consult"]),
    markers: Object.freeze([
      "$5,000", "$10,000", "Operations Foundations", "Operations Systems", "Operations Intensive",
    ]),
    reason: "the owner rewrote /consulting/ as marketing consulting for agencies on 2026-10-05; the journey was not updated",
  }),
  Object.freeze({
    family: "message",
    surface: "ui:ops-admin outbound mail panel",
    noun: "an alert-address field on the Outbound Mail panel",
    pages: Object.freeze(["/app/ops-admin.html"]),
    anchors: Object.freeze(["id=\"outboxCard\""]),
    markers: Object.freeze(["alert_email", "alertEmail", "alert-email", "alert address", "alert email"]),
    // The page's own scripts only. Its shell script names every other app page in a string, and those pages are
    // not this panel.
    speculative: false,
    reason: "the panel has three buttons and no alert-address field; the three buttons are judged by their own screen rows",
  }),
]);

export const FIN_B22_NOT_SHIPPED_SURFACES = Object.freeze(new Set(NOT_SHIPPED_CLAIMS.map((claim) => claim.surface)));

export const notShippedRowId = (claim) => `flow:${claim.family}:${claim.surface}`;

const isText = (value) => typeof value === "string" && value.trim() !== "";
const squash = (text) => String(text).toLowerCase().replace(/\s+/g, " ");

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
  // `tag` is an address the page's own markup loads (src, href, data). "shell.js" there is a plain relative
  // address, resolved against the page; the same word in a string is only a guess (`bare`).
  const add = (raw, required, { bare = false, tag = false } = {}) => {
    const value = String(raw || "").trim();
    if (!value || /^(?:data|blob|javascript|mailto|tel):/i.test(value)) return;
    const relative = tag || /^(?:\/|\.\.?\/|[a-z][a-z0-9+.-]*:)/i.test(value);
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
      if (rel.includes("modulepreload") || (rel.includes("preload") && as === "script")) add(attr("href"), true, { tag: true });
    } else if (name === "object") {
      add(attr("data"), true, { tag: true });
    } else {
      add(attr("src"), true, { tag: true });
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

function unread(reason) {
  return { state: "unread", reason, reads: [], files: 0 };
}

/** The GET client for a lane run: an own `fetchImpl`, else `fetch`, else none. Never the global one. */
function pickFetch(ctx) {
  if (ctx && typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (ctx && typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

/**
 * Read the live page(s) and what they lead to, once.
 * Returns { state: "read", reads, perPage, docs, files } or { state: "unread", reason }. `files` counts the files the
 * pages led to that answered (the pages themselves are not counted). `docs` is the page document of each named page.
 * `fetchImpl` is a GET client; `origin` is the site address. With `speculative: false` the read follows only the
 * files the page really loads (script tags, preloads, imports, frames), never a path that was only named in a
 * string. A staff page's shell script names every app page that way, and those are other pages: a word on one of
 * them says nothing about this page.
 */
export async function readSite(paths, { fetchImpl, origin, speculative = true }) {
  if (typeof fetchImpl !== "function") return unread("this run has no GET client");
  let base;
  let pages;
  try {
    base = new URL(origin || DEFAULT_BASE_URL).origin;
    pages = paths.map((p) => new URL(p, base));
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
    // What each file said, and which files each top-level page leads to (a file two pages share counts for both),
    // so a claim can ask that EVERY page it names is the page it knows, not only one of them.
    const byHref = new Map();
    const docs = pages.map(() => null);
    const filesOf = pages.map(() => new Set());
    let fetched = 0;
    let own = 0;
    let level = pages.map((url, root) => ({ url, required: true, page: true, root }));
    for (const item of level) {
      seen.add(item.url.href);
      filesOf[item.root].add(item.url.href);
    }

    for (let depth = 0; level.length && depth <= MAX_DEPTH; depth += 1) {
      // A file the page really loads must be read: too many of those is "not read", never "absent".
      // A path that was only guessed from a string (speculative) fills what room is left and is otherwise dropped.
      if (!speculative) level = level.filter((item) => item.required);
      const must = level.filter((item) => item.required);
      if (fetched + must.length > MAX_FILES) {
        return unread(`the page leads to more than ${MAX_FILES} files and only ${MAX_FILES} are read`);
      }
      const room = MAX_FILES - fetched - must.length;
      level = [...must, ...level.filter((item) => !item.required).slice(0, room)];
      fetched += level.length;
      const answers = await Promise.all(level.map(async (item) => {
        const res = await get(item.url.href);
        if (!res || res.status !== 200) {
          if (!item.required && res && (res.status === 404 || res.status === 410)) return null;
          throw new Error(item.page
            ? `the live page answered ${res ? res.status : "nothing"}`
            : `a file the page leads to answered ${res ? res.status : "nothing"}`);
        }
        const body = await res.text();
        if (item.page && !/<html[\s>]/i.test(body)) throw new Error("the live page did not come back as a web page");
        return { item, body };
      }));

      const next = [];
      for (const answer of answers) {
        if (!answer) continue;
        if (!answer.item.page) own += 1;
        else docs[answer.item.root] = String(answer.body);
        const said = readings(answer.body);
        reads.push(...said);
        byHref.set(answer.item.url.href, said);
        const rootAt = answer.item.url.pathname.indexOf("/_next/");
        if (rootAt >= 0) nextRoots.add(`${answer.item.url.origin}${answer.item.url.pathname.slice(0, rootAt + "/_next/".length)}`);
        for (const [href, required] of leadsTo(answer.body, answer.item.url, nextRoots)) {
          filesOf[answer.item.root].add(href);
          if (seen.has(href)) continue;
          seen.add(href);
          next.push({ url: new URL(href), required, page: false, root: answer.item.root });
        }
      }
      level = next;
    }
    const perPage = filesOf.map((files) => [...files].flatMap((href) => byHref.get(href) || []));
    return { state: "read", reads, perPage, docs, files: own };
  } catch (error) {
    return unread(String(error?.message || error).replace(/\s+/g, " ").slice(0, 120));
  }
}

const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const CONTROLS = /<(?:form|input|textarea|select)\b/i;

/** Why the page that answered is not the page this claim was written against, or null when it is. */
function identityProblem(claim, site) {
  const identity = claim.identity;
  if (!identity) return null;
  const docs = Array.isArray(site.docs) ? site.docs : [];
  for (let i = 0; i < claim.pages.length; i += 1) {
    const doc = docs[i];
    if (typeof doc !== "string") return `${claim.pages[i]} was not read as a page`;
    if (identity.title) {
      const title = TITLE.exec(doc);
      const text = title ? squash(decodeEntities(stripTags(title[1], ""))) : "";
      if (!text.includes(squash(identity.title))) {
        return `${claim.pages[i]} is no longer titled ${JSON.stringify(identity.title)} (it says ${JSON.stringify(text.slice(0, 80))})`;
      }
    }
    if (identity.noControls && CONTROLS.test(doc)) {
      return `${claim.pages[i]} now holds a form or an input, and the page this step was written against had none`;
    }
  }
  return null;
}

/**
 * Judge one claim against one site read.
 * Returns { state: "absent" | "present" | "changed" | "unread", found, reason? }. "changed" is a page that is no
 * longer the page the claim was written against (its identity), so "absent" cannot be said of it.
 */
export function judgeClaim(claim, site) {
  if (!site || site.state !== "read") return { state: "unread", found: [], reason: site?.reason || "the page was not read" };
  // Every page the claim names must carry the anchors: one page that is the page we know does not vouch for
  // another that answered with something else.
  const pageReads = Array.isArray(site.perPage) && site.perPage.length ? site.perPage : [site.reads];
  const missing = claim.anchors.filter((anchor) => !pageReads.every((reads) => carries(reads, anchor)));
  if (missing.length) {
    return {
      state: "unread",
      found: [],
      reason: `the page that answered does not carry ${missing.map((m) => JSON.stringify(m)).join(" and ")}, so it is not the page this claim is about`,
    };
  }
  const found = claim.markers.filter((marker) => carries(site.reads, marker));
  if (found.length) return { state: "present", found };
  const moved = identityProblem(claim, site);
  if (moved) return { state: "changed", found: [], reason: moved };
  return { state: "absent", found: [] };
}

function rowFor(claim, verdict, site) {
  const id = notShippedRowId(claim);
  if (verdict.state === "absent") {
    return {
      id,
      status: "na",
      detail: `${claim.surface}: this step names ${claim.noun}, and the live page does not carry it. `
        + `${claim.pages.join(" and ")} opens, and neither the page nor the ${site.files} `
        + `file${site.files === 1 ? "" : "s"} it leads to carry it. `
        + `Why: ${claim.reason}. Judged the day it is on the page.`,
      suggestedFix: null,
      na: { code: NOT_SHIPPED_CODE, args: { family: claim.family, surface: claim.surface } },
    };
  }
  if (verdict.state === "present") {
    return {
      id,
      status: "NOT_PROVED",
      detail: `${claim.surface}: the live page carries this step now (found ${verdict.found.map((m) => JSON.stringify(m)).join(", ")}). `
        + `No check yet judges what it saves or where it leads.`,
      suggestedFix: `Take the not-shipped claim for ${claim.surface} off and attach a check on the saved result it leads to. Do not auto-fix. Chris fixes reds.`,
    };
  }
  if (verdict.state === "changed") {
    return {
      id,
      status: "NOT_PROVED",
      detail: `${claim.surface}: the live page is not the page this step was judged against: ${verdict.reason}. `
        + `The step may be on it now under other words. No check yet judges what it saves or where it leads.`,
      suggestedFix: `Read the page that ships now. If it carries ${claim.noun}, attach a check on the saved result it leads to; if it does not, update the claim's identity. Do not auto-fix. Chris fixes reds.`,
    };
  }
  return {
    id,
    status: "skip",
    detail: `${claim.surface} was not read: ${verdict.reason}.`,
    suggestedFix: null,
  };
}

const groupKey = (claim) => JSON.stringify([claim.pages, claim.speculative !== false]);

/**
 * One live read per distinct page set, then one result row per claim. Returns Map(row id -> row). Never throws.
 * ctx: { fetchImpl | fetch, baseUrl }. Without a GET client every row is a skip with the reason.
 */
export async function runFinB22NotShipped(ctx = {}, claims = NOT_SHIPPED_CLAIMS) {
  const out = new Map();
  const fetchImpl = pickFetch(ctx || {});
  let origin;
  try { origin = new URL((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).origin; } catch { origin = DEFAULT_BASE_URL; }

  const groups = new Map();
  for (const claim of claims) {
    const key = groupKey(claim);
    if (!groups.has(key)) groups.set(key, { pages: claim.pages, claims: [] });
    groups.get(key).claims.push(claim);
  }
  await Promise.all([...groups.values()].map(async (group) => {
    let site;
    try {
      const speculative = group.claims.some((claim) => claim.speculative !== false);
      site = fetchImpl ? await readSite(group.pages, { fetchImpl, origin, speculative }) : unread("this run has no GET client");
    } catch (error) {
      site = unread(String(error?.message || error).replace(/\s+/g, " ").slice(0, 120));
    }
    for (const claim of group.claims) {
      let row;
      try {
        row = rowFor(claim, judgeClaim(claim, site), site);
      } catch (error) {
        row = rowFor(claim, { state: "unread", found: [], reason: String(error?.message || error).slice(0, 120) }, site);
      }
      out.set(row.id, row);
    }
  }));
  return out;
}

// ── the morning audit's question ─────────────────────────────────────────────────────────────────────

const VERIFY_CACHE = new WeakMap();

/**
 * Is this step STILL not on the live page? True only when every file was read, every anchor is there, and no
 * marker is. The audit hands the lane only { db, scope, now }, so with no GET client in the context this reads
 * with the global one (the same live GET the lane makes); a test that hands none gets that too, so tests always
 * hand one. Four claims share one read of the same pages for 30 seconds.
 */
export async function verifyNotShipped(args, ctx = {}, claims = NOT_SHIPPED_CLAIMS) {
  const claim = claims.find((item) => item.family === args?.family && item.surface === args?.surface);
  if (!claim) return false;
  const fetchImpl = pickFetch(ctx || {}) || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
  if (!fetchImpl) return false;
  let origin;
  try { origin = new URL((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).origin; } catch { return false; }

  let perClient = VERIFY_CACHE.get(fetchImpl);
  if (!perClient) {
    perClient = new Map();
    VERIFY_CACHE.set(fetchImpl, perClient);
  }
  const key = `${origin}\0${groupKey(claim)}`;
  const hit = perClient.get(key);
  let pending;
  if (hit && Date.now() - hit.at < VERIFY_CACHE_MS) {
    pending = hit.pending;
  } else {
    pending = readSite(claim.pages, { fetchImpl, origin, speculative: claim.speculative !== false });
    perClient.set(key, { at: Date.now(), pending });
  }
  const site = await pending;
  return judgeClaim(claim, site).state === "absent";
}

/** True when `claim` is complete enough to judge (used by the tests that hold this list to the Flow rows). */
export function claimProblem(claim) {
  if (!claim || !isText(claim.family) || !isText(claim.surface)) return "no family or surface";
  if (!Array.isArray(claim.pages) || !claim.pages.length || !claim.pages.every((p) => isText(p) && p.startsWith("/"))) return "pages are not site paths";
  if (!Array.isArray(claim.anchors) || !claim.anchors.length || !claim.anchors.every(isText)) return "no anchor";
  if (!Array.isArray(claim.markers) || !claim.markers.length || !claim.markers.every(isText)) return "no marker";
  if (claim.identity !== undefined) {
    const id = claim.identity;
    if (!id || typeof id !== "object" || (!isText(id.title) && id.noControls !== true)) return "no identity";
    if (id.title !== undefined && !isText(id.title)) return "no identity";
  }
  return null;
}
