// The batch lifecycle's jobs without a database (src/marketing/batch-run.mjs,
// voice-export.mjs, nightly-script-check.mjs). Plan unit U35.
//
// Fake db objects record every statement; asStaff, GitHub and the outbox file writer are
// injected, so nothing here reaches a database or the network. The real SQL — one weekly
// batch when the clock fires twice, nothing before release_at, one buzz with the real
// counts, the repo files at release, expiry, the voice export and the nightly check —
// runs against Postgres in src/http/marketing-batch-run.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  countBatch, emptyPlanReason, pinRules, readAnglesAt, startBatch, runStartBatch, runFinishBatch,
  SCRIPTS_READY_KIND, MACHINE
} from "./batch-run.mjs";
import { pairForFile, exportVoicePairs, PAIRS_PER_EDIT } from "./voice-export.mjs";
import { gitBlobSha, compareScripts, checkScriptFiles, folderOf, bodyOfFile } from "./nightly-script-check.mjs";
import { serializeScript } from "./script-file.mjs";
import { JOB_KINDS } from "./job-kinds.mjs";
import { FINISH_POLL_MS } from "./schedule.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-12T15:00:00.000Z");

/** A fake db: `answer(sql, params)` returns {rows, rowCount}; every call is recorded. */
function fakeDb(answer = () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      const out = await answer(String(sql).replace(/\s+/g, " ").trim(), params);
      return { rows: [], rowCount: 0, ...(out || {}) };
    }
  };
}

/** Run fn in the given fake transaction (stands in for asStaff). */
const staffWith = (tx) => async (fn) => fn(tx);

describe("the six job kinds are registered as system jobs", () => {
  test("start, finish, release, expiry, voice export and the nightly check", async () => {
    for (const kind of ["start_batch", "finish_batch", "release_batch", "expire_drafts", "voice_export", "nightly_script_check"]) {
      assert.ok(JOB_KINDS[kind], `${kind} is registered`);
      assert.equal(JOB_KINDS[kind].group, "system", `${kind} is a system chore`);
      const mod = await JOB_KINDS[kind].load();
      assert.equal(typeof mod.run, "function", `${kind} has run()`);
    }
    assert.equal(SCRIPTS_READY_KIND, "scripts_ready");
    assert.equal(MACHINE, "machine");
  });
});

describe("counting a batch", () => {
  test("ready = scripts written, flagged = still 'needs a look', failed = slots with no script", () => {
    const scripts = [
      { source: "machine", check_results: { flagged: false } },
      { source: "machine", check_results: { flagged: true } },
      { source: "machine", check_results: { strict: { passed: false } } },
      { source: "chris", check_results: { flagged: true } } // a person's version is never machine-flagged
    ];
    assert.deepEqual(countBatch(21, scripts), { total: 21, ready: 4, flagged: 2, failed: 17 });
    assert.deepEqual(countBatch(3, []), { total: 3, ready: 0, flagged: 0, failed: 3 });
    assert.deepEqual(countBatch(2, [{}, {}, {}]), { total: 2, ready: 3, flagged: 0, failed: 0 }, "never a negative failed");
  });
});

