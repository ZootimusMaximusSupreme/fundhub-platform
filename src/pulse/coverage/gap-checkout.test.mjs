import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  FUNNEL_MIN_PRESSES,
  FUNNEL_PATH,
  FUNNEL_PRESSES_SQL,
  FUNNEL_WINDOW_DAYS,
  LIVE_LINKS_SQL,
  MAX_LINK_CHECKS,
  PAID_SERVICE_SQL,
  PAID_STAGE_WAIT_MS,
  QUOTED_WAIT_MS,
  REPAIR_PLAN_KEYS,
  REPAIR_PRICE_SQL,
  STAGED_WAIT_HOURS,
  STAGED_WAIT_MS,
  gapChecks,
  judgeRepairRows,
  naVerify,
  planPriceCents
} from "./gap-checkout.mjs";
import { CHECKOUT_LINK_WAIT_MS, INBOX_PROCESSING_WAIT_MS } from "./gap-payments.mjs";
import { HUMAN_QUEUED_HOURS } from "./gap-soft-pull.mjs";
import { SLO_REPAIR_PLAN_KEYS } from "../../slo/repair-offer.mjs";
import { getOffer } from "../../config/offers.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./money-reads.mjs";
import {
  CLIENT_COLS, HAS_DB, ORG, OTHER_ORG, client_, closeShadowDb, runShadowSql, shadow, tagDb, withShadows
} from "./money-test-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-checkout.mjs"), "utf8");
const NOW = new Date("2026-10-10T18:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const CAT_OK = {
  ok: true,
  checkout: { ready: true },
  items: [
    { slug: "autopsy", selfServe: true, priceCents: 2700, available: true },
    { slug: "board", selfServe: true, priceCents: 4700, available: true },
    { slug: "trial", selfServe: true, priceCents: 9700, available: true },
    { slug: "partner", selfServe: false, priceCents: 1000000, available: false }
  ]
};
const reply = (status, body) => async () => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const COUNTS_CLEAN = {
  real_n: 0, test_n: 0, quoted_n: 0, no_link_n: 0, paid_n: 0, staged_n: 0, unrecorded_n: 0, failed_paid_n: 0, oldest: null
};

function db(over = {}, seen = []) {
  return tagDb({
    "checkout-paid-service": { ...COUNTS_CLEAN, ...(over.counts || {}) },
    "checkout-paid-service-links": over.links || [],
    "checkout-repair-price": over.repair || [],
    "checkout-funnel-no-sale": over.presses || []
  }, seen);
}

