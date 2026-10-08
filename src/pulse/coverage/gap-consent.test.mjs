// Consent gap — fakes only. No live database. No consent is recorded.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { SOFT_PULL_KIND as ROLLUP_KIND } from "../../fulfillment/read-signals.mjs";
import { PULSE_REGISTRY } from "../registry.mjs";
import {
  CHECK_IDS,
  CONSENT_API_PATH,
  CONSENT_PAGE_PATH,
  REQUIRED_SQL,
  SOFT_PULL_KIND,
  STORE_SQL,
  consentDoorsListed,
  doorUp,
  gapChecks
} from "./gap-consent.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const SHAPE = ["detail", "id", "status", "suggestedFix"];

function db(counts = { required: 0, store: 0 }, calls = []) {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (String(sql).includes("FROM clients c")) return { rows: [{ n: counts.required }] };
      if (String(sql).includes("FROM contracts ct")) return { rows: [{ n: counts.store }] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

function assertShape(rows) {
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), SHAPE);
    assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Do not record consent for a real person/);
      assert.match(row.suggestedFix, /Do not auto-fix/);
      assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

test("consent doors are on the morning pulse list", () => {
  assert.equal(consentDoorsListed(PULSE_REGISTRY), true);
  assert.equal(SOFT_PULL_KIND, ROLLUP_KIND);
  assert.match(REQUIRED_SQL, /revoked_at IS NULL/);
  assert.ok(REQUIRED_SQL.includes(CONSENT_VALID_SQL.trim()));
  assert.match(STORE_SQL, /revoked_at >= ct\.signed_at/);
  assert.match(STORE_SQL, /signed_document_id IS NULL/);
  assert.doesNotMatch(REQUIRED_SQL, /\b(insert|update|delete|email|ssn)\b/i);
  assert.doesNotMatch(STORE_SQL, /\b(insert|update|delete|email|signer_name|ssn)\b/i);
});

test("doorUp: page needs 2xx, API may refuse a bare GET", () => {
  assert.equal(doorUp("page", 200), true);
  assert.equal(doorUp("page", 401), false);
  assert.equal(doorUp("page", 500), false);
  assert.equal(doorUp("api", 401), true);
  assert.equal(doorUp("api", 400), true);
  assert.equal(doorUp("api", 403), true);
  assert.equal(doorUp("api", 405), true);
  assert.equal(doorUp("api", 404), false);
  assert.equal(doorUp("api", 500), false);
});

test("no database and no ping → three skips, and the site is not called", async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => {
    called = true;
    throw new Error("should not fetch");
  };
  try {
    const rows = await gapChecks({});
    assert.equal(called, false);
    assertShape(rows);
    assert.ok(rows.every((row) => row.status === "skip"));
  } finally {
    globalThis.fetch = orig;
  }
});

test("live doors up and zero rows → three PASS", async () => {
  const calls = [];
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 0 }, calls),
    doors: { page: 200, api: 401 }
  });
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(String(call.sql).trim(), /^select\b/i);
    assert.equal(call.params[0], ORG);
    assert.equal(call.params[1], false);
  }
  assert.equal(calls.find((c) => String(c.sql).includes("FROM clients c")).params[2], SOFT_PULL_KIND);
});

test("a dead page fails the door reading and does not write", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 0 }),
    doors: { page: 500, api: 401 }
  });
  assertShape(rows);
  const doors = rows.find((row) => row.id === "consent:doors");
  assert.equal(doors.status, "FAIL");
  assert.match(doors.detail, /500/);
  assert.equal(rows.find((row) => row.id === "consent:required").status, "PASS");
  assert.equal(rows.find((row) => row.id === "consent:store").status, "PASS");
});

