// Batch 17 (repair cycle 1): the closer's client deck (public/app/present.html), run as the page it is.
//
// fin-b17-present.test.mjs runs present.js whole in a vm against a stand-in page. That judges the deck's
// logic and not the page: its stand-in answers closest() and getAttribute() for any name, and it never
// loads present.html. This file loads the real page, with the real present.js, contract-send.js and
// data.js, in a real Chromium with fake /api answers, and uses it the way a closer does: it clicks the
// buttons that are on the screen, strikes the keys, and reads what is visible and where it sits.
//
//   Back, Next and the arrow keys      real clicks on the footer buttons, real key strikes, typing guard
//   Client screen only                 the client half fills the window, the cockpit is gone, typed words stay
//   the seven belief boxes             real clicks, the question under each, ticks kept across Back and Next
//   the six objections                 on every slide of 7 The ask and 9 Paperwork and nowhere else
//   the nine phase buttons             every slide of every part is named and lit right, by walking the deck
//   the visual slots                   stand-in visual files loaded by the page's own script tags, drawn where
//                                      10.0 places them; without them, today's slides
//   the two walls                      a refused account (401 and 403 through the real data.js) and no client
//
// No live data. Nothing leaves the browser: every request that is not the local page is refused, and every
// /api answer is the test's own.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { offersForClient } from "../../../config/offers.mjs";
import { proofRows, waitFor } from "./fin-b17-kit.mjs";
import { asRole, json, sharedScreens } from "./fin-b17-browser-kit.mjs";
import {
  BELIEFS, CATALOG_PHASE_ROWS, MAIN_RUN, OBJECTION_SLIDES, OBJECTION_TABLE, PHASE_BUTTONS, REPAIR_RUN, SLIDES,
} from "./fin-b17-present-data.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const CONTACT = "33333333-3333-3333-3333-333333333333";
const OFFERS = offersForClient();
const PAGE = "/app/present.html";
const VIEWPORT = { width: 1280, height: 900 };

// The course is off until it is filmed (COURSE_LIVE in present.js): the education route is judged with the one
// switch on, in the script the browser is served.
const PRESENT_JS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/app/present.js"), "utf8");
const COURSE_OFF = "var COURSE_LIVE = false;";
assert.ok(PRESENT_JS.includes(COURSE_OFF), "present.js lost its one course switch");
const PRESENT_JS_COURSE = PRESENT_JS.replace(COURSE_OFF, "var COURSE_LIVE = true;");

// Stand-ins for the slide visual files (section 10.8), served at the paths present.html names. Each draws a
// marked block and says which door it was handed.
const VISUAL_FILES = {
  "present-visuals.js": ["yourPath", "fileFindings", "moneyLevers", "lenderWall", "companies"],
  "present-framework.js": ["callMap", "alignment", "goalLine", "pullSplit", "blindMatched", "revenueSplit", "sequence", "clock", "partnerStaircase", "blueprintRoute", "doorMatrix", "moneyStrip", "guarantees", "nextSteps", "iceberg"],
  "present-blueprint-demo.js": ["blueprintDemo"],
  "present-journey.js": ["journey"],
  "present-proof-wall.js": ["proofWall"],
};
const standIn = (names) => `(function () { var v = window.FHDeckVisuals = window.FHDeckVisuals || {}; ${names
  .map((n) => `v.${n} = function (ctx) { return '<div data-fhv="${n}" data-door="' + ctx.door + '">${n} drawn</div>'; };`).join(" ")} })();`;

function payload({ tier = "FULL_FUNDING", negItems = 3, visual = undefined } = {}) {
  return {
    ok: true,
    client_id: CONTACT,
    survey: { name: "Sam Sample" },
    businesses: [],
    income_estimates: {},
    engine: {
      available: true, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 },
      total: 20000, afterFix: 60000, negItems, reasons: [], plan: [],
      totalBasis: "personal_only", sample: false,
      ...(visual === undefined ? {} : { visual }),
    },
    soft_pull: { consent_valid: true, diagnostic_paid: true, pull_status: "complete", crs_result_id: "page-proof-result", sample: false },
    offers: OFFERS,
  };
}