function shape(r) {
  assert.ok(CHECK_IDS.includes(r.id), r.id);
  assert.ok(["PASS", "FAIL", "skip", "na"].includes(r.status), r.status);
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") {
    assert.equal(typeof r.suggestedFix, "string");
    assert.match(r.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
}

const byId = (rows, id) => rows.find((r) => r.id === id);

test("gap checkout: the source is read only and never calls fetch itself", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|SET)?/);
  assert.doesNotMatch(SRC, /\bfetchImpl\s*\(/);
  assert.doesNotMatch(SRC, /\bctx\.fetch\b/);
  assert.doesNotMatch(SRC, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(SRC, /createCheckoutSession|createPaymentLink|emit\(/);
  assert.deepEqual([...CHECK_IDS], [
    "checkout:paid-service", "checkout:repair-price", "checkout:funnel-door", "checkout:funnel-no-sale"
  ]);
});

test("gap checkout: every window is the number it says it is", () => {
  assert.equal(QUOTED_WAIT_MS, CHECKOUT_LINK_WAIT_MS);
  assert.equal(PAID_STAGE_WAIT_MS, INBOX_PROCESSING_WAIT_MS);
  assert.equal(STAGED_WAIT_HOURS, HUMAN_QUEUED_HOURS, "held equal to gap-soft-pull HUMAN_QUEUED_HOURS");
  assert.equal(STAGED_WAIT_MS, 48 * HOUR);
  assert.deepEqual([...REPAIR_PLAN_KEYS], [...SLO_REPAIR_PLAN_KEYS], "the two repair plans the widget offers");
  assert.equal(FUNNEL_MIN_PRESSES, 3);
  assert.equal(FUNNEL_PATH, "/api/public/funnel-checkout");
});

test("gap checkout: no database or no org is four skips, never a pass", async () => {
  const none = await gapChecks({ now: NOW, fetchImpl: reply(200, CAT_OK) });
  none.forEach(shape);
  assert.deepEqual(none.map((r) => r.status), ["skip", "skip", "PASS", "skip"]);
  const noOrg = await gapChecks({ db: db(), now: NOW, fetchImpl: reply(200, CAT_OK) });
  assert.deepEqual(noOrg.map((r) => r.status), ["skip", "skip", "PASS", "skip"]);
  assert.match(byId(noOrg, "checkout:paid-service").detail, /no org id/);
});

test("gap checkout: clean books with a sound till is PASS, PASS, PASS and a nothing-to-judge", async () => {
  const seen = [];
  const rows = await gapChecks({ db: db({}, seen), orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK), baseUrl: "https://fundhub.ai" });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "na"]);
  const na = byId(rows, "checkout:funnel-no-sale");
  assert.equal(na.na.code, "low-traffic");
  assert.deepEqual(na.na.args, { check: "checkout:funnel-no-sale", count: 0, min: 3, what: "funnel checkout presses", days: FUNNEL_WINDOW_DAYS });
  // Every read went through the tagged statements, and each one is a SELECT.
  for (const s of seen) assert.match(s.sql.replace(/\/\*[\s\S]*?\*\//g, "").trim(), /^SELECT\b/i);
});

describe("gap checkout: checkout:paid-service", () => {
  test("a request priced and given no link for 30 minutes is red, and it says the client cannot ask again", async () => {
    const rows = await gapChecks({ db: db({ counts: { real_n: 1, quoted_n: 1, oldest: ago(30 * MIN) } }), orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK) });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 request priced with no link ever made/);
    assert.match(r.detail, /cannot ask again/);
    assert.match(r.detail, /oldest has waited 30 minutes/);
  });

  test("each stuck state is its own sentence: no link, money never recorded, never staged, failed with money, staged too long", async () => {
    const rows = await gapChecks({
      db: db({ counts: { real_n: 6, no_link_n: 1, unrecorded_n: 2, paid_n: 1, failed_paid_n: 1, staged_n: 1, oldest: ago(3 * DAY) } }),
      orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK)
    });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 request waiting for payment with no link on it/);
    assert.match(r.detail, /2 requests where Commas shows money for it and the request never moved to paid/);
    assert.match(r.detail, /1 paid request never staged/);
    assert.match(r.detail, /1 request closed failed with the buyer's money still on it/);
    assert.match(r.detail, /1 round staged and waiting on a person for more than 48 hours/);
    assert.match(r.suggestedFix, /paid-service-payment\.mjs must be registered in src\/register-all\.mjs/);
  });

  test("a live link that answers 404 is red even when every request state is fine", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      return { status: 404, text: async () => "" };
    };
    const rows = await gapChecks({
      db: db({ counts: { real_n: 1 }, links: [{ id: "r1", checkout_url: "https://pay.example.test/c/abc" }] }),
      orgId: ORG, now: NOW,
      fetchImpl: async (url, init) => (String(url).includes("funnel-checkout") ? reply(200, CAT_OK)() : fetchImpl(url, init))
    });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 live checkout link that does not answer/);
    assert.deepEqual(calls, ["HEAD https://pay.example.test/c/abc"]);
  });

  test("a host that refuses HEAD is asked once with GET, and a 403 wall proves nothing (not red)", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (String(url).includes("funnel-checkout")) return reply(200, CAT_OK)();
      return init.method === "HEAD" ? { status: 405, text: async () => "" } : { status: 403, text: async () => "wall" };
    };
    const rows = await gapChecks({
      db: db({ counts: { real_n: 1 }, links: [{ id: "r1", checkout_url: "https://pay.example.test/c/abc" }] }),
      orgId: ORG, now: NOW, fetchImpl
    });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /1 unclear/);
    assert.deepEqual(calls.filter((c) => !c.includes("funnel")), ["HEAD https://pay.example.test/c/abc", "GET https://pay.example.test/c/abc"]);
  });

  test("a link that is not a web address is dead, and nothing is asked", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      return reply(200, CAT_OK)();
    };
    const rows = await gapChecks({
      db: db({ counts: { real_n: 1 }, links: [{ id: "r1", checkout_url: "javascript:alert(1)" }] }),
      orgId: ORG, now: NOW, fetchImpl
    });
    assert.equal(byId(rows, "checkout:paid-service").status, "FAIL");
    assert.deepEqual(calls.filter((c) => !c.includes("funnel")), []);
  });

  test("at most five live links are asked about, and a timeout is unreachable, not red", async () => {
    const links = Array.from({ length: MAX_LINK_CHECKS }, (_, i) => ({ id: `r${i}`, checkout_url: `https://pay.example.test/c/${i}` }));
    const fetchImpl = async (url) => {
      if (String(url).includes("funnel-checkout")) return reply(200, CAT_OK)();
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    const rows = await gapChecks({ db: db({ counts: { real_n: 5 }, links }), orgId: ORG, now: NOW, fetchImpl });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /5 live links asked about with HEAD: 0 answer, 5 unclear/);
  });

  test("a failed read is a skip with the reason, never a PASS", async () => {
    const bad = tagDb({
      "checkout-paid-service": new Error("canceling statement due to statement timeout"),
      "checkout-paid-service-links": [],
      "checkout-repair-price": [],
      "checkout-funnel-no-sale": []
    });
    const rows = await gapChecks({ db: bad, orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK) });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "skip");
    assert.match(r.detail, /statement timeout/);
  });

  test("test requests are counted apart and never make it red", async () => {
    const rows = await gapChecks({ db: db({ counts: { real_n: 0, test_n: 3 } }), orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK) });
    const r = byId(rows, "checkout:paid-service");
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /3 test requests left out/);
  });
});

