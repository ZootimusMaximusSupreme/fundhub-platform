// Finish-853 batch 16 (tier 4, lane gap-catalog-display): the Marketing Command Center settings, shoot and
// avatar controls, and the staff reply inbox's "Send this one to" box.
//
// LIVE CHECKS in this file. Each is one read-only SQL text the display lane runs for the company. It takes
// $1::uuid (the company) and returns sample_count (how many saved results exist) and bad_count (how many
// are wrong). A control nobody has used has no results, so every check here is `emptyAs: "quiet"`: green
// with the words "no saved results yet", red on the first wrong result.
//
// Every check is built from NAMED bad-result conditions joined with OR. fin-b16-live-contracts.test.mjs
// runs the exact text over stand-in rows (real column names from db/migrations), then drops each named
// condition from the text and shows the row it guards is no longer caught.
//
// The practice-test rows of this batch are listed in fin-b16-rows.json and attached in
// fin-b16-display-proofs.mjs.
//
// This file imports nothing. scripts/pulse/compile-catalog.mjs reads it at build time; the live bundle
// reads the compiled copy in src/pulse/catalog/generated.json. It must not import display-saved-result.mjs
// (that file imports this one).

export const FIN_B16_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B16_LIVE_TEST = "src/pulse/catalog/proofs/fin-b16-live-contracts.test.mjs";
export const FIN_B16_SOURCE_FILE = "desks-c.json";

const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;

/** `names` kept out of the text, for the test that drops one condition at a time. */
function orJoin(pairs, without, indent = "         ") {
  const kept = pairs.filter(([name]) => !without.includes(name));
  if (!kept.length) return "1 = 0";
  return kept.map(([, expr]) => `(${expr})`).join(`\n${indent}OR `);
}

// ───────────────────── Settings: quiet hours (marketing-command-center.html) ─────────────────────
//
// The Settings page says: "No buzzes from 9:00 pm to 7:00 am, Arizona time. They wait until 7:00 am."
// A buzz is a text to Chris's phone (marketing_buzzes). src/marketing/notify.mjs holds a buzz that is
// made inside quiet hours until they end (send_after). So the saved result of the two time boxes is
// when buzzes went out: one that was made inside quiet hours must not have been sent before they ended.
// Only buzzes made after the settings were last saved are judged (they were made under these hours).
// A start equal to its end means no quiet hours at all, so that company has nothing to judge.

function inQuiet(column) {
  const wall = `(${column} AT TIME ZONE s.timezone)::time`;
  return `(CASE WHEN s.quiet_start < s.quiet_end
                 THEN ${wall} >= s.quiet_start AND ${wall} < s.quiet_end
                 ELSE ${wall} >= s.quiet_start OR ${wall} < s.quiet_end END)`;
}

export const QUIET_BAD = Object.freeze([
  ["a buzz made inside quiet hours was texted before they ended", `${inQuiet("b.created_at")}\n         AND ${inQuiet("b.sent_at")}`],
]);

export function quietHoursSql({ without = [] } = {}) {
  return `/* display-result:fin-b16-quiet-hours */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(QUIET_BAD, without)})::int AS bad_count
  FROM marketing_buzzes b
  JOIN marketing_settings s ON s.org_id = b.org_id
 WHERE b.org_id = $1::uuid
   AND b.sent_at IS NOT NULL
   AND b.created_at >= s.updated_at
   AND s.quiet_start <> s.quiet_end`;
}

// ───────────────────── Settings: schedule fields (marketing-command-center.html) ─────────────────────
//
// Three results, one per saved box group:
//   the weekly drop      a weekly batch's release_at lands on the saved weekday and time in the saved zone,
//                        and its plan was made under the saved count rule and the saved scripts a day times
//                        days in a batch (src/marketing/planner.mjs step 1). A batch is judged only when its
//                        whole planning window (3 hours before release_at) came after the last save; a plan
//                        with a one-time override, or with no active funnel, is not judged on its count.
//   the six script kinds a machine-written script made after the last save carries the style saved for its
//                        kind (planner styleFor, then the writer keeps the slot's style).
//   drafts expiry        a machine draft of a released batch is expired once the saved number of days (and a
//                        two day grace for the nightly chore) have passed (src/marketing/batch-run.mjs
//                        expireDrafts).

