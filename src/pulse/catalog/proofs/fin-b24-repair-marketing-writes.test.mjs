// Batch 24, repair cycle 1: the flywheel's write doors, approve, start, run,
// tweak and read the spend.
//
// An independent checker found these stayed green when the product broke:
//   * approve: only step 3 of campaign "partner" was ever sent, so approving step
//     4 could edit the step 3 file, or any campaign could write into partner/.
//   * campaign: any folder name passed a pattern, and the owner-notes file was
//     only judged for its "Offer key:" line (a new flywheel could lose the
//     "## Notes" heading a tweak appends under).
//   * run: model spend was judged only for steps 4 and 5. Steps 1 and 2 had no
//     no-key or month-cap test, step 3's hand-off was judged on the avatar text
//     only, step 5's offer-approved rule was never tried, and the month cap used
//     the same dollars as the code's own fallback.
//   * tweak: only step 4 (and the blocked step 5) were judged. The offer hand-off,
//     the free spend read, step 2's reason, step 1's avatar hand-off and the
//     company and campaign on the notes path were not.
//   * spend-read: the campaign only changed a path that no test varied, the per-ad
//     rows beyond three fields and the unmatched-spend section were not judged.
//
// The real api/ handlers, the real one-transaction write wrapper, the real outbox
// and job queue code, and a stand-in database that keeps its own rows. The
// repo-file reader, the worker wake and the Write-the-offer door are handed in
// through the handlers' own seams. This is a PRACTICE TEST with fake data. It is
// not a live check.

import assert from "node:assert/strict";
import test, { mock } from "node:test";

import flywheelApprove from "../../../../api/marketing/flywheel/approve.mjs";
import flywheelCampaign from "../../../../api/marketing/flywheel/campaign.mjs";
import flywheelRun from "../../../../api/marketing/flywheel/run.mjs";
import flywheelSpendRead from "../../../../api/marketing/flywheel/spend-read.mjs";
import flywheelTweak from "../../../../api/marketing/flywheel/tweak.mjs";
import { hashOf, parseFrontMatter, splitFrontMatter, stampStage } from "../../../marketing/flywheel/stamp.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";
import { assertSqlHas } from "./fin-b24-repair-kit.mjs";

const NOW = new Date("2026-10-14T19:00:00.000Z"); // 12:00 on 14 October in Phoenix
const TODAY = "2026-10-14";
const STAFF_ID = "5a000000-0000-4000-8000-000000000001";
const keyName = ["ANTHROPIC", "API", "KEY"].join("_");
const FAKE_KEY = ["not", "a", "real", "model", "value"].join("-");

const NOTES = (offerKey = "PARTNER_ENTRY") => `# Owner notes\n\nOffer key: ${offerKey}\n\n## Notes\n2026-10-01 | stage 4 | an earlier line\n`;
const AVATAR = stampStage({ stage: 1, version: 1, status: "approved", counts: { quotes: 140, languageEntries: 120 }, body: "# Who we sell to\n\nThe owner.\n\n## Review card\n\nOK." });
const RESEARCH = stampStage({ stage: 2, version: 1, status: "approved", counts: { rowsVerified: 10, competitorsFound: 4, rowsWithFirstSeen: 8 }, body: "# The market\n\nMany sellers.\n\n## Review card\n\nOK." });
const OFFER = (status) => stampStage({
  stage: 3, version: 2, status, inputs: { "01-avatar.md": hashOf(AVATAR), "02-ad-research.md": hashOf(RESEARCH) },
  counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 }, body: "# The offer\n\nA clear price.\n\n## Review card\n\nOK.",
});
const BANK = "# Market language bank\n\nphrases the market uses\n";
const COPY = (status) => stampStage({
  stage: 4, version: 1, status, inputs: { "03-offer.md": hashOf(OFFER("approved")), "01-avatar/Market_Language_Bank.md": hashOf(BANK) },
  counts: { hooks: 6, humanizerPassRun: 1, distinctReasons: 16 }, body: "# Ad copy\n\nSix hooks.\n\n## Review card\n\nOK.",
});
const STAMPED = (n) => stampStage({ stage: n, version: 1, status: "draft", body: `# Step ${n}\n\nWords.\n\n## Review card\n\nOK.` });

/* One stand-in for the request ledger, the settings row, the cost ledger, the
   repo outbox and the job queue (avatar runs included), answering by each
   statement's own text. */
