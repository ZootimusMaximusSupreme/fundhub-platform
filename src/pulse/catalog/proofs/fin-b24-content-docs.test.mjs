// Batch 24 (finish the 853), staff doors, part 2: the Content screen read, the
// portal welcome video, and the saved-document download link.
//
// The real api/ handlers, a stand-in database that answers by the conditions the
// SQL text names, and the in-memory file store. Nothing leaves the building.
// This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";

import contentTiles from "../../../../api/content/tiles.mjs";
import documentsDownload from "../../../../api/documents-download.mjs";
import welcomeVideo from "../../../../api/content/welcome-video.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { verifyDocumentUrl } from "../../../documents/signed-url.mjs";
import { storeFromEnv } from "../../../documents/store.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";
import { tableRules } from "../../../testing/s3-scoped-rows.mjs";

const VIDEO_ID = "0d000000-0000-4000-8000-000000000001";
const OTHER_VIDEO_ID = "0d000000-0000-4000-8000-0000000000ff";
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const NOW_ISO = "2026-10-13T12:00:00.000Z";

const secretName = ["DOCUMENT", "URL", "SECRET"].join("_");
const providerName = ["DOCUMENT", "STORE", "PROVIDER"].join("_");
let savedSecret;
let savedProvider;
before(() => {
  savedSecret = process.env[secretName];
  savedProvider = process.env[providerName];
  process.env[secretName] = crypto.randomBytes(24).toString("hex");
  delete process.env[providerName];
});
after(() => {
  if (savedSecret === undefined) delete process.env[secretName]; else process.env[secretName] = savedSecret;
  if (savedProvider === undefined) delete process.env[providerName]; else process.env[providerName] = savedProvider;
});

/* ── content/tiles GET: tiles, prices, videos, tier map, products ─────────── */

const TILE_A = { org_id: ORG_ID, code: "metro2-letter-pack", name: "Metro 2 Dispute Letter Pack", description: "The paid DIY letter pack.", active: true, sort_order: 50, display_price_cents: "29700" };
const TILE_B = { org_id: ORG_ID, code: "finance-os", name: "Finance OS", description: null, active: false, sort_order: 10, display_price_cents: null };
const TILE_X = { org_id: OTHER_ORG_ID, code: "their-tile", name: "Their tile", description: "x", active: true, sort_order: 1, display_price_cents: "100" };

function tileRules({ priceError = null, videoError = null } = {}) {
  const company = clause(/WHERE org_id = \$1::uuid/, (row, p) => row.org_id === p[0]);
  const company2 = clause(/WHERE\s+org_id = \$1::uuid/, (row, p) => row.org_id === p[0]);
  return [
    [/FROM entitlement_catalog\s+WHERE org_id = \$1::uuid AND display_price_cents IS NOT NULL/, (sql, p) => {
      if (priceError) return priceError;
      return shelf([TILE_X, TILE_A, TILE_B].filter((r) => r.display_price_cents != null), [company, company2])(sql, p);
    }],
    [/FROM entitlement_catalog\s+WHERE org_id = \$1::uuid\s+ORDER BY sort_order, code/, (sql, p) =>
      shelf([TILE_X, TILE_A, TILE_B].sort((a, b) => a.sort_order - b.sort_order), [company, company2])(sql, p)],
    [/FROM content_videos\s+WHERE org_id = \$1::uuid/, (sql, p) => {
      if (videoError) return videoError;
      return shelf([
        { id: OTHER_VIDEO_ID, org_id: OTHER_ORG_ID, title: "Their video", duration_label: "9:99", mime_type: "video/mp4", byte_size: "1", uploaded_by: "x", created_at: NOW_ISO },
        { id: VIDEO_ID, org_id: ORG_ID, title: "Welcome", duration_label: "2:10", mime_type: "video/mp4", byte_size: "5000000", uploaded_by: "Olive Owner", created_at: NOW_ISO },
      ], [company, company2])(sql, p);
    }],
    [/FROM content_tier_map WHERE org_id = \$1::uuid/, shelf([
      { org_id: OTHER_ORG_ID, tier_code: "default", video_id: OTHER_VIDEO_ID },
      { org_id: ORG_ID, tier_code: "default", video_id: VIDEO_ID },
      { org_id: ORG_ID, tier_code: "funding_bundle", video_id: VIDEO_ID },
    ], [clause(/WHERE org_id = \$1::uuid/, (row, p) => row.org_id === p[0])])],
    [/FROM products\s+WHERE org_id = \$1::uuid AND active = true/, shelf([
      { org_id: OTHER_ORG_ID, code: "their-product", name: "Theirs", description: "", sort_order: 1, active: true },
      { org_id: ORG_ID, code: "retired-product", name: "Retired", description: "", sort_order: 3, active: false },
      { org_id: ORG_ID, code: "funding_bundle", name: "Funding Bundle", description: "The bundle", sort_order: 2, active: true },
    ], [
      clause(/WHERE org_id = \$1::uuid/, (row, p) => row.org_id === p[0]),
      clause(/AND active = true/, (row) => row.active === true),
    ])],
  ];
}

