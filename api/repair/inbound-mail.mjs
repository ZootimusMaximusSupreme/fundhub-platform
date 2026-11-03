import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { processBureauResponse } from "../../src/repair/response-agent.mjs";
import { runParseAdvanceLoop } from "../../src/repair/parse-loop.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

const ROLES = new Set(["owner", "admin", "closer", "inquiry_specialist"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requireAuth ?? requireAuth;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLES)) return;
  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });
  let body = {};
  try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); }
  catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
  const clientId = body.client_id || body.clientId;
  if (!isUuid(clientId)) return res.status(400).json({ ok: false, error: "client_id_required" });
  const meta = { version: "v1.1", imap: false };
  try {
    if (body.document_id || body.documentId) {
      const result = await (deps.processBureauResponse || processBureauResponse)(database, {
        orgId, clientId,
        documentId: body.document_id || body.documentId,
        versionId: body.version_id || body.versionId || null,
        // Uploaded bytes, MIME and validation fields are read from the saved
        // scoped document, never substituted from this request body.
        ...(deps.loadBytesImpl ? { loadBytesImpl: deps.loadBytesImpl } : {})
      });
      return res.status(200).json({ ok: true, ...meta, result });
    }
    const text = typeof body.text === "string" ? body.text : null;
    if (!text || !text.trim()) return res.status(400).json({ ok: false, error: "text_or_document_required", ...meta });
    const result = await runParseAdvanceLoop(database, { orgId, clientId, text, requireDocumentValidation: true });
    return res.status(200).json({ ok: true, ...meta, result });
  } catch (err) {
    if (dbDown(res, err)) return;
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
