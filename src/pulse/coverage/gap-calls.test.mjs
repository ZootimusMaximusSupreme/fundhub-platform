import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_IDS, gapChecks } from "./gap-calls.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T17:00:00.000Z");

function liveFetch() {
  const fn = async (url, opts) => {
    fn.last = { url, opts };
    return { status: 200, async text() { return "<title>Fundhub — Calendar</title>"; } };
  };
  return fn;
}

function dbWith(bag = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (/recording_url/.test(text)) return { rows: bag.unrecorded || [] };
      if (/brain_drive_sync/.test(text)) return { rows: [] };
      if (/gap-calls:booked-no-outcome/.test(text)) return { rows: bag.booked || [] };
      if (/gap-calls:booking-webhook/.test(text)) return { rows: bag.webhook || [] };
      if (/gap-calls:ai-dial/.test(text)) return { rows: bag.ai || [] };
      return { rows: [] };
    }
  };
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
      assert.match(row.suggestedFix, /Recon \(AG-07\)/);
      assert.match(row.suggestedFix, /Do not build a second watchdog/);
      assert.match(row.suggestedFix, /Do not auto-fix/);
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
    baseUrl: partial.baseUrl
  });
  return { rows, by: index(rows), db, fetchImpl };
}

function aiRow(extra = {}) {
  return {
    event_id: "e1",
    client_id: "c1",
    created_at: "2026-10-08T16:00:00.000Z",
    phone: "+15555550100",
    email: "lead@example.com",
    agent_found: false,
    agent_status: null,
    agent_runtime: null,
    has_prompt: false,
    dialed: false,
    has_failure: false,
    ...extra
  };
}

test("five checks, fixed ids, PASS FAIL or skip", async () => {
  const { rows } = await run({ db: null, orgId: null, fetchImpl: null });
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.status === "skip"));
});

test("clean rows and a live calendar are all PASS", async () => {
  const { by, fetchImpl } = await run({ baseUrl: "https://fundhub.ai/" });
  for (const id of CHECK_IDS) assert.equal(by[id].status, "PASS", id);
  assert.equal(fetchImpl.last.url, "https://fundhub.ai/app/calendar.html");
  assert.equal(fetchImpl.last.opts.method, "GET");
});

test("booked call with no outcome fails only that check", async () => {
  const { by } = await run({ rows: { booked: [{ id: "b-1" }, { id: "b-2" }] } });
  assert.equal(by["calls:booked-no-outcome"].status, "FAIL");
  assert.match(by["calls:booked-no-outcome"].detail, /2 booked calls ended with no outcome/);
  assert.match(by["calls:booked-no-outcome"].suggestedFix, /Log the outcome/);
  for (const id of CHECK_IDS) {
    if (id !== "calls:booked-no-outcome") assert.equal(by[id].status, "PASS", id);
  }
});

test("held call with no tape uses the unrecorded list", async () => {
  const old = new Date(NOW.getTime() - 40 * 60 * 1000).toISOString();
  const recent = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
  const miss = await run({
    rows: {
      unrecorded: [{
        id: "co-1",
        client_id: "c1",
        staff_id: "s1",
        outcome: "deposit",
        recording_url: "",
        transcript: "",
        logged_at: old,
        client_name: "Jane Doe"
      }]
    }
  });
  assert.equal(miss.by["calls:held-no-recording"].status, "FAIL");
  assert.match(miss.by["calls:held-no-recording"].detail, /1 held call logged with no tape/);
  assert.match(miss.by["calls:held-no-recording"].suggestedFix, /existing unrecorded-call list/);
  assert.match(miss.by["calls:held-no-recording"].suggestedFix, /Do not text each miss/);

  const noShow = await run({
    rows: {
      unrecorded: [{
        id: "co-2",
        outcome: "no_show",
        recording_url: null,
        logged_at: old,
        client_name: "No Show"
      }]
    }
  });
  assert.equal(noShow.by["calls:held-no-recording"].status, "PASS");

  const inGrace = await run({
    rows: {
      unrecorded: [{
        id: "co-3",
        outcome: "deposit",
        recording_url: null,
        logged_at: recent,
        client_name: "Still Early"
      }]
    }
  });
  assert.equal(inGrace.by["calls:held-no-recording"].status, "PASS");
});