test("content/tiles GET gives the screen this company's tiles with prices and on-off, its videos, the tier-to-video map and its products", async () => {
  assert.equal(ROUTES["content/tiles"], contentTiles);
  const done = await hit(contentTiles, { role: "admin", rules: tileRules() });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.tiles, [
    { id: "finance-os", code: "finance-os", name: "Finance OS", copy: "", price_cents: null, on: false, sort_order: 10 },
    { id: "metro2-letter-pack", code: "metro2-letter-pack", name: "Metro 2 Dispute Letter Pack", copy: "The paid DIY letter pack.", price_cents: 29700, on: true, sort_order: 50 },
  ], "no tile from another company, a price nobody saved stays unknown (null), and a switched-off tile says off");
  assert.deepEqual(done.body.videos, [
    { id: VIDEO_ID, title: "Welcome", duration_label: "2:10", mime_type: "video/mp4", byte_size: 5000000, uploaded_by: "Olive Owner", uploaded_at: NOW_ISO },
  ]);
  assert.deepEqual(done.body.map, { default: VIDEO_ID, funding_bundle: VIDEO_ID });
  assert.deepEqual(done.body.products, [{ id: "funding_bundle", name: "Funding Bundle", note: "The bundle" }], "only this company's active products");
  for (const pattern of [/FROM entitlement_catalog\s+WHERE org_id/, /FROM content_videos/, /FROM content_tier_map/, /FROM products/]) {
    for (const call of sqlCalls(done, pattern)) assert.deepEqual(call.params, [ORG_ID], String(pattern));
  }
  assert.equal(done.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0, "a read writes nothing");
});

test("content/tiles GET forgives only the two known missing-shape errors; a real fault is a 500, never painted as an empty library", async () => {
  const noColumn = await hit(contentTiles, { rules: tileRules({ priceError: Object.assign(new Error("column display_price_cents does not exist"), { code: "42703" }) }) });
  assert.equal(noColumn.status, 200);
  assert.deepEqual(noColumn.body.tiles.map((t) => t.price_cents), [null, null], "an unknown price is null, never 0");
  const noTable = await hit(contentTiles, { rules: tileRules({ videoError: Object.assign(new Error('relation "content_videos" does not exist'), { code: "42P01" }) }) });
  assert.equal(noTable.status, 200);
  assert.deepEqual(noTable.body.videos, []);
  assert.deepEqual(noTable.body.map, {});
  const denied = await hit(contentTiles, { rules: tileRules({ videoError: Object.assign(new Error("permission denied for table content_videos"), { code: "42501" }) }) });
  assert.equal(denied.status, 500, "a grant refusal is not an empty library");
  const priceDenied = await hit(contentTiles, { rules: tileRules({ priceError: Object.assign(new Error("permission denied for table entitlement_catalog"), { code: "42501" }) }) });
  assert.equal(priceDenied.status, 500, "a grant refusal is not an unknown price");
});

test("content/tiles lets in owner and admin only and answers nothing to another verb", async () => {
  await assertRoleGate(contentTiles, ["owner", "admin"], { rules: tileRules() });
  const odd = await hit(contentTiles, { method: "DELETE", rules: tileRules() });
  assert.equal(odd.status, 405);
});

/* ── content/welcome-video: the hero video on the client portal ───────────── */

function videoRules({ mapped = true } = {}) {
  const mapRow = { tier_code: "default", id: VIDEO_ID, org_id: ORG_ID, title: "Welcome to Fundhub", duration_label: "2:10", mime_type: "video/mp4", byte_size: "5000000", created_at: NOW_ISO };
  const otherMap = { ...mapRow, id: OTHER_VIDEO_ID, org_id: OTHER_ORG_ID, title: "Their welcome" };
  return [
    [/FROM content_tier_map m\s+JOIN content_videos v/, (sql, p) => (mapped
      ? shelf([otherMap, mapRow], [clause(/WHERE m\.org_id = \$1::uuid AND m\.tier_code = ANY\(\$2::text\[\]\)/, (row, params) => row.org_id === params[0] && params[1].includes(row.tier_code))])(sql, p)
      : [])],
  ];
}
function storageRule(rows) {
  return [/SELECT id, storage_key, mime_type, byte_size\s+FROM content_videos/, (sql, p) => shelf(rows, [
    clause(/WHERE id = \$1::uuid AND org_id = \$2::uuid/, (row, params) => row.id === params[0] && row.org_id === params[1]),
    clause(/WHERE id = \$1::uuid\s*$/, (row, params) => row.id === params[0]),
  ])(sql, p)];
}

