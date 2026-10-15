// Finish-the-853 batch 25, practice tests for Shoot Day: read what to film, plan or close a shoot, and
// count a take (Got it / Another take). Each test runs the REAL api/ handler (real sign-in and role
// gate, real film-key check, real shoot store and plan rules) over an in-memory ad_scripts and
// marketing_shoots world that answers by the SQL text the code sends. Fake data only.
import assert from "node:assert/strict";
import test from "node:test";

import shootHandler from "../../api/marketing/shoot.mjs";
import markHandler from "../../api/marketing/shoot/mark.mjs";
import { mintFilmKey, readFilmKey } from "../marketing/shoot-film-key.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, assertRoleGate, assertSent, assertSqlHas, call, dataCalls, sentStatement, sqlCalls,
} from "../testing/fin-b25-kit.mjs";
import { WORLD_NOW, scriptRow, scriptWorld } from "../testing/fin-b25-script-world.mjs";

const ROOT_A = "a5000000-0000-4000-8000-0000000000f0";
const ROOT_B = "a5000000-0000-4000-8000-0000000000f1";
const ROOT_C = "a5000000-0000-4000-8000-0000000000f2";
const SHOOT_ID = "5b000000-0000-4000-8000-000000000001";
const OTHER_SHOOT = "5b000000-0000-4000-8000-0000000000aa";
const SECRET = "s".repeat(40);
const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const SHOOT_STARTED = new Date("2026-10-13T16:00:00.000Z");

const lockedScript = (over = {}) => scriptRow({
  id: "a5000000-0000-4000-8000-000000000001", root_script_id: ROOT_A, status: "locked", ad_id: "91", title: "Say the cause first",
  film_order: 1, locked_at: new Date("2026-10-12T10:00:00.000Z"), ...over,
});
const secondScript = (over = {}) => scriptRow({
  id: "a5000000-0000-4000-8000-000000000002", root_script_id: ROOT_B, status: "locked", ad_id: "92", title: "No greeting",
  film_order: 2, locked_at: new Date("2026-10-12T11:00:00.000Z"), body: "Skip the hello.\n\nSay the number.", ...over,
});

