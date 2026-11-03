import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlueprintClientPlan } from "./client-plan.mjs";

const ORG = "org-a";
const CLIENT = "client-a";
const NOW = new Date("2026-11-02T20:00:00.000Z");
const scope = { orgId: ORG, clientId: CLIENT, now: NOW };

function fixture({ credit = null, missingClient = false } = {}) {
  const calls = { queries: [], plans: [], progress: [], bank: [], guidance: [], rank: [], prompts: [], engine: [] };
  const client = { id: CLIENT, org_id: ORG, first_name: "Alex", last_name: "Buyer",
    custom_fields: { home_state: "CA", postal_code: "90001", must_not_return: "private-client-value" } };
  const businessPlans = { orgId: ORG, clientId: CLIENT, version: 1, targetBusinessCount: 4,
    homeState: "AZ", postalCode: "85004", availableCashCents: 0, monthlyIncomeCents: null,
    businesses: [{ id: "plan-1", name: "Northline LLC", activity: "Consulting", formationStatus: "planned",
      formationState: "AZ", operatingState: "AZ", formationDate: null }],
    existingBusinesses: [{ id: "business-1", name: "Existing LLC", entity_data: {
      legal_name: "Existing LLC", industry: "Wholesale", formation_state: "CA", state: "CA" } }],
    stepProgress: { identity: "reported_complete" } };
  const progress = { waypoints: [{ key: "card_paydown_1", detail: "Saved actual step" }], scores: { personal: [] } };
  const bankPlan = { ok: true, client: { id: CLIENT, name: "Alex Buyer" }, recommended_banks: [{ name: "Saved Bank" }] };
  const localBanks = { status: "candidates_for_review", location: { state: "AZ", postalCode: "85004" },
    source: { name: "NCUA", asOf: "2026-06-30", url: "https://ncua.gov" },
    candidates: [{ name: "Directory Credit Union", charterNumber: 123, distanceMiles: 2.1,
      locationMatch: "postal_centroid", membershipStatus: "not_reviewed", cashFit: "not_reviewed" }], limitations: [] };
  const db = { async query(sql, params) {
    calls.queries.push({ sql, params });
    if (/FROM clients/.test(sql)) return { rows: missingClient ? [] : [client] };
    if (/FROM documents/.test(sql)) return { rows: [] };
    if (/FROM crs_results/.test(sql)) return { rows: credit ? [credit] : [] };
    throw new Error("Unexpected query");
  } };
  const deps = {
    readBusinessPlans: async (gotDb, gotScope) => { calls.plans.push({ gotDb, gotScope }); return businessPlans; },
    readClientProgress: async (gotDb, gotScope) => { calls.progress.push({ gotDb, gotScope }); return progress; },
    bankStrategy: async (gotDb, gotScope) => { calls.bank.push({ gotDb, gotScope }); return bankPlan; },
    preparationGuidance: (context) => { calls.guidance.push(context); return [{ key: "real_lesson", applicability: context.creditContext.securedCreditReviewRequired === true ? "ready" : "review_needed" }]; },
    rankLocalCreditUnions: (context) => { calls.rank.push(context); return localBanks; },
    websitePrompt: (business) => { calls.prompts.push(business); return `Website for ${business.name}: ${business.activity}`; },
    runTierEngine: (result) => { calls.engine.push(result); return result.analysis; }
  };
  return { db, deps, calls, client, businessPlans, progress, bankPlan, localBanks };
}
const genuine = (result) => ({ id: "report-1", org_id: ORG, client_id: CLIENT, provider: "crs_softview",
  created_at: new Date("2026-10-30T08:00:00.000Z"), result });

test("aggregates exact saved source payloads without creating formed businesses or invented data", async () => {
  const f = fixture();
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(out.client, { name: "Alex Buyer" });
  assert.equal(out.businessPlans, f.businessPlans);
  assert.equal(out.progress, f.progress);
  assert.equal(out.bankPlan, f.bankPlan);
  assert.equal(out.businessPlans.businesses[0].formationStatus, "planned");
  assert.equal(out.businessPlans.businesses[0].formationDate, null);
  assert.equal(out.localBanks.source, f.localBanks.source);
  assert.equal(out.localBanks.candidates, f.localBanks.candidates);
  assert.equal(out.localBanks.asOf, "2026-06-30");
  assert.deepEqual(f.calls.rank[0], { homeState: "AZ", postalCode: "85004", availableCashCents: 0, limit: 5 });
  assert.deepEqual(f.calls.plans[0].gotScope, scope);
  assert.deepEqual(f.calls.progress[0].gotScope, scope);
  assert.deepEqual(f.calls.bank[0].gotScope, { orgId: ORG, clientId: CLIENT, asOf: NOW });
  for (const query of f.calls.queries) {
    assert.deepEqual(query.params, [CLIENT, ORG]);
    assert.match(query.sql, /org_id = \$2::uuid/);
    assert.doesNotMatch(query.sql, /INSERT|UPDATE|DELETE/);
  }
  assert.doesNotMatch(JSON.stringify(out), /private-client-value|640|sample|fake/i);
});

