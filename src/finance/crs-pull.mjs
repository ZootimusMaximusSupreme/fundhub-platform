// THE COORDINATOR. One pull, one stored result, one event.
//
// It orders every bureau, hands the answers to coordinateCrsResult() to be
// stored, and emits one event to say the row exists. It does not decide who to
// pull, it does not decide what the result means, and it does not write to the
// database itself.
//
// WHY IT DOES NOT WRITE. There were already two half-paths to a stored credit
// result and calling both wrote the row twice: recordPull() stored and ingested
// but emitted nothing, while the analysis.completed handler emitted and stored
// AGAIN — a second row with no tradelines and no ledger link, newer than the
// real one, so every "latest pull" reader would have picked the emptier of the
// two. coordinateCrsResult() in src/finance/soft-pulls.mjs closed that: it
// anchors the row on the provider's own response id, stores it, closes the
// request and ingests the tradelines in ONE transaction, and refuses a second
// result for the same request. This file uses it and adds nothing of its own.
//
// THE TIER ENGINE RUNS AFTER THE ROW IS STORED. crs-tier.mjs unwraps the raw
// Softview bodies under result.bureaus.TU|EX|EQ and calls the vendored
// runCRSEngine (normalizeSoftPull → routeOutcome). analysis.completed still
// means "the bureaus answered"; decision.rendered means "we chose a tier".
// emitCrsResult() is not used here — it would emit analysis.completed a second
// time on top of finishStored.
//
// PARTIAL PULLS ARE REAL RESULTS. Two bureaus answering and one failing is a
// worse answer than three, but it is still an answer, and the failure is stored
// beside the data. All three failing is not a result: the request is closed as
// failed and no row is written, because a row with no payload would read as "we
// pulled and they have no credit".
//
// REHEARSING A PULL WITHOUT TOUCHING A BUREAU (`simulate: true`).
//
// On the live site the configured host is the CRS production host and live
// pulls are on, so the first tap that clears the consent gate and the identity
// gate is a real bureau request against a real person. Nobody could walk the
// screen once before doing that to somebody. `simulate: true` fixes that, and
// it replaces EXACTLY ONE THING: the crs.orderPrequal() call at THE FENCE
// below. Everything on the near side of that line still happens for real —
// the consent gate (already passed in requestSoftPull before this function is
// called), the ledger claim, the CRS configuration check, the SSN decryption
// and its access-log row, the identity gate, the stored result row, the
// tradeline ingest, the tier engine and both events.
//
// THREE STATES, NOT TWO. `simulate` is read by simulationModeFor(): exactly
// `true` simulates, absent/null/`false` is a real pull, and ANYTHING ELSE
// refuses the pull outright. A value nobody can read as a clear yes or a clear
// no must not fall to either — falling to "real" would put a bureau request on
// someone's file that the caller never asked for, and falling to "simulated"
// would hand back a fabricated report to somebody who wanted a real one.
//
// THE STAMP. A simulated pull is stamped in five places, and the stored payload
// is the authority — a replay re-reads the stamp off the row rather than
// trusting the caller's argument:
//   crs_results.provider            "crs_softview_simulated", not "crs_softview"
//   crs_results.provider_result_id  "crs-simulated-bundle:<hash>"
//   result.simulated                true, plus result.simulatedNotice
//   result.environment              "sandbox" — see WHY SANDBOX below
//   both event payloads             simulated: true
//
// WHY THE STAMP REUSES THE WORD "sandbox". `result.environment` is not read as
// "which machine answered"; every reader of it in this repo reads it as "may I
// paint this as the client's own credit file", and the answer they already
// recognise is the string "sandbox" (src/http/client-detail.mjs:76 and :242
// both skip on it). A simulated payload is unsafe to paint for exactly the same
// reason a sandbox fixture is, so it says the word those readers already know
// instead of inventing a second one every reader would have to be taught. The
// true host class is not lost — it is kept beside it as result.hostEnvironment.
// `result.simulated` is what tells a simulated payload apart from a genuine
// sandbox pull.
//
// AND WHY THAT DOES NOT BLANK A SCREEN. The skip in client-detail.mjs walks
// backwards through the client's pull history for the newest result it is
// allowed to paint, so a simulated pull lands in the history without hiding the
// real pull underneath it. What a rehearsal will NOT do is paint new numbers on
// the client screen — see WHAT A SIMULATED PULL DELIBERATELY DOES NOT DO.
//
// WHAT A SIMULATED PULL DELIBERATELY DOES NOT DO. Two things, both because they
// would leave fabricated data somewhere that cannot carry the stamp:
//
//   1. It invents no numbers. The canned bureau answer has no scores, no
//      tradelines, no inquiries and no public records — see
//      simulatedBureauResponse. Every step still runs, including the tradeline
//      ingest; there is simply nothing for it to insert.
//   2. It does not write clients.outcome_tier — see persistOutcomeTier.
//
// So a rehearsal proves the whole path works and changes no number anyone acts
// on. The tier it produces will be MANUAL_REVIEW, because a file with no scores
// is what the engine was handed.

