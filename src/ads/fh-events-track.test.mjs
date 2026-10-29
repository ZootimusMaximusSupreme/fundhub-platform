// src/ads/fh-events-track.test.mjs — the shared funnel tracker, every event.
//
// public/funnel/fh-events.js against docs/tracking/tracking-spec.md: the
// fhTrack door and its queue, seq, once-only events, the click payload, scroll,
// time on page, exit, sections, video quarters, FAQ, carousels, the framed
// calendar relay, and that no typed text or field value is ever read.
//
// Runs the real script on the fake page in src/ads/fh-events-harness.mjs.
// WHAT THIS CANNOT TEST: a real browser's IntersectionObserver, media events or
// sendBeacon. The real-browser proof is the Playwright walk on the board.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makePage } from "./fh-events-harness.mjs";

describe("fhTrack and the queue", () => {
  test("events queued before load go out after page_view, in order, with one seq each", () => {
    const fhq = [["continue", { step: 1 }], ["buybox_tab", { tab: 2 }]];
    const p = makePage({ pathname: "/roadmap", fhq }).run();
    assert.deepEqual(p.bodies().map((b) => [b.event, b.seq]), [["page_view", 1], ["continue", 2], ["buybox_tab", 3]]);
    assert.deepEqual(p.bodies()[1].props, { step: 1 });
    assert.equal(p.store.fh_seq, "3");

    p.win.fhq.push(["continue", { step: 2 }]);
    p.win.fhTrack("payment_attempt", { amount_cents: 29700 });
    assert.deepEqual(p.bodies().slice(3).map((b) => [b.event, b.seq]), [["continue", 4], ["payment_attempt", 5]]);
  });

  test("the body is exactly the spec's shape (plus the Meta fields: url, meta_event_id)", () => {
    const attribution = JSON.stringify({ utm_source: "fb", utm_content: "42-phase", landing_path: "/roadmap", referrer_domain: "facebook.com", email: "x@y.z" });
    const p = makePage({ pathname: "/roadmap/", search: "?utm_source=fb&email=x@y.z", storage: { fh_sid: "sess-abcdef12", fh_attribution: attribution } }).run();
    p.win.fhTrack("continue", { step: 1 });
    assert.deepEqual(p.bodies()[1], {
      kind: "track", event: "continue", seq: 2, session_id: "sess-abcdef12", page: "/roadmap", props: { step: 1 },
      utm_source: "fb", utm_content: "42-phase", landing_path: "/roadmap", referrer_domain: "facebook.com", webdriver: false,
      url: "https://apply.fundhub.ai/roadmap/", meta_event_id: "sess-abcdef12.2",
    });
  });

  test("seq carries on from sessionStorage fh_seq across pages", () => {
    const p = makePage({ pathname: "/roadmap-book", storage: { fh_seq: "41", fh_sid: "sess-abcdef12" } }).run();
    assert.equal(p.bodies()[0].seq, 42);
    p.win.fhTrack("calendar_view", { calendar: "x" });
    assert.equal(p.bodies()[1].seq, 43);
    assert.equal(p.store.fh_seq, "43");
  });

  test("with storage blocked, seq still counts up and the session id stays put for the page", () => {
    const p = makePage({ pathname: "/roadmap", storageThrows: true }).run();
    p.win.fhTrack("continue", { step: 1 });
    p.win.fhTrack("continue", { step: 2 });
    const b = p.bodies();
    assert.deepEqual(b.map((x) => x.seq), [1, 2, 3]);
    assert.equal(new Set(b.map((x) => x.session_id)).size, 1);
  });

  test("a bad event name is dropped; nothing ever throws", () => {
    const p = makePage({ pathname: "/roadmap" }).run();
    const before = p.sent.length;
    for (const e of [undefined, null, 5, "", "Has Space", "UPPER", "x".repeat(41), "../x"]) p.win.fhTrack(e, {});
    p.win.fhTrack("continue", null);
    p.win.fhTrack("continue", "not an object");
    p.win.fhq.push(null, 5, ["continue"]);
    assert.equal(p.sent.length, before + 3);
    assert.ok(p.events("continue").every((b) => JSON.stringify(b.props) === "{}"));
  });

  test("props: short words and numbers only, no sensitive keys", () => {
    const p = makePage({ pathname: "/roadmap" }).run();
    p.win.fhTrack("field_focus", {
      form: "buybox", field: "email", value: "a@b.c", typed_text: "hello", email: "a@b.c", ssn: "123", card_number: "4242",
      dob: "1990", nested: { a: 1 }, list: [1], fn() {}, big: "y".repeat(200), n: Infinity, ok: 3, Bad: 1,
    });
    const props = p.events("field_focus")[0].props;
    assert.deepEqual(Object.keys(props).sort(), ["big", "field", "form", "ok"]);
    assert.equal(props.big.length, 64);
  });
});

