// Flywheel steps 4 (copy) and 5 (ad strategy) run end to end on the worker's
// saved-step runner, with a stand-in model and a stand-in database: every call
// forced to Claude and logged, the checker run in code before anything is
// saved, the targeting screen run in code, hand-back under the worker cap and
// resume, the cap stop, and the stamped file queued for the repo. Unit X3.
// The same handler against real Postgres: src/http/marketing-flywheel.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as runStageJob } from "./stage-job.mjs";
import { ANGLES_SCHEMA, PIECE_SCHEMA } from "./copy-stage.mjs";
import { PLAN_SCHEMA, screenPlan } from "./strategy-stage.mjs";
import { stampStage, hashOf, parseFrontMatter, splitFrontMatter } from "./stamp.mjs";
import { evaluateFiles } from "../../../scripts/flywheel/status.mjs";
import { JOB_KINDS, checkJobKinds } from "../job-kinds.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ORG = "11111111-1111-4111-8111-111111111111";
const SHA = "f".repeat(40);
const CARD = "\n## Review card\n\n**What this decided:** x\n";

function campaignFiles() {
  const avatar = stampStage({ stage: 1, version: 1, status: "approved", counts: { quotes: 30, languageEntries: 120 }, body: `# Buyer\nBrokers who lost a deal.${CARD}` });
  const research = stampStage({ stage: 2, version: 1, status: "approved", inputs: { "01-avatar.md": hashOf(avatar) },
    counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 6 }, body: `# Market${CARD}` });
  const offer = stampStage({ stage: 3, version: 1, status: "approved",
    inputs: { "01-avatar.md": hashOf(avatar), "02-ad-research.md": hashOf(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
    body: `# Capital Blueprint offer\nThe program is $5,000. A plan in 30 days.${CARD}` });
  return {
    "00-OWNER-NOTES.md": "# n\nOffer key: UWIQ_DELIVERABLES\n\n## Notes\n\n2026-10-01 | stage 4 | say the price out loud\n2026-10-01 | stage 2 | not for step 4\n",
    "01-avatar.md": avatar,
    "01-avatar/Market_Language_Bank.md": "# Bank\n- my file got declined\n",
    "02-ad-research.md": research,
    "03-offer.md": offer
  };
}

function readerDeps(files) {
  return {
    getRef: async () => ({ ok: true, sha: SHA }),
    listFolder: async () => ({ ok: true, entries: [{ name: "capital-blueprint", type: "dir" }] }),
    getContents: async (p) => {
      if (!p.startsWith("marketing/flywheel/capital-blueprint/")) {
        // Any other repo file: what GitHub would hold, which is this checkout.
        try { return { ok: true, content: fs.readFileSync(path.join(ROOT, p), "utf8") }; } catch { return { ok: true, missing: true, content: null }; }
      }
      const name = p.replace("marketing/flywheel/capital-blueprint/", "");
      return files[name] == null ? { ok: true, missing: true, content: null } : { ok: true, content: files[name] };
    },
    pendingRows: async () => []
  };
}

/** A database stand-in that answers only the statements the runner makes. */
function fakeDb() {
  const st = { result: null, resume: null, outbox: [], spent: 0 };
  return {
    st,
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes("UPDATE marketing_jobs SET result")) { st.result = JSON.parse(params[1]); return { rows: [], rowCount: 1 }; }
      if (s.includes("SET payload = payload ||")) { st.resume = JSON.parse(params[1]); return { rows: [] }; }
      if (s.includes("FROM marketing_model_usage WHERE job_id")) {
        return { rows: [{ priced: st.spent, null_in: 0, null_out: 0, unpriced: 0 }] };
      }
      if (s.includes("INSERT INTO repo_outbox")) {
        st.outbox.push({ op_id: params[1], path: params[2], mode: params[3], content: params[4] });
        return { rows: [{ id: st.outbox.length, op_id: params[1], path: params[2], mode: params[3] }] };
      }
      throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
    }
  };
}

/* ── the stand-in model ────────────────────────────────────────────────── */

