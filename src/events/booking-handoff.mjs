// Booking-created handoff tickets only. No historical discovery or general DLQ drain.
import { inngest } from "../workflows/client.mjs";

export const HANDLER = "booking-created-inngest-v1";
export const CUTOVER_AT = "2026-11-03T00:36:56.000Z";
export const MAX_AGE_MS = 15 * 60_000;
export const LEASE_MS = 60_000;
export const WAIT_MS = 2_000;
export const MAX_BATCH = 4;

// pg returns timestamptz as Date. Date.parse(Date) stringifies it first and
// loses milliseconds; keep the exact JS instant for SQL timestamps.
const timestamp = (value) => value instanceof Date ? value.getTime() : Date.parse(value);

export function ticketEligible(name, payload = {}, opts = {}, now = Date.now()) {
  const start = Date.parse(payload.startTime || payload.start_time || "");
  return name === "booking.created" && opts.skipInngest !== true && opts.isDemo !== true &&
    ![payload.simulated, payload.synthetic].some((v) => ["true","1"].includes(String(v).toLowerCase())) &&
    Number.isFinite(start) && start > Number(now);
}

// One statement: a ticket failure rolls back the new event too. On an event
// conflict, neither a ticket nor an old event is created/replayed.
export const INSERT_SQL = `WITH saved AS (
  INSERT INTO events (org_id,name,version,idempotency_key,client_id,payload)
  VALUES ($1,$2,$3,$4,$5,$6)
  ON CONFLICT (org_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id,org_id,name,version,client_id,created_at
), ticket AS (
  INSERT INTO failed_events
    (org_id,event_id,event_name,event_version,client_id,payload,handler_name,
     error_message,error_code,status,attempts,max_attempts,first_seen_at,last_seen_at,next_attempt_at)
  SELECT org_id,id,name,version,client_id,'{"booking_handoff_version":1}'::jsonb,
    '${HANDLER}','Awaiting booking workflow acknowledgement','booking_handoff_queued',
    'pending',1,7,created_at,created_at,created_at FROM saved
  RETURNING event_id
) SELECT saved.id FROM saved JOIN ticket ON ticket.event_id=saved.id`;

export const CLAIM_SQL = `UPDATE failed_events q SET
  next_attempt_at=$3::timestamptz+interval '1 minute',last_seen_at=$3,
  attempts=CASE WHEN error_code='booking_handoff_queued' THEN attempts ELSE attempts+1 END,
  error_code='booking_handoff_attempting',error_message='Booking handoff acknowledgement pending'
 WHERE q.org_id=$1 AND q.event_id=$2 AND q.handler_name='${HANDLER}'
   AND q.event_name='booking.created' AND q.payload->>'booking_handoff_version'='1'
   AND q.created_at>='${CUTOVER_AT}'::timestamptz
   AND q.status='pending' AND q.next_attempt_at<=$3::timestamptz
 RETURNING q.id,q.org_id,q.event_id,q.next_attempt_at AS lease_at,q.attempts,q.max_attempts`;

export const EVENT_SQL = `SELECT e.id,e.org_id,e.name,e.version,e.client_id,e.payload,e.created_at,
  c.id AS owned_client_id,COALESCE(c.is_demo,false) AS client_is_demo
 FROM events e
 LEFT JOIN clients c ON c.org_id=e.org_id AND c.id=COALESCE(e.client_id,
   (SELECT cc.id FROM clients cc WHERE cc.org_id=e.org_id
      AND lower(cc.email)=lower(btrim(COALESCE(e.payload->>'email',''))) LIMIT 1))
 WHERE e.org_id=$1 AND e.id=$2 AND e.name='booking.created'
   AND COALESCE(e.is_demo,false)=false AND e.created_at>='${CUTOVER_AT}'::timestamptz`;

