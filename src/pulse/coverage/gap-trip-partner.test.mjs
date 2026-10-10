// trip:partner, both ways, for both kinds of partner. A break the company owns goes red and names the
// step. An applicant waiting for approval, a link nobody clicked and a payout waiting for the monthly
// run stay green. No database for the unit tests: a fake db answers by tag, and a fake fetch the pages.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCRUABLE_KINDS, AFFILIATE_SQL, AFFILIATE_STEPS, CHECK_IDS, PARTNER_SQL, PARTNER_STEPS, ROW_CAP,
  TEST_PAYEE_EMAIL_RE, TEST_PAYEE_NAME_RE, WINDOW_MS, gapChecks, judgePartner, naVerify, stepsFor,
  toAffiliateRow, toPartnerRow, tripParams
} from "./gap-trip-partner.mjs";
import { COUNT_SQL } from "./gap-trip-partner.mjs";
import { FUNDED_BILL_WAIT_MS, LOOKBACK_MS } from "./gap-money-funding.mjs";
import { SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { DEAD_LINK_WINDOW_MS, PAYOUT_STUCK_AFTER_MS } from "./gap-partners.mjs";
import { PARTNER_SHARE_PRODUCT_CODES } from "../../partners/revenue.mjs";
import { BY, walkTrip } from "./trip-kit.mjs";
import { tagDb } from "./money-test-kit.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-14T18:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ORG = "11111111-1111-4111-8111-111111111111";

function aff(over = {}) {
  return {
    payee_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Pat Referrer", tracking_id: "PAT123",
    status: "active", applied_at: ago(20 * DAY), activated_at: null, license_ok: false, tax_ok: false,
    credited_n: 0, first_click_at: null, uncredited_n: 0, converted_n: 0, converted_at: null, rated_n: 0,
    unrated_n: 0, unconverted_paid_n: 0, payable_usd: 0, paid_n: 0, paid_at: null, held_n: 0, stuck_n: 0,
    ...over
  };
}

function par(over = {}) {
  return {
    payee_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Acme Capital", slug: "acme-capital",
    status: "active", applied_at: ago(20 * DAY), approved_at: ago(19 * DAY), agreement_signed: true,
    page_slug: "apply", page_published_at: ago(19 * DAY), owned_n: 0, first_lead_at: null, paid_in_n: 0,
    first_paid_at: null, unaccrued_n: 0, revenue_n: 0, first_revenue_at: null, paid_n: 0, paid_at: null,
    held_n: 0, stuck_n: 0, share_pct: 50,
    ...over
  };
}

function walkAff(over) {
  const t = toAffiliateRow(aff(over), NOW);
  return walkTrip({ steps: stepsFor(t), facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail, defects: t.defects });
}

function walkPar(over, live = null) {
  const t = toPartnerRow(par(over), live, NOW);
  return walkTrip({ steps: stepsFor(t), facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail, defects: t.defects });
}

/* ---------- constants ---------- */

test("the check id and the two ladders keep the brief's seven keys in order", () => {
  assert.deepEqual([...CHECK_IDS], ["trip:partner"]);
  const keys = ["applied", "approved", "page_live", "referral_clicked", "referral_converted", "commission", "payout_paid"];
  assert.deepEqual(AFFILIATE_STEPS.map((s) => s.key), keys);
  assert.deepEqual(PARTNER_STEPS.map((s) => s.key), keys);
});

test("the waits are the other lanes' own numbers, and each system step names where its wait comes from", () => {
  for (const ladder of [AFFILIATE_STEPS, PARTNER_STEPS]) {
    for (const s of ladder.filter((x) => x.by === BY.SYSTEM)) {
      assert.ok(s.from && s.graceMs > 0 && /\w/.test(s.source || ""), `${s.key} names its anchor, wait and source`);
    }
  }
  const aff = Object.fromEntries(AFFILIATE_STEPS.map((s) => [s.key, s]));
  const part = Object.fromEntries(PARTNER_STEPS.map((s) => [s.key, s]));
  assert.equal(aff.commission.graceMs, SETTLE_GRACE_MS);
  assert.equal(part.page_live.graceMs, SETTLE_GRACE_MS);
  assert.equal(part.commission.graceMs, FUNDED_BILL_WAIT_MS);
  assert.equal(WINDOW_MS, LOOKBACK_MS);
  assert.equal(DEAD_LINK_WINDOW_MS, 30 * DAY);
  assert.equal(PAYOUT_STUCK_AFTER_MS, 7 * DAY);
  assert.deepEqual([...ACCRUABLE_KINDS], ["deposit", "installment", "success_fee"]);
});

test("the SELECTs write nothing and every parameter is used, once each in order", () => {
  for (const [sql, n] of [[AFFILIATE_SQL, 11], [PARTNER_SQL, 9]]) {
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert.match(bare, /^SELECT\b/i);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
    const used = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    assert.deepEqual(used, Array.from({ length: n }, (_, i) => i + 1));
    assert.match(sql, new RegExp(`LIMIT ${ROW_CAP}\\b`));
  }
  const p = tripParams(ORG, NOW);
  assert.equal(p.affiliate.length, 11);
  assert.equal(p.partner.length, 9);
  assert.deepEqual(p.partner[4], PARTNER_SHARE_PRODUCT_CODES.map((c) => c.toLowerCase()));
});

test("the test-payee patterns catch the sim, e2e and test rows that live holds and leave real people", () => {
  const nameRe = new RegExp(TEST_PAYEE_NAME_RE, "i");
  for (const n of [
    "Sim Aff Deep", "Sim WL Book E2e27", "E2E WL Book LLC", "TEST — Affiliate Role", "DEMO Partner — Northlight Capital",
    "t10affstats-alpha", "principalread Alpha", "Fundhub Direct", "FundHub (house)"
  ]) assert.match(n, nameRe, n);
  for (const n of ["Blake Evertsen", "Colin Schmidt", "GPN Funding", "Testimonials Inc", "Simmons Capital"]) {
    assert.doesNotMatch(n, nameRe, n);
  }
  const mailRe = new RegExp(TEST_PAYEE_EMAIL_RE, "i");
  for (const e of [
    "chris+sim-aff-20260825s@gmail.com", "chris+sim24-aff-20260824@gmail.com", "x+aff-click16@fundhub.ai",
    "a@demo.fundhub.local", "e2e+x@gmail.com", "walk@example.com", "chris+sim@gmail.com", "test.user@gmail.com",
    "x+test@gmail.com", "sim-run@gmail.com"
  ]) assert.match(e, mailRe, e);
  for (const e of ["blake@evertsenequity.com", "someone@gmail.com", "info@gpnfunding.com", "simon@gmail.com", "attest@gmail.com"]) {
    assert.doesNotMatch(e, mailRe, e);
  }
});

/* ---------- affiliates: RED ---------- */

test("RED: an affiliate whose referral link has no code, 20 days after applying", () => {
  const w = walkAff({ tracking_id: "" });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "page_live");
});

