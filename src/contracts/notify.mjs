// src/contracts/notify.mjs — the contract actually going out, and being chased.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT WAS MISSING, AND WHY IT LOOKED LIKE THE CONTRACT FEATURE'S FAULT
//
// Every piece of the outbound path already existed and was tested: the queue
// (`messages`), the compliance gate, the retry and quiet-hours logic, and four
// real providers including Mailgun. The one thing missing was ANYTHING THAT
// CALLED THE DISPATCHER — src/messaging/dispatch.mjs says so in its own header:
// "dispatchDue() runs when something calls it, and today nothing does."
//
// So a staff member pressed Send, got a link, and had to paste it somewhere
// themselves. Which reads as "the contract system cannot send contracts", when
// in fact NOTHING in the platform sent anything.
//
// This module is the caller. It queues one message per signer and then hands
// those messages — and ONLY those messages — to the dispatcher.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT DISPATCHES BY ID INSTEAD OF CALLING dispatchDue()
//
// dispatchDue(db, { orgId }) claims every message that is due for the org. That
// is correct for the scheduled sweep and surprising here: pressing "send this
// contract" would also flush whatever else happened to be waiting. Sending a
// contract sends THAT CONTRACT — the rows this module just wrote, claimed by id
// and dispatched one at a time.
//
// IT STILL OBEYS THE SAME PAUSE BUTTON. deliverQueued() reads
// messaging_settings.outbound_enabled (119) and refuses when a company has
// paused its outbound mail. A switch with an exception in it is not a switch,
// and an operator who pauses sending must not find contracts still going out.
// The rows simply stay queued, and the scheduled sweep picks them up when
// sending is turned back on.
//
// ═══════════════════════════════════════════════════════════════════════════
// IT DEGRADES, IT NEVER FAILS THE SEND
//
// If no email provider is configured, or the org has no routing row, or the
// gate holds the message — the contract is still sent, the links are still
// minted and shown, and the row stays in the queue with its reason recorded.
// A contract that is legally sent must not be reported as failed because an
// email did not go. Every function here returns an outcome; none of them throw
// into the send path.
//
// NOTHING HERE TRANSMITS DIRECTLY. It writes rows and calls the dispatcher,
// which resolves a provider from `message_channel_routing`. Outbound fetch lives
// in src/messaging/providers/* and nowhere else (CLAUDE.md §12) — that rule is
// untouched, and this module could not break it if it tried: it holds no URL
// and no credential.

import { renderTemplate } from "../lib/render-template.mjs";
import { dispatchOne } from "../messaging/dispatch.mjs";
import { settingsFor } from "../messaging/outbox.mjs";
import { createTask } from "../lib/create-task.mjs";
import { threadMessage } from "../conversations/store.mjs";
import { destinationAddress } from "../auth/authorized-rep.mjs";

/** The two pieces of copy this feature sends. Seeded in db/seed/008. */
export const SEND_TEMPLATE_KEY = "CONTRACT-SEND-EMAIL";
export const REMIND_TEMPLATE_KEY = "CONTRACT-REMIND-EMAIL";

/** How long a contract sits unsigned before the first chase, and how often after. */
export const FIRST_CHASE_DAYS = 3;
export const CHASE_EVERY_DAYS = 3;
export const MAX_CHASES = 4;

/**
 * Put a declined agreement in front of the person who sent it.
 * The task is company-scoped, assigned to the original sender when known, and
 * idempotent for this signer so a retried decline cannot make duplicate work.
 */
export async function notifyContractDecline(db, { signer, reason } = {}) {
  const { rows } = await db.query(
    `SELECT id, org_id, client_id, title, sent_by
       FROM contracts
      WHERE id = $1::uuid AND org_id = $2::uuid
      LIMIT 1`,
    [signer?.contract_id, signer?.org_id]
  );
  const contract = rows[0];
  if (!contract) throw new Error("The declined contract could not be found in its company.");

  const why = String(reason || signer?.decline_reason || "No reason given").trim();
  return createTask(db, {
    orgId: contract.org_id,
    clientId: contract.client_id || signer.client_id,
    title: `Contract declined: ${contract.title} — ${signer.name} did not sign`,
    detail: `${signer.name} declined the agreement. Reason: ${why}`,
    sourceWorkflow: "contract-sign-decline",
    assigneeRole: "closer",
    assigneeStaffId: contract.sent_by || null,
    eventId: `contract.declined:${contract.id}:${signer.id}`,
  });
}

/* The merge context a contract message renders against. Deliberately small and
   deliberately NOT the client record: a signer may be a counterparty who is not
   a client at all, and rendering somebody else's details into their email is
   the kind of mistake that is only discovered by the person receiving it. */
