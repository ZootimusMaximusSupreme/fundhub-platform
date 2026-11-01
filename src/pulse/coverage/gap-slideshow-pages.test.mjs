// gap-slideshow-pages: the morning look at the 22 phone slideshow pages a booked lead is sent.
// The lane reads each page whole with the run's fetch, so these cases hand it a fake fetch (no network).
// They read the real published pages from public/slideshows, so a page that was published wrong fails here too.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_IDS, DEADLINE_MS, TIMEOUT_MS, gapChecks } from "./gap-slideshow-pages.mjs";
import { GAP_FILES } from "./modules.mjs";
import { runGapLane } from "./run-slices.mjs";
import { laneCheckIds } from "../self-audit.mjs";
import { SLIDE_MARK, checkDeckPages, countSlides } from "../beats/lib/slideshow-pages-truth.mjs";
import { DECK_PAGES } from "../../slideshows/deck-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ID = "slideshows:pages-live";
const SITE = "https://fundhub.ai";
const urlOf = (deck) => `${SITE}${deck.path}`;

function pick(slug) {
  const deck = DECK_PAGES.find((d) => d.slug === slug);
  assert.ok(deck, `${slug} is not one of the published decks`);
  return deck;
}

const realPage = (deck) => fs.readFileSync(path.join(ROOT, "public", "slideshows", deck.slug, "index.html"), "utf8");

/** Change the first words of slide 1's eyebrow only. A deck's header comment also names its codes, so a plain replace would miss the slide. */
function withEyebrow(text, from, to) {
  const open = '<p class="eyebrow">';
  const start = text.indexOf(SLIDE_MARK);
  const at = text.indexOf(open, start) + open.length;
  assert.ok(start >= 0 && at > open.length, "the page has a slide 1 eyebrow");
  assert.ok(text.startsWith(from, at), `slide 1's eyebrow starts with ${from}`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}
const goodTable = () => Object.fromEntries(DECK_PAGES.map((deck) => [urlOf(deck), { status: 200, text: realPage(deck) }]));

/** A fetch that answers from a table by exact address. An address not in the table rejects, so a wrong address cannot pass by luck. */
function fetchFrom(table, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    if (!Object.prototype.hasOwnProperty.call(table, url)) throw new Error(`no canned answer for ${url}`);
    const answer = table[url];
    if (answer instanceof Error) throw answer;
    return { status: answer.status, text: async () => String(answer.text ?? "") };
  };
}

const run = (table, extra = {}) => gapChecks({ fetchImpl: fetchFrom(table), baseUrl: SITE, ...extra });

/* ---------- the green case, on the real pages ---------- */

test("gap slideshow pages PASS: all 22 real published pages answer 200, whole, with their title, code and exact slide count", async () => {
  const calls = [];
  const rows = await gapChecks({ fetchImpl: fetchFrom(goodTable(), calls), baseUrl: SITE });
  assert.equal(rows.length, 1);
  const total = DECK_PAGES.reduce((sum, d) => sum + d.slides, 0);
  assert.equal(rows[0].id, ID);
  assert.equal(rows[0].status, "PASS", rows[0].detail);
  assert.equal(rows[0].detail, `22 phone slideshow pages, ${total} slides: each answered 200 with its title, its slide 1 code and all of its slides`);
  assert.equal(calls.length, 22);
  assert.ok(calls.every((c) => c.init.method === "GET" && c.init.body === undefined && c.url.startsWith(`${SITE}/slideshows/`) && c.url.endsWith("/")));
  assert.ok(calls.every((c) => c.init.signal && typeof c.init.signal.aborted === "boolean"), "each page has its own timeout");
});

