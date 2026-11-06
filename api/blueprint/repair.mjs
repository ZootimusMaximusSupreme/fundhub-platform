import { db } from "../../src/db.mjs";
import { ClientRepairError, readClientRepair, generateClientRepairLetters, recordClientRepairSubmission } from "../../src/blueprint/client-repair.mjs";

const FIELDS = { generate: ["action", "idempotencyKey"], record_submission: ["action", "letterId", "reference", "receiptDocumentId", "channel", "idempotencyKey"] };

export default async function handler(req, res, deps = {}) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST"); return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const gate = deps.requireBlueprintFulfillmentScope
      || (await import("../../src/blueprint/fulfillment-access.mjs")).requireBlueprintFulfillmentScope;
    const scope = await gate(req, res, { ...deps, allowManagedWrites: true });
    if (!scope) return;
    const database = deps.db || db;
    const services = deps.services || { read: readClientRepair, generate: generateClientRepairLetters, recordSubmission: recordClientRepairSubmission };
    if (req.method === "GET") return res.status(200).json(await services.read(database, scope, deps));
    const input = req.body;
    const fields = input && !Array.isArray(input) && FIELDS[input.action];
    if (!fields || Object.keys(input).some(key => !fields.includes(key))) return res.status(400).json({ ok: false, error: "invalid_action", message: "Choose one of your available repair actions." });
    const action = input.action === "generate" ? services.generate : services.recordSubmission;
    return res.status(200).json(await action(database, scope, input, deps));
  } catch (error) {
    if (error instanceof ClientRepairError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    return res.status(500).json({ ok: false, error: "repair_work_unavailable", message: "Your repair work could not be loaded. Please try again." });
  }
}