test("each planned and existing business gets a separate prompt using its saved actual activity", async () => {
  const f = fixture();
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.deepEqual(out.websitePrompts, [
    { planId: "plan-1", businessId: null, prompt: "Website for Northline LLC: Consulting" },
    { planId: null, businessId: "business-1", prompt: "Website for Existing LLC: Wholesale" }
  ]);
  assert.equal(f.calls.prompts[1].formationState, "CA");
  assert.equal(f.businessPlans.existingBusinesses[0].activity, undefined, "source record was not modified");
});

test("missing real credit leaves both applicability decisions unknown rather than assuming thin file", async () => {
  const f = fixture();
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.creditContext.authorizedUserReviewRequired, null);
  assert.equal(out.creditContext.securedCreditReviewRequired, null);
  assert.equal(out.creditContext.source, null);
  assert.equal(out.lessons[0].applicability, "review_needed");
  assert.equal(f.calls.engine.length, 0);
});

test("AU and secured-credit applicability comes from the existing pure engine on a genuine persisted report", async () => {
  const payload = { bureaus: { EX: { actual: "saved raw report" } }, analysis: {
    consumerSignals: { tradelines: { au: 2, thinFile: true } },
    findings: [{ code: "AU_NEGATIVE_MARKS" }, { code: "AU_GOOD_KEEP" }, { code: "AU_NEGATIVE_MARKS" }]
  } };
  const f = fixture({ credit: genuine(payload) });
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(f.calls.engine[0], payload);
  assert.equal(out.creditContext.authorizedUserReviewRequired, true);
  assert.equal(out.creditContext.securedCreditReviewRequired, true);
  assert.equal(out.creditContext.authorizedUserCount, 2);
  assert.equal(out.creditContext.reportId, "report-1");
  assert.equal(out.creditContext.asOf, "2026-10-30T08:00:00.000Z");
  assert.deepEqual(out.creditContext.authorizedUserFindingCodes, ["AU_NEGATIVE_MARKS", "AU_GOOD_KEEP"]);
  assert.equal(f.calls.guidance[0].creditContext, out.creditContext);
  assert.equal(out.lessons[0].applicability, "ready");
  assert.doesNotMatch(JSON.stringify(out), /saved raw report|Remove all/);
});

test("measured zero AU and a known non-thin file remain false, not unknown", async () => {
  const f = fixture({ credit: genuine({ consumerSignals: { tradelines: { au: 0, thinFile: false } } }) });
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.creditContext.authorizedUserReviewRequired, false);
  assert.equal(out.creditContext.securedCreditReviewRequired, false);
  assert.equal(out.creditContext.authorizedUserCount, 0);
  assert.equal(f.calls.engine.length, 0);
});

test("a genuine but incomplete signal never invents an AU count or thin-file conclusion", async () => {
  const f = fixture({ credit: genuine({ consumerSignals: { tradelines: {} } }) });
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.creditContext.authorizedUserCount, null);
  assert.equal(out.creditContext.authorizedUserReviewRequired, null);
  assert.equal(out.creditContext.securedCreditReviewRequired, null);
});

for (const marker of [
  { provider: "crs_softview_simulated" }, { result: { simulated: true } },
  { result: { simulated: "1" } }, { result: { environment: "sandbox" } }, { is_demo: true }
]) test(`rehearsal marker ${JSON.stringify(marker)} cannot activate a credit recommendation`, async () => {
  const f = fixture({ credit: { ...genuine({}), ...marker } });
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.creditContext.source, null);
  assert.equal(out.creditContext.securedCreditReviewRequired, null);
  assert.equal(f.calls.engine.length, 0);
  const query = f.calls.queries.find((q) => /FROM crs_results/.test(q.sql));
  assert.match(query.sql, /is_demo IS NOT TRUE/);
  assert.match(query.sql, /sandbox/);
});

