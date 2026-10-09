// Lead flow tripwires.
//
// Two kinds of test live here.
//
// 1. Fakes only: no database, no network, no ClickFunnels call. They prove the
//    words and the yes-or-no logic (pipeCheck, postsCheck, contactCheck).
// 2. "SQL meaning" tests. A fake database cannot prove what the SQL computes,
//    so these run the real FACTS_SQL and CONTACTS_SQL text on a real Postgres.
//    The three tables the SQL reads (events, ad_metrics_daily,
//    webhook_captures) are replaced, inside the one query, by made-up rows in a
//    WITH clause of the same name. The connection is BEGIN READ ONLY and rolls
//    back, and no real table is read. They skip when DATABASE_URL is not set,
//    like every *.pg.test.mjs; with it set they run (CI does).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  CF_COPY_GO_LIVE,
  CF_FORM_PAGES,
  CHECK_IDS,
  CONTACTS_SQL,
  CONTACT_WINDOW_DAYS,
  FACTS_SQL,
  MIN_AD_CLICKS,
  MIN_EXPECTED_LEADS,
  MIN_FORM_PAGE_VIEWS,
  NOTE_GRACE_MINUTES,
  ROADMAP_DOOR_VIEWS,
  USUAL_CLICKS_PER_LEAD,
  contactCheck,
  gapChecks,
  naVerify,
  pipeCheck,
  postsCheck,
  reasonOf,
  sortContact,
  windowDays
} from "./gap-leads.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-leads.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-05T13:00:00Z"); // 6:00 a.m. Arizona, Oct 5
const KEYS = ["detail", "id", "status", "suggestedFix"];

// What pg hands back: counts as strings, times as Dates.
function factsRow(over = {}) {
  return {
    ad_rows: 2,
    ad_clicks: "400",
    road_leads: 0,
    cf_leads: 0,
    lead_last: new Date("2026-10-02T22:45:47Z"),
    road_views: 30,
    form_views: 1,
    cf_posts: 0,
    cf_last: new Date("2026-10-02T22:45:47Z"),
    other_posts: 10,
    ...over
  };
}

function contactRow(over = {}) {
  return {
    created_at: new Date("2026-10-04T20:00:00Z"),
    cf_ok: "true",
    cf_error: null,
    cf_status: null,
    cf_message: null,
    cf_skipped: null,
    later_ok: false,
    cf_seen: false,
    ...over
  };
}

function refused(over = {}) {
  return contactRow({
    cf_ok: "false",
    cf_error: "clickfunnels_refused",
    cf_status: "401",
    cf_message: "Unauthorized: bad api key",
    ...over
  });
}

function taken(over = {}) {
  return refused({
    cf_status: "422",
    cf_message: "Request unprocessable: Email address has already been taken",
    ...over
  });
}

function silent(over = {}) {
  return contactRow({ cf_ok: null, ...over });
}

function scopeFor({ facts = factsRow(), contacts = [], factsError = null, contactsError = null } = {}, seen = []) {
  const tx = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (sql === FACTS_SQL) {
        if (factsError) throw factsError;
        return { rows: [facts] };
      }
      if (sql === CONTACTS_SQL) {
        if (contactsError) throw contactsError;
        return { rows: contacts };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    }
  };
  return async (fn) => fn(tx);
}

