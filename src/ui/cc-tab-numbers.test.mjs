// The Command Center's Numbers tab (Ads · Angles · Funnels): its own rules.
//
// public/app/cc-tab-numbers.js puts every rule that turns data into words on
// window.FundhubCCNumbers, so this file runs the real script in node:vm (the
// pattern src/ui/marketing-command-center.test.mjs uses) with no browser, no
// server and no database.
//
// What it holds the tab to:
//   1. NEVER FAKE A NUMBER. null prints "unknown", never $0 or 0%.
//   2. ONE RULE PER NUMBER. The two step rates the page divides itself, and the
//      cost per lead on the Angles view, use metrics.mjs's rule exactly; the
//      Arizona day is ad-account-day's.
//   3. THE TAB READS ONLY KEYS THE CONTRACT SENDS (src/marketing/api-contract.mjs).
//   4. UI LAW in the stylesheet: no font sizes, 8px spacing, no --spectrum shadow.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { CONTRACT, exampleResponse, assertMatchesContract, assertRequestMatchesContract } from "../marketing/api-contract.mjs";
import { closeRate, ctr, cpl, roas as metricRoas } from "../marketing/metrics.mjs";
import { adAccountDay } from "../lib/ad-account-day.mjs";
import { FORMATS as STORE_FORMATS } from "../marketing/settings-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "cc-tab-numbers.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "cc-tab-numbers.css"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  return ctx;
}

const G = load();
const N = G.FundhubCCNumbers;

/* Arrays made inside the vm carry the vm's Array prototype, which deepEqual
   treats as a different type. Copy out through JSON before comparing. */
const plain = (v) => JSON.parse(JSON.stringify(v));

describe("the tab plugs into the frame (docs/specs/command-center-tabs.md)", () => {
  test("it queues exactly one tab, id numbers, order 7, with render/refresh/hide", () => {
    const q = G.FundhubCC._q;
    assert.equal(q.length, 1);
    const t = q[0];
    assert.equal(t.id, "numbers");
    assert.equal(t.label, "Numbers");
    assert.equal(t.order, 7);
    for (const fn of ["render", "refresh", "hide"]) assert.equal(typeof t[fn], "function", fn);
  });

  test("a frame that loaded first gets the tab through its real registerTab", () => {
    const seen = [];
    const ctx = createContext({ console, FundhubCC: { registerTab: (t) => seen.push(t.id) } });
    runInContext(SRC, ctx);
    assert.deepEqual(seen, ["numbers"]);
  });

  test("the three views are Ads, Angles and Funnels, in that order; no Map view is drawn before it exists", () => {
    assert.deepEqual(plain(N.VIEWS), [["ads", "Ads"], ["angles", "Angles"], ["funnels", "Funnels"]]);
  });

  test("the URL picks the view and the drawer: #numbers/ads/91", () => {
    assert.deepEqual(plain(N.parseParam("ads/91")), { view: "ads", n: "91" });
    assert.deepEqual(plain(N.parseParam("angles")), { view: "angles", n: null });
    assert.deepEqual(plain(N.parseParam("funnels/9")), { view: "funnels", n: null });
    assert.deepEqual(plain(N.parseParam("map")), { view: null, n: null });
    assert.deepEqual(plain(N.parseParam("ads/9x")), { view: "ads", n: null });
    assert.deepEqual(plain(N.parseParam(undefined)), { view: null, n: null });
  });
});

describe("never fake a number", () => {
  test("money: cents to dollars, null is unknown, a real 0 is $0.00", () => {
    assert.equal(N.money(156313), "$1,563.13");
    assert.equal(N.money(0), "$0.00");
    assert.equal(N.money("41200"), "$412.00");
    for (const v of [null, undefined, "", "abc", -5, NaN]) assert.equal(N.money(v), "unknown", String(v));
  });

  test("counts and rates: null is unknown, never 0 or 0%", () => {
    assert.equal(N.count(1210), "1,210");
    assert.equal(N.count(0), "0");
    assert.equal(N.count(null), "unknown");
    assert.equal(N.pct(0.1843), "18.4%");
    assert.equal(N.pct(0.82), "82%");
    assert.equal(N.pct(0.0124), "1.2%");
    assert.equal(N.pct(0), "0%");
    assert.equal(N.pct(1.25), "125%", "Meta restates counts; a rate above 1 prints as sent");
    assert.equal(N.pct(null), "unknown");
    assert.equal(N.roas(1.43), "1.43x");
    assert.equal(N.roas(0), "0.00x");
    assert.equal(N.roas(null), "unknown");
  });

  test("every Ads column prints unknown for null", () => {
    for (const c of N.AD_COLUMNS) assert.equal(N.cell(c.kind, null), "unknown", c.key);
  });
});

