// src/finance/money-setup.mjs — the setup status read. Stubbed db, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  readSetupStatus, readSetupFeeCents, setupSteps,
  SETUP_COMMAS_TITLE, SETUP_PURPOSE, SETUP_DESCRIPTION
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
