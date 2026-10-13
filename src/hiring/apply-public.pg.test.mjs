// The public careers door, against a real Postgres.
//
// TWO HALVES, ON PURPOSE.
//
//   The first describe is PURE — no database — so the validation and the spam
//   handling are exercised on every CI run, including the ones with no
//   DATABASE_URL. Those branches are the security surface: they are what stands
//   between a stranger's JSON and the hiring tables, and a suite that only checks
//   them when a database happens to be present is checking them sometimes.
//
//   The second describe needs Postgres and skips without it.
//
// THE TESTS THAT MATTER MOST are the ones that try to get something into the
// candidate tables that must not be there — a protected characteristic, a second
// application for an address already on file, an answer set nobody wrote the
// questions for — and the one that proves the reply is IDENTICAL whether the
// address is new, known, or a bot. That last one is not a nicety: this endpoint
// collects the email addresses of people applying for jobs, and a form that
// answers differently for an address it recognises is an address checker.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  parseApplyBody,
  listOpenRoles,
  checkApplyRate,
  checkIpRate,
  recordAttempt,
  resetAttempts,
  submitApplication,
  APPLY_LIMITS,
  FIELD_LIMITS,
  HOW_HEARD
} from "./apply-public.mjs";
import handler from "../../api/hiring/apply.mjs";
import { questionsFor, SURVEY_VERSION } from "./survey.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "careertest";

// ---------------------------------------------------------------------------
// Pure — runs everywhere
// ---------------------------------------------------------------------------

