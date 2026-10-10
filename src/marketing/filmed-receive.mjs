// @ts-check
// Original filmed takes on this Mac. No ffmpeg. No Drive upload.
//
// The phone app (tools/teleprompter-ios, owned by another pass) saves a take
// to Photos under its NAMING.md name. It does not have its own video route.
// This is the drop it can push to, on the same Wi-Fi as this Mac:
//
//   PUT  http://<this Mac>:8787/takes/<file name>
//   POST http://<this Mac>:8787/takes
//        header X-Take-Name: <file name>
//   Body: the file's own bytes. They are written as-is.
//
// Files land in marketing/ads/filmed/, the same folder as
// scripts/receive-filmed-take.mjs. If that name is already there, the old
// file stays and nothing is written over it.
//
// SLO Ads on Drive stays the pipeline's folder. This copy is not uploaded.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Same folder as scripts/receive-filmed-take.mjs. */
export const FILMED_DIR_PARTS = Object.freeze(["marketing", "ads", "filmed"]);

/** The phone pushes here. Override with FUNDHUB_FILMED_PORT. */
export const FILMED_PORT = 8787;

/** A take bigger than this is refused. It is not recompressed. */
export const MAX_TAKE_BYTES = 20 * 1024 * 1024 * 1024;

const EXT = /\.(mp4|mov|m4v|webm)$/i;

/**
 * The folder original takes are stored in.
 * @param {string} [root]
 */
export function filmedDir(root = REPO_ROOT) {
  return path.join(root, ...FILMED_DIR_PARTS);
}

/**
 * This Mac's LAN address, so the phone can reach the drop. Null when there is none.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [ifaces]
 */
export function lanIPv4(ifaces = os.networkInterfaces()) {
  for (const list of Object.values(ifaces || {})) {
    for (const row of list || []) {
      const v4 = row.family === "IPv4" || /** @type {unknown} */ (row.family) === 4;
      if (v4 && !row.internal) return row.address;
    }
  }
  return null;
}

/**
 * The take's own file name, or null when it is not a safe video name.
 * Keeps the em dash and spaces from marketing/ads/NAMING.md. Does not rename.
 * @param {unknown} input
 */
export function cleanTakeName(input) {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (!name || name.length > 180) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name.startsWith(".") || name === "." || name === "..") return null;
  if ([...name].some((ch) => ch.charCodeAt(0) < 32)) return null;
  if (path.basename(name) !== name) return null;
  if (!EXT.test(name)) return null;
  return name;
}

/**
 * The name on PUT /takes/<name> or on the X-Take-Name header.
 * @param {string | undefined} url
 * @param {http.IncomingHttpHeaders | Record<string, string | string[] | undefined>} [headers]
 */
export function takeNameFromRequest(url, headers = {}) {
  const pathOnly = String(url || "").split("?")[0];
  if (pathOnly.startsWith("/takes/") && pathOnly.length > "/takes/".length) {
    let raw = pathOnly.slice("/takes/".length);
    try { raw = decodeURIComponent(raw); } catch { return null; }
    return cleanTakeName(raw);
  }
  const header = headers["x-take-name"];
  const value = Array.isArray(header) ? header[0] : header;
  return cleanTakeName(value || "");
}

function isFile(p) {
  try { return fs.lstatSync(p).isFile(); } catch { return false; }
}

function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

/**
 * Copy a finished temp file into the folder. Same rule as
 * scripts/receive-filmed-take.mjs: the bytes are copied, and a name that is
 * already there is left alone. The temp is not a take.
 * @param {string} dir
 * @param {string} name
 * @param {string} tmp
 * @returns {{ name: string, bytes: number, duplicate: boolean }}
 */
export function commitOriginal(dir, name, tmp) {
  const clean = cleanTakeName(name);
  if (!clean) throw new Error("bad take name");
  const root = path.resolve(dir);
  const dest = path.resolve(root, clean);
  if (dest !== path.join(root, clean)) throw new Error("bad take name");
  const incoming = fs.statSync(tmp).size;
  if (incoming < 1) throw new Error("empty file");

  if (exists(dest)) {
    fs.unlinkSync(tmp);
    return { name: clean, bytes: isFile(dest) ? fs.statSync(dest).size : incoming, duplicate: true };
  }
  try {
    fs.copyFileSync(tmp, dest, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    fs.unlinkSync(tmp);
    if (err && /** @type {any} */ (err).code === "EEXIST") {
      return { name: clean, bytes: isFile(dest) ? fs.statSync(dest).size : incoming, duplicate: true };
    }
    throw err;
  }
  fs.unlinkSync(tmp);
  return { name: clean, bytes: incoming, duplicate: false };
}

/**
 * Read the request body onto a temp file, then commit it. Refuses a body over
 * MAX_TAKE_BYTES. Does not re-encode.
 * @param {string} dir
 * @param {string} name
 * @param {AsyncIterable<Buffer | string>} body
 */
export async function storeOriginalStream(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.incoming-${randomUUID()}`);
  const ws = fs.createWriteStream(tmp, { flags: "wx" });
  let n = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      n += buf.length;
      if (n > MAX_TAKE_BYTES) {
        const err = new Error("file is too big");
        /** @type {any} */ (err).code = "too_big";
        throw err;
      }
      if (!ws.write(buf)) await new Promise((resolve) => ws.once("drain", resolve));
    }
    await new Promise((resolve, reject) => ws.end((err) => (err ? reject(err) : resolve(undefined))));
    return commitOriginal(dir, name, tmp);
  } catch (err) {
    ws.destroy();
    try { fs.unlinkSync(tmp); } catch { /* temp only; it may not exist */ }
    throw err;
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "content-type, x-take-name",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "86400"
  };
}

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw),
    ...corsHeaders()
  });
  res.end(raw);
}

/**
 * Listen for original takes. host 0.0.0.0 is how the phone on Wi-Fi reaches it.
 * @param {{ dir: string, port?: number, host?: string }} opts
 * @returns {Promise<{ dir: string, port: number, lan: string | null, close: () => Promise<void> }>}
 */
export function startFilmedReceive({ dir, port = FILMED_PORT, host = "0.0.0.0" }) {
  fs.mkdirSync(dir, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      if (method === "OPTIONS") {
        res.writeHead(204, { ...corsHeaders(), "content-length": "0" });
        res.end();
        return;
      }
      if (method === "GET" && (req.url === "/" || req.url === "/takes")) {
        send(res, 200, { ok: true });
        return;
      }
      if (method !== "PUT" && method !== "POST") {
        send(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_TAKE_BYTES) {
        send(res, 413, { ok: false, error: "too_big" });
        req.resume();
        return;
      }
      const name = takeNameFromRequest(req.url, req.headers);
      if (!name) {
        send(res, 400, { ok: false, error: "bad_name" });
        req.resume();
        return;
      }
      const stored = await storeOriginalStream(dir, name, req);
      send(res, stored.duplicate ? 200 : 201, { ok: true, name: stored.name, bytes: stored.bytes });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? /** @type {any} */ (err).code : "";
      if (!res.headersSent) {
        send(res, code === "too_big" ? 413 : 400, { ok: false, error: code === "too_big" ? "too_big" : "refused" });
      } else {
        res.destroy();
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const got = addr && typeof addr === "object" ? addr.port : port;
      resolve({
        dir,
        port: got,
        lan: lanIPv4(),
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}
