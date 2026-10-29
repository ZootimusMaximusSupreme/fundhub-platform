import { test } from "node:test";
import assert from "node:assert";
import {
  handle as runArCollections, EMAIL_AR_01, SMS_AR_01, EMAIL_AR_02, SMS_AR_02, EMAIL_AR_03, SMS_AR_03,
  AR_04_TASK_TITLE, AR_04_SOURCE_WORKFLOW
} from "./ar-collections.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

async function handle(args) {
  return runArCollections({
    env: { CORTANA_COMMAS_API_KEY: "test-only" },
    createLink: async (db, input) => {
      const link = {
        id: `link-${db.paymentLinks.length + 1}`,
        org_id: input.orgId,
        client_id: input.clientId,
        invoice_id: input.invoiceId,
        funding_round_id: input.fundingRoundId,
        amount_cents: input.amountCents,
        description: input.description,
        provider: "commas",
        status: "created",
        checkout_url: `https://checkout.example/link-${db.paymentLinks.length + 1}`,
        link_ref: `ref-${db.paymentLinks.length + 1}`
      };
      db.paymentLinks.push(link);
      return link;
    },
    retireLink: async (db, { linkId, orgId, invoiceId }) => {
      const link = db.paymentLinks.find((p) => p.id === linkId && p.org_id === orgId && p.invoice_id === invoiceId);
      if (!link) throw new Error("retirement target missing");
      link.status = "void";
      return { retired: true, linkId };
    },
    ...args
  });
}

const templates = () => [
  { org_id: "org-1", template_key: EMAIL_AR_01, channel: "email", body: "ar1 {{invoice_number}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_AR_01, channel: "sms", body: "ar1s", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_AR_02, channel: "email", body: "ar2", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_AR_02, channel: "sms", body: "ar2s", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_AR_03, channel: "email", body: "ar3", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_AR_03, channel: "sms", body: "ar3s", compliance_passed: true }
];

function openInvoice(over = {}) {
  return {
    id: "inv-1",
    org_id: "org-1",
    client_id: "cl-1",
    source: "funding_success_fee",
    invoice_type: "success_fee",
    amount_due: 1250,
    status: "sent",
    ...over
  };
}

test("AR: unpaid success-fee invoice gets three notices then handoff", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(res.handoff.skipped, false);
  assert.equal(db.invoices[0].status, "escalated");
  assert.deepEqual(db.clients[0].tags, ["ar:collections-handoff"]);
  assert.equal(db.messages.length, 6);
  assert.equal(db.paymentLinks.length, 1, "one checkout per invoice despite three notices");
  assert.equal(db.paymentLinks[0].amount_cents, 125000);
  assert.equal(db.paymentLinks[0].description, "basic business consulting fee");
});

test("AR: paid invoice skips remaining chase", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  let sends = 0;
  const step = {
    run: async (id, fn) => {
      const out = await fn();
      if (id === "send-ar-01") db.invoices[0].status = "paid";
      if (id.startsWith("send-")) sends += 1;
      return out;
    },
    sleep: async () => {}
  };
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(res.stoppedAt, "before-ar-02");
  assert.equal(db.messages.length, 2);
});

test("AR: partial payment keeps chase going and {{balance_due}} is the remainder", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates().map((t) =>
      t.template_key === EMAIL_AR_01
        ? { ...t, body: "ar1 {{invoice_number}} {{balance_due}}" }
        : t),
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 400, paymentId: "pay_partial"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.allocated, true);
  assert.equal(pay.settled, false);
  assert.equal(db.invoices[0].status, "partially_paid");
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(Number(db.invoicePayments[0].amount), 400);

  const chase = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(chase.done, true);
  assert.equal(chase.handoff.skipped, false);
  assert.match(db.messages[0].rendered_body, /\$600\.00/);
  assert.equal(db.paymentLinks[0].amount_cents, 60000, "checkout asks only for the unpaid balance");
});

