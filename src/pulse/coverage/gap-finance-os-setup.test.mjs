import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  PAID_TURNS_ON_SQL,
  SETUP_DESCRIPTION,
  SETUP_FEE_ENV,
  SETUP_GRACE_MS,
  SETUP_PROVIDER_REF_PREFIX,
  SETUP_PURPOSE,
  SETUP_TIER,
  gapChecks,
  parseSetupFeeCents
} from "./gap-finance-os-setup.mjs";
import { INBOX_PROCESSING_WAIT_MS } from "./gap-payments.mjs";
import {
  readSetupFeeCents,
  SETUP_DESCRIPTION as REAL_DESCRIPTION,
  SETUP_FEE_ENV as REAL_FEE_ENV,
  SETUP_PROVIDER_REF_PREFIX as REAL_REF_PREFIX,
  SETUP_PURPOSE as REAL_PURPOSE
} from "../../finance/money-setup.mjs";
import { FINANCE_OS_TIER } from "../../finance/finance-os-entitlement.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./money-reads.mjs";
import {
  CLIENT_COLS, HAS_DB, ORG, OTHER_ORG, client_, closeShadowDb, runShadowSql, shadow, tagDb, withShadows
} from "./money-test-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-finance-os-setup.mjs"), "utf8");
const NOW = new Date("2026-10-10T18:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const byId = (rows, id) => rows.find((r) => r.id === id);

function shape(r) {
  assert.ok(CHECK_IDS.includes(r.id), r.id);
  assert.ok(["PASS", "FAIL", "skip", "na"].includes(r.status));
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") assert.match(r.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
  else assert.equal(r.suggestedFix, null);
}

test("gap finance-os-setup: the source is read only and sends nothing", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|SET)?/);
  assert.doesNotMatch(SRC, /\bfetch/i);
  assert.doesNotMatch(SRC, /sendTemplated|startSubscription|createPaymentLink|emit\(/);
});

test("gap finance-os-setup: the names it reads are the names the real setup code writes", () => {
  assert.equal(SETUP_PURPOSE, REAL_PURPOSE);
  assert.equal(SETUP_DESCRIPTION, REAL_DESCRIPTION);
  assert.equal(SETUP_PROVIDER_REF_PREFIX, REAL_REF_PREFIX);
  assert.equal(SETUP_FEE_ENV, REAL_FEE_ENV);
  assert.equal(SETUP_TIER, FINANCE_OS_TIER);
  assert.equal(SETUP_GRACE_MS, INBOX_PROCESSING_WAIT_MS);
});

test("gap finance-os-setup: the price parse says what the real parse says, for every kind of value", () => {
  for (const raw of ["49700", "1", " 700 ", "0", "-5", "12.5", "abc", "", "  ", "1e5", "9007199254740993", null, undefined, "****************2f"]) {
    assert.equal(parseSetupFeeCents(raw), readSetupFeeCents({ [SETUP_FEE_ENV]: raw }), JSON.stringify(raw));
  }
});

describe("gap finance-os-setup: finance-os-setup:price-set", () => {
  const run = async (env) => byId(await gapChecks({ now: NOW, env }), "finance-os-setup:price-set");

  test("a whole number of cents above zero is PASS", async () => {
    const r = await run({ [SETUP_FEE_ENV]: "49700" });
    shape(r);
    assert.equal(r.status, "PASS");
    assert.doesNotMatch(r.detail, /49700/, "the price is not printed");
  });

  test("not set, zero, text and a decimal are each red", async () => {
    for (const v of [undefined, "", "0", "abc", "49.7"]) {
      const r = await run({ [SETUP_FEE_ENV]: v });
      shape(r);
      assert.equal(r.status, "FAIL", JSON.stringify(v));
      assert.match(r.detail, /shows "\$X"/);
      assert.match(r.suggestedFix, /without --secret/);
    }
  });

  test("a mask on this copy of the settings is a skip (it is not the live value), and no env is a skip", async () => {
    const masked = await run({ [SETUP_FEE_ENV]: "****************7e" });
    assert.equal(masked.status, "skip");
    assert.match(masked.detail, /mask/);
    const none = byId(await gapChecks({ now: NOW }), "finance-os-setup:price-set");
    assert.equal(none.status, "skip");
  });
});

describe("gap finance-os-setup: finance-os-setup:paid-turns-on", () => {
  const withCounts = (counts) => tagDb({ "finance-os-setup-paid-turns-on": { paid_n: 0, test_n: 0, n: 0, oldest: null, sample: null, ...counts } });
  const run = (counts) => gapChecks({ db: withCounts(counts), orgId: ORG, now: NOW, env: { [SETUP_FEE_ENV]: "49700" } })
    .then((rows) => byId(rows, "finance-os-setup:paid-turns-on"));

  test("nobody has paid is a PASS that says so; paid and on is a PASS that counts them", async () => {
    const none = await run({});
    shape(none);
    assert.equal(none.status, "PASS");
    assert.match(none.detail, /no real client has paid/);
    const some = await run({ paid_n: 2 });
    assert.match(some.detail, /2 clients paid the FinanceOS setup fee and each has FinanceOS turned on/);
  });

  test("a client who paid and was never turned on is red, with the age and who", async () => {
    const r = await run({ paid_n: 3, n: 1, oldest: ago(2 * DAY), sample: "FH-000777 ($497)" });
    shape(r);
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 client paid the FinanceOS setup fee and FinanceOS was never turned on/);
    assert.match(r.detail, /paid 2 days ago/);
    assert.match(r.detail, /FH-000777/);
  });

  test("no database and no org are skips; a failed read is a skip with the reason", async () => {
    const noDb = byId(await gapChecks({ now: NOW, env: {} }), "finance-os-setup:paid-turns-on");
    assert.equal(noDb.status, "skip");
    const noOrg = byId(await gapChecks({ db: withCounts({}), now: NOW, env: {} }), "finance-os-setup:paid-turns-on");
    assert.match(noOrg.detail, /no org id/);
    const bad = tagDb({ "finance-os-setup-paid-turns-on": new Error("relation \"subscriptions\" does not exist") });
    const r = byId(await gapChecks({ db: bad, orgId: ORG, now: NOW, env: {} }), "finance-os-setup:paid-turns-on");
    assert.equal(r.status, "skip");
    assert.match(r.detail, /does not exist/);
  });
});

