import { withTransaction } from "../db/with-transaction.mjs";
import { currentBureauResponseValidation } from "../repair/response-agent.mjs";

async function inquiryProof(tx,row) {
  if (row.scope_type!=="inquiry_case") return null;
  const {rows} = await tx.query(`SELECT c.id,c.case_status,i.id AS inquiry_id,i.status,i.is_open,i.removal_verified_at,
      i.removal_verified_report_id,i.removal_verified_document_id,
      EXISTS(SELECT 1 FROM crs_results cr WHERE cr.id=i.removal_verified_report_id AND cr.org_id=$1 AND cr.client_id=$2
        AND cr.is_demo IS NOT TRUE AND COALESCE(cr.provider,'')<>'crs_softview_simulated') AS report_owned,
      EXISTS(SELECT 1 FROM documents d WHERE d.id=i.removal_verified_document_id AND d.org_id=$1 AND d.client_id=$2
        AND d.current_version_id IS NOT NULL) AS document_owned
    FROM inquiry_removal_cases c JOIN inquiry_log i ON i.org_id=c.org_id AND i.client_id=c.client_id
        AND (i.case_id=c.id OR i.inquiry_removal_case_id=c.id)
    WHERE c.org_id=$1 AND c.client_id=$2 AND c.id=$3 ORDER BY i.id`,[row.org_id,row.client_id,row.target_id]);
  if (!rows.length || rows.some(i=>i.case_status!=="Completed" || i.is_open!==false ||
      !i.removal_verified_at || !(i.report_owned || i.document_owned) ||
      !["removed","cleared","confirmed","deleted"].includes(String(i.status).toLowerCase()))) return null;
  if (!rows.some(i => new Date(i.removal_verified_at)>=new Date(row.paid_at))) return null;
  return {kind:"inquiry_case",id:row.target_id,detail:{inquiries:rows.map(i=>({id:i.inquiry_id,
    reportId:i.removal_verified_report_id,documentId:i.removal_verified_document_id}))}};
}

async function repairFacts(tx,row) {
  const args=[row.org_id,row.client_id];
  const cases=(await tx.query("SELECT id,bureau,round,status FROM dispute_cases WHERE org_id=$1 AND client_id=$2 ORDER BY id FOR SHARE",args)).rows;
  const items=(await tx.query("SELECT id,case_id,round,status FROM dispute_items WHERE org_id=$1 AND client_id=$2 ORDER BY id FOR SHARE",args)).rows;
  const letters=(await tx.query(`SELECT l.id,l.case_id,l.round,l.status,COALESCE(l.mailed_at,s.submitted_at) AS sent_at
    FROM dispute_letters l LEFT JOIN blueprint_repair_submissions s ON s.letter_id=l.id AND s.org_id=l.org_id AND s.client_id=l.client_id
    WHERE l.org_id=$1 AND l.client_id=$2 ORDER BY l.created_at,l.id`,args)).rows;
  const responses=(await tx.query(`SELECT r.id,r.case_id,r.parse_json,r.confirmed,r.created_at,d.id AS document_id,
    d.current_version_id,d.metadata
    FROM dispute_responses r JOIN documents d ON d.org_id=r.org_id AND d.client_id=r.client_id
      AND d.id::text=r.parse_json->'document_validation'->>'document_id'
      AND d.current_version_id::text=r.parse_json->'document_validation'->>'version_id'
    WHERE r.org_id=$1 AND r.client_id=$2 AND ((d.kind='bureau_response' AND d.subtype='bureau_letter') OR
            (d.kind='client_upload' AND d.subtype='bureau_response'))
      AND r.confirmed ORDER BY r.created_at DESC,r.id`,args)).rows;
  return {cases,items,letters,responses};
}

const openItem = item => !["deleted","updated","closed"].includes(item.status);

