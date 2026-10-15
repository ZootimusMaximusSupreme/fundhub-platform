// Finish-853 batch 09, generation 2: the live read for the "Reset my edits" button on the private lead list.
//
// The page (public/leads/<32-hex>/index.html) holds real names and phone numbers, so git excludes it and the
// repo can never carry a copy. No fresh checkout can open the file to test it. What CAN be judged is the page
// the live server hands out: the registry already names its address (SHIPPED_OUTSIDE_GIT in
// src/pulse/registry.mjs) and the morning pulse already pings it.
//
// The lane (gap-catalog-display.mjs, already on the reviewed read-only GET list) makes the one GET and hands
// the answer here. This file has no network call of its own. The judge reads the page's own script and checks
// what the row promises: there is one button that says "Reset my edits", pressing it asks first, Yes empties
// the edits the page saved in the browser, writes that to the browser's storage, and redraws the list.
//
// It reads the SOURCE the server hands out. It does not click. The click was run once, by hand, in Chromium on
// the live page (see ops/workflows/finish-853-2026-10-14/manifest-b09.md); this file turns what that run
// showed into a check that goes red the day the button, its question, its clearing or its redraw is gone.
//
// PRIVACY. The page body is read to judge its shape and thrown away. Nothing the page holds (no name, no
// number, no note) is ever returned, logged or put in a detail line. A detail names only which promise held
// or broke.
//
// READ ONLY. One GET, no body sent, redirects not followed, 5 second limit (made by the lane), nothing
// written. A read that fails is `skip` with the reason. It is never PASS.

import { PULSE_REGISTRY } from "../registry.mjs";

/** The one map row this file judges, by its exact key. */
export const LEADS_RESET_ROW = Object.freeze({
  sourceFile: "public-pages.json",
  surface: "button:leads/<32-hex>/index.html#reset",
  control: "Button 'Reset my edits'",
});

export const RESET_BUTTON_WORDS = "reset my edits";

/** True for the tracked display entry that is the Reset button row, and for nothing else. */
export function leadsResetFor(entry) {
  return Boolean(entry)
    && entry.sourceFile === LEADS_RESET_ROW.sourceFile
    && entry.surface === LEADS_RESET_ROW.surface
    && entry.control === LEADS_RESET_ROW.control;
}

/** The page's address, from the registry row that pings it. Null unless exactly one row matches. */
export function leadsResetPath(registry = PULSE_REGISTRY) {
  const rows = (Array.isArray(registry) ? registry : []).filter((row) => row
    && row.kind === "public_static" && typeof row.file === "string" && /^leads\/[^/]+\/index\.html$/.test(row.file));
  return rows.length === 1 && typeof rows[0].path === "string" ? rows[0].path : null;
}

// ── a small reader for the page's own script ────────────────────────────────────────────────────────────

