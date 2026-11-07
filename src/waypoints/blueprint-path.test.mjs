// "Your path" (src/waypoints/blueprint-path.mjs): step order, bank steps from
// the bank book and the tracker, the cash deposit plan, and impact labels that come
// only from what UnderwriteIQ measured on the saved pulls. Each rule is tested
// both ways.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBlueprintPath, bankSteps, depositCashPlan, allocateDeposits, depositPlanRows, measureCredit, measuredFindings,
  pathFunding, modifiersMoved, chexsystemsStep, fundabilityLine, cardSlug,
  CARD_TARGET_PCT, FUNDABILITY_CHECK_KEYS, BANK_REQUIREMENT, BANK_REQUIREMENT_WORDS, PATH_HEADER, CHEXSYSTEMS_GUIDE
} from "./blueprint-path.mjs";
import { measurePull, readBlueprintPath, businessChecklist, businessUnlockFor, readBusinessPoint, CHEXSYSTEMS_UPLOADS_SQL,
  POINT_CLIENT_SQL, POINT_CRS_SQL, POINT_TRADELINE_SQL, POINT_LIABILITY_SQL, POINT_BUSINESS_SQL } from "./blueprint-path-read.mjs";
import { slugify, PAYDOWN_TARGET_FRACTION, isBlueprintOnlyDefinitionKey } from "./definitions.mjs";
import { PERSONAL_CHECKS, businessRead, readEngine } from "../finance/fundability.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { pickBankLogo, recommendedBanks, membershipBlock } from "../finance/bank-strategy.mjs";
import { SUBTYPES } from "../pulse/beats/lib/document-kinds.mjs";

const wp = (key, extra = {}) => ({ id: `id-${key}`, key, title: key, detail: null, owner: "client", state: "not_started",
  closedBy: "client", verifyKind: null, completedAt: null, ...extra });
const CHECKLIST = [
  wp("paydown_sample_card_a", { title: "Pay Sample Card A down to $800", verifyKind: "paydown", closedBy: "credit_report" }),
  wp("no_new_credit", { verifyKind: "no_new_credit", closedBy: "ongoing" }),
  wp("form_llc", { title: "File your LLC" }),
  wp("get_ein", { title: "Get your EIN from the IRS" }),
  wp("check_chexsystems", { title: "Check your ChexSystems report" }),
  wp("business_checking", { title: "Open a business checking account" })
];
const CHASE = { lender_id: "l-chase", name: "Chase", lender_table: "InBranchBizCC", minimum_deposit_cents: null, seasoning_days: 30,
  logo: { src: "/assets/lenders/chase.png", alt: "Chase logo" },
  why: [{ text: "Business checking account is required", source: { label: "Bank book · Chase", ref: "lenders.stated_requirements · LEGACY-CHASE" } }],
  relationship_steps: [{ step: "deposit", amount_cents: null, not_set: true }, { step: "season", days: 30, quote: "30+ days of liquidity seasoning strongly improves odds" }] };
const BOFA = { lender_id: "l-bofa", name: "Bank of America", lender_table: "InBranchBizCC", minimum_deposit_cents: null, seasoning_days: 30,
  logo: { src: "/assets/lenders/bank-of-america.png", alt: "Bank of America logo" },
  why: [{ text: "Checking account + 30-day seasoning required", source: { label: "Bank book · Bank of America", ref: "lenders.stated_requirements · LEGACY-BOFA" } }],
  relationship_steps: [] };
const rel = (bank, extra = {}) => ({ id: `rel-${bank}`, bank, bank_key: bank.toLowerCase(), account_kind: "business", lender_id: null,
  status: "planned", planned_open_on: null, deposit_plan_cents: null, deposits_total_cents: null, opened_on: null, days_open: null,
  seasoning: null, seasoned_on: null, ...extra });

