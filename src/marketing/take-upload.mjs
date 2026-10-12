// Save videos to their own offer's Google Drive folder, never to another offer.
//
// The phone cannot reach the Mac when Chris is away. It sends the original
// file to this route in pieces. Each piece is small enough for the live site
// to accept. The server forwards those same bytes to Drive. Nothing is
// re-encoded, compressed, or flipped.
//
// Direct Book ads do NOT belong in the SLO folder. Folder selection comes
// from the validated NAMING.md filename, never an arbitrary client folder id.

import { createHmac, timingSafeEqual } from "node:crypto";
import { openVideoSession, putVideoChunk, ensureFolder } from "../messaging/providers/google-drive-write.mjs";
import { OFFER_WORDS } from "./shoot-plan.mjs";
import { offerFacts } from "./offer-facts.mjs";
import { parseTakeName } from "../ad-videos/merge-takes.mjs";

export const SLO_ADS_FOLDER_ID = "13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ";
export const DIRECT_BOOK_ADS_FOLDER_ID = "1lu1Jzn302TMBdfPS6r2XuOvNdMaWA9Ry";

/** Stable parent for all offers, not an SLO-only folder.
 * The marketing machine's canonical offer_key chooses a folder beneath it. */
export const MARKETING_VIDEO_PARENT_ID = "1yIcllnXcq5ugtAdRGDTyLTHUDYXm0_Uh";

/** Existing approved destinations keep their exact folder IDs. */
export const EXISTING_OFFER_FOLDERS = Object.freeze({
  slo_roadmap: SLO_ADS_FOLDER_ID,
  funding_dfy: DIRECT_BOOK_ADS_FOLDER_ID
});

/** Official offer display word; new approved offers are pulled from the
 * marketing offer registry rather than mapped to another offer's folder. */
export function offerWordForKey(offerKey) {
  const key = String(offerKey || "");
  if (Object.prototype.hasOwnProperty.call(OFFER_WORDS, key)) return OFFER_WORDS[key];
  const facts = offerFacts(key);
  if (!facts || !facts.label) return null;
  return String(facts.label).replace(/[\/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || null;
}
export function offerKeyForName(name, offeredKey) {
  const parsed = parseTakeName(name);
  if (!parsed) return null;
  if (offeredKey != null && offeredKey !== "") {
    const key = String(offeredKey);
    const word = offerWordForKey(key);
    return word && word.toUpperCase() === parsed.offer ? key : null;
  }
  // Compatibility with previously recorded takes before offer_key was sent.
  // Future offers must send their canonical offer_key, never guess.
  for (const key of Object.keys(EXISTING_OFFER_FOLDERS)) {
    const word = offerWordForKey(key);
    if (word && word.toUpperCase() === parsed.offer) return key;
  }
  return null;
}
export function takeFolderForName(name, offeredKey) {
  const key = offerKeyForName(name, offeredKey);
  return key ? (EXISTING_OFFER_FOLDERS[key] || null) : null;
}
export async function resolveVideoFolder(name, offeredKey, deps = {}) {
  const key = offerKeyForName(name, offeredKey);
  if (!key) return null;
  const existing = EXISTING_OFFER_FOLDERS[key];
  if (existing) return { offerKey: key, folderId: existing };
  const word = offerWordForKey(key);
  if (!word) return null;
  // Registered new offers get their own folder on first recorded upload.
  // Do not mint a folder for an unregistered/unvalidated arbitrary tag.
  const provision = deps.ensureFolder ?? ensureFolder;
  const found = await provision({
    parentId: MARKETING_VIDEO_PARENT_ID,
    name: word + " Ads",
    env: deps.env
  });
  if (!found?.ok || !found.folderId) return null;
  return { offerKey: key, folderId: found.folderId };
}

/** One piece. A multiple of 256 KB, and under the live site's body cap. */
export const TAKE_CHUNK_BYTES = 2 * 1024 * 1024;

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
  const key = offerKeyForName(name, body?.offer_key);
  if (!key) {
    return { status: 400, body: {
      ok: false, error: "unknown_offer",
      message: "This take must name the registered offer and match its exact offer, ad or VSL, title, and take number."
    } };
  }
  const folder = await resolveVideoFolder(name, key, deps);
  if (!folder) {
    return { status: 502, body: { ok: false, error: "folder_unavailable", message: "Could not open this offer's Google Drive folder. Your original video was not uploaded." } };
  }
  const contentType = takeContentType(body?.content_type, name);
  const open = deps.openVideoSession ?? openVideoSession;
  const started = await open({
    parentId: folder.folderId,
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
    body: { ok: true, token, chunk_bytes: TAKE_CHUNK_BYTES, name, offer_key: key,
      folder_url: "https://drive.google.com/drive/folders/" + folder.folderId }
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