function world({ monthUsed = 0, settings = {}, jobs = [] } = {}) {
  const w = {
    requests: new Map(), outbox: [], jobs: [...jobs], wakes: 0,
    settings: { max_month_cost_usd: 300, max_batch_cost_usd: 40, scripts_per_day: 3, timezone: "America/Phoenix", run_caps: { avatar: 6 }, ...settings },
  };
  let n = 0;
  const id = (p) => `${p}0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const open = (kind, campaign) => w.jobs.find((j) => j.kind === kind && j.payload.campaign === campaign && ["queued", "running"].includes(j.status));
  w.rules = [
    [/pg_advisory_xact_lock/, []],
    [/SELECT org_id, route, response FROM marketing_requests WHERE request_id = \$1/, (_s, p) => (w.requests.has(p[0]) ? [w.requests.get(p[0])] : [])],
    [/INSERT INTO marketing_requests/, (_s, p) => { w.requests.set(p[0], { org_id: p[1], route: p[2], response: JSON.parse(p[3]) }); return []; }],
    [/INSERT INTO marketing_settings/, []],
    [/SELECT \* FROM marketing_settings WHERE org_id = \$1/, (_s, p) => [{ org_id: p[0], ...w.settings }]],
    [/SELECT max_batch_cost_usd, max_month_cost_usd FROM marketing_settings/, () => [w.settings]],
    [/WITH bounds AS/, [{ month_priced_usd: String(monthUsed), month_null_input: 0, month_null_output: 0, month_null_cache_read: 0, month_null_cache_write: 0, batch_priced_usd: 0, batch_null_input: 0, batch_null_output: 0, batch_null_cache_read: 0, batch_null_cache_write: 0, unpriced_rows: 0 }]],
    // The saved runs: a stage job and an avatar run, each only while the statement still says "open".
    [/SELECT \* FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'flywheel_stage'/, (sql, p) => {
      if (!/AND status IN \('queued', 'running'\)/.test(sql)) return [];
      return w.jobs.filter((j) => j.org_id === p[0] && j.kind === "flywheel_stage" && j.payload.campaign === p[1] && String(j.payload.stage) === p[2] && ["queued", "running"].includes(j.status)).slice(0, 1);
    }],
    [/INSERT INTO marketing_jobs \(org_id, kind, payload, run_after\)/, (_s, p) => {
      const row = { id: id("30"), org_id: p[0], kind: p[1], payload: JSON.parse(p[2]), status: "queued", created_at: NOW.toISOString() };
      w.jobs.push(row);
      return [row];
    }],
    [/INSERT INTO marketing_jobs \(org_id, kind, payload, requested_by\)\s+VALUES \(\$1, 'avatar'/, (sql, p) => {
      const payload = JSON.parse(p[1]);
      if (open("avatar", payload.campaign) && /ON CONFLICT/.test(sql)) return [];
      const row = { id: id("ab"), org_id: p[0], kind: "avatar", status: "queued", payload, requested_by: p[2], created_at: NOW.toISOString() };
      w.jobs.push(row);
      return [row];
    }],
    [/INSERT INTO marketing_jobs \(org_id, kind, payload, requested_by\)\s+VALUES \(\$1, 'flywheel_stage'/, (_s, p) => {
      const row = { id: id("ac"), org_id: p[0], kind: "flywheel_stage", status: "queued", payload: JSON.parse(p[1]), requested_by: p[2], created_at: NOW.toISOString() };
      w.jobs.push(row);
      return [row];
    }],
    [/SELECT \* FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'avatar' AND payload ->> 'campaign' = \$2\s+AND status IN/, (_s, p) => {
      const r = open("avatar", p[1]);
      return r ? [r] : [];
    }],
    [/SELECT \* FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'avatar' AND payload ->> 'campaign' = \$2\s+ORDER BY created_at DESC LIMIT 1/, (_s, p) =>
      w.jobs.filter((j) => j.kind === "avatar" && j.org_id === p[0] && j.payload.campaign === p[1]).slice(-1)],
    [/SELECT 1 FROM repo_outbox WHERE org_id = \$1 AND path LIKE \$2/, [{ "?column?": 1 }]],
    [/UPDATE marketing_jobs SET requested_by = \$2 WHERE id = \$1/, (_s, p) => { const j = w.jobs.find((x) => x.id === p[0]); if (j) j.requested_by = p[1]; return []; }],
    [/INSERT INTO repo_outbox/, (sql, p) => {
      const prev = w.outbox.find((o) => o.org_id === p[0] && o.op_id === p[1]);
      if (prev && /ON CONFLICT \(org_id, op_id\) DO NOTHING/.test(sql)) return [];
      const row = { id: w.outbox.length + 1, org_id: p[0], op_id: p[1], path: p[2], mode: p[3], content: p[4], edit: p[5] == null ? null : JSON.parse(p[5]) };
      w.outbox.push(row);
      return [{ id: row.id, op_id: row.op_id, path: row.path, mode: row.mode }];
    }],
    [/SELECT id, op_id, path, mode, content, edit FROM repo_outbox WHERE org_id = \$1 AND op_id = \$2/, (_s, p) => w.outbox.filter((o) => o.org_id === p[0] && o.op_id === p[1])],
  ];
  w.wake = async () => { w.wakes += 1; };
  return w;
}

function deps(w, { files = {}, campaigns = ["partner", "capital-blueprint"], env = { [keyName]: FAKE_KEY }, latestStageJobs = async () => ({}), extra = {} } = {}) {
  const reads = [];
  const map = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { text: v, source: "github" }]));
  const d = {
    env, wake: w.wake, now: () => NOW, roots: [], flywheelDir: () => null,
    readFlywheel: async (args) => { reads.push(args); return { campaigns, files: map, source: "github", fallback_reason: null, commit_sha: "abc1234" }; },
    latestStageJobs,
    ...extra,
  };
  d.reads = reads;
  return d;
}
const post = (handler, w, body, d, options = {}) => hit(handler, { method: "POST", role: "admin", body, rules: w.rules, deps: d, ...options });

const FILE_OF = { 1: "01-avatar.md", 2: "02-ad-research.md", 3: "03-offer.md", 4: "04-copy.md", 5: "05-ad-strategy.md", 6: "06-spend.md" };

/* ── approve ─────────────────────────────────────────────────────────────── */

test("marketing/flywheel/approve edits exactly the file of the step asked for, in the folder of the campaign asked for, and answers with that campaign, step and file", async () => {
  const files = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [FILE_OF[n], STAMPED(n)]));
  let press = 0;
  for (const campaign of ["partner", "capital-blueprint"]) {
    for (const stage of [1, 2, 3, 4, 5, 6]) {
      const w = world();
      const d = deps(w, { files });
      const done = await post(flywheelApprove, w, { request_id: `press-approve-${++press}-aa`, campaign, stage }, d);
      assert.equal(done.status, 200, `${campaign} step ${stage}: ${JSON.stringify(done.body)}`);
      assert.deepEqual(
        { campaign: done.body.campaign, stage: done.body.stage, file: done.body.file },
        { campaign, stage, file: FILE_OF[stage] },
        "the answer names the campaign, the step and its file",
      );
      assert.equal(w.outbox.length, 1);
      assert.equal(w.outbox[0].path, `marketing/flywheel/${campaign}/${FILE_OF[stage]}`, `${campaign} step ${stage}`);
      assert.equal(w.outbox[0].org_id, ORG_ID);
      assert.deepEqual(w.outbox[0].edit, { op: "set_front_matter_key", key: "status", value: "approved" });
      assert.deepEqual(d.reads.map((r) => [r.orgId, r.campaign]), [[ORG_ID, campaign]]);
    }
  }
});

/* ── campaign ────────────────────────────────────────────────────────────── */

test("marketing/flywheel/campaign makes the folder named for the offer and the owner-notes file the stage writers and a tweak read, line for line", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const cases = [
      ["UWIQ_DELIVERABLES", "capital-blueprint", "Capital Blueprint", "Capital Blueprint"],
      ["LIVE_TRIAL", "live-trial", "Live Trial — seven days under your brand", "Live Trial"],
      ["REPAIR_TRIAL", "repair-test-run", "Repair test run (first round, done for you)", "Repair test run"],
      ["WINNERS_BOARD", "winner-s-board", "Winner's Board", "Winner's Board"],
    ];
    let n = 0;
    for (const [key, folder, offerName, words] of cases) {
      const w = world();
      const d = deps(w, { campaigns: ["partner"] });
      const done = await post(flywheelCampaign, w, { request_id: `press-campaign-${++n}-aa`, key: key.toLowerCase() }, d);
      assert.equal(done.status, 201, JSON.stringify(done.body));
      assert.equal(done.body.campaign, folder, `${key} makes the folder ${folder}`);
      assert.equal(done.body.campaign_words, words);
      assert.equal(done.body.offer_key, key);
      assert.equal(done.body.repo_path, `marketing/flywheel/${folder}/00-OWNER-NOTES.md`);
      assert.equal(w.outbox.length, 1);
      assert.equal(w.outbox[0].path, `marketing/flywheel/${folder}/00-OWNER-NOTES.md`);
      assert.equal(w.outbox[0].op_id, `flywheel-campaign:${folder}`);
      assert.equal(w.outbox[0].mode, "replace");
      assert.equal(w.outbox[0].content, [
        `# Owner notes — ${folder} flywheel`,
        "",
        "Hand-authored. Agents **append one line, never rewrite**. Same rule as the",
        "intended journey files.",
        "",
        `Offer key: ${key}`,
        `Offer: ${offerName}`,
        `Started from the Command Center on ${TODAY}.`,
        "",
        "Every correction Chris makes to a stage goes here as one line, and it is fed",
        "back into that stage's prompt on every future re-run.",
        "",
        "Format:",
        "",
        "```",
        "YYYY-MM-DD | stage N | the correction, in one line",
        "```",
        "",
        "## Notes",
        "",
      ].join("\n"));
      assert.deepEqual(d.reads.map((r) => r.orgId), [ORG_ID], "the folders already there are read for the sign-in's company");
    }
    // A folder that already exists is not made again, and the answer still names it.
    const w = world();
    const d = deps(w, { campaigns: ["partner", "capital-blueprint"] });
    const again = await post(flywheelCampaign, w, { request_id: "press-campaign-again-aa", key: "UWIQ_DELIVERABLES" }, d);
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.campaign, "capital-blueprint");
    assert.equal(again.body.campaign_words, "Capital blueprint");
    assert.equal(again.body.repo_path, "marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md");
    assert.equal(w.outbox.length, 0);
    assert.deepEqual(d.reads.map((r) => r.orgId), [ORG_ID]);
  } finally {
    mock.timers.reset();
  }
});

