// Batch 11: the two list endpoints behind the Company Brain side panel, and the decide path, run for
// real over stand-in rows.
//
// The page tests (fin-b11-company-brain.test.mjs) use a fake server, so they cannot see what the
// endpoints would really send. These tests run the real handler files (api/company-brain/reviews.mjs
// and upload.mjs) with the real list and decide code from src/company-brain/, over an in-memory
// SQLite stand-in that holds the real column names (fin-b11-sql-kit.mjs). Each test is a practice
// test of the product's own SQL text: break a filter in the product and a test here goes red.
//
// No Postgres on this machine: the SQL is turned into SQLite spelling by the kit (casts, now()).
// Nothing here reaches a real database, a model or the network.

import { test } from "node:test";
import assert from "node:assert/strict";

import reviewsHandler from "../../../../api/company-brain/reviews.mjs";
import uploadHandler from "../../../../api/company-brain/upload.mjs";
import { decideClassificationReview } from "../../../company-brain/review.mjs";
import { FIN_B11_CHECKS, sqlFor } from "./fin-b11-display-contracts.mjs";
import { makeStandIn, portableSql, NOW } from "./fin-b11-sql-kit.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_OWNER_ID = "00000000-0000-4000-8000-0000000000a2";
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const TABLES = ["brain_files", "brain_classification_reviews", "brain_chunks", "brain_affiliate_allowlist", "staff"];

/** A stand-in company book plus a db object the product code can call .query() on. */
function world() {
  const si = makeStandIn(TABLES);
  // The product's upsert names (org_id, file_id); the real table has that unique key.
  si.db.exec("CREATE UNIQUE INDEX allowlist_org_file ON brain_affiliate_allowlist (org_id, file_id)");
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push(sql);
      const text = portableSql(sql);
      const stmt = si.db.prepare(text);
      if (/^\s*(select|with)\b/i.test(text)) return { rows: stmt.all(...params) };
      const info = stmt.run(...params);
      return { rows: [], rowCount: Number(info.changes) };
    }
  };
  si.insert("staff", { id: OWNER_ID, org_id: ORG, name: "Casey Owner", role: "owner" });
  si.insert("staff", { id: OTHER_OWNER_ID, org_id: OTHER, name: "Other Owner", role: "owner" });
  return { si, db, calls };
}

const file = (id, over = {}) => ({
  id, org_id: ORG, drive_file_id: `upload:${id}`, name: `${id.slice(-3)}.pdf`, original_name: `${id.slice(-3)}.pdf`,
  mime_type: "application/pdf", web_view_link: null, source: "upload", approval_status: "pending",
  classification_status: "pending", access_tier: "owner", proposed_tier: "staff", size_bytes: 2048,
  uploaded_by: OWNER_ID, created_at: ago(60), updated_at: ago(60), ...over
});
const review = (id, file_id, over = {}) => ({
  id, org_id: ORG, file_id, drive_file_id: "d", proposed_tier: "staff", rationale: "Reads like staff training.",
  status: "pending", kind: "upload", created_at: ago(50), updated_at: ago(50), ...over
});

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}
const asStaff = (staff) => async () => staff;
const OWNER = { id: OWNER_ID, org_id: ORG, role: "owner" };

// ── the owner's waiting list ─────────────────────────────────────────────────

function reviewBook() {
  const w = world();
  const { si } = w;
  // Two reviews waiting for this company's owner: an upload and a Drive file.
  si.insert("brain_files", file(u(1)));
  si.insert("brain_files", file(u(2), { source: "drive", drive_file_id: "1abc", approval_status: "approved", classification_status: "pending", name: "Affiliate guide.pdf", web_view_link: "https://drive.example.test/guide", proposed_tier: "affiliate" }));
  si.insert("brain_classification_reviews", review(u(11), u(1), { created_at: ago(40) }));
  si.insert("brain_classification_reviews", review(u(12), u(2), { kind: "classification", proposed_tier: "affiliate", rationale: "", created_at: ago(30) }));
  // A review the owner already approved, one the system closed by itself, and one waiting for another company.
  si.insert("brain_files", file(u(3), { approval_status: "approved", classification_status: "approved", access_tier: "staff" }));
  si.insert("brain_classification_reviews", review(u(13), u(3), { status: "approved", decided_by: OWNER_ID, decided_at: ago(20), updated_at: ago(20) }));
  si.insert("brain_files", file(u(4)));
  si.insert("brain_classification_reviews", review(u(14), u(4), { status: "rejected", decided_by: null, decided_at: ago(15), updated_at: ago(15) }));
  si.insert("brain_files", file(u(5), { org_id: OTHER }));
  si.insert("brain_classification_reviews", review(u(15), u(5), { org_id: OTHER, created_at: ago(10) }));
  return w;
}

