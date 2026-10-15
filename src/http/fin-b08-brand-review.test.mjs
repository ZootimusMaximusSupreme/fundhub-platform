// finish-853 batch 08: POST /api/brand/review. The real handler runs against a stand-in
// partner_brand table that keeps a row only while the SQL text carries that row's condition
// (partner, company, state). The row's words: submit / approve / reject move a partner's brand
// through review; approve and reject are owner/admin only; it is the only writer of
// approval_status. Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/brand/review.mjs";
import { staffSession, accountSession, req, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules } from "../testing/s3-scoped-rows.mjs";
import { runUpdate } from "../testing/fin-b08-tables.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const PARTNER = "d1000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "d2000000-0000-4000-8000-000000000002";
const STAMP = "2026-10-14T12:00:00.000Z";

function brands(over = {}) {
  return [
    { partner_id: PARTNER, org_id: ORG_ID, approval_status: "draft", approved_at: null, approved_by: null, submitted_at: null, submitted_by: null, review_note: "old note", ...over },
    { partner_id: OTHER_PARTNER, org_id: OTHER_ORG_ID, approval_status: "review", approved_at: null, approved_by: null, submitted_at: STAMP, submitted_by: null, review_note: null },
  ];
}

/** Migration 043's CHECK: a brand is approved exactly when it has an approved_at. */
function assertCoupling(row) {
  if ((row.approval_status === "approved") !== (row.approved_at !== null && row.approved_at !== undefined)) {
    throw Object.assign(new Error('new row for relation "partner_brand" violates check constraint "partner_brand_approval_coupling_ck"'), { code: "23514" });
  }
}

/**
 * The partner_brand table as the product's own SQL drives it: the statement's WHERE keeps the rows
 * (partner, company, state) and its SET list is applied as written (runUpdate reads it; a column it
 * cannot read throws). Nothing here stamps a column on the product's behalf. After the write the
 * table's CHECK runs, and the columns the statement's RETURNING names are what comes back.
 */
function brandRules(rows, { beforeUpdate = null } = {}) {
  const selectRule = tableRules("partner_brand", rows)[2]; // [delete, update, select]
  return [
    [(sql) => /^\s*UPDATE\s+partner_brand\b/i.test(sql), (sql, params) => {
      if (beforeUpdate) beforeUpdate(rows);
      const { hit, returning } = runUpdate(rows, sql, params);
      for (const row of hit) assertCoupling(row);
      const project = (row) => (returning ? Object.fromEntries(returning.map((c) => [c, row[c]])) : { ...row });
      return { rows: hit.map(project), rowCount: hit.length };
    }],
    selectRule,
  ];
}

const asStaff = (role = "owner", orgId = ORG_ID) => [staffSession({ role, org_id: orgId })];
const asPartner = (partnerId = PARTNER) => accountSession({ kind: "partner", partnerId, orgId: ORG_ID });
const post = (body, who, rows) => callShared(handler, req("POST", { body }), [...who, ...brandRules(rows)]);
const mine = (rows) => rows.find((r) => r.partner_id === PARTNER);
const theirs = (rows) => rows.find((r) => r.partner_id === OTHER_PARTNER);