function shootWorld({ scripts = [], shoots = [], videos = [], funnels = [], defaultOrg = ORG_ID } = {}) {
  const world = scriptWorld({ scripts });
  const state = Object.assign(world, { shoots, videos, inserts: [], updates: [], markUpdates: [], orgReads: 0 });
  const funnelOf = (s) => funnels.find((f) => f.org_id === s.org_id && f.key === s.funnel_key) || null;
  const planRow = (s) => ({ ...s, batch_week_key: null, plan_offer_key: s.offer_key ?? funnelOf(s)?.offer_key ?? null, plan_funnel_tag: funnelOf(s)?.tag ?? null, idea_kind: null });
  const isVisible = (s) => s.source !== "import" && !s.batch_id;
  state.rules = [
    [/^\s*SELECT id FROM orgs WHERE is_default LIMIT 1/, () => { state.orgReads += 1; return defaultOrg ? [{ id: defaultOrg }] : []; }],
    [/^\s*SELECT \* FROM marketing_shoots WHERE org_id = \$1 AND status <> 'done'/, (_sql, params) =>
      shoots.filter((s) => s.org_id === params[0] && s.status !== "done").sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 1).map((s) => ({ ...s }))],
    [/^\s*SELECT \* FROM marketing_shoots WHERE id = \$1 AND org_id = \$2 FOR UPDATE/, (sql, params) => rowsWhere(shoots, sql, params).map((s) => ({ ...s }))],
    // every live version of these roots, with the plan columns
    [/^\s*SELECT s\.\*, b\.week_key AS batch_week_key[\s\S]*s\.root_script_id = ANY\(\$2::uuid\[\]\)/, (_sql, params) =>
      state.scripts.filter((s) => s.org_id === params[0] && params[1].includes(s.root_script_id) && s.archived_at == null && isVisible(s)).map(planRow)],
    // every script ready to film
    [/^\s*SELECT s\.\*, b\.week_key AS batch_week_key[\s\S]*s\.ad_id IS NOT NULL/, (_sql, params) =>
      state.scripts.filter((s) => s.org_id === params[0] && s.archived_at == null && isVisible(s)
        && (s.status === "locked" || (s.status === "filmed" && s.needs_retake)) && s.ad_id != null).map(planRow)],
    [/^\s*SELECT ad_id, take_no, created_at FROM ad_videos/, (_sql, params) =>
      videos.filter((v) => v.org_id === params[0] && params[1].includes(v.ad_id) && v.take_no != null && (params[2] === null || new Date(v.created_at) < new Date(params[2])))],
    [/FROM marketing_shoots sh\s+CROSS JOIN LATERAL jsonb_each/, []],
    [/^\s*SELECT DISTINCT ON \(ad_id\) ad_id, status/, (_sql, params) =>
      videos.filter((v) => v.org_id === params[0] && params[1].includes(v.ad_id) && new Date(v.created_at) >= new Date(params[2]) && !["scripted", "filming"].includes(v.status))
        .sort((a, b) => (b.take_no ?? 0) - (a.take_no ?? 0))],
    [/^\s*SELECT count\(\*\)::int AS n FROM ad_videos\s+WHERE org_id = \$1 AND ad_id IS NULL/, (_sql, params) =>
      [{ n: videos.filter((v) => v.org_id === params[0] && v.ad_id == null && new Date(v.created_at) >= new Date(params[1])).length }]],
    [/^\s*SELECT sh\.id, sh\.shoot_date, sh\.root_script_ids, sh\.marks, sh\.finished_at/, (_sql, params) =>
      shoots.filter((s) => s.org_id === params[0] && s.status === "done").map((s) => ({ ...s, finished: s.finished_count ?? 1 }))],
    [/^\s*INSERT INTO marketing_shoots/, (sql, params) => {
      const row = { id: SHOOT_ID, org_id: params[0], shoot_date: params[1] ?? "2026-10-14", root_script_ids: params[2], marks: {}, status: "planned", started_at: null, finished_at: null, created_at: WORLD_NOW, updated_at: WORLD_NOW };
      state.inserts.push({ sql, params, row });
      shoots.push(row);
      return [{ ...row }];
    }],
    [/^\s*UPDATE marketing_shoots\s+SET root_script_ids = COALESCE/, (sql, params) => {
      const hit = rowsWhere(shoots, sql, params);
      state.updates.push({ sql, params });
      for (const row of hit) {
        if (params[2] !== null) row.root_script_ids = params[2];
        if (params[3] !== null) row.shoot_date = params[3];
        if (params[4] !== null) row.status = params[4];
        if (["filming", "uploaded", "done"].includes(params[4])) row.started_at = row.started_at || WORLD_NOW;
        if (params[4] === "done") row.finished_at = WORLD_NOW;
        row.updated_at = WORLD_NOW;
      }
      return hit.map((r) => ({ ...r }));
    }],
    [/^\s*UPDATE marketing_shoots\s+SET marks = \$3::jsonb/, (sql, params) => {
      const hit = rowsWhere(shoots, sql, params);
      state.markUpdates.push({ sql, params });
      for (const row of hit) {
        row.marks = JSON.parse(params[2]);
        if (row.status === "planned") row.status = "filming";
        row.started_at = row.started_at || WORLD_NOW;
      }
      return [];
    }],
    ...world.rules,
  ];
  return state;
}

const openShoot = (over = {}) => ({
  id: SHOOT_ID, org_id: ORG_ID, shoot_date: "2026-10-14", root_script_ids: [ROOT_A, ROOT_B], marks: {}, status: "planned",
  started_at: null, finished_at: null, created_at: SHOOT_STARTED, updated_at: SHOOT_STARTED, ...over,
});

/* ── GET marketing/shoot ───────────────────────────────────────────────────────────────────────────── */

