// Shoot Day against real Postgres (unit X5, spec §8.2, design §3.4):
// GET marketing/shoot, POST marketing/shoot, POST marketing/shoot/mark. Lives
// under src/http/ because npm test globs src/** and scripts/** only (CLAUDE.md
// §12); it imports the api/ handlers.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips,
// and a skipped .pg.test.mjs is not green.
//
// TWO COMPANIES OF ITS OWN (slugs below). Every row is removed after.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, pool, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { parseTakeName } from "../ad-videos/merge-takes.mjs";
import shootHandler from "../../api/marketing/shoot.mjs";
import markHandler from "../../api/marketing/shoot/mark.mjs";
import editHandler from "../../api/marketing/scripts/edit.mjs";
import { mintFilmKey } from "../marketing/shoot-film-key.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const FILM_SECRET = "x".repeat(48);
const SLUG_A = "zz-x5-shoot-a";
const SLUG_B = "zz-x5-shoot-b";
const EMAIL_TAG = "x5_shoot_pg";

let seq = 0;
const rid = (tag) => `x5-pg-${tag}-${process.pid}-${Date.now()}-${++seq}`;

const PARTS = [
  { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "reveal", text: "We check both before you apply anywhere." },
  { kind: "cta", text: "Tap below and see what both files say today." }
];
const BODY = PARTS.map((p) => p.text).join("\n\n");

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(handler, token, { method = "GET", query = {}, body, headers = {} } = {}) {
  const r = res();
  const h = { ...headers };
  if (token) h.authorization = "Bearer " + token;
  await handler(
    { method, headers: h, query, body },
    r,
    { db, filmSecret: FILM_SECRET, wake: async () => {} }
  );
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}
const get = (token, query) => call(shootHandler, token, { query });
const save = (token, body) => call(shootHandler, token, { method: "POST", body });
const mark = (token, body) => call(markHandler, token, { method: "POST", body });

/* ad_scripts, ad_videos and marketing_shoots force row security: read and
   write them as staff, in a short transaction of their own. */
async function staffTx(fn) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the first error is the one worth throwing */ }
    throw err;
  } finally {
    client.release();
  }
}

