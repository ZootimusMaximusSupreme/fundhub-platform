// Alex Hormozi / ACQ Drive → local markdown (+ optional Company Brain).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { driveConfigFromEnv } from "./config.mjs";
import { createDriveClientFromConfig } from "./drive-client.mjs";
import { GOOGLE_FOLDER } from "./mime.mjs";
import { extractPdfText } from "./pdf-text.mjs";
import {
  stripToMp3,
  splitMp3Chunks,
  whichBin
} from "./meet-local-whisper.mjs";
import {
  whisperBytes,
  WHISPER_MAX_BYTES,
  WHISPER_CREDITS_ERROR,
  classifyWhisperFailure
} from "./transcribe.mjs";
import { localWhisperVideoAtPath } from "./local-whisper.mjs";
import { callModel, classifyModelFailure, MODEL_NO_CREDIT, DEFAULT_OPENAI_MODEL } from "../agents/model.mjs";
import { upsertGeneratedDocument } from "./ingest-generated.mjs";

export const DEFAULT_FFMPEG =
  process.env.FFMPEG_BIN || "/Users/chrisstanbridge/.local/bin/ffmpeg";

export const HORMOZI_DRIVE_ROOTS = [
  { id: "1kftQwuLTtPsKukz8uJ7RR-s0yipXi1ds", label: "ACQ Scale Advisory (Updated)" },
  { id: "1iSD2Irx7PxnzdcKKAt_VPcrDkkjy94U_", label: "Alex Hormozi library" }
];

export const HORMOZI_SKIP_FOLDER_IDS = new Set([
  "12k3Lw0igfPFKekT88R_01e-OsPj8aftt"
]);

export const DEFAULT_KB_OUT = path.join(process.cwd(), "marketing/knowledge/hormozi");
export const DEFAULT_WORK_DIR = path.join(process.cwd(), "credentials/hormozi-kb-work");

/** Written to `_ingest-state.json` when Whisper or vision hits an empty OpenAI wallet. */
export const INGEST_STOPPED_OPENAI_CREDITS = "openai_credits_exhausted";

export function isWhisperOutOfCredits(spoken) {
  if (spoken?.error === WHISPER_CREDITS_ERROR) return true;
  return classifyWhisperFailure({ error: spoken?.error }).error === WHISPER_CREDITS_ERROR;
}

export function isOpenAiKeyFailure(errText) {
  const t = String(errText || "").toLowerCase();
  return t.includes("invalid_api_key") || t.includes("incorrect api key");
}

/**
 * null = OK to call OpenAI (API Whisper / vision / brain embed).
 * Pass only the modes you will use — local whisper.cpp speech does not need a key.
 */
export function openAiKeyBlockedReason(
  env = process.env,
  { apiSpeech = true, visual = true, brain = true } = {}
) {
  if (!apiSpeech && !visual && !brain) return null;
  const key = String(env.OPENAI_API_KEY || env.COMPANY_BRAIN_OPENAI_API_KEY || "").trim();
  if (!key) return "OPENAI_API_KEY is missing in .env";
  if (key.includes("*")) {
    return "OPENAI_API_KEY is a mask placeholder (****************…) — put the full sk-… key in .env";
  }
  if (!/^sk-/.test(key)) return "OPENAI_API_KEY does not look like a real OpenAI key (expected sk-…)";
  return null;
}

export const FRAME_INTERVAL_SEC = 90;
export const MAX_FRAMES_PER_VIDEO = 25;
export const VISION_BATCH_SIZE = 5;

const VIDEO_PREFIX = "video/";
const PDF_MIME = "application/pdf";

export function ffprobePath(ffmpegBin = DEFAULT_FFMPEG) {
  if (ffmpegBin.endsWith("ffmpeg")) return ffmpegBin.replace(/ffmpeg$/, "ffprobe");
  return path.join(path.dirname(ffmpegBin), "ffprobe");
}

