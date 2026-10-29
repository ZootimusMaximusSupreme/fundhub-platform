import { callModel } from "../agents/model.mjs";
import { resolveStorageTarget } from "../documents/retrieve.mjs";
import { KINDS } from "../documents/kinds.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { onRepairEvent } from "./handlers.mjs";
import { runParseAdvanceLoop } from "./parse-loop.mjs";

export const RETAKE_TEMPLATE_KEY = "EMAIL-REPAIR-RETAKE-PHOTO";
export const RESPONSE_RESULTS_TEMPLATE_KEY = "EMAIL-REPAIR-RESPONSE-RESULTS";
export const BUREAU_RESPONSE_SYSTEM = [
  "You are the Fundhub bureau-response reader.",
  "A client uploaded a photo or PDF of a credit bureau reply letter.",
  "First check image quality: fully in frame, all corners visible, no glare, not blurry, legible.",
  "If quality fails, set quality to retake and put clear retake instructions in message_to_client.",
  "If quality passes, transcribe the letter text faithfully into text.",
  "Guess which bureau (EX, EQ, TU, or unknown) in bureau_guess.",
  "Never promise removals, score changes, or results.",
  "Reply with ONLY a JSON object, no markdown:",
  '{"quality":"pass"|"retake","text":"...","bureau_guess":"EX"|"EQ"|"TU"|"unknown","message_to_client":"..."}'
].join(" ");

export function parseAgentJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : s;
  try {
    const obj = JSON.parse(body);
    if (!obj || typeof obj !== "object") return null;
    const quality = String(obj.quality || "").toLowerCase() === "pass" ? "pass" : "retake";
    return {
      quality,
      text: typeof obj.text === "string" ? obj.text : "",
      bureau_guess: ["EX", "EQ", "TU"].includes(String(obj.bureau_guess || "").toUpperCase())
        ? String(obj.bureau_guess).toUpperCase() : "unknown",
      message_to_client: typeof obj.message_to_client === "string" ? obj.message_to_client
        : (quality === "retake" ? "Please retake a clear, well-lit photo of the full letter, all corners in frame." : "")
    };
  } catch { return null; }
}

