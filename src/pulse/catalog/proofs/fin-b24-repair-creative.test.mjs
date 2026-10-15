// Batch 24, repair cycle 1: creative/generate and creative/run.
//
// An independent checker found these stayed green when the product broke:
//   * creative/generate: the test never sent the body the real screens send (the
//     offer, script, formats, variants and kind nested inside `spec`), so the
//     whole spec path was unjudged. With the screen's exact body, a door that read
//     the offer only from the top level answered 400 on every Enqueue press, and
//     all nine tests stayed green.
//   * creative/run: the claim, the run and the all-partners run were handed in as
//     fakes, so only the handler's wiring was judged. A claim that dropped its
//     partner or its queued-only condition, a cap that was ignored, or a run that
//     reported success with nothing stored, all stayed green. So did the 500
//     path, each job's id, and the wording of the requeued, none-worked and
//     no-module notes.
//
// creative/run now runs the REAL claim and run (src/creative/generate.mjs) against
// a stand-in that evaluates the statements' own text, with the one creative
// provider module handed a fake that makes the same copy every time. No vendor is
// asked. This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import creativeGenerate from "../../../../api/creative/generate.mjs";
import creativeRun from "../../../../api/creative/run.mjs";
import { MODULES } from "../../../creative/providers/index.mjs";
import { MAC_WAIT_LINE } from "../../../marketing/ai-runner.mjs";
import { ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const SCRIPT = "a5000000-0000-4000-8000-000000000001";
const KIT = "bb000000-0000-4000-8000-000000000001";
const asPartner = { account: { kind: "partner", partnerId: PARTNER } };

/* ── creative/generate: the body the screens really send ─────────────────── */

function generateWorld() {
  const world = { jobs: [], inserts: [] };
  world.rules = [
    [/SELECT org_id FROM partners WHERE id = \$1/, (_s, p) => (p[0] === PARTNER ? [{ org_id: ORG_ID }] : [])],
    [/FROM partner_module_settings\s+WHERE partner_id = \$1/, (_s, p) => (p[0] === PARTNER ? [{ marketing_suite_enabled: true, ai_token_cap_monthly: 1000, org_id: ORG_ID }] : [])],
    [/SELECT \* FROM generation_jobs WHERE partner_id = \$1 AND idempotency_key = \$2/, (_s, p) => world.jobs.filter((j) => j.partner_id === p[0] && j.idempotency_key === p[1])],
    [/INSERT INTO generation_jobs/, (_s, p) => {
      const row = { id: `3b000000-0000-4000-8000-${String(world.jobs.length + 1).padStart(12, "0")}`, org_id: p[0], partner_id: p[1], brand_kit_id: p[2], spec: JSON.parse(p[6]), status: "queued", idempotency_key: p[8] };
      world.jobs.push(row);
      world.inserts.push(row);
      return [row];
    }],
    [/FROM creative_providers\s+WHERE org_id = \$1 AND asset_kind = \$2 AND active/, [{ provider_key: "copy", config: {} }]],
  ];
  return world;
}
const generate = (world, body) => hit(creativeGenerate, { ...asPartner, method: "POST", body, rules: world.rules });

test("creative/generate takes the body the Creative Factory screen and the Today tab really send: the offer, script, kind, formats and variants nested inside spec", async () => {
  // creative-factory.html: { partner_id, asset_kind, idempotency_key, prompt, spec: { prompt, formats, variants, assetKind, offerType, scriptId? } }
  const screenSpec = { prompt: "Working capital for owners", formats: ["1x1", "9x16"], variants: 2, assetKind: "static", offerType: "funding", scriptId: SCRIPT };
  const world = generateWorld();
  const done = await generate(world, { partner_id: PARTNER, asset_kind: "static", idempotency_key: "screen-press-1", prompt: "Working capital for owners", spec: screenSpec });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.created, true);
  assert.deepEqual(world.inserts[0].spec, screenSpec, "the spec is saved as the screen sent it");
  assert.equal(world.inserts[0].partner_id, PARTNER);

  // marketing-cc-today.js: { partner_id, asset_kind: "copy", idempotency_key, prompt, spec: { prompt, formats, variants, assetKind, offerType } } (no script)
  const today = generateWorld();
  const quick = await generate(today, { partner_id: PARTNER, asset_kind: "copy", idempotency_key: "today-press-1", prompt: "hooks", spec: { prompt: "hooks", formats: ["1x1"], variants: 1, assetKind: "copy", offerType: "credit_cards" } });
  assert.equal(quick.status, 200, JSON.stringify(quick.body));
  assert.deepEqual(today.inserts[0].spec, { prompt: "hooks", formats: ["1x1"], variants: 1, assetKind: "copy", offerType: "credit_cards" }, "no script named, so none is invented");
  assert.deepEqual(sqlCalls(quick, /FROM creative_providers/)[0].params, [ORG_ID, "copy"]);
});