test("gap slideshow pages: the published list and the pages on disk agree, and no draft is published", () => {
  assert.equal(DECK_PAGES.length, 22);
  for (const deck of DECK_PAGES) {
    const text = realPage(deck);
    assert.equal(countSlides(text), deck.slides, `${deck.slug} holds the slides the list says`);
    assert.ok(!/-draft/i.test(deck.slug), `${deck.slug} is a draft`);
  }
  const folders = fs.readdirSync(path.join(ROOT, "public", "slideshows"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(folders, DECK_PAGES.map((d) => d.slug).sort());
  assert.ok(fs.existsSync(path.join(ROOT, "marketing", "slideshows", "pre-underwriting-draft-1.html")), "the old draft is still kept in the repo");
  assert.ok(!fs.existsSync(path.join(ROOT, "public", "slideshows", "pre-underwriting-draft-1")), "and it is not published");
});

/* ---------- the red cases: each would stay green if the check were blind ---------- */

test("gap slideshow pages FAIL: a page that answers 404 names the deck and says what to do", async () => {
  const deck = pick("the-call");
  const [row] = await run({ ...goodTable(), [urlOf(deck)]: { status: 404, text: "Not found" } });
  assert.equal(row.status, "FAIL");
  assert.equal(row.id, ID);
  assert.equal(row.detail, "1 of 22 phone slideshow pages is wrong: the-call answered 404.");
  assert.match(row.suggestedFix, /node marketing\/slideshows\/build\.mjs --publish/);
  assert.match(row.suggestedFix, /node marketing\/slideshows\/check\.mjs/);
  assert.match(row.suggestedFix, /Chris never touches the pages/);
});

test("gap slideshow pages FAIL: a page short of a slide, or with an extra one, is wrong (the exact count is held)", async () => {
  const deck = pick("soft-pull");
  const text = realPage(deck);
  const short = text.replace(/<section class="slide(?![\s\S]*<section class="slide)/, '<section class="gone');
  assert.equal(countSlides(short), deck.slides - 1);
  const [a] = await run({ ...goodTable(), [urlOf(deck)]: { status: 200, text: short } });
  assert.equal(a.status, "FAIL");
  assert.match(a.detail, new RegExp(`soft-pull has ${deck.slides - 1} slides, wanted ${deck.slides}`));
  const extra = `${text}<section class="slide extra"></section>`;
  const [b] = await run({ ...goodTable(), [urlOf(deck)]: { status: 200, text: extra } });
  assert.equal(b.status, "FAIL");
  assert.match(b.detail, new RegExp(`soft-pull has ${deck.slides + 1} slides, wanted ${deck.slides}`));
});

test("gap slideshow pages FAIL: another deck at this address, the right title with other letters, and a missing slide 1 code are each wrong", async () => {
  const wanted = pick("pre-underwriting");
  const other = pick("soft-pull");
  const [swapped] = await run({ ...goodTable(), [urlOf(wanted)]: { status: 200, text: realPage(other) } });
  assert.equal(swapped.status, "FAIL");
  assert.match(swapped.detail, /pre-underwriting answered 200 but it is not this deck \(the title does not match\)/);

  const lettered = withEyebrow(realPage(wanted), `${wanted.code}-01`, "ZZ-01");
  const [wrongCode] = await run({ ...goodTable(), [urlOf(wanted)]: { status: 200, text: lettered } });
  assert.equal(wrongCode.status, "FAIL");
  assert.match(wrongCode.detail, new RegExp(`slide 1 says ZZ, wanted ${wanted.code}`));

  const bare = withEyebrow(realPage(wanted), `${wanted.code}-01`, "One");
  const [noCode] = await run({ ...goodTable(), [urlOf(wanted)]: { status: 200, text: bare } });
  assert.equal(noCode.status, "FAIL");
  assert.match(noCode.detail, /slide 1 has no deck code/);
});

test("gap slideshow pages FAIL: decks that share their letters are told apart by title", async (t) => {
  const shared = new Map();
  for (const d of DECK_PAGES) shared.set(d.code, [...(shared.get(d.code) || []), d]);
  const pair = [...shared.values()].find((list) => list.length > 1);
  if (!pair) return t.skip("no two decks share their slide 1 letters, so there is no pair to mix up");
  const [row] = await run({ ...goodTable(), [urlOf(pair[0])]: { status: 200, text: realPage(pair[1]) } });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, new RegExp(`${pair[0].slug} answered 200 but it is not this deck`));
});

test("gap slideshow pages FAIL: many wrong pages are counted, four are named, and the rest are counted too", async () => {
  const table = Object.fromEntries(DECK_PAGES.map((d) => [urlOf(d), { status: 503, text: "" }]));
  const [row] = await run(table);
  assert.equal(row.status, "FAIL");
  assert.equal(
    row.detail,
    "22 of 22 phone slideshow pages are wrong: after-you-say-yes answered 503; apply-yourself answered 503; bank-said-no answered 503; blueprint-12-months answered 503; and 18 more."
  );
});

test("gap slideshow pages: wrong beats silent, and a page that gave no answer is never judged right", async () => {
  const wrong = pick("bank-said-no");
  const quiet = pick("who-we-are");
  const [both] = await run({ ...goodTable(), [urlOf(wrong)]: { status: 404, text: "" }, [urlOf(quiet)]: new Error("connection reset") });
  assert.equal(both.status, "FAIL");
  assert.match(both.detail, /bank-said-no answered 404\. 1 more did not answer, so they were not judged\.$/);

  const [one] = await run({ ...goodTable(), [urlOf(quiet)]: new Error("connection reset") });
  assert.equal(one.status, "skip", "one page not read is not a PASS");
  assert.equal(one.detail, "1 of 22 phone slideshow pages did not answer (who-we-are did not answer (connection reset)), so they were not all read");
  assert.equal(one.suggestedFix, null);
});