describe("Shoot Day (X5)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, partnerA, partnerB, ownerA, closerA, ownerB;
  let s91, s92, s93, sDraft, sHidden, sBook, sRetake, sB;
  let hiddenBatch;
  let n = 0;

  async function mkScript(fields = {}) {
    const row = {
      org_id: orgA,
      partner_id: partnerA,
      source: "machine",
      status: "locked",
      title: `X5 angle ${++n}`,
      body: BODY,
      parts: JSON.stringify(PARTS),
      lane: "uwiq",
      script_format: "standard",
      style: "bullets",
      angle_key: "two_files",
      offer_key: "slo_roadmap",
      funnel_key: "roadmap_147",
      locked_at: new Date(Date.now() - (100 - n) * 60000).toISOString(),
      ...fields
    };
    if (row.parts !== null && typeof row.parts !== "string") row.parts = JSON.stringify(row.parts);
    const cols = Object.keys(row);
    return staffTx(async (c) => (await c.query(
      `INSERT INTO ad_scripts (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      cols.map((k) => row[k])
    )).rows[0]);
  }

  async function mkVideo(fields) {
    const row = { org_id: orgA, partner_id: partnerA, video_kind: "ad", ...fields };
    const cols = Object.keys(row);
    return staffTx(async (c) => (await c.query(
      `INSERT INTO ad_videos (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      cols.map((k) => row[k])
    )).rows[0]);
  }

  const scriptRow = (id) => staffTx(async (c) => (await c.query(`SELECT * FROM ad_scripts WHERE id = $1`, [id])).rows[0]);
  const shootRow = (id) => staffTx(async (c) => (await c.query(`SELECT * FROM marketing_shoots WHERE id = $1`, [id])).rows[0]);

  async function purge() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query(`DELETE FROM voice_pairs WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM repo_outbox WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_requests WHERE org_id = ANY($1)`, [orgs]);
      await staffTx(async (c) => {
        await c.query(`DELETE FROM marketing_shoots WHERE org_id = ANY($1)`, [orgs]);
        await c.query(`DELETE FROM ad_videos WHERE org_id = ANY($1)`, [orgs]);
        await c.query(`UPDATE ad_scripts SET idea_id = NULL WHERE org_id = ANY($1)`, [orgs]);
        await c.query(`DELETE FROM ad_ideas WHERE org_id = ANY($1)`, [orgs]);
        for (let i = 0; i < 30; i++) {
          const gone = await c.query(
            `DELETE FROM ad_scripts s
              WHERE s.org_id = ANY($1)
                AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                                 WHERE k.id <> s.id
                                   AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`,
            [orgs]
          );
          if (!gone.rowCount) break;
        }
      });
      await db.query(`DELETE FROM marketing_batches WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM partners WHERE org_id = ANY($1)`, [orgs]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]]); } catch { /* reused next run */ }
  }

  const mkOrg = async (slug) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'X5 shoot fixture')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]
  )).rows[0].id;
  const mkPartner = async (org, slug) => (await db.query(
    `INSERT INTO partners (org_id, name, slug) VALUES ($1, 'X5 house', $2) RETURNING id`, [org, slug]
  )).rows[0].id;
  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `X5 ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  before(async () => {
    await purge();
    orgA = await mkOrg(SLUG_A);
    orgB = await mkOrg(SLUG_B);
    partnerA = await mkPartner(orgA, "zz-x5-house-a");
    partnerB = await mkPartner(orgB, "zz-x5-house-b");
    ownerA = await staffIn(orgA, "owner", "a.owner");
    closerA = await staffIn(orgA, "closer", "a.closer");
    ownerB = await staffIn(orgB, "owner", "b.owner");
    hiddenBatch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at, total, ready)
       VALUES ($1, 'weekly', '2026-W52', 'ready', now() + interval '7 days', 1, 1) RETURNING id`, [orgA]
    )).rows[0].id;

    s93 = await mkScript({ ad_id: "93", title: "Lenders read two files", film_order: 2 });
    s92 = await mkScript({ ad_id: "92", film_order: 1 });
    s91 = await mkScript({ ad_id: "91" });
    sDraft = await mkScript({ status: "draft" });
    sHidden = await mkScript({ ad_id: "94", batch_id: hiddenBatch });
    sBook = await mkScript({ ad_id: "95", offer_key: "funding_dfy", lane: "sorting", funnel_key: "book_call" });
    sRetake = await mkScript({ ad_id: "96", status: "filmed", needs_retake: true });
    sB = await mkScript({ org_id: orgB, partner_id: partnerB, ad_id: "91" });
    // A new opening for Ad 96: the retake rolls the first line only.
    const idea = (await staffTx(async (c) => (await c.query(
      `INSERT INTO ad_ideas (org_id, partner_id, kind, target_script_id, status) VALUES ($1, $2, 'opening', $3, 'written') RETURNING id`,
      [orgA, partnerA, sRetake.id]
    )).rows[0]));
    await staffTx((c) => c.query(`UPDATE ad_scripts SET idea_id = $2 WHERE id = $1`, [sRetake.id, idea.id]));
    // Ad 93 already has two takes on file from an earlier shoot.
    await mkVideo({ ad_id: "93", take_no: 2, status: "matched", created_at: new Date(Date.now() - 86400000).toISOString() });
  });

  after(async () => {
    try { await purge(); } finally { await close(); }
  });

  test("the shoot read is open with no sign-in; a write stays owner and admin: unsigned POST 401, a closer 403, the wrong method 405", async () => {
    const open = await get(null);
    assert.equal(open.code, 200, JSON.stringify(open.body));
    assertMatchesContract("GET marketing/shoot", open.body);
    assert.equal(JSON.stringify(open.body).includes(s91.id), false, "the open read is the default company, not this fixture");
    assert.equal((await save(null, { request_id: rid("open"), root_script_ids: [s91.id] })).code, 401);
    const openMark = await mark(null, { request_id: rid("openmark"), shoot_id: s91.id, root_script_id: s91.id, mark: "maybe" });
    assert.equal(openMark.code, 400, "Got it with no sign-in is refused as a bad mark, not as a login");
    assert.notEqual(openMark.code, 401);
    assert.equal((await get(closerA.token)).code, 403);
    assert.equal((await save(closerA.token, { request_id: rid("c"), root_script_ids: [s91.id] })).code, 403);
    const r = await call(markHandler, ownerA.token, { method: "GET" });
    assert.equal(r.code, 405);
    assert.equal(r.headers.Allow, "POST");
    assert.equal((await call(shootHandler, ownerA.token, { method: "DELETE" })).code, 405);
  });

  test("no shoot yet: every approved script is ready to film, retakes first, then film order, each with its exact take file name", async () => {
    const r = await get(ownerA.token);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/shoot", r.body);
    assert.equal(r.body.shoot, null);
    assert.equal(r.body.wpm, 150);
    const ids = r.body.plan_candidates.map((s) => s.root_script_id);
    assert.deepEqual(ids, [sRetake.id, s92.id, s93.id, s91.id, sBook.id], "retake, film order 1, 2, then ad numbers; no draft, no hidden batch, no other company");

    const by = Object.fromEntries(r.body.plan_candidates.map((s) => [s.root_script_id, s]));
    assert.equal(by[s93.id].take_file_name, "SLO Ad 93 — Lenders read two files Take 3.mp4", "two takes already on file → Take 3");
    assert.deepEqual(parseTakeName(by[s93.id].take_file_name), { offer: "SLO", adNumber: 93, angle: "Lenders read two files", takeNo: 3, ext: "mp4" });
    assert.equal(by[s91.id].take_file_name, `SLO Ad 91 — ${s91.title} Take 1.mp4`);
    assert.equal(by[s91.id].angle_name, s91.title);
    assert.equal(by[s91.id].ad_id, "91");
    assert.equal(by[sBook.id].take_file_name, null, "no offer word on file for Book a call");
    assert.match(by[sBook.id].take_name_problem, /no file-name word/);
    assert.equal(by[sRetake.id].first_line_only, true);
    assert.equal(by[sRetake.id].teleprompter_text, PARTS[0].text);
    assert.equal(by[s91.id].teleprompter_text, BODY);
    assert.ok(by[s91.id].read_seconds > 0);
    assert.ok(r.body.plan_estimated_minutes >= 2 * 5);

    const fast = await get(ownerA.token, { wpm: "260" });
    assert.equal(fast.body.wpm, 260);
    assert.ok(fast.body.plan_candidates[1].read_seconds < r.body.plan_candidates[1].read_seconds);
    const bad = await get(ownerA.token, { wpm: "20" });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.field, "wpm");
  });

  let shootId;

  test("save the plan: one shoot, in this order, film order follows; a repeat press saves nothing new", async () => {
    const draft = await save(ownerA.token, { request_id: rid("draft"), root_script_ids: [s91.id, sDraft.id] });
    assert.equal(draft.code, 400);
    assert.equal(draft.body.field, "root_script_ids");
    const other = await save(ownerA.token, { request_id: rid("other"), root_script_ids: [sB.id] });
    assert.equal(other.code, 400, "another company's script is not found");
    const hidden = await save(ownerA.token, { request_id: rid("hidden"), root_script_ids: [sHidden.id] });
    assert.equal(hidden.code, 400);

    const req = rid("create");
    const order = [s93.id, s91.id, s92.id];
    const r = await save(ownerA.token, { request_id: req, shoot_date: "2026-10-13", root_script_ids: order });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/shoot", r.body);
    shootId = r.body.shoot.id;
    assert.equal(r.body.shoot.status, "planned");
    assert.equal(r.body.shoot.shoot_date, "2026-10-13");
    assert.deepEqual(r.body.shoot.root_script_ids, order);
    assert.deepEqual(r.body.shoot.scripts.map((s) => s.root_script_id), order);
    assert.deepEqual(r.body.shoot.marks, {});
    assert.ok(r.body.shoot.estimated_minutes >= 6);
    for (const [i, id] of order.entries()) assert.equal(Number((await scriptRow(id)).film_order), i + 1);

    const again = await save(ownerA.token, { request_id: req, shoot_date: "2026-10-13", root_script_ids: order });
    assert.deepEqual(again.body, r.body);
    const count = await staffTx(async (c) => (await c.query(`SELECT count(*)::int AS n FROM marketing_shoots WHERE org_id = $1`, [orgA])).rows[0].n);
    assert.equal(count, 1);

    const second = await save(ownerA.token, { request_id: rid("second"), root_script_ids: [sBook.id] });
    assert.equal(second.code, 400);
    assert.equal(second.body.field, "id");
    assert.match(second.body.message, /already planned/);
  });

  test("mark a take: Another take and Got it count takes; the next file name moves on; a script not on the shoot is 404", async () => {
    const bad = await mark(ownerA.token, { request_id: rid("bad"), shoot_id: shootId, root_script_id: s93.id, mark: "maybe" });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.field, "mark");
    const off = await mark(ownerA.token, { request_id: rid("off"), shoot_id: shootId, root_script_id: sBook.id, mark: "got_it" });
    assert.equal(off.code, 404);
    const otherCo = await mark(ownerB.token, { request_id: rid("b"), shoot_id: shootId, root_script_id: s93.id, mark: "got_it" });
    assert.equal(otherCo.code, 404);

    const a = await mark(ownerA.token, { request_id: rid("a1"), shoot_id: shootId, root_script_id: s93.id, mark: "another_take" });
    assert.equal(a.code, 200, JSON.stringify(a.body));
    assertMatchesContract("POST marketing/shoot/mark", a.body);
    assert.equal(a.body.marks[s93.id].takes, 1);
    assert.equal(a.body.marks[s93.id].got_it, false);
    assert.equal((await shootRow(shootId)).status, "filming");

    const req = rid("g1");
    const g = await mark(ownerA.token, { request_id: req, shoot_id: shootId, root_script_id: s93.id, mark: "got_it" });
    assert.equal(g.body.marks[s93.id].takes, 2);
    assert.equal(g.body.marks[s93.id].got_it, true);
    const repeat = await mark(ownerA.token, { request_id: req, shoot_id: shootId, root_script_id: s93.id, mark: "got_it" });
    assert.deepEqual(repeat.body, g.body, "a queued press sent twice counts once");
    assert.equal((await scriptRow(s93.id)).status, "locked", "Got it marks the shoot only");

    const page = await get(ownerA.token);
    assertMatchesContract("GET marketing/shoot", page.body);
    const on = page.body.shoot.scripts.find((s) => s.root_script_id === s93.id);
    assert.equal(on.got_it, true);
    assert.equal(on.takes, 2);
    assert.equal(on.last_take_file_name, "SLO Ad 93 — Lenders read two files Take 4.mp4");
    assert.equal(on.take_file_name, "SLO Ad 93 — Lenders read two files Take 5.mp4");
    assert.ok(!page.body.plan_candidates.some((s) => s.root_script_id === s93.id), "a Got it script leaves the plan list");
    assert.ok(page.body.plan_candidates.some((s) => s.root_script_id === s91.id), "an unmarked script on the shoot stays on it");
    assert.deepEqual(page.body.shoot.board.map((b) => [b.ad_id, b.step]), [["93", "filmed"]]);
  });

  test("the board follows the clips that land after the shoot started", async () => {
    await mkVideo({ ad_id: "93", take_no: 4, status: "awaiting_approval" });
    await mkVideo({ ad_id: "91", take_no: 1, status: "staged" });
    await mkVideo({ status: "raw_landed", drive_raw_file_id: `x5-raw-${process.pid}-${Date.now()}` });
    const page = await get(ownerA.token);
    const board = page.body.shoot.board;
    assert.equal(board[0].ad_id, "93", "what needs Chris is on top");
    assert.equal(board[0].step, "ready_to_approve");
    assert.equal(board[0].needs_you, true);
    const ad91 = board.find((b) => b.ad_id === "91");
    assert.equal(ad91.step, "cutting");
    assert.equal(ad91.reason, "The join step still runs on the Mac.");
    assert.equal(page.body.shoot.landed_unmatched, 1);
  });

  test("reorder and close: the order saves, a closed shoot never changes, the next plan starts clean", async () => {
    const r = await save(ownerA.token, { request_id: rid("reorder"), id: shootId, root_script_ids: [s92.id, s91.id, s93.id] });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.shoot.root_script_ids, [s92.id, s91.id, s93.id]);
    assert.equal(Number((await scriptRow(s92.id)).film_order), 1);
    const nope = await save(ownerA.token, { request_id: rid("nope"), id: "00000000-0000-4000-8000-0000000000ff", status: "done" });
    assert.equal(nope.code, 404);
    const badStatus = await save(ownerA.token, { request_id: rid("bs"), id: shootId, status: "partying" });
    assert.equal(badStatus.code, 400);
    assert.equal(badStatus.body.field, "status");

    // Ad 92 is rolled twice on this shoot and kept by neither press; no clip
    // is filed before the shoot closes.
    for (const k of [1, 2]) {
      const t = await mark(ownerA.token, { request_id: rid(`t92-${k}`), shoot_id: shootId, root_script_id: s92.id, mark: "another_take" });
      assert.equal(t.code, 200, JSON.stringify(t.body));
    }
    // Ad 93's Take 4 (filed during the shoot) is approved: one finished ad.
    await staffTx((c) => c.query(
      `UPDATE ad_videos SET status = 'approved', approved_at = now(), approved_by = 'x5-pg'
        WHERE org_id = $1 AND ad_id = '93' AND take_no = 4`, [orgA]
    ));

    const done = await save(ownerA.token, { request_id: rid("close"), id: shootId, status: "done" });
    assert.equal(done.code, 200);
    assert.equal(done.body.shoot.status, "done");
    assert.ok(done.body.shoot.finished_at);
    const row = await shootRow(shootId);
    assert.ok(row.finished_at && row.started_at);

    const late = await mark(ownerA.token, { request_id: rid("late"), shoot_id: shootId, root_script_id: s91.id, mark: "got_it" });
    assert.equal(late.code, 400);
    assert.equal(late.body.field, "shoot_id");
    const reopen = await save(ownerA.token, { request_id: rid("reopen"), id: shootId, status: "planned" });
    assert.equal(reopen.code, 400);

    const page = await get(ownerA.token);
    assert.equal(page.body.shoot, null);
    assert.equal(page.body.past_shoots[0].id, shootId);
    assertMatchesContract("GET marketing/shoot", page.body);
    assert.equal(page.body.past_shoots[0].filmed, 1);
    assert.equal(page.body.past_shoots[0].finished, 1, "Ad 93 has its approved video from this shoot");
    assert.ok(page.body.plan_candidates.some((s) => s.root_script_id === s93.id), "a Got it on a closed shoot no longer hides the script");
    assert.ok(page.body.plan_candidates.some((s) => s.root_script_id === s91.id), "scripts not marked Got it stay on the next plan");

    // No take name is handed out twice once a shoot is closed.
    const by = Object.fromEntries(page.body.plan_candidates.map((s) => [s.root_script_id, s]));
    assert.equal(by[s92.id].take_file_name, `SLO Ad 92 — ${s92.title} Take 3.mp4`, "rolled twice on the closed shoot, no clip filed yet: Take 3, not Take 1");
    assert.equal(by[s93.id].take_file_name, "SLO Ad 93 — Lenders read two files Take 5.mp4", "Take 4 filed and Take 3 + 4 rolled: counted once");
    assert.equal(by[s91.id].take_file_name, `SLO Ad 91 — ${s91.title} Take 2.mp4`, "one clip filed, never rolled on the closed shoot");

    const next = await save(ownerA.token, { request_id: rid("next"), root_script_ids: [s91.id, s92.id] });
    assert.equal(next.code, 200, "a new shoot once the old one is closed");
    const onNext = Object.fromEntries(next.body.shoot.scripts.map((s) => [s.root_script_id, s]));
    assert.equal(onNext[s92.id].take_no, 3, "the next shoot carries on from the closed shoot's takes");
    assert.equal(onNext[s91.id].take_no, 2);
  });

  test("a film link reads and marks that shoot, edits a script on it, and is not a staff login", async () => {
    const page = await get(ownerA.token);
    assert.equal(page.code, 200);
    assert.ok(page.body.shoot, "a shoot is open");
    assert.match(page.body.film.path, /^\/app\/teleprompter\.html\?k=/);
    const key = page.body.film.path.slice("/app/teleprompter.html?k=".length);
    const headers = { "x-shoot-film": key };

    const open = await call(shootHandler, null, { headers });
    assert.equal(open.code, 200, JSON.stringify(open.body));
    assert.equal(open.body.shoot.id, page.body.shoot.id);
    assert.equal(open.body.film, undefined, "the phone does not get a new key");

    const junk = await call(shootHandler, null, { headers: { "x-shoot-film": key + "no" } });
    assert.equal(junk.code, 404);
    const asBearer = await call(shootHandler, key);
    assert.equal(asBearer.code, 401, "the film key is not a staff session");
    const plan = await call(shootHandler, null, {
      method: "POST", headers,
      body: { request_id: rid("filmplan"), root_script_ids: [s91.id] }
    });
    assert.equal(plan.code, 401, "the film key cannot change the plan");

    const closed = mintFilmKey({ orgId: orgA, shootId, secret: FILM_SECRET });
    const old = await call(shootHandler, null, { headers: { "x-shoot-film": closed.token } });
    assert.equal(old.code, 404, "a key for a closed shoot does not open the new one");

    const script = page.body.shoot.scripts[0];
    assert.match(script.body, /TWO/, "the fixture word this save changes");
    const marked = await call(markHandler, null, {
      method: "POST", headers,
      body: { request_id: rid("filmmark"), shoot_id: page.body.shoot.id, root_script_id: script.root_script_id, mark: "another_take" }
    });
    assert.equal(marked.code, 200, JSON.stringify(marked.body));
    const wrong = await call(markHandler, null, {
      method: "POST", headers,
      body: { request_id: rid("wrongshoot"), shoot_id: shootId, root_script_id: script.root_script_id, mark: "got_it" }
    });
    assert.equal(wrong.code, 404);

    const editReq = rid("filmedit");
    const nextBody = script.body.replace("TWO", "BOTH");
    const nextParts = (script.parts || []).map((p) => (
      p.kind === "hook" ? { ...p, text: String(p.text).replace("TWO", "BOTH") } : p
    ));
    const edited = await call(editHandler, null, {
      method: "POST", headers,
      body: { request_id: editReq, id: script.id, version: script.version, body: nextBody, parts: nextParts }
    });
    assert.equal(edited.code, 200, JSON.stringify(edited.body));
    assert.match(edited.body.script.body, /BOTH/);
    assert.notEqual(edited.body.script.id, script.id, "a new version, the old words kept");
    const file = (await db.query(
      `SELECT path, mode, content, committed_sha FROM repo_outbox WHERE org_id = $1 AND op_id = $2`,
      [orgA, `u25:edit-file:${editReq}`]
    )).rows[0];
    assert.ok(file, "the changed word is stored for the machine");
    assert.equal(file.mode, "replace");
    assert.equal(file.path, edited.body.script.repo_path);
    assert.match(file.path, /^marketing\/ads\/scripts\/machine\//);
    assert.match(file.content, /BOTH/);
    assert.equal(file.committed_sha, null, "waiting in the outbox until the repo copy runs");
    const offRow = await scriptRow(s93.id);
    const off = await call(editHandler, null, {
      method: "POST", headers,
      body: { request_id: rid("filmoff"), id: offRow.id, version: offRow.version, body: offRow.body }
    });
    assert.equal(off.code, 404, "a script that is not on this shoot cannot be edited");
  });

  test("another company sees none of it", async () => {
    const r = await get(ownerB.token);
    assert.equal(r.code, 200);
    assert.equal(r.body.shoot, null);
    assert.deepEqual(r.body.plan_candidates.map((s) => s.root_script_id), [sB.id]);
  });
});
