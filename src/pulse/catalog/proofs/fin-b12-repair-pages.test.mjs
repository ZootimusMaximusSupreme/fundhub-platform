// Batch 12, repair cycle 1: what the Documents page and the Finance OS page PAINT and DO at load.
// Practice test means a real page in Chromium, fake /api answers, and a judgement of the exact request
// the page sends and the words it paints. Nothing here reads live data.
//
// These cover the parts a saved-row check cannot see:
//   documents.html and finance-os.html: an owner or admin with no client open is sent to the primary demo
//     client when Demo Mode is on, and to nobody otherwise;
//   finance-os.html: the client picker asks for up to 500 clients and lists the right names, and the
//     header says the open client's name (and says "no client open" only when none is open).

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

const DEMO_CLIENT = "d3a10000-0000-4000-8000-0000000000d1";
const CLIENT_A = "c1a10000-0000-4000-8000-000000000001";
const CLIENT_B = "c1a10000-0000-4000-8000-000000000002";
const CLIENT_C = "c1a10000-0000-4000-8000-000000000003";
const CLOSER = { ok: true, staff: { ...OWNER.staff, role: "closer" } };
const ADMIN = { ok: true, staff: { ...OWNER.staff, role: "admin" } };

/** The /api/demo/mode answer, with a log of how many times it was asked. */
function demoMode(answer) {
  const log = { asks: 0 };
  return {
    log,
    handlers: { "/api/demo/mode": async (route) => { log.asks += 1; return json(route, answer); } },
  };
}

const DEMO_ON = { ok: true, demo_mode_enabled: true, primary_client_id: DEMO_CLIENT };
// Demo Mode off still reports the primary demo client if one was ever seeded (src/demo/platform-seed.mjs
// getDemoModeStatus), so an owner must be left alone because of the flag, not because the id is missing.
const DEMO_OFF = { ok: true, demo_mode_enabled: false, primary_client_id: DEMO_CLIENT };

/** Open a page and say where it ended up and how many times it asked for the demo mode. */
async function openAt(open, pathName, { session, mode, extra = {} }) {
  const fake = demoMode(mode);
  const { page, errors } = await open(pathName, { session, handlers: { ...fake.handlers, ...extra } });
  await page.waitForLoadState("domcontentloaded");
  return { page, errors, fake };
}

async function redirectCases(open, file) {
  const path = `/app/${file}`;
  // 1. Owner, no client, Demo Mode on: the page ends up on the primary demo client.
  const a = await openAt(open, path, { session: OWNER, mode: DEMO_ON });
  await a.page.waitForURL((url) => url.searchParams.get("client_id") === DEMO_CLIENT);
  assert.equal(new URL(a.page.url()).pathname, path, "same page, with the client added");
  assert.ok(a.fake.log.asks >= 1, "it asked whether Demo Mode is on");
  await a.page.close();

  // 2. Admin is treated the same way as owner.
  const b = await openAt(open, path, { session: ADMIN, mode: DEMO_ON });
  await b.page.waitForURL((url) => url.searchParams.get("client_id") === DEMO_CLIENT);
  await b.page.close();

  // 3. A client is already open: no question asked, nothing changes.
  const c = await openAt(open, `${path}?client_id=${CLIENT_A}`, { session: OWNER, mode: DEMO_ON });
  await c.page.waitForTimeout(1200);
  assert.equal(new URL(c.page.url()).searchParams.get("client_id"), CLIENT_A, "an open client is left alone");
  assert.equal(c.fake.log.asks, 0, "it did not ask about Demo Mode when a client is already open");
  await c.page.close();

  // 4. Any other staff role: no question asked and no redirect.
  const d = await openAt(open, path, { session: CLOSER, mode: DEMO_ON });
  await d.page.waitForTimeout(1200);
  assert.equal(new URL(d.page.url()).searchParams.get("client_id"), null, "a closer is not sent to the demo client");
  assert.equal(d.fake.log.asks, 0, "a closer does not ask about Demo Mode");
  await d.page.close();

  // 5. Demo Mode off: the owner stays where they are.
  const e = await openAt(open, path, { session: OWNER, mode: DEMO_OFF });
  await waitFor(() => e.fake.log.asks >= 1);
  await e.page.waitForTimeout(1200);
  assert.equal(new URL(e.page.url()).searchParams.get("client_id"), null, "with Demo Mode off nobody is sent anywhere");
  await e.page.close();
}

