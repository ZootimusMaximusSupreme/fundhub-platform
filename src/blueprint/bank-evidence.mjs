import { db as defaultDb, pool } from "../db.mjs";
import { withTransaction } from "../documents/register.mjs";
import { getBlueprintFulfillmentAccess } from "./fulfillment-access.mjs";
import { setApplicationStatus } from "../applications/status.mjs";


const amount = String.raw`\$((?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d{2})?)\b`;
const money = (pattern,text) => {
  const hits = [...text.matchAll(new RegExp(pattern+amount,"gi"))].map(m=>m[1].replaceAll(",",""));
  const values = [...new Set(hits)];
  return values.length===1 ? Number(values[0]) : null;
};
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

function hasReference(text,reference) {
  if (typeof reference!=="string" || !/^[A-Za-z0-9][A-Za-z0-9 -]{4,79}$/.test(reference) ||
      !/\d/.test(reference)) return false;
  return new RegExp("(?:^|[^A-Za-z0-9])"+escape(reference)+"(?:$|[^A-Za-z0-9])","i").test(text);
}

function domainOf(address) {
  const m = String(address || "").match(/@([a-z0-9.-]+)(?:>|\s|$)/i);
  return m ? m[1].toLowerCase() : null;
}

export function mailgunAuthenticatedSender(body) {
  // Mailgun's signed transport is verified by the adapter before this runs.
  // A bare forwarded message or a sender-provided display name is insufficient.
  let headerRows;
  try { headerRows = Array.isArray(body?.["message-headers"]) ? body["message-headers"] : JSON.parse(body?.["message-headers"] || "[]"); }
  catch { return null; }
  if (!Array.isArray(headerRows)) return null;
  const headers = key => headerRows.filter(r=>Array.isArray(r) && String(r[0]).toLowerCase()===key).map(r=>String(r[1]).trim());
  const dkim = headers("x-mailgun-dkim-check-result");
  const spf = headers("x-mailgun-spf");
  const signatures = headers("dkim-signature");
  if (dkim.length!==1 || spf.length!==1 || signatures.length!==1 ||
      dkim[0].toLowerCase()!=="pass" || spf[0].toLowerCase()!=="pass") return null;
  const signed = signatures[0].match(/(?:^|;)\s*d=([a-z0-9.-]+)\s*(?:;|$)/i)?.[1]?.toLowerCase();
  const envelope = domainOf(body.sender);
  const from = domainOf(body.from || body.From);
  if (!signed?.includes(".") || signed!==envelope || from!==signed) return null;
  return signed;
}

export function matchBankMail(mail, application) {
  const domain = mail.raw?.authenticatedBankDomain;
  if (!domain || mail.raw?.source!=="mailgun") return null;
  let host;
  try { host=new URL(application.application_url).hostname.toLowerCase().replace(/^www\./,""); } catch { return null; }
  if (host!==domain && !host.endsWith("."+domain) && !domain.endsWith("."+host)) return null;
  const text = [mail.subject,mail.body_preview].filter(Boolean).join(" ");
  if (!hasReference(text,application.reference)) return null;
  if (/pre[- ]?approved|prequalif|counteroffer|subject to|if approved|conditionally|may be eligible/i.test(text)) return null;
  if (mail.classification==="DENIED" && /application.{0,40}(?:was|is|has been) (?:declined|denied)/i.test(text))
    return {decision:"declined"};
  const approved = money(String.raw`(?:approved (?:for|amount(?: is| of)?)|approved credit limit(?: is| of)?)\s*[:=]?\s*`,text);
  // The bank must explicitly describe usable/issued credit or settled funds.
  // A bare approval limit or marketing offer is never the actual funded amount.
  const funded = money(String.raw`(?:funds (?:were |have been |are )?(?:disbursed|deposited)(?: in the amount of)?|(?:available credit|available credit line)(?: is| of)?)\s*[:=]?\s*`,text);
  const issuance = /(?:card|account|line of credit|credit line).{0,35}(?:active|issued|opened|available to use)/i.test(text);
  const loanSettled = /funds (?:were |have been |are )?(?:disbursed|deposited)/i.test(text);
  if (funded && (loanSettled || issuance)) return {decision:"funded",approvedAmount:approved,fundedAmount:funded};
  return approved && mail.classification==="APPROVED" ? {decision:"approved",approvedAmount:approved} : null;
}

export function matchPostedFunds(row,application) {
  if (row.provider!=="plaid" || row.is_pending || !row.posted_on || row.amount_cents<=0 ||
      !row.provider_transaction_id || !row.plaid_item_id || row.environment!=="production") return null;
  const text=[row.merchant_name,row.raw?.name,row.raw?.original_description].filter(Boolean).join(" ");
  if (!hasReference(text,application.reference) || !application.lender_name ||
      !text.toLowerCase().includes(application.lender_name.toLowerCase()) ||
      !/loan (?:funding|proceeds|disbursement)|funding disbursement|credit advance/i.test(text)) return null;
  return {decision:"funded",fundedAmount:Number(row.amount_cents)/100};
}

