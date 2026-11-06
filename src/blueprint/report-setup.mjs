import { withTransaction } from "../db/with-transaction.mjs";
import { consentStatus } from "../consent/index.mjs";
import { requestSoftPull, SoftPullError } from "../finance/soft-pulls.mjs";
import { getBlueprintFulfillmentAccess } from "./fulfillment-access.mjs";
import { readBlueprintReportAllowance } from "./report-allowance.mjs";

export const REPORT_SETUP_URL = "/app/soft-pull-approve.html?portal=1&blueprint=1";

// Only the buyer identifiers leave this query. Never read or decrypt personal data to render setup status.
export const REPORT_READY_CLIENTS_SQL = `
  SELECT p.org_id, p.client_id FROM pii_identity p
  JOIN clients c ON c.org_id=p.org_id AND c.id=p.client_id
  WHERE p.ssn_enc IS NOT NULL AND octet_length(p.ssn_enc)>0 AND p.dob IS NOT NULL
    AND nullif(btrim(c.first_name),'') IS NOT NULL AND nullif(btrim(c.last_name),'') IS NOT NULL
    AND nullif(btrim(p.addresses->0->>'addressLine1'),'') IS NOT NULL
    AND nullif(btrim(p.addresses->0->>'city'),'') IS NOT NULL
    AND nullif(btrim(p.addresses->0->>'state'),'') IS NOT NULL
    AND nullif(btrim(p.addresses->0->>'postalCode'),'') IS NOT NULL`;

export async function readBlueprintReportSetup(db, scope) {
  if (scope.engagement?.status !== "active") return { required: false, authorizationUrl: null };
  const [consent, identity] = await Promise.all([
    consentStatus(db, { orgId: scope.orgId, clientId: scope.clientId, kind: "soft_pull_consent" }),
    db.query(`SELECT EXISTS(SELECT 1 FROM (${REPORT_READY_CLIENTS_SQL}) ready WHERE ready.org_id=$1 AND ready.client_id=$2) AS present`,
      [scope.orgId, scope.clientId])
  ]);
  return { required: !consent.valid || !identity.rows[0]?.present, authorizationUrl: REPORT_SETUP_URL };
}

export async function finishBlueprintReportSetup(db, scope, saveAuthorization) {
  return withTransaction(db, async tx => {
    const { orgId, clientId, engagement } = scope;
    // All included-report entrances lock the engagement in the allowance trigger.
    // Hold the same lock before reading the shared allowance or writing identity.
    await tx.query("SELECT id FROM blueprint_fulfillment_engagements WHERE org_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE",
      [orgId, clientId, engagement.id]);
    const current = await getBlueprintFulfillmentAccess(tx, { orgId, clientId });
    if (current?.id !== engagement.id || current.status !== "active") {
      throw new SoftPullError("Your full Blueprint engagement is no longer active.", { status: 403, code: "full_blueprint_required" });
    }
    const key = `blueprint-included:${engagement.id}:first-report-setup`;
    const prior = await tx.query(`SELECT id FROM soft_pull_requests WHERE org_id=$1 AND client_id=$2
      AND blueprint_engagement_id=$3 AND idempotency_key=$4`, [orgId, clientId, engagement.id, key]);
    if ((await readBlueprintReportSetup(tx, scope)).required) await saveAuthorization(tx);
    const allowance = await readBlueprintReportAllowance(tx, scope);
    if (prior.rows[0] || !allowance.includedAvailable) {
      return { reportRequestId: prior.rows[0]?.id || allowance.pendingRequestId, nextIncludedAt: allowance.nextIncludedAt };
    }
    const result = await requestSoftPull(tx, { orgId, clientId,
      requestedBy: { kind: "client", accountId: scope.accountId },
      reason: "Included monthly Blueprint credit report", subscriptionId: engagement.id, idempotencyKey: key });
    return { reportRequestId: result.request.id, nextIncludedAt: (await readBlueprintReportAllowance(tx, scope)).nextIncludedAt };
  });
}
