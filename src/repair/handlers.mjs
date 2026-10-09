// Event handlers for repair.* — move cards; never invent specialist review.
// Also queue the matching repair email (email only — owner §2.4).

import { moveRepairCard, stallRepairCard, readRepairStage, EVENT_STAGE } from "./pipeline.mjs";
import { canLeaveIntake } from "./croa.mjs";
import { isBreached } from "./sla.mjs";
import { logDecision } from "../metro2/rounds/store.mjs";
import { notifyRepairEmail } from "./notify.mjs";
import { requestFreshReassessment } from "../crs/snapshot-negatives.mjs";
import { emit } from "../events/bus.mjs";
import { checkDocPacket, loadClientDocuments, PACKET_SUBTYPES } from "../inquiry-ops/doc-gate.mjs";
import { onRepairPath } from "./on-repair-path.mjs";
import { startRepairLetters } from "./start-letters.mjs";

/* ── THE "WE NEED YOUR DOCUMENTS" STAGE ──────────────────────────────────────
 *
 * pipeline.mjs has had awaiting_documents since it was written, portal.mjs has
 * had the client copy ("Upload your ID and proof of address to continue"),
 * sla.mjs has had the 14-day chase, and this file has had branches for both
 * repair.docs.needed and repair.docs.complete. NOTHING EMITTED EITHER EVENT, so
 * no repair client has ever reached that stage: enrollment parked them on
 * intake and left them there. These two functions are the missing emitter.
 *
 * The "have the documents arrived" question is NOT answered here. It is
 * answered by checkDocPacket() in src/inquiry-ops/doc-gate.mjs, imported, not
 * copied — one implementation, one answer.
 *
 * WHY present.* AND NOT complete. checkDocPacket().complete also requires the
 * signed authorization, which is its own gate on its own timeline. This stage
 * is only about the two images the document agent reads: the government photo
 * ID and the proof of address. So we read its `present` flags and leave
 * `complete` to the callers that mail letters.
 */
export const IDENTITY_DOC_SUBTYPES = Object.freeze([
  PACKET_SUBTYPES.ID,
  PACKET_SUBTYPES.PROOF_OF_ADDRESS
]);

/** The two identity documents, or NULL when the documents could not be read.
 *  Null is unknown and must stay unknown — a database that will not answer
 *  must never be reported to a client as "you have not sent your ID". */
export async function identityDocsOnFile(db, { orgId, clientId } = {}) {
  if (!db?.query || !orgId || !clientId) return null;
  let docs;
  try {
    docs = await loadClientDocuments(db, { orgId, clientId });
  } catch (err) {
    console.warn("[repair] identity document read failed:", err && err.message);
    return null;
  }
  const packet = checkDocPacket(docs);
  const missing = [];
  if (!packet.present.id_document) missing.push(PACKET_SUBTYPES.ID);
  if (!packet.present.proof_of_address) missing.push(PACKET_SUBTYPES.PROOF_OF_ADDRESS);
  return { present: packet.present, missing, complete: missing.length === 0 };
}

/**
 * Emit repair.docs.needed / repair.docs.complete for this client.
 *
 * Idempotency key is one per client per event name, so the double dispatch that
 * enrollment produces (bus dispatch + the direct onRepairEvent call in
 * enroll.mjs) records and acts exactly once.
 *
 * The card move: emit() dispatches to registered handlers, and onRepairEvent is
 * registered for both names by register.mjs. In a context that never loaded the
 * registry — a script, a worker, a unit test — nothing is dispatched, so the
 * handler is called directly instead. Deduped events do neither: they were
 * already handled the first time.
 */
export async function announceRepairDocState(db, {
  orgId,
  clientId,
  payload = {},
  state = null,
  emitImpl = emit
} = {}) {
  if (!db?.query || !orgId || !clientId) return { emitted: false, reason: "missing_ids" };
  const docs = state || await identityDocsOnFile(db, { orgId, clientId });
  if (!docs) return { emitted: false, reason: "documents_unreadable" };

  const name = docs.complete ? "repair.docs.complete" : "repair.docs.needed";
  const idempotencyKey = `${name}:${orgId}:${clientId}`;
  const body = {
    source: "repair_doc_state",
    present: docs.present,
    missing: docs.missing,
    /* Carried in the payload so notify.mjs's eventIdFor() keys the email on it.
       Both runs below hand it the same string, so the second one queues nothing. */
    idempotencyKey,
    ...payload
  };
  const recorded = await emitImpl(db, name, body, { orgId, clientId, idempotencyKey })
    .catch((err) => ({ id: null, deduped: false, error: String(err?.message || err) }));

  /* THE CARD MOVE, AND WHY A DEDUPED EVENT STILL MOVES IT.
     enroll.mjs runs repair.enrolled TWICE on purpose (bus dispatch, then a
     direct call for contexts with no registry). The second run moves the card
     back to intake. If a deduped docs event did nothing, the client would be
     left parked on intake with a repair.docs.needed row saying otherwise — the
     exact silence this whole fix is closing. moveRepairCard is an UPDATE and
     the email is keyed above, so re-asserting the stage costs nothing.
     Skipped only when handlers already ran in THIS call, or the emit failed. */
  let handled = null;
  if (!recorded?.error && !(recorded?.dispatched?.handlers > 0)) {
    handled = await onRepairEvent(db, { name, orgId, clientId, payload: body });
  }
  return { emitted: true, name, missing: docs.missing, recorded, handled };
}

/**
 * docs.received → does this repair client now have both identity documents?
 *
 * Registered on the bus by register.mjs. Three guards, all of them refusals:
 *   - not on the repair path        → an upload from a funding-only client must
 *                                     not touch an optimization card
 *   - card is not waiting on docs   → a round-5 client texting a bureau letter
 *                                     must never be dragged back to analysis
 *   - documents unreadable          → unknown stays unknown, nothing is emitted
 */
