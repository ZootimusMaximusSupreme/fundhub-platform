// Business credit alerts — readings, the change between two reports, and the
// text. Pure. Every company and score is fictional.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { businessReadings, compareReadings, businessCreditView, planBusinessCredit, businessBody } from "./business-credit.mjs";
import { lockScreenSafe } from "./bundle-common.mjs";

const NOW = "2026-11-06T16:00:00Z";
const BIZ = { id: "biz-1", name: "Sample Cedar LLC", entity_data: { state: "AZ" } };
const report = (name, intelliscore, fsr, state = "AZ") => ({
  name, state, ageMonths: 14, bin: "000000001",
  report: { data: { scoreInformation: { commercialScore: { score: intelliscore }, fsrScore: { score: fsr } } } }
});
const pull = (id, at, reports, extra = {}) => ({ id, created_at: at, result: { environment: "production", businessReports: reports, ...extra } });

const OLD = pull("p-old", "2026-10-06T15:00:00Z", [report("Sample Cedar LLC", 42, 30)]);
const NEW = pull("p-new", "2026-11-05T15:00:00Z", [report("Sample Cedar LLC", 55, 34)]);

describe("businessReadings — the Credit tab's reader, one pull at a time", () => {
  test("newest first, one per pull that has this company", () => {
    const other = pull("p-other", "2026-10-20T15:00:00Z", [report("Some Other Co", 70, 70)]);
    const rows = businessReadings([OLD, other, NEW], BIZ);
    assert.deepEqual(rows.map((r) => [r.pull_id, r.intelliscore, r.fsr]), [["p-new", 55, 34], ["p-old", 42, 30]]);
    assert.equal(rows[0].on, "2026-11-05");
  });

  test("a sandbox pull is a vendor's canned file and never counts", () => {
    const sandbox = pull("p-sbx", "2026-11-06T10:00:00Z", [report("Sample Cedar LLC", 99, 99)], { environment: "sandbox" });
    assert.equal(businessReadings([OLD, NEW, sandbox], BIZ)[0].pull_id, "p-new");
  });

  test("a company in another state is not this one", () => {
    assert.equal(businessReadings([pull("p-tx", NOW, [report("Sample Cedar LLC", 10, 10, "TX")])], BIZ).length, 0);
  });
});

describe("compareReadings", () => {
  test("both up is up; both down is down; one each way is mixed; nothing moved is same", () => {
    assert.equal(compareReadings({ intelliscore: 55, fsr: 34 }, { intelliscore: 42, fsr: 30 }).direction, "up");
    assert.equal(compareReadings({ intelliscore: 40, fsr: 30 }, { intelliscore: 42, fsr: 30 }).direction, "down");
    assert.equal(compareReadings({ intelliscore: 50, fsr: 20 }, { intelliscore: 42, fsr: 30 }).direction, "mixed");
    assert.equal(compareReadings({ intelliscore: 42, fsr: 30 }, { intelliscore: 42, fsr: 30 }).direction, "same");
  });

  test("a score on only one report is not a change, and a missing one is never zero", () => {
    const c = compareReadings({ intelliscore: 55, fsr: null }, { intelliscore: null, fsr: null });
    assert.equal(c.comparable, false);
    assert.equal(c.intelliscore, null);
    const half = compareReadings({ intelliscore: 55, fsr: 34 }, { intelliscore: 42, fsr: null });
    assert.deepEqual(half.intelliscore, { from: 42, to: 55, delta: 13 });
    assert.equal(half.fsr, null);
    assert.equal(half.direction, "up");
  });
});

describe("planBusinessCredit — the text", () => {
  test("a new report with a changed score: one text keyed on the business and the pull", () => {
    const p = planBusinessCredit(BIZ, [OLD, NEW], { now: NOW });
    assert.equal(p.alert, true);
    assert.equal(p.key, "fpa:biz:biz-1:p-new");
    assert.equal(p.templateKey, "SMS-FILE-PROTECT-BUSINESS-CREDIT");
    assert.deepEqual(p.tags, { change: "went up" });
    assert.equal(p.body, businessBody("went up"));
    assert.equal(p.dueOn, "2026-11-05");
    assert.deepEqual(p.detail.intelliscore, { from: 42, to: 55, delta: 13 });
  });

  test("the text names no business and no score", () => {
    const p = planBusinessCredit(BIZ, [OLD, NEW], { now: NOW });
    assert.ok(lockScreenSafe(p.body));
    assert.doesNotMatch(p.body, /Cedar|55|42|34|30/);
  });

  test("one report is nothing to compare", () => {
    assert.equal(planBusinessCredit(BIZ, [NEW], { now: NOW }).reason, "only_one_report");
    assert.equal(planBusinessCredit(BIZ, [], { now: NOW }).reason, "no_report");
  });

  test("an older report does not text late (the backlog stays quiet)", () => {
    assert.equal(planBusinessCredit(BIZ, [OLD, NEW], { now: "2026-11-20T16:00:00Z" }).reason, "report_too_old_to_alert");
  });

  test("a sample report never texts", () => {
    const sample = pull("p-sim", "2026-11-05T15:00:00Z", [report("Sample Cedar LLC", 60, 40)], { simulated: true });
    assert.equal(planBusinessCredit(BIZ, [OLD, sample], { now: NOW }).reason, "sample_report");
  });

  test("no change, no text", () => {
    const same = pull("p-same", "2026-11-05T15:00:00Z", [report("Sample Cedar LLC", 42, 30)]);
    assert.equal(planBusinessCredit(BIZ, [OLD, same], { now: NOW }).reason, "no_change");
  });

  test("businessCreditView shows both reports for the screen", () => {
    const v = businessCreditView(BIZ, [OLD, NEW]);
    assert.equal(v.reports, 2);
    assert.equal(v.latest.intelliscore, 55);
    assert.equal(v.previous.intelliscore, 42);
    assert.equal(v.change.direction, "up");
  });
});