describe("start_batch", () => {
  test("an empty plan says why in plain words", () => {
    assert.match(emptyPlanReason({ funnels: [] }, null), /No funnel is turned on/);
    assert.match(emptyPlanReason({ funnels: [{ key: "a", active: false }] }, null), /No funnel is turned on/);
    assert.match(emptyPlanReason({ funnels: [{ key: "a", active: true }] }, { funnel_key: "zzz" }), /no funnel called zzz/);
    assert.match(emptyPlanReason({ funnels: [{ key: "a", active: true }] }, null), /no scripts to write/);
  });

  test("the rules commit is main's head, or none when GitHub cannot be read", async () => {
    const sha = "a".repeat(40);
    assert.equal(await pinRules({}, { getRef: async () => ({ ok: true, sha }) }), sha);
    assert.equal(await pinRules({}, { getRef: async () => ({ ok: false, sha: null, error: "GITHUB_REPO_TOKEN is not set" }) }), null);
    assert.equal(await pinRules({}, { getRef: async () => { throw new Error("offline"); } }), null);
    assert.equal(await pinRules({}, { getRef: async () => ({ ok: true, sha: "not a sha" }) }), null);
  });

  test("angles.json is read at that commit; anything unreadable leaves the bundled copy to the planner", async () => {
    const seen = [];
    const getContents = async (path, opts) => { seen.push([path, opts.ref]); return { ok: true, content: JSON.stringify([{ key: "speed", name: "Speed" }, { name: "no key" }]) }; };
    assert.deepEqual(await readAnglesAt({}, "abc1234", { getContents }), [{ key: "speed", name: "Speed" }]);
    assert.deepEqual(seen, [["marketing/ads/angles.json", "abc1234"]]);
    assert.equal(await readAnglesAt({}, null, { getContents }), null, "no commit: no read");
    assert.equal(await readAnglesAt({}, "abc1234", { getContents: async () => ({ ok: true, content: "{not json" }) }), null);
    assert.equal(await readAnglesAt({}, "abc1234", { getContents: async () => ({ ok: false }) }), null);
  });

  test("a batch that is not planned is left alone, before any GitHub read", async () => {
    let refs = 0;
    const db = fakeDb((sql) => (/FROM marketing_batches/.test(sql) ? { rows: [{ id: BATCH, kind: "weekly", status: "writing" }] } : {}));
    const out = await startBatch(db, {}, { orgId: ORG, batchId: BATCH }, { getRef: async () => { refs += 1; return { ok: false }; } });
    assert.deepEqual(out, { skipped: "not_planned", status: "writing" });
    assert.equal(refs, 0);
  });

  test("a run that throws on its last try marks the batch failed with the reason; earlier tries do not", async () => {
    const make = () => fakeDb((sql) => (/^SELECT id, kind, status FROM marketing_batches/.test(sql) ? { rows: [{ id: BATCH, kind: "weekly", status: "planned" }] } : { rowCount: 1 }));
    const deps = { getRef: async () => ({ ok: false }), asStaff: async () => { throw new Error("the planner broke"); } };

    const early = make();
    await assert.rejects(() => runStartBatch({ id: JOB, org_id: ORG, attempts: 0, payload: { batch_id: BATCH } }, { db: early, env: {}, deps }), /the planner broke/);
    assert.equal(early.calls.filter((c) => /SET status = 'failed'/.test(c.sql)).length, 0);

    const last = make();
    await assert.rejects(() => runStartBatch({ id: JOB, org_id: ORG, attempts: 2, payload: { batch_id: BATCH } }, { db: last, env: {}, deps }), /the planner broke/);
    const failed = last.calls.filter((c) => /SET status = 'failed'/.test(c.sql));
    assert.equal(failed.length, 1);
    assert.match(failed[0].sql, /WHERE id = \$1 AND org_id = \$2 AND status = 'planned'/);
    assert.deepEqual(failed[0].params.slice(0, 2), [BATCH, ORG]);
    assert.match(failed[0].params[2], /^Planning the batch failed: the planner broke/);
  });

  test("a job with no batch id fails at once", async () => {
    await assert.rejects(() => runStartBatch({ id: JOB, org_id: ORG, payload: {} }, { db: fakeDb() }), (err) => err.final === true);
  });
});