/* ── run ─────────────────────────────────────────────────────────────────── */

test("marketing/flywheel/run refuses step 1 and step 2 with no model key or past the month cap in Settings, and saves nothing; with room it queues each for the campaign asked", async () => {
  const startBody = (stage, extra = {}) => ({ request_id: `press-s${stage}-${Math.random().toString(36).slice(2, 10)}`, campaign: "capital-blueprint", stage, ...extra });
  const step1 = { service_description: "White-label funding program" };
  const step2 = { market: "business funding", competitors: ["Acme Capital"] };
  for (const [stage, extra] of [[1, step1], [2, step2]]) {
    // No key, and a masked copy of a key, are not keys.
    for (const env of [{}, { [keyName]: "************abcd" }]) {
      const w = world();
      const out = await post(flywheelRun, w, startBody(stage, extra), deps(w, { env }));
      assert.equal(out.status, 503, `step ${stage}, env ${JSON.stringify(env)}`);
      assert.equal(out.body.error, "no_model");
      assert.equal(w.jobs.length, 0);
      assert.equal(w.wakes, 0);
    }
    // The month cap is the one in Settings (50), not the code's own fallback (300).
    const capped = world({ monthUsed: 60, settings: { max_month_cost_usd: 50 } });
    const stopped = await post(flywheelRun, capped, startBody(stage, extra), deps(capped));
    assert.ok([400, 409].includes(stopped.status), `step ${stage} past the cap: ${stopped.status} ${JSON.stringify(stopped.body)}`);
    assert.match(stopped.body.error, /cap/);
    assert.match(JSON.stringify(stopped.body), /\$50\b/, "the Settings cap is the one named");
    assert.equal(capped.jobs.length, 0, `step ${stage}: nothing queued`);
    assert.equal(capped.wakes, 0);
    // Under the cap in Settings (50) but over a smaller number: still goes.
    const room = world({ monthUsed: 40, settings: { max_month_cost_usd: 50 } });
    const go = await post(flywheelRun, room, startBody(stage, extra), deps(room));
    assert.equal(go.status, 202, `step ${stage} with room: ${JSON.stringify(go.body)}`);
    assert.equal(room.jobs.length, 1);
    assert.equal(room.jobs[0].payload.campaign, "capital-blueprint", "for the campaign asked, not partner");
    assert.equal(room.wakes, 1);
  }
  // Step 1's run cap is the avatar cap in Settings.
  const capSet = world({ settings: { run_caps: { avatar: 4 } } });
  await post(flywheelRun, capSet, startBody(1, step1), deps(capSet));
  assert.equal(capSet.jobs[0].payload.run_cap_usd, 4);
  assert.equal(capSet.jobs[0].requested_by, STAFF_ID);

  // A second press for a campaign whose avatar is already being made answers that run and queues nothing.
  const going = world();
  const first = await post(flywheelRun, going, startBody(1, step1), deps(going));
  const second = await post(flywheelRun, going, startBody(1, step1), deps(going));
  assert.equal(first.body.started, true);
  assert.equal(second.status, 202);
  assert.equal(second.body.started, false);
  assert.equal(second.body.already_running, true);
  assert.equal(going.jobs.length, 1);
  assert.equal(going.wakes, 1, "no wake for a run that was already going");
});