describe("page_view, time_on_page and exit", () => {
  test("time_on_page sends each mark once, and only counts time the tab is on screen", () => {
    const p = makePage({ pathname: "/watch" }).run();
    p.advance(31_000);
    assert.deepEqual(p.events("time_on_page").map((b) => b.props.seconds), [15, 30]);
    p.hide();
    p.advance(120_000);
    assert.deepEqual(p.events("time_on_page").map((b) => b.props.seconds), [15, 30], "hidden time does not count");
    p.show();
    p.advance(14_100);
    assert.deepEqual(p.events("time_on_page").map((b) => b.props.seconds), [15, 30, 45]);
    p.advance(600_000);
    assert.deepEqual(p.events("time_on_page").map((b) => b.props.seconds), [15, 30, 45, 60, 90, 120, 180, 300, 600]);
  });

  test("exit is sent once per load with seconds and max_scroll", () => {
    const p = makePage({ pathname: "/roadmap", pageHeight: 4000, innerHeight: 800 }).run();
    p.advance(20_000);
    p.scrollTo(1200); // bottom of the screen at 2000 of 4000
    p.scrollTo(0);
    p.hide();
    p.fireWin("pagehide");
    p.show(); p.hide();
    const exits = p.events("exit");
    assert.equal(exits.length, 1);
    assert.deepEqual(exits[0].props, { seconds: 20, max_scroll: 50 });
  });

  test("pagehide alone also sends exit", () => {
    const p = makePage({ pathname: "/apply", pageHeight: 800, innerHeight: 800 }).run();
    p.advance(5_000);
    p.fireWin("pagehide");
    assert.deepEqual(p.events("exit")[0].props, { seconds: 5, max_scroll: 100 });
  });
});

describe("scroll", () => {
  test("25/50/75/100 each once per load; nothing until the visitor scrolls", () => {
    const p = makePage({ pathname: "/roadmap", pageHeight: 4000, innerHeight: 800 }).run();
    assert.equal(p.events("scroll").length, 0);
    p.scrollTo(250);  // bottom at 1050 = 26%
    p.scrollTo(1250); // 51%
    p.scrollTo(300);
    p.scrollTo(1300);
    assert.deepEqual(p.events("scroll").map((b) => b.props.depth), [25, 50]);
    p.scrollTo(3200); // the bottom
    assert.deepEqual(p.events("scroll").map((b) => b.props.depth), [25, 50, 75, 100]);
  });
});

describe("click payload", () => {
  test("every press sends element_id, label, href_path, y_px, y_pct, section, nth", () => {
    const p = makePage({ pathname: "/roadmap", pageHeight: 4000 });
    const sect = p.node("section", { id: "fh-order", rect: { top: 3000, height: 900, width: 400 } });
    const a = p.node("a", { id: "buy-top", cls: ["btn"], text: "Get My $297 Funding Roadmap", attrs: { href: "https://apply.fundhub.ai/roadmap?utm_source=fb&email=a@b.c#x" }, rect: { top: 3200, height: 40, width: 300 } });
    sect.append(a);
    p.add(sect).run();
    p.win.pageYOffset = 2800;
    p.click(a); p.click(a);
    const c = p.events("click");
    assert.equal(c.length, 2, "every press, not only the first");
    assert.deepEqual(c[0].props, {
      element_id: "buy-top", label: "cta:get-my-297-funding-roadmap", href_path: "/roadmap",
      y_px: 3200, y_pct: 80, section: "fh-order", nth: 1,
    });
    assert.ok(c[1].seq > c[0].seq);
  });

  test("data-fh-section names the section; tel: and mailto: send only the scheme", () => {
    const p = makePage({ pathname: "/thank-you" });
    const wrap = p.node("div", { attrs: { "data-fh-section": "contact" } });
    const tel = p.node("a", { text: "Call us", attrs: { href: "tel:+15555550100" } });
    const mail = p.node("a", { text: "Email us", attrs: { href: "mailto:help@fundhub.ai?subject=hi" } });
    wrap.append(tel, mail);
    p.add(wrap).run();
    p.click(tel); p.click(mail);
    assert.deepEqual(p.events("click").map((b) => [b.props.href_path, b.props.section]), [["tel:", "contact"], ["mailto:", "contact"]]);
  });

  test("labels fit the door's TARGET shape and stay under 64 characters", () => {
    const p = makePage({ pathname: "/watch" });
    const b = p.node("button", { text: "A".repeat(300), attrs: { "data-fh-track": "z".repeat(300) } });
    p.add(b).run();
    p.click(b);
    const label = p.events("click")[0].props.label;
    assert.match(label, /^[a-z0-9][a-z0-9_:.-]{0,63}$/);
  });
});

