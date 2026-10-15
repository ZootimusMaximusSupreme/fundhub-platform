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
//                 exact request and the words painted. It reads no live data. Those rows are
//                 listed in fin-b15-display-specs.mjs and fin-b15-display-practice.mjs.
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

const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;
const ORG = (alias) => `${alias}.org_id = $1::uuid`;

// ── lenders.html (the Lender book) ─────────────────────────────────────────

const LENDER_ROW_BAD = [
  ["a lender has no name", BLANK("l.name")],
  ["a lender dollar amount is below zero",
    `l.typical_approval_range < 0 OR l.average_starting_loc < 0 OR l.max_known_loc < 0 OR l.minimum_deposit < 0`],
  ["a starting line is bigger than the biggest line ever seen",
    `l.average_starting_loc IS NOT NULL AND l.max_known_loc IS NOT NULL AND l.average_starting_loc > l.max_known_loc`],
  ["the same bank is listed twice in one table",
    `EXISTS (SELECT 1 FROM lenders d WHERE d.org_id = l.org_id AND d.id <> l.id AND d.lender_table = l.lender_table
              AND LOWER(d.name) = LOWER(l.name) AND COALESCE(d.product_name, '') = COALESCE(l.product_name, ''))`]
];

const MISMATCH_ROW_BAD = [
  ["a mismatch names no bureau that was seen", BLANK("o.observed_bureau")],
  ["a mismatch names no lender", `o.lender_row_id IS NULL AND ${BLANK("o.lender_name")}`],
  ["a mismatch points at a lender of another company",
    `o.lender_row_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lenders x WHERE x.id = o.lender_row_id AND x.org_id = o.org_id)`]
];

check({
  key: "lenders-dismiss",
  surface: "lenders.html",
  control: "Mismatch queue row: Dismiss button",
  requirement: "Every dismissed bureau observation must be one the queue could show (flagged as a mismatch), must still say which bureau was seen, and must still name its lender.",
  parts: [{
    from: "lender_bureau_observations o",
    where: `${ORG("o")} AND o.review_status = 'dismissed'`,
    bad: [
      ["dismissed but never flagged as a mismatch", "o.mismatch_flag = false"],
      ["dismissed with no bureau that was seen", BLANK("o.observed_bureau")],
      ["dismissed with no lender named", `o.lender_row_id IS NULL AND ${BLANK("o.lender_name")}`]
    ]
  }]
});

check({
  key: "lenders-page-load",
  surface: "lenders.html",
  control: "Page load: list read + mismatch-queue read; empty-book banner",
  emptyAs: undefined,
  requirement: "The company must have lenders on its book (the empty-book banner means the import is missing), every lender must have a name, and every open mismatch must say which bureau was seen and name a lender of this company.",
  parts: [
    {
      from: "lenders l",
      where: ORG("l"),
      bad: [["a lender has no name", BLANK("l.name")]]
    },
    {
      from: "lender_bureau_observations o",
      where: `${ORG("o")} AND o.review_status = 'pending' AND o.mismatch_flag = true`,
      bad: MISMATCH_ROW_BAD
    },
    {
      from: "(SELECT 1 AS one) e",
      where: `NOT EXISTS (SELECT 1 FROM lenders x WHERE x.org_id = $1::uuid)`,
      bad: [["the lender book is empty", "e.one = 1"]]
    }
  ]
});