describe("the shared numbers are the repo's own", () => {
  test("card target, card slug, fundability checks and the upload subtype match their homes", () => {
    assert.equal(CARD_TARGET_PCT, PAYDOWN_TARGET_FRACTION * 100);
    for (const name of ["Sample Card A", "CREDIT ONE BANK N.A.", "A".repeat(50) + " x"]) assert.equal(cardSlug(name), slugify(name));
    assert.deepEqual([...FUNDABILITY_CHECK_KEYS], PERSONAL_CHECKS.map((c) => c.key));
    assert.ok(SUBTYPES.client_upload.includes("chexsystems_report"));
    assert.match(CHEXSYSTEMS_UPLOADS_SQL, /d\.client_id = \$1::uuid AND d\.org_id = \$2::uuid/);
    assert.equal(isBlueprintOnlyDefinitionKey("check_chexsystems"), true);
    assert.equal(isBlueprintOnlyDefinitionKey("business_checking"), false);
  });

  test("the ChexSystems words say no more than the owner allowed", () => {
    const words = JSON.stringify(CHEXSYSTEMS_GUIDE.answers).toLowerCase();
    assert.match(words, /not a credit report/);
    assert.match(words, /no credit score impact/);
    assert.match(words, /dispute the error with chexsystems before you apply/);
    assert.doesNotMatch(words, /guarantee|approv|qualif|remove|boost/);
    assert.equal(CHEXSYSTEMS_GUIDE.link.url, "https://www.chexsystems.com");
  });
});

describe("step order", () => {
  test("ChexSystems comes before every bank step, and bank steps replace the generic one", () => {
    const path = buildBlueprintPath({ progress: { waypoints: CHECKLIST }, bankPlan: { recommended_banks: [CHASE, BOFA], relationships: [] } });
    const keys = path.steps.map((s) => s.key);
    const chex = keys.indexOf("check_chexsystems");
    const banks = keys.filter((k) => k.startsWith("bank_open_")).map((k) => keys.indexOf(k));
    assert.deepEqual(keys.filter((k) => k.startsWith("bank_open_")), ["bank_open_chase", "bank_open_bank_of_america"]);
    assert.ok(banks.every((i) => i > chex), "every bank step is after ChexSystems");
    assert.ok(keys.indexOf("get_ein") < chex && keys.indexOf("form_llc") < chex);
    assert.ok(!keys.includes("business_checking"), "the generic step is stood in for");
    assert.deepEqual(path.steps.find((s) => s.key === "bank_open_chase").waitingOn,
      ["File your LLC", "Get your EIN from the IRS", "Check your ChexSystems report"]);
  });

  test("a checklist seeded before 574 still shows ChexSystems in the same place, from the plan's own key", () => {
    const old = CHECKLIST.filter((w) => w.key !== "check_chexsystems");
    const path = buildBlueprintPath({ progress: { waypoints: old }, bankPlan: { recommended_banks: [CHASE] },
      businessPlans: { stepProgress: [{ stepKey: "chexsystems", businessPlanId: null, status: "reported_complete" }] } });
    const keys = path.steps.map((s) => s.key);
    assert.ok(keys.indexOf("check_chexsystems") < keys.indexOf("bank_open_chase"));
    const chex = path.steps.find((s) => s.key === "check_chexsystems");
    assert.equal(chex.state, "done");
    assert.equal(chex.closeWith, "plan_step");
    assert.deepEqual(path.steps.find((s) => s.key === "bank_open_chase").waitingOn, ["File your LLC", "Get your EIN from the IRS"]);
  });

  test("the bank steps follow the merged local plan when the bank read carries one, else the bank match's own list", () => {
    const local = { lender_id: null, name: "Desert Financial", kind: "credit_union", products: [], lender_table: null,
      minimum_deposit_cents: null, seasoning_days: null, logo: null, why: [], relationship_steps: [],
      source: { label: "NCUA", ref: "NCUA charter 1 · call report sample" }, local: true, near: { text: "Local credit union in the same ZIP as your home.", miles: 0 } };
    const merged = buildBlueprintPath({ progress: { waypoints: CHECKLIST },
      bankPlan: { recommended_banks: [CHASE, BOFA], relationships: [], local_banks: { status: "ready", recommended: [CHASE, local] } } });
    const names = (path) => path.steps.filter((s) => s.kind === "bank").map((s) => [s.bank.name, s.bank.kind]);
    assert.deepEqual(names(merged), [["Chase", "bank"], ["Desert Financial", "credit_union"]]);
    assert.equal(merged.steps.find((s) => s.key === "bank_open_desert_financial").bank.depositText, "Deposit amount: not set",
      "a local find has no bank book amount, so it reads not set");
    for (const lb of [undefined, { status: "needs_address", plan: [] }, { status: "unavailable", plan: [] }]) {
      const plain = buildBlueprintPath({ progress: { waypoints: CHECKLIST }, bankPlan: { recommended_banks: [CHASE, BOFA], relationships: [], local_banks: lb } });
      assert.deepEqual(names(plain), [["Chase", "bank"], ["Bank of America", "bank"]], `local_banks ${lb ? lb.status : "absent"}: the bank match's own list`);
    }
  });

  test("with the LLC, EIN and ChexSystems done, the next step is the first bank", () => {
    const done = CHECKLIST.map((w) => (["paydown_sample_card_a", "form_llc", "get_ein", "check_chexsystems"].includes(w.key)
      ? { ...w, state: "done", completedAt: "2026-11-01T00:00:00Z" } : w));
    const path = buildBlueprintPath({ progress: { waypoints: done }, bankPlan: { recommended_banks: [CHASE, BOFA] } });
    assert.equal(path.next.key, "bank_open_chase");
    assert.equal(path.steps.find((s) => s.key === "bank_open_chase").waitingOn.length, 0);
  });

  test("an uploaded ChexSystems report keeps metadata only and waits for the team", () => {
    const step = chexsystemsStep({ uploads: [{ documentId: "d1", filename: "chex.pdf", receivedAt: "2026-11-05T00:00:00Z", review: null, body: "SECRET" }] });
    assert.equal(step.state, "in_review");
    assert.deepEqual(Object.keys(step.uploads[0]).sort(), ["documentId", "filename", "receivedAt", "review"]);
    assert.equal(chexsystemsStep({ uploads: [{ documentId: "d1", review: "rejected" }] }).state, "blocked");
  });
});

