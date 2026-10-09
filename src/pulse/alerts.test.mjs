// Alerts: who gets told what, in how many characters, and what the incident record does AFTER the text.
// No network, no database. The sinks are recording fakes; the records database is a small fake that
// answers only the exact statements records.mjs sends (an unknown statement throws).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decide, formatText, formatBuzz, act, saveIncidents, ascii, scrubDetail, fixLineOf, hasNews,
  recordingSinks, realSinks, MAX_TEXT_CHARS, CLAIM_WINDOW_MS, STORM_AT, isDbDetail
} from "./alerts.mjs";
import { SQL_OPEN_INCIDENT, SQL_CLAIM_ALERT, SQL_CLOSE_INCIDENT } from "./records.mjs";
import { makeFixtureBeat } from "./fake-sinks.mjs";

const NOW = new Date("2026-10-09T19:07:00.000Z");
const HOUR = 3600 * 1000;
const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const INC = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;

const beat = (id, over = {}) => makeFixtureBeat({
  id,
  title: over.title ?? `Check ${id}`,
  fixGuide: over.fixGuide ?? [
    `Fix ${id} by opening the page and reading the step it stops at.`,
    "",
    "Likely causes:",
    "- The page moved (shows up at step two).",
    "- The database did not answer (shows up at step one).",
    "Steps:",
    "- Open the page in a browser and read the status.",
    "- Run node scripts/pulse/run-beat.mjs and read the step it stops at.",
    "Files: src/pulse/beats/contract.mjs"
  ].join("\n"),
  ...(over.damp ? { damp: over.damp } : {})
});
const byId = (...beats) => new Map(beats.map((b) => [b.id, b]));
const red = (beatId, step = "two", detail = "the site said 500") => ({ beatId, ok: false, step, detail, ms: 40, steps: [] });
const green = (beatId) => ({ beatId, ok: true, step: "done", detail: "ok", ms: 12, steps: [] });
const openRow = (beatId, n, over = {}) => ({
  id: INC(n), beat_id: beatId, opened_at: new Date(NOW.getTime() - 3 * HOUR).toISOString(), opened_run_id: RUN,
  first_step: "two", first_detail: "x", last_alert_at: new Date(NOW.getTime() - 2 * HOUR).toISOString(), alerts_sent: 3,
  github_issue_number: null, github_issue_url: null, fixer_status: "not_set_up", claude_session_url: null, ...over
});

/* ============================== decide ============================== */

