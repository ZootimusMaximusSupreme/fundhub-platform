// Unit tests for money-chain helpers — no Postgres.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  BUCKET_TO_CODE, paymentKindFor, nothingUnlockedReason, NOTHING_UNLOCKED,
  ensureAttributions, ensureSalePayment, resolveProductId,
  onRoundFundedMoney, syncClientFunded, SQL_SYNC_CLIENT_FUNDED,
  onPaymentReceivedMoney
} from "./money-chain.mjs";
import { OFFERS } from "../config/offers.mjs";

describe("money-chain helpers", () => {
  test("BUCKET_TO_CODE maps Commas semantic buckets to product codes", () => {
    assert.equal(BUCKET_TO_CODE.crs, "diagnostic");
    assert.equal(BUCKET_TO_CODE.deposit, "card-stacking-dfy");
    assert.equal(BUCKET_TO_CODE.diy, "diy-letter-pack");
    assert.equal(BUCKET_TO_CODE.success_fee, "card-stacking-dfy");
    assert.equal(BUCKET_TO_CODE.unmatched, null);
  });

  test("a repair payment resolves to the repair product, not the DIY package", () => {
    // offers.mjs gives REPAIR_DFY and REPAIR_TRIAL paymentPurpose 'repair', and
    // 015_seed_products.sql has exactly one category='repair' product. Before
    // this entry existed the bucket resolved to nothing and the sale landed on
    // consulting-package.
    assert.equal(BUCKET_TO_CODE.repair, "repair-bundle");
  });

  /* STRICTER THAN WHAT IT REPLACED, and deliberately so.
     This test used to assert BUCKET_TO_CODE.diy === "consulting-package" — the
     SAME code src/config/offers.mjs sells the $5,000 Capital Blueprint on. It
     passed while the defect it should have caught was live: two products at two
     prices behind one code, so a payment could not say which had been bought and
     the entitlement lookup, which is keyed on that code, opened the wrong tile.
     Sim Eleven-Blueprint paid $5,000 on production and his Capital Blueprint tile
     stayed locked.

     The old assertion pinned one value. This one pins that value AND the property
     the old one could not express: the DIY bucket and the Blueprint offer must
     never resolve to the same product again. A future edit that re-merges them
     fails here, which the old line would have welcomed. */
  test("the DIY bucket and the Capital Blueprint are different products", () => {
    const blueprint = OFFERS.UWIQ_DELIVERABLES;
    assert.equal(blueprint.name, "Capital Blueprint");
    assert.equal(blueprint.productCode, "consulting-package");
    assert.notEqual(
      BUCKET_TO_CODE.diy, blueprint.productCode,
      "the DIY letter downsell and the $5,000 Capital Blueprint share a product " +
      "code again — a payment can no longer say which one it bought"
    );
    // And no other offer may quietly take the DIY bucket's code either.
    const clash = Object.values(OFFERS).filter((o) => o.productCode === BUCKET_TO_CODE.diy);
    assert.deepEqual(clash, [], "an offer in the catalogue now sells on the DIY bucket's code");
  });

  test("paymentKindFor picks sale_payments.kind from event + bucket", () => {
    assert.equal(paymentKindFor("deposit", "deposit.paid"), "deposit");
    assert.equal(paymentKindFor("crs", "diagnostic.paid"), "deposit");
    assert.equal(paymentKindFor("diy", "sale.closed"), "deposit");
    assert.equal(paymentKindFor("success_fee", "payment.received"), "success_fee");
    assert.equal(paymentKindFor("unmatched", "payment.received"), "installment");
  });
});

describe("money-chain says why nothing unlocked", () => {
  // The rule stays: never grant an entitlement nobody mapped. What changed is
  // that the refusal now names itself, so "he paid and his portal is still
  // locked" has a readable answer instead of a silent return.

  test("no client on the payment is the first reason, before any product lookup", () => {
    assert.equal(nothingUnlockedReason({ clientId: null, product: { code: "diagnostic" } }), "no_client");
    assert.equal(nothingUnlockedReason({}), "no_client");
  });

  test("a payment we cannot pin to a product is its own distinct reason", () => {
    assert.equal(nothingUnlockedReason({ clientId: "c1", product: null }), "no_product");
    assert.equal(nothingUnlockedReason({ clientId: "c1", product: {} }), "no_product");
  });

  test("client plus product means go and read the mapping", () => {
    assert.equal(nothingUnlockedReason({ clientId: "c1", product: { code: "diagnostic" } }), null);
  });

  test("the log line is one greppable prefix", () => {
    // Anyone chasing a locked portal greps for this exact string.
    assert.equal(NOTHING_UNLOCKED, "[money-chain] nothing unlocked");
  });
});