export function mediaFromBytes(mimeType, buffer) {
  const mime = String(mimeType || "application/octet-stream").toLowerCase();
  const data = Buffer.isBuffer(buffer) ? buffer.toString("base64") : Buffer.from(buffer || []).toString("base64");
  if (mime === "application/pdf") return [{ type: "document", mediaType: "application/pdf", dataBase64: data }];
  if (mime.startsWith("image/")) return [{ type: "image", mediaType: mime, dataBase64: data }];
  return [{ type: "document", mediaType: mime || "application/octet-stream", dataBase64: data }];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The docs.received envelope is not a document-access grant. A foreign ID,
 * another customer's upload, an arbitrary contract/ID file, an expired document
 * or a version belonging to somebody else must not reach a model, a repair
 * state change or a client-facing retake/results email.
 *
 * Read only. Database errors deliberately propagate to the existing failed-event
 * queue, rather than being mistaken for a missing/invalid document.
 */
export async function ownsBureauResponseDocument(db, {
  orgId, clientId, documentId, versionId = null
} = {}) {
  if (!db?.query || !UUID.test(String(orgId || "")) ||
      !UUID.test(String(clientId || "")) || !UUID.test(String(documentId || "")) ||
      (versionId != null && !UUID.test(String(versionId)))) return false;
  const result = await db.query(
    `SELECT d.id
       FROM documents d
      WHERE d.id = $1::uuid AND d.org_id = $2::uuid AND d.client_id = $3::uuid
        AND d.kind = $4::text
        AND (d.expires_at IS NULL OR d.expires_at > now())
        AND ($5::uuid IS NULL OR EXISTS (
          SELECT 1 FROM document_versions v
           WHERE v.id = $5::uuid AND v.document_id = d.id AND v.org_id = d.org_id
        ))
      LIMIT 1`,
    [documentId, orgId, clientId, KINDS.BUREAU_RESPONSE, versionId]
  );
  return Boolean(result.rows[0]);
}

async function loadDocumentBytes(db, { documentId, versionId = null, orgId, clientId, store = null }) {
  // This is the only path from document metadata to raw storage credentials.
  // The ownership read must have succeeded first; verify it again on the target.
  const target = await resolveStorageTarget(db, { documentId, versionId });
  if (!target?.storage_key || String(target.org_id) !== String(orgId) ||
      String(target.client_id) !== String(clientId) ||
      (versionId && String(target.version_id) !== String(versionId))) return null;
  const s = store || storeFromEnv();
  const got = await s.get(target.storage_key, { expectedChecksum: target.checksum || null });
  if (!got?.body) return null;
  return { buffer: got.body, mimeType: got.contentType || target.mime_type || "application/octet-stream" };
}

export async function processBureauResponse(db, {
  orgId, clientId, documentId, versionId = null, mimeType = null, bytes = null,
  eventId = null, env = process.env, fetchImpl, callModelImpl = callModel,
  sendTemplatedImpl = sendTemplated, loadBytesImpl = null, onEvent = onRepairEvent, items = null
} = {}) {
  if (!orgId || !clientId || !documentId) return { ok: false, reason: "missing_args" };
  // Even trusted bytes injected by an internal caller cannot bypass ownership.
  // Refuse before any model call, external byte read, letter parsing or message.
  if (!await ownsBureauResponseDocument(db, { orgId, clientId, documentId, versionId })) {
    return { ok: false, reason: "bureau_response_document_unavailable" };
  }
  let buffer = bytes, mime = mimeType;
  if (!buffer) {
    const loaded = await (loadBytesImpl || loadDocumentBytes)(db, { documentId, versionId, orgId, clientId });
    if (!loaded) return { ok: false, reason: "document_bytes_missing" };
    buffer = loaded.buffer; mime = loaded.mimeType;
  }
  const modelResult = await callModelImpl({
    system: BUREAU_RESPONSE_SYSTEM,
    user: "Read this bureau response upload. Return the JSON object only.",
    media: mediaFromBytes(mime, buffer), env, fetchImpl, maxTokens: 2000
  });
  const agent = parseAgentJson(modelResult.text);
  if (!agent) return { ok: false, reason: "agent_unparseable", mode: modelResult.mode, modelError: modelResult.error || null };

  if (agent.quality === "retake") {
    const email = await sendTemplatedImpl(db, {
      orgId, clientId, channel: "email", templateKey: RETAKE_TEMPLATE_KEY,
      eventId: eventId || `bureau-retake:${documentId}`,
      context: { message_to_client: agent.message_to_client, retake_instructions: agent.message_to_client }
    });
    if (typeof onEvent === "function") {
      await onEvent(db, { name: "repair.response.received", orgId, clientId,
        payload: { document_id: documentId, quality: "retake", message_to_client: agent.message_to_client } });
    }
    return { ok: true, status: "retake", quality: "retake", message_to_client: agent.message_to_client, email, parse: null, advanced: null };
  }

  if (typeof onEvent === "function") {
    await onEvent(db, { name: "repair.response.received", orgId, clientId,
      payload: { document_id: documentId, quality: "pass", bureau_guess: agent.bureau_guess } });
  }
  const loop = await runParseAdvanceLoop(db, { orgId, clientId, text: agent.text, items, onEvent });
  if (loop.status === "advanced") {
    await sendTemplatedImpl(db, {
      orgId, clientId, channel: "email", templateKey: RESPONSE_RESULTS_TEMPLATE_KEY,
      eventId: eventId || `bureau-results:${documentId}`,
      context: { outcomes: (loop.parseResult?.outcomes || []).map((o) => o.outcome).join(", ") }
    }).catch(() => null);
  }
  return {
    ok: true, status: loop.status, quality: "pass", bureau_guess: agent.bureau_guess,
    message_to_client: agent.message_to_client || "", parse: loop.parseResult,
    responseId: loop.responseId || null, advanced: loop.advanced || null, event: loop.event || null
  };
}

export async function onBureauResponseDocsReceived(db, event, deps = {}) {
  const payload = event?.payload || event || {};
  if (payload.kind !== "bureau_response") return { ok: true, skipped: true, reason: "not_bureau_response" };
  const orgId = event.orgId || payload.org_id || payload.orgId;
  const clientId = event.clientId || payload.client_id || payload.clientId;
  const documentId = payload.document_id || payload.documentId;
  if (!orgId || !clientId || !documentId) return { ok: false, reason: "missing_docs_received_fields" };
  return processBureauResponse(db, {
    orgId, clientId, documentId,
    versionId: payload.version_id || payload.versionId || null,
    mimeType: payload.mime_type || payload.mimeType || null,
    eventId: event.id || null, ...deps
  });
}
