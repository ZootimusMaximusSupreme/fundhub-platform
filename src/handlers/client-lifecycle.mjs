// Client-lifecycle handlers — Master Rebuild Spec Phase 2 (the "reactions" layer).
//
// Adapters emit canonical events; THESE react by writing domain state to Postgres.
// This is the platform replacement for what the old CRM and spreadsheet did: keep a client row,
// record payments, store CRS results, stamp the outcome. Everything here is
// IDEMPOTENT (Rule 9): the bus dedupes normal deliveries, and replay() re-drives
// events — so a handler that runs twice must not double-write. We lean on:
//   - clients_org_email_uniq         (one client per org+email)
//   - transactions_org_providerref_uniq (one transaction per provider ref)
// (both from migration 003) plus column-set updates (naturally idempotent).
//
// Register once at boot: `import { register } from "./handlers/client-lifecycle.mjs"; register();`

import { on } from "../events/registry.mjs";
import { logStaffEvent } from "../shifts/telemetry.mjs";
import { resolveShiftId } from "../shifts/attribution.mjs";
import { upsertClientAdAttribution } from "../ads/store.mjs";
import { ensureCrmContactId, config as crmConfig } from "../messaging/crm-contacts.mjs";
import { adaptersBlocked } from "../lib/dry-run.mjs";
import { upsertSurveyCarbonCopy } from "./client-custom-fields.mjs";
import { stampQualificationBucket } from "../config/survey-qualification.mjs";
import { addTags } from "../workflows/tags.mjs";
import { demoFlagForEmail } from "../demo/test-identity.mjs";
import { advanceCardToStage } from "../workflows/cards.mjs";
import { evaluateWaypoints } from "../waypoints/verify.mjs";
// The one E.164 converter in the repo. Reused, not re-written (CLAUDE.md §8).
import { normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { syncSloClickfunnelsContact } from "../slo/cf-contact.mjs";
import { surveyIsComplete } from "../survey/cf-question-map.mjs";
import { creditTierFor } from "../config/survey-qualification.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import {
  paymentFactsFromEvent,
  paymentFactsFromRow,
  reconcileProviderRefTransaction
} from "./client-lifecycle-payment-ref.mjs";

export { PaymentProviderRefConflictError } from "./client-lifecycle-payment-ref.mjs";

// Last question on the CF apply survey (Available Capital).
// marketing/landing-pages/clickfunnels/cf-survey-ground-truth.md — Survey Complete only when this lands.
// The same rule decides when the ClickFunnels adapter emits survey.completed.
const answersIncludeSurveyComplete = surveyIsComplete;

const BUCKET_KEYS = ["cf_svy_self_reported_fico", "cf_svy_self_reported_fico_label", "svy_self_reported_fico"];
function answersTouchBucket(answers) {
  return BUCKET_KEYS.some((key) => Object.prototype.hasOwnProperty.call(answers, key));
}

// --- helpers ----------------------------------------------------------------

// Split a single "First Last" display name into first/last (best-effort).
export function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Stamp a visible warning on the client when the CRM linkage is missing. */
async function markCrmLinkMissing(db, clientId, reason) {
  try {
    await db.query(
      `UPDATE clients
          SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
            || jsonb_build_object(
                 'ghl_link_missing', true,
                 'ghl_link_missing_reason', $2::text,
                 'ghl_link_missing_at', to_jsonb(now()::text)
               )
        WHERE id = $1`,
      [clientId, String(reason || "unknown").slice(0, 200)]
    );
  } catch {
    /* custom_fields must not block client creation */
  }
}

/**
 * Best-effort the CRM contact sync for a just-created client.
 *
 * Decision (2026-08-04): never leave ghl_contact_id null silently.
 *   1. When GHL_API_KEY is set — find-or-create regardless of sms routing
 *      (relay may turn on later; the contact should already exist).
 *   2. When the ADAPTERS_DRY_RUN fence is up — stamp a local placeholder so
 *      verification and CRM screens are not blank. Checked FIRST, before the
 *      key, because checking it after meant it never ran in production.
 *   3. Otherwise — console.warn + custom_fields.ghl_link_missing so an
 *      operator can see the client cannot receive SMS via the relay.
 *
 * NEVER throws and NEVER blocks client creation.
 */
