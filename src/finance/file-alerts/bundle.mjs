// Alerts bundle — the three seams the rest of the app plugs into. Unit AL,
// Finance OS CFO build (2026-11-07). New files only: the older alert files belong
// to unit D, so root wires these in with a few lines (named in the AL report).
//
//   planBundleAlerts      the daily pass (./run.mjs) asks: which bundle texts are
//                         owed today? It gets plans in the same shape as the four
//                         older planners, and sends each through its own deliver().
//   alertsBundlePayload   GET /api/money/alerts?part=bundle answers { ok, bundle }:
//                         the card rule, pay-by dates, intro countdowns, business
//                         credit and the weekly text preview, for the screen.
//   setBundleAlert        POST /api/money/alerts { action: "set_bundle_alert",
//                         kind, enabled } switches one of the three texts.
//   loadWeeklyFacts       the weekly job and the screen read one set of facts.
//
// IT DOES NOT SEND, OPEN A TASK, OR MOVE MONEY. Every number is the one the
// overview, the promo alert and the Credit tab already print.
//
// Money is integer cents. Unknown is null, never 0. Personal and business are
// never added together.

import { loadSnapshot as defaultLoadSnapshot } from "./snapshot.mjs";
import { readSettings as defaultReadSettings, FileAlertInputError } from "./store.mjs";
import * as defaultBundleStore from "./bundle-store.mjs";
import { readPayBeforeCloseDays } from "./common.mjs";
import { BUNDLE_KINDS, BUNDLE_LABELS, CARD_TARGET_PCT, PAY_BY_DAYS_BEFORE, SEASONED_DAYS, SEASONED_BETTER_DAYS } from "./bundle-common.mjs";
import { cardRule, planCardOver10 } from "./card-over-10.mjs";
import { payByList } from "./pay-by.mjs";
import { introCountdowns } from "./intro-countdown.mjs";
import { businessCreditView, planBusinessCredit } from "./business-credit.mjs";
import {
  weekOf, nextWeeklyDay, moneyInWeek, cardUse, seasoningClock, weeklySummary, planWeeklyMoney
} from "./weekly-money.mjs";

const cyclesOf = (snap) => (card) => snap.cycleByAccount.get(String(card.account_id)) ?? null;
const cardsOf = (snap) => snap.overview?.debt?.cards || [];

/**
 * planBundleAlerts(conn, { orgId, clientId, snap, today, now, env, settings }, deps)
 *   → { plans, skipped }
 *
 *   snap      the pass's loadSnapshot() answer (cards, cycles)
 *   settings  the pass's readSettings() answer — the pay-before-close switch decides
 *             whether that text already covers the last few days before a close
 *
 * The weekly text is not planned here: it has its own Monday job.
 */
export async function planBundleAlerts(conn, { orgId, clientId, snap, today, now = new Date(), env = process.env, settings = {} } = {}, deps = {}) {
  const store = deps.bundleStore || defaultBundleStore;
  const plans = [];
  const skipped = [];
  if (!snap) return { plans, skipped: [{ kind: "bundle", subject: clientId, reason: "no_snapshot" }] };

  const switches = await store.readBundleSettings(conn, { orgId, clientId });

  if (switches.card_over_10) {
    const funded = await store.fundedState(conn, { orgId, clientId });
    const opts = {
      today,
      funded: funded.funded,
      payBeforeCloseDays: readPayBeforeCloseDays(env),
      payBeforeCloseOn: settings.payment_timing !== false
    };
    for (const card of cardsOf(snap)) {
      const plan = planCardOver10(card, cyclesOf(snap)(card), opts);
      if (plan.alert) plans.push(plan);
      // A card under 10% or a client not funded yet is the ordinary state; not worth a line each.
      else if (!["under_target", "not_funded"].includes(plan.reason)) skipped.push({ kind: "card_over_10", subject: card.name || card.account_id, reason: plan.reason });
    }
    if (!funded.funded) skipped.push({ kind: "card_over_10", subject: clientId, reason: "not_funded" });
  } else {
    skipped.push({ kind: "card_over_10", subject: clientId, reason: "switched_off" });
  }

  if (switches.business_credit) {
    const businesses = await store.listBusinesses(conn, { orgId, clientId });
    if (businesses.length) {
      const pulls = await store.businessPulls(conn, { orgId, clientId });
      for (const b of businesses) {
        const plan = planBusinessCredit(b, pulls, { now });
        if (plan.alert) plans.push(plan);
        else if (!["no_report", "only_one_report", "report_too_old_to_alert", "no_change"].includes(plan.reason)) {
          skipped.push({ kind: "business_credit", subject: b.name || b.id, reason: plan.reason });
        }
      }
    }
  } else {
    skipped.push({ kind: "business_credit", subject: clientId, reason: "switched_off" });
  }

  return { plans, skipped };
}

/**
 * loadWeeklyFacts(conn, { orgId, clientId, snap, now }, deps) → the week and what
 * the weekly text would say about it.
 */
