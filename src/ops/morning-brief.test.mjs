import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MORNING_BRIEF_LIVE,
  EVENING_BRIEF_CRON,
  formatMorningText,
  summarizeSystems,
  reportUrl,
  buildMorningBrief,
  runMorningBrief
} from "./morning-brief.mjs";
import { textMorningBrief } from "../pulse/notify.mjs";
import { verifyBriefToken } from "./brief-link.mjs";

const LINK_ENV = { APP_BASE_URL: "https://fundhub.ai", BRIEF_LINK_SECRET: "c3".repeat(32) };
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

const SIX_AM_AZ = new Date("2026-10-05T13:00:00Z");

test("the morning and evening texts are on", () => {
  assert.equal(MORNING_BRIEF_LIVE, true);
  assert.equal(EVENING_BRIEF_CRON, "0 4 * * *");
});

test("the morning text names systems, money, marketing, team, one suggestion, and the report link", () => {
  const systems = summarizeSystems({
    checks: [
      { id: "health", status: "green", proof: "answered 200" },
      { id: "login", status: "red", day_count: 2 }
    ]
  });
  const text = formatMorningText({
    kind: "morning",
    now: SIX_AM_AZ,
    systems,
    marketing: { ads_line: "Ads and sales yesterday: $10 spend.", dying_line: "Dying ads: none flagged." },
    money: { line: "Money: $1 in, $2 out." },
    team: { line: "Team, yesterday: 3 calls held, 1 no-shows, 1 sales, 33% close rate." },
    suggestions: { line: "Suggestion: fix the login door." },
    reportUrl: "https://fundhub.ai/app/morning-brief.html?date=2026-10-05"
  });
  assert.match(text, /^Good morning, Chris\./);
  assert.match(text, /Systems: 1 of 2 checks green/);
  assert.match(text, /Money: \$1 in/);
  assert.match(text, /Ads and sales/);
  assert.match(text, /Team, yesterday/);
  assert.match(text, /Suggestion: fix the login door/);
  assert.equal(text.match(/Suggestion:/g).length, 1);
  assert.match(text, /Full report: https:\/\/fundhub\.ai\/app\/morning-brief\.html\?date=2026-10-05/);
});

test("the evening text reuses a stored systems line and does not invent a second check", () => {
  const text = formatMorningText({
    kind: "evening",
    now: new Date("2026-10-06T04:00:00Z"),
    systems: { line: "Systems: 4 of 4 checks green. Nothing needs you." },
    marketing: { ads_line: "Ads and sales today so far: no ad spend synced." },
    money: { line: "Money: not connected yet." },
    team: { line: "Team, today so far: 0 calls held." },
    suggestions: { line: "Suggestions: none today." },
    reportUrl: reportUrl("2026-10-05", LINK_ENV, "evening", ORG)
  });
  assert.match(text, /^Good evening, Chris\./);
  assert.match(text, /Systems: 4 of 4 checks green/);
  assert.match(text, /kind=evening/);
});

test("a dry run does not call the text sender", async () => {
  let calls = 0;
  const out = await textMorningBrief({
    body: "Good morning, Chris.",
    env: { PULSE_SMS_TO: "+15555550865" },
    dryRun: true,
    sendImpl: async () => { calls += 1; return { status: "sent" }; }
  });
  assert.equal(calls, 0);
  assert.equal(out.delivery_status, "dry_run");
  assert.equal(out.sent_to_last4, "0865");
});

test("the text uses PULSE_SMS_TO and does not invent a number", async () => {
  const missing = await textMorningBrief({ body: "Good morning, Chris.", env: {}, dryRun: false });
  assert.equal(missing.delivery_status, "no_number");
  assert.equal(missing.sent_to_last4, null);

  const sends = [];
  const sent = await textMorningBrief({
    body: "Good morning, Chris.",
    env: { PULSE_SMS_TO: "+15555550865" },
    dryRun: false,
    now: SIX_AM_AZ, // texting hours: 6:00 a.m. Arizona is inside the window
    sendImpl: async (msg) => {
      sends.push(msg);
      return { status: "sent", providerMessageId: "SM1" };
    }
  });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, "+15555550865");
  assert.equal(sent.sent_to_last4, "0865");
  assert.equal(sent.delivery_status, "sent");
});

/* ---------- the report link carries its code (brief-link.mjs) ---------- */

const EMPTY_DB = { query: async () => ({ rows: [], rowCount: 0 }) };
const NINE_OCT_AZ = new Date("2026-10-09T13:00:00Z");

function quietWarn(fn) {
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => { warned.push(a.join(" ")); };
  return Promise.resolve()
    .then(fn)
    .then((out) => ({ out, warned }))
    .finally(() => { console.warn = orig; });
}

