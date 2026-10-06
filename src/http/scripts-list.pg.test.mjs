// Endpoint tests for GET /api/scripts/list, against real Postgres (DATABASE_URL).
//
// Lives under src/http/, not api/, because npm test's glob is "src/**" and
// "scripts/**" only (CLAUDE.md §12) — a test file next to the handler under api/
// never runs at all. Same reason src/http/scripts-write.pg.test.mjs sits here.
//
// WHAT THIS IS FOR. The write half of the Script picker shipped on 2026-09-08
// and the read half did not, so the picker on public/app/creative-factory.html
// was filled only by the save that had just happened and a reload emptied it.
// The live walk on 2026-09-17 saw exactly that: "Saved as version 1", then
// "— none —" after a reload. So the one thing this file must prove is that a
// script that was WRITTEN comes back when it is READ — end to end, through both
// handlers, not through a fixture INSERT that could pass while the real write
// path writes something the read path cannot see.
//
// asStaff() ON EVERY VERIFICATION AND SETUP QUERY that touches ad_scripts.
// The table carries the standard partner isolation policy with RLS FORCEd
// (src/partners/scope.mjs:154), so a bare db.query against it is anonymous to
// the policy and silently touches ZERO rows instead of erroring — a purge that
// deletes nothing and an UPDATE that archives nothing both look like success.
//
// THE ISOLATION TEST IS THE POINT OF THE SECOND PARTNER. One partner's scripts
// showing up in another's picker is the worst bug this endpoint can have, and
// the handler has no partner_id in its WHERE at all — the scoping is entirely
// the RLS policy's doing. So it is asserted here rather than assumed.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import { rlsPool, closeRlsPool } from "../testing/rls-pool.mjs";
import writeHandler from "../../api/scripts/write.mjs";
import listHandler from "../../api/scripts/list.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "scripts_list_pg_test";
const TITLE_TAG = "[scripts_list_pg_test]";
const KEY_TAG = "zz_test_list_%";
const SLUG_A = "zz-test-scripts-list-a";
const SLUG_B = "zz-test-scripts-list-b";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

const req = (token, { method = "GET", body = {}, query = {} } = {}) => ({
  method,
  headers: token ? { authorization: "Bearer " + token } : {},
  body,
  query
});

