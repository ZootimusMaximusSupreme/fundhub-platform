import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INVOICES_PER_SWEEP, SWEEP_CRON, sweepInvoiceSentRecovery
} from "./invoice-sent-recovery.mjs";
import {
  RECOVERY_CANDIDATE_SQL, CLAIM_RECOVERY_SQL, RELEASE_RECOVERY_SQL, RECOVERY_STUCK_SQL
} from "./invoice-sent-recovery-query.mjs";
import { handle as runArCollections, EMAIL_AR_01, SMS_AR_01 } from "./ar-collections.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

function invoice(id = "inv-1", over = {}) {
  return {
    id, org_id: "org-1", client_id: "cl-1", sale_id: "sale-1",
    funding_round_id: "round-1", invoice_type: "success_fee",
    source: "funding_success_fee", status: "sent", amount_due: 1250,
    currency: "USD", sent_at: new Date(Date.now() - 3 * 60 * 60_000),
    roundProduct: "card_stacking", roundStatus: "funded", openBalance: 1250,
    hasLink: false, hasEmailAr01: false, hasSmsAr01: false, smsOptOut: false,
    event: null, ...over
  };
}

function savedEvent(id, invoiceId = "inv-1", replayedAt = null) {
  return {
    id, name: "invoice.sent", org_id: "org-1", client_id: "cl-1",
    idempotency_key: `invoice.sent:${invoiceId}`,
    payload: { invoiceId, source: "funding_success_fee", invoice_type: "success_fee" },
    replayed_at: replayedAt
  };
}

function fakeDb(seed) {
  const rows = seed;
  const calls = [];
  let nextEvent = 0;
  const eligible = (r) => r.sale_id && r.funding_round_id &&
    r.source === "funding_success_fee" &&
    ["sent", "reminded", "escalated", "partially_paid"].includes(r.status) &&
    Date.now() - new Date(r.sent_at).getTime() > 30 * 60_000 &&
    r.currency === "USD" && r.openBalance > 0 &&
    r.roundProduct === "card_stacking" && r.roundStatus === "funded" &&
    (!r.hasLink || !r.event || !r.hasEmailAr01 || (!r.smsOptOut && !r.hasSmsAr01));
  const due = (r) => !r.event?.replayed_at ||
    Date.now() - new Date(r.event.replayed_at).getTime() > 2 * 60 * 60_000;
  const project = (r) => ({ ...r,
    event_id: r.event?.id || null,
    event_name: r.event?.name || null,
    event_payload: r.event?.payload || null,
    event_client_id: r.event?.client_id || null,
    event_replayed_at: r.event?.replayed_at || null
  });
  return {
    rows, calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === RECOVERY_CANDIDATE_SQL) {
        return { rows: rows.filter((r) => eligible(r) && due(r) &&
          (!params[1] || r.id === params[1])).slice(0, params[0]).map(project) };
      }
      if (/INSERT INTO events/.test(sql)) {
        const [orgId, name, , key, clientId, payload] = params;
        const row = rows.find((r) => r.org_id === orgId && key === `invoice.sent:${r.id}`);
        if (row.event) return { rows: [] };
        row.event = { id: `event-${++nextEvent}`, name, org_id: orgId,
          client_id: clientId, idempotency_key: key, payload, replayed_at: null };
        return { rows: [{ id: row.event.id }] };
      }
      if (sql === CLAIM_RECOVERY_SQL) {
        const [eventId, orgId, invoiceId, previous] = params;
        const row = rows.find((r) => r.id === invoiceId && r.org_id === orgId &&
          r.event?.id === eventId);
        if (!row || !eligible(row) || !due(row) ||
            String(row.event.replayed_at) !== String(previous)) return { rows: [] };
        row.event.replayed_at = new Date();
        return { rows: [{ replayed_at: row.event.replayed_at }] };
      }
      if (sql === RELEASE_RECOVERY_SQL) {
        const [eventId, orgId, previous, claimed] = params;
        const row = rows.find((r) => r.org_id === orgId && r.event?.id === eventId);
        if (row && String(row.event.replayed_at) === String(claimed)) {
          row.event.replayed_at = previous;
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
    }
  };
}

