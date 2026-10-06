/* fh-events.js — the shared funnel tracker. Contract: docs/tracking/tracking-spec.md.

   Loaded on every funnel page (marketing/landing-pages/tracking-manifest.mjs puts it
   there). Every event is one POST to https://fundhub.ai/api/public/slo-interest:

     { kind: "track", event, seq, session_id, page, props,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       landing_path, referrer_domain, webdriver }

   The server works out funnel and step from page. A page that is not on PAGES
   sends nothing, with one exception: a page of a funnel the dashboard built
   (build unit X4) carries window.FH_FUNNEL = { tag, page: { path } } in its
   head. When that path is this page, it sends, and every post carries
   funnel_tag; the server checks the tag and the page against its own list
   (marketing_funnel_pages) and works out the funnel and step from there.

   What this file sends by itself:
     page_view     once per session per page                   { title }
     time_on_page  at 15, 30, 45, 60, 90, 120, 180, 300, 600 seconds the tab was on screen
                                                               { seconds }
     exit          the first time the tab hides or the page closes, once per load
                                                               { seconds, max_scroll }
     click         every press of a button or link             { element_id, label, href_path,
                                                                 y_px, y_pct, section, nth }
     scroll        25, 50, 75, 100% down the page, each once per load       { depth }
     section_view  each page section on screen, once each per load          { section }
     video         play, pause, unmute, mute, and 25/50/75/100% watched
                   (each % once per video per load)            { video, action, pct,
                                                                 current_s, duration_s }
     faq_open      a <details> opened, or a [data-fh-faq] question pressed open   { question }
     carousel      next, prev or play on a testimonial row     { carousel, action, index }

   Passed on from the framed booking calendar (window "message" from
   https://apply.fundhub.ai with data.fh === "track"):
     calendar_view, time_selected, booking_confirmed           { calendar }

   Page hooks send the rest through window.fhTrack(event, props). That call is
   safe before this file has loaded; the queue is sent when it loads:
     (window.fhTrack || function (e, p) { (window.fhq = window.fhq || []).push([e, p]); })("continue", { step: 1 });

   Click labels also go to Clarity and gtag as custom events, first press of each
   label per page load, as before.

   Meta (docs/tracking/meta-events.md, "Phase 4 contract"). Every post also
   carries url (origin + path, never the query), fbc and fbp (when there are
   any), and meta_event_id when the event stands for a Meta event. The same
   id goes to fbq as eventID, so Meta counts the browser copy and our
   server's copy once:
     page_view            meta_event_id = window.__fhPv (set by the head pixel
                          snippet, which fires PageView itself; this file never
                          does). No __fhPv: "pv.<sid>.<seq>".
                          /roadmap /watch /apply /home also fire ViewContent,
                          eventID "<that id>.vc".
     everything else      "<sid>.<seq>" (the seq of the same post), except
     payment_result       success with an order_ref: Purchase, "purchase.<ref>",
                          once per order. No order_ref: no browser Purchase (the
                          payment webhook sends it with the same id).
   fbq is called only when the pixel is on the page (its stub queues the call
   until it loads), and never from an automated browser (navigator.webdriver),
   the rule the old InitiateCheckout on the Pay press followed. custom_data is
   built only from props this file already kept, by name: never a field value,
   survey answer, email or phone.

   It reads no form field value and sends no typed text. A label is the visible
   words of the button or link, lowercased. Nothing here can throw into the page.
   Inside an iframe it stays silent: the parent page counts the step. */
