// Lead flow tripwires for the morning pulse. Read only.
//
// Three questions a paying customer would feel the answer to:
//   lead:pipe-cut-with-traffic            Ads sent plenty of people, and no real lead was saved.
//   lead:clickfunnels-posts-silent        People opened a ClickFunnels form, and ClickFunnels sent us nothing.
//   lead:slo-contact-not-in-clickfunnels  A roadmap lead never reached the list Paul works from.
//
// Rules this file keeps:
//   - SELECT only, through ctx.scope (staff) when the pulse hands one over.
//     ad_metrics_daily is a row-security table: the plain app role reads it as
//     EMPTY (measured 2026-10-09: 0 rows plain, 12 rows as staff).
//   - ctx.db is a shared pool. This file never sends BEGIN, COMMIT or SET on it.
//   - No web call, no send, no vendor write. No repo file is read at run time.
//   - A read that does not come back is `skip` with the reason, never PASS.
//   - PASS means the pipe was PROVEN by a real row. Too little traffic to judge
//     is `skip`, not PASS (same call as gap-pixels.mjs "ads paused is a skip").
//   - No email, phone or name is ever put in a detail line.
//
// What "real" means here (the plan said "non-demo"; the data said that is not enough):
//   - Not a demo row (is_demo = false).
//   - Not an agent or a test. slo.contact_started and funnel.page carry
//     payload.actor ("person" or "agent", set by src/slo/visitor.mjs when the row
//     was saved). entry.captured and survey.submitted come from ClickFunnels and
//     carry no actor, so they are judged by the same email rule that file uses:
//     fundhub.ai and example.* addresses, and a local part that says e2e, sim or
//     test, are tests. Measured 2026-10-09: 45 of the last 126 entry.captured rows
//     were example.com, and 15 of 18 slo.contact_started rows were agents.
//   - A name that starts a word with "test" or "e2e" is a test too ("Test Test"
//     passed as a person on 2026-09-29).
//   - Counted as PEOPLE (distinct email), never as event rows. One ClickFunnels
//     post writes 2 entry.captured rows, and 142 gmail rows were 2 emails.
//
// webhook_captures.org_id is NULL on all 4451 rows (measured 2026-10-09), so that
// table is never filtered by org. An org filter there would read zero rows and
// cry wolf every morning.
//
// Where a check differs from the plan in
// ops/workflows/heartbeat-complete-2026-10-09-worklist.md, the reason is next to
// the code and in ops/workflows/heartbeat-gaps-2026-10-08/leads.md.
//
// Nothing to judge (owner law 2026-10-09: a live thing is never "not checked").
// Three skips are a measured "too quiet to judge", and now return status "na"
// with na: { code, args } so the audit can prove the claim again:
//   lead:pipe-cut-with-traffic            low-traffic  (ads sent fewer than MIN_AD_CLICKS)
//   lead:clickfunnels-posts-silent        low-traffic  (fewer than MIN_FORM_PAGE_VIEWS opened a form page)
//   lead:slo-contact-not-in-clickfunnels  no-real-lead (no real roadmap lead in the window)
// `naVerify` re-reads with the same SQL and the same minimums. Every other quiet
// reason (no ad row at all, receipts off, a read that failed, a lead still waiting)
// stays "skip": "we cannot see it" is never a nothing-to-judge condition.

import { AD_ACCOUNT_TZ, adAccountDay } from "../../lib/ad-account-day.mjs";

export const CHECK_IDS = Object.freeze([
  "lead:pipe-cut-with-traffic",
  "lead:clickfunnels-posts-silent",
  "lead:slo-contact-not-in-clickfunnels"
]);

/**
 * How many Meta link clicks it takes to bring one person who types an email on /roadmap.
 * Measured 2026-10-09: 3 real emails typed across 361 link clicks over the 9 ad days (1 in 120).
 */
export const USUAL_CLICKS_PER_LEAD = 120;

