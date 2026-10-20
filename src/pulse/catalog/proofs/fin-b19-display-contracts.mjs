// Live saved-result checks for batch 19 (finish the 853, tier 4, lane gap-catalog-display). Each one is a
// read-only query that takes the company ($1) and answers sample_count (how many saved results exist) and
// bad_count (how many of them are wrong). A control nobody has used yet has no results, so each contract
// says emptyAs "quiet": green with "no saved results yet" until the first wrong result, then red.
//
// The SQL is written in the part of the language that Postgres and SQLite read the same way (LIKE, ||,
// CASE, FILTER, joins, IS NOT NULL, UNION ALL, ::casts that the test strips, and regexp_replace as a
// function, which the test supplies), so fin-b19-display-contracts.test.mjs can run the very same text on
// stand-in tables and see it go red.
//
// Three more contracts at the end are not queries: one carries the claim that a sidebar head is shown to no
// role (HEAD_CONTRACTS), and two carry the retired Home and Watch rows (PAGE_GAP_CONTRACTS).

import { FIN_B19_HIDDEN_HEADS, FIN_B19_NOT_ATTACHABLE } from "./fin-b19-not-attachable.mjs";

const query = (control, requirement, key, body) => Object.freeze({
  control,
  mode: "query",
  emptyAs: "quiet",
  requirement,
  sql: `/* display-result:${key} */\n${body.trim()}`,
});

// A rail tab opens one pipeline (api/dashboard/pipeline.mjs). Two things make the tab wrong, and each is
// a state the live database can really hold (the card's own columns are NOT NULL and the stage and person
// are foreign keys, so those arms are not written here):
//
//   1. The company has no such pipeline, or the pipeline has no columns. The tab then answers
//      "unknown_pipeline" and paints nothing. The company's own row is one saved result, so a missing
//      rail is red even when no card exists yet.
//   2. A card on the rail is left off the screen: its column belongs to another pipeline, its pipeline
//      belongs to another company, or the client or partner it names belongs to another company. The
//      board drops such a card without a word, so the person is on the rail in the database and missing
//      from the tab.
//
// A demo card, a demo client and an archived client are left out of the board on purpose, so they are not
// counted here. `applications` adds the Hiring tab's extra claim (see HIRING_REQUIREMENT).
const railSql = (key, { applications = false } = {}) => `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE x.bad = 1)::int AS bad_count
  FROM (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM pipelines p0
               JOIN pipeline_stages s0 ON s0.pipeline_id = p0.id
              WHERE p0.org_id = o.id AND p0.key = '${key}') THEN 0 ELSE 1 END AS bad
      FROM orgs o
     WHERE o.id = $1::uuid
    UNION ALL
    SELECT CASE WHEN st.pipeline_id <> cd.pipeline_id OR p.org_id <> cd.org_id
             OR (cd.client_id IS NOT NULL AND c.id IS NULL)
             OR (cd.partner_id IS NOT NULL AND pr.id IS NULL) THEN 1 ELSE 0 END AS bad
      FROM cards cd
      JOIN pipelines p ON p.id = cd.pipeline_id
      LEFT JOIN pipeline_stages st ON st.id = cd.stage_id
      LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
      LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = cd.org_id
     WHERE cd.org_id = $1::uuid AND p.key = '${key}' AND COALESCE(cd.is_demo, false) = false
       AND (c.id IS NULL OR (COALESCE(c.is_demo, false) = false AND c.custom_fields->>'crm_archived_at' IS NULL))${applications ? `
    UNION ALL
    SELECT 1 AS bad
      FROM candidate_applications a
      JOIN pipeline_stages s ON s.id = a.stage_id
      JOIN pipelines p2 ON p2.id = s.pipeline_id AND p2.key = '${key}'
     WHERE a.org_id = $1::uuid` : ""}
  ) x`;