describe("one rule per number (the page's own divisions match metrics.mjs)", () => {
  const CASES = [
    [3, 9], [0, 9], [9, 0], [null, 9], [9, null], [2, 3], [1, 7], ["4", "15"], [10, 4], [0, 0]
  ];

  test("rate() is metrics.mjs fraction(): rounded to 4 places, null on unknown or a 0 bottom", () => {
    for (const [top, bottom] of CASES) {
      assert.equal(N.rate(top, bottom), closeRate({ sales: top, showed: bottom }), `${top}/${bottom}`);
      assert.equal(N.rate(top, bottom), ctr({ link_clicks: top, impressions: bottom }), `${top}/${bottom}`);
    }
  });

  test("centsPer() is metrics.mjs centsPer() (cost per lead)", () => {
    for (const [cents, n] of [[41200, 9], [11150, 0], [null, 4], [100, null], [1, 3], [2, 3]]) {
      assert.equal(N.centsPer(cents, n), cpl({ spend_cents: cents, leads: n }), `${cents}/${n}`);
    }
  });

  test("the server's ROAS is printed, not recomputed (a known example stays equal)", () => {
    assert.equal(N.roas(metricRoas({ cash_cents: 58800, spend_cents: 41200 })), "1.43x");
  });

  test("azToday() is ad-account-day's Arizona day, all year (no daylight saving)", () => {
    const stamps = [
      "2026-01-01T06:59:59Z", "2026-01-01T07:00:00Z", "2026-03-08T09:30:00Z", "2026-06-30T06:59:00Z",
      "2026-07-01T07:00:01Z", "2026-11-01T08:00:00Z", "2026-12-31T23:59:59Z", "2026-10-06T03:00:00Z"
    ];
    for (const s of stamps) {
      const ms = Date.parse(s);
      assert.equal(N.azToday(ms), adAccountDay(new Date(ms)), s);
    }
  });
});

