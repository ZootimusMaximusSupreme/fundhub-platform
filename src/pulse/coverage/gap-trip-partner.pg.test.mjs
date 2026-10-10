// trip:partner: the SQL itself, on a real Postgres. Read only. Skips unless DATABASE_URL is set.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-trip-partner.pg.test.mjs
//
// Same harness as gap-trip-funding.pg.test.mjs: BEGIN READ ONLY, always rolled back, every table
// shadowed by the made-up rows of the scenario with its columns pinned to the real table.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { AFFILIATE_SQL, PARTNER_SQL, judgePartner, toAffiliateRow, toPartnerRow, tripParams } from "./gap-trip-partner.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, emptyWorld, runWorld, uid } from "./trip-test-kit.mjs";

const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

after(async () => {
  if (HAS_DB) await closeShadowDb();
});

const AFF_TABLES = [
  "affiliates", "affiliate_link_clicks", "affiliate_referrals", "sales", "products", "sale_payments",
  "funding_rounds", "payment_links", "affiliate_payout_lines", "affiliate_payouts", "accounts"
];
const PAR_TABLES = [
  "partners", "partner_pages", "clients", "sale_payments", "sales", "products", "partner_revenue", "partner_payouts"
];

function affWorld() {
  const w = emptyWorld(AFF_TABLES);
  const ids = { repair: uid(), funding: uid(), consulting: uid(), diagnostic: uid() };
  w.products.rows.push(
    { id: ids.repair, org_id: ORG, code: "repair-bundle", category: "repair" },
    { id: ids.funding, org_id: ORG, code: "card-stacking-dfy", category: "funding" },
    { id: ids.consulting, org_id: ORG, code: "diy-letter-pack", category: "consulting" },
    { id: ids.diagnostic, org_id: ORG, code: "diagnostic", category: "diagnostic" }
  );
  return { w, ids };
}

function addAff(w, over = {}) {
  const id = uid();
  w.affiliates.rows.push({
    id, org_id: ORG, name: "Pat Referrer", tracking_id: `TRK${w.affiliates.rows.length}`, status: "active",
    created_at: ago(20 * DAY), activated_at: null, is_demo: false, tier_level: "tier1",
    partner_license_signed_at: null, tax_form_received_at: null, ...over
  });
  w.accounts.rows.push({ org_id: ORG, affiliate_id: id, email: `pat${w.affiliates.rows.length}@gmail.com` });
  return id;
}

async function runAff(w, now = NOW) {
  const p = tripParams(ORG, now);
  const out = await runWorld(AFFILIATE_SQL, w, p.affiliate);
  return { rows: out.rows, verdict: judgePartner({ affiliates: out.rows, now }) };
}

async function runPar(w, now = NOW) {
  const p = tripParams(ORG, now);
  const out = await runWorld(PARTNER_SQL, w, p.partner);
  return { rows: out.rows, verdict: judgePartner({ partners: out.rows, pages: new Map(out.rows.map((r) => [String(r.payee_id), { ok: true }])), now }) };
}

const skip = HAS_DB ? false : "DATABASE_URL is not set";

/* ---------- affiliates ---------- */

test("SQL: nobody applied is a nothing-to-judge", { skip }, async () => {
  const { w } = affWorld();
  const { rows, verdict } = await runAff(w);
  assert.equal(rows.length, 0);
  assert.equal(verdict.status, "na");
});

test("SQL GREEN: an affiliate with a code, waiting for the first click", { skip }, async () => {
  const { w } = affWorld();
  addAff(w);
  const { rows, verdict } = await runAff(w);
  assert.equal(rows.length, 1);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 waiting \(1 at "a click credited to the affiliate"\)/);
});

test("SQL RED: a click with the affiliate's code credited to nobody, case-insensitive", { skip }, async () => {
  const { w } = affWorld();
  const a = addAff(w, { tracking_id: "AbC123" });
  w.affiliate_link_clicks.rows.push({ org_id: ORG, affiliate_id: a, tracking_id_used: "AbC123", occurred_at: ago(3 * DAY) });
  w.affiliate_link_clicks.rows.push({ org_id: ORG, affiliate_id: null, tracking_id_used: "abc123", occurred_at: ago(2 * DAY) });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /1 click carried this affiliate's code and was credited to nobody/);
});

