// Finish-853 batch 15 (tier 4, lane gap-catalog-display): the Lenders desk and the Marketing
// Command Center, rows the earlier rounds could not attach.
//
// Two kinds of attachment live in this batch, and each row says which one it has:
//
//   LIVE CHECK    A read-only SQL text the display lane runs for the company. It returns
//                 sample_count (how many saved results exist) and bad_count (how many are wrong)
//                 and goes red on the first wrong one. A control nobody has used yet has no
//                 results, so it is green with the words "no saved results yet" (emptyAs "quiet").
//                 The one control that must always have results (the lender book) leaves emptyAs
//                 off, so an empty book is red.
//   PRACTICE TEST A real page in Chromium, fake /api answers, one click, and a judgement of the
//                 exact request and the words painted; or the real handler or job over stand-in
//                 rows. It reads no live data. Those rows are listed in fin-b15-display-specs.mjs.
//                 A row may own both: the live check reads what the control left in the saved
//                 data, and the practice test holds what the saved data cannot say (what a button
//                 sent, what the job does with an answer it refused, the numbers inside a file).
//
// REPAIR CYCLE 1 (2026-10-14 night). An independent checker broke each of 21 rows and found checks
// that stayed green. What changed here, row by row, is in ops/workflows/finish-853-2026-10-14/
// manifest-b15.md. The rule that came out of it: a live check may not count a row it cannot judge
// (a condition the database itself refuses cannot go red, a field set when the observation was
// logged says nothing about a later press), and may not go red on a designed outcome (a thin
// research run). Where a live check cannot be honest, the row is a practice test or is left open.
//
// Every live check is built from named bad-result conditions. The SQL text is the conditions
// joined with OR, one SELECT per kind of saved row, stacked with UNION ALL.
// fin-b15-live-contracts.test.mjs runs that exact text over stand-in rows, breaks one condition at a
// time and sees it go red, and drops each condition from the text and sees that its row is no
// longer caught.
//
// This file is read at build time by scripts/pulse/compile-catalog.mjs. The live bundle reads the
// compiled copy in src/pulse/catalog/generated.json, so it imports nothing.
//
// It must not import display-saved-result.mjs (that file imports this one).

export const FIN_B15_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B15_SOURCE_FILE = "desks-c.json";

// ───────────────────────────── the live checks ─────────────────────────────
//
// Every check: one or more parts. A part is one table to read (from), which rows count (where),
// and the named conditions that make a row WRONG (bad). $1 is the company. Written in the common
// subset of Postgres and SQLite on purpose (no regular expressions) so the test can run the exact
// text. The few Postgres-only spellings are listed in fin-b15-sql-kit.mjs portableSql().

/** @type {Array<{key:string, control:string, surface:string, requirement:string, emptyAs?:string,
 *   parts:Array<{from:string, where:string, bad:Array<[string,string]>}>}>} */
export const FIN_B15_CHECKS = [];

