// Batch 24 (finish the 853), the hiring doors: the public careers door (open
// roles, one application) and the one place a person moves or rejects a
// candidate.
//
// The real api/ handlers, the real pipeline code, and a stand-in database that
// keeps its own candidates, applications, attempts and tasks and answers the way
// the SQL text says. Nothing leaves the building. This is a PRACTICE TEST with
// fake data. It is not a live check.

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import applyHandler from "../../../../api/hiring/apply.mjs";
import decideHandler from "../../../../api/hiring/decide.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { _resetOrgCache } from "../../../auth/org.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";

beforeEach(() => _resetOrgCache());
afterEach(() => _resetOrgCache());

const STAGE_IDS = { applied: "5a000000-0000-4000-8000-0000000000a1", screening: "5a000000-0000-4000-8000-0000000000a2", rejected: "5a000000-0000-4000-8000-0000000000a9", offer: "5a000000-0000-4000-8000-0000000000a5", hired: "5a000000-0000-4000-8000-0000000000a6" };
const ROLE_ID = "20000000-0000-4000-8000-000000000001";
const IP = "203.0.113.7";

/* ── the careers page: open roles, three columns only ────────────────────── */

const ROLE_ROWS = [
  { org_id: ORG_ID, id: ROLE_ID, key: "setter", name: "Setter", role_brief: "  Book calls for the closers.  ", active: true, compensation: "private", scorecard: { x: 1 }, hiring_manager_staff_id: "m1", bench_target: 5 },
  { org_id: ORG_ID, id: "20000000-0000-4000-8000-000000000002", key: "closer", name: "Closer", role_brief: "   ", active: true, compensation: "private" },
  { org_id: ORG_ID, id: "20000000-0000-4000-8000-000000000003", key: "old_role", name: "Old role", role_brief: "closed", active: false },
  { org_id: OTHER_ORG_ID, id: "20000000-0000-4000-8000-0000000000ff", key: "theirs", name: "Aaa Their role", role_brief: "x", active: true },
];

test("hiring/apply GET lists this company's open roles by name with key, name and brief only; a blank brief is null; no sign-in; cached for a minute", async () => {
  assert.equal(ROUTES["hiring/apply"], applyHandler);
  const rules = [
    [/SELECT id FROM orgs WHERE slug/, [{ id: ORG_ID }]],
    [/FROM hiring_roles\s+WHERE org_id = \$1 AND active/, (sql, p) => ROLE_ROWS
      .filter((r) => (!/WHERE org_id = \$1/.test(sql) || r.org_id === p[0]) && (!/AND active/.test(sql) || r.active))
      .sort((a, b) => a.name.localeCompare(b.name))],
  ];
  const done = await hit(applyHandler, { anonymous: true, method: "GET", rules });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, {
    ok: true,
    roles: [
      { key: "closer", name: "Closer", brief: null },
      { key: "setter", name: "Setter", brief: "  Book calls for the closers.  " },
    ],
  }, "an inactive role and another company's role are not listed; compensation and the scorecard never leave");
  assert.deepEqual(Object.keys(done.body.roles[0]).sort(), ["brief", "key", "name"]);
  assert.equal(done.headers["cache-control"], "public, max-age=60");
  const [call] = sqlCalls(done, /FROM hiring_roles/);
  assert.deepEqual(call.params, [ORG_ID]);
  assert.match(call.sql, /ORDER BY name ASC/);

  // A failed read is not cached for a minute.
  const failed = await hit(applyHandler, { anonymous: true, method: "GET", rules: [
    [/SELECT id FROM orgs WHERE slug/, [{ id: ORG_ID }]],
    [/FROM hiring_roles/, new Error("connection reset")],
  ] });
  assert.equal(failed.status, 500);
  assert.equal(failed.headers["cache-control"], "no-store");
  _resetOrgCache();
  const noOrg = await hit(applyHandler, { anonymous: true, method: "GET", rules: [[/SELECT id FROM orgs WHERE slug/, []]] });
  assert.equal(noOrg.status, 503);
  const put = await hit(applyHandler, { anonymous: true, method: "PUT", rules: [] });
  assert.equal(put.status, 405);
});