test("SQL GREEN: a click with a code nobody holds is not this affiliate's miss", { skip }, async () => {
  const { w } = affWorld();
  addAff(w, { tracking_id: "REAL1" });
  w.affiliate_link_clicks.rows.push({ org_id: ORG, affiliate_id: null, tracking_id_used: "TYPO9", occurred_at: ago(DAY) });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL GREEN: a click from before the affiliate existed is not a miss", { skip }, async () => {
  const { w } = affWorld();
  addAff(w, { tracking_id: "OLD1", created_at: ago(5 * DAY) });
  w.affiliate_link_clicks.rows.push({ org_id: ORG, affiliate_id: null, tracking_id_used: "OLD1", occurred_at: ago(9 * DAY) });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: the referred client paid for a repair plan and the referral is still attributed", { skip }, async () => {
  const { w, ids } = affWorld();
  const a = addAff(w);
  const client = uid();
  const referral = uid();
  const sale = uid();
  w.affiliate_referrals.rows.push({
    id: referral, org_id: ORG, affiliate_id: a, client_id: client, tier: "direct", status: "attributed",
    converted_at: null, commission_due: null
  });
  w.sales.rows.push({
    id: sale, org_id: ORG, client_id: client, product_id: ids.repair, status: "active", sold_at: ago(2 * DAY),
    is_demo: false, agreed_success_fee_percent: null
  });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: null, source_event_id: null, kind: "deposit", amount: 200,
    paid_at: ago(2 * DAY), created_at: ago(2 * DAY), is_demo: false, product_id: ids.repair
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "a referral converted"/);
});

test("SQL GREEN: a payment 5 minutes old is still inside convert()'s wait", { skip }, async () => {
  const { w, ids } = affWorld();
  const a = addAff(w);
  const client = uid();
  const sale = uid();
  w.affiliate_referrals.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, client_id: client, tier: "direct", status: "attributed", converted_at: null, commission_due: null
  });
  w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.repair, status: "active", sold_at: ago(5 * MIN), is_demo: false, agreed_success_fee_percent: null });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: null, source_event_id: null, kind: "deposit", amount: 200,
    paid_at: ago(5 * MIN), created_at: ago(5 * MIN), is_demo: false, product_id: ids.repair
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL GREEN: a purchase that does not qualify (a DIY letter pack) owes no conversion", { skip }, async () => {
  const { w, ids } = affWorld();
  const a = addAff(w);
  const client = uid();
  const sale = uid();
  w.affiliate_referrals.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, client_id: client, tier: "direct", status: "attributed", converted_at: null, commission_due: null
  });
  w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.consulting, status: "active", sold_at: ago(2 * DAY), is_demo: false, agreed_success_fee_percent: null });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: null, source_event_id: null, kind: "deposit", amount: 49, paid_at: ago(2 * DAY),
    created_at: ago(2 * DAY), is_demo: false, product_id: ids.consulting
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL: a funding sale qualifies only once a round has funded", { skip }, async () => {
  const { w, ids } = affWorld();
  const a = addAff(w);
  const funded = uid();
  const unfunded = uid();
  for (const [client, fundedAmount] of [[funded, 25000], [unfunded, null]]) {
    const sale = uid();
    w.affiliate_referrals.rows.push({
      id: uid(), org_id: ORG, affiliate_id: a, client_id: client, tier: "direct", status: "attributed", converted_at: null, commission_due: null
    });
    w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.funding, status: "active", sold_at: ago(2 * DAY), is_demo: false, agreed_success_fee_percent: 10 });
    w.sale_payments.rows.push({
      id: uid(), org_id: ORG, sale_id: sale, transaction_id: null, source_event_id: null, kind: "deposit", amount: 3000,
      paid_at: ago(2 * DAY), created_at: ago(2 * DAY), is_demo: false, product_id: ids.funding
    });
    w.funding_rounds.rows.push({
      id: uid(), org_id: ORG, client_id: client, round_number: 1, status: fundedAmount ? "funded" : "started",
      product: "card_stacking", funded_amount: fundedAmount, created_at: ago(5 * DAY), updated_at: ago(3 * DAY), is_demo: false
    });
  }
  const out = await runWorld(AFFILIATE_SQL, w, tripParams(ORG, NOW).affiliate);
  assert.equal(out.rows[0].unconverted_paid_n, 1, "only the funded client's referral owes a conversion");
});

