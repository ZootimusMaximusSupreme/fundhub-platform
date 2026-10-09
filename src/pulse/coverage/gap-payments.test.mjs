import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  LINK_WEBHOOK_GRACE_MS,
  PING_TIMEOUT_MS,
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
