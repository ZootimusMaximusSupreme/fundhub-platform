// Read-only aggregation for the paid Blueprint buyer's actual saved plan.
import { planMonthlyDebtPayments } from "./payoff-plan.mjs";
import { readBlueprintLetterReadiness } from "./letter-mailing.mjs";
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
  let letterReadiness = null;
  if (progress.waypoints?.some(step => step.key === "blueprint_dispute_mail_letters" &&
      ["not_started", "in_progress", "blocked"].includes(step.state))) {
    try {
      letterReadiness = await (deps.readBlueprintLetterReadiness || readBlueprintLetterReadiness)(db, scope);
      assertIdentity(letterReadiness, scope, { required: true });
      if (!["ready", "requested", "not_ready"].includes(letterReadiness.state)) throw new Error("invalid_letter_readiness");
    } catch (error) {
      if (error?.code === "blueprint_plan_scope_mismatch") throw error;
      letterReadiness = { state: "unavailable", usableLetterCount: null, mailingOrderCount: null };
      warn("letter_readiness_unavailable", "saved_letter_files");
    }
  }
  let letterResponses;
  try {
    const rows = (await db.query(`SELECT id, current_version_id, title, generated_at, metadata
      FROM documents WHERE client_id = $1::uuid AND org_id = $2::uuid AND kind = 'bureau_response'
      ORDER BY generated_at DESC, id LIMIT 50`, [clientId, orgId])).rows;
    letterResponses = rows.map(d => {
      const v = d.metadata?.bureau_response_validation;
      const current = v?.schema === 1 && v.validator === 'bureau-response-reader' && v.document_id === String(d.id) && v.version_id === String(d.current_version_id);
      return { documentId: String(d.id), title: d.title || 'Bureau response', receivedAt: d.generated_at,
        validationStatus: current && ['accepted','request_more','hold'].includes(v.status) ? v.status : 'pending',
        reason: current ? text(v.reason) : null, reviewedAt: current ? v.reviewed_at : null };
    });
  } catch { letterResponses = null; warn("letter_responses_unavailable", "saved_document_reviews"); }
  const knownDeposits = businessPlans.businesses.flatMap(b => b.bankPreparation?.relationships || []);
  const depositTotal = knownDeposits.reduce((sum, r) => sum + (r.depositPlanCents ?? 0), 0);
  const missingReservations = businessPlans.cashBufferCents == null || businessPlans.oneTimePayoffCents == null || knownDeposits.some(r => r.depositPlanCents == null);
  const available = businessPlans.availableCashCents;
  const commitmentTotal = depositTotal + (businessPlans.cashBufferCents ?? 0) + (businessPlans.oneTimePayoffCents ?? 0);
  const cashPlan = { availableCashCents: available, bankDepositTotalCents: depositTotal, cashBufferCents: businessPlans.cashBufferCents ?? null,
    oneTimePayoffCents: businessPlans.oneTimePayoffCents ?? null, knownCommitmentsCents: commitmentTotal,
    status: available == null || missingReservations ? "review_needed" : commitmentTotal > available ? "overcommitted" : "ready",
    remainingCashCents: available == null || missingReservations ? null : available - commitmentTotal,
    banks: (Array.isArray(bankPlan?.recommended_banks) ? bankPlan.recommended_banks : []).slice(0, 5).map(bank => ({ name: bank.name,
      minimumDepositReferenceCents: bank.minimum_deposit_cents ?? null,
      cashFit: available == null || missingReservations || bank.minimum_deposit_cents == null ? "review_needed" : bank.minimum_deposit_cents <= available - commitmentTotal ? "within_reported_budget" : "exceeds_remaining_budget" })) };
  const payoffCalculation = businessPlans.payoffPlan ? planMonthlyDebtPayments(businessPlans.payoffPlan) : null;
  const name = [text(client.first_name), text(client.last_name)].filter(Boolean).join(" ") || null;
  return { ok: true, client: { name }, businessPlans, progress, lessons,
    localBanks, bankPlan, creditContext, businessLessons, websitePrompts, cashPlan, payoffCalculation, letterResponses, letterReadiness, warnings: warnings.sort((a, b) => a.code.localeCompare(b.code)) };
}
