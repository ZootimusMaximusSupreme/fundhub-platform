import {
  BY, DAY_MS, NO_FIX, clip, intOf, judgeTrip, plural
} from "./trip-truth-kit.mjs";
export { AFFILIATE_SQL, PARTNER_SQL, ROW_CAP } from "./trip-partner-sql.mjs";
import { ROW_CAP } from "./trip-partner-sql.mjs";

const ID = "trip:partner";
export const CHECK_IDS = Object.freeze([ID]);
export const TRIP_NAME = "partner";
export const WINDOW_MS = 60 * DAY_MS;
export const FUNDED_BILL_WAIT_MS = 30 * 60 * 1000;
export const SETTLE_GRACE_MS = 15 * 60 * 1000;
export const DEAD_LINK_WINDOW_MS = 30 * DAY_MS;
export const PAYOUT_STUCK_AFTER_MS = 7 * DAY_MS;
export const PAYOUT_HELD_AFTER_MS = DAY_MS;
export const PAYOUT_MINIMUM_USD = 50;
export const ACCRUABLE_KINDS = Object.freeze(["deposit", "installment", "success_fee"]);
export const PARTNER_SHARE_PRODUCT_CODES = Object.freeze(["card-stacking-dfy", "repair-bundle", "repair-trial"]);
const QUALIFYING_FUNDING = Object.freeze(["card-stacking-dfy"]);
const QUALIFYING_NO_ROUND = Object.freeze(["repair-bundle", "consulting-package"]);
const INTERNAL_CLIENT_EMAIL_RE = String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(test|e2e)\+|\+test[._-]|@fundhub\.ai$`;
export const TEST_PAYEE_NAME_RE = String.raw`^(sim[ -]|e2e[ -]|test\b|demo\b|t10|principalread|fundhub direct|fundhub \(house\))`;
export const TEST_PAYEE_EMAIL_RE = `${INTERNAL_CLIENT_EMAIL_RE}|` +
  String.raw`^([^@]*[.+_-])?(e2e|sim|test)([.+_-][^@]*)?@|\+(sim|e2e|walk|aff|wl|fhtest)[-_0-9a-z]*@|@demo\.fundhub\.local$`;

const frozen = (value) => Object.freeze(value);
export const AFFILIATE_STEPS = Object.freeze([
  frozen({ key: "applied", label: "applied (a login and a referral link were made)", by: BY.CLIENT }),
  frozen({ key: "approved", label: "approved (status active)", by: BY.PERSON }),
  frozen({ key: "page_live", label: "referral link has a code", by: BY.SYSTEM, from: "applied", graceMs: SETTLE_GRACE_MS, source: "the affiliates row gets its tracking_id when it is made; wait = SETTLE_GRACE_MS" }),
  frozen({ key: "referral_clicked", label: "a click credited to the affiliate", by: BY.CLIENT }),
  frozen({ key: "referral_converted", label: "a referral converted", by: BY.CLIENT }),
  frozen({ key: "commission", label: "commission worked out on the converted referral", by: BY.SYSTEM, from: "referral_converted", graceMs: SETTLE_GRACE_MS, source: "convert() sets commission_due in the same call as the conversion; wait = SETTLE_GRACE_MS" }),
  frozen({ key: "payout_paid", label: "payout paid", by: BY.PERSON })
]);
export const PARTNER_STEPS = Object.freeze([
  frozen({ key: "applied", label: "applied (a partners row was made)", by: BY.CLIENT }),
  frozen({ key: "approved", label: "approved (status active)", by: BY.PERSON }),
  frozen({ key: "page_live", label: "page published and live", by: BY.SYSTEM, from: "approved", graceMs: SETTLE_GRACE_MS, source: "approvePartnerApplication publishes the page in the same transaction; wait = SETTLE_GRACE_MS" }),
  frozen({ key: "referral_clicked", label: "a lead came in through the partner", by: BY.CLIENT }),
  frozen({ key: "referral_converted", label: "a lead of the partner paid for a product the partner shares in", by: BY.CLIENT }),
  frozen({ key: "commission", label: "the partner's share accrued", by: BY.SYSTEM, from: "referral_converted", graceMs: FUNDED_BILL_WAIT_MS, source: "accrueForPayment runs in the money chain with the payment; wait = FUNDED_BILL_WAIT_MS" }),
  frozen({ key: "payout_paid", label: "payout paid", by: BY.PERSON })
]);

const usd = (n) => `$${(Math.round(Number(n) * 100) / 100).toLocaleString("en-US")}`;
function heldWhy(value, kind) {
  const bits = [];
  if (kind === "affiliate") {
    if (value.license_ok === false) bits.push("the partner license is not signed");
    if (value.tax_ok === false) bits.push("the tax form is not on file");
  } else if (value.agreement_signed === false) bits.push("the partner agreement is not signed");
  return bits.length ? bits.join(" and ") : "no reason written";
}

export function toAffiliateRow(value) {
  const facts = {};
  const defects = [];
  const detail = {};
  const status = String(value.status || "");
  if (value.applied_at) facts.applied = value.applied_at;
  if (status === "active") facts.approved = value.activated_at || value.applied_at;
  if (value.tracking_id && String(value.tracking_id).trim()) facts.page_live = value.applied_at;
  if (intOf(value.credited_n) > 0) facts.referral_clicked = value.first_click_at || true;
  if (intOf(value.converted_n) > 0) facts.referral_converted = value.converted_at || true;
  if (intOf(value.converted_n) > 0 && intOf(value.unrated_n) === 0 && intOf(value.rated_n) > 0) facts.commission = value.converted_at || true;
  if (intOf(value.paid_n) > 0) facts.payout_paid = value.paid_at || true;
  if (intOf(value.uncredited_n) > 0) defects.push({
    key: "referral_clicked",
    why: `${plural(intOf(value.uncredited_n), "click")} carried this affiliate's code and ${intOf(value.uncredited_n) === 1 ? "was" : "were"} credited to nobody`
  });
  if (intOf(value.unconverted_paid_n) > 0) defects.push({
    key: "referral_converted",
    why: `${plural(intOf(value.unconverted_paid_n), "referred client")} paid for a qualifying product and the referral was never marked converted`
  });
  if (intOf(value.unrated_n) > 0) detail.commission =
    `${plural(intOf(value.unrated_n), "converted referral")} ${intOf(value.unrated_n) === 1 ? "has" : "have"} no commission number (no rate in force, or the basis was unknown), so nobody is told and nobody is paid`;
  if (intOf(value.held_n) > 0) defects.push({ key: "payout_paid", why: `${plural(intOf(value.held_n), "payout")} on hold for over a day: ${heldWhy(value, "affiliate")}` });
  else if (intOf(value.stuck_n) > 0) defects.push({ key: "payout_paid", why: `${plural(intOf(value.stuck_n), "payout")} stuck in processing for over 7 days` });
  /* Owner-set 2026-10-20: paid as soon as the client's money clears. A run
     ready to send for over a day has not gone out (495 autopay). */
  else if (intOf(value.waiting_n) > 0) defects.push({ key: "payout_paid", why: `${plural(intOf(value.waiting_n), "payout")} ready to send for over a day and not sent` });
  else if (Number(value.payable_usd) >= PAYOUT_MINIMUM_USD && value.license_ok === true && value.tax_ok === true) defects.push({
    key: "payout_paid",
    why: `${usd(value.payable_usd)} of commission is payable (license signed, tax form on file, at least ${usd(PAYOUT_MINIMUM_USD)}) and is on no payout run`
  });
  const ended = status && status !== "active" ? { why: `the affiliate is ${status}` } : null;
  return { who: String(value.name || value.tracking_id || value.payee_id || "an affiliate").slice(0, 40), track: "affiliate", facts, notOwed: [], ended, stall: null, detail, defects };
}

