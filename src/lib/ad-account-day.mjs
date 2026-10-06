// The day a Meta row belongs to.
//
// ad_metrics_daily.date is Meta's date_start, and Meta cuts its days in the AD
// ACCOUNT's own time zone. Measured 2026-10-05 with one read-only GET of
// act_<META_AD_ACCOUNT_ID>?fields=timezone_name: "America/Phoenix" (UTC-7, no
// daylight time).
//
// The database clock is UTC, so CURRENT_DATE runs one day ahead of Meta's day
// from 5pm to midnight Arizona time. A report that asks for "yesterday" or "the
// last 7 days" with CURRENT_DATE is wrong for those seven hours every day.
// Measured 2026-10-05 at 5:45pm Arizona: "spend yesterday" read 0.00 (true:
// 120.18), and 7-day spend read 523.79 (true: 606.53).
//
// One ad account today. A partner whose account lives in another zone will need
// this read per connection — no column holds the zone yet.
export { phoenixDay as adAccountDay } from "../slo/visitor.mjs";

export const AD_ACCOUNT_TZ = "America/Phoenix";

/** Today in the ad account's zone, as a SQL date. Use it, never CURRENT_DATE,
    wherever ad_metrics_daily.date is compared with "today". */
export const AD_TODAY_SQL = `(now() AT TIME ZONE '${AD_ACCOUNT_TZ}')::date`;
