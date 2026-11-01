// Does every screen actually ASK for its data? — a source-level guard.
//
// WHAT WENT WRONG, IN PLAIN WORDS
// -------------------------------
// Every screen under public/app/ loads its data layer with
// `<script defer src="data.js">`. "defer" means: do not run this yet, run it
// after the page has finished being read. The plain inline `<script>` just
// below it has no "defer", so it runs WHILE the page is being read — earlier.
// Any code in there that touches `FHData` touches something that does not
// exist yet.
//
// On the calendar that code was written defensively:
//
//     if (typeof FHData !== "undefined" && FHData.wire) { ...ask for tasks... }
//
// That test was never true, not once. The calendar never asked for a single
// appointment. And — this is the expensive part — it did not look broken. It
// painted a clean, convincing, permanently empty week. "Nobody booked anything"
// and "we never asked" looked exactly the same on screen. Confirmed live on
// 2026-08-18: the browser's own fetch was watched and the request to /api/tasks
// simply never happened, while the data layer and the API were both healthy
// (69 tasks, 17 of them dated).
//
// THREE FIXES ARE ACCEPTED, AND THIS FILE RECOGNISES ALL THREE
// -----------------------------------------------------------
//  1. Wait for the page to finish, then ask. calendar.html, pipeline.html and
//     messaging.html do this:
//         document.addEventListener("DOMContentLoaded", function () { ...ask... });
//  2. Ask now, and if the data layer is not there yet, re-book yourself for
//     later. campaign-manager.html, content-admin.html and creative-factory.html
//     do this, inside the function that does the asking.
//  3. Register the whole start-up function as the thing that runs when the page
//     finishes. hiring.html does this.
//
// Code that only DEFINES a function is always fine — a button handler, a loader
// called later. By the time anything calls it the data layer has loaded. What
// this file hunts for is a read that happens while the page is still being read,
// with nothing arranged to make it happen again later.
//
// THE KNOWN-UNFIXED LIST — READ BEFORE YOU EDIT IT
// -----------------------------------------------
// Other screens still have this bug. They belong to other work threads running
// at the same time, and turning their builds red from here would be noise, not
// signal. So each one is written down below with its owner and what is actually
// wrong with it — every entry was opened and read by hand, not guessed.
//
// That buys three things at once:
//   * this test PASSES today, so nobody has to switch it off;
//   * the debt is WRITTEN DOWN where people read it, with a name on each item;
//   * it FAILS LOUDLY the moment a NEW screen picks the bug up, or the moment
//     calendar.html slips back.
//
// WHEN YOU FIX YOUR SCREEN: delete its one line from KNOWN_UNFIXED. That is the
// whole change. This file then holds your screen to the same bar as the rest,
// and the last test below will tell you (by going red, with the file name and
// the words "delete its line") if you fixed the screen and forgot the line.
//
// You may NOT add a line to KNOWN_UNFIXED to make a new failure go away. A new
// entry would mean a screen shipped that never asks for its data, and the whole
// point of this file is that that never gets to be quiet again.
//
// NOTE ON staff-teams.html: a plain text search makes it look like a match. It
// is not one — its FHData use sits inside a function that only runs on demand.
// It is correctly absent from the list. Do not add it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("../../public/app/", import.meta.url));

/* screen -> owning thread, and what is wrong. Every one of these was read by
   hand on 2026-08-18 against the source in this branch. */
