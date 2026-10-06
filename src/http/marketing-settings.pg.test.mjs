// /api/marketing/settings and the request_id rule (src/marketing/http.mjs
// withRequest), against real Postgres. Lives under src/http/ because npm test
// globs src/** and scripts/** only (CLAUDE.md §12); it imports the api/ handler.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips, and
// a skipped .pg.test.mjs is not green.
//
// TWO COMPANIES OF ITS OWN (slugs mset-pg-a, mset-pg-b), so one settings row per
// company can be counted exactly and the "same request_id from another company"
// rule has a real second company. Everything is removed after.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/marketing/settings.mjs";
import { withRequest, InvalidError } from "../marketing/http.mjs";
import { saveSettings, SETTINGS_KEYS, RESEARCH_SETTINGS_KEYS } from "../marketing/settings-store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG_A = "mset-pg-a";
const SLUG_B = "mset-pg-b";
const EMAIL_TAG = "mset_pg_test";
const ROUTE = "marketing/settings";

let seq = 0;
const rid = (tag) => `mset-pg-${tag}-${process.pid}-${Date.now()}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(token, { method = "GET", body } = {}) {
  const r = res();
  await handler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body }, r, { db });
  // What the browser gets: the JSON text, parsed.
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

describe("/api/marketing/settings", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, ownerA, tokenOwnerA, tokenAdminA, tokenCloserA, tokenCsmA, tokenOwnerB;

  const settingsRow = async (org) =>
    (await db.query(`SELECT * FROM marketing_settings WHERE org_id = $1`, [org])).rows[0] || null;
  const requestRows = async (requestId) =>
    (await db.query(`SELECT * FROM marketing_requests WHERE request_id = $1`, [requestId])).rows;

  async function cleanup() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query(`DELETE FROM marketing_requests WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_settings WHERE org_id = ANY($1)`, [orgs]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]]); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Marketing settings ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const mkOrg = async (slug) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing settings fixture')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]
  )).rows[0].id;

  before(async () => {
    await cleanup();
    orgA = await mkOrg(SLUG_A);
    orgB = await mkOrg(SLUG_B);
    ownerA = await staffIn(orgA, "owner", "a.owner");
    tokenOwnerA = ownerA.token;
    tokenAdminA = (await staffIn(orgA, "admin", "a.admin")).token;
    tokenCloserA = (await staffIn(orgA, "closer", "a.closer")).token;
    tokenCsmA = (await staffIn(orgA, "csm", "a.csm")).token;
    tokenOwnerB = (await staffIn(orgB, "owner", "b.owner")).token;
  });

  after(async () => { await cleanup(); await close(); });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; closer and csm 403 and nothing is made; owner and admin 200", async () => {
    assert.equal((await call(null)).code, 401);
    for (const t of [tokenCloserA, tokenCsmA]) {
      const r = await call(t);
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.equal(r.body.error, "forbidden");
      const p = await call(t, { method: "POST", body: { request_id: rid("gate"), updated_at: new Date().toISOString(), patch: { enabled: true } } });
      assert.equal(p.code, 403);
    }
    assert.equal(await settingsRow(orgA), null, "a refused caller made no settings row");
    assert.equal((await call(tokenOwnerA)).code, 200);
    assert.equal((await call(tokenAdminA)).code, 200);
  });

  // ── reading ───────────────────────────────────────────────────────────────

  test("two GETs make one row, with the spec's defaults and the fixed shape", async () => {
    const a = await call(tokenOwnerA);
    const b = await call(tokenOwnerA);
    assert.equal(a.code, 200);
    assert.deepEqual(b.body, a.body, "the second read changed nothing");
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_settings WHERE org_id = $1`, [orgA])).rows[0].n;
    assert.equal(n, 1);

    const s = a.body.settings;
    assert.deepEqual(Object.keys(a.body), ["settings"]);
    assert.deepEqual(Object.keys(s), [...SETTINGS_KEYS, ...RESEARCH_SETTINGS_KEYS]);
    assert.equal(s.org_id, orgA);
    assert.equal(s.enabled, false);
    assert.equal(s.batch_weekday, 1);
    assert.equal(s.batch_time, "07:00");
    assert.equal(s.timezone, "America/Phoenix");
    assert.equal(s.scripts_per_day, 3);
    assert.equal(s.days_per_batch, 7);
    assert.equal(s.size_rule, "total");
    assert.deepEqual(s.format_style, {
      standard: "bullets", sorting: "words", long: "words", notes: "bullets", greenscreen: "bullets", vsl: "bullets"
    });
    assert.equal(s.draft_expiry_days, 14);
    assert.equal(s.winner_rule, null);
    assert.equal(s.ad_number_floor, 91);
    assert.equal(s.next_overrides, null);
    assert.equal(s.max_batch_cost_usd, 40);
    assert.equal(s.max_month_cost_usd, 300);
    assert.equal(s.submagic_template, "Hormozi 2");
    assert.equal(s.caption_position_y, null);
    assert.equal(s.magic_zooms, false);
    assert.equal(s.clean_audio, true);
    assert.deepEqual(s.caption_dictionary, []);
    assert.equal(s.animation_mode, "fullframe");
    assert.equal(s.flip_horizontal, false);
    assert.equal(s.settle_minutes, 10);
    assert.equal(s.quiet_start, "21:00");
    assert.equal(s.quiet_end, "07:00");
    assert.ok(!Number.isNaN(Date.parse(s.updated_at)));
    assert.equal(s.updated_by, null);
  });

  // ── saving ────────────────────────────────────────────────────────────────

  test("POST saves, merges format_style, records who, and moves updated_at", async () => {
    const before = (await call(tokenOwnerA)).body.settings;
    const id = rid("save");
    const patch = {
      scripts_per_day: 4, size_rule: "per_funnel", format_style: { standard: "words" },
      caption_dictionary: ["Fundhub", "UnderwriteIQ"], quiet_start: "22:00",
      winner_rule: { note: "fixture" }, batch_weekday: 2
    };
    const r = await call(tokenOwnerA, { method: "POST", body: { request_id: id, updated_at: before.updated_at, patch } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body), ["settings"]);
    const s = r.body.settings;
    assert.equal(s.scripts_per_day, 4);
    assert.equal(s.size_rule, "per_funnel");
    assert.equal(s.format_style.standard, "words");
    assert.equal(s.format_style.sorting, "words", "the other formats are kept");
    assert.equal(s.format_style.vsl, "bullets");
    assert.deepEqual(s.caption_dictionary, ["Fundhub", "UnderwriteIQ"]);
    assert.equal(s.quiet_start, "22:00");
    assert.deepEqual(s.winner_rule, { note: "fixture" });
    assert.equal(s.batch_weekday, 2);
    assert.equal(s.enabled, false, "enabled is untouched");
    assert.equal(s.updated_by, ownerA.id);
    assert.ok(Date.parse(s.updated_at) > Date.parse(before.updated_at), "updated_at moved forward");

    const row = await settingsRow(orgA);
    assert.equal(row.scripts_per_day, 4);
    assert.equal(row.updated_by, ownerA.id);
    const saved = await requestRows(id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].org_id, orgA);
    assert.equal(saved[0].route, ROUTE);
    assert.deepEqual(saved[0].response, r.body);

    // What the GET answers now is what the POST answered.
    assert.deepEqual((await call(tokenOwnerA)).body, r.body);
  });

  test("a repeated request_id answers the same body and writes once", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const id = rid("repeat");
    const body = { request_id: id, updated_at: cur.updated_at, patch: { settle_minutes: 12 } };
    const first = await call(tokenOwnerA, { method: "POST", body });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    const stamp = (await settingsRow(orgA)).updated_at.getTime();

    // The same press again. Its updated_at is old now, so a second real save
    // would be a 409; a 200 with the first body proves nothing ran again.
    const again = await call(tokenOwnerA, { method: "POST", body });
    assert.equal(again.code, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body, first.body);
    assert.equal((await settingsRow(orgA)).updated_at.getTime(), stamp, "no second write");
    assert.equal((await requestRows(id)).length, 1);
  });

  test("two copies of one press at the same moment: one save, the same answer twice", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const id = rid("race");
    const body = { request_id: id, updated_at: cur.updated_at, patch: { draft_expiry_days: 20 } };
    const [a, b] = await Promise.all([
      call(tokenOwnerA, { method: "POST", body }),
      call(tokenOwnerA, { method: "POST", body })
    ]);
    assert.equal(a.code, 200, JSON.stringify(a.body));
    assert.equal(b.code, 200, JSON.stringify(b.body));
    assert.deepEqual(a.body, b.body);
    assert.equal((await requestRows(id)).length, 1);
    assert.equal((await settingsRow(orgA)).draft_expiry_days, 20);
  });

  test("the same request_id from a second company is 400 invalid request_id, and B is untouched", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const id = rid("cross");
    const ok = await call(tokenOwnerA, { method: "POST", body: { request_id: id, updated_at: cur.updated_at, patch: { magic_zooms: true } } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));

    const curB = (await call(tokenOwnerB)).body.settings;
    const r = await call(tokenOwnerB, { method: "POST", body: { request_id: id, updated_at: curB.updated_at, patch: { magic_zooms: true } } });
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, "invalid");
    assert.equal(r.body.field, "request_id");
    assert.ok(r.body.message);
    assert.equal(r.body.settings, undefined, "company A's answer is not handed to company B");
    assert.equal((await settingsRow(orgB)).magic_zooms, false);
    const saved = await requestRows(id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].org_id, orgA);
  });

  test("the same request_id on another route is 400 too", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const id = rid("route");
    await call(tokenOwnerA, { method: "POST", body: { request_id: id, updated_at: cur.updated_at, patch: { clean_audio: true } } });
    await assert.rejects(
      withRequest(db, { orgId: orgA, route: "marketing/funnels", requestId: id }, async () => ({ funnel: null })),
      (err) => err instanceof InvalidError && err.field === "request_id"
    );
  });

  test("a fn that throws leaves no marketing_requests row and no settings change", async () => {
    const before = await settingsRow(orgA);
    const id = rid("throws");
    await assert.rejects(
      withRequest(db, { orgId: orgA, route: ROUTE, requestId: id }, async (tx) => {
        await saveSettings(tx, orgA, {
          patch: { scripts_per_day: 9 }, updatedAt: before.updated_at.toISOString(), staffId: ownerA.id
        });
        throw new Error("fixture: something failed after the save");
      }),
      /fixture: something failed/
    );
    const after = await settingsRow(orgA);
    assert.equal(after.scripts_per_day, before.scripts_per_day);
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
    assert.equal((await requestRows(id)).length, 0);
  });

  test("a copy that hits the primary key rolls back and answers the first saved body", async () => {
    const before = await settingsRow(orgA);
    const id = rid("pk");
    const first = { settings: { note: "saved by the first copy" } };
    const out = await withRequest(db, { orgId: orgA, route: ROUTE, requestId: id }, async (tx) => {
      await saveSettings(tx, orgA, {
        patch: { settle_minutes: 33 }, updatedAt: before.updated_at.toISOString(), staffId: ownerA.id
      });
      // The first copy commits on its own connection while this one is still open.
      await db.query(
        `INSERT INTO marketing_requests (request_id, org_id, route, response) VALUES ($1,$2,$3,$4::jsonb)`,
        [id, orgA, ROUTE, JSON.stringify(first)]
      );
      return { settings: { note: "the copy" } };
    });
    assert.deepEqual(out, first);
    assert.equal((await settingsRow(orgA)).settle_minutes, before.settle_minutes, "the copy's save was rolled back");
    assert.equal((await requestRows(id)).length, 1);
  });

  test("a stale updated_at is 409 with what is saved now, and nothing is written", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const id = rid("stale");
    const old = new Date(Date.parse(cur.updated_at) - 60000).toISOString();
    const r = await call(tokenOwnerA, { method: "POST", body: { request_id: id, updated_at: old, patch: { scripts_per_day: 7 } } });
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, "stale");
    assert.ok(r.body.message);
    assert.deepEqual(r.body.current, cur);
    assert.equal((await settingsRow(orgA)).scripts_per_day, cur.scripts_per_day);
    assert.equal((await requestRows(id)).length, 0);

    // The same request_id is not stuck on the refusal: with the right time it saves.
    const ok = await call(tokenOwnerA, { method: "POST", body: { request_id: id, updated_at: cur.updated_at, patch: { scripts_per_day: 7 } } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.settings.scripts_per_day, 7);
  });

  test("a bad enum, an unknown key or a missing request_id is 400 and writes nothing", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const cases = [
      [{ size_rule: "each" }, "patch.size_rule"],
      [{ animation_mode: "both" }, "patch.animation_mode"],
      [{ batch_weekday: 9 }, "patch.batch_weekday"],
      [{ quiet_end: "7am" }, "patch.quiet_end"],
      [{ colour: "red" }, "patch.colour"]
    ];
    for (const [patch, field] of cases) {
      const id = rid("bad");
      const r = await call(tokenOwnerA, { method: "POST", body: { request_id: id, updated_at: cur.updated_at, patch } });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.deepEqual(r.body.error, "invalid");
      assert.equal(r.body.field, field);
      assert.equal((await requestRows(id)).length, 0);
    }
    const r = await call(tokenOwnerA, { method: "POST", body: { updated_at: cur.updated_at, patch: { clean_audio: false } } });
    assert.equal(r.code, 400);
    assert.equal(r.body.field, "request_id");
    const after = (await call(tokenOwnerA)).body.settings;
    assert.deepEqual(after, cur);
  });

  test("Chris's tap turns the machine on, and only for his company", async () => {
    const cur = (await call(tokenOwnerA)).body.settings;
    const r = await call(tokenOwnerA, { method: "POST", body: { request_id: rid("on"), updated_at: cur.updated_at, patch: { enabled: true } } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.settings.enabled, true);
    assert.equal((await call(tokenOwnerB)).body.settings.enabled, false);
  });

  // ── what migration 410 puts in the database itself ──────────────────────

  test("410's rules hold in the database", async () => {
    await call(tokenOwnerB); // make sure B's row exists, so each UPDATE below touches a row
    const bad =(set) => db.query(`UPDATE marketing_settings SET ${set} WHERE org_id = $1`, [orgB]);
    await assert.rejects(bad("batch_weekday = 7"), /marketing_settings_weekday_ck/);
    await assert.rejects(bad("size_rule = 'each'"), /marketing_settings_size_rule_ck/);
    await assert.rejects(bad("animation_mode = 'both'"), /marketing_settings_animation_mode_ck/);
    await assert.rejects(bad("scripts_per_day = 0"), /marketing_settings_positive_ck/);
    await assert.rejects(bad("format_style = '[]'::jsonb"), /marketing_settings_json_ck/);
    await assert.rejects(bad("caption_position_y = -1"), /marketing_settings_caption_y_ck/);
    await assert.rejects(
      db.query(`INSERT INTO marketing_requests (request_id, org_id, route, response) VALUES ('  ', $1, 'r', '{}')`, [orgB]),
      /marketing_requests_text_ck/
    );

    const t = (await db.query(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public'
                 AND p.tablename = c.relname AND p.policyname = c.relname || '_app_all') AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY c.relname`,
      [["marketing_funnels", "marketing_requests", "marketing_settings"]]
    )).rows;
    assert.equal(t.length, 3);
    for (const r of t) {
      assert.equal(r.rls, true, `${r.relname} row security on`);
      assert.equal(r.forced, true, `${r.relname} row security forced`);
      assert.equal(r.policies, 1, `${r.relname} has its _app_all policy`);
    }
  });
});