describe("GET /api/scripts/list", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, tokenStaff, tokenNonStaff, partnerA, partnerB;
  let scriptA1, scriptA2, scriptB1, archivedA;

  /* write — a real POST through api/scripts/write.mjs, so what this file reads
     back is what the product actually stores. */
  async function write(token, body) {
    const r = res();
    await writeHandler(req(token, { method: "POST", body }), r, { db });
    return r;
  }

  /* THE READ RUNS AS THE APP ROLE. The list is filtered by ad_scripts' forced
     row-level security, and CI's suite connects as the postgres superuser,
     which ignores every policy — so the partner-leak tests below failed there
     on 2026-10-05 for a leak production (fundhub_app) cannot have. rlsPool is
     the unprivileged pool when APP_DATABASE_URL is set, as in CI, and the
     ordinary one otherwise. Fixtures are still written as the owner. */
  async function list(token, query) {
    const r = res();
    await listHandler(req(token, { query }), r, { db, pool: rlsPool });
    return r;
  }

  const ids = (body) => (body.items || []).map((i) => i.id);

  async function purge() {
    // Children first: parent_script_id is ON DELETE RESTRICT (377:172).
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
    // partner_id is ON DELETE RESTRICT, so the partners go after their scripts.
    await db.query(`DELETE FROM partners WHERE org_id = $1 AND slug = ANY($2)`, [org, [SLUG_A, SLUG_B]]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    partnerA = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,'Scripts list fixture A',$2,'active',now()) RETURNING id`,
      [org, SLUG_A]
    )).rows[0].id;
    partnerB = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,'Scripts list fixture B',$2,'active',now()) RETURNING id`,
      [org, SLUG_B]
    )).rows[0].id;

    const staff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Scripts List Fixture','owner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.owner@example.com`]
    )).rows[0];
    tokenStaff = (await createSession(db, { staffId: staff.id, orgId: org })).token;

    /* A csm session is a STAFF principal too — requirePrincipal(["partner",
       "staff"]) admits the kind, not the role. It is here to prove that whoever
       reaches this endpoint still only ever gets the partner they named. */
    const nonStaff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Scripts List Non-Staff','csm','active') RETURNING id`,
      [org, `${EMAIL_TAG}.csm@example.com`]
    )).rows[0];
    tokenNonStaff = (await createSession(db, { staffId: nonStaff.id, orgId: org })).token;

    // Partner A: two live scripts and one that gets archived below.
    const a1 = await write(tokenStaff, {
      title: `Denial control ${TITLE_TAG}`,
      body: "HOOK: You got turned down.\nBODY: Here is what that meant.\nCTA: Book a call.",
      partner_id: partnerA,
      script_type: "vsl",
      lane: "funding600",
      angle_key: "zz_test_list_angle",
      hook_key: "zz_test_list_hook",
      offer_key: "zz_test_list_offer"
    });
    assert.equal(a1.code, 200, JSON.stringify(a1.body));
    scriptA1 = a1.body.script.id;

    /* Saved with no title on purpose — the picker labels an untitled script from
       its first words, so body_preview has to come back. The title is stamped on
       afterwards only so the purge can find the row. */
    const a2 = await write(tokenStaff, {
      body: "Second script for partner A. The words a picker would have to label it with.",
      partner_id: partnerA
    });
    assert.equal(a2.code, 200, JSON.stringify(a2.body));
    scriptA2 = a2.body.script.id;
    await asStaff((tx) => tx.query(
      `UPDATE ad_scripts SET title = $2 WHERE id = $1`, [scriptA2, `Untitled A ${TITLE_TAG}`]
    ));

    const arch = await write(tokenStaff, {
      title: `Retired script ${TITLE_TAG}`,
      body: "An old script nobody should be offered any more.",
      partner_id: partnerA
    });
    assert.equal(arch.code, 200, JSON.stringify(arch.body));
    archivedA = arch.body.script.id;
    await asStaff((tx) => tx.query(
      `UPDATE ad_scripts SET archived_at = now() WHERE id = $1`, [archivedA]
    ));

    const b1 = await write(tokenStaff, {
      title: `Somebody else's script ${TITLE_TAG}`,
      body: "This one belongs to partner B and must never appear in partner A's picker.",
      partner_id: partnerB
    });
    assert.equal(b1.code, 200, JSON.stringify(b1.body));
    scriptB1 = b1.body.script.id;
  });

  after(async () => {
    await closeRlsPool();
    await purge();
    await close();
  });

  test("a script that was written comes back when the list is read", async () => {
    const r = await list(tokenStaff, { partner_id: partnerA });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    const got = ids(r.body);
    assert.ok(got.includes(scriptA1), "the script the write endpoint saved is not in the list it should fill");
    assert.ok(got.includes(scriptA2), "the second saved script is missing from the list");
  });

  test("every column the picker labels a script with is present", async () => {
    const r = await list(tokenStaff, { partner_id: partnerA });
    const row = (r.body.items || []).find((i) => i.id === scriptA1);
    assert.ok(row, "the labelled script is not in the list");

    // The picker's label is title + version, and falls back to the first words
    // when there is no title. All three must survive the read.
    assert.equal(row.title, `Denial control ${TITLE_TAG}`);
    assert.equal(Number(row.version), 1);
    assert.ok(row.body_preview && row.body_preview.length,
      "body_preview came back empty, so an untitled script cannot be labelled");
    assert.ok(row.body_preview.length <= 120, "body_preview is not the short preview the picker asks for");

    // The five labels ride along, tidied by the write endpoint, so a screen can
    // show what a script is without a second request per row.
    assert.equal(row.script_type, "vsl");
    assert.equal(row.lane, "funding600");
    assert.equal(row.angle_key, "zz_test_list_angle");
    assert.equal(row.hook_key, "zz_test_list_hook");
    assert.equal(row.offer_key, "zz_test_list_offer");
  });

  test("another partner's script is not in this partner's list", async () => {
    const a = await list(tokenStaff, { partner_id: partnerA });
    assert.equal(a.code, 200, JSON.stringify(a.body));
    assert.ok(!ids(a.body).includes(scriptB1),
      "partner B's script appeared in partner A's list — the partner scope is not holding");

    // And the other way round, so a list that simply returns nothing cannot pass.
    const b = await list(tokenStaff, { partner_id: partnerB });
    assert.equal(b.code, 200, JSON.stringify(b.body));
    assert.ok(ids(b.body).includes(scriptB1), "partner B cannot see its own script");
    assert.ok(!ids(b.body).includes(scriptA1),
      "partner A's script appeared in partner B's list — the partner scope is not holding");
  });

  test("an archived script is hidden, and can still be asked for", async () => {
    const hidden = await list(tokenStaff, { partner_id: partnerA });
    assert.ok(!ids(hidden.body).includes(archivedA),
      "an archived script is still offered in the picker");

    const shown = await list(tokenStaff, { partner_id: partnerA, include_archived: "1" });
    assert.equal(shown.code, 200, JSON.stringify(shown.body));
    assert.ok(ids(shown.body).includes(archivedA),
      "include_archived=1 did not bring the archived script back");
    const row = (shown.body.items || []).find((i) => i.id === archivedA);
    assert.ok(row.archived_at,
      "the archived script came back with no archived_at, so nothing can mark it retired");
  });

  test("the newest script is first, so the picker opens on what was just written", async () => {
    const r = await list(tokenStaff, { partner_id: partnerA });
    const times = (r.body.items || []).map((i) => new Date(i.created_at).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i - 1] >= times[i], "the list is not newest-first");
    }
  });

  test("a staff session naming no partner is refused, never answered with everything", async () => {
    const r = await list(tokenStaff, {});
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "partner_id_required");
  });

  test("no session reaches it at all", async () => {
    const r = await list(null, { partner_id: partnerA });
    assert.equal(r.code, 401, JSON.stringify(r.body));
    assert.equal(r.body.ok, false);
  });

  test("a staff session of another role still only gets the partner it named", async () => {
    const r = await list(tokenNonStaff, { partner_id: partnerA });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.ok(!ids(r.body).includes(scriptB1), "partner B's script leaked into a partner A request");
  });

  test("POST is refused — this is a read", async () => {
    const r = res();
    await listHandler(req(tokenStaff, { method: "POST", query: { partner_id: partnerA } }), r, { db });
    assert.equal(r.code, 405, JSON.stringify(r.body));
  });
});
