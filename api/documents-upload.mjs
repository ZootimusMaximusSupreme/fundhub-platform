// POST /api/documents-upload — a client file lands in storage AND in the
// documents registry, in one call. See docs/UPLOADS-SPEC.md for the full
// design; this file is the ~150-line handler that design describes.
//
// SERVES STAFF AND CLIENT PRINCIPALS, same pattern as api/consent/capture.mjs:
// a client uploads their own documents from the portal; a staff member uploads
// on a client's behalf from the client screen. ownsClient() below is the same
// check that file uses — a client principal may only ever act on themself, a
// staff principal may act on any client in their own org.
//
// EVERY FILE IS SNIFFED, NEVER TRUSTED. A multipart field's declared filename
// and Content-Type are whatever the browser (or a hand-crafted request) said
// they were; src/documents/upload-validate.mjs checks the actual bytes against
// each accepted type's magic number before anything is stored or registered.
//
// ONE DOCUMENT PER FILE, NEVER ONE PER CLIENT. buildDocumentKey()'s default
// shape collapses onto one row per (kind, subtype, client) — right for a
// generated deliverable that gets *regenerated*, wrong here: a client sending
// three bank statements must end up with three documents, not one row that
// overwrites itself twice. Each file gets its own random discriminator so it
// registers as its own document_key.
//
// EMITS docs.received, NOT A NEW "docs.uploaded" EVENT. The brief for this
// build named docs.uploaded, but no such event exists anywhere in this
// codebase — grep confirms it. docs.received DOES: it is already a canonical
// event (src/events/canonical.mjs), and src/workflows/f-06-funding-conditions-
// missing-docs.mjs already listens for it to clear a client's "Missing
// Documents" hold, which is exactly the real-world effect of a client
// finishing an upload. Canonical event names are proposed in
// src/documents/PROPOSED-EVENTS.md and added to canonical.mjs by Darwin's call
// (see that file's header) — inventing a second, uncanonical name here would
// both violate that process and leave F-06 listening to nothing.
//
// LIVES AT api/documents-upload.mjs, NOT api/documents/upload.mjs. The signed
// download route (api/documents/[id].mjs) is reached by a PREFIX branch in
// netlify/functions/api.mjs ("documents/" → treat the rest as a document id),
// and src/http/routes.test.mjs deliberately fails on any exact ROUTES key that
// would sit under that prefix and depend on lookup order. A flat top-level
// file sidesteps the ambiguity entirely instead of relying on the exact-match
// lookup always running first.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../src/http/read-api.mjs";
import { storeAndRegister } from "../src/documents/register.mjs";
import { getDocument } from "../src/documents/retrieve.mjs";
import { storeFromEnv } from "../src/documents/store.mjs";
import { baseUrlFromRequest } from "../src/documents/signed-url.mjs";
import { KINDS, isKnownSubtype } from "../src/documents/kinds.mjs";
import { isPortalUploadKind } from "../src/repair/upload-doors.mjs";
import { validateUpload, maxUploadBytes } from "../src/documents/upload-validate.mjs";
import { emit } from "../src/events/bus.mjs";
import { safeError } from "../src/http/health.mjs";
import { evaluateDocGate } from "../src/inquiry-ops/doc-gate.mjs";
import { removeTags } from "../src/workflows/tags.mjs";

