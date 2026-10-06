// The repo outbox against real Postgres (DATABASE_URL): migration 412, the
// enqueue in the caller's transaction, the lease-based claim, and the drain's
// SQL. Lives under src/http/ because npm test only globs src/** and scripts/**
// (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL the database tests
// skip; the grep guard at the top needs no database and always runs.
//
// No network: GitHub is a small in-memory fake behind fetchImpl.
//
// EVERYTHING THIS FILE WRITES has an op_id starting with TAG, and the purge
// removes exactly those rows.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import {
  enqueueRepoWrite, claimOutbox, drainOutbox, sqlStore, OUTBOX_LOCK_SQL, LEASE_MINUTES
} from "../repo/outbox.mjs";
import { RepoPathError } from "../repo/allow-list.mjs";
import { PART0_HEADING } from "../repo/edit-ops.mjs";
import { DEFAULT_REPO, DEFAULT_BRANCH } from "../messaging/providers/github-repo.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const TAG = "zz-repo-outbox-pg:";
const ENV = Object.freeze({ GITHUB_REPO_TOKEN: "test-token-not-real", ADAPTERS_DRY_RUN: "0" });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── the grep guard (no database) ────────────────────────────────────────────

/* A session-level advisory lock or a bare SET sticks to a shared backend on the
   Supabase transaction pooler (port 6543) and leaks to the next client. A bare
   SET once left the live pool read-only. Transaction-scoped forms are fine:
   pg_try_advisory_xact_lock, SET LOCAL, set_config(..., true). */
