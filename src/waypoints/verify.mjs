// Close the waypoints the data can actually close, and NOTHING ELSE.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a waypoint is never marked done on a
// guess. There are exactly two things a fresh credit pull tells us about this
// client's list, and everything else on it stays open until a person says
// otherwise.
//
//   paydown        A re-pull reports the balance on the card. The waypoint
//                  carries the target in integer cents. Balance at or under
//                  target closes it. Above target leaves it open. Card not on
//                  the new file, or a balance the file does not report, leaves
//                  it OPEN — an account we cannot see is unknown, and unknown
//                  is not "paid off".
//
//   dispute_mail_receipt   A client_upload with subtype dispute_mail_receipt on
//                          this client's documents row closes the step.
//
//   bureau_response_upload Any document with kind bureau_response on this client
//                          closes the step.
//
//   no_new_credit  Evidence flows ONE WAY. A revolving account on the new file
//                  that we can POSITIVELY SAY was not on the file at enrolment
//                  is evidence the rule was broken, and the row goes to
//                  'blocked' with the creditor named. Nothing whatsoever is
//                  evidence the rule was KEPT, so this row is never completed
//                  here, not on the last day of the program and not ever.
//
//                  "POSITIVELY SAY" IS THE WHOLE FIX. A reviewer re-pulled a
//                  byte-identical credit file with one creditor string rewritten
//                  from "Credit One Bank" to "CREDIT ONE BANK N.A." and this
//                  code told the client, on their own portal, that they had
//                  opened new credit. Bureaus rename creditors constantly. So an
//                  account is matched by its PRINT — the day it was opened plus
//                  the last four digits of its number — before its name is even
//                  looked at, and when the file does not carry enough to tell a
//                  renamed card from a new one, NOTHING HAPPENS. No block, no
//                  lost paydown, and the reason recorded on the run says which
//                  fact was missing. Unknown is not a denial (CLAUDE.md §12).
//
//                  AND IT IS NOT A ONE-WAY DOOR. A blocked row whose evidence
//                  has gone — the account is no longer on the file, or the
//                  bureau took it off after a correction — goes back to
//                  not_started with its reason cleared. The accusation follows
//                  the evidence in both directions.
//
// A waypoint with a NULL verify_kind is not looked at. NULL means nothing the
// platform can see closes it — the EIN, the business bank account, the LLC
// filing and the personal loan are all in that group, and there is no feed in
// this repository that observes any of them.
//
// AN UNRECOGNISED verify_kind DOES NOTHING. It matches no branch below, so the
// worst a typo in the catalog can do is leave a row open, which is the safe
// direction.
//
// THIS FUNCTION WRITES. It does not send, queue, charge or notify. Telling the
// client is somebody else's job (CLAUDE.md §12 — transmission lives in
// src/messaging/providers/ and nowhere else).

import {
  buildBlackReportClient,
  hasBlackReportSource
} from "../underwrite/black-report-client.mjs";
import { revolvingAccounts, mergeByCreditor, withAccountPrints } from "./definitions.mjs";
import {
  listVerifiableWaypoints,
  completeWaypoint,
  markWaypointState,
  WaypointError
} from "./store.mjs";
import { latestCreditFile } from "./seed.mjs";

/** How a paydown waypoint reads against one account. Pure, so the whole
 *  decision can be tested without a database.
 *  Returns 'complete' | 'open', plus the reason it stayed open. */
export function judgePaydown(waypoint, account) {
  const target = waypoint?.params?.target_cents;
  if (!Number.isInteger(target)) return { verdict: "open", reason: "no_target_on_waypoint" };
  if (!account) return { verdict: "open", reason: "account_not_on_file" };
  if (!Number.isInteger(account.balanceCents)) return { verdict: "open", reason: "balance_unknown" };
  if (account.balanceCents <= target) {
    return { verdict: "complete", reason: "at_or_under_target", balanceCents: account.balanceCents };
  }
  return { verdict: "open", reason: "above_target", balanceCents: account.balanceCents };
}