export const DROP_BAD = Object.freeze([
  ["the weekly drop is on a different weekday than the one saved",
    `EXTRACT(dow FROM (b.release_at AT TIME ZONE s.timezone)) <> s.batch_weekday`],
  ["the weekly drop is at a different time than the one saved",
    `(b.release_at AT TIME ZONE s.timezone)::time <> s.batch_time`],
  ["the weekly plan was made under a different count rule than the one saved",
    `b.plan IS NOT NULL AND (b.plan ->> 'size_rule') IS DISTINCT FROM s.size_rule`],
  ["a plan under the total rule does not hold scripts a day times days in a batch",
    `b.plan IS NOT NULL AND (b.plan ->> 'size_rule') = 'total'
         AND COALESCE(jsonb_typeof(b.plan -> 'overrides'), 'null') = 'null'
         AND EXISTS (SELECT 1 FROM marketing_funnels f WHERE f.org_id = b.org_id AND f.active = true)
         AND (b.plan ->> 'total')::int <> s.scripts_per_day * s.days_per_batch`],
  ["a plan under the per funnel rule is not a whole number of funnels' scripts a day times days",
    `b.plan IS NOT NULL AND (b.plan ->> 'size_rule') = 'per_funnel'
         AND COALESCE(jsonb_typeof(b.plan -> 'overrides'), 'null') = 'null'
         AND EXISTS (SELECT 1 FROM marketing_funnels f WHERE f.org_id = b.org_id AND f.active = true)
         AND (b.plan ->> 'total')::int % (s.scripts_per_day * s.days_per_batch) <> 0`],
]);

export const STYLE_BAD = Object.freeze([
  ["a machine-written script has a different style than the one saved for its kind",
    `(s.format_style ->> a.script_format) IS NOT NULL AND a.style IS DISTINCT FROM (s.format_style ->> a.script_format)`],
]);

export const EXPIRY_BAD = Object.freeze([
  ["a machine draft is still a draft after its batch's expiry days and the nightly grace",
    `a.status = 'draft'`],
]);

export function scheduleSql({ without = [] } = {}) {
  return `/* display-result:fin-b16-schedule-fields */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
    SELECT CASE WHEN ${orJoin(DROP_BAD, without, "              ")} THEN 1 ELSE 0 END AS bad
      FROM marketing_batches b
      JOIN marketing_settings s ON s.org_id = b.org_id
     WHERE b.org_id = $1::uuid
       AND b.kind = 'weekly'
       AND b.status <> 'failed'
       AND b.release_at IS NOT NULL
       AND b.release_at > s.updated_at + interval '3 hours'
  UNION ALL
    SELECT CASE WHEN ${orJoin(STYLE_BAD, without, "              ")} THEN 1 ELSE 0 END AS bad
      FROM ad_scripts a
      JOIN marketing_settings s ON s.org_id = a.org_id
     WHERE a.org_id = $1::uuid
       AND a.source = 'machine'
       AND a.script_format IS NOT NULL
       AND a.created_at >= s.updated_at
  UNION ALL
    SELECT CASE WHEN ${orJoin(EXPIRY_BAD, without, "              ")} THEN 1 ELSE 0 END AS bad
      FROM ad_scripts a
      JOIN marketing_batches b ON b.id = a.batch_id AND b.org_id = a.org_id
      JOIN marketing_settings s ON s.org_id = a.org_id
     WHERE a.org_id = $1::uuid
       AND a.source = 'machine'
       AND a.archived_at IS NULL
       AND a.status IN ('draft', 'expired')
       AND b.status = 'released'
       AND b.released_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (now() - b.released_at)) > (s.draft_expiry_days + 2) * 86400
  ) r`;
}

// ───────────────────── Shoot: 'Save the plan' and the plan rows (marketing-command-center.html) ─────────────────────
//
// Saving the plan writes one marketing_shoots row (root_script_ids in film order) and sets each script's
// film_order (src/marketing/shoot-store.mjs). The rules the store holds in code, not in the database:
// one open shoot per company, a plan of scripts that are on file, each once, at most 100, and every
// script on an open plan carries a film order.

