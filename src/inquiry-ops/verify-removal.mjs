import { withTransaction } from "../db/with-transaction.mjs";
import { clearInquiry } from "../inquiry-removal/cases.mjs";
import { extractFromCrsResult } from "./extract-disputables.mjs";
import { createTask } from "../lib/create-task.mjs";
import { emit } from "../events/bus.mjs";

const BUREAUS = new Set(["EX", "EQ", "TU"]);
const normalizedName = value => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(value || ""))) return null;
  const result = String(value).slice(0, 10);
  const parsed = new Date(`${result}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null;
}

export function genuineInquiryReport(row, bureau) {
  const result = row?.result;
  if (!row?.id || !result || !BUREAUS.has(bureau) || row.is_demo === true
      || row.provider === "crs_softview_simulated" || result.provider === "crs_softview_simulated"
      || [true, "true", "1", 1].includes(result.simulated)
      || ["sandbox", "simulated"].includes(String(result.environment || "").toLowerCase())) return null;
  if (result.bureauStatus?.[bureau] !== "file_returned" || result.bureauErrors?.[bureau]
      || !Array.isArray(result.bureaus?.[bureau]?.inquiries)) return null;
  if (!Number.isFinite(new Date(row.created_at).getTime())) return null;
  const raw = result.bureaus[bureau].inquiries;
  if (raw.some(item => !item || !(item.creditorName || item.inquiry || item.inquiry_name || item.name || item.furnisher)
      || !day(item.inquiryDate || item.date || item.inquiry_date))) return null;
  const rows = extractFromCrsResult({ inquiries: raw.map(item => ({ ...item, source: bureau,
    date: item.inquiryDate || item.date || item.inquiry_date })) })?.[bureau]?.inquiries;
  if (!Array.isArray(rows)) return null;
  return { id: String(row.id), at: new Date(row.created_at).toISOString(),
    items: rows.map(item => ({ name: item.inquiry_name, date: day(item.inquiry_date) })) };
}

export function captureInquiryBaseline(inquiries, report, bureau) {
  const facts = genuineInquiryReport(report, bureau);
  return inquiries.map(inquiry => {
    const matches = (facts?.items || []).filter(item => normalizedName(item.name) === normalizedName(inquiry.inquiry_name || inquiry.inquiry));
    const match = matches.length === 1 && matches[0].date ? matches[0] : null;
    return { inquiryId: String(inquiry.id), bureau, name: match?.name || inquiry.inquiry_name || inquiry.inquiry,
      date: match?.date || null, sourceFound: Boolean(match) };
  });
}

export function inquiryRemovalDecision(baseline, original, current) {
  if (!baseline?.sourceFound || !baseline.date || !baseline.name) return { status: "review", reason: "baseline_inquiry_uncertain" };
  const before = genuineInquiryReport(original, baseline.bureau);
  const after = genuineInquiryReport(current, baseline.bureau);
  if (!before || !after || before.id === after.id || !(new Date(after.at) > new Date(before.at))) {
    return { status: "waiting", reason: "new_complete_bureau_report_needed" };
  }
  const same = item => normalizedName(item.name) === normalizedName(baseline.name) && item.date === baseline.date;
  if (!before.items.some(same)) return { status: "review", reason: "baseline_inquiry_not_found" };
  return after.items.some(same)
    ? { status: "present", reason: "inquiry_still_reported", reportId: after.id }
    : { status: "removed", reason: "absent_from_new_complete_bureau_report", reportId: after.id };
}

export function inquiryResponseDecision(item, { validation, text }, baselineAt, now = new Date()) {
  if (!item?.sourceFound || !item.date || validation?.status !== "accepted"
      || validation.bureau !== item.bureau || validation.client_match !== "match"
      || validation.authenticity !== "clear" || validation.quality !== "pass"
      || validation.document_type !== "bureau_response") return false;
  const responseDay = day(validation.letter_date);
  if (!responseDay || responseDay <= day(baselineAt) || responseDay > new Date(now).toISOString().slice(0, 10)) return false;
  const source = String(text || "");
  if (!/\binquir(?:y|ies)\b/i.test(source)) return false;
  const [year, month, date] = item.date.split("-");
  const dates = [item.date, `${month}/${date}/${year}`, `${Number(month)}/${Number(date)}/${year}`];
  return source.split(/[\n.!?]+/).some(statement =>
    dates.some(value => normalizedName(statement).startsWith(normalizedName(item.name + value)))
    && /\b(?:removed|deleted)\b/i.test(statement)
    && !/\b(?:not|never|cannot|unable|requested|requesting|pending|will|may)\b/i.test(statement));
}

export async function reviewInquiryEvidence(db, scope, caseId, reason, task = createTask) {
  return task(db, { orgId: scope.orgId, clientId: scope.clientId, assigneeRole: "csm",
    title: "Review inquiry removal evidence", sourceWorkflow: "blueprint-inquiry-verification",
    eventId: `inquiry-evidence:${caseId}:${reason}`,
    detail: `Inquiry case ${caseId}: ${reason}. Check the source evidence before releasing this bureau.` });
}

async function confirmVerifiedInquiry(tx, scope, item, proof, { clear = clearInquiry, caseId = null } = {}) {
  const changed = await tx.query(
    `UPDATE inquiry_log SET removal_verified_at = $4::timestamptz,
        removal_verified_report_id = $5::uuid, removal_verified_document_id = $6::uuid,
        case_id = COALESCE(case_id, $7::uuid)
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
        AND (removal_verified_report_id IS DISTINCT FROM $5::uuid
          OR removal_verified_document_id IS DISTINCT FROM $6::uuid)
      RETURNING id`,
    [item.inquiryId, scope.orgId, scope.clientId, scope.now || new Date(), proof.reportId || null, proof.documentId || null, caseId]
  );
  if (!changed.rows.length) return null;
  return clear(tx, { inquiryId: item.inquiryId, orgId: scope.orgId });
}

/** Called only after the existing bureau-response reader validated the current upload. */
export async function verifyInquiryResponse(db, scope, {
  validation, text, createTaskImpl = createTask, emitFn = emit, clearImpl = clearInquiry
} = {}) {
  const document = (await db.query(
    `SELECT id FROM documents WHERE id = $1::uuid AND org_id = $2::uuid
      AND client_id = $3::uuid AND kind = 'bureau_response' AND current_version_id = $4::uuid
      AND (expires_at IS NULL OR expires_at > now())`,
    [scope.documentId, scope.orgId, scope.clientId, scope.versionId]
  )).rows[0];
  if (!document || validation?.document_id !== String(scope.documentId)
      || validation?.version_id !== String(scope.versionId) || validation.status !== "accepted") return { checked: 0, removed: 0 };
  const cases = (await db.query(
    `SELECT e.*, r.created_at AS baseline_created_at FROM blueprint_inquiry_evidence e
      JOIN inquiry_removal_cases c ON c.id = e.case_id AND c.org_id = e.org_id AND c.client_id = e.client_id
      JOIN crs_results r ON r.id = e.baseline_report_id AND r.org_id = e.org_id AND r.client_id = e.client_id
      WHERE e.org_id = $1::uuid AND e.client_id = $2::uuid AND c.selected_bureaus_raw = $3`,
    [scope.orgId, scope.clientId, validation.bureau]
  )).rows;
  const result = { checked: 0, removed: 0 };
  const latest = (await db.query(
    `SELECT id, provider, is_demo, result, created_at FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND is_demo IS NOT TRUE
      ORDER BY created_at DESC LIMIT 1`, [scope.orgId, scope.clientId]
  )).rows[0];
  for (const row of cases) {
    const previouslyRemoved = result.removed;
    for (const item of row.baseline_items) {
      result.checked++;
      if (!inquiryResponseDecision(item, { validation, text }, row.baseline_created_at, scope.now)) continue;
      const current = genuineInquiryReport(latest, item.bureau);
      if (current && day(current.at) >= validation.letter_date && current.items.some(entry =>
        normalizedName(entry.name) === normalizedName(item.name) && entry.date === item.date)) continue;
      const cleared = await confirmVerifiedInquiry(db, scope, item, { documentId: scope.documentId },
        { clear: clearImpl, caseId: row.case_id });
      if (cleared) result.removed++;
      if (cleared?.caseCleared && cleared.caseRow) await emitFn(db, "inquiry.removed", {
        inquiryRemovalCaseId: cleared.caseRow.id, inquiryId: item.inquiryId,
        source: "blueprint_verified_response", documentId: scope.documentId
      }, { orgId: scope.orgId, clientId: scope.clientId,
        idempotencyKey: `inquiry.verified:${item.inquiryId}:${scope.documentId}:${scope.versionId}` });
    }
    if (row.baseline_items.length && result.removed === previouslyRemoved) await reviewInquiryEvidence(db, scope,
      row.case_id, "bureau_response_inquiry_outcome_uncertain", createTaskImpl);
  }
  return result;
}

export async function verifyClientInquiryRemovals(db, scope, {
  caseId = null, createTaskImpl = createTask, emitFn = emit, clearImpl = clearInquiry
} = {}) {
  const evidence = (await db.query(
    `SELECT e.*, r.created_at AS baseline_created_at, r.result AS baseline_result,
            r.provider AS baseline_provider, r.is_demo AS baseline_demo
       FROM blueprint_inquiry_evidence e JOIN crs_results r ON r.id = e.baseline_report_id
        AND r.org_id = e.org_id AND r.client_id = e.client_id
      WHERE e.org_id = $1::uuid AND e.client_id = $2::uuid
        AND ($3::uuid IS NULL OR e.case_id = $3::uuid)`,
    [scope.orgId, scope.clientId, caseId]
  )).rows;
  if (!evidence.length) return { ok: true, checked: 0, removed: 0, waiting: 0, review: 0 };
  const latest = (await db.query(
    `SELECT id, org_id, client_id, provider, is_demo, result, created_at FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND is_demo IS NOT TRUE ORDER BY created_at DESC LIMIT 1`, [scope.orgId, scope.clientId]
  )).rows[0];
  const out = { ok: true, checked: 0, removed: 0, waiting: 0, review: 0 };
  for (const row of evidence) {
    const original = { id: row.baseline_report_id, created_at: row.baseline_created_at,
      result: row.baseline_result, provider: row.baseline_provider, is_demo: row.baseline_demo };
    const items = Array.isArray(row.baseline_items) ? row.baseline_items : [];
    for (const item of items) {
      out.checked++;
      const decision = inquiryRemovalDecision(item, original, latest);
      if (decision.status === "review") {
        out.review++;
        await reviewInquiryEvidence(db, scope, row.case_id, decision.reason, createTaskImpl);
      } else if (decision.status === "removed") {
        const cleared = await withTransaction(db, async tx => {
          const current = (await tx.query(
            `SELECT id FROM crs_results WHERE org_id = $1::uuid AND client_id = $2::uuid
              AND is_demo IS NOT TRUE ORDER BY created_at DESC LIMIT 1`, [scope.orgId, scope.clientId]
          )).rows[0];
          if (String(current?.id) !== String(latest?.id)) return null;
          return confirmVerifiedInquiry(tx, scope, item, decision, { clear: clearImpl, caseId: row.case_id });
        });
        if (cleared) out.removed++;
        if (cleared?.caseCleared && cleared.caseRow) await emitFn(db, "inquiry.removed", {
          inquiryRemovalCaseId: cleared.caseRow.id, inquiryId: item.inquiryId,
          source: "blueprint_verified_report", reportId: decision.reportId
        }, { orgId: scope.orgId, clientId: scope.clientId,
          idempotencyKey: `inquiry.verified:${item.inquiryId}:${decision.reportId}` });
      } else if (decision.status === "present") {
        await db.query(
          `UPDATE inquiry_log SET status = 'New', is_open = true, confirmed_at = NULL,
              removal_verified_at = NULL, removal_verified_report_id = NULL, removal_verified_document_id = NULL
            WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
              AND removal_verified_at IS NOT NULL`, [item.inquiryId, scope.orgId, scope.clientId]
        );
        await db.query(
          `UPDATE inquiry_removal_cases c SET case_status = 'Queued', completed_at = NULL,
              open_inquiry_count = (SELECT count(*) FROM inquiry_log i
                WHERE i.org_id = c.org_id AND i.client_id = c.client_id
                  AND (i.case_id = c.id OR i.inquiry_removal_case_id = c.id) AND i.is_open = true)
            WHERE c.id = $1::uuid AND c.org_id = $2::uuid AND c.client_id = $3::uuid
              AND c.case_status = 'Completed'
              AND EXISTS (SELECT 1 FROM inquiry_log i WHERE i.org_id = c.org_id
                AND i.client_id = c.client_id AND (i.case_id = c.id OR i.inquiry_removal_case_id = c.id)
                AND i.is_open = true)`, [row.case_id, scope.orgId, scope.clientId]
        );
        out.waiting++;
      } else out.waiting++;
    }
  }
  return out;
}