describe("section_view", () => {
  function sectionsPage() {
    const p = makePage({ pathname: "/roadmap", innerWidth: 400, innerHeight: 800 });
    const nodes = {
      order: p.node("section", { id: "fh-order", rect: { height: 900, width: 400 } }),
      media: p.node("div", { id: "fh-media", rect: { height: 225, width: 352 } }),
      overlay: p.node("div", { id: "fh-unmute", rect: { height: 225, width: 352 }, css: { position: "absolute" } }),
      sticky: p.node("div", { id: "fh-sticky", rect: { height: 300, width: 400 }, css: { position: "fixed" } }),
      tiny: p.node("div", { id: "fh-note", rect: { height: 40, width: 400 } }),
      form: p.node("div", { id: "fh-cf-form", rect: { height: 3000, width: 400 } }),
      inner: p.node("div", { id: "fhw", rect: { height: 2900, width: 400 } }),
      marked: p.node("span", { attrs: { "data-fh-section": "proof-row" }, rect: { height: 10, width: 10 } }),
      vsl: p.node("video", { id: "fh-vsl", rect: { height: 225, width: 352 }, video: {} }),
    };
    nodes.media.append(nodes.vsl, nodes.overlay);
    nodes.form.append(nodes.inner);
    p.add(nodes.media, nodes.order, nodes.form, nodes.sticky, nodes.tiny, nodes.marked).run();
    return { p, n: nodes };
  }

  test("only page sections are watched: <section id>, big top-level blocks, data-fh-section", () => {
    const { p, n } = sectionsPage();
    const watched = [...p.observed].map((el) => el.getAttribute("data-fh-section") || el.id).sort();
    assert.deepEqual(watched, ["fh-cf-form", "fh-media", "fh-order", "proof-row"]);
    assert.ok(!p.observed.has(n.inner), "a block inside a counted block is not its own section");
  });

  test("sent once when 40% is on screen, or when it fills 40% of the screen", () => {
    const { p, n } = sectionsPage();
    p.see(n.order, { ratio: 0.2 });
    assert.equal(p.events("section_view").length, 0, "20% of a short section is not enough");
    p.see(n.order, { ratio: 0.45 });
    p.see(n.form, { ratio: 0.12, height: 360 }); // a tall block filling 45% of the screen
    p.see(n.order, { ratio: 1 });
    assert.deepEqual(p.events("section_view").map((b) => b.props.section), ["fh-order", "fh-cf-form"]);
    assert.ok(!p.observed.has(n.order), "unobserved after it counts");
  });

  test("a block that shows up later is picked up on the next scan", () => {
    const { p } = sectionsPage();
    const late = p.node("section", { id: "fh-watch-proof", rect: { height: 600, width: 400 } });
    p.add(late);
    p.fireWin("load");
    assert.ok(p.observed.has(late));
  });

  test("no IntersectionObserver: no sections, no error", () => {
    const p = makePage({ pathname: "/roadmap", io: false });
    p.add(p.node("section", { id: "a", rect: { height: 900, width: 400 } })).run();
    assert.equal(p.events("page_view").length, 1);
  });
});