/**
 * Zero leads only means something when a healthy funnel would have brought this many.
 * At 3 expected leads a healthy funnel still saves nobody about 5 times in 100 (e to the minus 3).
 * At 15 clicks (the first draft) a healthy funnel saved nobody about 9 times in 10.
 */
export const MIN_EXPECTED_LEADS = 3;

/** Meta link clicks over the two closed Arizona days before "no lead" means anything: 360. */
export const MIN_AD_CLICKS = USUAL_CLICKS_PER_LEAD * MIN_EXPECTED_LEADS;

/**
 * Real people who opened /roadmap in the window before /roadmap counts as the page the ads feed.
 * Measured 2026-10-09: ads land on /roadmap (about 144 of 210 person page views since 09-26).
 * Below this, a lead from another door is proof enough; at or above it, the /roadmap step-1
 * save has to show a lead of its own, so a live /apply form cannot hide a dead /roadmap save.
 */
export const ROADMAP_DOOR_VIEWS = 20;

/** Real people on a ClickFunnels form page, same window. A starting number. */
export const MIN_FORM_PAGE_VIEWS = 20;

/**
 * Pages whose forms ClickFunnels posts from (src/funnel/pages.mjs, docs/tracking/page-inventory.md):
 * the apply survey and the two calendars. /roadmap is a sales page whose checkout posts to OUR
 * API, so a quiet ClickFunnels there is normal (22 and 24 real /roadmap views on 10-03 and 10-04,
 * no break), and /home posts to /api/public/survey-submit.
 *
 * Why ad clicks and /roadmap views are NOT a trigger for lead:clickfunnels-posts-silent: a
 * ClickFunnels post only follows a typed email or a form, and 361 ad clicks over 9 days brought 3
 * emails. Replayed read-only, an ad-click trigger went red on 4 mornings with nothing broken.
 */
export const CF_FORM_PAGES = Object.freeze(["/apply", "/funding-book-call", "/roadmap-book"]);

/** A roadmap lead is judged for this many days back. */
export const CONTACT_WINDOW_DAYS = 3;

/** A lead whose ClickFunnels answer is still missing after this long is called lost, not slow. */
export const NOTE_GRACE_MINUTES = 30;

/**
 * When the step-1 copy to ClickFunnels (and its cf_contact note) went live.
 * The copy was committed 2026-10-01 23:20 Arizona (c7d41f95, "not live"). The first ship after
 * it is 2026-10-02 00:26 Arizona (ops/ship-log.md), which is 07:26 UTC. The first note on any
 * row is 2026-10-02 22:43 UTC. A real lead saved before this has no note because there was no
 * copy to note. A real lead saved after it with no note is a copy we cannot account for: the
 * function host can freeze before the ClickFunnels call finishes (api/public/slo-interest.mjs,
 * CF_WAIT_MS), and then nothing is written.
 */
export const CF_COPY_GO_LIVE = "2026-10-02T07:30:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;

const BANS = "Report only. Do not auto-fix. Do not POST to ClickFunnels. Do not send a test lead.";

/** ClickFunnels' own words for an email it already holds ("Email address has already been taken"). */
const TAKEN = /email.*already (?:been )?taken/i;

/**
 * A real person, as SQL on events `e`. $1 is the org (or null for all).
 * Mirrors classifyVisitor in src/slo/visitor.mjs for rows that carry no actor,
 * plus the name rule. The caller adds the event name and the window.
 */
const REAL_PERSON = `
  COALESCE(e.is_demo, false) = false
  AND ($1::uuid IS NULL OR e.org_id = $1::uuid)
  AND CASE
        WHEN (e.payload->>'actor') IS NOT NULL THEN (e.payload->>'actor') = 'person'
        ELSE NOT (
          lower(split_part(COALESCE(e.payload->>'email', ''), '@', 2)) IN ('fundhub.ai', 'example.com', 'example.net', 'example.org')
          OR lower(split_part(COALESCE(e.payload->>'email', ''), '@', 1)) ~ '(^|[.+_-])(e2e|sim|test)([.+_-]|$)'
        )
      END
  AND lower(COALESCE(e.payload->>'name', '')) !~ '(^|[^a-z0-9])(test|e2e)'`;

