// Server-owned preparation records. Plans never pretend to be formed businesses.
import { randomUUID } from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";
import { auditCompanies } from "../underwrite/company-audit.mjs";

export const BLUEPRINT_PLANS_FIELD = "blueprint_business_plans";
export const PREPARATION_PROGRESS_KEYS = Object.freeze([
  "credit_review", "budget", "authorized_user", "secured_credit", "business_profile",
  "business_website", "business_listings", "local_banking", "chexsystems", "bank_opening",
  "bank_deposit", "business_credit", "merchant_tools", "employment", "calendar", "formation", "ein"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const STEP_STATES = new Set(["not_started", "in_progress", "reported_complete", "blocked"]);
const SETTINGS = ["targetBusinessCount", "availableCashCents", "monthlyIncomeCents", "homeState", "postalCode", "hasExistingBusiness", "started", "cashBufferCents", "oneTimePayoffCents"];
const EDITABLE_BUSINESS = ["id", "name", "activity", "formationState", "operatingState", "formationStatus", "formationDate", "ownershipSince", "operatingSince", "businessId", "entityId", "website", "bankPreparation"];
const DOC_TYPES = { formation: "articles_of_organization", ein: "ein_letter" };
const has = (o, key) => Object.prototype.hasOwnProperty.call(o || {}, key);
const isObject = (o) => o && typeof o === "object" && !Array.isArray(o);

export class BusinessPlanError extends Error {
  constructor(code, message = code, status = 400) { super(message); this.code = code; this.status = status; }
}
function fail(code, message, status) { throw new BusinessPlanError(code, message, status); }
function uuid(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !UUID.test(value)) fail("invalid_id", `${field} must be a valid ID.`);
  return value.toLowerCase();
}
function text(value, field, max, required = false) {
  if (value === null || value === undefined || value === "") { if (required) fail("required_field", `Add ${field}.`); return null; }
  if (typeof value !== "string") fail("invalid_field", `${field} must be text.`);
  const out = value.trim();
  if (out.length > max || (required && !out)) fail("invalid_field", `${field} must have ${required ? "1 to " : "no more than "}${max} characters.`);
  return out || null;
}
function stateCode(value, field) {
  const out = text(value, field, 2);
  if (out === null) return null;
  if (!STATES.has(out.toUpperCase())) fail("invalid_state", `Choose a valid ${field}.`);
  return out.toUpperCase();
}
function day(value, field, now, future = false) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("invalid_date", `${field} must be a date like 2026-11-02.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || (!future && value > now.toISOString().slice(0, 10))) fail("invalid_date", `Check ${field}; it must be an actual date${future ? "" : " no later than today"}.`);
  return value;
}
function cents(value, field) {
  if (value === null || value === "") return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000) fail("invalid_amount", `${field} must be a whole number of cents, or unknown.`);
  return value;
}
function allowedFields(input, keys) {
  if (!isObject(input)) fail("invalid_input", "Send an object with the fields to save.");
  for (const key of Object.keys(input)) if (!keys.includes(key)) fail("field_not_accepted", `${key} cannot be changed here.`);
}
function emptyState() {
  return { version: 1, setupStep: 0, targetBusinessCount: 4, availableCashCents: null, monthlyIncomeCents: null, cashBufferCents: null, oneTimePayoffCents: null, payoffPlan: null, homeState: null, postalCode: null, hasExistingBusiness: null, startedAt: null, businesses: [], stepProgress: [], updatedAt: null };
}
function savedState(customFields) {
  const stored = customFields?.[BLUEPRINT_PLANS_FIELD];
  if (stored === undefined || stored === null) return emptyState();
  if (!isObject(stored) || stored.version !== 1 || !Array.isArray(stored.businesses) || stored.businesses.length > 4 || !Array.isArray(stored.stepProgress)) fail("stored_plan_invalid", "The saved plan needs a team review before it can be changed.", 500);
  return { ...emptyState(), ...stored };
}
async function clientState(db, orgId, clientId, lock = false) {
  uuid(orgId, "company"); uuid(clientId, "client");
  const row = (await db.query(`SELECT id, custom_fields FROM clients WHERE id = $1::uuid AND org_id = $2::uuid${lock ? " FOR UPDATE" : ""}`, [clientId, orgId])).rows[0];
  if (!row) fail("client_not_found", "Your client file was not found.", 404);
  return savedState(row.custom_fields);
}
async function persist(db, orgId, clientId, state) {
  await db.query(`UPDATE clients SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{blueprint_business_plans}', $3::jsonb, true), updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`, [clientId, orgId, JSON.stringify(state)]);
}
function businessIdFrom(plan) { return plan.businessId || null; }
function evidenceIds(state) { return state.businesses.flatMap(b => Object.values(b.evidence || {}).map(e => e?.documentId).filter(Boolean)); }
async function documentRows(db, { orgId, clientId }, ids) {
  if (!ids.length) return [];
  return (await db.query(`SELECT d.id, d.kind, d.subtype, d.title, d.generated_at, d.current_version_id, d.metadata,
    r.status AS review_status, r.reviewed_at, r.entity_id AS reviewed_entity_id
    FROM documents d LEFT JOIN document_vault_reviews r ON r.document_id = d.id AND r.org_id = d.org_id AND r.client_id = d.client_id
    WHERE d.org_id = $1::uuid AND d.client_id = $2::uuid AND d.id = ANY($3::uuid[])`, [orgId, clientId, ids])).rows;
}
function evidenceView(plan, kind, rows) {
  const ref = plan.evidence?.[kind]?.documentId;
  if (!ref) return { documentId: null, status: "not_added", filename: null, receivedAt: null, reviewedAt: null };
  const doc = rows.find(d => String(d.id) === ref && d.kind === "client_upload" && d.subtype === DOC_TYPES[kind]);
  if (!doc) return { documentId: ref, status: "unavailable", filename: null, receivedAt: null, reviewedAt: null };
  const entity = doc.reviewed_entity_id || doc.metadata?.entity_id || null;
  const correctBusiness = !entity || entity === plan.entityId;
  const recentReview = doc.reviewed_at && new Date(doc.reviewed_at) >= new Date(doc.generated_at);
  const reviewed = correctBusiness && recentReview && ["accepted", "rejected"].includes(doc.review_status);
  return { documentId: ref, status: !correctBusiness ? "unavailable" : reviewed ? (doc.review_status === "accepted" ? "reviewed" : "rejected") : "evidence_received", filename: doc.metadata?.original_filename || doc.title || null, receivedAt: doc.generated_at, reviewedAt: reviewed ? doc.reviewed_at : null };
}
function existingView(row) {
  const d = row.entity_data || {};
  return { id: String(row.id), name: row.name || null, ageMonths: row.age_months ?? null, formationState: d.formation_state || null, operatingState: d.state || null, formationDate: d.incorporated_date || null, ownershipSince: d.ownership_since || null, operatingSince: d.operating_since || null, activity: d.activity || d.industry || null, entityId: typeof d.entity_id === "string" && UUID.test(d.entity_id) ? d.entity_id : null };
}
async function shape(db, scope, state, audit = auditCompanies) {
  const actual = (await db.query(`SELECT id, name, age_months, entity_data FROM businesses WHERE org_id = $1::uuid AND client_id = $2::uuid ORDER BY created_at, id`, [scope.orgId, scope.clientId])).rows;
  const docs = await documentRows(db, scope, evidenceIds(state));
  const attached = new Set(evidenceIds(state));
  const availableEvidence = (await db.query(`SELECT d.id, d.subtype, d.title, d.generated_at, d.metadata, r.entity_id AS reviewed_entity_id
    FROM documents d LEFT JOIN document_vault_reviews r ON r.document_id = d.id AND r.org_id = d.org_id AND r.client_id = d.client_id
    WHERE d.org_id = $1::uuid AND d.client_id = $2::uuid AND d.kind = 'client_upload'
      AND d.subtype = ANY($3::text[]) ORDER BY d.generated_at DESC, d.id LIMIT 100`, [scope.orgId, scope.clientId, Object.values(DOC_TYPES)])).rows
    .filter(d => !attached.has(String(d.id)))
    .map(d => ({ documentId: String(d.id), kind: Object.keys(DOC_TYPES).find(k => DOC_TYPES[k] === d.subtype), filename: d.metadata?.original_filename || d.title || 'Saved document', receivedAt: d.generated_at, entityId: d.reviewed_entity_id || d.metadata?.entity_id || null }));
  const businesses = state.businesses.map(b => ({ ...b, bankPreparation: { documentsReady: false, accountOpeningIssue: false, relationships: [], ...b.bankPreparation }, evidence: { formation: evidenceView(b, "formation", docs), ein: evidenceView(b, "ein", docs) } }));
  const advice = audit(actual, { plans: businesses, targetBusinessCount: state.targetBusinessCount });
  return { ...state, orgId: scope.orgId, clientId: scope.clientId, businesses, availableEvidence, existingBusinesses: actual.map(existingView), businessPreparation: advice.businessPreparation || null };
}
export async function readBusinessPlans(db, scope, { auditCompaniesImpl = auditCompanies } = {}) {
  return shape(db, scope, await clientState(db, scope.orgId, scope.clientId), auditCompaniesImpl);
}
function settings(state, input, now) {
  allowedFields(input, SETTINGS);
  if (has(input, "targetBusinessCount")) {
    if (![3, 4].includes(input.targetBusinessCount)) fail("invalid_business_count", "Choose 3 or 4 separate business plans.");
    if (input.targetBusinessCount < state.businesses.length) fail("saved_plans_exceed_target", "Keep the target at 4 while you have four saved business plans.", 409);
    state.targetBusinessCount = input.targetBusinessCount;
  }
  for (const key of ["availableCashCents", "monthlyIncomeCents", "cashBufferCents", "oneTimePayoffCents"]) if (has(input, key)) state[key] = cents(input[key], key);
  if (has(input, "homeState")) state.homeState = stateCode(input.homeState, "home state");
  if (has(input, "postalCode")) { const postal = text(input.postalCode, "ZIP code", 10); if (postal !== null && !/^\d{5}(-\d{4})?$/.test(postal)) fail("invalid_postal_code", "Use a five-digit ZIP code."); state.postalCode = postal; }
  if (has(input, "hasExistingBusiness")) { if (input.hasExistingBusiness !== null && typeof input.hasExistingBusiness !== "boolean") fail("invalid_existing_business", "Choose yes, no, or unknown for existing businesses."); state.hasExistingBusiness = input.hasExistingBusiness; }
  if (has(input, "hasExistingBusiness") && input.hasExistingBusiness !== null) state.setupStep = Math.max(state.setupStep || 0, 1);
  if (has(input, "targetBusinessCount")) state.setupStep = Math.max(state.setupStep || 0, 2);
  if (state.homeState && state.postalCode) state.setupStep = Math.max(state.setupStep || 0, 3);
  if (has(input, "started")) { if (typeof input.started !== "boolean") fail("invalid_started", "started must be true or false."); if (input.started && !state.startedAt) state.startedAt = now.toISOString(); }
}
function bankRelationship(input, now) {
  allowedFields(input, ["id", "bankName", "accountType", "status", "plannedOpenOn", "openedOn", "depositPlanCents", "depositReportedCents", "depositedOn", "seasoningDays", "nextReviewOn"]);
  const id = uuid(input.id, "bank relationship");
  const bankName = text(input.bankName, "bank name", 120, true);
  if (!["personal_checking", "business_checking", "savings"].includes(input.accountType)) fail("invalid_account_type", "Choose personal checking, business checking, or savings.");
  if (!["planned", "reported_open", "reported_funded"].includes(input.status)) fail("invalid_relationship_status", "A bank relationship can be planned, reported open, or reported funded.");
  const plannedOpenOn = day(input.plannedOpenOn, "planned opening date", now, true);
  const openedOn = day(input.openedOn, "reported opening date", now);
  const depositedOn = day(input.depositedOn, "reported deposit date", now);
  const nextReviewOn = day(input.nextReviewOn, "next review date", now, true);
  const depositPlanCents = has(input, "depositPlanCents") ? cents(input.depositPlanCents, "planned deposit") : null;
  const depositReportedCents = has(input, "depositReportedCents") ? cents(input.depositReportedCents, "reported deposit") : null;
  let seasoningDays = null;
  if (input.seasoningDays !== null && input.seasoningDays !== undefined) {
    if (!Number.isInteger(input.seasoningDays) || input.seasoningDays < 0 || input.seasoningDays > 730) fail("invalid_seasoning_days", "Seasoning days must be a whole number from 0 through 730, or unknown.");
    seasoningDays = input.seasoningDays;
  }
  if (input.status === "planned" && (openedOn || depositedOn || depositReportedCents !== null)) fail("planned_relationship_has_no_reported_deposit", "Use a reported relationship status before recording an opening or deposit.");
  if (input.status !== "planned" && !openedOn) fail("opening_date_required", "Add the actual date for an account you report open.");
  if (input.status === "reported_open" && (depositedOn || depositReportedCents !== null)) fail("funded_status_required", "Use reported funded when recording an actual deposit.");
  if (input.status === "reported_funded" && (!depositedOn || depositReportedCents === null)) fail("deposit_details_required", "Add the reported deposit amount and actual deposit date.");
  if (depositedOn && openedOn && depositedOn < openedOn) fail("deposit_before_opening", "A reported deposit date cannot be before the reported opening date.");
  return { id, bankName, accountType: input.accountType, status: input.status, plannedOpenOn, openedOn, depositPlanCents, depositReportedCents, depositedOn, seasoningDays, nextReviewOn };
}
function bankPreparation(input, previous, now) {
  allowedFields(input, ["documentsReady", "accountOpeningIssue", "relationships"]);
  const next = { documentsReady: false, accountOpeningIssue: false, relationships: [], ...previous };
  for (const key of ["documentsReady", "accountOpeningIssue"]) if (has(input, key)) {
    if (typeof input[key] !== "boolean") fail("invalid_bank_preparation", "Bank preparation answers must be yes or no.");
    next[key] = input[key];
  }
  if (has(input, "relationships")) {
    if (!Array.isArray(input.relationships) || input.relationships.length > 3) fail("invalid_relationship_count", "Keep no more than three bank relationships on each business plan.");
    next.relationships = input.relationships.map(r => bankRelationship(r, now));
    if (new Set(next.relationships.map(r => r.id)).size !== next.relationships.length) fail("duplicate_relationship_id", "Use a different saved ID for each bank relationship.");
  }
  return next;
}

async function saveBusiness(db, scope, state, input, now, makeId) {
  allowedFields(input, EDITABLE_BUSINESS);
  const id = has(input, "id") ? uuid(input.id, "business plan") : makeId();
  const previous = state.businesses.find(b => b.id === id);
  if (!previous && state.businesses.length >= state.targetBusinessCount) fail("business_plan_limit", `Your plan already has ${state.targetBusinessCount} businesses.`, 409);
  const next = { id, name: null, activity: null, formationState: null, operatingState: null, formationStatus: "planned", formationDate: null, ownershipSince: null, operatingSince: null, businessId: null, entityId: null, website: null, bankPreparation: { documentsReady: false, accountOpeningIssue: false, relationships: [] }, evidence: { formation: { documentId: null }, ein: { documentId: null } }, ...previous };
  for (const [key, max] of [["name", 120], ["activity", 1500]]) if (has(input, key)) next[key] = text(input[key], key, max, true);
  if (!next.name || !next.activity) fail("required_field", "Add a business name and its actual activity.");
  for (const key of ["formationState", "operatingState"]) if (has(input, key)) next[key] = stateCode(input[key], key);
  if (has(input, "formationStatus")) { if (!["planned", "reported_formed"].includes(input.formationStatus)) fail("invalid_formation_status", "A business can be planned or reported formed."); next.formationStatus = input.formationStatus; }
  for (const key of ["formationDate", "ownershipSince", "operatingSince"]) if (has(input, key)) next[key] = day(input[key], key, now);
  if (next.formationStatus === "planned" && next.formationDate) fail("planned_business_has_no_formation_date", "Record an actual formation date only after this business is formed.");
  if (next.formationStatus === "reported_formed" && !next.formationDate) fail("formation_date_required", "Add the actual formation date for the business you report formed.");
  if (has(input, "website")) { next.website = text(input.website, "website", 250); if (next.website !== null && !/^https?:\/\/[^\s]+$/i.test(next.website)) fail("invalid_website", "Use a full website address starting with https://."); }
  for (const key of ["businessId", "entityId"]) if (has(input, key)) next[key] = uuid(input[key], key, true);
  if (next.businessId) { const row = (await db.query(`SELECT id, entity_data FROM businesses WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`, [next.businessId, scope.orgId, scope.clientId])).rows[0]; if (!row) fail("business_not_found", "Choose an existing business from your own file.", 404); if (next.entityId && row.entity_data?.entity_id && row.entity_data.entity_id !== next.entityId) fail("business_entity_mismatch", "Choose the account group for this existing business.", 409); if (state.businesses.some(b => b.id !== id && businessIdFrom(b) === next.businessId)) fail("business_already_linked", "That existing business already has a preparation plan.", 409); }
  if (next.entityId) { const row = (await db.query(`SELECT id FROM entities WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid AND kind = 'business' AND archived_at IS NULL`, [next.entityId, scope.orgId, scope.clientId])).rows[0]; if (!row) fail("entity_not_found", "Choose an active business from your own file.", 404); if (state.businesses.some(b => b.id !== id && b.entityId === next.entityId)) fail("entity_already_linked", "That business account group already has a preparation plan.", 409); }
  if (has(input, "bankPreparation")) next.bankPreparation = bankPreparation(input.bankPreparation, next.bankPreparation, now);
  next.updatedAt = now.toISOString();
  if (previous) state.businesses = state.businesses.map(b => b.id === id ? next : b); else state.businesses.push(next);
  return id;
}
async function attachEvidence(db, scope, state, input) {
  allowedFields(input, ["businessId", "kind", "documentId"]);
  const id = uuid(input.businessId, "business plan");
  const plan = state.businesses.find(b => b.id === id);
  if (!plan) fail("business_plan_not_found", "Choose one of your saved business plans.", 404);
  if (!has(DOC_TYPES, input.kind)) fail("invalid_evidence_kind", "Choose formation or EIN evidence.");
  const documentId = uuid(input.documentId, "document");
  const doc = (await documentRows(db, scope, [documentId]))[0];
  if (!doc || doc.kind !== "client_upload" || doc.subtype !== DOC_TYPES[input.kind]) fail("evidence_not_found", "Upload the matching document to your own file first.", 404);
  const entity = doc.reviewed_entity_id || doc.metadata?.entity_id || null;
  if (entity && entity !== plan.entityId) fail("evidence_business_mismatch", "That document belongs to a different business.", 409);
  if (state.businesses.some(b => b.id !== id && Object.values(b.evidence || {}).some(e => e?.documentId === documentId))) fail("evidence_already_linked", "That document is already attached to another business plan.", 409);
  if (input.kind === "ein" && !plan.evidence?.formation?.documentId) fail("formation_evidence_required", "Add this business's formation document first.", 409);
  plan.evidence = { ...plan.evidence, [input.kind]: { documentId } };
  return id;
}
function savePayoffPlan(state, input) {
  allowedFields(input, ["strategy", "monthlyBudgetCents", "debts"]);
  if (!["snowball", "avalanche"].includes(input.strategy)) fail("invalid_payoff_strategy", "Choose smallest balance first or highest interest first.");
  if (!Array.isArray(input.debts) || input.debts.length > 20) fail("invalid_debt_list", "Save up to 20 debts.");
  const ids = new Set();
  const debts = input.debts.map(row => {
    allowedFields(row, ["id", "label", "balanceCents", "aprBps", "minimumPaymentCents"]);
    const id = uuid(row.id, "debt"); if (ids.has(id)) fail("duplicate_debt", "Each debt needs its own record."); ids.add(id);
    const label = text(row.label, "debt name", 120, true), balanceCents = cents(row.balanceCents, "debt balance");
    if (balanceCents === null) fail("debt_balance_required", "Add the actual current balance.");
    const minimumPaymentCents = cents(row.minimumPaymentCents ?? null, "minimum payment");
    const aprBps = row.aprBps ?? null;
    if (aprBps !== null && (!Number.isSafeInteger(aprBps) || aprBps < 0 || aprBps > 100_000)) fail("invalid_apr", "Use the actual annual percentage rate or leave it unknown.");
    return { id, label, balanceCents, aprBps, minimumPaymentCents };
  });
  state.payoffPlan = { strategy: input.strategy, monthlyBudgetCents: cents(input.monthlyBudgetCents ?? null, "monthly debt-payment budget"), debts };
}
function saveStep(state, input, now) {
  allowedFields(input, ["stepKey", "businessPlanId", "status", "note", "targetDate"]);
  if (!PREPARATION_PROGRESS_KEYS.includes(input.stepKey)) fail("unknown_step", "Choose a known preparation step.");
  if (!STEP_STATES.has(input.status)) fail("invalid_step_status", "Progress can be not started, in progress, reported complete, or blocked.");
  const businessPlanId = uuid(input.businessPlanId, "business plan", true);
  if (businessPlanId && !state.businesses.some(b => b.id === businessPlanId)) fail("business_plan_not_found", "Choose one of your saved business plans.", 404);
  const previous = state.stepProgress.find(s => s.stepKey === input.stepKey && (s.businessPlanId || null) === businessPlanId);
  const next = { stepKey: input.stepKey, businessPlanId, status: input.status, note: has(input, "note") ? text(input.note, "note", 1500) : previous?.note ?? null, targetDate: has(input, "targetDate") ? day(input.targetDate, "target date", now, true) : previous?.targetDate ?? null, reportedAt: now.toISOString(), verification: "client_reported" };
  state.stepProgress = state.stepProgress.filter(s => s.stepKey !== next.stepKey || (s.businessPlanId || null) !== businessPlanId);
  state.stepProgress.push(next);
}
export async function writeBusinessPlans(db, scope, action, input, { now = new Date(), randomUUIDImpl = randomUUID, auditCompaniesImpl = auditCompanies } = {}) {
  const at = new Date(now); if (!Number.isFinite(at.getTime())) fail("invalid_clock", "The save time is unavailable.", 500);
  return withTransaction(db, async tx => {
    const state = await clientState(tx, scope.orgId, scope.clientId, true);
    let businessPlanId = null;
    if (action === "save_settings") settings(state, input, at);
    else if (action === "save_business") businessPlanId = await saveBusiness(tx, scope, state, input, at, randomUUIDImpl);
    else if (action === "attach_evidence") businessPlanId = await attachEvidence(tx, scope, state, input);
    else if (action === "save_step") saveStep(state, input, at);
    else if (action === "save_payoff_plan") savePayoffPlan(state, input);
    else fail("invalid_action", "Choose a supported preparation action.");
    if (businessPlanId) state.businesses.find(b => b.id === businessPlanId).updatedAt = at.toISOString();
    state.updatedAt = at.toISOString(); await persist(tx, scope.orgId, scope.clientId, state);
    return { ...(await shape(tx, scope, state, auditCompaniesImpl)), ...(businessPlanId ? { savedBusinessPlanId: businessPlanId } : {}) };
  });
}
