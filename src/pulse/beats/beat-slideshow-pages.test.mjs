// beat-slideshow-pages: the hourly look at the 22 phone slideshow pages a booked lead is sent.
// Each case runs the real beat through the real harness with a fake web (no network, no database).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-slideshow-pages.mjs";
import * as lane from "../coverage/gap-slideshow-pages.mjs";
import * as truth from "./lib/slideshow-pages-truth.mjs";
import { DECK_PAGES as COPY } from "./lib/slideshow-pages-list.mjs";
import { DECK_PAGES } from "../../slideshows/deck-pages.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths, MAX_DEADLINE_MS } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { TRIPWIRES } from "../tripwires.mjs";
import { SHIFTS } from "./shifts.mjs";
import { MAX_BODY_BYTES } from "../../messaging/providers/pulse-probe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SITE = "https://fundhub.ai";
const urlOf = (deck) => `GET ${SITE}${deck.path}`;
const slugStep = (deck) => `page-${deck.slug}`;
function pick(slug) {
  const deck = DECK_PAGES.find((d) => d.slug === slug);
  assert.ok(deck, `${slug} is not one of the published decks`);
  return deck;
}

/* The real published page, and what the pulse probe would hand back for it: the first 64 KB, flagged cut short. */
const realPage = (deck) => fs.readFileSync(path.join(ROOT, "public", "slideshows", deck.slug, "index.html"), "utf8");
function probeRead(text) {
  const bytes = Buffer.from(text, "utf8");
  const cut = bytes.byteLength > MAX_BODY_BYTES;
  return { status: 200, body: (cut ? bytes.subarray(0, MAX_BODY_BYTES) : bytes).toString("utf8"), truncated: cut };
}
const goodReal = () => Object.fromEntries(DECK_PAGES.map((deck) => [urlOf(deck), probeRead(realPage(deck))]));

/* A small made-up page: a title, then one slide per number asked for. */
function madeUp(deck, { slides = 2, code = deck.code, title = deck.title } = {}) {
  const parts = [`<!doctype html><html><head><title>${title}</title></head><body>`];
  for (let n = 1; n <= slides; n++) parts.push(`<section class="slide"><p class="eyebrow">${code}-0${n} / Made up</p></section>`);
  return parts.join("");
}

async function go(http, overrides = {}) {
  const ctx = makeFakeCtx(beat, { http, ...overrides });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
}

test("slideshow-pages: valid, covers the 22 pages, one step each, and the fix guide names files that exist", () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-slideshow-pages.mjs" }), []);
  assert.equal(beat.id, "slideshow-pages");
  assert.equal(beat.box, false);
  assert.equal(DECK_PAGES.length, 22);
  assert.deepEqual(beat.covers, DECK_PAGES.map((d) => `page:slideshows/${d.slug}/index.html`));
  assert.deepEqual(beat.steps, DECK_PAGES.map(slugStep));
  assert.deepEqual(beat.reads, [{ host: "SITE", methods: ["GET"] }]);
  assert.ok(beat.deadlineMs <= MAX_DEADLINE_MS);
  assert.ok(beat.READ_BUDGET_MS < beat.deadlineMs, "the read ends before the beat's own deadline, so a slow page is named");
  const { paths, missing } = missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
  assert.ok(paths.length >= 4);
  assert.deepEqual(missing, []);
});

test("slideshow-pages: the beat and the files it reads pass the static pin (no fetch, no database, no sender)", () => {
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-slideshow-pages.mjs"), "utf8"), { role: "beat" }), []);
  for (const file of ["slideshow-pages-truth.mjs", "slideshow-pages-list.mjs"]) {
    assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "lib", file), "utf8"), { role: "lib" }), [], file);
  }
});

test("slideshow-pages: its own selfTest passes, and fails at the deck it breaks", async () => {
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const red = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.deepEqual([red.ok, red.step], [false, slugStep(beat.BROKEN_DECK)]);
  assert.match(red.detail, /answered 404/);
});

test("slideshow-pages PASS: all 22 real published pages, cut at the probe's 64 KB, are green; 22 GETs to our own site", async () => {
  const { result, log } = await go(goodReal());
  assert.deepEqual([result.ok, result.step], [true, "done"], result.detail);
  assert.equal(log.http.length, 22);
  assert.ok(log.http.every((c) => c.method === "GET" && c.host === "fundhub.ai" && c.status === 200));
  assert.deepEqual(log.reads, []);
  assert.deepEqual(log.refused, []);
  assert.match(result.detail, /^22 phone slideshow pages/);
});