describe("money-chain attribution", () => {
  function attributionDb() {
    const staff = new Map([
      ["closer-1", { id: "closer-1", role: "closer" }],
      ["manager-1", { id: "manager-1", role: "sales_manager" }]
    ]);
    const rows = [];
    return {
      rows,
      query: async (sql, params) => {
        const text = String(sql);
        if (/FROM staff/i.test(text)) {
          const row = staff.get(params[0]);
          return { rows: row ? [row] : [] };
        }
        if (/SELECT 1 FROM sale_attributions/i.test(text)) {
          const [saleId, staffId, role, basis] = params;
          return {
            rows: rows.some((r) =>
              r.sale_id === saleId && r.staff_id === staffId &&
              r.role === role && r.basis === basis
            ) ? [{ "?column?": 1 }] : []
          };
        }
        if (/SUM\(split_percent\)/i.test(text)) {
          const [saleId, basis, role] = params;
          const total = rows
            .filter((r) => r.sale_id === saleId && r.basis === basis && r.role === role)
            .reduce((sum, r) => sum + r.split_percent, 0);
          return { rows: [{ s: total }] };
        }
        if (/INSERT INTO sale_attributions/i.test(text)) {
          const [org_id, sale_id, staff_id, role, basis, split_percent] = params;
          const row = { id: `attr-${rows.length + 1}`, org_id, sale_id, staff_id, role, basis, split_percent };
          rows.push(row);
          return { rows: [{ id: row.id }] };
        }
        throw new Error(`unhandled SQL: ${text.slice(0, 100)}`);
      }
    };
  }

  test("a real closer and manager each receive their own front- and back-end credit", async () => {
    const db = attributionDb();
    const result = await ensureAttributions(db, {
      orgId: "org-1",
      saleId: "sale-1",
      event: {
        payload: { closerId: "closer-1", salesManagerId: "manager-1" }
      }
    });

    assert.equal(result.written, 4);
    assert.deepEqual(
      db.rows.map((r) => `${r.role}:${r.basis}`).sort(),
      [
        "closer:back_end",
        "closer:front_end",
        "sales_manager:back_end",
        "sales_manager:front_end"
      ]
    );
  });

  test("missing actors remain unattributed", async () => {
    const db = attributionDb();
    const result = await ensureAttributions(db, {
      orgId: "org-1",
      saleId: "sale-1",
      event: { payload: {} }
    });
    assert.equal(result.written, 0);
    assert.deepEqual(db.rows, []);
  });
});

describe("ensureSalePayment", () => {
  test("INSERT copies product_id from the sale so deposit.paid can write sale_payments", async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        const text = String(sql);
        calls.push({ sql: text, params });
        if (/FROM transactions/i.test(text)) return { rows: [] };
        if (/INSERT INTO sale_payments/i.test(text)) {
          return { rows: [{ id: "pay-1", product_id: params[3] }] };
        }
        throw new Error(`unhandled SQL: ${text.slice(0, 100)}`);
      }
    };

    const result = await ensureSalePayment(db, {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      orgId: "org-1",
      name: "deposit.paid",
      payload: { amount: 3000 }
    }, {
      saleId: "sale-1",
      productId: "prod-from-sale",
      kind: "deposit"
    });

    assert.equal(result.created, true);
    assert.equal(result.payment?.id, "pay-1");
    const ins = calls.find((c) => /INSERT INTO sale_payments/i.test(c.sql));
    assert.ok(ins, "deposit.paid must INSERT sale_payments when a sale exists");
    assert.match(ins.sql, /product_id/, "INSERT must include product_id (live NOT NULL)");
    assert.equal(ins.params[3], "prod-from-sale");
  });
});

