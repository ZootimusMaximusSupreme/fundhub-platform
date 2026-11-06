// A saved funnel track row → its Meta server events (Conversions API).
//
// Contract: the "Phase 4 contract" section of docs/tracking/meta-events.md.
// Called by recordTrack (src/funnel/track.mjs) right after the row is saved.
//
// Same shape as the step-1 ClickFunnels write in api/public/slo-interest.mjs
// (startCfWrite): the answer to the browser never waits on Meta. The job is
// handed to deps.onMetaSend; the door answers first, then waits up to
// META_WAIT_MS so the function host does not freeze the send. The outcome is
// recorded on the same events row as payload.meta with one small UPDATE.
//
// Only reviewed public events are mapped. Match data, when available, comes
// from the sender's own neutral survey session. A contact match is optional.

import { sendMetaEvents, metaCapiEnabled } from "../messaging/providers/meta-capi.mjs";
import { metaEventsFor } from "./map.mjs";
import { buildUserData, isHashed } from "./user-data.mjs";
import { publicContact } from "./public-contact.mjs";

/* One key, so a ClickFunnels or other result written at the same moment is kept. */
export const RECORD_META_SQL = `UPDATE events SET payload = payload || $1::jsonb WHERE id = $2`;

async function record(db, rowId, note) {
  if (!rowId) return;
  try {
    await db.query(RECORD_META_SQL, [{ meta: note }, rowId]);
  } catch (err) {
    console.error("meta: result not recorded —", err?.message || err);
  }
}

const joined = (list, key) => list.map((e) => e[key]).join(",");

/**
 * Start the Meta send for one saved track row, without holding up the answer.
 * Returns the job (a promise that never rejects), or null when nothing goes to
 * Meta. The job resolves to the sender's result (or a skip).
 *
 * @param {object} a
 * @param {object} a.db        events table
 * @param {string} a.orgId
 * @param {string|null} a.rowId the saved events row
 * @param {object} a.payload   the saved row's payload (session_id, seq, event, page,
 *                             props, meta_event_id?, fbc?, fbp?, url?)
 * @param {string} a.actor     "person" | "agent"
 * @param {object} a.deps      env, clientIp, userAgent, now, fetchImpl,
 *                             sendMeta (stand-in sender), onMetaSend
 */
export function startMetaSend({ db, orgId, rowId, payload, actor, deps = {} }) {
  const env = deps.env || process.env;
  if (actor !== "person") return null;
  if (!metaCapiEnabled(env)) return null;
  const candidates = metaEventsFor(payload);
  if (!candidates.length) return null;

  const job = (async () => {
    const at = deps.now instanceof Date ? deps.now : new Date();
    const list = candidates;
    try {
      const conversion = list.some(event => event.event_name === "Lead" || event.event_name === "Schedule");
      const contact = conversion ? await (deps.publicContact || publicContact)(db, orgId, payload.session_id).catch(() => null) : null;
      if (contact?.actor === "agent") {
        const out = { ok: true, sent: 0, skipped: "agent_session" };
        await record(db, rowId, {
          sent: 0, skipped: out.skipped, event_name: joined(list, "event_name"),
          event_id: joined(list, "event_id"), at: at.toISOString()
        });
        return out;
      }

      const userData = buildUserData({
        ip: deps.clientIp,
        userAgent: deps.userAgent,
        fbp: payload.fbp
      });
      if (isHashed(contact?.emailHash)) userData.em = [contact.emailHash];
      if (isHashed(contact?.phoneHash)) userData.ph = [contact.phoneHash];
      const eventTime = Math.floor(at.getTime() / 1000);
      const events = list.map((e) => {
        const ev = {
          event_name: e.event_name,
          event_time: eventTime,
          event_id: e.event_id,
          event_source_url: e.event_source_url,
          action_source: "website",
          user_data: userData
        };
        if (contact?.clientId) ev.matchedClientId = contact.clientId;
        return ev;
      });

      let out;
      try {
        out = await (deps.sendMeta || sendMetaEvents)(events, { env, db, fetchImpl: deps.fetchImpl });
      } catch (err) {
        out = { ok: false, sent: 0, error: String(err?.message || err).slice(0, 300) };
      }
      const note = {
        sent: Number(out?.sent) || 0,
        event_name: joined(list, "event_name"),
        event_id: joined(list, "event_id"),
        at: at.toISOString()
      };
      if (out?.skipped) note.skipped = out.skipped;
      if (out?.error) note.error = String(out.error).slice(0, 300);
      await record(db, rowId, note);
      return out;
    } catch (err) {
      console.error("meta: send job failed —", err?.message || err);
      return { ok: false, sent: 0, error: "meta_job_threw" };
    }
  })();
  if (typeof deps.onMetaSend === "function") deps.onMetaSend(job);
  return job;
}