describe("the Ads view's window and filters", () => {
  const NOW = Date.parse("2026-10-06T15:00:00Z"); // 8 am in Arizona, Oct 6

  test("presets end today in Arizona and include both ends", () => {
    assert.deepEqual(plain(N.windowFor({ win: "30" }, NOW)), { from: "2026-09-07", to: "2026-10-06", note: null });
    assert.deepEqual(plain(N.windowFor({ win: "7" }, NOW)), { from: "2026-09-30", to: "2026-10-06", note: null });
    assert.deepEqual(plain(N.windowFor({}, NOW)), { from: "2026-09-07", to: "2026-10-06", note: null });
  });

  test("an Arizona evening is still today in Arizona, not tomorrow's UTC day", () => {
    const evening = Date.parse("2026-10-07T05:30:00Z"); // 10:30 pm Oct 6 in Arizona
    assert.equal(N.windowFor({ win: "7" }, evening).to, "2026-10-06");
  });

  test("picked days pass through; a backwards or half-picked range falls back to 30 days and says why", () => {
    assert.deepEqual(plain(N.windowFor({ win: "pick", from: "2026-08-04", to: "2026-10-04" }, NOW)),
      { from: "2026-08-04", to: "2026-10-04", note: null });
    const back = N.windowFor({ win: "pick", from: "2026-10-04", to: "2026-08-04" }, NOW);
    assert.equal(back.from, "2026-09-07");
    assert.match(back.note, /first day is after the last day/);
    const half = N.windowFor({ win: "pick", from: "", to: "2026-10-01" }, NOW);
    assert.match(half.note, /Pick both days/);
    assert.equal(N.windowFor({ win: "pick", from: "2026-09-01", to: "" }, NOW).to, "2026-10-06");
  });

  test("the request carries from, to and only the filters that are set", () => {
    assert.equal(N.adsPath({ win: "30" }, NOW), "marketing/ads?from=2026-09-07&to=2026-10-06");
    assert.equal(
      N.adsPath({ win: "7", funnel: "roadmap_147", format: "standard", angle: "the_conveyor_belt" }, NOW),
      "marketing/ads?from=2026-09-30&to=2026-10-06&funnel=roadmap_147&format=standard&angle=the_conveyor_belt"
    );
    assert.match(N.adsPath({ win: "30", angle: "a&b" }, NOW), /angle=a%26b$/);
  });

  test("every request key the tab sends is one the contract takes", () => {
    const keys = new URLSearchParams(N.adsPath({ win: "7", funnel: "f", format: "notes", angle: "a" }, NOW).split("?")[1]);
    assertRequestMatchesContract("GET marketing/ads", Object.fromEntries(keys));
  });

  test("the format filter lists exactly the formats the settings store knows", () => {
    assert.deepEqual(plain(N.FORMATS.map((f) => f[0])), [...STORE_FORMATS]);
  });

  test("filtersOn: the default 30 days with nothing else is not a filter", () => {
    assert.equal(N.filtersOn({ win: "30" }), false);
    assert.equal(N.filtersOn({ win: "7" }), true);
    assert.equal(N.filtersOn({ win: "30", funnel: "x" }), true);
  });
});

describe("sorting the Ads table", () => {
  const rows = [
    { ad_number: "84", spend_cents: 5000, leads: 2 },
    { ad_number: "86", spend_cents: null, leads: 0 },
    { ad_number: "89", spend_cents: 15000, leads: null },
    { ad_number: "90", spend_cents: 5000, leads: 1 }
  ];

  test("biggest spend first; unknown spend last; ties by ad number", () => {
    assert.deepEqual(N.sortRows(rows, "spend_cents", "desc").map((r) => r.ad_number), ["89", "84", "90", "86"]);
  });

  test("smallest first still keeps unknown last", () => {
    assert.deepEqual(N.sortRows(rows, "spend_cents", "asc").map((r) => r.ad_number), ["84", "90", "89", "86"]);
    assert.deepEqual(N.sortRows(rows, "leads", "asc").map((r) => r.ad_number), ["86", "90", "84", "89"]);
  });

  test("ad number sorts as a number, and an unknown key falls back to spend", () => {
    const r = [{ ad_number: "100" }, { ad_number: "9" }, { ad_number: "91" }];
    assert.deepEqual(N.sortRows(r, "ad_number", "asc").map((x) => x.ad_number), ["9", "91", "100"]);
    assert.deepEqual(N.sortRows(rows, "nope", "desc").map((x) => x.ad_number), ["89", "84", "90", "86"]);
  });

  test("tapping a header: same column flips, a new column starts biggest first", () => {
    assert.deepEqual(plain(N.nextSort({ key: "spend_cents", dir: "desc" }, "spend_cents")), { key: "spend_cents", dir: "asc" });
    assert.deepEqual(plain(N.nextSort({ key: "spend_cents", dir: "asc" }, "leads")), { key: "leads", dir: "desc" });
    assert.deepEqual(plain(N.nextSort({ key: "leads", dir: "desc" }, "ad_number")), { key: "ad_number", dir: "asc" });
  });
});