async function syncCrmContact(db, { clientId, orgId, email, phone, firstName, lastName }, opts = {}) {
  const env = opts.env || process.env;
  if (!email && !phone) {
    console.warn(
      `[client-lifecycle] client ${clientId}: no email/phone — cannot link a CRM contact`
    );
    await markCrmLinkMissing(db, clientId, "no_identifier");
    return;
  }

  try {
    /* THE FENCE COMES FIRST. It used to sit below the `cfg.ok` branch, which
       returns whenever GHL_API_KEY is set — so in production, where the key is
       set, the dry-run branch was unreachable and the sync called the CRM
       no matter what the flag said. Order was the whole bug. */
    if (adaptersBlocked(env)) {
      const placeholder = `dry-ghl-${String(clientId).replace(/-/g, "").slice(0, 12)}`;
      await db.query(
        `UPDATE clients
            SET ghl_contact_id = COALESCE(ghl_contact_id, $1),
                custom_fields = COALESCE(custom_fields, '{}'::jsonb)
                  || jsonb_build_object('ghl_link_dry_run', true)
          WHERE id = $2`,
        [placeholder, clientId]
      );
      console.warn(
        `[client-lifecycle] client ${clientId}: ADAPTERS_DRY_RUN fence is up — ` +
        `stamped placeholder ${placeholder} and did not call the CRM`
      );
      return;
    }

    const cfg = crmConfig(env);
    if (cfg.ok) {
      const result = await ensureCrmContactId(
        db,
        { id: clientId, email, phone, first_name: firstName, last_name: lastName },
        opts
      );
      if (result.ok) return;
      console.warn(
        `[client-lifecycle] client ${clientId}: the CRM link failed (${result.reason}). ` +
        `SMS via ghl_relay will not work until this is fixed.`
      );
      await markCrmLinkMissing(db, clientId, result.reason);
      return;
    }

    console.warn(
      `[client-lifecycle] client ${clientId}: GHL_API_KEY unset — ghl_contact_id left null. ` +
      `This client cannot receive SMS through the CRM relay.`
    );
    await markCrmLinkMissing(db, clientId, "not_configured");
  } catch (err) {
    console.warn(
      `[client-lifecycle] client ${clientId}: the CRM sync threw (${String(err && err.message || err).slice(0, 120)})`
    );
    await markCrmLinkMissing(db, clientId, "exception");
  }
}

