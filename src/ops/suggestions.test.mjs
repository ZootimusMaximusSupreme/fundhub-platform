// Unit tests for src/ops/suggestions.mjs — the cadence law as code.
// The SQL is proven against a real Postgres in src/http/ops-suggestions.pg.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  CADENCE_DEFAULTS, RULES, SKIPPED_RULES,
  validDate, addDays, phoenixToday,
  fixBrokenCandidate, pageChangeCandidates, spendRampCandidate,
  rank, applyQuiet, applyPageChangeWindow, writeUp, buildSuggestions
} from "./suggestions.mjs";

const c = (rule, subject, dollars, score = 0) => ({
  rule, subject_key: subject, headline: "h", numbers: { score }, dollar_impact_cents: dollars
});

describe("cadence defaults (owner-set 2026-10-05)", () => {
  test("the law's numbers", () => {
    assert.strictEqual(CADENCE_DEFAULTS.maxPerMorning, 3);
    assert.strictEqual(CADENCE_DEFAULTS.passedQuietDays, 7);
    assert.strictEqual(CADENCE_DEFAULTS.budgetMoveMaxPct, 20);
    assert.strictEqual(CADENCE_DEFAULTS.budgetMoveSpacingDays, 3);
    assert.strictEqual(CADENCE_DEFAULTS.pageChangeEveryDays, 7);
  });
  test("every skipped rule says why", () => {
    for (const s of SKIPPED_RULES) assert.ok(s.why.length > 40, s.rule);
  });
});

describe("dates", () => {
  test("validDate takes only a real YYYY-MM-DD", () => {
    assert.strictEqual(validDate("2026-10-05"), "2026-10-05");
    assert.strictEqual(validDate("2026-02-30"), null);
    assert.strictEqual(validDate("10/05/2026"), null);
    assert.strictEqual(validDate(undefined), null);
  });
  test("addDays crosses a month", () => {
    assert.strictEqual(addDays("2026-10-28", 7), "2026-11-04");
  });
  test("today is Arizona's day, not UTC's", () => {
    // 03:00 UTC on the 6th is 20:00 on the 5th in Arizona.
    assert.strictEqual(phoenixToday(new Date("2026-10-06T03:00:00Z")), "2026-10-05");
  });
});

describe("rule 2: broken things", () => {
  test("nothing open, no suggestion", () => {
    assert.strictEqual(fixBrokenCandidate({ open_count: 0 }), null);
  });
  test("open dead letters make one, with no invented dollar figure", () => {
    const s = fixBrokenCandidate({ open_count: 4, gave_up_count: 1, new_yesterday: 2, top_handler: "drip", top_handler_count: 3 });
    assert.strictEqual(s.rule, "fix_broken_same_day");
    assert.strictEqual(s.dollar_impact_cents, null);
    assert.match(s.headline, /4 broken steps are still open/);
    assert.match(s.headline, /drip \(3\)/);
    assert.strictEqual(s.numbers.score, 4);
  });
});

describe("rule 6: the dying-ad opening", () => {
  const row = (over = {}) => ({
    ad_id: "a1", ad_name: "SLO Ad 7", metric_date: "2026-10-04",
    video_plays: 200, video_p25_watched: 40, clicks: 2, spend_7d_cents: "12345", ...over
  });
  test("dies before 25% and no tap-through: suggest a new opening, dollars = last 7 days of spend", () => {
    const [s] = pageChangeCandidates([row()]);
    assert.strictEqual(s.rule, "page_change_weekly");
    assert.strictEqual(s.subject_key, "ad:a1");
    assert.strictEqual(s.dollar_impact_cents, 12345);
    assert.match(s.headline, /20% of 200 plays/);
    assert.match(s.headline, /\$123\.45/);
  });
  test("a hop (they tapped through) is not a suggestion", () => {
    assert.deepStrictEqual(pageChangeCandidates([row({ clicks: 60 })]), []);
  });
  test("too few plays is not a suggestion", () => {
    assert.deepStrictEqual(pageChangeCandidates([row({ video_plays: 5, video_p25_watched: 1 })]), []);
  });
});

describe("rule 4 with rule 5 as its limit: raise daily spend", () => {
  const ok = {
    spend_this_week_cents: 140000, spend_last_week_cents: 140000,
    booked_this_week: 40, booked_last_week: 35, sales_this_week: 2,
    last_budget_change_at: null,
    calendar: { packed: false, closer_count: 1, due_at_count: 20, threshold: 45 }
  };
  test("all three steps pass: up to 20% of the average day", () => {
    const s = spendRampCandidate(ok);
    assert.strictEqual(s.rule, "raise_spend_ramp");
    assert.strictEqual(s.numbers.avg_daily_spend_cents, 20000);
    assert.strictEqual(s.numbers.max_raise_per_day_cents, 4000);
    assert.strictEqual(s.dollar_impact_cents, 28000);
  });
  test("cost per booked went up: no", () => {
    assert.strictEqual(spendRampCandidate({ ...ok, booked_this_week: 20 }), null);
  });
  test("closers at the 90% line: no", () => {
    assert.strictEqual(spendRampCandidate({ ...ok, calendar: { ...ok.calendar, packed: true } }), null);
  });
  test("no sales that week: no", () => {
    assert.strictEqual(spendRampCandidate({ ...ok, sales_this_week: 0 }), null);
  });
  test("a budget change in the last 3 days: no", () => {
    assert.strictEqual(spendRampCandidate({ ...ok, last_budget_change_at: new Date() }), null);
  });
  test("too few booked people to measure a cost: no", () => {
    assert.strictEqual(spendRampCandidate({ ...ok, booked_last_week: 3 }), null);
  });
});