function byId(rows) {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

const NA_CODE = {
  "lead:pipe-cut-with-traffic": "low-traffic",
  "lead:clickfunnels-posts-silent": "low-traffic",
  "lead:slo-contact-not-in-clickfunnels": "no-real-lead"
};

function assertShape(r) {
  // A nothing-to-judge row (na) carries one extra key, na: { code, args }. No other row may.
  assert.deepEqual(Object.keys(r).sort(), r.status === "na" ? [...KEYS, "na"].sort() : KEYS);
  assert.ok(CHECK_IDS.includes(r.id));
  assert.ok(["PASS", "FAIL", "skip", "na"].includes(r.status));
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
  assert.doesNotMatch(r.detail, /@/, "no email address in a detail line");
  if (r.status === "na") {
    assert.equal(r.na.code, NA_CODE[r.id]);
    assert.equal(r.na.args.check, r.id);
    assert.match(r.detail, /Judged the day/);
  }
  if (r.status === "FAIL") {
    assert.equal(typeof r.suggestedFix, "string");
    assert.match(r.suggestedFix, /Do not auto-fix/);
    assert.match(r.suggestedFix, /Do not POST to ClickFunnels/);
    assert.match(r.suggestedFix, /Do not send a test lead/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
}

const facts = (over) => {
  const r = factsRow(over);
  const { first, last } = windowDays(NOW);
  return {
    adRows: Number(r.ad_rows),
    adClicks: Number(r.ad_clicks),
    roadLeads: Number(r.road_leads),
    cfLeads: Number(r.cf_leads),
    leadLast: r.lead_last,
    roadViews: Number(r.road_views),
    formViews: Number(r.form_views),
    cfPosts: Number(r.cf_posts),
    cfLast: r.cf_last,
    otherPosts: Number(r.other_posts),
    first,
    last
  };
};

// ---------------------------------------------------------------------------
// Shape, read-only, and the traps that were measured.

test("lead lane: three ids, unique, lead: prefix, not used by any other lane", () => {
  assert.equal(CHECK_IDS.length, 3);
  assert.equal(new Set(CHECK_IDS).size, 3);
  for (const id of CHECK_IDS) assert.match(id, /^lead:[a-z-]+$/);
  for (const file of fs.readdirSync(HERE)) {
    if (!/\.mjs$/.test(file) || file === "gap-leads.mjs" || file === "gap-leads.test.mjs") continue;
    const text = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of CHECK_IDS) assert.ok(!text.includes(id), `${file} already names ${id}`);
  }
});

test("lead lane: the numbers Chris can change, and the reasons they are what they are", () => {
  // Zero leads only means something when a healthy funnel would have saved about 3 people.
  assert.equal(USUAL_CLICKS_PER_LEAD, 120);
  assert.equal(MIN_EXPECTED_LEADS, 3);
  assert.equal(MIN_AD_CLICKS, USUAL_CLICKS_PER_LEAD * MIN_EXPECTED_LEADS);
  assert.equal(MIN_AD_CLICKS, 360);
  // e to the minus 3 is about 5 in 100: that is the false-alarm rate at the edge.
  assert.ok(Math.exp(-MIN_EXPECTED_LEADS) < 0.06);
  assert.equal(ROADMAP_DOOR_VIEWS, 20);
  assert.equal(MIN_FORM_PAGE_VIEWS, 20);
  assert.equal(CONTACT_WINDOW_DAYS, 3);
  assert.equal(NOTE_GRACE_MINUTES, 30);
  assert.deepEqual([...CF_FORM_PAGES], ["/apply", "/funding-book-call", "/roadmap-book"]);
  // The copy went live on 2026-10-02, after the first ship that carried it (00:26 Arizona = 07:26 UTC).
  assert.equal(CF_COPY_GO_LIVE, "2026-10-02T07:30:00.000Z");
});

test("lead lane: both reads are SELECT only, no transaction words, no write words", () => {
  for (const sql of [FACTS_SQL, CONTACTS_SQL]) {
    assert.match(sql.replace(/\/\*.*?\*\//gs, "").trim(), /^(WITH|SELECT)\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|set_config)\b/i);
    assert.doesNotMatch(sql, /(^|\n)\s*SET\s/i);
  }
});

test("lead lane: webhook_captures is never filtered by org (all 4451 rows have a null org)", () => {
  assert.doesNotMatch(FACTS_SQL, /\bc\.org_id\b/);
  assert.match(FACTS_SQL, /webhook_captures c/);
  assert.match(FACTS_SQL, /c\.provider = 'clickfunnels'/);
});

test("lead lane: a real lead is not a demo, an agent, a test address or a test name", () => {
  assert.match(FACTS_SQL, /COALESCE\(e\.is_demo, false\) = false/);
  assert.match(FACTS_SQL, /THEN \(e\.payload->>'actor'\) = 'person'/);
  assert.match(FACTS_SQL, /\(e\.payload->>'actor'\) IS NOT NULL THEN/);
  for (const domain of ["fundhub.ai", "example.com", "example.net", "example.org"]) {
    assert.ok(FACTS_SQL.includes(`'${domain}'`), domain);
  }
  assert.match(FACTS_SQL, /e2e\|sim\|test/);
  assert.match(FACTS_SQL, /\(test\|e2e\)/);
  assert.match(FACTS_SQL, /'entry\.captured', 'survey\.submitted', 'slo\.contact_started'/);
  // People, not rows.
  assert.match(FACTS_SQL, /count\(DISTINCT COALESCE\(NULLIF\(lower\(e\.payload->>'email'\), ''\), e\.id::text\)\)/);
});

test("lead lane: no email, phone or name is ever selected", () => {
  assert.doesNotMatch(CONTACTS_SQL, /AS\s+(email|phone|name)\b/i);
  assert.doesNotMatch(CONTACTS_SQL, /SELECT\s+e\.payload->>'(email|phone|name)'/i);
  assert.doesNotMatch(FACTS_SQL, /AS\s+(email|phone|name)\b/i);
});

test("lead lane: no web call, no send, no repo read in the source", () => {
  const code = SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /\bfetch\s*\(|\bhttps?\.request\b|node:fs|readFileSync|\bsendTemplated\b|\bfetchImpl\b/);
});

test("lead lane: the two ad days are Arizona days, not UTC days", () => {
  assert.deepEqual(windowDays(new Date("2026-10-09T13:00:00Z")), { first: "2026-10-07", last: "2026-10-08" });
  // 6:30 p.m. Arizona on Oct 8 is already Oct 9 in UTC. The Arizona day is still Oct 8.
  assert.deepEqual(windowDays(new Date("2026-10-09T01:30:00Z")), { first: "2026-10-06", last: "2026-10-07" });
  assert.deepEqual(windowDays(new Date("2026-11-01T13:00:00Z")), { first: "2026-10-30", last: "2026-10-31" });
});

// ---------------------------------------------------------------------------
// 1. lead:pipe-cut-with-traffic

test("pipe: plenty of clicks and no real lead -> FAIL, with the numbers and what was expected", () => {
  const r = pipeCheck(facts({ ad_clicks: "400", road_leads: 0, cf_leads: 0, road_views: 30 }), NOW);
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /400 link clicks/);
  assert.match(r.detail, /2026-10-03 and 2026-10-04/);
  assert.match(r.detail, /30 people opened \/roadmap/);
  assert.match(r.detail, /Zero real people were saved on the \/roadmap step 1/);
  assert.match(r.detail, /should have brought about 3\./);
  assert.match(r.detail, /Oct 2, 3:45 PM Arizona/);
  assert.match(r.detail, /no ClickFunnels post arrived/);
  assert.match(r.suggestedFix, /mapToCanonical/);
  assert.match(r.suggestedFix, /slo-interest/);
});

test("pipe: the first draft cried wolf at 15 clicks; now 359 is nothing to judge (na) and 360 is a FAIL", () => {
  for (const clicks of ["0", "15", "43", "146", "202", "359"]) {
    const r = pipeCheck(facts({ ad_clicks: clicks }), NOW);
    assertShape(r);
    assert.equal(r.status, "na", `${clicks} clicks`);
    // Measured live 2026-10-09: ad_rows 1, ad_clicks 0, no lead, no ClickFunnels post.
    assert.deepEqual(r.na, {
      code: "low-traffic",
      args: { check: "lead:pipe-cut-with-traffic", clicks: Number(clicks), min: 360, first: "2026-10-03", last: "2026-10-04" }
    });
    assert.match(r.detail, /Zero leads only means something at 360 clicks or more/);
    assert.match(r.detail, /Judged the day ads send 360 clicks\./);
  }
  assert.equal(pipeCheck(facts({ ad_clicks: "360" }), NOW).status, "FAIL");
  assert.match(pipeCheck(facts({ ad_clicks: "720" }), NOW).detail, /should have brought about 6\./);
});

test("pipe: the FAIL says when ClickFunnels posts DID arrive (the cut is after the door)", () => {
  const r = pipeCheck(facts({ ad_clicks: "400", cf_posts: 3 }), NOW);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /3 ClickFunnels posts arrived, so look at what we do with them/);
});

test("pipe: the FAIL says whether anyone even opened /roadmap", () => {
  assert.match(pipeCheck(facts({ road_views: 0 }), NOW).detail, /the page tracker saw no one open \/roadmap/);
  assert.match(pipeCheck(facts({ road_views: 1 }), NOW).detail, /1 person opened \/roadmap/);
  assert.match(pipeCheck(facts({ road_views: 55 }), NOW).detail, /55 people opened \/roadmap/);
});

test("pipe: a real person saved on the /roadmap step 1 is the proof -> PASS, even with few clicks", () => {
  const r = pipeCheck(facts({ ad_clicks: "3", road_leads: 2 }), NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /2 people saved on the \/roadmap step 1 since 2026-10-03/);
  assert.equal(pipeCheck(facts({ ad_clicks: "3", road_leads: 1 }), NOW).status, "PASS");
  assert.match(pipeCheck(facts({ road_leads: 1 }), NOW).detail, /1 person saved on the \/roadmap step 1/);
});

test("pipe: PASS says how many more came through ClickFunnels forms, with the right grammar", () => {
  assert.match(pipeCheck(facts({ road_leads: 1, cf_leads: 1 }), NOW).detail, /1 more person came through ClickFunnels forms/);
  assert.match(pipeCheck(facts({ road_leads: 1, cf_leads: 3 }), NOW).detail, /3 more people came through ClickFunnels forms/);
});

test("pipe: a live /apply form cannot hide a dead /roadmap save once people are opening /roadmap", () => {
  // 40 people opened /roadmap, ClickFunnels forms saved 2, /roadmap saved nobody, 400 clicks.
  const r = pipeCheck(facts({ ad_clicks: "400", road_views: 40, road_leads: 0, cf_leads: 2 }), NOW);
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 people came through ClickFunnels forms, but none saved on \/roadmap/);
  // With too few clicks it is nothing to judge (na), and still says so.
  const quiet = pipeCheck(facts({ ad_clicks: "100", road_views: 40, road_leads: 0, cf_leads: 2 }), NOW);
  assertShape(quiet);
  assert.equal(quiet.status, "na");
  assert.match(quiet.detail, /2 people came through ClickFunnels forms, but none saved on \/roadmap/);
});

test("pipe: when the ads are not feeding /roadmap, a ClickFunnels lead is proof enough", () => {
  const r = pipeCheck(facts({ ad_clicks: "400", road_views: 5, road_leads: 0, cf_leads: 2 }), NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /2 people came through ClickFunnels forms/);
  assert.match(r.detail, /Only 5 people opened \/roadmap/);
  // 19 views is still "not feeding it"; 20 is the door.
  assert.equal(pipeCheck(facts({ ad_clicks: "400", road_views: 19, cf_leads: 1 }), NOW).status, "PASS");
  assert.equal(pipeCheck(facts({ ad_clicks: "400", road_views: 20, cf_leads: 1 }), NOW).status, "FAIL");
});

test("pipe: no ad row at all is a skip that says so (ads paused or sync late)", () => {
  const r = pipeCheck(facts({ ad_rows: 0, ad_clicks: "0" }), NOW);
  assertShape(r);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /no row for 2026-10-03 or 2026-10-04/);
});

// ---------------------------------------------------------------------------
// 2. lead:clickfunnels-posts-silent

test("posts: people on ClickFunnels form pages and zero posts while other senders are alive -> FAIL", () => {
  const r = postsCheck(facts({ form_views: 25, cf_posts: 0, other_posts: 10 }), NOW);
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /zero posts since 2026-10-03/);
  assert.match(r.detail, /25 people opened a ClickFunnels form page \(\/apply, \/funding-book-call, \/roadmap-book\)/);
  assert.match(r.detail, /Other senders left 10 receipts, so receipts are on/);
  assert.match(r.detail, /Oct 2, 3:45 PM Arizona/);
  assert.match(r.suggestedFix, /CLICKFUNNELS_WEBHOOK_SECRET/);
  assert.match(r.suggestedFix, /401 and keeps no row/);
});

test("posts: 20 people on a ClickFunnels form page is enough, 19 is not", () => {
  const quiet = { cf_posts: 0, other_posts: 4 };
  const r = postsCheck(facts({ ...quiet, form_views: 20 }), NOW);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /20 people opened a ClickFunnels form page/);
  const few = postsCheck(facts({ ...quiet, form_views: 19 }), NOW);
  assertShape(few);
  assert.equal(few.status, "na");
  assert.deepEqual(few.na, {
    code: "low-traffic",
    args: { check: "lead:clickfunnels-posts-silent", views: 19, min: 20, first: "2026-10-03" }
  });
});

test("posts: ad clicks never turn this red (the ads land on /roadmap, which posts to our own door)", () => {
  // The first draft went red here: 43 clicks, 48 people on /roadmap, nobody typed an email, nothing was broken.
  for (const clicks of ["43", "400", "5000"]) {
    const r = postsCheck(facts({ ad_clicks: clicks, road_views: 48, form_views: 3, cf_posts: 0, other_posts: 10 }), NOW);
    assertShape(r);
    assert.equal(r.status, "na", `${clicks} clicks`);
    assert.match(r.detail, /Ad clicks do not count/);
  }
});

