// Live saved-result checks for batch 19 (finish the 853, tier 4, lane gap-catalog-display). Each one is a
// read-only query that takes the company ($1) and answers sample_count (how many saved results exist) and
// bad_count (how many of them are wrong). A control nobody has used yet has no results, so each contract
// says emptyAs "quiet": green with "no saved results yet" until the first wrong result, then red.
//
// The SQL is written in the part of the language that Postgres and SQLite read the same way (LIKE, ||,
// CASE, FILTER, joins, IS NOT NULL, ::casts that the test strips), so fin-b19-display-contracts.test.mjs
// can run the very same text on stand-in tables and see it go red.
//
// Five more contracts at the end are not queries: three carry the claim that a sidebar head is shown to no
// role (HEAD_CONTRACTS), and two name a pipeline control the page has to fix first (PAGE_GAP_CONTRACTS).

import { FIN_B19_HIDDEN_HEADS, FIN_B19_NOT_ATTACHABLE } from "./fin-b19-not-attachable.mjs";

const query = (control, requirement, key, body) => Object.freeze({
  control,
  mode: "query",
  emptyAs: "quiet",
  requirement,
  sql: `/* display-result:${key} */\n${body.trim()}`,
});

// A rail tab opens one pipeline. Its board shows a card only when the card's column belongs to that
// pipeline and the card's person (client or partner) is in the same company. A card that fails either
// test is on the rail in the database and missing from the screen: the rail tab shows the wrong board.
const railSql = (key) => `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE st.id IS NULL OR st.pipeline_id <> cd.pipeline_id
         OR (c.id IS NULL AND pr.id IS NULL))::int AS bad_count
  FROM cards cd
  JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id
  LEFT JOIN pipeline_stages st ON st.id = cd.stage_id
  LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id
  LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = p.org_id
 WHERE p.org_id = $1::uuid AND p.key = '${key}' AND COALESCE(cd.is_demo, false) = false
   AND (c.id IS NULL OR (COALESCE(c.is_demo, false) = false AND c.custom_fields->>'crm_archived_at' IS NULL))`;

const RAILS = [
  ["Rail tab R-01 Sales", "sales", "Sales"],
  ["Rail tab R-02 Funding: Card Stacking", "funding_card_stacking", "Funding: Card Stacking"],
  ["Rail tab R-04 Optimization (Repair) Rounds", "optimization", "Optimization (Repair) Rounds"],
  ["Rail tab R-05 Inquiry Removal", "inquiry_removal", "Inquiry Removal"],
  ["Rail tab R-06 AR / Collections", "ar_collections", "AR / Collections"],
  ["Rail tab R-08 Affiliates + White Label", "affiliates_white_label", "Affiliates + White Label"],
  ["Rail tab R-09 Hiring", "hiring", "Hiring"],
];

const RAIL_CONTRACTS = RAILS.map(([control, key, label]) => query(
  control,
  `Every card saved on the ${label} rail must sit in a column of that same rail and name a person in the same company, or the tab's board silently leaves it out.`,
  `fin-b19-rail-${key.replace(/_/g, "-")}`,
  railSql(key),
));

const FLAG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.id IS NULL
         OR f.note NOT LIKE ('% this period ' || f.outcome_count || ' vs last %'))::int AS bad_count
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

// The shell paints a saved logo only when it is an https address or an inline image with no spaces,
// quotes, brackets or angle marks in it. The colors and fonts are checked by the table itself; the logo
// address is free text, so a saved logo the chrome refuses is the one brand result that can be wrong.
const BRAND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE b.wordmark_url IS NOT NULL
         AND NOT ((lower(b.wordmark_url) LIKE 'https://%' OR lower(b.wordmark_url) LIKE 'data:image/%;base64,%')
           AND b.wordmark_url NOT LIKE '% %' AND b.wordmark_url NOT LIKE '%"%' AND b.wordmark_url NOT LIKE '%''%'
           AND b.wordmark_url NOT LIKE '%<%' AND b.wordmark_url NOT LIKE '%>%'
           AND b.wordmark_url NOT LIKE '%(%' AND b.wordmark_url NOT LIKE '%)%'))::int AS bad_count
  FROM org_brand b
 WHERE b.org_id = $1::uuid`;

// A sidebar head that every role has hidden: the shared chrome hides each row under it by name (NAV_HIDDEN),
// then hides the whole section. No saved result can show a head nobody sees, so the contract is an honest
// gap that carries one claim: the live shell.js is read again on every run (src/pulse/coverage/
// fin-b19-hidden-head.mjs). While every row under the head is hidden the row says "nothing to judge", and the
// day one row is shown it goes back to not proved.
const HEAD_CONTRACTS = FIN_B19_HIDDEN_HEADS.map((head) => Object.freeze({
  control: head.control,
  mode: "always-red",
  requirement: `The ${head.label} head of the sidebar folds and unfolds the rows under it. Every row under it (${head.links.join(", ")}) is on the shared chrome's hidden list, so no role is shown the head and there is nothing to fold. If a row is shown, the head must be proved.`,
  sql: null,
  hiddenHead: Object.freeze({ path: "/app/shell.js", section: head.section, label: head.label }),
}));

// The two pipeline rows whose control does not do what its words say (Manual, and the x on the Sort chip).
// There is no saved result and the page has to change first, so the contract is an honest gap that names
// exactly what is wrong, and the row stays NOT_PROVED with that sentence on the board.
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
    "Every belief flag filed from the sales floor must name a staff member of the same company, and the count saved on the row must be the same count written in its note.",
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
    "A saved company logo must be an https address or an inline image with no spaces, quotes, brackets or angle marks, or the chrome refuses to paint it.",
    "fin-b19-brand-wordmark",
    BRAND_SQL,
  ),
]);
