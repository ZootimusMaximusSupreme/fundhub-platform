// Today's U37 rules, run in node:vm with no browser and no server.
//
// Plan unit U37 (spec docs/specs/marketing-machine-2026-10-04.md §8.3 Today,
// §11.3, §7.5 step 7; design docs/specs/command-center-design-2026-10-05.md
// §3.1). public/app/marketing-cc-today.js puts every rule that turns an answer
// into words on window.FHMarketingCC; this file runs the real script in a vm
// (the pattern src/ui/marketing-command-center.test.mjs uses for the older
// Today rules) and feeds it the API contract's own examples
// (src/marketing/api-contract.mjs), so a contract change breaks a test here.
//
// The promises it holds the page to:
//   1. NEVER FAKE A NUMBER. Null is "unknown", never $0 (CLAUDE.md §12).
//   2. EVERY TAP ANSWERS IN PLAIN WORDS, and every write is the contract's
//      exact request with a request_id.
//   3. WRITE NOW ONLY WHEN IT CAN RUN, and then it is the one filled button.
//   4. CHARTS ARE DRAWN BY HAND (spec §4 trap 15): an inline SVG, no library.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { exampleResponse, assertRequestMatchesContract } from "../marketing/api-contract.mjs";
import { JOB_KINDS } from "../marketing/job-kinds.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../../public/app/marketing-cc-today.js"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  assert.equal(ctx.FHMarketingCC.display.tz, "America/Phoenix");
  return ctx.FHMarketingCC;
}
const cc = load();
/* A vm value as a plain value of this realm (deepEqual compares prototypes). */
const plain = (v) => JSON.parse(JSON.stringify(v));
const res = (body, status = 200) => ({ status, body });

// 19:00 UTC is 12:00 PM in Arizona, Monday Oct 12, 2026: the day the
// contract examples are written for.
const NOW = Date.parse("2026-10-12T19:00:00Z");
const TODAY = () => exampleResponse("GET marketing/today");
const view = (over = {}) => cc.normalizeToday({ ...TODAY(), ...over });

describe("GET marketing/today: U32's M5 keys", () => {
  test("every key is read; null stays null, a measured 0 stays 0", () => {
    const v = view();
    assert.equal(v.m5Read, true);
    assert.deepEqual(plain(v.numbers.d7), { spend: 61500, leads: 23, booked: 7, showed: 5, sales: 1, roadmaps: 4, cash: 158800, reportedCash: 100000, roas: 2.58 });
    assert.equal(v.numbers.today.spend, null, "today's spend is unknown, not 0");
    assert.equal(v.numbers.today.reportedCash, null);
    assert.equal(v.numbers.today.cash, 0, "a measured zero stays 0");
    assert.equal(v.daily.length, 3);
    assert.deepEqual(plain(v.daily[0]), { date: "2026-10-09", spend: 8800, leads: 3 });
    assert.equal(v.byFunnelRead, true);
    assert.deepEqual(plain(v.byFunnel[2]), { key: null, name: "Unmapped", spend: 9150 });
    assert.deepEqual(plain(v.flow), { clicks: 2210, pageViews: 1840, leads: 23, booked: 7, showed: 5, sales: 1 });
    assert.deepEqual(plain(v.scriptsWaiting), { ready: 18, flagged: 2 });
    assert.deepEqual(plain(v.stuckJobs), [{ id: "00000000-0000-4000-8000-000000000501", kind: "write_slot",
      error: "The writer stopped: the model took longer than 5 minutes.", since: "2026-10-12T12:40:00.000Z" }]);
  });

  test("a server without the M5 keys, or with a part not built (null), is 'not read', never zeros", () => {
    const old = TODAY();
    for (const k of ["numbers", "daily", "spend_by_funnel", "flow", "scripts_waiting", "stuck_jobs"]) delete old[k];
    const v = cc.normalizeToday(old);
    assert.equal(v.m5Read, false);
    assert.equal(v.byFunnelRead, false);
    assert.equal(v.flowRead, false);
    assert.equal(v.scriptsWaiting, null);
    assert.equal(v.stuckRead, false);
    assert.deepEqual(plain(v.numbers.d7), { spend: null, leads: null, booked: null, showed: null, sales: null, roadmaps: null, cash: null, reportedCash: null, roas: null });
    const missing = view({ numbers: null, flow: null, scripts_waiting: null });
    assert.equal(missing.m5Read, false);
    assert.equal(missing.flowRead, false);
    assert.equal(missing.scriptsWaiting, null);
    // The older keys are untouched.
    assert.equal(v.spend7, 61500);
    assert.equal(v.loaded, true);
  });
});

