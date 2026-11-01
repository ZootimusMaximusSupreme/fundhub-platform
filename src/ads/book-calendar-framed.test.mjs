// The $297 booking page (/roadmap-book) frames the live /funding-book-call
// calendar. 04c-book-framed.html is pushed into that native page's head_code and
// strips it down to the scheduler ONLY when framed; the booking page sizes the
// frame from the height it posts. The standalone calendar must not change.
//
// npm test's glob is src/** only, so this sits here and reads the fragment files.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  PUSH_MANIFEST,
  upsertMarkedBlock,
} from "../../marketing/landing-pages/tracking-manifest.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FRAMED = "marketing/landing-pages/04c-book-framed.html";
const BOOKING = "marketing/landing-pages/slo/slo-02-booking.html";

function cssSelectors(html) {
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@media[^{]*\{/g, "");
  return [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim()).filter(Boolean),
  );
}

test("framed layer is one marked block that does nothing on the standalone page", () => {
  const html = read(FRAMED).trim();
  assert.ok(html.startsWith("<!-- fh-framed:start"), "starts with the start marker");
  assert.ok(html.endsWith("<!-- fh-framed:end -->"), "ends with the end marker");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const s of scripts) {
    assert.match(s, /if\(window\.self===window\.top\) return;/, "every script bails out when not framed");
  }
  const selectors = cssSelectors(html);
  assert.ok(selectors.length > 10);
  for (const sel of selectors) {
    assert.ok(sel.startsWith("html.fh-framed"), `selector must be framed-only: ${sel}`);
  }
});

test("framed layer hides the page chrome and posts its height to the booking page only", () => {
  const html = read(FRAMED);
  assert.match(html, /html\.fh-framed \.fh-root,/, "04a hero/logo and 04b marquee/footer hide");
  assert.match(html, /\[data-page-element="SectionContainer\/V1"\]:not\(:has\(\[data-page-element="AppointmentScheduler\/V1"\]\)\)/);
  assert.match(html, /#calContainer > div:first-child img/, "scheduler logo hides");
  assert.match(html, /var msg=\{type:'fh-book-height',h:h\};/);
  assert.match(html, /window\.parent\.postMessage\(msg,PARENT\)/);
  assert.match(html, /var PARENT='https:\/\/apply\.fundhub\.ai';/);
  assert.doesNotMatch(html, /postMessage\([^)]*'\*'\)/, "never posts to any origin");
  assert.match(html, /if\(parentOrigin\(\)!==PARENT\) return;/, "framed anywhere else, posts nothing");
  assert.match(html, /\.cf2__confirm-details, \.DTP__confirm-details/, "sends where Confirm sits");
  assert.match(html, /if\(fb&&touched\) msg\.focus=/, "never moves the page before the visitor touches the calendar");
});

test("booking page sizes the frame from fh-book-height and keeps the booked redirect", () => {
  const html = read(BOOKING);
  assert.match(
    html,
    /<iframe id="fh-book-frame"[^>]*src="https:\/\/apply\.fundhub\.ai\/funding-book-call"[^>]*min-height:600px/,
  );
  assert.match(html, /e\.origin!==ORIGIN\|\|e\.source!==f\.contentWindow/, "only the calendar frame may resize it");
  assert.match(html, /var ORIGIN='https:\/\/apply\.fundhub\.ai',MIN=600/);
  assert.match(html, /d\.type!=='fh-book-height'/);
  assert.match(html, /var KEY='fh_booking_v1',TY='\/roadmap-thank-you'/, "booked -> /roadmap-thank-you stays");
});

test("manifest pushes the framed layer as a head_code block on the native calendar page", () => {
  const row = PUSH_MANIFEST.find((r) => r.key === "apply-book-framed");
  assert.ok(row);
  assert.equal(row.strategy, "code_block_upsert");
  assert.equal(row.codeSlot, "head_code");
  assert.equal(row.marker, "fh-framed");
  assert.equal(row.fragment, FRAMED);
  const book = PUSH_MANIFEST.find((r) => r.key === "apply-book");
  assert.equal(row.pageId, book.pageId, "same native page as apply-book");
  assert.equal(book.strategy, "head_footer_append_only", "apply-book itself is unchanged");
});

const FIT = "marketing/landing-pages/04d-book-fit.html";

test("standalone fit layer is one marked style block that never matches inside the frame", () => {
  const html = read(FIT).trim();
  assert.ok(html.startsWith("<!-- fh-book-fit:start"), "starts with the start marker");
  assert.ok(html.endsWith("<!-- fh-book-fit:end -->"), "ends with the end marker");
  assert.doesNotMatch(html, /<script/, "CSS only");
  assert.doesNotMatch(html, /fh-framed:start|fh-framed:end/, "never carries the framed block's markers");
  const selectors = cssSelectors(html);
  assert.ok(selectors.length > 10);
  for (const sel of selectors) {
    assert.ok(sel.startsWith("html:not(.fh-framed) "), `selector must be standalone-only: ${sel}`);
  }
});

