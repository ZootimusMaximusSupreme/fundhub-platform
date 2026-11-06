import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { reviewOwnedBankDocument } from "../../src/blueprint/bank-evidence.mjs";
import { getBlueprintFulfillmentAccess, requireBlueprintFulfillmentScope } from "../../src/blueprint/fulfillment-access.mjs";
import { BlueprintFundingError, openBlueprintLender, finishBlueprintSubmissions, readBlueprintFunding, reportBlueprintApplication } from "../../src/blueprint/client-funding.mjs";

const fields = {
  finish_submissions: ["action","idempotencyKey"],
  open_lender: ["action","lenderId","businessId","idempotencyKey"],
  report_application: ["action","applicationId","status","evidenceDocumentId","reference","approvedAmount","idempotencyKey"]
};

const validId = value => typeof value==="string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const validMoney = value => typeof value==="number" && Number.isFinite(value) && value>0 &&
  value<=999999999999.99 && Math.abs(Math.round(value*100)-value*100)<0.00001;

async function staffReview(req,res,deps) {
  res.setHeader("Cache-Control","private, no-store");
  const database=deps.db || db;
  const principal=await (deps.requirePrincipal || requirePrincipal)(req,res,["staff"],{db:database});
  if (!principal) return;
  const staff=principal.staff;
  if (principal.kind!=="staff" || !staff || !["owner","admin","csm","funding_advisor"].includes(staff.role))
    return res.status(403).json({ok:false,error:"csm_required"});
  const input=req.method==="GET" ? req.query : req.body;
  if (!validId(input?.clientId)) throw new BlueprintFundingError("invalid_client",400);
  const scope={orgId:staff.org_id,clientId:input.clientId,now:new Date()};
  if (!(await (deps.requireClientInOrg || requireClientInOrg)(res,database,staff,scope.clientId))) return;
  scope.engagement=await (deps.getBlueprintFulfillmentAccess || getBlueprintFulfillmentAccess)(database,scope);
  if (!scope.engagement) throw new BlueprintFundingError("engagement_not_found",404);
  if (req.method==="GET") {
    if (Object.keys(input).some(k=>k!=="clientId")) throw new BlueprintFundingError("unexpected_query",400);
    return res.status(200).json(await (deps.readBlueprintFunding || readBlueprintFunding)(database,scope,deps));
  }
  const accepted=["action","clientId","applicationId","evidenceDocumentId","decision","approvedAmount","fundedAmount","note"];
  if (Object.keys(input).some(k=>!accepted.includes(k)) || !validId(input.applicationId) ||
      !validId(input.evidenceDocumentId) || !["approved","declined","funded"].includes(input.decision) ||
      typeof input.note!=="string" || input.note.trim().length<8 || input.note.length>1000 ||
      (input.approvedAmount!=null && (!validMoney(input.approvedAmount) || input.decision==="declined")) ||
      (input.decision==="approved" && !validMoney(input.approvedAmount)) ||
      (input.fundedAmount!=null && input.decision!=="funded") || (input.decision==="funded" && !validMoney(input.fundedAmount)))
    throw new BlueprintFundingError("invalid_evidence_review",400);
  const result=await (deps.reviewOwnedBankDocument || reviewOwnedBankDocument)(database,{
    orgId:staff.org_id,staff,clientId:scope.clientId,applicationId:input.applicationId,
    evidenceDocumentId:input.evidenceDocumentId,decision:input.decision,approvedAmount:input.approvedAmount || null,
    fundedAmount:input.fundedAmount || null,note:input.note.trim()
  });
  return res.status(result.ok ? 200 : 409).json(result);
}

export default async function handler(req,res,deps = {}) {
  if (!["GET","POST"].includes(req.method)) {
    res.setHeader("Allow","GET, POST");
    return res.status(405).json({ok:false,error:"method_not_allowed"});
  }
  try {
    if ((req.method==="GET" && Object.hasOwn(req.query || {},"clientId")) ||
        (req.method==="POST" && req.body?.action==="review_bank_evidence")) return await staffReview(req,res,deps);
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
    const actions = {
      open_lender: deps.openBlueprintLender || openBlueprintLender,
      finish_submissions: deps.finishBlueprintSubmissions || finishBlueprintSubmissions,
      report_application: deps.reportBlueprintApplication || reportBlueprintApplication
    };
    const act=actions[body.action];
    const saved = await act(database,scope,body,deps);
    return res.status(200).json(saved);
  } catch (error) {
    if (error instanceof BlueprintFundingError) return res.status(error.status).json({ok:false,error:error.code});
    return res.status(503).json({ok:false,error:"funding_temporarily_unavailable"});
  }
}
