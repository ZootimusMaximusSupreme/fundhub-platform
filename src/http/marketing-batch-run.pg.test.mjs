// The batch lifecycle against real Postgres (plan unit U35; spec §7.7, §7.2, §7.9, §2 items
// 1 and 4). The clock's weekly tick, start_batch → write_slot → finish_batch →
// release_batch, the late draft, Write now, expiry, the voice export and the nightly check.
//
// WHAT THIS PROVES
//   * The clock firing twice (and two clocks at once) makes ONE weekly batch and ONE
//     start_batch; with `enabled` false it makes no batch and queues nothing.
//   * Nothing is visible before release_at; release writes one repo_outbox 'replace' row
//     per released draft and none before; ONE buzz with the real counts
//     ("Scripts: 2 of 3 ready, 1 failed."), even when release and the clock run again.
//   * A draft that finishes late (Chris pressed Retry on a failed slot) appears, gets its
//     file, and the counts move, with no second buzz.
//   * Write now with 3 makes 3 drafts, each strict-clean, each with its own angle, hook and
//     CTA, with parts and a valid animation plan; it releases as soon as it is done and
//     buzzes only when the page_seen heartbeat is older than 2 minutes. Only
//     api.anthropic.com is called.
//   * Expiry touches machine drafts only (never an import, never Chris's version).
//   * The voice export runs once per pair.
//   * The nightly check queues a 'replace' row only on a body-hash mismatch.
//
// The worker is played by runJob() below: claim one row (status running), run its
// JOB_KINDS handler, then finishJob / failJob — what src/marketing/worker.mjs does per job.
// Only this file's own jobs are ever run. No network: Anthropic is a fake fetch, there is
// no GITHUB_REPO_TOKEN (the rules and angles come from the repo copies), and the nightly
// check's GitHub listing and reads are fakes.
//
// Every row lives in this file's own orgs (slug zz-u35-batch-run-*); after() deletes them.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, close } from "../db.mjs";
import { rlsPool, closeRlsPool } from "../testing/rls-pool.mjs";
import { asStaff } from "../partners/rls.mjs";
import { JOB_KINDS } from "../marketing/job-kinds.mjs";
import { enqueueJob, finishJob, failJob, retryJob } from "../marketing/jobs.mjs";
import { tick, readSettings, weeklyTick, followLateDrafts } from "../marketing/clock.mjs";
import { releaseBatch } from "../marketing/batch-run.mjs";
import { startWriteNow } from "../marketing/ideas-store.mjs";
import { getOrCreateSettings } from "../marketing/settings-store.mjs";
import { listScripts } from "../marketing/scripts-store.mjs";
import { validateAnimationPlan } from "../marketing/animation-plan.mjs";
import { hookOf, ctaOf } from "../marketing/sameness.mjs";
import { gitBlobSha } from "../marketing/nightly-script-check.mjs";
import { parseScript } from "../marketing/script-file.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLUG_TAG = "zz-u35-batch-run";
const RUN = Date.now().toString(36);
const ENV = Object.freeze({ ANTHROPIC_API_KEY: "sk-ant-test-not-real", OPENAI_API_KEY: "sk-openai-test-not-real" });

// ── Three drafts that pass every code check (standard, bullets), each a whole different ad

function bullets({ title, hook_key, hook, line2, cues, reveal, cta, meta, anims }) {
  return {
    title, angle_key: "the_conveyor_belt", hook_key, offer_key: "slo_roadmap", lane: "uwiq",
    script_format: "standard", style: "bullets",
    body: [hook, "", line2, "", ...cues.map((c) => `- ${c}`), "", reveal, "", cta].join("\n"),
    parts: [
      { kind: "hook", text: hook }, { kind: "line2", text: line2 },
      ...cues.map((t) => ({ kind: "cue", text: t })),
      { kind: "reveal", text: reveal }, { kind: "cta", text: cta }
    ],
    meta_copy: { ...meta, cta_type: "LEARN_MORE" },
    animation_plan: anims
  };
}