import { createHash } from "node:crypto";
import { emit } from "../events/bus.mjs";
import {
  claimSoftPull,
  coordinateCrsResult,
  getSoftPullRequest,
  closeSoftPull,
  SoftPullError
} from "./soft-pulls.mjs";
import { createCrsClient, CrsError } from "./crs-client.mjs";
import {
  activeBureausFromEnv,
  assertIdentityAllowed,
  CrsIdentityError,
  identityForBureau,
  isoBirthDate,
  isSandboxHost,
  isProductionHost,
  SANDBOX_TEST_IDENTITIES
} from "./crs-identities.mjs";
import { mergeBureauReports, newInquiriesFor } from "./crs-map.mjs";
import {
  runTierEngineFromCrsResult,
  submittedAddressFromIdentity,
  submittedNameFromIdentity
} from "./crs-tier.mjs";
import { revealSsn, PiiError } from "../pii/index.mjs";

/** The provider namespace for `crs_results.provider`. The vendor, not the
 *  product: "CRS" is verifiable from the credentials and the host, and a
 *  product name nobody has confirmed would be a guess stored as fact. */
export const CRS_PROVIDER = "crs_softview";

/** The provider namespace a SIMULATED pull stores instead of CRS_PROVIDER.
 *  A different namespace, not a flag beside the same one: `crs_results.provider`
 *  is the column that answers "who produced this file", and the honest answer
 *  for a simulated pull is "nobody did". It also keeps the two apart in the
 *  unique index on (org_id, provider, provider_result_id), so a simulation can
 *  never collide with, or be mistaken for, a real provider response. */
export const CRS_SIMULATED_PROVIDER = "crs_softview_simulated";

/** One spelling of the marker, used everywhere a sentence can be stored. */
export const SIMULATED_MARKER = "SIMULATED — no credit bureau was contacted";

/** What `reason` a pull requested by the paid diagnostic records in the ledger. */
export const DIAGNOSTIC_PULL_REASON =
  "automated tri-bureau soft pull after the paid credit diagnostic";

/** Who the PII access log names when a workflow reads an SSN to order a report. */
export const PULL_ACTOR = "workflow:crs-pull";

/** Which environment a host is, recorded on the stored payload. */
export function environmentFor(host) {
  if (isSandboxHost(host)) return "sandbox";
  if (isProductionHost(host)) return "production";
  return null;
}

/**
 * providerResultIdFor — stable, non-PII identity for one bureau bundle.
 * RequestIDs are trimmed, sorted, encoded unambiguously and hashed. No fallback
 * exists: without at least one provider RequestID there is no provider result
 * identity and the result must not be stored.
 *
 * `simulated` changes only the prefix. The prefix is the point: a stored
 * identity beginning "crs-simulated-bundle:" says what it is in a database
 * dump, a CSV export and a support ticket, none of which will have loaded the
 * jsonb payload to look at `result.simulated`.
 */
export function providerResultIdFor({ requestIds = {}, simulated = false } = {}) {
  const ids = Object.values(requestIds)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim())
    .sort();
  if (ids.length === 0) return null;
  const digest = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
  return `${simulated ? "crs-simulated-bundle" : "crs-request-bundle"}:${digest}`;
}

