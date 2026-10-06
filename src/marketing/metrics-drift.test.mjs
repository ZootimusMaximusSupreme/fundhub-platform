// The $147 roadmap rule lives in two places. This test keeps them the same.
//
// api/read/portal-summary.mjs readSloPaid (:409-428) is the client portal's
// answer to "did she pay for the roadmap". It is bound to the module-level live
// db and wrapped in safeRead (any error becomes `false`), so the marketing
// numbers cannot call it. src/marketing/metrics.mjs lifts its two predicates
// (ROADMAP_BY_ORDER, ROADMAP_BY_FUNNEL) instead.
//
// A lifted copy drifts silently. So this test reads readSloPaid's SOURCE TEXT
// (it never imports or runs portal-summary.mjs — that would open the live pool)
// and fails when either side changes alone:
//   - the same tables, the same EXISTS names (by_order, by_funnel),
//   - the same conditions, compared as sets after the per-client binding
//     (org_id = $1, client_id = $2) is set aside,
//   - and the comparator itself is proved to notice a change on either side.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROADMAP_BY_ORDER, ROADMAP_BY_FUNNEL } from "./metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "../../api/read/portal-summary.mjs");
const METRICS = path.resolve(HERE, "metrics.mjs");

const BINDING = new Set(["org_id = $1", "client_id = $2"]);

/* The body of `function readSloPaid` — from its line to the next top-level
   function or the end of the file. */
function readSloPaidBody(source) {
  const start = source.indexOf("function readSloPaid(");
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s|\nexport\s/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/* Source text inside a JS template literal → the SQL Postgres receives.
   Only the escape this SQL uses: \\ becomes \. */
const unescapeTemplate = (s) => s.replace(/\\\\/g, "\\");
const squash = (s) => s.replace(/\s+/g, " ").trim();

/* Every `EXISTS (SELECT 1 FROM <table> WHERE <conds>) AS <name>` in a SQL text
   → [{ table, as, conditions (sorted), binding (sorted) }]. */
function existsClauses(sqlText) {
  const out = [];
  const re = /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(\w+)\s+WHERE\s+([\s\S]*?)\)\s+AS\s+(\w+)/g;
  let m;
  while ((m = re.exec(sqlText))) {
    const all = m[2].split(/\bAND\b/).map(squash).filter(Boolean);
    out.push({
      table: m[1],
      as: m[3],
      conditions: all.filter((c) => !BINDING.has(c)).sort(),
      binding: all.filter((c) => BINDING.has(c)).sort()
    });
  }
  return out;
}

function portalClauses(source) {
  const body = readSloPaidBody(source);
  assert.ok(body, "readSloPaid is gone from api/read/portal-summary.mjs — update metrics.mjs and this test together");
  return existsClauses(unescapeTemplate(body));
}

const lifted = () => [ROADMAP_BY_ORDER, ROADMAP_BY_FUNNEL].map((p) => ({
  table: p.table,
  as: p.as,
  conditions: [...p.conditions].map(squash).sort()
}));

/* The comparison the real test makes, as a function so it can be proved to
   fail. Returns a list of differences; empty means the same. */
function differences(portal, metrics) {
  const diffs = [];
  if (portal.length !== metrics.length) diffs.push(`portal has ${portal.length} predicates, metrics has ${metrics.length}`);
  for (const want of metrics) {
    const got = portal.find((p) => p.as === want.as);
    if (!got) { diffs.push(`portal has no EXISTS named ${want.as}`); continue; }
    if (got.table !== want.table) diffs.push(`${want.as}: portal reads ${got.table}, metrics reads ${want.table}`);
    const only = (a, b) => a.filter((x) => !b.includes(x));
    for (const c of only(got.conditions, want.conditions)) diffs.push(`${want.as}: only portal has  ${c}`);
    for (const c of only(want.conditions, got.conditions)) diffs.push(`${want.as}: only metrics has ${c}`);
  }
  return diffs;
}

test("readSloPaid and metrics.mjs hold the same roadmap conditions", () => {
  const portal = portalClauses(fs.readFileSync(PORTAL, "utf8"));
  assert.deepEqual(differences(portal, lifted()), []);
});

test("readSloPaid still binds each predicate to one org and one client", () => {
  const portal = portalClauses(fs.readFileSync(PORTAL, "utf8"));
  assert.equal(portal.length, 2);
  for (const p of portal) assert.deepEqual(p.binding, ["client_id = $2", "org_id = $1"], p.as);
});

test("metrics.mjs builds its own SQL from the lifted lists, not from a third copy", () => {
  const src = fs.readFileSync(METRICS, "utf8");
  // Each condition is written as a string literal only inside the frozen lists
  // (once per list it belongs to) — so the SQL readers and
  // roadmapPaidPredicates can only be using those lists.
  const all = [...ROADMAP_BY_ORDER.conditions, ...ROADMAP_BY_FUNNEL.conditions];
  for (const c of new Set(all)) {
    const literal = JSON.stringify(c); // the source form, quotes and escapes included
    const count = src.split(literal).length - 1;
    const want = all.filter((x) => x === c).length;
    assert.equal(count, want, `${literal} is written ${count} times in metrics.mjs; expected ${want}, in the lifted lists`);
  }
  // And the SQL that metrics.mjs sends is built from them.
  assert.match(src, /andAll\(ROADMAP_BY_ORDER\.conditions\)/);
  assert.match(src, /andAll\(ROADMAP_BY_FUNNEL\.conditions\)/);
});

test("the check fails when the portal side changes alone", () => {
  const source = fs.readFileSync(PORTAL, "utf8");
  const changed = source.replace("AND raw_payload->>'source' = 'slo'", "AND raw_payload->>'source' IN ('slo', 'cf')");
  assert.notEqual(changed, source, "the line this test edits is not in readSloPaid any more — update the test");
  assert.notDeepEqual(differences(portalClauses(changed), lifted()), []);

  const dropped = source.replace(/\n\s*AND is_demo IS NOT TRUE\) AS by_order/, ") AS by_order");
  assert.notEqual(dropped, source);
  assert.notDeepEqual(differences(portalClauses(dropped), lifted()), []);
});

test("the check fails when the metrics side changes alone", () => {
  const portal = portalClauses(fs.readFileSync(PORTAL, "utf8"));
  const base = lifted();
  const edited = base.map((p) => p.as === "by_order"
    ? { ...p, conditions: p.conditions.map((c) => c === "status = 'paid'" ? "status IN ('paid', 'sent')" : c) }
    : p);
  assert.notDeepEqual(differences(portal, edited), []);
  const retabled = base.map((p) => p.as === "by_funnel" ? { ...p, table: "payments" } : p);
  assert.notDeepEqual(differences(portal, retabled), []);
});