test("content/welcome-video metadata tells staff whether a video is mapped, whether its bytes are in the store, and mints a short-lived signed link without a storage key", async () => {
  assert.equal(ROUTES["content/welcome-video"], welcomeVideo);
  const store = storeFromEnv();
  const key = await store.provider.put("fin-b24/welcome/present.mp4", Buffer.from("fake video bytes"), { contentType: "video/mp4" });
  const rows = [{ id: VIDEO_ID, org_id: ORG_ID, storage_key: key, mime_type: "video/mp4", byte_size: 16 }];
  const done = await hit(welcomeVideo, { role: "closer", query: { client_id: CLIENT_ID }, rules: [...videoRules(), storageRule(rows)] });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.reason, null, "mapped and the bytes are there");
  assert.equal(done.body.video.id, VIDEO_ID);
  assert.equal(done.body.video.title, "Welcome to Fundhub");
  assert.equal(done.body.video.matched, "default");
  assert.equal(done.body.video.byte_size, 5000000);
  assert.equal(done.body.tier_reason, "no_tier_rule_in_code");
  const url = new URL(done.body.video.stream.url, "https://fundhub.test");
  assert.equal(url.pathname, "/api/content/welcome-video");
  assert.equal(url.searchParams.get("id"), VIDEO_ID);
  const check = verifyDocumentUrl({ documentId: VIDEO_ID, versionId: null, expiresAt: url.searchParams.get("exp"), sig: url.searchParams.get("sig") });
  assert.equal(check.valid, true, "the signature is real and checks out");
  assert.equal(JSON.stringify(done.body).includes(key), false, "the storage key never leaves the server");
  assert.equal(JSON.stringify(done.body).includes("storage_key"), false);
  const [tier] = sqlCalls(done, /FROM content_tier_map m/);
  assert.deepEqual(tier.params, [ORG_ID, ["default"]], "this company's map only, asking for the default");

  // A row whose bytes are gone: no link is minted, and the reason says so.
  const gone = await hit(welcomeVideo, {
    rules: [...videoRules(), storageRule([{ id: VIDEO_ID, org_id: ORG_ID, storage_key: "memory://fin-b24/never-saved.mp4", mime_type: "video/mp4", byte_size: 1 }])],
  });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.video, null);
  assert.equal(gone.body.reason, "video_file_missing");

  // Nobody has mapped a video: an honest 200, not a 404.
  const none = await hit(welcomeVideo, { rules: [...videoRules({ mapped: false })] });
  assert.equal(none.status, 200);
  assert.equal(none.body.video, null);
  assert.equal(none.body.reason, "no_video_mapped");
  assert.equal(none.body.ok, true);

  const bad = await hit(welcomeVideo, { query: { client_id: "not-a-uuid" }, rules: videoRules() });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_client_id");
});

test("content/welcome-video says the file is unverified, with the link minted, when the store cannot be asked, and has no link at all with no signing key", async () => {
  const rows = [{ id: VIDEO_ID, org_id: ORG_ID, storage_key: "memory://whatever.mp4", mime_type: "video/mp4", byte_size: 1 }];
  const realError = console.error;
  console.error = () => {};
  process.env[providerName] = "not-a-real-provider";
  try {
    const unverified = await hit(welcomeVideo, { rules: [...videoRules(), storageRule(rows)] });
    assert.equal(unverified.status, 200);
    assert.equal(unverified.body.reason, "video_file_unverified");
    assert.equal(unverified.body.video.id, VIDEO_ID);
    assert.ok(unverified.body.video.stream.url.startsWith("/api/content/welcome-video?"));
  } finally {
    delete process.env[providerName];
    console.error = realError;
  }
  const keep = process.env[secretName];
  delete process.env[secretName];
  try {
    const noKey = await hit(welcomeVideo, { rules: [...videoRules(), storageRule(rows)] });
    assert.equal(noKey.status, 503);
    assert.equal(noKey.body.error, "not_configured");
    assert.equal(JSON.stringify(noKey.body).includes(secretName), false, "the variable's name is never shown");
  } finally {
    process.env[secretName] = keep;
  }
});