describe("careers intake — parsing and spam handling", () => {
  const good = { role: "closer", name: "Dana Reyes", email: "Dana@Example.TEST" };

  test("a well-formed application parses, and the address is normalised", () => {
    const out = parseApplyBody(good);
    assert.equal(out.ok, true);
    assert.equal(out.roleKey, "closer");
    assert.equal(out.email, "dana@example.test", "stored lowercase — candidates_email_ck requires it");
    assert.equal(out.source, "inbound", "no sourcing answer means inbound, not a guess");
    assert.equal(out.botSuspected, false);
  });

  test("a protected characteristic in the body is REFUSED, not filtered", () => {
    /* The grader strips these before scoring and apply() strips them before
       storage. Here they are refused outright: our own page never sends one, so
       a request carrying `age` is something trying to put a protected
       characteristic into an automated employment decision tool. */
    for (const key of ["age", "date_of_birth", "gender", "ethnicity", "disability_status",
                       "criminal_history", "maritalStatus", "eeo_race"]) {
      const out = parseApplyBody({ ...good, [key]: "anything" });
      assert.equal(out.ok, false, `${key} must be refused`);
      assert.equal(out.error, "protected_field_refused");
    }
  });

  test("an `answers` object is refused, because no application questions exist", () => {
    /* 051's `applied` rubric scores six categories and the QUESTIONS behind them
       are in documents outside this repo. Accepting a free-text answer set here
       would mean the page invented them. If the questions are ever written down,
       THIS is the test that has to be changed deliberately. */
    const out = parseApplyBody({ ...good, answers: { effort: "lots" } });
    assert.equal(out.ok, false);
    assert.equal(out.error, "unsupported_field");
  });

  test("the honeypot marks a bot and does NOT tell it so", () => {
    const out = parseApplyBody({ ...good, website: "http://spam.example" });
    assert.equal(out.ok, true, "parsing succeeds — the difference must not be visible");
    assert.equal(out.botSuspected, true);
  });

  test("name and email are both required, and a bad address is refused", () => {
    assert.equal(parseApplyBody({ ...good, name: "  " }).error, "name_email_required");
    assert.equal(parseApplyBody({ ...good, email: "not-an-address" }).error, "name_email_required");
    assert.equal(parseApplyBody({ role: "closer" }).error, "name_email_required");
  });

  test("the same error covers a missing name and a bad address, so neither is confirmed", () => {
    assert.equal(parseApplyBody({ ...good, name: "" }).error,
      parseApplyBody({ ...good, email: "x" }).error);
  });

  test("a URL in the name field is refused — no human types one there", () => {
    assert.equal(parseApplyBody({ ...good, name: "cheap watches http://spam.example" }).ok, false);
    assert.equal(parseApplyBody({ ...good, name: "visit www.spam.example now" }).ok, false);
  });

  test("prose fields are TRUNCATED at their cap, so an over-long value never reaches a column", () => {
    const out = parseApplyBody({
      role: "closer",
      name: "A".repeat(500),
      email: "long@example.test",
      how_heard_detail: "c".repeat(900)
    });
    assert.equal(out.ok, true);
    assert.equal(out.fullName.length, FIELD_LIMITS.fullName);
    assert.equal(out.sourceDetail.length, FIELD_LIMITS.sourceDetail);
  });

  test("an over-long address is REFUSED, never truncated", () => {
    /* Truncating an address does not shorten it, it changes it — into one we
       would store, fail to reach, and never learn was wrong. */
    const out = parseApplyBody({
      role: "closer", name: "Dana", email: `${"b".repeat(200)}@example.test` });
    assert.equal(out.ok, false);
    assert.equal(out.error, "name_email_required");
  });

  test("an over-long LinkedIn link is refused rather than cut into a broken one", () => {
    const out = parseApplyBody({
      role: "closer", name: "Dana", email: "d@example.test",
      linkedin: `https://linkedin.com/in/${"x".repeat(FIELD_LIMITS.linkedinUrl)}` });
    assert.equal(out.ok, false);
    assert.equal(out.error, "linkedin_url_invalid");
  });

  test("control characters are stripped rather than stored", () => {
    const out = parseApplyBody({ ...good, name: `Dana\r\nBcc: someone@example.test` });
    assert.equal(out.ok, true);
    assert.ok(!/[\r\n]/.test(out.fullName), "a newline in a name is where header injection starts");
  });

  test("the role key is a key, not free text", () => {
    for (const role of ["", "  ", "closer; drop", "../admin", "A".repeat(80)]) {
      assert.equal(parseApplyBody({ ...good, role }).ok, false, `"${role}" must be refused`);
    }
  });

  test("a LinkedIn link is accepted only when it is LinkedIn, and is stored as https", () => {
    assert.equal(parseApplyBody({ ...good, linkedin: "linkedin.com/in/dana" }).linkedinProfileUrl,
      "https://linkedin.com/in/dana");
    assert.equal(parseApplyBody({ ...good, linkedin: "http://www.linkedin.com/in/dana" }).linkedinProfileUrl,
      "https://www.linkedin.com/in/dana");
    assert.equal(parseApplyBody({ ...good, linkedin: "https://evil.example/in/dana" }).error,
      "linkedin_url_invalid");
    assert.equal(parseApplyBody({ ...good, linkedin: "javascript:alert(1)" }).error,
      "linkedin_url_invalid");
  });

  test("the sourcing answer must be one of 051's enum values or it becomes inbound", () => {
    /* candidates_source_ck is a CHECK constraint. An unrecognised value falling
       through to the database would be a 500 on a public form. */
    assert.equal(parseApplyBody({ ...good, how_heard: "referral" }).source, "referral");
    assert.equal(parseApplyBody({ ...good, how_heard: "made_up" }).source, "inbound");
    for (const h of HOW_HEARD) {
      assert.equal(parseApplyBody({ ...good, how_heard: h.key }).source, h.key,
        `${h.key} is offered on the page and must survive parsing`);
    }
  });

  test("a non-object body is refused rather than coerced", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      assert.equal(parseApplyBody(body).error, "invalid_json");
    }
  });
});

// ---------------------------------------------------------------------------
// Against Postgres
// ---------------------------------------------------------------------------