test("posts: a post that arrived is the proof -> PASS, even with no traffic", () => {
  const r = postsCheck(facts({ ad_clicks: "0", form_views: 0, cf_posts: 4 }), NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /ClickFunnels sent 4 posts since 2026-10-03/);
});

test("posts: too quiet to expect a post is nothing to judge (na), never a PASS", () => {
  // Measured live 2026-10-09: form_views 0, cf_posts 0, other_posts 39.
  const r = postsCheck(facts({ form_views: 19, cf_posts: 0 }), NOW);
  assertShape(r);
  assert.equal(r.status, "na");
  assert.match(r.detail, /Too quiet/);
  assert.match(r.detail, /19 people opened a ClickFunnels form page/);
  assert.match(r.detail, /Judged the day 20 people open a form page\./);
  // Even with no receipt from any sender, too few form views is still the first thing said.
  assert.equal(postsCheck(facts({ form_views: 0, cf_posts: 0, other_posts: 0 }), NOW).status, "na");
});

test("posts: if no sender at all left a receipt, receipts may be off -> skip, not a false red", () => {
  const r = postsCheck(facts({ form_views: 40, cf_posts: 0, other_posts: 0 }), NOW);
  assertShape(r);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /receipts may be switched off/);
});

// ---------------------------------------------------------------------------
// 3. lead:slo-contact-not-in-clickfunnels

const LIVE = new Date("2026-10-04T20:00:00Z");
const longAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000);

test("contact: a real roadmap lead ClickFunnels refused -> FAIL with the reason, no email", () => {
  const r = contactCheck([refused(), contactRow()], NOW);
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 of 2 real roadmap leads/);
  assert.match(r.detail, /did not get into ClickFunnels/);
  assert.match(r.detail, /ClickFunnels refused it \(401: Unauthorized: bad api key\)/);
  assert.match(r.suggestedFix, /held_by_dry_run/);
  assert.match(r.suggestedFix, /no_credentials/);
  assert.match(r.suggestedFix, /froze before the ClickFunnels call finished/);
});

test("contact: a refusal because ClickFunnels already holds the email is NOT a lost lead -> PASS with a note", () => {
  // The one real refusal on record (2026-10-02): 422 "Email address has already been taken".
  const r = contactCheck([taken()], NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /Of 1 real roadmap lead from the last 3 days, 1 is in ClickFunnels/);
  assert.match(r.detail, /1 copy was refused because ClickFunnels already holds the email/);
  assert.match(r.detail, /phone, name or prequal amount may be missing/);
});

test("contact: a refusal that ClickFunnels itself posted back is in the list -> PASS with a note", () => {
  const r = contactCheck([refused({ cf_seen: true })], NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 lead had no good copy, but ClickFunnels posted that person back itself/);
  assert.match(r.detail, /may be missing/);
});

test("contact: every lead reached ClickFunnels -> PASS", () => {
  const r = contactCheck([contactRow(), contactRow()], NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /Of 2 real roadmap leads from the last 3 days, 2 are in ClickFunnels\./);
  assert.doesNotMatch(r.detail, /missing/);
});

test("contact: a refusal fixed by a later copy of the same person is not a break", () => {
  const r = contactCheck([refused({ later_ok: true }), contactRow()], NOW);
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 earlier refusal was fixed by a later copy/);
  // The same refusal with no later success is the break.
  assert.equal(contactCheck([refused({ later_ok: false })], NOW).status, "FAIL");
});

test("contact: a lead with NO answer recorded, older than 30 minutes, after the copy went live -> FAIL", () => {
  const r = contactCheck([silent({ created_at: longAgo(NOTE_GRACE_MINUTES + 1) })], NOW);
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 of 1 real roadmap lead/);
  assert.match(r.detail, /no ClickFunnels answer was ever recorded, so the copy may not have run/);
  assert.match(r.detail, /over 30 minutes old/);
});

test("contact: a lost copy is not hidden by other leads that reached ClickFunnels", () => {
  // The first draft said PASS here because reached > 0.
  const r = contactCheck([contactRow(), contactRow(), silent({ created_at: longAgo(120) })], NOW);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 of 3 real roadmap leads/);
  // The same, with a refused copy next to good ones.
  assert.equal(contactCheck([contactRow(), refused()], NOW).status, "FAIL");
});

test("contact: no answer yet but under 30 minutes old is waiting, not lost", () => {
  const fresh = contactCheck([silent({ created_at: longAgo(5) })], NOW);
  assertShape(fresh);
  assert.equal(fresh.status, "skip");
  assert.match(fresh.detail, /saved under 30 minutes ago/);
  assert.match(fresh.detail, /not due yet/);
  // Waiting next to a good one: PASS, and it says one is still waiting.
  const mixed = contactCheck([contactRow(), silent({ created_at: longAgo(5) })], NOW);
  assert.equal(mixed.status, "PASS");
  assert.match(mixed.detail, /1 still waiting for an answer/);
  // Exactly 30 minutes is still waiting; one minute more is lost.
  assert.equal(contactCheck([silent({ created_at: longAgo(NOTE_GRACE_MINUTES) })], NOW).status, "skip");
  assert.equal(contactCheck([silent({ created_at: longAgo(NOTE_GRACE_MINUTES + 1) })], NOW).status, "FAIL");
});

test("contact: a lead saved before the copy went live has no note and is not judged", () => {
  const before = silent({ created_at: new Date(Date.parse(CF_COPY_GO_LIVE) - 1) });
  const r = contactCheck([before], NOW);
  assertShape(r);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /all saved before the ClickFunnels copy went live on 2026-10-02/);
  // The very first moment of the copy is judged.
  assert.equal(sortContact(silent({ created_at: new Date(CF_COPY_GO_LIVE) }), NOW), "lost");
  assert.equal(sortContact(before, NOW), "before-copy");
  // An old lead does not turn a good day red, and is not counted in the total.
  const mixed = contactCheck([contactRow(), before], NOW);
  assert.equal(mixed.status, "PASS");
  assert.match(mixed.detail, /Of 1 real roadmap lead/);
});

test("contact: a no-answer lead that ClickFunnels posted back itself is in the list", () => {
  assert.equal(sortContact(silent({ created_at: longAgo(300), cf_seen: true }), NOW), "posted-back");
  assert.equal(contactCheck([silent({ created_at: longAgo(300), cf_seen: true })], NOW).status, "PASS");
});

test("contact: each way the copy can fail gets its own plain reason", () => {
  assert.equal(reasonOf({ cf_error: "held_by_dry_run" }), "held by the dry-run switch (ADAPTERS_DRY_RUN)");
  assert.equal(reasonOf({ cf_skipped: "no_credentials" }), "the ClickFunnels key is not set on the server");
  assert.equal(reasonOf({ cf_error: "clickfunnels_threw" }), "the copy crashed before ClickFunnels answered");
  assert.match(reasonOf({ cf_error: "clickfunnels_refused", cf_status: "401" }), /refused it \(401\)/);
  assert.equal(reasonOf({}), "no reason recorded");
  for (const [row, text] of [
    [{ cf_ok: "false", cf_error: "held_by_dry_run" }, /ADAPTERS_DRY_RUN/],
    [{ cf_ok: "false", cf_skipped: "no_credentials" }, /key is not set/]
  ]) {
    const r = contactCheck([contactRow(row)], NOW);
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, text);
  }
});

test("contact: only 'email already taken' counts as already-there, not any 422", () => {
  assert.equal(sortContact(taken(), NOW), "already-there");
  assert.equal(sortContact(refused({ cf_status: "422", cf_message: "Phone number has already been taken" }), NOW), "refused");
  assert.equal(sortContact(refused({ cf_status: "422", cf_message: "Request unprocessable: First name is blank" }), NOW), "refused");
  assert.equal(sortContact(refused({ cf_status: "500", cf_message: null }), NOW), "refused");
});

test("contact: an email address inside ClickFunnels' own message never reaches the detail line", () => {
  const r = contactCheck([refused({ cf_status: "422", cf_message: "Contact jane.doe@example.com is invalid" })], NOW);
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /\[email\]/);
  assert.doesNotMatch(r.detail, /jane|example\.com/);
});

test("contact: reasons are counted and the biggest comes first", () => {
  const r = contactCheck([
    refused(), refused(), refused(),
    contactRow({ cf_ok: "false", cf_error: "held_by_dry_run" })
  ], NOW);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /4 of 4 real roadmap leads/);
  assert.ok(r.detail.indexOf("(3)") < r.detail.indexOf("dry-run"));
});

