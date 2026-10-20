// Event bus — Master Rebuild Spec §4 + §16 (replay harness).
// Append-only writes to the `events` table (Rule 9: id + integer version + safe
// replay). Every adapter writes here first, then handlers react.
//
// Dependency-injected `db` ({ query(sql, params) }) so it unit-tests without a
// live Postgres and runs against `pg` in prod.

import { isCanonical } from "./canonical.mjs";
import { getHandlers } from "./registry.mjs";
import { inngest } from "../workflows/client.mjs";
import { record as recordFailure, handlerName } from "./dead-letter.mjs";

const DEFAULT_ORG = process.env.DEFAULT_ORG_SLUG || "fundhub";

// emit — append an event, dispatch to handlers. Idempotent by idempotency_key.
// Returns { id, deduped }.
export async function emit(db, name, payload = {}, opts = {}) {
  if (!name || typeof name !== "string") throw new Error("event name required");
  if (!isCanonical(name) && !opts.allowNonCanonical) {
    throw new Error(`unknown event "${name}" (pass allowNonCanonical to extend)`);
  }
  const version = Number.isInteger(opts.version) ? opts.version : 1;
  const orgId = opts.orgId || (await resolveDefaultOrg(db));
  const idem = opts.idempotencyKey || null;

  // Idempotent insert: ON CONFLICT (org_id, idempotency_key) DO NOTHING.
  const insert = await db.query(
    `INSERT INTO events (org_id, name, version, idempotency_key, client_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [orgId, name, version, idem, opts.clientId || null, payload]
  );

  if (insert.rows.length === 0 && idem) {
    // already processed — safe no-op
    return { id: null, deduped: true };
  }
  const id = insert.rows[0].id;
  const dispatched = await dispatch(
    db,
    { id, name, version, orgId, clientId: opts.clientId || null, payload },
    { throwOnHandlerError: opts.throwOnHandlerError === true }
  );
  // Do not await Inngest — it added multi-second latency to website survey
  // submit and webhook responses. Event row + local handlers already ran;
  // Inngest fan-out is best-effort and must not block the HTTP response.
  if (process.env.INNGEST_EVENT_KEY && opts.skipInngest !== true) {
    void inngest
      .send({ name, data: { id, payload, orgId, clientId: opts.clientId || null } })
      .catch(() => {});
  }
  return { id, deduped: false, dispatched };
}

// replay — re-dispatch stored events (by name and/or since a timestamp).
// Used by the V1 replay validator to assert on Postgres after a merge.
export async function replay(db, filter = {}) {
  const clauses = [];
  const params = [];
  if (filter.name) { params.push(filter.name); clauses.push(`name = $${params.length}`); }
  if (filter.since) { params.push(filter.since); clauses.push(`created_at >= $${params.length}`); }
  if (filter.orgId) { params.push(filter.orgId); clauses.push(`org_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await db.query(
    `SELECT id, name, version, org_id, client_id, payload FROM events ${where} ORDER BY created_at ASC`,
    params
  )).rows;
  let dispatched = 0;
  for (const r of rows) {
    const amt = r.payload && r.payload.amount != null ? Number(r.payload.amount) : null;
    // Skip adversarial / typo'd absurd amounts so a morning replay job does not
    // die on a known-poison event left in the log.
    if (amt != null && Number.isFinite(amt) && Math.abs(amt) >= 1_000_000_000) {
      console.warn(`[bus] replay skip ${r.name} id=${r.id}: amount out of range (${amt})`);
      continue;
    }
    // The replay validator wants a failing handler to be loud, not absorbed
    // into the queue, so replay keeps the original throw-through behaviour
    // unless the caller asks otherwise.
    await dispatch(
      db,
      { id: r.id, name: r.name, version: r.version, orgId: r.org_id, clientId: r.client_id, payload: r.payload },
      { throwOnHandlerError: filter.throwOnHandlerError !== false }
    );
    await db.query(`UPDATE events SET replayed_at = now() WHERE id = $1`, [r.id]);
    dispatched += 1;
  }
  return { dispatched };
}

/* dispatch — run every handler for an event, in isolation.

   This used to be a bare `await handler(event, db)` in a loop, which coupled
   handlers to each other and to the caller: the first one to throw skipped every
   handler after it and rejected out of emit() into whichever adapter called it.
   A webhook then returned 5xx, and nothing durable said which handler failed or
   why. That is the silent-2am-failure the dead-letter queue exists for.

   Now each handler is caught individually and its failure recorded, so:
     - a bad handler cannot suppress its siblings
     - the event stays committed (it always was — `events` is written first)
     - the work that was owed is recorded and retryable

   emit() still rejects if EVERY handler failed and none could be recorded,
   because at that point the queue is not working either and the caller must
   hear about it. Otherwise dispatch resolves and reports what happened.

   `throwOnHandlerError` restores the old behaviour for tests and for the replay
   validator, which wants a failing handler to be loud rather than absorbed. */
export async function dispatch(db, event, { throwOnHandlerError = false } = {}) {
  const handlers = getHandlers(event.name);
  const failures = [];
  let recorded = 0;

  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    try {
      await handler(event, db); // handlers are idempotent per the spec
    } catch (err) {
      if (throwOnHandlerError) throw err;
      const name = handlerName(handler, `handler[${i}]:${event.name}`);
      failures.push({ handler: name, error: err });
      const res = await recordFailure(db, {
        orgId: event.orgId,
        eventId: event.id,
        eventName: event.name,
        eventVersion: event.version,
        clientId: event.clientId || null,
        payload: event.payload || {},
        handler: name,
        error: err
      });
      if (res.ok) recorded += 1;
      else {
        // The queue itself is down. Say so on the way past — this is the one
        // failure mode that genuinely loses work.
        console.error(
          `[bus] handler ${name} failed for ${event.name} AND the dead-letter ` +
          `write failed: ${res.error}. Original: ${err && err.message}`
        );
      }
    }
  }

  // Every handler failed and not one could be queued: the caller must not be
  // told this succeeded.
  if (handlers.length > 0 && failures.length === handlers.length && recorded === 0) {
    const first = failures[0];
    const e = new Error(
      `all ${failures.length} handler(s) for "${event.name}" failed and none could be ` +
      `dead-lettered: ${first.error && first.error.message}`
    );
    e.cause = first.error;
    throw e;
  }

  return { handlers: handlers.length, failed: failures.length, recorded };
}

/* The default org id, cached, for callers that must write an org-scoped row
   BEFORE any event is emitted. The Commas inbox is the case that needs it: it
   persists the raw webhook ahead of the 200 and long before anything is
   interpreted, so it cannot get an org id back from emit(). Exported rather
   than duplicated so there is one lookup and one cache. */
export const defaultOrgId = (db) => resolveDefaultOrg(db);

let _orgCache = null;
async function resolveDefaultOrg(db) {
  if (_orgCache) return _orgCache;
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1 LIMIT 1`, [DEFAULT_ORG]);
  if (!r.rows.length) throw new Error(`default org "${DEFAULT_ORG}" not found — run migrations`);
  _orgCache = r.rows[0].id;
  return _orgCache;
}

export const _resetOrgCache = () => { _orgCache = null; };
