// Persist extracted Drive files as chunked embeddings (pgvector).
// Default access_tier is 'owner' — fail closed until classification exists.

import crypto from "node:crypto";
import { chunkText } from "./chunk.mjs";
import { embedTexts, toVectorLiteral } from "./embed.mjs";
import { classifyAndApply } from "./review.mjs";
import { attachDriveRecording } from "../sales/recordings.mjs";

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Drive file name can hold any UUID (an iPhone export is named <UUID>.mp4), so the
 * id sniffed from a name is only a guess. Keep it only when that client exists in this
 * company. Otherwise the file is saved with no client (NULL) and counts as unattached.
 */
async function clientIdThatExists(db, orgId, clientId) {
  const id = String(clientId || "").trim().toLowerCase();
  if (!UUID_SHAPE.test(id)) return null;
  const res = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [id, orgId]
  );
  return res.rows?.[0]?.id ? id : null;
}

/**
 * Upsert one extracted file + its chunks.
 * `extracted` is the shape from extractFromDriveFile / walkDriveAndExtract.
 *
 * @returns {{ ok, fileId?, chunkCount?, skipped?, reason? }}
 */
export async function upsertExtractedFile(db, {
  orgId,
  extracted: extractedIn,
  accessTier = "owner", // fail-closed default before classification
  env = process.env,
  fetchImpl,
  embed = embedTexts,
  classify = true,
  classifyFn = null
} = {}) {
  if (!orgId) return { ok: false, reason: "org_id_required" };
  if (!extractedIn?.fileId) return { ok: false, reason: "drive_file_id_required" };

  // Never save a client id that points at no client of this company.
  let extracted = extractedIn;
  if (extractedIn.clientId) {
    const clientId = await clientIdThatExists(db, orgId, extractedIn.clientId);
    if (!clientId) extracted = { ...extractedIn, clientId: null, unattached: true };
  }

  const tier = ACCESS_TIER_OR_OWNER(accessTier);
  const text = String(extracted.text || "");
  const contentHash = text ? sha256(text) : null;

  // Skip re-embed when content unchanged.
  const existing = await db.query(
    `SELECT id, content_sha256 FROM brain_files
      WHERE org_id = $1 AND drive_file_id = $2`,
    [orgId, extracted.fileId]
  );
  const prior = existing.rows?.[0];
  if (prior && contentHash && prior.content_sha256 === contentHash) {
    return { ok: true, fileId: prior.id, chunkCount: 0, skipped: true, reason: "unchanged" };
  }

  if (extracted.needsTranscription && !text) {
    const fileId = await upsertFileRow(db, {
      orgId,
      extracted,
      tier,
      contentHash: null,
      priorId: prior?.id
    });
    const classification = await maybeClassify(db, {
      orgId, fileId, extracted, env, fetchImpl, classify, classifyFn
    });
    await attachDriveRecording(db, {
      orgId,
      clientId: extracted.clientId || null,
      fileName: extracted.name,
      url: extracted.webViewLink || null
    });
    return { ok: true, fileId, chunkCount: 0, skipped: false, reason: "needs_transcription", classification };
  }

  if (!text) {
    const fileId = await upsertFileRow(db, {
      orgId,
      extracted,
      tier,
      contentHash: null,
      priorId: prior?.id
    });
    const classification = await maybeClassify(db, {
      orgId, fileId, extracted, env, fetchImpl, classify, classifyFn
    });
    return { ok: true, fileId, chunkCount: 0, skipped: false, reason: extracted.reason || "empty", classification };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { ok: false, reason: "no_chunks" };
  }

  const embedded = await embed(chunks, { env, fetchImpl });
  if (!embedded.ok) {
    return { ok: false, reason: embedded.error || "embed_failed" };
  }

  const fileId = await upsertFileRow(db, {
    orgId,
    extracted,
    tier,
    contentHash,
    priorId: prior?.id
  });

  await db.query(`DELETE FROM brain_chunks WHERE file_id = $1`, [fileId]);

  for (let i = 0; i < chunks.length; i++) {
    const vec = toVectorLiteral(embedded.embeddings[i]);
    await db.query(
      `INSERT INTO brain_chunks (org_id, file_id, chunk_index, content, access_tier, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [orgId, fileId, i, chunks[i], tier, vec]
    );
  }

  const classification = await maybeClassify(db, {
    orgId, fileId, extracted, env, fetchImpl, classify, classifyFn
  });
  return {
    ok: true,
    fileId,
    chunkCount: chunks.length,
    skipped: false,
    reason: null,
    classification
  };
}

/**
 * Write searchable OpenAI embeddings onto an existing brain file.
 * Used when a training pack was approved but landed with no chunks.
 */
export async function replaceFileChunks(db, {
  orgId,
  fileId,
  text,
  accessTier = "staff",
  env = process.env,
  fetchImpl,
  embed = embedTexts
} = {}) {
  if (!orgId) return { ok: false, reason: "org_id_required" };
  if (!fileId) return { ok: false, reason: "file_id_required" };
  const chunks = chunkText(String(text || ""));
  if (!chunks.length) return { ok: false, reason: "no_chunks" };

  const embedded = await embed(chunks, { env, fetchImpl });
  if (!embedded.ok) return { ok: false, reason: embedded.error || "embed_failed" };
  if ((embedded.embeddings || []).length !== chunks.length) {
    return { ok: false, reason: "embed_failed" };
  }

  const tier = ACCESS_TIER_OR_OWNER(accessTier);
  const contentHash = sha256(String(text || ""));

  await db.query(`DELETE FROM brain_chunks WHERE file_id = $1 AND org_id = $2`, [fileId, orgId]);
  for (let i = 0; i < chunks.length; i++) {
    await db.query(
      `INSERT INTO brain_chunks (org_id, file_id, chunk_index, content, access_tier, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [orgId, fileId, i, chunks[i], tier, toVectorLiteral(embedded.embeddings[i])]
    );
  }
  await db.query(
    `UPDATE brain_files
        SET content_sha256 = $3, indexed_at = now(), updated_at = now()
      WHERE id = $1 AND org_id = $2`,
    [fileId, orgId, contentHash]
  );
  return { ok: true, chunkCount: chunks.length };
}


async function maybeClassify(db, {
  orgId, fileId, extracted, env, fetchImpl, classify, classifyFn
}) {
  if (!classify || !fileId) return null;
  return classifyAndApply(db, {
    orgId,
    fileId,
    driveFileId: extracted.fileId,
    name: extracted.name,
    path: extracted.path || extracted.name,
    text: extracted.text,
    parentNames: extracted.parentNames,
    env,
    fetchImpl,
    classify: classifyFn
  });
}

function ACCESS_TIER_OR_OWNER(tier) {
  const t = String(tier || "owner").toLowerCase();
  if (["public", "sales", "staff", "owner", "affiliate"].includes(t)) return t;
  return "owner";
}

async function upsertFileRow(db, { orgId, extracted, tier, contentHash, priorId }) {
  if (priorId) {
    await db.query(
      `UPDATE brain_files SET
         name = $2,
         mime_type = $3,
         web_view_link = $4,
         access_tier = $5,
         client_id = $6,
         unattached = $7,
         needs_transcription = $8,
         needs_ocr = $9,
         content_sha256 = $10,
         indexed_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [
        priorId,
        extracted.name || "",
        extracted.mimeType || "",
        extracted.webViewLink || null,
        tier,
        extracted.clientId || null,
        !!extracted.unattached,
        !!extracted.needsTranscription,
        !!extracted.needsOcr,
        contentHash
      ]
    );
    return priorId;
  }

  const ins = await db.query(
    `INSERT INTO brain_files (
       org_id, drive_file_id, name, mime_type, web_view_link,
       access_tier, client_id, unattached, needs_transcription, needs_ocr,
       content_sha256, indexed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     RETURNING id`,
    [
      orgId,
      extracted.fileId,
      extracted.name || "",
      extracted.mimeType || "",
      extracted.webViewLink || null,
      tier,
      extracted.clientId || null,
      !!extracted.unattached,
      !!extracted.needsTranscription,
      !!extracted.needsOcr,
      contentHash
    ]
  );
  return ins.rows[0].id;
}

/** Remove a Drive file from the index (cascade deletes chunks). */
export async function deleteByDriveFileId(db, { orgId, driveFileId } = {}) {
  if (!orgId || !driveFileId) {
    return { ok: false, reason: "org_id_and_drive_file_id_required", deleted: 0 };
  }
  const res = await db.query(
    `DELETE FROM brain_files
      WHERE org_id = $1 AND drive_file_id = $2
      RETURNING id`,
    [orgId, driveFileId]
  );
  return { ok: true, reason: null, deleted: (res.rows || []).length };
}
