// S5 route proofs: the marketing screens' read doors. Each case runs the REAL
// api/ handler (real gate, real store code, real view shaping) against a
// stand-in database and judges the exact answer the screen would paint.

import assert from "node:assert/strict";
import test from "node:test";

import batchesHandler from "../../../../api/marketing/batches.mjs";
import funnelHandler from "../../../../api/marketing/funnel.mjs";
import scriptHandler from "../../../../api/marketing/script.mjs";
import scriptsHandler from "../../../../api/marketing/scripts.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { ORG_ID, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-door-marketing-reads.test.mjs";
const log = exerciseLog(THIS_FILE);
const NOW = new Date("2026-10-13T18:00:00.000Z");
const SCRIPT_ID = "a5000000-0000-4000-8000-000000000001";
const ROOT_ID = "a5000000-0000-4000-8000-0000000000f0";
const BATCH_ID = "ba000000-0000-4000-8000-000000000001";
const FUNNEL_ID = "f0000000-0000-4000-8000-000000000001";

function scriptRow(over = {}) {
  return {
    id: SCRIPT_ID, root_script_id: ROOT_ID, version: "2", status: "locked", ad_id: 43, title: "Ad 43 hook",
    body: "Say the cause first.", parts: null, source: "machine", check_results: { flagged: true },
    film_order: 1, needs_retake: false, locked_at: new Date("2026-10-12T17:00:00.000Z"), locked_by: "Olive Owner",
    created_at: new Date("2026-10-11T10:00:00.000Z"), updated_at: new Date("2026-10-12T17:00:00.000Z"),
    ...over,
  };
}

test("marketing/scripts lists this company's scripts, scoped by status and batch, imports and unreleased batches hidden", async () => {
  assert.equal(ROUTES["marketing/scripts"], scriptsHandler);
  const rows = [scriptRow(), scriptRow({ id: "a5000000-0000-4000-8000-000000000002", version: 1, source: "person", check_results: { flagged: true }, ad_id: null, status: "locked" })];
  const done = await hit(scriptsHandler, {
    query: { status: "locked", batch: BATCH_ID }, deps: { now: () => NOW },
    rules: [[/FROM ad_scripts s LEFT JOIN marketing_batches b/, rows]],
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.as_of, NOW.toISOString());
  assert.deepEqual(done.body.scripts.map((s) => [s.id, s.version, s.status, s.ad_id, s.flagged, s.locked_at]), [
    [SCRIPT_ID, 2, "locked", "43", true, "2026-10-12T17:00:00.000Z"],
    ["a5000000-0000-4000-8000-000000000002", 1, "locked", null, false, "2026-10-12T17:00:00.000Z"],
  ]);
  const [call] = sqlCalls(done, /FROM ad_scripts s LEFT JOIN/);
  assert.deepEqual(call.params, [ORG_ID, "locked", BATCH_ID]);
  assert.match(call.sql, /s\.source <> 'import'/);
  assert.match(call.sql, /b\.status = 'released' AND b\.release_at <= now\(\)/);
  assert.match(call.sql, /s\.archived_at IS NULL/);

  const badStatus = await hit(scriptsHandler, { query: { status: "banana" }, rules: [] });
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.body.field, "status");
  assert.equal(sqlCalls(badStatus, /FROM ad_scripts/).length, 0);
  const closer = await hit(scriptsHandler, { role: "closer", rules: [] });
  assert.equal(closer.status, 403);
  log.mark("marketing-scripts");
});

test("marketing/script returns one script with every version, newest first, and 404s a script from another company", async () => {
  assert.equal(ROUTES["marketing/script"], scriptHandler);
  const v2 = scriptRow({ version: 2 });
  const v1 = scriptRow({ id: "a5000000-0000-4000-8000-000000000003", version: 1, status: "draft", locked_at: null, locked_by: null });
  const rules = [
    [/WHERE s\.id = \$1 AND s\.org_id = \$2/, [v2]],
    [/WHERE s\.root_script_id = \$1 AND s\.org_id = \$2/, [v2, v1]],
  ];
  const done = await hit(scriptHandler, { query: { id: SCRIPT_ID }, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.script.id, SCRIPT_ID);
  assert.equal(done.body.script.version, 2);
  assert.deepEqual(done.body.versions.map((v) => v.version), [2, 1]);
  assert.deepEqual(sqlCalls(done, /WHERE s\.id = \$1 AND s\.org_id = \$2/)[0].params, [SCRIPT_ID, ORG_ID]);
  assert.deepEqual(sqlCalls(done, /WHERE s\.root_script_id/)[0].params, [ROOT_ID, ORG_ID]);

  const missing = await hit(scriptHandler, { query: { id: SCRIPT_ID }, rules: [] });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "not_found");
  const noId = await hit(scriptHandler, { query: { id: "nope" }, rules });
  assert.equal(noId.status, 400);
  assert.equal(noId.body.field, "id");
  log.mark("marketing-script");
});