/* ── one application: a stand-in that keeps its own rows ─────────────────── */

function applyWorld({ attempts = [], applications = [], candidates = [], roles = ROLE_ROWS } = {}) {
  const world = { attempts, applications, candidates, tasks: [], invites: [], links: [] };
  let n = 0;
  const id = (prefix) => `${prefix}000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  world.rules = [
    [/SELECT id FROM orgs WHERE slug/, [{ id: ORG_ID }]],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)/, []],
    // the burst limiter: attempts from this address
    [/FROM hiring_apply_attempts a/, (_sql, p) => {
      const mine = world.attempts.filter((a) => a.org_id === p[0] && a.ip === p[1]);
      return [{ short_count: mine.length, long_count: mine.length }];
    }],
    // the durable limiter: applications by this email and in this company
    [/AS email_count/, (_sql, p) => {
      const byEmail = world.applications.filter((a) => a.org_id === p[0] && a.email === p[1]).length;
      const byOrg = world.applications.filter((a) => a.org_id === p[0]).length;
      return [{ email_count: byEmail, flood_count: byOrg }];
    }],
    [/INSERT INTO hiring_apply_attempts/, (_sql, p) => { world.attempts.push({ org_id: p[0], ip: p[1] }); return []; }],
    [/SELECT id, key FROM hiring_roles WHERE org_id = \$1 AND key = \$2 AND active/, (sql, p) => roles
      .filter((r) => r.org_id === p[0] && r.key === p[1] && r.active)
      .map((r) => ({ id: r.id, key: r.key }))],
    [/INSERT INTO candidates/, (sql, p) => {
      let row = world.candidates.find((c) => c.org_id === p[0] && c.email === p[2]);
      if (row && /ON CONFLICT \(org_id, email\)/.test(sql)) return [row];
      row = { id: id("ca"), org_id: p[0], full_name: p[1], email: p[2], phone: p[3], source: p[4], source_detail: p[5] };
      world.candidates.push(row);
      return [row];
    }],
    [/FROM pipeline_stages s\s+JOIN pipelines p/, (_sql, p) => (STAGE_IDS[p[1]] ? [{ id: STAGE_IDS[p[1]] }] : [])],
    [/INSERT INTO candidate_applications/, (sql, p) => {
      const open = world.applications.find((a) => a.candidate_id === p[1] && a.role_id === p[2] && a.status === "open");
      if (open && /ON CONFLICT \(candidate_id, role_id\) WHERE status = 'open' DO NOTHING/.test(sql)) return [];
      const email = world.candidates.find((c) => c.id === p[1])?.email;
      const row = { id: id("ab"), org_id: p[0], candidate_id: p[1], role_id: p[2], stage_id: p[3], answers: p[4], status: "open", email };
      world.applications.push(row);
      return [row];
    }],
    [/FROM candidate_applications\s+WHERE candidate_id = \$1 AND role_id = \$2 AND status = 'open'/, (_sql, p) =>
      world.applications.filter((a) => a.candidate_id === p[0] && a.role_id === p[1] && a.status === "open")],
    [/SELECT r\.hiring_manager_staff_id, r\.owner_role/, [{ hiring_manager_staff_id: null, owner_role: "sales_manager", manager_status: null }]],
    [/FROM tasks\s+WHERE client_id = \$1 AND source_workflow = \$2 AND body = \$3/, []],
    [/INSERT INTO tasks/, (_sql, p) => { world.tasks.push({ org_id: p[0], title: p[2], body: p[3], source_workflow: p[5], assignee_role: p[6] }); return [{ id: id("7a") }]; }],
    [/UPDATE candidates\s+SET linkedin_profile_url/, (_sql, p) => { world.links.push({ id: p[0], url: p[1] }); return []; }],
    [/FROM candidate_applications a\s+JOIN candidates c ON c\.id = a\.candidate_id\s+JOIN pipeline_stages s/, (_sql, p) => {
      const app = world.applications.find((a) => a.id === p[0] && a.org_id === p[1]);
      const cand = app && world.candidates.find((c) => c.id === app.candidate_id);
      return app ? [{ id: app.id, org_id: app.org_id, stage_key: "applied", full_name: cand.full_name, email: cand.email, email_opt_out_at: null }] : [];
    }],
    [/FROM eeo_survey_invites\s+WHERE application_id = \$1/, []],
    [/INSERT INTO eeo_survey_invites/, (_sql, p) => { const row = { id: id("e0"), org_id: p[0], application_id: p[1], survey_token: p[2], consumed_at: null }; world.invites.push(row); return [row]; }],
    [/FROM message_templates/, []],
  ];
  return world;
}

const GOOD = { role: "setter", name: "Riley Applicant", email: "Riley.Applicant@Example.test", phone: "(602) 555-0142", linkedin: "linkedin.com/in/riley", how_heard: "referral" };
const post = (world, body, headers = { "x-nf-client-connection-ip": IP }) =>
  hit(applyHandler, { anonymous: true, method: "POST", body, headers, rules: world.rules });
const RECEIVED = { ok: true, received: true };

test("hiring/apply POST saves one candidate and one application in stage applied, queues a task for a person, decides nothing, and answers received", async () => {
  const world = applyWorld();
  const done = await post(world, GOOD);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(done.body, RECEIVED);
  assert.equal(done.headers["cache-control"], "no-store");
  assert.equal(world.candidates.length, 1);
  assert.equal(world.candidates[0].email, "riley.applicant@example.test", "the address is stored lowercase");
  assert.equal(world.candidates[0].full_name, "Riley Applicant");
  assert.equal(world.candidates[0].phone, "6025550142");
  assert.equal(world.candidates[0].source, "referral");
  assert.equal(world.candidates[0].org_id, ORG_ID);
  assert.equal(world.applications.length, 1);
  assert.equal(world.applications[0].stage_id, STAGE_IDS.applied, "the application opens in applied");
  assert.equal(world.applications[0].role_id, ROLE_ID);
  assert.equal(world.applications[0].org_id, ORG_ID);
  assert.deepEqual(JSON.parse(world.applications[0].answers), {}, "no questionnaire exists, so no answers are stored");
  assert.deepEqual(world.links, [{ id: world.candidates[0].id, url: "https://linkedin.com/in/riley" }]);
  assert.equal(world.tasks.length, 1);
  assert.equal(world.tasks[0].source_workflow, "hiring-new-application");
  assert.equal(world.tasks[0].assignee_role, "sales_manager", "the standing rule for this role names who works it");
  assert.equal(done.db.calls.some((c) => /INSERT INTO hiring_decisions|UPDATE candidate_applications/.test(c.sql)), false, "nothing is decided, scored or moved");
  assert.equal(done.db.count("BEGIN"), 1);
  assert.equal(done.db.count("COMMIT"), 1);
  assert.equal(world.attempts.length, 1, "the attempt is recorded for the limiter");
  assert.deepEqual(world.attempts[0], { org_id: ORG_ID, ip: IP });
});

test("hiring/apply POST gives a person, a returning person and a bot the same reply, and stores a second application for the same role only once", async () => {
  const world = applyWorld();
  const first = await post(world, GOOD);
  const again = await post(world, { ...GOOD, name: "Riley A." });
  assert.deepEqual(again.body, first.body);
  assert.equal(world.applications.length, 1, "an open application for that role is never doubled");
  assert.equal(world.candidates.length, 1, "the same person is one candidate");

  const bot = applyWorld();
  const caught = await post(bot, { ...GOOD, website: "https://spam.example" });
  assert.equal(caught.status, 200);
  assert.deepEqual(caught.body, RECEIVED, "the bot is told nothing");
  assert.equal(bot.candidates.length, 0);
  assert.equal(bot.applications.length, 0);
  assert.equal(caught.db.count("BEGIN"), 0, "no write is opened for a bot");
  assert.equal(bot.attempts.length, 1, "the attempt still counts against its source");
});

test("hiring/apply POST is burst-limited per address and per email, and says when to come back", async () => {
  const flood = applyWorld({ attempts: Array.from({ length: 5 }, () => ({ org_id: ORG_ID, ip: IP })) });
  const limited = await post(flood, GOOD);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate_limited");
  assert.equal(limited.body.retryAfterMinutes, 15);
  assert.equal(limited.headers["retry-after"], "900");
  assert.equal(flood.candidates.length, 0, "a refused flood writes no candidate");
  assert.equal(flood.attempts.length, 6, "a refused attempt is still counted");

  const other = await post(flood, GOOD, { "x-nf-client-connection-ip": "198.51.100.9" });
  assert.equal(other.status, 200, "another address is not locked out");

  const same = applyWorld({ applications: Array.from({ length: 5 }, (_, i) => ({ org_id: ORG_ID, email: "riley.applicant@example.test", status: "closed", id: `x${i}` })) });
  const byEmail = await post(same, GOOD);
  assert.equal(byEmail.status, 429);
  assert.equal(same.candidates.length, 0);
});

test("hiring/apply POST refuses protected fields, a missing name or email, a link in the name, an unknown role and a body that is not JSON, and stores nothing", async () => {
  const cases = [
    [{ ...GOOD, race: "x" }, 400, "protected_field_refused"],
    [{ ...GOOD, eeo_gender: "x" }, 400, "protected_field_refused"],
    [{ ...GOOD, answers: { why: "x" } }, 400, "unsupported_field"],
    [{ ...GOOD, name: "" }, 400, "name_email_required"],
    [{ ...GOOD, email: "not-an-email" }, 400, "name_email_required"],
    [{ ...GOOD, name: "Visit https://spam.example" }, 400, "name_email_required"],
    [{ ...GOOD, role: "" }, 400, "role_required"],
    [{ ...GOOD, linkedin: "https://evil.example/in/riley" }, 400, "linkedin_url_invalid"],
    [{ ...GOOD, role: "no_such_role" }, 400, "role_unavailable"],
    [{ ...GOOD, role: "old_role" }, 400, "role_unavailable"],
  ];
  for (const [body, status, error] of cases) {
    const world = applyWorld();
    const out = await post(world, body);
    assert.equal(out.status, status, error);
    assert.equal(out.body.error, error);
    assert.equal(world.candidates.length, 0, `${error}: no candidate`);
    assert.equal(world.applications.length, 0, `${error}: no application`);
  }
  const world = applyWorld();
  const junk = await hit(applyHandler, { anonymous: true, method: "POST", body: "{not json", headers: { "x-nf-client-connection-ip": IP }, rules: world.rules });
  assert.equal(junk.status, 400);
  assert.equal(junk.body.error, "invalid_json");
});

/* ── hiring/decide: the one place a person moves or rejects a candidate ──── */

const APP_ID = "ab000000-0000-4000-8000-0000000000a1";
const STAFF_ID = "5a000000-0000-4000-8000-000000000001";

function decideWorld({ status = "open", stage = "applied", found = true, recommendation = "advance" } = {}) {
  const world = { decisions: [], tasks: [], updates: [] };
  world.rules = [
    [/^\s*(BEGIN|COMMIT|ROLLBACK)/, []],
    [/FROM candidate_applications a\s+JOIN pipeline_stages s ON s\.id = a\.stage_id WHERE a\.id = \$1\s+FOR UPDATE OF a/, (_sql, p) =>
      (found && p[0] === APP_ID ? [{ id: APP_ID, org_id: ORG_ID, status, stage_key: stage, stage_id: STAGE_IDS[stage] || STAGE_IDS.applied }] : [])],
    [/FROM pipeline_stages s\s+JOIN pipelines p/, (_sql, p) => (STAGE_IDS[p[1]] ? [{ id: STAGE_IDS[p[1]] }] : [])],
    [/SELECT recommendation FROM application_scores/, recommendation ? [{ recommendation }] : []],
    [/INSERT INTO hiring_decisions/, (sql, p) => {
      const reject = /VALUES \(\$1,\$2,'reject'/.test(sql);
      const row = reject
        ? { org_id: p[0], application_id: p[1], decision: "reject", from_stage_key: p[2], to_stage_key: "rejected", decided_by: p[3], reason: p[4], recommendation_at_decision: p[6] }
        : { org_id: p[0], application_id: p[1], decision: p[2], from_stage_key: p[3], to_stage_key: p[4], decided_by: p[5], reason: p[6], recommendation_at_decision: p[8] };
      world.decisions.push(row);
      return [row];
    }],
    [/UPDATE candidate_applications/, (sql, p) => { world.updates.push({ sql, params: p }); return [{ id: p[0], stage_id: p[1], status: /status = 'rejected'/.test(sql) ? "rejected" : "open" }]; }],
    [/FROM tasks\s+WHERE client_id = \$1 AND source_workflow = \$2 AND body = \$3/, []],
    [/INSERT INTO tasks/, (_sql, p) => { world.tasks.push({ org_id: p[0], title: p[2], body: p[3], source_workflow: p[5], assignee_role: p[6] }); return [{ id: "task-1" }]; }],
  ];
  return world;
}
const decide = (world, body, options = {}) => hit(decideHandler, { method: "POST", body, rules: world.rules, ...options });

test("hiring/decide advance moves one application to the stage asked for and writes who decided, from where, to where and the machine's advice at the time", async () => {
  assert.equal(ROUTES["hiring/decide"], decideHandler);
  const world = decideWorld({ recommendation: "advance" });
  const done = await decide(world, { application_id: APP_ID, action: "advance", to_stage: "screening", reason: " strong video " }, { role: "admin" });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.deepEqual(world.decisions, [{
    org_id: ORG_ID, application_id: APP_ID, decision: "advance", from_stage_key: "applied", to_stage_key: "screening",
    decided_by: STAFF_ID, reason: "strong video", recommendation_at_decision: "advance",
  }]);
  assert.equal(done.body.decision.decided_by, STAFF_ID, "the person is the session, never the request");
  const [update] = world.updates;
  assert.deepEqual(update.params, [APP_ID, STAGE_IDS.screening, "screening"]);
  assert.equal(done.db.count("BEGIN"), 1);
  assert.equal(done.db.count("COMMIT"), 1);
  assert.equal(done.db.count("ROLLBACK"), 0);
  assert.equal(world.tasks.length, 0, "advancing sends no candidate feedback");

  const offer = decideWorld({ stage: "one_on_one" });
  await decide(offer, { application_id: APP_ID, action: "advance", to_stage: "offer" });
  assert.equal(offer.decisions[0].decision, "offer", "moving to offer is recorded as an offer");

  const noReason = decideWorld();
  const quiet = await decide(noReason, { application_id: APP_ID, action: "advance", to_stage: "screening" });
  assert.equal(quiet.status, 200);
  assert.equal(noReason.decisions[0].reason, null, "no reason typed is stored as absent, never invented");
});

test("hiring/decide reject needs a written reason, writes the decision and the rejected stage in one transaction, and queues a feedback task for a person; nothing is emailed", async () => {
  const world = decideWorld({ stage: "group_interview", recommendation: null });
  const realFetch = globalThis.fetch;
  let wire = 0;
  globalThis.fetch = async () => { wire += 1; throw new Error("trapped"); };
  try {
    const done = await decide(world, { application_id: APP_ID, action: "reject", reason: "  not a fit for the phones  " });
    assert.equal(done.status, 200);
    assert.deepEqual(world.decisions, [{
      org_id: ORG_ID, application_id: APP_ID, decision: "reject", from_stage_key: "group_interview", to_stage_key: "rejected",
      decided_by: STAFF_ID, reason: "not a fit for the phones", recommendation_at_decision: null,
    }]);
    assert.equal(world.updates.length, 1);
    assert.match(world.updates[0].sql, /SET status = 'rejected', stage_id = \$2/);
    assert.deepEqual(world.updates[0].params, [APP_ID, STAGE_IDS.rejected]);
    assert.equal(world.tasks.length, 1);
    assert.equal(world.tasks[0].source_workflow, "hiring-candidate-feedback");
    assert.equal(world.tasks[0].assignee_role, "admin");
    assert.match(world.tasks[0].title, new RegExp(`application ${APP_ID}`));
    assert.equal(done.db.count("COMMIT"), 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(wire, 0, "no email, no text");

  const blank = decideWorld();
  const noReason = await decide(blank, { application_id: APP_ID, action: "reject", reason: "   " });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, "reason_required");
  assert.equal(blank.decisions.length, 0);
  assert.equal(blank.updates.length, 0);
});

test("hiring/decide refuses a body that names the decider or the company, an unknown stage or action, a closed application and an unknown one; nothing changes", async () => {
  const cases = [
    [{ application_id: APP_ID, action: "reject", reason: "x", decided_by: "someone-else" }, 400, "decided_by_not_accepted", {}],
    [{ application_id: APP_ID, action: "reject", reason: "x", decided_by_staff_id: "someone-else" }, 400, "decided_by_staff_id_not_accepted", {}],
    [{ application_id: APP_ID, action: "advance", to_stage: "screening", org_id: OTHER_ORG_ID }, 400, "org_id_not_accepted", {}],
    [{ action: "advance", to_stage: "screening" }, 400, "application_id_required", {}],
    [{ application_id: APP_ID, action: "advance", to_stage: "rejected" }, 400, "unknown_stage", {}],
    [{ application_id: APP_ID, action: "hire" }, 400, "invalid_action", {}],
    [{ application_id: APP_ID, action: "advance", to_stage: "screening" }, 404, "application_not_found", { found: false }],
  ];
  for (const [body, status, error, options] of cases) {
    const world = decideWorld(options);
    const out = await decide(world, body);
    assert.equal(out.status, status, error);
    assert.equal(out.body.error, error);
    assert.equal(world.decisions.length, 0, error);
    assert.equal(world.updates.length, 0, error);
  }
  for (const action of ["advance", "reject"]) {
    const world = decideWorld({ status: "hired" });
    const out = await decide(world, { application_id: APP_ID, action, to_stage: "screening", reason: "x" });
    assert.equal(out.status, 409, action);
    assert.match(out.body.error, /not open/);
    assert.equal(world.decisions.length, 0);
    assert.equal(out.db.count("ROLLBACK"), 1, "a refused move rolls back");
  }
});

test("hiring/decide lets in owner and admin only and answers nothing to another verb", async () => {
  const world = decideWorld();
  await assertRoleGate(decideHandler, ["owner", "admin"], { method: "POST", body: { application_id: APP_ID, action: "advance", to_stage: "screening" }, rules: world.rules });
  assert.equal(world.decisions.length, 2, "only the owner and the admin got as far as a decision");
  const get = await hit(decideHandler, { method: "GET", rules: world.rules });
  assert.equal(get.status, 405);
  const signedOut = await hit(decideHandler, { anonymous: true, method: "POST", body: { application_id: APP_ID, action: "reject", reason: "x" }, rules: world.rules });
  assert.equal(signedOut.status, 401);
  assert.equal(world.decisions.length, 2, "nobody signed out decided anything");
});
