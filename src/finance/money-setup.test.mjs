// src/finance/money-setup.mjs — the setup status read. Stubbed db, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  readSetupStatus, readSetupFeeCents, setupSteps,
  SETUP_COMMAS_TITLE, SETUP_PURPOSE, SETUP_DESCRIPTION,
  ensureFinanceOsForSetupPayment, isFinanceOsSetupLink
} from "./money-setup.mjs";
import { productOf } from "../adapters/commas.mjs";
import { commasCopyViolation } from "../payments/commas-safe-copy.mjs";

const ORG = "org-1";
const CID = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-10-06T12:00:00Z");

/** A db that answers each read by what its SQL reads from. Records every SQL. */
function stubDb(t = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM clients/.test(sql)) return { rows: t.client === null ? [] : [t.client || { id: CID, first_name: "Ada", last_name: "Lane" }] };
      if (/FROM payment_links/.test(sql)) return { rows: t.links || [] };
      if (/FROM soft_pull_requests/.test(sql)) return { rows: t.pulls || [] };
      if (/FROM crs_results/.test(sql)) return { rows: t.crs || [] };
      if (/FROM entities/.test(sql)) return { rows: [{ n: t.containers ?? 0 }] };
      if (/FROM subscriptions/.test(sql)) return { rows: t.entitled ? [{ id: "sub-1" }] : [] };
      throw new Error("unexpected sql: " + sql);
    }
  };
}

describe("readSetupFeeCents", () => {
  test("unset, blank, junk or zero is null — the page paints $X", () => {
    assert.equal(readSetupFeeCents({}), null);
    assert.equal(readSetupFeeCents({ FINANCE_OS_SETUP_FEE_CENTS: "" }), null);
    assert.equal(readSetupFeeCents({ FINANCE_OS_SETUP_FEE_CENTS: "12.50" }), null);
    assert.equal(readSetupFeeCents({ FINANCE_OS_SETUP_FEE_CENTS: "abc" }), null);
    assert.equal(readSetupFeeCents({ FINANCE_OS_SETUP_FEE_CENTS: "0" }), null);
  });
  test("whole cents come back as an integer", () => {
    assert.equal(readSetupFeeCents({ FINANCE_OS_SETUP_FEE_CENTS: "49700" }), 49700);
    assert.equal(readSetupFeeCents({ FINANCE_OS_SETUP_FEE_CENTS: " 2500 " }), 2500);
  });
});

