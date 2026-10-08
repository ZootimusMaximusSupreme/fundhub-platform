import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  OWNER_TOOLS,
  gapChecks,
  readStatusUp
} from "./gap-owner-tools.mjs";
import { CHECKS as OWNER_SLICE } from "./slice-30-csm-owner.mjs";
import { CHECKS as PARTNER_SLICE } from "./slice-31-affiliate-wl.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const WRITE_PATHS = [
  "/api/marketing/shoot/mark",
  "/api/marketing/shoot/take",
  "/api/journeys/ask",
  "/api/journeys/run",
  "/api/content/upload",
  "/api/scripts/write",
  "/api/creative/generate",
  "/api/creative/run",
  "/api/partner-brand",
  "/api/org-brand"
];

function fakeFetch(statusFor) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET", init });
    const pathName = String(url).replace(/^https?:\/\/[^/]+/, "");
    const hit = typeof statusFor === "function" ? statusFor(pathName) : statusFor;
    if (hit && hit.throw) throw new Error(hit.throw);
    const status = hit && typeof hit === "object" ? hit.status : hit;
    return { status: status == null ? 599 : status, async text() { return ""; } };
  };
  return { fetchImpl, calls };
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  assert.match(row.detail, /Did not change brand assets/);
  assert.match(row.detail, /Did not start a teleprompter session/);
  assert.match(row.detail, /Did not edit a page/);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not add another watcher/);
    assert.match(row.suggestedFix, /Do not change brand assets/);
    assert.match(row.suggestedFix, /Do not start a teleprompter session/);
    assert.match(row.suggestedFix, /Do not edit a page/);
    assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

function assertGetsOnly(calls) {
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.body, undefined);
    for (const banned of WRITE_PATHS) {
      if (banned === "/api/org-brand") {
        assert.equal(call.method, "GET");
        continue;
      }
      assert.equal(call.url.includes(banned), false, call.url);
    }
    assert.equal(/partner-galaxy\.html/.test(call.url), false);
  }
}

test("gap owner tools: source stays a read-only GET", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-owner-tools.mjs"), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.match(src, /Recon \(AG-07\) is the one tripwire/);
  assert.match(src, /does not start a second watchdog/);
  assert.doesNotMatch(src, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(src, /shoot\/mark|shoot\/take|journeys\/ask|journeys\/run/);
  assert.doesNotMatch(src, /content\/upload|scripts\/write|creative\/generate|creative\/run/);
  assert.doesNotMatch(src, /partner-brand|verify-domain|writeFile/);
  assert.doesNotMatch(src, /second tripwire|new watchdog/i);
  assert.equal(readStatusUp(500), false);
  assert.equal(readStatusUp(404), false);
  assert.equal(readStatusUp(401), true);
  assert.equal(readStatusUp(200), true);
  assert.equal(readStatusUp(405), true);
  assert.deepEqual([...CHECK_IDS], OWNER_TOOLS.map((tool) => tool.id));
  assert.equal(OWNER_TOOLS.some((tool) => tool.desk === "partner-galaxy.html"), false);
  assert.equal(OWNER_TOOLS.find((tool) => tool.id === "owner-tools:brand-studio").read, "/api/org-brand");
  assert.equal(OWNER_TOOLS.find((tool) => tool.id === "owner-tools:teleprompter").read, "/api/marketing/shoot");
});

test("gap owner tools: no fetch skips all seven", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "skip");
  }
});

test("gap owner tools: live desks and calm reads pass, and every call is GET", async () => {
  const { fetchImpl, calls } = fakeFetch((pathName) => {
    if (pathName.startsWith("/app/")) return 200;
    if (pathName === "/api/marketing/shoot") return 200;
    return 401;
  });
  const rows = await gapChecks({ fetchImpl, baseUrl: "https://fundhub.ai/" });
  assert.equal(rows.length, 7);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "PASS");
  }
  assert.equal(calls.length, 14);
  assertGetsOnly(calls);
  const shoot = calls.find((call) => call.url.endsWith("/api/marketing/shoot"));
  assert.ok(shoot);
  assert.equal(shoot.method, "GET");
  const brand = calls.find((call) => call.url.endsWith("/api/org-brand"));
  assert.ok(brand);
  assert.equal(brand.method, "GET");
});

test("gap owner tools: a desk 404 fails that tool and names the path", async () => {
  const { fetchImpl, calls } = fakeFetch((pathName) => {
    if (pathName === "/app/journeys.html") return 404;
    if (pathName.startsWith("/app/")) return 200;
    return 401;
  });
  const rows = await gapChecks({ fetchImpl, baseUrl: "https://fundhub.ai" });
  rows.forEach(shape);
  const hit = rows.find((row) => row.id === "owner-tools:journeys");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /404/);
  assert.match(hit.detail, /\/app\/journeys\.html/);
  const rest = rows.filter((row) => row.id !== "owner-tools:journeys");
  assert.ok(rest.every((row) => row.status === "PASS"));
  assertGetsOnly(calls);
});

test("gap owner tools: a read API 500 fails that tool, and 401 stays up", async () => {
  const { fetchImpl, calls } = fakeFetch((pathName) => {
    if (pathName === "/api/read/company-activity") return 500;
    if (pathName.startsWith("/app/")) return 200;
    return 401;
  });
  const rows = await gapChecks({ fetchImpl });
  rows.forEach(shape);
  const hit = rows.find((row) => row.id === "owner-tools:galaxy");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /\/api\/read\/company-activity answered 500/);
  const rest = rows.filter((row) => row.id !== "owner-tools:galaxy");
  assert.ok(rest.every((row) => row.status === "PASS"));
  assertGetsOnly(calls);
});

test("gap owner tools: a missing read and a dead desk are both named", async () => {
  const { fetchImpl } = fakeFetch((pathName) => {
    if (pathName === "/app/brand-studio.html") return 404;
    if (pathName === "/api/org-brand") return 500;
    if (pathName.startsWith("/app/")) return 200;
    return 403;
  });
  const rows = await gapChecks({ fetchImpl });
  const hit = rows.find((row) => row.id === "owner-tools:brand-studio");
  shape(hit);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /brand-studio\.html answered 404/);
  assert.match(hit.detail, /\/api\/org-brand answered 500/);
  assert.match(hit.suggestedFix, /Do not change brand assets/);
});

test("gap owner tools: a thrown fetch is a fail and does not throw out", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ throw: "socket hang up" }));
  const rows = await gapChecks({ fetchImpl });
  assert.equal(rows.length, 7);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, /socket hang up/);
  }
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("gap owner tools: these ids are not slice 30 or slice 31 doors", async () => {
  const rows = await gapChecks({});
  const mine = new Set(rows.map((row) => row.id));
  for (const row of OWNER_SLICE) assert.equal(mine.has(row.id), false);
  for (const row of PARTNER_SLICE) assert.equal(mine.has(row.id), false);
  assert.equal(OWNER_SLICE.some((row) => row.id === "galaxy.html"), false);
  assert.equal(PARTNER_SLICE.some((row) => row.id === "galaxy.html"), false);
});