test("the owner's waiting list holds this company's pending reviews and nothing else, oldest first", async () => {
  const { db } = reviewBook();
  const res = mockRes();
  await reviewsHandler({ method: "GET" }, res, { requireAuth: asStaff(OWNER), db });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.reviews.map((r) => r.id), [u(11), u(12)], "only the two pending reviews of this company, oldest first");
  const [upload, drive] = res.body.reviews;
  // Every column the screen reads is on the row, with the words the page paints.
  assert.equal(upload.file_name, "001.pdf");
  assert.equal(upload.proposed_tier, "staff");
  assert.equal(upload.access_tier, "owner");
  assert.equal(upload.rationale, "Reads like staff training.");
  assert.equal(upload.kind, "upload");
  assert.equal(upload.isUpload, true);
  assert.equal(drive.kind, "classification");
  assert.equal(drive.isUpload, false);
  assert.equal(drive.web_view_link, "https://drive.example.test/guide");
  assert.equal(drive.file_name, "Affiliate guide.pdf");
  assert.equal(res.body.uploadCount, 1);
});

test("a decided review never comes back in the owner's waiting list", async () => {
  const { db, si } = reviewBook();
  // Both closed reviews are in the book, and neither is listed (the test above), so deciding the
  // two waiting ones empties the list.
  for (const id of [u(11), u(12)]) {
    si.db.prepare("UPDATE brain_classification_reviews SET status = 'approved' WHERE id = ?").run(id);
  }
  const res = mockRes();
  await reviewsHandler({ method: "GET" }, res, { requireAuth: asStaff(OWNER), db });
  assert.deepEqual(res.body.reviews, []);
  assert.equal(res.body.uploadCount, 0);
});

test("another company's owner sees only that company's waiting reviews", async () => {
  const { db } = reviewBook();
  const res = mockRes();
  await reviewsHandler({ method: "GET" }, res, { requireAuth: asStaff({ id: OTHER_OWNER_ID, org_id: OTHER, role: "owner" }), db });
  assert.deepEqual(res.body.reviews.map((r) => r.id), [u(15)]);
});

test("only an owner reads the waiting list, and the list is not read for anyone else", async () => {
  const { db, calls } = reviewBook();
  for (const role of ["admin", "closer", "csm"]) {
    const res = mockRes();
    await reviewsHandler({ method: "GET" }, res, { requireAuth: asStaff({ id: OWNER_ID, org_id: ORG, role }), db });
    assert.equal(res.statusCode, 403, role);
    assert.equal(res.body.ok, false);
  }
  const noOrg = mockRes();
  await reviewsHandler({ method: "GET" }, noOrg, { requireAuth: asStaff({ id: OWNER_ID, org_id: null, role: "owner" }), db });
  assert.equal(noOrg.statusCode, 403);
  assert.equal(noOrg.body.error, "no_org_scope");
  assert.deepEqual(calls, [], "a refused caller never reaches the database");
});

// ── the Files you added list ────────────────────────────────────────────────