const WORDS = ["amber", "birch", "cedar", "dune", "ember", "fjord"];
const angle = (i) => ({ angleId: `reason-${WORDS[i]}`, theReason: `reason ${i}`, audience: "in-market", hookType: "circumstance",
  theSpecificPain: `pain ${i}`, whyItIsDifferent: `only ${i}`, ownClosingIdea: `close ${i}` });

function fakeModel({ dirty = {} } = {}) {
  const calls = [];
  const call = async (args) => {
    calls.push(args);
    const usage = { input_tokens: 1000, output_tokens: 200 };
    const reply = (json, text = null) => ({ mode: "live", json, text: text ?? JSON.stringify(json), error: null, usage, servedModel: args.model, stopReason: "end_turn" });
    const u = String(args.user);
    if (args.outputSchema === ANGLES_SCHEMA) return reply({ angles: WORDS.map((_, i) => angle(i)), fewerThanAskedBecause: "the offer supports six" });
    if (args.outputSchema === PIECE_SCHEMA) {
      const id = /YOUR REASON \(([^)]+)\)/.exec(u)[1];
      const w = id.replace("reason-", "");
      const hook = dirty[id] === "always" ? `We ${w} it — fast, for $5,000.` : dirty[id] ? `We leverage ${w} for $5,000.` : `Your ${w} file was read wrong, and $5,000 fixes that.`;
      return reply({
        pieces: ["short", "mid", "long"].map((length) => ({ length, hook, body: `The ${w} lender looked twice. It took 30 days.`, cta: `Ask about the ${w} ${length} ${w}stone ${w}field review` })),
        emailSubjects: [`${w} and $5,000`, `${w} in 30 days`, `the ${w} file`]
      });
    }
    if (/Attack this copy/.test(u)) return reply({ findings: [] });
    if (/Rewrite this copy/.test(u)) {
      const w = (/The (\w+) lender/.exec(u) || [])[1] || "plain";
      const still = dirty[`reason-${w}`] === "always";
      return reply({
        hook: still ? `Still — ${w} for $5,000.` : `We read the ${w} file again for $5,000.`,
        body: `The ${w} lender looked twice. It took 30 days.`,
        cta: `Ask about the ${w} rewrite ${w}stone ${w}field review`
      });
    }
    if (/PROMISE VERSUS TERMS|HUMAN VOICE|SAMENESS/.test(u)) return reply({ issues: /SAMENESS/.test(u) ? ["two hooks start the same way"] : [] });
    if (/Write the copy document/.test(u)) return reply(null, "# Doc — by the writer\nAs of x\n\n## 1. Hooks\nhook one\n\n## Review card\n\n**What this decided:** run three hooks.\n");
    // strategy
    if (/Read the real operating numbers/.test(u)) {
      return reply({ dailyBudget: "$200 (ops/workflows/ads-waterfall-projections-2026-08-26.md)", costPerBookedCall: "unknown", closeRate: "unknown", cashPerBookedCall: "unknown", sourceFiles: ["x"], missingFiles: ["ops/workflows/ads-revenue-model-2026-08-24.md"], notes: "n" });
    }
    if (args.outputSchema === PLAN_SCHEMA) {
      const next = /next step up/.test(u);
      return reply({ strategyName: "The Forester", whyThisOne: "thin library", dailyBudget: next ? "$500" : "$200", campaignStructure: "one bin",
        adSets: [{ name: "bin 1", audience: "cold", creativeIds: ["REASON-AMBER-SHORT"], dailyBudget: "$15" }],
        targetingJson: next ? JSON.stringify({ age_min: 25, age_max: 65 }) : JSON.stringify({ age_min: 18, age_max: 65, geo_locations: { countries: ["US"] } }),
        creativeNeeded: 6, rotationRule: "weekly", whenToScale: "after 3 sales", whenToStop: "no leads in 7 days", assumptions: ["ASSUMPTION: x"] });
    }
    if (/WILL META ACCEPT THIS|BUDGET REALISM|CREATIVE SUPPLY/.test(u)) {
      return reply({ issues: /WILL META/.test(u) ? ["the 2.5x plan narrows the age range"] : [], verdicts: [{ tactic: "age 25+", verdict: "rejected", substitute: "18-65" }], ok: !/WILL META/.test(u) });
    }
    if (/Fix these problems/.test(u)) return reply(null, "Plan 1: The Forester at $200 a day. Plan 2: ages 18 to 65.");
    if (/Write the ad strategy document/.test(u)) return reply(null, "# Strategy\n\nRun the Forester.\n\n## Review card\n\n**What this decided:** the Forester at $200.\n");
    throw new Error(`the stand-in model got a prompt it does not know: ${u.slice(0, 80)}`);
  };
  return { call, calls };
}