/**
 * simulationModeFor — read the `simulate` argument as one of three answers.
 *
 * "real"      absent, null, or exactly false — order the bureau, as always.
 * "simulated" exactly true — run the whole path, replace the vendor call.
 * "refuse"    anything else. Not a default, a refusal: see THREE STATES in the
 *             file header. "true" the string, 1, "yes", {} and every other
 *             near-miss land here, because a caller who cannot say which one
 *             they meant must not have one picked for them.
 */
export function simulationModeFor(simulate) {
  if (simulate === undefined || simulate === null || simulate === false) return "real";
  if (simulate === true) return "simulated";
  return "refuse";
}

/**
 * simulatedBureauResponse — what the fence returns instead of the vendor.
 *
 * Deliberately the SHAPE of a bureau answer with NOTHING IN IT: no scores, no
 * tradelines, no inquiries, no public records. That is not laziness, it is the
 * whole safety argument.
 *
 * A fabricated score or a fabricated tradeline does not stay inside the stamped
 * `crs_results` row. Tradelines are ingested into the `tradelines` table, which
 * has no simulated column and is read by the funding waterfall as available
 * credit; invented lines there would move a funding number on a real person.
 * Scores feed the tri-merge panel and the tier engine. So the rehearsal proves
 * that every step RUNS, and refuses to invent the one thing — the numbers —
 * that anyone downstream could act on. `pickCreditScore` over an empty array
 * yields null for every bureau, and null means unknown and survives as null.
 *
 * `requestId` is the soft-pull ledger row's uuid, which is unique per request
 * and stable across a retry of the same request. That gives the bundle identity
 * both properties it needs: two rehearsals never collide, and a replay of one
 * rehearsal re-derives the same identity.
 */
export function simulatedBureauResponse({ bureau, requestId } = {}) {
  return {
    ok: true,
    bureau,
    requestId: `SIMULATED:${requestId}:${bureau}`,
    status: 0,
    blocked: false,
    error: null,
    report: {
      simulated: true,
      simulatedNotice: SIMULATED_MARKER,
      creditFiles: [],
      scores: [],
      tradelines: [],
      inquiries: [],
      publicRecords: []
    }
  };
}

function identityForTier({ identity, realIdentity, merged }) {
  if (realIdentity) return realIdentity;
  if (identity) return identity;
  const first = Array.isArray(merged?.bureausPulled) ? merged.bureausPulled[0] : null;
  if (first && SANDBOX_TEST_IDENTITIES[first]) return SANDBOX_TEST_IDENTITIES[first];
  return null;
}

/* A SIMULATED PULL NEVER WRITES clients.outcome_tier.
   Every other place a simulated pull lands can carry the stamp beside it. That
   column cannot: it is one bare word on the real person's record, read by the
   sales cockpit as this client's standing, with nowhere to say where it came
   from. A rehearsal that wrote MANUAL_REVIEW over a real tier would be exactly
   the "a screen mistakes it for real" failure this fence exists to prevent, and
   it would also be silently destructive — the tier it overwrote is not kept.
   The tier engine still runs on a simulated pull, and the tier it produced is
   still recorded on the simulated crs_results row and in both event payloads,
   where the stamp travels with it. */
async function persistOutcomeTier(db, { clientId, crsResultId, outcomeTier, simulated = false }) {
  if (!simulated) {
    await db.query(`UPDATE clients SET outcome_tier = $2 WHERE id = $1`, [clientId, outcomeTier]);
  }
  await db.query(
    `UPDATE crs_results
        SET outcome_tier = COALESCE(outcome_tier, $2),
            updated_at = now()
      WHERE id = $1`,
    [crsResultId, outcomeTier]
  );
}

