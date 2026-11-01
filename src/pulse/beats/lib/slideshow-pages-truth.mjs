// The phone slideshows a lead opens from a text or an email: does every page still answer, whole? Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-31). The morning lane src/pulse/coverage/gap-slideshow-pages.mjs and the hourly beat
// src/pulse/beats/beat-slideshow-pages.mjs read the pages and judge them with this file, so both clocks hold a page to
// the same rules. The list of pages is not here: each caller hands in its own copy of it (the lane reads
// src/slideshows/deck-pages.mjs, the beat reads lib/slideshow-pages-list.mjs, and a test holds the two equal).
//
//   slideshows:pages-live   every page on the list answers 200, shows the right deck (its title and the letters in
//                           slide 1's eyebrow, like PU in "PU-01") and has all of its slides
//
// A page is one row of the list: { slug, path, slides, code, title }. marketing/slideshows/build.mjs --publish writes
// the list from the pages it writes, using the same three readings this file makes (countSlides, slideOneCode,
// titleOf), so a page that was published right passes and a page that lost something does not.
//
// WHOLE PAGE OR FIRST PART. The morning lane reads each page whole and checks the exact slide count. The hourly beat
// reads through the pulse probe, which stops at 64 KB, and a deck is bigger than that. So when a read comes back cut
// short (truncated), the slide count is only held to "at least one slide and no more than the page should have". The
// title, the slide 1 code and the status are judged the same way on both clocks. build.mjs refuses to publish a deck
// whose slide 1 code sits past the first 60,000 bytes, so the cut-short read can always see it.
//
// HONEST STATUS. A page that gives a wrong answer (not 200, another deck, a missing slide) makes the row FAIL. A page
// that gives no answer at all (no network, timed out, no web client in this run) is not judged: the row is skip with
// the reason, never PASS. Wrong beats silent: one wrong page is FAIL even when others were silent.
//
// `web(url, init)` answers { status, text(), truncated? }. The morning lane hands in the run's fetch, the hourly beat
// a GET through ctx.http (lib/web-reader.mjs). Every call is a GET. No body is sent, nothing is saved.

export const CHECK_IDS = Object.freeze(["slideshows:pages-live"]);
const ID = CHECK_IDS[0];

/** One page may wait this long. Netlify cuts a whole step at 26 seconds. */
export const TIMEOUT_MS = 8000;
/** The whole read of every page ends here. A page still waiting then is not judged, and the row says so. */
export const DEADLINE_MS = 12000;

/** What every slide opens with. build.mjs counts the same text. */
export const SLIDE_MARK = '<section class="slide';
const EYEBROW_OPEN = '<p class="eyebrow">';

export const FIX =
  "Open the page the detail names at https://fundhub.ai/slideshows/<name>/ and read what a lead sees. A page that is " +
  "gone, short of a slide or showing another deck means the last ship did not carry it right. An agent fixes it from " +
  "the deck files: run node marketing/slideshows/build.mjs --publish, then node marketing/slideshows/check.mjs, and " +
  "push to main (GitHub ships it). Chris never touches the pages. The pulse only reports. Do not auto-fix.";

export function row(status, detail, suggestedFix = null) {
  return { id: ID, status, detail, suggestedFix };
}

export function clip(err, n = 120) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, n);
}

const plural = (n, one, many) => (n === 1 ? one : many);