describe("ranking", () => {
  test("biggest dollar impact first, unknown after known, at most 3", () => {
    const out = rank([c("fix_broken_same_day", "f", null, 9), c("page_change_weekly", "ad:1", 500), c("raise_spend_ramp", "d", 9000), c("page_change_weekly", "ad:2", 100)]);
    assert.deepStrictEqual(out.map((s) => s.subject_key), ["d", "ad:1", "ad:2"]);
  });
  test("unknown dollar impact is never treated as 0 and still shows when there is room", () => {
    const out = rank([c("fix_broken_same_day", "f", null, 9), c("page_change_weekly", "ad:1", 0)]);
    assert.deepStrictEqual(out.map((s) => s.subject_key), ["ad:1", "f"]);
  });
});

describe("rule 8: a passed suggestion stays quiet 7 days unless the numbers get worse", () => {
  const passed = { rule: "fix_broken_same_day", subject_key: "failed_events", status: "passed", quiet_until: "2026-10-10", numbers: { score: 4 } };
  test("same numbers inside the window: held", () => {
    const { shown, held } = applyQuiet([c("fix_broken_same_day", "failed_events", null, 4)], [passed], "2026-10-06");
    assert.strictEqual(shown.length, 0);
    assert.strictEqual(held.length, 1);
  });
  test("numbers got worse: shown again", () => {
    const { shown } = applyQuiet([c("fix_broken_same_day", "failed_events", null, 5)], [passed], "2026-10-06");
    assert.strictEqual(shown.length, 1);
  });
  test("window over: shown again", () => {
    const { shown } = applyQuiet([c("fix_broken_same_day", "failed_events", null, 4)], [passed], "2026-10-10");
    assert.strictEqual(shown.length, 1);
  });
  test("an open (not passed) one is not held", () => {
    const { shown } = applyQuiet([c("fix_broken_same_day", "failed_events", null, 4)], [{ ...passed, status: "open", quiet_until: null }], "2026-10-06");
    assert.strictEqual(shown.length, 1);
  });
});

describe("rule 6: one page change at a time, once a week", () => {
  test("only the biggest page change shows", () => {
    const { shown, held } = applyPageChangeWindow(
      [c("page_change_weekly", "ad:1", 100), c("page_change_weekly", "ad:2", 900), c("fix_broken_same_day", "f", null)],
      { takenWithinWindow: false });
    assert.deepStrictEqual(shown.map((s) => s.subject_key).sort(), ["ad:2", "f"]);
    assert.strictEqual(held.length, 1);
  });
  test("one taken in the last 7 days: none show", () => {
    const { shown } = applyPageChangeWindow([c("page_change_weekly", "ad:1", 100)], { takenWithinWindow: true });
    assert.strictEqual(shown.length, 0);
  });
});

describe("the model write-up", () => {
  const s = fixBrokenCandidate({ open_count: 2, gave_up_count: 0, new_yesterday: 1, top_handler: "x", top_handler_count: 2 });
  test("no model key: NULL, never a made-up line", async () => {
    assert.strictEqual(await writeUp(s, { env: {} }), null);
  });
  test("model answers: its text, and it was handed only the numbers", async () => {
    let sent = null;
    const fetchImpl = async (_url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Two broken steps. Fix today." } }] }) };
    };
    const out = await writeUp(s, { env: { OPENAI_API_KEY: "sk-test-not-real-1234567890" }, fetchImpl });
    assert.strictEqual(out, "Two broken steps. Fix today.");
    const user = JSON.parse(sent.messages.find((m) => m.role === "user").content);
    assert.strictEqual(user.rule, RULES.fix_broken_same_day);
    assert.strictEqual(user.numbers.open_count, 2);
  });
  test("model down: NULL", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.strictEqual(await writeUp(s, { env: { OPENAI_API_KEY: "sk-test-not-real-1234567890" }, fetchImpl }), null);
  });
});

describe("buildSuggestions input checks", () => {
  test("org required", async () => {
    assert.deepStrictEqual(await buildSuggestions({ db: {}, date: "2026-10-05" }), { ok: false, reason: "org_id_required" });
  });
  test("a bad date is refused before any read", async () => {
    const db = { query: () => { throw new Error("must not query"); } };
    assert.deepStrictEqual(await buildSuggestions({ db, orgId: "o", date: "2026-13-01" }), { ok: false, reason: "date_must_be_yyyy_mm_dd" });
  });
});
