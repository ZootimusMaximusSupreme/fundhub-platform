import { activatePaidBlueprintTakeover } from "./managed-round.mjs";
import { randomUUID } from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";
import { createTask } from "../lib/create-task.mjs";
import { getOffer } from "../config/offers.mjs";
import { priceDisputeRound } from "../waypoints/pricing.mjs";
import { softPullBaseCents } from "../finance/soft-pull-pricing.mjs";
import { requestSoftPull } from "../finance/soft-pulls.mjs";
import { mintCheckoutLink, checkoutExpiresAt } from "../paid-services/checkout.mjs";
import { readBlueprintReportAllowance } from "./report-allowance.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = ["inquiry_removal", "repair_round", "repair_full", "funding_round", "credit_pull"];
const SERVICE_SELECT = `SELECT s.*, p.status AS payment_status, p.price_total_cents,
  p.checkout_url, p.amount_paid_cents, p.payment_ref AS ledger_payment_ref, p.paid_at,
  p.idempotency_key FROM blueprint_client_services s JOIN paid_service_requests p ON p.id=s.id
  AND p.org_id=s.org_id AND p.client_id=s.client_id`;

export class BlueprintServiceError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new BlueprintServiceError(code, message, status); };

export function blueprintServiceTypes() {
  return [
    { key: "inquiry_removal", label: "Have Fundhub handle this inquiry case", priceCents: null, requiresQuote: true },
    { key: "repair_round", label: "Have Fundhub handle this repair round", priceCents: priceDisputeRound({}).totalCents, requiresQuote: true },
    { key: "repair_full", label: "Have Fundhub handle the full repair program", priceCents: getOffer("REPAIR_DFY").priceCents, requiresQuote: true },
    { key: "funding_round", label: "Have Fundhub handle this funding round", priceCents: null, requiresQuote: true },
    { key: "credit_pull", label: "An additional credit report", priceCents: softPullBaseCents(), requiresQuote: false }
  ];
}

function publicRequest(row) {
  const terminal = ["failed", "cancelled", "refunded"].includes(row.payment_status);
  const paidWaiting = row.payment_status === "paid" && ["quoted", "checkout_pending", "awaiting_payment"].includes(row.state);
  return {
    id: row.id, serviceKind: row.service_kind, scopeType: row.scope_type, targetId: row.target_id, roundKey: row.round_key || null,
    status: terminal ? row.payment_status : paidWaiting ? "paid" : row.state,
    priceCents: row.price_total_cents == null ? null : Number(row.price_total_cents),
    checkoutUrl: row.payment_status === "awaiting_payment" && row.state === "awaiting_payment" ? row.checkout_url || null : null,
    paymentState: row.payment_status,
    note: row.note || null, requestedAt: row.created_at,
    taskId: row.fulfillment_task_id || null, reportRequestId: row.soft_pull_request_id || null
  };
}

export async function readActiveBlueprintServices(db, { orgId, clientId, engagementId }) {
  const result = await db.query(`${SERVICE_SELECT}
    WHERE s.org_id=$1 AND s.client_id=$2 AND s.engagement_id=$3
      AND s.state IN ('paid','in_progress') AND p.status IN ('paid','staged','fulfilled')
      AND p.payment_ref IS NOT NULL AND p.amount_paid_cents=p.price_total_cents`, [orgId, clientId, engagementId]);
  return result.rows.map(publicRequest);
}