describe("gap checkout: checkout:repair-price", () => {
  const ev = (over = {}) => ({
    event_id: "e1", created_at: ago(DAY), offer_key: "REPAIR_TRIAL", link_ref: "pl_abc123456", event_cents: "20000",
    link_id: "l1", link_cents: "20000", link_purpose: "repair", ...over
  });

  test("the plans the check knows are the plans the catalogue prices", () => {
    for (const key of REPAIR_PLAN_KEYS) assert.ok(planPriceCents(key) > 0, key);
    assert.equal(planPriceCents("REPAIR_TRIAL"), getOffer("REPAIR_TRIAL").priceCents);
    assert.equal(planPriceCents("NOT_A_PLAN"), null);
    assert.equal(planPriceCents("X", () => ({ priceCents: 0 })), null);
  });

  test("a link that asks for what the door recorded is clean", () => {
    const j = judgeRepairRows([ev(), ev({ offer_key: "REPAIR_DFY", event_cents: "100000", link_cents: "100000", link_ref: "pl_zzz" })]);
    assert.deepEqual(j.problems, []);
    assert.equal(j.checked, 2);
  });

  test("a link that asks for another amount than the door recorded is a problem, with both amounts", () => {
    const j = judgeRepairRows([ev({ link_cents: "10000" })]);
    assert.equal(j.problems.length, 1);
    assert.match(j.problems[0], /the link asks for \$100 but the door recorded \$200/);
  });

  test("an event with no link row, a link that is not a repair link, and an unknown plan are each a problem", () => {
    assert.match(judgeRepairRows([ev({ link_id: null, link_cents: null, link_purpose: null })]).problems[0], /no link row is on file/);
    assert.match(judgeRepairRows([ev({ link_purpose: "diagnostic" })]).problems[0], /not a repair link/);
    assert.match(judgeRepairRows([ev({ offer_key: "FUNDING_DFY" })]).problems[0], /not one of the two repair plans/);
  });

  test("PASS says nothing was picked, FAIL names the first three, and a moved price is a note, not red", async () => {
    const none = await gapChecks({ db: db(), orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK) });
    assert.match(byId(none, "checkout:repair-price").detail, /no buyer picked a repair plan/);

    const bad = await gapChecks({
      db: db({ repair: [ev({ link_cents: "1" }), ev({ link_cents: "2" }), ev({ link_cents: "3" }), ev({ link_cents: "4" })] }),
      orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK)
    });
    const f = byId(bad, "checkout:repair-price");
    assert.equal(f.status, "FAIL");
    assert.match(f.detail, /^4 repair checkouts/);

    const moved = await gapChecks({
      db: db({ repair: [ev({ event_cents: "15000", link_cents: "15000" })] }), orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK)
    });
    const p = byId(moved, "checkout:repair-price");
    assert.equal(p.status, "PASS");
    assert.match(p.detail, /Price moved since: REPAIR_TRIAL was \$150 on the last link and the catalogue says \$200 now/);
  });
});

