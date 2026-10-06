// Playwright — the gate CLAUDE.md §6 has always listed and this repo has never had.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT EXISTS NOW.
//
// §6 names "Playwright check on any UI change" as one of six things that must
// pass before a task is done. There was no Playwright, no config and no spec
// anywhere — .github/workflows/tests.yml says so in its own header and refuses
// to add a step that would silently pass because the tool is absent. So the
// gate was listed, understood to be required, and unrunnable.
//
// The messaging screen was rewritten wholesale — around a thousand lines — and
// verified by testing its view model directly and asserting on the markup. That
// is real coverage and it proved a lot, but nobody had clicked a single button.
// A screen can pass every one of those checks and still be a blank page: one
// null reference in the wiring, an element id that does not match, a handler
// attached to a selector that no longer exists.
//
// This runs the real page in a real browser.
//
//
// NO DOWNLOAD, NO NETWORK. Chromium is already on the machine and
// PLAYWRIGHT_BROWSERS_PATH points at it. `playwright install` must not be run.
//
// NO BACKEND. A forty-line static server hands over public/ (see
// e2e/static-server.mjs for why file:// does not work), and each spec answers
// /api/** itself with page.route(). That is deliberate rather than a shortcut:
// a browser test never needs a database, never needs a session, and can put the
// screen in states a live backend makes hard to reach on demand — no
// conversations at all, a message the compliance gate blocked, two in the
// morning. Those are exactly the states worth checking and exactly the ones
// nobody ever gets round to producing by hand.
//
// SEPARATE FROM `npm test`. node:test globs src/ and scripts/; these live in
// e2e/ and run with `npm run test:e2e`. Folding them into the unit suite would
// put a browser launch in the path of every unit run.

import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/* preinstalledChromium — the browser this machine already has, if it has one.
 *
 * WHY THIS SEARCH EXISTS. Playwright pins an exact Chromium build per release
 * and refuses to start any other one, with a message telling you to run
 * `npx playwright install`. In CI that is the right advice and it works. In
 * this build container it is not: the CDN is unreachable through the egress
 * policy, and a Chromium is ALREADY on disk at PLAYWRIGHT_BROWSERS_PATH — just
 * a different build number from the one the current package pins.
 *
 * So: use whatever is actually installed rather than the build that is wanted.
 * Chromium's own API surface does not move between adjacent builds in any way
 * these tests touch — they click buttons and read text.
 *
 * Returns undefined when nothing is found, which hands the decision back to
 * Playwright and gets its own (correct, actionable) error message. Never
 * throws: a config file that dies on a missing directory takes down the runner
 * before it can tell anybody why.
 */
function preinstalledChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  // macOS fallback when PLAYWRIGHT_BROWSERS_PATH is unset or stale.
  const homeCache = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    "Library", "Caches", "ms-playwright"
  );
  if (homeCache && !roots.includes(homeCache)) roots.push(homeCache);
  const plat = process.platform;

  /* Candidate relative paths under chromium-NNNN/. Linux ships a `chrome`
     binary; modern macOS Playwright installs an app bundle named
     "Google Chrome for Testing". */
  const candidates = plat === "darwin"
    ? [
        path.join("chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join("chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join("chrome-mac-arm64", "chrome"),
        path.join("chrome-mac", "chrome")
      ]
    : plat === "win32"
      ? [path.join("chrome-win", "chrome.exe")]
      : [path.join("chrome-linux", "chrome")];

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const dirs = fs.readdirSync(root)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
      for (const d of dirs) {
        for (const rel of candidates) {
          const exe = path.join(root, d, rel);
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch { /* try next root */ }
  }
  return undefined;
}

const CHROMIUM = preinstalledChromium();

/* A fixed port so baseURL can be built before the server starts. High and
   unlikely to collide; override with E2E_PORT if it ever does. */
const PORT = Number(process.env.E2E_PORT || 43117);

export default defineConfig({
  testDir: "./e2e",
  /* The live specs sign in to the real fundhub.ai. They belong to
     playwright.live.config.mjs (testMatch "**\/live-*.spec.mjs") and never to
     this offline run — naming only launch-proof-live let six of them into the
     default collection (walkthrough-4 defect 9, 2026-09-06). */
  testIgnore: ["**/launch-proof-live.spec.mjs", "**/live-*.spec.mjs"],
  // A UI test that hangs is worse than one that fails: it is a red build with
  // no message. Fail fast and say what timed out.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Serial locally, and never retried. A flaky browser test that passes on the
  // second attempt teaches everyone to re-run the build; if one of these is
  // unreliable the right response is to fix it, not to retry it.
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "line",
  /* The static server, started and stopped by the runner. reuseExistingServer
     is off in CI so a stale process from a previous job can never serve a
     previous commit's files — which fails as a mystifying assertion about
     markup that is not in the tree. */
  webServer: {
    command: `node e2e/static-server.mjs`,
    env: { E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/app/messaging.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    stdout: "ignore",
    stderr: "pipe"
  },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    /* The browser already on this machine, when there is one. See
       preinstalledChromium() above for why this is not left to Playwright.

       Naming the executable also opts out of the headless-shell binary
       Playwright reaches for by default, which is a separate download and is
       not what is installed here. */
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
    trace: "off",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium" }]
});