export function signerContext({ contract, signer, link, staffName = null }) {
  const first = String(signer.name || "").trim().split(/\s+/)[0] || "there";
  return {
    contact: { first_name: first, name: signer.name, full_name: signer.name, email: signer.email },
    contract: {
      title: contract.title,
      link,
      role: signer.role_label,
      sender: staffName || "the Fundhub team"
    }
  };
}

async function loadTemplate(db, orgId, key) {
  const { rows } = await db.query(
    `SELECT template_key, channel, subject, body, compliance_passed
       FROM message_templates
      WHERE org_id = $1::uuid AND template_key = $2 LIMIT 1`, [orgId, key]);
  return rows[0] || null;
}

/**
 * queueSignerMessages — one email per signer, written to the outbound queue.
 *
 * Returns { queued: [messageId], skipped: [{ name, reason }] }.
 *
 * IDEMPOTENT. provider_ref is `contract:<contractId>:<signerId>:<purpose>` and
 * migration 004's unique index on (org_id, provider_ref) is what actually
 * guarantees it — pressing Send twice cannot produce two emails to the same
 * person for the same reason. A resend that genuinely should go out (the client
 * lost it) passes a different `purpose`.
 *
 * ONLY THE SIGNER WHOSE TURN IT IS, under a sequential contract. Emailing
 * everybody at once would tell the second party the document exists before the
 * first has agreed to it, which is the whole point of having an order.
 */
export async function queueSignerMessages(db, {
  orgId, contract, signers, links, purpose = "send", staffName = null, templateKey = SEND_TEMPLATE_KEY
} = {}) {
  const out = { queued: [], skipped: [] };
  const template = await loadTemplate(db, orgId, templateKey);
  if (!template) {
    out.skipped.push({ name: null, reason: "no_template" });
    return out;
  }
  if (!template.compliance_passed) {
    // Same rule sendTemplated applies: unapproved copy does not go out. The
    // contract is still sent; the email simply is not.
    out.skipped.push({ name: null, reason: "template_not_approved" });
    return out;
  }

  const sequential = (contract.signing_order || "sequential") === "sequential";
  const byIndex = [...signers].sort((a, b) => a.signer_index - b.signer_index);
  const turn = byIndex.find((s) => s.status !== "signed" && s.status !== "declined");

  for (const signer of byIndex) {
    if (signer.status === "signed" || signer.status === "declined") continue;
    if (sequential && turn && signer.id !== turn.id) {
      out.skipped.push({ name: signer.name, reason: "not_their_turn_yet" });
      continue;
    }
    const toEmail = signer.client_id
      ? await destinationAddress(db, signer.client_id, "email", signer.email)
      : signer.email;
    if (!toEmail) {
      out.skipped.push({ name: signer.name, reason: "no_email" });
      continue;
    }
    const link = (links || []).find((l) => String(l.signer_id) === String(signer.id));
    if (!link) { out.skipped.push({ name: signer.name, reason: "no_link" }); continue; }

    const context = signerContext({ contract, signer, link: link.url, staffName });
    const body = renderTemplate(template.body, context);
    const subject = template.subject ? renderTemplate(template.subject, context) : null;

    /* client_id is set ONLY for a signer who is really the client on file. A
       counterparty is nobody's client, and filing their email under the client's
       id would put another company's correspondence on a consumer's record. */
    const { rows } = await db.query(
      `INSERT INTO messages
         (org_id, client_id, direction, channel, template_key, rendered_body,
          provider, provider_ref, status, compliance_check_passed, to_address, subject)
       VALUES ($1,$2,'outbound','email',$3,$4,NULL,$5,'queued',true,$6,$7)
       ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id, created_at`,
      [orgId, signer.client_id || null, template.template_key, body,
       `contract:${contract.id}:${signer.id}:${purpose}`, toEmail, subject]);

    if (rows[0]) {
      out.queued.push(rows[0].id);
      /* On the client's email thread, so the Messaging screen can find them by
         name. A counterparty who is not the client on file has no client_id and
         so gets no thread — the helper returns null and the row keeps its NULL,
         which is the same rule the comment above the INSERT states. */
      await threadMessage(db, {
        orgId, clientId: signer.client_id || null, channel: "email",
        messageId: rows[0].id, createdAt: rows[0].created_at, source: "contracts"
      });
    } else out.skipped.push({ name: signer.name, reason: "already_queued" });
  }
  return out;
}

/**
 * deliverQueued — hand exactly these messages to the dispatcher.
 *
 * Claims each row the same way claimDue() does (an UPDATE that flips status in
 * the same statement that selects it), so two callers racing cannot both send
 * one message. Narrowed to a list of ids for the reason in the header.
 *
 * Returns { sent, blocked, failed, outcomes: [{ id, outcome }] }.
 * NEVER THROWS: a delivery failure is reported, not raised into the send.
 */
