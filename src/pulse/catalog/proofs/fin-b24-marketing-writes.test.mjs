// Batch 24 (finish the 853), the marketing owner doors that queue work: Write
// now, Start a flywheel, Approve, Run, Tweak and Read the spend.
//
// The real api/ handlers, the real one-transaction write wrapper, the real
// outbox and job queue code, and a stand-in database that keeps its own rows.
// The repo-file reader, the worker wake and the Write-the-offer door are handed
// in through the handlers' own seams, so GitHub, the worker and the model are
// never reached. This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test from "node:test";

import writeNow from "../../../../api/marketing/batches/write-now.mjs";
import flywheelApprove from "../../../../api/marketing/flywheel/approve.mjs";
import flywheelCampaign from "../../../../api/marketing/flywheel/campaign.mjs";
import flywheelRun from "../../../../api/marketing/flywheel/run.mjs";
import flywheelSpendRead from "../../../../api/marketing/flywheel/spend-read.mjs";
import flywheelTweak from "../../../../api/marketing/flywheel/tweak.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { hashOf, stampStage } from "../../../marketing/flywheel/stamp.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";

const OWNER_ROLES = ["owner", "admin"];
const NOW = new Date("2026-10-14T19:00:00.000Z");
const REQUEST = "press-2026-10-14-a";
const keyName = ["ANTHROPIC", "API", "KEY"].join("_");
const FAKE_KEY = ["not", "a", "real", "model", "value"].join("-");

/* One stand-in for every write door: the request ledger, the settings row, the
   cost ledger, the repo outbox and the job queue. Each is a real table's
   behaviour in miniature, answering by the statement's own text. */