describe("gap checkout: checkout:funnel-door", () => {
  const run = async (fetchImpl) => byId(await gapChecks({ db: db(), orgId: ORG, now: NOW, fetchImpl, baseUrl: "https://fundhub.ai" }), "checkout:funnel-door");

  test("PASS: 200, ready, three priced and live items; the call is one GET to the till", async () => {
    const calls = [];
    const r = await run(async (url, init) => {
      calls.push(`${init.method} ${url}`);
      return reply(200, CAT_OK)();
    });
    assert.equal(r.status, "PASS");
    assert.deepEqual(calls, ["GET https://fundhub.ai/api/public/funnel-checkout"]);
  });

  test("FAIL: checkout not ready, an item with no price, an item turned off, an item gone, a 500, a page that is not JSON", async () => {
    const notReady = await run(reply(200, { ...CAT_OK, checkout: { ready: false } }));
    assert.equal(notReady.status, "FAIL");
    assert.match(notReady.detail, /checkout is not ready, so no funnel buyer can pay/);

    const noPrice = await run(reply(200, { ...CAT_OK, items: CAT_OK.items.map((i) => (i.slug === "board" ? { ...i, priceCents: null } : i)) }));
    assert.match(noPrice.detail, /board has no price on the till/);

    const off = await run(reply(200, { ...CAT_OK, items: CAT_OK.items.map((i) => (i.slug === "trial" ? { ...i, available: false } : i)) }));
    assert.match(off.detail, /trial is priced but not available/);

    const gone = await run(reply(200, { ...CAT_OK, items: CAT_OK.items.filter((i) => i.slug !== "autopsy") }));
    assert.match(gone.detail, /no longer lists autopsy/);

    const down = await run(reply(500, "boom"));
    assert.equal(down.status, "FAIL");
    assert.match(down.detail, /answered 500, not 200/);

    const html = await run(reply(200, "<html>home</html>"));
    assert.match(html.detail, /did not answer JSON/);
  });

  test("a till that cannot be reached, and a run with no fetch, are skips with the reason", async () => {
    const unreachable = await run(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    assert.equal(unreachable.status, "skip");
    assert.match(unreachable.detail, /ENOTFOUND/);
    const noFetch = byId(await gapChecks({ db: db(), orgId: ORG, now: NOW }), "checkout:funnel-door");
    assert.equal(noFetch.status, "skip");
  });
});

describe("gap checkout: checkout:funnel-no-sale", () => {
  const press = (item, presses, paid) => ({ item, presses_n: presses, paid_n: paid });
  const run = async (presses) => byId(await gapChecks({ db: db({ presses }), orgId: ORG, now: NOW, fetchImpl: reply(200, CAT_OK) }), "checkout:funnel-no-sale");

  test("fewer than three presses is nothing to judge, with the numbers a person can read", async () => {
    const r = await run([press("trial", 2, 0)]);
    assert.equal(r.status, "na");
    assert.equal(r.na.code, "low-traffic");
    assert.equal(r.na.args.count, 2);
    assert.match(r.detail, /Only 2 presses of buy on a \/partner\/ page in 7 days/);
  });

  test("three or more presses on one item and nobody paid is red, naming the item", async () => {
    const r = await run([press("board", 4, 0), press("trial", 1, 1)]);
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /4 people pressed buy on board and none paid/);
    assert.doesNotMatch(r.detail, /trial/);
  });

  test("one sale on the item is green, even with many abandoned carts", async () => {
    const r = await run([press("board", 9, 1)]);
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /9 funnel presses in the last 7 days, 1 paid/);
  });

  test("two presses on each of two items is not enough on either one (an item is judged alone)", async () => {
    const r = await run([press("board", 2, 0), press("trial", 2, 0), press("autopsy", 1, 0)]);
    assert.equal(r.status, "PASS");
  });

  test("naVerify says true only while the same read still finds fewer than three presses", async () => {
    const few = tagDb({ "checkout-funnel-no-sale": [press("trial", 2, 0)] });
    const many = tagDb({ "checkout-funnel-no-sale": [press("trial", 3, 0)] });
    const args = { check: "checkout:funnel-no-sale" };
    assert.equal(await naVerify["low-traffic"](args, { db: few, orgId: ORG, now: NOW }), true);
    assert.equal(await naVerify["low-traffic"](args, { db: many, orgId: ORG, now: NOW }), false);
    assert.equal(await naVerify["low-traffic"]({ check: "something-else" }, { db: few, orgId: ORG, now: NOW }), false);
    assert.equal(await naVerify["low-traffic"](args, { now: NOW }), false);
  });
});

