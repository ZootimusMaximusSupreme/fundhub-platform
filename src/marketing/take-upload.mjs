// Save the video from the teleprompter into the one SLO Ads Drive folder.
//
// The phone cannot reach the Mac when Chris is away. It sends the original
// file to this route in pieces. Each piece is small enough for the live site
// to accept. The server forwards those same bytes to Drive. Nothing is
// re-encoded, compressed, or flipped.
//
// The folder is the filmed folder in .cursor/rules/slo-one-filmed-folder.mdc.
// DRIVE_RAW_FOLDER_ID is that same folder. The id is fixed here so a wrong
// env value cannot send a take somewhere else.

import { createHmac, timingSafeEqual } from "node:crypto";
import { openVideoSession, putVideoChunk } from "../messaging/providers/google-drive-write.mjs";

export const SLO_ADS_FOLDER_ID = "13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ";

/** One piece. A multiple of 256 KB, and under the live site's body cap. */
export const TAKE_CHUNK_BYTES = 1024 * 1024;

/** A piece bigger than this is refused. It is not trimmed. */
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

/** Same ceiling as the Mac drop. A bigger file is refused, not compressed. */
export const MAX_TAKE_BYTES = 20 * 1024 * 1024 * 1024;

const ALIGN = 256 * 1024;

/**
 * The best name the page already has, made safe to store.
 * A perfect NAMING.md name is kept. A missing or messy name still uploads.
 * @param {unknown} input
 */
export function takeUploadName(input) {
  let name = String(input ?? "").replace(/\0/g, "").replace(/\\/g, "/");
  const slash = name.lastIndexOf("/");
  if (slash >= 0) name = name.slice(slash + 1);
  name = name.replace(/[\u0000-\u001f]/g, "").trim();
  if (!name || name === "." || name === "..") name = "Take.mp4";
  if (name.length > 180) name = name.slice(0, 176).trim();
  if (!/\.(mp4|mov|m4v|webm)$/i.test(name)) name += ".mp4";
  if (name.length > 180) name = "Take.mp4";
  return name;
}

/**
 * @param {unknown} given
 * @param {string} name
 */
export function takeContentType(given, name) {
  const g = String(given || "").toLowerCase();
  if (g.startsWith("video/webm")) return "video/webm";
  if (g.startsWith("video/quicktime")) return "video/quicktime";
  if (g.startsWith("video/mp4")) return "video/mp4";
  if (/\.webm$/i.test(name)) return "video/webm";
  if (/\.mov$/i.test(name)) return "video/quicktime";
  return "video/mp4";
}

/**
 * @param {unknown} header
 * @returns {{ start: number, end: number, total: number, length: number } | null}
 */
export function parseContentRange(header) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(header || "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = Number(m[3]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(total)) return null;
  if (end < start || total < 1 || end >= total) return null;
  return { start, end, total, length: end - start + 1 };
}

/**
 * Google only keeps a middle piece when it starts on a 256 KB line and its
 * length is a multiple of 256 KB. The last piece can be shorter.
 * @param {{ start: number, length: number, total: number }} part
 */
export function chunkOk(part) {
  const { start, length, total } = part;
  if (start < 0 || length < 1 || start + length > total) return false;
  if (length > MAX_CHUNK_BYTES) return false;
  if (start % ALIGN !== 0) return false;
  const last = start + length === total;
  if (!last && length % ALIGN !== 0) return false;
  return true;
}

/**
 * The phone sends this back with each piece. It is not a Drive URL the phone
 * can rewrite.
 * @param {{ sessionUrl: string, total: number, name: string, contentType: string }} fields
 * @param {string} secret
 */
export function sealTakeToken(fields, secret) {
  const payload = Buffer.from(JSON.stringify({
    u: fields.sessionUrl,
    n: fields.total,
    f: fields.name,
    t: fields.contentType
  })).toString("base64url");
  const sig = createHmac("sha256", String(secret)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * @param {unknown} token
 * @param {string} secret
 * @returns {{ sessionUrl: string, total: number, name: string, contentType: string } | null}
 */
export function openTakeToken(token, secret) {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expect = createHmac("sha256", String(secret)).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data.u !== "string" || !Number.isInteger(data.n) || data.n < 1) return null;
    return {
      sessionUrl: data.u,
      total: data.n,
      name: typeof data.f === "string" ? data.f : "Take.mp4",
      contentType: typeof data.t === "string" ? data.t : "video/mp4"
    };
  } catch {
    return null;
  }
}

/**
 * Start the Drive upload. Returns the token the next pieces must carry.
 * @param {{ name?: unknown, bytes?: unknown, content_type?: unknown }} body
 * @param {{ filmSecret: string, env?: NodeJS.ProcessEnv, openVideoSession?: typeof openVideoSession }} deps
 */
export async function beginTake(body, deps) {
  const name = takeUploadName(body?.name);
  const total = Number(body?.bytes);
  if (!Number.isInteger(total) || total < 1 || total > MAX_TAKE_BYTES) {
    return { status: 400, body: { ok: false, error: "invalid", message: "That video has no size this site can store." } };
  }
  const contentType = takeContentType(body?.content_type, name);
  const open = deps.openVideoSession ?? openVideoSession;
  const started = await open({
    parentId: SLO_ADS_FOLDER_ID,
    name,
    totalBytes: total,
    contentType,
    env: deps.env
  });
  if (!started?.ok || !started.sessionUrl) {
    return { status: 502, body: { ok: false, error: "drive", message: "Drive did not take the file." } };
  }
  const token = sealTakeToken({
    sessionUrl: started.sessionUrl, total, name, contentType
  }, deps.filmSecret);
  return {
    status: 200,
    body: { ok: true, token, chunk_bytes: TAKE_CHUNK_BYTES, name }
  };
}

/**
 * Forward one original piece. The buffer is the body, unchanged.
 * @param {{ token: unknown, range: unknown, bytes: Buffer }} part
 * @param {{ filmSecret: string, env?: NodeJS.ProcessEnv, putVideoChunk?: typeof putVideoChunk }} deps
 */
export async function continueTake(part, deps) {
  const sealed = openTakeToken(part?.token, deps.filmSecret);
  if (!sealed) {
    return { status: 400, body: { ok: false, error: "invalid", message: "That save expired. Tap save again." } };
  }
  const range = parseContentRange(part?.range);
  if (!range || range.total !== sealed.total) {
    return { status: 400, body: { ok: false, error: "invalid", message: "That piece of the video did not line up." } };
  }
  const bytes = part?.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length !== range.length || !chunkOk(range)) {
    return { status: 400, body: { ok: false, error: "invalid", message: "That piece of the video did not line up." } };
  }
  const put = deps.putVideoChunk ?? putVideoChunk;
  const sent = await put({
    sessionUrl: sealed.sessionUrl,
    bytes,
    start: range.start,
    end: range.end,
    total: range.total,
    contentType: sealed.contentType,
    env: deps.env
  });
  if (!sent?.ok) {
    return { status: 502, body: { ok: false, error: "drive", message: "Drive did not take the file." } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      done: !!sent.done,
      received: sent.received,
      ...(sent.done && sent.fileId ? { file_id: sent.fileId } : {}),
      name: sealed.name
    }
  };
}