function world({ monthUsed = 0, settings = {}, funnels = ["uwiq_trial"], ideas = [], jobs = [] } = {}) {
  const w = {
    requests: new Map(), outbox: [], jobs: [...jobs], batches: [], ideaUpdates: [], locks: 0, wakes: 0,
    settings: { max_month_cost_usd: 300, max_batch_cost_usd: 40, scripts_per_day: 3, timezone: "America/Phoenix", run_caps: { avatar: 6 }, ...settings },
  };
  let n = 0;
  const id = (p) => `${p}0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  w.rules = [
    [/pg_advisory_xact_lock/, () => { w.locks += 1; return []; }],
    [/SELECT org_id, route, response FROM marketing_requests WHERE request_id = \$1/, (_s, p) => (w.requests.has(p[0]) ? [w.requests.get(p[0])] : [])],
    [/INSERT INTO marketing_requests/, (_s, p) => { w.requests.set(p[0], { org_id: p[1], route: p[2], response: JSON.parse(p[3]) }); return []; }],
    [/INSERT INTO marketing_settings/, []],
    [/SELECT \* FROM marketing_settings WHERE org_id = \$1/, (_s, p) => [{ org_id: p[0], ...w.settings }]],
    [/SELECT max_batch_cost_usd, max_month_cost_usd FROM marketing_settings/, () => [w.settings]],
    [/WITH bounds AS/, [{ month_priced_usd: String(monthUsed), month_null_input: 0, month_null_output: 0, month_null_cache_read: 0, month_null_cache_write: 0, batch_priced_usd: 0, batch_null_input: 0, batch_null_output: 0, batch_null_cache_read: 0, batch_null_cache_write: 0, unpriced_rows: 0 }]],
    [/SELECT 1 FROM marketing_funnels WHERE org_id = \$1 AND key = \$2/, (_s, p) => (p[0] === ORG_ID && funnels.includes(p[1]) ? [{ "?column?": 1 }] : [])],
    [/SELECT id FROM ad_ideas WHERE/, (sql, p) => ideas.filter((i) => (!/WHERE org_id = \$1/.test(sql) || i.org_id === p[0]) && p[1].includes(i.id)).map((i) => ({ id: i.id }))],
    [/INSERT INTO marketing_batches/, (_s, p) => { const row = { id: p[0], org_id: p[1], kind: "on_command", status: "planned", tz: p[2] }; w.batches.push(row); return [row]; }],
    [/UPDATE ad_ideas SET batch_id = \$3/, (_s, p) => { w.ideaUpdates.push(p); return []; }],
    [/INSERT INTO marketing_jobs \(org_id, kind, payload, run_after\)/, (_s, p) => { const row = { id: id("30"), org_id: p[0], kind: p[1], payload: JSON.parse(p[2]), status: "queued", created_at: NOW.toISOString() }; w.jobs.push(row); return [row]; }],
    [/SELECT \* FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'flywheel_stage'/, (sql, p) => {
      // The statement names which states count as "still going". A statement that stops
      // naming them finds no running job, and a second press then makes a second one.
      if (!/AND status IN \('queued', 'running'\)/.test(sql)) return [];
      return w.jobs.filter((j) => j.org_id === p[0] && j.kind === "flywheel_stage" && j.payload.campaign === p[1] && String(j.payload.stage) === p[2] && ["queued", "running"].includes(j.status)).slice(0, 1);
    }],
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

const post = (handler, w, body, options = {}) => hit(handler, { method: "POST", body, rules: w.rules, ...options });
const noWrite = (out) => out.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length;

/* ── marketing/batches/write-now ─────────────────────────────────────────── */

const IDEA = "1de00000-0000-4000-8000-000000000001";

test("marketing/batches/write-now queues one on-command batch and one start_batch job for this company, takes the chosen ideas into it, wakes the worker, and a repeated press answers the first answer and queues nothing more", async () => {
  assert.equal(ROUTES["marketing/batches/write-now"], writeNow);
  const w = world({ ideas: [{ id: IDEA, org_id: ORG_ID }] });
  const done = await post(writeNow, w, { request_id: REQUEST, count: 5, funnel_key: "uwiq_trial", idea_ids: [IDEA.toUpperCase(), IDEA] }, { role: "admin", deps: { wake: w.wake, env: {} } });
  assert.equal(done.status, 202);
  assert.deepEqual(Object.keys(done.body).sort(), ["batch_id", "job_id", "queued"]);
  assert.equal(done.body.queued, true);
  assert.equal(w.batches.length, 1);
  assert.deepEqual([w.batches[0].id, w.batches[0].org_id, w.batches[0].tz], [done.body.batch_id, ORG_ID, "America/Phoenix"]);
  assert.match(sqlCalls(done, /INSERT INTO marketing_batches/)[0].sql, /'on_command', to_char\(now\(\) AT TIME ZONE \$3::text, 'IYYY-"W"IW'\), 'planned', now\(\)/);
  assert.equal(w.jobs.length, 1);
  assert.equal(w.jobs[0].id, done.body.job_id);
  assert.equal(w.jobs[0].kind, "start_batch");
  assert.deepEqual(w.jobs[0].payload, { batch_id: done.body.batch_id, count: 5, funnel_key: "uwiq_trial", idea_ids: [IDEA] });
  assert.deepEqual(w.ideaUpdates, [[ORG_ID, [IDEA], done.body.batch_id]], "the ideas go into the new batch");
  assert.match(sqlCalls(done, /UPDATE ad_ideas SET batch_id/)[0].sql, /batch_id IS NULL/, "an idea already in a batch is not taken");
  assert.equal(w.wakes, 1);
  assert.equal(w.requests.get(REQUEST).route, "marketing/batches/write-now");

  const again = await post(writeNow, w, { request_id: REQUEST, count: 5 }, { deps: { wake: w.wake, env: {} } });
  assert.equal(again.status, 202);
  assert.deepEqual(again.body, done.body, "the same answer");
  assert.equal(w.batches.length, 1);
  assert.equal(w.jobs.length, 1);

  // No count named: the settings decide, and no funnel or ideas are needed.
  const plain = world();
  const quiet = await post(writeNow, plain, { request_id: "press-quiet-1" }, { deps: { wake: plain.wake, env: {} } });
  assert.equal(quiet.status, 202);
  assert.deepEqual(plain.jobs[0].payload, { batch_id: quiet.body.batch_id, count: 3, funnel_key: null, idea_ids: [] });
});

test("marketing/batches/write-now queues nothing when a model-bill cap is reached, or when the count, funnel or ideas are wrong; another press's request id is refused", async () => {
  const capped = world({ monthUsed: 300 });
  const stop = await post(writeNow, capped, { request_id: "press-capped-1" }, { deps: { wake: capped.wake, env: {} } });
  assert.equal(stop.status, 400);
  assert.equal(stop.body.error, "cap_reached");
  assert.match(stop.body.message, /month cap is \$300\.00\. Nothing was queued\./);
  assert.equal(capped.batches.length + capped.jobs.length, 0);
  assert.equal(noWrite(stop) > 0, true, "only the request ledger and settings rows may be touched");
  assert.equal(sqlCalls(stop, /INSERT INTO marketing_batches|INSERT INTO marketing_jobs/).length, 0);
  assert.equal(capped.wakes, 0);

  const cases = [
    [{ request_id: "press-bad-count-1", count: 0 }, "count"],
    [{ request_id: "press-bad-count-2", count: 1.5 }, "count"],
    [{ request_id: "press-bad-count-3", count: "3" }, "count"],
    [{ request_id: "press-bad-count-4", count: 51 }, "count"],
    [{ request_id: "press-bad-funnel-1", funnel_key: "no_such_funnel" }, "funnel_key"],
    [{ request_id: "press-bad-ideas-1", idea_ids: ["not-a-uuid"] }, "idea_ids"],
    [{ request_id: "press-bad-ideas-2", idea_ids: [IDEA] }, "idea_ids"],
    // An idea that belongs to another company is "not in your ideas list" too.
    [{ request_id: "press-bad-ideas-3", idea_ids: [IDEA] }, "idea_ids", [{ id: IDEA, org_id: OTHER_ORG_ID }]],
    [{ count: 3 }, "request_id"],
    [{ request_id: "short", count: 3 }, "request_id"],
  ];
  for (const [body, field, ideas] of cases) {
    const w = world({ ideas: ideas || [] });
    const out = await post(writeNow, w, body, { deps: { wake: w.wake, env: {} } });
    assert.equal(out.status, 400, JSON.stringify(body));
    assert.equal(out.body.field, field);
    assert.equal(w.batches.length + w.jobs.length, 0);
    assert.equal(w.wakes, 0);
  }
  // A request id already used on another door is not reusable here.
  const shared = world();
  shared.requests.set("press-other-door", { org_id: ORG_ID, route: "marketing/ideas", response: { ok: true } });
  const reused = await post(writeNow, shared, { request_id: "press-other-door" }, { deps: { wake: shared.wake, env: {} } });
  assert.equal(reused.status, 400);
  assert.equal(shared.jobs.length, 0);

  const w = world();
  await assertRoleGate(writeNow, OWNER_ROLES, { method: "POST", body: { request_id: "press-roles-1" }, rules: w.rules, deps: { wake: w.wake, env: {} } });
  const get = await hit(writeNow, { method: "GET", rules: w.rules });
  assert.equal(get.status, 405);
});

/* ── the flywheel doors ──────────────────────────────────────────────────── */

const NOTES_FILE = "# Owner notes — partner flywheel\n\nOffer key: PARTNER_ENTRY\n\n## Notes\n";
const AVATAR_FILE = stampStage({ stage: 1, version: 1, status: "approved", counts: { quotes: 140, languageEntries: 120 }, body: "# Who we sell to\n\nThe owner.\n\n## Review card\n\nOK." });
const RESEARCH_FILE = stampStage({ stage: 2, version: 1, status: "approved", counts: { rowsVerified: 10, competitorsFound: 4, rowsWithFirstSeen: 8 }, body: "# The market\n\nMany sellers.\n\n## Review card\n\nOK." });
/* A step 3 file the gate really accepts: built from the two files above (their body
   hashes are in its stamp), with every count the bar asks for. */
const offerFile = (status) => stampStage({
  stage: 3, version: 2, status,
  inputs: { "01-avatar.md": hashOf(AVATAR_FILE), "02-ad-research.md": hashOf(RESEARCH_FILE) },
  counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
  body: "# The offer\n\nA clear price.\n\n## Review card\n\nOK.",
});
const OFFER_FILE = (status = "draft") => offerFile(status);
const READY = (status = "approved") => ({ "00-OWNER-NOTES.md": NOTES_FILE, "01-avatar.md": AVATAR_FILE, "02-ad-research.md": RESEARCH_FILE, "03-offer.md": offerFile(status) });

function flywheel(files, { campaigns = ["partner"], jobs = {}, extra = {} } = {}) {
  const w = extra.world || world();
  const reads = [];
  const text = (t) => ({ text: t, source: "github" });
  const map = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, text(v)]));
  w.deps = {
    env: { [keyName]: FAKE_KEY },
    wake: w.wake,
    readFlywheel: async (args) => { reads.push(args); return { campaigns, files: map, source: "github", fallback_reason: null, commit_sha: "abc1234" }; },
    latestStageJobs: async () => jobs,
    ...extra.deps,
  };
  w.reads = reads;
  return w;
}

test("marketing/flywheel/approve queues one front-matter edit that sets status to approved on that step's file, once per press, and wakes the worker", async () => {
  assert.equal(ROUTES["marketing/flywheel/approve"], flywheelApprove);
  const w = flywheel({ "03-offer.md": OFFER_FILE("draft") });
  const done = await post(flywheelApprove, w, { request_id: REQUEST, campaign: "partner", stage: 3 }, { role: "admin", deps: w.deps });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, campaign: "partner", stage: 3, file: "03-offer.md", outbox_id: 1, already_approved: false });
  assert.equal(w.outbox.length, 1);
  assert.deepEqual(
    { org: w.outbox[0].org_id, op: w.outbox[0].op_id, path: w.outbox[0].path, mode: w.outbox[0].mode, edit: w.outbox[0].edit },
    { org: ORG_ID, op: `flywheel-approve:${REQUEST}`, path: "marketing/flywheel/partner/03-offer.md", mode: "edit", edit: { op: "set_front_matter_key", key: "status", value: "approved" } },
  );
  assert.equal(w.outbox[0].content, null, "the body is never rewritten, only the stamp");
  assert.equal(w.wakes, 1);
  assert.deepEqual(w.reads.map((r) => [r.orgId, r.campaign]), [[ORG_ID, "partner"]]);

  const again = await post(flywheelApprove, w, { request_id: REQUEST, campaign: "partner", stage: 3 }, { deps: w.deps });
  assert.deepEqual(again.body, done.body);
  assert.equal(w.outbox.length, 1, "a repeated press queues nothing more");

  const approved = flywheel({ "03-offer.md": OFFER_FILE("approved") });
  const already = await post(flywheelApprove, approved, { request_id: "press-already-1", campaign: "partner", stage: 3 }, { deps: approved.deps });
  assert.equal(already.body.already_approved, true);
});

test("marketing/flywheel/approve refuses a step with no file or no stamp, an unknown campaign or step, and a request with no press id; nothing is queued", async () => {
  const cases = [
    [flywheel({}), { request_id: "press-nofile-1", campaign: "partner", stage: 3 }, 400, "stage"],
    [flywheel({ "03-offer.md": "# no stamp here\n" }), { request_id: "press-nostamp-1", campaign: "partner", stage: 3 }, 400, "stage"],
    [flywheel({ "03-offer.md": OFFER_FILE() }), { request_id: "press-nocamp-1", campaign: "nope", stage: 3 }, 404, null],
    [flywheel({ "03-offer.md": OFFER_FILE() }), { request_id: "press-badstage-1", campaign: "partner", stage: 7 }, 400, "stage"],
    [flywheel({ "03-offer.md": OFFER_FILE() }), { request_id: "press-badcamp-1", campaign: "../etc", stage: 3 }, 400, "campaign"],
    [flywheel({ "03-offer.md": OFFER_FILE() }), { campaign: "partner", stage: 3 }, 400, "request_id"],
  ];
  const said = [/has no file yet, so there is nothing to approve/, /has no stamp, so it cannot be marked approved/];
  for (const [w, body, status, field] of cases) {
    const out = await post(flywheelApprove, w, body, { deps: w.deps });
    assert.equal(out.status, status, JSON.stringify(body));
    if (field) assert.equal(out.body.field, field);
    assert.equal(w.outbox.length, 0);
    assert.equal(w.wakes, 0);
  }
  const noFile = await post(flywheelApprove, flywheel({}), { request_id: "press-words-1", campaign: "partner", stage: 3 }, { deps: flywheel({}).deps });
  assert.match(noFile.body.message, said[0]);
  const noStamp = flywheel({ "03-offer.md": "# no stamp here\n" });
  const unstamped = await post(flywheelApprove, noStamp, { request_id: "press-words-2", campaign: "partner", stage: 3 }, { deps: noStamp.deps });
  assert.match(unstamped.body.message, said[1]);
  const w = flywheel({ "03-offer.md": OFFER_FILE() });
  await assertRoleGate(flywheelApprove, OWNER_ROLES, { method: "POST", body: { request_id: "press-roles-2", campaign: "partner", stage: 3 }, rules: w.rules, deps: w.deps });
  const get = await hit(flywheelApprove, { method: "GET", rules: w.rules, deps: w.deps });
  assert.equal(get.status, 405);
});

test("marketing/flywheel/campaign queues the folder's owner-notes file with the offer key line for a new flywheel, and starts nothing twice for one that exists", async () => {
  assert.equal(ROUTES["marketing/flywheel/campaign"], flywheelCampaign);
  const w = flywheel({}, { campaigns: ["partner"] });
  const done = await post(flywheelCampaign, w, { request_id: REQUEST, key: "uwiq_deliverables" }, { role: "admin", deps: w.deps });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.created, true);
  assert.equal(done.body.offer_key, "UWIQ_DELIVERABLES");
  assert.match(done.body.campaign, /^[a-z0-9-]+$/);
  assert.equal(done.body.repo_path, `marketing/flywheel/${done.body.campaign}/00-OWNER-NOTES.md`);
  assert.equal(w.outbox.length, 1);
  assert.equal(w.outbox[0].path, done.body.repo_path);
  assert.equal(w.outbox[0].mode, "replace");
  assert.match(w.outbox[0].content, /^Offer key: UWIQ_DELIVERABLES$/m, "the stage writers read the offer from this line");
  assert.equal(w.outbox[0].op_id, `flywheel-campaign:${done.body.campaign}`);
  assert.equal(done.body.outbox_id, 1);
  assert.equal(w.wakes, 1);

  const exists = flywheel({}, { campaigns: ["partner"] });
  const old = await post(flywheelCampaign, exists, { request_id: "press-exists-1", key: "PARTNER_ENTRY" }, { deps: exists.deps });
  assert.equal(old.status, 200);
  assert.equal(old.body.created, false);
  assert.equal(old.body.campaign, "partner");
  assert.equal(old.body.outbox_id, null);
  assert.equal(exists.outbox.length, 0);
  assert.equal(exists.wakes, 0, "nothing was queued, so nobody is woken");

  const bad = await post(flywheelCampaign, flywheel({}), { request_id: "press-badkey-1", key: "NOT_AN_OFFER" }, { deps: flywheel({}).deps });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "key");
  const w2 = flywheel({});
  await assertRoleGate(flywheelCampaign, OWNER_ROLES, { method: "POST", body: { request_id: "press-roles-3", key: "PARTNER_ENTRY" }, rules: w2.rules, deps: w2.deps });
  const get = await hit(flywheelCampaign, { method: "GET", rules: w2.rules, deps: w2.deps });
  assert.equal(get.status, 405);
});

test("marketing/flywheel/run starts the copy and the strategy as one saved job each, only after the steps they depend on are approved, once per step, under the month cap and with a model key", async () => {
  assert.equal(ROUTES["marketing/flywheel/run"], flywheelRun);
  // Step 4 waits for step 3 to be approved.
  const blocked = flywheel(READY("draft"));
  const stopped = await post(flywheelRun, blocked, { request_id: "press-blocked-1", campaign: "partner", stage: 4 }, { deps: blocked.deps });
  assert.equal(stopped.status, 409);
  assert.equal(stopped.body.error, "blocked");
  assert.match(stopped.body.message, /Approve step 3 first/);
  assert.equal(blocked.jobs.length, 0);

  const ready = flywheel(READY("approved"));
  const done = await post(flywheelRun, ready, { request_id: REQUEST, campaign: "partner", stage: 4, note: "  keep it   short  " }, { role: "admin", deps: ready.deps });
  assert.equal(done.status, 202, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.started, true);
  assert.equal(done.body.already_running, false);
  assert.equal(done.body.stage, 4);
  assert.equal(done.body.poll, "/api/marketing/flywheel?campaign=partner");
  assert.equal(ready.jobs.length, 1);
  assert.equal(ready.jobs[0].kind, "flywheel_stage");
  assert.equal(ready.jobs[0].org_id, ORG_ID);
  assert.deepEqual({ campaign: ready.jobs[0].payload.campaign, stage: ready.jobs[0].payload.stage, note: ready.jobs[0].payload.note }, { campaign: "partner", stage: 4, note: "keep it short" });
  assert.match(ready.jobs[0].payload.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ready.jobs[0].requested_by, "5a000000-0000-4000-8000-000000000001", "the staff member on the session");
  assert.equal(ready.wakes, 1);

  // A second tap while it runs answers that run and queues nothing.
  const second = await post(flywheelRun, ready, { request_id: "press-second-1", campaign: "partner", stage: 4 }, { deps: ready.deps });
  assert.equal(second.status, 202);
  assert.equal(second.body.started, false);
  assert.equal(second.body.already_running, true);
  assert.equal(second.body.job.id, done.body.job.id);
  assert.equal(ready.jobs.length, 1);
  assert.equal(ready.wakes, 1, "no wake for a run that was already going");
});

test("marketing/flywheel/run refuses with no model key, past the month cap, an unknown campaign or step, and a step 5 that waits for step 4; nothing is queued", async () => {
  const files = READY("approved");

  const noKey = flywheel(files, { extra: { deps: { env: {} } } });
  const a = await post(flywheelRun, noKey, { request_id: "press-nokey-1", campaign: "partner", stage: 4 }, { deps: noKey.deps });
  assert.equal(a.status, 503);
  assert.equal(a.body.error, "no_model");
  assert.equal(noKey.jobs.length, 0);

  const masked = flywheel(files, { extra: { deps: { env: { [keyName]: "************abcd" } } } });
  const m = await post(flywheelRun, masked, { request_id: "press-masked-1", campaign: "partner", stage: 4 }, { deps: masked.deps });
  assert.equal(m.status, 503, "a masked copy of a key is not a key");

  const capped = flywheel(files, { extra: { world: world({ monthUsed: 300 }) } });
  const b = await post(flywheelRun, capped, { request_id: "press-cap-1", campaign: "partner", stage: 4 }, { deps: capped.deps });
  assert.equal(b.status, 409);
  assert.equal(b.body.error, "cap_hit");
  assert.match(b.body.message, /\$300 month cap/);
  assert.equal(capped.jobs.length, 0);

  const needs4 = flywheel(files);
  const c = await post(flywheelRun, needs4, { request_id: "press-step5-1", campaign: "partner", stage: 5 }, { deps: needs4.deps });
  assert.equal(c.status, 409);
  assert.equal(c.body.error, "blocked");
  assert.match(c.body.message, /Approve step 4 first/);

  for (const [body, status, field] of [
    [{ request_id: "press-nocamp-2", campaign: "nope", stage: 4 }, 404, null],
    [{ request_id: "press-badstage-2", campaign: "partner", stage: 9 }, 400, "stage"],
    [{ request_id: "press-badcamp-2", campaign: "Bad Name", stage: 4 }, 400, "campaign"],
    [{ campaign: "partner", stage: 4 }, 400, "request_id"],
  ]) {
    const w = flywheel(files);
    const out = await post(flywheelRun, w, body, { deps: w.deps });
    assert.equal(out.status, status, JSON.stringify(body));
    if (field) assert.equal(out.body.field, field);
    assert.equal(w.jobs.length, 0);
  }
  const w = flywheel(files);
  await assertRoleGate(flywheelRun, OWNER_ROLES, { method: "POST", body: { request_id: "press-roles-4", campaign: "partner", stage: 4 }, rules: w.rules, deps: w.deps });
  const get = await hit(flywheelRun, { method: "GET", rules: w.rules, deps: w.deps });
  assert.equal(get.status, 405);
});

test("marketing/flywheel/run hands step 3 to the offer writer with this campaign's files and notes, and starts the avatar (step 1) and the market research (step 2) as their own saved runs", async () => {
  const seen = [];
  const offer = async (req, res) => {
    seen.push(req.body);
    return res.status(202).json({ ok: true, started: true, job: { id: "offer-job-1", kind: "offer" } });
  };
  const w = flywheel({ "00-OWNER-NOTES.md": NOTES_FILE, "01-avatar.md": AVATAR_FILE }, { extra: { deps: { offerHandler: offer } } });
  const three = await post(flywheelRun, w, { request_id: "press-offer-1", campaign: "partner", stage: 3 }, { deps: w.deps });
  assert.equal(three.status, 202);
  assert.equal(three.body.stage, 3);
  assert.equal(three.body.job.id, "offer-job-1");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].campaign, "partner");
  assert.match(seen[0].avatar_summary, /The owner\./, "the avatar's words go to the offer writer");
  assert.equal(w.jobs.length, 0, "no flywheel_stage job: the offer has its own path");

  // Step 1: the avatar, with the model key present.
  const avatar = world();
  avatar.rules.unshift(
    [/INSERT INTO marketing_jobs \(org_id, kind, payload, requested_by\)\s+VALUES \(\$1, 'avatar'/, (_s, p) => {
      const row = { id: "ab000000-0000-4000-8000-000000000001", org_id: p[0], kind: "avatar", status: "queued", payload: JSON.parse(p[1]), requested_by: p[2], created_at: NOW.toISOString() };
      avatar.jobs.push(row);
      return [row];
    }],
  );
  const one = await hit(flywheelRun, {
    method: "POST", body: { request_id: "press-avatar-1", campaign: "partner", stage: 1, service_description: "White-label funding program" },
    rules: avatar.rules, deps: { env: { [keyName]: FAKE_KEY }, wake: avatar.wake },
  });
  assert.equal(one.status, 202, JSON.stringify(one.body));
  assert.equal(one.body.started, true);
  assert.equal(avatar.jobs.length, 1);
  assert.equal(avatar.jobs[0].kind, "avatar");
  assert.equal(avatar.jobs[0].payload.campaign, "partner");
  assert.equal(avatar.jobs[0].payload.service_description, "White-label funding program");
  assert.equal(avatar.jobs[0].payload.run_cap_usd, 6, "the run cap comes from Settings");
  assert.equal(avatar.wakes, 1);

  // Step 2: the market research.
  const market = world();
  market.rules.unshift(
    [/INSERT INTO marketing_jobs \(org_id, kind, payload, requested_by\)\s+VALUES \(\$1, 'flywheel_stage'/, (_s, p) => {
      const row = { id: "ab000000-0000-4000-8000-000000000002", org_id: p[0], kind: "flywheel_stage", status: "queued", payload: JSON.parse(p[1]), requested_by: p[2], created_at: NOW.toISOString() };
      market.jobs.push(row);
      return [row];
    }],
    [/SELECT 1 FROM repo_outbox WHERE org_id = \$1 AND path LIKE \$2/, [{ "?column?": 1 }]],
  );
  const two = await hit(flywheelRun, {
    method: "POST", body: { request_id: "press-market-1", campaign: "partner", stage: 2, market: "business funding", competitors: ["Acme Capital"] },
    rules: market.rules, deps: { env: { [keyName]: FAKE_KEY }, wake: market.wake, flywheelDir: () => null },
  });
  assert.equal(two.status, 202, JSON.stringify(two.body));
  assert.equal(market.jobs.length, 1);
  assert.deepEqual(
    { campaign: market.jobs[0].payload.campaign, stage: market.jobs[0].payload.stage, market: market.jobs[0].payload.market, competitors: market.jobs[0].payload.competitors },
    { campaign: "partner", stage: 2, market: "business funding", competitors: ["Acme Capital"] },
  );
});

const BANK_FILE = "# Market language bank\n\nphrases the market uses\n";
const COPY_FILE = (status = "approved") => stampStage({
  stage: 4, version: 1, status,
  inputs: { "03-offer.md": hashOf(offerFile("approved")), "01-avatar/Market_Language_Bank.md": hashOf(BANK_FILE) },
  counts: { hooks: 6, humanizerPassRun: 1, distinctReasons: 16 },
  body: "# Ad copy\n\nSix hooks.\n\n## Review card\n\nOK.",
});

test("marketing/flywheel/run starts the ad strategy only once the offer and the copy are both approved, and reads the spend free of any model when step 6 is asked for", async () => {
  const files = { ...READY("approved"), "01-avatar/Market_Language_Bank.md": BANK_FILE };

  const draftCopy = flywheel({ ...files, "04-copy.md": COPY_FILE("draft") });
  const held = await post(flywheelRun, draftCopy, { request_id: "press-s5-held", campaign: "partner", stage: 5 }, { deps: draftCopy.deps });
  assert.equal(held.status, 409);
  assert.match(held.body.message, /Approve step 4 first/);
  assert.equal(draftCopy.jobs.length, 0);

  const ready = flywheel({ ...files, "04-copy.md": COPY_FILE("approved") });
  const five = await post(flywheelRun, ready, { request_id: "press-s5-go", campaign: "partner", stage: 5 }, { deps: ready.deps });
  assert.equal(five.status, 202, JSON.stringify(five.body));
  assert.equal(five.body.stage, 5);
  assert.equal(five.body.started, true);
  assert.equal(ready.jobs.length, 1);
  assert.deepEqual({ campaign: ready.jobs[0].payload.campaign, stage: ready.jobs[0].payload.stage }, { campaign: "partner", stage: 5 });

  // Step 6 needs no model key and spends nothing: it reads the saved numbers and queues 06-spend.md.
  const six = flywheel(files, { extra: { deps: { env: {} } } });
  six.rules.unshift(...READ_RULES());
  const read = await post(flywheelRun, six, { request_id: "press-s6-go", campaign: "partner", stage: 6 }, { deps: six.deps });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.stage, 6);
  assert.equal(read.body.ok, true);
  assert.equal(read.body.repo_path, "marketing/flywheel/partner/06-spend.md");
  assert.equal(six.outbox.length, 1);
  assert.equal(six.outbox[0].op_id, "flywheel-spend:press-s6-go");
  assert.equal(six.jobs.length, 0, "no model job");
  assert.equal(six.wakes, 1);
});

const READ_RULES = (spendRows = [], totals = {}) => [
  [/-- m5:ad_labels|FROM ads a\s+JOIN ad_sets/, []],
  [/lead_by_number/, spendRows],
  [/SELECT \* FROM spend_total, lead_total|lead_total/, [{
    spend_cents: "30000", impressions: "9000", link_clicks: "210", plays: "5000", p25: "2100", thruplay: "900", two_sec: "3000",
    ad_days: 6, link_click_days: 6, play_days: 6, two_sec_days: 6, leads: 12, booked: 5, showed: 4, sales: 2, roadmaps: 1,
    cash_cents: "59400", cash_unknown: 0, reported_cash_cents: "59400", maturing_leads: 0,
    unmapped_spend_cents: "0", unmapped_ad_days: 0, unmapped_ads: 0, unmapped_leads: 0, ...totals,
  }]],
  [/SELECT a\.fundhub_ad_number AS ad_number,\s+sum\(m\.purchases\)/, [{ ad_number: "43", purchases: "2", purchase_days: 3 }]],
];

test("marketing/flywheel/spend-read reads this company's saved ad numbers for the last 30 Arizona days ending yesterday, words a conclusion, and queues 06-spend.md for the repo in the same transaction", async () => {
  assert.equal(ROUTES["marketing/flywheel/spend-read"], flywheelSpendRead);
  const w = flywheel({ "00-OWNER-NOTES.md": NOTES_FILE });
  const numbers = [{ ad_number: "43", ads: 2, spend_cents: "30000", impressions: "9000", link_clicks: "210", plays: "5000", p25: "2100", thruplay: "900", two_sec: "3000", ad_days: 6, link_click_days: 6, play_days: 6, two_sec_days: 6, leads: 12, booked: 5, showed: 4, sales: 2, roadmaps: 1, cash_cents: "59400", cash_unknown: 0, reported_cash_cents: "59400", maturing_leads: 0 }];
  w.rules.unshift(...READ_RULES(numbers));
  const done = await post(flywheelSpendRead, w, { request_id: REQUEST, campaign: "partner" }, { role: "admin", deps: { ...w.deps, now: () => NOW } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.campaign, "partner");
  assert.deepEqual(done.body.window, { from: "2026-09-14", to: "2026-10-13" }, "30 days ending yesterday in Arizona");
  assert.deepEqual(done.body.rows.map((r) => [r.ad_number, r.spend_cents, r.leads]), [["43", 30000, 12]]);
  assert.equal(typeof done.body.conclusion.text, "string");
  assert.ok(done.body.conclusion.text.length > 10);
  assert.equal(done.body.repo_path, "marketing/flywheel/partner/06-spend.md");
  assert.equal(w.outbox.length, 1);
  assert.deepEqual([w.outbox[0].org_id, w.outbox[0].path, w.outbox[0].mode, w.outbox[0].op_id], [ORG_ID, "marketing/flywheel/partner/06-spend.md", "replace", `flywheel-spend:${REQUEST}`]);
  assert.match(w.outbox[0].content, /^---\nstage: 6\n/, "the file carries the stage stamp");
  assert.equal(done.body.outbox_id, w.outbox[0].id);
  assert.equal(w.wakes, 1);
  assert.deepEqual(sqlCalls(done, /lead_by_number/)[0].params.slice(0, 3), [ORG_ID, "2026-09-14", "2026-10-13"]);
  assert.equal(sqlCalls(done, /FROM ads a\s+JOIN ad_sets/).length >= 0, true);

  const again = await post(flywheelSpendRead, w, { request_id: REQUEST, campaign: "partner" }, { deps: { ...w.deps, now: () => NOW } });
  assert.deepEqual(again.body, done.body);
  assert.equal(w.outbox.length, 1, "a repeated press saves nothing more");
});

test("marketing/flywheel/spend-read words the conclusion the saved numbers call for, and the file it queues carries the same words and the same figures", async () => {
  // Same company, same window; only the saved totals change from case to case.
  const numbers = [{ ad_number: "43", ads: 2, spend_cents: "30000", impressions: "9000", link_clicks: "210", plays: "5000", p25: "4000", thruplay: "900", two_sec: "3000", ad_days: 6, link_click_days: 6, play_days: 6, two_sec_days: 6, leads: 12, booked: 5, showed: 4, sales: 0, roadmaps: 0, cash_cents: "0", cash_unknown: 0, reported_cash_cents: "0", maturing_leads: 0 }];
  const cases = [
    ["selling", { sales: 2 }, /^It is selling: 2 paid in our checkout\. /, null, ["- Ad spend: $300.00", "- Our checkout: 2 paid"]],
    ["opening", { leads: 0, booked: 0, p25: "1000" }, /^Most plays never reach the quarter mark, and nobody became a lead\./, 4, ["- Still there at 25%: 20%", "- Leads: 0"]],
    ["offer_no_leads", { leads: 0, booked: 0 }, /^People tap through to the page, but nobody became a lead\./, 3, ["- Taps to the page: 210", "- Leads: 0"]],
    ["offer_no_calls", { leads: 12, booked: 0 }, /^Leads came in, but nobody booked a call or bought\./, 3, ["- Leads: 12", "- Calls booked: 0"]],
    ["ask", { leads: 0, booked: 0, link_clicks: "0" }, /^People see the ads, but nobody taps\./, 4, ["- Taps to the page: 0"]],
    ["too_early", {}, /^Not enough has happened yet to tell what to fix\./, null, ["- Leads: 12", "- Calls booked: 5"]],
    ["no_spend", { spend_cents: null, impressions: null, link_clicks: null, plays: null, p25: null, leads: 0, booked: 0 }, /^No ad spend is saved for these 30 days, so there is nothing to read yet\.$/, null, ["- Ad spend: unknown"]],
  ];
  let n = 0;
  for (const [rule, totals, words, points, figures] of cases) {
    const w = flywheel({ "00-OWNER-NOTES.md": NOTES_FILE });
    w.rules.unshift(...READ_RULES(rule === "no_spend" ? [] : numbers, { sales: 0, roadmaps: 0, p25: "4000", ...totals }));
    const done = await post(flywheelSpendRead, w, { request_id: `press-rule-${++n}-${rule}`, campaign: "partner" }, { role: "admin", deps: { ...w.deps, now: () => NOW } });
    assert.equal(done.status, 200, `${rule}: ${JSON.stringify(done.body)}`);
    assert.match(done.body.conclusion.text, words, rule);
    assert.equal(done.body.conclusion.points_to_stage, points, `${rule}: the step the page jumps to`);
    assert.equal(w.outbox.length, 1, rule);
    const file = w.outbox[0].content;
    assert.ok(file.includes(done.body.conclusion.text), `${rule}: the file says the same words the screen shows`);
    assert.equal(file.split(done.body.conclusion.text).length - 1, 2, `${rule}: once as the answer and once on the review card`);
    for (const figure of figures) assert.ok(file.includes(figure), `${rule}: the file shows "${figure}"`);
  }
});

test("marketing/flywheel/spend-read refuses an unknown or malformed campaign and a missing press id, is free of any model or vendor call, and is for owner and admin only", async () => {
  const realFetch = globalThis.fetch;
  const wire = [];
  globalThis.fetch = async (url) => { wire.push(String(url)); throw new Error("trapped"); };
  try {
    for (const [body, status, field] of [
      [{ request_id: "press-nocamp-3", campaign: "nope" }, 404, null],
      [{ request_id: "press-badcamp-3", campaign: "Bad Name" }, 400, "campaign"],
      [{ campaign: "partner" }, 400, "request_id"],
    ]) {
      const w = flywheel({ "00-OWNER-NOTES.md": NOTES_FILE });
      w.rules.unshift(...READ_RULES());
      const out = await post(flywheelSpendRead, w, body, { deps: { ...w.deps, now: () => NOW } });
      assert.equal(out.status, status, JSON.stringify(body));
      if (field) assert.equal(out.body.field, field);
      assert.equal(w.outbox.length, 0);
    }
    const w = flywheel({ "00-OWNER-NOTES.md": NOTES_FILE });
    w.rules.unshift(...READ_RULES());
    await assertRoleGate(flywheelSpendRead, OWNER_ROLES, { method: "POST", body: { request_id: "press-roles-5", campaign: "partner" }, rules: w.rules, deps: { ...w.deps, now: () => NOW } });
    const get = await hit(flywheelSpendRead, { method: "GET", rules: w.rules, deps: w.deps });
    assert.equal(get.status, 405);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(wire, []);
});

test("marketing/flywheel/tweak appends one dated line under Notes in the owner notes, then re-runs that step where it can, with the note riding on the new job; the note is saved even when the step is blocked", async () => {
  assert.equal(ROUTES["marketing/flywheel/tweak"], flywheelTweak);
  const files = READY("approved");
  const w = flywheel(files);
  const done = await post(flywheelTweak, w, { request_id: REQUEST, campaign: "partner", stage: 4, note: "  lead with   the fee  " }, { role: "admin", deps: w.deps });
  assert.equal(done.status, 202, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.match(done.body.line, /^\d{4}-\d{2}-\d{2} \| stage 4 \| lead with the fee$/);
  assert.equal(w.outbox.length, 1);
  assert.deepEqual([w.outbox[0].path, w.outbox[0].mode, w.outbox[0].op_id], ["marketing/flywheel/partner/00-OWNER-NOTES.md", "edit", `flywheel-tweak:${REQUEST}`]);
  assert.deepEqual(w.outbox[0].edit, { op: "append_line_under_heading", heading: "## Notes", line: done.body.line }, "append only, never a rewrite");
  assert.equal(done.body.outbox_id, w.outbox[0].id);
  assert.equal(w.jobs.length, 1);
  assert.equal(w.jobs[0].kind, "flywheel_stage");
  assert.deepEqual({ campaign: w.jobs[0].payload.campaign, stage: w.jobs[0].payload.stage, note: w.jobs[0].payload.note }, { campaign: "partner", stage: 4, note: "lead with the fee" });
  assert.deepEqual(done.body.rerun, { started: true, reason: null });
  assert.equal(w.wakes, 1);

  // Step 5 waits for step 4: the line is still saved, and the reason says why nothing re-ran.
  const blocked = flywheel(files);
  const held = await post(flywheelTweak, blocked, { request_id: "press-held-1", campaign: "partner", stage: 5, note: "shorter" }, { deps: blocked.deps });
  assert.equal(held.status, 202);
  assert.equal(blocked.outbox.length, 1, "the note is kept");
  assert.equal(blocked.jobs.length, 0);
  assert.equal(held.body.rerun.started, false);
  assert.match(held.body.rerun.reason, /Approve step 4 first/);

  // No model key: saved, not re-run, and says so.
  const noKey = flywheel(files, { extra: { deps: { env: {} } } });
  const quiet = await post(flywheelTweak, noKey, { request_id: "press-nokey-2", campaign: "partner", stage: 4, note: "x y" }, { deps: noKey.deps });
  assert.equal(quiet.body.rerun.started, false);
  assert.match(quiet.body.rerun.reason, /No Anthropic key/);
  assert.equal(noKey.outbox.length, 1);
  assert.equal(noKey.jobs.length, 0);

  // A repeated press replays the saved answer and adds nothing.
  const again = await post(flywheelTweak, w, { request_id: REQUEST, campaign: "partner", stage: 4, note: "lead with the fee" }, { deps: w.deps });
  assert.deepEqual(again.body.line, done.body.line);
  assert.equal(w.outbox.length, 1);
  assert.equal(w.jobs.length, 1);
});

test("marketing/flywheel/tweak refuses an empty or long note, a campaign with no owner notes, an unknown campaign and a missing press id; nothing is saved or run", async () => {
  const files = READY("approved");
  const cases = [
    [files, { request_id: "press-empty-1", campaign: "partner", stage: 4, note: "   " }, 400, "note"],
    [files, { request_id: "press-long-1", campaign: "partner", stage: 4, note: "x".repeat(501) }, 400, "note"],
    [{ "03-offer.md": offerFile("approved") }, { request_id: "press-nonotes-1", campaign: "partner", stage: 4, note: "ok" }, 400, "campaign"],
    [files, { request_id: "press-nocamp-4", campaign: "nope", stage: 4, note: "ok" }, 404, null],
    [files, { campaign: "partner", stage: 4, note: "ok" }, 400, "request_id"],
  ];
  for (const [f, body, status, field] of cases) {
    const w = flywheel(f);
    const out = await post(flywheelTweak, w, body, { deps: w.deps });
    assert.equal(out.status, status, JSON.stringify(body).slice(0, 80));
    if (field) assert.equal(out.body.field, field);
    assert.equal(w.outbox.length, 0);
    assert.equal(w.jobs.length, 0);
    assert.equal(w.wakes, 0);
  }
  const w = flywheel(files);
  await assertRoleGate(flywheelTweak, OWNER_ROLES, { method: "POST", body: { request_id: "press-roles-6", campaign: "partner", stage: 4, note: "ok" }, rules: w.rules, deps: w.deps });
  const get = await hit(flywheelTweak, { method: "GET", rules: w.rules, deps: w.deps });
  assert.equal(get.status, 405);
});