test("fit layer keeps the logo in its panel and gives phones the full width", () => {
  const html = read(FIT);
  assert.match(
    html,
    /html:not\(\.fh-framed\) #calContainer > div:first-child img\{\s*max-width:100%!important;height:auto!important;/,
    "logo contained at every width",
  );
  assert.match(html, /@media \(min-width:640px\)\{\s*html:not\(\.fh-framed\) #calContainer > div:first-child\{flex-shrink:0!important\}/);
  assert.match(html, /@media \(max-width:639px\)\{/);
  assert.match(html, /width:calc\(100vw - 32px\)!important;/, "16px gutters on phones");
  assert.match(html, /margin-left:calc\(50% - 50vw \+ 16px\)!important;/);
  assert.match(html, /\[class~="sm:p-12"\]:has\(> #cronofy-date-time-picker\)\{padding:16px 8px 20px!important\}/);
  assert.match(html, /\.cf2__calendar-header--title\{font-size:22px!important;white-space:nowrap\}/);
});

test("manifest pushes the fit layer as its own head_code block on the same native page", () => {
  const row = PUSH_MANIFEST.find((r) => r.key === "apply-book-fit");
  assert.ok(row);
  assert.equal(row.strategy, "code_block_upsert");
  assert.equal(row.codeSlot, "head_code");
  assert.equal(row.marker, "fh-book-fit");
  assert.equal(row.fragment, FIT);
  const framed = PUSH_MANIFEST.find((r) => r.key === "apply-book-framed");
  assert.equal(row.pageId, framed.pageId, "same native page as the framed layer");
  assert.notEqual(row.marker, framed.marker, "own marker, so neither push swaps the other's block");
  const live = `<script>px()</script>\n${read(FRAMED).trim()}`;
  const plan = upsertMarkedBlock(live, read(FIT), row.marker);
  assert.equal(plan.mode, "append");
  assert.ok(plan.next.includes(read(FRAMED).trim()), "framed block survives the fit push byte for byte");
});

test("the copied calendar gets the same framed and fit blocks once, on its own page", () => {
  for (const [originalKey, copyKey, marker, fragment] of [
    ["apply-book-framed", "copy-book-framed", "fh-framed", FRAMED],
    ["apply-book-fit", "copy-book-fit", "fh-book-fit", FIT],
  ]) {
    const original = PUSH_MANIFEST.find((r) => r.key === originalKey);
    const copy = PUSH_MANIFEST.find((r) => r.key === copyKey);
    assert.equal(copy.pageId, "25820226");
    assert.equal(copy.funnelId, "994750");
    assert.notEqual(copy.pageId, original.pageId);
    assert.equal(copy.strategy, "code_block_upsert");
    assert.equal(copy.codeSlot, "head_code");
    assert.equal(copy.marker, marker);
    assert.equal(copy.fragment, fragment);
    assert.equal(PUSH_MANIFEST.filter((r) => r.pageId === copy.pageId && r.marker === marker).length, 1);
    const first = upsertMarkedBlock("", read(fragment), marker);
    assert.equal(first.changed, true);
    assert.equal(upsertMarkedBlock(first.next, read(fragment), marker).changed, false);
  }
});

test("upsertMarkedBlock appends, swaps only its own block, and skips when unchanged", () => {
  const v1 = "<!-- fh-x:start v1 -->\n<style>a{}</style>\n<!-- fh-x:end -->";
  const v2 = "<!-- fh-x:start v2 -->\n<style>b{}</style>\n<!-- fh-x:end -->";
  const pixel = "<script>fbq('init','1')</script>";

  const empty = upsertMarkedBlock("", v1, "fh-x");
  assert.deepEqual([empty.changed, empty.mode, empty.send], [true, "append", v1]);

  const add = upsertMarkedBlock(pixel, `\n${v1}\n`, "fh-x");
  assert.equal(add.mode, "append");
  assert.equal(add.send, v1, "append sends only the block, never the live code");
  assert.equal(add.next, `${pixel}\n${v1}`);

  const live = `${pixel}\n${v1}\n<script>after()</script>`;
  const same = upsertMarkedBlock(live, v1, "fh-x");
  assert.deepEqual([same.changed, same.mode, same.send], [false, "none", ""]);

  const swap = upsertMarkedBlock(live, v2, "fh-x");
  assert.equal(swap.mode, "replace");
  assert.equal(swap.send, `${pixel}\n${v2}\n<script>after()</script>`);

  assert.throws(() => upsertMarkedBlock("", "<style></style>", "fh-x"), /must start with/);
  assert.throws(() => upsertMarkedBlock("<!-- fh-x:start v1 -->", v2, "fh-x"), /no "<!-- fh-x:end -->"/);
  assert.throws(() => upsertMarkedBlock(`${v1}\n${v1}`, v2, "fh-x"), /twice/);
});

// Run the booking page's real frame script against a fake page and check where
// Confirm lands after picking a time (reviewer case: 390x844 phone, frame
// 1796 -> 1150, Confirm 968-1016 inside the frame).
function bookingFrame({ vh, frameTop }) {
  const script = [...read(BOOKING).matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("fh-book-height"));
  assert.ok(script, "booking page frame script found");
  const child = {};
  const page = { y: 0, handler: null };
  const f = {
    style: {},
    contentWindow: child,
    getBoundingClientRect() {
      const top = frameTop - page.y;
      return { top, bottom: top + (parseFloat(this.style.height) || 920) };
    },
  };
  const win = {
    innerHeight: vh,
    addEventListener: (type, fn) => {
      if (type === "message") page.handler = fn;
    },
    scrollBy: ({ top }) => {
      page.y += top;
    },
  };
  vm.runInNewContext(script, {
    window: win,
    document: { getElementById: (id) => (id === "fh-book-frame" ? f : null), documentElement: { clientHeight: vh } },
    Number,
    Math,
    isFinite,
    NaN,
  });
  const send = (data, origin = "https://apply.fundhub.ai", source = child) =>
    page.handler({ origin, source, data });
  const onScreen = (t, b) => {
    const top = f.getBoundingClientRect().top;
    return top + t >= 0 && top + b <= vh;
  };
  return { f, page, send, onScreen };
}

test("phone: picking a low time brings Confirm on screen, not the card top", () => {
  const p = bookingFrame({ vh: 844, frameTop: 400 });
  p.send({ type: "fh-book-height", h: 1796 });
  p.page.y = 1300; // scrolled down the long time list to the 12th time
  p.send({ type: "fh-book-height", h: 1150, focus: { t: 780, b: 1080 } });
  assert.equal(p.f.style.height, "1150px");
  assert.ok(p.onScreen(968, 1016), "Confirm is fully on screen");
  assert.ok(p.onScreen(780, 1080), "picked time, Confirm and Cancel all on screen");
});

test("Confirm already on screen: the page does not move", () => {
  const p = bookingFrame({ vh: 900, frameTop: 300 });
  p.send({ type: "fh-book-height", h: 1237 });
  p.page.y = 280;
  p.send({ type: "fh-book-height", h: 1237, focus: { t: 560, b: 830 } });
  assert.equal(p.page.y, 280);
});

test("short laptop window: Confirm is pulled up from below the fold", () => {
  const p = bookingFrame({ vh: 700, frameTop: 300 });
  p.send({ type: "fh-book-height", h: 1237 });
  p.page.y = 300;
  p.send({ type: "fh-book-height", h: 1237, focus: { t: 560, b: 830 } });
  assert.ok(p.onScreen(560, 830));
});

test("form after Confirm fits: the card top shows with the Book button", () => {
  const p = bookingFrame({ vh: 844, frameTop: 400 });
  p.send({ type: "fh-book-height", h: 1150 });
  p.page.y = 1200;
  p.send({ type: "fh-book-height", h: 789, focus: { t: 120, b: 735 } });
  assert.ok(p.onScreen(0, 735), "card top through Book on screen");
});

test("no target sent: a shrink only scrolls when the visitor is left below the whole card", () => {
  const near = bookingFrame({ vh: 844, frameTop: 400 });
  near.send({ type: "fh-book-height", h: 1796 });
  near.page.y = 500; // looking at the month grid
  near.send({ type: "fh-book-height", h: 1300 });
  assert.equal(near.page.y, 500, "another date with fewer times does not move the page");

  const lost = bookingFrame({ vh: 844, frameTop: 400 });
  lost.send({ type: "fh-book-height", h: 1796 });
  lost.page.y = 1900;
  lost.send({ type: "fh-book-height", h: 1150 });
  assert.ok(lost.onScreen(1150 - 100, 1150), "bottom of the card back on screen");
});

test("messages from anywhere but the calendar frame are ignored", () => {
  const p = bookingFrame({ vh: 844, frameTop: 400 });
  p.send({ type: "fh-book-height", h: 1500 }, "https://evil.example");
  p.send({ type: "fh-book-height", h: 1500 }, "https://apply.fundhub.ai", {});
  p.send({ type: "other", h: 1500 });
  p.send({ type: "fh-book-height", h: "x" });
  assert.equal(p.f.style.height, undefined);
  p.send({ type: "fh-book-height", h: 300 });
  assert.equal(p.f.style.height, "600px", "never below 600");
});