test("SQL: a downline referral of a tier 1 recruiter is not owed a conversion", { skip }, async () => {
  const { w, ids } = affWorld();
  const a = addAff(w, { tier_level: "tier1" });
  const client = uid();
  const sale = uid();
  w.affiliate_referrals.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, client_id: client, tier: "downline", status: "attributed", converted_at: null, commission_due: null
  });
  w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.repair, status: "active", sold_at: ago(2 * DAY), is_demo: false, agreed_success_fee_percent: null });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: null, source_event_id: null, kind: "deposit", amount: 200, paid_at: ago(2 * DAY),
    created_at: ago(2 * DAY), is_demo: false, product_id: ids.repair
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: a converted referral with no commission number", { skip }, async () => {
  const { w } = affWorld();
  const a = addAff(w);
  w.affiliate_referrals.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, client_id: uid(), tier: "direct", status: "converted",
    converted_at: ago(2 * DAY), commission_due: null
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "commission worked out on the converted referral"/);
});

test("SQL GREEN: a converted referral with a number, waiting for the monthly run", { skip }, async () => {
  const { w } = affWorld();
  const a = addAff(w);
  w.affiliate_referrals.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, client_id: uid(), tier: "direct", status: "converted",
    converted_at: ago(2 * DAY), commission_due: 40
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: payable commission with the paperwork done and no payout line", { skip }, async () => {
  const { w } = affWorld();
  const a = addAff(w, { partner_license_signed_at: ago(40 * DAY), tax_form_received_at: ago(40 * DAY) });
  w.affiliate_referrals.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, client_id: uid(), tier: "direct", status: "converted",
    converted_at: ago(18 * DAY), commission_due: 150
  });
  // converted before the start of this month, so it is in last month's run
  const first = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
  const earlier = new Date(first.getTime() - 3 * DAY).toISOString();
  w.affiliate_referrals.rows[0].converted_at = earlier;
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /\$150 of commission is payable/);
});

test("SQL GREEN: the same commission is on a pending run", { skip }, async () => {
  const { w } = affWorld();
  const a = addAff(w, { partner_license_signed_at: ago(40 * DAY), tax_form_received_at: ago(40 * DAY) });
  const referral = uid();
  const payout = uid();
  const first = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
  w.affiliate_referrals.rows.push({
    id: referral, org_id: ORG, affiliate_id: a, client_id: uid(), tier: "direct", status: "converted",
    converted_at: new Date(first.getTime() - 3 * DAY).toISOString(), commission_due: 150
  });
  w.affiliate_payouts.rows.push({
    id: payout, org_id: ORG, affiliate_id: a, status: "pending", paid_at: null, created_at: ago(DAY), initiated_at: null
  });
  w.affiliate_payout_lines.rows.push({ payout_id: payout, referral_id: referral, kind: "commission" });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: a payout held for over a day names the missing stamp", { skip }, async () => {
  const { w } = affWorld();
  const a = addAff(w, { partner_license_signed_at: null, tax_form_received_at: ago(5 * DAY) });
  w.affiliate_payouts.rows.push({
    id: uid(), org_id: ORG, affiliate_id: a, status: "held", paid_at: null, created_at: ago(3 * DAY), initiated_at: null
  });
  const { verdict } = await runAff(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /on hold for over a day: the partner license is not signed/);
});

test("SQL: sim, e2e and test affiliates, demo rows, no-login rows, other companies and old applicants are left out", { skip }, async () => {
  const { w } = affWorld();
  addAff(w, { name: "Sim Aff Deep" });
  addAff(w, { name: "E2E Aff Click" });
  addAff(w, { name: "t10affstats-alpha" });
  addAff(w, { is_demo: true });
  addAff(w, { created_at: ago(61 * DAY) });
  const noLogin = uid();
  w.affiliates.rows.push({
    id: noLogin, org_id: ORG, name: "No Login", tracking_id: "NL1", status: "active", created_at: ago(DAY),
    activated_at: null, is_demo: false, tier_level: "tier1", partner_license_signed_at: null, tax_form_received_at: null
  });
  const testMail = addAff(w, { name: "Real Name" });
  w.accounts.rows.find((r) => r.affiliate_id === testMail).email = "x+sim-aff-20260825s@gmail.com";
  const other = uid();
  w.affiliates.rows.push({
    id: other, org_id: OTHER_ORG, name: "Other Co", tracking_id: "OT1", status: "active", created_at: ago(DAY),
    activated_at: null, is_demo: false, tier_level: "tier1", partner_license_signed_at: null, tax_form_received_at: null
  });
  w.accounts.rows.push({ org_id: OTHER_ORG, affiliate_id: other, email: "o@gmail.com" });
  const { rows } = await runAff(w);
  assert.equal(rows.length, 0);
});