test("content/welcome-video serves a signed-in client the mapped video, and refuses a client login with no client file, a partner login and no login", async () => {
  const store = storeFromEnv();
  const key = await store.provider.put("fin-b24/welcome/client.mp4", Buffer.from("bytes"), { contentType: "video/mp4" });
  const rules = [...videoRules(), storageRule([{ id: VIDEO_ID, org_id: ORG_ID, storage_key: key, mime_type: "video/mp4", byte_size: 5 }])];
  const asClient = await hit(welcomeVideo, {
    account: { kind: "client", clientId: CLIENT_ID }, query: { client_id: "c9999999-0000-4000-8000-000000000009" }, rules,
  });
  assert.equal(asClient.status, 200);
  assert.equal(asClient.body.video.id, VIDEO_ID);
  assert.deepEqual(sqlCalls(asClient, /FROM content_tier_map m/)[0].params, [ORG_ID, ["default"]]);

  const noFile = await hit(welcomeVideo, { account: { kind: "client", clientId: null }, rules });
  assert.equal(noFile.status, 403);
  assert.equal(sqlCalls(noFile, /FROM content_tier_map/).length, 0);

  const partner = await hit(welcomeVideo, { account: { kind: "partner", partnerId: "9a000000-0000-4000-8000-000000000001" }, rules });
  assert.equal(partner.status, 403, "a partner login is not a client or staff login");
  const signedOut = await hit(welcomeVideo, { anonymous: true, rules });
  assert.equal(signedOut.status, 401);
});

test("content/welcome-video streams the bytes with no session when the signature is good, and answers one 404 for a forged, expired or unknown link", async () => {
  const store = storeFromEnv();
  const bytes = Buffer.from("these are the pretend bytes of a video");
  const key = await store.provider.put("fin-b24/welcome/stream.mp4", bytes, { contentType: "video/mp4" });
  const rows = [{ id: VIDEO_ID, org_id: ORG_ID, storage_key: key, mime_type: "video/mp4", byte_size: bytes.length }];
  const minted = await hit(welcomeVideo, { rules: [...videoRules(), storageRule(rows)] });
  const link = new URL(minted.body.video.stream.url, "https://fundhub.test");
  const query = Object.fromEntries(link.searchParams.entries());

  const played = await hit(welcomeVideo, { anonymous: true, query, rules: [storageRule(rows)] });
  assert.equal(played.status, 200);
  assert.deepEqual(Buffer.from(played.body), bytes);
  assert.equal(played.headers["content-type"], "video/mp4");
  assert.equal(played.headers["cache-control"], "private, no-store");
  assert.deepEqual(sqlCalls(played, /FROM content_videos/)[0].params, [VIDEO_ID], "no session, so the lookup is by id and signature only");

  const head = await hit(welcomeVideo, { anonymous: true, method: "HEAD", query, rules: [storageRule(rows)] });
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-type"], "video/mp4");
  assert.equal(head.body, "", "a HEAD answers with no bytes");

  // A key that is itself a public address is handed to the player as a redirect, never in a JSON body.
  const hosted = [{ id: VIDEO_ID, org_id: ORG_ID, storage_key: "https://blob.example.test/welcome.mp4", mime_type: "video/mp4", byte_size: 10 }];
  const redirected = await hit(welcomeVideo, { anonymous: true, query, rules: [storageRule(hosted)] });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.location, "https://blob.example.test/welcome.mp4");
  assert.equal(redirected.body, "");

  const forged = await hit(welcomeVideo, { anonymous: true, query: { ...query, sig: "0".repeat(query.sig.length) }, rules: [storageRule(rows)] });
  assert.equal(forged.status, 404);
  const expired = await hit(welcomeVideo, { anonymous: true, query: { ...query, exp: "1" }, rules: [storageRule(rows)] });
  assert.equal(expired.status, 404);
  assert.equal(sqlCalls(forged, /FROM content_videos/).length, 0, "a bad signature never reaches the database");
  const notUuid = await hit(welcomeVideo, { anonymous: true, query: { ...query, id: "nope" }, rules: [storageRule(rows)] });
  assert.equal(notUuid.status, 404);
  const unknown = await hit(welcomeVideo, { anonymous: true, query, rules: [] });
  assert.equal(unknown.status, 404, "a signed link to a video with no row is the same 404");

  const bodyOf = (out) => JSON.stringify(out.body);
  assert.equal(bodyOf(forged), bodyOf(expired));
  const post = await hit(welcomeVideo, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
});

