// Capital Blueprint — physical welcome kit ops task on Blueprint pay.

import { createTask } from "../lib/create-task.mjs";
import { buildBlackReportClient } from "../underwrite/black-report-client.mjs";
import { formatPrequalUsd, prequalFromCustomFields } from "../http/portal-prequal.mjs";
import { productCreatesChecklist } from "../waypoints/purchase.mjs";

export const WELCOME_KIT_SOURCE = "blueprint-welcome-kit";

/** Same kit checklist ops ships — task body only, not a new product surface. */
export const WELCOME_KIT_CHECKLIST = Object.freeze([
  "Fundhub hat",
  "Stickers",
  "Mailed package: file analysis, plan, bank list",
  "Metal card with QR to the app",
  "Round-one mailing kit: envelopes, certified mail forms, pen",
  "Laminated one-pager: qualify today + after the plan (from funding snapshot numbers)",
  "Signed note from Chris"
]);

/**
 * Numbers for the laminated one-pager — from latest CRS via funding snapshot
 * client dict, else custom_fields prequal fields.
 */
export async function fundingSnapshotNumbersForClient(db, { orgId, clientId }) {
  const clientRes = await db.query(
    `SELECT first_name, last_name, custom_fields FROM clients
      WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const row = clientRes.rows[0];
  if (!row) return null;

  const cf = row.custom_fields || {};
  const crsRes = await db.query(
    `SELECT result FROM crs_results
      WHERE client_id = $1 AND org_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [clientId, orgId]
  );
  const crsResult = crsRes.rows[0]?.result;
  if (crsResult && typeof crsResult === "object") {
    const personal = {
      name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Client"
    };
    const client = buildBlackReportClient({ crsResult, personal });
    return {
      preapprovalNow: client.preapproval_now,
      preapprovalAfter: client.preapproval_after,
      prequalDisplay: formatPrequalUsd(prequalFromCustomFields(cf)),
      source: "crs_funding_snapshot"
    };
  }

  const prequal = prequalFromCustomFields(cf);
  return {
    preapprovalNow: prequal,
    preapprovalAfter: null,
    prequalDisplay: formatPrequalUsd(prequal),
    source: "custom_fields"
  };
}

/**
 * On consulting-package pay: ops task with kit checklist + snapshot reference.
 * BEST-EFFORT; never throws (money-chain hook).
 */
export async function createWelcomeKitTaskForPurchase(db, {
  orgId,
  clientId,
  productCode
} = {}) {
  if (!productCreatesChecklist(productCode)) {
    return { created: false, reason: "not_blueprint_product" };
  }
  if (!orgId || !clientId) return { created: false, reason: "missing_ids" };

  const numbers = await fundingSnapshotNumbersForClient(db, { orgId, clientId })
    .catch(() => null);

  const eventId = `blueprint-welcome-kit:${clientId}`;
  // createTask uses body as the durable dedupe key. Putting the funding
  // snapshot there makes the key change as CRS/prequal numbers change, and a
  // payment replay can schedule a *second* physical package. Keep the snapshot
  // in the human-readable detail field instead and use the client-stable key.
  // The title check also recognizes tasks written by the old JSON-body format.
  const detail = [
    "Capital Blueprint welcome kit:",
    ...WELCOME_KIT_CHECKLIST.map((item) => `- ${item}`),
    `Funding snapshot: ${numbers ? JSON.stringify(numbers) : "not available — verify before printing the personalized one-pager"}`
  ].join("\n");
  const spec = {
    orgId,
    clientId,
    title: "Ship Capital Blueprint welcome kit",
    sourceWorkflow: WELCOME_KIT_SOURCE,
    assigneeRole: "funding_advisor",
    eventId,
    dedupeOn: "title"
  };
  try {
    return await createTask(db, { ...spec, detail });
  } catch (err) {
    // The original kit task did not require the tasks.detail migration.
    // In a partially migrated preview, keep the stable handoff task rather
    // than silently dropping the paid client's shipment.
    if (err?.code === "42703") {
      return createTask(db, spec)
        .catch((fallbackErr) => ({ created: false, reason: String(fallbackErr?.message || fallbackErr) }));
    }
    return { created: false, reason: String(err?.message || err) };
  }
}
