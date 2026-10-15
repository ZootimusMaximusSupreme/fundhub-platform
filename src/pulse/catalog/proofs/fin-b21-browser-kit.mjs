// Shared helpers for the batch 21 practice tests (real Chromium, real page, fake /api answers).
// Tests only. Nothing here is imported by the live bundle.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".svg", "image/svg+xml"], [".png", "image/png"]
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = !clean || clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean)];
  return candidates.find((candidate) => candidate.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(candidate));
}

/** A static server for public/ on a free port. Resolves { server, origin }. */
export async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES.get(path.extname(file)) || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

export async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

/** Server and browser for one test file. Close with `await world.close()` (or t.after). */
export async function openWorld() {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  return {
    origin,
    browser,
    async close() {
      await browser.close();
      await stopServer(server);
    }
  };
}

/** Keep every outside host (fonts, analytics) out of a page: an offline run must not wait on them. */
export async function blockOutside(page, origin) {
  await page.route((url) => !url.href.startsWith(origin) && !url.href.startsWith("data:") && !url.href.startsWith("blob:"), (route) => route.abort());
}

export const clone = (value) => JSON.parse(JSON.stringify(value));

export async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function waitFor(check, message, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error(message);
}

/** The shape of one registered proof case (display-proof-cases.mjs reads these). */
export function proofCase({ sourceFile, surface, control, test, runner, assertion, extraTests = [] }) {
  return Object.freeze({
    key: `${sourceFile}\0${surface}\0${control}`,
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: test,
    tests: Object.freeze([test, ...extraTests]),
    proof: Object.freeze({ runner, assertion })
  });
}
