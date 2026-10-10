// The ONE place that starts the Repair letter writer for a client.
//
// WHY IT EXISTS. Two doors start the writer, and they must never drift apart:
//
//   1. repair.docs.complete — the client's ID and proof of address are in
//      (src/repair/handlers.mjs onRepairEvent).
//   2. a dispute authorization is signed — the portal's "Sign to authorize
//      dispute letters" box (api/consent/capture.mjs).
//
// The writer (analyzeAndGenerate in ./analyze.mjs) refuses with
// `no_authorization` until the client has a signed repair agreement or a live
// dispute_authorization consent. When door 1 fires first the client has not
// signed yet, so the writer refuses, saves nothing, and leaves the card on
// 'analysis'. Nothing used to try again, not even after the client signed.
// Door 2 is that retry: whichever paper lands LAST starts the letters.
//
// Order does not matter. Door 2 only acts on a card that is sitting on
// 'analysis'. A client who signs before the documents arrive is not on
// 'analysis' yet, so door 2 does nothing, and door 1 starts the letters when
// the documents land.
//
// IT MAILS NOTHING AND EMAILS THE CLIENT NOTHING. Making letters writes rows.
// Mailing them stays a separate staff click (src/repair/send.mjs).
//
// SAFE TO CALL TWICE. analyzeAndGenerate answers `already_generated` and writes
// nothing when the round already has letters. The writer's refusal reasons are
// left exactly as they are; this file only calls it.
//
// IT NEVER THROWS. A failure in the writer comes back as { ok:false, reason }.
// The caller in api/consent/capture.mjs has already saved the signature, and a
// writer that breaks must not undo or hide that.

import { readRepairStage } from "./pipeline.mjs";

/** The stage a card waits on when the writer has been asked and has not yet made letters. */
export const LETTER_WAIT_STAGE = "analysis";

/**
 * Run the letter writer for round R1. Same call both doors make.
 *
 * @param {object} db
 * @param {{ orgId: string, clientId: string, staffId?: string|null, round?: string }} opts
 * @param {{ analyzeAndGenerate?: Function, storeFromEnv?: Function }} [deps]
 *        Test seam. Left out, the real writer and the real document store load.
 * @returns {Promise<object>} the writer's answer, or { ok:false, reason } on a throw
 */
export async function startRepairLetters(db, { orgId, clientId, staffId = null, round = "R1" } = {}, deps = {}) {
  try {
    const analyzeAndGenerate = deps.analyzeAndGenerate
      || (await import("./analyze.mjs")).analyzeAndGenerate;
    const storeFromEnv = deps.storeFromEnv
      || (await import("../documents/store.mjs")).storeFromEnv;
    return await analyzeAndGenerate(db, {
      orgId,
      clientId,
      round,
      staffId,
      documentStore: storeFromEnv()
    });
  } catch (err) {
    return { ok: false, reason: String(err?.message || err).slice(0, 240) };
  }
}

/**
 * A dispute authorization was just stored. If this client's repair card is
 * waiting on 'analysis', run the writer now.
 *
 * Does nothing for a client with no repair card, or a card on any other stage.
 * Never throws.
 *
 * @param {object} db
 * @param {{ orgId: string, clientId: string, staffId?: string|null }} opts
 * @param {{ readRepairStage?: Function, analyzeAndGenerate?: Function, storeFromEnv?: Function }} [deps]
 * @returns {Promise<{ started: boolean, reason?: string, stage?: string|null, letters?: object }>}
 */
export async function startLettersAfterAuthorization(db, { orgId, clientId, staffId = null } = {}, deps = {}) {
  try {
    if (!db?.query || !orgId || !clientId) return { started: false, reason: "missing_ids" };

    const stage = await (deps.readRepairStage || readRepairStage)(db, { orgId, clientId });
    if (stage !== LETTER_WAIT_STAGE) {
      return { started: false, reason: "card_not_waiting_on_letters", stage };
    }

    const letters = await startRepairLetters(db, { orgId, clientId, staffId }, deps);
    if (!letters?.ok) {
      console.warn("[repair] letters not made after authorization:", letters?.reason || "unknown");
    }
    return { started: true, letters };
  } catch (err) {
    console.warn("[repair] letters after authorization failed:", err && err.message);
    return { started: false, reason: String(err?.message || err).slice(0, 240) };
  }
}
