// What You Own — exactly one footer line, the one that fits the list.
// The page's own code and the page's own CSS, RUN, not read.
//
// WHY THIS FILE EXISTS. Live look 2026-09-18, hole N19. The client portal's
// What You Own card has two footer lines:
//   rows on file → "Files from your package. They stay on your file."
//   list empty   → "This list fills in on its own…" (text set per stage)
// On live, #11 (12 rows) and #12 (2 rows) showed BOTH lines at once. The cause
// was the cascade, not the script: `.own-foot{display:flex}` is declared after
// `.own-empty{display:none}` at the same weight (one class each), so it won and
// the empty-list line stayed on screen under a full list. The empty case had
// the mirror fault: `body.no-own .own-empty{display:block}` made that footer a
// block, and its pulse dot (an inline span) collapsed to a sliver.
//
// So this test runs paintOwn from the page to decide the body class, then works
// out each footer's display from the page's real stylesheets with a small
// cascade (origin order, !important, specificity, source order). It throws —
// never guesses — when it meets a selector it cannot judge.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_FILE = path.resolve(HERE, "../../public/app/client-portal.html");
const BRAND_FILE = path.resolve(HERE, "../../public/app/fundhub-brand.css");
const HTML = fs.readFileSync(PORTAL_FILE, "utf8");
const BRAND = fs.readFileSync(BRAND_FILE, "utf8");

// ── the page's own What You Own code ─────────────────────────────────────────
function ownSource() {
  const start = HTML.indexOf("var OWN_CODES = [");
  const end = HTML.indexOf("var PACKET_KINDS = ");
  assert.ok(start > 0 && end > start, "could not find the What You Own block in client-portal.html");
  return HTML.slice(start, end);
}
const OWN_SOURCE = ownSource();

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The body classes the page ships with, before any script runs. */
function initialBodyClasses() {
  const m = HTML.match(/<body\b[^>]*\bclass="([^"]*)"[^>]*>/);
  assert.ok(m, "client-portal.html has a <body class=…> tag");
  return m[1].split(/\s+/).filter(Boolean);
}

/** Run paintOwn for one client; return the body classes it leaves behind. */
function paint({ codes, docs, names }) {
  const list = { innerHTML: "" };
  const classes = new Set(initialBodyClasses());
  const ctx = vm.createContext({
    esc,
    localStorage: { getItem: () => "" },
    document: {
      getElementById: (id) => (id === "own-list" ? list : null),
      body: { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } }
    }
  });
  vm.runInContext(OWN_SOURCE, ctx);
  ctx.docsOnFile = docs;
  const active = {};
  for (const code of codes) active[code] = { entitlement_code: code, entitlement_name: names[code], active: true };
  ctx.paintOwn(active);
  return { body: [...classes], rows: (list.innerHTML.match(/class="own own-real"/g) || []).length };
}

// ── a small, honest cascade over the page's real CSS ─────────────────────────
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ""); }

/** Top-level rules → [{prelude, body}] with nested @media flattened (desktop width). */
function parseRules(css, width, out = []) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith("@media")) {
      if (mediaMatches(prelude, width)) parseRules(body, width, out);
    } else if (!prelude.startsWith("@")) {
      out.push({ prelude, body });
    }
    i = j;
  }
  return out;
}

function mediaMatches(prelude, width) {
  const cond = prelude.replace(/^@media\s*/, "");
  const parts = [...cond.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)];
  if (!parts.length) throw new Error(`cascade model cannot judge media query: ${prelude}`);
  return parts.every(([, kind, px]) => (kind === "min" ? width >= Number(px) : width <= Number(px)));
}

