// Attach words to a Meet recording already indexed in Company Brain.
// Prefer a sibling Drive transcript doc (Google Meet Transcript / Gemini notes).
// Short files without a sibling go through Whisper.

import { createDriveClientFromConfig } from "./drive-client.mjs";
import { driveConfigFromEnv } from "./config.mjs";
import { upsertExtractedFile } from "./store.mjs";
import { syncDriveIncremental } from "./sync.mjs";
import { stampCallTranscript } from "../sales/recordings.mjs";
import {
  meetTitleStem,
  looksLikeTranscriptName,
  looksLikeRecordingMime,
  looksLikeMeetRecordingName
} from "./meet-title.mjs";
import {
  whisperBytes,
  whisperConfigFromEnv,
  WHISPER_MAX_BYTES,
  WHISPER_CREDITS_ERROR,
  WHISPER_RATE_LIMIT_ERROR
} from "./transcribe.mjs";

export { WHISPER_CREDITS_ERROR, WHISPER_RATE_LIMIT_ERROR };

export const MEET_SWEEP_ORG_SQL = `
SELECT org_id FROM brain_files WHERE needs_transcription = true
UNION
SELECT org_id FROM brain_drive_sync`;

function isEmbedSkipReason(reason) {
  const r = String(reason || "");
  return r === "embed_failed"
    || r.startsWith("embed_")
    || r.startsWith("not_configured:OPENAI");
}

/** Newest pending A/V rows to size-check. Whisper at most one short file per pass.
 *  Window is wider than the old 8 so a pile of long calls does not hide a short one. */
const WHISPER_CANDIDATE_LIMIT = 40;

function whisperShouldBackoff(spoken) {
  const code = spoken?.error || spoken?.reason;
  return code === WHISPER_CREDITS_ERROR || code === WHISPER_RATE_LIMIT_ERROR;
}

function logWhisperBackoff(reason) {
  if (reason === WHISPER_CREDITS_ERROR) {
    console.warn("[whisper] no OpenAI credits left — files stay pending; next sweep will try again");
    return;
  }
  console.warn("[whisper] OpenAI rate limit — files stay pending; next sweep will try again");
}

export {
  meetTitleStem,
  looksLikeTranscriptName,
  looksLikeRecordingMime,
  looksLikeMeetRecordingName
};

async function fileText(db, fileId) {
  const res = await db.query(
    `SELECT content FROM brain_chunks
      WHERE file_id = $1
      ORDER BY chunk_index`,
    [fileId]
  );
  return (res.rows || []).map((r) => r.content).filter(Boolean).join("\n\n").trim();
}

export async function applyMeetWords(db, {
  orgId,
  extracted,
  text,
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile
} = {}) {
  const words = String(text || "").trim();
  if (!orgId || !extracted?.fileId || !words) {
    return { ok: false, reason: "missing_args" };
  }
  const up = await upsert(db, {
    orgId,
    extracted: {
      ...extracted,
      text: words,
      needsTranscription: false,
      reason: null
    },
    env,
    fetchImpl
  });
  if (extracted.clientId) {
    await stampCallTranscript(db, {
      orgId,
      clientId: extracted.clientId,
      url: extracted.webViewLink || null,
      transcript: words
    });
  }
  if (up.ok) return { ok: true, reason: up.reason || null, fileId: up.fileId || null };
  // Company Brain embed is paused. Sales still needs the words on the call
  // and the file off the pending-transcription queue.
  if (isEmbedSkipReason(up.reason) && extracted.fileId) {
    await db.query(
      `UPDATE brain_files
          SET needs_transcription = false, updated_at = now()
        WHERE org_id = $1 AND drive_file_id = $2`,
      [orgId, extracted.fileId]
    );
    return { ok: true, reason: "sales_words_saved_brain_embed_skipped", fileId: null };
  }
  return { ok: false, reason: up.reason || null, fileId: up.fileId || null };
}

/**
 * Pair pending recordings with already-extracted transcript docs.
 */
export async function pairMeetTranscripts(db, {
  orgId,
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile
} = {}) {
  if (!orgId) return { applied: 0, reason: "org_id_required" };

  const pendingRes = await db.query(
    `SELECT id, drive_file_id, name, mime_type, web_view_link, client_id
       FROM brain_files
      WHERE org_id = $1 AND needs_transcription = true`,
    [orgId]
  );
  const pending = pendingRes.rows || [];
  if (!pending.length) return { applied: 0, reason: null };

  const sourceRes = await db.query(
    `SELECT id, name
       FROM brain_files
      WHERE org_id = $1 AND needs_transcription = false`,
    [orgId]
  );
  const sources = [];
  for (const row of sourceRes.rows || []) {
    if (!looksLikeTranscriptName(row.name)) continue;
    const text = await fileText(db, row.id);
    if (!text) continue;
    sources.push({ ...row, text, stem: meetTitleStem(row.name) });
  }

  let applied = 0;
  for (const rec of pending) {
    const stem = meetTitleStem(rec.name);
    if (!stem) continue;
    const hits = sources.filter((s) => s.stem && s.stem === stem);
    if (hits.length !== 1) continue;
    const out = await applyMeetWords(db, {
      orgId,
      extracted: {
        fileId: rec.drive_file_id,
        name: rec.name,
        mimeType: rec.mime_type,
        webViewLink: rec.web_view_link,
        clientId: rec.client_id || null,
        unattached: !rec.client_id
      },
      text: hits[0].text,
      env,
      fetchImpl,
      upsert
    });
    if (out.ok) applied += 1;
  }
  return { applied, reason: null };
}