/** The deck page, open, with fake answers. `calls` holds every read and write the page made. */
async function openDeck({ search = `?contact=${CONTACT}`, role = "owner", status = 200, body = null, tier = "FULL_FUNDING", settle = true, visuals = false, course = false } = {}) {
  const calls = { reads: [], writes: [] };
  const handlers = {
    "/api/read/closer-deck": async (route) => {
      calls.reads.push(new URL(route.request().url()).search);
      return json(route, body ?? payload({ tier, visual: visuals ? { source: "sample" } : undefined }), status);
    },
    "/api/closer-deck": async (route) => {
      calls.writes.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, { ok: true });
    },
  };
  const before = async (page) => {
    if (visuals) {
      for (const [file, names] of Object.entries(VISUAL_FILES)) {
        await page.route(`**/app/${file}`, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: standIn(names) }));
      }
    } else {
      // The real visual files ship now; "no visual file on the server" is served as a 404 on purpose.
      for (const file of Object.keys(VISUAL_FILES)) {
        await page.route(`**/app/${file}`, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
      }
    }
    if (course) await page.route("**/app/present.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: PRESENT_JS_COURSE }));
  };
  const { page, errors } = await screens.open(`${PAGE}${search}`, { session: asRole(role), handlers, viewport: VIEWPORT, before });
  page.setDefaultTimeout(8000);
  if (settle) await page.locator('[data-act="next"]').waitFor({ state: "visible" });
  return { page, errors, calls };
}

// ───────────────────────────── what a closer sees ─────────────────────────────