const KNOWN_UNFIXED = {
  // Degrades instead of dying, but still reads at the wrong moment.
  "brand-studio.html":
    "T11/T10 — the dead partner read is FIXED (T11's loadBrandFromServer waits for " +
    "DOMContentLoaded, and T10 added the entity_address round trip on top). What is " +
    "left is smaller and deliberate: banner() ~1297 calls FHData.banner behind a " +
    "`typeof FHData !== \"undefined\"` guard, so a call during page parse cannot throw " +
    "— it silently writes nothing to the bottom status strip. T11's own comment in " +
    "loadBrandFromServer says it avoids calling banner() in the pre-load branch for " +
    "exactly that reason. Listed so the count stays honest, not because the screen " +
    "is broken.",
  "social-studio.html":
    "T11 — line ~1799 reads FHData during page parse; it does fall back to a raw " +
    "fetch, so partners still load, but the FHData path is dead every time.",
  "campaign-manager.html":
    "T11 — the partner picker is already fixed (it re-books itself for later). Two " +
    "guarded reads remain during page parse: partnerParam() ~636 falls back to the " +
    "address bar, and wireAll() ~1914 silently skips its banner.",
  // client-control-panel.html was here and is FIXED (2026-08-30). Its Funding
  // Apply block now waits for DOMContentLoaded like every other screen on the
  // three accepted shapes above. It had to: the count of bank approvals still
  // waiting on a dollar amount now leads that screen, and only FHData can tell
  // a failed read from an empty file, so the block can no longer run before
  // FHData exists. Its line is deleted rather than reworded, per the note above.
};

/* Screens that must be clean, named so a rename or a delete shows up as a
   failure here rather than as a check that silently stopped running. */
const MUST_BE_CLEAN = ["calendar.html", "pipeline.html", "messaging.html",
                       "inquiry-remover.html", "closer-dashboard.html"];

// ---------------------------------------------------------------------------
// A small, dependency-free reader of the inline <script> blocks.
//
// It is NOT a JavaScript engine. It walks the characters, blanks out strings,
// template strings, comments and regular expressions so their contents cannot be
// mistaken for code, and keeps track of the `{ }` braces. For each brace it
// records whether it opens a FUNCTION BODY, the function's name if it has one,
// and whether that function is CALLED IMMEDIATELY where it stands.
// ---------------------------------------------------------------------------

const KEYWORD_PAREN = new Set(["if", "for", "while", "switch", "catch", "with"]);
const REGEX_PRECEDERS = new Set([
  "return", "typeof", "case", "in", "of", "new", "delete", "void", "instanceof", "do", "else", "yield"
]);

/* The identifier immediately before position `end`, plus where it starts. */
function wordBefore(code, end) {
  let i = end;
  while (i > 0 && /\s/.test(code[i - 1])) i--;
  let j = i;
  while (j > 0 && /[A-Za-z0-9_$]/.test(code[j - 1])) j--;
  return { word: code.slice(j, i), start: j };
}

function prevNonSpace(code, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  return j;
}

/* Given the index of a ")", find its matching "(" by counting back. Strings and
   comments are already blanked by the caller, so plain counting is safe. */
function matchOpenParen(code, closeIdx) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (code[i] === ")") depth++;
    else if (code[i] === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* Replace the inside of strings, template strings, comments and regular
   expressions with spaces of the same length. Every index still lines up with
   the original source, so line numbers stay right. */
function blankNonCode(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  let prev = "";
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j === -1 ? n : j + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === "`") {
      // Template string: the ${ ... } holes are real code, so only the literal
      // text between the holes gets blanked.
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`") break;
        if (src[j] === "$" && src[j + 1] === "{") {
          blank(i + 1, j);
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            k++;
          }
          const inner = blankNonCode(src.slice(j + 2, k - 1));
          for (let q = 0; q < inner.length; q++) out[j + 2 + q] = inner[q];
          j = k;
          let m = j;
          while (m < n) {
            if (src[m] === "\\") { m += 2; continue; }
            if (src[m] === "`") break;
            if (src[m] === "$" && src[m + 1] === "{") break;
            m++;
          }
          blank(j, m);
          if (src[m] === "`") { i = m + 1; j = n + 1; break; }
          i = m;
          j = m;
          continue;
        }
        j++;
      }
      if (j <= n) {
        blank(i + 1, j);
        i = j + 1;
      }
      prev = "`";
      continue;
    }
    if (c === "/") {
      // Divide, or the start of a regular expression? Judge by what came before.
      const w = wordBefore(src, i).word;
      const isRegex =
        prev === "" || "(,=:[!&|?{};+-*%~^".includes(prev) || REGEX_PRECEDERS.has(w);
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          else if (src[j] === "\n") break;
          j++;
        }
        blank(i + 1, j);
        i = j + 1;
        prev = "/";
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

