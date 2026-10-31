// Message tests: the report (owner GO 2026-10-31, board ops/workflows/backend-selling-lanes-2026-10-30.md
// section 6e). READ ONLY. One SELECT, no writes, no sends. It never switches a version by itself.
//
// For each test in src/messaging/experiments.mjs it answers two questions: how many people got version
// A and how many got version B, and how many of each did the goal within the test's window (7 days) of
// their first message in the test. Then it says, in plain English, whether one side has pulled ahead.
//
// WHO COUNTS.
//   - A person is counted once per test, in one arm. They are in B when any message that left or is on
//     its way (queued, sending, sent, delivered, complained) carries a B key; otherwise in A. Failed,
//     bounced and blocked messages do not count: the person never got the words.
//   - Test people are left out: demo clients and demo rows, and test addresses (the same rule the
//     pulse uses, testAddressSql).
//   - The test starts the moment the first B message is queued. People who got version A before that
//     could not have got B, so setting them against B would compare different weeks. They are not in the
//     comparison; they are counted apart as `earlier_people`. With no B message yet, nothing is compared.
//
// REACHED. An events row for that person with the test's goal name, created after their first message
// in the test and no later than the window after it. "First message" is their first counted message of
// either version. The person's own client_id is the match: events saved since 2026-09-03 carry it.
//
// WAITING. People whose window has not closed yet at `now`. They are in the counts (they may still reach
// the goal), and the verdict text says so. Both sides have about the same mix of days left, so the
// comparison stays fair; it only says less than it will in a week.
//
// THE VERDICT. A two-proportion z-test. A winner is named only when each side has at least MIN_PER_ARM
// people and the two-sided p value is under 0.05. Until then the words are "Not enough people yet to call
// it", whatever the reason, as on the board.

import { EXPERIMENTS, MIN_PER_ARM, variantKeyFor } from "./experiments.mjs";
import { testAddressSql } from "../pulse/beats/lib/handoff-truth.mjs";

/** Messages that left or are on their way. Same set the pulse reads (src/pulse/beats/lib/msg-truth.mjs LEFT_OR_GOING). */
export const COUNTED_STATUSES = Object.freeze(["queued", "sending", "sent", "delivered", "complained"]);

/** A winner needs a two-sided p value under this. */
export const SIGNIFICANCE = 0.05;

/* $1 org, $2 the tests as JSON (name, goal, window_days, a_keys, b_keys), $3 counted statuses, $4 now.
   One row per test and arm: 'A', 'B', or 'earlier' (version A before the first B message). */
export const REPORT_SQL = `/* message-tests:report */
WITH tests AS (
  SELECT x->>'name' AS name,
         x->>'goal' AS goal,
         (x->>'window_days')::int AS window_days,
         ARRAY(SELECT jsonb_array_elements_text(x->'a_keys')) AS a_keys,
         ARRAY(SELECT jsonb_array_elements_text(x->'b_keys')) AS b_keys
    FROM jsonb_array_elements($2::jsonb) AS x
),
people AS (
  SELECT t.name, t.goal, t.window_days, m.client_id,
         min(m.created_at) AS first_at,
         min(m.created_at) FILTER (WHERE m.template_key = ANY(t.b_keys)) AS first_b_at
    FROM tests t
    JOIN messages m
      ON m.org_id = $1::uuid
     AND m.direction = 'outbound'
     AND m.client_id IS NOT NULL
     AND m.template_key = ANY(t.a_keys || t.b_keys)
     AND m.status = ANY($3::text[])
     AND COALESCE(m.is_demo, false) = false
    JOIN clients c
      ON c.id = m.client_id
     AND c.org_id = m.org_id
   WHERE COALESCE(c.is_demo, false) = false
     AND NOT ${testAddressSql("lower(btrim(COALESCE(c.email, '')))")}
   GROUP BY t.name, t.goal, t.window_days, m.client_id
),
started AS (
  SELECT name, min(first_b_at) AS started_at
    FROM people
   WHERE first_b_at IS NOT NULL
   GROUP BY name
),
placed AS (
  SELECT p.name, p.goal, p.window_days, p.client_id, p.first_at, s.started_at,
         CASE
           WHEN p.first_b_at IS NOT NULL THEN 'B'
           WHEN s.started_at IS NOT NULL AND p.first_at >= s.started_at THEN 'A'
           ELSE 'earlier'
         END AS arm
    FROM people p
    LEFT JOIN started s ON s.name = p.name
)
SELECT pl.name, pl.arm,
       count(*)::int AS people,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM events e
          WHERE e.org_id = $1::uuid
            AND e.client_id = pl.client_id
            AND e.name = pl.goal
            AND COALESCE(e.is_demo, false) = false
            AND e.created_at > pl.first_at
            AND e.created_at <= pl.first_at + make_interval(hours => pl.window_days * 24)
       ))::int AS reached,
       count(*) FILTER (
         WHERE pl.first_at + make_interval(hours => pl.window_days * 24) > $4::timestamptz
       )::int AS waiting,
       min(pl.started_at) AS started_at
  FROM placed pl
 GROUP BY pl.name, pl.arm
 ORDER BY pl.name, pl.arm`;

/* What "the goal" is called in a sentence, by the event name. */
const GOAL_WORDS = Object.freeze({
  "survey.completed": "finished the survey",
  "booking.created": "booked"
});

/* The normal curve's two-sided tail: the chance of a gap this big or bigger by luck alone, for a z score.
   Simpson's rule on the bell curve from 0 to |z|; good to about 1e-12, far finer than the 0.05 line needs. */