describe("resolveProductId matches product codes, not just display names", () => {
  function productDb(rows) {
    return {
      query: async (sql, params) => {
        const text = String(sql);
        if (/resolve_product_id/i.test(text)) return { rows: [] };
        if (/FROM products WHERE org_id/i.test(text) && /lower\(code\)/i.test(text)) {
          const code = String(params[1] || "").toLowerCase();
          const row = rows.find((r) => r.code === code);
          return { rows: row ? [{ id: row.id }] : [] };
        }
        if (/FROM products WHERE id/i.test(text)) {
          const row = rows.find((r) => r.id === params[0]);
          return { rows: row ? [row] : [] };
        }
        return { rows: [] };
      }
    };
  }

  test("a catalog name miss still finds the product by code", async () => {
    const db = productDb([{ id: "p-repair", code: "repair-bundle" }]);
    const id = await resolveProductId(db, "org-1", {
      productName: "repair-bundle",
      productBucket: "repair"
    });
    assert.equal(id, "p-repair");
  });

  test("a product code used as the sale.closed bucket still resolves", async () => {
    const db = productDb([{ id: "p-course", code: "funding-mastery" }]);
    const id = await resolveProductId(db, "org-1", {
      productName: "Funding Mastery course (A to Z)",
      productBucket: "funding-mastery"
    });
    assert.equal(id, "p-course");
  });
});

/* HOLE 8 — the person row follows the rounds.
   On the 2026-09-17 live walk Sim Eight-Funding had two funded $25,000 rounds
   and clients.funded was still false with no amount, because nothing ever
   wrote it. round.funded now writes it, right after the round itself. */
describe("round.funded writes the person row funded (hole 8)", () => {
  const ORG = "00000000-0000-4000-8000-0000000000a8";
  const CLIENT = "00000000-0000-4000-8000-0000000000c8";
  const ROUND = "00000000-0000-4000-8000-0000000000f8";

  function roundDb(round) {
    const queries = [];
    return {
      queries,
      query: async (sql, params = []) => {
        const text = String(sql);
        queries.push({ text, params });
        if (/SELECT \* FROM funding_rounds WHERE id = \$1/.test(text)) return { rows: [round] };
        if (/UPDATE funding_rounds/.test(text)) {
          return { rows: [{ ...round, status: "funded", funded_amount: String(params[1]) }] };
        }
        if (/UPDATE clients c/.test(text)) {
          return { rows: [{ id: params[0], funded: true, funded_amount: "50000.00" }] };
        }
        return { rows: [] };
      }
    };
  }

  // Not card stacking, so the bank-yes check (which has its own tests) is not
  // what this test is about.
  const altFinRound = () => ({
    id: ROUND, org_id: ORG, client_id: CLIENT, round_number: 2,
    status: "approved", product: "alt_fin", funded_amount: null, approved_amount: null
  });

  test("a funded round marks the client funded, scoped to that client and org", async () => {
    const db = roundDb(altFinRound());
    const out = await onRoundFundedMoney(
      { name: "round.funded", orgId: ORG, clientId: CLIENT, payload: { fundingRoundId: ROUND, fundedAmount: 25000 } },
      db
    );
    assert.equal(out.done, true, JSON.stringify(out));
    const roundAt = db.queries.findIndex((q) => /UPDATE funding_rounds/.test(q.text));
    const clientAt = db.queries.findIndex((q) => /UPDATE clients c/.test(q.text));
    assert.ok(roundAt >= 0, "the round was never written funded");
    assert.ok(clientAt >= 0,
      "the round was written funded and the person row was not — clients.funded stays false, " +
      "which is exactly what the 2026-09-17 live walk found on Sim Eight-Funding");
    assert.ok(clientAt > roundAt, "the person row must be written after the round, from the rounds");
    assert.deepEqual(db.queries[clientAt].params, [CLIENT, ORG]);
  });

  test("a refused round.funded does not touch the person row", async () => {
    const db = roundDb(altFinRound());
    const out = await onRoundFundedMoney(
      { name: "round.funded", orgId: ORG, clientId: CLIENT, payload: { fundingRoundId: ROUND } },
      db
    );
    assert.equal(out.done, false);
    assert.equal(out.reason, "missing_funded_amount");
    assert.ok(!db.queries.some((q) => /UPDATE clients/.test(q.text)),
      "a round that did not fund marked the client funded");
  });

  test("the funded total is the funded rounds, and unknown stays unknown", () => {
    const sql = SQL_SYNC_CLIENT_FUNDED;
    assert.match(sql, /fr\.status = 'funded'/, "only funded rounds may count toward the funded total");
    assert.match(sql, /SUM\(fr\.funded_amount\)/, "the funded total is the sum of the funded rounds");
    assert.match(sql, /bool_and\(fr\.funded_amount IS NOT NULL\)/,
      "a funded round with no amount must leave the total unknown (NULL), not a partial sum");
    assert.doesNotMatch(sql, /COALESCE\([^)]*funded_amount[^)]*,\s*0\)/i, "unknown money must never become 0");
    assert.match(sql, /HAVING count\(\*\) > 0/, "a client with no funded round must not be marked funded");
    assert.doesNotMatch(sql, /funded\s*=\s*false/i, "this never un-funds a client");
  });

  test("with no client or org it does nothing", async () => {
    const db = roundDb(altFinRound());
    assert.equal(await syncClientFunded(db, { clientId: null, orgId: ORG }), null);
    assert.equal(await syncClientFunded(db, { clientId: CLIENT, orgId: null }), null);
    assert.equal(db.queries.length, 0);
  });
});

