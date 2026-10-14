// Proves the Connections tab: Connect, Save key, Sync now, Save secret and
// Turn off post the exact request and say what happened.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const TARGET = { entry: "frame", tab: "connections", surface: "financeos.html#connections" };
const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";
const WAITING_PULL = "cccccccc-0000-4000-8000-000000000001";
const ACTIVE_PULL = "cccccccc-0000-4000-8000-000000000002";
const WAITING_HOOK = "cccccccc-0000-4000-8000-000000000003";

function connectionsRead() {
  const answer = sampleAnswer("money-connections.sample.json");
  const base = { entity_id: BIZ, entity_name: "Fundhub LLC", entity_kind: "business", event_count: 0, last_event_at: null, last_synced_at: null, disabled_at: null };
  answer.connections = [
    { ...base, id: WAITING_PULL, provider: "commas", provider_label: "Commas", mode: "pull", status: "waiting", has_api_key: false, api_key_hint: null },
    { ...base, id: ACTIVE_PULL, provider: "whop", provider_label: "Whop", mode: "pull", status: "active", has_api_key: true, api_key_hint: "9f2c" },
    { ...base, id: WAITING_HOOK, provider: "commas", provider_label: "Commas", mode: "push", status: "waiting", has_secret: false, webhook_url: "/api/merchant/webhook/commas/sample" },
  ];
  return answer;
}

async function openConnections(open, { session = STAFF } = {}) {
  const resource = moneyResource("connections", {
    read: connectionsRead,
    write: (body) => {
      if (body.action === "create") {
        return { status: 201, body: { ok: true, connection: { id: "new-connection" }, ...(body.provider === "api" ? { api_key: "shown-once-key-value" } : {}) } };
      }
      if (body.action === "api_key" || body.action === "sync") {
        return { status: 200, body: { ok: true, connection: { id: body.connection_id }, sync: { ok: true, inserted: 3, done: true } } };
      }
      return { status: 200, body: { ok: true, connection: { id: body.connection_id } } };
    },
  });
  const opened = await open(entryUrl(TARGET.entry, { ...TARGET, clientId: session === CLIENT ? "" : CLIENT_ID }), { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fos-connections .prov");
  return { ...opened, ...resource.log };
}

const connection = (page, id) => page.locator(`.conn[data-conn="${id}"]`);

test("Connect posts the provider, the business and how sales come in", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Connect Commas \/ Connect Whop \/ Connect open API/, async () => {
    const { page, posts } = await openConnections(open);
    await page.locator('[data-mode="commas"]').selectOption("push");
    await page.locator('[data-act="create"][data-provider="commas"]').click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], { action: "create", provider: "commas", entity_id: BIZ, mode: "push", client_id: CLIENT_ID });
    await page.locator('[data-ent="whop"]').selectOption(BIZ);
    await page.locator('[data-act="create"][data-provider="whop"]').click();
    await waitFor(() => posts.length === 2);
    assert.deepEqual(posts[1], { action: "create", provider: "whop", entity_id: BIZ, mode: "pull", client_id: CLIENT_ID });
    await page.locator('[data-act="create"][data-provider="api"]').click();
    await waitFor(() => posts.length === 3);
    assert.deepEqual(posts[2], { action: "create", provider: "api", entity_id: BIZ, client_id: CLIENT_ID });
    await page.close();
  }, TARGET.surface);
});

test("Save key and Sync now post once and say what the sync did; the key is not kept", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Save key' \(client pastes/, async () => {
    const { page, posts } = await openConnections(open, { session: CLIENT });
    const box = page.locator(`[data-apikey="${WAITING_PULL}"]`);
    await connection(page, WAITING_PULL).locator('[data-act="apikey"]').click();
    await page.waitForFunction(() => /Paste the API key first\./.test(document.body.innerText));
    assert.deepEqual(posts, [], "an empty box posts nothing");
    await box.fill("processor-key-for-test");
    await connection(page, WAITING_PULL).locator('[data-act="apikey"]').click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], { action: "api_key", connection_id: WAITING_PULL, api_key: "processor-key-for-test" });
    await page.waitForFunction((id) => /Synced\. 3 new items\./.test(document.querySelector(`.conn[data-conn="${id}"]`)?.innerText || ""), WAITING_PULL);
    assert.equal(await page.locator(`[data-apikey="${WAITING_PULL}"]`).inputValue(), "", "the pasted key is gone from the page");
    await page.close();
  }, TARGET.surface);
});

test("Sync now posts the connection and says what came in", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Sync now' button/, async () => {
    const { page, posts } = await openConnections(open);
    await connection(page, ACTIVE_PULL).locator('[data-act="sync"]').click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], { action: "sync", connection_id: ACTIVE_PULL, client_id: CLIENT_ID });
    await page.waitForFunction((id) => /Synced\. 3 new items\./.test(document.querySelector(`.conn[data-conn="${id}"]`)?.innerText || ""), ACTIVE_PULL);
    await page.close();
  }, TARGET.surface);
});

test("Save secret posts the secret; Turn off asks first and posts the disable", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Save secret' \(webhook secret\) and 'Disable'/, async () => {
    const { page, posts } = await openConnections(open);
    const hook = connection(page, WAITING_HOOK);
    await hook.locator('[data-act="secret"]').click();
    await page.waitForFunction(() => /Paste the signing secret first\./.test(document.body.innerText));
    assert.deepEqual(posts, []);
    await page.locator(`[data-secret="${WAITING_HOOK}"]`).fill("signing-secret-for-test");
    await hook.locator('[data-act="secret"]').click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], { action: "secret", connection_id: WAITING_HOOK, secret: "signing-secret-for-test", client_id: CLIENT_ID });

    posts.length = 0;
    page.once("dialog", (dialog) => dialog.dismiss());
    await connection(page, ACTIVE_PULL).locator('[data-act="disable"]').click();
    await page.waitForTimeout(150);
    assert.deepEqual(posts, [], "Cancel leaves it on");
    page.once("dialog", (dialog) => { assert.match(dialog.message(), /Whop for Fundhub LLC/); dialog.accept(); });
    await connection(page, ACTIVE_PULL).locator('[data-act="disable"]').click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], { action: "disable", connection_id: ACTIVE_PULL, client_id: CLIENT_ID });
    await page.close();
  }, TARGET.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
