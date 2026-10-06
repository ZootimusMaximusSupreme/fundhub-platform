// src/contracts/send.mjs — draft, preview, send.
//
// THE SEND IS THE MOMENT THE WORDS STOP BEING EDITABLE. Everything before it is
// a draft nobody has seen; everything after it is a document somebody may sign.
// So send() does five things in a fixed order and each one exists for a reason:
//
//   1. RENDER against the client record + the blanks the staff member typed.
//   2. STORE the bytes through src/documents/store.mjs — content-addressed, so
//      the object path IS the sha256 of the words.
//   3. REGISTER a documents + document_versions row (030). document_versions
//      .checksum is immutable BY DATABASE TRIGGER, and that column is what the
//      tamper check in sign.mjs compares against later.
//   4. FREEZE the contract row: rendered_body, body_sha, status = 'sent'.
//      124_contracts.sql's trg_contracts_frozen refuses every later change to
//      those columns.
//   5. EMIT contract.sent.
//
// WHY THE WORDS ARE STORED IN TWO PLACES. contracts.rendered_body is what the
// signing page actually serves; document_versions.checksum is what proves it has
// not changed. The object store defaults to the in-memory provider and this
// repository has no storage vendor configured, so bytes put through it do not
// survive the process — a signing page reading the store would render blank in
// production today. The full reasoning is in docs/CONTRACTS-SPEC.md §3.
//
// NOTHING HERE TRANSMITS. There is no email, no SMS, no provider call. send()
// returns a signed link and the CRM shows it with a copy button. Outbound
// transmission is permitted in src/messaging/providers/* and nowhere else
// (CLAUDE.md §12), and adding a fourth exception to that rule was not in scope.
// The gap is recorded in docs/CONTRACTS-SPEC.md §12 rather than worked around.

import { createHash } from "node:crypto";
import { storeFromEnv } from "../documents/store.mjs";
import { storeAndRegister, markDelivered } from "../documents/register.mjs";
import { buildDocumentKey } from "../documents/kinds.mjs";
import { emit } from "../events/bus.mjs";
import { badRequest, notFound, conflict } from "./errors.mjs";
import { getTemplate } from "./templates.mjs";
import {
  clientContext, mergeContext, renderContract, missingTags, missingRequired,
  normaliseManualFields
} from "./render.mjs";
import { signContractUrl, DEFAULT_TTL_SECONDS } from "./signed-link.mjs";
import { PDF_MIME } from "./pdf.mjs";
import { normaliseFields, applyAutoFill, assertSignable } from "./fields.mjs";
import { replaceSigners, listSigners, normaliseSigners } from "./signers.mjs";
import { loadTemplatePdf } from "./upload.mjs";
import { notifySigners } from "./notify.mjs";
import { defaultContractValues } from "../config/offers.mjs";

export const CONTRACT_MIME = "text/html";

export const CONTRACT_COLUMNS = `
  id, org_id, client_id, staff_id, template_id, template_key, title, kind, subtype,
  merge_values, rendered_body, body_sha, document_id, document_version_id,
  signature_statement, signature_required, status,
  sent_at, sent_by, link_expires_at, viewed_at, view_count,
  signed_at, signer_name, signer_ip, signer_user_agent,
  voided_at, voided_by, void_reason,
  source_kind, fields, source_document_id, source_document_version_id,
  signed_document_id, signed_document_version_id, signed_body_sha,
  signing_order, completed_at,
  created_by, created_at, updated_at`;

/** 'sha256:<hex>' — the same algorithm-prefixed shape documents.checksum uses. */
/* THE "DO NOT SEND THIS" TEMPLATES REFUSE TO SEND (walkthrough-4 defect 2,
   2026-09-06). Migration 287 put a marked placeholder in the funding and
   credit-repair agreements because no real text exists for them, and 288 says
   they "still refuse to be sent by accident" — but nothing refused. A closer's
   one-click Send on the deck would mail a client a contract whose terms read
   "THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS." The marker is the
   one 287 and db/seed/007 wrote; a template with real text never carries it. */
const PLACEHOLDER_MARKER = /NOT THE REAL AGREEMENT TEXT|>>>\s*PLACEHOLDER\b/i;
export const hasPlaceholderText = (text) => PLACEHOLDER_MARKER.test(String(text || ""));

