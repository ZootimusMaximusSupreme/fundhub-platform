// Practice test for the lenders "Apply" rows: the Apply button on a client-scoped lender list, and the
// Apply dialog (Copy proxy string, End session, Close).
//
// Two halves, both with fake answers and no network:
//
//   1. THE SESSION RECORD. The REAL launchProxySession and endActiveProxySession run against a stand-in
//      table that holds the real proxy_sessions columns, with the Oxylabs call answered by a stub. What
//      they wrote is then read back, and judged by the EXACT live SQL of the two display checks
//      (fin-b07-lender-apply and fin-b07-apply-dialog). A launch that saves another bank's page, an exit
//      in the wrong city, or an End session that does not end the session turns this red; none of those
//      leave a bad row in a table of sessions nobody has launched yet, which is why the live SQL alone
//      cannot hold them.
//   2. THE PAGE. The real lenders.html and proxy-apply.js, in a browser: Apply appears only on a
//      client-scoped list and only for a lender with an address; Apply sends the client and the lender;
//      Copy puts the proxy string on the clipboard; End session ends THAT session; Close ends nothing.

import assert from "node:assert/strict";
import test from "node:test";

import { launchProxySession, endActiveProxySession, ProxySessionError } from "../../../proxy/launch.mjs";
import { ORG, ago, contractSql, id } from "./fin-b07-case-runner.mjs";
import { UUID_DEFAULT, makeStandIn } from "./fin-b07-sql-kit.mjs";
import { json, startScreens } from "./s4-screen-harness.mjs";

const STAFF = id(50);
const CLIENT = id(1);
const LENDER = id(60);
const LENDER_URL = "https://bank.example/apply";
const ENV = { OXYLABS_USERNAME: "acct", OXYLABS_PASSWORD: "secret" };
const TABLES = ["proxy_sessions", "clients", "businesses", "lenders", "applications"];
const DEFAULTS = {
  proxy_sessions: {
    id: UUID_DEFAULT, status: "'verifying'", verification: "'{}'",
    started_at: "(datetime('now'))", created_at: "(datetime('now'))", updated_at: "(datetime('now'))",
  },
};

/** One stand-in company: a Phoenix client, one lender with an address, no application. */
function world() {
  const standIn = makeStandIn(TABLES, { defaults: DEFAULTS });
  standIn.insert("clients", { id: CLIENT, org_id: ORG, email: "dana@client.test", custom_fields: { business_city: "Phoenix", business_state: "AZ" }, is_demo: false });
  standIn.insert("lenders", { id: LENDER, org_id: ORG, name: "Mesa Community Bank", application_url: LENDER_URL, updated_at: ago(30), is_demo: false });
  return standIn;
}

/** The Oxylabs call, answered with a place. */
const exitAt = (city, region) => async () => ({ status: 200, body: "{}", json: { ip: "198.51.100.7", city, region, country: "US" } });

const launch = (standIn, fetchFn) => launchProxySession(standIn.pg(), {
  orgId: ORG, staffId: STAFF, clientId: CLIENT, lenderId: LENDER, env: ENV, fetchFn,
});

const judged = (standIn, key) => standIn.run(contractSql(key), ORG);

test("a launch saves the lender's own page and an exit in the client's city, and both live checks read it clean", async () => {
  const standIn = world();
  try {
    const out = await launch(standIn, exitAt("Phoenix", "Arizona"));
    assert.equal(out.application_url, LENDER_URL);
    const [row] = standIn.rows("proxy_sessions");
    assert.equal(row.status, "active");
    assert.equal(row.application_url, LENDER_URL, "the saved session names the lender's page, not another bank's");
    assert.equal(row.lender_id, LENDER);
    assert.equal(row.requested_city, "Phoenix");
    assert.equal(row.granted_city, "Phoenix");
    assert.equal(row.targeting_level, "city");
    assert.ok(row.exit_ip, "an active session names its exit address");
    assert.deepEqual(judged(standIn, "fin-b07-lender-apply"), { sample_count: 1, bad_count: 0 });
  } finally {
    standIn.close();
  }
});