test("marketing/flywheel/run says a step that is already running is running, with no key and over the cap, and keeps the campaign, step and note on the job it queues", async () => {
  const files = { "00-OWNER-NOTES.md": NOTES(), "01-avatar.md": AVATAR, "02-ad-research.md": RESEARCH, "03-offer.md": OFFER("approved"), "01-avatar/Market_Language_Bank.md": BANK };
  // A step 4 run is going: a press answers it, whatever the key and the cap say.
  const w = world({ monthUsed: 999, settings: { max_month_cost_usd: 50 } });
  const running = { job: { id: "run-going", kind: "flywheel_stage", status: "running", payload: { campaign: "capital-blueprint", stage: 4 }, created_at: NOW.toISOString(), result: {} }, spentUsd: 1 };
  w.jobs.push({ id: "run-going", org_id: ORG_ID, kind: "flywheel_stage", status: "running", payload: { campaign: "capital-blueprint", stage: 4 }, created_at: NOW.toISOString() });
  const d = deps(w, { files, env: {}, latestStageJobs: async () => ({ 4: running }) });
  const done = await post(flywheelRun, w, { request_id: "press-going-aaaa", campaign: "capital-blueprint", stage: 4 }, d);
  assert.equal(done.status, 202, JSON.stringify(done.body));
  assert.equal(done.body.started, false);
  assert.equal(done.body.already_running, true);
  assert.equal(done.body.job.id, "run-going");
  assert.equal(w.jobs.length, 1);

  // A fresh run keeps the campaign, the step and the note on the job, and says where to poll.
  const fresh = world();
  const d2 = deps(fresh, { files });
  const out = await post(flywheelRun, fresh, { request_id: "press-fresh-aaaa", campaign: "capital-blueprint", stage: 4, note: "  keep   it short " }, d2);
  assert.equal(out.status, 202);
  assert.deepEqual(
    { campaign: fresh.jobs[0].payload.campaign, stage: fresh.jobs[0].payload.stage, note: fresh.jobs[0].payload.note },
    { campaign: "capital-blueprint", stage: 4, note: "keep it short" },
  );
  assert.equal(out.body.poll, "/api/marketing/flywheel?campaign=capital-blueprint");
  assert.equal(fresh.jobs[0].requested_by, STAFF_ID);

  // The month cap is Settings' (50): 60 used stops it; the run is refused with that cap named.
  const capped = world({ monthUsed: 60, settings: { max_month_cost_usd: 50 } });
  const stopped = await post(flywheelRun, capped, { request_id: "press-capped-aaa", campaign: "capital-blueprint", stage: 4 }, deps(capped, { files }));
  assert.equal(stopped.status, 409);
  assert.equal(stopped.body.error, "cap_hit");
  assert.match(stopped.body.message, /\$50 month cap/);
  assert.equal(capped.jobs.length, 0);
});

