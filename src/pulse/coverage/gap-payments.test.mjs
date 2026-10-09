import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARD_DECLINED_NO_FOLLOWUP_SQL,
  CHECKOUT_LINK_WAIT_MS,
  CHECKOUT_LOOKBACK_MS,
  CHECKOUT_STARTED_NO_LINK_SQL,
  CHECK_IDS,
  COMMAS_INBOX_WAITING_SQL,
  DECLINE_LOOKBACK_MS,
  DECLINE_WAIT_MS,
  INBOX_PROCESSING_WAIT_MS,
  INBOX_WAIT_MS,
  LINK_WEBHOOK_GRACE_MS,
  PAID_LOOKBACK_MS,
  PAID_PRODUCT_UNMAPPED_SQL,
  PING_TIMEOUT_MS,
  SIM_RECEIPT_PREFIX,
  TEST_CLIENT_EMAIL_RE,
  commasWebhookFilesState,
  commasWebhookRouteAlive,
  gapChecks,
  probeCommasDoor
} from "./gap-payments.mjs";
import { MAX_ATTEMPTS, STALE_CLAIM_MINUTES } from "../../payments/commas-inbox.mjs";
import { TEST_CLIENT_EMAIL_RE as CONSENT_TEST_RE } from "./gap-consent.mjs";
import { TEST_CLIENT_EMAIL_RE as PORTAL_TEST_RE } from "./gap-portal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-payments.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

function fakeDb(counts) {
  return {
    async query(sql) {
      if (/gap:invoice-stuck/.test(sql)) return { rows: [{ n: counts.invoice ?? 0 }] };
      if (/gap:pay-link-webhook/.test(sql)) return { rows: [{ n: counts.payLink ?? 0 }] };
      if (/gap:paid-no-entitlement/.test(sql)) return { rows: [{ n: counts.entitlement ?? 0 }] };
      if (/gap:(paid-product-unmapped|commas-inbox-waiting|checkout-started-no-link|card-declined-no-followup)/.test(sql)) {
        return { rows: [{ n: 0 }] };
      }
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
    "payments:commas-webhook-route",
    "payments:paid-product-unmapped",
    "payments:commas-inbox-waiting",
    "payments:checkout-started-no-link",
    "payments:card-declined-no-followup"
  ]);
});

test("gap payments: no database skips the three reads and still checks the route", async () => {
  const rows = await gapChecks({ readText: aliveRead });
  assert.equal(rows.length, 8);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip", "PASS", "skip", "skip", "skip", "skip"]);
});

test("gap payments: clear books are eight PASS rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: new Date("2026-10-08T15:00:00Z"), readText: aliveRead });
  assert.equal(rows.length, 8);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(seen.length, 7);
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
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip", "PASS", "skip", "skip", "skip", "skip"]);
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

// ---- Second review — Claude, 2026-10-08 -------------------------------------

function linkDb(linkRow) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      if (/gap:pay-link-webhook/.test(sql)) return { rows: [linkRow] };
      return { rows: [{ n: 0 }] };
    }
  };
}

const NOW = new Date("2026-10-08T15:00:00Z");

test("gap payments: the pay link FAIL names how the money reached the link, and the call carries the sim prefix", async () => {
  const db = linkDb({ n: 3, rec_n: 2, money_n: 1, sim_n: 0 });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, readText: aliveRead });
  rows.forEach(shape);
  const hit = rows.find((r) => r.id === "payments:pay-link-webhook");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /^3 pay links minted and still open after money landed/);
  assert.match(hit.detail, /2 with a processed Commas payment\.succeeded row for the link ref/);
  assert.match(hit.detail, /1 with a payment from the same client for the same amount/);
  assert.doesNotMatch(hit.detail, /simulated/);
  assert.match(hit.suggestedFix, /Do not mint another link/);
  const call = db.seen.find((c) => /gap:pay-link-webhook/.test(c.sql));
  assert.deepEqual(call.params, [ORG, "2026-10-08T14:57:00.000Z", "sim-pay-%"]);
});

test("gap payments: open links held only by simulated receipts are a PASS that says so", async () => {
  const db = linkDb({ n: 0, rec_n: 0, money_n: 0, sim_n: 2 });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, readText: aliveRead });
  const hit = rows.find((r) => r.id === "payments:pay-link-webhook");
  assert.equal(hit.status, "PASS");
  assert.match(hit.detail, /2 open links with a simulated receipt left out: no card was charged/);
  // A real hit next to simulated ones is still a FAIL, and says both.
  const mixed = await gapChecks({ db: linkDb({ n: 1, rec_n: 1, money_n: 0, sim_n: 2 }), orgId: ORG, now: NOW, readText: aliveRead });
  const mixedHit = mixed.find((r) => r.id === "payments:pay-link-webhook");
  assert.equal(mixedHit.status, "FAIL");
  assert.match(mixedHit.detail, /2 open links with a simulated receipt left out/);
});

test("gap payments: the pay link SQL ties the money to the link and reads the inbox as proof", () => {
  const sql = sqlOf("pay-link-webhook");
  assert.match(sql, /round\(t\.amount_paid \* 100\) = pl\.amount_cents/, "money must match the link amount in cents");
  assert.match(sql, /other\.id <> pl\.id/, "only a DIFFERENT link of ours clears a payment");
  assert.match(sql, /ci\.event_type = 'payment\.succeeded'/);
  assert.match(sql, /ci\.status IN \('done', 'ignored'\)/);
  assert.match(sql, /COALESCE\(ci\.processed_at, ci\.received_at\) < \$2::timestamptz/, "grace sits on the receipt");
  assert.match(sql, /COALESCE\(ci\.payment_id, ''\) NOT LIKE \$3::text/, "simulated inbox rows are kept out of rec");
  assert.match(sql, /COALESCE\(t\.provider_ref, ''\) NOT LIKE \$3::text/, "simulated payments are kept out of money");
  assert.doesNotMatch(sql, /commas_session_id/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
});

test("gap payments: the site GET carries a timeout so a hung site cannot eat the lane's step", async () => {
  const ok = async () => ({ status: 401 });
  let init;
  const fetchImpl = async (url, i) => {
    init = i;
    return { status: 405 };
  };
  const rows = await gapChecks({
    db: fakeDb({}), orgId: ORG, readText: aliveRead, handleWebhook: ok, fetchImpl, baseUrl: "https://fundhub.ai"
  });
  const route = rows.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(route.status, "PASS");
  assert.match(route.detail, /webhooks\/ prefix is mounted/);
  assert.ok(init.signal instanceof AbortSignal, "the GET must carry an abort signal");
  assert.equal(PING_TIMEOUT_MS, 8000);
  // A site that times out is a skip with the reason, not a PASS and not a thrown error.
  const timedOut = async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  };
  const slow = await gapChecks({
    db: fakeDb({}), orgId: ORG, readText: aliveRead, handleWebhook: ok, fetchImpl: timedOut, baseUrl: "https://fundhub.ai"
  });
  const slowRoute = slow.find((r) => r.id === "payments:commas-webhook-route");
  assert.equal(slowRoute.status, "skip");
  assert.match(slowRoute.detail, /aborted due to timeout/);
});

// ---- The three money SQL statements, run for real ---------------------------
//
// The tests above only read the SQL text and feed it canned counts. These run the
// real statements against Postgres, with every table they read replaced by small
// made-up ones (WITH payment_links AS (VALUES ...)). Nothing is read from or
// written to a real table, so it is safe on any database, production included.
// One exception is stated where it happens: the product resolver function cannot
// be shadowed, so the entitlement test swaps that one call for a plain name match.
// Skipped, and said so, when there is no DATABASE_URL.

const HAS_DB = Boolean(process.env.DATABASE_URL);

const LINK_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["link_ref", "text"],
  ["status", "text"], ["is_demo", "boolean"], ["created_at", "timestamptz"], ["amount_cents", "bigint"]
];
const INBOX_COLS = [
  ["org_id", "uuid"], ["event_type", "text"], ["status", "text"], ["processed_at", "timestamptz"],
  ["received_at", "timestamptz"], ["payment_id", "text"], ["raw_body", "text"]
];
const TX_COLS = [
  ["org_id", "uuid"], ["client_id", "uuid"], ["status", "text"], ["is_demo", "boolean"],
  ["provider_ref", "text"], ["created_at", "timestamptz"], ["amount_paid", "numeric"], ["raw_payload", "jsonb"]
];

function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `'${text.replace(/'/g, "''")}'`;
}

function shadow(name, cols, rows) {
  const names = cols.map(([c]) => c).join(", ");
  if (!rows.length) {
    return `${name} AS (SELECT ${cols.map(([c, ty]) => `NULL::${ty} AS ${c}`).join(", ")} WHERE false)`;
  }
  const values = rows
    .map((r) => `(${cols.map(([c, ty]) => `${lit(r[c])}::${ty}`).join(", ")})`)
    .join(", ");
  return `${name} AS (SELECT * FROM (VALUES ${values}) AS v(${names}))`;
}

