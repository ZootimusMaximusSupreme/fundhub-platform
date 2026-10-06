// Fixtures for src/marketing/planner.test.mjs: one made-up company "room" the planner
// reads. Every number here is invented to show the shape; none is a live number.
//
// NOW is Wednesday 2026-10-14, 12:00 pm Arizona (19:00 UTC). The 7-day spend window is
// Oct 8 to Oct 14; the 30-day window starts Sep 15. The next Monday 7:00 am Arizona
// drop is 2026-10-19T14:00:00Z, ISO week 2026-W43.

export const NOW = "2026-10-14T19:00:00.000Z";
export const TODAY = "2026-10-14";
export const NEXT_RELEASE = "2026-10-19T14:00:00.000Z";
export const NEXT_WEEK = "2026-W43";

/** angles.json, in file order. */
export const ANGLES = Object.freeze([
  { key: "two_files", name: "Lenders read two files" },
  { key: "rates_rising", name: "Rates rising" },
  { key: "inquiries_off", name: "Inquiries off first" },
  { key: "bank_said_no", name: "Bank turned you down" },
  { key: "speed", name: "Speed" },
  { key: "the_guarantee", name: "The Guarantee" },
  { key: "the_sorting_hat", name: "The Sorting Hat" },
  { key: "conveyor_belt", name: "The Conveyor Belt" }
]);

export const FUNNELS = Object.freeze([
  { key: "roadmap_147", name: "Roadmap $147", active: true, weight: 1, format_mix: { standard: 1 }, book_call: false },
  { key: "book_call", name: "Book a call", active: true, weight: 1, format_mix: { standard: 2, sorting: 1 }, book_call: true }
]);

export const SETTINGS = Object.freeze({
  scripts_per_day: 3,
  days_per_batch: 7,
  size_rule: "total",
  format_style: { standard: "bullets", sorting: "words", long: "words", notes: "bullets", greenscreen: "bullets", vsl: "bullets" },
  winner_rule: null,
  batch_weekday: 1,
  batch_time: "07:00",
  timezone: "America/Phoenix"
});

/**
 * Last week, as the data layer hands it over (one row per ads row):
 *   ad 91  script says roadmap_147 + two_files                 $412.00
 *   ad 92  no script; its campaign is on book_call; spine angle  $111.50
 *          inquiries_off
 *   ad 93  script says book_call, campaign is on roadmap_147    $50.00  (script wins)
 *   (no number) campaign on no funnel                           $91.50  (Unmapped)
 *   ad 80  ran Sep 2 with angle rates_rising, nothing since      (no 7-day spend)
 */
export const AD_ROWS = Object.freeze([
  { ad_row_id: "a91", ad_number: "91", script_funnel_key: "roadmap_147", script_angle_key: "two_files", spine_angle_key: null, campaign_funnel_key: null, spend_7d_cents: 41200, ad_days_7d: 7, last_spend_day: "2026-10-14" },
  { ad_row_id: "a92", ad_number: "92", script_funnel_key: null, script_angle_key: null, spine_angle_key: "inquiries_off", campaign_funnel_key: "book_call", spend_7d_cents: 11150, ad_days_7d: 5, last_spend_day: "2026-10-13" },
  { ad_row_id: "a93", ad_number: "93", script_funnel_key: "book_call", script_angle_key: "speed", spine_angle_key: null, campaign_funnel_key: "roadmap_147", spend_7d_cents: 5000, ad_days_7d: 2, last_spend_day: "2026-10-12" },
  { ad_row_id: "axx", ad_number: null, script_funnel_key: null, script_angle_key: null, spine_angle_key: null, campaign_funnel_key: null, spend_7d_cents: 9150, ad_days_7d: 3, last_spend_day: "2026-10-12" },
  { ad_row_id: "a80", ad_number: "80", script_funnel_key: null, script_angle_key: "rates_rising", spine_angle_key: null, campaign_funnel_key: null, spend_7d_cents: null, ad_days_7d: 0, last_spend_day: "2026-09-02" }
]);

/** Leads last week, by ad number. */
export const LEAD_ROWS = Object.freeze([
  { ad_number: "91", leads: 9 },
  { ad_number: "93", leads: 2 }
]);

export const SCRIPT_LABELS = Object.freeze([
  { ad_number: "91", funnel_key: "roadmap_147", angle_key: "two_files" },
  { ad_number: "93", funnel_key: "book_call", angle_key: "speed" }
]);

/** The base room: copy it and change one thing per test. */
export function room(extra = {}) {
  return {
    now: NOW,
    settings: { ...SETTINGS },
    funnels: FUNNELS.map((f) => ({ ...f, format_mix: { ...f.format_mix } })),
    ad_rows: AD_ROWS.map((r) => ({ ...r })),
    lead_rows: LEAD_ROWS.map((r) => ({ ...r })),
    script_labels: SCRIPT_LABELS.map((r) => ({ ...r })),
    recent_angles: [],
    angles: ANGLES.map((a) => ({ ...a })),
    ideas: [],
    competitors: [],
    overrides: null,
    on_command: null,
    ...extra
  };
}

/** A room where nothing spent in the last 7 days. */
export function quietRoom(extra = {}) {
  return room({ ad_rows: [], lead_rows: [], script_labels: [], ...extra });
}
