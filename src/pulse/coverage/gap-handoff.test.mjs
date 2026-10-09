// Hand-off tripwires — fakes only. No live database. Nothing is sent.
// This file proves the wording, the placeholders and the status rules. It cannot
// prove the SQL: the fake database returns canned counts. The SQL is proved by
// gap-handoff.pg.test.mjs, which runs every query on a real Postgres (read only)
// for made-up people. That file skips without DATABASE_URL.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyVisitor } from "../../slo/visitor.mjs";
import { mapToCanonical } from "../../adapters/bland.mjs";
import { OUTCOMES as CLOSER_OUTCOMES } from "../../sales/beliefs.mjs";
import {
  ALL_SQL,
  CHECK_IDS,
  CONFIRM_GRACE_MIN,
  CONTACT_197_GRACE_HOURS,
  CONTACT_197_KEYS,
  CONTACT_M1_GRACE_MIN,
  CONTACT_M1_KEYS,
  CONTACT_REPLIED_KEYS,
  DEFAULT_ORG_SQL,
  LOOKBACK_DAYS,
  NOBOOK_GRACE_MIN,
  NOSHOW_GRACE_MIN,
  NUDGE_GRACE_MIN,
  OFFER_GRACE_MIN,
  OFFER_KEYS,
  REMIND_24H_BOOKED_AHEAD_HOURS,
  REMIND_24H_WITHIN_HOURS,
  REMIND_2H_BOOKED_AHEAD_MIN,
  REMIND_2H_WITHIN_MIN,
  REMIND_BOOKED_LOOKBACK_DAYS,
  TEMPLATES,
  WELCOME_GRACE_MIN,
  assertSelect,
  gapChecks,
  testAddressSql
} from "./gap-handoff.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-09T13:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const MARKERS = [
  "welcome", "nudge", "nobook", "contact-m1", "contact-197", "confirm",
  "remind-24h", "remind-2h", "noshow", "offer", "declined", "templates"
];

function fakeDb(answers = {}, opts = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (opts.hang) return new Promise(() => {});
      if (/FROM orgs/.test(sql)) return { rows: answers.org || [] };
      const marker = /gap:handoff-([a-z0-9-]+)/.exec(sql)?.[1];
      if (!marker) throw new Error(`unexpected query: ${String(sql).slice(0, 60)}`);
      if (opts.throwOn === marker) throw new Error(`relation "events" does not exist (${marker})`);
      if (marker === "templates") return { rows: answers.templates || [] };
      const a = answers[marker] || {};
      return {
        rows: [{
          n: "n" in a ? a.n : 0,
          newest: a.newest ?? null,
          sample: a.sample ?? null,
          silent_n: a.silentN ?? 0
        }]
      };
    }
  };
}

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const ctxOf = (db, extra = {}) => ({ db, orgId: ORG, now: NOW, ...extra });

function assertShape(rows) {
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  for (const r of rows) {
    assert.ok(r.status === "PASS" || r.status === "FAIL" || r.status === "skip", r.id);
    assert.equal(typeof r.detail, "string");
    assert.ok(r.detail.length > 0);
    if (r.status === "FAIL") {
      assert.equal(typeof r.suggestedFix, "string");
      assert.match(r.suggestedFix, /Do not send from this check/);
      assert.match(r.suggestedFix, /Recon stays the one tripwire/);
    } else {
      assert.equal(r.suggestedFix, null, `${r.id} ${r.status} must carry no fix`);
    }
  }
}

/* ------------------------------------------------------------------ ids and SQL */

test("handoff: the five check ids, all new, none used by another lane", () => {
  assert.deepEqual([...CHECK_IDS], [
    "handoff:lead-first-touches-missing",
    "handoff:contact-no-followup",
    "handoff:booking-no-confirm",
    "handoff:reminder-missing",
    "handoff:call-outcome-no-followup"
  ]);
  assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
  for (const file of fs.readdirSync(HERE)) {
    if (!/^(gap|slice)-.*\.mjs$/.test(file) || file.endsWith(".test.mjs") || file === "gap-handoff.mjs") continue;
    const text = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of CHECK_IDS) {
      assert.ok(!text.includes(`"${id}"`) && !text.includes(`'${id}'`), `${file} already names ${id}`);
    }
  }
  // tripwires.mjs is left out on purpose: it is the map that names which deep check guards
  // which surface, so it must name these ids. No other check file may.
  for (const file of ["registry.mjs", "heartbeats.mjs"]) {
    const text = fs.readFileSync(path.join(HERE, "..", file), "utf8");
    for (const id of CHECK_IDS) assert.ok(!text.includes(`"${id}"`), `${file} already names ${id}`);
  }
});

