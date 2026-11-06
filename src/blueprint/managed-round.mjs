import { moveCardToStage } from "../workflows/cards.mjs";
import { createTask } from "../lib/create-task.mjs";

export const MANAGED_BLUEPRINT_ROUND = "blueprint_managed_funding";

// Called inside the same transaction that confirms and fulfills the paid help
// request. Never bind the latest active round, purchase or sale by proximity.
export async function activatePaidBlueprintTakeover(tx,{orgId,clientId,engagementId,requestId}) {
  await tx.query("SELECT id FROM clients WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,clientId]);
  const {rows:[deal]}=await tx.query(`SELECT g.id,g.funding_round_id,g.execution_owner,s.scope_type,s.target_id
      FROM blueprint_fulfillment_engagements g JOIN blueprint_client_services s
        ON s.engagement_id=g.id AND s.org_id=g.org_id AND s.client_id=g.client_id
      JOIN paid_service_requests p ON p.id=s.id AND p.org_id=s.org_id AND p.client_id=s.client_id
      JOIN entitlements e ON e.id=g.source_entitlement_id AND e.revoked_at IS NULL
      WHERE g.id=$3 AND g.org_id=$1 AND g.client_id=$2 AND g.status='active' AND s.id=$4
        AND s.service_kind='funding_round' AND s.authorized_at IS NOT NULL AND p.service_kind='blueprint_help'
        AND p.status IN ('paid','staged') AND p.payment_ref IS NOT NULL AND p.price_total_cents>0
        AND p.amount_paid_cents=p.price_total_cents FOR UPDATE OF g,s,p`,[orgId,clientId,engagementId,requestId]);
  if (!deal) throw new Error("paid_blueprint_takeover_not_verified");
  if (!((deal.scope_type==="engagement" && deal.target_id===deal.id) ||
        (deal.scope_type==="funding_round" && deal.target_id===deal.funding_round_id))) throw new Error("paid_blueprint_takeover_scope_conflict");
  let round;
  if (deal.funding_round_id) {
    round=(await tx.query(`UPDATE funding_rounds SET product=$4,updated_at=now()
       WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status NOT IN ('funded','closed')
         AND product IN ('blueprint_self_funding','blueprint_managed_funding') RETURNING id,round_number`,
      [deal.funding_round_id,orgId,clientId,MANAGED_BLUEPRINT_ROUND])).rows[0];
  } else {
    const unrelated=await tx.query("SELECT id FROM funding_rounds WHERE org_id=$1 AND client_id=$2 AND status NOT IN ('closed','funded') LIMIT 1",[orgId,clientId]);
    if (unrelated.rowCount) throw new Error("separate_funding_round_already_open");
    round=(await tx.query(`INSERT INTO funding_rounds(org_id,client_id,round_number,status,product)
       SELECT $1,$2,COALESCE(max(round_number),0)+1,'started',$3 FROM funding_rounds WHERE org_id=$1 AND client_id=$2
       RETURNING id,round_number`,[orgId,clientId,MANAGED_BLUEPRINT_ROUND])).rows[0];
  }
  if (!round) throw new Error("purchased_funding_round_unavailable");
  await tx.query(`UPDATE blueprint_fulfillment_engagements SET funding_round_id=$2,execution_owner='fundhub'
     WHERE id=$1 AND org_id=$3 AND client_id=$4`,[engagementId,round.id,orgId,clientId]);
  if (deal.execution_owner==="fundhub") return {roundId:round.id};
  const board=await moveCardToStage(tx,{orgId,clientId,pipelineKey:"funding_card_stacking",stageKey:"apply_now",roundNumber:round.round_number});
  if (!board?.moved) await createTask(tx,{orgId,clientId,assigneeRole:"funding_advisor",sourceWorkflow:"blueprint-takeover-board",
    eventId:requestId,title:"Open the purchased managed funding round on the funding board",detail:"Round "+round.id+" is assigned to Fundhub.",dueAt:new Date()});
  return {roundId:round.id};
}

export async function managedTakeoverEvent(db,event) {
  const p=event?.payload;
  if (p?.product!==MANAGED_BLUEPRINT_ROUND || !p.fundingRoundId || !event.orgId || !event.clientId) return false;
  const res=await db.query(`SELECT 1 FROM funding_rounds r JOIN blueprint_fulfillment_engagements g
     ON g.funding_round_id=r.id AND g.org_id=r.org_id AND g.client_id=r.client_id
     WHERE r.id=$1 AND r.org_id=$2 AND r.client_id=$3 AND r.product=$4 AND g.execution_owner='fundhub'`,
    [p.fundingRoundId,event.orgId,event.clientId,MANAGED_BLUEPRINT_ROUND]);
  return Boolean(res.rowCount);
}
