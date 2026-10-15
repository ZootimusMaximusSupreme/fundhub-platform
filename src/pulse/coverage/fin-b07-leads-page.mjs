// Finish-853 batch 07, generation 2: the live read for the private leads list page.
//
// The page (public/leads/<32-hex>/index.html) holds real names and phone numbers, so git excludes it
// and the repo can never carry a copy. No fresh checkout can run a test on the file. What CAN be
// judged is the page the live server hands out, because the registry already names its address
// (SHIPPED_OUTSIDE_GIT in src/pulse/registry.mjs) and the morning pulse already pings it.
//
// The lane (gap-catalog-display.mjs, already on the reviewed read-only GET list) makes the one GET. This
// file holds the address lookup and the judge, and has no network call of its own. The judge checks
// five promises the map row makes:
//   1. the page opens (status 200);
//   2. it tells search engines to keep it out (noindex, in a robots meta tag or the X-Robots-Tag header);
//   3. its table has the five columns Name, Number, Follow up date, Response, Status, in that order;
//   4. nothing is sent from it: no network call, form, frame, outside script or outside file;
//   5. edits are kept in the browser (the page uses localStorage).
//
// PRIVACY. The page body is read to judge its shape and thrown away. Nothing the page holds (no name,
// no number, no note) is ever returned, logged or put in a detail line. A detail names only which
// promise held or broke.
//
// READ ONLY. The lane makes one GET, redirects not followed, 5 second limit, no body sent, nothing
// written. A read that fails is `skip` with the reason. It is never PASS.

import { PULSE_REGISTRY } from "../registry.mjs";

export const LEADS_COLUMNS = Object.freeze(["Name", "Number", "Follow up date", "Response", "Status"]);

/* Each pattern is a way a page can send what it holds out of the visitor's browser. Any hit is red.
   A relative <link>, <img> or <source> is not a send; only a file from another address is. */
export const SEND_PATTERNS = Object.freeze([
  ["calls fetch", /\bfetch\s*\(/],
  ["uses XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["uses sendBeacon", /\bsendBeacon\b/],
  ["opens a WebSocket", /\bWebSocket\b/],
  ["opens an EventSource", /\bEventSource\b/],
  ["loads code while it runs", /\bimport\s*\(|\bimportScripts\s*\(/],
  ["builds an Image to ping a server", /\bnew\s+Image\b/],
  ["sets a src from script", /\.src\s*=(?!=)/],
  ["creates a script, image, frame, form or link tag from script", /createElement\(\s*["'](?:script|img|iframe|link|form|embed|object)["']/i],
  ["has a form", /<form\b/i],
  ["has a frame, embed or object", /<(?:iframe|embed|object)\b/i],
  ["loads a script file", /<script\b[^>]*\bsrc\s*=/i],
  ["loads a file from another address", /<(?:link|img|source|video|audio|track|image)\b[^>]*\b(?:src|href|srcset|poster)\s*=\s*["']?(?:https?:)?\/\//i],
  ["sends the visitor on by itself (meta refresh)", /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i],
]);

/** The page's address, from the registry row that pings it. Null unless exactly one row matches. */
export function leadsPagePath(registry = PULSE_REGISTRY) {
  const rows = (Array.isArray(registry) ? registry : []).filter((row) => row
    && row.kind === "public_static" && typeof row.file === "string" && /^leads\/[^/]+\/index\.html$/.test(row.file));
  return rows.length === 1 && typeof rows[0].path === "string" ? rows[0].path : null;
}

function plain(html) {
  return String(html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Judge the page text. Returns { ok, held, broke }: plain-word lists of the promises that held and broke.
 * Pure: no network, no clock. The text is read and not kept.
 */
export function judgeLeadsHtml(html, { robotsHeader = "" } = {}) {
  const page = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const held = [];
  const broke = [];
  const check = (ok, heldWords, brokeWords) => (ok ? held : broke).push(ok ? heldWords : brokeWords);

  const metas = page.match(/<meta\b[^>]*>/gi) || [];
  const noindexMeta = metas.some((tag) => /\bname\s*=\s*["']?robots\b/i.test(tag)
    && /\bcontent\s*=\s*["'][^"']*\bnoindex\b/i.test(tag));
  const noindexHeader = /\bnoindex\b/i.test(String(robotsHeader || ""));
  check(noindexMeta || noindexHeader, "it tells search engines to keep it out (noindex)",
    "it no longer tells search engines to keep it out (no noindex)");

  const headings = (page.match(/<th\b[^>]*>[\s\S]*?<\/th>/gi) || []).map(plain);
  const columnsOk = headings.length === LEADS_COLUMNS.length
    && LEADS_COLUMNS.every((name, i) => headings[i].toLowerCase() === name.toLowerCase());
  check(columnsOk, `its columns are ${LEADS_COLUMNS.join(", ")}`,
    `its column headings are not ${LEADS_COLUMNS.join(", ")} in that order`);

  const sends = SEND_PATTERNS.filter(([, pattern]) => pattern.test(page)).map(([words]) => words);
  check(sends.length === 0, "nothing in it can send data out",
    `it can send data out: it ${sends.join("; it ")}`);

  check(/\blocalStorage\b/.test(page), "edits are kept in the browser (localStorage)",
    "it no longer keeps edits in the browser (no localStorage)");

  return { ok: broke.length === 0, held, broke };
}

function out(entry, status, detail, suggestedFix = null) {
  return { id: entry.id, status, detail, suggestedFix };
}

/**
 * Turn one live read into the lane's row. `read` is what the lane saw: { status, html, robotsHeader }.
 * The page text is judged and not kept; no detail line repeats anything the page holds.
 */
export function judgeLeadsPage(entry, read) {
  const status = Number(read?.status);
  const required = entry.contract?.requirement || "the page opens.";
  const fix = "Put the private leads page back the way the row describes it. Do not auto-fix. Chris fixes reds.";
  if (status === 404 || status === 410) {
    return out(entry, "FAIL", `${entry.control}: the live page is gone (it answers ${status}). Required: ${required}`, fix);
  }
  if (status >= 300 && status < 400) {
    return out(entry, "FAIL", `${entry.control}: the live page sends the visitor somewhere else (it answers ${status}). Required: ${required}`, fix);
  }
  if (status !== 200) {
    return out(entry, "skip", `${entry.control} was not read: the page answered ${Number.isFinite(status) ? status : "nothing"}.`);
  }
  const judged = judgeLeadsHtml(read.html, { robotsHeader: read.robotsHeader });
  if (judged.ok) {
    return out(entry, "PASS", `${entry.control}: the live page opened and every promise held: ${judged.held.join("; ")}.`);
  }
  return out(entry, "FAIL",
    `${entry.control}: the live page broke ${judged.broke.length} promise${judged.broke.length === 1 ? "" : "s"}: ${judged.broke.join("; ")}. Required: ${required}`,
    fix);
}

/** The live-page judges, by the `page` name a contract carries. `path` finds the address; `judge` makes the row. */
export const LIVE_PAGE_JUDGES = Object.freeze({
  "leads-list": Object.freeze({ path: leadsPagePath, judge: judgeLeadsPage }),
});