test("AR: missing Commas checkout config holds the notice, then a retry mints once", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const args = {
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  };
  await assert.rejects(handle({ ...args, env: {} }), /cannot mint a Commas checkout session/);
  assert.equal(db.messages.length, 0, "no client notice may point to a missing checkout");
  assert.equal(db.paymentLinks.length, 0);

  await handle(args);
  assert.equal(db.messages.length, 6);
  assert.equal(db.paymentLinks.length, 1);
});

test("AR: an absent notice template fails visibly and retries after it is installed", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    invoices: [openInvoice()]
  });
  const event = ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" });
  await assert.rejects(handle({ event, db, step: fakeStep() }), /AR notice template EMAIL-AR-01-FIRST-NOTICE is not ready/);
  assert.equal(db.messages.length, 0, "no silent success when approved copy is absent");
  assert.equal(db.paymentLinks.length, 1, "the saved Commas link is reusable on retry");

  db.templates.push(...templates());
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.paymentLinks.length, 1);
  assert.equal(db.messages.length, 6);
});

test("AR: provider mint failure holds the notice and a retry does not double-mint", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const event = ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" });
  await assert.rejects(handle({ event, db, step: fakeStep(), createLink: async () => {
    throw new Error("Commas temporarily unavailable");
  } }), /Commas temporarily unavailable/);
  assert.equal(db.messages.length, 0);

  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.paymentLinks.length, 1, "replayed AR must reuse the first saved link");
});

test("AR: non-Commas links cannot be reused or block a Commas replacement", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({ id: "inv-old", status: "void", funding_round_id: "round-1", sale_id: "sale-1" }),
      openInvoice({ id: "inv-1", funding_round_id: "round-1", sale_id: "sale-1" })
    ],
    paymentLinks: [
      {
        id: "other-old", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-old",
        provider: "other", amount_cents: 125000, status: "sent",
        checkout_url: "https://other.example/old"
      },
      {
        id: "other-current", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-1",
        provider: "other", amount_cents: 125000, status: "sent",
        checkout_url: "https://other.example/current"
      }
    ]
  });
  const retired = [];
  await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    retireLink: async (_db, { linkId }) => { retired.push(linkId); throw new Error("unexpected retirement"); }
  });
  assert.deepEqual(retired, [], "other providers must never be sent to Commas retirement");
  assert.equal(db.paymentLinks[0].status, "sent");
  assert.equal(db.paymentLinks[1].status, "sent");
  assert.equal(db.paymentLinks[2].provider, "commas");
  assert.equal(db.paymentLinks[2].invoice_id, "inv-1");
  assert.equal(db.paymentLinks[2].amount_cents, 125000);
  assert.equal(db.messages.length, 6);
});

test("AR: a partial payment retires the old link and mints only the remaining balance", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000 })],
    paymentLinks: [{
      id: "link-old", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-1",
      amount_cents: 100000, status: "sent", checkout_url: "https://checkout.example/old",
      link_ref: "old-link-ref"
    }],
    invoicePayments: [{ invoice_id: "inv-1", kind: "payment", amount: 400 }]
  });
  await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(db.paymentLinks.length, 2);
  assert.equal(db.paymentLinks[0].status, "void");
  assert.equal(db.paymentLinks[1].amount_cents, 60000);
  assert.equal(db.messages.length, 6);

  const late = await handle({
    event: ev("payment.received", {
      paymentLinkId: "link-old", product: "success_fee", amount: 1000, paymentId: "late_old_link"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(late.settled, true);
  assert.equal(late.surplusCents, 40000, "late old-link payment must not over-allocate");
  assert.equal(Number(db.invoicePayments.at(-1).amount), 600);
  assert.equal(db.tasks.filter((t) => /Overpayment leftover/.test(t.title)).length, 1);
});

test("AR: failed old-link retirement holds the replacement notice for retry", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000 })],
    paymentLinks: [{
      id: "link-old", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-1",
      amount_cents: 100000, status: "expired", checkout_url: "https://checkout.example/old"
    }],
    invoicePayments: [{ invoice_id: "inv-1", kind: "payment", amount: 400 }]
  });
  const event = ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" });
  await assert.rejects(handle({ event, db, step: fakeStep(), retireLink: async () => {
    throw new Error("Commas deletion failed");
  } }), /Commas deletion failed/);
  assert.equal(db.messages.length, 0);
  assert.equal(db.paymentLinks.length, 1);

  await handle({ event, db, step: fakeStep() });
  assert.equal(db.paymentLinks[0].status, "void");
  assert.equal(db.paymentLinks[1].amount_cents, 60000);
});

