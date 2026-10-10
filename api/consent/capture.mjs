// /api/consent/capture — the consent gate's capture flow.
//
//   GET  ?client_id=<uuid>[&kind=]
//        → { ok, kind, disclosure, status, history, identity, approval_link }
//        the words to show, whether a live consent exists, the full trail
//        including revoked rows, whether an identity is already held for this
//        person, and a freshly signed link the client can open to supply both.
//
//   POST { client_id, action: "grant", capture_method, granted_name?,
//          consent_version?, expires_at?, document_id? }
//        → { ok, consent }
//
//   POST { client_id, action: "revoke", consent_id, reason }
//        → { ok, consent }
//
// *** THIS ENDPOINT DOES NOT PULL ANYBODY'S CREDIT AND SENDS NOTHING. ***
// It writes rows to `client_consents`. The pull path is
// api/finance/soft-pull.mjs, which now refuses unless a row written here says
// the consumer agreed.
//
// ONE SIDE EFFECT BEYOND CONSENTS (2026-10-09). Storing a `dispute_authorization`
// grant also starts the Repair letter writer, if that client's repair card is
// waiting on 'analysis' (src/repair/start-letters.mjs). That writes dispute
// cases, dispute items and dispute letters, saves each letter as a client
// file, and moves the repair card. It still pulls no credit, mails no
// letter and emails the client nothing. The signature is saved first, and the
// answer to the caller is the same `{ ok, consent }` whatever the writer does.
//
// A POST, NOT A GET, for grant AND for revoke. Same reasoning as the SSN reveal
// in api/pii.mjs and the soft-pull request next door: both are actions with a
// permanent effect on a consumer-credit record. GETs get prefetched, retried,
// cached and logged with their query strings, and a link-scanner must not be
// able to record that somebody consented — nor to withdraw a consent they are
// relying on.
//
// THE CONSENT TEXT IS NEVER READ FROM THE BODY. The caller sends a VERSION; the
// server looks up the words in src/consent/disclosures.mjs and stores its own
// copy. A body-supplied paragraph would let anybody who can reach this endpoint
// record that a consumer agreed to a sentence they never saw. See that file's
// header — this is the single most important line in this handler.
//
// NO IDENTITY DATA LEAVES THIS ENDPOINT — NOT EVER, NOT UNDER ANY QUERY STRING.
// The GET says whether an identity is on file with a BOOLEAN, and a boolean plus
// a link expiry is the entire permitted surface. No SSN, no last four, no date
// of birth, no address. A staff screen must not be able to read identity data
// out of this endpoint even by accident, so the read below narrows to one
// true/false at the point of the call rather than spreading a record and
// trusting the caller to pick fields carefully.
//
// OWNER DECISION, 2026-08-19: identity capture is CLIENT SELF-SERVE. Staff never
// see, type or handle a Social Security number. They hand over the signed link
// this endpoint mints; the client fills the form in themselves on
// public/app/soft-pull-approve.html. That is why this file gained a link and a
// boolean and nothing else.
//
// src/http/consent-capture.test.mjs holds the rule shut with a deny-list run
// over the whole serialized body, not a check of three named fields, so a field
// added here later cannot leak past the test.

// ORG COMES FROM THE SESSION, ALWAYS. principal.orgId and nothing else. There is
// no org_id parameter on any method here, and a principal without one is
// refused rather than defaulted — a consent filed under a guessed org is a
// consent that gates the wrong tenant's credit pulls.
//
// THE ROLE GATE IS A SECOND CALL, NOT AN ARGUMENT. requireAuth's third
// parameter is { db, env }; a `roles` key there is accepted by the object
// literal and silently dropped, which is how api/read/tradelines.mjs shipped an
// ungated endpoint (see src/http/routes.test.mjs and src/http/auth-gate.test.mjs).
// This file resolves the principal first and then calls requireRole() for real.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, requireRole, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { disclosureFor } from "../../src/consent/disclosures.mjs";
import { mayAuthorizeDisputes } from "../../src/consent/dispute-consent.mjs";
import { signSoftPullApproveUrl } from "../../src/consent/approve-token.mjs";
import { secretFromEnv } from "../../src/documents/signed-url.mjs";
import { readIdentity } from "../../src/pii/index.mjs";
import { startLettersAfterAuthorization } from "../../src/repair/start-letters.mjs";
import {
  captureConsent,
  revokeConsent,
  consentStatus,
  listConsents,
  boundedLimit,
  CONSENT_KINDS,
  ConsentError
} from "../../src/consent/index.mjs";

