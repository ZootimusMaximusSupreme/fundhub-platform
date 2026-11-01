// The phone slideshow pages a booked lead is sent: one list, and every place that names the pages held to it.
//
// marketing/slideshows/build.mjs --publish writes the pages (public/slideshows/<name>/index.html) and the list
// (src/slideshows/deck-pages.mjs, plus a copy the hourly pulse beat reads). The company pulse watches the pages from that
// list. Two more places name the pages by hand, because the pulse guards need them spelled out: the ping rows in
// src/pulse/registry.mjs and the tripwire rows in src/pulse/tripwires.mjs. This test fails the moment any of them
// disagree, so a deck that is added, renamed or removed can never be live without the pulse watching it, and the pulse
// can never watch a page that is not there.
//
// It also holds what a lead must never see in a page (Chris's talking points, the notes on where a fact came from) and
// the rule that an old draft is never published.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DECK_PAGES } from "./deck-pages.mjs";
import { DECK_PAGES as COPY } from "../pulse/beats/lib/slideshow-pages-list.mjs";
import { PULSE_REGISTRY } from "../pulse/registry.mjs";
import { TRIPWIRES } from "../pulse/tripwires.mjs";
import * as beat from "../pulse/beats/beat-slideshow-pages.mjs";
import {
  EYEBROW_WINDOW,
  LIST_COPY_FILE,
  LIST_FILE,
  PUBLIC_DIR,
  deckFacts,
  deckFiles,
  isDraft,
  listCopyText,
  listModuleText,
  localRefs,
  publishedDecks,
  slugOf,
  toPublic
} from "../../marketing/slideshows/build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const WHEN_A_DECK_CHANGES =
  "A deck was added, renamed or removed. Run node marketing/slideshows/build.mjs --publish: it rewrites the pages and both " +
  "copies of the list. Then change the two places that name the pages by hand: the slideshows/<name>/index.html lines in " +
  "PUBLIC_STATIC_FILES in src/pulse/registry.mjs, and the page:slideshows/<name>/index.html lines in TRIPWIRES in " +
  "src/pulse/tripwires.mjs. The morning check and the hourly beat read the list, so they follow it by themselves.";

const sorted = (list) => [...list].sort();
const pageKey = (deck) => `slideshows/${deck.slug}/index.html`;
const pageOnDisk = (deck) => fs.readFileSync(path.join(PUBLIC_DIR, deck.slug, "index.html"), "utf8");

let built = null;
/** Every deck build.mjs would publish. Built once; a deck that cannot be published fails the test that asks, with build.mjs's own words. */
function decks() {
  if (built === null) built = publishedDecks();
  return built;
}

/* ---------- the list ---------- */

