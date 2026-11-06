import { db } from "../../src/db.mjs";
import {
  ClientInquiryError, readClientInquiries, recordClientInquirySubmission,
  launchClientInquiryCall, checkClientInquiryEvidence
} from "../../src/blueprint/client-inquiries.mjs";

const FIELDS = {
  record_submission: ["action", "caseId", "reference", "receiptDocumentId", "idempotencyKey"],
  launch_call: ["action", "caseId", "authorization", "idempotencyKey"],
  check_evidence: ["action", "caseId"]
};

export default async function handler(req, res, deps = {}) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const gate = deps.requireBlueprintFulfillmentScope
      || (await import("../../src/blueprint/fulfillment-access.mjs")).requireBlueprintFulfillmentScope;
    const scope = await gate(req, res, deps);
    if (!scope) return;
    const database = deps.db || db;
    const services = deps.services || {
      read: readClientInquiries, recordSubmission: recordClientInquirySubmission,
      launchCall: launchClientInquiryCall, checkEvidence: checkClientInquiryEvidence
    };
    if (req.method === "GET") return res.status(200).json(await services.read(database, scope, deps));
    const input = req.body;
    const fields = input && !Array.isArray(input) && FIELDS[input.action];
    if (!fields || Object.keys(input).some(key => !fields.includes(key))) {
      return res.status(400).json({ ok: false, error: "invalid_action", message: "Choose one of your available inquiry actions." });
    }
    if (scope.engagement.status !== "active") {
      return res.status(409).json({ ok: false, error: "engagement_ended", message: "This engagement has ended." });
    }
    const action = { record_submission: services.recordSubmission,
      launch_call: services.launchCall, check_evidence: services.checkEvidence }[input.action];
    return res.status(200).json(await action(database, scope, input, deps));
  } catch (error) {
    if (error instanceof ClientInquiryError) {
      return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    }
    return res.status(500).json({ ok: false, error: "inquiry_work_unavailable",
      message: "Your inquiry work could not be loaded. Please try again." });
  }
}