describe("video", () => {
  function videoPage(attrs = {}) {
    const p = makePage({ pathname: "/roadmap" });
    const v = p.node("video", {
      id: "fh-vsl", attrs,
      video: { currentSrc: "https://fundhub.ai/funnel/slo-vsl.mp4?v=3", duration: 200, muted: "muted" in attrs },
    });
    p.add(v).run();
    return { p, v };
  }
  const acts = (p) => p.events("video").map((b) => (b.props.action === "progress" ? `progress:${b.props.pct}` : b.props.action));

  test("play, unmute, mute, pause with position, named by the file", () => {
    const { p, v } = videoPage({ autoplay: "", muted: "" });
    p.fireDoc("play", v);
    v.currentTime = 10.4; v.muted = false; p.fireDoc("volumechange", v);
    v.volume = 0; p.fireDoc("volumechange", v);
    v.volume = 0.5; p.fireDoc("volumechange", v); // sound back up: unmute again
    v.volume = 0.7; p.fireDoc("volumechange", v); // a volume change that is not a mute change
    v.currentTime = 30; p.fireDoc("pause", v);
    assert.deepEqual(acts(p), ["play", "unmute", "mute", "unmute", "pause"]);
    assert.deepEqual(p.events("video")[1].props, { video: "slo-vsl", action: "unmute", pct: 5, current_s: 10, duration_s: 200 });
  });

  test("25/50/75/100 once each per video per load; skipping ahead counts every quarter passed", () => {
    const { p, v } = videoPage();
    for (const t of [10, 51, 52, 60]) { v.currentTime = t; p.fireDoc("timeupdate", v); }
    assert.deepEqual(acts(p), ["progress:25"]);
    v.currentTime = 160; p.fireDoc("timeupdate", v);
    assert.deepEqual(acts(p), ["progress:25", "progress:50", "progress:75"]);
    assert.deepEqual(p.events("video")[1].props, { video: "slo-vsl", action: "progress", pct: 50, current_s: 160, duration_s: 200 });
    v.currentTime = 0; p.fireDoc("timeupdate", v);
    v.currentTime = 199.9; v.ended = true;
    p.fireDoc("timeupdate", v); p.fireDoc("pause", v); p.fireDoc("ended", v);
    assert.deepEqual(acts(p), ["progress:25", "progress:50", "progress:75", "progress:100"], "no pause at the end, 100 once");
  });

  test("a video with no known length sends no quarters until it ends", () => {
    const { p, v } = videoPage();
    v.duration = Infinity; v.currentTime = 50; p.fireDoc("timeupdate", v);
    assert.deepEqual(acts(p), []);
    p.fireDoc("ended", v);
    assert.deepEqual(acts(p), ["progress:25", "progress:50", "progress:75", "progress:100"]);
  });

  test("each video keeps its own quarters", () => {
    const p = makePage({ pathname: "/roadmap" });
    const a = p.node("video", { video: { currentSrc: "https://fundhub.ai/funnel/slo-testimonial-gene.mp4", duration: 40 } });
    const b = p.node("video", { video: { currentSrc: "https://fundhub.ai/funnel/slo-testimonial-sarah.mp4", duration: 40 } });
    p.add(a, b).run();
    a.currentTime = 11; p.fireDoc("timeupdate", a);
    b.currentTime = 11; p.fireDoc("timeupdate", b);
    assert.deepEqual(p.events("video").map((x) => x.props.video), ["slo-testimonial-gene", "slo-testimonial-sarah"]);
  });
});

describe("faq_open", () => {
  test("a <details> opened sends its question slug; closing sends nothing", () => {
    const p = makePage({ pathname: "/roadmap" });
    const d = p.node("details");
    d.append(p.node("summary", { text: "Will this hurt my credit score?" }), p.node("div", { text: "No." }));
    p.add(d).run();
    d.open = true; p.fireDoc("toggle", d);
    d.open = false; p.fireDoc("toggle", d);
    d.open = true; p.fireDoc("toggle", d);
    assert.deepEqual(p.events("faq_open").map((b) => b.props.question), ["will-this-hurt-my-credit-score", "will-this-hurt-my-credit-score"]);
  });

  test("a data-fh-faq button counts when it opens, not when it closes", () => {
    const p = makePage({ pathname: "/thank-you" });
    const q = p.node("button", { text: "How fast?", attrs: { "data-fh-faq": "how-fast", "aria-expanded": "false" } });
    p.add(q).run();
    p.click(q); q.setAttribute("aria-expanded", "true"); p.flush();
    p.click(q); q.setAttribute("aria-expanded", "false"); p.flush();
    assert.deepEqual(p.events("faq_open").map((b) => b.props.question), ["how-fast"]);
    assert.equal(p.events("click").length, 2, "the press is still a click");
  });
});

