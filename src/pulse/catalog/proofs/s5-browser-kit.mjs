// Small kit for the S5 screen proofs that need a real browser. It serves the
// repo's public/ folder from a local port, answers every /api/ call from the
// test, and blocks every other network address. Nothing leaves this machine.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".woff2", "font/woff2"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((c) => c.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(c) && fs.statSync(c).isFile());
}

// openLab() → { origin, browser, close() }. One server and one browser per test.
export async function openLab() {
  const server = http.createServer((request, response) => {
    const file = staticFile(new URL(request.url, "http://127.0.0.1").pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES.get(path.extname(file)) || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    browser,
    async close() {
      await browser.close();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export const fulfillJson = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// newStaffPage(lab, { role, width, height, api }) → a page signed in as a fake
// staff member. api(request, url) may answer an /api/ call by returning a JSON
// body (or { status, body }); returning undefined falls through to a plain
// { ok: true } answer. Every call is kept on page.apiCalls.
export async function newStaffPage(lab, { role = "owner", width = 1440, height = 900, api = null, staff = {} } = {}) {
  const page = await lab.browser.newPage({ viewport: { width, height } });
  page.apiCalls = [];
  await page.addInitScript((who) => {
    try {
      localStorage.setItem("fh_token", "browser-proof-fake-token");
      localStorage.setItem("fh_role", who);
    } catch { /* storage may be blocked */ }
  }, role);
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    page.apiCalls.push({ method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (request.method() === "GET" && url.pathname === "/api/auth/session") {
      return fulfillJson(route, {
        ok: true,
        staff: { id: "staff-proof", name: "Casey Proof", email: "casey.proof@example.test", role, org_id: "org-proof", status: "active", ...staff },
      });
    }
    const custom = api ? await api(request, url) : undefined;
    if (custom && typeof custom === "object" && "status" in custom && "body" in custom) {
      return fulfillJson(route, custom.body, custom.status);
    }
    return fulfillJson(route, custom ?? { ok: true, data: {}, items: [], tasks: [], count: 0 });
  });
  return page;
}

export async function waitForShell(page) {
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  await page.locator("#fh-shell-chip").waitFor({ state: "attached" });
  // Polled on a timer, not on animation frames: a page that is starved of frames
  // under load still answers a timer, and a frame wait would hang on it.
  await page.waitForFunction(() => !document.getElementById("fh-gate-style"), null, { polling: 100, timeout: 30_000 });
}
