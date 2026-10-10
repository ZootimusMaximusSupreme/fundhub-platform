// "Your bank connection needs a quick reconnect" — the ONE text a client gets when
// a bank login breaks (FinanceOS F2).
//
// WHY. When Plaid says a login needs the client to sign in again, the daily refresh
// (src/banking/plaid-refresh.mjs) and the transactions sync mark the login
// link_state = 'error' and stop reading it. A client who is not looking at the
// screen would never know. This queues one text, through the same templated path
// every FinanceOS text uses, and the repair itself is src/banking/plaid-relink.mjs
// (POST /api/banking/relink).
//
// IT DOES NOT SEND, AND IT MOVES NO MONEY. sendTemplated writes a `messages` row at
// status='queued'. The dispatcher (src/messaging/dispatch.mjs) is the only thing that
// hands it to a provider, behind the dry-run fence, the per-company outbound switch,
// quiet hours and the fresh opt-out read. sendTemplated also refuses an opted-out
// client before writing anything.
//
// ONLY FINANCE OS CLIENTS AND BLUEPRINT BUYERS. A client is texted when they hold an
// active `finance-os` subscription OR have paid for the Capital Blueprint — the same
// audience as the file-protection alerts (src/workflows/blueprint-finance-os-alerts.mjs
// alertAudience). Anyone else's broken login is left for the screen and for staff.
//
// THE AUDIENCE IS IN THE CANDIDATE QUERY, NOT ONLY IN A GATE AFTER IT. A client who
// does not pay, or who opted out of SMS, is never texted and so is never stamped — so
// their login would sit at the front of an oldest-first batch every day, and once 200
// of them piled up a paying client's later break would never make the batch. The query
// leaves them out. The JS gates below stay as the second line (and as the seam a test
// drives). The lane that watches this (src/pulse/coverage/gap-bank-relink.mjs) carries
// the same two predicates; a test fails if the two files drift.
//
// THE TEXT IS HELD UNTIL THE RECONNECT SCREEN SHIPS. It says "tap Reconnect", and that
// button is not built yet, so migration 474 seeds the template NOT approved.
// sendTemplated refuses an unapproved template ('template_pending'), so until someone
// approves it this job queues nothing, writes no message and stamps no login: every
// login stays waiting, and the first pass after approval texts them once. Approving it
// is a new migration in the SAME change as the screen (docs/finance/bank-relink.md §7).
//
// ONCE PER ERROR EPISODE. An episode starts when a login goes to 'error' and ends
// when a read proves it works again (plaid-relink.mjs finishRelink). The state is
// plaid_items.reconnect_notified_at (migration 474):
//   * the pass looks for logins in 'error' whose marker is NULL;
//   * it queues the text, THEN sets the marker (SEND, THEN RECORD — the order
//     src/finance/file-alerts/run.mjs uses). A pass that dies between the two is
//     picked up by the next one, and the second send lands on the same message row,
//     because the eventId below is the same: it is built from the login and the
//     instant its error was recorded, and an errored login is not read again, so
//     neither moves;
//   * finishRelink clears the marker only after a successful read. A failed attempt
//     leaves it, so a client who tries and fails is not texted again. A login that
//     breaks again later has a NEW error time, so its eventId is new and it starts
//     a new episode: one more text, never one per day.
//
// A TEXT THAT COULD NOT BE QUEUED WRITES NOTHING. If the client opted out, or the
// template is not approved, the marker stays NULL, so the next pass tries again while
// the episode is still open (the policy of the file-protection alerts).
//
// ONLY THE CODES A RECONNECT FIXES. Not a bank that is down, not a login Plaid
// cannot repair — see src/banking/plaid-item-errors.mjs `notify`. The query asks the
// database for exactly those codes, so a pile of unfixable logins can never crowd
// the fixable ones out of a batch.
//
// NEVER THROWS FOR THE WHOLE PASS. One login's failure is recorded and the next one
// runs. Called once a day, after the Plaid refresh, by
// src/workflows/plaid-transactions-sweeper.mjs.