describe("carousel", () => {
  /* The /roadmap row as slo-01-sales.html builds it on a phone: .proofgrid >
     .fhc-rail > .tcard (Colin, Gene, Sarah; CSS order 3, 2, 1) and .fhc-nav with
     .fhc-arrow[data-go] and .fhc-dot. */
  function roadmapRow() {
    const p = makePage({ pathname: "/roadmap" });
    const grid = p.node("div", { cls: ["proofgrid"] });
    const rail = p.node("div", { cls: ["fhc-rail"] });
    const cards = ["colin", "gene", "sarah"].map((name, i) => {
      const card = p.node("figure", { cls: ["tcard"], css: { order: String(3 - i) } });
      const slot = p.node("div", { cls: ["vslot"] });
      slot.append(p.node("video", { video: { currentSrc: `https://fundhub.ai/funnel/slo-testimonial-${name}.mp4` } }), p.node("button", { cls: ["tplay"], attrs: { "aria-label": `Play ${name}` } }));
      card.append(slot);
      return card;
    });
    rail.append(...cards);
    const nav = p.node("div", { cls: ["fhc-nav"] });
    const prev = p.node("button", { cls: ["fhc-arrow"], attrs: { "data-go": "-1", "aria-label": "Previous testimonial" } });
    const dots = p.node("div", { cls: ["fhc-dots"] });
    const dot = [1, 2, 3].map((i) => p.node("button", { cls: ["fhc-dot"], attrs: { "aria-label": `Testimonial ${i} of 3`, "aria-current": i === 1 ? "true" : "false" } }));
    dots.append(...dot);
    const next = p.node("button", { cls: ["fhc-arrow"], attrs: { "data-go": "1", "aria-label": "Next testimonial" } });
    nav.append(prev, dots, next);
    grid.append(rail, nav);
    p.add(grid).run();
    const current = (i) => dot.forEach((d, k) => d.setAttribute("aria-current", k === i ? "true" : "false"));
    return { p, cards, prev, next, current };
  }

  test("next and prev send the slide shown after the press", () => {
    const { p, next, prev, current } = roadmapRow();
    p.click(next); current(1); p.flush();
    p.click(next); current(2); p.flush();
    p.click(prev); current(1); p.flush();
    assert.deepEqual(p.events("carousel").map((b) => b.props), [
      { carousel: "testimonials", action: "next", index: 2 },
      { carousel: "testimonials", action: "next", index: 3 },
      { carousel: "testimonials", action: "prev", index: 2 },
    ]);
    assert.deepEqual(p.events("click").map((b) => b.props.label), ["click:next-testimonial", "click:next-testimonial", "click:previous-testimonial"]);
  });

  test("Play sends the card's place in the row as the phone shows it", () => {
    const { p, cards } = roadmapRow();
    p.click(cards[2].querySelector(".tplay")); // Sarah, first on a phone
    p.click(cards[0].querySelector(".tplay")); // Colin, last on a phone
    assert.deepEqual(p.events("carousel").map((b) => [b.props.action, b.props.index]), [["play", 1], ["play", 3]]);
  });

  test("the /roadmap row marked with data-fh-carousel: one event per press, play counts the card, not the dot", () => {
    const { p, cards, next, current } = roadmapRow();
    const grid = cards[0].parentNode.parentNode; // .proofgrid (the page marks its wrapper the same way)
    grid.setAttribute("data-fh-carousel", "testimonials");
    for (const c of cards) c.querySelector(".tplay").setAttribute("data-fh-carousel-action", "play");
    next.setAttribute("data-fh-carousel-action", "next");
    // On a computer every card has CSS order 0 and the hidden dots still say 1.
    for (const c of cards) c.css.order = "0";
    p.click(cards[2].querySelector(".tplay")); p.flush();
    p.click(next); current(1); p.flush();
    assert.deepEqual(p.events("carousel").map((b) => b.props), [
      { carousel: "testimonials", action: "play", index: 3 },
      { carousel: "testimonials", action: "next", index: 2 },
    ]);
  });

  test("any row marked data-fh-carousel / data-fh-carousel-action works the same way", () => {
    const p = makePage({ pathname: "/watch" });
    const box = p.node("div", { attrs: { "data-fh-carousel": "Client Wins" } });
    const item = p.node("div", { attrs: { "data-fh-carousel-index": "4" } });
    const play = p.node("button", { text: "Play", attrs: { "data-fh-carousel-action": "play" } });
    item.append(play);
    const fwd = p.node("button", { text: "Next", attrs: { "data-fh-carousel-action": "next" } });
    const odd = p.node("button", { text: "Shuffle", attrs: { "data-fh-carousel-action": "shuffle" } });
    box.append(item, fwd, odd);
    p.add(box).run();
    p.click(play); p.click(fwd); p.click(odd); p.flush();
    assert.deepEqual(p.events("carousel").map((b) => b.props), [
      { carousel: "client-wins", action: "play", index: 4 },
      { carousel: "client-wins", action: "next" },
    ]);
  });
});

