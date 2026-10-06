// @ts-check
// The marketing machine API contract, as data.
//
// This is the machine-readable twin of docs/specs/marketing-machine-api.md.
// Both list the same routes with the same examples, and
// src/marketing/api-contract.test.mjs fails the moment they drift apart.
//
// WHO USES IT
//   - Every back-end unit that builds a marketing/* route (and campaigns/write
//     resume_ad) checks its answers with assertMatchesContract().
//   - Lane E (the Command Center and teleprompter screens) mocks every route from
//     CONTRACT[route].example before the real route lands.
//
// THE RULE (spec docs/specs/marketing-machine-2026-10-04.md §7.8): any PR that
// changes a route's request or response shape updates the doc AND this file in
// the same PR.
//
// WHAT A KEY PATH MEANS
//   "settings"            the body has a `settings` key (its value may be null)
//   "settings.org_id"     when settings is an object, it has `org_id`
//   "scripts[]"           the body has `scripts` and it is a list
//   "scripts[].id"        every item in scripts has `id`
//   "source?"             optional: it may be left out
// A null parent is not checked further: null means unknown, and a shape the doc
// writes as `{...}|null` is allowed to be null. Extra keys are always allowed.
//
// Every value in the examples is made up to show the shape. None is a real
// number from the live database.

/**
 * @typedef {{status:number, error:string, field?:string, when:string, message?:string}} ErrorCase
 * @typedef {{
 *   owner:string, spec:string, method:string, path:string, gate:string,
 *   success:number, guard:(string|null),
 *   requestKeys:string[], requestOneOf?:string[][], responseKeys:string[],
 *   errors:ErrorCase[], example:{request:any, response:any}
 * }} RouteContract
 */

/* ------------------------------------------------------------------------ */
/* Freezing                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/* ------------------------------------------------------------------------ */
/* Shared ids and times (made up, shaped like the real ones)                 */
/* ------------------------------------------------------------------------ */

const ORG = "00000000-0000-4000-8000-000000000001";
const CHRIS = "00000000-0000-4000-8000-000000000002";
const ROOT_1 = "00000000-0000-4000-8000-000000000101";
const SCRIPT_1_V2 = "00000000-0000-4000-8000-000000000102";
const ROOT_2 = "00000000-0000-4000-8000-000000000201";
const BATCH_WEEKLY = "00000000-0000-4000-8000-000000000301";
const BATCH_NOW = "00000000-0000-4000-8000-000000000302";
const IDEA_1 = "00000000-0000-4000-8000-000000000401";
const IDEA_2 = "00000000-0000-4000-8000-000000000402";
const JOB_1 = "00000000-0000-4000-8000-000000000501";
const JOB_2 = "00000000-0000-4000-8000-000000000502";
const JOB_3 = "00000000-0000-4000-8000-000000000503";
const JOB_4 = "00000000-0000-4000-8000-000000000504";
const JOB_5 = "00000000-0000-4000-8000-000000000505";
const FUNNEL_BOOK = "00000000-0000-4000-8000-000000000601";
const FUNNEL_ROADMAP = "00000000-0000-4000-8000-000000000602";
const VIDEO_1 = "00000000-0000-4000-8000-000000000701";
const VIDEO_2 = "00000000-0000-4000-8000-000000000702";
const VIDEO_3 = "00000000-0000-4000-8000-000000000703";
const VIDEO_4 = "00000000-0000-4000-8000-000000000704";
const AD_ROW_1 = "00000000-0000-4000-8000-000000000801";
const SHOOT_1 = "00000000-0000-4000-8000-000000000901";
const SUGGESTION_1 = "00000000-0000-4000-8000-000000000a01";
const CHANGE_1 = "00000000-0000-4000-8000-000000000a02";
const OP_1 = "00000000-0000-4000-8000-000000000b01";
const OP_2 = "00000000-0000-4000-8000-000000000b02";

/* request ids: a fresh uuid the page makes for each tap */
const REQ = (/** @type {string} */ n) => "00000000-0000-4000-8000-00000000c" + n;

const META_SYNC = "2026-10-12T07:01:50.000Z"; // last Meta sync: as_of on Meta reads
const ANSWERED = "2026-10-12T15:04:05.000Z"; // when an answer was built
const RELEASE = "2026-10-12T14:00:00.000Z"; // Monday 7:00 am Arizona
const SHA_RULES = "9c1d4e2f6a8b0c3d5e7f9a1b2c4d6e8f0a1b3c5d";
const SHA_COMMIT = "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d";

/* ------------------------------------------------------------------------ */
/* Key lists for the shared objects                                          */
/* ------------------------------------------------------------------------ */

/** @param {string} prefix @param {string[]} keys */
const under = (prefix, keys) => keys.map((k) => prefix + k);

const SETTINGS_KEYS = [
  "org_id", "enabled", "batch_weekday", "batch_time", "timezone", "scripts_per_day",
  "days_per_batch", "size_rule", "format_style", "draft_expiry_days", "winner_rule",
  "ad_number_floor", "next_overrides", "max_batch_cost_usd", "max_month_cost_usd",
  "submagic_template", "caption_position_y", "magic_zooms", "clean_audio",
  "caption_dictionary", "animation_mode", "flip_horizontal", "settle_minutes",
  "quiet_start", "quiet_end", "updated_at", "updated_by"
];

const FUNNEL_KEYS = [
  "id", "key", "name", "landing_url", "offer_key", "lane", "book_call", "format_mix",
  "cta_type", "meta_campaign_ids", "default_ad_set_external_id", "weight", "active",
  "created_at", "updated_at"
];

/* Script object S (spec §7.4 columns as the API returns them). */
export const SCRIPT_KEYS = Object.freeze([
  "id", "root_script_id", "version", "status", "ad_id", "title", "body", "parts",
  "script_format", "style", "funnel_key", "angle_key", "hook_key", "offer_key", "lane",
  "batch_id", "idea_id", "source", "check_results", "flagged", "fix_note",
  "animation_plan", "meta_copy", "film_order", "needs_retake", "locked_at", "locked_by",
  "rejected_at", "rejected_reason", "filmed_at", "repo_path", "repo_commit",
  "created_at", "updated_at"
]);

const IDEA_KEYS = [
  "id", "source", "kind", "raw_points", "topic", "script_format", "funnel_key",
  "angle_key", "status", "script_id", "created_at"
];

const BATCH_KEYS = ["id", "kind", "week_key", "status", "release_at", "released_at", "counts", "error"];
const COUNT_KEYS = ["total", "ready", "flagged", "failed"];

const NUMBER_KEYS = [
  "spend_cents", "leads", "booked", "showed", "sales", "roadmaps", "cash_cents",
  "reported_cash_cents", "roas"
];

const AD_ROW_KEYS = [
  "ad_number", "title", "funnel_key", "script_format", "angle_key", "spend_cents",
  "impressions", "ctr", "hook_rate", "hold_25", "thruplay_rate", "leads", "booked",
  "showed", "sales", "close_rate", "roadmaps", "cash_cents", "reported_cash_cents",
  "cpl_cents", "cost_per_booked_cents", "roas", "maturing"
];

const NEXT_KEYS = [
  "next", ...under("next.", [
    "release_at", "week_key", "enabled", "total", "size_rule", "funnels[]", "slots[]",
    "suggestions[]", "unmapped_spend_cents", "overrides"
  ]),
  ...under("next.funnels[].", ["funnel_key", "spend_7d_cents", "share", "slots"]),
  ...under("next.slots[].", ["n", "funnel_key", "script_format", "style", "source", "angle_key", "idea_id", "reason"]),
  ...under("next.suggestions[].", ["angle_key", "name", "why", "numbers"]),
  "saved", "saved.batch_id", "saved.status", "as_of"
];

const VIDEO_KEYS = [
  "id", "version", "ad_id", "angle", "funnel_key", "state", "state_word", "since",
  "master_duration_seconds", "submagic_minutes", "can_approve"
];

const SHOOT_KEYS = [
  "id", "shoot_date", "status", "root_script_ids", "marks", "estimated_minutes",
  "board[]", "landed_unmatched", "scripts[]", "started_at", "finished_at",
  "created_at", "updated_at"
];
const BOARD_KEYS = ["ad_id", "angle", "step", "step_word", "since", "reason", "can_retry", "needs_you"];
/* What Shoot Day adds to the Script object S (X5): the NAMING.md take file
   name and the parts it is built from, the takes rolled, and the read time. */
const PLAN_KEYS = [
  "angle_name", "offer_word", "take_no", "take_file_name", "take_name_problem",
  "last_take_file_name", "takes", "got_it", "first_line_only", "teleprompter_text",
  "words", "read_seconds"
];
const PAST_SHOOT_KEYS = ["id", "shoot_date", "scripts", "filmed", "finished_at"];

const SUGGESTION_KEYS = [
  "id", "batch_id", "page", "problem", "numbers", "new_words", "status", "change",
  "created_at", "updated_at"
];
const CHANGE_KEYS = ["id", "request_path", "draft_url", "status", "error"];

/* ------------------------------------------------------------------------ */
/* Example objects                                                          */
/* ------------------------------------------------------------------------ */

const SETTINGS = {
  org_id: ORG,
  enabled: false,
  batch_weekday: 1,
  batch_time: "07:00",
  timezone: "America/Phoenix",
  scripts_per_day: 3,
  days_per_batch: 7,
  size_rule: "total",
  format_style: { standard: "bullets", sorting: "words", long: "words", notes: "bullets", greenscreen: "bullets", vsl: "bullets" },
  draft_expiry_days: 14,
  winner_rule: null,
  ad_number_floor: 91,
  next_overrides: null,
  max_batch_cost_usd: 40,
  max_month_cost_usd: 300,
  submagic_template: "Hormozi 2",
  caption_position_y: null,
  magic_zooms: false,
  clean_audio: true,
  caption_dictionary: [],
  animation_mode: "fullframe",
  flip_horizontal: false,
  settle_minutes: 10,
  quiet_start: "21:00",
  quiet_end: "07:00",
  updated_at: "2026-10-12T15:00:00.000Z",
  updated_by: null
};

