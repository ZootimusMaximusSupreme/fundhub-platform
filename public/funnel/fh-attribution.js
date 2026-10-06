(function () {
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var EXTRA = ["landing_path", "referrer_domain"];
  /* Affiliate referral codes. Same names AF-02 and the ClickFunnels adapter
     read (a1 / a2). ?ref= and ?code= mean a1 — share links use all three.
     Kept off ATTRIBUTION_KEYS on purpose: that list is ad UTMs only. */
  var AFF = ["a1", "a2"];
  var STORE = "fh_attribution";
  /* Meta's click id (docs/tracking/meta-events.md, "fbclid / fbc / fbp").
     Kept first touch in fh_attribution and never stamped on a form. When
     Meta's own _fbc cookie is missing, fbc is built from it:
     "fb.1.<ms first seen>.<fbclid>". public/funnel/fh-events.js reads the same
     two keys and saves them by the same rule when it sees the click first. */
  var CLICK_ID = /^[A-Za-z0-9_-]{1,500}$/;
  var FB_COOKIE = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_.-]{1,500}$/;

  function read() {
    try { return JSON.parse(sessionStorage.getItem(STORE) || "{}") || {}; } catch (e) { return {}; }
  }
  function save(o) {
    try { sessionStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {}
  }

  // 1. Capture from the URL, once, first touch wins.
  var saved = read();
  var qs = new URLSearchParams(location.search);
  var seen = false;
  KEYS.forEach(function (k) {
    var v = (qs.get(k) || "").trim();
    if (v && !saved[k]) { saved[k] = v.slice(0, 200); seen = true; }
  });
  var a1 = (qs.get("a1") || qs.get("ref") || qs.get("code") || "").trim();
  if (a1 && !saved.a1) { saved.a1 = a1.slice(0, 64); seen = true; }
  var a2 = (qs.get("a2") || "").trim();
  if (a2 && !saved.a2) { saved.a2 = a2.slice(0, 64); seen = true; }
  var fbclid = (qs.get("fbclid") || "").trim();
  if (fbclid && !saved.fbclid && CLICK_ID.test(fbclid)) {
    saved.fbclid = fbclid;
    saved.fbc = "fb.1." + Date.now() + "." + fbclid;
  }
  if (seen || !saved.landing_path) {
    if (!saved.landing_path) saved.landing_path = location.pathname;
    if (!saved.referrer_domain && document.referrer) {
      try { saved.referrer_domain = new URL(document.referrer).hostname; } catch (e) {}
    }
  }
  save(saved);

  /* 1b. Count the affiliate click. A direct offer link
     (apply.fundhub.ai/roadmap?a1=AFF-…) never passes through
     fundhub.ai/start.html, which is where clicks were counted, so the
     affiliate's "Clicks 30d" would never move. Once per code per tab session.
     Skipped when start.html already counted it (via=start), and for the
     roadmap paid return, whose ?ref= is a slo_ order ref, not a code. */
  if (a1 && qs.get("via") !== "start" && !/^slo_/i.test(a1)) {
    var clickKey = "fh_aff_click_" + a1.slice(0, 64).toUpperCase();
    var counted = false;
    try { counted = sessionStorage.getItem(clickKey) === "1"; } catch (e) {}
    if (!counted) {
      try { sessionStorage.setItem(clickKey, "1"); } catch (e) {}
      try {
        var clickBody = JSON.stringify({ code: a1.slice(0, 64), source: ("offer" + location.pathname).slice(0, 40) });
        navigator.sendBeacon("https://fundhub.ai/api/public/affiliate-click", new Blob([clickBody], { type: "text/plain" }));
      } catch (e) {}
    }
  }

  // 2. Stamp hidden inputs on every form. Re-run when CF re-renders the form.
  function ensure(form, name, value) {
    var el = form.querySelector('input[name="' + name + '"]');
    if (!el) {
      el = document.createElement("input");
      el.type = "hidden";
      el.name = name;
      form.appendChild(el);
    }
    if (value && !el.value) el.value = value;
  }
  function stamp() {
    var data = read();
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      KEYS.concat(EXTRA).concat(AFF).forEach(function (k) { ensure(forms[i], k, data[k] || ""); });
    }
  }
  stamp();
  if (document.readyState !== "complete") window.addEventListener("load", stamp);
  var tries = 0;
  var t = setInterval(function () { stamp(); if (++tries > 20) clearInterval(t); }, 500);

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
  /* fbc: Meta's _fbc cookie, else the one built from the first fbclid.
     fbp: Meta's _fbp cookie. Either is left out when there is none. */
  function metaIds() {
    var data = read();
    var out = {};
    var fbc = cookie("_fbc") || (FB_COOKIE.test(data.fbc || "") ? data.fbc : "");
    var fbp = cookie("_fbp");
    if (fbc) out.fbc = fbc;
    if (fbp) out.fbp = fbp;
    return out;
  }

  // /roadmap only. Step 1 (name, email) is saved when the email is real, even
  // if they never press Pay. The phone (asked on step 3 since buy box v2,
  // 2026-10-02; on step 1 before that) is merged into the same save when it is
  // typed. No other step-3 box is ever read here. Meta's InitiateCheckout is
  // sent by public/funnel/fh-events.js (card step shown), not from here.
  // The checkout and soft-pull posts the page makes get fbc / fbp added (and
  // the checkout its a1 / a2 and fbclid); nothing in either body is read.
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (url, opt) {
      var next = opt;
      try {
        var u = typeof url === "string" ? url : "";
        var checkout = u.indexOf("slo-checkout") !== -1;
        var pull = u.indexOf("slo-pull") !== -1;
        if (next && typeof next.body === "string" && (checkout || pull)) {
          var parsed = JSON.parse(next.body);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            var stored = read();
            if (checkout) {
              parsed.webdriver = navigator.webdriver === true;
              if (stored.a1 && !parsed.a1) parsed.a1 = stored.a1;
              if (stored.a2 && !parsed.a2) parsed.a2 = stored.a2;
              if (CLICK_ID.test(stored.fbclid || "") && !parsed.fbclid) parsed.fbclid = stored.fbclid;
            }
            var ids = metaIds();
            if (ids.fbc && !parsed.fbc) parsed.fbc = ids.fbc;
            if (ids.fbp && !parsed.fbp) parsed.fbp = ids.fbp;
            next = {};
            for (var k in opt) next[k] = opt[k];
            next.body = JSON.stringify(parsed);
          }
        }
      } catch (e) {}
      return next === opt ? nativeFetch.apply(this, arguments) : nativeFetch.call(this, url, next);
    };
  }

  function widget() { return document.getElementById("fhw"); }
  function step1() {
    var w = widget();
    return w ? w.querySelector("form.s1") : null;
  }
  /* The phone box: step 3 on buy box v2, step 1 on the older page. Only this
     one box is read off step 3 — never the soft pull fields around it. */
  function phoneBoxes() {
    var w = widget();
    var out = [];
    var s3 = w ? w.querySelector("form.s3") : null;
    var s1 = step1();
    var a = s3 ? s3.querySelector('[name="phone"]') : null;
    var b = s1 ? s1.querySelector('[name="phone"]') : null;
    if (a) out.push(a);
    if (b) out.push(b);
    return out;
  }
  /* A box whose typing can change what the contact save holds. */
  function contactBox(node) {
    var form = step1();
    if (form && form.contains(node)) return true;
    return phoneBoxes().indexOf(node) !== -1;
  }
  function field(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? String(el.value || "").trim() : "";
  }
  /* Same check as CONTACT_EMAIL in api/public/slo-interest.mjs. */
  function emailOk(v) {
    return v.length <= 160 && /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(v);
  }
  function sid() {
    var s = "";
    try { s = sessionStorage.getItem("fh_sid") || ""; } catch (e) {}
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) {
      s = (Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
      try { sessionStorage.setItem("fh_sid", s); } catch (e2) {}
    }
    return s;
  }
  function postInterest(kind, extra, beacon) {
    if (typeof nativeFetch !== "function") return;
    var body = { kind: kind, session_id: sid(), webdriver: navigator.webdriver === true };
    var data = read();
    KEYS.concat(EXTRA).forEach(function (k) { if (data[k]) body[k] = data[k]; });
    if (CLICK_ID.test(data.fbclid || "")) body.fbclid = data.fbclid;
    var ids = metaIds();
    if (ids.fbc) body.fbc = ids.fbc;
    if (ids.fbp) body.fbp = ids.fbp;
    if (extra) Object.keys(extra).forEach(function (k) { if (extra[k]) body[k] = extra[k]; });
    var payload = JSON.stringify(body);
    var url = "https://fundhub.ai/api/public/slo-interest";
    if (beacon && navigator.sendBeacon) {
      try { navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" })); return; } catch (e) {}
    }
    try {
      nativeFetch.call(window, url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: payload,
        keepalive: true
      }).catch(function () {});
    } catch (e3) {}
  }
  function phone10(v) {
    var d = String(v || "").replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.length === 10 ? d : "";
  }
  /* Short fingerprint of what was last posted, so the phone and name are not
     kept in storage as typed. */
  function sig(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }
  function sendContact(beacon) {
    var form = step1();
    if (!form) return;
    var email = field(form, "email").toLowerCase();
    if (!emailOk(email)) return;
    // Save on a valid email alone. A phone (only once all 10 digits are in)
    // or a name typed later posts again and merges into the same day's row
    // and the same ClickFunnels contact on the server.
    // Digits only — server turns this into +1XXXXXXXXXX.
    var phone = "";
    var boxes = phoneBoxes();
    for (var i = 0; i < boxes.length && !phone; i++) phone = phone10(boxes[i].value);
    var first = field(form, "c_first");
    var last = field(form, "c_last");
    var now = sig([email, phone, first, last].join("|"));
    var sent = "";
    try { sent = sessionStorage.getItem("fh_contact_sig") || ""; } catch (e) {}
    if (sent === now) return;
    try { sessionStorage.setItem("fh_contact_sig", now); } catch (e2) {}
    postInterest("contact", {
      email: email,
      first_name: first,
      last_name: last,
      phone: phone
    }, beacon);
  }
  function stillTypingEmail() {
    var form = step1();
    var box = form ? form.querySelector('[name="email"]') : null;
    return !!box && document.activeElement === box;
  }
  function postRaw(body, beacon) {
    if (typeof nativeFetch !== "function" && !(beacon && navigator.sendBeacon)) return;
    var payload = JSON.stringify(body);
    var url = "https://fundhub.ai/api/public/slo-interest";
    if (beacon && navigator.sendBeacon) {
      try { navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" })); return; } catch (e) {}
    }
    if (typeof nativeFetch !== "function") return;
    try {
      nativeFetch.call(window, url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: payload,
        keepalive: true
      }).catch(function () {});
    } catch (e3) {}
  }
  if (widget()) {
    try {
      if (!sessionStorage.getItem("fh_visit_sent")) {
        sessionStorage.setItem("fh_visit_sent", "1");
        postInterest("visit", {}, false);
      }
    } catch (e) {}
    var contactTimer = null;
    document.addEventListener("input", function (ev) {
      if (!contactBox(ev.target)) return;
      clearTimeout(contactTimer);
      contactTimer = setTimeout(function () {
        // Still in the email box: wait until they leave it (change below), so
        // a half-typed "pat@gmail.co" is never saved as a contact.
        if (stillTypingEmail()) return;
        sendContact(false);
      }, 1500);
    });
    document.addEventListener("change", function (ev) {
      if (contactBox(ev.target)) sendContact(false);
    });
    document.addEventListener("submit", function (ev) {
      var w = widget();
      var form = step1();
      var s3 = w ? w.querySelector("form.s3") : null;
      if ((form && ev.target === form) || (s3 && ev.target === s3)) sendContact(false);
    }, true);

    /* Time on /roadmap + whether #fhw entered the viewport. One engage row
       per session on the server (upsert). Heartbeat while the tab is visible
       so a killed tab still left a number; pagehide sends the last reading. */
    var activeMs = 0;
    var lastVisibleAt = document.visibilityState === "hidden" ? 0 : Date.now();
    var reachedForm = false;
    var engagePulse = null;
    function tabVisible() { return document.visibilityState !== "hidden"; }
    function settleClock() {
      if (lastVisibleAt) {
        activeMs += Date.now() - lastVisibleAt;
        lastVisibleAt = 0;
      }
    }
    function resumeClock() {
      if (tabVisible() && !lastVisibleAt) lastVisibleAt = Date.now();
    }
    function secondsOnPage() {
      var total = activeMs;
      if (lastVisibleAt) total += Date.now() - lastVisibleAt;
      return Math.floor(total / 1000);
    }
    function sendEngage(beacon) {
      var body = {
        kind: "engage",
        session_id: sid(),
        webdriver: navigator.webdriver === true,
        seconds_on_page: secondsOnPage(),
        reached_form: reachedForm === true
      };
      var data = read();
      KEYS.concat(EXTRA).forEach(function (k) { if (data[k]) body[k] = data[k]; });
      postRaw(body, beacon);
    }
    function startEngagePulse() {
      if (engagePulse) return;
      engagePulse = setInterval(function () {
        if (tabVisible()) sendEngage(false);
      }, 30000);
    }
    function stopEngagePulse() {
      if (!engagePulse) return;
      clearInterval(engagePulse);
      engagePulse = null;
    }
    if (typeof IntersectionObserver === "function") {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            reachedForm = true;
            try { io.disconnect(); } catch (e4) {}
            break;
          }
        }
      }, { threshold: 0.05 });
      try { io.observe(widget()); } catch (e5) {}
    } else {
      reachedForm = true;
    }
    document.addEventListener("visibilitychange", function () {
      if (tabVisible()) {
        resumeClock();
        startEngagePulse();
      } else {
        settleClock();
        stopEngagePulse();
        sendEngage(true);
      }
    });
    if (tabVisible()) startEngagePulse();
    window.addEventListener("pagehide", function () {
      settleClock();
      sendContact(true);
      sendEngage(true);
    });
  }

  /* Other job owns the pixel file. Load it when present; ignore a 404. */
  try {
    var rb = document.createElement("script");
    rb.src = "https://fundhub.ai/funnel/rb2b.js";
    rb.async = true;
    rb.onerror = function () {};
    (document.head || document.documentElement).appendChild(rb);
  } catch (e6) {}
})();