test("slideshow-pages: the cut read of every real page still shows slide 1's code (the judge depends on it)", () => {
  for (const deck of DECK_PAGES) {
    const read = probeRead(realPage(deck));
    assert.equal(truth.titleOf(read.body), deck.title, deck.slug);
    assert.equal(truth.slideOneCode(read.body), deck.code, deck.slug);
    const slides = truth.countSlides(read.body);
    assert.ok(slides >= 1 && slides <= deck.slides, `${deck.slug}: ${slides} slides in the first part`);
  }
});

test("slideshow-pages: a page smaller than the cap is read whole and the exact slide count is held", async () => {
  const deck = pick("soft-pull");
  const http = { ...goodReal(), [urlOf(deck)]: { status: 200, body: madeUp(deck, { slides: deck.slides }), truncated: false } };
  const green = await go(http);
  assert.equal(green.result.ok, true, green.result.detail);
  const short = { ...http, [urlOf(deck)]: { status: 200, body: madeUp(deck, { slides: deck.slides - 1 }), truncated: false } };
  const red = await go(short);
  assert.deepEqual([red.result.ok, red.result.step], [false, slugStep(deck)]);
  assert.match(red.result.detail, new RegExp(`^soft-pull has ${deck.slides - 1} slides, wanted ${deck.slides}`));
});

test("slideshow-pages FAIL: a page that answers 404 is red at its own step", async () => {
  const deck = pick("the-call");
  const { result } = await go({ ...goodReal(), [urlOf(deck)]: { status: 404, body: "Not found" } });
  assert.deepEqual([result.ok, result.step], [false, slugStep(deck)]);
  assert.equal(result.detail, "the-call answered 404");
});

test("slideshow-pages FAIL: a 500 and a redirect that never lands are red too", async () => {
  const a = pick("who-we-are");
  const b = pick("bank-said-no");
  const five = await go({ ...goodReal(), [urlOf(a)]: { status: 503, body: "" } });
  assert.deepEqual([five.result.ok, five.result.step], [false, slugStep(a)]);
  assert.match(five.result.detail, /who-we-are answered 503/);
  const moved = await go({ ...goodReal(), [urlOf(b)]: { status: 301, body: "" } });
  assert.equal(moved.result.ok, false);
  assert.match(moved.result.detail, /bank-said-no answered 301/);
});

test("slideshow-pages FAIL: another deck at this address (the title does not match) is red", async () => {
  const wanted = pick("pre-underwriting");
  const other = pick("soft-pull");
  const { result } = await go({ ...goodReal(), [urlOf(wanted)]: probeRead(realPage(other)) });
  assert.deepEqual([result.ok, result.step], [false, slugStep(wanted)]);
  assert.match(result.detail, /^pre-underwriting answered 200 but it is not this deck \(the title does not match\)/);
});

test("slideshow-pages FAIL: the right title with another deck's slide 1 letters is red, and the two decks that share letters are told apart by title", async () => {
  const deck = pick("pre-underwriting");
  const wrongCode = await go({ ...goodReal(), [urlOf(deck)]: { status: 200, body: madeUp(deck, { code: "ZZ" }), truncated: true } });
  assert.deepEqual([wrongCode.result.ok, wrongCode.result.step], [false, slugStep(deck)]);
  assert.match(wrongCode.result.detail, /slide 1 says ZZ, wanted PU/);
  // Two decks can open with the same letters (after-you-say-yes and apply-yourself both say AY). The letters alone cannot
  // tell them apart; the title does. Serve one of such a pair at the other's address.
  const shared = new Map();
  for (const d of DECK_PAGES) shared.set(d.code, [...(shared.get(d.code) || []), d]);
  const pair = [...shared.values()].find((list) => list.length > 1);
  if (pair) {
    const swapped = await go({ ...goodReal(), [urlOf(pair[0])]: probeRead(realPage(pair[1])) });
    assert.equal(swapped.result.ok, false, "the same letters on the other deck are caught by the title");
    assert.match(swapped.result.detail, /not this deck \(the title does not match\)/);
  }
});

test("slideshow-pages FAIL: a page with no deck letters in slide 1, or more slides than it should have, is red", async () => {
  const deck = pick("card-paydown");
  const noCode = await go({ ...goodReal(), [urlOf(deck)]: { status: 200, body: `<html><head><title>${deck.title}</title></head><body><section class="slide"><p class="eyebrow">Hello</p></section></body></html>`, truncated: true } });
  assert.deepEqual([noCode.result.ok, noCode.result.step], [false, slugStep(deck)]);
  assert.match(noCode.result.detail, /slide 1 has no deck code in what could be read/);
  const many = await go({ ...goodReal(), [urlOf(deck)]: { status: 200, body: madeUp(deck, { slides: deck.slides + 3 }), truncated: true } });
  assert.equal(many.result.ok, false);
  assert.match(many.result.detail, new RegExp(`shows ${deck.slides + 3} slides in its first part, wanted at most ${deck.slides}`));
});