test("GET marketing/shoot answers the open shoot in order with each script's file name, take number and read time, the scripts still to plan, and a film link for the teleprompter", async () => {
  const world = shootWorld({
    scripts: [lockedScript(), secondScript(), scriptRow({ id: "a5000000-0000-4000-8000-000000000003", root_script_id: ROOT_C, status: "locked", ad_id: "93", title: "Third ad", film_order: 3, org_id: OTHER_ORG_ID })],
    shoots: [openShoot({ marks: { [ROOT_A]: { takes: 1, got_it: true, at: "2026-10-14T15:00:00.000Z" } } })],
    videos: [{ org_id: ORG_ID, ad_id: "91", take_no: 2, created_at: "2026-10-12T09:00:00.000Z", status: "approved" }],
  });
  const result = await call(shootHandler, { query: { wpm: "180" }, rules: world.rules, deps: { now: () => WORLD_NOW, filmSecret: SECRET } });
  assert.equal(result.status, 200);
  assert.equal(result.body.wpm, 180);
  const shoot = result.body.shoot;
  assert.equal(shoot.id, SHOOT_ID);
  assert.equal(shoot.status, "planned");
  assert.equal(shoot.shoot_date, "2026-10-14");
  assert.deepEqual(shoot.scripts.map((s) => s.root_script_id), [ROOT_A, ROOT_B], "in the shoot's own order, this company's scripts only");
  const [a, b] = shoot.scripts;
  assert.equal(a.take_no, 4, "two takes were filed before the shoot, one was rolled on it, so the next is take 4");
  assert.equal(a.take_file_name, "Direct Book Ad 91 — Say the cause first Take 4.mp4");
  assert.equal(a.last_take_file_name, "Direct Book Ad 91 — Say the cause first Take 3.mp4");
  assert.equal(a.got_it, true);
  assert.equal(a.takes, 1);
  assert.equal(b.take_no, 1);
  assert.equal(b.take_file_name, "Direct Book Ad 92 — No greeting Take 1.mp4");
  assert.equal(b.got_it, false);
  assert.equal(b.words, 6);
  assert.equal(b.teleprompter_text, "Skip the hello.\n\nSay the number.");
  assert.deepEqual(shoot.board.map((r) => [r.ad_id, r.step]), [["91", "filmed"]], "an ad with a Got it mark shows on the board");
  assert.equal(shoot.estimated_minutes, 5);
  assert.deepEqual(result.body.plan_candidates.map((s) => s.root_script_id), [ROOT_B], "the script already marked Got it is not offered again, nor is another company's");
  assert.deepEqual(result.body.past_shoots, []);
  assert.equal(result.body.as_of, WORLD_NOW.toISOString());
  const key = readFilmKey(result.body.film.path.split("k=")[1], { secret: SECRET, now: () => WORLD_NOW.getTime() });
  assert.deepEqual([key.orgId, key.shootId], [ORG_ID, SHOOT_ID], "the film link names this company and this shoot");

  const open = sqlCalls(result, /FROM marketing_shoots WHERE org_id = \$1 AND status <> 'done'/)[0];
  assert.deepEqual(open.params, [ORG_ID]);
  assertSqlHas(open.sql, { company: "WHERE org_id = $1", openOnly: "status <> 'done'" });
  const ready = sqlCalls(result, /s\.ad_id IS NOT NULL/)[0];
  assert.deepEqual(ready.params, [ORG_ID]);
  assertSqlHas(ready.sql, { company: "WHERE s.org_id = $1", live: "s.archived_at IS NULL", ready: "(s.status = 'locked' OR (s.status = 'filmed' AND s.needs_retake))" });
  const filed = sqlCalls(result, /FROM ad_videos\s+WHERE org_id = \$1 AND ad_id = ANY/)[0];
  assert.equal(filed.params[0], ORG_ID);
  assert.equal(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)), true, "reading a shoot writes nothing");
  // The stand-in answers each read with its own JS, so the statements that decide the file names, the
  // take numbers, the board and the lists are pinned as sent: this company only, live versions only,
  // visible ones only, ready scripts only, clips before the shoot for the take number and since it for the
  // board, and the past shoots newest first.
  assertSent(result, "shoot.open", "shoot.live_scripts", "shoot.ready_scripts", "shoot.prior_videos", "shoot.prior_closed",
    "shoot.board_videos", "shoot.unmatched", "shoot.past");
  assert.equal(sentStatement(result, "shoot.prior_videos").params[2] instanceof Date || typeof sentStatement(result, "shoot.prior_videos").params[2] === "string", true, "the take number counts clips before the shoot was made");
  assert.deepEqual(sentStatement(result, "shoot.board_videos").params.slice(0, 2), [ORG_ID, ["91", "92"]]);
});

