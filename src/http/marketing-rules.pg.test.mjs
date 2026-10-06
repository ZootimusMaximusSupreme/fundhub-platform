// GET/POST /api/marketing/rules and POST /api/marketing/scripts/fix (plan unit
// U26, spec §7.8, §7.1, §8.1 tab 5) against real Postgres. Lives under src/http/
// because npm test globs src/** and scripts/** only (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips,
// and a skipped .pg.test.mjs is not green.
//
// No network: GitHub is a fake passed in through deps; without a token the route
// reads the repo's own RULES.md and banned-live.json (the bundled copy).
//
// TWO COMPANIES OF ITS OWN (slug prefix below). Every outbox row, job, script and
// saved answer it makes belongs to them and is removed after, so the
// repo-outbox suite's drain never sees a row from here.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import rulesHandler from "../../api/marketing/rules.mjs";
import fixHandler from "../../api/marketing/scripts/fix.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { RULES_PATH, BANNED_PATH, readPart0 } from "../repo/edit-ops.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG_TAG = "zz-mm-rules-pg";
const EMAIL_TAG = "zz_mm_rules_pg";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_ON_DISK = fs.readFileSync(path.join(ROOT, RULES_PATH), "utf8");
const BANNED_ON_DISK = JSON.parse(fs.readFileSync(path.join(ROOT, BANNED_PATH), "utf8"));
const SHA = "1111111111111111111111111111111111111111";

