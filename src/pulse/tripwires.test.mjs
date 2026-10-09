// Tripwire map coverage. Same idea as registry.test.mjs and routes.test.mjs:
// a new surface fails this until someone decides its tripwire.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NOT_CUSTOMER_FACING, TRIPWIRES, TRIPWIRE_IMPACTS, isPingId } from "./tripwires.mjs";
import { SEND_PATHS } from "./registry.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { functions } from "../workflows/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASELINE_FILE = path.join(HERE, "tripwires-baseline.json");
const BASELINE = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));

/* The baseline only shrinks. When you sort entries out of it, lower this number to the new
   length in the same change. Never raise it: a new surface goes in TRIPWIRES or
   NOT_CUSTOMER_FACING, not in the baseline. */
const BASELINE_MAX = 533;

function htmlFiles(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((name) => typeof name === "string" && name.endsWith(".html"))
    .map((name) => name.replace(/\\/g, "/"));
}

function surfaces() {
  const out = new Set();
  for (const key of Object.keys(ROUTES)) out.add(`route:${key}`);
  for (const file of fs.readdirSync(path.join(ROOT, "public/app")).filter((n) => n.endsWith(".html"))) {
    out.add(`desk:${file}`);
  }
  for (const file of htmlFiles(path.join(ROOT, "public")).filter((n) => !n.startsWith("app/"))) {
    out.add(`page:${file}`);
  }
  for (const fn of functions) out.add(`job:${fn.opts.id}`);
  for (const file of Object.keys(SEND_PATHS)) out.add(`send:${file}`);
  return out;
}

function pulseSource() {
  const files = fs.readdirSync(HERE, { recursive: true })
    .filter((name) => typeof name === "string" && name.endsWith(".mjs") && !name.endsWith(".test.mjs"));
  return files.map((name) => fs.readFileSync(path.join(HERE, name), "utf8")).join("\n");
}

const SURFACES = surfaces();

test("tripwires: every page, route, job and send is sorted, or still on the shrinking baseline", () => {
  const sorted = new Set([...Object.keys(TRIPWIRES), ...Object.keys(NOT_CUSTOMER_FACING), ...BASELINE]);
  const unsorted = [...SURFACES].filter((s) => !sorted.has(s)).sort();
  assert.deepEqual(unsorted, [],
    `These surfaces have no tripwire decision:\n  ${unsorted.join("\n  ")}\n\n` +
    "Money or a paying customer: add it to TRIPWIRES in src/pulse/tripwires.mjs with the deep check " +
    "ids that go red when it breaks (write the check in src/pulse/coverage/gap-<lane>.mjs first). " +
    "Staff-only or internal: add it to NOT_CUSTOMER_FACING with the reason. Do not add it to the baseline.");
});

test("tripwires: a surface sits in exactly one place", () => {
  const seen = new Map();
  const note = (key, where) => seen.set(key, [...(seen.get(key) || []), where]);
  for (const key of Object.keys(TRIPWIRES)) note(key, "TRIPWIRES");
  for (const key of Object.keys(NOT_CUSTOMER_FACING)) note(key, "NOT_CUSTOMER_FACING");
  for (const key of BASELINE) note(key, "baseline");
  const twice = [...seen].filter(([, where]) => where.length > 1).map(([key, where]) => `${key} (${where.join(", ")})`);
  assert.deepEqual(twice, []);
});

test("tripwires: no entry names a surface that is gone", () => {
  const stale = [...Object.keys(TRIPWIRES), ...Object.keys(NOT_CUSTOMER_FACING), ...BASELINE]
    .filter((key) => !SURFACES.has(key)).sort();
  assert.deepEqual(stale, [], `Remove these, the surface no longer exists:\n  ${stale.join("\n  ")}`);
});

test("tripwires: the baseline only shrinks", () => {
  assert.ok(Array.isArray(BASELINE));
  assert.ok(BASELINE.length <= BASELINE_MAX,
    `tripwires-baseline.json grew to ${BASELINE.length} (max ${BASELINE_MAX}). New surfaces are sorted, never parked here.`);
});

test("tripwires: every money or customer surface names a real deep check, not just a ping", () => {
  const src = pulseSource();
  for (const [key, row] of Object.entries(TRIPWIRES)) {
    assert.ok(row && TRIPWIRE_IMPACTS.includes(row.impact), `${key}: impact must be ${TRIPWIRE_IMPACTS.join(" or ")}`);
    assert.ok(Array.isArray(row.checks) && row.checks.length > 0, `${key}: name at least one check id`);
    assert.ok(row.checks.some((id) => !isPingId(id)), `${key}: a ping is not a tripwire — name a deep check`);
    for (const id of row.checks) {
      if (/^reg:/.test(id) || /^job:/.test(id)) continue;
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(src, new RegExp(`["'\`]${escaped}["'\`]`), `${key}: check id "${id}" is not written in any src/pulse file`);
    }
  }
});

test("tripwires: every not-customer-facing entry says why", () => {
  for (const [key, reason] of Object.entries(NOT_CUSTOMER_FACING)) {
    assert.ok(typeof reason === "string" && reason.trim().length >= 40, `${key}: give a reason of 40 characters or more`);
  }
});

test("tripwires: a ping id is never counted as a tripwire", () => {
  assert.equal(isPingId("reg:portal-login.html"), true);
  assert.equal(isPingId("job:message-dispatch-sweeper"), true);
  assert.equal(isPingId("health"), true);
  assert.equal(isPingId("payments:paid-no-entitlement"), false);
});