export async function readBlueprintServiceOversight(db, { orgId }, { limit = 50, offset = 0 } = {}) {
  const pageSize = Math.max(1, Math.min(Math.trunc(Number(limit)) || 50, 100));
  const start = Math.max(0, Math.min(Math.trunc(Number(offset)) || 0, 10000));
  const result = await db.query(`SELECT e.id,e.client_id,e.status,e.execution_owner,
    NULLIF(btrim(concat_ws(' ',c.first_name,c.last_name)),'') AS client_name,c.client_code,
    (SELECT count(*)::int FROM tasks t WHERE t.org_id=e.org_id AND t.client_id=e.client_id AND t.done=false) AS open_tasks,
    (SELECT count(*)::int FROM blueprint_client_services s WHERE s.engagement_id=e.id AND s.org_id=e.org_id
      AND s.state<>'completed') AS help_requests,
    GREATEST(c.updated_at,e.created_at,(SELECT max(s.updated_at) FROM blueprint_client_services s WHERE s.engagement_id=e.id AND s.org_id=e.org_id)) AS last_activity_at
    FROM blueprint_fulfillment_engagements e JOIN clients c ON c.id=e.client_id AND c.org_id=e.org_id
    JOIN entitlements ent ON ent.id=e.source_entitlement_id AND ent.org_id=e.org_id AND ent.client_id=e.client_id
    JOIN transactions purchase ON purchase.id=e.source_transaction_id AND purchase.org_id=e.org_id AND purchase.client_id=e.client_id
    WHERE e.org_id=$1 AND e.status='active' AND ent.revoked_at IS NULL
      AND (ent.expires_at IS NULL OR ent.expires_at>now()) AND lower(btrim(purchase.status))='succeeded'
      AND c.custom_fields->>'crm_archived_at' IS NULL
    ORDER BY last_activity_at ASC,e.id LIMIT $2 OFFSET $3`, [orgId, pageSize + 1, start]);
  return { ok: true, clients: result.rows.slice(0, pageSize).map(row => ({ clientId: row.client_id,
    clientName: row.client_name || row.client_code || null, engagementId: row.id, status: row.status,
    executionOwner: row.execution_owner, openTasks: row.open_tasks, helpRequests: row.help_requests,
    lastActivityAt: row.last_activity_at })), limit: pageSize, offset: start, hasMore: result.rows.length > pageSize };
}

export async function readBlueprintClientServices(db, scope) {
  const result = await db.query(`${SERVICE_SELECT} WHERE s.org_id=$1 AND s.client_id=$2 AND s.engagement_id=$3
    ORDER BY s.created_at DESC LIMIT 100`, [scope.orgId, scope.clientId, scope.engagement.id]);
  const allowance = await readBlueprintReportAllowance(db, scope);
  const targets = await blueprintServiceTargets(db, scope);
  let oversight = null;
  if (scope.staffId) {
    const progress = await db.query(`SELECT id,title,state,state_reason,due_at FROM client_waypoints
      WHERE org_id=$1 AND client_id=$2 AND state IN ('not_started','in_progress','blocked')
      ORDER BY position,created_at LIMIT 20`, [scope.orgId, scope.clientId]);
    oversight = { openSteps: progress.rows.map(row => ({ id: row.id, title: row.title, status: row.state, reason: row.state_reason, dueAt: row.due_at })) };
  }
  return { ok: true, engagement: { id: scope.engagement.id, status: scope.engagement.status, roundId: scope.engagement.roundId },
    allowance, serviceTypes: blueprintServiceTypes().map(type => ({ ...type, targets: targets[type.key] })), requests: result.rows.map(publicRequest), oversight,
    capabilities: { requestHelp: scope.engagement.status === "active" && !scope.staffId,
      requestReport: scope.engagement.status === "active" && !scope.staffId, quote: !!scope.staffId } };
}

async function blueprintServiceTargets(db, scope) {
  const [inquiries, repairs] = await Promise.all([
    db.query(`SELECT id,case_id,selected_bureaus_raw FROM inquiry_removal_cases
      WHERE org_id=$1 AND client_id=$2 AND case_status IN ('Queued','Scheduled','In Progress','Escalated','Blocked') ORDER BY created_at DESC`, [scope.orgId, scope.clientId]),
    db.query(`SELECT DISTINCT ON (round) id,round FROM dispute_cases
      WHERE org_id=$1 AND client_id=$2 AND status<>'closed' AND round~'^R[1-6]$' ORDER BY round,created_at DESC,id DESC`, [scope.orgId, scope.clientId])
  ]);
  return {
    inquiry_removal: inquiries.rows.map(row => ({ id: row.id, label: `${row.case_id}${row.selected_bureaus_raw ? ` — ${row.selected_bureaus_raw}` : ""}` })),
    repair_round: repairs.rows.map(row => ({ id: row.id, label: `Repair round ${row.round}`, roundKey: row.round })),
    repair_full: [{ id: scope.clientId, label: "Full repair program" }],
    funding_round: [{ id: scope.engagement.roundId || scope.engagement.id, label: "This purchased funding round" }],
    credit_pull: [{ id: scope.clientId, label: "Your current credit file" }]
  };
}