describe("finish_batch", () => {
  test("while slots are still being written it re-queues itself 30 seconds out and returns", async () => {
    const db = fakeDb((sql) => {
      if (/^SELECT id, status FROM marketing_batches/.test(sql)) return { rows: [{ id: BATCH, status: "writing" }] };
      if (/count\(\*\)::int AS n FROM marketing_jobs/.test(sql)) return { rows: [{ n: 2 }] };
      return {};
    });
    const requeued = [];
    const out = await runFinishBatch(
      { id: JOB, org_id: ORG, payload: { batch_id: BATCH } },
      { db, env: {}, deps: { now: () => NOW, requeueJob: async (id, opts) => { requeued.push({ id, at: opts.runAfter.toISOString() }); } } }
    );
    assert.deepEqual(out, { wait: true, open: 2 });
    assert.deepEqual(requeued, [{ id: JOB, at: new Date(NOW.getTime() + FINISH_POLL_MS).toISOString() }]);
    const open = db.calls.find((c) => /count\(\*\)::int AS n FROM marketing_jobs/.test(c.sql));
    assert.match(open.sql, /kind = 'write_slot' AND status IN \('queued', 'running'\)/);
    assert.deepEqual(open.params, [ORG, BATCH]);
  });

  test("a batch that never started, or failed, is not counted", async () => {
    for (const status of ["planned", "failed"]) {
      const db = fakeDb(() => ({ rows: [{ id: BATCH, status }] }));
      const out = await runFinishBatch({ id: JOB, org_id: ORG, payload: { batch_id: BATCH } }, { db, env: {}, deps: {} });
      assert.ok(out.skipped, `${status}: ${JSON.stringify(out)}`);
    }
  });
});

describe("voice export", () => {
  test("a pair as the edit op writes it: kind and script id never blank, long lines cut to 2,000", () => {
    const p = pairForFile({ kind: null, lane: "uwiq", before: "a  b\n c", after: "x".repeat(2100), script_id: null, created_at: new Date("2026-10-06T20:00:00Z") });
    assert.equal(p.kind, "line");
    assert.equal(p.lane, "uwiq");
    assert.equal(p.before, "a b c");
    assert.equal(p.after.length, 2000);
    assert.equal(p.script_id, "none");
    assert.equal(p.created_at, "2026-10-06T20:00:00.000Z");
  });

  test("every unexported pair goes into VOICE.md edits of at most 50, and exactly those pairs are stamped", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, script_id: "44444444-4444-4444-8444-444444444444",
      before: `machine line ${i}`, after: `Chris line ${i}`, kind: "cue", created_at: new Date(NOW.getTime() + i), lane: "uwiq"
    }));
    const tx = fakeDb((sql, params) => {
      if (/FROM voice_pairs p/.test(sql)) return { rows };
      if (/INSERT INTO repo_outbox/.test(sql)) return { rows: [{ id: 1, op_id: params[1], path: params[2], mode: params[3] }] };
      if (/UPDATE voice_pairs SET exported_at/.test(sql)) return { rowCount: params[1].length };
      return {};
    });
    const out = await exportVoicePairs(null, { orgId: ORG, weekKey: "2026-W42" }, { asStaff: staffWith(tx) });
    assert.equal(PAIRS_PER_EDIT, 50);
    assert.equal(out.exported, 120);
    assert.equal(out.stamped, 120);
    assert.equal(out.edits, 3);
    const inserts = tx.calls.filter((c) => /INSERT INTO repo_outbox/.test(c.sql));
    assert.equal(inserts.length, 3);
    for (const ins of inserts) {
      assert.equal(ins.params[2], "marketing/ads/VOICE.md");
      assert.equal(ins.params[3], "edit");
      const edit = JSON.parse(ins.params[5]);
      assert.equal(edit.op, "voice_append_pairs");
      assert.ok(edit.pairs.length <= 50);
    }
    assert.deepEqual(inserts.map((c) => JSON.parse(c.params[5]).pairs.length), [50, 50, 20]);
    const sel = tx.calls.find((c) => /FROM voice_pairs p/.test(c.sql));
    assert.match(sel.sql, /exported_at IS NULL/);
    assert.match(sel.sql, /FOR UPDATE OF p SKIP LOCKED/);
    const stamp = tx.calls.find((c) => /UPDATE voice_pairs/.test(c.sql));
    assert.match(stamp.sql, /exported_at IS NULL/);
    assert.equal(stamp.params[1].length, 120);
  });

  test("nothing unexported: no edit, no stamp", async () => {
    const tx = fakeDb(() => ({ rows: [] }));
    const out = await exportVoicePairs(null, { orgId: ORG }, { asStaff: staffWith(tx) });
    assert.equal(out.exported, 0);
    assert.equal(tx.calls.filter((c) => /INSERT INTO repo_outbox|UPDATE voice_pairs/.test(c.sql)).length, 0);
  });
});