test("creative/generate keeps the offer in the saved spec when it is sent beside a spec that lacks it, and a spec's own script id is checked like any other", async () => {
  const beside = generateWorld();
  const done = await generate(beside, { asset_kind: "copy", idempotency_key: "beside-1", offer_type: "credit_repair", spec: { prompt: "p", formats: ["1x1"], variants: 1 } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(beside.inserts[0].spec.offerType, "credit_repair", "the offer rides into the saved spec, where the compliance check reads it");
  assert.equal(beside.inserts[0].spec.prompt, "p");

  // Not a spec: the formats and variants asked for are the ones saved.
  const flat = generateWorld();
  const many = await generate(flat, { asset_kind: "static", idempotency_key: "flat-1", prompt: "p", offer_type: "funding", formats: ["9x16", "4x5"], variants: 3 });
  assert.equal(many.status, 200);
  assert.deepEqual(flat.inserts[0].spec, { prompt: "p", formats: ["9x16", "4x5"], variants: 3, offerType: "funding", assetKind: "static" }, "the kind is folded in by the queue");

  // A script id inside spec that is not a saved script's id is refused before anything is saved.
  const bad = generateWorld();
  const refused = await generate(bad, { asset_kind: "copy", idempotency_key: "bad-1", spec: { prompt: "p", offerType: "funding", scriptId: "not-a-uuid" } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "script_id_invalid");
  assert.equal(bad.inserts.length, 0);
  // And a brand kit named on the body is the one saved.
  const kit = generateWorld();
  await generate(kit, { asset_kind: "copy", idempotency_key: "kit-1", offer_type: "funding", brand_kit_id: KIT, prompt: "p" });
  assert.equal(kit.inserts[0].brand_kit_id, KIT);
});

/* ── creative/run: the real claim and the real run ───────────────────────── */

const MODULE_COPY = MODULES.copy;
const MODULE_COUNT = { made: 0 };
afterEach(() => { MODULES.copy = MODULE_COPY; });

const WORDS = "Your credit file decides which lenders say yes.";
function fakeCopyWriter({ zero = false } = {}) {
  MODULE_COUNT.made = 0;
  MODULES.copy = {
    ...MODULE_COPY,
    generate: async () => {
      MODULE_COUNT.made += 1;
      if (zero) return { assets: [], cost_cents: 0 };
      return { assets: [{ kind: "copy", format: "1x1", provider: "fake-writer", provider_asset_id: `p-${MODULE_COUNT.made}`, text: WORDS }], cost_cents: 12 };
    },
  };
}

const job = (id, over = {}) => ({
  id: `3b000000-0000-4000-8000-0000000000${id}`, org_id: ORG_ID, partner_id: PARTNER, brand_kit_id: null, status: "queued", attempt: 0,
  created_at: `2026-10-14T10:${id}:00.000Z`, spec: { assetKind: "copy", offerType: "funding", prompt: "hooks" }, error: null, ...over,
});

/* A stand-in for the job queue and its neighbours that answers each statement by
   the conditions its text names: the claim keeps a job only while its statement
   still says "this partner" and "queued", and the cap counts only this partner's
   running jobs. Take a condition out of the SQL and the wrong job comes back. */
function jobsWorld({ jobs, providers = [{ org_id: ORG_ID, asset_kind: "copy", provider_key: "copy", config: {} }], cap = null, claimFails = false }) {
  const world = { jobs, assets: [], links: [] };
  let n = 0;
  world.rules = [
    [/SELECT max_concurrent_jobs FROM partner_module_settings WHERE partner_id = \$1/, (_s, p) => (cap == null ? [] : [{ max_concurrent_jobs: cap, partner_id: p[0] }])],
    [/SELECT approve_before_launch FROM partner_module_settings/, [{ approve_before_launch: true }]],
    [/^\s*UPDATE generation_jobs SET status = 'running'/, (sql, p) => {
      if (claimFails) return new Error("claim statement refused");
      const inner = sql.slice(sql.indexOf("SELECT id FROM generation_jobs"));
      const scoped = /partner_id = \$1/.test(inner);
      const queuedOnly = /status = 'queued'/.test(inner);
      const include = /spec->>'assetKind' = ANY\(\$(\d+)::text\[\]\)/.exec(inner);
      const exclude = /NOT \(coalesce\(spec->>'assetKind', ''\) = ANY\(\$(\d+)::text\[\]\)\)/.exec(inner);
      const pick = world.jobs
        .filter((j) => (!scoped || j.partner_id === p[0]) && (!queuedOnly || j.status === "queued"))
        .filter((j) => !include || p[Number(include[1]) - 1].includes(j.spec.assetKind))
        .filter((j) => !exclude || !p[Number(exclude[1]) - 1].includes(j.spec.assetKind || ""))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!pick) return [];
      pick.status = "running";
      pick.attempt += 1;
      return [{ ...pick }];
    }],
    // The all-partners discovery: one row per partner with a queued job, oldest first, up to the limit.
    [/SELECT partner_id, org_id FROM \(\s*SELECT DISTINCT ON \(partner_id\)/, (sql, p) => {
      const queuedOnly = /WHERE status = 'queued'/.test(sql);
      const exclude = /NOT \(coalesce\(spec->>'assetKind', ''\) = ANY\(\$(\d+)::text\[\]\)\)/.exec(sql);
      const seen = new Map();
      for (const j of [...world.jobs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        if (queuedOnly && j.status !== "queued") continue;
        if (exclude && p[Number(exclude[1]) - 1].includes(j.spec.assetKind || "")) continue;
        if (!seen.has(j.partner_id)) seen.set(j.partner_id, { partner_id: j.partner_id, org_id: j.org_id, created_at: j.created_at });
      }
      return [...seen.values()].slice(0, Number(p[0]));
    }],
    [/count\(\*\)::int AS n FROM generation_jobs\s+WHERE partner_id = \$1 AND status = 'queued' AND spec->>'assetKind' = ANY\(\$2::text\[\]\)/, (sql, p) => [{
      n: world.jobs.filter((j) => (!/partner_id = \$1/.test(sql) || j.partner_id === p[0]) && j.status === "queued" && p[1].includes(j.spec.assetKind)).length,
    }]],
    [/count\(\*\)::int AS n FROM generation_jobs\s+WHERE partner_id = \$1 AND status = 'running'/, (sql, p) => [{
      n: world.jobs.filter((j) => (!/partner_id = \$1/.test(sql) || j.partner_id === p[0]) && (!/status = 'running'/.test(sql) || j.status === "running")).length,
    }]],
    [/FROM creative_providers\s+WHERE org_id = \$1 AND asset_kind = \$2 AND active/, (_s, p) => providers.filter((r) => r.org_id === p[0] && r.asset_kind === p[1])],
    [/UPDATE generation_jobs SET provider = \$2 WHERE id = \$1/, []],
    [/INSERT INTO creative_assets/, (_s, p) => {
      const row = { id: `as-${++n}`, org_id: p[0], partner_id: p[1], kind: p[3], copy_text: p[8], script_id: p[14] };
      world.assets.push(row);
      return [row];
    }],
    [/INSERT INTO generation_job_assets/, (_s, p) => { world.links.push([p[2], p[3]]); return []; }],
    [/FROM compliance_rules/, []],
    [/UPDATE creative_assets SET compliance_state/, []],
    [/INSERT INTO compliance_screenings/, []],
    [/UPDATE generation_jobs\s+SET status = 'succeeded'/, (_s, p) => { const j = world.jobs.find((x) => x.id === p[0]); if (j) j.status = "succeeded"; return []; }],
    [/UPDATE generation_jobs\s+SET status = \$2, error = \$3/, (_s, p) => {
      const j = world.jobs.find((x) => x.id === p[0]);
      if (j) { j.status = p[1]; j.error = p[2]; }
      return [];
    }],
  ];
  return world;
}
const press = (world, body = {}, deps = {}) => hit(creativeRun, { ...asPartner, method: "POST", body, deps, rules: world.rules });

test("creative/run claims this partner's oldest QUEUED job and runs it for real: the copy is stored against the job and the job is marked done", async () => {
  fakeCopyWriter();
  const world = jobsWorld({
    jobs: [
      job("03", { status: "succeeded" }),                                     // the oldest of all, but already done
      job("01", { partner_id: OTHER_PARTNER }),                               // older than ours, someone else's
      job("04"),                                                              // ours, the oldest waiting
      job("05"),                                                              // ours, next
    ],
  });
  // created_at orders the statement's ORDER BY: make the foreign and finished jobs the oldest.
  world.jobs.find((j) => j.id.endsWith("03")).created_at = "2026-10-14T08:00:00.000Z";
  world.jobs.find((j) => j.id.endsWith("01")).created_at = "2026-10-14T09:00:00.000Z";

  const done = await press(world, { max_jobs: 1, partner_id: OTHER_PARTNER });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.ran, 1);
  assert.equal(done.body.succeeded, 1);
  assert.equal(done.body.jobs[0].job_id, "3b000000-0000-4000-8000-000000000004", "this partner's oldest queued job, not the older finished one, not another partner's");
  assert.equal(done.body.jobs[0].status, "succeeded");
  assert.equal(done.body.jobs[0].assets.length, 1, "the answer carries the piece that was made");
  assert.equal(done.body.jobs[0].assets[0].copy_text, WORDS);
  assert.equal(done.body.note, undefined, "everything worked, so there is nothing to explain");
  // What really happened to the rows.
  assert.equal(world.assets.length, 1, "the copy was stored");
  assert.equal(world.assets[0].partner_id, PARTNER);
  assert.deepEqual(world.links, [["3b000000-0000-4000-8000-000000000004", "as-1"]], "and linked to the job that made it");
  assert.equal(world.jobs.find((j) => j.id.endsWith("04")).status, "succeeded");
  assert.equal(world.jobs.find((j) => j.id.endsWith("05")).status, "queued", "the next job waits for the next press");
  assert.equal(world.jobs.find((j) => j.id.endsWith("01")).status, "queued", "another partner's job is never touched");
  assert.equal(world.jobs.find((j) => j.id.endsWith("03")).status, "succeeded");
  assert.equal(MODULE_COUNT.made, 1, "the writer was asked once, for one job");
});

test("creative/run claims nothing while this partner is at its running-job cap, and counts only this partner's running jobs against it", async () => {
  fakeCopyWriter();
  const atCap = jobsWorld({ cap: 2, jobs: [job("01", { status: "running" }), job("02", { status: "running" }), job("03")] });
  const held = await press(atCap, { max_jobs: 3 });
  assert.equal(held.status, 200);
  assert.equal(held.body.ran, 0, "two running, cap two: nothing new is started");
  assert.equal(atCap.jobs.find((j) => j.id.endsWith("03")).status, "queued");
  assert.equal(MODULE_COUNT.made, 0);

  // Another partner's busy queue is not this partner's cap.
  fakeCopyWriter();
  const theirs = jobsWorld({
    cap: 2,
    jobs: [job("01", { status: "running", partner_id: OTHER_PARTNER }), job("02", { status: "running", partner_id: OTHER_PARTNER }), job("03")],
  });
  const free = await press(theirs, { max_jobs: 1 });
  assert.equal(free.body.ran, 1, "this partner has nothing running, so its job starts");
  assert.equal(theirs.jobs.find((j) => j.id.endsWith("03")).status, "succeeded");
});

test("creative/run says what happened to each job in plain words: back in the queue, none worked, one did not, and the service on file is unknown", async () => {
  // The writer answers and sends nothing: the job goes back in the queue.
  fakeCopyWriter({ zero: true });
  const requeued = jobsWorld({ jobs: [job("01")] });
  const a = await press(requeued, { max_jobs: 1 });
  assert.equal(a.body.requeued, 1);
  assert.equal(a.body.jobs[0].status, "queued");
  assert.equal(a.body.jobs[0].job_id, "3b000000-0000-4000-8000-000000000001");
  assert.match(a.body.note, /^They are back in the queue and will be tried again\. The service answered, but sent nothing back\.$/);
  assert.equal(requeued.jobs[0].status, "queued");
  assert.equal(requeued.assets.length, 0);

  // No service switched on: two jobs, both failed, said once.
  const none = jobsWorld({ providers: [], jobs: [job("01"), job("02")] });
  const b = await press(none, { max_jobs: 2 });
  assert.equal(b.body.failed, 2);
  assert.equal(b.body.note, "None of them worked, and nothing was made. No ad-making service is switched on for this account, so there is nothing to make the work.");
  assert.deepEqual(b.body.jobs.map((j) => j.status), ["failed", "failed"]);

  // One job only: the singular words.
  const one = jobsWorld({ providers: [], jobs: [job("01")] });
  const c = await press(one, { max_jobs: 1 });
  assert.match(c.body.note, /^It did not work, and nothing was made\. No ad-making service is switched on/);

  // A service on file that nothing here can run.
  const odd = jobsWorld({ providers: [{ org_id: ORG_ID, asset_kind: "copy", provider_key: "mystery-vendor", config: {} }], jobs: [job("01")] });
  const d = await press(odd, { max_jobs: 1 });
  assert.equal(d.body.note, "It did not work, and nothing was made. The ad-making service on file is one this system does not know how to use.");

  // One worked and one did not.
  fakeCopyWriter();
  const mixed = jobsWorld({ jobs: [job("01"), job("02", { spec: { assetKind: "static", offerType: "funding", prompt: "p" } })] });
  const e = await press(mixed, { max_jobs: 2 });
  assert.equal(e.body.succeeded, 1);
  assert.equal(e.body.failed, 1);
  assert.match(e.body.note, /^Some did not work\. /);
});

test("creative/run answers a 500 that names no one's data when the queue cannot be read, and counts the Mac's waiting jobs for this partner only", async () => {
  fakeCopyWriter();
  const broken = jobsWorld({ jobs: [job("01")], claimFails: true });
  const failed = await press(broken, { max_jobs: 1 });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.ok, false);
  assert.equal(typeof failed.body.error, "string");

  const waiting = jobsWorld({ jobs: [job("01"), job("02"), job("03", { partner_id: OTHER_PARTNER }), job("04", { partner_id: OTHER_PARTNER }), job("05", { partner_id: OTHER_PARTNER })] });
  const mac = await press(waiting, {}, { env: { MARKETING_AI_RUNNER: "local" } });
  assert.equal(mac.status, 200);
  assert.equal(mac.body.ran, 0, "copy jobs wait for the Mac, so none was claimed here");
  assert.equal(mac.body.waiting_for_mac, 2, "this partner's two, not the five in the whole queue");
  assert.equal(mac.body.note, MAC_WAIT_LINE);
  assert.equal(MODULE_COUNT.made, 0);
  assert.deepEqual(sqlCalls(mac, /status = 'queued' AND spec->>'assetKind' = ANY/)[0].params, [PARTNER, ["copy"]]);
});

test("creative/run with all=1 runs every partner's due work through the real runner, one partner's jobs never another's, and skips a partner with nothing queued", async () => {
  fakeCopyWriter();
  const THIRD = "9c000000-0000-4000-8000-000000000003";
  const world = jobsWorld({
    jobs: [
      job("01"),                                         // PARTNER, queued
      job("02", { partner_id: OTHER_PARTNER }),          // another partner, queued
      job("03", { partner_id: THIRD, status: "succeeded" }), // a partner with nothing due
      job("04"),                                         // PARTNER, a second one
    ],
  });
  const done = await hit(creativeRun, { method: "POST", role: "admin", body: { all: 1, max_jobs: 1 }, rules: world.rules });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.partners, 2, "two partners have something queued; the third has nothing due");
  assert.deepEqual(done.body.jobs.map((j) => [j.partner_id, j.status]).sort(), [[PARTNER, "succeeded"], [OTHER_PARTNER, "succeeded"]]);
  assert.deepEqual(world.assets.map((a) => a.partner_id).sort(), [PARTNER, OTHER_PARTNER], "each partner's own job was made, for that partner");
  assert.equal(world.jobs.find((j) => j.id.endsWith("04")).status, "queued", "max_jobs 1: a partner's second job waits");
  assert.equal(world.jobs.find((j) => j.partner_id === THIRD).status, "succeeded");
  assert.equal(MODULE_COUNT.made, 2);

  // With the Mac running the copy, Netlify's sweep finds nothing to take.
  fakeCopyWriter();
  const local = jobsWorld({ jobs: [job("01"), job("02", { partner_id: OTHER_PARTNER })] });
  const held = await hit(creativeRun, { method: "POST", role: "admin", body: { all: 1 }, deps: { env: { MARKETING_AI_RUNNER: "local" } }, rules: local.rules });
  assert.equal(held.body.partners, 0);
  assert.deepEqual(held.body.jobs, []);
  assert.equal(MODULE_COUNT.made, 0);
});