function uploadBook() {
  const w = world();
  const { si } = w;
  si.insert("brain_files", file(u(1), { name: "Refund policy.pdf", approval_status: "pending", created_at: ago(20) }));
  si.insert("brain_files", file(u(2), { name: "Sales script.docx", approval_status: "approved", classification_status: "approved", access_tier: "sales", size_bytes: 2 * 1048576, created_at: ago(5000) }));
  si.insert("brain_files", file(u(3), { name: "Old notes.txt", approval_status: "rejected", classification_status: "rejected", size_bytes: null, uploaded_by: null, created_at: ago(9000) }));
  si.insert("brain_chunks", { id: u(31), org_id: ORG, file_id: u(1), chunk_index: 0, content: "c", access_tier: "owner" });
  si.insert("brain_chunks", { id: u(32), org_id: ORG, file_id: u(1), chunk_index: 1, content: "c", access_tier: "owner" });
  // Not part of this company's list: a Drive file, a pending upload of another company, and another company's approved upload.
  si.insert("brain_files", file(u(4), { source: "drive", drive_file_id: "1drive", name: "Drive SOP.pdf", approval_status: "pending", created_at: ago(10) }));
  si.insert("brain_files", file(u(5), { org_id: OTHER, name: "Other company policy.pdf", approval_status: "pending", created_at: ago(15) }));
  si.insert("brain_files", file(u(6), { org_id: OTHER, name: "Other company approved.pdf", approval_status: "approved", created_at: ago(25) }));
  return w;
}

test("the Files you added list holds this company's uploads, newest first, with who added them", async () => {
  const { db } = uploadBook();
  const res = mockRes();
  await uploadHandler({ method: "GET" }, res, { requireAuth: asStaff(OWNER), db });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.uploads.map((r) => r.id), [u(1), u(2), u(3)], "this company's uploads only, newest first");
  const [pending, approved, rejected] = res.body.uploads;
  assert.equal(pending.name, "Refund policy.pdf");
  assert.equal(pending.approvalStatus, "pending");
  assert.equal(pending.accessTier, "owner");
  assert.equal(pending.sizeBytes, 2048);
  assert.equal(pending.uploadedByName, "Casey Owner");
  assert.equal(pending.chunkCount, 2);
  assert.equal(approved.approvalStatus, "approved");
  assert.equal(approved.accessTier, "sales");
  assert.equal(approved.sizeBytes, 2 * 1048576);
  // Unknown stays unknown: no size and no uploader are null, never 0 or an empty name.
  assert.equal(rejected.sizeBytes, null);
  assert.equal(rejected.uploadedByName, null);
});

test("the waiting count counts this company's waiting uploads and nothing else", async () => {
  const { db, si } = uploadBook();
  const res = mockRes();
  await uploadHandler({ method: "GET" }, res, { requireAuth: asStaff(OWNER), db });
  // One waiting upload of this company. The approved upload, the rejected one, the Drive file that is
  // waiting and the other company's waiting upload are not counted.
  assert.equal(res.body.pendingCount, 1);

  // The count moves with what is waiting: a second waiting upload makes two, an approval takes one away.
  si.insert("brain_files", file(u(7), { name: "Second.pdf", approval_status: "pending", created_at: ago(2) }));
  const two = mockRes();
  await uploadHandler({ method: "GET" }, two, { requireAuth: asStaff(OWNER), db });
  assert.equal(two.body.pendingCount, 2);
  si.db.prepare("UPDATE brain_files SET approval_status = 'approved' WHERE id = ?").run(u(1));
  const one = mockRes();
  await uploadHandler({ method: "GET" }, one, { requireAuth: asStaff(OWNER), db });
  assert.equal(one.body.pendingCount, 1);

  const other = mockRes();
  await uploadHandler({ method: "GET" }, other, { requireAuth: asStaff({ id: OTHER_OWNER_ID, org_id: OTHER, role: "owner" }), db });
  assert.deepEqual(other.body.uploads.map((r) => r.id), [u(5), u(6)]);
  assert.equal(other.body.pendingCount, 1);
});

// ── the decision itself, and the live checks that judge it ──────────────────

