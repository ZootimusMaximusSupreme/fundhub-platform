import { reconcileSubmittedEvidence, finishEvidencedRound } from "./bank-evidence.mjs";
import { createTask } from "../lib/create-task.mjs";
import { pool, db as defaultDb } from "../db.mjs";
import { withTransaction } from "../documents/register.mjs";
import { matchForClient } from "../lenders/store.mjs";
import { parseBureaus, sensitiveBureaus, stateEligible } from "../lenders/match.mjs";
import { isBusinessLenderTable } from "../pulse/beats/lib/lender-tables.mjs";
import { isBlockingFundingHold } from "../inquiry-ops/doc-gate.mjs";
import { loadActiveCasesForClient } from "../inquiry-ops/gate.mjs";
import { companiesReady } from "../underwrite/funding-sequence.mjs";
import { loadBlueprintFundable } from "./closer-ready.mjs";
import { BLUEPRINT_GENUINE_CREDIT_SQL } from "./client-plan.mjs";
import { getBlueprintFulfillmentAccess } from "./fulfillment-access.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STEPS = {
  needs_file: "Add the missing information needed to evaluate your file.",
  optimize: "Complete your next Blueprint preparation step.",
  held: "Resolve the open hold before applying.",
  ready: "Open your next eligible lender on your own device.",
  awaiting_response: "Follow the next step on your current application.",
  managed: "Fundhub is handling your purchased funding round.",
  completed: "Your purchased funding round is complete."
};

export class BlueprintFundingError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

function requireId(value, code) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BlueprintFundingError(code, 400);
}

function safeBankUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.href;
  } catch { return null; }
}

function businessState(b) {
  const facts = b.entity_data || {};
  return String(facts.operating_state || facts.business_state || facts.state || facts.formation_state || "").trim();
}

async function readApplications(db, { orgId, clientId, engagement }) {
  const {rows} = await db.query(
    `SELECT a.id, h.id AS "handoffId",h.lender_id AS "lenderId",h.business_id AS "businessId",
            a.lender_name AS "lenderName",l.bureaus_pulled AS "bureausPulled",a.status,a.approved_amount AS "approvedAmount",
            h.opened_at AS "openedAt",a.updated_at AS "decisionUpdatedAt",
            r.report_status AS "reportedStatus",r.created_at AS "reportedAt",
            (SELECT actual_funded_amount FROM blueprint_application_proof WHERE handoff_id=h.id) AS "fundedAmount",
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id',doc.id,'reference',rep.reference)) FROM blueprint_application_reports rep
              JOIN documents doc ON doc.id=rep.evidence_document_id AND doc.org_id=h.org_id AND doc.client_id=h.client_id
              WHERE rep.handoff_id=h.id),'[]'::jsonb) AS "evidenceDocuments"
       FROM blueprint_funding_handoffs h
       JOIN applications a ON a.id=h.application_id AND a.org_id=h.org_id AND a.client_id=h.client_id
          AND a.lender_id=h.lender_id AND a.funding_round_id=$4
       JOIN lenders l ON l.id=h.lender_id AND l.org_id=h.org_id
       LEFT JOIN LATERAL (SELECT report_status,created_at FROM blueprint_application_reports
         WHERE handoff_id=h.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
      WHERE h.engagement_id=$1 AND h.org_id=$2 AND h.client_id=$3 ORDER BY h.opened_at,h.id`,
    [engagement.id,orgId,clientId,engagement.roundId]);
  return rows;
}

function result(engagement, state, applications, lenders = [], reason = null) {
  const submissionsClosed = Boolean(engagement.submissionsClosed);
  const canFinishSubmissions = !submissionsClosed && engagement.status==="active" && engagement.executionOwner==="client" &&
    applications.length>0 && applications.every(a => a.status!=="Apply" || a.reportedStatus);
  return { ok:true, engagement, state, reason, nextAction:STEPS[state], applications, lenders,submissionsClosed,canFinishSubmissions };
}

