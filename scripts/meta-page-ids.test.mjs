// scripts/meta-page-ids.mjs, driven by a fake Meta and a fake database.
// No network, no Postgres. The fake answers follow Meta's documented shapes;
// none is captured from the live account.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  pickConnection,
  idsFromAds,
  findPageIds,
  run,
  idLines,
  CONNECTIONS_SQL
} from "./meta-page-ids.mjs";

const CONN = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  org_id: "org-1",
  partner_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  external_ad_account_id: "act_424242",
  connection_state: "active",
  encrypted_access_token: "enc"
};

/* Long enough that the token scrubber never matches ordinary words. */
const TEST_KEY = "fake-meta-key-for-tests-only";

const GRANTED = { data: [{ permission: "ads_management", status: "granted" }, { permission: "ads_read", status: "granted" }] };

/* A fake Meta keyed on the path. Records every call's method and url. */
function fakeMeta(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    const u = new URL(String(url));
    const key = Object.keys(routes).find((k) => u.pathname.endsWith(k));
    const a = key ? routes[key] : { status: 404, body: { error: { message: "no route", code: 803 } } };
    const status = a.status ?? 200;
    return { ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(a.body ?? a) };
  };
  return { calls, fetch };
}

const onlyGets = (calls) => {
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.equal(c.method, "GET", c.url);
    assert.equal(c.body, undefined, c.url);
  }
};

describe("parseArgs", () => {
  test("partner and connection, uuid only", () => {
    assert.deepEqual(parseArgs([]), { partnerId: null, connectionId: null });
    assert.deepEqual(parseArgs(["--partner", CONN.partner_id]), { partnerId: CONN.partner_id, connectionId: null });
    assert.throws(() => parseArgs(["--partner", "x"]), /uuid/);
    assert.throws(() => parseArgs(["--write"]), /unknown option/);
  });
});

