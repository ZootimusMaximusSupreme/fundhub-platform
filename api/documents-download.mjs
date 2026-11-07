// GET /api/documents-download?id=<uuid> — mint a FRESH signed link for a saved
// document, for a caller who is signed in right now.
//
// THE HOLE THIS FILLS. A working link to a saved file was minted exactly once,
// in the reply to the upload (api/documents-upload.mjs), and expired 15 minutes
// later. After that the bytes were unreachable: api/read/documents and
// api/read/portal-summary both serve metadata with storage_key stripped, and
// api/documents/[id].mjs takes a signature it has no way to obtain. So an ID a
// client photographed and a letter the system generated both saved correctly
// and could never be opened again. This endpoint is the missing half — the four
// readers in src/documents/retrieve.mjs were written for it and had zero
// callers.
//
// IT MINTS, IT DOES NOT SERVE. The bytes still come from api/documents/[id].mjs,
// which is unchanged. This endpoint answers "what is a link I can use", the
// other one answers "give me the file". Two gates, deliberately different:
//
//   here                        api/documents/[id].mjs
//   ────                        ──────────────────────
//   a live session              the HMAC on the link
//   org + ownership in SQL      the signature and its expiry
//
// That split is why an emailed link keeps working for a signed-out client while
// this endpoint refuses everyone who is not signed in.
//
// NOTHING NEW IS SIGNED HERE. signDocumentUrl() lives in
// src/documents/signed-url.mjs and is reached through shapeDocument() inside
// retrieve.mjs — see getDocument()'s `sign` option. There is one signing
// implementation in this repo and this file is not a second one.
//
// LIVES AT api/documents-download.mjs, NOT api/documents/download.mjs, for the
// reason api/documents-upload.mjs spells out: netlify/functions/api.mjs reaches
// the signed download route by a PREFIX branch on "documents/", and
// src/http/routes.test.mjs deliberately fails on any exact ROUTES key that would
// sit under that prefix and depend on lookup order.
//
// STORAGE KEYS NEVER APPEAR. getDocument() selects an explicit column list that
// omits storage_key and shapeDocument() deletes it again for good measure. This
// file adds no query of its own, so there is no third place for one to escape.
//
// NOTHING IS LOGGED. No filename, no title, no storage key, no URL. A log line
// naming a document is a leak on a screen full of credit reports and photo IDs,
// and a log line containing a signed URL is a bearer credential in a log file.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { getDocument, getVersion } from "../src/documents/retrieve.mjs";
import { DEFAULT_TTL_SECONDS } from "../src/documents/signed-url.mjs";
import { safeError } from "../src/http/health.mjs";

/* Employees who may open a saved file.
 *
 * ROLE_SETS.STAFF, which is exactly the set api/read/documents.mjs already uses
 * to LIST these same rows. Deliberately not narrower and deliberately not wider:
 * anybody who can already read a document's title, class and client can open it,
 * and nobody else gains anything. If this product ever needs "may see the row,
 * may not open the file", that is a new decision and it belongs here, in the
 * open, not as a side effect of a set that also gates ten other screens. */
const DOWNLOAD_ROLES = ROLE_SETS.STAFF;

/* THE SAME 404 FOR EVERY REFUSAL that is about a document rather than a session.
 *
 * Unknown id, another company's document, another client's document, a deleted
 * one — all identical. Distinguishing them turns this endpoint into an oracle:
 * a signed-in client could walk uuids and learn which ones exist, and a staff
 * member at one company could learn how many documents another company holds.
 * api/documents/[id].mjs makes the same choice for the same reason. */
