// Batch 19 (finish the 853, tier 4, lane gap-catalog-display) practice tests: the row tracker and a few
// small browser helpers. Practice test means: a real page in Chromium, fake /api answers, a click, and a
// judgement of the exact request the page sends and the words the page paints. It reads no live data.
//
// The static server, the browser and the fake staff session are the S5 browser kit (s5-browser-kit.mjs).
// This file only adds the batch's own row table and the "claim a row inside the callback that asserts it"
// tracker, so a listed row cannot be attached without being exercised.

import { after, before } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { newStaffPage, openLab, waitForShell, fulfillJson } from "./s5-browser-kit.mjs";
import "./s4-browser-slots.mjs";
import ROWS from "./fin-b19-rows.json" with { type: "json" };

export { newStaffPage, waitForShell, fulfillJson };
export const FIN_B19_ROWS = Object.freeze(ROWS);

// A callback with nothing in it, or nothing but comments, proves nothing.
const EMPTY_BODY = /^(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w*\s*\)\s*(?:=>\s*)?\{\s*\}$/;
const isEmptyCallback = (run) => EMPTY_BODY.test(run.toString().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim());

/**
 * The rows one test file proves, read from fin-b19-rows.json. check() claims a row only when the
 * assertions in its own callback finish. assertAllClaimed() names every listed row that never ran.
 * A control under "notAttached" is also exercised, but its row words name something the product does not
 * do (or no person can reach), so it is not handed to the catalog and stays reported as not proved.
 */
export function proofRows(testFile) {
  const name = path.basename(testFile.startsWith("file:") ? fileURLToPath(testFile) : testFile);
  const groups = ROWS[name];
  if (!groups) throw new Error(`fin-b19-rows.json has no rows for ${name}`);
  const controls = groups.flatMap((group) => [...group.controls, ...(group.notAttached || [])]
    .map((control) => ({ ...group, control })));
  const claimed = new Set();
  const find = (matcher) => {
    const hits = controls.filter((row) => (matcher instanceof RegExp ? matcher.test(row.control) : row.control === matcher));
    if (hits.length !== 1) throw new Error(`expected one listed row for ${matcher}, found ${hits.length}`);
    return hits[0];
  };
  return {
    rows: controls,
    async check(matcher, run) {
      if (typeof run !== "function" || isEmptyCallback(run)) {
        throw new Error("proof.check needs the row's own assertions in its callback, not an empty one");
      }
      const row = find(matcher);
      await run(row.control);
      claimed.add(`${row.surface}\0${row.control}`);
    },
    assertAllClaimed() {
      const missing = controls.filter((row) => !claimed.has(`${row.surface}\0${row.control}`)).map((row) => row.control);
      if (missing.length) throw new Error(`listed rows never exercised:\n${missing.join("\n")}`);
    },
  };
}

export const STAFF = Object.freeze({
  id: "staff-proof", name: "Casey Proof", email: "casey.proof@example.test", org_id: "org-proof", status: "active",
});

/**
 * A page with its own fake session and fake /api, for tests that need to control the session answer
 * itself (a 401, a stale cached role, a demo login), which newStaffPage cannot.
 *   role      the cached role hint (fh_role); null leaves it unset
 *   token     fh_token; null leaves the browser with no token
 *   storage   more localStorage keys, set once on the first load only (a sign-out redirect keeps its wipe)
 *   session   an object (the answer), a function (request) => object | { status, body }, or null for a 401
 *   api       (request, url) => body | { status, body } | undefined, for every other /api call
 *   patch     { "/app/shell.js": (text) => text } rewrites a served file, to try a page with other constants
 * Every /api call is kept on page.apiCalls with its method, path, query, bearer and body.
 */
export async function openPage(lab, {
  role = "owner", token = "fake-token", storage = {}, session = undefined, api = null,
  width = 1440, height = 900, patch = {}, staff = {},
} = {}) {
  const page = await lab.browser.newPage({ viewport: { width, height } });
  page.apiCalls = [];
  await page.addInitScript(({ token: t, role: r, storage: extra }) => {
    try {
      if (sessionStorage.getItem("__fin_b19_seeded")) return;
      sessionStorage.setItem("__fin_b19_seeded", "1");
      if (t) localStorage.setItem("fh_token", t);
      if (r) localStorage.setItem("fh_role", r);
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    } catch { /* storage may be blocked */ }
  }, { token, role, storage });
  await page.route("https://**", (route) => route.abort());
  for (const [pathname, rewrite] of Object.entries(patch)) {
    await page.route(`**${pathname}`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: rewrite(await response.text()) });
    });
  }
  const answer = (route, out, fallbackStatus = 200) => {
    if (out && typeof out === "object" && "status" in out && "body" in out) return fulfillJson(route, out.body, out.status);
    return fulfillJson(route, out, fallbackStatus);
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    page.apiCalls.push({
      method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams),
      bearer: request.headers().authorization || null, contentType: request.headers()["content-type"] || null,
      body: request.postDataBuffer() ? request.postDataBuffer().toString("utf8") : null,
      raw: request.postDataBuffer() ? request.postDataBuffer().toString("latin1") : null,
    });
    if (request.method() === "GET" && url.pathname === "/api/auth/session") {
      if (session === null) return fulfillJson(route, { ok: false, error: "unauthorized" }, 401);
      const out = typeof session === "function" ? session(request) : session;
      if (out !== undefined) return answer(route, out);
      return fulfillJson(route, { ok: true, staff: { ...STAFF, role: role || "owner", ...staff } });
    }
    const custom = api ? await api(request, url) : undefined;
    if (custom !== undefined) return answer(route, custom);
    return fulfillJson(route, { ok: true, data: {}, items: [], tasks: [], count: 0 });
  });
  return page;
}

/** One server and one Chromium for a whole test file (opened in before(), closed in after()). */
export function sharedLab() {
  const state = { lab: null };
  before(async () => { state.lab = await openLab(); });
  after(async () => { if (state.lab) await state.lab.close(); });
  return {
    get origin() { return state.lab.origin; },
    // A signed-in page. api(request, url) answers /api calls; see newStaffPage.
    page: (options) => newStaffPage(state.lab, options),
    // A page with full control of the session answer; see openPage.
    open: (options) => openPage(state.lab, options),
  };
}

/** Poll until the predicate is true. Fails with the label so a red run says what never happened. */
export async function waitFor(predicate, label = "condition", ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}
