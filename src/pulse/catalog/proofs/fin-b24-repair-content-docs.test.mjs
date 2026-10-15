// Batch 24, repair cycle 1: content/tiles, content/welcome-video and
// documents-download.
//
// An independent checker found these stayed green when the product broke:
//   * content/tiles: the body's ok:true (the screen shows "Content could not be
//     read" without it), a video whose size is unknown turning into 0, and a
//     company taken from the address.
//   * content/welcome-video: "short-lived" was never judged (a seven-day link
//     stayed green), a map row could point at another company's video, a size
//     that is unknown turned into 0, and a company in the address was not tried.
//   * documents-download: a partner or affiliate login was never tried (only
//     staff role words were), a document with no client was open to any client of
//     the company, and the answer's allow-list was only judged against a row with
//     none of the sensitive columns.
//
// The real api/ handlers and the in-memory file store. A stand-in table keeps a
// row only while the statement's text carries that row's condition. This is a
// PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";

import contentTiles from "../../../../api/content/tiles.mjs";
import documentsDownload from "../../../../api/documents-download.mjs";
import welcomeVideo from "../../../../api/content/welcome-video.mjs";
import { storeFromEnv } from "../../../documents/store.mjs";
import { tableRules } from "../../../testing/s3-scoped-rows.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";

const VIDEO_ID = "0d000000-0000-4000-8000-000000000001";
const FOREIGN_VIDEO_ID = "0d000000-0000-4000-8000-0000000000ff";
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const NOW_ISO = "2026-10-13T12:00:00.000Z";
// A request that tries to name a company, in the address.
const HOSTILE = { org_id: OTHER_ORG_ID };

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

/* ── content/tiles ───────────────────────────────────────────────────────── */

