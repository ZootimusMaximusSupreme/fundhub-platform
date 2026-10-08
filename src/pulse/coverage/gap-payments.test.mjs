import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  LINK_WEBHOOK_GRACE_MS,
  SIM_RECEIPT_PREFIX,
  commasWebhookFilesState,
  commasWebhookRouteAlive,
  gapChecks,
  probeCommasDoor
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

// ---- Review — Claude, 2026-10-08 ------------------------------------------

function sqlOf(tag) {
  const m = SRC.match(new RegExp("/\\* gap:" + tag + " \\*/[\\s\\S]*?`;"));
  assert.ok(m, `sql block ${tag} not found`);
  return m[0];
}

test("gap payments: the pay link check no longer hides behind commas_session_id", () => {
  // Every link minted through Commas carries that id from the start, so a
  // "commas_session_id IS NULL" filter matched nothing on production.
  const sql = sqlOf("pay-link-webhook");
  assert.doesNotMatch(sql, /commas_session_id/);
  assert.match(sql, /pl\.status IN \('created', 'sent'\)/);
  assert.match(sql, /t\.created_at < \$2::timestamptz/, "grace sits on the payment");
  assert.match(sql, /other\.link_ref = t\.raw_payload ->> 'ref'/, "a payment through another link of ours is not this break");
  assert.match(sql, /position\(pl\.link_ref in ci\.raw_body\) > 0/);
  assert.match(sql, /COALESCE\(t\.is_demo, false\) = false/);
});

test("gap payments: the entitlement check keeps simulated receipts out of the FAIL and says so", async () => {
  const sql = sqlOf("paid-no-entitlement");
  assert.match(sql, /NOT LIKE \$3::text/);
  assert.match(sql, /COALESCE\(t\.is_demo, false\) = false/);
  assert.match(sql, /t\.created_at < \$2::timestamptz/);
  assert.equal(SIM_RECEIPT_PREFIX, "sim-pay-");

  const seen = [];
  const mk = (n, sim_n) => ({
    async query(q, params) {
      if (/gap:paid-no-entitlement/.test(q)) {
        seen.push(params);
        return { rows: [{ n, sim_n }] };
      }
      return { rows: [{ n: 0 }] };
    }
  });
  const now = new Date("2026-10-08T15:00:00Z");

  let rows = await gapChecks({ db: mk(0, 8), orgId: ORG, now, readText: aliveRead });
  let hit = rows.find((r) => r.id === "payments:paid-no-entitlement");
  assert.equal(hit.status, "PASS");
  assert.match(hit.detail, /8 simulated receipts left out/);

  rows = await gapChecks({ db: mk(2, 8), orgId: ORG, now, readText: aliveRead });
  hit = rows.find((r) => r.id === "payments:paid-no-entitlement");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /^2 succeeded payments/);
  assert.match(hit.detail, /8 simulated receipts left out/);
  assert.match(hit.suggestedFix, /Recon \(AG-07\)/);

  assert.deepEqual(seen[0], [ORG, "2026-10-08T14:57:00.000Z", "sim-pay-%"]);
});

test("gap payments: no org id is a skip that says so, not 'no database'", async () => {
  const db = { async query() { throw new Error("must not be called"); } };
  const rows = await gapChecks({ db, readText: aliveRead });
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip", "PASS"]);
  assert.match(rows[0].detail, /no org id/);
  const none = await gapChecks({ orgId: ORG, readText: aliveRead });
  assert.match(none[0].detail, /no database/);
});

test("gap payments: the router probe sends an unsigned empty post, to commas, with a closed database", async () => {
  let got;
  const handle = async (args) => {
    got = args;
    return { status: 401, body: { ok: false, reason: "bad_signature" } };
  };
  const status = await probeCommasDoor(handle);
  assert.equal(status, 401);
  assert.equal(got.provider, "commas");
  assert.equal(got.rawBody, "{}");
  assert.deepEqual(got.headers, {});
  assert.equal(got.env.WEBHOOK_CAPTURE, "0");
  assert.equal(got.env.COMMAS_WEBHOOK_SECRET, "gap-probe-not-a-key", "a throwaway string, never the real key");
  await assert.rejects(() => got.db.query("INSERT INTO commas_inbox DEFAULT VALUES"), /closed to the probe/);
  // The real router, no stub: registered provider refuses an unsigned post.
  assert.equal(await probeCommasDoor(), 401);
});

test("gap payments: route check FAILs when the router does not know commas, answers wrong, or throws", async () => {
  const cases = [
    { handleWebhook: async () => ({ status: 404 }), detail: /does not know the commas provider/ },
    { handleWebhook: async () => ({ status: 200 }), detail: /should answer 401 and answered 200/ },
    { handleWebhook: async () => ({ status: 500 }), detail: /answered 500/ },
    { handleWebhook: async () => { throw new Error("cannot load adapter"); }, detail: /router would not answer \(cannot load adapter\)/ }
  ];
  for (const c of cases) {
    const rows = await gapChecks({ db: fakeDb({}), orgId: ORG, readText: aliveRead, handleWebhook: c.handleWebhook });
    rows.forEach(shape);
    const route = rows.find((r) => r.id === "payments:commas-webhook-route");
    assert.equal(route.status, "FAIL");
    assert.match(route.detail, c.detail);
    assert.match(route.suggestedFix, /\/api\/webhooks\/commas/);
  }
});

test("gap payments: source files that cannot be opened are not a dead route", async () => {
  const gone = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
  assert.equal(commasWebhookFilesState(gone), "unreadable");
  assert.equal(commasWebhookFilesState(aliveRead), "alive");
  assert.equal(commasWebhookFilesState(deadRead), "dead");
  assert.equal(commasWebhookRouteAlive(gone), false);
  const ok = async () => ({ status: 401 });
  let rows = await gapChecks({ db: fakeDb({}), orgId: ORG, readText: gone, handleWebhook: ok });
  let route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "PASS");
  assert.match(route.detail, /router in process/);
  // The router saying 404 still fails it, whatever the files say.
  rows = await gapChecks({ db: fakeDb({}), orgId: ORG, readText: gone, handleWebhook: async () => ({ status: 404 }) });
  route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "FAIL");
});

test("gap payments: the live site GET is 405 when the webhooks prefix is mounted, FAIL on 404, skip when unreachable", async () => {
  const ok = async () => ({ status: 401 });
  const urls = [];
  const mk = (status) => async (url, init) => {
    urls.push({ url, method: init.method });
    return { status };
  };
  const base = { db: fakeDb({}), orgId: ORG, readText: aliveRead, handleWebhook: ok, baseUrl: "https://fundhub.ai/" };

  let rows = await gapChecks({ ...base, fetchImpl: mk(405) });
  let route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "PASS");
  assert.match(route.detail, /405 to a GET/);
  assert.deepEqual(urls[0], { url: "https://fundhub.ai/api/webhooks/commas", method: "GET" });

  for (const status of [404, 500, 200]) {
    rows = await gapChecks({ ...base, fetchImpl: mk(status) });
    route = rows.find((r) => r.id === "payments:commas-webhook-route");
    assert.equal(route.status, "FAIL", `status ${status}`);
    assert.match(route.detail, new RegExp(`answered ${status}`));
  }

  rows = await gapChecks({ ...base, fetchImpl: async () => { throw new Error("network down"); } });
  route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "skip");
  assert.match(route.detail, /network down/);
  assert.equal(route.suggestedFix, null);

  // ctx.fetch is accepted as an alias for ctx.fetchImpl.
  rows = await gapChecks({ ...base, fetch: mk(404) });
  route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "FAIL");
});