/* ---- the SQL, run for real against made-up tables -------------------------------------------- */

const R_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["status", "text"], ["requested_at", "timestamptz"],
  ["paid_at", "timestamptz"], ["resolved_at", "timestamptz"], ["checkout_url", "text"], ["checkout_expires_at", "timestamptz"]
];
const INBOX_COLS = [
  ["org_id", "uuid"], ["event_type", "text"], ["payment_id", "text"], ["received_at", "timestamptz"], ["raw_body", "text"]
];
const EV_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["name", "text"], ["is_demo", "boolean"],
  ["payload", "jsonb"], ["created_at", "timestamptz"]
];
const PL_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["link_ref", "text"], ["amount_cents", "bigint"], ["purpose", "text"]
];
const TX_COLS = [
  ["org_id", "uuid"], ["status", "text"], ["provider_ref", "text"], ["raw_payload", "jsonb"]
];

const C1 = "cccccccc-0000-4000-8000-000000000001";
const C_TEST = "cccccccc-0000-4000-8000-000000000009";
const rid = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clients = [client_(C1), client_(C_TEST, { is_demo: true })];

const req = (n, over = {}) => ({
  id: rid(n), org_id: ORG, client_id: C1, status: "awaiting_payment", requested_at: ago(2 * HOUR), paid_at: null,
  resolved_at: null, checkout_url: "https://pay.example.test/c/x", checkout_expires_at: new Date(NOW.getTime() + 5 * DAY).toISOString(), ...over
});
const inbox = (over = {}) => ({
  org_id: ORG, event_type: "payment.succeeded", payment_id: "ORD-1", received_at: ago(HOUR), raw_body: "{}", ...over
});

function paidServiceParams() {
  return [
    ORG, ago(QUOTED_WAIT_MS), ago(PAID_STAGE_WAIT_MS), ago(STAGED_WAIT_MS), ago(HOUR), ago(30 * DAY),
    TEST_CLIENT_EMAIL_RE, "sim-pay-%"
  ];
}

