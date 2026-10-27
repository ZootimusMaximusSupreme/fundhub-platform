// Soft pulls — the on-demand path. A client whose file is already open needs an
// updated credit picture; somebody taps once; a request is recorded; when an
// answer arrives it lands through the ingest path that already exists.
//
// *** NOTHING HERE TRANSMITS. ***
// There is no outbound `fetch()` in src/adapters/ or src/lib/ and this module
// does not add one. requestSoftPull() writes a row with status='queued' and
// stops, exactly as sendTemplated() (src/workflows/messaging.mjs) writes a
// `messages` row with provider='internal', status='queued' and stops. The
// provider call is a named, documented seam below — see PROVIDER SEAM. Nobody
// should read "queued" as "sent"; today it means "recorded, and nobody has asked
// a bureau anything".
//
//
// THE FIVE RULES THIS MODULE ENFORCES, rather than trusting callers to remember:
//
//   0. NO CONSENT, NO REQUEST. Rule 1 records who asked. This one asks whether
//      the CONSUMER ever agreed. They are different questions and the platform
//      could previously only answer the first: consent lived in a CRM text
//      column (clients.cf_crs_softpull_consent), which cannot say what the
//      person was shown, how they said yes, or whether they have since said no.
//      db/migrations/099_client_consents.sql makes it a real record and
//      src/consent/index.mjs is the gate. requestSoftPull() refuses without a
//      live consent, BEFORE the replay and open-request guards, and a revoked
//      consent fails from the instant it is revoked — the check is a read at
//      request time, not a flag copied onto anything.
//
//      THE GATE IS ON REQUEST ONLY. fulfilSoftPull(), recordPull() and the CRS
//      ingest path are deliberately untouched: a pull that already happened is
//      a fact, and refusing to store or normalise it because the paperwork is
//      now wrong would lose the only copy of what a bureau said about a person
//      — see recordPull()'s own note on why `requestId` is optional. Consent
//      governs whether we may ASK. It does not govern whether we may write down
//      an answer that already arrived.
//
//   1. NO ATTRIBUTION, NO PULL. A soft pull is a consumer-credit event. Every
//      request records who initiated it and why, and a request that cannot say
//      either is REFUSED — the same position revealSsn() takes in
//      src/pii/index.mjs ("an unattributed reveal is not loggable"), and for the
//      same reason: a log nobody can trace back to a person is paperwork, not an
//      audit trail. 077 backs this with a CHECK constraint, so the refusal holds
//      even for a writer that does not come through this module.
//
//   2. ONE TAP IS ONE PULL. A button on a phone gets tapped twice and retried by
//      the network. Two guards, at different distances: the caller's
//      idempotencyKey (unique index in 077) collapses a literal retry, and an
//      already-open request for the same client is RETURNED rather than
//      duplicated. Neither is decorative — pulling a consumer's credit twice
//      because a request timed out is a real harm and a real cost.
//      Both guards are backed by a unique index and the INSERT carries ON
//      CONFLICT DO NOTHING, because reading and then writing leaves a gap two
//      simultaneous taps both fit through — which they did, three times over,
//      against a real Postgres. See GUARD 3 and 090.
//
//   3. ONE READER OF A PULL PAYLOAD. fulfil() calls ingestCrsResult() from
//      src/tradelines/store.mjs. It does not parse crs_results.result itself and
//      must never start: two readers of one payload that drift apart is the
//      defect class this repo keeps finding, and the normalizer already handles
//      the vendor disagreements (src/tradelines/index.mjs).
//
//   4. NULL SURVIVES. An unknown cost stays NULL all the way down. It is not
//      defaulted to zero on the way in, and it is not rendered as "$0.00" on the
//      way out — see costDisplay().
//
//
// NO SUBSCRIPTION IMPORT, DELIBERATELY. subscriptionId is a plain parameter and
// this module imports nothing from the subscription/stored-card build. That work
// runs in parallel; coupling the two through an import would make each unable to
// land without the other. NULL is a legitimate value here and means "ad-hoc, or
// the plan is unknown", never "free".

import { db as sharedDb, pool } from "../db.mjs";
import { fromCents } from "../commissions/money.mjs";
import { ingestCrsResult } from "../tradelines/store.mjs";
import { consentStatus, CONSENT_REASONS } from "../consent/index.mjs";