describe("POST /api/brand/review", () => {
  test("an owner submits a draft: it goes to review, who sent it is stamped, and the old reviewer note is cleared", async () => {
    const rows = brands();
    const { res } = await post({ partner_id: PARTNER, action: "submit" }, asStaff("owner"), rows);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.approval_status, "review");
    assert.equal(res.body.review_note, null);
    assert.equal(mine(rows).approval_status, "review");
    assert.equal(mine(rows).submitted_by, STAFF_ID);
    assert.ok(mine(rows).submitted_at, "the time it was sent is saved by the statement itself");
    assert.ok(res.body.submitted_at, "and the answer carries it");
    assert.equal(res.body.approved_at, null);
    assert.equal(mine(rows).review_note, null);
    assert.equal(mine(rows).approved_at, null, "approval and its time move together: not approved");
  });

  test("approve moves a brand in review to approved and stamps the approver; reject needs a reason and sends it back to draft", async () => {
    const approveRows = brands({ approval_status: "review" });
    const approved = await post({ partner_id: PARTNER, action: "approve" }, asStaff("admin"), approveRows);
    assert.equal(approved.res.statusCode, 200);
    assert.equal(approved.res.body.approval_status, "approved");
    assert.equal(mine(approveRows).approved_by, STAFF_ID);
    assert.ok(mine(approveRows).approved_at, "the approval time is written by the statement (the table's CHECK refuses an approval without it)");
    assert.ok(approved.res.body.approved_at, "and the answer carries it");
    assert.equal(mine(approveRows).review_note, null, "an approval carries no reviewer complaint");
    assert.equal(approved.res.body.review_note, null);

    const rejectRows = brands({ approval_status: "review", approved_at: null });
    const noReason = await post({ partner_id: PARTNER, action: "reject" }, asStaff("owner"), rejectRows);
    assert.equal(noReason.res.statusCode, 400);
    assert.equal(noReason.res.body.error, "note_required");
    assert.equal(mine(rejectRows).approval_status, "review", "nothing moved without a reason");

    const rejected = await post({ partner_id: PARTNER, action: "reject", note: "  Logo is blurry  " }, asStaff("owner"), rejectRows);
    assert.equal(rejected.res.statusCode, 200);
    assert.equal(rejected.res.body.approval_status, "draft");
    assert.equal(rejected.res.body.review_note, "Logo is blurry");
    assert.equal(mine(rejectRows).approval_status, "draft");
    assert.equal(mine(rejectRows).approved_at, null);
    assert.equal(mine(rejectRows).approved_by, null);
  });

  test("a reject clears a stale approver and an approve clears the old reviewer note; the answer says what was saved", async () => {
    const stale = brands({ approval_status: "review", approved_by: "00000000-0000-4000-8000-0000000000aa" });
    const rejected = await post({ partner_id: PARTNER, action: "reject", note: "Fix the logo" }, asStaff("owner"), stale);
    assert.equal(rejected.res.statusCode, 200);
    assert.equal(mine(stale).approved_by, null, "the approval columns go with the approval");
    assert.equal(mine(stale).approved_at, null);
    assert.equal(mine(stale).review_note, "Fix the logo");

    const withNote = brands({ approval_status: "review", review_note: "an old complaint" });
    const approved = await post({ partner_id: PARTNER, action: "approve" }, asStaff("admin"), withNote);
    assert.equal(approved.res.statusCode, 200);
    assert.equal(mine(withNote).review_note, null);
    assert.equal(approved.res.body.review_note, null);
    assert.equal(approved.res.body.partner_id, PARTNER);
    assert.equal(approved.res.body.action, "approve");
  });

  test("the approver and the sender come off the sign-in, never off the body", async () => {
    const hostile = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const rows = brands({ approval_status: "review" });
    const approved = await post({ partner_id: PARTNER, action: "approve", staff_id: hostile, staffId: hostile, approved_by: hostile }, asStaff("owner"), rows);
    assert.equal(approved.res.statusCode, 200);
    assert.equal(mine(rows).approved_by, STAFF_ID);
    const draft = brands();
    const submitted = await post({ partner_id: PARTNER, action: "submit", staff_id: hostile, staffId: hostile, submitted_by: hostile }, asStaff("owner"), draft);
    assert.equal(submitted.res.statusCode, 200);
    assert.equal(mine(draft).submitted_by, STAFF_ID);
  });

  test("someone moving the brand between the read and the write is a 409 and their change is not overwritten", async () => {
    // Each case: the row is in the state the action needs when it is read, and another person moves it
    // to `then` before the statement runs. The statement's own state condition has to stop the write.
    const cases = [
      { action: "submit", from: "draft", then: { approval_status: "review", submitted_by: "00000000-0000-4000-8000-0000000000b1", submitted_at: STAMP }, keep: "submitted_by" },
      { action: "approve", from: "review", then: { approval_status: "draft", review_note: "Sent back by someone else" }, keep: "review_note" },
      { action: "reject", from: "review", then: { approval_status: "approved", approved_at: STAMP, approved_by: "00000000-0000-4000-8000-0000000000b2" }, keep: "approved_by" },
    ];
    for (const c of cases) {
      const rows = brands({ approval_status: c.from });
      let reads = 0;
      const selectRule = tableRules("partner_brand", rows)[2];
      const rules = [
        [(sql) => /^\s*UPDATE\s+partner_brand\b/i.test(sql), (sql, params) => {
          Object.assign(mine(rows), c.then); // the other person's change lands first
          const { hit, returning } = runUpdate(rows, sql, params);
          for (const row of hit) assertCoupling(row);
          return { rows: hit.map((r) => Object.fromEntries((returning || []).map((k) => [k, r[k]]))), rowCount: hit.length };
        }],
        [selectRule[0], (sql, params) => { reads += 1; return selectRule[1](sql, params); }],
      ];
      const before = { ...c.then };
      const { res } = await callShared(handler, req("POST", { body: { partner_id: PARTNER, action: c.action, note: "x" } }), [...asStaff("owner"), ...rules]);
      assert.equal(res.statusCode, 409, c.action);
      assert.equal(res.body.error, "wrong_state");
      assert.equal(res.body.approval_status, c.then.approval_status, `${c.action}: the answer names the state it really is in`);
      assert.match(res.body.message, /someone else changed this brand a moment ago/);
      assert.equal(mine(rows).approval_status, c.then.approval_status, `${c.action}: the other person's change stands`);
      assert.equal(mine(rows)[c.keep], before[c.keep], `${c.action}: ${c.keep} was not overwritten`);
      assert.equal(reads, 2, `${c.action}: read, write, read again`);
    }
  });

  test("a write that fails answers 500 with a plain sentence and no database text, and the brand is untouched", async () => {
    const rows = brands({ approval_status: "review" });
    const rules = [
      [/^\s*UPDATE\s+partner_brand\b/i, new Error('duplicate key value violates unique constraint "partner_brand_pkey" host=10.1.2.3 password=hunter2')],
      tableRules("partner_brand", rows)[2],
    ];
    const { res } = await callShared(handler, req("POST", { body: { partner_id: PARTNER, action: "approve" } }), [...asStaff("owner"), ...rules]);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "write_failed");
    assert.deepEqual(Object.keys(res.body).sort(), ["error", "message", "ok"], "nothing else rides along");
    assert.doesNotMatch(JSON.stringify(res.body), /constraint|pkey|10\.1\.2\.3|hunter2|duplicate/);
    assert.equal(mine(rows).approval_status, "review");
  });

  test("an action from the wrong state is refused with 409 and the row is left as it was", async () => {
    // The sentence the partner reads names the state the brand is really in (it is not the
    // "someone else changed this a moment ago" sentence, which is for a race between read and write).
    const cases = [
      ["approve", "draft", "Nothing changed — this brand is still a draft."],
      ["reject", "draft", "Nothing changed — this brand is still a draft."],
      ["submit", "review", "Nothing was sent — this brand is already waiting for review."],
      ["submit", "approved", "Nothing was sent — this brand is already approved."],
      ["approve", "approved", "Nothing changed — this brand is already approved."],
    ];
    for (const [action, state, words] of cases) {
      const rows = brands({ approval_status: state, approved_at: state === "approved" ? STAMP : null });
      const before = JSON.stringify(rows);
      const { res } = await post({ partner_id: PARTNER, action, note: "x" }, asStaff("owner"), rows);
      assert.equal(res.statusCode, 409, `${action} from ${state}`);
      assert.equal(res.body.error, "wrong_state");
      assert.equal(res.body.approval_status, state);
      assert.equal(res.body.message, words, `${action} from ${state}`);
      assert.equal(JSON.stringify(rows), before, `${action} from ${state} changed nothing`);
    }
  });

  test("a staff sign-in with no company on it is refused before any brand is read, and nothing moves", async () => {
    const rows = brands({ approval_status: "review" });
    const before = JSON.stringify(rows);
    for (const action of ["submit", "approve", "reject"]) {
      const { res, fake } = await post({ partner_id: PARTNER, action, note: "x" }, asStaff("owner", null), rows);
      assert.equal(res.statusCode, 403, action);
      assert.equal(res.body.error, "no_org_scope", action);
      assert.equal(fake.find(/partner_brand/).length, 0, `${action}: the brand table was not touched`);
    }
    assert.equal(JSON.stringify(rows), before);
  });

  test("the request has to be a POST naming a real action and a real partner; a bad one is refused and nothing moves", async () => {
    const rows = brands({ approval_status: "review" });
    const before = JSON.stringify(rows);
    const get = await callShared(handler, req("GET", { query: { partner_id: PARTNER, action: "approve" } }), [...asStaff("owner"), ...brandRules(rows)]);
    assert.equal(get.res.statusCode, 405);
    assert.equal(get.res.headers.allow, "POST");
    const shred = await post({ partner_id: PARTNER, action: "shred" }, asStaff("owner"), rows);
    assert.equal(shred.res.statusCode, 400);
    assert.equal(shred.res.body.error, "unknown_action");
    assert.deepEqual(shred.res.body.allowed.sort(), ["approve", "reject", "submit"]);
    const noPartner = await post({ action: "approve" }, asStaff("owner"), rows);
    assert.equal(noPartner.res.statusCode, 400);
    assert.equal(noPartner.res.body.error, "partner_id_required");
    const badPartner = await post({ partner_id: "nope", action: "approve" }, asStaff("owner"), rows);
    assert.equal(badPartner.res.statusCode, 400);
    assert.equal(badPartner.res.body.error, "invalid_partner_id");
    assert.equal(JSON.stringify(rows), before);
    for (const r of [get, shred, noPartner, badPartner]) {
      assert.equal(r.fake.find(/partner_brand/).length, 0, "the brand table was not touched");
    }
  });

  test("a reason longer than 2000 characters is refused and the brand stays in review", async () => {
    const rows = brands({ approval_status: "review" });
    const long = await post({ partner_id: PARTNER, action: "reject", note: "x".repeat(2001) }, asStaff("owner"), rows);
    assert.equal(long.res.statusCode, 400);
    assert.equal(long.res.body.error, "note_too_long");
    assert.equal(mine(rows).approval_status, "review");
    assert.equal(mine(rows).review_note, "old note");
    const exact = await post({ partner_id: PARTNER, action: "reject", note: "x".repeat(2000) }, asStaff("owner"), rows);
    assert.equal(exact.res.statusCode, 200);
    assert.equal(mine(rows).review_note.length, 2000);
  });

  test("the whole loop: submit, reject, resubmit clears the note, approve", async () => {
    const rows = brands({ review_note: null });
    const step = (body) => post(body, asStaff("owner"), rows).then((r) => r.res.body.approval_status);
    assert.equal(await step({ partner_id: PARTNER, action: "submit" }), "review");
    assert.equal(await step({ partner_id: PARTNER, action: "reject", note: "Fix the colours" }), "draft");
    assert.equal(mine(rows).review_note, "Fix the colours");
    assert.equal(await step({ partner_id: PARTNER, action: "submit" }), "review");
    assert.equal(mine(rows).review_note, null, "the old complaint does not follow the new submission");
    assert.equal(await step({ partner_id: PARTNER, action: "approve" }), "approved");
  });

  test("every staff role is tried: only owner and admin may move a brand, the rest are refused before any row is read", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const rows = brands({ approval_status: "review" });
      const { res, fake } = await post({ partner_id: PARTNER, action: "approve" }, asStaff(role), rows);
      if (res.statusCode === 403) {
        assert.equal(fake.find(/partner_brand/).length, 0, `${role}: refused before the brand table`);
        assert.equal(mine(rows).approval_status, "review", `${role}: nothing changed`);
      } else {
        letIn.push(role);
        assert.equal(res.statusCode, 200);
      }
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner"]);
  });

  test("a partner may only send their own brand for review: approve and reject are refused, and a partner_id in the body is ignored", async () => {
    const rows = brands({ approval_status: "review" });
    const approve = await post({ partner_id: PARTNER, action: "approve" }, asPartner(), rows);
    assert.equal(approve.res.statusCode, 403);
    assert.equal(mine(rows).approval_status, "review");
    const reject = await post({ partner_id: PARTNER, action: "reject", note: "no" }, asPartner(), rows);
    assert.equal(reject.res.statusCode, 403);
    assert.equal(mine(rows).approval_status, "review");

    const draft = brands();
    // This partner names ANOTHER partner's id. They are pinned to their own.
    const submit = await post({ partner_id: OTHER_PARTNER, action: "submit" }, asPartner(), draft);
    assert.equal(submit.res.statusCode, 200);
    assert.equal(submit.res.body.partner_id, PARTNER);
    assert.equal(mine(draft).approval_status, "review");
    assert.equal(theirs(draft).approval_status, "review");
    assert.equal(theirs(draft).submitted_by, null, "the other company's partner row was never touched");
  });

  test("a staff owner of another company cannot move this company's brand: it reads as no brand and nothing changes", async () => {
    const rows = brands({ approval_status: "review" });
    const before = JSON.stringify(rows);
    for (const action of ["submit", "approve", "reject"]) {
      const { res } = await post({ partner_id: PARTNER, action, note: "x" }, asStaff("owner", OTHER_ORG_ID), rows);
      assert.equal(res.statusCode, 404, action);
      assert.equal(res.body.error, "no_brand");
    }
    assert.equal(JSON.stringify(rows), before);
  });

  test("the statements carry the company and the state: only the partner's own row in the right state can move", async () => {
    const rows = brands({ approval_status: "review" });
    const { fake } = await post({ partner_id: PARTNER, action: "approve" }, asStaff("owner"), rows);
    const update = fake.find(/UPDATE partner_brand/)[0];
    assert.match(update.sql, /WHERE partner_id = \$1 AND \(\$2::uuid IS NULL OR org_id = \$2::uuid\) AND approval_status = 'review'/);
    assert.deepEqual(update.params, [PARTNER, ORG_ID, STAFF_ID]);
  });

  test("no staff session gets 401 and a client or affiliate login gets 403", async () => {
    const none = await callShared(handler, req("POST", { body: { partner_id: PARTNER, action: "submit" } }), []);
    assert.equal(none.res.statusCode, 401);
    const client = await callShared(handler, req("POST", { body: { partner_id: PARTNER, action: "submit" } }), [
      ...accountSession({ kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }),
    ]);
    assert.equal(client.res.statusCode, 403);
  });
});