/** spawnSync that resolves ffmpeg/ffprobe to a fixed bin (and which → ffmpeg). */
export function makeFfmpegSpawn(ffmpegBin = DEFAULT_FFMPEG) {
  const probe = ffprobePath(ffmpegBin);
  return (cmd, args, opts) => {
    if (cmd === "ffmpeg") return spawnSync(ffmpegBin, args, opts);
    if (cmd === "ffprobe") return spawnSync(probe, args, opts);
    if (cmd === "which" && args[0] === "ffmpeg") {
      return { status: 0, stdout: `${ffmpegBin}\n`, stderr: "", encoding: "utf8" };
    }
    return spawnSync(cmd, args, opts);
  };
}

/** Max concurrent ffmpeg across parallel ingest workers (Mac protection). */
export const FFMPEG_GLOBAL_SLOTS = 2;

export function ffmpegLockDir(workDir = DEFAULT_WORK_DIR) {
  return path.join(workDir, "locks");
}

function sleepSyncMs(ms) {
  spawnSync("sleep", [String(Math.max(1, Math.ceil(ms / 1000)))], { stdio: "ignore" });
}

/** Block until a global ffmpeg slot is free. Returns release(). */
export function acquireFfmpegSlot(workDir = DEFAULT_WORK_DIR, { maxWaitMs = 6 * 60 * 60 * 1000 } = {}) {
  const dir = ffmpegLockDir(workDir);
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    for (let i = 0; i < FFMPEG_GLOBAL_SLOTS; i += 1) {
      const slotPath = path.join(dir, `ffmpeg-slot-${i}.lock`);
      try {
        const fd = fs.openSync(slotPath, "wx");
        fs.writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
        return () => {
          try {
            fs.closeSync(fd);
          } catch {
            /* stale fd */
          }
          try {
            fs.unlinkSync(slotPath);
          } catch {
            /* another worker */
          }
        };
      } catch (err) {
        if (err?.code !== "EEXIST") throw err;
      }
    }
    sleepSyncMs(2000);
  }
  throw new Error("ffmpeg_slot_timeout");
}

/** Wrap spawn so each ffmpeg invocation holds one global slot. */
export function wrapFfmpegSpawnWithGlobalCap(baseSpawn, workDir = DEFAULT_WORK_DIR) {
  return (cmd, args, opts) => {
    if (cmd !== "ffmpeg") return baseSpawn(cmd, args, opts);
    const release = acquireFfmpegSlot(workDir);
    try {
      return baseSpawn(cmd, args, opts);
    } finally {
      release();
    }
  };
}

export function slugSegment(name) {
  return String(name || "untitled")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled";
}

export function mdBaseName(fileName, fileId) {
  const base = String(fileName || "untitled").replace(/\.[^.]+$/, "");
  const slug = slugSegment(base).slice(0, 80);
  const tail = String(fileId || "").slice(0, 8);
  return `${slug}-${tail}.md`;
}

export function topicDir(outRoot, topicPath) {
  const parts = (topicPath || []).map(slugSegment);
  return path.join(outRoot, ...parts);
}

export function readIngestState(outRoot) {
  const p = path.join(outRoot, "_ingest-state.json");
  if (!fs.existsSync(p)) {
    return { version: 1, pdfs: {}, videos: {}, updatedAt: null };
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { version: 1, pdfs: {}, videos: {}, updatedAt: null };
  }
}

