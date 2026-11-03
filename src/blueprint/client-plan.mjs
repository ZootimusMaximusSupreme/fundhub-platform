// Read-only aggregation for the paid Blueprint buyer's actual saved plan.
import { readClientProgress as readProgress } from "../progress/read.mjs";
import { bankStrategy as readBankStrategy } from "../finance/bank-strategy.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";

const REQUIRED_READERS = ["readBusinessPlans", "preparationGuidance", "rankLocalCreditUnions", "websitePrompt"];
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

export class BlueprintClientPlanError extends Error {
  constructor(code) { super(code); this.name = "BlueprintClientPlanError"; this.code = code; }
}

function assertIdentity(value, { orgId, clientId }, { required = false } = {}) {
  const returnedOrg = value?.orgId ?? value?.org_id;
  const returnedClient = value?.clientId ?? value?.client_id ?? value?.client?.id;
  if ((required && (returnedOrg !== orgId || returnedClient !== clientId)) ||
      (returnedOrg != null && returnedOrg !== orgId) ||
      (returnedClient != null && returnedClient !== clientId)) {
    throw new BlueprintClientPlanError("blueprint_plan_scope_mismatch");
  }
}

const CREDIT_SQL = `SELECT id, org_id, client_id, provider, created_at, result
  FROM crs_results
  WHERE client_id = $1::uuid AND org_id = $2::uuid
    AND is_demo IS NOT TRUE
    AND COALESCE(provider, '') <> 'crs_softview_simulated'
    AND COALESCE(result->>'provider', '') <> 'crs_softview_simulated'
    AND LOWER(COALESCE(result->>'simulated', 'false')) NOT IN ('true', '1')
    AND LOWER(COALESCE(result->>'environment', '')) NOT IN ('sandbox', 'simulated')
  ORDER BY created_at DESC LIMIT 1`;

function unknownCredit() {
  return { source: null, reportId: null, asOf: null, authorizedUserReviewRequired: null,
    securedCreditReviewRequired: null, authorizedUserCount: null, thinFile: null,
    authorizedUserFindingCodes: [] };
}

function isGenuine(row) {
  const result = object(row?.result);
  return row?.is_demo !== true && row?.provider !== "crs_softview_simulated" &&
    result.provider !== "crs_softview_simulated" &&
    !["true", "1"].includes(String(result.simulated).toLowerCase()) &&
    !["sandbox", "simulated"].includes(String(result.environment).toLowerCase());
}

function creditFacts(row, runEngine) {
  const result = object(row.result);
  const analysis = result.consumerSignals ? result : runEngine(result);
  const lines = object(analysis?.consumerSignals?.tradelines);
  const au = count(lines.au);
  const thinFile = typeof lines.thinFile === "boolean" ? lines.thinFile : null;
  const findingCodes = [...new Set((Array.isArray(analysis?.findings) ? analysis.findings : [])
    .map((finding) => String(finding?.code || "").toUpperCase())
    .filter((code) => ["AU_HIGH_UTIL", "AU_NEGATIVE_MARKS", "AU_GOOD_KEEP"].includes(code)))];
  const asOf = row.created_at instanceof Date ? row.created_at.toISOString() : text(row.created_at);
  return { source: "saved_credit_report", reportId: row.id, asOf,
    authorizedUserReviewRequired: au !== null ? au > 0 : findingCodes.length ? true : null,
    securedCreditReviewRequired: thinFile, authorizedUserCount: au, thinFile,
    authorizedUserFindingCodes: findingCodes };
}