function check(spec) {
  const parts = spec.parts.map((part) => Object.freeze({
    from: part.from, where: part.where, bad: Object.freeze(part.bad.map((pair) => Object.freeze([...pair])))
  }));
  FIN_B15_CHECKS.push(Object.freeze({ emptyAs: "quiet", ...spec, parts: Object.freeze(parts) }));
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

/* A carriage return, written out: chunkText (src/company-brain/chunk.mjs) turns \r\n into \n before it cuts,
   so a saved report with Windows line ends is compared with its carriage returns taken out. */
const CR = String.fromCharCode(13);
const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;
const ORG = (alias) => `${alias}.org_id = $1::uuid`;

// ── lenders.html (the Lender book) ─────────────────────────────────────────

const LENDER_ROW_BAD = [
  ["a lender has no name", BLANK("l.name")],
  ["a lender dollar amount is below zero",
    `l.typical_approval_range < 0 OR l.average_starting_loc < 0 OR l.max_known_loc < 0 OR l.minimum_deposit < 0`],
  ["a starting line is bigger than the biggest line ever seen",
    `l.average_starting_loc IS NOT NULL AND l.max_known_loc IS NOT NULL AND l.average_starting_loc > l.max_known_loc`]
];

// The page leaves demo lenders out unless demo mode is on (src/lenders/store.mjs listLenders), so the
// checks leave them out too: a demo row is not on the book.
const REAL_LENDER = `COALESCE(l.is_demo, false) = false`;

const MISMATCH_ROW_BAD = [
  ["a mismatch names no bureau that was seen", BLANK("o.observed_bureau")],
  ["a mismatch names no lender", `o.lender_row_id IS NULL AND ${BLANK("o.lender_name")}`],
  ["a mismatch points at a lender of another company",
    `o.lender_row_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lenders x WHERE x.id = o.lender_row_id AND x.org_id = o.org_id)`]
];

// The Dismiss button has no live check on purpose (repair cycle 1). reviewObservation saves ONLY
// review_status (and created_by when empty): no reviewer, no time. Every condition a query could
// judge on a dismissed row is a field set when the observation was LOGGED, so such a check goes red for
// a badly logged observation and never for a wrong Dismiss. Dismiss is a practice test instead:
// fin-b15-lenders-dismiss.test.mjs (the real handler over stand-in rows) and the page spec
// e2e/fin-b15-lenders-dismiss.spec.mjs (the real button).

check({
  key: "lenders-page-load",
  surface: "lenders.html",
  control: "Page load: list read + mismatch-queue read; empty-book banner",
  emptyAs: undefined,
  requirement: "The company must have lenders on its book (the empty-book banner means the import is missing), every lender must have a name, and every open mismatch must say which bureau was seen and name a lender of this company.",
  parts: [
    {
      from: "lenders l",
      where: `${ORG("l")} AND ${REAL_LENDER}`,
      bad: [["a lender has no name", BLANK("l.name")]]
    },
    {
      from: "lender_bureau_observations o",
      where: `${ORG("o")} AND o.review_status = 'pending' AND o.mismatch_flag = true`,
      bad: MISMATCH_ROW_BAD
    },
    {
      from: "(SELECT 1 AS one) e",
      where: `NOT EXISTS (SELECT 1 FROM lenders x WHERE x.org_id = $1::uuid AND COALESCE(x.is_demo, false) = false)`,
      bad: [["the lender book is empty", "e.one = 1"]]
    }
  ]
});

check({
  key: "lenders-list-tab",
  surface: "lenders.html",
  control: "Tab: Lender list",
  requirement: "Every lender the list shows must have a name, no dollar amount below zero, and a starting line no bigger than the biggest known line.",
  parts: [{ from: "lenders l", where: `${ORG("l")} AND ${REAL_LENDER}`, bad: LENDER_ROW_BAD }]
});

check({
  key: "lenders-mismatch-tab",
  surface: "lenders.html",
  control: "Tab: Bureau mismatch queue (with open-count badge)",
  requirement: "Every open mismatch the queue counts must say which bureau was seen, name its lender, and point only at a lender of this company.",
  parts: [{
    from: "lender_bureau_observations o",
    where: `${ORG("o")} AND o.review_status = 'pending' AND o.mismatch_flag = true`,
    bad: MISMATCH_ROW_BAD
  }]
});

check({
  key: "lenders-ai-bureau-tab",
  surface: "lenders.html",
  control: "Tab: AI bureau config",
  requirement: "Every bureau call setup must name its bureau, allow at least one try, never wait a negative time or hold, and never say it was verified by nobody.",
  parts: [{
    from: "ai_bureau_config c",
    where: ORG("c"),
    bad: [
      ["a bureau setup has no code or no name", `${BLANK("c.bureau_code")} OR ${BLANK("c.bureau_name")}`],
      ["a bureau setup allows no tries", "c.retry_limit < 1"],
      ["a bureau setup waits a negative time", "c.retry_delay_minutes < 0 OR c.expected_hold_minutes < 0"],
      ["a bureau setup says verified with nobody named", `c.last_verified_at IS NOT NULL AND ${BLANK("c.last_verified_by")}`]
    ]
  }]
});

// ── marketing-command-center.html: Ideas ───────────────────────────────────

const MC = "marketing-command-center.html";

/* The prices the usage ledger writes with (src/marketing/model-usage.mjs MODEL_PRICES: dollars per
   million tokens; cache write is 1.25 times input; a web search is a cent). This file imports nothing,
   so the numbers are written out here and fin-b15-live-contracts.test.mjs holds them equal to the
   product's own table. A model the product prices must be priced here too: the test fails if
   MODEL_PRICES gains a model this list does not name. */
export const METER_RATES = Object.freeze({
  "claude-opus-5-5": Object.freeze({ input: 4, output: 20, cache_read: 0.2, cache_write: 5 }),
  "claude-sonnet-5-5": Object.freeze({ input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 })
});
export const METER_FREE_MODELS = Object.freeze(["claude-code"]);
export const METER_SEARCH_USD = 0.01;

const meterExpected = (rate) =>
  `(u.input_tokens * ${rate.input} + u.output_tokens * ${rate.output} + u.cache_read_tokens * ${rate.cache_read}`
  + ` + u.cache_write_tokens * ${rate.cache_write}) / 1000000.0 + u.web_search_requests * ${METER_SEARCH_USD}`;

const METER_PRICED = [...Object.keys(METER_RATES), ...METER_FREE_MODELS].map((m) => `'${m}'`).join(", ");

check({
  key: "mkt-month-meter",
  surface: MC,
  control: "Ideas: month spend meter (used of cap)",
  requirement: "Every model call saved this month must carry its price when the price is on file: each of the three priced models (claude-opus-5-5, claude-sonnet-5-5, claude-code) must be saved with a cost, that cost must equal its tokens at the model's price plus a cent for each web search (claude-code costs nothing), because the meter adds these costs up and counts an unknown cost at the worst-case rate.",
  parts: [{
    from: "marketing_model_usage u",
    where: `${ORG("u")} AND u.created_at >= now() - interval '35 days'`,
    bad: [
      ["a priced model was saved with an unknown cost", `u.model IN (${METER_PRICED}) AND u.cost_usd IS NULL`],
      ["a call was saved at a cost that is not its tokens at the model's price",
        [
          ...Object.entries(METER_RATES).map(([model, rate]) =>
            `(u.model = '${model}' AND u.cost_usd IS NOT NULL AND ABS(u.cost_usd - (${meterExpected(rate)})) > 0.00001)`),
          ...METER_FREE_MODELS.map((model) => `(u.model = '${model}' AND u.cost_usd IS NOT NULL AND u.cost_usd <> 0)`)
        ].join("\n                OR ")]
    ]
  }]
});

const IDEA_FILE_MISSING = `NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = i.org_id AND o.op_id = 'idea-file:' || i.id::text)`;

check({
  key: "mkt-ideas-make-more",
  surface: MC,
  control: "Ideas: angles list: 'Make more of this' button on each angle",
  requirement: "Every idea the Make more button saved must carry its angle key, name the angle in its words, and have its idea file queued for the repo in the same save.",
  parts: [{
    from: "ad_ideas i",
    where: `${ORG("i")} AND i.source = 'chris' AND i.raw_points LIKE 'Make more of this angle:%'`,
    bad: [
      ["a make-more idea carries no angle", "i.angle_key IS NULL"],
      ["a make-more idea names no angle in its words", "LENGTH(TRIM(i.raw_points)) <= 26"],
      ["a make-more idea has no file queued for the repo", IDEA_FILE_MISSING]
    ]
  }]
});

check({
  key: "mkt-numbers-make-more",
  surface: MC,
  control: "Numbers: Angles cards: 'Make more of this' -> idea box (text + Save idea / Cancel)",
  requirement: "Every idea saved from an angle card must carry that angle and the typed words as Chris wrote them, and have its idea file queued for the repo in the same save.",
  parts: [{
    from: "ad_ideas i",
    where: `${ORG("i")} AND i.source = 'chris' AND i.angle_key IS NOT NULL AND i.kind = 'script'`,
    bad: [
      ["an angle idea has no words", BLANK("i.raw_points")],
      ["an angle idea has no file queued for the repo", IDEA_FILE_MISSING]
    ]
  }]
});

check({
  key: "mkt-research-form",
  surface: MC,
  control: "Ideas: research form: question box, depth toggle (Quick look / Leave nothing unturned), 3 source checkboxes, belief input, 'Stop at $' cap, 'Research it'",
  requirement: "Every research run must keep the typed question, a depth the form offers, the sources object with at least one place to look (live web pages or the vault), a belief line that is words and no longer than 500 letters when one was typed, and a stop amount above zero that the run did not spend more than twice over (a step already running may overshoot by its own calls, design rule 13); a finished run must name the repo file its report was saved to.",
  parts: [{
    from: "marketing_jobs j",
    where: `${ORG("j")} AND j.kind = 'deep_research'`,
    bad: [
      ["a research run has no question", BLANK("j.payload->>'question'")],
      ["a research run has a depth the form does not offer", `COALESCE(j.payload->>'depth', '') NOT IN ('quick', 'deep')`],
      ["a research run has no stop amount above zero", `COALESCE(CAST(j.payload->>'max_cost_usd' AS numeric), 0) <= 0`],
      ["a research run kept no sources object", `jsonb_typeof(j.payload->'sources') IS DISTINCT FROM 'object'`],
      ["a research run was told to look nowhere",
        `CAST(j.payload->'sources'->>'web' AS text) IN ('false', '0') AND CAST(j.payload->'sources'->>'vault' AS text) IN ('false', '0')`],
      ["a research run kept a belief that is not words or is too long",
        `j.payload->>'belief' IS NOT NULL AND (${BLANK("j.payload->>'belief'")} OR LENGTH(j.payload->>'belief') > 500)`],
      ["a research run spent more than twice its stop amount",
        `COALESCE(CAST(j.payload->>'max_cost_usd' AS numeric), 0) > 0
         AND (SELECT COALESCE(SUM(u.cost_usd), 0) FROM marketing_model_usage u WHERE u.org_id = j.org_id AND u.job_id = j.id)
             > 2 * CAST(j.payload->>'max_cost_usd' AS numeric)`],
      ["a finished run names no repo file for its report", `j.status = 'done' AND ${BLANK("j.result->'report'->>'repo_path'")}`]
    ]
  }]
});

check({
  key: "mkt-research-card",
  surface: MC,
  control: "Ideas: research card buttons: Read it / Hide it, Approve, Tweak (+ 'Run the tweak'), Redo, 'Save to the brain', Retry",
  requirement: "Every finished report must have its report file queued for the repo, every approved report must have a named approver and its approved file queued, every tweak run must point at a real earlier run of this company and say what to look at, and every page saved to the brain from a report must belong to a finished report of this company, hold text the brain can answer from, and open with the words of that report. Redo starts a new run and Retry puts the same run back in the queue, so both leave the run row the form check above judges (question, depth, sources, stop amount).",
  parts: [
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'deep_research'`,
      bad: [
        ["a finished report has no file queued", `j.status = 'done' AND NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id = 'research-' || j.id::text || '-report')`],
        ["an approved report has no approved file queued", `j.approved_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id = 'research-' || j.id::text || '-approved')`],
        ["an approval has no person behind it", `j.approved_at IS NOT NULL AND j.approved_by IS NULL`],
        ["a tweak run points at no earlier run", `j.payload->>'parent_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marketing_jobs p WHERE p.org_id = j.org_id AND p.kind = 'deep_research' AND p.id::text = j.payload->>'parent_id')`],
        ["a tweak run has no note to look at", `j.payload->>'parent_id' IS NOT NULL AND ${BLANK("j.payload->>'focus'")}`]
      ]
    },
    {
      // "Save to the brain" (api/marketing/research/brain.mjs): one brain_files row per report, keyed
      // generated:deep-research:<run id>. replaceFileChunks writes the chunks AFTER the file row, so a
      // failed embedding leaves a page with no chunks, and the next press says "unchanged".
      from: "brain_files f",
      where: `${ORG("f")} AND f.drive_file_id LIKE 'generated:deep-research:%'`,
      bad: [
        ["a brain page points at no finished report of this company",
          `NOT EXISTS (SELECT 1 FROM marketing_jobs r WHERE r.org_id = f.org_id AND r.kind = 'deep_research' AND r.status = 'done'
                       AND 'generated:deep-research:' || LOWER(CAST(r.id AS text)) = f.drive_file_id)`],
        ["a brain page holds no text the brain can answer from",
          `NOT EXISTS (SELECT 1 FROM brain_chunks c WHERE c.org_id = f.org_id AND c.file_id = f.id)`],
        ["a brain page opens with words that are not its report",
          `EXISTS (SELECT 1 FROM brain_chunks c1
                    JOIN marketing_jobs r1 ON r1.org_id = c1.org_id AND r1.kind = 'deep_research'
                   WHERE c1.org_id = f.org_id AND c1.file_id = f.id AND c1.chunk_index = 0
                     AND 'generated:deep-research:' || LOWER(CAST(r1.id AS text)) = f.drive_file_id
                     AND strpos(REPLACE(r1.result->'report'->>'markdown', '${CR}', ''), SUBSTR(c1.content, 1, 60)) = 0)`]
      ]
    }
  ]
});

