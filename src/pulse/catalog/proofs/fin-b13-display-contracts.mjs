// Finish-853 batch 13 (tier 4, lane gap-catalog-display): the Hiring desk (hiring.html) and the Specialist
// desk (inquiry-remover.html), controls that never had a result contract.
//
// Two kinds of attachment live in this batch, and each row says which one it has:
//
//   LIVE CHECK    A read-only SQL text the display lane runs for the company. It returns sample_count
//                 (how many saved results exist) and bad_count (how many are wrong) and goes red on
//                 the first wrong one. A control nobody has used yet has no results, so it is green
//                 with the words "no saved results yet" (emptyAs "quiet"). The one control that must
//                 always have something to read (the hiring bench tiles) leaves emptyAs off, so a
//                 company with no hiring role at all is red.
//   PRACTICE TEST A real page in Chromium with a fake /api. It reads no live data. Those rows are listed
//                 in fin-b13-display-practice.mjs.
//
// Every live check is built from named bad-result conditions. The SQL text is the conditions joined
// with OR, one SELECT per kind of saved row, stacked with UNION ALL. fin-b13-live-contracts.test.mjs
// runs that exact text over stand-in rows, breaks one condition at a time and sees it go red, and drops
// each condition from the text and sees that its row is no longer caught.
//
// This file is read at build time by scripts/pulse/compile-catalog.mjs. The live bundle reads the
// compiled copy in src/pulse/catalog/generated.json, so it imports nothing.
//
// It must not import display-saved-result.mjs (that file imports this one).

export const FIN_B13_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B13_SOURCE_FILE = "desks-c.json";

/** @type {Array<{key:string, control:string, surface:string, requirement:string, emptyAs?:string,
 *   parts:Array<{from:string, where:string, bad:Array<[string,string]>}>}>} */
export const FIN_B13_CHECKS = [];

function check(spec) {
  const parts = spec.parts.map((part) => Object.freeze({
    from: part.from, where: part.where, bad: Object.freeze(part.bad.map((pair) => Object.freeze([...pair])))
  }));
  FIN_B13_CHECKS.push(Object.freeze({ emptyAs: "quiet", ...spec, parts: Object.freeze(parts) }));
}

/** The SQL text for a check, or for a check with some named conditions left out (the test does that). */
export function sqlFor(spec, { without = [] } = {}) {
  const selects = spec.parts.map((part) => {
    const kept = part.bad.filter(([name]) => !without.includes(name));
    const when = kept.length ? kept.map(([, expr]) => `(${expr.trim()})`).join("\n                OR ") : "1 = 0";
    return `    SELECT CASE WHEN ${when} THEN 1 ELSE 0 END AS bad
      FROM ${part.from.trim()}
     WHERE ${part.where.trim()}`;
  });
  return `/* display-result:${spec.key} */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
${selects.join("\n  UNION ALL\n")}
  ) r`;
}