const DEFAULT_SUBTYPE = "other";
const DEFAULT_KIND = KINDS.CLIENT_UPLOAD;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  const orgId = principal.orgId;
  if (!orgId) {
    return res.status(400).json({ ok: false, error: "org_id is required" });
  }

  const body = req.body || {};
  const fields = body.fields || {};
  const files = Array.isArray(body.files) ? body.files : [];

  if (!files.length) {
    return res.status(400).json({ ok: false, error: "no file in the request" });
  }

  const clientId = principal.kind === "client"
    ? principal.clientId
    : (typeof fields.client_id === "string" ? fields.client_id.trim() : null);

  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  if (!ownsClient(principal, clientId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  if (principal.kind === "staff") {
    const belongs = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
    if (!belongs.rows[0]) return res.status(404).json({ ok: false, error: "no such client" });
  }

  const kindRaw = typeof fields.kind === "string" ? fields.kind.trim() : "";
  const kind = isPortalUploadKind(kindRaw) ? kindRaw : DEFAULT_KIND;
  const subtypeRaw = typeof fields.subtype === "string" ? fields.subtype.trim() : "";
  const subtype = subtypeRaw && isKnownSubtype(kind, subtypeRaw) ? subtypeRaw : DEFAULT_SUBTYPE;

  /* WHO SAID THIS FILE WAS A "DOCUMENT"?
     A file lands as subtype "other" for three completely different reasons, and
     until now the stored row could not tell them apart:
       given       — the caller said "other", and meant it;
       none_given  — the caller sent no label at all (the staff drop box does
                     this: it posts the file and the client id and nothing
                     else), so "other" is our word, not theirs;
       unrecognised — the caller named something we do not have a name for.
     Only the first is a real answer. The other two are a file nobody has
     described, which is exactly the file that then reads as "photo ID missing"
     while the correct photo ID sits on the record. The endpoint still accepts
     all three, and still never guesses what the file is — it just stops
     erasing the difference, so the gap is countable instead of invisible. */
  const labelSource = !subtypeRaw
    ? "none_given"
    : (subtypeRaw === subtype ? "given" : "unrecognised");

  /* WHICH BUSINESS IS THIS PAPER FOR? (application document vault, B3)
     A business bank statement belongs to one business, and a client can have
     several. The vault sends `entity_id` — the business container's id — with the
     upload, and it is kept on the document (metadata.entity_id) so the vault files
     the paper under the right business without anyone guessing from a file name.
     It must be one of THIS client's active business containers; anything else is
     refused rather than silently dropped, because a paper filed under the wrong
     business is worse than a paper that failed to upload. Optional: every other
     upload is exactly what it was. */
  const entityRaw = typeof fields.entity_id === "string" ? fields.entity_id.trim() : "";
  let entityId = null;
  if (entityRaw) {
    if (!isUuid(entityRaw)) {
      return res.status(400).json({ ok: false, error: "entity_id must be a uuid" });
    }
    const own = await db.query(
      `SELECT 1 FROM entities
        WHERE id = $1 AND org_id = $2 AND client_id = $3 AND kind = 'business' AND archived_at IS NULL`,
      [entityRaw, orgId, clientId]
    );
    if (!own.rows[0]) return res.status(404).json({ ok: false, error: "no such business" });
    entityId = entityRaw;
  }

  const maxBytes = maxUploadBytes();
  const store = storeFromEnv();
  const actor = principal.kind === "staff"
    ? { kind: "staff", id: principal.staffId }
    : { kind: "client", id: principal.accountId || principal.clientId };

  const results = [];
  try {
    for (const file of files) {
      const verdict = validateUpload({
        buffer: file.buffer, declaredMimeType: file.mimeType, maxBytes
      });
      if (!verdict.ok) {
        return res.status(400).json({
          ok: false, error: verdict.code, message: verdict.message, filename: file.filename || null
        });
      }

      const { document, version } = await storeAndRegister(db, store, {
        orgId,
        clientId,
        kind,
        subtype,
        discriminator: cryptoRandomId(),
        body: file.buffer,
        filename: file.filename,
        mimeType: verdict.mimeType,
        generatedBy: `${actor.kind}:${actor.id || "unknown"}`,
        reason: "initial",
        metadata: {
          original_filename: file.filename || null,
          uploaded_by: actor,
          // What the caller called this file, and whether we could use it.
          label: { given: subtypeRaw || null, filed_as: subtype, source: labelSource },
          // The business container this paper is for (vault). Absent on every other upload.
          ...(entityId ? { entity_id: entityId } : {})
        }
      });

      await emit(db, "docs.received", {
        document_id: document.id,
        version_id: version.id,
        version: version.version,
        kind: document.kind,
        subtype: document.subtype,
        client_id: clientId,
        uploaded_by: actor,
        mime_type: version.mime_type,
        byte_size: version.byte_size,
        checksum: version.checksum,
        original_filename: file.filename || null
      }, { orgId, clientId });

      const shaped = await getDocument(db, {
        orgId, documentId: document.id, sign: { baseUrl: baseUrlFromRequest(req) }
      });
      results.push(shaped);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }

  /* "WE STILL NEED YOUR DOCUMENTS" MUST STOP SAYING THAT ONCE THEY ARE HERE.
     Three things could take the docs:missing flag off a client and not one of
     them fires for an ordinary funding client who simply uploads their papers:
     the inquiry handler needs a blocked inquiry case first, the F-02 chase only
     re-checks after a two-day sleep, and the document agent only clears it on
     an accept it has not produced once. So the flag stayed on while the files
     sat on the record.
     It is cleared HERE, on arrival, and only when nothing at all is missing —
     the same completeness answer every other caller uses. An incomplete packet
     keeps the flag, because a client who has sent two of the three things they
     were asked for has not finished, and telling them otherwise is worse than
     leaving the reminder on. Nothing here judges whether a document is genuine
     or readable; that is the document agent's job, and it is a separate one. */
  let docsFlag = null;
  try {
    const packet = await evaluateDocGate(db, { orgId, clientId, items: [] });
    if (packet.complete) {
      await removeTags(db, clientId, ["docs:missing"]);
      docsFlag = "cleared";
    } else {
      docsFlag = "kept";
    }
  } catch {
    // The files are stored and registered. A failure to tidy a flag must not
    // turn a successful upload into an error the client sees.
    docsFlag = null;
  }

  return res.status(200).json({ ok: true, documents: results, docs_missing: docsFlag });
}

/* ownsClient — a staff principal may act on any client in their org; a client
   principal may act only on themself. Lifted from api/consent/capture.mjs so
   the two endpoints answer identically. */
function ownsClient(principal, clientId) {
  if (principal.kind === "staff") return true;
  return !!principal.clientId && String(principal.clientId) === String(clientId).trim();
}

function cryptoRandomId() {
  // crypto.randomUUID() is a Node global since 14.17 — no import needed, and
  // avoids importing all of node:crypto just for this one call.
  return crypto.randomUUID();
}