describe("decide", () => {
  test("a red beat with no open incident is a new break", () => {
    const plan = decide({ results: [red("a"), green("b")], open: [], prev: new Map(), beatsById: byId(beat("a"), beat("b")), now: NOW });
    assert.deepEqual(plan.newBreaks.map((e) => e.beatId), ["a"]);
    assert.equal(plan.stillBroken.length, 0);
    assert.equal(plan.healed.length, 0);
    assert.equal(plan.storm, false);
  });

  test("a green beat with no open incident says nothing at all", () => {
    const plan = decide({ results: [green("a")], open: [], prev: new Map(), beatsById: byId(beat("a")), now: NOW });
    assert.equal(hasNews(plan), false);
    assert.equal(formatText(plan, { beatsById: byId(beat("a")) }), null);
  });

  test("red with an open incident whose last text is over 50 minutes old is STILL BROKEN, with the hour", () => {
    const plan = decide({ results: [red("a")], open: [openRow("a", 1)], prev: new Map(), beatsById: byId(beat("a")), now: NOW });
    assert.equal(plan.stillBroken.length, 1);
    assert.equal(plan.stillBroken[0].hour, 4, "opened 3 hours ago -> hour 4");
    assert.equal(plan.newBreaks.length, 0);
  });

  test("red with an open incident texted under 50 minutes ago is QUIET (a re-run in the same hour)", () => {
    const row = openRow("a", 1, { last_alert_at: new Date(NOW.getTime() - (CLAIM_WINDOW_MS - 60_000)).toISOString() });
    const plan = decide({ results: [red("a")], open: [row], prev: new Map(), beatsById: byId(beat("a")), now: NOW });
    assert.equal(plan.stillBroken.length, 0);
    assert.deepEqual(plan.quiet.map((e) => e.beatId), ["a"]);
    assert.equal(hasNews(plan), false);
  });

  test("an open incident that never got a text (last_alert_at null) is due", () => {
    const plan = decide({ results: [red("a")], open: [openRow("a", 1, { last_alert_at: null, alerts_sent: 0 })], prev: new Map(), beatsById: byId(beat("a")), now: NOW });
    assert.equal(plan.stillBroken.length, 1);
  });

  test("green with an open incident is healed, with the hours it was broken", () => {
    const plan = decide({ results: [green("a")], open: [openRow("a", 1)], prev: new Map(), beatsById: byId(beat("a")), now: NOW });
    assert.deepEqual(plan.healed.map((e) => [e.beatId, e.hours]), [["a", 3]]);
  });

  test("an open incident for a beat that did not run this time is left alone", () => {
    const plan = decide({ results: [green("a")], open: [openRow("zzz", 9)], prev: new Map(), beatsById: byId(beat("a")), now: NOW });
    assert.equal(plan.healed.length, 0);
  });

  test("DAMPING: damp 2 needs this run AND the run before to be red", () => {
    const b = beat("v", { damp: 2 });
    const prevRed = new Map([["v", [{ ok: false }, { ok: true }]]]);
    const prevGreen = new Map([["v", [{ ok: true }, { ok: false }]]]);
    const prevNone = new Map();
    const one = decide({ results: [red("v")], open: [], prev: prevGreen, beatsById: byId(b), now: NOW });
    assert.equal(one.newBreaks.length, 0, "the run before was green: no alert yet");
    assert.deepEqual(one.damped.map((e) => e.beatId), ["v"]);
    const two = decide({ results: [red("v")], open: [], prev: prevRed, beatsById: byId(b), now: NOW });
    assert.equal(two.newBreaks.length, 1, "two reds in a row: alert");
    const first = decide({ results: [red("v")], open: [], prev: prevNone, beatsById: byId(b), now: NOW });
    assert.equal(first.newBreaks.length, 0, "history is readable and empty: the very first red still waits for a second");
  });

  test("DAMPING: damp 3 needs two reds before this one", () => {
    const b = beat("v", { damp: 3 });
    const p1 = new Map([["v", [{ ok: false }, { ok: true }]]]);
    const p2 = new Map([["v", [{ ok: false }, { ok: false }]]]);
    assert.equal(decide({ results: [red("v")], open: [], prev: p1, beatsById: byId(b), now: NOW }).newBreaks.length, 0);
    assert.equal(decide({ results: [red("v")], open: [], prev: p2, beatsById: byId(b), now: NOW }).newBreaks.length, 1);
  });

  test("DAMPING: if the previous results cannot be read (prev null) the first red alerts", () => {
    const b = beat("v", { damp: 2 });
    const plan = decide({ results: [red("v")], open: [], prev: null, beatsById: byId(b), now: NOW });
    assert.equal(plan.newBreaks.length, 1);
  });

  test("DAMPING never hides a break that already has an open incident", () => {
    const b = beat("v", { damp: 2 });
    const plan = decide({ results: [red("v")], open: [openRow("v", 4)], prev: new Map([["v", [{ ok: true }]]]), beatsById: byId(b), now: NOW });
    assert.equal(plan.stillBroken.length, 1);
  });

  test("open unknown (null): every red beat is a new break, so the text repeats every hour with no state", () => {
    const plan = decide({ results: [red("a"), red("b")], open: null, prev: null, beatsById: byId(beat("a"), beat("b")), now: NOW });
    assert.equal(plan.newBreaks.length, 2);
    assert.equal(plan.healed.length, 0);
  });

  test(`${STORM_AT}+ red at once is a storm`, () => {
    const ids = ["a", "b", "c", "d"];
    const plan = decide({ results: ids.map((i) => red(i)), open: [], prev: new Map(), beatsById: byId(...ids.map((i) => beat(i))), now: NOW });
    assert.equal(plan.storm, true);
    const three = decide({ results: ids.slice(0, 3).map((i) => red(i)), open: [], prev: new Map(), beatsById: byId(...ids.map((i) => beat(i))), now: NOW });
    assert.equal(three.storm, false);
  });

  test("the database-down plan needs the database unreadable AND 3+ beats red at a db: detail", () => {
    const ids = ["a", "b", "c"];
    const beatsById = byId(...ids.map((i) => beat(i)));
    const dbReds = ids.map((i) => red(i, "one", "threw: db: the database is not answering"));
    assert.equal(decide({ results: dbReds, open: null, prev: null, beatsById, now: NOW, dbDown: true }).dbDown, true);
    assert.equal(decide({ results: dbReds, open: null, prev: null, beatsById, now: NOW, dbDown: false }).dbDown, false, "database is fine: say it per beat");
    assert.equal(decide({ results: dbReds.slice(0, 2), open: null, prev: null, beatsById, now: NOW, dbDown: true }).dbDown, false, "only two");
    assert.equal(isDbDetail("db: no"), true);
    assert.equal(isDbDetail("threw: db: no"), true);
    assert.equal(isDbDetail("the site said 500"), false);
  });
});