// Resolve the platform client for an event: prefer an explicit clientId on the
// event, else find-or-create by (org, email). Returns a client uuid or null.
//
// `opts` ({ fetchImpl, env }) is the CRM contact-sync test seam — every real
// call site omits it and gets globalThis.fetch / process.env, same default as
// every provider in src/messaging/providers/.
async function backfillCrmLinkIfMissing(db, clientId, orgId, p, opts = {}) {
  if (!clientId || !orgId) return clientId;
  const { rows } = await db.query(
    `SELECT id, ghl_contact_id, email, phone, first_name, last_name
       FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  const row = rows[0];
  if (!row) return clientId;
  if (row.ghl_contact_id) return clientId;

  const { firstName, lastName } = splitName(p?.name);
  await syncCrmContact(db, {
    clientId,
    orgId,
    email: row.email || (p?.email ? String(p.email).trim().toLowerCase() : null),
    phone: row.phone || p?.phone || null,
    firstName: row.first_name || firstName,
    lastName: row.last_name || lastName
  }, opts);
  return clientId;
}

/* contactPhone — store a phone number the way a provider can dial it.
 *
 * Three other sign-up doors (api/public/survey-submit.mjs,
 * api/public/education-enroll.mjs, api/public/optimize.mjs) already run the
 * number through this same converter on the way in. This door — the funnel
 * event handler — did not, so it stored "(661) 605-4248" exactly as the form
 * typed it. Twilio refuses anything that is not E.164, and on 2026-09-17 that
 * is why the welcome text, the booking confirmation and a pay link all failed
 * for the two clients who came in through here.
 *
 * A number that cannot be converted is kept EXACTLY as typed rather than
 * dropped or guessed at: the converter only handles the unambiguous cases
 * (already +international, ten digits, or eleven starting with 1).
 */
function contactPhone(raw) {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  return normalizePhone(s) || s;
}

/** A fresh apply form or booking is the client's latest contact instruction. */
async function patchClientContact(db, clientId, p = {}, overwrite = false) {
  if (!clientId) return;
  const { firstName, lastName } = splitName(p.name);
  // Never replace a usable number with text that cannot be dialed.
  const phone = overwrite ? normalizePhone(p.phone) : contactPhone(p.phone);
  if (!phone && !firstName && !lastName) return;
  await db.query(
    `UPDATE clients SET
       phone = ${overwrite ? "COALESCE($2, NULLIF(phone, ''))" : "COALESCE(NULLIF(phone, ''), $2)"},
       first_name = ${overwrite ? "COALESCE($3, NULLIF(first_name, ''))" : "COALESCE(NULLIF(first_name, ''), $3)"},
       last_name = ${overwrite ? "COALESCE($4, NULLIF(last_name, ''))" : "COALESCE(NULLIF(last_name, ''), $4)"},
       updated_at = now()
     WHERE id = $1`,
    [clientId, phone, firstName, lastName]
  );
}

export async function resolveClient(db, event, opts = {}) {
  const orgId = event.orgId;
  const p = event.payload || {};
  const overwriteContact = p.source === "clickfunnels" &&
    (p.funnel === "apply-survey" || event.name === "booking.created" || event.name === "booking.rescheduled");
  if (event.clientId) {
    // The event envelope is not proof of tenant ownership. Before updating any
    // contact detail, CRM link, sales stage or payment/decision state, require
    // the referenced buyer to exist in this exact organization. A foreign or
    // stale client UUID must not be accepted as a local customer.
    if (!orgId) return null;
    const owned = await db.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [event.clientId, orgId]
    );
    if (!owned.rows[0]) return null;
    // Explicit id still needs a CRM link when missing — lead capture often
    // creates the row first, then emits with clientId set.
    await patchClientContact(db, event.clientId, p, overwriteContact);
    // A guarded, local-only sample decision updates the existing Fundhub file
    // without creating an external CRM contact for a fictional buyer.
    if (opts.skipCrmLink === true) return event.clientId;
    return backfillCrmLinkIfMissing(db, event.clientId, orgId, p, opts);
  }
  const email = String(p.email || "").trim().toLowerCase();
  if (!orgId || !email) return null;

  const found = await db.query(
    `SELECT id, ghl_contact_id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  if (found.rows[0]) {
    await patchClientContact(db, found.rows[0].id, p, overwriteContact);
    // Existing row with a null the CRM id is the silent-null hazard — backfill.
    return backfillCrmLinkIfMissing(db, found.rows[0].id, orgId, p, opts);
  }

  const { firstName, lastName } = splitName(p.name);
  const ins = await db.query(
    // is_demo is set from the address, not from anything the caller passes, so a
    // hand-made test signup is disposable from birth. See src/demo/test-identity.mjs.
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, channel_source, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, lower(email)) WHERE email IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, email, firstName, lastName, contactPhone(p.phone), p.source || null,
     demoFlagForEmail(email)]
  );
  if (ins.rows[0]) {
    const clientId = ins.rows[0].id;
    await syncCrmContact(db, { clientId, orgId, email, phone: contactPhone(p.phone), firstName, lastName }, opts);
    return clientId;
  }

  // Lost an insert race (or already existed) — re-select and backfill if needed.
  const re = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  if (!re.rows[0]) return null;
  await patchClientContact(db, re.rows[0].id, p, overwriteContact);
  return backfillCrmLinkIfMissing(db, re.rows[0].id, orgId, p, opts);
}

// Merge a partial object into clients.custom_fields (jsonb). No-op on empty.
async function mergeCustomFields(db, clientId, patch) {
  if (!clientId || !patch || Object.keys(patch).length === 0) return;
  await db.query(
    `UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`,
    [clientId, JSON.stringify(patch)]
  );
}

// --- handlers ---------------------------------------------------------------