test("marketing/flywheel/run starts the ad strategy only when BOTH the offer and the copy are approved, and names the one that is not", async () => {
  const base = { "00-OWNER-NOTES.md": NOTES(), "01-avatar.md": AVATAR, "02-ad-research.md": RESEARCH, "01-avatar/Market_Language_Bank.md": BANK };
  const cases = [
    [{ ...base, "03-offer.md": OFFER("draft"), "04-copy.md": COPY("approved") }, /Approve step 3 first \(the offer\)\./],
    [{ ...base, "03-offer.md": OFFER("approved"), "04-copy.md": COPY("draft") }, /Approve step 4 first \(the copy\)\./],
    [{ ...base, "03-offer.md": OFFER("draft"), "04-copy.md": COPY("draft") }, /Approve steps 3 and 4 first \(the offer and the copy\)\./],
  ];
  let n = 0;
  for (const [files, words] of cases) {
    const w = world();
    const out = await post(flywheelRun, w, { request_id: `press-s5-${++n}-aaaa`, campaign: "partner", stage: 5 }, deps(w, { files }));
    assert.equal(out.status, 409);
    assert.equal(out.body.error, "blocked");
    assert.match(out.body.message, words);
    assert.equal(w.jobs.length, 0);
  }
  const ok = world();
  const go = await post(flywheelRun, ok, { request_id: "press-s5-ok-aaaa", campaign: "partner", stage: 5 }, deps(ok, { files: { ...base, "03-offer.md": OFFER("approved"), "04-copy.md": COPY("approved") } }));
  assert.equal(go.status, 202);
  assert.equal(ok.jobs.length, 1);
});

test("marketing/flywheel/run hands step 3 to the offer writer with the campaign, the avatar, the research and the owner's notes", async () => {
  const seen = [];
  const offerHandler = async (req, res) => {
    seen.push(req.body);
    return res.status(202).json({ ok: true, started: true, job: { id: "offer-job-1", kind: "offer" } });
  };
  const files = { "00-OWNER-NOTES.md": NOTES("UWIQ_DELIVERABLES"), "01-avatar.md": AVATAR, "02-ad-research.md": RESEARCH };
  const w = world();
  const out = await post(flywheelRun, w, { request_id: "press-offer-aaaa", campaign: "capital-blueprint", stage: 3 }, deps(w, { files, extra: { offerHandler } }));
  assert.equal(out.status, 202);
  assert.equal(out.body.stage, 3);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].campaign, "capital-blueprint");
  assert.match(seen[0].avatar_summary, /^# Who we sell to\n\nThe owner\./);
  assert.match(seen[0].ad_research_summary, /^# The market\n\nMany sellers\./, "the market research goes to the offer writer too");
  assert.equal(seen[0].owner_notes, "2026-10-01 | stage 4 | an earlier line", "the owner's notes section, and only that");
  assert.equal(w.jobs.length, 0);

  // Nothing written yet: only what exists is handed on.
  const bare = world();
  const none = [];
  await post(flywheelRun, bare, { request_id: "press-offer-bbbb", campaign: "partner", stage: 3 }, deps(bare, {
    files: { "00-OWNER-NOTES.md": "# Owner notes\n\nOffer key: PARTNER_ENTRY\n" },
    extra: { offerHandler: async (req, res) => { none.push(req.body); return res.status(202).json({ ok: true }); } },
  }));
  assert.deepEqual(none[0], { campaign: "partner" });
});

/* ── tweak ───────────────────────────────────────────────────────────────── */

test("marketing/flywheel/tweak saves the line in the campaign's own notes with the pipe turned into a slash, and re-runs the step for that campaign, as the person who asked", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const files = { "00-OWNER-NOTES.md": NOTES("UWIQ_DELIVERABLES"), "01-avatar.md": AVATAR, "02-ad-research.md": RESEARCH, "03-offer.md": OFFER("approved"), "01-avatar/Market_Language_Bank.md": BANK };
    const w = world();
    const d = deps(w, { files });
    const done = await post(flywheelTweak, w, { request_id: "press-tweak-aaaa", campaign: "capital-blueprint", stage: 4, note: "lead with the fee | then the date" }, d);
    assert.equal(done.status, 202, JSON.stringify(done.body));
    assert.equal(done.body.line, `${TODAY} | stage 4 | lead with the fee / then the date`, "a pipe in the note would split the line, so it is a slash");
    assert.deepEqual([w.outbox[0].path, w.outbox[0].op_id], ["marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md", "flywheel-tweak:press-tweak-aaaa"], "the campaign's own notes file");
    assert.equal(w.outbox[0].org_id, ORG_ID);
    assert.deepEqual({ campaign: w.jobs[0].payload.campaign, stage: w.jobs[0].payload.stage, note: w.jobs[0].payload.note }, { campaign: "capital-blueprint", stage: 4, note: "lead with the fee | then the date".replace("|", "|") });
    assert.equal(w.jobs[0].requested_by, STAFF_ID, "the re-run is attributed to the person who asked");
    assert.deepEqual(done.body.rerun, { started: true, reason: null });

    // The step is already running: the note is saved, and the reason says the next run reads it.
    const going = world();
    going.jobs.push({ id: "run-going", org_id: ORG_ID, kind: "flywheel_stage", status: "running", payload: { campaign: "capital-blueprint", stage: 4 }, created_at: NOW.toISOString() });
    const running = await post(flywheelTweak, going, { request_id: "press-tweak-bbbb", campaign: "capital-blueprint", stage: 4, note: "shorter" }, deps(going, { files }));
    assert.equal(running.status, 202);
    assert.equal(running.body.rerun.started, false);
    assert.equal(running.body.rerun.reason, "That step was already running, so the note is saved and the next run reads it.");
    assert.equal(going.outbox.length, 1, "the note is saved");
    assert.equal(going.jobs.length, 1, "and nothing more is queued");
  } finally {
    mock.timers.reset();
  }
});