describe("bank steps from the bank book and the tracker", () => {
  test("a deposit target that is not set reads 'not set', never $0", () => {
    const [chase] = bankSteps({ recommended: [CHASE], relationships: [] });
    assert.equal(chase.title, "Open a Chase business checking account");
    assert.equal(chase.bank.targetCents, null);
    assert.equal(chase.bank.depositText, "Deposit amount: not set");
    assert.equal(chase.bank.openBy, null);
    assert.equal(chase.bank.quote.text, "Business checking account is required");
    assert.equal(chase.bank.logo.src, "/assets/lenders/chase.png");
  });

  test("a staff-set target and open-by day are used, and the tracker moves the stages", () => {
    const [chase] = bankSteps({ recommended: [CHASE], relationships: [rel("Chase", { deposit_plan_cents: 500000, planned_open_on: "2026-12-01",
      deposit_plan_source: { label: "Set by staff" }, opened_on: "2026-11-01", status: "seasoning", deposits_total_cents: 500000, days_open: 12,
      seasoning: { days: 30, quote: "30+ days" } })] });
    assert.equal(chase.title, "Open a Chase business checking account and deposit $5,000");
    assert.equal(chase.bank.openBy, "2026-12-01");
    assert.equal(chase.bank.tracker.stage, "deposited");
    assert.equal(chase.bank.tracker.text, "Deposited · 12 of 30 days seasoned");
    assert.equal(chase.state, "in_progress");
    const [seasoned] = bankSteps({ recommended: [CHASE], relationships: [rel("Chase", { deposit_plan_cents: 500000, opened_on: "2026-09-01",
      status: "seasoned", deposits_total_cents: 500000, seasoning: { days: 30 } })] });
    assert.equal(seasoned.state, "done");
  });

  test("a bank staff skipped is left out", () => {
    const steps = bankSteps({ recommended: [CHASE, BOFA], relationships: [rel("Chase", { status: "skipped" })] });
    assert.deepEqual(steps.map((s) => s.bank.name), ["Bank of America"]);
  });

  test("the deposit_plan contract carries every field, with null for what is not set", () => {
    const rows = depositPlanRows(bankSteps({ recommended: [CHASE, BOFA], relationships: [rel("Chase", { lender_id: "l-chase",
      deposit_plan_cents: 500000, planned_open_on: "2026-12-01", opened_on: "2026-11-01", status: "open" })] }));
    assert.deepEqual(Object.keys(rows[0]).sort(), ["deposit_cents", "deposit_source", "deposited_cents", "kind", "lender_id", "logo", "logo_alt", "name",
      "open_by", "reason", "reason_source", "relationship_id", "season_days", "status"].sort());
    assert.equal(rows[0].logo, "/assets/lenders/chase.png", "the logo is a URL string");
    assert.equal(rows[0].logo_alt, "Chase logo");
    assert.equal(rows[0].status, "opened");
    assert.equal(rows[0].deposit_cents, 500000);
    assert.equal(rows[0].kind, "bank");
    assert.equal(rows[1].open_by, null);
    assert.equal(rows[1].deposit_cents, null);
    assert.equal(rows[1].status, "planned");
  });
});

