import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADDON_GRACE_MS,
  ADDON_PAID_NO_PLAN_SQL,
  CHECK_IDS,
  MAX_ATTEMPTS,
  MONTHLY_ADD_ON_CODES,
  PAST_DUE_SQL,
  PROCESSOR_BILLED_PROVIDERS,
  RETRY_BACKOFF_MINUTES,
  SWEEPS_BEFORE_RED,
  SWEEP_EVERY_MS,
  WORK_WAIT_MS,
  gapChecks,
  judgePastDue
} from "./gap-subscriptions.mjs";
import {
  MAX_ATTEMPTS as REAL_MAX,
  PROCESSOR_BILLED_PROVIDERS as REAL_PROVIDERS,
  RETRY_BACKOFF_MINUTES as REAL_BACKOFF
} from "../../subscriptions/billing.mjs";
import { SWEEP_CRON } from "../../workflows/subscription-billing-sweeper.mjs";
import { ADD_ON_BY_CODE } from "../../subscriptions/partner-addons.mjs";
import { INBOX_PROCESSING_WAIT_MS } from "./gap-payments.mjs";
import { cronIntervalMs } from "../heartbeats.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./money-reads.mjs";
import {
  CLIENT_COLS, HAS_DB, ORG, OTHER_ORG, client_, closeShadowDb, runShadowSql, shadow, tagDb, withShadows
} from "./money-test-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-subscriptions.mjs"), "utf8");
const NOW = new Date("2026-10-10T18:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

test("gap subscriptions: the source is read only, charges nothing and sends nothing", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|SET)?/);
  assert.doesNotMatch(SRC, /\bfetch/i);
  assert.doesNotMatch(SRC, /claimCharge|settleFailed|settleSucceeded|resolveCharger|sendTemplated/);
  assert.deepEqual([...CHECK_IDS], ["subscriptions:past-due", "subscriptions:addon-paid-no-plan"]);
});

test("gap subscriptions: the numbers are the billing rail's own numbers", () => {
  assert.equal(MAX_ATTEMPTS, REAL_MAX);
  assert.deepEqual([...RETRY_BACKOFF_MINUTES], [...REAL_BACKOFF]);
  assert.deepEqual([...PROCESSOR_BILLED_PROVIDERS], [...REAL_PROVIDERS]);
  assert.equal(SWEEP_EVERY_MS, cronIntervalMs(SWEEP_CRON), "the sweeper's cron runs this often");
  assert.equal(WORK_WAIT_MS, SWEEPS_BEFORE_RED * SWEEP_EVERY_MS);
});

describe("gap subscriptions: judgePastDue", () => {
  const plan = (over = {}) => ({
    id: "s1", tier: "finance-os", status: "past_due", price_cents: "29700", billing_interval: "monthly",
    next_charge_at: ago(5 * HOUR), who: "FH-000111",
    charge_status: null, charge_attempt: null, charge_retry_at: null, charge_updated_at: null, ...over
  });

  test("a plan with no next date, no interval or no price can never be picked up", () => {
    for (const over of [{ next_charge_at: null }, { billing_interval: null }, { price_cents: null }, { price_cents: "0" }]) {
      assert.equal(judgePastDue(plan(over), NOW).kind, "not-schedulable");
    }
  });

  test("due for 2 sweeps with no attempt row is never tried; due 30 minutes ago is not yet", () => {
    assert.equal(judgePastDue(plan(), NOW).kind, "never-tried");
    assert.equal(judgePastDue(plan({ next_charge_at: ago(30 * MIN) }), NOW), null);
  });

  test("failed with tries left: red 2 sweeps after its retry time, not before", () => {
    const failed = (retryAgo, attempt = 1) => plan({ charge_status: "failed", charge_attempt: attempt, charge_retry_at: ago(retryAgo), charge_updated_at: ago(retryAgo + HOUR) });
    assert.equal(judgePastDue(failed(3 * HOUR), NOW).kind, "retry-missed");
    assert.equal(judgePastDue(failed(30 * MIN), NOW), null);
    // The retry time is in the future (a backoff of a day): nothing is missed.
    assert.equal(judgePastDue(plan({ charge_status: "failed", charge_attempt: 2, charge_retry_at: new Date(NOW.getTime() + 20 * HOUR).toISOString(), charge_updated_at: ago(HOUR) }), NOW), null);
  });

  test("every try used, or abandoned, is a person's decision and red", () => {
    assert.equal(judgePastDue(plan({ charge_status: "abandoned", charge_attempt: 4, charge_updated_at: ago(DAY) }), NOW).kind, "out-of-tries");
    assert.equal(judgePastDue(plan({ charge_status: "failed", charge_attempt: MAX_ATTEMPTS, charge_updated_at: ago(DAY) }), NOW).kind, "out-of-tries");
  });

  test("in flight for 2 sweeps means nobody knows if money moved", () => {
    assert.equal(judgePastDue(plan({ charge_status: "in_flight", charge_attempt: 1, charge_updated_at: ago(3 * HOUR) }), NOW).kind, "money-unknown");
    assert.equal(judgePastDue(plan({ charge_status: "in_flight", charge_attempt: 1, charge_updated_at: ago(10 * MIN) }), NOW), null);
  });

  test("a newest charge that succeeded while the plan still reads past due is paid-not-cleared", () => {
    assert.equal(judgePastDue(plan({ charge_status: "succeeded", charge_attempt: 2, charge_updated_at: ago(3 * HOUR) }), NOW).kind, "paid-not-cleared");
    assert.equal(judgePastDue(plan({ charge_status: "succeeded", charge_attempt: 2, charge_updated_at: ago(10 * MIN) }), NOW), null);
  });
});