export function toPartnerRow(value, live = null) {
  const facts = {};
  const defects = [];
  const notOwed = [];
  const status = String(value.status || "");
  if (value.applied_at) facts.applied = value.applied_at;
  if (status === "active") facts.approved = value.approved_at || value.applied_at;
  const published = !!value.page_published_at || !!value.page_slug;
  if (published) {
    facts.page_live = value.page_published_at || true;
    if (live && live.ok === false) defects.push({ key: "page_live", why: `the published page ${live.why || "does not open"} (GET /sites/${value.payee_id}/${value.page_slug})` });
  }
  if (intOf(value.owned_n) > 0) facts.referral_clicked = value.first_lead_at || true;
  if (intOf(value.paid_in_n) > 0) facts.referral_converted = value.first_paid_at || true;
  if (intOf(value.revenue_n) > 0) facts.commission = value.first_revenue_at || true;
  if (intOf(value.paid_n) > 0) facts.payout_paid = value.paid_at || true;
  const sharePct = value.share_pct == null ? null : Number(value.share_pct);
  if (intOf(value.paid_in_n) > 0 && sharePct === 0) notOwed.push("commission", "payout_paid");
  else if (intOf(value.paid_in_n) > 0 && sharePct == null) defects.push({ key: "commission", why: "the partner has no revenue share percent set, so no payment accrues a share" });
  else if (intOf(value.unaccrued_n) > 0) defects.push({ key: "commission", why: `${plural(intOf(value.unaccrued_n), "payment")} from this partner's clients, on a product the partner shares in, ${intOf(value.unaccrued_n) === 1 ? "has" : "have"} no accrual row` });
  if (intOf(value.held_n) > 0) defects.push({ key: "payout_paid", why: `${plural(intOf(value.held_n), "payout")} on hold for over a day: ${heldWhy(value, "partner")}` });
  else if (intOf(value.stuck_n) > 0) defects.push({ key: "payout_paid", why: `${plural(intOf(value.stuck_n), "payout")} stuck in processing for over 7 days` });
  const ended = status === "paused" ? { why: "the partner is paused" } : null;
  return { who: String(value.name || value.slug || value.payee_id || "a partner").slice(0, 40), track: "partner", facts, notOwed, ended, stall: null, detail: {}, defects };
}