// entry.captured — ensure client + Sales board card (new_lead).
// Card placement is sync here so Pipeline UI updates even when Inngest cannot
// invoke functions (missing INNGEST_SIGNING_KEY / sync failure). s-01 also
// places the card; advanceCardToStage never demotes.
function attributionFields(payload) {
  const a = payload && payload.attribution;
  if (!a || typeof a !== "object") return {};
  const out = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_path", "referrer_domain"]) {
    if (a[key] != null && String(a[key]).trim() !== "") out[key] = String(a[key]).trim();
  }
  if (out.landing_path === "/watch") out.lead_magnet_type = "VSL";
  else if (out.landing_path === "/apply") out.lead_magnet_type = "Survey";
  return out;
}

export async function onEntryCaptured(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId || !event.orgId) return;
  await mergeCustomFields(db, clientId, {
    lifecycle_status: "New Lead",
    ...attributionFields(event.payload)
  });
  // The typed attribution row (286): lane / ad_id / variant derived in the
  // database from the raw UTMs. Non-fatal on purpose — a lead is never lost
  // because its ad tag was odd; the jsonb copy above already has the raw values.
  try {
    await upsertClientAdAttribution(db, {
      orgId: event.orgId, clientId, attribution: event.payload && event.payload.attribution
    });
  } catch (err) {
    console.warn(`[client-lifecycle] ad attribution row not written for ${clientId}: ${String(err?.message || err)}`);
  }
  await addTags(db, clientId, ["lead:new"]);
  // advance only — later CF contact.updated must not yank a booked card back.
  await advanceCardToStage(db, {
    orgId: event.orgId,
    clientId,
    pipelineKey: "sales",
    stageKey: "new_lead"
  });
}

// survey.submitted — fold answers into clients.custom_fields (jsonb) and the
// typed client_custom_fields carbon-copy (sales/agent joins). A score answer also
// stamps the funding call bucket (qualification_bucket). When the CF last
// question (cf_svy_available_capital) is present, advance to survey_complete.
export async function onSurveySubmitted(event, db) {
  const clientId = await resolveClient(db, event);
  const answers = event.payload && event.payload.answers;
  if (clientId && answers && typeof answers === "object") {
    await mergeCustomFields(db, clientId, answers);
    if (event.orgId) {
      await upsertSurveyCarbonCopy(db, { clientId, orgId: event.orgId, answers });
    }
    await saveCreditTier(db, clientId, answers);
    // Bucket persistence cannot block survey answers or the stage move.
    if (answersTouchBucket(answers)) {
      try {
        await stampQualificationBucket(db, clientId);
      } catch (err) {
        console.warn(`[client-lifecycle] qualification bucket not stamped for ${clientId}: ${String(err?.message || err)}`);
      }
    }
  }
  if (clientId && event.orgId && answersIncludeSurveyComplete(answers)) {
    await mergeCustomFields(db, clientId, { lifecycle_status: "Survey Complete" });
    await advanceCardToStage(db, {
      orgId: event.orgId,
      clientId,
      pipelineKey: "sales",
      stageKey: "survey_complete"
    });
  }
}

/* credit_tier — the owner's two buckets (2026-10-29), saved on the person so every
   screen and report reads one word: "qualified" (700 and up) or "unqualified".
   Worked out by creditTierFor from the saved fields, so a setter's earlier score
   fix still wins. Booking links do not read this copy; they run the same rule on
   the live answer (tierBookingLink), so the two cannot disagree for long. */
async function saveCreditTier(db, clientId, answers) {
  if (!Object.prototype.hasOwnProperty.call(answers, "cf_svy_self_reported_fico")
    && !Object.prototype.hasOwnProperty.call(answers, "cf_svy_self_reported_fico_label")
    && !Object.prototype.hasOwnProperty.call(answers, "svy_self_reported_fico")) return;
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const fields = r.rows[0]?.custom_fields || {};
  const tier = creditTierFor(fields);
  if (tier && fields.credit_tier !== tier) await mergeCustomFields(db, clientId, { credit_tier: tier });
}

const TRANSACTION_INSERT_COLS =
  `(org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload)`;

function transactionInsertParams(facts) {
  return [
    facts.orgId,
    facts.clientId,
    facts.productName,
    facts.amountPaid,
    facts.status,
    facts.provider,
    facts.providerRef,
    JSON.stringify(facts.rawPayload)
  ];
}

