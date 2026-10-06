// The GitHub client and the outbox drain, against an in-memory GitHub (fake
// fetch) and an in-memory outbox store. No network, no database.
// The SQL side of the store is proven in src/http/repo-outbox.pg.test.mjs.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2 tests: the ETag
// path, re-applying an edit after the head moved, the trailer dedupe, the
// commit format, and the dry-run fence.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  getContents, getRef, createTree, createCommit, repoToken, repoConfig, outboxTrailerIds, commitMessage,
  APP_AUTHOR, DEFAULT_REPO, DEFAULT_BRANCH, TRANSMITS
} from "./github-repo.mjs";
import { drainOutbox, LEASE_MINUTES } from "../../repo/outbox.mjs";
import { PART0_HEADING } from "../../repo/edit-ops.mjs";

const ENV = Object.freeze({ GITHUB_REPO_TOKEN: "test-token-not-real", ADAPTERS_DRY_RUN: "0" });
const REPO_PREFIX = `/repos/${DEFAULT_REPO}`;

const RULES = [
  "# RULES.md",
  "",
  PART0_HEADING,
  "",
  "0. Chris's word beats every rule below.",
  "44. Long ads keep every point Chris gave.",
  "",
  "# PART 1 — THE HARD NO'S",
  ""
].join("\n");

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/* A small GitHub: trees are path -> text maps, commits point at trees, one branch. */
function fakeGitHub(files = {}) {
  const trees = new Map();
  const commits = new Map();
  const calls = [];
  const hooks = { patch: [] };
  let n = 0;

  const putTree = (map) => {
    const sha = sha1(`tree:${JSON.stringify([...map].sort())}`);
    trees.set(sha, new Map(map));
    return sha;
  };
  const putCommit = ({ message, tree, parents, author = null }) => {
    const sha = sha1(`commit:${n++}:${message}:${tree}:${parents.join(",")}`);
    commits.set(sha, { sha, message, tree, parents, author });
    return sha;
  };

  const gh = {
    head: null, trees, commits, calls, hooks,
    filesAt: (sha) => trees.get(commits.get(sha).tree),
    file: (p) => gh.filesAt(gh.head).get(p),
    /** Someone else commits first. */
    pushForeign(message, changes = {}) {
      const map = new Map(gh.filesAt(gh.head));
      for (const [p, c] of Object.entries(changes)) map.set(p, c);
      gh.head = putCommit({ message, tree: putTree(map), parents: [gh.head] });
      return gh.head;
    },
    count: (method, route) => calls.filter((c) => c.method === method && c.route.startsWith(route)).length,
    async fetch(url, init = {}) {
      const u = new URL(url);
      const method = init.method || "GET";
      const route = u.pathname.slice(REPO_PREFIX.length);
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, route, search: u.search, headers: init.headers || {}, body });

      if (method === "GET" && route === `/git/ref/heads/${DEFAULT_BRANCH}`) {
        return json(200, { ref: `refs/heads/${DEFAULT_BRANCH}`, object: { sha: gh.head, type: "commit" } });
      }
      if (method === "GET" && route === "/commits") {
        const out = [];
        let at = u.searchParams.get("sha") || gh.head;
        const per = Number(u.searchParams.get("per_page") || 30);
        while (at && out.length < per) {
          const c = commits.get(at);
          out.push({ sha: c.sha, commit: { message: c.message, tree: { sha: c.tree } } });
          at = c.parents[0];
        }
        return json(200, out);
      }
      if (method === "GET" && route.startsWith("/contents/")) {
        const p = route.slice("/contents/".length).split("/").map(decodeURIComponent).join("/");
        const ref = u.searchParams.get("ref") || gh.head;
        const content = gh.filesAt(ref).get(p);
        if (content == null) return json(404, { message: "Not Found" });
        const etag = `W/"${sha1(content)}"`;
        if (init.headers?.["If-None-Match"] === etag) return new Response(null, { status: 304, headers: { etag } });
        return json(200, {
          type: "file", encoding: "base64", sha: sha1(`blob:${content}`),
          content: Buffer.from(content, "utf8").toString("base64").replace(/(.{60})/g, "$1\n")
        }, { etag });
      }
      if (method === "POST" && route === "/git/trees") {
        const base = trees.get(body.base_tree);
        if (!base) return json(422, { message: "Invalid tree info" });
        const map = new Map(base);
        for (const e of body.tree) map.set(e.path, e.content);
        return json(201, { sha: putTree(map) });
      }
      if (method === "POST" && route === "/git/commits") {
        return json(201, { sha: putCommit({ message: body.message, tree: body.tree, parents: body.parents, author: body.author }) });
      }
      if (method === "PATCH" && route === `/git/refs/heads/${DEFAULT_BRANCH}`) {
        const hook = hooks.patch.shift();
        if (hook) {
          const r = hook(gh, body);
          if (r) return r;
        }
        const c = commits.get(body.sha);
        if (!body.force && c.parents[0] !== gh.head) return json(422, { message: "Update is not a fast forward" });
        gh.head = body.sha;
        return json(200, { ref: `refs/heads/${DEFAULT_BRANCH}`, object: { sha: body.sha } });
      }
      return json(404, { message: `fake GitHub has no ${method} ${route}` });
    }
  };
  gh.head = putCommit({ message: "init", tree: putTree(new Map(Object.entries(files))), parents: [] });
  gh.fetchImpl = (url, init) => gh.fetch(url, init);
  return gh;
}

