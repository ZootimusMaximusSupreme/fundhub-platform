// The runner: fires every beat, decides, texts BEFORE it writes, and survives a bad hour.
//
// No network and no real database. The records database is a small stateful fake that answers ONLY the exact
// statements src/pulse/records.mjs sends (any other statement throws, so a changed statement fails loudly). The
// SQL itself is not proved here: records.mjs's own tests cover its shape, src/pulse/pulse-records.pg.test.mjs runs it
// against Postgres in CI, and `node scripts/pulse/prove.mjs --beats` runs the READ statements against the live
// database. The read box is the real openReadBox over a fake Postgres client that behaves like one (an aborted
// transaction until ROLLBACK TO SAVEPOINT, a write refused inside BEGIN READ ONLY).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  runPulse, publicSummary, missingEnv, siteUrlOf, cutDetail, BLIND_TEXT,
  RUN_BUDGET_MS, BEATS_PHASE_MS, ALERTS_PHASE_MS, RECORDS_MS
} from "./runner.mjs";
import { recordingSinks } from "./alerts.mjs";
import {
  SQL_DEFAULT_ORG, SQL_LIST_OPEN, SQL_LAST_RESULTS, SQL_WRITE_BEATS, SQL_OPEN_INCIDENT, SQL_CLAIM_ALERT,
  SQL_CLOSE_INCIDENT, SQL_LOAD_BANK_LINKS, SQL_UPSERT_BANK_LINKS
} from "./records.mjs";
import { DB_SETTINGS_SQL } from "./beats/readbox.mjs";
import { createFakePg, makeFixtureBeat } from "./fake-sinks.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const INC = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const ENV = Object.freeze({ DATABASE_URL: "postgres://fake.invalid/db", URL: "https://fundhub.ai", PULSE_SMS_TO: "+15555550100" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* THE TEST CLOCK. Texting hours (owner law 2026-10-09, src/pulse/quiet-hours.mjs): the runner texts only from
   6 a.m. to 10 p.m. Arizona time, judged by the run's own `now`. These tests used the machine's real clock, so
   at night every "it texts" test would fail. The clock is pinned to noon Arizona time on 2026-10-09 and ticks
   with the real clock, so the 50-minute claim window and the hours an incident was open still add up. The
   fake records database stamps its rows from the same clock, the way Postgres now() would. */
const CLOCK_BASE = Date.parse("2026-10-09T19:00:00.000Z"); // 12:00 p.m. Arizona
const REAL_START = Date.now();
const clockMs = () => CLOCK_BASE + (Date.now() - REAL_START);

/* ---------------- the stateful fake records database ---------------- */