const FUNNEL_BOOK_CALL = {
  id: FUNNEL_BOOK,
  key: "book_call",
  name: "Book a call",
  landing_url: "https://apply.fundhub.ai/watch",
  offer_key: "funding_dfy",
  lane: "sorting",
  book_call: true,
  format_mix: { standard: 2, sorting: 1 },
  cta_type: "LEARN_MORE",
  meta_campaign_ids: [],
  default_ad_set_external_id: null,
  weight: 1,
  active: true,
  created_at: "2026-10-06T18:00:00.000Z",
  updated_at: "2026-10-06T18:00:00.000Z"
};

const FUNNEL_ROADMAP_147 = {
  id: FUNNEL_ROADMAP,
  key: "roadmap_147",
  name: "Roadmap $147",
  landing_url: "https://apply.fundhub.ai/roadmap",
  offer_key: "slo_roadmap",
  lane: "uwiq",
  book_call: false,
  format_mix: { standard: 1 },
  cta_type: "LEARN_MORE",
  meta_campaign_ids: [],
  default_ad_set_external_id: null,
  weight: 1,
  active: true,
  created_at: "2026-10-06T18:00:00.000Z",
  updated_at: "2026-10-06T18:00:00.000Z"
};

const FUNNEL_ROADMAP_MAPPED = {
  ...FUNNEL_ROADMAP_147,
  meta_campaign_ids: ["120210000000000001"],
  default_ad_set_external_id: "120210000000000101",
  updated_at: "2026-10-12T15:05:00.000Z"
};

const PARTS_V1 = [
  { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "cue", text: "the business file" },
  { kind: "cue", text: "which one they read first" },
  { kind: "reveal", text: "We check both before you apply anywhere." },
  { kind: "cta", text: "Tap below and see what both files say today." }
];
const BODY_V1 = [
  "MOST lenders read TWO files before they say yes.",
  "",
  "If one is a mess, they never open the other.",
  "",
  "the personal file",
  "the business file",
  "which one they read first",
  "",
  "We check both before you apply anywhere.",
  "",
  "Tap below and see what both files say today."
].join("\n");

const PARTS_V2 = [...PARTS_V1.slice(0, 6), { kind: "cta", text: "Tap below and see your number today." }];
const BODY_V2 = BODY_V1.replace("Tap below and see what both files say today.", "Tap below and see your number today.");

const SCRIPT_DRAFT = {
  id: ROOT_1,
  root_script_id: ROOT_1,
  version: 1,
  status: "draft",
  ad_id: null,
  title: "Lenders read two files",
  body: BODY_V1,
  parts: PARTS_V1,
  script_format: "standard",
  style: "bullets",
  funnel_key: "roadmap_147",
  angle_key: "two-files",
  hook_key: "two-files-lenders-read",
  offer_key: "slo_roadmap",
  lane: "uwiq",
  batch_id: BATCH_WEEKLY,
  idea_id: IDEA_1,
  source: "machine",
  check_results: { strict: { passed: true, rounds: 1, failures: [] }, judge: { passed: true, notes: [] }, compliance: { state: "passed", reasons: [] } },
  flagged: false,
  fix_note: null,
  animation_plan: [
    { anchor: { cue: 1, keyword: "personal" }, template: "FileItems", props: {}, seconds: 2.5 },
    { anchor: { cue: 3, keyword: "first" }, template: "StepPath", props: {}, seconds: 3 }
  ],
  meta_copy: {
    primary_text: "Lenders read two files before they say yes. See what both of yours say before you apply.",
    headline: "See both files first",
    description: "Your Funding Roadmap",
    cta_type: "LEARN_MORE"
  },
  film_order: null,
  needs_retake: false,
  locked_at: null,
  locked_by: null,
  rejected_at: null,
  rejected_reason: null,
  filmed_at: null,
  repo_path: "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
  repo_commit: SHA_COMMIT,
  created_at: "2026-10-12T11:12:40.000Z",
  updated_at: "2026-10-12T11:12:40.000Z"
};

const SCRIPT_LOCKED = {
  ...SCRIPT_DRAFT,
  status: "locked",
  ad_id: "91",
  locked_at: "2026-10-12T15:06:00.000Z",
  locked_by: CHRIS,
  updated_at: "2026-10-12T15:06:00.000Z"
};

const SCRIPT_EDITED = {
  ...SCRIPT_DRAFT,
  id: SCRIPT_1_V2,
  version: 2,
  body: BODY_V2,
  parts: PARTS_V2,
  created_at: "2026-10-12T15:07:00.000Z",
  updated_at: "2026-10-12T15:07:00.000Z"
};

const SCRIPT_V1_SUPERSEDED = { ...SCRIPT_DRAFT, status: "superseded", updated_at: "2026-10-12T15:07:00.000Z" };

const SCRIPT_2_DRAFT = {
  ...SCRIPT_DRAFT,
  id: ROOT_2,
  root_script_id: ROOT_2,
  title: "Inquiries off first",
  body: "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
  parts: [
    { kind: "hook", text: "Every hard pull you did not need is still sitting on your file." },
    { kind: "line2", text: "And lenders count them." }
  ],
  script_format: "sorting",
  style: "words",
  funnel_key: "book_call",
  angle_key: "inquiries-off",
  hook_key: "inquiries-off-hard-pulls",
  offer_key: "funding_dfy",
  lane: "sorting",
  idea_id: null,
  animation_plan: [{ anchor: { phrase: "lenders count them" }, template: "InquiriesOff", props: {}, seconds: 2.5 }],
  meta_copy: {
    primary_text: "Every hard pull you did not need is still on your file. Lenders count them.",
    headline: "Lenders count your pulls",
    description: "Book a call",
    cta_type: "LEARN_MORE"
  },
  repo_path: "marketing/ads/scripts/machine/2026-W42/04-inquiries-off-first.md"
};

/* Shoot Day (X5): a locked script on the open shoot, rolled twice, the second
   take kept; and a second one not rolled yet whose offer has no file-name word
   on file (marketing/ads/NAMING.md names only SLO). Plan fields from
   src/marketing/shoot-plan.mjs planFields() at 150 words a minute. */
const SHOOT_SCRIPT_1 = {
  ...SCRIPT_DRAFT,
  status: "locked",
  ad_id: "91",
  film_order: 1,
  locked_at: "2026-10-12T15:06:00.000Z",
  locked_by: CHRIS,
  updated_at: "2026-10-13T15:30:00.000Z",
  angle_name: "Lenders read two files",
  offer_word: "SLO",
  take_no: 3,
  take_file_name: "SLO Ad 91 — Lenders read two files Take 3.mp4",
  take_name_problem: null,
  last_take_file_name: "SLO Ad 91 — Lenders read two files Take 2.mp4",
  takes: 2,
  got_it: true,
  first_line_only: false,
  teleprompter_text: BODY_V1,
  words: 46,
  read_seconds: 22
};

const SHOOT_SCRIPT_2 = {
  ...SCRIPT_2_DRAFT,
  status: "locked",
  ad_id: "92",
  film_order: 2,
  locked_at: "2026-10-12T15:09:00.000Z",
  locked_by: CHRIS,
  updated_at: "2026-10-13T15:30:00.000Z",
  angle_name: "Inquiries off first",
  offer_word: null,
  take_no: 1,
  take_file_name: null,
  take_name_problem: "The Funding, done-for-you offer has no file-name word yet (like SLO for the roadmap), so the file name is unknown.",
  last_take_file_name: null,
  takes: 0,
  got_it: false,
  first_line_only: false,
  teleprompter_text: "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
  words: 17,
  read_seconds: 8
};

const SCRIPT_REJECTED = {
  ...SCRIPT_2_DRAFT,
  status: "rejected",
  rejected_at: "2026-10-12T15:08:00.000Z",
  rejected_reason: "rejected from the app, no reason given",
  updated_at: "2026-10-12T15:08:00.000Z"
};

const IDEA_NEW = {
  id: IDEA_2,
  source: "chris",
  kind: "script",
  raw_points: "Lenders check the business file too. Show what a clean business file looks like next to a messy one.",
  topic: null,
  script_format: "standard",
  funnel_key: "roadmap_147",
  angle_key: null,
  status: "new",
  script_id: null,
  created_at: "2026-10-12T15:10:00.000Z"
};

const IDEA_WRITTEN = {
  id: IDEA_1,
  source: "chris",
  kind: "script",
  raw_points: "Lenders look at two files. People only ever fix one. Say which one gets read first.",
  topic: "Lenders read two files",
  script_format: "standard",
  funnel_key: "roadmap_147",
  angle_key: "two-files",
  status: "written",
  script_id: ROOT_1,
  created_at: "2026-10-06T19:30:00.000Z"
};

const NEXT_PLAN = {
  release_at: "2026-10-19T14:00:00.000Z",
  week_key: "2026-W43",
  enabled: false,
  total: 21,
  size_rule: "total",
  funnels: [
    { funnel_key: "roadmap_147", spend_7d_cents: 41200, share: 0.79, slots: 17 },
    { funnel_key: "book_call", spend_7d_cents: 11150, share: 0.21, slots: 4 }
  ],
  slots: [
    { n: 1, funnel_key: "roadmap_147", script_format: "standard", style: "bullets", source: "chris_idea", angle_key: null, idea_id: IDEA_2, reason: "Chris's idea from Oct 12." },
    { n: 2, funnel_key: "roadmap_147", script_format: "standard", style: "bullets", source: "follow_money", angle_key: "two-files", idea_id: null, reason: "Lenders read two files spent the most last week ($412.00). New hook and new body." },
    { n: 3, funnel_key: "book_call", script_format: "sorting", style: "words", source: "fresh_angle", angle_key: "rates-rising", idea_id: null, reason: "Rates rising has not run in 30 days." }
  ],
  suggestions: [
    { angle_key: "two-files", name: "Lenders read two files", why: "Most spend and most leads last week.", numbers: { spend_7d_cents: 41200, leads: 9, cpl_cents: 4578 } },
    { angle_key: "inquiries-off", name: "Inquiries off first", why: "Cheapest clicks last week, no leads yet.", numbers: { spend_7d_cents: 11150, leads: 0, cpl_cents: null } },
    { angle_key: "rates-rising", name: "Rates rising", why: "Not run in 30 days.", numbers: { spend_7d_cents: null, leads: null, cpl_cents: null } }
  ],
  unmapped_spend_cents: 9150,
  overrides: null
};