async function whisperOnePending(db, {
  orgId,
  env,
  fetchImpl,
  upsert,
  client
}) {
  const pendingRes = await db.query(
    `SELECT id, drive_file_id, name, mime_type, web_view_link, client_id
       FROM brain_files
      WHERE org_id = $1
        AND needs_transcription = true
        AND (
          mime_type LIKE 'video/%'
          OR mime_type LIKE 'audio/%'
        )
      ORDER BY indexed_at DESC NULLS LAST
      LIMIT ${WHISPER_CANDIDATE_LIMIT}`,
    [orgId]
  );
  const whisperCfg = whisperConfigFromEnv(env);
  if (!whisperCfg.ready) {
    return { whispered: 0, skipped: 0, reason: `not_configured:${whisperCfg.missing.join(",")}` };
  }

  let whispered = 0;
  let skipped = 0;
  for (const rec of pendingRes.rows || []) {
    if (!looksLikeMeetRecordingName(rec.name)) {
      skipped += 1;
      continue;
    }
    let size = null;
    try {
      const meta = await client.getFile(rec.drive_file_id);
      size = Number(meta.size || 0) || null;
    } catch {
      skipped += 1;
      continue;
    }
    if (size && size > WHISPER_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    let bytes;
    try {
      bytes = await client.downloadMedia(rec.drive_file_id);
    } catch {
      skipped += 1;
      continue;
    }
    const spoken = await whisperBytes(bytes, {
      fileName: rec.name || "call.mp4",
      env,
      fetchImpl
    });
    if (!spoken.ok) {
      skipped += 1;
      if (whisperShouldBackoff(spoken)) {
        logWhisperBackoff(spoken.error);
        return { whispered, skipped, reason: spoken.error };
      }
      continue;
    }
    const out = await applyMeetWords(db, {
      orgId,
      extracted: {
        fileId: rec.drive_file_id,
        name: rec.name,
        mimeType: rec.mime_type,
        webViewLink: rec.web_view_link,
        clientId: rec.client_id || null,
        unattached: !rec.client_id
      },
      text: spoken.text,
      env,
      fetchImpl,
      upsert
    });
    if (out.ok) {
      whispered += 1;
      return { whispered, skipped, reason: null };
    }
    skipped += 1;
  }
  return { whispered, skipped, reason: null };
}

/**
 * One org pass: pair sibling docs, then Whisper at most one short leftover.
 */
export async function processOrgMeetWords(db, {
  orgId,
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile,
  client: injectedClient = null,
  whisper = true
} = {}) {
  if (!orgId) return { ok: false, paired: 0, whispered: 0, skipped: 0, reason: "org_id_required" };

  const paired = await pairMeetTranscripts(db, { orgId, env, fetchImpl, upsert });
  let whispered = { whispered: 0, skipped: 0, reason: null };

  if (whisper) {
    const config = driveConfigFromEnv(env);
    if (config.ready || injectedClient) {
      const client = injectedClient || createDriveClientFromConfig(config, { fetchImpl });
      whispered = await whisperOnePending(db, {
        orgId, env, fetchImpl, upsert, client
      });
    }
  }

  return {
    ok: true,
    paired: paired.applied || 0,
    whispered: whispered.whispered || 0,
    skipped: whispered.skipped || 0,
    reason: paired.reason || whispered.reason || null
  };
}

export async function sweepMeetTranscripts(db, {
  env = process.env,
  fetchImpl,
  upsert = upsertExtractedFile,
  client: injectedClient = null,
  syncDrive = syncDriveIncremental
} = {}) {
  const orgs = await db.query(MEET_SWEEP_ORG_SQL);
  const summary = { orgs: 0, paired: 0, whispered: 0, skipped: 0, synced: 0, reason: null };
  for (const row of orgs.rows || []) {
    if (typeof syncDrive === "function") {
      const synced = await syncDrive(db, {
        orgId: row.org_id,
        env,
        fetchImpl,
        client: injectedClient
      });
      if (synced?.ok) summary.synced += 1;
    }
    const out = await processOrgMeetWords(db, {
      orgId: row.org_id,
      env,
      fetchImpl,
      upsert,
      client: injectedClient
    });
    summary.orgs += 1;
    summary.paired += out.paired || 0;
    summary.whispered += out.whispered || 0;
    summary.skipped += out.skipped || 0;
    if (whisperShouldBackoff(out)) {
      summary.reason = out.reason;
      break;
    }
  }
  return summary;
}