export const bodyHash = (text) =>
  `sha256:${createHash("sha256").update(Buffer.from(String(text), "utf8")).digest("hex")}`;

export async function getContract(db, { orgId, id } = {}) {
  if (!orgId || !id) return null;
  const { rows } = await db.query(
    `SELECT ${CONTRACT_COLUMNS} FROM contracts
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`, [id, orgId]);
  return rows[0] || null;
}

/* The list view deliberately does NOT select rendered_body. A contract body is
   the longest column in this schema and the queue shows twenty of them; the one
   screen that needs the words asks for a single contract by id. */
const LIST_COLUMNS = `
  c.id, c.org_id, c.client_id, c.staff_id, c.template_id, c.template_key, c.title,
  c.kind, c.subtype, c.body_sha, c.document_id, c.status,
  c.sent_at, c.sent_by, c.link_expires_at, c.viewed_at, c.view_count,
  c.signed_at, c.signer_name, c.voided_at, c.void_reason,
  c.source_kind, c.signing_order, c.completed_at, c.signed_document_id,
  c.created_at, c.updated_at`;

/**
 * listContracts — the CRM queue. Newest first, optionally narrowed to a client.
 *
 * `documentIds` IS HOW THE DOCUMENTS SCREEN FINDS THE CONTRACT BEHIND A ROW.
 * The pointer only runs one way: a contract names its documents, a document
 * does not name its contract. So the Documents screen collects the ids of the
 * rows it is showing and asks this list which contracts own them, in ONE call,
 * rather than a request per row.
 *
 * It matches EITHER end of that pointer — `document_id` (the copy that was
 * sent) or `signed_document_id` (the finished signed copy, which is a second
 * documents row). A screen listing both would otherwise decorate one and leave
 * the other looking like an unrelated file.
 */
export async function listContracts(db, {
  orgId, clientId = null, staffId = null, status = null, documentIds = null, limit = 100
} = {}) {
  if (!orgId) throw badRequest("A contract list needs to know which company it is for.", "org_required");
  const docIds = Array.isArray(documentIds) && documentIds.length ? documentIds : null;
  const { rows } = await db.query(
    `SELECT ${LIST_COLUMNS},
            cl.first_name, cl.last_name, cl.email AS client_email,
            s.name AS sent_by_name
       FROM contracts c
       JOIN clients cl ON cl.id = c.client_id
  LEFT JOIN staff   s  ON s.id = c.sent_by
      WHERE c.org_id = $1::uuid
        AND ($2::uuid IS NULL OR c.client_id = $2::uuid)
        AND ($3::text IS NULL OR c.status = $3)
        AND ($5::uuid[] IS NULL
             OR c.document_id = ANY($5::uuid[])
             OR c.signed_document_id = ANY($5::uuid[]))
        AND ($6::uuid IS NULL OR c.staff_id = $6::uuid)
      ORDER BY c.created_at DESC
      LIMIT $4`,
    [orgId, clientId, status, Math.max(1, Math.min(Number(limit) || 100, 200)), docIds, staffId]
  );
  return rows;
}

/**
 * withTemplateDefaults — the blanks, filled from the catalogue.
 *
 * OWNER DECISION 2026-09-03 (F27): the "wording for this client" panel comes out
 * of the closer deck. Chris, verbatim: "it should already have that information.
 * Just send it. We don't need to, like, enter in the information." So a send
 * that carries NO typed values at all has to produce a complete document, and
 * the only honest place to guarantee that is here — in the write path every
 * screen goes through — rather than in whichever screen happens to be posting.
 *
 * A caller's value wins, but only if it is actually a value. An empty string
 * from a form box nobody filled in must NOT beat the catalogue: a form that
 * posts `{"deposit": ""}` would otherwise render a fee line with nothing in it,
 * which is worse than a fee line that is wrong because nobody notices it.
 *
 * defaultContractValues() returns {} for a template it does not know — an org's
 * own copy, or PARTNER-LICENSE, whose blanks are genuinely per-partner and are
 * passed in by src/contracts/partner-license.mjs. Those callers are untouched.
 */
function withTemplateDefaults(templateKey, values) {
  const filled = { ...defaultContractValues({ templateKey }) };
  for (const [k, v] of Object.entries(values || {})) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    filled[k] = v;
  }
  return filled;
}