describe("the watch curve (drawn by hand, Meta's own buckets)", () => {
  const AD = exampleResponse("GET marketing/ad").ad;
  const CURVE = AD.curve[0].video_play_curve;

  test("22 bucket names, Meta's: seconds 0-14, then 5- and 10-second spans, then over 60", () => {
    assert.equal(N.CURVE_BUCKETS.length, 22);
    assert.equal(N.CURVE_BUCKETS[2], "2 s");
    assert.equal(N.CURVE_BUCKETS[15], "15 to 20 s");
    assert.equal(N.CURVE_BUCKETS[21], "over 60 s");
  });

  test("the model draws every point in a 0..100 box and reads second 2 off the curve", () => {
    const m = N.curveModel(CURVE);
    const pts = m.line.split(" ");
    assert.equal(pts.length, CURVE.length);
    assert.equal(pts[0], "0.00,0.00", "100% at second 0 is the top-left corner");
    assert.equal(pts[pts.length - 1], "100.00,96.00");
    assert.equal(m.at2, 47);
    assert.equal(N.twoSecondNote(m), "At 2 seconds, 47% of plays were still watching (from the curve).");
    assert.deepEqual(plain(m.ticks.map((t) => t.label)), ["0s", "5s", "10s", "15s", "30s", "60s+"]);
    assert.equal(m.rows[15].bucket, "15 to 20 s");
    assert.ok(m.area.startsWith("0.00,100 ") && m.area.endsWith(" 100.00,100"));
  });

  test("a missing curve is null (the drawer says Meta sent none), never a flat line", () => {
    for (const v of [null, undefined, [], [5], "not json", [null, null]]) assert.equal(N.curveModel(v), null, String(v));
    assert.equal(N.twoSecondNote(null), "Meta sent no 2-second point on this curve.");
  });

  test("a curve stored as a JSON string is read; a value over 100 is drawn at the top and printed as sent", () => {
    const m = N.curveModel(JSON.stringify([104, 60, 40]));
    assert.equal(m.line.split(" ")[0], "0.00,0.00");
    assert.equal(m.rows[0].value, 104);
  });

  test("two Meta ads with one number keep two curves; the drawer opens on the newest day with a curve", () => {
    const ad = {
      meta_ads: [{ id: "a1" }, { id: "a2" }],
      curve: [
        { date: "2026-10-01", ad_id: "a1", video_play_curve: [100, 50, 30] },
        { date: "2026-10-01", ad_id: "a2", video_play_curve: [100, 40, 20] },
        { date: "2026-10-02", ad_id: "a1", video_play_curve: null }
      ]
    };
    const ch = N.curveChoices(ad);
    assert.deepEqual(plain(ch.map((c) => c.label)), ["Oct 2 · Meta ad 1", "Oct 1 · Meta ad 1", "Oct 1 · Meta ad 2"]);
    assert.equal(ch[0].points, null);
    assert.equal(N.defaultChoice(ch), "0", "skips Oct 2, which has no curve");
  });

  test("one Meta ad: the day alone names the choice", () => {
    const ch = N.curveChoices(AD);
    assert.equal(ch.length, 1);
    assert.equal(ch[0].label, "Oct 10");
  });
});

describe("the watch diagnosis, in plain words", () => {
  test("each diagnosis and fix type has words; the film note is printed as written", () => {
    const d = N.diagnosisWords({ date: "2026-10-10", diagnosis: "opening", fix_type: "words", film_note: "Film a new first line. Keep the body.", next_take_improved: null });
    assert.deepEqual(plain(d), {
      day: "Oct 10", what: "The opening loses them.", fix: "Change the words.",
      note: "Film a new first line. Keep the body.", next: "Next take: not scored yet."
    });
    assert.equal(N.diagnosisWords({ diagnosis: "middle", fix_type: "visual" }).what, "The middle loses them.");
    assert.equal(N.diagnosisWords({ diagnosis: "ask", fix_type: "both" }).fix, "Change what they see and the words.");
    assert.equal(N.diagnosisWords({ diagnosis: "ask", next_take_improved: true }).next, "Next take: it did better.");
    assert.equal(N.diagnosisWords({ diagnosis: "ask", next_take_improved: false }).next, "Next take: it did not do better.");
    assert.equal(N.diagnosisWords(null), null);
  });

  test("an alert names the day the buzz went out, in Meta's quarter-of-the-video words", () => {
    assert.match(N.alertWords({ dies_before_25_alerted_on: "2026-10-02" }), /^Buzz sent Oct 2: most plays stopped before a quarter of the video/);
    assert.equal(N.alertWords({ dies_before_25_alerted_on: null }), null);
  });

  test("no 3-second number on the screen (Meta has no such field; watch-curve law)", () => {
    for (const c of N.AD_COLUMNS) {
      assert.doesNotMatch(`${c.label} ${c.tip}`, /\b3[- ]?s(ec(ond)?s?)?\b|three[- ]second/i, c.key);
    }
    assert.doesNotMatch(SRC, /3_sec|three_sec|video_3s/i);
  });

  test("Meta ad status in words", () => {
    assert.equal(N.statusWord("ACTIVE"), "Running");
    assert.equal(N.statusWord("PAUSED"), "Paused");
    assert.equal(N.statusWord("CAMPAIGN_PAUSED"), "Campaign paused");
    assert.equal(N.statusWord(null), "Status unknown");
  });
});