test("Documents: an owner or admin with no client is sent to the primary demo client, and nobody else is moved", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page itself loads \(optionally \?client_id=\)/, async () => {
    await redirectCases(open, "documents.html");

    // The page then asks for THAT client's documents and lists them.
    const asked = [];
    const docs = {
      ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
      items: [
        { id: "doc-1", kind: "contract", title: "Funding agreement", document_key: "k1", client_id: DEMO_CLIENT, client_name: "Avery Cobalt",
          mime_type: "application/pdf", generated_at: "2026-10-10T10:00:00Z", delivery_status: "sent", delivered_at: "2026-10-10T10:05:00Z",
          signature_required: true, signed_at: null, current_version: 1, created_at: "2026-10-10T10:00:00Z" },
        { id: "doc-2", kind: "client_upload", title: "Bank statement", document_key: "k2", client_id: DEMO_CLIENT, client_name: "Avery Cobalt",
          mime_type: "application/pdf", generated_at: "2026-10-11T10:00:00Z", delivery_status: "not_delivered", delivered_at: null,
          signature_required: false, signed_at: null, current_version: 1, created_at: "2026-10-11T10:00:00Z" },
      ],
    };
    const fake = demoMode(DEMO_ON);
    const { page, errors } = await open("/app/documents.html", {
      session: OWNER,
      handlers: {
        ...fake.handlers,
        "/api/read/documents": async (route, { url }) => { asked.push(new URL(url).search); return json(route, docs); },
        "/api/contracts": async (route) => json(route, { ok: true, items: [] }),
      },
    });
    await page.waitForURL((url) => url.searchParams.get("client_id") === DEMO_CLIENT);
    await page.waitForFunction(() => /Funding agreement/.test(document.body.innerText) && /Bank statement/.test(document.body.innerText));
    assert.ok(asked.some((q) => q.includes(`client_id=${DEMO_CLIENT}`)), `the page asked for the demo client's documents: ${JSON.stringify(asked)}`);
    assert.match(await page.locator("#body").innerText(), /Avery Cobalt/);
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/i.test(e)), []);
    await page.close();
  });
});

// ───────────────────────────── finance-os.html ─────────────────────────────

const CLIENTS = [
  { id: CLIENT_B, first_name: "Zora", last_name: "Whitfield", email: "zora@example.com" },
  { id: CLIENT_A, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" },
  { id: CLIENT_C, first_name: null, last_name: null, email: "only-email@example.com" },
  { id: "c1a10000-0000-4000-8000-000000000004", first_name: "", last_name: "", email: null },
];

function financeOsHandlers({ clients = CLIENTS, detail } = {}) {
  const log = { clientReads: [], detailReads: [] };
  return {
    log,
    handlers: {
      "/api/dashboard/clients": async (route, { url }) => { log.clientReads.push(new URL(url).search); return json(route, { ok: true, clients }); },
      "/api/dashboard/client": async (route, { url }) => {
        log.detailReads.push(new URL(url).search);
        return json(route, detail || { ok: true, client: { id: CLIENT_A, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" }, transactions: [], payments: [], invoices: [] });
      },
    },
  };
}

test("Finance OS: an owner or admin with no client is sent to the primary demo client, and nobody else is moved", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page itself loads \(with or without \?client_id=\)/, async () => {
    await redirectCases(open, "finance-os.html");
    // Once there, the page opens THAT client: the credit read and the client read are for the demo client.
    const reads = [];
    const fake = demoMode(DEMO_ON);
    const { page } = await open("/app/finance-os.html", {
      session: OWNER,
      handlers: {
        ...fake.handlers,
        "/api/dashboard/clients": async (route) => json(route, { ok: true, clients: CLIENTS }),
        "/api/read/finance-os": async (route, { url }) => { reads.push(url); return json(route, { ok: true, items: [] }); },
        "/api/dashboard/client": async (route, { url }) => {
          reads.push(url);
          return json(route, { ok: true, client: { id: DEMO_CLIENT, first_name: "Avery", last_name: "Cobalt", email: "demo.client.01@example.com" } });
        },
      },
    });
    await page.waitForURL((url) => url.searchParams.get("client_id") === DEMO_CLIENT);
    await waitFor(() => reads.some((u) => u.includes(`client_id=${DEMO_CLIENT}`)) && reads.some((u) => u.includes(`id=${DEMO_CLIENT}`)));
    await page.waitForFunction(() => document.querySelector("#fosWho")?.textContent === "Avery Cobalt");
    await page.close();
  });
});

test("Finance OS: the picker asks for up to 500 clients and lists each one by name, and the header says the open client", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Client picker select \(up to 500 clients\)/, async () => {
    const fake = financeOsHandlers();
    const { page, errors } = await open(`/app/finance-os.html?client_id=${CLIENT_A}`, { session: OWNER, handlers: fake.handlers });
    await page.waitForFunction(() => document.querySelectorAll("#fosClient option").length > 1);
    // It asks for the whole book, up to 500.
    assert.ok(fake.log.clientReads.length >= 1);
    assert.ok(fake.log.clientReads.every((q) => /(^|[?&])limit=500(&|$)/.test(q)), `every client read asks for 500: ${JSON.stringify(fake.log.clientReads)}`);
    const options = await page.locator("#fosClient option").evaluateAll((els) => els.map((o) => ({ value: o.value, text: o.textContent.trim(), selected: o.selected })));
    // The first is the prompt; then every client, sorted by the name the picker prints.
    assert.equal(options[0].value, "");
    const listed = options.slice(1).map((o) => o.text);
    assert.deepEqual(listed, [
      "Dana Whitfield — dana@example.com",
      "only-email@example.com — only-email@example.com",
      "Unnamed client",
      "Zora Whitfield — zora@example.com",
    ], "each client is listed by name (email when there is no name), sorted by that name");
    // Each option carries its own client's id, and the open client is the selected one.
    const byText = Object.fromEntries(options.slice(1).map((o) => [o.text.split(" — ")[0], o]));
    assert.equal(byText["Dana Whitfield"].value, CLIENT_A);
    assert.equal(byText["Zora Whitfield"].value, CLIENT_B);
    assert.equal(byText["only-email@example.com"].value, CLIENT_C);
    assert.equal(options.filter((o) => o.selected).map((o) => o.value).join(), CLIENT_A, "the open client is selected");
    // The count line says how many clients came back.
    assert.equal((await page.locator("#fosPickMsg").innerText()).trim(), "4 clients on file");
    // The find box narrows the list by name and email, and says how many match.
    await page.locator("#fosFind").fill("whitfield");
    await page.waitForFunction(() => document.querySelectorAll("#fosClient option").length === 3);
    assert.equal((await page.locator("#fosPickMsg").innerText()).trim(), "2 of 4 clients match");
    await page.locator("#fosFind").fill("nobody-has-this-name");
    await page.waitForFunction(() => document.querySelector("#fosClient option")?.textContent === "No client matches that");
    // Picking another client and pressing Open sends the page to that client.
    await page.locator("#fosFind").fill("");
    await page.waitForFunction(() => document.querySelectorAll("#fosClient option").length === 5);
    await page.locator("#fosClient").selectOption(CLIENT_B);
    assert.equal(await page.locator("#fosOpen").innerText(), "Open this client");
    await page.locator("#fosOpen").click();
    await page.waitForURL((url) => url.searchParams.get("client_id") === CLIENT_B);
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/i.test(e)), []);
    await page.close();
  });
});

