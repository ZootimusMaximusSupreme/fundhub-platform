// Finance OS weekly money text — the Monday clock. Alerts bundle, unit AL
// (Finance OS CFO build, owner go part 4, idea 7, 2026-11-07).
//
// ONE PASS, MONDAY 9 A.M. ARIZONA: for every client who gets the daily alerts (a
// paid Capital Blueprint buyer or an active Finance OS subscriber — the same
// audience, alertAudience), one text about the week before: how many times money
// came in (personal and business apart), how many cards are over 10%, the newest
// bank account's seasoning day, and how many plan steps are left. The words are
// built by src/finance/file-alerts/weekly-money.mjs and hold no amount, no bank
// name and no account digits: a text shows on a locked phone.
//
// CUSTOMER DRIPS GO 9 A.M. TO 5 P.M. ARIZONA (owner-set 2026-10-31). The clock
// starts this at 9:00; a client whose turn comes after 4:50 p.m. (a long pass, a
// retry) is skipped for the week rather than queued for the dispatcher to hold —
// the same last-plan minute every drip workflow uses (DRIP_LAST_PLAN_MINUTE).
//
// IT DOES NOT SEND. sendTemplated writes a `messages` row at status='queued'; the
// dispatcher (src/messaging/dispatch.mjs) hands it to a provider behind the
// dry-run fence, the per-company outbound switch, quiet hours and the opt-out
// read. sendTemplated itself refuses an opted-out client. Nothing moves money.
//
// ONCE A WEEK. The key is fpa:week:<client>:<Monday>. It is sendTemplated's
// eventId (so messages.provider_ref dedupes the queued text) and the
// file_protection_alerts row's dedupe_key (so a retry, a second clock or a later
// pass finds it). SEND, THEN RECORD — the daily alert pass's order.
//
// NEVER THROWS FOR THE WHOLE PASS. One client's failure is in the tally and the
// next client runs. Each client is its own step.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sendTemplated as defaultSend } from "./messaging.mjs";
import { alertAudience } from "./blueprint-finance-os-alerts.mjs";
import { dripSendTime } from "../messaging/send-window.mjs";
import { loadSnapshot as defaultLoadSnapshot } from "../finance/file-alerts/snapshot.mjs";
import * as defaultStore from "../finance/file-alerts/store.mjs";
import * as defaultBundleStore from "../finance/file-alerts/bundle-store.mjs";
import { loadWeeklyFacts } from "../finance/file-alerts/bundle.mjs";
import { planWeeklyMoney } from "../finance/file-alerts/weekly-money.mjs";

/** Monday 9:00 a.m. Arizona, on the Netlify clock (src/workflows/scheduled.mjs). */
export const WEEKLY_CRON = "TZ=America/Phoenix 0 9 * * 1";
export const SOURCE_WORKFLOW = "finance-os-weekly-money";
/** How far back the "already sent" keys are read: two weeks covers any retry. */
const KEY_HISTORY_DAYS = 14;
const DAY_MS = 86_400_000;

/** True from 9:00 to 4:50:59 p.m. Arizona: the minutes a drip may be queued in. */
export function inPlanWindow(now) {
  const at = now instanceof Date ? now : new Date(now);
  return dripSendTime(at).getTime() === at.getTime();
}

/**
 * runWeeklyMoney(conn, { orgId, clientId, now }, deps) → one client's result
 *   { ok, clientId, sent?, key?, messageId?, reason? }
 */
export async function runWeeklyMoney(conn, { orgId, clientId, now = new Date() } = {}, deps = {}) {
  const send = deps.send || defaultSend;
  const store = deps.store || defaultStore;
  const bundleStore = deps.bundleStore || defaultBundleStore;
  const loadSnapshot = deps.loadSnapshot || defaultLoadSnapshot;
  const nowDate = new Date(now);
  const out = { ok: true, clientId, sent: false };

  if (!inPlanWindow(nowDate)) return { ...out, reason: "outside_send_hours" };
  const switches = await bundleStore.readBundleSettings(conn, { orgId, clientId });
  if (!switches.weekly_money) return { ...out, reason: "switched_off" };

  const snap = await loadSnapshot(conn, { orgId, clientId, asOf: nowDate });
  if (!snap) return { ...out, ok: false, reason: "client_not_found" };

  const facts = await loadWeeklyFacts(conn, { orgId, clientId, snap, now: nowDate }, { bundleStore });
  const plan = planWeeklyMoney({ clientId, week: facts.week, summary: facts.summary });
  if (!plan.alert) return { ...out, reason: plan.reason };

  const known = await store.recentKeys(conn, {
    orgId, clientId, since: new Date(nowDate.getTime() - KEY_HISTORY_DAYS * DAY_MS).toISOString()
  });
  if (known.has(plan.key)) return { ...out, key: plan.key, reason: "already_sent" };

  const r = await send(conn, {
    orgId, clientId, channel: "sms", templateKey: plan.templateKey, eventId: plan.key, context: { alert: plan.tags }
  });
  if (!(r && r.sent && r.messageId)) return { ...out, key: plan.key, reason: (r && r.reason) || "not_sent" };

  await store.recordAlert(conn, {
    orgId, clientId, kind: plan.kind, key: plan.key,
    bankAccountId: null, label: plan.label, threshold: null, dueOn: plan.dueOn, cashKind: null,
    body: plan.body, delivery: "text", messageId: r.messageId, taskId: null,
    sentAt: nowDate.toISOString(), detail: plan.detail
  });
  return { ...out, sent: true, key: plan.key, messageId: r.messageId };
}

/** sweep — one Monday pass. Returns a tally, never throws per client. */
export async function sweep(conn = db, {
  now = new Date(), step = null, run = runWeeklyMoney, audience = alertAudience
} = {}) {
  const tally = { checked: 0, texts: 0, skipped: {}, errored: [] };
  const inStep = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());

  const clients = await inStep("audience", () => audience(conn, now));
  tally.checked = clients.length;
  for (const c of clients) {
    try {
      // The clock is read again per client, so a late turn is judged on its own time.
      const at = step ? new Date() : now;
      const r = await inStep(`weekly-${c.client_id}`, () => run(conn, { orgId: c.org_id, clientId: c.client_id, now: at }));
      if (!r || r.ok === false) { tally.errored.push({ clientId: c.client_id, error: (r && r.reason) || "no_result" }); continue; }
      if (r.sent) tally.texts += 1;
      else tally.skipped[r.reason || "unknown"] = (tally.skipped[r.reason || "unknown"] || 0) + 1;
    } catch (e) {
      tally.errored.push({ clientId: c.client_id, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no event
   trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const financeOsWeeklyMoney = inngest.createFunction(
  { id: "finance-os-weekly-money", name: "Finance OS weekly money text" },
  { cron: WEEKLY_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