export class SoftPullError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.name = "SoftPullError";
    this.status = status;
    // `code` is optional and defaults to null, so every existing throw site and
    // every existing test keeps its shape. It exists so the consent refusal can
    // be told apart from the other 4xx a screen might get back: the button needs
    // to send the person to the consent screen, and matching on message text to
    // decide that would break the first time somebody reworded the sentence.
    this.code = code;
  }
}

/** The states a request can be in. Mirrors the CHECK in 077 — there is no
 *  'sent', because there is nothing that sends. */
export const SOFT_PULL_STATUSES = ["queued", "processing", "fulfilled", "failed", "cancelled"];
/* 'system' added 380_finance_os_monthly_pull.sql — a scheduled Finance OS
   pull with no human requester. Every other call site is unaffected: the
   default export from src/finance/finance-os-pull-scheduler.mjs is the only
   caller that passes { kind: "system" }. */
export const REQUESTER_KINDS = ["staff", "client", "system"];

const SELECT_COLUMNS = `
  id, org_id, client_id,
  requested_by_kind, requested_by_staff_id, requested_by_account_id,
  reason, cost_cents, subscription_id, crs_result_id,
  status, state_reason, provider, idempotency_key,
  requested_at, resolved_at, created_at, updated_at`;

/* normalizeRequester — a principal-ish thing → { kind, staffId, accountId }.
 *
 * Accepts { kind, id } or { kind, staffId } / { kind, accountId }, because the
 * two call sites naturally hold different shapes: a staff principal has staffId,
 * an account principal has accountId. Anything that does not resolve to a kind
 * AND a subject is refused with 401 rather than defaulted — see rule 1. */
export function normalizeRequester(requestedBy) {
  const kind = String(requestedBy?.kind ?? "").trim().toLowerCase();

  // 'system' is the one kind with no subject to require — see 380's header. A
  // caller cannot opt a human requester out of attribution by typing "system";
  // this branch is reachable ONLY when the kind itself is exactly "system".
  if (kind === "system") {
    return { kind, staffId: null, accountId: null };
  }

  const id = requestedBy?.id ?? (kind === "staff" ? requestedBy?.staffId : requestedBy?.accountId);

  if (!kind || !id) {
    throw new SoftPullError(
      "requestedBy is required — an unattributed soft pull is not loggable",
      { status: 401 }
    );
  }
  if (!REQUESTER_KINDS.includes(kind)) {
    throw new SoftPullError(
      `requestedBy.kind must be one of: ${REQUESTER_KINDS.join(", ")}`,
      { status: 400 }
    );
  }
  return {
    kind,
    staffId: kind === "staff" ? String(id) : null,
    accountId: kind === "client" ? String(id) : null
  };
}

/* normalizeReason — a stated purpose, or a refusal.
 *
 * "   " is refused as hard as "" is. A whitespace reason is worse than a missing
 * one: it satisfies a NOT NULL, looks populated in an export, and tells an
 * auditor nothing. src/http/pii.pg.test.mjs pins the identical distinction for
 * SSN reveals; a non-string is a 400 rather than being coerced, so that neither
 * "42" nor "[object Object]" can become the sentence somebody later reads. */
export function normalizeReason(reason) {
  if (typeof reason !== "string" || !reason.trim()) {
    throw new SoftPullError(
      "reason is required — every soft pull is written to soft_pull_requests",
      { status: 400 }
    );
  }
  return reason.trim();
}

/* normalizeCostCents — integer cents, or null meaning UNKNOWN.
 *
 * Not defaulted to 0. "We do not know what this pull cost" and "this pull was
 * free" are different facts and only one of them belongs in a billing report.
 * A float is refused rather than rounded: a caller passing 12.5 is passing
 * dollars-shaped data into a cents-shaped column, and silently accepting it is
 * how a 12-cent charge becomes a 12-dollar one. Convert at the boundary with
 * toCents() from src/commissions/money.mjs, deliberately, before calling here. */
export function normalizeCostCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) {
    throw new SoftPullError(
      `cost_cents must be an integer number of cents (got ${JSON.stringify(value)})`
    );
  }
  if (n < 0) throw new SoftPullError("cost_cents cannot be negative");
  return n;
}

/** costDisplay — cents → a 2dp string for a screen, or null. NULL stays NULL:
 *  an unknown cost must not render as "0.00". */
export function costDisplay(costCents) {
  return costCents === null || costCents === undefined ? null : fromCents(Number(costCents));
}