describe("readSetupStatus", () => {
  test("a brand new client: nothing paid, prices null, step 1 is current", async () => {
    const db = stubDb();
    const s = await readSetupStatus(db, { orgId: ORG, clientId: CID, env: {}, asOf: NOW });
    assert.equal(s.ok, true);
    assert.equal(s.paid, false);
    assert.equal(s.setup_fee_cents, null);
    assert.equal(s.price_per_container_cents, null);
    assert.equal(s.monthly_cents, null);
    assert.equal(s.containers, 0);
    assert.deepEqual(s.soft_pull.requested, false);
    assert.deepEqual(s.soft_pull.completed, false);
    assert.equal(s.soft_pull.last_pulled_at, null);
    assert.equal(s.entitled, false);
    assert.equal(s.open_checkout, null);
    assert.deepEqual(s.steps.map((x) => x.key), ["pay", "soft_pull", "accounts", "live"]);
    assert.ok(s.steps.every((x) => x.done === false));
    assert.equal(s.current_step, "pay");
    assert.equal(s.client.name, "Ada Lane");
  });

  test("every read is scoped to this org and this client", async () => {
    const db = stubDb();
    await readSetupStatus(db, { orgId: ORG, clientId: CID, env: {}, asOf: NOW });
    for (const { sql, params } of db.seen) {
      assert.ok(params.includes(ORG), "unscoped by org: " + sql);
      assert.ok(params.includes(CID), "unscoped by client: " + sql);
    }
    const links = db.seen.find((x) => /FROM payment_links/.test(x.sql));
    assert.deepEqual(links.params.slice(2), [SETUP_PURPOSE, SETUP_DESCRIPTION]);
  });

  test("the client is not in this org → null", async () => {
    const s = await readSetupStatus(stubDb({ client: null }), { orgId: ORG, clientId: CID, env: {}, asOf: NOW });
    assert.equal(s, null);
  });

  test("paid setup, finished pull, two containers, active plan → every step done", async () => {
    const db = stubDb({
      links: [{ id: "pl-1", status: "paid", amount_cents: 49700, paid_at: "2026-10-01T10:00:00Z" }],
      crs: [{ created_at: "2026-10-03T15:00:00Z" }],
      containers: 2,
      entitled: true
    });
    const env = { FINANCE_OS_SETUP_FEE_CENTS: "49700", FINANCE_OS_PRICE_PER_CONTAINER_CENTS: "4900" };
    const s = await readSetupStatus(db, { orgId: ORG, clientId: CID, env, asOf: NOW });
    assert.equal(s.paid, true);
    assert.equal(s.paid_at, "2026-10-01T10:00:00.000Z");
    assert.equal(s.setup_fee_cents, 49700);
    assert.equal(s.price_per_container_cents, 4900);
    assert.equal(s.monthly_cents, 9800);
    assert.equal(s.soft_pull.completed, true);
    assert.equal(s.soft_pull.last_pulled_at, "2026-10-03T15:00:00.000Z");
    assert.equal(s.entitled, true);
    assert.ok(s.steps.every((x) => x.done));
    assert.equal(s.current_step, null);
  });

  test("an open unpaid setup link is handed back; a queued pull is requested, not complete", async () => {
    const db = stubDb({
      links: [{ id: "pl-2", status: "sent", amount_cents: 49700, checkout_url: "https://pay.example/x" }],
      pulls: [{ status: "queued", requested_at: "2026-10-05T10:00:00Z", resolved_at: null }]
    });
    const s = await readSetupStatus(db, { orgId: ORG, clientId: CID, env: {}, asOf: NOW });
    assert.equal(s.paid, false);
    assert.deepEqual(s.open_checkout, { url: "https://pay.example/x", amount_cents: 49700 });
    assert.equal(s.soft_pull.requested, true);
    assert.equal(s.soft_pull.completed, false);
  });
});

describe("setupSteps", () => {
  test("current is the first step not done", () => {
    const r = setupSteps({ paid: true, softPull: { completed: false }, containers: 3, entitled: false });
    assert.equal(r.current, "soft_pull");
  });
});

describe("the Commas title for the setup checkout", () => {
  test("is safe copy and does not route a setup payment into another product's events", () => {
    assert.equal(commasCopyViolation(SETUP_COMMAS_TITLE), null);
    assert.equal(productOf({ name: SETUP_COMMAS_TITLE, purpose: SETUP_PURPOSE }), "unmatched");
  });
});