let seq = 0;
const rid = (tag) => `mm-rules-${tag}-${RUN}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

describe("/api/marketing/rules and /api/marketing/scripts/fix", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, partnerA, partnerB, tokenOwnerA, tokenCloserA, tokenOwnerB;
  let wakes = 0;

  async function call(handler, token, { method = "GET", body, env = {}, rules } = {}) {
    const r = res();
    await handler(
      { method, headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body },
      r,
      { db, env, rules, wake: async () => { wakes++; return { ok: true, started: false }; } }
    );
    if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
    return r;
  }
  const getRules = (token, opts = {}) => call(rulesHandler, token, opts);
  const postRule = (token, body) => call(rulesHandler, token, { method: "POST", body });
  const postFix = (token, body) => call(fixHandler, token, { method: "POST", body });

  const outboxRows = async (org) => (await db.query(`SELECT * FROM repo_outbox WHERE org_id = $1 ORDER BY id`, [org])).rows;
  const jobRows = async (org) => (await db.query(`SELECT * FROM marketing_jobs WHERE org_id = $1 ORDER BY created_at`, [org])).rows;

  async function purgeScripts() {
    const orgs = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
    for (let i = 0; i < 20; i++) {
      const gone = await db.query(
        `DELETE FROM ad_scripts s
          WHERE s.org_id IN ${orgs}
            AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                             WHERE k.id <> s.id AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`
      );
      if (!gone.rowCount) break;
    }
  }

  async function cleanup() {
    const orgs = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
    await db.query(`DELETE FROM repo_outbox WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_requests WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_jobs WHERE org_id IN ${orgs}`);
    await purgeScripts();
    await db.query(`DELETE FROM partners WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}.${RUN}@example.com`, `Rules ${tag}`, role]
    )).rows[0];
    return (await createSession(db, { staffId: row.id, orgId: org })).token;
  }

  const mkOrg = async (suffix) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing rules fixture') RETURNING id`, [`${SLUG_TAG}-${suffix}-${RUN}`]
  )).rows[0].id;
  const mkPartner = async (org, suffix) => (await db.query(
    `INSERT INTO partners (org_id, name, slug) VALUES ($1, 'Rules test house', $2) RETURNING id`, [org, `${SLUG_TAG}-house-${suffix}-${RUN}`]
  )).rows[0].id;

  /** A script version 1 (its own root), as the writer would leave a draft. */
  const mkScript = async (org, partner, body = "HOOK: lenders read two files.\nCTA: book a call.") => (await db.query(
    `INSERT INTO ad_scripts (org_id, partner_id, body, parts, source)
     VALUES ($1, $2, $3, '[{"kind":"hook","text":"lenders read two files."}]'::jsonb, 'machine')
     RETURNING *`,
    [org, partner, body]
  )).rows[0];

  before(async () => {
    await cleanup();
    orgA = await mkOrg("a");
    orgB = await mkOrg("b");
    partnerA = await mkPartner(orgA, "a");
    partnerB = await mkPartner(orgB, "b");
    tokenOwnerA = await staffIn(orgA, "owner", "a.owner");
    tokenCloserA = await staffIn(orgA, "closer", "a.closer");
    tokenOwnerB = await staffIn(orgB, "owner", "b.owner");
  });

  after(async () => { await cleanup(); await close(); });

  // ── rules ─────────────────────────────────────────────────────────────────

  test("a closer gets 403 on both routes and nothing is queued", async () => {
    assert.equal((await getRules(tokenCloserA)).code, 403);
    assert.equal((await postRule(tokenCloserA, { request_id: rid("gate"), action: "ban", text: "game changer" })).code, 403);
    const script = await mkScript(orgA, partnerA);
    const f = await postFix(tokenCloserA, { request_id: rid("gate"), id: script.id, version: 1, note: "x", make_rule: true });
    assert.equal(f.code, 403);
    assert.equal((await outboxRows(orgA)).length, 0);
    assert.equal((await jobRows(orgA)).length, 0);
    assert.equal((await getRules(null)).code, 401);
  });

  test("GET reads Part 0 from the bundled RULES.md as [{n, text}], plus banned-live.json and an empty recent list", async () => {
    const r = await getRules(tokenOwnerA);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/rules", r.body);
    assert.equal(r.body.source, "bundle");
    assert.equal(r.body.rules_sha, null, "no deploy commit on a laptop or in CI");
    assert.deepEqual(r.body.part0, readPart0(RULES_ON_DISK));
    assert.equal(r.body.part0.length, 45);
    assert.deepEqual(r.body.part0[0].n, 0);
    assert.deepEqual(r.body.banned, BANNED_ON_DISK);
    assert.deepEqual(r.body.recent, []);
  });

  test("GET reads GitHub at the current sha when a token is set", async () => {
    const asked = [];
    const rules = {
      getRef: async () => ({ ok: true, sha: SHA }),
      getContents: async (p, { ref }) => {
        asked.push([p, ref]);
        if (p === RULES_PATH) return { ok: true, missing: false, content: "# PART 0 — CHRIS'S RULES\n\n0. Chris's word wins.\n1. Say it plainly.\n" };
        return { ok: true, missing: false, content: '["game changer"]\n' };
      }
    };
    const r = await getRules(tokenOwnerA, { env: { GITHUB_REPO_TOKEN: "test-token-not-real" }, rules });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/rules", r.body);
    assert.equal(r.body.source, "github");
    assert.equal(r.body.rules_sha, SHA);
    assert.deepEqual(r.body.part0, [{ n: 0, text: "Chris's word wins." }, { n: 1, text: "Say it plainly." }]);
    assert.deepEqual(r.body.banned, ["game changer"]);
    assert.deepEqual(asked.map((a) => a[1]), [SHA, SHA]);
  });

  test("POST add, edit and ban: 202 with op_id, and the right edit op queued in the outbox", async () => {
    const before = wakes;
    const add = await postRule(tokenOwnerA, { request_id: rid("add"), action: "add", text: "Say  review your file\nthe way a lender does." });
    assert.equal(add.code, 202, JSON.stringify(add.body));
    assertMatchesContract("POST marketing/rules", add.body);
    assert.equal(add.body.queued, true);

    const edit = await postRule(tokenOwnerA, { request_id: rid("edit"), action: "edit", n: 3, text: "New words for rule three." });
    assert.equal(edit.code, 202, JSON.stringify(edit.body));
    const ban = await postRule(tokenOwnerA, { request_id: rid("ban"), action: "ban", text: "game changer" });
    assert.equal(ban.code, 202, JSON.stringify(ban.body));
    assert.equal(wakes, before + 3);

    const rows = await outboxRows(orgA);
    const byOp = Object.fromEntries(rows.map((x) => [x.op_id, x]));
    assert.equal(byOp[add.body.op_id].path, RULES_PATH);
    assert.equal(byOp[add.body.op_id].mode, "edit");
    assert.deepEqual(byOp[add.body.op_id].edit, { op: "part0_add_rule", text: "Say review your file the way a lender does." });
    assert.equal(byOp[edit.body.op_id].path, RULES_PATH);
    assert.deepEqual(byOp[edit.body.op_id].edit, { op: "part0_edit_rule", number: 3, text: "New words for rule three." });
    assert.equal(byOp[ban.body.op_id].path, BANNED_PATH);
    assert.deepEqual(byOp[ban.body.op_id].edit, { op: "ban_phrase", phrase: "game changer" });
    for (const op of [add, edit, ban]) assert.equal(byOp[op.body.op_id].committed_sha, null);

    // recent: newest first, waiting until the outbox commits, then committed / failed.
    await db.query(`UPDATE repo_outbox SET committed_sha = $2, committed_at = now() WHERE op_id = $1`, [add.body.op_id, SHA]);
    await db.query(`UPDATE repo_outbox SET error = '422 Part 0 has no rule 3' WHERE op_id = $1`, [edit.body.op_id]);
    const g = await getRules(tokenOwnerA);
    assert.equal(g.code, 200);
    assertMatchesContract("GET marketing/rules", g.body);
    const recent = Object.fromEntries(g.body.recent.map((x) => [x.op_id, x]));
    assert.deepEqual(g.body.recent.map((x) => x.op_id), [ban.body.op_id, edit.body.op_id, add.body.op_id]);
    assert.equal(recent[ban.body.op_id].action, "ban");
    assert.equal(recent[ban.body.op_id].text, "game changer");
    assert.equal(recent[ban.body.op_id].state, "waiting");
    assert.equal(recent[edit.body.op_id].action, "edit");
    assert.equal(recent[edit.body.op_id].state, "failed");
    assert.equal(recent[add.body.op_id].state, "committed");
    assert.equal(recent[add.body.op_id].committed_sha, SHA);

    const other = await getRules(tokenOwnerB);
    assert.deepEqual(other.body.recent, [], "another company sees none of these");
  });

  test("a repeated request_id queues once and answers the same op_id", async () => {
    const id = rid("repeat");
    const body = { request_id: id, action: "ban", text: "unlock your potential" };
    const first = await postRule(tokenOwnerA, body);
    const second = await postRule(tokenOwnerA, body);
    assert.equal(first.code, 202);
    assert.equal(second.code, 202);
    assert.deepEqual(second.body, first.body);
    const rows = (await outboxRows(orgA)).filter((x) => x.edit?.phrase === "unlock your potential");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].op_id, first.body.op_id);
  });

  test("refused with 400 and nothing queued: bad action, empty text, edit with no n or an n Part 0 does not have", async () => {
    const before = (await outboxRows(orgA)).length;
    const cases = [
      [{ action: "delete", text: "x" }, "action"],
      [{ action: "add", text: "  " }, "text"],
      [{ action: "edit", text: "x" }, "n"],
      [{ action: "edit", n: 999, text: "x" }, "n"]
    ];
    for (const [body, field] of cases) {
      const r = await postRule(tokenOwnerA, { request_id: rid("bad"), ...body });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, field);
    }
    assert.equal((await outboxRows(orgA)).length, before);
  });

  test("an edit of a rule that is added but still waiting in the outbox is allowed", async () => {
    // Company B has no changes of its own yet. Part 0 on disk is rules 0-44, so
    // B's waiting add becomes rule 45.
    const n = Math.max(...readPart0(RULES_ON_DISK).map((r) => r.n)) + 1;
    const early = await postRule(tokenOwnerB, { request_id: rid("edit-b0"), action: "edit", n, text: "Too early." });
    assert.equal(early.code, 400, "no rule n before the add");
    const add = await postRule(tokenOwnerB, { request_id: rid("add-b"), action: "add", text: "A rule only company B added." });
    assert.equal(add.code, 202);
    const edit = await postRule(tokenOwnerB, { request_id: rid("edit-b"), action: "edit", n, text: "Changed before it landed." });
    assert.equal(edit.code, 202, JSON.stringify(edit.body));
    const refused = await postRule(tokenOwnerB, { request_id: rid("edit-b2"), action: "edit", n: n + 1, text: "No such rule yet." });
    assert.equal(refused.code, 400);
    assert.equal(refused.body.field, "n");
  });

  // ── scripts/fix ─────────────────────────────────────────────────────────────

  test("fix: 202 and a fix_script job with {script_id, version, note}; no rule queued without make_rule", async () => {
    const script = await mkScript(orgA, partnerA);
    const outboxBefore = (await outboxRows(orgA)).length;
    const note = "Make the hook about the business file,\nnot the personal one.";
    const before = wakes;
    const r = await postFix(tokenOwnerA, { request_id: rid("fix"), id: script.id, version: 1, note, make_rule: false });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/scripts/fix", r.body);
    assert.equal(r.body.queued, true);
    const job = (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [r.body.job_id])).rows[0];
    assert.equal(job.org_id, orgA);
    assert.equal(job.kind, "fix_script");
    assert.equal(job.status, "queued");
    assert.deepEqual(job.payload, { script_id: script.id, version: 1, note });
    assert.equal((await outboxRows(orgA)).length, outboxBefore, "no Part 0 edit without make_rule");
    assert.equal(wakes, before + 1);
    const s = (await db.query(`SELECT version, archived_at FROM ad_scripts WHERE id = $1`, [script.id])).rows[0];
    assert.deepEqual(s, { version: 1, archived_at: null }, "the route only queues; the writer saves the new version");
  });

  test("fix with make_rule also queues the note as a Part 0 rule, in the same transaction", async () => {
    const script = await mkScript(orgA, partnerA);
    const r = await postFix(tokenOwnerA, { request_id: rid("fix-rule"), id: script.id, version: 1, note: "Never open on a question.", make_rule: true });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    const job = (await db.query(`SELECT payload FROM marketing_jobs WHERE id = $1`, [r.body.job_id])).rows[0];
    assert.equal(job.payload.note, "Never open on a question.");
    const rule = (await outboxRows(orgA)).filter((x) => x.edit?.op === "part0_add_rule" && x.edit.text === "Never open on a question.");
    assert.equal(rule.length, 1);
    assert.equal(rule[0].path, RULES_PATH);
    assert.equal(rule[0].mode, "edit");
  });

  test("fix: an old version answers 409 stale with the live {version, body, parts}", async () => {
    const v1 = await mkScript(orgA, partnerA, "Version one words.");
    await db.query(`UPDATE ad_scripts SET archived_at = now(), status = 'superseded' WHERE id = $1`, [v1.id]);
    const v2 = (await db.query(
      `INSERT INTO ad_scripts (org_id, partner_id, parent_script_id, root_script_id, version, body, parts, source)
       VALUES ($1, $2, $3, $4, 2, 'Version two words.', '[{"kind":"hook","text":"two"}]'::jsonb, 'chris')
       RETURNING *`,
      [orgA, partnerA, v1.id, v1.root_script_id]
    )).rows[0];
    const jobsBefore = (await jobRows(orgA)).length;

    const old = await postFix(tokenOwnerA, { request_id: rid("stale"), id: v1.id, version: 1, note: "fix it", make_rule: false });
    assert.equal(old.code, 409, JSON.stringify(old.body));
    assert.equal(old.body.error, "stale");
    assert.deepEqual(old.body.current, { version: 2, body: "Version two words.", parts: [{ kind: "hook", text: "two" }] });

    const wrongVersion = await postFix(tokenOwnerA, { request_id: rid("stale2"), id: v2.id, version: 1, note: "fix it", make_rule: false });
    assert.equal(wrongVersion.code, 409);
    assert.equal(wrongVersion.body.current.version, 2);
    assert.equal((await jobRows(orgA)).length, jobsBefore, "a stale fix queues nothing");

    const ok = await postFix(tokenOwnerA, { request_id: rid("live"), id: v2.id, version: 2, note: "fix it", make_rule: false });
    assert.equal(ok.code, 202);
  });

  test("fix: another company's script is 404; bad fields are 400 with the field named; a repeat queues once", async () => {
    const foreign = await mkScript(orgB, partnerB);
    const nf = await postFix(tokenOwnerA, { request_id: rid("404"), id: foreign.id, version: 1, note: "x", make_rule: false });
    assert.equal(nf.code, 404);
    assert.equal(nf.body.error, "not_found");

    const script = await mkScript(orgA, partnerA);
    const cases = [
      [{ note: "", make_rule: false }, "note"],
      [{ note: "x" }, "make_rule"],
      [{ note: "x", make_rule: "yes" }, "make_rule"],
      [{ note: "x".repeat(1001), make_rule: true }, "note"]
    ];
    for (const [extra, field] of cases) {
      const r = await postFix(tokenOwnerA, { request_id: rid("bad"), id: script.id, version: 1, ...extra });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.field, field);
    }

    const id = rid("repeat-fix");
    const body = { request_id: id, id: script.id, version: 1, note: "Once only.", make_rule: false };
    const first = await postFix(tokenOwnerA, body);
    const second = await postFix(tokenOwnerA, body);
    assert.equal(first.code, 202);
    assert.deepEqual(second.body, first.body);
    assert.equal((await jobRows(orgA)).filter((j) => j.payload.note === "Once only.").length, 1);
  });
});