// Never hand a bank URL out with the list. Both the list and open action use the
// same freshly derived decision, including previous reports and bureau holds.
export async function readBlueprintFunding(db, scope, deps = {}) {
  const {orgId,clientId,engagement,now} = scope;
  const applications = await readApplications(db,scope);
  if (engagement.status === "completed") return result(engagement,"completed",applications);
  if (engagement.executionOwner !== "client") return result(engagement,"managed",applications);
  if (engagement.submissionsClosed) return result(engagement,"awaiting_response",applications,[],"batch_submitted");
  const credit = (await db.query(BLUEPRINT_GENUINE_CREDIT_SQL,[clientId,orgId])).rows[0];
  if (!credit?.result || !Object.keys(credit.result).length) return result(engagement,"needs_file",applications);
  const decision = await (deps.loadBlueprintFundable || loadBlueprintFundable)(db,{orgId,clientId,creditFile:credit,includeMissing:true});
  if (decision.reason==="incomplete_credit_file") return result(engagement,"needs_file",applications,[],decision.reason);
  if (!decision.fundable) return result(engagement,"optimize",applications);
  const [record,businessRows,inquiries,cases,matches] = await Promise.all([
    db.query(`SELECT c.custom_fields,c.tags,EXISTS(SELECT 1 FROM inquiry_removal_cases ir
           WHERE ir.client_id=c.id AND ir.org_id=c.org_id AND NULLIF(btrim(ir.fraud_alert_after),'') IS NOT NULL) AS fraud
           FROM clients c WHERE c.org_id=$1 AND c.id=$2`,[orgId,clientId]),
    db.query("SELECT id,name,entity_data FROM businesses WHERE org_id=$1 AND client_id=$2 ORDER BY created_at,id",[orgId,clientId]),
    db.query("SELECT * FROM inquiry_log WHERE org_id=$1 AND client_id=$2 ORDER BY created_at DESC",[orgId,clientId]),
    loadActiveCasesForClient(db,{orgId,clientId}),
    (deps.matchForClient || matchForClient)(db,{orgId,clientId})
  ]);
  const client = record.rows[0];
  if (!client) throw new BlueprintFundingError("client_not_found",404);
  const fields = client.custom_fields || {};
  const hold = fields.round_hold_reason;
  if (isBlockingFundingHold(hold) || (hold && hold !== "New Inquiries") || client.fraud ||
      client.tags?.includes("fraud:alert-present")) return result(engagement,"held",applications,[],"funding_hold");
  const hot = sensitiveBureaus(inquiries.rows,{cases,now});
  const previous = applications.at(-1);
  const reviewBureaus = new Set();
  let unknownPriorBureau = false;
  for (const application of applications) {
    const submittedAt = application.reportedAt || (application.status !== "Apply" ? application.openedAt : null);
    if (!submittedAt || new Date(credit.created_at).getTime() > new Date(submittedAt).getTime()) continue;
    const prior = parseBureaus(application.bureausPulled);
    if (!prior.length) unknownPriorBureau = true;
    for (const bureau of prior) reviewBureaus.add(bureau);
  }
  const handling = previous && !previous.reportedStatus && previous.status === "Apply";
  const inFuture = new Date(engagement.opensAt).getTime() > now.getTime();
  const lenders = [];
  for (const lender of matches?.matches || []) {
    if (lender.is_demo || !safeBankUrl(lender.application_url)) continue;
    const bureaus = parseBureaus(lender.bureaus_pulled);
    if (unknownPriorBureau || (reviewBureaus.size && (!bureaus.length || bureaus.some(b => reviewBureaus.has(b))))) continue;
    if (hot.size && (!bureaus.length || bureaus.some(b => hot.has(b)))) continue;
    const businessProduct = isBusinessLenderTable(lender.lender_table);
    const companies = businessProduct ? businessRows.rows.filter(b => companiesReady([b]).ready &&
      businessState(b) && stateEligible(lender.eligible_states,businessState(b))) : [null];
    if (!businessProduct && (!matches.summary?.home_state || !stateEligible(lender.eligible_states,matches.summary.home_state))) continue;
    for (const company of companies) {
      const businessId = company?.id || null;
      const existing = applications.find(a => a.lenderId === lender.id && a.businessId === businessId);
      if (existing && (existing.reportedStatus || existing.status !== "Apply")) continue;
      if (handling && existing?.id !== previous.id) continue;
      lenders.push({ id:lender.id,name:lender.name,productName:lender.product_name || null,businessId,
        businessName:company?.name || null,available:false,reason:"later_in_order",nextEligibleAt:null });
    }
  }
  if (lenders.length) {
    const next = lenders[0];
    next.available = !inFuture;
    next.reason = inFuture ? "scheduled" : null;
    next.nextEligibleAt = inFuture ? engagement.opensAt : null;
  }
  return result(engagement,lenders[0]?.available ? "ready" : applications.length ? "awaiting_response" : "held",
    applications,lenders,inFuture ? "scheduled" : lenders.length ? null : "no_eligible_lender");
}

