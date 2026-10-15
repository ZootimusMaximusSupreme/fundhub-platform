// Small kit for the batch 20 screen proofs. A real Chromium opens a staff screen from the repo's own
// public/ folder (served from a local port), every /api/ call is answered by the test, and every other
// network address is blocked. Nothing leaves this machine. Built on the S5 lab (one server, one browser).

import { openLab, fulfillJson, waitForShell } from "./s5-browser-kit.mjs";

export { openLab, fulfillJson, waitForShell };

export const TOKEN = "browser-proof-fake-token";
const DEFAULT_STAFF = { id: "staff-proof", name: "Casey Proof", org_id: "org-proof", status: "active" };

/**
 * makePage(lab, options) → a page signed in as a fake person.
 *   role      the role the session reports (and the cached role hint, unless hint is given)
 *   hint      the cached role in storage ("" or null leaves none)
 *   token     the saved token ("" or null leaves none)
 *   session   function(call) → { status, body } to override the /api/auth/session answer
 *   health    function() → { status, body } to override /api/health (default: up, 7 migrations)
 *   api       function(call) → body | { status, body } | { hold: true } | undefined for every other /api/ call
 *   storage   extra localStorage entries
 *   staff     extra fields on the default session's staff object
 * Every call is kept on page.apiCalls as { method, path, query, headers, body, contentType }.
 */
export async function makePage(lab, {
  role = "owner", hint = undefined, token = TOKEN, session = null, health = null, api = null,
  storage = {}, staff = {}, width = 1440, height = 900,
} = {}) {
  const page = await lab.browser.newPage({ viewport: { width, height } });
  page.apiCalls = [];
  const hinted = hint === undefined ? role : hint;
  // Seeded once per tab: a later page in the same tab (after a sign-out, say) must see what the app left.
  await page.addInitScript(({ tok, hintedRole, extra }) => {
    try {
      if (sessionStorage.getItem("fin-b20-seeded")) return;
      sessionStorage.setItem("fin-b20-seeded", "1");
      if (tok) localStorage.setItem("fh_token", tok);
      if (hintedRole) localStorage.setItem("fh_role", hintedRole);
      for (const [k, v] of Object.entries(extra || {})) localStorage.setItem(k, v);
    } catch { /* storage may be blocked */ }
  }, { tok: token, hintedRole: hinted, extra: storage });
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call = {
      method: request.method(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers(),
      body: request.postData() || "",
      contentType: request.headers()["content-type"] || "",
    };
    page.apiCalls.push(call);
    if (call.method === "GET" && call.path === "/api/auth/session") {
      const custom = session ? await session(call) : undefined;
      if (custom) return fulfillJson(route, custom.body, custom.status ?? 200);
      return fulfillJson(route, { ok: true, staff: { ...DEFAULT_STAFF, role, ...staff } });
    }
    if (call.path === "/api/health") {
      const custom = health ? await health(call) : undefined;
      if (custom?.abort) return route.abort();
      if (custom && custom.raw !== undefined) return route.fulfill({ status: custom.status ?? 200, contentType: "text/html", body: custom.raw });
      if (custom) return fulfillJson(route, custom.body, custom.status ?? 200);
      return fulfillJson(route, { ok: true, db: "up", migrations: 7 });
    }
    const custom = api ? await api(call, route) : undefined;
    if (custom && custom.hold) return; // never answered
    if (custom && custom.abort) return route.abort();
    if (custom && typeof custom === "object" && "status" in custom && "body" in custom) {
      return fulfillJson(route, custom.body, custom.status);
    }
    return fulfillJson(route, custom ?? { ok: true, data: {}, items: [], tasks: [], count: 0 });
  });
  return page;
}

/** The calls the page made to one path (and method, when given). */
export function callsTo(page, path, method = null) {
  return page.apiCalls.filter((c) => c.path === path && (!method || c.method === method));
}

/** Wait until `fn` returns something truthy (polled on a timer, not on animation frames). */
export async function until(fn, { timeout = 10_000, every = 50, message = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}