describe("gap subscriptions: the row", () => {
  const planRow = (over = {}) => ({
    id: "s1", tier: "finance-os", status: "past_due", price_cents: "29700", billing_interval: "monthly",
    next_charge_at: ago(5 * HOUR), who: "FH-000111",
    charge_status: null, charge_attempt: null, charge_retry_at: null, charge_updated_at: null, ...over
  });
  const run = (rows) => gapChecks({ db: tagDb({ "subscriptions-past-due": rows }), orgId: ORG, now: NOW });

  test("no past-due plan is a PASS that says so", async () => {
    const [r] = await run([]);
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /no plan on our own billing rail is past due/);
    assert.equal(r.suggestedFix, null);
  });

  test("a past-due plan with a retry coming is a PASS", async () => {
    const [r] = await run([planRow({ charge_status: "failed", charge_attempt: 1, charge_retry_at: new Date(NOW.getTime() + HOUR).toISOString(), charge_updated_at: ago(MIN) })]);
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /1 plan on our own billing rail is past due, each with a retry coming/);
  });

  test("past-due plans nobody is working are red, grouped by kind, with who and how old", async () => {
    const [r] = await run([
      planRow({ who: "FH-000111" }),
      planRow({ id: "s2", who: "FH-000222", tier: "starter", next_charge_at: ago(4 * DAY) }),
      planRow({ id: "s3", who: "FH-000333", billing_interval: null }),
      planRow({ id: "s4", who: "FH-000444", charge_status: "abandoned", charge_attempt: 4, charge_updated_at: ago(DAY) }),
      planRow({ id: "s5", who: "FH-000555" })
    ]);
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /5 past-due plans nobody is working/);
    assert.match(r.detail, /3 never tried/);
    assert.match(r.detail, /1 no clock will try it/);
    assert.match(r.detail, /1 out of tries/);
    assert.match(r.detail, /FH-000111 \(finance-os\)/);
    assert.match(r.detail, /and more/);
    assert.match(r.detail, /oldest was due 4 days ago/);
    assert.match(r.suggestedFix, /ships with no charger/);
    assert.match(r.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
  });

  test("no database and no org are skips; a failed read is a skip with the reason", async () => {
    assert.equal((await gapChecks({ now: NOW }))[0].status, "skip");
    assert.match((await gapChecks({ db: tagDb({}), now: NOW }))[0].detail, /no org id/);
    const bad = tagDb({ "subscriptions-past-due": new Error("relation \"subscription_charges\" does not exist") });
    const [r] = await gapChecks({ db: bad, orgId: ORG, now: NOW });
    assert.equal(r.status, "skip");
    assert.match(r.detail, /does not exist/);
  });
});

/* ---- the SQL, run for real against made-up tables -------------------------------------------- */