test("content/welcome-video lets in every staff role for the preview and refuses a partner or client login posing as staff", async () => {
  await assertRoleGate(welcomeVideo, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], { rules: videoRules() });
});

/* ── documents-download: a fresh signed link for a saved document ────────── */

const DOC = "d1000000-0000-4000-8000-0000000000d1";
const OTHER_DOC = "d2000000-0000-4000-8000-0000000000d2";
const FOREIGN_DOC = "d3000000-0000-4000-8000-0000000000d3";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const FOREIGN_CLIENT = "c3000000-0000-4000-8000-000000000003";
const VERSION = "e1000000-0000-4000-8000-0000000000e1";

const docRow = (over = {}) => ({
  id: DOC, org_id: ORG_ID, client_id: CLIENT_ID, title: "Credit analysis", document_key: "credit-analysis",
  kind: "deliverable", subtype: "credit_analysis_report", mime_type: "application/pdf", byte_size: 1234,
  current_version: 2, current_version_id: VERSION, expires_at: null, storage_key: "secret/object/key", ...over,
});
const shelfOfDocs = (over = {}) => [
  docRow(over),
  docRow({ id: OTHER_DOC, client_id: OTHER_CLIENT, title: "Other client's report" }),
  docRow({ id: FOREIGN_DOC, org_id: OTHER_ORG_ID, client_id: FOREIGN_CLIENT, title: "Other company's report" }),
];

test("documents-download mints a fresh signed link for a saved document of the caller's own company, with no storage key, and one 404 for every refusal", async () => {
  assert.equal(ROUTES["documents-download"], documentsDownload);
  const rules = (docs) => tableRules("documents", docs);

  const staff = await hit(documentsDownload, { role: "csm", query: { id: DOC }, rules: rules(shelfOfDocs()) });
  assert.equal(staff.status, 200);
  assert.equal(staff.body.document.id, DOC);
  assert.equal(staff.body.document.title, "Credit analysis");
  assert.equal(JSON.stringify(staff.body).includes("secret/object/key"), false, "the storage key never leaves the server");
  assert.equal("org_id" in staff.body.document, false, "the answer is an allow-list");
  assert.equal(staff.headers["cache-control"], "private, no-store");
  assert.deepEqual(sqlCalls(staff, /FROM documents d/)[0].params, [DOC, ORG_ID], "the company comes from the sign-in, not the address");
  const url = new URL(staff.body.document.download.path, "https://fundhub.test");
  const check = verifyDocumentUrl({ documentId: DOC, versionId: url.searchParams.get("v"), expiresAt: url.searchParams.get("exp"), sig: url.searchParams.get("sig") });
  assert.equal(check.valid, true);

  // A client opens their own file; another client's file in the same company is a 404.
  const mine = await hit(documentsDownload, { account: { kind: "client", clientId: CLIENT_ID }, query: { id: DOC }, rules: rules(shelfOfDocs()) });
  assert.equal(mine.status, 200);
  const theirs = await hit(documentsDownload, { account: { kind: "client", clientId: OTHER_CLIENT }, query: { id: DOC }, rules: rules(shelfOfDocs()) });
  assert.equal(theirs.status, 404);
  assert.equal(theirs.body.document, undefined);

  // Another company, an expired document and a malformed id: no link.
  const foreign = await hit(documentsDownload, { query: { id: FOREIGN_DOC }, rules: rules(shelfOfDocs()) });
  assert.equal(foreign.status, 404);
  const expired = await hit(documentsDownload, { query: { id: DOC }, rules: rules(shelfOfDocs({ expires_at: "2020-01-01T00:00:00.000Z" })) });
  assert.equal(expired.status, 404);
  const malformed = await hit(documentsDownload, { query: { id: "not-a-uuid" }, rules: rules(shelfOfDocs()) });
  assert.equal(malformed.status, 400);
  assert.equal(JSON.stringify(foreign.body), JSON.stringify(expired.body), "the same 404 whatever the reason");

  const post = await hit(documentsDownload, { method: "POST", query: { id: DOC }, rules: rules(shelfOfDocs()) });
  assert.equal(post.status, 405);
  const signedOut = await hit(documentsDownload, { anonymous: true, query: { id: DOC }, rules: rules(shelfOfDocs()) });
  assert.equal(signedOut.status, 401);
});

test("documents-download lets in every staff role and refuses a partner login before any document is read", async () => {
  await assertRoleGate(documentsDownload, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], {
    query: { id: DOC }, rules: tableRules("documents", shelfOfDocs()),
  });
});
