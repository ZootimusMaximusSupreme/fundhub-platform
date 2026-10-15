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

const proof = proofRows(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP = path.join(ROOT, "public/app");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");
const PRESENT_JS = read("present.js");
const SEND_JS = read("contract-send.js");
const DATA_JS = read("data.js");
const PRESENT_HTML = read("present.html");
const OFFERS = offersForClient();
const CONTACT = "33333333-3333-3333-3333-333333333333";
const SAMPLE_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const SURFACE = "present.html (+ present.js, contract-send.js)";

const MAIN_RUN = [...Array(22)].map((_, i) => `S-${String(i + 1).padStart(2, "0")}`).concat(["S-23", "S-24"]);
const STACK_RUN = ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"];

function payload({ tier = "FULL_FUNDING", negItems = 3, available = true, businesses = [], softPull = null } = {}) {
  return {
    client_id: CONTACT,
    survey: { name: "Sam Sample" },
    businesses,
    income_estimates: {},
    engine: {
      available, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 },
      total: available ? 20000 : null, afterFix: available ? 60000 : null,
      negItems: available ? negItems : null, reasons: [], plan: [],
      totalBasis: available ? "personal_only" : null, sample: true,
    },
    soft_pull: softPull,
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
  search = `?contact=${CONTACT}`, role = "owner", deck = null, readAnswer = null, writeAnswer = null, data = null,
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
    FHData: {
      read: async (what, query) => {
        reads.push({ what, query });
        if (readAnswer) return readAnswer(what, query);
        return { ok: true, data: deck || data || payload({ tier }) };
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
  vm.createContext(sandbox);
  vm.runInContext(SEND_JS, sandbox, { filename: "contract-send.js" });
  vm.runInContext(PRESENT_JS, sandbox, { filename: "present.js" });
  await flush();
  await flush();
  const out = {
    reads, writes, copied,
    html: () => html,
    text: () => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    client: () => (html.indexOf('<div class="cockpit">') < 0 ? html : html.slice(0, html.indexOf('<div class="cockpit">'))),
    cockpit: () => (html.indexOf('<div class="cockpit">') < 0 ? "" : html.slice(html.indexOf('<div class="cockpit">'))),
    cockpitText: () => decode(out.cockpit().replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    slide() {
      const m = /<div class="slide-hd"><span class="mono">([A-Z]-\d\d) \/ /.exec(html);
      return m ? m[1] : null;
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

// ───────────────────────────── Back and Next, arrows ─────────────────────────────

test("Back and Next walk the deck, the arrow keys do the same, and the Blueprint section is stepped over", async () => {
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

    // the whole run, one press at a time: S-01 .. S-22, then S-23 and S-24 (the six Blueprint slides sit between S-22 and S-23)
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
    // Inside section 06 Next and Back walk its six slides, and leave at its ends.
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:06");
    assert.equal(deck.slide(), "B-01");
    assert.deepEqual(deck.walk(5), STACK_RUN);
    deck.press("next");
    assert.equal(deck.slide(), "S-23", "B-06 leads on to S-23");
    deck.press("phase:06");
    assert.equal(deck.slide(), "B-01");
    deck.press("back");
    assert.equal(deck.slide(), "S-22", "B-01 leads back to S-22");
  });

  await proof.check(/^Back and Next screen buttons, ArrowLeft and ArrowRight keys/, async () => {
    // The education route skips S-11 .. S-16 in both directions.
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:03");
    assert.equal(deck.slide(), "S-05");
    deck.press("next").press("next");
    assert.equal(deck.slide(), "S-07");
    deck.press("edu");
    deck.press("phase:04");
    assert.equal(deck.slide(), "S-08");
    assert.deepEqual(deck.walk(4), ["S-08", "S-09", "S-10", "S-17", "S-18"]);
    deck.press("back").press("back");
    assert.equal(deck.slide(), "S-10");
    // a funding file with no education route still runs S-10 -> S-11
    const funding = await openDeck("FULL_FUNDING");
    funding.press("phase:04");
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
    assert.ok(deck.text().includes("A defined path. No obligation at any step."));

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
    deck.press("phase:07");
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
    deck.press("phase:05");
    deck.walk(3);
    assert.equal(deck.slide(), "S-20");
    assert.ok(deck.client().includes("$4,500 a month."));
    assert.ok(deck.text().includes("$54,000"));

    // and it leaves the page as cost_of_inaction on the disposition
    deck.press("phase:07").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.cost_of_inaction, "$4,500 a month");

    const blank = await openDeck("REPAIR_ONLY");
    blank.press("phase:07").press("disp");
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
    deck.press("phase:07").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.beliefs_count, 2);
    deck.press("phase:02");
    assert.equal(on("Trust"), true, "the ticks are kept across the deck");
    assert.equal(on("Money"), true);
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
      assert.deepEqual(named.reads.map((r) => `${r.what}:${r.query.contact}`), [`closer-deck:${CONTACT}`], `?${name}=`);
      assert.equal(named.slide(), "S-01");
    }

    const refused = await openDeck("FULL_FUNDING", { readAnswer: async () => ({ ok: false, source: "unauthorized", error: "not signed in" }) });
    assert.ok(refused.text().includes("This account cannot open the client deck. Ask an owner for access, or sign in with a closer account."));
    assert.equal(refused.reads.length, 1);
    assert.equal(refused.has("next"), false);
    assert.equal(refused.slide(), null);
    assert.deepEqual(refused.writes, []);
  });
});

// ───────────────────────────── objections and reframes ─────────────────────────────

const OBJECTIONS = [
  ["Think about it", "Show the process", "S-08", "Isolate it. 'Think about it' is never the real objection."],
  ["$3K is a lot", "Show the math", "S-20", "Should vs how"],
  ["What if it fails", "Show guarantees", "S-21", "No funding, no money for us."],
  ["Spouse", "Show guarantees", "S-21", "Respect vs permission"],
  ["Burned before", "Show the system", "S-10", "I'm sorry that happened."],
  ["DIY", "Show the rounds", "S-12", "You absolutely can."],
];

test("the six objection buttons open their words, Back closes them, and the jump button goes to the slide that answers it", async () => {
  await proof.check(/^Objections: 6 buttons/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:02");
    assert.equal(deck.has("obj:0"), false, "objections wait for the commit phase");
    deck.press("phase:05");
    assert.equal(deck.slide(), "S-17");
    const labels = [...deck.html().matchAll(/<button[^>]*data-act="obj:(\d)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(labels, OBJECTIONS.map((o, i) => [String(i), o[0]]));
    assert.ok(deck.text().includes("Descent ladder"));

    for (const [i, [title, jumpLabel, target, line]] of OBJECTIONS.entries()) {
      deck.press(`obj:${i}`);
      assert.ok(deck.cockpitText().includes(`Objection Back ${title}`), `${title} header: ${deck.cockpitText().slice(0, 120)}`);
      assert.equal((deck.cockpit().match(/<div class="say">/g) || []).length, 3, `${title} gives three lines to say`);
      assert.ok(deck.cockpitText().includes(line), `${title}: ${line}`);
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
      deck.press("phase:05");
    }

    // moving the deck with Next closes an open objection too
    deck.press("obj:1").press("next");
    assert.equal(deck.has("obj-back"), false);
    assert.deepEqual(deck.writes, []);
  });
});

test("Reframing patterns opens the five reframes and Back closes them", async () => {
  await proof.check(/^Reframing patterns button and Back/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.press("phase:05");
    assert.equal(deck.label("reframes"), "Reframes");
    assert.ok(!deck.cockpitText().includes("Reframing patterns"));
    deck.press("reframes");
    assert.ok(deck.cockpitText().includes("Reframing patterns"));
    for (const [name, words] of [
      ["Truth Hammer", "You just told me [X], now you're saying [Y]. What's really going on?"],
      ["Simple Decision", "Do you want to keep [pain] or do you want [outcome]?"],
      ["Circumstance vs Vision", "Decisions from current circumstances, or from your vision?"],
      ["Cost Reframe", "Too much compared to what? Compared to [Amount] and finally [goal]?"],
      ["Risk Reframe", "Riskier: $3K into a proven system with three guarantees, or the same spot in 6 months?"],
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
    deck.press("phase:05").press("next");
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
    deck.press("phase:07").press("disp");
    await deck.settle();
    assert.equal(deck.writes.at(-1).body.temperature, 10);

    const fresh = await openDeck("FULL_FUNDING");
    fresh.press("phase:07").press("disp");
    await fresh.settle();
    assert.equal(fresh.writes.at(-1).body.temperature, 0, "no number pressed sends 0");
  });
});

// ───────────────────────────── the phase strip ─────────────────────────────

const PHASES = [
  ["01", "01 Intro", "S-01", /^Phase strip button 01: 01 Intro \(S-01\.\.S-02\)/],
  ["02", "02 Discovery", "S-03", /^Phase strip button 02: 02 Discovery \(S-03\.\.S-04\)/],
  ["03", "03 Soft pull", "S-05", /^Phase strip button 03: 03 Soft pull \(S-05\.\.S-07\)/],
  ["04", "04 Pitch", "S-08", /^Phase strip button 04: 04 Pitch \(S-08\.\.S-16\)/],
  ["05", "05 Commit", "S-17", /^Phase strip button 05: 05 Commit \(S-17\.\.S-22\)/],
  ["06", "06 Blueprint", "B-01", /^Phase strip button 06: 06 Blueprint \(B-01\.\.B-06, the offer stack\)/],
  ["07", "07 Close", "S-23", /^Phase strip button 07: 07 Close \(S-23\.\.S-24\)/],
];

for (const [p, phaseName, first, matcher] of PHASES) {
  test(`phase strip button ${p} jumps to ${first}, names the phase, and lights only itself`, async () => {
    await proof.check(matcher, async () => {
      for (const tier of ["FULL_FUNDING", "REPAIR_ONLY"]) {
        const deck = await openDeck(tier);
        // the strip is on every slide, seven buttons, labelled 01 to 07
        const strip = [...deck.html().matchAll(/<button[^>]*data-act="phase:(\d\d)"[^>]*>(\d\d)<\/button>/g)].map((m) => [m[1], m[2]]);
        assert.deepEqual(strip, ["01", "02", "03", "04", "05", "06", "07"].map((n) => [n, n]));
        // start somewhere else so the jump is seen to move
        deck.press(p === "05" ? "phase:03" : "phase:05");
        assert.notEqual(deck.slide(), first);
        deck.press(`phase:${p}`);
        assert.equal(deck.slide(), first, `${tier}: phase ${p} opens on ${first}`);
        assert.ok(deck.cockpitText().startsWith(phaseName), `${tier}: the cockpit names the phase "${phaseName}": ${deck.cockpitText().slice(0, 40)}`);
        const lit = [...deck.html().matchAll(/<button[^>]*data-act="phase:(\d\d)"[^>]*background:var\(--ink\)/g)].map((m) => m[1]);
        assert.deepEqual(lit, [p], `${tier}: only phase ${p} is lit`);
        // pressing it again stays on its first slide
        deck.press(`phase:${p}`);
        assert.equal(deck.slide(), first);
        assert.deepEqual(deck.writes, []);
      }
      // the strip button is a jump, not a step: it works from the far end of the deck too
      const late = await openDeck("FULL_FUNDING");
      late.press("phase:07").press("next");
      assert.equal(late.slide(), "S-24");
      late.press(`phase:${p}`);
      assert.equal(late.slide(), first);
      if (p === "06") {
        assert.ok(late.html().includes('title="Capital Blueprint + FinanceOS"'), "the 06 button says what it opens");
        assert.equal(late.label("stack-leave"), "Leave the stack: back to S-24");
      }
    });
  });
}

test("phase 04 runs S-08 to S-16 and Next from S-16 enters 05", async () => {
  const deck = await openDeck("FULL_FUNDING");
  deck.press("phase:04");
  const run = deck.walk(9);
  assert.deepEqual(run, ["S-08", "S-09", "S-10", "S-11", "S-12", "S-13", "S-14", "S-15", "S-16", "S-17"]);
  assert.ok(deck.cockpitText().startsWith("05 Commit"));
});

// ───────────────────────────── section 06: the stack ─────────────────────────────

test("Leave the stack says where it goes back to, and goes there", async () => {
  await proof.check(/^Section 06 'Leave the stack: back to <slide>'/, async () => {
    // opened from the Blueprint rung of S-19
    const deck = await openDeck("REPAIR_ONLY");
    deck.press("phase:05").walk(2);
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

    // opened from the phase strip on another slide
    const other = await openDeck("FULL_FUNDING");
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

    // with no slide to go back to (a jump straight into the stack), it goes to S-22
    const direct = await openDeck("FULL_FUNDING");
    direct.force("stack-go:B-04");
    assert.equal(direct.slide(), "B-04");
    assert.equal(direct.label("stack-leave"), "Leave the stack");
    direct.press("stack-leave");
    assert.equal(direct.slide(), "S-22");

    // walking out the end forgets the way back
    const out = await openDeck("FULL_FUNDING");
    out.press("phase:02").press("phase:06");
    assert.equal(out.label("stack-leave"), "Leave the stack: back to S-03");
    out.walk(6);
    assert.equal(out.slide(), "S-23");
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

    // a funding-sorted clean file with a company on it
    const clean = await openDeck("FULL_FUNDING", { deck: payload({ tier: "FULL_FUNDING", negItems: 0, businesses: [{ id: "biz-1", name: "Sample LLC", age_months: 40, incorporated_date: "2023-06-01" }] }) });
    clean.press("phase:06").press("next");
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
    const deck = await openDeck("FULL_FUNDING");
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

    const owner = await openDeck("FULL_FUNDING", { role: "owner" });
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
      const deck = await openDeck("FULL_FUNDING", { role });
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
    const none = await openDeck("FULL_FUNDING");
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
    assert.equal(waiting.slide(), "S-07");
    assert.ok(panel(waiting));
    waiting.press("next");
    assert.equal(waiting.slide(), "S-08");
    assert.equal(panel(waiting), null);

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

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 24);
  assert.ok(proof.rows.every((row) => row.surface === SURFACE));
  proof.assertAllClaimed();
});