test("contact: no real roadmap lead in three days is nothing to judge (na no-real-lead) and says so", () => {
  // Measured live 2026-10-09: CONTACTS_SQL returned 0 rows.
  const r = contactCheck([], NOW);
  assertShape(r);
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-real-lead", args: { check: "lead:slo-contact-not-in-clickfunnels", days: 3 } });
  assert.match(r.detail, /No real roadmap lead in the last 3 days/);
  assert.match(r.detail, /Judged the day one comes\./);
});

// ---------------------------------------------------------------------------
// The whole lane, through a fake staff scope.

test("lane: dead pipe, silent sender, refused lead -> three FAIL, params are right", async () => {
  const seen = [];
  const rows = await gapChecks({
    scope: scopeFor({ facts: factsRow({ form_views: 30 }), contacts: [refused()] }, seen),
    now: NOW,
    orgId: ORG
  });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  rows.forEach(assertShape);
  assert.deepEqual(rows.map((r) => r.status), ["FAIL", "FAIL", "FAIL"]);

  const [factsCall, contactsCall] = seen;
  assert.equal(factsCall.sql, FACTS_SQL);
  assert.deepEqual(factsCall.params, [ORG, "2026-10-03", "2026-10-04", NOW.toISOString(), ["/apply", "/funding-book-call", "/roadmap-book"]]);
  assert.equal(contactsCall.sql, CONTACTS_SQL);
  assert.equal(contactsCall.params[0], ORG);
  assert.equal(contactsCall.params[1], new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(contactsCall.params[2], NOW.toISOString());
  for (const c of seen) assert.match(c.sql.replace(/\/\*.*?\*\//gs, "").trim(), /^(WITH|SELECT)\b/i);
});

test("lane: healthy day -> three PASS", async () => {
  const rows = await gapChecks({
    scope: scopeFor({
      facts: factsRow({ ad_clicks: "600", road_leads: "4", cf_posts: "6" }),
      contacts: [contactRow(), contactRow()]
    }),
    now: NOW,
    orgId: ORG
  });
  rows.forEach(assertShape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
});

test("lane: quiet day (ads paused, no ad row) -> pipe stays a skip, the other two are na, none PASS", async () => {
  // With no ad row at all the pipe check cannot see the ads ("we cannot see it" is never a
  // nothing-to-judge condition), so it stays a skip. Too few form views and no lead are measured.
  const rows = await gapChecks({
    scope: scopeFor({ facts: factsRow({ ad_rows: 0, ad_clicks: "0", road_views: 0, form_views: 0 }), contacts: [] }),
    now: NOW,
    orgId: ORG
  });
  rows.forEach(assertShape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "na", "na"]);
});

test("lane: ads sent clicks but under the minimum, no lead anywhere -> three na, each with its code", async () => {
  // Measured live 2026-10-09: ad_rows 1, ad_clicks 0, form_views 0, no contact rows.
  const rows = await gapChecks({
    scope: scopeFor({ facts: factsRow({ ad_rows: 1, ad_clicks: "0", road_views: 0, form_views: 0 }), contacts: [] }),
    now: NOW,
    orgId: ORG
  });
  rows.forEach(assertShape);
  assert.deepEqual(rows.map((r) => r.status), ["na", "na", "na"]);
  assert.deepEqual(rows.map((r) => r.na.code), ["low-traffic", "low-traffic", "no-real-lead"]);
  // The company the lane read is carried, so the audit re-reads the same company.
  for (const r of rows) assert.equal(r.na.args.orgId, ORG);
});

test("lane: with no company id the args carry none (the re-check reads all companies, like the lane)", async () => {
  const rows = await gapChecks({
    scope: scopeFor({ facts: factsRow({ ad_clicks: "0", form_views: 0 }), contacts: [] }),
    now: NOW
  });
  for (const r of rows) {
    assert.equal(r.status, "na");
    assert.equal("orgId" in r.na.args, false);
  }
});

test("lane: enough traffic or a real lead -> never na (PASS or FAIL, as before)", async () => {
  const cases = [
    [{ facts: factsRow({ ad_clicks: "400", form_views: 30, other_posts: 10 }), contacts: [refused()] }, ["FAIL", "FAIL", "FAIL"]],
    [{ facts: factsRow({ ad_clicks: "600", road_leads: "4", cf_posts: "6" }), contacts: [contactRow()] }, ["PASS", "PASS", "PASS"]],
    // One real lead that is still waiting for ClickFunnels is a skip, not "no lead": never na.
    [{ facts: factsRow({ ad_clicks: "600", road_leads: "4", cf_posts: "6" }), contacts: [silent({ created_at: longAgo(5) })] }, ["PASS", "PASS", "skip"]]
  ];
  for (const [input, want] of cases) {
    const rows = await gapChecks({ scope: scopeFor(input), now: NOW, orgId: ORG });
    rows.forEach(assertShape);
    assert.deepEqual(rows.map((r) => r.status), want);
    for (const r of rows) assert.equal(r.na, undefined, `${r.id} must not carry na`);
  }
});

test("lane: a read that fails is a skip with the reason, never a PASS", async () => {
  const rows = await gapChecks({
    scope: scopeFor({ factsError: new Error("permission denied for table ad_metrics_daily"), contactsError: new Error("boom") }),
    now: NOW,
    orgId: ORG
  });
  rows.forEach(assertShape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[0].detail, /permission denied for table ad_metrics_daily/);
  assert.match(rows[2].detail, /boom/);
});

test("lane: one read failing does not take down the other check", async () => {
  const rows = byId(await gapChecks({
    scope: scopeFor({ factsError: new Error("timeout"), contacts: [refused()] }),
    now: NOW,
    orgId: ORG
  }));
  assert.equal(rows["lead:pipe-cut-with-traffic"].status, "skip");
  assert.equal(rows["lead:slo-contact-not-in-clickfunnels"].status, "FAIL");
});

test("lane: a contacts read with no rows list is a skip with the reason, never na (the audit would call it a lie)", async () => {
  // A scope that answers FACTS_SQL fine and answers CONTACTS_SQL with nothing usable.
  for (const answer of [undefined, null, {}, { rows: null }, { rows: "none" }]) {
    const scope = async (fn) =>
      fn({ query: async (sql) => (sql === FACTS_SQL ? { rows: [factsRow()] } : answer) });
    const rows = byId(await gapChecks({ scope, now: NOW, orgId: ORG }));
    const r = rows["lead:slo-contact-not-in-clickfunnels"];
    assertShape(r);
    assert.equal(r.status, "skip", JSON.stringify(answer));
    assert.match(r.detail, /could not read roadmap leads: the read came back with no list of leads/);
  }
  // An empty list is a real answer: zero leads.
  const empty = async (fn) => fn({ query: async (sql) => (sql === FACTS_SQL ? { rows: [factsRow()] } : { rows: [] }) });
  const ok = byId(await gapChecks({ scope: empty, now: NOW, orgId: ORG }));
  assert.equal(ok["lead:slo-contact-not-in-clickfunnels"].status, "na");
});

test("lane: 400 clicks, 25 people on /roadmap, nobody saved -> pipe FAIL; posts and contact are na (twin of the SQL meaning test)", async () => {
  // Same numbers the shadowed FACTS_SQL gives in the SQL-meaning test of this name: 2 ad rows,
  // 400 clicks, 25 /roadmap views, no ClickFunnels form page, no post from any sender, no lead.
  const rows = byId(await gapChecks({
    scope: scopeFor({
      facts: factsRow({ ad_rows: 2, ad_clicks: "400", road_views: 25, form_views: 0, cf_posts: 0, other_posts: 0 }),
      contacts: []
    }),
    now: NOW,
    orgId: ORG
  }));
  Object.values(rows).forEach(assertShape);
  assert.equal(rows["lead:pipe-cut-with-traffic"].status, "FAIL");
  assert.match(rows["lead:pipe-cut-with-traffic"].detail, /400 link clicks/);
  assert.match(rows["lead:pipe-cut-with-traffic"].detail, /25 people opened \/roadmap/);
  // 400 ad clicks alone do not make ClickFunnels "silent".
  const posts = rows["lead:clickfunnels-posts-silent"];
  assert.equal(posts.status, "na");
  assert.equal(posts.na.code, "low-traffic");
  assert.equal(posts.na.args.views, 0);
  const contact = rows["lead:slo-contact-not-in-clickfunnels"];
  assert.equal(contact.status, "na");
  assert.equal(contact.na.code, "no-real-lead");
});

test("lane: a read that comes back with a missing number is a skip, not a guess", async () => {
  for (const key of ["road_leads", "cf_leads", "road_views", "form_views"]) {
    const rows = await gapChecks({
      scope: scopeFor({ facts: factsRow({ [key]: null }) }),
      now: NOW,
      orgId: ORG
    });
    assert.equal(rows[0].status, "skip", key);
    assert.equal(rows[1].status, "skip", key);
  }
  const rows = await gapChecks({ scope: scopeFor({ facts: factsRow({ road_leads: null }) }), now: NOW, orgId: ORG });
  assert.match(rows[0].detail, /without roadLeads/);
});

test("lane: no database in the run -> three skip", async () => {
  const rows = await gapChecks({ now: NOW });
  rows.forEach(assertShape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[0].detail, /no database in this run/);
});

test("lane: the staff scope is used when there is one, and ctx.db is never touched", async () => {
  const touched = [];
  const db = { async query(sql) { touched.push(sql); return { rows: [] }; } };
  await gapChecks({ db, scope: scopeFor({ contacts: [] }), now: NOW, orgId: ORG });
  assert.deepEqual(touched, []);
});

test("lane: with only a db, it reads through it and still sends no transaction words", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push(sql);
      return sql === FACTS_SQL ? { rows: [factsRow()] } : { rows: [] };
    }
  };
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows.length, 3);
  assert.deepEqual(seen, [FACTS_SQL, CONTACTS_SQL]);
  for (const sql of seen) assert.doesNotMatch(sql, /\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i);
});