/* Employees who may RECORD a consent given on a call or on paper, and who may
   revoke one at the consumer's request.

   Deliberately the SAME set as SOFT_PULL_ROLES in api/finance/soft-pull.mjs.
   Whoever may ask for a pull may record the permission that allows it, and
   nobody else: a wider set here would be a way around the narrower set there,
   since a consent is the thing that unlocks the pull. If one set moves, the
   other has to move with it, and somebody has to write down why.

   `owner` is listed explicitly. This file does not go through the
   requireRole(...allowed) middleware, so it does not inherit SUPER_ROLES, and an
   implicit super-role is exactly the kind of thing that should not be implicit
   on a consumer-consent endpoint. */
/* CONSENT_ROLES IS THE PULL-EQUIVALENT SET AND MUST NOT GROW.
   src/http/consent-capture.test.mjs asserts it equals SOFT_PULL_ROLES exactly,
   because a consent is the thing that unlocks a credit pull — a wider set here
   is a way around the narrower one on the pull endpoint. That reasoning holds
   only for the kinds that lead to a pull, which is why the CSM is NOT added
   here. Adding them here was the first attempt and the test was right to
   refuse it. */
const CONSENT_ROLES = new Set(["owner", "admin", "closer", "funding_advisor"]);

/* The conversation consents. A CSM is the person actually in the call where
   these are given, so they may record them — and only these. Nothing in this
   pair unlocks a credit pull, a dispute letter, or anything else. */
const CONVERSATION_KINDS = new Set(["call_recording", "marketing_use"]);
const CONVERSATION_ROLES = new Set([...CONSENT_ROLES, "csm"]);

/* Who may reach the endpoint at all. The real decision is per kind, below,
   once the kind is known — this is only the early out. */
const ANY_CONSENT_ROLE = CONVERSATION_ROLES;

/* rolesForKind — the set that may act on THIS kind. Anything that is not a
   conversation consent falls back to the narrow, pull-equivalent set, so a
   kind added later is gated tightly until somebody widens it on purpose. */
function rolesForKind(kind) {
  return CONVERSATION_KINDS.has(kind) ? CONVERSATION_ROLES : CONSENT_ROLES;
}

/* refuseKindForRole — the per-kind gate. Returns true when it has answered. */
function refuseKindForRole(res, principal, kind) {
  if (principal.kind !== "staff") return false;
  const role = String(principal.staff?.role || "").trim().toLowerCase();
  if (rolesForKind(kind).has(role)) return false;
  res.status(403).json({
    ok: false,
    error: "forbidden",
    code: "role_may_not_capture_this_kind"
  });
  return true;
}

const DEFAULT_KIND = "soft_pull_consent";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  // THE SECOND GATE. requireRole() writes its own 403 and returns false.
  // Clients are not role-gated — they are gated by ownsClient() below, which is
  // a stronger check: a client principal may only ever act on themself.
  if (principal.kind === "staff" && !requireRole(res, principal.staff, ANY_CONSENT_ROLE)) return;

  // Fail closed on the org before any branch runs. A principal with no org
  // cannot have a row written for them and cannot be told about anybody's
  // consent; refusing beats picking a default org and filing under the wrong one.
  const orgId = principal.orgId;
  if (!orgId) {
    return res.status(400).json({ ok: false, error: "org_id is required" });
  }

  try {
    if (req.method === "GET") return await handleGet(req, res, principal, orgId);
    if (req.method === "POST") return await handlePost(req, res, principal, orgId);

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof ConsentError) {
      return res.status(e.status).json({ ok: false, error: e.message, code: e.code });
    }
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}

/* GET — what to show, and what is already on file.
 *
 * Returns the disclosure text so the screen never holds its own copy of the
 * wording. A screen with a hardcoded paragraph is a second source of truth for
 * the one string that has to be exact. */