test("GET marketing/shoot lists the last closed shoots of this company with how many scripts, how many were marked Got it and how many have a finished video", async () => {
  const done = (over) => openShoot({ status: "done", marks: {}, finished_at: new Date("2026-10-10T20:00:00.000Z"), ...over });
  const world = shootWorld({
    scripts: [lockedScript(), secondScript()],
    shoots: [
      done({ id: "5b000000-0000-4000-8000-0000000000c1", shoot_date: "2026-10-09", root_script_ids: [ROOT_A, ROOT_B], marks: { [ROOT_A]: { takes: 2, got_it: true }, [ROOT_B]: { takes: 1, got_it: false } }, finished_count: 1 }),
      done({ id: "5b000000-0000-4000-8000-0000000000c2", org_id: OTHER_ORG_ID, root_script_ids: [ROOT_A] }),
      openShoot({ id: "5b000000-0000-4000-8000-0000000000c3" }),
    ],
  });
  const result = await call(shootHandler, { rules: world.rules, deps: { now: () => WORLD_NOW, filmSecret: SECRET } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.past_shoots, [{
    id: "5b000000-0000-4000-8000-0000000000c1", shoot_date: "2026-10-09", scripts: 2, filmed: 1, finished: 1, finished_at: "2026-10-10T20:00:00.000Z",
  }], "this company's closed shoots only, with the count of Got it marks as filmed");
  assertSent(result, "shoot.past");
  assert.deepEqual(sentStatement(result, "shoot.past").params, [ORG_ID]);
});

test("GET marketing/shoot: a wrong wpm is refused, an old bookmark with no sign-in reads the default company, a film key reads that one shoot, and a bad key reads nothing", async () => {
  const world = shootWorld({ scripts: [lockedScript(), secondScript()], shoots: [openShoot()] });
  const deps = { now: () => WORLD_NOW, filmSecret: SECRET };
  const badWpm = await call(shootHandler, { query: { wpm: "30" }, rules: world.rules, deps });
  assert.equal(badWpm.status, 400);
  assert.equal(badWpm.body.field, "wpm");

  const openRead = await call(shootHandler, { anonymous: true, withSession: false, headers: {}, rules: world.rules, deps });
  assert.equal(openRead.status, 200);
  assert.equal(openRead.body.shoot.id, SHOOT_ID);
  assert.equal(openRead.body.film, undefined, "no film link is handed to someone who did not sign in");
  assert.equal(world.orgReads, 1);
  assert.deepEqual(sqlCalls(openRead, /FROM marketing_shoots WHERE org_id = \$1/)[0].params, [ORG_ID], "the default company's shoot");
  assertSent(openRead, "shoot.default_org");

  const noOrg = shootWorld({ scripts: [], shoots: [], defaultOrg: null });
  const empty = await call(shootHandler, { anonymous: true, withSession: false, headers: {}, rules: noOrg.rules, deps });
  assert.deepEqual(empty.body, { shoot: null, plan_candidates: [], plan_estimated_minutes: 0, past_shoots: [], wpm: 150, as_of: WORLD_NOW.toISOString() });

  const key = mintFilmKey({ orgId: ORG_ID, shootId: SHOOT_ID, secret: SECRET, now: () => WORLD_NOW.getTime() }).token;
  const filmed = await call(shootHandler, { anonymous: true, withSession: false, headers: { "x-shoot-film": key }, rules: world.rules, deps });
  assert.equal(filmed.status, 200);
  assert.equal(filmed.body.shoot.id, SHOOT_ID);
  assert.equal(dataCalls(filmed).some((c) => /FROM live JOIN staff/.test(c.sql)), false, "a film key is not a staff session");
  assert.equal(world.orgReads, 1, "the default company is not consulted when a key names the company");

  const otherKey = mintFilmKey({ orgId: ORG_ID, shootId: OTHER_SHOOT, secret: SECRET, now: () => WORLD_NOW.getTime() }).token;
  const wrongShoot = await call(shootHandler, { anonymous: true, withSession: false, headers: { "x-shoot-film": otherKey }, rules: world.rules, deps });
  assert.equal(wrongShoot.status, 404, "a key for a shoot that is not the open one opens nothing");

  const forged = await call(shootHandler, { anonymous: true, withSession: false, headers: { "x-shoot-film": key.slice(0, -3) + "abc" }, rules: world.rules, deps });
  assert.equal(forged.status, 404);
  assert.match(forged.body.message, /did not open/);
  assert.equal(world.orgReads, 1, "a bad key never falls through to the open read");
});

test("GET marketing/shoot: a signed-in staff role that is not owner or admin is refused before anything is read", async () => {
  const world = shootWorld({ scripts: [], shoots: [] });
  await assertRoleGate(shootHandler, ["owner", "admin"], { rules: world.rules, deps: { now: () => WORLD_NOW, filmSecret: SECRET } });
});

/* ── POST marketing/shoot ──────────────────────────────────────────────────────────────────────────── */

test("POST marketing/shoot plans a shoot from approved scripts, sets the film order to the plan, and refuses a second open shoot, an unapproved script and an unknown one", async () => {
  const world = shootWorld({
    scripts: [lockedScript(), secondScript(), scriptRow({ id: "a5000000-0000-4000-8000-000000000003", root_script_id: ROOT_C, status: "draft", title: "Still a draft" })],
  });
  const deps = { now: () => WORLD_NOW, filmSecret: SECRET };
  const planned = await call(shootHandler, {
    method: "POST", body: { request_id: REQ(1), root_script_ids: [ROOT_B, ROOT_A], shoot_date: "2026-10-15" }, rules: world.rules, deps,
  });
  assert.equal(planned.status, 200);
  const shoot = planned.body.shoot;
  assert.equal(shoot.status, "planned");
  assert.equal(shoot.shoot_date, "2026-10-15");
  assert.deepEqual(shoot.root_script_ids, [ROOT_B, ROOT_A]);
  assert.deepEqual(shoot.scripts.map((s) => s.ad_id), ["92", "91"]);
  assert.equal(world.inserts.length, 1);
  assert.deepEqual(world.inserts[0].params, [ORG_ID, "2026-10-15", [ROOT_B, ROOT_A]], "filed under the session's company");
  assert.deepEqual(world.orderWrite, { org: ORG_ID, order: [ROOT_B, ROOT_A] }, "one order, two tabs: the film order follows the plan");
  assert.equal(world.scripts[1].film_order, 1);
  assert.equal(world.scripts[0].film_order, 2);
  const lock = sqlCalls(planned, /hashtextextended\('marketing_shoots:'/)[0];
  assert.deepEqual(lock.params, [ORG_ID]);
  assertSqlHas(sqlCalls(planned, /FROM marketing_shoots WHERE org_id = \$1 AND status <> 'done'/)[0].sql, { locked: "FOR UPDATE" });
  // The new shoot's day defaults to today in Arizona (not UTC, not none), and is this company's.
  assertSent(planned, "shoot.lock", "shoot.open_locked", "shoot.live_scripts", "shoot.insert", "scripts.order_found", "scripts.order_write");

  const second = await call(shootHandler, {
    method: "POST", body: { request_id: REQ(2), root_script_ids: [ROOT_A] }, rules: world.rules, deps,
  });
  assert.equal(second.status, 400);
  assert.equal(second.body.field, "id");
  assert.match(second.body.message, /already planned/);
  assert.equal(world.inserts.length, 1);

  const fresh = shootWorld({ scripts: [lockedScript(), scriptRow({ id: "a5000000-0000-4000-8000-000000000003", root_script_id: ROOT_C, status: "draft" })] });
  const unapproved = await call(shootHandler, { method: "POST", body: { request_id: REQ(3), root_script_ids: [ROOT_C] }, rules: fresh.rules, deps });
  assert.equal(unapproved.status, 400);
  assert.match(unapproved.body.message, /Only approved scripts/);
  const unknown = await call(shootHandler, { method: "POST", body: { request_id: REQ(4), root_script_ids: [ROOT_A, ROOT_B] }, rules: fresh.rules, deps });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.message, /not found/);
  assert.equal(fresh.inserts.length, 0, "a refused plan saves nothing");

  // A filmed script that does not need a retake, and a locked one with no ad number yet, are not ready.
  const filmedDone = shootWorld({ scripts: [lockedScript({ status: "filmed", needs_retake: false })] });
  const notReady = await call(shootHandler, { method: "POST", body: { request_id: REQ(9), root_script_ids: [ROOT_A] }, rules: filmedDone.rules, deps });
  assert.equal(notReady.status, 400);
  assert.match(notReady.body.message, /Only approved scripts/);
  assert.equal(filmedDone.inserts.length, 0);
  const noNumber = shootWorld({ scripts: [lockedScript({ ad_id: null })] });
  const noNumberAnswer = await call(shootHandler, { method: "POST", body: { request_id: REQ(16), root_script_ids: [ROOT_A] }, rules: noNumber.rules, deps });
  assert.equal(noNumberAnswer.status, 400);
  assert.equal(noNumber.inserts.length, 0);
  const retake = shootWorld({ scripts: [lockedScript({ status: "filmed", needs_retake: true })] });
  const retakeAnswer = await call(shootHandler, { method: "POST", body: { request_id: REQ(17), root_script_ids: [ROOT_A] }, rules: retake.rules, deps });
  assert.equal(retakeAnswer.status, 200, "a filmed script that needs a retake is ready to film again");
  assert.equal(retake.inserts[0].params[1], null, "no day sent: the database fills today in Arizona");

  const noIds = await call(shootHandler, { method: "POST", body: { request_id: REQ(5) }, rules: [], deps });
  assert.equal(noIds.status, 400);
  assert.equal(noIds.body.field, "root_script_ids");
  const badDate = await call(shootHandler, { method: "POST", body: { request_id: REQ(6), root_script_ids: [ROOT_A], shoot_date: "2026-02-31" }, rules: [], deps });
  assert.equal(badDate.status, 400);
  assert.equal(badDate.body.field, "shoot_date");
  const dupes = await call(shootHandler, { method: "POST", body: { request_id: REQ(7), root_script_ids: [ROOT_A, ROOT_A] }, rules: [], deps });
  assert.equal(dupes.status, 400);
  await assertRoleGate(shootHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(8), root_script_ids: [ROOT_A] }, rules: [], deps });
});

