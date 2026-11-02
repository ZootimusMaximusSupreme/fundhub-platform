// Bus handlers: staff payout email + deal-close win SMS.
// COMPLIANCE REVIEW REQUIRED — commission timing / staff payout notice.
//
// Registered after money-chain so sale attributions exist on deal-close events.

import { on } from "../events/registry.mjs";
import { notifyCommissionPaid, notifyCommissionPaidPush, notifyDealCloseWin } from "../staff/comp-alerts.mjs";

export async function onCommissionPaidAlert(event, db) {
  let mail = { mailed: false, reason: "error" };
  let push = { sent: 0, reason: "error" };
  try {
    mail = await notifyCommissionPaid(db, event);
  } catch (err) {
    console.warn(
      `[staff-comp-alerts] commission.paid notify failed: ${err && err.message}`
    );
  }
  try {
    push = await notifyCommissionPaidPush(db, event);
  } catch (err) {
    console.warn(`[staff-comp-alerts] commission.paid push failed: ${err && err.message}`);
  }
  return { ...mail, push };
}

export async function onDealCloseWinAlert(event, db) {
  try {
    return await notifyDealCloseWin(db, event);
  } catch (err) {
    console.warn(
      `[staff-comp-alerts] deal-close notify failed: ${err && err.message}`
    );
    return { queued: 0, reason: "error" };
  }
}

export function register() {
  on("commission.paid", onCommissionPaidAlert);
  on("sale.closed", onDealCloseWinAlert);
  on("deposit.paid", onDealCloseWinAlert);
}