/* N1 — a success-fee receipt is the sale's BACK END, on its invoice's sale.
   Live 2026-09-18: Sim Eight-Funding paid INV-B4B9C768 ($2,500 success fee)
   through the pay link src/workflows/ar-collections.mjs mints (purpose
   'custom'). The receipt arrived as product 'unmatched', was hung on "the
   newest funding sale" by guess and booked as kind 'installment' — front-end
   money paid against his $3,000 price — while the same receipt also paid the
   invoice. One deposit and one fee read as $5,500 paid against a $3,000 price. */
describe("a success-fee receipt is booked as the invoice's success fee (N1)", () => {
  const ORG = "00000000-0000-4000-8000-0000000000a1";
  const CLIENT = "00000000-0000-4000-8000-0000000000c1";
  const LINK = "00000000-0000-4000-8000-0000000000d1";
  const INVOICE = "00000000-0000-4000-8000-0000000000e1";
  const BILLED_SALE = "00000000-0000-4000-8000-0000000000b1"; // the sale the invoice bills
  const NEWEST_SALE = "00000000-0000-4000-8000-0000000000b2"; // a later funding sale, same client
  const PRODUCT = "00000000-0000-4000-8000-0000000000f1";

  function feeDb({ invoice = { id: INVOICE, sale_id: BILLED_SALE } } = {}) {
    const queries = [];
    const sale = (id) => ({ id, org_id: ORG, client_id: CLIENT, product_id: PRODUCT, sale_motion: null, status: "active" });
    return {
      queries,
      query: async (sql, params = []) => {
        const text = String(sql);
        queries.push({ text, params });
        // The receipt belongs to this fixture's one existing org/client.
        // Model resolveClient's tenant check rather than accepting arbitrary IDs.
        if (/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2 LIMIT 1/.test(text)) {
          return { rows: params[0] === CLIENT && params[1] === ORG ? [{ exists: 1 }] : [] };
        }
        if (/FROM payment_links/.test(text) && /WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/.test(text)) {
          return { rows: [{ id: LINK, product_id: null, sale_id: null, sale_motion: null,
            closer_staff_id: null, sales_manager_staff_id: null }] };
        }
        if (/FROM invoices/.test(text)) {
          const ok = invoice && params[0] === invoice.id && params[1] === ORG && params[2] === CLIENT;
          return { rows: ok ? [invoice] : [] };
        }
        if (/SELECT \* FROM sales WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/.test(text)) {
          return { rows: params[0] === BILLED_SALE ? [sale(BILLED_SALE)] : [] };
        }
        // The old guess: the client's newest active funding sale.
        if (/pr\.category = 'funding'/.test(text)) return { rows: [sale(NEWEST_SALE)] };
        if (/FROM transactions/.test(text)) return { rows: [{ id: "tx-fee" }] };
        if (/INSERT INTO sale_payments/.test(text)) {
          return { rows: [{ id: "sp-fee", sale_id: params[1], transaction_id: params[2],
            product_id: params[3], kind: params[6], amount: params[7] }] };
        }
        return { rows: [], rowCount: 0 };
      }
    };
  }

  const feeReceipt = (payload = {}) => ({
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
    name: "payment.received",
    orgId: ORG,
    clientId: CLIENT,
    payload: {
      product: "unmatched", productName: "Success fee INV-B4B9C768", amount: 2500,
      providerRef: "sim-pay-fee", paymentId: "sim-pay-fee",
      paymentLinkId: LINK, invoiceId: INVOICE, purpose: "custom", ...payload
    }
  });

  const salePaymentInsert = (db) => db.queries.find((q) => /INSERT INTO sale_payments/.test(q.text));

  test("it is kind success_fee on the invoice's own sale, never front-end money on a guessed sale", async () => {
    const db = feeDb();
    const out = await onPaymentReceivedMoney(feeReceipt(), db);
    assert.equal(out.done, true, JSON.stringify(out));
    const ins = salePaymentInsert(db);
    assert.ok(ins, "the success fee was not recorded at all");
    assert.equal(ins.params[6], "success_fee",
      `a success-fee receipt was booked as '${ins.params[6]}' — front-end money that counts against ` +
      "the sale's price, on top of paying the invoice (N1: one deposit and one fee read as $5,500 paid on a $3,000 sale)");
    assert.equal(ins.params[1], BILLED_SALE,
      "the success fee landed on the newest funding sale instead of the sale its invoice bills");
    assert.equal(out.saleId, BILLED_SALE);
  });


  test("a success-fee invoice cannot be redirected to another same-buyer sale", async () => {
    const db = feeDb();
    const out = await onPaymentReceivedMoney(feeReceipt({ saleId: NEWEST_SALE }), db);
    assert.equal(out.done, false);
    assert.equal(out.reason, "success_fee_sale_conflict");
    assert.equal(salePaymentInsert(db), undefined, "conflicted fee must not enter sale_payments");
  });

  test("a success-fee invoice with no original sale is held for reconciliation", async () => {
    const db = feeDb({ invoice: { id: INVOICE, sale_id: null } });
    const out = await onPaymentReceivedMoney(feeReceipt(), db);
    assert.equal(out.done, false);
    assert.equal(out.reason, "unlinked_success_fee_invoice");
    assert.equal(salePaymentInsert(db), undefined);
  });

  test("an invalid payment amount cannot grant access or post commissions", async () => {
    const db = feeDb();
    const out = await onPaymentReceivedMoney(feeReceipt({ amount: -25 }), db);
    assert.equal(out.done, false);
    assert.equal(out.reason, "unrecorded_payment");
    assert.equal(out.entitlements, undefined);
    assert.equal(salePaymentInsert(db), undefined);
  });

  test("an unidentified sale does not pretend to finish checkout or unlock service", async () => {
    const db = feeDb({ invoice: null });
    const query = db.query.bind(db);
    db.query = async (sql, params) => /pr\.category = 'funding'/.test(String(sql))
      ? { rows: [] } : query(sql, params);
    const out = await onPaymentReceivedMoney(
      feeReceipt({ invoiceId: null, paymentLinkId: null, product: "unmatched", productName: null }), db
    );
    assert.equal(out.done, false);
    assert.equal(out.reason, "no_sale_yet");
    assert.equal(out.entitlements, undefined);
    assert.equal(salePaymentInsert(db), undefined);
  });
  test("the invoice is looked up inside this client and org only", async () => {
    const db = feeDb();
    await onPaymentReceivedMoney(feeReceipt(), db);
    const inv = db.queries.find((q) => /FROM invoices/.test(q.text));
    assert.ok(inv, "the receipt's invoice was never read");
    assert.deepEqual(inv.params, [INVOICE, ORG, CLIENT]);
    assert.match(inv.text, /success_fee/, "only a success-fee invoice makes a receipt a success fee");
  });

  test("an invoice id that is not this client's success-fee bill changes nothing", async () => {
    const db = feeDb({ invoice: null });
    await onPaymentReceivedMoney(feeReceipt(), db);
    const ins = salePaymentInsert(db);
    assert.ok(ins);
    assert.equal(ins.params[6], "installment", "an unrecognised invoice id must not re-label money");
  });

  test("a receipt with no invoice never reads invoices and keeps its own kind", async () => {
    const db = feeDb();
    await onPaymentReceivedMoney(feeReceipt({ invoiceId: null }), db);
    assert.ok(!db.queries.some((q) => /FROM invoices/.test(q.text)), "a receipt with no invoice went looking for one");
    const ins = salePaymentInsert(db);
    assert.ok(ins);
    assert.equal(ins.params[6], "installment", "a receipt that names no bill must keep the kind its product gives it");
  });
});