export async function onRepairDocsReceived(event, db) {
  const orgId = event?.orgId || event?.payload?.org_id || event?.payload?.orgId;
  const clientId = event?.clientId || event?.payload?.client_id || event?.payload?.clientId;
  if (!db?.query || !orgId || !clientId) return { done: false, reason: "missing_ids" };

  const repairClient = await onRepairPath(db, { orgId, clientId }).catch(() => false);
  if (!repairClient) return { done: false, reason: "not_repair_path" };

  const stage = await readRepairStage(db, { orgId, clientId });
  if (stage !== "intake" && stage !== "awaiting_documents") {
    return { done: false, reason: "stage_not_waiting_on_documents", stage };
  }

  const state = await identityDocsOnFile(db, { orgId, clientId });
  if (!state) return { done: false, reason: "documents_unreadable" };
  if (!state.complete) return { done: false, reason: "identity_incomplete", missing: state.missing };

  const res = await announceRepairDocState(db, {
    orgId,
    clientId,
    state,
    payload: { source: "docs.received", documentId: event?.payload?.document_id || null }
  });
  return { done: res.emitted === true, ...res };
}

export async function onRepairEvent(db, event) {
  const name = event?.name || event?.type;
  const orgId = event.orgId || event.payload?.orgId;
  const clientId = event.clientId || event.payload?.clientId;
  if (!name || !orgId || !clientId) return { ok: false, reason: "missing_ids" };

  // Retake is email-only — do not move the optimization card.
  if (name === "repair.response.retake") {
    const email = await notifyRepairEmail(db, {
      name,
      orgId,
      clientId,
      payload: event.payload || {}
    }).catch((err) => ({ sent: false, reason: String(err?.message || err) }));
    if (db?.query) {
      await logDecision(db, {
        orgId, clientId, caseId: event.payload?.caseId,
        decision: name,
        payload: event.payload || {}
      }).catch(() => {});
    }
    return { ok: true, emailOnly: true, email };
  }

  if (name === "repair.docs.needed") {
    // May only leave intake after CROA window if coming from intake enrollment path
    const gate = canLeaveIntake({
      enrolledAt: event.payload?.enrolledAt,
      asOf: event.payload?.asOf,
      contract: event.payload?.contract
    });
    if (event.payload?.fromIntake && !gate.ok) {
      return { ok: false, reason: gate.reason, gate };
    }
  }

  const stageKey = EVENT_STAGE[name];
  if (!stageKey) return { ok: false, reason: "unknown_event" };

  if (stageKey === "stalled" || name === "repair.stalled" || name === "repair.analysis.empty") {
    const r = await stallRepairCard(db, { orgId, clientId, reason: event.payload?.reason || name });
    if (db?.query) {
      await logDecision(db, {
        orgId, clientId, caseId: event.payload?.caseId,
        decision: name,
        payload: event.payload || {}
      }).catch(() => {});
    }
    const email = await notifyRepairEmail(db, {
      name,
      orgId,
      clientId,
      payload: event.payload || {}
    }).catch((err) => ({ sent: false, reason: String(err?.message || err) }));
    return { ok: true, ...r, email };
  }

  const moved = await moveRepairCard(db, { orgId, clientId, stageKey });
  const email = await notifyRepairEmail(db, {
    name,
    orgId,
    clientId,
    payload: event.payload || {}
  }).catch((err) => ({ sent: false, reason: String(err?.message || err) }));
  /* ENROLLMENT ASKS THE DOCUMENT QUESTION. The card is on intake now; the very
     next thing this client owes us is their ID and proof of address, and until
     this line nothing ever asked whether they had sent them. Best-effort: a
     failure here must not undo an enrollment that is already committed. */
  let docState = null;
  if (name === "repair.enrolled" && moved?.moved) {
    docState = await announceRepairDocState(db, {
      orgId,
      clientId,
      payload: { source: "repair.enrolled", enrolledAt: event.payload?.enrolledAt || null }
    }).catch((err) => ({ emitted: false, reason: String(err?.message || err) }));
  }

  /* LETTERS FROM THE CREDIT-REPAIR BRAIN. docs.complete used to park the card
     on analysis and wait for a human Stage click that nobody pressed, so a
     paid repair file could sit forever with zero letters. The same writer
     Specialist Stage already uses (analyzeAndGenerate) runs here. It mails
     nothing. A refusal (no credit file, ID unread, nothing signed yet) leaves
     the card on analysis. The refusal `no_authorization` is retried by the
     portal signing box once the client signs: api/consent/capture.mjs. */
  let letters = null;
  if (name === "repair.docs.complete") {
    /* ONE SHARED CALL. The portal's signing box starts the same writer through
       the same function (api/consent/capture.mjs), so the two doors cannot
       drift. See ./start-letters.mjs. */
    letters = await startRepairLetters(db, {
      orgId,
      clientId,
      staffId: event.payload?.staffId || null
    });
  }

  let reassess = null;
  if (name === "repair.program.complete") {
    reassess = await requestFreshReassessment(db, {
      orgId,
      clientId,
      eventId: event.id || event.payload?.eventId
    }).catch((err) => ({ ok: false, reason: String(err?.message || err) }));
  }
  return { ok: !!moved?.moved, moved, stageKey, email, reassess, docState, letters };
}

export function evaluateSlaBreach(card) {
  return isBreached({
    stageKey: card.stageKey,
    enteredAt: card.enteredAt,
    asOf: card.asOf,
    responseDueAt: card.responseDueAt
  });
}
