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

/** The partner_brand table as the SQL text drives it: the SET clause decides the new state. */
function brandRules(rows) {
  return tableRules("partner_brand", rows, {
    set(row, params, sql) {
      if (/SET\s+approval_status = 'review'/i.test(sql)) {
        Object.assign(row, { approval_status: "review", submitted_at: STAMP, submitted_by: params[2], review_note: null });
      } else if (/SET\s+approval_status = 'approved'/i.test(sql)) {
        Object.assign(row, { approval_status: "approved", approved_at: STAMP, approved_by: params[2], review_note: null });
      } else if (/SET\s+approval_status = 'draft'/i.test(sql)) {
        Object.assign(row, { approval_status: "draft", approved_at: null, approved_by: null, review_note: params[2] });
      }
    },
  });
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
    assert.equal(mine(rows).review_note, null);
    assert.equal(mine(rows).approved_at, null, "approval and its time move together: not approved");
  });

  test("approve moves a brand in review to approved and stamps the approver; reject needs a reason and sends it back to draft", async () => {
    const approveRows = brands({ approval_status: "review" });
    const approved = await post({ partner_id: PARTNER, action: "approve" }, asStaff("admin"), approveRows);
    assert.equal(approved.res.statusCode, 200);
    assert.equal(approved.res.body.approval_status, "approved");
    assert.equal(mine(approveRows).approved_by, STAFF_ID);
    assert.equal(mine(approveRows).approved_at, STAMP);

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

  test("an action from the wrong state is refused with 409 and the row is left as it was", async () => {
    const cases = [
      ["approve", "draft"], ["reject", "draft"], ["submit", "review"], ["submit", "approved"], ["approve", "approved"],
    ];
    for (const [action, state] of cases) {
      const rows = brands({ approval_status: state, approved_at: state === "approved" ? STAMP : null });
      const before = JSON.stringify(rows);
      const { res } = await post({ partner_id: PARTNER, action, note: "x" }, asStaff("owner"), rows);
      assert.equal(res.statusCode, 409, `${action} from ${state}`);
      assert.equal(res.body.error, "wrong_state");
      assert.equal(res.body.approval_status, state);
      assert.equal(JSON.stringify(rows), before, `${action} from ${state} changed nothing`);
    }
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