describe("bank logos and membership", () => {
  test("Plaid's logo wins, then the bank book file, else no logo at all", () => {
    assert.equal(pickBankLogo({ plaidLogo: "iVBORw0KGgoAAAANSUhEUgAA", logoPath: "/assets/lenders/chase.png", name: "Chase" }).source.label, "Plaid institution logo");
    assert.deepEqual(pickBankLogo({ logoPath: "/assets/lenders/chase.png", name: "Chase" }).src, "/assets/lenders/chase.png");
    assert.equal(pickBankLogo({ logoPath: "/assets/lenders/chase.png", name: "Chase" }).alt, "Chase logo");
    assert.equal(pickBankLogo({ logoPath: null, name: "Chase" }), null);
    assert.equal(pickBankLogo({ logoPath: "https://evil.example/x.png", name: "Chase" }), null);
    assert.equal(pickBankLogo({ plaidLogo: "<svg onload=x>", name: "Chase" }), null);
  });

  test("a bank whose book says owners must already be members is left out; a plain credit union rule stays", () => {
    const navy = { id: "n", name: "Navy Federal", lender_table: "OnlineBizCC", requires_account_opening: "yes",
      stated_requirements: "Giovanni list: TransUnion. Business credit card. Every owner must already be a Navy Federal member." };
    const cu = { id: "c", name: "Desert Credit Union", lender_table: "InBranchBizCC", requires_account_opening: "yes",
      stated_requirements: "Membership is required. Business checking account required." };
    assert.ok(membershipBlock(navy));
    assert.equal(membershipBlock(cu), null);
    const { banks, left_out: leftOut } = recommendedBanks([navy, cu], { states: ["AZ"] });
    assert.deepEqual(banks.map((b) => [b.name, b.kind]), [["Desert Credit Union", "credit_union"]]);
    assert.equal(leftOut.find((x) => x.name === "Navy Federal").reason, "book_says_membership_client_may_not_meet");
  });
});