export const SHOOT_CREATE_BAD = Object.freeze([
  ["a shoot plan names no script", `COALESCE(cardinality(s.root_script_ids), 0) = 0`],
  ["a second shoot is open for the same company",
    `s.status <> 'done' AND EXISTS (SELECT 1 FROM marketing_shoots o
                  WHERE o.org_id = s.org_id AND o.id <> s.id AND o.status <> 'done')`],
  ["a shoot plan names a script that is not on file for this company",
    `EXISTS (SELECT 1 FROM unnest(s.root_script_ids) AS r(value)
              WHERE NOT EXISTS (SELECT 1 FROM ad_scripts a
                                 WHERE a.org_id = s.org_id AND a.root_script_id = r.value))`],
]);

export const SHOOT_ORDER_BAD = Object.freeze([
  ["a shoot plan names one script twice",
    `cardinality(s.root_script_ids) <> (SELECT count(DISTINCT r.value) FROM unnest(s.root_script_ids) AS r(value))`],
  ["a shoot plan holds more scripts than a shoot may (100)", `cardinality(s.root_script_ids) > 100`],
  ["a script on an open shoot plan has no film order",
    `s.status <> 'done' AND EXISTS (SELECT 1 FROM unnest(s.root_script_ids) AS r(value)
              JOIN ad_scripts a ON a.org_id = s.org_id AND a.root_script_id = r.value
             WHERE a.archived_at IS NULL AND a.film_order IS NULL)`],
]);

function shootSql(key, bad, without) {
  return `/* display-result:${key} */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(bad, without)})::int AS bad_count
  FROM marketing_shoots s
 WHERE s.org_id = $1::uuid`;
}
export const shootCreateSql = ({ without = [] } = {}) => shootSql("fin-b16-shoot-save-plan", SHOOT_CREATE_BAD, without);
export const shootOrderSql = ({ without = [] } = {}) => shootSql("fin-b16-shoot-plan-rows", SHOOT_ORDER_BAD, without);

// ───────────────────── Today: 'Build the avatar' (marketing-command-center.html) ─────────────────────
//
// The button queues one marketing_jobs row of kind 'avatar'. The run stops before a step that would take
// it past the stop amount frozen on the row at the tap (payload.run_cap_usd), so what it spent is never
// more than that. A finished run is on its last step and names the files it saved. A run that stopped at
// the cap says why in plain words (src/marketing/avatar/run.mjs).

export const AVATAR_BAD = Object.freeze([
  ["a run spent more than the stop amount saved on it",
    `(j.payload ->> 'run_cap_usd') IS NOT NULL
         AND COALESCE((SELECT sum(u.cost_usd) FROM marketing_model_usage u
                        WHERE u.org_id = j.org_id AND u.job_id = j.id), 0) > (j.payload ->> 'run_cap_usd')::numeric`],
  ["a finished run is not on its last step",
    `j.status = 'done' AND (j.payload ->> 'step') IS DISTINCT FROM 'done'`],
  ["a finished run lists no saved files",
    `j.status = 'done' AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(j.result -> 'files') = 'array'
              THEN j.result -> 'files' ELSE '[]'::jsonb END), 0) = 0`],
  ["a run that stopped at the cap does not say why",
    `j.status = 'failed' AND (j.payload -> 'progress' -> 'stopped_at_cap') IS NOT NULL
         AND ${BLANK("j.payload -> 'progress' -> 'stopped_at_cap' ->> 'sentence'")}`],
]);

export function avatarSql({ without = [] } = {}) {
  return `/* display-result:fin-b16-avatar-run */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(AVATAR_BAD, without)})::int AS bad_count
  FROM marketing_jobs j
 WHERE j.org_id = $1::uuid
   AND j.kind = 'avatar'`;
}

// ───────────────────── messaging.html: 'Send this one to' ─────────────────────
//
// A typed destination goes on the message row (messages.to_address) for that one message only
// (src/messaging/compose.mjs validDestination): an email shaped like name@example.com, or a text number in
// full international form. Only staff-written messages of the last 90 days that went to an address other
// than the one on the client's record are judged, and only when the record was not changed after the
// message was made (so a number fixed on the record later is not blamed on the sender).

export const SEND_TO_BAD = Object.freeze([
  ["a typed email destination is not an email address",
    String.raw`m.channel = 'email' AND m.to_address !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'`],
  ["a typed text destination is not a full international number",
    String.raw`m.channel = 'sms' AND m.to_address !~ '^\+[1-9][0-9]{7,14}$'`],
  ["a typed destination was put on a channel nobody can address by hand",
    `m.channel NOT IN ('email', 'sms')`],
]);

