import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_IDS, gapChecks, joshReady } from "./gap-calls.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-calls.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T20:00:00.000Z"); // 1 pm Arizona, outside quiet hours
const OPEN_ENV = { MESSAGING_DRY_RUN: "0" };

function liveFetch() {
  const fn = async (url, opts) => {
    fn.last = { url, opts };
    return { status: 200, async text() { return "<title>Fundhub — Calendar</title>"; } };
  };
  return fn;
}

/* A fake db that answers by the tag in each query's first comment, and keeps
   every call so a test can read the params it was sent. */
function dbWith(bag = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      if (/gap-calls:booked-no-outcome/.test(text)) return { rows: bag.booked || [] };
      if (/gap-calls:booking-webhook:events/.test(text)) return { rows: bag.events || [] };
      if (/gap-calls:booking-webhook:captures/.test(text)) return { rows: bag.captures || [] };
      if (/gap-calls:no-join-link:events/.test(text)) return { rows: bag.joinEvents || [] };
      if (/gap-calls:no-join-link:bookings/.test(text)) return { rows: bag.joinBookings || [] };
      if (/gap-calls:no-join-link:tasks/.test(text)) return { rows: bag.joinTasks || [] };
      if (/gap-calls:ai-dial-agent/.test(text)) return { rows: bag.agent === undefined ? [liveJosh()] : bag.agent };
      if (/gap-calls:ai-dial/.test(text)) return { rows: bag.ai || [] };
      return { rows: [] };
    }
  };
}

function liveJosh(extra = {}) {
  return { agent_status: "live", agent_runtime: "bland", has_prompt: true, ...extra };
}

function index(rows) {
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status), row.status);
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    assert.ok("suggestedFix" in row);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\)|Do not place a call/);
      assert.doesNotMatch(row.suggestedFix, /placeCall|createFunction|new cron/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

async function run(partial = {}) {
  const fetchImpl = partial.fetchImpl === undefined ? liveFetch() : partial.fetchImpl;
  const db = partial.db === undefined ? dbWith(partial.rows || {}) : partial.db;
  const rows = await gapChecks({
    db,
    orgId: partial.orgId === undefined ? ORG : partial.orgId,
    now: partial.now || NOW,
    fetchImpl,
    env: "env" in partial ? partial.env : OPEN_ENV,
    baseUrl: partial.baseUrl
  });
  return { rows, by: index(rows), db, fetchImpl };
}

function aiRow(extra = {}) {
  return {
    event_id: "e1",
    client_id: "c1",
    created_at: "2026-10-08T19:00:00.000Z",
    email: "lead@example.com",
    dialed: false,
    has_failure: false,
    ...extra
  };
}

test("five checks, fixed ids, PASS FAIL or skip; no ctx means every row skips", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  assert.ok(rows.every((r) => r.status === "skip"), JSON.stringify(rows));
  const none = await gapChecks();
  assert.ok(none.every((r) => r.status === "skip"));
});