test("marketing/flywheel/tweak on step 3 hands the line to the offer writer with the campaign's files and notes, and on step 6 reads the spend free of any model", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const files = { "00-OWNER-NOTES.md": NOTES("UWIQ_DELIVERABLES"), "01-avatar.md": AVATAR, "02-ad-research.md": RESEARCH, "03-offer.md": OFFER("approved") };
    const seen = [];
    const offerHandler = async (req, res) => { seen.push(req.body); return res.status(202).json({ ok: true, started: true, job: { id: "offer-job-9" } }); };
    const w = world();
    const done = await post(flywheelTweak, w, { request_id: "press-tweak-offer", campaign: "capital-blueprint", stage: 3, note: "price it lower" }, deps(w, { files, extra: { offerHandler } }));
    assert.equal(done.status, 202, JSON.stringify(done.body));
    assert.equal(done.body.rerun.started, true);
    assert.equal(done.body.rerun.via, "offer");
    assert.equal(done.body.job.id, "offer-job-9");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].campaign, "capital-blueprint");
    assert.match(seen[0].owner_notes, /2026-10-01 \| stage 4 \| an earlier line/, "the owner's notes ride with it");
    assert.match(seen[0].owner_notes, new RegExp(`${TODAY} \\| stage 3 \\| price it lower$`), "and so does the new line");
    assert.match(seen[0].avatar_summary, /The owner\./);
    assert.match(seen[0].ad_research_summary, /Many sellers\./);
    assert.equal(w.jobs.length, 0, "no flywheel_stage job: the offer has its own path");

    // The offer writer refuses, or says it is already running: the note is saved and the reason is its own words.
    const refusing = world();
    const refused = await post(flywheelTweak, refusing, { request_id: "press-tweak-refuse", campaign: "capital-blueprint", stage: 3, note: "price it lower" }, deps(refusing, {
      files, extra: { offerHandler: async (_req, res) => res.status(409).json({ ok: false, message: "The month cap is reached." }) },
    }));
    assert.equal(refused.status, 202);
    assert.deepEqual(refused.body.rerun, { started: false, reason: "The month cap is reached.", via: "offer" });
    assert.equal(refusing.outbox.length, 1, "the note is saved");
    const busy = world();
    const already = await post(flywheelTweak, busy, { request_id: "press-tweak-busy", campaign: "capital-blueprint", stage: 3, note: "price it lower" }, deps(busy, {
      files, extra: { offerHandler: async (_req, res) => res.status(202).json({ ok: true, started: false, already_running: true, message: "The offer is already being written.", job: { id: "offer-job-1" } }) },
    }));
    assert.deepEqual(already.body.rerun, { started: false, reason: "The offer is already being written.", via: "offer" });

    // Step 6 reads the saved numbers and writes 06-spend.md, with no model and no key.
    const s = world();
    s.rules.unshift(...spendRules());
    const spend = await post(flywheelTweak, s, { request_id: "press-tweak-spend", campaign: "capital-blueprint", stage: 6, note: "include last week" }, deps(s, { files, env: {} }));
    assert.equal(spend.status, 202, JSON.stringify(spend.body));
    assert.deepEqual(spend.body.rerun, { started: true, reason: null });
    assert.equal(spend.body.spend.repo_path, "marketing/flywheel/capital-blueprint/06-spend.md");
    assert.deepEqual(s.outbox.map((o) => o.path).sort(), ["marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md", "marketing/flywheel/capital-blueprint/06-spend.md"]);
    assert.equal(s.jobs.length, 0, "no model job");

    // Step 2 cannot re-run from the page yet: the note is saved and the reason says so, in the page's own words.
    const t = world();
    const two = await post(flywheelTweak, t, { request_id: "press-tweak-two", campaign: "capital-blueprint", stage: 2, note: "name three more rivals" }, deps(t, { files }));
    assert.equal(two.status, 202);
    assert.equal(two.body.rerun.started, false);
    assert.equal(two.body.rerun.reason, "Not on this page yet: it ships in slice 10. Cost not measured.");
    assert.equal(t.outbox.length, 1, "the note is saved");
    assert.equal(t.jobs.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("marketing/flywheel/tweak on step 1 hands it to the avatar run for the campaign: the line is saved, the run is queued with the note and Settings' cap, and no key or a month cap stops it", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const files = { "00-OWNER-NOTES.md": NOTES("UWIQ_DELIVERABLES") };
    const w = world({ settings: { run_caps: { avatar: 4 } } });
    const done = await post(flywheelTweak, w, { request_id: "press-tweak-avatar", campaign: "capital-blueprint", stage: 1, note: "talk to owners with a bad score" }, deps(w, { files }));
    assert.equal(done.status, 202, JSON.stringify(done.body));
    assert.equal(done.body.started, true);
    assert.match(done.body.message, /Step 1 is running again with it/);
    const job = w.jobs.find((j) => j.kind === "avatar");
    assert.ok(job, "an avatar run was queued");
    assert.equal(job.payload.campaign, "capital-blueprint");
    assert.equal(job.payload.tweak, "talk to owners with a bad score");
    assert.equal(job.payload.run_cap_usd, 4);
    assert.equal(w.outbox[0].path, "marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md");
    assert.equal(w.outbox[0].edit.line, `${TODAY} | stage 1 | talk to owners with a bad score`);

    const noKey = world();
    const refused = await post(flywheelTweak, noKey, { request_id: "press-tweak-nokey", campaign: "capital-blueprint", stage: 1, note: "x y" }, deps(noKey, { files, env: {} }));
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error, "no_model");
    assert.equal(noKey.jobs.length + noKey.outbox.length, 0);

    const capped = world({ monthUsed: 60, settings: { max_month_cost_usd: 50 } });
    const stopped = await post(flywheelTweak, capped, { request_id: "press-tweak-cap-a", campaign: "capital-blueprint", stage: 1, note: "x y" }, deps(capped, { files }));
    assert.equal(stopped.status, 400);
    assert.match(stopped.body.message, /Saved nothing: the \$50 month cap is reached/);
    assert.equal(capped.jobs.length, 0);
  } finally {
    mock.timers.reset();
  }
});