describe("the Funnels view: ad -> page -> lead -> call -> sale", () => {
  const ROW = exampleResponse("GET marketing/funnels/stats").rows[0];

  test("five steps with the server's two rates and the two the page divides", () => {
    const s = N.funnelSteps(ROW);
    assert.deepEqual(plain(s.map((x) => [x.label, x.value, x.rateLabel, x.rate])), [
      ["Page views", "1,210", "Click to page", 0.82],
      ["Leads", "15", "Page to lead", 0.0124],
      ["Booked calls", "4", "Lead to call", 0.2667],
      ["Showed", "3", null, null],
      ["Sales", "0", "Call to sale", 0]
    ]);
  });

  test("lead to call and call to sale are unknown when the bottom is 0 or unknown", () => {
    const s = N.funnelSteps({ leads: 0, booked: 0, showed: 0, sales: 0, page_views: null, click_to_page: null, page_to_lead: null });
    assert.equal(s[0].value, "unknown");
    assert.equal(s[0].rate, null);
    assert.equal(s[2].rate, null);
    assert.equal(s[4].rate, null);
  });
});

describe("Make more of this (POST marketing/ideas)", () => {
  test("the idea starts from the angle's name and Chris can change it", () => {
    assert.equal(N.ideaText({ angle_key: "the_conveyor_belt", name: "The Conveyor Belt" }),
      "Make more ads on the angle \"The Conveyor Belt\". Same idea, new hooks.");
    assert.equal(N.angleName({ angle_key: "the_conveyor_belt" }), "the_conveyor_belt");
  });

  test("the body is U26's shape: request_id, trimmed words, source chris, and the angle key", () => {
    const b = plain(N.ideaBody({ angle_key: "the_conveyor_belt" }, "  More like this.  ", "00000000-0000-4000-8000-000000000001"));
    assert.deepEqual(b, {
      request_id: "00000000-0000-4000-8000-000000000001",
      raw_points: "More like this.",
      angle_key: "the_conveyor_belt",
      source: "chris"
    });
    assertRequestMatchesContract("POST marketing/ideas", b);
  });

  test("an angle key the ideas store would refuse stays in the words only, so the save never fails on it", () => {
    const b = plain(N.ideaBody({ angle_key: "two-files", name: "Lenders read two files" }, "x", "r"));
    assert.equal("angle_key" in b, false);
  });
});

describe("answers back in plain words, never a status code", () => {
  test("each failure has a sentence with no number in it", () => {
    for (const status of [0, 400, 401, 403, 404, 500, 502, 503]) {
      const s = N.errorSentence("The ad numbers", { status, data: null });
      assert.doesNotMatch(s, /\d{3}/, `${status}: ${s}`);
      assert.ok(s.endsWith("."), s);
      const t = N.saveErrorSentence({ status, data: null });
      assert.doesNotMatch(t, /\d{3}/, `${status}: ${t}`);
    }
  });

  test("a 400 prints the server's own plain message", () => {
    assert.equal(N.errorSentence("The ad numbers", { status: 400, data: { message: "Pick a from day on or before the to day." } }),
      "Pick a from day on or before the to day.");
  });

  test("the as-of line: the last Meta pull, or never pulled", () => {
    assert.equal(N.asOfLine(null, () => "x"), "Meta numbers: never pulled yet.");
    assert.equal(N.asOfLine("2026-10-06T07:01:00Z", () => "Oct 6, 12:01 AM"), "Meta numbers pulled Oct 6, 12:01 AM Arizona time.");
  });

  test("esc() makes server words safe to draw", () => {
    assert.equal(N.esc("<b>\"Tom & Jerry's\"</b>"), "&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;");
    assert.equal(N.esc(null), "");
  });
});