/* The outbox store with the same rules as the SQL one (src/repo/outbox.mjs sqlStore). */
function fakeStore(rows) {
  const data = rows.map((r) => ({
    org_id: "00000000-0000-4000-8000-000000000001", op_id: `op-${r.id}`, content: null, edit: null,
    claimed_at: null, claim_id: null, attempts: 0, committed_sha: null, committed_at: null, error: null, ...r
  }));
  const mine = (claimId, id) => data.find((r) => r.id === id && r.claim_id === claimId && r.committed_sha == null);
  return {
    data,
    claims: 0,
    row: (id) => data.find((r) => r.id === id),
    async claim(claimId) {
      this.claims++;
      const now = Date.now();
      const live = data.some((r) => r.committed_sha == null && r.claimed_at != null && r.claimed_at > now - LEASE_MINUTES * 60_000);
      if (live) return { skipped: "busy" };
      const out = [];
      for (const r of data) {
        if (r.committed_sha != null) continue;
        Object.assign(r, { claimed_at: now, claim_id: claimId, attempts: r.attempts + 1 });
        out.push({ ...r });
      }
      return { rows: out };
    },
    async markCommitted(claimId, ids, sha) {
      for (const id of ids) { const r = mine(claimId, id); if (r) Object.assign(r, { committed_sha: sha, committed_at: Date.now(), error: null }); }
    },
    async recordErrors(claimId, items) {
      for (const { id, error } of items) { const r = mine(claimId, id); if (r) r.error = error; }
    },
    async release(claimId, items, { countAttempt = true } = {}) {
      for (const { id, error } of items) {
        const r = mine(claimId, id);
        if (!r) continue;
        Object.assign(r, {
          claimed_at: null, claim_id: null, error: error ?? r.error,
          attempts: countAttempt ? r.attempts : Math.max(r.attempts - 1, 0)
        });
      }
    }
  };
}

const drain = (gh, store, env = ENV, extra = {}) =>
  drainOutbox(null, env, { store, fetchImpl: gh.fetchImpl, claimId: "drain-test", ...extra });