test("POST marketing/shoot cannot be done with a film link: a film key plans, reorders and closes nothing, and an unsigned POST is refused", async () => {
  const world = shootWorld({
    scripts: [lockedScript(), secondScript()],
    shoots: [openShoot({ status: "filming" })],
  });
  const deps = { now: () => WORLD_NOW, filmSecret: SECRET };
  const key = mintFilmKey({ orgId: ORG_ID, shootId: SHOOT_ID, secret: SECRET, now: () => WORLD_NOW.getTime() }).token;
  const bodies = [
    { request_id: REQ(60), id: SHOOT_ID, status: "done" },
    { request_id: REQ(61), id: SHOOT_ID, root_script_ids: [ROOT_B, ROOT_A] },
    { request_id: REQ(62), root_script_ids: [ROOT_A] },
  ];
  for (const body of bodies) {
    const withKey = await call(shootHandler, { method: "POST", anonymous: true, withSession: false, headers: { "x-shoot-film": key }, body, rules: world.rules, deps });
    assert.equal(withKey.status, 401, `a film key alone cannot ${JSON.stringify(Object.keys(body).slice(1))}`);
    const unsigned = await call(shootHandler, { method: "POST", anonymous: true, withSession: false, headers: {}, body, rules: world.rules, deps });
    assert.equal(unsigned.status, 401, "no key and no sign-in is refused");
    assert.equal(dataCalls(withKey).length, 0);
    assert.equal(dataCalls(unsigned).length, 0);
  }
  assert.equal(world.updates.length, 0, "nothing was changed");
  assert.equal(world.inserts.length, 0);
  assert.equal(world.shoots[0].status, "filming");

  // A film key sent along with a real sign-in is still just the sign-in: the company is the session's.
  const noCompany = await call(shootHandler, { method: "POST", staff: { org_id: null }, body: bodies[0], rules: world.rules, deps });
  assert.equal(noCompany.status, 403);
  assert.equal(dataCalls(noCompany).length, 0);
});

