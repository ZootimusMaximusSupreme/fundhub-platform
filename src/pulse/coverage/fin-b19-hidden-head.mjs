// A sidebar head that the shared chrome never shows to anyone (batch 19, owner order 2026-10-14).
//
// public/app/shell.js draws the staff sidebar from one built-in copy (SIDEBAR_HTML). It then hides every row
// whose screen is on NAV_HIDDEN, and hides a whole section when every row under it is hidden (gateLinks()).
// Three sections, Home, Watch and Automation, hold only rows that are on NAV_HIDDEN. For every role the whole
// section is hidden, so its head is never drawn, nobody can click it to fold or unfold it, and there is
// nothing for it to save. "Nothing to judge" is only allowed when the computer can check it again. This file
// is that check:
//
//   - It reads the LIVE shell.js with one GET (redirects are not followed), takes the built-in sidebar and
//     the NAV_HIDDEN list out of it, finds the head by its key and its words, and looks at every row under it.
//   - It also reads the CODE THAT APPLIES the list, in the shapes shell.js writes it today (APPLY_SHAPES):
//     the line that marks a menu row hidden when its screen is on NAV_HIDDEN, the line that hides a row
//     marked that way, the line that counts the rows still shown, the line that hides a whole section when
//     none is, the line that mounts the built-in sidebar, both calls of the gate, and that the list is
//     written once and never emptied, reassigned or changed. A list that is right and a gate that no longer
//     reads it would draw the head, so a gate it does not recognise is "changed", not "hidden".
//   - Every row under the head is on NAV_HIDDEN and the gate still applies it: the head is drawn for no role.
//     The row says "na" with the code below, and the morning audit asks this file again before it lets "na" stand.
//   - One row under the head is not on NAV_HIDDEN, or the head lists no rows: the head can be drawn now, the
//     claim is false, and the row goes back to NOT_PROVED so a person attaches a real check for folding it.
//   - The head's key or words are not in the sidebar any more, or the gate no longer applies the list in a
//     shape this reader knows: the row goes back to NOT_PROVED too. Absence of a head is never taken as
//     "hidden", because a renamed head is still a head, and a list nobody applies hides nothing.
//   - Anything could not be read (no GET client, bad address, non-200, not the shared chrome, a list or a
//     sidebar the reader does not understand): the row is "skip" with the reason. Never a guess.
//
// READ ONLY. GET only. Nothing is written, sent, or called except the public shell.js.
// This file imports nothing and reads no repo file at run time, so it is safe inside the live bundle.

export const HIDDEN_HEAD_CODE = "catalog-display-hidden-section-head";

const READ_TIMEOUT_MS = 4000;

const isText = (value) => typeof value === "string" && value.trim() !== "";

/** The claim a display contract carries in `contract.hiddenHead`: the script to read, the head's key and its words. */
export function headClaim(entry) {
  const claim = entry?.contract?.hiddenHead;
  if (!claim || !isText(claim.path) || !claim.path.startsWith("/") || claim.path.startsWith("//")) return null;
  if (!isText(claim.section) || !isText(claim.label)) return null;
  return { path: claim.path, section: claim.section, label: claim.label };
}