/** One person, whatever number of rows they left. A row with no email counts as itself. */
const PERSON_KEY = `COALESCE(NULLIF(lower(e.payload->>'email'), ''), e.id::text)`;

/** One browser session, whatever number of page opens it made. */
const SESSION_KEY = `COALESCE(NULLIF(e.payload->>'session_id', ''), e.id::text)`;

/**
 * One read for the first two checks.
 * $1 org (or null), $2 first closed Arizona day, $3 last closed Arizona day, $4 now,
 * $5 the ClickFunnels form pages.
 * The window opens at midnight Arizona on $2 and closes at $4, so a run for an
 * earlier `now` reads exactly what that morning would have read.
 */
export const FACTS_SQL = `
  /* gap:lead-facts */
  WITH w AS (
    SELECT (($2::date)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}') AS since, $4::timestamptz AS until
  )
  SELECT
    (SELECT count(*)::int
       FROM ad_metrics_daily m
      WHERE ($1::uuid IS NULL OR m.org_id = $1::uuid)
        AND m.date BETWEEN $2::date AND $3::date) AS ad_rows,
    (SELECT COALESCE(sum(COALESCE(m.link_clicks, m.clicks, 0)), 0)::bigint
       FROM ad_metrics_daily m
      WHERE ($1::uuid IS NULL OR m.org_id = $1::uuid)
        AND m.date BETWEEN $2::date AND $3::date) AS ad_clicks,
    (SELECT count(DISTINCT ${PERSON_KEY})::int
       FROM events e, w
      WHERE e.name = 'slo.contact_started'
        AND ${REAL_PERSON}
        AND e.created_at >= w.since AND e.created_at < w.until) AS road_leads,
    (SELECT count(DISTINCT ${PERSON_KEY})::int
       FROM events e, w
      WHERE e.name IN ('entry.captured', 'survey.submitted')
        AND ${REAL_PERSON}
        AND e.created_at >= w.since AND e.created_at < w.until) AS cf_leads,
    (SELECT max(e.created_at)
       FROM events e, w
      WHERE e.name IN ('entry.captured', 'survey.submitted', 'slo.contact_started')
        AND ${REAL_PERSON}
        AND e.created_at < w.until) AS lead_last,
    (SELECT count(DISTINCT ${SESSION_KEY})::int
       FROM events e, w
      WHERE e.name = 'funnel.page'
        AND COALESCE(e.is_demo, false) = false
        AND ($1::uuid IS NULL OR e.org_id = $1::uuid)
        AND (e.payload->>'actor') = 'person'
        AND (e.payload->>'page') = '/roadmap'
        AND e.created_at >= w.since AND e.created_at < w.until) AS road_views,
    (SELECT count(DISTINCT ${SESSION_KEY})::int
       FROM events e, w
      WHERE e.name = 'funnel.page'
        AND COALESCE(e.is_demo, false) = false
        AND ($1::uuid IS NULL OR e.org_id = $1::uuid)
        AND (e.payload->>'actor') = 'person'
        AND (e.payload->>'page') = ANY ($5::text[])
        AND e.created_at >= w.since AND e.created_at < w.until) AS form_views,
    (SELECT count(*)::int
       FROM webhook_captures c, w
      WHERE c.provider = 'clickfunnels'
        AND c.created_at >= w.since AND c.created_at < w.until) AS cf_posts,
    (SELECT max(c.created_at)
       FROM webhook_captures c, w
      WHERE c.provider = 'clickfunnels'
        AND c.created_at < w.until) AS cf_last,
    (SELECT count(*)::int
       FROM webhook_captures c, w
      WHERE c.provider <> 'clickfunnels'
        AND c.created_at >= w.since AND c.created_at < w.until) AS other_posts`;