const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;
const PRESENT = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NOT NULL`;

// ───────────────────────────── hiring.html ─────────────────────────────

// The page leaves Demo Mode candidates out of every count ("counted nowhere"), and marks them by the same
// three signs this text uses: the demo flag, source_detail 'platform_demo', and a name that starts DEMO.
const REAL_CANDIDATE = `COALESCE(c.is_demo, false) = false
      AND COALESCE(c.source_detail, '') <> 'platform_demo'
      AND SUBSTR(COALESCE(c.full_name, ''), 1, 5) NOT IN ('DEMO ', 'DEMO-', 'DEMO—')`;

const APPLICATION_FROM = `candidate_applications a
      JOIN pipeline_stages s ON s.id = a.stage_id
      JOIN candidates c ON c.id = a.candidate_id`;

const DECISION_FROM = `hiring_decisions d
      JOIN candidate_applications a ON a.id = d.application_id
      JOIN pipeline_stages s ON s.id = a.stage_id
      JOIN candidates c ON c.id = a.candidate_id`;

const MOVED_HERE = (stage) =>
  `NOT EXISTS (SELECT 1 FROM hiring_decisions d WHERE d.application_id = a.id AND d.to_stage_key = '${stage}')`;

const STATUS_FOR = {
  applied: "open", screening: "open", group_interview: "open", one_on_one: "open", offer: "open",
  hired: "hired", onboarding: "hired", ramp: "hired", performing: "hired",
  rejected: "rejected", withdrawn: "withdrawn"
};

function boardColumn(stage, control, extra = []) {
  const want = STATUS_FOR[stage];
  const wrongStatus = want === "open"
    ? ["a closed application is still sitting in an open stage", `a.status <> 'open'`]
    : want === "hired"
      ? ["a person is in a hired stage but the application is not marked hired", `a.status <> 'hired'`]
      : [`the application sits in ${stage} but its status is not ${want}`, `a.status <> '${want}'`];
  check({
    key: `hiring-column-${stage.replace(/_/g, "-")}`,
    surface: "hiring.html",
    control,
    requirement: `Every real application in the ${stage} column must be marked ${want}, must have a recorded move into ${stage}, and must carry the named person and the words that stage needs.`,
    parts: [{
      from: APPLICATION_FROM,
      where: `a.org_id = $1::uuid AND s.key = '${stage}'\n      AND ${REAL_CANDIDATE}`,
      bad: [
        wrongStatus,
        [`nothing recorded the move into ${stage}`, MOVED_HERE(stage)],
        ...extra
      ]
    }]
  });
}

boardColumn("screening", "Board column: Screening (screening)");
boardColumn("offer", "Board column: Offer (offer)", [
  ["an offer was made by nobody",
    `NOT EXISTS (SELECT 1 FROM hiring_decisions d WHERE d.application_id = a.id AND d.decision = 'offer' AND d.decided_by IS NOT NULL)`]
]);
boardColumn("hired", "Board column: Hired (hired)");
boardColumn("onboarding", "Board column: Onboarding (onboarding)");
boardColumn("ramp", "Board column: Ramp (60-day trial) (ramp)");
boardColumn("performing", "Board column: Performing (performing)");
boardColumn("rejected", "Board column: Not Moving Forward (rejected)", [
  ["turned down with no named person or no written reason",
    `NOT EXISTS (SELECT 1 FROM hiring_decisions d WHERE d.application_id = a.id AND d.decision = 'reject'
              AND d.decided_by IS NOT NULL AND NULLIF(BTRIM(COALESCE(d.reason, '')), '') IS NOT NULL)`]
]);
boardColumn("withdrawn", "Board column: Withdrawn (withdrawn)");

const FEEDBACK_TASK = `EXISTS (SELECT 1 FROM tasks t WHERE t.org_id = d.org_id
              AND t.source_workflow = 'hiring-candidate-feedback'
              AND t.body = 'hiring:feedback:' || d.application_id::text)`;

check({
  key: "hiring-advance",
  surface: "hiring.html",
  control: "Drawer: stage select + Advance button (move to next stage up to hired, optional reason)",
  requirement: "Every move forward must name a forward stage and where the person started, be logged as an offer only when it goes to Offer, leave the person in the stage it names, and close the application when it goes to Hired.",
  parts: [{
    from: DECISION_FROM,
    where: `d.org_id = $1::uuid AND d.decision IN ('advance', 'offer')\n      AND ${REAL_CANDIDATE}`,
    bad: [
      ["an offer was logged as a plain move, or a plain move was logged as an offer",
        `(d.decision = 'offer' AND COALESCE(d.to_stage_key, '') <> 'offer')
                OR (d.decision = 'advance' AND COALESCE(d.to_stage_key, '') = 'offer')`],
      ["a move names no forward stage",
        `COALESCE(d.to_stage_key, '') NOT IN ('applied', 'screening', 'group_interview', 'one_on_one', 'offer',
                  'hired', 'onboarding', 'ramp', 'performing')`],
      ["a move does not say where the person started", BLANK("d.from_stage_key")],
      ["the move was logged but the person never moved",
        `NOT EXISTS (SELECT 1 FROM hiring_decisions n WHERE n.application_id = d.application_id AND n.created_at > d.created_at)
                AND s.key <> COALESCE(d.to_stage_key, '')`],
      ["the person was moved to Hired but the application is not marked hired",
        `COALESCE(d.to_stage_key, '') = 'hired' AND a.status <> 'hired'`]
    ]
  }]
});

check({
  key: "hiring-reject",
  surface: "hiring.html",
  control: "Drawer: Reject button + required reason box (asks confirm, no undo)",
  requirement: "Every turn-down must name a person who still exists, carry the written reason, end at Not Moving Forward with the application marked rejected, and raise the job of telling the candidate.",
  parts: [{
    from: `${DECISION_FROM}
      LEFT JOIN staff st ON st.id = d.decided_by`,
    where: `d.org_id = $1::uuid AND d.decision = 'reject'\n      AND ${REAL_CANDIDATE}`,
    bad: [
      ["turned down with no named person", "st.id IS NULL"],
      ["turned down with no written reason", BLANK("d.reason")],
      ["the turn-down does not end at Not Moving Forward", `COALESCE(d.to_stage_key, '') <> 'rejected'`],
      ["the application is not marked rejected", `a.status <> 'rejected'`],
      ["the person is not in the Not Moving Forward stage", `s.key <> 'rejected'`],
      ["no job was raised to tell the candidate", `NOT ${FEEDBACK_TASK}`]
    ]
  }]
});

check({
  key: "hiring-postings",
  surface: "hiring.html",
  control: "Postings: state rail (all, draft, posted, paused, closed, failed) and channel rail (all, linkedin, facebook, job_board, internal)",
  requirement: "Every real posting must read the way its state says: failed keeps the channel's own words, posted has a posted date and is live on an outside channel, closed has a closed date, and closing never comes before posting.",
  parts: [{
    from: "hiring_job_postings p",
    where: `p.org_id = $1::uuid AND COALESCE(p.is_demo, false) = false`,
    bad: [
      ["a failed posting keeps no reason", `p.status = 'failed' AND ${BLANK("p.last_error")}`],
      ["a posted posting has no posted date", `p.status = 'posted' AND p.posted_at IS NULL`],
      ["a closed posting has no closed date", `p.status = 'closed' AND p.closed_at IS NULL`],
      ["a posting is marked posted on an outside channel but was never published",
        `p.status = 'posted' AND p.channel IN ('linkedin', 'facebook', 'job_board') AND ${BLANK("p.external_id")}`],
      ["a posting closed before it was posted",
        `p.posted_at IS NOT NULL AND p.closed_at IS NOT NULL AND p.closed_at < p.posted_at`]
    ]
  }]
});

const RECOUNT_OPEN = `(SELECT count(*) FROM candidate_applications a WHERE a.role_id = b.role_id AND a.status = 'open')`;
const RECOUNT_BENCH = `(SELECT count(*) FROM candidate_applications a JOIN pipeline_stages s ON s.id = a.stage_id
                 WHERE a.role_id = b.role_id AND a.status = 'open' AND s.key IN ('one_on_one', 'offer'))`;

check({
  key: "hiring-bench-tiles",
  surface: "hiring.html",
  control: "Summary tiles: SHORT BY, WAITING ON YOU, ON THE BENCH, OPEN APPLICATIONS + bench chip",
  emptyAs: undefined,
  requirement: "Every hiring role the tiles add up must show the open applications and the bench people a recount of its own applications gives, and its short-by number must be its target minus that bench, never below zero.",
  parts: [{
    from: "v_hiring_bench b",
    where: "b.org_id = $1::uuid",
    bad: [
      ["the open applications number is not the open applications on file", `b.open_applications <> ${RECOUNT_OPEN}`],
      ["the bench number is not the people at 1:1 or Offer", `b.bench_count <> ${RECOUNT_BENCH}`],
      ["the short-by number is not the target minus the bench",
        `b.bench_shortfall <> CASE WHEN b.bench_target - ${RECOUNT_BENCH} > 0 THEN b.bench_target - ${RECOUNT_BENCH} ELSE 0 END`]
    ]
  }]
});

// ──────────────────────── inquiry-remover.html (Specialist desk) ────────────────────────

const DONE_WORDS = (col) => `(LOWER(${col}) LIKE '%removed%' OR LOWER(${col}) LIKE '%confirmed%'
                  OR LOWER(${col}) LIKE '%deleted%' OR LOWER(${col}) LIKE '%cleared%')`;
// The page shows status, and the outcome when there is no status (pill(status, outcome)).
const SHOWN_STATUS = `COALESCE(NULLIF(BTRIM(COALESCE(l.status, '')), ''), l.outcome, '')`;
const COUNTING_ATTEMPTS = `(SELECT count(*) FROM inquiry_attempts t WHERE t.inquiry_id = l.id AND t.kind IN ('call', 'letter', 'portal'))`;
const ANY_ATTEMPT = `EXISTS (SELECT 1 FROM inquiry_attempts t WHERE t.inquiry_id = l.id)`;

check({
  key: "specialist-stat-tiles",
  surface: "inquiry-remover.html",
  control: "Stat tiles: Still open, Worked, Calls, Confirmed (move by the server's counts after each write)",
  requirement: "Every real inquiry the four tiles add up must keep the counts the tiles use: a confirmed removal reads as done and closed, a row with logged attempts shows the same number of counted attempts, and worked rows say who worked them.",
  parts: [{
    from: "inquiry_log l",
    where: "l.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false",
    bad: [
      ["a removal is confirmed but the status does not say removed",
        `l.confirmed_at IS NOT NULL AND NOT ${DONE_WORDS(SHOWN_STATUS)}`],
      ["a removal is confirmed but the inquiry still reads open", `l.confirmed_at IS NOT NULL AND l.is_open = true`],
      ["the attempt count is not the number of attempts logged for the row",
        `${ANY_ATTEMPT} AND l.call_attempts <> ${COUNTING_ATTEMPTS}`],
      ["attempts were logged but nobody and no time is recorded as having worked the row",
        `${ANY_ATTEMPT} AND (l.worked_by IS NULL OR l.worked_at IS NULL)`]
    ]
  }]
});

const BUREAU_UP = `UPPER(BTRIM(COALESCE(l.bureau, '')))`;

check({
  key: "specialist-bureau-chips",
  surface: "inquiry-remover.html",
  control: "Bureau chips: Equifax, TransUnion, Experian (filter the work queue; show open counts)",
  requirement: "Every open inquiry must name one of the three bureaus the chips count (Equifax, TransUnion or Experian), so the three open counts add up to the Still open tile and the filter can reach every open row.",
  parts: [{
    from: "inquiry_log l",
    where: `l.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false
      AND NOT ${DONE_WORDS(SHOWN_STATUS)}`,
    bad: [
      ["an open inquiry names no bureau a chip counts",
        `${BUREAU_UP} NOT IN ('EQ', 'EQUIFAX', 'TU', 'TRANSUNION', 'TRANS UNION', 'EX', 'EXPERIAN')`]
    ]
  }]
});

const CASE_ATTEMPT = (kind) =>
  `EXISTS (SELECT 1 FROM inquiry_attempts t JOIN inquiry_log l ON l.id = t.inquiry_id
              WHERE COALESCE(l.inquiry_removal_case_id, l.case_id) = k.id AND t.kind = '${kind}')`;

check({
  key: "specialist-send-options",
  surface: "inquiry-remover.html",
  control: "Case drawer send options: 'Mail letter (PostGrid)' checkbox, 'Mail service' select (bureau default, first class, priority, priority express), Experian portal reference input, 'Upload to Experian portal' checkbox, 'Open Experian upload' link",
  requirement: "Every case that was sent through the drawer must keep what the send options said: an Experian portal upload names an Experian case, keeps a reference, logs a portal attempt and moves the case on, and a mailed letter keeps its provider id, logs a letter attempt, moves the case on, and was not left failed.",
  parts: [
    {
      from: "inquiry_removal_cases k",
      where: `k.org_id = $1::uuid AND COALESCE(k.is_demo, false) = false AND ${PRESENT("k.portal_confirmation")}`,
      bad: [
        ["a portal upload was saved on a case that is not Experian", `UPPER(BTRIM(COALESCE(k.selected_bureaus_raw, ''))) <> 'EX'`],
        ["a portal reference was saved but no portal attempt was logged", `NOT ${CASE_ATTEMPT("portal")}`],
        ["a portal upload was saved but the case still reads waiting", `k.case_status::text IN ('Queued', 'Blocked')`]
      ]
    },
    {
      from: "inquiry_removal_cases k",
      where: `k.org_id = $1::uuid AND COALESCE(k.is_demo, false) = false AND ${PRESENT("k.letter_provider_id")}`,
      bad: [
        ["a mail provider id was saved but no letter attempt was logged", `NOT ${CASE_ATTEMPT("letter")}`],
        ["a letter was handed to the mail provider but the case still reads waiting", `k.case_status::text IN ('Queued', 'Blocked')`]
      ]
    },
    {
      from: `inquiry_attempts t
      JOIN inquiry_log l ON l.id = t.inquiry_id`,
      where: `t.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false AND t.kind = 'letter'
      AND LOWER(COALESCE(t.outcome, '')) LIKE 'mail_failed%'`,
      bad: [
        ["a letter failed to mail and no later letter went out for that inquiry",
          `NOT EXISTS (SELECT 1 FROM inquiry_attempts u WHERE u.inquiry_id = t.inquiry_id AND u.kind = 'letter'
                AND u.created_at > t.created_at AND LOWER(COALESCE(u.outcome, '')) NOT LIKE 'mail_failed%')`]
      ]
    }
  ]
});

// ───────────────────────────── the registry rows ─────────────────────────────

/** One display result contract per check, in the same shape display-saved-result.mjs registers. */
export const FIN_B13_DISPLAY_CONTRACTS = Object.freeze(FIN_B13_CHECKS.map((spec) => Object.freeze({
  control: spec.control,
  mode: "query",
  requirement: spec.requirement,
  sql: sqlFor(spec),
  ...(spec.emptyAs ? { emptyAs: spec.emptyAs } : {}),
  anyImpact: true
})));