test("a bank source outage is explicit and preserves the saved primary plan", async () => {
  const f = fixture();
  f.deps.bankStrategy = () => { throw new Error("internal credential text"); };
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.bankPlan, null);
  assert.equal(out.progress, f.progress);
  assert.deepEqual(out.warnings, [{ code: "bank_plan_unavailable", source: "bank_strategy" }]);
  assert.doesNotMatch(JSON.stringify(out), /credential/);
});

test("a directory outage is unavailable, with no fabricated candidates or publication date", async () => {
  const f = fixture();
  f.deps.rankLocalCreditUnions = () => { throw new Error("offline"); };
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.localBanks.status, "unavailable");
  assert.equal(out.localBanks.asOf, null);
  assert.equal(out.localBanks.source, null);
  assert.deepEqual(out.localBanks.candidates, []);
  assert.ok(out.warnings.some((warning) => warning.code === "local_banks_unavailable"));
});

for (const source of ["businessPlans", "progress", "bankPlan", "credit"]) {
  test(`a mixed-client ${source} source rejects the entire response`, async () => {
    const f = fixture({ credit: source === "credit" ? { ...genuine({}), client_id: "other-client" } : null });
    if (source === "businessPlans") f.businessPlans.clientId = "other-client";
    if (source === "progress") f.progress.clientId = "other-client";
    if (source === "bankPlan") f.bankPlan.client.id = "other-client";
    await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), { code: "blueprint_plan_scope_mismatch" });
  });
}

test("a mixed-org source also rejects, including the direct client lookup", async () => {
  const f = fixture();
  f.client.org_id = "other-org";
  await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), { code: "blueprint_plan_scope_mismatch" });
  assert.equal(f.calls.plans.length, 0);
});

for (const source of ["readBusinessPlans", "readClientProgress", "preparationGuidance", "websitePrompt"]) {
  test(`a failed core ${source} source cannot become a successful fake default`, async () => {
    const f = fixture();
    f.deps[source] = () => { throw new Error(`${source} unavailable`); };
    await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), new RegExp(`${source} unavailable`));
  });
}

test("missing required guidance dependencies fail before reading client data", async () => {
  const f = fixture();
  delete f.deps.websitePrompt;
  await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), { code: "blueprint_plan_dependency_missing:websitePrompt" });
  assert.equal(f.calls.queries.length, 0);
});

test("a nonexistent scoped client returns null without invoking sibling readers", async () => {
  const f = fixture({ missingClient: true });
  assert.equal(await buildBlueprintClientPlan(f.db, scope, f.deps), null);
  assert.equal(f.calls.plans.length, 0);
  assert.equal(f.calls.rank.length, 0);
});

test("a credit parsing outage keeps real progress and an explicitly unknown applicability", async () => {
  const f = fixture({ credit: genuine({ bureaus: {} }) });
  f.deps.runTierEngine = () => { throw new Error("parse failed"); };
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.progress, f.progress);
  assert.equal(out.creditContext.securedCreditReviewRequired, null);
  assert.ok(out.warnings.some((warning) => warning.code === "credit_context_unavailable"));
});


test("per-business lessons use the selected plan's formation state instead of the client's home state", async () => {
  const f = fixture();
  f.businessPlans.businesses.push({ id: "plan-2", name: "Second LLC", activity: "Wholesale",
    formationState: "CA", operatingState: "AZ", formationStatus: "planned" });
  f.deps.preparationGuidance = (context) => [{ key: "formation", state: context.business?.formationState ?? context.homeState }];
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.deepEqual(out.lessons, [{ key: "formation", state: "AZ" }]);
  assert.deepEqual(out.businessLessons, [
    { planId: "plan-1", lessons: [{ key: "formation", state: "AZ" }] },
    { planId: "plan-2", lessons: [{ key: "formation", state: "CA" }] }
  ]);
});

test("unexpected source output cannot silently become an empty successful business plan", async () => {
  const f = fixture();
  f.deps.readBusinessPlans = () => ({ orgId: ORG, clientId: CLIENT });
  await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), { code: "blueprint_business_plans_unavailable" });
});

test("the per-business guidance loop refuses more than the four-plan storage limit", async () => {
  const f = fixture();
  f.businessPlans.businesses = Array.from({ length: 5 }, (_, i) => ({ id: `plan-${i}` }));
  await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), { code: "blueprint_plan_business_limit_exceeded" });
  assert.equal(f.calls.guidance.length, 0);
});