describe("framed calendar relay", () => {
  const msg = (event, props, origin = "https://apply.fundhub.ai") => ({ origin, data: { fh: "track", event, props } });

  test("a booking event from the framed calendar is passed on with only its calendar slug", () => {
    const p = makePage({ pathname: "/roadmap-book" }).run();
    p.fireWin("message", msg("time_selected", { calendar: "Funding Book Call", email: "a@b.c", slot: "10:00" }));
    p.fireWin("message", msg("booking_confirmed", { calendar: "funding-book-call" }));
    p.fireWin("message", msg("calendar_view", null));
    assert.deepEqual(p.bodies().slice(1).map((b) => [b.event, b.props, b.page]), [
      ["time_selected", { calendar: "funding-book-call" }, "/roadmap-book"],
      ["booking_confirmed", { calendar: "funding-book-call" }, "/roadmap-book"],
      ["calendar_view", {}, "/roadmap-book"],
    ]);
  });

  test("accepted booking from the actual /apply frame tracks before the parent redirects", () => {
    const p = makePage({ pathname: "/apply", storage: { fh_sid: "sess-abcdef12" } }).run();
    const frame = p.node("iframe", { id: "fh-book-frame" });
    frame.contentWindow = {};
    p.add(frame);
    const accepted = msg("booking_confirmed", { calendar: "funding-book-call" });
    accepted.source = frame.contentWindow;
    p.fireWin("message", accepted);
    assert.equal(p.events("booking_confirmed").length, 1);
    assert.ok(p.events("booking_confirmed")[0].meta_event_id, "Meta Schedule keeps its dedupe ID");
    assert.ok(Number(p.store.fh_apply_booking_confirmed_v1) > 0);
    assert.equal(p.win.location.href, "https://apply.fundhub.ai/apply");
    p.advance(250);
    assert.equal(p.win.location.href, "https://apply.fundhub.ai/thank-you");
    p.fireWin("message", accepted);
    assert.equal(p.win.location.href, "https://apply.fundhub.ai/thank-you");
  });

  test("the accepted booking's exact body is sent once more on the next page, so a beacon lost to the redirect still lands", () => {
    const apply = makePage({ pathname: "/apply", storage: { fh_sid: "sess-abcdef12" } }).run();
    const frame = apply.node("iframe", { id: "fh-book-frame" });
    frame.contentWindow = {};
    apply.add(frame);
    apply.fireWin("message", { ...msg("booking_confirmed", { calendar: "funding-book-call" }), source: frame.contentWindow });
    apply.fireWin("message", { ...msg("time_selected", { calendar: "funding-book-call" }), source: frame.contentWindow });
    const first = apply.sent.find((s) => JSON.parse(s.text).event === "booking_confirmed").text;

    const thanks = makePage({ pathname: "/thank-you", storage: apply.store, fbq: true }).run();
    const again = thanks.sent.filter((s) => JSON.parse(s.text).event === "booking_confirmed");
    assert.equal(again.length, 1, "resent once");
    assert.equal(again[0].text, first, "same session, seq and Meta id, so the door saves it once");
    assert.equal(thanks.events("time_selected").length, 0, "only booking_confirmed is kept");
    assert.deepEqual(thanks.fbqCalls, [], "no second browser Schedule");

    const later = makePage({ pathname: "/thank-you", storage: thanks.store }).run();
    assert.equal(later.events("booking_confirmed").length, 0, "never a third time");
  });

  test("a kept booking older than 30 minutes is dropped, not resent", () => {
    const body = JSON.stringify({ kind: "track", event: "booking_confirmed", seq: 9, session_id: "sess-abcdef12", page: "/apply", props: {} });
    const p = makePage({ pathname: "/thank-you", storage: { fh_booking_resend_v1: JSON.stringify({ at: 1_000_000 - 31 * 60 * 1000, body }) } }).run();
    assert.equal(p.events("booking_confirmed").length, 0);
    assert.equal(p.store.fh_booking_resend_v1, "");
  });

  test("a relay without the actual frame source never redirects /apply", () => {
    const p = makePage({ pathname: "/apply" }).run();
    const frame = p.node("iframe", { id: "fh-book-frame" });
    frame.contentWindow = {};
    p.add(frame);
    p.fireWin("message", msg("booking_confirmed", { calendar: "funding-book-call" }));
    p.fireWin("message", { ...msg("booking_confirmed", { calendar: "other" }), source: frame.contentWindow });
    p.fireWin("message", msg("calendar_view", { calendar: "funding-book-call" }));
    p.fireWin("message", msg("time_selected", { calendar: "funding-book-call" }));
    p.advance(500);
    for (const event of ["booking_confirmed", "calendar_view", "time_selected"]) {
      assert.equal(p.events(event).length, 0, event + " from another frame must not pollute live funnel stats");
    }
    assert.equal(p.win.location.href, "https://apply.fundhub.ai/apply");
    assert.equal(p.store.fh_apply_booking_confirmed_v1, undefined);
  });

  test("a message from any other origin is ignored", () => {
    const p = makePage({ pathname: "/apply" }).run();
    for (const origin of ["https://evil.example", "https://fundhub.ai", "http://apply.fundhub.ai", "https://apply.fundhub.ai.evil.example", "null"]) {
      p.fireWin("message", msg("booking_confirmed", { calendar: "x" }, origin));
    }
    p.fireWin("message", { data: { fh: "track", event: "booking_confirmed", props: { calendar: "x" } } });
    assert.equal(p.sent.length, 1, "only the page_view");
  });

  test("any other event name, or a message not marked fh: track, is ignored", () => {
    const p = makePage({ pathname: "/apply" }).run();
    for (const event of ["click", "page_view", "payment_result", "continue", "exit", "", undefined]) p.fireWin("message", msg(event, { calendar: "x" }));
    p.fireWin("message", { origin: "https://apply.fundhub.ai", data: { event: "booking_confirmed" } });
    p.fireWin("message", { origin: "https://apply.fundhub.ai", data: "booking_confirmed" });
    p.fireWin("message", { origin: "https://apply.fundhub.ai", data: null });
    assert.equal(p.sent.length, 1, "only the page_view");
  });
});