test("an exit that lands in another city is refused, never saved as an active session", async () => {
  const standIn = world();
  try {
    await assert.rejects(
      () => launch(standIn, exitAt("Boston", "Massachusetts")),
      (err) => err instanceof ProxySessionError && err.code === "geo_unavailable",
    );
    const rows = standIn.rows("proxy_sessions");
    assert.equal(rows.length, 1, "the refused attempt still leaves its audit row");
    assert.equal(rows[0].status, "mismatch");
    assert.equal(rows[0].error_code, "geo_unavailable");
    assert.ok(rows[0].ended_at, "a refused session is closed");
    assert.equal(rows[0].granted_city, null, "no exit city is recorded as granted for a session that was refused");
    assert.deepEqual(judged(standIn, "fin-b07-lender-apply"), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(judged(standIn, "fin-b07-apply-dialog"), { sample_count: 1, bad_count: 0 });
  } finally {
    standIn.close();
  }
});

test("when the city is not available the state is used, and the saved session says state level in the right state", async () => {
  const standIn = world();
  try {
    await launch(standIn, exitAt("Tempe", "Arizona"));
    const [row] = standIn.rows("proxy_sessions");
    assert.equal(row.status, "active");
    assert.equal(row.targeting_level, "state");
    assert.equal(row.granted_region, "Arizona");
    assert.deepEqual(judged(standIn, "fin-b07-lender-apply"), { sample_count: 1, bad_count: 0 });
  } finally {
    standIn.close();
  }
});

test("End session ends the active session with an end time, and a second press finds nothing active to end", async () => {
  const standIn = world();
  try {
    await launch(standIn, exitAt("Phoenix", "Arizona"));
    const [active] = standIn.rows("proxy_sessions");
    assert.equal(active.status, "active");
    assert.equal(active.ended_at, null);

    const ended = await endActiveProxySession(standIn.pg(), { orgId: ORG, sessionId: active.id, staffId: STAFF });
    assert.equal(ended.status, "ended");
    const [row] = standIn.rows("proxy_sessions");
    assert.equal(row.status, "ended", "the saved session reads ended");
    assert.ok(row.ended_at, "the saved session carries the time it ended");
    assert.deepEqual(judged(standIn, "fin-b07-apply-dialog"), { sample_count: 1, bad_count: 0 });

    await assert.rejects(
      () => endActiveProxySession(standIn.pg(), { orgId: ORG, sessionId: active.id, staffId: STAFF }),
      (err) => err instanceof ProxySessionError && err.code === "session_not_found",
    );
  } finally {
    standIn.close();
  }
});

test("End session by a staff member who did not launch it ends nothing", async () => {
  const standIn = world();
  try {
    await launch(standIn, exitAt("Phoenix", "Arizona"));
    const [active] = standIn.rows("proxy_sessions");
    await assert.rejects(
      () => endActiveProxySession(standIn.pg(), { orgId: ORG, sessionId: active.id, staffId: id(99) }),
      (err) => err instanceof ProxySessionError && err.code === "session_not_found",
    );
    assert.equal(standIn.rows("proxy_sessions")[0].status, "active");
  } finally {
    standIn.close();
  }
});

// ── The page ─────────────────────────────────────────────────────────────────────────────────

const OWNER = { ok: true, staff: { id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.test", role: "owner", org_id: "org-1", status: "active" } };
const PAGE_CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const WITH_URL = "bbbbbbbb-1111-4111-8111-111111111111";
const NO_URL = "bbbbbbbb-2222-4222-8222-222222222222";
const SESSION = "cccccccc-1111-4111-8111-111111111111";
const USERNAME = "customer-test-cc-US-city-phoenix-sessid-abc123-sesstime-30";

const lenderRow = (idValue, name, url) => ({
  id: idValue, name, lender_table: "OnlineBizCC", bureaus_pulled: "EX", stated_requirements: null, priority_tier: 1,
  active: true, eligible_states: "AZ", application_url: url, last_updated_by: null, last_updated_date: null,
});
const LENDERS = [lenderRow(WITH_URL, "Mesa Community Bank", LENDER_URL), lenderRow(NO_URL, "Desert Credit Union", null)];

const LAUNCH_OK = {
  ok: true,
  session_id: SESSION,
  session: { id: SESSION, status: "active", client_id: PAGE_CLIENT, lender_id: WITH_URL, application_id: null, started_at: "2026-10-14T12:00:00Z" },
  connection: { host: "pr.oxylabs.io", port: 7777, username: USERNAME, password: "proxy-pass", sessid: "abc123", sesstime: 30 },
  verification: { exit_ip: "203.0.113.44", city: "Phoenix", region: "Arizona", targeting_level: "city", requested_city: "phoenix", requested_state: "us_arizona" },
  application_url: LENDER_URL,
  lender: { id: WITH_URL, name: "Mesa Community Bank", product_name: null },
  bank_form_email: { email: "dana@client.test", warning: null },
  routing_active: false,
  extension_required: true,
};

function applyHandlers(record) {
  return {
    "/api/read/lenders": { ok: true, lenders: LENDERS, meta: { count: 2, empty: false } },
    "/api/read/lender-matches": { ok: true, client_id: PAGE_CLIENT, match_count: 2, summary: { match_count: 2, lender_count: 2 }, matches: LENDERS },
    "/api/read/lender-observations": { ok: true, observations: [], meta: { count: 0 } },
    "/api/proxy/launch": (route) => {
      record.launch.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, LAUNCH_OK);
    },
    "/api/proxy/end": (route) => {
      record.end.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, { ok: true, session: { id: SESSION, status: "ended", ended_at: "2026-10-14T12:30:00Z" } });
    },
  };
}

// The page reads the clipboard through navigator.clipboard; this records what it was asked to copy.
const CLIPBOARD = () => {
  window.__copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => { window.__copied.push(String(text)); return Promise.resolve(); } },
  });
};