test("gap slideshow pages skip, never PASS: no network at all, no web client in the run, or a site address that is not a web address", async () => {
  const down = Object.fromEntries(DECK_PAGES.map((d) => [urlOf(d), new Error("getaddrinfo ENOTFOUND")]));
  const [blind] = await run(down);
  assert.equal(blind.status, "skip");
  assert.match(blind.detail, /^22 of 22 phone slideshow pages did not answer \(after-you-say-yes did not answer \(getaddrinfo ENOTFOUND\); apply-yourself/);

  const [noClient] = await gapChecks({ baseUrl: SITE });
  assert.equal(noClient.status, "skip");
  assert.equal(noClient.detail, "this run has no web client, so no phone slideshow page was read");

  const [badSite] = await gapChecks({ fetchImpl: fetchFrom(goodTable()), baseUrl: "not a web address" });
  assert.equal(badSite.status, "skip");
  assert.match(badSite.detail, /not a web address/);
});

test("gap slideshow pages: pages that never answer end at the deadline, well under 20 seconds, as a skip", async () => {
  const started = Date.now();
  const [row] = await gapChecks({ fetchImpl: () => new Promise(() => {}), baseUrl: SITE, deadlineMs: 40 });
  assert.ok(Date.now() - started < 1500, "the lane ends at its deadline");
  assert.equal(row.status, "skip");
  assert.match(row.detail, /did not answer in time/);
  assert.ok(TIMEOUT_MS < DEADLINE_MS && DEADLINE_MS <= 20000, "one page waits less than the whole read, and a lane stays under 20 seconds");
});

test("gap slideshow pages FAIL: an empty list is a failure, not a pass (nothing would be watched)", async () => {
  const [row] = await checkDeckPages({ decks: [], web: fetchFrom({}), base: SITE });
  assert.equal(row.status, "FAIL");
  assert.equal(row.id, ID);
  assert.match(row.detail, /the list of phone slideshow pages is empty/);
});

test("gap slideshow pages: it reads the site it is handed, by origin only", async () => {
  const calls = [];
  const table = Object.fromEntries(DECK_PAGES.map((d) => [`https://example.test${d.path}`, { status: 200, text: realPage(d) }]));
  const [row] = await gapChecks({ fetchImpl: fetchFrom(table, calls), baseUrl: "https://example.test/some/path?x=1" });
  assert.equal(row.status, "PASS", row.detail);
  assert.ok(calls.every((c) => c.url.startsWith("https://example.test/slideshows/")));
});

/* ---------- the lane inside the pulse ---------- */

test("gap slideshow pages: it is on the named list, exports its id, and the pulse reads its rows with the lane's namespaced id", async () => {
  assert.deepEqual([...CHECK_IDS], [ID]);
  const entry = GAP_FILES.find(([name]) => name === "gap-slideshow-pages.mjs");
  assert.ok(entry, "gap-slideshow-pages.mjs is on the literal list in modules.mjs");
  const mod = await entry[1]();
  assert.deepEqual(laneCheckIds(mod), [ID]);
  assert.equal(typeof mod.gapChecks, "function");

  const green = await runGapLane("gap-slideshow-pages", { fetchImpl: fetchFrom(goodTable()), baseUrl: SITE, now: new Date("2026-10-31T13:00:00.000Z") });
  assert.equal(green.length, 1);
  assert.equal(green[0].status, "PASS");
  assert.equal(green[0].id, `gap-slideshow-pages:${ID}`);
  assert.equal(green[0].checkId, ID);
  assert.equal(green[0].sliceId, "gap-slideshow-pages");

  const deck = pick("credit-partner");
  const red = await runGapLane("gap-slideshow-pages", { fetchImpl: fetchFrom({ ...goodTable(), [urlOf(deck)]: { status: 404, text: "" } }), baseUrl: SITE });
  assert.equal(red[0].status, "FAIL");
  assert.equal(red[0].checkId, ID);
  assert.match(red[0].customerSees, /credit-partner answered 404/);

  const none = await runGapLane("gap-slideshow-pages", { baseUrl: SITE });
  assert.equal(none[0].status, "skip", "a run with no web client is a skip, never a PASS");
});

test("gap slideshow pages: it only reads. No database, no send, no body, no repo file at run time", () => {
  const code = [
    fs.readFileSync(path.join(HERE, "gap-slideshow-pages.mjs"), "utf8"),
    fs.readFileSync(path.join(HERE, "../beats/lib/slideshow-pages-truth.mjs"), "utf8")
  ].join("\n").split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join("\n");
  assert.match(code, /method: "GET"/);
  assert.doesNotMatch(code, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(code, /\bbody\s*:/);
  assert.doesNotMatch(code, /ctx\.(?:db|scope)\b|\.query\(|from\s+["'][^"']*db\.mjs["']/);
  assert.doesNotMatch(code, /node:fs|readFileSync|readFile\(|existsSync/);
  assert.doesNotMatch(code, /messaging|notify|sendTemplated|sendText|sendEmail/);
});