(function () {
  /* The /funding-book-call calendar also sits inside the /roadmap-book frame.
     The parent page counts that step; the frame must not count it again. */
  try { if (window.self !== window.top) return; } catch (e) { return; }
  /* Loaded twice would count every press twice. */
  try { if (window.__fhEvents) return; window.__fhEvents = 1; } catch (e) { return; }

  var ENDPOINT = "https://fundhub.ai/api/public/slo-interest";
  /* The pages that may send, with their [funnel, step]. Same map as the spec and
     src/funnel/pages.mjs. The server works out funnel and step itself; here the
     map only says which pages may send. Adding a page is one line. */
  var PAGES = {
    "/watch": ["watch", 1],
    "/apply": ["watch", 2],
    "/funding-book-call": ["watch", 3],
    "/thank-you": ["watch", 4],
    "/roadmap": ["roadmap", 1],
    "/roadmap-book": ["roadmap", 2],
    "/roadmap-thank-you": ["roadmap", 3],
    "/order": ["watch", 5],
    "/home": ["homepage", 1]
  };
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_path", "referrer_domain"];
  var PRESSABLE = 'a[href],button,[role="button"],input[type="submit"],input[type="button"],[data-pay]';
  var TIME_MARKS = [15, 30, 45, 60, 90, 120, 180, 300, 600];
  var QUARTERS = [25, 50, 75, 100];
  var EVENT = /^[a-z][a-z0-9_]{0,39}$/;
  var PROP = /^[a-z][a-z0-9_]{0,31}$/;
  /* A prop whose key names a typed value is dropped here, and again at the door. */
  var SECRET = /(^|_)(value|text|typed|email|phone|ssn|social|dob|birth|card|cvv|cvc|pass|password|address|answer)(_|$)/;
  var MAX = 64;
  var RELAY_ORIGIN = "https://apply.fundhub.ai";
  var RELAYED = { calendar_view: 1, time_selected: 1, booking_confirmed: 1 };
  /* Meta: the map is docs/tracking/meta-events.md, "Map (database event → Meta)". */
  var VIEW_CONTENT = { "/roadmap": 1, "/watch": 1, "/apply": 1, "/home": 1 };
  var BUY_BOX = { "fh-cf-form": 1, fhw: 1 };
  var PRICE = { value: 147, currency: "USD" };
  var REF = /^[A-Za-z0-9_-]{1,64}$/;
  var PV_ID = /^[A-Za-z0-9_.-]{1,120}$/;
  var CLICK_ID = /^[A-Za-z0-9_-]{1,500}$/;
  var FB_COOKIE = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_.-]{1,500}$/;
  var has = Object.prototype.hasOwnProperty;

  function clip(s) { return String(s == null ? "" : s).slice(0, MAX); }

  function slug(s, n) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, n || 32);
  }

  /* The page as the map names it. The fundhub.ai homepage ("/" on fundhub.ai or
     www.fundhub.ai) is "/home"; apply.fundhub.ai/ is a different page and stays
     off the map. */
  function pagePath() {
    try {
      var p = location.pathname.toLowerCase().replace(/\/+$/, "");
      if (!p && /^(www\.)?fundhub\.ai$/i.test(location.hostname || "")) return "/home";
      return p;
    } catch (e) { return ""; }
  }

  function attr(el, n) {
    try { return el && el.getAttribute ? el.getAttribute(n) : null; } catch (e) { return null; }
  }

  function later(fn, ms) {
    try { setTimeout(function () { try { fn(); } catch (e) {} }, ms || 0); } catch (e) {}
  }

  function on(target, name, fn, opts) {
    try { target.addEventListener(name, function (ev) { try { fn(ev); } catch (e) {} }, opts); } catch (e) {}
  }

  function now() { return new Date().getTime(); }

  /* ── the send ─────────────────────────────────────────────────────────── */

  var memSid = "";
  function sid() {
    var s = "";
    try { s = sessionStorage.getItem("fh_sid") || ""; } catch (e) {}
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) s = memSid;
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) {
      s = (Math.random().toString(36).slice(2) + now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
      try { sessionStorage.setItem("fh_sid", s); } catch (e2) {}
    }
    memSid = s;
    return s;
  }

  /* One number per send, per session. The door keys each row on it, so a
     retried send is saved once and a second real press is saved again. */
  var memSeq = 0;
  function nextSeq() {
    var n = 0;
    try { n = parseInt(sessionStorage.getItem("fh_seq") || "0", 10) || 0; } catch (e) {}
    if (n < memSeq) n = memSeq;
    n += 1;
    memSeq = n;
    try { sessionStorage.setItem("fh_seq", String(n)); } catch (e) {}
    return n;
  }

  function attribution() {
    try { return JSON.parse(sessionStorage.getItem("fh_attribution") || "{}") || {}; } catch (e) { return {}; }
  }

  /* Short words and numbers only. No objects, no long strings, no key that
     names a typed value. */
  function cleanProps(p) {
    var out = {};
    if (!p || typeof p !== "object") return out;
    var n = 0;
    for (var k in p) {
      if (!has.call(p, k) || !PROP.test(k) || SECRET.test(k)) continue;
      var v = p[k];
      // The order's ref (slo_<hex>) names the Purchase; slug-safe or not sent.
      if (k === "order_ref" && !(typeof v === "string" && REF.test(v))) continue;
      if (typeof v === "number") { if (isFinite(v)) out[k] = v; else continue; }
      else if (typeof v === "boolean") out[k] = v;
      else if (typeof v === "string") { if (v === "") continue; out[k] = clip(v); }
      else continue;
      if (++n >= 12) break;
    }
    return out;
  }

  function beacon(payload) {
    if (navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "text/plain" }))) return;
      } catch (e) {}
    }
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: payload,
      keepalive: true
    })["catch"](function () {});
  }

  /* ── Meta ids: fbclid, fbc, fbp, the page url ─────────────────────────── */

  function urlParam(name) {
    try {
      var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(String(location.search || ""));
      return m ? decodeURIComponent(m[1].replace(/\+/g, " ")).replace(/^\s+|\s+$/g, "") : "";
    } catch (e) { return ""; }
  }

  /* One cookie by name, only when it has Meta's fb.<n>.<ms>.<id> shape. */
  function cookie(name) {
    var all = "";
    try { all = String(document.cookie || ""); } catch (e) { return ""; }
    var parts = all.split(";");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].replace(/^\s+/, "");
      if (kv.indexOf(name + "=") !== 0) continue;
      var v = kv.slice(name.length + 1);
      try { v = decodeURIComponent(v); } catch (e2) {}
      return FB_COOKIE.test(v) ? v : "";
    }
    return "";
  }

  /* The fbc built from the first fbclid, kept in fh_attribution next to the
     UTMs — the same keys and rule as fh-attribution.js, so whichever script
     sees the click first saves it ("fb.1.<ms first seen>.<fbclid>"). */
  var builtFbc = null;
  function storedFbc() {
    if (builtFbc !== null) return builtFbc;
    builtFbc = "";
    var saved = attribution();
    if (CLICK_ID.test(saved.fbclid || "") && FB_COOKIE.test(saved.fbc || "")) return (builtFbc = saved.fbc);
    var id = urlParam("fbclid");
    if (!CLICK_ID.test(id) || saved.fbclid) return builtFbc;
    builtFbc = "fb.1." + now() + "." + id;
    saved.fbclid = id;
    saved.fbc = builtFbc;
    try { sessionStorage.setItem("fh_attribution", JSON.stringify(saved)); } catch (e) {}
    return builtFbc;
  }

  /* The page without its query string or anchor. */
  function pageUrl() {
    try {
      var o = location.origin || ((location.protocol || "https:") + "//" + (location.host || location.hostname || ""));
      return String(o + (location.pathname || "/")).slice(0, 300);
    } catch (e) { return ""; }
  }

  /* ── Meta events ──────────────────────────────────────────────────────── */

  /* true the first time key is asked for (per page load; per session too
     when perSession, so a reload does not count it again). */
  var metaDone = {};
  function first(key, perSession) {
    if (metaDone[key]) return false;
    metaDone[key] = 1;
    if (!perSession) return true;
    try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch (e) {}
    return true;
  }

  /* custom_data from kept props only, by name; empty values left out. */
  function data(pairs) {
    var out = {};
    for (var k in pairs) if (has.call(pairs, k) && pairs[k] != null && pairs[k] !== "") out[k] = pairs[k];
    return out;
  }

  /* The Meta events one of our events stands for, as [method, name,
     custom_data, eventID]. id is "<sid>.<seq>" of this post. */
  function metaFor(event, p, page, id) {
    var out = [];
    function add(name, cd, eid, custom) { out.push([custom ? "trackCustom" : "track", name, cd, eid || id]); }
    if (event === "continue") {
      if (page === "/roadmap" && (p.step == null || p.step === 1)) add("Lead", { content_name: "roadmap_buybox" });
    } else if (event === "survey_answer") {
      /* Lead only on the page's own once-only last:true (a resend after a failed
         submit carries no last, so it cannot count a second Lead). */
      var last = p.last === true;
      if (last) add("Lead", data({ content_name: p.survey }));
      add("SurveyStep", data({ survey: p.survey, step: p.step_num }), null, true);
    } else if (event === "buybox_tab") {
      if (p.tab === 2 && first("fh_ic_sent", true)) add("InitiateCheckout", data(PRICE));
    } else if (event === "payment_result") {
      if (p.result === "success" && REF.test(p.order_ref || "") && first("fh_buy_" + p.order_ref, true)) {
        add("Purchase", data(PRICE), "purchase." + p.order_ref);
      }
    } else if (event === "booking_confirmed") {
      add("Schedule", data({ content_name: p.calendar }));
    } else if (event === "survey_route") {
      add("SurveyRouted", data({ offer: p.offer }), null, true);
    } else if (event === "video") {
      if (p.action === "progress" && (p.pct === 25 || p.pct === 50 || p.pct === 75 || p.pct === 100)) {
        add("VideoProgress", data({ video: p.video, pct: p.pct }), null, true);
      }
    } else if (event === "section_view") {
      if (has.call(BUY_BOX, p.section) && first("reached_buy_box", false)) add("ReachedBuyBox", {}, null, true);
    } else if (event === "softpull_submit") {
      add("SoftPullSubmitted", data({ businesses: p.businesses }), null, true);
    }
    return out;
  }

  function fire(list) {
    if (!list.length || navigator.webdriver === true) return;
    var fbq = window.fbq;
    if (typeof fbq !== "function") return;
    for (var i = 0; i < list.length; i++) {
      try { fbq(list[i][0], list[i][1], list[i][2], { eventID: list[i][3] }); } catch (e) {}
    }
  }

  function send(event, props) {
    try {
      var page = pagePath();
      var built = builtFunnel(page);
      if (!has.call(PAGES, page) && !built) return;
      var seq = nextSeq(), session = sid(), kept = cleanProps(props);
      var body = { kind: "track", event: event, seq: seq, session_id: session, page: page, props: kept };
      var saved = attribution();
      for (var i = 0; i < KEYS.length; i++) if (saved[KEYS[i]]) body[KEYS[i]] = saved[KEYS[i]];
      body.webdriver = navigator.webdriver === true;
      body.url = pageUrl();
      if (built) body.funnel_tag = built;
      var fbc = cookie("_fbc") || storedFbc(), fbp = cookie("_fbp");
      if (fbc) body.fbc = fbc;
      if (fbp) body.fbp = fbp;

      var list;
      if (event === "page_view") {
        // PageView itself is the head snippet's; only its id rides along here.
        var pv = "";
        try { pv = window.__fhPv; } catch (e) {}
        body.meta_event_id = typeof pv === "string" && PV_ID.test(pv) ? pv : "pv." + session + "." + seq;
        list = has.call(VIEW_CONTENT, page) ? [["track", "ViewContent", { content_name: page }, body.meta_event_id + ".vc"]] : [];
      } else {
        list = metaFor(event, kept, page, session + "." + seq);
        if (list.length) body.meta_event_id = list[0][3];
      }
      try { fire(list); } catch (e) {}
      beacon(JSON.stringify(body));
    } catch (e) {}
  }

  /* A dashboard-built funnel page: the funnel tag when window.FH_FUNNEL names
     this very page, else "". The server checks it again; this only decides
     whether the page may send. */
  var FUNNEL_TAG = /^fnl-[a-z0-9]+(-[a-z0-9]+)*$/;
  function builtFunnel(page) {
    try {
      var f = window.FH_FUNNEL;
      if (!f || typeof f !== "object" || !f.page || typeof f.page !== "object") return "";
      var tag = typeof f.tag === "string" ? f.tag : "";
      var path = typeof f.page.path === "string" ? f.page.path.toLowerCase().replace(/\/+$/, "") : "";
      return FUNNEL_TAG.test(tag) && tag.length <= 64 && path && path === page ? tag : "";
    } catch (e) { return ""; }
  }

  function fhTrack(event, props) {
    try { if (typeof event === "string" && EVENT.test(event)) send(event, props); } catch (e) {}
  }

  /* ── where things are on the page ─────────────────────────────────────── */

  function closest(node, sel) {
    while (node && node !== document) {
      try { if (node.matches && node.matches(sel)) return node; } catch (e) { return null; }
      node = node.parentNode;
    }
    return null;
  }

  /* The live /watch page scrolls inside <body>, not the window. Read both. */
  function scrollTop() {
    var de = document.documentElement, b = document.body;
    return Math.max(window.pageYOffset || 0, (de && de.scrollTop) || 0, (b && b.scrollTop) || 0);
  }
  function pageHeight() {
    var de = document.documentElement, b = document.body;
    return Math.max((de && de.scrollHeight) || 0, (b && b.scrollHeight) || 0);
  }
  function viewHeight() {
    var de = document.documentElement;
    return window.innerHeight || (de && de.clientHeight) || 0;
  }
  /* How far down the bottom of the screen is, in % of the page. */
  function depth() {
    var h = pageHeight(), vh = viewHeight();
    if (!(h > 0) || !(vh > 0)) return 0;
    var bottom = scrollTop() + vh;
    if (bottom >= h - 2) return 100;
    return Math.max(0, Math.min(100, Math.floor(bottom / h * 100)));
  }

  /* [y_px, y_pct]: where the pressed thing sits on the page. */
  function yOf(el) {
    var r = el.getBoundingClientRect && el.getBoundingClientRect();
    if (!r) return null;
    var y = Math.max(0, Math.round(r.top + scrollTop())), h = pageHeight();
    return [y, h > 0 ? Math.min(100, Math.round(y / h * 100)) : 0];
  }

  /* The nearest wrapper with data-fh-section or an id. */
  function sectionOf(el) {
    for (var n = el && el.parentNode; n && n !== document.body && n !== document; n = n.parentNode) {
      var s = attr(n, "data-fh-section");
      if (s) return clip(s);
      if (n.id) return clip(n.id);
    }
    return "";
  }

  /* The path a link goes to. Never the query string. A tel: or mailto: link
     gives only its scheme. */
  function hrefPath(el) {
    var h = String(attr(el, "href") || "");
    if (!h) return "";
    if (h.charAt(0) === "#") return clip(h);
    var m = /^([a-z][a-z0-9+.-]*):/i.exec(h);
    if (m && !/^https?$/i.test(m[1])) return m[1].toLowerCase() + ":";
    var p = h.replace(/^https?:\/\/[^\/?#]+/i, "").replace(/^\/\/[^\/?#]+/, "").split("#")[0].split("?")[0];
    return clip(p || "/");
  }

  /* ── presses ──────────────────────────────────────────────────────────── */

  /* An <input> gives its value only when it is a submit or button input: that
     value is the button's caption. A field the visitor types in is never read. */
  function isButtonInput(el) {
    return el.tagName === "INPUT" && /^(submit|button)$/i.test(attr(el, "type") || "");
  }
  function wordsOf(el) {
    return attr(el, "aria-label") || el.textContent || (isButtonInput(el) ? el.value : "") || "";
  }

  function press(el, label, nth) { return { el: el, label: clip(label), nth: nth }; }

  /* The pressed element and its label, or null when it is not a button press. */
  function pressFor(node) {
    var hit;
    // "Tap for sound" on the VSL is the press that starts it with sound.
    // The booking page's second film uses #fh-vsl2 / #fh-unmute2.
    if ((hit = closest(node, "#fh-unmute"))) return press(hit, "vsl:unmute", 1);
    if ((hit = closest(node, "#fh-unmute2"))) return press(hit, "vsl2:unmute", 1);
    var film = closest(node, "#fh-vsl"), pair = film ? ["vsl", "fh-unmute"] : null;
    if (!film) { film = closest(node, "#fh-vsl2"); pair = film ? ["vsl2", "fh-unmute2"] : null; }
    if (film) {
      var o = document.getElementById(pair[1]);
      return o && !o.classList.contains("hidden") ? press(film, pair[0] + ":unmute", 1) : null;
    }
    // The phone bar at the bottom of /roadmap. Same words as the buttons above it,
    // so the words alone cannot tell them apart.
    if ((hit = closest(node, "#fh-sticky"))) return press(closest(node, PRESSABLE) || hit, "cta:sticky", 1);
    // Testimonial Play buttons: the carousel play event and the video's own play event name them.
    if (closest(node, ".tplay")) return null;

    var el = closest(node, PRESSABLE);
    if (!el) return null;
    var own = attr(el, "data-fh-track");
    if (own) { var named = slug(own, 56); return named ? press(el, "click:" + named, 1) : null; }

    var base = slug(wordsOf(el), 32);
    if (!base) base = slug((attr(el, "href") || "").replace(/^https?:\/\/[^\/]+/i, "").split("?")[0], 32);
    if (!base) return null;
    var prefix = (el.classList && el.classList.contains("btn")) || el.hasAttribute("data-pay") ? "cta:" : "click:";
    base = prefix + base;

    // Two buttons with the same words (top and bottom "Get Started") are
    // told apart by their order on the page.
    var nth = 1;
    try {
      var all = document.querySelectorAll(PRESSABLE);
      for (var i = 0; i < all.length; i++) {
        if (all[i] === el) break;
        if (prefix + slug(wordsOf(all[i]), 32) === base) nth++;
      }
    } catch (e) {}
    return press(el, nth > 1 ? base + "-" + nth : base, nth);
  }

  var told = {};
  function tell(label) {
    if (!label || told[label]) return;
    told[label] = 1;
    try {
      if (typeof window.clarity === "function") window.clarity("event", label);
      if (typeof window.gtag === "function") window.gtag("event", label, { page: pagePath() });
    } catch (e) {}
  }

  function onPress(node) {
    var hit = pressFor(node);
    if (!hit) return;
    var props = {};
    if (hit.el.id) props.element_id = clip(hit.el.id);
    props.label = hit.label;
    var href = hrefPath(hit.el);
    if (href) props.href_path = href;
    var y = yOf(hit.el);
    if (y) { props.y_px = y[0]; props.y_pct = y[1]; }
    var sec = sectionOf(hit.el);
    if (sec) props.section = sec;
    props.nth = hit.nth;
    send("click", props);
    tell(hit.label);
  }

  /* ── carousels ────────────────────────────────────────────────────────── */

  function carousel(name, action, index) {
    var p = { carousel: name, action: action };
    if (index > 0) p.index = index;
    send("carousel", p);
  }

  function currentIndex(box, sel) {
    var list = box.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) if (attr(list[i], "aria-current") === "true") return i + 1;
    return 0;
  }

  /* data-fh-carousel-index on the control or a wrapper inside the carousel.
     Otherwise: for play, the place of the card it sits in (a .tcard, in the
     order the screen shows; or the place among the carousel's play buttons);
     for next and prev, the place of the [aria-current="true"] item after the press. */
  function ownIndex(a, box, act) {
    for (var n = a; n; n = n.parentNode) {
      var v = attr(n, "data-fh-carousel-index");
      if (v) return parseInt(v, 10) || 0;
      if (n === box) break;
    }
    if (act === "play") {
      var card = closest(a, ".tcard");
      if (card && box.contains(card)) return cardIndex(box, card);
      var plays = box.querySelectorAll('[data-fh-carousel-action="play"]');
      for (var i = 0; i < plays.length; i++) if (plays[i] === a) return i + 1;
      return 0;
    }
    return currentIndex(box, "[aria-current]");
  }

  /* On a phone the /roadmap row shows the cards in their CSS order (Sarah,
     Gene, Colin) and its dots count in that order. On a computer the order is
     the page order. */
  function cardIndex(grid, card) {
    if (!card) return 0;
    var cards = grid.querySelectorAll(".tcard"), keyed = [];
    for (var i = 0; i < cards.length; i++) {
      var o = 0;
      try { o = parseInt(window.getComputedStyle(cards[i]).order, 10) || 0; } catch (e) {}
      keyed.push([o, i, cards[i]]);
    }
    keyed.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
    for (var j = 0; j < keyed.length; j++) if (keyed[j][2] === card) return j + 1;
    return 0;
  }

  function carouselPress(node) {
    var a = closest(node, "[data-fh-carousel-action]");
    if (a) {
      var act = attr(a, "data-fh-carousel-action") || "";
      var box = closest(a, "[data-fh-carousel]");
      if (!box || !/^(next|prev|play)$/.test(act)) return;
      var name = slug(attr(box, "data-fh-carousel"), MAX) || "carousel";
      // After the page's own handler has moved the row.
      later(function () { carousel(name, act, ownIndex(a, box, act)); });
      return;
    }
    // The /roadmap testimonials (slo-01-sales.html): .proofgrid holds the .tcard
    // cards, each with a .tplay button. On a phone the page adds
    // .fhc-arrow[data-go="-1"] / [data-go="1"] and .fhc-dot buttons.
    var grid = closest(node, ".proofgrid");
    if (!grid) return;
    var arrow = closest(node, ".fhc-arrow");
    if (arrow) {
      var go = attr(arrow, "data-go");
      var dir = go === "1" ? "next" : go === "-1" ? "prev" : "";
      if (dir) later(function () { carousel("testimonials", dir, currentIndex(grid, ".fhc-dot")); });
      return;
    }
    var play = closest(node, ".tplay");
    if (play) carousel("testimonials", "play", cardIndex(grid, closest(play, ".tcard")));
  }

  /* ── FAQ ──────────────────────────────────────────────────────────────── */

  function faq(words) {
    var q = slug(words, MAX);
    if (q) send("faq_open", { question: q });
  }

  /* A FAQ button that is not a <details>: mark the question button with
     data-fh-faq (its value, or its words, names the question). A button that
     says aria-expanded="false" after the press was just closed. */
  function faqPress(node) {
    var f = closest(node, "[data-fh-faq]");
    if (!f || f.tagName === "DETAILS" || closest(node, "summary")) return;
    later(function () { if (attr(f, "aria-expanded") !== "false") faq(attr(f, "data-fh-faq") || f.textContent); });
  }

  function onToggle(d) {
    if (!d || d.tagName !== "DETAILS" || !d.open) return;
    var s = null;
    try { s = d.querySelector("summary"); } catch (e) {}
    faq(attr(d, "data-fh-faq") || (s ? s.textContent : ""));
  }

  /* ── video ────────────────────────────────────────────────────────────── */

  function videoName(v) {
    var src = "";
    try { src = String(v.currentSrc || v.src || ""); } catch (e) {}
    var file = src.split("#")[0].split("?")[0].split("/").pop() || "";
    return slug(file.replace(/\.[a-z0-9]+$/i, ""), 40) || "video";
  }

  function isVideo(t) { return !!t && t.tagName === "VIDEO"; }
  function isMuted(v) { return !!(v.muted || v.volume === 0); }
  function vrec(v) {
    if (!v.__fhv) v.__fhv = { muted: isMuted(v), done: {} };
    return v.__fhv;
  }

  function vsend(v, action, pct) {
    var d = Number(v.duration), t = Number(v.currentTime) || 0, known = d > 0 && isFinite(d);
    var p = { video: videoName(v), action: action };
    if (pct != null) p.pct = pct;
    else if (known) p.pct = Math.min(100, Math.floor(t / d * 100));
    p.current_s = Math.round(t);
    if (known) p.duration_s = Math.round(d);
    send("video", p);
  }

  /* 25/50/75/100%, each once per video per page load. Skipping ahead counts. */
  function progress(v, ended) {
    var r = vrec(v), d = Number(v.duration), t = Number(v.currentTime) || 0;
    if (!ended && !(d > 0 && isFinite(d))) return;
    var pct = ended || t >= d - 0.25 ? 100 : t / d * 100;
    for (var i = 0; i < QUARTERS.length; i++) {
      var m = QUARTERS[i];
      if (pct >= m && !r.done[m]) { r.done[m] = 1; vsend(v, "progress", m); }
    }
  }

  function scanVideos() {
    var list = document.querySelectorAll("video");
    for (var i = 0; i < list.length; i++) vrec(list[i]);
  }

  /* ── scroll, time, exit ───────────────────────────────────────────────── */

  var maxScroll = 0, scrollDone = {}, scrollQueued = false;
  function checkScroll() {
    scrollQueued = false;
    var d = depth();
    if (d > maxScroll) maxScroll = d;
    for (var i = 0; i < QUARTERS.length; i++) {
      var m = QUARTERS[i];
      if (d >= m && !scrollDone[m]) { scrollDone[m] = 1; send("scroll", { depth: m }); }
    }
  }

  function visible() {
    try { return document.visibilityState !== "hidden"; } catch (e) { return true; }
  }

  var shownMs = 0, shownSince = null, clock = null, markAt = 0;
  function seconds() { return Math.floor((shownMs + (shownSince != null ? now() - shownSince : 0)) / 1000); }
  function arm() {
    if (clock) { try { clearTimeout(clock); } catch (e) {} clock = null; }
    if (shownSince == null || markAt >= TIME_MARKS.length) return;
    var wait = TIME_MARKS[markAt] * 1000 - (shownMs + now() - shownSince);
    try { clock = setTimeout(tick, Math.max(0, wait) + 50); } catch (e) {}
  }
  function tick() {
    clock = null;
    var s = seconds();
    while (markAt < TIME_MARKS.length && s >= TIME_MARKS[markAt]) {
      send("time_on_page", { seconds: TIME_MARKS[markAt] });
      markAt++;
    }
    arm();
  }
  function startClock() {
    if (shownSince == null) shownSince = now();
    arm();
  }
  function stopClock() {
    if (shownSince != null) { shownMs += now() - shownSince; shownSince = null; }
    arm();
  }

  var exited = false;
  function exit() {
    if (exited) return;
    exited = true;
    var d = depth();
    if (d > maxScroll) maxScroll = d;
    send("exit", { seconds: seconds(), max_scroll: maxScroll });
  }

  /* ── sections ─────────────────────────────────────────────────────────── */

  /* A section is: anything with data-fh-section; a <section> with an id; or a
     big block with an id (at least 200px tall and half the screen wide, not
     fixed, sticky or absolute) that is not inside a section already counted —
     a ClickFunnels section counts once, not once per row and column inside it. */
  var BLOCK = /^(DIV|MAIN|ARTICLE|ASIDE|HEADER|FOOTER|FORM|NAV)$/;
  var picked = [], sectionDone = {}, io = null;

  function pinned(el) {
    for (var n = el; n && n !== document.body && n !== document; n = n.parentNode) {
      var p = "";
      try { p = window.getComputedStyle(n).position; } catch (e) {}
      if (p === "fixed" || p === "sticky" || (n === el && p === "absolute")) return true;
    }
    return false;
  }

  function bigBlock(el) {
    if (!BLOCK.test(el.tagName || "")) return false;
    var r = el.getBoundingClientRect();
    var de = document.documentElement;
    var vw = window.innerWidth || (de && de.clientWidth) || 0;
    return r.height >= 200 && r.width >= vw * 0.5 && !pinned(el);
  }

  function insidePicked(el) {
    for (var j = 0; j < picked.length; j++) if (picked[j] !== el && picked[j].contains(el)) return true;
    return false;
  }

  function sectionName(el) { return clip(attr(el, "data-fh-section") || el.id || ""); }

  /* On screen: 40% of the section is showing, or the section fills 40% of the
     screen (a section taller than 2.5 screens can never be 40% showing). */
  function onSee(entries) {
    var vh = viewHeight();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], el = e.target;
      var h = e.intersectionRect ? e.intersectionRect.height : 0;
      var tall = e.boundingClientRect ? e.boundingClientRect.height : 1;
      if (!(tall > 0) || !(e.intersectionRatio >= 0.4 || (vh > 0 && h >= vh * 0.4))) continue;
      try { io.unobserve(el); } catch (x) {}
      var name = sectionName(el);
      if (name && !sectionDone[name]) { sectionDone[name] = 1; send("section_view", { section: name }); }
    }
  }

  function scanSections() {
    if (typeof window.IntersectionObserver !== "function") return;
    if (!io) io = new window.IntersectionObserver(onSee, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1] });
    var list = document.querySelectorAll("[id],[data-fh-section]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.__fhSec || el === document.body || el === document.documentElement || !sectionName(el)) continue;
      var pick = attr(el, "data-fh-section") != null ||
        el.tagName === "SECTION" ||
        (!insidePicked(el) && bigBlock(el));
      if (!pick) continue;
      el.__fhSec = 1;
      picked.push(el);
      io.observe(el);
    }
  }

  function scan() {
    try { scanVideos(); } catch (e) {}
    try { scanSections(); } catch (e) {}
  }

  /* ── start ────────────────────────────────────────────────────────────── */

  try { window.fhTrack = fhTrack; } catch (e) {}

  try {
    var here = pagePath();
    if (has.call(PAGES, here) || builtFunnel(here)) {
      var flag = "fh_pg_" + here;
      var seen = false;
      try { seen = !!sessionStorage.getItem(flag); if (!seen) sessionStorage.setItem(flag, "1"); } catch (e) {}
      if (!seen) send("page_view", { title: document.title || "" });
    }
  } catch (e) {}

  // Events page hooks queued before this file loaded, in order. Later pushes
  // go straight out.
  try {
    var queued = window.fhq;
    window.fhq = {
      push: function () {
        for (var i = 0; i < arguments.length; i++) {
          var item = arguments[i];
          try { if (item && typeof item === "object") fhTrack(item[0], item[1]); } catch (e) {}
        }
        return 0;
      }
    };
    if (queued && queued.length) for (var q = 0; q < queued.length; q++) window.fhq.push(queued[q]);
  } catch (e) {}

  on(document, "click", function (ev) {
    var node = ev && ev.target;
    try { onPress(node); } catch (e) {}
    try { carouselPress(node); } catch (e) {}
    try { faqPress(node); } catch (e) {}
  }, true);

  // Media events do not bubble; the capture phase on the document hears them.
  on(document, "loadstart", function (ev) { if (isVideo(ev.target)) vrec(ev.target); }, true);
  on(document, "play", function (ev) {
    var v = ev.target;
    if (!isVideo(v)) return;
    vrec(v);
    vsend(v, "play");
    // A video the visitor started by hand. The VSL autoplays muted, so its own
    // start is not a press; its press is the tap for sound above.
    if (!v.hasAttribute("autoplay")) tell("video:play:" + videoName(v));
  }, true);
  on(document, "pause", function (ev) {
    var v = ev.target;
    if (isVideo(v) && !v.ended) vsend(v, "pause");
  }, true);
  on(document, "volumechange", function (ev) {
    var v = ev.target;
    if (!isVideo(v)) return;
    var r = vrec(v), m = isMuted(v);
    if (m !== r.muted) { r.muted = m; vsend(v, m ? "mute" : "unmute"); }
  }, true);
  on(document, "timeupdate", function (ev) { if (isVideo(ev.target)) progress(ev.target, false); }, true);
  on(document, "ended", function (ev) { if (isVideo(ev.target)) progress(ev.target, true); }, true);

  on(document, "toggle", function (ev) { onToggle(ev.target); }, true);

  // The /funding-book-call calendar framed in /apply and /roadmap-book never
  // sends by itself. It posts its booking events up to this page, and only
  // these three, from that one origin, are passed on (spec: "Framed calendar
  // → parent page"). The only prop kept is calendar, as a short slug.
  on(window, "message", function (ev) {
    if (!ev || ev.origin !== RELAY_ORIGIN) return;
    var d = ev.data;
    if (!d || typeof d !== "object" || d.fh !== "track" || typeof d.event !== "string" || !has.call(RELAYED, d.event)) return;
    var cal = d.props && typeof d.props === "object" ? slug(d.props.calendar, 40) : "";
    fhTrack(d.event, cal ? { calendar: cal } : {});
  });

  on(document, "scroll", function () {
    if (scrollQueued) return;
    scrollQueued = true;
    later(checkScroll, 150);
  }, { capture: true, passive: true });

  on(document, "visibilitychange", function () {
    if (visible()) startClock();
    else { stopClock(); exit(); }
  });
  on(window, "pagehide", function () { stopClock(); exit(); });
  on(window, "pageshow", function (ev) { if (ev && ev.persisted && visible()) startClock(); });

  try {
    if (document.readyState === "loading") on(document, "DOMContentLoaded", scan);
    else scan();
  } catch (e) {}
  on(window, "load", function () { scan(); later(scan, 2500); });

  try { if (visible()) startClock(); } catch (e) {}
})();
