// File-protection alerts — one client, one pass. Called once a day per client by
// src/workflows/blueprint-finance-os-alerts.mjs.
//
//   1. payment timing   a card's statement closes in N days        -> one text per card per cycle
//   2. promo end        a card's promo ends in 60 / 30 / 7 days    -> one text per card per threshold
//   3. cash cushion     personal or business cash < 6 x minimums   -> one text per drop, re-armed on recovery
//   4. new credit       a new card or loan, a new inquiry          -> one text + a CSM task for a Blueprint file
//
// IT DOES NOT SEND. sendTemplated writes a `messages` row at status='queued'. The
// dispatcher (src/messaging/dispatch.mjs) is the only thing that hands it to a
// provider, behind the dry-run fence, the per-company outbound switch, quiet hours
// and the gate's fresh opt-out read (CLAUDE.md §12). No module in this folder
// imports a provider or calls fetch — src/finance/file-alerts/safety.test.mjs fails
// if one ever does. It never moves money.
//
// ONCE ONLY. Every alert has a key built from facts that do not move (the card and
// the close date; the card, the end date and the threshold; the n-th drop of that
// cash; the account or the pull). A row in file_protection_alerts is written when an
// alert is delivered, and a key already there is never sent again. The key is also
// sendTemplated's eventId, so the queued text is deduped a second way by
// messages.provider_ref. SEND, THEN RECORD: a pass that dies between the two is
// picked up by the next one, and the second send lands on the same message row.
//
// AN OPTED-OUT CLIENT IS NOT TEXTED, AND NOTHING IS WRITTEN FOR THE TEXT. The alert
// is not marked as sent, so if they opt back in while its window is still open it
// goes out then. A Blueprint file's new-credit alert still opens its CSM task — a
// person should hear about a new card whether or not the client takes texts.
//
// NEVER THROWS FOR THE WHOLE CLIENT. One kind failing is recorded in `errors` and
// the next kind still runs.

import { sendTemplated as defaultSend } from "../../workflows/messaging.mjs";
import { createTask as defaultCreateTask } from "../../lib/create-task.mjs";
import { isOptedOut as defaultIsOptedOut } from "../../lib/opt-out.mjs";
import { isCapitalBlueprintBuyer as defaultIsBlueprint } from "../../blueprint/coach-exception.mjs";
import * as defaultStore from "./store.mjs";
import { loadSnapshot as defaultLoadSnapshot, loadLatestPulls as defaultLoadPulls } from "./snapshot.mjs";
import { planPaymentTiming } from "./payment-timing.mjs";
import { planPromoEnd } from "./promo.mjs";
import { evaluateReserve, planCashReserve, CASH_KINDS } from "./cash-reserve.mjs";
import { planNewAccounts, diffCreditPulls, planNewPull } from "./new-credit.mjs";
import { TASK_SOURCE, TASK_ROLE, readPayBeforeCloseDays, DAY_MS } from "./common.mjs";

/** How far back the "already sent" keys are read. Keys carry dates or ids that never
 *  come round again, so anything older cannot collide. */
const KEY_HISTORY_DAYS = 400;

/**
 * runFileAlerts(conn, { orgId, clientId, now, env }, deps) → one client's result
 *
 * `deps` swaps every outside thing — send, createTask, the store, the readers —
 * so a test (or the dry run in scripts/) drives the whole pass with no network and
 * no queued message.
 */