test("POST marketing/shoot closes a shoot (status done) and reorders it, keeps a script already on the shoot, and refuses another company's shoot, a closed shoot and a bare move", async () => {
  const world = shootWorld({
    scripts: [lockedScript(), secondScript({ status: "filmed" })],
    shoots: [openShoot({ status: "filming" }), openShoot({ id: OTHER_SHOOT, org_id: OTHER_ORG_ID, status: "filming" })],
  });
  const deps = { now: () => WORLD_NOW, filmSecret: SECRET };
  const reorder = await call(shootHandler, {
    method: "POST", body: { request_id: REQ(10), id: SHOOT_ID, root_script_ids: [ROOT_B, ROOT_A] }, rules: world.rules, deps,
  });
  assert.equal(reorder.status, 200, "a script already on the shoot stays allowed whatever its status is now");
  assert.deepEqual(reorder.body.shoot.root_script_ids, [ROOT_B, ROOT_A]);
  assert.deepEqual(world.orderWrite.order, [ROOT_B, ROOT_A]);
  assert.deepEqual(world.updates[0].params.slice(0, 2), [SHOOT_ID, ORG_ID]);
  assertSqlHas(world.updates[0].sql, { company: "WHERE id = $1 AND org_id = $2" });
  // The write: each of the plan, the day and the status keeps what was saved when none is sent (COALESCE),
  // started and finished are stamped by status, and updated_at moves. Pinned as sent.
  assertSent(reorder, "shoot.lock", "shoot.by_id_locked", "shoot.update", "shoot.live_scripts");
  assert.deepEqual(sentStatement(reorder, "shoot.update").params, [SHOOT_ID, ORG_ID, [ROOT_B, ROOT_A], null, null], "only the plan was sent: the day and the status are null so they keep what is saved");

  const close = await call(shootHandler, { method: "POST", body: { request_id: REQ(11), id: SHOOT_ID, status: "done" }, rules: world.rules, deps });
  assert.equal(close.status, 200);
  assert.equal(close.body.shoot.status, "done");
  assert.ok(close.body.shoot.finished_at, "closing stamps when it finished");
  assert.deepEqual(world.updates[1].params, [SHOOT_ID, ORG_ID, null, null, "done"]);
  assertSqlHas(world.updates[1].sql, {
    started: "started_at = CASE WHEN $5::text IN ('filming', 'uploaded', 'done') THEN COALESCE(started_at, now()) ELSE started_at END",
    finished: "finished_at = CASE WHEN $5::text = 'done' THEN now() ELSE finished_at END",
  });

  const again = await call(shootHandler, { method: "POST", body: { request_id: REQ(12), id: SHOOT_ID, status: "planned" }, rules: world.rules, deps });
  assert.equal(again.status, 400);
  assert.match(again.body.message, /closed/);

  const other = await call(shootHandler, { method: "POST", body: { request_id: REQ(13), id: OTHER_SHOOT, status: "done" }, rules: world.rules, deps });
  assert.equal(other.status, 404, "another company's shoot is not found");
  assert.equal(world.shoots.find((s) => s.id === OTHER_SHOOT).status, "filming");

  const bare = await call(shootHandler, { method: "POST", body: { request_id: REQ(14), id: SHOOT_ID }, rules: world.rules, deps });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.field, "body");
  const newDone = await call(shootHandler, { method: "POST", body: { request_id: REQ(15), root_script_ids: [ROOT_A], status: "done" }, rules: world.rules, deps });
  assert.equal(newDone.status, 400);
  assert.equal(newDone.body.field, "status");
});