/* ── spend-read ──────────────────────────────────────────────────────────── */

const AD_NUMBERS_PINS = [
  ["WHERE a.org_id = $1 AND c.is_demo IS NOT TRUE AND (a.captured_at AT TIME ZONE 'America/Phoenix')::date BETWEEN $2::date AND $3::date", "this company's real leads, inside the window"],
  ["bk.status IN ('booked', 'rescheduled', 'noshow', 'completed')", "a cancelled booking is not a booked call"],
  ["t.status = 'succeeded'", "cash is succeeded payments"],
  ["FROM ad_metrics_daily m JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id WHERE m.org_id = $1 AND m.date BETWEEN $2::date AND $3::date", "spend is this company's, inside the window"],
];
const NUMBERS = [
  { ad_number: "43", ads: 2, spend_cents: "30000", impressions: "9000", link_clicks: "210", plays: "5000", p25: "4000", thruplay: "900", two_sec: "3000", ad_days: 6, link_click_days: 6, play_days: 6, two_sec_days: 6, leads: 12, booked: 5, showed: 4, sales: 2, roadmaps: 1, cash_cents: "59400", cash_unknown: 0, reported_cash_cents: "59400", maturing_leads: 0 },
  { ad_number: "7", ads: 1, spend_cents: "15000", impressions: "4000", link_clicks: "40", plays: "2000", p25: "800", thruplay: "300", two_sec: "1000", ad_days: 6, link_click_days: 6, play_days: 6, two_sec_days: 6, leads: 3, booked: 0, showed: 0, sales: 0, roadmaps: 0, cash_cents: "0", cash_unknown: 0, reported_cash_cents: "0", maturing_leads: 2 },
];
const PURCHASES = [
  { org_id: ORG_ID, ad_number: "43", purchases: "2", purchase_days: 3 },
  { org_id: ORG_ID, ad_number: "7", purchases: null, purchase_days: 0 },
  // Another company's purchases of a number this company also uses: a lost company condition would add them.
  { org_id: OTHER_ORG_ID, ad_number: "43", purchases: "900", purchase_days: 5 },
];
function spendRules({ numbers = NUMBERS, totals = {} } = {}) {
  return [
    [/-- m5:ad_labels|FROM ads a\s+JOIN ad_sets/, []],
    [/lead_by_number/, (sql) => (/FROM spend_total, lead_total/.test(sql) ? [] : numbers)],
    [/SELECT \* FROM spend_total, lead_total/, [{
      spend_cents: "45000", impressions: "13000", link_clicks: "250", plays: "7000", p25: "4800", thruplay: "1200", two_sec: "4000",
      ad_days: 12, link_click_days: 12, play_days: 12, two_sec_days: 12, leads: 15, booked: 5, showed: 4, sales: 2, roadmaps: 1,
      cash_cents: "59400", cash_unknown: 0, reported_cash_cents: "59400", maturing_leads: 2,
      unmapped_spend_cents: "5000", unmapped_ad_days: 3, unmapped_ads: 2, unmapped_leads: 1, ...totals,
    }]],
    [/SELECT a\.fundhub_ad_number AS ad_number,\s+sum\(m\.purchases\)/, (sql, p) => shelf(PURCHASES, [
      clause(/WHERE m\.org_id = \$1/, (row, params) => row.org_id === params[0]),
    ])(sql, p)],
  ];
}