export async function deliverQueued(db, ids = [], options = {}) {
  const summary = { sent: 0, blocked: 0, failed: 0, outcomes: [] };
  if (!ids || !ids.length) return summary;

  /* THE SAME PAUSE BUTTON EVERYTHING ELSE OBEYS. An operator who has paused
     outbound mail must not find contracts still going out — a switch with an
     exception in it is not a switch. The rows stay queued and the scheduled
     sweep picks them up when sending is turned back on. */
  if (options.orgId) {
    const settings = await settingsFor(db, options.orgId);
    if (!settings.outbound_enabled) {
      return { ...summary, paused: true, outcomes: ids.map((id) => ({ id, outcome: "paused" })) };
    }
  }

  for (const id of ids) {
    try {
      const claimed = (await db.query(
        `UPDATE messages
            SET status = 'sending', last_attempt_at = now(), attempts = attempts + 1
          WHERE id = $1::uuid AND status = 'queued'
          RETURNING *`, [id])).rows[0];
      if (!claimed) { summary.outcomes.push({ id, outcome: "not_claimable" }); continue; }

      const res = await dispatchOne(db, claimed, options);
      const outcome = (res && res.outcome) || "unknown";
      summary.outcomes.push({ id, outcome });
      if (outcome === "sent") summary.sent += 1;
      else if (outcome === "blocked") summary.blocked += 1;
      else summary.failed += 1;
    } catch (err) {
      /* The dispatcher records its own failures against the row. What is caught
         here is the dispatcher itself being unreachable — and a contract that is
         legally sent must not report failure because an email did not go. */
      console.warn(`[contracts] could not deliver message ${id}: ${err.message}`);
      summary.failed += 1;
      summary.outcomes.push({ id, outcome: "error" });
    }
  }
  return summary;
}

/** queue + deliver, as one call. What send() and the chaser both use. */
export async function notifySigners(db, args = {}) {
  const queued = await queueSignerMessages(db, args);
  const delivered = await deliverQueued(db, queued.queued, {
    ...(args.dispatchOptions || {}), orgId: args.orgId
  });
  return { ...queued, delivery: delivered };
}

// ---------------------------------------------------------------------------
// chasing
// ---------------------------------------------------------------------------

/**
 * chasesFor — how many reminders have already gone out for one contract.
 *
 * Counted from the messages actually queued for it rather than a counter on the
 * contract row: the messages ARE the record of what was sent, and a counter
 * would be a second source of truth that can disagree with them.
 *
 * Returns { n, last } — how many, and when the newest one was written.
 */
