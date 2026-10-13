// Checkout links for the morning pulse. Read only. Report only. (coverage batch W2, 2026-10-10)
//
// Four yes-or-no questions a buyer would feel, one per row:
//
//   checkout:paid-service     Did every "do it for me" dispute round get a link that answers, and
//                             once paid, did it start? (paid_service_requests)
//   checkout:repair-price     Did the repair plan the buyer picked in the /roadmap widget get a link at
//                             the price the door recorded? (payment_links + slo.repair_checkout_started)
//   checkout:funnel-door      Can a stranger on a /partner/ page see a price and press buy?
//                             (GET /api/public/funnel-checkout)
//   checkout:funnel-no-sale   Did people press buy on a /partner/ page and nobody ever paid?
//                             (funnel.checkout_started events against Commas receipts)
//
// WHAT THESE CANNOT SEE, SAID PLAINLY
//   * A funnel buyer who got no link. api/public/funnel-checkout.mjs writes its event BEFORE it asks
//     Commas for the link and saves no row for the link, so a failed link and an abandoned cart look
//     the same. That is why funnel-no-sale needs several presses and no payment, not one.
//   * The repair door is POST only. This lane cannot press it. The hourly beat checkout-doors proves the
//     route is mounted (a GET answers 405).
//   * A webhook that never arrived leaves no row anywhere (src/payments/commas-api.mjs says so).
//
// A failed read is a skip with the reason, never a PASS. A skip row carries no suggestedFix.
// GET and HEAD only. No text, no email, no AI call, no card charge, no event. The one tripwire is Recon.

import {
  judgeCheckoutLink, isWebAddress, judgeFunnelCatalogue, plain, SELF_SERVE_SLUGS
} from "./checkout-doors.mjs";
import {
  CHECK_IDS, FAILED_PAID_WAIT_MS, FUNNEL_MIN_PRESSES, FUNNEL_PATH, FUNNEL_PRESSES_SQL,
  FUNNEL_PRESS_GRACE_MS, FUNNEL_WINDOW_DAYS, LIVE_LINKS_SQL, PAID_SERVICE_SQL,
  PAID_STAGE_WAIT_MS, QUOTED_WAIT_MS, RECENT_MS, REPAIR_PLAN_KEYS, REPAIR_PRICES,
  REPAIR_PRICE_SQL, STAGED_WAIT_HOURS, STAGED_WAIT_MS
} from "./money-checkout-config.mjs";
import {
  DAY_MS, SIM_RECEIPT_PREFIX, TEST_CLIENT_EMAIL_RE, TRIP,
  ageOf, dollars, intOf, naRow, nowOf, plural, readRow, readRows, request, row, runnerOf, skipWhy
} from "./money-truth-utils.mjs";

export {
  CHECK_IDS, FAILED_PAID_WAIT_MS, FUNNEL_MIN_PRESSES, FUNNEL_PATH, FUNNEL_PRESSES_SQL,
  FUNNEL_PRESS_GRACE_MS, FUNNEL_WINDOW_DAYS, LIVE_LINKS_SQL, MAX_LINK_CHECKS,
  PAID_SERVICE_SQL, PAID_STAGE_WAIT_MS, QUOTED_WAIT_MS, RECENT_MS, REPAIR_PLAN_KEYS,
  REPAIR_PRICE_SQL, STAGED_WAIT_HOURS, STAGED_WAIT_MS
} from "./money-checkout-config.mjs";

/* ---- 1. paid service -------------------------------------------------------------------------- */

const PAID_SERVICE_FIX =
  "Read paid_service_requests for those rows and src/paid-services/round.mjs (mint, record payment, stage). " +
  "The payment handler src/handlers/paid-service-payment.mjs must be registered in src/register-all.mjs for a payment to move a " +
  `request off awaiting_payment. Reach the buyer with a fresh link from the existing paid-services door, or refund by hand. ${TRIP}`;

/** One HEAD per live link, then GET only when the host refuses HEAD. Never throws. */
async function askLink(readWeb, url) {
  try {
    let res = await request(readWeb, "HEAD", url);
    if (res.status === 405 || res.status === 501) res = await request(readWeb, "GET", url);
    return { verdict: judgeCheckoutLink(res.status), status: res.status };
  } catch (err) {
    return { verdict: "unreachable", status: 0, error: String(err && err.message ? err.message : err).slice(0, 60) };
  }
}