test("handoff: every read is a SELECT with its own marker and no write word", () => {
  const seen = new Set();
  for (const [name, sql] of Object.entries(ALL_SQL)) {
    assert.doesNotThrow(() => assertSelect(sql), name);
    assert.match(sql, /^\/\* gap:handoff-[a-z0-9-]+ \*\//, `${name} has no marker`);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|create|grant)\b/i, name);
    assert.doesNotMatch(sql, /\b(begin|commit|rollback)\b|\bset\s+(local|session)?/i, name);
    seen.add(/gap:handoff-([a-z0-9-]+)/.exec(sql)[1]);
  }
  assert.deepEqual([...seen].sort(), [...MARKERS].sort());
  assert.doesNotMatch(DEFAULT_ORG_SQL, /\b(insert|update|delete)\b/i);
});

test("handoff: a write is refused before it is sent", async () => {
  for (const bad of [
    "UPDATE messages SET status = 'sent'",
    "DELETE FROM events",
    "WITH x AS (SELECT 1) INSERT INTO tasks SELECT 1",
    "INSERT INTO messages VALUES (1)",
    "TRUNCATE events"
  ]) {
    assert.throws(() => assertSelect(bad), /refused a write/, bad);
  }
  assert.doesNotThrow(() => assertSelect("/* gap:x */ WITH a AS (SELECT 1) SELECT * FROM a"));
});

test("handoff: each query uses exactly the placeholders the check hands it", async () => {
  const db = fakeDb();
  await gapChecks(ctxOf(db));
  const sent = new Map();
  for (const c of db.calls) {
    const marker = /gap:handoff-([a-z0-9-]+)/.exec(c.sql)[1];
    const highest = Math.max(...[...c.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(highest, c.params.length, `${marker}: SQL uses $${highest}, check passed ${c.params.length}`);
    for (let i = 1; i <= highest; i += 1) assert.match(c.sql, new RegExp(`\\$${i}\\b`), `${marker}: $${i} unused`);
    sent.set(marker, c);
  }
  assert.deepEqual([...sent.keys()].sort(), MARKERS.filter((m) => m !== "templates").sort());
});

test("handoff: no repo file is read and nothing is fetched at run time", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-handoff.mjs"), "utf8");
  assert.doesNotMatch(src, /from\s+["']node:(fs|path|child_process|http|https)["']/);
  assert.doesNotMatch(src, /readFileSync|readdirSync|\bfetch\s*\(|import\.meta\.url|require\(/);
  assert.doesNotMatch(src, /from\s+["']\.\.\/\.\.\/(workflows|db|messaging|handlers|events)/);
  assert.doesNotMatch(src, /sendTemplated|inngest\.send|emit\(/);
});

/* ------------------------------------------------------------------ PASS and shape */

test("handoff: nothing missing is five PASS rows with no fix", async () => {
  const db = fakeDb();
  const rows = await gapChecks(ctxOf(db));
  assertShape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.equal(db.calls.length, 11, "11 branch reads, no template lookup when nothing is red");
});

/* ------------------------------------------------------------------ check 1 */

test("handoff: a lead with no welcome email is RED and names the people and the age", async () => {
  const newest = new Date(NOW.getTime() - 6 * DAY - 14 * HOUR);
  const rows = await gapChecks(ctxOf(fakeDb({ welcome: { n: 2, newest, sample: "FH-000532" } })));
  assertShape(rows);
  const r = byId(rows)["handoff:lead-first-touches-missing"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^2 new leads got no welcome email \(EMAIL-S00-WELCOME\) 30\+ minutes after signing up/);
  assert.match(r.detail, /newest 6 days ago, FH-000532/);
  assert.doesNotMatch(r.detail, /nudge|chase/);
  assert.match(r.suggestedFix, /s-00-welcome/);
  assert.match(r.suggestedFix, /INNGEST_EVENT_KEY/);
  for (const other of CHECK_IDS.filter((id) => id !== "handoff:lead-first-touches-missing")) {
    assert.equal(byId(rows)[other].status, "PASS");
  }
});

test("handoff: each first-touch branch goes red alone and says which one", async () => {
  const cases = [
    ["nudge", /1 lead had not finished the survey after 25 minutes and got no nudge email \(EMAIL-S02-FINISH-APPLICATION\)/, /welcome|chase/],
    ["nobook", /1 lead finished the survey, never booked, and got no chase email \(EMAIL-NOBOOK-01\) after 2\.5 hours/, /welcome email|nudge/]
  ];
  for (const [marker, want, notWant] of cases) {
    const r = byId(await gapChecks(ctxOf(fakeDb({ [marker]: { n: 1 } }))))["handoff:lead-first-touches-missing"];
    assert.equal(r.status, "FAIL", marker);
    assert.match(r.detail, want, marker);
    assert.doesNotMatch(r.detail, notWant, marker);
  }
  const all = byId(await gapChecks(ctxOf(fakeDb({ welcome: { n: 1 }, nudge: { n: 3 }, nobook: { n: 4 } }))))["handoff:lead-first-touches-missing"];
  assert.match(all.detail, /1 new lead got no welcome/);
  assert.match(all.detail, /3 leads had not finished/);
  assert.match(all.detail, /4 leads finished the survey/);
});

/* ------------------------------------------------------------------ check 2 */

test("handoff: a /roadmap contact with no follow-up is RED; the $197 branch is separate", async () => {
  const m1 = byId(await gapChecks(ctxOf(fakeDb({ "contact-m1": { n: 1, sample: "d***@gmail.com" } }))))["handoff:contact-no-followup"];
  assert.equal(m1.status, "FAIL");
  assert.match(m1.detail, /^1 person left an email on \/roadmap, did not pay, and got no follow-up note after 30 minutes/);
  assert.match(m1.detail, /d\*\*\*@gmail\.com/);
  assert.doesNotMatch(m1.detail, /\$197/);
  assert.match(m1.suggestedFix, /slo-genuine-followup/);
  const o = byId(await gapChecks(ctxOf(fakeDb({ "contact-197": { n: 2 } }))))["handoff:contact-no-followup"];
  assert.equal(o.status, "FAIL");
  assert.match(o.detail, /^2 people got the first note, never replied or paid, and got no \$197 offer after 25 hours/);
  assert.match(o.suggestedFix, /Commas/);
});

/* ------------------------------------------------------------------ check 3 */

test("handoff: a booking with no confirm email is RED; it says when the text is missing too", async () => {
  const both = byId(await gapChecks(ctxOf(fakeDb({ confirm: { n: 3, silentN: 2, sample: "FH-000600" } }))))["handoff:booking-no-confirm"];
  assert.equal(both.status, "FAIL");
  assert.match(both.detail, /^3 booked customers got no booking confirm email \(EMAIL-S04-01-CONFIRM, it carries the portal link\) 20\+ minutes after booking/);
  assert.match(both.detail, /2 of them got no confirm text either/);
  const emailOnly = byId(await gapChecks(ctxOf(fakeDb({ confirm: { n: 1, silentN: 0 } }))))["handoff:booking-no-confirm"];
  assert.equal(emailOnly.status, "FAIL");
  assert.match(emailOnly.detail, /^1 booked customer got no booking confirm email/);
  assert.doesNotMatch(emailOnly.detail, /confirm text either/);
});

/* ------------------------------------------------------------------ check 4 */

test("handoff: a missing reminder is RED and the two reminders are told apart", async () => {
  const soon = new Date(NOW.getTime() + 3 * HOUR);
  const r24 = byId(await gapChecks(ctxOf(fakeDb({ "remind-24h": { n: 1, newest: soon, sample: "FH-000700" } }))))["handoff:reminder-missing"];
  assert.equal(r24.status, "FAIL");
  assert.match(r24.detail, /^1 booked customer with a call inside 22 hours \(or one that just happened\) got no 24-hour reminder text/);
  assert.match(r24.detail, /latest call in 3 h, FH-000700/);
  assert.doesNotMatch(r24.detail, /2-hour/);
  const r2 = byId(await gapChecks(ctxOf(fakeDb({ "remind-2h": { n: 2, newest: new Date(NOW.getTime() - 5 * HOUR) } }))))["handoff:reminder-missing"];
  assert.equal(r2.status, "FAIL");
  assert.match(r2.detail, /^2 booked customers with a call inside 110 minutes/);
  assert.match(r2.detail, /latest call 5 h ago/);
  assert.doesNotMatch(r2.detail, /24-hour/);
  assert.match(r2.suggestedFix, /sleeps until the reminder time/);
});

/* ------------------------------------------------------------------ check 5 */

test("handoff: nothing after the call is RED for all three branches", async () => {
  const cases = [
    ["noshow", /1 no-show got no recovery email \(EMAIL-S05A-NOSHOW-RECOVERY\) 20\+ minutes after missing the call/],
    ["offer", /1 customer finished a closer call with an offer picked and got no offer email \(EMAIL-OFFER-\*\) after 30 minutes/],
    ["declined", /1 customer ended a call as declined \(outcome "declined", any kind of call\) and no follow-up task was made after 30 minutes/]
  ];
  for (const [marker, want] of cases) {
    const rows = await gapChecks(ctxOf(fakeDb({ [marker]: { n: 1, sample: "FH-000800" } })));
    assertShape(rows);
    const r = byId(rows)["handoff:call-outcome-no-followup"];
    assert.equal(r.status, "FAIL", marker);
    assert.match(r.detail, want, marker);
    assert.match(r.suggestedFix, /s-05a-no-show-recovery|s-offer-bucket|s-08-post-call-funding-declined/);
  }
});

/* ------------------------------------------------------------------ the two rules the SQL got wrong once */

test("handoff: the first note counts from any day, because /roadmap saves a contact row every day and the note goes once", () => {
  // slo-genuine-followup locks the first note once per client, so a second-day contact row gets none ("already_sent_m1").
  const genuine = WF("slo-genuine-followup.mjs");
  assert.match(genuine, /LOCK_M1 = "slo_genuine_m1_sent_at"/);
  assert.match(genuine, /already_sent_m1/);
  assert.match(fs.readFileSync(path.join(ROOT, "api/public/slo-interest.mjs"), "utf8"), /one slo\.contact_started row\s+per email per day/);
  // A first note counts at any time. The $197 branch still wants the note AFTER its own row.
  assert.doesNotMatch(ALL_SQL.CONTACT_M1_SQL, /m\.created_at >= l\.created_at/, "a first note sent after an earlier day must count");
  assert.match(ALL_SQL.CONTACT_197_SQL, /m\.created_at >= l\.created_at/);
});

test("handoff: the declined task reads every call that ends declined; the offer email reads closer calls only", () => {
  // s-08 gates on the outcome alone.
  const s08 = WF("s-08-post-call-funding-declined.mjs");
  assert.match(s08, /payload\?\.outcome !== "declined"/);
  assert.doesNotMatch(s08.split("export async function handle")[1].split("export const")[0], /disposition/);
  // A closer call can never end declined. The one call that does is the Bland AI call.
  assert.ok(!CLOSER_OUTCOMES.includes("declined"), "a closer outcome is never declined");
  const [bland] = mapToCanonical({ isCompleted: true, callId: "c1", status: "completed", disposition: "declined" });
  assert.equal(bland.name, "call.completed");
  assert.equal(bland.payload.outcome, "declined");
  assert.equal(bland.payload.disposition, "declined");
  // So the declined read must not be limited to the closer disposition.
  assert.match(ALL_SQL.DECLINED_SQL, /e\.payload->>'outcome' = 'declined'/);
  assert.doesNotMatch(ALL_SQL.DECLINED_SQL, /'disposition'/);
  assert.match(ALL_SQL.OFFER_SQL, /e\.payload->>'disposition' = 'closer'/);
  assert.doesNotMatch(ALL_SQL.OFFER_SQL, /e\.payload->>'outcome' = 'declined'/);
});

/* ------------------------------------------------------------------ honest status */

test("handoff: a count that does not come back is skip, never PASS", async () => {
  const db = fakeDb({ confirm: { n: null } });
  const rows = await gapChecks(ctxOf(db));
  const r = byId(rows)["handoff:booking-no-confirm"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /count came back unreadable/);
  assert.equal(r.suggestedFix, null);
  for (const id of CHECK_IDS.filter((x) => x !== "handoff:booking-no-confirm")) assert.equal(byId(rows)[id].status, "PASS");
});

test("handoff: one read that throws skips only its own check, with the reason", async () => {
  const rows = await gapChecks(ctxOf(fakeDb({}, { throwOn: "contact-197" })));
  assertShape(rows);
  const r = byId(rows)["handoff:contact-no-followup"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /\$197 offer: relation "events" does not exist/);
  for (const id of CHECK_IDS.filter((x) => x !== "handoff:contact-no-followup")) assert.equal(byId(rows)[id].status, "PASS");
});

test("handoff: a red branch stays red when another branch cannot be read", async () => {
  // welcome is red, nudge throws. A known break is never hidden behind a failed read.
  const rows = await gapChecks(ctxOf(fakeDb({ welcome: { n: 5 } }, { throwOn: "nudge" })));
  assertShape(rows);
  const r = byId(rows)["handoff:lead-first-touches-missing"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^5 new leads got no welcome email/);
  assert.match(r.detail, /Could not read: finish-application nudge: relation "events" does not exist/);
});

test("handoff: nothing red and a branch unread is skip, never PASS", async () => {
  const rows = await gapChecks(ctxOf(fakeDb({}, { throwOn: "nudge" })));
  const r = byId(rows)["handoff:lead-first-touches-missing"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /finish-application nudge/);
  assert.equal(r.suggestedFix, null);
});

test("handoff: no database or no company is five skips that say why", async () => {
  let rows = await gapChecks({ orgId: ORG, now: NOW });
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "skip" && /no database/.test(r.detail)));
  rows = await gapChecks(ctxOf(fakeDb({ org: [] }), { orgId: "" }));
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "skip" && /no company/.test(r.detail)));
});

test("handoff: when the pulse hands in no company the default one is looked up once", async () => {
  const other = "22222222-2222-4222-8222-222222222222";
  const db = fakeDb({ org: [{ id: other }] });
  const rows = await gapChecks({ db, now: NOW });
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(db.calls.filter((c) => /FROM orgs/.test(c.sql)).length, 1);
  assert.ok(db.calls.filter((c) => !/FROM orgs/.test(c.sql)).every((c) => c.params[0] === other));
});

test("handoff: the staff scope is used when the pulse hands one in", async () => {
  const plain = fakeDb();
  const staff = fakeDb({ welcome: { n: 1 } });
  const rows = await gapChecks({ db: plain, scope: (fn) => fn(staff), orgId: ORG, now: NOW });
  assert.equal(plain.calls.length, 0, "the plain pool was not touched");
  assert.ok(staff.calls.length >= 11);
  assert.equal(byId(rows)["handoff:lead-first-touches-missing"].status, "FAIL");
});

test("handoff: a read that hangs becomes a skip and does not hang the pulse", async () => {
  const t0 = Date.now();
  const rows = await gapChecks(ctxOf(fakeDb({}, { hang: true }), { readTimeoutMs: 20 }));
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "skip" && /took too long/.test(r.detail)));
  assert.ok(Date.now() - t0 < 3000);
});

/* ------------------------------------------------------------------ clocks */

test("handoff: the cutoffs are the grace times before now, and the window is 7 days", async () => {
  const db = fakeDb();
  await gapChecks(ctxOf(db));
  const call = (marker) => db.calls.find((c) => c.sql.includes(`gap:handoff-${marker} `));
  const iso = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const start = iso(LOOKBACK_DAYS * DAY);
  assert.equal(LOOKBACK_DAYS, 7);

  assert.deepEqual(call("welcome").params, [ORG, ["entry.captured"], start, iso(30 * MIN)]);
  assert.deepEqual(call("nudge").params, [ORG, ["entry.captured"], start, iso(25 * MIN)]);
  assert.deepEqual(call("nobook").params, [ORG, ["survey.submitted"], start, iso(150 * MIN)]);
  assert.deepEqual(call("contact-m1").params, [ORG, start, iso(30 * MIN)]);
  assert.deepEqual(call("contact-197").params, [ORG, start, iso(25 * HOUR)]);
  assert.deepEqual(call("confirm").params, [ORG, ["booking.created", "booking.rescheduled"], start, iso(20 * MIN)]);
  assert.deepEqual(call("noshow").params, [ORG, ["booking.noshow"], start, iso(20 * MIN)]);
  assert.deepEqual(call("offer").params, [ORG, start, iso(30 * MIN)]);
  assert.deepEqual(call("declined").params, [ORG, start, iso(30 * MIN)]);
  assert.deepEqual(call("remind-24h").params, [ORG, iso(30 * DAY), NOW.toISOString(), "SMS-S04-02-REMIND-24H"]);
  assert.deepEqual(call("remind-2h").params, [ORG, iso(30 * DAY), NOW.toISOString(), "SMS-S04-03-REMIND-2H"]);

  assert.equal(WELCOME_GRACE_MIN, 30);
  assert.equal(CONTACT_M1_GRACE_MIN, 30);
  assert.equal(CONTACT_197_GRACE_HOURS, 25);
  assert.equal(CONFIRM_GRACE_MIN, 20);
  assert.equal(NOSHOW_GRACE_MIN, 20);
  assert.equal(OFFER_GRACE_MIN, 30);
  assert.equal(REMIND_24H_WITHIN_HOURS, 22);
  assert.equal(REMIND_2H_WITHIN_MIN, 110);
  assert.equal(REMIND_BOOKED_LOOKBACK_DAYS, 30);
});

test("handoff: the reminder SQL only reads calls inside the window and booked far enough ahead", () => {
  const sql24 = ALL_SQL.REMIND_24H_SQL;
  const sql2 = ALL_SQL.REMIND_2H_SQL;
  assert.match(sql24, /interval '22 hours'/);
  assert.match(sql24, /interval '25 hours'/);
  assert.match(sql2, /interval '110 minutes'/);
  assert.match(sql2, /interval '130 minutes'/);
  for (const sql of [sql24, sql2]) {
    assert.match(sql, /interval '72 hours'/, "a call that already started is still read for 72 hours");
    assert.match(sql, /booking\.cancelled/);
    assert.match(sql, /opted_in_at IS NULL/);
    assert.match(sql, /COALESCE\(e\.is_demo, false\) = false/);
  }
  assert.equal(REMIND_24H_BOOKED_AHEAD_HOURS, 25);
  assert.equal(REMIND_2H_BOOKED_AHEAD_MIN, 130);
});

/* ------------------------------------------------------------------ cause: templates */

test("handoff: when a template is the cause the fix says so", async () => {
  const templates = [
    { template_key: "EMAIL-S00-WELCOME", missing: false, approved: false, draft: false },
    { template_key: "EMAIL-S02-FINISH-APPLICATION", missing: false, approved: true, draft: true },
    { template_key: "EMAIL-NOBOOK-01", missing: true, approved: false, draft: false }
  ];
  const rows = await gapChecks(ctxOf(fakeDb({ welcome: { n: 1 }, nudge: { n: 1 }, nobook: { n: 1 }, templates })));
  const r = byId(rows)["handoff:lead-first-touches-missing"];
  assert.equal(r.status, "FAIL");
  assert.match(r.suggestedFix, /Template problem: EMAIL-S00-WELCOME is not approved; EMAIL-S02-FINISH-APPLICATION is still draft copy; EMAIL-NOBOOK-01 does not exist\./);
});

test("handoff: good templates add no template note, and a failed template read does not hide the red", async () => {
  const ok = [{ template_key: "EMAIL-S00-WELCOME", missing: false, approved: true, draft: false }];
  let r = byId(await gapChecks(ctxOf(fakeDb({ welcome: { n: 1 }, templates: ok }))))["handoff:lead-first-touches-missing"];
  assert.equal(r.status, "FAIL");
  assert.doesNotMatch(r.suggestedFix, /Template problem/);
  r = byId(await gapChecks(ctxOf(fakeDb({ welcome: { n: 1 } }, { throwOn: "templates" }))))["handoff:lead-first-touches-missing"];
  assert.equal(r.status, "FAIL");
  assert.doesNotMatch(r.suggestedFix, /Template problem/);
});

/* ------------------------------------------------------------------ the workflows this copies */

const WF = (name) => fs.readFileSync(path.join(ROOT, "src/workflows", name), "utf8");

test("handoff: the template keys are the ones the workflows really send", () => {
  assert.match(WF("s-00-welcome.mjs"), new RegExp(`EMAIL_TEMPLATE_KEY = "${TEMPLATES.welcome}"`));
  assert.match(WF("s-02-incomplete-survey-nudge.mjs"), new RegExp(`EMAIL_TEMPLATE_KEY = "${TEMPLATES.nudge}"`));
  assert.match(WF("s-nobook-chase.mjs"), new RegExp(`EMAIL_NOBOOK_01 = "${TEMPLATES.nobook}"`));
  const s04b = WF("s-04b-booking-reminders.mjs");
  assert.match(s04b, new RegExp(`SMS_CONFIRM = "${TEMPLATES.confirmSms}"`));
  assert.match(s04b, new RegExp(`EMAIL_CONFIRM = "${TEMPLATES.confirmEmail}"`));
  assert.match(s04b, new RegExp(`SMS_REMIND_24H = "${TEMPLATES.remind24h}"`));
  assert.match(s04b, new RegExp(`SMS_REMIND_2H = "${TEMPLATES.remind2h}"`));
  assert.match(WF("s-05a-no-show-recovery.mjs"), new RegExp(`EMAIL_TEMPLATE_KEY = "${TEMPLATES.noshow}"`));
  const genuine = WF("slo-genuine-followup.mjs");
  for (const key of CONTACT_M1_KEYS) assert.ok(genuine.includes(`"${key}"`), `${key} is not in slo-genuine-followup.mjs`);
  for (const key of CONTACT_REPLIED_KEYS) assert.ok(genuine.includes(`"${key}"`), `${key} is not in slo-genuine-followup.mjs`);
  const r197 = WF("slo-no-reply-197.mjs");
  for (const key of CONTACT_197_KEYS) assert.ok(r197.includes(`"${key}"`), `${key} is not in slo-no-reply-197.mjs`);
});

test("handoff: the offer keys and the declined task are the ones the workflows really use", () => {
  const offer = WF("s-offer-bucket.mjs");
  const block = /OFFER_EMAIL = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(offer)[1];
  const keys = [...block.matchAll(/^\s*(\w+):\s*"EMAIL-OFFER-/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [...OFFER_KEYS].sort());
  assert.ok(offer.includes('payload.disposition !== "closer"'));
  assert.ok(offer.includes('outcome === "not_a_fit"'));
  assert.ok(offer.includes("offer_bucket_email_sent_at"), "the once-per-client lock this check relies on");
  assert.ok(offer.includes("funding-mastery"));
  const s08 = WF("s-08-post-call-funding-declined.mjs");
  assert.ok(s08.includes('outcome !== "declined"'));
  assert.ok(s08.includes("createTask"));
  assert.ok(WF("s-00-welcome.mjs").includes("claimCustomFieldLock"), "welcome is once per client, so any welcome counts");
  assert.equal(TEMPLATES.offerPrefix, "EMAIL-OFFER-");
});

test("handoff: the grace times are longer than the waits in the workflows", () => {
  const sleepOf = (src, id) => new RegExp(`step\\.sleep\\("${id}",\\s*"([0-9]+)([mh])"\\)`).exec(src);
  const toMin = ([, n, u]) => Number(n) * (u === "h" ? 60 : 1);
  assert.ok(NUDGE_GRACE_MIN > toMin(sleepOf(WF("s-02-incomplete-survey-nudge.mjs"), "wait-20-min")));
  assert.ok(NOBOOK_GRACE_MIN > toMin(sleepOf(WF("s-nobook-chase.mjs"), "wait-2h")));
  assert.match(WF("slo-genuine-followup.mjs"), /WAIT_M1 = "15m"/);
  assert.ok(CONTACT_M1_GRACE_MIN > 15);
  assert.match(WF("slo-no-reply-197.mjs"), /WAIT_NO_REPLY = "24h"/);
  assert.ok(CONTACT_197_GRACE_HOURS > 24);
  const s04b = WF("s-04b-booking-reminders.mjs");
  assert.match(s04b, /at\(24 \* HOUR\)/);
  assert.match(s04b, /at\(2 \* HOUR\)/);
  assert.match(s04b, /REMINDER_SKEW_MS = 5 \* 60 \* 1000/);
  assert.ok(REMIND_24H_BOOKED_AHEAD_HOURS * 60 > 24 * 60 + 5, "booked-ahead margin beats the 5 minute skew");
  assert.ok(REMIND_2H_BOOKED_AHEAD_MIN > 2 * 60 + 5);
  assert.ok(REMIND_24H_WITHIN_HOURS < 24);
  assert.ok(REMIND_2H_WITHIN_MIN < 120);
});

test("handoff: the reminders, the repeat rule and the registered workflows still match the code", () => {
  const cf = fs.readFileSync(path.join(ROOT, "src/adapters/clickfunnels.mjs"), "utf8");
  assert.match(cf, /FUNNEL_REPEAT_WINDOW_MINUTES = 6 \* 60/);
  assert.match(cf, /REPEAT_SUPPRESSED_EVENTS = new Set\(\["survey\.submitted", "entry\.captured"\]\)/);
  assert.match(ALL_SQL.NUDGE_SQL, /interval '6 hours'/);
  assert.match(ALL_SQL.NOBOOK_SQL, /interval '6 hours'/);
  assert.doesNotMatch(ALL_SQL.WELCOME_SQL, /interval '6 hours'/, "welcome is once per client, repeats cannot make a miss");
  const index = fs.readFileSync(path.join(ROOT, "src/workflows/index.mjs"), "utf8");
  for (const name of [
    "s00Welcome", "s02IncompleteSurveyNudge", "sNobookChase", "sloGenuineFollowup", "sloNoReply197",
    "s04bBookingReminders", "s05aNoShowRecovery", "sOfferBucket", "s08PostCallFundingDeclined"
  ]) {
    assert.ok(new RegExp(`^\\s{2}${name},?\\s*$`, "m").test(index), `${name} is not in the registered list`);
  }
  const optOut = fs.readFileSync(path.join(ROOT, "src/lib/opt-out.mjs"), "utf8");
  assert.match(optOut, /opted_in_at IS NULL/);
});

/* ------------------------------------------------------------------ who counts as a customer */

test("handoff: the test-address rule agrees with classifyVisitor and adds the +fhtest tag", () => {
  const sql = testAddressSql("addr");
  const regexes = [...sql.matchAll(/~ '([^']+)'/g)].map((m) => new RegExp(m[1]));
  const domains = /IN \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(domains, ["fundhub.ai", "example.com", "example.net", "example.org"]);
  assert.match(sql, /LIKE '%\.fundhub\.ai'/);
  const isTest = (email) => {
    const [local, domain] = String(email).toLowerCase().split("@");
    return domains.includes(domain) || domain.endsWith(".fundhub.ai") || regexes.some((re) => re.test(local));
  };
  const people = [
    "maria.lopez@gmail.com", "dennis@thedrinklabs.com", "steven@neuralytica.ai", "stanbridgejchris@gmail.com",
    "tim@testament.org", "contest@gmail.com", "latest.news@gmail.com", "simon@gmail.com", "attest@yahoo.com"
  ];
  const ours = [
    "chris@fundhub.ai", "e2e+roadmap@gmail.com", "bakerskater987+test.sim.1786581578@gmail.com",
    "stanbridgejchris+sim-01@gmail.com", "x@example.com", "x@example.org", "test.walker+1790829090752@gmail.com",
    "e2e+roadmap-fields@test.fundhub.ai"
  ];
  for (const email of people) assert.equal(isTest(email), false, `${email} is a customer`);
  for (const email of ours) assert.equal(isTest(email), true, `${email} is ours`);
  // Same answer as the workflow's own gate for everything it decides.
  for (const email of [...people, ...ours]) {
    assert.equal(isTest(email), classifyVisitor({ email }).actor === "agent", `classifyVisitor disagrees on ${email}`);
  }
  assert.equal(isTest("someone@test.fundhub.ai"), true, "a company sub-domain is ours (stricter than classifyVisitor)");
  assert.equal(isTest("someone+fhtest@gmail.com"), true, "the +fhtest tag is one of ours");
  assert.equal(isTest("someone+fhtest-run4@gmail.com"), true);
  assert.equal(isTest("fhtest@gmail.com"), false, "the tag counts only after a +");
});