test("held-call tape is not checked here: the daily pulse already runs 'unrecorded'", () => {
  assert.ok(!CHECK_IDS.includes("calls:held-no-recording"));
  assert.doesNotMatch(SRC, /listUnrecordedCalls|unrecorded\.mjs'|recording_url|brain_drive_sync/);
});

test("clean rows and a live calendar are all PASS", async () => {
  const { by, fetchImpl } = await run({ baseUrl: "https://fundhub.ai/" });
  for (const id of CHECK_IDS) assert.equal(by[id].status, "PASS", id);
  assert.equal(fetchImpl.last.url, "https://fundhub.ai/app/calendar.html");
  assert.equal(fetchImpl.last.opts.method, "GET");
});

test("ctx.fetch is used when ctx.fetchImpl is absent", async () => {
  const fetch = liveFetch();
  const rows = await gapChecks({ db: dbWith(), orgId: ORG, now: NOW, env: OPEN_ENV, fetch });
  assert.equal(rows.find((r) => r.id === "calls:calendar").status, "PASS");
  assert.equal(fetch.last.opts.method, "GET");
});

test("booked call with no outcome fails only that check, with a 14 day window and a 30 minute wait", async () => {
  const { by, db } = await run({ rows: { booked: [{ id: "b-1" }, { id: "b-2" }] } });
  assert.equal(by["calls:booked-no-outcome"].status, "FAIL");
  assert.match(by["calls:booked-no-outcome"].detail, /2 booked calls ended with no outcome/);
  assert.match(by["calls:booked-no-outcome"].suggestedFix, /Log the outcome/);
  for (const id of CHECK_IDS) {
    if (id !== "calls:booked-no-outcome") assert.equal(by[id].status, "PASS", id);
  }
  const sent = db.calls.find((c) => /booked-no-outcome/.test(c.text)).params;
  assert.equal(sent[0], ORG);
  assert.equal(sent[1], new Date(NOW.getTime() - 14 * 24 * 3600e3).toISOString());
  assert.equal(sent[2], new Date(NOW.getTime() - 30 * 60e3).toISOString());
});

test("booked-no-outcome SQL does not require an empty clients.call_outcome field", async () => {
  // The booking handler writes call_outcome = 'booked' on every booking, so a test
  // for an EMPTY value matched no real booking and the check could never fail.
  const { db } = await run();
  const sql = db.calls.find((c) => /booked-no-outcome/.test(c.text)).text;
  assert.doesNotMatch(sql, /custom_fields->>'call_outcome'/);
  assert.match(sql, /o\.client_id = b\.client_id/);
  assert.match(sql, /o\.booking_ref = b\.provider_uid/);
  assert.match(sql, /'booked', 'rescheduled'/);
  assert.match(sql, /is_demo/);
});

test("calendar: the page that answers must be the calendar", async () => {
  const wrong = await run({
    fetchImpl: async () => ({ status: 200, async text() { return "<title>Login</title>"; } })
  });
  assert.equal(wrong.by["calls:calendar"].status, "FAIL");
  assert.match(wrong.by["calls:calendar"].detail, /answered 200 but it is not the calendar page/);
  assert.match(wrong.by["calls:calendar"].suggestedFix, /Recon \(AG-07\)/);

  const ok = await run();
  assert.equal(ok.by["calls:calendar"].status, "PASS");
  assert.match(ok.by["calls:calendar"].detail, /is the calendar/);
});

test("calendar: a page that is down is the registry's red, so this row skips and says so", async () => {
  const down = await run({
    fetchImpl: async () => ({ status: 404, async text() { return "missing"; } })
  });
  assert.equal(down.by["calls:calendar"].status, "skip");
  assert.match(down.by["calls:calendar"].detail, /404/);
  assert.match(down.by["calls:calendar"].detail, /reg:calendar/);

  const boom = await run({ fetchImpl: async () => { throw new Error("socket hang up"); } });
  assert.equal(boom.by["calls:calendar"].status, "skip");
  assert.match(boom.by["calls:calendar"].detail, /socket hang up/);
  assert.match(boom.by["calls:calendar"].detail, /reg:calendar/);
});

test("booking webhook: a stored event with no bookings row fails; an interview booking is skipped on purpose", async () => {
  const miss = await run({ rows: { events: [{ key: "e-9", payload: { bookingUid: "bk-9", email: "a@b.co" } }] } });
  assert.equal(miss.by["calls:booking-webhook"].status, "FAIL");
  assert.match(miss.by["calls:booking-webhook"].detail, /1 booking webhook accepted with no bookings row/);
  assert.match(miss.by["calls:booking-webhook"].suggestedFix, /bookings row was not saved/);

  const interview = await run({
    rows: { events: [{ key: "e-10", payload: { bookingUid: "bk-10", eventTypeSlug: "post-funding-interview" } }] }
  });
  assert.equal(interview.by["calls:booking-webhook"].status, "PASS");
});

test("booking webhook: a ClickFunnels capture with no event and no row fails; the two misses add up", async () => {
  const cap = await run({ rows: { captures: [{ key: "w-1" }] } });
  assert.equal(cap.by["calls:booking-webhook"].status, "FAIL");
  assert.match(cap.by["calls:booking-webhook"].detail, /1 booking webhook accepted/);

  const both = await run({
    rows: { captures: [{ key: "w-1" }, { key: "w-2" }], events: [{ key: "e-1", payload: { bookingUid: "x" } }] }
  });
  assert.match(both.by["calls:booking-webhook"].detail, /3 booking webhooks accepted/);
});

test("booking webhook SQL: wait before judging, created/moved only, call id read from data.id", async () => {
  const { db } = await run();
  const events = db.calls.find((c) => /booking-webhook:events/.test(c.text));
  const caps = db.calls.find((c) => /booking-webhook:captures/.test(c.text));
  assert.deepEqual(events.params, caps.params);
  assert.equal(events.params[2], new Date(NOW.getTime() - 10 * 60e3).toISOString());
  // A cancellation never creates a row (src/handlers/comms.mjs closeBooking).
  assert.doesNotMatch(events.text, /booking\.cancelled/);
  assert.match(events.text, /booking\.created', 'booking\.rescheduled/);
  assert.match(events.text, /__event_id/);
  // A ClickFunnels body has no key named bookingUid. The call id is data.id.
  assert.doesNotMatch(caps.text, /LIKE '%bookingUid%'/);
  assert.match(caps.text, /"data"/);
  assert.match(caps.text, /scheduled_event\[\.\]\(created\|rescheduled\)/);
  assert.match(caps.text, /email_address/);
  assert.match(caps.text, /FROM events e/);
  assert.match(caps.text, /FROM bookings b/);
});

test("AI path that should dial and has no dial or failure row fails; a dial or a failure row passes", async () => {
  const late = await run({ rows: { ai: [aiRow()] } });
  assert.equal(late.by["calls:ai-dial-no-failure"].status, "FAIL");
  assert.match(late.by["calls:ai-dial-no-failure"].detail, /1 AI call should have dialed and left no dial row and no failure row/);
  assert.match(late.by["calls:ai-dial-no-failure"].suggestedFix, /Do not place a call/);
  assert.match(late.by["calls:ai-dial-no-failure"].suggestedFix, /BLAND_API_KEY/);

  const dialed = await run({ rows: { ai: [aiRow({ dialed: true })] } });
  assert.equal(dialed.by["calls:ai-dial-no-failure"].status, "PASS");

  const failed = await run({ rows: { ai: [aiRow({ has_failure: true })] } });
  assert.equal(failed.by["calls:ai-dial-no-failure"].status, "PASS");

  const inGrace = await run({ rows: { ai: [aiRow({ created_at: "2026-10-08T19:50:00.000Z" })] } });
  assert.equal(inGrace.by["calls:ai-dial-no-failure"].status, "PASS");
});

test("AI path: Josh not live, or outbound held by the fence, means no dial is expected", async () => {
  for (const [agent, word] of [
    [liveJosh({ agent_status: "retired" }), /retired/],
    [liveJosh({ agent_status: "draft" }), /draft/],
    [liveJosh({ agent_runtime: "inngest" }), /inngest/],
    [liveJosh({ has_prompt: false }), /no script/]
  ]) {
    const r = await run({ rows: { agent: [agent], ai: [aiRow()] } });
    assert.equal(r.by["calls:ai-dial-no-failure"].status, "PASS", JSON.stringify(agent));
    assert.match(r.by["calls:ai-dial-no-failure"].detail, word);
    assert.match(r.by["calls:ai-dial-no-failure"].detail, /no AI call is expected/);
  }
  const held = await run({ env: { MESSAGING_DRY_RUN: "1" }, rows: { ai: [aiRow()] } });
  assert.equal(held.by["calls:ai-dial-no-failure"].status, "PASS");
  assert.match(held.by["calls:ai-dial-no-failure"].detail, /MESSAGING_DRY_RUN holds outbound/);
  const unset = await run({ env: {}, rows: { ai: [aiRow()] } });
  assert.equal(unset.by["calls:ai-dial-no-failure"].status, "PASS");
  // No env handed in at all: judged on the evidence, so the miss still fails.
  const noEnv = await run({ env: undefined, rows: { ai: [aiRow()] } });
  assert.equal(noEnv.by["calls:ai-dial-no-failure"].status, "FAIL");
  // No AG-04 row: the workflow falls back to the vendor script and dials.
  const noRow = await run({ rows: { agent: [], ai: [aiRow()] } });
  assert.equal(noRow.by["calls:ai-dial-no-failure"].status, "FAIL");
});

test("joshReady uses the same three tests as the voice provider", () => {
  assert.equal(joshReady({ status: "live", runtime: "bland", has_prompt: true }).ok, true);
  assert.equal(joshReady(null).ok, false);
  assert.equal(joshReady({ status: "live", runtime: "inngest", has_prompt: true }).ok, false);
  assert.equal(joshReady({ status: "retired", runtime: "bland", has_prompt: true }).ok, false);
  assert.equal(joshReady({ status: "live", runtime: "bland", has_prompt: false }).ok, false);
});

test("AI path SQL: cancelled bookings, missing phones, and demo rows are not misses; kind is bound, not pasted", async () => {
  const { db } = await run({ rows: { ai: [] } });
  const sql = db.calls.find((c) => /gap-calls:ai-dial \*\//.test(c.text)).text;
  const params = db.calls.find((c) => /gap-calls:ai-dial \*\//.test(c.text)).params;
  assert.match(sql, /x\.name = 'booking\.cancelled'/);
  assert.match(sql, /e\.payload->>'phone'/);
  assert.match(sql, /is_demo/);
  assert.equal(params[2], "ai-set-01-josh-setter");
});

test("quiet hours wait is not a missed dial; a prove sim does not get that wait", async () => {
  const createdQuiet = "2026-10-08T10:00:00.000Z"; // 3 am Arizona
  const stillWaiting = await run({
    now: new Date("2026-10-08T14:00:00.000Z"),
    rows: { ai: [aiRow({ created_at: createdQuiet })] }
  });
  assert.equal(stillWaiting.by["calls:ai-dial-no-failure"].status, "PASS");

  const grace = await run({
    now: new Date("2026-10-08T15:10:00.000Z"),
    rows: { ai: [aiRow({ created_at: createdQuiet })] }
  });
  assert.equal(grace.by["calls:ai-dial-no-failure"].status, "PASS");

  const late = await run({
    now: new Date("2026-10-08T16:00:00.000Z"),
    rows: { ai: [aiRow({ created_at: createdQuiet })] }
  });
  assert.equal(late.by["calls:ai-dial-no-failure"].status, "FAIL");

  const prove = await run({
    now: new Date("2026-10-08T10:20:00.000Z"),
    rows: { ai: [aiRow({ created_at: createdQuiet, email: "e2e+lane12@fundhub.ai" })] }
  });
  assert.equal(prove.by["calls:ai-dial-no-failure"].status, "FAIL");
});

test("a database error is a FAIL on that check, never a PASS, and does not throw", async () => {
  for (const tag of ["booked-no-outcome", "booking-webhook:events", "booking-webhook:captures", "ai-dial-agent", "ai-dial \\*/"]) {
    const db = {
      async query(sql) {
        if (new RegExp(`gap-calls:${tag}`).test(String(sql))) throw new Error("table down");
        return { rows: [] };
      }
    };
    const { rows } = await run({ db });
    const failed = rows.filter((r) => r.status === "FAIL");
    assert.equal(failed.length, 1, tag);
    assert.match(failed[0].detail, /table down/);
    assert.ok(failed[0].suggestedFix);
    assert.equal(rows.filter((r) => r.status === "PASS").length >= 2, true, tag);
  }
});

/* ------------------------------------------------------------------------
   calls:booked-no-join-link — does a booked customer have a way to join?
   The fake db answers by query tag. Each case flips the answer in one way.
   ------------------------------------------------------------------------ */
const JOIN = "calls:booked-no-join-link";
const LINK = "https://meet.google.com/abc-defg-hij";
const fromNow = (h) => new Date(NOW.getTime() + h * 3600e3).toISOString();
let joinSeq = 0;
/* A booking.created event, three hours old, for a call 24 hours ahead, no link. */
function jev(o = {}) {
  const { payload, ...rest } = o;
  return {
    id: `jev-${++joinSeq}`,
    name: "booking.created",
    created_at: fromNow(-3),
    payload: { bookingUid: "u1", email: "lead@acme.com", startTime: fromNow(24), meetingUrl: null, ...payload },
    ...rest
  };
}
/* A different real customer: own uid, own email, own start. */
function other(n, o = {}) {
  const { payload, ...rest } = o;
  return jev({ created_at: fromNow(-3 - n), payload: { bookingUid: `u${n + 10}`, email: `cust${n}@acme.com`, startTime: fromNow(-48 - n), ...payload }, ...rest });
}
async function joinRow(bag, ctx = {}) {
  const out = await run({ rows: bag, ...ctx });
  return { row: out.by[JOIN], db: out.db, rows: out.rows };
}

test("join link: a real booked call still ahead with no link anywhere fails, names the next call masked", async () => {
  const { row, db } = await joinRow({ joinEvents: [jev()] });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^1 booked call still ahead has no join link anywhere in our data/);
  assert.match(row.detail, /l\*\*\*@acme\.com/);
  assert.doesNotMatch(row.detail, /lead@acme/);
  assert.match(row.detail, /portal sign-in page/);
  assert.match(row.suggestedFix, /Recon \(AG-07\)/);
  // The bookings row and the closer's task are asked about that one uid, in this company.
  const asked = db.calls.filter((c) => /no-join-link:(bookings|tasks)/.test(c.text));
  assert.equal(asked.length, 2);
  for (const c of asked) assert.deepEqual(c.params, [ORG, ["u1"]]);
  // Everything else on the lane is untouched by this row.
  const others = (await joinRow({ joinEvents: [jev()] })).rows.filter((r) => r.id !== JOIN);
  assert.ok(others.every((r) => r.status === "PASS"));
});

test("join link: a link on the event, the bookings row, or the closer's task passes; junk text is not a link", async () => {
  for (const key of ["meetingUrl", "meeting_url", "meeting_location"]) {
    const { row } = await joinRow({ joinEvents: [jev({ payload: { [key]: LINK } })] });
    assert.equal(row.status, "PASS", key);
    assert.match(row.detail, /all 1 booked call ahead have a join link/);
  }
  assert.equal((await joinRow({ joinEvents: [jev()], joinBookings: [{ uid: "u1", meeting_url: LINK }] })).row.status, "PASS");
  assert.equal((await joinRow({ joinEvents: [jev()], joinTasks: [{ uid: "u1", meeting_url: LINK }] })).row.status, "PASS");
  for (const junk of ["n/a", "tbd", "   ", "zoom.us/j/1", "mailto:a@b.co"]) {
    assert.equal((await joinRow({ joinEvents: [jev({ payload: { meetingUrl: junk } })] })).row.status, "FAIL", junk);
    assert.equal((await joinRow({ joinEvents: [jev()], joinBookings: [{ uid: "u1", meeting_url: junk }] })).row.status, "FAIL", junk);
    assert.equal((await joinRow({ joinEvents: [jev()], joinTasks: [{ uid: "u1", meeting_url: junk }] })).row.status, "FAIL", junk);
  }
  // A link saved for some other call does not rescue this one.
  assert.equal((await joinRow({ joinEvents: [jev()], joinBookings: [{ uid: "u2", meeting_url: LINK }] })).row.status, "FAIL");
});

test("join link: cancelled, moved away, started over 2 hours ago, or more than 45 days out are not misses", async () => {
  const cancel = (o = {}) => jev({ name: "booking.cancelled", created_at: fromNow(-1), ...o });
  // Cancelled under the same call id.
  assert.equal((await joinRow({ joinEvents: [jev(), cancel()] })).row.status, "PASS");
  // Cancelled with no call id we hold and no start: matched by email.
  assert.equal((await joinRow({ joinEvents: [jev(), cancel({ payload: { bookingUid: "zz", startTime: null } })] })).row.status, "PASS");
  // A cancel for a different time on the same email does not cancel this call.
  assert.equal((await joinRow({ joinEvents: [jev(), cancel({ payload: { bookingUid: "zz", startTime: fromNow(48) } })] })).row.status, "FAIL");
  // A cancel for the customer's OTHER call (a call id we hold) leaves this one standing.
  const two = [jev(), jev({ payload: { bookingUid: "u2", startTime: fromNow(48) } }), cancel({ payload: { bookingUid: "u2", startTime: fromNow(48) } })];
  const left = await joinRow({ joinEvents: two });
  assert.equal(left.row.status, "FAIL");
  assert.match(left.row.detail, /^1 booked call still ahead has/);
  // A cancel that came BEFORE a re-book does not hide the re-book.
  assert.equal((await joinRow({ joinEvents: [jev({ created_at: fromNow(-5), name: "booking.cancelled" }), jev({ created_at: fromNow(-2) })] })).row.status, "FAIL");
  // Moved to a new call id: the old one is gone, only the new one is judged.
  const moved = jev({ name: "booking.rescheduled", created_at: fromNow(-1), payload: { bookingUid: "u2", rescheduleUid: "u1", startTime: fromNow(30) } });
  const m1 = await joinRow({ joinEvents: [jev(), moved] });
  assert.equal(m1.row.status, "FAIL");
  assert.match(m1.row.detail, /^1 booked call still ahead has/);
  assert.equal((await joinRow({ joinEvents: [jev(), { ...moved, payload: { ...moved.payload, meetingUrl: LINK } }] })).row.status, "PASS");
  // Same call id moved to the past: judged at the new time.
  assert.equal((await joinRow({ joinEvents: [jev(), jev({ name: "booking.rescheduled", created_at: fromNow(-1), payload: { startTime: fromNow(-5) } })] })).row.status, "PASS");
  // In progress for under 2 hours still counts; over 2 hours is over.
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { startTime: fromNow(-1) } })] })).row.status, "FAIL");
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { startTime: fromNow(-3) } })] })).row.status, "PASS");
  // 44 days out counts; 46 days out is too far to judge.
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { startTime: fromNow(44 * 24) } })] })).row.status, "FAIL");
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { startTime: fromNow(46 * 24) } })] })).row.status, "PASS");
  // No email, or a start nobody can read: not a call we can place.
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { email: "" } })] })).row.status, "PASS");
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { startTime: "tomorrow at 3" } })] })).row.status, "PASS");
});