const SESSION_LOCK = /\bpg_(?:try_)?advisory_lock(?:_shared)?\s*\(|\bpg_advisory_unlock(?:_shared|_all)?\s*\(/;
const BARE_SET = /\.query\(\s*[`'"]\s*SET\s+(?!LOCAL\b)/i;
const SESSION_SET_CONFIG = /\bset_config\s*\([^)]*,\s*false\s*\)/i;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

const codeOnly = (src) => src.split("\n").filter((line) => {
  const t = line.trim();
  return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
}).join("\n");

test("no session-level advisory lock or bare SET anywhere in src/, api/ or netlify/", () => {
  const files = ["src", "api", "netlify"].flatMap((d) => walk(path.join(ROOT, d)));
  assert.ok(files.length > 300, `only scanned ${files.length} files — the walk is broken`);
  const offenders = [];
  for (const f of files) {
    const src = codeOnly(fs.readFileSync(f, "utf8"));
    for (const [what, re] of [["session advisory lock", SESSION_LOCK], ["bare SET", BARE_SET], ["session set_config", SESSION_SET_CONFIG]]) {
      if (re.test(src)) offenders.push(`${path.relative(ROOT, f)}: ${what}`);
    }
  }
  assert.deepEqual(offenders, [], `These would leak on the transaction pooler:\n${offenders.join("\n")}`);
});

test("the outbox locks with the transaction-scoped form only", () => {
  const src = codeOnly(fs.readFileSync(path.join(ROOT, "src", "repo", "outbox.mjs"), "utf8"));
  assert.match(src, /pg_try_advisory_xact_lock\(hashtextextended\('repo_outbox', 0\)\)/);
  assert.ok(!SESSION_LOCK.test(src));
  assert.match(OUTBOX_LOCK_SQL, /pg_try_advisory_xact_lock/);
});

// ── a small GitHub ──────────────────────────────────────────────────────────

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function fakeGitHub(files = {}, { patch } = {}) {
  const trees = new Map();
  const commits = new Map();
  let n = 0;
  const putTree = (map) => { const s = sha1(`t:${JSON.stringify([...map].sort())}`); trees.set(s, new Map(map)); return s; };
  const putCommit = (c) => { const s = sha1(`c:${n++}:${c.message}:${c.tree}`); commits.set(s, { sha: s, ...c }); return s; };
  const gh = { head: null, commits, patches: 0 };
  gh.file = (p) => trees.get(commits.get(gh.head).tree).get(p);
  gh.head = putCommit({ message: "init", tree: putTree(new Map(Object.entries(files))), parents: [] });
  const prefix = `/repos/${DEFAULT_REPO}`;
  gh.fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const route = u.pathname.slice(prefix.length);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "GET" && route === `/git/ref/heads/${DEFAULT_BRANCH}`) return json(200, { object: { sha: gh.head } });
    if (method === "GET" && route === "/commits") {
      const out = [];
      for (let at = u.searchParams.get("sha"); at && out.length < 20; at = commits.get(at).parents[0]) {
        const c = commits.get(at);
        out.push({ sha: c.sha, commit: { message: c.message, tree: { sha: c.tree } } });
      }
      return json(200, out);
    }
    if (method === "GET" && route.startsWith("/contents/")) {
      const p = decodeURIComponent(route.slice("/contents/".length));
      const c = trees.get(commits.get(u.searchParams.get("ref") || gh.head).tree).get(p);
      return c == null ? json(404, { message: "Not Found" })
        : json(200, { type: "file", encoding: "base64", sha: sha1(c), content: Buffer.from(c).toString("base64") });
    }
    if (method === "POST" && route === "/git/trees") {
      const map = new Map(trees.get(body.base_tree));
      for (const e of body.tree) map.set(e.path, e.content);
      return json(201, { sha: putTree(map) });
    }
    if (method === "POST" && route === "/git/commits") return json(201, { sha: putCommit(body) });
    if (method === "PATCH" && route === `/git/refs/heads/${DEFAULT_BRANCH}`) {
      gh.patches++;
      if (patch) return patch(body);
      if (commits.get(body.sha).parents[0] !== gh.head) return json(422, { message: "Update is not a fast forward" });
      gh.head = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: "no route" });
  };
  return gh;
}

const RULES = `# RULES.md\n\n${PART0_HEADING}\n\n0. Chris's word beats every rule below.\n44. Long ads keep every point.\n\n# PART 1 — X\n`;

// ── the database ────────────────────────────────────────────────────────────

describe("repo_outbox (migration 412) on real Postgres", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let seq = 0;
  const opId = (what) => `${TAG}${process.pid}:${++seq}:${what}`;

  async function purge() {
    await db.query(`DELETE FROM repo_outbox WHERE op_id LIKE $1`, [`${TAG}%`]);
  }
  /* Claims are global (one repo, one branch). A lease left by another test file
     would make this file's first claim busy, so any leftover lease is aged past
     the 10 minutes before each test. Scratch database only. */
  async function ageLeftoverLeases() {
    await db.query(
      `UPDATE repo_outbox SET claimed_at = now() - interval '1 day'
        WHERE committed_sha IS NULL AND claimed_at IS NOT NULL`
    );
  }
  async function enqueue(args) {
    return withTransaction(db, (tx) => enqueueRepoWrite(tx, { orgId: org, ...args }));
  }
  async function mine(ids) {
    const r = await db.query(
      `SELECT id::int AS id, claimed_at, claim_id, attempts, committed_sha, committed_at, error
         FROM repo_outbox WHERE id = ANY($1::bigint[]) ORDER BY id`, [ids]);
    return r.rows;
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
  });
  beforeEach(async () => {
    await purge();
    await ageLeftoverLeases();
  });
  after(async () => {
    await purge();
    await close();
  });

  test("412: the spec's columns, row security forced, one policy, the app role can write", async () => {
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'repo_outbox' ORDER BY ordinal_position`
    )).rows.map((r) => r.column_name);
    assert.deepEqual(cols, [
      "id", "org_id", "op_id", "path", "mode", "content", "edit", "created_at",
      "claimed_at", "claim_id", "attempts", "committed_sha", "committed_at", "error"
    ]);
    const rls = (await db.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.repo_outbox'::regclass`
    )).rows[0];
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    const pol = (await db.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'repo_outbox'`
    )).rows.map((r) => r.policyname);
    assert.deepEqual(pol, ["repo_outbox_app_all"]);
    const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('fundhub_app','anon','authenticated')`)).rows.map((r) => r.rolname);
    if (roles.includes("fundhub_app")) {
      const can = (await db.query(
        `SELECT has_table_privilege('fundhub_app', 'public.repo_outbox', 'INSERT') AS ins,
                has_table_privilege('fundhub_app', 'public.repo_outbox', 'UPDATE') AS upd`
      )).rows[0];
      assert.deepEqual(can, { ins: true, upd: true });
    }
    for (const r of roles.filter((x) => x !== "fundhub_app")) {
      const has = (await db.query(`SELECT has_table_privilege($1, 'public.repo_outbox', 'SELECT') AS s`, [r])).rows[0].s;
      assert.equal(has, false, `${r} must not read repo_outbox`);
    }
  });

  test("412: the database refuses a bad mode, a mixed body and a traversal path on its own", async () => {
    const bad = [
      ["marketing/ads/ideas/a.md", "append", "x", null],
      ["marketing/ads/ideas/a.md", "replace", "x", '{"op":"ban_phrase"}'],
      ["marketing/ads/RULES.md", "edit", null, '"not an object"'],
      ["marketing/ads/../../netlify.toml", "replace", "x", null],
      ["/etc/passwd", "replace", "x", null],
      ["marketing\\ads\\RULES.md", "replace", "x", null],
      ["marketing/ads/ideas/%2e%2e/x", "replace", "x", null],
      ["marketing//ads/RULES.md", "replace", "x", null]
    ];
    for (const [p, mode, content, edit] of bad) {
      await assert.rejects(
        db.query(`INSERT INTO repo_outbox (org_id, op_id, path, mode, content, edit) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [org, opId("raw"), p, mode, content, edit]),
        (err) => err.code === "23514", `${p} ${mode}`
      );
    }
  });

  test("an enqueue inside a rolled-back transaction leaves no row", async () => {
    const id = opId("rollback");
    await assert.rejects(withTransaction(db, async (tx) => {
      await enqueueRepoWrite(tx, { orgId: org, opId: id, path: "marketing/ads/ideas/rolled-back.md", mode: "replace", content: "x\n" });
      throw new Error("the database change failed, so the save rolls back");
    }), /rolls back/);
    const n = (await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE op_id = $1`, [id])).rows[0].n;
    assert.equal(n, 0);

    const kept = await enqueue({ opId: opId("commit"), path: "marketing/ads/ideas/kept.md", mode: "replace", content: "x\n" });
    assert.equal((await mine([kept.id])).length, 1);
  });

  test("a repeated op id queues once; a different save under it is refused; a bad path never lands", async () => {
    const id = opId("repeat");
    const edit = { op: "part0_add_rule", text: "Never say dude." };
    const a = await enqueue({ opId: id, path: "marketing/ads/RULES.md", mode: "edit", edit });
    const b = await enqueue({ opId: id, path: "marketing/ads/RULES.md", mode: "edit", edit: { text: "Never say dude.", op: "part0_add_rule" } });
    assert.equal(b.duplicate, true);
    assert.equal(b.id, a.id);
    await assert.rejects(enqueue({ opId: id, path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_add_rule", text: "other" } }),
      (e) => e.code === "op_id_reused");
    await assert.rejects(enqueue({ opId: opId("evil"), path: "netlify.toml", mode: "replace", content: "x" }), RepoPathError);
    const n = (await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE op_id LIKE $1`, [`${TAG}%`])).rows[0].n;
    assert.equal(n, 1);
  });

  test("two claims at once: one wins the work, the other is busy (lock held, then lease live)", async () => {
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await enqueue({ opId: opId(`c${i}`), path: `marketing/ads/ideas/c${i}.md`, mode: "replace", content: `${i}\n` }));
    const ids = rows.map((r) => r.id);

    // A drain mid-claim holds the transaction lock: a second claim is busy.
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      assert.equal((await client.query(OUTBOX_LOCK_SQL)).rows[0].got, true);
      assert.deepEqual(await claimOutbox(db, { claimId: "blocked-by-lock" }), { skipped: "busy" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // The lock ended with that transaction: no session lock is left behind.
    const held = (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n;
    assert.equal(held, 0);

    const [a, b] = await Promise.all([claimOutbox(db, { claimId: "claim-a" }), claimOutbox(db, { claimId: "claim-b" })]);
    const won = [a, b].filter((x) => Array.isArray(x.rows));
    const busy = [a, b].filter((x) => x.skipped === "busy");
    assert.equal(won.length, 1, JSON.stringify([a.skipped, b.skipped]));
    assert.equal(busy.length, 1);
    const claimed = won[0].rows.map((r) => r.id);
    for (const id of ids) assert.ok(claimed.includes(id), `row ${id} claimed`);
    const winner = won[0] === a ? "claim-a" : "claim-b";
    for (const r of await mine(ids)) {
      assert.equal(r.claim_id, winner);
      assert.equal(r.attempts, 1);
    }
    // While that lease is live, every other claim is busy.
    assert.deepEqual(await claimOutbox(db, { claimId: "claim-c" }), { skipped: "busy" });
  });

  test("two drains at once: disjoint work, one commit, the second returns busy", async () => {
    const rows = [];
    for (let i = 0; i < 2; i++) rows.push(await enqueue({ opId: opId(`d${i}`), path: `marketing/ads/ideas/d${i}.md`, mode: "replace", content: `${i}\n` }));
    const ids = rows.map((r) => r.id);
    const gh = fakeGitHub({});
    const [x, y] = await Promise.all([
      drainOutbox(db, ENV, { fetchImpl: gh.fetchImpl, claimId: "drain-x" }),
      drainOutbox(db, ENV, { fetchImpl: gh.fetchImpl, claimId: "drain-y" })
    ]);
    const done = [x, y].filter((o) => o.committed_sha);
    assert.equal(done.length, 1, JSON.stringify([x, y]));
    assert.deepEqual([x, y].filter((o) => o.skipped === "busy").length, 1);
    assert.equal(gh.patches, 1);
    for (const r of await mine(ids)) {
      assert.equal(r.committed_sha, done[0].committed_sha);
      assert.ok(r.committed_at);
      assert.equal(r.error, null);
    }
    assert.equal(gh.file("marketing/ads/ideas/d1.md"), "1\n");
  });

  test("a lease older than 10 minutes is taken over; a younger one is not", async () => {
    const r = await enqueue({ opId: opId("lease"), path: "marketing/ads/ideas/lease.md", mode: "replace", content: "x\n" });
    await db.query(
      `UPDATE repo_outbox SET claimed_at = now() - make_interval(mins => $2), claim_id = 'still-running', attempts = 1 WHERE id = $1`,
      [r.id, LEASE_MINUTES - 1]);
    assert.deepEqual(await claimOutbox(db, { claimId: "too-early" }), { skipped: "busy" });

    await db.query(
      `UPDATE repo_outbox SET claimed_at = now() - make_interval(mins => $2), claim_id = 'crashed' WHERE id = $1`,
      [r.id, LEASE_MINUTES + 1]);
    const out = await claimOutbox(db, { claimId: "takeover" });
    assert.ok(out.rows.some((x) => x.id === r.id));
    const [row] = await mine([r.id]);
    assert.equal(row.claim_id, "takeover");
    assert.equal(row.attempts, 2);

    // The crashed drain's late writes change nothing: they are fenced by claim_id.
    await sqlStore(db).markCommitted("crashed", [r.id], "a".repeat(40));
    assert.equal((await mine([r.id]))[0].committed_sha, null);
  });

  test("no GITHUB_REPO_TOKEN (or a masked one): skipped no_token and the rows keep waiting", async () => {
    const r = await enqueue({ opId: opId("notoken"), path: "marketing/ads/ideas/notoken.md", mode: "replace", content: "x\n" });
    for (const env of [{ ADAPTERS_DRY_RUN: "0" }, { ADAPTERS_DRY_RUN: "0", GITHUB_REPO_TOKEN: "****************abcd" }]) {
      assert.deepEqual(await drainOutbox(db, env, { fetchImpl: async () => { throw new Error("must not be called"); } }), { skipped: "no_token" });
    }
    const [row] = await mine([r.id]);
    assert.deepEqual({ claimed_at: row.claimed_at, claim_id: row.claim_id, attempts: row.attempts, committed_sha: row.committed_sha },
      { claimed_at: null, claim_id: null, attempts: 0, committed_sha: null });
  });

  test("held by the dry-run fence: the claim is cleared and the attempt is not counted", async () => {
    const r = await enqueue({ opId: opId("dry"), path: "marketing/ads/ideas/dry.md", mode: "replace", content: "x\n" });
    const out = await drainOutbox(db, { GITHUB_REPO_TOKEN: "test-token-not-real" }, {
      fetchImpl: async () => { throw new Error("must not be called"); }, claimId: "dry-run"
    });
    assert.equal(out.skipped, "dry_run");
    const [row] = await mine([r.id]);
    assert.equal(row.claimed_at, null);
    assert.equal(row.claim_id, null);
    assert.equal(row.attempts, 0);
  });

  test("an edit the file cannot take: its reason is kept and its claim cleared; the good row commits", async () => {
    const bad = await enqueue({ opId: opId("bad"), path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_edit_rule", number: 99, text: "x" } });
    const good = await enqueue({ opId: opId("good"), path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_add_rule", text: "Kept." } });
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const out = await drainOutbox(db, ENV, { fetchImpl: gh.fetchImpl, claimId: "mixed" });
    assert.ok(out.committed_sha, JSON.stringify(out));
    const [b, g] = await mine([bad.id, good.id]);
    assert.match(b.error, /Part 0 has no rule 99/);
    assert.equal(b.claimed_at, null);
    assert.equal(b.committed_sha, null);
    assert.equal(g.committed_sha, out.committed_sha);
    assert.ok(gh.file("marketing/ads/RULES.md").includes("45. Kept."));
  });

  test("a refusal such as branch protection: the error is recorded and the claim stays", async () => {
    const r = await enqueue({ opId: opId("protected"), path: "marketing/ads/ideas/protected.md", mode: "replace", content: "x\n" });
    const gh = fakeGitHub({}, { patch: () => json(422, { message: "Changes must be made through a pull request." }) });
    const out = await drainOutbox(db, ENV, { fetchImpl: gh.fetchImpl, claimId: "protected" });
    assert.match(out.error, /pull request/);
    const [row] = await mine([r.id]);
    assert.match(row.error, /pull request/);
    assert.equal(row.claim_id, "protected");
    assert.equal(row.committed_sha, null);
    assert.ok(!row.error.includes("test-token-not-real"));
  });
});