/* ── POST marketing/shoot/mark ─────────────────────────────────────────────────────────────────────── */

test("POST marketing/shoot/mark counts a take, Got it keeps it, the first mark moves a planned shoot to filming, and a repeated request_id counts nothing twice", async () => {
  const world = shootWorld({ scripts: [lockedScript(), secondScript()], shoots: [openShoot()] });
  const deps = { now: () => WORLD_NOW };
  const rules = world.rules;
  const another = await call(markHandler, { method: "POST", body: { request_id: REQ(20), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "another_take" }, rules, deps });
  assert.equal(another.status, 200);
  assert.deepEqual(another.body.marks, { [ROOT_A]: { takes: 1, got_it: false, at: WORLD_NOW.toISOString() } });
  assert.equal(world.shoots[0].status, "filming", "the first mark moves a planned shoot to filming");
  assertSqlHas(world.markUpdates[0].sql, { company: "WHERE id = $1 AND org_id = $2", moves: "WHEN status = 'planned' THEN 'filming'" });
  assertSent(another, "shoot.by_id_locked", "shoot.mark");
  assert.deepEqual([world.markUpdates[0].params[0], world.markUpdates[0].params[1]], [SHOOT_ID, ORG_ID]);

  const gotIt = await call(markHandler, { method: "POST", body: { request_id: REQ(21), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "got_it" }, rules, deps });
  assert.deepEqual(gotIt.body.marks[ROOT_A], { takes: 2, got_it: true, at: WORLD_NOW.toISOString() }, "both presses count the take; Got it keeps it");
  const more = await call(markHandler, { method: "POST", body: { request_id: REQ(22), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "another_take" }, rules, deps });
  assert.deepEqual(more.body.marks[ROOT_A], { takes: 3, got_it: true, at: WORLD_NOW.toISOString() }, "Got it stays once said");
  const second = await call(markHandler, { method: "POST", body: { request_id: REQ(23), shoot_id: SHOOT_ID, root_script_id: ROOT_B, mark: "got_it" }, rules, deps });
  assert.equal(Object.keys(second.body.marks).length, 2);

  const writes = world.markUpdates.length;
  const repeat = await call(markHandler, { method: "POST", body: { request_id: REQ(23), shoot_id: SHOOT_ID, root_script_id: ROOT_B, mark: "got_it" }, rules, deps });
  assert.deepEqual(repeat.body, second.body);
  assert.equal(world.markUpdates.length, writes, "a press queued on the phone and sent twice counts once");
  assert.equal(world.requests.saved.get(REQ(23)).route, "marketing/shoot/mark");
});