test("join link: test addresses and interviews are not customers", async () => {
  for (const email of ["x@fundhub.ai", "e2e+x@gmail.com", "a+sim-01@gmail.com", "joe+fhtest@gmail.com", "qa@example.com", "a.test@gmail.com", "someone+anything@gmail.com"]) {
    assert.equal((await joinRow({ joinEvents: [jev({ payload: { email } })] })).row.status, "PASS", email);
  }
  // A plain address is a customer.
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { email: "Lead@Acme.com" } })] })).row.status, "FAIL");
  assert.equal((await joinRow({ joinEvents: [jev({ payload: { eventTypeSlug: "post-funding-interview" } })] })).row.status, "PASS");
});

test("join link: one call that ClickFunnels reported under two ids is counted once, and a link on either id counts", async () => {
  const dup = [jev({ payload: { bookingUid: "form-1" } }), jev({ payload: { bookingUid: "72964" } })];
  const miss = await joinRow({ joinEvents: dup });
  assert.equal(miss.row.status, "FAIL");
  assert.match(miss.row.detail, /^1 booked call still ahead has/);
  assert.equal((await joinRow({ joinEvents: dup, joinTasks: [{ uid: "72964", meeting_url: LINK }] })).row.status, "PASS");
  assert.equal((await joinRow({ joinEvents: [dup[0], { ...dup[1], payload: { ...dup[1].payload, meetingUrl: LINK } }] })).row.status, "PASS");
});

