// Endpoint tests for POST /api/scripts/write, against real Postgres
// (DATABASE_URL). Lives under src/http/, not api/, because npm test's glob is
// "src/**" and "scripts/**" only (CLAUDE.md §12) — a test file next to the
// handler under api/ never runs at all.
//
// Drives the handler directly rather than through netlify/functions/api.mjs and
// its ROUTES map, the same way src/http/analytics-youtube.pg.test.mjs does:
// "scripts/write" is not a key in that map yet and this lane does not own that
// file.
//
// asStaff() ON EVERY VERIFICATION QUERY, not just the handler. ad_scripts
// carries the standard partner isolation policy and ad_labels is staff-write
// only (377 Part 4e), so a bare db.query against either is anonymous to the
// policy and silently touches ZERO rows instead of erroring — a purge that
// deletes nothing and an assertion that reads nothing both look like success.
// That exact bug is written up in the header of the YouTube test this one copies.
//
// EVERY KEY THIS TEST INVENTS STARTS "zz_test_", so the purge can find them and
// so nothing it writes can be mistaken for a real angle Chris named.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import writeHandler from "../../api/scripts/write.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "scripts_write_pg_test";
const TITLE_TAG = "[scripts_write_pg_test]";
const KEY_TAG = "zz_test_%";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

const req = (token, { method = "POST", body = {}, query = {} } = {}) => ({
  method,
  headers: token ? { authorization: "Bearer " + token } : {},
  body,
  query
});

