// Polite, resumable byte source for the federal bulk files.
//
// These are public FOIA releases served by agencies on modest infrastructure.
// We are pulling gigabytes from them for free, so this module is deliberately
// well-behaved: one request at a time, a floor on the interval between
// requests, honest identification in the User-Agent, exponential backoff, and
// Retry-After respected on 429/503.
//
// It also handles the two things that go wrong on a multi-GB download:
//   • the connection drops at 80% — resume with a Range request rather than
//     re-pulling a gigabyte from a government server;
//   • the caller only wants the first N rows — abort the request the moment
//     they stop reading, rather than draining the whole file.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const DEFAULT_USER_AGENT =
  "fundhub-marketing-warehouse/1.0 (+https://github.com/ZootimusMaximusBackup/fundhub-platform; public FOIA data ingest)";

/**
 * Serializes requests and enforces a minimum gap between them.
 *
 * Shared across a whole ingest run, so pulling twelve PPP files does not
 * become twelve simultaneous connections to data.sba.gov.
 */
export class RateLimiter {
  constructor(minIntervalMs = 1000) {
    this.minIntervalMs = minIntervalMs;
    this._last = 0;
    this._chain = Promise.resolve();
  }

  /** Resolves when it is polite to issue the next request. */
  async wait() {
    const turn = this._chain.then(async () => {
      // Loop: a timer can fire a millisecond early by the wall clock, which
      // would break the floor this class promises.
      let owed;
      while ((owed = this.minIntervalMs - (Date.now() - this._last)) > 0) {
        await sleep(owed);
      }
      this._last = Date.now();
    });
    // Keep the chain alive even if a caller rejects downstream.
    this._chain = turn.catch(() => {});
    return turn;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, capped. Deterministic base, random spread. */
function backoffMs(attempt) {
  const base = Math.min(30000, 1000 * 2 ** attempt);
  return base + Math.floor(Math.random() * 500);
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Stream a URL as Buffer chunks, resuming on mid-transfer failures.
 *
 * Retries that happen BEFORE any byte is emitted simply restart. Retries after
 * bytes have been emitted must resume at the exact offset, because the
 * consumer is a CSV state machine — replaying already-delivered bytes would
 * corrupt the parse. If the server will not honour a Range request, we fail
 * loudly rather than hand back a silently mangled stream.
 */
async function* httpChunks(url, {
  rateLimiter,
  signal,
  userAgent = DEFAULT_USER_AGENT,
  maxRetries = 4,
  onProgress,
  headers = {},
  startOffset = 0,
} = {}) {
  // `offset` is always an ABSOLUTE file position, so a retry that happens
  // while resuming an already-partial download asks for the right bytes.
  let offset = startOffset;
  let total = null;
  let attempt = 0;
  let acceptsRanges = false;

  while (true) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) return;
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      if (rateLimiter) await rateLimiter.wait();

      const reqHeaders = {
        "user-agent": userAgent,
        accept: "text/csv,application/octet-stream,*/*",
        "accept-encoding": "gzip, deflate",
        ...headers,
      };
      if (offset > 0) reqHeaders.range = `bytes=${offset}-`;

      const res = await fetch(url, { headers: reqHeaders, signal: controller.signal, redirect: "follow" });

      if (offset > 0 && res.status === 200) {
        // The server ignored our Range and started the file over. Those bytes
        // have already been consumed — downstream by the CSV state machine, or
        // on disk in a .part file — and replaying them would corrupt the
        // result, so stop rather than hand back silently bad data.
        throw new Error(
          `resume failed: ${url} ignored Range (got 200, expected 206) at byte ${offset}. ` +
          (startOffset > 0
            ? `Delete the partial download and start over.`
            : `Re-run the ingest from the start, or download to disk first and use --file.`)
        );
      }

      if (!res.ok && res.status !== 206) {
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 120000)
            : backoffMs(attempt);
          attempt += 1;
          if (onProgress) onProgress({ kind: "retry", status: res.status, attempt, waitMs, url });
          await sleep(waitMs);
          continue;
        }
        throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
      }

      if (total === null) {
        acceptsRanges = (res.headers.get("accept-ranges") || "").includes("bytes");
        const len = Number(res.headers.get("content-length"));
        if (Number.isFinite(len) && len > 0) total = len;
        if (onProgress) onProgress({ kind: "start", url, total, resumable: acceptsRanges });
      }

      if (!res.body) return;

      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        offset += buf.length;
        if (onProgress) onProgress({ kind: "bytes", bytes: offset, total, url });
        yield buf;
      }
      return;   // clean EOF
    } catch (err) {
      // The consumer walked away (early --limit abort). Not an error.
      if (signal?.aborted) return;
      if (err?.name === "AbortError") return;
      if (attempt >= maxRetries) throw err;
      if (offset > startOffset && !acceptsRanges) {
        throw new Error(
          `${url} dropped after ${offset} bytes and does not support Range resume: ${err.message}`
        );
      }
      attempt += 1;
      const waitMs = backoffMs(attempt);
      if (onProgress) onProgress({ kind: "retry", error: err.message, attempt, waitMs, url });
      await sleep(waitMs);
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      controller.abort();   // release the socket on early exit
    }
  }
}

/** Local-file byte source. Used by --file and by the sample fixtures. */
async function* fileChunks(filePath, { onProgress } = {}) {
  const total = fs.statSync(filePath).size;
  if (onProgress) onProgress({ kind: "start", url: filePath, total, resumable: true });
  let read = 0;
  const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
  try {
    for await (const chunk of stream) {
      read += chunk.length;
      if (onProgress) onProgress({ kind: "bytes", bytes: read, total, url: filePath });
      yield chunk;
    }
  } finally {
    stream.destroy();
  }
}

/** Transparently gunzip a chunk stream. */
async function* gunzipChunks(chunks) {
  const gunzip = zlib.createGunzip();
  const src = Readable.from(chunks);
  const pumped = pipeline(src, gunzip).catch((err) => {
    // Surface on the consuming side rather than as an unhandled rejection.
    gunzip.destroy(err);
  });
  try {
    for await (const out of gunzip) yield out;
  } finally {
    src.destroy();
    await pumped;
  }
}

/**
 * The one entry point ingesters use: give it a URL or a local path, get back
 * decompressed CSV bytes.
 *
 * `file` always wins over `url`. That is the documented full-scale workflow —
 * download the multi-GB releases once with curl/wget (resumable, restartable,
 * and visible in a terminal), then point the ingester at local disk so a
 * retried load never re-pulls a gigabyte from a government server.
 */
export function openSource({ url, file, gunzip, ...opts } = {}) {
  if (!url && !file) throw new Error("openSource: one of {url, file} is required");

  const target = file || url;
  const isGz = gunzip ?? /\.gz(\?|$)/i.test(target);
  const chunks = file ? fileChunks(file, opts) : httpChunks(url, opts);
  return isGz ? gunzipChunks(chunks) : chunks;
}

/**
 * Download a URL to disk (resumable), returning the local path.
 *
 * This is the recommended way to run at full scale: fetch once, ingest many
 * times. An interrupted download resumes from the partial file rather than
 * starting over.
 */
export async function downloadToDisk(url, destPath, opts = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.part`;
  const already = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;

  const out = fs.createWriteStream(tmp, { flags: already ? "a" : "w" });
  try {
    await pipeline(Readable.from(httpChunks(url, { ...opts, startOffset: already })), out);
  } catch (err) {
    out.destroy();
    throw err;
  }
  fs.renameSync(tmp, destPath);
  return destPath;
}