/** Companies already saved on the client. A blank name or state is skipped. */
export async function loadSavedCompanies(db, { orgId, clientId }) {
  const res = await db.query(
    `SELECT name, age_months, entity_data
       FROM businesses
      WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  return (res.rows || []).map((row) => {
    let entity = row.entity_data;
    if (typeof entity === "string") {
      try { entity = JSON.parse(entity); } catch { entity = {}; }
    }
    entity = entity && typeof entity === "object" ? entity : {};
    const age = Number(row.age_months);
    return {
      name: String(row.name || "").trim(),
      state: String(entity.state || "").trim().toUpperCase(),
      ageMonths: Number.isFinite(age) ? age : null
    };
  }).filter((row) => row.name && /^[A-Z]{2}$/.test(row.state));
}

/** One Experian Business report per saved company. A miss is skipped. */
async function orderSavedBusinessReports(db, crs, { orgId, clientId }) {
  if (typeof crs?.orderBusinessReport !== "function") return [];
  let companies = [];
  try {
    companies = await loadSavedCompanies(db, { orgId, clientId });
  } catch (err) {
    console.error("crs-pull: could not read saved companies —", err?.message || err);
    return [];
  }
  const reports = [];
  for (const company of companies) {
    try {
      const out = await crs.orderBusinessReport({ name: company.name, state: company.state });
      if (out?.ok && out.report) {
        reports.push({
          name: company.name,
          state: company.state,
          ageMonths: company.ageMonths,
          bin: out.bin || null,
          report: out.report
        });
      }
    } catch (err) {
      console.error("crs-pull: business report skipped —", err?.message || err);
    }
  }
  return reports;
}

/**
 * The engine scores one business report. The oldest company is that report.
 * Each other company is scored on its own report and only its business
 * dollars are added, so personal funding is counted once.
 */
export function scoreBuyerTotal(runTierEngine, merged, tierOpts) {
  const reports = (Array.isArray(merged?.businessReports) ? merged.businessReports : [])
    .filter((row) => row && row.report);
  const ranked = [...reports].sort((a, b) => {
    const aa = Number.isFinite(Number(a.ageMonths)) ? Number(a.ageMonths) : -1;
    const bb = Number.isFinite(Number(b.ageMonths)) ? Number(b.ageMonths) : -1;
    return bb - aa;
  });
  const tierResult = runTierEngine(merged, {
    ...tierOpts,
    businessReport: ranked[0]?.report ?? null
  });
  const personal = Number(tierResult?.preapprovals?.totalPersonal);
  let businessSum = Number(tierResult?.preapprovals?.totalBusiness) || 0;
  for (const extra of ranked.slice(1)) {
    const next = runTierEngine(merged, { ...tierOpts, businessReport: extra.report });
    businessSum += Number(next?.preapprovals?.totalBusiness) || 0;
  }
  const fundingEstimate = Number.isFinite(personal)
    ? personal + businessSum
    : (tierResult?.preapprovals?.totalCombined ?? null);
  return { tierResult, fundingEstimate };
}

async function finishStored(db, {
  orgId,
  clientId,
  requestId,
  stored,
  identity = null,
  realIdentity = null,
  runTierEngine = runTierEngineFromCrsResult
}) {
  const merged = stored.crsResult.result || {};
  /* THE STORED PAYLOAD IS THE AUTHORITY ON WHETHER THIS WAS SIMULATED, not any
     argument passed in. A replay comes back through here carrying the original
     row, and reading the caller's flag would let a replay launder a simulated
     result into a real-looking one. Read the stamp off the thing that was
     stored, every time. */
  const simulated = merged.simulated === true;
  const tierIdentity = identityForTier({ identity, realIdentity, merged });
  const tierOpts = {
    submittedName: submittedNameFromIdentity(tierIdentity),
    submittedAddress: submittedAddressFromIdentity(tierIdentity),
    formData: {
      name: submittedNameFromIdentity(tierIdentity) || null,
      email: tierIdentity?.email || null,
      phone: null
    }
  };
  const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngine, merged, tierOpts);
  const outcomeTier = tierResult.outcome;

  await persistOutcomeTier(db, {
    clientId,
    crsResultId: stored.crsResult.id,
    outcomeTier,
    simulated
  });

  /* The stamp is added to the event payload only when it is true. A real pull's
     payload keeps the exact shape it has always had, so every stored event ever
     written means the same thing: no `simulated` key is a real pull. */
  const stamp = simulated ? { simulated: true, simulatedNotice: SIMULATED_MARKER } : {};

  /* The key is `newInquiries`, not `inquiries`. c-02-inquiry-created reads
     `payload.newInquiries` and src/adapters/crs.mjs has always emitted that name.
     This emitter used `inquiries`, so no real pull ever logged an inquiry, no
     specialist task was ever raised, and the Open Inquiries tile stayed empty.
     crs-pull.test.mjs pins the name so it cannot drift back. */
  const newInquiries = newInquiriesFor(merged);
  const analysis = await emit(db, "analysis.completed", {
    crsResultId: stored.crsResult.id,
    requestId,
    source: "crs",
    scores: merged.scores || { ex: null, eq: null, tu: null },
    bureaus: merged.bureaus || {},
    newInquiries,
    outcomeTier,
    ...stamp
  }, {
    orgId,
    clientId,
    idempotencyKey: `crs-result:${stored.crsResult.id}:analysis.completed:v1`
  });

  const decision = await emit(db, "decision.rendered", {
    crsResultId: stored.crsResult.id,
    requestId,
    source: "crs",
    outcomeTier,
    fundingEstimate,
    ...stamp
  }, {
    orgId,
    clientId,
    idempotencyKey: `crs-result:${stored.crsResult.id}:decision.rendered:v1`
  });

  return {
    ok: true,
    simulated,
    crsResultId: stored.crsResult.id,
    request: stored.request,
    replayed: !!stored.replayed,
    bureausPulled: merged.bureausPulled || [],
    bureauErrors: merged.bureauErrors || {},
    scores: merged.scores || { ex: null, eq: null, tu: null },
    outcomeTier,
    fundingEstimate,
    tradelinesIngested: stored.ingested,
    event: { id: analysis.id, deduped: !!analysis.deduped },
    events: {
      analysis: { id: analysis.id, deduped: !!analysis.deduped },
      decision: { id: decision.id, deduped: !!decision.deduped }
    }
  };
}

/**
 * loadClientIdentity — the real person, for a production pull only.
 *
 * Reads the full SSN through revealSsn(), which writes an access-log row in the
 * same transaction. That entry is the point: an automated pull is still a
 * disclosure of a protected value, and "a workflow did it" is an actor like any
 * other. It is NOT called on sandbox — see runCrsPull, which does not ask.
 *
 * Returns null when there is no identity on file. That is a refusal, not an
 * empty identity: a credit report cannot be ordered on a blank SSN.
 */
export async function loadClientIdentity(db, {
  clientId, env = process.env, accessedBy = PULL_ACTOR
} = {}) {
  const row = (await db.query(
    `SELECT c.first_name, c.last_name, c.email, p.dob, p.addresses,
            p.middle_name, p.name_suffix
       FROM clients c
       LEFT JOIN pii_identity p ON p.client_id = c.id
      WHERE c.id = $1`,
    [clientId]
  )).rows[0];
  if (!row) return null;

  let ssn = null;
  try {
    ({ ssn } = await revealSsn(db, {
      clientId, accessedBy, reason: "automated CRS soft pull", env
    }));
  } catch (e) {
    // No identity, no SSN, or no decryption key. All three mean "we cannot
    // order this report", and none of them should look like a vendor outage.
    if (e instanceof PiiError) return null;
    throw e;
  }
  if (!ssn) return null;

  return {
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    /* Migration 387. Sent blank on every pull before the $297 form asked for
       them. The request builder decides what each bureau can take. */
    middleName: row.middle_name ?? "",
    suffix: row.name_suffix ?? "",
    birthDate: isoBirthDate(row.dob) || "",
    ssn,
    email: row.email ?? undefined,
    addresses: Array.isArray(row.addresses) ? row.addresses : []
  };
}

/**
 * runCrsPull — order every bureau, store one result, emit one event.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {string} opts.clientId
 * @param {string} opts.requestId    The queued soft_pull_requests row. REQUIRED.
 * @param {object} [opts.identity]   Overrides the lookup. Ignored on sandbox.
 * @param {object} [opts.client]     Injected CRS client (tests).
 * @param {object} [opts.env]
 * @param {Function} [opts.fetchImpl]
 * @param {string[]} [opts.bureaus]
 * @param {boolean} [opts.simulate]  Exactly `true` rehearses the pull without
 *   contacting a bureau. Absent or `false` is a real pull. Anything else
 *   refuses — see simulationModeFor.
 */
export async function runCrsPull(db, {
  orgId,
  clientId,
  requestId,
  identity = null,
  client,
  env = process.env,
  fetchImpl,
  bureaus,
  accessedBy = PULL_ACTOR,
  simulate,
  runTierEngine = runTierEngineFromCrsResult
} = {}) {
  if (!orgId || !clientId) throw new TypeError("runCrsPull: orgId and clientId are required");
  /* Resolved once, at the top, from the argument alone. Never from an
     environment variable, never from the host, never from anything this
     function reads later — a pull is simulated because a caller said so in this
     call, or it is not simulated. */
  const mode = simulationModeFor(simulate);
  const simulated = mode === "simulated";
  /* REQUIRED, not optional. The ledger row is what makes a pull attributable and
     what stops a second one running; coordinateCrsResult() will not store a
     result without it, and quietly falling back to a path that does would put an
     unattributed credit pull in the history. */
  if (!requestId) throw new TypeError("runCrsPull: requestId is required");
  const order = (Array.isArray(bureaus) && bureaus.length)
    ? bureaus
    : activeBureausFromEnv(env);

  // This check happens before client construction or any provider call. A normal
  // replay of a fulfilled ledger request reuses its stored row and event.
  const ledger = await getSoftPullRequest(db, requestId);
  if (!ledger) throw new SoftPullError("no such soft pull request", { status: 404 });
  if (String(ledger.org_id) !== String(orgId) || String(ledger.client_id) !== String(clientId)) {
    throw new SoftPullError("soft pull request belongs to a different org or client", { status: 409 });
  }

  /* An unreadable `simulate` closes the ledger row and stops. It is refused
     here rather than at the top of the function so that the row this caller
     opened is closed on the way out — a request left at 'queued' blocks every
     later pull for this client (090's one-open-per-client index), so refusing
     without closing would turn a typo into a locked-out client. */
  if (mode === "refuse") {
    return finishFailed(db, {
      requestId,
      code: "simulate_ambiguous",
      reason: "refusing the pull — `simulate` must be exactly true or false; " +
        "a value that is neither is not read as either",
      simulated: false
    });
  }

  if (ledger.status === "fulfilled") {
    const prior = (await db.query(
      `SELECT id, org_id, client_id, provider, provider_result_id, result, outcome_tier, created_at
         FROM crs_results WHERE id = $1`,
      [ledger.crs_result_id]
    )).rows[0];
    if (!prior || !prior.provider || !prior.provider_result_id) {
      throw new SoftPullError("fulfilled request has no anchored provider result", { status: 409 });
    }
    /* A REPLAY MUST ANSWER THE QUESTION THAT WAS ASKED.
       Reuse an idempotency key across a rehearsal and a real pull and the same
       ledger row answers both. Handing the stored row back either way would let
       a real pull be "satisfied" by a rehearsal that never contacted anyone —
       the caller would be told a bureau answered when none did. Refused in both
       directions, so neither mode can be quietly served the other's result. */
    const priorSimulated = prior.result?.simulated === true;
    if (priorSimulated !== simulated) {
      return {
        ok: false,
        simulated,
        code: "simulation_mismatch",
        reason: priorSimulated
          ? "this request was already answered by a SIMULATED pull and cannot be replayed as a real bureau pull — start a new request"
          : "this request was already answered by a real bureau pull and cannot be replayed as a simulation — start a new request",
        request: null,
        crsResultId: null
      };
    }
    const replayed = await coordinateCrsResult(db, {
      orgId,
      clientId,
      requestId,
      provider: prior.provider,
      providerResultId: prior.provider_result_id,
      result: prior.result,
      outcomeTier: prior.outcome_tier
    });
    return finishStored(db, {
      orgId,
      clientId,
      requestId,
      stored: replayed,
      identity,
      realIdentity: null,
      runTierEngine
    });
  }

  /* EXCLUSIVE CLAIM BEFORE ANY PROVIDER CALL. A SELECT of QUEUED is only
     a snapshot: another worker may win the atomic UPDATE before this one.
     ONLY the queued -> processing UPDATE winner may cross the bureau fence.
     A losing or preexisting processing request needs manual reconciliation,
     not a second credit order. No automatic retry of ambiguous provider work. */
  if (ledger.status !== "queued") {
    throw new SoftPullError(`soft pull request is already ${ledger.status}`, {
      status: 409,
      code: ledger.status === "processing" && ledger.requested_by_kind === "system"
        ? "request_already_claimed" : null
    });
  }
  const claim = await claimSoftPull(db, { requestId, orgId, clientId });
  if (!claim.claimed) {
    throw new SoftPullError(`soft pull request is already ${claim.reason}`, {
      status: 409,
      code: claim.reason === "already_claimed" && ledger.requested_by_kind === "system"
        ? "request_already_claimed" : null
    });
  }

  const crs = client || createCrsClient({ env, fetchImpl });

  // A configuration fault is permanent until configuration changes. Failing the
  // request rather than throwing keeps a workflow from retrying a condition no
  // retry can fix, and leaves the reason where a human will read it.
  if (!crs.isConfigured()) {
    return finishFailed(db, {
      requestId,
      code: "not_configured",
      reason: `CRS is not configured — missing ${crs.config.missing.join(", ")}`,
      simulated
    });
  }

  const host = crs.host;
  const hostEnvironment = environmentFor(host);
  /* See WHY THE STAMP REUSES THE WORD "sandbox" in the file header. The host
     class is not discarded — it rides along as result.hostEnvironment. */
  const environment = simulated ? "sandbox" : hostEnvironment;

  /* The real client is loaded ONLY when the host is production. On sandbox the
     vendor's canned people are used and the client's SSN is never decrypted,
     never logged as accessed, and never sent anywhere. That is the difference
     between "we do not send it" and "we cannot send it". */
  let realIdentity = identity;
  if (isProductionHost(host) && !realIdentity) {
    realIdentity = await loadClientIdentity(db, { clientId, env, accessedBy });
    if (!realIdentity) {
      return finishFailed(db, {
        requestId,
        code: "identity_required",
        reason: "no identity on file for this client — a credit report cannot be ordered",
        simulated
      });
    }
  }

  const reports = {};
  const errors = {};
  const requestIds = {};
  /* file_returned | frozen | no_file | error, per bureau asked. Only a
     returned file goes into `reports`; a frozen or empty answer is an error
     for that bureau with its status kept beside it (crs-client reportResult). */
  const statuses = {};

  for (const bureau of order) {
    let bureauIdentity;
    try {
      bureauIdentity = identityForBureau({
        host, bureau, identity: realIdentity, env
      });
    } catch (e) {
      if (e instanceof CrsIdentityError) {
        return finishFailed(db, { requestId, code: e.code, reason: e.message, simulated });
      }
      throw e;
    }
    if (!bureauIdentity) {
      return finishFailed(db, {
        requestId,
        code: "identity_required",
        reason: "no identity on file for this client — a credit report cannot be ordered",
        simulated
      });
    }

    let out;
    try {
      /* ═══ THE FENCE ═══
         This is the only line in the pull that reaches a credit bureau, and it
         is the only line a simulation replaces. Everything above it has already
         run for real on both paths: the ledger claim, the CRS configuration
         check, the SSN decryption and its access-log row, and the identity
         gate. Everything below it runs for real on both paths too.

         The simulated branch calls assertIdentityAllowed itself because that
         gate normally lives INSIDE orderPrequal (src/finance/crs-client.mjs,
         "THE GATE" in orderPrequal), and skipping the vendor call would
         otherwise skip the gate with it. On the production host identityForBureau
         has already run the same check, so this is a second pass; on the sandbox
         host it is the only one. A fence that quietly relaxes a gate is not a
         rehearsal of the real flow, it is a different flow.

         A saved company is a second call, orderBusinessReport, after the
         personal bureaus. A simulation skips that call too. A company the
         bureau cannot find does not fail the personal pull. */
      if (simulated) {
        assertIdentityAllowed({ host, bureau, identity: bureauIdentity, env });
        out = simulatedBureauResponse({ bureau, requestId });
      } else {
        out = await crs.orderPrequal({ bureau, identity: bureauIdentity });
      }
    } catch (e) {
      /* A refused identity or an unconfigured client is a fault about the whole
         pull, not weather at one bureau. Stopping means the same refused
         identity is never offered to the other two. */
      if (e instanceof CrsIdentityError
          || (e instanceof CrsError && e.code === "not_configured")) {
        return finishFailed(db, { requestId, code: e.code, reason: e.message, simulated });
      }
      if (e instanceof CrsError) { errors[bureau] = e.message; statuses[bureau] = "error"; continue; }
      throw e;
    }

    if (out.requestId) requestIds[bureau] = out.requestId;
    if (out.ok && out.report) reports[bureau] = out.report;
    else errors[bureau] = out.error || `no report returned by ${bureau}`;
    statuses[bureau] = out.fileStatus || (out.ok && out.report ? "file_returned" : "error");
  }

  const businessReports = (!simulated && Object.keys(reports).length > 0)
    ? await orderSavedBusinessReports(db, crs, { orgId, clientId })
    : [];

  if (Object.keys(reports).length === 0) {
    const detail = Object.entries(errors)
      .map(([b, e]) => `${b}: ${statuses[b] && statuses[b] !== "error" ? `[${statuses[b]}] ` : ""}${e}`)
      .join(" | ");
    return finishFailed(db, {
      requestId,
      code: "no_reports",
      reason: detail ? `no bureau returned a report — ${detail}` : "no bureau returned a report",
      simulated
    });
  }

  const providerResultId = providerResultIdFor({ requestIds, simulated });
  if (!providerResultId) {
    return finishFailed(db, {
      requestId,
      code: "provider_result_id_required",
      reason: "CRS returned reports without any RequestID; the result cannot be safely stored",
      simulated
    });
  }

  /* The stamp goes on the payload here, after the merge rather than through it:
     mergeBureauReports maps bureau reports and has no business knowing whether
     a pull happened. Spreading it on afterwards also means a real payload keeps
     byte-for-byte the shape it has always had. */
  const mergedBase = mergeBureauReports({ reports, errors, statuses, requestIds, environment });
  if (businessReports.length) mergedBase.businessReports = businessReports;
  const merged = simulated
    ? {
        ...mergedBase,
        simulated: true,
        simulatedNotice: SIMULATED_MARKER,
        hostEnvironment
      }
    : mergedBase;

  /* ONE ROW, ONE TRANSACTION. Storing the result, closing the request and
     ingesting the tradelines either all land or none do. A replay of the same
     provider response comes back as `replayed: true` with the original row
     rather than a second one. */
  let stored;
  try {
    stored = await coordinateCrsResult(db, {
      orgId,
      clientId,
      requestId,
      provider: simulated ? CRS_SIMULATED_PROVIDER : CRS_PROVIDER,
      providerResultId,
      result: merged,
      outcomeTier: null
    });
  } catch (e) {
    /* The bureaus answered; the ledger would not take the answer. Not closed as
       failed here: coordinateCrsResult refuses precisely when the row is
       already fulfilled or contested, and stamping 'failed' over that would
       overwrite a good record with a wrong one. */
    if (e instanceof SoftPullError) {
      return { ok: false, simulated, code: "not_stored", reason: e.message, request: null, crsResultId: null };
    }
    throw e;
  }

  return finishStored(db, {
    orgId,
    clientId,
    requestId,
    stored,
    identity,
    realIdentity,
    runTierEngine
  });
}

/* finishFailed — record why nothing was stored, then say so.
   Closing the ledger row matters more than it looks: a row left at 'queued'
   blocks the next request (090's one-open-per-client index), so a pull that
   quietly died would lock the client out of ever being pulled again. */
async function finishFailed(db, { requestId, reason, code, simulated = false }) {
  let closed = null;
  if (requestId) {
    try {
      closed = await closeSoftPull(db, { requestId, status: "failed", reason });
    } catch (e) {
      // Already resolved, or gone. The pull still failed and the caller still
      // needs the reason; losing it to a bookkeeping error is the worse outcome.
      if (!(e instanceof SoftPullError)) throw e;
    }
  }
  return { ok: false, simulated, code: code || "failed", reason, request: closed, crsResultId: null };
}
