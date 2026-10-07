// THE CAPITAL BLUEPRINT + FINANCEOS OFFER STACK ON THE CLOSER DECK (section 06).
//
// Owner, 2026-10-06: "Add these items into our offer stack so they show up when
// we're doing presentations for clients. When they hop on a call with the sales
// rep, there should be a whole presentation section with the buttons and logic."
// public/app/present.js now carries six slides, B-01 to B-06, that a rep opens on
// purpose: the phase strip's 06, or "Show the full Blueprint stack" on S-19.
//
// What is pinned here:
//   - the section sits between S-22 and S-23, and Next/Back never fall into it
//   - the stack starts from what the deck knows about this caller, and the rep's
//     toggles change what the caller sees
//   - every price is the catalog's (src/config/offers.mjs) or "$X" when the owner
//     has not set one; no "round two"; no promise words; the watch notes carry
//     the rule, and the funding guarantees stay word for word
//   - "Yes" on the price slide sells the Blueprint through the existing offer path
//   - the FinanceOS demo links open the page's real tabs on the sample client, and
//     only for logins the /api/money gate lets in
//
// HOW. package.json's test glob is src/** and scripts/** (CLAUDE.md §12), so the
// browser file is read from public/app/present.js and run WHOLE in a vm sandbox
// with a stand-in page: one root element, the click and key listeners it
// registers, a cached role, and a FHData.read that hands back one canned
// closer-deck payload. Every assertion reads what the real code painted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { offersForClient } from "../config/offers.mjs";
import { ROLE_SETS } from "./read-api.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRESENT = path.join(ROOT, "public/app/present.js");
const JS = fs.readFileSync(PRESENT, "utf8");
const FOS_JS = fs.readFileSync(path.join(ROOT, "public/app/financeos.js"), "utf8");
const FOS_HTML = fs.readFileSync(path.join(ROOT, "public/app/financeos.html"), "utf8");

const BEGIN = "/* ───────── 06 BLUEPRINT STACK — begin";
const END = "/* ───────── 06 BLUEPRINT STACK — end";
const SECTION = (() => {
  const a = JS.indexOf(BEGIN);
  const b = JS.indexOf(END, a);
  assert.ok(a > 0 && b > a, "the 06 BLUEPRINT STACK markers moved; update BEGIN/END in this test");
  return JS.slice(a, b);
})();
/* The section's code with its comments taken out: a comment may quote a banned
   phrase to explain the ban. */
const SECTION_CODE = SECTION.replace(/\/\*[\s\S]*?\*\//g, "");

const OFFERS = offersForClient();
const BLUEPRINT = OFFERS.find((o) => o.key === "UWIQ_DELIVERABLES");
const CATALOG_PRICES = new Set(OFFERS.map((o) => o.priceDisplay));
const SAMPLE_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const STACK_CODES = ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"];
const NEVER_PROMISE = "Never promise an approval, an amount, a score, or a removal.";

/* One closer-deck payload, the shape buildCloserDeck() returns
   (src/sales/closer-deck.mjs). Only what the stack reads is varied. */
function payload({ tier = "REPAIR_ONLY", negItems = 3, available = true, businesses = [] } = {}) {
  return {
    client_id: "33333333-3333-3333-3333-333333333333",
    survey: { name: "Sam Sample" },
    businesses,
    income_estimates: {},
    engine: {
      available, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 },
      total: available ? 20000 : null, afterFix: available ? 60000 : null,
      negItems: available ? negItems : null, reasons: [], plan: [],
      totalBasis: available ? "personal_only" : null, sample: true
    },
    soft_pull: null,
    offers: OFFERS
  };
}

const flush = () => new Promise((r) => setImmediate(r));

/* The real present.js, run whole against a stand-in page. */
async function openDeck(data, { role = "owner" } = {}) {
  const root = { innerHTML: "" };
  let onClick = null;
  let onKey = null;
  const stored = role == null ? {} : { fh_role: role };
  const sandbox = {
    console,
    URLSearchParams,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout,
    location: { search: "?contact=33333333-3333-3333-3333-333333333333", pathname: "/app/present.html" },
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "app" ? root : null),
      addEventListener: (type, fn) => { if (type === "click") onClick = fn; }
    },
    localStorage: { getItem: (k) => (Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null) },
    FHData: { read: async () => ({ ok: true, data }), write: async () => ({ ok: false, error: "not in this test" }) }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { if (type === "keydown") onKey = fn; };
  vm.createContext(sandbox);
  vm.runInContext(JS, sandbox, { filename: PRESENT });
  await flush();
  await flush();
  assert.ok(onClick && onKey, "present.js registered no click or key listener");
  const deck = {
    html: () => root.innerHTML,
    click(act) { onClick({ target: { closest: () => ({ getAttribute: () => act }) } }); return deck; },
    key(k, times = 1) { for (let i = 0; i < times; i++) onKey({ key: k, target: {} }); return deck; }
  };
  return deck;
}