// The app-download card on /thank-you ends in one link to Apple. The tracker
// recognises the link, not the card (docs/tracking/tracking-spec.md, "App
// download tap"). The card itself is run in src/ads/fh-events-cortana.test.mjs.
describe("app_download_tap", () => {
  const SID = "sess-abcdef12";
  const TESTFLIGHT = "https://testflight.apple.com/join/AbC123xyz";
  const link = (p, href, words = "Download for iPhone") =>
    p.addHtml(`<section id="app-card"><a class="btn" href="${href}" target="_blank" rel="noopener noreferrer">${words} <span aria-hidden="true">→</span></a></section>`)[0].children[0];
  const thanks = () => makePage({ pathname: "/thank-you", storage: { fh_sid: SID } }).run();
  const taps = (p) => p.events("app_download_tap");

  test("a press on an Apple link sends app_download_tap after its click, with no props; every press is sent", () => {
    const p = thanks();
    const a = link(p, TESTFLIGHT);
    p.click(a.children[0]); // the arrow inside the link
    assert.deepEqual(p.bodies().map((b) => [b.event, b.seq]), [["page_view", 1], ["click", 2], ["app_download_tap", 3]]);
    assert.deepEqual(taps(p)[0], {
      kind: "track", event: "app_download_tap", seq: 3, session_id: SID, page: "/thank-you", props: {},
      webdriver: false, url: "https://apply.fundhub.ai/thank-you",
    });
    p.click(a);
    assert.equal(taps(p).length, 2, "a second real press is saved again, as a click is");
    assert.equal(p.events("click").length, 2);
  });

  test("portal App Store press sends the same API event from its own page", () => {
    const p = makePage({ pathname: "/portal-login.html", hostname: "fundhub.ai", storage: { fh_sid: SID } }).run();
    p.click(link(p, "https://apps.apple.com/us/app/fundhub-portal/id6823985032"));
    assert.equal(taps(p).length, 1);
    assert.equal(taps(p)[0].page, "/portal-login.html");
    assert.equal(taps(p)[0].url, "https://fundhub.ai/portal-login.html");
  });

  test("the App Store, TestFlight and iTunes hosts count, however the address is cased", () => {
    const p = thanks();
    const hrefs = [
      TESTFLIGHT,
      "https://apps.apple.com/us/app/fundhub/id1234567890",
      "https://apps.apple.com/app/id1234567890?l=en",
      "https://itunes.apple.com/us/app/fundhub/id1234567890",
      "  HTTPS://TestFlight.Apple.com/join/AbC123xyz",
    ];
    for (const href of hrefs) p.click(link(p, href));
    assert.equal(taps(p).length, hrefs.length);
  });

  test("any other link on /thank-you sends no tap, and a look-alike host is not Apple", () => {
    const p = thanks();
    const others = [
      "https://apply.fundhub.ai/watch", "mailto:team@example.com", "tel:+15555550100", "#top",
      "https://calendar.apple.com/event/1", "https://support.apple.com/en-us/HT201222",
      "http://testflight.apple.com/join/AbC123xyz", // not https
      "https://testflight.apple.com.example.com/join/AbC123xyz",
      "https://apps.apple.com@example.com/us/app/id1",
      "https://example.com/?next=https://apps.apple.com/us/app/id1",
      "https://notapps.apple.com/us/app/id1",
    ];
    for (const href of others) p.click(link(p, href, "Open"));
    assert.equal(taps(p).length, 0);
    assert.equal(p.events("click").length, others.length, "they are still ordinary clicks");
    // A press on the card but off its link, and on a link with no address.
    p.click(p.document.getElementById("app-card"));
    p.click(p.addHtml('<button id="plain">Download</button>')[0]);
    assert.equal(taps(p).length, 0);
  });

  test("only /thank-you: the same Apple link on any other page sends no tap", () => {
    for (const pathname of ["/watch", "/apply", "/funding-book-call", "/roadmap", "/roadmap-book", "/roadmap-thank-you", "/order"]) {
      const p = makePage({ pathname, storage: { fh_sid: SID } }).run();
      p.click(link(p, TESTFLIGHT));
      assert.equal(taps(p).length, 0, pathname);
      assert.equal(p.events("click").length, 1, `${pathname}: the press is still a click`);
    }
  });

  test("the framed page cannot send it: a relayed message is not on the relay list", () => {
    const p = thanks();
    p.fireWin("message", { origin: "https://apply.fundhub.ai", data: { fh: "track", event: "app_download_tap", props: {} } });
    assert.equal(taps(p).length, 0);
  });

  test("an automated browser still sends the Fundhub event, marked webdriver", () => {
    const p = makePage({ pathname: "/thank-you", webdriver: true, storage: { fh_sid: SID } }).run();
    p.click(link(p, TESTFLIGHT));
    assert.deepEqual(taps(p).map((b) => b.webdriver), [true]);
  });
});