test("RED: a click carried the affiliate's code and was credited to nobody", () => {
  const w = walkAff({ credited_n: 3, first_click_at: ago(5 * DAY), uncredited_n: 2 });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "referral_clicked");
  assert.match(w.why, /2 clicks carried this affiliate's code and were credited to nobody/);
});

test("RED: a referred client paid for a qualifying product and the referral was never converted", () => {
  const w = walkAff({ credited_n: 1, first_click_at: ago(9 * DAY), unconverted_paid_n: 1 });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "referral_converted");
});

test("RED: a converted referral has no commission number (unrated)", () => {
  const w = walkAff({
    credited_n: 1, first_click_at: ago(9 * DAY), converted_n: 1, converted_at: ago(2 * DAY), unrated_n: 1, rated_n: 0
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "commission");
  assert.match(w.why, /no commission number/);
});

test("RED: a payout on hold for over a day names the missing stamp", () => {
  const w = walkAff({
    credited_n: 1, first_click_at: ago(30 * DAY), converted_n: 1, converted_at: ago(20 * DAY), rated_n: 1,
    held_n: 1, license_ok: false, tax_ok: true
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "payout_paid");
  assert.match(w.why, /on hold for over a day: the partner license is not signed/);
});

test("RED: a payout stuck in processing for a week", () => {
  const w = walkAff({
    credited_n: 1, first_click_at: ago(30 * DAY), converted_n: 1, converted_at: ago(20 * DAY), rated_n: 1, stuck_n: 1
  });
  assert.equal(w.state, "broken");
  assert.match(w.why, /stuck in processing for over 7 days/);
});

test("RED: commission is payable under the monthly rules and is on no run, even with an older payout paid", () => {
  const w = walkAff({
    credited_n: 1, first_click_at: ago(60 * DAY), converted_n: 2, converted_at: ago(50 * DAY), rated_n: 2,
    payable_usd: 180, license_ok: true, tax_ok: true, paid_n: 1, paid_at: ago(20 * DAY)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "payout_paid");
  assert.match(w.why, /\$180 of commission is payable/);
});

/* ---------- affiliates: GREEN ---------- */

test("GREEN: a brand-new affiliate with no clicks is waiting on strangers, not red", () => {
  const w = walkAff({ applied_at: ago(2 * HOUR) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "referral_clicked");
  assert.equal(w.step.by, BY.CLIENT);
});

test("GREEN: clicks and no conversion for 50 days is not red", () => {
  const w = walkAff({ applied_at: ago(58 * DAY), credited_n: 9, first_click_at: ago(55 * DAY) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "referral_converted");
});

test("GREEN: commission under the minimum, or with the license unsigned and no payout row, is waiting", () => {
  const under = walkAff({
    credited_n: 1, first_click_at: ago(30 * DAY), converted_n: 1, converted_at: ago(20 * DAY), rated_n: 1,
    payable_usd: 20, license_ok: true, tax_ok: true
  });
  assert.equal(under.state, "waiting");
  const unsigned = walkAff({
    credited_n: 1, first_click_at: ago(30 * DAY), converted_n: 1, converted_at: ago(20 * DAY), rated_n: 1,
    payable_usd: 400, license_ok: false, tax_ok: true
  });
  assert.equal(unsigned.state, "waiting");
  assert.equal(unsigned.step.key, "payout_paid");
});

test("GREEN: the whole affiliate trip is finished", () => {
  const w = walkAff({
    credited_n: 4, first_click_at: ago(50 * DAY), converted_n: 1, converted_at: ago(40 * DAY), rated_n: 1,
    paid_n: 1, paid_at: ago(5 * DAY), license_ok: true, tax_ok: true
  });
  assert.equal(w.state, "finished");
});

test("GREEN: a paused affiliate is an ended trip", () => {
  assert.equal(walkAff({ status: "paused" }).state, "ended");
});

/* ---------- white-label partners ---------- */

test("RED: an active partner with no published page, 19 days after approval", () => {
  const w = walkPar({ page_slug: null, page_published_at: null });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "page_live");
});

test("RED: the published page does not answer", () => {
  const w = walkPar({}, { ok: false, why: "answered 404" });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "page_live");
  assert.match(w.why, /answered 404 \(GET \/sites\//);
});

test("GREEN: the published page answers 200 and the partner waits for a first lead", () => {
  const w = walkPar({}, { ok: true, why: "" });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "referral_clicked");
});

test("GREEN: an invited applicant is waiting on a person, however long", () => {
  const w = walkPar({ status: "invited", approved_at: null, page_slug: null, page_published_at: null, applied_at: ago(55 * DAY) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "approved");
  assert.equal(w.step.by, BY.PERSON);
});

test("RED: a payment from the partner's client on a shared product has no accrual row", () => {
  const w = walkPar({ owned_n: 1, first_lead_at: ago(10 * DAY), paid_in_n: 1, first_paid_at: ago(5 * DAY), unaccrued_n: 1 }, { ok: true });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "commission");
  assert.match(w.why, /1 payment from this partner's clients/);
});

test("RED: a partner with no revenue share percent set earns nothing on any payment", () => {
  const w = walkPar({ owned_n: 1, paid_in_n: 1, first_paid_at: ago(5 * DAY), share_pct: null }, { ok: true });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "commission");
  assert.match(w.why, /no revenue share percent set/);
});

test("GREEN: a partner on a rate of 0 earns nothing on purpose", () => {
  const w = walkPar({ owned_n: 1, paid_in_n: 1, first_paid_at: ago(5 * DAY), share_pct: 0 }, { ok: true });
  assert.equal(w.state, "finished");
});

test("RED: a partner payout held because the agreement is not signed", () => {
  const w = walkPar({
    owned_n: 1, paid_in_n: 1, first_paid_at: ago(30 * DAY), revenue_n: 1, first_revenue_at: ago(30 * DAY),
    held_n: 1, agreement_signed: false
  }, { ok: true });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "payout_paid");
  assert.match(w.why, /the partner agreement is not signed/);
});

test("GREEN: the whole partner trip is finished", () => {
  const w = walkPar({
    owned_n: 3, first_lead_at: ago(15 * DAY), paid_in_n: 2, first_paid_at: ago(12 * DAY),
    revenue_n: 2, first_revenue_at: ago(12 * DAY), paid_n: 1, paid_at: ago(2 * DAY)
  }, { ok: true });
  assert.equal(w.state, "finished");
});

test("GREEN: a paused partner is an ended trip", () => {
  assert.equal(walkPar({ status: "paused" }).state, "ended");
});

/* ---------- the verdict and the lane ---------- */

test("judgePartner: nobody applied is a verified nothing-to-judge", () => {
  const r = judgePartner({ now: NOW });
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "low-traffic");
  assert.equal(r.na.args.check, "trip:partner");
});

test("judgePartner: one stuck partner of either kind makes the lane FAIL and names the person", () => {
  const r = judgePartner({
    affiliates: [aff({ name: "Fine Person", credited_n: 1, first_click_at: ago(5 * DAY) }), aff({ name: "Stuck Person", tracking_id: "" })],
    partners: [par({ name: "Quiet Capital", page_slug: null, page_published_at: null })],
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^2 of 3 partners who started the partner trip/);
  assert.match(r.detail, /Stuck Person stopped at "referral link has a code"/);
  assert.match(r.detail, /Quiet Capital stopped at "page published and live"/);
});

test("judgePartner: waiting partners are PASS, counted by step, and the note rides along", () => {
  const r = judgePartner({
    affiliates: [aff({ credited_n: 1, first_click_at: ago(5 * DAY) })],
    partners: [par({ status: "invited", approved_at: null, page_slug: null, page_published_at: null })],
    now: NOW, note: "The published pages were not opened in this run."
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /2 partners started the partner trip/);
  assert.match(r.detail, /2 waiting/);
  assert.match(r.detail, /were not opened/);
});

function fakeDb(aRows, pRows, seen = []) {
  return tagDb({
    "trip-partner-affiliate": aRows, "trip-partner-white-label": pRows,
    "trip-partner-count": [{ n: aRows.length + pRows.length }]
  }, seen);
}

function okFetch(status = 200, body = "<html>Apply</html>") {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init && init.method });
    return { status, text: async () => body };
  };
  f.calls = calls;
  return f;
}

test("gapChecks: reads both lists, opens each published page with a GET, and judges", async () => {
  const seen = [];
  const f = okFetch(200);
  const out = await gapChecks({
    db: fakeDb([aff()], [par()], seen), orgId: ORG, now: NOW, fetchImpl: f, baseUrl: "https://example.test"
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "PASS");
  assert.deepEqual(seen.map((s) => s.tag), ["trip-partner-affiliate", "trip-partner-white-label"]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "GET");
  assert.match(f.calls[0].url, /^https:\/\/example\.test\/sites\/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee\/apply$/);
});

test("gapChecks: a dead published page is red", async () => {
  const out = await gapChecks({
    db: fakeDb([], [par()]), orgId: ORG, now: NOW, fetchImpl: okFetch(404, "not found"), baseUrl: "https://example.test"
  });
  assert.equal(out[0].status, "FAIL");
  assert.match(out[0].detail, /answered 404/);
});

test("gapChecks: with no web client the pages are not judged and the row says so", async () => {
  const out = await gapChecks({ db: fakeDb([], [par()]), orgId: ORG, now: NOW });
  assert.equal(out[0].status, "PASS");
  assert.match(out[0].detail, /were not opened in this run, so "live" was not judged/);
});

test("gapChecks: an invited applicant needs no page read", async () => {
  const f = okFetch();
  const out = await gapChecks({
    db: fakeDb([], [par({ status: "invited", page_slug: null, page_published_at: null, approved_at: null })]),
    orgId: ORG, now: NOW, fetchImpl: f
  });
  assert.equal(out[0].status, "PASS");
  assert.equal(f.calls.length, 0);
});

test("gapChecks: a failed read is a skip with the reason; no database is a skip", async () => {
  const bad = await gapChecks({ db: { async query() { throw new Error("relation \"partner_revenue\" does not exist"); } }, orgId: ORG, now: NOW });
  assert.equal(bad[0].status, "skip");
  assert.match(bad[0].detail, /partner_revenue/);
  const none = await gapChecks({});
  assert.equal(none[0].status, "skip");
});

test("naVerify: true while nobody applied in the window, false the day someone does", async () => {
  assert.equal(await naVerify["low-traffic"]({ check: "trip:partner" }, { db: fakeDb([], []), orgId: ORG, now: NOW }), true);
  assert.equal(await naVerify["low-traffic"]({ check: "trip:partner" }, { db: fakeDb([aff()], []), orgId: ORG, now: NOW }), false);
  assert.equal(await naVerify["low-traffic"]({ check: "trip:partner" }, { db: fakeDb([], [par()]), orgId: ORG, now: NOW }), false);
});

test("the light count behind the nothing-to-judge proof is one read-only SELECT on parameters 1 to 4", () => {
  const bare = COUNT_SQL.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(bare, /^SELECT\b/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
  const used = [...new Set([...COUNT_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.deepEqual(used, [1, 2, 3, 4]);
  assert.ok(!/\bLIMIT\s+(?!1\b)\d+/i.test(bare), "a count is not capped (LIMIT 1 inside a lookup is fine)");
});