test("join link: calls are counted and the next one is the soonest", async () => {
  const evs = [jev({ payload: { bookingUid: "a", email: "late@acme.com", startTime: fromNow(72) } }), jev({ payload: { bookingUid: "b", email: "soon@acme.com", startTime: fromNow(5) } })];
  const { row } = await joinRow({ joinEvents: evs });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^2 booked calls still ahead have no join link/);
  assert.match(row.detail, /s\*\*\*@acme\.com on 2026-10-09 01:00 UTC/);
});

test("join link feed: none of the newest 5 real bookings carries a link, so the next one will not either", async () => {
  const past = [1, 2, 3, 4, 5].map((n) => other(n));
  const bad = await joinRow({ joinEvents: past });
  assert.equal(bad.row.status, "FAIL");
  assert.match(bad.row.detail, /^0 of the newest 5 real bookings carried a join link, so a new booking will not have one either/);
  assert.doesNotMatch(bad.row.detail, /still ahead/);
  assert.match(bad.row.suggestedFix, /Recon \(AG-07\)/);
  // One of the newest 5 carries a link: the feed works.
  const good = await joinRow({ joinEvents: [other(1, { payload: { meetingUrl: LINK } }), ...past.slice(1)] });
  assert.equal(good.row.status, "PASS");
  assert.match(good.row.detail, /no real booked call is ahead; 1 of the newest 5 real bookings carry a link/);
  // A link only on an older booking does not count: the sample is the newest 5.
  const six = [...past, other(6, { payload: { meetingUrl: LINK } })];
  assert.equal((await joinRow({ joinEvents: six })).row.status, "FAIL");
  // A link kept on the bookings row, or on the closer's task, counts for the feed too.
  assert.equal((await joinRow({ joinEvents: past, joinBookings: [{ uid: "u11", meeting_url: LINK }] })).row.status, "PASS");
  assert.equal((await joinRow({ joinEvents: past, joinTasks: [{ uid: "u12", meeting_url: LINK }] })).row.status, "PASS");
  // The same bad feed also lists the calls still ahead, in one row.
  const both = await joinRow({ joinEvents: [jev(), ...past] });
  assert.equal(both.row.status, "FAIL");
  assert.match(both.row.detail, /^1 booked call still ahead has no join link anywhere in our data \(next: l\*\*\*@acme\.com on [^)]+\); 0 of the newest 5 real bookings carried/);
});