test("cash planning reserves shared cash once across businesses and flags unknowns",async()=>{
  const f=fixture();Object.assign(f.businessPlans,{availableCashCents:100000,cashBufferCents:20000,oneTimePayoffCents:30000});
  f.businessPlans.businesses[0].bankPreparation={relationships:[{depositPlanCents:40000}]};
  f.bankPlan.recommended_banks=[{name:'Actual bank reference',minimum_deposit_cents:15000}];
  let out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.cashPlan.remainingCashCents,10000);assert.equal(out.cashPlan.banks[0].cashFit,'exceeds_remaining_budget');
  f.businessPlans.businesses.push({id:'separate-plan',bankPreparation:{relationships:[{depositPlanCents:20000}]}});
  out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.cashPlan.status,'overcommitted');assert.equal(out.cashPlan.remainingCashCents,-10000);
  f.businessPlans.cashBufferCents=null;out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.cashPlan.status,'review_needed');assert.equal(out.cashPlan.remainingCashCents,null);assert.equal(out.cashPlan.banks[0].cashFit,'review_needed');
});
test("saved payoff choice derives exact smallest-balance and highest-rate payments without forecasts",async()=>{
  const f=fixture();f.businessPlans.payoffPlan={strategy:'snowball',monthlyBudgetCents:10000,debts:[{id:'a',label:'Smaller balance',balanceCents:12000,aprBps:1000,minimumPaymentCents:1000},{id:'b',label:'Higher APR',balanceCents:50000,aprBps:2000,minimumPaymentCents:2000}]};
  let out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.payoffCalculation.status,'ready');assert.equal(out.payoffCalculation.priority[0],'a');assert.equal(out.payoffCalculation.allocatedCents,10000);
  f.businessPlans.payoffPlan.strategy='avalanche';out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.payoffCalculation.priority[0],'b');
  assert.equal(out.payoffCalculation.payoffDate,undefined);
});
test("bureau response acceptance is shown only for exact current saved validation",async()=>{
  const f=fixture(),base=f.db.query;const doc={id:'doc-a',current_version_id:'v2',title:'Actual response',metadata:{bureau_response_validation:{schema:1,validator:'bureau-response-reader',document_id:'doc-a',version_id:'v1',status:'accepted',reason:'Old review'}}};
  f.db.query=async(sql,params)=>/FROM documents/.test(sql)?{rows:[doc]}:base(sql,params);
  let out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.letterResponses[0].validationStatus,'pending');
  doc.metadata.bureau_response_validation.version_id='v2';out=await buildBlueprintClientPlan(f.db,scope,f.deps);assert.equal(out.letterResponses[0].validationStatus,'accepted');
});


test("native mail action gets scoped letter readiness without modifying the canonical checklist", async () => {
  const f = fixture();
  f.progress.waypoints = [{ id: "mail", key: "blueprint_dispute_mail_letters", title: "Stored mail title", state: "not_started", owner: "client" }];
  f.progress.nextStep = { waypointId: "mail", owner: "client" };
  const saved = structuredClone(f.progress);
  const seen = [];
  f.deps.readBlueprintLetterReadiness = async (db, gotScope) => { seen.push({ db, gotScope }); return { orgId: ORG, clientId: CLIENT, state: "not_ready", usableLetterCount: 0, mailingOrderCount: 0 }; };
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.letterReadiness.state, "not_ready");
  assert.equal(out.creditContext.reportId, null);
  assert.deepEqual(out.progress, saved);
  assert.equal(seen[0].db, f.db);assert.deepEqual(seen[0].gotScope, scope);
  f.deps.readBlueprintLetterReadiness = async () => ({ orgId: ORG, clientId: "someone-else", state: "ready" });
  await assert.rejects(buildBlueprintClientPlan(f.db, scope, f.deps), { code: "blueprint_plan_scope_mismatch" });
});
test("letter readiness outages fail closed and never invent a generating job or ready files", async () => {
  const f = fixture();f.progress.waypoints = [{ key: "blueprint_dispute_mail_letters", state: "not_started" }];
  f.deps.readBlueprintLetterReadiness = async () => { throw new Error("read unavailable"); };
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.deepEqual(out.letterReadiness, { state: "unavailable", usableLetterCount: null, mailingOrderCount: null });
  assert.ok(out.warnings.some(w => w.code === "letter_readiness_unavailable"));
});
test("non-mail native actions do not add a letter reader or provider prerequisite", async () => {
  const f = fixture();f.deps.readBlueprintLetterReadiness = async () => { throw new Error("must not run"); };
  const out = await buildBlueprintClientPlan(f.db, scope, f.deps);
  assert.equal(out.letterReadiness, null);
  assert.ok(!out.warnings.some(w => w.code === "letter_readiness_unavailable"));
});