test("recovery is capped and SQL excludes unlinked, unfunded and paid invoices", async () => {
  assert.equal(SWEEP_CRON, "35 * * * *");
  for (const guard of [
    "i.sale_id IS NOT NULL", "r.product = 'card_stacking'", "r.status = 'funded'",
    "b.open_balance > 0", "pl.provider = 'commas'", "pl.amount_cents = ROUND(b.open_balance * 100)::bigint",
    "EMAIL-AR-01-FIRST-NOTICE", "SMS-AR-01-FIRST-NOTICE", "oo.opted_in_at IS NULL"
  ]) assert.ok(RECOVERY_CANDIDATE_SQL.includes(guard), guard);
  const rows = [
    invoice("legacy", { sale_id: null }), invoice("unfunded", { roundStatus: "submitted" }),
    invoice("paid", { status: "paid" }), invoice("done", { hasLink: true, hasEmailAr01: true, hasSmsAr01: true,
      event: savedEvent("done-event", "done") }),
    ...Array.from({ length: 6 }, (_, i) => invoice(`due-${i}`, {
      event: savedEvent(`event-${i}`, `due-${i}`)
    }))
  ];
  const conn = fakeDb(rows);
  const sent = [];
  const result = await sweepInvoiceSentRecovery(conn, {
    limit: 999, sendEvent: async (event) => sent.push(event)
  });
  assert.equal(result.scanned, MAX_INVOICES_PER_SWEEP);
  assert.equal(result.dispatched, MAX_INVOICES_PER_SWEEP);
  assert.deepEqual(sent.map((e) => e.data.id), ["event-0", "event-1", "event-2", "event-3"]);
  assert.equal(conn.calls.filter((c) => /INSERT INTO events/.test(c.sql)).length, 0);
});

test("missing event uses the stable invoice key, then dispatches its saved bus ID once", async () => {
  const row = invoice();
  const conn = fakeDb([row]);
  const sent = [];
  const out = await sweepInvoiceSentRecovery(conn, { sendEvent: async (event) => sent.push(event) });
  assert.deepEqual(out, { scanned: 1, announced: 1, dispatched: 1, skipped: 0, failed: 0 });
  assert.equal(row.event.idempotency_key, "invoice.sent:inv-1");
  assert.equal(row.event.payload.invoice_number, "INV-INV1");
  assert.equal(row.event.payload.amount_due, 1250);
  assert.deepEqual(sent[0], { name: "invoice.sent", data: {
    id: row.event.id, payload: row.event.payload, orgId: "org-1", clientId: "cl-1"
  } });
  assert.equal((await sweepInvoiceSentRecovery(conn, { sendEvent: async (event) => sent.push(event) })).scanned, 0);
  assert.equal(sent.length, 1);
});

test("canonical source-only fee invoice with null legacy type is recovered", async () => {
  const row = invoice("source-only", { invoice_type: null,
    event: savedEvent("source-only-event", "source-only") });
  row.event.payload.invoice_type = null;
  const conn = fakeDb([row]);
  const sent = [];
  const out = await sweepInvoiceSentRecovery(conn, { sendEvent: async (event) => sent.push(event) });
  assert.equal(row.invoice_type, null);
  assert.equal(out.dispatched, 1);
  assert.equal(sent[0].data.id, "source-only-event");
  for (const sql of [RECOVERY_CANDIDATE_SQL, CLAIM_RECOVERY_SQL, RECOVERY_STUCK_SQL]) {
    assert.match(sql, /i\.source = 'funding_success_fee'/);
    assert.doesNotMatch(sql, /i\.invoice_type\s*=/);
  }
});

