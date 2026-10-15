// Finish-853 batch 02: the closer deck's route buttons, practice test.
//
// public/app/present.js is run WHOLE in a vm with a stand-in page (the same way
// src/http/present-blueprint-stack.test.mjs does), with fake deck answers. A button is pressed,
// then the next money send is pressed, and the test reads the exact request that went out and
// what the screen painted. No browser, no network, no database. This is a practice test: it
// proves the page script does what each row says, with fake data, not what a real client saw.
//
// Rows proved here (desks-f.json, surface "present.html (+ present.js, contract-send.js)"):
//   - the screen half of 'Send soft pull ($32 + approval form)' (the saved half is a live check)
//   - Route the call (S-07): FULL FUNDING / FUNDING PLUS REPAIR / REPAIR ONLY buttons
//   - 'UnderwriteIQ package -> repair + funding' bridge button (S-19, repair route)
//   - Descent ladder, 6 buttons
// and the screen half of "S-23 'Sale motion' select" (the saved half is a live check).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { offersForClient } from "../../../config/offers.mjs";
import { REPO_ROOT } from "./fin-b02-sql-kit.mjs";

const PRESENT = path.join(REPO_ROOT, "public/app/present.js");
const JS = fs.readFileSync(PRESENT, "utf8");
const OFFERS = offersForClient();
const CONTACT = "33333333-3333-3333-3333-333333333333";

function payload(tier) {
  return {
    client_id: CONTACT,
    survey: { name: "Sam Sample" },
    businesses: [],
    income_estimates: {},
    engine: {
      available: true, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 },
      total: 20000, afterFix: 60000, negItems: 3, reasons: [], plan: [],
      totalBasis: "personal_only", sample: true
    },
    soft_pull: null,
    offers: OFFERS
  };
}

const flush = () => new Promise((r) => setImmediate(r));

