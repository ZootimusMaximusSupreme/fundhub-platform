// Unit tests for src/payment-links/index.mjs against an in-memory fake — no
// Postgres required, matches the pattern in src/subscriptions/store.test-style
// modules and src/adapters/commas.test.mjs.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import {
  createPaymentLink, markSent, markExpired, markPaid,
  getPaymentLink, getByLinkRef, listPaymentLinksForClient, generateLinkRef
} from "./index.mjs";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const CLIENT = "client-1";
const BASE_URL = "https://pay.commas.io/c/onboarding";

/* A tiny in-memory table that understands exactly the statements this module
   issues. Real WHERE semantics (org scoping, status guards) are re-implemented
   here on purpose — a fake that always returns the row you gave it cannot
   catch a query that forgot its own WHERE clause. */
function fakeDb({
  products = [],
  sales = [],
  attributions = [],
  recentActors = [],
  invoices = [],
  singleConnection = false
} = {}) {
  const rows = [];
  const rowLocks = new Map();
  let activeConnections = 0;
  let connectionTail = Promise.resolve();
  let n = 0;
  const store = {
    rows,
    rollbacks: 0,
    async connect() {
      let releaseCheckout = null;
      if (singleConnection) {
        const previous = connectionTail;
        const held = new Promise((resolve) => { releaseCheckout = resolve; });
        connectionTail = previous.then(() => held);
        await previous;
      }
      activeConnections++;
      let inTransaction = false;
      let unlockRow = null;
      const insertedIds = new Set();
      const releaseRow = () => {
        if (unlockRow) unlockRow();
        unlockRow = null;
      };
      return {
        async query(sql, params) {
          if (sql === "BEGIN") {
            inTransaction = true;
            return { rows: [] };
          }
          if (/FROM invoices[\s\S]*FOR UPDATE/.test(sql)) {
            const [id, orgId, clientId] = params;
            const invoice = invoices.find((i) => i.id === id && i.org_id === orgId && i.client_id === clientId);
            if (!invoice) return { rows: [] };
            const previous = rowLocks.get(id) || Promise.resolve();
            const held = new Promise((resolve) => { unlockRow = resolve; });
            rowLocks.set(id, previous.then(() => held));
            await previous;
            return { rows: [{ id }] };
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (sql === "ROLLBACK") {
              store.rollbacks++;
              for (let at = rows.length - 1; at >= 0; at--) {
                if (insertedIds.has(rows[at].id)) rows.splice(at, 1);
              }
            }
            releaseRow();
            inTransaction = false;
            return { rows: [] };
          }
          const out = await store.query(sql, params, true);
          if (inTransaction && /^\s*INSERT INTO payment_links/i.test(sql)) {
            for (const row of out.rows) insertedIds.add(row.id);
          }
          return out;
        },
        release() {
          releaseRow();
          activeConnections--;
          if (releaseCheckout) releaseCheckout();
        }
      };
    },
    query: async (sql, params, viaLockedConnection = false) => {
      if (singleConnection && activeConnections && !viaLockedConnection) {
        throw new Error("test stub: pool max=1 cannot run a separate query while the lock client is checked out");
      }
      const text = String(sql);

      if (/SELECT id, code[\s\S]*FROM products/i.test(text)) {
        const [org_id, product_id, product_code] = params;
        const product = products.find((p) =>
          p.org_id === org_id &&
          ((product_id && p.id === product_id) ||
           (product_code && String(p.code).toLowerCase() === String(product_code).toLowerCase()))
        );
        return { rows: product ? [{ id: product.id, code: product.code }] : [] };
      }

      if (/SELECT s\.id, s\.product_id, s\.sale_motion/i.test(text)) {
        const [sale_id, org_id, client_id] = params;
        const sale = sales.find((s) =>
          s.id === sale_id && s.org_id === org_id && s.client_id === client_id
        );
        if (!sale) return { rows: [] };
        const product = products.find((p) => p.id === sale.product_id);
        return { rows: [{ ...sale, product_code: product?.code || null }] };
      }

      if (/SELECT id, product_id[\s\S]*FROM sales/i.test(text)) {
        const [org_id, client_id, product_id, sale_motion] = params;
        const sale = sales.find((s) =>
          s.org_id === org_id && s.client_id === client_id &&
          s.product_id === product_id && s.status === "active" &&
          (s.sale_motion ?? null) === (sale_motion ?? null)
        );
        return { rows: sale ? [{ id: sale.id, product_id: sale.product_id }] : [] };
      }

      if (/FROM sale_attributions/i.test(text)) {
        const [sale_id] = params;
        return { rows: attributions.filter((a) => a.sale_id === sale_id) };
      }

      if (/FROM call_outcomes co/i.test(text)) {
        return { rows: recentActors };
      }

      if (/SELECT \* FROM payment_links[\s\S]*invoice_id = \$2[\s\S]*provider = 'commas'/i.test(text)) {
        const [org_id, invoice_id] = params;
        const existing = rows.find((r) => r.org_id === org_id && r.invoice_id === invoice_id &&
          r.provider === "commas" && ["created", "sent"].includes(r.status));
        return { rows: existing ? [{ ...existing }] : [] };
      }

      if (/^\s*INSERT INTO payment_links/i.test(text)) {
        const [
          org_id, client_id, purpose, description, amount_cents, currency,
          link_ref, checkout_url, created_by_staff_id, commas_session_id = null,
          product_id = null, sale_id = null, sale_motion = null,
          closer_staff_id = null, sales_manager_staff_id = null,
          invoice_id = null
        ] = params;
        const row = {
          id: `pl-${++n}`, org_id, client_id, purpose, description,
          amount_cents, currency, status: "created",
          link_ref, checkout_url, provider: "commas",
          commas_session_id, paid_amount_cents: null,
          created_by_staff_id, product_id, sale_id, sale_motion,
          closer_staff_id, sales_manager_staff_id, invoice_id,
          created_at: new Date().toISOString(),
          sent_at: null, paid_at: null, expired_at: null
        };
        rows.push(row);
        return { rows: [row] };
      }

      if (/UPDATE payment_links[\s\S]*status = 'sent'/i.test(text)) {
        const [id, org_id, at] = params;
        const row = rows.find((r) => r.id === id && r.org_id === org_id && r.status === "created");
        if (!row) return { rows: [] };
        row.status = "sent"; row.sent_at = at;
        return { rows: [row] };
      }

      if (/UPDATE payment_links[\s\S]*status = 'expired'/i.test(text)) {
        const [id, org_id, at, openStatuses] = params;
        const row = rows.find((r) => r.id === id && r.org_id === org_id && openStatuses.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "expired"; row.expired_at = at;
        return { rows: [row] };
      }

      if (/UPDATE payment_links[\s\S]*status = 'paid'/i.test(text)) {
        const [link_ref, paid_at, commas_session_id, paid_amount_cents, openStatuses, org_id] = params;
        const row = rows.find((r) => r.link_ref === link_ref && r.org_id === org_id && openStatuses.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "paid"; row.paid_at = paid_at;
        row.commas_session_id = commas_session_id; row.paid_amount_cents = paid_amount_cents;
        return { rows: [row] };
      }

      if (/SELECT \* FROM payment_links WHERE id = \$1 AND org_id = \$2/i.test(text)) {
        const [id, org_id] = params;
        return { rows: rows.filter((r) => r.id === id && r.org_id === org_id) };
      }

      if (/SELECT \* FROM payment_links WHERE link_ref/i.test(text)) {
        const [link_ref] = params;
        return { rows: rows.filter((r) => r.link_ref === link_ref) };
      }

      if (/SELECT \* FROM payment_links WHERE org_id = \$1 AND client_id/i.test(text)) {
        const [org_id, client_id] = params;
        return { rows: rows.filter((r) => r.org_id === org_id && r.client_id === client_id) };
      }

      throw new Error(`test stub: no route for SQL: ${text.slice(0, 90)}`);
    }
  };
  return store;
}

/* REAL-MONEY GUARD. createPaymentLink defaults `env` to process.env and
   `fetchImpl` to the global fetch, and it PREFERS the live checkout-session
   API whenever FANBASIS_CHECKOUT_API_KEY is present. A developer who sourced
   .env into their shell would therefore have these tests POST to
   www.fanbasis.com and mint real, payable checkout sessions. Every call below
   goes through `mint`, which names an empty env and a fetch that refuses; the
   one test that wants the mint branch overrides both explicitly. */
const noNetwork = async (url) => {
  throw new Error(`test stub: refused a live request to ${String(url)}`);
};
const mint = (db, args = {}) => createPaymentLink(db, { env: {}, fetchImpl: noNetwork, ...args });

describe("generateLinkRef", () => {
  test("produces a distinct pl_ token each time", () => {
    const a = generateLinkRef(), b = generateLinkRef();
    assert.match(a, /^pl_[0-9a-f]{24}$/);
    assert.notEqual(a, b);
  });
});

describe("createPaymentLink", () => {
  test("mints a checkout URL carrying the amount and the link's own ref", async () => {
    const db = fakeDb();
    const link = await mint(db, {
      orgId: ORG, clientId: CLIENT, purpose: "deposit", amountCents: 250000, checkoutBaseUrl: BASE_URL
    });
    assert.equal(link.status, "created");
    assert.equal(link.amount_cents, 250000);
    const u = new URL(link.checkout_url);
    assert.equal(u.searchParams.get("amount"), "2500.00");
    assert.equal(u.searchParams.get("ref"), link.link_ref);
  });

  test("a custom link with no description is refused before any write", async () => {
    const db = fakeDb();
    await assert.rejects(
      mint(db, { orgId: ORG, clientId: CLIENT, purpose: "custom", amountCents: 500, checkoutBaseUrl: BASE_URL }),
      TypeError
    );
    assert.equal(db.rows.length, 0);
  });

  test("purpose invoice is accepted and stored as custom", async () => {
    const db = fakeDb();
    const link = await mint(db, {
      orgId: ORG, clientId: CLIENT, purpose: "invoice", amountCents: 10000, checkoutBaseUrl: BASE_URL
    });
    assert.equal(link.purpose, "custom");
    assert.equal(link.description, "Invoice");
  });

  test("an unknown purpose is refused", async () => {
    const db = fakeDb();
    await assert.rejects(
      mint(db, { orgId: ORG, clientId: CLIENT, purpose: "yacht", amountCents: 500, checkoutBaseUrl: BASE_URL }),
      TypeError
    );
  });

  test("a zero or negative amount is refused, not billed as free", async () => {
    const db = fakeDb();
    await assert.rejects(
      mint(db, { orgId: ORG, clientId: CLIENT, purpose: "repair", amountCents: 0, checkoutBaseUrl: BASE_URL }),
      RangeError
    );
    await assert.rejects(
      mint(db, { orgId: ORG, clientId: CLIENT, purpose: "repair", amountCents: -100, checkoutBaseUrl: BASE_URL }),
      RangeError
    );
  });

  test("no checkout config means no link — nothing invented", async () => {
    const db = fakeDb();
    await assert.rejects(
      mint(db, {
        orgId: ORG, clientId: CLIENT, purpose: "deposit", amountCents: 500,
        env: {}
      }),
      (err) => err && err.code === "commas_not_configured" && err.status === 503
    );
    assert.equal(db.rows.length, 0);
  });

  test("FANBASIS_CHECKOUT_API_KEY mints via checkout-session API", async () => {
    const db = fakeDb();
    let sentBody = null;
    const fetchImpl = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      assert.equal(sentBody.amount_cents, 100);
      assert.equal(sentBody.product.title, "Consulting Services Assessment");
      assert.equal(opts.headers["x-api-key"], "fb-key");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { id: "N1test", payment_link: "https://www.fanbasis.com/agency-checkout/x/N1test" }
        })
      };
    };
    const link = await mint(db, {
      orgId: ORG, clientId: CLIENT, purpose: "diagnostic",
      description: "Business Financial Assessment — Fundhub",
      amountCents: 100,
      env: { FANBASIS_CHECKOUT_API_KEY: "fb-key" },
      fetchImpl
    });
    assert.equal(link.checkout_url, "https://www.fanbasis.com/agency-checkout/x/N1test");
    assert.equal(link.commas_session_id, "N1test");
    assert.equal(link.amount_cents, 100);
    assert.equal(link.description, "Business Financial Assessment — Fundhub");
    assert.equal(sentBody.product.title, "Consulting Services Assessment");
  });

  test("invoice id is stored on the link and sent in checkout metadata", async () => {
    const INVOICE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const ROUND = "11111111-2222-3333-4444-555555555555";
    const db = fakeDb({ invoices: [{ id: INVOICE, org_id: ORG, client_id: CLIENT }] });
    let sentMeta = null;
    const fetchImpl = async (_url, opts) => {
      sentMeta = JSON.parse(opts.body).metadata;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { id: "invpay", payment_link: "https://www.fanbasis.com/agency-checkout/x/invpay" }
        })
      };
    };
    const link = await mint(db, {
      orgId: ORG, clientId: CLIENT, purpose: "custom",
      description: "Success fee INV-TEST",
      amountCents: 100000,
      invoiceId: INVOICE,
      fundingRoundId: ROUND,
      env: { FANBASIS_CHECKOUT_API_KEY: "fb-key" },
      fetchImpl
    });
    assert.equal(link.invoice_id, INVOICE);
    assert.equal(sentMeta.invoice_id, INVOICE);
    assert.equal(sentMeta.funding_round_id, ROUND);
  });

  for (const singleConnection of [false, true]) test(`concurrent invoice mints create one hosted Commas session and one saved link (pool max ${singleConnection ? 1 : 2})`, async () => {
    const invoiceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const db = fakeDb({ invoices: [{ id: invoiceId, org_id: ORG, client_id: CLIENT }], singleConnection });
    let posts = 0;
    let firstEntered;
    const entered = new Promise((resolve) => { firstEntered = resolve; });
    let releaseFirst;
    const held = new Promise((resolve) => { releaseFirst = resolve; });
    const fetchImpl = async (_url, opts) => {
      posts++;
      assert.ok(opts.signal, "invoice provider call must be bounded");
      firstEntered();
      await held;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { id: "once", payment_link: "https://www.fanbasis.com/agency-checkout/x/once" }
        })
      };
    };
    const args = {
      orgId: ORG, clientId: CLIENT, purpose: "invoice", amountCents: 10000,
      invoiceId, env: { FANBASIS_CHECKOUT_API_KEY: "test-only" }, fetchImpl
    };
    const first = mint(db, args);
    await entered;
    const second = mint(db, args);
    await Promise.resolve();
    assert.equal(posts, 1, "second request must wait for the saved-link recheck");
    releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(posts, 1);
    assert.equal(db.rows.length, 1);
    assert.equal(a.id, b.id);
    assert.equal(a.checkout_url, b.checkout_url);
  });

  test("provider failure rolls back and releases the invoice lock for a later attempt", async () => {
    const invoiceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const db = fakeDb({ invoices: [{ id: invoiceId, org_id: ORG, client_id: CLIENT }], singleConnection: true });
    let posts = 0;
    const fetchImpl = async () => {
      posts++;
      return posts === 1
        ? { ok: false, status: 503, text: async () => JSON.stringify({ message: "upstream unavailable" }) }
        : { ok: true, status: 200, text: async () => JSON.stringify({
          data: { id: "retry", payment_link: "https://www.fanbasis.com/agency-checkout/x/retry" }
        }) };
    };
    const args = {
      orgId: ORG, clientId: CLIENT, purpose: "invoice", amountCents: 10000,
      invoiceId, env: { FANBASIS_CHECKOUT_API_KEY: "test-only" }, fetchImpl
    };
    await assert.rejects(mint(db, args), /upstream unavailable/);
    assert.equal(db.rollbacks, 1);
    assert.equal(db.rows.length, 0);
    const retry = await mint(db, args);
    assert.equal(retry.commas_session_id, "retry");
    assert.equal(posts, 2);
    assert.equal(db.rows.length, 1);
  });

  test("invoice mint refuses an open link with a different owner, balance, or currency", async () => {
    const invoiceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const db = fakeDb({ invoices: [{ id: invoiceId, org_id: ORG, client_id: CLIENT }] });
    let posts = 0;
    const fetchImpl = async () => {
      posts++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: { id: "first", payment_link: "https://www.fanbasis.com/agency-checkout/x/first" }
        })
      };
    };
    const args = {
      orgId: ORG, clientId: CLIENT, purpose: "invoice", amountCents: 10000,
      invoiceId, env: { FANBASIS_CHECKOUT_API_KEY: "test-only" }, fetchImpl
    };
    await mint(db, args);
    for (const change of [
      { clientId: "another-client" }, { amountCents: 9000 }, { currency: "EUR" }
    ]) {
      await assert.rejects(mint(db, { ...args, ...change }), /not owned|mismatched owner, balance, or currency/);
    }
    assert.equal(posts, 1, "no wrong-amount provider session may be minted");
    assert.equal(db.rows.length, 1);
  });

  test("stores a staff-declared motion and product with the creating closer", async () => {
    const product = { id: "product-1", org_id: ORG, code: "repair-bundle" };
    const db = fakeDb({ products: [product] });
    const link = await mint(db, {
      orgId: ORG,
      clientId: CLIENT,
      purpose: "repair",
      description: "Repair",
      amountCents: 100000,
      productCode: product.code,
      saleMotion: "downsell",
      createdByStaffId: "closer-1",
      createdByRole: "closer",
      checkoutBaseUrl: BASE_URL
    });

    assert.equal(link.product_id, product.id);
    assert.equal(link.sale_motion, "downsell");
    assert.equal(link.closer_staff_id, "closer-1");
    assert.equal(link.sales_manager_staff_id, null);
  });

  test("copies real closer and manager attribution from the exact sale", async () => {
    const product = { id: "product-1", org_id: ORG, code: "repair-bundle" };
    const sale = {
      id: "sale-1", org_id: ORG, client_id: CLIENT, product_id: product.id,
      sale_motion: "upsell", status: "active"
    };
    const db = fakeDb({
      products: [product],
      sales: [sale],
      attributions: [
        { sale_id: sale.id, staff_id: "closer-1", role: "closer" },
        { sale_id: sale.id, staff_id: "manager-1", role: "sales_manager" }
      ]
    });
    const link = await mint(db, {
      orgId: ORG,
      clientId: CLIENT,
      purpose: "repair",
      description: "Repair",
      amountCents: 100000,
      saleId: sale.id,
      saleMotion: "upsell",
      checkoutBaseUrl: BASE_URL
    });

    assert.equal(link.sale_id, sale.id);
    assert.equal(link.product_id, product.id);
    assert.equal(link.sale_motion, "upsell");
    assert.equal(link.closer_staff_id, "closer-1");
    assert.equal(link.sales_manager_staff_id, "manager-1");
  });

  test("refuses motion without product identity or with a conflicting sale", async () => {
    const db = fakeDb();
    await assert.rejects(
      mint(db, {
        orgId: ORG, clientId: CLIENT, purpose: "custom", description: "Package",
        amountCents: 100000, saleMotion: "downsell", checkoutBaseUrl: BASE_URL
      }),
      /require product identity/
    );

    const product = { id: "product-1", org_id: ORG, code: "repair-bundle" };
    const sale = {
      id: "sale-1", org_id: ORG, client_id: CLIENT, product_id: product.id,
      sale_motion: "downsell", status: "active"
    };
    const saleDb = fakeDb({ products: [product], sales: [sale] });
    await assert.rejects(
      mint(saleDb, {
        orgId: ORG, clientId: CLIENT, purpose: "repair", description: "Repair",
        amountCents: 100000, saleId: sale.id, saleMotion: "upsell",
        checkoutBaseUrl: BASE_URL
      }),
      /sale and sale motion do not match/
    );
  });
});

