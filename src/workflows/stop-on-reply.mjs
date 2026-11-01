// Stop on reply — the check S-NOBOOK and AI-SET-03 make before each text.
// Owner-set 2026-10-31 (funnel workflows fix).
//
// A person who answers one of our texts or emails has started a conversation.
// The next scheduled "you have not booked yet" must not land on top of it, so a
// chase stops the moment a message.inbound arrives for the person.
//
// "After the run started" is read from the run's own trigger event. That event
// is a row in `events` with a fixed created_at, so the answer is the same on
// every replay of the run. A clock read inside a workflow would move each time
// the engine wakes it.
//
// Two shapes of inbound event are in the table, and both count:
//   - an email reply is saved with the person on it (events.client_id);
//   - a text reply is saved with NO person. The Twilio adapter emits
//     message.inbound with the sender's number in payload.from and leaves
//     client_id empty (src/adapters/twilio.mjs); src/handlers/comms.mjs finds
//     the person afterwards, for the message row only. So a text is matched the
//     way hasBooked matches a historical booking: same company, last ten digits
//     of the number. A short or missing phone never matches by accident.
//   An email from an address that fits no single person is filed unthreaded on
//   purpose (src/adapters/mailgun.mjs), on nobody, so it is not matched here.

export const HAS_REPLIED_SQL = `
WITH me AS (
  SELECT org_id, phone FROM clients WHERE id = $1
), started AS (
  SELECT ev.created_at FROM events ev, me WHERE ev.id = $2 AND ev.org_id = me.org_id
)
SELECT 1 AS replied
  FROM events e, me, started s
 WHERE e.org_id = me.org_id
   AND e.name = 'message.inbound'
   AND e.created_at > s.created_at
   AND (
        e.client_id = $1
     OR (e.client_id IS NULL
         AND COALESCE(e.payload->>'channel', 'sms') = 'sms'
         AND length(regexp_replace(COALESCE(me.phone, ''), '\\D', '', 'g')) >= 10
         AND right(regexp_replace(COALESCE(e.payload->>'from', ''), '\\D', '', 'g'), 10)
           = right(regexp_replace(me.phone, '\\D', '', 'g'), 10))
   )
 LIMIT 1`.trim();

/* hasReplied — has this person answered us since the run began?
   clientId is the person; eventId is the id of the event that started the run
   (the events row, not a workflow-engine id). No eventId or no row for it means
   the start is unknown, and unknown counts as "no reply yet". */
export async function hasReplied(db, { clientId, eventId }) {
  if (!clientId || !eventId) return false;
  const r = await db.query(HAS_REPLIED_SQL, [clientId, eventId]);
  return r.rows.length > 0;
}