describe("ensureFinanceOsForSetupPayment", () => {
  const LINK = Object.freeze({
    id: "99999999-8888-7777-6666-555555555555", org_id: ORG, client_id: CID,
    purpose: SETUP_PURPOSE, description: SETUP_DESCRIPTION, status: "paid", paid_at: NOW
  });

  /** byRef: rows the provider_ref lookup returns; entitled: entitlement rows; insert: fn or rows. */
  function subDb({ byRef = [], entitled = [], insert } = {}) {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        if (/FROM subscriptions/.test(sql) && /provider_ref = \$4/.test(sql)) return { rows: typeof byRef === "function" ? byRef() : byRef };
        if (/FROM subscriptions/.test(sql)) return { rows: typeof entitled === "function" ? entitled() : entitled };
        if (/INSERT INTO subscriptions/.test(sql)) {
          if (typeof insert === "function") return insert(params);
          return { rows: [{ id: "sub-new" }] };
        }
        throw new Error("unexpected sql: " + sql);
      }
    };
  }

  test("only the setup link is a setup link", () => {
    assert.equal(isFinanceOsSetupLink(LINK), true);
    assert.equal(isFinanceOsSetupLink({ ...LINK, description: "Business Financial Assessment" }), false);
    assert.equal(isFinanceOsSetupLink({ ...LINK, purpose: "diagnostic" }), false);
    assert.equal(isFinanceOsSetupLink(null), false);
  });

  test("first paid setup → one finance-os row, unpriced, keyed on the link, from the pay date", async () => {
    const db = subDb();
    const out = await ensureFinanceOsForSetupPayment(db, LINK);
    assert.deepEqual(out, { created: true, subscriptionId: "sub-new", reason: null });
    const ins = db.seen.find((x) => /INSERT INTO subscriptions/.test(x.sql));
    assert.equal(ins.params[0], ORG);
    assert.equal(ins.params[1], CID);
    assert.equal(ins.params[2], "finance-os");
    assert.equal(ins.params[4], null);
    assert.equal(ins.params[8], `payment_link:${LINK.id}`);
    assert.equal(new Date(ins.params[11]).toISOString(), NOW.toISOString());
    assert.equal(ins.params[9], null, "no period: nothing to bill");
    assert.equal(ins.params[10], null);
  });

  test("the same link again → already granted, no insert", async () => {
    const db = subDb({ byRef: [{ id: "sub-old" }] });
    const out = await ensureFinanceOsForSetupPayment(db, LINK);
    assert.deepEqual(out, { created: false, subscriptionId: "sub-old", reason: "already_granted" });
    assert.equal(db.seen.some((x) => /INSERT/.test(x.sql)), false);
  });

  test("already on Finance OS (Blueprint 12 months) → no second row", async () => {
    const db = subDb({ entitled: [{ id: "sub-blueprint" }] });
    const out = await ensureFinanceOsForSetupPayment(db, LINK);
    assert.deepEqual(out, { created: false, subscriptionId: "sub-blueprint", reason: "already_entitled" });
    assert.equal(db.seen.some((x) => /INSERT/.test(x.sql)), false);
  });

  test("two replays at once: the loser reads the winner's row", async () => {
    let raced = false;
    const db = subDb({
      byRef: () => (raced ? [{ id: "sub-winner" }] : []),
      insert: () => {
        raced = true;
        const e = new Error("duplicate key");
        e.code = "23505"; e.constraint = "subscriptions_provider_ref_uq";
        throw e;
      }
    });
    const out = await ensureFinanceOsForSetupPayment(db, LINK);
    assert.deepEqual(out, { created: false, subscriptionId: "sub-winner", reason: "already_granted" });
  });

  test("another plan already live for the client → a reason, never a closed plan", async () => {
    const db = subDb({
      insert: () => {
        const e = new Error("overlap"); e.code = "23P01"; e.constraint = "subscriptions_no_overlap";
        throw e;
      }
    });
    const out = await ensureFinanceOsForSetupPayment(db, LINK);
    assert.equal(out.created, false);
    assert.equal(out.subscriptionId, null);
    assert.match(out.reason, /already has a subscription/);
    assert.equal(db.seen.some((x) => /UPDATE subscriptions/.test(x.sql)), false);
  });

  test("not the setup link, or not paid → nothing read, nothing written", async () => {
    const db = subDb();
    assert.equal((await ensureFinanceOsForSetupPayment(db, { ...LINK, description: "x" })).reason, "not_setup_link");
    assert.equal((await ensureFinanceOsForSetupPayment(db, { ...LINK, status: "sent" })).reason, "not_paid");
    assert.equal(db.seen.length, 0);
  });

  test("a real database fault throws, so the bus can dead-letter and replay", async () => {
    const db = subDb({ insert: () => { throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" }); } });
    await assert.rejects(() => ensureFinanceOsForSetupPayment(db, LINK), /connection reset/);
  });

  test("once granted, the Setup read shows step 4 You're live", async () => {
    const db = stubDb({ links: [{ id: LINK.id, status: "paid", amount_cents: 50000, paid_at: NOW, created_at: NOW }], entitled: true });
    const out = await readSetupStatus(db, { orgId: ORG, clientId: CID, env: {}, asOf: NOW });
    const live = out.steps.find((x) => x.key === "live");
    assert.equal(live.label, "You're live");
    assert.equal(live.done, true);
    assert.equal(out.entitled, true);
  });
});