describe("status transitions", () => {
  let db, link;
  beforeEach(async () => {
    db = fakeDb();
    link = await mint(db, {
      orgId: ORG, clientId: CLIENT, purpose: "diagnostic", amountCents: 3200, checkoutBaseUrl: BASE_URL
    });
  });

  test("created -> sent", async () => {
    const sent = await markSent(db, { id: link.id, orgId: ORG });
    assert.equal(sent.status, "sent");
    assert.ok(sent.sent_at);
  });

  test("sending twice is a no-op the second time, not an error", async () => {
    await markSent(db, { id: link.id, orgId: ORG });
    const again = await markSent(db, { id: link.id, orgId: ORG });
    assert.equal(again, null, "a link already sent has nothing to transition into 'sent' from");
  });

  test("another org cannot mark this link sent", async () => {
    const result = await markSent(db, { id: link.id, orgId: OTHER_ORG });
    assert.equal(result, null);
  });

  test("created -> expired, and sent -> expired", async () => {
    const expired = await markExpired(db, { id: link.id, orgId: ORG });
    assert.equal(expired.status, "expired");
    assert.ok(expired.expired_at);

    const link2 = await mint(db, { orgId: ORG, clientId: CLIENT, purpose: "repair", amountCents: 100, checkoutBaseUrl: BASE_URL });
    await markSent(db, { id: link2.id, orgId: ORG });
    const expired2 = await markExpired(db, { id: link2.id, orgId: ORG });
    assert.equal(expired2.status, "expired");
  });

  test("a paid link cannot be expired", async () => {
    await markPaid(db, { orgId: ORG, linkRef: link.link_ref, commasSessionId: "txn_1", paidAmountCents: 3200 });
    const result = await markExpired(db, { id: link.id, orgId: ORG });
    assert.equal(result, null, "an already-paid link was reported expired");
  });

  test("created -> paid via the link's own ref, recording the processor session id", async () => {
    const paid = await markPaid(db, { orgId: ORG, linkRef: link.link_ref, commasSessionId: "txn_abc", paidAmountCents: 3200 });
    assert.equal(paid.status, "paid");
    assert.equal(paid.commas_session_id, "txn_abc");
    assert.equal(paid.paid_amount_cents, 3200);
    assert.ok(paid.paid_at);
  });

  test("sent -> paid also works — paid is not conditioned on having been sent", async () => {
    await markSent(db, { id: link.id, orgId: ORG });
    const paid = await markPaid(db, { orgId: ORG, linkRef: link.link_ref, commasSessionId: "txn_abc", paidAmountCents: 3200 });
    assert.equal(paid.status, "paid");
  });

  test("a replayed webhook settling an already-paid link is a safe no-op", async () => {
    await markPaid(db, { orgId: ORG, linkRef: link.link_ref, commasSessionId: "txn_abc", paidAmountCents: 3200 });
    const again = await markPaid(db, { orgId: ORG, linkRef: link.link_ref, commasSessionId: "txn_abc", paidAmountCents: 3200 });
    assert.equal(again, null, "a second settlement on an already-paid link must not report success");
  });

  test("a client who paid a DIFFERENT amount than asked records both figures honestly", async () => {
    const paid = await markPaid(db, { orgId: ORG, linkRef: link.link_ref, commasSessionId: "txn_x", paidAmountCents: 5000 });
    assert.equal(paid.amount_cents, 3200, "the requested amount was overwritten");
    assert.equal(paid.paid_amount_cents, 5000);
  });

  test("an unknown ref settles nothing", async () => {
    const result = await markPaid(db, { orgId: ORG, linkRef: "pl_does_not_exist", commasSessionId: "txn_1" });
    assert.equal(result, null);
  });
});