describe("each part's answer: ok, not on this server yet, or did not load", () => {
  test("partState sorts every kind of answer", () => {
    assert.equal(cc.partState(res({ next: {} }), "next"), "ok");
    assert.equal(cc.partState(res({ ok: true, count: 0, items: [] }), "next"), "missing", "a 200 without the key is a server without the route");
    assert.equal(cc.partState(res({ ok: false, error: "not_found", path: "marketing/health" }, 404), "clock"), "missing");
    assert.equal(cc.partState(res({ error: "not_ready", message: "x" }, 503), "clock"), "missing");
    assert.equal(cc.partState(res({ ok: false, error: "db_unavailable", db: "down" }, 503), "clock"), "error");
    assert.equal(cc.partState(res({ error: "internal_error" }, 500), "clock"), "error");
    assert.equal(cc.partState({ status: 0, body: null, transport: "network error" }, "clock"), "error");
    assert.equal(cc.partState({ status: 0, body: null, transport: "timeout", timedOut: true }, "clock"), "error");
    assert.equal(cc.partState(null, "clock"), "error");
  });

  test("a part that failed says so in words and that the rest of the page is current", () => {
    assert.equal(cc.normalizeHealth(res({ error: "internal_error" }, 500)).message,
      "The machine's health did not load. The rest of this page is current. It tries again in 5 minutes.");
    assert.equal(cc.normalizeNext({ status: 0, body: null, transport: "x" }).message,
      "No connection, so the next drop did not load. The rest of this page is current.");
    assert.equal(cc.normalizeNext(res({ error: "not_ready" }, 503)).message,
      "The next drop is not on this server yet. It turns on with the next update.");
    assert.equal(cc.normalizeHealth(res({ error: "unauthorized" }, 401)).message, "You are signed out. Sign in and open this page again.");
    assert.equal(cc.normalizeHealth({ status: 0, body: null, transport: "timeout", timedOut: true }).message,
      "The machine's health took too long to load. The rest of this page is current. It tries again in 5 minutes.");
    for (const m of [cc.normalizeHealth(res({}, 500)).message, cc.normalizeNext(res({}, 502)).message]) {
      assert.doesNotMatch(m, /\d{3}|error|internal/i, "no status code and no server word");
    }
  });
});

