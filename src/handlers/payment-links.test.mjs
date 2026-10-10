// Unit tests for src/handlers/payment-links.mjs — the payment.received
// reaction that settles a payment_links row via link_ref or Commas session id.
import { test, describe } from "node:test";
import assert from "node:assert";
import { onPaymentReceivedForLink } from "./payment-links.mjs";

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const text = String(sql);
      if (/^\s*SELECT \* FROM payment_links WHERE link_ref = \$1/i.test(text)) {
        return { rows: rows.filter((r) => r.link_ref === params[0]) };
      }
      if (/link_ref = \$1/i.test(text)) {
        const [link_ref, , commas_session_id, paid_amount_cents, openStatuses] = params;
        const row = rows.find((r) => r.link_ref === link_ref && openStatuses.includes(r.status));
        if (!row) return { rows: [] };
        // The live unique index payment_links_commas_session (119), so a
        // fake cannot pass a write the real table refuses.
        const next = commas_session_id ?? row.commas_session_id;
        if (next != null && rows.some((r) => r !== row && r.commas_session_id === next)) {
          throw new Error('duplicate key value violates unique constraint "payment_links_commas_session"');
        }
        row.status = "paid";
        row.commas_session_id = commas_session_id ?? row.commas_session_id;
        row.paid_amount_cents = paid_amount_cents;
        return { rows: [row] };
      }
      if (/commas_session_id = \$1/i.test(text)) {
        const [session_id, , paid_amount_cents, openStatuses] = params;
        const row = rows.find((r) => r.commas_session_id === session_id && openStatuses.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "paid";
        row.paid_amount_cents = paid_amount_cents;
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

describe("onPaymentReceivedForLink", () => {
  test("no ref and no itemId: does nothing", async () => {
    const db = fakeDb([]);
    await onPaymentReceivedForLink({ payload: { amount: 50, providerRef: "txn_1" } }, db);
    assert.equal(db.calls.length, 0);
  });

  test("a matching ref settles the link with the processor's own session id, amount converted to cents", async () => {
    const rows = [{ link_ref: "pl_1", status: "created" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_1", amount: 32, providerRef: "txn_abc" } }, db);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].commas_session_id, "txn_abc");
    assert.equal(rows[0].paid_amount_cents, 3200);
  });

  test("itemId settles when link_ref is missing", async () => {
    const rows = [{ link_ref: "pl_wrong", commas_session_id: "8YZPo", status: "sent" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { amount: 1, itemId: "8YZPo" } }, db);
    assert.equal(rows[0].status, "paid");
    assert.equal(rows[0].paid_amount_cents, 100);
  });

  test("no amount on the event records an unknown paid amount, not zero", async () => {
    const rows = [{ link_ref: "pl_1", status: "sent" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_1", providerRef: "txn_abc" } }, db);
    assert.equal(rows[0].paid_amount_cents, null);
  });

  /* N2 (live 2026-09-18): the inbox copies OUR products.id onto the event as
     productId. The handler wrote it into commas_session_id, so the first
     deposit ever paid kept the deposit product's id, and every later deposit
     hit the unique index and stayed unpaid. These two rows are the live shape. */
  test("a second payment on the same product settles its own link — our product id is never stored as the Commas id", async () => {
    const PRODUCT = "c087bdd2-0314-46b7-88f6-dc5c54b46a63";
    const rows = [
      { link_ref: "pl_first", status: "paid", commas_session_id: PRODUCT },
      { link_ref: "pl_second", status: "sent", commas_session_id: "nPGj5" }
    ];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink(
      { payload: { ref: "pl_second", amount: 3000, productId: PRODUCT, providerRef: "sim-pay-1" } }, db);
    assert.equal(rows[1].status, "paid");
    assert.equal(rows[1].paid_amount_cents, 300000);
    assert.equal(rows[1].commas_session_id, "sim-pay-1");
    assert.equal(rows[0].commas_session_id, PRODUCT);
  });

  test("our product id alone (no ref, no itemId) settles nothing — it is not a Commas id", async () => {
    const PRODUCT = "0e4087cf-4a2f-4af4-b1a9-ce2f6319bdaa";
    const rows = [{ link_ref: "pl_other", status: "sent", commas_session_id: PRODUCT }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { amount: 1000, productId: PRODUCT, providerRef: "txn_9" } }, db);
    assert.equal(rows[0].status, "sent");
    assert.equal(db.calls.length, 0);
  });

  test("a ref matching nothing is a safe no-op when no itemId", async () => {
    const rows = [{ link_ref: "pl_other", status: "created" }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink({ payload: { ref: "pl_missing", amount: 10 } }, db);
    assert.equal(rows[0].status, "created");
  });

  test("a paid $297 SLO link opens the portal login for that client", async () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rows = [{
      link_ref: "slo_abcdef0123456789abcdef",
      status: "sent",
      org_id: ORG,
      client_id: CLIENT
    }];
    const accounts = [];
    const db = {
      calls: [],
      query: async (sql, params) => {
        db.calls.push({ sql: String(sql), params });
        const text = String(sql);
        if (/link_ref = \$1/i.test(text)) {
          const [link_ref, , commas_session_id, paid_amount_cents, openStatuses] = params;
          const row = rows.find((r) => r.link_ref === link_ref && openStatuses.includes(r.status));
          if (!row) return { rows: [] };
          row.status = "paid";
          row.commas_session_id = commas_session_id ?? row.commas_session_id;
          row.paid_amount_cents = paid_amount_cents;
          return { rows: [row] };
        }
        if (/SELECT email, first_name, last_name/.test(text)) {
          return { rows: [{ email: "slo.buyer@example.com", first_name: "Sam", last_name: "Buyer" }] };
        }
        if (/FROM accounts/.test(text) && /kind = 'client'/.test(text)) {
          return { rows: accounts };
        }
        if (/INSERT INTO accounts/.test(text)) {
          const row = { id: "acct-1", org_id: params[0], email: params[1], name: params[2], client_id: params[3] };
          accounts.push(row);
          return { rows: [row] };
        }
        return { rows: [] };
      }
    };
    await onPaymentReceivedForLink(
      { payload: { ref: "slo_abcdef0123456789abcdef", amount: 297, providerRef: "txn_slo" } },
      db
    );
    assert.equal(rows[0].status, "paid");
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].email, "slo.buyer@example.com");
    assert.equal(accounts[0].client_id, CLIENT);
  });

  test("a paid soft-pull pl_ link does not invent an SLO portal write", async () => {
    const rows = [{
      link_ref: "pl_softpull1",
      status: "sent",
      org_id: "11111111-1111-4111-8111-111111111111",
      client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }];
    const db = fakeDb(rows);
    await onPaymentReceivedForLink(
      { payload: { ref: "pl_softpull1", amount: 32, providerRef: "txn_32" } },
      db
    );
    assert.equal(rows[0].status, "paid");
    assert.equal(
      db.calls.filter((c) => /INSERT INTO accounts/.test(c.sql)).length,
      0,
      "$32 soft-pull stays off the SLO portal path"
    );
  });

  /* Finance OS setup (wave 3 G1): the setup link paid → one finance-os
     subscription, once. Any other link never touches subscriptions. */
  const ORG = "11111111-1111-4111-8111-111111111111";
  const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const LINK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function setupDb(links) {
    const subs = [];
    const base = fakeDb(links);
    const db = {
      subs,
      calls: base.calls,
      query: async (sql, params) => {
        const text = String(sql);
        if (/FROM subscriptions/.test(text) && /provider_ref = \$4/.test(text)) {
          base.calls.push({ sql: text, params });
          return { rows: subs.filter((r) => r.provider_ref === params[3] && r.tier === params[2]) };
        }
        if (/FROM subscriptions/.test(text)) {
          base.calls.push({ sql: text, params });
          return { rows: subs.filter((r) => r.client_id === params[1] && r.tier === params[2]) };
        }
        if (/INSERT INTO subscriptions/.test(text)) {
          base.calls.push({ sql: text, params });
          const row = { id: `sub-${subs.length + 1}`, org_id: params[0], client_id: params[1], tier: params[2], price_cents: params[4], provider_ref: params[8], effective_from: params[11] };
          subs.push(row);
          return { rows: [row] };
        }
        return base.query(sql, params);
      }
    };
    return db;
  }

  function setupLink(extra = {}) {
    return {
      id: LINK_ID, link_ref: "pl_setup1", status: "sent", org_id: ORG, client_id: CLIENT,
      purpose: "custom", description: "Finance OS setup", paid_at: null, ...extra
    };
  }

  test("a paid Finance OS setup link turns Finance OS on for that client", async () => {
    const links = [setupLink()];
    const db = setupDb(links);
    await onPaymentReceivedForLink({ payload: { ref: "pl_setup1", amount: 500, providerRef: "txn_s" } }, db);
    assert.equal(links[0].status, "paid");
    assert.equal(db.subs.length, 1);
    assert.equal(db.subs[0].tier, "finance-os");
    assert.equal(db.subs[0].client_id, CLIENT);
    assert.equal(db.subs[0].provider_ref, `payment_link:${LINK_ID}`);
    assert.equal(db.subs[0].price_cents, null, "not priced is null, never 0");
  });

  test("a replayed setup payment does not open a second subscription", async () => {
    const links = [setupLink()];
    const db = setupDb(links);
    const evt = { payload: { ref: "pl_setup1", amount: 500, providerRef: "txn_s" } };
    await onPaymentReceivedForLink(evt, db);
    await onPaymentReceivedForLink(evt, db);
    await onPaymentReceivedForLink(evt, db);
    assert.equal(db.subs.length, 1);
  });

  test("a replay heals a setup link that was marked paid but never granted", async () => {
    const links = [setupLink({ status: "paid", paid_at: new Date("2026-10-06T12:00:00Z") })];
    const db = setupDb(links);
    await onPaymentReceivedForLink({ payload: { ref: "pl_setup1", amount: 500 } }, db);
    assert.equal(db.subs.length, 1);
  });

  test("a paid link that is not the setup link never touches subscriptions", async () => {
    const links = [
      setupLink({ link_ref: "pl_soft", description: "Business Financial Assessment", purpose: "diagnostic" }),
      setupLink({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", link_ref: "pl_custom", description: "Something else" })
    ];
    const db = setupDb(links);
    await onPaymentReceivedForLink({ payload: { ref: "pl_soft", amount: 32 } }, db);
    await onPaymentReceivedForLink({ payload: { ref: "pl_custom", amount: 10 } }, db);
    assert.equal(links[0].status, "paid");
    assert.equal(links[1].status, "paid");
    assert.equal(db.subs.length, 0);
    assert.equal(db.calls.filter((c) => /subscriptions/.test(c.sql)).length, 0);
  });
});
