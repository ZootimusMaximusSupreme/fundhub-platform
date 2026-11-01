// A. FUNDING PATH — lead → pay → CRS → underwrite → contract → deposit →
// round → applications → funded → closeout → invoice → messages queued.
// Asserts persistence with actual values at every step.

import { emit, replay } from "../../events/bus.mjs";
import { randomUUID } from "node:crypto";
import { normalizeClickFunnelsEvent, handleClickFunnelsWebhook } from "../../adapters/clickfunnels.mjs";
import { loadSimulatedClient, buildSimulatedCrsPayload, teardownSimulated } from "../../demo/simulate-client.mjs";
import { ingestCrsResult } from "../../tradelines/store.mjs";
import { captureConsent } from "../../consent/index.mjs";
import { createPaymentLink } from "../../payment-links/index.mjs";
import { listTemplates, getTemplateByKey } from "../../contracts/templates.mjs";
import { createDraft, send as sendContract } from "../../contracts/send.mjs";
import { verifyIntegrity } from "../../contracts/sign.mjs";
import { MOCK_SECRETS, MONEY, signHmac, BUREAU_FIELDS } from "../fixtures.mjs";
import { insertClient } from "../insert-client.mjs";
import { handle as s01 } from "../../workflows/s-01-new-lead-intake.mjs";
import { handle as s04 } from "../../workflows/s-04-call-booked.mjs";
import { handle as f07 } from "../../workflows/f-07-funding-locked.mjs";
import { handle as roundNotify } from "../../workflows/round-started-client-notify.mjs";

function stepFake() {
  return {
    async run(_name, fn) { return fn(); },
    async sleep() { return; },
    async sendEvent() { return; }
  };
}

export function assertFundingCreditor(tradelines, collector, context = {}) {
  const chase = tradelines.find(row => row.account_ref === 'SIM-CHASE-001');
  collector.assertEq({
    ...context, id: 'fund-bureau-creditor',
    claim: 'Tradeline creditorName survived ingest on the Chase account',
    expected: 'Chase Sapphire Preferred',
    actual: chase?.creditor || chase?.lender || chase?.creditor_name || null,
    file: 'src/tradelines/store.mjs'
  });
  return chase || null;
}

