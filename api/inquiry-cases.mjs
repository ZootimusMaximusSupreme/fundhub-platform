// POST /api/inquiry-cases — create / update / close inquiry removal cases.
// Closing a Completed case emits inquiry.removed on the canonical bus.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { createCase, updateCase, closeCase, CASE_STATUSES } from "../src/inquiry-ops/cases.mjs";
import { generateFromCrs } from "../src/inquiry-ops/generate-from-crs.mjs";
import { clearInquiry as clearBridgeInquiry, InquiryCaseError } from "../src/inquiry-removal/cases.mjs";
import { sendCase, SendGateError } from "../src/inquiry-ops/send.mjs";
import { overrideBureauGate } from "../src/inquiry-ops/gate.mjs";
import {
  loadMailServiceLevel,
  loadBureauMailAddress,
  loadClientReturnAddress
} from "../src/inquiry-ops/call-scheduler.mjs";
import {
  mailBureauLetter,
  resolveInquiryLetterContent
} from "../src/metro2/delivery/send.mjs";
import { storeFromEnv } from "../src/underwrite/funding-letter-pdf.mjs";
import { emit } from "../src/events/bus.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const ACTIONS = new Set([
  "create", "update", "close", "mark_cleared", "clear_inquiry", "send", "gate_override", "generate"
]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const emitFn = deps.emit ?? emit;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  const action = String(body.action || "update").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      ok: false,
      error: "unknown_action",
      message: `Use one of: ${[...ACTIONS].join(", ")}`
    });
  }

  try {
    if (action === "clear_inquiry") {
      const inquiryId = body.inquiry_id || body.inquiryId;
      if (!inquiryId || !isUuid(inquiryId)) {
        return res.status(400).json({ ok: false, error: "inquiry_id_required" });
      }
      const result = await clearBridgeInquiry(database, {
        inquiryId,
        staffId: staff.id,
        orgId
      });
      if (result.caseCleared && result.caseRow) {
        // emit() is emit(db, name, payload, opts) — src/events/bus.mjs. This call
        // used to pass (name, payload), so the name landed in the `db` slot and the
        // bus threw "event name required". The throw surfaced as a 500 AFTER
        // clearInquiry had already committed: the inquiry was cleared, the event was
        // lost, and the specialist was told it failed. Shape kept identical to the
        // mark_cleared/close emit below so both paths produce the same payload.
        await emitFn(
          database,
          "inquiry.removed",
          {
            caseId: result.caseRow.case_id,
            inquiryRemovalCaseId: result.caseRow.id,
            inquiryId: result.inquiry.id,
            fundingRoundId: result.caseRow.funding_round_id,
            source: "staff_clear_inquiry"
          },
          {
            orgId,
            clientId: result.caseRow.client_id,
            idempotencyKey: `inquiry.removed:case:${result.caseRow.id}`
          }
        );
      }
      return res.status(200).json({ ok: true, inquiry: result.inquiry, case: result.caseRow, case_cleared: result.caseCleared });
    }

    if (action === "create") {
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id required" });
      }
      // Client must belong to the session org. Without this, a staff member
      // could attach another company's client id to a case in their own org.
      const owned = await database.query(
        `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
        [body.client_id, orgId]
      );
      if (!owned.rows.length) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const c = await createCase(database, {
        orgId,
        row: {
          ...body,
          requested_by: body.requested_by || staff.name || staff.email || staff.id
        }
      });
      return res.status(200).json({ ok: true, case: c });
    }

    if (!isUuid(body.id)) {
      return res.status(400).json({ ok: false, error: "id required" });
    }

    if (action === "generate") {
      const result = await generateFromCrs(database, { orgId, caseId: body.id });
      const status = result.httpStatus || 200;
      const payload = { ...result };
      delete payload.httpStatus;
      if (!payload.ok && status === 404) {
        return res.status(404).json({
          ok: false,
          error: "not_found",
          reason: "not_found",
          message: payload.message
        });
      }
      return res.status(status).json(payload);
    }

    if (action === "update") {
      const c = await updateCase(database, { orgId, id: body.id, patch: body });
      if (!c) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, case: c });
    }

    if (action === "gate_override") {
      try {
        const c = await overrideBureauGate(database, {
          orgId,
          caseId: body.id,
          staffId: staff.id,
          staffRole: staff.role
        });
        return res.status(200).json({ ok: true, case: c });
      } catch (err) {
        return res.status(err.status || 400).json({
          ok: false,
          error: err.code || "gate_override_failed",
          message: err.message
        });
      }
    }

    if (action === "send") {
      try {
        const wantMail = body.mail === true || body.channels?.mail === true;
        // Per-case override on the send row (e.g. downgrade to priority).
        // Otherwise ai_bureau_config.mail_service_level for that bureau.
        const mailServiceOverride =
          body.mail_service_level || body.mailServiceLevel || null;
        const mailSender = wantMail
          ? async ({ caseRow }) => {
              const bureau = caseRow.selected_bureaus_raw;
              const serviceLevel = await loadMailServiceLevel(database, {
                orgId,
                bureau,
                override: mailServiceOverride
              });
              const to = body.mail_to || body.mailTo
                || await loadBureauMailAddress(database, { orgId, bureau });
              const from = body.mail_from || body.mailFrom
                || await loadClientReturnAddress(database, {
                  orgId,
                  clientId: caseRow.client_id
                });
              if (!from) {
                return {
                  providerId: null,
                  outcome: "mail_failed:return_address_required"
                };
              }
              // PDF preferred. resolveFundingLetterPdf picks funding-stack
              // PDFs only (inquiry_removal + personal_info — never dispute).
              const content = await resolveInquiryLetterContent(caseRow, body, {
                db: database,
                orgId,
                clientId: caseRow.client_id,
                store: deps.store || storeFromEnv()
              });
              const sent = await mailBureauLetter({
                description: `Inquiry case ${caseRow.case_id || caseRow.id}`,
                html: content.html,
                pdf: content.pdf,
                serviceLevel,
                bureau,
                to,
                from,
                metadata: {
                  orgId,
                  clientId: caseRow.client_id,
                  caseId: caseRow.id,
                  stack: "funding",
                  letterSource: content.source
                }
              });
              if (!sent.ok) {
                return {
                  providerId: null,
                  outcome: `mail_failed:${sent.error || "unknown"}`
                };
              }
              return {
                providerId: sent.providerId,
                outcome: "sent",
                serviceLevel: sent.serviceLevel || serviceLevel,
                letterSource: content.source
              };
            }
          : null;
        const result = await sendCase(database, {
          caseId: body.id,
          staffId: staff.id,
          orgId,
          mail: wantMail,
          portal: body.portal === true || body.channels?.portal === true,
          portalConfirmation: body.portal_confirmation || body.portalConfirmation || null,
          portalUploadedAt: body.portal_uploaded_at || body.portalUploadedAt || null,
          note: body.note || null,
          mailSender
        });
        return res.status(200).json({ ok: true, ...result });
      } catch (err) {
        if (err instanceof SendGateError) {
          /* `missing` names the papers still outstanding, so the screen can say
             WHICH ones rather than the word "incomplete". Null on every refusal
             that is not the document gate. */
          return res.status(err.status || 400).json({
            ok: false,
            error: err.code || "send_gate",
            message: err.message,
            ...(err.missing ? { missing: err.missing } : {})
          });
        }
        throw err;
      }
    }

    // close | mark_cleared
    const status = action === "mark_cleared" ? "Completed" : (body.case_status || "Completed");
    if (!CASE_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: "invalid_case_status" });
    }
    const c = await closeCase(database, {
      orgId,
      id: body.id,
      case_status: status,
      notes: body.notes || null,
      staff
    });
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });

    let event = null;
    if (status === "Completed") {
      event = await emitFn(
        database,
        "inquiry.removed",
        {
          caseId: c.case_id,
          inquiryRemovalCaseId: c.id,
          selectedBureaus: c.selected_bureaus_raw,
          fundingRoundId: c.funding_round_id,
          source: "inquiry_removal_case"
        },
        {
          orgId,
          clientId: c.client_id,
          idempotencyKey: `inquiry.removed:case:${c.id}`
        }
      );
    }

    return res.status(200).json({ ok: true, case: c, event });
  } catch (err) {
    if (err instanceof InquiryCaseError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.status === 404 ? "not_found" : "bad_request",
        message: err.message,
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
