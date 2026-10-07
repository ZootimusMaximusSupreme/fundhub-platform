/* Your applications — the client's bank applications and decline defense
 * (/app/money-declines.html, Capital Blueprint launch unit B1).
 *
 * Owner, 2026-10-06: "If they get declined, they copy the decline into the
 * agent; it works out what the reason could be, then finds the reconsideration
 * steps an agent can take as a process." So the one job here: paste the bank's
 * letter, see the likely reasons and the plan, and follow it.
 *
 * Reads GET /api/blueprint/declines (body.view) and sends one thing,
 * POST /api/blueprint/declines { action: "paste" }. Every reason, quote and step
 * is a field from the server; nothing here invents one.
 *
 * THE HONESTY RULES
 *   - "Your letter says" quotes the client's own letter, exactly as the server
 *     sent it back.
 *   - A part of the letter nobody could match says so: a person will read it.
 *   - Status is a word and a shape, never colour alone (UI-STANDARDS §12.6).
 *   - No sources, no lender book, no ops scripts reach this page — the server
 *     never sends them to a client view.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-declines-screen.test.mjs can run them in Node. mount() and
 * initPage() are the only parts that need a browser. This file is the section
 * window.FinanceOS.sections.declines; money-declines.html is a thin shell.
 * Styles: money-declines.css, every rule under .fh-declines.
 */
