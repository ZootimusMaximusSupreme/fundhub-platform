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
//                 in fin-b13-display-practice.mjs. A row whose screen half a saved read cannot see (a
//                 filter, a column, a rail) has BOTH: the live check judges the saved rows behind it and
//                 the practice test judges what the page does with them.
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

const FORWARD_NOTE = "A move forward may be made by a scheduling job and its reason is optional, so no person or words are judged here.";
const NOT_ON_SCREEN = "The drawer stops at Hired, so nothing on the screen moves anyone into this column; it reads no results until someone is placed here (the decide endpoint accepts it), and then it goes red if that person is not marked hired.";

function boardColumn(stage, control, requirement, extra = []) {
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
    requirement,
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

boardColumn("screening", "Board column: Screening (screening)",
  `Every real application in the Screening column must be open and must have a recorded move into screening. ${FORWARD_NOTE}`);
boardColumn("offer", "Board column: Offer (offer)",
  "Every real application in the Offer column must be open, must have a recorded move into offer, and must have an offer decision that names a person (the database refuses an offer with nobody named). The reason is optional, so no words are judged.", [
  ["an offer was made by nobody",
    `NOT EXISTS (SELECT 1 FROM hiring_decisions d WHERE d.application_id = a.id AND d.decision = 'offer' AND d.decided_by IS NOT NULL)`]
]);
boardColumn("hired", "Board column: Hired (hired)",
  `Every real application in the Hired column must be marked hired and must have a recorded move into hired. ${FORWARD_NOTE}`);
boardColumn("onboarding", "Board column: Onboarding (onboarding)",
  `Every real application in the Onboarding column must be marked hired and must have a recorded move into onboarding. ${NOT_ON_SCREEN}`);
boardColumn("ramp", "Board column: Ramp (60-day trial) (ramp)",
  `Every real application in the Ramp column must be marked hired and must have a recorded move into ramp. ${NOT_ON_SCREEN}`);
boardColumn("performing", "Board column: Performing (performing)",
  `Every real application in the Performing column must be marked hired and must have a recorded move into performing. ${NOT_ON_SCREEN}`);
boardColumn("rejected", "Board column: Not Moving Forward (rejected)",
  "Every real application in the Not Moving Forward column must be marked rejected, must have a recorded move into rejected, and must have a reject decision that names a person and carries written words.", [
  ["turned down with no named person or no written reason",
    `NOT EXISTS (SELECT 1 FROM hiring_decisions d WHERE d.application_id = a.id AND d.decision = 'reject'
              AND d.decided_by IS NOT NULL AND NULLIF(BTRIM(COALESCE(d.reason, '')), '') IS NOT NULL)`]
]);
boardColumn("withdrawn", "Board column: Withdrawn (withdrawn)",
  "Every real application in the Withdrawn column must be marked withdrawn and must have a recorded move into withdrawn. Nothing in the product writes this stage today, so this reads no results until someone is placed here.");

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

// The rails on the page. hiring.html builds its buttons from these two literal lists (POST_STATES and
// POST_CHANNELS); fin-b13-live-contracts.test.mjs reads them off the page and fails if this text drifts.
// The database allows a fifth channel, zoho (migration 298), and src/hiring/zoho.mjs writes every Zoho
// posting on it. No button reaches it, so a Zoho posting is counted in "all channels" and in no channel.
export const POST_STATE_BUTTONS = ["draft", "posted", "paused", "closed", "failed"];
export const POST_CHANNEL_BUTTONS = ["linkedin", "facebook", "job_board", "internal"];
const sqlList = (items) => items.map((item) => `'${item}'`).join(", ");

check({
  key: "hiring-postings",
  surface: "hiring.html",
  control: "Postings: state rail (all, draft, posted, paused, closed, failed) and channel rail (all, linkedin, facebook, job_board, internal)",
  requirement: "Every real posting must be reachable from a button and read the way its state says: its state and its channel are ones a rail button names (a Zoho posting is counted in all channels and in no channel button), failed keeps the channel's own words, posted has a posted date and is live on an outside channel, closed has a closed date, and closing never comes before posting.",
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
        `p.posted_at IS NOT NULL AND p.closed_at IS NOT NULL AND p.closed_at < p.posted_at`],
      ["a posting is on a channel no channel button reaches",
        `p.channel NOT IN (${sqlList(POST_CHANNEL_BUTTONS)})`],
      ["a posting is in a state no state button reaches",
        `p.status NOT IN (${sqlList(POST_STATE_BUTTONS)})`]
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
  requirement: "Every active hiring role the tiles add up must show the open applications and the bench people a recount of its own applications gives, with its short-by number its target minus that bench and never below zero; every open application must sit in a stage where a person is still being considered and belong to an active role, so the open number cannot count someone who is no longer open or leave someone out. WAITING ON YOU is read from the candidates list and is judged by the page test, not here.",
  parts: [{
    from: "v_hiring_bench b",
    where: "b.org_id = $1::uuid",
    bad: [
      ["the open applications number is not the open applications on file", `b.open_applications <> ${RECOUNT_OPEN}`],
      ["the bench number is not the people at 1:1 or Offer", `b.bench_count <> ${RECOUNT_BENCH}`],
      ["the short-by number is not the target minus the bench",
        `b.bench_shortfall <> CASE WHEN b.bench_target - ${RECOUNT_BENCH} > 0 THEN b.bench_target - ${RECOUNT_BENCH} ELSE 0 END`]
    ]
  }, {
    // The open count above is a view recounted against its own predicates, so it can only go red if
    // someone edits the view. These two read the saved applications themselves and go red from data.
    from: APPLICATION_FROM,
    where: `a.org_id = $1::uuid AND a.status = 'open'\n      AND ${REAL_CANDIDATE}`,
    bad: [
      ["an open application sits in a stage nobody is being considered in, so the open number counts someone who is not open",
        `s.key NOT IN ('applied', 'screening', 'group_interview', 'one_on_one', 'offer')`],
      ["an open application belongs to a role that is not an active hiring role, so no tile counts it",
        `NOT EXISTS (SELECT 1 FROM hiring_roles r WHERE r.id = a.role_id AND r.active = true)`]
    ]
  }]
});

