// Tracks outbound Bland AI calls so the completed-call webhook can resolve
// callId → clientId (Bland's payload has no clientId on completion).

/**
 * Record a dispatched call. Idempotent: duplicate call_id is silently ignored.
 * @param {{ callId: string, clientId: string, orgId: string, kind: string, db: object }} opts
 */
export async function recordDispatch({ callId, clientId, orgId, kind, db }) {
  await db.query(
    `INSERT INTO outbound_calls (call_id, client_id, org_id, kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (call_id) DO NOTHING`,
    [callId, clientId, orgId, kind]
  );
}

/**
 * Look up the clientId for a Bland call by callId.
 * Returns null when not found.
 * @param {string} callId
 * @param {object} db
 * @returns {Promise<string|null>}
 */
export async function resolveClientByCallId(callId, db) {
  const res = await db.query(
    `SELECT client_id FROM outbound_calls WHERE call_id = $1`,
    [callId]
  );
  return res.rows[0]?.client_id ?? null;
}

/** Resolve both sides of the stored dispatch. Never infer a company from a
 * provider payload or accept a client that no longer belongs to that company. */
export async function resolveDispatchByCallId(callId, db) {
  if (!callId) return null;
  const res = await db.query(
    `SELECT oc.client_id, oc.org_id
       FROM outbound_calls oc
       JOIN clients c ON c.id = oc.client_id AND c.org_id = oc.org_id
      WHERE oc.call_id = $1
      LIMIT 1`,
    [callId]
  );
  const row = res.rows[0];
  return row?.client_id && row?.org_id ? { clientId: row.client_id, orgId: row.org_id } : null;
}

export function completedCallBody(payload = {}) {
  const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
  const summary = text(payload.summary);
  const transcript = text(payload.transcript);
  const recording = text(payload.recordingUrl);
  return [summary ? `Call summary: ${summary}` : null,
    transcript ? `Call transcript:\n${transcript}` : null,
    recording ? `Recording: ${recording}` : null].filter(Boolean).join("\n\n") || payload.disposition || null;
}

/** A richer retry may add the call's words without firing call workflows again.
 * Only an existing Bland voice row for the verified dispatch may be changed. */
export async function enrichCompletedCallTranscript(db, { orgId, clientId, callId, payload } = {}) {
  if (!orgId || !clientId || !callId || typeof payload?.transcript !== "string" || !payload.transcript.trim()) {
    return { updated: false };
  }
  const { rows } = await db.query(
    `UPDATE messages SET rendered_body = $4
      WHERE org_id = $1 AND client_id = $2 AND provider_ref = $3
        AND provider = 'bland' AND channel = 'voice'
        AND rendered_body IS DISTINCT FROM $4
      RETURNING id`,
    [orgId, clientId, callId, completedCallBody(payload)]
  );
  return { updated: rows.length > 0 };
}
