// The Command Center's Settings tab: its rules, run in node:vm with no browser
// and no server (same pattern as src/ui/marketing-command-center.test.mjs).
//
// Every answer here is the U01 contract's own example
// (src/marketing/api-contract.mjs exampleResponse), so a change to the
// settings or funnels shape that the screen does not follow fails here first.
//
// The promises this tab makes (plan unit U34, design §3.8):
//   1. NEVER FAKE A NUMBER. A campaign with no saved spend reads "unknown",
//      never $0; a month nobody measured reads "unknown".
//   2. ONLY CHRIS TURNS THE WEEKLY SWITCH ON. Save never sends `enabled`; the
//      switch's own confirm is the one place it is set, and its words name the
//      caps.
//   3. SAVE SENDS ONLY WHAT CHANGED, with the version it read; a 409 shows
//      both versions.
//   4. THE VIDEO CHOICES STAY HIDDEN until the video pipeline reads them.
//   5. PLAIN WORDS: no status code, no server key, on screen.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { exampleResponse, assertRequestMatchesContract, CONTRACT } from "../marketing/api-contract.mjs";
import { FORMATS, AD_LANES, SIZE_RULES, SETTINGS_PATCH_KEYS, validateSettingsPatch, validateFunnelInput } from "../marketing/settings-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const FRAME = fs.readFileSync(path.join(APP, "marketing-command-center.js"), "utf8");
const SRC = fs.readFileSync(path.join(APP, "marketing-cc-settings.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "marketing-command-center.html"), "utf8");

const plain = (v) => JSON.parse(JSON.stringify(v));

/* A window with the frame, then this tab, as the page loads them. */
function load() {
  const ctx = createContext({ console: { error() {}, log: console.log } });
  runInContext(FRAME, ctx);
  runInContext(SRC, ctx);
  return ctx;
}
const S = () => load().FHMarketingCCSettings;

const SETTINGS = () => exampleResponse("GET marketing/settings").settings;
const FUNNELS = () => exampleResponse("GET marketing/funnels");
const HEALTH = () => exampleResponse("GET marketing/health");
const NOW = Date.parse("2026-10-12T15:04:05Z"); // 8:04 AM Arizona

/* The state the tab paints from, after a good load. */
function state(s, over = {}) {
  const st = s.newState();
  st.loaded = true;
  st.settings = SETTINGS();
  st.draft = s.draftOfSettings(st.settings);
  const f = s.normalizeFunnels({ status: 200, body: FUNNELS() });
  st.funnels = f.funnels;
  st.campaigns = f.campaigns;
  st.adSets = f.adSets;
  st.asOf = f.asOf;
  for (const x of st.funnels) st.funnelDraft[x.key] = s.draftOfFunnel(x);
  st.health = s.normalizeHealth({ status: 200, body: HEALTH() });
  return Object.assign(st, over);
}

describe("the tab plugs into the frame", () => {
  test("it registers as the gear tab named Settings, with its rules", () => {
    const w = load();
    const t = plain(w.FHMarketingCCTabs.list()).find((x) => x.key === "settings");
    assert.deepEqual(t, { key: "settings", label: "Settings", order: 900, place: "gear" });
    assert.equal(w.FHMarketingCCTabs.rules("settings"), w.FHMarketingCCSettings);
  });

  test("its lists match the server's: script kinds, lanes, how to count", () => {
    const s = S();
    assert.deepEqual(plain(s.FORMATS), [...FORMATS]);
    assert.deepEqual(plain(s.LANES), [...AD_LANES]);
    assert.deepEqual(plain(s.SIZE_RULES), [...SIZE_RULES]);
    for (const k of s.EDIT_KEYS) assert.ok(SETTINGS_PATCH_KEYS.includes(k), `${k} is a setting the server takes`);
    for (const k of s.HIDDEN_KEYS) assert.ok(SETTINGS_PATCH_KEYS.includes(k), `${k} is a setting the server keeps`);
    assert.ok(!s.EDIT_KEYS.includes("enabled"), "the form never edits the weekly switch");
  });
});

describe("never fake a number", () => {
  test("a campaign with no saved spend reads unknown, never $0; a measured zero reads $0.00", () => {
    const s = S();
    assert.equal(s.spendWords(null), "Spend in the last 7 days: unknown.");
    assert.equal(s.spendWords(undefined), "Spend in the last 7 days: unknown.");
    assert.equal(s.spendWords(41200), "$412.00 spent in the last 7 days.");
    assert.equal(s.spendWords(0), "$0.00 spent in the last 7 days.");
    const camps = s.campaignChoices("roadmap_147", [], FUNNELS().campaigns, FUNNELS().funnels);
    assert.equal(camps[1].spend, "Spend in the last 7 days: unknown.");
  });

  test("model spend this month: from GET marketing/health, or unknown when it did not load", () => {
    const s = S();
    assert.equal(s.spentLine(s.normalizeHealth({ status: 200, body: HEALTH() })), "Used this month: $12.48. Last batch: $9.70.");
    assert.equal(s.spentLine(s.normalizeHealth({ status: 500, body: { error: "boom" } })), "Used this month: unknown. Last batch: unknown.");
    const noBatch = HEALTH();
    noBatch.model.last_batch_cost_usd = null;
    assert.equal(s.spentLine(s.normalizeHealth({ status: 200, body: noBatch })), "Used this month: $12.48. Last batch: none yet.");
    assert.equal(s.usd(null), "unknown");
  });

  test("the rendered tab never shows $0 for an unknown spend", () => {
    const s = S();
    const html = s.renderPage(state(s), NOW);
    const camps = html.slice(html.indexOf('<ul class="camps">'));
    assert.match(camps, /Spend in the last 7 days: unknown\./);
    assert.doesNotMatch(camps.replace(/treats it as \$0 spent/g, ""), /\$0(?![.,\d])/);
  });
});

describe("the weekly switch", () => {
  test("off by default; turning it on asks first and names the caps", () => {
    const s = S();
    const w = s.switchWords(SETTINGS(), FUNNELS().funnels);
    assert.equal(w.on, false);
    assert.equal(w.word, "Off");
    assert.equal(w.line, "Off. No weekly scripts are written until you turn this on.");
    assert.equal(w.button, "Turn on weekly scripts");
    assert.equal(w.ask.question, "Turn on weekly scripts?");
    assert.equal(w.ask.detail, "Every Monday at 7:00 AM Arizona time the writer makes 21 scripts. " +
      "It may spend up to $40 a batch and $300 a month on the writing model. It never spends ad money.");
    assert.equal(w.ask.yes, "Yes, turn it on");
    const on = s.switchWords({ ...SETTINGS(), enabled: true }, FUNNELS().funnels);
    assert.equal(on.word, "On");
    assert.equal(on.ask.detail, "No new weekly batch starts. Nothing already written is lost.");
  });

  test("the switch's patch is the only place `enabled` is ever sent, and the server takes it", () => {
    const s = S();
    assert.deepEqual(plain(s.switchPatch(true)), { enabled: true });
    assert.deepEqual(plain(s.switchPatch(false)), { enabled: false });
    assert.deepEqual(plain(s.switchPatch("yes")), { enabled: false }, "only a real true turns it on");
    validateSettingsPatch(plain(s.switchPatch(true)));
    // The form's patch never carries it, whatever is in the boxes.
    const d = s.draftOfSettings(SETTINGS());
    d.enabled = "true";
    assert.ok(!("enabled" in plain(s.diffSettings(SETTINGS(), d).patch)));
    // In the source, `enabled:` is written into a patch in exactly one place.
    assert.equal((SRC.match(/\{ enabled: /g) || []).length, 1);
    assert.match(SRC, /function switchPatch\(on\) \{ return \{ enabled: on === true \}; \}/);
  });

  test("the switch card in the page: the chip says its word, two taps to change", () => {
    const s = S();
    const html = s.renderPage(state(s), NOW);
    assert.match(html, /<h2>Write scripts every week<\/h2><span class="chip"><span class="cd"><\/span>Off<\/span>/);
    assert.match(html, /data-act="switch-ask" id="setSwitchBtn">Turn on weekly scripts<\/button>/);
    assert.doesNotMatch(html, /switch-yes/, "the second tap shows only after the first");
    const asked = s.renderPage(state(s, { switchAsk: true }), NOW);
    assert.match(asked, /data-act="switch-yes"[^>]*>.*Yes, turn it on/);
    assert.match(asked, /It may spend up to \$40 a batch and \$300 a month on the writing model\./);
  });
});

describe("Save sends only what changed", () => {
  test("nothing changed: no patch", () => {
    const s = S();
    const out = s.diffSettings(SETTINGS(), s.draftOfSettings(SETTINGS()));
    assert.equal(out.changed, false);
    assert.deepEqual(plain(out.patch), {});
    assert.deepEqual(plain(out.errors), []);
  });

  test("each box becomes its own key, typed the way the server checks it", () => {
    const s = S();
    const d = s.draftOfSettings(SETTINGS());
    Object.assign(d, {
      batch_weekday: "2", batch_time: "06:30", scripts_per_day: "4", days_per_batch: "5", size_rule: "per_funnel",
      draft_expiry_days: "10", quiet_start: "22:00", quiet_end: "06:00", max_batch_cost_usd: "35", max_month_cost_usd: "250"
    });
    d.format_style.long = "bullets";
    const out = s.diffSettings(SETTINGS(), d);
    assert.deepEqual(plain(out.patch), {
      batch_weekday: 2, batch_time: "06:30", quiet_start: "22:00", quiet_end: "06:00", scripts_per_day: 4,
      days_per_batch: 5, draft_expiry_days: 10, max_batch_cost_usd: 35, max_month_cost_usd: 250,
      size_rule: "per_funnel", format_style: { long: "bullets" }
    });
    // The server's own check takes it as it is.
    validateSettingsPatch(plain(out.patch));
    const req = { request_id: "00000000-0000-4000-8000-00000000c999", updated_at: SETTINGS().updated_at, patch: plain(out.patch) };
    assertRequestMatchesContract("POST marketing/settings", req);
    // No video choice ever rides along.
    for (const k of s.HIDDEN_KEYS) assert.ok(!(k in out.patch), k);
  });

  test("a box that is not right is named in plain words, and is not sent", () => {
    const s = S();
    const d = s.draftOfSettings(SETTINGS());
    Object.assign(d, { scripts_per_day: "0", batch_time: "7am", max_month_cost_usd: "12.5", batch_weekday: "9" });
    const out = s.diffSettings(SETTINGS(), d);
    assert.deepEqual(plain(out.errors.map((e) => e.key)), ["batch_weekday", "batch_time", "scripts_per_day", "max_month_cost_usd"]);
    assert.equal(out.errors.find((e) => e.key === "scripts_per_day").message, "Scripts a day must be a whole number, 1 or more.");
    assert.equal(out.errors.find((e) => e.key === "batch_time").message, "Drop time must be a time, like 7:00 AM.");
    assert.equal(out.errors.find((e) => e.key === "max_month_cost_usd").message, "Most one month can spend must be whole dollars, 1 or more.");
    for (const e of out.errors) assert.doesNotMatch(e.message, /_/, e.message);
    assert.ok(!("scripts_per_day" in out.patch));
  });

  test("a funnel sends its key, only the fields that changed, and the updated_at it was read at", () => {
    const s = S();
    const road = FUNNELS().funnels[1];
    const d = s.draftOfFunnel(road);
    d.meta_campaign_ids = ["120210000000000001"];
    d.default_ad_set_external_id = "120210000000000101";
    const out = s.diffFunnel(road, d);
    assert.deepEqual(plain(out.patch), {
      meta_campaign_ids: ["120210000000000001"], default_ad_set_external_id: "120210000000000101",
      key: "roadmap_147", updated_at: "2026-10-06T18:00:00.000Z"
    });
    // Same shape as the contract's own example request.
    const req = { request_id: "00000000-0000-4000-8000-00000000c998", funnel: plain(out.patch) };
    assertRequestMatchesContract("POST marketing/funnels", req);
    assert.deepEqual(plain(out.patch), plain(CONTRACT["POST marketing/funnels"].example.request.funnel));
    validateFunnelInput(plain(out.patch));
    assert.equal(s.diffFunnel(road, s.draftOfFunnel(road)).patch, null, "nothing changed: nothing sent");
  });

  test("every funnel box: name, landing page, lane, mix, button, weight, running, books a call", () => {
    const s = S();
    const book = FUNNELS().funnels[0];
    const d = s.draftOfFunnel(book);
    Object.assign(d, { name: "Book a call (new)", landing_url: "https://apply.fundhub.ai/watch-2", lane: "slo",
      cta_type: "SIGN_UP", weight: "1.5", active: false, book_call: false });
    d.format_mix.sorting = "";
    d.format_mix.long = "3";
    const out = s.diffFunnel(book, d);
    assert.deepEqual(plain(out.patch), {
      name: "Book a call (new)", landing_url: "https://apply.fundhub.ai/watch-2", lane: "slo",
      book_call: false, active: false, format_mix: { standard: 2, long: 3 }, cta_type: "SIGN_UP", weight: 1.5,
      key: "book_call", updated_at: "2026-10-06T18:00:00.000Z"
    });
    validateFunnelInput(plain(out.patch));
  });

  test("a bad funnel box is named in words", () => {
    const s = S();
    const book = FUNNELS().funnels[0];
    const d = s.draftOfFunnel(book);
    Object.assign(d, { name: " ", landing_url: "http://apply.fundhub.ai/watch", weight: "-1" });
    d.format_mix = { standard: "0", sorting: "", long: "", notes: "", greenscreen: "", vsl: "" };
    const out = s.diffFunnel(book, d);
    assert.deepEqual(plain(out.errors.map((e) => e.key)), ["name", "landing_url", "format_mix", "weight"]);
    assert.equal(out.errors[1].message, "The landing page for Book a call must be a full web address that starts with https://.");
    assert.equal(out.patch, null);
  });

  test("a funnel saved with no mix yet ({}, as the funnel builder makes them) never blocks a Save; a mix being sent still needs one above 0", () => {
    const s = S();
    const bare = { ...FUNNELS().funnels[0], key: "blueprint", name: "Capital Blueprint book a call", format_mix: {} };
    const untouched = s.diffFunnel(bare, s.draftOfFunnel(bare));
    assert.equal(untouched.patch, null, "untouched: nothing sent");
    assert.deepEqual(plain(untouched.errors), [], "and nothing wrong");
    const renamed = s.draftOfFunnel(bare);
    renamed.name = "Blueprint call";
    assert.deepEqual(plain(s.diffFunnel(bare, renamed).patch),
      { name: "Blueprint call", key: "blueprint", updated_at: bare.updated_at }, "another box saves without a mix");
    const zero = s.draftOfFunnel(bare);
    zero.format_mix.standard = "0";
    assert.equal(s.diffFunnel(bare, zero).patch, null, "a 0 is the same as no mix: nothing changed");
    assert.deepEqual(plain(s.diffFunnel(bare, zero).errors), []);
    const mixed = s.draftOfFunnel(bare);
    mixed.format_mix.standard = "2";
    assert.deepEqual(plain(s.diffFunnel(bare, mixed).patch.format_mix), { standard: 2 });
    validateFunnelInput(plain(s.diffFunnel(bare, mixed).patch));
    const cleared = s.draftOfFunnel(FUNNELS().funnels[0]);
    for (const k of Object.keys(cleared.format_mix)) cleared.format_mix[k] = "";
    assert.deepEqual(plain(s.diffFunnel(FUNNELS().funnels[0], cleared).errors.map((e) => e.key)), ["format_mix"],
      "clearing a saved mix to nothing is refused, as the server would");
  });
});

describe("campaigns and ad sets", () => {
  test("a campaign already on another funnel is disabled with the reason; its own funnel keeps it ticked", () => {
    const s = S();
    const f = FUNNELS();
    f.funnels[0].meta_campaign_ids = ["120210000000000002"];
    f.campaigns[1].funnel_key = "book_call";
    const road = s.campaignChoices("roadmap_147", [], f.campaigns, f.funnels);
    assert.deepEqual(plain(road[1]), {
      id: "120210000000000002", name: "Book a call ads (example)", status: "paused",
      spend: "Spend in the last 7 days: unknown.", checked: false, disabled: true, reason: "Linked to Book a call."
    });
    const book = s.campaignChoices("book_call", ["120210000000000002"], f.campaigns, f.funnels);
    assert.equal(book[1].checked, true);
    assert.equal(book[1].disabled, false);
  });

  test("the ad set picker: disabled with the reason until a campaign is linked; then that campaign's ad sets", () => {
    const s = S();
    const f = FUNNELS();
    const none = s.adSetChoices([], f.ad_sets, "");
    assert.equal(none.disabled, true);
    assert.equal(none.reason, "Link a Meta campaign first. Then pick its ad set here.");
    const linked = s.adSetChoices(["120210000000000001"], f.ad_sets, "");
    assert.deepEqual(plain(linked.options), [{ id: "120210000000000101", name: "Roadmap broad (example)", status: "on" }]);
    assert.equal(linked.disabled, false);
    assert.equal(linked.reason, "");
    assert.equal(s.adSetChoices([], [], "").reason,
      "No ad sets are synced yet. They show up here after the next Meta pull (midnight, Arizona time).");
    // A saved ad set whose campaign is not linked still shows, and says so.
    const odd = s.adSetChoices([], f.ad_sets, "120210000000000102");
    assert.equal(odd.options[0].name, "Book a call broad (example) (its campaign is not linked here)");
  });

  test("a funnel with no campaign says what that means for its spend", () => {
    const s = S();
    assert.equal(s.noCampaignLine([]),
      "No Meta campaign is linked to this funnel, so its spend reads unknown and the batch split treats it as $0 spent.");
    assert.equal(s.noCampaignLine(["1"]), "");
  });
});

describe("a 409 shows both versions", () => {
  test("every field Chris changed, his value beside the saved one, in words", () => {
    const s = S();
    const current = { ...SETTINGS(), batch_time: "05:00", max_month_cost_usd: 250, format_style: { ...SETTINGS().format_style, long: "words" } };
    const rows = plain(s.conflictRows({ batch_time: "06:30", max_month_cost_usd: 200, format_style: { long: "bullets" } }, current, "settings"));
    assert.deepEqual(rows, [
      { key: "batch_time", label: "Drop time", yours: "6:30 AM", saved: "5:00 AM" },
      { key: "max_month_cost_usd", label: "Most one month can spend", yours: "$200", saved: "$250" },
      { key: "format_style", label: "How each kind is written", yours: "Long ads: Bullets", saved: "Long ads: Every word" }
    ]);
    const frows = plain(s.conflictRows({ key: "roadmap_147", weight: 2, updated_at: "x" }, { ...FUNNELS().funnels[1], weight: 3 }, "funnel"));
    assert.deepEqual(frows, [{ key: "weight", label: "Weight", yours: "2", saved: "3" }]);
  });

  test("the sheet in the page: a table of both, Keep mine and Use the saved one; Save rests", () => {
    const s = S();
    const conflict = { kind: "settings", what: "Settings", patch: { batch_time: "06:30" }, current: SETTINGS(),
      rows: s.conflictRows({ batch_time: "06:30" }, SETTINGS(), "settings") };
    const html = s.renderPage(state(s, { conflict, dirty: true }), NOW);
    assert.match(html, /<th scope="col">Yours<\/th><th scope="col">Saved now<\/th>/);
    assert.match(html, /<tr><th scope="row">Drop time<\/th><td>6:30 AM<\/td><td>7:00 AM<\/td><\/tr>/);
    assert.match(html, /data-act="keep-mine">Keep mine<\/button>/);
    assert.match(html, /data-act="use-saved">Use the saved one<\/button>/);
    assert.match(html, /id="setSave" data-act="save" disabled>/);
  });
});

describe("answers in plain words", () => {
  test("a save's answer: saved, partly saved, or why not", () => {
    const s = S();
    assert.deepEqual(plain(s.saveAnswer([{ what: "Settings", ok: true }], NOW)), { tone: "ok", text: "Saved 8:04 AM." });
    assert.deepEqual(plain(s.saveAnswer([], NOW)), { tone: "wait", text: "Nothing changed yet." });
    assert.equal(s.saveAnswer([{ what: "Settings", ok: true }, { what: "Roadmap $147", ok: false, problem: "There is no connection." }], NOW).text,
      "Settings saved 8:04 AM. Roadmap $147 did not save. There is no connection. Try again.");
    assert.equal(s.saveAnswer([{ what: "Settings", ok: false, conflict: true }], NOW).text,
      "Did not save. Someone saved Settings after you opened this page. Pick yours or the saved one above.");
  });

  test("no status code and no server word ever reaches the screen", () => {
    const s = S();
    const cases = [
      { status: 0 }, { status: 0, transport: "timeout" }, { status: 401 }, { status: 403 }, { status: 404 },
      { status: 409, body: { error: "stale" } }, { status: 500, body: { error: "boom: relation x" } }, { status: 503 },
      { status: 503, body: { error: "not_ready", message: "Marketing settings is built" } },
      { status: 400, body: { error: "invalid", field: "patch.batch_time", message: "batch_time must be a time like 07:00" } },
      { status: 400, body: { error: "invalid", field: "funnel.meta_campaign_ids", message: "Campaign 1 is already on book_call." } },
      { status: 400, body: { error: "invalid", field: "patch.nope" } }
    ];
    for (const kind of ["settings", "funnel"]) {
      for (const res of cases) {
        for (const line of [s.problemWords(res, kind), s.loadProblem(res, "settings")]) {
          assert.doesNotMatch(line, /\b(4\d\d|5\d\d)\b|_|boom|relation|stale|invalid/, line);
          assert.match(line, /\.$/, line);
        }
      }
    }
    assert.equal(s.problemWords({ status: 400, body: { error: "invalid", field: "patch.batch_time" } }, "settings"), "Drop time is not right.");
    assert.equal(s.problemWords({ status: 400, body: { error: "invalid", field: "funnel.meta_campaign_ids" } }, "funnel"),
      "A campaign you picked is already linked to another funnel.");
  });

  test("times and the schedule read like a person talks, in Arizona", () => {
    const s = S();
    assert.equal(s.timeWords("07:00"), "7:00 AM");
    assert.equal(s.timeWords("21:00"), "9:00 PM");
    assert.equal(s.timeWords("00:30"), "12:30 AM");
    assert.equal(s.timeWords("12:00"), "12:00 PM");
    assert.equal(s.scheduleLine(SETTINGS(), FUNNELS().funnels), "Every Monday at 7:00 AM Arizona time: 21 scripts.");
    // The contract's example grows funnels as units land (X4 added a third, the
    // blueprint), so the count is read from the example, and the sum is also
    // pinned on a fixed list: two running funnels and one turned off.
    const running = FUNNELS().funnels.filter((f) => f.active === true).length;
    assert.ok(running >= 2, "the contract example runs at least two funnels");
    assert.equal(s.scheduleLine({ ...SETTINGS(), size_rule: "per_funnel" }, FUNNELS().funnels),
      `Every Monday at 7:00 AM Arizona time: ${3 * 7 * running} scripts.`, `3 a day x 7 days x ${running} running funnels`);
    const two = FUNNELS().funnels.slice(0, 3).map((f, i) => ({ ...f, active: i < 2 }));
    assert.equal(s.scheduleLine({ ...SETTINGS(), size_rule: "per_funnel" }, two),
      "Every Monday at 7:00 AM Arizona time: 42 scripts.", "3 a day x 7 days x 2 running funnels");
    assert.equal(s.scheduleLine({ ...SETTINGS(), scripts_per_day: null }, []), "The schedule is not complete yet.");
    assert.equal(s.sizeRuleWords("total", 3), "3 a day in total");
    assert.equal(s.sizeRuleWords("per_funnel", "4"), "4 a day for each running funnel");
    assert.equal(s.quietLine({ quiet_start: "21:00", quiet_end: "07:00" }),
      "No buzzes from 9:00 PM to 7:00 AM, Arizona time. They wait until 7:00 AM.");
    assert.equal(s.asOfLine("2026-10-12T07:01:50.000Z", NOW), "Meta numbers as of 12:01 AM.");
    assert.equal(s.asOfLine("2026-10-09T07:01:50.000Z", NOW), "Meta numbers as of Oct 9, 12:01 AM.");
    assert.equal(s.asOfLine(null, NOW), "Meta has not synced yet.");
  });

  test("a month cap under what is spent warns first; at or over it, no warning", () => {
    const s = S();
    const h = s.normalizeHealth({ status: 200, body: HEALTH() });
    assert.equal(s.capWarning("10", h), "This is below what is already spent this month ($12.48). Runs stop at once.");
    assert.equal(s.capWarning("300", h), null);
    assert.equal(s.capWarning("10", s.normalizeHealth(null)), null, "unknown spend: nothing to compare");
  });
});

describe("the page this tab paints", () => {
  test("every dial the plan names is on it; the video choices are not", () => {
    const s = S();
    const html = s.renderPage(state(s), NOW);
    for (const label of ["Drop day", "Drop time (Arizona time)", "Scripts a day", "Days in a batch", "How to count",
      "Drafts go away after", "How each kind of script is written", "Quiet hours start", "Quiet hours end",
      "Most one batch can spend", "Most one month can spend", "The winner rule", "Not set yet.", "Funnels",
      "Name", "Landing page", "Lane tag", "Mix of script kinds", "Button on the ad", "Weight",
      "Running: the writer makes scripts for it", "This funnel books a call", "Meta campaigns for this funnel", "Default ad set"]) {
      assert.ok(html.includes(label), `"${label}" is missing`);
    }
    assert.doesNotMatch(html, /Submagic|Hormozi|caption_|magic_zooms|clean_audio|animation|flip_horizontal|settle/i);
    for (const k of s.HIDDEN_KEYS) assert.ok(!html.includes(`data-s="${k}"`), k);
    assert.ok(html.includes(s.NEVER));
  });

  test("one filled button, Save, and it rests until a box changes", () => {
    const s = S();
    const html = s.renderPage(state(s), NOW);
    assert.equal((html.match(/class="btn primary"/g) || []).length, 1);
    assert.match(html, /<button class="btn primary" type="button" id="setSave" data-act="save" disabled>/);
    assert.match(html, /No changes to save\./);
    const dirty = s.renderPage(state(s, { dirty: true }), NOW);
    assert.match(dirty, /id="setSave" data-act="save">/);
    assert.match(dirty, /You have changes that are not saved\./);
    assert.equal((SRC.match(/btn primary/g) || []).length, 1, "the script paints one filled button, Save");
  });

  test("the first open says these are the starting settings", () => {
    const s = S();
    assert.match(s.renderPage(state(s), NOW), /These are the starting settings\. Weekly scripts stay off until you turn them on\./);
    const st = state(s);
    st.settings = { ...st.settings, updated_by: "00000000-0000-4000-8000-000000000002" };
    assert.doesNotMatch(s.renderPage(st, NOW), /starting settings/);
  });

  test("a part that failed says so, and the rest still paints", () => {
    const s = S();
    const st = state(s, { settings: null, settingsProblem: s.loadProblem({ status: 503, body: { error: "not_ready" } }, "settings") });
    const html = s.renderPage(st, NOW);
    assert.match(html, /The settings did not load\. This part is built but not live yet\. It turns on with the next update\. The rest of this page is current\./);
    assert.match(html, /data-act="reload">Try again<\/button>/);
    assert.match(html, /fieldset class="funnel"/, "the funnels still paint");
  });

  test("server words are escaped, never run as markup", () => {
    const s = S();
    const st = state(s);
    st.campaigns = [{ external_id: "1", name: "<img src=x onerror=alert(1)>", status: "ACTIVE", spend_7d_cents: null, funnel_key: null }];
    const html = s.renderPage(st, NOW);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  test("its look follows the brand: no px font size, no hand-written shadow, the save bar clears the status strip", () => {
    const s = S();
    assert.doesNotMatch(s.CSS, /font-size|font:\s*\d/);
    assert.doesNotMatch(s.CSS, /box-shadow/);
    assert.doesNotMatch(s.CSS, /overflow(-[xy])?\s*:\s*(auto|scroll)/, "no inner scroll box");
    assert.match(s.CSS, /\.savebar\{position:sticky;bottom:calc\(var\(--fh-statusbar,0px\) \+ env\(safe-area-inset-bottom,0px\)\);/);
    assert.match(s.CSS, /min-height:44px/);
    // Scoped to this tab, so it never changes another tab's look.
    for (const rule of s.CSS.split("\n")) {
      if (rule.startsWith("@media")) assert.ok(!/\}[^}#]*\{/.test(rule.replace(/#tab-settings[^{]*\{/g, "")), rule);
      else assert.match(rule, /^#tab-settings /, rule);
    }
    assert.doesNotMatch(HTML + SRC, /FundHub|FUNDHUB|Fund Hub/);
  });
});