// ──────────────────────── inquiry-remover.html (Specialist desk) ────────────────────────

const DONE_WORDS = (col) => `(LOWER(${col}) LIKE '%removed%' OR LOWER(${col}) LIKE '%confirmed%'
                  OR LOWER(${col}) LIKE '%deleted%' OR LOWER(${col}) LIKE '%cleared%')`;
// The page shows status, and the outcome when there is no status (pill(status, outcome)).
const SHOWN_STATUS = `COALESCE(NULLIF(BTRIM(COALESCE(l.status, '')), ''), l.outcome, '')`;

// The Stat tiles row (Still open, Worked, Calls, Confirmed) has no live check on purpose. After a confirm
// the page bumps Worked by one even for a row that already had attempts, so its words ("move by the
// server's counts after each write") are false for that tile and nothing saved can show a client-side bump
// (see the manifest, finding 2). The row stays not proved until the page changes.

// The page's bureau keys, written the way inquiry-remover.html writes them (BUREAU_KEYS). The test reads
// them off the page and fails if this list drifts.
export const BUREAU_SPELLINGS = ["EQ", "EQUIFAX", "TU", "TRANSUNION", "TRANS UNION", "EX", "EXPERIAN"];
const BUREAU_UP = `UPPER(BTRIM(COALESCE(l.bureau, '')))`;

check({
  key: "specialist-bureau-chips",
  surface: "inquiry-remover.html",
  control: "Bureau chips: Equifax, TransUnion, Experian (filter the work queue; show open counts)",
  requirement: "Every open inquiry the queue lists must name one of the three bureaus the chips count, in any spelling the page's bureau keys know (EQ, EQUIFAX, TU, TRANSUNION, TRANS UNION, EX, EXPERIAN), so the three open counts add up to the open rows and the filter can reach every one. Demo rows are counted: the page lists and counts them.",
  parts: [{
    from: "inquiry_log l",
    // No demo filter: api/read/inquiries.mjs does not filter is_demo and the page does not drop those
    // rows, so the chips on screen count them too.
    where: `l.org_id = $1::uuid AND NOT ${DONE_WORDS(SHOWN_STATUS)}`,
    bad: [
      ["an open inquiry names no bureau a chip counts",
        `${BUREAU_UP} NOT IN (${sqlList(BUREAU_SPELLINGS)})`]
    ]
  }]
});

const CASE_OF = `COALESCE(l.inquiry_removal_case_id, l.case_id)`;
const CASE_ATTEMPT = (kind) =>
  `EXISTS (SELECT 1 FROM inquiry_attempts t JOIN inquiry_log l ON l.id = t.inquiry_id
              WHERE ${CASE_OF} = k.id AND t.kind = '${kind}')`;
// Send options write in two steps with no transaction around them (src/inquiry-ops/send.mjs): the attempt
// is logged first, then the case row is updated. A part per direction, so a lost value is red too.
const ATTEMPT_OF_CASE = `inquiry_attempts t
      JOIN inquiry_log l ON l.id = t.inquiry_id
      JOIN inquiry_removal_cases k ON k.id = ${CASE_OF}`;

check({
  key: "specialist-send-options",
  surface: "inquiry-remover.html",
  control: "Case drawer send options: 'Mail letter (PostGrid)' checkbox, 'Mail service' select (bureau default, first class, priority, priority express), Experian portal reference input, 'Upload to Experian portal' checkbox, 'Open Experian upload' link",
  requirement: "Every case that was sent through the drawer must keep what the send options said, both ways: an Experian portal upload names an Experian case, keeps the reference, logs a portal attempt and moves the case on, and a logged portal upload has its reference on the case; a mailed letter keeps its provider id, logs a letter attempt and moves the case on, a letter logged as sent has its provider id on the case, and a failed mail is not left failed. The Mail service choice is sent to the mail provider and saved nowhere, so only the page's request is judged for it, by the page test.",
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
      from: ATTEMPT_OF_CASE,
      where: `t.org_id = $1::uuid AND COALESCE(k.is_demo, false) = false AND t.kind = 'portal'
      AND LOWER(COALESCE(t.outcome, '')) = 'uploaded' AND LOWER(COALESCE(t.note, '')) LIKE 'experian_ref:%'`,
      bad: [
        ["a portal upload was logged but the case kept no reference", BLANK("k.portal_confirmation")]
      ]
    },
    {
      from: ATTEMPT_OF_CASE,
      where: `t.org_id = $1::uuid AND COALESCE(k.is_demo, false) = false AND t.kind = 'letter'
      AND LOWER(COALESCE(t.outcome, '')) = 'sent'`,
      bad: [
        ["a letter was logged as sent but the case kept no provider id", BLANK("k.letter_provider_id")]
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