(function (root) {
  "use strict";

  var API = "/api/blueprint/declines";
  var MAX_CHARS = 20000;
  var MIN_CHARS = 20;
  var OTHER = "__other";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }

  /* "2026-10-02" → "Oct 2, 2026", read off the calendar date. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  /* A step's status: a mark and a word. */
  function stepState(status) {
    if (status === "done") return { mark: "✓", word: "Done", cls: "is-done" };
    if (status === "skipped") return { mark: "–", word: "Skipped", cls: "is-skip" };
    return { mark: "○", word: "Not done yet", cls: "is-open" };
  }

  /* A decline's status: a mark beside the server's own words. */
  function outcomeMark(outcome) {
    if (outcome === "approved_on_recon") return { mark: "✓", cls: "is-yes" };
    if (outcome === "still_declined") return { mark: "✗", cls: "is-no" };
    if (outcome === "reapply_later") return { mark: "↻", cls: "is-later" };
    return { mark: "…", cls: "is-working" };
  }

  function what(bank, product) {
    return [bank, product].filter(function (x) { return x; }).join(" · ") || "A bank";
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderHead() {
    return '<div class="dc-head"><div><h1>Your applications</h1>' +
      '<p class="caption">When a bank says no, paste its letter here. We read it, show the likely reasons, and start the plan to ask the bank to look again.</p></div></div>';
  }

  function renderSteps(steps) {
    return '<ul class="dc-steps">' + list(steps).map(function (s) {
      var st = stepState(s.status);
      return '<li class="dc-step ' + st.cls + '"><span class="dc-mark" aria-hidden="true">' + st.mark + '</span>' +
        '<span class="dc-step-text">' + esc(s.text) + '</span><span class="dc-word">' + st.word + '</span></li>';
    }).join("") + '</ul>';
  }

  function renderReasons(reasons) {
    if (!list(reasons).length) return "";
    return '<span class="eyebrow">Why we think they said no</span><ul class="dc-reasons">' + list(reasons).map(function (r) {
      return '<li class="dc-reason"><span class="dc-reason-label">' + esc(r.label) + '</span>' +
        '<span>' + esc(r.words) + '</span>' +
        (r.quote ? '<span class="dc-quote">Your letter says: “' + esc(r.quote) + '”</span>' : "") + '</li>';
    }).join("") + '</ul>';
  }

  function renderPerson(d) {
    if (!d.needs_person) return "";
    var parts = list(d.unknown_parts);
    return '<div class="dc-person"><span class="dc-reason-label">A Fundhub person will read this</span>' +
      '<span>' + esc(d.needs_person_why || "Part of the letter needs a person.") + '</span>' +
      (parts.length ? '<ul class="dc-parts">' + parts.map(function (p) { return '<li>“' + esc(p) + '”</li>'; }).join("") + '</ul>' : "") +
      '</div>';
  }

  function renderWhen(d) {
    var lines = list(d.when).slice();
    if (d.call_on) lines.unshift("We plan to call the bank on " + day(d.call_on) + ".");
    if (d.reapply_on) lines.unshift("We plan to apply at this bank again on " + day(d.reapply_on) + ".");
    if (!lines.length) return "";
    return '<span class="eyebrow">When</span><ul class="dc-when">' + lines.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>';
  }

  function renderDecline(d) {
    var om = outcomeMark(d.outcome);
    var when = d.declined_on ? "Declined " + day(d.declined_on)
      : (d.received_on ? "Letter sent to us " + day(d.received_on) : "Decline date not given");
    var ours = list(d.fundhub_steps);
    return '<article class="card dc-decline" data-decline="' + esc(d.id) + '">' +
      '<div class="dc-dhead"><div class="dc-dname"><h3>' + esc(what(d.bank, d.product)) + '</h3><span class="caption">' + esc(when) + '</span></div>' +
      '<span class="dc-status ' + om.cls + '"><span class="dc-mark" aria-hidden="true">' + om.mark + '</span>' + esc(d.status_words) + '</span></div>' +
      renderReasons(d.reasons) +
      renderPerson(d) +
      (list(d.your_steps).length ? '<span class="eyebrow">Your steps</span>' + renderSteps(d.your_steps) : "") +
      (ours.length ? '<details class="dc-ours"><summary>Fundhub\'s steps — ' + esc(d.fundhub_done) + " of " + esc(d.fundhub_total) + ' done</summary>' + renderSteps(ours) + '</details>' : "") +
      renderWhen(d) +
      '</article>';
  }

  function renderPaste(v, flash) {
    if (!v.can_paste) {
      return '<section class="card dc-paste dc-locked"><h2>Decline help comes with the Capital Blueprint</h2>' +
        '<p>When a bank says no, Capital Blueprint clients paste the letter here and Fundhub works on getting a second look. Ask your advisor about it.</p></section>';
    }
    var opts = list(v.applications).filter(function (a) { return !a.decline_id; }).map(function (a) {
      return '<option value="' + esc(a.id) + '">' + esc(what(a.bank, a.product)) + '</option>';
    }).join("");
    return '<section class="card dc-paste" id="dc-paste"><h2>Got a no from a bank?</h2>' +
      (flash ? '<p class="dc-flash" role="status">' + esc(flash) + '</p>' : "") +
      '<label class="dc-label" for="dc-bank">Which bank sent it?</label>' +
      '<select id="dc-bank" class="dc-field" data-field="bank">' +
      '<option value="">Pick the bank</option>' + opts + '<option value="' + OTHER + '">Another bank</option></select>' +
      '<div class="dc-other" data-slot="other" hidden><label class="dc-label" for="dc-bank-name">Bank name</label>' +
      '<input id="dc-bank-name" class="dc-field" type="text" maxlength="120" autocomplete="off" data-field="bank-name"></div>' +
      '<label class="dc-label" for="dc-text">Paste the bank\'s letter or email</label>' +
      '<textarea id="dc-text" class="dc-field dc-text" rows="8" maxlength="' + MAX_CHARS + '" data-field="text"></textarea>' +
      '<p class="caption">We hide long numbers, like a Social Security number, before we save it.</p>' +
      '<button class="dc-btn-primary" type="button" data-act="paste">Read my decline</button>' +
      '<div class="dc-result" data-slot="result" aria-live="polite"></div></section>';
  }

  function renderApplications(v) {
    var apps = list(v.applications);
    var body = apps.length
      ? '<ul class="dc-apps">' + apps.map(function (a) {
        return '<li class="dc-app"><span class="dc-app-name">' + esc(what(a.bank, a.product)) + '</span>' +
          '<span class="dc-app-status">' + esc(a.decline_words || a.status_words) + '</span></li>';
      }).join("") + '</ul>'
      : '<p class="caption">No bank applications on your file yet. When Fundhub applies for you, each one shows up here.</p>';
    return '<section class="dc-block"><h2>Your bank applications</h2>' + body + '</section>';
  }

  /* ── the four states ───────────────────────────────────────────────────── */

  function isEmpty(v) { return !list(v && v.applications).length && !list(v && v.declines).length; }

  /* After a paste the page scrolls to the declines, so the answer ("we read
     your letter") sits there, where the client is looking (UI-STANDARDS §5). */
  function renderFull(v, flash) {
    var declines = list(v.declines);
    var note = flash && declines.length ? '<p class="dc-flash" role="status">' + esc(flash) + '</p>' : "";
    return renderHead() +
      (declines.length ? '<section class="dc-block" id="dc-declines"><h2>Declines we are working on</h2>' + note +
        '<div class="dc-list">' + declines.map(renderDecline).join("") + '</div></section>' : "") +
      renderPaste(v, declines.length ? "" : flash) +
      renderApplications(v);
  }

  function renderEmpty(v, flash) {
    return renderHead() + renderPaste(v, flash) +
      '<section class="dc-block"><h2>Your bank applications</h2><p class="caption">No bank applications on your file yet. When Fundhub applies for you, each one shows up here. If a bank already said no, paste its letter above.</p></section>';
  }

  function renderLoading() {
    var card = '<div class="card dc-skel"><span class="dc-sk dc-sk-s"></span><span class="dc-sk dc-sk-l"></span><span class="dc-sk dc-sk-m"></span></div>';
    return '<div class="dc-head"><div><h1>Your applications</h1><p class="caption">Loading your applications…</p></div></div>' +
      '<div class="dc-list" aria-busy="true">' + card + card + '</div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your applications. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose applications to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(kind) {
    return '<div class="dc-head"><div><h1>Your applications</h1></div></div>' +
      '<section class="card dc-error" role="alert"><h2>We could not load your applications</h2>' +
      '<p>' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' +
      '<button class="dc-btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function render(v, flash) { return isEmpty(v) ? renderEmpty(v, flash) : renderFull(v, flash); }

  /* What the paste answer says, in words. */
  var PASTE_WORDS = {
    letter_required: "Paste the whole letter or email from the bank.",
    letter_too_long: "That is longer than a bank letter. Paste just the letter or email from the bank.",
    bank_required: "Tell us which bank sent it.",
    not_blueprint_buyer: "Decline help is part of the Capital Blueprint.",
    too_many_pastes: "You sent a lot of letters today. A Fundhub person will read them. Send more tomorrow.",
    application_not_found: "We could not find that application. Pick the bank again.",
    application_approved: "That application shows as approved. Pick another bank."
  };
  function pasteProblem(res) {
    var b = res.body || {};
    if (res.status === 0) return ERROR_WORDS.offline;
    if (res.status === 503 || b.db === "down") return ERROR_WORDS.nodb;
    return PASTE_WORDS[b.error] || b.message || "That did not work. Try again in a moment.";
  }
  function pasteFlash(res) {
    var b = res.body || {};
    var bank = b.decline && b.decline.bank ? b.decline.bank : "the bank";
    if (b.duplicate) return "We already have this letter. Your plan is below.";
    return "We read your letter from " + bank + ". The likely reasons and your plan are below.";
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  function call(method, path, body) {
    var headers = { accept: "application/json" };
    var t = token();
    if (t) headers.authorization = "Bearer " + t;
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var started;
    try { started = root.fetch(path, init); } catch (e) { return Promise.resolve({ status: 0, body: null }); }
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; },
        function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }

  function classify(res) {
    var s = res.status, b = res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (s === 0) return "offline";
    if (s === 404) return (b && b.error === "not_found" && typeof b.path === "string") ? "offline" : "notfound";
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "badrequest";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true || !b.view) return "server";
    return "ok";
  }

  function signInUrl() {
    var role = "";
    try { role = root.localStorage.getItem("fh_role") || ""; } catch (e) {}
    var staffish = (role && role !== "client") || !!param("client_id");
    return staffish
      ? "/login.html?next=" + encodeURIComponent(root.location.pathname + root.location.search)
      : "/portal-login.html";
  }

  function withClient(href, cid) {
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /* ── the section: window.FinanceOS.sections.declines ─────────────────────
     mount(el, ctx) paints this section into `el` and wires the paste box. No
     page chrome. ctx = { clientId, apiGet, apiPost } — apiGet/apiPost resolve
     to { status, body }; missing ones fall back to this file's own fetch. A
     client session leaves clientId empty (the server pins a client to their
     own file); staff pass the client's id. Returns { reload, unmount }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var get = typeof ctx.apiGet === "function" ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = typeof ctx.apiPost === "function" ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var view = null;
    var flash = "";

    function paint(html) { el.innerHTML = '<div class="fh-declines">' + html + '</div>'; }
    function q(sel) { return el.querySelector ? el.querySelector(sel) : null; }

    function load() {
      if (!view) paint(renderLoading());
      return get(API + (cid ? "?client_id=" + encodeURIComponent(cid) : "")).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") {
          if (typeof ctx.onSignIn === "function") ctx.onSignIn();
          else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (kind !== "ok") { view = null; paint(renderError(kind)); return; }
        view = res.body.view;
        paint(render(view, flash));
        flash = "";
      });
    }

    function paste(btn) {
      var result = q('[data-slot="result"]');
      function say(text) { if (result) result.innerHTML = text ? '<p class="dc-problem" role="alert">' + esc(text) + '</p>' : ""; }
      var pick = q('[data-field="bank"]');
      var nameBox = q('[data-field="bank-name"]');
      var textBox = q('[data-field="text"]');
      var text = textBox ? String(textBox.value || "") : "";
      var choice = pick ? String(pick.value || "") : "";
      var body = { action: "paste", text: text };
      if (cid) body.client_id = cid;
      if (choice === OTHER) {
        var name = nameBox ? String(nameBox.value || "").trim() : "";
        if (!name) { say(PASTE_WORDS.bank_required); if (nameBox && nameBox.focus) nameBox.focus(); return; }
        body.bank = name;
      } else if (choice) {
        body.application_id = choice;
      } else {
        say("Pick the bank that sent the letter.");
        if (pick && pick.focus) pick.focus();
        return;
      }
      if (text.replace(/\s+/g, "").length < MIN_CHARS) { say(PASTE_WORDS.letter_required); if (textBox && textBox.focus) textBox.focus(); return; }
      if (text.length > MAX_CHARS) { say(PASTE_WORDS.letter_too_long); return; }
      btn.disabled = true;
      btn.textContent = "Reading…";
      say("");
      send(API, body).then(function (res) {
        if (res.status === 401) {
          if (typeof ctx.onSignIn === "function") ctx.onSignIn(); else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (res.body && res.body.ok === true) {
          flash = pasteFlash(res);
          load().then(function () {
            var target = q("#dc-declines") || (res.body.decline && res.body.decline.id ? q('[data-decline="' + res.body.decline.id + '"]') : null);
            if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          return;
        }
        btn.disabled = false;
        btn.textContent = "Read my decline";
        say(pasteProblem(res));
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      var act = t.getAttribute("data-act");
      if (act === "retry") load();
      else if (act === "paste" && !t.disabled) paste(t);
    }
    function onChange(e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute("data-field") !== "bank") return;
      var other = q('[data-slot="other"]');
      if (other) other.hidden = t.value !== OTHER;
    }

    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    load();
    return {
      reload: load,
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("change", onChange);
        el.innerHTML = "";
      }
    };
  }

  /* ── the standalone page (/app/money-declines.html) — a thin shell ───── */
  function initPage() {
    var el = root.document.getElementById("declines-root");
    if (!el) return;
    var cid = param("client_id");
    var links = root.document.querySelectorAll(".mnav a");
    for (var i = 0; i < links.length; i++) links[i].setAttribute("href", withClient(links[i].getAttribute("href"), cid));
    var nav = root.document.querySelector(".mnav");
    var cur = nav && nav.querySelector('[aria-current="page"]');
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - nav.offsetLeft - 16);
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.declines = { title: "Applications", mount: mount };

  root.FHMoneyDeclines = {
    day: day, stepState: stepState, outcomeMark: outcomeMark, isEmpty: isEmpty,
    render: render, renderFull: renderFull, renderEmpty: renderEmpty, renderError: renderError,
    renderLoading: renderLoading, renderDecline: renderDecline, renderPaste: renderPaste,
    classify: classify, pasteProblem: pasteProblem, pasteFlash: pasteFlash, withClient: withClient, mount: mount
  };

  /* Auto-start only finds #declines-root on the standalone page. The combined
     FinanceOS page calls FinanceOS.sections.declines.mount(). */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
