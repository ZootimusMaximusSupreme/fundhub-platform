// Migration 475 and src/pulse/records.mjs, against a real Postgres.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL, AND IT SKIPS ON ANY NON-LOCAL DATABASE. A SKIPPED PG TEST IS NOT GREEN. ***
// It runs in CI (.github/workflows/tests.yml builds a throwaway Postgres on 127.0.0.1 from db/migrations and sets
// DATABASE_URL). It was NOT run on the machine that wrote it: that Mac has no Postgres, and the only reachable
// database is production, which this file must never touch. So the guard below refuses anything that is not a
// loopback host. The same SQL was proved read-only against the live database (statements) and by parsing the
// whole migration file in a read-only transaction; see ops/workflows/pulse-layer-2026-10-09.md, piece R1.
//
// Part 1 proves every CHECK in 475 and the one-open-incident index (a bad row is refused, naming the constraint).
// Part 2 proves the locks and grants. Part 3 runs each function in records.mjs on real rows.
//
// Every row this file makes has a beat id that starts "zz-pt-<tag>-" and is removed afterwards. Deleting needs the
// owner login (fundhub_app has no DELETE on these tables, on purpose); where it cannot, the leftovers carry the tag.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import * as rec from "./records.mjs";

const HOST = (() => { try { return new URL(process.env.DATABASE_URL || "").hostname; } catch { return ""; } })();
const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(HOST);
const SKIP = !process.env.DATABASE_URL
  ? "no DATABASE_URL (this runs in CI; a skipped pg test is not green)"
  : !LOOPBACK
    ? `DATABASE_URL host "${HOST}" is not loopback. This file inserts rows; it will not run against a shared database.`
    : false;

const TAG = crypto.randomBytes(3).toString("hex");
let seq = 0;
const bid = (name = "x") => `zz-pt-${TAG}-${name}-${++seq}`.slice(0, 44);
const hashOf = (s) => crypto.createHash("sha256").update(`${TAG}:${s}`).digest("hex");
const uuid = () => crypto.randomUUID();
/* closed_at must not be before opened_at (the database clock). The test clock may run a little behind it, so close in the future. */
const LATER = () => new Date(Date.now() + 3600_000);

let ORG = null;

