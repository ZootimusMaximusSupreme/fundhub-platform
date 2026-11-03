// A logged no-answer call starts AI-SET-03. Once the setter has called, that
// cadence owns the next customer texts; survey SMS should step aside.
export const HAS_NO_ANSWER_SQL = `
WITH started AS (
  SELECT org_id, created_at FROM events WHERE id = $2
)
SELECT 1 AS no_answer
  FROM events e, started s
 WHERE e.org_id = s.org_id
   AND e.client_id = $1
   AND e.created_at >= s.created_at - ($3::int * INTERVAL '1 hour')
   AND (
        e.name = 'setter.no_answer'
     OR (e.name = 'call.completed'
         AND e.payload->>'disposition' IN ('no_answer', 'no-answer', 'voicemail'))
   )
 LIMIT 1`.trim();

export async function hasSetterNoAnswer(db, { clientId, eventId, lookbackHours = 0 }) {
  if (!clientId || !eventId) return false;
  const result = await db.query(HAS_NO_ANSWER_SQL, [clientId, eventId, lookbackHours]);
  return result.rows.length > 0;
}