async function checkPaidService({ run, orgId, now, readWeb }) {
  const id = "checkout:paid-service";
  const why = skipWhy({ run, orgId }, "paid-service requests");
  if (why) return row(id, "skip", why);
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  const got = await readRow(run, id, "paid-service requests", PAID_SERVICE_SQL, [
    orgId, iso(QUOTED_WAIT_MS), iso(PAID_STAGE_WAIT_MS), iso(STAGED_WAIT_MS), iso(FAILED_PAID_WAIT_MS),
    iso(RECENT_MS), TEST_CLIENT_EMAIL_RE, `${SIM_RECEIPT_PREFIX}%`
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const parts = [];
  const quoted = intOf(r.quoted_n);
  const noLink = intOf(r.no_link_n);
  const paid = intOf(r.paid_n);
  const staged = intOf(r.staged_n);
  const unrecorded = intOf(r.unrecorded_n);
  const failedPaid = intOf(r.failed_paid_n);
  if (quoted) parts.push(`${plural(quoted, "request")} priced with no link ever made (the client cannot ask again: one is already open)`);
  if (noLink) parts.push(`${plural(noLink, "request")} waiting for payment with no link on it`);
  if (unrecorded) parts.push(`${plural(unrecorded, "request")} where Commas shows money for it and the request never moved to paid`);
  if (paid) parts.push(`${plural(paid, "paid request")} never staged (the fresh report was never ordered)`);
  if (failedPaid) parts.push(`${plural(failedPaid, "request")} closed failed with the buyer's money still on it`);
  if (staged) parts.push(`${plural(staged, "round")} staged and waiting on a person for more than ${STAGED_WAIT_HOURS} hours`);

  // The live links are asked about once, whatever the counts say, so the row can name a dead one too.
  let linksNote = "";
  let dead = 0;
  let unclear = 0;
  let asked = 0;
  let linkSkip = null;
  const links = await readRows(run, id, "live checkout links", LIVE_LINKS_SQL, [orgId, now.toISOString(), TEST_CLIENT_EMAIL_RE]);
  if (links.skip) {
    linkSkip = links.skip.detail;
  } else if (links.rows.length === 0) {
    linksNote = "no live checkout link is waiting";
  } else if (typeof readWeb !== "function") {
    linkSkip = "no fetch in this run, so the live links were not asked about";
  } else {
    const answers = await Promise.all(links.rows.map((l) => (
      isWebAddress(l.checkout_url)
        ? askLink(readWeb, String(l.checkout_url))
        : Promise.resolve({ verdict: "dead", status: 0, notWeb: true })
    )));
    asked = answers.length;
    dead = answers.filter((a) => a.verdict === "dead").length;
    unclear = answers.filter((a) => a.verdict === "unclear" || a.verdict === "unreachable").length;
    if (dead) parts.push(`${plural(dead, "live checkout link")} that does not answer (404, 410, a server error, or not a web address)`);
    linksNote = `${plural(asked, "live link")} asked about with HEAD: ${asked - dead - unclear} answer${unclear ? `, ${unclear} unclear (a host that turns away a bot proves nothing)` : ""}`;
  }

  if (!parts.length) {
    const testNote = intOf(r.test_n) ? ` (${plural(intOf(r.test_n), "test request")} left out)` : "";
    if (intOf(r.real_n) === 0 && !asked && !linkSkip) {
      return row(id, "PASS", `no real paid-service request is open or recent, so no buyer is waiting on a link${testNote}`);
    }
    if (linkSkip && intOf(r.real_n) > 0 && asked === 0) {
      return row(id, "skip", `the request states are fine (${plural(intOf(r.real_n), "real request")}), but ${linkSkip}`);
    }
    return row(id, "PASS", `${plural(intOf(r.real_n), "real request")} open or recent, none stuck; ${linksNote || "links not asked about"}${testNote}`);
  }
  const oldest = r.oldest ? ` The oldest has waited ${ageOf(r.oldest, now)}.` : "";
  return row(id, "FAIL", `${parts.join("; ")}.${oldest}${linksNote ? ` ${linksNote}.` : ""}`, `${PAID_SERVICE_FIX}`);
}

/* ---- 2. the repair plan price ----------------------------------------------------------------- */

/** The catalogue price for one plan key, or null when the plan is gone. */
export function planPriceCents(key, lookup = (offerKey) => ({ priceCents: REPAIR_PRICES[offerKey] })) {
  const offer = lookup(key);
  const cents = offer && offer.priceCents;
  return Number.isInteger(cents) && cents > 0 ? cents : null;
}

/**
 * judgeRepairRows(rows) -> { problems: string[], checked, latest }
 * Pure. A problem is a link that asks for a different amount than the door recorded, an event with no
 * link, a plan that is no longer on the list, or a link that is not a repair link.
 */
export function judgeRepairRows(rows) {
  const problems = [];
  const latest = {};
  let checked = 0;
  for (const r of rows) {
    checked += 1;
    const key = String(r.offer_key || "");
    const eventCents = Number(r.event_cents);
    const sample = `${plain(key, 14)} ${r.link_ref ? `(ref ${plain(String(r.link_ref).slice(-6), 8)})` : "(no ref)"}`;
    if (!REPAIR_PLAN_KEYS.includes(key)) {
      problems.push(`${sample}: not one of the two repair plans`);
      continue;
    }
    if (!r.link_id) {
      problems.push(`${sample}: the door recorded a checkout and no link row is on file`);
      continue;
    }
    if (r.link_purpose !== "repair") {
      problems.push(`${sample}: the link is not a repair link (${plain(r.link_purpose, 14)})`);
      continue;
    }
    const linkCents = Number(r.link_cents);
    if (!Number.isInteger(linkCents) || !Number.isInteger(eventCents) || linkCents !== eventCents) {
      problems.push(`${sample}: the link asks for ${Number.isFinite(linkCents) ? dollars(linkCents) : "no amount"} but the door recorded ${Number.isFinite(eventCents) ? dollars(eventCents) : "no amount"}`);
      continue;
    }
    if (!latest[key]) latest[key] = { cents: linkCents, at: r.created_at };
  }
  return { problems, checked, latest };
}

async function checkRepairPrice({ run, orgId, now, offerLookup }) {
  const id = "checkout:repair-price";
  const why = skipWhy({ run, orgId }, "repair checkouts");
  if (why) return row(id, "skip", why);
  const got = await readRows(run, id, "repair checkouts", REPAIR_PRICE_SQL, [
    orgId,
    new Date(now.getTime() - RECENT_MS).toISOString(),
    TEST_CLIENT_EMAIL_RE
  ]);
  if (got.skip) return got.skip;
  const { problems, checked, latest } = judgeRepairRows(got.rows);
  if (problems.length) {
    return row(
      id,
      "FAIL",
      `${plural(problems.length, "repair checkout")} in the last 30 days with a link that does not match: ${problems.slice(0, 3).join("; ")}.`,
      `Read the slo.repair_checkout_started event and the payment_links row for each ref (api/public/slo-repair-checkout.mjs, src/slo/repair-offer.mjs). ` +
        `Reach the buyer with a correct link from the existing flow. ${TRIP}`
    );
  }
  if (checked === 0) {
    return row(id, "PASS", "no buyer picked a repair plan in the last 30 days, so there is no repair link to compare");
  }
  const drift = [];
  for (const key of REPAIR_PLAN_KEYS) {
    const now_ = planPriceCents(key, offerLookup);
    if (latest[key] && now_ !== null && latest[key].cents !== now_) {
      drift.push(`${key} was ${dollars(latest[key].cents)} on the last link and the catalogue says ${dollars(now_)} now`);
    }
  }
  return row(
    id,
    "PASS",
    `${plural(checked, "repair checkout")} in the last 30 days, each link asks for the amount the door recorded${drift.length ? `. Price moved since: ${drift.join("; ")}` : ""}`
  );
}

/* ---- 3. the funnel door ----------------------------------------------------------------------- */

async function checkFunnelDoor({ readWeb, baseUrl }) {
  const id = "checkout:funnel-door";
  if (typeof readWeb !== "function") return row(id, "skip", "no web reader in this run, so the funnel till was not read");
  const origin = String(baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  let res;
  try {
    res = await request(readWeb, "GET", `${origin}${FUNNEL_PATH}`, { headers: { accept: "application/json" } });
  } catch (err) {
    return row(id, "skip", `the funnel till was not reached, so it was not read: ${String(err && err.message ? err.message : err).slice(0, 120)}`);
  }
  if (res.status === 0) return row(id, "skip", "the funnel till gave no answer, so it was not read");
  const problems = judgeFunnelCatalogue({ status: res.status, body: res.text });
  if (problems.length) {
    return row(
      id,
      "FAIL",
      `${problems.join("; ")}.`,
      `Open GET ${FUNNEL_PATH} (api/public/funnel-checkout.mjs funnelCatalogue). A price comes from src/config/offers.mjs or the constant beside the charging code. ` +
        `Checkout is ready only when the Commas checkout key is set (src/payments/commas-api.mjs checkoutConfig). ${TRIP}`
    );
  }
  return row(id, "PASS", `the funnel till answers 200, checkout is ready, and ${SELF_SERVE_SLUGS.join(", ")} each show a price and a live buy button`);
}

/* ---- 4. the funnel presses that never paid ---------------------------------------------------- */

async function checkFunnelNoSale({ run, orgId, now }) {
  const id = "checkout:funnel-no-sale";
  const why = skipWhy({ run, orgId }, "funnel presses");
  if (why) return row(id, "skip", why);
  const since = new Date(now.getTime() - FUNNEL_WINDOW_DAYS * DAY_MS).toISOString();
  const until = new Date(now.getTime() - FUNNEL_PRESS_GRACE_MS).toISOString();
  const got = await readRows(run, id, "funnel presses", FUNNEL_PRESSES_SQL, [
    orgId, since, until, TEST_CLIENT_EMAIL_RE, `${SIM_RECEIPT_PREFIX}%`
  ]);
  if (got.skip) return got.skip;
  const items = got.rows.map((r) => ({
    item: String(r.item), presses: intOf(r.presses_n), paid: intOf(r.paid_n)
  }));
  const presses = items.reduce((s, i) => s + i.presses, 0);
  if (presses < FUNNEL_MIN_PRESSES) {
    return naRow(
      id,
      "low-traffic",
      { check: id, count: presses, min: FUNNEL_MIN_PRESSES, what: "funnel checkout presses", days: FUNNEL_WINDOW_DAYS },
      `Only ${plural(presses, "press", "presses")} of buy on a /partner/ page in ${FUNNEL_WINDOW_DAYS} days (a press under a day old is not counted). ` +
        `Zero payments only means something at ${FUNNEL_MIN_PRESSES} or more. Judged the day ${FUNNEL_MIN_PRESSES} people press buy.`
    );
  }
  const dead = items.filter((i) => i.presses >= FUNNEL_MIN_PRESSES && i.paid === 0);
  const paidAll = items.reduce((s, i) => s + i.paid, 0);
  if (dead.length) {
    const said = dead.map((i) => `${plural(i.presses, "person", "people")} pressed buy on ${plain(i.item, 14)} and none paid`).join("; ");
    return row(
      id,
      "FAIL",
      `${said}, in the last ${FUNNEL_WINDOW_DAYS} days (presses under a day old are left out). Abandoned carts happen; ${FUNNEL_MIN_PRESSES} or more with no sale at all is a till that may be dead.`,
      `Open the /partner/ page for that item and press buy yourself up to the card box, without paying. Read GET ${FUNNEL_PATH} and the funnel.checkout_started events (api/public/funnel-checkout.mjs). ` +
        `If the card box opens, this is only a quiet week. ${TRIP}`
    );
  }
  return row(
    id,
    "PASS",
    `${plural(presses, "funnel press", "funnel presses")} in the last ${FUNNEL_WINDOW_DAYS} days, ${paidAll} paid; every item with ${FUNNEL_MIN_PRESSES} or more presses has at least one sale`
  );
}

/**
 * The audit calls this to prove a "nothing to judge" row again. `low-traffic` is true only while the same read
 * still finds fewer than FUNNEL_MIN_PRESSES presses. A read that cannot run answers false.
 */
export const naVerify = Object.freeze({
  "low-traffic": async (args, ctx = {}) => {
    const run = runnerOf(ctx);
    if (!run || !args || args.check !== "checkout:funnel-no-sale") return false;
    const now = nowOf(ctx);
    const orgId = ctx.orgId || (await defaultOrg(run));
    if (!orgId) return false;
    const out = await run((tx) => tx.query(FUNNEL_PRESSES_SQL, [
      orgId,
      new Date(now.getTime() - FUNNEL_WINDOW_DAYS * DAY_MS).toISOString(),
      new Date(now.getTime() - FUNNEL_PRESS_GRACE_MS).toISOString(),
      TEST_CLIENT_EMAIL_RE,
      `${SIM_RECEIPT_PREFIX}%`
    ]));
    const presses = (out.rows || []).reduce((s, r) => s + intOf(r.presses_n), 0);
    return presses < FUNNEL_MIN_PRESSES;
  }
});

async function defaultOrg(run) {
  try {
    const out = await run((tx) => tx.query("SELECT id FROM orgs WHERE is_default LIMIT 1"));
    return out && out.rows && out.rows[0] ? String(out.rows[0].id) : null;
  } catch {
    return null;
  }
}

/**
 * Four read-only checks. ctx: { db, scope, orgId, now, fetchImpl, baseUrl }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, skip or na.
 */
export async function readCheckoutTruth(ctx = {}) {
  const run = runnerOf(ctx);
  const now = nowOf(ctx);
  const orgId = ctx.orgId || null;
  const readWeb = typeof ctx.readWeb === "function" ? ctx.readWeb : null;
  const offerLookup = typeof ctx.offerLookup === "function" ? ctx.offerLookup : undefined;
  const baseUrl = ctx.baseUrl || null;
  const guard = async (id, fn) => {
    try {
      return await fn();
    } catch (err) {
      return row(id, "skip", `the check could not run: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
    }
  };
  return Promise.all([
    guard(CHECK_IDS[0], () => checkPaidService({ run, orgId, now, readWeb })),
    guard(CHECK_IDS[1], () => checkRepairPrice({ run, orgId, now, offerLookup })),
    guard(CHECK_IDS[2], () => checkFunnelDoor({ readWeb, baseUrl })),
    guard(CHECK_IDS[3], () => checkFunnelNoSale({ run, orgId, now }))
  ]);
}