test("deck pages: every row of the list is well formed, and none is a draft", () => {
  assert.ok(DECK_PAGES.length >= 1, "the list names at least one page");
  assert.ok(Object.isFrozen(DECK_PAGES) && DECK_PAGES.every((row) => Object.isFrozen(row)), "the list cannot be changed while the pulse reads it");
  assert.equal(new Set(DECK_PAGES.map((d) => d.slug)).size, DECK_PAGES.length, "no page is listed twice");
  for (const deck of DECK_PAGES) {
    assert.match(deck.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${deck.slug} is a plain lower-case name`);
    assert.equal(deck.path, `/slideshows/${deck.slug}/`, `${deck.slug} is at the address a lead is sent`);
    assert.ok(Number.isInteger(deck.slides) && deck.slides >= 1, `${deck.slug} has at least one slide`);
    assert.match(deck.code, /^[A-Z]{2,3}$/, `${deck.slug} has the letters of its slide 1 code`);
    assert.ok(typeof deck.title === "string" && deck.title.length > 0 && deck.title === deck.title.trim(), `${deck.slug} has a title`);
    assert.ok(!isDraft(`${deck.slug}.html`), `${deck.slug} is a draft, and a draft is never published`);
  }
});

test("deck pages: the list and its copy for the hourly beat are exactly what build.mjs --publish writes", () => {
  const all = decks();
  assert.equal(fs.readFileSync(LIST_FILE, "utf8"), listModuleText(all), `src/slideshows/deck-pages.mjs is stale. ${WHEN_A_DECK_CHANGES}`);
  assert.equal(fs.readFileSync(LIST_COPY_FILE, "utf8"), listCopyText(all), `src/pulse/beats/lib/slideshow-pages-list.mjs is stale. ${WHEN_A_DECK_CHANGES}`);
  const facts = all.map(({ slug, slides, code, title }) => ({ slug, path: `/slideshows/${slug}/`, slides, code, title }));
  assert.deepEqual(DECK_PAGES.map((row) => ({ ...row })), facts, WHEN_A_DECK_CHANGES);
  assert.deepEqual(COPY.map((row) => ({ ...row })), facts, WHEN_A_DECK_CHANGES);
});

/* ---------- the pages ---------- */

test("deck pages: every page on disk is the page build.mjs --publish writes, and no page is live without a deck", () => {
  for (const deck of decks()) {
    const file = path.join(PUBLIC_DIR, deck.slug, "index.html");
    assert.ok(fs.existsSync(file), `public/slideshows/${deck.slug}/index.html is missing. ${WHEN_A_DECK_CHANGES}`);
    assert.equal(fs.readFileSync(file, "utf8"), deck.page, `public/slideshows/${deck.slug}/index.html is stale: the deck changed after it was published. ${WHEN_A_DECK_CHANGES}`);
  }
  const live = fs.readdirSync(PUBLIC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(PUBLIC_DIR, entry.name, "index.html")))
    .map((entry) => entry.name);
  assert.deepEqual(sorted(live), sorted(DECK_PAGES.map((d) => d.slug)), `A page is live that has no deck behind it, or a deck has no page. ${WHEN_A_DECK_CHANGES}`);
});

test("deck pages: a lead's page holds none of Chris's talking points, none of the notes on where a fact came from, and one no-index tag", () => {
  for (const deck of DECK_PAGES) {
    const page = pageOnDisk(deck);
    assert.doesNotMatch(page, /<aside\b[^>]*\btalk\b/, `${deck.slug}: Chris's talking points are on the public page`);
    assert.doesNotMatch(page, /\sdata-(?:src|figures)=/, `${deck.slug}: a note on where a fact came from is on the public page`);
    const robots = page.match(/<meta\s+name=["']robots["'][^>]*>/gi) || [];
    assert.equal(robots.length, 1, `${deck.slug}: wanted exactly one robots tag`);
    assert.match(robots[0], /noindex/i, `${deck.slug}: a search engine may list a page made for one person`);
    assert.deepEqual(localRefs(page), [], `${deck.slug}: points at a file next to the deck, which the public folder does not hold`);
  }
});

test("deck pages: an old draft is never published, listed or watched", () => {
  const drafts = deckFiles().filter(isDraft).map(slugOf);
  const places = {
    "the list": DECK_PAGES.map((d) => d.slug),
    "the copy of the list": COPY.map((d) => d.slug),
    "the folders under public/slideshows": fs.readdirSync(PUBLIC_DIR),
    "the ping rows": PULSE_REGISTRY.map((row) => row.file || "").filter((file) => file.startsWith("slideshows/")),
    "the tripwire rows": Object.keys(TRIPWIRES).filter((key) => key.startsWith("page:slideshows/")),
    "the hourly beat's steps": beat.steps
  };
  for (const [where, names] of Object.entries(places)) {
    assert.ok(names.every((name) => !/-draft/i.test(name)), `a draft is in ${where}`);
    for (const draft of drafts) assert.ok(!names.some((name) => name.includes(draft)), `${draft} is in ${where}`);
  }
  assert.ok(decks().every((deck) => !isDraft(deck.file)), "build.mjs picked up a draft");
});

/* ---------- the places that name the pages by hand ---------- */

test("deck pages: the ping rows in the registry name exactly these pages", () => {
  const rows = PULSE_REGISTRY.filter((row) => row.kind === "public_static" && row.file.startsWith("slideshows/"));
  assert.deepEqual(sorted(rows.map((row) => row.file)), sorted(DECK_PAGES.map(pageKey)), WHEN_A_DECK_CHANGES);
  for (const deck of DECK_PAGES) {
    const row = rows.find((r) => r.file === pageKey(deck));
    assert.equal(row.path, deck.path, `${deck.slug}: the ping asks for the address a lead is sent`);
  }
  assert.equal(new Set(PULSE_REGISTRY.map((row) => row.id)).size, PULSE_REGISTRY.length, "no two ping rows share an id");
});

test("deck pages: the tripwire map sorts exactly these pages as customer pages that name the deep check", () => {
  const keys = Object.keys(TRIPWIRES).filter((key) => key.startsWith("page:slideshows/"));
  assert.deepEqual(sorted(keys), sorted(DECK_PAGES.map((d) => `page:${pageKey(d)}`)), WHEN_A_DECK_CHANGES);
  for (const key of keys) {
    assert.equal(TRIPWIRES[key].impact, "customer", `${key} is a page a customer opens`);
    assert.deepEqual([...TRIPWIRES[key].checks], ["slideshows:pages-live"], `${key} goes red on the deep check that reads it`);
  }
});

test("deck pages: the hourly beat covers and walks exactly these pages", () => {
  assert.deepEqual([...beat.covers], DECK_PAGES.map((d) => `page:${pageKey(d)}`), WHEN_A_DECK_CHANGES);
  assert.deepEqual([...beat.steps], DECK_PAGES.map((d) => `page-${d.slug}`), WHEN_A_DECK_CHANGES);
});

test("deck pages: public/_headers makes a cache ask before it serves a slideshow page", () => {
  const lines = fs.readFileSync(path.join(ROOT, "public", "_headers"), "utf8").split(/\r?\n/);
  const at = lines.findIndex((line) => line === "/slideshows/*");
  assert.ok(at >= 0, "public/_headers has no /slideshows/* rule, so a cache may serve last week's words");
  const rule = [];
  for (const line of lines.slice(at + 1)) {
    if (!/^[ \t]+\S/.test(line)) break;
    rule.push(line.trim());
  }
  assert.deepEqual(rule, ["Cache-Control: public, max-age=0, must-revalidate"]);
});

/* ---------- how a page is made (build.mjs) ---------- */

const SHELL_HEAD = "<!-- fh:shell:head -->\n<!-- /fh:shell:head -->";
const SHELL_SCRIPT = "<!-- fh:shell:script -->\n<!-- /fh:shell:script -->";

/** The smallest thing build.mjs treats as a deck: shell markers, one slide, talking points and source notes to strip. */
function tinyDeck({ talk = `<aside class="talk">Say this out loud to the camera.</aside>`, head = "", before = "" } = {}) {
  return [
    "<!doctype html>",
    `<html lang="en"><head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    head,
    `<title>Fundhub Tiny Deck</title>`,
    SHELL_HEAD,
    "</head><body>",
    before,
    `<section class="slide" data-src="owner-notes.md" data-figures="3 of 10">`,
    `<p class="eyebrow">TD-01 / The first slide</p>`,
    `<p>What the lead reads.</p>`,
    talk,
    "</section>",
    SHELL_SCRIPT,
    "</body></html>"
  ].join("\n");
}

test("build toPublic: takes out the talking points and the source notes, keeps the words, adds one no-index tag; a file that is not a deck is null", () => {
  const page = toPublic(tinyDeck());
  assert.ok(page !== null);
  assert.doesNotMatch(page, /Say this out loud/);
  assert.doesNotMatch(page, /<aside/);
  assert.doesNotMatch(page, /data-src|data-figures/);
  assert.match(page, /<p>What the lead reads\.<\/p>/);
  assert.match(page, /<section class="slide">/);
  assert.equal((page.match(/<meta name="robots" content="noindex">/g) || []).length, 1);
  assert.equal(toPublic("<!doctype html><html><head><title>Not a deck</title></head><body></body></html>"), null);
});

test("build toPublic: a robots tag the deck already has is kept, not doubled", () => {
  const page = toPublic(tinyDeck({ head: `<meta name="robots" content="noindex, nofollow">` }));
  assert.equal((page.match(/<meta\s+name=["']robots["']/gi) || []).length, 1);
  assert.match(page, /noindex, nofollow/);
});

test("build toPublic: talking points it cannot recognise, or a source note on something that is not a slide, stop the build instead of going live", () => {
  assert.throws(() => toPublic(tinyDeck({ talk: `<aside class='talk'>Say this out loud.</aside>` })), /talking-points block is still in the public page/);
  assert.throws(() => toPublic(tinyDeck({ before: `<div data-src="owner-notes.md"></div>` })), /not a slide, so it was not removed/);
});

test("build deckFacts: reads the slides, the letters and the title; refuses a slide 1 with no code or a code the hourly pulse could not see", () => {
  const page = toPublic(tinyDeck());
  assert.deepEqual(deckFacts(page, "tiny"), { slides: 1, code: "TD", title: "Fundhub Tiny Deck" });
  assert.throws(() => deckFacts(page.replace("TD-01 / The first slide", "The first slide"), "tiny"), /tiny: slide 1's eyebrow reads/);
  const late = page.replace(`<section class="slide">`, `<!-- ${"x".repeat(EYEBROW_WINDOW)} -->\n<section class="slide">`);
  assert.throws(() => deckFacts(late, "tiny"), /could not see the code/);
  assert.throws(() => deckFacts(page.replace(/<title>[^<]*<\/title>/, ""), "tiny"), /no <title>/);
});

test("build localRefs: a picture or font next to the deck is found; a data: address and an https link are not", () => {
  assert.deepEqual(localRefs(`<img src="data:image/png;base64,AAAA"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito">`), []);
  assert.equal(localRefs(`<img src="pic.png">`).length, 1);
  assert.equal(localRefs(`<div style="background:url(bg.png)"></div>`).length, 1);
});

test("build isDraft: any file with -draft in its name, in any case, is a draft", () => {
  assert.equal(isDraft("marketing/slideshows/pre-underwriting-draft-1.html"), true);
  assert.equal(isDraft("Pre-Underwriting-DRAFT.html"), true);
  assert.equal(isDraft("marketing/slideshows/pre-underwriting.html"), false);
  assert.equal(isDraft("marketing/drafts/pre-underwriting.html"), false, "only the file's own name counts");
});