const BATCH_RELEASED = {
  id: BATCH_WEEKLY,
  kind: "weekly",
  week_key: "2026-W42",
  status: "released",
  release_at: RELEASE,
  released_at: "2026-10-12T14:00:12.000Z",
  counts: { total: 21, ready: 20, flagged: 2, failed: 1 },
  error: null
};

const BATCH_WRITING = {
  id: BATCH_NOW,
  kind: "on_command",
  week_key: "2026-W42",
  status: "writing",
  release_at: "2026-10-13T16:20:00.000Z",
  released_at: null,
  counts: { total: 3, ready: 1, flagged: 0, failed: 0 },
  error: null
};

const AD_ROW_91 = {
  ad_number: "91",
  title: "Lenders read two files",
  funnel_key: "roadmap_147",
  script_format: "standard",
  angle_key: "two-files",
  spend_cents: 41200,
  impressions: 38150,
  ctr: 0.0118,
  hook_rate: 0.312,
  hold_25: 0.184,
  thruplay_rate: 0.071,
  leads: 9,
  booked: 3,
  showed: 2,
  sales: 0,
  close_rate: 0,
  roadmaps: 2,
  cash_cents: 29400,
  reported_cash_cents: null,
  cpl_cents: 4578,
  cost_per_booked_cents: 13733,
  roas: 0.71,
  maturing: true
};

const AD_ROW_92 = {
  ad_number: "92",
  title: "Inquiries off first",
  funnel_key: "book_call",
  script_format: "sorting",
  angle_key: "inquiries-off",
  spend_cents: 11150,
  impressions: 9020,
  ctr: 0.0094,
  hook_rate: 0.27,
  hold_25: 0.122,
  thruplay_rate: 0.04,
  leads: 0,
  booked: 0,
  showed: 0,
  sales: 0,
  close_rate: null,
  roadmaps: 0,
  cash_cents: 0,
  reported_cash_cents: null,
  cpl_cents: null,
  cost_per_booked_cents: null,
  roas: 0,
  maturing: true
};

const VIDEO_WAITING = {
  id: VIDEO_1,
  version: 1,
  ad_id: "91",
  angle: "Lenders read two files",
  funnel_key: "roadmap_147",
  state: "awaiting_approval",
  state_word: "Ready to approve",
  since: "2026-10-13T19:40:00.000Z",
  master_duration_seconds: 58.4,
  submagic_minutes: 1.2,
  can_approve: true
};

const VIDEO_APPROVED = { ...VIDEO_WAITING, state: "approved", state_word: "Approved", since: "2026-10-13T20:01:00.000Z", can_approve: false };
const VIDEO_REJECTED = { ...VIDEO_WAITING, state: "rejected", state_word: "Rejected", since: "2026-10-13T20:01:00.000Z", can_approve: false };
const VIDEO_RECUTTING = { ...VIDEO_WAITING, version: 2, state: "cut", state_word: "Being cut", since: "2026-10-13T20:01:00.000Z", can_approve: false };
const VIDEO_HELD_CHOSEN = { ...VIDEO_WAITING, state: "cut", state_word: "Being cut", since: "2026-10-13T20:01:00.000Z", can_approve: false };
const VIDEO_RETRYING = {
  ...VIDEO_WAITING,
  id: VIDEO_2,
  ad_id: "92",
  angle: "Inquiries off first",
  funnel_key: "book_call",
  state: "editing",
  state_word: "Captions",
  since: "2026-10-13T20:01:00.000Z",
  submagic_minutes: null,
  can_approve: false
};
const VIDEO_ASSIGNED = {
  ...VIDEO_RETRYING,
  id: VIDEO_4,
  ad_id: "92",
  state: "matched",
  state_word: "Matched",
  master_duration_seconds: null
};

const SUGGESTION_NEW = {
  id: SUGGESTION_1,
  batch_id: BATCH_WEEKLY,
  page: "/roadmap",
  problem: "3 in 4 visitors leave before the video starts.",
  numbers: { page_views: 1210, played_video: 302, play_rate: 0.25 },
  new_words: "See what a lender sees in your two files. Press play.",
  status: "new",
  change: null,
  created_at: "2026-10-12T14:00:20.000Z",
  updated_at: "2026-10-12T14:00:20.000Z"
};

const CHANGE_REQUESTED = {
  id: CHANGE_1,
  request_path: "ops/page-requests/2026-10-12-roadmap.md",
  draft_url: null,
  status: "requested",
  error: null
};

/* ------------------------------------------------------------------------ */
/* Errors every route can answer                                            */
/* ------------------------------------------------------------------------ */

/** @type {ReadonlyArray<ErrorCase>} */
export const COMMON_ERRORS = deepFreeze([
  { status: 400, error: "invalid", field: "request_id", when: "a write with no request_id, or one already used by another org or another route" },
  { status: 401, error: "unauthorized", when: "no session (the shared sign-in check answers this; it carries no message)" },
  { status: 403, error: "forbidden", when: "signed in, but the role is not owner or admin (ROLE_SETS.MARKETING)" },
  { status: 405, error: "method_not_allowed", when: "the wrong method; the Allow header names the right one" },
  { status: 503, error: "db_unavailable", when: "the database is not answering (the shared dbDown shape, with db:'down')" }
]);

/* Rates that must be decimals 0..1 or null (the global rule). roas is cash
   divided by spend: also a decimal, null on a zero or unknown spend, but it can
   be above 1. video_play_curve is Meta's own list of percents, not ours. */
export const RATE_KEYS = Object.freeze([
  "ctr", "hook_rate", "hold_25", "thruplay_rate", "close_rate", "share",
  "click_to_page", "page_to_lead", "play_rate"
]);

const GATE = "ROLE_SETS.MARKETING (owner, admin)";
const GATE_SWITCH = "ROLE_SETS.MARKETING (owner, admin), then staff id in MARKETING_AD_SWITCH_STAFF_IDS";

/* ------------------------------------------------------------------------ */
/* The routes                                                               */
/* ------------------------------------------------------------------------ */

