// Shared by the fin-b23 page-read practice tests. One static server for
// public/, one Chromium, fake /api answers. Nothing here reaches a database, a
// vendor or the network: every request that is not the local page is refused,
// and every /api call is answered by the test. The session and route wiring
// come from e2e/harness.mjs so there is one copy of it.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { OWNER, json, withSession, wireApi } from "../../../../e2e/harness.mjs";

export { OWNER, json } from "../../../../e2e/harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = new Map([
  [".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".mjs", "text/javascript"],
  [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = !clean || clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((file) => file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile());
}

async function startServer(serve) {
  const server = http.createServer((req, res) => {
    // serve(req, res) may answer a request itself (media files, which the
    // browser does not hand to page.route). It returns true when it did.
    if (serve && serve(req, res) === true) return;
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": `${TYPES.get(path.extname(file)) || "application/octet-stream"}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Parse the JSON body of a recorded POST/PUT/PATCH request. */
export function bodyOf(route) {
  return JSON.parse(route.request().postData() || "{}");
}

/** Poll until done() is true, or fail. Real time, generous. */
export async function waitFor(done, what = "the page", ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await done()) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!(await done())) throw new Error(`timed out waiting for ${what}`);
}

/**
 * Start the page server and one browser; both close when the test ends.
 * startPages(t, { serve }) - serve(req, res) may answer a request itself and
 * return true (used for media files, which page.route does not see).
 * open(pathName, { session, handlers, viewport, clock, init, before, allow })
 *   clock: the page's timers wait for page.clock.fastForward(); the clock is
 *          paused from the first request, so nothing runs by itself.
 * Returns { page, errors }.
 */
export async function startPages(t, { serve = null } = {}) {
  const { server, origin } = await startServer(serve);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function open(pathName, { session = OWNER, handlers = {}, viewport = { width: 1280, height: 900 }, clock = false, init = null, before = null } = {}) {
    const page = await browser.newPage({ baseURL: origin, viewport });
    if (clock) {
      await page.clock.install({ time: 1_700_000_000_000 });
      await page.clock.pauseAt(1_700_000_001_000);
    }
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route((url) => url.origin !== origin, (route) => route.abort());
    if (session) await withSession(page, session);
    if (init) await page.addInitScript(init);
    await wireApi(page, session || OWNER, handlers);
    if (before) await before(page);
    await page.goto(pathName);
    await page.waitForLoadState("domcontentloaded");
    return { page, errors };
  }
  return { origin, browser, open };
}
