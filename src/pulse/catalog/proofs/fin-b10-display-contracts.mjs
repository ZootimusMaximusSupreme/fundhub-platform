// Finish-853 batch 10: live checks for seven display controls. Five leave a durable saved result (a SQL
// contract each); two are links the app's own link gate decides (a link-gate contract each, see linkGate()).
// Each SQL contract is one read-only SQL text. It takes the company as $1::uuid and returns sample_count
// (how many saved results exist) and bad_count (how many are wrong).
//
// Every contract is `emptyAs: "quiet"`: a control nobody has used in the window has nothing to judge,
// so it is green with the words "no saved results yet" and goes red on the first wrong result. The
// 60 day window keeps old imported rows from turning a live check red.
//
// The SQL is written in the common subset of Postgres and SQLite on purpose (no regexes, no arrays, no
// jsonb), so fin-b10-live-contracts.test.mjs can run the exact text against stand-in rows built from the
// real column names.
//
// This file imports nothing. It is read at build time by scripts/pulse/compile-catalog.mjs; the live
// bundle reads the compiled copy in generated.json.

export const FIN_B10_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B10_LIVE_TEST = "src/pulse/catalog/proofs/fin-b10-live-contracts.test.mjs";
export const FIN_B10_LINK_GATE_TEST = "src/pulse/coverage/fin-b10-link-gate.test.mjs";

function contract(control, requirement, key, body) {
  return Object.freeze({
    control,
    mode: "query",
    emptyAs: "quiet",
    requirement,
    sql: `/* display-result:${key} */\n${body.trim()}`,
  });
}

// A link control. The result is not a saved row: it is whether the app's own link gate (public/app/shell.js)
// lets the people the link is for see it. The lane reads the DEPLOYED shell with one GET and judges, per
// named screen, the staff roles that must be able to open it (src/pulse/coverage/fin-b10-link-gate.mjs).
// It is red the day a screen is missing from the gate's lists and green by itself once it is added.
function linkGate(control, requirement, key, links) {
  return Object.freeze({
    control,
    mode: "link-gate",
    requirement,
    key,
    sql: null,
    links: Object.freeze(links.map(([file, roles]) => Object.freeze({ file, roles: Object.freeze([...roles]) }))),
  });
}

// Funnel pages: Sync now. Every saved page-stat row must belong to a ClickFunnels connection of its own
// company, be dated no later than the day it was captured (the sync stamps today), and hold views and
// conversions that are either unknown (NULL, never a made-up zero) or whole numbers that are not negative.
const FUNNEL_SYNC_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.id IS NULL
         OR c.org_id IS DISTINCT FROM s.org_id
         OR c.platform IS DISTINCT FROM 'clickfunnels'
         OR s.views < 0
         OR s.conversions < 0
         OR s.stat_date > date(s.captured_at AT TIME ZONE 'UTC'))::int AS bad_count
  FROM funnel_page_stats s
  LEFT JOIN analytics_connections c ON c.id = s.connection_id
 WHERE s.org_id = $1::uuid
   AND s.captured_at >= now() - interval '60 days'`;

// Add a document: + button. An upload is written pending and only an owner can move it. So every saved
// upload must keep a synthetic id, a name, a size and the person who added it; an approved one must have
// an owner's approval on file; a turned-down one must have its turned-down review and stay owner-only;
// a waiting one must have its review waiting.
const UPLOAD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE f.drive_file_id NOT LIKE 'upload:%'
         OR NULLIF(BTRIM(COALESCE(f.name, '')), '') IS NULL
         OR COALESCE(f.size_bytes, 0) <= 0
         OR f.uploaded_by IS NULL
         OR (f.approval_status = 'approved' AND NOT EXISTS (
               SELECT 1 FROM brain_classification_reviews r
                WHERE r.org_id = f.org_id AND r.file_id = f.id
                  AND r.status = 'approved' AND r.decided_by IS NOT NULL))
         OR (f.approval_status = 'rejected' AND (f.access_tier <> 'owner' OR NOT EXISTS (
               SELECT 1 FROM brain_classification_reviews r
                WHERE r.org_id = f.org_id AND r.file_id = f.id
                  AND r.status = 'rejected' AND r.decided_by IS NOT NULL)))
         OR (f.approval_status = 'pending' AND NOT EXISTS (
               SELECT 1 FROM brain_classification_reviews r
                WHERE r.org_id = f.org_id AND r.file_id = f.id AND r.status = 'pending')))::int AS bad_count
  FROM brain_files f
 WHERE f.org_id = $1::uuid
   AND f.source = 'upload'
   AND f.created_at >= now() - interval '60 days'`;