test("marketing/flywheel/spend-read writes the document the saved numbers make, ad by ad, in the folder of the campaign asked, as the next version, with the figures and the unmatched spend", async () => {
  const OLD = stampStage({ stage: 6, version: 2, status: "approved", counts: { adsRead: 1 }, body: "# older\n" });
  const files = {
    "00-OWNER-NOTES.md": NOTES("UWIQ_DELIVERABLES"), "04-copy.md": COPY("approved"), "05-ad-strategy.md": STAMPED(5), "06-spend.md": OLD,
  };
  const w = world();
  w.rules.unshift(...spendRules());
  const done = await post(flywheelSpendRead, w, { request_id: "press-spend-aaaa", campaign: "capital-blueprint" }, deps(w, { files }));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.campaign, "capital-blueprint");
  assert.equal(done.body.repo_path, "marketing/flywheel/capital-blueprint/06-spend.md");
  assert.deepEqual(done.body.window, { from: "2026-09-14", to: "2026-10-13" });
  assert.deepEqual(w.outbox.map((o) => o.path), ["marketing/flywheel/capital-blueprint/06-spend.md"]);
  assert.equal(w.outbox[0].org_id, ORG_ID);

  const text = w.outbox[0].content;
  const { frontMatter, body } = splitFrontMatter(text);
  const stamp = parseFrontMatter(frontMatter);
  assert.equal(stamp.stage, 6);
  assert.equal(stamp.version, 3, "the next version of the file already there");
  assert.deepEqual(stamp.inputs, { "04-copy.md": hashOf(files["04-copy.md"]), "05-ad-strategy.md": hashOf(files["05-ad-strategy.md"]) }, "built from the copy and the strategy it read");
  assert.deepEqual(stamp.counts, { adsRead: 2 });
  assert.equal(body.trim(), [
    "# Capital Blueprint — what the spend says",
    "As of 2026-10-13 (Arizona days 2026-09-14 to 2026-10-13, the saved Meta numbers)",
    "",
    "## The answer",
    "",
    "It is selling: 2 paid in our checkout. The purchase is the score. Keep it running and write more of what sold.",
    "",
    "## All ads, together",
    "",
    "- Ad spend: $450.00",
    "- Taps to the page: 250",
    "- Still there at 25%: 69%",
    "- Leads: 15",
    "- Calls booked: 5",
    "- Our checkout: 2 paid",
    "- Meta says: 2 purchases",
    "",
    "## Every ad with a number",
    "",
    "| Ad | Spend | Taps | Cost per lead | Leads | Our checkout: paid | Meta says: purchases |",
    "|---|---|---|---|---|---|---|",
    "| Ad 43 | $300.00 | 210 | $25.00 | 12 | 2 | 2 |",
    "| Ad 7 | $150.00 | 40 | $50.00 | 3 (still maturing) | 0 | unknown |",
    "",
    "## Spend on ads with no number",
    "",
    "$50.00 on 2 ads with no Fundhub ad number. Link them on the Campaigns page so they count by number.",
    "",
    "## How this was read",
    "",
    "- Spend counts on the day it was spent. Leads count on the day they came in, and their calls and sales count for 14 days (src/marketing/metrics.mjs).",
    "- Unknown means Meta sent no number for it. It is never 0.",
    "- Our checkout and Meta's purchases are two different counts. They are shown side by side and never added.",
    "- This reads every ad in the account. Ads are not tied to one flywheel yet.",
    "",
    "## Review card",
    "",
    "**What this decided:** It is selling: 2 paid in our checkout. The purchase is the score. Keep it running and write more of what sold.",
    "",
    "**Three things to check:** Does the spend match Ads Manager for these days? · Is $50.00 on ads with no number worth linking first? · Is there anything to change yet?",
    "",
    "**What I wasn't sure about:** which of these ads belong to this flywheel. They are not tied to it yet.",
    "",
    "**Say one of:** approve · tweak: <what to change> · redo",
  ].join("\n"));

  // The statements behind it: this company, this window, ads that carry a number.
  assert.deepEqual(sqlCalls(done, /lead_by_number/)[0].params.slice(0, 3), [ORG_ID, "2026-09-14", "2026-10-13"]);
  assert.deepEqual(sqlCalls(done, /SELECT a\.fundhub_ad_number AS ad_number,\s+sum\(m\.purchases\)/)[0].params, [ORG_ID, "2026-09-14", "2026-10-13"]);
  assertSqlHas(sqlCalls(done, /FROM spend_total, lead_total/)[0].sql, [
    ["FROM ad_metrics_daily m JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id WHERE m.org_id = $1 AND m.date BETWEEN $2::date AND $3::date", "the company's spend, inside the window"],
    ["sum(m.spend_cents) FILTER (WHERE a.fundhub_ad_number IS NULL)::bigint AS unmapped_spend_cents", "spend on ads with no number is counted apart"],
    ["WHERE a.org_id = $1 AND c.is_demo IS NOT TRUE", "the company's real leads"],
  ], "the totals read");
  assertSqlHas(sqlCalls(done, /lead_by_number/)[0].sql, AD_NUMBERS_PINS, "the ad number read");

  // Nothing unmatched and a quiet account: the section says so, and no ad is listed.
  const quiet = world();
  quiet.rules.unshift(...spendRules({ numbers: [], totals: { unmapped_spend_cents: "0", unmapped_ads: 0, unmapped_ad_days: 0, unmapped_leads: 0, spend_cents: "1000", sales: 0 } }));
  const none = await post(flywheelSpendRead, quiet, { request_id: "press-spend-bbbb", campaign: "partner" }, deps(quiet, { files: { "00-OWNER-NOTES.md": NOTES() } }));
  assert.equal(none.status, 200);
  assert.match(quiet.outbox[0].content, /## Every ad with a number\n\nNo ad with a number had spend or leads in these days\./);
  assert.match(quiet.outbox[0].content, /## Spend on ads with no number\n\nNone\. Every dollar is on an ad with a number\./);
  assert.match(quiet.outbox[0].content, /^# Partner offer — what the spend says$/m);
});