// Read the authoritative booking saved by the local handler. A source event
// alone cannot authorize a send to a foreign, cancelled or moved appointment.
export const BOOKING_SQL = `SELECT b.status,b.starts_at,b.client_id
 FROM bookings b WHERE b.org_id=$1 AND b.client_id=$2
   AND (b.raw->>'__event_id'=$3::text
     OR (NULLIF(btrim($4::text),'') IS NOT NULL AND b.provider_uid=btrim($4::text)))
 ORDER BY b.updated_at DESC,b.id LIMIT 2`;

export const SETTLE_SQL = `UPDATE failed_events SET status=$4,
  resolved_at=CASE WHEN $4 IN ('resolved','ignored') THEN $5::timestamptz ELSE NULL END,
  resolution_note=CASE WHEN $4 IN ('resolved','ignored') THEN $6 ELSE resolution_note END,
  next_attempt_at=CASE WHEN $4='pending' THEN next_attempt_at ELSE NULL END,
  error_code=$7,error_message=$6,updated_at=$5
 WHERE id=$1 AND org_id=$2 AND handler_name='${HANDLER}'
   AND status='pending' AND next_attempt_at=$3::timestamptz RETURNING id`;

export const DUE_SQL = `SELECT org_id,event_id FROM failed_events
 WHERE handler_name='${HANDLER}' AND event_name='booking.created'
   AND payload->>'booking_handoff_version'='1'
   AND created_at>='${CUTOVER_AT}'::timestamptz
   AND status='pending' AND next_attempt_at<=$1::timestamptz
 ORDER BY next_attempt_at,id LIMIT $2`;

export const EXHAUSTED_SQL = `SELECT count(*)::int AS n FROM failed_events
 WHERE handler_name='${HANDLER}' AND created_at>='${CUTOVER_AT}'::timestamptz
   AND status='exhausted'`;

export function providerEvent(event) {
  return {
    id: `fundhub:booking.created:${event.org_id}:${event.id}`,
    name: "booking.created",
    data: { id: event.id, payload: event.payload, orgId: event.org_id, clientId: event.client_id }
  };
}

export function validAck(value) {
  return Array.isArray(value?.ids) && value.ids.length === 1 &&
    typeof value.ids[0] === "string" && value.ids[0].trim().length > 0 && value.ids[0].length <= 128;
}

async function settle(db, claim, status, code, note, now) {
  const r = await db.query(SETTLE_SQL, [claim.id, claim.org_id, claim.lease_at, status,
    new Date(now).toISOString(), note, code]);
  return r.rows.length > 0;
}