/**
 * Real roadmap leads in the window, newest first, and whether the same person is
 * in ClickFunnels some other way. $1 org (or null), $2 window start, $3 now.
 *   later_ok  a LATER roadmap save of the same email copied to ClickFunnels fine.
 *   cf_seen   ClickFunnels itself posted this email back to us on or after the lead
 *             (entry.captured with source clickfunnels). That is ClickFunnels proving
 *             it holds the person: on 2026-10-02 it posted contact.created two minutes
 *             after the one refused copy.
 * No email, phone or name is selected.
 */
export const CONTACTS_SQL = `
  /* gap:lead-contacts */
  SELECT e.created_at,
         e.payload->'cf_contact'->>'ok' AS cf_ok,
         e.payload->'cf_contact'->>'error' AS cf_error,
         e.payload->'cf_contact'->>'status' AS cf_status,
         left(e.payload->'cf_contact'->>'message', 120) AS cf_message,
         e.payload->'cf_contact'->>'skipped' AS cf_skipped,
         EXISTS (
           SELECT 1
             FROM events s
            WHERE s.name = 'slo.contact_started'
              AND s.org_id = e.org_id
              AND s.id <> e.id
              AND lower(s.payload->>'email') = lower(e.payload->>'email')
              AND s.created_at > e.created_at
              AND s.created_at < $3::timestamptz
              AND s.payload->'cf_contact'->>'ok' = 'true'
         ) AS later_ok,
         EXISTS (
           SELECT 1
             FROM events c
            WHERE c.name = 'entry.captured'
              AND c.org_id = e.org_id
              AND c.payload->>'source' = 'clickfunnels'
              AND lower(c.payload->>'email') = lower(e.payload->>'email')
              AND c.created_at >= e.created_at
              AND c.created_at < $3::timestamptz
         ) AS cf_seen
    FROM events e
   WHERE e.name = 'slo.contact_started'
     AND COALESCE(e.is_demo, false) = false
     AND ($1::uuid IS NULL OR e.org_id = $1::uuid)
     AND (e.payload->>'actor') = 'person'
     AND e.created_at >= $2::timestamptz
     AND e.created_at < $3::timestamptz
   ORDER BY e.created_at DESC
   LIMIT 300`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** "Nothing to judge today": status na plus the code the audit re-checks. */
function naRow(id, code, args, detail) {
  return { id, status: "na", detail, suggestedFix: null, na: { code, args } };
}

/** The company goes in the args only when the lane read one company, so a re-check reads the same. */
function withOrg(args, orgId) {
  return orgId ? { ...args, orgId: String(orgId) } : args;
}

function clip(v, n = 160) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
}