// want: [real_n, quoted_n, no_link_n, paid_n, staged_n, unrecorded_n, failed_paid_n, test_n]
const PAID_CASES = [
  ["no rows is clean", { rows: [] }, [0, 0, 0, 0, 0, 0, 0, 0]],
  ["a fresh waiting request with a link is clean", { rows: [req(1)] }, [1, 0, 0, 0, 0, 0, 0, 0]],
  ["quoted for 30 minutes is stuck", { rows: [req(1, { status: "quoted", checkout_url: null, requested_at: ago(30 * MIN) })] }, [1, 1, 0, 0, 0, 0, 0, 0]],
  ["quoted for 5 minutes is still being made", { rows: [req(1, { status: "quoted", checkout_url: null, requested_at: ago(5 * MIN) })] }, [1, 0, 0, 0, 0, 0, 0, 0]],
  ["waiting with no link for 30 minutes is a break", { rows: [req(1, { checkout_url: null, requested_at: ago(30 * MIN) })] }, [1, 0, 1, 0, 0, 0, 0, 0]],
  ["waiting with a blank link is a break", { rows: [req(1, { checkout_url: "  ", requested_at: ago(30 * MIN) })] }, [1, 0, 1, 0, 0, 0, 0, 0]],
  ["paid 30 minutes ago and never staged is a break", { rows: [req(1, { status: "paid", paid_at: ago(30 * MIN) })] }, [1, 0, 0, 1, 0, 0, 0, 0]],
  ["paid 5 minutes ago is inside the wait", { rows: [req(1, { status: "paid", paid_at: ago(5 * MIN) })] }, [1, 0, 0, 0, 0, 0, 0, 0]],
  ["staged for 3 days is waiting on a person too long", { rows: [req(1, { status: "staged", paid_at: ago(3 * DAY) })] }, [1, 0, 0, 0, 1, 0, 0, 0]],
  ["staged for a day is fine", { rows: [req(1, { status: "staged", paid_at: ago(DAY) })] }, [1, 0, 0, 0, 0, 0, 0, 0]],
  [
    "money named the request id and the request never moved to paid",
    { rows: [req(1)], inbox: [inbox({ raw_body: JSON.stringify({ link_ref: rid(1) }) })] },
    [1, 0, 0, 0, 0, 1, 0, 0]
  ],
  [
    "money that came in 5 minutes ago is inside the grace",
    { rows: [req(1)], inbox: [inbox({ received_at: ago(5 * MIN), raw_body: rid(1) })] },
    [1, 0, 0, 0, 0, 0, 0, 0]
  ],
  [
    "a simulated receipt is not money",
    { rows: [req(1)], inbox: [inbox({ payment_id: "sim-pay-1790000000000", raw_body: rid(1) })] },
    [1, 0, 0, 0, 0, 0, 0, 0]
  ],
  [
    "a failed-payment notice is not money",
    { rows: [req(1)], inbox: [inbox({ event_type: "payment.failed", raw_body: rid(1) })] },
    [1, 0, 0, 0, 0, 0, 0, 0]
  ],
  [
    "money for a request that was swept to cancelled after 7 days is the worst case",
    { rows: [req(1, { status: "cancelled", resolved_at: ago(2 * DAY), checkout_url: "https://x.example.test/a" })], inbox: [inbox({ raw_body: rid(1) })] },
    [1, 0, 0, 0, 0, 1, 0, 0]
  ],
  [
    "a cancelled request from 40 days ago is history",
    { rows: [req(1, { status: "cancelled", resolved_at: ago(40 * DAY), requested_at: ago(45 * DAY) })], inbox: [inbox({ raw_body: rid(1) })] },
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],
  [
    "failed with the buyer's money on it, 2 hours ago",
    { rows: [req(1, { status: "failed", paid_at: ago(3 * HOUR), resolved_at: ago(2 * HOUR) })] },
    [1, 0, 0, 0, 0, 0, 1, 0]
  ],
  ["failed with no money on it is only a failed link", { rows: [req(1, { status: "failed", resolved_at: ago(2 * HOUR) })] }, [1, 0, 0, 0, 0, 0, 0, 0]],
  ["a request fulfilled long ago is not read", { rows: [req(1, { status: "fulfilled", paid_at: ago(9 * DAY), resolved_at: ago(8 * DAY) })] }, [0, 0, 0, 0, 0, 0, 0, 0]],
  [
    "a test client's stuck request is counted apart",
    { rows: [req(1, { client_id: C_TEST, status: "quoted", checkout_url: null, requested_at: ago(HOUR) })] },
    [0, 0, 0, 0, 0, 0, 0, 1]
  ],
  ["another org's request is not read", { rows: [req(1, { org_id: OTHER_ORG, status: "quoted", checkout_url: null, requested_at: ago(HOUR) })] }, [0, 0, 0, 0, 0, 0, 0, 0]]
];

