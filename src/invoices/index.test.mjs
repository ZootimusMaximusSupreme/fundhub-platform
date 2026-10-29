import { test } from "node:test";
import assert from "node:assert";
import {
  createInvoice, markSent, markPaid, voidInvoice, getInvoice, markEscalated,
  successFeeKey, depositKey, invoiceDisplayNumber, formatBalanceDue
} from "./index.mjs";

// ---------------------------------------------------------------------------
// Minimal in-memory db stub — mirrors the pg pool.query interface.
//
// THIS STUB IS WHY THE 031 BREAKAGE WENT UNNOTICED. It used to model the
// pre-031 column names (amount / provider_ref / issued_at) and the pre-031
// status list, so it kept answering happily long after the real table had moved
// underneath it. Every function in this file was green while every one of them
// raised SQLSTATE 42703 against Postgres.
//
// It now models the columns that actually exist. That is still a fake and still
// cannot prove the SQL is valid — src/invoices/invoices.pg.test.mjs does that
// against a real database, and it is the file to trust when the two disagree.
// ---------------------------------------------------------------------------
const PAYABLE_STATUSES = ["sent", "reminded", "escalated", "partially_paid"];
const VOIDABLE_STATUSES = ["draft", ...PAYABLE_STATUSES];

function makeDb(rows = []) {
  const store = [...rows];
  return {
    _store: store,
    async query(sql, params = []) {
      const s = sql.trim().toUpperCase();

      if (s.startsWith("INSERT INTO INVOICES")) {
        // Bare ON CONFLICT DO NOTHING: absorbs a collision on EITHER
        // idempotency_key or source_event_id, matching 031's two dimensions.
        const idempotencyKey = params[12] ?? null;
        const sourceEventId = params[4] ?? null;
        const clash = store.find((r) =>
          r.org_id === params[0] &&
          ((idempotencyKey && r.idempotency_key === idempotencyKey) ||
           (sourceEventId && r.source_event_id === sourceEventId)));
        if (clash) return { rows: [] };

        // 031's trg_invoices_sync_legacy_type keeps source and invoice_type in
        // step in both directions; the fake has to do it too or the fake is
        // lying again.
        const toSource = (t) => (t === "success_fee" ? "funding_success_fee" : "other");
        const toType = (src) => ({
          funding_success_fee: "success_fee", diy_letters: "deposit",
          repair_bundle: "deposit", backend_selling: "platform_fee"
        }[src] || "platform_fee");
        let invoiceType = params[2] ?? null;
        let source = params[3] ?? null;
        if (!source && invoiceType) source = toSource(invoiceType);
        if (source) invoiceType = toType(source);

        const row = {
          id: `inv-${store.length + 1}`,
          org_id: params[0],
          client_id: params[1],
          invoice_type: invoiceType,
          source,
          source_event_id: params[4],
          amount_due: params[5],
          currency: params[6],
          sale_id: params[7],
          funding_round_id: params[8],
          due_at: params[9],
          provider: params[10],
          external_ref: params[11],
          idempotency_key: params[12],
          notes: params[13],
          status: "draft",
          sent_at: null, paid_at: null, voided_at: null,
        };
        store.push(row);
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'SENT'")) {
        const id = params[0];
        const row = store.find(r => r.id === id && r.status === "draft");
        if (!row) return { rows: [] };
        row.status = "sent"; row.sent_at = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'ESCALATED'")) {
        const id = params[0];
        const allowed = Array.isArray(params[2]) ? params[2] : ["sent", "reminded"];
        const row = store.find(r => r.id === id && allowed.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "escalated"; row.escalated_at = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'PAID'")) {
        const id = params[0];
        // 031 retired 'overdue' and added 'reminded'/'escalated'.
        const allowed = Array.isArray(params[2]) ? params[2] : PAYABLE_STATUSES;
        const row = store.find(r => r.id === id && allowed.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "paid"; row.paid_at = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("UPDATE INVOICES") && s.includes("STATUS = 'VOID'")) {
        const id = params[0];
        const row = store.find(r => r.id === id && VOIDABLE_STATUSES.includes(r.status));
        if (!row) return { rows: [] };
        row.status = "void"; row.voided_at = new Date().toISOString();
        if (params[1]) row.notes = params[1];
        return { rows: [row] };
      }

      if (s.startsWith("SELECT * FROM INVOICES WHERE ID")) {
        const row = store.find(r => r.id === params[0]);
        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    }
  };
}

const ORG = "org-fundhub";
const CLIENT = "client-001";
const SALE = "sale-001";
const ROUND = "round-001";

// ---------------------------------------------------------------------------
// createInvoice
// ---------------------------------------------------------------------------
test("createInvoice returns the new row", async () => {
  const db = makeDb();
  const row = await createInvoice(db, {
    orgId: ORG, clientId: CLIENT,
    invoiceType: "success_fee", amount: 5000,
    saleId: SALE, fundingRoundId: ROUND,
  });
  assert.strictEqual(row.invoice_type, "success_fee");
  assert.strictEqual(row.amount_due, 5000);   // 031 renamed amount -> amount_due
  assert.strictEqual(row.status, "draft");
});

test("createInvoice is idempotent on idempotencyKey — second call returns null", async () => {
  const db = makeDb();
  const key = successFeeKey(SALE, ROUND);
  const first = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000, idempotencyKey: key });
  assert.ok(first, "first insert should succeed");

  const second = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000, idempotencyKey: key });
  assert.strictEqual(second, null, "duplicate key should return null (DO NOTHING)");
  assert.strictEqual(db._store.length, 1, "only one row in store");
});