/* ============================== formatText ============================== */

describe("formatText: 480 characters, ASCII only, 4th grade, carries the fix line", () => {
  const ascii480 = (t, label) => {
    assert.ok(t && typeof t.body === "string", `${label}: has a body`);
    assert.ok(t.body.length <= MAX_TEXT_CHARS, `${label}: ${t.body.length} characters is over ${MAX_TEXT_CHARS}`);
    assert.match(t.body, /^[\x20-\x7e]+$/, `${label}: plain printable ASCII only`);
  };

  test("one new break: title, the step, and line 1 of the fix guide", () => {
    const b = beat("apply-links", { title: "Bank Apply links" });
    const plan = decide({ results: [red("apply-links", "fetch")], open: [], prev: new Map(), beatsById: byId(b), now: NOW });
    const t = formatText(plan, { beatsById: byId(b) });
    ascii480(t, "new break");
    assert.equal(t.kind, "break");
    assert.equal(t.body, `Fundhub BROKEN: Bank Apply links. It stopped at "fetch". Fix: ${fixLineOf(b).replace(/\.$/, "")}.`);
    assert.match(t.body, /Fix apply-links by opening the page/);
  });

  test("still broken: the hour and the fix line", () => {
    const b = beat("a", { title: "Thing A" });
    const plan = decide({ results: [red("a", "one")], open: [openRow("a", 1)], prev: new Map(), beatsById: byId(b), now: NOW });
    const t = formatText(plan, { beatsById: byId(b) });
    ascii480(t, "still");
    assert.equal(t.kind, "still");
    assert.match(t.body, /^Fundhub STILL BROKEN, hour 4: Thing A at "one"\. Fix: /);
  });

  test("fixed: one short text with the hours", () => {
    const b = beat("a", { title: "Thing A" });
    const plan = decide({ results: [green("a")], open: [openRow("a", 1)], prev: new Map(), beatsById: byId(b), now: NOW });
    const t = formatText(plan, { beatsById: byId(b) });
    ascii480(t, "fixed");
    assert.equal(t.kind, "fixed");
    assert.equal(t.body, "Fundhub FIXED: Thing A. It was broken 3 h.");
  });

  test("two or three things in one run: one text, every fix line cut short", () => {
    const bs = ["a", "b", "c"].map((i) => beat(i, { title: `Thing ${i.toUpperCase()}` }));
    const plan = decide({
      results: [red("a"), red("b"), green("c")],
      open: [openRow("c", 3)], prev: new Map(), beatsById: byId(...bs), now: NOW
    });
    const t = formatText(plan, { beatsById: byId(...bs) });
    ascii480(t, "mixed");
    assert.equal(t.kind, "mixed");
    assert.match(t.body, /^Fundhub: 3 things changed\./);
    assert.match(t.body, /BROKEN: Thing A at "two"/);
    assert.match(t.body, /BROKEN: Thing B at "two"/);
    assert.match(t.body, /FIXED: Thing C \(3 h\)/);
  });

  test("a storm is ONE text, with the first beat's fix line", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const bs = ids.map((i) => beat(i, { title: `Thing ${i.toUpperCase()}` }));
    const plan = decide({ results: ids.map((i) => red(i)), open: [], prev: new Map(), beatsById: byId(...bs), now: NOW });
    const t = formatText(plan, { beatsById: byId(...bs) });
    ascii480(t, "storm");
    assert.equal(t.kind, "storm");
    assert.match(t.body, /^Fundhub BROKEN: 5 checks are red at once\. Likely one cause\. First: Thing A at "two"\. Fix: Fix a by opening/);
  });

  test("the database-down text says it once, however many beats are red", () => {
    const ids = ["a", "b", "c", "d"];
    const bs = ids.map((i) => beat(i));
    const plan = decide({ results: ids.map((i) => red(i, "one", "threw: db: the database is not answering")), open: null, prev: null, beatsById: byId(...bs), now: NOW, dbDown: true });
    const t = formatText(plan, { beatsById: byId(...bs) });
    ascii480(t, "db down");
    assert.equal(t.kind, "db_down");
    assert.equal(t.body, "Fundhub BROKEN: the database is not answering. 4 checks are red. Fix: open https://fundhub.ai/api/health and the Supabase project.");
  });

  test("hostile titles, steps and fix lines still give a text under 480, ASCII, with a fix line", () => {
    const long = "x".repeat(400);
    const odd = "Café “quoted” — naïve \u{1F680}\u{1F4A5} 中文";
    const bs = ["a", "b", "c"].map((i) => beat(i, { title: odd + long, fixGuide: `${odd} ${long}\n\nLikely causes:\n- a b\n- c d\nSteps:\n- a b\n- c d\nFiles: src/a.mjs` }));
    for (const results of [
      [red("a", odd + long)],
      [red("a", odd), red("b", long)],
      [red("a"), red("b"), red("c")],
      [red("a", long), red("b", long), green("c")],
      [red("a"), red("b"), red("c"), red("d")]
    ]) {
      const plan = decide({ results, open: results.some((r) => r.ok) ? [openRow("c", 3)] : [], prev: new Map(), beatsById: byId(...bs), now: NOW });
      const t = formatText(plan, { beatsById: byId(...bs) });
      ascii480(t, JSON.stringify(results.map((r) => r.beatId + r.ok)));
    }
  });

  test("no phone, email, name, amount, token or response body reaches the text, whatever the detail says", () => {
    const b = beat("a", { title: "Thing A" });
    const dirty = "call +1 (480) 555-0100 or chris@example.com token=sk_live_abcdefghijklmnop1234 amount $4,500.00 body={\"ssn\":\"123-45-6789\"}";
    const plan = decide({ results: [red("a", "two", dirty)], open: [], prev: new Map(), beatsById: byId(b), now: NOW });
    const t = formatText(plan, { beatsById: byId(b) });
    assert.doesNotMatch(t.body, /555|example\.com|sk_live|4,500|ssn|123-45/);
    const buzz = formatBuzz(plan, { beatsById: byId(b) });
    assert.doesNotMatch(buzz.body, /555-0100|chris@|sk_live_abc|4,500|123-45-6789/, "the buzz carries a scrubbed detail");
    assert.match(buzz.body, /a: /, "the buzz does carry a detail line");
    assert.ok(buzz.body.length <= 480);
  });

  test("ascii() and scrubDetail() do what they say", () => {
    assert.equal(ascii("“Hi” — café"), '"Hi" - cafe');
    assert.equal(scrubDetail("see https://bank.example.com/apply?ecid=SECRET123 now").includes("SECRET123"), false);
    // A cut lands on a space, never in the middle of a word (the text once ended with a stray "b.").
    const cutText = scrubDetail("word ".repeat(100), 50);
    assert.ok(cutText.length <= 50, "within the limit");
    assert.ok(cutText.endsWith("..."), "says it was cut");
    assert.match(cutText, /(^|\s)word\.\.\.$/, "ends on a whole word, then the dots");
    assert.equal(scrubDetail("alpha beta gamma delta epsilon", 22), "alpha beta gamma...", "cuts back to the last space");
    assert.equal(scrubDetail("x".repeat(300), 50), "[long value]", "a long unbroken run looks like a key and is removed");
  });
});