test("failed awaited send releases the claim so the same event retries", async () => {
  const row = invoice("inv-1", { event: savedEvent("saved-id") });
  const conn = fakeDb([row]);
  await assert.rejects(sweepInvoiceSentRecovery(conn, { sendEvent: async () => {
    throw new Error("Inngest unavailable");
  } }), /recovery attempts failed/);
  assert.equal(row.event.replayed_at, null);
  assert.equal(conn.calls.filter((c) => c.sql === RELEASE_RECOVERY_SQL).length, 1);
  const sent = [];
  const out = await sweepInvoiceSentRecovery(conn, { sendEvent: async (event) => sent.push(event) });
  assert.equal(out.dispatched, 1);
  assert.equal(sent[0].data.id, "saved-id");
  assert.equal(conn.calls.filter((c) => /INSERT INTO events/.test(c.sql)).length, 0);
});

test("a partial first-notice pair is recovered unless SMS was opted out", async () => {
  const partial = invoice("partial", { event: savedEvent("partial-id", "partial"),
    hasLink: true, hasEmailAr01: true });
  const optedOut = invoice("opted-out", { event: savedEvent("optout-id", "opted-out"),
    hasLink: true, hasEmailAr01: true, smsOptOut: true });
  const conn = fakeDb([partial, optedOut]);
  const sent = [];
  const result = await sweepInvoiceSentRecovery(conn, { sendEvent: async (event) => sent.push(event) });
  assert.equal(result.scanned, 1);
  assert.equal(sent[0].data.id, "partial-id");
  assert.equal(optedOut.event.replayed_at, null);
});

test("overlapping sweeps share one atomic replay claim", async () => {
  const row = invoice("inv-1", { event: savedEvent("saved-id") });
  const conn = fakeDb([row]);
  let started;
  let finish;
  const sendStarted = new Promise((resolve) => { started = resolve; });
  const waitToFinish = new Promise((resolve) => { finish = resolve; });
  let sends = 0;
  const first = sweepInvoiceSentRecovery(conn, { sendEvent: async () => {
    sends++;
    started();
    await waitToFinish;
  } });
  await sendStarted;
  const second = await sweepInvoiceSentRecovery(conn, { sendEvent: async () => { sends++; } });
  assert.equal(second.dispatched, 0);
  finish();
  assert.equal((await first).dispatched, 1);
  assert.equal(sends, 1);
  assert.match(CLAIM_RECOVERY_SQL, /replayed_at IS NOT DISTINCT FROM \$4::timestamptz/);
});

test("the same saved bus ID cannot queue a second AR-01 notice", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15555550100", custom_fields: {} }],
    templates: [
      ...[EMAIL_AR_01, "EMAIL-AR-02-REMINDER", "EMAIL-AR-03-FINAL-NOTICE"].map((template_key) =>
        ({ org_id: "org-1", template_key, channel: "email", body: "Fee {{invoice_number}}", compliance_passed: true })),
      ...[SMS_AR_01, "SMS-AR-02-REMINDER", "SMS-AR-03-FINAL-NOTICE"].map((template_key) =>
        ({ org_id: "org-1", template_key, channel: "sms", body: "Fee due", compliance_passed: true }))
    ],
    invoices: [invoice("inv-1")]
  });
  const replay = ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" },
    { id: "saved-id", clientId: "cl-1" });
  const createLink = async (conn, input) => {
    const link = { id: "link-1", org_id: input.orgId, client_id: input.clientId,
      invoice_id: input.invoiceId, amount_cents: input.amountCents, provider: "commas",
      status: "created", checkout_url: "https://checkout.example/link-1", link_ref: "ref-1" };
    conn.paymentLinks.push(link);
    return link;
  };
  for (let i = 0; i < 2; i++) await runArCollections({
    event: replay, db, step: fakeStep(), env: { CORTANA_COMMAS_API_KEY: "test-only" }, createLink
  });
  assert.equal(db.paymentLinks.length, 1);
  assert.equal(db.messages.filter((m) => [EMAIL_AR_01, SMS_AR_01].includes(m.template_key)).length, 2);
  assert.equal(new Set(db.messages.map((m) => m.provider_ref)).size, db.messages.length);
});