const SUB_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["partner_id", "uuid"], ["tier", "text"], ["status", "text"],
  ["price_cents", "bigint"], ["billing_interval", "text"], ["next_charge_at", "timestamptz"], ["updated_at", "timestamptz"],
  ["effective_to", "timestamptz"], ["cancelled_at", "timestamptz"], ["is_demo", "boolean"], ["provider", "text"]
];
const PARTNER_COLS = [["id", "uuid"], ["org_id", "uuid"], ["slug", "text"]];
const CHARGE_COLS = [
  ["subscription_id", "uuid"], ["status", "text"], ["attempt", "int"], ["next_retry_at", "timestamptz"],
  ["updated_at", "timestamptz"], ["period_start", "timestamptz"]
];
const C1 = "cccccccc-0000-4000-8000-000000000001";
const C_TEST = "cccccccc-0000-4000-8000-000000000009";
const P1 = "99999999-0000-4000-8000-000000000001";
const sid = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clients = [client_(C1), client_(C_TEST, { email: "e2e+sub@fundhub.ai" })];
const partners = [{ id: P1, org_id: ORG, slug: "acme-capital" }];

const sub = (n, over = {}) => ({
  id: sid(n), org_id: ORG, client_id: C1, partner_id: null, tier: "finance-os", status: "past_due", price_cents: 29700,
  billing_interval: "monthly", next_charge_at: ago(5 * HOUR), updated_at: ago(DAY), effective_to: null, cancelled_at: null,
  is_demo: false, provider: "commas", ...over
});
const charge = (n, over = {}) => ({
  subscription_id: sid(n), status: "failed", attempt: 1, next_retry_at: ago(3 * HOUR), updated_at: ago(4 * HOUR),
  period_start: ago(10 * HOUR), ...over
});

describe("gap subscriptions: the past-due SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  const run = async (subs, charges = []) => {
    const sql = withShadows(PAST_DUE_SQL, [
      shadow("subscriptions", SUB_COLS, subs),
      shadow("clients", CLIENT_COLS, clients),
      shadow("partners", PARTNER_COLS, partners),
      shadow("subscription_charges", CHARGE_COLS, charges)
    ]);
    return (await runShadowSql(sql, [ORG, [...PROCESSOR_BILLED_PROVIDERS], TEST_CLIENT_EMAIL_RE])).rows;
  };

  test("only a live, past-due plan on our own rail comes back", async () => {
    const rows = await run([
      sub(1),
      sub(2, { status: "active" }),
      sub(3, { effective_to: ago(HOUR) }),
      sub(4, { cancelled_at: ago(HOUR) }),
      sub(5, { is_demo: true }),
      sub(6, { provider: "commas_subscription" }),
      sub(7, { provider: " Commas_Subscription " }),
      sub(8, { client_id: C_TEST }),
      sub(9, { org_id: OTHER_ORG })
    ]);
    assert.deepEqual(rows.map((r) => r.id), [sid(1)]);
  });

  test("a partner's plan is named by its slug, a client's by its code", async () => {
    const rows = await run([sub(1, { client_id: null, partner_id: P1 }), sub(2)]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.who]));
    assert.equal(by[sid(1)], "acme-capital");
    assert.equal(by[sid(2)], "FH-000001");
  });

  test("the newest attempt is the one by period, then by touch", async () => {
    const rows = await run([sub(1)], [
      charge(1, { status: "succeeded", attempt: 1, period_start: ago(40 * DAY), updated_at: ago(40 * DAY) }),
      charge(1, { status: "failed", attempt: 2, period_start: ago(10 * HOUR), updated_at: ago(4 * HOUR) }),
      charge(1, { status: "abandoned", attempt: 4, period_start: ago(10 * HOUR), updated_at: ago(HOUR) })
    ]);
    assert.equal(rows[0].charge_status, "abandoned");
    assert.equal(Number(rows[0].charge_attempt), 4);
  });

  test("a plan with no attempt row comes back with null attempt fields, and judgePastDue calls it never tried", async () => {
    const rows = await run([sub(1)]);
    assert.equal(rows[0].charge_status, null);
    assert.equal(judgePastDue(rows[0], NOW).kind, "never-tried");
  });

  test("end to end: the rows the SQL returns are judged the way the row says", async () => {
    const rows = await run(
      [sub(1), sub(2), sub(3, { next_charge_at: null })],
      [charge(2, { status: "failed", attempt: 2, next_retry_at: new Date(NOW.getTime() + 20 * HOUR).toISOString(), updated_at: ago(MIN) })]
    );
    const kinds = Object.fromEntries(rows.map((r) => [r.id, judgePastDue(r, NOW)?.kind ?? "working"]));
    assert.deepEqual(kinds, { [sid(1)]: "never-tried", [sid(2)]: "working", [sid(3)]: "not-schedulable" });
  });
});