// ── Ideas flywheel: one check per step ─────────────────────────────────────

/** The saved stage file rows (and the approve edits) for one step, judged for shape. */
function stepFilePart(n, file) {
  return {
    from: "repo_outbox o",
    where: `${ORG("o")} AND o.path LIKE 'marketing/flywheel/%/${file}'`,
    bad: [
      ["a saved step file has no stamp", `o.mode = 'replace' AND (o.content IS NULL OR substr(o.content, 1, 3) <> '---')`],
      ["a saved step file is stamped as another step", `o.mode = 'replace' AND substr(COALESCE(o.content, ''), 1, 3) = '---' AND strpos(substr(o.content, 1, 120), 'stage: ${n}') = 0`],
      ["an approve edit sets something other than status approved", `o.mode = 'edit' AND (o.edit->>'op' IS DISTINCT FROM 'set_front_matter_key' OR o.edit->>'key' IS DISTINCT FROM 'status' OR o.edit->>'value' IS DISTINCT FROM 'approved')`]
    ]
  };
}

const STEP_WORDS = "every saved step file must start with its stamp for this step, every approve must set status to approved and nothing else, and every Tweak note for this step must be queued as one dated line under the Notes heading of the owner notes file";

/** The Tweak notes for one step: one "date | stage N | words" line appended under "## Notes" in the
    campaign's 00-OWNER-NOTES.md (api/marketing/flywheel/tweak.mjs and src/marketing/avatar/tweak-route.mjs). */