function parts(html) {
  const at = html.indexOf('<div class="cockpit">');
  return { client: at < 0 ? html : html.slice(0, at), cockpit: at < 0 ? "" : html.slice(at) };
}
function text(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
function current(deck) {
  const m = /<div class="slide-hd"><span class="mono">([A-Z]-\d\d) \/ /.exec(deck.html());
  return m ? m[1] : null;
}
/* The cockpit minus its "Engine data" footer: that line is the engine's
   stored estimate for the file (an existing element on every slide), not a
   price and not part of this section. */
function ownCockpit(html) {
  const at = html.indexOf('<span class="mono">Engine data</span>');
  return at < 0 ? html : html.slice(0, at);
}
function sayLines(deck) {
  return [...parts(deck.html()).cockpit.matchAll(/<div class="say">([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));
}
function watchOf(deck) {
  const m = /<div class="watch"><span class="mono">Watch for<\/span><div[^>]*>([\s\S]*?)<\/div><\/div>/.exec(deck.html());
  return m ? text(m[1]) : "";
}
function fineLines(clientHtml) {
  return [...clientHtml.matchAll(/<p class="fine">([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
}
function withoutFine(clientHtml) {
  return clientHtml.replace(/<p class="fine">[\s\S]*?<\/p>/g, " ");
}
/* Stack item names shown in the caller's B-02 grid. */
function gridNames(deck) {
  return [...parts(deck.html()).client.matchAll(/<div class="stk-item"[^>]*>[\s\S]*?<div class="t">([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));
}
/* The cockpit toggle for one item: { on, why } . */
function toggle(deck, key) {
  const re = new RegExp('data-act="stack:' + key + '" aria-pressed="(true|false)">[\\s\\S]*?<span class="why">([\\s\\S]*?)</span>[\\s\\S]*?<span class="st">(On|Off)</span>');
  const m = re.exec(parts(deck.html()).cockpit);
  assert.ok(m, "no toggle for " + key);
  assert.equal(m[1] === "true", m[3] === "On", key + ": aria-pressed and the On/Off word disagree");
  return { on: m[1] === "true", why: text(m[2]) };
}
/* Every slide in the section, client and cockpit, as text. */
async function allStackText(data, opts) {
  const deck = await openDeck(data, opts);
  deck.click("phase:06");
  const out = [];
  for (const c of STACK_CODES) {
    assert.equal(current(deck), c);
    out.push({ code: c, client: parts(deck.html()).client, cockpit: ownCockpit(parts(deck.html()).cockpit), say: sayLines(deck), watch: watchOf(deck) });
    deck.key("ArrowRight");
  }
  return out;
}

describe("section 06 is a section the rep opens, never one they fall into", () => {
  test("the six slides sit between S-22 and S-23 in the deck", () => {
    const codes = [...JS.slice(JS.indexOf("var DECK = ["), JS.indexOf("var EDU_SKIP")).matchAll(/code: "([A-Z]-\d\d)"/g)].map((m) => m[1]);
    const at = codes.indexOf("S-22");
    assert.deepEqual(codes.slice(at, at + 8), ["S-22", ...STACK_CODES, "S-23"]);
    assert.equal(codes[codes.length - 1], "S-24", "the wrap is still the last slide");
  });

  test("the phase strip has 06, and it opens B-01", async () => {
    const deck = await openDeck(payload());
    assert.match(parts(deck.html()).cockpit, /data-act="phase:06" title="Capital Blueprint \+ FinanceOS"/);
    deck.click("phase:06");
    assert.equal(current(deck), "B-01");
    assert.ok(parts(deck.html()).cockpit.includes("06 Blueprint"), "the cockpit names the phase");
  });

  test("from outside, Next and Back step over the stack; inside, they walk it", async () => {
    const deck = await openDeck(payload());
    deck.click("phase:05");
    assert.equal(current(deck), "S-17");
    deck.key("ArrowRight", 5);
    assert.equal(current(deck), "S-22");
    deck.key("ArrowRight");
    assert.equal(current(deck), "S-23", "Next on S-22 must go to the close, not into the stack");
    deck.key("ArrowLeft");
    assert.equal(current(deck), "S-22", "Back on S-23 must skip the stack too");

    deck.click("phase:06");
    deck.key("ArrowRight", 5);
    assert.equal(current(deck), "B-06");
    deck.key("ArrowRight");
    assert.equal(current(deck), "S-23", "the end of the stack leads to the close");
  });

  test("Leave the stack goes back to the slide it was opened from", async () => {
    const deck = await openDeck(payload());
    deck.click("phase:05");
    deck.click("phase:06").key("ArrowRight");
    assert.equal(current(deck), "B-02");
    assert.ok(parts(deck.html()).cockpit.includes("Leave the stack: back to S-17"));
    deck.click("stack-leave");
    assert.equal(current(deck), "S-17");
  });

  test("S-19's Blueprint rung opens the stack, and only that rung", async () => {
    const deck = await openDeck(payload({ tier: "REPAIR_ONLY" }));
    deck.click("phase:05").key("ArrowRight", 2);
    assert.equal(current(deck), "S-19");
    assert.ok(!parts(deck.html()).cockpit.includes('data-act="stack-open"'), "the done-for-you rung shows no stack door");
    deck.click("rung:2");
    assert.ok(parts(deck.html()).cockpit.includes('data-act="stack-open"'), "the Blueprint rung shows the stack door");
    deck.click("stack-open");
    assert.equal(current(deck), "B-01");
    deck.click("stack-leave");
    assert.equal(current(deck), "S-19");
  });
});

describe("the stack starts from this caller's file", () => {
  test("a repair file with negative items: dispute rounds on, ready on, partner off", async () => {
    const deck = await openDeck(payload({ tier: "REPAIR_ONLY", negItems: 3 }));
    deck.click("phase:06").key("ArrowRight");
    assert.deepEqual(toggle(deck, "disputes"), { on: true, why: "3 negative items on this file." });
    assert.equal(toggle(deck, "ready").on, true);
    assert.equal(toggle(deck, "partner").on, false);
    const names = gridNames(deck);
    assert.ok(names.includes("Dispute rounds, with proof"));
    assert.ok(!names.includes("Credit partner file"), "nobody is a credit partner until the rep says so");
  });

  test("a clean funding file: no dispute rounds, no ready-to-fund wait", async () => {
    const deck = await openDeck(payload({ tier: "FULL_FUNDING", negItems: 0 }));
    deck.click("phase:06").key("ArrowRight");
    assert.deepEqual(toggle(deck, "disputes"), { on: false, why: "No negative items on this file. Nothing to dispute." });
    assert.equal(toggle(deck, "ready").on, false);
    assert.match(toggle(deck, "ready").why, /Sorted to funding today/);
    const names = gridNames(deck);
    assert.ok(!names.includes("Dispute rounds, with proof"), "a clean file gets no dispute rounds");
    assert.ok(!names.includes("Ready to get funded"));
  });

  test("no credit file yet: dispute rounds wait for the report", async () => {
    const deck = await openDeck(payload({ available: false, tier: null }));
    deck.click("phase:06").key("ArrowRight");
    assert.deepEqual(toggle(deck, "disputes"), {
      on: false, why: "No credit file on this deck yet. Turn on only if the report shows negative items."
    });
  });

  test("a business on the file: its papers and its container are named", async () => {
    const deck = await openDeck(payload({ businesses: [{ id: "b1", name: "Fundhub LLC", age_months: null, incorporated_date: null }] }));
    deck.click("phase:06").key("ArrowRight");
    assert.match(toggle(deck, "vault").why, /^1 business on the file/);
    assert.match(toggle(deck, "financeos").why, /^1 business on the file/);
    const client = text(parts(deck.html()).client);
    assert.match(client, /your business papers/);
    assert.match(client, /Every personal and business account/);
  });
});

describe("the rep's toggles change what the caller sees", () => {
  test("turning items on and off redraws the caller's stack; Reset puts the file's answer back", async () => {
    const deck = await openDeck(payload({ tier: "FULL_FUNDING", negItems: 0 }));
    deck.click("phase:06").key("ArrowRight");
    assert.ok(!parts(deck.html()).cockpit.includes('data-act="stack-reset"'), "nothing to reset yet");

    deck.click("stack:partner");
    assert.ok(gridNames(deck).includes("Credit partner file"));
    assert.deepEqual(toggle(deck, "partner"), { on: true, why: "You turned this on." });
    deck.click("stack:alerts");
    assert.ok(!gridNames(deck).includes("File-protection alerts"));
    assert.ok(parts(deck.html()).cockpit.includes('data-act="stack-reset"'));

    deck.click("stack-reset");
    assert.ok(!gridNames(deck).includes("Credit partner file"));
    assert.ok(gridNames(deck).includes("File-protection alerts"));
    assert.ok(!parts(deck.html()).cockpit.includes('data-act="stack-reset"'));
  });

  test("toggling an item back to the file's answer leaves nothing to reset", async () => {
    const deck = await openDeck(payload());
    deck.click("phase:06").key("ArrowRight");
    deck.click("stack:partner").click("stack:partner");
    assert.equal(toggle(deck, "partner").on, false);
    assert.ok(!parts(deck.html()).cockpit.includes('data-act="stack-reset"'));
  });

  test("the price build-up and the FinanceOS split follow the toggles", async () => {
    const deck = await openDeck(payload());
    deck.click("phase:06").key("ArrowRight");
    deck.click("stack:alerts").click("stack:partner");
    deck.key("ArrowRight", 2);
    assert.equal(current(deck), "B-04");
    const b04 = text(parts(deck.html()).client);
    assert.ok(!b04.includes("File-protection alerts"));
    assert.ok(b04.includes("Credit partner file"));
    deck.key("ArrowRight");
    assert.equal(current(deck), "B-05");
    const cols = parts(deck.html()).client.split('<span class="mono">The Blueprint adds</span>');
    assert.equal(cols.length, 2);
    assert.ok(!text(cols[0]).includes("File-protection alerts"), "turned off on B-02, so not in the FinanceOS column");
    assert.ok(text(cols[0]).includes("Every account, card, and due date on one page"));
    assert.ok(text(cols[1]).includes("Credit partner file"));
    assert.ok(text(cols[1]).includes("Dispute rounds, with proof"));
  });
});

describe("prices, words, and the watch notes", () => {
  const STATES = [
    payload({ tier: "REPAIR_ONLY", negItems: 3 }),
    payload({ tier: "FULL_FUNDING", negItems: 0, businesses: [{ id: "b1", name: "Co", age_months: 12, incorporated_date: "2025-01" }] }),
    payload({ available: false, tier: null })
  ];

  test("every dollar figure in the section is the catalog's or $X", async () => {
    for (const data of STATES) {
      for (const s of await allStackText(data)) {
        const all = text(s.client) + " " + text(s.cockpit);
        for (const m of all.matchAll(/\$[\d,]+(?:\.\d+)?/g)) {
          assert.ok(CATALOG_PRICES.has(m[0]), s.code + ": " + m[0] + " is not a price in src/config/offers.mjs");
        }
      }
    }
    assert.doesNotMatch(SECTION_CODE, /\$\d/, "a dollar figure is typed into the section's code");
  });

  test("the Blueprint's price is the catalog's; unset prices say $X", async () => {
    const slides = await allStackText(payload());
    const b04 = text(slides[3].client);
    assert.ok(b04.includes(BLUEPRINT.priceDisplay), "B-04 must show the catalog's Blueprint price");
    assert.ok(b04.includes("Monthly member fee · $X"), "the member fee is not set and must say $X");
    assert.ok(text(slides[3].cockpit).includes("Yes: close the Blueprint · " + BLUEPRINT.priceDisplay));
    const b05 = text(slides[4].client);
    assert.match(b05, /Setup, one time \$X/);
    assert.match(b05, /Each container, per month A container is each business and each person on your account\. \$X/);
    assert.ok(fineLines(slides[4].client).includes("$X means the price is not set yet."));
  });

  test("never \"round two\": the next one is the next funding sequence", async () => {
    for (const s of await allStackText(payload())) {
      const all = text(s.client) + " " + text(s.cockpit);
      assert.doesNotMatch(all, /\bround (two|2)\b|\bsecond round\b/i, s.code);
    }
    assert.doesNotMatch(SECTION_CODE, /\bround (two|2)\b|\bsecond round\b/i);
    assert.ok(SECTION_CODE.includes("next funding sequence"));
  });

  test("no promise words on the caller's screen or in what the rep reads out", async () => {
    const BANNED = [
      /guarantee/i, /\bremov/i, /\bdelet/i, /approval odds/i, /pre-?approv/i,
      /\bwill (be )?(approved|funded)\b/i, /\bget you (approved|funded)\b/i,
      /(raise|boost|increase|improve) your (credit )?score/i, /\bwe will fund\b/i
    ];
    for (const data of STATES) {
      for (const s of await allStackText(data)) {
        const screen = text(withoutFine(s.client));
        for (const re of BANNED) {
          assert.doesNotMatch(screen, re, s.code + " client screen");
          for (const line of s.say) assert.doesNotMatch(line, re, s.code + " say line: " + line);
        }
        for (const f of fineLines(s.client)) {
          assert.match(f, /^No guarantee of |not a promise|not set yet/, s.code + " fine print must be a disclaimer: " + f);
        }
      }
    }
  });

  test("every slide has a watch note, and the selling slides carry the rule", async () => {
    const slides = await allStackText(payload());
    for (const s of slides) assert.ok(s.watch.length > 20, s.code + " has no watch note");
    for (const code of ["B-01", "B-02", "B-04"]) {
      assert.ok(slides.find((s) => s.code === code).watch.includes(NEVER_PROMISE), code + " watch lost the rule");
    }
    const b04 = slides.find((s) => s.code === "B-04").watch;
    assert.match(b04, /S-21/);
    assert.match(b04, /word for word/);
    assert.match(b04, /never for the Blueprint/);
    assert.match(b04, /\$X/);
  });

  test("the funding guarantees on S-21 are word for word what they were", () => {
    const g = JS.slice(JS.indexOf("var GUARANTEES = ["), JS.indexOf("var MENU = ["));
    for (const line of [
      '["G-01 / 24 HOURS", "24-Hour Action Guarantee", "Once you\'re signed on, a funding advisor begins working your file within 24 business hours. If we don\'t act in that window, you\'re protected and you don\'t pay."]',
      '["G-02 / 72 HOURS", "72-Hour Application Guarantee", "Once you\'re signed on, your applications go out within 72 business hours. If we don\'t act in that window, you\'re protected and you don\'t pay."]',
      '["G-03 / FUNDING", "Funding Guarantee", "If you qualify and we don\'t secure funding for you, you don\'t pay. If you get nothing, we earn nothing."]'
    ]) {
      assert.ok(g.includes(line), "a guarantee changed: " + line.slice(0, 40));
    }
    assert.doesNotMatch(SECTION_CODE, /GUARANTEES/, "the Blueprint section must not show the funding guarantees");
  });

  test("items that are not built never appear", async () => {
    const deck = await openDeck(payload());
    deck.click("phase:06").key("ArrowRight").click("stack:partner");
    const slides = [];
    for (let i = 0; i < 5; i++) { slides.push(text(deck.html())); deck.key("ArrowRight"); }
    const all = slides.join(" ") + " " + SECTION_CODE;
    assert.doesNotMatch(all, /welcome kit|mailed package|\bquiz|letter.mailing|pre-application check/i);
  });

  test("the section's own type stays at 11px or more", () => {
    for (const m of SECTION.matchAll(/font-size:\s*(?:clamp\()?\s*([\d.]+)px/g)) {
      assert.ok(Number(m[1]) >= 11, "font-size " + m[1] + "px in the stack section");
    }
  });
});

describe("Yes on the price slide sells the Blueprint", () => {
  async function closeFrom(data, setup) {
    const deck = await openDeck(data);
    if (setup) setup(deck);
    deck.click("phase:06").key("ArrowRight", 3);
    assert.equal(current(deck), "B-04");
    deck.click("stack-close");
    return deck;
  }
  const chosen = "Chosen: " + BLUEPRINT.name + " · " + BLUEPRINT.priceDisplay;

  for (const tier of ["REPAIR_ONLY", "FUNDING_PLUS_REPAIR", "FULL_FUNDING"]) {
    test(tier + " file: S-23 opens with the Capital Blueprint chosen", async () => {
      const deck = await closeFrom(payload({ tier, negItems: tier === "FULL_FUNDING" ? 0 : 2 }));
      assert.equal(current(deck), "S-23");
      assert.ok(text(parts(deck.html()).cockpit).includes(chosen), "S-23 must sell " + chosen);
    });
  }

  test("education route: S-23 opens with the Capital Blueprint chosen", async () => {
    const deck = await closeFrom(payload({ tier: "REPAIR_ONLY" }), (d) => {
      d.click("phase:03").key("ArrowRight", 2);
      assert.equal(current(d), "S-07");
      d.click("edu");
    });
    assert.equal(current(deck), "S-23");
    assert.ok(text(parts(deck.html()).cockpit).includes(chosen));
  });

  test("it uses the descent ladder's own Blueprint states, not a new offer path", () => {
    const fn = SECTION.slice(SECTION.indexOf("function closeBlueprint()"));
    assert.match(fn, /if \(state\.edu\) \{ state\.forceRepair = false; state\.rung = 1; \}/);
    assert.match(fn, /else \{ state\.forceRepair = true; state\.rung = 2; \}/);
    assert.match(JS, /if \(a === "desc:diy"\) \{ state\.edu = false; state\.forceRepair = true; state\.rung = 2;/);
    assert.match(JS, /if \(a === "desc:eduLow"\) \{ state\.forceRepair = false; state\.edu = true; state\.rung = 1;/);
  });
});

describe("FinanceOS demo links: the live tabs, on the sample client", () => {
  function deckTabs() {
    const block = SECTION.slice(SECTION.indexOf("var FOS_TABS = ["), SECTION.indexOf("];", SECTION.indexOf("var FOS_TABS = [")));
    return [...block.matchAll(/\["([a-z]+)", "([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
  }

  test("the deck's tab list is the FinanceOS page's own, in order", () => {
    const page = FOS_JS.slice(FOS_JS.indexOf("var TABS = ["), FOS_JS.indexOf("];", FOS_JS.indexOf("var TABS = [")));
    const pageTabs = [...page.matchAll(/\["([a-z]+)", "([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
    assert.ok(pageTabs.length >= 10, "could not read financeos.js TABS");
    assert.deepEqual(deckTabs(), pageTabs,
      "present.js FOS_TABS and public/app/financeos.js TABS differ. Add or rename the tab in FOS_TABS so every demo link opens a real tab.");
    for (const [k] of deckTabs()) {
      assert.ok(FOS_HTML.includes('href="#' + k + '"'), "financeos.html has no #" + k + " tab");
    }
  });

  test("the demo roles are exactly the /api/money gate (ROLE_SETS.FINANCE_OS)", () => {
    const m = /var FOS_DEMO_ROLES = \[([^\]]*)\];/.exec(SECTION);
    assert.ok(m, "FOS_DEMO_ROLES is gone");
    const roles = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    assert.deepEqual(roles, [...ROLE_SETS.FINANCE_OS].sort());
  });

  for (const role of ["owner", "admin", "sales_manager", "closer"]) {
    test(role + ": every tab opens the sample client in a new tab", async () => {
      const deck = await openDeck(payload(), { role });
      deck.click("phase:06").key("ArrowRight", 2);
      assert.equal(current(deck), "B-03");
      const links = [...parts(deck.html()).cockpit.matchAll(/<a class="ck-btn" href="([^"]+)" target="_blank" rel="noopener">([^<]+)<\/a>/g)];
      assert.deepEqual(links.map((l) => l[2]), deckTabs().map((t) => t[1]));
      for (const [i, [k]] of deckTabs().entries()) {
        assert.equal(links[i][1], "/app/financeos.html?client_id=" + SAMPLE_CLIENT + "#" + k);
      }
      assert.ok(text(parts(deck.html()).cockpit).includes("Test data, not a real person."));
    });
  }

  for (const role of ["setter", null]) {
    test((role || "no cached role") + ": no link that would open an error page", async () => {
      const deck = await openDeck(payload(), { role });
      deck.click("phase:06").key("ArrowRight", 2);
      const ck = parts(deck.html()).cockpit;
      assert.ok(!ck.includes("financeos.html"), "a demo link rendered for a login the server refuses");
      assert.ok(text(ck).includes("This login cannot open FinanceOS for a client."));
    });
  }

  test("the caller's FinanceOS slide lists the same tabs", async () => {
    const deck = await openDeck(payload(), { role: "closer" });
    deck.click("phase:06").key("ArrowRight", 2);
    const chips = [...parts(deck.html()).client.matchAll(/<span class="stk-chip">([^<]+)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(chips, deckTabs().map((t) => t[1]));
  });
});
