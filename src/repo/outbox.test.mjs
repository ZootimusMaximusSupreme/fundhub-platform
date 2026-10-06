// The outbox without a database: what enqueue refuses, what the claim asks the
// database (and in what order), how GitHub answers are classed, and the wake
// that follows a save. The real SQL runs in src/http/repo-outbox.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  enqueueRepoWrite, claimOutbox, classify, OutboxError, OUTBOX_LOCK_SQL, LEASE_MINUTES, MAX_TRIES
} from "./outbox.mjs";
import { RepoPathError } from "./allow-list.mjs";
import { EditOpError } from "./edit-ops.mjs";
import { wakeWorker, WORKER_PATH } from "../marketing/wake.mjs";

const ORG = "00000000-0000-4000-8000-0000000000aa";

/* A transaction that records SQL and answers the insert. */
function fakeTx({ conflict = null } = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      if (/^\s*INSERT INTO repo_outbox/.test(sql)) {
        return conflict ? { rows: [] } : { rows: [{ id: "41", op_id: params[1], path: params[2], mode: params[3] }] };
      }
      if (/^\s*SELECT id, op_id, path, mode, content, edit FROM repo_outbox/.test(sql)) {
        return { rows: conflict ? [conflict] : [] };
      }
      return { rows: [] };
    }
  };
}