test("calendar page dead when the GET is not the calendar", async () => {
  const down = await run({
    fetchImpl: async () => ({ status: 404, async text() { return "missing"; } })
  });
  assert.equal(down.by["calls:calendar"].status, "FAIL");
  assert.match(down.by["calls:calendar"].detail, /calendar page dead \(404\)/);

  const wrong = await run({
    fetchImpl: async () => ({ status: 200, async text() { return "<title>Login</title>"; } })
  });
  assert.equal(wrong.by["calls:calendar"].status, "FAIL");

  const boom = await run({
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  assert.equal(boom.by["calls:calendar"].status, "FAIL");
  assert.match(boom.by["calls:calendar"].detail, /socket hang up/);
});

test("booking webhook with no bookings row fails", async () => {
  const { by } = await run({ rows: { webhook: [{ uid: "bk-9" }] } });
  assert.equal(by["calls:booking-webhook"].status, "FAIL");
  assert.match(by["calls:booking-webhook"].detail, /1 booking webhook accepted with no bookings row/);
  assert.match(by["calls:booking-webhook"].suggestedFix, /bookings row was not saved/);
});

test("AI path that should dial and has no failure row fails; a dial or a failure row passes", async () => {
  const late = await run({ rows: { ai: [aiRow()] } });
  assert.equal(late.by["calls:ai-dial-no-failure"].status, "FAIL");
  assert.match(late.by["calls:ai-dial-no-failure"].detail, /1 AI call should have dialed and left no failure row/);
  assert.match(late.by["calls:ai-dial-no-failure"].suggestedFix, /Do not place a call/);

  const dialed = await run({ rows: { ai: [aiRow({ dialed: true })] } });
  assert.equal(dialed.by["calls:ai-dial-no-failure"].status, "PASS");

  const failed = await run({ rows: { ai: [aiRow({ has_failure: true })] } });
  assert.equal(failed.by["calls:ai-dial-no-failure"].status, "PASS");

  const retired = await run({
    rows: {
      ai: [aiRow({
        agent_found: true,
        agent_status: "retired",
        agent_runtime: "bland",
        has_prompt: true
      })]
    }
  });
  assert.equal(retired.by["calls:ai-dial-no-failure"].status, "PASS");
});

test("quiet hours wait is not a missed dial; a prove sim does not get that wait", async () => {
  const createdQuiet = "2026-10-08T10:00:00.000Z";
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

test("a database error is a FAIL on that check and does not throw", async () => {
  const db = {
    async query(sql) {
      const text = String(sql);
      if (/gap-calls:booked-no-outcome/.test(text)) throw new Error("bookings down");
      return { rows: [] };
    }
  };
  const { by } = await run({ db });
  assert.equal(by["calls:booked-no-outcome"].status, "FAIL");
  assert.match(by["calls:booked-no-outcome"].detail, /bookings down/);
  assert.equal(by["calls:held-no-recording"].status, "PASS");
  assert.equal(by["calls:booking-webhook"].status, "PASS");
  assert.equal(by["calls:ai-dial-no-failure"].status, "PASS");
});

test("source does not dial, does not copy the unrecorded query, and does not add a watchdog", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-calls.mjs"), "utf8");
  assert.match(src, /from ["']\.\.\/\.\.\/sales\/unrecorded\.mjs["']/);
  assert.equal((src.match(/listUnrecordedCalls/g) || []).length, 2);
  assert.doesNotMatch(src, /recording_url|brain_drive_sync/);
  assert.doesNotMatch(src, /placeCall|placeConfiguredCall|bland-voice|messaging\/dispatch|createFunction/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(src, /writeFileSync|textChris|sendSms/);
});
