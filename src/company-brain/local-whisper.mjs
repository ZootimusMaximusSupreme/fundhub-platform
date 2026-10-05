// Local speech-to-text via whisper.cpp (Metal on Apple Silicon when built with WHISPER_METAL=1).
// Used by Hormozi KB ingest — no OpenAI Whisper API.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { splitMp3Chunks, stripToMp3, whichBin } from "./meet-local-whisper.mjs";

export const DEFAULT_MODEL_NAME = "ggml-base.en.bin";
export const MODEL_HF_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

const BREW_WHISPER_PATHS = [
  "/opt/homebrew/bin/whisper-cli",
  "/opt/homebrew/bin/whisper-cpp",
  "/usr/local/bin/whisper-cli",
  "/usr/local/bin/whisper-cpp"
];

function repoWhisperCliCandidates() {
  const root = path.join(process.cwd(), "credentials/hormozi-kb-work/whisper.cpp");
  return [
    path.join(root, "build/bin/whisper-cli"),
    path.join(root, "build/bin/main"),
    path.join(root, "build/bin/Release/whisper-cli"),
    path.join(root, "build/bin/Release/main")
  ];
}

/** Resolve whisper.cpp CLI (whisper-cli preferred on Homebrew whisper-cpp). */
export function resolveWhisperCppBin(env = process.env, spawn = spawnSync) {
  const explicit = String(env.WHISPER_CPP_BIN || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["whisper-cli", "whisper-cpp", "main"]) {
    const hit = whichBin(name, spawn);
    if (hit) return hit;
  }
  for (const p of BREW_WHISPER_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  for (const p of repoWhisperCliCandidates()) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function modelsDirForWork(workDir) {
  return path.join(workDir, "models");
}

export function resolveWhisperModelPath(env = process.env, workDir) {
  const explicit = String(env.WHISPER_CPP_MODEL || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const dir = modelsDirForWork(workDir);
  const names = [
    DEFAULT_MODEL_NAME,
    "ggml-small.en.bin",
    "ggml-medium.en.bin",
    "ggml-large-v3.bin"
  ];
  for (const name of names) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function ensureWhisperModelAsync(workDir, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const existing = resolveWhisperModelPath(env, workDir);
  if (existing) return { ok: true, path: existing };
  const dir = modelsDirForWork(workDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, DEFAULT_MODEL_NAME);
  const url = String(env.WHISPER_CPP_MODEL_URL || MODEL_HF_URL).trim();
  try {
    const res = await fetchImpl(url, { redirect: "follow" });
    if (!res.ok) {
      return { ok: false, error: `model_download_http_${res.status}`, path: null };
    }
    const ab = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(ab));
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String(err.message || err), path: null };
  }
}

function readWhisperTxtOutput(mp3Path, outPrefix) {
  const candidates = [
    `${outPrefix}.txt`,
    `${mp3Path}.txt`,
    mp3Path.replace(/\.mp3$/i, ".txt")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8").trim();
    }
  }
  return "";
}

/** Run whisper.cpp on one MP3 file; returns transcript text. */
export function transcribeMp3File(mp3Path, {
  bin,
  model,
  spawn = spawnSync,
  language = "en"
} = {}) {
  if (!bin) return { ok: false, text: "", error: "whisper_cpp_missing" };
  if (!model || !fs.existsSync(model)) {
    return { ok: false, text: "", error: "whisper_model_missing" };
  }
  if (!fs.existsSync(mp3Path)) {
    return { ok: false, text: "", error: "audio_missing" };
  }
  const outPrefix = mp3Path.replace(/\.mp3$/i, "");
  const args = [
    "-m", model,
    "-f", mp3Path,
    "-l", language,
    "-otxt",
    "-of", outPrefix,
    "-nt"
  ];
  const r = spawn(bin, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  const text = readWhisperTxtOutput(mp3Path, outPrefix);
  if (r.status !== 0 && !text) {
    const errSnippet = String(r.stderr || r.stdout || "").slice(0, 400);
    return { ok: false, text: "", error: errSnippet || "whisper_cpp_failed" };
  }
  if (!text) return { ok: false, text: "", error: "empty_transcript" };
  return { ok: true, text };
}

/** Chunk MP3 (same limits as API path), whisper.cpp each chunk, join text. */
export async function localWhisperAudioPath(audioPath, {
  env = process.env,
  spawn = spawnSync,
  workDir
} = {}) {
  const bin = resolveWhisperCppBin(env, spawn);
  if (!bin) {
    return {
      ok: false,
      text: "",
      error: "whisper_cpp_missing: brew install whisper-cpp (or set WHISPER_CPP_BIN)"
    };
  }
  const wd = workDir || path.dirname(audioPath);
  const modelReady = await ensureWhisperModelAsync(wd, { env });
  if (!modelReady.ok) {
    return { ok: false, text: "", error: modelReady.error || "whisper_model_missing" };
  }
  const model = modelReady.path;
  const chunkDir = path.join(path.dirname(audioPath), "chunks");
  const chunks = splitMp3Chunks(audioPath, chunkDir, { spawn });
  const parts = [];
  for (const chunk of chunks) {
    const spoken = transcribeMp3File(chunk, { bin, model, spawn });
    if (!spoken.ok) return spoken;
    if (spoken.text) parts.push(spoken.text);
  }
  const text = parts.join("\n\n").trim();
  if (!text) return { ok: false, text: "", error: "empty_transcript" };
  return { ok: true, text };
}

export async function localWhisperVideoAtPath(videoPath, { env, spawn, workDir }) {
  const audioPath = path.join(path.dirname(videoPath), "audio.mp3");
  const mp3 = stripToMp3(videoPath, audioPath, { spawn });
  if (!mp3.ok) return { ok: false, text: "", error: mp3.error || "ffmpeg_failed" };
  return localWhisperAudioPath(audioPath, { env, spawn, workDir });
}
