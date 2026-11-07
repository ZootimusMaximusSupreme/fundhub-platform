// CSM tracking rules — each rule is tested both ways: a case that passes and a
// case that would fail if the rule broke. Fake data only; nothing here reaches
// Postgres, a vendor or a network, and nothing sends.
import test from "node:test";
import assert from "node:assert/strict";

import {
  STUCK_DAYS, SEASONED_DAYS, TRACKING_ROLES, MAX_CLIENTS,
  arizonaDay, wholeDays, calendarDays, summarizeSteps, stepFacts, paymentFacts, seasoningFacts,
  fundabilityFacts, applyGate, gateNeedsEngine, behindReasons, sortTracking, nudgeDrafts,
  positionFromRow, listParams, readTrackingList, readClientPosition, TRACKING_LIST_SQL, TrackingInputError
} from "./client-tracking.mjs";
import { STEPS, FINAL_STEP } from "../nudge/ladder.mjs";

const NOW = new Date("2026-11-07T18:00:00.000Z"); // 11:00 a.m. Arizona
const ORG = "0a000000-0000-4000-8000-000000000001";
const STAFF = "5a000000-0000-4000-8000-000000000001";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c1000000-0000-4000-8000-000000000002";
const C3 = "c1000000-0000-4000-8000-000000000003";
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const dayAgo = (n) => arizonaDay(new Date(NOW.getTime() - n * 86400000));

const step = (over = {}) => ({
  id: "w1", key: "pay_card", title: "Pay Card A down to $400", state: "not_started", state_reason: null,
  owner_kind: "client", due_at: null, created_at: daysAgo(12), completed_at: null, position: 1, ...over
});

const fundPayload = ({ tier = "not_fundable", score = 4, inquiries = true, hasPull = true } = {}) => ({
  ok: true, has_pull: hasPull, sample: false,
  now: {
    score, score_max: 6, tier,
    factors: [
      { key: "score_700", label: "Credit score 700 or higher", passed: true },
      { key: "utilization_30", label: "Cards used 30% or less", passed: false },
      { key: "no_inquiries", label: "No hard inquiries", passed: inquiries, value: inquiries ? 0 : 3 }
    ]
  }
});

/* ── constants come from where the rule lives ─────────────────────────────── */

test("a step is stuck after the same days the nudge ladder hands a step to a person", () => {
  assert.equal(STUCK_DAYS, STEPS.find((s) => s.step === FINAL_STEP).daysOverdue);
  assert.equal(STUCK_DAYS, 9);
  assert.equal(SEASONED_DAYS, 30, "owner-set 2026-11-07");
  assert.deepEqual([...TRACKING_ROLES].sort(), ["admin", "csm", "owner"]);
});

test("Arizona's day is UTC-7 with no daylight saving", () => {
  assert.equal(arizonaDay(new Date("2026-11-07T06:59:00Z")), "2026-11-06");
  assert.equal(arizonaDay(new Date("2026-11-07T07:00:00Z")), "2026-11-07");
  assert.equal(arizonaDay(new Date("2026-07-01T06:30:00Z")), "2026-06-30", "summer is the same offset");
  assert.equal(wholeDays(null, NOW), null, "an unknown date is unknown, not 0 days");
  assert.equal(wholeDays(daysAgo(3.5), NOW), 3);
  assert.equal(wholeDays(new Date(NOW.getTime() + 86400000).toISOString(), NOW), 0, "never below 0");
  assert.equal(calendarDays("2026-10-01", "2026-11-07"), 37);
  assert.equal(calendarDays("not a day", "2026-11-07"), null);
});

/* ── the step ──────────────────────────────────────────────────────────────── */

