// Finish-853 batch 12 (tier 4, lane gap-catalog-display): the Creative Factory desk, the Documents
// and Finance OS pages, the careers form, the Galaxy sky and the Hiring board.
//
// A LIVE CHECK is one read-only SQL text the display lane runs for the company. It returns
// sample_count (how many saved results exist) and bad_count (how many of them are wrong) and goes red
// on the first wrong one. A control nobody has used yet has no results, so it is green with the words
// "no saved results yet" (emptyAs "quiet") and goes red on the first wrong one.
//
// Every check is built from named bad-result conditions. The SQL text is the conditions joined with OR,
// one SELECT per kind of saved row, stacked with UNION ALL. fin-b12-live-contracts.test.mjs runs that
// exact text over stand-in rows, breaks one condition at a time and sees it go red, and drops each
// condition from the text and sees its row is no longer caught.
//
// This file is read at build time by scripts/pulse/compile-catalog.mjs. The live bundle reads the
// compiled copy in src/pulse/catalog/generated.json, so the live bundle imports nothing from here.
//
// It must not import display-saved-result.mjs (that file imports this one).

export const FIN_B12_LANE = "src/pulse/coverage/gap-catalog-display.mjs";

/**
 * The exact control text of each row this file owns a LIVE CHECK for (one registry key each, unique across the maps).
 * (The finance-os.html header row, "Header text 'no client open' / client name", has no live check: the only thing
 * a saved client row can say about it is "no name and no email", and the page's answer to that is its own designed
 * fallback, not a wrong result. The row is a practice test: fin-b12-repair-pages.test.mjs.)
 */
export const FIN_B12_CONTROLS = Object.freeze({
  cfTiles: "Summary tiles: jobs in flight, failed jobs, awaiting review, library assets, active brand kits",
  cfVideo: "Video performance table (YouTube views, watch time per video per day) and connection badge",
  cfConnect: "Video performance: Client ID, Client secret, Refresh token boxes and Connect button",
  cfSync: "Video performance: Sync now button",
  cfScript: "Write a script and label it: words box, name, kind, angle, hook, offer (suggestion lists) and lane picker",
  docsPage: "Page itself loads (optionally ?client_id=); owner/admin with no client is redirected to the primary demo client in demo mode",
  fosPicker: "Client picker select (up to 500 clients)",
  fosPage: "Page itself loads (with or without ?client_id=); owner/admin with no client is redirected to the primary demo client in demo mode",
  fosPromo: "Promo tracking panel (labelled NOT LIVE; nothing stored)",
  careers: "Job application form: role, name, email, phone, LinkedIn, how heard, website (a hidden trap field). Posts to /api/hiring/apply and starts the applicant follow-up cadence.",
  galaxyFeed: "Live feed on load: workers, clients, routes and numbers for the sky",
  galaxyPage: "Page itself loads (full-screen canvas, clock, census, LIVE / WAITING pill)",
  bench: "Bench table: one row per role (closer, setter, sales_coordinator) with bench count, short-by, awaiting screen, hiring manager, flags",
  card: "Board card: click opens the application drawer (name, scores, flags, source, video/resume tags)",
  oneOnOne: "Board column: 1:1 Interview (one_on_one)",
  applied: "Board column: Applied (applied)",
  group: "Board column: Group Interview (group_interview)",
});

// ───────────────────────────── the live checks ─────────────────────────────
//
// Every check: one or more parts. A part is one table to read (from), which rows count (where), and the
// named conditions that make a row WRONG (bad). $1 is the company. Written in the common subset of
// Postgres and SQLite on purpose (no regular expressions) so the test can run the exact text. The few
// Postgres-only spellings are listed in fin-b12-sql-kit.mjs portableSql().

/** @type {Array<{key:string, control:string, surface:string, requirement:string, emptyAs?:string,
 *   parts:Array<{from:string, where:string, bad:Array<[string,string]>}>}>} */
export const FIN_B12_CHECKS = [];