test("AR: exact payment settles that invoice and stops only that chase", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({ amount_due: 1250, funding_round_id: "round-a" }),
      openInvoice({ id: "inv-2", amount_due: 800, funding_round_id: "round-b" })
    ]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1250, paymentId: "pay_exact"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.settled, true);
  assert.equal(db.invoices[0].status, "paid");
  assert.equal(db.invoices[1].status, "sent");

  const chasePaid = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(chasePaid.stoppedAt, "before-ar-01");

  const chaseOpen = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-2", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(chaseOpen.handoff.skipped, false);
  assert.equal(db.invoices[1].status, "escalated");
});

test("AR: overpay settles the matched invoice and leaves leftover unallocated", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({ amount_due: 1000, funding_round_id: "round-a" }),
      openInvoice({ id: "inv-2", amount_due: 500, funding_round_id: "round-b" })
    ]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1500, paymentId: "pay_over"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.settled, true);
  assert.equal(pay.surplusCents, 50000);
  assert.equal(db.invoices[0].status, "paid");
  assert.equal(db.invoices[1].status, "sent");
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(Number(db.invoicePayments[0].amount), 1000);
  assert.equal(db.tasks.length, 1);
  assert.match(db.tasks[0].title, /Overpayment leftover/);
});

test("AR: two open invoices — payment with a round lands on that round only", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [
      openInvoice({
        id: "inv-old", amount_due: 1000, funding_round_id: "round-a",
        created_at: "2026-01-01", external_ref: null
      }),
      openInvoice({
        id: "inv-new", amount_due: 2000, funding_round_id: "round-b",
        created_at: "2026-06-01", external_ref: null
      })
    ]
  });
  const pay = await handle({
    event: ev("payment.received", {
      product: "success_fee", amount: 2000, paymentId: "pay_round",
      fundingRoundId: "round-b"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.path, "round");
  assert.equal(pay.invoiceId, "inv-new");
  assert.equal(db.invoices.find((i) => i.id === "inv-new").status, "paid");
  assert.equal(db.invoices.find((i) => i.id === "inv-old").status, "sent");
});

test("AR: replayed webhook does not double-settle", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const event = ev("payment.received", {
    invoiceId: "inv-1", product: "success_fee", amount: 1000, paymentId: "pay_replay"
  }, { clientId: "cl-1" });
  const first = await handle({ event, db, step: fakeStep() });
  const second = await handle({ event, db, step: fakeStep() });
  assert.equal(first.settled, true);
  assert.equal(second.replay, true);
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(db.invoices[0].status, "paid");
});

test("AR: a second envelope for one Commas payment rechecks after the invoice lock", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const query = db.query.bind(db);
  let competingReceiptCommitted = false;
  db.query = (sql, params) => {
    // The competing callback commits after this envelope's early replay check
    // but before its own FOR UPDATE returns. Distinct event IDs must not turn
    // the one provider payment into a second $600 receipt.
    if (!competingReceiptCommitted && /SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/.test(sql)) {
      competingReceiptCommitted = true;
      db.invoicePayments.push({
        id: "ip-first", org_id: "org-1", invoice_id: "inv-1",
        kind: "payment", method: "commas", amount: 400,
        external_ref: "pay-race", source_event_id: "first-envelope"
      });
      db.invoices[0].status = "partially_paid";
    }
    return query(sql, params);
  };
  const replay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1000, paymentId: "pay-race"
    }, { id: "second-envelope", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(competingReceiptCommitted, true);
  assert.equal(replay.replay, true);
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(db.invoices[0].status, "partially_paid");
});