async function insertTransactionRow(tx, facts) {
  await tx.query(
    `INSERT INTO transactions ${TRANSACTION_INSERT_COLS}
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    transactionInsertParams(facts)
  );
}

async function tryInsertTransactionRow(tx, facts) {
  const r = await tx.query(
    `INSERT INTO transactions ${TRANSACTION_INSERT_COLS}
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL
     DO NOTHING
     RETURNING id, org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload`,
    transactionInsertParams(facts)
  );
  return r.rows[0] || null;
}

async function lockTransactionRow(tx, orgId, providerRef) {
  const locked = await tx.query(
    `SELECT id, org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload
       FROM transactions
      WHERE org_id = $1 AND provider_ref = $2
      FOR UPDATE`,
    [orgId, providerRef]
  );
  return locked.rows[0] || null;
}

// Record a transaction row (deduped by provider_ref). Shared by the paid + failed
// handlers — same shape, different status. Conflicting reuse of a provider_ref
// throws PaymentProviderRefConflictError (retryable); a failed row may upgrade
// atomically when the same ref later succeeds for the same verified facts.
async function recordTransaction(event, db, status) {
  const clientId = await resolveClient(db, event);
  const incoming = paymentFactsFromEvent(event, clientId, status);
  if (!incoming.providerRef) {
    await insertTransactionRow(db, incoming);
    return;
  }

  await withTransaction(db, async (tx) => {
    if (await tryInsertTransactionRow(tx, incoming)) return;

    let row = await lockTransactionRow(tx, incoming.orgId, incoming.providerRef);
    if (!row) {
      if (await tryInsertTransactionRow(tx, incoming)) return;
      row = await lockTransactionRow(tx, incoming.orgId, incoming.providerRef);
    }
    if (!row) {
      throw new Error(`payment provider_ref ${incoming.providerRef} missing after insert collision`);
    }

    const decision = reconcileProviderRefTransaction(paymentFactsFromRow(row), incoming);
    if (decision.action === "noop") return;
    if (decision.action === "upgrade") {
      await tx.query(
        `UPDATE transactions
            SET status = 'succeeded',
                raw_payload = raw_payload || $2::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [row.id, decision.rawPayloadPatch]
      );
      return;
    }
    if (decision.action === "insert") {
      throw new Error(`payment provider_ref ${incoming.providerRef} reconcile returned insert on locked row`);
    }
  });
}

// payment.received — record the money-in as a succeeded transaction row.
export async function onPaymentReceived(event, db) {
  await recordTransaction(event, db, "succeeded");
}

// payment.failed — record the attempt as a failed transaction (don't lose it).
export async function onPaymentFailed(event, db) {
  await recordTransaction(event, db, "failed");
}

// diagnostic.paid ($32) / deposit.paid / sale.closed — stamp a flag on the client.
// custom_fields flags mirror the CRM fields the live system flips (crs_paid etc).
export async function onDiagnosticPaid(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return;
  await mergeCustomFields(db, clientId, { crs_paid: true });
  // Board card — same sync placement as entry.captured. Without this the
  // Diagnostic Paid column stays empty even when money cleared.
  if (event.orgId) {
    await advanceCardToStage(db, {
      orgId: event.orgId,
      clientId,
      pipelineKey: "sales",
      stageKey: "diagnostic_paid"
    });
  }
}
export async function onDepositPaid(event, db) {
  const clientId = await resolveClient(db, event);
  await mergeCustomFields(db, clientId, { deposit_paid: true });
}
export async function onSaleClosed(event, db) {
  const clientId = await resolveClient(db, event);
  await mergeCustomFields(db, clientId, { sale_closed: true });
}

