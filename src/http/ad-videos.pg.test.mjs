// GET /api/ad-videos against a real Postgres, plus the locks in
// db/migrations/389_ad_videos.sql that the endpoint leans on.
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
// WHY IT LIVES HERE AND NOT NEXT TO THE HANDLER
//
// npm test's glob is "src/**" and "scripts/**" only. A test under api/ is never
// collected and passes forever by never running. Same arrangement, same reason,
// as src/http/vsl-watch.pg.test.mjs.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHO EACH QUERY RUNS AS
//
// ad_videos carries FORCEd row-level security (389, Part 5). A bare db.query()
// against it is anonymous to those policies and touches ZERO rows rather than
// erroring — the failure mode that makes a test look green while proving
// nothing. So every fixture and every assertion goes through asStaff().
//
// The handler opens its own asStaff() transaction, which is the thing being
// tested, so it is left alone to do it.
//
// WHAT THIS FILE DOES NOT PROVE: the policies themselves. Staff passes every
// lock in this database by design, and CI runs most of the suite as the table
// owner, who bypasses even FORCEd policies under some configurations. The
// token-door isolation is proved in src/http/ad-video-approve.pg.test.mjs, and
// only when APP_DATABASE_URL points at fundhub_app.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import handler, { fetchRows } from "../../api/ad-videos.mjs";
import { STATES } from "../ad-videos/states.mjs";
import {
  createTake, nextTake, claimTake, advance, markFailed, retryFailed,
  armForApproval, approve, reject, markDelivered,
  listByStatus, lastTakeNo, finishedTake, findByDriveFileId, findBySubmagicProjectId,
  AdVideoStoreError
} from "../ad-videos/store.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

/* An ad number range nothing real uses, so a failed run cannot collide with a
   genuine ad. 9-digit numbers starting 9999 are past anything the writer will
   ever hand out and still inside fundhub_ad_id()'s 1-9 digits. */
const MARK_PREFIX = "99990";

/* The res shim every endpoint test in this repo uses: the adapter only ever
   gives a handler status(), json() and setHeader(). */