test("Finance OS: the header says the open client's name, and says no client open only when none is", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Header text 'no client open' \/ client name/, async () => {
    // A client is open: the header is that client's own name, from the client read for that client.
    const named = financeOsHandlers();
    const a = await open(`/app/finance-os.html?client_id=${CLIENT_A}`, { session: OWNER, handlers: named.handlers });
    await a.page.waitForFunction(() => document.querySelector("#fosWho")?.textContent === "Dana Whitfield");
    assert.ok(named.log.detailReads.some((q) => q === `?id=${CLIENT_A}`), `the client read is for the open client: ${JSON.stringify(named.log.detailReads)}`);
    await a.page.close();

    // The detail read knows only an email: the header says the email, not the start of the id.
    const emailOnly = financeOsHandlers({ detail: { ok: true, client: { id: CLIENT_C, first_name: "", last_name: "", email: "only-email@example.com" } } });
    const b = await open(`/app/finance-os.html?client_id=${CLIENT_C}`, { session: OWNER, handlers: emailOnly.handlers });
    await b.page.waitForFunction(() => document.querySelector("#fosWho")?.textContent === "only-email@example.com");
    assert.ok(emailOnly.log.detailReads.some((q) => q === `?id=${CLIENT_C}`), `the client read is for the open client: ${JSON.stringify(emailOnly.log.detailReads)}`);
    await b.page.close();

    // The read that knows the name failed: a client is still open, so the header does NOT say "no client open";
    // it says "client" and the first eight letters of that client's id.
    const failed = financeOsHandlers();
    failed.handlers["/api/dashboard/client"] = async (route) => json(route, { ok: false, error: "server_error" }, 500);
    const c = await open(`/app/finance-os.html?client_id=${CLIENT_A}`, { session: OWNER, handlers: failed.handlers });
    await c.page.waitForFunction((want) => document.querySelector("#fosWho")?.textContent === want, `client ${CLIENT_A.slice(0, 8)}`);
    await c.page.close();

    // No client open (and no Demo Mode): the header says so, and the client list is still offered.
    const none = financeOsHandlers();
    const d = await open("/app/finance-os.html", { session: OWNER, handlers: { ...demoMode(DEMO_OFF).handlers, ...none.handlers } });
    await d.page.waitForFunction(() => document.querySelectorAll("#fosClient option").length > 1);
    assert.equal((await d.page.locator("#fosWho").textContent()).trim(), "no client open");
    await d.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