/** @type {Readonly<Record<string, RouteContract>>} */
export const CONTRACT = deepFreeze({
  /* ---------------- U03: settings and funnels (spec §6 step 3) ---------------- */

  "GET marketing/settings": {
    owner: "U03",
    spec: "§6 step 3, §8.3 Settings",
    method: "GET",
    path: "marketing/settings",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: ["settings", ...under("settings.", SETTINGS_KEYS)],
    errors: [],
    example: { request: {}, response: { settings: SETTINGS } }
  },

  "POST marketing/settings": {
    owner: "U03",
    spec: "§6 step 3, §8.3 Settings",
    method: "POST",
    path: "marketing/settings",
    gate: GATE,
    success: 200,
    guard: "updated_at",
    requestKeys: ["request_id", "updated_at", "patch"],
    responseKeys: ["settings", ...under("settings.", SETTINGS_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "updated_at", when: "updated_at is missing" },
      { status: 400, error: "invalid", field: "<the patch key>", when: "an unknown key, or a bad value (enum, weekday 0-6, HH:MM time, positive whole number); field names the key inside patch" },
      { status: 409, error: "stale", when: "updated_at is older than the saved row; current is the saved settings object" }
    ],
    example: {
      request: { request_id: REQ("001"), updated_at: "2026-10-12T15:00:00.000Z", patch: { batch_time: "06:30" } },
      response: { settings: { ...SETTINGS, batch_time: "06:30", updated_at: "2026-10-12T15:01:00.000Z", updated_by: CHRIS } }
    }
  },

  "GET marketing/funnels": {
    owner: "U03",
    spec: "§6 step 3, §8.3 Settings",
    method: "GET",
    path: "marketing/funnels",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      "funnels[]", ...under("funnels[].", FUNNEL_KEYS),
      "campaigns[]", ...under("campaigns[].", ["external_id", "name", "status", "spend_7d_cents", "funnel_key"]),
      "ad_sets[]", ...under("ad_sets[].", ["external_id", "name", "status", "campaign_external_id"]),
      "as_of"
    ],
    errors: [],
    example: {
      request: {},
      response: {
        funnels: [FUNNEL_BOOK_CALL, FUNNEL_ROADMAP_147],
        campaigns: [
          { external_id: "120210000000000001", name: "Roadmap ads (example)", status: "ACTIVE", spend_7d_cents: 41200, funnel_key: null },
          { external_id: "120210000000000002", name: "Book a call ads (example)", status: "PAUSED", spend_7d_cents: null, funnel_key: null }
        ],
        ad_sets: [
          { external_id: "120210000000000101", name: "Roadmap broad (example)", status: "ACTIVE", campaign_external_id: "120210000000000001" },
          { external_id: "120210000000000102", name: "Book a call broad (example)", status: "PAUSED", campaign_external_id: "120210000000000002" }
        ],
        as_of: META_SYNC
      }
    }
  },

  "POST marketing/funnels": {
    owner: "U03",
    spec: "§6 step 3, §8.3 Settings",
    method: "POST",
    path: "marketing/funnels",
    gate: GATE,
    success: 200,
    guard: "updated_at",
    requestKeys: ["request_id", "funnel", "funnel.key", "funnel.updated_at?"],
    responseKeys: ["funnel", ...under("funnel.", FUNNEL_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "funnel.key", when: "key is missing or not lower-case letters, digits and _" },
      { status: 400, error: "invalid", field: "funnel.<key>", when: "an unknown field, or a bad value (lane not an ad lane, a landing_url that is not https, a negative weight)" },
      { status: 409, error: "stale", when: "updated_at is older than the saved funnel; current is the saved funnel" }
    ],
    example: {
      request: {
        request_id: REQ("002"),
        funnel: { key: "roadmap_147", meta_campaign_ids: ["120210000000000001"], default_ad_set_external_id: "120210000000000101", updated_at: "2026-10-06T18:00:00.000Z" }
      },
      response: { funnel: FUNNEL_ROADMAP_MAPPED }
    }
  },

  /* ---------------- U25: core script actions (spec §7.8, §7.9) ---------------- */

  "GET marketing/scripts": {
    owner: "U25",
    spec: "§7.8",
    method: "GET",
    path: "marketing/scripts",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["status?", "batch?"],
    responseKeys: ["scripts[]", ...under("scripts[].", [...SCRIPT_KEYS]), "as_of"],
    errors: [
      { status: 400, error: "invalid", field: "status", when: "status is not draft, locked, rejected, filmed, superseded or expired" },
      { status: 400, error: "invalid", field: "batch", when: "batch is not a uuid" }
    ],
    example: { request: { status: "draft" }, response: { scripts: [SCRIPT_DRAFT, SCRIPT_2_DRAFT], as_of: ANSWERED } }
  },

  "GET marketing/script": {
    owner: "U25",
    spec: "§7.8",
    method: "GET",
    path: "marketing/script",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["id"],
    responseKeys: ["script", ...under("script.", [...SCRIPT_KEYS]), "versions[]", ...under("versions[].", [...SCRIPT_KEYS])],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "id is missing or not a uuid" },
      { status: 404, error: "not_found", when: "no script with that id in the caller's org" }
    ],
    example: { request: { id: SCRIPT_1_V2 }, response: { script: SCRIPT_EDITED, versions: [SCRIPT_EDITED, SCRIPT_V1_SUPERSEDED] } }
  },

  "POST marketing/scripts/approve": {
    owner: "U25",
    spec: "§7.8, §7.4, §4 trap 17",
    method: "POST",
    path: "marketing/scripts/approve",
    gate: GATE,
    success: 200,
    guard: "version",
    requestKeys: ["request_id", "id", "version"],
    responseKeys: ["script", ...under("script.", [...SCRIPT_KEYS]), "ad_number", "registry", "registry_note"],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "id is not a uuid, or the script is rejected or expired" },
      { status: 404, error: "not_found", when: "no script with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the live version; current is {version, body, parts} of the live one" }
    ],
    example: {
      request: { request_id: REQ("003"), id: ROOT_1, version: 1 },
      response: { script: SCRIPT_LOCKED, ad_number: "91", registry: "queued", registry_note: null }
    }
  },

  "POST marketing/scripts/edit": {
    owner: "U25",
    spec: "§7.8, §7.2, §4 trap 9",
    method: "POST",
    path: "marketing/scripts/edit",
    gate: GATE,
    success: 200,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "body", "parts?", "meta_copy?"],
    responseKeys: ["script", ...under("script.", [...SCRIPT_KEYS]), "warnings[]", "warnings[].rule", "warnings[].message"],
    errors: [
      { status: 400, error: "invalid", field: "body", when: "body is missing or empty" },
      { status: 400, error: "invalid", field: "parts", when: "parts is not a list of {kind, text} with kind hook, line2, body, cue, reveal or cta" },
      { status: 404, error: "not_found", when: "no script with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the live version; current is {version, body, parts} of the live one" }
    ],
    example: {
      request: { request_id: REQ("004"), id: ROOT_1, version: 1, body: BODY_V2, parts: PARTS_V2 },
      response: {
        script: SCRIPT_EDITED,
        warnings: [{ rule: "your number", message: "Chris's rules (Part 0) ban \"your number\". Saved anyway, because a person wrote it." }]
      }
    }
  },

  "POST marketing/scripts/reject": {
    owner: "U25",
    spec: "§7.8, §4 trap 17",
    method: "POST",
    path: "marketing/scripts/reject",
    gate: GATE,
    success: 200,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "reason?"],
    responseKeys: ["script", ...under("script.", [...SCRIPT_KEYS])],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "id is not a uuid, or the script is not a draft" },
      { status: 404, error: "not_found", when: "no script with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the live version; current is {version, body, parts} of the live one" }
    ],
    example: { request: { request_id: REQ("005"), id: ROOT_2, version: 1 }, response: { script: SCRIPT_REJECTED } }
  },

  "POST marketing/scripts/order": {
    owner: "U25",
    spec: "§7.8, §8.2",
    method: "POST",
    path: "marketing/scripts/order",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "order[]"],
    responseKeys: ["ok"],
    errors: [
      { status: 400, error: "invalid", field: "order", when: "order is not a list of uuids, or names a root_script_id the caller's org does not have" }
    ],
    example: { request: { request_id: REQ("006"), order: [ROOT_2, ROOT_1] }, response: { ok: true } }
  },

  /* ---------------- U26: the rest of §7.8, plus jobs/retry ---------------- */

  "POST marketing/scripts/fix": {
    owner: "U26",
    spec: "§7.8",
    method: "POST",
    path: "marketing/scripts/fix",
    gate: GATE,
    success: 202,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "note", "make_rule"],
    responseKeys: ["queued", "job_id"],
    errors: [
      { status: 400, error: "invalid", field: "note", when: "note is missing or empty" },
      { status: 400, error: "invalid", field: "make_rule", when: "make_rule is not true or false" },
      { status: 404, error: "not_found", when: "no script with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the live version; current is {version, body, parts} of the live one" }
    ],
    example: {
      request: { request_id: REQ("007"), id: ROOT_1, version: 1, note: "Make the hook about the business file, not the personal one.", make_rule: false },
      response: { queued: true, job_id: JOB_5 }
    }
  },

  "POST marketing/ideas": {
    owner: "U26",
    spec: "§7.8, §7.5 step 7, §8.1 tab 4",
    method: "POST",
    path: "marketing/ideas",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "raw_points", "source?", "script_format?", "funnel_key?", "angle_key?", "write_now?"],
    responseKeys: ["idea", ...under("idea.", IDEA_KEYS), "batch_id?", "job_id?"],
    errors: [
      { status: 400, error: "invalid", field: "raw_points", when: "raw_points is missing or empty" },
      { status: 400, error: "invalid", field: "source", when: "source is not 'chris' or 'suggestion' (the machine never posts here)" },
      { status: 400, error: "invalid", field: "script_format", when: "not standard, sorting, long, notes, greenscreen or vsl" },
      { status: 400, error: "invalid", field: "funnel_key", when: "no funnel with that key in the caller's org" }
    ],
    example: {
      request: { request_id: REQ("008"), raw_points: IDEA_NEW.raw_points, script_format: "standard", funnel_key: "roadmap_147", write_now: true },
      response: { idea: IDEA_NEW, batch_id: BATCH_NOW, job_id: JOB_2 }
    }
  },

  "GET marketing/ideas": {
    owner: "U26",
    spec: "§7.8, §8.1 tab 4",
    method: "GET",
    path: "marketing/ideas",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["status?"],
    responseKeys: ["ideas[]", ...under("ideas[].", IDEA_KEYS)],
    errors: [{ status: 400, error: "invalid", field: "status", when: "status is not new, writing, written, failed or dropped" }],
    example: { request: {}, response: { ideas: [IDEA_NEW, IDEA_WRITTEN] } }
  },

  "GET marketing/batches": {
    owner: "U26",
    spec: "§7.8, §7.4",
    method: "GET",
    path: "marketing/batches",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: ["batches[]", ...under("batches[].", BATCH_KEYS), ...under("batches[].counts.", COUNT_KEYS), "write_now_ready"],
    errors: [],
    example: { request: {}, response: { batches: [BATCH_WRITING, BATCH_RELEASED], write_now_ready: true } }
  },

  "POST marketing/batches/write-now": {
    owner: "U26",
    spec: "§7.8, §2 item 1, §7.7",
    method: "POST",
    path: "marketing/batches/write-now",
    gate: GATE,
    success: 202,
    guard: null,
    requestKeys: ["request_id", "count?", "funnel_key?", "idea_ids?"],
    responseKeys: ["queued", "batch_id", "job_id"],
    errors: [
      { status: 400, error: "invalid", field: "count", when: "count is not a whole number of 1 or more" },
      { status: 400, error: "invalid", field: "funnel_key", when: "no funnel with that key in the caller's org" },
      { status: 400, error: "invalid", field: "idea_ids", when: "not a list of idea ids of the caller's org" },
      { status: 400, error: "cap_reached", when: "this batch or this month's model-bill cap is reached (costStatus); nothing is queued" }
    ],
    example: { request: { request_id: REQ("009"), count: 3 }, response: { queued: true, batch_id: BATCH_NOW, job_id: JOB_2 } }
  },

  "GET marketing/rules": {
    owner: "U26",
    spec: "§7.8, §7.1, §8.1 tab 5",
    method: "GET",
    path: "marketing/rules",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      "rules_sha", "part0[]", "part0[].n", "part0[].text", "banned[]",
      "recent[]", ...under("recent[].", ["op_id", "action", "text", "state", "committed_sha", "at"])
    ],
    errors: [],
    example: {
      request: {},
      response: {
        rules_sha: SHA_RULES,
        part0: [
          { n: 0, text: "Chris's word beats every rule below. These rules guide the writer, and they are never read so literally that they block what Chris asked for." },
          { n: 1, text: "Never write \"credit repair.\" Say \"credit optimization\" or \"optimize your credit.\"" },
          { n: 2, text: "Never say \"your number\" or \"the number.\" Spell it out, for example: \"how much we think you'll qualify for based on where you're at right now.\"" }
        ],
        banned: ["game changer"],
        recent: [
          { op_id: OP_2, action: "ban", text: "game changer", state: "waiting", committed_sha: null, at: "2026-10-12T15:12:00.000Z" },
          { op_id: OP_1, action: "add", text: "Say \"review your file the way a lender does.\"", state: "committed", committed_sha: SHA_RULES, at: "2026-10-11T22:40:00.000Z" }
        ]
      }
    }
  },

  "POST marketing/rules": {
    owner: "U26",
    spec: "§7.8, §7.1, §8.1 tab 5",
    method: "POST",
    path: "marketing/rules",
    gate: GATE,
    success: 202,
    guard: null,
    requestKeys: ["request_id", "action", "n?", "text"],
    responseKeys: ["queued", "op_id"],
    errors: [
      { status: 400, error: "invalid", field: "action", when: "action is not add, edit or ban" },
      { status: 400, error: "invalid", field: "n", when: "edit without n, or an n that Part 0 does not have" },
      { status: 400, error: "invalid", field: "text", when: "text is missing or empty" }
    ],
    example: { request: { request_id: REQ("010"), action: "ban", text: "game changer" }, response: { queued: true, op_id: OP_2 } }
  },

  "POST marketing/jobs/retry": {
    owner: "U26",
    spec: "§8.3 (stuck work with Retry); plan critique M5",
    method: "POST",
    path: "marketing/jobs/retry",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "job_id"],
    responseKeys: ["ok", "job", "job.id", "job.kind", "job.status"],
    errors: [
      { status: 400, error: "invalid", field: "job_id", when: "the job is not failed" },
      { status: 404, error: "not_found", when: "no such job, another org's job, or a kind not in JOB_KINDS (never 'offer')" }
    ],
    example: { request: { request_id: REQ("011"), job_id: JOB_1 }, response: { ok: true, job: { id: JOB_1, kind: "write_slot", status: "queued" } } }
  },

  /* ---------------- U23: the next batch plan (spec §7.5) ---------------- */

  "GET marketing/batches/next": {
    owner: "U23",
    spec: "§7.5, §7.8",
    method: "GET",
    path: "marketing/batches/next",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: NEXT_KEYS,
    errors: [],
    example: { request: {}, response: { next: NEXT_PLAN, saved: { batch_id: BATCH_WEEKLY, status: "planned" }, as_of: META_SYNC } }
  },

  "POST marketing/batches/next": {
    owner: "U23",
    spec: "§7.5, §7.8",
    method: "POST",
    path: "marketing/batches/next",
    gate: GATE,
    success: 200,
    guard: "updated_at",
    requestKeys: ["request_id", "updated_at", "overrides"],
    responseKeys: NEXT_KEYS,
    errors: [
      { status: 400, error: "invalid", field: "overrides", when: "overrides is not an object (send {} to clear them)" },
      { status: 409, error: "stale", when: "updated_at is older than marketing_settings.updated_at; current is {updated_at, overrides}" }
    ],
    example: {
      request: { request_id: REQ("012"), updated_at: "2026-10-12T15:01:00.000Z", overrides: {} },
      response: { next: NEXT_PLAN, saved: null, as_of: META_SYNC }
    }
  },

  /* ---------------- U22: health card (spec §6 step 4, §8.3) ---------------- */

  "GET marketing/health": {
    owner: "U22",
    spec: "§6 step 4, §8.3",
    method: "GET",
    path: "marketing/health",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      "clock", "clock.last_tick_at", "clock.enabled",
      "worker", "worker.last_run_at", "worker.queued", "worker.running", "worker.failed_24h[]",
      ...under("worker.failed_24h[].", ["kind", "error", "at"]),
      "outbox", ...under("outbox.", ["waiting", "oldest_waiting_at", "last_commit_sha", "last_commit_at", "last_error", "token_present", "held_reason"]),
      "sync", "sync.last_sync_at",
      "model", ...under("model.", ["month_cost_usd", "max_month_cost_usd", "last_batch_cost_usd", "max_batch_cost_usd"]),
      "as_of"
    ],
    errors: [],
    example: {
      request: {},
      response: {
        clock: { last_tick_at: "2026-10-12T15:00:03.000Z", enabled: false },
        worker: {
          last_run_at: "2026-10-12T15:00:05.000Z",
          queued: 0,
          running: 0,
          failed_24h: [{ kind: "write_slot", error: "The writer stopped: the model took longer than 5 minutes.", at: "2026-10-12T12:40:00.000Z" }]
        },
        outbox: {
          waiting: 2,
          oldest_waiting_at: "2026-10-12T15:06:00.000Z",
          last_commit_sha: null,
          last_commit_at: null,
          last_error: null,
          token_present: false,
          held_reason: "no_token"
        },
        sync: { last_sync_at: META_SYNC },
        model: { month_cost_usd: 12.48, max_month_cost_usd: 300, last_batch_cost_usd: 9.7, max_batch_cost_usd: 40 },
        as_of: ANSWERED
      }
    }
  },

  /* ---------------- U32: Today additions, angles, funnel stats (spec §8.3, §11.2) ---------------- */

  "GET marketing/today": {
    owner: "U32",
    spec: "§8.3, §11.2; existing keys: docs/specs/marketing-today-contract.md",
    method: "GET",
    path: "marketing/today",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      // Existing keys (never renamed; their inner shape is in marketing-today-contract.md).
      "ok", "as_of", "today", "timezone", "waiting", "flywheel", "copy", "copy_ready", "spend", "last_sync",
      // Added by U32.
      "numbers", "numbers.today", "numbers.d7", "numbers.d30",
      ...under("numbers.today.", NUMBER_KEYS), ...under("numbers.d7.", NUMBER_KEYS), ...under("numbers.d30.", NUMBER_KEYS),
      "daily[]", ...under("daily[].", ["date", "spend_cents", "leads"]),
      "spend_by_funnel[]", ...under("spend_by_funnel[].", ["funnel_key", "name", "spend_cents"]),
      "flow", ...under("flow.", ["page_views", "clicks", "leads", "booked", "showed", "sales"]),
      "scripts_waiting", "scripts_waiting.ready", "scripts_waiting.flagged",
      "stuck_jobs[]", ...under("stuck_jobs[].", ["id", "kind", "error", "since"])
    ],
    errors: [],
    example: {
      request: {},
      response: {
        ok: true,
        as_of: ANSWERED,
        today: "2026-10-12",
        timezone: "America/Phoenix",
        waiting: [],
        flywheel: { campaigns: [] },
        copy: { partner_id: "00000000-0000-4000-8000-000000000003", pieces: [], jobs: [] },
        copy_ready: { ready: true, partner_id: "00000000-0000-4000-8000-000000000003", checks: [], missing: [] },
        spend: {
          currency: "USD",
          windows: {
            today: { from: "2026-10-12", to: "2026-10-12", days: 1, spend_cents: null, ad_days: 0, days_with_data: 0 },
            last_7_days: { from: "2026-10-06", to: "2026-10-12", days: 7, spend_cents: 61500, ad_days: 18, days_with_data: 6 },
            prior_7_days: { from: "2026-09-29", to: "2026-10-05", days: 7, spend_cents: 48200, ad_days: 14, days_with_data: 7 },
            last_30_days: { from: "2026-09-13", to: "2026-10-12", days: 30, spend_cents: 203400, ad_days: 61, days_with_data: 27 }
          }
        },
        last_sync: { meta_synced_at: META_SYNC, metrics_synced_at: "2026-10-12T07:01:51.000Z", latest_metrics_date: "2026-10-11" },
        numbers: {
          today: { spend_cents: null, leads: 2, booked: 1, showed: 0, sales: 0, roadmaps: 0, cash_cents: 0, reported_cash_cents: null, roas: null },
          d7: { spend_cents: 61500, leads: 23, booked: 7, showed: 5, sales: 1, roadmaps: 4, cash_cents: 158800, reported_cash_cents: 100000, roas: 2.58 },
          d30: { spend_cents: 203400, leads: 61, booked: 19, showed: 13, sales: 3, roadmaps: 9, cash_cents: 432300, reported_cash_cents: 300000, roas: 2.13 }
        },
        daily: [
          { date: "2026-10-09", spend_cents: 8800, leads: 3 },
          { date: "2026-10-10", spend_cents: 9150, leads: 4 },
          { date: "2026-10-11", spend_cents: 8730, leads: 2 }
        ],
        spend_by_funnel: [
          { funnel_key: "roadmap_147", name: "Roadmap $147", spend_cents: 41200 },
          { funnel_key: "book_call", name: "Book a call", spend_cents: 11150 },
          { funnel_key: null, name: "Unmapped", spend_cents: 9150 }
        ],
        flow: { page_views: 1840, clicks: 2210, leads: 23, booked: 7, showed: 5, sales: 1 },
        scripts_waiting: { ready: 18, flagged: 2 },
        stuck_jobs: [{ id: JOB_1, kind: "write_slot", error: "The writer stopped: the model took longer than 5 minutes.", since: "2026-10-12T12:40:00.000Z" }]
      }
    }
  },

  "GET marketing/angles": {
    owner: "U32",
    spec: "§11.2, §11.3",
    method: "GET",
    path: "marketing/angles",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: ["rows[]", ...under("rows[].", ["angle_key", "name", "spend_cents", "ads", "leads", "booked", "sales", "cash_cents", "roas"]), "as_of"],
    errors: [],
    example: {
      request: {},
      response: {
        rows: [
          { angle_key: "two-files", name: "Lenders read two files", spend_cents: 41200, ads: 1, leads: 9, booked: 3, sales: 0, cash_cents: 29400, roas: 0.71 },
          { angle_key: "inquiries-off", name: "Inquiries off first", spend_cents: 11150, ads: 1, leads: 0, booked: 0, sales: 0, cash_cents: 0, roas: 0 }
        ],
        as_of: META_SYNC
      }
    }
  },

  "GET marketing/funnels/stats": {
    owner: "U32",
    spec: "§11.2, §11.1",
    method: "GET",
    path: "marketing/funnels/stats",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      "rows[]",
      ...under("rows[].", ["funnel_key", "name", "spend_cents", "page_views", "click_to_page", "page_to_lead", "leads", "booked", "showed", "sales", "cash_cents", "roas"]),
      "unmapped_spend_cents", "as_of"
    ],
    errors: [],
    example: {
      request: {},
      response: {
        rows: [
          { funnel_key: "roadmap_147", name: "Roadmap $147", spend_cents: 41200, page_views: 1210, click_to_page: 0.82, page_to_lead: 0.0124, leads: 15, booked: 4, showed: 3, sales: 0, cash_cents: 58800, roas: 1.43 },
          { funnel_key: "book_call", name: "Book a call", spend_cents: 11150, page_views: 630, click_to_page: 0.79, page_to_lead: 0.0127, leads: 8, booked: 3, showed: 2, sales: 1, cash_cents: 100000, roas: 8.97 }
        ],
        unmapped_spend_cents: 9150,
        as_of: META_SYNC
      }
    }
  },

  /* ---------------- U31: ads and one ad (spec §11.2) ---------------- */

  "GET marketing/ads": {
    owner: "U31",
    spec: "§11.2, §11.1, §11.3",
    method: "GET",
    path: "marketing/ads",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["from?", "to?", "funnel?", "format?", "angle?"],
    responseKeys: [
      "rows[]", ...under("rows[].", AD_ROW_KEYS),
      "unmapped[]", ...under("unmapped[].", ["campaign_external_id", "name", "spend_cents"]),
      "as_of"
    ],
    errors: [
      { status: 400, error: "invalid", field: "from", when: "from is not YYYY-MM-DD, or is after to" },
      { status: 400, error: "invalid", field: "to", when: "to is not YYYY-MM-DD" }
    ],
    example: {
      request: { from: "2026-09-13", to: "2026-10-12" },
      response: {
        rows: [AD_ROW_91, AD_ROW_92],
        unmapped: [{ campaign_external_id: "120210000000000003", name: "Retargeting (example)", spend_cents: 9150 }],
        as_of: META_SYNC
      }
    }
  },

  "GET marketing/ad": {
    owner: "U31",
    spec: "§11.2, §11.3",
    method: "GET",
    path: "marketing/ad",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["n"],
    responseKeys: [
      "ad", ...under("ad.", AD_ROW_KEYS),
      "ad.meta_ads[]", ...under("ad.meta_ads[].", ["id", "external_id", "name", "status", "ad_set_external_id"]),
      "ad.curve[]", "ad.curve[].date", "ad.curve[].video_play_curve",
      "ad.watch", "ad.watch.alerts[]", "ad.watch.diagnoses[]",
      "as_of"
    ],
    errors: [
      { status: 400, error: "invalid", field: "n", when: "n is missing or not digits" },
      { status: 404, error: "not_found", when: "the caller's org has no ad with that number" }
    ],
    example: {
      request: { n: "91" },
      response: {
        ad: {
          ...AD_ROW_91,
          meta_ads: [{ id: AD_ROW_1, external_id: "120210000000000201", name: "SLO Ad 91 — Lenders read two files", status: "PAUSED", ad_set_external_id: "120210000000000101" }],
          curve: [{ date: "2026-10-10", video_play_curve: [100, 64, 47, 39, 34, 31, 28, 26, 24, 22, 21, 20, 19, 18, 17, 15, 12, 10, 8, 6, 5, 4] }],
          watch: {
            alerts: [],
            diagnoses: [{ date: "2026-10-10", diagnosis: "opening", fix_type: "words", film_note: "Most plays stop before the quarter mark. Film a new first line, same body.", next_take_improved: null }]
          }
        },
        as_of: META_SYNC
      }
    }
  },

  /* ---------------- U28: load into Meta, paused (spec §10.5) ---------------- */

  "POST marketing/meta/load": {
    owner: "U28",
    spec: "§10.2-10.5",
    method: "POST",
    path: "marketing/meta/load",
    gate: GATE,
    success: 202,
    guard: null,
    requestKeys: ["request_id", "ad_video_id?", "all?"],
    requestOneOf: [["ad_video_id", "all"]],
    responseKeys: ["queued", "jobs[]", ...under("jobs[].", ["ad_number", "ad_video_id", "job_id"])],
    errors: [
      { status: 400, error: "invalid", field: "ad_video_id", when: "neither ad_video_id nor all:true was sent, or ad_video_id is not a uuid" },
      { status: 404, error: "not_found", when: "no ad video with that id in the caller's org" }
    ],
    example: {
      request: { request_id: REQ("013"), all: true },
      response: {
        queued: true,
        jobs: [
          { ad_number: "91", ad_video_id: VIDEO_1, job_id: JOB_3 },
          { ad_number: "92", ad_video_id: VIDEO_2, job_id: JOB_4 }
        ]
      }
    }
  },

  "GET marketing/meta/load-status": {
    owner: "U28",
    spec: "§10.5",
    method: "GET",
    path: "marketing/meta/load-status",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      "loads[]",
      ...under("loads[].", [
        "ad_number", "ad_video_id", "state", "reasons[]", "meta_video_id", "meta_creative_id",
        "meta_ad_external_id", "ad_row_id", "ad_status", "ad_set", "campaign"
      ]),
      "loads[].ad_set.external_id", "loads[].ad_set.status",
      "loads[].campaign.external_id", "loads[].campaign.status",
      "as_of"
    ],
    errors: [],
    example: {
      request: {},
      response: {
        loads: [
          {
            ad_number: "91", ad_video_id: VIDEO_1, state: "loaded", reasons: [],
            meta_video_id: "1234567890123456", meta_creative_id: "120210000000000301", meta_ad_external_id: "120210000000000201",
            ad_row_id: AD_ROW_1, ad_status: "PAUSED",
            ad_set: { external_id: "120210000000000101", status: "ACTIVE" },
            campaign: { external_id: "120210000000000001", status: "ACTIVE" }
          },
          {
            ad_number: "92", ad_video_id: VIDEO_2, state: "refused", reasons: ["The final video is not in storage yet."],
            meta_video_id: null, meta_creative_id: null, meta_ad_external_id: null,
            ad_row_id: null, ad_status: null,
            ad_set: { external_id: "120210000000000102", status: "PAUSED" },
            campaign: { external_id: "120210000000000002", status: "PAUSED" }
          }
        ],
        as_of: META_SYNC
      }
    }
  },

  /* ---------------- U15: turn one ad on (spec §10.5) ---------------- */

  "POST campaigns/write#resume_ad": {
    owner: "U15",
    spec: "§10.5 Turn on, §2 item 6",
    method: "POST",
    path: "campaigns/write",
    gate: GATE_SWITCH,
    success: 200,
    guard: null,
    requestKeys: ["action", "ad_id", "request_id"],
    responseKeys: ["ok", "ad", "ad.id", "ad.status"],
    errors: [
      { status: 403, error: "forbidden", when: "the caller is not on MARKETING_AD_SWITCH_STAFF_IDS (unset or empty = nobody)", message: "Only Chris can turn ads on." },
      { status: 404, error: "not_found", when: "ad_id is not one of our ads rows (a campaign id, an ad set id or a Meta id all land here); Meta is never called" },
      { status: 400, error: "platform_error", when: "Meta said no; the ad stays paused (the existing campaigns/write shape: message and reasons)" },
      { status: 400, error: "blocked", when: "the guard (guardedWrite) refused; the ad stays paused (message and reasons)" }
    ],
    example: {
      request: { action: "resume_ad", ad_id: AD_ROW_1, request_id: REQ("014") },
      response: { ok: true, ad: { id: AD_ROW_1, status: "ACTIVE" } }
    }
  },

  /* ---------------- Shoot Day (spec §8.2), built by X5 ---------------- */

  "GET marketing/shoot": {
    owner: "X5",
    spec: "§8.2",
    method: "GET",
    path: "marketing/shoot",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["wpm?"],
    responseKeys: [
      "shoot", ...under("shoot.", SHOOT_KEYS), ...under("shoot.board[].", BOARD_KEYS),
      ...under("shoot.scripts[].", [...SCRIPT_KEYS, ...PLAN_KEYS]),
      "plan_candidates[]", ...under("plan_candidates[].", [...SCRIPT_KEYS, ...PLAN_KEYS]),
      "plan_estimated_minutes", "past_shoots[]", ...under("past_shoots[].", PAST_SHOOT_KEYS),
      "wpm", "as_of"
    ],
    errors: [
      { status: 400, error: "invalid", field: "wpm", when: "wpm is not a whole number from 80 to 260" }
    ],
    example: {
      request: {},
      response: {
        shoot: {
          id: SHOOT_1,
          shoot_date: "2026-10-13",
          status: "filming",
          root_script_ids: [ROOT_1, ROOT_2],
          marks: { [ROOT_1]: { takes: 2, got_it: true, at: "2026-10-13T16:05:00.000Z" } },
          estimated_minutes: 5,
          board: [{ ad_id: "91", angle: "Lenders read two files", step: "filmed", step_word: "Filmed", since: "2026-10-13T16:05:00.000Z", reason: null, can_retry: false, needs_you: false }],
          landed_unmatched: 0,
          scripts: [SHOOT_SCRIPT_1, SHOOT_SCRIPT_2],
          started_at: "2026-10-13T15:58:00.000Z",
          finished_at: null,
          created_at: "2026-10-13T15:30:00.000Z",
          updated_at: "2026-10-13T16:05:00.000Z"
        },
        plan_candidates: [SHOOT_SCRIPT_2],
        plan_estimated_minutes: 3,
        past_shoots: [{ id: "00000000-0000-4000-8000-000000000900", shoot_date: "2026-10-06", scripts: 4, filmed: 4, finished_at: "2026-10-06T19:12:00.000Z" }],
        wpm: 150,
        as_of: "2026-10-13T16:06:00.000Z"
      }
    }
  },

  "POST marketing/shoot": {
    owner: "X5",
    spec: "§8.2",
    method: "POST",
    path: "marketing/shoot",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "id?", "shoot_date?", "root_script_ids?", "status?", "wpm?"],
    responseKeys: ["shoot", ...under("shoot.", SHOOT_KEYS), ...under("shoot.scripts[].", [...SCRIPT_KEYS, ...PLAN_KEYS])],
    errors: [
      { status: 400, error: "invalid", field: "root_script_ids", when: "not a list of root ids of approved scripts (locked, or filmed and needing a retake) in the caller's org; a script already on the shoot stays allowed on a reorder" },
      { status: 400, error: "invalid", field: "status", when: "status is not planned, filming, uploaded or done; or a create sends anything but planned" },
      { status: 400, error: "invalid", field: "shoot_date", when: "shoot_date is not a real day written YYYY-MM-DD" },
      { status: 400, error: "invalid", field: "id", when: "a create while a shoot is already open, or a change to a closed (done) shoot" },
      { status: 404, error: "not_found", when: "id names no shoot in the caller's org" }
    ],
    example: {
      request: { request_id: REQ("015"), shoot_date: "2026-10-13", root_script_ids: [ROOT_1, ROOT_2] },
      response: {
        shoot: {
          id: SHOOT_1,
          shoot_date: "2026-10-13",
          status: "planned",
          root_script_ids: [ROOT_1, ROOT_2],
          marks: {},
          estimated_minutes: 5,
          board: [],
          landed_unmatched: 0,
          scripts: [
            { ...SHOOT_SCRIPT_1, take_no: 1, take_file_name: "SLO Ad 91 — Lenders read two files Take 1.mp4", last_take_file_name: null, takes: 0, got_it: false },
            SHOOT_SCRIPT_2
          ],
          started_at: null,
          finished_at: null,
          created_at: "2026-10-13T15:30:00.000Z",
          updated_at: "2026-10-13T15:30:00.000Z"
        }
      }
    }
  },

  "POST marketing/shoot/mark": {
    owner: "X5",
    spec: "§8.2",
    method: "POST",
    path: "marketing/shoot/mark",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "shoot_id", "root_script_id", "mark"],
    responseKeys: ["marks"],
    errors: [
      { status: 400, error: "invalid", field: "mark", when: "mark is not got_it or another_take" },
      { status: 400, error: "invalid", field: "shoot_id", when: "shoot_id is not a uuid, or the shoot is closed (done)" },
      { status: 404, error: "not_found", when: "no such shoot, or the script is not on it" }
    ],
    example: {
      request: { request_id: REQ("016"), shoot_id: SHOOT_1, root_script_id: ROOT_2, mark: "got_it" },
      response: {
        marks: {
          [ROOT_1]: { takes: 2, got_it: true, at: "2026-10-13T16:05:00.000Z" },
          [ROOT_2]: { takes: 1, got_it: true, at: "2026-10-13T16:09:00.000Z" }
        }
      }
    }
  },

  /* ---------------- DEFERRED: videos (spec §9.1 route table, §9.6) ---------------- */

  "GET marketing/videos": {
    owner: "deferred",
    spec: "§9.1, §9.6",
    method: "GET",
    path: "marketing/videos",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: ["videos[]", ...under("videos[].", VIDEO_KEYS), "counts", "counts.to_approve", "counts.on_hold", "counts.being_cut"],
    errors: [],
    example: { request: {}, response: { videos: [VIDEO_WAITING], counts: { to_approve: 1, on_hold: 0, being_cut: 0 } } }
  },

  "GET marketing/video": {
    owner: "deferred",
    spec: "§9.1, §9.6",
    method: "GET",
    path: "marketing/video",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["id"],
    responseKeys: [
      "video", ...under("video.", VIDEO_KEYS), "signed_url",
      "lines[]", "lines[].text", "lines[].state", "lines[].heard",
      "caption_mismatches[]", "caption_mismatches[].heard", "caption_mismatches[].script",
      "animations[]", "takes[]", "edits[]"
    ],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "id is missing or not a uuid" },
      { status: 404, error: "not_found", when: "no video with that id in the caller's org" }
    ],
    example: {
      request: { id: VIDEO_1 },
      response: {
        video: VIDEO_WAITING,
        signed_url: "https://media.example.invalid/partners/house/ad-video/final/91-r1.mp4?signature=example",
        lines: [
          { text: "MOST lenders read TWO files before they say yes.", state: "kept", heard: null },
          { text: "If one is a mess, they never open the other.", state: "said_differently", heard: "If one is a mess they never even open the other." }
        ],
        caption_mismatches: [{ heard: "fundable", script: "fundability" }],
        animations: [{ anchor: { cue: 1, keyword: "personal" }, template: "FileItems", seconds: 2.5 }],
        takes: [
          { id: VIDEO_1, take_no: 1, recorded_at: "2026-10-13T16:02:00.000Z", state: "awaiting_approval" },
          { id: VIDEO_3, take_no: 2, recorded_at: "2026-10-13T16:04:00.000Z", state: "merged" }
        ],
        edits: []
      }
    }
  },

  "POST marketing/videos/approve": {
    owner: "deferred",
    spec: "§9.1, §9.6, §4 trap 17",
    method: "POST",
    path: "marketing/videos/approve",
    gate: GATE,
    success: 200,
    guard: "version",
    requestKeys: ["request_id", "id", "version"],
    responseKeys: ["video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "the video is not waiting for approval" },
      { status: 404, error: "not_found", when: "no video with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the current edit round; current is {version, state}" }
    ],
    example: { request: { request_id: REQ("017"), id: VIDEO_1, version: 1 }, response: { video: VIDEO_APPROVED } }
  },

  "POST marketing/videos/reject": {
    owner: "deferred",
    spec: "§9.1, §9.6, §4 trap 17",
    method: "POST",
    path: "marketing/videos/reject",
    gate: GATE,
    success: 200,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "reason?"],
    responseKeys: ["video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 404, error: "not_found", when: "no video with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the current edit round; current is {version, state}" }
    ],
    example: { request: { request_id: REQ("018"), id: VIDEO_1, version: 1, reason: "The hook was rushed." }, response: { video: VIDEO_REJECTED } }
  },

  "POST marketing/videos/edit": {
    owner: "deferred",
    spec: "§9.6",
    method: "POST",
    path: "marketing/videos/edit",
    gate: GATE,
    success: 202,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "kind", "lines?", "word_from?", "word_to?", "animation?", "text?"],
    responseKeys: ["queued", "job_id", "video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "kind", when: "kind is not strike, restore, caption, animation or note" },
      { status: 404, error: "not_found", when: "no video with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the current edit round; current is {version, state}" }
    ],
    example: {
      request: { request_id: REQ("019"), id: VIDEO_1, version: 1, kind: "strike", lines: [2] },
      response: { queued: true, job_id: JOB_3, video: VIDEO_RECUTTING }
    }
  },

  "POST marketing/videos/hold-choice": {
    owner: "deferred",
    spec: "§9.1 step 7",
    method: "POST",
    path: "marketing/videos/hold-choice",
    gate: GATE,
    success: 200,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "choice"],
    responseKeys: ["video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "choice", when: "choice is not use_cut or refilm" },
      { status: 404, error: "not_found", when: "no held video with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the current edit round; current is {version, state}" }
    ],
    example: { request: { request_id: REQ("020"), id: VIDEO_1, version: 1, choice: "use_cut" }, response: { video: VIDEO_HELD_CHOSEN } }
  },

  "POST marketing/videos/recut": {
    owner: "deferred",
    spec: "§9.1 step 6",
    method: "POST",
    path: "marketing/videos/recut",
    gate: GATE,
    success: 202,
    guard: "version",
    requestKeys: ["request_id", "id", "version", "take_id"],
    responseKeys: ["queued", "job_id", "video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "take_id", when: "take_id is not a late take of the same ad" },
      { status: 404, error: "not_found", when: "no video with that id in the caller's org" },
      { status: 409, error: "stale", when: "version is not the current edit round; current is {version, state}" }
    ],
    example: {
      request: { request_id: REQ("021"), id: VIDEO_1, version: 1, take_id: VIDEO_3 },
      response: { queued: true, job_id: JOB_3, video: VIDEO_RECUTTING }
    }
  },

  "POST marketing/videos/retry": {
    owner: "deferred",
    spec: "§9.1 (failed -> last_good_status)",
    method: "POST",
    path: "marketing/videos/retry",
    gate: GATE,
    success: 202,
    guard: null,
    requestKeys: ["request_id", "id"],
    responseKeys: ["queued", "job_id", "video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "the video is not failed" },
      { status: 404, error: "not_found", when: "no video with that id in the caller's org" }
    ],
    example: { request: { request_id: REQ("022"), id: VIDEO_2 }, response: { queued: true, job_id: JOB_4, video: VIDEO_RETRYING } }
  },

  "POST marketing/videos/assign": {
    owner: "deferred",
    spec: "§9.1 step 5 (unmatched takes)",
    method: "POST",
    path: "marketing/videos/assign",
    gate: GATE,
    success: 202,
    guard: null,
    requestKeys: ["request_id", "id", "script_id"],
    responseKeys: ["queued", "job_id", "video", ...under("video.", VIDEO_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "script_id", when: "script_id is not a locked or filmed script of the caller's org" },
      { status: 404, error: "not_found", when: "no unmatched take with that id in the caller's org" }
    ],
    example: { request: { request_id: REQ("023"), id: VIDEO_4, script_id: ROOT_2 }, response: { queued: true, job_id: JOB_4, video: VIDEO_ASSIGNED } }
  },

  /* ---------------- DEFERRED: brain map (spec §13) ---------------- */

  "GET marketing/map": {
    owner: "deferred",
    spec: "§13",
    method: "GET",
    path: "marketing/map",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: [
      "nodes[]", ...under("nodes[].", ["id", "type", "label", "spend_cents", "links"]),
      "edges[]", ...under("edges[].", ["from", "to", "kind"]),
      "as_of"
    ],
    errors: [],
    example: {
      request: {},
      response: {
        nodes: [
          { id: "funnel:roadmap_147", type: "funnel", label: "Roadmap $147", spend_cents: 41200, links: { drive: null, meta: null, repo: null } },
          { id: "angle:two-files", type: "angle", label: "Lenders read two files", spend_cents: 41200, links: { drive: null, meta: null, repo: "marketing/ads/angles.json" } },
          { id: "ad:91", type: "ad", label: "Ad 91", spend_cents: 41200, links: { drive: null, meta: null, repo: "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md" } }
        ],
        edges: [
          { from: "ad:91", to: "funnel:roadmap_147", kind: "ad_funnel" },
          { from: "ad:91", to: "angle:two-files", kind: "ad_angle" }
        ],
        as_of: META_SYNC
      }
    }
  },

  /* ---------------- DEFERRED: page suggestions (spec §14) ---------------- */

  "GET marketing/pages/suggestions": {
    owner: "deferred",
    spec: "§14",
    method: "GET",
    path: "marketing/pages/suggestions",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: [],
    responseKeys: ["suggestions[]", ...under("suggestions[].", SUGGESTION_KEYS), ...under("suggestions[].change.", CHANGE_KEYS)],
    errors: [],
    example: { request: {}, response: { suggestions: [SUGGESTION_NEW] } }
  },

  "POST marketing/pages/choose": {
    owner: "deferred",
    spec: "§14 steps 2-3",
    method: "POST",
    path: "marketing/pages/choose",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "id", "choice"],
    responseKeys: ["suggestion", ...under("suggestion.", SUGGESTION_KEYS), ...under("suggestion.change.", CHANGE_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "choice", when: "choice is not draft or skip" },
      { status: 404, error: "not_found", when: "no suggestion with that id in the caller's org" }
    ],
    example: {
      request: { request_id: REQ("024"), id: SUGGESTION_1, choice: "draft" },
      response: { suggestion: { ...SUGGESTION_NEW, status: "drafted", change: CHANGE_REQUESTED, updated_at: "2026-10-12T15:20:00.000Z" } }
    }
  },

  "POST marketing/pages/fix-it": {
    owner: "deferred",
    spec: "§14 step 3",
    method: "POST",
    path: "marketing/pages/fix-it",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "id"],
    responseKeys: ["suggestion", ...under("suggestion.", SUGGESTION_KEYS), ...under("suggestion.change.", CHANGE_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "the change is not drafted yet" },
      { status: 404, error: "not_found", when: "no suggestion with that id in the caller's org" }
    ],
    example: {
      request: { request_id: REQ("025"), id: SUGGESTION_1 },
      response: {
        suggestion: {
          ...SUGGESTION_NEW,
          status: "drafted",
          change: { ...CHANGE_REQUESTED, draft_url: "https://claude.ai/artifact/example", status: "fixing" },
          updated_at: "2026-10-13T15:00:00.000Z"
        }
      }
    }
  },

  "POST marketing/pages/push-live": {
    owner: "deferred",
    spec: "§14 step 3",
    method: "POST",
    path: "marketing/pages/push-live",
    gate: GATE,
    success: 200,
    guard: null,
    requestKeys: ["request_id", "id"],
    responseKeys: ["suggestion", ...under("suggestion.", SUGGESTION_KEYS), ...under("suggestion.change.", CHANGE_KEYS)],
    errors: [
      { status: 400, error: "invalid", field: "id", when: "the change is not fixed yet" },
      { status: 404, error: "not_found", when: "no suggestion with that id in the caller's org" }
    ],
    example: {
      request: { request_id: REQ("026"), id: SUGGESTION_1 },
      response: {
        suggestion: {
          ...SUGGESTION_NEW,
          status: "fixed",
          change: { ...CHANGE_REQUESTED, draft_url: "https://claude.ai/artifact/example", status: "pushing" },
          updated_at: "2026-10-13T16:00:00.000Z"
        }
      }
    }
  }
});