export async function loadWeeklyFacts(conn, { orgId, clientId, snap, now = new Date() } = {}, deps = {}) {
  const store = deps.bundleStore || defaultBundleStore;
  const week = weekOf(now);
  const [rows, relationships, openSteps] = await Promise.all([
    store.weekTransactions(conn, { orgId, clientId, from: week.from, to: week.to }),
    store.openedBankAccounts(conn, { orgId, clientId }),
    store.openStepCount(conn, { orgId, clientId })
  ]);
  const moneyIn = moneyInWeek({ rows, accounts: snap?.overview?.accounts || [], meta: snap?.meta || [], from: week.from, to: week.to });
  const cards = cardUse(cardsOf(snap || {}));
  const seasoning = seasoningClock(relationships, { today: snap?.today || week.monday });
  const summary = weeklySummary({ moneyIn, cards, seasoning, openSteps });
  return { week, moneyIn, cards, seasoning, openSteps, summary };
}

/**
 * alertsBundlePayload(conn, { orgId, clientId, now, env }, deps) → the `bundle`
 * object, or null when the client is not in that org.
 */
export async function alertsBundlePayload(conn, { orgId, clientId, now = new Date(), env = process.env } = {}, deps = {}) {
  const store = deps.bundleStore || defaultBundleStore;
  const loadSnapshot = deps.loadSnapshot || defaultLoadSnapshot;
  const readSettings = deps.readSettings || defaultReadSettings;
  const nowDate = new Date(now);

  const snap = deps.snap || (await loadSnapshot(conn, { orgId, clientId, asOf: nowDate }));
  if (!snap) return null;
  const { today } = snap;
  const cards = cardsOf(snap);
  const cycleOf = cyclesOf(snap);

  const [switches, settings, funded, businesses, pulls, sent, weekly] = await Promise.all([
    store.readBundleSettings(conn, { orgId, clientId }),
    readSettings(conn, { orgId, clientId }),
    store.fundedState(conn, { orgId, clientId }),
    store.listBusinesses(conn, { orgId, clientId }),
    store.businessPulls(conn, { orgId, clientId }),
    store.bundleAlerts(conn, { orgId, clientId }),
    loadWeeklyFacts(conn, { orgId, clientId, snap, now: nowDate }, deps)
  ]);

  const sentKeys = new Set(sent.map((a) => a.dedupe_key));
  const payBeforeCloseDays = readPayBeforeCloseDays(env);
  const ruleCards = cards.map((c) => {
    const rule = cardRule(c, cycleOf(c), { today });
    const texted = rule.closes_on ? sentKeys.has(`fpa:over10:${c.account_id}:${rule.closes_on}`) : false;
    return { ...rule, texted_this_cycle: texted };
  });

  const bizViews = businesses.map((b) => {
    const view = businessCreditView(b, pulls);
    const key = view.latest ? `fpa:biz:${b.id}:${view.latest.pull_id}` : null;
    return { ...view, texted: key ? sentKeys.has(key) : false };
  });

  const lastWeekly = sent.find((a) => a.kind === "weekly_money") || null;
  const weeklyPlan = planWeeklyMoney({ clientId, week: weekly.week, summary: weekly.summary });

  return {
    as_of: snap.asOf,
    today,
    labels: { ...BUNDLE_LABELS },
    switches: Object.fromEntries(BUNDLE_KINDS.map((k) => [k, { enabled: switches[k] !== false, label: BUNDLE_LABELS[k] }])),
    card_rule: {
      target_pct: CARD_TARGET_PCT,
      funded: funded.funded,
      approvals: funded.approvals,
      // The older text covers the last few days before a close (when it is on).
      pay_before_close_days: payBeforeCloseDays,
      pay_before_close_on: settings.payment_timing !== false,
      cards: ruleCards
    },
    pay_by: { days_before: PAY_BY_DAYS_BEFORE, cards: payByList(cards, cycleOf, { today }) },
    intro: introCountdowns(cards, cycleOf, { today }),
    business_credit: bizViews,
    weekly: {
      next_on: nextWeeklyDay(nowDate),
      week: weekly.week,
      money_in: weekly.moneyIn,
      cards: weekly.cards,
      seasoning: { ...weekly.seasoning, seasoned_days: SEASONED_DAYS, better_days: [...SEASONED_BETTER_DAYS] },
      open_steps: weekly.openSteps,
      // The words the next text would say, or why none would go.
      preview: weeklyPlan.alert ? weeklyPlan.body : null,
      preview_reason: weeklyPlan.alert ? null : weeklyPlan.reason,
      last_sent_at: lastWeekly ? lastWeekly.sent_at : null
    }
  };
}

/** setBundleAlert — POST { action: "set_bundle_alert", kind, enabled }. Throws
 *  FileAlertInputError (the endpoint's own 400) on a bad kind or switch. */
export async function setBundleAlert(conn, { orgId, clientId, body = {}, by }, deps = {}) {
  const store = deps.bundleStore || defaultBundleStore;
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  if (!BUNDLE_KINDS.includes(kind)) throw new FileAlertInputError("kind", `kind must be one of ${BUNDLE_KINDS.join(", ")}`);
  if (typeof body.enabled !== "boolean") throw new FileAlertInputError("enabled", "enabled must be true or false");
  await store.setBundleAlertEnabled(conn, { orgId, clientId, kind, enabled: body.enabled, by });
  return { kind, enabled: body.enabled };
}