import { sendTemplated as defaultSend } from "../workflows/messaging.mjs";
import { financeOsEntitlement, FINANCE_OS_TIER } from "./finance-os-entitlement.mjs";
import { isCapitalBlueprintBuyer } from "../blueprint/coach-exception.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { describeItemError, NOTIFY_CODES } from "../banking/plaid-item-errors.mjs";

export const TEMPLATE_KEY = "SMS-FINANCE-OS-RECONNECT";

/** Logins looked at in one pass. Anything beyond this waits for tomorrow. */
export const DEFAULT_LIMIT = 200;

/* A sandbox login's name carries "(Plaid sandbox — test data)" so no screen shows a
   fake balance as a real person's money. In a text that label is only noise (and its
   dash would push the text out of plain SMS), and a text says nothing about money. */
const SANDBOX_LABEL = /\s*\(Plaid sandbox[^)]*\)\s*$/;
const NAME_MAX = 60;

/** The bank's name as a text says it. "bank" when we do not know it (080: never guess). */
export function bankName(institutionName) {
  const base = typeof institutionName === "string" ? institutionName.replace(SANDBOX_LABEL, "").trim() : "";
  return base ? base.slice(0, NAME_MAX).trim() : "bank";
}

const stampOf = (item) => {
  for (const v of [item?.last_error_at, item?.updated_at]) {
    const t = v instanceof Date ? v.getTime() : Date.parse(String(v ?? ""));
    if (Number.isFinite(t)) return String(t);
  }
  return "na";
};

/**
 * planReconnectNotice(item) → { send:true, eventId, context, body } | { send:false, reason }
 *
 * Pure. `item` is one plaid_items row in 'error' (id, institution_name,
 * last_error_code, last_error_at, updated_at). `body` is the sentence the client is
 * told, WITHOUT the opt-out line the template adds; migration 474's test renders the
 * template against it so the two cannot drift.
 *
 * The eventId is what makes a retried pass land on the same message: sendTemplated
 * keys provider_ref on it (`workflow:<template>:<eventId>`, unique per org).
 */
export function planReconnectNotice(item) {
  const d = describeItemError(item?.last_error_code);
  if (!d.notify) {
    return { send: false, reason: d.known ? "not_a_reconnect_code" : "unknown_code" };
  }
  const name = bankName(item.institution_name);
  return {
    send: true,
    eventId: `reconnect:${item.id}:${stampOf(item)}`,
    context: { bank: { name } },
    body: `Fundhub alert: your ${name} connection needs a quick reconnect in FinanceOS. Open FinanceOS and tap Reconnect.`
  };
}

/* Every login that is waiting for its one text, for a client who can be texted. The
   credential column is not read. The tag on the first line is for tests that stand in
   for the database; Postgres ignores it.
   $1 the codes a reconnect fixes, $2 the batch size, $3 now, $4 the finance-os tier,
   $5 the Blueprint product code, $6 the paid status.
   The last two predicates are the audience (isNoticeAudience) and the opt-out read
   (sendTemplated), written the way gap-bank-relink.mjs writes them. */