// analysis.completed — store the CRS result as history (ports latest_crs_result_full).
// Deduped by (client_id, event id) carried in result.__event_id so replay is safe.
//
// This INSERT is the line where "a credit pull ran" becomes true, so it is where
// the `pull_run` staff telemetry belongs. THE SEAM IS EMPTY TODAY: the pull is
// requested and returned entirely by automation reacting to the client's $32
// diagnostic payment, and the event carries orgId/clientId and no staff member —
// so `staffId` is never present and no row is written. Under the 05/30 model
// drift the pull runs live on the call, which gives it an actor for the first
// time; when the emitter carries one, this reads it. It is not invented here.
/* THE CLIENT'S CHECKLIST, RE-READ AGAINST THE PULL THAT JUST LANDED.

   MEASURED ON THIS BRANCH BEFORE THIS FUNCTION EXISTED: evaluateWaypoints() had
   NO production caller at all. A grep across the branch found it in test files
   and nowhere else. So a client who actually paid a card down was told to pay it
   down forever — the checklist could be created and never closed.

   WHY HERE. analysis.completed is the moment a credit pull's result becomes a
   stored fact (the INSERT below is that line), and re-reading the checklist is
   exactly a reaction to a stored fact, which is what this file is for. It is the
   same shape enrolment uses for seeding: called beside the write that already
   happens, not behind a new trigger of its own.

   BEST-EFFORT, AND THAT IS LOAD-BEARING. By the time this runs the pull is
   already stored. A checklist that could not be re-read is a checklist to fix;
   it is not a reason to fail the event and lose the pull, so nothing in here is
   allowed to throw. It is also outside every transaction in src/finance/
   soft-pulls.mjs, so it cannot roll one back.

   IDEMPOTENT. A replayed event re-reads the same file and reaches the same
   verdicts: a row already done is not in listVerifiableWaypoints() at all, and
   blocking a row that is already blocked writes the same reason again. */
async function reviewClientChecklist(db, { orgId, clientId }) {
  if (!orgId || !clientId) return null;
  try {
    return await evaluateWaypoints(db, { orgId, clientId });
  } catch {
    /* Swallowed on purpose. There is no channel from here that a failure should
       reach: the pull or the file is already stored, and a waypoint left open
       is the safe direction for every check this runs. */
    return null;
  }
}

async function reviewChecklistAfterPull(db, { orgId, clientId }) {
  return reviewClientChecklist(db, { orgId, clientId });
}

/**
 * docs.received — close document-proof waypoints (mailing receipt, bureau
 * letter) when the file lands. Same judge as a re-pull; no credit file needed
 * for those kinds. Measured live 2026-09-30: Sim Eleven upload stored the
 * receipt and left blueprint_dispute_mail_receipt open until evaluateWaypoints
 * was called by hand.
 */
export async function onDocsReceivedReviewChecklist(event, db) {
  const orgId = event?.orgId;
  const clientId = event?.clientId || event?.payload?.client_id || null;
  return reviewClientChecklist(db, { orgId, clientId });
}