/* Every `{` in the block: where it opens and closes, whether it opens a function
   body, that function's name if it has one, and whether it is called on the spot
   (an "IIFE" — written and run in the same breath, so its body ran during page
   parse just like top-level code did). */
function braceMap(code) {
  const stack = [];
  const all = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{") {
      let isFn = false;
      let name = null;
      const p = prevNonSpace(code, i);
      if (p >= 0 && code[p] === ")") {
        const open = matchOpenParen(code, p);
        if (open > 0) {
          const before = wordBefore(code, open);
          if (!KEYWORD_PAREN.has(before.word)) {
            isFn = true;
            // `function NAME(...) {` — remember NAME so a top-level call to it
            // can be followed.
            if (before.word && before.word !== "function" &&
                wordBefore(code, before.start).word === "function") {
              name = before.word;
            }
          }
        }
      } else if (p >= 1 && code[p] === ">" && code[p - 1] === "=") {
        isFn = true;
      }
      const rec = { start: i, end: -1, isFn, name, iife: false };
      stack.push(rec);
      all.push(rec);
    } else if (c === "}") {
      const rec = stack.pop();
      if (!rec) continue;
      rec.end = i;
      if (rec.isFn) rec.iife = /^\s*\)?\s*\(/.test(code.slice(i + 1, i + 40));
    }
  }
  return all;
}

/* Every mention of FHData that runs while the page is still being read, with a
   note on whether the surrounding code arranges to try again later. */
function scanScript(body) {
  const code = blankNonCode(body);
  const fns = braceMap(code).filter((b) => b.isFn);
  const encloses = (b, at) => b.start < at && (b.end === -1 || b.end > at);

  /* A named function that is CALLED from code that runs during page parse also
     runs during page parse. Follow those calls until nothing new turns up. */
  const eagerCalled = new Set();
  const runsAtParse = (at) =>
    !fns.some((b) => !b.iife && !eagerCalled.has(b.name) && encloses(b, at));

  const named = new Set(fns.map((f) => f.name).filter(Boolean));
  for (let pass = 0; pass < 10; pass++) {
    let grew = false;
    const callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let c;
    while ((c = callRe.exec(code))) {
      const nm = c[1];
      if (!named.has(nm) || eagerCalled.has(nm)) continue;
      if (wordBefore(code, c.index).word === "function") continue; // a declaration, not a call
      if (runsAtParse(c.index)) { eagerCalled.add(nm); grew = true; }
    }
    if (!grew) break;
  }

  const hits = [];
  const re = /\bFHData\b/g;
  let m;
  while ((m = re.exec(code))) {
    const at = m.index;
    if (!runsAtParse(at)) continue;
    const inner = fns.filter((b) => encloses(b, at)).sort((a, b) => b.start - a.start)[0];
    const scope = inner ? body.slice(inner.start, inner.end < 0 ? body.length : inner.end) : body;
    // Fix 2: this function re-books itself for later when the data layer is
    // missing. Fix 3: this function IS what runs when the page finishes.
    const reBooksItself = inner ? /DOMContentLoaded/.test(scope) : false;
    const registeredLater =
      inner && inner.name &&
      new RegExp("DOMContentLoaded[\"'],\\s*" + inner.name + "\\b").test(body);
    if (reBooksItself || registeredLater) continue;
    hits.push({ at, fn: inner ? inner.name : null });
  }
  return hits;
}

/* The inline (non-src, JavaScript) <script> bodies of an HTML file, with the
   offset of each body in the file so a hit can be reported as a line number. */