describe("enqueueRepoWrite", () => {
  test("queues a replace row in the caller's transaction", async () => {
    const tx = fakeTx();
    const row = await enqueueRepoWrite(tx, {
      orgId: ORG, opId: "req-1:script", path: "marketing/ads/scripts/machine/b1/01-x.md", mode: "replace", content: "hi\n"
    });
    assert.deepEqual(row, { id: 41, op_id: "req-1:script", path: "marketing/ads/scripts/machine/b1/01-x.md", mode: "replace", duplicate: false });
    assert.equal(tx.seen.length, 1);
    assert.match(tx.seen[0].sql, /ON CONFLICT \(org_id, op_id\) DO NOTHING/);
    assert.deepEqual(tx.seen[0].params, [ORG, "req-1:script", "marketing/ads/scripts/machine/b1/01-x.md", "replace", "hi\n", null]);
  });

  test("queues an edit row with the op stored as JSON", async () => {
    const tx = fakeTx();
    await enqueueRepoWrite(tx, {
      orgId: ORG, opId: "req-2", path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_add_rule", text: "x" }
    });
    assert.deepEqual(JSON.parse(tx.seen[0].params[5]), { op: "part0_add_rule", text: "x" });
    assert.equal(tx.seen[0].params[4], null);
  });

  test("refuses a path outside the allow-list before touching the database", async () => {
    const tx = fakeTx();
    // marketing/flywheel/ is on the list since unit X3 (design §6 slice 1 additions);
    // the folder next to it is not.
    for (const p of ["netlify.toml", "marketing/ads/../../CLAUDE.md", "/etc/passwd", "marketing/flywheel-old/avatar.md"]) {
      await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "x", path: p, mode: "replace", content: "x" }), RepoPathError);
    }
    assert.equal(tx.seen.length, 0);
  });

  test("refuses an unknown op, an op aimed at the wrong file, and a mixed body", async () => {
    const tx = fakeTx();
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "rm" } }), EditOpError);
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/VOICE.md", mode: "edit", edit: { op: "ban_phrase", phrase: "x" } }), EditOpError);
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/RULES.md", mode: "edit", content: "x", edit: { op: "part0_add_rule", text: "x" } }), OutboxError);
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/RULES.md", mode: "replace", content: "x", edit: {} }), OutboxError);
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/RULES.md", mode: "append", content: "x" }), OutboxError);
    assert.equal(tx.seen.length, 0);
  });

  test("refuses a replace of a JSON file that would not load (invalid JSON, a broken registry)", async () => {
    const tx = fakeTx();
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/angles.json", mode: "replace", content: "[{" }), /not valid JSON/);
    await assert.rejects(enqueueRepoWrite(tx, { orgId: ORG, opId: "a", path: "marketing/ads/registry.json", mode: "replace", content: "{\"ads\":[{\"id\":\"1\"}]}" }), /would not load/);
    assert.equal(tx.seen.length, 0);
  });

  test("refuses a missing org, a missing op id and no transaction", async () => {
    await assert.rejects(enqueueRepoWrite(fakeTx(), { orgId: "nope", opId: "a", path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_add_rule", text: "x" } }), /orgId/);
    await assert.rejects(enqueueRepoWrite(fakeTx(), { orgId: ORG, opId: " ", path: "marketing/ads/RULES.md", mode: "edit", edit: { op: "part0_add_rule", text: "x" } }), /opId/);
    await assert.rejects(enqueueRepoWrite(null, { orgId: ORG, opId: "a" }), /transaction/);
  });

  test("a repeated op id: the same save is a harmless repeat, a different save is refused", async () => {
    const edit = { op: "part0_add_rule", text: "x" };
    const same = fakeTx({ conflict: { id: "7", op_id: "a", path: "marketing/ads/RULES.md", mode: "edit", content: null, edit: { text: "x", op: "part0_add_rule" } } });
    const row = await enqueueRepoWrite(same, { orgId: ORG, opId: "a", path: "marketing/ads/RULES.md", mode: "edit", edit });
    assert.equal(row.duplicate, true);
    assert.equal(row.id, 7);
    const other = fakeTx({ conflict: { id: "7", op_id: "a", path: "marketing/ads/RULES.md", mode: "edit", content: null, edit: { op: "part0_add_rule", text: "y" } } });
    await assert.rejects(enqueueRepoWrite(other, { orgId: ORG, opId: "a", path: "marketing/ads/RULES.md", mode: "edit", edit }), (e) => e.code === "op_id_reused");
  });
});

describe("claimOutbox (SQL order on a stand-in database)", () => {
  function fakeDb({ got = true, live = false, rows = [] } = {}) {
    const seen = [];
    return {
      seen,
      async query(sql, params) {
        seen.push({ sql, params });
        if (sql === OUTBOX_LOCK_SQL) return { rows: [{ got }] };
        if (/^\s*SELECT 1 FROM repo_outbox/.test(sql)) return { rows: live ? [{ "?column?": 1 }] : [] };
        if (/^\s*UPDATE repo_outbox/.test(sql)) return { rows };
        return { rows: [] };
      }
    };
  }

  test("the transaction-scoped lock first, one global key; no session lock", async () => {
    assert.match(OUTBOX_LOCK_SQL, /pg_try_advisory_xact_lock\(hashtextextended\('repo_outbox', 0\)\)/);
    const db = fakeDb({ got: false });
    assert.deepEqual(await claimOutbox(db, { claimId: "c1" }), { skipped: "busy" });
    assert.equal(db.seen.length, 1);
  });

  test("a live lease anywhere makes the claim busy", async () => {
    const db = fakeDb({ live: true });
    assert.deepEqual(await claimOutbox(db, { claimId: "c1" }), { skipped: "busy" });
    assert.deepEqual(db.seen[1].params, [LEASE_MINUTES]);
    assert.equal(db.seen.length, 2);
  });

  test("otherwise every waiting row is stamped with this claim, in id order", async () => {
    const db = fakeDb({ rows: [{ id: "9", attempts: 1 }, { id: "3", attempts: 2 }] });
    const out = await claimOutbox(db, { claimId: "c1" });
    assert.deepEqual(out.rows.map((r) => r.id), [3, 9]);
    const upd = db.seen[2];
    assert.match(upd.sql, /SET claimed_at = now\(\), claim_id = \$1, attempts = attempts \+ 1/);
    assert.match(upd.sql, /WHERE committed_sha IS NULL/);
    assert.deepEqual(upd.params, ["c1"]);
  });

  test("a claim id is required", async () => {
    await assert.rejects(claimOutbox(fakeDb(), {}), /claimId/);
  });
});

describe("classify", () => {
  test("GitHub answers sort into ok / held / moved / retry / stop", () => {
    assert.equal(classify({ ok: true, status: 200 }), "ok");
    assert.equal(classify({ ok: false, blocked: true, status: 0 }), "held");
    assert.equal(classify({ ok: false, status: 422, body: { message: "Update is not a fast forward" } }), "moved");
    assert.equal(classify({ ok: false, status: 409, body: { message: "Conflict" } }), "moved");
    assert.equal(classify({ ok: false, status: 422, body: { message: "Changes must be made through a pull request." } }), "stop");
    assert.equal(classify({ ok: false, status: 0 }), "retry");
    assert.equal(classify({ ok: false, status: 502 }), "retry");
    assert.equal(classify({ ok: false, status: 429 }), "retry");
    assert.equal(classify({ ok: false, status: 403, headers: { "x-ratelimit-remaining": "0" } }), "retry");
    assert.equal(classify({ ok: false, status: 403, headers: {} }), "stop");
    assert.equal(classify({ ok: false, status: 401 }), "stop");
    assert.equal(MAX_TRIES, 3);
  });
});

describe("wakeWorker (after the save commits)", () => {
  test("no secret (unset or masked): a no-op that says so, nothing sent", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { status: 202 }; };
    for (const env of [{ URL: "https://fundhub.ai" }, { URL: "https://fundhub.ai", MARKETING_WORKER_SECRET: "****abcd" }]) {
      const out = await wakeWorker(env, { fetchImpl });
      assert.equal(out.started, false);
      assert.equal(out.skipped, "no_secret");
    }
    assert.equal(calls, 0);
  });

  test("POSTs to our own worker with the secret header and reads 202 as started", async () => {
    const seen = [];
    const out = await wakeWorker(
      { URL: "https://fundhub.ai/", MARKETING_WORKER_SECRET: "s3cret" },
      { fetchImpl: async (url, init) => { seen.push({ url, init }); return { status: 202 }; } }
    );
    assert.deepEqual({ ok: out.ok, started: out.started, status: out.status }, { ok: true, started: true, status: 202 });
    assert.equal(seen[0].url, `https://fundhub.ai${WORKER_PATH}`);
    assert.equal(seen[0].init.method, "POST");
    assert.equal(seen[0].init.headers["x-fundhub-worker"], "s3cret");
  });

  test("falls back to DEPLOY_URL, and never throws when the worker cannot be reached", async () => {
    const seen = [];
    await wakeWorker({ DEPLOY_URL: "https://deploy.example", MARKETING_WORKER_SECRET: "s" },
      { fetchImpl: async (url) => { seen.push(url); return { status: 202 }; } });
    assert.equal(seen[0], `https://deploy.example${WORKER_PATH}`);
    const down = await wakeWorker({ URL: "https://fundhub.ai", MARKETING_WORKER_SECRET: "s" },
      { fetchImpl: async () => { throw new Error("socket hang up"); } });
    assert.equal(down.started, false);
    assert.match(down.reason, /could not be reached/);
    const noUrl = await wakeWorker({ MARKETING_WORKER_SECRET: "s" }, { fetchImpl: async () => ({ status: 202 }) });
    assert.equal(noUrl.skipped, "no_url");
  });
});