/* ---- subscriptions:addon-paid-no-plan -------------------------------------------------------- */

test("gap subscriptions: the monthly add-on codes are the catalogue's monthly ones, and Lead Flow is not among them", () => {
  const monthly = Object.values(ADD_ON_BY_CODE).filter((a) => a.billing === "monthly").map((a) => a.productCode).sort();
  assert.deepEqual([...MONTHLY_ADD_ON_CODES], monthly);
  assert.ok(MONTHLY_ADD_ON_CODES.length >= 2);
  assert.ok(!MONTHLY_ADD_ON_CODES.includes("lead-flow"));
  assert.equal(ADDON_GRACE_MS, INBOX_PROCESSING_WAIT_MS);
});

describe("gap subscriptions: subscriptions:addon-paid-no-plan", () => {
  const counts = (over = {}) => ({ paid_n: 0, n: 0, test_n: 0, oldest: null, sample: null, ...over });
  const run = (over) => gapChecks({
    db: tagDb({ "subscriptions-past-due": [], "subscriptions-addon-paid-no-plan": counts(over) }), orgId: ORG, now: NOW
  }).then((rows) => rows[1]);

  test("nobody paid is a PASS that says so; paid and planned is a PASS that counts", async () => {
    const none = await run({});
    assert.equal(none.id, "subscriptions:addon-paid-no-plan");
    assert.equal(none.status, "PASS");
    assert.match(none.detail, /no partner has paid for a monthly add-on yet/);
    const some = await run({ paid_n: 3, test_n: 1 });
    assert.match(some.detail, /3 monthly add-on payments from partners, and each has its plan \(1 demo-partner payment left out\)/);
  });

  test("a partner who paid with no plan is red, with the partner, the add-on and the age", async () => {
    const r = await run({ paid_n: 2, n: 1, oldest: ago(3 * DAY), sample: "acme-capital (creative-intelligence)" });
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 partner paid for a monthly add-on and no plan covers the payment/);
    assert.match(r.detail, /paid 3 days ago/);
    assert.match(r.detail, /acme-capital \(creative-intelligence\)/);
    assert.match(r.suggestedFix, /action=activate/);
  });

  test("a failed read is a skip with the reason", async () => {
    const bad = tagDb({ "subscriptions-past-due": [], "subscriptions-addon-paid-no-plan": new Error("relation \"products\" does not exist") });
    const rows = await gapChecks({ db: bad, orgId: ORG, now: NOW });
    assert.equal(rows[1].status, "skip");
    assert.match(rows[1].detail, /does not exist/);
  });
});

const PL_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["partner_id", "uuid"], ["product_id", "uuid"], ["status", "text"],
  ["is_demo", "boolean"], ["paid_at", "timestamptz"]
];
const PRODUCT_COLS = [["id", "uuid"], ["code", "text"]];
const PARTNER2_COLS = [["id", "uuid"], ["org_id", "uuid"], ["slug", "text"], ["is_demo", "boolean"]];
const ASUB_COLS = [
  ["org_id", "uuid"], ["partner_id", "uuid"], ["tier", "text"], ["effective_from", "timestamptz"], ["effective_to", "timestamptz"]
];
const P2 = "99999999-0000-4000-8000-000000000002";
const P_DEMO = "99999999-0000-4000-8000-000000000009";
const PROD_CI = "77777777-0000-4000-8000-000000000001";
const PROD_LF = "77777777-0000-4000-8000-000000000002";
const products = [{ id: PROD_CI, code: "creative-intelligence" }, { id: PROD_LF, code: "lead-flow" }];
const partners2 = [
  { id: P1, org_id: ORG, slug: "acme-capital", is_demo: false },
  { id: P2, org_id: ORG, slug: "beta-funding", is_demo: false },
  { id: P_DEMO, org_id: ORG, slug: "demo-partner", is_demo: true }
];
const plink = (n, over = {}) => ({
  id: sid(300 + n), org_id: ORG, partner_id: P1, product_id: PROD_CI, status: "paid", is_demo: false, paid_at: ago(DAY), ...over
});
const aplan = (over = {}) => ({
  org_id: ORG, partner_id: P1, tier: "creative-intelligence", effective_from: ago(DAY), effective_to: null, ...over
});