const addRule = (id, text) => ({ id, path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_add_rule", text } });
const replace = (id, p, content) => ({ id, path: p, mode: "replace", content });

describe("github-repo client", () => {
  test("declares it transmits, uses GITHUB_REPO_TOKEN only, and treats a mask as no token", () => {
    assert.equal(TRANSMITS, true);
    assert.equal(repoToken({ GITHUB_REPO_TOKEN: "abc" }), "abc");
    assert.equal(repoToken({ GITHUB_REPO_TOKEN: "****************abcd" }), null);
    assert.equal(repoToken({ GITHUB_REPO_TOKEN: "  " }), null);
    assert.equal(repoToken({ GITHUB_TOKEN: "ghp_push_token_not_this_one" }), null);
    assert.deepEqual(repoConfig({}), { token: null, repo: DEFAULT_REPO, branch: DEFAULT_BRANCH });
    assert.equal(repoConfig({ GITHUB_REPO: "../evil" }).repo, DEFAULT_REPO);
    assert.equal(repoConfig({ GITHUB_BRANCH: "a/../b" }).branch, DEFAULT_BRANCH);
  });

  test("ETag path: a 200 hands back the tag, the same tag answers 304 with no body", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const first = await getContents("marketing/ads/RULES.md", { env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(first.ok, true);
    assert.equal(first.content, RULES);
    assert.equal(first.notModified, false);
    assert.ok(first.etag);
    const again = await getContents("marketing/ads/RULES.md", { etag: first.etag, env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(again.ok, true);
    assert.equal(again.notModified, true);
    assert.equal(again.content, null);
    assert.equal(again.etag, first.etag);
    const sent = gh.calls[gh.calls.length - 1];
    assert.equal(sent.headers["If-None-Match"], first.etag);
    assert.equal(sent.headers.Authorization, "Bearer test-token-not-real");
  });

  test("getContents pins a ref and reports a missing file as missing, not an error", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const ref = await getRef({ env: ENV, fetchImpl: gh.fetchImpl });
    const got = await getContents("marketing/ads/angles.json", { ref: ref.sha, env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(got.ok, true);
    assert.equal(got.missing, true);
    assert.equal(got.content, null);
    assert.equal(gh.calls[gh.calls.length - 1].search, `?ref=${ref.sha}`);
  });

  test("the fence holds every call when ADAPTERS_DRY_RUN is not an off value", async () => {
    const gh = fakeGitHub({});
    const res = await getRef({ env: { GITHUB_REPO_TOKEN: "t" }, fetchImpl: gh.fetchImpl });
    assert.equal(res.blocked, true);
    assert.equal(gh.calls.length, 0);
  });

  test("createTree refuses a path off the allow-list without sending anything", async () => {
    const gh = fakeGitHub({});
    const res = await createTree({ baseTree: "x", files: [{ path: "netlify.toml", content: "x" }], env: ENV, fetchImpl: gh.fetchImpl });
    assert.equal(res.ok, false);
    assert.equal(res.transmitted, false);
    assert.match(res.error, /allow-list/);
    assert.equal(gh.calls.length, 0);
  });

  test("createCommit refuses a message that does not start app: and end [skip ci]", async () => {
    const gh = fakeGitHub({});
    for (const message of ["save rules", "app: save rules", "save rules [skip ci]"]) {
      const res = await createCommit({ message, tree: "t", parents: [gh.head], env: ENV, fetchImpl: gh.fetchImpl });
      assert.equal(res.ok, false);
      assert.equal(res.transmitted, false);
    }
    assert.equal(gh.calls.length, 0);
  });

  test("commit messages: app: first, [skip ci] last, ids in the Outbox trailer", () => {
    const one = commitMessage([3, 1], ["marketing/ads/RULES.md"]);
    assert.ok(one.startsWith("app: save marketing/ads/RULES.md"));
    assert.ok(one.endsWith("\n[skip ci]"));
    assert.deepEqual(outboxTrailerIds(one), [1, 3]);
    const many = commitMessage([7, 8], ["marketing/ads/RULES.md", "marketing/ads/VOICE.md"]);
    assert.ok(many.startsWith("app: save 2 files"));
    assert.ok(many.includes("- marketing/ads/VOICE.md"));
    assert.deepEqual(outboxTrailerIds("no trailer here"), []);
  });
});

describe("drainOutbox", () => {
  test("one commit: author Fundhub app, app: … [skip ci], Outbox trailer, force:false", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const store = fakeStore([
      addRule(1, "Never say dude."),
      replace(2, "marketing/ads/scripts/machine/2026-10-12/01-denial.md", "body\n")
    ]);
    const out = await drain(gh, store);
    assert.ok(out.committed_sha, JSON.stringify(out));
    assert.deepEqual(out.ids, [1, 2]);
    assert.equal(gh.head, out.committed_sha);

    const c = gh.commits.get(out.committed_sha);
    assert.deepEqual(c.author, { ...APP_AUTHOR });
    assert.equal(c.author.name, "Fundhub app");
    assert.ok(c.message.startsWith("app:"), c.message);
    assert.ok(c.message.endsWith("[skip ci]"), c.message);
    assert.match(c.message, /^Outbox: 1,2$/m);

    const patch = gh.calls.find((x) => x.method === "PATCH");
    assert.equal(patch.body.force, false);
    assert.equal(gh.file("marketing/ads/RULES.md").includes("45. Never say dude."), true);
    assert.equal(gh.file("marketing/ads/scripts/machine/2026-10-12/01-denial.md"), "body\n");
    for (const id of [1, 2]) {
      assert.equal(store.row(id).committed_sha, out.committed_sha);
      assert.equal(store.row(id).error, null);
    }
  });

  test("422 not a fast forward: re-reads the ref and re-applies the edit onto the moved head", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    gh.hooks.patch.push((g) => {
      g.pushForeign("chris: a rule by hand", {
        "marketing/ads/RULES.md": RULES.replace("44. Long ads keep every point Chris gave.",
          "44. Long ads keep every point Chris gave.\n45. A rule Chris typed on the laptop.")
      });
      return json(422, { message: "Update is not a fast forward" });
    });
    const store = fakeStore([addRule(1, "Never say bro.")]);
    const out = await drain(gh, store);
    assert.ok(out.committed_sha, JSON.stringify(out));
    const rules = gh.file("marketing/ads/RULES.md");
    assert.ok(rules.includes("45. A rule Chris typed on the laptop.\n46. Never say bro."), rules);
    assert.equal(gh.count("GET", "/git/ref/"), 2);
    assert.equal(gh.count("PATCH", "/git/refs/"), 2);
    const c = gh.commits.get(out.committed_sha);
    assert.equal(gh.commits.get(c.parents[0]).message, "chris: a rule by hand");
    assert.equal(store.row(1).committed_sha, out.committed_sha);
  });

  test("a branch that keeps moving: 3 tries, then the claim is cleared for the next pass", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    for (let i = 0; i < 5; i++) {
      gh.hooks.patch.push((g) => { g.pushForeign(`someone ${i}`, {}); return json(422, { message: "Update is not a fast forward" }); });
    }
    const store = fakeStore([addRule(1, "x")]);
    const out = await drain(gh, store);
    assert.ok(out.error, JSON.stringify(out));
    assert.equal(out.retry, true);
    assert.match(out.error, /kept moving; tried 3 times/);
    assert.equal(gh.count("PATCH", "/git/refs/"), 3);
    const r = store.row(1);
    assert.equal(r.claimed_at, null);
    assert.equal(r.committed_sha, null);
    assert.equal(r.attempts, 1);
    assert.match(r.error, /kept moving/);
  });

  test("any other 422 stops at once, records the error and leaves the claim to expire", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    gh.hooks.patch.push(() => json(422, { message: "Changes must be made through a pull request." }));
    const store = fakeStore([addRule(1, "x"), addRule(2, "y")]);
    const before = gh.head;
    const out = await drain(gh, store);
    assert.match(out.error, /422 Changes must be made through a pull request/);
    assert.equal(out.retry, undefined);
    assert.equal(gh.count("PATCH", "/git/refs/"), 1);
    assert.equal(gh.head, before);
    for (const id of [1, 2]) {
      const r = store.row(id);
      assert.match(r.error, /pull request/);
      assert.equal(r.claim_id, "drain-test", "claim kept so it expires after the lease");
      assert.equal(r.committed_sha, null);
    }
    // The next pass inside the lease is busy: no hammering.
    assert.deepEqual(await drain(gh, store), { skipped: "busy" });
    assert.equal(gh.count("PATCH", "/git/refs/"), 1);
  });

  test("a commit whose Outbox trailer is in the last 20 commits is marked done, never committed twice", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const landed = gh.pushForeign("app: save marketing/ads/RULES.md\n\nOutbox: 1,2\n[skip ci]", {
      "marketing/ads/RULES.md": `${RULES}`.replace("44. Long", "45. x\n44. Long")
    });
    for (let i = 0; i < 5; i++) gh.pushForeign(`later ${i}`, {});
    const store = fakeStore([addRule(1, "x"), addRule(2, "y")]);
    const out = await drain(gh, store);
    assert.equal(out.committed_sha, landed);
    assert.deepEqual(out.deduped, [1, 2]);
    assert.equal(gh.count("POST", "/git/commits"), 0);
    assert.equal(gh.count("PATCH", "/git/refs/"), 0);
    assert.equal(store.row(1).committed_sha, landed);
    assert.equal(store.row(2).committed_sha, landed);
  });

  test("only the ids not already in a trailer go into the new commit", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const landed = gh.pushForeign("app: save\n\nOutbox: 1\n[skip ci]", {});
    const store = fakeStore([addRule(1, "x"), addRule(3, "z")]);
    const out = await drain(gh, store);
    assert.deepEqual(out.deduped, [1]);
    assert.deepEqual(out.ids, [3]);
    assert.match(gh.commits.get(out.committed_sha).message, /^Outbox: 3$/m);
    assert.equal(store.row(1).committed_sha, landed);
  });

  test("a trailer older than the last 20 commits is not trusted", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    gh.pushForeign("app: save\n\nOutbox: 1\n[skip ci]", {});
    for (let i = 0; i < 20; i++) gh.pushForeign(`later ${i}`, {});
    const store = fakeStore([addRule(1, "x")]);
    const out = await drain(gh, store);
    assert.deepEqual(out.deduped, []);
    assert.deepEqual(out.ids, [1]);
  });

  test("blocked:true from the fence returns skipped dry_run and counts no attempt", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const store = fakeStore([addRule(1, "x")]);
    for (const env of [{ GITHUB_REPO_TOKEN: "t" }, { GITHUB_REPO_TOKEN: "t", ADAPTERS_DRY_RUN: "1" }]) {
      const out = await drain(gh, store, env);
      assert.equal(out.skipped, "dry_run", JSON.stringify(out));
      const r = store.row(1);
      assert.equal(r.attempts, 0);
      assert.equal(r.claimed_at, null);
      assert.equal(r.claim_id, null);
      assert.equal(r.committed_sha, null);
    }
    assert.equal(gh.calls.length, 0);
  });

  test("no token (or a masked one): skipped no_token before anything is claimed", async () => {
    const gh = fakeGitHub({});
    const store = fakeStore([addRule(1, "x")]);
    for (const env of [{ ADAPTERS_DRY_RUN: "0" }, { ADAPTERS_DRY_RUN: "0", GITHUB_REPO_TOKEN: "****1234" }]) {
      assert.deepEqual(await drain(gh, store, env), { skipped: "no_token" });
    }
    assert.equal(store.claims, 0);
    assert.equal(store.row(1).claimed_at, null);
    assert.equal(gh.calls.length, 0);
  });

  test("an empty outbox is skipped empty; a held lease is skipped busy", async () => {
    const gh = fakeGitHub({});
    assert.deepEqual(await drain(gh, fakeStore([])), { skipped: "empty" });
    const store = fakeStore([{ ...addRule(1, "x"), claimed_at: Date.now() - 60_000, claim_id: "other" }]);
    assert.deepEqual(await drain(gh, store), { skipped: "busy" });
    assert.equal(gh.calls.length, 0);
  });

  test("an edit the file cannot take is set aside with its reason; the rest still commit", async () => {
    const gh = fakeGitHub({ "marketing/ads/RULES.md": RULES });
    const store = fakeStore([
      { id: 1, path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_edit_rule", number: 99, text: "x" } },
      addRule(2, "Kept.")
    ]);
    const out = await drain(gh, store);
    assert.ok(out.committed_sha, JSON.stringify(out));
    assert.deepEqual(out.ids, [2]);
    assert.equal(out.rejected[0].id, 1);
    const bad = store.row(1);
    assert.match(bad.error, /Part 0 has no rule 99/);
    assert.equal(bad.claimed_at, null);
    assert.equal(bad.committed_sha, null);
    assert.ok(gh.file("marketing/ads/RULES.md").includes("45. Kept."));
    assert.match(gh.commits.get(out.committed_sha).message, /^Outbox: 2$/m);
  });

  test("a registry edit that would not load is never committed", async () => {
    const gh = fakeGitHub({ "marketing/ads/registry.json": "{\"ads\": [], \"rules\": {}}\n" });
    const store = fakeStore([{ id: 1, path: "marketing/ads/registry.json", mode: "edit", edit: { op: "registry_add_ad", id: "91", title: "x", lane: "uwiq" } }]);
    const out = await drain(gh, store);
    assert.match(out.error, /none of the waiting saves fit/);
    assert.match(store.row(1).error, /no rule/);
    assert.equal(gh.count("POST", "/git/commits"), 0);
  });

  test("nothing changed (a phrase already banned): no empty commit, rows marked done at the head", async () => {
    const gh = fakeGitHub({ "marketing/ads/banned-live.json": "[\n  \"game changer\"\n]\n" });
    const store = fakeStore([{ id: 1, path: "marketing/ads/banned-live.json", mode: "edit", edit: { op: "ban_phrase", phrase: "Game Changer" } }]);
    const head = gh.head;
    const out = await drain(gh, store);
    assert.equal(out.committed_sha, head);
    assert.equal(out.unchanged, true);
    assert.equal(gh.count("POST", "/git/commits"), 0);
    assert.equal(store.row(1).committed_sha, head);
  });

  test("edits apply in id order on the same file, after a replace in the same batch", async () => {
    const gh = fakeGitHub({});
    const store = fakeStore([
      { id: 2, path: "marketing/ads/banned-live.json", mode: "edit", edit: { op: "ban_phrase", phrase: "second" } },
      replace(1, "marketing/ads/banned-live.json", "[\"first\"]\n"),
      { id: 3, path: "marketing/ads/banned-live.json", mode: "edit", edit: { op: "ban_phrase", phrase: "third" } }
    ]);
    const out = await drain(gh, store);
    assert.ok(out.committed_sha, JSON.stringify(out));
    assert.deepEqual(JSON.parse(gh.file("marketing/ads/banned-live.json")), ["first", "second", "third"]);
  });

  test("GitHub down (500): claim cleared with the reason so the next pass retries", async () => {
    const gh = fakeGitHub({});
    const store = fakeStore([addRule(1, "x")]);
    const out = await drain({ fetchImpl: async () => json(503, { message: "Service Unavailable" }) }, store);
    assert.equal(out.retry, true);
    assert.match(store.row(1).error, /503/);
    assert.equal(store.row(1).claimed_at, null);
    void gh;
  });

  test("a bad token (401): error recorded, claim kept to expire, token never in the error", async () => {
    const store = fakeStore([addRule(1, "x")]);
    const out = await drain({ fetchImpl: async () => json(401, { message: "Bad credentials" }) }, store);
    assert.match(out.error, /401 Bad credentials/);
    assert.equal(store.row(1).claim_id, "drain-test");
    assert.ok(!JSON.stringify(out).includes("test-token-not-real"));
    assert.ok(!store.row(1).error.includes("test-token-not-real"));
  });
});