function ctxFor(db, model, files, extra = {}) {
  const logged = [];
  return {
    logged,
    ctx: {
      db,
      env: { ANTHROPIC_API_KEY: "sk-ant-test", GITHUB_REPO_TOKEN: "test-token" },
      deps: {
        call: async (a) => { const out = await model.call(a); return out; },
        logUsage: async (_db, row) => { logged.push(row); db.st.spent += 0.01; },
        caps: { runCapUsd: 40, monthCapUsd: 300 },
        monthUsd: async () => 0,
        requeue: async () => { db.st.requeued = (db.st.requeued || 0) + 1; },
        reader: readerDeps(files),
        readTotals: async () => ({ spend_cents: 600000, leads: 12, booked: 3, sales: 1, cash_cents: 500000 }),
        ...extra
      }
    }
  };
}

const job = (stage, over = {}) => ({ id: `job-${stage}`, org_id: ORG, kind: "flywheel_stage", status: "running",
  payload: { campaign: "capital-blueprint", stage, today: "2026-10-06" }, result: null, ...over });

describe("the registry", () => {
  test("flywheel_stage is a writer kind whose handler loads and exports run()", async () => {
    assert.equal(JOB_KINDS.flywheel_stage.group, "writer");
    assert.deepEqual(await checkJobKinds({ flywheel_stage: JOB_KINDS.flywheel_stage }), []);
  });

  test("a stage with no runner, or no campaign, fails at once with a plain reason", async () => {
    await assert.rejects(runStageJob({ ...job(1) }, { db: fakeDb() }), (e) => e.final === true && /does not run on the server yet/.test(e.message));
    await assert.rejects(runStageJob({ ...job(4), payload: { stage: 4, campaign: "../x" } }, { db: fakeDb() }), (e) => e.final === true && /no campaign folder/.test(e.message));
  });
});