const canonicalStatus = decision => decision==="declined" ? "Denied" : "Approved";

async function saveEvidence(tx,app,source,proof) {
  const actual=(await tx.query("SELECT status FROM applications WHERE id=$1 AND org_id=$2 FOR UPDATE",[app.id,app.org_id])).rows[0];
  if (!actual) return false;
  if (actual.status==="Denied" && proof.decision!=="declined" || actual.status==="Approved" && proof.decision==="declined") {
    if (!source.staff) return false;
  }
  const inserted = await tx.query(`INSERT INTO blueprint_bank_evidence
    (handoff_id,source_kind,source_id,source_version,reviewed_by,note,decision,approved_amount,funded_amount)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_kind,source_id) DO NOTHING RETURNING id`,
    [app.handoff_id,source.kind,source.id,source.version || null,source.staff?.id || null,source.note,
     proof.decision,proof.approvedAmount || null,proof.fundedAmount || null]);
  if (!inserted.rowCount) return false;
  const patch = proof.approvedAmount ? {approved_amount:proof.approvedAmount} : null;
  await setApplicationStatus(tx,{orgId:app.org_id,applicationId:app.id,status:canonicalStatus(proof.decision),
    patch,staff:source.staff || null,notes:source.kind+" evidence "+source.id,eventType:"blueprint_bank_evidence"});
  await tx.query("UPDATE tasks SET done=true WHERE org_id=$1 AND client_id=$2 AND source_workflow='blueprint-bank-evidence' AND body=$3 AND NOT done",
    [app.org_id,app.client_id,"blueprint-bank-evidence:"+app.id+":"+(proof.decision==="declined" ? "declined" : "approved")]);
  return true;
}

export async function finishEvidencedRound(tx,engagement) {
  if (!engagement.submissionsClosed || !engagement.roundId || engagement.executionOwner!=="client") return false;
  const totals=(await tx.query("SELECT * FROM blueprint_verified_round_totals($1,$2,$3,$4)",
    [engagement.id,engagement.orgId,engagement.clientId,engagement.roundId])).rows[0];
  if (!totals.total || totals.total!==totals.final) return false;
  await tx.query(`UPDATE funding_rounds SET status=$4,funded_amount=$5,updated_at=now()
    WHERE id=$1 AND org_id=$2 AND client_id=$3 AND product='blueprint_self_funding'
      AND status NOT IN ('funded','closed')`,
    [engagement.roundId,engagement.orgId,engagement.clientId,totals.funded ? "funded" : "closed",totals.funded]);
  if (totals.funded) {
    const {syncClientFunded}=await import("../handlers/money-chain.mjs");
    await syncClientFunded(tx,{orgId:engagement.orgId,clientId:engagement.clientId});
  }
  return true;
}

async function readSubmitted(tx,g) {
  return (await tx.query(`SELECT h.id AS handoff_id,h.opened_at,h.org_id,h.client_id,a.id,a.lender_name,a.application_url,a.status,r.reference
    FROM blueprint_funding_handoffs h JOIN applications a ON a.id=h.application_id AND a.funding_round_id=$4
      AND a.org_id=h.org_id AND a.client_id=h.client_id
    JOIN LATERAL (SELECT DISTINCT reference FROM blueprint_application_reports WHERE handoff_id=h.id
      AND reference IS NOT NULL) r ON true
    WHERE h.org_id=$1 AND h.client_id=$2 AND h.engagement_id=$3`,[g.orgId,g.clientId,g.id,g.roundId])).rows;
}

export async function reconcileSubmittedEvidence(tx, g) {
  if (!g.roundId || g.status!=="active" || g.executionOwner!=="client") return;
  const apps = await readSubmitted(tx,g);
  if (!apps.length) return;
  const since = new Date(Math.min(...apps.map(a=>new Date(a.opened_at).getTime())));
  const mails=(await tx.query(`SELECT id,classification,subject,body_preview,raw,created_at AS received_at FROM bank_inbox
    WHERE org_id=$1 AND client_id=$2 AND created_at>=$3 AND raw->>'authenticatedBankDomain' IS NOT NULL
    ORDER BY created_at,id`,[g.orgId,g.clientId,since])).rows;
  const posted=(await tx.query(`SELECT t.id,t.raw,t.merchant_name,t.provider,t.provider_transaction_id,t.is_pending,
      t.posted_on,t.amount_cents,b.plaid_item_id,b.raw->>'plaid_environment' AS environment
    FROM bank_transactions t JOIN bank_accounts b ON b.id=t.bank_account_id AND b.org_id=t.org_id AND b.client_id=t.client_id
    JOIN plaid_items i ON i.id=b.plaid_item_id AND i.org_id=b.org_id AND i.client_id=b.client_id
    WHERE t.org_id=$1 AND t.client_id=$2 AND i.link_state='active' AND i.encrypted_access_token IS NOT NULL
      AND NOT (t.raw ? 'fundhub_removed_at') AND t.posted_on >= ($3::timestamptz AT TIME ZONE 'UTC')::date
      AND t.amount_cents>0 AND NOT t.is_pending AND t.provider='plaid' AND b.currency_code='USD'
      AND b.raw->>'plaid_environment_source'='server_transport' AND b.raw->>'plaid_environment'='production' ORDER BY t.posted_on,t.id`,[g.orgId,g.clientId,since])).rows;
  for (const [rows,kind,match] of [[mails,"bank_mail",matchBankMail],[posted,"posted_transaction",matchPostedFunds]]) {
    for (const row of rows) {
      const found=new Map();
      for (const app of apps) {
        const after=kind==="bank_mail" ? new Date(row.received_at)>=new Date(app.opened_at) :
          new Date(row.posted_on).toISOString().slice(0,10)>=new Date(app.opened_at).toISOString().slice(0,10);
        const proof=after && match(row,app);
        if (proof) found.set(app.id,{app,proof});
      }
      if (found.size!==1) continue;
      const {app,proof}=[...found.values()][0];
      await saveEvidence(tx,app,{id:row.id,kind,note:"Matched lender and application reference"},proof);
    }
  }
  await finishEvidencedRound(tx,g);
}