test("AR: replay repairs a paid announcement that failed after the receipt committed", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  let failOnce = true;
  const query = db.query.bind(db);
  db.query = (sql, params) => {
    if (failOnce && /INSERT INTO events/.test(sql) && params?.[1] === "invoice.paid") {
      failOnce = false;
      throw new Error("event write unavailable");
    }
    return query(sql, params);
  };
  const args = {
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1000, paymentId: "pay_recover"
    }, { id: "event-recover", clientId: "cl-1" }),
    db, step: fakeStep()
  };
  await assert.rejects(handle(args), /event write unavailable/);
  assert.equal(db.invoices[0].status, "paid", "the receipt committed before the event failed");
  assert.equal(db.invoicePayments.length, 1);
  const replay = await handle(args);
  assert.equal(replay.replay, true);
  assert.equal(db.invoicePayments.length, 1, "retry does not credit money twice");
  assert.equal(db.events.filter((row) => row.name === "invoice.paid").length, 1);
});

test("AR: each genuine partial receipt emits one invoice event, replay emits no third", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const payment = (amount, paymentId) => handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount, paymentId
    }, { id: `event-${paymentId}`, clientId: "cl-1" }),
    db, step: fakeStep()
  });
  await payment(400, "partial-one");
  await payment(300, "partial-two");
  await payment(400, "partial-one");
  const partials = db.events.filter((row) => row.name === "invoice.partially_paid");
  assert.equal(partials.length, 2);
  assert.notEqual(partials[0].idempotency_key, partials[1].idempotency_key);
  assert.ok(partials.every((row) => row.payload.invoiceId === "inv-1" && row.org_id === "org-1"));
  assert.equal(db.invoicePayments.length, 2);
  assert.equal(db.invoices[0].status, "partially_paid");
});

test("AR: replay repairs a partial announcement that failed after the receipt committed", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  let failOnce = true;
  const query = db.query.bind(db);
  db.query = (sql, params) => {
    if (failOnce && /INSERT INTO events/.test(sql) && params?.[1] === "invoice.partially_paid") {
      failOnce = false;
      throw new Error("partial event write unavailable");
    }
    return query(sql, params);
  };
  const args = {
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 400, paymentId: "partial-recover"
    }, { id: "event-partial-recover", clientId: "cl-1" }),
    db, step: fakeStep()
  };
  await assert.rejects(handle(args), /partial event write unavailable/);
  assert.equal(db.invoices[0].status, "partially_paid");
  assert.equal(db.invoicePayments.length, 1);
  const replay = await handle(args);
  assert.equal(replay.replay, true);
  assert.equal(db.invoicePayments.length, 1);
  assert.equal(db.events.filter((row) => row.name === "invoice.partially_paid").length, 1);
});

test("AR: unmatched success-fee payment stays unallocated and opens a staff task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000, funding_round_id: "round-a" })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      product: "success_fee", amount: 1000, paymentId: "pay_orphan"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.allocated, false);
  assert.equal(pay.reason, "unresolved");
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.tasks.length, 1);
});

test("AR: a late payment for a voided bill stays unallocated", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ status: "void", funding_round_id: "round-a" })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", fundingRoundId: "round-a", product: "success_fee",
      amount: 1000, paymentId: "pay_void"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.reason, "invoice_unavailable");
  assert.equal(pay.allocated, false);
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "void");
  assert.equal(db.tasks.length, 1);
});

test("AR: a late payment on the retired link cannot settle its replacement bill", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [
      openInvoice({ id: "inv-old", status: "void", funding_round_id: "round-a" }),
      openInvoice({ id: "inv-new", amount_due: 1000, funding_round_id: "round-a" })
    ],
    paymentLinks: [{
      id: "link-old", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-old",
      link_ref: "ref-old", status: "expired"
    }]
  });
  const pay = await handle({
    event: ev("payment.received", {
      paymentLinkId: "link-old", ref: "ref-old", fundingRoundId: "round-a",
      product: "success_fee", amount: 1000, paymentId: "pay_old_link"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.reason, "invoice_unavailable");
  assert.equal(pay.invoiceId, "inv-old");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[1].status, "sent");
  assert.equal(db.tasks.length, 1);
});