/** The real present.js against a stand-in page that records every write the page makes. */
async function openDeck(tier, { answer = null } = {}) {
  const root = { innerHTML: "" };
  const writes = [];
  const listeners = new Map();
  let onClick = null;
  const select = {
    addEventListener(type, fn) { listeners.set(type, fn); }
  };
  const sandbox = {
    console,
    URLSearchParams,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout,
    location: { search: `?contact=${CONTACT}`, pathname: "/app/present.html" },
    document: {
      readyState: "complete",
      getElementById: (id) => {
        if (id === "app") return root;
        if (id === "fh-sale-motion" && root.innerHTML.includes('id="fh-sale-motion"')) return select;
        return null;
      },
      addEventListener: (type, fn) => { if (type === "click") onClick = fn; }
    },
    localStorage: { getItem: (k) => (k === "fh_role" ? "owner" : null) },
    FHData: {
      read: async () => ({ ok: true, data: payload(tier) }),
      write: async (url, body) => {
        writes.push({ url, body });
        return answer ? answer(url, body) : { ok: true, data: {} };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(JS, sandbox, { filename: PRESENT });
  await flush();
  await flush();
  assert.ok(onClick, "present.js registered no click listener");
  const deck = {
    writes,
    html: () => root.innerHTML,
    click(act) { onClick({ target: { closest: () => ({ getAttribute: () => act }) } }); return deck; },
    pick(value) { listeners.get("change")({ target: { value } }); return deck; },
    slide() {
      const m = /<div class="slide-hd"><span class="mono">([A-Z]-\d\d) \/ /.exec(root.innerHTML);
      return m ? m[1] : null;
    },
    /** The act names of the buttons on screen, and which of them is the lit (primary) one. */
    buttons() {
      return [...root.innerHTML.matchAll(/<button type="button" class="ck-btn( k)?" data-act="([^"]+)"/g)]
        .map((m) => ({ act: m[2], lit: m[1] === " k" }));
    },
    async sendPayLink() {
      const before = writes.length;
      deck.click("stack-go:S-23").click("pay");
      await flush();
      const mine = writes.slice(before).filter((w) => w.body.action === "send_pay_link");
      assert.equal(mine.length, 1, "pressing the pay-link button should send exactly one request");
      assert.equal(mine[0].url, "/api/closer-deck");
      return mine[0].body;
    }
  };
  return deck;
}

/* ── Route the call (S-07) ───────────────────────────────────────────────── */

test("Route the call: the three route buttons are on S-07, the deck's own tier is lit, and each press lights its own", async () => {
  const deck = await openDeck("REPAIR_ONLY");
  deck.click("stack-go:S-07");
  assert.equal(deck.slide(), "S-07");
  const acts = deck.buttons().map((b) => b.act);
  for (const act of ["tier:FULL_FUNDING", "tier:FUNDING_PLUS_REPAIR", "tier:REPAIR_ONLY"]) assert.ok(acts.includes(act), act);
  const lit = (d) => d.buttons().filter((b) => b.lit && b.act.startsWith("tier:")).map((b) => b.act);
  assert.deepEqual(lit(deck), ["tier:REPAIR_ONLY"], "the tier the engine returned starts lit");
  deck.click("tier:FULL_FUNDING");
  assert.deepEqual(lit(deck), ["tier:FULL_FUNDING"]);
  deck.click("tier:FUNDING_PLUS_REPAIR");
  assert.deepEqual(lit(deck), ["tier:FUNDING_PLUS_REPAIR"]);
});

test("Route the call: each button decides the offer, tier and route the pay link goes out with", async () => {
  const cases = [
    ["FULL_FUNDING", "FUNDING_DFY"],
    ["FUNDING_PLUS_REPAIR", "FUNDING_DFY"],
    ["REPAIR_ONLY", "REPAIR_DFY"]
  ];
  for (const [tier, offer] of cases) {
    // Start every case on a different tier so a button that does nothing cannot pass by luck.
    const start = tier === "REPAIR_ONLY" ? "FULL_FUNDING" : "REPAIR_ONLY";
    const deck = await openDeck(start);
    deck.click("stack-go:S-07").click(`tier:${tier}`);
    const body = await deck.sendPayLink();
    assert.equal(body.offer_key, offer, `${tier} sells ${offer}`);
    assert.equal(body.tier, tier);
    assert.equal(body.route, tier);
    assert.equal(body.client_id, CONTACT);
    assert.equal(body.edu, false);
    assert.equal(body.force_repair, false);
  }
});

test("Route the call: choosing a route clears an earlier descent or education pick", async () => {
  const deck = await openDeck("REPAIR_ONLY");
  deck.click("desc:eduTop"); // education route
  deck.click("stack-go:S-07").click("tier:FULL_FUNDING");
  const body = await deck.sendPayLink();
  assert.equal(body.edu, false);
  assert.equal(body.force_repair, false);
  assert.equal(body.route, "FULL_FUNDING");
  assert.equal(body.offer_key, "FUNDING_DFY");
});

/* ── the bridge button (S-19) ────────────────────────────────────────────── */

test("Bridge button: shown on S-19 for a repair deck, sets funding plus repair, and jumps to the funding pitch S-08", async () => {
  const deck = await openDeck("REPAIR_ONLY");
  deck.click("stack-go:S-19");
  assert.equal(deck.slide(), "S-19");
  assert.ok(deck.buttons().some((b) => b.act === "bridge"), "the bridge button is on S-19");
  assert.match(deck.html(), /UnderwriteIQ package/);
  deck.click("bridge");
  assert.equal(deck.slide(), "S-08");
  const body = await deck.sendPayLink();
  assert.equal(body.tier, "FUNDING_PLUS_REPAIR");
  assert.equal(body.route, "FUNDING_PLUS_REPAIR");
  assert.equal(body.offer_key, "FUNDING_DFY");
});

test("Bridge button: it also takes the deck off a descent rung and off the education route", async () => {
  const deck = await openDeck("REPAIR_ONLY");
  deck.click("desc:trial"); // repair trial rung, forced repair
  deck.click("stack-go:S-19").click("bridge");
  let body = await deck.sendPayLink();
  assert.equal(body.offer_key, "FUNDING_DFY");
  assert.equal(body.force_repair, false);
  assert.equal(body.route, "FUNDING_PLUS_REPAIR");

  const edu = await openDeck("REPAIR_ONLY");
  edu.click("edu"); // education path
  edu.click("stack-go:S-19");
  assert.ok(!edu.buttons().some((b) => b.act === "bridge"), "no bridge on the education route");
  edu.click("desc:dfy").click("stack-go:S-19").click("bridge");
  body = await edu.sendPayLink();
  assert.equal(body.edu, false);
  assert.equal(body.offer_key, "FUNDING_DFY");
});

test("Bridge button: not offered when the deck is already on a funding route", async () => {
  const deck = await openDeck("FULL_FUNDING");
  deck.click("stack-go:S-19");
  assert.ok(!deck.buttons().some((b) => b.act === "bridge"));
});

/* ── Descent ladder, 6 buttons (05 Commit and 07 Close) ──────────────────── */

const LADDER = [
  // act, label start, offer the pay link goes out with, force_repair, edu, route
  ["desc:fund", "Funding", "FUNDING_DFY", false, false],
  ["desc:dfy", "Repair DFY", "REPAIR_DFY", true, false],
  ["desc:trial", "Repair trial round", "REPAIR_TRIAL", true, false],
  ["desc:diy", "DIY letters + course", "UWIQ_DELIVERABLES", true, false],
  ["desc:eduTop", "Funding Mastery", "FUNDING_MASTERY", false, true],
  ["desc:eduLow", "Education deliverables", "UWIQ_DELIVERABLES", false, true]
];

test("Descent ladder: all six buttons are on S-19 and S-23, in order, with the catalog price on each", async () => {
  const deck = await openDeck("FULL_FUNDING");
  for (const slide of ["S-19", "S-23"]) {
    deck.click(`stack-go:${slide}`);
    assert.equal(deck.slide(), slide);
    const acts = [...deck.html().matchAll(/<button type="button" data-act="(desc:[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(acts, LADDER.map((r) => r[0]));
  }
  const html = deck.html();
  const priceOf = (key) => OFFERS.find((o) => o.key === key).priceDisplay;
  assert.ok(html.includes(`Funding · ${priceOf("FUNDING_DFY")} deposit`));
  assert.ok(html.includes(`Repair DFY · ${priceOf("REPAIR_DFY")}`));
  assert.ok(html.includes(`Repair trial round · ${priceOf("REPAIR_TRIAL")}`));
  assert.ok(html.includes(`DIY letters + course · ${priceOf("UWIQ_DELIVERABLES")}`));
  assert.ok(html.includes(`Funding Mastery · ${priceOf("FUNDING_MASTERY")}`));
  assert.ok(html.includes(`Education deliverables · ${priceOf("UWIQ_DELIVERABLES")}`));
});

// Known and left alone (product finding, not pinned here): on a deck whose engine tier is REPAIR_ONLY the
// "Funding" rung changes nothing, because isFunding() also needs a funding tier. The Funding rung is
// proved below on a funding-tier deck, which is where it is the top of the ladder.
test("Descent ladder: each rung sells its own offer, sets its own route, and only that rung is lit", async () => {
  for (const [act, label, offer, forceRepair, edu] of LADDER) {
    // A funding deck, so the Funding rung is a real change from where each rung is being asked.
    const deck = await openDeck("FULL_FUNDING");
    deck.click("stack-go:S-23");
    // Press a different rung first, so pressing this one is a real move.
    deck.click(act === "desc:dfy" ? "desc:trial" : "desc:dfy");
    deck.click("stack-go:S-23"); // and leave S-19, so the jump back to it is this press's own
    assert.equal(deck.slide(), "S-23");
    deck.click(act);
    assert.equal(deck.slide(), "S-19", `${act} jumps to the ladder slide`);
    deck.click("stack-go:S-23");
    const html = deck.html();
    const lit = [...html.matchAll(/<button type="button" data-act="(desc:[^"]+)" style="[^"]*background:var\(--ink\)/g)].map((m) => m[1]);
    assert.deepEqual(lit, [act], `${label} is the one lit rung`);
    const body = await deck.sendPayLink();
    assert.equal(body.offer_key, offer, `${label} sells ${offer}`);
    assert.equal(body.force_repair, forceRepair, `${label} force_repair`);
    assert.equal(body.edu, edu, `${label} edu`);
    const expectedRoute = edu ? "EDUCATION" : forceRepair ? "DESCENT" : "FULL_FUNDING";
    assert.equal(body.route, expectedRoute, `${label} route`);
    // No pick was made on the sale-motion select, so no motion goes out on any rung.
    assert.equal(body.sale_motion, null);
  }
});

test("Descent ladder: pressing any rung after any other lands on that rung's own offer (all 36 pairs)", async () => {
  for (const [from] of LADDER) {
    for (const [to, label, offer, forceRepair, edu] of LADDER) {
      const deck = await openDeck("FULL_FUNDING");
      deck.click(from).click(to).click("stack-go:S-23");
      const body = await deck.sendPayLink();
      assert.equal(body.offer_key, offer, `${from} then ${label} sells ${offer}`);
      assert.equal(body.force_repair, forceRepair, `${from} then ${label}: force_repair`);
      assert.equal(body.edu, edu, `${from} then ${label}: edu`);
    }
  }
});

test("Route the call: a route button after any rung wipes that rung and sells the route's own offer", async () => {
  const routes = [["FULL_FUNDING", "FUNDING_DFY"], ["FUNDING_PLUS_REPAIR", "FUNDING_DFY"], ["REPAIR_ONLY", "REPAIR_DFY"]];
  for (const [rung] of LADDER) {
    for (const [tier, offer] of routes) {
      const deck = await openDeck("FULL_FUNDING");
      deck.click(rung).click("stack-go:S-07").click(`tier:${tier}`);
      const body = await deck.sendPayLink();
      assert.equal(body.offer_key, offer, `${rung} then ${tier} sells ${offer}`);
      assert.equal(body.force_repair, false, `${rung} then ${tier}: force_repair`);
      assert.equal(body.edu, false, `${rung} then ${tier}: edu`);
      assert.equal(body.route, tier);
    }
  }
});

test("Descent ladder: the three repair rungs and the two education rungs keep their own rung number", async () => {
  const rungs = [["desc:dfy", 0], ["desc:trial", 1], ["desc:diy", 2]];
  for (const [act, n] of rungs) {
    const deck = await openDeck("REPAIR_ONLY");
    deck.click(act).click("stack-go:S-19");
    const lit = deck.buttons().filter((b) => b.lit && b.act.startsWith("rung:")).map((b) => b.act);
    assert.deepEqual(lit, [`rung:${n}`], act);
  }
  for (const [act, n] of [["desc:eduTop", 0], ["desc:eduLow", 1]]) {
    const deck = await openDeck("REPAIR_ONLY");
    deck.click(act).click("stack-go:S-19");
    const lit = deck.buttons().filter((b) => b.lit && b.act.startsWith("rung:")).map((b) => b.act);
    assert.deepEqual(lit, [`rung:${n}`], act);
  }
});

/* ── S-23 sale motion select: the screen half ────────────────────────────── */

test("Sale motion select: shown only for the offers that are not primary, and its pick goes out with the pay link", async () => {
  // The Blueprint rung (DIY deliverables) is not a primary offer: the select is drawn.
  const deck = await openDeck("REPAIR_ONLY");
  deck.click("desc:diy").click("stack-go:S-23");
  assert.match(deck.html(), /id="fh-sale-motion"/);
  assert.match(deck.html(), /<option value="downsell"/);
  assert.match(deck.html(), /<option value="upsell"/);
  let body = await deck.sendPayLink();
  assert.equal(body.offer_key, "UWIQ_DELIVERABLES");
  assert.equal(body.sale_motion, null, "no pick yet, no motion");

  // Pick Upsell, press again on a fresh deck so the send cool-down does not hide the press.
  const picked = await openDeck("REPAIR_ONLY");
  picked.click("desc:diy").click("stack-go:S-23");
  picked.pick("upsell");
  body = await picked.sendPayLink();
  assert.equal(body.sale_motion, "upsell");
  const picked2 = await openDeck("REPAIR_ONLY");
  picked2.click("desc:diy").click("stack-go:S-23");
  picked2.pick("downsell");
  body = await picked2.sendPayLink();
  assert.equal(body.sale_motion, "downsell");
});

test("Sale motion select: not drawn for the four primary offers, and a pick made earlier is never sent for them", async () => {
  const primary = [["desc:fund", "FUNDING_DFY"], ["desc:dfy", "REPAIR_DFY"], ["desc:trial", "REPAIR_TRIAL"], ["desc:eduTop", "FUNDING_MASTERY"]];
  for (const [act, offer] of primary) {
    const deck = await openDeck("FULL_FUNDING");
    // Make a pick on the Blueprint rung first, then move to a primary rung.
    deck.click("desc:diy").click("stack-go:S-23");
    deck.pick("downsell");
    deck.click(act).click("stack-go:S-23");
    assert.doesNotMatch(deck.html(), /id="fh-sale-motion"/, `${act} draws no select`);
    const body = await deck.sendPayLink();
    assert.equal(body.offer_key, offer);
    assert.equal(body.sale_motion, null, `${act} never sends a motion`);
  }
});

/* ── 'Send soft pull ($32 + approval form)': the screen half ─────────────── */

test("Send soft pull: one press sends one send_soft_pull for this client, says so, and a second press is held off", async () => {
  const deck = await openDeck("FULL_FUNDING");
  deck.click("stack-go:S-06");
  assert.equal(deck.slide(), "S-06");
  assert.match(deck.html(), /Send soft pull \(\$32 \+ approval form\)/);
  assert.match(deck.html(), /Catalog price \$32\./);
  deck.click("softpull");
  await flush();
  const sends = deck.writes.filter((w) => w.body.action === "send_soft_pull");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].url, "/api/closer-deck");
  assert.equal(sends[0].body.client_id, CONTACT);
  assert.match(deck.html(), /Soft pull emailed — pay link \+ approval form\./);
  // Two more presses in the cool-down send nothing: this is what stopped two pay links for one sale.
  deck.click("softpull").click("softpull");
  await flush();
  assert.equal(deck.writes.filter((w) => w.body.action === "send_soft_pull").length, 1);
});

test("Send soft pull: a refusal is said in the server's words, nothing is claimed sent, and the press can be retried", async () => {
  let refuse = true;
  const deck = await openDeck("FULL_FUNDING", {
    answer: () => (refuse ? { ok: false, error: { message: "No checkout key is set" } } : { ok: true, data: {} })
  });
  deck.click("stack-go:S-06").click("softpull");
  await flush();
  assert.match(deck.html(), /No checkout key is set/);
  assert.doesNotMatch(deck.html(), /Soft pull emailed/);
  refuse = false;
  deck.click("softpull");
  await flush();
  assert.equal(deck.writes.filter((w) => w.body.action === "send_soft_pull").length, 2);
  assert.match(deck.html(), /Soft pull emailed/);
});