/** INSERT a row from an object; null values are sent as NULL. */
async function insert(table, row) {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`;
  return (await db.query(sql, cols.map((c) => row[c]))).rows[0];
}
const beat = (o = {}) => insert("pulse_beats", { org_id: ORG, run_id: uuid(), beat_id: bid("b"), ok: true, ...o });
const incident = (o = {}) => insert("pulse_incidents", { org_id: ORG, beat_id: bid("i"), opened_run_id: uuid(), first_step: "fetch", first_detail: "answered 500", ...o });
const link = (o = {}) => insert("pulse_bank_links", { org_id: ORG, url_hash: hashOf(`l${++seq}`), host: `b-${TAG}.example`, ...o });

/** The insert is refused, and by exactly this constraint. */
async function refused(promise, constraint) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.constraint, constraint, `refused by ${e.constraint || "(no constraint)"}: ${e.message}`);
    return true;
  });
}

async function cleanup() {
  const like = `zz-pt-${TAG}-%`;
  try {
    await db.query(`DELETE FROM pulse_incidents WHERE beat_id LIKE $1`, [like]);
    await db.query(`DELETE FROM pulse_beats WHERE beat_id LIKE $1`, [like]);
    await db.query(`DELETE FROM pulse_bank_links WHERE org_id = $1 AND host LIKE $2`, [ORG, `%${TAG}%`]);
  } catch (err) {
    console.warn(`pulse-records.pg: could not remove test rows tagged ${TAG}: ${err.message}`);
  }
}

describe("migration 475 against a real Postgres", { skip: SKIP }, () => {
  before(async () => {
    ORG = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
  });
  after(async () => { await cleanup(); await close(); });

  describe("pulse_beats: every CHECK", () => {
    test("a good green row and a good red row are accepted; defaults fill in", async () => {
      const g = await beat();
      assert.equal(g.ok, true);
      assert.ok(g.ran_at && g.id);
      assert.equal(g.duration_ms, null, "an unmeasured duration stays NULL");
      const r = await beat({ ok: false, step: "fetch", detail: "answered 500", duration_ms: 0, steps: JSON.stringify([{ name: "fetch", ms: 3, ok: false }]) });
      assert.equal(r.duration_ms, 0);
    });
    test("beat id: capitals, spaces, a leading dash and 45 characters are refused; 44 is fine", async () => {
      for (const b of ["Bad", "has space", "-lead", "a".repeat(45), ""]) await refused(beat({ beat_id: b }), "pulse_beats_beat_id_ck");
      await beat({ beat_id: `zz-pt-${TAG}-` + "a".repeat(44 - 6 - TAG.length - 1) });
    });
    test("step: empty and over 120 characters are refused", async () => {
      await refused(beat({ step: "" }), "pulse_beats_step_ck");
      await refused(beat({ step: "s".repeat(121) }), "pulse_beats_step_ck");
    });
    test("detail over 2000 characters is refused", async () => {
      await refused(beat({ detail: "d".repeat(2001) }), "pulse_beats_detail_ck");
      await beat({ detail: "d".repeat(2000) });
    });
    test("a negative duration is refused", async () => {
      await refused(beat({ duration_ms: -1 }), "pulse_beats_duration_ck");
    });
    test("steps must be a JSON array under 8,000 bytes", async () => {
      await refused(beat({ steps: JSON.stringify({ not: "an array" }) }), "pulse_beats_steps_ck");
      const big = Array.from({ length: 600 }, (_, i) => ({ name: `step-${i}-${crypto.randomBytes(8).toString("hex")}` }));
      await refused(beat({ steps: JSON.stringify(big) }), "pulse_beats_steps_ck");
    });
    test("a red beat must say where and why", async () => {
      await refused(beat({ ok: false }), "pulse_beats_red_says_where_ck");
      await refused(beat({ ok: false, step: "fetch" }), "pulse_beats_red_says_where_ck");
      await refused(beat({ ok: false, detail: "boom" }), "pulse_beats_red_says_where_ck");
    });
    test("the same beat cannot be recorded twice for one run", async () => {
      const run = uuid(); const id = bid("dup");
      await beat({ run_id: run, beat_id: id });
      await refused(beat({ run_id: run, beat_id: id }), "pulse_beats_one_per_run");
      await beat({ run_id: uuid(), beat_id: id });
    });
    test("an org that does not exist is refused", async () => {
      await assert.rejects(beat({ org_id: uuid() }), (e) => e.code === "23503");
    });
  });

  describe("pulse_incidents: every CHECK and the one-open index", () => {
    test("a good open incident is accepted; defaults are 0 texts, not_set_up, open", async () => {
      const i = await incident();
      assert.equal(i.alerts_sent, 0);
      assert.equal(i.last_alert_at, null);
      assert.equal(i.closed_at, null);
      assert.equal(i.fixer_status, "not_set_up");
      assert.equal(i.github_issue_number, null);
    });
    test("beat id, first step and first detail limits", async () => {
      await refused(incident({ beat_id: "BAD ID" }), "pulse_incidents_beat_id_ck");
      await refused(incident({ first_step: "" }), "pulse_incidents_first_step_ck");
      await refused(incident({ first_step: "s".repeat(121) }), "pulse_incidents_first_step_ck");
      await refused(incident({ first_detail: "" }), "pulse_incidents_first_detail_ck");
      await refused(incident({ first_detail: "d".repeat(2001) }), "pulse_incidents_first_detail_ck");
    });
    test("alerts_sent cannot be negative", async () => {
      await refused(incident({ alerts_sent: -1, last_alert_at: new Date() }), "pulse_incidents_alerts_ck");
    });
    test("a text and its count agree: alerts_sent 1 with no time, or a time with 0 texts, is refused", async () => {
      await refused(incident({ alerts_sent: 1 }), "pulse_incidents_alert_pair_ck");
      await refused(incident({ alerts_sent: 0, last_alert_at: new Date() }), "pulse_incidents_alert_pair_ck");
      await incident({ alerts_sent: 2, last_alert_at: new Date() });
    });
    test("GitHub issue: positive number, a github.com issue url, and both or neither", async () => {
      const url = "https://github.com/o/r/issues/12";
      await refused(incident({ github_issue_number: 0, github_issue_url: url }), "pulse_incidents_issue_number_ck");
      await refused(incident({ github_issue_number: 1, github_issue_url: "https://evil.example/o/r/issues/1" }), "pulse_incidents_issue_url_ck");
      await refused(incident({ github_issue_number: 1, github_issue_url: "http://github.com/o/r/issues/1" }), "pulse_incidents_issue_url_ck");
      await refused(incident({ github_issue_number: 12 }), "pulse_incidents_issue_pair_ck");
      await refused(incident({ github_issue_url: url }), "pulse_incidents_issue_pair_ck");
      const ok = await incident({ github_issue_number: 12, github_issue_url: url });
      assert.equal(ok.github_issue_number, 12);
    });
    test("fixer status must be in the list", async () => {
      await refused(incident({ fixer_status: "bogus" }), "pulse_incidents_fixer_status_ck");
      for (const s of rec.FIXER_STATUSES) await incident({ fixer_status: s });
    });
    test("the Claude session link must be a claude.ai link, no spaces, 500 characters at most", async () => {
      await refused(incident({ claude_session_url: "http://claude.ai/code/x" }), "pulse_incidents_session_url_ck");
      await refused(incident({ claude_session_url: "https://evil.example/code/x" }), "pulse_incidents_session_url_ck");
      await refused(incident({ claude_session_url: "https://claude.ai/code/a b" }), "pulse_incidents_session_url_ck");
      await refused(incident({ claude_session_url: "https://claude.ai/" + "x".repeat(500) }), "pulse_incidents_session_url_ck");
      await incident({ claude_session_url: "https://claude.ai/code/abc" });
    });
    test("cause category must be in the closed list; every listed value is accepted", async () => {
      await refused(incident({ cause_category: "bogus" }), "pulse_incidents_cause_category_ck");
      for (const c of rec.CAUSE_CATEGORIES) await incident({ cause_category: c });
    });
    test("cause note, fix summary and guard are capped at 2000 characters", async () => {
      await refused(incident({ cause_note: "n".repeat(2001) }), "pulse_incidents_cause_note_ck");
      await refused(incident({ fix_summary: "f".repeat(2001) }), "pulse_incidents_fix_summary_ck");
      await refused(incident({ guard_added: "g".repeat(2001) }), "pulse_incidents_guard_added_ck");
    });
    test("closed_by must be auto, claude or chris", async () => {
      const lesson = { cause_category: "code_bug", cause_note: "n", fix_summary: "f", guard_added: "g" };
      await refused(incident({ closed_at: LATER(), closed_by: "robot", ...lesson }), "pulse_incidents_closed_by_ck");
    });
    test("closed_at and closed_by come together", async () => {
      await refused(incident({ closed_at: LATER() }), "pulse_incidents_closed_pair_ck");
      await refused(incident({ closed_by: "auto" }), "pulse_incidents_closed_pair_ck");
    });
    test("a close cannot come before the open", async () => {
      await refused(incident({ opened_at: new Date(), closed_at: new Date(Date.now() - 3600_000), closed_by: "auto" }), "pulse_incidents_closed_after_open_ck");
    });
    test("auto may close with no cause; claude and chris need all four learning fields", async () => {
      await incident({ closed_at: LATER(), closed_by: "auto" });
      const full = { cause_category: "bank_site_changed", cause_note: "Bank moved the page", fix_summary: "Updated the list", guard_added: "none: a bank change" };
      await incident({ closed_at: LATER(), closed_by: "claude", ...full });
      await incident({ closed_at: LATER(), closed_by: "chris", ...full });
      for (const by of ["claude", "chris"]) {
        await refused(incident({ closed_at: LATER(), closed_by: by }), "pulse_incidents_learned_ck");
        await refused(incident({ closed_at: LATER(), closed_by: by, ...full, cause_category: null }), "pulse_incidents_learned_ck");
        await refused(incident({ closed_at: LATER(), closed_by: by, ...full, cause_note: "   " }), "pulse_incidents_learned_ck");
        await refused(incident({ closed_at: LATER(), closed_by: by, ...full, fix_summary: "" }), "pulse_incidents_learned_ck");
        await refused(incident({ closed_at: LATER(), closed_by: by, ...full, guard_added: null }), "pulse_incidents_learned_ck");
      }
    });
    test("a second OPEN incident for the same beat is refused; closing it allows a new one; other beats are free", async () => {
      const id = bid("one");
      const first = await incident({ beat_id: id });
      await refused(incident({ beat_id: id }), "pulse_incidents_one_open");
      await incident({ beat_id: bid("other") });
      await db.query(`UPDATE pulse_incidents SET closed_at = now(), closed_by = 'auto' WHERE id = $1`, [first.id]);
      await incident({ beat_id: id });
      await refused(incident({ beat_id: id }), "pulse_incidents_one_open");
    });
  });

  describe("pulse_bank_links: every CHECK", () => {
    test("a good row is accepted; defaults fill in", async () => {
      const l = await link();
      assert.deepEqual(l.lender_ids, []);
      assert.equal(l.fail_streak, 0);
      assert.ok(l.first_seen_at);
      assert.equal(l.last_class, null);
    });
    test("hash must be 64 lowercase hex characters", async () => {
      for (const h of ["short", "A".repeat(64), "g".repeat(64), "a".repeat(65)]) await refused(link({ url_hash: h }), "pulse_bank_links_hash_ck");
    });
    test("host 1 to 255 characters; final host 255 at most", async () => {
      await refused(link({ host: "" }), "pulse_bank_links_host_ck");
      await refused(link({ host: "h".repeat(256) }), "pulse_bank_links_host_ck");
      await refused(link({ final_host: "h".repeat(256) }), "pulse_bank_links_final_host_ck");
    });
    test("class is one of OK WALL HARD SLOW BAD_URL; status 0 to 999; detail 300; streak not negative", async () => {
      await refused(link({ last_class: "MAYBE" }), "pulse_bank_links_class_ck");
      for (const c of rec.BANK_LINK_CLASSES) await link({ last_class: c });
      await refused(link({ last_status: 1000 }), "pulse_bank_links_status_ck");
      await refused(link({ last_status: -1 }), "pulse_bank_links_status_ck");
      await link({ last_status: 0 }); await link({ last_status: 999 });
      await refused(link({ last_detail: "d".repeat(301) }), "pulse_bank_links_detail_ck");
      await refused(link({ fail_streak: -1 }), "pulse_bank_links_streak_ck");
    });
    test("one row per org and URL hash", async () => {
      const h = hashOf("dup");
      await link({ url_hash: h });
      await refused(link({ url_hash: h }), "pulse_bank_links_pkey");
    });
  });

  describe("locks and grants", () => {
    const TABLES = ["pulse_beats", "pulse_incidents", "pulse_bank_links"];

    test("row security is on and forced, with a policy, on all three tables", async () => {
      const r = await db.query(
        `SELECT c.relname, c.relrowsecurity AS on_, c.relforcerowsecurity AS forced,
                (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = c.relname || '_app_all') AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY c.relname`, [TABLES]);
      assert.equal(r.rows.length, 3);
      for (const row of r.rows) {
        assert.equal(row.on_, true, `${row.relname}: row security off`);
        assert.equal(row.forced, true, `${row.relname}: row security not forced`);
        assert.equal(row.policies, 1, `${row.relname}: no ${row.relname}_app_all policy (a locked-shut table is invisible to the app)`);
      }
    });

    async function can(role, table, priv) {
      return (await db.query(`SELECT has_table_privilege($1, $2, $3) AS v`, [role, `public.${table}`, priv])).rows[0].v;
    }
    async function roleExists(role) {
      return (await db.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role])).rowCount > 0;
    }

    test("fundhub_app: beats select+insert only; incidents and bank links select+insert+update; nothing deletes", async (t) => {
      if (!(await roleExists("fundhub_app"))) return t.skip("no fundhub_app role in this database");
      const want = {
        pulse_beats: { SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false },
        pulse_incidents: { SELECT: true, INSERT: true, UPDATE: true, DELETE: false, TRUNCATE: false },
        pulse_bank_links: { SELECT: true, INSERT: true, UPDATE: true, DELETE: false, TRUNCATE: false }
      };
      for (const [table, privs] of Object.entries(want)) {
        for (const [p, v] of Object.entries(privs)) assert.equal(await can("fundhub_app", table, p), v, `fundhub_app ${p} on ${table}`);
      }
    });

    test("anon and authenticated (the public web keys) can do nothing on these tables", async (t) => {
      const roles = [];
      for (const r of ["anon", "authenticated"]) if (await roleExists(r)) roles.push(r);
      if (roles.length === 0) return t.skip("no anon / authenticated roles in this database");
      for (const role of roles) {
        for (const table of TABLES) {
          for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
            assert.equal(await can(role, table, p), false, `${role} can ${p} on ${table}`);
          }
        }
      }
    });
  });
});

describe("src/pulse/records.mjs against a real Postgres", { skip: SKIP }, () => {
  before(async () => {
    ORG = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
  });
  after(async () => { await cleanup(); await close(); });

  const rowsOf = async (table, where, params) => (await db.query(`SELECT * FROM ${table} WHERE ${where}`, params)).rows;

  test("defaultOrgId returns the default org", async () => {
    const r = await rec.defaultOrgId(db);
    assert.deepEqual([r.ok, r.orgId], [true, ORG]);
  });

  test("writeBeatResults saves green and red rows, keeps an unmeasured time NULL, and a re-run writes nothing twice", async () => {
    const runId = uuid(); const a = bid("w"), b = bid("w");
    const results = [
      { beatId: a, ok: true, step: "done", detail: "fine", ms: 120, steps: [{ name: "secret-present", ms: 3, ok: true }] },
      { beatId: b, ok: false, step: "fetch", detail: "answered 500", ms: null }
    ];
    const first = await rec.writeBeatResults(db, { orgId: ORG, runId, results });
    assert.deepEqual([first.ok, first.written, first.skipped], [true, 2, 0], first.error);
    const again = await rec.writeBeatResults(db, { orgId: ORG, runId, results });
    assert.deepEqual([again.ok, again.written], [true, 0]);
    const rows = await rowsOf("pulse_beats", "run_id = $1 ORDER BY beat_id", [runId]);
    assert.equal(rows.length, 2);
    const green = rows.find((r) => r.beat_id === a), red = rows.find((r) => r.beat_id === b);
    assert.equal(green.duration_ms, 120);
    assert.deepEqual(green.steps, [{ name: "secret-present", ok: true, ms: 3 }]);
    assert.equal(red.duration_ms, null, "an unmeasured time must stay NULL");
    assert.deepEqual([red.ok, red.step, red.detail], [false, "fetch", "answered 500"]);
  });

  test("a red result with no step or detail still saves, and long text is cut instead of failing the batch", async () => {
    const runId = uuid(); const a = bid("w"), b = bid("w");
    const r = await rec.writeBeatResults(db, { orgId: ORG, runId, results: [
      { beatId: a, ok: false },
      { beatId: b, ok: false, step: "s".repeat(500), detail: "d".repeat(5000) }
    ] });
    assert.deepEqual([r.ok, r.written], [true, 2], r.error);
    const rows = await rowsOf("pulse_beats", "run_id = $1", [runId]);
    assert.ok(rows.every((x) => x.step && x.detail));
    assert.equal(rows.find((x) => x.beat_id === b).detail.length, 2000);
  });

  test("one batch with a NUL, a lone surrogate, a split emoji, a 1e12 duration and a bad time still saves every row", async () => {
    const runId = uuid();
    const ids = Array.from({ length: 6 }, () => bid("n"));
    const results = [
      { beatId: ids[0], ok: false, step: "fe\u0000tch", detail: "a\u0000b" },
      { beatId: ids[1], ok: false, step: "s", detail: "lone\uD83Dhalf and \uDE00low" },
      { beatId: ids[2], ok: false, step: "s", detail: "x".repeat(1999) + "\u{1F600}" },
      { beatId: ids[3], ok: true, ms: 1e12, ranAt: new Date(8.64e15) },
      { beatId: ids[4], ok: false, step: "\u0000", detail: "\uD83D" },
      { beatId: ids[5], ok: true, ms: 5, steps: Array.from({ length: 40 }, (_, i) => ({ name: "\u{1F600}".repeat(30) + i, ms: 2147483647, ok: true })) }
    ];
    const r = await rec.writeBeatResults(db, { orgId: ORG, runId, results });
    assert.deepEqual([r.ok, r.written, r.skipped], [true, 6, 0], r.error);
    const rows = await rowsOf("pulse_beats", "run_id = $1", [runId]);
    const by = (id) => rows.find((x) => x.beat_id === id);
    assert.deepEqual([by(ids[0]).step, by(ids[0]).detail], ["fetch", "ab"]);
    assert.equal(by(ids[1]).detail, "lonehalf and low");
    assert.equal(by(ids[2]).detail, "x".repeat(1999));
    assert.equal(by(ids[3]).duration_ms, 2147483647);
    assert.deepEqual([by(ids[4]).step, by(ids[4]).detail], ["unknown", "(no detail)"]);
    assert.ok(by(ids[5]).steps.length >= 1 && by(ids[5]).steps.length < 40, "emoji steps are cut by bytes and pass the 8,000 byte CHECK");
  });

  test("the same bad text coming back next hour is saved again (nothing is stuck on it)", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await rec.writeBeatResults(db, { orgId: ORG, runId: uuid(), results: [{ beatId: bid("again"), ok: false, step: "s", detail: "a\u0000\uD83D" }] });
      assert.deepEqual([r.ok, r.written], [true, 1], r.error);
    }
  });

  test("lastResults returns the newest 2 per beat, and last24 drops anything older than a day", async () => {
    const x = bid("lr"), y = bid("lr");
    const at = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    for (const [beatId, h, ok] of [[x, 30, true], [x, 3, false], [x, 2, false], [x, 1, true], [y, 1, true]]) {
      const w = await rec.writeBeatResults(db, { orgId: ORG, runId: uuid(), results: [{ beatId, ok, ranAt: at(h), ms: 5 }] });
      assert.equal(w.written, 1, w.error);
    }
    const last = await rec.lastResults(db, { orgId: ORG, beatIds: [x, y, bid("never")] });
    assert.equal(last.ok, true, last.error);
    const xs = last.rows.filter((r) => r.beat_id === x);
    assert.deepEqual(xs.map((r) => r.ok), [true, false], "newest first, only two");
    assert.equal(last.rows.filter((r) => r.beat_id === y).length, 1);
    assert.equal(last.rows.length, 3);
    const day = await rec.last24(db, { orgId: ORG, beatId: x });
    assert.equal(day.ok, true, day.error);
    assert.deepEqual(day.rows.map((r) => r.ok), [true, false, false], "the 30-hour-old row is not in the last 24 hours");
  });

  test("an incident goes open -> claimed text -> issue -> fixer -> closed -> opened again", async () => {
    const beatId = bid("inc"); const run = uuid();
    const opened = await rec.openIncident(db, { orgId: ORG, beatId, runId: run, step: "fetch", detail: "answered 500" });
    assert.deepEqual([opened.ok, opened.won], [true, true], opened.error);
    const lost = await rec.openIncident(db, { orgId: ORG, beatId, runId: uuid(), step: "other", detail: "other" });
    assert.deepEqual([lost.ok, lost.won, lost.id], [true, false, null], "a second run must not take the same break");

    const open = await rec.listOpenIncidents(db, ORG);
    const mine = open.rows.find((r) => r.id === opened.id);
    assert.ok(mine, "the new incident is listed as open");
    assert.deepEqual([mine.beat_id, mine.first_step, mine.alerts_sent, mine.last_alert_at, mine.opened_run_id], [beatId, "fetch", 0, null, run]);

    const c1 = await rec.claimAlert(db, opened.id);
    assert.deepEqual([c1.ok, c1.claimed, c1.alertsSent], [true, true, 1], c1.error);
    const c2 = await rec.claimAlert(db, opened.id);
    assert.deepEqual([c2.ok, c2.claimed], [true, false], "no second text inside 50 minutes");
    await db.query(`UPDATE pulse_incidents SET last_alert_at = now() - interval '51 minutes' WHERE id = $1`, [opened.id]);
    const c3 = await rec.claimAlert(db, opened.id);
    assert.deepEqual([c3.claimed, c3.alertsSent], [true, 2], "a claim is possible again after 50 minutes");

    const issue = await rec.setIssue(db, opened.id, { number: 41, url: "https://github.com/o/r/issues/41", fixerStatus: "dispatched" });
    assert.deepEqual([issue.ok, issue.updated], [true, true], issue.error);
    const fixer = await rec.setFixer(db, opened.id, { sessionUrl: "https://claude.ai/code/abc" });
    assert.deepEqual([fixer.ok, fixer.updated], [true, true], fixer.error);
    let row = (await rowsOf("pulse_incidents", "id = $1", [opened.id]))[0];
    assert.deepEqual([row.github_issue_number, row.fixer_status, row.claude_session_url], [41, "dispatched", "https://claude.ai/code/abc"],
      "setFixer with no status must not blank the status");

    const lesson = { cause_category: "vendor_changed", cause_note: "Bank moved the page", fix_summary: "Updated the list", guard_added: "none: a bank change" };
    assert.equal((await rec.closeIncident(db, opened.id, { closedBy: "claude" })).ok, false, "claude needs a lesson");
    const closed = await rec.closeIncident(db, opened.id, { closedBy: "claude", lesson });
    assert.deepEqual([closed.ok, closed.closed], [true, true], closed.error);
    row = (await rowsOf("pulse_incidents", "id = $1", [opened.id]))[0];
    assert.deepEqual([row.closed_by, row.cause_category, row.guard_added], ["claude", "vendor_changed", "none: a bank change"]);
    assert.ok(row.closed_at);
    assert.equal((await rec.closeIncident(db, opened.id, { closedBy: "auto" })).closed, false, "already closed");
    assert.equal((await rec.claimAlert(db, opened.id)).claimed, false, "no text for a closed incident");
    assert.equal((await rec.listOpenIncidents(db, ORG)).rows.some((r) => r.id === opened.id), false);

    const again = await rec.openIncident(db, { orgId: ORG, beatId, runId: uuid(), step: "fetch", detail: "broke again" });
    assert.deepEqual([again.ok, again.won], [true, true], "after a close, the same beat can open a new incident");
  });

  test("closeIncident auto leaves the learning fields NULL", async () => {
    const o = await rec.openIncident(db, { orgId: ORG, beatId: bid("auto"), runId: uuid(), step: "s", detail: "d" });
    const c = await rec.closeIncident(db, o.id, { closedBy: "auto" });
    assert.equal(c.closed, true, c.error);
    const row = (await rowsOf("pulse_incidents", "id = $1", [o.id]))[0];
    assert.deepEqual([row.closed_by, row.cause_category, row.cause_note, row.fix_summary, row.guard_added], ["auto", null, null, null, null]);
  });

  test("openIncident can carry an issue from the start", async () => {
    const o = await rec.openIncident(db, { orgId: ORG, beatId: bid("iss"), runId: uuid(), step: "s", detail: "d", issue: { number: 7, url: "https://github.com/o/r/issues/7" } });
    assert.equal(o.won, true, o.error);
    const row = (await rowsOf("pulse_incidents", "id = $1", [o.id]))[0];
    assert.deepEqual([row.github_issue_number, row.github_issue_url], [7, "https://github.com/o/r/issues/7"]);
  });

  describe("bank links", () => {
    const H = (n) => hashOf(`fn-${n}`);
    const HOST_A = `a-${TAG}.example`;
    const L1 = uuid(), L2 = uuid();
    const get = async (n) => (await rec.loadBankLinks(db, ORG)).rows.find((r) => r.urlHash === H(n));

    test("a registration saves the URL's host and lenders and nothing else; loadBankLinks returns the delta-13 shape", async () => {
      const w = await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(1), host: HOST_A, lenderId: L1 }] });
      assert.deepEqual([w.ok, w.written, w.skipped], [true, 1, 0], w.error);
      const l = await get(1);
      assert.ok(l, "the row loads back");
      assert.deepEqual([l.lenderId, l.host, l.lastCheckedAt, l.lastGoodAt, l.lastClass, l.lastStatus, l.failStreak, l.lastHost],
        [L1, HOST_A, null, null, null, null, 0, HOST_A]);
      assert.match(l.firstSeenAt, /^\d{4}-\d\d-\d\dT/);
    });

    test("a good check, then bad checks: the streak counts, the good time stays, an OK check resets the streak", async () => {
      const t1 = "2026-10-09T06:00:00.000Z", t2 = "2026-10-09T07:00:00.000Z", t3 = "2026-10-09T08:00:00.000Z", t4 = "2026-10-09T09:00:00.000Z";
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(2), host: HOST_A, lastCheckedAt: t1, lastGoodAt: t1, lastClass: "OK", lastStatus: 200, lastHost: HOST_A }] });
      let l = await get(2);
      assert.deepEqual([l.lastClass, l.failStreak, l.lastGoodAt], ["OK", 0, t1]);
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(2), host: HOST_A, lastCheckedAt: t2, lastClass: "HARD", lastStatus: 404, lastDetail: "answered 404" }] });
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(2), host: HOST_A, lastCheckedAt: t3, lastClass: "HARD", lastStatus: 404, lastDetail: "answered 404" }] });
      l = await get(2);
      assert.deepEqual([l.lastClass, l.lastStatus, l.failStreak, l.lastCheckedAt, l.lastGoodAt, l.lastDetail], ["HARD", 404, 2, t3, t1, "answered 404"],
        "it WAS good at t1 and is dead now: that is what makes it red");
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(2), host: HOST_A, lastCheckedAt: t4, lastGoodAt: t4, lastClass: "OK", lastStatus: 200 }] });
      l = await get(2);
      assert.deepEqual([l.lastClass, l.failStreak, l.lastGoodAt], ["OK", 0, t4]);
    });

    test("last_good_at never moves backward and never goes back to NULL; a registration keeps the old check", async () => {
      const t1 = "2026-10-09T06:00:00.000Z", t0 = "2026-10-01T06:00:00.000Z";
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(3), host: HOST_A, lastCheckedAt: t1, lastGoodAt: t1, lastClass: "OK", lastStatus: 200 }] });
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(3), host: HOST_A, lastGoodAt: t0 }] });
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(3), host: HOST_A }] });
      const l = await get(3);
      assert.deepEqual([l.lastGoodAt, l.lastClass, l.lastCheckedAt, l.lastStatus, l.failStreak], [t1, "OK", t1, 200, 0]);
    });

    test("an OK check with no lastGoodAt still sets last_good_at (the check time, else now); a failed first check leaves it empty", async () => {
      const t1 = "2026-10-09T06:00:00.000Z", t2 = "2026-10-09T07:00:00.000Z";
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(7), host: HOST_A, lastCheckedAt: t1, lastClass: "OK", lastStatus: 200 }] });
      assert.equal((await get(7)).lastGoodAt, t1, "the check time is the good time");
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(7), host: HOST_A, lastCheckedAt: t2, lastClass: "HARD", lastStatus: 404, lastDetail: "answered 404" }] });
      const dead = await get(7);
      assert.deepEqual([dead.lastClass, dead.failStreak, dead.lastGoodAt], ["HARD", 1, t1], "was good at t1 and dead now: red");
      const before = Date.now();
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(8), host: HOST_A, lastClass: "OK" }] });
      const bare = await get(8);
      assert.ok(bare.lastGoodAt && Math.abs(Date.parse(bare.lastGoodAt) - before) < 120_000, `no times at all: now() is used, got ${bare.lastGoodAt}`);
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(9), host: HOST_A, lastCheckedAt: t1, lastClass: "HARD", lastStatus: 500 }] });
      assert.equal((await get(9)).lastGoodAt, null, "never seen good: it cannot go red");
    });

    test("a NUL, a lone surrogate and a bad time in one link do not stop the other links from saving", async () => {
      const w = await rec.upsertBankLinks(db, { orgId: ORG, rows: [
        { urlHash: H(10), host: HOST_A, lastClass: "HARD", lastStatus: 404, lastDetail: "no\u0000pe\uD83D", lastCheckedAt: new Date(8.64e15) },
        { urlHash: H(11), host: HOST_A, lastClass: "OK", lastCheckedAt: "2026-10-09T06:00:00Z" }
      ] });
      assert.deepEqual([w.ok, w.written, w.skipped], [true, 2, 0], w.error);
      assert.equal((await get(10)).lastDetail, "nope");
      assert.equal((await get(11)).lastClass, "OK");
    });

    test("lender ids are replaced when given and kept when not; first_seen_at survives an update", async () => {
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(4), host: HOST_A, lenderIds: [L1] }] });
      const before = await get(4);
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(4), host: HOST_A, lenderIds: [L1, L2] }] });
      assert.deepEqual((await get(4)).lenderIds.sort(), [L1, L2].sort());
      await rec.upsertBankLinks(db, { orgId: ORG, rows: [{ urlHash: H(4), host: HOST_A }] });
      const after = await get(4);
      assert.deepEqual(after.lenderIds.sort(), [L1, L2].sort());
      assert.equal(after.firstSeenAt, before.firstSeenAt);
    });

    test("many rows, including the same URL twice, go in as one statement", async () => {
      const w = await rec.upsertBankLinks(db, { orgId: ORG, rows: [
        { urlHash: H(5), host: HOST_A, lastClass: "OK", lastCheckedAt: "2026-10-09T06:00:00Z" },
        { urlHash: H(5), host: HOST_A, lastClass: "WALL", lastStatus: 403, lastCheckedAt: "2026-10-09T07:00:00Z" },
        { urlHash: H(6), host: HOST_A, lastClass: "SLOW" },
        { urlHash: "bad", host: HOST_A }
      ] });
      assert.deepEqual([w.ok, w.written, w.skipped], [true, 2, 1], w.error);
      assert.equal((await get(5)).lastClass, "WALL");
      assert.equal((await get(6)).failStreak, 1);
    });

    test("loadBankLinks lists never-checked rows first", async () => {
      const rows = (await rec.loadBankLinks(db, ORG)).rows.filter((r) => r.host === HOST_A);
      const firstChecked = rows.findIndex((r) => r.lastCheckedAt !== null);
      const lastUnchecked = rows.map((r) => r.lastCheckedAt === null).lastIndexOf(true);
      assert.ok(firstChecked === -1 || lastUnchecked < firstChecked, "an unchecked row came after a checked one");
    });
  });
});