function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const type = ((m[1] || "").match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    const isJs = !type || /^(module|text\/javascript|application\/javascript|text\/ecmascript)$/i.test(type);
    if (!isJs) continue;
    if (!m[2].trim()) continue;
    out.push({ body: m[2], offset: m.index + m[0].indexOf(m[2]) });
  }
  return out;
}

function unhandledFHDataReads(html) {
  const hits = [];
  for (const s of inlineScripts(html)) {
    for (const h of scanScript(s.body)) {
      hits.push({ line: html.slice(0, s.offset + h.at).split("\n").length, fn: h.fn });
    }
  }
  return hits;
}

function screens() {
  return readdirSync(APP_DIR).filter((f) => f.endsWith(".html")).sort();
}

const cache = new Map();
function read(file) {
  if (!cache.has(file)) cache.set(file, readFileSync(join(APP_DIR, file), "utf8"));
  return cache.get(file);
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

test("the scanner finds the bug, and clears each of the three accepted fixes", () => {
  // Without this, the check could quietly rot into something that passes
  // everything. Each snippet is written the way the real screens are written.
  const broken = `<script defer src="data.js"></script><script>(function () {
    if (typeof FHData !== "undefined" && FHData.wire) { FHData.wire(read, "x", paint); }
  })();</script>`;
  const waits = `<script defer src="data.js"></script><script>(function () {
    document.addEventListener("DOMContentLoaded", function () {
      if (typeof FHData !== "undefined" && FHData.wire) { FHData.wire(read, "x", paint); }
    });
  })();</script>`;
  const reBooks = `<script>function boot(){
    if(!window.FHData){ if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
      say('the data layer did not load'); return; }
    FHData.write('/x', {});
  }
  boot();</script>`;
  const registered = `<script>function boot(){ FHData.banner('sample','loading'); }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); }
  else { boot(); }</script>`;
  const onDemand = `<script>(function () {
    function refresh() { return FHData.taskQueue({}); }
    document.getElementById("b").addEventListener("click", refresh);
  })();</script>`;
  const throughCall = `<script>(function () {
    function ask() { return FHData.taskQueue({}); }
    ask();
  })();</script>`;

  assert.equal(unhandledFHDataReads(broken).length > 0, true, "missed a read during page parse");
  assert.equal(unhandledFHDataReads(waits).length, 0, "wrongly flagged the DOMContentLoaded fix");
  assert.equal(unhandledFHDataReads(reBooks).length, 0, "wrongly flagged the re-book-itself fix");
  assert.equal(unhandledFHDataReads(registered).length, 0, "wrongly flagged the registered-start-up fix");
  assert.equal(unhandledFHDataReads(onDemand).length, 0, "wrongly flagged a call-on-demand read");
  assert.equal(unhandledFHDataReads(throughCall).length > 0, true,
    "missed a read reached through a call made during page parse");
});

test("no screen reads its data before the deferred data layer has loaded", () => {
  const offenders = [];
  for (const file of screens()) {
    const html = read(file);
    if (!html.includes("FHData")) continue;
    if (Object.prototype.hasOwnProperty.call(KNOWN_UNFIXED, file)) continue;
    const hits = unhandledFHDataReads(html);
    if (!hits.length) continue;
    offenders.push(
      `${file}: ${hits.length} read(s) happen before data.js has loaded — ` +
        hits.map((h) => "line " + h.line + (h.fn ? " in " + h.fn + "()" : "")).join(", ")
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "These screens ask for their data at a moment when the data layer does not exist, " +
      "so they never ask at all — and they paint a convincing empty screen instead of " +
      'saying so. Wrap the read in document.addEventListener("DOMContentLoaded", ...); ' +
      "see public/app/calendar.html or public/app/pipeline.html.\n" + offenders.join("\n")
  );
});

test("calendar.html asks for its appointments, and says so out loud when it cannot", () => {
  const html = read("calendar.html");
  assert.equal(
    unhandledFHDataReads(html).length,
    0,
    "calendar.html has gone back to reading its data during page parse. It will load no " +
      "appointments at all and show an empty week with no explanation."
  );
  assert.match(html, /addEventListener\("DOMContentLoaded"/, "the DOMContentLoaded wait is gone");
  assert.match(html, /<script defer src="data\.js">/, "data.js must keep its defer attribute");
  // A failed read has to reach the eye. Both halves of that: the flag the paint
  // functions read, and the out-loud message for the one failure the data layer
  // cannot report about itself.
  assert.match(html, /var loadFailed = false;/, "the failed-read flag is gone");
  assert.match(html, /function dataLayerMissing\(\)/, "the visible data-layer-missing message is gone");
  assert.match(html, /fh-data-banner/, "the failure message no longer reaches the banner");
  assert.match(html, /function pendingNote\(\)/,
    "the wording that separates 'nothing booked' from 'not loaded' is gone");
});

test("calendar.html never claims an empty day it has not checked", () => {
  const html = read("calendar.html");
  // The places that paint a "nothing here" sentence must all ask whether the
  // schedule actually came back first.
  //
  // Up Next and Then only ever look at still-open work, so `loaded` is the whole
  // question for them and they read the flag directly.
  for (const guard of [
    /loaded \? "Nothing up next" : pendingNote\(\)/,
    /loaded \? "Nothing else dated after Up Next\." : pendingNote\(\)/
  ]) {
    assert.match(html, guard, "an empty-state sentence stopped checking whether the read happened");
  }
  // The day timeline and the week strip count BOTH open and finished work, so
  // "loaded" is not enough for them — a half-loaded schedule is a third state.
  // Both must route through the one helper that knows all three.
  assert.match(html, /function emptyNoteAll\(\)/,
    "the helper that separates empty / unread / half-read is gone");
  assert.match(html, /if \(!loaded\) return pendingNote\(\);[\s\S]{0,200}?if \(doneFailed\)[\s\S]{0,200}?return "No tasks due\.";/,
    "emptyNoteAll no longer covers all three of unread, half-read and genuinely empty");
  assert.match(html, /<div class="ws-empty">' \+ esc\(emptyNoteAll\(\)\)/,
    "the week strip stopped asking whether the schedule really came back");
  assert.match(html, /<div class="open-slot">' \+ esc\(emptyNoteAll\(\)\)/,
    "the day timeline stopped asking whether the schedule really came back");
  assert.match(html, /if \(!loaded\) \{[\s\S]{0,400}?open-slot/,
    "the day timeline no longer separates 'nothing booked' from 'not loaded'");
});

test("calendar.html treats HALF a schedule as a failure, not as a quiet empty week", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // THE WORST BUG THIS SCREEN HAS HAD, AND THE ONE THIS TEST EXISTS TO STOP.
  //
  // The calendar asks for its appointments twice: once for work that is still
  // open, once for calls that have already finished. The first fix reported a
  // problem only when BOTH reads failed:
  //
  //     if ((!open || !open.ok) && (!closed || !closed.ok)) return open || closed;
  //
  // So when the open read fell over and the finished read answered "nothing",
  // this function handed back { ok:true, tasks:[] }. `loaded` turned true,
  // `loadFailed` stayed false, and every honest-empty guard above did its job
  // perfectly on a fact that was false. A person saw a calm, mint-green,
  // completely empty week — "Nothing booked.", tiles reading 0, a green LIVE
  // chip — with no warning anywhere on the screen.
  //
  // Proven in a real browser on 2026-08-18 and pinned in e2e/calendar.spec.mjs
  // ("Calendar never paints a half-read schedule as a whole one"). This test is
  // the cheap source-level twin of those: it fails the moment the both-must-fail
  // shape comes back, without needing a browser to notice.
  // ─────────────────────────────────────────────────────────────────────────
  const html = read("calendar.html");

  // Comments are stripped first: the fix below QUOTES the broken line so the
  // next reader can see what it used to be, and that quotation must not be
  // mistaken for the bug coming back.
  const code = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /\(!open \|\| !open\.ok\) && \(!closed \|\| !closed\.ok\)/.test(code),
    false,
    "calendar.html is back to only noticing a failure when BOTH reads fail. A half-read " +
      "schedule then paints as a confident empty week — the single worst outcome this " +
      "screen has. Each read must be judged on its own."
  );

  // Each half is judged on its own, and named, because they break different
  // things and a person needs different words for each.
  assert.match(html, /openFailed = !open \|\| !open\.ok;/,
    "the still-open read is no longer checked on its own");
  assert.match(html, /doneFailed = !closed \|\| !closed\.ok;/,
    "the finished-calls read is no longer checked on its own");
  assert.match(html, /if \(openFailed\) return open \|\| closed;/,
    "a failed open read is no longer reported as a failed read");

  // A number that counts a half nobody read must be a dash, never a number that
  // is quietly too small. "Left today" counts only open work, so it survives.
  assert.match(html, /bookedEl\.textContent = doneFailed \? "\\u2014"/,
    "the Booked tile is back to showing a count that is missing the finished calls");
  assert.match(html, /doneEl\.textContent = doneFailed \? "\\u2014"/,
    "the Done tile is back to showing a count that is missing the finished calls");

  // And the half-failure has to reach the eye, in a colour that is not success.
  assert.match(html, /FHData\.banner\("error",[\s\S]{0,200}?completed tasks could not be loaded/,
    "the partial-failure warning banner is gone — a half-read week would look fine again");
  assert.match(html, /if \(doneFailed\) \{[\s\S]{0,200}?schedule incomplete/,
    "the banner note is back to saying 'live schedule' over a half-read week");
  assert.match(html, /function paintLiveChip\(\)/,
    "the LIVE chip no longer tells the truth about whether the schedule loaded");
});

test("calendar.html no longer ships the demonstration drawer", () => {
  const html = read("calendar.html");
  for (const dead of ["demozone", "demoToggle", "demoBody", "demo-cap", "Move one booking"]) {
    assert.equal(html.includes(dead), false, `calendar.html still ships fake demo markup: ${dead}`);
  }
  // The honest empty states must survive that deletion.
  assert.match(html, /No tasks due\./, "the real empty-day wording was removed by mistake");
  assert.match(html, /statBooked/, "the stat tiles were removed by mistake");
});

test("staff-teams.html is not a false positive", () => {
  // It mentions FHData near the top of its script, but only inside a function
  // that runs on demand. If this ever fails the scanner has become stricter than
  // the real rule and will start flagging correct code.
  const html = read("staff-teams.html");
  assert.equal(html.includes("FHData"), true, "staff-teams.html no longer uses FHData — update this test");
  assert.equal(unhandledFHDataReads(html).length, 0, "staff-teams.html was wrongly flagged");
});

test("the screens that must be clean exist and are clean", () => {
  const present = new Set(screens());
  for (const file of MUST_BE_CLEAN) {
    assert.equal(present.has(file), true, `${file} is missing`);
    assert.equal(Object.prototype.hasOwnProperty.call(KNOWN_UNFIXED, file), false,
      `${file} must never be excused`);
    assert.equal(unhandledFHDataReads(read(file)).length, 0,
      `${file} reads its data during page parse`);
  }
});

test("the known-unfixed list is still true", () => {
  // Honest in both directions: a screen that has been fixed must not stay
  // listed, because a listed screen is one this check no longer watches. If this
  // goes red for your screen, the fix is one line — delete it from the list.
  const present = new Set(screens());
  const stale = [];
  for (const [file, note] of Object.entries(KNOWN_UNFIXED)) {
    const owner = note.split(" ")[0];
    if (!present.has(file)) {
      stale.push(`${file} (${owner}) is on the known-unfixed list but the file is gone — delete its line`);
      continue;
    }
    if (unhandledFHDataReads(read(file)).length === 0) {
      stale.push(`${file} (${owner}) is fixed — delete its line from KNOWN_UNFIXED in this file`);
    }
  }
  assert.deepEqual(stale, [], stale.join("\n"));
});
