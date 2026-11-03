import { test } from "node:test";
import assert from "node:assert/strict";
import { readBusinessPlans, writeBusinessPlans, PREPARATION_PROGRESS_KEYS, BLUEPRINT_PLANS_FIELD } from "./business-plans.mjs";
const ORG = "11111111-1111-4111-8111-111111111111", CLIENT = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444", PLAN2 = "55555555-5555-4555-8555-555555555555", DOC = "66666666-6666-4666-8666-666666666666", EIN = "77777777-7777-4777-8777-777777777777", BIZ = "88888888-8888-4888-8888-888888888888", ENTITY = "99999999-9999-4999-8999-999999999999";
const scope = { orgId: ORG, clientId: CLIENT }, NOW = new Date("2026-11-02T18:00:00.000Z");
const audit = (rows, options) => ({ businessPreparation: { actualCount: rows.length, planCount: options.plans.length, targetBusinessCount: options.targetBusinessCount } });
const options = { now: NOW, auditCompaniesImpl: audit };
const business = (id = PLAN, extra = {}) => ({ id, name: "Cedar Grove LLC", activity: "Local home cleaning services.", formationState: "AZ", ...extra });
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const state = { fields: { existingFlag: "keep" }, businesses: [], entities: [], documents: [], calls: [] };
  const db = { query: async (sql, args) => {
    state.calls.push({ sql, args });
    if (/SELECT id, custom_fields FROM clients/.test(sql)) return { rows: args[0] === CLIENT && args[1] === ORG ? [{ id: CLIENT, custom_fields: clone(state.fields) }] : [] };
    if (/UPDATE clients SET custom_fields/.test(sql)) { assert.equal(args[0], CLIENT); assert.equal(args[1], ORG); state.fields[BLUEPRINT_PLANS_FIELD] = JSON.parse(args[2]); return { rowCount: 1, rows: [] }; }
    if (/SELECT id, name, age_months, entity_data FROM businesses/.test(sql)) return { rows: clone(state.businesses.filter(b => b.org_id === args[0] && b.client_id === args[1])) };
    if (/SELECT id, entity_data FROM businesses/.test(sql)) return { rows: clone(state.businesses.filter(b => b.id === args[0] && b.org_id === args[1] && b.client_id === args[2])) };
    if (/SELECT id FROM entities/.test(sql)) return { rows: clone(state.entities.filter(e => e.id === args[0] && e.org_id === args[1] && e.client_id === args[2] && e.kind === "business" && !e.archived_at)) };
    if (/FROM documents d LEFT JOIN/.test(sql)) return { rows: clone(state.documents.filter(d => d.org_id === args[0] && d.client_id === args[1] && args[2].includes(d.id))) };
    throw new Error("Unexpected SQL: " + sql);
  } };
  const write = (action, input, opts = {}) => writeBusinessPlans(db, scope, action, input, { ...options, ...opts });
  const read = () => readBusinessPlans(db, scope, { auditCompaniesImpl: audit });
  return { state, db, write, read };
}
const doc = (extra = {}) => ({ id: DOC, org_id: ORG, client_id: CLIENT, kind: "client_upload", subtype: "articles_of_organization", title: "Formation document", generated_at: "2026-11-01T12:00:00.000Z", metadata: { original_filename: "formation.pdf" }, review_status: null, reviewed_at: null, ...extra });