/** decorate — the row as callers should see it: the stored columns plus the
 *  rendered cost, so no screen has to know the cents convention. */
export function decorate(row) {
  return row ? { ...row, cost_display: costDisplay(row.cost_cents) } : row;
}

/* priorByIdemKey — the row a replayed tap already made, or null. One reader, two
   call sites: the guard before the insert, and the re-read after an insert that
   lost a race to another caller carrying the same key. */
async function priorByIdemKey(db, orgId, idem) {
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests
      WHERE org_id = $1 AND idempotency_key = $2`,
    [orgId, idem]
  );
  return res.rows[0] ? decorate(res.rows[0]) : null;
}

/* replayOrRefuse — a prior row found under this caller's retry key is either
   THIS caller's retry or somebody else's row, and those are opposite answers.

   uq_soft_pull_requests_idem (077) is keyed (org_id, idempotency_key); the
   client is deliberately not in it, so within one org a key is global. A retry
   key identifies one tap, and a tap is about one client, so a prior row naming a
   DIFFERENT client is a collision and not a replay. Returning it would hand the
   caller another consumer's credit-pull record — who asked, why, what it cost —
   while silently dropping the request this caller actually made, so a screen
   shows a pull in flight that no ledger row records. Refusing is the only answer
   that is neither a disclosure nor a lie, and 409 (not a raw unique violation)
   is what keeps it off the 500 path in netlify/functions/api.mjs. */
function replayOrRefuse(prior, clientId) {
  if (String(prior.client_id) !== String(clientId)) {
    throw new SoftPullError(
      "that idempotency key has already been used for a different client",
      { status: 409 }
    );
  }
  return { created: false, reason: "replay", request: prior };
}

/**
 * openRequestFor — the client's outstanding request, or null.
 * Exported because "is a pull already in flight for this client" is a question
 * the portal button needs to ask before it renders, not only when it is tapped.
 */
export async function openRequestFor(db, { clientId }) {
  if (!clientId) throw new SoftPullError("clientId is required");
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests
      WHERE client_id = $1 AND status IN ('queued', 'processing')
      ORDER BY requested_at ASC LIMIT 1`,
    [clientId]
  );
  return res.rows[0] ? decorate(res.rows[0]) : null;
}

/* consentRefusal — why the gate said no, in a sentence the person who tapped the
   button can act on.
 *
 * The four cases lead somewhere different, which is the whole reason they are
 * not one message: "none on file" and "expired" mean go and capture consent,
 * "revoked" means stop and do not ask again, and a scope failure is ours rather
 * than theirs. A single "consent required" string would send a closer to the
 * capture screen to re-collect a consent the client deliberately withdrew.
 *
 * Exported for the tests, which assert on the distinction rather than on the
 * wording — the strings are allowed to be reworded, the branches are not. */
export function consentRefusal(reason) {
  switch (reason) {
    case CONSENT_REASONS.REVOKED:
      return "this client has revoked their soft-pull consent — do not request a pull; a new consent must be captured before asking again";
    case CONSENT_REASONS.EXPIRED:
      return "this client's soft-pull consent has expired — capture a new consent before requesting a pull";
    case CONSENT_REASONS.NOT_YET:
      return "this client's soft-pull consent is not effective yet";
    case CONSENT_REASONS.NO_ORG:
      return "no organisation on this session — a soft pull cannot be scoped and is refused";
    default:
      return "no soft-pull consent on file for this client — capture consent before requesting a pull";
  }
}

/**
 * requestSoftPull — record that somebody asked for a pull. THE ONE-TAP PATH.
 *
 * Returns { created, request }. `created: false` means an equivalent request was
 * already open (or an identical idempotency key had already been used) and the
 * EXISTING row is returned — the caller's tap is acknowledged without a second
 * consumer-credit event being recorded or a second cost being incurred.
 *
 * Nothing is sent. See PROVIDER SEAM at the end of this function.
 */