describe("the machine (GET marketing/health)", () => {
  const health = () => exampleResponse("GET marketing/health");

  test("the contract example in words: clock late, a failed job, repo saves held for the GitHub token, model spend against the caps", () => {
    const h = cc.normalizeHealth(res(health()));
    assert.equal(h.state, "ok");
    const m = cc.healthModel(h, null, NOW);
    assert.equal(m.healthy, false);
    assert.equal(m.line, "The machine needs a look: the clock is late.");
    const row = (k) => plain(m.rows.find((r) => r.key === k));
    assert.deepEqual([row("clock").word, row("clock").text], ["Late", "Last tick 3 hours ago. It should tick every 15 minutes. The weekly drop is off."]);
    assert.equal(row("worker").word, "Had trouble");
    assert.equal(row("worker").text, "Last ran 3 hours ago. 0 waiting, 0 running. 1 job failed in the last 24 hours. Stuck ones are under Waiting on you, each with Retry.");
    assert.equal(row("outbox").word, "Held");
    assert.equal(row("outbox").text, "Repo saves are held: the GitHub token is not set. 2 saves waiting since 8:06 AM (3 hours ago). No save has reached GitHub yet.");
    assert.equal(row("sync").word, "Fresh");
    assert.equal(row("sync").text, "Last pulled 12:01 AM (11 hours ago).");
    assert.equal(row("model").text, "This month: $12.48 of $300. Last batch: $9.70 of $40.");
    assert.equal(row("model").meter, 4);
    assert.equal(row("model").word, "Under the cap");
    // Every row carries a word, never colour alone (UI-STANDARDS §12.6).
    for (const r of m.rows) assert.ok(r.word && r.label && r.what, r.key);
  });

  test("the dry-run hold, a last save and its error, and a healthy machine", () => {
    const b = health();
    b.clock.last_tick_at = "2026-10-12T18:50:00Z";
    b.worker.failed_24h = [];
    b.outbox = { waiting: 0, oldest_waiting_at: null, last_commit_sha: "abcdef1234567", last_commit_at: "2026-10-12T17:00:00Z",
      last_error: "GitHub said 409.", token_present: true, held_reason: "dry_run" };
    let m = cc.healthModel(cc.normalizeHealth(res(b)), null, NOW);
    assert.equal(m.line, "The machine needs a look: repo saves are held by the dry-run flag.");
    const saves = m.rows.find((r) => r.key === "outbox");
    assert.equal(saves.text, "Repo saves are held by the dry-run flag, so nothing goes to GitHub yet. Nothing is waiting. Last save abcdef1, 2 hours ago. Last error: GitHub said 409.");
    assert.equal(m.rows.find((r) => r.key === "worker").text, "Last ran 3 hours ago. 0 waiting, 0 running. Nothing failed in the last 24 hours.");

    b.outbox = { ...b.outbox, held_reason: null, last_error: null };
    m = cc.healthModel(cc.normalizeHealth(res(b)), null, NOW);
    assert.equal(m.healthy, true);
    assert.equal(m.line, "The machine is healthy.");
    assert.equal(m.rows.find((r) => r.key === "outbox").word, "Up to date");
  });

  test("never run, never pulled, at the cap, and unknown spend each say so", () => {
    const b = health();
    b.clock.last_tick_at = null;
    b.worker = { last_run_at: null, queued: null, running: null, failed_24h: [] };
    b.sync.last_sync_at = null;
    b.model = { month_cost_usd: 300, max_month_cost_usd: 300, last_batch_cost_usd: null, max_batch_cost_usd: null };
    const m = cc.healthModel(cc.normalizeHealth(res(b)), null, NOW);
    assert.equal(m.line, "The machine needs a look: the clock has not ticked yet.");
    const row = (k) => m.rows.find((r) => r.key === k);
    assert.equal(row("clock").word, "Not run yet");
    assert.equal(row("worker").text, "It has not run yet. unknown waiting, unknown running. Nothing failed in the last 24 hours.");
    assert.equal(row("sync").word, "Never");
    assert.equal(row("model").word, "At the cap");
    assert.equal(row("model").text, "This month: $300 of $300.");
    b.model.month_cost_usd = null;
    const u = cc.healthModel(cc.normalizeHealth(res(b)), null, NOW).rows.find((r) => r.key === "model");
    assert.equal(u.word, "Unknown");
    assert.equal(u.text, "This month: unknown of $300.");
    assert.equal(u.meter, null, "no meter for an unknown spend");
  });

  test("the card: the line first, a chip with a word per row, the never-turns-on sentence last", () => {
    const html = cc.renderMachine(cc.normalizeHealth(res(health())), null, NOW);
    assert.match(html, /^<p class="health-line">The machine needs a look: the clock is late\.<\/p>/);
    assert.equal((html.match(/<span class="chip/g) || []).length, 5);
    assert.match(html, /role="img" aria-label="\$12\.48 of \$300 used this month"><span style="width:4%"><\/span>/);
    assert.match(html, /It never turns an ad on, pauses one, or changes a budget\. You do that in Launch\.<\/p>$/);
    assert.match(cc.renderMachine(null), /class="skel"/, "loading: skeletons, not a spinner");
    assert.equal(cc.renderMachine(cc.normalizeHealth(res({}, 404))), '<p class="muted">The machine&#39;s health is not on this server yet. It turns on with the next update.</p>');
  });
});

describe("the next drop (GET marketing/batches/next)", () => {
  const next = () => exampleResponse("GET marketing/batches/next");

  test("when, how many and the split by name, in Arizona time", () => {
    const part = cc.normalizeNext(res(next()));
    const m = plain(cc.nextDropModel(part, cc.funnelNames(view())));
    assert.equal(m.when, "Monday, Oct 19 at 7:00 AM Arizona time");
    assert.equal(m.count, "21 scripts");
    assert.equal(m.split, "Roadmap $147: 17 · Book a call: 4");
    assert.equal(m.splitWhy, "Split by each funnel's ad spend over the last 7 days.");
    assert.equal(m.off, "The weekly drop is off, so nothing comes on its own. Turn it on in Settings.");
    assert.equal(m.unmapped, "$91.50 of last week's ad spend is not tied to a funnel yet.");
    assert.equal(m.saved, "The plan for this drop is saved.");
    assert.equal(m.changed, "");
    // No names from Today: the key in words, never a code.
    assert.equal(cc.nextDropModel(part, {}).split, "Roadmap 147: 17 · Book call: 4");
    // A name on the plan's own funnel row wins (U23's extra key).
    const named = next();
    named.next.funnels[0].name = "Roadmap";
    assert.equal(cc.nextDropModel(cc.normalizeNext(res(named)), {}).split, "Roadmap: 17 · Book call: 4");
  });

  test("on, overrides, an unknown total and no unmapped spend", () => {
    const b = next();
    b.next.enabled = true;
    b.next.total = null;
    b.next.unmapped_spend_cents = 0;
    b.next.overrides = { total: 10 };
    b.saved = null;
    const m = cc.nextDropModel(cc.normalizeNext(res(b)), {});
    assert.equal(m.off, "");
    assert.equal(m.count, "Number of scripts: unknown");
    assert.equal(m.unmapped, "");
    assert.equal(m.saved, "");
    assert.equal(m.changed, "Your changes for this drop are saved.");
    assert.equal(cc.dropWhen(null), "unknown");
  });

  test("each suggestion's numbers in words; no spend last week is said, never $0", () => {
    const s = cc.normalizeNext(res(next())).next.suggestions;
    assert.equal(s.length, 3);
    assert.equal(cc.suggestionNumbers(s[0]), "$412 spent last week · 9 leads · $45.78 a lead.");
    assert.equal(cc.suggestionNumbers(s[1]), "$111.50 spent last week · 0 leads.");
    assert.equal(cc.suggestionNumbers(s[2]), "No ads ran on it last week.");
    assert.equal(cc.suggestionNumbers({ ...s[0], lastRanOn: "2026-10-04" }), "$412 spent last week · 9 leads · $45.78 a lead. Last ran Oct 4.");
  });
});

describe("Write now: only when it can run, and then the one filled button", () => {
  test("write_now_ready must be exactly true", () => {
    const ready = cc.normalizeBatches(res(exampleResponse("GET marketing/batches")));
    assert.equal(ready.ready, true);
    assert.equal(cc.writeNowShown(ready), true);
    for (const v of [false, "true", 1, null, undefined]) {
      const b = exampleResponse("GET marketing/batches");
      b.write_now_ready = v;
      assert.equal(cc.writeNowShown(cc.normalizeBatches(res(b))), false, String(v));
    }
    assert.equal(cc.writeNowShown(cc.normalizeBatches(res({ error: "x" }, 500))), false, "no answer, no button");
    assert.equal(cc.writeNowShown(cc.normalizeBatches(res({ ok: true, count: 0, items: [] }))), false);
  });

  test("drawn: one filled button, the count picker (3 unless picked), no other filled look", () => {
    const part = cc.normalizeNext(res(exampleResponse("GET marketing/batches/next")));
    const batches = cc.normalizeBatches(res(exampleResponse("GET marketing/batches")));
    const html = cc.renderNext(part, batches, view(), { count: 3 }, NOW);
    assert.equal((html.match(/class="btn primary/g) || []).length, 1);
    assert.match(html, /<button class="btn primary" type="button" id="writeNowBtn" data-act="write-now"><span class="spin" aria-hidden="true"><\/span><span class="lbl">Write now<\/span><\/button>/);
    assert.match(html, /<option value="3" selected>3<\/option>/);
    assert.equal((html.match(/<option /g) || []).length, 10);
    assert.match(cc.renderNext(part, batches, view(), { count: 7 }, NOW), /<option value="7" selected>7<\/option>/);
    assert.match(cc.renderNext(part, batches, view(), { count: 99 }, NOW), /<option value="3" selected>3<\/option>/, "an odd count falls back to 3");
    const busy = cc.renderNext(part, batches, view(), { count: 3, writing: true }, NOW);
    assert.match(busy, /id="writeNowBtn" data-act="write-now" disabled aria-busy="true">.*Starting…/);
  });

  test("not drawn while write_now_ready is false: no Write now and no filled button in the card", () => {
    const part = cc.normalizeNext(res(exampleResponse("GET marketing/batches/next")));
    const b = exampleResponse("GET marketing/batches");
    b.write_now_ready = false;
    const html = cc.renderNext(part, cc.normalizeBatches(res(b)), view(), {}, NOW);
    assert.doesNotMatch(html, /writeNowBtn|Write now<|primary/);
    assert.match(html, /<p class="caption batch-line">Newest batch: Write now \(Oct 13\): writing\. 1 of 3 ready\.<\/p>/);
  });

  test("the page's own markup keeps Write ad copy as the only filled button until Write now is drawn", () => {
    const markup = cc.TODAY_HTML;
    assert.equal((markup.match(/class="btn primary"/g) || []).length, 1);
    assert.match(markup, /<button class="btn primary" type="submit" id="copyBtn"/);
    // The wiring swaps the filled look: Write ad copy loses it exactly when Write now is drawn.
    assert.match(SRC, /\$\("copyBtn"\)\.classList\.toggle\(PRIMARY, !ready\);/);
    assert.match(SRC, /var ready = writeNowShown\(state\.batches\) && Boolean\(\$\("writeNowBtn"\)\);/);
  });

  test("the cost sheet comes first, then one POST {request_id, count}", () => {
    const body = cc.writeNowRequest(5, "00000000-0000-4000-8000-00000000c009");
    assert.deepEqual(plain(body), { request_id: "00000000-0000-4000-8000-00000000c009", count: 5 });
    assertRequestMatchesContract("POST marketing/batches/write-now", body);
    const fn = SRC.slice(SRC.indexOf("function writeNow() {"), SRC.indexOf("function useAngle("));
    assert.ok(fn.indexOf("frameCtx.costSheet(sheet)") > 0 && fn.indexOf("frameCtx.costSheet(sheet)") < fn.indexOf("batches/write-now"),
      "the POST is only reachable after the cost sheet answers yes");
    assert.match(fn, /if \(yes !== true\) return null;/);
    assert.match(fn, /typeof frameCtx\.costSheet !== "function"[\s\S]*?nothing was started/, "no sheet, no spend");
    const sheet = plain(cc.writeNowSheet(5, cc.normalizeHealth(res(exampleResponse("GET marketing/health")))));
    assert.deepEqual(sheet, {
      kind: "script", title: "Write 5 scripts now?", button: "Write 5",
      lines: [
        "The cost line is for one script. You asked for 5.",
        "It writes with the model. The scripts show up in Scripts when they are done.",
        "It stops by itself at $40 a batch and $300 a month.",
        "It spends no ad money."
      ]
    });
    assert.equal(cc.writeNowSheet(1, null).title, "Write 1 script now?");
    assert.equal(cc.writeNowSheet(1, null).lines[2], "It stops by itself at the batch and month caps in Settings.");
  });

  test("what the tap answers: started, a cap, signed out, no connection", () => {
    const ok = plain(cc.summarizeWriteNow(res(exampleResponse("POST marketing/batches/write-now"), 202), 3));
    assert.deepEqual(ok, { ok: true, tone: "wait", text: "Writing 3 scripts now. They show up in Scripts when they are done. You can leave this page." });
    assert.equal(cc.summarizeWriteNow(res({ error: "cap_reached", message: "This batch's model spend cap ($40) is reached." }, 400), 3).text,
      "This batch's model spend cap ($40) is reached. Nothing was started.");
    assert.equal(cc.summarizeWriteNow(res({ error: "unauthorized" }, 401), 3).text, "You are signed out. Sign in and open this page again.");
    assert.equal(cc.summarizeWriteNow({ status: 0, body: null, transport: "x" }, 3).text, "Could not reach the server. Check your connection and try again.");
  });

  test("the newest batch in one line", () => {
    const b = (over) => ({ kind: "weekly", status: "released", releaseAt: "2026-10-12T14:00:00Z", releasedAt: null, total: 21, ready: 20, flagged: 2, failed: 1, error: "", ...over });
    assert.equal(cc.batchLine(b({})), "Oct 12 drop: 20 of 21 ready, 2 need a look, 1 did not get written.");
    assert.equal(cc.batchLine(b({ status: "planned", kind: "on_command" })), "Write now (Oct 12): waiting to start.");
    assert.equal(cc.batchLine(b({ status: "writing", ready: null, total: null })), "Oct 12 drop: writing. 0 of unknown ready.");
    assert.equal(cc.batchLine(b({ status: "failed", error: "The planner stopped." })), "Oct 12 drop stopped: The planner stopped.");
    assert.equal(cc.batchLine(b({ status: "failed", error: "" })), "Oct 12 drop stopped: no reason was saved.");
    assert.equal(cc.batchBusy(b({ status: "writing" })), true);
    assert.equal(cc.batchBusy(b({ status: "ready" })), false);
    assert.equal(cc.batchLine(null), "");
  });
});

describe("Use this angle (spec §7.5 step 7)", () => {
  test("the request is the suggestion's why as the idea, with source 'suggestion'", () => {
    const s = cc.normalizeNext(res(exampleResponse("GET marketing/batches/next"))).next.suggestions[0];
    const body = plain(cc.ideaRequest(s, "rid-0000-1111"));
    assert.deepEqual(body, { request_id: "rid-0000-1111", raw_points: "Most spend and most leads last week.", source: "suggestion", angle_key: "two-files" });
    assertRequestMatchesContract("POST marketing/ideas", body);
    assert.equal(cc.ideaRequest({ ...s, why: "" }, "rid-0000-1111").raw_points, "Lenders read two files", "never an empty idea");
    assert.equal("angle_key" in cc.ideaRequest({ ...s, angleKey: "" }, "rid-0000-1111"), false);
  });

  test("it says what happened, in words", () => {
    assert.deepEqual(plain(cc.summarizeIdea(res(exampleResponse("POST marketing/ideas")), "Lenders read two files", NOW)),
      { ok: true, tone: "ok", text: "Saved “Lenders read two files” as an idea at 12:00 PM. Ideas go first in the next batch." });
    assert.equal(cc.summarizeIdea(res({ error: "invalid", field: "raw_points", message: "Type or say the idea first. The box is empty." }, 400), "x", NOW).text,
      "That angle was not saved. Type or say the idea first. The box is empty.");
    assert.equal(cc.summarizeIdea(res({ error: "forbidden" }, 403), "x", NOW).text,
      "That angle was not saved. Your account is not allowed to do this. Only the owner and admins can.");
  });

  test("each angle has one Use this angle; a saved one says so instead; a busy one waits", () => {
    const part = cc.normalizeNext(res(exampleResponse("GET marketing/batches/next")));
    const html = cc.renderNext(part, null, view(), {}, NOW);
    assert.equal((html.match(/data-act="use-angle"/g) || []).length, 3);
    assert.match(html, /data-angle="two-files"><span class="spin" aria-hidden="true"><\/span><span class="lbl">Use this angle<\/span>/);
    const saved = cc.renderNext(part, null, view(), { accepted: { "2026-W43:two-files": 1 } }, NOW);
    assert.equal((saved.match(/data-act="use-angle"/g) || []).length, 2);
    assert.match(saved, /<span class="caption">Saved as an idea\.<\/span>/);
    const busy = cc.renderNext(part, null, view(), { saving: { "inquiries-off": true } }, NOW);
    assert.match(busy, /data-angle="inquiries-off" disabled aria-busy="true">.*Saving…/);
    const none = exampleResponse("GET marketing/batches/next");
    none.next.suggestions = [];
    assert.match(cc.renderNext(cc.normalizeNext(res(none)), null, view(), {}, NOW), /The planner has no angle to suggest right now\./);
  });
});

describe("Waiting on you: scripts ready and stuck jobs with Retry", () => {
  const VIDEOS_NONE = { loaded: true, items: [], more: false };

  test("scripts first, then each stuck job with its reason and ONE Retry", () => {
    const rows = cc.waitingList(view(), VIDEOS_NONE, NOW, {});
    assert.deepEqual(plain(rows.map((r) => r.kind)), ["scripts", "stuck"]);
    assert.equal(rows[0].what, "Approve or fix 18 scripts");
    assert.equal(rows[0].why, "2 scripts need a look first.");
    assert.equal(rows[0].actHtml, '<a class="btn quiet" href="#scripts">Open Scripts</a>');
    assert.equal(rows[1].what, "Stuck: writing one script");
    assert.equal(rows[1].why, "The writer stopped: the model took longer than 5 minutes.");
    assert.equal(rows[1].howHtml, 'Stuck since <span title="Oct 12, 2026, 5:40 AM">5:40 AM (6 hours ago)</span>.');
    assert.equal((rows[1].actHtml.match(/data-act="retry"/g) || []).length, 1);
    assert.match(rows[1].actHtml, /data-job="00000000-0000-4000-8000-000000000501"/);
    const html = cc.renderWaiting(view(), VIDEOS_NONE, NOW, {});
    assert.match(html, /<li class="row" data-wait="stuck" data-job-row="00000000-0000-4000-8000-000000000501">/);
  });

  test("MARKETING_AI_RUNNER=local: the Mac's queue row sits after scripts and before stuck jobs; no key or nothing queued, no row", () => {
    const line = "2 AI jobs are waiting for your Mac.";
    const waiting = cc.waitingList(view({ mac_queue: { waiting: 2, running: 1, line } }), VIDEOS_NONE, NOW, {});
    assert.deepEqual(plain(waiting.map((r) => r.kind)), ["scripts", "mac", "stuck"]);
    assert.equal(waiting[1].what, "Waiting for your Mac to run it");
    assert.equal(waiting[1].why, line);
    assert.match(cc.renderWaiting(view({ mac_queue: { waiting: 2, running: 1, line } }), VIDEOS_NONE, NOW, {}), /<li class="row" data-wait="mac">/);
    const running = cc.waitingList(view({ mac_queue: { waiting: 0, running: 1, line } }), VIDEOS_NONE, NOW, {});
    assert.equal(running.find((r) => r.kind === "mac").what, "Your Mac is running it now");
    for (const mac_queue of [{ waiting: 0, running: 0, line: "" }, null]) {
      const none = cc.waitingList(view({ mac_queue }), VIDEOS_NONE, NOW, {});
      assert.deepEqual(plain(none.map((r) => r.kind)), ["scripts", "stuck"]);
    }
  });

  test("after a retry the row says it is running again and the button goes; a job that fails again gets it back", () => {
    const id = "00000000-0000-4000-8000-000000000501";
    const at = Date.parse("2026-10-12T19:00:00Z");
    let row = cc.stuckWaits(view(), { retried: { [id]: { at, ok: true, tone: "ok", text: "Running again. Started 12:00 PM." } } }, NOW)[0];
    assert.equal(row.actHtml, "");
    assert.deepEqual(plain(row.say), { tone: "ok", text: "Running again. Started 12:00 PM." });
    const again = view({ stuck_jobs: [{ id, kind: "write_slot", error: "The writer stopped again.", since: "2026-10-12T19:30:00.000Z" }] });
    row = cc.stuckWaits(again, { retried: { [id]: { at, ok: true, tone: "ok", text: "Running again." } } }, NOW + 3600000)[0];
    assert.match(row.actHtml, /data-act="retry"/);
    assert.equal(row.why, "It failed again after the retry. The writer stopped again.");
    row = cc.stuckWaits(view(), { retried: { [id]: { at, ok: false, tone: "err", text: "That step has not failed." } } }, NOW)[0];
    assert.match(row.actHtml, /data-act="retry"/);
    assert.deepEqual(plain(row.say), { tone: "err", text: "That step has not failed." });
    row = cc.stuckWaits(view(), { retrying: { [id]: true } }, NOW)[0];
    assert.match(row.actHtml, /disabled aria-busy="true">.*Retrying…/);
  });

  test("no scripts row for 0 or unknown; a job with no reason says so; a kind is never a code name", () => {
    assert.equal(cc.scriptsWait(view({ scripts_waiting: { ready: 0, flagged: 0 } })), null);
    assert.equal(cc.scriptsWait(view({ scripts_waiting: null })), null);
    assert.equal(cc.scriptsWait(view({ scripts_waiting: { ready: 1, flagged: 1 } })).why, "1 script needs a look first.");
    assert.equal(cc.scriptsWait(view({ scripts_waiting: { ready: 3, flagged: 0 } })).why, "They are ready to read.");
    const row = cc.stuckWaits(view({ stuck_jobs: [{ id: "j1", kind: "mystery_kind", error: null, since: null }] }), {}, NOW)[0];
    assert.equal(row.what, "Stuck: a machine step");
    assert.equal(row.why, "No reason was saved.");
    assert.equal(row.howHtml, "Stuck since an unknown time.");
    for (const kind of Object.keys(JOB_KINDS)) {
      assert.notEqual(cc.kindWords(kind), "a machine step", `${kind} has words`);
      assert.doesNotMatch(cc.kindWords(kind), /_/, `${kind} is said in words`);
    }
  });

  test("the request matches the contract, and the answer is plain", () => {
    const body = plain(cc.retryRequest("00000000-0000-4000-8000-000000000501", "rid-1234-5678"));
    assert.deepEqual(body, { request_id: "rid-1234-5678", job_id: "00000000-0000-4000-8000-000000000501" });
    assertRequestMatchesContract("POST marketing/jobs/retry", body);
    assert.deepEqual(plain(cc.summarizeRetry(res(exampleResponse("POST marketing/jobs/retry")), NOW)),
      { ok: true, tone: "ok", text: "Running again. Started 12:00 PM." });
    assert.equal(cc.summarizeRetry(res({ error: "not_found", message: "That step was not found, or it is not one the machine can retry." }, 404), NOW).text,
      "That step was not found, or it is not one the machine can retry.");
    assert.equal(cc.summarizeRetry(res({ error: "not_found" }, 404), NOW).text, "That is not there yet. It turns on with the next update.");
    assert.equal(cc.summarizeRetry(res({ error: "invalid", field: "job_id", message: "That step already finished. There is nothing to retry." }, 400), NOW).text,
      "That step already finished. There is nothing to retry.");
  });

  test("request ids are ones the marketing routes take", () => {
    for (let i = 0; i < 20; i++) assert.match(cc.newRequestId(), cc.REQUEST_ID_RE);
  });
});

describe("Money and leads (spec §8.3, §11.3)", () => {
  test("today, 7 and 30 days: six numbers each, null in words, spend with its comparison", () => {
    const v = view();
    const d7 = plain(cc.numberCells(v, "d7", NOW));
    assert.deepEqual(d7.map((c) => [c.label, c.value, c.note]), [
      ["Ad spend", "$615", "Up from $482 the 7 days before."],
      ["Leads", "23", ""],
      ["Calls booked", "7", "5 showed"],
      ["Sales", "1", "4 roadmaps bought"],
      ["Cash", "$1,588", "Closers typed $1,000"],
      ["Cash back per $1 of ads", "$2.58", "back for each $1 of ads"]
    ]);
    const today = plain(cc.numberCells(v, "today", NOW));
    assert.deepEqual(today[0], { key: "spend", label: "Ad spend", value: "Comes in tomorrow", note: "The Meta pull runs at midnight, Arizona time." });
    assert.equal(today[4].value, "$0", "a measured 0 is $0");
    assert.equal(today[4].note, "", "no closers' number: nothing is printed, not $0");
    assert.equal(today[5].value, "unknown");
    // A stale pull: today's spend is unknown, not "tomorrow".
    assert.equal(cc.numberCells(v, "today", NOW + 4 * 86400000)[0].value, "unknown");
    assert.equal(cc.numberCells(v, "d30", NOW)[0].note, "Up from $1,519 the 30 days before.");
  });

  test("a window of nulls is all 'unknown', never $0", () => {
    const v = view({ numbers: { today: {}, d7: { spend_cents: null, leads: null, booked: null, showed: null, sales: null, roadmaps: null, cash_cents: null, reported_cash_cents: null, roas: null }, d30: null } });
    for (const which of ["d7", "d30"]) {
      const cells = cc.numberCells(v, which, NOW);
      for (const c of cells) assert.equal(c.value, "unknown", `${which} ${c.key}`);
      assert.doesNotMatch(JSON.stringify(plain(cells)), /\$0\b/);
    }
    assert.deepEqual(plain(cc.roasWords(null, 0)), { value: "unknown", note: "No ad spend, so nothing to compare." });
    assert.deepEqual(plain(cc.roasWords(0, 5000)), { value: "$0.00", note: "back for each $1 of ads" });
  });

  test("sparklines are drawn by hand: a null day breaks the line, never dips to 0", () => {
    const daily = [
      { date: "2026-10-08", spend: 100, leads: 0 },
      { date: "2026-10-09", spend: 200, leads: 2 },
      { date: "2026-10-10", spend: null, leads: 1 },
      { date: "2026-10-11", spend: 50, leads: 0 }
    ];
    const m = plain(cc.sparkModel(daily, "spend"));
    assert.equal(m.segs.length, 2, "two pieces around the unknown day");
    assert.deepEqual(m.segs[0], [[0, 16], [33.33333333333333, 2]]);
    assert.equal(m.max, 200);
    assert.equal(m.hiDate, "2026-10-09");
    assert.equal(m.unknownDays, 1);
    assert.equal(cc.sparkWords(cc.sparkModel(daily, "spend"), "spend"), "Highest day: $2 on Oct 9. No spend saved on 1 of 4 days.");
    assert.equal(cc.sparkWords(cc.sparkModel(daily, "leads"), "leads"), "Most leads in a day: 2, on Oct 9.");
    const svg = cc.sparkSvg(cc.sparkModel(daily, "spend"), "Ad spend");
    assert.match(svg, /^<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Ad spend" focusable="false">/);
    assert.equal((svg.match(/<polyline /g) || []).length, 2);
    assert.match(svg, /<polyline points="99\.20,23\.00 100\.00,23\.00"/, "a one-day piece is a short dash, still drawn");
    const none = cc.sparkModel(daily.map((d) => ({ ...d, spend: null })), "spend");
    assert.equal(none.max, null);
    assert.equal(cc.sparkWords(none, "spend"), "No ad spend saved on any of these days.");
    const zero = cc.sparkModel(daily.map((d) => ({ ...d, leads: 0 })), "leads");
    assert.equal(cc.sparkWords(zero, "leads"), "No leads on any of these days.");
    assert.equal(cc.sparkModel([], "spend"), null);
  });

  test("spend by funnel: the biggest bar is the biggest spend; unknown has no bar; the spend with no funnel is named", () => {
    const bars = plain(cc.funnelBars(view().byFunnel));
    assert.deepEqual(bars, [
      { name: "Roadmap $147", unmapped: false, value: "$412", pct: 100 },
      { name: "Book a call", unmapped: false, value: "$111.50", pct: 27 },
      { name: "Not tied to a funnel", unmapped: true, value: "$91.50", pct: 22 }
    ]);
    const odd = plain(cc.funnelBars([{ key: "a_b", name: "", spend: null }, { key: "c", name: "C", spend: 0 }]));
    assert.deepEqual(odd, [{ name: "A b", unmapped: false, value: "unknown", pct: null }, { name: "C", unmapped: false, value: "$0", pct: null }]);
  });

  test("the flow: ad → page → lead → call → sale", () => {
    assert.deepEqual(plain(cc.flowSteps(view().flow)).map((s) => [s.label, s.value, s.note]), [
      ["Ad taps", "2,210", ""], ["On the page", "1,840", ""], ["Leads", "23", ""], ["Calls booked", "7", "5 showed"], ["Sales", "1", ""]
    ]);
    assert.equal(plain(cc.flowSteps({ clicks: null, pageViews: null, leads: 0, booked: 0, showed: null, sales: 0 }))[0].value, "unknown");
  });

  test("the card: three windows, two sparklines, the bars, the flow and the as-of words; no chart library", () => {
    const v = view();
    v.daily = [{ date: "2026-10-10", spend: 9150, leads: 4 }, { date: "2026-10-11", spend: 8730, leads: 2 }];
    const html = cc.renderNumbers(v, NOW);
    assert.equal((html.match(/class="num-col"/g) || []).length, 3);
    assert.match(html, /<p class="eyebrow">Last 7 days<\/p><p class="caption muted">Oct 5 to Oct 11<\/p>/);
    assert.equal((html.match(/<svg class="spark"/g) || []).length, 2);
    assert.match(html, /<a class="caption" href="#settings">Tie it to a funnel in Settings<\/a>/);
    assert.match(html, /<li data-step="clicks"><span class="caption">Ad taps<\/span><b class="">2,210<\/b><\/li>/);
    assert.match(html, /<p class="caption asof gap-top">Numbers through Oct 11, saved <span title="Oct 12, 2026, 12:01 AM">12:01 AM \(11 hours ago\)<\/span>\. ClickFunnels last pulled <span title="Oct 11, 2026, 3:10 PM">Oct 11, 3:10 PM<\/span>\.<\/p>$/);
    assert.doesNotMatch(html, /<canvas|<script/);
    // Not loaded / not built yet: one sentence each.
    assert.match(cc.renderNumbers(cc.normalizeToday(null), NOW), /Not loaded/);
    assert.equal(cc.renderNumbers(view({ numbers: null, waiting: [{ part: "numbers", reason: "The M5 numbers are not live yet." }] }), NOW),
      '<p class="muted">The M5 numbers are not live yet.</p>');
    assert.equal(cc.renderNumbers(view({ numbers: null }), NOW),
      '<p class="muted">The numbers are not on this server yet. They turn on with the next update.</p>');
  });
});

describe("the page's own rules", () => {
  test("the three new cards are in Today's markup, below the older cards so their places hold", () => {
    const m = cc.TODAY_HTML;
    for (const id of ["todayWork", "todayMore", "cardNext", "nextBody", "cardMachine", "machineBody", "cardNumbers", "numbersBody"]) {
      assert.match(m, new RegExp(`id="${id}"`), id);
    }
    assert.ok(m.indexOf('id="cardOffer"') < m.indexOf('id="cardNext"'), "Next drop sits under the Offer cards until Write now is live");
    assert.ok(m.indexOf('id="cardNext"') < m.indexOf('id="cardNumbers"'));
    assert.ok(m.indexOf('id="cardNumbers"') < m.indexOf('id="cardHealth"'));
  });

  test("Today's CSS: scoped, no px font size, no hand-written shadow, the 8px scale", () => {
    const css = cc.CSS;
    for (const line of css.split("\n")) assert.match(line, /^(@media [^{]+\{)?#tab-today /, line);
    assert.doesNotMatch(css, /font-size|font:/, "sizes come from the brand's whitelist (UI-STANDARDS §12.7)");
    assert.doesNotMatch(css, /box-shadow/, "UI-STANDARDS §12.2");
    const sizes = [...css.matchAll(/(?:margin|padding|gap|row-gap|column-gap)[a-z-]*:([^;}]+)/g)].flatMap((x) => x[1].match(/\d+px/g) || []);
    for (const s of sizes) assert.ok(["8px", "16px", "24px", "32px", "48px", "64px"].includes(s), `spacing ${s} is on the 8px scale (UI-STANDARDS §2)`);
    assert.doesNotMatch(SRC, /chart\.js|d3\.|echarts|<canvas/i, "charts are drawn by hand (spec §4 trap 15)");
  });

  test("plain words: Fundhub, never a code word for Chris", () => {
    assert.doesNotMatch(SRC, /FundHub|FUNDHUB|Fund Hub/);
    const words = [
      cc.healthModel(cc.normalizeHealth(res(exampleResponse("GET marketing/health"))), null, NOW).rows.map((r) => r.text + r.what).join(" "),
      cc.renderNext(cc.normalizeNext(res(exampleResponse("GET marketing/batches/next"))), cc.normalizeBatches(res(exampleResponse("GET marketing/batches"))), view(), {}, NOW),
      cc.renderNumbers(view(), NOW)
    ].join(" ");
    assert.doesNotMatch(words, /hook rate|write_slot|roadmap_147|null|undefined|NaN|outbox|held_reason/);
  });
});