describe("careers intake — against the database", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    await resetAttempts(db, { orgId: org });
  });
  after(async () => { await cleanup(); await resetAttempts(db, { orgId: org }); await close(); });

  test("the durable burst limiter counts refused attempts, not just accepted ones", async () => {
    const ip = "203.0.113.44";
    await resetAttempts(db, { orgId: org, ip });
    for (let i = 0; i < APPLY_LIMITS.maxPerIpShortWindow; i++) {
      assert.equal((await checkIpRate(db, { orgId: org, ip })).limited, false,
        `attempt ${i + 1} should be allowed`);
      await recordAttempt(db, { orgId: org, ip });
    }
    assert.equal((await checkIpRate(db, { orgId: org, ip })).limited, true, "the burst limit trips");
    assert.equal((await checkIpRate(db, { orgId: org, ip: "198.51.100.9" })).limited, false,
      "and only for that source");
    await resetAttempts(db, { orgId: org, ip });
  });

  test("the burst window expires, so a limiter cannot lock somebody out forever", async () => {
    const ip = "203.0.113.45";
    await resetAttempts(db, { orgId: org, ip });
    const t0 = new Date();
    for (let i = 0; i < APPLY_LIMITS.maxPerIpShortWindow; i++) {
      await recordAttempt(db, { orgId: org, ip, now: t0 });
    }
    assert.equal((await checkIpRate(db, { orgId: org, ip, now: t0 })).limited, true);
    const later = new Date(t0.getTime() + (APPLY_LIMITS.ipShortWindowMinutes + 1) * 60_000);
    assert.equal((await checkIpRate(db, { orgId: org, ip, now: later })).limited, false);
    await resetAttempts(db, { orgId: org, ip });
  });

  test("no request without a source address is limited into oblivion", async () => {
    assert.equal((await checkIpRate(db, { orgId: org, ip: null })).limited, false);
  });

  test("the open roles list carries the three public columns and nothing else", async () => {
    const roles = await listOpenRoles(db, { orgId: org });
    assert.ok(roles.length >= 1, "051 seeds reqs; the page has something to show");
    for (const r of roles) {
      assert.deepStrictEqual(Object.keys(r).sort(), ["brief", "key", "name"],
        "comp, scorecard, bench_target and the hiring manager must never leave");
    }
    assert.ok(roles.some((r) => r.key === "closer"));
  });

  test("a role with no brief written yet returns null, and no invented text", async () => {
    /* 294 added role_brief and left it NULL. A careers page that filled that gap
       with generated prose would be advertising a job nobody described. */
    const roles = await listOpenRoles(db, { orgId: org });
    for (const r of roles) {
      assert.ok(r.brief === null || (typeof r.brief === "string" && r.brief.trim().length > 0),
        `${r.key}: brief must be null or real text, never an empty string`);
    }
  });

  test("an inactive role disappears from the list", async () => {
    await db.query(`UPDATE hiring_roles SET active = false WHERE org_id = $1 AND key = 'setter'`, [org]);
    try {
      const keys = (await listOpenRoles(db, { orgId: org })).map((r) => r.key);
      assert.ok(!keys.includes("setter"), "a closed req must not be advertised");
    } finally {
      await db.query(`UPDATE hiring_roles SET active = true WHERE org_id = $1 AND key = 'setter'`, [org]);
    }
  });

  test("a submission creates the candidate and an application in `applied`", async () => {
    const parsed = parseApplyBody({
      role: "closer", name: `${TAG} Dana`, email: `${TAG}-dana@example.test`,
      phone: "(555) 555-0101", how_heard: "referral",
      how_heard_detail: "a friend on the floor", linkedin: "linkedin.com/in/dana"
    });
    const out = await submitApplication(db, parsed, { orgId: org });
    assert.equal(out.stored, true);
    assert.equal(out.outcome, "created");

    const row = (await db.query(
      `SELECT c.full_name, c.email, c.phone, c.source, c.source_detail, c.linkedin_profile_url,
              a.status, a.answers, s.key AS stage_key
         FROM candidates c
         JOIN candidate_applications a ON a.candidate_id = c.id
         JOIN pipeline_stages s ON s.id = a.stage_id
        WHERE c.org_id = $1 AND c.email = $2`,
      [org, `${TAG}-dana@example.test`])).rows[0];

    assert.ok(row, "the candidate and the application both landed");
    assert.equal(row.stage_key, "applied");
    assert.equal(row.status, "open", "an intake never sets a terminal status");
    assert.equal(row.source, "referral");
    assert.equal(row.phone, "5555550101");
    assert.equal(row.linkedin_profile_url, "https://linkedin.com/in/dana");
    assert.deepStrictEqual(row.answers, {}, "no questions asked means no answers stored");
  });

  test("a second submission for the same role writes nothing and looks identical", async () => {
    /* 051's partial unique index allows one OPEN application per candidate per
       role. The caller must not be able to tell the difference — see the header. */
    const before = await countApplications();
    const parsed = parseApplyBody({
      role: "closer", name: `${TAG} Dana`, email: `${TAG}-dana@example.test` });
    const out = await submitApplication(db, parsed, { orgId: org });
    assert.equal(out.outcome, "already_open");
    assert.equal(await countApplications(), before, "no second application");
  });

  test("the same person may apply to a DIFFERENT role", async () => {
    // Doc 5's case: a setter becoming a closer, and the reverse. One person, many
    // applications, is the whole reason candidates and applications are separate.
    const parsed = parseApplyBody({
      role: "setter", name: `${TAG} Dana`, email: `${TAG}-dana@example.test` });
    const out = await submitApplication(db, parsed, { orgId: org });
    assert.equal(out.outcome, "created");

    const n = (await db.query(
      `SELECT count(*)::int AS n FROM candidates WHERE org_id = $1 AND email = $2`,
      [org, `${TAG}-dana@example.test`])).rows[0].n;
    assert.equal(n, 1, "one person is one candidate row, however many times they apply");
  });

  test("a honeypot hit stores nothing at all", async () => {
    const before = await countApplications();
    const parsed = parseApplyBody({
      role: "closer", name: `${TAG} Bot`, email: `${TAG}-bot@example.test`,
      website: "http://spam.example" });
    const out = await submitApplication(db, parsed, { orgId: org });
    assert.equal(out.stored, false);
    assert.equal(await countApplications(), before);

    const found = (await db.query(
      `SELECT count(*)::int AS n FROM candidates WHERE org_id = $1 AND email = $2`,
      [org, `${TAG}-bot@example.test`])).rows[0].n;
    assert.equal(found, 0, "no candidate row for a bot");
  });

  test("an unknown or closed role raises ROLE_UNAVAILABLE, not a 500", async () => {
    const parsed = parseApplyBody({
      role: "not_a_real_role", name: `${TAG} X`, email: `${TAG}-x@example.test` });
    await assert.rejects(
      () => submitApplication(db, parsed, { orgId: org }),
      (err) => err.code === "ROLE_UNAVAILABLE");
  });

  test("nothing this path writes can reject a candidate", async () => {
    /* The invariant, checked from the data rather than from the code: every
       application this module created is still open, and no decision row exists
       against any of them. */
    const rows = (await db.query(
      `SELECT a.status,
              (SELECT count(*)::int FROM hiring_decisions d WHERE d.application_id = a.id) AS decisions
         FROM candidate_applications a
         JOIN candidates c ON c.id = a.candidate_id
        WHERE c.org_id = $1 AND c.email LIKE $2`,
      [org, `${TAG}-%`])).rows;
    assert.ok(rows.length > 0, "there is something to check");
    for (const r of rows) {
      assert.equal(r.status, "open");
      assert.equal(r.decisions, 0, "software wrote no decision");
    }
  });

  test("no score is produced by applying — the grader is a separate, human-driven act", async () => {
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM application_scores sc
         JOIN candidate_applications a ON a.id = sc.application_id
         JOIN candidates c ON c.id = a.candidate_id
        WHERE c.org_id = $1 AND c.email LIKE $2`,
      [org, `${TAG}-%`])).rows[0].n;
    assert.equal(n, 0);
  });

  test("the durable per-address limit trips on the row count, not on a counter", async () => {
    await resetAttempts(db, { orgId: org });
    const email = `${TAG}-dana@example.test`;
    const loose = await checkApplyRate(db, { orgId: org, email, ip: null });
    assert.equal(loose.limited, false, "two applications is not a flood");

    const tight = await checkApplyRate(db, {
      orgId: org, email, ip: null,
      limits: { ...APPLY_LIMITS, maxPerEmail: 1 }
    });
    assert.equal(tight.limited, true);
    assert.equal(tight.reason, "email");
    assert.ok(tight.retryAfterMinutes > 0, "a 429 must say when to come back");
  });

  test("the org-wide flood cap is checked, and is not the per-address one", async () => {
    const out = await checkApplyRate(db, {
      orgId: org, email: `${TAG}-nobody@example.test`, ip: null,
      limits: { ...APPLY_LIMITS, maxOrgPerFloodWindow: 1, floodWindowMinutes: 600 }
    });
    assert.equal(out.limited, true);
    assert.equal(out.reason, "flood", "a fresh address still hits the flood cap");
  });

  // ------------------------------------------------------------ the endpoint

  test("GET returns the open reqs to a caller with no session at all", async () => {
    const res = await call({ method: "GET" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.roles) && res.body.roles.length > 0);
    for (const r of res.body.roles) {
      assert.deepStrictEqual(Object.keys(r).sort(), ["brief", "key", "name"]);
    }
  });

  test("POST answers a new address, a known address and a bot IDENTICALLY", async () => {
    await resetAttempts(db, { orgId: org });
    const fresh = await call({ method: "POST", body: {
      role: "closer", name: `${TAG} Fresh`, email: `${TAG}-fresh@example.test` } });
    const known = await call({ method: "POST", body: {
      role: "closer", name: `${TAG} Dana`, email: `${TAG}-dana@example.test` } });
    const bot = await call({ method: "POST", body: {
      role: "closer", name: `${TAG} Bot2`, email: `${TAG}-bot2@example.test`,
      website: "http://spam.example" } });

    assert.equal(fresh.statusCode, 200);
    assert.deepStrictEqual(fresh.body, { ok: true, received: true });
    assert.deepStrictEqual(known.body, fresh.body, "a known address must not be identifiable");
    assert.deepStrictEqual(bot.body, fresh.body, "a bot must not learn it was caught");
    assert.equal(known.statusCode, fresh.statusCode);
    assert.equal(bot.statusCode, fresh.statusCode);
    await resetAttempts(db, { orgId: org });
  });

  test("POST refuses a protected field with a 400 and writes nothing", async () => {
    await resetAttempts(db, { orgId: org });
    const before = await countApplications();
    const res = await call({ method: "POST", body: {
      role: "closer", name: `${TAG} P`, email: `${TAG}-p@example.test`, date_of_birth: "1980-01-01" } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "protected_field_refused");
    assert.equal(await countApplications(), before);
    await resetAttempts(db, { orgId: org });
  });

  test("POST admits exactly the burst limit, then answers 429 with a Retry-After", async () => {
    /* THE COUNT IS THE POINT, not just that a 429 happens eventually. The handler
       originally recorded the attempt BEFORE asking the limiter, so the request
       competed with itself and a limit of five let four through — the constant
       said one thing and the endpoint did another. */
    await resetAttempts(db, { orgId: org, ip: "203.0.113.77" });
    const ip = "203.0.113.77";
    const codes = [];
    for (let i = 0; i < APPLY_LIMITS.maxPerIpShortWindow + 1; i++) {
      const res = await call({
        method: "POST",
        ip,
        body: { role: "closer", name: `${TAG} Burst${i}`, email: `${TAG}-burst${i}@example.test` }
      });
      codes.push(res.statusCode);
      if (i === APPLY_LIMITS.maxPerIpShortWindow) {
        assert.equal(res.body.error, "rate_limited");
        assert.ok(Number(res.headers["Retry-After"]) > 0, "a 429 must say when to come back");
      }
    }
    const admitted = codes.filter((c) => c === 200).length;
    assert.equal(admitted, APPLY_LIMITS.maxPerIpShortWindow,
      `the limit says ${APPLY_LIMITS.maxPerIpShortWindow} per window; ${admitted} got through`);
    assert.equal(codes[codes.length - 1], 429);
    await resetAttempts(db, { orgId: org, ip: "203.0.113.77" });
  });

  test("no verb other than GET and POST is answered", async () => {
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const res = await call({ method });
      assert.equal(res.statusCode, 405, `${method} must be refused`);
    }
  });

  test("a role that closed between the page load and the submit is a 400, not a 500", async () => {
    await resetAttempts(db, { orgId: org });
    await db.query(`UPDATE hiring_roles SET active = false WHERE org_id = $1 AND key = 'setter'`, [org]);
    try {
      const res = await call({ method: "POST", body: {
        role: "setter", name: `${TAG} Late`, email: `${TAG}-late@example.test` } });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "role_unavailable");
    } finally {
      await db.query(`UPDATE hiring_roles SET active = true WHERE org_id = $1 AND key = 'setter'`, [org]);
      await resetAttempts(db, { orgId: org });
    }
  });

  // ------------------------------------------------- the hiring funnel (/join/)

  /* Owner-set 2026-10-13. The funnel sends the owner's survey and a Loom, and
     the reply tells the page which screen is next. Three things are proved
     against the real tables: the answers and the Loom are stored, a held-back
     applicant is still a saved, OPEN application, and the reply is identical
     for a person and a bot with the same answers. */
  function funnelAnswers(roleKey, over = {}) {
    const out = {};
    for (const q of questionsFor(roleKey)) out[q.key] = q.opts[0];
    if (roleKey === "closer") out.closer_top_ticket = "$5,000 to $10,000";
    return { ...out, ...over };
  }
  function funnelPost(roleKey, who, over = {}) {
    return {
      funnel: "join", role: roleKey, name: `${TAG} ${who}`, email: `${TAG}-${who}@example.test`,
      phone: "6025550142", linkedin: `linkedin.com/in/${TAG}-${who}`,
      loom: `https://www.loom.com/share/${who}`, answers: funnelAnswers(roleKey), ...over
    };
  }
  async function withBookingUrl(roleKey, url, fn) {
    const prev = (await db.query(
      `SELECT interview_booking_url FROM hiring_roles WHERE org_id = $1 AND key = $2`,
      [org, roleKey])).rows[0]?.interview_booking_url ?? null;
    await db.query(`UPDATE hiring_roles SET interview_booking_url = $3 WHERE org_id = $1 AND key = $2`,
      [org, roleKey, url]);
    try { return await fn(); } finally {
      await db.query(`UPDATE hiring_roles SET interview_booking_url = $3 WHERE org_id = $1 AND key = $2`,
        [org, roleKey, prev]);
    }
  }

  test("migration 480 opened the COO seat, routed to the owner", async () => {
    const r = (await db.query(
      `SELECT name, owner_role, active, bench_target FROM hiring_roles WHERE org_id = $1 AND key = 'coo'`,
      [org])).rows[0];
    assert.ok(r, "the coo req exists");
    assert.equal(r.owner_role, "owner", "COO applications go to Chris, not the sales manager");
    assert.equal(r.active, true);
    assert.equal(r.bench_target, 0);
  });

  test("a funnel application stores the answers word for word and the Loom", async () => {
    await resetAttempts(db, { orgId: org });
    const res = await call({ body: funnelPost("closer", "fun1"), ip: "198.51.100.61" });
    assert.equal(res.statusCode, 200);
    const row = (await db.query(
      `SELECT a.answers, a.video_url, a.status, s.key AS stage, c.linkedin_profile_url
         FROM candidate_applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN pipeline_stages s ON s.id = a.stage_id
        WHERE c.email = $1`, [`${TAG}-fun1@example.test`])).rows[0];
    assert.ok(row, "the application was saved");
    assert.equal(row.answers.closer_top_ticket, "$5,000 to $10,000");
    assert.equal(row.answers.survey_version, SURVEY_VERSION);
    assert.deepStrictEqual(row.answers.review_flags, []);
    assert.equal(row.video_url, "https://www.loom.com/share/fun1");
    assert.equal(row.linkedin_profile_url, `https://linkedin.com/in/${TAG}-fun1`);
    assert.equal(row.status, "open");
    assert.equal(row.stage, "applied");
  });

  test("with no booking link set, a qualified applicant is told we will reach out", async () => {
    await resetAttempts(db, { orgId: org });
    await withBookingUrl("setter", null, async () => {
      const res = await call({ body: funnelPost("setter", "fun2"), ip: "198.51.100.62" });
      assert.equal(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { ok: true, received: true, next: "book_pending" });
    });
  });

  test("with a booking link set, a qualified applicant gets that seat's calendar", async () => {
    await resetAttempts(db, { orgId: org });
    await withBookingUrl("closer", "https://cal.example.test/sales-manager", async () => {
      const res = await call({ body: funnelPost("closer", "fun3"), ip: "198.51.100.63" });
      assert.deepStrictEqual(res.body, {
        ok: true, received: true, next: "book", bookingUrl: "https://cal.example.test/sales-manager"
      });
    });
  });

  test("a held-back applicant sees the thank-you, and the application stays open", async () => {
    await resetAttempts(db, { orgId: org });
    await withBookingUrl("closer", "https://cal.example.test/sales-manager", async () => {
      const body = funnelPost("closer", "fun4", {
        answers: funnelAnswers("closer", { closer_top_ticket: "Under $3,000" }) });
      const res = await call({ body, ip: "198.51.100.64" });
      assert.deepStrictEqual(res.body, { ok: true, received: true, next: "review" },
        "the calendar link is not handed out");
    });
    const row = (await db.query(
      `SELECT a.status, a.answers FROM candidate_applications a
         JOIN candidates c ON c.id = a.candidate_id WHERE c.email = $1`,
      [`${TAG}-fun4@example.test`])).rows[0];
    assert.equal(row.status, "open", "held back is never rejected by software");
    assert.deepStrictEqual(row.answers.review_flags, ["closer_under_3000"]);
    const decisions = (await db.query(
      `SELECT count(*)::int AS n FROM hiring_decisions d
         JOIN candidate_applications a ON a.id = d.application_id
         JOIN candidates c ON c.id = a.candidate_id WHERE c.email = $1`,
      [`${TAG}-fun4@example.test`])).rows[0].n;
    assert.equal(decisions, 0, "no decision row is written");
  });

  test("a bot with the same answers gets the identical reply and writes nothing", async () => {
    await resetAttempts(db, { orgId: org });
    await withBookingUrl("csm", "https://cal.example.test/sales-manager", async () => {
      const person = await call({ body: funnelPost("csm", "fun5"), ip: "198.51.100.65" });
      const bot = await call({ body: funnelPost("csm", "fun6", { website: "spam.example" }),
        ip: "198.51.100.66" });
      assert.deepStrictEqual(bot.body, person.body);
    });
    const n = (await db.query(`SELECT count(*)::int AS n FROM candidates WHERE email = $1`,
      [`${TAG}-fun6@example.test`])).rows[0].n;
    assert.equal(n, 0, "the honeypot still drops the bot");
  });

  test("the reply is identical for a new address and one already on file", async () => {
    await resetAttempts(db, { orgId: org });
    await withBookingUrl("setter", null, async () => {
      const first = await call({ body: funnelPost("setter", "fun7"), ip: "198.51.100.67" });
      const again = await call({ body: funnelPost("setter", "fun7"), ip: "198.51.100.68" });
      assert.deepStrictEqual(again.body, first.body);
    });
  });

  // ---------------------------------------------------------------- helpers

  /* A minimal (req, res) pair in the shape netlify/functions/api.mjs builds.
     Calling the handler directly is the point: the endpoint's own branches —
     the method gate, the 429, the 400 — are what a screen actually meets. */
  async function call({ method = "POST", body = null, ip = "198.51.100.1", query = {} } = {}) {
    const res = {
      statusCode: 0, body: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    const req = {
      method, query, body,
      headers: {},
      socket: { remoteAddress: ip }
    };
    await handler(req, res);
    return res;
  }

  async function countApplications() {
    return (await db.query(
      `SELECT count(*)::int AS n FROM candidate_applications a
         JOIN candidates c ON c.id = a.candidate_id
        WHERE c.org_id = $1 AND c.email LIKE $2`,
      [org, `${TAG}-%`])).rows[0].n;
  }
});

/* cleanup — application_scores and hiring_decisions are undeletable by trigger
   (051), and this path writes neither, so the fixtures are only ever candidates
   and their applications. Deleting in that order respects the RESTRICT on the
   candidate foreign key. */
async function cleanup() {
  if (!HAVE_DB) return;
  await db.query(
    `DELETE FROM candidate_applications a
      USING candidates c
      WHERE c.id = a.candidate_id AND c.email LIKE $1`, [`${TAG}-%`]);
  await db.query(`DELETE FROM candidates WHERE email LIKE $1`, [`${TAG}-%`]);
  await db.query(
    `DELETE FROM hiring_apply_attempts a
      USING orgs o
      WHERE a.org_id = o.id AND o.is_default
        AND (a.ip::text LIKE '203.0.113.%' OR a.ip::text LIKE '198.51.100.%')`);
}