async function ownedRequest(db, scope, requestId, lock = false) {
  if (!UUID.test(requestId || "")) fail("request_not_found", "Choose a saved service request.", 404);
  const result = await db.query(`${SERVICE_SELECT} WHERE s.id=$1 AND s.org_id=$2 AND s.client_id=$3 AND s.engagement_id=$4
    ${lock ? "FOR UPDATE OF s, p" : ""}`, [requestId, scope.orgId, scope.clientId, scope.engagement.id]);
  if (!result.rows[0]) fail("request_not_found", "That service request could not be found.", 404);
  return result.rows[0];
}

async function serviceTarget(db, scope, kind, targetId) {
  if (kind === "credit_pull" || kind === "repair_full") return { scopeType: "client", targetId: scope.clientId };
  if (kind === "funding_round" && !scope.engagement.roundId) return { scopeType: "engagement", targetId: scope.engagement.id };
  if (kind === "funding_round") targetId = targetId || scope.engagement.roundId;
  if (!targetId) {
    const available = (await blueprintServiceTargets(db, scope))[kind];
    if (available.length !== 1) fail("target_required", "Choose the case or round this service will cover.", 400);
    targetId = available[0].id;
  }
  if (!UUID.test(targetId || "")) fail("target_required", "Choose the existing case or round for this work.", 400);
  const table = kind === "inquiry_removal" ? "inquiry_removal_cases" : kind === "repair_round" ? "dispute_cases" : "funding_rounds";
  const active = kind === "inquiry_removal" ? " AND case_status IN ('Queued','Scheduled','In Progress','Escalated','Blocked')" : kind === "repair_round" ? " AND status<>'closed'" : "";
  const result = await db.query(`SELECT id${kind === "repair_round" ? ",round" : ""} FROM ${table} WHERE id=$1 AND org_id=$2 AND client_id=$3${active}`, [targetId, scope.orgId, scope.clientId]);
  if (!result.rows[0] || (kind === "funding_round" && targetId !== scope.engagement.roundId)) {
    fail("target_not_found", "Choose work from this engagement.", 404);
  }
  return { scopeType: kind === "inquiry_removal" ? "inquiry_case" : kind === "repair_round" ? "dispute_case" : "funding_round", targetId, roundKey: kind === "repair_round" ? result.rows[0].round : null };
}