/**
 * How this file reads against the baseline the client was enrolled on.
 *
 * Pure, so every branch can be tested without a database. Takes the WHOLE
 * params object rather than just the account list, because the answer turns on
 * how well the baseline itself was identified.
 *
 * Verdicts:
 *   'no_baseline'          no credit file existed when this client was seeded,
 *                          so there is nothing to compare against.
 *   'no_accounts_reported' the new file lists no revolving accounts at all
 *                          against a baseline that had some — a thin or partial
 *                          pull, not a client who closed every card overnight.
 *   'clean'                every account on the file is one we already knew
 *                          about, by name or by print.
 *   'unknown'              at least one account is unaccounted for AND we cannot
 *                          tell whether it is new or an old one renamed. NOTHING
 *                          is concluded and nothing is written.
 *   'new'                  at least one account is one we can positively say was
 *                          not on the file at enrolment.
 *
 * `unknownAccounts` is reported alongside a 'new' verdict too: a file can carry
 * one card we are sure about and one we are not, and the sure one is still
 * evidence.
 */
export function classifyAgainstBaseline(params, accounts = []) {
  const baselineKeys = params?.accounts_at_seed;
  if (!Array.isArray(baselineKeys)) {
    return { verdict: "no_baseline", newAccounts: [], unknownAccounts: [], reason: "no_baseline" };
  }
  if (!accounts.length && baselineKeys.length) {
    return {
      verdict: "no_accounts_reported", newAccounts: [], unknownAccounts: [],
      reason: "no_accounts_reported"
    };
  }

  const knownKeys = new Set(baselineKeys);
  const basePrints = Array.isArray(params?.account_prints_at_seed)
    ? new Set(params.account_prints_at_seed)
    : null;
  /* A baseline is only usable as PROOF OF ABSENCE when every account on it
     could be identified. If even one enrolment-era card had no opened date and
     no account number, then a card on the new file matching nothing might be
     that same card under a new name, and the honest answer is that we do not
     know. `null` here means the baseline predates prints entirely — same
     answer, same reason. */
  const baselineFullyIdentified = basePrints !== null
    && params?.accounts_without_print_at_seed === 0;

  const newAccounts = [];
  const unknownAccounts = [];
  for (const a of accounts) {
    if (knownKeys.has(a.accountKey)) continue;
    const prints = Array.isArray(a.prints) ? a.prints : [];
    if (basePrints && prints.some((print) => basePrints.has(print))) continue; // renamed
    if (!prints.length || !baselineFullyIdentified) {
      unknownAccounts.push(a);
      continue;
    }
    newAccounts.push(a);
  }

  if (newAccounts.length) {
    return {
      verdict: "new", newAccounts, unknownAccounts,
      reason: "new_accounts_seen"
    };
  }
  if (unknownAccounts.length) {
    return {
      verdict: "unknown", newAccounts: [], unknownAccounts,
      reason: basePrints === null
        ? "baseline_carries_no_account_prints"
        : (baselineFullyIdentified ? "account_not_identifiable" : "baseline_not_fully_identified")
    };
  }
  return { verdict: "clean", newAccounts: [], unknownAccounts: [], reason: "no_new_accounts_seen" };
}

/**
 * The sentence stored on the row and shown to the client.
 *
 * It is written to be TRUE AND NOT AN ACCUSATION. What we know is that the file
 * shows an account today that it did not show at enrolment; we do not know that
 * the client opened it, and a bureau reporting an account in error is a real
 * thing that happens. It claims no outcome, names no amount and asks the client
 * to tell us if it is wrong. The old wording — "New credit opened after
 * enrolment: CREDIT ONE BANK N.A. account(s)." — did all three of the opposite.
 */
/** @typedef {{ kind: string, subtype?: string|null }} ClientDocumentRow */