export async function runFileAlerts(conn, { orgId, clientId, now = new Date(), env = process.env } = {}, deps = {}) {
  const send = deps.send || defaultSend;
  const createTask = deps.createTask || defaultCreateTask;
  const store = deps.store || defaultStore;
  const loadSnapshot = deps.loadSnapshot || defaultLoadSnapshot;
  const loadPulls = deps.loadLatestPulls || defaultLoadPulls;
  const isOptedOut = deps.isOptedOut || defaultIsOptedOut;
  const isBlueprint = deps.isBlueprint || defaultIsBlueprint;

  const nowDate = new Date(now);
  const nowIso = nowDate.toISOString();
  const out = {
    clientId, ok: true, today: nowIso.slice(0, 10),
    sent: [], held: [], notQueued: [], rearmed: [], skipped: [],
    reserve: {}, errors: []
  };

  const snap = await loadSnapshot(conn, { orgId, clientId, asOf: nowDate });
  if (!snap) return { ...out, ok: false, reason: "client_not_found" };

  const settings = await store.readSettings(conn, { orgId, clientId });
  const known = await store.recentKeys(conn, {
    orgId, clientId, since: new Date(nowDate.getTime() - KEY_HISTORY_DAYS * DAY_MS).toISOString()
  });
  const optedOut = !!(await isOptedOut(conn, clientId, "sms"));
  out.settings = { payment_timing: settings.payment_timing, promo_end: settings.promo_end, cash_reserve: settings.cash_reserve, new_credit: settings.new_credit };
  out.optedOut = optedOut;

  let blueprint = null; // looked up once, and only if a task could be opened
  const isBlueprintFile = async () => {
    if (blueprint === null) blueprint = !!(await isBlueprint(conn, { orgId, clientId }));
    return blueprint;
  };
  let csmStaffId;
  const assignedCsm = async () => {
    if (csmStaffId === undefined) csmStaffId = (await store.assignedCsm(conn, { orgId, clientId })) ?? null;
    return csmStaffId;
  };

  let knownLast4 = null;
  const last4Set = async () => {
    if (knownLast4 === null) knownLast4 = await store.newCreditLast4(conn, { orgId, clientId });
    return knownLast4;
  };

  /* Send, then record. Returns true when something was delivered. */
  async function deliver(plan) {
    let messageId = null;
    if (optedOut) {
      out.held.push({ kind: plan.kind, key: plan.key, reason: "opted_out" });
    } else {
      const r = await send(conn, {
        orgId, clientId, channel: "sms", templateKey: plan.templateKey, eventId: plan.key, context: { alert: plan.tags }
      });
      if (r && r.sent && r.messageId) messageId = r.messageId;
      else out.notQueued.push({ kind: plan.kind, key: plan.key, reason: (r && r.reason) || "not_sent" });
    }

    let taskId = null;
    if (plan.task && (await isBlueprintFile())) {
      const t = await createTask(conn, {
        orgId, clientId,
        title: plan.task.title,
        sourceWorkflow: TASK_SOURCE,
        assigneeRole: TASK_ROLE,
        assigneeStaffId: await assignedCsm(),
        eventId: plan.key,
        body: plan.task.body
      });
      taskId = (t && t.id) || null;
    }

    if (!messageId && !taskId) return false;
    const delivery = messageId ? "text" : "task_only";
    await store.recordAlert(conn, {
      orgId, clientId, kind: plan.kind, key: plan.key,
      bankAccountId: plan.bankAccountId, label: plan.label, threshold: plan.threshold,
      dueOn: plan.dueOn, cashKind: plan.cashKind ?? null,
      body: plan.body, delivery, messageId, taskId, sentAt: nowIso, detail: plan.detail
    });
    known.add(plan.key);
    if (plan.kind === "new_credit") {
      const s = await last4Set();
      for (const item of plan.detail?.items || []) if (item.last4) s.add(item.last4);
    }
    out.sent.push({ kind: plan.kind, key: plan.key, label: plan.label, delivery, messageId, taskId, body: plan.body });
    return true;
  }

  const skip = (kind, subject, reason) => out.skipped.push({ kind, subject, reason });
  const guarded = async (kind, fn) => {
    try { await fn(); } catch (e) { out.errors.push({ kind, error: String((e && e.message) || e).slice(0, 300) }); }
  };

  const cards = snap.overview?.debt?.cards || [];
  const cycleOf = (card) => snap.cycleByAccount.get(String(card.account_id)) ?? null;

  /* 1. pay before the statement closes */
  if (settings.payment_timing) {
    await guarded("payment_timing", async () => {
      const daysBefore = readPayBeforeCloseDays(env);
      for (const card of cards) {
        const plan = planPaymentTiming(card, cycleOf(card), { today: out.today, daysBefore });
        if (!plan.alert) { skip("payment_timing", card.name || card.account_id, plan.reason); continue; }
        if (known.has(plan.key)) { skip("payment_timing", plan.label, "already_sent"); continue; }
        await deliver(plan);
      }
    });
  }

  /* 2. a promo is ending */
  if (settings.promo_end) {
    await guarded("promo_end", async () => {
      for (const card of cards) {
        const plan = planPromoEnd(card, cycleOf(card), { today: out.today });
        if (!plan.alert) { skip("promo_end", card.name || card.account_id, plan.reason); continue; }
        if (known.has(plan.key)) { skip("promo_end", plan.label, "already_sent"); continue; }
        await deliver(plan);
      }
    });
  }

  /* 3. the cash cushion — personal and business judged apart, never added */
  await guarded("cash_reserve", async () => {
    const state = await store.reserveState(conn, { orgId, clientId });
    for (const kind of CASH_KINDS) {
      const verdict = evaluateReserve({
        kind,
        cash: snap.overview?.cash?.[kind],
        debts: snap.debts,
        clarityMonthlyCents: snap.clarityMonthlyCents,
        staleBalance: !!snap.staleByKind?.[kind]
      });
      out.reserve[kind] = { state: verdict.state, reason: verdict.reason };
      const open = state.open.get(kind);

      // Recovered: re-arm. Done even when the alert is switched off, so a stale
      // open row cannot silence the next real drop after it is switched back on.
      if (verdict.state === "ok" && open) {
        if (await store.clearReserve(conn, { orgId, id: open.id, at: nowIso })) out.rearmed.push(kind);
        continue;
      }
      if (verdict.state !== "below") { skip("cash_reserve", kind, verdict.reason); continue; }
      if (!settings.cash_reserve) { skip("cash_reserve", kind, "switched_off"); continue; }
      if (open) { skip("cash_reserve", kind, "already_alerted_for_this_drop"); continue; }
      const plan = planCashReserve(verdict, { clientId, episode: (state.episodes.get(kind) || 0) + 1 });
      if (known.has(plan.key)) { skip("cash_reserve", kind, "already_sent"); continue; }
      await deliver(plan);
    }
  });

  /* 4. new credit */
  if (settings.new_credit) {
    await guarded("new_credit", async () => {
      const last4 = await last4Set();

      const accounts = planNewAccounts(snap.meta, { now: nowDate, knownLast4: last4 });
      for (const s of accounts.skipped) {
        // Quiet reasons are the normal state of an old account; only the ones that explain a missing alert are kept.
        if (s.reason === "already_alerted" || s.reason === "same_account_linked_again" || s.reason === "too_old_to_alert") skip("new_credit", s.accountId, s.reason);
      }
      for (const plan of accounts.alerts) {
        if (known.has(plan.key)) { skip("new_credit", plan.label, "already_sent"); continue; }
        await deliver(plan);
      }

      const pulls = await loadPulls(conn, { orgId, clientId, now: nowDate });
      if (pulls) {
        const diff = diffCreditPulls(pulls.prev.result, pulls.latest.result, { prevOn: pulls.prev.on });
        if (!diff.comparable) skip("new_credit", pulls.latest.id, diff.reason);
        if (diff.unknown > 0) skip("new_credit", pulls.latest.id, `${diff.unknown}_accounts_without_a_print`);
        const plan = planNewPull(diff, { pullId: pulls.latest.id, knownLast4: await last4Set() });
        if (plan) {
          if (known.has(plan.key)) skip("new_credit", plan.label, "already_sent");
          else await deliver(plan);
        }
      }
    });
  }

  return out;
}

export default runFileAlerts;
