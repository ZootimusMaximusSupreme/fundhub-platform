import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  DISPOSITION_SQL,
  closerDeskRouteReport,
  gapChecks
} from "./gap-closer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-closer.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

const ALIVE = {
  "public/app/closer-dashboard.html": '<script defer src="shell.js"></script>',
  "public/app/present.html": '<script src="present.js"></script>',
  "public/app/present.js": 'window.FHData.write("/api/closer-deck", { action: "log_disposition" });',
  "public/app/shell.js": [
    'var ALL = [ "closer-dashboard.html" ];',
    "var HOME = {",
    '  closer: "closer-dashboard.html"',
    "};"
  ].join("\n"),
  "netlify.toml": [
    "[build]",
    '  publish = "public"',
    "[[redirects]]",
    '  from = "/app"',
    '  to = "/app/"',
    "  status = 301"
  ].join("\n")
};

function aliveRead(rel) {
  if (!Object.prototype.hasOwnProperty.call(ALIVE, rel)) throw new Error(`unexpected read: ${rel}`);
  return ALIVE[rel];
}

function deadRead(patch) {
  return (rel) => {
    if (patch.missing === rel) throw new Error("ENOENT");
    if (patch.file === rel) return patch.text;
    return aliveRead(rel);
  };
}

function fakeDb(n) {
  return {
    async query(sql, params) {
      assert.match(sql, /gap:closer-held-disposition/);
      assert.equal(params[0], ORG);
      return { rows: [{ n }] };
    }
  };
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /one tripwire/);
    assert.match(row.suggestedFix, /log_disposition/);
    assert.match(row.suggestedFix, /fetchContext/);
    assert.match(row.suggestedFix, /Do not start a call/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

test("gap closer: source stays read-only and does not repeat the slices", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /from ["'][^"']*slice-/);
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|listUnrecorded|brain_drive|meet-transcript/);
  assert.doesNotMatch(SRC, /\bFROM bookings\b/i);
  assert.doesNotMatch(DISPOSITION_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual([...CHECK_IDS], ["closer:held-disposition"]);
});

test("gap closer: no database skips the read when the pages are wired", async () => {
  const rows = await gapChecks({ readText: aliveRead });
  assert.equal(rows.length, 1);
  rows.forEach(shape);
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /No database/);
  assert.equal(closerDeskRouteReport(aliveRead).ok, true);
});

test("gap closer: a clean book is one PASS", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, readText: aliveRead });
  assert.equal(rows.length, 1);
  rows.forEach(shape);
  assert.equal(rows[0].status, "PASS");
  assert.match(rows[0].detail, /no held call/);
  assert.equal(seen.length, 1);
  assert.match(seen[0].sql, /gap:closer-held-disposition/);
  assert.doesNotMatch(seen[0].sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.equal(seen[0].params[0], ORG);
});

test("gap closer: a disposition with no call_outcomes row is FAIL", async () => {
  const rows = await gapChecks({ db: fakeDb(2), orgId: ORG, readText: aliveRead });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /2 held calls/);
  assert.match(rows[0].detail, /call_outcomes has no row/);
  assert.match(rows[0].detail, /fetchContext has no recent call/);
});

test("gap closer: one missing row uses the singular", async () => {
  const rows = await gapChecks({ db: fakeDb(1), orgId: ORG, readText: aliveRead });
  rows.forEach(shape);
  assert.match(rows[0].detail, /1 held call saved/);
});

test("gap closer: a dead page route is FAIL and does not ping the network", async () => {
  const cases = [
    {
      name: "dashboard stub",
      read: deadRead({
        file: "public/app/closer-dashboard.html",
        text: '<script>location.replace("pipeline.html")</script>'
      }),
      detail: /closer-dashboard\.html does not load shell\.js/
    },
    {
      name: "present loads shell",
      read: deadRead({
        file: "public/app/present.html",
        text: '<script src="present.js"></script><script src="shell.js"></script>'
      }),
      detail: /present\.html loads shell\.js/
    },
    {
      name: "present save gone",
      read: deadRead({
        file: "public/app/present.js",
        text: "window.FHData.write('/api/notes', {});"
      }),
      detail: /log_disposition/
    },
    {
      name: "redirect steals present",
      read: deadRead({
        file: "netlify.toml",
        text: '[build]\n  publish = "public"\n[[redirects]]\n  from = "/app/present.html"\n  to = "/app/"\n'
      }),
      detail: /redirect steals \/app\/present\.html/
    },
    {
      name: "file missing",
      read: deadRead({ missing: "public/app/present.html" }),
      detail: /present\.html missing/
    }
  ];
  for (const c of cases) {
    const rows = await gapChecks({ db: fakeDb(0), orgId: ORG, readText: c.read });
    rows.forEach(shape);
    assert.equal(rows[0].status, "FAIL", c.name);
    assert.match(rows[0].detail, /route is dead/, c.name);
    assert.match(rows[0].detail, c.detail, c.name);
    assert.equal(closerDeskRouteReport(c.read).ok, false, c.name);
  }
});

test("gap closer: a dead route with no database is still FAIL", async () => {
  const read = deadRead({ missing: "public/app/closer-dashboard.html" });
  const rows = await gapChecks({ readText: read });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /route is dead/);
  assert.doesNotMatch(rows[0].detail, /No database/);
});

test("gap closer: a dead route and a missing row are both named", async () => {
  const read = deadRead({
    file: "netlify.toml",
    text: '[build]\n  publish = "dist"\n'
  });
  const rows = await gapChecks({ db: fakeDb(1), orgId: ORG, readText: read });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /publish is not public/);
  assert.match(rows[0].detail, /1 held call/);
});

test("gap closer: a directory redirect does not kill the pages", () => {
  const report = closerDeskRouteReport(aliveRead);
  assert.equal(report.ok, true);
  assert.deepEqual(report.reasons, []);
});

test("gap closer: a read error is FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation call_outcomes does not exist");
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, readText: aliveRead });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /call_outcomes does not exist/);
});

test("gap closer: the live Closer Dashboard and Present routes are wired", () => {
  const report = closerDeskRouteReport();
  assert.equal(report.ok, true, report.reasons.join("; "));
});