/* ---------- white-label partners ---------- */

function parWorld() {
  const w = emptyWorld(PAR_TABLES);
  const ids = { funding: uid(), course: uid() };
  w.products.rows.push(
    { id: ids.funding, org_id: ORG, code: "card-stacking-dfy", category: "funding" },
    { id: ids.course, org_id: ORG, code: "funding-mastery", category: "consulting" }
  );
  return { w, ids };
}

function addPar(w, over = {}) {
  const id = uid();
  w.partners.rows.push({
    id, org_id: ORG, name: "Acme Capital LLC", brand_name: "Acme Capital", slug: `acme-${w.partners.rows.length}`,
    status: "active", created_at: ago(20 * DAY), updated_at: ago(19 * DAY), activated_at: null,
    agreement_signed_at: ago(18 * DAY), contact_email: `owner${w.partners.rows.length}@acmecap.com`, is_demo: false,
    revenue_share_pct: 50, ...over
  });
  return id;
}

function page(w, partnerId, over = {}) {
  w.partner_pages.rows.push({
    org_id: ORG, partner_id: partnerId, slug: "apply", status: "published", published_at: ago(19 * DAY), ...over
  });
}

test("SQL GREEN: an invited applicant waits for approval", { skip }, async () => {
  const { w } = parWorld();
  addPar(w, { status: "invited" });
  const { rows, verdict } = await runPar(w);
  assert.equal(rows.length, 1);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 waiting \(1 at "approved \(status active\)"\)/);
});

test("SQL RED: an active partner with no published page", { skip }, async () => {
  const { w } = parWorld();
  const p = addPar(w);
  page(w, p, { status: "draft", published_at: null });
  const { verdict } = await runPar(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "page published and live"/);
});

test("SQL GREEN: an active partner with a published page waits for a first lead", { skip }, async () => {
  const { w } = parWorld();
  const p = addPar(w);
  page(w, p);
  const { rows, verdict } = await runPar(w);
  assert.equal(rows[0].page_slug, "apply");
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 at "a lead came in through the partner"/);
});

test("SQL RED: a client of the partner paid a deposit on a shared product and no accrual exists", { skip }, async () => {
  const { w, ids } = parWorld();
  const p = addPar(w);
  page(w, p);
  const client = uid();
  const sale = uid();
  w.clients.rows.push({
    id: client, org_id: ORG, client_code: "FH-1", email: "c@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(15 * DAY), updated_at: ago(DAY), partner_id: p
  });
  w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.funding, status: "active", sold_at: ago(5 * DAY), is_demo: false, agreed_success_fee_percent: 10 });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: uid(), source_event_id: null, kind: "deposit", amount: 3000,
    paid_at: ago(5 * DAY), created_at: ago(5 * DAY), is_demo: false, product_id: ids.funding
  });
  const { verdict } = await runPar(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /1 payment from this partner's clients/);
});