async function handleGet(req, res, principal, orgId) {
  const q = req.query || {};
  if (!isUuid(q.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  // AWAITED. ownsClient() is async, and an un-awaited call returns a Promise,
  // which is truthy — `!promise` is false, so the refusal never fires and the
  // check is silently switched off. Both call sites in this file are awaited;
  // src/http/consent-capture.test.mjs proves it on GET and on POST separately,
  // because one missed await would leave the other test passing.
  if (!(await ownsClient(principal, q.client_id))) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const kind = normalizeKind(q.kind);
  if (refuseKindForRole(res, principal, kind)) return;
  if (!kind) {
    return res.status(400).json({ ok: false, error: `kind must be one of: ${CONSENT_KINDS.join(", ")}` });
  }

  const clientId = String(q.client_id).trim();

  /* THE TWO EXTRAS ARE SOFT-PULL ONLY.
     A bureau pull has two locks on it, in this order: consent (403
     consent_required) and then identity (422 identity_required). Both were
     proven live on all three bureaus on 2026-08-18/19. The link and the
     identity boolean below exist to show a closer which of those two is still
     shut BEFORE they order a pull.

     Neither means anything for another consent kind. `dispute_authorization`
     has no approval page and no bureau pull behind it, so asking about it
     returns null for both rather than a link to the wrong form — and, just as
     important, never reads the identity table at all on a request that has no
     business touching it. */
  const isSoftPull = kind === DEFAULT_KIND;

  const [status, history, identityOnFile] = await Promise.all([
    consentStatus(db, { orgId, clientId, kind }),
    listConsents(db, { orgId, clientId, kind, limit: boundedLimit(q.limit) }),
    isSoftPull ? identityIsOnFile(clientId) : Promise.resolve(null)
  ]);

  /* THE LINK IS MINTED FOR STAFF AND NOT FOR CLIENTS. It is a bearer credential
     — the HMAC in the URL is the whole credential, no session required (see
     src/consent/approve-token.mjs and api/soft-pull-approve.mjs). Staff need it
     because handing it over is the entire point of the flow. A client principal
     is already signed in and has no use for a link to a page they can reach
     anyway, so it is not minted into their response. Least exposure. */
  const approvalLink = isSoftPull && principal.kind === "staff"
    ? mintApprovalLink({ orgId, clientId })
    : null;

  return res.status(200).json({
    ok: true,
    kind,
    disclosure: disclosureFor(kind),
    status,
    history,
    // A BOOLEAN AND NOTHING MORE. See the header. `null` here means "not asked",
    // which is different from `false` ("asked, and we hold nothing").
    identity: identityOnFile === null ? null : { on_file: identityOnFile },
    approval_link: approvalLink
  });
}

/* identityIsOnFile — the SECOND lock on a bureau pull, as a yes or a no.
 *
 * readIdentity() (src/pii/index.mjs:155) returns a masked record: ssn_present,
 * ssn_last4, dob, addresses. Exactly one bit of that is allowed out of this
 * endpoint, so the record is narrowed to a boolean HERE, inside the function,
 * and the object itself never reaches the response builder. Narrowing at the
 * call site rather than at the response would leave a whole PII record sitting
 * in a local variable one careless spread away from the JSON.
 *
 * readIdentity IS THE RIGHT READ AND revealSsn IS NOT. readIdentity does not
 * write a pii_access_log row, because it discloses nothing (see rule 2 in
 * src/pii/index.mjs). revealSsn does write one, and using it for a presence
 * check would fill the disclosure log — the record an audit actually reads —
 * with thousands of screen loads where nobody looked at anything.
 *
 * WHAT THE BOOLEAN HONESTLY MEANS: we hold encrypted SSN bytes for this person.
 * It does not promise those bytes still decrypt under the current key, and it
 * is not a promise that a pull will succeed. It is the same thing the pull
 * refuses on when it is missing (src/finance/crs-pull.mjs:548-559), which is
 * what makes it worth showing before the tap.
 */
async function identityIsOnFile(clientId) {
  /* NEVER LET THIS SINK THE CONSENT ANSWER. The identity read is the SECOND of
     two things this endpoint reports, and it is the less important one: a
     closer who cannot see whether we hold an identity can still see whether the
     client agreed, and can still hand over the link. A closer who sees a broken
     screen can do neither.

     So a failure here degrades to `null` — "we did not find out" — which the
     screen already renders differently from `false` ("we asked, we hold
     nothing"). That is the same fail-soft shape mintApprovalLink() uses for a
     missing signing key, and it is deliberate that the two match.

     Verified 2026-08-19: without this catch, making the pii_identity read throw
     takes the whole GET to a 500 and the consent line goes with it. An RLS
     denial returns zero rows rather than an error, so this needs a timeout, a
     dead connection or a missing table — unlikely, and not worth losing the
     consent line over. */
  try {
    const identity = await readIdentity(db, { clientId });
    return !!(identity && identity.ssn_present);
  } catch {
    return null;
  }
}

/* publicBaseUrl — the origin an emailed or copied link has to point at.
 *
 * COPIED, DELIBERATELY, FROM src/sales/closer-deck.mjs:331-335 — byte for byte.
 * That file mints THIS EXACT LINK for the email version of this flow, and a
 * link a closer copies off the screen must resolve to the same origin as the
 * one the client is emailed. Matching it is the point.
 *
 * THIS IS NOW THE THIRD COPY AND THE COPIES DO NOT AGREE. There are two
 * families of base-URL resolution in this repo and they read different
 * variables:
 *   PUBLIC_BASE_URL → URL → fundhub.ai   src/sales/closer-deck.mjs:331,
 *                                        api/contracts.mjs:86,
 *                                        api/read/portal-contracts.mjs:18
 *   APP_BASE_URL    → URL → fundhub.ai   src/messaging/dispatch.mjs:56,
 *                                        src/workflows/messaging.mjs:56,
 *                                        api/social/oauth.mjs:17
 * Neither is exported, so neither can be imported, and this file may not edit
 * either of them. Following the soft-pull family is the only choice that keeps
 * the copied link and the emailed link identical. The duplication is a board
 * item, not something to fix by inventing a fourth convention here.
 */
function publicBaseUrl(env = process.env) {
  if (env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/$/, "");
  if (env.URL) return String(env.URL).replace(/\/$/, "");
  return "https://fundhub.ai";
}

/* mintApprovalLink — a fresh signed link, or an honest null with a sentence.
 *
 * FAIL SOFT, VISIBLY. secretFromEnv() THROWS when DOCUMENT_URL_SECRET is unset
 * or shorter than 32 characters (src/documents/signed-url.mjs:29-37) — that is
 * the correct behaviour there, because an unsigned link is worse than no link.
 * It is the wrong behaviour HERE: this endpoint is also the only thing telling
 * a closer whether a client has consented, and a missing config value must not
 * take that whole answer down with it. So the throw is caught, the link comes
 * back null, and the screen is given words it can put in front of a person.
 *
 * Same shape as the existing caller at src/sales/closer-deck.mjs:354-363: the
 * try wraps secretFromEnv and nothing else. Signing itself cannot fail from
 * here — orgId is non-empty (checked in the handler), clientId is a validated
 * uuid, and the TTL is the module default — so a throw out of
 * signSoftPullApproveUrl would be a real bug and should be loud, not swallowed.
 *
 * The env var is named in the message, in brackets, matching how this codebase
 * already hands a closer a machine detail they can quote to the desk without
 * having to understand it. The NAME is not a secret; the value is never read,
 * logged or returned.
 */
function mintApprovalLink({ orgId, clientId, env = process.env }) {
  let secret;
  try {
    secret = secretFromEnv(env);
  } catch {
    return {
      url: null,
      expires_at: null,
      unavailable_reason:
        "This system is missing the key it uses to sign client links, so no approval " +
        "link can be made right now. That is a setup problem, not a problem with this " +
        "client — pass it to the desk. [DOCUMENT_URL_SECRET]"
    };
  }

  const link = signSoftPullApproveUrl({
    orgId,
    clientId,
    secret,
    baseUrl: publicBaseUrl(env)
  });
  return { url: link.url, expires_at: link.expiresAtIso, unavailable_reason: null };
}

async function handlePost(req, res, principal, orgId) {
  const body = req.body || {};
  if (!isUuid(body.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  // AWAITED — see the note on the same call in handleGet().
  if (!(await ownsClient(principal, body.client_id))) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const kind = normalizeKind(body.kind);
  if (refuseKindForRole(res, principal, kind)) return;
  if (!kind) {
    return res.status(400).json({ ok: false, error: `kind must be one of: ${CONSENT_KINDS.join(", ")}` });
  }

  const clientId = String(body.client_id).trim();

  // Attribution from the SESSION, never from the body — the same rule
  // api/finance/soft-pull.mjs states for its requester. A caller choosing its
  // own attribution is a caller with no attribution.
  const actor = principal.kind === "staff"
    ? { kind: "staff", id: principal.staffId }
    : { kind: "client", id: principal.accountId };

  const action = String(body.action ?? "grant").trim().toLowerCase();

  if (action === "revoke") {
    if (!isUuid(body.consent_id)) {
      return res.status(400).json({ ok: false, error: "consent_id must be a uuid" });
    }
    const consent = await revokeConsent(db, {
      orgId,
      consentId: String(body.consent_id).trim(),
      reason: body.reason,
      revokedBy: actor
    });
    return res.status(200).json({ ok: true, consent });
  }

  if (action !== "grant") {
    return res.status(400).json({ ok: false, error: "action must be one of: grant, revoke" });
  }

  /* A CLIENT MAY ONLY AUTHORIZE DISPUTE LETTERS IF DISPUTE LETTERS ARE THEIRS.
     The owner's standing rule for the letter engine is that repair work happens
     only for clients on the repair offer path, and until 2026-09-03 that rule
     lived in the workflow and nowhere near this endpoint: the portal card was
     unconditional markup and this handler took whatever it was sent. An Academy
     buyer — a course, not credit repair — was shown the form and could sign it
     (walk finding F35).

     ONLY THE SELF-SERVE PATH IS NARROWED. Staff keep the ability to record an
     authorization given on a call or on paper: that is a person exercising
     judgment about a file they are looking at, and the same set of roles already
     decides whether to order the pull. What is closed is the portal handing the
     form to somebody who never bought repair.

     WIDENED ONCE, ON THE OWNER'S OWN WORDS (2026-09-03): "It's only for repair
     and for the funding offer. If they're getting deliverables, meaning
     e-products and courses, they don't need to sign for shit." The first pass at
     this gate asked only ../../src/repair/on-repair-path.mjs, so a customer who
     bought FUNDING was refused an authorization for letters their own pack
     contains. src/consent/dispute-consent.mjs is the owner's rule whole: repair
     OR the funding offer, by ENTITLEMENT — never by outcome tier, in either
     direction. The tier is stamped by a real credit pull on course buyers too,
     so a funding tier and a REPAIR_ONLY tier BOTH put the form straight back in
     front of the Academy buyer this finding was raised on. That is not
     hypothetical: reaching REPAIR_ONLY through onRepairPath() is the leak the
     second pass at this fix shipped with, and src/consent/dispute-consent.mjs
     no longer calls it. */
  if (kind === "dispute_authorization" && principal.kind === "client") {
    const allowed = await mayAuthorizeDisputes(db, { orgId, clientId });
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: "Dispute letters are not part of what you bought, so there is nothing here to authorize.",
        code: "not_on_dispute_path"
      });
    }
  }

  /* THE WORDS COME FROM THE SERVER. body.consent_text is not read, and an
     unknown version is refused rather than silently upgraded to the current
     one — see src/consent/disclosures.mjs. */
  const disclosure = disclosureFor(kind, body.consent_version ?? null);
  if (!disclosure) {
    return res.status(400).json({
      ok: false,
      error: "unknown consent_version — refusing to record agreement to wording I cannot produce",
      code: "consent_version_unknown"
    });
  }

  const consent = await captureConsent(db, {
    orgId,
    clientId,
    kind,
    consentText: disclosure.text,
    consentVersion: disclosure.version,
    grantedBy: actor,
    captureMethod: body.capture_method,
    grantedName: body.granted_name ?? null,
    // Evidence for a web capture; legitimately absent for one recorded off a
    // phone call. Read from the request, never from the body — a caller-supplied
    // IP is not evidence of anything.
    capturedIp: clientIp(req),
    capturedUserAgent: headerValue(req, "user-agent"),
    documentId: isUuid(body.document_id) ? String(body.document_id).trim() : null,
    expiresAt: body.expires_at ?? null
  });

  /* THE SIGNATURE STARTS THE LETTERS. The writer refuses with `no_authorization`
     when the client's documents land before they sign, saves nothing, and
     nothing used to try again. So once the authorization is stored, if this
     client's repair card is waiting on 'analysis', run the SAME call the
     documents door runs (src/repair/start-letters.mjs). It makes letters and
     mails nothing; mailing stays a staff click.

     THE SIGNATURE IS ALREADY SAVED, AND NOTHING BELOW MAY UNDO OR HIDE IT.
     startLettersAfterAuthorization never throws, and a client with no repair
     card, or a card on another stage, gets no writer call at all. */
  if (kind === "dispute_authorization") {
    await startLettersAfterAuthorization(db, {
      orgId,
      clientId,
      staffId: principal.kind === "staff" ? principal.staffId : null
    });
  }

  return res.status(200).json({ ok: true, consent });
}

/* ownsClient — a staff principal may act on any client IN THEIR ORG, and the
   org is CHECKED, not assumed; a client principal may act only on themself.
   accounts.client_id is the binding, and it is the session's copy of it, not
   the body's.

   THE ORG CHECK IS THE POINT, NOT A FORMALITY. This function used to return
   `true` for any staff principal with no query at all, while the comment above
   it claimed it was lifted from api/finance/soft-pull.mjs and answered
   identically. It did not. The pull endpoint next door and
   api/finance/crs-pull.mjs both run `SELECT 1 FROM clients WHERE id = $1 AND
   org_id = $2`; this one ran nothing. The effect was that an employee at org A
   could name org B's consumer and have a consent row written, stamped with org
   A — and because a consent is the thing that unlocks a credit pull, the
   endpoint that was supposed to be no looser than the pull endpoint was in fact
   the way around it. The query below is now the same query, word for word, and
   src/http/consent-capture.test.mjs asserts that the two files still match. */
async function ownsClient(principal, clientId) {
  if (principal.kind === "staff") {
    if (!principal.orgId) return false;
    const r = await db.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [String(clientId).trim(), principal.orgId]
    );
    return r.rows.length > 0;
  }
  return !!principal.clientId && String(principal.clientId) === String(clientId).trim();
}