function completedRepairRound(facts,caseRow,round) {
  const letters=facts.letters.filter(l=>l.case_id===caseRow.id && l.round===round);
  if (!letters.length || letters.some(l=>!l.sent_at)) return null;
  const items=facts.items.filter(i=>i.case_id===caseRow.id);
  if (!items.length || items.some(i=>i.round===round && openItem(i))) return null;
  const newestSend=Math.max(...letters.map(l=>new Date(l.sent_at).getTime()));
  const matchingResponses=facts.responses.filter(response=>{
    if (response.case_id!==caseRow.id || new Date(response.created_at).getTime()<newestSend) return false;
    const checked=currentBureauResponseValidation({id:response.document_id,current_version_id:response.current_version_id,metadata:response.metadata});
    if (checked?.status!=="accepted" || checked.bureau!==caseRow.bureau) return false;
    const snapshot=response.parse_json?.source_item_rounds;
    const outcomes=response.parse_json?.outcomes;
    if (!Array.isArray(outcomes) || !outcomes.length) return false;
    if (Array.isArray(snapshot)) return outcomes.every(outcome=>snapshot.some(i=>i.id===outcome.itemId && i.caseId===caseRow.id && i.round===round));
    // An older parse did not record its original per-item round. It can be
    // attributed safely only if this case has exactly one ever-sent round.
    const sentRounds=new Set(facts.letters.filter(l=>l.case_id===caseRow.id && l.sent_at).map(l=>l.round));
    return sentRounds.size===1 && sentRounds.has(round) && outcomes.every(o=>items.some(i=>i.id===o.itemId));
  });
  if (!matchingResponses.length) return null;
  const accounted = new Set(matchingResponses.flatMap(r=>r.parse_json.outcomes.map(o=>o.itemId)));
  const expected = new Set(items.filter(i=>i.round===round).map(i=>i.id));
  for (const response of matchingResponses) for (const seen of response.parse_json.source_item_rounds || []) {
    if (seen.caseId===caseRow.id && seen.round===round) expected.add(seen.id);
  }
  if ([...expected].some(id=>!accounted.has(id))) return null;
  return {caseId:caseRow.id,responseId:matchingResponses[0].id,documentId:matchingResponses[0].document_id,confirmedAt:matchingResponses[0].created_at,round};
}

async function repairProof(tx,row) {
  const facts=await repairFacts(tx,row);
  if (row.service_kind==="repair_round") {
    if (row.scope_type!=="dispute_case" || !row.round_key) return null;
    // The portal delegates this named round across its bureau cases; do not
    // hand it back because just the anchor case has a response.
    const targets=facts.cases.filter(c=>c.id===row.target_id || facts.letters.some(l=>l.case_id===c.id && l.round===row.round_key));
    if (!targets.some(c=>c.id===row.target_id)) return null;
    const proof=targets.map(c=>completedRepairRound(facts,c,row.round_key));
    if (proof.some(p=>!p) || new Date(proof.find(p=>p.caseId===row.target_id).confirmedAt)<new Date(row.paid_at)) return null;
    return {kind:"dispute_response",id:proof.find(p=>p.caseId===row.target_id).responseId,detail:{round:row.round_key,cases:proof}};
  }
  if (row.scope_type!=="client" || row.target_id!==row.client_id || !facts.cases.length || !facts.items.length || facts.items.some(openItem)) return null;
  const program=(await tx.query("SELECT id,program,status FROM repair_programs WHERE org_id=$1 AND client_id=$2 FOR UPDATE",[row.org_id,row.client_id])).rows[0];
  if (!program || program.program!=="full" || !["active","complete"].includes(program.status)) return null;
  const proof=[];
  for (const c of facts.cases) {
    if (c.status==="cancelled" || c.status==="stalled") return null;
    const letters = facts.letters.filter(l=>l.case_id===c.id && l.sent_at)
      .sort((a,b)=>new Date(a.sent_at)-new Date(b.sent_at));
    const rounds = letters.map(l=>l.round);
    if (!rounds.length || facts.letters.some(l=>l.case_id===c.id && !l.sent_at)) return null;
    // Earlier rounds may predate this purchase; the terminal response and
    // actual terminal items must show this case's work is finished now.
    const result=completedRepairRound(facts,c,rounds.at(-1));
    if (!result) return null;
    proof.push(result);
  }
  if (!proof.some(result=>new Date(result.confirmedAt)>=new Date(row.paid_at))) return null;
  await tx.query("UPDATE dispute_cases SET status='closed',updated_at=now() WHERE org_id=$1 AND client_id=$2 AND id=ANY($3::uuid[]) AND status<>'closed'",
    [row.org_id,row.client_id,proof.map(c=>c.caseId)]);
  await tx.query("UPDATE repair_programs SET status='complete' WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='active'",[program.id,row.org_id,row.client_id]);
  return {kind:"repair_program",id:program.id,detail:{cases:proof}};
}