test("join link feed: under 3 real bookings is not enough to judge; testers and cancelled-only rows do not count toward it", async () => {
  const two = await joinRow({ joinEvents: [other(1), other(2)] });
  assert.equal(two.row.status, "PASS");
  assert.match(two.row.detail, /fewer than 3 real bookings so far/);
  const testers = [1, 2, 3, 4, 5].map((n) => other(n, { payload: { email: `qa${n}+sim-${n}@gmail.com` } }));
  assert.equal((await joinRow({ joinEvents: [...testers, other(6), other(7)] })).row.status, "PASS");
  // Only a cancel, or only a move: no booking was made in this feed.
  const cancels = [1, 2, 3, 4].map((n) => other(n, { name: "booking.cancelled" }));
  assert.equal((await joinRow({ joinEvents: cancels })).row.status, "PASS");
  const moves = [1, 2, 3, 4].map((n) => other(n, { name: "booking.rescheduled" }));
  assert.equal((await joinRow({ joinEvents: moves })).row.status, "PASS");
  // No bookings at all.
  const none = await joinRow({ joinEvents: [] });
  assert.equal(none.row.status, "PASS");
  assert.equal(none.db.calls.some((c) => /no-join-link:(bookings|tasks)/.test(c.text)), false);
});

test("join link feed: the verdict does not fade as the bookings age, and the red says how old the newest booking is", async () => {
  const days = (d, n) => new Date(NOW.getTime() - (d * 24 + n) * 3600e3).toISOString();
  const aged = (d) => [1, 2, 3, 4, 5].map((n) => other(n, { created_at: days(d, n) }));
  // Bookings from today, 1 day ago, 48 days ago, 150 days ago and 900 days ago: all the same red.
  for (const [d, words] of [[0, "today"], [1, "1 day ago"], [48, "48 days ago"], [150, "150 days ago"], [900, "900 days ago"]]) {
    const { row } = await joinRow({ joinEvents: aged(d) });
    assert.equal(row.status, "FAIL", `${d} days`);
    assert.match(row.detail, new RegExp(`^0 of the newest 5 real bookings carried a join link, so a new booking will not have one either \\(the newest real booking was made ${words}\\)`), `${d} days`);
  }
  // A link on one of the newest 5, however old, is still a working feed.
  const old = aged(150);
  old[2] = other(3, { created_at: days(150, 3), payload: { meetingUrl: LINK } });
  const good = await joinRow({ joinEvents: old });
  assert.equal(good.row.status, "PASS");
  assert.match(good.row.detail, /1 of the newest 5 real bookings carry a link/);
  // Under 3 old bookings is still "not judged", not red.
  assert.equal((await joinRow({ joinEvents: aged(150).slice(0, 2) })).row.status, "PASS");
  // The age is the NEWEST booking's, not the oldest one in the sample.
  const mixed = [other(1, { created_at: days(10, 0) }), ...aged(300).slice(1)];
  assert.match((await joinRow({ joinEvents: mixed })).row.detail, /the newest real booking was made 10 days ago\)/);
});