/* ------------------------------------------------------------------------ */
/* Checking a body against the contract                                     */
/* ------------------------------------------------------------------------ */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} value
 * @param {string[]} segs
 * @param {number} i
 * @param {string} prefix
 * @param {boolean} optional
 * @param {Set<string>} out
 */
function walk(value, segs, i, prefix, optional, out) {
  if (value === null || value === undefined) return; // null = unknown; nothing under it to check
  if (!isPlainObject(value)) {
    out.add(prefix.slice(0, -1) + " (not an object)");
    return;
  }
  const seg = segs[i];
  const isList = seg.endsWith("[]");
  const name = isList ? seg.slice(0, -2) : seg;
  const here = prefix + name;
  const last = i === segs.length - 1;
  if (!Object.prototype.hasOwnProperty.call(value, name)) {
    if (!(optional && last)) out.add(here + (isList ? "[]" : ""));
    return;
  }
  const child = value[name];
  if (isList) {
    if (child === null || child === undefined) return;
    if (!Array.isArray(child)) {
      out.add(here + " (not a list)");
      return;
    }
    if (last) return;
    for (const item of child) walk(item, segs, i + 1, here + "[].", optional, out);
    return;
  }
  if (last) return;
  walk(child, segs, i + 1, here + ".", optional, out);
}