// want: [paid_n, n, test_n]
const ADDON_CASES = [
  ["nothing paid is clean", { links: [], subs: [] }, [0, 0, 0]],
  ["paid, and the plan opened at the pay time", { links: [plink(1)], subs: [aplan()] }, [1, 0, 0]],
  ["paid, and no plan at all", { links: [plink(1)], subs: [] }, [1, 1, 0]],
  ["paid, and the same add-on was already running from before (already_active)", { links: [plink(1)], subs: [aplan({ effective_from: ago(40 * DAY) })] }, [1, 0, 0]],
  ["paid, and the earlier plan ended before this payment: the partner needs a new one", { links: [plink(1)], subs: [aplan({ effective_from: ago(60 * DAY), effective_to: ago(10 * DAY) })] }, [1, 1, 0]],
  ["paid, and the plan belongs to another partner", { links: [plink(1)], subs: [aplan({ partner_id: P2 })] }, [1, 1, 0]],
  ["paid, and the plan is another add-on", { links: [plink(1)], subs: [aplan({ tier: "dfy-marketing" })] }, [1, 1, 0]],
  ["the tier is matched without regard to case or spaces", { links: [plink(1)], subs: [aplan({ tier: " Creative-Intelligence " })] }, [1, 0, 0]],
  ["Lead Flow is per call, it has no plan on purpose", { links: [plink(1, { product_id: PROD_LF })], subs: [] }, [0, 0, 0]],
  ["paid 5 minutes ago is inside the grace", { links: [plink(1, { paid_at: ago(5 * 60 * 1000) })], subs: [] }, [0, 0, 0]],
  ["an ask not paid yet is not read", { links: [plink(1, { status: "sent", paid_at: null })], subs: [] }, [0, 0, 0]],
  ["a demo link is not read", { links: [plink(1, { is_demo: true })], subs: [] }, [0, 0, 0]],
  ["a client's link (no partner) is not read", { links: [plink(1, { partner_id: null })], subs: [] }, [0, 0, 0]],
  ["a demo partner is counted apart", { links: [plink(1, { partner_id: P_DEMO })], subs: [] }, [0, 0, 1]],
  ["another org's link is not read", { links: [plink(1, { org_id: OTHER_ORG })], subs: [] }, [0, 0, 0]]
];

describe("gap subscriptions: the add-on SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  for (const [name, scenario, want] of ADDON_CASES) {
    test(name, async () => {
      const sql = withShadows(ADDON_PAID_NO_PLAN_SQL, [
        shadow("payment_links", PL_COLS, scenario.links),
        shadow("products", PRODUCT_COLS, products),
        shadow("partners", PARTNER2_COLS, partners2),
        shadow("subscriptions", ASUB_COLS, scenario.subs)
      ]);
      const { rows } = await runShadowSql(sql, [ORG, [...MONTHLY_ADD_ON_CODES], ago(ADDON_GRACE_MS)]);
      const got = [rows[0].paid_n, rows[0].n, rows[0].test_n].map(Number);
      assert.deepEqual(got, want, name);
    });
  }

  test("the sample names the partner and the add-on", async () => {
    const sql = withShadows(ADDON_PAID_NO_PLAN_SQL, [
      shadow("payment_links", PL_COLS, [plink(1)]), shadow("products", PRODUCT_COLS, products),
      shadow("partners", PARTNER2_COLS, partners2), shadow("subscriptions", ASUB_COLS, [])
    ]);
    const { rows } = await runShadowSql(sql, [ORG, [...MONTHLY_ADD_ON_CODES], ago(ADDON_GRACE_MS)]);
    assert.equal(rows[0].sample, "acme-capital (creative-intelligence)");
  });
});