const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("GET /api/ad-videos", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org = null;
  let partner = null;
  let seq = 0;

  const newAdId = () => `${MARK_PREFIX}${String(++seq).padStart(4, "0")}`;

  const staffOf = (role) => ({ id: "11111111-1111-1111-1111-111111111111", role, org_id: org });
  const authOk = (role) => async () => staffOf(role);
  const authFail = () => async (req, r) => { r.status(401).json({ ok: false, error: "unauthorized" }); return null; };

  const get = async (query = {}, { role = "owner", auth = null, method = "GET" } = {}) => {
    const r = res();
    await handler({ method, query, headers: {} }, r, { db, requireAuth: auth || authOk(role) });
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
  after(async () => { await purge(); await close(); });

  async function purge() {
    if (!HAVE_DB) return;
    await asStaff((tx) => tx.query(
      `DELETE FROM ad_videos WHERE ad_id LIKE $1`, [`${MARK_PREFIX}%`]
    ));
  }

  const make = (patch = {}) => asStaff((tx) => createTake(tx, {
    orgId: org, partnerId: partner, adId: newAdId(), takeNo: 1, ...patch
  }));

  // ── the table actually exists and is shaped as 389 says ──────────────────

  describe("the migration landed", () => {
    test("ad_videos exists with row-level security forced on", async () => {
      const row = (await db.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE relname = 'ad_videos' AND relnamespace = 'public'::regnamespace`
      )).rows[0];
      assert.ok(row, "ad_videos does not exist — 389 has not been applied");
      assert.equal(row.relrowsecurity, true);
      assert.equal(row.relforcerowsecurity, true,
        "without FORCE the table owner bypasses every policy, including the token door");
    });

    test("the status check names exactly the thirteen states the code knows", async () => {
      const def = (await db.query(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
          WHERE conname = 'ad_videos_status_ck'`
      )).rows[0]?.d || "";
      for (const s of STATES) {
        assert.match(def, new RegExp(`'${s}'`),
          `state "${s}" is in src/ad-videos/states.mjs and not in the database check`);
      }
    });

    test("resolution_ok is generated, so nothing can write a lie into it", async () => {
      const row = (await db.query(
        `SELECT is_generated FROM information_schema.columns
          WHERE table_name = 'ad_videos' AND column_name = 'resolution_ok'`
      )).rows[0];
      assert.equal(row?.is_generated, "ALWAYS");
    });
  });

  // ── the locks ────────────────────────────────────────────────────────────

  describe("the locks that live in the database", () => {
    test("a take number is used once per ad", async () => {
      const row = await make();
      await assert.rejects(
        asStaff((tx) => createTake(tx, {
          orgId: org, partnerId: partner, adId: row.ad_id, takeNo: 1
        })),
        (err) => {
          assert.equal(err.code, "23505", "expected a unique violation");
          return true;
        }
      );
    });

    test("*** ONE AD NUMBER, ONE FINISHED VIDEO ***", async () => {
      // The build rule from the plan's §8, and the whole reason this table has
      // a partial unique index rather than a comment asking people to be careful.
      const first = await make({ status: "awaiting_approval" });
      const second = await asStaff((tx) => nextTake(tx, {
        orgId: org, partnerId: partner, adId: first.ad_id, status: "awaiting_approval"
      }));
      assert.equal(second.take_no, 2);

      const a = await asStaff((tx) => approve(tx, { orgId: org, id: first.id, approvedBy: "chris" }));
      assert.equal(a.status, "approved");

      await assert.rejects(
        asStaff((tx) => approve(tx, { orgId: org, id: second.id, approvedBy: "chris" })),
        (err) => {
          assert.equal(err.code, "23505",
            "a second finished video for one ad number must be refused by the database");
          return true;
        }
      );
    });

    test("a padded ad number cannot be stored at all", async () => {
      // '043' and '43' would be two different ads to fundhub_ad_id(), and one
      // ad's results would split in half. The check refuses it outright.
      await assert.rejects(
        asStaff((tx) => tx.query(
          `INSERT INTO ad_videos (org_id, partner_id, ad_id, take_no)
           VALUES ($1, $2, '099990001', 1)`, [org, partner]
        )),
        (err) => {
          assert.equal(err.code, "23514", "expected the ad_id check to refuse it");
          return true;
        }
      );
    });

    test("a failure must say why", async () => {
      const row = await make({ status: "staged" });
      await assert.rejects(
        asStaff((tx) => tx.query(
          `UPDATE ad_videos SET status = 'failed' WHERE id = $1`, [row.id]
        )),
        (err) => { assert.equal(err.code, "23514"); return true; }
      );
      const failed = await asStaff((tx) => markFailed(tx, {
        orgId: org, id: row.id, from: "staged", reason: "Submagic 422: videoUrl not downloadable"
      }));
      assert.equal(failed.status, "failed");
      assert.match(failed.failure_reason, /422/);
    });

    test("a rejection must say why", async () => {
      const row = await make({ status: "awaiting_approval" });
      await assert.rejects(
        asStaff((tx) => tx.query(
          `UPDATE ad_videos SET status = 'rejected' WHERE id = $1`, [row.id]
        )),
        (err) => { assert.equal(err.code, "23514"); return true; }
      );
    });

    test("an approval names who gave it", async () => {
      const row = await make({ status: "awaiting_approval" });
      await assert.rejects(
        asStaff((tx) => tx.query(
          `UPDATE ad_videos SET status = 'approved', approved_at = now() WHERE id = $1`, [row.id]
        )),
        (err) => { assert.equal(err.code, "23514"); return true; }
      );
    });
  });

  // ── the 4K law ───────────────────────────────────────────────────────────

  describe("the 4K law (.claude/rules/video-4k-unless-ad.md)", () => {
    test("a 1080p AD is fine — Meta compresses it anyway", async () => {
      const row = await make({ status: "awaiting_approval", videoKind: "ad", width: 1920, height: 1080 });
      assert.equal(row.resolution_ok, true);
      const done = await asStaff((tx) => approve(tx, { orgId: org, id: row.id, approvedBy: "chris" }));
      assert.equal(done.status, "approved");
    });

    test("a 1080p NON-AD is recorded and FLAGGED, not thrown away", async () => {
      // Owner decision 2, 2026-09-22. Refusing the row outright would lose the
      // one piece of evidence that says what the camera actually did.
      const row = await make({ status: "staged", videoKind: "not_ad", width: 1920, height: 1080 });
      assert.equal(row.resolution_ok, false, "a 1080p VSL must be flagged");
    });

    test("a flagged non-ad cannot be approved", async () => {
      const row = await make({
        status: "awaiting_approval", videoKind: "not_ad", width: 1920, height: 1080
      });
      await assert.rejects(
        asStaff((tx) => approve(tx, { orgId: org, id: row.id, approvedBy: "chris" })),
        (err) => {
          assert.equal(err.code, "23514", "a 1080p VSL must not be approvable");
          return true;
        }
      );
    });

    test("a 4K non-ad approves normally", async () => {
      const row = await make({
        status: "awaiting_approval", videoKind: "not_ad", width: 3840, height: 2160
      });
      assert.equal(row.resolution_ok, true);
      const done = await asStaff((tx) => approve(tx, { orgId: org, id: row.id, approvedBy: "chris" }));
      assert.equal(done.status, "approved");
    });

    test("a non-ad with an UNMEASURED height cannot be approved", async () => {
      // Stricter than the plan's draft check, on purpose: "never upscale 1080p
      // and call it 4K" means an unmeasured VSL is exactly the defect.
      const row = await make({ status: "awaiting_approval", videoKind: "not_ad" });
      assert.equal(row.resolution_ok, true, "nothing measured yet, so nothing to flag yet");
      await assert.rejects(
        asStaff((tx) => approve(tx, { orgId: org, id: row.id, approvedBy: "chris" })),
        (err) => { assert.equal(err.code, "23514"); return true; }
      );
    });

    test("a half-read picture size is refused, from both sides", async () => {
      // A CHECK passes when its expression is NULL, so the naive spelling of
      // this rule would have ACCEPTED both of these. Both directions are
      // asserted because only one of them trips the NULL path.
      await assert.rejects(
        make({ width: 1920 }),
        (err) => { assert.equal(err.code, "23514", "width with no height must be refused"); return true; }
      );
      await assert.rejects(
        make({ height: 2160 }),
        (err) => { assert.equal(err.code, "23514", "height with no width must be refused"); return true; }
      );
      // Neither is the ordinary case before anything has been measured.
      const unmeasured = await make({});
      assert.equal(unmeasured.width, null);
      assert.equal(unmeasured.height, null);
    });
  });

  // ── the store's repeat-safety ────────────────────────────────────────────

  describe("every step is safe to run twice", () => {
    test("the Drive poll seeing one file twice makes ONE row", async () => {
      const adId = newAdId();
      const fileId = `drive-${adId}`;
      const first = await asStaff((tx) => claimTake(tx, {
        orgId: org, partnerId: partner, adId, takeNo: 1, driveFileId: fileId, driveName: "IMG_4471.mov"
      }));
      assert.equal(first.created, true);
      assert.equal(first.row.status, "raw_landed");

      const again = await asStaff((tx) => claimTake(tx, {
        orgId: org, partnerId: partner, adId, takeNo: 1, driveFileId: fileId, driveName: "IMG_4471.mov"
      }));
      assert.equal(again.created, false);
      assert.equal(again.row.id, first.row.id);
    });

    test("a second sighting does NOT drag a row that has moved on back to raw_landed", async () => {
      const adId = newAdId();
      const fileId = `drive-moved-${adId}`;
      const { row } = await asStaff((tx) => claimTake(tx, {
        orgId: org, partnerId: partner, adId, takeNo: 1, driveFileId: fileId
      }));
      await asStaff((tx) => advance(tx, {
        orgId: org, id: row.id, from: "raw_landed", to: "staged",
        patch: { source_url: "https://example.invalid/take.mp4" }
      }));

      const again = await asStaff((tx) => claimTake(tx, {
        orgId: org, partnerId: partner, adId, takeNo: 1, driveFileId: fileId
      }));
      assert.equal(again.created, false);
      assert.equal(again.row.status, "staged", "the poll must not undo the stager's work");
    });

    /* staged -> editing, not staged -> transcribed: the machine's order since
       2026-09-23 (988d99b7a, src/ad-videos/states.mjs TRANSITIONS). Submagic is
       the transcriber, so a take is "editing" before it has words. */
    test("a retried advance whose first run succeeded returns null rather than moving twice", async () => {
      const row = await make({ status: "staged" });
      const first = await asStaff((tx) => advance(tx, {
        orgId: org, id: row.id, from: "staged", to: "editing", patch: { submagic_project_id: "proj-retry" }
      }));
      assert.equal(first.status, "editing");

      const retry = await asStaff((tx) => advance(tx, {
        orgId: org, id: row.id, from: "staged", to: "editing", patch: { submagic_project_id: "proj-retry" }
      }));
      assert.equal(retry, null, "a caller must read null as 'somebody already did this'");
    });

    test("nextTake picks its own number, so two racing workers cannot both take 2", async () => {
      const adId = newAdId();
      await asStaff((tx) => createTake(tx, { orgId: org, partnerId: partner, adId, takeNo: 1 }));
      const two = await asStaff((tx) => nextTake(tx, { orgId: org, partnerId: partner, adId }));
      const three = await asStaff((tx) => nextTake(tx, { orgId: org, partnerId: partner, adId }));
      assert.equal(two.take_no, 2);
      assert.equal(three.take_no, 3);
      assert.equal(await asStaff((tx) => lastTakeNo(tx, { orgId: org, adId })), 3);
    });
  });

  // ── the state machine, against the real table ────────────────────────────

  describe("the state machine is enforced before any SQL runs", () => {
    test("an illegal move throws and writes nothing", async () => {
      const row = await make({ status: "staged" });
      await assert.rejects(
        asStaff((tx) => advance(tx, { orgId: org, id: row.id, from: "staged", to: "delivered" })),
        (err) => {
          assert.equal(err.code, "illegal_transition");
          return true;
        }
      );
      const still = (await asStaff((tx) => tx.query(
        `SELECT status FROM ad_videos WHERE id = $1`, [row.id]
      ))).rows[0];
      assert.equal(still.status, "staged", "a refused move must leave the row alone");
    });

    test("a worker cannot approve", async () => {
      const row = await make({ status: "awaiting_approval" });
      await assert.rejects(
        asStaff((tx) => advance(tx, {
          orgId: org, id: row.id, from: "awaiting_approval", to: "approved"
        })),
        (err) => { assert.equal(err.code, "human_only"); return true; }
      );
    });

    test("a worker cannot set approved_at through a patch", async () => {
      const row = await make({ status: "staged" });
      await assert.rejects(
        // A LEGAL move (staged -> editing), so the refusal is the patch's own.
        asStaff((tx) => advance(tx, {
          orgId: org, id: row.id, from: "staged", to: "editing",
          patch: { approved_at: new Date() }
        })),
        (err) => { assert.equal(err.code, "unpatchable_column"); return true; }
      );
    });

    test("the whole path walks scripted → delivered", async () => {
      const adId = newAdId();
      const row = await asStaff((tx) => createTake(tx, {
        orgId: org, partnerId: partner, adId, takeNo: 1, status: "scripted"
      }));

      const steps = [
        ["scripted", "filming", {}],
        ["filming", "raw_landed", { drive_raw_file_id: `walk-${adId}`, drive_raw_name: "IMG_1.mov" }],
        ["raw_landed", "staged", { source_url: "https://example.invalid/t.mp4", storage_raw_key: "raw/x.mp4" }],
        // The order src/ad-videos/states.mjs allows since 2026-09-23 (988d99b7a).
        ["staged", "editing", { submagic_project_id: `proj-${adId}` }],
        ["editing", "transcribed", { transcript: "Most people apply in the wrong order" }],
        ["transcribed", "matched", { match_confidence: 96 }],
        ["matched", "rendered", { finished_url: "https://example.invalid/out.mp4", width: 1920, height: 1080 }]
      ];
      let at = "scripted";
      for (const [from, to, patch] of steps) {
        const got = await asStaff((tx) => advance(tx, { orgId: org, id: row.id, from, to, patch }));
        assert.ok(got, `${from} → ${to} wrote nothing`);
        assert.equal(got.status, to);
        at = to;
      }
      assert.equal(at, "rendered");

      const armed = await asStaff((tx) => armForApproval(tx, {
        orgId: org, id: row.id, token: "a".repeat(48), expiresAt: new Date(Date.now() + 3600e3)
      }));
      assert.equal(armed.status, "awaiting_approval");

      const ok = await asStaff((tx) => approve(tx, { orgId: org, id: row.id, approvedBy: "chris" }));
      assert.equal(ok.status, "approved");
      assert.ok(ok.approved_at);
      assert.equal(ok.approved_by, "chris");
      assert.equal(ok.approval_token, undefined, "the token column is not in the read shape");

      const done = await asStaff((tx) => markDelivered(tx, {
        orgId: org, id: row.id, paulFolderId: "folder-1", driveFinalFileId: "file-1"
      }));
      assert.equal(done.status, "delivered");

      const finished = await asStaff((tx) => finishedTake(tx, { orgId: org, adId }));
      assert.equal(finished.id, row.id);
    });

    test("approving spends the token", async () => {
      const row = await make({ status: "rendered" });
      await asStaff((tx) => armForApproval(tx, {
        orgId: org, id: row.id, token: "b".repeat(48), expiresAt: new Date(Date.now() + 3600e3)
      }));
      await asStaff((tx) => approve(tx, { orgId: org, id: row.id, approvedBy: "chris" }));
      const raw = (await asStaff((tx) => tx.query(
        `SELECT approval_token, approval_expires_at FROM ad_videos WHERE id = $1`, [row.id]
      ))).rows[0];
      assert.equal(raw.approval_token, null, "a used link must stop working");
      assert.equal(raw.approval_expires_at, null);
    });

    test("a failure can be retried back to staged", async () => {
      const row = await make({ status: "editing" });
      await asStaff((tx) => markFailed(tx, {
        orgId: org, id: row.id, from: "editing", reason: "Submagic timed out"
      }));
      const back = await asStaff((tx) => retryFailed(tx, { orgId: org, id: row.id }));
      assert.equal(back.status, "staged");
      assert.equal(back.failure_reason, null, "the old reason must not stick to a retried row");
    });

    test("a rejection ends this take and the re-film is a NEW row", async () => {
      const row = await make({ status: "awaiting_approval" });
      const no = await asStaff((tx) => reject(tx, {
        orgId: org, id: row.id, reason: "stumbled at 0:12"
      }));
      assert.equal(no.status, "rejected");
      assert.equal(no.take_no, 1);

      const refilm = await asStaff((tx) => nextTake(tx, {
        orgId: org, partnerId: partner, adId: row.ad_id
      }));
      assert.equal(refilm.take_no, 2);
      assert.equal(refilm.status, "filming");
      assert.notEqual(refilm.id, row.id, "a re-film must never overwrite the rejected take");

      // And the rejected row still says why, three weeks later.
      const kept = (await asStaff((tx) => tx.query(
        `SELECT rejected_reason FROM ad_videos WHERE id = $1`, [row.id]
      ))).rows[0];
      assert.equal(kept.rejected_reason, "stumbled at 0:12");
    });
  });

  // ── the lookups the workers depend on ────────────────────────────────────

  describe("the lookups", () => {
    test("the Submagic webhook finds its row by project id alone", async () => {
      const row = await make({ status: "editing", submagic_project_id: `proj-lookup-${seq}` });
      const found = await asStaff((tx) => findBySubmagicProjectId(tx, {
        projectId: row.submagic_project_id
      }));
      assert.equal(found.id, row.id);
    });

    test("two rows cannot claim one Submagic project", async () => {
      const a = await make({ status: "editing", submagic_project_id: `proj-dup-${seq}` });
      await assert.rejects(
        make({ status: "editing", submagic_project_id: a.submagic_project_id }),
        (err) => { assert.equal(err.code, "23505"); return true; }
      );
    });

    test("the Drive poll's dedupe read finds the row it made", async () => {
      const adId = newAdId();
      const fileId = `drive-find-${adId}`;
      await asStaff((tx) => claimTake(tx, {
        orgId: org, partnerId: partner, adId, takeNo: 1, driveFileId: fileId
      }));
      const found = await asStaff((tx) => findByDriveFileId(tx, { orgId: org, driveFileId: fileId }));
      assert.equal(found.ad_id, adId);
    });

    test("listByStatus refuses a state that does not exist rather than returning everything", async () => {
      await assert.rejects(
        asStaff((tx) => listByStatus(tx, { orgId: org, status: "done" })),
        (err) => {
          assert.ok(err instanceof AdVideoStoreError);
          assert.equal(err.code, "unknown_state");
          return true;
        }
      );
    });
  });

  // ── the endpoint itself ──────────────────────────────────────────────────

  describe("the HTTP door", () => {
    test("an unauthenticated caller gets nothing", async () => {
      const r = await get({}, { auth: authFail() });
      assert.equal(r.code, 401);
    });

    test("a signed-in closer is refused — OPS only", async () => {
      // Not STAFF. These rows carry unreleased ad creative and the raw links.
      for (const role of ["closer", "setter", "csm", "funding_advisor", "inquiry_specialist", "sales_manager"]) {
        const r = await get({}, { role });
        assert.equal(r.code, 403, `${role} must not read the ad video queue`);
      }
    });

    for (const role of ["owner", "admin"]) {
      test(`${role} may read the queue`, async () => {
        const r = await get({});
        assert.equal(r.code, 200);
        assert.equal(r.body.ok, true);
        assert.ok(Array.isArray(r.body.items));
      });
    }

    test("anything but GET is refused", async () => {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const r = await get({}, { method });
        assert.equal(r.code, 405, method);
        assert.equal(r.headers.allow, "GET");
      }
    });

    test("?status=awaiting_approval returns only what is waiting on Chris", async () => {
      const waiting = await make({ status: "awaiting_approval" });
      await make({ status: "editing" });

      const r = await get({ status: "awaiting_approval", limit: "200" });
      assert.equal(r.code, 200);
      const mine = r.body.items.filter((i) => i.ad_id.startsWith(MARK_PREFIX));
      assert.ok(mine.some((i) => i.id === waiting.id));
      for (const i of mine) assert.equal(i.status, "awaiting_approval");
    });

    test("?status= takes several states at once", async () => {
      const r = await get({ status: "editing,rendered", limit: "200" });
      assert.equal(r.code, 200);
      for (const i of r.body.items) {
        assert.ok(["editing", "rendered"].includes(i.status), i.status);
      }
    });

    test("an unknown ?status= is a 400 that names the states, not a 500", async () => {
      const r = await get({ status: "done" });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "unknown_state");
      assert.deepEqual(r.body.states, STATES);
    });

    test("?ad_id= returns every take of one ad, oldest first", async () => {
      const adId = newAdId();
      await asStaff((tx) => createTake(tx, { orgId: org, partnerId: partner, adId, takeNo: 1 }));
      await asStaff((tx) => nextTake(tx, { orgId: org, partnerId: partner, adId }));

      const r = await get({ ad_id: adId });
      assert.equal(r.code, 200);
      assert.equal(r.body.items.length, 2);
      assert.deepEqual(r.body.items.map((i) => i.take_no), [1, 2]);
    });

    test("*** a PADDED ?ad_id= is refused, not silently trimmed ***", async () => {
      const r = await get({ ad_id: "043" });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "bad_ad_id");
      assert.match(r.body.message, /folder name/);
    });

    test("every row carries its padded folder name AND its unpadded ad number", async () => {
      const adId = newAdId();
      await asStaff((tx) => createTake(tx, { orgId: org, partnerId: partner, adId, takeNo: 1 }));
      const r = await get({ ad_id: adId });
      const row = r.body.items[0];
      assert.equal(row.ad_id, adId, "the ad number a link uses stays unpadded");
      assert.equal(row.folder_name.length >= 3, true);
      assert.equal(row.folder_name.replace(/^0+(?=\d)/, ""), adId);
    });

    test("a row says in plain words where it is stuck", async () => {
      // Chris does not read code. "editing" on its own tells him nothing.
      const row = await make({ status: "editing" });
      const r = await get({ ad_id: row.ad_id });
      assert.equal(r.body.items[0].status_means, "Submagic has it");
      assert.match(r.body.items[0].status_fired_by, /project id/);
    });

    test("the answer never carries the transcript, the raw link or the token", async () => {
      const row = await make({
        status: "staged",
        transcript: "the whole script read out loud",
        source_url: "https://example.invalid/secret.mp4"
      });
      const r = await get({ ad_id: row.ad_id });
      const item = r.body.items[0];
      assert.equal(item.transcript, undefined);
      assert.equal(item.source_url, undefined);
      assert.equal(item.approval_token, undefined);
    });

    test("fetchRows runs the SQL directly, so the column names are checked here", async () => {
      // api/creative/approvals.mjs exports its query for the same reason: an
      // endpoint whose SQL only runs behind HTTP has column names nothing checks.
      const rows = await asStaff((tx) => fetchRows(tx, {
        orgId: org, query: { status: "awaiting_approval" }, limit: 5, offset: 0
      }));
      assert.ok(Array.isArray(rows));
    });
  });
});