export async function reconcileClientBankEvidence(db,{orgId,clientId}) {
  if (!orgId || !clientId) return;
  const access=await getBlueprintFulfillmentAccess(db,{orgId,clientId});
  if (access?.status!=="active" || access.executionOwner!=="client" || !access.roundId) return;
  return withTransaction(db===defaultDb ? pool() : db,async tx=>{
    await tx.query("SELECT id FROM clients WHERE id=$1 AND org_id=$2 FOR UPDATE",[clientId,orgId]);
    const {rows:[g]}=await tx.query(`SELECT id,org_id AS "orgId",client_id AS "clientId",funding_round_id AS "roundId",
      status,execution_owner AS "executionOwner",submissions_closed_at AS "submissionsClosed"
      FROM blueprint_fulfillment_engagements WHERE id=$1 AND org_id=$2 AND client_id=$3 FOR UPDATE`,[access.id,orgId,clientId]);
    if (g) await reconcileSubmittedEvidence(tx,g);
  });
}

export async function reviewOwnedBankDocument(db,{orgId,staff,clientId,applicationId,evidenceDocumentId,decision,approvedAmount,fundedAmount,note}) {
  return withTransaction(db===defaultDb ? pool() : db,async tx=>{
    await tx.query("SELECT id FROM clients WHERE id=$1 AND org_id=$2 FOR UPDATE",[clientId,orgId]);
    const access=await getBlueprintFulfillmentAccess(tx,{orgId,clientId});
    if (access?.status!=="active" || access.executionOwner!=="client") return {ok:false,error:"engagement_not_client_operated"};
    const app=(await tx.query(`SELECT h.id AS handoff_id,h.org_id,a.id,a.status,g.id AS engagement_id,g.funding_round_id,
          g.submissions_closed_at,d.current_version
        FROM blueprint_fulfillment_engagements g JOIN blueprint_funding_handoffs h ON h.engagement_id=g.id AND h.org_id=g.org_id AND h.client_id=g.client_id
        JOIN applications a ON a.id=h.application_id AND a.org_id=h.org_id AND a.client_id=h.client_id AND a.funding_round_id=g.funding_round_id
        JOIN blueprint_application_reports r ON r.handoff_id=h.id AND r.evidence_document_id=$4
        JOIN documents d ON d.id=r.evidence_document_id AND d.org_id=h.org_id AND d.client_id=h.client_id AND d.kind='client_upload'
        JOIN document_versions v ON v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id
          AND v.version=d.current_version AND v.byte_size>0 AND NULLIF(btrim(v.storage_key),'') IS NOT NULL
       WHERE h.org_id=$1 AND h.client_id=$2 AND a.id=$3 AND g.status='active' AND g.execution_owner='client'
       LIMIT 1 FOR UPDATE OF g,a`,[orgId,clientId,applicationId,evidenceDocumentId])).rows[0];
    if (!app) return {ok:false,error:"owned_application_evidence_not_found"};
    const proof={decision,approvedAmount,fundedAmount};
    const saved=await saveEvidence(tx,app,{id:evidenceDocumentId,kind:"reviewed_document",version:app.current_version,staff,note},proof);
    if (!saved) {
      const prior=(await tx.query("SELECT handoff_id,decision,approved_amount,funded_amount FROM blueprint_bank_evidence WHERE source_kind='reviewed_document' AND source_id=$1",[evidenceDocumentId])).rows[0];
      if (prior?.handoff_id!==app.handoff_id || prior.decision!==decision ||
          Number(prior.approved_amount)!==Number(approvedAmount) || Number(prior.funded_amount)!==Number(fundedAmount))
        return {ok:false,error:"bank_evidence_conflict"};
    }
    await finishEvidencedRound(tx,{id:app.engagement_id,orgId,clientId,roundId:app.funding_round_id,executionOwner:"client",submissionsClosed:app.submissions_closed_at});
    return {ok:true,applicationId,decision};
  });
}