function tweakNotePart(n) {
  return {
    from: "repo_outbox o",
    where: `${ORG("o")} AND o.mode = 'edit' AND o.edit->>'op' = 'append_line_under_heading'
            AND o.path LIKE 'marketing/flywheel/%/00-OWNER-NOTES.md' AND o.edit->>'line' LIKE '% | stage ${n} |%'`,
    bad: [
      ["a Tweak note is not added under the Notes heading", `o.edit->>'heading' IS DISTINCT FROM '## Notes'`],
      ["a Tweak note line is not a date, the step and words", `NOT (o.edit->>'line' LIKE '____-__-__ | stage ${n} | _%')`]
    ]
  };
}

check({
  key: "mkt-flywheel-1-avatar",
  surface: MC,
  control: "Ideas flywheel step 1 (avatar): run button 'Build the avatar', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the avatar step ${STEP_WORDS}, and every finished avatar run must have its files queued for the repo.`,
  parts: [
    stepFilePart(1, "01-avatar.md"),
    tweakNotePart(1),
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'avatar' AND j.status = 'done'`,
      bad: [["a finished avatar run has no file queued", `NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id LIKE 'avatar:' || j.id::text || ':%')`]]
    }
  ]
});

check({
  key: "mkt-flywheel-2-ad-research",
  surface: MC,
  control: "Ideas flywheel step 2 (ad-research): run button 'Research the market', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the market step ${STEP_WORDS}; a finished market run either says it was too thin to write a board (result.board.thin, no file by design) or names its board file and has that file queued for the repo.`,
  parts: [
    stepFilePart(2, "02-ad-research.md"),
    tweakNotePart(2),
    {
      // A thin run is a designed outcome (ad-research.mjs board step: "An if, not an agent, stops a board
      // being written on top of nothing"): done, result.board.thin set, no repo_path, no file queued.
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'flywheel_stage' AND CAST(j.payload->>'stage' AS text) = '2' AND j.status = 'done'
              AND NOT (j.result->'board'->>'thin' IS NOT NULL AND LENGTH(TRIM(j.result->'board'->>'thin')) > 0)`,
      bad: [
        ["a finished market run names no board file", BLANK("j.result->'board'->>'repo_path'")],
        ["a finished market run has no file queued", `NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id = 'flywheel-' || j.id::text || '-02')`]
      ]
    }
  ]
});

check({
  key: "mkt-flywheel-3-offer",
  surface: MC,
  control: "Ideas flywheel step 3 (offer): run button 'Write the offer', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the offer step ${STEP_WORDS}, and every finished offer run must hold an offer and its document.`,
  parts: [
    stepFilePart(3, "03-offer.md"),
    tweakNotePart(3),
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'offer' AND j.status = 'done'`,
      bad: [
        ["a finished offer run holds no offer", `jsonb_typeof(j.result->'offer') IS DISTINCT FROM 'object'`],
        ["a finished offer run holds no document", BLANK("j.result->>'document'")]
      ]
    }
  ]
});

check({
  key: "mkt-flywheel-4-copy",
  surface: MC,
  control: "Ideas flywheel step 4 (copy): run button 'Write the copy; needs step 3 approved', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the copy step ${STEP_WORDS}, and every finished copy run must have its file queued for the repo.`,
  parts: [
    stepFilePart(4, "04-copy.md"),
    tweakNotePart(4),
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'flywheel_stage' AND CAST(j.payload->>'stage' AS text) = '4' AND j.status = 'done'`,
      bad: [["a finished copy run has no file queued", `NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id LIKE 'flywheel:' || j.id::text || ':%')`]]
    }
  ]
});

check({
  key: "mkt-flywheel-5-strategy",
  surface: MC,
  control: "Ideas flywheel step 5 (ad-strategy): run button 'Pick the strategy; needs steps 3 and 4 approved', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the strategy step ${STEP_WORDS}, and every finished strategy run must have its file queued for the repo.`,
  parts: [
    stepFilePart(5, "05-ad-strategy.md"),
    tweakNotePart(5),
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'flywheel_stage' AND CAST(j.payload->>'stage' AS text) = '5' AND j.status = 'done'`,
      bad: [["a finished strategy run has no file queued", `NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id LIKE 'flywheel:' || j.id::text || ':%')`]]
    }
  ]
});

check({
  key: "mkt-flywheel-6-spend",
  surface: MC,
  control: "Ideas flywheel step 6 (spend): run button 'Read the spend (free, no model)', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the spend step ${STEP_WORDS}, and every spend read must be saved as the spend file.`,
  parts: [
    stepFilePart(6, "06-spend.md"),
    tweakNotePart(6),
    {
      from: "repo_outbox o",
      where: `${ORG("o")} AND o.op_id LIKE 'flywheel-spend:%'`,
      bad: [
        ["a spend read was saved to another file", `o.path NOT LIKE 'marketing/flywheel/%/06-spend.md'`],
        ["a spend read was saved as an edit", `o.mode <> 'replace'`]
      ]
    }
  ]
});

// ── Ideas funnels and Settings funnel card ─────────────────────────────────

/* What the saved page itself says about its own address and its links (funnel-tracking.mjs funnelTagBlock
   puts the page's path in window.FH_FUNNEL; funnel-pages.mjs sends the landing page's button to the
   booking page and the booking page to the thank-you page). A rename re-draws every built page. */
const HEAD_OF = (alias) => `substr(${alias}.html, 1, strpos(${alias}.html, '</head>'))`;

check({
  key: "mkt-funnel-rename",
  surface: MC,
  control: "Ideas funnels: 'Change the address' input + 'Save the address'",
  requirement: "Every built funnel must have exactly its three pages, each at the address its own address makes (the landing page at the funnel's address, the booking page with -book, the thank-you page with -thank-you); a funnel that is not live must have its landing address on that same address; and every written page must name its own address and send its button on to the next page's address, so a rename that moved the addresses but left the pages linking to the old ones is red.",
  parts: [
    {
      from: "marketing_funnels f",
      where: `${ORG("f")} AND f.kind IS NOT NULL`,
      bad: [
        ["a built funnel does not have exactly three pages", `(SELECT count(*) FROM marketing_funnel_pages p WHERE p.org_id = f.org_id AND p.funnel_id = f.id) <> 3`],
        ["a page sits at an address its funnel does not make",
          `EXISTS (SELECT 1 FROM marketing_funnel_pages p WHERE p.org_id = f.org_id AND p.funnel_id = f.id
                    AND p.path <> CASE p.role WHEN 'landing' THEN f.path WHEN 'booking' THEN f.path || '-book' ELSE f.path || '-thank-you' END)`],
        ["a draft funnel's landing address is not on its own address",
          `f.status IS DISTINCT FROM 'live'
           AND (f.landing_url IS NULL OR (f.landing_url NOT LIKE '%' || f.path AND f.landing_url NOT LIKE '%' || f.path || '/'))`]
      ]
    },
    {
      from: "marketing_funnel_pages p JOIN marketing_funnels f ON f.id = p.funnel_id AND f.org_id = p.org_id",
      where: `${ORG("p")} AND f.kind IS NOT NULL AND p.html IS NOT NULL`,
      bad: [
        ["a written page does not name its own address", `strpos(p.html, '"path":"' || p.path || '"') = 0`],
        ["a written landing page does not send its button to the funnel's booking page",
          `p.role = 'landing' AND strpos(p.html, 'href="' || f.path || '-book"') = 0`],
        ["a written booking page does not send people on to the funnel's thank-you page",
          `p.role = 'booking' AND strpos(p.html, '"' || f.path || '-thank-you"') = 0`]
      ]
    }
  ]
});

/* The saved words of one page, held to the SHAPE the copy check holds (funnel-copy.mjs checkCopy:
   every field filled, every list the right length). The banned-word, number and quote rules need the
   product's own checker and are held by the practice test fin-b15-funnel-build.test.mjs. */
const COPY_STRINGS = Object.freeze({
  landing: Object.freeze(["eyebrow", "headline", "subhead", "lede", "cta", "cta_note", "bullets_title", "steps_title"]),
  booking: Object.freeze(["eyebrow", "headline", "subhead", "lede", "booknote", "prep_title"]),
  thank_you: Object.freeze(["eyebrow", "headline", "subhead", "lede", "steps_title"])
});
const COPY_LISTS = Object.freeze({
  landing: Object.freeze([["bullets", 3, 6], ["steps", 3, 3], ["faq", 3, 5]]),
  booking: Object.freeze([["prep", 2, 4]]),
  thank_you: Object.freeze([["next_steps", 3, 3]])
});
export const FUNNEL_COPY_SHAPE = Object.freeze({ strings: COPY_STRINGS, lists: COPY_LISTS });

const copyShapeBad = (role) => {
  const parts = [
    ...COPY_STRINGS[role].map((k) => BLANK(`p.page_copy->>'${k}'`)),
    ...COPY_LISTS[role].map(([k, min, max]) =>
      `COALESCE(jsonb_array_length(p.page_copy->'${k}'), 0) NOT BETWEEN ${min} AND ${max}`)
  ];
  return `jsonb_typeof(p.page_copy) = 'object' AND p.role = '${role}' AND (${parts.join("\n             OR ")})`;
};

const HEAD_LACKS = (needle) => `strpos(${HEAD_OF("p")}, ${needle}) = 0`;
const SCRIPT_MISSING = (src) => `strpos(p.html, 'src="${src}"') = 0 AND strpos(p.html, 'src=''${src}''') = 0`;

check({
  key: "mkt-funnel-build",
  surface: MC,
  control: "Ideas funnels: 'Write the pages' / 'Write the pages again' (one model call, copy check)",
  requirement: "Every written page must come from a finished funnel job, must carry the words of a page that passed the copy check (every field filled, every list its right length), and must carry what the page check holds: its funnel tag meta, the tracking config and the Meta pixel in its head, and the fh-attribution.js and fh-events.js scripts. A job that wrote words the copy check refused saves nothing; that rule is held by the practice test on the page writer, not by this read.",
  parts: [{
    from: "marketing_funnel_pages p JOIN marketing_funnels f ON f.id = p.funnel_id AND f.org_id = p.org_id",
    where: `${ORG("p")} AND p.html IS NOT NULL`,
    bad: [
      ["a written page does not come from a finished funnel job",
        `NOT EXISTS (SELECT 1 FROM marketing_jobs j WHERE j.id = p.build_job_id AND j.org_id = p.org_id AND j.kind = 'funnel'
                      AND j.status = 'done' AND j.result->>'checks' = 'passed')`],
      ["a written page has no saved words", `p.page_copy IS NULL OR jsonb_typeof(p.page_copy) IS DISTINCT FROM 'object'`],
      ["a written landing page's words do not have the shape the copy check holds", copyShapeBad("landing")],
      ["a written booking page's words do not have the shape the copy check holds", copyShapeBad("booking")],
      ["a written thank-you page's words do not have the shape the copy check holds", copyShapeBad("thank_you")],
      ["a written page does not carry its funnel tag in the head",
        `f.tag IS NULL OR ${HEAD_LACKS(`'<meta name="fh-funnel-tag" content="' || f.tag || '">'`)}`],
      ["a written page has no tracking config in the head", HEAD_LACKS(`'window.FH_FUNNEL='`)],
      ["a written page has no Meta pixel in the head", HEAD_LACKS(`'fbq(''init'''`)],
      ["a written page does not load fh-attribution.js", SCRIPT_MISSING("https://fundhub.ai/funnel/fh-attribution.js")],
      ["a written page does not load fh-events.js", SCRIPT_MISSING("https://fundhub.ai/funnel/fh-events.js")]
    ]
  }]
});

check({
  key: "mkt-settings-funnel-card",
  surface: MC,
  control: "Settings: funnel card: name, landing page, lane select (funding600, premium, sorting, uwiq, wl, slo, unknown), ad button select, weight, Running checkbox, 'books a call' checkbox, mix of 6 script kinds",
  requirement: "Every funnel's script mix must use only the six script kinds with numbers of zero or more, its default ad set must belong to one of its own Meta campaigns, and no Meta campaign may sit on two funnels (read from the funnels' own campaign lists, so a campaign that is not synced yet still counts). The table itself refuses a blank name, a landing page that is not https, a lane that is not one of the seven, a weight below zero and a blank ad button, so those cannot be saved wrong; what the card SENDS for each box (name, landing page, lane, ad button, weight, Running, books a call, the mix) is held by the practice tests in e2e/fin-b15-cc-settings-funnel.spec.mjs.",
  parts: [{
    from: "marketing_funnels f",
    where: ORG("f"),
    bad: [
      ["the mix names a script kind that does not exist",
        `EXISTS (SELECT 1 FROM jsonb_each(f.format_mix) m WHERE m.key NOT IN ('standard', 'sorting', 'long', 'notes', 'greenscreen', 'vsl'))`],
      ["the mix holds something that is not a number of zero or more",
        `EXISTS (SELECT 1 FROM jsonb_each(f.format_mix) m WHERE jsonb_typeof(m.value) NOT IN ('number', 'integer', 'real')
                  OR CASE WHEN jsonb_typeof(m.value) IN ('number', 'integer', 'real') THEN (m.value::text)::numeric ELSE 0 END < 0)`],
      ["the default ad set is not in one of the funnel's own campaigns",
        `f.default_ad_set_external_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM ad_sets s JOIN campaigns c ON c.id = s.campaign_id
            WHERE s.org_id = f.org_id AND s.external_id = f.default_ad_set_external_id AND c.external_id = ANY(f.meta_campaign_ids))`],
      ["a Meta campaign sits on two funnels",
        `EXISTS (SELECT 1 FROM marketing_funnels g
                  WHERE g.org_id = f.org_id AND g.id <> f.id
                    AND EXISTS (SELECT 1 FROM unnest(f.meta_campaign_ids) AS cid WHERE cid = ANY(g.meta_campaign_ids)))`]
    ]
  }]
});

// ── Scripts tab ────────────────────────────────────────────────────────────

check({
  key: "mkt-scripts-edit",
  surface: MC,
  control: "Scripts: card 'Edit' (one box per part) + 'Save new version' / Cancel",
  requirement: "Every version Chris saved by editing from this tab (one that names its repo file) must sit one version after the version it replaced, in the same script, and its OWN file must be queued for the repo: an edit-file save at that path whose front matter says that version. (The old version's file sits at the same path, so a file at the path is not enough. The database itself refuses two live versions of one script, so that is not read here.)",
  parts: [{
    from: "ad_scripts s JOIN ad_scripts p ON p.id = s.parent_script_id AND p.org_id = s.org_id",
    where: `${ORG("s")} AND s.source = 'chris' AND s.version > 1 AND s.repo_path IS NOT NULL`,
    bad: [
      ["an edit is not one version after the one it replaced", "s.version <> p.version + 1"],
      ["an edit moved to a different script", "p.root_script_id IS DISTINCT FROM s.root_script_id"],
      ["an edit's own file was never queued for the repo",
        `NOT EXISTS (SELECT 1 FROM repo_outbox r WHERE r.org_id = s.org_id AND r.path = s.repo_path
                      AND r.op_id LIKE 'u25:edit-file:%'
                      AND strpos(r.content, '
version: ' || CAST(s.version AS text) || '
') > 0)`]
    ]
  }]
});

check({
  key: "mkt-scripts-fix",
  surface: MC,
  control: "Scripts: card 'Fix' (note + 'Make this a rule' + 'Rewrite it'; rewrite job returns a new version)",
  requirement: "Every rewrite must sit one version after the version it replaced, in the same script, and keep the ad number the old version already had (an old version with no number yet is not compared: the number is given when a script is approved, after the rewrite); every fix request must carry its note and name a script of this company. The database itself refuses two live versions of one script, so that is not read here.",
  parts: [
    {
      from: "ad_scripts s JOIN ad_scripts p ON p.id = s.parent_script_id AND p.org_id = s.org_id",
      where: `${ORG("s")} AND s.fix_note IS NOT NULL AND TRIM(s.fix_note) <> ''`,
      bad: [
        ["a rewrite is not one version after the one it replaced", "s.version <> p.version + 1"],
        ["a rewrite moved to a different script", "p.root_script_id IS DISTINCT FROM s.root_script_id"],
        ["a rewrite changed the ad number the old version had", "p.ad_id IS NOT NULL AND s.ad_id IS DISTINCT FROM p.ad_id"]
      ]
    },
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'fix_script'`,
      bad: [
        ["a fix request carries no note", BLANK("j.payload->>'note'")],
        ["a fix request names no script of this company", `NOT EXISTS (SELECT 1 FROM ad_scripts s WHERE s.org_id = j.org_id AND s.id::text = j.payload->>'script_id')`]
      ]
    }
  ]
});

check({
  key: "mkt-scripts-write-now",
  surface: MC,
  control: "Scripts: 'Write now' batch button (hidden while write_now_ready is false)",
  requirement: "Every Write now batch must have its start job queued in the same save, must be set to release at the moment it was made (the handler sets release_at = now(), so a release time later than five minutes after it was made is a batch held back), must not sit in 'planned' for over two hours (its start job died or was never picked up), and a batch that says ready or released must have counted at least one script.",
  parts: [{
    from: "marketing_batches b",
    where: `${ORG("b")} AND b.kind = 'on_command'`,
    bad: [
      ["a Write now batch has no start job", `NOT EXISTS (SELECT 1 FROM marketing_jobs j WHERE j.org_id = b.org_id AND j.kind = 'start_batch' AND j.payload->>'batch_id' = b.id::text)`],
      ["a Write now batch has no release time", "b.release_at IS NULL"],
      ["a Write now batch is held back past the moment it was made", "b.release_at > b.created_at + interval '5 minutes'"],
      ["a Write now batch has sat planned for over two hours", "b.status = 'planned' AND b.created_at < now() - interval '2 hours'"],
      ["a ready or released batch counted no scripts", `b.status IN ('ready', 'released') AND b.total = 0`]
    ]
  }]
});

check({
  key: "mkt-scripts-idea-box",
  surface: MC,
  control: "Scripts: idea box: idea text, format, funnel, 'Save idea', 'Write it now', 'Show all N' / 'Show fewer', 'Open the script'",
  requirement: "Every idea Chris saved must keep his words, have its idea file queued for the repo, name only a funnel of this company, and an idea that says written must point at its script.",
  parts: [{
    from: "ad_ideas i",
    where: `${ORG("i")} AND i.source = 'chris' AND i.kind = 'script'`,
    bad: [
      ["an idea has no words", BLANK("i.raw_points")],
      ["an idea has no file queued for the repo", IDEA_FILE_MISSING],
      ["an idea names a funnel this company does not have", `i.funnel_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marketing_funnels f WHERE f.org_id = i.org_id AND f.key = i.funnel_key)`],
      ["an idea says written but points at no script", `i.status = 'written' AND i.script_id IS NULL`]
    ]
  }]
});

check({
  key: "mkt-scripts-rules",
  surface: MC,
  control: "Scripts: rules: 'Change' + 'Save the rule', 'Add the rule', 'Ban the phrase' (rule saved to the repo through the outbox)",
  requirement: "Every rule change queued for the repo must edit the right file for its kind (rules for add and change, the banned list for a ban) and carry its words; a change must name a rule number; and it must reach the repo: a save still uncommitted an hour after it was queued (the repo refused it, for example 'Part 0 has no rule 7', and the outbox keeps trying) is red.",
  parts: [{
    from: "repo_outbox o",
    where: `${ORG("o")} AND o.path IN ('marketing/ads/RULES.md', 'marketing/ads/banned-live.json')
            AND o.mode = 'edit' AND o.edit->>'op' IN ('part0_add_rule', 'part0_edit_rule', 'ban_phrase')`,
    bad: [
      ["a rule change edits the banned list", `o.edit->>'op' IN ('part0_add_rule', 'part0_edit_rule') AND o.path <> 'marketing/ads/RULES.md'`],
      ["a ban edits the rules file", `o.edit->>'op' = 'ban_phrase' AND o.path <> 'marketing/ads/banned-live.json'`],
      ["a rule change carries no words", `o.edit->>'op' IN ('part0_add_rule', 'part0_edit_rule') AND ${BLANK("o.edit->>'text'")}`],
      ["a ban carries no phrase", `o.edit->>'op' = 'ban_phrase' AND ${BLANK("o.edit->>'phrase'")}`],
      ["a rule change names no rule number", `o.edit->>'op' = 'part0_edit_rule' AND o.edit->>'number' IS NULL`],
      ["a rule change never reached the repo (waiting over an hour)", `o.committed_sha IS NULL AND o.created_at < now() - interval '1 hour'`]
    ]
  }]
});

// ── Launch tab ─────────────────────────────────────────────────────────────

const LOADED_VIDEO_BAD = [
  ["a loaded video was never approved by a person", `v.approved_at IS NULL OR ${BLANK("v.approved_by")}`],
  ["a loaded video is missing a Meta id", `${BLANK("v.meta_video_id")} OR ${BLANK("v.meta_creative_id")} OR ${BLANK("v.meta_ad_external_id")}`],
  ["a loaded video has no ad row of ours", `NOT EXISTS (SELECT 1 FROM ads a WHERE a.org_id = v.org_id AND a.id = v.ad_row_id AND a.external_id = v.meta_ad_external_id)`],
  ["a loaded video still carries a load error", `NOT (${BLANK("v.load_error")})`],
  // The loader creates the ad PAUSED (meta.mjs createAd hardcodes it) and only the Launch tab's Turn on
  // (campaigns/write resume_ad) leaves an action_log row for an ad that is on. A freshly loaded ad that is
  // ACTIVE with no such receipt was not turned on from here: it spends and nobody asked it to.
  ["a freshly loaded ad is on with no turn-on receipt",
    `v.loaded_at >= now() - interval '14 days'
     AND EXISTS (SELECT 1 FROM ads a WHERE a.org_id = v.org_id AND a.id = v.ad_row_id AND UPPER(a.status) = 'ACTIVE')
     AND NOT EXISTS (SELECT 1 FROM action_log l
                      WHERE l.org_id = v.org_id AND l.target_type = 'ad' AND l.target_id = v.ad_row_id
                        AND l.executed_at IS NOT NULL AND l.execute_error IS NULL AND l.after->>'status' = 'ACTIVE')`]
];

const LOAD_JOB_BAD = [
  ["a load job names a video this company does not have", `NOT EXISTS (SELECT 1 FROM ad_videos v WHERE v.org_id = j.org_id AND v.id::text = j.payload->>'ad_video_id')`],
  ["a load job was queued for a video nobody approved", `EXISTS (SELECT 1 FROM ad_videos v WHERE v.org_id = j.org_id AND v.id::text = j.payload->>'ad_video_id' AND v.approved_at IS NULL)`],
  ["a load job was queued for a video that is not an ad", `EXISTS (SELECT 1 FROM ad_videos v WHERE v.org_id = j.org_id AND v.id::text = j.payload->>'ad_video_id' AND v.video_kind <> 'ad')`]
];

check({
  key: "mkt-launch-load-one",
  surface: MC,
  control: "Launch: 'Load to Meta' per approved video, and 'Retry load' (creates the ad PAUSED, $0)",
  requirement: "Every loaded video must have been approved by a person, carry its three Meta ids and our ad row, and show no load error; a video loaded in the last 14 days must not be ON unless Turn on left its receipt (the button promises the ad is created PAUSED and spends nothing); every load job must name an approved ad video of this company.",
  parts: [
    { from: "ad_videos v", where: `${ORG("v")} AND v.loaded_at IS NOT NULL`, bad: LOADED_VIDEO_BAD },
    { from: "marketing_jobs j", where: `${ORG("j")} AND j.kind = 'meta_load'`, bad: LOAD_JOB_BAD }
  ]
});

check({
  key: "mkt-launch-load-all",
  surface: MC,
  control: "Launch: 'Load all approved' (asks first, then {all:true})",
  requirement: "Every load job queued by Load all must name an approved ad video of this company, and a video that says loaded must carry its Meta ad id and our ad row.",
  parts: [
    { from: "marketing_jobs j", where: `${ORG("j")} AND j.kind = 'meta_load'`, bad: LOAD_JOB_BAD },
    {
      from: "ad_videos v",
      where: `${ORG("v")} AND v.loaded_at IS NOT NULL`,
      bad: [["a loaded video is missing its Meta ad id or our ad row", `${BLANK("v.meta_ad_external_id")} OR v.ad_row_id IS NULL`]]
    }
  ]
});

// ── the registry list ──────────────────────────────────────────────────────

/** The contracts the display lane runs, in the registry's own shape. */
export const FIN_B15_DISPLAY_CONTRACTS = Object.freeze(FIN_B15_CHECKS.map((spec) => Object.freeze({
  control: spec.control,
  mode: "query",
  requirement: spec.requirement,
  sql: sqlFor(spec),
  ...(spec.emptyAs ? { emptyAs: spec.emptyAs } : {}),
  anyImpact: true
})));