/** Compound selector → {tag, id, classes, other}; `other` = anything unmodelled. */
function parseCompound(s) {
  const tag = (s.match(/^[a-z][a-z0-9]*/i) || [null])[0];
  const id = (s.match(/#([\w-]+)/) || [null, null])[1];
  const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const other = s.replace(/^[a-z][a-z0-9]*/i, "").replace(/#[\w-]+/g, "").replace(/\.[\w-]+/g, "").replace(/^\*/, "");
  return { tag, id, classes, other, star: s.startsWith("*") };
}

function compoundMatches(c, el) {
  if (c.tag && c.tag.toLowerCase() !== el.tag) return false;
  if (c.id && c.id !== el.id) return false;
  return c.classes.every((k) => el.classes.includes(k));
}

function specificity(compounds) {
  let a = 0, b = 0, c = 0;
  for (const x of compounds) { if (x.id) a++; b += x.classes.length; if (x.tag) c++; }
  return a * 10000 + b * 100 + c;
}

/** Does `selector` select `el` (with its ancestor chain, nearest first)? */
function selects(selector, el, ancestors) {
  if (/[>+~]/.test(selector)) {
    // Combinators this model does not follow. Only a problem if the last part could be this element.
    const last = parseCompound(selector.trim().split(/[\s>+~]+/).pop());
    if (!last.other && compoundMatches(last, el)) throw new Error(`cascade model cannot judge selector: ${selector}`);
    return null;
  }
  const compounds = selector.trim().split(/\s+/).map(parseCompound);
  const last = compounds[compounds.length - 1];
  if (!compoundMatches(last, el)) return null;
  if (last.other) {
    if (/^::?(hover|focus|focus-visible|focus-within|active|visited|disabled|checked|before|after|placeholder|-webkit-[\w-]+)(\(|$)/.test(last.other)) return null;
    throw new Error(`cascade model cannot judge selector: ${selector}`);
  }
  // Earlier compounds must each match some ancestor, in order, walking outwards.
  let k = 0;
  for (let p = compounds.length - 2; p >= 0; p--) {
    const want = compounds[p];
    if (want.other) throw new Error(`cascade model cannot judge selector: ${selector}`);
    while (k < ancestors.length && !compoundMatches(want, ancestors[k])) k++;
    if (k === ancestors.length) return null;
    k++;
  }
  return specificity(compounds);
}

const RULES = [
  ...parseRules(stripComments(BRAND), 1440),
  ...parseRules(stripComments(HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>"))), 1440)
];

/** The winning `display` for `el` under the given body classes. */
function display(el, bodyClasses) {
  const ancestors = [
    { tag: "section", id: null, classes: ["card"] },
    { tag: "main", id: null, classes: [] },
    { tag: "body", id: null, classes: bodyClasses },
    { tag: "html", id: null, classes: [] }
  ];
  let best = null;
  RULES.forEach((rule, order) => {
    const decl = [...rule.body.matchAll(/(?:^|;)\s*display\s*:\s*([^;!}]+?)\s*(!important)?\s*(?=;|$)/g)].pop();
    if (!decl) return;
    for (const sel of rule.prelude.split(",")) {
      const spec = selects(sel, el, ancestors);
      if (spec === null) continue;
      const rank = [decl[2] ? 1 : 0, spec, order];
      if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] ||
          (rank[1] === best.rank[1] && rank[2] >= best.rank[2])))) {
        best = { value: decl[1].trim(), rank, sel: sel.trim() };
      }
    }
  });
  return best ? best.value : "block"; // a <div> with no display rule is a block
}

// The two footer lines and the "Nothing to download yet" box, as the markup has them.
function markupClasses(re) {
  const m = HTML.match(re);
  assert.ok(m, `markup not found: ${re}`);
  return m[1].split(/\s+/);
}
const FOOT_ROWS = { tag: "div", id: null, classes: markupClasses(/<div class="(own-foot own-real)">[^<]*<span class="pulse"><\/span> Files from your package/) };
const FOOT_EMPTY = { tag: "div", id: null, classes: markupClasses(/<div class="(own-foot own-empty)"><span class="pulse"><\/span> <span id="own-empty-foot">/) };
const EMPTY_BOX = { tag: "div", id: "own-empty", classes: markupClasses(/<div class="([^"]*)" id="own-empty">/) };

function onScreen(el, body) { return display(el, body) !== "none"; }

const NAMES = {
  "funding-mastery-course": "Funding Mastery course (A to Z)",
  "funding-snapshot": "Funding Snapshot",
  "credit-optimization-roadmap": "Credit Optimization Roadmap"
};

describe("What You Own — one footer line, the one that fits (hole N19)", () => {
  test("#12 (2 rows, as on live 2026-09-18): only 'Files from your package' shows", () => {
    const { body, rows } = paint({ codes: ["funding-mastery-course", "funding-snapshot"], docs: [], names: NAMES });
    assert.equal(rows, 2);
    assert.ok(!body.includes("no-own"), "a list with rows is not the empty state");
    assert.equal(onScreen(FOOT_ROWS, body), true, "'Files from your package' shows under a list with rows");
    assert.equal(onScreen(FOOT_EMPTY, body), false,
      "'This list fills in on its own…' must not show under a list that already has rows");
    assert.equal(onScreen(EMPTY_BOX, body), false, "'Nothing to download yet' does not show under rows");
  });

  test("#11 (roadmap + ready files): still only the rows line", () => {
    const docs = [{ id: "r1", kind: "deliverable", subtype: "credit_optimization_roadmap", title: "Roadmap", download: { url: "u" } }];
    const { body, rows } = paint({ codes: ["credit-optimization-roadmap"], docs, names: NAMES });
    assert.ok(rows >= 1);
    const lines = [FOOT_ROWS, FOOT_EMPTY].filter((f) => onScreen(f, body));
    assert.deepEqual(lines, [FOOT_ROWS], "exactly one footer line, the rows one");
  });

  test("empty list (#13 on live): only the fills-in line shows, and it keeps the footer's row layout", () => {
    const { body, rows } = paint({ codes: [], docs: [], names: NAMES });
    assert.equal(rows, 0);
    assert.ok(body.includes("no-own"));
    assert.equal(onScreen(FOOT_ROWS, body), false, "'Files from your package' is wrong with nothing in the list");
    assert.equal(onScreen(FOOT_EMPTY, body), true, "the empty list says it fills in on its own");
    assert.equal(display(FOOT_EMPTY, body), "flex", "same row layout as the rows footer, so the pulse dot is a dot");
    assert.equal(onScreen(EMPTY_BOX, body), true, "'Nothing to download yet' shows on an empty list");
  });

  test("first paint, before any data: the page ships in the empty state with one line", () => {
    const body = initialBodyClasses();
    assert.ok(body.includes("no-own"));
    assert.deepEqual([FOOT_ROWS, FOOT_EMPTY].filter((f) => onScreen(f, body)), [FOOT_EMPTY]);
  });

  test("the rows footer keeps its flex layout too", () => {
    assert.equal(display(FOOT_ROWS, []), "flex");
  });
});
