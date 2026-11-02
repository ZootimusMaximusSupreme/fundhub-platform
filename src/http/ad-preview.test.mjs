import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import handler, { findMatchingAd, previewFrameUrl } from "../../api/read/ad-preview.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000002";
const PARTNER = "00000000-0000-4000-8000-000000000003";

function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; }, setHeader() {} };
}

test("only a Meta preview iframe URL may be embedded", () => {
  assert.equal(previewFrameUrl('<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?id=1&amp;x=2"></iframe>'),
    "https://www.facebook.com/ads/api/preview_iframe.php?id=1&x=2");
  assert.equal(previewFrameUrl('<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=signed&amp;t=1"></iframe>'),
    "https://business.facebook.com/ads/api/preview_iframe.php?d=signed&t=1");
  assert.equal(previewFrameUrl('<iframe src="https://evil.example/video"></iframe>'), null);
  assert.equal(previewFrameUrl('<script>alert(1)</script>'), null);
});

test("ad lookup is tied to the client, org, exact Meta name and ad set", async () => {
  const db = { query: async (sql, args) => {
    assert.match(sql, /a\.name = COALESCE\(attr\.utm_content/);
    assert.match(sql, /s\.external_id = COALESCE\(attr\.utm_term/);
    assert.match(sql, /cl\.id = \$1 AND cl\.org_id = \$2/);
    assert.deepEqual(args, [CLIENT, ORG]);
    return { rows: [{ external_id: "123" }, { external_id: "456" }] };
  } };
  assert.equal(await findMatchingAd(db, { orgId: ORG, clientId: CLIENT }), null);
});

test("a matched Meta ad returns its playable preview without returning its token", async () => {
  const oldKey = process.env.AD_TOKEN_ENC_KEY;
  process.env.AD_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  try {
    const encrypted = encryptToken("private-test-token", { partnerId: PARTNER });
    const res = response();
    await handler({ method: "GET", query: { client_id: CLIENT } }, res, {
      db: { query: async () => ({ rows: [{ external_id: "123", partner_id: PARTNER,
        encrypted_access_token: encrypted }] }) },
      requireAuth: async () => ({ org_id: ORG, role: "owner" }),
      asStaff: async (fn, { db }) => fn(db),
      callPlatform: async ({ url, token }) => {
        assert.match(url, /\/123\/previews\?ad_format=MOBILE_FEED_STANDARD$/);
        assert.equal(token, "private-test-token");
        return { data: [{ body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?id=123"></iframe>' }] };
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.preview_url, "https://www.facebook.com/ads/api/preview_iframe.php?id=123");
    assert.doesNotMatch(JSON.stringify(res.body), /private-test-token/);
  } finally {
    if (oldKey === undefined) delete process.env.AD_TOKEN_ENC_KEY;
    else process.env.AD_TOKEN_ENC_KEY = oldKey;
  }
});