describe("gap checkout: the paid-service SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  for (const [name, scenario, want] of PAID_CASES) {
    test(name, async () => {
      const sql = withShadows(PAID_SERVICE_SQL, [
        shadow("paid_service_requests", R_COLS, scenario.rows),
        shadow("clients", CLIENT_COLS, clients),
        shadow("commas_inbox", INBOX_COLS, scenario.inbox || [])
      ]);
      const { rows } = await runShadowSql(sql, paidServiceParams());
      const r = rows[0];
      const got = [r.real_n, r.quoted_n, r.no_link_n, r.paid_n, r.staged_n, r.unrecorded_n, r.failed_paid_n, r.test_n].map(Number);
      assert.deepEqual(got, want, name);
    });
  }

  test("live links: only a waiting request with a link that has not expired, newest first, test clients left out, five at most", async () => {
    const rows = [
      req(1, { requested_at: ago(10 * HOUR) }),
      req(2, { requested_at: ago(9 * HOUR), checkout_expires_at: ago(HOUR) }),
      req(3, { requested_at: ago(8 * HOUR), checkout_url: null }),
      req(4, { requested_at: ago(7 * HOUR), client_id: C_TEST }),
      req(5, { requested_at: ago(6 * HOUR), status: "paid", paid_at: ago(5 * HOUR) }),
      ...[10, 11, 12, 13, 14, 15].map((n, i) => req(n, { requested_at: ago((5 - i * 0.5) * HOUR) }))
    ];
    const sql = withShadows(LIVE_LINKS_SQL, [shadow("paid_service_requests", R_COLS, rows), shadow("clients", CLIENT_COLS, clients)]);
    const got = await runShadowSql(sql, [ORG, NOW.toISOString(), TEST_CLIENT_EMAIL_RE]);
    assert.equal(got.rows.length, 5);
    assert.equal(got.rows[0].id, rid(15), "newest first");
    for (const r of got.rows) assert.ok(![rid(2), rid(3), rid(4), rid(5)].includes(r.id), r.id);
  });
});

const evt = (n, over = {}) => ({
  id: rid(100 + n), org_id: ORG, client_id: C1, name: "slo.repair_checkout_started", is_demo: false,
  payload: { link_ref: `pl_${n}`, offer_key: "REPAIR_TRIAL", amount_cents: 20000 }, created_at: ago(DAY), ...over
});
const plink = (n, over = {}) => ({ id: rid(200 + n), org_id: ORG, link_ref: `pl_${n}`, amount_cents: 20000, purpose: "repair", ...over });