/* normalizeKind — the requested kind, or null. Defaults to soft_pull_consent.
   An unrecognised one is refused rather than coerced to the default, so a typo
   does not silently record a consent of the wrong type. Permitted kinds live
   in CONSENT_KINDS (099 + 167). */
function normalizeKind(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_KIND;
  const k = String(raw).trim();
  return CONSENT_KINDS.includes(k) ? k : null;
}

function headerValue(req, name) {
  const h = req?.headers || {};
  if (h[name] !== undefined) return String(h[name]);
  const want = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return String(h[k]);
  return null;
}

/* clientIp — best effort, and null when there is no honest answer.
 *
 * x-forwarded-for is a list; the FIRST entry is the original client and the
 * rest are proxies. It is also caller-controllable, which is why this is
 * evidence rather than proof and why the column it lands in is nullable — a
 * fabricated IP is no worse than none, but a MISSING one must not be recorded
 * as some default. 099 stores it as inet, so a malformed value would be a
 * database error rather than a silently stored lie; anything that does not look
 * like an address is dropped here first. */
function clientIp(req) {
  const fwd = headerValue(req, "x-forwarded-for");
  const raw = fwd ? String(fwd).split(",")[0].trim() : (req?.socket?.remoteAddress ?? null);
  if (!raw) return null;
  // IPv4, IPv6, or IPv4-mapped IPv6 as Node hands it over ("::ffff:1.2.3.4").
  const candidate = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw)?.[1] ?? raw;
  const looksV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate);
  const looksV6 = /^[0-9a-f:]+$/i.test(candidate) && candidate.includes(":");
  return looksV4 || looksV6 ? candidate : null;
}