test("lane: no org id means all orgs (a null param), not a skip", async () => {
  const seen = [];
  const rows = await gapChecks({ scope: scopeFor({}, seen), now: NOW });
  assert.equal(rows.length, 3);
  assert.equal(seen[0].params[0], null);
  assert.equal(seen[1].params[0], null);
});

// ---------------------------------------------------------------------------
// naVerify: the audit proves a nothing-to-judge row again, with the lane's own SQL
// and the lane's own minimums.

const PIPE = { check: "lead:pipe-cut-with-traffic" };
const POSTS = { check: "lead:clickfunnels-posts-silent" };
const CONTACT = { check: "lead:slo-contact-not-in-clickfunnels" };

test("naVerify low-traffic, pipe: true under the click minimum, false at it, false with no ad row", async () => {
  const seen = [];
  const ok = await naVerify["low-traffic"](PIPE, {
    scope: scopeFor({ facts: factsRow({ ad_rows: 1, ad_clicks: "359" }) }, seen),
    now: NOW
  });
  assert.equal(ok, true);
  assert.equal(seen[0].sql, FACTS_SQL);
  assert.deepEqual(seen[0].params, [null, "2026-10-03", "2026-10-04", NOW.toISOString(), [...CF_FORM_PAGES]]);
  const at = (over) => naVerify["low-traffic"](PIPE, { scope: scopeFor({ facts: factsRow(over) }), now: NOW });
  assert.equal(await at({ ad_rows: 1, ad_clicks: String(MIN_AD_CLICKS) }), false);
  assert.equal(await at({ ad_rows: 1, ad_clicks: "5000" }), false);
  // No ad row at all is "we cannot see the ads", never a quiet condition.
  assert.equal(await at({ ad_rows: 0, ad_clicks: "0" }), false);
});

test("naVerify low-traffic, posts: true under the form-view minimum, false at it", async () => {
  const at = (over) => naVerify["low-traffic"](POSTS, { scope: scopeFor({ facts: factsRow(over) }), now: NOW });
  assert.equal(await at({ form_views: MIN_FORM_PAGE_VIEWS - 1 }), true);
  assert.equal(await at({ form_views: 0 }), true);
  assert.equal(await at({ form_views: MIN_FORM_PAGE_VIEWS }), false);
  assert.equal(await at({ form_views: 400 }), false);
});

test("naVerify low-traffic: the company on the row is the company read; else ctx.orgId; else all", async () => {
  const run = async (args, ctx) => {
    const seen = [];
    await naVerify["low-traffic"](args, { scope: scopeFor({ facts: factsRow({ form_views: 0 }) }, seen), now: NOW, ...ctx });
    return seen[0].params[0];
  };
  assert.equal(await run({ ...POSTS, orgId: ORG }, { orgId: ORG_B }), ORG);
  assert.equal(await run(POSTS, { orgId: ORG_B }), ORG_B);
  assert.equal(await run(POSTS, {}), null);
});

test("naVerify low-traffic: another check, no args, no read, or a missing count is false; a failed read throws", async () => {
  const scope = scopeFor({ facts: factsRow({ ad_clicks: "0", form_views: 0 }) });
  assert.equal(await naVerify["low-traffic"]({ check: "lead:slo-contact-not-in-clickfunnels" }, { scope, now: NOW }), false);
  assert.equal(await naVerify["low-traffic"]({}, { scope, now: NOW }), false);
  assert.equal(await naVerify["low-traffic"](undefined, { scope, now: NOW }), false);
  assert.equal(await naVerify["low-traffic"](POSTS, { now: NOW }), false);
  await assert.rejects(
    naVerify["low-traffic"](POSTS, { scope: scopeFor({ facts: factsRow({ form_views: null }) }), now: NOW }),
    /without formViews/
  );
  await assert.rejects(
    naVerify["low-traffic"](PIPE, { scope: scopeFor({ factsError: new Error("permission denied for table ad_metrics_daily") }), now: NOW }),
    /permission denied/
  );
});