test("API 404 is a dead door", async () => {
  const rows = await gapChecks({
    doors: { page: 200, api: 404 }
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /404/);
});

test("morning pulse rows are reused and fetch is not called again", async () => {
  let called = false;
  const rows = await gapChecks({
    fetchImpl: () => {
      called = true;
      return { status: 500 };
    },
    registryChecks: [
      { id: "reg:consent-capture", path: CONSENT_PAGE_PATH, status: "up", detail: "/app/consent-capture.html 200" },
      { id: "reg:consent/capture", path: CONSENT_API_PATH, status: "down", detail: "/api/consent/capture answered 500" }
    ]
  });
  assert.equal(called, false);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /500/);
});

test("fetch, when asked, is GET only and carries no client", async () => {
  const calls = [];
  const rows = await gapChecks({
    orgId: ORG,
    db: db(),
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      if (String(url).endsWith(CONSENT_API_PATH)) return { status: 401 };
      return { status: 200 };
    }
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.url).sort(), [
    `https://fundhub.ai${CONSENT_API_PATH}`,
    `https://fundhub.ai${CONSENT_PAGE_PATH}`
  ]);
  for (const call of calls) {
    assert.equal(call.opts.method, "GET");
    assert.equal(call.opts.body, undefined);
    assert.equal(String(call.url).includes("client"), false);
  }
  assert.equal(rows[0].status, "PASS");
});

test("a client who must have consent and has none is a FAIL", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 2, store: 0 }),
    doors: { page: 200, api: 401 }
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "consent:required");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 clients/);
  assert.equal(rows.find((r) => r.id === "consent:store").status, "PASS");
});

test("a signed paper with no consent row is a FAIL", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 0, store: 1 }),
    doors: { page: 200, api: 400 }
  });
  const row = rows.find((r) => r.id === "consent:store");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 signed soft-pull paper/);
});

test("one client missing consent uses the singular", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    db: db({ required: 1, store: 0 }),
    doors: { page: 200, api: 401 }
  });
  assert.match(rows.find((r) => r.id === "consent:required").detail, /1 client paid/);
});

test("a read error fails that reading and still returns all three", async () => {
  const rows = await gapChecks({
    orgId: ORG,
    doors: { page: 200, api: 401 },
    db: {
      query: async (sql) => {
        if (String(sql).includes("FROM contracts ct")) throw new Error("db down");
        return { rows: [{ n: 0 }] };
      }
    }
  });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.id === "consent:required").status, "PASS");
  const store = rows.find((r) => r.id === "consent:store");
  assert.equal(store.status, "FAIL");
  assert.match(store.detail, /db down/);
});

test("missing page file fails without calling the site", async () => {
  let called = false;
  const rows = await gapChecks({
    build: { page: false, api: true, registry: true },
    fetchImpl: () => {
      called = true;
      return { status: 200 };
    }
  });
  assert.equal(called, false);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /consent-capture\.html is missing/);
});

test("missing route fails the door reading", async () => {
  const rows = await gapChecks({
    build: { page: true, api: false, registry: true }
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /route consent\/capture is missing/);
});

test("demoOn is passed through and a bad org does not query", async () => {
  const calls = [];
  const rows = await gapChecks({
    orgId: "not-a-uuid",
    demoOn: true,
    db: db({ required: 0, store: 0 }, calls),
    doors: { page: 200, api: 401 }
  });
  assert.equal(calls.length, 0);
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "skip");

  const again = [];
  await gapChecks({
    orgId: ORG,
    demoOn: true,
    db: db({ required: 0, store: 0 }, again),
    doors: { page: 200, api: 401 }
  });
  assert.ok(again.every((call) => call.params[1] === true));
});

test("the module does not record consent or start another monitor", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-consent.mjs"), "utf8");
  assert.doesNotMatch(src, /captureConsent/);
  assert.doesNotMatch(src, /\bINSERT\b/);
  assert.doesNotMatch(src, /\bUPDATE\b/);
  assert.doesNotMatch(src, /\bDELETE\b/);
  assert.doesNotMatch(src, /method:\s*["']POST["']/);
  assert.doesNotMatch(src, /setInterval|setTimeout|inngest|checkRegistry/);
  assert.doesNotMatch(src, /<html/);
});