test("the current step is the first open one by position, and days on it start at the later of its start or the last finished step", () => {
  const s = summarizeSteps([
    step({ id: "w3", key: "third", position: 3 }),
    step({ id: "w1", key: "first", position: 1, state: "done", completed_at: daysAgo(4) }),
    step({ id: "w2", key: "second", position: 2, title: "Remove the late payment", created_at: daysAgo(20) })
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.current.id, "w2", "position 2 is next, not the later row");
  const f = stepFacts(s, NOW);
  assert.equal(f.current.title, "Remove the late payment");
  assert.equal(f.current.days_on_step, 4, "finishing step 1 four days ago restarts the clock, not the 20-day-old row");
  assert.equal(f.current.since, daysAgo(4));
});

test("a client step with no due date is stuck at 9 days on it, and not at 8", () => {
  const stuck = stepFacts(summarizeSteps([step({ created_at: daysAgo(9) })]), NOW);
  assert.equal(stuck.current.days_on_step, 9);
  assert.equal(stuck.current.days_late, null, "no due date is never late (330)");
  assert.deepEqual(behindReasons({ steps: stuck }).map((r) => r.code), ["step_stuck"]);
  const fine = stepFacts(summarizeSteps([step({ created_at: daysAgo(8) })]), NOW);
  assert.deepEqual(behindReasons({ steps: fine }), []);
});

test("a late client step is behind only once the auto reminders are done", () => {
  const early = stepFacts(summarizeSteps([step({ due_at: daysAgo(3), created_at: daysAgo(30) })]), NOW);
  assert.equal(early.current.days_late, 3);
  assert.equal(early.current.reminders, "running");
  assert.deepEqual(behindReasons({ steps: early }), [], "the ladder is still texting; a CSM nudge now would double it");
  const late = stepFacts(summarizeSteps([step({ due_at: daysAgo(10), created_at: daysAgo(30) })]), NOW);
  assert.equal(late.current.reminders, "done");
  const reasons = behindReasons({ steps: late });
  assert.deepEqual(reasons.map((r) => r.code), ["step_late"]);
  assert.match(reasons[0].words, /10 days late\. The auto reminders are done\./);
  const edge = stepFacts(summarizeSteps([step({ due_at: daysAgo(9), created_at: daysAgo(30) })]), NOW);
  assert.equal(edge.current.reminders, "done", "day 9 is the ladder's last rung");
  assert.deepEqual(behindReasons({ steps: edge }).map((r) => r.code), ["step_late"], "exactly 9 days late is behind");
  const dayBefore = stepFacts(summarizeSteps([step({ due_at: daysAgo(8.5), created_at: daysAgo(30) })]), NOW);
  assert.equal(dayBefore.current.reminders, "running");
  assert.deepEqual(behindReasons({ steps: dayBefore }), [], "8 days late is not yet");
  const future = stepFacts(summarizeSteps([step({ due_at: new Date(NOW.getTime() + 86400000).toISOString(), created_at: daysAgo(40) })]), NOW);
  assert.equal(future.current.days_late, null);
  assert.deepEqual(behindReasons({ steps: future }), [], "a step inside its deadline is not stuck, however long it has been open");
});

test("a step only our team can do never counts as the client falling behind, but a blocked step always does", () => {
  const ours = stepFacts(summarizeSteps([step({ owner_kind: "fundhub", due_at: daysAgo(20), created_at: daysAgo(40) })]), NOW);
  assert.equal(ours.current.owner, "fundhub");
  assert.equal(ours.current.reminders, null, "the ladder never chases a step the client does not own");
  assert.deepEqual(behindReasons({ steps: ours }), []);
  const blocked = stepFacts(summarizeSteps([step({ owner_kind: "fundhub", state: "blocked", state_reason: "Waiting on the bank letter" })]), NOW);
  const r = behindReasons({ steps: blocked });
  assert.deepEqual(r.map((x) => x.code), ["step_blocked"]);
  assert.equal(r[0].words, "Step is blocked: Waiting on the bank letter");
});

test("a finished list says finished, and an empty list does not", () => {
  const done = stepFacts(summarizeSteps([step({ state: "done", completed_at: daysAgo(1) }), step({ id: "w2", key: "b", state: "skipped", position: 2 })]), NOW);
  assert.equal(done.finished, true);
  assert.equal(done.current, null);
  assert.equal(stepFacts(summarizeSteps([]), NOW).finished, false);
});

test("a stored paid alternative rides along with its own price; none stored is null, never $0", () => {
  const priced = stepFacts(summarizeSteps([step({ paid_alternative_price_cents: "29700", paid_alternative_label: "Have us do it" })]), NOW);
  assert.deepEqual(priced.current.paid_alternative, { label: "Have us do it", price_cents: 29700 });
  const none = stepFacts(summarizeSteps([step({ paid_alternative_price_cents: null })]), NOW);
  assert.equal(none.current.paid_alternative, null);
});

/* ── payments ──────────────────────────────────────────────────────────────── */

test("late payments: the bank's flag and late Fundhub plan payments, and unknown stays null", () => {
  assert.deepEqual(paymentFacts({ bankLate: 1, bankKnown: 2, plansOpen: 1, planLate: 2 }), { bank_late: 1, plan_late: 2, total_late: 3 });
  assert.deepEqual(paymentFacts({ bankLate: 0, bankKnown: 0, plansOpen: 0, planLate: 0 }), { bank_late: null, plan_late: null, total_late: null },
    "the bank told us nothing and there is no plan: unknown, not 0 late");
  assert.deepEqual(paymentFacts({ bankLate: 0, bankKnown: 3 }), { bank_late: 0, plan_late: null, total_late: 0 }, "the bank said on time: a real 0");
  assert.equal(behindReasons({ payments: paymentFacts({ bankLate: 1, bankKnown: 1 }) })[0].code, "bank_late");
  assert.equal(behindReasons({ payments: paymentFacts({ plansOpen: 1, planLate: 1 }) })[0].code, "plan_late");
  assert.deepEqual(behindReasons({ payments: paymentFacts({ bankLate: 0, bankKnown: 1 }) }), []);
});

/* ── seasoning ─────────────────────────────────────────────────────────────── */

test("the seasoning clock counts days from opening, seasons at 30 and marks 60 and 90", () => {
  const today = arizonaDay(NOW);
  const s = seasoningFacts([
    { bank: "Chase", opened_on: dayAgo(12) },
    { bank: "Bank of America", opened_on: dayAgo(45) },
    { bank: "Wells Fargo", opened_on: dayAgo(95) },
    { bank: "US Bank", opened_on: dayAgo(29) },
    { bank: "No date", opened_on: null }
  ], today);
  assert.equal(s.opened, 4, "an account with no opening day is not on the clock");
  assert.equal(s.seasoned, 2);
  const by = Object.fromEntries(s.accounts.map((a) => [a.bank, a]));
  assert.deepEqual([by.Chase.day, by.Chase.seasoned, by.Chase.next_mark], [12, false, 30]);
  assert.deepEqual([by["US Bank"].day, by["US Bank"].seasoned], [29, false], "29 days is not 30");
  assert.deepEqual([by["Bank of America"].seasoned, by["Bank of America"].better, by["Bank of America"].next_mark], [true, null, 60]);
  assert.deepEqual([by["Wells Fargo"].better, by["Wells Fargo"].next_mark], [90, null]);
  assert.deepEqual(s.closest, { bank: "US Bank", day: 29, of: 30 }, "the one nearest to seasoned");
  assert.deepEqual(seasoningFacts([], today), { opened: 0, seasoned: 0, closest: null, accounts: [] });
});

/* ── can they apply ────────────────────────────────────────────────────────── */

test("the apply gate opens only when UnderwriteIQ says fundable, inquiries are clean and an account is seasoned", () => {
  const seasoned = seasoningFacts([{ bank: "Chase", opened_on: dayAgo(31) }], arizonaDay(NOW));
  const open = applyGate({ fund: fundabilityFacts(fundPayload({ tier: "fundable", score: 6 })), seasoning: seasoned });
  assert.equal(open.state, "open");
  assert.deepEqual(open.checks.map((c) => c.passed), [true, true, true]);
  assert.equal(open.checks[0].words, "6 of 6 checks · Fundable");

  const inquiries = applyGate({ fund: fundabilityFacts(fundPayload({ tier: "fundable", score: 5, inquiries: false })), seasoning: seasoned });
  assert.equal(inquiries.state, "locked");
  assert.equal(inquiries.checks[1].words, "3 inquiries on file");

  const young = seasoningFacts([{ bank: "Chase", opened_on: dayAgo(12) }], arizonaDay(NOW));
  const notSeasoned = applyGate({ fund: fundabilityFacts(fundPayload({ tier: "fundable", score: 6 })), seasoning: young });
  assert.equal(notSeasoned.state, "locked", "fundable is not enough without a seasoned account");
  assert.equal(notSeasoned.checks[2].words, "Chase is on day 12 of 30");

  const notRead = applyGate({ fund: null, seasoning: seasoned });
  assert.equal(notRead.state, "unknown", "the engine not read is never 'open'");
  const noPull = applyGate({ fund: fundabilityFacts(fundPayload({ hasPull: false, tier: null, score: null, inquiries: null })), seasoning: seasoned });
  assert.equal(noPull.state, "unknown");
  assert.equal(noPull.checks[0].words, "No credit report on file");
  assert.equal(applyGate({ fund: null, seasoning: seasoningFacts([], "2026-11-07") }).checks[2].words, "No bank account opened yet");
});

test("the list runs UnderwriteIQ only when a seasoned account could open the gate", () => {
  assert.equal(gateNeedsEngine(seasoningFacts([{ bank: "Chase", opened_on: dayAgo(30) }], arizonaDay(NOW))), true);
  assert.equal(gateNeedsEngine(seasoningFacts([{ bank: "Chase", opened_on: dayAgo(5) }], arizonaDay(NOW))), false);
  assert.equal(gateNeedsEngine(null), false);
});

test("fundability facts read the engine's own counts and never invent a score", () => {
  const f = fundabilityFacts(fundPayload());
  assert.deepEqual([f.score, f.score_max, f.tier, f.inquiries_clean], [4, 6, "not_fundable", true]);
  assert.deepEqual(f.failing, ["Cards used 30% or less"]);
  assert.equal(fundabilityFacts(null), null);
  assert.equal(fundabilityFacts({ now: { tier: "made_up" } }).tier, null, "a tier the engine does not print is unknown");
});

/* ── order and words ───────────────────────────────────────────────────────── */

test("falling behind sorts first, then the most reasons, then the longest stuck, then by name", () => {
  const row = (id, name, behind, days) => ({ client_id: id, client_name: name, behind: Array(behind).fill({ code: "x" }), steps: { current: { days_on_step: days, days_late: null } } });
  const sorted = sortTracking([row("a", "Zed", 0, 50), row("b", "Amy", 1, 3), row("c", "Bo", 2, 1), row("d", "Cy", 1, 20), row("e", "Al", 0, 1), row("f", "Ab", 0, 1)]);
  assert.deepEqual(sorted.map((r) => r.client_id), ["c", "d", "b", "a", "f", "e"],
    "a 50-day client on track still sorts after any client falling behind; same days sort by name");
});

test("nudge words are signed by Chris, name the step, name no price and use no maybe-words", () => {
  const steps = stepFacts(summarizeSteps([step()]), NOW);
  const d = nudgeDrafts({ firstName: "Alex", steps, payments: paymentFacts({}) });
  assert.match(d.help, /^Hi Alex, it's Chris at Fundhub\. Your next step is "Pay Card A down to \$400"\./);
  assert.match(d.call, /paid one-on-one consulting call/);
  assert.match(d.call, /Reply CALL and we will send you times and the price\.$/);
  for (const words of [d.help, d.call]) {
    assert.doesNotMatch(words, /\bJosh\b/);
    assert.doesNotMatch(words, /\b(might|maybe|may|could|probably|likely|hopefully)\b/i);
  }
  assert.doesNotMatch(d.call.replace('"Pay Card A down to $400"', ""), /\$\d/, "no consulting-call price is stored, so none is named");
  const payment = nudgeDrafts({ firstName: null, steps: { current: null }, payments: paymentFacts({ plansOpen: 1, planLate: 1 }) });
  assert.match(payment.help, /^Hi there, .* A payment on your file shows as late\./);
  const ours = nudgeDrafts({ firstName: "Alex", steps: stepFacts(summarizeSteps([step({ owner_kind: "fundhub" })]), NOW), payments: paymentFacts({}) });
  assert.doesNotMatch(ours.help, /Your next step/, "a step only our team can do is never put on the client");
});

/* ── the list row and its parameters ───────────────────────────────────────── */

test("a list row from the database becomes a position, with seasoning read from the stored json", () => {
  const p = positionFromRow({
    client_id: C1, first_name: "Alex", client_name: "Alex Sample", client_code: "FH-1",
    steps_total: 8, steps_done: 3, last_done_at: daysAgo(15),
    step_id: "w4", step_key: "remove_item", step_title: "Remove the late payment", step_state: "in_progress",
    step_owner: "client", step_due_at: null, step_created_at: daysAgo(40),
    bank_late: 1, bank_known: 2, plans_open: null, plan_late: null,
    opened_accounts: JSON.stringify([{ bank: "Chase", opened_on: dayAgo(12) }]),
    last_team_text_at: daysAgo(2)
  }, NOW);
  assert.equal(p.steps.done, 3);
  assert.equal(p.steps.current.days_on_step, 15);
  assert.deepEqual(p.payments, { bank_late: 1, plan_late: null, total_late: 1 });
  assert.equal(p.seasoning.closest.day, 12);
  assert.deepEqual(p.behind.map((r) => r.code), ["step_stuck", "bank_late"]);
  assert.equal(p.last_team_text_at, daysAgo(2));
  const empty = positionFromRow({ client_id: C2, opened_accounts: null }, NOW);
  assert.equal(empty.steps.current, null);
  assert.deepEqual(empty.payments, { bank_late: null, plan_late: null, total_late: null });
  assert.deepEqual(empty.behind, []);
});

test("list parameters: behind by default, a bad value is refused, and the page is capped", () => {
  assert.deepEqual(listParams({}), { show: "behind", mine: false, limit: 25, offset: 0 });
  assert.deepEqual(listParams({ show: "all", mine: "1", limit: "500", offset: "25" }), { show: "all", mine: true, limit: 50, offset: 25 });
  assert.throws(() => listParams({ show: "everyone" }), TrackingInputError);
  assert.throws(() => listParams({ limit: "-1" }), TrackingInputError);
  assert.throws(() => listParams({ offset: "1.5" }), TrackingInputError);
});

/* ── the reads, over a stand-in database ───────────────────────────────────── */

function fakeDb(answer) {
  const calls = [];
  return { calls, async query(sql, params = []) { calls.push({ sql, params }); return { rows: await answer(sql, params) }; } };
}

const listRow = (id, name, over = {}) => ({
  client_id: id, first_name: name, client_name: `${name} Tester`, client_code: `FH-${name}`,
  assigned_csm_staff_id: null, assigned_csm_name: null, steps_total: 5, steps_done: 1, last_done_at: null,
  step_id: `w-${id}`, step_key: "k", step_title: "Open the business checking account", step_state: "not_started",
  step_owner: "client", step_due_at: null, step_created_at: daysAgo(2),
  bank_late: null, bank_known: null, plans_open: null, plan_late: null, opened_accounts: null, last_team_text_at: null, ...over
});

test("the list read sends one company-scoped statement, puts falling-behind clients first and runs UnderwriteIQ only for seasoned ones", async () => {
  const rows = [
    listRow(C1, "Ann", { step_created_at: daysAgo(14) }),
    listRow(C2, "Ben", { opened_accounts: [{ bank: "Chase", opened_on: dayAgo(40) }] }),
    listRow(C3, "Cat", { plans_open: 1, plan_late: 1, opened_accounts: [{ bank: "Chase", opened_on: dayAgo(3) }] })
  ];
  const db = fakeDb(() => rows);
  const engineCalls = [];
  const fundabilityFn = async (_db, args) => { engineCalls.push(args.clientId); return fundPayload({ tier: "fundable", score: 6 }); };

  const behind = await readTrackingList(db, { orgId: ORG, query: {}, now: NOW, fundabilityFn });
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [ORG, null, "2026-11-07", MAX_CLIENTS + 1]);
  assert.equal(behind.view, "tracking");
  assert.equal(behind.total, 3);
  assert.equal(behind.behind_count, 2);
  assert.deepEqual(behind.items.map((r) => r.client_id), [C1, C3], "Ben is on track and stays off the falling-behind list");
  assert.deepEqual(engineCalls, [], "nobody shown has a seasoned account, so the engine is not run");
  assert.equal(behind.items[0].apply_gate.state, "locked");

  const all = await readTrackingList(db, { orgId: ORG, query: { show: "all" }, now: NOW, fundabilityFn });
  assert.deepEqual(all.items.map((r) => r.client_id), [C1, C3, C2]);
  assert.deepEqual(engineCalls, [C2], "only the seasoned client's file is read by UnderwriteIQ");
  assert.equal(all.items[2].apply_gate.state, "open");

  const paged = await readTrackingList(db, { orgId: ORG, query: { show: "all", limit: "2" }, now: NOW, fundabilityFn });
  assert.equal(paged.count, 2);
  assert.equal(paged.hasMore, true);
  const last = await readTrackingList(db, { orgId: ORG, query: { show: "all", limit: "2", offset: "2" }, now: NOW, fundabilityFn });
  assert.equal(last.hasMore, false);
});

test("the list statement scopes every source to the company and keeps archived clients off", () => {
  const sql = TRACKING_LIST_SQL.replace(/\s+/g, " ");
  for (const part of [
    "FROM client_waypoints WHERE org_id = $1",
    "FROM clarity_payments WHERE org_id = $1 AND status = 'open'",
    "FROM blueprint_bank_relationship_todos WHERE org_id = $1 AND opened_on IS NOT NULL",
    "WHERE w.org_id = $1 GROUP BY w.client_id",
    "WHERE w.org_id = $1 AND w.state IN ('not_started', 'in_progress', 'blocked')",
    "WHERE sc.org_id = $1 AND ba.closed_at IS NULL",
    "WHERE p.org_id = $1 AND p.status = 'open'",
    "i.paid_cents < i.amount_cents AND i.due_on < $3::date",
    "WHERE r.org_id = $1 AND r.opened_on IS NOT NULL AND r.state <> 'skipped'",
    "WHERE m.org_id = $1 AND m.direction = 'outbound' AND m.sender_kind = 'staff'",
    "JOIN clients c ON c.id = cand.client_id AND c.org_id = $1",
    "c.custom_fields->>'crm_archived_at' IS NULL",
    "($2::uuid IS NULL OR c.assigned_csm_staff_id = $2::uuid)"
  ]) assert.ok(sql.includes(part), `missing: ${part}`);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i, "a read writes nothing");
});

