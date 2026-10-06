// ONE META VERSION: v26.0, unless META_API_VERSION says otherwise.
//
// Marketing machine M0 step 5 (docs/specs/marketing-machine-2026-10-04.md):
// every Meta Graph call outside src/adplatforms/meta.mjs (which U13 moves on
// its own) uses META_API_VERSION, and v26.0 when it is unset. Before
// 2026-10-05 four files pinned version 21 and src/social/oauth.mjs wrote it
// into its URLs by hand, so setting META_API_VERSION could not move it.
//
// No database and no Meta: every URL is built or caught on its way out.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  insightsRequestUrl,
  metaListUrl,
  DEFAULT_META_API_VERSION
} from "../../api/campaigns/sync.mjs";
import { metaAuthUrl, exchangeMetaCode, metaGraphVersion } from "../social/oauth.mjs";
import { facebookPost } from "../social/adapters.mjs";
import { metaEventsUrl, DEFAULT_API_VERSION } from "../messaging/providers/meta-capi.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const connection = { external_ad_account_id: "act_982103620742368" };

const saved = {};
before(() => {
  for (const k of ["META_API_VERSION", "AD_TOKEN_ENC_KEY", "SOCIAL_PUBLISH_DRY_RUN"]) saved[k] = process.env[k];
  delete process.env.META_API_VERSION;
  delete process.env.SOCIAL_PUBLISH_DRY_RUN;
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the default is v26.0 everywhere", () => {
  test("the sync's numbers and lists", () => {
    assert.equal(DEFAULT_META_API_VERSION, "v26.0");
    const u = new URL(insightsRequestUrl(connection, { since: "2026-10-03", until: "2026-10-05" }));
    assert.equal(u.pathname, "/v26.0/act_982103620742368/insights");
    assert.ok(metaListUrl("act_1/campaigns", "id").startsWith("https://graph.facebook.com/v26.0/act_1/campaigns?"));
  });

  test("the Conversions API sender", () => {
    assert.equal(DEFAULT_API_VERSION, "v26.0");
    assert.ok(metaEventsUrl({}).startsWith("https://graph.facebook.com/v26.0/"));
  });

  test("the Page and Instagram connect dialog", () => {
    const out = metaAuthUrl({ appId: "123", redirectUri: "https://fundhub.ai/cb", state: "s", env: {} });
    assert.equal(out.ok, true);
    assert.ok(out.url.startsWith("https://www.facebook.com/v26.0/dialog/oauth?"), out.url);
  });

  test("the connect code exchange and the Page list", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      const body = String(url).includes("/oauth/access_token")
        ? { access_token: "fake-user-token", expires_in: 60 }
        : { data: [{ id: "p1" }] };
      return { json: async () => body };
    };
    const out = await exchangeMetaCode({
      code: "c", redirectUri: "https://fundhub.ai/cb",
      env: { META_APP_ID: "123", META_APP_SECRET: "fake-secret" }, fetchImpl
    });
    assert.equal(out.ok, true);
    assert.equal(urls.length, 2);
    for (const u of urls) assert.ok(u.startsWith("https://graph.facebook.com/v26.0/"), u);
  });

  test("the Facebook Page post", async () => {
    const realFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "post_1" }) };
    };
    try {
      const out = await facebookPost({
        id: 7,
        channel_partner_id: "partner-1",
        encrypted_access_token: encryptToken("fake-page-token", { partnerId: "partner-1" }),
        external_account_id: "123456",
        caption: "hello"
      });
      assert.equal(out.external_post_id, "post_1");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(urls, ["https://graph.facebook.com/v26.0/123456/feed"]);
  });
});

describe("META_API_VERSION still wins when it is set", () => {
  test("the sync reads it at call time", () => {
    process.env.META_API_VERSION = "v25.0";
    try {
      assert.ok(metaListUrl("act_1/ads", "id").startsWith("https://graph.facebook.com/v25.0/"));
    } finally {
      delete process.env.META_API_VERSION;
    }
  });

  test("the connect dialog and exchange read it too; a value that is not a version falls back", () => {
    assert.equal(metaGraphVersion({ META_API_VERSION: "v25.0" }), "v25.0");
    assert.equal(metaGraphVersion({ META_API_VERSION: " v26.0 " }), "v26.0");
    assert.equal(metaGraphVersion({ META_API_VERSION: "../x" }), "v26.0");
    assert.equal(metaGraphVersion({}), "v26.0");
    const out = metaAuthUrl({
      appId: "123", redirectUri: "https://fundhub.ai/cb", state: "s", env: { META_API_VERSION: "v25.0" }
    });
    assert.ok(out.url.startsWith("https://www.facebook.com/v25.0/dialog/oauth?"));
  });

  test("the connect dialog keeps everything else it always sent", () => {
    const u = new URL(metaAuthUrl({ appId: "123", redirectUri: "https://fundhub.ai/cb", state: "st", env: {} }).url);
    assert.equal(u.searchParams.get("client_id"), "123");
    assert.equal(u.searchParams.get("redirect_uri"), "https://fundhub.ai/cb");
    assert.equal(u.searchParams.get("state"), "st");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("scope"),
      "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish");
    assert.deepEqual(metaAuthUrl({ redirectUri: "x", state: "s" }),
      { ok: false, reason: "not_configured", missing: ["META_APP_ID"] });
  });
});

/* THE DRIFT GUARD. Any server file that talks to Meta and names a version
   other than v26.0 fails here. src/adplatforms/meta.mjs is left out on
   purpose: unit U13 owns it and sets its own default to v26.0. */
describe("no other Meta version is pinned in server code", () => {
  const SKIP = new Set(["node_modules", ".git", ".netlify"]);
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.m?js$/.test(name) && !/\.test\.m?js$/.test(name)) out.push(full);
    }
    return out;
  }

  test("api/, src/, netlify/ and scripts/ name only v26.0 where they talk to Meta", () => {
    const offenders = [];
    for (const root of ["api", "src", "netlify", "scripts"]) {
      for (const file of walk(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        if (rel === join("src", "adplatforms", "meta.mjs")) continue;
        const src = readFileSync(file, "utf8");
        if (!/facebook\.com|META_API_VERSION/.test(src)) continue;
        for (const m of src.matchAll(/\bv(\d{1,3})\.(\d{1,3})\b/g)) {
          if (m[0] !== "v26.0") offenders.push(`${rel}: ${m[0]}`);
        }
      }
    }
    assert.deepEqual(offenders, [], "a Meta call still pins another version");
  });
});