export function writeIngestState(outRoot, state) {
  fs.mkdirSync(outRoot, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(outRoot, "_ingest-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

export async function listChildren(client, folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const items = [];
  for await (const f of client.listAllFiles({ q, pageSize: 200 })) {
    items.push(f);
  }
  return items;
}

/**
 * Walk configured Drive roots; yield non-folder files with topicPath (folder names).
 */
export async function inventoryHormoziDrive(client, {
  roots = HORMOZI_DRIVE_ROOTS,
  skipFolderIds = HORMOZI_SKIP_FOLDER_IDS
} = {}) {
  const files = [];
  for (const root of roots) {
    let rootLabel = root.label;
    try {
      const meta = await client.getFile(root.id);
      if (!rootLabel) rootLabel = meta.name || root.id;
    } catch {
      rootLabel = root.label || root.id;
    }
    const queue = [{ folderId: root.id, topicPath: [rootLabel] }];
    while (queue.length) {
      const { folderId, topicPath } = queue.shift();
      let children;
      try {
        children = await listChildren(client, folderId);
      } catch {
        continue;
      }
      for (const item of children) {
        if (item.mimeType === GOOGLE_FOLDER) {
          if (skipFolderIds.has(item.id)) continue;
          queue.push({
            folderId: item.id,
            topicPath: [...topicPath, item.name || "folder"]
          });
          continue;
        }
        files.push({
          id: item.id,
          name: item.name || "untitled",
          mimeType: item.mimeType || "",
          webViewLink: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
          size: Number(item.size || 0) || null,
          topicPath,
          rootId: root.id
        });
      }
    }
  }
  return files;
}

export function isPdfFile(meta) {
  return meta.mimeType === PDF_MIME;
}

export function isVideoFile(meta) {
  return String(meta.mimeType || "").startsWith(VIDEO_PREFIX);
}

export function buildMarkdownHeader({ title, webViewLink, topicPath }) {
  const topic = (topicPath || []).join(" / ");
  return `# ${title}\n\n- **Drive:** ${webViewLink}\n- **Topic:** ${topic}\n`;
}

export function buildPdfMarkdown(meta, text) {
  return `${buildMarkdownHeader({
    title: meta.name,
    webViewLink: meta.webViewLink,
    topicPath: meta.topicPath
  })}\n## Document text\n\n${text.trim()}\n`;
}

export function buildVideoMarkdown(meta, { speech = "", visualNotes = [] }) {
  let body = buildMarkdownHeader({
    title: meta.name,
    webViewLink: meta.webViewLink,
    topicPath: meta.topicPath
  });
  body += `\n## Speech transcript\n\n${(speech || "").trim() || "(no transcript)"}\n`;
  body += `\n## On-screen notes\n\n`;
  if (!visualNotes.length) {
    body += "(no on-screen notes extracted)\n";
  } else {
    for (const note of visualNotes) {
      body += `### ${formatTimestamp(note.seconds)}\n\n${note.text.trim()}\n\n`;
    }
  }
  return body;
}

export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function videoDurationSec(videoPath, spawn = spawnSync) {
  const r = spawn("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath
  ], { encoding: "utf8", stdio: "pipe" });
  if (r.status !== 0) return null;
  const n = Number(String(r.stdout || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function frameTimestamps(durationSec, {
  intervalSec = FRAME_INTERVAL_SEC,
  maxFrames = MAX_FRAMES_PER_VIDEO
} = {}) {
  if (!durationSec || durationSec <= 0) return [0];
  const times = [];
  for (let t = 0; t < durationSec && times.length < maxFrames; t += intervalSec) {
    times.push(Math.floor(t));
  }
  if (!times.length) times.push(0);
  return times;
}

export function extractFrameAt(videoPath, outPath, seconds, spawn = spawnSync) {
  const r = spawn("ffmpeg", [
    "-y", "-ss", String(seconds), "-i", videoPath,
    "-frames:v", "1", "-q:v", "2", outPath
  ], { encoding: "utf8", stdio: "pipe" });
  return r.status === 0 && fs.existsSync(outPath);
}

export async function whisperAudioPath(audioPath, { env, fetchImpl, spawn }) {
  const chunkDir = path.join(path.dirname(audioPath), "chunks");
  const chunks = splitMp3Chunks(audioPath, chunkDir, { spawn });
  const parts = [];
  for (const chunk of chunks) {
    const bytes = fs.readFileSync(chunk);
    if (bytes.length > WHISPER_MAX_BYTES) {
      return { ok: false, text: "", error: "too_large", retryable: false };
    }
    const spoken = await whisperBytes(bytes, {
      fileName: path.basename(chunk),
      env,
      fetchImpl
    });
    if (!spoken.ok) return spoken;
    if (spoken.text) parts.push(spoken.text);
  }
  const text = parts.join("\n\n").trim();
  if (!text) return { ok: false, text: "", error: "empty_transcript" };
  return { ok: true, text };
}

export async function transcribeVideoAtPath(videoPath, {
  env,
  fetchImpl,
  spawn,
  localWhisper = false,
  workDir = DEFAULT_WORK_DIR
} = {}) {
  if (localWhisper) {
    return localWhisperVideoAtPath(videoPath, { env, spawn, workDir });
  }
  const audioPath = path.join(path.dirname(videoPath), "audio.mp3");
  const mp3 = stripToMp3(videoPath, audioPath, { spawn });
  if (!mp3.ok) return { ok: false, text: "", error: mp3.error || "ffmpeg_failed" };
  return whisperAudioPath(audioPath, { env, fetchImpl, spawn });
}

async function describeFrameBatch(frames, { env, fetchImpl }) {
  const media = frames.map((f) => ({
    type: "image",
    mediaType: "image/jpeg",
    dataBase64: fs.readFileSync(f.path).toString("base64")
  }));
  const stampList = frames.map((f) => formatTimestamp(f.seconds)).join(", ");
  const res = await callModel({
    env,
    fetchImpl,
    model: DEFAULT_OPENAI_MODEL,
    maxTokens: 1200,
    system:
      "You extract on-screen text and slide bullets from Hormozi training videos. " +
      "Be concise. No invented content.",
    user:
      `These frames are at timestamps: ${stampList}. ` +
      "For each timestamp (in order), list visible slide titles, bullets, numbers, and diagrams. " +
      "Format exactly:\nTIMESTAMP | notes\nOne block per frame.",
    media
  });
  if (res.error) {
    const fail = classifyModelFailure({ status: res.status, error: res.error });
    return { ok: false, notes: [], error: res.error, noCredit: fail.reason === MODEL_NO_CREDIT };
  }
  if (!res.text) return { ok: false, notes: [], error: "empty_vision" };
  return { ok: true, notes: parseVisionBatch(res.text, frames), raw: res.text };
}

function parseVisionBatch(text, frames) {
  const lines = String(text).split(/\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < frames.length; i += 1) {
    const want = formatTimestamp(frames[i].seconds);
    const hit = lines.find((l) => l.startsWith(want));
    const body = hit
      ? hit.replace(/^[^|]+\|\s*/, "").trim()
      : lines[i] || "(no notes parsed)";
    out.push({ seconds: frames[i].seconds, text: body });
  }
  return out;
}

export async function visualNotesForVideo(videoPath, workDir, {
  env,
  fetchImpl,
  spawn,
  intervalSec = FRAME_INTERVAL_SEC,
  maxFrames = MAX_FRAMES_PER_VIDEO
}) {
  fs.mkdirSync(workDir, { recursive: true });
  const duration = videoDurationSec(videoPath, spawn);
  const times = frameTimestamps(duration, { intervalSec, maxFrames });
  const framePaths = [];
  for (const sec of times) {
    const fp = path.join(workDir, `frame-${sec}.jpg`);
    if (extractFrameAt(videoPath, fp, sec, spawn)) {
      framePaths.push({ seconds: sec, path: fp });
    }
  }
  const allNotes = [];
  for (let i = 0; i < framePaths.length; i += VISION_BATCH_SIZE) {
    const batch = framePaths.slice(i, i + VISION_BATCH_SIZE);
    const described = await describeFrameBatch(batch, { env, fetchImpl });
    if (!described.ok) {
      return { ok: false, notes: allNotes, error: described.error, noCredit: described.noCredit };
    }
    allNotes.push(...described.notes);
  }
  return { ok: true, notes: allNotes };
}

export function writeOutputMarkdown(outRoot, meta, markdown) {
  const dir = topicDir(outRoot, meta.topicPath);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, mdBaseName(meta.name, meta.id));
  fs.writeFileSync(outPath, markdown, "utf8");
  return outPath;
}

export function writeIndex(outRoot, entries) {
  const byTopic = new Map();
  for (const e of entries) {
    const key = (e.topicPath || []).join(" / ");
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(e);
  }
  const topics = [...byTopic.keys()].sort((a, b) => a.localeCompare(b));
  let md = "# Hormozi knowledge base index\n\n";
  md += `Generated: ${new Date().toISOString()}\n\n`;
  for (const topic of topics) {
    md += `## ${topic}\n\n`;
    const rows = byTopic.get(topic).sort((a, b) => a.title.localeCompare(b.title));
    for (const row of rows) {
      md += `- [${row.title}](${row.relativePath}) — ${row.kind}\n`;
    }
    md += "\n";
  }
  fs.writeFileSync(path.join(outRoot, "INDEX.md"), md, "utf8");
}

export async function ingestPdfFile(client, meta, {
  outRoot,
  workDir,
  state,
  resume
}) {
  if (resume && state.pdfs[meta.id] === "done") {
    return { ok: true, skipped: true, outPath: state.pdfs[`${meta.id}_path`] || null };
  }
  const fileWork = path.join(workDir, "pdfs", meta.id);
  fs.mkdirSync(fileWork, { recursive: true });
  let buf;
  try {
    buf = await client.downloadMedia(meta.id);
  } catch (err) {
    state.pdfs[meta.id] = "error:download";
    return { ok: false, error: String(err.message || err) };
  }
  const extracted = await extractPdfText(buf);
  const text = extracted.text || "";
  const md = buildPdfMarkdown(meta, text);
  const outPath = writeOutputMarkdown(outRoot, meta, md);
  state.pdfs[meta.id] = "done";
  state.pdfs[`${meta.id}_path`] = outPath;
  return { ok: true, outPath, needsOcr: extracted.needsOcr };
}

async function downloadVideoToDisk(client, fileId, videoPath) {
  if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) return;
  if (typeof client.downloadMediaToFile === "function") {
    await client.downloadMediaToFile(fileId, videoPath);
    return;
  }
  const buf = await client.downloadMedia(fileId);
  fs.writeFileSync(videoPath, buf);
}

export async function ingestVideoFile(client, meta, {
  outRoot,
  workDir,
  state,
  resume,
  env,
  fetchImpl,
  spawn,
  doSpeech = true,
  doVisual = true,
  localWhisper = false
}) {
  if (!state.videos[meta.id]) state.videos[meta.id] = {};
  const rec = state.videos[meta.id];
  const fileWork = path.join(workDir, "videos", meta.id);
  fs.mkdirSync(fileWork, { recursive: true });
  const videoPath = path.join(fileWork, "source.bin");

  let speech = rec.speechText || "";
  if (doSpeech) {
    if (resume && rec.speech === "error" && localWhisper) {
      delete rec.speechError;
      delete rec.speech;
    }
    if (resume && rec.speech === "done" && speech) {
      // keep cached speech
    } else {
      try {
        await downloadVideoToDisk(client, meta.id, videoPath);
      } catch (err) {
        rec.error = `download:${String(err.message || err).slice(0, 120)}`;
        return { ok: false, error: rec.error };
      }
      const spoken = await transcribeVideoAtPath(videoPath, {
        env, fetchImpl, spawn, localWhisper, workDir
      });
      if (!spoken.ok) {
        rec.speech = "error";
        rec.speechError = spoken.error;
        if (isWhisperOutOfCredits(spoken)) {
          return { ok: false, error: WHISPER_CREDITS_ERROR, credits: true };
        }
        return { ok: false, error: spoken.error };
      }
      speech = spoken.text;
      rec.speech = "done";
      rec.speechText = speech;
    }
  }

  let visualNotes = rec.visualNotes || [];
  if (doVisual) {
    if (resume && rec.visual === "done" && visualNotes.length) {
      // keep
    } else {
      try {
        await downloadVideoToDisk(client, meta.id, videoPath);
      } catch (err) {
        rec.error = `download:${String(err.message || err).slice(0, 120)}`;
        return { ok: false, error: rec.error };
      }
      const framesDir = path.join(fileWork, "frames");
      const vision = await visualNotesForVideo(videoPath, framesDir, {
        env, fetchImpl, spawn
      });
      if (!vision.ok) {
        rec.visual = "error";
        rec.visualError = vision.error;
        if (vision.noCredit) {
          return { ok: false, error: vision.error, credits: true, partialSpeech: speech };
        }
        return { ok: false, error: vision.error, partialSpeech: speech };
      }
      visualNotes = vision.notes;
      rec.visual = "done";
      rec.visualNotes = visualNotes;
    }
  }

  const md = buildVideoMarkdown(meta, { speech, visualNotes });
  const outPath = writeOutputMarkdown(outRoot, meta, md);
  rec.outPath = outPath;
  rec.done = "done";
  return { ok: true, outPath };
}

export async function loadMarkdownToBrain(db, orgId, meta, markdown, { env, fetchImpl }) {
  return upsertGeneratedDocument(db, {
    orgId,
    sourceType: "hormozi-kb",
    sourceKey: meta.id,
    title: meta.name,
    text: markdown,
    accessTier: "owner",
    env,
    fetchImpl
  });
}

/**
 * Main ingest runner.
 */
export async function runHormoziIngest({
  env = process.env,
  fetchImpl = globalThis.fetch,
  outRoot = DEFAULT_KB_OUT,
  workDir = DEFAULT_WORK_DIR,
  resume = false,
  limit = Infinity,
  videoSkip = 0,
  pdfs = true,
  speech = true,
  visual = true,
  loadBrain = false,
  orgId = null,
  db = null,
  ffmpegBin = DEFAULT_FFMPEG,
  stopOnNoCredits = true,
  localWhisper = false,
  onProgress = null
} = {}) {
  const config = driveConfigFromEnv(env);
  if (!config.ready) {
    return { ok: false, reason: "drive_not_configured", missing: config.missing };
  }
  const spawnBase = makeFfmpegSpawn(ffmpegBin);
  const spawn = wrapFfmpegSpawnWithGlobalCap(spawnBase, workDir);
  if (!whichBin("ffmpeg", spawnBase)) {
    return { ok: false, reason: "ffmpeg_missing" };
  }

  const client = createDriveClientFromConfig(config, { fetchImpl });
  const inventory = await inventoryHormoziDrive(client);
  const state = readIngestState(outRoot);
  const statePath = path.join(outRoot, "_ingest-state.json");
  if (
    stopOnNoCredits &&
    !localWhisper &&
    state.stopped_reason === INGEST_STOPPED_OPENAI_CREDITS
  ) {
    return {
      ok: false,
      reason: INGEST_STOPPED_OPENAI_CREDITS,
      creditsStopped: true,
      alreadyStopped: true,
      statePath
    };
  }
  if (localWhisper && state.stopped_reason === "openai_invalid_or_masked_key") {
    delete state.stopped_reason;
    writeIngestState(outRoot, state);
  }
  const counts = {
    pdfsDone: 0,
    videosSpeechDone: 0,
    videosVisualDone: 0,
    errors: []
  };

  const pdfFiles = inventory.filter(isPdfFile);
  const videoFiles = inventory.filter(isVideoFile);

  if (pdfs) {
    for (const meta of pdfFiles) {
      const r = await ingestPdfFile(client, meta, { outRoot, workDir, state, resume });
      if (r.ok && !r.skipped) counts.pdfsDone += 1;
      if (!r.ok) counts.errors.push({ id: meta.id, kind: "pdf", error: r.error });
      writeIngestState(outRoot, state);
      if (typeof onProgress === "function") onProgress({ phase: "pdf", meta, result: r });
    }
  }

  let processedVideos = 0;
  let creditsStop = false;
  const videoQueue =
    videoSkip > 0 ? videoFiles.slice(Math.max(0, videoSkip)) : videoFiles;
  if (speech || visual) {
    for (const meta of videoQueue) {
      if (processedVideos >= limit) break;
      const rec = state.videos[meta.id] || {};
      if (resume && rec.done === "done" && (!speech || rec.speech === "done") && (!visual || rec.visual === "done")) {
        if (rec.speech === "done") counts.videosSpeechDone += 1;
        if (rec.visual === "done") counts.videosVisualDone += 1;
        continue;
      }
      const r = await ingestVideoFile(client, meta, {
        outRoot,
        workDir,
        state,
        resume,
        env,
        fetchImpl,
        spawn,
        doSpeech: speech,
        doVisual: visual,
        localWhisper
      });
      writeIngestState(outRoot, state);
      if (r.ok) {
        processedVideos += 1;
        if (state.videos[meta.id]?.speech === "done") counts.videosSpeechDone += 1;
        if (state.videos[meta.id]?.visual === "done") counts.videosVisualDone += 1;
        if (loadBrain && db && orgId) {
          const mdPath = state.videos[meta.id]?.outPath;
          if (mdPath && fs.existsSync(mdPath)) {
            const md = fs.readFileSync(mdPath, "utf8");
            await loadMarkdownToBrain(db, orgId, meta, md, { env, fetchImpl });
          }
        }
      } else {
        counts.errors.push({ id: meta.id, kind: "video", error: r.error });
        if (r.credits && stopOnNoCredits) {
          state.stopped_reason = INGEST_STOPPED_OPENAI_CREDITS;
          creditsStop = true;
          break;
        }
        if (
          stopOnNoCredits &&
          !localWhisper &&
          isOpenAiKeyFailure(r.error)
        ) {
          state.stopped_reason = "openai_invalid_or_masked_key";
          creditsStop = true;
          break;
        }
      }
      if (typeof onProgress === "function") onProgress({ phase: "video", meta, result: r });
    }
  }

  if (loadBrain && db && orgId && pdfs && !creditsStop) {
    for (const meta of pdfFiles) {
      if (state.pdfs[meta.id] !== "done") continue;
      const mdPath = state.pdfs[`${meta.id}_path`];
      if (!mdPath || !fs.existsSync(mdPath)) continue;
      const md = fs.readFileSync(mdPath, "utf8");
      await loadMarkdownToBrain(db, orgId, meta, md, { env, fetchImpl });
    }
  }

  const indexEntries = [];
  for (const meta of inventory) {
    let rel = null;
    let kind = "other";
    if (isPdfFile(meta) && state.pdfs[meta.id] === "done") {
      kind = "pdf";
      rel = path.relative(outRoot, state.pdfs[`${meta.id}_path`] || "");
    } else if (isVideoFile(meta) && state.videos[meta.id]?.outPath) {
      kind = "video";
      rel = path.relative(outRoot, state.videos[meta.id].outPath);
    }
    if (rel) {
      indexEntries.push({
        title: meta.name,
        topicPath: meta.topicPath,
        relativePath: rel.split(path.sep).join("/"),
        kind
      });
    }
  }
  writeIndex(outRoot, indexEntries);

  const base = {
    inventory: { pdfs: pdfFiles.length, videos: videoFiles.length, total: inventory.length },
    counts,
    outRoot,
    statePath,
    indexPath: path.join(outRoot, "INDEX.md")
  };
  if (creditsStop) {
    writeIngestState(outRoot, state);
    return {
      ok: false,
      reason: INGEST_STOPPED_OPENAI_CREDITS,
      creditsStopped: true,
      ...base
    };
  }
  if (state.stopped_reason === INGEST_STOPPED_OPENAI_CREDITS) {
    delete state.stopped_reason;
    writeIngestState(outRoot, state);
  }
  return { ok: true, ...base };
}