/* ============================== act ============================== */

describe("act: one text, plus the buzz when the text fails or the text path is the thing that broke", () => {
  const b = beat("a", { title: "Thing A" });
  const tp = beat("text-path", { title: "Text path" });
  const planFor = (...beats) => decide({ results: beats.map((x) => red(x.id)), open: [], prev: new Map(), beatsById: byId(...beats), now: NOW });

  test("nothing to say: nothing is sent, not even a check", async () => {
    const sinks = recordingSinks();
    const plan = decide({ results: [green("a")], open: [], prev: new Map(), beatsById: byId(b), now: NOW });
    const r = await act(plan, { sinks, beatsById: byId(b) });
    assert.equal(r.due, false);
    assert.equal(r.delivered, false);
    assert.deepEqual(sinks.calls, { text: [], ntfy: [] });
  });

  test("a break: one text, the buzz is NOT sent when the text went", async () => {
    const sinks = recordingSinks({ textStatus: "sent", ntfyStatus: "sent" });
    const r = await act(planFor(b), { sinks, beatsById: byId(b) });
    assert.equal(sinks.calls.text.length, 1);
    assert.equal(sinks.calls.ntfy.length, 0);
    assert.equal(r.delivered, true);
    assert.deepEqual(r.texts.map((t) => [t.kind, t.delivery_status]), [["break", "sent"]]);
    assert.equal(r.error, null);
  });

  test("the text failed: the buzz carries it, and the run counts it delivered", async () => {
    const sinks = recordingSinks({ textStatus: "failed", ntfyStatus: "sent" });
    const r = await act(planFor(b), { sinks, beatsById: byId(b) });
    assert.equal(sinks.calls.text.length, 1);
    assert.equal(sinks.calls.ntfy.length, 1);
    assert.equal(sinks.calls.ntfy[0].priority, 5);
    assert.match(sinks.calls.ntfy[0].body, /^Fundhub BROKEN: Thing A/);
    assert.equal(r.delivered, true);
    assert.equal(r.ntfy.status, "sent");
    assert.equal(r.texts[0].delivery_status, "failed");
  });

  test("the text threw: same, the buzz carries it", async () => {
    const sinks = recordingSinks({ textStatus: "throw", ntfyStatus: "sent" });
    const r = await act(planFor(b), { sinks, beatsById: byId(b) });
    assert.equal(r.delivered, true);
    assert.equal(r.texts[0].delivery_status, "failed");
  });

  test("the text AND the buzz hang: act still returns inside its cap, and nothing was delivered", async () => {
    const sinks = recordingSinks({ textStatus: "hang", ntfyStatus: "hang" });
    const t0 = Date.now();
    const r = await Promise.race([
      act(planFor(b), { sinks, beatsById: byId(b), capMs: 800 }),
      new Promise((resolve) => setTimeout(() => resolve("STUCK"), 4000))
    ]);
    assert.notEqual(r, "STUCK", "act never came back: the buzz has no time cap");
    assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0} ms for a cap of 800`);
    assert.equal(r.delivered, false);
    assert.equal(r.ntfy.status, "failed");
    assert.match(r.error, /not delivered/);
  });

  test("the text path is the thing that broke and both roads hang: still back inside the cap", async () => {
    const sinks = recordingSinks({ textStatus: "hang", ntfyStatus: "hang" });
    const t0 = Date.now();
    const r = await Promise.race([
      act(planFor(tp), { sinks, beatsById: byId(tp), capMs: 800 }),
      new Promise((resolve) => setTimeout(() => resolve("STUCK"), 4000))
    ]);
    assert.notEqual(r, "STUCK");
    assert.ok(Date.now() - t0 < 2500);
    assert.equal(r.delivered, false);
  });

  test("the text hangs: it is cut at the cap and the buzz carries it", async () => {
    const sinks = recordingSinks({ textStatus: "hang", ntfyStatus: "sent" });
    const t0 = Date.now();
    const r = await act(planFor(b), { sinks, beatsById: byId(b), capMs: 2000 });
    assert.ok(Date.now() - t0 < 4000, "did not wait forever");
    assert.equal(r.delivered, true);
    assert.equal(r.texts[0].delivery_status, "failed");
  });

  test("the text failed and ntfy is not set up: not delivered, and it says so plainly", async () => {
    const sinks = recordingSinks({ textStatus: "no_number", ntfyStatus: null });
    const r = await act(planFor(b), { sinks, beatsById: byId(b) });
    assert.equal(r.delivered, false);
    assert.equal(r.ntfy, null);
    assert.match(r.error, /alert due but not delivered: text no_number/);
    assert.match(r.error, /buzz not set up/);
  });

  test("both roads failed", async () => {
    const sinks = recordingSinks({ textStatus: "failed", ntfyStatus: "failed" });
    const r = await act(planFor(b), { sinks, beatsById: byId(b) });
    assert.equal(r.delivered, false);
    assert.match(r.error, /buzz failed/);
  });

  test("the text-path beat is red: the buzz goes too, even though the text went", async () => {
    const sinks = recordingSinks({ textStatus: "sent", ntfyStatus: "sent" });
    const r = await act(planFor(tp), { sinks, beatsById: byId(tp) });
    assert.equal(sinks.calls.text.length, 1);
    assert.equal(sinks.calls.ntfy.length, 1, "an alert must not ride only the thing that broke");
    assert.equal(r.delivered, true);
  });

  test("a storm is one text and one call, never one per beat", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const bs = ids.map((i) => beat(i));
    const sinks = recordingSinks();
    const plan = decide({ results: ids.map((i) => red(i)), open: [], prev: new Map(), beatsById: byId(...bs), now: NOW });
    await act(plan, { sinks, beatsById: byId(...bs) });
    assert.equal(sinks.calls.text.length, 1);
  });
});

describe("realSinks: dryRun:false is passed on purpose", () => {
  test("with the messaging fence CLOSED the real text sink answers failed (blocked), not dry_run, and sends nothing", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("no network in this test"); };
    try {
      const env = {
        PULSE_SMS_TO: "+15555550100",
        TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        TWILIO_SEND_AUTH_TOKEN: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        TWILIO_SEND_FROM: "+15555550199"
        // MESSAGING_DRY_RUN is not set: the fence holds every send.
      };
      const r = await realSinks().text("Fundhub test", { env });
      assert.notEqual(r.delivery_status, "dry_run", "dry_run would mean dryRun was left at its default of true");
      assert.equal(r.delivery_status, "failed");
      assert.equal(calls, 0, "the fence held it: nothing left the process");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("with no PULSE_SMS_TO the real text sink says no_number", async () => {
    const r = await realSinks().text("Fundhub test", { env: {} });
    assert.equal(r.delivery_status, "no_number");
  });

  test("the real buzz sink returns null when ntfy is not set up (so nothing is sent)", async () => {
    const r = await realSinks().ntfy({ title: "t", body: "b" }, { env: {} });
    assert.equal(r, null);
  });
});

/* ============================== saveIncidents ============================== */

function recordsDb({ openWon = true, claimWins = true, closeWins = true, failWith = null } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params) {
      if (failWith) throw failWith;
      if (sql === SQL_OPEN_INCIDENT) { log.push(["open", params[1]]); return { rows: openWon ? [{ id: INC(7) }] : [], rowCount: openWon ? 1 : 0 }; }
      if (sql === SQL_CLAIM_ALERT) { log.push(["claim", params[0]]); return claimWins ? { rows: [{ id: params[0], alerts_sent: 2 }], rowCount: 1 } : { rows: [], rowCount: 0 }; }
      if (sql === SQL_CLOSE_INCIDENT) { log.push(["close", params[0], params[1]]); return closeWins ? { rows: [{ id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 }; }
      throw new Error(`recordsDb: unexpected statement: ${String(sql).slice(0, 60)}`);
    }
  };
}

describe("saveIncidents: the records, written after the text", () => {
  const bs = byId(beat("a"), beat("b"), beat("c"));
  const plan = () => decide({
    results: [red("a"), red("b"), green("c")],
    open: [openRow("b", 2), openRow("c", 3)], prev: new Map(), beatsById: bs, now: NOW
  });

  test("delivered: opens the new break, claims it, claims the still-broken one, closes the healed one", async () => {
    const rdb = recordsDb();
    const r = await saveIncidents(plan(), { rdb, orgId: ORG, runId: RUN, delivered: true });
    assert.deepEqual(r, { opened: 1, claimed: 2, dupes: 0, closed: 1, errors: [] });
    const verbs = rdb.log.map((x) => x[0]).sort();
    assert.deepEqual(verbs, ["claim", "claim", "close", "open"]);
    const close = rdb.log.find((x) => x[0] === "close");
    assert.equal(close[2], "auto", "closed by the runner, not by a lesson");
  });

  test("NOT delivered: incidents open but nothing is claimed, so the next run is not quiet", async () => {
    const rdb = recordsDb();
    const r = await saveIncidents(plan(), { rdb, orgId: ORG, runId: RUN, delivered: false });
    assert.equal(r.claimed, 0);
    assert.equal(r.opened, 1);
    assert.equal(rdb.log.filter((x) => x[0] === "claim").length, 0);
  });

  test("a claim another run already took is counted as a duplicate", async () => {
    const rdb = recordsDb({ claimWins: false });
    const r = await saveIncidents(plan(), { rdb, orgId: ORG, runId: RUN, delivered: true });
    assert.equal(r.claimed, 0);
    assert.equal(r.dupes, 2);
  });

  test("an incident another run already opened is not counted as ours", async () => {
    const rdb = recordsDb({ openWon: false });
    const r = await saveIncidents(plan(), { rdb, orgId: ORG, runId: RUN, delivered: true });
    assert.equal(r.opened, 0);
  });

  test("a database that throws costs errors, never a throw", async () => {
    const rdb = recordsDb({ failWith: new Error("connection reset postgres://u:p@h/db") });
    const r = await saveIncidents(plan(), { rdb, orgId: ORG, runId: RUN, delivered: true });
    assert.ok(r.errors.length > 0);
    assert.doesNotMatch(r.errors.join(" "), /postgres:\/\/u:p/);
  });

  test("no database handle or org: nothing happens", async () => {
    assert.deepEqual(await saveIncidents(plan(), { rdb: null, orgId: ORG, runId: RUN, delivered: true }), { opened: 0, claimed: 0, dupes: 0, closed: 0, errors: [] });
    const rdb = recordsDb();
    await saveIncidents(plan(), { rdb, orgId: null, runId: RUN, delivered: true });
    assert.equal(rdb.log.length, 0);
  });
});