export function twoSidedP(z) {
  if (!Number.isFinite(z)) return null;
  const a = Math.abs(z);
  if (a === 0) return 1;
  if (a > 40) return 0;
  const n = Math.max(200, 2 * Math.ceil(a * 200)); // an even number of steps
  const h = a / n;
  const bell = (t) => Math.exp(-(t * t) / 2) / Math.sqrt(2 * Math.PI);
  let sum = bell(0) + bell(a);
  for (let i = 1; i < n; i += 1) sum += (i % 2 === 1 ? 4 : 2) * bell(i * h);
  return Math.min(1, Math.max(0, 1 - 2 * ((sum * h) / 3)));
}

/* The standard two-proportion z test: did `x1` of `n1` and `x2` of `n2` differ more than luck explains?
   Returns { z, p }, or null when the test cannot be made (an empty side, or everyone or no one reached). */
export function twoProportionTest(x1, n1, x2, n2) {
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return null;
  const z = (x1 / n1 - x2 / n2) / se;
  return { z, p: twoSidedP(z) };
}

const pct = (reached, people) => (people > 0 ? Math.round((100 * reached) / people) : 0);
const folks = (n) => (n === 1 ? "1 person" : `${n} people`);

/* judge — the plain-English verdict for one test.
   arms: { A: { people, reached, waiting }, B: { ... } }. Returns { winner: "A" | "B" | null, text, p }.
   `p` is the two-sided p value when the test could be made, else null. */
export function judge({ goal, windowDays = 7, startedAt = null, earlierPeople = 0, arms }) {
  const A = arms.A;
  const B = arms.B;
  const words = GOAL_WORDS[goal] || "reached the goal";

  if (!startedAt) {
    const before = earlierPeople > 0
      ? ` The ${folks(earlierPeople)} who got version A so far are not counted; the count starts when B goes out.`
      : "";
    return { winner: null, p: null, text: `Version B has not gone out yet, so there is nothing to compare.${before}` };
  }
  if (A.people === 0 || B.people === 0) {
    return {
      winner: null,
      p: null,
      text: `Not enough people yet to call it. Version A has ${folks(A.people)} and version B has ${folks(B.people)} so far.`
    };
  }

  const rateA = A.reached / A.people;
  const rateB = B.reached / B.people;
  const total = A.people + B.people;
  const waiting = A.waiting + B.waiting;
  const enough = A.people >= MIN_PER_ARM && B.people >= MIN_PER_ARM;
  const test = enough ? twoProportionTest(A.reached, A.people, B.reached, B.people) : null;
  const p = test ? test.p : null;
  const leader = rateB > rateA ? "B" : rateA > rateB ? "A" : null;
  const winner = leader && p !== null && p < SIGNIFICANCE ? leader : null;

  const lead = leader === "A" ? A : B;
  const trail = leader === "A" ? B : A;
  const head = leader
    ? `${leader} ${winner ? "wins" : "is ahead"}: ${lead.reached} of ${lead.people} ${words} (${pct(lead.reached, lead.people)}%) ` +
      `vs ${trail.reached} of ${trail.people} (${pct(trail.reached, trail.people)}%).`
    : `A and B are even so far: ${A.reached} of ${A.people} ${words} (${pct(A.reached, A.people)}%) ` +
      `vs ${B.reached} of ${B.people} (${pct(B.reached, B.people)}%).`;

  // Until each side has MIN_PER_ARM people AND the gap passes the 95 percent check, it is "not enough people yet".
  const call = winner ? " That gap is big enough to trust." : " Not enough people yet to call it.";

  const days = waiting > 0
    ? ` ${waiting} of these ${total} people still have days left in their ${windowDays} days, so the numbers can still move.`
    : "";
  return { winner, p, text: `${head}${call}${days}` };
}

const isoOrNull = (value) => {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
};

function testResult(experiment, rows) {
  const armOf = (arm) => {
    const row = rows.find((r) => r.arm === arm);
    return { people: row ? Number(row.people) : 0, reached: row ? Number(row.reached) : 0, waiting: row ? Number(row.waiting) : 0 };
  };
  const arms = { A: armOf("A"), B: armOf("B") };
  const earlier = rows.find((r) => r.arm === "earlier");
  const earlierPeople = earlier ? Number(earlier.people) : 0;
  const startedAt = isoOrNull(rows.map((r) => r.started_at).find(Boolean));
  return {
    name: experiment.name,
    label: experiment.label,
    goal: experiment.goal,
    window_days: experiment.windowDays,
    min_per_arm: MIN_PER_ARM,
    started_at: startedAt,
    earlier_people: earlierPeople,
    arms,
    verdict: judge({ goal: experiment.goal, windowDays: experiment.windowDays, startedAt, earlierPeople, arms })
  };
}

/* experimentReport — the report for one company. `db` needs only query(); the caller may hand it a
   connection inside BEGIN READ ONLY (scripts/message-tests-report.mjs does). `now` is the clock the
   "days left" count reads; it moves nothing else. Returns one entry per test, in the order of EXPERIMENTS. */
export async function experimentReport(db, { orgId, now = new Date() } = {}) {
  if (!orgId) throw new Error("experimentReport: orgId is required");
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) throw new Error("experimentReport: now is not a real date");
  const tests = EXPERIMENTS.map((e) => ({
    name: e.name,
    goal: e.goal,
    window_days: e.windowDays,
    a_keys: [...e.keys],
    b_keys: e.keys.map(variantKeyFor)
  }));
  const { rows } = await db.query(REPORT_SQL, [orgId, JSON.stringify(tests), [...COUNTED_STATUSES], at.toISOString()]);
  return EXPERIMENTS.map((e) => testResult(e, rows.filter((r) => r.name === e.name)));
}