test("join link: a failed read is a skip with the reason, never a PASS; no database or company means skip", async () => {
  for (const tag of ["events", "bookings", "tasks"]) {
    const db = {
      async query(sql) {
        const t = String(sql);
        if (new RegExp(`gap-calls:no-join-link:${tag}`).test(t)) throw new Error("table down");
        if (/no-join-link:events/.test(t)) return { rows: [jev()] };
        return { rows: [] };
      }
    };
    const { row } = await joinRow({}, { db });
    assert.equal(row.status, "skip", tag);
    assert.match(row.detail, /table down/, tag);
    assert.match(row.detail, /unchecked|not read/, tag);
    assert.equal(row.suggestedFix, null);
  }
  assert.equal((await joinRow({}, { orgId: null })).row.status, "skip");
  const noDb = await gapChecks({ orgId: ORG, now: NOW });
  assert.equal(noDb.find((r) => r.id === JOIN).status, "skip");
});

test("join link SQL: this company only, no demo rows, created/moved/cancelled only, newest first up to now with NO look-back window, read only, never the staff table", async () => {
  const { db } = await joinRow({ joinEvents: [jev()] });
  const q = db.calls.find((c) => /no-join-link:events/.test(c.text));
  // Only the company and "now". A second date here would be a look-back window, and the red would fade by itself.
  assert.deepEqual(q.params, [ORG, NOW.toISOString()]);
  assert.match(q.text, /e\.created_at <= \$2::timestamptz/);
  assert.doesNotMatch(q.text, /created_at\s*>=/);
  assert.match(q.text, /ORDER BY e\.created_at DESC/);
  assert.match(q.text, /e\.org_id = \$1::uuid/);
  assert.match(q.text, /COALESCE\(e\.is_demo, false\) = false/);
  assert.match(q.text, /'booking\.created', 'booking\.rescheduled', 'booking\.cancelled'/);
  assert.match(q.text, /LIMIT 1500/);
  for (const c of db.calls.filter((x) => /no-join-link/.test(x.text))) {
    assert.doesNotMatch(c.text, /\bFROM\s+staff\b|staff\.meeting_url|\bJOIN\s+staff\b/i);
    assert.match(c.text, /org_id = \$1::uuid/);
  }
});

