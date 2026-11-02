// Batch 17 practice tests: the closer's client deck (public/app/present.html, present.js, contract-send.js,
// data.js). 24 controls. The real scripts run whole in a vm against a stand-in page and fake answers, a
// button is pressed or a key is struck, and the test reads what the page painted and what it asked the
// clipboard and the server to do. No browser, no network, no database, nothing sent.
//
// Two of the rows (the scripts are served, and wired) are also judged live by the closer desk lane
// (src/pulse/coverage/gap-closer.mjs, check closer:desk-pages): this file feeds that lane the real files
// from public/app and shows the real files are what the lane's words expect.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { offersForClient } from "../../../config/offers.mjs";
import { ROLE_SETS } from "../../../http/read-api.mjs";
import { PAGES, closerDeskPageReport } from "../../coverage/gap-closer.mjs";
import { proofRows } from "./fin-b17-kit.mjs";
import {
  BELIEFS, CATALOG_PHASE_ROWS, DECK_LENGTH, OBJECTION_SLIDES, OBJECTION_TABLE, PHASE_BUTTONS, REPAIR_RUN, positionOf,
} from "./fin-b17-present-data.mjs";

const proof = proofRows(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP = path.join(ROOT, "public/app");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");
const PRESENT_JS = read("present.js");
// The course is off until it is filmed (COURSE_LIVE in present.js). The education route is judged on the same
// file with the one switch turned on, which is the promise the switch makes: on, everything comes back.
const COURSE_OFF = "var COURSE_LIVE = false;";
assert.ok(PRESENT_JS.includes(COURSE_OFF), "present.js lost its one course switch");
const PRESENT_JS_COURSE = PRESENT_JS.replace(COURSE_OFF, "var COURSE_LIVE = true;");
const SEND_JS = read("contract-send.js");
const DATA_JS = read("data.js");
const PRESENT_HTML = read("present.html");
const OFFERS = offersForClient();
const CONTACT = "33333333-3333-3333-3333-333333333333";
const SAMPLE_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const SURFACE = "present.html (+ present.js, contract-send.js)";

const MAIN_RUN = [...Array(22)].map((_, i) => `S-${String(i + 1).padStart(2, "0")}`).concat(["S-23", "S-24"]);
const STACK_RUN = ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"];
const VISUAL_NAMES = ["yourPath", "fileFindings", "moneyLevers", "proofWall", "companies", "blueprintDemo", "journey"];

function payload({ tier = "FULL_FUNDING", negItems = 3, available = true, businesses = [], softPull = undefined, visual = undefined } = {}) {
  return {
    client_id: CONTACT,
    survey: { name: "Sam Sample" },
    businesses,
    income_estimates: {},
    engine: {
      available, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 },
      total: available ? 20000 : null, afterFix: available ? 60000 : null,
      negItems: available ? negItems : null, reasons: [], plan: [],
      totalBasis: available ? "personal_only" : null, sample: false,
      ...(visual === undefined ? {} : { visual }),
    },
    soft_pull: softPull === undefined ? { consent_valid: true, diagnostic_paid: true, pull_status: "complete", crs_result_id: "unit-proof-result", sample: false } : softPull,
    offers: OFFERS,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * present.js, contract-send.js and data.js against a stand-in page. Every server answer and clipboard
 * write is recorded. The page's elements are rebuilt on every paint, as the real DOM is.
 */
async function openDeck(tier = "FULL_FUNDING", {
  search = `?contact=${CONTACT}`, role = "owner", deck = null, readAnswer = null, writeAnswer = null, data = null, httpStatus = null,
  course = false, visuals = null,
} = {}) {
  let html = "";
  let version = 0;
  const root = { get innerHTML() { return html; }, set innerHTML(value) { html = String(value); version += 1; } };
  const elements = new Map();
  const reads = [];
  const writes = [];
  const copied = [];
  let onClick = null;
  let onKey = null;
  const sandbox = {
    console, URLSearchParams, Promise, Date,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout,
    location: { search, pathname: "/app/present.html" },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    document: {
      readyState: "complete",
      getElementById: (id) => {
        if (id === "app") return root;
        if (!html.includes(`id="${id}"`)) return null;
        const key = `${version}:${id}`;
        if (!elements.has(key)) {
          const tag = new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`).exec(html)[0];
          const value = /value="([^"]*)"/.exec(tag);
          elements.set(key, {
            id, tagName: "INPUT", value: value ? decode(value[1]) : "", checked: /\schecked[\s>]/.test(tag),
            listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
          });
        }
        return elements.get(key);
      },
      querySelectorAll: () => [],
      addEventListener: (type, fn) => { if (type === "click") onClick = fn; },
    },
    localStorage: { getItem: (k) => (k === "fh_role" ? role : null) },
    // httpStatus: the REAL data.js runs, over a fetch that answers with this status. Nothing stands in for
    // the step that turns a 401 or 403 into the one word the page branches on.
    ...(httpStatus ? { fetch: async (path) => { reads.push({ what: String(path), query: null }); return { status: httpStatus, json: async () => ({ ok: false, error: "forbidden" }) }; } } : {}),
    FHData: httpStatus ? undefined : {
      read: async (what, query) => {
        reads.push({ what, query });
        if (readAnswer) return readAnswer(what, query);
        if (what === "agent-context") return { ok: true, data: { context: { client: { id: CONTACT }, as_prompt_block: "Saved client file" } } };
        return { ok: true, data: deck || data || payload({ tier, visual: visuals ? { source: "sample" } : undefined }) };
      },
      write: async (url, body) => {
        writes.push({ url, body });
        if (writeAnswer) return writeAnswer(url, body);
        return { ok: true, data: {} };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { if (type === "keydown") onKey = fn; };
  // visuals: stand-ins for the three visual files (section 10.8). true draws all five; an object maps a name
  // to its own function. Every call and the ctx it was given are recorded.
  const visualCalls = [];
  if (visuals) {
    const fns = visuals === true ? Object.fromEntries(VISUAL_NAMES.map((n) => [n, () => `<div data-fhv="${n}">${n} drawn</div>`])) : visuals;
    sandbox.FHDeckVisuals = Object.fromEntries(Object.entries(fns).map(([name, fn]) => [name, (ctx) => { visualCalls.push({ name, ctx }); return fn(ctx); }]));
  }
  vm.createContext(sandbox);
  if (httpStatus) vm.runInContext(DATA_JS, sandbox, { filename: "data.js" });
  vm.runInContext(SEND_JS, sandbox, { filename: "contract-send.js" });
  vm.runInContext(course ? PRESENT_JS_COURSE : PRESENT_JS, sandbox, { filename: "present.js" });
  await flush();
  await flush();
  const out = {
    reads, writes, copied, visualCalls,
    html: () => html,
    text: () => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    client: () => (html.indexOf('<div class="cockpit">') < 0 ? html : html.slice(0, html.indexOf('<div class="cockpit">'))),
    cockpit: () => (html.indexOf('<div class="cockpit">') < 0 ? "" : html.slice(html.indexOf('<div class="cockpit">'))),
    cockpitText: () => decode(out.cockpit().replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    slide() {
      const m = /<div class="slide-hd"><span class="mono">([A-Z]-\d\d) \/ /.exec(html);
      return m ? m[1] : null;
    },
    /** the three (or more) lines the cockpit says out loud, as words */
    says: () => [...out.cockpit().matchAll(/<div class="say">([\s\S]*?)<\/div>/g)].map((m) => decode(m[1])),
    /** what the cockpit header and the phase strip say about where the deck is */
    facts() {
      const h = /<div class="ck-hd">[\s\S]*?<span class="mono"[^>]*>([^<]*)<\/span><span class="mono">([^<]*)<\/span>/.exec(html);
      const lit = [...html.matchAll(/<button[^>]*data-act="phase:(\d\d)"[^>]*background:var\(--ink\)/g)].map((m) => m[1]);
      return { code: out.slide(), phase: h ? decode(h[1]) : null, position: h ? h[2] : null, lit };
    },
    has: (act) => html.includes(`data-act="${act}"`),
    /** the whole <button ...>label</button> for an action, or null */
    button(act) {
      const escaped = act.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`<button[^>]*data-act="${escaped}"[^>]*>[\\s\\S]*?</button>`).exec(html);
      if (!m) return null;
      const open = m[0].slice(0, m[0].indexOf(">") + 1);
      return { tag: m[0], label: decode(m[0].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(), disabled: /\sdisabled(\s|>)/.test(open) };
    },
    label: (act) => out.button(act)?.label ?? null,
    disabled: (act) => out.button(act)?.disabled ?? null,
    /** a person pressing a button that is on the screen and not disabled */
    press(act) {
      const b = out.button(act);
      assert.ok(b, `there is no "${act}" button on ${out.slide()}`);
      assert.equal(b.disabled, false, `"${act}" is disabled on ${out.slide()}`);
      onClick({ target: { closest: () => ({ getAttribute: () => act }) } });
      return out;
    },
    /** a click handler call for an action no button shows right now (a stray click on a repainted button) */
    force(act) { onClick({ target: { closest: () => ({ getAttribute: () => act }) } }); return out; },
    key(k, target = {}) { onKey({ key: k, target }); return out; },
    el: (id) => sandbox.document.getElementById(id),
    type(id, value) {
      const el = out.el(id);
      assert.ok(el, `there is no #${id} on ${out.slide()}`);
      el.value = value;
      el.listeners.input({ target: el });
      return out;
    },
    async settle(times = 6) { for (let i = 0; i < times; i += 1) await flush(); },
    walk(times, act = "next") { const seen = [out.slide()]; for (let i = 0; i < times; i += 1) { out.press(act); seen.push(out.slide()); } return seen; },
  };
  return out;
}

/** The deck at the first slide of a phase, by the phase strip. */
async function deckAt(phase, tier = "FULL_FUNDING", opts = {}) {
  const deck = await openDeck(tier, opts);
  deck.press(`phase:${phase}`);
  return deck;
}

/** Every slide this file can reach, by real presses, with all five visuals drawing (so L-01 and C-01 are in the
 *  walk): Next from the first slide to the last, then the Blueprint slides the walk steps over through their own
 *  doors, then B-05 and B-06 by their buttons. What each one says about where it is. */
async function walkAllSlides(tier = "FULL_FUNDING") {
  const deck = await openDeck(tier, { visuals: true });
  const note = () => seen.push({ ...deck.facts(), objections: deck.has("obj:0") });
  const seen = [];
  note();
  while (!deck.disabled("next")) { deck.press("next"); note(); }
  if (!seen.some((x) => x.code === "B-01")) {
    // a funding file steps over the Blueprint: its door is the stack button, then Next walks B-01 to B-04
    deck.force("stack-open");
    note();
    for (let i = 0; i < 3; i += 1) { deck.press("next"); note(); }
  } else {
    deck.force("stack-go:B-04");
  }
  deck.press("stack-go:B-05");
  note();
  deck.press("stack-go:B-06");
  note();
  return seen;
}

// ───────────────────────────── Back and Next, arrows ─────────────────────────────

test("Back and Next walk the deck, the arrow keys do the same, and a funding file steps over the Blueprint section", async () => {
  await proof.check(/^Back and Next screen buttons, ArrowLeft and ArrowRight keys/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    assert.equal(deck.slide(), "S-01");
    assert.equal(deck.label("back"), "Back");
    assert.equal(deck.label("next"), "Next screen");
    assert.equal(deck.disabled("back"), true, "nothing comes before the first slide");
    assert.equal(deck.disabled("next"), false);

    deck.press("next");
    assert.equal(deck.slide(), "S-02");
    assert.equal(deck.disabled("back"), false);
    deck.press("back");
    assert.equal(deck.slide(), "S-01");

    // the arrow keys are the same two buttons
    deck.key("ArrowRight");
    assert.equal(deck.slide(), "S-02");
    deck.key("ArrowLeft");
    assert.equal(deck.slide(), "S-01");
    deck.key("ArrowDown").key("Enter").key(" ").key("ArrowUp");
    assert.equal(deck.slide(), "S-01", "no other key moves the deck");

    // a person typing in a box or choosing in a list never moves the deck
    deck.key("ArrowRight", { tagName: "INPUT" });
    deck.key("ArrowRight", { tagName: "SELECT" });
    assert.equal(deck.slide(), "S-01");
    deck.key("ArrowRight", { tagName: "DIV" });
    assert.equal(deck.slide(), "S-02");

    // the whole run, one press at a time: S-01 .. S-24 (the six Blueprint slides sit between S-08 and S-09, and the
    // two visual slides show only when their visual draws)
    deck.press("back");
    assert.equal(deck.slide(), "S-01");
    assert.deepEqual(deck.walk(MAIN_RUN.length - 1), MAIN_RUN);
    assert.equal(deck.slide(), "S-24");
    assert.equal(deck.disabled("next"), true, "nothing comes after the last slide");
    deck.key("ArrowRight");
    assert.equal(deck.slide(), "S-24");

    // and back the same way
    const seen = [deck.slide()];
    while (!deck.disabled("back")) { deck.press("back"); seen.push(deck.slide()); }
    assert.deepEqual(seen, [...MAIN_RUN].reverse());
    assert.equal(deck.slide(), "S-01");
    assert.deepEqual(deck.writes, [], "moving through the deck saves nothing");
  });

  await proof.check(/^Back and Next screen buttons, ArrowLeft and ArrowRight keys/, async () => {
    // A repair file walks Door 3, B-01 to B-04, inside part 6, then Door 4 from S-09. B-05 and B-06 stay out.
    const deck = await openDeck("REPAIR_ONLY");
    const forward = deck.walk(REPAIR_RUN.length - 1);
    assert.deepEqual(forward, REPAIR_RUN);
    assert.deepEqual(forward.slice(forward.indexOf("S-08"), forward.indexOf("S-08") + 6), ["S-08", "B-01", "B-02", "B-03", "B-04", "S-09"]);
    const backward = [deck.slide()];
    while (!deck.disabled("back")) { deck.press("back"); backward.push(deck.slide()); }
    assert.deepEqual(backward, [...REPAIR_RUN].reverse());
    // Inside the section Next and Back walk B-01 to B-04 and leave at its ends; B-05 and B-06 only by their buttons.
    deck.press("phase:06");
    assert.equal(deck.slide(), "B-01");
    assert.deepEqual(deck.walk(3), ["B-01", "B-02", "B-03", "B-04"]);
    deck.press("next");
    assert.equal(deck.slide(), "S-09", "B-04 leads on to S-09, Door 4");
    deck.press("back");
    assert.equal(deck.slide(), "B-04", "and back into the Blueprint, not B-06");
    deck.press("phase:06").press("back");
    assert.equal(deck.slide(), "S-08", "B-01 leads back to S-08");
    // a funding file that is inside the section walks it the same way, and still steps over it from outside
    const funding = await openDeck("FULL_FUNDING");
    funding.force("stack-open");
    assert.equal(funding.slide(), "B-01");
    assert.deepEqual(funding.walk(4), ["B-01", "B-02", "B-03", "B-04", "S-09"]);
    funding.press("back");
    assert.equal(funding.slide(), "S-08", "from outside, Back steps over the six again");
    // B-05 and B-06 walk each other once a button has opened them
    funding.force("stack-go:B-05");
    assert.deepEqual(funding.walk(2), ["B-05", "B-06", "S-09"]);
    funding.press("back");
    assert.equal(funding.slide(), "S-08");
  });

  await proof.check(/^Back and Next screen buttons, ArrowLeft and ArrowRight keys/, async () => {
    // The education route skips S-11 .. S-16 in both directions. The course is off (COURSE_LIVE), so this runs
    // the same file with the switch on.
    const deck = await openDeck("REPAIR_ONLY", { course: true });
    deck.press("phase:03");
    assert.equal(deck.slide(), "S-05");
    deck.press("next").press("next");
    assert.equal(deck.slide(), "S-07");
    deck.press("edu");
    deck.press("phase:05");
    assert.equal(deck.slide(), "S-08");
    assert.deepEqual(deck.walk(4), ["S-08", "S-09", "S-10", "S-17", "S-18"]);
    deck.press("back").press("back");
    assert.equal(deck.slide(), "S-10");
    // a funding file with no education route still runs S-10 -> S-11
    const funding = await openDeck("FULL_FUNDING");
    funding.press("phase:05");
    assert.deepEqual(funding.walk(4), ["S-08", "S-09", "S-10", "S-11", "S-12"]);
  });
});

// ───────────────────────────── Client screen only ─────────────────────────────

test("Client screen only hides the cockpit, Show cockpit brings it back, and the slide stays put", async () => {
  await proof.check(/^Client screen only \/ Show cockpit toggle/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.press("next");
    assert.equal(deck.slide(), "S-02");
    assert.equal(deck.label("client-only"), "Client screen only");
    assert.ok(deck.html().includes('<div class="cockpit">'));
    assert.ok(deck.html().includes('<div class="client">'));
    assert.ok(deck.html().includes('data-act="next"'));

    deck.press("client-only");
    assert.equal(deck.label("client-only"), "Show cockpit");
    assert.ok(!deck.html().includes('<div class="cockpit">'), "the cockpit is gone, so a screen share shows the client slide alone");
    assert.ok(!deck.html().includes('data-act="next"'), "and so are its buttons");
    assert.ok(deck.html().includes('<div class="client solo">'));
    assert.equal(deck.slide(), "S-02", "the client slide did not change");
    assert.ok(deck.client().includes("S-02"), "the client slide still renders while the cockpit is hidden");

    // the arrow keys still walk the deck with the cockpit hidden
    deck.key("ArrowRight");
    assert.equal(deck.slide(), "S-03");
    assert.equal(deck.label("client-only"), "Show cockpit", "it stays hidden until it is asked back");

    deck.press("client-only");
    assert.equal(deck.label("client-only"), "Client screen only");
    assert.ok(deck.html().includes('<div class="cockpit">'));
    assert.ok(deck.html().includes('<div class="client">'));
    assert.equal(deck.slide(), "S-03");
    assert.deepEqual(deck.writes, [], "hiding the cockpit sends nothing");
  });

  await proof.check(/^Client screen only \/ Show cockpit toggle/, async () => {
    // what was typed and ticked before the toggle is still there after it, and goes out with the disposition
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:02");
    deck.type("fh-cost", "$4,500 a month").press("check:Pain").press("check:Trust");
    deck.press("client-only").press("client-only");
    assert.equal(deck.el("fh-cost").value, "$4,500 a month");
    assert.ok(/background:var\(--ink\)"><\/span>/.test(deck.html().slice(deck.html().indexOf('data-act="check:Pain"')).split("</button>")[0]), "Pain is still ticked");
    deck.press("phase:09").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.cost_of_inaction, "$4,500 a month");
    assert.equal(deck.writes.at(-1).body.beliefs_count, 2);
  });
});

// ───────────────────────────── the scripts are served, and wired ─────────────────────────────

test("contract-send.js and data.js are loaded by the page, define what the deck calls, and the closer desk lane serves them", async () => {
  await proof.check(/^contract-send\.js and data\.js are served/, async () => {
    // 1. the page loads both, data.js before the deck needs it and contract-send.js before present.js
    const tags = [...PRESENT_HTML.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    assert.ok(tags.includes("data.js"), "present.html does not load data.js");
    assert.ok(tags.includes("contract-send.js"), "present.html does not load contract-send.js");
    assert.ok(tags.indexOf("contract-send.js") < tags.indexOf("present.js"), "contract-send.js loads after present.js");
    for (const file of ["data.js", "contract-send.js"]) {
      assert.ok(fs.existsSync(path.join(APP, file)), `public/app/${file} is not in the site`);
      assert.ok(read(file).length > 500, `${file} is empty`);
    }

    // 2. each file defines the one global the deck calls, with the members it calls
    const win = { localStorage: { getItem: () => null }, fetch: async () => ({ status: 200, json: async () => ({}) }), console };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(DATA_JS, win, { filename: "data.js" });
    vm.runInContext(SEND_JS, win, { filename: "contract-send.js" });
    assert.equal(typeof win.FHData?.read, "function", "data.js defines no FHData.read");
    assert.equal(typeof win.FHData?.write, "function", "data.js defines no FHData.write");
    for (const member of ["listWordings", "pickTemplate", "sendToClient", "copyText"]) {
      assert.equal(typeof win.FHContractSend?.[member], "function", `contract-send.js defines no FHContractSend.${member}`);
      assert.ok(PRESENT_JS.includes(`FHContractSend.${member}(`), `present.js no longer calls FHContractSend.${member}`);
    }
    assert.ok(PRESENT_JS.includes('FHData.read("closer-deck"'));

    // 3. the closer desk lane's live GET reads the real files and finds them right
    const served = {
      "/app/closer-dashboard.html": read("closer-dashboard.html"),
      "/app/present.html": PRESENT_HTML,
      "/app/present.js": PRESENT_JS,
      "/app/contract-send.js": SEND_JS,
      "/app/data.js": DATA_JS,
    };
    const fetchImpl = async (url) => {
      const body = served[new URL(url).pathname];
      return body === undefined ? { status: 404, text: async () => "" } : { status: 200, text: async () => body };
    };
    const report = await closerDeskPageReport({ fetchImpl, baseUrl: "https://fundhub.ai" });
    assert.deepEqual(report.wrong, []);
    assert.deepEqual(report.down, []);
    assert.equal(report.read, PAGES.length);
    const names = PAGES.map((p) => p.path);
    assert.ok(names.includes("/app/contract-send.js") && names.includes("/app/data.js"), "the lane does not read both scripts");
    for (const gone of ["/app/contract-send.js", "/app/data.js"]) {
      const missing = await closerDeskPageReport({ fetchImpl: async (url) => (new URL(url).pathname === gone ? { status: 404, text: async () => "" } : fetchImpl(url)), baseUrl: "https://fundhub.ai" });
      assert.equal(missing.wrong.length, 1, `${gone} missing must be a failure`);
      assert.match(missing.wrong[0], /so Present cannot (send a contract|read or save anything)/);
    }
  });
});

test("present.js is served, posts log_disposition to /api/closer-deck, and the closer desk lane reads it", async () => {
  await proof.check(/^present\.js is served and wired/, async () => {
    const page = PAGES.find((p) => p.path === "/app/present.js");
    assert.ok(page, "the closer desk lane has no row for present.js");
    // the lane's own words, run over the real file
    for (const [re, why] of page.must) assert.match(PRESENT_JS, re, `present.js ${why}`);
    assert.ok(PRESENT_HTML.includes('src="present.js"'));

    // wired: the Log disposition button posts log_disposition to /api/closer-deck with the client on the link
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:09");
    assert.equal(deck.slide(), "S-23");
    deck.press("disp");
    await deck.settle();
    assert.equal(deck.writes.length, 1);
    assert.equal(deck.writes[0].url, "/api/closer-deck");
    assert.equal(deck.writes[0].body.action, "log_disposition");
    assert.equal(deck.writes[0].body.client_id, CONTACT);
    assert.ok(deck.text().includes("Disposition written to contact record."));

    // a script that no longer posts it fails the lane's words
    const broken = PRESENT_JS.replaceAll("log_disposition", "log_done");
    assert.doesNotMatch(broken, page.must[0][0]);
  });
});

// ───────────────────────────── Discovery: cost of inaction, beliefs ─────────────────────────────

test("the cost of inaction box is on Discovery, keeps what is typed, says it back on the math slide, and rides the disposition", async () => {
  await proof.check(/^Discovery: 'Their monthly cost of inaction' text box/, async () => {
    const deck = await openDeck("REPAIR_ONLY");
    assert.ok(!deck.html().includes('id="fh-cost"'), "no box on the intro");
    deck.press("phase:02");
    assert.equal(deck.slide(), "S-03");
    assert.ok(deck.html().includes('id="fh-cost"'));
    assert.ok(deck.cockpitText().includes("Their monthly cost of inaction"));
    assert.equal(deck.el("fh-cost").value, "");

    deck.type("fh-cost", "$4,500 a month");
    deck.press("next");
    assert.equal(deck.slide(), "S-04");
    assert.equal(deck.el("fh-cost").value, "$4,500 a month", "what was typed is still there on the next Discovery slide");
    let stopped = false;
    deck.el("fh-cost").listeners.keydown({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, "a key struck in the box does not reach the deck's arrow keys");
    deck.press("next");
    assert.equal(deck.slide(), "S-05");
    assert.ok(!deck.html().includes('id="fh-cost"'), "the box belongs to Discovery only");

    // the repair math slide says the number back, and a year of it
    deck.press("phase:07");
    deck.walk(3);
    assert.equal(deck.slide(), "S-20");
    assert.ok(deck.client().includes("$4,500 a month."));
    assert.ok(deck.text().includes("$54,000"));

    // and it leaves the page as cost_of_inaction on the disposition
    deck.press("phase:09").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.cost_of_inaction, "$4,500 a month");

    const blank = await openDeck("REPAIR_ONLY");
    blank.press("phase:09").press("disp");
    await blank.settle();
    assert.equal(blank.writes.at(-1).body.cost_of_inaction, null, "nothing typed, nothing sent");
  });
});

test("the seven belief boxes tick and untick, are counted, and the count rides the disposition", async () => {
  await proof.check(/^Discovery: 7 belief checkboxes/, async () => {
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:02");
    const KEYS = ["Pain", "Desire", "Doubt", "Cost", "Support", "Money", "Trust"];
    const order = [...deck.html().matchAll(/data-act="check:([A-Za-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, KEYS, "seven boxes, in this order");
    assert.ok(deck.cockpitText().includes("7 beliefs"));
    const on = (key) => /background:var\(--ink\)"><\/span>/.test(deck.html().slice(deck.html().indexOf(`data-act="check:${key}"`)).split("</button>")[0]);
    for (const key of KEYS) assert.equal(on(key), false, `${key} starts unticked`);

    deck.press("check:Pain").press("check:Trust");
    assert.equal(on("Pain"), true);
    assert.equal(on("Trust"), true);
    assert.equal(on("Doubt"), false);
    deck.press("check:Pain");
    assert.equal(on("Pain"), false, "pressing it again unticks it");
    deck.press("check:Money");

    // the count shows on the engine line of the next phase, and goes out with the disposition
    deck.press("phase:03");
    assert.ok(deck.cockpitText().includes("beliefs 2/7"), deck.cockpitText());
    deck.press("phase:09").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.beliefs_count, 2);
    deck.press("phase:02");
    assert.equal(on("Trust"), true, "the ticks are kept across the deck");
    assert.equal(on("Money"), true);
  });

  await proof.check(/^Discovery: 7 belief checkboxes/, async () => {
    // the question under each box, word for word, and the ticks are kept by Next and Back themselves
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:02");
    const questions = [...deck.html().matchAll(/data-act="check:([A-Za-z]+)"[^>]*>[\s\S]*?<span style="display:block[^>]*>([^<]*)<\/span>/g)].map((m) => [m[1], decode(m[2])]);
    assert.deepEqual(questions, BELIEFS.map(([word, question]) => [word, question]));
    const on = (key) => /background:var\(--ink\)"><\/span>/.test(deck.html().slice(deck.html().indexOf(`data-act="check:${key}"`)).split("</button>")[0]);
    deck.press("check:Doubt").press("check:Support");
    assert.equal(deck.slide(), "S-03");
    deck.press("next");
    assert.equal(deck.slide(), "S-04");
    assert.equal(on("Doubt"), true, "Next keeps the ticks");
    assert.equal(on("Support"), true);
    deck.press("back");
    assert.equal(deck.slide(), "S-03");
    assert.equal(on("Doubt"), true, "Back keeps the ticks");
    assert.equal(on("Support"), true);
    assert.equal(on("Pain"), false);
    deck.press("next").press("next");
    assert.ok(deck.cockpitText().includes("beliefs 2/7"), "and they are still counted two slides on");
  });
});

// ───────────────────────────── the two walls and the error wall links ─────────────────────────────

const LOGIN_NEXT = `/login.html?next=${encodeURIComponent(`/app/present.html?contact=${CONTACT}`)}`;
const linkOf = (deck, label) => {
  const m = new RegExp(`<a href="([^"]*)">${label}</a>`).exec(deck.html());
  return m ? decode(m[1]) : null;
};

test("the error wall links go back to the Closer Dashboard on this client, and to sign in only when the account was refused", async () => {
  await proof.check(/^Error wall links: 'Back to Closer Dashboard' and 'Sign in as someone else'/, async () => {
    // refused account: both links
    const refused = await openDeck("FULL_FUNDING", { readAnswer: async () => ({ ok: false, source: "unauthorized", error: "not signed in" }) });
    assert.equal(linkOf(refused, "Back to Closer Dashboard"), `closer-dashboard.html?client_id=${CONTACT}`);
    assert.equal(linkOf(refused, "Sign in as someone else"), LOGIN_NEXT);

    // any other failed read: the way back only
    const failed = await openDeck("FULL_FUNDING", { readAnswer: async () => ({ ok: false, source: "server", error: { message: "The deck could not be built." } }) });
    assert.ok(failed.text().includes("The deck could not be built."));
    assert.equal(linkOf(failed, "Back to Closer Dashboard"), `closer-dashboard.html?client_id=${CONTACT}`);
    assert.equal(linkOf(failed, "Sign in as someone else"), null);

    // no client on the link: the way back carries no client
    const none = await openDeck("FULL_FUNDING", { search: "" });
    assert.equal(linkOf(none, "Back to Closer Dashboard"), "closer-dashboard.html");
    assert.equal(linkOf(none, "Sign in as someone else"), null);
  });
});

test("the two walls say what is wrong in words, read nothing without a client, and draw no deck", async () => {
  await proof.check(/^Two walls: no client on the link/, async () => {
    const none = await openDeck("FULL_FUNDING", { search: "" });
    assert.ok(none.text().includes("Pick a client first. Open a call on the Closer Dashboard, then press Present."));
    assert.deepEqual(none.reads, [], "no client, no read");
    assert.equal(none.has("next"), false);
    assert.equal(none.slide(), null);

    // the link may name the client four ways
    for (const name of ["contact", "client_id", "id", "client"]) {
      const named = await openDeck("FULL_FUNDING", { search: `?${name}=${CONTACT}` });
      assert.deepEqual(JSON.parse(JSON.stringify(named.reads.map((r) => [r.what, r.query]))), [
        ["closer-deck", { contact: CONTACT }], ["agent-context", { client_id: CONTACT }]
      ], `?${name}= reads the same scoped client only after the deck is admitted`);
      assert.equal(named.slide(), "S-01");
    }

    const refused = await openDeck("FULL_FUNDING", { readAnswer: async () => ({ ok: false, source: "unauthorized", error: "not signed in" }) });
    assert.ok(refused.text().includes("This account cannot open the client deck. Ask an owner for access, or sign in with a closer account."));
    assert.equal(refused.reads.length, 1);
    assert.equal(refused.has("next"), false);
    assert.equal(refused.slide(), null);
    assert.deepEqual(refused.writes, []);
  });

  await proof.check(/^Two walls: no client on the link/, async () => {
    // the refused-account wall from the HTTP status up: the real data.js turns 401 and 403 into the one word
    // the page branches on, and any other failure is not the wall
    for (const status of [401, 403]) {
      const refused = await openDeck("FULL_FUNDING", { httpStatus: status });
      assert.ok(refused.text().includes("This account cannot open the client deck. Ask an owner for access, or sign in with a closer account."), `status ${status}`);
      assert.equal(linkOf(refused, "Sign in as someone else"), LOGIN_NEXT);
      assert.equal(refused.has("next"), false);
      assert.equal(refused.slide(), null);
    }
    const broken = await openDeck("FULL_FUNDING", { httpStatus: 500 });
    assert.ok(!broken.text().includes("This account cannot open the client deck"));
    assert.equal(linkOf(broken, "Sign in as someone else"), null);
    assert.ok(broken.text().includes("Something went wrong. Try again in a moment."));
    const ok = await openDeck("FULL_FUNDING", { httpStatus: 200 });
    assert.equal(ok.slide(), null, "a 200 with no deck in it is not a deck either");
  });
});

// ───────────────────────────── objections and reframes ─────────────────────────────

const OBJECTIONS = OBJECTION_TABLE.map((o) => [o.title, o.jumpLabel, o.target, o.lines[1]]);

test("the six objection buttons open their words, Back closes them, and the jump button goes to the slide that answers it", async () => {
  await proof.check(/^Objections: 6 buttons/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:02");
    assert.equal(deck.has("obj:0"), false, "objections wait for the ask");
    deck.press("phase:07");
    assert.equal(deck.slide(), "S-17");
    const labels = [...deck.html().matchAll(/<button[^>]*data-act="obj:(\d)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(labels, OBJECTIONS.map((o, i) => [String(i), o[0]]));
    assert.ok(deck.text().includes("Descent ladder"));

    for (const [i, [title, jumpLabel, target, line]] of OBJECTIONS.entries()) {
      deck.press(`obj:${i}`);
      assert.ok(deck.cockpitText().includes(`Objection Back ${title}`), `${title} header: ${deck.cockpitText().slice(0, 120)}`);
      assert.equal((deck.cockpit().match(/<div class="say">/g) || []).length, 3, `${title} gives three lines to say`);
      assert.ok(deck.cockpitText().includes(line), `${title}: ${line}`);
      assert.deepEqual(deck.says(), OBJECTION_TABLE[i].lines, `${title}: all three lines, word for word`);
      assert.equal(deck.label(`obj-jump:${target}`), jumpLabel, `${title} jump button`);
      assert.equal(deck.has("obj-back"), true);
      assert.equal(deck.has("obj:0"), false, "the objection panel replaces the list");
      assert.equal(deck.slide(), "S-17", "opening an objection does not move the client's screen");

      deck.press("obj-back");
      assert.equal(deck.has("obj:0"), true, `${title}: Back returns to the list`);
      assert.equal(deck.has("obj-back"), false);

      deck.press(`obj:${i}`).press(`obj-jump:${target}`);
      assert.equal(deck.slide(), target, `${title} jumps to ${target}`);
      assert.equal(deck.has("obj-back"), false, "the jump closes the objection");
      deck.press("phase:07");
    }

    // moving the deck with Next closes an open objection too
    deck.press("obj:1").press("next");
    assert.equal(deck.has("obj-back"), false);
    assert.deepEqual(deck.writes, []);
  });

  await proof.check(/^Objections: 6 buttons/, async () => {
    // the list is on every slide of 7 The ask AND of 9 Paperwork (where the ask is made), and on no other slide
    for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
      const seen = await walkAllSlides(tier);
      assert.equal(seen.length, tier === "FULL_FUNDING" ? 34 : 32, `${tier}: every slide it can reach (P-01 and C-01 are funding only)`);
      for (const slide of seen) {
        assert.equal(slide.objections, OBJECTION_SLIDES.includes(slide.code), `${tier} ${slide.code}: objection buttons ${OBJECTION_SLIDES.includes(slide.code) ? "belong" : "do not belong"} here`);
      }
    }
    // and it works on the close: open one, say its lines, jump, and Back
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:09");
    assert.equal(deck.slide(), "S-23");
    for (const [i, o] of OBJECTION_TABLE.entries()) {
      deck.press(`obj:${i}`);
      assert.deepEqual(deck.says(), o.lines, `S-23 / ${o.title}`);
      assert.equal(deck.label(`obj-jump:${o.target}`), o.jumpLabel);
      deck.press("obj-back");
      assert.equal(deck.has("obj:0"), true);
    }
    deck.press("obj:1").press("obj-jump:S-20");
    assert.equal(deck.slide(), "S-20");
    deck.press("next").press("next").press("next");
    assert.equal(deck.slide(), "S-23");
    assert.equal(deck.has("obj:5"), true);
  });
});

test("Reframing patterns opens the five reframes and Back closes them", async () => {
  await proof.check(/^Reframing patterns button and Back/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:07");
    assert.equal(deck.label("reframes"), "Reframes");
    assert.ok(!deck.cockpitText().includes("Reframing patterns"));
    deck.press("reframes");
    assert.ok(deck.cockpitText().includes("Reframing patterns"));
    for (const [name, words] of [
      ["Truth Hammer", "You just told me [X], now you're saying [Y]. What's really going on?"],
      ["Simple Decision", "Do you want to keep [pain] or do you want [outcome]?"],
      ["Circumstance vs Vision", "Decisions from current circumstances, or from your vision?"],
      ["Cost Reframe", "Too much compared to what? Compared to [Amount] and finally [goal]?"],
      ["Risk Reframe", "Riskier: $3K into a plan built from your own file, or the same spot in 6 months?"],
    ]) {
      assert.ok(deck.cockpitText().includes(`${name} ${words}`), name);
    }
    assert.equal(deck.has("obj:0"), false, "the reframes replace the objection list");
    assert.equal(deck.slide(), "S-17", "the client's screen does not move");
    deck.press("ref-back");
    assert.ok(!deck.cockpitText().includes("Reframing patterns"));
    assert.equal(deck.has("obj:0"), true);
    assert.equal(deck.label("reframes"), "Reframes");

    // an open reframe list closes when the deck moves
    deck.press("reframes").press("next");
    assert.equal(deck.has("ref-back"), false);
    assert.deepEqual(deck.writes, []);
  });
});

// ───────────────────────────── S-18, their number ─────────────────────────────

test("S-18 shows the ten number buttons, marks the one pressed, warns under 8, and sends the number with the disposition", async () => {
  await proof.check(/^S-18 'Their number' 1 to 10 buttons/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:07").press("next");
    assert.equal(deck.slide(), "S-18");
    const buttons = [...deck.html().matchAll(/<button[^>]*data-act="temp:(\d+)"[^>]*>(\d+)<\/button>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(buttons, [...Array(10)].map((_, i) => [String(i + 1), String(i + 1)]));
    const marked = () => [...deck.html().matchAll(/<button[^>]*data-act="temp:(\d+)"[^>]*background:var\(--ink\)/g)].map((m) => m[1]);
    assert.deepEqual(marked(), [], "no number is marked before one is pressed");
    assert.ok(!deck.cockpitText().includes("Below 8."));

    deck.press("temp:6");
    assert.deepEqual(marked(), ["6"]);
    assert.ok(deck.cockpitText().includes("Below 8. Ask: what's keeping you from a 9 or 10? Handle it before the investment."));
    assert.ok(deck.cockpitText().includes("temp 6/10"));
    deck.press("temp:8");
    assert.deepEqual(marked(), ["8"], "one number at a time");
    assert.ok(!deck.cockpitText().includes("Below 8."), "8 and over proceeds");
    deck.press("temp:7");
    assert.ok(deck.cockpitText().includes("Below 8."), "7 is below 8");
    deck.press("temp:1");
    assert.ok(deck.cockpitText().includes("Below 8."), "1 is below 8");
    deck.press("temp:10");
    assert.deepEqual(marked(), ["10"]);

    deck.press("next");
    assert.equal(deck.slide(), "S-19");
    assert.equal(deck.has("temp:1"), false, "the buttons belong to S-18");
    deck.press("phase:09").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.temperature, 10);

    const fresh = await openDeck("FULL_FUNDING");
    fresh.press("phase:09").press("disp");
    await fresh.settle();
    assert.equal(fresh.writes.at(-1).body.temperature, 0, "no number pressed sends 0");
  });
});

// ───────────────────────────── the phase strip ─────────────────────────────

// The strip follows the call script's parts (section 10.0, row 19). The first slide a button opens is the first
// one of its part that this file walks: part 6 opens Door 1 (S-09) on a funding file and Door 3 (B-01) on a repair
// file. 08, Money, has no slide and is judged on its own below.
const PHASES = [
  ["01", "1 Open", { FULL_FUNDING: "S-01", REPAIR_ONLY: "S-01" }],
  ["02", "2 Your goal", { FULL_FUNDING: "S-03", REPAIR_ONLY: "S-03" }],
  ["03", "3 The pull", { FULL_FUNDING: "S-05", REPAIR_ONLY: "S-05" }],
  ["04", "4 Your file", { FULL_FUNDING: "S-07", REPAIR_ONLY: "S-07" }],
  ["05", "5 Your path", { FULL_FUNDING: "S-08", REPAIR_ONLY: "S-08" }],
  ["06", "6 The plan", { FULL_FUNDING: "S-09", REPAIR_ONLY: "B-01" }],
  ["07", "7 The ask", { FULL_FUNDING: "S-17", REPAIR_ONLY: "S-17" }],
  ["09", "9 Paperwork", { FULL_FUNDING: "S-23", REPAIR_ONLY: "S-23" }],
];
const stripOf = (deck) => [...deck.html().matchAll(/<button[^>]*data-act="phase:(\d\d)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
const litOf = (deck) => [...deck.html().matchAll(/<button[^>]*data-act="phase:(\d\d)"[^>]*background:var\(--ink\)/g)].map((m) => m[1]);

for (const [p, phaseName, first] of PHASES) {
  test(`phase strip button ${p} (${phaseName}) jumps to the first slide of its part, names it, and lights only itself`, async () => {
    const run = async () => {
      for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
        const deck = await openDeck(tier);
        // the strip is on every slide: nine buttons, with the script's part names
        assert.deepEqual(stripOf(deck), PHASE_BUTTONS.map(([n, name]) => [n, name]));
        // start somewhere else so the jump is seen to move
        deck.press(p === "07" ? "phase:03" : "phase:07");
        assert.notEqual(deck.slide(), first[tier]);
        deck.press(`phase:${p}`);
        assert.equal(deck.slide(), first[tier], `${tier}: phase ${p} opens on ${first[tier]}`);
        assert.ok(deck.cockpitText().startsWith(phaseName), `${tier}: the cockpit names the phase "${phaseName}": ${deck.cockpitText().slice(0, 40)}`);
        assert.deepEqual(litOf(deck), [p], `${tier}: only phase ${p} is lit`);
        // pressing it again stays on its first slide
        deck.press(`phase:${p}`);
        assert.equal(deck.slide(), first[tier]);
        assert.deepEqual(deck.writes, []);
      }
      // every slide of the phase says so, in its own header and on the strip: not just the first one
      const [, , slides] = PHASE_BUTTONS.find(([n]) => n === p);
      for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
        const seen = await walkAllSlides(tier);
        for (const code of slides) {
          const slide = seen.find((x) => x.code === code);
          if ((tier === "REPAIR_ONLY" && (code === "P-01" || code === "C-01")) || code === "F-02") {
            assert.equal(slide, undefined, `${tier}: ${code} has no loaded visual in this walk`);
            continue;
          }
          assert.ok(slide, `${tier}: ${code} was reached`);
          assert.equal(slide.phase, phaseName, `${tier}: ${code} names its phase`);
          assert.deepEqual(slide.lit, [p], `${tier}: ${code} lights only ${p}`);
          assert.equal(slide.position, `${positionOf(code) - (tier === "REPAIR_ONLY" && positionOf(code) > positionOf("P-01") ? 1 : 0)} / ${tier === "REPAIR_ONLY" ? DECK_LENGTH - 1 : DECK_LENGTH}`, `${tier}: ${code} is in its place in the deck`);
        }
        for (const slide of seen.filter((x) => !slides.includes(x.code))) {
          assert.notEqual(slide.phase, phaseName, `${tier}: ${slide.code} is not part of ${phaseName}`);
          assert.ok(!slide.lit.includes(p), `${tier}: ${slide.code} does not light ${p}`);
        }
      }
      // the strip button is a jump, not a step: it works from the far end of the deck too
      for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
        const late = await openDeck(tier);
        late.press("phase:09").press("next");
        assert.equal(late.slide(), "S-24");
        late.press(`phase:${p}`);
        assert.equal(late.slide(), first[tier]);
        if (p === "06" && tier === "REPAIR_ONLY") {
          assert.equal(late.label("stack-leave"), "Leave the stack: back to S-24", "the strip opens the Blueprint and remembers the way back");
        }
      }
    };
    // The catalog lists the seven buttons the strip had before 2026-10-29, by number (CATALOG_PHASE_ROWS).
    if (CATALOG_PHASE_ROWS.includes(p)) await proof.check(new RegExp(`^Phase strip button ${p}:`), run);
    else await run();
  });
}

test("phase strip button 08 (8 Money) opens the money steps in the cockpit and leaves the client's slide where it is", async () => {
  const MONEY_LINES = [
    "Money aside, is this the right plan for your file?",
    "So this is not about whether. It's about how to make it work. Right?",
    "Is money the only thing? Nothing else in the way?",
    "Can we talk openly about money? Then I'll find the right way in.",
    "What do you have that you can use today?",
  ];
  for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
    const deck = await openDeck(tier);
    deck.press("phase:07").press("next");
    assert.equal(deck.slide(), "S-18");
    const screen = deck.client();
    deck.press("phase:08");
    assert.equal(deck.slide(), "S-18", "Money has no slide");
    assert.equal(deck.client(), screen, "the client's screen does not move");
    assert.ok(deck.cockpitText().startsWith("8 Money"), deck.cockpitText().slice(0, 40));
    assert.deepEqual(litOf(deck), ["08"]);
    assert.deepEqual(deck.says(), MONEY_LINES, "script section 8: lock the plan before money");
    assert.ok(deck.cockpitText().includes("Lock the plan before you talk money."));
    deck.press("phase:08");
    assert.equal(deck.slide(), "S-18", "pressing it again stays put");
    deck.press("money-back");
    assert.ok(deck.cockpitText().startsWith("7 The ask"), "Back closes the money steps");
    assert.deepEqual(litOf(deck), ["07"]);
    assert.equal(deck.has("money-back"), false);
    // the money steps lead to paperwork, where the pay link goes out
    deck.press("phase:08");
    assert.equal(deck.label("money-pay"), "Go to paperwork: agreement and pay link");
    deck.press("money-pay");
    assert.equal(deck.slide(), "S-23");
    assert.ok(deck.cockpitText().startsWith("9 Paperwork"));
    // moving the deck closes them
    deck.press("phase:08").press("next");
    assert.equal(deck.slide(), "S-24");
    assert.equal(deck.has("money-back"), false);
    assert.deepEqual(deck.writes, [], "the money steps save and send nothing");
  }
});

test("phase 06 runs a funding file through Door 1, S-09 to S-16, and a repair file through Door 3 first; Next then enters 07", async () => {
  const deck = await openDeck("FULL_FUNDING");
  deck.press("phase:06");
  assert.deepEqual(deck.walk(8), ["S-09", "S-10", "S-11", "S-12", "S-13", "S-14", "S-15", "S-16", "S-17"]);
  assert.ok(deck.cockpitText().startsWith("7 The ask"));
  const repair = await openDeck("REPAIR_ONLY");
  repair.press("phase:06");
  assert.deepEqual(repair.walk(12), ["B-01", "B-02", "B-03", "B-04", "S-09", "S-10", "S-11", "S-12", "S-13", "S-14", "S-15", "S-16", "S-17"]);
  assert.ok(repair.cockpitText().startsWith("7 The ask"));
});

// ───────────────────────────── section 06: the stack ─────────────────────────────

test("Leave the stack says where it goes back to, and goes there", async () => {
  await proof.check(/^Section 06 'Leave the stack: back to <slide>'/, async () => {
    // opened from the Blueprint rung of S-19
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:07").walk(2);
    assert.equal(deck.slide(), "S-19");
    deck.press("rung:2");
    deck.press("stack-open");
    assert.equal(deck.slide(), "B-01");
    assert.equal(deck.label("stack-leave"), "Leave the stack: back to S-19");
    deck.press("next").press("next");
    assert.equal(deck.slide(), "B-03");
    assert.equal(deck.label("stack-leave"), "Leave the stack: back to S-19", "the way back is remembered while the rep walks the stack");
    deck.press("stack-leave");
    assert.equal(deck.slide(), "S-19");
    assert.equal(deck.has("stack-leave"), false);
    assert.equal(deck.has("stack-open"), true, "the rung is still the Blueprint rung");

    // opened from the phase strip on another slide (part 6 opens Door 3 on a repair file)
    const other = await openDeck("REPAIR_ONLY");
    other.press("phase:03");
    assert.equal(other.slide(), "S-05");
    other.press("phase:06");
    assert.equal(other.label("stack-leave"), "Leave the stack: back to S-05");
    // pressing the strip's 06 again from inside the stack does not make the stack its own way back
    other.press("next").press("phase:06");
    assert.equal(other.slide(), "B-01");
    assert.equal(other.label("stack-leave"), "Leave the stack: back to S-05");
    other.press("stack-leave");
    assert.equal(other.slide(), "S-05");

    // with no slide to go back to (a jump straight into the stack), it goes to S-08, the slide before the stack
    const direct = await openDeck("FULL_FUNDING");
    direct.force("stack-go:B-04");
    assert.equal(direct.slide(), "B-04");
    assert.equal(direct.label("stack-leave"), "Leave the stack");
    direct.press("stack-leave");
    assert.equal(direct.slide(), "S-08");

    // walking out the end forgets the way back
    const out = await openDeck("REPAIR_ONLY");
    out.press("phase:02").press("phase:06");
    assert.equal(out.label("stack-leave"), "Leave the stack: back to S-03");
    out.walk(4);
    assert.equal(out.slide(), "S-09");
    assert.equal(out.has("stack-leave"), false);
    assert.deepEqual(out.writes, []);
  });
});

test("Reset to this file appears only after a pick, and puts every toggle back where the file puts it", async () => {
  await proof.check(/^Section 06 'Reset to this file'/, async () => {
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:06").press("next");
    assert.equal(deck.slide(), "B-02");
    assert.equal(deck.has("stack-reset"), false, "nothing was picked, nothing to reset");
    const defaults = deck.cockpit();
    const state = (key) => /aria-pressed="(true|false)"/.exec(deck.html().slice(deck.html().indexOf(`data-act="stack:${key}"`)))[1];
    assert.equal(state("disputes"), "true", "3 negative items: dispute rounds start on");
    assert.equal(state("partner"), "false", "nobody is on the file as a partner: starts off");
    const shown = () => [...deck.client().matchAll(/data-stack="([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(shown().includes("disputes"));
    assert.ok(!shown().includes("partner"));

    deck.press("stack:disputes").press("stack:partner");
    assert.equal(state("disputes"), "false");
    assert.equal(state("partner"), "true");
    assert.ok(!shown().includes("disputes"), "the client's screen drops what was turned off");
    assert.ok(shown().includes("partner"), "and adds what was turned on");
    assert.equal(deck.label("stack-reset"), "Reset to this file");

    deck.press("stack-reset");
    assert.equal(state("disputes"), "true");
    assert.equal(state("partner"), "false");
    assert.equal(deck.has("stack-reset"), false, "no picks left, no button");
    assert.equal(deck.cockpit(), defaults, "the cockpit is exactly what it was before the first pick");
    assert.ok(shown().includes("disputes") && !shown().includes("partner"));
    assert.deepEqual(deck.writes, []);
  });
});

test("the 13 stack toggles start from the file, flip on a press, and redraw what the caller sees", async () => {
  await proof.check(/^Section 06 stack: 13 on\/off toggles/, async () => {
    const KEYS = ["disputes", "helper", "moneyhelper", "pull", "ready", "paydown", "financeos", "alerts", "partner", "banks", "declines", "vault", "nextseq"];
    const read = (deck) => Object.fromEntries([...deck.html().matchAll(/data-act="stack:([a-z]+)" aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2] === "true"]));

    // a repair-sorted file with 3 negative items and no company
    const repair = await openDeck("REPAIR_ONLY");
    repair.press("phase:06").press("next");
    assert.deepEqual(Object.keys(read(repair)), KEYS, "thirteen toggles, in this order");
    assert.deepEqual(read(repair), { disputes: true, helper: true, moneyhelper: true, pull: true, ready: true, paydown: true, financeos: true, alerts: true, partner: false, banks: true, declines: true, vault: true, nextseq: true });
    assert.ok(repair.cockpitText().includes("3 negative items on this file."));
    assert.ok(repair.cockpitText().includes("Not sorted to funding yet. This is how the file gets there."));
    assert.equal((repair.client().match(/data-stack="/g) || []).length, 12);

    // a funding-sorted clean file with a company on it: a funding file reaches the stack from the ask, by the
    // descent ladder's Capital Blueprint rung and S-19's stack button
    const clean = await openDeck("FULL_FUNDING", { deck: payload({ tier: "FULL_FUNDING", negItems: 0, businesses: [{ id: "biz-1", name: "Sample LLC", age_months: 40, incorporated_date: "2023-06-01" }] }) });
    clean.press("phase:07").press("desc:diy").press("stack-open").press("next");
    assert.equal(clean.slide(), "B-02");
    const defaults = read(clean);
    assert.equal(defaults.disputes, false);
    assert.equal(defaults.ready, false);
    assert.equal(defaults.vault, true);
    assert.ok(clean.cockpitText().includes("No negative items on this file. Nothing to dispute."));
    assert.ok(clean.cockpitText().includes("Sorted to funding today. The funding offer is the path, not a wait."));
    assert.ok(clean.cockpitText().includes("1 business on the file, so its papers go in too."));

    // every toggle flips on a press, says so in words, and flips back
    for (const key of KEYS) {
      const before = read(repair)[key];
      repair.press(`stack:${key}`);
      assert.equal(read(repair)[key], !before, `${key} flips`);
      const row = repair.html().slice(repair.html().indexOf(`data-act="stack:${key}"`)).split("</button>")[0];
      assert.ok(row.includes(`You turned this ${!before ? "on" : "off"}.`), `${key} says who turned it`);
      assert.ok(row.includes(`<span class="st">${!before ? "On" : "Off"}</span>`));
      assert.equal(repair.client().includes(`data-stack="${key}"`), !before, `${key} on the client's screen`);
      assert.deepEqual(Object.entries(read(repair)).filter(([k]) => k !== key).map(([, v]) => v), Object.entries({ disputes: true, helper: true, moneyhelper: true, pull: true, ready: true, paydown: true, financeos: true, alerts: true, partner: false, banks: true, declines: true, vault: true, nextseq: true }).filter(([k]) => k !== key).map(([, v]) => v), `${key} changes only itself`);
      repair.press(`stack:${key}`);
      assert.equal(read(repair)[key], before, `${key} flips back`);
      assert.equal(repair.has("stack-reset"), false, "a toggle put back where the file had it is no pick");
    }
    // an unknown key changes nothing
    const snapshot = repair.html();
    repair.force("stack:bogus");
    assert.equal(repair.html(), snapshot);

    // the price slide has the same toggles, and the included list follows them
    repair.press("stack:helper");
    repair.press("next").press("next");
    assert.equal(repair.slide(), "B-04");
    assert.equal(read(repair).helper, false);
    assert.ok(!repair.client().includes("Accountability helper"));
    assert.ok(repair.client().includes("Dispute rounds, with proof"));
    assert.deepEqual(repair.writes, []);
  });
});

test("the four move buttons on the price, FinanceOS and path-up slides go where they say", async () => {
  await proof.check(/^Section 06 move buttons/, async () => {
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:06");
    deck.press("next").press("next").press("next");
    assert.equal(deck.slide(), "B-04");
    assert.equal(deck.label("stack-go:B-05"), "Not ready: show FinanceOS");
    assert.equal(deck.has("stack-go:B-06"), false);
    assert.equal(deck.has("stack-go:B-04"), false, "no button leads to the slide already open");

    deck.press("stack-go:B-05");
    assert.equal(deck.slide(), "B-05");
    assert.equal(deck.label("stack-go:B-06"), "Ready later? Show the path up");
    assert.equal(deck.label("stack-go:B-04"), "Back to the Blueprint price");
    assert.equal(deck.has("stack-go:B-05"), false);

    deck.press("stack-go:B-06");
    assert.equal(deck.slide(), "B-06");
    assert.equal(deck.label("stack-go:B-04"), "Back to the Blueprint price");
    assert.equal(deck.label("stack-go:B-05"), "Back to FinanceOS");
    assert.equal(deck.has("stack-go:B-06"), false);

    deck.press("stack-go:B-05");
    assert.equal(deck.slide(), "B-05");
    deck.press("stack-go:B-04");
    assert.equal(deck.slide(), "B-04", "Back to the Blueprint price");
    assert.equal(deck.label("stack-leave"), "Leave the stack: back to S-01", "moving inside the stack keeps the way out");
    assert.deepEqual(deck.writes, []);
  });
});

test("the FinanceOS demo links are the sixteen tabs on the sample client, for owner, admin, sales manager and closer only", async () => {
  await proof.check(/^Section 06 FinanceOS demo links/, async () => {
    const TABS = [
      ["overview", "Overview"], ["next", "Next steps"], ["helper", "Money helper"], ["transfers", "Money moves"],
      ["plan", "Plan"], ["banks", "Banks"], ["strategy", "Strategy"], ["fundability", "Fundability"],
      ["declines", "Applications"], ["alerts", "Alerts"], ["vault", "Funding papers"],
      ["accounts", "Accounts"], ["credit", "Credit"], ["connections", "Connections"], ["payments", "Payments"], ["setup", "Setup"],
    ];
    const anchors = (deck) => [...deck.cockpit().matchAll(/<a class="ck-btn" href="([^"]*)" target="_blank" rel="noopener">([^<]*)<\/a>/g)].map((m) => [decode(m[1]), m[2]]);

    const owner = await openDeck("REPAIR_ONLY", { role: "owner" });
    owner.press("phase:06").press("next").press("next");
    assert.equal(owner.slide(), "B-03");
    assert.deepEqual(anchors(owner), TABS.map(([key, label]) => [`/app/financeos.html?client_id=${SAMPLE_CLIENT}#${key}`, label]));
    assert.ok(owner.cockpitText().includes("Each opens a new tab on the sample client. Test data, not a real person. Say so out loud."));
    // sixteen is every tab the FinanceOS page itself has
    const page = read("financeos.js");
    const block = page.slice(page.indexOf("var TABS = ["), page.indexOf("];", page.indexOf("var TABS = [")));
    assert.deepEqual([...block.matchAll(/\["([a-z]+)", "[^"]+"\]/g)].map((m) => m[1]), TABS.map(([key]) => key));
    // never a real client: the one id on every link is the sample client's, not the client on the call
    assert.ok(anchors(owner).every(([href]) => !href.includes(CONTACT)));

    // only the logins /api/money lets in see links
    const allowed = [...ROLE_SETS.FINANCE_OS].sort();
    assert.deepEqual(allowed, ["admin", "closer", "owner", "sales_manager"]);
    for (const role of ["owner", "admin", "sales_manager", "closer", "setter", "csm", "funding_advisor", "inquiry_specialist", "partner", "affiliate", "client", ""]) {
      const deck = await openDeck("REPAIR_ONLY", { role });
      deck.press("phase:06").press("next").press("next");
      if (allowed.includes(role)) {
        assert.equal(anchors(deck).length, 16, `${role} sees the links`);
      } else {
        assert.equal(anchors(deck).length, 0, `${role} sees no links`);
        assert.ok(deck.cockpitText().includes("This login cannot open FinanceOS for a client. Owner, admin, and sales manager logins can. Walk the tabs on their screen instead."), role);
      }
    }
  });
});

// ───────────────────────────── the soft pull panel ─────────────────────────────

test("the soft pull panel says consent, payment and pull status in words from what the server sent", async () => {
  await proof.check(/^Soft pull panel: consent \/ paid \/ pull-status lines/, async () => {
    const panel = (deck) => {
      const text = deck.cockpitText();
      const at = text.indexOf("Live soft pull");
      return at < 0 ? null : text.slice(at, text.indexOf("Send soft pull")).trim();
    };
    // nothing yet
    const none = await openDeck("FULL_FUNDING", { deck: payload({ softPull: null }) });
    none.press("phase:03");
    assert.equal(none.slide(), "S-05");
    assert.equal(panel(none), "Live soft pull consent: waiting paid $32: not yet pull: not started");

    // a finished pull from the stored result, paid, with consent
    const done = await openDeck("FULL_FUNDING", { deck: payload({ softPull: {
      consent_valid: true, diagnostic_paid: true, diagnostic_link_status: "paid", diagnostic_amount_cents: 3200,
      pull_status: "complete", pull_status_source: "crs_result", outcome_tier: "FULL_FUNDING",
    } }) });
    done.press("phase:03");
    assert.equal(panel(done), "Live soft pull consent: on file paid $32.00: yes pull: complete (from the stored result) tier: FULL_FUNDING");

    // a link sent and not paid, a request still waiting, a $1 live prove amount
    const waiting = await openDeck("FULL_FUNDING", { deck: payload({ softPull: {
      consent_valid: false, diagnostic_paid: false, diagnostic_link_status: "sent", diagnostic_amount_cents: 100,
      pull_status: "pending", pull_status_source: "soft_pull_request", outcome_tier: null,
    } }) });
    waiting.press("phase:03");
    assert.equal(panel(waiting), "Live soft pull consent: waiting paid $1.00: sent pull: pending");

    // the panel is on all three soft pull slides and nowhere else, and its button asks for the pull
    for (const [deck, label] of [[waiting, "S-05"]]) assert.equal(deck.slide(), label);
    waiting.press("next");
    assert.equal(waiting.slide(), "S-06");
    assert.ok(panel(waiting));
    waiting.press("next");
    assert.equal(waiting.slide(), "S-06", "Next holds until the real report is ready");
    waiting.press("phase:04");
    assert.equal(waiting.slide(), "S-07");
    assert.ok(panel(waiting));
    waiting.press("next");
    assert.equal(waiting.slide(), "S-06", "Next returns to live status until the real report is ready");
    assert.ok(panel(waiting));

    const ask = await openDeck("FULL_FUNDING");
    ask.press("phase:03");
    assert.equal(ask.label("softpull"), "Send soft pull ($32 + approval form)");
    ask.press("softpull");
    await ask.settle();
    assert.equal(ask.writes.length, 1);
    assert.equal(ask.writes[0].url, "/api/closer-deck");
    assert.equal(ask.writes[0].body.action, "send_soft_pull");
    assert.equal(ask.writes[0].body.client_id, CONTACT);
    assert.ok(ask.text().includes("Soft pull emailed — pay link + approval form."));
  });
});

// ───────────────────────────── the course switch (row 4) ─────────────────────────────

test("with the course off, no education button, rung, slide, course price or mini course line shows, and a stray click does nothing", async () => {
  const deck = await openDeck("REPAIR_ONLY");
  deck.press("phase:04");
  assert.equal(deck.slide(), "S-07");
  assert.equal(deck.has("edu"), false, "no EDUCATION PATH button");
  assert.ok(!deck.cockpitText().includes("Education is client-driven"));
  assert.ok(deck.cockpitText().includes("Education is off until Capital Academy is filmed."));
  deck.force("edu").force("desc:eduTop").force("desc:eduLow");
  assert.equal(deck.slide(), "S-07", "the course rungs do not move the deck");
  assert.ok(!deck.cockpitText().includes("route EDU"), "and no education route was set");
  deck.press("phase:07").walk(2);
  assert.equal(deck.slide(), "S-19");
  assert.equal(deck.has("desc:eduTop"), false);
  assert.equal(deck.has("desc:eduLow"), false);
  assert.ok(!deck.text().includes("Funding Mastery"), "no course price");
  assert.ok(!/mini course/i.test(deck.client()), "row 14: the mini course line is hidden");
  // the Blueprint wrap does not promise the course
  deck.press("phase:09").press("next");
  assert.equal(deck.slide(), "S-24");
  assert.ok(!deck.says().some((l) => /how-to course/.test(l)), deck.says().join(" | "));
  assert.deepEqual(deck.writes, []);
});

test("with the one switch on, the education button, rungs, slides, prices and mini course line all come back", async () => {
  const deck = await openDeck("REPAIR_ONLY", { course: true });
  deck.press("phase:04");
  assert.equal(deck.label("edu"), "EDUCATION PATH");
  assert.ok(deck.cockpitText().includes("Education is client-driven"));
  assert.ok(!deck.cockpitText().includes("Education is off until Capital Academy is filmed."));
  deck.press("edu").press("phase:05");
  assert.equal(deck.slide(), "S-08");
  assert.ok(deck.client().includes("Two ways to own this skill."));
  deck.press("phase:07").walk(2);
  assert.equal(deck.slide(), "S-19");
  assert.ok(deck.has("desc:eduTop") && deck.has("desc:eduLow"));
  assert.ok(deck.text().includes("Funding Mastery"));
  deck.press("rung:1");
  assert.ok(/How To Use This mini course/.test(deck.client()), "the mini course line is back");
});

// ───────────────────────────── the visual slots (section 10.8) ─────────────────────────────

test("each visual is called where 10.0 places it, with the ctx 10.8 names, and draws the slide body", async () => {
  const CTX_KEYS = ["engine", "visual", "survey", "handoff", "businesses", "tier", "door", "sample", "clientId", "money", "esc"];
  const funding = await openDeck("FUNDING_PLUS_REPAIR", { visuals: true });
  const where = [];
  for (let i = 0; i < 40 && !funding.disabled("next"); i += 1) {
    funding.press("next");
    const body = /data-fhv="([a-zA-Z]+)"/.exec(funding.client());
    if (body) where.push([funding.slide(), body[1]]);
  }
  assert.deepEqual(where, [["F-01", "fileFindings"], ["L-01", "moneyLevers"], ["S-08", "yourPath"], ["S-16", "proofWall"], ["P-01", "proofWall"], ["C-01", "companies"]], "Funding: file findings and levers after S-07; proof follows the S-16 menu");
  const call = funding.visualCalls.find((c) => c.name === "companies");
  assert.ok(CTX_KEYS.every((key) => Object.hasOwn(call.ctx, key)), "visual context preserves the original fields");
  assert.equal(call.ctx.door, "fund_plus_optimize");
  assert.equal(call.ctx.tier, "FUNDING_PLUS_REPAIR");
  assert.equal(call.ctx.clientId, CONTACT);
  assert.deepEqual(JSON.parse(JSON.stringify(call.ctx.visual)), { source: "sample" });
  assert.equal(call.ctx.sample, false);
  assert.equal(call.ctx.money(1500), "$1,500");
  assert.equal(call.ctx.esc("<b>"), "&lt;b&gt;");
  assert.equal(call.ctx.survey.name, "Sam Sample");

  const repair = await openDeck("REPAIR_ONLY", { visuals: true });
  const seen = [];
  for (let i = 0; i < 40 && !repair.disabled("next"); i += 1) {
    repair.press("next");
    const body = /data-fhv="([a-zA-Z]+)"/.exec(repair.client());
    if (body) seen.push([repair.slide(), body[1]]);
  }
  assert.deepEqual(seen, [["F-01", "fileFindings"], ["L-01", "moneyLevers"], ["S-08", "yourPath"], ["B-03", "blueprintDemo"], ["S-15", "journey"]], "Repair: findings and levers show before the Blueprint and journey");
  assert.equal(repair.visualCalls.find((c) => c.name === "yourPath").ctx.door, "blueprint", "a repair file leads with the Blueprint");
  repair.press("phase:07").walk(2);
  repair.press("rung:0").press("phase:05");
  assert.ok(repair.visualCalls.some((call) => call.name === "yourPath"), "the path visual draws after the route change");
  assert.equal(repair.visualCalls.at(-1).ctx.door, "optimize", "stepping down to the $1,000 is Door 4");
  // B-03 with the dashboard drawing: its own cockpit words, and no link out to a test account (row 12)
  repair.press("phase:06").press("next").press("next");
  assert.equal(repair.slide(), "B-03");
  assert.ok(repair.cockpitText().includes("This is your Blueprint dashboard, built from your own file."));
  assert.ok(!repair.cockpit().includes("financeos.html"), "no sample-client link while the dashboard draws");
  assert.deepEqual(repair.writes, [], "drawing a visual saves and sends nothing");
});

test("a missing visual, a missing engine.visual, a visual that throws or draws nothing leaves today's slides in place", async () => {
  const today = await openDeck("REPAIR_ONLY");
  const plain = today.walk(REPAIR_RUN.length - 1);
  const cases = [
    ["no visual file", { visuals: null }],
    ["no engine.visual", { visuals: true, deck: payload({ tier: "REPAIR_ONLY" }) }],
    ["an engine.visual the engine could not read (source none)", { visuals: true, deck: payload({ tier: "REPAIR_ONLY", visual: { source: "none", todayTotal: 20000 } }) }],
    ["a visual that throws", { visuals: Object.fromEntries(VISUAL_NAMES.map((n) => [n, () => { throw new Error("boom"); }])) }],
    ["a visual that draws nothing", { visuals: Object.fromEntries(VISUAL_NAMES.map((n) => [n, () => "  "])) }],
  ];
  for (const [label, opts] of cases) {
    const deck = await openDeck("REPAIR_ONLY", opts);
    const walked = deck.walk(REPAIR_RUN.length - 1);
    assert.deepEqual(walked.filter((code) => code !== "F-01"), plain.slice(0, walked.filter((code) => code !== "F-01").length), `${label}: only the permitted file-findings visual can add a slide`);
    deck.press("phase:05");
    assert.ok(deck.client().includes("Cleaned up first. Funded second."), `${label}: S-08 keeps today's words`);
    deck.press("phase:06").press("next").press("next");
    assert.ok(deck.client().includes("Your money, on one page."), `${label}: B-03 keeps today's content`);
    assert.ok(deck.cockpit().includes("financeos.html"), `${label}: and its sample-client links`);
    deck.force("stack-go:S-15");
    assert.ok(deck.client().includes("Letters appear in your dashboard when they have actually been generated and staged."), `${label}: S-15 keeps the planned sequence without claiming letters exist`);
  }
  // funding: no C-01 without its visual
  const funding = await openDeck("FULL_FUNDING", { visuals: { yourPath: () => "<p>path</p>" } });
  assert.deepEqual(funding.walk(MAIN_RUN.length - 1), MAIN_RUN, "L-01 and C-01 are stepped over when their visual is missing");
});

// ───────────────────────────── a real pull: the repair slides read engine.visual ─────────────────────────────

/** A deck as a real pull sends it: the engine's stored total and tier, and no afterFix, item count or reasons on the
 *  engine (src/sales/closer-deck.mjs engineFromRow); the once-fixed amount and the items live on engine.visual. */
function livePull(visual) {
  const deck = payload({ tier: "REPAIR_ONLY", visual });
  Object.assign(deck.engine, { total: 0, afterFix: null, negItems: null, reasons: [], plan: [], sample: false });
  return deck;
}
const LIVE_VISUAL = {
  source: "engine", todayTotal: 0, optimizedTotal: 45000, tierNow: "REPAIR_ONLY", tierAfter: "FULL_FUNDING",
  levers: [], cards: [], mismatches: [], companies: [], newCompany: null, fundability: null,
  items: [
    { creditor: "Capital One", kind: "charge_off", bureaus: ["EX", "EQ"] },
    { creditor: "Midland Credit", kind: "collection", bureaus: ["TU"] },
    { creditor: "Chase", kind: "late", bureaus: ["EX", "TU", "EQ"] },
  ],
};

test("S-07 repair reads the once-fixed amount and the item count from engine.visual on a real pull", async () => {
  const deck = await openDeck("REPAIR_ONLY", { deck: livePull(LIVE_VISUAL) });
  deck.press("phase:04");
  assert.equal(deck.slide(), "S-07");
  assert.ok(deck.text().includes("With the file optimized, the engine projects $45,000."), deck.text().slice(0, 400));
  assert.ok(deck.text().includes("These 3 items hold your file at $0 today."), "the count is the engine's item list");
  assert.ok(!/projects to —|— negative items/.test(deck.text()), "no dash where the amount and the count are known");

  // the engine withholds the money (review or hold): no amount, so no projection line at all
  const held = await openDeck("REPAIR_ONLY", { deck: livePull({ ...LIVE_VISUAL, optimizedTotal: null }) });
  held.press("phase:04");
  assert.ok(!held.text().includes("projects to"), "a null amount prints no amount");

  // engine.visual missing, or the engine could not read the file: the old fields, as before
  for (const visual of [undefined, { source: "none", todayTotal: 20000 }]) {
    const old = await openDeck("REPAIR_ONLY", { deck: payload({ tier: "REPAIR_ONLY", visual }) });
    old.press("phase:04");
    assert.ok(old.text().includes("With the file optimized, the engine projects $60,000."), `fallback to afterFix (${visual ? "source none" : "no visual"})`);
    assert.ok(old.text().includes("These 3 items hold your file at $20,000 today."));
  }
});

test("S-09 repair lists the engine's own items in plain words, and S-14 repair puts today next to the optimized file", async () => {
  const deck = await openDeck("REPAIR_ONLY", { deck: livePull(LIVE_VISUAL) });
  deck.force("stack-go:S-09");
  assert.equal(deck.slide(), "S-09");
  assert.ok(deck.text().includes("3 items are limiting your approvals."));
  const rows = [...deck.client().matchAll(/<div class="item-row"><i><\/i><div><span class="mono">([^<]*)<\/span><div class="item-t">([^<]*)<\/div>(?:<div class="item-b">([^<]*)<\/div>)?/g)].map((m) => [m[1], m[2], m[3] || ""]);
  assert.deepEqual(rows, [
    ["Charge-off", "Capital One", "On Experian, Equifax"],
    ["Collection", "Midland Credit", "On TransUnion"],
    ["Late payment", "Chase", "On Experian, TransUnion, Equifax"],
  ]);
  const one = await openDeck("REPAIR_ONLY", { deck: livePull({ ...LIVE_VISUAL, items: [LIVE_VISUAL.items[0]] }) });
  one.force("stack-go:S-09");
  assert.ok(one.text().includes("1 item is limiting your approvals."));

  deck.force("stack-go:S-14");
  assert.equal(deck.slide(), "S-14");
  assert.ok(deck.text().includes("Today $0 file supports"), "todayTotal is 0 for a repair-only file, and prints as $0");
  assert.ok(deck.text().includes("After cleanup, projected $45,000 +$45,000 unlocked"), deck.text().slice(0, 300));

  // fallback: the old fields
  const old = await openDeck("REPAIR_ONLY");
  old.force("stack-go:S-14");
  assert.ok(old.text().includes("Today $20,000 file supports"));
  assert.ok(old.text().includes("After cleanup, projected $60,000 +$40,000 unlocked"));
  old.force("stack-go:S-09");
  assert.ok(old.text().includes("3 items are limiting your approvals."));
  assert.equal(old.client().includes('class="item-row"'), false, "no engine list without engine.visual");
  assert.deepEqual(deck.writes, []);
});

// ───────────────────────────── the $1,000 link beside the deposit (row 9) ─────────────────────────────

test("a funding-plus-repair file sends the $1,000 credit optimization link from S-23 with the cockpit pay panel's own write", async () => {
  const deck = await openDeck("FUNDING_PLUS_REPAIR");
  deck.press("phase:09");
  assert.equal(deck.slide(), "S-23");
  assert.equal(deck.label("pay"), "Send pay link");
  assert.equal(deck.label("pay-optimize"), "Send credit optimization pay link · $1,000");
  assert.ok(deck.cockpitText().includes("Funding plus credit optimization is $3,000 plus $1,000. Send both links."));
  deck.press("pay-optimize");
  await deck.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(deck.writes)), [{
    url: "/api/closer-deck",
    body: { action: "send_pay_link", client_id: CONTACT, offer_key: "REPAIR_DFY", sale_motion: null },
  }], "the same body closer-call.js posts: no new endpoint");
  assert.ok(deck.text().includes("Credit optimization pay link sent."));
  assert.equal(deck.disabled("pay-optimize"), true, "held off after a send, like every send button");
  // the deposit link still goes out with the funding offer
  deck.press("pay");
  await deck.settle();
  assert.equal(deck.writes.at(-1).body.offer_key, "FUNDING_DFY");
  // a full funding file, and a repair file, have no second link
  for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
    const other = await openDeck(tier);
    other.press("phase:09");
    assert.equal(other.has("pay-optimize"), false, tier);
  }
});

// ───────────────────────────── the words that changed (rows 5 to 8, 10, 13 to 16, 18) ─────────────────────────────

test("the client screens carry the 2026-10-29 words", async () => {
  const funding = await openDeck("FULL_FUNDING");
  funding.press("phase:02");
  assert.ok(funding.client().includes("Yearly revenue"), "row 8");
  assert.ok(!funding.client().includes("Monthly revenue"));
  funding.press("phase:03").press("next");
  assert.equal(funding.slide(), "S-06");
  assert.ok(funding.client().includes("Your report is ready"), "S-06 names the real completed state");
  assert.ok(!/\$25M|Thousands/.test(funding.client()));
  funding.press("phase:06").walk(7);
  assert.equal(funding.slide(), "S-16");
  assert.ok(funding.client().includes("Real clients have received real approvals."), "S-16 shows client proof");
  funding.press("phase:07").walk(3);
  assert.equal(funding.slide(), "S-20");
  assert.ok(funding.client().includes("S-20"), "S-20 is available for the funding math");
  assert.ok(!/Pre-approval/.test(funding.client()));

  const repair = await openDeck("REPAIR_ONLY", { deck: payload({ tier: "REPAIR_ONLY", available: false }) });
  repair.press("phase:04");
  assert.ok(repair.client().includes("Your results are not in yet."), "row 7");
  assert.ok(!/numbers/i.test(repair.html()), "no 'number' on a no-pull screen, the top bar or the cockpit");

  const blueprint = await openDeck("REPAIR_ONLY");
  blueprint.press("phase:07").walk(2);
  assert.equal(blueprint.slide(), "S-19");
  const rungs = [...blueprint.html().matchAll(/<button type="button" class="ck-btn( k)?" data-act="(rung:\d)">([^<]*)<\/button>/g)].map((m) => [m[2], m[3].replace(/\s+/g, " "), m[1] === " k"]);
  assert.deepEqual(rungs, [
    ["rung:2", "Capital Blueprint $5,000", true],
    ["rung:0", "Onboard now: full done-for-you $1,000", false],
    ["rung:1", "Trial: first round done-for-you $200", false],
  ], "row 2: the Capital Blueprint is the first rung, and the one a file that is not ready starts on");
  assert.ok(blueprint.client().includes("S-19"), "the offer choice remains on S-19");
  blueprint.press("rung:0");
  assert.ok(blueprint.client().includes("The four doors"), "S-19 keeps the four-door plan after a rung choice");

  const stack = await openDeck("REPAIR_ONLY");
  stack.press("phase:06").press("next");
  assert.equal(stack.slide(), "B-02");
  const five = [...stack.client().matchAll(/<li><span class="ck" aria-hidden="true">✓<\/span><span>([^<]*)<\/span><\/li>/g)].map((m) => decode(m[1]));
  assert.deepEqual(five, ["Credit Analysis Report", "Dispute Letter Pack", "Credit Optimization Roadmap", "How Much You Qualify For", "Bank & Lender Match List"], "row 16: the five things, at the top of B-02");
  assert.ok(stack.client().indexOf("What you get") < stack.client().indexOf('class="stk-grid"'));
  assert.ok(stack.text().includes("the Fundhub team preps you"), "row 15");
  assert.ok(!/\bCSM\b/.test(stack.client()));
  stack.press("next").press("next");
  assert.equal(stack.slide(), "B-04");
  assert.ok(!/member fee/i.test(stack.client()), "row 10: no member fee after 12 months");
  assert.ok(stack.cockpitText().includes("There is no renewal charge after the 12 months"));
});

test("a missing report keeps the closer on the live status screen", async () => {
  const deck = await openDeck("REPAIR_ONLY", { deck: payload({ tier: "REPAIR_ONLY", available: false, softPull: null }) });
  deck.press("phase:04");
  assert.equal(deck.slide(), "S-07");
  deck.press("next");
  assert.equal(deck.slide(), "S-06");
  deck.press("phase:05");
  assert.equal(deck.slide(), "S-06");
  assert.ok(deck.client().includes("Waiting for your authorization"));
  assert.ok(!deck.client().includes("Recommended path"));
});

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 24);
  assert.ok(proof.rows.every((row) => row.surface === SURFACE));
  proof.assertAllClaimed();
});