const DRAFTS = [
  bullets({
    title: "The Conveyor Belt", hook_key: "lenders_read_two_files_u35",
    hook: "Lenders read two files before they say yes, and you have probably only fixed one of them.",
    line2: "Which one they read FIRST sets how much funding you can get.",
    cues: [
      "Your personal file shows every card balance",
      "Your business file shows how long the company has been open",
      "On bigger lines the business file gets read first"
    ],
    reveal: "So fix the file they read first, and the rest gets easier ↑",
    cta: "Tap below to get your Roadmap. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so.",
    meta: { primary_text: "Lenders read two files before they say yes. See both of yours first.", headline: "See both files first", description: "Your Funding Roadmap" },
    anims: [
      { anchor: { phrase: null, cue: 1, keyword: "personal" }, template: "FileItems", props: "{}", seconds: 2.5 },
      { anchor: { phrase: null, cue: 3, keyword: "first" }, template: "StepPath", props: "{}", seconds: 3 }
    ]
  }),
  bullets({
    title: "The Event-Driven Engine", hook_key: "inquiries_counted_first_u35",
    hook: "Every hard inquiry sits on your file for a long time, and lenders count them before they read anything else.",
    line2: "So the ORDER you apply in matters more than where you apply.",
    cues: [
      "Each new application adds one more inquiry",
      "Too many inquiries in one month look like stress",
      "Spacing them out keeps your file looking calm"
    ],
    reveal: "Plan the order first, then apply ↑",
    cta: "Tap below to get your Roadmap with the order laid out. It is a soft pull only, and nothing moves until you say so.",
    meta: { primary_text: "Lenders count inquiries before they read anything else. See the order to apply in first.", headline: "See the order first", description: "Your Funding Roadmap" },
    anims: [
      { anchor: { phrase: null, cue: 1, keyword: "inquiry" }, template: "FileItems", props: "{}", seconds: 2.5 },
      { anchor: { phrase: null, cue: 3, keyword: "calm" }, template: "StepPath", props: "{}", seconds: 3 }
    ]
  }),
  bullets({
    title: "Speed", hook_key: "business_card_no_history_u35",
    hook: "A business card with no history behind it gets a small limit, even when your personal file is clean.",
    line2: "The limit follows what the lender can SEE about the company.",
    cues: [
      "A business address and phone that match everywhere",
      "A bank account that has been open for months",
      "Bills paid on time in the company name"
    ],
    reveal: "Build what they can see, and the limits follow ↑",
    cta: "Tap the button to see your Roadmap for the business side. There is zero impact on your score, and there is no obligation.",
    meta: { primary_text: "A business card with no history gets a small limit. See what lenders can see first.", headline: "See what lenders see", description: "Your Funding Roadmap" },
    anims: [
      { anchor: { phrase: null, cue: 1, keyword: "address" }, template: "FileItems", props: "{}", seconds: 2.5 },
      { anchor: { phrase: null, cue: 3, keyword: "bills" }, template: "StepPath", props: "{}", seconds: 3 }
    ]
  })
];

/**
 * Fake Anthropic. `writer`: what each writer call answers, in order (the last repeats):
 * a draft object, or {status} for an HTTP error. The judge always finds nothing.
 */
function fakeAnthropic(writer) {
  const calls = [];
  let w = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const isJudge = !!body.output_config?.format?.schema?.properties?.violations;
    calls.push({ host: new URL(String(url)).host, kind: isJudge ? "judge" : "writer" });
    const out = isJudge ? { violations: [] } : writer[Math.min(w++, writer.length - 1)];
    if (out && out.status) {
      return { ok: false, status: out.status, json: async () => ({ type: "error", error: { type: "api_error", message: "test outage" } }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        id: "msg_u35", type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", stop_details: null,
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      })
    };
  };
  return { fetchImpl, calls };
}

const HOUR = 3600 * 1000;