test("the decide path saves who decided and when, and the live checks read it as right", async () => {
  const { db, si } = world();
  // An upload proposed at staff, a Drive file proposed at affiliate, and an upload to turn down.
  si.insert("brain_files", file(u(1)));
  si.insert("brain_chunks", { id: u(21), org_id: ORG, file_id: u(1), chunk_index: 0, content: "c", access_tier: "owner" });
  si.insert("brain_classification_reviews", review(u(11), u(1)));
  si.insert("brain_files", file(u(2), { source: "drive", drive_file_id: "1abc", approval_status: "approved", proposed_tier: "affiliate" }));
  si.insert("brain_chunks", { id: u(22), org_id: ORG, file_id: u(2), chunk_index: 0, content: "c", access_tier: "owner" });
  si.insert("brain_classification_reviews", review(u(12), u(2), { kind: "classification", proposed_tier: "affiliate" }));
  si.insert("brain_files", file(u(3)));
  si.insert("brain_chunks", { id: u(23), org_id: ORG, file_id: u(3), chunk_index: 0, content: "c", access_tier: "owner" });
  si.insert("brain_classification_reviews", review(u(13), u(3)));

  const decide = (reviewId, decision) => decideClassificationReview(db, { orgId: ORG, reviewId, role: "owner", decision, decidedBy: OWNER_ID });
  assert.equal((await decide(u(11), "approve")).ok, true);
  assert.equal((await decide(u(12), "approve")).ok, true);
  assert.equal((await decide(u(13), "reject")).ok, true);

  const rows = (sql) => si.db.prepare(sql).all();
  assert.deepEqual(rows("SELECT id, status, decided_by FROM brain_classification_reviews ORDER BY id").map((r) => [r.status, r.decided_by]),
    [["approved", OWNER_ID], ["approved", OWNER_ID], ["rejected", OWNER_ID]]);
  assert.equal(rows("SELECT decided_at FROM brain_classification_reviews WHERE decided_at IS NULL").length, 0);
  assert.deepEqual(rows("SELECT id, approval_status, access_tier FROM brain_files ORDER BY id").map((r) => [r.approval_status, r.access_tier]),
    [["approved", "staff"], ["approved", "affiliate"], ["rejected", "owner"]]);
  assert.equal(rows("SELECT * FROM brain_affiliate_allowlist").length, 1, "the affiliate approval left its allowlist row");

  // The live checks read exactly this as right: two approvals counted, one turn down counted, none wrong.
  const run = (key) => si.run(sqlFor(FIN_B11_CHECKS.find((c) => c.key === key)), ORG);
  assert.deepEqual(run("brain-review-approved"), { sample_count: 2, bad_count: 0 });
  assert.deepEqual(run("brain-review-rejected"), { sample_count: 1, bad_count: 0 });
  assert.deepEqual(run("brain-review-queue"), { sample_count: 0, bad_count: 0 }, "nothing is left waiting");
});

test("a refused or repeated decision changes nothing", async () => {
  const { db, si } = world();
  si.insert("brain_files", file(u(1)));
  si.insert("brain_classification_reviews", review(u(11), u(1)));
  const before = JSON.stringify(si.db.prepare("SELECT * FROM brain_files").all());
  // A role that may not decide, and a review of another company: refused, nothing written.
  assert.deepEqual(await decideClassificationReview(db, { orgId: ORG, reviewId: u(11), role: "admin", decision: "approve", decidedBy: OWNER_ID }), { ok: false, reason: "forbidden_role" });
  assert.deepEqual(await decideClassificationReview(db, { orgId: OTHER, reviewId: u(11), role: "owner", decision: "approve", decidedBy: OTHER_OWNER_ID }), { ok: false, reason: "not_found" });
  assert.equal(JSON.stringify(si.db.prepare("SELECT * FROM brain_files").all()), before);
  // Decided once, a second decision is refused and the first stands.
  assert.equal((await decideClassificationReview(db, { orgId: ORG, reviewId: u(11), role: "owner", decision: "reject", decidedBy: OWNER_ID })).ok, true);
  assert.deepEqual(await decideClassificationReview(db, { orgId: ORG, reviewId: u(11), role: "owner", decision: "approve", decidedBy: OWNER_ID }), { ok: false, reason: "not_pending" });
  assert.equal(si.db.prepare("SELECT approval_status FROM brain_files WHERE id = ?").get(u(1)).approval_status, "rejected");
});