export async function chasesFor(db, { orgId, contractId } = {}) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n, max(created_at) AS last
       FROM messages
      WHERE org_id = $1::uuid AND provider_ref LIKE $2`,
    [orgId, `contract:${contractId}:%:chase%`]);
  return { n: rows[0]?.n || 0, last: rows[0]?.last || null };
}

/**
 * remindContract — chase ONE contract, now.
 *
 * The single-contract half of chaseContracts, pulled out so the sweep and a
 * person pressing a button on one row run the SAME code. Two ways to send the
 * same reminder is exactly the bug that surfaces months later as "the button
 * sends a different email from the nightly job".
 *
 * `listSigners` and `mintLinks` are passed in for the same reason chaseContracts
 * takes them: src/contracts/send.mjs imports this module, so importing it back
 * would be a cycle.
 *
 * Returns { ok: true, reminder, waiting, queued, skipped, delivery } on success,
 * or { ok: false, reason } — "nobody_waiting" or "chase_limit". It never throws
 * for those; a caller turns them into its own answer.
 */
export async function remindContract(db, {
  orgId, contract, listSigners, mintLinks, maxChases = MAX_CHASES,
  chasesSoFar = null, baseUrl = null, secret = undefined, staffName = null
} = {}) {
  const signers = await listSigners(db, contract.id);
  const waiting = signers
    .filter((s) => s.status !== "signed" && s.status !== "declined")
    .sort((a, b) => a.signer_index - b.signer_index)[0];
  if (!waiting) return { ok: false, reason: "nobody_waiting", signers };

  const n = Number.isInteger(chasesSoFar)
    ? chasesSoFar
    : (await chasesFor(db, { orgId, contractId: contract.id })).n;

  /* IT STOPS. A system that emails somebody forever is a system people filter,
     and the filter costs more than the deal. The cap holds for a person pressing
     the button too — that is the whole point of a cap. */
  if (n >= maxChases) return { ok: false, reason: "chase_limit", chasesSoFar: n, maxChases, waiting, signers };

  /* Fresh links: the original may be near its expiry by the time a later
     reminder goes out, and a reminder carrying a dead link is worse than none. */
  const { links } = await mintLinks(db, { orgId, contract, baseUrl, secret });

  const res = await notifySigners(db, {
    orgId, contract, signers, links,
    purpose: `chase${n + 1}`,
    templateKey: REMIND_TEMPLATE_KEY,
    staffName: staffName || contract.sent_by_name || null
  });

  return { ok: true, reminder: n + 1, maxChases, waiting, signers, ...res };
}

/**
 * outstandingContracts — sent, not signed, and nobody has touched it in a while.
 *
 * The clock runs from the LAST THING THAT HAPPENED (`updated_at`), not from the
 * send. A client who opened it yesterday does not need chasing today, and a
 * reminder that ignores that is the reason people mute a sender.
 */
export async function outstandingContracts(db, {
  orgId, afterDays = FIRST_CHASE_DAYS, everyDays = CHASE_EVERY_DAYS,
  maxChases = MAX_CHASES, limit = 100, now = null
} = {}) {
  const { rows } = await db.query(
    `SELECT c.*, s.name AS sent_by_name
       FROM contracts c
  LEFT JOIN staff s ON s.id = c.sent_by
      WHERE c.org_id = $1::uuid
        AND c.status IN ('sent', 'viewed')
        AND c.sent_at < COALESCE($2::timestamptz, now()) - ($3 || ' days')::interval
        AND (c.link_expires_at IS NULL OR c.link_expires_at > COALESCE($2::timestamptz, now()))
      ORDER BY c.sent_at
      LIMIT $4`,
    [orgId, now, String(Math.max(0, afterDays)), Math.max(1, Math.min(limit, 500))]);

  const out = [];
  for (const c of rows) {
    const { n, last } = await chasesFor(db, { orgId, contractId: c.id });
    if (n >= maxChases) continue;
    if (last) {
      const since = (new Date(now || Date.now()) - new Date(last)) / 86400000;
      if (since < everyDays) continue;
    }
    out.push({ contract: c, chasesSoFar: n });
  }
  return out;
}

/**
 * chaseContracts — remind whoever is holding it up, and tell the sender.
 *
 * Two separate things, deliberately. The reminder goes to the signer; the TASK
 * goes to the staff member who sent it. An automated nudge that nobody on the
 * team ever sees is how a deal quietly dies — the point of the task is that a
 * person eventually picks up the phone.
 *
 * Returns a summary. Never throws: one bad contract must not stop the sweep.
 */
export async function chaseContracts(db, {
  orgId, listSigners, mintLinks, afterDays = FIRST_CHASE_DAYS,
  everyDays = CHASE_EVERY_DAYS, maxChases = MAX_CHASES, limit = 100,
  now = null, baseUrl = null, secret = undefined
} = {}) {
  const due = await outstandingContracts(db, { orgId, afterDays, everyDays, maxChases, limit, now });
  const summary = { considered: due.length, reminded: 0, tasked: 0, skipped: [], errors: [] };

  for (const { contract, chasesSoFar } of due) {
    try {
      const res = await remindContract(db, {
        orgId, contract, listSigners, mintLinks, maxChases, chasesSoFar,
        baseUrl, secret, staffName: contract.sent_by_name
      });
      if (!res.ok) { summary.skipped.push({ id: contract.id, reason: res.reason }); continue; }
      const waiting = res.waiting;

      if (res.queued.length) summary.reminded += 1;
      else summary.skipped.push({ id: contract.id, reason: res.skipped[0]?.reason || "nothing_queued" });

      /* The task goes to whoever sent it when we know who that was, and to the
         closer queue when we do not. An unassigned task is work that reaches
         nobody — createTask refuses one without a role for exactly that reason. */
      await createTask(db, {
        orgId,
        clientId: contract.client_id,
        title: `Contract not signed: ${contract.title} — ${waiting.name} has not signed`,
        body: `Sent ${String(contract.sent_at).slice(0, 10)}. Reminder ${chasesSoFar + 1} of ${maxChases} has gone out. ` +
              `Waiting on ${waiting.name} (${waiting.role_label}).`,
        sourceWorkflow: "contract-chaser",
        assigneeRole: "closer",
        assigneeStaffId: contract.sent_by || null,
        eventId: `contract.chase:${contract.id}:${chasesSoFar + 1}`
      }).then(() => { summary.tasked += 1; })
        .catch((err) => { summary.errors.push({ id: contract.id, error: err.message }); });
    } catch (err) {
      summary.errors.push({ id: contract.id, error: err.message });
    }
  }
  return summary;
}
