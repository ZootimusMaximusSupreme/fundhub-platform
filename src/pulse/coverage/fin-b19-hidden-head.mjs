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
//   - Every row under the head is on NAV_HIDDEN: the head is drawn for no role. The row says "na" with the
//     code below, and the morning audit asks this file again before it lets "na" stand.
//   - One row under the head is not on NAV_HIDDEN, or the head lists no rows: the head can be drawn now, the
//     claim is false, and the row goes back to NOT_PROVED so a person attaches a real check for folding it.
//   - The head's key or words are not in the sidebar any more: the row goes back to NOT_PROVED too. Absence
//     of a head is never taken as "hidden", because a renamed head is still a head.
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
  return { state: open.length ? "shown" : "hidden", links: section.links, open };
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
