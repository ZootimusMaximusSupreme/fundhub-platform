// Batch 11, repair cycle 2: the Creative Factory endpoints run for real over stand-in rows.
//
// Practice tests of the product's own code, not live checks. The page tests use a fake server, so they
// cannot see what Approve, Reject, Archive, Enqueue and the brand buttons really write. Here the real
// handler files (api/creative/actions.mjs, api/creative/generate.mjs, api/brand/review.mjs) run through
// the shared handler harness over an in-memory SQLite that holds the real column names
// (fin-b11-handler-kit.mjs). A test writes through the handler and reads what was SAVED, row by row, so a
// handler that touches every creative of the partner, ignores the kind it was asked for, or lets a
// brand skip a state goes red. The live checks' own SQL is run over what was saved to show it reads a
// healthy result as right.
//
// Nothing here reaches a real database, a model or the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import actionsHandler from "../../../../api/creative/actions.mjs";
import generateHandler from "../../../../api/creative/generate.mjs";
import brandReviewHandler from "../../../../api/brand/review.mjs";
import { accountSession, staffSession } from "../../../testing/handler-harness.mjs";
import { FIN_B11_CHECKS, sqlFor } from "./fin-b11-display-contracts.mjs";
import { runShared, standInDatabase } from "./fin-b11-handler-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const STAFF_ID = "5a000000-0000-4000-8000-000000000001";
const P1 = "aa000000-0000-4000-8000-000000000001";
const P2 = "aa000000-0000-4000-8000-000000000002";
const P_OTHER = "aa000000-0000-4000-8000-0000000000ff";
const A = (n) => `cc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACCOUNT = "ac000000-0000-4000-8000-000000000001";
const check = (key) => FIN_B11_CHECKS.find((c) => c.key === key);
const sqlOf = (key) => sqlFor(check(key));

const NO_STAFF = [/FROM live JOIN staff/, []];
const asStaff = (role = "owner", over = {}) => [staffSession({ role, staff_id: STAFF_ID, org_id: ORG, ...over })];
const asAccount = (kind = "partner", partnerId = P1) => [NO_STAFF, ...accountSession({ kind, partnerId, orgId: ORG })];
const snapshot = (database, table) => JSON.stringify(database.rows(table, "ORDER BY id"));
const REASON = { code: "guaranteed-approval", rule_set: "claims", message: "Guaranteed approval cannot be advertised." };

// ── Approve, Reject and Archive: api/creative/actions.mjs ─────────────────────────────────────────

const asset = (n, over = {}) => ({
  id: A(n), org_id: ORG, partner_id: P1, kind: "static", format: "1x1", provider: "static", compliance_state: "blocked",
  blocked_reasons: [REASON], archived_at: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", ...over
});

function creativeBook(rules) {
  const database = standInDatabase(["creative_assets", "partners", "staff"], { rules });
  database.si.insert("partners", { id: P1, org_id: ORG, slug: "alpha", name: "Alpha" });
  database.si.insert("partners", { id: P2, org_id: ORG, slug: "beta", name: "Beta" });
  database.si.insert("staff", { id: STAFF_ID, org_id: ORG, name: "Casey Owner", role: "owner" });
  // Partner one: five creatives, so "the named one" is neither the first nor the last. Partner two holds
  // one of its own, with the same shape.
  database.si.insert("creative_assets", asset(1, { compliance_state: "pending", blocked_reasons: [] }));
  database.si.insert("creative_assets", asset(2));
  database.si.insert("creative_assets", asset(3, { compliance_state: "passed", blocked_reasons: [] }));
  database.si.insert("creative_assets", asset(4, { archived_at: "2026-10-05T00:00:00.000Z", updated_at: "2026-10-05T00:00:00.000Z" }));
  database.si.insert("creative_assets", asset(5, { compliance_state: "approved", blocked_reasons: [] }));
  database.si.insert("creative_assets", asset(6, { partner_id: P2 }));
  return database;
}
const act = (database, body) => runShared(actionsHandler, database, { body });
const byId = (database) => Object.fromEntries(database.rows("creative_assets").map((r) => [r.id, r]));

test("Approve: the named creative is approved and its reasons cleared, and no other creative changes", async () => {
  const database = creativeBook(asStaff());
  const before = byId(database);
  const out = await act(database, { partner_id: P1, asset_id: A(2), action: "approve" });
  assert.equal(out.status, 200);
  assert.equal(out.body.action, "approve");
  assert.equal(out.body.asset.id, A(2));
  assert.equal(out.body.asset.compliance_state, "approved");
  assert.deepEqual(out.body.asset.blocked_reasons, []);

  const after = byId(database);
  assert.equal(after[A(2)].compliance_state, "approved");
  assert.deepEqual(after[A(2)].blocked_reasons, []);
  assert.ok(after[A(2)].updated_at > before[A(2)].updated_at, "the last-changed time moved");
  for (const n of [1, 3, 4, 5, 6]) assert.deepEqual(after[A(n)], before[A(n)], `creative ${n} was not touched`);
  // A write names its partner: the SQL carries both the creative and the partner it was named for.
  const update = database.writes().find((w) => /UPDATE creative_assets/.test(w.sql));
  assert.deepEqual(update.params, [A(2), P1]);
  assert.match(update.sql, /WHERE id = \$1 AND partner_id = \$2/);
  // And the live check reads the result as right.
  assert.deepEqual(database.runCheck(sqlOf("asset-approved"), ORG), { sample_count: 2, bad_count: 0 });
});

test("Approve: an archived creative, another partner's creative and a missing creative are refused and nothing changes", async () => {
  const database = creativeBook(asStaff());
  const before = snapshot(database, "creative_assets");
  const archived = await act(database, { partner_id: P1, asset_id: A(4), action: "approve" });
  assert.equal(archived.status, 400);
  assert.equal(archived.body.error, "archived assets cannot be approved");
  const wrongPartner = await act(database, { partner_id: P1, asset_id: A(6), action: "approve" });
  assert.equal(wrongPartner.status, 404, "partner two's creative is not found under partner one");
  const missing = await act(database, { partner_id: P1, asset_id: A(99), action: "approve" });
  assert.equal(missing.status, 404);
  const noAsset = await act(database, { partner_id: P1, action: "approve" });
  assert.equal(noAsset.status, 400);
  const noPartner = await act(database, { asset_id: A(2), action: "approve" });
  assert.equal(noPartner.status, 400);
  assert.equal(snapshot(database, "creative_assets"), before, "no refused call wrote anything");
  assert.equal(database.writes().length, 0);
});

test("Reject: the named creative is blocked with a reason a person can read, and no other creative changes", async () => {
  const database = creativeBook(asStaff());
  const before = byId(database);
  const out = await act(database, { partner_id: P1, asset_id: A(3), action: "reject" });
  assert.equal(out.status, 200);
  const after = byId(database);
  assert.equal(after[A(3)].compliance_state, "blocked");
  assert.deepEqual(after[A(3)].blocked_reasons, [{ code: "human_reject", rule_set: "approval", message: "Rejected by reviewer" }]);
  assert.ok(after[A(3)].updated_at > before[A(3)].updated_at);
  for (const n of [1, 2, 4, 5, 6]) assert.deepEqual(after[A(n)], before[A(n)], `creative ${n} was not touched`);
  // Blocked creatives in this book: the one already blocked, the archived one, partner two's, and this one.
  assert.deepEqual(database.runCheck(sqlOf("asset-rejected"), ORG), { sample_count: 4, bad_count: 0 });
  // A reason the caller typed is kept as the message.
  const typed = await act(database, { partner_id: P1, asset_id: A(1), action: "reject", reason: "Makes an income claim" });
  assert.equal(typed.status, 200);
  assert.deepEqual(byId(database)[A(1)].blocked_reasons, [{ code: "human_reject", rule_set: "approval", message: "Makes an income claim" }]);
  // An archived creative is not blocked: Reject leaves it as it was.
  const archived = await act(database, { partner_id: P1, asset_id: A(4), action: "reject" });
  assert.equal(archived.status, 200);
  assert.equal(byId(database)[A(4)].compliance_state, "blocked", "it was already blocked and archived");
  assert.equal(byId(database)[A(4)].updated_at, before[A(4)].updated_at, "an archived creative is not rejected again");
});

test("Archive: the named creative is hidden at one moment, and no other creative changes", async () => {
  const database = creativeBook(asStaff());
  const before = byId(database);
  const out = await act(database, { partner_id: P1, asset_id: A(3), action: "archive" });
  assert.equal(out.status, 200);
  assert.ok(out.body.asset.archived_at, "the answer carries the archive time");
  const after = byId(database);
  assert.ok(after[A(3)].archived_at, "the creative is archived");
  assert.equal(after[A(3)].archived_at, after[A(3)].updated_at, "archived and changed in one statement");
  assert.equal(after[A(3)].compliance_state, "passed", "its review state is untouched");
  for (const n of [1, 2, 4, 5, 6]) assert.deepEqual(after[A(n)], before[A(n)], `creative ${n} was not touched`);
  assert.deepEqual(database.runCheck(sqlOf("asset-archived"), ORG), { sample_count: 2, bad_count: 0 });

  // A second archive of the same creative changes nothing: the first archive time stands.
  const again = await act(database, { partner_id: P1, asset_id: A(3), action: "archive" });
  assert.equal(again.status, 200);
  assert.equal(byId(database)[A(3)].archived_at, after[A(3)].archived_at);
  // The live check reads two archives by two clicks as right, and a bulk archive as wrong.
  await act(database, { partner_id: P1, asset_id: A(1), action: "archive" });
  assert.deepEqual(database.runCheck(sqlOf("asset-archived"), ORG), { sample_count: 3, bad_count: 0 });
  database.si.db.prepare("UPDATE creative_assets SET archived_at = (SELECT archived_at FROM creative_assets WHERE id = ?1), updated_at = (SELECT archived_at FROM creative_assets WHERE id = ?1) WHERE id = ?2").run(A(1), A(2));
  assert.deepEqual(database.runCheck(sqlOf("asset-archived"), ORG), { sample_count: 4, bad_count: 2 }, "two creatives archived at one instant are both wrong");
});

test("the creative actions gate: an unknown action, a client, an affiliate and another company are refused before any write", async () => {
  const unknown = await act(creativeBook(asStaff()), { partner_id: P1, asset_id: A(2), action: "delete" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_action");
  for (const kind of ["client", "affiliate"]) {
    const database = creativeBook(asAccount(kind));
    const out = await act(database, { partner_id: P1, asset_id: A(2), action: "approve" });
    assert.equal(out.status, 403, `${kind} account`);
    assert.equal(database.writes().length, 0);
  }
  // A partner signed in as partner one acts on partner one, whatever partner_id the body says.
  const database = creativeBook(asAccount("partner", P1));
  const named = await act(database, { partner_id: P2, asset_id: A(6), action: "approve" });
  assert.equal(named.status, 404, "partner two's creative is not reachable by partner one, even when the body names partner two");
  const own = await act(database, { partner_id: P2, asset_id: A(2), action: "approve" });
  assert.equal(own.status, 200);
  assert.equal(byId(database)[A(2)].compliance_state, "approved");
  assert.equal(byId(database)[A(6)].compliance_state, "blocked");
});

// ── Enqueue: api/creative/generate.mjs ────────────────────────────────────────────────────────────

function generateBook(rules, { enabled = true, providers = [] } = {}) {
  const database = standInDatabase(["generation_jobs", "partner_module_settings", "partners", "staff", "accounts", "creative_providers", "ad_scripts", "brand_kits"],
    { rules, unique: { generation_jobs: ["partner_id", "idempotency_key"] } });
  const { si } = database;
  si.insert("partners", { id: P1, org_id: ORG, slug: "alpha", name: "Alpha" });
  si.insert("partners", { id: P2, org_id: ORG, slug: "beta", name: "Beta" });
  si.insert("staff", { id: STAFF_ID, org_id: ORG, name: "Casey Owner", role: "owner" });
  si.insert("accounts", { id: ACCOUNT, org_id: ORG, kind: "partner", partner_id: P1, email: "a@example.test", name: "Pat" });
  si.insert("partner_module_settings", { id: A(500), org_id: ORG, partner_id: P1, marketing_suite_enabled: enabled, ai_token_cap_monthly: 250000 });
  si.insert("partner_module_settings", { id: A(501), org_id: ORG, partner_id: P2, marketing_suite_enabled: false, ai_token_cap_monthly: 250000 });
  si.insert("ad_scripts", { id: A(600), org_id: ORG, partner_id: P1, version: 1, root_script_id: A(600), body: "Banks said no." });
  for (const row of providers) si.insert("creative_providers", { org_id: ORG, active: true, priority: 1, ...row });
  return database;
}
const enqueue = (database, body) => runShared(generateHandler, database, { body });
/** Exactly the request the Enqueue button sends (public/app/creative-factory.html genBtn). */
const formRequest = ({ partner = P1, kind = "static", offer = "funding", prompt = "Working capital for owners…", batch = "oct-batch", scriptId = null } = {}) => ({
  partner_id: partner, asset_kind: kind, idempotency_key: batch, prompt,
  spec: { prompt, formats: ["1x1"], variants: 1, assetKind: kind, offerType: offer, ...(scriptId ? { scriptId } : {}) }
});

test("Enqueue: the saved job carries the kind, the offer, the words, the batch name and the asker the form sent", async () => {
  const database = generateBook(asStaff(), { providers: [{ asset_kind: "copy", provider_key: "copy" }] });
  const out = await enqueue(database, formRequest({ kind: "copy", offer: "credit_cards", prompt: "Funding that moves.", batch: "copy-batch", scriptId: A(600) }));
  assert.equal(out.status, 200);
  assert.equal(out.body.created, true);
  assert.equal(out.body.provider_ready, true);
  assert.match(out.body.note, /^Saved to the queue\./);

  const jobs = database.rows("generation_jobs");
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.org_id, ORG);
  assert.equal(job.partner_id, P1);
  assert.equal(job.status, "queued");
  assert.equal(job.idempotency_key, "copy-batch");
  assert.deepEqual(job.spec, { prompt: "Funding that moves.", formats: ["1x1"], variants: 1, assetKind: "copy", offerType: "credit_cards", scriptId: A(600) });
  assert.equal(job.requested_by_kind, "staff", "a job a person pressed names who asked");
  assert.equal(job.requested_by_staff_id, STAFF_ID);
  assert.equal(job.requested_by_account_id, null);
  // The live checks read this job as right.
  assert.deepEqual(database.runCheck(sqlOf("job-enqueued"), ORG), { sample_count: 1, bad_count: 0 });
  assert.deepEqual(database.runCheck(sqlOf("job-form"), ORG), { sample_count: 1, bad_count: 0 });
});

test("Enqueue: a request that names its script and offer outside the spec is folded into the saved spec", async () => {
  const database = generateBook(asStaff());
  const out = await enqueue(database, { partner_id: P1, asset_kind: "static", idempotency_key: "top-level", prompt: "Words", offer_type: "funding", script_id: A(600) });
  assert.equal(out.status, 200);
  const [job] = database.rows("generation_jobs");
  assert.deepEqual(job.spec, { prompt: "Words", formats: ["1x1"], variants: 1, offerType: "funding", scriptId: A(600), assetKind: "static" });
});

test("Enqueue: every kind the picker offers and every offer it offers is saved exactly as asked", async () => {
  const database = generateBook(asStaff());
  let n = 0;
  for (const kind of ["static", "copy", "video"]) {
    for (const offer of ["funding", "credit_cards", "credit_repair"]) {
      n += 1;
      const batch = `batch-${n}`;
      const out = await enqueue(database, formRequest({ kind, offer, batch, prompt: `${kind} for ${offer}` }));
      assert.equal(out.status, 200, `${kind} / ${offer}`);
      const saved = database.rows("generation_jobs", `WHERE idempotency_key = '${batch}'`);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].spec.assetKind, kind, `${kind} / ${offer}: the kind asked for is the kind saved`);
      assert.equal(saved[0].spec.offerType, offer, `${kind} / ${offer}: the offer asked for is the offer saved`);
      assert.equal(saved[0].spec.prompt, `${kind} for ${offer}`);
      assert.deepEqual(saved[0].spec.formats, ["1x1"]);
      assert.equal(saved[0].spec.variants, 1);
    }
  }
  assert.equal(database.rows("generation_jobs").length, 9);
  assert.deepEqual(database.runCheck(sqlOf("job-form"), ORG), { sample_count: 9, bad_count: 0 });
});

test("Enqueue: a partner's own click names their account, and a partner is only ever served for their own partner", async () => {
  const database = generateBook(asAccount("partner", P1));
  const out = await enqueue(database, formRequest({ partner: P2, kind: "static", offer: "funding", batch: "mine" }));
  assert.equal(out.status, 200);
  const [job] = database.rows("generation_jobs");
  assert.equal(job.partner_id, P1, "a partner_id naming another partner is ignored");
  assert.equal(job.requested_by_kind, "partner");
  assert.equal(job.requested_by_account_id, ACCOUNT);
  assert.equal(job.requested_by_staff_id, null);
  assert.deepEqual(database.runCheck(sqlOf("job-enqueued"), ORG), { sample_count: 1, bad_count: 0 });
});

test("Enqueue: the same batch name saves nothing new, a closed suite saves nothing, and an incomplete request saves nothing", async () => {
  const database = generateBook(asStaff());
  assert.equal((await enqueue(database, formRequest({ batch: "same" }))).body.created, true);
  const repeat = await enqueue(database, formRequest({ batch: "same", prompt: "different words" }));
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.created, false, "a repeat of a batch name is a repeat");
  assert.equal(database.rows("generation_jobs").length, 1);
  assert.equal(database.rows("generation_jobs")[0].spec.prompt, "Working capital for owners…", "the first job stands");

  const refused = await enqueue(database, formRequest({ partner: P2, batch: "closed" }));
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "suite_off");

  const noBatch = await enqueue(database, { ...formRequest(), idempotency_key: "" });
  assert.equal(noBatch.status, 400);
  assert.equal(noBatch.body.error, "idempotency_key_required");
  const noOffer = await enqueue(database, { partner_id: P1, asset_kind: "static", idempotency_key: "x", prompt: "p", spec: { prompt: "p", formats: ["1x1"], variants: 1, assetKind: "static" } });
  assert.equal(noOffer.status, 400);
  assert.equal(noOffer.body.error, "offer_type_required");
  const badOffer = await enqueue(database, formRequest({ offer: "crypto", batch: "x2" }));
  assert.equal(badOffer.status, 400);
  assert.equal(badOffer.body.error, "offer_type_invalid");
  const badScript = await enqueue(database, formRequest({ scriptId: "abc123", batch: "x3" }));
  assert.equal(badScript.status, 400);
  assert.equal(badScript.body.error, "script_id_invalid");
  assert.equal(database.rows("generation_jobs").length, 1, "only the one good job was saved");
});

test("Enqueue: the note says whether the job can run, in the server's own words", async () => {
  const none = generateBook(asStaff(), { providers: [] });
  const noService = await enqueue(none, formRequest({ batch: "n1" }));
  assert.equal(noService.body.provider_ready, false);
  assert.match(noService.body.note, /^Saved to the queue, but it cannot run yet: no ad-making service is switched on for this account\./);
  const unknown = generateBook(asStaff(), { providers: [{ asset_kind: "static", provider_key: "mystery" }] });
  const unknownService = await enqueue(unknown, formRequest({ batch: "n2" }));
  assert.equal(unknownService.body.provider_ready, false);
  assert.match(unknownService.body.note, /does not know how to use/);
  const ready = generateBook(asStaff(), { providers: [{ asset_kind: "static", provider_key: "static" }] });
  const ok = await enqueue(ready, formRequest({ batch: "n3" }));
  assert.equal(ok.body.provider_ready, true);
  assert.match(ok.body.note, /^Saved to the queue\. It is picked up within a few minutes/);
});

// ── the brand buttons: api/brand/review.mjs ──────────────────────────────────────────────────────

function brandBook(rules) {
  const database = standInDatabase(["partner_brand", "partners", "staff"], { rules });
  const { si } = database;
  si.insert("partners", { id: P1, org_id: ORG, slug: "alpha", name: "Alpha" });
  si.insert("partners", { id: P2, org_id: ORG, slug: "beta", name: "Beta" });
  si.insert("partners", { id: A(300), org_id: ORG, slug: "gamma", name: "Gamma" });
  si.insert("partners", { id: A(301), org_id: ORG, slug: "delta", name: "Delta" });
  si.insert("partners", { id: P_OTHER, org_id: OTHER_ORG, slug: "far", name: "Far" });
  si.insert("staff", { id: STAFF_ID, org_id: ORG, name: "Casey Owner", role: "owner" });
  const base = { org_id: ORG, entity_name: "Biz LLC", created_at: "2026-10-10T00:00:00.000Z", updated_at: "2026-10-10T00:00:00.000Z" };
  // Partner one waits for review; partner two was sent back and has not been re-sent; gamma is approved.
  si.insert("partner_brand", { id: A(1), partner_id: P1, approval_status: "review", submitted_at: "2026-10-11T00:00:00.000Z", ...base });
  si.insert("partner_brand", { id: A(2), partner_id: P2, approval_status: "draft", submitted_at: "2026-10-09T00:00:00.000Z", review_note: "Use the full business name.", ...base });
  si.insert("partner_brand", { id: A(3), partner_id: A(300), approval_status: "approved", submitted_at: "2026-10-08T00:00:00.000Z", approved_at: "2026-10-09T00:00:00.000Z", approved_by: STAFF_ID, ...base });
  si.insert("partner_brand", { id: A(4), partner_id: A(301), approval_status: "review", submitted_at: "2026-10-11T00:00:00.000Z", ...base });
  si.insert("partner_brand", { id: A(5), partner_id: P_OTHER, org_id: OTHER_ORG, approval_status: "review", submitted_at: "2026-10-11T00:00:00.000Z", entity_name: "Far LLC", created_at: base.created_at, updated_at: base.updated_at });
  return database;
}
const review = (database, body) => runShared(brandReviewHandler, database, { body });
const brand = (database, id) => database.rows("partner_brand", `WHERE id = '${id}'`)[0];

test("Send it back: the brand returns to a draft with its approval cleared and the trimmed reason kept, and only that brand changes", async () => {
  const database = brandBook(asStaff());
  const before = Object.fromEntries(database.rows("partner_brand").map((b) => [b.id, b]));
  const out = await review(database, { partner_id: P1, action: "reject", note: "  Use the full business name.  " });
  assert.equal(out.status, 200);
  assert.equal(out.body.approval_status, "draft");
  const now = brand(database, A(1));
  assert.equal(now.approval_status, "draft");
  assert.equal(now.review_note, "Use the full business name.", "the reason is saved trimmed");
  assert.equal(now.approved_at, null);
  assert.equal(now.approved_by, null);
  for (const n of [2, 3, 4, 5]) assert.deepEqual(brand(database, A(n)), before[A(n)], `brand ${n} was not touched`);
  // The live check reads the sent-back brand (and the one that was already sent back) as right.
  assert.deepEqual(database.runCheck(sqlOf("brand-sent-back"), ORG), { sample_count: 2, bad_count: 0 });
});

test("Send it back: no reason, a reason that is too long, and a brand that is not waiting for review are refused and change nothing", async () => {
  const database = brandBook(asStaff());
  const before = snapshot(database, "partner_brand");
  const none = await review(database, { partner_id: P1, action: "reject", note: "   " });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "note_required");
  const long = await review(database, { partner_id: P1, action: "reject", note: "x".repeat(2001) });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, "note_too_long");
  // A brand that is already approved cannot be sent back from there: the state is guarded.
  const approved = await review(database, { partner_id: A(300), action: "reject", note: "Changed my mind" });
  assert.equal(approved.status, 409);
  assert.equal(approved.body.error, "wrong_state");
  assert.equal(approved.body.approval_status, "approved");
  // A draft that was never re-sent cannot be sent back again.
  const draft = await review(database, { partner_id: P2, action: "reject", note: "Again" });
  assert.equal(draft.status, 409);
  assert.equal(snapshot(database, "partner_brand"), before, "no refused call wrote anything");
  assert.equal(database.writes().length, 0);
});

test("Approve this brand: the brand waiting for review is approved by the person who pressed it, with the time and no leftover reason", async () => {
  const database = brandBook(asStaff());
  database.si.db.prepare("UPDATE partner_brand SET review_note = 'old complaint' WHERE id = ?").run(A(1));
  const before = Object.fromEntries(database.rows("partner_brand").map((b) => [b.id, b]));
  const out = await review(database, { partner_id: P1, action: "approve" });
  assert.equal(out.status, 200);
  assert.equal(out.body.approval_status, "approved");
  const now = brand(database, A(1));
  assert.equal(now.approval_status, "approved");
  assert.ok(now.approved_at, "the approval time is saved");
  assert.equal(now.approved_by, STAFF_ID, "and who approved it");
  assert.equal(now.review_note, null, "an old reason does not stay on an approval");
  assert.equal(now.submitted_at, before[A(1)].submitted_at, "the time it was sent is kept");
  for (const n of [2, 3, 4, 5]) assert.deepEqual(brand(database, A(n)), before[A(n)], `brand ${n} was not touched`);
  assert.deepEqual(database.runCheck(sqlOf("brand-approved"), ORG), { sample_count: 2, bad_count: 0 });
});

test("Approve this brand: a draft that was sent back and not re-sent, an approved brand and another company's brand are refused", async () => {
  const database = brandBook(asStaff());
  const before = snapshot(database, "partner_brand");
  const sentBack = await review(database, { partner_id: P2, action: "approve" });
  assert.equal(sentBack.status, 409, "a brand that was sent back cannot be approved until it is sent in again");
  assert.equal(sentBack.body.error, "wrong_state");
  assert.equal(sentBack.body.approval_status, "draft");
  const again = await review(database, { partner_id: A(300), action: "approve" });
  assert.equal(again.status, 409);
  assert.equal(again.body.approval_status, "approved");
  const far = await review(database, { partner_id: P_OTHER, action: "approve" });
  assert.equal(far.status, 404, "another company's brand reads as no brand at all");
  assert.equal(far.body.error, "no_brand");
  assert.equal(snapshot(database, "partner_brand"), before);
  assert.equal(database.writes().length, 0);
});

test("the brand buttons are for owner and admin only, and a partner may only send their own in", async () => {
  // An admin may approve; the page draws the buttons for an admin and the server agrees.
  const admin = brandBook(asStaff("admin"));
  assert.equal((await review(admin, { partner_id: P1, action: "approve" })).status, 200);
  assert.equal(brand(admin, A(1)).approval_status, "approved");
  // Every other staff role is refused before a row is read.
  for (const role of ["csm", "closer", "funding_advisor", "sales_manager", "setter", "inquiry_specialist"]) {
    const database = brandBook(asStaff(role));
    const out = await review(database, { partner_id: P1, action: "approve" });
    assert.equal(out.status, 403, role);
    assert.equal(database.writes().length, 0, `${role}: nothing written`);
    assert.equal(brand(database, A(1)).approval_status, "review");
  }
  // A partner signed in cannot approve or send back, whoever's brand it names.
  const partner = brandBook(asAccount("partner", P1));
  for (const action of ["approve", "reject"]) {
    const out = await review(partner, { partner_id: P1, action, note: "x" });
    assert.equal(out.status, 403, action);
  }
  assert.equal(partner.writes().length, 0);
  assert.equal(brand(partner, A(1)).approval_status, "review");
});

// ── the code these checks lean on ─────────────────────────────────────────────────────────────────

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") out.push(...sourceFiles(rel)); continue; }
    if (/\.(mjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name) && !/fin-b11/.test(entry.name)) out.push(rel);
  }
  return out;
}

test("the live checks rest on facts about the code: one writer for each saved result they judge", () => {
  const all = ["src", "api", "netlify", "scripts"].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? sourceFiles(d) : []));
  const text = new Map(all.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
  const filesWith = (re) => all.filter((f) => re.test(text.get(f))).sort();

  // A job is only ever saved by enqueue(), and enqueue() is only called by the endpoint that refuses a
  // caller who is not a signed-in partner or staff member. That is why "a job names nobody as its asker"
  // is a wrong result and not a scheduled batch.
  assert.deepEqual(filesWith(/INSERT\s+INTO\s+generation_jobs/i), ["src/creative/generate.mjs"]);
  assert.deepEqual(filesWith(/\benqueue\s*\(\s*tx\b/).filter((f) => f !== "src/creative/generate.mjs"), ["api/creative/generate.mjs"]);
  assert.match(text.get("api/creative/generate.mjs"), /requirePrincipal\(req, res, \["partner", "staff"\]/);

  // archived_at on a creative is only written by the Archive click; an approval is only written by the
  // Approve click (the video loader inserts one approved row per transaction).
  const archivers = filesWith(/UPDATE\s+creative_assets\s+SET[^;`]*archived_at/i);
  assert.deepEqual(archivers, ["api/creative/actions.mjs"]);
  const approvers = filesWith(/UPDATE\s+creative_assets[^;`]*compliance_state\s*=\s*'approved'/i);
  assert.deepEqual(approvers, ["api/creative/actions.mjs"]);
  const approvedInserts = filesWith(/INSERT\s+INTO\s+creative_assets[\s\S]{0,400}'approved'/i);
  assert.deepEqual(approvedInserts, ["src/marketing/meta-load.mjs"]);
  const loader = text.get("src/marketing/meta-load.mjs");
  const loaderInserts = loader.match(/INSERT\s+INTO\s+creative_assets/gi) || [];
  assert.equal(loaderInserts.length, 1, "the video loader inserts one creative per finishLoad, in its own transaction");
  assert.match(loader, /async finishLoad\([\s\S]*?return staff\(async \(tx\) => \{[\s\S]*?INSERT INTO creative_assets/);

  // partner_brand.approval_status is only moved by api/brand/review.mjs.
  assert.deepEqual(filesWith(/UPDATE\s+partner_brand\s+SET[^;`]*approval_status/i), ["api/brand/review.mjs"]);
});