test("AR: conflicting invoice and checkout identities do not allocate money", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice(), openInvoice({ id: "inv-2" })],
    paymentLinks: [{
      id: "link-2", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-2",
      link_ref: "ref-2", status: "sent"
    }]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", paymentLinkId: "link-2", ref: "ref-2",
      product: "success_fee", amount: 1000, paymentId: "pay_conflict"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.reason, "invoice_mismatch");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.tasks.length, 1);
});

test("AR: a payment naming another client's bill stays unallocated", async () => {
  const db = pgFake({
    clients: [{ id: "cl-2", org_id: "org-1", email: "b@b.com" }],
    invoices: [openInvoice({ client_id: "cl-1", amount_due: 1000 })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1000, paymentId: "pay_crossed"
    }, { clientId: "cl-2" }),
    db, step: fakeStep()
  });
  assert.equal(pay.reason, "invoice_mismatch");
  assert.equal(pay.allocated, false);
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(db.tasks.length, 1);
});

test("AR: a bill voided during payment matching leaves a review task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/WITH payable AS/.test(sql)) {
      db.invoices[0].status = "void";
      return { rows: [] };
    }
    return query(sql, params);
  };
  const pay = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1000, paymentId: "pay_raced"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.reason, "invoice_unavailable");
  assert.equal(pay.allocated, false);
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.tasks.length, 1);
});

test("AR: two receipts serialize on one bill and never credit more than due", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const query = db.query.bind(db);
  let tail = Promise.resolve();
  let connections = 0;
  let commits = 0;
  db.connect = async () => {
    connections += 1;
    let releaseLock = null;
    return {
      async query(sql, params) {
        if (sql === "BEGIN") return { rows: [] };
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          releaseLock?.();
          if (sql === "COMMIT") commits += 1;
          return { rows: [] };
        }
        if (/SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/.test(sql)) {
          let release;
          const next = new Promise((resolve) => { release = resolve; });
          const prior = tail;
          tail = next;
          await prior;
          releaseLock = release;
        }
        return query(sql, params);
      },
      release() {}
    };
  };
  const payment = (id) => handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 700, paymentId: id
    }, { id: `event-${id}`, clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const results = await Promise.all([payment("pay-one"), payment("pay-two")]);
  assert.equal(connections, 2, "each allocation uses a real transaction handle");
  assert.equal(commits, 2, "both balance decisions commit under the invoice lock");
  assert.deepEqual(results.map((r) => r.appliedCents).sort((a, b) => a - b), [30000, 70000]);
  assert.equal(db.invoicePayments.reduce((sum, row) => sum + Number(row.amount), 0), 1000);
  assert.equal(db.invoices[0].status, "paid");
  assert.equal(db.tasks.length, 1, "the extra $400 is an unallocated review task");
});

test("AR: a deposit payment does not settle an open success-fee invoice", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ amount_due: 1000 })]
  });
  const pay = await handle({
    event: ev("payment.received", {
      product: "deposit", amount: 3000, paymentId: "pay_dep", purpose: "deposit"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(pay.skipped, true);
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("AR: DIY invoice is ignored", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: templates(),
    invoices: [openInvoice({ source: "diy_letters", invoice_type: "deposit" })]
  });
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "diy_letters" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_success_fee");
  assert.equal(db.messages.length, 0);
});


/* AR-04 used to end in a tag nobody read. These two pin the thing that changed:
   the ladder now ends with a named person, and it ends with exactly one. */

test("AR: the handoff opens a CSM task, not just a tag", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  // The detail column (migration 472) is the human-readable note; body is
  // a stable UNIQUE key. Observe the real SQL call without editing shared fakes.
  let recordedDetail = null;
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/INSERT INTO tasks/.test(sql) && /\bdetail\)/.test(sql)) recordedDetail = params[9];
    return query(sql, params);
  };
  const res = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });

  assert.equal(res.handoff.skipped, false);
  assert.equal(res.handoff.taskCreated, true, "AR-04 must hand the client to a person");

  const tasks = (db.tasks || []).filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW);
  assert.equal(tasks.length, 1, "exactly one handoff task");
  assert.equal(tasks[0].assignee_role, "csm");
  assert.equal(tasks[0].title, AR_04_TASK_TITLE);
  assert.equal(tasks[0].body, "ar-success-fee:org-1:inv-1:04", "body is a stable per-invoice dedupe key");
  assert.match(recordedDetail, /Invoice INV-INV1/);
  assert.match(recordedDetail, /Balance due: \$1,250\.00/);
});