test("naVerify no-real-lead: true with no real lead in the window, false with one, false with a bad read", async () => {
  const seen = [];
  assert.equal(await naVerify["no-real-lead"](CONTACT, { scope: scopeFor({ contacts: [] }, seen), now: NOW }), true);
  assert.equal(seen[0].sql, CONTACTS_SQL);
  assert.equal(seen[0].params[1], new Date(NOW.getTime() - CONTACT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(seen[0].params[2], NOW.toISOString());
  assert.equal(await naVerify["no-real-lead"](CONTACT, { scope: scopeFor({ contacts: [contactRow()] }), now: NOW }), false);
  // A lead that is old, or waiting, is still a lead: the row is not "no lead".
  assert.equal(await naVerify["no-real-lead"](CONTACT, { scope: scopeFor({ contacts: [silent({ created_at: longAgo(5) })] }), now: NOW }), false);
  assert.equal(await naVerify["no-real-lead"](PIPE, { scope: scopeFor({ contacts: [] }), now: NOW }), false);
  assert.equal(await naVerify["no-real-lead"](undefined, { scope: scopeFor({ contacts: [] }), now: NOW }), false);
  assert.equal(await naVerify["no-real-lead"](CONTACT, { now: NOW }), false);
  // A read that came back with no rows list is not "zero leads".
  const noList = async (fn) => fn({ query: async () => ({}) });
  assert.equal(await naVerify["no-real-lead"](CONTACT, { scope: noList, now: NOW }), false);
  await assert.rejects(
    naVerify["no-real-lead"](CONTACT, { scope: scopeFor({ contactsError: new Error("boom") }), now: NOW }),
    /boom/
  );
});

test("naVerify: db.query works when scope is omitted", async () => {
  const db = { async query(sql) { return sql === FACTS_SQL ? { rows: [factsRow({ form_views: 3 })] } : { rows: [] }; } };
  assert.equal(await naVerify["low-traffic"](POSTS, { db, now: NOW }), true);
  assert.equal(await naVerify["no-real-lead"](CONTACT, { db, now: NOW }), true);
});

test("round trip: each na row's own args pass naVerify, and fail the moment the traffic or the lead is real", async () => {
  const quiet = { facts: factsRow({ ad_rows: 1, ad_clicks: "0", form_views: 0 }), contacts: [] };
  const rows = await gapChecks({ scope: scopeFor(quiet), now: NOW, orgId: ORG });
  assert.deepEqual(rows.map((r) => r.status), ["na", "na", "na"]);
  for (const r of rows) {
    assert.equal(await naVerify[r.na.code](r.na.args, { scope: scopeFor(quiet), now: NOW }), true, r.id);
  }
  const busy = { facts: factsRow({ ad_rows: 1, ad_clicks: "900", form_views: 60 }), contacts: [contactRow()] };
  for (const r of rows) {
    assert.equal(await naVerify[r.na.code](r.na.args, { scope: scopeFor(busy), now: NOW }), false, r.id);
  }
});

// ---------------------------------------------------------------------------
// SQL meaning. The pure tests above cannot tell whether FACTS_SQL and
// CONTACTS_SQL compute what the words say. These run the real SQL text on a real
// Postgres against made-up rows. Skipped without DATABASE_URL.

const HAVE_DB = Boolean(process.env.DATABASE_URL);
const SQL_SKIP = HAVE_DB ? false : "DATABASE_URL is not set (these read only their own made-up rows, never a real table)";

// The three tables the lead SQL reads, as WITH names. $N is the one parameter
// that carries the made-up rows as JSON.
const shadowCtes = (n) => `
  events AS (SELECT * FROM jsonb_to_recordset(($${n}::jsonb)->'events')
             AS x(id uuid, org_id uuid, name text, is_demo boolean, payload jsonb, created_at timestamptz)),
  ad_metrics_daily AS (SELECT * FROM jsonb_to_recordset(($${n}::jsonb)->'ads')
             AS x(org_id uuid, date date, link_clicks bigint, clicks bigint)),
  webhook_captures AS (SELECT * FROM jsonb_to_recordset(($${n}::jsonb)->'hooks')
             AS x(org_id uuid, provider text, created_at timestamptz))`;

function shadowFacts(sql) {
  assert.ok(sql.includes("WITH w AS"), "FACTS_SQL starts with WITH w AS");
  return sql.replace("WITH w AS", `WITH ${shadowCtes(6)}, w AS`);
}

function shadowContacts(sql) {
  assert.ok(sql.includes("SELECT e.created_at"), "CONTACTS_SQL starts with SELECT e.created_at");
  return sql.replace("SELECT e.created_at", `WITH ${shadowCtes(4)} SELECT e.created_at`);
}

async function withReadOnly(fn) {
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1|sslmode=/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    return await fn(client);
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    await client.end();
  }
}

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const ev = (name, payload, at, extra = {}) => ({
  id: uuid(),
  org_id: ORG,
  name,
  is_demo: false,
  payload,
  created_at: at,
  ...extra
});

const person = (email, extra = {}) => ({ email, actor: "person", name: "Pat Smith", ...extra });
const road = (email, at, extra = {}, payload = {}) => ev("slo.contact_started", person(email, payload), at, extra);
const cfRow = (name, email, at, extra = {}, payload = {}) =>
  ev(name, { email, name: "Pat Smith", source: "clickfunnels", ...payload }, at, extra);
const page = (path_, session, at, extra = {}, payload = {}) =>
  ev("funnel.page", { page: path_, session_id: session, actor: "person", ...payload }, at, extra);
const post = (provider, at, org = null) => ({ org_id: org, provider, created_at: at });
const ad = (date, link_clicks, clicks, org = ORG) => ({ org_id: org, date, link_clicks, clicks });

const FACTS_PARAMS = (org = ORG) => [org, "2026-10-03", "2026-10-04", NOW.toISOString(), [...CF_FORM_PAGES]];

async function readFacts(fixture, org = ORG) {
  return withReadOnly(async (c) => {
    const r = await c.query(shadowFacts(FACTS_SQL), [...FACTS_PARAMS(org), JSON.stringify(fixture)]);
    assert.equal(r.rows.length, 1);
    return r.rows[0];
  });
}

async function readContacts(fixture, org = ORG) {
  const since = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  return withReadOnly(async (c) => {
    const r = await c.query(shadowContacts(CONTACTS_SQL), [org, since, NOW.toISOString(), JSON.stringify(fixture)]);
    return r.rows;
  });
}

const iso = (v) => new Date(v).toISOString();

test("sql meaning: ad clicks are the two closed Arizona days, link clicks first, one org", { skip: SQL_SKIP }, async () => {
  const fixture = {
    ads: [
      ad("2026-10-02", 100, 100), // three days back: outside
      ad("2026-10-03", 10, 99), // link_clicks wins over clicks
      ad("2026-10-04", null, 7), // no link_clicks: falls back to clicks
      ad("2026-10-05", 50, 50), // today (not a closed day): outside
      ad("2026-10-03", 1000, 1000, ORG_B) // another org
    ]
  };
  const mine = await readFacts(fixture, ORG);
  assert.equal(mine.ad_rows, 2);
  assert.equal(Number(mine.ad_clicks), 17);
  const all = await readFacts(fixture, null);
  assert.equal(all.ad_rows, 3);
  assert.equal(Number(all.ad_clicks), 1017);
  const none = await readFacts({ ads: [] }, ORG);
  assert.equal(none.ad_rows, 0);
  assert.equal(Number(none.ad_clicks), 0);
});

test("sql meaning: a real lead is a person, once, inside the Arizona window, not a test", { skip: SQL_SKIP }, async () => {
  const fixture = {
    events: [
      // /roadmap step 1
      road("Alice@Gmail.com", "2026-10-03T07:30:00Z"), // counts
      road("alice@gmail.com", "2026-10-04T10:00:00Z"), // the same person, again
      road("bob@gmail.com", "2026-10-04T10:00:00Z", {}, { actor: "agent" }), // agent
      road("carl@gmail.com", "2026-10-04T10:00:00Z", { is_demo: true }), // demo
      road("dan@gmail.com", "2026-10-04T10:00:00Z", {}, { name: "Test Test" }), // test name
      road("eve@gmail.com", "2026-10-03T06:59:00Z"), // 11:59 p.m. Oct 2 in Arizona, still Oct 3 in UTC: outside
      road("frank@gmail.com", "2026-10-05T13:00:01Z"), // after now
      road("gina@gmail.com", "2026-10-04T10:00:00Z", { org_id: ORG_B }), // another org
      // ClickFunnels forms
      cfRow("entry.captured", "hank@gmail.com", "2026-10-04T11:00:00Z"), // counts
      cfRow("entry.captured", "hank@gmail.com", "2026-10-04T11:00:00Z"), // ClickFunnels writes 2 rows per post
      cfRow("survey.submitted", "ivy@gmail.com", "2026-10-04T11:00:00Z"), // counts
      cfRow("entry.captured", "x@example.com", "2026-10-04T11:00:00Z"), // example.com
      cfRow("entry.captured", "y@example.org", "2026-10-04T11:00:00Z"), // example.org
      cfRow("entry.captured", "e2e.runner@gmail.com", "2026-10-04T11:00:00Z"), // e2e
      cfRow("entry.captured", "sim_user@gmail.com", "2026-10-04T11:00:00Z"), // sim
      cfRow("entry.captured", "jo.test@gmail.com", "2026-10-04T11:00:00Z"), // test
      cfRow("entry.captured", "ops@fundhub.ai", "2026-10-04T11:00:00Z"), // our own domain
      cfRow("entry.captured", "contest@gmail.com", "2026-10-04T11:00:00Z"), // "test" inside a word: a person
      cfRow("entry.captured", "attest@gmail.com", "2026-10-04T11:00:00Z", {}, { name: "Attestation Smith" }), // "test" inside a word: a person
      cfRow("entry.captured", "kay@gmail.com", "2026-10-04T11:00:00Z", {}, { name: "TestClient" }), // test name
      cfRow("entry.captured", "lou@gmail.com", "2026-10-04T11:00:00Z", {}, { name: "" }), // no name: a person
      cfRow("entry.captured", "late@gmail.com", "2026-10-05T12:59:59Z"), // the newest real lead
      cfRow("entry.captured", "robot@gmail.com", "2026-10-05T12:59:59.500Z", {}, { actor: "agent" }), // newer, but an agent
      // Not leads at all
      page("/roadmap", "s-lead", "2026-10-04T12:00:00Z"),
      ev("checkout.completed", person("zed@gmail.com"), "2026-10-04T12:00:00Z")
    ]
  };
  const r = await readFacts(fixture, ORG);
  assert.equal(r.road_leads, 1, "Alice once, in the window, as a person");
  // hank, ivy, contest, attest, lou, late
  assert.equal(r.cf_leads, 6);
  assert.equal(iso(r.lead_last), "2026-10-05T12:59:59.000Z", "newest REAL lead before now; the agent and the later row do not count");
});

test("sql meaning: with no org given, every org's people count", { skip: SQL_SKIP }, async () => {
  const fixture = {
    events: [
      road("a@gmail.com", "2026-10-04T10:00:00Z"),
      road("b@gmail.com", "2026-10-04T10:00:00Z", { org_id: ORG_B })
    ]
  };
  assert.equal((await readFacts(fixture, ORG)).road_leads, 1);
  assert.equal((await readFacts(fixture, null)).road_leads, 2);
});

test("sql meaning: the newest real lead reaches back past the window", { skip: SQL_SKIP }, async () => {
  const r = await readFacts({
    events: [
      road("old@gmail.com", "2026-09-20T12:00:00Z"),
      road("agent@gmail.com", "2026-10-01T12:00:00Z", {}, { actor: "agent" })
    ]
  });
  assert.equal(r.road_leads, 0);
  assert.equal(iso(r.lead_last), "2026-09-20T12:00:00.000Z");
  const none = await readFacts({ events: [] });
  assert.equal(none.lead_last, null);
});

test("sql meaning: a row with no email is one person, not all of them", { skip: SQL_SKIP }, async () => {
  const r = await readFacts({
    events: [
      ev("entry.captured", { source: "clickfunnels", name: "A" }, "2026-10-04T10:00:00Z"),
      ev("entry.captured", { source: "clickfunnels", name: "B", email: "" }, "2026-10-04T10:00:00Z")
    ]
  });
  assert.equal(r.cf_leads, 2);
});

test("sql meaning: views are people, by session, on the right pages, not agents", { skip: SQL_SKIP }, async () => {
  const fixture = {
    events: [
      page("/roadmap", "s1", "2026-10-04T10:00:00Z"),
      page("/roadmap", "s1", "2026-10-04T10:05:00Z"), // the same visit opening again
      page("/roadmap", "s2", "2026-10-04T10:00:00Z"),
      page("/roadmap", "s3", "2026-10-04T10:00:00Z", {}, { actor: "agent" }), // agent
      page("/roadmap", "s4", "2026-10-04T10:00:00Z", { is_demo: true }), // demo
      page("/roadmap", "s5", "2026-10-03T06:00:00Z"), // before the Arizona day
      page("/roadmap", "s6", "2026-10-04T10:00:00Z", { org_id: ORG_B }), // another org
      page("/roadmap", "", "2026-10-04T10:00:00Z"), // no session id: each counts as itself
      page("/roadmap", "", "2026-10-04T10:01:00Z"),
      ev("funnel.page", { page: "/roadmap", actor: "person" }, "2026-10-04T10:02:00Z"), // no session key at all
      page("/apply", "s7", "2026-10-04T10:00:00Z"),
      page("/apply", "s7", "2026-10-04T10:01:00Z"), // same visit
      page("/funding-book-call", "s8", "2026-10-04T10:00:00Z"),
      page("/roadmap-book", "s9", "2026-10-04T10:00:00Z"),
      page("/watch", "s10", "2026-10-04T10:00:00Z"), // neither
      page("/home", "s11", "2026-10-04T10:00:00Z"), // neither
      page("/apply", "s12", "2026-10-04T10:00:00Z", {}, { actor: "agent" }), // agent
      page("/apply", "s13", "2026-10-05T13:00:01Z") // after now
    ]
  };
  const r = await readFacts(fixture, ORG);
  assert.equal(r.road_views, 5, "s1, s2 and the three that carry no session id");
  assert.equal(r.form_views, 3, "/apply s7, /funding-book-call s8, /roadmap-book s9: /roadmap does not count");
  assert.equal((await readFacts(fixture, null)).road_views, 6);
});

test("sql meaning: ClickFunnels posts are counted in the window, with no org filter, apart from other senders", { skip: SQL_SKIP }, async () => {
  const r = await readFacts({
    hooks: [
      post("clickfunnels", "2026-10-04T10:00:00Z", null), // a null org still counts
      post("clickfunnels", "2026-10-04T10:00:00Z", ORG),
      post("clickfunnels", "2026-10-05T12:00:00Z", ORG_B), // another org still counts: the table has no org
      post("clickfunnels", "2026-10-01T10:00:00Z"), // before the window
      post("clickfunnels", "2026-10-05T13:00:01Z"), // after now
      post("twilio", "2026-10-04T10:00:00Z"),
      post("resend", "2026-10-05T12:00:00Z"),
      post("twilio", "2026-10-01T10:00:00Z") // before the window
    ]
  });
  assert.equal(r.cf_posts, 3);
  assert.equal(iso(r.cf_last), "2026-10-05T12:00:00.000Z");
  assert.equal(r.other_posts, 2);
  const old = await readFacts({ hooks: [post("clickfunnels", "2026-10-01T10:00:00Z"), post("twilio", "2026-10-01T10:00:00Z")] });
  assert.equal(old.cf_posts, 0);
  assert.equal(iso(old.cf_last), "2026-10-01T10:00:00.000Z", "the last post reaches back past the window");
  assert.equal(old.other_posts, 0);
});

test("sql meaning: the roadmap contacts, their notes, their order, their window", { skip: SQL_SKIP }, async () => {
  const note = (over) => ({ cf_contact: { at: "2026-10-04T08:00:01Z", ok: false, ...over } });
  const longMessage = "x".repeat(200);
  const fixture = {
    events: [
      road("a@x.com", "2026-10-04T08:00:00Z", {}, note({ error: "clickfunnels_refused", status: 422, message: "Request unprocessable: Email address has already been taken" })),
      road("b@x.com", "2026-10-04T09:00:00Z", {}, note({ ok: true })),
      road("c@x.com", "2026-10-04T10:00:00Z", {}, note({ skipped: "no_credentials" })),
      road("d@x.com", "2026-10-04T11:00:00Z", {}, note({ error: "clickfunnels_refused", status: 500, message: longMessage })),
      road("e@x.com", "2026-10-04T12:00:00Z"), // no note at all
      road("agent@x.com", "2026-10-04T13:00:00Z", {}, { actor: "agent" }), // agent: not in Paul's list
      road("demo@x.com", "2026-10-04T14:00:00Z", { is_demo: true }),
      road("before@x.com", "2026-10-02T12:59:59Z"), // 3 days and 1 second back
      road("after@x.com", "2026-10-05T13:00:01Z"), // after now
      road("other@x.com", "2026-10-04T15:00:00Z", { org_id: ORG_B }),
      ev("slo.checkout_started", person("z@x.com"), "2026-10-04T16:00:00Z") // not a roadmap lead
    ]
  };
  const rows = await readContacts(fixture, ORG);
  assert.deepEqual(rows.map((r) => iso(r.created_at)), [
    "2026-10-04T12:00:00.000Z",
    "2026-10-04T11:00:00.000Z",
    "2026-10-04T10:00:00.000Z",
    "2026-10-04T09:00:00.000Z",
    "2026-10-04T08:00:00.000Z"
  ], "newest first, real people only, three days, one org");
  const [e, d, c, b, a] = rows;
  assert.equal(e.cf_ok, null);
  assert.equal(e.cf_error, null);
  assert.equal(a.cf_ok, "false");
  assert.equal(a.cf_error, "clickfunnels_refused");
  assert.equal(a.cf_status, "422");
  assert.equal(a.cf_message, "Request unprocessable: Email address has already been taken");
  assert.equal(b.cf_ok, "true");
  assert.equal(c.cf_skipped, "no_credentials");
  assert.equal(d.cf_status, "500");
  assert.equal(d.cf_message.length, 120, "the message is cut at 120 characters");
  assert.equal(Object.keys(a).sort().join(","), "cf_error,cf_message,cf_ok,cf_seen,cf_skipped,cf_status,created_at,later_ok");
  assert.equal((await readContacts(fixture, null)).length, 6, "no org: the other org's person counts too");
});

test("sql meaning: later_ok is a LATER copy of the SAME email that worked, in the same org", { skip: SQL_SKIP }, async () => {
  const refusedNote = { cf_contact: { ok: false, error: "clickfunnels_refused", status: 401 } };
  const okNote = { cf_contact: { ok: true } };
  const fixture = {
    events: [
      road("a@x.com", "2026-10-04T08:00:00Z", {}, refusedNote), // fixed by the next row
      road("A@X.com", "2026-10-04T09:00:00Z", {}, okNote), // same email, other case, later, worked
      road("b@x.com", "2026-10-04T06:00:00Z", {}, okNote), // worked EARLIER
      road("b@x.com", "2026-10-04T10:00:00Z", {}, refusedNote), // refused LATER: not fixed
      road("c@x.com", "2026-10-04T11:00:00Z", {}, refusedNote), // a different email worked later
      road("d@x.com", "2026-10-04T12:00:00Z", {}, okNote),
      road("f@x.com", "2026-10-04T13:00:00Z", {}, refusedNote), // the later copy is in another org
      road("f@x.com", "2026-10-04T14:00:00Z", { org_id: ORG_B }, okNote),
      road("g@x.com", "2026-10-04T15:00:00Z", {}, refusedNote), // the later copy did not work
      road("g@x.com", "2026-10-04T16:00:00Z", {}, refusedNote),
      road("h@x.com", "2026-10-04T17:00:00Z", {}, refusedNote), // the later copy worked, but after now
      road("h@x.com", "2026-10-05T13:00:01Z", {}, okNote)
    ]
  };
  const rows = await readContacts(fixture, ORG);
  const at = (t) => rows.find((r) => iso(r.created_at) === t);
  assert.equal(at("2026-10-04T08:00:00.000Z").later_ok, true, "a fixed by A");
  assert.equal(at("2026-10-04T09:00:00.000Z").later_ok, false, "the fixing row itself");
  assert.equal(at("2026-10-04T06:00:00.000Z").later_ok, false, "b: an earlier success does not count");
  assert.equal(at("2026-10-04T10:00:00.000Z").later_ok, false, "b: nothing later");
  assert.equal(at("2026-10-04T11:00:00.000Z").later_ok, false, "c: another email");
  assert.equal(at("2026-10-04T13:00:00.000Z").later_ok, false, "f: another org");
  assert.equal(at("2026-10-04T15:00:00.000Z").later_ok, false, "g: the later copy failed too");
  assert.equal(at("2026-10-04T17:00:00.000Z").later_ok, false, "h: the later copy is in the future");
});

test("sql meaning: cf_seen is ClickFunnels itself posting the same email back, on or after the lead", { skip: SQL_SKIP }, async () => {
  const refusedNote = { cf_contact: { ok: false, error: "clickfunnels_refused", status: 422 } };
  const fixture = {
    events: [
      road("g@x.com", "2026-10-04T15:00:00Z", {}, refusedNote),
      cfRow("entry.captured", "G@x.com", "2026-10-04T15:02:00Z"), // posted back, other case: seen
      road("h@x.com", "2026-10-04T16:00:00Z", {}, refusedNote),
      cfRow("entry.captured", "h@x.com", "2026-10-04T15:59:00Z"), // posted BEFORE the lead: not seen
      road("i@x.com", "2026-10-04T17:00:00Z", {}, refusedNote),
      cfRow("entry.captured", "i@x.com", "2026-10-04T17:02:00Z", {}, { source: "slo" }), // not from ClickFunnels
      road("j@x.com", "2026-10-04T18:00:00Z", {}, refusedNote),
      cfRow("entry.captured", "other@x.com", "2026-10-04T18:02:00Z"), // another person
      road("k@x.com", "2026-10-04T19:00:00Z", {}, refusedNote),
      cfRow("entry.captured", "k@x.com", "2026-10-05T13:30:00Z"), // after now
      road("m@x.com", "2026-10-04T20:00:00Z", {}, refusedNote),
      cfRow("entry.captured", "m@x.com", "2026-10-04T20:02:00Z", { org_id: ORG_B }), // another org
      road("n@x.com", "2026-10-04T21:00:00Z", {}, refusedNote),
      cfRow("survey.submitted", "n@x.com", "2026-10-04T21:02:00Z") // a survey, not the contact post
    ]
  };
  const rows = await readContacts(fixture, ORG);
  const seen = Object.fromEntries(rows.map((r) => [iso(r.created_at), r.cf_seen]));
  assert.equal(seen["2026-10-04T15:00:00.000Z"], true, "g");
  assert.equal(seen["2026-10-04T16:00:00.000Z"], false, "h");
  assert.equal(seen["2026-10-04T17:00:00.000Z"], false, "i");
  assert.equal(seen["2026-10-04T18:00:00.000Z"], false, "j");
  assert.equal(seen["2026-10-04T19:00:00.000Z"], false, "k");
  assert.equal(seen["2026-10-04T20:00:00.000Z"], false, "m");
  assert.equal(seen["2026-10-04T21:00:00.000Z"], false, "n");
});

// A shadowed scope: gapChecks runs its own SQL text, on made-up rows.
function shadowScope(client, fixture) {
  const json = JSON.stringify(fixture);
  return async (fn) =>
    fn({
      async query(sql, params) {
        if (sql === FACTS_SQL) return client.query(shadowFacts(sql), [...params, json]);
        if (sql === CONTACTS_SQL) return client.query(shadowContacts(sql), [...params, json]);
        throw new Error(`unexpected query: ${String(sql).slice(0, 60)}`);
      }
    });
}

test("sql meaning, whole lane: one lead saved but refused, busy form pages and a silent ClickFunnels", { skip: SQL_SKIP }, async () => {
  const refusedNote = { cf_contact: { ok: false, error: "clickfunnels_refused", status: 401, message: "Unauthorized" } };
  const fixture = {
    ads: [ad("2026-10-03", 200, 210), ad("2026-10-04", 200, 210)],
    events: [
      ...Array.from({ length: 25 }, (_, i) => page("/roadmap", `r${i}`, "2026-10-04T10:00:00Z")),
      ...Array.from({ length: 22 }, (_, i) => page("/apply", `a${i}`, "2026-10-04T10:00:00Z")),
      road("lead@x.com", "2026-10-04T12:00:00Z", {}, refusedNote),
      road("old@x.com", "2026-10-01T12:00:00Z") // saved before the window: not a lead in it
    ],
    hooks: [post("twilio", "2026-10-04T10:00:00Z"), post("resend", "2026-10-04T10:00:00Z")]
  };
  const rows = await withReadOnly((c) => gapChecks({ scope: shadowScope(c, fixture), now: NOW, orgId: ORG }));
  rows.forEach(assertShape);
  const r = byId(rows);
  // A real person was saved on /roadmap, so the pipe is proven.
  assert.equal(r["lead:pipe-cut-with-traffic"].status, "PASS");
  assert.match(r["lead:pipe-cut-with-traffic"].detail, /1 person saved on the \/roadmap step 1/);
  // 22 people on the ClickFunnels form pages, other senders alive, ClickFunnels silent.
  assert.equal(r["lead:clickfunnels-posts-silent"].status, "FAIL");
  assert.match(r["lead:clickfunnels-posts-silent"].detail, /22 people opened a ClickFunnels form page/);
  assert.match(r["lead:clickfunnels-posts-silent"].detail, /Other senders left 2 receipts/);
  // The one copy was refused with a key error.
  assert.equal(r["lead:slo-contact-not-in-clickfunnels"].status, "FAIL");
  assert.match(r["lead:slo-contact-not-in-clickfunnels"].detail, /ClickFunnels refused it \(401: Unauthorized\)/);
});

test("sql meaning, whole lane: 400 clicks, 25 people on /roadmap, nobody saved -> the pipe check is FAIL", { skip: SQL_SKIP }, async () => {
  const fixture = {
    ads: [ad("2026-10-03", 200, 210), ad("2026-10-04", 200, 210)],
    events: Array.from({ length: 25 }, (_, i) => page("/roadmap", `r${i}`, "2026-10-04T10:00:00Z"))
  };
  const rows = await withReadOnly((c) => gapChecks({ scope: shadowScope(c, fixture), now: NOW, orgId: ORG }));
  rows.forEach(assertShape);
  const r = byId(rows);
  assert.equal(r["lead:pipe-cut-with-traffic"].status, "FAIL");
  assert.match(r["lead:pipe-cut-with-traffic"].detail, /400 link clicks/);
  assert.match(r["lead:pipe-cut-with-traffic"].detail, /25 people opened \/roadmap/);
  // 400 ad clicks alone do not make ClickFunnels "silent": nothing to judge (na), never FAIL.
  const posts = r["lead:clickfunnels-posts-silent"];
  assert.equal(posts.status, "na");
  assert.equal(posts.na.code, "low-traffic");
  assert.equal(posts.na.args.views, 0, "only /roadmap pages were opened, no ClickFunnels form page");
  const contact = r["lead:slo-contact-not-in-clickfunnels"];
  assert.equal(contact.status, "na");
  assert.equal(contact.na.code, "no-real-lead");
});

test("sql meaning, whole lane: a lead that ClickFunnels already held, and a lost copy next to it", { skip: SQL_SKIP }, async () => {
  const takenNote = { cf_contact: { ok: false, error: "clickfunnels_refused", status: 422, message: "Request unprocessable: Email address has already been taken" } };
  const fixture = {
    ads: [ad("2026-10-03", 5, 5), ad("2026-10-04", 5, 5)],
    events: [road("a@x.com", "2026-10-04T10:00:00Z", {}, takenNote)]
  };
  const ok = byId(await withReadOnly((c) => gapChecks({ scope: shadowScope(c, fixture), now: NOW, orgId: ORG })));
  assert.equal(ok["lead:slo-contact-not-in-clickfunnels"].status, "PASS");
  assert.match(ok["lead:slo-contact-not-in-clickfunnels"].detail, /already holds the email/);

  // The same day, plus a lead saved after the copy went live with no note at all, two hours ago.
  fixture.events.push(road("b@x.com", "2026-10-05T11:00:00Z"));
  const bad = byId(await withReadOnly((c) => gapChecks({ scope: shadowScope(c, fixture), now: NOW, orgId: ORG })));
  assert.equal(bad["lead:slo-contact-not-in-clickfunnels"].status, "FAIL");
  assert.match(bad["lead:slo-contact-not-in-clickfunnels"].detail, /1 of 2 real roadmap leads/);
  assert.match(bad["lead:slo-contact-not-in-clickfunnels"].detail, /no ClickFunnels answer was ever recorded/);
});