/** The strings of `var <name> = [ ... ];`, comments skipped. null when it is not a plain list of strings. */
export function stringList(text, name) {
  const start = new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\[`).exec(text);
  if (!start) return null;
  const out = [];
  let i = start.index + start[0].length;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "]") return out;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") {
          value += text[j + 1] ?? "";
          j += 2;
        } else {
          value += text[j];
          j += 1;
        }
      }
      if (j >= text.length) return null;
      out.push(value);
      i = j + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      if (end < 0) return null;
      i = end + 1;
      continue;
    }
    if (ch === "," || /\s/.test(ch)) {
      i += 1;
      continue;
    }
    return null;
  }
  return null;
}

/** The built-in sidebar markup, decoded from its string literal. null when it is not one plain string. */
export function sidebarHtml(text) {
  const literal = /\bvar\s+SIDEBAR_HTML\s*=\s*("(?:[^"\\\n]|\\.)*")\s*;/.exec(text);
  if (!literal) return null;
  try {
    const value = JSON.parse(literal[1]);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const screenOf = (href) => String(href).split(/[?#]/)[0].replace(/^\.\//, "").trim();

/**
 * The code that applies NAV_HIDDEN, in the shapes shell.js writes it. Each shape is a statement the gate cannot
 * work without. They are looked for after `function gateLinks(` and in this order, so a copy of one in a comment
 * above the function does not stand in for the code. Whitespace between the pieces is free.
 */
export const APPLY_SHAPES = Object.freeze([
  ["a menu row is marked hidden when its screen is on NAV_HIDDEN",
    /var\s+hideNav\s*=\s*a\.classList\.contains\(\s*["']navitem["']\s*\)\s*&&\s*NAV_HIDDEN\.indexOf\(\s*file\s*\)\s*!==\s*-1\s*;/],
  ["a row that is not allowed, or is marked hidden, is put away",
    /if\s*\(\s*!allowed\s*\|\|\s*hideNav\s*\)\s*\{\s*box\.style\.display\s*=\s*["']none["']\s*;\s*box\.setAttribute\(\s*["']data-fh-gated["']\s*,\s*["']1["']\s*\)\s*;/],
  ["a section looks at the rows under it",
    /document\.querySelectorAll\(\s*["']\.navgroup["']\s*\)[\s\S]*?group\.querySelectorAll\(\s*["']\.navitem["']\s*\)/],
  ["a row counts as shown only when it is not put away",
    /items\[\s*j\s*\]\.style\.display\s*!==\s*["']none["']\s*&&\s*!items\[\s*j\s*\]\.hasAttribute\(\s*["']data-fh-gated["']\s*\)\s*\)\s*\{\s*any\s*=\s*true\s*;/],
  ["a section with no row shown is put away",
    /if\s*\(\s*!any\s*\)\s*\{\s*group\.style\.display\s*=\s*["']none["']\s*;\s*group\.setAttribute\(\s*["']data-fh-gated-group["']\s*,\s*["']1["']\s*\)\s*;/],
]);

/** Where the gate is run: once from the cached role and once from the session, which is the one that counts. */
const GATE_CALLS = Object.freeze([
  ["the gate runs on the session's answer", /\bgateLinks\(\s*ok\s*,\s*role\s*\)\s*;/],
  ["the gate runs on the cached role", /\bgateLinks\(\s*hintedOk\s*,\s*hinted\s*\)\s*;/],
]);

/** What must be true of NAV_HIDDEN itself apart from its rows: written once, and never changed after. */
const LIST_RULES = Object.freeze([
  ["NAV_HIDDEN is written once", (text) => (text.match(/\bNAV_HIDDEN\s*=(?!=)/g) || []).length === 1],
  ["NAV_HIDDEN is never changed in place",
    (text) => !/\bNAV_HIDDEN\s*\.\s*(?:length\b|splice|push|pop|shift|unshift|sort|reverse|fill|copyWithin)/.test(text)
      && !/\bNAV_HIDDEN\s*\[/.test(text)],
]);

/**
 * Does shell.js still APPLY the list it writes? Returns { ok: true } or { ok: false, reason }. This reads code
 * shapes, not behaviour: the Chromium test fin-b19-shell-sidebar.test.mjs is what draws the page for every role.
 */
export function applyingCode(text) {
  const at = text.indexOf("function gateLinks(");
  if (at < 0) return { ok: false, reason: "the live shared chrome has no function that gates the sidebar rows" };
  const body = text.slice(at);
  let from = 0;
  for (const [what, shape] of APPLY_SHAPES) {
    const found = shape.exec(body.slice(from));
    if (!found) return { ok: false, reason: `the code that applies the hidden list changed (${what} is not written the way this check reads it)` };
    from += found.index + found[0].length;
  }
  for (const [what, shape] of GATE_CALLS) {
    if (!shape.test(text.slice(at))) return { ok: false, reason: `the code that applies the hidden list changed (${what} is not called the way this check reads it)` };
  }
  if (!/wrap\.innerHTML\s*=\s*SIDEBAR_HTML\s*;/.test(text)) {
    return { ok: false, reason: "the code that applies the hidden list changed (the built-in sidebar is no longer the one that is mounted)" };
  }
  for (const [what, holds] of LIST_RULES) {
    if (!holds(text)) return { ok: false, reason: `the code that applies the hidden list changed (${what}: it is no longer the list written out above)` };
  }
  return { ok: true };
}

/** The head with this key: its words and the screens of every row under it, or null when there is no such head. */
export function sectionOf(html, key) {
  const marker = `data-fh-section="${key}"`;
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const next = html.indexOf("data-fh-section=", at + marker.length);
  const block = html.slice(at, next < 0 ? html.length : next);
  const head = /<button\b[^>]*\bnavhead\b[^>]*>([^<]*)</.exec(block);
  const links = [];
  for (const tag of block.match(/<a\b[^>]*>/gi) || []) {
    if (!/\bclass="[^"]*\bnavitem\b[^"]*"/.test(tag)) continue;
    const href = /\bhref="([^"]*)"/.exec(tag);
    if (href) links.push(screenOf(href[1]));
  }
  return { label: head ? head[1].trim() : null, links };
}

function unread(reason) {
  return { state: "unread", reason, links: [], open: [] };
}

/** One GET of the live script. Returns { text } or { unread: reason }. ctx.fetchImpl may be an own null. */
async function fetchScript(claim, ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx || {}, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return { unread: "this run has no GET client" };
  let url;
  try {
    url = new URL(claim.path, new URL((ctx && ctx.baseUrl) || "https://fundhub.ai").origin);
  } catch {
    return { unread: "the base address is not a web address" };
  }
  try {
    const res = await fetchImpl(url.href, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (res.status !== 200) return { unread: `the live shared chrome answered ${res.status}` };
    return { text: await res.text() };
  } catch (error) {
    return { unread: String(error?.message || error).replace(/\s+/g, " ").slice(0, 120) };
  }
}

/**
 * Judge one head against the text of shell.js. Exported so a test can feed it the real file.
 * Returns { state: "hidden" | "shown" | "changed" | "unread", links, open, reason? }.
 */
export function judgeText(text, claim) {
  const html = sidebarHtml(text);
  if (html === null) return unread("the live shared chrome has no built-in sidebar this reader understands");
  const hiddenList = stringList(text, "NAV_HIDDEN");
  if (hiddenList === null) return unread("the live shared chrome has no plain NAV_HIDDEN list this reader understands");
  const section = sectionOf(html, claim.section);
  if (!section) return { state: "changed", reason: `the sidebar has no head with the key "${claim.section}" now`, links: [], open: [] };
  if (section.label !== claim.label) {
    return { state: "changed", reason: `the head "${claim.section}" now reads "${section.label}", not "${claim.label}"`, links: section.links, open: [] };
  }
  if (section.links.length === 0) {
    return { state: "shown", reason: "the head lists no rows, so the chrome has nothing to hide it by", links: [], open: [] };
  }
  const hidden = new Set(hiddenList.map(screenOf));
  const open = section.links.filter((file) => !hidden.has(file));
  if (open.length) return { state: "shown", links: section.links, open };
  // Every row is on the list. The head is drawn for no role only while the gate still applies the list.
  const gate = applyingCode(text);
  if (!gate.ok) return { state: "changed", reason: gate.reason, links: section.links, open: [] };
  return { state: "hidden", links: section.links, open };
}

/** Read the live shared chrome once and judge one head. ctx follows the lane's own pattern (fetchImpl, baseUrl). */
export async function readHeadState(claim, ctx = {}) {
  const got = await fetchScript(claim, ctx);
  return got.unread ? unread(got.unread) : judgeText(got.text, claim);
}

function resultRow(entry, claim, read) {
  const label = `${entry.surface} — ${entry.control}`;
  if (read.state === "hidden") {
    return {
      id: entry.id,
      status: "na",
      detail: `${entry.control}: no role is shown this head. Every row under it (${read.links.join(", ")}) is on the shared chrome's hidden list, so the page hides the whole section. Judged the day one of them is shown.`,
      suggestedFix: null,
      na: { code: HIDDEN_HEAD_CODE, args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control } },
    };
  }
  if (read.state === "shown") {
    const why = read.open.length
      ? `${read.open.join(", ")} ${read.open.length === 1 ? "is" : "are"} not on the hidden list`
      : read.reason;
    return {
      id: entry.id,
      status: "NOT_PROVED",
      detail: `${label}: the shared chrome can draw this head now (${why}). No check yet judges folding and unfolding it.`,
      suggestedFix: "Take the hidden-head claim off this control and attach a check on the fold and unfold. Do not auto-fix. Chris fixes reds.",
    };
  }
  if (read.state === "changed") {
    return {
      id: entry.id,
      status: "NOT_PROVED",
      detail: `${label}: ${read.reason}. The hidden-head claim no longer fits, and no check yet judges this control.`,
      suggestedFix: "Find the head under its new key or words and attach a check on the fold and unfold. Do not auto-fix. Chris fixes reds.",
    };
  }
  return {
    id: entry.id,
    status: "skip",
    detail: `${entry.control} was not read: ${read.reason}.`,
    suggestedFix: null,
  };
}

/** One live read per distinct script, then one result row per control that carries a claim. Map of entry id to row. */
export async function judgeHiddenHeads(entries, ctx = {}) {
  const out = new Map();
  const reads = new Map();
  for (const entry of entries) {
    const claim = headClaim(entry);
    if (!claim) continue;
    // One GET answers every head that names the same script: the read is by path, the judging by key.
    if (!reads.has(claim.path)) reads.set(claim.path, fetchScript(claim, ctx));
    const got = await reads.get(claim.path);
    const read = got.unread ? unread(got.unread) : judgeText(got.text, claim);
    out.set(entry.id, resultRow(entry, claim, read));
  }
  return out;
}

/** The morning audit's question: is this head STILL drawn for no role? True only when the whole read held. */
export async function verifyHiddenHead(entries, args, ctx = {}) {
  const entry = entries.find((item) => headClaim(item)
    && item.sourceFile === args?.sourceFile && item.surface === args?.surface && item.control === args?.control);
  if (!entry) return false;
  return (await readHeadState(headClaim(entry), ctx)).state === "hidden";
}
