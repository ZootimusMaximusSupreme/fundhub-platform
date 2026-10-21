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
//   4. nothing is sent from it: no network call, form, frame, outside script or outside file, and no
//      script that moves the visitor, opens a window, sets an address, or builds code from text (a
//      tap-to-text or tap-to-call link to one number, "sms:" + lead.phone, opens the phone's own app and
//      is the one address a script may set besides a file made in the browser);
//   5. edits are kept in the browser: the script itself reads and writes localStorage. A word in a
//      comment or in a string is not a use of it.
//
// HOW THE SCRIPTS ARE JUDGED. A regex over the page text cannot tell a call from a comment or a
// string, and a page can send data in ways that have no "fetch" in them (location.href, window.open,
// setAttribute("src"), a ping attribute, a module import). So every inline script (and every inline
// handler and javascript: link) is read by a small lexer that returns two views of the code: one with
// comments AND string contents blanked (what the script DOES), and one with only comments blanked
// (so setAttribute("src", ...) can be read). A script the lexer cannot read to the end is red: the
// judge cannot say nothing is sent from it.
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
  ["pings a server from a link (ping attribute)", /<[a-z][^>]*\sping\s*=/i],
  ["posts from a button or input (formaction)", /<[a-z][^>]*\sformaction\s*=/i],
  ["changes where every link goes (a base tag)", /<base\b/i],
  ["loads a style or font from another address", /\burl\(\s*["']?(?:https?:)?\/\/|@import\b/i],
]);

/* What the script itself does, read on the code view (comments and string contents blanked). Any hit is red.
   An address made by URL.createObjectURL is a file made inside the browser (a download of the visitor's own
   rows), not an address that leaves it, so it is allowed. The only other allowed address is a phone link to one
   number (see isPhoneLink below). */
const ADDRESS_SINK = /\.\s*(?:href|src|formAction|ping|srcset|poster)\s*\+?=(?!=)(?!\s*(?:window\s*\.\s*)?URL\s*\.\s*createObjectURL\s*\()/;
export const CODE_SINKS = Object.freeze([
  ["moves the visitor from script (location)", /\blocation\b/],
  ["opens a window from script (open)", /\bopen\s*\(/],
  ["writes into the document from script (write)", /\.\s*write(?:ln)?\s*\(/],
  ["sets an address from script (href, src, formAction, ping, srcset, poster)", ADDRESS_SINK],
  ["builds code from text (eval, Function)", /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/],
  ["posts a message out of the page (postMessage)", /\bpostMessage\s*\(/],
  ["starts a worker", /\b(?:Worker|SharedWorker|serviceWorker)\b/],
  ["imports a module (import)", /\bimport\b/],
]);

/* A tap-to-text or tap-to-call link to one number: `a.href = "sms:" + lead.phone;` (or "tel:"). The address
   starts with that literal, so its scheme is fixed: tapping it opens the phone's own Messages or Phone app to
   that number, with no message in it, and nothing goes to any server. It is allowed only in exactly this shape:
   a plain `.href =` (never `+=`, never src or another setter), a string that is only "sms:" or "tel:" and an
   optional number, then at most ONE plain property read (`+ lead.phone`), then `;` `,` `)` or `}`. Anything more
   (a "?body=", a second piece, a call on the string, no closing mark) can carry the page's rows and stays red,
   the same as a mailto link with a body. The literal is found by its place: on the code view every string is a
   pair of quotes, in the same order as `strings`. */
const PHONE_LINK_LITERAL = /^(?:sms|tel):[+\d\s().-]*$/i;
const PHONE_LINK_TAIL = /^\s*(["'])\1(?:\s*\+\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)?[ \t]*[;,)}]/;

export function isPhoneLink(code, strings, match) {
  if (!/^\.\s*href\s*=$/.test(match[0])) return false;
  const start = match.index + match[0].length;
  const tail = PHONE_LINK_TAIL.exec(code.slice(start));
  if (!tail) return false;
  const quoteAt = start + tail[0].indexOf(tail[1]);
  const index = (code.slice(0, quoteAt).match(/["']/g) || []).length / 2;
  return Number.isInteger(index) && PHONE_LINK_LITERAL.test(String((strings || [])[index] ?? "x"));
}

/** True when a read script sets an address other than a browser-made file or one phone link. */
export function setsAnAddress(lexed) {
  const code = String(lexed?.code || "");
  for (const match of code.matchAll(new RegExp(ADDRESS_SINK.source, "g"))) {
    if (!isPhoneLink(code, lexed.strings, match)) return true;
  }
  return false;
}

/* setAttribute is read with string contents kept, because the attribute NAME is the string. A name that
   is not a plain string cannot be read, so it is a hit too. */
export const SET_ATTRIBUTE_SINK = Object.freeze([
  "sets an address with setAttribute (src, href, action, ping, data)",
  /\bsetAttribute(?:NS)?\s*\(\s*(?:["'](?:src|href|action|formaction|ping|srcset|poster|data|background|xlink:href)["']|[^"'\s])/i,
]);

/**
 * Read one script with a small JavaScript lexer. Returns { ok, code, full, strings }:
 *   code     comments and string / template / regex contents blanked: what the script DOES;
 *   full     only comments blanked: the strings are still there to be read;
 *   strings  the text of each quoted string, in order (on the code view each one is a pair of quotes).
 * ok is false when the script ends inside a string, comment or template: it was not read to the end.
 */
export function lexScript(source) {
  const s = String(source ?? "");
  const n = s.length;
  let code = "";
  let full = "";
  const strings = [];
  let i = 0;
  let last = "";
  let failed = false;
  const REGEX_AFTER_WORD = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  const regexAllowed = () => {
    if (!last) return true;
    if (last.startsWith("p:")) return ![")", "]", "}"].includes(last.slice(2));
    if (last.startsWith("w:")) return REGEX_AFTER_WORD.test(last.slice(2));
    return false;
  };
  const push = (c, f = c) => { code += c; full += f; };

  function template() {
    // s[i] is the opening backtick
    push("`");
    i += 1;
    while (i < n) {
      const c = s[i];
      if (c === "\\") { full += s.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { push("`"); i += 1; last = "s"; return; }
      if (c === "$" && s[i + 1] === "{") {
        push("${");
        i += 2;
        run(true);
        continue;
      }
      full += c;
      i += 1;
    }
    failed = true;
  }

  function run(stopAtBrace) {
    let depth = 0;
    while (i < n && !failed) {
      const c = s[i];
      const d = s[i + 1];
      if (c === "/" && d === "/") {
        while (i < n && s[i] !== "\n") i += 1;
        continue;
      }
      if (c === "/" && d === "*") {
        const end = s.indexOf("*/", i + 2);
        if (end < 0) { failed = true; return; }
        i = end + 2;
        push(" ");
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && s[j] !== c) {
          if (s[j] === "\\") j += 1;
          if (s[j] === "\n") { failed = true; return; }
          j += 1;
        }
        if (j >= n) { failed = true; return; }
        push(c + c, s.slice(i, j + 1));
        strings.push(s.slice(i + 1, j));
        i = j + 1;
        last = "s";
        continue;
      }
      if (c === "`") { template(); continue; }
      if (c === "/" && regexAllowed()) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < n && s[j] !== "\n") {
          if (s[j] === "\\") { j += 2; continue; }
          if (s[j] === "[") inClass = true;
          else if (s[j] === "]") inClass = false;
          else if (s[j] === "/" && !inClass) { ok = true; break; }
          j += 1;
        }
        if (ok) {
          j += 1;
          while (j < n && /[a-z]/i.test(s[j])) j += 1;
          push("/r/", s.slice(i, j));
          i = j;
          last = "s";
          continue;
        }
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i + 1;
        while (j < n && /[\w$]/.test(s[j])) j += 1;
        const word = s.slice(i, j);
        push(word);
        i = j;
        last = `w:${word}`;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < n && /[\w.]/.test(s[j])) j += 1;
        push(s.slice(i, j));
        i = j;
        last = "n";
        continue;
      }
      if (/\s/.test(c)) { push(c); i += 1; continue; }
      if (c === "{") depth += 1;
      if (c === "}") {
        if (depth === 0 && stopAtBrace) { push("}"); i += 1; return; }
        depth -= 1;
      }
      push(c);
      i += 1;
      last = `p:${c}`;
    }
  }

  run(false);
  return { ok: !failed, code, full, strings };
}

const ENTITIES = Object.freeze({ "&quot;": '"', "&#34;": '"', "&apos;": "'", "&#39;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" });
const decodeEntities = (text) => String(text).replace(/&(?:quot|#34|apos|#39|amp|lt|gt);/g, (m) => ENTITIES[m] || m);

/** Every piece of script in the page: inline scripts, inline event handlers, and javascript: links. */
export function scriptBodies(page) {
  const bodies = [];
  for (const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/i.test(m[1])) bodies.push(m[2]);
  }
  for (const m of page.matchAll(/\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) bodies.push(decodeEntities(m[1] ?? m[2] ?? ""));
  for (const m of page.matchAll(/\b(?:href|src|action|formaction)\s*=\s*(?:"\s*javascript:([^"]*)"|'\s*javascript:([^']*)')/gi)) {
    bodies.push(decodeEntities(m[1] ?? m[2] ?? ""));
  }
  return bodies;
}

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

  /* The page-level patterns read the page with the comments inside its scripts taken out (a word in a
     comment is not a call). Strings stay, so createElement("img") can still be read. */
  const readable = page.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (whole, open, body, close) => {
    if (/\bsrc\s*=/i.test(open)) return whole;
    const lexed = lexScript(body);
    return lexed.ok ? `${open}${lexed.full}${close}` : whole;
  });
  const sends = SEND_PATTERNS.filter(([, pattern]) => pattern.test(readable)).map(([words]) => words);
  const lexed = scriptBodies(page).map((body) => lexScript(body));
  const code = lexed.map((l) => l.code).join("\n");
  const full = lexed.map((l) => l.full).join("\n");
  for (const [words, pattern] of CODE_SINKS) {
    const hit = pattern === ADDRESS_SINK ? lexed.some(setsAnAddress) : pattern.test(code);
    if (hit) sends.push(words);
  }
  if (SET_ATTRIBUTE_SINK[1].test(full)) sends.push(SET_ATTRIBUTE_SINK[0]);
  const unreadable = lexed.some((l) => !l.ok);
  if (unreadable) sends.push("has a script that could not be read to its end, so nothing can be said about what it sends");
  check(sends.length === 0, "nothing in it can send data out",
    `it can send data out: it ${[...new Set(sends)].join("; it ")}`);

  // Kept in the browser: the script itself reads and writes localStorage. The word in a comment or a
  // string is not a use of it, and sessionStorage is a different promise.
  const keeps = !unreadable && /\blocalStorage\b/.test(code) && /\bsetItem\b/.test(code) && /\bgetItem\b/.test(code);
  check(keeps, "edits are kept in the browser (localStorage)",
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