/** Text from a vendor, with anything that looks like an email address taken out. */
function scrub(v, n) {
  return clip(String(v == null ? "" : v).replace(/\S+@\S+/g, "[email]"), n);
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

function people(n) {
  return plural(n, "person", "people");
}

function morePeople(n) {
  return `${n} more ${n === 1 ? "person" : "people"}`;
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

const STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: AD_ACCOUNT_TZ,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function ago(then, now) {
  const hours = Math.floor((now.getTime() - then.getTime()) / (60 * 60 * 1000));
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

function when(v, now) {
  const d = toDate(v);
  return d ? `${STAMP.format(d)} Arizona (${ago(d, now)})` : "none on record";
}

function addDays(isoDay, n) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nowOf(ctx) {
  const n = ctx && ctx.now != null ? new Date(ctx.now) : new Date();
  return Number.isFinite(n.getTime()) ? n : new Date();
}

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/** The two closed Arizona days the ads are judged on, as dates. */
export function windowDays(now) {
  const today = adAccountDay(now);
  return { first: addDays(today, -2), last: addDays(today, -1) };
}

async function readFacts(run, orgId, now) {
  const { first, last } = windowDays(now);
  const out = await run((tx) =>
    tx.query(FACTS_SQL, [orgId, first, last, now.toISOString(), [...CF_FORM_PAGES]])
  );
  const r = out && out.rows && out.rows[0];
  if (!r) throw new Error("the read came back with no row");
  const facts = {
    adRows: num(r.ad_rows),
    adClicks: num(r.ad_clicks),
    roadLeads: num(r.road_leads),
    cfLeads: num(r.cf_leads),
    leadLast: r.lead_last,
    roadViews: num(r.road_views),
    formViews: num(r.form_views),
    cfPosts: num(r.cf_posts),
    cfLast: r.cf_last,
    otherPosts: num(r.other_posts),
    first,
    last,
    orgId
  };
  for (const key of ["adRows", "adClicks", "roadLeads", "cfLeads", "roadViews", "formViews", "cfPosts", "otherPosts"]) {
    if (facts[key] == null) throw new Error(`the read came back without ${key}`);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// 1. Ads sent plenty of people and no real lead was saved.
//
// What the data can and cannot say: it cannot tell a cut pipe from a funnel that
// converts badly. So this goes red only when a healthy funnel would very likely
// have saved someone (MIN_EXPECTED_LEADS), and it says how many it expected.

const PIPE_FIX =
  "Read events for slo.contact_started, entry.captured and survey.submitted since the first day named. " +
  "If people opened /roadmap and none was saved, GET /api/public/slo-interest must answer 200 and the page must post to it. " +
  "Read webhook_captures where provider is clickfunnels. " +
  "If posts arrived and no lead was saved, read src/adapters/clickfunnels.mjs (mapToCanonical). " +
  "If no post arrived, read lead:clickfunnels-posts-silent. " +
  "If the ads sent clicks and nobody opened a page, the ad link or the page tracker is the cut. " +
  BANS;

export function pipeCheck(f, now) {
  const id = "lead:pipe-cut-with-traffic";
  const door = f.roadViews >= ROADMAP_DOOR_VIEWS;
  const viewed = f.roadViews > 0 ? `${people(f.roadViews)} opened /roadmap` : "the page tracker saw no one open /roadmap";

  if (f.roadLeads > 0) {
    const more = f.cfLeads > 0 ? ` ${morePeople(f.cfLeads)} came through ClickFunnels forms.` : "";
    return row(
      id,
      "PASS",
      `${people(f.roadLeads)} saved on the /roadmap step 1 since ${f.first}, the newest real lead ${when(f.leadLast, now)}.${more} Ads sent ${plural(f.adClicks, "link click")} on ${f.first} and ${f.last}.`
    );
  }
  if (!door && f.cfLeads > 0) {
    return row(
      id,
      "PASS",
      `${people(f.cfLeads)} came through ClickFunnels forms since ${f.first}, the newest real lead ${when(f.leadLast, now)}. Only ${people(f.roadViews)} opened /roadmap, so the ClickFunnels forms are the door.`
    );
  }
  const cfNote = f.cfLeads > 0 ? ` ${people(f.cfLeads)} came through ClickFunnels forms, but none saved on /roadmap.` : "";
  if (f.adRows === 0) {
    return row(
      id,
      "skip",
      `The ad table has no row for ${f.first} or ${f.last}, so we cannot tell if ads sent people. Zero real people saved on /roadmap since ${f.first}.${cfNote}`
    );
  }
  if (f.adClicks < MIN_AD_CLICKS) {
    // Ads did send a measured number of clicks, and it is under the minimum. Nothing to judge.
    return naRow(
      id,
      "low-traffic",
      withOrg({ check: id, clicks: f.adClicks, min: MIN_AD_CLICKS, first: f.first, last: f.last }, f.orgId),
      `Ads sent ${plural(f.adClicks, "link click")} on ${f.first} and ${f.last}. Zero leads only means something at ${MIN_AD_CLICKS} clicks or more. Zero real people saved on /roadmap since ${f.first}.${cfNote} Judged the day ads send ${MIN_AD_CLICKS} clicks.`
    );
  }
  const posts = f.cfPosts > 0
    ? `${plural(f.cfPosts, "ClickFunnels post")} arrived, so look at what we do with them`
    : "no ClickFunnels post arrived";
  const expected = Math.round(f.adClicks / USUAL_CLICKS_PER_LEAD);
  return row(
    id,
    "FAIL",
    `Ads sent ${plural(f.adClicks, "link click")} on ${f.first} and ${f.last}, and ${viewed}. Zero real people were saved on the /roadmap step 1 since ${f.first} (tests and agents do not count). That many clicks should have brought about ${expected}.${cfNote} The last real lead was ${when(f.leadLast, now)}. Since ${f.first}: ${posts}.`,
    PIPE_FIX
  );
}

// ---------------------------------------------------------------------------
// 2. People opened a ClickFunnels form and ClickFunnels sent us nothing.

const POSTS_FIX =
  "Our door at /api/webhooks/clickfunnels answers a post with a bad or missing signature with 401 and keeps no row, so a wrong secret looks exactly like a silent sender. " +
  "Check that CLICKFUNNELS_WEBHOOK_SECRET on Netlify is the secret on the ClickFunnels webhook (names only, never print a value). " +
  "Read the ClickFunnels webhook subscriptions with a GET: each must be active and point at https://fundhub.ai/api/webhooks/clickfunnels. " +
  BANS;

export function postsCheck(f, now) {
  const id = "lead:clickfunnels-posts-silent";
  if (f.cfPosts > 0) {
    return row(
      id,
      "PASS",
      `ClickFunnels sent ${plural(f.cfPosts, "post")} since ${f.first}, the newest ${when(f.cfLast, now)}.`
    );
  }
  if (f.formViews < MIN_FORM_PAGE_VIEWS) {
    return naRow(
      id,
      "low-traffic",
      withOrg({ check: id, views: f.formViews, min: MIN_FORM_PAGE_VIEWS, first: f.first }, f.orgId),
      `Too quiet to expect a post: ${people(f.formViews)} opened a ClickFunnels form page since ${f.first} (needs ${MIN_FORM_PAGE_VIEWS}). Ad clicks do not count, because the ads land on /roadmap and it posts to our own door. ClickFunnels sent zero posts. Judged the day ${MIN_FORM_PAGE_VIEWS} people open a form page.`
    );
  }
  if (f.otherPosts === 0) {
    return row(
      id,
      "skip",
      `ClickFunnels sent zero posts since ${f.first}, but no other sender left a receipt either, so receipts may be switched off. We cannot tell a silent sender from a silent table.`
    );
  }
  return row(
    id,
    "FAIL",
    `ClickFunnels sent us zero posts since ${f.first}, but ${people(f.formViews)} opened a ClickFunnels form page (${CF_FORM_PAGES.join(", ")}). Other senders left ${plural(f.otherPosts, "receipt")}, so receipts are on. The last ClickFunnels post was ${when(f.cfLast, now)}.`,
    POSTS_FIX
  );
}

// ---------------------------------------------------------------------------
// 3. A roadmap lead never reached the ClickFunnels list.

const CONTACT_FIX =
  "Read events.payload->'cf_contact' for slo.contact_started. 401 or 403 means ClickFunnels refused the key. 5xx means ClickFunnels is down. " +
  "held_by_dry_run means ADAPTERS_DRY_RUN is on. no_credentials means CLICKFUNNELS_API_KEY or CLICKFUNNELS_SUBDOMAIN is empty on the server. " +
  "422 means ClickFunnels refused this one contact; read its message. " +
  "A lead with no note at all means the function host froze before the ClickFunnels call finished (CF_WAIT_MS in api/public/slo-interest.mjs). " +
  "src/slo/pull.mjs uses the same call at step 3. " +
  BANS;

/** One short phrase for why a copy to ClickFunnels failed. */
export function reasonOf(r) {
  const error = clip(r.cf_error, 60);
  const status = clip(r.cf_status, 6);
  const message = scrub(r.cf_message, 100);
  if (clip(r.cf_skipped, 60)) {
    return clip(r.cf_skipped, 60) === "no_credentials"
      ? "the ClickFunnels key is not set on the server"
      : `skipped (${clip(r.cf_skipped, 60)})`;
  }
  if (error === "held_by_dry_run") return "held by the dry-run switch (ADAPTERS_DRY_RUN)";
  if (error === "clickfunnels_threw") return "the copy crashed before ClickFunnels answered";
  if (error === "clickfunnels_refused") {
    return `ClickFunnels refused it${status ? ` (${status}${message ? `: ${message}` : ""})` : message ? ` (${message})` : ""}`;
  }
  return error ? `error ${error}` : "no reason recorded";
}

const LOST_REASON = `no ClickFunnels answer was ever recorded, so the copy may not have run (it is over ${NOTE_GRACE_MINUTES} minutes old)`;

/** Sort one roadmap lead into the state the check judges it by. */
export function sortContact(r, now) {
  const at = toDate(r.created_at);
  const seen = r.cf_seen === true || r.cf_seen === "true";
  const later = r.later_ok === true || r.later_ok === "true";
  if (String(r.cf_ok) === "true") return "reached";
  if (String(r.cf_ok) === "false") {
    if (later) return "fixed-later";
    if (seen) return "posted-back";
    if (TAKEN.test(String(r.cf_message || ""))) return "already-there";
    return "refused";
  }
  // No note at all.
  if (at && at.getTime() < Date.parse(CF_COPY_GO_LIVE)) return "before-copy";
  if (seen) return "posted-back";
  if (!at) return "waiting";
  return now.getTime() - at.getTime() > NOTE_GRACE_MINUTES * 60 * 1000 ? "lost" : "waiting";
}

export function contactCheck(rows, now, orgId = null) {
  const id = "lead:slo-contact-not-in-clickfunnels";
  if (rows.length === 0) {
    return naRow(
      id,
      "no-real-lead",
      withOrg({ check: id, days: CONTACT_WINDOW_DAYS }, orgId),
      `No real roadmap lead in the last ${plural(CONTACT_WINDOW_DAYS, "day")}, so there is no copy to ClickFunnels to judge. Judged the day one comes.`
    );
  }
  const sorted = rows.map((r) => ({ r, state: sortContact(r, now) }));
  const judged = sorted.filter((s) => s.state !== "before-copy");
  const count = (state) => judged.filter((s) => s.state === state).length;
  const bad = judged.filter((s) => s.state === "refused" || s.state === "lost");
  const waiting = count("waiting");

  if (bad.length > 0) {
    const counts = new Map();
    for (const s of bad) {
      const why = s.state === "lost" ? LOST_REASON : reasonOf(s.r);
      counts.set(why, (counts.get(why) || 0) + 1);
    }
    const why = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([text, n]) => `${text}${n > 1 ? ` (${n})` : ""}`)
      .join("; ");
    return row(
      id,
      "FAIL",
      `${bad.length} of ${plural(judged.length, "real roadmap lead")} from the last ${plural(CONTACT_WINDOW_DAYS, "day")} did not get into ClickFunnels, the newest ${when(bad[0].r.created_at, now)}. Why: ${why}.`,
      CONTACT_FIX
    );
  }

  const inList = judged.length - waiting;
  if (inList > 0) {
    const notes = [];
    if (count("fixed-later") > 0) {
      notes.push(`${plural(count("fixed-later"), "earlier refusal")} was fixed by a later copy of the same person`);
    }
    const taken = count("already-there");
    const posted = count("posted-back");
    if (taken > 0) {
      notes.push(`${plural(taken, "copy", "copies")} ${taken === 1 ? "was" : "were"} refused because ClickFunnels already holds the email`);
    }
    if (posted > 0) {
      notes.push(`${plural(posted, "lead")} had no good copy, but ClickFunnels posted ${posted === 1 ? "that person" : "those people"} back itself`);
    }
    if (taken + posted > 0) notes.push("Paul has the contact, but the phone, name or prequal amount may be missing");
    if (waiting > 0) notes.push(`${waiting} still waiting for an answer (under ${NOTE_GRACE_MINUTES} minutes old)`);
    return row(
      id,
      "PASS",
      `Of ${plural(judged.length, "real roadmap lead")} from the last ${plural(CONTACT_WINDOW_DAYS, "day")}, ${inList} ${inList === 1 ? "is" : "are"} in ClickFunnels.${notes.length ? ` ${notes.join("; ")}.` : ""}`
    );
  }
  if (judged.length === 0) {
    return row(
      id,
      "skip",
      `${plural(rows.length, "real roadmap lead")} in the last ${plural(CONTACT_WINDOW_DAYS, "day")}, all saved before the ClickFunnels copy went live on ${CF_COPY_GO_LIVE.slice(0, 10)}, so there was no copy to judge.`
    );
  }
  return row(
    id,
    "skip",
    `${plural(judged.length, "real roadmap lead")} in the last ${plural(CONTACT_WINDOW_DAYS, "day")}, saved under ${NOTE_GRACE_MINUTES} minutes ago. The ClickFunnels answer is not due yet.`
  );
}

/** The three params CONTACTS_SQL takes: the company, the window start, now. */
function contactParams(orgId, now) {
  const since = new Date(now.getTime() - CONTACT_WINDOW_DAYS * DAY_MS).toISOString();
  return [orgId, since, now.toISOString()];
}

async function readContacts(run, orgId, now) {
  const out = await run((tx) => tx.query(CONTACTS_SQL, contactParams(orgId, now)));
  return (out && out.rows) || [];
}

/** The company a re-check reads: the one the row carries, else the one the caller has, else all. */
function orgOf(args, ctx) {
  return (args && args.orgId) || (ctx && ctx.orgId) || null;
}

/**
 * The audit calls these to prove a "nothing to judge" row again. Each reads with
 * the same SQL and the same minimum the lane used, and answers true only when the
 * read really shows the quiet condition. No read, a count that is missing, or a
 * row for another check is false. A read that throws is left to throw: the audit
 * counts a throw as false.
 * @param {{ check?: string, orgId?: string }} args
 * @param {{ db?: any, scope?: Function, now?: Date|string|number, orgId?: string }} ctx
 */
export const naVerify = Object.freeze({
  "low-traffic": async (args, ctx = {}) => {
    const check = args && args.check;
    if (check !== CHECK_IDS[0] && check !== CHECK_IDS[1]) return false;
    const run = bind(ctx);
    if (!run) return false;
    const f = await readFacts(run, orgOf(args, ctx), nowOf(ctx));
    if (check === CHECK_IDS[0]) return f.adRows > 0 && f.adClicks < MIN_AD_CLICKS;
    return f.formViews < MIN_FORM_PAGE_VIEWS;
  },
  "no-real-lead": async (args, ctx = {}) => {
    if (!args || args.check !== CHECK_IDS[2]) return false;
    const run = bind(ctx);
    if (!run) return false;
    const out = await run((tx) => tx.query(CONTACTS_SQL, contactParams(orgOf(args, ctx), nowOf(ctx))));
    return Array.isArray(out && out.rows) && out.rows.length === 0;
  }
});

/**
 * Read-only lead flow checks.
 * ctx: { db, scope, now, orgId }. Rows are { id, status, detail, suggestedFix }.
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  const now = nowOf(ctx);
  const orgId = ctx.orgId || null;
  if (!run) {
    return CHECK_IDS.map((id) => row(id, "skip", "no database in this run — lead rows not read"));
  }

  const out = [];

  let facts = null;
  let factsError = "";
  try {
    facts = await readFacts(run, orgId, now);
  } catch (err) {
    factsError = clip(err && err.message, 180);
  }
  if (facts) {
    out.push(pipeCheck(facts, now));
    out.push(postsCheck(facts, now));
  } else {
    out.push(row(CHECK_IDS[0], "skip", `could not read ads, leads and ClickFunnels posts: ${factsError}`));
    out.push(row(CHECK_IDS[1], "skip", `could not read ads, leads and ClickFunnels posts: ${factsError}`));
  }

  try {
    out.push(contactCheck(await readContacts(run, orgId, now), now, orgId));
  } catch (err) {
    out.push(row(CHECK_IDS[2], "skip", `could not read roadmap leads: ${clip(err && err.message, 180)}`));
  }
  return out;
}