export async function requestSoftPull(db, {
  orgId,
  clientId,
  requestedBy,
  reason,
  costCents = null,
  subscriptionId = null,
  idempotencyKey = null,
  provider = "internal"
} = {}) {
  if (!orgId || !clientId) throw new SoftPullError("orgId and clientId are required");

  // Attribution first, before anything touches the database. A request that
  // cannot say who asked is not a request we are willing to have half-written.
  const requester = normalizeRequester(requestedBy);
  const statedReason = normalizeReason(reason);
  const cost = normalizeCostCents(costCents);
  const idem = typeof idempotencyKey === "string" && idempotencyKey.trim()
    ? idempotencyKey.trim()
    : null;

  /* GUARD 0 — THE CONSENT GATE. Rule 0 in the header.
   *
   * FIRST, before the replay guard and before the open-request guard. Those two
   * exist to avoid recording a SECOND consumer-credit event; this one decides
   * whether we may record a first. Ordering it after them would mean a replayed
   * tap, or a tap while an older request sat open, returned a cheerful
   * `created: false` to somebody who has revoked their consent — the request
   * would not be new, but the answer would still be "yes, that's in hand", and
   * the person asking would reasonably read it as permission still standing.
   *
   * READ AT REQUEST TIME, EVERY TIME. Nothing caches this and nothing copies a
   * consent decision onto the request row, because a revocation has to bite
   * immediately and a copied flag is a decision frozen at the wrong moment.
   *
   * SCOPED BY orgId, WHICH CAME FROM THE SESSION. api/finance/soft-pull.mjs
   * takes it from principal.orgId and refuses when it is absent; consentStatus()
   * fails closed on a blank org besides, so an unscoped call cannot open the
   * gate by omission. */
  const consent = await consentStatus(db, {
    orgId, clientId, kind: "soft_pull_consent"
  });
  if (!consent.valid) {
    throw new SoftPullError(consentRefusal(consent.reason), {
      status: 403,
      code: "consent_required"
    });
  }

  // GUARD 1 — the same tap, replayed. Checked before the open-request guard so
  // a retry gets back the row it made rather than somebody else's older one.
  if (idem) {
    const prior = await priorByIdemKey(db, orgId, idem);
    if (prior) return replayOrRefuse(prior, clientId);
  }

  // GUARD 2 — a pull is already outstanding for this client. Returning it is the
  // honest answer to a second tap: the work is already recorded, and starting a
  // second one would bill twice for one question.
  const open = await openRequestFor(db, { clientId });
  if (open) return { created: false, reason: "already_open", request: open };

  /* GUARD 3 — THE SAME TWO GUARDS, ADJUDICATED BY POSTGRES.
     Guards 1 and 2 read and then write, and between the read and the write
     another caller can do the same. Both see nothing open, both insert: one
     question, two consumer-credit events, two charges. Proven, not theorised —
     three simultaneous requests for one client wrote three rows.
     ON CONFLICT DO NOTHING hands that decision to the unique indexes instead:
     uq_soft_pull_requests_one_open (090) for a second open request, and
     uq_soft_pull_requests_idem (077) for a replayed key. Untargeted, so it
     covers both. A caller that loses is not an error — it re-reads below and
     gets the winner's row, the same answer a second tap has always got. */
  const res = await db.query(
    `INSERT INTO soft_pull_requests
       (org_id, client_id, requested_by_kind, requested_by_staff_id, requested_by_account_id,
        reason, cost_cents, subscription_id, idempotency_key, provider, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')
     ON CONFLICT DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [orgId, clientId, requester.kind, requester.staffId, requester.accountId,
     statedReason, cost, subscriptionId ?? null, idem, String(provider || "internal")]
  );

  if (!res.rows[0]) {
    // Somebody else got there first, in the microseconds since guard 2. Their
    // row is the answer to this tap. Same order as the guards above: the
    // caller's own replayed key first, then the client's open request.
    if (idem) {
      const prior = await priorByIdemKey(db, orgId, idem);
      if (prior) return replayOrRefuse(prior, clientId);
    }
    const raced = await openRequestFor(db, { clientId });
    if (raced) return { created: false, reason: "already_open", request: raced };

    // Nothing was written and nothing explains why. Refusing loudly is the only
    // honest option: reporting success would tell a screen a pull is under way
    // when no ledger row exists, and retrying blindly is how a double charge
    // happens in the first place.
    throw new SoftPullError(
      "the soft pull request could not be recorded — please try again",
      { status: 409 }
    );
  }

  /* ── PROVIDER SEAM ───────────────────────────────────────────────────────
     This is where a real soft pull would be requested, and it is not here.

     A provider client belongs in src/adapters/ alongside the inbound parsers,
     takes the request row's id as its own idempotency key, and on an answer
     calls fulfilSoftPull() below with the crs_results row it wrote. It does NOT
     belong inline in this function: an outbound call inside the same await as
     the ledger insert makes "we recorded it" and "we asked for it" fail
     together, and the whole point of the ledger is that the record survives a
     provider that is down.

     Until that exists the row sits at 'queued', which is what queued means.
     ──────────────────────────────────────────────────────────────────────── */

  return { created: true, request: decorate(res.rows[0]) };
}

/**
 * fulfilSoftPull — an answer arrived. Link it, ingest it, close the request.
 *
 * REUSES ingestCrsResult(). This function contains no knowledge of what a bureau
 * payload looks like and must never acquire any — rule 3 in the header.
 *
 * Transactional, and in this order: the ledger row is stamped before the
 * tradelines are written, so a failure part-way cannot leave a client's cards
 * updated by a pull the ledger says never completed. Both halves land or neither
 * does — the same reasoning as revealSsn()'s log-then-disclose.
 */
export async function fulfilSoftPull(db, { requestId, crsResultId } = {}) {
  if (!requestId) throw new SoftPullError("requestId is required");
  if (!crsResultId) throw new SoftPullError("crsResultId is required");
  return withTransaction(db, (tx) => fulfilWithin(tx, { requestId, crsResultId }));
}

/* fulfilWithin — the body of fulfilSoftPull, minus the transaction.
   Extracted so recordPull() can run "write the pull" and "close the request"
   inside ONE transaction. Calling fulfilSoftPull() from inside another
   transaction would not work: withTransaction() branches on
   `typeof db.connect === "function"`, and a pg PoolClient has a connect method,
   so it would try to open a nested connection from a client rather than reusing
   the one it was handed. One helper, two wrappers, no nesting. */
async function fulfilWithin(tx, { requestId, crsResultId }) {
  {
    const request = (await tx.query(
      `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    )).rows[0];
    if (!request) throw new SoftPullError("no such soft pull request", { status: 404 });
    if (request.status !== "queued") {
      throw new SoftPullError(
        `soft pull request is already ${request.status}`,
        { status: 409 }
      );
    }

    const crsRow = (await tx.query(
      `SELECT id, org_id, client_id, result, outcome_tier, created_at
         FROM crs_results WHERE id = $1`,
      [crsResultId]
    )).rows[0];
    if (!crsRow) throw new SoftPullError("no such crs_results row", { status: 404 });

    // An answer about somebody else is not an answer to this question. Without
    // this check a mis-joined fulfil would attribute one person's credit file to
    // another client's request AND ingest their tradelines — the same class of
    // harm the AAD binding in src/pii/index.mjs exists to prevent.
    if (String(crsRow.client_id) !== String(request.client_id)) {
      throw new SoftPullError(
        "that crs_results row belongs to a different client",
        { status: 409 }
      );
    }

    const updated = (await tx.query(
      `UPDATE soft_pull_requests
          SET status = 'fulfilled', crs_result_id = $2,
              resolved_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [requestId, crsResultId]
    )).rows[0];

    // THE EXISTING INGEST PATH. One reader of a pull payload, and this is not it.
    const ingest = await ingestCrsResult(tx, crsRow);

    return { request: decorate(updated), ingested: ingest.ingested, tradelines: ingest.rows };
  }
}

/**
 * recordPull — a pull came back. Store it, and put the cards where the closer's
 * calculator reads them.
 *
 * This is the write half of the on-demand path: `crs_results` is the history of
 * pull OUTPUT (001_init.sql, "full engine output per pull, history not
 * latest-only"), and every pull that arrives gets a row there whether or not a
 * ledger entry asked for it — a pull that happened is a fact, and refusing to
 * store one because nobody filed the paperwork would lose the only copy.
 *
 * `requestId` is OPTIONAL and that is deliberate:
 *   * given    — the answer is attributed to the request that asked for it, and
 *                the ledger row closes. Same transaction, so a client's cards
 *                cannot be updated by a pull the ledger says never completed.
 *   * omitted  — the pull is still stored and still ingested. This is the paid
 *                path (`diagnostic.paid` → C-00), which predates the ledger and
 *                does not file a request. Refusing it here would break the flow
 *                that already works.
 *
 * ONE READER. Both branches reach `tradelines` through ingestCrsResult(); this
 * function never looks inside `result` itself.
 */
export async function recordPull(db, {
  orgId, clientId, result, outcomeTier = null, requestId = null
} = {}) {
  if (!orgId || !clientId) throw new SoftPullError("orgId and clientId are required");
  // A pull with no payload is not a pull. Storing `{}` would put a row in the
  // history that reads as "we pulled and they have no credit", which is a
  // different and much worse claim than "the pull failed" — that is what
  // closeSoftPull(status:'failed') is for.
  if (result === null || result === undefined || typeof result !== "object" || Array.isArray(result)) {
    throw new SoftPullError("result must be the pull payload object");
  }

  return withTransaction(db, async (tx) => {
    const crsRow = (await tx.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3,$4)
       RETURNING id, org_id, client_id, result, outcome_tier, created_at`,
      [orgId, clientId, JSON.stringify(result), outcomeTier]
    )).rows[0];

    if (requestId) {
      const out = await fulfilWithin(tx, { requestId, crsResultId: crsRow.id });
      return { crsResult: crsRow, request: out.request, ingested: out.ingested, tradelines: out.tradelines };
    }

    const ingest = await ingestCrsResult(tx, crsRow);
    return { crsResult: crsRow, request: null, ingested: ingest.ingested, tradelines: ingest.rows };
  });
}

