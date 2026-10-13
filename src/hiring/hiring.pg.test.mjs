// The hiring pipeline against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// The tests that matter here are the ones that try to reject a candidate without a
// human. That invariant is enforced in three places — the reject() argument check,
// the hiring_decisions CHECK, and the terminal-status trigger — and each is
// attacked separately, because "no candidate is rejected by software" is only true
// if the layer that happens to be reached first is not the only one holding.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { apply, scoreApplication, advance, reject, recordGroupInterview, stageIdFor } from "./pipeline.mjs";
import { checkBench, rampReview } from "./bench.mjs";
import { normaliseApplication } from "./linkedin.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "hiretest";

describe("hiring pipeline", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    // A fixture staff row, CREATED rather than looked up.
    //
    // This started as `SELECT id FROM staff LIMIT 1` with every human-gate test
    // guarded by `if (!staffId) return`. On a fresh database there are no staff, so
    // the guards fired and the most important assertions in this file — that a
    // proper human rejection works, that the database demands a reason — passed
    // without executing. A test that skips itself into green is worse than a
    // missing test, because it reports coverage it does not have.
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status, active)
       VALUES ($1,$2,$3,'admin','active',true) RETURNING id`,
      [org, `${TAG} recruiter`, `${TAG}-recruiter@example.test`])).rows[0].id;
  });
  after(async () => { await cleanup(); await close(); });

  // ------------------------------------------------------------------ schema

  test("the hiring pipeline is SEPARATE from affiliates and has the doc-10 funnel", async () => {
    const stages = (await db.query(
      `SELECT s.key FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE p.org_id = $1 AND p.key = 'hiring' ORDER BY s.sort_order`, [org])).rows.map((r) => r.key);
    assert.deepStrictEqual(stages, [
      "applied", "screening", "group_interview", "one_on_one", "offer",
      "hired", "onboarding", "ramp", "performing", "rejected", "withdrawn"]);

    // R-07 (affiliates_hiring) is retired — partners live on affiliates_white_label.
    const retired = (await db.query(
      `SELECT count(*)::int AS n FROM pipelines
        WHERE org_id = $1 AND key = 'affiliates_hiring'`, [org])).rows[0].n;
    assert.strictEqual(retired, 0, "affiliates_hiring must be retired (migration 127)");

    const awl = (await db.query(
      `SELECT s.key FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE p.org_id = $1 AND p.key = 'affiliates_white_label' ORDER BY s.sort_order`, [org]))
      .rows.map((r) => r.key);
    assert.deepStrictEqual(awl, [
      "recruiting", "invited", "agreement_signed", "active", "paused"]);
  });

  test("mock_call is NOT a seeded stage — doc 9 retires it", async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE p.org_id = $1 AND p.key = 'hiring' AND s.key = 'mock_call'`, [org]);
    assert.deepStrictEqual(rows, []);
  });

  test("an application cannot be parked in a non-hiring stage", async () => {
    const { application } = await mkApplication("stray");
    const salesStage = (await db.query(
      `SELECT s.id FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
        WHERE p.key = 'sales' LIMIT 1`)).rows[0].id;
    // A candidate sitting in a Sales stage would render on the closer board.
    await assert.rejects(
      () => db.query(`UPDATE candidate_applications SET stage_id = $1 WHERE id = $2`,
        [salesStage, application.id]),
      /must belong to the hiring pipeline/);
  });

  test("scorecards have STRUCTURE but no targets, and stay flagged in the gaps view", async () => {
    // 052 filled in the scorecard shape from doc 7's model and left every target
    // null, because doc 7 links to external scorecard documents that were not in
    // the folder. This test guards that split: a template a manager fills in is
    // useful, whereas invented targets become a performance agreement a real person
    // is held to.
    const roles = (await db.query(
      `SELECT key, scorecard, comp FROM hiring_roles WHERE org_id = $1 ORDER BY key`, [org])).rows;
    assert.deepStrictEqual(roles.map((r) => r.key),
      ["closer", "coo", "csm", "sales_coordinator", "setter"],
      "051 seeded three reqs; 294 added csm; 480 added coo (owner-set 2026-10-13)");

    /* ONLY THE ROLES 052 ACTUALLY FILLED IN ARE CHECKED FOR STRUCTURE.
       csm was created later by 294 with an empty scorecard, deliberately: 051's
       rule is that an invented scorecard becomes a performance agreement a real
       person is held to, and 294 followed it. So an empty scorecard on a newer
       role is the rule working, not a regression. It is still asserted below —
       as a reported gap, which is where an unfilled scorecard belongs. */
    const filled = roles.filter((r) => Object.keys(r.scorecard).length > 0);
    assert.ok(filled.length >= 3, "052 filled the three roles it knew about");

    for (const r of filled) {
      assert.ok(r.scorecard.outcomes?.length > 0, `${r.key} should have outcomes`);
      assert.ok(r.scorecard.leading_indicators?.length > 0, `${r.key} should have leading indicators`);
      // Every target null — no invented numbers.
      for (const m of [...r.scorecard.outcomes, ...r.scorecard.leading_indicators]) {
        assert.strictEqual(m.target, null, `${r.key}.${m.key} must not carry an invented target`);
      }
      assert.ok(r.scorecard.source_note, "the scorecard must say where it came from");
    }

    // And it is STILL reported, because a default that stops being visible is a
    // default nobody re-examines.
    const gaps = (await db.query(
      `SELECT config, status FROM v_hiring_config_gaps WHERE org_id = $1`, [org])).rows;
    assert.ok(gaps.some((g) => /STRUCTURE ONLY/.test(g.status)),
      "null scorecard targets must still be surfaced after 052");
    assert.ok(gaps.some((g) => /UNSOURCED/.test(g.status)),
      "null comp figures must still be surfaced after 052");
  });

  // ------------------------------------------------------------------ intake

  test("apply creates a candidate and an application in `applied`", async () => {
    const { application, candidate, created } = await mkApplication("alice");
    assert.strictEqual(created, true);
    assert.strictEqual(application.status, "open");
    const stage = await stageKeyOf(application.id);
    assert.strictEqual(stage, "applied");
    assert.strictEqual(candidate.source, "linkedin");
  });

  test("a new application notifies the req owner via a task", async () => {
    const { application, created } = await mkApplication("notify-me");
    assert.strictEqual(created, true);
    const task = (await db.query(
      `SELECT id, assignee_role FROM tasks
        WHERE source_workflow = 'hiring-new-application' AND body = $1`,
      [`hiring:applied:${application.id}`])).rows[0];
    assert.ok(task, "a new application must queue review");
    assert.strictEqual(task.assignee_role, "sales_manager",
      "closer routes to sales_manager per migration 294");
  });

  test("re-applying does not stack duplicate review tasks", async () => {
    const first = await mkApplication("no-dup-task");
    await mkApplication("no-dup-task");
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE source_workflow = 'hiring-new-application' AND body = $1`,
      [`hiring:applied:${first.application.id}`])).rows[0].n;
    assert.strictEqual(n, 1);
  });

  test("re-applying while open is idempotent — no duplicate application", async () => {
    await mkApplication("bob");
    const second = await mkApplication("bob");
    assert.strictEqual(second.created, false);
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM candidate_applications a JOIN candidates c ON c.id = a.candidate_id
        WHERE c.email = $1`, [email("bob")])).rows[0].n;
    assert.strictEqual(n, 1);
  });

  test("a redelivered external application does not create a second row", async () => {
    const a = await withTx((tx) => apply(tx, base("carol", { externalApplicationId: "li-999" })));
    const b = await withTx((tx) => apply(tx, base("carol", { externalApplicationId: "li-999" })));
    assert.strictEqual(b.created, false);
    assert.strictEqual(a.application.id, b.application.id);
  });

  test("PROTECTED FIELDS ARE NOT STORED, not merely not scored", async () => {
    const out = await withTx((tx) => apply(tx, base("dana", {
      answers: { effort: "very thorough", age: 41, gender: "f", relevant_experience: "5y" }
    })));
    assert.deepStrictEqual(out.strippedProtected.sort(), ["age", "gender"]);

    const stored = (await db.query(
      `SELECT answers FROM candidate_applications WHERE id = $1`, [out.application.id])).rows[0].answers;
    assert.deepStrictEqual(Object.keys(stored).sort(), ["effort", "relevant_experience"]);
    // Data never collected cannot be scored by a later grader, or subpoenaed.
    assert.strictEqual(stored.age, undefined);
  });

  test("the same person can apply for a second role", async () => {
    // Doc 5: setters becoming closers. One person, many applications.
    await withTx((tx) => apply(tx, base("erin", { roleKey: "setter" })));
    const second = await withTx((tx) => apply(tx, base("erin", { roleKey: "closer" })));
    assert.strictEqual(second.created, true);
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM candidates WHERE email = $1`, [email("erin")])).rows[0].n;
    assert.strictEqual(n, 1, "one person, not two candidate rows");
  });

  // ------------------------------------------------------------------ scoring

  test("scoring persists the rubric version as applied", async () => {
    const { application } = await mkApplication("frank");
    const { score, result } = await withTx((tx) => scoreApplication(tx, {
      orgId: org, applicationId: application.id,
      categoryScores: full(3)
    }));
    assert.strictEqual(Number(score.average), 3);
    assert.strictEqual(score.recommendation, "advance");
    assert.strictEqual(score.rubric_version, 1);
    assert.strictEqual(score.is_automated, true);
    assert.strictEqual(score.scored_by_staff_id, null);
    assert.strictEqual(result.recommendation, "advance");
  });

  test("a human score records the human", async () => {
    const { application } = await mkApplication("gina");
    const { score } = await withTx((tx) => scoreApplication(tx, {
      orgId: org, applicationId: application.id, categoryScores: full(4), scoredByStaffId: staffId
    }));
    assert.strictEqual(score.is_automated, false);
    assert.strictEqual(score.scored_by_staff_id, staffId);
  });

  test("an automated score claiming a human is rejected at the engine", async () => {
    const { application } = await mkApplication("hank");
    await assert.rejects(
      () => db.query(
        `INSERT INTO application_scores
           (org_id, application_id, stage_key, rubric_version, average, is_automated, scored_by_staff_id)
         VALUES ($1,$2,'applied',1,3,true,$3)`, [org, application.id, staffId]),
      /application_scores_actor_ck/);
  });

  test("scores cannot be deleted — they are the audit trail", async () => {
    const { application } = await mkApplication("iris");
    const { score } = await withTx((tx) => scoreApplication(tx, {
      orgId: org, applicationId: application.id, categoryScores: full(2) }));
    await assert.rejects(
      () => db.query(`DELETE FROM application_scores WHERE id = $1`, [score.id]),
      /not deletable/);
  });

  // ------------------------------------------------------------- THE HUMAN GATE

  describe("no candidate is ever rejected by software", () => {
    test("layer 1: reject() refuses without a staff id", async () => {
      const { application } = await mkApplication("jack");
      await assert.rejects(
        () => withTx((tx) => reject(tx, {
          orgId: org, applicationId: application.id, reason: "not a fit" })),
        /No candidate may be rejected by software/);
    });

    test("reject() also refuses without a reason", async () => {
      const { application } = await mkApplication("kate");
      await assert.rejects(
        () => withTx((tx) => reject(tx, {
          orgId: org, applicationId: application.id, decidedByStaffId: staffId, reason: "  " })),
        /a reason is required/);
    });

    test("layer 2: the DATABASE refuses a reject decision with no human", async () => {
      const { application } = await mkApplication("liam");
      await assert.rejects(
        () => db.query(
          `INSERT INTO hiring_decisions (org_id, application_id, decision, reason)
           VALUES ($1,$2,'reject','no good')`, [org, application.id]),
        /hiring_decisions_human_ck/);
    });

    test("layer 2: the database refuses a reject decision with no reason", async () => {
      const { application } = await mkApplication("mia");
      await assert.rejects(
        () => db.query(
          `INSERT INTO hiring_decisions (org_id, application_id, decision, decided_by)
           VALUES ($1,$2,'reject',$3)`, [org, application.id, staffId]),
        /hiring_decisions_human_ck/);
    });

    test("layer 3: an application cannot be marked rejected with no decision row", async () => {
      // The bypass a script would take: skip the decision, set the status.
      const { application } = await mkApplication("noah");
      await assert.rejects(
        () => db.query(`UPDATE candidate_applications SET status = 'rejected' WHERE id = $1`,
          [application.id]),
        /cannot be rejected without a hiring_decisions row naming the human/);
    });

    test("a proper human rejection works and records everything", async () => {
      const { application } = await mkApplication("olivia");
      const { score } = await withTx((tx) => scoreApplication(tx, {
        orgId: org, applicationId: application.id, categoryScores: full(1) }));

      const out = await withTx((tx) => reject(tx, {
        orgId: org, applicationId: application.id, decidedByStaffId: staffId,
        reason: "no relevant experience and unclear goals", scoreId: score.id }));

      assert.strictEqual(out.application.status, "rejected");
      assert.strictEqual(out.decision.decided_by, staffId);
      // What the machine had said, so "how often do humans follow it" is answerable.
      assert.strictEqual(out.decision.recommendation_at_decision, "review_likely_no");
      assert.strictEqual(await stageKeyOf(application.id), "rejected");

      // Doc 11's feedback obligation became a task.
      const task = (await db.query(
        `SELECT id FROM tasks WHERE source_workflow = 'hiring-candidate-feedback'
          AND body = $1`, [`hiring:feedback:${application.id}`])).rows[0];
      assert.ok(task, "a rejection must queue candidate feedback");
    });

    test("decisions cannot be deleted", async () => {
      const { application } = await mkApplication("pete");
      const out = await withTx((tx) => advance(tx, {
        orgId: org, applicationId: application.id, toStageKey: "screening",
        decidedByStaffId: staffId }));
      await assert.rejects(
        () => db.query(`DELETE FROM hiring_decisions WHERE id = $1`, [out.decision.id]),
        /not deletable/);
    });
  });

  // ------------------------------------------------------------------ progression

  test("advance moves the stage and logs the decision", async () => {
    const { application } = await mkApplication("quinn");
    const out = await withTx((tx) => advance(tx, {
      orgId: org, applicationId: application.id, toStageKey: "group_interview" }));
    assert.strictEqual(await stageKeyOf(application.id), "group_interview");
    assert.strictEqual(out.decision.decision, "advance");
    assert.strictEqual(out.decision.from_stage_key, "applied");
  });

  test("advance refuses to be used as a rejection", async () => {
    const { application } = await mkApplication("rosa");
    await assert.rejects(
      () => withTx((tx) => advance(tx, {
        orgId: org, applicationId: application.id, toStageKey: "rejected" })),
      /not a forward stage. To reject, call reject\(\)/);
  });

  test("an offer requires a named human at the engine", async () => {
    const { application } = await mkApplication("sam");
    await assert.rejects(
      () => db.query(
        `INSERT INTO hiring_decisions (org_id, application_id, decision) VALUES ($1,$2,'offer')`,
        [org, application.id]),
      /hiring_decisions_offer_ck/);
  });

  test("group interview: yes AND maybe both advance; no waits for a human", async () => {
    // Doc 11, implemented literally.
    const yes = await mkApplication("tina");
    const maybe = await mkApplication("umar");
    const no = await mkApplication("vera");
    for (const a of [yes, maybe, no]) {
      await withTx((tx) => advance(tx, {
        orgId: org, applicationId: a.application.id, toStageKey: "group_interview" }));
    }

    const interviewId = (await db.query(
      `INSERT INTO hiring_interviews (org_id, kind, scheduled_for, meeting_url)
       VALUES ($1,'group',now(),'https://zoom.test/abc') RETURNING id`, [org])).rows[0].id;

    const results = await withTx((tx) => recordGroupInterview(tx, {
      orgId: org, interviewId,
      outcomes: [
        { applicationId: yes.application.id, outcome: "yes" },
        { applicationId: maybe.application.id, outcome: "maybe" },
        { applicationId: no.application.id, outcome: "no" }
      ]
    }));

    assert.strictEqual(await stageKeyOf(yes.application.id), "one_on_one");
    assert.strictEqual(await stageKeyOf(maybe.application.id), "one_on_one",
      "a maybe must advance — the SOP says move 50/50 candidates forward");

    // A 'no' is NOT auto-rejected. That is an adverse action and needs a human.
    assert.strictEqual(await stageKeyOf(no.application.id), "group_interview");
    const noRow = (await db.query(
      `SELECT status FROM candidate_applications WHERE id = $1`, [no.application.id])).rows[0];
    assert.strictEqual(noRow.status, "open");
    assert.strictEqual(results.find((r) => r.outcome === "no").awaitingHumanDecision, true);

    const task = (await db.query(
      `SELECT id FROM tasks WHERE source_workflow = 'hiring-group-interview-review'
        AND body = $1`, [`hiring:gi-no:${interviewId}:${no.application.id}`])).rows[0];
    assert.ok(task, "a 'no' must queue a human to decide and record it");

    const held = (await db.query(
      `SELECT status FROM hiring_interviews WHERE id = $1`, [interviewId])).rows[0];
    assert.strictEqual(held.status, "held");
  });

  // ------------------------------------------------------------------ bench

  test("the bench counts only candidates past the group interview", async () => {
    const a = await mkApplication("wanda", "setter");
    // In `applied`, so it must NOT count toward the bench.
    let bench = await benchFor("setter");
    assert.strictEqual(bench.bench_count, 0);
    assert.ok(bench.open_applications >= 1);

    await withTx((tx) => advance(tx, {
      orgId: org, applicationId: a.application.id, toStageKey: "one_on_one" }));
    bench = await benchFor("setter");
    assert.strictEqual(bench.bench_count, 1);
    assert.strictEqual(bench.bench_shortfall, 3, "target 4 minus 1");
  });

  test("a short bench opens a task, and re-running the same day does not duplicate it", async () => {
    const first = await withTx((tx) => checkBench(tx, { orgId: org, today: "2026-07-30" }));
    assert.ok(first.shortfalls.length >= 1, "the fixture bench is short");

    const second = await withTx((tx) => checkBench(tx, { orgId: org, today: "2026-07-30" }));
    for (const s of second.shortfalls) {
      assert.strictEqual(s.task_created, false, "a second run the same day must dedupe");
    }

    const n = (await db.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE source_workflow = 'hiring-bench-monitor' AND body LIKE '%2026-07-30'`)).rows[0].n;
    /* The ceiling is DERIVED, not the literal 3 it used to be. That 3 was the
       number of roles 051 seeded, so adding a fourth (csm, in 294) failed this
       test without anything being wrong — the assertion was pinned to a fixture
       count rather than to the rule it is checking, which is "at most one task
       per role". Counting the roles keeps the rule and survives the next one. */
    const roles = (await db.query(
      `SELECT count(*)::int AS n FROM hiring_roles WHERE org_id = $1 AND active`,
      [org])).rows[0].n;
    assert.ok(n >= 1 && n <= roles,
      `expected at most one task per active role (${roles}), got ${n}`);
  });

  test("ramp review queues a 60-day trial review, and decides nothing", async () => {
    const a = await mkApplication("xena", "closer");
    const rampStage = await withTx((tx) => stageIdFor(tx, { orgId: org, stageKey: "ramp" }));
    await db.query(
      `UPDATE candidate_applications SET stage_id = $2, entered_stage_at = now() - interval '61 days'
        WHERE id = $1`, [a.application.id, rampStage]);

    const due = await withTx((tx) => rampReview(tx, { orgId: org }));
    const mine = due.find((d) => d.application_id === a.application.id);
    assert.ok(mine, "a 61-day ramp must come up for review");
    assert.ok(mine.days_in_ramp >= 60);

    // Still open. "When to fire" is a human judgement.
    const row = (await db.query(
      `SELECT status FROM candidate_applications WHERE id = $1`, [a.application.id])).rows[0];
    assert.strictEqual(row.status, "open");
  });

  // ------------------------------------------------------------------ linkedin

  test("normaliseApplication maps only what the applicant submitted", () => {
    const out = normaliseApplication({
      id: "urn:li:jobApplication:123",
      firstName: "Yuki", lastName: "Tanaka",
      emailAddress: "  YUKI@Example.COM ",
      phoneNumber: { number: "+15551234" },
      questionAnswers: [
        { question: { localized: { en_US: "Why this role?" } }, answer: { localized: { en_US: "I sell." } } },
        { question: "Years selling", answer: "5" }
      ],
      // Profile fields LinkedIn may include. None of these may be carried across.
      profilePicture: "https://media/photo.jpg",
      headline: "Closer at Acme",
      school: "State University",
      currentEmployer: "Acme"
    }, { id: "posting-1", role_key: "closer", title: "Closer" });

    assert.strictEqual(out.email, "yuki@example.com");
    assert.strictEqual(out.fullName, "Yuki Tanaka");
    assert.strictEqual(out.source, "linkedin");
    assert.deepStrictEqual(Object.keys(out.answers).sort(), ["why_this_role", "years_selling"]);

    // The whole point: no profile data anywhere in the result.
    const serialised = JSON.stringify(out);
    for (const leak of ["photo.jpg", "State University", "Acme", "headline"]) {
      assert.ok(!serialised.includes(leak), `profile field leaked into intake: ${leak}`);
    }
  });

  test("an application with no contact details is reported, not silently dropped", () => {
    const out = normaliseApplication({ id: "urn:1", questionAnswers: [] }, { role_key: "closer" });
    assert.strictEqual(out.email, null);
    assert.strictEqual(out.fullName, null);
  });

  // ------------------------------------------------------------------ helpers

  const email = (n) => `${TAG}-${n}@example.test`;
  const base = (n, over = {}) => ({
    orgId: org, roleKey: "closer", fullName: `${TAG} ${n}`, email: email(n),
    source: "linkedin", answers: { effort: "thorough" }, ...over
  });
  const full = (n) => ({
    effort: n, honesty: n, income_goal_fit: n, relevant_experience: n,
    sales_inputs: n, work_history: n
  });

  async function mkApplication(n, roleKey = "closer") {
    return withTx((tx) => apply(tx, base(n, { roleKey })));
  }

  async function stageKeyOf(applicationId) {
    const { rows } = await db.query(
      `SELECT s.key FROM candidate_applications a JOIN pipeline_stages s ON s.id = a.stage_id
        WHERE a.id = $1`, [applicationId]);
    return rows[0]?.key;
  }

  async function benchFor(roleKey) {
    const { rows } = await db.query(
      `SELECT * FROM v_hiring_bench WHERE org_id = $1 AND role_key = $2`, [org, roleKey]);
    return rows[0];
  }

  /* These tables carry no RLS — hiring is fundhub-internal and staff-gated, not
     partner-scoped — so a plain transaction is enough. */
  async function withTx(fn) {
    const client = await (await import("../db.mjs")).pool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn({ query: (sql, params) => client.query(sql, params) });
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* the original error matters */ }
      throw e;
    } finally { client.release(); }
  }

  /* ALL OF THIS RUNS IN ONE TRANSACTION, ON PURPOSE.
     `ALTER TABLE … DISABLE TRIGGER` is table-wide DDL, not a session setting. Run
     on the pool outside a transaction it commits immediately, so for the length of
     the cleanup EVERY OTHER CONNECTION sees the audit-trail guards switched off —
     including a concurrently running test asserting that a score cannot be
     deleted, which then fails with "Missing expected rejection" for reasons that
     have nothing to do with it. Inside a transaction the ALTER takes an ACCESS
     EXCLUSIVE lock and the change is invisible until COMMIT: a concurrent deleter
     waits and then meets the re-enabled trigger. Same effect here, none there. */
  async function cleanup() {
    await withTx(async (tx) => {
      const ids = (await tx.query(
        `SELECT id FROM candidates WHERE email LIKE $1`, [`${TAG}-%`])).rows.map((r) => r.id);
      for (const [t, trg] of [["application_scores", "trg_application_scores_no_delete"],
                              ["hiring_decisions", "trg_hiring_decisions_no_delete"]]) {
        await tx.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
      }
      await tx.query(`ALTER TABLE candidate_applications DISABLE TRIGGER trg_application_terminal`);
      if (ids.length) {
        const apps = (await tx.query(
          `SELECT id FROM candidate_applications WHERE candidate_id = ANY($1)`, [ids])).rows.map((r) => r.id);
        if (apps.length) {
          await tx.query(`DELETE FROM hiring_interview_attendees WHERE application_id = ANY($1)`, [apps]);
          await tx.query(`DELETE FROM application_scores WHERE application_id = ANY($1)`, [apps]);
          await tx.query(`DELETE FROM hiring_decisions WHERE application_id = ANY($1)`, [apps]);
          await tx.query(`DELETE FROM candidate_applications WHERE id = ANY($1)`, [apps]);
        }
        await tx.query(`DELETE FROM candidates WHERE id = ANY($1)`, [ids]);
      }
      await tx.query(`DELETE FROM hiring_interviews WHERE org_id = $1`, [org]);
      await tx.query(`DELETE FROM staff WHERE email LIKE $1`, [`${TAG}-%`]);
      await tx.query(
        `DELETE FROM tasks WHERE source_workflow IN
          ('hiring-candidate-feedback','hiring-group-interview-review','hiring-bench-monitor',
           'hiring-ramp-review','hiring-new-application')`);
      await tx.query(`ALTER TABLE candidate_applications ENABLE TRIGGER trg_application_terminal`);
      for (const [t, trg] of [["application_scores", "trg_application_scores_no_delete"],
                              ["hiring_decisions", "trg_hiring_decisions_no_delete"]]) {
        await tx.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
      }
    });
  }
});