test("marketing/batches lists drops newest first with plain counts, and says whether Write now is ready", async () => {
  assert.equal(ROUTES["marketing/batches"], batchesHandler);
  const rows = [
    { id: BATCH_ID, kind: "weekly", week_key: "2026-W42", status: "released", release_at: new Date("2026-10-12T15:00:00.000Z"), released_at: new Date("2026-10-12T15:00:05.000Z"), total: "6", ready: "5", flagged: "1", failed: "0", error: null },
    { id: "ba000000-0000-4000-8000-000000000002", kind: "write_now", week_key: null, status: "failed", release_at: null, released_at: null, total: 3, ready: 0, flagged: 0, failed: 3, error: "model cap reached" },
  ];
  const done = await hit(batchesHandler, { rules: [[/FROM marketing_batches\s+WHERE org_id = \$1/, rows]] });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.batches, [
    { id: BATCH_ID, kind: "weekly", week_key: "2026-W42", status: "released", release_at: "2026-10-12T15:00:00.000Z", released_at: "2026-10-12T15:00:05.000Z", counts: { total: 6, ready: 5, flagged: 1, failed: 0 }, error: null },
    { id: "ba000000-0000-4000-8000-000000000002", kind: "write_now", week_key: null, status: "failed", release_at: null, released_at: null, counts: { total: 3, ready: 0, flagged: 0, failed: 3 }, error: "model cap reached" },
  ]);
  assert.equal(typeof done.body.write_now_ready, "boolean");
  assert.deepEqual(sqlCalls(done, /FROM marketing_batches/)[0].params, [ORG_ID]);
  assert.match(sqlCalls(done, /FROM marketing_batches/)[0].sql, /ORDER BY created_at DESC/);

  const off = await hit(batchesHandler, { deps: { jobKinds: {} }, rules: [] });
  assert.equal(off.body.write_now_ready, false, "no start_batch job kind means Write now is not ready");
  const on = await hit(batchesHandler, { deps: { jobKinds: { start_batch: () => {} } }, rules: [] });
  assert.equal(on.body.write_now_ready, true);
  const post = await hit(batchesHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
  log.mark("marketing-batches");
});

test("marketing/funnel returns one built funnel with its pages (words and HTML) and its last build and push jobs", async () => {
  assert.equal(ROUTES["marketing/funnel"], funnelHandler);
  const rules = [
    [/FROM marketing_funnels WHERE id = \$1 AND org_id = \$2/, [{
      id: FUNNEL_ID, key: "uwiq-trial", name: "UnderwriteIQ trial", landing_url: "https://apply.fundhub.ai/uwiq", lane: "uwiq",
      book_call: true, format_mix: {}, cta_type: "book", meta_campaign_ids: ["c-1"], weight: "2", active: true,
      created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z", path: "uwiq",
    }]],
    [/FROM marketing_funnel_pages WHERE funnel_id = \$1/, [
      { id: "p-1", position: 1, role: "landing", path: "uwiq", built_at: new Date("2026-10-02T10:00:00.000Z"), cf_page_id: null, proved_at: null, page_copy: { headline: "Know your number" }, html: "<h1>Know your number</h1>" },
      { id: "p-2", position: 2, role: "book", path: "uwiq/book", built_at: null, cf_page_id: null, proved_at: null, page_copy: null, html: null },
    ]],
    [/FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = ANY/, [
      { id: "job-9", kind: "funnel_build", status: "succeeded", attempts: 1, error: null, result: { pages: 2 }, created_at: new Date("2026-10-02T09:59:00.000Z"), claimed_at: null, finished_at: new Date("2026-10-02T10:00:00.000Z"), run_after: null },
    ]],
  ];
  const done = await hit(funnelHandler, { query: { id: FUNNEL_ID }, deps: { now: () => NOW }, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.funnel.id, FUNNEL_ID);
  assert.equal(done.body.funnel.weight, 2);
  assert.deepEqual(done.body.pages.map((p) => [p.role, p.status, p.html, p.copy]), [
    ["landing", "built", "<h1>Know your number</h1>", { headline: "Know your number" }],
    ["book", "empty", null, null],
  ]);
  assert.deepEqual(done.body.jobs.map((j) => [j.id, j.status, j.finished_at]), [["job-9", "succeeded", "2026-10-02T10:00:00.000Z"]]);
  assert.equal(done.body.as_of, NOW.toISOString());
  assert.deepEqual(sqlCalls(done, /FROM marketing_funnels WHERE id/)[0].params, [FUNNEL_ID, ORG_ID]);

  const missing = await hit(funnelHandler, { query: { id: FUNNEL_ID }, rules: [] });
  assert.equal(missing.status, 404);
  const noId = await hit(funnelHandler, { query: {}, rules });
  assert.equal(noId.status, 400);
  log.mark("marketing-funnel");
});

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