/**
 * coordinateCrsResult — store one provider response, close its request and
 * ingest its tradelines as one transaction. Provider retries return the first
 * result without touching tradelines again.
 */
export async function coordinateCrsResult(db, {
  orgId,
  clientId,
  requestId,
  provider = "crs_softview",
  providerResultId,
  result,
  outcomeTier = null,
  allowQueued = false
} = {}) {
  if (!orgId || !clientId || !requestId || !providerResultId) {
    throw new SoftPullError("orgId, clientId, requestId and providerResultId are required");
  }
  if (typeof provider !== "string" || !provider.trim()) {
    throw new SoftPullError("provider is required");
  }
  if (typeof providerResultId !== "string" || !providerResultId.trim()) {
    throw new SoftPullError("providerResultId is required");
  }
  if (result === null || result === undefined || typeof result !== "object" || Array.isArray(result)) {
    throw new SoftPullError("result must be the pull payload object");
  }

  const providerName = provider.trim();
  const resultIdentity = providerResultId.trim();

  return withTransaction(db, async (tx) => {
    // The schema's unique key is org-scoped, but a provider RequestID delivered
    // under another org must still be refused. This transaction lock serializes
    // that global check without widening the requested database index.
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${providerName}:${resultIdentity}`]
    );

    const request = (await tx.query(
      `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    )).rows[0];
    if (!request) throw new SoftPullError("no such soft pull request", { status: 404 });
    if (String(request.org_id) !== String(orgId) || String(request.client_id) !== String(clientId)) {
      throw new SoftPullError("soft pull request belongs to a different org or client", { status: 409 });
    }

    if (request.status === "fulfilled") {
      const prior = (await tx.query(
        `SELECT id, org_id, client_id, provider, provider_result_id, result, outcome_tier, created_at
           FROM crs_results WHERE id = $1`,
        [request.crs_result_id]
      )).rows[0];
      if (!prior
          || String(prior.org_id) !== String(orgId)
          || String(prior.client_id) !== String(clientId)
          || prior.provider !== providerName
          || prior.provider_result_id !== resultIdentity) {
        throw new SoftPullError("request was fulfilled by a different provider result", { status: 409 });
      }
      return {
        crsResult: prior,
        request: decorate(request),
        ingested: 0,
        tradelines: [],
        replayed: true
      };
    }
    // Production provider work must be claimed first. allowQueued exists only
    // for legacy/direct callers whose tests predate the processing claim.
    const fulfilStatus = request.status === "processing"
      ? "processing"
      : (allowQueued && request.status === "queued" ? "queued" : null);
    if (!fulfilStatus) {
      throw new SoftPullError(`soft pull request is already ${request.status}`, { status: 409 });
    }

    const existing = (await tx.query(
      `SELECT id, org_id, client_id, provider, provider_result_id, result, outcome_tier, created_at
         FROM crs_results
        WHERE provider = $1 AND provider_result_id = $2
        FOR UPDATE`,
      [providerName, resultIdentity]
    )).rows[0];
    if (existing) {
      const linked = (await tx.query(
        `SELECT id FROM soft_pull_requests WHERE crs_result_id = $1 FOR UPDATE`,
        [existing.id]
      )).rows[0];
      if (String(existing.org_id) !== String(orgId)
          || String(existing.client_id) !== String(clientId)
          || !linked
          || String(linked.id) !== String(requestId)) {
        throw new SoftPullError("provider result is already anchored to another request, client or org", { status: 409 });
      }
      throw new SoftPullError("request and provider result are in an inconsistent state", { status: 409 });
    }

    const crsRow = (await tx.query(
      `INSERT INTO crs_results
         (org_id, client_id, provider, provider_result_id, result, outcome_tier)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, provider, provider_result_id)
         WHERE provider IS NOT NULL AND provider_result_id IS NOT NULL
       DO NOTHING
       RETURNING id, org_id, client_id, provider, provider_result_id, result, outcome_tier, created_at`,
      [orgId, clientId, providerName, resultIdentity, JSON.stringify(result), outcomeTier]
    )).rows[0];
    if (!crsRow) {
      throw new SoftPullError("provider result already exists", { status: 409 });
    }

    const updated = (await tx.query(
      `UPDATE soft_pull_requests
          SET status = 'fulfilled', crs_result_id = $2,
              resolved_at = now(), updated_at = now()
        WHERE id = $1 AND status = $3
        RETURNING ${SELECT_COLUMNS}`,
      [requestId, crsRow.id, fulfilStatus]
    )).rows[0];
    if (!updated) {
      throw new SoftPullError("soft pull request changed before fulfillment", { status: 409 });
    }

    const ingest = await ingestCrsResult(tx, crsRow);
    return {
      crsResult: crsRow,
      request: decorate(updated),
      ingested: ingest.ingested,
      tradelines: ingest.rows,
      replayed: false
    };
  });
}