test("only mine needs a signed-in staff member and passes their id; a stop at the cap is said", async () => {
  const db = fakeDb(() => []);
  await readTrackingList(db, { orgId: ORG, staffId: STAFF, query: { mine: "1" }, now: NOW, fundabilityFn: async () => null });
  assert.equal(db.calls[0].params[1], STAFF);
  await assert.rejects(readTrackingList(db, { orgId: ORG, staffId: null, query: { mine: "1" }, now: NOW }), TrackingInputError);
  await assert.rejects(readTrackingList(db, { orgId: "nope", query: {}, now: NOW }), TrackingInputError);
  const many = fakeDb(() => Array.from({ length: MAX_CLIENTS + 1 }, (_, i) => listRow(`c1000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `P${i}`)));
  const capped = await readTrackingList(many, { orgId: ORG, query: { show: "all" }, now: NOW, fundabilityFn: async () => null });
  assert.equal(capped.truncated, true);
  assert.equal(capped.total, MAX_CLIENTS);
});

test("an engine that throws on one file says not read, never fundable, and the list still loads", async () => {
  const db = fakeDb(() => [listRow(C2, "Ben", { opened_accounts: [{ bank: "Chase", opened_on: dayAgo(40) }] })]);
  const errors = console.error;
  console.error = () => {};
  try {
    const out = await readTrackingList(db, { orgId: ORG, query: { show: "all" }, now: NOW, fundabilityFn: async () => { throw new Error("bad report"); } });
    assert.equal(out.items[0].apply_gate.state, "unknown");
    assert.equal(out.items[0].apply_gate.checks[0].words, "Not read yet");
  } finally { console.error = errors; }
});

test("one client: not in this company is null with no other read; in it, the full position with UnderwriteIQ, plans and drafts", async () => {
  const outsider = fakeDb(() => []);
  assert.equal(await readClientPosition(outsider, { orgId: ORG, clientId: C1, now: NOW,
    fundabilityFn: async () => assert.fail("no engine read for a client not in this company"),
    readRelationshipsFn: async () => assert.fail("no bank read"), listPlansFn: async () => assert.fail("no plan read") }), null);
  assert.equal(outsider.calls.length, 1);
  assert.deepEqual(outsider.calls[0].params, [C1, ORG]);

  const db = fakeDb((sql) => {
    if (/csm:tracking-client/.test(sql)) return [{ client_id: C1, first_name: "Alex", client_name: "Alex Sample", client_code: "FH-1", assigned_csm_staff_id: STAFF, assigned_csm_name: "Cam CSM" }];
    if (/csm:tracking-steps/.test(sql)) return [
      step({ id: "w1", key: "a", position: 1, state: "done", completed_at: daysAgo(20) }),
      step({ id: "w2", key: "b", position: 2, title: "Pay Card A down to $400", created_at: daysAgo(60), paid_alternative_price_cents: 29700, paid_alternative_label: "Have us do it" }),
      step({ id: "w3", key: "c", position: 3, title: "Open a Chase business checking account", owner_kind: "client" })
    ];
    if (/csm:tracking-bank-late/.test(sql)) return [{ name: "Card A", account_type: "credit", is_overdue: "true" }, { name: "Checking", account_type: "depository", is_overdue: null }];
    if (/csm:tracking-last-text/.test(sql)) return [{ last_team_text_at: daysAgo(1) }];
    return [];
  });
  const out = await readClientPosition(db, {
    orgId: ORG, clientId: C1, now: NOW,
    fundabilityFn: async (_d, a) => { assert.deepEqual([a.orgId, a.clientId], [ORG, C1]); return fundPayload(); },
    readRelationshipsFn: async (_d, a) => { assert.equal(a.today, "2026-11-07"); return [{ bank: "Chase", opened_on: dayAgo(12), status: "seasoning" }, { bank: "Skipped Bank", opened_on: dayAgo(50), status: "skipped" }]; },
    listPlansFn: async () => [{ status: "open", is_late: true, name: "Clarity Pay plan", days_late: 6, late_cents: 50000, installments: [{ state: "late" }, { state: "upcoming" }] }],
    logoFn: async (_d, a) => { assert.equal(a.orgId, ORG); assert.deepEqual(a.banks, [{ lenderId: null, name: "Chase" }]); return [{ logo: "/assets/lenders/chase.png", logo_source: "bank_book" }]; }
  });
  for (const c of db.calls) assert.ok(c.params.includes(ORG), "every statement carries the company");
  assert.equal(out.client.seasoning.accounts[0].logo, "/assets/lenders/chase.png", "the bank's own logo rides on its seasoning row");
  const c = out.client;
  assert.equal(c.steps.current.title, "Pay Card A down to $400");
  assert.equal(c.steps.current.days_on_step, 20);
  assert.deepEqual(c.steps.current.paid_alternative, { label: "Have us do it", price_cents: 29700 });
  assert.deepEqual(c.late_accounts, [{ name: "Card A", kind: "credit" }]);
  assert.deepEqual(c.payments, { bank_late: 1, plan_late: 1, total_late: 2 });
  assert.deepEqual(c.late_plans, [{ name: "Clarity Pay plan", late_payments: 1, days_late: 6, late_cents: 50000 }]);
  assert.equal(c.seasoning.opened, 1, "a skipped account is not on the clock");
  assert.equal(c.apply_gate.state, "locked");
  assert.equal(c.fundability.score, 4);
  assert.deepEqual(c.behind.map((r) => r.code), ["step_stuck", "bank_late", "plan_late"]);
  assert.match(c.drafts.help, /Pay Card A down to \$400/);
  assert.equal(c.next_steps.length, 2);
  assert.equal(c.last_team_text_at, daysAgo(1));
});