async function fundingProof(tx,row) {
  const {rows:[r]}=await tx.query(`SELECT r.id,r.status,r.funded_amount,
    COUNT(a.id)::int AS applications,
    COUNT(a.id) FILTER(WHERE a.status='Approved' AND a.approved_amount>0 AND a.approval_excluded_at IS NULL)::int AS approved,
    COUNT(a.id) FILTER(WHERE a.status='Denied')::int AS denied
    FROM blueprint_fulfillment_engagements g JOIN funding_rounds r ON r.id=g.funding_round_id AND r.org_id=g.org_id AND r.client_id=g.client_id
    LEFT JOIN applications a ON a.funding_round_id=r.id AND a.org_id=r.org_id AND a.client_id=r.client_id
    WHERE g.id=$3 AND g.org_id=$1 AND g.client_id=$2 AND g.execution_owner='fundhub' AND g.status='completed'
      AND (($4='funding_round' AND $5::uuid=r.id) OR ($4='engagement' AND $5::uuid=g.id))
    GROUP BY r.id`,[row.org_id,row.client_id,row.engagement_id,row.scope_type,row.target_id]);
  if (!r || !r.applications || !((r.status==="funded" && Number(r.funded_amount)>0 && r.approved>0) ||
      (r.status==="closed" && r.denied===r.applications))) return null;
  return {kind:"funding_round",id:r.id,detail:{status:r.status,fundedAmount:r.funded_amount,approvedApplications:r.approved}};
}

async function finishOne(db,id,orgId) {
  return withTransaction(db,async tx=>{
    const {rows:[row]}=await tx.query(`SELECT s.*,p.paid_at FROM blueprint_client_services s JOIN paid_service_requests p
       ON p.id=s.id AND p.org_id=s.org_id AND p.client_id=s.client_id
       WHERE s.id=$1 AND s.org_id=$2 AND s.state='in_progress' AND s.authorized_at IS NOT NULL AND p.status='staged'
         AND p.payment_ref IS NOT NULL AND p.payment_ref=s.payment_ref AND p.amount_paid_cents=p.price_total_cents
         AND p.price_total_cents>0 FOR UPDATE OF s,p`,[id,orgId]);
    if (!row) return false;
    const proof = row.service_kind==="inquiry_removal" ? await inquiryProof(tx,row) :
      row.service_kind==="funding_round" ? await fundingProof(tx,row) : await repairProof(tx,row);
    if (!proof) {
      await tx.query("UPDATE blueprint_client_services SET completion_checked_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3",[row.id,row.org_id,row.client_id]);
      return false;
    }
    await tx.query(`UPDATE paid_service_requests SET status='fulfilled',produced_kind=$3,produced_ref=$4,
      produced=produced||$5::jsonb,resolved_at=now(),updated_at=now()
      WHERE id=$1 AND org_id=$2 AND client_id=$6 AND status='staged'`,
      [row.id,row.org_id,proof.kind,proof.id,JSON.stringify({completion:proof.detail}),row.client_id]);
    await tx.query("UPDATE blueprint_client_services SET state='completed',completion_checked_at=now(),updated_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3",[id,row.org_id,row.client_id]);
    if (row.fulfillment_task_id) await tx.query("UPDATE tasks SET done=true WHERE id=$1 AND org_id=$2 AND client_id=$3 AND source_workflow='blueprint-paid-help'",
      [row.fulfillment_task_id,row.org_id,row.client_id]);
    return true;
  });
}

export async function reconcilePaidBlueprintHelpCompletion(db,{orgId=null,requestId=null,limit=100}={}) {
  const due=await db.query(`SELECT id,org_id FROM blueprint_client_services WHERE service_kind<>'credit_pull' AND state='in_progress'
    AND ($1::uuid IS NULL OR org_id=$1) AND ($2::uuid IS NULL OR id=$2)
    ORDER BY completion_checked_at NULLS FIRST,id LIMIT $3`,[orgId,requestId,Math.max(1,Math.min(Number(limit)||100,1000))]);
  const tally={ok:true,checked:due.rowCount,completed:0,waiting:0,errors:[]};
  for (const row of due.rows) {
    try { if (await finishOne(db,row.id,row.org_id)) tally.completed++; else tally.waiting++; }
    catch(error){
      await db.query("UPDATE blueprint_client_services SET completion_checked_at=now() WHERE id=$1 AND org_id=$2 AND state='in_progress'",[row.id,row.org_id]);
      tally.ok=false;tally.errors.push({requestId:row.id,reason:String(error?.message || error)}); }
  }
  return tally;
}