describe("the cash deposit plan, one step at a time", () => {
  const steps = (targets) => bankSteps({ recommended: [CHASE, BOFA],
    relationships: targets.map(([bank, cents]) => rel(bank, { deposit_plan_cents: cents })) });

  test("$1,000 is placed: a partial first bank, and the next amount goes to the same bank", () => {
    const plan = allocateDeposits(100000, steps([["Chase", 500000], ["Bank of America", 500000]]));
    assert.deepEqual(plan.rows.map((r) => [r.bank, r.status, r.giveCents]), [["Chase", "partial", 100000], ["Bank of America", "waiting", 0]]);
    assert.equal(plan.rows[0].words, "Start with $1,000. Add $4,000 to reach the amount on your plan.");
    assert.deepEqual(plan.next, { key: "bank_open_chase", bank: "Chase", amountCents: 400000, needCents: 500000, giveCents: 100000 });
  });

  test("$10,000 fills the banks in plan order", () => {
    const plan = allocateDeposits(1000000, steps([["Chase", 500000], ["Bank of America", 500000]]));
    assert.deepEqual(plan.rows.map((r) => [r.status, r.giveCents]), [["covered", 500000], ["covered", 500000]]);
    assert.equal(plan.next, null);
    const more = allocateDeposits(700000, steps([["Chase", 500000], ["Bank of America", 500000]]));
    assert.deepEqual(more.rows.map((r) => [r.status, r.giveCents]), [["covered", 500000], ["partial", 200000]]);
    assert.equal(more.next.bank, "Bank of America");
  });

  test("a bank whose target is not set never gets money, and the next bank does", () => {
    const plan = allocateDeposits(1000000, steps([["Bank of America", 500000]]));
    assert.deepEqual(plan.rows.map((r) => [r.bank, r.status, r.giveCents]), [["Chase", "not_set", 0], ["Bank of America", "covered", 500000]]);
    assert.equal(plan.rows[0].words, "Deposit not set yet.");
    assert.equal(plan.leftCents, 500000, "money is never pushed into an unset target");
  });

  test("the card keeps the cushion, says where the next dollars go, and quotes the owner's sentence", () => {
    const plan = depositCashPlan({ reportedCashCents: 600000, bufferCents: 200000, banks: steps([["Chase", 500000], ["Bank of America", 500000]]) });
    assert.equal(plan.freeCents, 400000);
    assert.equal(plan.message, "Your next $1,000 goes to Chase.");
    assert.equal(plan.shortText, "Chase needs $5,000. You have $4,000 after your $2,000 cushion.");
    assert.equal(plan.note, "The more you put in and leave in, the stronger your bank relationship.");
    assert.doesNotMatch(plan.note, /approval/i, "the bank book has no deposit-to-approval formula (design review 2026-11-07)");
    const covered = depositCashPlan({ reportedCashCents: 1500000, bufferCents: 200000, banks: steps([["Chase", 500000], ["Bank of America", 500000]]) });
    assert.equal(covered.status, "covered");
    assert.equal(covered.message, "Every bank on your plan is covered.");
    assert.deepEqual(covered.rows.map((r) => r.status), ["covered", "covered"]);
  });

  /* Design review 2026-11-07: "covered" only when every amount is known and covered. */
  test("a bank with no deposit amount yet is named; the plan never says every bank is covered", () => {
    const plan = depositCashPlan({ reportedCashCents: 1500000, bufferCents: 200000, banks: steps([["Bank of America", 500000]]) });
    assert.deepEqual(plan.rows.map((r) => [r.bank, r.status]), [["Chase", "not_set"], ["Bank of America", "covered"]]);
    assert.equal(plan.next, null);
    assert.equal(plan.status, "partly_set");
    assert.equal(plan.message, "Deposit not set yet for Chase.");
    assert.doesNotMatch(plan.message, /covered/);
  });

  test("connected PERSONAL cash is used, and business cash is never added to it", () => {
    const plan = depositCashPlan({ reportedCashCents: 9900000, connectedPersonal: { cents: 400000, isFloor: false, accounts: 1 },
      bufferCents: 100000, banks: steps([["Chase", 500000]]) });
    assert.equal(plan.haveCents, 400000);
    assert.equal(plan.haveSource, "connected_personal");
    assert.equal(plan.rows[0].giveCents, 300000);
    const noAccounts = depositCashPlan({ reportedCashCents: 600000, connectedPersonal: { cents: 0, accounts: 0 }, bufferCents: 100000, banks: steps([["Chase", 500000]]) });
    assert.equal(noAccounts.haveSource, "reported_on_plan");
    assert.equal(noAccounts.haveCents, 600000);
  });

  test("unknown cash or an unknown cushion plans nothing", () => {
    const a = depositCashPlan({ reportedCashCents: null, bufferCents: 100000, banks: steps([["Chase", 500000]]) });
    assert.equal(a.status, "needs_cash");
    assert.ok(a.rows.every((r) => r.giveCents === 0));
    assert.equal(depositCashPlan({ reportedCashCents: 600000, bufferCents: null, banks: steps([["Chase", 500000]]) }).status, "needs_buffer");
  });

  test("the businesses checklist reuses the company audit: name, NAICS, website, LinkedIn, then LLC and EIN", () => {
    const out = businessChecklist({ businesses: [{ id: "p1", name: "Cedar Grove LLC", activity: "Web design", formationStatus: "planned",
      evidence: { formation: { status: "not_added" }, ein: { status: "not_added" } } }], existingBusinesses: [] });
    assert.deepEqual(out.list[0].items.map((i) => i.key), ["name_check", "naics", "website", "linkedin", "llc", "ein"]);
    assert.equal(out.list[0].items.find((i) => i.key === "website").text, "Needed: banks check online presence.");
    assert.equal(out.list[0].items.find((i) => i.key === "linkedin").text, "Recommended: lenders like to see it.");
    assert.equal(out.list[0].first, true);
    assert.doesNotMatch(JSON.stringify(out), /\$\d/, "no price for another business");
  });
});

/* ── IMPACT: only what UnderwriteIQ measured on the saved pulls (no points) ── */

const DEMO = JSON.parse(readFileSync(new URL("../../public/app/blueprint-demo-data.json", import.meta.url), "utf8"));
const pullRow = (k) => ({ id: DEMO.creditSnapshots[k].source.reportId, created_at: DEMO.creditSnapshots[k].source.asOf, result: DEMO.creditSnapshots[k].raw });
/* The engine run again on the sample pull, at the pull's own date, the way the
   demo build ran it (scripts/demo/build-blueprint-dashboard-data.mjs). */
