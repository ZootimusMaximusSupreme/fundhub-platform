// "Build the avatar" on Today's flywheel step-1 row (public/app/marketing-avatar-row.js),
// run in node:vm with no browser and no server, like marketing-command-center.test.mjs.
// Unit X1; design §6 slice 5a, §3.2 row 1, §5 rules 3 and 9, UI-STANDARDS §1 and §5.
//
// The promises: the cost line and the run words are the server's own; every control
// works (disabled with its reason while a run is going); no filled button is painted;
// every answer comes back in plain words.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "marketing-avatar-row.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "marketing-command-center.html"), "utf8");

function load() {
  const ctx = createContext({ console, crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" } });
  runInContext(SRC, ctx);
  return ctx.FHAvatarRow;
}

const COSTS = {
  ok: true,
  avatar_line: "Cost: unknown, not measured yet. This run stops by itself at $20 (the cap is in Settings). $0 of $300 used this month.",
  kinds: { avatar: null }
};

const flywheel = (run, extra = {}) => ({
  ok: true,
  campaign: "partner",
  campaign_words: "Partner offer",
  service_description_default: "The Fundhub $10,000 white-label partnership.",
  owner_notes_stage_1: "2026-08-31 | stage 1 | the avatar is assumed on purpose.",
  stages: [{ n: 1, key: "avatar", sentence: "Done. 133 quotes. Approved.", run }],
  ...extra
});

describe("rowModel: the words are the server's", () => {
  const av = load();

  test("no run yet: no repeat of the row's own words, the server's cost line, Build the avatar enabled", () => {
    const m = av.rowModel(flywheel(null), COSTS);
    assert.equal(m.sentence, "");
    assert.doesNotMatch(av.renderAct(m), /av-run/);
    assert.equal(m.costLine, COSTS.avatar_line);
    assert.equal(m.canStart, true);
    assert.equal(m.canRetry, false);
    assert.equal(m.serviceDefault, "The Fundhub $10,000 white-label partnership.");
  });

  test("a run going: its sentence, and the button disabled WITH its reason", () => {
    const m = av.rowModel(flywheel({ id: "j1", status: "running", sentence: "Running: step 3 of 10, searching the web for buyer quotes, round 2. $1.90 spent so far, 23 searches." }), COSTS);
    assert.match(m.sentence, /^Running: step 3 of 10/);
    assert.equal(m.canStart, false);
    assert.equal(m.startWhy, "It is running now. This row shows each step as it goes.");
    const html = av.renderAct(m);
    assert.match(html, /data-av="start" disabled>Build the avatar<\/button>/);
    assert.match(html, /It is running now\./);
  });

  test("stopped at the cap: the stop sentence and a Retry that keeps what it found", () => {
    const m = av.rowModel(flywheel({ id: "j2", status: "failed", stopped_at_cap: { cap: "run" }, sentence: "Stopped at the $20 run cap after step 6. What it found so far is saved." }), COSTS);
    assert.equal(m.canRetry, true);
    assert.match(av.renderAct(m), /data-av="retry">Retry \(keeps what it found\)<\/button>/);
  });

  test("costs not readable: the honest unknown line, never a guessed number", () => {
    const m = av.rowModel(flywheel(null), null);
    assert.equal(m.costLine, "Cost: unknown, not measured yet.");
  });

  test("not a flywheel read (an empty or error body): no block at all", () => {
    for (const body of [null, {}, { ok: true, items: [] }, { ok: true, stages: [] }, { ok: true, stages: [{ key: "offer" }] }]) {
      assert.equal(av.rowModel(body, COSTS), null);
    }
  });
});

describe("the sheet and the request", () => {
  const av = load();

  test("the sheet shows the cost line, What we sell pre-filled, the notes read only, and says what happens", () => {
    const html = av.renderSheet(av.rowModel(flywheel(null), COSTS));
    assert.match(html, /Build the avatar for Partner offer\?/);
    assert.match(html, /stops by itself at \$20/);
    assert.match(html, /<textarea id="avService"[^>]*>The Fundhub \$10,000 white-label partnership\.<\/textarea>/);
    assert.match(html, /the avatar is assumed on purpose/);
    assert.match(html, />Start building<\/button>/);
    assert.match(html, /It spends no ad money\./);
  });

  test("the request: campaign, stage 1, a request_id, the typed service; Retry names the run", () => {
    const m = av.rowModel(flywheel(null), COSTS);
    assert.deepEqual(JSON.parse(JSON.stringify(av.startBody(m, "  Funding,\n done for you  ", null))), {
      campaign: "partner", stage: 1, request_id: "11111111-2222-4333-8444-555555555555", service_description: "Funding, done for you"
    });
    assert.equal(av.startBody(m, "", "j2").retry_job_id, "j2");
    assert.equal(av.startBody(m, "", null).service_description, undefined, "blank: the server's own default is used");
  });

  test("every answer in plain words, never a status code", () => {
    assert.match(av.answerWords(202, { started: true }).text, /^Started\./);
    assert.equal(av.answerWords(202, { already_running: true, message: "The avatar is already being built. This is that run." }).text, "The avatar is already being built. This is that run.");
    assert.match(av.answerWords(202, { retried: true }).text, /Nothing it already found is paid for twice/);
    assert.equal(av.answerWords(503, { error: "no_model", message: "No Anthropic key is set on the site. An agent must set it." }).text, "No Anthropic key is set on the site. An agent must set it.");
    assert.match(av.answerWords(409, { error: "cap_hit", message: "Stopped at the $300 month cap. Raise it in Settings or wait for next month." }).text, /month cap/);
    assert.match(av.answerWords(0, null).text, /^No connection/);
    for (const s of [400, 409, 500, 503]) assert.doesNotMatch(av.answerWords(s, {}).text, /\b(4|5)\d\d\b/);
  });
});

describe("on the page", () => {
  // Wave 2b merge: U34's frame draws Today from its own tab script
  // (marketing-cc-today.js), so the row's script comes after the frame AND after Today.
  test("the page loads it after its own script and after the Today tab", () => {
    const at = (name) => HTML.indexOf(`<script defer src="${name}"></script>`);
    assert.ok(at("marketing-avatar-row.js") > 0, "the row's script is on the page");
    assert.ok(at("marketing-command-center.js") > 0 && at("marketing-command-center.js") < at("marketing-avatar-row.js"));
    assert.ok(at("marketing-cc-today.js") > 0 && at("marketing-cc-today.js") < at("marketing-avatar-row.js"));
  });

  test("it waits for Today's list when another tab is drawn first", () => {
    assert.match(SRC, /function whenListThere\(\)/);
    assert.match(SRC, /getElementById\("flywheelList"\)/);
  });

  test("it never paints a filled button and never writes a font size", () => {
    assert.doesNotMatch(SRC, /btn primary/);
    assert.doesNotMatch(SRC, /font-size/);
    assert.doesNotMatch(SRC, /FundHub|FUNDHUB|Fund Hub/);
  });
});