describe("pickConnection — the ad account comes from the connection row", () => {
  test("the first usable Meta row; a broken one is skipped", () => {
    const broken = { ...CONN, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", connection_state: "revoked" };
    assert.equal(pickConnection([broken, CONN]).connection, CONN);
    assert.match(pickConnection([broken]).error, /revoked/);
    assert.match(pickConnection([]).error, /No Meta connection/);
    assert.equal(pickConnection([broken, CONN], { connectionId: CONN.id }).connection, CONN);
  });

  test("the SQL reads Meta connections and writes nothing", () => {
    assert.match(CONNECTIONS_SQL, /^\s*SELECT\b/);
    assert.match(CONNECTIONS_SQL, /platform = 'meta'/);
    assert.doesNotMatch(CONNECTIONS_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

describe("idsFromAds", () => {
  test("newest ad first; the Instagram id must belong to the same Page", () => {
    const ads = [
      { created_time: "2026-09-01T00:00:00+0000", creative: { object_story_spec: { page_id: "old_page", instagram_user_id: "old_ig" } } },
      { created_time: "2026-10-01T00:00:00+0000", creative: { object_story_spec: { page_id: "page_1" } } },
      { created_time: "2026-09-20T00:00:00+0000", creative: { object_story_spec: { page_id: "page_1", instagram_user_id: "ig_1" } } },
      { created_time: "2026-10-02T00:00:00+0000", creative: { object_story_id: "123_456" } }
    ];
    assert.deepEqual(idsFromAds(ads), { page_id: "page_1", instagram_user_id: "ig_1" });
    assert.deepEqual(idsFromAds([]), { page_id: null, instagram_user_id: null });
  });
});

describe("findPageIds — GET only", () => {
  test("from a recent ad: permissions, then the ads list, nothing else", async () => {
    const m = fakeMeta({
      "/me/permissions": GRANTED,
      "/act_424242/ads": { data: [{ created_time: "2026-10-01T00:00:00+0000",
        creative: { object_story_spec: { page_id: "page_1", instagram_user_id: "ig_1" } } }] }
    });
    const out = await findPageIds({ connection: CONN, token: TEST_KEY, ctx: { fetch: m.fetch } });
    assert.equal(out.page_id, "page_1");
    assert.equal(out.instagram_user_id, "ig_1");
    onlyGets(m.calls);
    assert.equal(m.calls.length, 2);
    assert.match(m.calls[1].url, /\/act_424242\/ads\?/, "the account id is the connection row's");
    assert.equal(new URL(m.calls[1].url).searchParams.get("fields"), "created_time,creative{object_story_spec}");
  });

  test("no ad names a Page: promote_pages, then the Page's Instagram business account", async () => {
    const m = fakeMeta({
      "/me/permissions": GRANTED,
      "/act_424242/ads": { data: [] },
      "/act_424242/promote_pages": { data: [{ id: "page_7", name: "Fundhub" }] },
      "/page_7": { id: "page_7", instagram_business_account: { id: "ig_7" } }
    });
    const out = await findPageIds({ connection: CONN, token: TEST_KEY, ctx: { fetch: m.fetch } });
    assert.deepEqual([out.page_id, out.instagram_user_id], ["page_7", "ig_7"]);
    onlyGets(m.calls);
    assert.deepEqual(m.calls.map((c) => new URL(c.url).pathname.replace(/^\/v[\d.]+/, "")),
      ["/me/permissions", "/act_424242/ads", "/act_424242/promote_pages", "/page_7"]);
  });

  test("a Page with no Instagram account: the Page id alone, and it says so", async () => {
    const m = fakeMeta({
      "/me/permissions": GRANTED,
      "/act_424242/ads": { data: [{ creative: { object_story_spec: { page_id: "page_1" } } }] },
      "/page_1": { id: "page_1" }
    });
    const out = await findPageIds({ connection: CONN, token: TEST_KEY, ctx: { fetch: m.fetch } });
    assert.equal(out.page_id, "page_1");
    assert.equal(out.instagram_user_id, null);
    assert.ok(out.notes.some((n) => /no Instagram account/.test(n)));
    assert.deepEqual(idLines(out), ["META_PAGE_ID=page_1"]);
  });

  test("a key without ads_management stops before any ad is read", async () => {
    const m = fakeMeta({ "/me/permissions": { data: [{ permission: "ads_management", status: "declined" }] } });
    await assert.rejects(findPageIds({ connection: CONN, token: TEST_KEY, ctx: { fetch: m.fetch } }),
      (e) => e.metaStop && /does not have ads_management/.test(e.message));
    assert.equal(m.calls.length, 1);
  });

  test("Meta's own refusal is passed on in plain words and the script stops", async () => {
    const m = fakeMeta({
      "/me/permissions": GRANTED,
      "/act_424242/ads": { status: 403, body: { error: { message: "(#10) The system user cannot advertise as this Page", code: 10 } } }
    });
    await assert.rejects(findPageIds({ connection: CONN, token: TEST_KEY, ctx: { fetch: m.fetch } }),
      (e) => e.metaStop && /Meta said: \(#10\) The system user cannot advertise as this Page/.test(e.message));
  });
});

describe("run — reads the row, decrypts the key, asks Meta", () => {
  test("end to end with fakes; prints only the two ids", async () => {
    const m = fakeMeta({
      "/me/permissions": GRANTED,
      "/act_424242/ads": { data: [{ creative: { object_story_spec: { page_id: "page_1", instagram_user_id: "ig_1" } } }] }
    });
    const seen = [];
    const result = await run({
      fetch: m.fetch,
      staffScope: async (fn) => fn({ query: async (sql) => { seen.push(sql); return { rows: [CONN] }; } }),
      decrypt: (c) => { assert.equal(c, CONN); return "decrypted-key"; }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(idLines(result), ["META_PAGE_ID=page_1", "META_INSTAGRAM_USER_ID=ig_1"]);
    assert.equal(seen.length, 1);
    onlyGets(m.calls);
  });

  test("no usable connection: a plain sentence, Meta never asked", async () => {
    const m = fakeMeta({});
    const result = await run({
      fetch: m.fetch,
      staffScope: async (fn) => fn({ query: async () => ({ rows: [] }) }),
      decrypt: () => "k"
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /No Meta connection/);
    assert.equal(m.calls.length, 0);
  });
});

describe("the script's source", () => {
  const src = readFileSync(fileURLToPath(new URL("./meta-page-ids.mjs", import.meta.url)), "utf8");

  test("holds no ad account id, Page id or Instagram id", () => {
    assert.doesNotMatch(src, /act_\d/);
    assert.doesNotMatch(src, /\d{9,}/);
  });

  test("never POSTs and never calls fetch itself", () => {
    assert.doesNotMatch(src, /method:\s*["']POST/);
    assert.doesNotMatch(src, /\bbody:/);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /credentials\//);
  });
});