/** Replace comments with spaces and keep strings as they are, so a commented-out handler is not a handler. */
function withoutComments(code) {
  let out = "";
  for (let i = 0; i < code.length;) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const stop = end < 0 ? code.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end < 0 ? code.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** The index of the brace that closes the one opened at `open`, skipping strings. -1 when it never closes. */
function closeOf(code, open) {
  let depth = 0;
  for (let i = open; i < code.length;) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

const IDENT = "[A-Za-z_$][\\w$]*";
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every named function in the script: { name, body }. Function declarations and const arrows. */
function namedFunctions(code) {
  const found = [];
  const starts = new RegExp(
    `function\\s+(${IDENT})\\s*\\([^)]*\\)\\s*\\{|(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(?:async\\s*)?(?:function\\s*\\([^)]*\\)|\\([^)]*\\)\\s*=>|${IDENT}\\s*=>)\\s*\\{`,
    "g",
  );
  for (const m of code.matchAll(starts)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(code, open);
    if (close > open) found.push({ name: m[1] || m[2], body: code.slice(open + 1, close) });
  }
  return found;
}

/** The function body a click handler argument names, or null. `rest` starts right after the comma. */
function handlerBody(code, rest) {
  const inline = new RegExp(
    `^\\s*(?:async\\s+)?(?:function\\b\\s*(?:${IDENT})?\\s*\\([^)]*\\)\\s*\\{|\\([^)]*\\)\\s*=>\\s*\\{|${IDENT}\\s*=>\\s*\\{)`,
  ).exec(rest);
  if (inline) {
    const open = code.length - rest.length + inline[0].length - 1;
    const close = closeOf(code, open);
    return close > open ? code.slice(open + 1, close) : null;
  }
  const named = new RegExp(`^\\s*(${IDENT})\\s*\\)`).exec(rest);
  if (named) return namedFunctions(code).find((fn) => fn.name === named[1])?.body ?? null;
  return null;
}

function plain(html) {
  return String(html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Where a click on the element with this id is handled: the handler's body, or null. */
function clickHandlerFor(code, id) {
  const idRe = escapeRe(id);
  const lookup = `(?:document\\s*\\.\\s*getElementById\\s*\\(\\s*['"]${idRe}['"]\\s*\\)|document\\s*\\.\\s*querySelector\\s*\\(\\s*['"]#${idRe}['"]\\s*\\))`;
  const holders = [lookup];
  for (const alias of code.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENT})\\s*=\\s*${lookup}`, "g"))) {
    holders.push(escapeRe(alias[1]));
  }
  for (const holder of holders) {
    const listen = new RegExp(`${holder}\\s*\\.\\s*addEventListener\\s*\\(\\s*['"]click['"]\\s*,`, "g");
    for (const m of code.matchAll(listen)) {
      const rest = code.slice(m.index + m[0].length);
      const body = handlerBody(code, rest);
      if (body !== null) return body;
    }
    const assign = new RegExp(`${holder}\\s*\\.\\s*onclick\\s*=(?!=)`, "g");
    for (const m of code.matchAll(assign)) {
      const body = handlerBody(code, code.slice(m.index + m[0].length));
      if (body !== null) return body;
    }
  }
  return null;
}

const QUOTED = `(?:[^)'"\`]|'[^']*'|"[^"]*"|\`[^\`]*\`)*`;
const REDRAW = /\b(?:render|draw|paint|refresh|redraw|update|show|build)\w*\s*\(|\blocation\s*\.\s*reload\s*\(/;

/**
 * Judge the page text. Returns { ok, held, broke }: plain-word lists of the promises that held and broke.
 * Pure: no network, no clock. The text is read and not kept.
 */
export function judgeLeadsResetHtml(html) {
  const page = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const held = [];
  const broke = [];
  const check = (ok, heldWords, brokeWords) => (ok ? held : broke).push(ok ? heldWords : brokeWords);

  const buttons = [...page.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
    .filter((m) => plain(m[2]).toLowerCase() === RESET_BUTTON_WORDS);
  check(buttons.length === 1, "the page has one button that says Reset my edits",
    buttons.length === 0 ? "the page has no button that says Reset my edits"
      : `the page has ${buttons.length} buttons that say Reset my edits`);
  if (buttons.length !== 1) return { ok: false, held, broke };

  const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(buttons[0][1])?.[1] || "";
  const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1]))
    .map((m) => m[2]);
  const code = withoutComments(scripts.join("\n"));
  const body = id ? clickHandlerFor(code, id) : null;
  check(body !== null, "pressing the button runs code (a click handler is attached to it)",
    id ? "pressing the button runs nothing: no click handler is attached to it"
      : "the button has no id, so no click handler can be attached to it");
  if (body === null) return { ok: false, held, broke };

  // What the page saves and loads back: the storage key, and the object it writes there.
  const setItem = new RegExp(
    `localStorage\\s*\\.\\s*setItem\\s*\\(\\s*([\\w$.]+)\\s*,\\s*JSON\\s*\\.\\s*stringify\\s*\\(\\s*([\\w$.]+)\\s*\\)`,
  ).exec(code);
  const keyVar = setItem?.[1] || /localStorage\s*\.\s*getItem\s*\(\s*([\w$.]+)\s*\)/.exec(code)?.[1] || "";
  const storeVar = setItem?.[2] || "";
  const loads = keyVar && new RegExp(`localStorage\\s*\\.\\s*getItem\\s*\\(\\s*${escapeRe(keyVar)}\\b`).test(code);
  const persistNames = namedFunctions(code)
    .filter((fn) => /localStorage\s*\.\s*setItem\s*\(/.test(fn.body))
    .map((fn) => fn.name);

  const ask = new RegExp(`\\bif\\s*\\(\\s*!\\s*(?:window\\s*\\.\\s*)?confirm\\s*\\(${QUOTED}\\)\\s*\\)\\s*(?:\\{\\s*)?return\\b`).exec(body);
  const askEnd = ask ? ask.index + ask[0].length : -1;
  check(Boolean(ask), "it asks first and stops when the answer is No",
    "it does not ask first: nothing stops a press from clearing the edits");

  // Yes empties the saved edits: the object the page writes is reset in memory, the key is removed from the
  // browser's storage, or both. Only what comes after the question counts.
  const after = askEnd < 0 ? 0 : askEnd;
  const tail = body.slice(after);
  let emptiedEnd = -1;
  if (storeVar) {
    const emptied = new RegExp(
      `\\b${escapeRe(storeVar)}\\s*=\\s*(?:\\{\\s*\\}|\\[\\s*\\]|null|Object\\s*\\.\\s*create\\s*\\(\\s*null\\s*\\))`,
    ).exec(tail);
    if (emptied) emptiedEnd = after + emptied.index + emptied[0].length;
  }
  let removalEnd = -1;
  for (const m of tail.matchAll(/localStorage\s*\.\s*(?:removeItem\s*\(\s*([\w$.]+)\s*\)|clear\s*\(\s*\))/g)) {
    if (m[1] && keyVar && m[1] !== keyVar) continue;
    removalEnd = after + m.index + m[0].length;
    break;
  }
  const reloads = /\blocation\s*\.\s*reload\s*\(/.test(tail);
  // A removed key with the list still drawn from memory would leave the edits on the screen, so a removal
  // counts as clearing only with an emptied object or a reload after it.
  check(emptiedEnd >= 0 || (removalEnd >= 0 && reloads), "Yes empties the edits the page saved in the browser",
    "Yes does not empty the edits the page saved in the browser");

  // The empty edits reach the browser's storage (a removed key already has).
  let persistEnd = removalEnd;
  if (persistEnd < 0 && emptiedEnd >= 0) {
    const calls = [
      ...persistNames.map((name) => new RegExp(`\\b${escapeRe(name)}\\s*\\(`, "g")),
      /localStorage\s*\.\s*setItem\s*\(/g,
    ];
    for (const re of calls) {
      for (const m of body.matchAll(re)) {
        if (m.index >= emptiedEnd) {
          const end = m.index + m[0].length;
          persistEnd = persistEnd < 0 ? end : Math.min(persistEnd, end);
          break;
        }
      }
    }
  }
  check(persistEnd >= 0, "and writes the empty edits to the browser's storage",
    "it never writes the empty edits to the browser's storage, so they come back on the next visit");

  // The redraw has to come after both the emptying and the writing.
  const redrawFrom = Math.max(persistEnd, emptiedEnd);
  const redraw = persistEnd >= 0 && (REDRAW.test(body.slice(redrawFrom)) || reloads);
  check(redraw, "and redraws the list so the cleared edits leave the screen",
    "it does not redraw the list after clearing, so the cleared edits stay on the screen");

  check(Boolean(loads), "what it clears is what the page loads back (one storage key for both)",
    "the page never loads its edits back from the storage key it clears");

  return { ok: broke.length === 0, held, broke };
}

function out(entry, status, detail, suggestedFix = null) {
  return { id: entry.id, status, detail, suggestedFix };
}

/**
 * Turn one live read into the lane's row. `read` is what the lane saw: { status, html } or { error }.
 * The page text is judged and not kept; no detail line repeats anything the page holds.
 */
export function judgeLeadsReset(entry, read) {
  const required = "the live page has one Reset my edits button; pressing it asks, empties the saved edits, saves that, and redraws.";
  const fix = "Put the Reset my edits button on the private leads page back the way the row describes it. Do not auto-fix. Chris fixes reds.";
  if (!read || read.error) {
    return out(entry, "skip", `${entry.control} was not read: ${read?.error || "no answer"}.`);
  }
  const status = Number(read.status);
  if (status === 404 || status === 410) {
    return out(entry, "FAIL", `${entry.control}: the live page is gone (it answers ${status}). Required: ${required}`, fix);
  }
  if (status >= 300 && status < 400) {
    return out(entry, "FAIL", `${entry.control}: the live page sends the visitor somewhere else (it answers ${status}). Required: ${required}`, fix);
  }
  if (status !== 200) {
    return out(entry, "skip", `${entry.control} was not read: the page answered ${Number.isFinite(status) ? status : "nothing"}.`);
  }
  const judged = judgeLeadsResetHtml(read.html);
  if (judged.ok) {
    return out(entry, "PASS", `${entry.control}: the live page opened and every promise held: ${judged.held.join("; ")}.`);
  }
  return out(entry, "FAIL",
    `${entry.control}: the live page broke ${judged.broke.length} promise${judged.broke.length === 1 ? "" : "s"}: ${judged.broke.join("; ")}. Required: ${required}`,
    fix);
}

/**
 * The lane's hook. `readPage(path)` is the lane's one GET: { status, html } or { error }, never a throw.
 * Returns a Map from the row's id to its result, empty when the map has no such row. One read serves it.
 */
export async function leadsResetResults(entries, readPage, registry = PULSE_REGISTRY) {
  const results = new Map();
  const mine = (entries || []).filter(leadsResetFor);
  if (mine.length === 0) return results;
  const path = leadsResetPath(registry);
  const read = path ? await readPage(path) : { error: "the registry does not name exactly one leads page" };
  for (const entry of mine) results.set(entry.id, judgeLeadsReset(entry, read));
  return results;
}
