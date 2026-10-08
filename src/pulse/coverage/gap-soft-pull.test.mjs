import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPROVE_PAGE_PATH,
  APPROVE_READ_PATH,
  CHECK_IDS,
  PAGE_MARKER,
  READ_KIND,
  approveReadShape,
  gapChecks
} from "./gap-soft-pull.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PAGE_HTML = `<!DOCTYPE html><title>Fundhub · Soft-pull approval</title>
<script>fetch("${PAGE_MARKER}?org=&client=&exp=&sig=")</script>`;

const UNSIGNED = JSON.stringify({
  ok: false,
  error: "bad_token",
  message: "This link is missing required fields."
});

const READ_OK = JSON.stringify({
  ok: true,
  kind: READ_KIND,
  disclosure: { version: "v1", text: "It is a soft inquiry" },
  pricing: { base_cents: 3200, base_display: "$32" },
  consent: { valid: false, reason: null },
  contact: { first_name: null, last_name: null }
});

function byId(rows) {
  const map = Object.fromEntries(rows.map((row) => [row.id, row]));
  for (const id of CHECK_IDS) assert.ok(map[id], id);
  return map;
}

function assertShape(rows) {
  assert.equal(rows.length, CHECK_IDS.length);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\)/);
      assert.match(row.suggestedFix, /one tripwire/);
      assert.match(row.suggestedFix, /Do not pull credit/);
      assert.match(row.suggestedFix, /Do not send bureau mail/);
      assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    assert.equal(opts.method, "GET");
    assert.equal(opts.credentials, "omit");
    assert.equal(opts.headers.authorization, undefined);
    assert.equal(opts.body, undefined);
    const hit = routes.find((row) => url === row.url || url.startsWith(row.url));
    if (!hit) throw new Error(`unexpected url ${url}`);
    if (hit.throw) throw new Error(hit.throw);
    return {
      status: hit.status,
      async text() {
        return hit.body ?? "";
      }
    };
  };
  return { fetchImpl, calls };
}

test("gap checks skip when there is no fetch", async () => {
  const rows = await gapChecks({});
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "skip"));
});

test("a loaded screen and an unsigned read both pass", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
  ]);
  const rows = await gapChecks({ fetchImpl, baseUrl: "https://fundhub.ai/" });
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /unsigned link shape/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://fundhub.ai${APPROVE_PAGE_PATH}`);
  assert.equal(calls[0].opts.headers.accept, "text/html");
  assert.equal(calls[1].url, `https://fundhub.ai${APPROVE_READ_PATH}`);
  assert.equal(calls[1].url.includes("?"), false);
  assert.equal(calls[1].opts.headers.accept, "application/json");
});

test("approve screen 404 and 500 fail", async () => {
  for (const status of [404, 500]) {
    const { fetchImpl } = fakeFetch([
      { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status, body: "missing" },
      { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
    ]);
    const rows = await gapChecks({ fetchImpl });
    const page = byId(rows)["soft-pull:approve-page"];
    assert.equal(page.status, "FAIL");
    assert.match(page.detail, new RegExp(`answered ${status}`));
    assert.equal(byId(rows)["soft-pull:approve-read"].status, "PASS");
  }
});

test("a 200 page that is not the approve screen fails", async () => {
  const { fetchImpl } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: "<html>login</html>" },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 401, body: JSON.stringify({ ok: false, error: "invalid_or_expired" }) }
  ]);
  const rows = await gapChecks({ fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-page"].status, "FAIL");
  assert.match(byId(rows)["soft-pull:approve-page"].detail, /without its read route/);
  assert.equal(byId(rows)["soft-pull:approve-read"].status, "PASS");
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /answered 401/);
});

test("read API 404 and 500 fail and a thrown fetch fails", async () => {
  const dead = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 500, body: "engine blew up" }
  ]);
  const boom = await gapChecks({ fetchImpl: dead.fetchImpl });
  const fail = byId(boom)["soft-pull:approve-read"];
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /answered 500/);
  assert.match(fail.detail, /engine blew up/);
  assert.equal(byId(boom)["soft-pull:approve-page"].status, "PASS");

  const missing = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 404, body: "" }
  ]);
  const gone = await gapChecks({ fetchImpl: missing.fetchImpl });
  assert.equal(byId(gone)["soft-pull:approve-read"].status, "FAIL");
  assert.match(byId(gone)["soft-pull:approve-read"].detail, /answered 404/);

  const dropped = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, throw: "socket hang up" },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, throw: "socket hang up" }
  ]);
  const rows = await gapChecks({ fetchImpl: dropped.fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-page"].status, "FAIL");
  assert.match(byId(rows)["soft-pull:approve-page"].detail, /unreachable/);
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /socket hang up/);
});

test("a bad read body fails and the approval shape passes", async () => {
  assert.equal(approveReadShape(400, { ok: false, error: "bad_token" }), true);
  assert.equal(approveReadShape(200, JSON.parse(READ_OK)), true);
  assert.equal(approveReadShape(200, { ok: true, kind: READ_KIND }), false);

  const bad = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: "<html>nope</html>" }
  ]);
  const rows = await gapChecks({ fetchImpl: bad.fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-read"].status, "FAIL");
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /not the approval read shape/);

  const ok = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 200, body: READ_OK }
  ]);
  const passed = await gapChecks({ fetchImpl: ok.fetchImpl });
  assert.equal(byId(passed)["soft-pull:approve-read"].status, "PASS");
  assert.match(byId(passed)["soft-pull:approve-read"].detail, /approval read shape/);
});

test("the file only reads the approve door", () => {
  const text = fs.readFileSync(path.join(HERE, "gap-soft-pull.mjs"), "utf8");
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(text, /method:\s*["']POST["']/);
  assert.doesNotMatch(text, /requestSoftPull|finance\/soft-pull|postgrid|PostGrid/i);
  assert.match(text, /one tripwire/);
  assert.match(text, /Do not invent a second watchdog/);
});