test("content/tiles answers ok:true with a video whose size is not known as unknown, and reads the sign-in's company whatever the address says", async () => {
  const company = clause(/WHERE\s+org_id = \$1::uuid/, (row, p) => row.org_id === p[0]);
  const rules = [
    [/FROM entitlement_catalog\s+WHERE org_id = \$1::uuid AND display_price_cents IS NOT NULL/, (sql, p) => shelf([
      { org_id: ORG_ID, code: "metro2-letter-pack", display_price_cents: "29700" },
      { org_id: OTHER_ORG_ID, code: "their-tile", display_price_cents: "100" },
    ], [company])(sql, p)],
    [/FROM entitlement_catalog\s+WHERE org_id = \$1::uuid\s+ORDER BY sort_order, code/, (sql, p) => shelf([
      { org_id: ORG_ID, code: "metro2-letter-pack", name: "Metro 2 Dispute Letter Pack", description: "", active: true, sort_order: 50 },
      { org_id: OTHER_ORG_ID, code: "their-tile", name: "Their tile", description: "", active: true, sort_order: 1 },
    ], [company])(sql, p)],
    [/FROM content_videos\s+WHERE org_id = \$1::uuid/, (sql, p) => shelf([
      { org_id: ORG_ID, id: VIDEO_ID, title: "Welcome", duration_label: "2:10", mime_type: "video/mp4", byte_size: null, uploaded_by: null, created_at: NOW_ISO },
      { org_id: ORG_ID, id: "0d000000-0000-4000-8000-000000000002", title: "Sized", duration_label: "", mime_type: null, byte_size: "5000000", uploaded_by: "Olive", created_at: NOW_ISO },
      { org_id: OTHER_ORG_ID, id: FOREIGN_VIDEO_ID, title: "Theirs", duration_label: "", mime_type: "video/mp4", byte_size: "1", uploaded_by: "x", created_at: NOW_ISO },
    ], [company])(sql, p)],
    [/FROM content_tier_map WHERE org_id = \$1::uuid/, (sql, p) => shelf([
      { org_id: ORG_ID, tier_code: "default", video_id: VIDEO_ID },
      { org_id: OTHER_ORG_ID, tier_code: "default", video_id: FOREIGN_VIDEO_ID },
    ], [clause(/WHERE org_id = \$1::uuid/, (row, p2) => row.org_id === p2[0])])(sql, p)],
    [/FROM products\s+WHERE org_id = \$1::uuid AND active = true/, []],
  ];
  const done = await hit(contentTiles, { role: "admin", query: HOSTILE, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true, "the Content screen shows 'Content could not be read' without ok:true");
  assert.deepEqual(done.body.tiles.map((t) => [t.code, t.price_cents]), [["metro2-letter-pack", 29700]], "this company's tiles only");
  assert.deepEqual(done.body.videos.map((v) => [v.title, v.byte_size]), [["Welcome", null], ["Sized", 5000000]], "a size nobody saved is unknown, never 0");
  assert.deepEqual(done.body.map, { default: VIDEO_ID });
  for (const pattern of [/FROM entitlement_catalog\s+WHERE org_id/, /FROM content_videos/, /FROM content_tier_map/, /FROM products/]) {
    for (const call of sqlCalls(done, pattern)) assert.deepEqual(call.params, [ORG_ID], `${pattern}: the company is the sign-in's`);
  }
});

/* ── content/welcome-video ───────────────────────────────────────────────── */

function videoRules(rows) {
  return [
    [/FROM content_tier_map m\s+JOIN content_videos v/, (sql, p) => shelf(rows, [
      clause(/WHERE m\.org_id = \$1::uuid AND m\.tier_code = ANY\(\$2::text\[\]\)/, (row, params) => row.org_id === params[0] && params[1].includes(row.tier_code)),
      // The join must carry the company on the video side too: a map row can never reach across companies.
      clause(/ON v\.id = m\.video_id AND v\.org_id = m\.org_id/, (row) => row.video_org_id === row.org_id),
    ])(sql, p)],
  ];
}
const mapRow = (over = {}) => ({
  tier_code: "default", id: VIDEO_ID, org_id: ORG_ID, video_org_id: ORG_ID, title: "Welcome to Fundhub",
  duration_label: "2:10", mime_type: "video/mp4", byte_size: "5000000", created_at: NOW_ISO, ...over,
});

test("content/welcome-video mints a link that lives fifteen minutes at most, for the mapped video of the sign-in's company, and a size nobody saved is unknown", async () => {
  const store = storeFromEnv();
  const key = await store.provider.put("fin-b24/welcome/repair.mp4", Buffer.from("fake video bytes"), { contentType: "video/mp4" });
  const files = [{ id: VIDEO_ID, org_id: ORG_ID, storage_key: key, mime_type: "video/mp4", byte_size: 16 }];
  const storage = [/SELECT id, storage_key, mime_type, byte_size\s+FROM content_videos/, (sql, p) => shelf(files, [
    clause(/WHERE id = \$1::uuid AND org_id = \$2::uuid/, (row, params) => row.id === params[0] && row.org_id === params[1]),
  ])(sql, p)];

  const before = Math.floor(Date.now() / 1000);
  const done = await hit(welcomeVideo, {
    role: "closer", query: { client_id: CLIENT_ID, ...HOSTILE },
    rules: [...videoRules([mapRow({ byte_size: null })]), storage],
  });
  const after = Math.floor(Date.now() / 1000);
  assert.equal(done.status, 200);
  assert.equal(done.body.video.id, VIDEO_ID);
  assert.equal(done.body.video.byte_size, null, "a size nobody saved is unknown, never 0");
  const exp = Number(new URL(done.body.video.stream.url, "https://fundhub.test").searchParams.get("exp"));
  assert.ok(exp >= before, "the link is not already out of date");
  assert.ok(exp <= after + 900, `the link lives ${exp - after} seconds; short-lived means fifteen minutes (900) at most`);
  assert.deepEqual(sqlCalls(done, /FROM content_tier_map m/)[0].params, [ORG_ID, ["default"]], "the company is the sign-in's, not the address's");

  // The client's own login answers the same, whatever company or client the address names.
  const asClient = await hit(welcomeVideo, {
    account: { kind: "client", clientId: CLIENT_ID }, query: { client_id: "c9999999-0000-4000-8000-000000000009", ...HOSTILE },
    rules: [...videoRules([mapRow()]), storage],
  });
  assert.equal(asClient.status, 200);
  assert.deepEqual(sqlCalls(asClient, /FROM content_tier_map m/)[0].params, [ORG_ID, ["default"]]);
  assert.equal(sqlCalls(asClient, /FROM clients/).length, 0, "today no rule reads the client, so which client is named changes nothing; the day one does, this must be re-judged");
});

test("content/welcome-video never offers a video another company owns, even when this company's map row points at it", async () => {
  const crossed = mapRow({ id: FOREIGN_VIDEO_ID, video_org_id: OTHER_ORG_ID, title: "Their welcome" });
  const done = await hit(welcomeVideo, { query: HOSTILE, rules: videoRules([crossed]) });
  assert.equal(done.status, 200);
  assert.equal(done.body.video, null);
  assert.equal(done.body.reason, "no_video_mapped");
  assert.equal(JSON.stringify(done.body).includes("Their welcome"), false);
});

/* ── documents-download ──────────────────────────────────────────────────── */

const DOC = "d1000000-0000-4000-8000-0000000000d1";
const NO_CLIENT_DOC = "d4000000-0000-4000-8000-0000000000d4";
const VERSION = "e1000000-0000-4000-8000-0000000000e1";
const docRow = (over = {}) => ({
  id: DOC, org_id: ORG_ID, client_id: CLIENT_ID, title: "Credit analysis", document_key: "credit-analysis",
  kind: "deliverable", subtype: "credit_analysis_report", invoice_id: null, mime_type: "application/pdf", byte_size: 1234,
  current_version: 2, current_version_id: VERSION, expires_at: null, storage_key: "secret/object/key",
  // The registry's other columns: none of them is part of the answer.
  checksum: "sha256-abc", generated_by: "agent-7", generated_at: NOW_ISO, delivered_at: NOW_ISO, delivery_channel: "email",
  delivery_status: "sent", signature_required: true, signed_at: NOW_ISO, signer_name: "Dana Whitfield", signature_ref: "sig-ref-1",
  metadata: { uploaded_by: { id: "5a000000-0000-4000-8000-000000000001" }, original_name: "dana.pdf" }, created_at: NOW_ISO, updated_at: NOW_ISO,
  ...over,
});

test("documents-download answers exactly the allow-listed fields, never the registry's other columns", async () => {
  const done = await hit(documentsDownload, { role: "admin", query: { id: DOC, ...HOSTILE }, rules: tableRules("documents", [docRow()]) });
  assert.equal(done.status, 200);
  assert.deepEqual(Object.keys(done.body.document).sort(), [
    "byte_size", "client_id", "current_version", "document_key", "download", "id", "kind", "mime_type", "subtype", "title",
  ], "an allow-list: a column added to the registry does not start reaching a browser");
  const wire = JSON.stringify(done.body);
  for (const hidden of ["metadata", "checksum", "signature_ref", "signer_name", "generated_by", "org_id", "storage_key", "secret/object/key", "dana.pdf", "5a000000"]) {
    assert.equal(wire.includes(hidden), false, `${hidden} never reaches the browser`);
  }
  assert.deepEqual(sqlCalls(done, /FROM documents d/)[0].params, [DOC, ORG_ID], "the company is the sign-in's, not the address's");
  // Short-lived: the link carries its own expiry.
  const url = new URL(done.body.document.download.path, "https://fundhub.test");
  const ttl = Number(url.searchParams.get("exp")) - Math.floor(Date.now() / 1000);
  assert.ok(ttl > 0 && ttl <= 900, `the link lives ${ttl} seconds; fifteen minutes (900) at most`);
});

test("documents-download refuses a partner or affiliate login before any document is read, and a document with no client file is not any client's to open", async () => {
  const rules = tableRules("documents", [docRow(), docRow({ id: NO_CLIENT_DOC, client_id: null, title: "Company handbook" })]);

  for (const account of [{ kind: "partner", partnerId: "9a000000-0000-4000-8000-000000000001" }, { kind: "affiliate" }]) {
    const out = await hit(documentsDownload, { account, query: { id: DOC }, rules });
    assert.ok([401, 403].includes(out.status), `${account.kind}: refused, got ${out.status}`);
    assert.equal(out.body.document, undefined);
    assert.equal(sqlCalls(out, /FROM documents d/).length, 0, `${account.kind}: nothing was read`);
  }

  // A client reaches their own file. A file with no client on it belongs to the company, not to a client.
  const mine = await hit(documentsDownload, { account: { kind: "client", clientId: CLIENT_ID }, query: { id: DOC }, rules });
  assert.equal(mine.status, 200);
  const open = await hit(documentsDownload, { account: { kind: "client", clientId: CLIENT_ID }, query: { id: NO_CLIENT_DOC }, rules });
  assert.equal(open.status, 404, "a client-less document is not open to a client");
  assert.equal(open.body.document, undefined);
  // Staff of the same company still open it.
  const staff = await hit(documentsDownload, { role: "csm", query: { id: NO_CLIENT_DOC }, rules });
  assert.equal(staff.status, 200);
});