const RAILS = [
  ["Rail tab R-01 Sales", "sales", "Sales"],
  ["Rail tab R-02 Funding: Card Stacking", "funding_card_stacking", "Funding: Card Stacking"],
  ["Rail tab R-04 Optimization (Repair) Rounds", "optimization", "Optimization (Repair) Rounds"],
  ["Rail tab R-05 Inquiry Removal", "inquiry_removal", "Inquiry Removal"],
  ["Rail tab R-06 AR / Collections", "ar_collections", "AR / Collections"],
  ["Rail tab R-08 Affiliates + White Label", "affiliates_white_label", "Affiliates + White Label"],
  ["Rail tab R-09 Hiring", "hiring", "Hiring"],
];

const RAIL_REQUIREMENT = (label) => `The ${label} tab must have its pipeline and columns in this company, and every card saved on the ${label} rail must sit in a column of that same rail, in this company, and name a client or partner of this company, or the tab's board silently leaves it out.`;

// The Hiring tab reads cards, like every rail. A job applicant is not a card: candidate_applications carries
// its own stage into the same pipeline, and a card has to name a client or a partner (cards_client_or_partner_chk,
// migration 265), so no applicant can ever be a card and the tab can never show one. hiring.html is the screen
// that does. Every application sitting on a Hiring column is therefore one the tab does not show.
const HIRING_REQUIREMENT = `${RAIL_REQUIREMENT("Hiring")} Every job application saved on a Hiring column must also be on this tab's board, and the tab reads cards, which no applicant can be, so each application is counted as one the tab does not show.`;

const RAIL_CONTRACTS = RAILS.map(([control, key, label]) => query(
  control,
  key === "hiring" ? HIRING_REQUIREMENT : RAIL_REQUIREMENT(label),
  `fin-b19-rail-${key.replace(/_/g, "-")}`,
  railSql(key, { applications: key === "hiring" }),
));

// The note a flag is filed with starts with the belief it is about (the label of the belief, or its key), and
// carries the count that is saved on the row. The row also names the source it was cut by: the lead source
// and the setter, as the floor builds them (COALESCE of the campaign, the source, the channel, then
// "unknown"; the setter user id, then "unknown"). A flag always has a source, because the button is only
// drawn for a belief that has calls, and a call is always cut by some source. So a flag must:
//   name a staff member of the same company,
//   say the same belief in its note as the row saved,
//   say the same count in its note as the row saved,
//   name a source and setter that some call of this company really has. A flag with no source, or no setter,
//   matches no call (NULL equals nothing), so it is red by the same test, and so is a made-up pair.
const FLAG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.id IS NULL
         OR f.note NOT LIKE ('% this period ' || f.outcome_count || ' vs last %')
         OR lower(f.note) NOT LIKE ('flagged from sales floor \u2014 ' || f.belief || '%')
         OR NOT EXISTS (
              SELECT 1
                FROM call_outcomes o
                JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
                LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
               WHERE o.org_id = f.org_id AND o.logged_at < f.period_end
                 AND COALESCE(cf.utm_campaign, cf.utm_source, c.channel_source, 'unknown') = f.lead_source
                 AND COALESCE(cf.cf_setter_user_id, 'unknown') = f.setter_label))::int AS bad_count
  FROM marketing_flags f
  LEFT JOIN staff s ON s.id = f.flagged_by AND s.org_id = f.org_id
 WHERE f.org_id = $1::uuid AND COALESCE(f.is_demo, false) = false
   AND f.note LIKE 'Flagged from sales floor%'`;

const DRIVE_SYNC_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE d.last_error IS NOT NULL OR d.last_sync_at IS NULL OR d.page_token IS NULL)::int AS bad_count
  FROM brain_drive_sync d
 WHERE d.org_id = $1::uuid`;