test("SQL GREEN: the accrual row exists for that payment (matched by transaction)", { skip }, async () => {
  const { w, ids } = parWorld();
  const p = addPar(w);
  page(w, p);
  const client = uid();
  const sale = uid();
  const tx = uid();
  w.clients.rows.push({
    id: client, org_id: ORG, client_code: "FH-1", email: "c@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(15 * DAY), updated_at: ago(DAY), partner_id: p
  });
  w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.funding, status: "active", sold_at: ago(5 * DAY), is_demo: false, agreed_success_fee_percent: 10 });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: tx, source_event_id: null, kind: "deposit", amount: 3000,
    paid_at: ago(5 * DAY), created_at: ago(5 * DAY), is_demo: false, product_id: ids.funding
  });
  w.partner_revenue.rows.push({
    org_id: ORG, partner_id: p, transaction_id: tx, source_event_id: null, status: "accrued", created_at: ago(5 * DAY)
  });
  const { verdict } = await runPar(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL: a payment on a product the partner shares in counts as a paid lead; a course payment does not", { skip }, async () => {
  const { w, ids } = parWorld();
  const p = addPar(w);
  page(w, p);
  const client = uid();
  w.clients.rows.push({
    id: client, org_id: ORG, client_code: "FH-1", email: "c@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(15 * DAY), updated_at: ago(DAY), partner_id: p
  });
  for (const [product, amount] of [[ids.funding, 3000], [ids.course, 5000]]) {
    const sale = uid();
    w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: product, status: "active", sold_at: ago(5 * DAY), is_demo: false, agreed_success_fee_percent: null });
    w.sale_payments.rows.push({
      id: uid(), org_id: ORG, sale_id: sale, transaction_id: uid(), source_event_id: null, kind: "deposit", amount,
      paid_at: ago(5 * DAY), created_at: ago(5 * DAY), is_demo: false, product_id: product
    });
  }
  const out = await runWorld(PARTNER_SQL, w, tripParams(ORG, NOW).partner);
  assert.equal(out.rows[0].paid_in_n, 1);
  assert.equal(out.rows[0].unaccrued_n, 1);
});

test("SQL GREEN: a course payment is excluded from the share on purpose", { skip }, async () => {
  const { w, ids } = parWorld();
  const p = addPar(w);
  page(w, p);
  const client = uid();
  const sale = uid();
  w.clients.rows.push({
    id: client, org_id: ORG, client_code: "FH-1", email: "c@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(15 * DAY), updated_at: ago(DAY), partner_id: p
  });
  w.sales.rows.push({ id: sale, org_id: ORG, client_id: client, product_id: ids.course, status: "active", sold_at: ago(5 * DAY), is_demo: false, agreed_success_fee_percent: null });
  w.sale_payments.rows.push({
    id: uid(), org_id: ORG, sale_id: sale, transaction_id: uid(), source_event_id: null, kind: "deposit", amount: 5000,
    paid_at: ago(5 * DAY), created_at: ago(5 * DAY), is_demo: false, product_id: ids.course
  });
  const { verdict } = await runPar(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: a partner payout held because the agreement is not signed", { skip }, async () => {
  const { w } = parWorld();
  const p = addPar(w, { agreement_signed_at: null });
  page(w, p);
  w.partner_payouts.rows.push({ id: uid(), org_id: ORG, partner_id: p, status: "held", paid_at: null, created_at: ago(3 * DAY), initiated_at: null });
  const { verdict } = await runPar(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /the partner agreement is not signed/);
});

test("SQL: sim, e2e and house partners, a partner with no contact address, demo rows and old applicants are left out", { skip }, async () => {
  const { w } = parWorld();
  addPar(w, { name: "Sim Wl Co", brand_name: "Sim Wl Co" });
  addPar(w, { name: "E2E WL Click Co", brand_name: "E2E WL Click Co" });
  addPar(w, { name: "Fundhub Direct", brand_name: "Fundhub.ai" });
  addPar(w, { name: "FundHub (house)", brand_name: "FundHub (house)", contact_email: null });
  addPar(w, { contact_email: "x+wl-onboard@fundhub.ai" });
  addPar(w, { is_demo: true });
  addPar(w, { created_at: ago(61 * DAY) });
  const { rows } = await runPar(w);
  assert.equal(rows.length, 0);
});

test("SQL: the pure converters read the SQL rows the way the verdict expects", { skip }, async () => {
  const { w } = parWorld();
  const p = addPar(w);
  page(w, p);
  const out = await runWorld(PARTNER_SQL, w, tripParams(ORG, NOW).partner);
  const t = toPartnerRow(out.rows[0], { ok: true }, NOW);
  assert.ok(t.facts.applied && t.facts.approved && t.facts.page_live);
  const a = affWorld().w;
  addAff(a);
  const aout = await runWorld(AFFILIATE_SQL, a, tripParams(ORG, NOW).affiliate);
  const at = toAffiliateRow(aout.rows[0], NOW);
  assert.ok(at.facts.applied && at.facts.approved && at.facts.page_live);
});