test("slideshow-pages FAIL: a page that gives no answer at all is red (our own site not answering is something a lead feels)", async () => {
  const deck = pick("tried-before");
  const { result } = await go({ ...goodReal(), [urlOf(deck)]: new Error("connection reset") });
  assert.deepEqual([result.ok, result.step], [false, slugStep(deck)]);
  assert.match(result.detail, /^tried-before did not answer \(connection reset\)/);
});

test("slideshow-pages: a red names the first wrong deck in list order and lists the others", async () => {
  const first = pick("blueprint-value");
  const second = pick("the-money-talk");
  const third = pick("your-data-is-safe");
  const { result } = await go({
    ...goodReal(),
    [urlOf(first)]: { status: 404, body: "" },
    [urlOf(second)]: { status: 500, body: "" },
    [urlOf(third)]: { status: 200, body: "<html><title>Not found</title></html>", truncated: false }
  });
  assert.deepEqual([result.ok, result.step], [false, slugStep(first)]);
  assert.equal(result.detail, "blueprint-value answered 404. Also wrong: the-money-talk, your-data-is-safe");
});

test("slideshow-pages: when every page is wrong the detail stays short and counts the rest", async () => {
  const http = Object.fromEntries(DECK_PAGES.map((d) => [urlOf(d), { status: 503, body: "" }]));
  const { result } = await go(http);
  assert.deepEqual([result.ok, result.step], [false, slugStep(DECK_PAGES[0])]);
  assert.match(result.detail, /^after-you-say-yes answered 503\. Also wrong: apply-yourself, bank-said-no, blueprint-12-months, blueprint-in-action, and 17 more$/);
});

test("slideshow-pages: a detail never holds a word the page said", async () => {
  const deck = pick("funding-sequence");
  const said = "SECRET-WORDS-ON-THE-PAGE-4471";
  const body = `<html><head><title>${said}</title></head><body><section class="slide"><p class="eyebrow">${said}</p>${said}</section></body></html>`;
  const { result } = await go({ ...goodReal(), [urlOf(deck)]: { status: 200, body, truncated: false } });
  assert.equal(result.ok, false);
  assert.ok(!result.detail.includes(said), result.detail);
  const err = await go({ ...goodReal(), [urlOf(deck)]: { status: 200, body: said, truncated: true } });
  assert.ok(!err.result.detail.includes(said), err.result.detail);
});

test("slideshow-pages: with no site address the beat says so and asks nothing", async () => {
  const { result, log } = await go(goodReal(), { siteUrl: "" });
  assert.deepEqual([result.ok, result.step], [false, beat.steps[0]]);
  assert.match(result.detail, /site address \(URL\) is not set/);
  assert.deepEqual(log.http, []);
});

test("slideshow-pages: it only ever reads (GET) and only our own site", async () => {
  const { log } = await go(goodReal());
  assert.deepEqual([...new Set(log.http.map((c) => c.method))], ["GET"]);
  assert.deepEqual([...new Set(log.http.map((c) => c.host))], ["fundhub.ai"]);
});

test("slideshow-pages: the copy of the list in lib equals the original, and no draft is on it", () => {
  assert.deepEqual(COPY, DECK_PAGES);
  assert.ok(DECK_PAGES.every((d) => !/-draft/i.test(d.slug) && d.path === `/slideshows/${d.slug}/`));
});

test("slideshow-pages: the daily lane and the hourly beat share one judge and one check id", () => {
  assert.deepEqual([...lane.CHECK_IDS], [...beat.HOURLY_CHECK_IDS]);
  assert.deepEqual([...beat.HOURLY_CHECK_IDS], ["slideshows:pages-live"]);
  assert.equal(lane.DEADLINE_MS, truth.DEADLINE_MS);
  assert.equal(lane.TIMEOUT_MS, truth.TIMEOUT_MS);
  assert.ok(truth.TIMEOUT_MS < beat.READ_BUDGET_MS, "one page waits less than the whole read");
});

test("slideshow-pages: every deep check a covered surface names runs hourly here, and the beat sits in exactly one shift", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    assert.equal(wire.impact, "customer");
    for (const checkId of wire.checks) {
      assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId) || beat.RUNS_ELSEWHERE[checkId], `${surface} needs ${checkId} hourly`);
    }
  }
  const homes = Object.entries(SHIFTS).filter(([, shift]) => shift.beats.includes(beat.id)).map(([job]) => job);
  assert.deepEqual(homes, ["pulse-hourly-d"]);
});