async function inEngagementTransaction(db, scope, fn) {
  // Production's query facade is pool-wide. Use one checked-out connection
  // throughout to serialize handoffs, takeover, revocation and round close.
  return withTransaction(db === defaultDb ? pool() : db,async tx => {
    await tx.query("SELECT id FROM clients WHERE org_id=$1 AND id=$2 FOR UPDATE", [scope.orgId, scope.clientId]);
    const lock = await tx.query(`SELECT g.id FROM blueprint_fulfillment_engagements g
      JOIN entitlements e ON e.id=g.source_entitlement_id JOIN transactions t ON t.id=g.source_transaction_id
      WHERE g.id=$1 AND g.org_id=$2 AND g.client_id=$3 FOR UPDATE OF g,e,t`,[scope.engagement.id,scope.orgId,scope.clientId]);
    if (!lock.rowCount) throw new BlueprintFundingError("engagement_unavailable");
    const engagement = await getBlueprintFulfillmentAccess(tx,scope);
    if (!engagement || engagement.id !== scope.engagement.id || engagement.status !== "active" || engagement.executionOwner !== "client")
      throw new BlueprintFundingError("engagement_not_client_operated");
    return fn(tx,{...scope,engagement});
  });
}

async function roundForEngagement(tx,{engagement,orgId,clientId}) {
  if (engagement.roundId) {
    const row = await tx.query("SELECT id FROM funding_rounds WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status NOT IN ('closed','funded') FOR UPDATE",
      [engagement.roundId,orgId,clientId]);
    if (!row.rowCount) throw new BlueprintFundingError("purchased_round_closed");
    return engagement.roundId;
  }
  await tx.query("SELECT id FROM clients WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,clientId]);
  const other = await tx.query("SELECT id FROM funding_rounds WHERE org_id=$1 AND client_id=$2 AND status NOT IN ('closed','funded') LIMIT 1",[orgId,clientId]);
  if (other.rowCount) throw new BlueprintFundingError("another_funding_round_is_open");
  const r = await tx.query(`INSERT INTO funding_rounds(org_id,client_id,round_number,status,product)
    SELECT $1,$2,COALESCE(MAX(round_number),0)+1,'started','blueprint_self_funding'
      FROM funding_rounds WHERE org_id=$1 AND client_id=$2 RETURNING id`,[orgId,clientId]);
  const roundId = r.rows[0].id;
  await tx.query("UPDATE blueprint_fulfillment_engagements SET funding_round_id=$1 WHERE id=$2",[roundId,engagement.id]);
  return roundId;
}

async function recordOperation(tx, engagementId, action, key, input) {
  if (key === undefined || key === null) return;
  if (typeof key !== "string" || key.length>180 || !key.trim()) throw new BlueprintFundingError("invalid_idempotency_key",400);
  const result = await tx.query(`INSERT INTO blueprint_funding_operations(engagement_id,action,request_key,input)
    VALUES ($1,$2,$3,$4) ON CONFLICT (engagement_id,action,request_key) DO UPDATE
       SET input=blueprint_funding_operations.input WHERE blueprint_funding_operations.input=EXCLUDED.input
    RETURNING request_key`,[engagementId,action,key,input]);
  if (!result.rowCount) throw new BlueprintFundingError("idempotency_key_conflict");
}

export async function openBlueprintLender(db,scope,{lenderId,businessId = null,idempotencyKey},deps = {}) {
  requireId(lenderId,"invalid_lender");
  if (businessId !== null) requireId(businessId,"invalid_business");
  return inEngagementTransaction(db,scope,async (tx,own) => {
    await recordOperation(tx,own.engagement.id,"open_lender",idempotencyKey,{lenderId,businessId});
    const view = await readBlueprintFunding(tx,own,deps);
    const allowed = view.lenders.some(l => l.id === lenderId && l.businessId === businessId && l.available);
    if (!allowed) throw new BlueprintFundingError(view.reason || "lender_not_available");
    const {rows:[lender]} = await tx.query(`SELECT id,name,product_name,lender_table,application_url FROM lenders
      WHERE id=$1 AND org_id=$2 AND active IS TRUE AND is_demo IS NOT TRUE FOR SHARE`,[lenderId,own.orgId]);
    const url = safeBankUrl(lender?.application_url);
    if (!url) throw new BlueprintFundingError("lender_link_unavailable");
    const previous = view.applications.find(a => a.lenderId === lenderId && a.businessId === businessId);
    if (previous) return {ok:true,url,handoffId:previous.handoffId,applicationId:previous.id};
    const roundId = await roundForEngagement(tx,own);
    const {rows:[app]} = await tx.query(`INSERT INTO applications(org_id,client_id,funding_round_id,lender_id,
        bank,lender_name,product_name,lender_table,application_url,status) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,'Apply') RETURNING id`,
      [own.orgId,own.clientId,roundId,lenderId,lender.name,lender.product_name,lender.lender_table,url]);
    const credit = (await tx.query(BLUEPRINT_GENUINE_CREDIT_SQL,[own.clientId,own.orgId])).rows[0];
    const {rows:[handoff]} = await tx.query(`INSERT INTO blueprint_funding_handoffs(engagement_id,org_id,client_id,lender_id,business_id,
       application_id,source_credit_report_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [own.engagement.id,own.orgId,own.clientId,lenderId,businessId,app.id,credit.id]);
    return {ok:true,url,handoffId:handoff.id,applicationId:app.id};
  });
}

export async function finishBlueprintSubmissions(db,scope,{idempotencyKey}) {
  return inEngagementTransaction(db,scope,async (tx,own)=>{
    await recordOperation(tx,own.engagement.id,"finish_submissions",idempotencyKey,{});
    const applications = await readApplications(tx,own);
    if (!applications.length || applications.some(a=>a.status==="Apply" && !a.reportedStatus))
      throw new BlueprintFundingError("report_open_applications_first");
    const {rows:[g]}=await tx.query(`UPDATE blueprint_fulfillment_engagements
      SET submissions_closed_at=COALESCE(submissions_closed_at,now()) WHERE id=$1 AND org_id=$2 AND client_id=$3
      RETURNING submissions_closed_at AS "submissionsClosed"`,[own.engagement.id,own.orgId,own.clientId]);
    await reconcileSubmittedEvidence(tx,{...own.engagement,...g});
    await finishEvidencedRound(tx,{...own.engagement,...g});
    return {ok:true,submissionsClosed:true};
  });
}

export async function reportBlueprintApplication(db,scope,{applicationId,status,evidenceDocumentId = null,reference = null,approvedAmount = null,idempotencyKey}) {
  requireId(applicationId,"invalid_application");
  if (!["pending","approved","declined"].includes(status)) throw new BlueprintFundingError("invalid_status",400);
  if (evidenceDocumentId !== null) requireId(evidenceDocumentId,"invalid_evidence");
  if (reference !== null && (typeof reference !== "string" || !reference.trim() || reference.trim().length>200))
    throw new BlueprintFundingError("invalid_reference",400);
  if (!evidenceDocumentId && !reference) throw new BlueprintFundingError("submission_evidence_required",400);
  if (approvedAmount !== null && (status !== "approved" || typeof approvedAmount !== "number" ||
      !Number.isFinite(approvedAmount) || approvedAmount<=0 || approvedAmount>999999999999.99))
    throw new BlueprintFundingError("invalid_reported_amount",400);
  return inEngagementTransaction(db,scope,async (tx,own) => {
    await recordOperation(tx,own.engagement.id,"report_application",idempotencyKey,{applicationId,status,evidenceDocumentId,reference,approvedAmount});
    const {rows:[app]} = await tx.query(`SELECT h.id,a.status FROM blueprint_funding_handoffs h JOIN applications a
      ON a.id=h.application_id AND a.funding_round_id=$5 AND a.org_id=h.org_id AND a.client_id=h.client_id
      WHERE h.org_id=$1 AND h.client_id=$2 AND h.engagement_id=$3 AND h.application_id=$4 FOR UPDATE OF a`,
      [own.orgId,own.clientId,own.engagement.id,applicationId,own.engagement.roundId]);
    if (!app) throw new BlueprintFundingError("application_not_found",404);
    if (evidenceDocumentId) {
      const doc = await tx.query(`SELECT id FROM documents WHERE id=$1 AND org_id=$2 AND client_id=$3
         AND kind='client_upload' FOR SHARE`,[evidenceDocumentId,own.orgId,own.clientId]);
      if (!doc.rowCount) throw new BlueprintFundingError("evidence_not_found",404);
    }
    await tx.query(`INSERT INTO blueprint_application_reports(handoff_id,reported_by,report_status,evidence_document_id,reference,approved_amount)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[app.id,own.accountId,status,evidenceDocumentId,reference?.trim() || null,approvedAmount]);
    // A reported submission is real client activity. Approval, denial and
    // dollars belong to the canonical evidence/decision path, never this post.
    await tx.query("UPDATE applications SET status='Applied',updated_at=now() WHERE id=$1 AND status='Apply'",[applicationId]);
    await reconcileSubmittedEvidence(tx,own.engagement);
    const current=(await tx.query("SELECT status FROM applications WHERE id=$1",[applicationId])).rows[0];
    const expected = status==="approved" ? "Approved" : "Denied";
    if (status!=="pending" && current.status!==expected) {
      await createTask(tx,{orgId:own.orgId,clientId:own.clientId,assigneeRole:"csm",
        sourceWorkflow:"blueprint-bank-evidence",title:"Reconcile bank evidence for the purchased round",
        eventId:"blueprint-bank-evidence:"+applicationId+":"+status,
        dueAt:own.now,detail:"Application "+applicationId+" has a reported "+status+" awaiting independent bank evidence."});
    }
    return {ok:true,applicationId,reportedStatus:status};
  });
}
