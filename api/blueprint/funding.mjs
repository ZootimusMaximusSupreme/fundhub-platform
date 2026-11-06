import { db } from "../../src/db.mjs";
import { requireBlueprintFulfillmentScope } from "../../src/blueprint/fulfillment-access.mjs";
import { BlueprintFundingError, openBlueprintLender, readBlueprintFunding, reportBlueprintApplication } from "../../src/blueprint/client-funding.mjs";

const fields = {
  open_lender: ["action","lenderId","businessId","idempotencyKey"],
  report_application: ["action","applicationId","status","evidenceDocumentId","reference","approvedAmount","idempotencyKey"]
};

export default async function handler(req,res,deps = {}) {
  if (!["GET","POST"].includes(req.method)) {
    res.setHeader("Allow","GET, POST");
    return res.status(405).json({ok:false,error:"method_not_allowed"});
  }
  try {
    const scope = await (deps.requireBlueprintFulfillmentScope || requireBlueprintFulfillmentScope)(req,res,deps);
    if (!scope) return;
    const database = deps.db || db;
    if (Object.keys(req.query || {}).length) throw new BlueprintFundingError("unexpected_query",400);
    if (req.method === "GET") {
      const view = await (deps.readBlueprintFunding || readBlueprintFunding)(database,scope,deps);
      return res.status(200).json(view);
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || !Object.hasOwn(fields,body.action) ||
        Object.keys(body).some(k => !fields[body.action].includes(k))) throw new BlueprintFundingError("unexpected_fields",400);
    const act = body.action === "open_lender" ? deps.openBlueprintLender || openBlueprintLender :
      deps.reportBlueprintApplication || reportBlueprintApplication;
    const saved = await act(database,scope,body,deps);
    return res.status(200).json(saved);
  } catch (error) {
    if (error instanceof BlueprintFundingError) return res.status(error.status).json({ok:false,error:error.code});
    return res.status(503).json({ok:false,error:"funding_temporarily_unavailable"});
  }
}