export async function onAnalysisCompleted(event, db, opts = {}) {
  const clientId = await resolveClient(db, event, opts);
  if (!clientId) return;

  const crsResultId = event.payload?.crsResultId ?? null;
  if (crsResultId) {
    const anchored = (await db.query(
      `SELECT id, org_id, client_id FROM crs_results WHERE id = $1`,
      [crsResultId]
    )).rows[0];
    if (!anchored) throw new Error("analysis.completed names a missing crs_results row");
    if (String(anchored.org_id) !== String(event.orgId)
        || String(anchored.client_id) !== String(clientId)) {
      throw new Error("analysis.completed crs_results row belongs to a different org or client");
    }


    // Reuse the durable row. Canonical analysis fields are merged into the raw
    // provider object because downstream underwriting reads them there; the
    // provider payload remains intact and no second history row is created.
    const canonical = {
      scores: event.payload?.scores,
      utilization: event.payload?.utilization,
      reasonCodes: event.payload?.reasonCodes,
      newInquiries: event.payload?.newInquiries,
      source: event.payload?.source
    };
    await db.query(
      `UPDATE crs_results
          SET result = result || $2::jsonb,
              outcome_tier = COALESCE(outcome_tier, $3),
              updated_at = now()
        WHERE id = $1`,
      [crsResultId, JSON.stringify(canonical), event.payload?.outcomeTier ?? null]
    );
    if (!opts.skipChecklist) await reviewChecklistAfterPull(db, { orgId: event.orgId, clientId });
    return;
  }

  const result = { ...(event.payload || {}), __event_id: event.id };
  // Legacy unanchored events keep their event-id replay guard and insert path.
  const dup = await db.query(
    `SELECT 1 FROM crs_results WHERE client_id = $1 AND result->>'__event_id' = $2 LIMIT 1`,
    [clientId, String(event.id)]
  );
  if (dup.rows[0]) return;
  await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier) VALUES ($1,$2,$3,$4)`,
    [event.orgId, clientId, JSON.stringify(result), event.payload?.outcomeTier || null]
  );

  // Below the dedupe return above, so a replayed pull cannot be counted twice
  // against whoever ran it. logStaffEvent never throws; the result row is
  // already written and nothing here can take it back.
  const staffId = event.payload?.staffId ?? null;
  if (staffId) {
    await logStaffEvent(db, {
      orgId: event.orgId,
      staffId,
      shiftId: await resolveShiftId(db, { staffId, shiftId: event.payload?.shiftId }),
      kind: "pull_run",
      detail: {
        client_id: clientId,
        event_id: String(event.id),
        // The bureau payload itself is NOT copied in — it is the consumer's
        // credit file. The tier is the one summary a telemetry reader needs.
        outcome_tier: event.payload?.outcomeTier ?? null
      }
    });
  }

  await reviewChecklistAfterPull(db, { orgId: event.orgId, clientId });
}

// decision.rendered — stamp the 6-tier outcome + funding estimate on the client.
export async function onDecisionRendered(event, db, opts = {}) {
  const clientId = await resolveClient(db, event, opts);
  if (!clientId) return;
  const p = event.payload || {};
  if (p.outcomeTier) {
    await db.query(`UPDATE clients SET outcome_tier = $2 WHERE id = $1`, [clientId, p.outcomeTier]);
  }
  if (p.fundingEstimate != null) {
    // `analyzer_prequal_amount` had no writer anywhere in the codebase (see the "Adjacent
    // bug" note in workflow-migration-table.md), so the AI-SET-03 and AI-SET-04 SMS copy —
    // "you've been pre-approved for {{contact.analyzer_prequal_amount}} in capital" — merged
    // an always-empty field. Fixed here rather than by repointing the templates at
    // total_funding_estimate: db/schema/005 and the CRM custom-field map both carry
    // analyzer_prequal_amount as its own MONETORY field, and that ported copy is already
    // flagged for a rewrite pass — changing its merge tag now would collide with that.
    //
    // Both mirror one figure: decision.rendered carries a single dollar amount
    // (crs.mjs:mapToCanonical → payload.fundingEstimate), so both are written from it.
    // Stored raw, like total_funding_estimate — consumers format it themselves.
    // Display formatting for the merge tag belongs with the AI-SET copy
    // rewrite, not invented here.
    await mergeCustomFields(db, clientId, {
      total_funding_estimate: p.fundingEstimate,
      analyzer_prequal_amount: p.fundingEstimate,
      prequal_sample: p.simulated === true
    });
    const stamped = await db.query(
      `SELECT email, custom_fields->>'slo_ref' AS slo_ref FROM clients WHERE id = $1`,
      [clientId]
    );
    const buyer = stamped.rows[0];
    if (buyer?.email && buyer.slo_ref) {
      await syncSloClickfunnelsContact({
        email: buyer.email,
        prequal: p.fundingEstimate
      });
    }
  }
  // Soft-pull decision lands on Decision Rendered so the sales board shows the file.
  if (event.orgId) {
    await advanceCardToStage(db, {
      orgId: event.orgId,
      clientId,
      pipelineKey: "sales",
      stageKey: "decision_rendered"
    });
  }
}

// register() — wire every handler onto the bus. Idempotent-ish: `on()` uses a Set,
// so double-registering the same fn reference is a no-op.
export function register() {
  on("entry.captured", onEntryCaptured);
  on("survey.submitted", onSurveySubmitted);
  on("payment.received", onPaymentReceived);
  on("payment.failed", onPaymentFailed);
  on("diagnostic.paid", onDiagnosticPaid);
  on("deposit.paid", onDepositPaid);
  on("sale.closed", onSaleClosed);
  on("analysis.completed", onAnalysisCompleted);
  on("decision.rendered", onDecisionRendered);
  on("docs.received", onDocsReceivedReviewChecklist);
}