test("first read is empty, preserves unknown values, and creates no phantom companies", async () => {
  const { state, read } = fixture(); const view = await read();
  assert.equal(view.orgId, ORG); assert.equal(view.clientId, CLIENT); assert.equal(view.targetBusinessCount, 4); assert.equal(view.availableCashCents, null); assert.equal(view.monthlyIncomeCents, null); assert.equal(view.hasExistingBusiness, null); assert.equal(view.startedAt, null);
  assert.deepEqual(view.businesses, []); assert.deepEqual(view.existingBusinesses, []); assert.equal(state.calls.some(c => /UPDATE|INSERT/.test(c.sql)), false);
});
test("settings preserve zero vs unknown and immutable first startedAt", async () => {
  const { state, write } = fixture();
  let view = await write("save_settings", { started: true, hasExistingBusiness: false, targetBusinessCount: 3, availableCashCents: 0, monthlyIncomeCents: null, homeState: "az", postalCode: "85004" });
  assert.equal(view.availableCashCents, 0); assert.equal(view.monthlyIncomeCents, null); assert.equal(view.homeState, "AZ"); assert.equal(view.startedAt, NOW.toISOString());
  view = await write("save_settings", { started: true, availableCashCents: null }, { now: new Date("2026-12-01T10:00:00Z") });
  assert.equal(view.startedAt, NOW.toISOString()); assert.equal(view.availableCashCents, null); assert.equal(state.fields.existingFlag, "keep");
  assert.ok(state.calls.some(c => c.sql.includes("FOR UPDATE"))); assert.ok(state.calls.some(c => c.sql.includes("jsonb_set")));
});
test("invalid settings and forged customer identity are rejected without saving", async () => {
  const { state, write } = fixture();
  for (const input of [{ targetBusinessCount: 5 }, { availableCashCents: -1 }, { availableCashCents: 1.5 }, { monthlyIncomeCents: "100" }, { homeState: "ZZ" }, { postalCode: "8500" }, { hasExistingBusiness: "yes" }, { orgId: OTHER }, { startedAt: "2020-01-01" }]) await assert.rejects(write("save_settings", input));
  assert.equal(state.fields[BLUEPRINT_PLANS_FIELD], undefined);
});
test("four distinct plans persist and same ID replays update one record", async () => {
  const { state, write, read } = fixture();
  const ids = [PLAN, PLAN2, DOC, EIN]; for (const id of ids) await write("save_business", business(id));
  await write("save_business", business(PLAN, { name: "Updated Cedar LLC" }));
  const view = await read(); assert.equal(view.businesses.length, 4); assert.equal(view.businesses[0].name, "Updated Cedar LLC");
  assert.equal(view.businessPreparation.actualCount, 0); assert.equal(view.businessPreparation.planCount, 4);
  assert.equal(state.calls.some(c => /INSERT INTO (businesses|entities)/.test(c.sql)), false);
  await assert.rejects(write("save_business", business(BIZ)), { code: "business_plan_limit" });
  await assert.rejects(write("save_settings", { targetBusinessCount: 3 }), { code: "saved_plans_exceed_target" });
});
test("reported formation and ownership/activity dates remain distinct actual reports", async () => {
  const { write } = fixture();
  await assert.rejects(write("save_business", business(PLAN, { formationStatus: "planned", formationDate: "2026-01-01" })), { code: "planned_business_has_no_formation_date" });
  await assert.rejects(write("save_business", business(PLAN, { formationStatus: "reported_formed" })), { code: "formation_date_required" });
  for (const formationDate of ["2026-02-31", "2027-01-01"]) await assert.rejects(write("save_business", business(PLAN, { formationStatus: "reported_formed", formationDate })), { code: "invalid_date" });
  const view = await write("save_business", business(PLAN, { formationStatus: "reported_formed", formationDate: "2026-01-02", ownershipSince: "2026-01-10", operatingSince: "2026-06-01" }));
  const p = view.businesses[0]; assert.equal(p.formationDate, "2026-01-02"); assert.equal(p.ownershipSince, "2026-01-10"); assert.equal(p.operatingSince, "2026-06-01"); assert.equal(p.evidence.formation.status, "not_added");
});
test("business references are same-client and same-company and do not expose raw entity data", async () => {
  const { state, write, read } = fixture();
  state.businesses.push({ id: BIZ, org_id: ORG, client_id: CLIENT, name: "Actual LLC", age_months: 3, entity_data: { entity_id: ENTITY, incorporated_date: "2026-08-01", full_ein: "sensitive-not-returned" } });
  state.entities.push({ id: ENTITY, org_id: ORG, client_id: CLIENT, kind: "business" });
  const view = await write("save_business", business(PLAN, { businessId: BIZ, entityId: ENTITY }));
  assert.equal(view.existingBusinesses[0].id, BIZ); assert.equal(JSON.stringify(view).includes("sensitive-not-returned"), false);
  await assert.rejects(write("save_business", business(PLAN2, { businessId: BIZ })), { code: "business_already_linked" });
  state.businesses[0].org_id = OTHER;
  await assert.rejects(write("save_business", business(PLAN, { businessId: BIZ })), { code: "business_not_found" });
  const refreshed = await read(); assert.equal(refreshed.existingBusinesses.length, 0);
});
test("client cannot manufacture reviewed evidence or verify a step", async () => {
  const { write } = fixture();
  await assert.rejects(write("save_business", business(PLAN, { reviewed: true })), { code: "field_not_accepted" });
  await assert.rejects(write("save_business", business(PLAN, { evidence: { formation: { status: "reviewed" } } })), { code: "field_not_accepted" });
  await assert.rejects(write("save_step", { stepKey: "formation", status: "verified" }), { code: "invalid_step_status" });
});
test("formation/EIN evidence uses persisted matching documents with prerequisite", async () => {
  const { state, write } = fixture(); await write("save_business", business());
  state.documents.push(doc(), doc({ id: EIN, subtype: "ein_letter", title: "EIN letter", metadata: { original_filename: "ein.pdf" } }));
  await assert.rejects(write("attach_evidence", { businessId: PLAN, kind: "ein", documentId: EIN }), { code: "formation_evidence_required" });
  let view = await write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC });
  assert.equal(view.businesses[0].evidence.formation.status, "evidence_received"); assert.equal(view.businesses[0].evidence.formation.filename, "formation.pdf");
  view = await write("attach_evidence", { businessId: PLAN, kind: "ein", documentId: EIN }); assert.equal(view.businesses[0].evidence.ein.status, "evidence_received");
});
test("foreign documents, mismatched kind/business and shared proof are refused", async () => {
  const { state, write } = fixture(); await write("save_business", business()); await write("save_business", business(PLAN2));
  state.documents.push(doc({ client_id: OTHER }));
  await assert.rejects(write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC }), { code: "evidence_not_found" });
  state.documents[0] = doc({ metadata: { entity_id: ENTITY } });
  await assert.rejects(write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC }), { code: "evidence_business_mismatch" });
  state.documents[0] = doc(); await write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC });
  await assert.rejects(write("attach_evidence", { businessId: PLAN2, kind: "formation", documentId: DOC }), { code: "evidence_already_linked" });
  await assert.rejects(write("attach_evidence", { businessId: PLAN, kind: "ein", documentId: DOC }), { code: "evidence_not_found" });
});
test("review status comes from current saved review; stale review is not current proof", async () => {
  const { state, write, read } = fixture(); await write("save_business", business()); state.documents.push(doc()); await write("attach_evidence", { businessId: PLAN, kind: "formation", documentId: DOC });
  Object.assign(state.documents[0], { review_status: "accepted", reviewed_at: "2026-11-02T10:00:00Z" });
  assert.equal((await read()).businesses[0].evidence.formation.status, "reviewed");
  state.documents[0].review_status = "rejected"; assert.equal((await read()).businesses[0].evidence.formation.status, "rejected");
  state.documents[0].reviewed_at = "2026-10-30T10:00:00Z"; assert.equal((await read()).businesses[0].evidence.formation.status, "evidence_received");
  state.documents = []; assert.equal((await read()).businesses[0].evidence.formation.status, "unavailable");
});
test("step reports whitelist keys and preserve per-business scope with honest status", async () => {
  const { write } = fixture(); await write("save_business", business()); await write("save_business", business(PLAN2));
  await write("save_step", { stepKey: "formation", businessPlanId: PLAN, status: "reported_complete", note: "Filed; waiting for the state response.", targetDate: "2026-12-01" });
  let view = await write("save_step", { stepKey: "formation", businessPlanId: PLAN2, status: "blocked", note: "Need help." });
  assert.equal(view.stepProgress.length, 2); assert.equal(view.stepProgress[0].verification, "client_reported"); assert.equal(view.businesses[0].evidence.formation.status, "not_added");
  view = await write("save_step", { stepKey: "formation", businessPlanId: PLAN, status: "in_progress" }); assert.equal(view.stepProgress.length, 2);
  for (const input of [{ stepKey: "invented", status: "reported_complete" }, { stepKey: "budget", status: "in_progress", businessPlanId: DOC }, { stepKey: "budget", status: "in_progress", note: "a".repeat(1501) }, { stepKey: "budget", status: "in_progress", targetDate: "2026-02-31" }]) await assert.rejects(write("save_step", input));
  assert.equal(PREPARATION_PROGRESS_KEYS.length, 17);
});
test("wrong tenant/client is refused before any save", async () => {
  const { db, state } = fixture();
  await assert.rejects(readBusinessPlans(db, { orgId: OTHER, clientId: CLIENT }), { code: "client_not_found" });
  await assert.rejects(writeBusinessPlans(db, { orgId: ORG, clientId: OTHER }, "save_settings", { started: true }, options), { code: "client_not_found" });
  assert.equal(state.calls.some(c => /^UPDATE clients/.test(c.sql)), false);
});
