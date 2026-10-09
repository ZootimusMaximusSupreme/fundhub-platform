import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MORNING_BRIEF_LIVE,
  EVENING_BRIEF_CRON,
  formatMorningText,
  summarizeSystems,
  reportUrl,
  buildMorningBrief
} from "./morning-brief.mjs";
import { textMorningBrief } from "../pulse/notify.mjs";
import { verifyBriefToken } from "./brief-link.mjs";
import { TRIPWIRES } from "../pulse/tripwires.mjs";

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

/* ---------- the systems line: green, red, not checked, and "nothing to judge" ---------- */

const manyRows = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const greenRow = (i) => ({ id: `reg:ok-${i}`, status: "green", proof: "answered 200" });
const naRow = (i) => ({ id: `gap-ads:quiet-${i}`, status: "na", reason: "No ad is running. Judged the day one runs.", na_code: "no-running-ad", na_args: {} });
const redRow = (id, extra = {}) => ({ id, status: "red", proof: "x", ...extra });

/* From the real tripwire map: a check id that is money only, one that is customer only,
   and one that is on both. */
function tripwireIds() {
  const money = new Set();
  const customer = new Set();
  for (const e of Object.values(TRIPWIRES)) {
    for (const id of e.checks) (e.impact === "money" ? money : customer).add(id);
  }
  return {
    moneyOnly: [...money].find((id) => !customer.has(id)),
    customerOnly: [...customer].find((id) => !money.has(id)),
    both: [...money].find((id) => customer.has(id))
  };
}

test("the systems line counts green, red and 'nothing to judge' apart, and the numbers add up", () => {
  const checks = [
    ...manyRows(690, greenRow),
    redRow("job:one"), redRow("job:two"), redRow("job:three"),
    ...manyRows(64, naRow)
  ];
  const s = summarizeSystems({ checks });
  assert.equal(checks.length, 757);
  assert.equal(s.line, "Systems: 690 of 757 checks green. 3 red: job:one, job:two, job:three. 64 had nothing to judge today.");
  assert.deepEqual([s.total, s.green, s.red, s.na, s.not_checked], [757, 690, 3, 64, 0]);
  assert.equal(s.green + s.red + s.na + s.not_checked, s.total);
  assert.equal(s.reds.length, 3);
});

test("na is not 'not checked': 64 rows with nothing to judge leave not_checked at 0, and nothing needs you", () => {
  const s = summarizeSystems({ checks: [...manyRows(5, greenRow), ...manyRows(64, naRow)] });
  assert.equal(s.not_checked, 0);
  assert.equal(s.na, 64);
  assert.equal(s.line, "Systems: 5 of 69 checks green. 64 had nothing to judge today. Nothing needs you.");
});

test("'Nothing needs you' is never said while a row is red or not checked", () => {
  const red = summarizeSystems({ checks: [greenRow(1), redRow("job:a")] });
  assert.doesNotMatch(red.line, /Nothing needs you/);
  const nc = summarizeSystems({ checks: [greenRow(1), { id: "gap-x:y", status: "not_checked", reason: "no database" }, naRow(1)] });
  assert.equal(nc.not_checked, 1);
  assert.equal(nc.na, 1);
  assert.match(nc.line, /1 not checked\./);
  assert.match(nc.line, /1 had nothing to judge today\./);
  assert.doesNotMatch(nc.line, /Nothing needs you/);
  const clean = summarizeSystems({ checks: [greenRow(1), greenRow(2)] });
  assert.equal(clean.line, "Systems: 2 of 2 checks green. Nothing needs you.");
});

test("an odd status counts as not checked, never as green, red or na", () => {
  const s = summarizeSystems({ checks: [greenRow(1), { id: "a", status: "skip" }, { id: "b" }, { id: "c", status: "NA" }] });
  assert.deepEqual([s.green, s.red, s.na, s.not_checked], [1, 0, 0, 3]);
});

test("a missing scorecard still returns every key, with na at 0", () => {
  const s = summarizeSystems(null);
  assert.deepEqual(
    { status: s.status, total: s.total, green: s.green, red: s.red, na: s.na, not_checked: s.not_checked, reds: s.reds },
    { status: "missing", total: 0, green: 0, red: 0, na: 0, not_checked: 0, reds: [] }
  );
});

test("reds are named in this order: new today, money tripwire, customer tripwire, audit, the rest", () => {
  const { moneyOnly, customerOnly } = tripwireIds();
  assert.ok(moneyOnly && customerOnly, "the tripwire map has a money-only id and a customer-only id");
  const checks = [
    redRow("job:plain-old", { day_count: 9 }),
    redRow("audit:not-checked", { day_count: 3 }),
    redRow(customerOnly, { day_count: 4 }),
    redRow(moneyOnly, { day_count: 2 }),
    redRow("job:plain-new", { day_count: 1 }),
    redRow(`gap-lane:${moneyOnly}`, { day_count: 5 }),
    redRow("job:plain-old-two", { day_count: 7 })
  ];
  const s = summarizeSystems({ checks });
  assert.deepEqual(s.reds.map((r) => r.id), [
    "job:plain-new",               // new today beats everything
    moneyOnly,                     // then money, in the order they came
    `gap-lane:${moneyOnly}`,       // a lane in front of the id still matches
    customerOnly,
    "audit:not-checked",
    "job:plain-old",
    "job:plain-old-two"
  ]);
  assert.match(s.line, /7 red: job:plain-new, [^,]+, [^,]+, and 4 more in the report\./);
});

test("a new red that is a money tripwire comes before a new red that is plain", () => {
  const { moneyOnly } = tripwireIds();
  const s = summarizeSystems({ checks: [redRow("job:plain", { day_count: 1 }), redRow(moneyOnly, { day_count: 1 })] });
  assert.deepEqual(s.reds.map((r) => r.id), [moneyOnly, "job:plain"]);
});

test("an id on both money and customer ranks as money, and a red with no day_count is not 'new'", () => {
  const { both, customerOnly } = tripwireIds();
  assert.ok(both, "the tripwire map has an id on both lists");
  const s = summarizeSystems({ checks: [redRow(customerOnly, { day_count: 3 }), redRow(both, { day_count: 3 })] });
  assert.equal(s.reds[0].id, both);
  const s2 = summarizeSystems({ checks: [redRow("job:a"), redRow("job:b", { day_count: 1 })] });
  assert.deepEqual(s2.reds.map((r) => r.id), ["job:b", "job:a"]);
});

test("the sort never loses or changes a red, and the day suffix stays on reds past day 1", () => {
  const checks = [redRow("job:a", { day_count: 4 }), redRow("job:b", { day_count: 1 })];
  const s = summarizeSystems({ checks });
  assert.equal(s.reds.length, 2);
  assert.equal(s.reds[1], checks[0], "the very same row objects");
  assert.match(s.line, /2 red: job:b, job:a \(day 4\)\./);
});