/**
 * getLatestPull — the most recent pull output for one client, or null.
 *
 * Ordered by created_at DESC, id DESC. The id is the tiebreaker and it is not
 * decoration: `crs_results.created_at` defaults to now() and two pulls recorded
 * in the same transaction share a now(), so ordering on the timestamp alone
 * would make "the latest" arbitrary between them.
 *
 * Returns the row as stored. It does NOT normalize the payload — callers that
 * want the cards read `tradelines`, which recordPull() has already populated
 * through the one normalizer. A second parser here is exactly what this module
 * refuses to grow.
 */
export async function getLatestPull(db, { clientId } = {}) {
  if (!clientId) throw new SoftPullError("clientId is required");
  const res = await db.query(
    `SELECT id, org_id, client_id, result, outcome_tier, created_at, updated_at, is_demo
       FROM crs_results
      WHERE client_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [clientId]
  );
  return res.rows[0] ?? null;
}

/**
 * closeSoftPull — end a request without an answer.
 * `status` is 'failed' (the request could not be answered) or 'cancelled' (it
 * was withdrawn). Both demand a stated reason, for the same reason the request
 * itself does: "it ended" is not an audit trail.
 */
export async function closeSoftPull(db, { requestId, status, reason } = {}) {
  if (!requestId) throw new SoftPullError("requestId is required");
  if (status !== "failed" && status !== "cancelled") {
    throw new SoftPullError("status must be one of: failed, cancelled");
  }
  const stated = normalizeReason(reason);

  const res = await db.query(
    `UPDATE soft_pull_requests
        SET status = $2, state_reason = $3, resolved_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'processing')
      RETURNING ${SELECT_COLUMNS}`,
    [requestId, status, stated]
  );
  if (!res.rows[0]) {
    // Either it does not exist or it is already resolved. Both mean "this call
    // did not do what it was asked", and neither should look like success.
    throw new SoftPullError("no queued or processing soft pull request with that id", { status: 409 });
  }
  return decorate(res.rows[0]);
}

/* boundedLimit — clamps BOTH ends, and treats a non-positive limit as "use the
   default" rather than as a number.
   `Math.min(parseInt(q.limit) || 100, 200)` is the idiom three routes in this
   repo shipped, and it lets -1 through — parseInt("-1") is truthy — so a
   one-character typo in a URL becomes a 500 carrying raw Postgres text
   ("LIMIT must not be negative"). Clamping to 1 would be safe but silently
   answers a different question than the caller asked; falling back to the
   default is the behaviour src/http/read-api.mjs pageParams() already has. */
export function boundedLimit(raw, fallback = 50) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
}

/** listSoftPullRequests — one client's pull history, newest first. This is the
 *  read the phrase "why was this person's credit pulled" resolves to. */
export async function listSoftPullRequests(db, { clientId, limit = 50 } = {}) {
  if (!clientId) throw new SoftPullError("clientId is required");
  const capped = boundedLimit(limit);
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests
      WHERE client_id = $1
      ORDER BY requested_at DESC, id DESC
      LIMIT $2`,
    [clientId, capped]
  );
  return res.rows.map(decorate);
}