describe("gap checkout: the repair price SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  const run = async (events, links) => {
    const sql = withShadows(REPAIR_PRICE_SQL, [
      shadow("events", EV_COLS, events), shadow("clients", CLIENT_COLS, clients), shadow("payment_links", PL_COLS, links)
    ]);
    return (await runShadowSql(sql, [ORG, ago(30 * DAY), TEST_CLIENT_EMAIL_RE])).rows;
  };

  test("an event with its link comes back with both amounts, so the judge can compare them", async () => {
    const rows = await run([evt(1)], [plink(1)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_cents, "20000");
    assert.equal(rows[0].link_cents, "20000");
    assert.equal(rows[0].link_purpose, "repair");
  });

  test("an event with no link row still comes back (link_id is null), so it can be called out", async () => {
    const rows = await run([evt(1)], []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].link_id, null);
  });

  test("demo events, old events, test clients, other orgs and other event names are left out", async () => {
    const rows = await run([
      evt(1, { is_demo: true }),
      evt(2, { payload: { link_ref: "pl_2", offer_key: "REPAIR_TRIAL", amount_cents: 20000, demo: "true" } }),
      evt(3, { created_at: ago(40 * DAY) }),
      evt(4, { client_id: C_TEST }),
      evt(5, { org_id: OTHER_ORG }),
      evt(6, { name: "slo.checkout_started" }),
      evt(7)
    ], [plink(7)]);
    assert.deepEqual(rows.map((r) => r.link_ref), ["pl_7"]);
  });

  test("a link whose amount differs from the event is caught end to end", async () => {
    const rows = await run([evt(1)], [plink(1, { amount_cents: 10000 })]);
    const j = judgeRepairRows(rows);
    assert.equal(j.problems.length, 1);
    assert.match(j.problems[0], /asks for \$100 but the door recorded \$200/);
  });
});

const PRESS_COLS = EV_COLS;
const press = (n, over = {}) => ({
  id: rid(300 + n), org_id: ORG, client_id: null, name: "funnel.checkout_started", is_demo: false,
  payload: { ref: `fn_${n}`, item: "trial", email: `buyer${n}@gmail.com`, amount_cents: 9700 }, created_at: ago(2 * DAY), ...over
});

describe("gap checkout: the funnel presses SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  const params = () => [ORG, ago(FUNNEL_WINDOW_DAYS * DAY), ago(DAY), TEST_CLIENT_EMAIL_RE, "sim-pay-%"];
  const run = async (events, inboxRows = [], txs = []) => {
    const sql = withShadows(FUNNEL_PRESSES_SQL, [
      shadow("events", PRESS_COLS, events),
      shadow("commas_inbox", INBOX_COLS, inboxRows),
      shadow("transactions", TX_COLS, txs)
    ]);
    return (await runShadowSql(sql, params())).rows;
  };

  test("presses are counted per item, and a press the inbox names is paid", async () => {
    const rows = await run(
      [press(1), press(2), press(3), press(4, { payload: { ref: "fn_4", item: "board", email: "b@gmail.com" } })],
      [inbox({ raw_body: JSON.stringify({ metadata: { link_ref: "fn_2" } }) })]
    );
    const trial = rows.find((r) => r.item === "trial");
    const board = rows.find((r) => r.item === "board");
    assert.deepEqual([trial.presses_n, trial.paid_n].map(Number), [3, 1]);
    assert.deepEqual([board.presses_n, board.paid_n].map(Number), [1, 0]);
  });

  test("a transaction that carries the ref counts as paid too, a failed one and a simulated one do not", async () => {
    const rows = await run(
      [press(1), press(2), press(3)],
      [],
      [
        { org_id: ORG, status: "succeeded", provider_ref: "ORD-9", raw_payload: { ref: "fn_1" } },
        { org_id: ORG, status: "failed", provider_ref: "ORD-8", raw_payload: { ref: "fn_2" } },
        { org_id: ORG, status: "succeeded", provider_ref: "sim-pay-1", raw_payload: { ref: "fn_3" } }
      ]
    );
    const trial = rows.find((r) => r.item === "trial");
    assert.deepEqual([trial.presses_n, trial.paid_n].map(Number), [3, 1]);
  });

  test("a press under a day old, a press older than the window, test emails and demo presses are not counted", async () => {
    const rows = await run([
      press(1, { created_at: ago(2 * HOUR) }),
      press(2, { created_at: ago(9 * DAY) }),
      press(3, { payload: { ref: "fn_3", item: "trial", email: "e2e+anything@fundhub.ai" } }),
      press(4, { is_demo: true }),
      press(5, { payload: { ref: "fn_5", item: "trial", email: "x@gmail.com", demo: "true" } }),
      press(6, { payload: { item: "trial", email: "x@gmail.com" } }),
      press(7)
    ]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].presses_n), 1);
  });
});