describe("reads", () => {
  test("getPaymentLink scopes to org — another org gets nothing", async () => {
    const db = fakeDb();
    const link = await mint(db, { orgId: ORG, clientId: CLIENT, purpose: "deposit", amountCents: 100, checkoutBaseUrl: BASE_URL });
    assert.equal((await getPaymentLink(db, { id: link.id, orgId: ORG })).id, link.id);
    assert.equal(await getPaymentLink(db, { id: link.id, orgId: OTHER_ORG }), null);
  });

  test("getByLinkRef finds a row with no org context — the webhook has none", async () => {
    const db = fakeDb();
    const link = await mint(db, { orgId: ORG, clientId: CLIENT, purpose: "deposit", amountCents: 100, checkoutBaseUrl: BASE_URL });
    assert.equal((await getByLinkRef(db, { linkRef: link.link_ref })).id, link.id);
  });

  test("listPaymentLinksForClient never crosses org or client boundaries", async () => {
    const db = fakeDb();
    const mine = await mint(db, { orgId: ORG, clientId: CLIENT, purpose: "deposit", amountCents: 100, checkoutBaseUrl: BASE_URL });
    await mint(db, { orgId: OTHER_ORG, clientId: CLIENT, purpose: "deposit", amountCents: 100, checkoutBaseUrl: BASE_URL });
    await mint(db, { orgId: ORG, clientId: "another-client", purpose: "deposit", amountCents: 100, checkoutBaseUrl: BASE_URL });
    const list = await listPaymentLinksForClient(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, mine.id);
  });
});
  
test("A77: only the owning tenant can mark a checkout paid", async () => {
  const db = fakeDb();
  const link = await mint(db, {
    orgId: ORG, clientId: CLIENT, purpose: "diagnostic",
    amountCents: 3200, checkoutBaseUrl: BASE_URL
  });
  const foreign = await markPaid(db, {
    orgId: OTHER_ORG, linkRef: link.link_ref, paidAmountCents: 3200
  });
  assert.equal(foreign, null);
  assert.equal(link.status, "created");
  await assert.rejects(
    markPaid(db, { linkRef: link.link_ref, paidAmountCents: 3200 }),
    /orgId is required/
  );
  const owner = await markPaid(db, {
    orgId: ORG, linkRef: link.link_ref, paidAmountCents: 3200
  });
  assert.equal(owner.status, "paid");
});