/** batch_weekday and batch_time (Arizona) that put the next drop ~2 hours from now. */
function scheduleTwoHoursOut() {
  const t = new Date(Date.now() + 2 * HOUR);
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(t)) p[x.type] = x.value;
  return {
    batch_weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
    batch_time: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`
  };
}

describe("the batch lifecycle (U35)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  /** orgW: the weekly batch (enabled). orgC: Write now. orgOff: enabled false. */
  let orgW, orgC, orgOff;
  let weekly; // the weekly batch row

  const orgsSql = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
  async function cleanup() {
    for (const t of ["marketing_buzzes", "marketing_heartbeats", "marketing_model_usage", "repo_outbox", "voice_pairs", "marketing_jobs", "marketing_requests"]) {
      await db.query(`DELETE FROM ${t} WHERE org_id IN ${orgsSql}`);
    }
    for (let i = 0; i < 20; i++) {
      const gone = await db.query(
        `DELETE FROM ad_scripts s
          WHERE s.org_id IN ${orgsSql}
            AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                             WHERE k.id <> s.id AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`);
      if (!gone.rowCount) break;
    }
    for (const t of ["ad_ideas", "ad_labels", "marketing_batches", "marketing_funnels", "marketing_settings", "partners"]) {
      await db.query(`DELETE FROM ${t} WHERE org_id IN ${orgsSql}`);
    }
    try { await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`); } catch { /* reused next run */ }
  }

  async function mkOrg(suffix, settingsPatch) {
    const org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'U35 batch lifecycle fixture') RETURNING id`,
      [`${SLUG_TAG}-${suffix}-${RUN}`])).rows[0].id;
    await db.query(`INSERT INTO partners (org_id, name, slug) VALUES ($1, 'Fundhub (house)', 'fundhub-house')`, [org]);
    await db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, offer_key, lane, book_call, format_mix)
       VALUES ($1, 'roadmap_147', 'Roadmap', 'https://apply.fundhub.ai/roadmap', 'slo_roadmap', 'uwiq', false, '{"standard":1}'::jsonb)`,
      [org]);
    await getOrCreateSettings(db, org);
    const keys = Object.keys(settingsPatch);
    if (keys.length) {
      await db.query(
        `UPDATE marketing_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE org_id = $1`,
        [org, ...keys.map((k) => settingsPatch[k])]);
    }
    return org;
  }

  /** The worker, for one job row: claim it, run its handler, finish or fail it. */
  async function runJob(job, deps = {}) {
    const claimed = (await db.query(
      `UPDATE marketing_jobs SET status = 'running', claimed_at = now() WHERE id = $1 AND status = 'queued' RETURNING *`,
      [job.id])).rows[0];
    assert.ok(claimed, `the ${job.kind} job was waiting to run`);
    const mod = await JOB_KINDS[claimed.kind].load();
    try {
      const result = await mod.run(claimed, { db, env: ENV, deps: { pool: rlsPool, ...deps } });
      await finishJob(db, claimed.id, result);
      return result;
    } catch (err) {
      await failJob(db, claimed.id, err, { final: true });
      return { threw: String(err && err.message) };
    }
  }

  const jobs = async (org, kind, status = "queued") => (await db.query(
    `SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = $2 AND status = $3 ORDER BY created_at, id`,
    [org, kind, status])).rows;
  const batchRow = async (id) => (await db.query(`SELECT * FROM marketing_batches WHERE id = $1`, [id])).rows[0];
  const outbox = async (org) => (await db.query(
    `SELECT * FROM repo_outbox WHERE org_id = $1 ORDER BY id`, [org])).rows;
  const buzzes = async (org) => (await db.query(
    `SELECT * FROM marketing_buzzes WHERE org_id = $1 ORDER BY created_at, id`, [org])).rows;
  const visible = (org) => asStaff((tx) => listScripts(tx, { orgId: org }), { pool: rlsPool });
  const mine = (org) => async () => (await readSettings(db)).filter((s) => s.org_id === org);
  /** The real clock, scoped to one company, with no wake and no heartbeat. */
  const clockFor = (org) => tick({
    db, env: {},
    deps: {
      readSettings: mine(org),
      followLateDrafts: async () => [],
      machineOrgIds: async () => [],
      beat: async () => 0,
      wake: async () => ({ ok: true, started: false, skipped: "test" }),
      log: () => {}
    }
  });

  before(async () => {
    await cleanup();
    const sched = scheduleTwoHoursOut();
    orgW = await mkOrg("weekly", { enabled: true, ...sched, scripts_per_day: 1, days_per_batch: 3 });
    orgC = await mkOrg("now", {});
    orgOff = await mkOrg("off", { enabled: false, ...sched });
  });

  after(async () => {
    try { await cleanup(); } finally {
      await closeRlsPool();
      await close();
    }
  });

  // ── the clock ──────────────────────────────────────────────────────────────

  test("the clock firing twice (and two at once) makes one weekly batch and one start_batch", async () => {
    const first = await clockFor(orgW);
    assert.equal(first.batch[0].batch, "on");
    assert.equal(first.batch[0].error, undefined, first.batch[0].note);
    const again = await clockFor(orgW);
    const [s] = await mine(orgW)();
    await Promise.all([weeklyTick(db, { settings: s, now: new Date() }), weeklyTick(db, { settings: s, now: new Date() })]);

    const rows = (await db.query(`SELECT * FROM marketing_batches WHERE org_id = $1`, [orgW])).rows;
    assert.equal(rows.length, 1, "one weekly batch");
    weekly = rows[0];
    assert.equal(weekly.kind, "weekly");
    assert.equal(weekly.status, "planned");
    assert.match(weekly.week_key, /^[0-9]{4}-W[0-9]{2}$/);
    const ms = new Date(weekly.release_at).getTime() - Date.now();
    assert.ok(ms > HOUR && ms <= 2 * HOUR, `release_at is about 2 hours out (${ms} ms)`);

    assert.equal((await jobs(orgW, "start_batch")).length, 1, "one start_batch");
    assert.equal((await jobs(orgW, "voice_export")).length, 1, "one voice export this week");
    assert.equal((await jobs(orgW, "nightly_script_check")).length, 1, "one nightly check tonight");
    assert.equal((await jobs(orgW, "expire_drafts")).length, 1, "one expiry run tonight");
    assert.ok(first.batch[0].planned >= 4, JSON.stringify(first.batch));
    assert.equal(again.batch[0].planned, 0, "the second tick queues nothing");
  });

  test("with enabled false the clock makes no batch and queues nothing for the weekly batch", async () => {
    const out = await clockFor(orgOff);
    assert.deepEqual(out.batch.map((b) => [b.batch, b.planned]), [["disabled", 0]]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_batches WHERE org_id = $1`, [orgOff])).rows[0].n, 0);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [orgOff])).rows[0].n, 0);
  });

  // ── plan, write, count ─────────────────────────────────────────────────────

  let slotJobs;

  test("start_batch plans the week: one write_slot per slot, one finish_batch, status writing", async () => {
    const [job] = await jobs(orgW, "start_batch");
    const out = await runJob(job);
    assert.equal(out.status, "writing", JSON.stringify(out));
    assert.equal(out.slots, 3);
    assert.equal(out.rules_sha, null, "no GitHub token here: no pinned commit");
    const b = await batchRow(weekly.id);
    assert.equal(b.status, "writing");
    assert.equal(b.total, 3);
    assert.equal(b.plan.slots.length, 3);
    assert.ok(b.plan.slots.every((s) => s.reason && s.funnel_key === "roadmap_147"));
    slotJobs = await jobs(orgW, "write_slot");
    assert.equal(slotJobs.length, 3);
    assert.ok(slotJobs.every((j) => j.payload.batch_id === weekly.id && j.payload.slot && j.payload.slot.n));
    assert.equal((await jobs(orgW, "finish_batch")).length, 1);
    assert.equal((await jobs(orgW, "start_batch", "done")).length, 1);
  });

  test("finish_batch waits (re-queued, no attempt counted) while slots are still being written", async () => {
    const [fin] = await jobs(orgW, "finish_batch");
    const out = await runJob(fin);
    assert.deepEqual(out, { wait: true, open: 3 });
    const row = (await db.query(`SELECT status, attempts, run_after FROM marketing_jobs WHERE id = $1`, [fin.id])).rows[0];
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
    assert.ok(new Date(row.run_after).getTime() > Date.now(), "it comes back later");
  });

  test("two slots are written; the third fails (the model is down)", async () => {
    const hosts = [];
    for (const [i, job] of slotJobs.entries()) {
      const ai = fakeAnthropic(i < 2 ? [DRAFTS[i]] : [{ status: 500 }]);
      const out = await runJob(job, { fetchImpl: ai.fetchImpl });
      hosts.push(...ai.calls.map((c) => c.host));
      if (i < 2) assert.ok(out.script_id && out.flagged === false, JSON.stringify(out));
      else assert.ok(out.threw, JSON.stringify(out));
    }
    assert.ok(hosts.length >= 3 && hosts.every((h) => h === "api.anthropic.com"), hosts.join(","));
    assert.equal((await jobs(orgW, "write_slot", "done")).length, 2);
    assert.equal((await jobs(orgW, "write_slot", "failed")).length, 1);
  });

  test("finish_batch counts: 2 of 3 ready, 1 failed → 'ready'; release_batch waits for release_at", async () => {
    const [fin] = await jobs(orgW, "finish_batch");
    const out = await runJob(fin);
    assert.equal(out.status, "ready", JSON.stringify(out));
    assert.deepEqual(out.counts, { total: 3, ready: 2, flagged: 0, failed: 1 });
    const b = await batchRow(weekly.id);
    assert.deepEqual([b.status, b.ready, b.flagged, b.failed], ["ready", 2, 0, 1]);
    const [rel] = await jobs(orgW, "release_batch");
    assert.ok(rel, "release_batch is queued");
    assert.equal(new Date(rel.run_after).getTime(), new Date(b.release_at).getTime(), "for release_at");
  });

  // ── release ────────────────────────────────────────────────────────────────

  test("nothing appears before release_at: no visible draft, no file, no buzz", async () => {
    assert.equal((await visible(orgW)).length, 0);
    const early = await releaseBatch(db, ENV, { orgId: orgW, batchId: weekly.id }, { pool: rlsPool });
    assert.deepEqual(early, { released: false });
    assert.equal((await outbox(orgW)).length, 0, "no repo file before release");
    assert.equal((await buzzes(orgW)).length, 0);
    assert.equal((await batchRow(weekly.id)).status, "ready");
  });

  test("at release_at: released, one replace row per draft, ONE buzz with the real counts", async () => {
    await db.query(`UPDATE marketing_batches SET release_at = now() - interval '1 minute' WHERE id = $1`, [weekly.id]);
    const [rel] = await jobs(orgW, "release_batch");
    const out = await runJob(rel);
    assert.equal(out.released, true, JSON.stringify(out));
    assert.equal(out.files, 2);
    assert.equal(out.buzzed, true);

    const b = await batchRow(weekly.id);
    assert.equal(b.status, "released");
    assert.ok(b.released_at);
    const rows = await outbox(orgW);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.mode, "replace");
      assert.ok(r.path.startsWith(`marketing/ads/scripts/machine/${weekly.week_key}/`), r.path);
      assert.equal(parseScript(r.content).batch, weekly.week_key);
    }
    const bz = await buzzes(orgW);
    assert.equal(bz.length, 1);
    assert.equal(bz[0].kind, "scripts_ready");
    assert.equal(bz[0].body, "Scripts: 2 of 3 ready, 1 failed.");
    assert.equal((await visible(orgW)).length, 2, "the drafts appear at once");

    // Release again, and the clock twice more: still one batch, two files, one buzz.
    assert.deepEqual(await releaseBatch(db, ENV, { orgId: orgW, batchId: weekly.id }, { pool: rlsPool }), { released: false });
    await clockFor(orgW);
    await clockFor(orgW);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_batches WHERE org_id = $1`, [orgW])).rows[0].n, 1);
    assert.equal((await outbox(orgW)).length, 2);
    assert.equal((await buzzes(orgW)).length, 1);
  });

  test("a draft that finishes late (Retry on the failed slot) appears with its file and no second buzz", async () => {
    const [failed] = await jobs(orgW, "write_slot", "failed");
    assert.ok(await retryJob(db, { orgId: orgW, id: failed.id, kinds: ["write_slot"] }));
    const ai = fakeAnthropic([DRAFTS[2]]);
    const wrote = await runJob(failed, { fetchImpl: ai.fetchImpl });
    assert.ok(wrote.script_id && wrote.flagged === false, JSON.stringify(wrote));

    const late = (await followLateDrafts(db)).filter((x) => x.org_id === orgW);
    assert.deepEqual(late, [{ org_id: orgW, batch_id: weekly.id }]);
    const [fin] = await jobs(orgW, "finish_batch");
    assert.equal(fin.payload.late, true);
    const out = await runJob(fin);
    assert.equal(out.status, "released");
    assert.deepEqual(out.counts, { total: 3, ready: 3, flagged: 0, failed: 0 });
    assert.equal(out.late_files, 1);
    assert.equal((await outbox(orgW)).length, 3, "the late draft's file");
    assert.equal((await buzzes(orgW)).length, 1, "no second buzz");
    assert.equal((await visible(orgW)).length, 3);
    assert.deepEqual((await followLateDrafts(db)).filter((x) => x.org_id === orgW), [], "followed up once");
  });

  // ── Write now ──────────────────────────────────────────────────────────────

  let nowBatch;

  test("Write now with 3: three drafts, each strict-clean with its own angle, hook and CTA, parts and a valid animation plan", async () => {
    const settings = await getOrCreateSettings(db, orgC);
    const started = await asStaff((tx) => startWriteNow(tx, orgC, { settings, count: 3 }), { pool: rlsPool });
    nowBatch = started.batch;
    assert.equal(nowBatch.kind, "on_command");
    const [start] = await jobs(orgC, "start_batch");
    const planned = await runJob(start);
    assert.equal(planned.slots, 3, JSON.stringify(planned));

    const hosts = [];
    const ids = [];
    for (const [i, job] of (await jobs(orgC, "write_slot")).entries()) {
      const ai = fakeAnthropic([DRAFTS[i]]);
      const out = await runJob(job, { fetchImpl: ai.fetchImpl });
      hosts.push(...ai.calls.map((c) => c.host));
      assert.ok(out.script_id, JSON.stringify(out));
      ids.push(out.script_id);
    }
    assert.ok(hosts.every((h) => h === "api.anthropic.com"), `only Anthropic is called: ${hosts.join(",")}`);

    const rows = (await db.query(
      `SELECT * FROM ad_scripts WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [ids])).rows;
    assert.equal(rows.length, 3);
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "marketing/broll/catalog.json"), "utf8"));
    for (const r of rows) {
      assert.equal(r.status, "draft");
      assert.equal(r.source, "machine");
      assert.equal(r.batch_id, nowBatch.id);
      assert.equal(r.check_results.flagged, false, JSON.stringify(r.check_results.flag_reasons));
      assert.equal(r.check_results.strict.passed, true, "strict-clean");
      const kinds = r.parts.map((p) => p.kind);
      for (const k of ["hook", "line2", "cue", "reveal", "cta"]) assert.ok(kinds.includes(k), `parts has ${k}`);
      const anim = validateAnimationPlan(r.animation_plan, { catalog, body: r.body, parts: r.parts, style: r.style, scriptFormat: r.script_format });
      assert.equal(anim.ok, true, JSON.stringify(anim.errors));
    }
    assert.equal(new Set(rows.map((r) => r.angle_key)).size, 3, `own angle each: ${rows.map((r) => r.angle_key)}`);
    assert.ok(rows.every((r) => r.angle_key), "every draft has an angle");
    assert.equal(new Set(rows.map((r) => r.hook_key)).size, 3);
    assert.equal(new Set(rows.map((r) => hookOf(r))).size, 3, "own hook each");
    assert.equal(new Set(rows.map((r) => ctaOf(r))).size, 3, "own CTA each");
  });

  test("Write now releases as soon as it is done, and does not buzz while Chris is on the page", async () => {
    await db.query(
      `INSERT INTO marketing_heartbeats (org_id, name, last_at, detail) VALUES ($1, 'page_seen', now(), '{}'::jsonb)
       ON CONFLICT (org_id, name) DO UPDATE SET last_at = now()`, [orgC]);
    const [fin] = await jobs(orgC, "finish_batch");
    const counted = await runJob(fin);
    assert.equal(counted.status, "ready");
    const [rel] = await jobs(orgC, "release_batch");
    assert.ok(new Date(rel.run_after).getTime() <= Date.now() + 1000, "due now, not later");
    const out = await runJob(rel);
    assert.equal(out.released, true);
    assert.equal(out.buzzed, false, "Chris is on the page");
    assert.equal(out.files, 3);
    assert.equal((await buzzes(orgC)).length, 0);
    assert.equal((await visible(orgC)).length, 3);
  });

  test("a Write now batch buzzes when the page_seen heartbeat is older than 2 minutes", async () => {
    const mk = async () => (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at, total, ready, flagged, failed)
       VALUES ($1, 'on_command', '2026-W42', 'ready', now(), 1, 1, 0, 0) RETURNING id`, [orgC])).rows[0].id;
    await db.query(`UPDATE marketing_heartbeats SET last_at = now() - interval '3 minutes' WHERE org_id = $1 AND name = 'page_seen'`, [orgC]);
    const away = await releaseBatch(db, ENV, { orgId: orgC, batchId: await mk() }, { pool: rlsPool });
    assert.equal(away.buzzed, true);
    let bz = await buzzes(orgC);
    assert.equal(bz.length, 1);
    assert.equal(bz[0].body, "Scripts: 1 of 1 ready, 0 failed.");

    await db.query(`UPDATE marketing_heartbeats SET last_at = now() - interval '90 seconds' WHERE org_id = $1 AND name = 'page_seen'`, [orgC]);
    const here = await releaseBatch(db, ENV, { orgId: orgC, batchId: await mk() }, { pool: rlsPool });
    assert.equal(here.buzzed, false);
    bz = await buzzes(orgC);
    assert.equal(bz.length, 1, "still one buzz");
  });

  // ── expiry ─────────────────────────────────────────────────────────────────

  test("expiry: machine drafts of a batch released more than 14 days ago, never imports or Chris's version", async () => {
    await db.query(
      `UPDATE marketing_batches SET released_at = now() - interval '15 days', release_at = now() - interval '15 days' WHERE id = $1`,
      [weekly.id]);
    const live = (await db.query(
      `SELECT id FROM ad_scripts WHERE batch_id = $1 AND archived_at IS NULL ORDER BY created_at`, [weekly.id])).rows;
    assert.equal(live.length, 3);
    await db.query(`UPDATE ad_scripts SET source = 'chris' WHERE id = $1`, [live[0].id]);
    const house = (await db.query(`SELECT id FROM partners WHERE org_id = $1`, [orgW])).rows[0].id;
    const imported = (await db.query(
      `INSERT INTO ad_scripts (org_id, partner_id, version, title, body, status, source, batch_id)
       VALUES ($1, $2, 1, 'An old import', 'An imported body that predates the machine.', 'draft', 'import', $3) RETURNING id`,
      [orgW, house, weekly.id])).rows[0].id;

    const [job] = await jobs(orgW, "expire_drafts");
    const out = await runJob(job);
    assert.deepEqual(out, { expired: 2, days: 14 });
    const status = async (id) => (await db.query(`SELECT status FROM ad_scripts WHERE id = $1`, [id])).rows[0].status;
    assert.equal(await status(live[0].id), "draft", "Chris's version stays");
    assert.equal(await status(live[1].id), "expired");
    assert.equal(await status(live[2].id), "expired");
    assert.equal(await status(imported), "draft", "an import is never expired");
    const files = (await outbox(orgW)).filter((r) => r.op_id.startsWith("u35:expire:"));
    assert.equal(files.length, 2);
    assert.ok(files.every((f) => parseScript(f.content).status === "expired"));
    assert.ok((await visible(orgC)).every((s) => s.status === "draft"), "a batch released today is untouched");

    const again = await runJob(await enqueueJob(db, { orgId: orgW, kind: "expire_drafts", payload: { day: "again" } }));
    assert.equal(again.expired, 0);
  });

  // ── voice export ───────────────────────────────────────────────────────────

  test("the voice export runs once per pair", async () => {
    const [s1, s2] = await visible(orgC);
    await db.query(
      `INSERT INTO voice_pairs (org_id, script_id, "before", "after", kind) VALUES
         ($1, $2, 'Lenders read two files before they say yes.', 'Lenders look at two files first.', 'hook'),
         ($1, $2, 'Your personal file shows every card balance', 'Your own file shows each card', 'cue'),
         ($1, $3, 'Plan the order first, then apply', 'Plan the order, then apply', 'reveal')`,
      [orgC, s1.id, s2.id]);
    const first = await runJob(await enqueueJob(db, { orgId: orgC, kind: "voice_export", payload: { week_key: "2026-W42" } }));
    assert.equal(first.exported, 3);
    const edits = (await outbox(orgC)).filter((r) => r.path === "marketing/ads/VOICE.md");
    assert.equal(edits.length, 1);
    assert.equal(edits[0].mode, "edit");
    assert.equal(edits[0].edit.op, "voice_append_pairs");
    assert.equal(edits[0].edit.pairs.length, 3);
    assert.ok(edits[0].edit.pairs.every((p) => p.lane === "uwiq"), "each pair carries its script's lane");
    const left = (await db.query(`SELECT count(*)::int AS n FROM voice_pairs WHERE org_id = $1 AND exported_at IS NULL`, [orgC])).rows[0].n;
    assert.equal(left, 0);

    const second = await runJob(await enqueueJob(db, { orgId: orgC, kind: "voice_export", payload: { week_key: "2026-W43" } }));
    assert.equal(second.exported, 0);
    assert.equal((await outbox(orgC)).filter((r) => r.path === "marketing/ads/VOICE.md").length, 1, "no pair twice");
  });

  // ── the nightly check ──────────────────────────────────────────────────────

  test("the nightly check queues a replace row only where the file's body differs from the database", async () => {
    await db.query(
      `UPDATE repo_outbox SET committed_sha = repeat('a', 40), committed_at = now(), claimed_at = NULL, claim_id = NULL
        WHERE org_id = $1 AND committed_sha IS NULL`, [orgC]);
    const scripts = (await visible(orgC)).sort((a, b) => String(a.repo_path).localeCompare(String(b.repo_path)));
    assert.equal(scripts.length, 3);
    const committed = new Map((await outbox(orgC)).filter((r) => r.mode === "replace").map((r) => [r.path, r.content]));
    const [same, edited, gone] = scripts;
    const handEdited = committed.get(edited.repo_path).replace(edited.body, `${edited.body}\n\nA line someone typed into GitHub.`);
    const folder = same.repo_path.slice(0, same.repo_path.lastIndexOf("/"));
    const lists = [];
    const reads = [];
    const deps = {
      listFolder: async (f) => {
        lists.push(f);
        return { ok: true, entries: [
          { name: "a", path: same.repo_path, type: "file", sha: gitBlobSha(committed.get(same.repo_path)) },
          { name: "b", path: edited.repo_path, type: "file", sha: gitBlobSha(handEdited) }
        ] };
      },
      getContents: async (p) => { reads.push(p); return { ok: true, content: p === edited.repo_path ? handEdited : null }; }
    };
    const job = await enqueueJob(db, { orgId: orgC, kind: "nightly_script_check", payload: { day: "2026-10-12" } });
    const out = await runJob(job, deps);
    assert.deepEqual(lists, [folder], "the folder is listed once");
    assert.deepEqual(reads, [edited.repo_path], "only the file the app does not recognise is read");
    assert.deepEqual(
      { checked: out.checked, ok: out.ok, mismatched: out.mismatched, missing: out.missing, queued: out.queued },
      { checked: 3, ok: 1, mismatched: 1, missing: 1, queued: 2 }, JSON.stringify(out));
    const fixes = (await outbox(orgC)).filter((r) => r.op_id.startsWith("u35:nightly:"));
    assert.deepEqual(fixes.map((r) => r.path).sort(), [edited.repo_path, gone.repo_path].sort());
    for (const f of fixes) {
      assert.equal(f.mode, "replace");
      const s = scripts.find((x) => x.repo_path === f.path);
      assert.equal(parseScript(f.content).body, s.body, "the database wins");
    }

    // The same night again: those two saves are on their way, the third still matches.
    const again = await runJob(await enqueueJob(db, { orgId: orgC, kind: "nightly_script_check", payload: { day: "2026-10-12b" } }), deps);
    assert.equal(again.queued, 0, JSON.stringify(again));
    assert.equal(again.waiting, 2);
  });
});
