// Save and deliver the complete source report after a real CRS result lands.
// The interpreted UnderwriteIQ pack has separate gates and must not determine
// whether the client's own bureau report is available.
import { on } from "../events/registry.mjs";
import { KINDS } from "../documents/kinds.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { dispatchMessage } from "../messaging/dispatch.mjs";
import { threadMessage } from "../conversations/store.mjs";
import { buildCrsFullReportPdf } from "../finance/crs-full-report.mjs";
import { portalBase } from "../auth/magic-link.mjs";

export const REPORT_SUBTYPE = "crs_full_credit_report";

export async function onAnalysisCompletedFullReport(event, db, {
  store = null,
  buildPdf = buildCrsFullReportPdf,
  persist = storeAndRegister,
  dispatch = dispatchMessage
} = {}) {
  if (event?.payload?.source !== "crs" || event?.payload?.simulated === true) return { saved: false, reason: "not_real_crs" };
  const { orgId, clientId } = event || {};
  const resultId = event?.payload?.crsResultId;
  if (!orgId || !clientId || !resultId || !event?.id) return { saved: false, reason: "missing_identity" };
  const crs = (await db.query(
    `SELECT result, provider FROM crs_results WHERE id = $1 AND org_id = $2 AND client_id = $3 LIMIT 1`,
    [resultId, orgId, clientId]
  )).rows[0];
  const result = crs?.result;
  if (crs?.provider !== "crs_softview" || result?.environment !== "production" || result?.simulated === true) {
    return { saved: false, reason: "not_production_result" };
  }
  if (!result.bureaus || !Object.keys(result.bureaus).length) return { saved: false, reason: "no_bureau_data" };
  const client = (await db.query(
    `SELECT first_name, last_name, email, crm_archived_at FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  )).rows[0];
  if (!client) return { saved: false, reason: "client_not_found" };
  const clientName = [client.first_name, client.last_name].filter(Boolean).join(" ") || "Client";
  const pdf = await buildPdf(result, { clientName });
  const saved = await persist(db, store || storeFromEnv(), {
    orgId, clientId, kind: KINDS.DELIVERABLE, subtype: REPORT_SUBTYPE,
    title: "Complete Credit Report", body: pdf, mimeType: "application/pdf",
    filename: "Fundhub-Credit-Report.pdf", generatedBy: "crs-full-report",
    sourceEventId: event.id,
    metadata: { crs_result_id: resultId, provider: "crs_softview", environment: "production" }
  });
  // An email address is not required to preserve the PDF in the client file.
  if (client.crm_archived_at) return { saved: true, emailed: false, reason: "client_archived", documentId: saved.document.id };
  if (!client.email) return { saved: true, emailed: false, reason: "no_email", documentId: saved.document.id };

  const base = portalBase();
  const ref = `workflow:crs-full-report:${resultId}`;
  const email = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider,
                           provider_ref, status, compliance_check_passed, to_address, subject, attachments)
     VALUES ($1,$2,'outbound','email',$3,'internal',$4,'queued',false,$5,$6,$7)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [orgId, clientId,
      `Your complete credit report is attached. You can also open it in your Fundhub portal: ${base}/app/client-portal.html. To review your next steps, book a call: https://apply.fundhub.ai/schedule/phonecall`,
      ref, client.email, "Your Fundhub credit report",
      JSON.stringify([{ document_id: saved.document.id, filename: "Fundhub-Credit-Report.pdf" }])]
  );
  const message = email.rows[0];
  if (!message) {
    const prior = (await db.query(
      `SELECT id, status FROM messages WHERE org_id = $1 AND provider_ref = $2 LIMIT 1`,
      [orgId, ref]
    )).rows[0];
    return { saved: true, emailed: prior?.status === "sent", deduped: true,
      documentId: saved.document.id, messageId: prior?.id || null };
  }
  await threadMessage(db, { orgId, clientId, channel: "email", messageId: message.id,
    createdAt: message.created_at, source: "crs-full-report" });
  // The normal dispatcher applies the current send gate and retries. A failed
  // immediate attempt leaves the durable queued row for the dispatcher sweep.
  const outcome = await dispatch(db, message.id);
  return { saved: true, emailed: outcome?.outcome === "sent", outcome: outcome?.outcome || null,
    documentId: saved.document.id, messageId: message.id };
}

export function register() {
  on("analysis.completed", onAnalysisCompletedFullReport);
}