describe("step 4, the copy", () => {
  test("runs every phase, checks in code, drops what stays dirty, saves a stamped 04-copy.md", async () => {
    const db = fakeDb();
    const model = fakeModel({ dirty: { "reason-birch": true, "reason-cedar": "always" } });
    const { ctx, logged } = ctxFor(db, model, campaignFiles());
    const out = await runStageJob(job(4), ctx);

    // Every call forced to Claude with an explicit model and a token limit, and logged.
    assert.ok(model.calls.length > 10);
    for (const c of model.calls) {
      assert.equal(c.provider, "anthropic");
      assert.match(c.model, /^claude-(opus|sonnet)-5-5$/);
      assert.ok(Number.isInteger(c.maxTokens) && c.maxTokens > 600);
      assert.ok(c.timeoutMs <= 270_000);
    }
    assert.equal(logged.length, model.calls.length, "one ledger row per call");
    assert.ok(logged.every((r) => r.jobId === "job-4" && r.orgId === ORG));
    const opus = model.calls.filter((c) => c.model === "claude-opus-5-5").map((c) => (/Decide the messaging|Write the copy document/.exec(c.user) || [""])[0]);
    assert.deepEqual(opus, ["Decide the messaging", "Write the copy document"], "Opus plans and writes the document; Sonnet does the rest");

    // The owner notes for stage 4 (and only those) reached the writer.
    const anglesCall = model.calls.find((c) => c.outputSchema === ANGLES_SCHEMA);
    assert.match(anglesCall.user, /say the price out loud/);
    assert.ok(!anglesCall.user.includes("not for step 4"));

    // The checker ran in code: the birch pieces were cleaned, the cedar pieces dropped.
    assert.ok(out.pieces.every((p) => !/—|leverage/i.test(`${p.hook} ${p.body} ${p.cta}`)), "nothing dirty reaches Chris");
    assert.ok(out.pieces.some((p) => p.angleId === "reason-birch" && p.humanizePasses === 1));
    const cedar = out.dropped.filter((p) => p.angleId === "reason-cedar" && p.length !== "subject");
    assert.equal(cedar.length, 3);
    assert.ok(cedar.every((p) => /still had AI tells after 3 passes/.test(p.reason)));
    assert.deepEqual(out.issues, ["two hooks start the same way"]);

    // Saved once, through the outbox, stamped so npm run flywheel:status reads it.
    assert.equal(db.st.outbox.length, 1);
    const saved = db.st.outbox[0];
    assert.equal(saved.path, "marketing/flywheel/capital-blueprint/04-copy.md");
    assert.equal(saved.mode, "replace");
    assert.equal(saved.op_id, "flywheel:job-4:04-copy.md");
    const meta = parseFrontMatter(splitFrontMatter(saved.content).frontMatter);
    assert.equal(meta.stage, 4);
    assert.equal(meta.status, "draft");
    assert.equal(meta.version, 1);
    assert.equal(meta.counts.humanizerPassRun, 1);
    // copy.js counts a reason when any of its pieces survived, subject lines too:
    // cedar's ads were dropped but two of its subject lines passed.
    assert.equal(meta.counts.distinctReasons, 6);
    assert.equal(meta.counts.meetsAndromedaFloor, 0);
    assert.equal(meta.inputs["03-offer.md"], hashOf(campaignFiles()["03-offer.md"]));
    assert.match(saved.content, /\n# Capital Blueprint copy: what to run\nAs of 2026-10-06\n/);
    assert.ok(!saved.content.includes("—"), "no em dash in the saved file");
    assert.match(saved.content, /## Review card/);
    const files = { ...campaignFiles(), "04-copy.md": saved.content };
    const row4 = evaluateFiles((f) => files[f] ?? null)[3];
    assert.equal(row4.state, "FAILED", "below the floor of 15 reasons: the row says so, never padded");
    assert.match(row4.reasons.join(";"), /6 distinct reasons, below/);
    assert.equal(out.below_andromeda_floor, true);
    assert.equal(out.repo_path, saved.path);
  });

  test("hands the job back under the worker's cap and picks up at the saved step", async () => {
    const db = fakeDb();
    const model = fakeModel();
    let t = 0;
    const { ctx } = ctxFor(db, model, campaignFiles(), { now: () => (t += 61_000) });
    let j = job(4);
    let out;
    for (let i = 0; i < 30; i++) {
      out = await runStageJob(j, ctx);
      if (!out.handed_back) break;
      j = { ...j, result: db.st.result };
    }
    assert.ok(db.st.requeued > 1, "it was handed back more than once");
    assert.equal(out.stage, 4);
    assert.equal(db.st.outbox.length, 1);
    const angleCalls = model.calls.filter((c) => c.outputSchema === ANGLES_SCHEMA).length;
    assert.equal(angleCalls, 1, "a finished step is never paid for twice");
    assert.equal(model.calls.filter((c) => c.outputSchema === PIECE_SCHEMA).length, 6, "one write per reason");
  });

  test("stops at the run cap before the call, keeps its place, and says so in plain words", async () => {
    const db = fakeDb();
    const model = fakeModel();
    const { ctx } = ctxFor(db, model, campaignFiles(), { caps: { runCapUsd: 0.01, monthCapUsd: 300 } });
    await assert.rejects(runStageJob(job(4), ctx), (e) =>
      e.final === true && e.cap === true && /^Stopped at the \$0\.01 run cap while picking the reasons\. What it made so far is saved\./.test(e.message));
    assert.equal(model.calls.length, 0, "no call is made past the cap");
    assert.equal(db.st.result.stopped_at_cap, true);
    assert.equal(db.st.resume.progress.step, "angles", "the place is kept in the payload for Retry");
  });

  test("a retried run (result cleared by Retry) resumes from the payload copy", async () => {
    const db = fakeDb();
    const model = fakeModel();
    const { ctx } = ctxFor(db, model, campaignFiles());
    const first = fakeModel();
    const half = ctxFor(fakeDb(), first, campaignFiles());
    let t = 0;
    half.ctx.deps.now = () => (t += 70_000);
    const handed = await runStageJob(job(4), half.ctx);
    assert.equal(handed.handed_back, true);
    assert.equal(handed.at_step, "write", "handed back after the reasons were picked");
    const saved = half.ctx.db.st.result;
    const out = await runStageJob(job(4, { result: null, payload: { ...job(4).payload, resume: saved } }), ctx);
    assert.equal(out.stage, 4);
    assert.equal(model.calls.filter((c) => c.outputSchema === ANGLES_SCHEMA).length, 0, "the reasons were not bought again");
  });

  test("no offer on file stops at once with the reason", async () => {
    const files = campaignFiles();
    delete files["03-offer.md"];
    const { ctx } = ctxFor(fakeDb(), fakeModel(), files);
    await assert.rejects(runStageJob(job(4), ctx), (e) => e.final === true && /no offer on file for Capital Blueprint/.test(e.message));
  });
});

describe("step 5, the ad strategy", () => {
  test("grounds on saved numbers, screens targeting in code, repairs once, saves a stamped 05-ad-strategy.md", async () => {
    const db = fakeDb();
    const model = fakeModel();
    const files = campaignFiles();
    files["04-copy.md"] = stampStage({ stage: 4, version: 1,
      inputs: { "03-offer.md": hashOf(files["03-offer.md"]), "01-avatar/Market_Language_Bank.md": hashOf(files["01-avatar/Market_Language_Bank.md"]) },
      counts: { hooks: 12, humanizerPassRun: 1, distinctReasons: 15 }, body: `# Copy${CARD}` });
    const { ctx } = ctxFor(db, model, files);
    const out = await runStageJob(job(5), ctx);

    const ground = model.calls.find((c) => /Read the real operating numbers/.test(c.user));
    assert.match(ground.user, /ad spend: \$6000\.00 \(about \$200\.00 a day\)/);
    assert.match(ground.user, /Capital Blueprint \(UWIQ_DELIVERABLES\), list price \$5,000/);
    assert.match(ground.user, /FILE ops\/workflows\/ads-revenue-model-2026-08-24\.md: MISSING/);
    const plan = model.calls.find((c) => c.outputSchema === PLAN_SCHEMA);
    assert.match(plan.user, /CREATIVE THAT ACTUALLY EXISTS: 12 written ad pieces/);
    assert.match(plan.user, /WHAT THE REPO HOLDS OF THE AD STRATEGY DOCTRINE/);

    assert.equal(out.screens.length, 2);
    assert.equal(out.screens[0].ok, true);
    assert.equal(out.screens[1].ok, false, "the repo's own screen rejected the narrowed ages");
    assert.ok(out.issues.some((i) => /the targeting screen rejected it/.test(i)));
    assert.equal(out.targeting_accepted, false);
    assert.ok(model.calls.some((c) => /Fix these problems/.test(c.user)), "one repair");
    assert.deepEqual(out.missing_files, ["ops/workflows/ads-revenue-model-2026-08-24.md"]);

    assert.equal(db.st.outbox.length, 1);
    const saved = db.st.outbox[0];
    assert.equal(saved.path, "marketing/flywheel/capital-blueprint/05-ad-strategy.md");
    const meta = parseFrontMatter(splitFrontMatter(saved.content).frontMatter);
    assert.deepEqual(meta.counts, { strategyNamed: 1, dailyBudgetStated: 1, plansBuilt: 2, creativeAvailable: 12 });
    assert.equal(meta.inputs["04-copy.md"], hashOf(files["04-copy.md"]));
    const all = { ...files, "05-ad-strategy.md": saved.content };
    assert.equal(evaluateFiles((f) => all[f] ?? null)[4].state, "READY");
  });

  test("screenPlan: unreadable targeting is a rejection, never a pass", () => {
    assert.deepEqual(screenPlan({ strategyName: "x", targetingJson: "not json" }).ok, false);
    const ok = screenPlan({ strategyName: "x", targetingJson: JSON.stringify({ age_min: 18, age_max: 65 }) });
    assert.equal(ok.ok, true);
    const bad = screenPlan({ strategyName: "x", targetingJson: JSON.stringify({ age_min: 18, age_max: 65, zips: ["85001"] }) });
    assert.equal(bad.ok, false);
    assert.ok(bad.reasons.every((r) => typeof r === "string" && r.length > 10));
  });
});