test("createInvoice without idempotencyKey allows duplicate inserts", async () => {
  const db = makeDb();
  await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  assert.strictEqual(db._store.length, 2);
});

// ---------------------------------------------------------------------------
// markSent
// ---------------------------------------------------------------------------
test("markSent transitions draft → sent", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  const sent = await markSent(db, { invoiceId: row.id });
  assert.strictEqual(sent.status, "sent");
});

test("markSent on already-sent row returns null", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 1000 });
  await markSent(db, { invoiceId: row.id });
  const again = await markSent(db, { invoiceId: row.id });
  assert.strictEqual(again, null);
});

// ---------------------------------------------------------------------------
// markPaid
// ---------------------------------------------------------------------------
test("markPaid transitions sent → paid", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000 });
  await markSent(db, { invoiceId: row.id });
  const paid = await markPaid(db, { invoiceId: row.id });
  assert.strictEqual(paid.status, "paid");
  assert.ok(paid.paid_at);
});

test("markPaid on already-paid row returns null (idempotent guard)", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000 });
  await markSent(db, { invoiceId: row.id });
  await markPaid(db, { invoiceId: row.id });
  const again = await markPaid(db, { invoiceId: row.id });
  assert.strictEqual(again, null);
});

test("markPaid on an unissued draft returns null without changing status", async () => {
  const db = makeDb();
  const draft = await createInvoice(db, {
    orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 800,
  });
  assert.strictEqual(await markPaid(db, { invoiceId: draft.id }), null);
  assert.strictEqual((await getInvoice(db, { invoiceId: draft.id })).status, "draft");
});

test("markEscalated transitions sent → escalated", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000 });
  await markSent(db, { invoiceId: row.id });
  const esc = await markEscalated(db, { invoiceId: row.id });
  assert.strictEqual(esc.status, "escalated");
});

test("invoiceDisplayNumber and formatBalanceDue are stable", () => {
  assert.equal(invoiceDisplayNumber({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }), "INV-AAAAAAAA");
  assert.equal(formatBalanceDue(1250), "$1,250.00");
});

// ---------------------------------------------------------------------------
// voidInvoice
// ---------------------------------------------------------------------------
test("voidInvoice transitions draft → void", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 999 });
  const voided = await voidInvoice(db, { invoiceId: row.id, notes: "duplicate" });
  assert.strictEqual(voided.status, "void");
});