// 'N waiting' badges. The badge counts uploads that wait for an owner, so each one must have a review the
// owner can decide. A waiting upload with no review is counted in the badge and can never be approved.
const WAITING_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM brain_classification_reviews r
          WHERE r.org_id = f.org_id AND r.file_id = f.id AND r.status = 'pending'))::int AS bad_count
  FROM brain_files f
 WHERE f.org_id = $1::uuid
   AND f.source = 'upload'
   AND f.approval_status = 'pending'`;

// Join call button. The button is off when a booked call carries no link. So every real booked call that
// is still ahead (or began in the last 2 hours) must carry a web link, on the booking or on the closer's task
// for that booking. Tester bookings (sim, gauntlet, +tag, example and company addresses) are left out.
const JOIN_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NOT (LOWER(BTRIM(COALESCE(b.meeting_url, ''))) LIKE 'http://%'
                                OR LOWER(BTRIM(COALESCE(b.meeting_url, ''))) LIKE 'https://%')
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
            WHERE t.org_id = b.org_id AND t.body = b.provider_uid
              AND (LOWER(BTRIM(COALESCE(t.meeting_url, ''))) LIKE 'http://%'
                OR LOWER(BTRIM(COALESCE(t.meeting_url, ''))) LIKE 'https://%')))::int AS bad_count
  FROM bookings b
 WHERE b.org_id = $1::uuid
   AND b.status IN ('booked', 'rescheduled')
   AND b.starts_at >= now() - interval '2 hours'
   AND b.starts_at <= now() + interval '45 days'
   AND b.source NOT IN ('sim', 'gauntlet')
   AND COALESCE(b.attendee_email, '') NOT LIKE '%+%'
   AND COALESCE(b.attendee_email, '') NOT LIKE '%@example.%'
   AND COALESCE(b.attendee_email, '') NOT LIKE '%@fundhub.ai'`;

// Client picker. The picker lists the newest 200 clients by name or email. So every client must be inside
// the newest 200 (older ones cannot be picked at all) and carry a name or an email (or the picker shows a
// bare id).
const PICKER_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ranked.rn > 200
         OR (NULLIF(BTRIM(COALESCE(ranked.first_name, '') || COALESCE(ranked.last_name, '')), '') IS NULL
             AND NULLIF(BTRIM(COALESCE(ranked.email, '')), '') IS NULL))::int AS bad_count
  FROM (
    SELECT c.id, c.first_name, c.last_name, c.email,
           row_number() OVER (ORDER BY c.created_at DESC) AS rn
      FROM clients c
     WHERE c.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false
  ) ranked`;

export const FIN_B10_RESULT_CONTRACTS = Object.freeze([
  contract(
    "Funnel pages: Sync now button",
    "Every saved funnel page row must belong to a ClickFunnels connection of its own company, be dated no later than the day it was saved, and hold views and conversions that are unknown or not negative.",
    "funnel-sync-stats",
    FUNNEL_SYNC_SQL,
  ),
  contract(
    "Add a document: '+' button then file picker (PDF, Word, Excel, PowerPoint, text; 25 MB cap)",
    "Every uploaded document must keep an upload id, a name, a size and who added it; an approved one needs an owner's approval on file, a turned down one must stay owner-only with its review, and a waiting one must have its review waiting.",
    "brain-upload-result",
    UPLOAD_SQL,
  ),
  contract(
    "'N waiting' pending badges (two)",
    "Every upload still waiting for approval must have a pending review the owner can decide, or the badge counts a file nobody can approve.",
    "brain-waiting-review",
    WAITING_SQL,
  ),
  contract(
    "Join call button (opens the booked call link)",
    "Every real booked call still ahead must carry a web link on its booking or on its task, or the Join call button is off for that customer.",
    "booked-call-join-link",
    JOIN_SQL,
  ),
  contract(
    "Client picker select (200 clients, navigates to ?id=)",
    "Every client must be among the newest 200 the picker lists and must carry a name or an email, so the picker can find and name each one.",
    "client-picker-reach",
    PICKER_SQL,
  ),
  linkGate(
    "More menu: Open Credit Snapshot link",
    "The Credit Snapshot link on the Client Control Panel must be shown to the owner and to a closer, so the deck screen it opens can be reached from the file.",
    "credit-snapshot-link-gate",
    [["present.html", ["owner", "closer"]]],
  ),
  linkGate(
    "Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover",
    "All four Quick launch links on the Client Control Panel must be shown to the owner and to a closer: Pipeline, the Closer Deck, Messaging and Inquiry Remover.",
    "quick-launch-link-gate",
    [["pipeline.html", ["owner", "closer"]], ["present.html", ["owner", "closer"]], ["messaging.html", ["owner", "closer"]], ["inquiry-remover.html", ["owner", "closer"]]],
  ),
]);

/** The exact map rows (desks file, surface, control) each live check is attached to. */
export const FIN_B10_LIVE_ROWS = Object.freeze([
  ["desks-a.json", "campaign-manager.html", FIN_B10_RESULT_CONTRACTS[0].control],
  ["desks-b.json", "company-brain.html", FIN_B10_RESULT_CONTRACTS[1].control],
  ["desks-b.json", "company-brain.html", FIN_B10_RESULT_CONTRACTS[2].control],
  ["desks-a.json", "closer-dashboard.html", FIN_B10_RESULT_CONTRACTS[3].control],
  ["desks-a.json", "client-control-panel.html", FIN_B10_RESULT_CONTRACTS[4].control],
  ["desks-a.json", "client-control-panel.html", FIN_B10_RESULT_CONTRACTS[5].control],
  ["desks-a.json", "client-control-panel.html", FIN_B10_RESULT_CONTRACTS[6].control],
]);

// The five saved-result checks are held by the SQL test; the two link-gate checks by the gate test.
const testFor = (control) => (FIN_B10_RESULT_CONTRACTS.find((c) => c.control === control)?.mode === "link-gate"
  ? FIN_B10_LINK_GATE_TEST
  : FIN_B10_LIVE_TEST);

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B10_LIVE_CASES = Object.freeze(FIN_B10_LIVE_ROWS.map(([sourceFile, surface, control]) => Object.freeze({
  sourceFile,
  surface,
  control,
  depth: "deep",
  evidence: `${testFor(control)}; ${FIN_B10_LANE}`,
  tests: Object.freeze([testFor(control)]),
})));