export async function attemptBookingHandoff(db, { orgId, eventId }, {
  now = () => Date.now(), sendEvent = (event) => inngest.send(event),
  hasEventKey = () => Boolean(process.env.INNGEST_EVENT_KEY), waitMs = WAIT_MS
} = {}) {
  const at = Number(now());
  const claim = (await db.query(CLAIM_SQL, [orgId,eventId,new Date(at).toISOString()])).rows[0];
  if (!claim) return { outcome: "unclaimed" };
  const finish = (status, code, note) => settle(db,claim,status,code,note,now());
  const event = (await db.query(EVENT_SQL,[orgId,eventId])).rows[0];
  if (!event || !event.owned_client_id || event.client_is_demo) {
    await finish("exhausted","booking_scope_invalid","Booking source/client scope is unavailable");
    return { outcome: "exhausted" };
  }
  const age = at-timestamp(event.created_at);
  const start = Date.parse(event.payload?.startTime || event.payload?.start_time || "");
  if (!Number.isFinite(age) || age<0 || age>=MAX_AGE_MS || claim.attempts>claim.max_attempts ||
      !Number.isFinite(start) || start<=at) {
    await finish("exhausted","booking_handoff_expired","Booking handoff expired; no automatic historical send");
    return { outcome: "exhausted" };
  }
  const bookings = (await db.query(BOOKING_SQL,[orgId,event.owned_client_id,String(eventId),
    event.payload?.bookingUid || event.payload?.booking_uid || null])).rows;
  if (bookings.length===0) {
    await finish("pending","booking_record_pending","Awaiting the authoritative booking record");
    return { outcome: "pending" };
  }
  if (bookings.length!==1 || String(bookings[0].client_id)!==String(event.owned_client_id)) {
    await finish("exhausted","booking_identity_ambiguous","Booking identity is ambiguous");
    return { outcome: "exhausted" };
  }
  if (bookings[0].status!=="booked" || timestamp(bookings[0].starts_at)!==start) {
    await finish("ignored","booking_no_longer_current","Booking was moved or is no longer active");
    return { outcome: "ignored" };
  }
  if (!hasEventKey()) {
    await finish("pending","booking_key_missing","Booking workflow credentials are unavailable");
    return { outcome: "pending" };
  }

  // This is a bounded WAIT, not cancellation of the SDK request. Unknown
  // outcomes stay pending. Late ACK/error writes compare the same lease, so
  // an old request cannot overwrite a newer owner. Every attempt uses the
  // same provider event ID, and retries stop far inside its 24-hour window.
  const pending = Promise.resolve().then(async () => {
    // Database/key reads may have taken long enough to cross the appointment,
    // age or ownership boundary. Check again at the actual provider boundary.
    const sentAt=Number(now());
    const leaseEndsAt=timestamp(claim.lease_at);
    if (!Number.isFinite(sentAt) || !Number.isFinite(leaseEndsAt) || sentAt>=leaseEndsAt) return { staleLease: true };
    if (sentAt>=start || sentAt-timestamp(event.created_at)>=MAX_AGE_MS || sentAt<at) {
      await finish("exhausted","booking_handoff_expired","Booking handoff expired before provider submission");
      return { expired: true };
    }
    return sendEvent(providerEvent(event));
  }).then(async (ack) => {
    if (ack?.staleLease) return { outcome: "lease_changed" };
    if (ack?.expired) return { outcome: "exhausted" };
    if (!validAck(ack)) {
      await finish("pending","booking_ack_unknown","Provider returned no usable acknowledgement");
      return { outcome: "pending" };
    }
    const written = await finish("resolved","booking_handoff_accepted",`Inngest accepted booking event: ${ack.ids[0]}`);
    return { outcome: written ? "accepted" : "lease_changed" };
  }).catch(async () => {
    await finish("pending","booking_ack_unknown","Provider acceptance is unknown; retry uses the same event ID").catch(() => null);
    return { outcome: "pending" };
  });
  let timer;
  const deadline = new Promise((resolve) => { timer=setTimeout(() => resolve({ outcome: "pending" }),Math.max(1,waitMs)); });
  try { return await Promise.race([pending,deadline]); }
  finally { clearTimeout(timer); }
}

export function startBookingHandoff(db, event, options) {
  // Called only after the atomic event+ticket write and local dispatch. The
  // HTTP response does not wait for Inngest; the durable ticket is the backstop.
  void attemptBookingHandoff(db,event,options).catch(() => {});
}

export async function sweepBookingHandoffs(db, options = {}) {
  const at = options.now ? Number(options.now()) : Date.now();
  const rows = (await db.query(DUE_SQL,[new Date(at).toISOString(),MAX_BATCH])).rows;
  const result = { scanned: rows.length, accepted: 0, pending: 0, exhausted: 0, ignored: 0, errors: 0 };
  for (const row of rows) {
    try {
      const r = await attemptBookingHandoff(db,{orgId:row.org_id,eventId:row.event_id},options);
      if (Object.hasOwn(result,r.outcome)) result[r.outcome]++;
    } catch { result.errors++; }
  }
  const outstanding = (await db.query(EXHAUSTED_SQL)).rows[0];
  if (!outstanding || !Number.isInteger(Number(outstanding.n)) || Number(outstanding.n)<0) {
    throw new Error("Booking handoff exhausted count is unreadable");
  }
  result.exhausted = Math.max(result.exhausted,Number(outstanding.n));
  return result;
}