test("Apply appears only on a client-scoped lender list, and only for a lender with an application address", async (t) => {
  const { open } = await startScreens(t);
  const record = { launch: [], end: [] };

  const scoped = await open(`/app/lenders.html?client_id=${PAGE_CLIENT}`, { session: OWNER, handlers: applyHandlers(record) });
  await scoped.page.waitForSelector("#lenderBody tr");
  assert.match(await scoped.page.locator("#applyClientBanner").innerText(), /Client-scoped Apply/);
  const buttons = scoped.page.locator("#lenderBody button[data-fh-apply]");
  assert.equal(await buttons.count(), 1, "one Apply button: the lender with an address");
  assert.equal(await buttons.first().getAttribute("data-lender-id"), WITH_URL);
  assert.equal(await buttons.first().getAttribute("data-client-id"), PAGE_CLIENT);
  const noUrlRow = scoped.page.locator(`#lenderBody tr[data-id="${NO_URL}"] .apply-cell`);
  assert.equal((await noUrlRow.innerText()).trim(), "No URL");
  await scoped.page.close();

  const plain = await open("/app/lenders.html", { session: OWNER, handlers: applyHandlers(record) });
  await plain.page.waitForSelector("#lenderBody tr");
  assert.equal(await plain.page.locator("#lenderBody button[data-fh-apply]").count(), 0, "no client in the address, no Apply button anywhere");
  assert.equal(await plain.page.locator("#applyClientBanner").count(), 0);
  await plain.page.close();
});

test("Apply sends this client and this lender, and the dialog's Copy, End session and Close do what they say", async (t) => {
  const { open } = await startScreens(t);
  const record = { launch: [], end: [] };
  // A tall window: the dialog holds the whole proxy string and is taller than a 900 pixel screen.
  const { page } = await open(`/app/lenders.html?client_id=${PAGE_CLIENT}`, {
    session: OWNER, handlers: applyHandlers(record), init: CLIPBOARD, viewport: { width: 1280, height: 2000 },
  });
  await page.waitForSelector("#lenderBody button[data-fh-apply]");

  await page.locator("#lenderBody button[data-fh-apply]").click();
  const modal = page.locator("#fh-proxy-apply-modal");
  await modal.getByRole("button", { name: "End session" }).waitFor();
  assert.deepEqual(record.launch, [{ client_id: PAGE_CLIENT, lender_id: WITH_URL, application_id: null }]);
  const text = await modal.innerText();
  assert.match(text, /Chrome extension not detected/);
  assert.match(text, /203\.0\.113\.44/);
  assert.match(text, new RegExp(USERNAME));

  // Copy: the button beside the username puts exactly that string on the clipboard.
  const userBox = modal.locator("div", { has: page.locator("[data-copy]"), hasText: "Username (includes city + sessid)" }).last();
  await userBox.locator("[data-copy-btn]").click();
  await page.waitForFunction(() => window.__copied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__copied), [USERNAME]);
  assert.equal(await userBox.locator("[data-copy-btn]").innerText(), "Copied");

  // End session: ends THIS session and closes the dialog.
  await modal.getByRole("button", { name: "End session" }).click();
  await page.waitForFunction(() => document.getElementById("fh-proxy-apply-modal").style.display === "none");
  assert.deepEqual(record.end, [{ session_id: SESSION }]);

  // Close ends nothing.
  await page.locator("#lenderBody button[data-fh-apply]").click();
  await modal.getByRole("button", { name: "Close" }).waitFor();
  await modal.getByRole("button", { name: "Close" }).click();
  await page.waitForFunction(() => document.getElementById("fh-proxy-apply-modal").style.display === "none");
  assert.equal(record.end.length, 1, "Close does not end the session");
  await page.close();
});