function engineOn(k) {
  const snap = DEMO.creditSnapshots[k];
  const OriginalDate = globalThis.Date;
  try {
    globalThis.Date = class extends OriginalDate {
      constructor(...a) { super(...(a.length ? a : [snap.source.asOf])); }
      static now() { return new OriginalDate(snap.source.asOf).getTime(); }
    };
    return runTierEngineFromCrsResult(snap.raw, { submittedName: "Alex Sample", submittedAddress: "100 Example Street, Phoenix, AZ, 85004" });
  } finally { globalThis.Date = OriginalDate; }
}

describe("every number comes from UnderwriteIQ, and there are no points", () => {
  const first = engineOn("initial");
  const last = engineOn("updated");

  test("VERIFY: the stored engine output matches the engine run again on the same pull", () => {
    assert.deepEqual(first.findings.map((f) => f.code), DEMO.creditSnapshots.initial.analysis.findings.map((f) => f.code));
    assert.deepEqual(last.findings.map((f) => f.code), DEMO.creditSnapshots.updated.analysis.findings.map((f) => f.code));
    assert.equal(first.preapprovals.totalPersonal, DEMO.creditSnapshots.initial.analysis.preapprovals.totalPersonal);
    assert.equal(last.preapprovals.totalPersonal, DEMO.creditSnapshots.updated.analysis.preapprovals.totalPersonal);
  });

  const baseline = measurePull(pullRow("initial"), { analysis: first });
  const newest = measurePull(pullRow("updated"), { analysis: last });

  test("a card is one measured problem however many bureaus report it; business findings and advice are not counted", () => {
    assert.equal(first.findings.filter((f) => f.code === "UTIL_CARD_OVER_10").length, 6);
    assert.deepEqual(measuredFindings(first.findings).map((f) => f.id),
      ["UTIL_CARD_OVER_10:sample_card_a", "UTIL_CARD_OVER_10:sample_card_b", "UTIL_MODERATE", "INQUIRY_REMOVAL"]);
    assert.ok(!measuredFindings([{ code: "FUNDING_FIRST", category: "strategic", severity: "high" }]).length);
    assert.deepEqual(baseline.cards.map((c) => [c.key, c.utilPct]), [["sample_card_a", 30], ["sample_card_b", 17]]);
    assert.deepEqual(newest.cards.map((c) => [c.key, c.utilPct]), [["sample_card_a", 5], ["sample_card_b", 5]]);
  });

  /* The Fundability read (src/finance/fundability.mjs) and the personal engine
     read its businessRead() sizes a business from: the business slice comes from
     them, never from the pull's pre-approval. UnderwriteIQ itself is not changed. */
  const FUND = { score: 6, score_max: 6, tier: "fundable", businesses: [] };
  const POINT = { uw: { primary_bureau: "experian", per_bureau: { experian: { cardFunding: 44000 } } }, tier: "fundable",
    checks: [{ key: "anchor_card", passed: true }], scored: true };
  const unlock = businessUnlockFor({ fundabilityNow: FUND, businessPoint: POINT, businessPlans: { businesses: [{ id: "p1", name: "Cedar Grove LLC", formationStatus: "planned" }] }, now: new Date("2026-11-06") });

  test("each step shows what the engine measured: card use, the business rule, or a bank requirement", () => {
    const path = buildBlueprintPath({ progress: { waypoints: CHECKLIST }, bankPlan: { recommended_banks: [CHASE] }, credit: { baseline, newest },
      businessUnlock: unlock, fundabilityNow: { score: 6, score_max: 6, tier: "fundable" } });
    const by = (k) => path.steps.find((s) => s.key === k);
    assert.equal(by("paydown_sample_card_a").impact, "Card use 30% → 5%");
    assert.equal(by("form_llc").impact, "UnderwriteIQ estimate: $22,000 business funding");
    assert.match(by("form_llc").iq, /your card funding \(\$44,000\) × 0\.5 while the business is under 12 months old/);
    assert.match(by("form_llc").iq, /does not change your personal credit/);
    for (const k of ["get_ein", "check_chexsystems", "bank_open_chase"]) assert.equal(by(k).impact, BANK_REQUIREMENT, k);
    assert.equal(by("bank_open_chase").iq, BANK_REQUIREMENT_WORDS);
    assert.equal(path.header, PATH_HEADER);
    assert.doesNotMatch(JSON.stringify(path), /\bpoints?\b/i, "no points anywhere");
  });

  test("milestones measured on the pulls: all cards under 10% with the engine's dollars, and score over 700", () => {
    const path = buildBlueprintPath({ progress: { waypoints: CHECKLIST }, credit: { baseline, newest },
      fundabilityNow: { score: 6, score_max: 6, tier: "fundable" } });
    const all = path.milestones.find((m) => m.id === "overall_utilization");
    assert.equal(all.title, "All cards together under 10%");
    assert.equal(all.impact, "+$10,400 funding");
    assert.equal(all.iq, "UnderwriteIQ removes its card-use penalty (×0.9 → ×1.0): personal card $39,600 → $44,000 and personal loan $54,000 → $60,000.");
    const score = path.milestones.find((m) => m.id === "score_700");
    assert.equal(score.impact, "Fundable");
    assert.match(score.iq, /Newest pull: 718\./);
    assert.ok(!path.milestones.some((m) => /Sample Card A/.test(m.title)), "a card with its own step is not a milestone too");
    assert.equal(path.milestones.find((m) => /Sample Card B/.test(m.title)).impact, "Card use 17% → 5%");
  });

  test("with one pull nothing has moved: the card shows its target and the milestone is still open", () => {
    const path = buildBlueprintPath({ progress: { waypoints: CHECKLIST }, credit: { baseline, newest: baseline },
      opportunity: DEMO.creditSnapshots.initial.opportunity });
    assert.equal(path.steps.find((s) => s.key === "paydown_sample_card_a").impact, "Card use 30% · target 10%");
    const all = path.milestones.find((m) => m.id === "overall_utilization");
    assert.equal(all.state, "open");
    assert.equal(all.impact, "Worth +$10,400");
    assert.equal(path.milestones.find((m) => m.id === "score_700").impact, "Needed to be fundable");
  });

  test("no credit report means no numbers, said plainly", () => {
    const path = buildBlueprintPath({ progress: { waypoints: CHECKLIST } });
    assert.equal(path.measured, null);
    assert.equal(path.milestones.length, 0);
    assert.equal(path.steps.find((s) => s.key === "paydown_sample_card_a").impact, "Needs a credit report");
    assert.equal(path.steps.find((s) => s.key === "get_ein").impact, BANK_REQUIREMENT, "a bank step says the same with or without a report");
  });

  test("the business rule: × 0.5 under 12 months, × 1 from 12, × 2 from 24, and nothing without a business", () => {
    assert.equal(unlock.cents, 2200000);
    const plans = (date) => ({ businesses: [{ id: "p1", name: "B", formationStatus: "reported_formed", formationDate: date }] });
    assert.equal(businessUnlockFor({ fundabilityNow: FUND, businessPoint: POINT, businessPlans: plans("2025-09-01"), now: new Date("2026-11-06") }).multiplier, 1);
    assert.equal(businessUnlockFor({ fundabilityNow: FUND, businessPoint: POINT, businessPlans: plans("2024-01-01"), now: new Date("2026-11-06") }).cents, 8800000);
    assert.equal(businessUnlockFor({ fundabilityNow: FUND, businessPoint: POINT, businessPlans: { businesses: [], existingBusinesses: [] } }), null);
    assert.equal(businessUnlockFor({ fundabilityNow: null, businessPoint: POINT, businessPlans: plans("2024-01-01") }), null);
    assert.equal(businessUnlockFor({ fundabilityNow: FUND, businessPoint: null, businessPlans: plans("2024-01-01") }), null, "no engine read, no amount");
    // The Fundability rule decides: not fundable, or a failed anchor-card check, shows no amount.
    assert.equal(businessUnlockFor({ fundabilityNow: FUND, businessPoint: { ...POINT, tier: "not_fundable" }, businessPlans: plans("2024-01-01") }), null);
    assert.equal(businessUnlockFor({ fundabilityNow: FUND, businessPoint: { ...POINT, checks: [{ key: "anchor_card", passed: false }] }, businessPlans: plans("2024-01-01") }), null);
    // The same number src/finance/fundability.mjs businessRead() prints for that business.
    for (const age of [0, 13, 30]) {
      const formed = age === 0 ? { businesses: [{ id: "p1", name: "B", formationStatus: "planned" }] } : null;
      const got = formed
        ? businessUnlockFor({ fundabilityNow: FUND, businessPoint: POINT, businessPlans: formed, now: new Date("2026-11-06") })
        : businessUnlockFor({ fundabilityNow: FUND, businessPoint: POINT, businessPlans: { businesses: [], existingBusinesses: [{ id: "e1", name: "B", ageMonths: age }] }, now: new Date("2026-11-06") });
      assert.equal(got.cents, businessRead(POINT, { row: null, name: "B", source: "blueprint" }, age).funding_estimate_cents, `age ${age}`);
    }
    // A business the Fundability read already lists keeps that read's own estimate and age.
    const listed = { ...FUND, businesses: [{ business_id: null, name: "b", age_months: 30, estimate_cents: 1234500, multiplier: 2 }] };
    const same = businessUnlockFor({ fundabilityNow: listed, businessPlans: plans("2026-10-01"), now: new Date("2026-11-06") });
    assert.equal(same.cents, 1234500);
    assert.equal(same.multiplier, 2);
  });

  test("the engine read for a planned business uses the Fundability read's own rows, scoped to the client and org", async () => {
    const calls = [];
    const db = { query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === POINT_CLIENT_SQL) return { rows: [{ custom_fields: { crs_inquiries_ex: 0 } }] };
      return { rows: [] };
    } };
    let seen = null;
    const point = await readBusinessPoint(db, { orgId: "org-1", clientId: "c-1" }, {
      readEngineImpl: (base) => { seen = base; return readEngine(base); }
    });
    assert.deepEqual(calls.map((c) => c.sql).sort(), [POINT_CLIENT_SQL, POINT_CRS_SQL, POINT_TRADELINE_SQL, POINT_LIABILITY_SQL, POINT_BUSINESS_SQL].sort());
    for (const c of calls) assert.deepEqual(c.params, ["c-1", "org-1"]);
    for (const sql of [POINT_CRS_SQL, POINT_TRADELINE_SQL, POINT_LIABILITY_SQL, POINT_BUSINESS_SQL]) assert.match(sql, /client_id = \$1 AND org_id = \$2/);
    assert.deepEqual(seen.customFields, { crs_inquiries_ex: 0 });
    assert.equal(point.scored, false, "no pull on file: nothing scored");
    assert.equal(point.tier, null);
    const none = await readBusinessPoint({ query: async () => ({ rows: [] }) }, { orgId: "org-1", clientId: "c-1" });
    assert.equal(none, null, "a client not in the org reads nothing");
  });

  test("the funding change is the engine's own dollars and the modifier that moved", () => {
    const f = pathFunding({ baseline, newest });
    assert.equal(f.change.beforeCents, 9360000);
    assert.equal(f.change.afterCents, 10400000);
    assert.equal(f.change.deltaCents, 1040000);
    assert.deepEqual(f.change.moved.map((m) => [m.modifier, m.from, m.to]), [["utilization", 0.9, 1]]);
    assert.equal(f.change.text, "UnderwriteIQ modifier moved: card use ×0.9 → ×1.0, worth +$10,400.");
    assert.deepEqual(modifiersMoved({ personalCard: { utilization: 1 } }, { personalCard: { utilization: 1 } }), []);
    assert.equal(pathFunding({ baseline, newest: baseline }).change, null, "one pull, no change claimed");
  });

  test("fundability reads the engine's own count and tier; nothing scored reads null", () => {
    assert.equal(fundabilityLine({ score: 6, score_max: 6, tier: "fundable" }).text, "Fundability 6 of 6 · Fundable");
    assert.equal(fundabilityLine({ score: 4, score_max: 6, tier: "not_fundable" }).text, "Fundability 4 of 6 · Not fundable yet");
    assert.equal(fundabilityLine({ score: null, score_max: 6, tier: null }), null);
  });
});

describe("the read", () => {
  test("every query names the client and the org, nothing writes, and a failed cash read is null", async () => {
    const seen = [];
    const db = { async query(sql, params) { seen.push({ sql, params }); return { rows: [{ id: "d1", subtype: "chexsystems_report", filename: "c.pdf", generated_at: new Date("2026-11-01"), review_status: "accepted" },
      { id: "d2", subtype: "other" }] }; } };
    const path = await readBlueprintPath(db, { orgId: "o", clientId: "c" }, { progress: { waypoints: CHECKLIST },
      readConnectedCash: async () => { throw new Error("down"); }, readFundability: async () => ({ score: 3, score_max: 6, tier: "not_fundable" }) });
    assert.deepEqual(seen.map((q) => q.params), [["c", "o"]]);
    assert.doesNotMatch(seen[0].sql, /INSERT|UPDATE|DELETE/);
    assert.deepEqual(path.chexsystems.step.uploads.map((u) => u.documentId), ["d1"]);
    assert.equal(path.cash.haveSource, null);
    assert.equal(path.fundability.text, "Fundability 3 of 6 · Not fundable yet");
  });
});