const act = (page, name) => page.locator(`[data-act="${name}"]`);
const slideCode = async (page) => (await page.locator(".slide-hd .mono").first().textContent()).split(" / ")[0];
const header = (page) => page.locator(".ck-hd .mono").evaluateAll((els) => els.map((el) => el.textContent));
/** The strip buttons that are painted as lit, by their number (the button shows the part's name). */
const litPhases = (page) => page.evaluate(() => [...document.querySelectorAll('.ck-ph [data-act^="phase:"]')]
  .filter((b) => { const bg = getComputedStyle(b).backgroundColor; return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent"; })
  .map((b) => b.getAttribute("data-act").slice(6)));
const cockpitText = (page) => page.locator(".cockpit").innerText();
const says = (page) => page.locator(".cockpit .say").evaluateAll((els) => els.map((el) => el.textContent));
const objectionLabels = (page) => page.evaluate(() => [...document.querySelectorAll('.cockpit [data-act^="obj:"]')]
  .map((b) => [b.getAttribute("data-act"), b.textContent.trim()]));
/** The objection buttons that are actually drawn: a box with size, not hidden, inside the cockpit. */
const objectionsDrawn = (page) => page.evaluate(() => [...document.querySelectorAll('.cockpit [data-act^="obj:"]')]
  .filter((b) => { const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; }).length);
const next = (page) => act(page, "next").click();
const back = (page) => act(page, "back").click();

/** Where the strip, header and phase name say the deck is. */
async function where(page) {
  const [phase, position] = await header(page);
  return { code: await slideCode(page), phase, position, lit: await litPhases(page) };
}

/** Walk the deck with real Next clicks to its last slide, then the Blueprint slides through the buttons a person
 *  presses (a funding file: the ask's Capital Blueprint rung and S-19's stack button), then B-05 and B-06 by
 *  their own buttons, and write down each slide. */
async function walkDeck(page) {
  const seen = [];
  const note = async () => {
    const at = await where(page);
    seen.push({ ...at, objections: (await objectionLabels(page)).length, drawn: await objectionsDrawn(page), hasNext: await act(page, "next").isVisible() });
  };
  assert.equal(await slideCode(page), "S-01");
  await note();
  while (!(await act(page, "next").isDisabled())) {
    await next(page);
    await note();
  }
  if (!seen.some((s) => s.code === "B-01")) {
    await act(page, "phase:07").click();
    await act(page, "desc:diy").click();
    await act(page, "stack-open").click();
    await note();
    for (let i = 0; i < 3; i += 1) { await next(page); await note(); }
  } else {
    await act(page, "phase:06").click();
    for (let i = 0; i < 3; i += 1) await next(page);
  }
  assert.equal(await slideCode(page), "B-04");
  await act(page, "stack-go:B-05").click();
  await note();
  await act(page, "stack-go:B-06").click();
  await note();
  return seen;
}

const PHASE_NUMBER = Object.fromEntries(PHASE_BUTTONS.map(([n, name]) => [name, n]));
const WANT = (code) => {
  const phase = SLIDES.find(([c]) => c === code)[1];
  // The Blueprint detour is Door 3: P-01, a funding-only slide, is counted out there.
  const length = SLIDES.length - (code.startsWith("B-") ? 1 : 0);
  return { code, phase, position: `${SLIDES.findIndex(([c]) => c === code) + 1} / ${length}`, lit: [PHASE_NUMBER[phase]] };
};

// ───────────────────────────── Back, Next, the arrow keys ─────────────────────────────

test("the Back and Next buttons are on the screen and press, the arrow keys do the same, and the keys keep out of a box being typed in", { timeout: 120_000 }, async () => {
  await proof.check(/^Back and Next screen buttons, ArrowLeft and ArrowRight keys/, async () => {
    const { page, errors, calls } = await openDeck();
    assert.equal(await slideCode(page), "S-01");

    // both buttons are drawn, inside the window, with room to press
    for (const [name, words] of [["back", "Back"], ["next", "Next screen"]]) {
      const button = page.locator(`.ck-ft [data-act="${name}"]`);
      assert.equal(await button.isVisible(), true, `${name} is on the screen`);
      assert.equal((await button.textContent()).trim(), words);
      const box = await button.boundingBox();
      assert.ok(box && box.width >= 40 && box.height >= 20, `${name} has room to press: ${JSON.stringify(box)}`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= VIEWPORT.width && box.y + box.height <= VIEWPORT.height, `${name} is inside the window`);
    }
    assert.equal(await act(page, "back").isDisabled(), true, "nothing comes before the first slide");
    assert.equal(await act(page, "next").isDisabled(), false);

    // a real press on each
    await next(page);
    assert.equal(await slideCode(page), "S-02");
    assert.equal(await act(page, "back").isDisabled(), false);
    await back(page);
    assert.equal(await slideCode(page), "S-01");

    // the arrow keys are the same two buttons; no other key moves the deck
    await page.keyboard.press("ArrowRight");
    assert.equal(await slideCode(page), "S-02");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await slideCode(page), "S-01");
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Space"]) await page.keyboard.press(key);
    assert.equal(await slideCode(page), "S-01", "no other key moves the deck");

    // a person typing in the cost box keeps the arrow keys to themselves
    await act(page, "phase:02").click();
    assert.equal(await slideCode(page), "S-03");
    await page.locator("#fh-cost").click();
    await page.keyboard.type("4500");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await slideCode(page), "S-03", "the arrow keys stayed in the box");
    assert.equal(await page.locator("#fh-cost").inputValue(), "4500");
    await page.locator("#fh-cost").evaluate((el) => el.blur());
    await page.keyboard.press("ArrowRight");
    assert.equal(await slideCode(page), "S-04", "out of the box the key walks the deck");

    // the whole run, one real press at a time. A funding file steps over the six Blueprint slides (between S-08 and
    // S-09), and the two visual slides show only when their visual draws.
    await act(page, "phase:01").click();
    const forward = [await slideCode(page)];
    while (!(await act(page, "next").isDisabled())) { await next(page); forward.push(await slideCode(page)); }
    assert.deepEqual(forward, MAIN_RUN);
    assert.equal(await act(page, "next").isDisabled(), true, "nothing comes after the last slide");
    await page.keyboard.press("ArrowRight");
    assert.equal(await slideCode(page), "S-24");
    const backward = [await slideCode(page)];
    while (!(await act(page, "back").isDisabled())) { await back(page); backward.push(await slideCode(page)); }
    assert.deepEqual(backward, [...MAIN_RUN].reverse());

    assert.deepEqual(calls.writes, [], "moving through the deck saves nothing");
    assert.deepEqual(errors, []);
    await page.close();

    // a repair file walks Door 3 (B-01 to B-04) inside part 6, then Door 4 from S-09; B-05 and B-06 stay out
    const repair = await openDeck({ tier: "REPAIR_ONLY" });
    const walked = [await slideCode(repair.page)];
    while (!(await act(repair.page, "next").isDisabled())) { await next(repair.page); walked.push(await slideCode(repair.page)); }
    assert.deepEqual(walked, REPAIR_RUN);
    await act(repair.page, "phase:06").click();
    assert.equal(await slideCode(repair.page), "B-01");
    for (let i = 0; i < 3; i += 1) await next(repair.page);
    assert.equal(await slideCode(repair.page), "B-04");
    await next(repair.page);
    assert.equal(await slideCode(repair.page), "S-09", "B-04 leads on to S-09");
    await back(repair.page);
    assert.equal(await slideCode(repair.page), "B-04", "and back into the Blueprint, not B-06");
    await act(repair.page, "phase:06").click();
    await back(repair.page);
    assert.equal(await slideCode(repair.page), "S-08", "B-01 leads back to S-08");
    assert.deepEqual(repair.errors, []);
    await repair.page.close();
  });

  await proof.check(/^Back and Next screen buttons, ArrowLeft and ArrowRight keys/, async () => {
    // the education route skips S-11 .. S-16 in both directions, by real presses (the course switch on)
    const { page, errors } = await openDeck({ tier: "REPAIR_ONLY", course: true });
    await act(page, "phase:03").click();
    await next(page);
    await next(page);
    assert.equal(await slideCode(page), "S-07");
    await act(page, "edu").click();
    await act(page, "phase:05").click();
    const seen = [await slideCode(page)];
    for (let i = 0; i < 4; i += 1) { await next(page); seen.push(await slideCode(page)); }
    assert.deepEqual(seen, ["S-08", "S-09", "S-10", "S-17", "S-18"]);
    await back(page);
    await back(page);
    assert.equal(await slideCode(page), "S-10");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── Client screen only ─────────────────────────────

test("Client screen only gives the client half the whole window, takes the cockpit away, and brings it back with everything that was typed", { timeout: 120_000 }, async () => {
  await proof.check(/^Client screen only \/ Show cockpit toggle/, async () => {
    const { page, errors, calls } = await openDeck();
    await act(page, "phase:02").click();
    assert.equal(await slideCode(page), "S-03");
    // words typed and boxes ticked before the toggle
    await page.locator("#fh-cost").fill("$4,500 a month");
    await act(page, "check:Pain").click();
    await act(page, "check:Trust").click();

    const boxes = () => page.evaluate(() => {
      const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height }; };
      const visible = (sel) => { const el = document.querySelector(sel); if (!el) return false; const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().width > 0; };
      return {
        stage: rect(".stage"), client: rect(".client"), cockpit: rect(".cockpit"), cockpitVisible: visible(".cockpit"),
        clientBorder: getComputedStyle(document.querySelector(".client")).borderRightWidth,
        solo: document.querySelector(".client").classList.contains("solo"),
      };
    });

    // the toggle itself is on the screen, in the top bar, in both of its states
    const toggleShown = async () => {
      const box = await act(page, "client-only").boundingBox();
      return Boolean(box && box.width > 20 && box.height > 10 && box.x >= 0 && box.y >= 0 && box.x + box.width <= VIEWPORT.width && box.y + box.height <= 80);
    };
    assert.equal(await toggleShown(), true, "the Client screen only button is in the top bar");

    // with the cockpit: it is drawn, 340 wide, on the right, and the client half takes the rest
    let b = await boxes();
    assert.equal(await act(page, "client-only").textContent().then((t) => t.trim()), "Client screen only");
    assert.equal(b.cockpitVisible, true, "the cockpit is on the screen");
    assert.ok(Math.abs(b.cockpit.width - 340) <= 1, `the cockpit is 340 wide: ${b.cockpit.width}`);
    assert.ok(b.client.width > 800 && Math.abs(b.client.width + b.cockpit.width - b.stage.width) <= 2, `the client half takes the rest: ${JSON.stringify(b)}`);
    assert.equal(b.solo, false);
    assert.equal(b.clientBorder, "1px", "the client half has its dividing line while the cockpit sits beside it");

    // client screen only: the cockpit is gone, its buttons with it, the client half fills the window
    await act(page, "client-only").click();
    b = await boxes();
    assert.equal((await act(page, "client-only").textContent()).trim(), "Show cockpit");
    assert.equal(await toggleShown(), true, "and Show cockpit is where a person can press it");
    assert.equal(b.cockpitVisible, false, "no cockpit is on the screen to share");
    assert.equal(await page.locator(".cockpit").count(), 0);
    assert.equal(await act(page, "next").count(), 0, "and its buttons are gone");
    assert.equal(b.solo, true);
    assert.ok(Math.abs(b.client.width - b.stage.width) <= 1, `the client half fills the window: ${b.client.width} of ${b.stage.width}`);
    assert.ok(b.client.width >= VIEWPORT.width - 2, "all of the window");
    assert.equal(b.clientBorder, "0px", "no line down the right side of a shared screen");
    assert.equal(await slideCode(page), "S-03", "the client slide did not change");
    // the arrow keys still walk the deck with the cockpit hidden
    await page.keyboard.press("ArrowRight");
    assert.equal(await slideCode(page), "S-04");
    assert.equal((await act(page, "client-only").textContent()).trim(), "Show cockpit", "it stays hidden until asked back");

    // back: the cockpit returns, and the typed words and ticks are where they were left
    await act(page, "client-only").click();
    b = await boxes();
    assert.equal(b.cockpitVisible, true);
    assert.ok(Math.abs(b.cockpit.width - 340) <= 1);
    assert.equal(b.solo, false);
    assert.equal(await slideCode(page), "S-04");
    assert.equal(await page.locator("#fh-cost").inputValue(), "$4,500 a month", "the typed words are still there");
    await act(page, "phase:03").click();
    assert.match(await cockpitText(page), /beliefs 2\/7/, "both ticks are still counted");
    assert.deepEqual(calls.writes, [], "hiding the cockpit sends nothing");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── the seven beliefs ─────────────────────────────

test("the seven belief boxes are drawn with their question, tick and untick on a real click, and keep their ticks across Back and Next", { timeout: 120_000 }, async () => {
  await proof.check(/^Discovery: 7 belief checkboxes/, async () => {
    const { page, errors, calls } = await openDeck({ tier: "REPAIR_ONLY" });
    await act(page, "phase:02").click();
    assert.equal(await slideCode(page), "S-03");

    const boxes = () => page.evaluate(() => [...document.querySelectorAll('.cockpit [data-act^="check:"]')].map((button) => {
      const spans = button.querySelectorAll("span span");
      const tick = getComputedStyle(button.firstElementChild).backgroundColor;
      return {
        act: button.getAttribute("data-act"),
        word: spans[0] && spans[0].textContent,
        question: spans[1] && spans[1].textContent,
        on: tick !== "rgba(0, 0, 0, 0)" && tick !== "transparent",
        visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
      };
    }));
    const on = async () => (await boxes()).filter((x) => x.on).map((x) => x.word);

    // seven boxes, in this order, each with its question under it
    let now = await boxes();
    assert.deepEqual(now.map((x) => x.word), BELIEFS.map(([word]) => word));
    assert.deepEqual(now.map((x) => x.act), BELIEFS.map(([word]) => `check:${word}`));
    assert.deepEqual(now.map((x) => x.question), BELIEFS.map(([, question]) => question), "the question under each box, word for word");
    assert.ok(now.every((x) => x.visible), "every box is on the screen");
    assert.match(await cockpitText(page), /7 beliefs/i);
    assert.deepEqual(await on(), [], "none is ticked to begin with");

    // real clicks tick and untick
    await act(page, "check:Pain").click();
    await act(page, "check:Trust").click();
    assert.deepEqual(await on(), ["Pain", "Trust"]);
    await act(page, "check:Pain").click();
    assert.deepEqual(await on(), ["Trust"], "pressing it again unticks it");
    await act(page, "check:Money").click();
    assert.deepEqual(await on(), ["Money", "Trust"]);

    // the ticks are kept when the deck moves, forward and back, within Discovery and out of it and home again
    await next(page);
    assert.equal(await slideCode(page), "S-04");
    assert.deepEqual(await on(), ["Money", "Trust"], "ticks kept on the next Discovery slide");
    await back(page);
    assert.equal(await slideCode(page), "S-03");
    assert.deepEqual(await on(), ["Money", "Trust"], "ticks kept coming back");
    await next(page);
    await next(page);
    assert.equal(await slideCode(page), "S-05");
    assert.match(await cockpitText(page), /beliefs 2\/7/, "the count shows on the engine line of the next phase");
    await back(page);
    await back(page);
    assert.deepEqual(await on(), ["Money", "Trust"]);

    // and the count goes out with the disposition
    await act(page, "phase:09").click();
    await act(page, "disp").click();
    await waitFor(() => calls.writes.length === 1, "the disposition");
    assert.equal(calls.writes[0].action, "log_disposition");
    assert.equal(calls.writes[0].beliefs_count, 2);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── objections ─────────────────────────────

test("the six objection buttons are on every slide of 7 The ask and 9 Paperwork and nowhere else, and each opens its three lines and jumps where it says", { timeout: 180_000 }, async () => {
  await proof.check(/^Objections: 6 buttons/, async () => {
    const { page, errors, calls } = await openDeck({ visuals: true });

    // where the list is: found by walking the deck with real presses
    const seen = await walkDeck(page);
    assert.equal(seen.length, SLIDES.length);
    for (const slide of seen) {
      const listed = OBJECTION_SLIDES.includes(slide.code);
      assert.equal(slide.objections, listed ? 6 : 0, `${slide.code}: ${listed ? "the six objections are on this slide" : "no objection buttons here"}`);
      assert.equal(slide.drawn, listed ? 6 : 0, `${slide.code}: ${listed ? "and all six are drawn where they can be pressed" : "none drawn"}`);
    }

    // from the first slide of each of the two phases that show them, press every button
    for (const [strip, first] of [["phase:07", "S-17"], ["phase:09", "S-23"]]) {
      await act(page, strip).click();
      assert.equal(await slideCode(page), first);
      assert.deepEqual(await objectionLabels(page), OBJECTION_TABLE.map((o, i) => [`obj:${i}`, o.title]));
      assert.match(await cockpitText(page), /Reframes/i);

      for (const [i, o] of OBJECTION_TABLE.entries()) {
        await act(page, `obj:${i}`).click();
        assert.equal(await slideCode(page), first, "opening an objection does not move the client's screen");
        const text = await cockpitText(page);
        const escaped = o.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(text, new RegExp(`objection\\s+back\\s+${escaped}\\s`, "i"), `${o.title}: its panel is open and named: ${text.slice(0, 120)}`);
        assert.deepEqual(await says(page), o.lines, `${first} / ${o.title}: all three lines, word for word`);
        assert.equal(await act(page, "obj-back").isVisible(), true);
        const jump = act(page, `obj-jump:${o.target}`);
        assert.equal(await jump.isVisible(), true, `${o.title}: the jump button leads to ${o.target}`);
        assert.equal((await jump.textContent()).trim(), o.jumpLabel);
        assert.equal(await act(page, "obj:0").count(), 0, "the panel replaces the list");

        await act(page, "obj-back").click();
        assert.equal((await objectionLabels(page)).length, 6, `${o.title}: Back returns to the list`);

        await act(page, `obj:${i}`).click();
        await jump.click();
        assert.equal(await slideCode(page), o.target, `${o.title}: the jump goes to ${o.target}`);
        assert.equal(await act(page, "obj-back").count(), 0, "the jump closes the objection");
        await act(page, strip).click();
      }
      // Next closes an open objection
      await act(page, "obj:1").click();
      await next(page);
      assert.equal(await act(page, "obj-back").count(), 0);
      await act(page, strip).click();
    }
    assert.deepEqual(calls.writes, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── the phase strip ─────────────────────────────

// The first slide each button opens on the funding file openDeck() shows: part 6 opens Door 1 (S-09), because a
// funding file steps over the Blueprint. 08, Money, has no slide and is judged on its own below.
const FIRST_FUNDING = { "06": "S-09" };

for (const [n, phaseName, slides] of PHASE_BUTTONS.filter(([x]) => x !== "08")) {
  test(`phase strip button ${n} opens the first slide of "${phaseName}", and every one of its slides is named "${phaseName}" and lights only ${n}`, { timeout: 120_000 }, async () => {
    const run = async () => {
      const { page, errors, calls } = await openDeck({ visuals: true });

      // the strip is drawn on every slide: nine buttons, with the script's part names, inside the window
      const strip = await page.evaluate(() => [...document.querySelectorAll('.ck-ph [data-act^="phase:"]')].map((b) => [b.getAttribute("data-act"), b.textContent.trim(), b.getBoundingClientRect().width > 0]));
      assert.deepEqual(strip, PHASE_BUTTONS.map(([x, name]) => [`phase:${x}`, name, true]));

      // every slide of this phase, reached by pressing Next: its own phase name, its own place in the deck, only this button lit
      const walked = await walkDeck(page);
      const fullPhaseSlides = SLIDES.filter(([, phase]) => phase === phaseName).map(([code]) => code);
      for (const code of fullPhaseSlides) {
        const slide = walked.find((s) => s.code === code);
        assert.ok(slide, `${code} was reached`);
        const { code: wantCode, ...want } = WANT(code);
        assert.deepEqual({ phase: slide.phase, position: slide.position, lit: slide.lit }, { phase: want.phase, position: want.position, lit: [n] }, wantCode);
        assert.equal(slide.phase, phaseName, `${code} names its phase`);
      }
      // and no slide of another phase claims this one
      for (const slide of walked.filter((s) => !fullPhaseSlides.includes(s.code))) {
        assert.notEqual(slide.phase, phaseName, `${slide.code} is not part of ${phaseName}`);
        assert.ok(!slide.lit.includes(n), `${slide.code} does not light ${n}`);
      }

      assert.deepEqual(calls.writes, []);
      assert.deepEqual(errors, []);
      await page.close();

      // the button itself, pressed from the far end of a fresh deck (the walk above took the descent ladder into
      // the Blueprint, which makes the file a repair file)
      const late = await openDeck({ visuals: true });
      await act(late.page, "phase:09").click();
      await next(late.page);
      assert.equal(await slideCode(late.page), "S-24");
      const first = FIRST_FUNDING[n] || slides[0];
      await act(late.page, `phase:${n}`).click();
      assert.deepEqual(await where(late.page), { code: first, phase: phaseName, position: WANT(first).position, lit: [n] });
      // pressing it again stays on its first slide
      await act(late.page, `phase:${n}`).click();
      assert.equal(await slideCode(late.page), first);
      assert.deepEqual(late.calls.writes, []);
      assert.deepEqual(late.errors, []);
      await late.page.close();

      if (n === "06") {
        // on a repair file part 6 opens the Blueprint, and remembers the way back
        const repair = await openDeck({ tier: "REPAIR_ONLY" });
        await act(repair.page, "phase:09").click();
        await next(repair.page);
        await act(repair.page, "phase:06").click();
        assert.equal(await slideCode(repair.page), "B-01");
        assert.match((await act(repair.page, "stack-leave").textContent()).trim(), /^Leave the stack: back to S-24$/);
        await repair.page.close();
      }
    };
    // The catalog lists the seven buttons the strip had before 2026-10-29, by number (CATALOG_PHASE_ROWS).
    if (CATALOG_PHASE_ROWS.includes(n)) await proof.check(new RegExp(`^Phase strip button ${n}:`), run);
    else await run();
  });
}

test("phase strip button 08, Money, opens the money steps in the cockpit and the client's slide stays where it is", { timeout: 120_000 }, async () => {
  const { page, errors, calls } = await openDeck();
  await act(page, "phase:07").click();
  await next(page);
  assert.equal(await slideCode(page), "S-18");
  const screen = await page.locator(".client .slide").innerHTML();
  await act(page, "phase:08").click();
  assert.equal(await slideCode(page), "S-18");
  assert.equal(await page.locator(".client .slide").innerHTML(), screen, "the client's screen does not move");
  assert.equal((await header(page))[0], "8 Money");
  assert.deepEqual(await litPhases(page), ["08"]);
  assert.equal((await says(page))[0], "Money aside, is this the right plan for your file?");
  await act(page, "money-back").click();
  assert.equal((await header(page))[0], "7 The ask");
  await act(page, "phase:08").click();
  await act(page, "money-pay").click();
  assert.equal(await slideCode(page), "S-23");
  assert.deepEqual(await litPhases(page), ["09"]);
  // every strip button is a real target: 44 px or more each way
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.ck-ph [data-act^="phase:"]')].map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
  assert.equal(sizes.length, 9);
  for (const [w, h] of sizes) assert.ok(w >= 44 && h >= 44, `a strip button is ${w} by ${h}`);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(errors, []);
  await page.close();
});

// ───────────────────────────── the visual slots ─────────────────────────────

test("the page's own script tags load the visual files before the deck, each visual draws where 10.0 places it, and without them the slides are today's", { timeout: 120_000 }, async () => {
  const drawn = async (page) => page.evaluate(() => { const el = document.querySelector('.client [data-fhv]'); return el ? [el.getAttribute("data-fhv"), el.getAttribute("data-door")] : null; });
  const funding = await openDeck({ tier: "FUNDING_PLUS_REPAIR", visuals: true });
  const seen = [];
  while (!(await act(funding.page, "next").isDisabled())) {
    await next(funding.page);
    const v = await drawn(funding.page);
    if (v) seen.push([await slideCode(funding.page), ...v]);
  }
  assert.deepEqual(seen.filter(([code]) => ["F-01", "L-01", "F-02", "S-08", "P-01", "C-01"].includes(code)), [["F-01", "fileFindings", "fund_plus_optimize"], ["L-01", "moneyLevers", "fund_plus_optimize"], ["F-02", "lenderWall", "fund_plus_optimize"], ["S-08", "yourPath", "fund_plus_optimize"], ["P-01", "proofWall", "fund_plus_optimize"], ["C-01", "companies", "fund_plus_optimize"]]);
  assert.deepEqual(funding.errors, []);
  await funding.page.close();

  const repair = await openDeck({ tier: "REPAIR_ONLY", visuals: true });
  const met = [];
  while (!(await act(repair.page, "next").isDisabled())) {
    await next(repair.page);
    const v = await drawn(repair.page);
    if (v) met.push([await slideCode(repair.page), ...v]);
  }
  assert.deepEqual(met.filter(([code]) => ["F-01", "L-01", "F-02", "S-08", "B-03", "S-15"].includes(code)), [["F-01", "fileFindings", "blueprint"], ["L-01", "moneyLevers", "blueprint"], ["F-02", "lenderWall", "blueprint"], ["S-08", "yourPath", "blueprint"], ["B-03", "blueprintDemo", "blueprint"], ["S-15", "journey", "blueprint"]]);
  assert.deepEqual(repair.errors, []);
  await repair.page.close();

  // no visual file on the server: the walk and the slides are today's, and nothing breaks
  const plain = await openDeck({ tier: "REPAIR_ONLY" });
  const walked = [await slideCode(plain.page)];
  while (!(await act(plain.page, "next").isDisabled())) { await next(plain.page); walked.push(await slideCode(plain.page)); }
  assert.deepEqual(walked, REPAIR_RUN);
  assert.equal(await plain.page.locator(".client [data-fhv]").count(), 0);
  assert.equal(await plain.page.evaluate(() => typeof window.FHDeckVisuals), "undefined");
  assert.deepEqual(plain.errors, [], "a missing visual file is not an error on the page");
  await plain.page.close();
});

// ───────────────────────────── the two walls ─────────────────────────────

test("paperwork slides do not tell an unpaid client they are enrolled", { timeout: 120_000 }, async () => {
  const { page, calls, errors } = await openDeck({ visuals: true });
  await act(page, "phase:09").click();
  assert.equal(await slideCode(page), "S-23");
  assert.match(await page.locator(".client").innerText(), /Review the agreement and payment step/);
  await act(page, "next").click();
  assert.equal(await slideCode(page), "S-24");
  assert.match(await page.locator(".client").innerText(), /after checkout/);
  assert.doesNotMatch(await page.locator(".client").innerText(), /You are in|Welcome aboard/);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(errors, []);
  await page.close();
});

const LOGIN_NEXT = `/login.html?next=${encodeURIComponent(`${PAGE}?contact=${CONTACT}`)}`;
const wall = async (page) => ({
  words: (await page.locator(".gate h1").textContent()).trim(),
  links: await page.locator(".gate a").evaluateAll((els) => els.map((a) => [a.textContent.trim(), a.getAttribute("href")])),
  deck: await page.locator('[data-act="next"]').count(),
});

test("a refused account sees the wall and a way to sign in, a missing client sees the other wall, and neither draws the deck", { timeout: 120_000 }, async () => {
  await proof.check(/^Two walls: no client on the link/, async () => {
    // no client on the link: the page says so in words, reads nothing, draws no deck
    const none = await openDeck({ search: "", settle: false });
    await none.page.locator(".gate").waitFor();
    assert.deepEqual(await wall(none.page), {
      words: "Pick a client first. Open a call on the Closer Dashboard, then press Present.",
      links: [["Back to Closer Dashboard", "closer-dashboard.html"]],
      deck: 0,
    });
    assert.deepEqual(none.calls.reads, [], "no client, no read");
    assert.deepEqual(none.errors, []);
    await none.page.close();

    // a refused account: the server says 401 or 403, the real data.js turns that into the one word the page
    // branches on, and the page shows the wall with the way to sign in as someone else
    for (const status of [401, 403]) {
      const refused = await openDeck({ status, body: { ok: false, error: "forbidden" }, settle: false });
      await refused.page.locator(".gate").waitFor();
      assert.deepEqual(await wall(refused.page), {
        words: "This account cannot open the client deck. Ask an owner for access, or sign in with a closer account.",
        links: [["Back to Closer Dashboard", `closer-dashboard.html?client_id=${CONTACT}`], ["Sign in as someone else", LOGIN_NEXT]],
        deck: 0,
      }, `status ${status}`);
      assert.equal(refused.calls.reads.length, 1);
      assert.deepEqual(refused.calls.writes, []);
      assert.deepEqual(refused.errors, []);
      await refused.page.close();
    }

    // any other failure is not the wall: its own words and no sign-in link
    const broken = await openDeck({ status: 500, body: { ok: false, error: "internal_error" }, settle: false });
    await broken.page.locator(".gate").waitFor();
    const other = await wall(broken.page);
    assert.equal(other.words, "Something went wrong. Try again in a moment.");
    assert.deepEqual(other.links, [["Back to Closer Dashboard", `closer-dashboard.html?client_id=${CONTACT}`]]);
    assert.equal(other.deck, 0);
    await broken.page.close();

    // and an account that is let in gets the deck
    const fine = await openDeck();
    assert.equal(await slideCode(fine.page), "S-01");
    assert.equal(await fine.page.locator(".gate").count(), 0);
    await fine.page.close();
  });
});

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 12);
  proof.assertAllClaimed();
});