function listed(items, max = 4) {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; and ${items.length - max} more` : shown;
}

/** How many slides the page text holds: the count of the slide opening tags. The same count build.mjs makes. */
export function countSlides(text) {
  return String(text).split(SLIDE_MARK).length - 1;
}

/** The letters in slide 1's eyebrow ("PU" in "PU-01 / The red flag"), or null when they cannot be read. Same reading as deckFacts in build.mjs. */
export function slideOneCode(text) {
  const page = String(text);
  const start = page.indexOf(SLIDE_MARK);
  if (start < 0) return null;
  const open = page.indexOf(EYEBROW_OPEN, start);
  if (open < 0) return null;
  const from = open + EYEBROW_OPEN.length;
  const end = page.indexOf("</p>", from);
  if (end < 0) return null;
  const words = page.slice(from, end).replace(/<[^>]+>/g, "").trim();
  const found = /^([A-Z]{2,3})-01(?![0-9])/.exec(words);
  return found ? found[1] : null;
}

/** The page's <title> text, trimmed, or null. Same reading as deckFacts in build.mjs. */
export function titleOf(text) {
  const found = /<title>([^<]*)<\/title>/i.exec(String(text));
  return found ? found[1].trim() : null;
}

/**
 * One page, judged. `answer` is { status, text, truncated } or { silent: true, why }.
 * Answers { kind: "ok" | "wrong" | "silent", why, whole }. `why` is short and never holds page text.
 */
export function judgePage(deck, answer) {
  const status = Number(answer && answer.status);
  if (!answer || answer.silent || !Number.isFinite(status) || status <= 0) {
    return { kind: "silent", why: (answer && answer.why) || "did not answer", whole: false };
  }
  const whole = answer.truncated !== true;
  const wrong = (why) => ({ kind: "wrong", why, whole });
  if (status !== 200) return wrong(`answered ${status}`);
  const text = String(answer.text ?? "");
  if (titleOf(text) !== deck.title) return wrong("answered 200 but it is not this deck (the title does not match)");
  const code = slideOneCode(text);
  if (code === null) return wrong("answered 200 but slide 1 has no deck code in what could be read");
  if (code !== deck.code) return wrong(`answered 200 but slide 1 says ${code}, wanted ${deck.code}`);
  const slides = countSlides(text);
  if (whole && slides !== deck.slides) return wrong(`has ${slides} ${plural(slides, "slide", "slides")}, wanted ${deck.slides}`);
  if (slides < 1 || slides > deck.slides) {
    return wrong(`shows ${slides} ${plural(slides, "slide", "slides")} in its first part, wanted at most ${deck.slides}`);
  }
  return { kind: "ok", why: "", whole };
}

/** One GET of one page. Never throws. Answers { status, text, truncated } or { silent: true, why }. */
export async function readPage(web, deck, base) {
  const init = { method: "GET", redirect: "follow", headers: { accept: "text/html" } };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(TIMEOUT_MS);
  }
  try {
    const res = await web(`${base}${deck.path}`, init);
    const text = typeof res.text === "function" ? String((await res.text()) || "") : "";
    return { status: Number(res && res.status), text, truncated: Boolean(res && res.truncated === true) };
  } catch (err) {
    return { silent: true, why: `did not answer (${clip(err, 80)})` };
  }
}

/**
 * Read every page at once and judge each one. Never throws. Answers one result per deck, in list order:
 * { deck, kind, why, whole }. A page still waiting at the deadline is silent.
 * @param {{ decks: Array<object>, web: Function|null, base: string, deadlineMs?: number }} io
 */
export async function readPages({ decks, web, base, deadlineMs } = {}) {
  const list = Array.isArray(decks) ? decks : [];
  const answers = new Array(list.length).fill(null);
  const haveWeb = typeof web === "function";
  if (haveWeb && list.length) {
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, Number.isFinite(deadlineMs) ? deadlineMs : DEADLINE_MS);
    });
    try {
      await Promise.race([
        Promise.all(list.map((deck, i) => readPage(web, deck, base).then((answer) => { answers[i] = answer; }))),
        timedOut
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const unread = { silent: true, why: haveWeb ? "did not answer in time" : "this run has no web client" };
  return list.map((deck, i) => ({ deck, ...judgePage(deck, answers[i] || unread) }));
}

/** The one row for a set of results. FAIL when any page is wrong, skip when none is wrong but some were not read, PASS when all were. */
export function verdictRow(results) {
  const total = results.length;
  if (total === 0) {
    return row("FAIL", "the list of phone slideshow pages is empty, so no page is being watched", FIX);
  }
  const wrong = results.filter((r) => r.kind === "wrong");
  const silent = results.filter((r) => r.kind === "silent");
  const noun = plural(total, "phone slideshow page", "phone slideshow pages");
  if (wrong.length) {
    const quiet = silent.length ? ` ${silent.length} more did not answer, so they were not judged.` : "";
    return row(
      "FAIL",
      `${wrong.length} of ${total} ${noun} ${plural(wrong.length, "is", "are")} wrong: ${listed(wrong.map((r) => `${r.deck.slug} ${r.why}`))}.${quiet}`,
      FIX
    );
  }
  if (silent.length) {
    return row("skip", `${silent.length} of ${total} ${noun} did not answer (${listed(silent.map((r) => `${r.deck.slug} ${r.why}`))}), so they were not all read`);
  }
  if (results.every((r) => r.whole)) {
    const slides = results.reduce((sum, r) => sum + r.deck.slides, 0);
    return row("PASS", `${total} ${noun}, ${slides} slides: each answered 200 with its title, its slide 1 code and all of its slides`);
  }
  return row("PASS", `${total} ${noun}: each answered 200 with its title and its slide 1 code (the slide count is judged when a page is read whole)`);
}

/** Read the pages and answer the one row. */
export async function checkDeckPages(io) {
  return [verdictRow(await readPages(io))];
}