describe("privacy", () => {
  test("no form field value is ever read, and typing is never listened to", () => {
    const p = makePage({ pathname: "/roadmap" });
    const form = p.node("form", { id: "fhw", rect: { height: 900, width: 400 } });
    const email = p.node("input", { attrs: { type: "email", name: "email" }, value: "person@example.com" });
    const odd = p.node("input", { attrs: { type: "text", role: "button", name: "ssn" }, value: "123-45-6789" });
    const submit = p.node("input", { attrs: { type: "submit" }, value: "Continue" });
    form.append(email, odd, submit);
    p.add(form).run();
    p.click(email); p.click(odd);
    for (const name of ["input", "change", "keydown", "keyup", "focus", "blur"]) p.fireDoc(name, email);
    assert.ok(!p.valueReads.includes(email) && !p.valueReads.includes(odd), "typed fields are never read");
    p.click(submit);
    assert.deepEqual(p.valueReads, [submit], "only a submit button's caption");
    assert.equal(p.events("click").at(-1).props.label, "click:continue");
    const all = JSON.stringify(p.bodies());
    assert.ok(!all.includes("person@example.com") && !all.includes("123-45-6789"));
    for (const name of ["input", "change", "keydown", "keyup", "keypress", "focus", "focusin", "blur", "submit"]) {
      assert.ok(!p.docListenerNames().includes(name), `no ${name} listener`);
    }
  });
});