describe("the nightly repo check", () => {
  test("git's blob hash", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    assert.equal(gitBlobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
    assert.equal(folderOf("marketing/ads/scripts/machine/2026-W42/01-speed.md"), "marketing/ads/scripts/machine/2026-W42");
    assert.equal(bodyOfFile("not a script file"), null);
  });

  const row = (id, body, path, extra = {}) => ({
    id, body, repo_path: path, version: 1, status: "draft", ad_id: null, offer_key: "slo_roadmap", funnel_key: "roadmap_147",
    script_format: "standard", style: "bullets", angle_key: "speed", batch_week_key: "2026-W42",
    updated_at: new Date("2026-10-12T14:00:00Z"), parts: null, animation_plan: null, meta_copy: null, ...extra
  });
  const P = (n) => `marketing/ads/scripts/machine/2026-W42/0${n}-speed.md`;
  const fileOf = (r, over = {}) => serializeScript({ ...r, updated_by: MACHINE, ...over }).content;

  test("compareScripts: the database's body against the file's body, front matter aside", () => {
    const a = row("a", "Body A", P(1));
    const b = row("b", "Body B", P(2));
    const listing = new Map([[P(1), gitBlobSha(fileOf(a))], [P(2), "f".repeat(40)]]);
    const committed = new Map([[P(1), fileOf(a)]]);
    const v1 = compareScripts([a, b, row("c", "C", P(3)), row("d", "D", P(4)), row("e", "E", null)],
      { listing, committed, waiting: new Set([P(4)]) });
    assert.deepEqual(v1.map((v) => [v.id, v.verdict]), [["a", "ok"], ["b", "needs_read"], ["c", "missing"], ["d", "waiting"], ["e", "missing"]]);

    const fetched = new Map([[P(2), fileOf(b, { body: "Body B, edited by hand", updated_by: "someone" })]]);
    const v2 = compareScripts([b], { listing, committed, waiting: new Set(), fetched });
    assert.equal(v2[0].verdict, "mismatched");
    const same = new Map([[P(2), fileOf(b, { status: "locked", updated_by: "someone else" })]]);
    assert.equal(compareScripts([b], { listing, committed, waiting: new Set(), fetched: same })[0].verdict, "ok", "front matter changes are not a body change");
    assert.equal(compareScripts([b], { listing, committed, waiting: new Set(), fetched: new Map([[P(2), null]]) })[0].verdict, "unreadable");
    assert.equal(compareScripts([b], { listing, committed, waiting: new Set(), fetched: new Map([[P(2), "garbage"]]) })[0].verdict, "mismatched");
  });

  test("checkScriptFiles: one listing per folder, reads only unknown files, queues a replace only on a mismatch", async () => {
    const a = row("a", "Body A", P(1));
    const b = row("b", "Body B", P(2));
    const c = row("c", "Body C", P(3));
    const tx = fakeDb((sql) => {
      if (/FROM ad_scripts s/.test(sql)) return { rows: [a, b, c] };
      if (/SELECT DISTINCT path FROM repo_outbox/.test(sql)) return { rows: [] };
      if (/SELECT DISTINCT ON \(path\) path, content/.test(sql)) return { rows: [{ path: P(1), content: fileOf(a) }, { path: P(2), content: fileOf(b) }] };
      return {};
    });
    const lists = [];
    const reads = [];
    const queued = [];
    const out = await checkScriptFiles(null, {}, { orgId: ORG, day: "2026-10-12" }, {
      asStaff: staffWith(tx),
      listFolder: async (folder) => {
        lists.push(folder);
        return { ok: true, entries: [
          { name: "01-speed.md", path: P(1), type: "file", sha: gitBlobSha(fileOf(a)) },
          { name: "02-speed.md", path: P(2), type: "file", sha: gitBlobSha("someone changed this file") },
          { name: "09-old.md", path: "marketing/ads/scripts/machine/2026-W42/09-old.md", type: "file", sha: "x" }
        ] };
      },
      getContents: async (path) => { reads.push(path); return { ok: true, content: fileOf(b, { body: "Body B, edited by hand" }) }; },
      queueScriptFile: async (_tx, args) => { queued.push(args); return args.scriptId; }
    });
    assert.deepEqual(lists, ["marketing/ads/scripts/machine/2026-W42"], "the folder is listed once");
    assert.deepEqual(reads, [P(2)], "only the file whose hash the app does not know is read");
    assert.deepEqual(queued.map((q) => q.scriptId).sort(), ["b", "c"]);
    for (const q of queued) {
      assert.equal(q.orgId, ORG);
      assert.equal(q.updatedBy, MACHINE);
      assert.match(q.opId, /^u35:nightly:2026-10-12:[bc]:\d+$/);
    }
    assert.deepEqual(
      { checked: out.checked, ok: out.ok, missing: out.missing, mismatched: out.mismatched, extra: out.extra, queued: out.queued, files_read: out.files_read },
      { checked: 3, ok: 1, missing: 1, mismatched: 1, extra: 1, queued: 2, files_read: 1 }
    );
  });

  test("everything matches: nothing is queued", async () => {
    const a = row("a", "Body A", P(1));
    const tx = fakeDb((sql) => {
      if (/FROM ad_scripts s/.test(sql)) return { rows: [a] };
      if (/SELECT DISTINCT ON \(path\)/.test(sql)) return { rows: [{ path: P(1), content: fileOf(a) }] };
      return {};
    });
    const queued = [];
    const out = await checkScriptFiles(null, {}, { orgId: ORG, day: "2026-10-12" }, {
      asStaff: staffWith(tx),
      listFolder: async () => ({ ok: true, entries: [{ path: P(1), type: "file", sha: gitBlobSha(fileOf(a)) }] }),
      getContents: async () => { throw new Error("should not read"); },
      queueScriptFile: async (_tx, args) => { queued.push(args); }
    });
    assert.equal(out.ok, 1);
    assert.equal(out.queued, 0);
    assert.deepEqual(queued, []);
  });

  test("GitHub it cannot read: no token → skipped before any read; the dry-run fence → skipped", async () => {
    assert.deepEqual(await checkScriptFiles(null, {}, { orgId: ORG, day: "d" }, {}), { skipped: "no_token", day: "d" });
    const tx = fakeDb((sql) => (/FROM ad_scripts s/.test(sql) ? { rows: [row("a", "A", P(1))] } : {}));
    const out = await checkScriptFiles(null, {}, { orgId: ORG, day: "d" }, {
      asStaff: staffWith(tx), listFolder: async () => ({ ok: false, blocked: true, entries: [] })
    });
    assert.deepEqual(out, { skipped: "dry_run", day: "d" });
  });

  test("the read is limited to scripts a screen may see (never an import, never an unreleased draft)", async () => {
    const tx = fakeDb(() => ({ rows: [] }));
    await checkScriptFiles(null, {}, { orgId: ORG, day: "d" }, { asStaff: staffWith(tx), listFolder: async () => ({ ok: true, entries: [] }) });
    const sel = tx.calls.find((c) => /FROM ad_scripts s/.test(c.sql));
    assert.match(sel.sql, /s\.source <> 'import'/);
    assert.match(sel.sql, /b\.status = 'released' AND b\.release_at <= now\(\)/);
    assert.match(sel.sql, /s\.archived_at IS NULL/);
  });
});