/**
 * The key paths in `paths` that `body` does not have. Extra keys are fine.
 * @param {ReadonlyArray<string>} paths
 * @param {unknown} body
 * @returns {string[]}
 */
export function missingKeys(paths, body) {
  if (!isPlainObject(body)) return ["(the body is not an object)"];
  /** @type {Set<string>} */
  const out = new Set();
  for (const raw of paths) {
    const optional = raw.endsWith("?");
    const path = optional ? raw.slice(0, -1) : raw;
    walk(body, path.split("."), 0, "", optional, out);
  }
  return [...out];
}

/** @param {string} routeKey @returns {RouteContract} */
function routeOf(routeKey) {
  const entry = Object.prototype.hasOwnProperty.call(CONTRACT, routeKey) ? CONTRACT[routeKey] : undefined;
  if (!entry) throw new Error(`api-contract: no route "${routeKey}" in the contract`);
  return entry;
}

/**
 * Throws when a success body is missing any key the contract names for that
 * route. The message lists every missing key. Extra keys are allowed.
 * @param {string} routeKey like "GET marketing/settings"
 * @param {unknown} body the parsed JSON answer
 */
export function assertMatchesContract(routeKey, body) {
  const missing = missingKeys(routeOf(routeKey).responseKeys, body);
  if (missing.length) throw new Error(`${routeKey}: response is missing ${missing.join(", ")}`);
}