describe("POST /api/scripts/write", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, tokenStaff, tokenNonStaff;

  /* post — one call, with the title tag stamped on so the purge can find the row.
     Returns the response object so a test can assert on the status too. */
  async function post(token, body) {
    const r = res();
    await writeHandler(req(token, { body }), r, { db });
    return r;
  }

  const labelRow = (kind, key) => asStaff((tx) => tx.query(
    `SELECT kind, key, name FROM ad_labels WHERE org_id = $1 AND kind = $2 AND key = $3`,
    [org, kind, key]
  )).then((q) => q.rows);

  async function purge() {
    // Children first: parent_script_id is ON DELETE RESTRICT (377:172), so a
    // parent cannot go while a rewrite still points at it.
    await asStaff((tx) => tx.query(
      `DELETE FROM ad_scripts WHERE org_id = $1 AND title LIKE $2 AND parent_script_id IS NOT NULL`,
      [org, `%${TITLE_TAG}%`]
    ));
    await asStaff((tx) => tx.query(
      `DELETE FROM ad_scripts WHERE org_id = $1 AND title LIKE $2`,
      [org, `%${TITLE_TAG}%`]
    ));
    await asStaff((tx) => tx.query(
      `DELETE FROM ad_labels WHERE org_id = $1 AND key LIKE $2`, [org, KEY_TAG]
    ));
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    const staff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Script Writer Fixture','owner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.owner@example.com`]
    )).rows[0];
    tokenStaff = (await createSession(db, { staffId: staff.id, orgId: org })).token;

    /* 'partner' is a real role in the staff_roles catalog (036_partner_role.sql)
       and is deliberately NOT in ROLE_SETS.STAFF (src/http/read-api.mjs:141) —
       the shortest path to a REAL 403 rather than a 401. The distinction
       matters: a 401 would prove only that the session was missing, which the
       unauthenticated test below already covers. This one proves requireRole()
       is actually being called after requireAuth(), which is the CLAUDE.md §12
       trap this handler is written around. */
    const nonStaff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Script Writer Non-Staff Fixture','partner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.partner@example.com`]
    )).rows[0];
    tokenNonStaff = (await createSession(db, { staffId: nonStaff.id, orgId: org })).token;
  });

  after(async () => {
    await purge();
    await close();
  });

  test("a script saves with all five labels, and the house partner owns it", async () => {
    const r = await post(tokenStaff, {
      title: `Denial control ${TITLE_TAG}`,
      body: "HOOK: You got turned down.\nBODY: Here is what that actually meant.\nCTA: Book a call.",
      hook_text: "You got turned down.",
      script_type: "VSL",
      lane: "funding600",
      angle_key: "ZZ Test Angle One",
      hook_key: "ZZ Test Hook One",
      offer_key: "ZZ Test Offer One"
    });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.is_rewrite, false);

    const s = r.body.script;
    assert.ok(s.id, "no script row came back");
    assert.equal(s.version, 1);
    assert.equal(s.parent_script_id, null);
    assert.equal(s.script_type, "vsl");
    assert.equal(s.lane, "funding600");
    assert.equal(s.angle_key, "zz_test_angle_one");
    assert.equal(s.hook_key, "zz_test_hook_one");
    assert.equal(s.offer_key, "zz_test_offer_one");
    assert.equal(s.hook_text, "You got turned down.");

    // The row is really in the table, owned by the house partner 377 Part 1
    // created — not just echoed back by the handler.
    const row = (await asStaff((tx) => tx.query(
      `SELECT a.id, a.version, a.angle_key, a.hook_key, a.offer_key, a.script_type,
              a.lane::text AS lane, p.slug
         FROM ad_scripts a JOIN partners p ON p.id = a.partner_id
        WHERE a.id = $1`, [s.id]
    ))).rows[0];
    assert.ok(row, "the script was not written to ad_scripts");
    assert.equal(row.slug, "fundhub-house");
    assert.equal(row.angle_key, "zz_test_angle_one");
    assert.equal(row.lane, "funding600");
  });

  const readScript = (id) => asStaff((tx) => tx.query(
    `SELECT id, version, body, title, parent_script_id, root_script_id, ad_id, status, source,
            archived_at, updated_at
       FROM ad_scripts WHERE id = $1`, [id]
  )).then((q) => q.rows[0]);

  /* A number no other suite will be using, for a parent that has to carry one.
     Nine digits, no leading zero (393's shape). */
  const testAdNumber = () => String(900000000 + Math.floor(Math.random() * 99999999));

  test("a rewrite archives its parent and inserts the new version with the same root and number, in one transaction", async () => {
    const first = await post(tokenStaff, {
      title: `Parent ${TITLE_TAG}`,
      body: "First draft. The words that were there before.",
      angle_key: "zz_test_rewrite_angle"
    });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    const parentId = first.body.script.id;
    // write.mjs never hands out numbers; the parent is given one here so the
    // test can prove the rewrite carries it.
    const adNumber = testAdNumber();
    await asStaff((tx) => tx.query(
      `UPDATE ad_scripts SET ad_id = $2, status = 'locked' WHERE id = $1`, [parentId, adNumber]
    ));

    const before = await readScript(parentId);
    assert.equal(before.root_script_id, parentId, "an original script must be its own root");
    assert.equal(before.archived_at, null);

    const second = await post(tokenStaff, {
      title: `Rewrite ${TITLE_TAG}`,
      parent_script_id: parentId,
      body: "Second draft. Completely different words.",
      angle_key: "zz_test_rewrite_angle"
    });
    assert.equal(second.code, 200, JSON.stringify(second.body));
    assert.equal(second.body.is_rewrite, true);

    const child = second.body.script;
    assert.notEqual(child.id, parentId, "the rewrite reused the parent's id");
    assert.equal(child.parent_script_id, parentId);
    assert.equal(child.version, 2);
    assert.equal(child.body, "Second draft. Completely different words.");
    assert.equal(child.root_script_id, parentId, "the rewrite must share its parent's root");
    assert.equal(child.ad_id, adNumber, "the rewrite must keep the parent's ad number");
    assert.equal(child.status, "locked", "editing a locked script keeps it locked (spec 7.4)");
    assert.equal(child.archived_at, null, "the new version is the live one");

    // The parent is archived — and nothing else about it moved. Its words are
    // still there to read beside the rewrite.
    const after = await readScript(parentId);
    assert.ok(after.archived_at, "the parent was left live — a script now has one live version");
    assert.equal(after.body, before.body, "the rewrite overwrote the parent's words");
    assert.equal(after.title, before.title);
    assert.equal(Number(after.version), Number(before.version), "the parent's version moved");
    assert.equal(after.ad_id, adNumber, "the parent lost its number");
    assert.equal(after.root_script_id, parentId);
    assert.equal(after.status, "locked", "a parent the machine did not write keeps its status");

    // Same transaction: the archive stamp and the new row were written at the
    // same instant (now() is the transaction's start time in Postgres).
    const childRow = await readScript(child.id);
    const created = (await asStaff((tx) => tx.query(
      `SELECT created_at FROM ad_scripts WHERE id = $1`, [child.id]
    ))).rows[0].created_at;
    assert.equal(new Date(after.archived_at).getTime(), new Date(created).getTime(),
      "the archive and the insert did not happen in one transaction");
    assert.equal(childRow.root_script_id, parentId);

    // Two rows, one root, one of them live.
    const family = (await asStaff((tx) => tx.query(
      `SELECT id, archived_at FROM ad_scripts WHERE root_script_id = $1`, [parentId]
    ))).rows;
    assert.equal(family.length, 2);
    assert.equal(family.filter((r) => !r.archived_at).length, 1, "more than one live version");
  });

  test("a machine-written parent becomes superseded when it is rewritten", async () => {
    const first = await post(tokenStaff, {
      title: `Machine parent ${TITLE_TAG}`,
      body: "A draft the machine wrote."
    });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    const parentId = first.body.script.id;
    await asStaff((tx) => tx.query(`UPDATE ad_scripts SET source = 'machine' WHERE id = $1`, [parentId]));

    const second = await post(tokenStaff, {
      title: `Machine rewrite ${TITLE_TAG}`,
      parent_script_id: parentId,
      body: "Chris's rewrite of the machine's draft."
    });
    assert.equal(second.code, 200, JSON.stringify(second.body));
    assert.equal(second.body.script.status, "draft", "a draft's rewrite is a draft");
    assert.equal(second.body.script.source, "chris");

    const parent = await readScript(parentId);
    assert.ok(parent.archived_at);
    assert.equal(parent.status, "superseded");
  });

  test("rewriting a version that was already replaced is 409 stale, names the live version, and writes nothing", async () => {
    const first = await post(tokenStaff, {
      title: `Stale parent ${TITLE_TAG}`,
      body: "Version one."
    });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    const v1 = first.body.script.id;

    const second = await post(tokenStaff, {
      title: `Stale v2 ${TITLE_TAG}`,
      parent_script_id: v1,
      body: "Version two."
    });
    assert.equal(second.code, 200, JSON.stringify(second.body));
    const v2 = second.body.script.id;

    const beforeCount = await scriptCount();
    const stale = await post(tokenStaff, {
      title: `Stale fork ${TITLE_TAG}`,
      parent_script_id: v1,
      body: "A second rewrite of version one, from a screen that never saw version two."
    });
    await refused(stale, 409, "stale");
    assert.ok(stale.body.current, "the 409 must name the live version");
    assert.equal(stale.body.current.id, v2);
    assert.equal(stale.body.current.version, 2);
    assert.equal(stale.body.current.body, "Version two.");
    assert.ok("parts" in stale.body.current, "current must carry parts (spec 7.8 shape)");

    assert.equal(await scriptCount(), beforeCount, "a stale rewrite wrote a row");
    const live = await readScript(v2);
    assert.equal(live.archived_at, null, "a stale rewrite archived the live version");
  });

  test("when the new version cannot be saved, the parent is not archived either", async () => {
    // A trigger that refuses one marked insert, so the failure lands AFTER the
    // archive has run inside the handler's transaction. Owner-only DDL, fine on
    // the suite's connection (pg test files run one at a time). Dropped in
    // finally whatever happens.
    const MARK = "[zz_force_insert_failure]";
    await db.query(`
      CREATE OR REPLACE FUNCTION zz_test_scripts_write_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.title LIKE '%${MARK}%' THEN
          RAISE EXCEPTION 'zz test: refused on purpose';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.query(`DROP TRIGGER IF EXISTS zz_test_scripts_write_fail ON ad_scripts`);
    await db.query(`
      CREATE TRIGGER zz_test_scripts_write_fail BEFORE INSERT ON ad_scripts
      FOR EACH ROW EXECUTE FUNCTION zz_test_scripts_write_fail()`);
    try {
      const first = await post(tokenStaff, {
        title: `Atomic parent ${TITLE_TAG}`,
        body: "The live version, which must stay live."
      });
      assert.equal(first.code, 200, JSON.stringify(first.body));
      const parentId = first.body.script.id;

      const beforeCount = await scriptCount();
      const r = await post(tokenStaff, {
        title: `Atomic rewrite ${MARK} ${TITLE_TAG}`,
        parent_script_id: parentId,
        body: "This insert is refused by the test trigger."
      });
      assert.equal(r.code, 500, JSON.stringify(r.body));

      const parent = await readScript(parentId);
      assert.equal(parent.archived_at, null,
        "the parent was archived although its rewrite was never saved — the two are not one transaction");
      assert.equal(await scriptCount(), beforeCount, "a row was written by a failed rewrite");
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS zz_test_scripts_write_fail ON ad_scripts`);
      await db.query(`DROP FUNCTION IF EXISTS zz_test_scripts_write_fail()`);
    }
  });

  test("a brand new angle nobody has registered saves, and the dictionary learns it", async () => {
    // Naming is never a blocker (owner-set 2026-09-06). Nothing has to be
    // pre-registered for this to save.
    const key = "zz_test_brand_new_angle";
    assert.deepEqual(await labelRow("angle", key), [], "the fixture key already existed");

    const r = await post(tokenStaff, {
      title: `Brand new angle ${TITLE_TAG}`,
      body: "An angle nobody wrote down first.",
      angle_key: "ZZ Test Brand New Angle"
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.script.angle_key, key);

    const learned = await labelRow("angle", key);
    assert.equal(learned.length, 1, "the dictionary did not learn the new angle");
    assert.equal(learned[0].name, "Zz Test Brand New Angle");
  });

  test("three spellings of one angle land on one key, and one dictionary row", async () => {
    // The split 377's header warns about: 'denial_angle' and 'denialangle' both
    // existing would cut one angle's numbers in half with no error anywhere.
    const key = "zz_test_split_angle";
    for (const typed of ["ZZ Test Split Angle", "zz-test-split-angle", "zz_test_split_angle"]) {
      const r = await post(tokenStaff, {
        title: `Split ${typed} ${TITLE_TAG}`,
        body: `Written as ${typed}.`,
        angle_key: typed
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.script.angle_key, key, `"${typed}" was stored as a different key`);
    }

    const grouped = (await asStaff((tx) => tx.query(
      `SELECT angle_key, count(*)::int AS n FROM ad_scripts
        WHERE org_id = $1 AND title LIKE $2 AND angle_key IS NOT NULL
        GROUP BY angle_key`,
      [org, `%Split %${TITLE_TAG}%`]
    ))).rows;
    assert.deepEqual(grouped, [{ angle_key: key, n: 3 }],
      "the three spellings split into more than one group");

    assert.equal((await labelRow("angle", key)).length, 1, "one angle produced two dictionary rows");
  });

  test("a friendly name a human set is never overwritten", async () => {
    const key = "zz_test_named_angle";
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_labels (org_id, kind, key, name, description)
       VALUES ($1,'angle',$2,'Chris Own Wording','What Chris means by it.')`,
      [org, key]
    ));

    const r = await post(tokenStaff, {
      title: `Named angle ${TITLE_TAG}`,
      body: "Uses an angle that already has a name.",
      angle_key: "ZZ Test Named Angle"
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.script.angle_key, key);

    const rows = await labelRow("angle", key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Chris Own Wording",
      "the writer overwrote a name a human typed — it may only FILL IN a blank one");
  });

  const scriptCount = () => asStaff((tx) => tx.query(
    `SELECT count(*)::int AS n FROM ad_scripts WHERE org_id = $1 AND title LIKE $2`,
    [org, `%${TITLE_TAG}%`]
  )).then((q) => q.rows[0].n);

  /* refused — the shared shape assertion for every refusal.
     A refusal is only useful if a screen can tell WHICH refusal it was without
     reading English. So `error` must be the short code, `message` the sentence,
     and the two must never be the same field: a screen that switches on `error`
     and is handed a paragraph matches no case and shows a generic failure
     instead of the sentence. Also proves the refusal wrote nothing. */
  async function refused(r, status, code) {
    assert.equal(r.code, status, JSON.stringify(r.body));
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, code, "the error code is not the short code a screen branches on");
    assert.ok(typeof r.body.message === "string" && r.body.message.length > 0,
      "a refusal must carry a readable sentence in `message`");
    assert.ok(!r.body.error.includes(" "), "`error` holds a sentence, not a code");
  }

  test("an unauthenticated call is refused and writes nothing", async () => {
    const beforeCount = await scriptCount();

    const r = await post(null, {
      title: `Should never exist ${TITLE_TAG}`,
      body: "Written with no session at all."
    });
    assert.equal(r.code, 401);
    assert.equal(r.body.ok, false);

    assert.equal(await scriptCount(), beforeCount, "an unauthenticated call wrote a row");
  });

  test("a signed-in job title that is not staff gets 403 and writes nothing", async () => {
    // Signed in for real, just not allowed. requireAuth answers "is this a
    // signed-in employee" and NOTHING ELSE; a `roles` key handed to it is
    // silently dropped (CLAUDE.md §12). If requireRole were missing this would
    // come back 200 and the row would be in the table.
    const beforeCount = await scriptCount();

    const r = await post(tokenNonStaff, {
      title: `Wrong job title ${TITLE_TAG}`,
      body: "Written by somebody whose role is not on the staff list."
    });
    assert.equal(r.code, 403, JSON.stringify(r.body));
    assert.equal(r.body.ok, false);

    assert.equal(await scriptCount(), beforeCount,
      "a role that is not staff wrote a script — the role gate is not running");
  });

  test("a lane that is not one of the five is refused, and refused readably", async () => {
    // lane is a typed column (ad_lane). Without this check the answer would be a
    // Postgres type error nobody can read; with it, a plain sentence naming the
    // five real lanes.
    const beforeCount = await scriptCount();

    const r = await post(tokenStaff, {
      title: `Bad lane ${TITLE_TAG}`,
      body: "A script filed under a lane that does not exist.",
      lane: "not_a_real_lane"
    });
    await refused(r, 400, "lane_invalid");
    assert.ok(r.body.message.includes("funding600"), "the refusal does not name the real lanes");

    assert.equal(await scriptCount(), beforeCount, "a script with an unknown lane was written");
  });

  test("'unknown' is not an accepted lane even though the database type has it", async () => {
    // ad_lane really does contain 'unknown', so the database would take this.
    // It means "a value arrived on the wire and it was garbage", which is not
    // what a person typing into a form means. Refused on purpose.
    const r = await post(tokenStaff, {
      title: `Unknown lane ${TITLE_TAG}`,
      body: "A script somebody filed as unknown.",
      lane: "unknown"
    });
    await refused(r, 400, "lane_invalid");
  });

  test("a label that cannot be tidied into a legal key is refused, showing what it became", async () => {
    // "3 Second Hook" tidies to "3_second_hook", which the database refuses
    // because a key must start with a letter. The refusal has to SHOW that, or
    // the person retypes the same thing and gets the same answer.
    const beforeCount = await scriptCount();

    const r = await post(tokenStaff, {
      title: `Bad label ${TITLE_TAG}`,
      body: "A script whose hook label cannot become a legal key.",
      hook_key: "3 Second Hook"
    });
    await refused(r, 400, "label_invalid");
    assert.ok(r.body.message.includes("hook_key"), "the refusal does not say which field was wrong");
    assert.ok(r.body.message.includes("3_second_hook"), "the refusal does not show what the typed text became");

    assert.equal(await scriptCount(), beforeCount, "a script with an illegal label was written");
    assert.deepEqual(await labelRow("hook", "3_second_hook"), [],
      "an illegal label was still taught to the dictionary");
  });

  test("a rewrite may not be moved to a different partner, and says so as a code", async () => {
    const first = await post(tokenStaff, {
      title: `Move parent ${TITLE_TAG}`,
      body: "The original, owned by the house partner."
    });
    assert.equal(first.code, 200, JSON.stringify(first.body));

    // Any partner in this org that is NOT the one the parent sits on.
    const other = (await asStaff((tx) => tx.query(
      `SELECT id FROM partners WHERE org_id = $1 AND id <> $2 LIMIT 1`,
      [org, first.body.script.partner_id]
    ))).rows[0];
    if (!other) return; // only the house partner exists here; nothing to move to.

    const r = await post(tokenStaff, {
      title: `Move rewrite ${TITLE_TAG}`,
      parent_script_id: first.body.script.id,
      partner_id: other.id,
      body: "A rewrite somebody tried to file under a different partner."
    });
    await refused(r, 400, "partner_id_mismatch");
  });

  test("rewriting a script that does not exist is a plain 404 with a code", async () => {
    const r = await post(tokenStaff, {
      title: `Ghost parent ${TITLE_TAG}`,
      parent_script_id: "00000000-0000-4000-8000-000000000000",
      body: "A rewrite of nothing."
    });
    await refused(r, 404, "parent_script_not_found");
  });
});