test("AR: replaying the run does not stack a second handoff task", async () => {
  const seed = () => ({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const db = pgFake(seed());
  const event = ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" });

  await handle({ event, db, step: fakeStep() });
  // Same event id, same invoice — an Inngest replay, which is normal, not an error.
  db.invoices[0].status = "sent";
  await handle({ event, db, step: fakeStep() });

  const tasks = (db.tasks || []).filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW);
  assert.equal(tasks.length, 1, "a replay must find the existing task, not open a second");
});


test("AR idempotency: different invoice.sent events cannot duplicate notices or CSM escalation", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "ar-replay+first@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const first = ev("invoice.sent", { invoiceId: "inv-1" }, { id: "evt-ar-original", clientId: "cl-1" });
  const second = ev("invoice.sent", { invoiceId: "inv-1" }, { id: "evt-ar-recovered", clientId: "cl-1" });
  await handle({ event: first, db, step: fakeStep() });
  await handle({ event: second, db, step: fakeStep() });
  assert.equal(db.messages.length, 6, "exactly three email/SMS pairs across distinct bus IDs");
  assert.equal(db.paymentLinks.length, 1, "same outstanding amount reuses the first checkout");
  assert.equal(db.tasks.filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW).length, 1,
    "one CSM handoff per invoice even after independent bus delivery");
});

test("AR idempotency: later partial balance must not create duplicate notices or task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "ar-replay+partial@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1" }, { id: "evt-ar-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  db.invoicePayments.push({ invoice_id: "inv-1", org_id: "org-1", kind: "payment",
    amount: 400, external_ref: "fixture-partial-400" });
  db.invoices[0].status = "partially_paid";
  await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1" }, { id: "evt-ar-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(db.messages.length, 6, "partial settlement is not a new invoice.sent notice series");
  assert.equal(db.tasks.filter((t) => t.source_workflow === AR_04_SOURCE_WORKFLOW).length, 1,
    "body must not change with the invoice balance");
  assert.equal(db.paymentLinks[0].status, "void", "outdated checkout is retired");
  assert.equal(db.paymentLinks.at(-1).amount_cents, 85000, "replacement checkout is only the remaining balance");
});

test("AR security: stray invoice.sent must not collect an invoice still in draft", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "ar-replay+draft@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ status: "draft" })]
  });
  const result = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1" }, { id: "evt-ar-draft", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.stoppedAt, "before-ar-01");
  assert.equal(result.first.reason, "draft");
  assert.equal(db.messages.length, 0);
  assert.equal(db.paymentLinks.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("AR security: an invoice.sent envelope cannot turn a DIY invoice into a success-fee demand", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ source: "diy_letters", invoice_type: "deposit" })]
  });
  const result = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee", invoice_type: "success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "not_success_fee");
  assert.equal(db.messages.length, 0);
  assert.equal(db.paymentLinks.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("AR security: notices never target the wrong customer within one organization", async () => {
  const db = pgFake({
    clients: [
      { id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} },
      { id: "cl-2", org_id: "org-1", email: "two@example.com", custom_fields: {} }
    ],
    templates: templates(),
    invoices: [openInvoice({ client_id: "cl-2" })]
  });
  const result = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "invoice_identity_mismatch");
  assert.equal(db.messages.length, 0);
  assert.equal(db.paymentLinks.length, 0);
});

test("AR security: a different organization's invoice cannot be chased", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice({ org_id: "org-2" })]
  });
  const result = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "invoice_identity_mismatch");
  assert.equal(db.messages.length, 0);
  assert.equal(db.paymentLinks.length, 0);
});

test("AR security: each delayed notice rechecks the invoice's canonical source", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const step = {
    run: async (name, fn) => {
      const result = await fn();
      if (name === "send-ar-01") db.invoices[0].source = "diy_letters";
      return result;
    },
    sleep: async () => {}
  };
  const result = await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(result.stoppedAt, "before-ar-02");
  assert.equal(result.second.reason, "not_success_fee");
  assert.equal(db.messages.length, 2, "later notices cannot leak after source changed");
  assert.equal(db.tasks.length, 0, "no collections escalation on a reclassified invoice");
});