/**
 * Throws when a request (the JSON body of a POST, the query of a GET) is
 * missing a key the contract requires, or sends none of a one-of group.
 * @param {string} routeKey
 * @param {unknown} request
 */
export function assertRequestMatchesContract(routeKey, request) {
  const entry = routeOf(routeKey);
  const missing = missingKeys(entry.requestKeys, request);
  if (isPlainObject(request)) {
    for (const group of entry.requestOneOf || []) {
      if (!group.some((k) => request[k] !== undefined)) missing.push(`one of ${group.join(" / ")}`);
    }
  }
  if (missing.length) throw new Error(`${routeKey}: request is missing ${missing.join(", ")}`);
}

/**
 * A fresh copy of a route's example answer, safe to change (for mocks).
 * @param {string} routeKey
 */
export function exampleResponse(routeKey) {
  return structuredClone(routeOf(routeKey).example.response);
}

/* Names the doc uses for an object whose keys are listed whole elsewhere. */
export const SHAPE_ABBREVIATIONS = Object.freeze({ S: SCRIPT_KEYS });

/**
 * @typedef {{list:boolean, optional:boolean, children:Map<string, ShapeNode>}} ShapeNode
 */

/**
 * The one-line shape the doc prints for a list of key paths, for example
 * ["settings", "settings.org_id"] -> "{settings:{org_id}}". An object whose
 * keys are exactly the Script object's prints as "S".
 * @param {ReadonlyArray<string>} paths
 * @returns {string}
 */