test("source does not dial, read files, write rows, or add a watchdog", () => {
  assert.match(SRC, /from ["']\.\.\/\.\.\/insights\/meet\.mjs["']/);
  assert.doesNotMatch(SRC, /placeCall|placeConfiguredCall|bland-voice|messaging\/dispatch|createFunction/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(SRC, /from ["']node:fs["']|readFileSync|writeFileSync/);
  assert.doesNotMatch(SRC, /textChris|sendSms|\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
});

/* ------------------------------------------------------------------------
   The SQL, run for real. Each table the SQL reads is replaced for one query by
   fixture rows (a CTE with the table's name), so the file's own SQL runs on the
   Postgres engine over rows we choose. SELECT only, nothing is stored.
   Skipped without DATABASE_URL, like every *.pg.test.mjs.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  bookings: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["provider_uid", "text"], ["starts_at", "timestamptz"], ["ends_at", "timestamptz"], ["status", "text"], ["raw", "jsonb"], ["attendee_email", "text"], ["meeting_url", "text"]],
  tasks: [["org_id", "uuid"], ["body", "text"], ["meeting_url", "text"]],
  clients: [["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["custom_fields", "jsonb"], ["phone", "text"], ["email", "text"]],
  call_outcomes: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["booking_ref", "text"], ["is_demo", "boolean"], ["logged_at", "timestamptz"]],
  events: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["name", "text"], ["is_demo", "boolean"], ["created_at", "timestamptz"], ["payload", "jsonb"]],
  webhook_captures: [["id", "uuid"], ["org_id", "uuid"], ["provider", "text"], ["raw_body", "text"], ["created_at", "timestamptz"]],
  agents: [["org_id", "uuid"], ["code", "text"], ["status", "text"], ["runtime", "text"], ["prompt", "text"]],
  outbound_calls: [["org_id", "uuid"], ["client_id", "uuid"], ["kind", "text"], ["created_at", "timestamptz"]],
  failed_events: [["org_id", "uuid"], ["event_id", "uuid"], ["client_id", "uuid"], ["handler_name", "text"], ["first_seen_at", "timestamptz"]]
};
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      const t = String(sql).replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "");
      return pgDb.query(`WITH ${ctes.join(", ")} ${t}`, params);
    }
  };
}

describe("gap-calls SQL on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const CL = uid();
  const BK = uid();
  const org = uid();
  const client = (o = {}) => ({ id: CL, org_id: org, is_demo: false, custom_fields: { call_outcome: "booked" }, phone: "+16025550123", email: "lead@example.com", ...o });
  const booking = (o = {}) => ({ id: BK, org_id: org, client_id: CL, provider_uid: "72964", starts_at: ago(3), ends_at: ago(2.5), status: "booked", raw: {}, attendee_email: "lead@example.com", ...o });
  const event = (o = {}) => ({ id: uid(), org_id: org, client_id: CL, name: "booking.created", is_demo: false, created_at: ago(2), payload: { bookingUid: "72964", email: "lead@example.com", startTime: ago(-24) }, ...o });
  const cfBody = (callId, email = true) => JSON.stringify({ id: 1054662981, type: "appointments/scheduled_event.created", data: { id: Number(callId), primary_contact: { first_name: "A", ...(email ? { email_address: "lead@example.com" } : {}) } } });
  const capture = (body, o = {}) => ({ id: uid(), org_id: null, provider: "clickfunnels", raw_body: body, created_at: ago(2), ...o });
  const josh = (o = {}) => ({ org_id: org, code: "AG-04", status: "live", runtime: "bland", prompt: "You are Josh", ...o });

  async function status(id, rows, ctx = {}) {
    const out = await gapChecks({ db: fixtureDb(rows), orgId: org, now: NOW, env: OPEN_ENV, fetchImpl: null, ...ctx });
    const row = out.find((r) => r.id === id);
    assert.ok(row, id);
    return row.status;
  }

  test("booked-no-outcome: FAIL with none; PASS when the booking uid, or the same client later, has an outcome", async () => {
    const id = "calls:booked-no-outcome";
    assert.equal(await status(id, { clients: [client()], bookings: [booking()] }), "FAIL");
    assert.equal(await status(id, { clients: [client()], bookings: [booking({ status: "rescheduled" })] }), "FAIL");
    assert.equal(await status(id, { clients: [client()], bookings: [booking()], call_outcomes: [{ id: uid(), org_id: org, client_id: CL, booking_ref: "72964", is_demo: false, logged_at: ago(2) }] }), "PASS");
    assert.equal(await status(id, { clients: [client()], bookings: [booking()], call_outcomes: [{ id: uid(), org_id: org, client_id: CL, booking_ref: null, is_demo: false, logged_at: ago(2) }] }), "PASS");
    // An outcome from three days ago is another call. It must not hide this one.
    assert.equal(await status(id, { clients: [client()], bookings: [booking()], call_outcomes: [{ id: uid(), org_id: org, client_id: CL, booking_ref: null, is_demo: false, logged_at: ago(72) }] }), "FAIL");
  });

  test("booked-no-outcome: no-show, cancelled, demo, inside the wait, and older than 14 days are not misses", async () => {
    const id = "calls:booked-no-outcome";
    assert.equal(await status(id, { clients: [client()], bookings: [booking({ status: "noshow" })] }), "PASS");
    assert.equal(await status(id, { clients: [client()], bookings: [booking({ status: "cancelled" })] }), "PASS");
    assert.equal(await status(id, { clients: [client({ is_demo: true })], bookings: [booking()] }), "PASS");
    assert.equal(await status(id, { clients: [client()], bookings: [booking({ starts_at: ago(0.7), ends_at: ago(0.17) })] }), "PASS");
    assert.equal(await status(id, { clients: [client()], bookings: [booking({ starts_at: ago(480), ends_at: ago(479) })] }), "PASS");
  });

  test("booking-webhook: an event with no row fails; a row by uid, by event id, or by email and time passes", async () => {
    const id = "calls:booking-webhook";
    const start = ago(-24);
    assert.equal(await status(id, { events: [event()] }), "FAIL");
    assert.equal(await status(id, { events: [event()], bookings: [booking({ starts_at: start, ends_at: null })] }), "PASS");
    const e = event({ payload: { email: "q@z.co" } });
    assert.equal(await status(id, { events: [e], bookings: [booking({ provider_uid: null, raw: { __event_id: e.id } })] }), "PASS");
    // ClickFunnels re-keys a form-post booking to the call id: other uid, same email and start.
    const rekeyed = event({ payload: { bookingUid: "1054662981", email: "Lead@Example.com", startTime: start } });
    assert.equal(await status(id, { events: [rekeyed], bookings: [booking({ provider_uid: "72964", starts_at: start, ends_at: null })] }), "PASS");
  });

  test("booking-webhook: cancelled, demo, and 2 minute old events are not misses", async () => {
    const id = "calls:booking-webhook";
    assert.equal(await status(id, { events: [event({ name: "booking.cancelled" })] }), "PASS");
    assert.equal(await status(id, { events: [event({ is_demo: true })] }), "PASS");
    assert.equal(await status(id, { events: [event({ created_at: ago(0.03) })] }), "PASS");
  });

  test("booking-webhook: a real ClickFunnels appointment body is read at data.id", async () => {
    const id = "calls:booking-webhook";
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(72964))] }), "FAIL");
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(72964))], bookings: [booking()] }), "PASS");
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(72964))], events: [event({ is_demo: true })] }), "PASS");
    // The older uid was the webhook message id, not the call id.
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(72964))], events: [event({ is_demo: true, payload: { bookingUid: "1054662981", email: "lead@example.com" } })] }), "PASS");
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(999001, false))] }), "PASS");
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(72964), { created_at: ago(0.03) })] }), "PASS");
    assert.equal(await status(id, { webhook_captures: [capture(cfBody(72964), { provider: "twilio" })] }), "PASS");
  });

  test("ai-dial: live Josh, a late booking, a phone, no dial row and no failure row fails", async () => {
    const id = "calls:ai-dial-no-failure";
    const base = { agents: [josh()], clients: [client()], events: [event({ created_at: ago(1) })] };
    assert.equal(await status(id, base), "FAIL");
    assert.equal(await status(id, { ...base, outbound_calls: [{ org_id: org, client_id: CL, kind: "ai-set-01-josh-setter", created_at: ago(0.9) }] }), "PASS");
    assert.equal(await status(id, { ...base, failed_events: [{ org_id: org, event_id: null, client_id: CL, handler_name: "ai-set-01-josh-setter", first_seen_at: ago(0.9) }] }), "PASS");
  });

  test("ai-dial: cancelled bookings, a retired Josh, the fence, no phone, and the grace wait are not misses", async () => {
    const id = "calls:ai-dial-no-failure";
    const base = { agents: [josh()], clients: [client()], events: [event({ created_at: ago(1) })] };
    assert.equal(await status(id, { ...base, events: [...base.events, event({ name: "booking.cancelled", created_at: ago(0.5) })] }), "PASS");
    assert.equal(await status(id, { ...base, agents: [josh({ status: "retired" })] }), "PASS");
    assert.equal(await status(id, base, { env: { MESSAGING_DRY_RUN: "1" } }), "PASS");
    assert.equal(await status(id, { ...base, clients: [client({ phone: null })], events: [event({ created_at: ago(1), payload: { email: "lead@example.com" } })] }), "PASS");
    assert.equal(await status(id, { ...base, events: [event({ created_at: ago(0.08) })] }), "PASS");
    // The phone can be on the booking itself.
    assert.equal(await status(id, { ...base, clients: [client({ phone: null })], events: [event({ created_at: ago(1), payload: { email: "lead@example.com", phone: "+16025550123" } })] }), "FAIL");
  });

  /* calls:booked-no-join-link — the file's own three queries, run for real. */
  const JOINID = "calls:booked-no-join-link";
  const jev = (o = {}) => ({ id: uid(), org_id: org, client_id: null, name: "booking.created", is_demo: false, created_at: ago(3), payload: { bookingUid: "72964", email: "lead@acme.com", startTime: ago(-24), meetingUrl: null }, ...o });
  const jpay = (o = {}) => ({ bookingUid: "72964", email: "lead@acme.com", startTime: ago(-24), meetingUrl: null, ...o });
  const pastFive = () => [1, 2, 3, 4, 5].map((n) => jev({ created_at: ago(3 + n), payload: jpay({ bookingUid: `p${n}`, email: `c${n}@acme.com`, startTime: ago(48 + n) }) }));

  test("no-join-link: FAIL with a call ahead and no link; PASS with a link on the event, the bookings row, or the closer's task", async () => {
    assert.equal(await status(JOINID, { events: [jev()] }), "FAIL");
    assert.equal(await status(JOINID, { events: [jev({ payload: jpay({ meetingUrl: "https://meet.google.com/abc" }) })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev()], bookings: [booking({ provider_uid: "72964", meeting_url: "https://zoom.us/j/1" })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev()], tasks: [{ org_id: org, body: "72964", meeting_url: "https://zoom.us/j/1" }] }), "PASS");
    // Junk text, an empty string, and a link kept for another call or another company do not count.
    assert.equal(await status(JOINID, { events: [jev()], bookings: [booking({ provider_uid: "72964", meeting_url: "n/a" })] }), "FAIL");
    assert.equal(await status(JOINID, { events: [jev()], bookings: [booking({ provider_uid: "72964", meeting_url: "" })] }), "FAIL");
    assert.equal(await status(JOINID, { events: [jev()], tasks: [{ org_id: org, body: "other", meeting_url: "https://zoom.us/j/1" }] }), "FAIL");
    assert.equal(await status(JOINID, { events: [jev()], tasks: [{ org_id: uid(), body: "72964", meeting_url: "https://zoom.us/j/1" }] }), "FAIL");
  });

  test("no-join-link: cancelled, demo, another company, a tester address, an interview, and a call already over are not misses", async () => {
    assert.equal(await status(JOINID, { events: [jev(), jev({ name: "booking.cancelled", created_at: ago(1) })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev({ is_demo: true })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev({ org_id: uid() })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev({ payload: jpay({ email: "qa+sim-01@gmail.com" }) })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev({ payload: jpay({ eventTypeSlug: "post-funding-interview" }) })] }), "PASS");
    // A booking made 130 days ago for a call that is long over is not a miss.
    assert.equal(await status(JOINID, { events: [jev({ created_at: ago(24 * 130), payload: jpay({ startTime: ago(24 * 100) }) })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev({ payload: jpay({ startTime: ago(3) }) })] }), "PASS");
    assert.equal(await status(JOINID, { events: [jev({ payload: jpay({ startTime: ago(0.5) }) })] }), "FAIL");
  });

  test("no-join-link feed: five real bookings and no link fails; a link on the newest passes; fewer than three is not judged", async () => {
    assert.equal(await status(JOINID, { events: pastFive() }), "FAIL");
    const withLink = pastFive();
    withLink[0].payload.meetingUrl = "https://meet.google.com/abc";
    assert.equal(await status(JOINID, { events: withLink }), "PASS");
    assert.equal(await status(JOINID, { events: pastFive().slice(0, 2) }), "PASS");
    assert.equal(await status(JOINID, { events: pastFive(), tasks: [{ org_id: org, body: "p1", meeting_url: "https://zoom.us/j/1" }] }), "PASS");
  });

  test("no-join-link: no look-back window. Old bookings are still judged, so the red does not fade; a call ahead booked long ago is a miss", async () => {
    const oldFive = (d = 200) => [1, 2, 3, 4, 5].map((n) => jev({ created_at: ago(24 * d + n), payload: jpay({ bookingUid: `o${n}`, email: `o${n}@acme.com`, startTime: ago(24 * (d - 10) + n) }) }));
    // Five real bookings made 200 days ago and no link: red, with no newer booking to rescue it.
    assert.equal(await status(JOINID, { events: oldFive() }), "FAIL");
    assert.equal(await status(JOINID, { events: oldFive(900) }), "FAIL");
    const out = await gapChecks({ db: fixtureDb({ events: oldFive() }), orgId: org, now: NOW, env: OPEN_ENV, fetchImpl: null });
    assert.match(out.find((r) => r.id === JOINID).detail, /the newest real booking was made 200 days ago\)/);
    // A link on the newest of them: the feed worked when it last ran.
    const withLink = oldFive();
    withLink[0].payload.meetingUrl = "https://meet.google.com/abc";
    assert.equal(await status(JOINID, { events: withLink }), "PASS");
    // Fewer than three old bookings is still not judged.
    assert.equal(await status(JOINID, { events: oldFive().slice(0, 2) }), "PASS");
    // A booking made 130 days ago for a call 24 hours from now is still a call ahead with no link.
    assert.equal(await status(JOINID, { events: [jev({ created_at: ago(24 * 130) })] }), "FAIL");
  });
});