/** Dependencies that author guidance/directory data are injected by the API owner. */
export async function buildBlueprintClientPlan(db, { orgId, clientId, now = new Date() } = {}, deps = {}) {
  if (!db?.query || !orgId || !clientId) throw new BlueprintClientPlanError("blueprint_plan_scope_required");
  for (const name of REQUIRED_READERS) {
    if (typeof deps[name] !== "function") throw new BlueprintClientPlanError(`blueprint_plan_dependency_missing:${name}`);
  }
  const asOf = new Date(now);
  if (!Number.isFinite(asOf.getTime())) throw new BlueprintClientPlanError("blueprint_plan_time_invalid");
  const scope = { orgId, clientId, now: asOf };
  const clientResult = await db.query(
    `SELECT id, org_id, first_name, last_name, custom_fields
       FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`, [clientId, orgId]);
  const client = clientResult.rows[0];
  if (!client) return null;
  assertIdentity({ orgId: client.org_id, clientId: client.id }, scope, { required: true });
  const warnings = [];
  const warn = (code, source) => warnings.push({ code, source });
  const readClientProgress = deps.readClientProgress || readProgress;
  const bankStrategy = deps.bankStrategy || readBankStrategy;
  const [businessPlans, progress, bankPlan, creditContext] = await Promise.all([
    Promise.resolve().then(() => deps.readBusinessPlans(db, scope)).then((value) => {
      if (!value || !Array.isArray(value.businesses) || !Array.isArray(value.existingBusinesses)) {
        throw new BlueprintClientPlanError("blueprint_business_plans_unavailable");
      }
      if (value.businesses.length > 4) throw new BlueprintClientPlanError("blueprint_plan_business_limit_exceeded");
      assertIdentity(value, scope, { required: true });
      return value;
    }),
    Promise.resolve().then(() => readClientProgress(db, scope)).then((value) => {
      if (!value || typeof value !== "object") throw new BlueprintClientPlanError("blueprint_progress_unavailable");
      assertIdentity(value, scope);
      return value;
    }),
    Promise.resolve().then(() => bankStrategy(db, { orgId, clientId, asOf })).then((value) => {
      if (!value || value.ok === false) { warn("bank_plan_unavailable", "bank_strategy"); return null; }
      if (!value.client?.id) throw new Error("bank_plan_contract_invalid");
      assertIdentity(value, scope);
      return value;
    }).catch((error) => {
      if (error?.code === "blueprint_plan_scope_mismatch") throw error;
      warn("bank_plan_unavailable", "bank_strategy"); return null;
    }),
    db.query(CREDIT_SQL, [clientId, orgId]).then((value) => {
      const row = value.rows[0];
      if (!row) return unknownCredit();
      assertIdentity(row, scope, { required: true });
      if (!isGenuine(row)) return unknownCredit();
      try { return creditFacts(row, deps.runTierEngine || runTierEngineFromCrsResult); }
      catch { warn("credit_context_unavailable", "saved_credit_report"); return unknownCredit(); }
    }).catch((error) => {
      if (error?.code === "blueprint_plan_scope_mismatch") throw error;
      warn("credit_context_unavailable", "saved_credit_report"); return unknownCredit();
    })
  ]);
  const cf = object(client.custom_fields);
  const homeState = text(businessPlans.homeState) || text(cf.home_state);
  const postalCode = text(businessPlans.postalCode) || text(cf.postal_code) || text(cf.zip);
  const location = { homeState, postalCode, availableCashCents: businessPlans.availableCashCents ?? null, limit: 5 };
  let localBanks;
  try {
    const ranked = await deps.rankLocalCreditUnions(location);
    if (!ranked || typeof ranked.status !== "string" || !Array.isArray(ranked.candidates) ||
        (ranked.candidates.length && !ranked.source)) throw new Error("directory_contract_invalid");
    localBanks = { ...ranked, asOf: ranked.source?.asOf ?? null };
  } catch {
    warn("local_banks_unavailable", "credit_union_directory");
    localBanks = { status: "unavailable", location: { homeState, postalCode }, source: null, asOf: null,
      candidates: [], limitations: ["The credit-union directory could not be read. Try again."] };
  }
  const contexts = { homeState, postalCode, creditContext,
    availableCashCents: businessPlans.availableCashCents ?? null,
    monthlyIncomeCents: businessPlans.monthlyIncomeCents ?? null };
  const lessons = await deps.preparationGuidance(contexts);
  if (!Array.isArray(lessons)) throw new BlueprintClientPlanError("blueprint_lessons_unavailable");
  const businessLessons = await Promise.all(businessPlans.businesses.map(async (business) => {
    const perBusiness = await deps.preparationGuidance({ ...contexts, business });
    if (!Array.isArray(perBusiness)) throw new BlueprintClientPlanError("blueprint_lessons_unavailable");
    return { planId: business.id, lessons: perBusiness };
  }));
  const websitePrompts = [];
  for (const [kind, rows] of [["plan", businessPlans.businesses], ["existing", businessPlans.existingBusinesses]]) {
    for (const business of Array.isArray(rows) ? rows : []) {
      const entity = object(business.entity_data);
      const prompt = await deps.websitePrompt({ ...business,
        legalName: business.legalName ?? entity.legal_name ?? business.name,
        activity: business.activity ?? entity.activity ?? entity.industry,
        formationState: business.formationState ?? entity.formation_state,
        state: business.operatingState ?? entity.state ?? business.state });
      if (!text(prompt)) throw new BlueprintClientPlanError("blueprint_website_prompt_unavailable");
      websitePrompts.push({ planId: kind === "plan" ? business.id : null,
        businessId: kind === "existing" ? business.id : business.businessId ?? null, prompt });
    }
  }
  const name = [text(client.first_name), text(client.last_name)].filter(Boolean).join(" ") || null;
  return { ok: true, client: { name }, businessPlans, progress, lessons,
    localBanks, bankPlan, creditContext, businessLessons, websitePrompts, warnings: warnings.sort((a, b) => a.code.localeCompare(b.code)) };
}
