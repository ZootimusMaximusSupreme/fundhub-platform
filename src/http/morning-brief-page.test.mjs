// The daily brief page (public/app/morning-brief.html), read as text.
//
// The page opens with NO sign-in: the long code in the link is the only key
// (api/public/morning-brief.mjs checks it). So this file guards the things that
// would quietly undo that:
//   * it must not load the staff shell or anything that sends a visitor with no
//     session to the staff sign-in page;
//   * it must never write the code down (storage, cookie, console, title);
//   * it must never build markup from the data it fetched;
//   * it carries the no-index and no-referrer metas and data-brief-page="1";
//   * its money() prints exactly what src/ops/morning-brief.mjs money() prints.
// The browser half (real render at 375 and 320 px, a 404, an empty brief) is
// e2e/morning-brief.spec.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { money as serverMoney } from "../ops/morning-brief.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "../../public/app/morning-brief.html");
const HTML = fs.readFileSync(FILE, "utf8");
const noComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const MARKUP = noComments(HTML);
const SCRIPTS = (MARKUP.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []);
const JS = SCRIPTS.map((b) => b.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, ""))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("the root element carries data-brief-page=\"1\"", () => {
  assert.match(MARKUP, /<html\b[^>]*\bdata-brief-page="1"/);
});

test("it tells search engines to stay out and sends no referrer", () => {
  assert.match(MARKUP, /<meta\s+name="robots"\s+content="noindex,nofollow">/);
  assert.match(MARKUP, /<meta\s+name="referrer"\s+content="no-referrer">/);
});

test("it loads no staff shell and nothing that redirects to the sign-in page", () => {
  for (const banned of ["shell.js", "data.js", "crm-sidebar", "chat-widget", "serviceWorker", "login", "/api/read/", "/api/auth"]) {
    assert.ok(!MARKUP.includes(banned), `morning-brief.html must not reference ${banned}`);
  }
  // Only inline scripts: no src= script can sneak a gate in.
  for (const block of SCRIPTS) assert.doesNotMatch(block, /^<script\b[^>]*\bsrc=/i, "no external <script src>");
  // The only API it calls is the public brief route.
  const apis = [...JS.matchAll(/["'](\/api\/[^"'?]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(apis)], ["/api/public/morning-brief"]);
});

test("it never writes the code anywhere", () => {
  for (const banned of ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "console.", "replaceState", "pushState"]) {
    assert.ok(!JS.includes(banned), `the page script must not use ${banned}`);
  }
  // The title is set from fixed words only, never from the query string.
  for (const m of JS.matchAll(/document\.title\s*=\s*([^;]+);/g)) {
    assert.doesNotMatch(m[1], /\bk\b|location|search|url/i, `title built from: ${m[1]}`);
  }
  // The fetch sends no cookie and no referrer.
  assert.match(JS, /credentials:\s*"omit"/);
  assert.match(JS, /referrerPolicy:\s*"no-referrer"/);
});

test("it never builds markup from data (text only)", () => {
  for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "createContextualFragment", "DOMParser"]) {
    assert.ok(!JS.includes(banned), `the page script must not use ${banned}`);
  }
  assert.match(JS, /textContent/);
});

test("a bad link shows one fixed sentence", () => {
  assert.match(JS, /"This link is not valid or has expired\."/);
  assert.match(JS, /"The report could not load right now\. Try again in a minute\."/);
  // Only the route's own 404 says the link is bad; a 503 or a dropped signal must not.
  assert.match(JS, /res\.status === 404 \? "bad" : "later"/);
});

test("the page's money() prints exactly what the brief's money() prints", () => {
  const start = JS.indexOf("function money(");
  assert.ok(start >= 0, "money() not found in the page script");
  let depth = 0;
  let end = -1;
  for (let i = JS.indexOf("{", start); i < JS.length; i++) {
    if (JS[i] === "{") depth++;
    else if (JS[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  const pageMoney = new Function(`${JS.slice(start, end)}; return money;`)();
  for (const c of [0, 1, 9, 10, 99, 100, 101, 12345, 100000, 123456789, -1, -250, -123456]) {
    assert.equal(pageMoney(c), serverMoney(c), `cents ${c}`);
  }
  assert.equal(pageMoney(null), "unknown");
  assert.equal(pageMoney(undefined), "unknown");
  assert.equal(pageMoney(12.5), "unknown", "a value that is not whole cents is not guessed at");
});