export function stepsFor(value) {
  return value && value.track === "partner" ? PARTNER_STEPS : AFFILIATE_STEPS;
}

export function judgePartner({ affiliates = [], partners = [], pages = new Map(), now = new Date(), note = "" } = {}) {
  const rows = [
    ...affiliates.map((value) => toAffiliateRow(value, now)),
    ...partners.map((value) => toPartnerRow(value, pages.get(String(value.payee_id)) || null, now))
  ];
  return judgeTrip({
    id: ID, tripName: TRIP_NAME, steps: stepsFor, rows, now,
    windowDays: Math.round(WINDOW_MS / DAY_MS), what: "partner", note,
    fix: "Open the partner on the affiliates or partners screen and read the step named. A click credited to nobody, a paid referral that is not converted, or a payment with no accrual means the money chain or the click door did not finish: read failed_events for that client. Do not pay or release anything from the pulse. " + NO_FIX
  });
}

function previousMonth(now) {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { periodEnd };
}

export function tripParams(orgId, now) {
  const { periodEnd } = previousMonth(now);
  return {
    affiliate: [
      orgId, new Date(now.getTime() - WINDOW_MS).toISOString(), TEST_PAYEE_EMAIL_RE, TEST_PAYEE_NAME_RE,
      QUALIFYING_FUNDING, QUALIFYING_NO_ROUND, new Date(now.getTime() - FUNDED_BILL_WAIT_MS).toISOString(),
      periodEnd.toISOString(), new Date(now.getTime() - PAYOUT_STUCK_AFTER_MS).toISOString(),
      new Date(now.getTime() - PAYOUT_HELD_AFTER_MS).toISOString(), new Date(now.getTime() - DEAD_LINK_WINDOW_MS).toISOString()
    ],
    partner: [
      orgId, new Date(now.getTime() - WINDOW_MS).toISOString(), TEST_PAYEE_EMAIL_RE, TEST_PAYEE_NAME_RE,
      PARTNER_SHARE_PRODUCT_CODES.map((code) => code.toLowerCase()), ACCRUABLE_KINDS,
      new Date(now.getTime() - FUNDED_BILL_WAIT_MS).toISOString(), new Date(now.getTime() - PAYOUT_STUCK_AFTER_MS).toISOString(),
      new Date(now.getTime() - PAYOUT_HELD_AFTER_MS).toISOString()
    ]
  };
}

export const PAGE_CAP = 60;
const NOT_LIVE_MARK = "Nothing is live at this web address";
export function pickPages(rows, now, cap = PAGE_CAP) {
  if (rows.length <= cap) return rows.slice();
  const start = (Math.floor(now.getTime() / DAY_MS) * cap) % rows.length;
  return Array.from({ length: cap }, (_, i) => rows[(start + i) % rows.length]);
}

export async function readPage(web, origin, value) {
  try {
    const response = await web(`${origin}/sites/${value.partner_id}/${value.slug}`, { method: "GET", headers: { accept: "text/html" } });
    const status = response && response.status;
    if (status !== 200) return { ok: false, why: `answered ${status}` };
    let body = "";
    try { body = response && typeof response.text === "function" ? String(await response.text()) : ""; } catch { body = ""; }
    if (body.includes(NOT_LIVE_MARK)) return { ok: false, why: "answered 200 with the not-live page" };
    return { ok: true, why: "" };
  } catch (err) {
    return { ok: false, why: `did not answer (${clip(err, 60)})` };
  }
}