/** getSoftPullRequest — one row, or null. */
export async function getSoftPullRequest(db, requestId) {
  if (!requestId) throw new SoftPullError("requestId is required");
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests WHERE id = $1`, [requestId]
  );
  return res.rows[0] ? decorate(res.rows[0]) : null;
}

/** Claim one queued request before any provider login or order. */
export async function claimSoftPull(db, { requestId, orgId, clientId } = {}) {
  if (!requestId || !orgId || !clientId) {
    throw new SoftPullError("requestId, orgId and clientId are required");
  }

  const claimed = (await db.query(
    `UPDATE soft_pull_requests
        SET status = 'processing', updated_at = now()
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status = 'queued'
      RETURNING ${SELECT_COLUMNS}`,
    [requestId, orgId, clientId]
  )).rows[0];
  if (claimed) return { claimed: true, reason: "claimed", request: decorate(claimed) };

  const current = (await db.query(
    `SELECT ${SELECT_COLUMNS} FROM soft_pull_requests WHERE id = $1`,
    [requestId]
  )).rows[0];
  if (!current) throw new SoftPullError("no such soft pull request", { status: 404 });
  if (String(current.org_id) !== String(orgId) || String(current.client_id) !== String(clientId)) {
    throw new SoftPullError("soft pull request belongs to a different org or client", { status: 409 });
  }
  const reason = current.status === "processing" ? "already_claimed" : current.status;
  return { claimed: false, reason, request: decorate(current) };
}

/** Keep an ambiguous provider call open and record what needs reconciliation. */
export async function holdSoftPullForReconciliation(db, { requestId, reason } = {}) {
  if (!requestId) throw new SoftPullError("requestId is required");
  const stated = normalizeReason(reason);
  const row = (await db.query(
    `UPDATE soft_pull_requests
        SET state_reason = $2, updated_at = now()
      WHERE id = $1 AND status = 'processing'
      RETURNING ${SELECT_COLUMNS}`,
    [requestId, stated]
  )).rows[0];
  if (!row) throw new SoftPullError("no processing soft pull request with that id", { status: 409 });
  return decorate(row);
}

/* withTransaction — a REAL transaction, which took catching to get right.
 *
 * The idiom in src/pii/index.mjs is `if (typeof db.connect !== "function")
 * return fn(db)` — "a pool gets a transaction, a test double is used as-is".
 * That probe is wrong against this repo's own database handle: `src/db.mjs`
 * exports `db` as `{ query }` and NOTHING ELSE. It has no connect(), so the
 * probe takes the no-transaction branch and the callback runs with autocommit,
 * on the one object every production caller actually passes.
 *
 * Caught by a test, not by reading: "a pull naming an already-resolved request
 * stores NOTHING" failed with an orphan `crs_results` row — the INSERT had
 * committed itself before the fulfil raised. Without the fix, recordPull()
 * would leave the pull history claiming a pull that the ledger says never
 * completed, which is precisely the disagreement this module exists to prevent.
 *
 * So: use the handle's own connect() when it has one (a real Pool, or a test
 * double that wants to observe BEGIN/COMMIT), reach for the pool when we were
 * handed the shared singleton, and only then fall back to running inline for a
 * plain fake in a unit test.
 *
 * NOTE FOR WHOEVER OWNS src/pii/index.mjs: revealSsn() has this same probe and
 * the same handle, so its rule 3 — "the access log is written in the same
 * transaction as the reveal; if the log write fails, the reveal fails" — does
 * not hold as shipped. I did not change it here; it is a behavioural change to
 * a compliance path and deserves its own review. Written up as a finding.
 *
 * EXPORTED (100_retention_policy). scripts/retention-purge.mjs needs a real
 * transaction and this is the only correct one in the tree — the version in
 * src/pii/index.mjs is the broken probe described above. Exporting the working
 * one beats copying it: two transaction helpers that drift apart is precisely
 * the bug CLAUDE.md §8 "reuse before you build" is about. Nothing else changed.
 */
export async function withTransaction(db, fn) {
  const acquire = typeof db?.connect === "function"
    ? () => db.connect()
    : (db === sharedDb ? () => pool().connect() : null);
  if (!acquire) return fn(db);
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