/** Whether mailing proof is on file. Pure — no database. */
export function judgeDisputeMailReceipt(documents = []) {
  const hit = documents.some(
    (d) => d?.kind === "client_upload" && d?.subtype === "dispute_mail_receipt"
  );
  return hit
    ? { verdict: "complete", reason: "dispute_mail_receipt_uploaded" }
    : { verdict: "open", reason: "no_dispute_mail_receipt" };
}

/** Whether a bureau response upload is on file. Pure — no database. */
export function judgeBureauResponseUpload(documents = []) {
  const hit = documents.some((d) => d?.kind === "bureau_response");
  return hit
    ? { verdict: "complete", reason: "bureau_response_uploaded" }
    : { verdict: "open", reason: "no_bureau_response" };
}

const DOCUMENT_VERIFY_KINDS = new Set(["dispute_mail_receipt", "bureau_response_upload"]);

async function loadClientDocumentKinds(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT kind, subtype FROM documents
      WHERE org_id = $1::uuid AND client_id = $2::uuid`,
    [orgId, clientId]
  );
  return r.rows || [];
}

export function newAccountReason(newAccounts = []) {
  const names = newAccounts.map((a) => a.creditor).filter(Boolean);
  const one = newAccounts.length === 1;
  const tail = one
    ? "Let our team know if this is not yours."
    : "Let our team know if any of these are not yours.";
  if (!names.length) {
    return one
      ? `Your credit file now shows an account that was not on it when you enrolled. ${tail}`
      : `Your credit file now shows ${newAccounts.length} accounts that were not on it when you enrolled. ${tail}`;
  }
  return one
    ? `Your credit file now shows an account that was not on it when you enrolled: ${names[0]}. ${tail}`
    : `Your credit file now shows accounts that were not on it when you enrolled: ${names.join(", ")}. ${tail}`;
}

/**
 * Re-read one client's verifiable waypoints against a credit file.
 *
 * @param {object} db
 * @param {object}   args
 * @param {string}   args.orgId
 * @param {string}   args.clientId
 * @param {object}   [args.crsResult] the fresh file; the stored newest is read
 *                                    when it is not handed in
 * @param {Date}     [args.now]
 * @returns {Promise<{
 *   ok: true, checked: number,
 *   completed: {key:string, reason:string}[],
 *   blocked:   {key:string, reason:string}[],
 *   unblocked: {key:string, reason:string}[],
 *   unchanged: {key:string, reason:string}[],
 *   creditFile: 'crs_result'|'none'
 * }>}
 */
export async function evaluateWaypoints(db, {
  orgId,
  clientId,
  crsResult = undefined,
  now = new Date()
} = {}) {
  if (!db?.query) throw new WaypointError("db required", { status: 500, code: "db_required" });
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");

  const open = await listVerifiableWaypoints(db, { orgId, clientId });
  const empty = {
    ok: true, checked: 0, completed: [], blocked: [], unblocked: [], unchanged: [], creditFile: "none"
  };
  if (!open.length) return empty;

  const needsDocuments = open.some((w) => DOCUMENT_VERIFY_KINDS.has(w.verify_kind));
  const documents = needsDocuments
    ? await loadClientDocumentKinds(db, { orgId, clientId })
    : [];

  let file = crsResult;
  if (file === undefined) {
    const row = await latestCreditFile(db, { orgId, clientId });
    file = row ? row.result : null;
  }
  const usable = file && hasBlackReportSource(file) ? file : null;

  let accounts = [];
  let byAccount = new Map();
  let byPrint = new Map();
  if (usable) {
    const built = buildBlackReportClient({ crsResult: usable, personal: null });
    // One entry per card, merged the conservative way: the highest balance any
    // bureau reports against the lowest limit any bureau reports. So a paydown
    // closes only when EVERY bureau reporting that card is at or under target.
    accounts = withAccountPrints(mergeByCreditor(revolvingAccounts(built.revolving)), usable);
    byAccount = new Map(accounts.map((a) => [a.accountKey, a]));
    /* The same cards indexed by PRINT. This is the index that survives a bureau
       renaming a creditor, and it is consulted before a card is written off as
       missing from the file. */
    for (const a of accounts) {
      for (const print of a.prints || []) if (!byPrint.has(print)) byPrint.set(print, a);
    }
  }

  const completed = [];
  const blocked = [];
  const unblocked = [];
  const unchanged = [];

  for (const w of open) {
    if (w.verify_kind === "dispute_mail_receipt") {
      const judged = judgeDisputeMailReceipt(documents);
      if (judged.verdict === "complete") {
        await completeWaypoint(db, { orgId, clientId, key: w.key, at: now });
        completed.push({ key: w.key, reason: judged.reason });
      } else {
        unchanged.push({ key: w.key, reason: judged.reason });
      }
      continue;
    }

    if (w.verify_kind === "bureau_response_upload") {
      const judged = judgeBureauResponseUpload(documents);
      if (judged.verdict === "complete") {
        await completeWaypoint(db, { orgId, clientId, key: w.key, at: now });
        completed.push({ key: w.key, reason: judged.reason });
      } else {
        unchanged.push({ key: w.key, reason: judged.reason });
      }
      continue;
    }

    if (!usable) {
      unchanged.push({ key: w.key, reason: "no_credit_file" });
      continue;
    }

    if (w.verify_kind === "paydown") {
      const ck = w.params?.creditor_key;
      /* Name first, because it is right nearly every time and it is what the
         waypoint was keyed on. PRINT SECOND, and this is the half that stops a
         renamed card being read as a card that vanished — before this, a bureau
         rewriting the creditor string lost the client's paydown as
         "account_not_on_file" on the same run that accused them of opening it
         as something new. */
      let account = ck ? byAccount.get(ck) : null;
      if (!account) {
        for (const print of Array.isArray(w.params?.account_prints) ? w.params.account_prints : []) {
          const hit = byPrint.get(print);
          if (hit) { account = hit; break; }
        }
      }
      const judged = judgePaydown(w, account);
      if (judged.verdict === "complete") {
        await completeWaypoint(db, { orgId, clientId, key: w.key, at: now });
        completed.push({ key: w.key, reason: judged.reason });
      } else {
        unchanged.push({ key: w.key, reason: judged.reason });
      }
      continue;
    }

    if (w.verify_kind === "no_new_credit") {
      const judged = classifyAgainstBaseline(w.params, accounts);

      if (judged.verdict === "new") {
        const reason = newAccountReason(judged.newAccounts);
        await markWaypointState(db, { orgId, clientId, key: w.key, state: "blocked", reason });
        blocked.push({ key: w.key, reason });
        continue;
      }

      /* CLEAN, AND THE ROW WAS BLOCKED. The account that put it there is no
         longer on the file — a bureau removed it after a correction, or it was
         never the client's. The evidence has gone, so the state goes with it:
         back to not_started, state_reason cleared. Not 'done' — see the header;
         keeping the rule is never proof, and this row is never completed. */
      if (judged.verdict === "clean" && w.state === "blocked") {
        await markWaypointState(db, {
          orgId, clientId, key: w.key, state: "not_started", reason: null
        });
        unblocked.push({ key: w.key, reason: "blocking_account_no_longer_on_file" });
        continue;
      }

      /* Everything else — a clean file on a row that was never blocked, a
         baseline that does not exist, a pull that reported nothing, and every
         case where a card cannot be told apart from a renamed one — writes
         NOTHING. There is no such thing as proof that a client will not open a
         card tomorrow, and there is no such thing as proof that a card we cannot
         identify is new. */
      unchanged.push({ key: w.key, reason: judged.reason });
      continue;
    }

    unchanged.push({ key: w.key, reason: `unrecognised_verify_kind:${w.verify_kind}` });
  }

  return {
    ok: true,
    checked: open.length,
    completed,
    blocked,
    unblocked,
    unchanged,
    creditFile: usable ? "crs_result" : "none"
  };
}
