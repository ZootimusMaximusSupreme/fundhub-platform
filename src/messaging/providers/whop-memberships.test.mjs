// The Whop memberships reader: GET only, pinned version, documented hosts, every page or an
// error, and a provider body never echoed. Every call here is a fake; nothing leaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  whopGet, listMemberships, getMembership, getMemberEmail, WHOP_MEMBERSHIPS_API_VERSION, WhopReadError
} from "./whop-memberships.mjs";

const env = { ADAPTERS_DRY_RUN: "false" };
const KEY = "test-whop-key-not-real";
const ACCOUNT = "biz_TestAccount1";

function fakeFetch(pages) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = typeof pages === "function" ? pages(String(url), calls.length) : pages.shift();
    const { status = 200, body } = next || {};
    return { ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => JSON.stringify(body ?? null) };
  };
  return { calls, fetchImpl };
}
const page = (data, next = null) => ({ body: { data, page_info: { has_next_page: !!next, end_cursor: next } } });

test("lists every page with the account, the statuses, the key and the pinned version", async () => {
  const { calls, fetchImpl } = fakeFetch([page([{ id: "mem_A" }, { id: "mem_B" }], "c1"), page([{ id: "mem_C" }])]);
  const out = await listMemberships({ accountId: ACCOUNT, apiKey: KEY, statuses: ["active", "trialing", "nope"], env, fetchImpl });
  assert.deepEqual(out.rows.map((m) => m.id), ["mem_A", "mem_B", "mem_C"]);
  assert.equal(out.complete, true);
  assert.equal(calls.length, 2);
  const first = new URL(calls[0].url);
  assert.equal(first.origin + first.pathname, "https://api.whop.com/api/v1/memberships");
  assert.equal(first.searchParams.get("account_id"), ACCOUNT);
  assert.equal(first.searchParams.get("first"), "100");
  assert.deepEqual(first.searchParams.getAll("statuses"), ["active", "trialing"]);
  assert.equal(first.searchParams.get("after"), null);
  assert.equal(new URL(calls[1].url).searchParams.get("after"), "c1");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.headers["Api-Version-Date"], WHOP_MEMBERSHIPS_API_VERSION);
  assert.equal(WHOP_MEMBERSHIPS_API_VERSION, "2026-11-06");
});

test("the sandbox host is used only when WHOP_ENV says sandbox", async () => {
  const { calls, fetchImpl } = fakeFetch([page([])]);
  await listMemberships({ accountId: ACCOUNT, apiKey: KEY, env: { ...env, WHOP_ENV: "sandbox" }, fetchImpl });
  assert.match(calls[0].url, /^https:\/\/sandbox-api\.whop\.com\/api\/v1\/memberships\?/);
});

test("an unfinished list is an error, never a short list", async () => {
  const stalled = fakeFetch([page([{ id: "mem_A" }], "c1"), page([{ id: "mem_B" }], "c1")]);
  await assert.rejects(listMemberships({ accountId: ACCOUNT, apiKey: KEY, env, fetchImpl: stalled.fetchImpl }), { code: "whop_bad_page" });
  const endless = fakeFetch((url, n) => page([{ id: `mem_${n}` }], `c${n}`));
  await assert.rejects(listMemberships({ accountId: ACCOUNT, apiKey: KEY, env, fetchImpl: endless.fetchImpl, maxPages: 3 }),
    { code: "whop_too_many_pages" });
  assert.equal(endless.calls.length, 3);
  const odd = fakeFetch([{ body: { items: [] } }]);
  await assert.rejects(listMemberships({ accountId: ACCOUNT, apiKey: KEY, env, fetchImpl: odd.fetchImpl }), { code: "whop_bad_page" });
});

test("no key, a bad account, or the fence up: nothing is sent", async () => {
  const { calls, fetchImpl } = fakeFetch(() => page([]));
  await assert.rejects(listMemberships({ accountId: ACCOUNT, apiKey: "", env, fetchImpl }), { code: "whop_not_configured" });
  await assert.rejects(listMemberships({ accountId: "acct_1", apiKey: KEY, env, fetchImpl }), { code: "whop_not_configured" });
  await assert.rejects(listMemberships({ accountId: ACCOUNT, apiKey: KEY, env: {}, fetchImpl }), { code: "whop_fenced" });
  await assert.rejects(whopGet("/payments?x=1", { apiKey: KEY, env, fetchImpl }), { code: "whop_bad_resource" });
  await assert.rejects(whopGet("/memberships/../checkout_configurations", { apiKey: KEY, env, fetchImpl }), { code: "whop_bad_resource" });
  assert.equal(calls.length, 0);
});

test("Whop's answers become short codes; the provider body is never repeated", async () => {
  const secret = "buyer@example.com said card 4242";
  for (const [status, code] of [[401, "whop_unauthorized"], [403, "whop_forbidden"], [404, "whop_not_found"], [500, "whop_read_failed"]]) {
    const { fetchImpl } = fakeFetch([{ status, body: { error: { message: secret } } }]);
    const err = await getMembership("mem_A1", { apiKey: KEY, env, fetchImpl }).catch((e) => e);
    assert.ok(err instanceof WhopReadError);
    assert.equal(err.code, code);
    assert.doesNotMatch(err.message, /example\.com|4242/);
    assert.doesNotMatch(err.message, new RegExp(KEY));
  }
});

test("one membership and one member email by id; bad ids are refused before any call", async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: { id: "mem_A1", status: "active" } },
    { body: { id: "mber_B2", email: "client@example.com", name: "Not kept", phone_number: "+15555550100" } },
    { body: { id: "mber_C3", email: null } }]);
  assert.equal((await getMembership("mem_A1", { apiKey: KEY, env, fetchImpl })).status, "active");
  assert.deepEqual(await getMemberEmail("mber_B2", { apiKey: KEY, env, fetchImpl }), { id: "mber_B2", email: "client@example.com" });
  assert.deepEqual(await getMemberEmail("mber_C3", { apiKey: KEY, env, fetchImpl }), { id: "mber_C3", email: null });
  assert.match(calls[0].url, /\/api\/v1\/memberships\/mem_A1$/);
  assert.match(calls[1].url, /\/api\/v1\/members\/mber_B2$/);
  await assert.rejects(getMembership("mem_A1/x", { apiKey: KEY, env, fetchImpl }), { code: "whop_bad_resource" });
  await assert.rejects(getMemberEmail("user_1", { apiKey: KEY, env, fetchImpl }), { code: "whop_bad_resource" });
  assert.equal(calls.length, 3);
});