/* ---- the SQL, run for real against made-up tables -------------------------------------------- */

const PL_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["purpose", "text"], ["description", "text"],
  ["status", "text"], ["is_demo", "boolean"], ["paid_at", "timestamptz"], ["amount_cents", "bigint"]
];
const SUB_COLS = [
  ["org_id", "uuid"], ["client_id", "uuid"], ["tier", "text"], ["provider_ref", "text"], ["status", "text"],
  ["effective_from", "timestamptz"], ["effective_to", "timestamptz"]
];
const C1 = "cccccccc-0000-4000-8000-000000000001";
const C2 = "cccccccc-0000-4000-8000-000000000002";
const C_TEST = "cccccccc-0000-4000-8000-000000000009";
const L1 = "aaaaaaaa-0000-4000-8000-000000000001";
const clients = [client_(C1), client_(C2), client_(C_TEST, { email: "sim+walk-12@fundhub.ai" })];

const link = (over = {}) => ({
  id: L1, org_id: ORG, client_id: C1, purpose: "custom", description: "Finance OS setup", status: "paid",
  is_demo: false, paid_at: ago(DAY), amount_cents: 49700, ...over
});
const sub = (over = {}) => ({
  org_id: ORG, client_id: C1, tier: "finance-os", provider_ref: `payment_link:${L1}`, status: "active",
  effective_from: ago(DAY), effective_to: null, ...over
});

// want: [paid_n, n, test_n]
const CASES = [
  ["no paid setup link is clean", { links: [], subs: [] }, [0, 0, 0]],
  ["paid, and the plan opened for this very link", { links: [link()], subs: [sub()] }, [1, 0, 0]],
  ["paid, and no plan at all", { links: [link()], subs: [] }, [1, 1, 0]],
  [
    "paid, and the client already holds an active FinanceOS plan from elsewhere (a Capital Blueprint buyer)",
    { links: [link()], subs: [sub({ provider_ref: "blueprint:xyz" })] },
    [1, 0, 0]
  ],
  [
    "paid, and the plan opened for this link has ended since: it WAS turned on",
    { links: [link()], subs: [sub({ status: "cancelled", effective_to: ago(HOUR) })] },
    [1, 0, 0]
  ],
  [
    "paid, and the only plan is an ended one from some other source: never turned on for this payment",
    { links: [link()], subs: [sub({ provider_ref: "other:1", status: "cancelled", effective_to: ago(HOUR) })] },
    [1, 1, 0]
  ],
  ["paid, and the client's plan is a different tier", { links: [link()], subs: [sub({ provider_ref: "x", tier: "starter" })] }, [1, 1, 0]],
  ["paid, and another client's plan does not count", { links: [link()], subs: [sub({ client_id: C2, provider_ref: "x" })] }, [1, 1, 0]],
  ["paid 5 minutes ago is inside the grace", { links: [link({ paid_at: ago(5 * MIN) })], subs: [] }, [0, 0, 0]],
  ["a setup link not paid yet is not read", { links: [link({ status: "created", paid_at: null })], subs: [] }, [0, 0, 0]],
  ["a demo link is not read", { links: [link({ is_demo: true })], subs: [] }, [0, 0, 0]],
  ["a different description is not a setup link", { links: [link({ description: "Capital Blueprint" })], subs: [] }, [0, 0, 0]],
  ["a test client is counted apart", { links: [link({ client_id: C_TEST })], subs: [] }, [0, 0, 1]],
  ["another org's link is not read", { links: [link({ org_id: OTHER_ORG })], subs: [] }, [0, 0, 0]]
];

describe("gap finance-os-setup: the paid-turns-on SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  for (const [name, scenario, want] of CASES) {
    test(name, async () => {
      const sql = withShadows(PAID_TURNS_ON_SQL, [
        shadow("payment_links", PL_COLS, scenario.links),
        shadow("subscriptions", SUB_COLS, scenario.subs),
        shadow("clients", CLIENT_COLS, clients)
      ]);
      const { rows } = await runShadowSql(sql, [ORG, ago(SETUP_GRACE_MS), TEST_CLIENT_EMAIL_RE, NOW.toISOString()]);
      const got = [rows[0].paid_n, rows[0].n, rows[0].test_n].map(Number);
      assert.deepEqual(got, want, name);
    });
  }

  test("the sample names the client and the dollars, so the text can say who", async () => {
    const sql = withShadows(PAID_TURNS_ON_SQL, [
      shadow("payment_links", PL_COLS, [link()]), shadow("subscriptions", SUB_COLS, []), shadow("clients", CLIENT_COLS, clients)
    ]);
    const { rows } = await runShadowSql(sql, [ORG, ago(SETUP_GRACE_MS), TEST_CLIENT_EMAIL_RE, NOW.toISOString()]);
    assert.match(rows[0].sample, /FH-000001 \(\$497\)/);
  });
});
