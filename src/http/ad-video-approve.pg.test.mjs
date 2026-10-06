// GET/POST /api/public/ad-video-approve against a real Postgres — the open
// door, and whether the one stolen token it is built around really does reach
// one row and nothing else.
//
// ═══════════════════════════════════════════════════════════════════════════
// *** NOTHING IN THIS FILE HAS EVER RUN. ***
//
// There is no Postgres on the machine this was written on, so every test below
// SKIPPED. It is written to be correct and it is not evidence of anything. A
// skipped .pg.test.mjs is NOT green (CLAUDE.md §12). The first person with a
// database must run it and report the real result.
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ TO WHOEVER RUNS THIS FIRST: SET APP_DATABASE_URL, POINTING AT fundhub_app.
//
// The isolation tests at the end are the only ones here that prove the row-level
// security policies. A superuser — and the table owner, under some
// configurations — bypasses every policy, and CI runs most of this suite as the
// owner. Without APP_DATABASE_URL those tests PRINT A LINE AND PASS, and the
// central claim of this door ("one stolen token reaches one take") stays
// completely unproven. A green run with the variable unset is not evidence
// about it. Same trap CLAUDE.md §12 records.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import { rlsPool, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";
import handler from "../../api/public/ad-video-approve.mjs";
import { createTake, armForApproval } from "../ad-videos/store.mjs";
import { mintApprovalToken } from "../ad-videos/token.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const MARK_PREFIX = "99991";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("POST /api/public/ad-video-approve", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org = null;
  let partner = null;
  let seq = 0;

  const newAdId = () => `${MARK_PREFIX}${String(++seq).padStart(4, "0")}`;

  const call = async (body, { method = "POST", query = {} } = {}) => {
    const r = res();
    await handler({ method, query, headers: {}, body }, r, {});
    return r;
  };

  before(async () => {
    org = await resolveDefaultOrg(db);
    partner = (await db.query(
      `SELECT id FROM partners WHERE org_id = $1 AND slug = 'fundhub-house'`, [org]
    )).rows[0]?.id;
    assert.ok(partner, "no house partner row — 377 has not been applied to this database");
    await purge();
  });
  after(async () => { await purge(); await closeRlsPool(); await close(); });

  async function purge() {
    if (!HAVE_DB) return;
    await asStaff((tx) => tx.query(`DELETE FROM ad_videos WHERE ad_id LIKE $1`, [`${MARK_PREFIX}%`]));
  }

  /* A take sitting in awaiting_approval with a live token — what the phone
     notification is sent about. ttlHours below zero makes an already-dead one. */
  async function armed({ ttlHours = 72, videoKind = "ad", width = 1920, height = 1080 } = {}) {
    const adId = newAdId();
    const { token, expiresAt } = mintApprovalToken({ ttlHours });
    const row = await asStaff((tx) => createTake(tx, {
      orgId: org, partnerId: partner, adId, takeNo: 1, status: "rendered",
      videoKind, width, height,
      finished_url: "https://example.invalid/out.mp4", duration_seconds: 102
    }));
    await asStaff((tx) => armForApproval(tx, { orgId: org, id: row.id, token, expiresAt }));
    return { id: row.id, adId, token };
  }

  const statusOf = async (id) => (await asStaff((tx) => tx.query(
    `SELECT status, approved_by, approved_at, rejected_reason, approval_token
       FROM ad_videos WHERE id = $1`, [id]
  ))).rows[0];

  // The token's own pure checks — minting, shape, comparison — live in
  // src/ad-videos/token.test.mjs, which needs no database and therefore
  // actually RUNS on a machine with no Postgres. Nothing about them is
  // repeated here.

  // ── GET shows, POST decides ──────────────────────────────────────────────

  describe("GET shows the take without changing it", () => {
    test("a live token shows the ad number, the take and the finished video", async () => {
      const { adId, token, id } = await armed();
      const r = await call(null, { method: "GET", query: { token } });
      assert.equal(r.code, 200);
      assert.equal(r.body.video.ad_id, adId);
      assert.equal(r.body.video.take_no, 1);
      assert.equal(r.body.video.status, "awaiting_approval");
      assert.equal(r.body.video.finished_url, "https://example.invalid/out.mp4");
      // Padded for the heading, unpadded for the link. Both, side by side.
      assert.equal(r.body.video.folder_name.replace(/^0+(?=\d)/, ""), adId);
      assert.equal((await statusOf(id)).status, "awaiting_approval", "GET must change nothing");
    });

    test("GET is safe to repeat", async () => {
      const { token } = await armed();
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await call(null, { method: "GET", query: { token } })).code, 200);
      }
    });

    test("the shown take carries the 4K flag", async () => {
      const { token } = await armed({ videoKind: "not_ad", width: 1920, height: 1080 });
      const r = await call(null, { method: "GET", query: { token } });
      assert.equal(r.body.video.resolution_ok, false,
        "somebody about to approve a 1080p VSL must be able to see that it is one");
    });

    test("GET never leaks the transcript, the raw link or the token back", async () => {
      const { token } = await armed();
      const r = await call(null, { method: "GET", query: { token } });
      for (const k of ["transcript", "source_url", "approval_token", "storage_raw_key", "id", "org_id"]) {
        assert.equal(r.body.video[k], undefined, `${k} must not be in the answer`);
      }
    });
  });

  describe("POST is the decision", () => {
    test("Approve moves the take and names who did it", async () => {
      const { id, token, adId } = await armed();
      const r = await call({ token, decision: "approve" });
      assert.equal(r.code, 200);
      assert.equal(r.body.decision, "approve");
      assert.equal(r.body.ad_id, adId);
      assert.equal(r.body.status, "approved");

      const row = await statusOf(id);
      assert.equal(row.status, "approved");
      assert.equal(row.approved_by, "chris");
      assert.ok(row.approved_at);
    });

    test("Reject saves the reason, which is the whole value of a rejection", async () => {
      const { id, token } = await armed();
      const r = await call({ token, decision: "reject", reason: "stumbled at 0:12" });
      assert.equal(r.code, 200);
      const row = await statusOf(id);
      assert.equal(row.status, "rejected");
      assert.equal(row.rejected_reason, "stumbled at 0:12");
    });

    test("a Reject with no typed reason still saves, with a default", async () => {
      // 389 refuses a rejection with no words, and a rejection that does not
      // save at all is worse than a vague one.
      const { id, token } = await armed();
      const r = await call({ token, decision: "reject" });
      assert.equal(r.code, 200);
      const row = await statusOf(id);
      assert.equal(row.status, "rejected");
      assert.match(row.rejected_reason, /no reason typed/);
    });

    test("*** the link is spent on use ***", async () => {
      const { id, token } = await armed();
      assert.equal((await call({ token, decision: "approve" })).code, 200);
      assert.equal((await statusOf(id)).approval_token, null);
      // The same link, tapped again out of a notification history.
      assert.equal((await call({ token, decision: "approve" })).code, 404);
      assert.equal((await call(null, { method: "GET", query: { token } })).code, 404);
    });

    test("*** a double tap changes nothing the first one did not ***", async () => {
      const { id, token } = await armed();
      await call({ token, decision: "approve" });
      const after = await statusOf(id);
      await call({ token, decision: "reject", reason: "changed my mind" });
      const still = await statusOf(id);
      assert.equal(still.status, "approved", "the second tap must not flip an approved take");
      assert.equal(still.rejected_reason, null);
      assert.deepEqual(still.approved_at, after.approved_at);
    });

    test("an expired token decides nothing", async () => {
      const { id, token } = await armed({ ttlHours: -1 });
      assert.equal((await call({ token, decision: "approve" })).code, 404);
      assert.equal((await call(null, { method: "GET", query: { token } })).code, 404);
      assert.equal((await statusOf(id)).status, "awaiting_approval");
    });

    test("a take that is not waiting cannot be decided even with its token", async () => {
      const { id, token } = await armed();
      await asStaff((tx) => tx.query(
        `UPDATE ad_videos SET status = 'failed', failure_reason = 'x' WHERE id = $1`, [id]
      ));
      assert.equal((await call({ token, decision: "approve" })).code, 404);
      assert.equal((await statusOf(id)).status, "failed");
    });

    test("only approve and reject are decisions", async () => {
      const { id, token } = await armed();
      for (const decision of ["delete", "delivered", "", "APPROVE ", null]) {
        const r = await call({ token, decision });
        assert.equal(r.code, 400, String(decision));
        assert.equal(r.body.error, "bad_decision");
      }
      assert.equal((await statusOf(id)).status, "awaiting_approval");
    });

    test("a GET can never decide anything", async () => {
      // So a link preview, a message-app scanner or a crawler following the URL
      // out of a notification cannot approve a video nobody watched.
      const { id, token } = await armed();
      const r = await call(null, { method: "GET", query: { token, decision: "approve" } });
      assert.equal(r.code, 200);
      assert.equal((await statusOf(id)).status, "awaiting_approval");
    });

    test("anything but GET or POST is refused", async () => {
      const { token } = await armed();
      for (const method of ["PUT", "DELETE", "PATCH"]) {
        const r = await call({ token, decision: "approve" }, { method });
        assert.equal(r.code, 405, method);
      }
    });
  });

  // ── the door answers no questions ────────────────────────────────────────

  describe("*** EVERY REFUSAL IS THE SAME REFUSAL ***", () => {
    test("unknown, expired, spent, malformed and missing all answer identically", async () => {
      // Telling them apart is how somebody learns which guesses are close.
      const spent = await armed();
      await call({ token: spent.token, decision: "approve" });
      const expired = await armed({ ttlHours: -1 });

      const answers = [];
      for (const token of [
        "a".repeat(48),          // never existed
        expired.token,           // expired
        spent.token,             // already used
        "nope",                  // wrong shape
        "",                      // empty
        undefined                // absent
      ]) {
        const r = await call({ token, decision: "approve" });
        answers.push([r.code, JSON.stringify(r.body)]);
      }
      const first = JSON.stringify(answers[0]);
      for (const a of answers) {
        assert.equal(JSON.stringify(a), first,
          `this refusal differs from the others and tells a prober something: ${JSON.stringify(a)}`);
      }
      assert.equal(answers[0][0], 404);
    });

    test("a malformed body is a 400 that says nothing about tokens", async () => {
      const r = res();
      await handler({ method: "POST", query: {}, headers: {}, body: "{not json" }, r, {});
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "invalid_json");
    });
  });

  // ── the lock that actually holds ─────────────────────────────────────────

  describe("*** one stolen token reaches ONE take and nothing else ***", () => {
    test("as the unprivileged app role, a declared token sees exactly its own row", async (t) => {
      if (!rlsIsReal()) {
        t.diagnostic("APP_DATABASE_URL is unset — this test proves NOTHING about the policies. " +
                     "Point it at fundhub_app and run again.");
        return;
      }
      const mine = await armed();
      const theirs = await armed();

      const client = await rlsPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('fundhub.ad_video_token', $1, true)", [mine.token]);

        const all = await client.query(`SELECT id FROM ad_videos`);
        assert.equal(all.rows.length, 1,
          `a token holder saw ${all.rows.length} rows — it must see exactly one`);
        assert.equal(all.rows[0].id, mine.id);

        // Not the other armed take, even asked for by id.
        const other = await client.query(`SELECT id FROM ad_videos WHERE id = $1`, [theirs.id]);
        assert.equal(other.rows.length, 0, "a token holder reached another take's row");

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    test("as the unprivileged app role, NO declared token sees NOTHING", async (t) => {
      if (!rlsIsReal()) {
        t.diagnostic("APP_DATABASE_URL is unset — this test proves NOTHING about the policies.");
        return;
      }
      await armed();
      const client = await rlsPool().connect();
      try {
        await client.query("BEGIN");
        // The setting is never declared. NULL = NULL is NULL, which is not true,
        // so the policy must deny every row rather than match them all.
        const all = await client.query(`SELECT id FROM ad_videos`);
        assert.equal(all.rows.length, 0,
          "an undeclared session read rows — the policy matches instead of denying");
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    test("a token holder cannot insert a row or delete one", async (t) => {
      if (!rlsIsReal()) {
        t.diagnostic("APP_DATABASE_URL is unset — this test proves NOTHING about the policies.");
        return;
      }
      const mine = await armed();
      const client = await rlsPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('fundhub.ad_video_token', $1, true)", [mine.token]);

        await assert.rejects(
          client.query(
            `INSERT INTO ad_videos (org_id, partner_id, ad_id, take_no) VALUES ($1, $2, '999919999', 1)`,
            [org, partner]
          ),
          "the token door must never be able to create a take"
        );
        await client.query("ROLLBACK");

        await client.query("BEGIN");
        await client.query("SELECT set_config('fundhub.ad_video_token', $1, true)", [mine.token]);
        const del = await client.query(`DELETE FROM ad_videos WHERE id = $1`, [mine.id]);
        assert.equal(del.rowCount, 0, "the token door must never be able to delete a take");
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    test("the setting is transaction-local, so it cannot leak onto the next request", async (t) => {
      if (!rlsIsReal()) {
        t.diagnostic("APP_DATABASE_URL is unset — this test proves NOTHING about the policies.");
        return;
      }
      // src/db.mjs is a POOL. A session-level setting would leak one request's
      // scope into whichever request borrowed that connection next, which is
      // the exact accident 379's header warns about.
      const mine = await armed();
      const client = await rlsPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('fundhub.ad_video_token', $1, true)", [mine.token]);
        assert.equal((await client.query(`SELECT id FROM ad_videos`)).rows.length, 1);
        await client.query("COMMIT");

        // Same physical connection, new transaction, nothing declared.
        await client.query("BEGIN");
        assert.equal((await client.query(`SELECT id FROM ad_videos`)).rows.length, 0,
          "the previous transaction's token is still in scope — it was not is_local");
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });
});
