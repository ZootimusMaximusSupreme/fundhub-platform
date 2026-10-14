// Shared by the S4 customer-data screen proofs. One static server for public/,
// one Chromium, and fake /api routes. The session and route wiring come from
// e2e/harness.mjs so there is a single copy of it. Nothing here reaches a real
// database, a vendor or the network: every request that is not the local page
// is refused, and every /api call is answered by the test.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { OWNER, json, withSession, wireApi } from "../../../../e2e/harness.mjs";
import S4_ROWS from "./s4-rows.json" with { type: "json" };

export { CLIENT_ID, OWNER, json } from "../../../../e2e/harness.mjs";

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

async function startServer() {
  const server = http.createServer((req, res) => {
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

/**
 * Start the local page server and one browser. Both close when the test ends.
 * open(pathName, { session, handlers, viewport, init, clock, before }) returns { page, errors }.
 * before(page) runs just before the page loads, for routes that must exist from the first request.
 * handlers is the wireApi map: URL fragment -> body, or (route, {url, method}) => ...
 */
export async function startScreens(t) {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function open(pathName, { session = OWNER, handlers = {}, viewport = { width: 1280, height: 900 }, init = null, clock = false, before = null } = {}) {
    const page = await browser.newPage({ baseURL: origin, viewport });
    // clock: the page's timers wait for page.clock.fastForward(), so a 30 second refresh needs no 30 second wait.
    if (clock) await page.clock.install();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route((url) => url.origin !== origin, (route) => route.abort());
    // session: null opens the page signed out (login and other public pages).
    if (session) await withSession(page, session);
    if (init) await page.addInitScript(init);
    await wireApi(page, session || OWNER, handlers);
    if (before) await before(page);
    await page.goto(pathName);
    await page.waitForLoadState("domcontentloaded");
    return { page, errors };
  }
  return { origin, open };
}

/** Parse the JSON body of a recorded POST/PUT/PATCH request. */
export function bodyOf(route) {
  return JSON.parse(route.request().postData() || "{}");
}

/**
 * The rows one test file proves, read from s4-rows.json. A test claims a row by
 * running its assertions inside proof.check(); assertAllClaimed() fails the test
 * if a listed row never ran, so a row cannot be attached without being exercised.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = S4_ROWS[name];
  if (!groups) throw new Error(`s4-rows.json has no rows for ${name}`);
  // notAttached: exercised here, but the pulse lane still wants a saved receipt for
  // that control, so the row is deliberately not handed to the catalog.
  const controls = groups.flatMap((group) => [...group.controls, ...(group.notAttached || [])].map((control) => ({ ...group, control })));
  const claimed = new Set();
  const find = (matcher, surface = null) => {
    const hits = controls.filter((row) => (!surface || row.surface === surface)
      && (matcher instanceof RegExp ? matcher.test(row.control) : row.control === matcher));
    if (hits.length !== 1) throw new Error(`expected one listed row for ${matcher} on ${surface || "any surface"}, found ${hits.length}`);
    return hits[0];
  };
  return {
    rows: controls,
    controlsOf: (matcher) => controls.filter((row) => matcher.test(row.control)).map((row) => row.control),
    async check(matcher, run, surface = null) {
      const row = find(matcher, surface);
      await run(row.control);
      claimed.add(`${row.surface}\0${row.control}`);
    },
    claim(control, surface = null) {
      const row = find(control, surface);
      claimed.add(`${row.surface}\0${row.control}`);
    },
    assertAllClaimed() {
      const missing = controls.filter((row) => !claimed.has(`${row.surface}\0${row.control}`)).map((row) => row.control);
      if (missing.length) throw new Error(`listed rows never exercised:\n${missing.join("\n")}`);
    },
  };
}