export function describeShape(paths) {
  /** @type {Map<string, ShapeNode>} */
  const root = new Map();
  for (const raw of paths) {
    const optional = raw.endsWith("?");
    const segs = (optional ? raw.slice(0, -1) : raw).split(".");
    let level = root;
    segs.forEach((seg, i) => {
      const list = seg.endsWith("[]");
      const name = list ? seg.slice(0, -2) : seg;
      let node = level.get(name);
      if (!node) {
        node = { list, optional: false, children: new Map() };
        level.set(name, node);
      }
      if (list) node.list = true;
      if (optional && i === segs.length - 1) node.optional = true;
      level = node.children;
    });
  }
  /** @param {Map<string, ShapeNode>} level @returns {string} */
  const render = (level) => {
    const names = [...level.keys()];
    for (const [abbr, keys] of Object.entries(SHAPE_ABBREVIATIONS)) {
      const flat = [...level.values()].every((n) => !n.children.size && !n.optional && !n.list);
      if (flat && names.length === keys.length && names.every((k, i) => k === keys[i])) return abbr;
    }
    return "{" + [...level].map(([name, node]) => {
      const key = name + (node.optional ? "?" : "");
      const inner = node.children.size ? render(node.children) : "";
      if (node.list) return `${key}:[${inner}]`;
      return inner ? `${key}:${inner}` : key;
    }).join(", ") + "}";
  };
  return render(root);
}