const PHOTO_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.avatar_key NOT LIKE ('%staff-avatars/' || s.org_id::text || '/' || s.id::text || '/%')
         OR (lower(s.avatar_key) NOT LIKE '%.png' AND lower(s.avatar_key) NOT LIKE '%.jpg'))::int AS bad_count
  FROM staff s
 WHERE s.org_id = $1::uuid AND s.avatar_key IS NOT NULL`;

// The chrome (safeWordmark in public/app/shell.js) paints a saved logo only when, after trimming, it is an
// https address with no whitespace, quote, bracket or angle mark in it (any letter case), or an inline
// data:image base64 value. The same two patterns are written here, with the same trim, so a logo the chrome
// refuses is red, and a logo it paints (a stray space around an address) is not. The logos the chrome can
// be handed are the company's own (staff, affiliate and client sessions) and a partner's approved one (a
// partner session; api/org-brand.mjs holds an unapproved logo back). The colours, faces and ramp are held by
// the tables' own CHECKs and cannot be wrong, so the logo is the one brand result that can.
const BRAND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE regexp_replace(x.logo, '^https://[^\\s"''<>()]+$', '', 'i') <> ''
         AND regexp_replace(x.logo, '^data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$', '', '') <> '')::int AS bad_count
  FROM (
    SELECT regexp_replace(b.wordmark_url, '^\\s+|\\s+$', '', 'g') AS logo
      FROM org_brand b
     WHERE b.org_id = $1::uuid AND b.wordmark_url IS NOT NULL
    UNION ALL
    SELECT regexp_replace(pb.wordmark_url, '^\\s+|\\s+$', '', 'g') AS logo
      FROM partner_brand pb
     WHERE pb.org_id = $1::uuid AND pb.approval_status = 'approved' AND pb.wordmark_url IS NOT NULL
  ) x
 WHERE x.logo <> ''`;

// A sidebar head that every role has hidden: the shared chrome hides each row under it by name (NAV_HIDDEN),
// then hides the whole section. No saved result can show a head nobody sees, so the contract is an honest
// gap that carries one claim: the live shell.js is read again on every run (src/pulse/coverage/
// fin-b19-hidden-head.mjs), both the list and the code that applies it. While every row under the head is
// hidden and the gate still applies the list the row says "nothing to judge", and the day one row is shown,
// or the gate is written another way, it goes back to not proved.
const HEAD_CONTRACTS = FIN_B19_HIDDEN_HEADS.map((head) => Object.freeze({
  control: head.control,
  mode: "always-red",
  requirement: `The ${head.label} head of the sidebar folds and unfolds the rows under it. Every row under it (${head.links.join(", ")}) is on the shared chrome's hidden list and the chrome's gate still applies that list, so no role is shown the head and there is nothing to fold. If a row is shown, or the gate changes, the head must be proved.`,
  sql: null,
  hiddenHead: Object.freeze({ path: "/app/shell.js", section: head.section, label: head.label }),
}));

// The retired Home and Watch sidebar rows. The retired-control lane reads the shipped shell and turns these
// contracts into a verified N/A only while Insights exists and the old section stays absent.
const PAGE_GAP_CONTRACTS = FIN_B19_NOT_ATTACHABLE.map((row) => Object.freeze({
  control: row.control,
  mode: "always-red",
  requirement: row.requirement,
  sql: null,
}));

export const FIN_B19_DISPLAY_CONTRACTS = Object.freeze([
  ...RAIL_CONTRACTS,
  ...HEAD_CONTRACTS,
  ...PAGE_GAP_CONTRACTS,
  query(
    "'Flag <belief>' button: stores a belief x source row for marketing",
    "Every belief flag filed from the sales floor must name a staff member of the same company, say in its note the same belief and the same count the row saved, and carry a lead source and setter that some call of this company really has.",
    "fin-b19-sales-floor-flag",
    FLAG_SQL,
  ),
  query(
    "'Sync recordings from Drive': scans Drive, indexes Meet files, reloads the floor",
    "The saved Drive scan state must show a finished scan: a scan time, a page token to continue from, and no saved error.",
    "fin-b19-drive-sync",
    DRIVE_SYNC_SQL,
  ),
  query(
    "Account chip: add or change your photo (hidden file input, PNG or JPEG)",
    "Every saved staff photo must be stored under that same person's own company and staff folder, and be a PNG or JPEG.",
    "fin-b19-staff-photo",
    PHOTO_SQL,
  ),
  query(
    "Brand paint: company colors and logo applied to the chrome",
    "A saved company logo, and a partner's approved logo, must be an https address with no whitespace, quote, bracket or angle mark in it, or an inline data:image base64 value, or the chrome refuses to paint it.",
    "fin-b19-brand-wordmark",
    BRAND_SQL,
  ),
]);