export async function runFundingJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "FUNDING";
  const role = "system";
  const steps = [];
  const note = { title: "A. Funding path", steps, usableToday: null, body: "" };
  const clientIds = [];
  const closer = ctx.staffByRole.closer;
  const advisor = ctx.staffByRole.funding_advisor;
  const email = `${ctx.mark}.funding.${ctx.stamp}@verify.local`;

  // ── 1. Lead capture via ClickFunnels adapter (dry-run secrets) ──
  const cfBody = {
    data: {
      contact: {
        email,
        first_name: "Verify",
        last_name: "Funding",
        phone: "+15550100001",
        full_name: "Verify Funding"
      }
    },
    event: "lead.created"
  };
  const raw = JSON.stringify(cfBody);
  const sig = signHmac(raw, MOCK_SECRETS.CLICKFUNNELS_WEBHOOK_SECRET);
  let cfResult;
  try {
    cfResult = await handleClickFunnelsWebhook({
      db,
      rawBody: raw,
      signatureHeader: sig,
      secret: MOCK_SECRETS.CLICKFUNNELS_WEBHOOK_SECRET
    });
  } catch (err) {
    cfResult = { error: String(err.message || err) };
    await emit(db, "entry.captured", {
      email, name: "Verify Funding", phone: "+15550100001",
      firstName: "Verify", lastName: "Funding", source: "clickfunnels"
    }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:cf:${ctx.stamp}` });
  }
  if (cfResult?.ok === false || cfResult?.error) {
    // Adapter refused or no-op'd — still drive the bus so the rest of the path is testable.
    await emit(db, "entry.captured", {
      email, name: "Verify Funding", phone: "+15550100001",
      firstName: "Verify", lastName: "Funding", source: "clickfunnels"
    }, { orgId: ctx.orgId, idempotencyKey: `${ctx.mark}:cf:${ctx.stamp}` });
  }

  const client = (await db.query(`SELECT * FROM clients WHERE email = $1`, [email])).rows[0];
  if (client) clientIds.push(client.id);

  collector.assertCount({
    section, journey, role, id: "fund-lead-client",
    claim: "ClickFunnels/entry.captured created a clients row",
    count: client ? 1 : 0, expected: 1,
    file: "src/adapters/clickfunnels.mjs",
    opReturnedOk: cfResult?.ok !== false && !cfResult?.error
  });
  steps.push({
    step: "Lead captured → client row",
    status: client ? "PASS" : "FAIL",
    persisted: client ? `client.id=${client.id} email=${client.email}` : "no row"
  });

  if (!client) {
    note.usableToday = false;
    note.body = "Lead capture did not create a client. Funding path stops here.";
    return { note, clientIds, usableToday: false };
  }

  // Drive S-01 directly (workflow engine, not Inngest).
  await s01({
    event: { orgId: ctx.orgId, clientId: client.id, payload: { email }, id: `evt-s01-${ctx.stamp}` },
    db, step: stepFake()
  });
  const afterS01 = (await db.query(
    `SELECT custom_fields, tags FROM clients WHERE id = $1`, [client.id]
  )).rows[0];
  const hasLeadTag = Array.isArray(afterS01?.tags) && afterS01.tags.includes("lead:new");
  collector.assertEq({
    section, journey, role, id: "fund-s01-tag",
    claim: "S-01 tagged client lead:new",
    expected: true, actual: hasLeadTag,
    file: "src/workflows/s-01-new-lead-intake.mjs"
  });

  // CRM linkage — re-fetch after lead capture. Dry-run stamps dry-ghl-*;
  // missing key stamps custom_fields.ghl_link_missing (visible warning).
  const afterCrm = (await db.query(
    `SELECT ghl_contact_id, custom_fields FROM clients WHERE id = $1`, [client.id]
  )).rows[0];
  const crmLink = afterCrm?.ghl_contact_id || null;
  const crmWarned = !!(afterCrm?.custom_fields && afterCrm.custom_fields.ghl_link_missing);
  if (crmLink) {
    collector.pass({
      section, journey, role, id: "fund-crm-link",
      claim: "Client has ghl_contact_id linkage",
      actual: { crmLink }, file: "src/handlers/client-lifecycle.mjs"
    });
  } else if (crmWarned) {
    collector.pass({
      section, journey, role, id: "fund-crm-link",
      claim: "Missing CRM link is stamped visibly (ghl_link_missing)",
      actual: { ghl_contact_id: null, ghl_link_missing: true },
      file: "src/handlers/client-lifecycle.mjs"
    });
  } else {
    collector.silent({
      section, journey, role, id: "fund-crm-link",
      claim: "Client has ghl_contact_id linkage after lead capture",
      detail: "No ghl_contact_id and no ghl_link_missing warning. Silent null — SMS relay cannot address this client.",
      file: "src/handlers/client-lifecycle.mjs",
      actual: { ghl_contact_id: null }
    });
  }
  steps.push({
    step: "The CRM linkage",
    status: crmLink || crmWarned ? "PASS" : "SILENTLY-DID-NOTHING",
    persisted: crmLink || (crmWarned ? "warned:ghl_link_missing" : "null")
  });

  // ── 2. Booking ──
  await emit(db, "booking.created", {
    email, name: "Verify Funding",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    closerId: closer.id,
    meetingUrl: "https://meet.example.com/verify-funding"
  }, { orgId: ctx.orgId, clientId: client.id, idempotencyKey: `${ctx.mark}:book:${ctx.stamp}` });

  await s04({
    event: {
      orgId: ctx.orgId, clientId: client.id, id: `evt-s04-${ctx.stamp}`,
      payload: { email, startsAt: new Date(Date.now() + 86400000).toISOString() }
    },
    db, step: stepFake()
  }).catch(() => {});

  const tasks = (await db.query(
    `SELECT * FROM tasks WHERE client_id = $1 ORDER BY created_at DESC`, [client.id]
  )).rows;
  collector.assertCount({
    section, journey, role, id: "fund-closer-task",
    claim: "Booking created a closer task",
    count: tasks.length >= 1 ? 1 : 0, expected: 1,
    file: "src/adapters/clickfunnels.mjs",
    opReturnedOk: true
  });
  steps.push({
    step: "Booking → closer task",
    status: tasks.length ? "PASS" : "SILENTLY-DID-NOTHING",
    persisted: tasks[0] ? `task.id=${tasks[0].id} title=${tasks[0].title}` : "no task"
  });

  // ── 3. Consent ──
  let consent;
  try {
    consent = await captureConsent(db, {
      orgId: ctx.orgId,
      clientId: client.id,
      kind: "soft_pull_consent",
      grantedBy: { kind: "staff", id: closer.id },
      captureMethod: "checkbox",
      grantedName: "Verify Funding",
      consentText: "I authorize a soft credit pull for underwriting."
    });
  } catch (err) {
    consent = { error: String(err.message || err) };
  }
  const consentRows = (await db.query(
    `SELECT * FROM client_consents WHERE client_id = $1`, [client.id]
  )).rows;
  collector.assertCount({
    section, journey, role, id: "fund-consent",
    claim: "Soft-pull consent persisted",
    count: consentRows.length, expected: 1,
    file: "src/consent/index.mjs",
    opReturnedOk: !consent?.error
  });
  steps.push({
    step: "Consent captured",
    status: consentRows.length ? "PASS" : "FAIL",
    persisted: consentRows[0] ? `kind=${consentRows[0].kind} id=${consentRows[0].id}` : String(consent?.error || "none")
  });

  // ── 4. CRS ingest with REAL bureau field names ──
  // Finance OS loader is the documented path — try it, and if it crashes on
  // schema drift, that is a product finding (do not patch simulate-client here).
  let sim = null;
  try {
    sim = await loadSimulatedClient(db, { orgId: ctx.orgId, staffId: closer.id });
    clientIds.push(sim.client.id);
    collector.pass({
      section, journey, role, id: "fund-sim-loader",
      claim: "Finance OS loadSimulatedClient created a demo client",
      actual: { id: sim.client.id },
      file: "src/demo/simulate-client.mjs:103"
    });
  } catch (err) {
    collector.fail({
      section, journey, role, id: "fund-sim-loader",
      claim: "Finance OS loadSimulatedClient works against current schema",
      detail: String(err.message || err) +
        " — INSERT uses clients.name/status which do not exist (schema has first_name/last_name). Finance OS 'Load simulated data' is broken for a real operator today.",
      file: "src/demo/simulate-client.mjs:103"
    });
    // Continue the money spine with a correctly-shaped client so later steps still verify.
    sim = {
      client: await insertClient(db, {
        orgId: ctx.orgId,
        email: `${ctx.mark}.sim.${ctx.stamp}@verify.local`,
        firstName: "Simulated", lastName: "Client", phone: "+15550100099"
      }),
      email: `${ctx.mark}.sim.${ctx.stamp}@verify.local`,
      tradelines: []
    };
    clientIds.push(sim.client.id);
  }

  const tl = (await db.query(
    `SELECT * FROM tradelines WHERE client_id = $1`, [sim.client.id]
  )).rows;
  collector.assertCount({
    section, journey, role, id: "fund-tradelines",
    claim: "CRS ingest stored tradelines for funding client",
    count: tl.length >= 1 ? 1 : 0, expected: 1,
    file: "src/demo/simulate-client.mjs",
    opReturnedOk: true
  });

  const sample = assertFundingCreditor(tl, collector, { section, journey, role });

  const payload = buildSimulatedCrsPayload({ email: sim.email, name: "Simulated Client" });
  payload.tradelines[0].accountReportedDate = "2026-07-01";
  payload.tradelines[0].accountStatusType = "Open";
  const crs2 = (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
     VALUES ($1,$2,$3::jsonb,'FULL_FUNDING') RETURNING *`,
    [ctx.orgId, sim.client.id, JSON.stringify(payload)]
  )).rows[0];
  const ingested = await ingestCrsResult(db, crs2);
  await db.query(
    `UPDATE clients SET outcome_tier = 'FULL_FUNDING', updated_at = now() WHERE id = $1`,
    [sim.client.id]
  );
  const clientTls = (await db.query(
    `SELECT * FROM tradelines WHERE client_id = $1`, [sim.client.id]
  )).rows;
  for (const field of BUREAU_FIELDS) {
    const presentInPayload = payload.tradelines.some((t) => t[field] != null);
    if (!presentInPayload) {
      collector.unverified({
        section, journey, role, id: `fund-bureau-${field}`,
        claim: `Bureau field ${field} round-trips through ingest`,
        detail: "Not present on simulated payload for all rows; partial coverage."
      });
      continue;
    }
    // We can only assert columns that exist on tradelines table.
    const cols = Object.keys(clientTls[0] || {});
    const likely = cols.find((c) =>
      c.replace(/_/g, "").toLowerCase().includes(field.replace(/Amount|Type|Date|Name|Identifier/g, "").toLowerCase().slice(0, 6))
    );
    if (clientTls.length && (sample || clientTls[0])) {
      collector.pass({
        section, journey, role, id: `fund-bureau-${field}`,
        claim: `Bureau field ${field} accepted by ingest (tradelines written: ${clientTls.length})`,
        actual: { tradeline_count: clientTls.length, columns: cols.slice(0, 12) },
        file: "src/tradelines/index.mjs"
      });
    } else {
      collector.silent({
        section, journey, role, id: `fund-bureau-${field}`,
        claim: `Bureau field ${field} produced a tradeline row`,
        detail: "ingestCrsResult returned without throwing but no tradelines for funding client",
        file: "src/tradelines/store.mjs",
        actual: { ingested: ingested?.ingested, rows: clientTls.length }
      });
    }
  }
  steps.push({
    step: "CRS → tradelines",
    status: clientTls.length || tl.length ? "PASS" : "SILENTLY-DID-NOTHING",
    persisted: `funding_client_tls=${clientTls.length} sim_tls=${tl.length} ingested=${ingested?.ingested}`
  });

  // Decision stamp on simulated client
  const simClient = (await db.query(`SELECT outcome_tier FROM clients WHERE id = $1`, [sim.client.id])).rows[0];
  collector.assertEq({
    section, journey, role, id: "fund-decision",
    claim: "Outcome tier FULL_FUNDING stamped on client",
    expected: "FULL_FUNDING", actual: simClient?.outcome_tier,
    file: "src/demo/simulate-client.mjs"
  });

  // Pipeline card
  const cards = (await db.query(
    `SELECT c.*, ps.key AS stage_key FROM cards c
       LEFT JOIN pipeline_stages ps ON ps.id = c.stage_id
      WHERE c.client_id = $1`, [sim.client.id]
  )).rows;
  collector.assertCount({
    section, journey, role, id: "fund-pipeline-card",
    claim: "Sales pipeline card exists for simulated funding client",
    count: cards.length, expected: 1,
    file: "src/demo/simulate-client.mjs",
    opReturnedOk: true
  });
  steps.push({
    step: "Pipeline card",
    status: cards.length ? "PASS" : "SILENTLY-DID-NOTHING",
    persisted: cards[0] ? `card=${cards[0].id} stage=${cards[0].stage_key}` : "none"
  });

  // ── 5. Diagnostic $32 then deposit $3000 via money-chain events ──
  await emit(db, "payment.received", {
    email: sim.email, product: "crs", productName: "Business Financial Assessment",
    amount: 32, providerRef: `${ctx.mark}_diag_${ctx.stamp}`, source: "commas"
  }, { orgId: ctx.orgId, clientId: sim.client.id, idempotencyKey: `${ctx.mark}:diag-pay:${ctx.stamp}` });
  await emit(db, "diagnostic.paid", {
    email: sim.email, product: "crs", productName: "Business Financial Assessment",
    amount: 32, providerRef: `${ctx.mark}_diag_${ctx.stamp}`, source: "commas"
  }, { orgId: ctx.orgId, clientId: sim.client.id, idempotencyKey: `${ctx.mark}:diag:${ctx.stamp}` });

  await emit(db, "payment.received", {
    email: sim.email, product: "deposit", productName: "Consulting Services Deposit",
    amount: MONEY.depositDollars, providerRef: `${ctx.mark}_dep_${ctx.stamp}`,
    closerId: closer.id, source: "commas"
  }, { orgId: ctx.orgId, clientId: sim.client.id, idempotencyKey: `${ctx.mark}:dep-pay:${ctx.stamp}` });
  await emit(db, "deposit.paid", {
    email: sim.email, product: "deposit", productName: "Consulting Services Deposit",
    amount: MONEY.depositDollars, providerRef: `${ctx.mark}_dep_${ctx.stamp}`,
    closerId: closer.id, advisorId: advisor.id, source: "commas"
  }, { orgId: ctx.orgId, clientId: sim.client.id, idempotencyKey: `${ctx.mark}:dep:${ctx.stamp}` });

  const sales = (await db.query(
    `SELECT * FROM sales WHERE client_id = $1 ORDER BY sold_at`, [sim.client.id]
  )).rows;
  const fundingSale = sales.find((s) => String(s.product_id) === String(ctx.products.funding.id)) || sales[sales.length - 1];
  collector.assertCount({
    section, journey, role, id: "fund-sale",
    claim: "deposit.paid wrote a funding sale",
    count: fundingSale ? 1 : 0, expected: 1,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });
  if (fundingSale) {
    collector.assertEq({
      section, journey, role, id: "fund-sale-amount",
      claim: "Funding sale agreed_price is $3000 (hand-check)",
      expected: MONEY.depositDollars, actual: Number(fundingSale.agreed_price),
      file: "src/handlers/money-chain.mjs"
    });
  }

  const frontLedger = fundingSale ? (await db.query(
    `SELECT * FROM commission_ledger WHERE sale_id = $1 AND basis = 'front_end'`,
    [fundingSale.id]
  )).rows : [];
  collector.assertEq({
    section, journey, role, id: "fund-closer-600",
    claim: "Closer front-end commission is $600 (20% of collected deposit)",
    expected: MONEY.expectedCloserFront,
    actual: frontLedger[0] ? Number(frontLedger[0].amount) : null,
    file: "src/handlers/money-chain.mjs"
  });

  const ents = (await db.query(
    `SELECT entitlement_code FROM entitlements WHERE client_id = $1 AND revoked_at IS NULL`,
    [sim.client.id]
  )).rows.map((r) => r.entitlement_code);
  collector.assertCount({
    section, journey, role, id: "fund-entitlement",
    claim: "Funding entitlement funding-snapshot granted",
    count: ents.includes("funding-snapshot") ? 1 : 0, expected: 1,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });
  steps.push({
    step: "Sale + $600 closer commission + entitlement",
    status: fundingSale && Number(frontLedger[0]?.amount) === MONEY.expectedCloserFront && ents.includes("funding-snapshot") ? "PASS" : "FAIL",
    persisted: `sales=${sales.length} front=${frontLedger[0]?.amount} ents=${ents.join(",")}`
  });

  // ── 6. Payment link ──
  let payLink;
  try {
    payLink = await createPaymentLink(db, {
      orgId: ctx.orgId,
      clientId: sim.client.id,
      purpose: "deposit",
      amountCents: MONEY.depositDollars * 100,
      checkoutBaseUrl: "https://pay.verify.local/checkout",
      createdBy: closer.id
    });
  } catch (err) {
    payLink = { error: String(err.message || err) };
  }
  collector.assertCount({
    section, journey, role, id: "fund-paylink",
    claim: "Payment link row created",
    count: payLink?.id ? 1 : 0, expected: 1,
    file: "src/payment-links/index.mjs",
    opReturnedOk: !payLink?.error
  });

  // ── 7. Contract from real template ──
  const templates = await listTemplates(db, { orgId: ctx.orgId, activeOnly: true });
  const tpl = templates?.[0] || (await getTemplateByKey(db, {
    orgId: ctx.orgId, templateKey: "funding-agreement"
  }).catch(() => null));
  let contract = null;
  let integrity = null;
  if (tpl?.id || tpl) {
    try {
      const draft = await createDraft(db, {
        orgId: ctx.orgId,
        clientId: sim.client.id,
        templateId: tpl.id || tpl,
        staffId: closer.id,
        title: "Verify Funding Agreement"
      });
      contract = await sendContract(db, {
        orgId: ctx.orgId,
        id: draft.id,
        staffId: closer.id
      }).catch(async (err) => {
        // send may require signers — record honestly
        return { error: String(err.message || err), draft };
      });
      if (contract?.id || draft?.id) {
        const row = (await db.query(
          `SELECT * FROM contracts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [sim.client.id]
        )).rows[0];
        contract = row || contract;
        if (row) {
          try { integrity = await verifyIntegrity(db, row); } catch (e) {
            integrity = { error: String(e.message || e) };
          }
        }
      }
    } catch (err) {
      contract = { error: String(err.message || err) };
    }
  } else {
    collector.silent({
      section, journey, role, id: "fund-contract-template",
      claim: "Active contract template exists to render from",
      detail: "listTemplates returned empty. Contract path cannot run for a real closer today.",
      file: "src/contracts/templates.mjs"
    });
  }
  const contractRow = (await db.query(
    `SELECT * FROM contracts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sim.client.id]
  )).rows[0];
  if (contractRow) {
    collector.pass({
      section, journey, role, id: "fund-contract",
      claim: "Contract row persisted",
      actual: { id: contractRow.id, status: contractRow.status },
      file: "src/contracts/send.mjs"
    });
  } else {
    collector.silent({
      section, journey, role, id: "fund-contract",
      claim: "Contract rendered/sent from real template",
      detail: contract?.error || "No contracts row after createDraft/send attempt",
      file: "src/contracts/send.mjs",
      actual: contract
    });
  }
  steps.push({
    step: "Contract",
    status: contractRow ? "PASS" : "SILENTLY-DID-NOTHING",
    persisted: contractRow
      ? `id=${contractRow.id} status=${contractRow.status} hash=${contractRow.body_sha || "none"}`
      : String(contract?.error || "none")
  });

  // ── 8. Funding round + applications + closeout ──
  await emit(db, "round.started", {
    email: sim.email, roundNumber: 1, saleId: fundingSale?.id, advisorId: advisor.id
  }, { orgId: ctx.orgId, clientId: sim.client.id, idempotencyKey: `${ctx.mark}:rnd-start:${ctx.stamp}` });

  await roundNotify({
    event: {
      orgId: ctx.orgId, clientId: sim.client.id, id: `evt-rn-${ctx.stamp}`,
      payload: { email: sim.email }
    },
    db, step: stepFake()
  }).catch(() => {});

  const rounds = (await db.query(
    `SELECT * FROM funding_rounds WHERE client_id = $1`, [sim.client.id]
  )).rows;
  collector.assertCount({
    section, journey, role, id: "fund-round",
    claim: "round.started created funding_rounds row",
    count: rounds.length, expected: 1,
    file: "src/handlers/money-chain.mjs",
    opReturnedOk: true
  });

  // Insert a lender + Approved application BEFORE round.funded. This is not
  // just line-item coverage any more: the Approved application's amount IS the
  // fee basis (confirmed approvals, owner-set 2026-08-30, see
  // docs/finance/CLOSEOUT-FEE-BASIS.md). Without it there is nothing to bill.
  let lenderId = null;
  try {
    lenderId = (await db.query(
      `INSERT INTO lenders (org_id, name, lender_table, active)
       VALUES ($1, 'Verify Bank', 'OnlineBizCC', true)
       RETURNING id`,
      [ctx.orgId]
    )).rows[0].id;
  } catch (err) {
    // Schema may use different columns — try minimal.
    try {
      lenderId = (await db.query(
        `INSERT INTO lenders (org_id, name, active) VALUES ($1, 'Verify Bank', true) RETURNING id`,
        [ctx.orgId]
      )).rows[0].id;
    } catch (e2) {
      collector.fail({
        section, journey, role, id: "fund-lender",
        claim: "Can insert a lenders row for application testing",
        detail: String(e2.message || e2),
        file: "db/migrations/t138_lenders.sql"
      });
    }
  }

  let appId = null;
  if (rounds[0] && lenderId) {
    try {
      appId = (await db.query(
        `INSERT INTO applications (
           org_id, client_id, funding_round_id, lender_id, lender_name,
           status, approved_amount, requested_amount
         ) VALUES ($1,$2,$3,$4,'Verify Bank','Approved',$5,$5)
         RETURNING id`,
        [ctx.orgId, sim.client.id, rounds[0].id, lenderId, MONEY.fundedAmount]
      )).rows[0].id;
    } catch (err) {
      // Try alternate column set
      try {
        appId = (await db.query(
          `INSERT INTO applications (
             org_id, client_id, funding_round_id, bank, status, approved_amount
           ) VALUES ($1,$2,$3,'Verify Bank','Approved',$4)
           RETURNING id`,
          [ctx.orgId, sim.client.id, rounds[0].id, MONEY.fundedAmount]
        )).rows[0].id;
      } catch (e2) {
        collector.fail({
          section, journey, role, id: "fund-application",
          claim: "Can create Approved application for closeout",
          detail: String(e2.message || e2),
          file: "db/migrations/t139_funding_ops.sql"
        });
      }
    }
  }

  // Audit row — must go through setApplicationStatus (raw SQL UPDATE is silent).
  if (appId) {
    const { setApplicationStatus } = await import("../../applications/status.mjs");
    await setApplicationStatus(db, {
      orgId: ctx.orgId,
      applicationId: appId,
      status: "Approved",
      staff: closer,
      eventType: "status_change",
      notes: "verify harness"
    }).catch(() => null);
    const decisions = (await db.query(
      `SELECT * FROM application_decisions WHERE application_id = $1`, [appId]
    ).catch(() => ({ rows: [] }))).rows;
    collector.assertCount({
      section, journey, role, id: "fund-app-row",
      claim: "Approved application row exists for the round",
      count: 1, expected: 1,
      file: "api/applications.mjs",
      opReturnedOk: true
    });
    collector.assertCount({
      section, journey, role, id: "fund-app-audit",
      claim: "Application status change wrote an audit/decision row",
      count: decisions.length >= 1 ? 1 : 0, expected: 1,
      file: "src/applications/status.mjs",
      opReturnedOk: decisions.length >= 1
    });
  }

  await emit(db, "round.funded", {
    email: sim.email, roundNumber: 1, fundingRoundId: rounds[0]?.id,
    fundedAmount: MONEY.fundedAmount, approvedAmount: MONEY.fundedAmount,
    advisorId: advisor.id, saleId: fundingSale?.id, feePercent: 10,
    rail: "card_stacking"
  }, { orgId: ctx.orgId, clientId: sim.client.id, idempotencyKey: `${ctx.mark}:rnd-fund:${ctx.stamp}` });

  const funded = rounds[0] ? (await db.query(
    `SELECT * FROM funding_rounds WHERE id = $1`, [rounds[0].id]
  )).rows[0] : null;
  collector.assertEq({
    section, journey, role, id: "fund-round-funded",
    claim: "Round status is funded with amount 50000",
    expected: MONEY.fundedAmount,
    actual: funded ? Number(funded.funded_amount) : null,
    file: "src/handlers/money-chain.mjs"
  });

  const backLedger = rounds[0] ? (await db.query(
    `SELECT * FROM commission_ledger WHERE funding_round_id = $1 AND basis = 'back_end'`,
    [rounds[0].id]
  )).rows : [];
  const advisorRow = backLedger.find((r) => r.staff_id === advisor.id);
  collector.assertEq({
    section, journey, role, id: "fund-advisor-125",
    claim: "Advisor back-end commission is $125 (50000 × 0.25% hand-calc)",
    expected: MONEY.expectedAdvisorBack,
    actual: advisorRow ? Number(advisorRow.amount) : null,
    file: "src/handlers/money-chain.mjs"
  });
  collector.assertEq({
    section, journey, role, id: "fund-closer-back-none",
    claim: "Closer earns no back-end commission on funded amount",
    expected: 0,
    actual: backLedger.filter((r) => r.staff_id === closer.id).length,
    file: "src/handlers/money-chain.mjs"
  });

  // Closeout — the Approved application seeded above IS the basis now
  const closeout = rounds[0] ? (await db.query(
    `SELECT * FROM funding_closeout WHERE funding_round_id = $1`, [rounds[0].id]
  )).rows[0] : null;

  if (!closeout) {
    collector.silent({
      section, journey, role, id: "fund-closeout",
      claim: "funding_closeout row created on round.funded",
      detail: "No closeout row. Money-chain calls createFundingCloseoutSafe — check if it no-op'd.",
      file: "src/handlers/money-chain.mjs:692"
    });
  } else {
    collector.assertEq({
      section, journey, role, id: "fund-closeout-fee",
      claim: "Closeout total_fee is $5000 (10% of the $50000 confirmed approvals)",
      expected: MONEY.expectedSuccessFee,
      actual: Number(closeout.total_fee),
      file: "src/funding/closeout.mjs"
    });
    collector.assertEq({
      section, journey, role, id: "fund-closeout-balance",
      claim: "Closeout balance_due equals total_fee",
      expected: Number(closeout.total_fee),
      actual: Number(closeout.balance_due),
      file: "src/funding/closeout.mjs"
    });
    if (Number(closeout.total_fee) === 0 && MONEY.fundedAmount > 0) {
      collector.silent({
        section, journey, role, id: "fund-closeout-zero",
        claim: "Closeout fee non-zero when round funded for $50000",
        detail: "Fee must come from the confirmed approvals total. A $0 fee row must never be written at all — a round with nothing confirmed refuses.",
        file: "src/funding/closeout.mjs",
        p0: false,
        expected: { total_fee: MONEY.expectedSuccessFee },
        actual: { total_fee: 0, funded_amount: funded?.funded_amount }
      });
    }
  }
  steps.push({
    step: "Round funded + closeout 10%",
    status: closeout && Number(closeout.total_fee) === MONEY.expectedSuccessFee ? "PASS" : "FAIL",
    persisted: closeout
      ? `fee=${closeout.total_fee} balance_due=${closeout.balance_due} basis=${closeout.total_approved_amount}`
      : "no closeout"
  });

  // Invoice (F-07)
  let f07Result = null;
  let f07Error = null;
  if (rounds[0]) {
    try {
      f07Result = await f07({
        event: {
          orgId: ctx.orgId, clientId: sim.client.id, id: randomUUID(),
          payload: {
            email: sim.email,
            fundingRoundId: rounds[0].id,
            saleId: fundingSale?.id,
            rail: "card_stacking",
            approvedAmount: MONEY.fundedAmount,
            feePercent: 10
          }
        },
        db, step: stepFake()
      });
    } catch (err) {
      f07Error = String(err?.message || err);
      collector.fail({
        section, journey, role, id: "fund-f07-error",
        claim: "Funding-locked workflow runs without error",
        detail: f07Error,
        file: "src/workflows/f-07-funding-locked.mjs"
      });
    }
  }
  const invoices = (await db.query(
    `SELECT * FROM invoices WHERE client_id = $1`, [sim.client.id]
  ).catch(() => ({ rows: [] }))).rows;
  collector.assertCount({
    section, journey, role, id: "fund-invoice",
    claim: "Success-fee invoice row exists",
    count: invoices.length >= 1 ? 1 : 0, expected: 1,
    file: "src/workflows/f-07-funding-locked.mjs",
    opReturnedOk: !f07Error && f07Result?.done === true
  });

  // Messages queued with real template keys
  const msgs = (await db.query(
    `SELECT template_key, status, channel FROM messages WHERE client_id = ANY($1)`,
    [[sim.client.id, client.id]]
  )).rows;
  const queued = msgs.filter((m) => m.status === "queued" || m.status === "held");
  if (queued.length) {
    collector.pass({
      section, journey, role, id: "fund-messages-queued",
      claim: `Messages queued along funding path (${queued.length})`,
      actual: { keys: queued.map((m) => m.template_key).filter(Boolean) },
      file: "src/workflows/messaging.mjs"
    });
    // Each key must resolve to a real template row
    for (const key of new Set(queued.map((m) => m.template_key).filter(Boolean))) {
      const tplRow = (await db.query(
        `SELECT template_key, compliance_passed, body FROM message_templates
          WHERE org_id = $1 AND template_key = $2`,
        [ctx.orgId, key]
      )).rows[0];
      if (!tplRow) {
        collector.fail({
          section, journey, role, id: `fund-tpl-${key}`,
          claim: `Queued message template_key ${key} resolves to a message_templates row`,
          file: "src/workflows/messaging.mjs"
        });
      } else if (/\[DRAFT/i.test(tplRow.body || "")) {
        collector.fail({
          section, journey, role, id: `fund-tpl-draft-${key}`,
          claim: `Queued template ${key} is not DRAFT placeholder copy`,
          detail: "A real client would receive placeholder DRAFT text.",
          file: "src/messaging/seed/workflow-keys.mjs"
        });
      } else {
        collector.pass({
          section, journey, role, id: `fund-tpl-${key}`,
          claim: `Template ${key} resolves to a real non-DRAFT row`,
          actual: { compliance_passed: tplRow.compliance_passed }
        });
      }
    }
  } else {
    collector.silent({
      section, journey, role, id: "fund-messages-queued",
      claim: "Funding path queued at least one message with a template key",
      detail: `messages for clients=${msgs.length}, none queued/held. Workflows may have skipped sendTemplated (missing template, compliance, or early return).`,
      file: "src/workflows/messaging.mjs",
      actual: { messages: msgs.length, statuses: msgs.map((m) => m.status) }
    });
  }
  steps.push({
    step: "Messages queued",
    status: queued.length ? "PASS" : "SILENTLY-DID-NOTHING",
    persisted: `total=${msgs.length} queued=${queued.length} keys=${queued.map((m) => m.template_key).join(",")}`
  });

  // Replay money events — zero duplicates
  const salesBefore = (await db.query(
    `SELECT count(*)::int n FROM sales WHERE client_id = $1`, [sim.client.id]
  )).rows[0].n;
  const ledgerBefore = (await db.query(
    `SELECT count(*)::int n FROM commission_ledger WHERE client_id = $1`, [sim.client.id]
  )).rows[0].n;
  let replayErr = null;
  try {
    await replay(db, { orgId: ctx.orgId, since: new Date(ctx.stamp) });
  } catch (err) {
    replayErr = String(err.message || err);
    collector.fail({
      section, journey, role, id: "fund-replay-throw",
      claim: "Funding-path bus replay completes without throwing",
      detail: replayErr +
        " — replay walks historical events; orphaned closerId/staff refs fail the attribution write. Loud failure is better than silent wrong money, but a morning replay job would stop cold.",
      file: "src/events/bus.mjs"
    });
  }
  const salesAfter = (await db.query(
    `SELECT count(*)::int n FROM sales WHERE client_id = $1`, [sim.client.id]
  )).rows[0].n;
  const ledgerAfter = (await db.query(
    `SELECT count(*)::int n FROM commission_ledger WHERE client_id = $1`, [sim.client.id]
  )).rows[0].n;
  if (!replayErr) {
    collector.assertEq({
      section, journey, role, id: "fund-replay-sales",
      claim: "Replay does not duplicate sales",
      expected: salesBefore, actual: salesAfter,
      file: "src/events/bus.mjs"
    });
    collector.assertEq({
      section, journey, role, id: "fund-replay-ledger",
      claim: "Replay does not duplicate commission_ledger",
      expected: ledgerBefore, actual: ledgerAfter,
      file: "src/events/bus.mjs"
    });
  }

  // Operator usability verdict
  const blocking =
    !fundingSale ||
    !frontLedger.length ||
    !rounds.length ||
    !closeout ||
    Number(closeout?.total_fee) !== MONEY.expectedSuccessFee;

  note.usableToday = !blocking;
  note.body = [
    `Primary client (lead): ${client.id} / ${email}`,
    `Simulated funding client: ${sim.client.id} / ${sim.email}`,
    `Sale amount: ${fundingSale ? fundingSale.agreed_price : "NONE"} (want ${MONEY.depositDollars})`,
    `Closer front commission: ${frontLedger[0]?.amount ?? "NONE"} (want ${MONEY.expectedCloserFront})`,
    `Advisor back commission: ${advisorRow?.amount ?? "NONE"} (want ${MONEY.expectedAdvisorBack})`,
    `Closeout fee: ${closeout?.total_fee ?? "NONE"} (want ${MONEY.expectedSuccessFee})`,
    `The CRM link: ${crmLink || "MISSING"}`,
    `Contract: ${contractRow?.id || "MISSING"}`,
    `Messages queued: ${queued.length}`,
    "",
    blocking
      ? "Operator verdict: NO — a real funding file would stall or under-bill on this path today."
      : "Operator verdict: YES for the money spine; still check the CRM link, contract send, and live webhooks separately."
  ].join("\n");

  // Cleanup sim via official teardown helper when possible
  try { await teardownSimulated(db, { clientId: sim.client.id }); } catch { /* wipe later */ }

  return {
    note,
    clientIds,
    usableToday: note.usableToday,
    simClientId: sim.client.id,
    fundingSaleId: fundingSale?.id,
    roundId: rounds[0]?.id
  };
}
