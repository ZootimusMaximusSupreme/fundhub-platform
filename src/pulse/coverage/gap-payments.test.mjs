import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  LINK_WEBHOOK_GRACE_MS,
  commasWebhookRouteAlive,
  gapChecks
} from "./gap-payments.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-payments.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

function fakeDb(counts) {
  return {
    async query(sql) {
      if (/gap:invoice-stuck/.test(sql)) return { rows: [{ n: counts.invoice ?? 0 }] };
      if (/gap:pay-link-webhook/.test(sql)) return { rows: [{ n: counts.payLink ?? 0 }] };
      if (/gap:paid-no-entitlement/.test(sql)) return { rows: [{ n: counts.entitlement ?? 0 }] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

const aliveRead = (rel) => {
  if (rel.endsWith("api.mjs")) {
    return 'if (!route && path.startsWith("webhooks/")) { route = webhooks; }';
  }
  if (rel.endsWith("router.mjs")) {
    return "import { handleCommasWebhook } from '../adapters/commas.mjs';\ncommas: { fn: handleCommasWebhook, sig: [] },";
  }
  if (rel.endsWith("[provider].mjs")) {
    return "export default async function handler(req, res) { await handleWebhook({}); }";
  }
  throw new Error(`unexpected read: ${rel}`);
};

const deadRead = (rel) => {
  if (rel.endsWith("api.mjs")) return "no webhook prefix here";
  if (rel.endsWith("router.mjs")) return "no commas handler here";
  if (rel.endsWith("[provider].mjs")) return "export default async function handler() {}";
  throw new Error(`unexpected read: ${rel}`);
};

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
    assert.doesNotMatch(row.suggestedFix, /products\/create/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

test("gap payments: source stays read-only", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /products\/create/);
  assert.doesNotMatch(SRC, /createCheckoutSession/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.equal(LINK_WEBHOOK_GRACE_MS, 3 * 60 * 1000);
  assert.deepEqual([...CHECK_IDS], [
    "payments:invoice-stuck",
    "payments:pay-link-webhook",
    "payments:paid-no-entitlement",
    "payments:commas-webhook-route"
  ]);
});

test("gap payments: no database skips the three reads and still checks the route", async () => {
  const rows = await gapChecks({ readText: aliveRead });
  assert.equal(rows.length, 4);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip", "PASS"]);
});

test("gap payments: clear books are four PASS rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: new Date("2026-10-08T15:00:00Z"), readText: aliveRead });
  assert.equal(rows.length, 4);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.match(call.sql, /^\s*\/\* gap:/);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE)\b/i);
    assert.equal(call.params[0], ORG);
  }
  const linkCall = seen.find((c) => /gap:pay-link-webhook/.test(c.sql));
  assert.equal(linkCall.params[1], "2026-10-08T14:57:00.000Z");
});

test("gap payments: each named break is a FAIL and the others stay PASS", async () => {
  const cases = [
    { counts: { invoice: 2 }, id: "payments:invoice-stuck", detail: /2 invoices stuck/ },
    { counts: { payLink: 1 }, id: "payments:pay-link-webhook", detail: /1 pay link minted/ },
    { counts: { entitlement: 3 }, id: "payments:paid-no-entitlement", detail: /3 succeeded payments/ }
  ];
  for (const c of cases) {
    const rows = await gapChecks({ db: fakeDb(c.counts), orgId: ORG, readText: aliveRead });
    rows.forEach(shape);
    const hit = rows.find((r) => r.id === c.id);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, c.detail);
    const rest = rows.filter((r) => r.id !== c.id);
    assert.ok(rest.every((r) => r.status === "PASS"));
  }
});

test("gap payments: a dead Commas webhook route is FAIL and does not ping the network", async () => {
  const rows = await gapChecks({ db: fakeDb({}), orgId: ORG, readText: deadRead });
  rows.forEach(shape);
  const route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "FAIL");
  assert.match(route.detail, /route is dead/);
  assert.match(route.suggestedFix, /\/api\/webhooks\/commas/);
  assert.ok(rows.filter((r) => r.id !== route.id).every((r) => r.status === "PASS"));
  assert.equal(commasWebhookRouteAlive(deadRead), false);
  assert.equal(commasWebhookRouteAlive(aliveRead), true);
});

test("gap payments: a read error is FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation v_invoice_aging does not exist");
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, readText: aliveRead });
  rows.forEach(shape);
  assert.ok(rows.slice(0, 3).every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /v_invoice_aging/);
  assert.equal(rows[3].status, "PASS");
});

test("gap payments: the live Commas webhook files are still wired", () => {
  assert.equal(commasWebhookRouteAlive(), true);
});