const GONE = (res) => res.status(404).json({ ok: false, error: "not_found" });

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // THE FIRST GATE. requirePrincipal writes its own 401/403 and returns null.
  // Staff AND clients, same as api/documents-upload.mjs: a client opens their
  // own file from the portal, an employee opens a client's file from the
  // Documents desk.
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  /* THE SECOND GATE, and it must be a separate call.
     requireAuth() forwards its opts to authenticate(), which reads only
     { db, env } — a `roles` key there is silently dropped and the endpoint ends
     up with no role gate at all (CLAUDE.md §12, src/http/auth-gate.test.mjs).
     Clients are not role-gated; they are gated by ownership below, which is a
     stronger check than any role set. */
  if (principal.kind === "staff"
      && !requireRole(res, principal.staff || { role: principal.role }, DOWNLOAD_ROLES)) {
    return;
  }

  /* FAIL CLOSED ON THE ORG, before anything is read.
     getDocument() treats a null orgId as "any org" — correct for its internal
     callers, catastrophic here. A session with no org must be refused, never
     silently promoted to a cross-company read. */
  const orgId = principal.orgId || null;
  if (!orgId) return res.status(400).json({ ok: false, error: "org_required" });

  const documentId = (req.query && req.query.id) || null;
  // Shape check first: a malformed id must not reach Postgres as a 22P02.
  if (!isUuid(documentId)) return res.status(400).json({ ok: false, error: "invalid_id" });

  try {
    /* THE TENANCY GATE IS THIS ARGUMENT. getDocument() adds
       `AND ($2::uuid IS NULL OR d.org_id = $2)` to its WHERE, so passing the
       session's org — never a query parameter — is what stops one company
       reaching another company's document. src/http/read-api.mjs:150-153 records
       the decision to leave scoping to each endpoint's own SQL; ten endpoints
       then kept the comment and skipped the clause. This is the clause. */
    /* NO baseUrl — the link comes back as a same-origin PATH, deliberately.
       signDocumentUrl() returns an absolute URL only when it is handed an
       origin, and working that origin out from request headers means guessing a
       protocol: with no x-forwarded-proto it has to assume https, which is right
       behind Netlify and wrong against a plain-http dev server, where the link
       then fails to load at all. This link is opened by a browser that is
       already on this origin, so it never needs one. Absolute URLs are for links
       that LEAVE the page — an email — and that caller passes its own baseUrl
       (see baseUrlFromRequest in src/documents/signed-url.mjs). */
    const document = await getDocument(db, {
      orgId,
      documentId,
      sign: { ttlSeconds: DEFAULT_TTL_SECONDS }
    });
    if (!document) return GONE(res);

    /* A CLIENT REACHES THEIR OWN FILE AND NOTHING ELSE.
       Org scoping is not enough for a client principal — every client of a
       company shares its org, so the org clause alone would let any signed-in
       client open any other client's credit report. Same rule as
       ownsClient() in api/documents-upload.mjs and api/consent/capture.mjs. */
    if (principal.kind === "client") {
      const mine = principal.clientId
        && document.client_id
        && String(document.client_id) === String(principal.clientId);
      if (!mine) return GONE(res);
    }

    // A document may expire on its own schedule; an expired one has no link.
    if (document.expired) return GONE(res);

    /* ONE SAVED VERSION, for the full credit report of each soft pull (the
       fulfillment cycle, src/blueprint/fulfillment-cycle.mjs). Same document,
       same ownership gate above; only which saved version is signed changes. */
    const wanted = req.query && req.query.version;
    if (wanted !== undefined && wanted !== null && wanted !== "") {
      if (!/^[1-9]\d{0,5}$/.test(String(wanted))) return res.status(400).json({ ok: false, error: "invalid_version" });
      const version = await getVersion(db, { orgId, documentId, version: Number(wanted),
        sign: { ttlSeconds: DEFAULT_TTL_SECONDS } });
      if (!version || !version.download) return GONE(res);
      res.setHeader("cache-control", "private, no-store");
      res.setHeader("x-content-type-options", "nosniff");
      return res.status(200).json({ ok: true,
        document: { ...publicShape(document), version: version.version, download: version.download } });
    }

    /* A SIGNED URL IS A BEARER CREDENTIAL FOR ITS LIFETIME, so it must not sit
       in a shared cache. Same headers api/documents/[id].mjs sets on the bytes. */
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    return res.status(200).json({ ok: true, document: publicShape(document) });
  } catch (err) {
    // safeError strips DSNs and hostnames. The document is never named.
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

/* publicShape — the answer, narrowed to what a caller actually needs.
 *
 * getDocument() returns the registry's FULL public column set. That set is
 * right for its internal callers and too wide to hand back here, because this
 * endpoint answers a CLIENT as well as staff, and those columns carry
 * `metadata` — which for an upload holds the original filename and an
 * `uploaded_by` object naming the STAFF MEMBER's id — plus `checksum`,
 * `generated_by`, `signature_ref` and `org_id`. A consumer asking to open their
 * own bank statement has no reason to learn which employee filed it.
 *
 * Note what the caller is NOT trusted to tell us and what they gain nothing
 * from being told: this is an allow-list, so a column added to the registry
 * tomorrow does not silently start reaching a client. Widen it deliberately.
 */
function publicShape(d) {
  return {
    id: d.id,
    client_id: d.client_id,
    title: d.title,
    document_key: d.document_key,
    kind: d.kind,
    subtype: d.subtype,
    mime_type: d.mime_type,
    byte_size: d.byte_size,
    current_version: d.current_version,
    download: d.download || null
  };
}