export async function requestBlueprintHelp(db, scope, input, { createTaskImpl = createTask } = {}) {
  if (scope.engagement.status !== "active") fail("engagement_completed", "This funding engagement is complete.");
  if ((!scope.accountId && !scope.staffId) || !KINDS.includes(input.serviceKind)) fail("invalid_service", "Choose one of the available services.", 400);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.idempotencyKey || "")) fail("request_key_required", "A request key is required.", 400);
  const target = await serviceTarget(db, scope, input.serviceKind, input.targetId);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1500) : null;
  const id = randomUUID();
  const key = `blueprint-help:${input.idempotencyKey}`;
  const out = await withTransaction(db, async tx => {
    await tx.query(`UPDATE blueprint_client_services s SET state=p.status,updated_at=now() FROM paid_service_requests p
      WHERE p.id=s.id AND s.org_id=$1 AND s.client_id=$2 AND p.status IN ('failed','cancelled','refunded')
        AND s.state NOT IN ('failed','cancelled','refunded')`, [scope.orgId, scope.clientId]);
    const existing = (await tx.query(`${SERVICE_SELECT} WHERE s.org_id=$1 AND s.client_id=$2
      AND (p.idempotency_key=$3 OR (s.engagement_id=$4 AND s.service_kind=$5 AND (s.target_id=$6 OR ($5='repair_round' AND s.round_key=$7))
        AND s.state IN ('requested','quoted','checkout_pending','awaiting_payment','paid','in_progress','needs_review') AND s.service_kind<>'credit_pull'))
      ORDER BY s.created_at DESC LIMIT 1`, [scope.orgId, scope.clientId, key, scope.engagement.id, input.serviceKind, target.targetId, target.roundKey || null])).rows[0];
    if (existing) {
      const sameTarget = existing.target_id === target.targetId || (input.serviceKind === "repair_round" && existing.round_key === target.roundKey);
      if (existing.engagement_id !== scope.engagement.id || existing.service_kind !== input.serviceKind || !sameTarget) fail("request_key_reused", "Use a new request key for different work.");
      return existing;
    }
    const price = input.serviceKind === "credit_pull" ? softPullBaseCents() : null;
    const components = price ? [{ code: "credit_pull", label: "Additional credit report", quantity: 1, unit_cents: price, amount_cents: price }] : [];
    await tx.query(`INSERT INTO paid_service_requests (id,org_id,client_id,service_kind,
      requested_by_kind,requested_by_account_id,requested_by_staff_id,status,price_components,price_total_cents,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'quoted',$8::jsonb,$9,$10)`,
    [id, scope.orgId, scope.clientId, input.serviceKind === "credit_pull" ? "credit_pull" : "blueprint_help",
      scope.staffId ? "staff" : "client", scope.staffId ? null : scope.accountId, scope.staffId || null, JSON.stringify(components), price, key]);
    await tx.query(`INSERT INTO blueprint_client_services (id,org_id,client_id,engagement_id,service_kind,scope_type,target_id,state,note,round_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, scope.orgId, scope.clientId, scope.engagement.id, input.serviceKind, target.scopeType, target.targetId, price ? "quoted" : "requested", note, target.roundKey || null]);
    await createTaskImpl(tx, { orgId: scope.orgId, clientId: scope.clientId, assigneeRole: "csm",
      title: input.serviceKind === "credit_pull" ? "Review requested additional credit report" : "Review Blueprint paid-help request",
      sourceWorkflow: "blueprint-client-service", eventId: `blueprint-service-review:${id}`,
      detail: `${input.serviceKind}; ${target.scopeType} ${target.targetId}. ${note || ""}` });
    return ownedRequest(tx, scope, id);
  }).catch(async error => {
    if (error.code !== "23505") throw error;
    const raced = (await db.query(`${SERVICE_SELECT} WHERE s.org_id=$1 AND s.client_id=$2 AND s.engagement_id=$3
      AND s.service_kind=$4 AND (s.target_id=$5 OR ($4='repair_round' AND s.round_key=$6)) ORDER BY s.created_at DESC LIMIT 1`,
    [scope.orgId, scope.clientId, scope.engagement.id, input.serviceKind, target.targetId, target.roundKey || null])).rows[0];
    if (!raced) fail("request_key_reused", "Use a new request key for this work.");
    return raced;
  });
  return { ok: true, request: publicRequest(out) };
}

export async function quoteBlueprintHelp(db, scope, input) {
  if (!scope.staffId) fail("forbidden", "A Fundhub team quote is required.", 403);
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0 || input.priceCents > 100000000) fail("invalid_price", "Enter the complete price in cents.", 400);
  return withTransaction(db, async tx => {
    const row = await ownedRequest(tx, scope, input.requestId, true);
    if (!["requested", "quoted"].includes(row.state) || row.payment_status !== "quoted") fail("quote_locked", "This quote has already been accepted or paid.");
    const components = [{ code: row.service_kind, label: blueprintServiceTypes().find(t => t.key === row.service_kind).label,
      quantity: 1, unit_cents: input.priceCents, amount_cents: input.priceCents }];
    await tx.query(`UPDATE paid_service_requests SET price_components=$2::jsonb,price_total_cents=$3 WHERE id=$1 AND status='quoted'`, [row.id, JSON.stringify(components), input.priceCents]);
    await tx.query(`UPDATE blueprint_client_services SET state='quoted',quote_staff_id=$2,quoted_at=now(),updated_at=now() WHERE id=$1`, [row.id, scope.staffId]);
    return { ok: true, request: publicRequest(await ownedRequest(tx, scope, row.id)) };
  });
}

export async function offerBlueprintHelp(db, scope, input, deps = {}) {
  if (!scope.staffId) fail("forbidden", "A Fundhub team quote is required.", 403);
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0 || input.priceCents > 100000000) fail("invalid_price", "Enter the complete price in cents.", 400);
  const requested = await requestBlueprintHelp(db, scope, input, deps);
  return quoteBlueprintHelp(db, scope, { requestId: requested.request.id, priceCents: input.priceCents });
}

export async function checkoutBlueprintHelp(db, scope, input, { mint = mintCheckoutLink } = {}) {
  if (!scope.accountId || input.authorization !== true) fail("authorization_required", "Confirm the saved service and its exact one-time price.", 400);
  const reservation = await withTransaction(db, async tx => {
    const current = await ownedRequest(tx, scope, input.requestId, true);
    if (current.checkout_url || current.state === "checkout_pending") return { row: current, claimed: false };
    if (current.state !== "quoted" || !Number(current.price_total_cents)) fail("quote_required", "The Fundhub team must save a price for this work first.");
    await serviceTarget(tx, scope, current.service_kind, current.target_id);
    await tx.query(`UPDATE blueprint_client_services SET state='checkout_pending',checkout_claimed_at=now(),
      authorized_account_id=$2,authorized_at=now(),updated_at=now() WHERE id=$1 AND state='quoted'`, [current.id, scope.accountId]);
    return { row: current, claimed: true };
  });
  let row = reservation.row;
  if (!reservation.claimed) return { ok: true, request: publicRequest(row) };
  let result;
  try { result = await mint({ requestId: row.id, orgId: scope.orgId, clientId: scope.clientId, amountCents: Number(row.price_total_cents) }); }
  catch { result = { ok: false, reason: "checkout_outcome_unknown" }; }
  if (!result?.ok || !result.checkoutUrl) {
    await db.query(`UPDATE blueprint_client_services SET state='needs_review',updated_at=now() WHERE id=$1 AND state='checkout_pending'`, [row.id]);
    fail("checkout_needs_review", "The checkout needs a team review before another attempt.");
  }
  await withTransaction(db, async tx => {
    await tx.query(`UPDATE paid_service_requests SET checkout_url=$2,status='awaiting_payment',checkout_expires_at=$3 WHERE id=$1 AND status='quoted'`,
      [row.id, result.checkoutUrl, checkoutExpiresAt(scope.now || new Date())]);
    await tx.query(`UPDATE blueprint_client_services SET state='awaiting_payment',updated_at=now() WHERE id=$1 AND state='checkout_pending'`, [row.id]);
  });
  row = await ownedRequest(db, scope, row.id);
  return { ok: true, request: publicRequest(row) };
}

export async function requestBlueprintReport(db, scope, input, deps = {}) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.idempotencyKey || "")) fail("request_key_required", "A request key is required.", 400);
  const allowance = await readBlueprintReportAllowance(db, scope);
  if (!allowance.includedAvailable) {
    const requested = await requestBlueprintHelp(db, scope, { ...input, serviceKind: "credit_pull" }, deps);
    return { ...requested, requiresPayment: true, allowance };
  }
  const requested = await (deps.requestPull || requestSoftPull)(db, {
    orgId: scope.orgId, clientId: scope.clientId, requestedBy: { kind: "client", accountId: scope.accountId },
    reason: "Included monthly Blueprint credit report", subscriptionId: scope.engagement.id,
    idempotencyKey: `blueprint-included:${scope.engagement.id}:${input.idempotencyKey}`
  });
  return { ok: true, requiresPayment: false, reportRequestId: requested.request?.id || null, allowance: await readBlueprintReportAllowance(db, scope) };
}

export async function fulfillPaidBlueprintHelp(db, { requestId, orgId }, { createTaskImpl = createTask, requestPull = requestSoftPull } = {}) {
  return withTransaction(db, async tx => {
    const result = await tx.query(`${SERVICE_SELECT} WHERE s.id=$1 AND s.org_id=$2 FOR UPDATE OF s,p`, [requestId, orgId]);
    const row = result.rows[0];
    if (!row) return { handled: false };
    if (!["paid", "staged"].includes(row.payment_status) || !row.ledger_payment_ref || !row.authorized_at || Number(row.amount_paid_cents) !== Number(row.price_total_cents)) {
      return { handled: true, ok: false, reason: "verified_exact_payment_required" };
    }
    if (["in_progress", "completed"].includes(row.state)) {
      if (row.state==="in_progress" && row.service_kind==="funding_round") {
        const lost=await tx.query("SELECT id FROM blueprint_fulfillment_engagements WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='active' AND funding_round_id IS NULL",
          [row.engagement_id,row.org_id,row.client_id]);
        if (lost.rowCount) await activatePaidBlueprintTakeover(tx,{orgId:row.org_id,clientId:row.client_id,engagementId:row.engagement_id,requestId:row.id});
      }
      return { handled: true, ok: true, replay: true };
    }
    const scope = { orgId: row.org_id, clientId: row.client_id };
    let taskId = null;
    let pullId = null;
    if (row.service_kind === "credit_pull") {
      const pull = await requestPull(tx, { ...scope, requestedBy: { kind: "client", accountId: row.authorized_account_id },
        reason: "Paid additional Blueprint credit report", idempotencyKey: `blueprint-service:${row.id}:real`, subscriptionId: row.engagement_id });
      // Another outstanding request belongs to its original purchaser.
      if (pull.reason === "already_open" && pull.request?.idempotency_key !== `blueprint-service:${row.id}:real`) {
        return { handled: true, ok: true, waiting: true, reason: "another_report_pending" };
      }
      pullId = pull.request.id;
    } else {
      const task = await createTaskImpl(tx, { ...scope,
        assigneeRole: row.service_kind === "funding_round" ? "funding_advisor" : "inquiry_specialist",
        title: `Perform purchased Blueprint ${row.service_kind.replaceAll("_", " ")}`,
        sourceWorkflow: "blueprint-paid-help", eventId: `blueprint-paid-help:${row.id}`,
        detail: `Paid service ${row.id}; same ${row.scope_type} ${row.target_id}${row.round_key ? `; round ${row.round_key}` : ""}. Verify the work and attach its completion evidence.` });
      if (!task?.id) throw new Error("blueprint_service_task_not_saved");
      taskId = task.id;
      if (row.service_kind === "funding_round") await activatePaidBlueprintTakeover(tx,{
        orgId:row.org_id,clientId:row.client_id,engagementId:row.engagement_id,requestId:row.id
      });
    }
    await tx.query(`UPDATE blueprint_client_services SET state='in_progress',payment_ref=$2,fulfillment_task_id=$3,
      soft_pull_request_id=$4,updated_at=now() WHERE id=$1`, [row.id, row.ledger_payment_ref, taskId, pullId]);
    await tx.query(`UPDATE paid_service_requests SET status='staged',produced=produced||$2::jsonb WHERE id=$1 AND status='paid'`,
      [row.id, JSON.stringify({ task_id: taskId, soft_pull_request_id: pullId, target_id: row.target_id })]);
    return { handled: true, ok: true, taskId, reportRequestId: pullId };
  });
}