function fakeRdb({ down = false, hangWrites = false, missingTables = false, failLast = false, open = [], bankLinks = [], events = [], clock = clockMs } = {}) {
  const stamp = () => new Date(clock()).toISOString();
  const state = { beats: [], incidents: open.map((x) => ({ ...x })), upserts: [], opens: 0, claims: 0, closes: 0, writes: 0 };
  let nextInc = 100;
  const missing = () => Object.assign(new Error('relation "pulse_beats" does not exist'), { code: "42P01" });
  return {
    state,
    events,
    async query(sql, params) {
      if (down) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      if (sql === SQL_DEFAULT_ORG) return { rows: [{ id: ORG }], rowCount: 1 };
      if (sql === DB_SETTINGS_SQL) return { rows: [{ transaction_read_only: "off", default_transaction_read_only: "off", pg_is_in_recovery: false, in_recovery: false }], rowCount: 1 };
      if (sql === SQL_LIST_OPEN) {
        if (missingTables) throw missing();
        return { rows: state.incidents.filter((i) => !i.closed_at).map((i) => ({ ...i })), rowCount: 1 };
      }
      if (sql === SQL_LAST_RESULTS) {
        if (missingTables || failLast) throw missing();
        const ids = params[1];
        const rows = [];
        for (const id of ids) {
          rows.push(...state.beats.filter((r) => r.beat_id === id).sort((a, b) => b.seq - a.seq).slice(0, 2));
        }
        return { rows, rowCount: rows.length };
      }
      if (sql === SQL_LOAD_BANK_LINKS) return { rows: bankLinks, rowCount: bankLinks.length };
      if (sql === SQL_WRITE_BEATS) {
        events.push("write:beats"); state.writes++;
        if (hangWrites) return new Promise(() => {});
        if (missingTables) throw missing();
        const rows = JSON.parse(params[2]);
        for (const r of rows) state.beats.push({ seq: state.beats.length + 1, beat_id: r.beat_id, run_id: params[1], ran_at: stamp(), ok: r.ok, step: r.step ?? null, detail: r.detail ?? null, duration_ms: r.duration_ms ?? null, raw: r });
        return { rows: [], rowCount: rows.length };
      }
      if (sql === SQL_UPSERT_BANK_LINKS) {
        events.push("write:bank-links"); state.writes++;
        state.upserts.push(JSON.parse(params[1]));
        return { rows: [], rowCount: JSON.parse(params[1]).length };
      }
      if (sql === SQL_OPEN_INCIDENT) {
        events.push("write:incident-open"); state.writes++;
        if (state.incidents.some((i) => i.beat_id === params[1] && !i.closed_at)) return { rows: [], rowCount: 0 };
        state.opens++;
        const row = { id: INC(nextInc++), beat_id: params[1], opened_at: stamp(), opened_run_id: params[2], first_step: params[3], first_detail: params[4], last_alert_at: null, alerts_sent: 0, closed_at: null };
        state.incidents.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (sql === SQL_CLAIM_ALERT) {
        events.push("write:claim"); state.writes++;
        const i = state.incidents.find((x) => x.id === params[0] && !x.closed_at);
        const ok = i && (!i.last_alert_at || clock() - new Date(i.last_alert_at).getTime() > 50 * 60 * 1000);
        if (!ok) return { rows: [], rowCount: 0 };
        i.last_alert_at = stamp(); i.alerts_sent++; state.claims++;
        return { rows: [{ id: i.id, alerts_sent: i.alerts_sent }], rowCount: 1 };
      }
      if (sql === SQL_CLOSE_INCIDENT) {
        events.push("write:incident-close"); state.writes++;
        const i = state.incidents.find((x) => x.id === params[0] && !x.closed_at);
        if (!i) return { rows: [], rowCount: 0 };
        i.closed_at = stamp(); state.closes++;
        return { rows: [{ id: i.id }], rowCount: 1 };
      }
      throw new Error(`fakeRdb: unexpected statement: ${String(sql).slice(0, 70)}`);
    }
  };
}

/* ---------------- beats ---------------- */

const FIX = [
  "Check the fixture page answers on the site.", "", "Likely causes:", "- The page moved (shows up at step two).",
  "- The database did not answer (shows up at step one).", "Steps:", "- Open the page in a browser and read the status.",
  "- Run node scripts/pulse/run-beat.mjs fixture and read the step it stops at.", "Files: src/pulse/beats/contract.mjs"
].join("\n");

const beat = (id, run, over = {}) => makeFixtureBeat({
  id, title: `Beat ${id}`, steps: ["one", "two", "three"], deadlineMs: 2000,
  fixGuide: FIX.replace("Check the fixture page", `Fix ${id}: check the page`), run, ...over
});
const reads = async (ctx) => ctx.step("one", async () => (await ctx.read("SELECT 1 AS n")).rows);
const greenBeat = (id, over) => beat(id, async (ctx) => { await reads(ctx); ctx.skipStep("two", "x"); ctx.skipStep("three", "x"); return ctx.done("fine"); }, over);
const redBeat = (id, over) => beat(id, async (ctx) => { await reads(ctx); await ctx.step("two", async () => { throw ctx.fail("two", "the site said 500"); }); return ctx.done("never"); }, over);
const flipBeat = (id, flag, over) => beat(id, async (ctx) => { await reads(ctx); await ctx.step("two", async () => { if (flag.red) throw ctx.fail("two", "the site said 500"); }); ctx.skipStep("three", "x"); return ctx.done("fine"); }, over);

const okProbe = { get: async () => ({ ok: true, status: 200, ms: 3, finalHost: "fundhub.ai", bodySnippet: "", body: "", headers: {}, error: null, class: "ok" }) };
okProbe.head = okProbe.get;

function harness(beats, { rdbOpts = {}, sinkOpts = {}, now, ...runOpts } = {}) {
  const events = [];
  const rdb = fakeRdb({ events, ...rdbOpts });
  const sinks = recordingSinks(sinkOpts);
  const origText = sinks.text;
  sinks.text = async (b, o) => { events.push("text"); return origText(b, o); };
  const origNtfy = sinks.ntfy;
  sinks.ntfy = async (n, o) => { events.push("ntfy"); return origNtfy(n, o); };
  const pgs = [];
  const connect = async () => {
    const pg = createFakePg({ answer: () => [{ n: 1 }] });
    pgs.push(pg);
    return pg;
  };
  const go = (over = {}) => runPulse({ env: ENV, now: now ?? new Date(clockMs()), beats, mode: "live", sinks, rdb, connect, probe: okProbe, ...runOpts, ...over });
  return { events, rdb, sinks, pgs, go };
}

/* ============================== the basics ============================== */

describe("constants", () => {
  test("the clock is the one in the cut", () => {
    assert.equal(RUN_BUDGET_MS, 22000);
    assert.equal(BEATS_PHASE_MS, 13000);
    assert.equal(ALERTS_PHASE_MS, 6000);
    assert.equal(RECORDS_MS, 2500);
    assert.ok(BEATS_PHASE_MS + ALERTS_PHASE_MS <= RUN_BUDGET_MS - 3000, "the beats and the text fit inside the run with room for the prefetch");
    assert.equal(cutDetail(13000), "cut at the 13 s beat budget");
  });
});

describe("the env gate", () => {
  test("no DATABASE_URL: nothing runs. No beat, no database, no text.", async () => {
    let ran = 0;
    const h = harness([beat("a", async (ctx) => { ran++; return ctx.done("x"); })]);
    const out = await h.go({ env: { URL: "https://fundhub.ai" } });
    assert.equal(out.ok, false);
    assert.match(out.error, /missing env: DATABASE_URL/);
    assert.equal(ran, 0);
    assert.equal(out.ran, 0);
    assert.equal(h.rdb.events.length, 0);
    assert.equal(h.pgs.length, 0, "no connection was even asked for");
    assert.deepEqual(h.sinks.calls, { text: [], ntfy: [] });
  });

  test("no site address: nothing runs either", async () => {
    let ran = 0;
    const h = harness([beat("a", async (ctx) => { ran++; return ctx.done("x"); })]);
    const out = await h.go({ env: { DATABASE_URL: "postgres://x/y" } });
    assert.match(out.error, /missing env: URL/);
    assert.equal(ran, 0);
  });

  test("on Netlify with no URL variable the site address falls back to fundhub.ai (a silent never-run is worse)", () => {
    assert.deepEqual(missingEnv({ DATABASE_URL: "x", AWS_LAMBDA_FUNCTION_NAME: "f" }), []);
    assert.equal(siteUrlOf({ AWS_LAMBDA_FUNCTION_NAME: "f" }), "https://fundhub.ai");
    assert.deepEqual(missingEnv({ DATABASE_URL: "x" }), ["URL"], "on a laptop there is no fallback");
    assert.equal(siteUrlOf({ URL: "https://example.com/" }), "https://example.com");
  });

  test("an unknown mode is refused", async () => {
    const h = harness([greenBeat("a")]);
    const out = await h.go({ mode: "yolo" });
    assert.equal(out.ok, false);
    assert.match(out.error, /unknown mode/);
  });
});

describe("a pulse that cannot load its beats is not a silent pulse", () => {
  const broken = async () => { throw new Error("bad beat list: beat-x.mjs: could not be imported"); };

  test("live: it says so by text (one text), runs nothing, writes nothing, and is not ok", async () => {
    const h = harness(undefined);
    const out = await h.go({ beats: undefined, loadBeatsImpl: broken });
    assert.equal(out.ok, false);
    assert.match(out.error, /could not load the beats/);
    assert.equal(out.ran, 0);
    assert.equal(h.sinks.calls.text.length, 1);
    assert.equal(h.sinks.calls.text[0], BLIND_TEXT);
    assert.equal(BLIND_TEXT, "Fundhub BROKEN: the hourly pulse could not load its checks. Fix: open the pulse-hourly function log on Netlify.");
    assert.equal(h.rdb.events.filter((e) => e.startsWith("write:")).length, 0);
  });

  test("prove and one: no text at all", async () => {
    const h = harness(undefined);
    const out = await h.go({ beats: undefined, loadBeatsImpl: broken, mode: "prove" });
    assert.equal(out.ok, false);
    assert.equal(h.sinks.calls.text.length, 0);
  });
});

describe("green", () => {
  test("a green hour: no text, one pulse_beats write, the box was rolled back and destroyed, ok", async () => {
    const h = harness([greenBeat("a"), greenBeat("b")]);
    const out = await h.go();
    assert.equal(out.ok, true);
    assert.equal(out.ran, 2);
    assert.equal(out.failed, 0);
    assert.equal(out.timedOut, 0);
    assert.equal(out.dbUp, true);
    assert.deepEqual(h.sinks.calls, { text: [], ntfy: [] }, "nothing to say, nothing sent");
    assert.deepEqual(out.records, { written: true, error: null });
    assert.equal(h.rdb.state.beats.length, 2);
    assert.ok(h.rdb.state.beats.every((r) => r.ok === true));
    // ONE box for the whole run, never committed.
    assert.equal(h.pgs.length, 1);
    const pg = h.pgs[0];
    assert.equal(pg.commits, 0);
    assert.ok(pg.rollbacks >= 1);
    assert.deepEqual(pg.released, [true], "destroyed, never handed back to the pool");
    assert.equal(pg.texts()[0].startsWith("BEGIN READ ONLY"), true);
    assert.equal(out.box.commitsSent, 0);
    assert.equal(out.box.rolledBack, true);
    assert.ok(out.ms < 2000);
  });

  test("an empty beat list is BLIND, never green: live, it texts once, writes nothing, opens no box, and is not ok", async () => {
    const h = harness([]);
    const out = await h.go();
    assert.equal(out.ok, false, "nothing was checked, so nothing may be called well");
    assert.match(out.error, /no beats to run/);
    assert.equal(out.ran, 0);
    assert.equal(h.pgs.length, 0);
    assert.deepEqual(h.rdb.events, ["text"], "one text and not a single write");
    assert.deepEqual(h.sinks.calls.text, [BLIND_TEXT]);
    assert.equal(out.alerts.texts[0].kind, "load_failed");
    // The function turns this into a RED receipt (src/pulse/heartbeats.mjs noteScheduledRun: ok === false -> "error").
    assert.equal(publicSummary(out).ok, false);
  });

  test("an empty list in prove or one mode is also not ok, and sends no text", async () => {
    for (const mode of ["prove", "one"]) {
      const h = harness([]);
      const out = await h.go({ mode });
      assert.equal(out.ok, false, mode);
      assert.match(out.error, /no beats to run/, mode);
      assert.deepEqual(h.sinks.calls.text, [], mode);
    }
  });

  test("the empty-list text that cannot be delivered still leaves a not-ok run (the receipt goes red)", async () => {
    const h = harness([], { sinkOpts: { textStatus: "failed" } });
    const out = await h.go();
    assert.equal(out.ok, false);
    assert.equal(out.alerts.texts[0].delivery_status, "failed");
  });

  test("a list with one beat in it is NOT blind (the empty-list rule has an edge)", async () => {
    const h = harness([greenBeat("a")]);
    const out = await h.go();
    assert.equal(out.ok, true);
    assert.equal(out.error, undefined);
  });

  test("`only` runs just those beats; an unknown id is a plain error", async () => {
    const h = harness([greenBeat("a"), greenBeat("b")]);
    const out = await h.go({ only: ["b"] });
    assert.deepEqual(out.results.map((r) => r.beatId), ["b"]);
    const bad = await h.go({ only: ["zzz"] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /no such beat: zzz/);
  });
});

describe("red", () => {
  test("a red beat: ONE text with the title, the step and the fix line; the incident opens and is claimed; the run is still ok", async () => {
    const h = harness([redBeat("a"), greenBeat("b")]);
    const out = await h.go();
    assert.equal(out.ok, true, "a red beat does not make the run not-ok");
    assert.equal(out.failed, 1);
    assert.equal(h.sinks.calls.text.length, 1);
    assert.equal(h.sinks.calls.text[0], 'Fundhub BROKEN: Beat a. It stopped at "two". Fix: Fix a: check the page answers on the site.');
    assert.equal(h.sinks.calls.ntfy.length, 0);
    assert.deepEqual(out.alerts.newBreaks, ["a"]);
    assert.equal(h.rdb.state.opens, 1);
    assert.equal(h.rdb.state.claims, 1, "the text went, so the alert was claimed");
    const red = h.rdb.state.beats.find((r) => r.beat_id === "a");
    assert.equal(red.ok, false);
    assert.equal(red.step, "two");
    assert.equal(red.detail, "the site said 500");
  });

  test("THE ORDER: the text goes out BEFORE any record is written", async () => {
    const h = harness([redBeat("a")]);
    await h.go();
    const text = h.events.indexOf("text");
    const firstWrite = h.events.findIndex((e) => e.startsWith("write:"));
    assert.ok(text >= 0 && firstWrite >= 0, h.events.join(","));
    assert.ok(text < firstWrite, `text at ${text}, first write at ${firstWrite}: ${h.events.join(",")}`);
  });

  test("a slow records database cannot hold the text back, and costs ok:false", async () => {
    const h = harness([redBeat("a")], { rdbOpts: { hangWrites: true }, budgets: { records: 150 } });
    const t0 = Date.now();
    const out = await h.go();
    assert.equal(h.sinks.calls.text.length, 1, "the text went");
    assert.equal(out.ok, false);
    assert.match(out.error, /records took more than 150 ms/);
    assert.ok(Date.now() - t0 < 2500);
    assert.ok(h.events.indexOf("text") < h.events.indexOf("write:beats"));
  });

  test("a hung beat: red at the step it hung in, with the deadline in the detail, and the text names the step", async () => {
    const hang = beat("h", async (ctx) => { await ctx.step("one", async () => new Promise(() => {})); return ctx.done("never"); }, { deadlineMs: 500 });
    const h = harness([hang, greenBeat("g")]);
    const out = await h.go();
    const r = out.results.find((x) => x.beatId === "h");
    assert.equal(r.ok, false);
    assert.equal(r.step, "one");
    assert.equal(r.detail, "deadline 500 ms passed in step one");
    assert.match(h.sinks.calls.text[0], /It stopped at "one"/);
    assert.equal(out.results.find((x) => x.beatId === "g").ok, true, "one hung beat does not stop another");
  });

  test("a beat that throws: red, with the message (redacted), the run carries on", async () => {
    const boom = beat("t", async (ctx) => { await ctx.step("one", async () => { throw new Error("kaboom token=abc123secretvalue"); }); return ctx.done("never"); });
    const h = harness([boom, greenBeat("g")]);
    const out = await h.go();
    const r = out.results.find((x) => x.beatId === "t");
    assert.equal(r.ok, false);
    assert.equal(r.step, "one");
    assert.match(r.detail, /^threw: kaboom/);
    assert.doesNotMatch(r.detail, /abc123secretvalue/);
    assert.equal(out.ok, true);
  });
});

describe("the beats phase is capped", () => {
  test("a beat still running at the cut is red at its step, 'cut at the ... beat budget', time NULL, and the run still texts", async () => {
    const slow = beat("s", async (ctx) => { await ctx.step("two", async () => new Promise(() => {})); return ctx.done("never"); }, { deadlineMs: 12000 });
    const h = harness([slow, greenBeat("g")], { budgets: { beats: 250 } });
    const t0 = Date.now();
    const out = await h.go();
    assert.ok(Date.now() - t0 < 3000, "did not wait for the beat's own 12 s deadline");
    assert.equal(out.timedOut, 1);
    const r = out.results.find((x) => x.beatId === "s");
    assert.equal(r.ok, false);
    assert.equal(r.step, "two");
    assert.equal(r.detail, "cut at the 250 ms beat budget");
    assert.equal(r.ms, null, "never measured: NULL, not 0");
    const saved = h.rdb.state.beats.find((x) => x.beat_id === "s");
    assert.equal(saved.duration_ms, null);
    assert.equal(saved.step, "two");
    assert.equal(h.sinks.calls.text.length, 1);
    assert.match(h.sinks.calls.text[0], /It stopped at "two"/);
    assert.equal(h.pgs[0].released[0], true);
  });

  test("a LATE REJECTION after a cut does not crash the run or the process", async () => {
    const stray = [];
    const onStray = (e) => stray.push(e);
    process.on("unhandledRejection", onStray);
    try {
      const late = beat("l", async (ctx) => {
        await ctx.step("one", async () => {
          await sleep(400); // the run cuts this beat at 100 ms and closes the box
          ctx.read("SELECT 1");                  // not awaited: refused, because the beat is over
          ctx.http.get("https://fundhub.ai/x");  // not awaited: same
          ctx.dbSettings();                      // not awaited: same
        });
        return ctx.done("never");
      }, { deadlineMs: 12000 });
      const h = harness([late], { budgets: { beats: 100 } });
      const out = await h.go();
      assert.equal(out.timedOut, 1);
      await sleep(700);
      assert.deepEqual(stray.map((e) => String(e && e.message)), [], "nothing was left unhandled");
      assert.equal(h.sinks.calls.text.length, 1, "the text still went");
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });
});

/* The clock guards (critic issue 3). These use small budgets so the real timings are short. Each one is written so
   that removing the clip it names makes the run take longer than the bound, and the test fails. */
describe("the clock: the text always gets its window", () => {
  /** A records database whose first read (the default org) takes `ms`. */
  const slowOrg = (rdb, ms) => ({ ...rdb, query: async (sql, p) => { if (sql === SQL_DEFAULT_ORG) await sleep(ms); return rdb.query(sql, p); } });
  const hang = (id) => beat(id, async (ctx) => { await ctx.step("one", async () => new Promise(() => {})); return ctx.done("never"); }, { deadlineMs: 12000 });

  test("a hanging beat is cut early enough that the text goes inside the run, not at the end of the beats budget", async () => {
    // run 1500, text window 900: the beats phase may use about 600 ms, however big the beats budget is.
    const h = harness([hang("s")], { budgets: { run: 1500, alerts: 900, beats: 6000, minText: 300 } });
    const textAt = [];
    const t0 = Date.now();
    const inner = h.sinks.text;
    h.sinks.text = async (b, o) => { textAt.push(Date.now() - t0); return inner(b, o); };
    const out = await h.go();
    assert.equal(out.timedOut, 1);
    assert.equal(textAt.length, 1);
    assert.ok(textAt[0] < 1100, `the text went at ${textAt[0]} ms; the beats phase must stop at about 600 ms (run minus the text window)`);
    assert.ok(out.ms < 2500, `the whole run took ${out.ms} ms`);
  });

  test("a slow start leaves the text only what is left of the run, not its full window", async () => {
    // The org read takes 1600 ms. The run is 2500 ms, the window is 2000 ms: only about 850 ms is left for the text.
    const h = harness([redBeat("a")], {
      sinkOpts: { textStatus: "hang" },
      budgets: { run: 2500, alerts: 2000, prefetch: 2000, minText: 100 }
    });
    const out = await h.go({ rdb: slowOrg(h.rdb, 1600) });
    assert.equal(out.alerts.texts[0].delivery_status, "failed", "the hung text was cut");
    assert.ok(out.ms >= 2300, `it did wait for the text (${out.ms} ms)`);
    assert.ok(out.ms < 2900, `the run took ${out.ms} ms; a text window of the full 2000 ms would have run it past 3100`);
  });

  test("a prefetch read that takes longer than the prefetch cap does not delay the beats", async () => {
    const h = harness([greenBeat("a")], { budgets: { prefetch: 300 } });
    const out = await h.go({ rdb: slowOrg(h.rdb, 1500) });
    assert.equal(out.dbUp, false, "the org read missed its 300 ms cap");
    assert.ok(out.ms < 1000, `the run took ${out.ms} ms; it waited for the slow read`);
    assert.equal(out.ran, 1, "the beat still ran");
  });
});

describe("the clock: the default caps are the ones in the cut", () => {
  test("with NO budget override, a prefetch read that takes 3 s is given up on at 2 s and the run goes on", async () => {
    const h = harness([greenBeat("a")]);
    const slow = { ...h.rdb, query: async (sql, p) => { if (sql === SQL_DEFAULT_ORG) await sleep(3000); return h.rdb.query(sql, p); } };
    const out = await h.go({ rdb: slow });
    assert.equal(out.dbUp, false, "the org read missed the 2 s prefetch cap");
    assert.ok(out.ms >= 1900, `it did wait the 2 s (${out.ms} ms)`);
    assert.ok(out.ms < 2600, `the run took ${out.ms} ms; it waited for the 3 s read`);
  });
});

describe("the database is down", () => {
  const readers = (ids) => ids.map((i) => greenBeat(i));

  test("beats that read go red at 'db:'; the text says the database is down ONCE; no state, so it texts every hour", async () => {
    const h = harness(readers(["a", "b", "c", "d"]), { rdbOpts: { down: true } });
    const out = await h.go();
    assert.equal(out.dbUp, false);
    for (const r of out.results) {
      assert.equal(r.ok, false);
      assert.match(r.detail, /^threw: db: /);
    }
    assert.equal(h.sinks.calls.text.length, 1);
    assert.equal(h.sinks.calls.text[0], "Fundhub BROKEN: the database is not answering. 4 checks are red. Fix: open https://fundhub.ai/api/health and the Supabase project.");
    assert.equal(out.ok, false, "records could not be saved");
    assert.match(out.error, /records: the database is not answering/);
    assert.equal(h.pgs.length, 0, "no box was opened against a database that is not answering");
    assert.equal(h.rdb.state.writes, 0);
    // The next hour: still no state, so it texts again.
    await h.go();
    assert.equal(h.sinks.calls.text.length, 2);
  });

  test("a beat that does not need the database still runs when it is down", async () => {
    const web = beat("w", async (ctx) => { await ctx.step("two", async () => (await ctx.http.get(`${ctx.siteUrl}/x`))); ctx.skipStep("one", "x"); ctx.skipStep("three", "x"); return ctx.done("fine"); });
    const h = harness([web, greenBeat("a")], { rdbOpts: { down: true } });
    const out = await h.go();
    assert.equal(out.results.find((r) => r.beatId === "w").ok, true);
    assert.equal(out.results.find((r) => r.beatId === "a").ok, false);
    assert.equal(h.sinks.calls.text.length, 1, "one red beat: its own text");
    assert.match(h.sinks.calls.text[0], /^Fundhub BROKEN: Beat a\. It stopped at "one"/);
  });

  test("the pulse tables are not there yet (migration not applied): the text still goes, the run is not ok and says why", async () => {
    const h = harness([redBeat("a")], { rdbOpts: { missingTables: true } });
    const out = await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, /migration 475 not applied/);
    assert.equal(out.dbUp, true);
  });
});

describe("the text provider is down", () => {
  test("the text fails, ntfy carries it: delivered, the run is ok, and the alert is still claimed", async () => {
    const h = harness([redBeat("a")], { sinkOpts: { textStatus: "failed", ntfyStatus: "sent" } });
    const out = await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
    assert.equal(h.sinks.calls.ntfy.length, 1);
    assert.equal(out.alerts.delivered, true);
    assert.equal(out.ok, true);
    assert.equal(h.rdb.state.claims, 1);
  });

  test("both roads fail: the run is NOT ok (the heartbeat goes red) and nothing is claimed, so the next hour retries", async () => {
    const h = harness([redBeat("a")], { sinkOpts: { textStatus: "no_number", ntfyStatus: null } });
    const out = await h.go();
    assert.equal(out.ok, false);
    assert.match(out.error, /alert due but not delivered/);
    assert.equal(h.rdb.state.opens, 1, "the incident is still recorded");
    assert.equal(h.rdb.state.claims, 0);
    // Next hour the incident is open and was never texted: it is due again.
    h.sinks.calls.text.length = 0;
    const again = await h.go();
    assert.equal(again.alerts.stillBroken.length, 1);
    assert.equal(h.sinks.calls.text.length, 1);
  });

  test("the text-path beat red: the buzz goes at the same time", async () => {
    const h = harness([redBeat("text-path")], { sinkOpts: { textStatus: "sent", ntfyStatus: "sent" } });
    await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
    assert.equal(h.sinks.calls.ntfy.length, 1);
  });
});

describe("one text an hour", () => {
  test("a second invocation in the same hour sends NO second text", async () => {
    const h = harness([redBeat("a")]);
    await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
    const second = await h.go();
    assert.equal(h.sinks.calls.text.length, 1, "the retry was quiet");
    assert.deepEqual(second.alerts.quiet, ["a"]);
    assert.equal(second.alerts.due, false);
    assert.equal(h.rdb.state.opens, 1, "and did not open a second incident");
    assert.equal(h.rdb.state.beats.length, 2, "but the second run is still recorded");
  });

  test("an hour later (past the 50 minute claim) it texts 'still broken, hour N'", async () => {
    const old = new Date(clockMs() - 3 * 3600 * 1000).toISOString();
    const h = harness([redBeat("a")], { rdbOpts: { open: [{ id: INC(1), beat_id: "a", opened_at: old, opened_run_id: INC(2), first_step: "two", first_detail: "x", last_alert_at: new Date(clockMs() - 61 * 60 * 1000).toISOString(), alerts_sent: 3, closed_at: null }] } });
    const out = await h.go();
    assert.deepEqual(out.alerts.stillBroken, ["a"]);
    assert.match(h.sinks.calls.text[0], /^Fundhub STILL BROKEN, hour 4: Beat a at "two"\. Fix: /);
    assert.equal(h.rdb.state.claims, 1);
    assert.equal(h.rdb.state.opens, 0, "the existing incident is reused");
  });

  test("a storm (4+ red at once) is ONE text", async () => {
    const h = harness(["a", "b", "c", "d", "e"].map((i) => redBeat(i)));
    const out = await h.go();
    assert.equal(out.failed, 5);
    assert.equal(h.sinks.calls.text.length, 1);
    assert.match(h.sinks.calls.text[0], /^Fundhub BROKEN: 5 checks are red at once\. Likely one cause\. First: Beat a at "two"/);
    assert.equal(out.alerts.storm, true);
    assert.equal(h.rdb.state.opens, 5, "each break still has its own incident");
  });

  test("two things in one hour are one combined text", async () => {
    const h = harness([redBeat("a"), redBeat("b")]);
    await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
    assert.match(h.sinks.calls.text[0], /^Fundhub: 2 things changed\./);
  });
});

describe("healed", () => {
  test("red, then green: one FIXED text, the incident closes, and a third green hour says nothing", async () => {
    const flag = { red: true };
    const h = harness([flipBeat("a", flag)]);
    await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
    flag.red = false;
    const healed = await h.go();
    assert.deepEqual(healed.alerts.healed, ["a"]);
    assert.equal(h.sinks.calls.text.length, 2);
    assert.match(h.sinks.calls.text[1], /^Fundhub FIXED: Beat a\. It was broken 1 h\.$/);
    assert.equal(h.rdb.state.closes, 1);
    assert.equal(h.rdb.state.incidents.filter((i) => !i.closed_at).length, 0);
    await h.go();
    assert.equal(h.sinks.calls.text.length, 2, "a green hour with nothing open says nothing");
  });
});

describe("damping", () => {
  test("damp 2: one red hour is silent, two in a row texts", async () => {
    const flag = { red: true };
    const h = harness([flipBeat("v", flag, { damp: 2 })]);
    const first = await h.go();
    assert.equal(h.sinks.calls.text.length, 0, "one red hour is not enough");
    assert.deepEqual(first.alerts.damped, ["v"]);
    assert.equal(h.rdb.state.opens, 0, "and no incident is opened for it");
    assert.equal(h.rdb.state.beats.length, 1, "but it IS recorded, which is what the next run reads");
    const second = await h.go();
    assert.equal(h.sinks.calls.text.length, 1, "two in a row: now it texts");
    assert.deepEqual(second.alerts.newBreaks, ["v"]);
  });

  test("damp 2: a red hour between greens never texts", async () => {
    const flag = { red: false };
    const h = harness([flipBeat("v", flag, { damp: 2 })]);
    await h.go();
    flag.red = true; await h.go();
    flag.red = false; await h.go();
    flag.red = true; await h.go();
    assert.equal(h.sinks.calls.text.length, 0);
  });

  test("damp 2 but the previous results cannot be read: it texts on the first red", async () => {
    const h = harness([redBeat("v", { damp: 2 })], { rdbOpts: { failLast: true } });
    const out = await h.go();
    assert.deepEqual(out.alerts.newBreaks, ["v"]);
    assert.equal(h.sinks.calls.text.length, 1);
  });

  test("damp 1 (the default) texts on the first red", async () => {
    const h = harness([redBeat("v")]);
    await h.go();
    assert.equal(h.sinks.calls.text.length, 1);
  });
});

describe("bank links ride through the runner, not the beat", () => {
  test("the runner loads them into ctx.state, and writes what the beat hands back with ONE upsert", async () => {
    let seen = null;
    const links = beat("l", async (ctx) => {
      seen = ctx.state;
      ctx.skipStep("one", "x"); ctx.skipStep("two", "x"); ctx.skipStep("three", "x");
      return ctx.done("checked 1", { bankLinks: [{ urlHash: "a".repeat(64), host: "bank.example.com", lastClass: "OK", lastStatus: 200, lastCheckedAt: "2026-10-09T19:07:00.000Z" }] });
    }, { needs: ["bankLinks"] });
    const existing = [{ url_hash: "b".repeat(64), host: "other.example.com", lender_ids: [], first_seen_at: "2026-10-01T00:00:00Z", last_checked_at: null, last_class: null, last_status: null, last_detail: null, last_good_at: null, fail_streak: 0, final_host: null }];
    const h = harness([links], { rdbOpts: { bankLinks: existing } });
    const out = await h.go();
    assert.equal(seen.bankLinks.length, 1);
    assert.equal(seen.bankLinks[0].urlHash, "b".repeat(64));
    assert.equal(h.rdb.state.upserts.length, 1);
    assert.equal(h.rdb.state.upserts[0][0].url_hash, "a".repeat(64));
    assert.equal(out.results[0].evidence.bankLinks, undefined, "the bulky rows are not carried in the run result");
    assert.equal(out.results[0].evidence.bankLinksCount, 1);
  });

  test("a beat that does not declare the need gets no state", async () => {
    let seen = "unset";
    const b = beat("n", async (ctx) => { seen = ctx.state; ctx.skipStep("one", "x"); ctx.skipStep("two", "x"); ctx.skipStep("three", "x"); return ctx.done("ok"); });
    const h = harness([b]);
    await h.go();
    assert.equal(seen, null);
  });
});

describe("modes other than live write nothing and send nothing real", () => {
  test("prove: no record is written, no incident opened, the text goes to the FAKE (a real sink is never built)", async () => {
    const events = [];
    const rdb = fakeRdb({ events });
    const h = harness([redBeat("a")]);
    // No sinks passed on purpose: a non-live run must build recording fakes, not the real ones.
    const out = await runPulse({ env: ENV, now: new Date(clockMs()), beats: [redBeat("a")], mode: "prove", rdb, connect: async () => createFakePg({ answer: () => [{ n: 1 }] }), probe: okProbe });
    assert.equal(rdb.state.writes, 0, events.join(","));
    assert.equal(rdb.state.opens, 0);
    assert.equal(out.alerts.due, true);
    assert.equal(out.alerts.texts[0].sent_to_last4, "0000", "that is the recording fake's marker");
    assert.equal(out.records.written, false);
    assert.equal(out.ok, true, "a proof run does not fail for not saving");
    assert.ok(h);
  });

  test("one: the same, and `only` picks the beat", async () => {
    const rdb = fakeRdb();
    const out = await runPulse({ env: ENV, now: new Date(clockMs()), beats: [redBeat("a"), greenBeat("b")], mode: "one", only: ["b"], rdb, connect: async () => createFakePg({ answer: () => [{ n: 1 }] }), probe: okProbe });
    assert.deepEqual(out.results.map((r) => r.beatId), ["b"]);
    assert.equal(rdb.state.writes, 0);
  });
});

describe("the runner never reaches for a real provider on its own", () => {
  test("no network call is made by a whole red run (the sinks and the probe are fakes)", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("no network in this test"); };
    try {
      const h = harness([redBeat("a")]);
      await h.go();
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("publicSummary", () => {
  test("counts only, an error redacted and cut", () => {
    const s = publicSummary({ ok: false, ran: 3, failed: 1, timedOut: 0, ms: 123.4, error: "x token=abcdef0123456789 ".repeat(30), results: [{ detail: "secret" }], alerts: { body: "text" } });
    assert.deepEqual(Object.keys(s).sort(), ["error", "failed", "ms", "ok", "ran", "timedOut"]);
    assert.ok(s.error.length <= 160);
    assert.doesNotMatch(s.error, /abcdef0123456789/);
    assert.deepEqual(publicSummary(undefined), { ok: false, ran: 0, failed: 0, timedOut: 0, ms: null });
  });
});

/* ============================== texting hours ============================== */

/* Owner law 2026-10-09 (.claude/rules/texting-hours.md): every text to Chris goes out only from 6 a.m. to
   10 p.m. Arizona time. The pulse runs every hour at :07. Overnight it still checks and still keeps the
   incident, but sends nothing and claims nothing, so the 6:07 a.m. run tells him. Arizona is UTC-7. */
describe("texting hours: the overnight pulse keeps the record and the 6:07 a.m. run sends one text", () => {
  /** A harness whose clock is set by hand, for the run and for the fake database's now(). */
  function nightHarness(beats) {
    let clock = Date.parse("2026-10-10T09:07:00.000Z"); // 2:07 a.m. Arizona, October 10
    const h = harness(beats, { rdbOpts: { clock: () => clock } });
    return { ...h, set: (iso) => { clock = Date.parse(iso); }, run: () => h.go({ now: new Date(clock) }) };
  }

  test("a break at 2:07 a.m. sends nothing; the same break at 6:07 a.m. sends ONE text; alerts_sent stays 0 until then", async () => {
    const flag = { red: true };
    const h = nightHarness([flipBeat("a", flag)]);

    const night = await h.run();
    assert.equal(night.ok, true, "a held text is not a broken run, so job:pulse-hourly stays green");
    assert.equal(night.alerts.held, true);
    assert.equal(night.alerts.delivered, false);
    assert.deepEqual(night.alerts.texts.map((t) => t.delivery_status), ["held_quiet_hours"]);
    assert.equal(h.sinks.calls.text.length, 0, "no text at 2:07 a.m.");
    assert.equal(h.sinks.calls.ntfy.length, 0, "no buzz at 2:07 a.m.");
    assert.equal(h.rdb.state.opens, 1, "the break is still saved as an open incident");
    assert.equal(h.rdb.state.claims, 0, "claimAlert is not used up");
    assert.equal(h.rdb.state.incidents[0].alerts_sent, 0);

    for (const iso of ["2026-10-10T10:07:00.000Z", "2026-10-10T11:07:00.000Z", "2026-10-10T12:07:00.000Z"]) {
      h.set(iso); // 3:07, 4:07, 5:07 a.m.
      const r = await h.run();
      assert.equal(r.alerts.held, true, iso);
    }
    assert.equal(h.sinks.calls.text.length, 0, "nothing all night");
    assert.equal(h.rdb.state.incidents[0].alerts_sent, 0, "still never told");
    assert.equal(h.rdb.state.opens, 1, "one incident, not one per hour");

    h.set("2026-10-10T13:07:00.000Z"); // 6:07 a.m.
    const morning = await h.run();
    assert.equal(morning.ok, true);
    assert.equal(h.sinks.calls.text.length, 1, "one text at 6:07 a.m.");
    assert.match(h.sinks.calls.text[0], /^Fundhub BROKEN since 2:07 a\.m\.: Beat a\. It stopped at "two"\./);
    assert.equal(h.rdb.state.claims, 1);
    assert.equal(h.rdb.state.incidents[0].alerts_sent, 1);

    h.set("2026-10-10T13:17:00.000Z"); // a retry ten minutes later stays quiet
    await h.run();
    assert.equal(h.sinks.calls.text.length, 1, "the claim window still stops a second text");
  });

  test("a break that opens and heals overnight gets no text at all, not even FIXED, and the incident is closed", async () => {
    const flag = { red: true };
    const h = nightHarness([flipBeat("a", flag)]);
    await h.run(); // 2:07 a.m. red
    flag.red = false;
    h.set("2026-10-10T10:07:00.000Z"); // 3:07 a.m. green
    const healedAtNight = await h.run();
    assert.deepEqual(healedAtNight.alerts.healedQuiet, ["a"]);
    h.set("2026-10-10T13:07:00.000Z"); // 6:07 a.m. still green
    const morning = await h.run();
    assert.equal(morning.alerts.due, false);
    assert.equal(h.sinks.calls.text.length, 0);
    assert.equal(h.rdb.state.closes, 1);
    assert.equal(h.rdb.state.incidents.filter((i) => !i.closed_at).length, 0);
  });

  test("10:00 p.m. is held, 9:59 p.m. is not", async () => {
    const late = nightHarness([redBeat("a")]);
    late.set("2026-10-10T04:59:00.000Z"); // 9:59 p.m. Arizona on the 9th
    await late.run();
    assert.equal(late.sinks.calls.text.length, 1);
    const ten = nightHarness([redBeat("a")]);
    ten.set("2026-10-10T05:00:00.000Z"); // 10:00 p.m.
    const out = await ten.run();
    assert.equal(ten.sinks.calls.text.length, 0);
    assert.equal(out.alerts.held, true);
  });

  test("the blind-pulse text is held at night too (the run is still not ok, so its heartbeat goes red)", async () => {
    const h = nightHarness(undefined);
    const out = await h.go({ now: new Date("2026-10-10T09:07:00.000Z"), beats: undefined, loadBeatsImpl: async () => { throw new Error("bad list"); } });
    assert.equal(out.ok, false);
    assert.equal(h.sinks.calls.text.length, 0);
    assert.deepEqual(out.alerts.texts.map((t) => t.delivery_status), ["held_quiet_hours"]);
  });
});