test("voidInvoice on paid row returns null", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 999 });
  await markSent(db, { invoiceId: row.id });
  await markPaid(db, { invoiceId: row.id });
  const voided = await voidInvoice(db, { invoiceId: row.id });
  assert.strictEqual(voided, null);
});

test("voidInvoice replay preserves original notes and write-off status", async () => {
  const db = makeDb();
  const row = await createInvoice(db, {
    orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 999,
  });
  await voidInvoice(db, { invoiceId: row.id, notes: "original cancellation" });
  assert.strictEqual(await voidInvoice(db, { invoiceId: row.id, notes: "overwritten" }), null);
  assert.strictEqual(row.notes, "original cancellation");
  const other = await createInvoice(db, {
    orgId: ORG, clientId: CLIENT, invoiceType: "deposit", amount: 999,
  });
  other.status = "written_off";
  other.notes = "approved write-off";
  assert.strictEqual(await voidInvoice(db, { invoiceId: other.id, notes: "erase audit" }), null);
  assert.strictEqual(other.status, "written_off");
  assert.strictEqual(other.notes, "approved write-off");
});

// ---------------------------------------------------------------------------
// getInvoice
// ---------------------------------------------------------------------------
test("getInvoice returns the row by id", async () => {
  const db = makeDb();
  const row = await createInvoice(db, { orgId: ORG, clientId: CLIENT, invoiceType: "platform_fee", amount: 49 });
  const fetched = await getInvoice(db, { invoiceId: row.id });
  assert.strictEqual(fetched.id, row.id);
});

test("getInvoice returns null for unknown id", async () => {
  const db = makeDb();
  const fetched = await getInvoice(db, { invoiceId: "nope" });
  assert.strictEqual(fetched, null);
});

// ---------------------------------------------------------------------------
// idempotency key helpers
// ---------------------------------------------------------------------------
test("successFeeKey is deterministic", () => {
  assert.strictEqual(successFeeKey("s1", "r1"), "invoice|success_fee|s1|r1");
  assert.strictEqual(successFeeKey("s1", "r1"), successFeeKey("s1", "r1"));
});

test("depositKey is deterministic", () => {
  assert.strictEqual(depositKey("s1"), "invoice|deposit|s1");
});

// ---------------------------------------------------------------------------
// round.funded → invoice integration (f-07 wiring)
// ---------------------------------------------------------------------------
test("round.funded scenario: success_fee invoice created with correct amount", async () => {
  const db = makeDb();
  const approvedAmount = 50000;
  const feePercent = 10;
  const expectedFee = Math.round(approvedAmount * feePercent) / 100; // 5000

  const invoice = await createInvoice(db, {
    orgId: ORG,
    clientId: CLIENT,
    invoiceType: "success_fee",
    amount: expectedFee,
    saleId: SALE,
    fundingRoundId: ROUND,
    idempotencyKey: successFeeKey(SALE, ROUND),
    notes: `round.funded — approved ${approvedAmount} @ ${feePercent}%`,
  });

  assert.strictEqual(invoice.amount_due, 5000);   // 031 renamed amount -> amount_due
  assert.strictEqual(invoice.invoice_type, "success_fee");
  assert.strictEqual(invoice.idempotency_key, `invoice|success_fee|${SALE}|${ROUND}`);
});

test("round.funded fired twice: idempotency prevents double invoice", async () => {
  const db = makeDb();
  const key = successFeeKey(SALE, ROUND);
  const opts = { orgId: ORG, clientId: CLIENT, invoiceType: "success_fee", amount: 5000, saleId: SALE, fundingRoundId: ROUND, idempotencyKey: key };

  await createInvoice(db, opts);
  await createInvoice(db, opts);

  assert.strictEqual(db._store.length, 1, "exactly one invoice despite two calls");
});