export function sendToSql({ without = [] } = {}) {
  return `/* display-result:fin-b16-send-this-one-to */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(SEND_TO_BAD, without)})::int AS bad_count
  FROM messages m
  JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND COALESCE(m.is_demo, false) = false
   AND m.direction = 'outbound'
   AND m.sender_kind = 'staff'
   AND m.to_address IS NOT NULL
   AND BTRIM(m.to_address) <> ''
   AND m.created_at >= now() - interval '90 days'
   AND m.created_at >= c.updated_at
   AND m.to_address IS DISTINCT FROM (CASE m.channel WHEN 'email' THEN c.email WHEN 'sms' THEN c.phone END)`;
}

// ───────────────────────── the registry list ─────────────────────────

const CHECKS = [
  {
    surface: "marketing-command-center.html",
    control: "Settings: quiet hours: start and end time inputs",
    requirement: "Every buzz that was made inside the saved quiet hours (after they were last saved) must have waited: none may have been texted before quiet hours ended.",
    sql: quietHoursSql,
    names: QUIET_BAD.map(([name]) => name),
  },
  {
    surface: "marketing-command-center.html",
    control: "Settings: schedule fields: drop day, drop time (Arizona), scripts a day, days in a batch, count rule (total / per funnel), style for each of 6 script kinds, drafts expiry",
    requirement: "Every weekly batch planned under the saved schedule must drop on the saved weekday and time and hold the saved count; every machine script written since the last save must carry the style saved for its kind; and no machine draft may still be a draft past the saved expiry days.",
    sql: scheduleSql,
    names: [...DROP_BAD, ...STYLE_BAD, ...EXPIRY_BAD].map(([name]) => name),
  },
  {
    surface: "marketing-command-center.html",
    control: "Shoot: 'Save the plan' (before a shoot; sends the film order)",
    requirement: "Every saved shoot plan must name at least one script that is on file for this company, and a company must have at most one open shoot.",
    sql: shootCreateSql,
    names: SHOOT_CREATE_BAD.map(([name]) => name),
  },
  {
    surface: "marketing-command-center.html",
    control: "Shoot: plan row: include checkbox, Up / Down / 'Film first', 'Remove from shoot', 'Add to the end'",
    requirement: "Every saved shoot order must name each script once, hold at most 100, and give every script on an open shoot a film order.",
    sql: shootOrderSql,
    names: SHOOT_ORDER_BAD.map(([name]) => name),
  },
  {
    surface: "marketing-command-center.html",
    control: "Today: 'Build the avatar' button on step 1 (cost sheet, run, live step words, Retry after a stop)",
    requirement: "Every avatar run must have spent no more than the stop amount saved on it; a finished run must be on its last step and list its saved files; a run that stopped at the cap must say why.",
    sql: avatarSql,
    names: AVATAR_BAD.map(([name]) => name),
  },
  {
    surface: "messaging.html",
    control: "'Send this one to' address box (applies to this one message only; never written back to the record)",
    requirement: "Every staff message sent to an address other than the one on the client's record must carry a destination shaped for its channel: an email address for email, a full international number for a text.",
    sql: sendToSql,
    names: SEND_TO_BAD.map(([name]) => name),
  },
];

export const FIN_B16_CHECKS = Object.freeze(CHECKS.map((check) => Object.freeze(check)));

/** The contracts the display lane runs, in the registry's own shape. */
export const FIN_B16_RESULT_CONTRACTS = Object.freeze(FIN_B16_CHECKS.map((check) => Object.freeze({
  control: check.control,
  mode: "query",
  emptyAs: "quiet",
  requirement: check.requirement,
  sql: check.sql(),
})));

/** The exact map rows (desks file, surface, control) each live check is attached to. */
export const FIN_B16_LIVE_ROWS = Object.freeze(FIN_B16_CHECKS.map((check) => Object.freeze([FIN_B16_SOURCE_FILE, check.surface, check.control])));

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B16_LIVE_CASES = Object.freeze(FIN_B16_LIVE_ROWS.map(([sourceFile, surface, control]) => Object.freeze({
  sourceFile,
  surface,
  control,
  depth: "deep",
  evidence: `${FIN_B16_LIVE_TEST}; ${FIN_B16_LANE}`,
  tests: Object.freeze([FIN_B16_LIVE_TEST]),
})));