const CANDIDATES_SQL = `/* reconnect:candidates */
  SELECT i.id, i.org_id, i.client_id, i.institution_name, i.last_error_code, i.last_error_at, i.updated_at
    FROM plaid_items i
   WHERE i.link_state = 'error'
     AND i.reconnect_notified_at IS NULL
     AND i.encrypted_access_token IS NOT NULL
     AND i.consent_granted_at IS NOT NULL
     AND i.plaid_item_id IS NOT NULL
     AND i.plaid_item_id NOT LIKE 'mock:%'
     AND i.last_error_code = ANY($1::text[])
     AND NOT EXISTS (
           SELECT 1 FROM opt_outs o
            WHERE o.client_id = i.client_id AND o.channel = 'sms' AND o.opted_in_at IS NULL
         )
     AND (
           EXISTS (
             SELECT 1 FROM subscriptions s
              WHERE s.org_id = i.org_id AND s.client_id = i.client_id
                AND s.tier = $4::text AND s.status = 'active'
                AND s.effective_from <= $3::timestamptz
                AND (s.effective_to IS NULL OR s.effective_to > $3::timestamptz)
           )
        OR EXISTS (
             SELECT 1 FROM transactions t
               JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
              WHERE t.org_id = i.org_id AND t.client_id = i.client_id
                AND lower(p.code) = lower($5::text)
                AND lower(btrim(COALESCE(t.status, ''))) = $6::text
           )
         )
   ORDER BY i.last_error_at ASC NULLS LAST, i.id ASC
   LIMIT $2`;

/* Guarded on the state it expects, so a login the client fixed between the query and
   this write is not marked as texted. */
const STAMP_SQL = `/* reconnect:stamp */
  UPDATE plaid_items
     SET reconnect_notified_at = $3::timestamptz
   WHERE id = $1 AND org_id = $2
     AND link_state = 'error'
     AND reconnect_notified_at IS NULL`;

/** Finance OS subscriber, or a paid Capital Blueprint buyer. */
export async function isNoticeAudience(conn, { orgId, clientId, now = new Date() } = {}) {
  const fin = await financeOsEntitlement(conn, { orgId, clientId, asOf: now });
  if (fin.entitled) return true;
  return !!(await isCapitalBlueprintBuyer(conn, { orgId, clientId }));
}

/**
 * queueReconnectNotices(conn, { now, send, isEntitled, limit })
 *   → { checked, queued, notEntitled, notQueued[], skipped[], errored[] }
 *
 * One pass over every login that is waiting for its text, across clients. `send`,
 * `isEntitled` and the clock are arguments so a test (or the dry run) drives it with
 * no message and no network.
 */
export async function queueReconnectNotices(conn, {
  now = new Date(), send = defaultSend, isEntitled = isNoticeAudience, limit = DEFAULT_LIMIT
} = {}) {
  const nowDate = new Date(now);
  const bounded = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 1000));
  const out = { checked: 0, queued: 0, notEntitled: 0, notQueued: [], skipped: [], errored: [] };

  const rows = (await conn.query(CANDIDATES_SQL, [
    NOTIFY_CODES, bounded, nowDate.toISOString(), FINANCE_OS_TIER, BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS
  ])).rows;
  out.checked = rows.length;

  const audience = new Map(); // one entitlement answer per client per pass
  for (const item of rows) {
    try {
      const plan = planReconnectNotice(item);
      if (!plan.send) {
        out.skipped.push({ itemRowId: item.id, reason: plan.reason });
        continue;
      }

      const key = `${item.org_id}|${item.client_id}`;
      if (!audience.has(key)) {
        audience.set(key, !!(await isEntitled(conn, { orgId: item.org_id, clientId: item.client_id, now: nowDate })));
      }
      if (!audience.get(key)) {
        out.notEntitled += 1;
        continue;
      }

      const sent = await send(conn, {
        orgId: item.org_id,
        clientId: item.client_id,
        channel: "sms",
        templateKey: TEMPLATE_KEY,
        eventId: plan.eventId,
        context: plan.context
      });
      if (!sent || !sent.sent) {
        out.notQueued.push({ itemRowId: item.id, reason: (sent && sent.reason) || "not_sent" });
        continue;
      }

      await conn.query(STAMP_SQL, [item.id, item.org_id, nowDate.toISOString()]);
      out.queued += 1;
    } catch (e) {
      out.errored.push({ itemRowId: item.id, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return out;
}

export default { queueReconnectNotices, planReconnectNotice, isNoticeAudience, bankName, TEMPLATE_KEY };