test("reportUrl builds the tokened link, and the token in it verifies", () => {
  for (const kind of ["morning", "evening"]) {
    const url = reportUrl("2026-10-09", LINK_ENV, kind, ORG);
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://fundhub.ai/app/morning-brief.html");
    assert.equal(u.searchParams.get("date"), "2026-10-09");
    assert.equal(u.searchParams.get("kind"), kind === "evening" ? "evening" : null);
    const k = u.searchParams.get("k");
    assert.match(k, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(verifyBriefToken({ orgId: ORG, kind, date: "2026-10-09", token: k, env: LINK_ENV, now: NINE_OCT_AZ }), true);
  }
});

test("reportUrl is null, and never throws, with no secret or no org", () => {
  assert.equal(reportUrl("2026-10-09", { APP_BASE_URL: "https://fundhub.ai" }, "morning", ORG), null);
  assert.equal(reportUrl("2026-10-09", { BRIEF_LINK_SECRET: "short" }, "morning", ORG), null);
  assert.equal(reportUrl("2026-10-09", { BRIEF_LINK_SECRET: "*".repeat(64) }, "morning", ORG), null);
  assert.equal(reportUrl("2026-10-09", LINK_ENV, "morning"), null);
  assert.equal(reportUrl("2026-10-09", null, "morning", ORG), null);
  assert.equal(reportUrl("not-a-date", LINK_ENV, "morning", ORG), null);
  assert.equal(reportUrl("2026-10-09", LINK_ENV, "weekly", ORG), null);
});

test("the built text ends with the tokened link, and that token verifies", async () => {
  const { out: brief, warned } = await quietWarn(() => buildMorningBrief(EMPTY_DB, {
    orgId: ORG, kind: "morning", env: LINK_ENV, now: NINE_OCT_AZ,
    scorecard: { checks: [{ id: "health", status: "green" }] }, suggest: async () => []
  }));
  assert.equal(warned.length, 0);
  const last = brief.text_body.split("\n").at(-1);
  assert.match(last, /^Full report: https:\/\/fundhub\.ai\/app\/morning-brief\.html\?date=2026-10-09&k=[A-Za-z0-9_-]{32}$/);
  assert.equal(brief.report_url, last.slice("Full report: ".length));
  const k = new URL(brief.report_url).searchParams.get("k");
  assert.equal(verifyBriefToken({ orgId: ORG, kind: "morning", date: "2026-10-09", token: k, env: LINK_ENV, now: NINE_OCT_AZ }), true);
});

test("with no secret the text still builds and says the report is not available", async () => {
  const { out: brief, warned } = await quietWarn(() => buildMorningBrief(EMPTY_DB, {
    orgId: ORG, kind: "evening", env: { APP_BASE_URL: "https://fundhub.ai" }, now: new Date("2026-10-10T04:00:00Z"),
    scorecard: { checks: [{ id: "health", status: "green" }] }, suggest: async () => []
  }));
  assert.match(brief.text_body, /^Good evening, Chris\./);
  assert.equal(brief.text_body.split("\n").at(-1), "Full report: not available");
  assert.equal(brief.report_url, null);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /BRIEF_LINK_SECRET/);
  assert.doesNotMatch(brief.text_body, /k=/);
});

/* ---------- texting hours (owner law 2026-10-09, .claude/rules/texting-hours.md) ---------- */

/* A database that answers every read with no rows and keeps the one morning_briefs save. */
function savingDb() {
  const saved = [];
  return {
    saved,
    query: async (sql, params) => {
      if (/INSERT INTO morning_briefs/.test(sql)) {
        saved.push({ delivery_status: params[12], sent_to_last4: params[10], text_body: params[8], kind: params[15] });
        return { rows: [{ delivery_status: params[12] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}
async function runBrief(now, kind, sendImpl) {
  const db = savingDb();
  const { out } = await quietWarn(() => runMorningBrief({
    db, orgId: ORG, kind, live: true, now,
    env: { ...LINK_ENV, PULSE_SMS_TO: "+15555550865" },
    scorecard: { checks: [{ id: "health", status: "green" }] }, suggest: async () => [], sendImpl
  }));
  return { out, db };
}

test("texting hours: the 9:00 p.m. evening brief goes out", async () => {
  const sends = [];
  const { out } = await runBrief(new Date("2026-10-10T04:00:00Z"), "evening", async (m) => { sends.push(m); return { status: "sent", providerMessageId: "SM1" }; });
  assert.equal(out.delivery.delivery_status, "sent");
  assert.equal(sends.length, 1);
});

test("texting hours: an evening brief retried at 10:10 p.m. is held, and the row is still saved as held_quiet_hours", async () => {
  const { out, db } = await runBrief(new Date("2026-10-10T05:10:00Z"), "evening", async () => { throw new Error("must not text at night"); });
  assert.equal(out.ok, true, "a held brief is not a failed brief, so the pulse job sends no fallback text");
  assert.equal(out.delivery.delivery_status, "held_quiet_hours");
  const row = db.saved[0];
  assert.equal(row.delivery_status, "held_quiet_hours", "never lost: the brief and its report link are saved");
  assert.match(row.text_body, /^Good evening, Chris\./);
  assert.equal(row.sent_to_last4, "0865");
});

test("texting hours: the 6:00 a.m. brief goes; one second before 6 it would be held", async () => {
  const sends = [];
  const send = async (m) => { sends.push(m); return { status: "sent", providerMessageId: "SM2" }; };
  const six = await runBrief(new Date("2026-10-09T13:00:00Z"), "morning", send);
  assert.equal(six.out.delivery.delivery_status, "sent");
  const early = await runBrief(new Date("2026-10-09T12:59:59Z"), "morning", send);
  assert.equal(early.out.delivery.delivery_status, "held_quiet_hours");
  assert.equal(sends.length, 1);
});

test("the migration lets a held brief save (the old CHECK allowed four values)", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../db/migrations/476_morning_briefs_held_quiet_hours.sql", import.meta.url), "utf8");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS morning_briefs_delivery_status_ck/);
  assert.match(sql, /CHECK \(delivery_status IN \('dry_run', 'sent', 'failed', 'no_number', 'held_quiet_hours'\)\)/);
});