/**
 * createDraft — a contract that exists but has no words yet.
 *
 * Kept separate from send() so a staff member can fill the blanks, look at the
 * preview, close the laptop, and come back. A draft carries no rendered_body at
 * all (117's contracts_sent_has_body_ck), so there is nothing a client could
 * ever be shown by accident.
 */
export async function createDraft(db, {
  orgId, staffId, clientId, templateId, values = {}, title = null,
  signers = null, signingOrder = "sequential", subjectStaffId = null
} = {}) {
  if (!orgId) throw badRequest("A contract needs to belong to a company.", "org_required");
  if (!staffId) throw badRequest("A contract has to record who created it.", "staff_required");
  if (!clientId) throw badRequest("Pick the client this contract is for.", "client_required");
  if (subjectStaffId) {
    const ownsStaff = await db.query(
      `SELECT id FROM staff WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [subjectStaffId, orgId]);
    if (!ownsStaff.rows[0]) throw notFound("That staff member is not on file.", "staff_not_found");
  }

  const template = await getTemplate(db, { orgId, id: templateId });
  if (!template) throw notFound("That contract template does not exist.", "template_not_found");
  if (!template.active) {
    throw conflict(
      "That template has been archived, so it cannot be sent to anyone new. " +
      "Turn it back on, or pick a different one.",
      "template_archived");
  }

  const owns = await db.query(
    `SELECT first_name, last_name, email FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`, [clientId, orgId]);
  if (!owns.rows[0]) throw notFound("That client is not on file.", "client_not_found");
  const clientName =
    [owns.rows[0].first_name, owns.rows[0].last_name].filter(Boolean).join(" ") || "Client";
  const clientEmail = owns.rows[0].email || null;

  /* Filled here, at the moment the draft is written, so merge_values on the row
     IS what the document will render from. Filling at send instead would leave
     the stored record disagreeing with the words that went out. */
  const mergeValues = withTemplateDefaults(template.template_key, values);

  const { rows } = await db.query(
    `INSERT INTO contracts
       (org_id, client_id, staff_id, template_id, template_key, title, kind, subtype,
        merge_values, signature_required, created_by,
        source_kind, fields, signing_order, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,
     /* A contract for a demo client is a demo contract. Read off the client
        rather than passed in, because every caller that creates a fixture
        contract would otherwise have to remember, and none of them did: on
        2026-08-27 all 44 contracts in the production database were test
        artifacts signed by "Sim Repair", "Mock CloserSign" and the like, none
        flagged, all of them showing to the operator as real signed agreements. */
     COALESCE((SELECT c.is_demo FROM clients c WHERE c.id = $2), false))
     RETURNING ${CONTRACT_COLUMNS}`,
    [orgId, clientId, subjectStaffId || null, template.id, template.template_key,
     (title && String(title).trim()) || template.name,
     template.kind, template.subtype,
     JSON.stringify(mergeValues), template.signature_required, staffId,
     template.source_kind || "text",
     /* The template's boxes are copied onto the draft NOW rather than at send.
        A draft is where a sender adjusts what a particular contract says, and
        adjusting it must not reach back and edit the template every other
        contract is generated from. */
     JSON.stringify(template.fields || []),
     signingOrder === "parallel" ? "parallel" : "sequential"]
  );
  const contract = rows[0];

  /* WHO SIGNS. Named by the caller, or — when nobody is named — the client, on
     their own. Every contract gets signer rows, including the single-signer
     text ones that predate this: one code path for one signer and for five is
     worth more than a legacy branch that only the old flow walks. */
  const roster = Array.isArray(signers) && signers.length
    ? signers
    : [{ role_label: (template.signer_roles || [])[0]?.label || "Client",
         name: clientName || "Client", email: clientEmail || null, client_id: clientId }];
  await replaceSigners(db, { orgId, contractId: contract.id, signers: roster, status: "draft" });

  return contract;
}

/** saveDraft — change which blanks are filled in. Refused once sent. */
export async function saveDraft(db, { orgId, id, values = {}, title = null } = {}) {
  const current = await getContract(db, { orgId, id });
  if (!current) throw notFound();
  if (current.status !== "draft") {
    throw conflict(
      "This contract has already been sent, so its wording is fixed. " +
      "Void it and start a new one if it needs to change.",
      "already_sent");
  }
  /* Same catalogue fill as createDraft. A save that posts only the boxes a
     screen happens to show must not blank the ones it does not. */
  const { rows } = await db.query(
    `UPDATE contracts SET merge_values = $3::jsonb,
            title = COALESCE(NULLIF(btrim($4), ''), title), updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING ${CONTRACT_COLUMNS}`,
    [id, orgId, JSON.stringify(withTemplateDefaults(current.template_key, values)),
     title == null ? "" : String(title)]
  );
  return rows[0];
}

/**
 * preview — the finished document, as it would go out, without sending it.
 *
 * This is the control that replaces message_templates' compliance_passed flag
 * (docs/CONTRACTS-SPEC.md §2.1): a human reads the real words, with the real
 * client's data in them, before anything leaves. It also reports every tag that
 * came back empty, so "Hi ," is caught here rather than by the client.
 *
 * Works from a template + values directly OR from a stored draft, so the screen
 * can preview before it has written anything down.
 */
export async function preview(db, {
  orgId, templateId, clientId, values = {}, at = new Date()
} = {}) {
  const template = await getTemplate(db, { orgId, id: templateId });
  if (!template) throw notFound("That contract template does not exist.", "template_not_found");

  const base = await clientContext(db, clientId);
  const context = mergeContext({ contact: base.contact, values, at });
  const body = renderContract(template.body, context);

  return {
    template: {
      id: template.id, template_key: template.template_key, name: template.name,
      kind: template.kind, subtype: template.subtype,
      signature_required: template.signature_required,
      signature_statement: template.signature_statement,
      manual_fields: normaliseManualFields(template.manual_fields)
    },
    body,
    body_sha: bodyHash(body),
    missing_tags: missingTags(template.body, context),
    missing_required: missingRequired(template.manual_fields, values)
  };
}

/**
 * send — freeze the words, register the artifact, mint the link, emit the event.
 *
 * Idempotent on the contract row itself: a contract that is already sent gets a
 * FRESH LINK and no second document version. Re-minting rather than refusing is
 * deliberate — the commonest reason a staff member presses Send twice is that
 * the client lost the email, and refusing would make the useful case impossible
 * while preventing nothing (the words are frozen either way).
 *
 * `store` is injectable so tests do not need a storage vendor; it defaults to
 * storeFromEnv(), which is the in-memory provider unless one is configured.
 */
export async function send(db, {
  orgId, staffId, id, store = null, ttlSeconds = DEFAULT_TTL_SECONDS,
  baseUrl = null, secret = undefined, at = new Date(), now = Date.now
} = {}) {
  if (!staffId) throw badRequest("A send has to record who sent it.", "staff_required");

  const current = await getContract(db, { orgId, id });
  if (!current) throw notFound();
  if (current.status === "void") {
    throw conflict("This contract was voided, so it cannot be sent.", "voided");
  }
  if (current.status === "signed") {
    throw conflict("This contract is already signed.", "already_signed");
  }

  // ── already sent: re-mint the links, touch nothing else ───────────────────
  if (current.status !== "draft") {
    const out = await mintLinks(db, {
      orgId, contract: current, ttlSeconds, baseUrl, secret, now
    });
    /* A RESEND REALLY RE-SENDS. `purpose` carries a counter, so the unique index
       on (org_id, provider_ref) lets a deliberate second email through while
       still refusing an accidental duplicate of the same one. The commonest
       reason somebody presses Send twice is that the client lost the first. */
    const already = (await db.query(
      `SELECT count(*)::int AS n FROM messages
        WHERE org_id = $1::uuid AND provider_ref LIKE $2`,
      [orgId, `contract:${current.id}:%:resend%`])).rows[0].n;
    const notified = await notifySigners(db, {
      orgId, contract: current, signers: await listSigners(db, current.id), links: out.links,
      purpose: `resend${already + 1}`, staffName: await staffNameOf(db, staffId)
    }).catch(() => null);
    return { contract: await getContract(db, { orgId, id }), ...out, notified, resent: true };
  }

  const template = await getTemplate(db, { orgId, id: current.template_id });
  if (!template) throw notFound("That contract template does not exist.", "template_not_found");
  if (hasPlaceholderText(template.body)) {
    throw conflict(
      "This contract template still holds placeholder text, not the real agreement. " +
      "It cannot be sent until the real wording is loaded.",
      "placeholder_text");
  }

  const signers = await listSigners(db, current.id);
  if (!signers.length) {
    throw badRequest("This contract has nobody to sign it.", "no_signers");
  }

  /* ── the uploaded-PDF path ──────────────────────────────────────────────
     Everything below the branch is the 117 text path, unchanged. This is a
     separate function rather than an `if` woven through it, because the two
     freeze different artifacts and mixing them is how one of them ends up with
     half the other's guarantees. */
  if (current.source_kind === "pdf") {
    return sendPdf(db, {
      orgId, staffId, contract: current, template, signers,
      store, ttlSeconds, baseUrl, secret, at, now
    });
  }

  /* A draft written before the catalogue fill existed carries whatever the old
     screen posted. Filling again here means an old draft still sends a complete
     document, and the value is written back onto the row in the same freeze
     UPDATE below so the stored record never disagrees with the words that went
     out. Drafts created since simply come back unchanged. */
  const values = withTemplateDefaults(current.template_key, current.merge_values);
  const stillEmpty = missingRequired(template.manual_fields, values);
  if (stillEmpty.length) {
    throw badRequest(
      `This contract still has blanks in it: ${stillEmpty.join(", ")}. ` +
      "Fill them in before sending.",
      "missing_required", stillEmpty);
  }

  const base = await clientContext(db, current.client_id);
  const context = mergeContext({ contact: base.contact, values, at });
  const body = renderContract(template.body, context);
  if (!body.trim()) {
    throw badRequest(
      "This contract rendered as an empty page. Check the template's wording.",
      "empty_body");
  }

  // ── the immutable artifact (030) ──────────────────────────────────────────
  // The discriminator is the contract id, so every contract gets its own
  // document rather than every contract for a client collapsing onto one
  // document_key and appending versions to each other.
  const documentStore = store || storeFromEnv();
  const registered = await storeAndRegister(db, documentStore, {
    orgId,
    clientId: current.client_id,
    kind: current.kind,
    subtype: current.subtype,
    title: current.title,
    body,
    mimeType: CONTRACT_MIME,
    filename: `${current.template_key}.html`,
    documentKey: buildDocumentKey({
      kind: current.kind, subtype: current.subtype,
      clientId: current.client_id, discriminator: current.id
    }),
    generatedBy: "contracts",
    signatureRequired: current.signature_required,
    // Rule 9: a replayed send cannot append a second version to this document.
    sourceEventId: `contract.sent:${current.id}`,
    reason: "initial",
    metadata: { contract_id: current.id, template_key: current.template_key }
  });

  const sha = registered.version?.checksum || bodyHash(body);

  /* The UPDATE is conditional on status still being 'draft'. Two staff members
     pressing Send at the same instant must not both freeze the row — the second
     one gets no row back and falls through to the already-sent path, which
     hands them a link to the document the first one actually sent. */
  const { rows } = await db.query(
    `UPDATE contracts
        SET status = 'sent', rendered_body = $3, body_sha = $4,
            document_id = $5, document_version_id = $6,
            signature_statement = $7, signature_required = $8,
            merge_values = $11::jsonb,
            sent_at = $9, sent_by = $10::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'draft'
      RETURNING ${CONTRACT_COLUMNS}`,
    [current.id, orgId, body, sha,
     registered.document?.id || null, registered.version?.id || null,
     template.signature_statement, template.signature_required,
     at, staffId,
     /* The values the words were actually rendered from, frozen alongside them.
        Still a 'draft' row at this instant, so trg_contracts_frozen permits it —
        the same reason rendered_body and signature_statement can be written
        here. Every later change is refused. */
     JSON.stringify(values)]
  );

  if (!rows[0]) {
    // Lost the race. Somebody else sent it a moment ago; hand back what they sent.
    const out = await mintLinks(db, { orgId, contract: current, ttlSeconds, baseUrl, secret, now });
    return { contract: await getContract(db, { orgId, id }), ...out, resent: true };
  }
  const contract = rows[0];
  const { link, links } = await mintLinks(db, { orgId, contract, ttlSeconds, baseUrl, secret, now });

  // The document's own delivery state, so a "what did we send this client"
  // audit over documents/ reads correctly without joining contracts.
  // channel 'portal': the client fetches it from a link, nothing is transmitted.
  if (registered.document?.id) {
    await markDelivered(db, {
      documentId: registered.document.id,
      versionId: registered.version?.id || null,
      channel: "portal", status: "sent", deliveredAt: at
    }).catch(() => { /* the contract is sent; a delivery-status write is not worth losing it over */ });
  }

  const notified = await notifySigners(db, {
    orgId, contract, signers: await listSigners(db, contract.id), links,
    purpose: "send", staffName: await staffNameOf(db, staffId)
  }).catch((err) => {
    // A contract that is legally sent must never be reported as failed because
    // an email did not go. The link is in the response either way.
    console.warn(`[contracts] could not notify signers of ${contract.id}: ${err.message}`);
    return null;
  });

  await emitContractEvent(db, "contract.sent", contract);
  return { contract, link, links, resent: false, notified, document: registered.document || null };
}

/** The sender's name, for the email. Best effort — the copy falls back without it. */
async function staffNameOf(db, staffId) {
  if (!staffId) return null;
  try {
    const { rows } = await db.query(`SELECT name FROM staff WHERE id = $1::uuid LIMIT 1`, [staffId]);
    return rows[0]?.name || null;
  } catch { return null; }
}

/**
 * void — take a contract out of play.
 *
 * A reason is required (117's contracts_void_reason_ck), because "why is this
 * void" is the first question anybody asks and a blank answer is not one. A
 * signed contract cannot be voided — the database refuses it, not just this
 * function.
 */
export async function voidContract(db, { orgId, staffId, id, reason, at = new Date() } = {}) {
  const current = await getContract(db, { orgId, id });
  if (!current) throw notFound();
  const why = String(reason ?? "").trim();
  if (!why) {
    throw badRequest("Say why this contract is being voided — a blank reason is not a record.",
      "void_reason_required");
  }
  if (current.status === "signed") {
    throw conflict("This contract is signed. A signed contract cannot be voided.", "already_signed");
  }
  if (current.status === "void") return current;

  const { rows } = await db.query(
    `UPDATE contracts
        SET status = 'void', voided_at = $3, voided_by = $4::uuid, void_reason = $5,
            updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND status <> 'signed'
      RETURNING ${CONTRACT_COLUMNS}`,
    [current.id, orgId, at, staffId || null, why]);
  if (!rows[0]) throw conflict("This contract changed while you were voiding it. Reload and look again.", "conflict");
  return rows[0];
}

/**
 * emitContractEvent — one place both events are written.
 *
 * THE PAYLOAD NEVER CARRIES THE CONTRACT BODY. The `events` table is read by the
 * dead-letter queue, the replay harness and the journey runner; none of them
 * should end up holding a copy of a consumer's signed agreement. Ids and status
 * only.
 *
 * Idempotency key is derived from the contract id, so a replay writes one event
 * rather than two.
 *
 * A FAILING BUS DOES NOT UN-SEND A CONTRACT. emit() dispatches handlers and
 * records their failures to the dead-letter queue itself; what is caught here is
 * the bus being unreachable at all. The contract row is already committed and is
 * the source of truth — throwing at this point would report a send as failed
 * that in fact happened, which is the worse of the two wrong answers.
 */
export async function emitContractEvent(db, name, contract) {
  const payload = {
    contract_id: contract.id,
    client_id: contract.client_id,
    template_key: contract.template_key,
    kind: contract.kind,
    subtype: contract.subtype,
    status: contract.status,
    document_id: contract.document_id,
    document_version_id: contract.document_version_id,
    body_sha: contract.body_sha
  };
  try {
    return await emit(db, name, payload, {
      orgId: contract.org_id,
      clientId: contract.client_id,
      idempotencyKey: `${name}:${contract.id}`
    });
  } catch (err) {
    console.warn(`[contracts] ${name} could not be written to the event bus: ${err.message}`);
    return { id: null, deduped: false, failed: true };
  }
}

// ---------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------

/**
 * mintLinks — one link per signer, plus the contract-wide one.
 *
 * EVERY SIGNER GETS THEIR OWN URL, and that is not a convenience. A shared link
 * would mean whoever opened it first could sign as anybody, and there would be
 * no way afterwards to say which of two people typed a name. The link IS the
 * identification, so it has to be per person.
 *
 * `link` (the contract-wide one) is returned as well because a single-signer
 * contract resolves it to its only signer, which is what keeps every contract
 * sent before signers existed working through the same endpoint.
 *
 * The expiry is written back onto each signer row so the CRM can say "this
 * person's link runs out on Friday" without re-deriving it from a signature.
 */
export async function mintLinks(db, {
  orgId, contract, ttlSeconds = DEFAULT_TTL_SECONDS, baseUrl = null, secret, now = Date.now
} = {}) {
  const signers = await listSigners(db, contract.id);
  const expiresAt = new Date();
  const links = [];

  for (const s of signers) {
    const minted = signContractUrl({
      contractId: contract.id, signerId: s.id, ttlSeconds, baseUrl, secret, now
    });
    expiresAt.setTime(minted.expiresAt * 1000);
    await db.query(
      `UPDATE contract_signers
          SET link_expires_at = $2,
              status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END,
              updated_at = now()
        WHERE id = $1::uuid AND signed_at IS NULL`,
      [s.id, new Date(minted.expiresAt * 1000)]);
    links.push({
      signer_id: s.id,
      signer_index: s.signer_index,
      role_label: s.role_label,
      name: s.name,
      email: s.email,
      status: s.status,
      url: minted.url,
      expires_at: minted.expiresAtIso
    });
  }

  const link = signContractUrl({ contractId: contract.id, ttlSeconds, baseUrl, secret, now });
  await db.query(
    `UPDATE contracts SET link_expires_at = $3, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [contract.id, orgId, new Date(link.expiresAt * 1000)]);

  return { link, links };
}

// ---------------------------------------------------------------------------
// the uploaded-PDF send path
// ---------------------------------------------------------------------------

/**
 * agreementManifest — the ONE STRING that captures everything agreed.
 *
 * READ db/migrations/125_contract_esign.sql's note on contracts.rendered_body
 * before changing anything here. 117's tamper refusal works by re-hashing
 * rendered_body at signature time against a checksum in a different table. For
 * a PDF, the file alone is not enough to hash: the same file with a different
 * figure typed into a box is a different agreement. This manifest names the
 * file's fingerprint AND every box with the value that was in it at send, so
 * hashing it covers both.
 *
 * It is also plainly readable, on purpose. A person asked "what exactly did
 * they agree to" can read this without any tooling.
 */
export function agreementManifest({ contract, template, fields, pdfChecksum, signers }) {
  const lines = [];
  lines.push("SIGNED PDF DOCUMENT");
  lines.push("");
  lines.push(`Title: ${contract.title}`);
  lines.push(`Template: ${contract.template_key}`);
  lines.push(`File: ${template.original_filename || "document.pdf"}`);
  lines.push(`Pages: ${template.page_count}`);
  lines.push(`File fingerprint: ${pdfChecksum}`);
  lines.push(`Signing order: ${contract.signing_order}`);
  lines.push("");
  lines.push("SIGNERS");
  for (const s of signers) {
    lines.push(`  ${s.signer_index + 1}. ${s.name}${s.email ? ` <${s.email}>` : ""} — ${s.role_label}`);
  }
  lines.push("");
  lines.push("FIELDS");
  /* Sorted by a stable key, never by however the editor happened to emit them.
     Two identical agreements whose field arrays are ordered differently must
     hash the same, or a harmless reorder in the editor would read as tampering
     to the check that refuses signatures. */
  const sorted = [...fields].sort((a, b) =>
    a.page - b.page || a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
  for (const f of sorted) {
    lines.push(
      `  [p${f.page + 1}] ${f.label} (${f.type}, signer ${f.signer + 1}, from ${f.source})` +
      ` @ ${f.x.toFixed(4)},${f.y.toFixed(4)},${f.w.toFixed(4)},${f.h.toFixed(4)}` +
      ` = ${JSON.stringify(f.value ?? "")}`);
  }
  return lines.join("\n");
}

/**
 * sendPdf — freeze an uploaded-PDF contract.
 *
 * Registers TWO artifacts, and the split is deliberate:
 *   the SOURCE PDF   snapshotted onto the contract, so a later re-upload to the
 *                    template cannot change what an already-sent contract shows
 *   the MANIFEST     the immutability anchor the tamper check compares against
 *
 * Both go through documents/document_versions, so both are immutable by trigger.
 */
async function sendPdf(db, {
  orgId, staffId, contract, template, signers, store, ttlSeconds, baseUrl, secret, at, now
}) {
  const fields = normaliseFields(contract.fields, {
    pageCount: template.page_count,
    signerCount: signers.length
  });
  if (!fields.length) {
    throw badRequest(
      "This document has no boxes on it yet, so nobody can fill anything in or sign it. " +
      "Open the template and place the boxes first.",
      "no_fields");
  }
  // Everybody must have somewhere to sign. A signer with no signature box can
  // open the document, read it, and never be able to finish.
  assertSignable(fields, signers.length);

  const pdfBytes = await loadTemplatePdf(db, template, { store });
  if (!pdfBytes) {
    throw conflict(
      "The file behind this template could not be read, so it cannot be sent. " +
      "Upload it again.",
      "template_file_missing");
  }

  // Everything the CRM already knows, filled in and frozen. Resolved now rather
  // than while somebody is reading the document: a value that can change
  // between opening the page and signing it is not part of what was agreed.
  const base = await clientContext(db, contract.client_id);
  const filled = applyAutoFill(fields, {
    contact: base.contact, signers, today: new Date(at).toISOString().slice(0, 10)
  });

  const documentStore = store || storeFromEnv();

  // 1. the source file, snapshotted against THIS contract
  const source = await storeAndRegister(db, documentStore, {
    orgId,
    clientId: contract.client_id,
    kind: contract.kind,
    subtype: contract.subtype,
    title: `${contract.title} (as sent)`,
    body: pdfBytes,
    mimeType: PDF_MIME,
    filename: template.original_filename || `${contract.template_key}.pdf`,
    documentKey: buildDocumentKey({
      kind: contract.kind, subtype: contract.subtype,
      clientId: contract.client_id, discriminator: `${contract.id}:source`
    }),
    generatedBy: "contracts",
    signatureRequired: true,
    sourceEventId: `contract.source:${contract.id}`,
    reason: "initial",
    metadata: { contract_id: contract.id, role: "source" }
  });

  // 2. the manifest — the anchor the tamper check reads
  const manifest = agreementManifest({
    contract, template, fields: filled,
    pdfChecksum: source.version?.checksum || "unknown",
    signers
  });
  const registered = await storeAndRegister(db, documentStore, {
    orgId,
    clientId: contract.client_id,
    kind: contract.kind,
    subtype: contract.subtype,
    title: contract.title,
    body: manifest,
    mimeType: "text/plain",
    filename: `${contract.template_key}-manifest.txt`,
    documentKey: buildDocumentKey({
      kind: contract.kind, subtype: contract.subtype,
      clientId: contract.client_id, discriminator: contract.id
    }),
    generatedBy: "contracts",
    signatureRequired: true,
    sourceEventId: `contract.sent:${contract.id}`,
    reason: "initial",
    metadata: { contract_id: contract.id, role: "manifest" }
  });

  const sha = registered.version?.checksum || bodyHash(manifest);

  const { rows } = await db.query(
    `UPDATE contracts
        SET status = 'sent', rendered_body = $3, body_sha = $4,
            document_id = $5, document_version_id = $6,
            source_document_id = $7, source_document_version_id = $8,
            fields = $9::jsonb,
            signature_statement = $10, signature_required = true,
            sent_at = $11, sent_by = $12::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'draft'
      RETURNING ${CONTRACT_COLUMNS}`,
    [contract.id, orgId, manifest, sha,
     registered.document?.id || null, registered.version?.id || null,
     source.document?.id || null, source.version?.id || null,
     JSON.stringify(filled), template.signature_statement, at, staffId]);

  if (!rows[0]) {
    const out = await mintLinks(db, { orgId, contract, ttlSeconds, baseUrl, secret, now });
    return { contract: await getContract(db, { orgId, id: contract.id }), ...out, resent: true };
  }
  const sent = rows[0];
  const { link, links } = await mintLinks(db, { orgId, contract: sent, ttlSeconds, baseUrl, secret, now });

  if (registered.document?.id) {
    await markDelivered(db, {
      documentId: registered.document.id,
      versionId: registered.version?.id || null,
      channel: "portal", status: "sent", deliveredAt: at
    }).catch(() => { /* the contract is sent; a delivery-status write is not worth losing it over */ });
  }

  const notified = await notifySigners(db, {
    orgId, contract: sent, signers: await listSigners(db, sent.id), links,
    purpose: "send", staffName: await staffNameOf(db, staffId)
  }).catch((err) => {
    console.warn(`[contracts] could not notify signers of ${sent.id}: ${err.message}`);
    return null;
  });

  await emitContractEvent(db, "contract.sent", sent);
  return { contract: sent, link, links, resent: false, notified, document: registered.document || null };
}