function check(spec) {
  const parts = spec.parts.map((part) => Object.freeze({
    from: part.from, where: part.where, bad: Object.freeze(part.bad.map((pair) => Object.freeze([...pair]))),
  }));
  FIN_B12_CHECKS.push(Object.freeze({ emptyAs: "quiet", ...spec, parts: Object.freeze(parts) }));
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
const REAL = (alias) => `COALESCE(${alias}.is_demo, false) = false`;

// ── creative-factory.html ──────────────────────────────────────────────────

const CF = "creative-factory.html";
const YT = "c.platform = 'youtube'";

// What this check can honestly judge about the summary tiles is the saved JOBS: the tiles count them by
// state, "FAILED JOBS" says "all carry a reason", and "JOBS IN FLIGHT" counts queued and running jobs.
// The assets and brand kits behind the other three tiles cannot be wrong in a way a read can see: the
// database itself refuses an asset in an unknown review state, a blocked asset with no reasons, a kit with
// no name and a kit in an unknown state (045_creative_factory.sql CHECKs). A condition the database
// refuses can never go red, so none is written here. What each tile PAINTS is judged by the practice test
// fin-b12-repair-creative.test.mjs, not by this text.
check({
  key: "cf-tiles",
  surface: CF,
  control: FIN_B12_CONTROLS.cfTiles,
  requirement: "Every job the tiles count must be in a state that agrees with its times and its reason: a failed job says why (the tile says all carry a reason), a finished job has a finish time, a running job has a start time, and a job counted in flight is not finished and has not sat for more than a day.",
  parts: [
    {
      from: "generation_jobs j",
      where: ORG("j"),
      bad: [
        ["a failed job carries no reason", `j.status = 'failed' AND ${BLANK("j.error")}`],
        ["a finished job has no finish time", `j.status IN ('succeeded', 'failed') AND j.finished_at IS NULL`],
        ["a running job has no start time", `j.status = 'running' AND j.started_at IS NULL`],
        ["a job counted in flight has a finish time", `j.status IN ('queued', 'running') AND j.finished_at IS NOT NULL`],
        ["a job has sat in flight for over a day", `j.status IN ('queued', 'running') AND j.updated_at < now() - interval '1 day'`],
      ],
    },
  ],
});

check({
  key: "cf-video-table",
  surface: CF,
  control: FIN_B12_CONTROLS.cfVideo,
  requirement: "Every video-per-day row must have a video, no negative views or minutes, an average-watched figure that is not below zero (YouTube reports above 100 for a looping short, so that is not wrong), and a YouTube connection of this company that owns it; the connection badge must give a reason when it is in error or expired and must carry no error while it says active. What the table and the badge PAINT is judged by fin-b12-repair-creative.test.mjs.",
  parts: [
    {
      from: "video_watch_stats v",
      where: ORG("v"),
      bad: [
        ["a row has no video id", BLANK("v.youtube_video_id")],
        ["a row has negative views", "v.views < 0"],
        ["a row has negative minutes watched", "v.estimated_minutes_watched < 0"],
        ["average watched is below zero", "v.average_view_percentage < 0"],
        ["no YouTube connection of this company owns the row",
          `NOT EXISTS (SELECT 1 FROM analytics_connections c WHERE c.id = v.connection_id AND c.org_id = v.org_id AND ${YT})`],
      ],
    },
    {
      from: "analytics_connections c",
      where: `${ORG("c")} AND ${YT}`,
      bad: [
        ["the badge says error or expired and gives no reason", `c.connection_state IN ('error', 'expired') AND ${BLANK("c.last_error")}`],
        ["the badge says active but an error is still saved", `c.connection_state = 'active' AND NOT (${BLANK("c.last_error")})`],
      ],
    },
  ],
});

check({
  key: "cf-connect",
  surface: CF,
  control: FIN_B12_CONTROLS.cfConnect,
  requirement: "A saved YouTube connection must hold its credentials in the encrypted form (never as plain JSON), and an active one must name its channel.",
  parts: [{
    from: "analytics_connections c",
    where: `${ORG("c")} AND ${YT}`,
    bad: [
      ["a connection past pending holds no credentials", `c.connection_state <> 'pending' AND ${BLANK("c.encrypted_credentials")}`],
      ["credentials are saved as plain text, not encrypted",
        `NOT (${BLANK("c.encrypted_credentials")}) AND c.encrypted_credentials LIKE '{%'`],
      ["credentials are not in the four-part encrypted form",
        `NOT (${BLANK("c.encrypted_credentials")}) AND c.encrypted_credentials NOT LIKE '%:%:%:%'`],
      ["an active connection names no channel", `c.connection_state = 'active' AND ${BLANK("c.external_account_id")}`],
    ],
  }],
});

check({
  key: "cf-sync",
  surface: CF,
  control: FIN_B12_CONTROLS.cfSync,
  requirement: "A sync must leave only real rows: no video row of zero views and zero minutes (the sync writes nothing for a video the report did not list), a capture time on every row, and no rows for a connection that never synced; a connection that synced must have left pending.",
  parts: [
    {
      from: "video_watch_stats v",
      where: ORG("v"),
      bad: [
        ["a row is a made-up zero: no views and no minutes", "v.views = 0 AND v.estimated_minutes_watched = 0"],
        ["a row has no capture time", "v.captured_at IS NULL"],
        ["a row belongs to a connection that never synced",
          "EXISTS (SELECT 1 FROM analytics_connections c WHERE c.id = v.connection_id AND c.org_id = v.org_id AND c.last_synced_at IS NULL)"],
      ],
    },
    {
      from: "analytics_connections c",
      where: `${ORG("c")} AND ${YT} AND c.last_synced_at IS NOT NULL`,
      bad: [["a connection that synced is still pending", "c.connection_state = 'pending'"]],
    },
  ],
});

const LABEL_BAD = (column, kind) => [
  [`the ${kind} label is not in settled form`,
    `s.${column} IS NOT NULL AND (s.${column} <> LOWER(BTRIM(s.${column})) OR strpos(s.${column}, ' ') > 0)`],
  [`the ${kind} label has no dictionary entry`,
    `s.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_labels l WHERE l.org_id = s.org_id AND l.kind = '${kind}' AND l.key = s.${column})`],
];

check({
  key: "cf-script",
  surface: CF,
  control: FIN_B12_CONTROLS.cfScript,
  requirement: "Every script written by a person or an agent must carry labels in settled form with a dictionary entry each, a rewrite must name a parent that exists at the next version under the same root, and a version that was rewritten must no longer be live.",
  parts: [{
    from: "ad_scripts s",
    where: `${ORG("s")} AND s.source IN ('chris', 'agent')`,
    bad: [
      ...LABEL_BAD("angle_key", "angle"),
      ...LABEL_BAD("hook_key", "hook"),
      ...LABEL_BAD("offer_key", "offer"),
      ...LABEL_BAD("script_type", "script_type"),
      ["a rewrite names a parent that is not there",
        "s.parent_script_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_scripts p WHERE p.id = s.parent_script_id AND p.org_id = s.org_id)"],
      ["a rewrite is not one version after its parent, or sits under another root",
        `EXISTS (SELECT 1 FROM ad_scripts p WHERE p.id = s.parent_script_id AND p.org_id = s.org_id
                  AND (s.version <> p.version + 1 OR COALESCE(p.root_script_id, p.id) <> COALESCE(s.root_script_id, s.id)))`],
      ["a version that was rewritten is still live",
        "s.archived_at IS NULL AND EXISTS (SELECT 1 FROM ad_scripts c WHERE c.org_id = s.org_id AND c.parent_script_id = s.id)"],
    ],
  }],
});

// ── documents.html and finance-os.html ─────────────────────────────────────

/** The demo-client redirect: with Demo Mode on, an owner with no client is sent to the primary demo client. */
const DEMO_REDIRECT = {
  from: "orgs o",
  where: "o.id = $1::uuid AND o.demo_mode_enabled = true",
  bad: [["demo mode is on but there is no primary demo client to send the owner to",
    "NOT EXISTS (SELECT 1 FROM clients c WHERE c.org_id = o.id AND c.is_demo = true AND c.email LIKE 'demo.client.01@%')"]],
};

const DOC_KINDS = "('authorization', 'contract', 'invoice_document', 'deliverable', 'client_upload', 'inquiry_doc', 'bureau_response')";

check({
  key: "docs-page-load",
  surface: "documents.html",
  control: FIN_B12_CONTROLS.docsPage,
  requirement: "Every document the page lists must name a client of this company, carry a title or a key, and agree with itself (a sent document has a sent time; a signed one required a signature), and Demo Mode must have a primary demo client to send an owner to. Whether the owner is really sent there is judged by fin-b12-repair-pages.test.mjs.",
  parts: [
    {
      from: "documents d",
      where: `${ORG("d")} AND d.kind IN ${DOC_KINDS} AND COALESCE(d.subtype, '') <> 'template_source' AND COALESCE(d.is_demo, false) = false`,
      bad: [
        ["a document names a client that is not in this company",
          "d.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = d.client_id AND c.org_id = d.org_id)"],
        ["a document has neither a title nor a key", `${BLANK("d.title")} AND ${BLANK("d.document_key")}`],
        ["a document is marked sent or delivered with no sent time",
          "d.delivery_status IN ('sent', 'delivered') AND d.delivered_at IS NULL"],
        ["a document is signed though no signature was required", "d.signed_at IS NOT NULL AND d.signature_required = false"],
      ],
    },
    DEMO_REDIRECT,
  ],
});

// The picker is a list of the clients the page asked for with limit=500 (public/app/finance-os.html). A client
// with no name and no email is printed as "Unnamed client": that is the page's own designed fallback and not a
// wrong result, so it is not judged here. What a saved book CAN make wrong is the count: past 500 the page
// lists the 500 newest, and its own words say "500 clients on file".
check({
  key: "fos-picker",
  surface: "finance-os.html",
  control: FIN_B12_CONTROLS.fosPicker,
  requirement: "The company must not hold more clients than the picker can list (500), or the oldest cannot be picked and the page's \"N clients on file\" is short. (Which names the picker lists, and the 500 it asks for, are judged by fin-b12-repair-pages.test.mjs.)",
  parts: [{
    from: `(SELECT count(*) AS n FROM clients x JOIN orgs ox ON ox.id = x.org_id
               WHERE x.org_id = $1::uuid AND (ox.demo_mode_enabled = true OR COALESCE(x.is_demo, false) = false)) t`,
    where: "1 = 1",
    bad: [["the company holds more clients than the picker lists", "t.n > 500"]],
  }],
});

check({
  key: "fos-page-load",
  surface: "finance-os.html",
  control: FIN_B12_CONTROLS.fosPage,
  requirement: "When Demo Mode is on, the company must have the primary demo client an owner with no client is sent to.",
  parts: [DEMO_REDIRECT],
});

check({
  key: "fos-promo",
  surface: "finance-os.html",
  control: FIN_B12_CONTROLS.fosPromo,
  requirement: "The panel says no promo end date is stored for the client's cards, so no card of this company may hold one. A saved promo end date means the NOT LIVE words are out of date.",
  parts: [{
    from: "account_statement_cycles c",
    where: ORG("c"),
    bad: [["a card has a promo end date saved though the panel says none is stored", "c.promo_ends_on IS NOT NULL"]],
  }],
});

// ── the careers form ───────────────────────────────────────────────────────

check({
  key: "careers-apply",
  surface: "form:careers.html#apply-form",
  control: FIN_B12_CONTROLS.careers,
  requirement: "Every application that came through the careers form more than an hour ago must have its candidate, the new-application task that tells a person, and the follow-up cadence the form promises.",
  parts: [{
    from: "candidate_applications a",
    where: `${ORG("a")} AND a.external_application_id IS NULL AND a.applied_at >= now() - interval '30 day' AND a.applied_at < now() - interval '1 hour'`,
    bad: [
      ["the candidate is not in this company",
        "NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = a.candidate_id AND c.org_id = a.org_id)"],
      ["nobody was told: no new-application task exists",
        "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.org_id = a.org_id AND t.source_workflow = 'hiring-new-application' AND t.body = 'hiring:applied:' || a.id::text)"],
      ["no follow-up cadence was started",
        "NOT EXISTS (SELECT 1 FROM candidate_outreach o WHERE o.org_id = a.org_id AND o.application_id = a.id)"],
    ],
  }],
});

// ── galaxy.html ────────────────────────────────────────────────────────────

const SKY_PEOPLE = `COALESCE(s.status, 'active') = 'active' AND s.role IS NOT NULL AND s.role NOT IN ('client', 'affiliate', 'partner') AND ${REAL("s")}`;

check({
  key: "galaxy-feed",
  surface: "galaxy.html",
  control: FIN_B12_CONTROLS.galaxyFeed,
  requirement: "Every number the sky is built from must hold up: a person has at most one open shift and none older than a day, an event names a person on staff, a live agent has a go-live time, collected cash is not negative, and a client counted as funded today has an amount.",
  parts: [
    {
      from: "staff s",
      where: `${ORG("s")} AND ${SKY_PEOPLE}`,
      bad: [
        ["a person has two open shifts, so the sky lists them twice",
          "(SELECT count(*) FROM shifts sh WHERE sh.org_id = s.org_id AND sh.staff_id = s.id AND sh.ended_at IS NULL) > 1"],
        ["a person shown in the sky has no name", BLANK("s.name")],
      ],
    },
    {
      from: "shifts sh",
      where: `${ORG("sh")} AND sh.ended_at IS NULL AND ${REAL("sh")}`,
      bad: [
        ["a shift has been open for over a day, so the sky shows someone working all night", "sh.started_at < now() - interval '24 hour'"],
        ["an open shift names a person who is not on staff",
          "NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = sh.staff_id AND s.org_id = sh.org_id)"],
      ],
    },
    {
      from: "staff_events e",
      where: `${ORG("e")} AND e.created_at >= now() - interval '1 day' AND ${REAL("e")}`,
      bad: [
        ["an event names nobody on staff", "NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = e.staff_id AND s.org_id = e.org_id)"],
        ["an event has no kind", BLANK("e.kind")],
      ],
    },
    {
      from: "agents a",
      where: `${ORG("a")} AND a.status IN ('live', 'shadow') AND a.retired_at IS NULL`,
      bad: [
        ["a live agent has no go-live time", "a.status = 'live' AND a.went_live_at IS NULL"],
        ["an agent has no name", BLANK("a.name")],
      ],
    },
    {
      from: "call_outcomes co",
      where: `${ORG("co")} AND ${REAL("co")} AND co.logged_at >= now() - interval '1 day'`,
      bad: [
        ["cash collected is below zero", "co.cash_collected_cents < 0"],
        ["a call outcome names a client of another company",
          "co.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = co.client_id AND c.org_id = co.org_id)"],
      ],
    },
    {
      from: "clients cl",
      where: `${ORG("cl")} AND ${REAL("cl")} AND cl.funded = true AND cl.updated_at >= now() - interval '1 day'`,
      bad: [["a client counted as funded today has no funded amount", "cl.funded_amount IS NULL OR cl.funded_amount <= 0"]],
    },
  ],
});

check({
  key: "galaxy-page-load",
  surface: "galaxy.html",
  control: FIN_B12_CONTROLS.galaxyPage,
  requirement: "The census and the LIVE pill need someone to show: the company must have an active person or a live agent, and every person the census counts must have a name.",
  parts: [
    {
      from: "orgs o",
      where: "o.id = $1::uuid",
      bad: [["the sky has nobody to show: no active person and no live agent",
        `NOT EXISTS (SELECT 1 FROM staff s WHERE s.org_id = o.id AND COALESCE(s.status, 'active') = 'active' AND s.role IS NOT NULL
                       AND s.role NOT IN ('client', 'affiliate', 'partner') AND (o.demo_mode_enabled = true OR ${REAL("s")}))
         AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.org_id = o.id AND a.status IN ('live', 'shadow') AND a.retired_at IS NULL)`]],
    },
    {
      from: "staff s",
      where: `${ORG("s")} AND ${SKY_PEOPLE}`,
      bad: [["a person the census counts has no name", BLANK("s.name")]],
    },
  ],
});

// ── hiring.html ────────────────────────────────────────────────────────────

// Demo Mode's seeded candidates (candidates.is_demo, migration 153) are placed straight into stages with no
// decision behind them (src/demo/seed-ui-coverage.mjs). The board labels them as demo and counts them in
// no number, so a check of how people ARRIVED in a column must not read them as wrong.
const NOT_DEMO = `NOT EXISTS (SELECT 1 FROM candidates dc WHERE dc.id = a.candidate_id AND dc.is_demo = true)`;
const OPEN_IN_STAGE = (stageKey) => ({
  from: "candidate_applications a JOIN pipeline_stages s ON s.id = a.stage_id",
  where: `${ORG("a")} AND a.status = 'open' AND s.key = '${stageKey}' AND ${NOT_DEMO}`,
});
const CARD_PERSON_BAD = [
  ["the card's candidate is not in this company",
    "NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = a.candidate_id AND c.org_id = a.org_id)"],
  ["the card's role is not in this company",
    "NOT EXISTS (SELECT 1 FROM hiring_roles r WHERE r.id = a.role_id AND r.org_id = a.org_id)"],
];
const MOVED_INTO = (stageKey) =>
  `NOT EXISTS (SELECT 1 FROM hiring_decisions d WHERE d.org_id = a.org_id AND d.application_id = a.id AND d.to_stage_key = '${stageKey}')`;

check({
  key: "hiring-bench",
  surface: "hiring.html",
  control: FIN_B12_CONTROLS.bench,
  requirement: "The bench view must still count only the open applications at one-on-one and offer and work short-by out as the target minus that count (never below zero) (this part is a lock on the view's own definition: it goes red if the view is changed), the role's hiring manager must be a person on this company's staff, and an active role must not have a negative target. What the table PAINTS is judged by fin-b12-repair-hiring.test.mjs.",
  parts: [
    {
      from: "v_hiring_bench b",
      where: "b.org_id = $1::uuid",
      bad: [
        ["the bench count is not the open applications at one-on-one and offer",
          `b.bench_count <> (SELECT count(*) FROM candidate_applications a JOIN pipeline_stages s ON s.id = a.stage_id
                              WHERE a.role_id = b.role_id AND a.status = 'open' AND s.key IN ('one_on_one', 'offer'))`],
        ["short-by is not the target minus the bench",
          "b.bench_shortfall <> CASE WHEN b.bench_target - b.bench_count > 0 THEN b.bench_target - b.bench_count ELSE 0 END"],
        ["the hiring manager is not on staff",
          "b.hiring_manager_staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff st WHERE st.id = b.hiring_manager_staff_id AND st.org_id = b.org_id)"],
      ],
    },
    {
      from: "hiring_roles r",
      where: `${ORG("r")} AND r.active = true`,
      bad: [
        ["an active role has a negative bench target", "r.bench_target < 0"],
        ["an active role has no name", BLANK("r.name")],
      ],
    },
  ],
});

check({
  key: "hiring-card",
  surface: "hiring.html",
  control: FIN_B12_CONTROLS.card,
  requirement: "Every open application a card opens must have its candidate and role in this company, a video tag that is a web address, and a resume tag that points at a document of this company; every score on file must keep its flags as a list and belong to an application of this company. (The database already refuses a score outside 1 to 4 and a person's score with no person named, so those are not written here.) What the card and the drawer PAINT is judged by fin-b12-repair-hiring.test.mjs.",
  parts: [
    {
      from: "candidate_applications a",
      where: `${ORG("a")} AND a.status = 'open'`,
      bad: [
        ...CARD_PERSON_BAD,
        ["the video tag is not a web address",
          "a.video_url IS NOT NULL AND NOT (a.video_url LIKE 'http://%' OR a.video_url LIKE 'https://%')"],
        ["the resume tag points at a document that is not in this company",
          "a.resume_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = a.resume_document_id AND d.org_id = a.org_id)"],
      ],
    },
    {
      from: "application_scores sc",
      where: ORG("sc"),
      bad: [
        ["a score's flags are not a list", "jsonb_typeof(sc.flags) <> 'array'"],
        ["a score belongs to an application of another company",
          "NOT EXISTS (SELECT 1 FROM candidate_applications a WHERE a.id = sc.application_id AND a.org_id = sc.org_id)"],
      ],
    },
  ],
});

// The Applied column is where everyone STARTS: apply() (src/hiring/pipeline.mjs) always files a new
// application into Applied and writes no decision, and only advance() and reject() move one, each writing a
// decision row with the stage it moved to. So an open application with no decision at all must sit in
// Applied (the arrival rule: new applicants landing anywhere else would leave this column empty and every
// other check quiet), and one sitting in Applied must not have been moved on by its latest decision (the
// latest, not any: a person moved back to Applied through the API is a legal state).
check({
  key: "hiring-col-applied",
  surface: "hiring.html",
  control: FIN_B12_CONTROLS.applied,
  requirement: "Every open application that is in Applied, or has never been moved by any decision (so must be in Applied), must have its candidate and role in this company; one with no decision must sit in Applied; one in Applied must not have been moved on by its latest decision; and none may have entered the stage before it was filed. Seeded Demo Mode people are left out. What the column PAINTS is judged by fin-b12-repair-hiring.test.mjs.",
  parts: [{
    from: "candidate_applications a JOIN pipeline_stages s ON s.id = a.stage_id",
    where: `${ORG("a")} AND a.status = 'open' AND ${NOT_DEMO}
            AND (s.key = 'applied'
                 OR NOT EXISTS (SELECT 1 FROM hiring_decisions d0 WHERE d0.org_id = a.org_id AND d0.application_id = a.id))`,
    bad: [
      ...CARD_PERSON_BAD,
      // (the part's WHERE only lets an application outside Applied in when it has no decision at all)
      ["it has never been moved by any decision but sits outside Applied", `s.key <> 'applied'`],
      ["its latest decision moved it on but it still sits in Applied",
        `s.key = 'applied' AND (SELECT d2.to_stage_key FROM hiring_decisions d2 WHERE d2.org_id = a.org_id AND d2.application_id = a.id
                                 ORDER BY d2.created_at DESC LIMIT 1) <> 'applied'`],
      ["it entered the stage before it was filed", "a.entered_stage_at < a.applied_at"],
    ],
  }],
});

check({
  key: "hiring-col-group",
  surface: "hiring.html",
  control: FIN_B12_CONTROLS.group,
  requirement: "Every open application in Group Interview must have a decision that moved it there, must not carry a yes or maybe from a group interview (those move on), and must have its candidate and role in this company.",
  parts: [{
    ...OPEN_IN_STAGE("group_interview"),
    bad: [
      ...CARD_PERSON_BAD,
      ["no decision moved it into Group Interview", MOVED_INTO("group_interview")],
      ["a group interview said yes or maybe but it never moved on",
        "EXISTS (SELECT 1 FROM hiring_interview_attendees t WHERE t.org_id = a.org_id AND t.application_id = a.id AND t.outcome IN ('yes', 'maybe'))"],
    ],
  }],
});

check({
  key: "hiring-col-one-on-one",
  surface: "hiring.html",
  control: FIN_B12_CONTROLS.oneOnOne,
  requirement: "Every open application in 1:1 Interview must have a decision that moved it there and must have its candidate and role in this company.",
  parts: [{
    ...OPEN_IN_STAGE("one_on_one"),
    bad: [
      ...CARD_PERSON_BAD,
      ["no decision moved it into 1:1 Interview", MOVED_INTO("one_on_one")],
    ],
  }],
});

// ── the registry list ──────────────────────────────────────────────────────

/** The contracts the display lane runs, in the registry's own shape. anyImpact: these rows are staff-only or no-impact. */
export const FIN_B12_DISPLAY_CONTRACTS = Object.freeze(FIN_B12_CHECKS.map((spec) => Object.freeze({
  control: spec.control,
  mode: "query",
  requirement: spec.requirement,
  sql: sqlFor(spec),
  ...(spec.emptyAs ? { emptyAs: spec.emptyAs } : {}),
  anyImpact: true,
})));