function runnableSql(tag, shadows, patch = (text) => text) {
  const body = patch(sqlOf(tag).replace(/`;$/, ""));
  assert.doesNotMatch(body, /\$\{/, "the SQL under test must not be a template with holes");
  return `WITH ${shadows.join(",\n")}\n${body}`;
}

function runnablePayLinkSql({ links, inbox, txs }) {
  return runnableSql("pay-link-webhook", [
    shadow("payment_links", LINK_COLS, links),
    shadow("commas_inbox", INBOX_COLS, inbox),
    shadow("transactions", TX_COLS, txs)
  ]);
}

const L1 = "aaaaaaaa-0000-4000-8000-000000000001";
const L2 = "aaaaaaaa-0000-4000-8000-000000000002";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const C2 = "cccccccc-0000-4000-8000-000000000002";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const REF1 = "slo_gap_test_link_one";
const REF2 = "slo_gap_test_link_two";

const link = (over = {}) => ({
  id: L1, org_id: ORG, client_id: C1, link_ref: REF1, status: "sent", is_demo: false,
  created_at: "2026-10-01T12:00:00Z", amount_cents: 29700, ...over
});
const inboxRow = (over = {}) => ({
  org_id: ORG, event_type: "payment.succeeded", status: "done",
  processed_at: "2026-10-08T13:00:05Z", received_at: "2026-10-08T13:00:00Z", payment_id: "ORD-REAL-1",
  raw_body: JSON.stringify({ data: { api_metadata: { data: { link_ref: REF1 } } } }), ...over
});
const tx = (over = {}) => ({
  org_id: ORG, client_id: C1, status: "succeeded", is_demo: false, provider_ref: "ORD-REAL-2",
  created_at: "2026-10-08T13:00:00Z", amount_paid: "297.00", raw_payload: { ref: null }, ...over
});

// want is [n, rec_n, money_n, sim_n]. The cutoff the check passes is 14:57:00Z.
const PAY_LINK_CASES = [
  ["an open link nobody has paid is clean (a webhook that never came leaves no trace to find)", {}, [0, 0, 0, 0]],
  ["recorded, never settled: a processed payment.succeeded row carries the ref", { inbox: [inboxRow()] }, [1, 1, 0, 0]],
  ["an ignored payment.succeeded row for the ref counts too", { inbox: [inboxRow({ status: "ignored" })] }, [1, 1, 0, 0]],
  ["a row processed 2 minutes ago is inside the grace", { inbox: [inboxRow({ processed_at: "2026-10-08T14:58:00Z" })] }, [0, 0, 0, 0]],
  ["a simulated receipt is counted apart, not a FAIL", { inbox: [inboxRow({ payment_id: "sim-pay-1791356756243" })] }, [0, 0, 0, 1]],
  ["a real row next to a simulated one is a real hit", { inbox: [inboxRow(), inboxRow({ payment_id: "sim-pay-1" })] }, [1, 1, 0, 0]],
  ["a payment.failed row does not settle or break anything", { inbox: [inboxRow({ event_type: "payment.failed" })] }, [0, 0, 0, 0]],
  ["a row still pending is the sweeper's job, not this check", { inbox: [inboxRow({ status: "pending", processed_at: null })] }, [0, 0, 0, 0]],
  ["a row for a different link ref is not this link", { inbox: [inboxRow({ raw_body: '{"link_ref":"pl_somebody_else"}' })] }, [0, 0, 0, 0]],
  ["a row from another org is not this org's", { inbox: [inboxRow({ org_id: OTHER_ORG })] }, [0, 0, 0, 0]],
  ["a link already paid is settled", { links: [link({ status: "paid" })], inbox: [inboxRow()] }, [0, 0, 0, 0]],
  ["a void link is not open", { links: [link({ status: "void" })], inbox: [inboxRow()] }, [0, 0, 0, 0]],
  ["a demo link is left out", { links: [link({ is_demo: true })], inbox: [inboxRow()] }, [0, 0, 0, 0]],
  ["money from the same client for the same amount, outside every link: the link is stale-open", { txs: [tx()] }, [1, 0, 1, 0]],
  ["Chris's own $1 prove payment is not a payment on a $297 link", { txs: [tx({ amount_paid: "1.00", raw_payload: { ref: "pl_prove_chris_1" } })] }, [0, 0, 0, 0]],
  ["a failed payment is not money", { txs: [tx({ status: "failed" })] }, [0, 0, 0, 0]],
  ["money from another client is not this link's", { txs: [tx({ client_id: C2 })] }, [0, 0, 0, 0]],
  [
    "money that came through a different link of ours is not this break",
    { links: [link(), link({ id: L2, link_ref: REF2, status: "paid", created_at: "2026-10-02T12:00:00Z" })], txs: [tx({ raw_payload: { ref: REF2 } })] },
    [0, 0, 0, 0]
  ],
  ["money that came through THIS link and left it open is the break", { txs: [tx({ raw_payload: { ref: REF1 } })] }, [1, 0, 1, 0]],
  ["money from before the link was minted is another purchase", { txs: [tx({ created_at: "2026-09-30T12:00:00Z" })] }, [0, 0, 0, 0]],
  ["money inside the grace is still being processed", { txs: [tx({ created_at: "2026-10-08T14:58:00Z" })] }, [0, 0, 0, 0]],
  ["a simulated payment is not money", { txs: [tx({ provider_ref: "sim-pay-1788698990797" })] }, [0, 0, 0, 0]],
  ["a demo payment is not money", { txs: [tx({ is_demo: true })] }, [0, 0, 0, 0]],
  ["a payment 1 cent off the link amount is not tied to it", { txs: [tx({ amount_paid: "297.01" })] }, [0, 0, 0, 0]],
  ["proof and money on one link count the link once", { inbox: [inboxRow()], txs: [tx({ raw_payload: { ref: REF1 } })] }, [1, 1, 0, 0]],
  [
    "two open links, one each way, are two",
    {
      links: [link(), link({ id: L2, link_ref: REF2, client_id: C2, amount_cents: 49700 })],
      inbox: [inboxRow()],
      txs: [tx({ client_id: C2, amount_paid: "497.00" })]
    },
    [2, 1, 1, 0]
  ]
];

describe("gap payments: the pay link SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  let pgdb;
  let closeDb;

  before(async () => {
    const mod = await import("../../db.mjs");
    pgdb = mod.db;
    closeDb = mod.close;
  });

  after(async () => {
    if (closeDb) await closeDb();
  });

  for (const [name, scenario, want] of PAY_LINK_CASES) {
    test(name, async () => {
      const text = runnablePayLinkSql({
        links: scenario.links ?? [link()],
        inbox: scenario.inbox ?? [],
        txs: scenario.txs ?? []
      });
      const { rows } = await pgdb.query(text, [ORG, "2026-10-08T14:57:00.000Z", "sim-pay-%"]);
      const got = [rows[0].n, rows[0].rec_n, rows[0].money_n, rows[0].sim_n].map(Number);
      assert.deepEqual(got, want, `[n, rec_n, money_n, sim_n] for: ${name}`);
    });
  }
});

// ---- invoice-stuck, run for real --------------------------------------------

const AGING_COLS = [["invoice_id", "uuid"], ["org_id", "uuid"], ["status_reconciled", "boolean"], ["status", "text"]];
const INVOICE_COLS = [["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["status", "text"]];
const INV_LINK_COLS = [["id", "uuid"], ["org_id", "uuid"], ["invoice_id", "uuid"], ["is_demo", "boolean"], ["status", "text"]];

const I1 = "dddddddd-0000-4000-8000-000000000001";
const invoice = (over = {}) => ({ id: I1, org_id: ORG, is_demo: false, status: "sent", ...over });
const aging = (over = {}) => ({ invoice_id: I1, org_id: ORG, status_reconciled: true, status: "sent", ...over });
const invLink = (over = {}) => ({ id: L1, org_id: ORG, invoice_id: I1, is_demo: false, status: "sent", ...over });

// want is n. The two reads: dunning state that disagrees with the money, and a paid link on an open invoice.
const INVOICE_CASES = [
  ["an invoice whose dunning state matches the money is clean", {}, 0],
  ["no invoices at all is clean (production today)", { invoices: [], aging: [], links: [] }, 0],
  ["dunning state that does not match the money is stuck", { aging: [aging({ status_reconciled: false, status: "overdue" })] }, 1],
  ["a void invoice is allowed to disagree", { invoices: [invoice({ status: "void" })], aging: [aging({ status_reconciled: false, status: "void" })] }, 0],
  ["a written-off invoice is allowed to disagree", { aging: [aging({ status_reconciled: false, status: "written_off" })] }, 0],
  ["a demo invoice is left out", { invoices: [invoice({ is_demo: true })], aging: [aging({ status_reconciled: false })] }, 0],
  ["a paid link left on a sent invoice is stuck", { links: [invLink({ status: "paid" })] }, 1],
  ["a paid link on a paid invoice is settled", { invoices: [invoice({ status: "paid" })], aging: [aging({ status: "paid" })], links: [invLink({ status: "paid" })] }, 0],
  ["a paid link on a partly paid invoice is not stuck", { invoices: [invoice({ status: "partially_paid" })], links: [invLink({ status: "paid" })] }, 0],
  ["an unpaid link on a sent invoice is normal", { links: [invLink({ status: "sent" })] }, 0],
  ["a demo paid link is left out", { links: [invLink({ status: "paid", is_demo: true })] }, 0],
  ["an invoice from another org is not this org's", { invoices: [invoice({ org_id: OTHER_ORG })], aging: [aging({ org_id: OTHER_ORG, status_reconciled: false })] }, 0]
];

describe("gap payments: the invoice SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  let pgdb;
  let closeDb;

  before(async () => {
    const mod = await import("../../db.mjs");
    pgdb = mod.db;
    closeDb = mod.close;
  });

  after(async () => {
    if (closeDb) await closeDb();
  });

  for (const [name, scenario, want] of INVOICE_CASES) {
    test(name, async () => {
      const text = runnableSql("invoice-stuck", [
        shadow("v_invoice_aging", AGING_COLS, scenario.aging ?? [aging()]),
        shadow("invoices", INVOICE_COLS, scenario.invoices ?? [invoice()]),
        shadow("payment_links", INV_LINK_COLS, scenario.links ?? [])
      ]);
      const { rows } = await pgdb.query(text, [ORG]);
      assert.equal(Number(rows[0].n), want, name);
    });
  }
});

// ---- paid-no-entitlement, run for real --------------------------------------
//
// resolve_product_id() is a database function that reads the real products table,
// and a WITH cannot replace a function. So here the one call is swapped for a name
// match against the made-up products. The resolver is not what this test is about;
// the join, the missing-grant test, the grace and the simulated-receipt split are.

const ENT_TX_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["product_name", "text"], ["status", "text"],
  ["is_demo", "boolean"], ["provider_ref", "text"], ["created_at", "timestamptz"]
];
const PRODUCT_COLS = [["id", "uuid"], ["code", "text"], ["name", "text"]];
const PRODUCT_ENT_COLS = [["org_id", "uuid"], ["product_code", "text"], ["entitlement_code", "text"]];
const ENTITLEMENT_COLS = [["org_id", "uuid"], ["client_id", "uuid"], ["source_transaction_id", "uuid"], ["entitlement_code", "text"]];

const T1 = "eeeeeeee-0000-4000-8000-000000000001";
const T2 = "eeeeeeee-0000-4000-8000-000000000002";
const P1 = "ffffffff-0000-4000-8000-000000000001";
const entTx = (over = {}) => ({
  id: T1, org_id: ORG, client_id: C1, product_name: "Credit Repair", status: "succeeded", is_demo: false,
  provider_ref: "ORD-REAL-9", created_at: "2026-10-08T13:00:00Z", ...over
});
const product = (over = {}) => ({ id: P1, code: "credit-repair", name: "Credit Repair", ...over });
const productEnt = (over = {}) => ({ org_id: ORG, product_code: "credit-repair", entitlement_code: "repair-portal", ...over });
const grant = (over = {}) => ({ org_id: ORG, client_id: C1, source_transaction_id: T1, entitlement_code: "repair-portal", ...over });

// want is [n, sim_n].
const ENTITLEMENT_CASES = [
  ["a succeeded payment with its grant is clean", { grants: [grant()] }, [0, 0]],
  ["a succeeded payment with no grant is the break", {}, [1, 0]],
  ["a grant from a different payment does not cover this one", { grants: [grant({ source_transaction_id: T2 })] }, [1, 0]],
  ["a grant for a different client does not cover this one", { grants: [grant({ client_id: C2 })] }, [1, 0]],
  ["the grant code is matched without caring about case or spaces", { grants: [grant({ entitlement_code: "  Repair-Portal " })] }, [0, 0]],
  ["a product with no entitlement mapping is not this break", { productEnts: [] }, [0, 0]],
  ["a failed payment is not owed a grant", { txs: [entTx({ status: "failed" })] }, [0, 0]],
  ["a demo payment is left out", { txs: [entTx({ is_demo: true })] }, [0, 0]],
  ["a payment with no client cannot be granted", { txs: [entTx({ client_id: null })] }, [0, 0]],
  ["a payment 2 minutes old is inside the grace", { txs: [entTx({ created_at: "2026-10-08T14:58:00Z" })] }, [0, 0]],
  ["a simulated receipt missing its grant is counted apart, not a FAIL", { txs: [entTx({ provider_ref: "sim-pay-1788698990797" })] }, [0, 1]],
  ["a real payment and a simulated one are split", { txs: [entTx(), entTx({ id: T2, provider_ref: "sim-pay-1" })] }, [1, 1]],
  [
    "one payment owed two grants, one given, is counted once",
    { productEnts: [productEnt(), productEnt({ entitlement_code: "repair-extras" })], grants: [grant()] },
    [1, 0]
  ],
  ["a payment from another org is not this org's", { txs: [entTx({ org_id: OTHER_ORG })] }, [0, 0]]
];

describe("gap payments: the entitlement SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  let pgdb;
  let closeDb;

  before(async () => {
    const mod = await import("../../db.mjs");
    pgdb = mod.db;
    closeDb = mod.close;
  });

  after(async () => {
    if (closeDb) await closeDb();
  });

  for (const [name, scenario, want] of ENTITLEMENT_CASES) {
    test(name, async () => {
      const text = runnableSql(
        "paid-no-entitlement",
        [
          shadow("transactions", ENT_TX_COLS, scenario.txs ?? [entTx()]),
          shadow("products", PRODUCT_COLS, scenario.products ?? [product()]),
          shadow("product_entitlements", PRODUCT_ENT_COLS, scenario.productEnts ?? [productEnt()]),
          shadow("entitlements", ENTITLEMENT_COLS, scenario.grants ?? [])
        ],
        (body) => {
          const swapped = body.replace(
            "resolve_product_id(t.org_id, t.product_name)",
            "(SELECT pr.id FROM products pr WHERE pr.name = t.product_name LIMIT 1)"
          );
          assert.notEqual(swapped, body, "the resolver call must be present to be swapped");
          return swapped;
        }
      );
      const { rows } = await pgdb.query(text, [ORG, "2026-10-08T14:57:00.000Z", "sim-pay-%"]);
      assert.deepEqual([Number(rows[0].n), Number(rows[0].sim_n)], want, name);
    });
  }
});

// ---- Tier 1 tripwires — Claude, 2026-10-09 -----------------------------------
//
// The four new reads: paid-product-unmapped, commas-inbox-waiting,
// checkout-started-no-link, card-declined-no-followup. First the sentence
// each one writes (canned counts, no database), then the SQL itself, run for
// real against made-up tables (the same WITH-shadow trick as above, so no real
// table is read or written). The SQL tests skip, and say so, with no DATABASE_URL.

const TW_NOW = new Date("2026-10-08T15:00:00Z");
const TW_SQL = {
  "paid-product-unmapped": PAID_PRODUCT_UNMAPPED_SQL,
  "commas-inbox-waiting": COMMAS_INBOX_WAITING_SQL,
  "checkout-started-no-link": CHECKOUT_STARTED_NO_LINK_SQL,
  "card-declined-no-followup": CARD_DECLINED_NO_FOLLOWUP_SQL
};

/* A database that answers each tripwire read with the row it is given (an Error
   throws, null answers with no row) and every other read with a clean zero row. */
function twDb(byTag = {}, seen = []) {
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      for (const tag of Object.keys(byTag)) {
        if (sql.includes(`/* gap:${tag} */`)) {
          const v = byTag[tag];
          if (v instanceof Error) throw v;
          return { rows: v === null ? [] : [v] };
        }
      }
      return { rows: [{ n: 0 }] };
    }
  };
}

const twRowOf = (rows, id) => rows.find((r) => r.id === id);

test("gap payments tripwires: the SQL is read only, tagged, and takes the org first", () => {
  for (const [tag, sql] of Object.entries(TW_SQL)) {
    assert.match(sql, new RegExp(`^\\s*/\\* gap:${tag} \\*/`), tag);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|BEGIN|COMMIT|ROLLBACK|SET)\b/, tag);
    assert.match(sql, /\$1::uuid/, tag);
  }
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
});

test("gap payments tripwires: the waits and windows are the numbers the board states", () => {
  assert.equal(PAID_LOOKBACK_MS, 30 * 24 * 3600 * 1000);
  assert.equal(INBOX_WAIT_MS, 10 * 60 * 1000);
  assert.equal(STALE_CLAIM_MINUTES, 15, "the sweeper takes a stale claim back after 15 minutes");
  assert.equal(INBOX_PROCESSING_WAIT_MS, 20 * 60 * 1000, "5 minutes after the sweeper should have taken it back");
  assert.equal(MAX_ATTEMPTS, 10);
  assert.equal(CHECKOUT_LINK_WAIT_MS, 10 * 60 * 1000);
  assert.equal(CHECKOUT_LOOKBACK_MS, 3 * 24 * 3600 * 1000);
  assert.equal(DECLINE_WAIT_MS, 60 * 60 * 1000);
  assert.equal(DECLINE_LOOKBACK_MS, 3 * 24 * 3600 * 1000);
});

test("gap payments tripwires: the test-client pattern starts with the one gap-consent and gap-portal use", () => {
  // Not imported at run time: a drift between the lanes shows up here, not as a surprise red.
  assert.equal(CONSENT_TEST_RE, PORTAL_TEST_RE, "the two lanes that already share it still agree");
  assert.ok(TEST_CLIENT_EMAIL_RE.startsWith(CONSENT_TEST_RE), "this lane adds to the shared pattern, it does not replace it");
  const re = new RegExp(TEST_CLIENT_EMAIL_RE, "i");
  for (const mail of [
    "chris+walk-04@gmail.com", "chris+sim-11@gmail.com", "someone@example.com", "x@example.org", "x@host.test",
    "e2e+inline-card-1790709623817@fundhub.ai", "e2e+embed-test@test.fundhub.ai", "demo+proof-1790090135868@fundhub.ai"
  ]) {
    assert.ok(re.test(mail), `${mail} is a test address`);
  }
  for (const mail of [
    "schmidtco16@gmail.com", "stanbridgejchris@gmail.com", "dennis@thedrinklabs.com", "contest.winner@gmail.com",
    "first.e2e@gmail.com", "someone@exampled.com"
  ]) {
    assert.ok(!re.test(mail), `${mail} is a real address`);
  }
});

test("gap payments tripwires: paid-product-unmapped names who and what, and says what it left out", async () => {
  const seen = [];
  const db = twDb({
    "paid-product-unmapped": {
      paid_n: 5, test_n: 22, no_client_n: 1, partner_n: 0, unmapped_n: 2, handled_n: 2,
      sample: "UnderwriteIQ soft-pull assessment $32.00 (order ORD-1, client FH-000530); Mystery $5.00 (order ORD-2, no client)"
    }
  }, seen);
  const rows = await gapChecks({ db, orgId: ORG, now: TW_NOW, readText: aliveRead });
  rows.forEach(shape);
  const hit = twRowOf(rows, "payments:paid-product-unmapped");
  assert.equal(hit.status, "FAIL");
  assert.match(
    hit.detail,
    /^3 paid orders in the last 30 days that we cannot match: 1 order with no person attached; 2 orders for a product name we do not know, with no access given since\./
  );
  assert.match(hit.detail, /UnderwriteIQ soft-pull assessment \$32\.00 \(order ORD-1, client FH-000530\)/);
  assert.match(hit.detail, /Left out: 2 orders with an unknown product name already have access, 22 test-client payments\./);
  assert.match(hit.suggestedFix, /Do not take the payment again/);
  const call = seen.find((c) => /gap:paid-product-unmapped/.test(c.sql));
  assert.deepEqual(call.params, [ORG, "2026-10-08T14:57:00.000Z", "sim-pay-%", "2026-09-08T15:00:00.000Z", TEST_CLIENT_EMAIL_RE]);
  // Only this read failed: the other seven did not change.
  assert.ok(rows.filter((r) => r.id !== hit.id).every((r) => r.status === "PASS"));
});

test("gap payments tripwires: paid-product-unmapped PASS says how many it read, and a hand-fixed order is not a FAIL", async () => {
  let rows = await gapChecks({
    db: twDb({ "paid-product-unmapped": { paid_n: 5, test_n: 0, no_client_n: 0, partner_n: 0, unmapped_n: 0, handled_n: 0 } }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  let hit = twRowOf(rows, "payments:paid-product-unmapped");
  assert.equal(hit.status, "PASS");
  assert.equal(hit.detail, "5 real paid orders in the last 30 days, and each has a person plus a known product or access.");
  rows = await gapChecks({
    db: twDb({ "paid-product-unmapped": { paid_n: 0, test_n: 3, no_client_n: 0, partner_n: 0, unmapped_n: 0, handled_n: 0 } }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  hit = twRowOf(rows, "payments:paid-product-unmapped");
  assert.equal(hit.status, "PASS");
  assert.match(hit.detail, /^no real paid order in the last 30 days to check\. Left out: 3 test-client payments\.$/);
  // The $1,000 order: unknown name, access given by hand. Counted, left out of the FAIL, and said.
  rows = await gapChecks({
    db: twDb({ "paid-product-unmapped": { paid_n: 3, test_n: 0, no_client_n: 0, partner_n: 1, unmapped_n: 0, handled_n: 1 } }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  hit = twRowOf(rows, "payments:paid-product-unmapped");
  assert.equal(hit.status, "PASS");
  assert.match(hit.detail, /Left out: 1 order with an unknown product name already has access, 1 partner payment\./);
});

test("gap payments tripwires: commas-inbox-waiting FAIL counts the three shapes and the paid ones, and ages the oldest", async () => {
  const seen = [];
  const db = twDb({
    "commas-inbox-waiting": {
      n: 3, paid_n: 2, pending_n: 1, failed_n: 1, processing_n: 1, sim_n: 4, oldest: new Date("2026-10-08T12:00:00Z")
    }
  }, seen);
  const rows = await gapChecks({ db, orgId: ORG, now: TW_NOW, readText: aliveRead });
  rows.forEach(shape);
  const hit = twRowOf(rows, "payments:commas-inbox-waiting");
  assert.equal(hit.status, "FAIL");
  assert.equal(
    hit.detail,
    "3 Commas receipts waiting in the inbox that no clock is picking up: 1 never tried, 1 failed with tries left, 1 stuck mid-pass. " +
      "2 of them are paid receipts. The oldest came in 3 hours ago. (4 simulated receipts left out: no card was charged)"
  );
  assert.match(hit.suggestedFix, /commas-inbox-sweeper and commas-inbox-drain/);
  const call = seen.find((c) => /gap:commas-inbox-waiting/.test(c.sql));
  assert.deepEqual(call.params, [ORG, "2026-10-08T14:50:00.000Z", "sim-pay-%", 10, "2026-10-08T14:40:00.000Z"]);
  // One receipt reads in the singular.
  const one = await gapChecks({
    db: twDb({ "commas-inbox-waiting": { n: 1, paid_n: 1, pending_n: 1, failed_n: 0, processing_n: 0, sim_n: 0, oldest: "2026-10-08T14:20:00Z" } }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  assert.match(twRowOf(one, "payments:commas-inbox-waiting").detail, /^1 Commas receipt waiting .* It is a paid receipt\. The oldest came in 40 minutes ago\.$/);
});

test("gap payments tripwires: commas-inbox-waiting PASS names the simulated receipts it left out", async () => {
  let rows = await gapChecks({
    db: twDb({ "commas-inbox-waiting": { n: 0, paid_n: 0, pending_n: 0, failed_n: 0, processing_n: 0, sim_n: 0, oldest: null } }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  assert.equal(twRowOf(rows, "payments:commas-inbox-waiting").status, "PASS");
  assert.equal(twRowOf(rows, "payments:commas-inbox-waiting").detail, "no Commas receipt is waiting for a clock to pick it up");
  rows = await gapChecks({
    db: twDb({ "commas-inbox-waiting": { n: 0, sim_n: 2 } }), orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  assert.match(twRowOf(rows, "payments:commas-inbox-waiting").detail, /\(2 simulated receipts left out: no card was charged\)$/);
});

test("gap payments tripwires: checkout-started-no-link FAIL names the refs, PASS is honest when there is nothing to read", async () => {
  const seen = [];
  const db = twDb({
    "checkout-started-no-link": { presses_n: 4, n: 2, oldest: "2026-10-08T01:00:00Z", refs: "slo_aaa, slo_bbb" }
  }, seen);
  let rows = await gapChecks({ db, orgId: ORG, now: TW_NOW, readText: aliveRead });
  rows.forEach(shape);
  let hit = twRowOf(rows, "payments:checkout-started-no-link");
  assert.equal(hit.status, "FAIL");
  assert.equal(
    hit.detail,
    "2 Pay presses in the last 3 days with no checkout link made, out of 4 real presses. " +
      "The buyer pressed Pay and the link was never made. The oldest was 14 hours ago. Order refs: slo_aaa, slo_bbb."
  );
  assert.match(hit.suggestedFix, /fresh link from the existing pay link flow/);
  const call = seen.find((c) => /gap:checkout-started-no-link/.test(c.sql));
  assert.deepEqual(call.params, [ORG, "2026-10-08T14:50:00.000Z", "2026-10-05T15:00:00.000Z", TEST_CLIENT_EMAIL_RE]);

  rows = await gapChecks({
    db: twDb({ "checkout-started-no-link": { presses_n: 1, n: 1, oldest: "2026-10-08T14:00:00Z", refs: null } }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  assert.match(twRowOf(rows, "payments:checkout-started-no-link").detail, /^1 Pay press in the last 3 days with no checkout link made, out of 1 real press\./);

  rows = await gapChecks({
    db: twDb({ "checkout-started-no-link": { presses_n: 0, n: 0, oldest: null, refs: null } }), orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  hit = twRowOf(rows, "payments:checkout-started-no-link");
  assert.equal(hit.status, "PASS");
  assert.equal(hit.detail, "no real Pay press in the last 3 days is old enough to check");
  rows = await gapChecks({
    db: twDb({ "checkout-started-no-link": { presses_n: 3, n: 0 } }), orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  assert.equal(twRowOf(rows, "payments:checkout-started-no-link").detail, "3 real Pay presses in the last 3 days, and each has its checkout link");
});

test("gap payments tripwires: card-declined-no-followup FAIL names the clients, and the no-client declines are told apart", async () => {
  const seen = [];
  const db = twDb({
    "card-declined-no-followup": {
      declines_n: 2, n: 1, no_client_n: 3, oldest: "2026-10-06T14:00:00Z", sample: "FH-000531 (order ORD-TP4M-T2FN-2S9M)"
    }
  }, seen);
  let rows = await gapChecks({ db, orgId: ORG, now: TW_NOW, readText: aliveRead });
  rows.forEach(shape);
  let hit = twRowOf(rows, "payments:card-declined-no-followup");
  assert.equal(hit.status, "FAIL");
  assert.equal(
    hit.detail,
    "1 card decline over an hour old with no staff or agent message, no task and no later payment for that client. The oldest was 2 days ago. " +
      "Clients: FH-000531 (order ORD-TP4M-T2FN-2S9M). (3 declines with no client attached left out: nobody to reach)"
  );
  assert.match(hit.suggestedFix, /makes no text and no task/);
  assert.match(hit.suggestedFix, /Automated drip messages do not count as reaching out/);
  assert.match(hit.suggestedFix, /Do not take the card again/);
  const call = seen.find((c) => /gap:card-declined-no-followup/.test(c.sql));
  assert.deepEqual(call.params, [ORG, "2026-10-08T14:00:00.000Z", "2026-10-05T15:00:00.000Z", "sim-pay-%", TEST_CLIENT_EMAIL_RE]);

  rows = await gapChecks({
    db: twDb({ "card-declined-no-followup": { declines_n: 0, n: 0, no_client_n: 0 } }), orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  hit = twRowOf(rows, "payments:card-declined-no-followup");
  assert.equal(hit.status, "PASS");
  assert.equal(hit.detail, "no real card decline in the last 3 days is old enough to check");
  rows = await gapChecks({
    db: twDb({ "card-declined-no-followup": { declines_n: 2, n: 0, no_client_n: 1 } }), orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  assert.match(
    twRowOf(rows, "payments:card-declined-no-followup").detail,
    /^2 real card declines in the last 3 days, and each client has a later staff or agent message, task or payment \(1 decline with no client attached left out/
  );
});

test("gap payments tripwires: card-declined-no-followup says when the only follow-up was an automated drip", async () => {
  const detailFor = async (row) => {
    const rows = await gapChecks({
      db: twDb({ "card-declined-no-followup": { declines_n: 3, no_client_n: 0, oldest: "2026-10-06T14:00:00Z", sample: "FH-000531 (order ORD-A)", ...row } }),
      orgId: ORG, now: TW_NOW, readText: aliveRead
    });
    rows.forEach(shape);
    const hit = twRowOf(rows, "payments:card-declined-no-followup");
    assert.equal(hit.status, "FAIL");
    return hit.detail;
  };
  // One decline, and the client has only had drip messages: the line says so.
  assert.equal(
    await detailFor({ n: 1, auto_only_n: 1 }),
    "1 card decline over an hour old with no staff or agent message, no task and no later payment for that client. " +
      "That client has only had automated drip messages since, and those do not count. The oldest was 2 days ago. Clients: FH-000531 (order ORD-A)."
  );
  // Several declines, some with drips only.
  assert.equal(
    await detailFor({ n: 2, auto_only_n: 1 }),
    "2 card declines over an hour old with no staff or agent message, no task and no later payment for that client. " +
      "For 1 of them the client has only had automated drip messages since, and those do not count. The oldest was 2 days ago. Clients: FH-000531 (order ORD-A)."
  );
  // Nobody got even a drip: no drip sentence at all.
  assert.doesNotMatch(await detailFor({ n: 2, auto_only_n: 0 }), /drip/);
  // The read that comes back with no auto_only_n column (an older shape) is also no drip sentence, not a crash.
  assert.doesNotMatch(await detailFor({ n: 1 }), /drip/);
});

test("gap payments tripwires: the card-decline SQL names sender_kind, so a drip cannot count as a reach-out", () => {
  assert.match(CARD_DECLINED_NO_FOLLOWUP_SQL, /m\.sender_kind IN \('staff', 'agent'\)/);
  assert.match(CARD_DECLINED_NO_FOLLOWUP_SQL, /COALESCE\(m\.sender_kind, 'system'\) = 'system'/);
});

test("gap payments tripwires: a failed read is a skip with the reason, never a PASS and never a FAIL", async () => {
  const boom = (m) => new Error(m);
  const ids = [
    "payments:paid-product-unmapped", "payments:commas-inbox-waiting",
    "payments:checkout-started-no-link", "payments:card-declined-no-followup"
  ];
  const db = twDb({
    "paid-product-unmapped": boom("permission denied for table transactions"),
    "commas-inbox-waiting": boom("relation commas_inbox does not exist"),
    "checkout-started-no-link": boom("canceling statement due to statement timeout"),
    "card-declined-no-followup": boom("connection terminated")
  });
  const rows = await gapChecks({ db, orgId: ORG, now: TW_NOW, readText: aliveRead });
  rows.forEach(shape);
  for (const id of ids) {
    const hit = twRowOf(rows, id);
    assert.equal(hit.status, "skip", id);
    assert.match(hit.detail, /^could not read /, id);
    assert.equal(hit.suggestedFix, null, id);
  }
  assert.match(twRowOf(rows, ids[0]).detail, /permission denied for table transactions/);
  assert.match(twRowOf(rows, ids[3]).detail, /connection terminated/);
  // A read that comes back with no row at all is also a skip, not a clean bill.
  const empty = await gapChecks({
    db: twDb({ "paid-product-unmapped": null, "commas-inbox-waiting": null, "checkout-started-no-link": null, "card-declined-no-followup": null }),
    orgId: ORG, now: TW_NOW, readText: aliveRead
  });
  for (const id of ids) {
    assert.equal(twRowOf(empty, id).status, "skip", id);
    assert.match(twRowOf(empty, id).detail, /came back with no row/, id);
  }
});

test("gap payments tripwires: no database, or no org id, is a skip that says which", async () => {
  const noDb = await gapChecks({ readText: aliveRead });
  assert.match(twRowOf(noDb, "payments:paid-product-unmapped").detail, /^no database in this run — paid orders not read$/);
  assert.match(twRowOf(noDb, "payments:commas-inbox-waiting").detail, /^no database in this run — the Commas inbox not read$/);
  assert.match(twRowOf(noDb, "payments:checkout-started-no-link").detail, /^no database in this run — Pay presses not read$/);
  assert.match(twRowOf(noDb, "payments:card-declined-no-followup").detail, /^no database in this run — card declines not read$/);
  const noOrg = await gapChecks({ db: twDb(), readText: aliveRead });
  assert.match(twRowOf(noOrg, "payments:card-declined-no-followup").detail, /^no org id in this run — card declines not read$/);
});

// ---- The four tripwire SQL statements, run for real --------------------------
//
// Every table a statement reads is replaced by a small made-up one (WITH
// name AS (VALUES ...)), so nothing real is read or written. The one thing
// swapped out is the product resolver in paid-product-unmapped: a WITH cannot
// replace a function, so that one call becomes a plain name match.

function twRun(sql, shadows, patch = (t) => t) {
  const body = patch(sql);
  assert.doesNotMatch(body, /\$\{/, "the SQL under test must not be a template with holes");
  return `WITH ${shadows.join(",\n")}\n${body}`;
}

function twSuite(title, build) {
  describe(title, { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
    let pgdb;
    let closeDb;
    before(async () => {
      const mod = await import("../../db.mjs");
      pgdb = mod.db;
      closeDb = mod.close;
    });
    after(async () => {
      if (closeDb) await closeDb();
    });
    build(() => pgdb);
  });
}

const TW_C3 = "cccccccc-0000-4000-8000-000000000003";
const TW_PL_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const TW_PARTNER = "99999999-0000-4000-8000-000000000001";

// -- 1. paid-product-unmapped --------------------------------------------------

const TW_TX_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["product_name", "text"], ["amount_paid", "numeric"],
  ["status", "text"], ["is_demo", "boolean"], ["provider_ref", "text"], ["created_at", "timestamptz"], ["raw_payload", "jsonb"]
];
const TW_CLIENT_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["custom_fields", "jsonb"], ["email", "text"], ["client_code", "text"]
];
const TW_GRANT_COLS = [["org_id", "uuid"], ["client_id", "uuid"], ["source_transaction_id", "uuid"], ["granted_at", "timestamptz"]];
const TW_PLINK_COLS = [["id", "uuid"], ["org_id", "uuid"], ["partner_id", "uuid"], ["link_ref", "text"]];
const TW_PRODUCT3_COLS = [["id", "uuid"], ["name", "text"]];

const twPay = (over = {}) => ({
  id: T1, org_id: ORG, client_id: C1, product_name: "Mystery Offer", amount_paid: 32, status: "succeeded", is_demo: false,
  provider_ref: "ORD-REAL-1", created_at: "2026-10-07T07:07:00Z", raw_payload: { ref: "pl_real_1", paymentLinkId: TW_PL_ID }, ...over
});
const twClient = (over = {}) => ({
  id: C1, org_id: ORG, is_demo: false, custom_fields: {}, email: "real.person@gmail.com", client_code: "FH-000900", ...over
});
const twGrant = (over = {}) => ({ org_id: ORG, client_id: C1, source_transaction_id: null, granted_at: "2026-10-07T09:00:00Z", ...over });
const twPlink = (over = {}) => ({ id: TW_PL_ID, org_id: ORG, partner_id: TW_PARTNER, link_ref: "pl_real_1", ...over });

function twPaidSql(s) {
  return twRun(
    PAID_PRODUCT_UNMAPPED_SQL,
    [
      shadow("transactions", TW_TX_COLS, s.txs ?? [twPay()]),
      shadow("clients", TW_CLIENT_COLS, s.clients ?? [twClient()]),
      shadow("entitlements", TW_GRANT_COLS, s.grants ?? []),
      shadow("payment_links", TW_PLINK_COLS, s.plinks ?? []),
      shadow("products", TW_PRODUCT3_COLS, [{ id: P1, name: "Credit Repair" }])
    ],
    (body) => {
      const swapped = body.replace(
        "resolve_product_id(t.org_id, t.product_name)",
        "(SELECT pr.id FROM products pr WHERE pr.name = t.product_name LIMIT 1)"
      );
      assert.notEqual(swapped, body, "the resolver call must be present to be swapped");
      return swapped;
    }
  );
}

const TW_PAID_PARAMS = [ORG, "2026-10-08T14:57:00.000Z", "sim-pay-%", "2026-09-08T15:00:00.000Z", TEST_CLIENT_EMAIL_RE];

// want is [paid_n, test_n, no_client_n, partner_n, unmapped_n, handled_n]
const TW_PAID_CASES = [
  ["an unknown product name and no access is the break", {}, [1, 0, 0, 0, 1, 0]],
  ["a grant tied to this very payment covers it, whenever it was made", { grants: [twGrant({ source_transaction_id: T1, granted_at: "2026-10-06T00:00:00Z" })] }, [1, 0, 0, 0, 0, 1]],
  ["a grant made by hand after the payment covers it", { grants: [twGrant()] }, [1, 0, 0, 0, 0, 1]],
  ["a grant made at the same instant as the payment covers it", { grants: [twGrant({ granted_at: "2026-10-07T07:07:00Z" })] }, [1, 0, 0, 0, 0, 1]],
  ["a grant made before the payment, for something else, does not cover it", { grants: [twGrant({ granted_at: "2026-10-01T00:00:00Z" })] }, [1, 0, 0, 0, 1, 0]],
  ["a grant for another client does not cover it", { grants: [twGrant({ client_id: C2 })] }, [1, 0, 0, 0, 1, 0]],
  ["a grant in another org does not cover it", { grants: [twGrant({ org_id: OTHER_ORG })] }, [1, 0, 0, 0, 1, 0]],
  ["a known product name is paid-no-entitlement's job, not this one", { txs: [twPay({ product_name: "Credit Repair" })] }, [1, 0, 0, 0, 0, 0]],
  ["no client and an unknown name is the break", { txs: [twPay({ client_id: null })] }, [1, 0, 1, 0, 0, 0]],
  ["no client and a known name is still the break", { txs: [twPay({ client_id: null, product_name: "Credit Repair" })] }, [1, 0, 1, 0, 0, 0]],
  [
    "no client, paid through a partner link (matched by ref): a partner, not a lost buyer",
    { txs: [twPay({ client_id: null, raw_payload: { ref: "pl_real_1", paymentLinkId: null } })], plinks: [twPlink()] },
    [1, 0, 0, 1, 0, 0]
  ],
  [
    "no client, paid through a partner link (matched by link id)",
    { txs: [twPay({ client_id: null, raw_payload: { ref: "pl_other", paymentLinkId: TW_PL_ID } })], plinks: [twPlink({ link_ref: "pl_not_it" })] },
    [1, 0, 0, 1, 0, 0]
  ],
  ["no client and a link with no partner on it is not explained", { txs: [twPay({ client_id: null })], plinks: [twPlink({ partner_id: null })] }, [1, 0, 1, 0, 0, 0]],
  [
    "no client and a partner link with another ref is not explained",
    { txs: [twPay({ client_id: null, raw_payload: { ref: "pl_x", paymentLinkId: null } })], plinks: [twPlink()] },
    [1, 0, 1, 0, 0, 0]
  ],
  ["a partner link in another org does not explain it", { txs: [twPay({ client_id: null })], plinks: [twPlink({ org_id: OTHER_ORG })] }, [1, 0, 1, 0, 0, 0]],
  ["a +walk address is a test client", { clients: [twClient({ email: "chris+walk-04@gmail.com" })] }, [0, 1, 0, 0, 0, 0]],
  ["an e2e+ address is a test client", { clients: [twClient({ email: "e2e+financeos-1791@fundhub.ai" })] }, [0, 1, 0, 0, 0, 0]],
  ["a demo+ address is a test client", { clients: [twClient({ email: "demo+proof-1790090135868@fundhub.ai" })] }, [0, 1, 0, 0, 0, 0]],
  ["an @example.com address is a test client", { clients: [twClient({ email: "test@example.com" })] }, [0, 1, 0, 0, 0, 0]],
  ["a demo client is a test client", { clients: [twClient({ is_demo: true })] }, [0, 1, 0, 0, 0, 0]],
  ["a synthetic client is a test client", { clients: [twClient({ custom_fields: { synthetic: true } })] }, [0, 1, 0, 0, 0, 0]],
  ["a real address with 'test' in it is not a test client", { clients: [twClient({ email: "contest.winner@gmail.com" })] }, [1, 0, 0, 0, 1, 0]],
  ["a demo payment is left out entirely", { txs: [twPay({ is_demo: true })] }, [0, 0, 0, 0, 0, 0]],
  ["a simulated receipt is left out entirely", { txs: [twPay({ provider_ref: "sim-pay-1791356847784" })] }, [0, 0, 0, 0, 0, 0]],
  ["a failed payment is left out", { txs: [twPay({ status: "failed" })] }, [0, 0, 0, 0, 0, 0]],
  ["the status is matched without caring about case or spaces", { txs: [twPay({ status: "  Succeeded " })] }, [1, 0, 0, 0, 1, 0]],
  ["a payment 2 minutes old is inside the grace", { txs: [twPay({ created_at: "2026-10-08T14:58:00Z" })] }, [0, 0, 0, 0, 0, 0]],
  ["a payment older than 30 days is history", { txs: [twPay({ created_at: "2026-09-01T12:00:00Z" })] }, [0, 0, 0, 0, 0, 0]],
  ["a payment from another org is not this org's", { txs: [twPay({ org_id: OTHER_ORG })] }, [0, 0, 0, 0, 0, 0]],
  [
    "one unmatched order and one fixed by hand are counted apart",
    {
      txs: [twPay(), twPay({ id: T2, client_id: C2, provider_ref: "ORD-REAL-2" })],
      clients: [twClient(), twClient({ id: C2, email: "second@gmail.com", client_code: "FH-000901" })],
      grants: [twGrant({ client_id: C2 })]
    },
    [2, 0, 0, 0, 1, 1]
  ]
];

twSuite("gap payments tripwires: the paid-product-unmapped SQL, run for real", (getDb) => {
  for (const [name, scenario, want] of TW_PAID_CASES) {
    test(name, async () => {
      const { rows } = await getDb().query(twPaidSql(scenario), TW_PAID_PARAMS);
      const r = rows[0];
      assert.deepEqual(
        [r.paid_n, r.test_n, r.no_client_n, r.partner_n, r.unmapped_n, r.handled_n].map(Number),
        want,
        `[paid_n, test_n, no_client_n, partner_n, unmapped_n, handled_n] for: ${name}`
      );
    });
  }

  test("the sample names the product, the amount, the order and the client, and only for the orders that are the break", async () => {
    const scenario = {
      txs: [
        twPay(),
        twPay({ id: T2, client_id: C2, product_name: "Fixed By Hand", provider_ref: "ORD-REAL-2", created_at: "2026-10-07T08:00:00Z" }),
        twPay({ id: "eeeeeeee-0000-4000-8000-000000000003", client_id: null, product_name: "Credit Repair", amount_paid: 200, provider_ref: "ORD-REAL-3", created_at: "2026-10-07T09:00:00Z" })
      ],
      clients: [twClient(), twClient({ id: C2, email: "second@gmail.com", client_code: "FH-000901" })],
      grants: [twGrant({ client_id: C2 })]
    };
    const { rows } = await getDb().query(twPaidSql(scenario), TW_PAID_PARAMS);
    const sample = rows[0].sample;
    assert.match(sample, /Mystery Offer \$32 \(order ORD-REAL-1, client FH-000900\)/);
    assert.match(sample, /Credit Repair \$200 \(order ORD-REAL-3, no client\)/);
    assert.doesNotMatch(sample, /Fixed By Hand/, "an order fixed by hand is not in the sample");
    assert.ok(sample.indexOf("ORD-REAL-3") < sample.indexOf("ORD-REAL-1"), "newest first");
  });

  test("no break at all gives a null sample", async () => {
    const { rows } = await getDb().query(twPaidSql({ txs: [twPay({ product_name: "Credit Repair" })] }), TW_PAID_PARAMS);
    assert.equal(rows[0].sample, null);
  });
});

// -- 2. commas-inbox-waiting ---------------------------------------------------

const TW_INBOX_COLS = [
  ["org_id", "uuid"], ["event_type", "text"], ["status", "text"], ["attempts", "int"],
  ["received_at", "timestamptz"], ["claimed_at", "timestamptz"], ["payment_id", "text"]
];
const twInbox = (over = {}) => ({
  org_id: ORG, event_type: "payment.succeeded", status: "pending", attempts: 0,
  received_at: "2026-10-08T14:00:00Z", claimed_at: null, payment_id: "ORD-REAL-7", ...over
});
const TW_INBOX_PARAMS = [ORG, "2026-10-08T14:50:00.000Z", "sim-pay-%", 10, "2026-10-08T14:40:00.000Z"];

// want is [n, paid_n, pending_n, failed_n, processing_n, sim_n]
const TW_INBOX_CASES = [
  ["a finished receipt is clean", [twInbox({ status: "done", attempts: 1, claimed_at: "2026-10-08T14:00:05Z" })], [0, 0, 0, 0, 0, 0]],
  ["an ignored receipt is clean", [twInbox({ status: "ignored", attempts: 1 })], [0, 0, 0, 0, 0, 0]],
  ["a receipt never picked up, 50 minutes old, is the break", [twInbox()], [1, 1, 1, 0, 0, 0]],
  ["a pending receipt 5 minutes old is the sweeper's next pass, not a break", [twInbox({ received_at: "2026-10-08T14:55:00Z" })], [0, 0, 0, 0, 0, 0]],
  ["a pending receipt exactly at the wait is not yet a break", [twInbox({ received_at: "2026-10-08T14:50:00Z" })], [0, 0, 0, 0, 0, 0]],
  ["a pending receipt stays a break whatever its attempts (stuck-failed cannot see a pending row)", [twInbox({ attempts: 10 })], [1, 1, 1, 0, 0, 0]],
  ["a pending notice that is not a payment is waiting too, but is not a paid receipt", [twInbox({ event_type: "payment.failed" })], [1, 0, 1, 0, 0, 0]],
  ["a failed receipt with tries left and an old last try is the break", [twInbox({ status: "failed", attempts: 3, claimed_at: "2026-10-08T14:00:00Z" })], [1, 1, 0, 1, 0, 0]],
  ["a failed receipt tried 5 minutes ago means the sweeper is alive", [twInbox({ status: "failed", attempts: 3, claimed_at: "2026-10-08T14:55:00Z" })], [0, 0, 0, 0, 0, 0]],
  ["a failed receipt never claimed falls back to when it came in", [twInbox({ status: "failed", attempts: 3, claimed_at: null })], [1, 1, 0, 1, 0, 0]],
  ["a failed receipt at the attempt limit is webhooks:stuck-failed's, not this one", [twInbox({ status: "failed", attempts: 10, claimed_at: "2026-10-08T14:00:00Z" })], [0, 0, 0, 0, 0, 0]],
  ["a receipt claimed 30 minutes ago and never finished is the break", [twInbox({ status: "processing", attempts: 3, claimed_at: "2026-10-08T14:30:00Z" })], [1, 1, 0, 0, 1, 0]],
  ["a receipt claimed 5 minutes ago is mid-pass", [twInbox({ status: "processing", attempts: 3, claimed_at: "2026-10-08T14:45:00Z" })], [0, 0, 0, 0, 0, 0]],
  ["a processing receipt at the attempt limit is webhooks:stuck-failed's", [twInbox({ status: "processing", attempts: 10, claimed_at: "2026-10-08T14:00:00Z" })], [0, 0, 0, 0, 0, 0]],
  ["a simulated receipt is counted apart, not a break", [twInbox({ payment_id: "sim-pay-1788698990797" })], [0, 0, 0, 0, 0, 1]],
  ["a receipt from another org is not this org's", [twInbox({ org_id: OTHER_ORG })], [0, 0, 0, 0, 0, 0]],
  [
    "all three shapes at once are three",
    [
      twInbox(),
      twInbox({ status: "failed", attempts: 2, claimed_at: "2026-10-08T13:00:00Z", payment_id: "ORD-REAL-8" }),
      twInbox({ status: "processing", attempts: 2, claimed_at: "2026-10-08T13:00:00Z", payment_id: "ORD-REAL-9" })
    ],
    [3, 3, 1, 1, 1, 0]
  ]
];

twSuite("gap payments tripwires: the commas-inbox-waiting SQL, run for real", (getDb) => {
  for (const [name, inbox, want] of TW_INBOX_CASES) {
    test(name, async () => {
      const text = twRun(COMMAS_INBOX_WAITING_SQL, [shadow("commas_inbox", TW_INBOX_COLS, inbox)]);
      const { rows } = await getDb().query(text, TW_INBOX_PARAMS);
      const r = rows[0];
      assert.deepEqual(
        [r.n, r.paid_n, r.pending_n, r.failed_n, r.processing_n, r.sim_n].map(Number),
        want,
        `[n, paid_n, pending_n, failed_n, processing_n, sim_n] for: ${name}`
      );
    });
  }

  test("the oldest is the oldest waiting receipt that is not simulated", async () => {
    const text = twRun(COMMAS_INBOX_WAITING_SQL, [
      shadow("commas_inbox", TW_INBOX_COLS, [
        twInbox({ received_at: "2026-10-08T13:00:00Z", payment_id: "ORD-REAL-A" }),
        twInbox({ received_at: "2026-10-08T12:00:00Z", payment_id: "ORD-REAL-B" }),
        twInbox({ received_at: "2026-10-01T12:00:00Z", payment_id: "sim-pay-9" })
      ])
    ]);
    const { rows } = await getDb().query(text, TW_INBOX_PARAMS);
    assert.equal(rows[0].oldest.toISOString(), "2026-10-08T12:00:00.000Z");
    const none = await getDb().query(twRun(COMMAS_INBOX_WAITING_SQL, [shadow("commas_inbox", TW_INBOX_COLS, [])]), TW_INBOX_PARAMS);
    assert.equal(none.rows[0].oldest, null);
    assert.equal(Number(none.rows[0].n), 0);
  });
});

// -- 3. checkout-started-no-link -----------------------------------------------

const TW_EVENT_COLS = [
  ["org_id", "uuid"], ["name", "text"], ["is_demo", "boolean"], ["client_id", "uuid"], ["created_at", "timestamptz"], ["payload", "jsonb"]
];
const TW_LINK3_COLS = [["org_id", "uuid"], ["client_id", "uuid"], ["link_ref", "text"], ["created_at", "timestamptz"]];
const twPress = (over = {}) => ({
  org_id: ORG, name: "slo.checkout_started", is_demo: false, client_id: C1, created_at: "2026-10-08T10:00:00Z",
  payload: { ref: "slo_press_one", demo: false, actor: "person", email: "real.person@gmail.com" }, ...over
});
const twLink3 = (over = {}) => ({ org_id: ORG, client_id: C1, link_ref: "slo_press_one", created_at: "2026-10-08T10:00:01Z", ...over });
const TW_CHECKOUT_PARAMS = [ORG, "2026-10-08T14:50:00.000Z", "2026-10-05T15:00:00.000Z", TEST_CLIENT_EMAIL_RE];

// want is [presses_n, n]
const TW_CHECKOUT_CASES = [
  ["a press whose own ref has a link is fine", { links: [twLink3()] }, [1, 0]],
  ["a press with no link at all is the break", {}, [1, 1]],
  ["a press retried by the same client, and the retry got a link, is fine", { links: [twLink3({ link_ref: "slo_retry", created_at: "2026-10-08T10:05:00Z" })] }, [1, 0]],
  ["an older link of the same client does not cover a new press", { links: [twLink3({ link_ref: "slo_old", created_at: "2026-10-08T09:00:00Z" })] }, [1, 1]],
  ["a link 30 seconds before the press still counts (event times are cut to the second)", { links: [twLink3({ link_ref: "slo_edge", created_at: "2026-10-08T09:59:30Z" })] }, [1, 0]],
  ["another client's link does not cover this press", { links: [twLink3({ client_id: C2, link_ref: "slo_other" })] }, [1, 1]],
  ["a later link that is not an slo_ link does not cover it", { links: [twLink3({ link_ref: "pl_not_slo", created_at: "2026-10-08T10:05:00Z" })] }, [1, 1]],
  ["the same ref in another org does not cover it", { links: [twLink3({ org_id: OTHER_ORG })] }, [1, 1]],
  ["a press with no ref is covered by a later slo_ link of the same client", { events: [twPress({ payload: { actor: "person", email: "real.person@gmail.com" } })], links: [twLink3({ link_ref: "slo_later", created_at: "2026-10-08T10:05:00Z" })] }, [1, 0]],
  ["a link with the press's own ref covers it even if the link sits on another client", { links: [twLink3({ client_id: C2 })] }, [1, 0]],
  ["a press with no ref and no link is the break", { events: [twPress({ payload: { actor: "person", email: "real.person@gmail.com" } })] }, [1, 1]],
  ["a press with no actor key counts as a person", { events: [twPress({ payload: { ref: "slo_press_one", email: "real.person@gmail.com" } })] }, [1, 1]],
  ["a press 5 minutes old is still inside the wait", { events: [twPress({ created_at: "2026-10-08T14:55:00Z" })] }, [0, 0]],
  ["a press older than 3 days is old news", { events: [twPress({ created_at: "2026-10-04T10:00:00Z" })] }, [0, 0]],
  ["a demo event is left out", { events: [twPress({ is_demo: true })] }, [0, 0]],
  ["a demo order (payload.demo true) is left out", { events: [twPress({ payload: { ref: "slo_press_one", demo: true, actor: "person" } })] }, [0, 0]],
  ["an agent press is left out", { events: [twPress({ payload: { ref: "slo_press_one", demo: false, actor: "agent" } })] }, [0, 0]],
  ["a test client (e2e+ address on the client row) is left out", { clients: [twClient({ email: "e2e+inline-card-1790709623817@fundhub.ai" })] }, [0, 0]],
  ["a demo client is left out", { clients: [twClient({ is_demo: true })] }, [0, 0]],
  [
    "a press with no client row falls back to the address on the event",
    { events: [twPress({ client_id: TW_C3, payload: { ref: "slo_press_one", actor: "person", email: "e2e+x@fundhub.ai" } })], clients: [] },
    [0, 0]
  ],
  ["another event name is not a press", { events: [twPress({ name: "slo.contact_started" })] }, [0, 0]],
  ["a press in another org is not this org's", { events: [twPress({ org_id: OTHER_ORG })] }, [0, 0]],
  [
    "two presses, one with a link and one without, are two and one",
    {
      events: [twPress(), twPress({ client_id: C2, created_at: "2026-10-08T11:00:00Z", payload: { ref: "slo_press_two", actor: "person", email: "second@gmail.com" } })],
      clients: [twClient(), twClient({ id: C2, email: "second@gmail.com", client_code: "FH-000901" })],
      links: [twLink3()]
    },
    [2, 1]
  ]
];

function twCheckoutSql(s) {
  return twRun(CHECKOUT_STARTED_NO_LINK_SQL, [
    shadow("events", TW_EVENT_COLS, s.events ?? [twPress()]),
    shadow("clients", TW_CLIENT_COLS, s.clients ?? [twClient()]),
    shadow("payment_links", TW_LINK3_COLS, s.links ?? [])
  ]);
}

twSuite("gap payments tripwires: the checkout-started-no-link SQL, run for real", (getDb) => {
  for (const [name, scenario, want] of TW_CHECKOUT_CASES) {
    test(name, async () => {
      const { rows } = await getDb().query(twCheckoutSql(scenario), TW_CHECKOUT_PARAMS);
      assert.deepEqual([rows[0].presses_n, rows[0].n].map(Number), want, `[presses_n, n] for: ${name}`);
    });
  }

  test("the refs come back newest first and the oldest is the oldest unlinked press", async () => {
    const scenario = {
      events: [
        twPress({ created_at: "2026-10-08T08:00:00Z", payload: { ref: "slo_early", actor: "person" } }),
        twPress({ created_at: "2026-10-08T12:00:00Z", payload: { ref: "slo_late", actor: "person" } })
      ]
    };
    const { rows } = await getDb().query(twCheckoutSql(scenario), TW_CHECKOUT_PARAMS);
    assert.equal(rows[0].refs, "slo_late, slo_early");
    assert.equal(rows[0].oldest.toISOString(), "2026-10-08T08:00:00.000Z");
    const clean = await getDb().query(twCheckoutSql({ links: [twLink3()] }), TW_CHECKOUT_PARAMS);
    assert.equal(clean.rows[0].refs, null);
    assert.equal(clean.rows[0].oldest, null);
  });
});

// -- 4. card-declined-no-followup ----------------------------------------------

const TW_MSG_COLS = [
  ["org_id", "uuid"], ["client_id", "uuid"], ["direction", "text"], ["sender_kind", "text"], ["status", "text"], ["created_at", "timestamptz"]
];
const TW_TASK_COLS = [["org_id", "uuid"], ["client_id", "uuid"], ["created_at", "timestamptz"]];
const TW_TX4_COLS = [["org_id", "uuid"], ["client_id", "uuid"], ["status", "text"], ["is_demo", "boolean"], ["created_at", "timestamptz"]];
const twDecline = (over = {}) => ({
  org_id: ORG, name: "payment.failed", is_demo: false, client_id: C1, created_at: "2026-10-08T10:00:00Z",
  payload: { providerRef: "ORD-FAIL-1", email: "" }, ...over
});
const twMsg = (over = {}) => ({
  org_id: ORG, client_id: C1, direction: "outbound", sender_kind: "staff", status: "delivered", created_at: "2026-10-08T10:30:00Z", ...over
});
const twTask = (over = {}) => ({ org_id: ORG, client_id: C1, created_at: "2026-10-08T10:30:00Z", ...over });
const twPaid = (over = {}) => ({ org_id: ORG, client_id: C1, status: "succeeded", is_demo: false, created_at: "2026-10-08T10:05:00Z", ...over });
const TW_DECLINE_PARAMS = [ORG, "2026-10-08T14:00:00.000Z", "2026-10-05T15:00:00.000Z", "sim-pay-%", TEST_CLIENT_EMAIL_RE];

// want is [declines_n, n, no_client_n]
const TW_DECLINE_CASES = [
  ["a decline with nothing after it is the break", {}, [1, 1, 0]],
  ["an outbound message after it is a reach-out", { msgs: [twMsg()] }, [1, 0, 0]],
  ["an outbound message that was only sent is a reach-out", { msgs: [twMsg({ status: "sent" })] }, [1, 0, 0]],
  ["an outbound message still queued is a reach-out", { msgs: [twMsg({ status: "queued" })] }, [1, 0, 0]],
  ["a failed outbound message is not a reach-out", { msgs: [twMsg({ status: "failed" })] }, [1, 1, 0]],
  ["a blocked outbound message is not a reach-out", { msgs: [twMsg({ status: "blocked" })] }, [1, 1, 0]],
  ["a bounced outbound message is not a reach-out", { msgs: [twMsg({ status: "bounced" })] }, [1, 1, 0]],
  ["a cancelled outbound message is not a reach-out", { msgs: [twMsg({ status: "cancelled" })] }, [1, 1, 0]],
  ["an inbound message is the client talking, not us reaching out", { msgs: [twMsg({ direction: "inbound", status: "received" })] }, [1, 1, 0]],
  ["a message from before the decline is not a reach-out about it", { msgs: [twMsg({ created_at: "2026-10-08T09:00:00Z" })] }, [1, 1, 0]],
  ["a message to another client is not a reach-out", { msgs: [twMsg({ client_id: C2 })] }, [1, 1, 0]],
  ["a message in another org is not a reach-out", { msgs: [twMsg({ org_id: OTHER_ORG })] }, [1, 1, 0]],
  ["a task after it is a reach-out", { tasks: [twTask()] }, [1, 0, 0]],
  ["a task from before the decline is not", { tasks: [twTask({ created_at: "2026-10-08T09:00:00Z" })] }, [1, 1, 0]],
  ["a task for another client is not", { tasks: [twTask({ client_id: C2 })] }, [1, 1, 0]],
  ["a later paid payment means they paid on a second try", { txs: [twPaid()] }, [1, 0, 0]],
  ["a later failed payment is not a second-try success", { txs: [twPaid({ status: "failed" })] }, [1, 1, 0]],
  ["a later demo payment is not a second-try success", { txs: [twPaid({ is_demo: true })] }, [1, 1, 0]],
  ["a paid payment from before the decline is not", { txs: [twPaid({ created_at: "2026-10-08T09:00:00Z" })] }, [1, 1, 0]],
  ["a decline with no client has nobody to reach: counted apart", { events: [twDecline({ client_id: null })] }, [0, 0, 1]],
  ["a decline under an hour old is left alone", { events: [twDecline({ created_at: "2026-10-08T14:30:00Z" })] }, [0, 0, 0]],
  ["a decline older than 3 days is old news", { events: [twDecline({ created_at: "2026-10-04T10:00:00Z" })] }, [0, 0, 0]],
  ["a demo event is left out", { events: [twDecline({ is_demo: true })] }, [0, 0, 0]],
  ["a simulated decline is left out", { events: [twDecline({ payload: { providerRef: "sim-pay-1788698990797" } })] }, [0, 0, 0]],
  ["a test client's decline is left out", { clients: [twClient({ email: "chris+walk-04@gmail.com" })] }, [0, 0, 0]],
  ["a decline with no client row falls back to the address on the event", { events: [twDecline({ client_id: TW_C3, payload: { providerRef: "ORD-FAIL-1", email: "e2e+x@fundhub.ai" } })], clients: [] }, [0, 0, 0]],
  ["another event name is not a decline", { events: [twDecline({ name: "payment.received" })] }, [0, 0, 0]],
  ["a decline in another org is not this org's", { events: [twDecline({ org_id: OTHER_ORG })] }, [0, 0, 0]],
  [
    "two declines, one reached and one not, are two and one",
    {
      events: [twDecline(), twDecline({ client_id: C2, created_at: "2026-10-08T11:00:00Z", payload: { providerRef: "ORD-FAIL-2" } })],
      clients: [twClient(), twClient({ id: C2, email: "second@gmail.com", client_code: "FH-000901" })],
      msgs: [twMsg()]
    },
    [2, 1, 0]
  ]
];

/* Who sent the message decides whether it is a reach-out. A person on staff or an
   agent talking to the client is. An automated message (a drip, a welcome, a coupon)
   goes to every client whatever happened to their card, so it is not.
   want is [declines_n, n, no_client_n, auto_only_n]. */
const TW_DECLINE_SENDER_CASES = [
  ["a drip message (sender_kind system) after the decline is NOT a reach-out, and is counted as drip-only", { msgs: [twMsg({ sender_kind: "system" })] }, [1, 1, 0, 1]],
  ["a delivered drip does not hide the decline even when it is the only thing since", { msgs: [twMsg({ sender_kind: "system", status: "sent" })] }, [1, 1, 0, 1]],
  ["a queued drip is NOT a reach-out either", { msgs: [twMsg({ sender_kind: "system", status: "queued" })] }, [1, 1, 0, 1]],
  ["a message from an agent is a reach-out", { msgs: [twMsg({ sender_kind: "agent" })] }, [1, 0, 0, 0]],
  ["a message from staff is a reach-out", { msgs: [twMsg({ sender_kind: "staff" })] }, [1, 0, 0, 0]],
  ["a message with no sender_kind is treated as automated: not a reach-out, counted as drip-only", { msgs: [twMsg({ sender_kind: null })] }, [1, 1, 0, 1]],
  ["an outbound row marked as the client's own is not a reach-out and is not a drip either", { msgs: [twMsg({ sender_kind: "client" })] }, [1, 1, 0, 0]],
  ["a drip that failed was never sent: not a reach-out and not counted as drip-only", { msgs: [twMsg({ sender_kind: "system", status: "failed" })] }, [1, 1, 0, 0]],
  ["a drip that was blocked is not counted as drip-only", { msgs: [twMsg({ sender_kind: "system", status: "blocked" })] }, [1, 1, 0, 0]],
  ["a drip from before the decline is not counted as drip-only", { msgs: [twMsg({ sender_kind: "system", created_at: "2026-10-08T09:00:00Z" })] }, [1, 1, 0, 0]],
  ["an inbound system row (the client's own text) is not a drip", { msgs: [twMsg({ sender_kind: "system", direction: "inbound", status: "received" })] }, [1, 1, 0, 0]],
  ["a drip to another client is not this client's", { msgs: [twMsg({ sender_kind: "system", client_id: C2 })] }, [1, 1, 0, 0]],
  ["a drip in another org is not this client's", { msgs: [twMsg({ sender_kind: "system", org_id: OTHER_ORG })] }, [1, 1, 0, 0]],
  ["a staff message that failed is not a reach-out, and is not a drip either", { msgs: [twMsg({ sender_kind: "staff", status: "failed" })] }, [1, 1, 0, 0]],
  ["a drip plus a staff message: the staff message is the reach-out", { msgs: [twMsg({ sender_kind: "system" }), twMsg({ sender_kind: "staff", created_at: "2026-10-08T11:00:00Z" })] }, [1, 0, 0, 0]],
  ["a drip plus a task: the task is the reach-out", { msgs: [twMsg({ sender_kind: "system" })], tasks: [twTask()] }, [1, 0, 0, 0]],
  ["a drip plus a later paid payment: they paid, so it is fine", { msgs: [twMsg({ sender_kind: "system" })], txs: [twPaid()] }, [1, 0, 0, 0]],
  ["the real shape: a welcome and four drips and nothing else is still the break", {
    msgs: [
      twMsg({ sender_kind: "system", created_at: "2026-10-08T10:20:00Z" }),
      twMsg({ sender_kind: "system", created_at: "2026-10-08T12:20:00Z" }),
      twMsg({ sender_kind: "system", created_at: "2026-10-08T14:20:00Z" })
    ]
  }, [1, 1, 0, 1]],
  [
    "two declines: one with a drip only, one with nothing at all, are two, two and one drip-only",
    {
      events: [twDecline(), twDecline({ client_id: C2, created_at: "2026-10-08T11:00:00Z", payload: { providerRef: "ORD-FAIL-2" } })],
      clients: [twClient(), twClient({ id: C2, email: "second@gmail.com", client_code: "FH-000901" })],
      msgs: [twMsg({ sender_kind: "system" })]
    },
    [2, 2, 0, 1]
  ],
  ["a decline with no client has nobody to reach: a drip does not change that", { events: [twDecline({ client_id: null })], msgs: [twMsg({ sender_kind: "system" })] }, [0, 0, 1, 0]]
];

function twDeclineSql(s) {
  return twRun(CARD_DECLINED_NO_FOLLOWUP_SQL, [
    shadow("events", TW_EVENT_COLS, s.events ?? [twDecline()]),
    shadow("clients", TW_CLIENT_COLS, s.clients ?? [twClient()]),
    shadow("messages", TW_MSG_COLS, s.msgs ?? []),
    shadow("tasks", TW_TASK_COLS, s.tasks ?? []),
    shadow("transactions", TW_TX4_COLS, s.txs ?? [])
  ]);
}

twSuite("gap payments tripwires: the card-declined-no-followup SQL, run for real", (getDb) => {
  for (const [name, scenario, want] of TW_DECLINE_CASES) {
    test(name, async () => {
      const { rows } = await getDb().query(twDeclineSql(scenario), TW_DECLINE_PARAMS);
      assert.deepEqual([rows[0].declines_n, rows[0].n, rows[0].no_client_n].map(Number), want, `[declines_n, n, no_client_n] for: ${name}`);
    });
  }

  for (const [name, scenario, want] of TW_DECLINE_SENDER_CASES) {
    test(name, async () => {
      const { rows } = await getDb().query(twDeclineSql(scenario), TW_DECLINE_PARAMS);
      assert.deepEqual(
        [rows[0].declines_n, rows[0].n, rows[0].no_client_n, rows[0].auto_only_n].map(Number),
        want,
        `[declines_n, n, no_client_n, auto_only_n] for: ${name}`
      );
    });
  }

  test("the sample names the client and the order, newest first, and only for declines nobody reached", async () => {
    const scenario = {
      events: [
        twDecline(),
        twDecline({ client_id: C2, created_at: "2026-10-08T11:00:00Z", payload: { providerRef: "ORD-FAIL-2" } }),
        twDecline({ client_id: TW_C3, created_at: "2026-10-08T12:00:00Z", payload: { providerRef: "ORD-FAIL-3" } })
      ],
      clients: [
        twClient(),
        twClient({ id: C2, email: "second@gmail.com", client_code: "FH-000901" }),
        twClient({ id: TW_C3, email: "third@gmail.com", client_code: "FH-000902" })
      ],
      msgs: [twMsg({ client_id: TW_C3, created_at: "2026-10-08T12:30:00Z" })]
    };
    const { rows } = await getDb().query(twDeclineSql(scenario), TW_DECLINE_PARAMS);
    assert.equal(rows[0].sample, "FH-000901 (order ORD-FAIL-2), FH-000900 (order ORD-FAIL-1)");
    assert.equal(rows[0].oldest.toISOString(), "2026-10-08T10:00:00.000Z");
    const clean = await getDb().query(twDeclineSql({ msgs: [twMsg()] }), TW_DECLINE_PARAMS);
    assert.equal(clean.rows[0].sample, null);
    assert.equal(clean.rows[0].oldest, null);
  });
});
