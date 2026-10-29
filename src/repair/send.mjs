// Human send gate for repair DIY + DFY bureau + furnisher letters.
// Staff must press send (mail: true). Never call from payment.received / ds-02.

import { mailBureauLetter } from "../metro2/delivery/send.mjs";
import { findFurnisherAddress } from "../metro2/rounds/store.mjs";
import {
  complaintDestination,
  isComplaintTarget,
  recordComplaintFiling
} from "../metro2/rounds/complaint-filing.mjs";
import { onRepairEvent } from "./handlers.mjs";
import { logDecision } from "../metro2/rounds/store.mjs";

export class RepairSendError extends Error {
  constructor(message, { status = 400, code = "repair_send" } = {}) {
    super(message);
    this.name = "RepairSendError";
    this.status = status;
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DOUBLE-MAILING GUARD
//
// Before this, the loop below set status='sent' with no check of the current
// status, and dispute_letters carried no unique index. So re-POSTing the same
// payload handed the same letters to PostGrid again: two identical letters in a
// real person's post, two at the bureau, and two bills. A disabled button in a
// browser is not a guard — a retry, a second tab or curl walks past it.
//
// db/migrations/332 added the database half and got one thing badly wrong: it
// made the claim and the mailing the same fact, stamping `mailed_at` BEFORE the
// provider was called. So the unique index counted ATTEMPTS, and an attempt
// that died above the network burned the only mailing slot the letter would
// ever have. db/migrations/333 splits them:
//
//   send_claimed_at — this row is TAKEN. Stamped before the call. Releasable.
//   mailed_at       — this row WAS MAILED. Stamped after the provider ACCEPTED
//                     the letter — acceptance, not an id, because PostGrid can
//                     answer 200 with no id in the body and the envelope is
//                     still in the post. Never released, by anyone.
//
// and keys one partial unique index on each, over
// (org_id, case_id, bureau, round, target):
//
//   uq_dispute_letters_one_mailing     WHERE mailed_at IS NOT NULL
//     One physical mailing per case, bureau, round and destination, for ever.
//     Nothing below can release a row from it.
//   uq_dispute_letters_one_send_claim  WHERE send_claimed_at IS NOT NULL
//     A superset (a mailed row keeps its claim), so a regenerated replacement
//     for an already-mailed letter is refused at CLAIM time — before the call,
//     rather than by a unique violation after the envelope is in the post.
//     This one releases.
//
// This is the code half. A letter is CLAIMED before the provider is called, in
// one statement, so two callers cannot both pass the check: the second one's
// UPDATE matches nothing and it never makes the call.
//
// REFUSE ONLY ON POSITIVE EVIDENCE. A claim that affects no rows is not by
// itself proof of a double send — the letter id might name no row at all, which
// is a bad request and is exactly as (un)guarded as it was before this change.
// So a failed claim is followed by a read, and the send is refused only when
// that read shows a row that really is already claimed or already sent, or when
// the unique index rejected the claim because a DIFFERENT row for the same
// case, bureau, round and destination has already gone out.

const UNIQUE_VIOLATION = "23505";

// ═══════════════════════════════════════════════════════════════════════════
// DID ANYTHING ACTUALLY GO OUT? — THE FACT FIRST, THE STRINGS ONLY AS FALLBACK
//
// This decision is the whole guard. Get it wrong one way and a real person gets
// two identical dispute letters and we get two bills. Get it wrong the other
// way and a send that never happened permanently destroys the letter, and the
// replacement, and every replacement after that.
//
// IT WAS WRONG THE SECOND WAY, and it was wrong because it read prose. The list
// below was the only test, so a refusal whose wording was not on it kept the
// claim. Measured on a real database on 2026-09-05 with a fetch implementation
// that throws if it is ever reached — it never fired, so nothing was
// transmitted, and the letter still died:
//
//   press 1  outbound fence held the call   -> row: sending | mailed_at STAMPED
//   press 2  same letter, fence off         -> "already_mailed",  mailer called 0
//   press 3  a brand new replacement row    -> "already_mailed_duplicate_letter"
//
// The caller had already been handed the answer. src/lib/outbound-fetch.mjs
// returns `transmitted: false` from every branch that sits above the fetch
// call, and src/messaging/providers/mail-letter.mjs now carries that up as
// `preTransmission`. So the order is:
//
//   1. If the mailer stated a fact, believe the fact — either way. An explicit
//      preTransmission:false overrides the strings, because "we made the call"
//      is knowledge and a matching prefix is a coincidence.
//   2. Only if it said nothing, fall back to the strings.
//
// BOTH EXIST ON PURPOSE. Not every caller passes the flag through: the mailSender
// closure in api/repair/send.mjs rebuilds the result as
// `{ ok, outcome, error }` and drops everything else, and mailBureauLetter's own
// address refusals (src/metro2/delivery/send.mjs) are plain objects with no flag
// at all. Those are all genuinely pre-transmission and the list is what still
// catches them. Delete the list and they start keeping claims they should
// release; trust the list alone and you are back to the bug above.
//
// Anything not proven pre-transmission KEEPS THE CLAIM. If a call was made and
// did not come back we do not know whether the letter went, and retrying is the
// one action that can actually mail it twice. Same call subscription_charges
// makes for 'in_flight' (db/migrations/276). The difference from before is that
// a kept claim is no longer a dead end: clearStuckSendClaim() below gives a
// human a way out, on the record.
const PRE_TRANSMISSION_REFUSALS = [
  "POSTGRID_API_KEY unset",
  "return_address_required",
  "return_address_incomplete",
  "destination_address_missing",
  "bureau_mail_address_missing",
  "bureau_mail_address_incomplete",
  "pdf_or_html_required",
  "private_carrier_forbidden_for_po_box",
  // The chokepoint's own refusals, for the callers that drop `preTransmission`.
  // Every one of these is returned above the fetch call in
  // src/lib/outbound-fetch.mjs — see transmit() and held().
  "MESSAGING_DRY_RUN ",
  "ADAPTERS_DRY_RUN ",
  "outbound transmit refused: no fence declared",
  "no fetch implementation available"
];

export function isPreTransmissionRefusal(error) {
  const s = String(error || "");
  return PRE_TRANSMISSION_REFUSALS.some((prefix) => s.startsWith(prefix));
}

/**
 * Did this failure provably happen before anything left the process?
 *
 * @param {object|null} sent   What the mailer returned.
 * @param {string} error       The error text pulled off it.
 * @returns {boolean}          true = release the claim, the letter is sendable.
 */
export function nothingWasTransmitted(sent, error) {
  // A stated fact beats a matched string, in both directions.
  if (typeof sent?.preTransmission === "boolean") return sent.preTransmission;
  return isPreTransmissionRefusal(error);
}

/**
 * Take the letter for mailing, before anything is transmitted.
 *
 * @returns {Promise<{claimed: boolean, reason: string|null, priorStatus: string|null}>}
 *   claimed true  — this caller holds the letter and may send it.
 *   claimed false — do not send. `reason` says why.
 */
async function claimLetterForMailing(db, { letterId, orgId, clientId }) {
  // Untracked/ad-hoc letters have a legacy human-send route. For an EXPLICIT
  // stored letter ID, though, the database claim is the authorization: if the
  // row is missing, foreign, or the database is down, never transmit mail.
  // Otherwise a forged/stale ID bypasses both ownership and double-mail guards.
  if (!letterId) return { claimed: true, reason: null, priorStatus: null };
  if (!db?.query) return { claimed: false, reason: "claim_db_unavailable", priorStatus: null };

  let claim;
  try {
    claim = await db.query(
      `WITH prior AS (
         SELECT id, status FROM dispute_letters
          WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
       )
       UPDATE dispute_letters d
          SET status = 'sending', send_claimed_at = now()
         FROM prior
        WHERE d.id = prior.id
          AND d.send_claimed_at IS NULL
          AND d.mailed_at IS NULL
          AND d.status NOT IN ('sending', 'sent', 'delivered')
       RETURNING prior.status AS prior_status`,
      [letterId, orgId, clientId]
    );
  } catch (err) {
    // uq_dispute_letters_one_send_claim: another row for the same case, bureau,
    // round and destination already holds the claim, or already carries a
    // mailing. Either way this one must not go to the provider.
    if (err?.code === UNIQUE_VIOLATION) {
      return { claimed: false, reason: "already_mailed_duplicate_letter", priorStatus: null };
    }
    // Any other database failure means we do not know whether this letter is
    // safe to send, so it is not sent. Refusing one letter rather than throwing
    // keeps the rest of the batch — including letters already handed to the
    // provider — reportable to the caller.
    return { claimed: false, reason: "claim_failed", priorStatus: null };
  }

  if (claim?.rows?.length) {
    return { claimed: true, reason: null, priorStatus: claim.rows[0].prior_status ?? null };
  }

  // A zero-row UPDATE is NOT permission to mail. It can mean a foreign
  // org/client ID, an unknown letter, or a terminal/non-claimable row.
  // A read failure is also not evidence that the row can be safely claimed.
  let existing = null;
  try {
    const r = await db.query(
      `SELECT status, mailed_at, send_claimed_at FROM dispute_letters
        WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid LIMIT 1`,
      [letterId, orgId, clientId]
    );
    existing = r?.rows?.[0] || null;
  } catch {
    return { claimed: false, reason: "claim_failed", priorStatus: null };
  }

  if (!existing) {
    return { claimed: false, reason: "letter_not_found_or_not_owned", priorStatus: null };
  }
  // It went. Nothing releases this and nothing ever will.
  if (existing.mailed_at || ["sent", "delivered"].includes(existing.status)) {
    return { claimed: false, reason: "already_mailed", priorStatus: existing.status ?? null };
  }
  // Claimed but not mailed. Either another caller is inside the provider call
  // right now, or one was and never came back. Named apart from 'already_mailed'
  // because it is a different thing and it has a way out: a human clears it with
  // clearStuckSendClaim() and the letter becomes sendable again.
  if (existing.send_claimed_at || existing.status === "sending") {
    return { claimed: false, reason: "send_claim_held", priorStatus: existing.status ?? null };
  }
  // A matching row that was not actually claimed may have a forbidden state
  // or a concurrent transition. Neither authorizes a real provider call.
  return { claimed: false, reason: "letter_not_claimable", priorStatus: existing.status ?? null };
}

/** Give the letter back, for a refusal that provably happened before transmission.
 *
 *  `mailed_at IS NULL` is load-bearing, not belt-and-braces. A release must never
 *  be able to un-mail a letter that really went out, whatever the caller believed
 *  when it asked. */
async function releaseLetterClaim(db, { letterId, orgId, clientId, priorStatus }) {
  if (!letterId || !db?.query) return;
  await db.query(
    `UPDATE dispute_letters
        SET status = COALESCE($4, 'ready'), send_claimed_at = NULL
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
        AND status = 'sending'
        AND mailed_at IS NULL`,
    [letterId, orgId, clientId, priorStatus || null]
  ).catch(() => {});
}

async function resolveLetterRouting(db, letter, { orgId, identity = null }) {
  const letterId = letter.letterId || letter.letter_id || null;
  let target = letter.target || null;
  let furnisherAddressId = letter.furnisher_address_id || letter.furnisherAddressId || null;
  let furnisherName = letter.furnisherName || letter.furnisher || null;
  let to = letter.to || null;

  if (letterId && db?.query && (!target || (target === "furnisher" && !furnisherAddressId && !to))) {
    const r = await db.query(
      `SELECT target, furnisher_address_id, bureau FROM dispute_letters
        WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [letterId, orgId]
    );
    const row = r.rows[0];
    if (row) {
      target = target || row.target || "bureau";
      furnisherAddressId = furnisherAddressId || row.furnisher_address_id || null;
    }
  }

  target = target || "bureau";

  // A CFPB or state AG complaint. Same human send gate, same provider — only the
  // destination differs. A state AG has no postal address on file today, so that
  // send is REFUSED rather than guessed; see ../metro2/rounds/complaint-filing.mjs.
  if (isComplaintTarget(target)) {
    if (to) return { target, furnisherAddressId: null, furnisherName: null, to, refusal: null };
    const dest = complaintDestination(target, {
      state: identity?.state || identity?.address_state || letter.state || null
    });
    return {
      target,
      furnisherAddressId: null,
      furnisherName: null,
      to: dest.ok ? dest.to : null,
      refusal: dest.ok ? null : dest.reason
    };
  }

  if (target === "furnisher" && !to && furnisherAddressId && db?.query) {
    const r = await db.query(
      `SELECT * FROM furnisher_mail_addresses WHERE id = $1::uuid LIMIT 1`,
      [furnisherAddressId]
    );
    const row = r.rows[0];
    if (row) {
      furnisherName = furnisherName || row.name;
      to = {
        company_name: row.name,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        address_city: row.city,
        address_state: row.state,
        address_zip: row.zip,
        address_country: row.country || "US"
      };
    }
  }

  if (target === "furnisher" && !to && furnisherName && db) {
    const row = await findFurnisherAddress(db, furnisherName, orgId);
    if (row) {
      to = {
        company_name: row.name,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        address_city: row.city,
        address_state: row.state,
        address_zip: row.zip,
        address_country: row.country || "US"
      };
    }
  }

  return { target, furnisherAddressId, furnisherName, to, refusal: null };
}

export async function sendRepairLetters(db, {
  orgId,
  clientId,
  staffId,
  mail = false,
  letters = [],
  identity = null,
  from = null,
  mailSender = null,
  env,
  fetchImpl
} = {}) {
  if (!orgId || !clientId || !staffId) {
    throw new RepairSendError("orgId, clientId, and staffId are required", { status: 400 });
  }
  if (!mail) {
    throw new RepairSendError("mail required — human must press send", { code: "no_channel" });
  }
  if (!Array.isArray(letters) || letters.length === 0) {
    throw new RepairSendError("at least one letter is required", { code: "letters_required" });
  }

  const results = [];
  // Letters the provider accepted that the database does not record. Empty is
  // the normal case; anything in here needs a person, and must never be retried.
  const unrecordedMailings = [];
  for (const letter of letters) {
    const bureau = String(letter.bureau || "").toUpperCase();
    if (!bureau) {
      throw new RepairSendError("each letter needs a bureau", { code: "bureau_required" });
    }

    const routing = await resolveLetterRouting(db, letter, { orgId, identity });
    // No address, no send, no filing row. A complaint that cannot be addressed
    // must never be reported as mailed — Round 6 reads those rows.
    if (routing.refusal) {
      results.push({ bureau, target: routing.target, ok: false, error: routing.refusal });
      continue;
    }
    const enriched = {
      ...letter,
      bureau,
      target: routing.target,
      furnisherName: routing.furnisherName,
      to: routing.to
    };

    // CLAIM BEFORE SENDING. Everything above this line is addressing; nothing
    // has been transmitted yet, so this is the last honest moment to decide
    // whether this letter is allowed to go.
    const claimLetterId = letter.letterId || letter.letter_id || null;
    const claim = await claimLetterForMailing(db, {
      letterId: claimLetterId,
      orgId,
      clientId
    });
    if (!claim.claimed) {
      results.push({
        bureau,
        target: routing.target,
        ok: false,
        error: claim.reason,
        letterId: claimLetterId
      });
      continue;
    }

    let sent;
    if (typeof mailSender === "function") {
      sent = await mailSender({
        ...enriched,
        identity,
        from,
        orgId,
        clientId
      });
    } else {
      sent = await mailBureauLetter({
        db,
        // A complaint is not addressed to a bureau, so the bureau lookup must not
        // be allowed to supply a fallback destination for it.
        bureau: (routing.target === "furnisher" || isComplaintTarget(routing.target)) ? null : bureau,
        furnisherName: routing.target === "furnisher" ? routing.furnisherName : null,
        to: routing.to,
        identity,
        from,
        pdf: letter.pdf || letter.pdfBase64,
        html: letter.html,
        description: letter.description
          || (isComplaintTarget(routing.target)
            ? `Repair complaint ${routing.target.toUpperCase()} ${bureau}`
            : routing.target === "furnisher"
              ? `Repair furnisher letter ${routing.furnisherName || bureau}`
              : `Repair letter ${bureau}`),
        metadata: {
          orgId,
          clientId,
          staffId,
          letterId: letter.letterId || letter.letter_id || null,
          target: routing.target,
          stack: "repair"
        },
        env,
        fetchImpl
      });
    }

    if (sent?.ok === false || (sent && sent.ok !== true && sent.providerId == null && sent.outcome?.startsWith?.("mail_failed"))) {
      const err = sent?.error || sent?.outcome || "mail_failed";
      // Give the letter back only when the refusal provably happened before any
      // request left this process. Everything else keeps the claim, because a
      // call that was made and did not come back may already have mailed — and
      // a kept claim is now clearable by a human rather than terminal.
      if (nothingWasTransmitted(sent, err)) {
        await releaseLetterClaim(db, {
          letterId: claimLetterId,
          orgId,
          clientId,
          priorStatus: claim.priorStatus
        });
      }
      results.push({ bureau, target: routing.target, ok: false, error: err });
      continue;
    }

    const providerId = sent?.providerId || sent?.id || null;
    const letterId = claimLetterId;

    // ─────────────────────────────────────────────────────────────────────────
    // THE PROVIDER TOOK IT. THAT IS THE FACT. THE ID IS ONLY METADATA.
    //
    // This used to read `if (letterId && providerId && db?.query)`, and it is
    // the whole of the last defect. PostGrid answering 200 with a body that
    // carries no id gives `{ ok: true, providerId: null }`
    // (src/messaging/providers/mail-letter.mjs), so the letter was posted and
    // the entire write-back below was skipped. The row stayed
    // status='sending', mailed_at NULL, postgrid_letter_id NULL — which is
    // exactly the shape listStuckSendClaims() offers a staff member as "stuck"
    // and clearStuckSendClaim() then releases. Reproduced end to end on a
    // scratch database: press 1 mailed it, the row read as stuck, the clear
    // succeeded, press 2 mailed it again. A second envelope to a real person
    // and a second bill.
    //
    // So the gate is acceptance, not an id. `postgrid_letter_id` stays nullable
    // and COALESCEd: a missing id is UNKNOWN, not "this did not happen"
    // (CLAUDE.md §12), and a null must never wipe an id an earlier write got.
    //
    // Acceptance means positive evidence: the mailer said ok, or it handed back
    // an id. A mailer that returns nothing at all said neither, and is handled
    // below as an unknown outcome rather than silently counted as a mailing —
    // inventing a mailed_at is the one mistake that kills a letter for ever.
    const accepted = sent?.ok === true || providerId != null;

    let mailingRecorded = null;   // null = there was no row to record it on
    let mailingRecordError = null;

    if (!accepted) {
      // The mailer was called and answered neither yes nor no. Nobody can say
      // whether an envelope went. Keep the claim (a retry is the one action
      // that can mail twice) and hand it to a human via clearStuckSendClaim.
      results.push({
        bureau,
        target: routing.target,
        ok: false,
        error: "mailer_no_answer",
        letterId
      });
      continue;
    }

    if (letterId && db?.query) {
      // THIS is where mailed_at is stamped — the provider accepted the letter,
      // so it is in its hands. Not at claim time, which is what 332 did and
      // what let a send that never happened kill the letter.
      // COALESCE so a re-run cannot move the recorded mailing time.
      const recordMailing = () => db.query(
        `UPDATE dispute_letters
            SET status = 'sent',
                postgrid_letter_id = COALESCE($2::text, postgrid_letter_id),
                mailed_at = COALESCE(mailed_at, now()),
                send_claimed_at = COALESCE(send_claimed_at, now())
          WHERE id = $1::uuid AND org_id = $3::uuid AND client_id = $4::uuid
            AND status <> 'delivered'`,
        [letterId, providerId == null ? null : String(providerId), orgId, clientId]
      );

      // NOT SILENT. This write is the only thing standing between a mailed
      // letter and a second envelope, and it used to end in `.catch(() => {})`
      // — a momentary database error produced the same unrecorded mailing as
      // the null id did, and nobody was told. One retry, then the failure is
      // logged, carried on the letter's own result, and collected on the return
      // value so the HTTP caller sees it.
      try {
        await recordMailing();
        mailingRecorded = true;
      } catch (first) {
        try {
          await recordMailing();
          mailingRecorded = true;
        } catch (second) {
          mailingRecorded = false;
          mailingRecordError = String(second?.message || second || "unknown").slice(0, 240);
          unrecordedMailings.push({
            letterId,
            bureau,
            target: routing.target,
            providerId,
            error: mailingRecordError
          });
          console.error(
            "[repair.send] MAILING NOT RECORDED — the provider accepted this letter and the "
            + "database does not say so. DO NOT RE-SEND IT. Reconcile against the provider by hand. "
            + `letterId=${letterId} bureau=${bureau} target=${routing.target} `
            + `providerId=${providerId ?? "none"} error=${mailingRecordError}`
          );
        }
      }
    }

    // Start the bureau's 30-day clock. Nothing wrote response_due_at before this
    // — createCase defaulted it to null and no other statement in the repo ever
    // set it — so the awaiting_response SLA and the overdue next-action have
    // never once been able to fire.
    //
    // Here is the only honest moment to stamp it: the mailer has taken the
    // letter. Not at generation, when it might never go out.
    //
    // `response_due_at IS NULL` is load-bearing. Re-sending on a case that is
    // already running must not push the deadline out, and this must never touch
    // the cases already sitting in the table — stamping those would light up
    // every historic file at once the first time the sweeper looked.
    const caseIdForClock = letter.caseId || letter.case_id || null;
    if (caseIdForClock && db?.query) {
      await db.query(
        `UPDATE dispute_cases
            SET response_due_at = now() + interval '30 days',
                status = 'awaiting_response',
                updated_at = now()
          WHERE id = $1::uuid
            AND org_id = $2::uuid
            AND response_due_at IS NULL`,
        [caseIdForClock, orgId]
      ).catch(() => {});
    }
    // A complaint that had no row yet gets one now — AFTER the provider took it,
    // never before. This row is what Round 6 reads to decide whether it may say a
    // complaint was filed, so it must mean "mailed" and nothing weaker.
    let filingRecorded = null;
    if (!letterId && isComplaintTarget(routing.target)) {
      const rec = await recordComplaintFiling(db, {
        caseId: letter.caseId || letter.case_id || null,
        orgId,
        clientId,
        bureau,
        round: letter.round,
        target: routing.target,
        bodyText: letter.bodyText || letter.body_text || null,
        providerId
      });
      filingRecorded = rec.ok ? true : rec.reason;
    }
    results.push({
      bureau,
      target: routing.target,
      ok: true,
      providerId,
      outcome: sent?.outcome || "sent",
      letterId,
      ...(filingRecorded === null ? {} : { filingRecorded }),
      // Only ever present when it is false. A letter that went out and was not
      // written down is not a detail to be inferred from a missing field.
      ...(mailingRecorded === false
        ? { mailingRecorded: false, mailingRecordError }
        : {})
    });
  }

  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    await onRepairEvent(db, {
      name: "repair.letters.sent",
      orgId,
      clientId,
      payload: {
        staffId,
        results,
        source: "staff_repair_send"
      }
    });
  }

  // `unrecordedMailings` is present only when it has something in it, and when
  // it does the answer is a person and not a retry: the letter IS in the post
  // and the row that would stop a second one is not there.
  return {
    ok: anyOk,
    results,
    ...(unrecordedMailings.length ? { unrecordedMailings } : {})
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// THE WAY OUT OF A STUCK CLAIM
//
// A letter whose provider call went out and never came back keeps its claim, on
// purpose: nobody can say whether it was mailed, and a retry is the one action
// that can put a second envelope in a real person's post.
//
// Before this, that was the end of the story. Nothing in the repository could
// clear the row. The PostGrid webhook keys on postgrid_letter_id, which is NULL
// on a stuck row, so it never fires. The re-stage path skipped 'sending', so it
// wrote a fresh row that the unique index then refused as well. "A human
// reconciles it" named no human and no action.
//
// So: a staff member reconciles the letter against the provider's own record,
// decides it did not go, and says so here — with their id and their reason,
// both stored on the row and written to repair_decision_log where
// src/repair/lens.mjs renders it in plain words on the client's timeline.
//
// WHAT THIS CAN AND CANNOT DO. Read the exception; it is the whole risk.
//
//   It clears send_claimed_at. It NEVER touches mailed_at, and it refuses
//   outright on any row that carries one, or a provider id.
//
//   THE DATABASE ENFORCES THAT, not just the four `if`s below. Two constraints,
//   either of which alone kills the statement:
//     dispute_letters_mailed_implies_claimed_ck (333) — send_claimed_at cannot
//       go back to NULL while mailed_at is set, whoever writes the UPDATE.
//     dispute_letters_no_clear_after_mailing_ck (334) — a clear cannot be
//       recorded at or after a mailing time.
//   So a hand-written UPDATE, or a future code path that forgets the reads
//   above, is rejected by Postgres rather than by this function.
//
//   THE EXCEPTION, AND IT IS REAL. All of that is conditional on the row saying
//   the letter was mailed. If the write-back in sendRepairLetters could not be
//   made — the database was unreachable for those two attempts — the mailing is
//   not on the row, and this function will happily clear it. That case is no
//   longer silent: it is logged, returned on the letter's own result as
//   mailingRecorded:false, and collected on the send's `unrecordedMailings`.
//   But nothing in the database knows about it, so nothing in the database can
//   refuse it. A letter named there must be reconciled, not re-sent.
//
//   It CAN also be wrong in the ordinary direction. If the letter did reach
//   PostGrid and the reply was simply lost, clearing lets it be sent a second
//   time. That risk is real, it is why this is deliberate and attributed rather
//   than automatic, and it is why nothing calls this on a timer.

/** How long a claim must have sat before a human may call it stuck. Short
    enough to be usable inside one support conversation, long enough that it
    cannot race a provider call that is simply slow — the transport's own hard
    timeout is 10s (src/lib/outbound-fetch.mjs DEFAULT_TIMEOUT_MS). */
export const STUCK_CLAIM_MIN_AGE_MINUTES = 15;

/**
 * Release a send claim that a human has decided did not result in a mailing.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {string} opts.letterId
 * @param {string} opts.staffId    Who is making the call. Recorded, not optional.
 * @param {string} opts.reason     Why they believe it did not go. Recorded.
 * @param {number} [opts.minAgeMinutes]
 * @returns {Promise<{ok: boolean, reason?: string, letterId?: string, status?: string}>}
 */
export async function clearStuckSendClaim(db, {
  orgId,
  letterId,
  staffId,
  reason,
  minAgeMinutes = STUCK_CLAIM_MIN_AGE_MINUTES
} = {}) {
  const why = String(reason ?? "").trim();
  if (!db?.query) return { ok: false, reason: "db_required" };
  if (!orgId || !letterId) return { ok: false, reason: "org_and_letter_required" };
  if (!staffId) return { ok: false, reason: "staff_id_required" };
  if (!why) return { ok: false, reason: "reason_required" };

  const found = await db.query(
    `SELECT id, client_id, case_id, status, mailed_at, send_claimed_at, postgrid_letter_id
       FROM dispute_letters
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [letterId, orgId]
  );
  const row = found?.rows?.[0] || null;
  if (!row) return { ok: false, reason: "not_found" };

  // It went. There is nothing stuck here and nothing to clear.
  if (row.mailed_at) return { ok: false, reason: "already_mailed", status: row.status };
  if (row.postgrid_letter_id) {
    return { ok: false, reason: "provider_accepted", status: row.status };
  }
  if (row.status !== "sending" || !row.send_claimed_at) {
    return { ok: false, reason: "not_claimed", status: row.status };
  }

  // Refuse to race a call that is merely slow.
  const ageMs = Date.now() - new Date(row.send_claimed_at).getTime();
  const minMs = Math.max(0, Number(minAgeMinutes) || 0) * 60_000;
  if (!(ageMs >= minMs)) {
    return { ok: false, reason: "claim_too_fresh", status: row.status };
  }

  const cleared = await db.query(
    `UPDATE dispute_letters
        SET status = 'ready',
            send_claimed_at = NULL,
            send_claim_cleared_at = now(),
            send_claim_cleared_by = $3::uuid,
            send_claim_cleared_reason = $4
      WHERE id = $1::uuid AND org_id = $2::uuid
        AND status = 'sending'
        AND mailed_at IS NULL
        AND postgrid_letter_id IS NULL
      RETURNING id, status`,
    [letterId, orgId, staffId, why]
  );
  if (!cleared?.rows?.length) {
    // Something changed under us between the read and the write. Refusing is
    // the only safe answer: the row may have just been mailed.
    return { ok: false, reason: "not_claimed" };
  }

  await logDecision(db, {
    orgId,
    clientId: row.client_id,
    caseId: row.case_id,
    decision: "repair.letter.send_claim_cleared",
    payload: {
      letterId,
      staffId,
      reason: why,
      claimedAt: row.send_claimed_at,
      note: "Staff judged the provider call never mailed this letter. It is sendable again."
    }
  }).catch(() => {});

  return { ok: true, letterId, status: cleared.rows[0].status };
}

/**
 * The reconciliation read: letters holding a claim with no mailing behind it.
 * This is what a staff screen lists before anybody clears anything.
 */
export async function listStuckSendClaims(db, { orgId, clientId = null, minAgeMinutes = STUCK_CLAIM_MIN_AGE_MINUTES } = {}) {
  if (!db?.query || !orgId) return [];
  const r = await db.query(
    `SELECT dl.id, dl.client_id, dl.case_id, dl.bureau, dl.round, dl.target,
            dl.status, dl.send_claimed_at
       FROM dispute_letters dl
      WHERE dl.org_id = $1::uuid
        AND dl.status = 'sending'
        AND dl.send_claimed_at IS NOT NULL
        AND dl.mailed_at IS NULL
        AND dl.postgrid_letter_id IS NULL
        AND dl.send_claimed_at < now() - make_interval(mins => $3::int)
        AND ($2::uuid IS NULL OR dl.client_id = $2::uuid)
      ORDER BY dl.send_claimed_at ASC`,
    [orgId, clientId, Math.max(0, Number(minAgeMinutes) || 0)]
  );
  return r.rows;
}