describe("the tab reads only what the contract sends", () => {
  const keysOf = (route) => new Set(CONTRACT[route].responseKeys);

  test("every Ads column is a row key of GET marketing/ads and of the drawer's GET marketing/ad", () => {
    const ads = keysOf("GET marketing/ads");
    const ad = keysOf("GET marketing/ad");
    for (const c of N.AD_COLUMNS) {
      assert.ok(ads.has(`rows[].${c.key}`), c.key);
      assert.ok(ad.has(`ad.${c.key}`), c.key);
    }
  });

  test("the funnel steps read only GET marketing/funnels/stats row keys", () => {
    const fs2 = keysOf("GET marketing/funnels/stats");
    for (const k of ["page_views", "click_to_page", "page_to_lead", "leads", "booked", "showed", "sales", "spend_cents", "cash_cents", "roas", "name"]) {
      assert.ok(fs2.has(`rows[].${k}`), k);
    }
    assert.ok(fs2.has("unmapped_spend_cents"));
  });

  test("the angle cards read only GET marketing/angles row keys", () => {
    const an = keysOf("GET marketing/angles");
    for (const k of ["angle_key", "name", "spend_cents", "ads", "leads", "booked", "sales", "cash_cents", "roas"]) {
      assert.ok(an.has(`rows[].${k}`), k);
    }
  });

  test("the contract examples the e2e mocks use are themselves valid", () => {
    for (const r of ["GET marketing/ads", "GET marketing/ad", "GET marketing/angles", "GET marketing/funnels/stats", "POST marketing/ideas"]) {
      assertMatchesContract(r, exampleResponse(r));
    }
  });

  test("the metric names are docs/marketing/metrics.md's", () => {
    const doc = fs.readFileSync(path.resolve(HERE, "../../docs/marketing/metrics.md"), "utf8");
    for (const name of ["CTR", "Hook rate", "25% hold", "Thruplay rate", "Leads", "Booked calls", "Showed", "Cash", "Reported cash", "ROAS"]) {
      assert.ok(N.AD_COLUMNS.some((c) => c.label === name), name);
      assert.ok(doc.includes(name), `${name} is in metrics.md`);
    }
  });
});

describe("UI law in the stylesheet (docs/rules/UI-STANDARDS.md)", () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  test("no font sizes: the brand file throws them away inside the shell (§12.7)", () => {
    assert.doesNotMatch(body, /font-size\s*:/);
    assert.doesNotMatch(body, /\bfont\s*:\s*(?!inherit)/, "the font shorthand sets a size too");
    assert.doesNotMatch(SRC, /font-size/);
  });

  test("spacing is on the 8px scale (§2)", () => {
    const bad = [];
    for (const m of body.matchAll(/\b(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:\s*([^;}]+)/g)) {
      for (const v of m[3].matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        if (![0, 8, 16, 24, 32, 48, 64].includes(Math.abs(Number(v[1])))) bad.push(m[0]);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("no shadow, outline or border takes --spectrum (§12.6)", () => {
    assert.doesNotMatch(body, /(box-shadow|outline|border[a-z-]*|text-shadow)\s*:[^;]*--spectrum/);
  });

  test("the drawer clears the fixed status strip and the phone's home bar", () => {
    assert.match(body, /bottom:calc\(var\(--fh-statusbar,0px\) \+ env\(safe-area-inset-bottom,0px\)\)/);
  });

  test("no chart library: the curve is an SVG polyline the tab draws itself", () => {
    assert.match(SRC, /<polyline class="ccn-line"/);
    assert.doesNotMatch(SRC, /\b(Chart|d3|echarts|Plotly|ApexCharts)\b\s*[.(]/);
    assert.doesNotMatch(SRC, /<canvas|<text[\s>]/);
  });
});