test("AR security: notice number comes from the invoice, not the event envelope", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    templates: templates(),
    invoices: [openInvoice()]
  });
  await handle({
    event: ev("invoice.sent", { invoiceId: "inv-1", source: "funding_success_fee", invoice_number: "INV-SPOOFED" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.match(db.messages[0].rendered_body, /INV-INV1/);
  assert.doesNotMatch(db.messages[0].rendered_body, /SPOOFED/);
});

test("AR security: a deposit with a stale success-fee invoice ID never settles that bill", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    invoices: [openInvoice({ amount_due: 900 })]
  });
  const result = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "deposit", purpose: "deposit", amount: 900, paymentId: "deposit-1"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "not_invoice_payment");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "sent");
});

test("AR security: a payment carrying a DIY invoice ID never records a success-fee receipt", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    invoices: [openInvoice({ source: "diy_letters", invoice_type: "deposit" })]
  });
  const result = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "diy_letters", amount: 1250, paymentId: "diy-1"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "not_success_fee_invoice");
  assert.equal(result.skipped, true);
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "sent");
});

test("AR security: a supposed success fee naming a DIY invoice leaves review work, not a false settlement", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "one@example.com", custom_fields: {} }],
    invoices: [openInvoice({ source: "diy_letters", invoice_type: "deposit" })]
  });
  const result = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1250, paymentId: "wrong-bill-1"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(result.allocated, false);
  assert.equal(result.reason, "not_success_fee_invoice");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "sent");
  assert.equal(db.tasks.length, 1, "unmatched money must reach a person");
});

test("AR security: missing canonical invoice client never creates a CRM contact from envelope email", async () => {
  const db = pgFake({
    clients: [],
    templates: templates(),
    invoices: [openInvoice()]
  });
  const result = await handle({
    event: ev("invoice.sent", {
      invoiceId: "inv-1", source: "funding_success_fee", email: "spoof+ar@example.com"
    }),
    db, step: fakeStep()
  });
  assert.equal(result.reason, "no_client");
  assert.equal(db.clients.length, 0);
  assert.equal(db.messages.length, 0);
  assert.equal(db.paymentLinks.length, 0);
});

test("AR issuance: payment with a draft success-fee invoice ID stays unallocated", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "ar-draft+receipt@example.com" }],
    invoices: [openInvoice({ status: "draft", funding_round_id: "round-draft" })]
  });
  const result = await handle({
    event: ev("payment.received", {
      invoiceId: "inv-1", product: "success_fee", amount: 1250, paymentId: "pay-draft-id"
    }, { clientId: "cl-1", id: "evt-draft-id" }),
    db, step: fakeStep()
  });
  assert.equal(result.allocated, false);
  assert.equal(result.reason, "invoice_unavailable");
  assert.equal(db.invoicePayments.length, 0, "no unissued invoice receipt");
  assert.equal(db.invoices[0].status, "draft", "draft must never be settled implicitly");
  assert.equal(db.tasks.filter((t) => t.source_workflow === "ar-allocate").length, 1,
    "a real provider payment with a wrong invoice status needs human matching");
});

test("AR issuance: round-only payment cannot match an unsent draft invoice", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "ar-draft+round@example.com" }],
    invoices: [openInvoice({ status: "draft", funding_round_id: "round-draft" })]
  });
  const result = await handle({
    event: ev("payment.received", {
      fundingRoundId: "round-draft", product: "success_fee",
      amount: 1250, paymentId: "pay-draft-round"
    }, { clientId: "cl-1", id: "evt-draft-round" }),
    db, step: fakeStep()
  });
  assert.equal(result.allocated, false);
  assert.equal(result.reason, "unresolved");
  assert.equal(db.invoicePayments.length, 0);
  assert.equal(db.invoices[0].status, "draft");
  assert.equal(db.tasks.filter((t) => t.source_workflow === "ar-allocate").length, 1);
});