test("POST marketing/shoot/mark refuses a script that is not on the shoot, a closed shoot, another company's shoot and a bad mark; a film key marks only its own shoot; no sign-in marks the default company", async () => {
  const world = shootWorld({
    scripts: [lockedScript(), secondScript()],
    shoots: [
      openShoot({ root_script_ids: [ROOT_A] }),
      openShoot({ id: OTHER_SHOOT, org_id: OTHER_ORG_ID }),
      openShoot({ id: "5b000000-0000-4000-8000-0000000000bb", status: "filming", root_script_ids: [ROOT_A] }),
    ],
  });
  const secret = SECRET;
  const deps = { now: () => WORLD_NOW, filmSecret: secret };
  const post = (body, extra = {}) => call(markHandler, { method: "POST", body, rules: world.rules, deps, ...extra });

  const notOn = await post({ request_id: REQ(30), shoot_id: SHOOT_ID, root_script_id: ROOT_B, mark: "got_it" });
  assert.equal(notOn.status, 404);
  const otherCompany = await post({ request_id: REQ(31), shoot_id: OTHER_SHOOT, root_script_id: ROOT_A, mark: "got_it" });
  assert.equal(otherCompany.status, 404, "another company's shoot is not found");
  assert.equal(world.markUpdates.length, 0);
  const badMark = await post({ request_id: REQ(32), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "maybe" });
  assert.equal(badMark.status, 400);
  assert.equal(badMark.body.field, "mark");
  const badShoot = await post({ request_id: REQ(33), shoot_id: "nope", root_script_id: ROOT_A, mark: "got_it" });
  assert.equal(badShoot.status, 400);
  assert.equal(badShoot.body.field, "shoot_id");

  const closed = shootWorld({ scripts: [lockedScript()], shoots: [openShoot({ status: "done", root_script_ids: [ROOT_A] })] });
  const closedAnswer = await call(markHandler, { method: "POST", body: { request_id: REQ(34), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "got_it" }, rules: closed.rules, deps });
  assert.equal(closedAnswer.status, 400);
  assert.match(closedAnswer.body.message, /closed/);

  const key = mintFilmKey({ orgId: ORG_ID, shootId: SHOOT_ID, secret, now: () => WORLD_NOW.getTime() }).token;
  const viaKey = await post({ request_id: REQ(35), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "got_it" }, { anonymous: true, withSession: false, headers: { "x-shoot-film": key } });
  assert.equal(viaKey.status, 200);
  assert.deepEqual(viaKey.body.marks[ROOT_A].takes, 1);
  assert.equal(dataCalls(viaKey).some((c) => /FROM live JOIN staff/.test(c.sql)), false);
  const keyWrongShoot = await post({ request_id: REQ(36), shoot_id: OTHER_SHOOT, root_script_id: ROOT_A, mark: "got_it" }, { anonymous: true, withSession: false, headers: { "x-shoot-film": key } });
  assert.equal(keyWrongShoot.status, 404, "a film key marks its own shoot only");
  const sameCompanySibling = await post({ request_id: REQ(41), shoot_id: "5b000000-0000-4000-8000-0000000000bb", root_script_id: ROOT_A, mark: "got_it" }, { anonymous: true, withSession: false, headers: { "x-shoot-film": key } });
  assert.equal(sameCompanySibling.status, 404, "a film key does not reach another shoot of the same company either");
  const forged = await post({ request_id: REQ(37), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "got_it" }, { anonymous: true, withSession: false, headers: { "x-shoot-film": key.slice(0, -3) + "abc" } });
  assert.equal(forged.status, 404);

  const open = shootWorld({ scripts: [lockedScript()], shoots: [openShoot({ root_script_ids: [ROOT_A] })] });
  const openMark = await call(markHandler, {
    method: "POST", anonymous: true, withSession: false, headers: {}, body: { request_id: REQ(38), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "another_take" }, rules: open.rules, deps,
  });
  assert.equal(openMark.status, 200);
  assert.equal(open.orgReads, 1, "no token and no key marks the default company's shoot");
  assert.deepEqual(open.markUpdates[0].params.slice(0, 2), [SHOOT_ID, ORG_ID]);

  const noDefault = shootWorld({ scripts: [], shoots: [], defaultOrg: null });
  const none = await call(markHandler, {
    method: "POST", anonymous: true, withSession: false, headers: {}, body: { request_id: REQ(39), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "got_it" }, rules: noDefault.rules, deps,
  });
  assert.equal(none.status, 404);
  await assertRoleGate(markHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(40), shoot_id: SHOOT_ID, root_script_id: ROOT_A, mark: "got_it" }, rules: [], deps });
});