check({
  key: "lenders-list-tab",
  surface: "lenders.html",
  control: "Tab: Lender list",
  requirement: "Every lender the list shows must have a name, no dollar amount below zero, a starting line no bigger than the biggest known line, and must not appear twice in one table.",
  parts: [{ from: "lenders l", where: ORG("l"), bad: LENDER_ROW_BAD }]
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

check({
  key: "mkt-month-meter",
  surface: MC,
  control: "Ideas: month spend meter (used of cap)",
  requirement: "Every model call saved this month must carry its price when the price is on file: claude-opus-5-5 with tokens must cost more than zero, claude-code must cost nothing, and neither may be saved with an unknown cost (the meter would count it at the worst-case rate).",
  parts: [{
    from: "marketing_model_usage u",
    where: `${ORG("u")} AND u.created_at >= now() - interval '35 days'`,
    bad: [
      ["a priced model was saved with an unknown cost", `u.model IN ('claude-opus-5-5', 'claude-code') AND u.cost_usd IS NULL`],
      ["the free model was saved with a cost", `u.model = 'claude-code' AND u.cost_usd > 0`],
      ["a priced model with tokens was saved at zero", `u.model = 'claude-opus-5-5' AND (u.input_tokens + u.output_tokens) > 0 AND u.cost_usd = 0`]
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
  requirement: "Every research run must keep the typed question, a depth the form offers, a stop amount above zero, and the sources object; a finished run must name the repo file its report was saved to.",
  parts: [{
    from: "marketing_jobs j",
    where: `${ORG("j")} AND j.kind = 'deep_research'`,
    bad: [
      ["a research run has no question", BLANK("j.payload->>'question'")],
      ["a research run has a depth the form does not offer", `COALESCE(j.payload->>'depth', '') NOT IN ('quick', 'deep')`],
      ["a research run has no stop amount above zero", `COALESCE(CAST(j.payload->>'max_cost_usd' AS numeric), 0) <= 0`],
      ["a finished run names no repo file for its report", `j.status = 'done' AND ${BLANK("j.result->'report'->>'repo_path'")}`]
    ]
  }]
});

check({
  key: "mkt-research-card",
  surface: MC,
  control: "Ideas: research card buttons: Read it / Hide it, Approve, Tweak (+ 'Run the tweak'), Redo, 'Save to the brain', Retry",
  requirement: "Every finished report must have its report file queued for the repo, every approved report must have a named approver and its approved file queued, and every tweak run must point at a real earlier run of this company and say what to look at.",
  parts: [{
    from: "marketing_jobs j",
    where: `${ORG("j")} AND j.kind = 'deep_research'`,
    bad: [
      ["a finished report has no file queued", `j.status = 'done' AND NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id = 'research-' || j.id::text || '-report')`],
      ["an approved report has no approved file queued", `j.approved_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id = 'research-' || j.id::text || '-approved')`],
      ["an approval has no person behind it", `j.approved_at IS NOT NULL AND j.approved_by IS NULL`],
      ["a tweak run points at no earlier run", `j.payload->>'parent_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marketing_jobs p WHERE p.org_id = j.org_id AND p.kind = 'deep_research' AND p.id::text = j.payload->>'parent_id')`],
      ["a tweak run has no note to look at", `j.payload->>'parent_id' IS NOT NULL AND ${BLANK("j.payload->>'focus'")}`]
    ]
  }]
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

const STEP_WORDS = "every saved step file must start with its stamp for this step, and every approve must set status to approved and nothing else";

check({
  key: "mkt-flywheel-1-avatar",
  surface: MC,
  control: "Ideas flywheel step 1 (avatar): run button 'Build the avatar', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the avatar step ${STEP_WORDS}, and every finished avatar run must have its files queued for the repo.`,
  parts: [
    stepFilePart(1, "01-avatar.md"),
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
  requirement: `For the market step ${STEP_WORDS}, and every finished market run must have its board queued for the repo.`,
  parts: [
    stepFilePart(2, "02-ad-research.md"),
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'flywheel_stage' AND CAST(j.payload->>'stage' AS text) = '2' AND j.status = 'done'`,
      bad: [["a finished market run has no file queued", `NOT EXISTS (SELECT 1 FROM repo_outbox o WHERE o.org_id = j.org_id AND o.op_id = 'flywheel-' || j.id::text || '-02')`]]
    }
  ]
});

check({
  key: "mkt-flywheel-3-offer",
  surface: MC,
  control: "Ideas flywheel step 3 (offer): run button 'Write the offer', Read it, Approve, Tweak, Resume / Start over / Retry",
  requirement: `For the offer step ${STEP_WORDS}, and every finished offer run must hold an offer, its document, and the model that wrote it.`,
  parts: [
    stepFilePart(3, "03-offer.md"),
    {
      from: "marketing_jobs j",
      where: `${ORG("j")} AND j.kind = 'offer' AND j.status = 'done'`,
      bad: [
        ["a finished offer run holds no offer", `jsonb_typeof(j.result->'offer') IS DISTINCT FROM 'object'`],
        ["a finished offer run holds no document", BLANK("j.result->>'document'")],
        ["a finished offer run names no model", BLANK("j.result->>'model'")]
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

check({
  key: "mkt-funnel-rename",
  surface: MC,
  control: "Ideas funnels: 'Change the address' input + 'Save the address'",
  requirement: "Every built funnel must have exactly its three pages, each at the address its own address makes: the landing page at the funnel's address, the booking page with -book, the thank-you page with -thank-you.",
  parts: [{
    from: "marketing_funnels f",
    where: `${ORG("f")} AND f.kind IS NOT NULL`,
    bad: [
      ["a built funnel does not have exactly three pages", `(SELECT count(*) FROM marketing_funnel_pages p WHERE p.org_id = f.org_id AND p.funnel_id = f.id) <> 3`],
      ["a page sits at an address its funnel does not make",
        `EXISTS (SELECT 1 FROM marketing_funnel_pages p WHERE p.org_id = f.org_id AND p.funnel_id = f.id
                  AND p.path <> CASE p.role WHEN 'landing' THEN f.path WHEN 'booking' THEN f.path || '-book' ELSE f.path || '-thank-you' END)`]
    ]
  }]
});

check({
  key: "mkt-funnel-build",
  surface: MC,
  control: "Ideas funnels: 'Write the pages' / 'Write the pages again' (one model call, copy check)",
  requirement: "Every written page must come from a finished funnel job whose copy check passed, and must carry its funnel's tag, tracking config and Meta pixel in its head.",
  parts: [{
    from: "marketing_funnel_pages p JOIN marketing_funnels f ON f.id = p.funnel_id AND f.org_id = p.org_id",
    where: `${ORG("p")} AND p.html IS NOT NULL`,
    bad: [
      ["a written page has no finished job with a passed copy check",
        `NOT EXISTS (SELECT 1 FROM marketing_jobs j WHERE j.id = p.build_job_id AND j.org_id = p.org_id AND j.kind = 'funnel'
                      AND j.status = 'done' AND j.result->>'checks' = 'passed')`],
      ["a written page does not carry its funnel tag", `f.tag IS NULL OR strpos(p.html, f.tag) = 0`],
      ["a written page has no tracking config", `strpos(p.html, 'window.FH_FUNNEL=') = 0`],
      ["a written page has no Meta pixel", `strpos(p.html, 'fbq(''init''') = 0`]
    ]
  }]
});

check({
  key: "mkt-settings-funnel-card",
  surface: MC,
  control: "Settings: funnel card: name, landing page, lane select (funding600, premium, sorting, uwiq, wl, slo, unknown), ad button select, weight, Running checkbox, 'books a call' checkbox, mix of 6 script kinds",
  requirement: "Every funnel's script mix must use only the six script kinds with numbers of zero or more, its default ad set must belong to one of its own Meta campaigns, and no Meta campaign may sit on two funnels.",
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
        `EXISTS (SELECT 1 FROM marketing_funnels g JOIN campaigns c ON c.org_id = g.org_id
                  WHERE g.org_id = f.org_id AND g.id <> f.id AND c.external_id = ANY(f.meta_campaign_ids) AND c.external_id = ANY(g.meta_campaign_ids))`]
    ]
  }]
});

// ── Scripts tab ────────────────────────────────────────────────────────────

check({
  key: "mkt-scripts-edit",
  surface: MC,
  control: "Scripts: card 'Edit' (one box per part) + 'Save new version' / Cancel",
  requirement: "Every version Chris saved by editing must sit one version after the version it replaced, in the same script, with the old version retired, only one live version left, and its repo file queued.",
  parts: [{
    from: "ad_scripts s JOIN ad_scripts p ON p.id = s.parent_script_id AND p.org_id = s.org_id",
    where: `${ORG("s")} AND s.source = 'chris' AND s.version > 1`,
    bad: [
      ["an edit is not one version after the one it replaced", "s.version <> p.version + 1"],
      ["an edit moved to a different script", "p.root_script_id IS DISTINCT FROM s.root_script_id"],
      ["the replaced version is still live", "p.archived_at IS NULL"],
      ["a script has two live versions", `s.archived_at IS NULL AND EXISTS (SELECT 1 FROM ad_scripts o WHERE o.org_id = s.org_id AND o.root_script_id = s.root_script_id AND o.id <> s.id AND o.archived_at IS NULL)`],
      ["an edit has no repo file queued", `NOT EXISTS (SELECT 1 FROM repo_outbox r WHERE r.org_id = s.org_id AND r.path = s.repo_path)`]
    ]
  }]
});

check({
  key: "mkt-scripts-fix",
  surface: MC,
  control: "Scripts: card 'Fix' (note + 'Make this a rule' + 'Rewrite it'; rewrite job returns a new version)",
  requirement: "Every rewrite must sit one version after the version it replaced, in the same script and with the same ad number, with the old version retired; every fix request must carry its note and name a script of this company.",
  parts: [
    {
      from: "ad_scripts s JOIN ad_scripts p ON p.id = s.parent_script_id AND p.org_id = s.org_id",
      where: `${ORG("s")} AND s.fix_note IS NOT NULL AND TRIM(s.fix_note) <> ''`,
      bad: [
        ["a rewrite is not one version after the one it replaced", "s.version <> p.version + 1"],
        ["a rewrite moved to a different script", "p.root_script_id IS DISTINCT FROM s.root_script_id"],
        ["a rewrite changed the ad number", "s.ad_id IS DISTINCT FROM p.ad_id"],
        ["the replaced version is still live", "p.archived_at IS NULL"]
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
  requirement: "Every Write now batch must have its start job queued in the same save, must release as soon as it is done, and a batch that says ready or released must have counted at least one script.",
  parts: [{
    from: "marketing_batches b",
    where: `${ORG("b")} AND b.kind = 'on_command'`,
    bad: [
      ["a Write now batch has no start job", `NOT EXISTS (SELECT 1 FROM marketing_jobs j WHERE j.org_id = b.org_id AND j.kind = 'start_batch' AND j.payload->>'batch_id' = b.id::text)`],
      ["a Write now batch has no release time", "b.release_at IS NULL"],
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
  requirement: "Every rule change queued for the repo must edit the right file for its kind (rules for add and change, the banned list for a ban) and carry its words; a change must name a rule number.",
  parts: [{
    from: "repo_outbox o",
    where: `${ORG("o")} AND o.path IN ('marketing/ads/RULES.md', 'marketing/ads/banned-live.json')
            AND o.mode = 'edit' AND o.edit->>'op' IN ('part0_add_rule', 'part0_edit_rule', 'ban_phrase')`,
    bad: [
      ["a rule change edits the banned list", `o.edit->>'op' IN ('part0_add_rule', 'part0_edit_rule') AND o.path <> 'marketing/ads/RULES.md'`],
      ["a ban edits the rules file", `o.edit->>'op' = 'ban_phrase' AND o.path <> 'marketing/ads/banned-live.json'`],
      ["a rule change carries no words", `o.edit->>'op' IN ('part0_add_rule', 'part0_edit_rule') AND ${BLANK("o.edit->>'text'")}`],
      ["a ban carries no phrase", `o.edit->>'op' = 'ban_phrase' AND ${BLANK("o.edit->>'phrase'")}`],
      ["a rule change names no rule number", `o.edit->>'op' = 'part0_edit_rule' AND o.edit->>'number' IS NULL`]
    ]
  }]
});

// ── Launch tab ─────────────────────────────────────────────────────────────

const LOADED_VIDEO_BAD = [
  ["a loaded video was never approved by a person", `v.approved_at IS NULL OR ${BLANK("v.approved_by")}`],
  ["a loaded video is missing a Meta id", `${BLANK("v.meta_video_id")} OR ${BLANK("v.meta_creative_id")} OR ${BLANK("v.meta_ad_external_id")}`],
  ["a loaded video has no ad row of ours", `NOT EXISTS (SELECT 1 FROM ads a WHERE a.org_id = v.org_id AND a.id = v.ad_row_id AND a.external_id = v.meta_ad_external_id)`],
  ["a loaded video still carries a load error", `NOT (${BLANK("v.load_error")})`]
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
  requirement: "Every loaded video must have been approved by a person, carry its three Meta ids and our ad row, and show no load error; every load job must name an approved ad video of this company.",
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
