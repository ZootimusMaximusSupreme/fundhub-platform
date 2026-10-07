import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MORNING_BRIEF_LIVE,
  EVENING_BRIEF_CRON,
  formatMorningText,
  summarizeSystems,
  reportUrl
} from "./morning-brief.mjs";
import { textMorningBrief } from "../pulse/notify.mjs";

const SIX_AM_AZ = new Date("2026-10-05T13:00:00Z");

test("the morning and evening texts stay off until a real number can be read", () => {
  assert.equal(MORNING_BRIEF_LIVE, false);
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
    reportUrl: reportUrl("2026-10-05", { APP_BASE_URL: "https://fundhub.ai" }, "evening")
  });
  assert.match(text, /^Good evening, Chris\./);
  assert.match(text, /Systems: 4 of 4 checks green/);
  assert.match(text, /kind=evening/);
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
