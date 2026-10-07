/* Money helper — the FinanceOS chat (/app/money-helper.html,
 * window.FinanceOS.sections.helper).
 *
 * Owner (2026-10-06): "AI tells you exactly what to do; press Do task to assign
 * actions to AI agents." "Really set up the AI agent… so we can role-play and
 * see it work." This section paints ONE read, GET /api/money/helper: the
 * thread (each message, the helper's answer, what it did, and which brain
 * answered), and sends a message with POST { action: "send" }.
 *
 * THE HONESTY RULES:
 *   - The words in a bubble are the stored answer. The cards under it are the
 *     stored results of what the helper DID — written by the server from the
 *     checked action, never by the model. A transfer card always says
 *     "Needs your approval": the helper only proposes; nothing moves.
 *   - Which brain answered is printed under every answer, in words: "AI" (the
 *     model, through Fundhub's shared client) or "Rules" (no model could be
 *     reached, or the model's answer broke a rule), with the reason.
 *   - "Thinking…" shows while a turn waits for the Mac runner, and polls the
 *     read every 3 seconds until it is answered.
 *   - Status is words and shape, never colour alone (UI-STANDARDS §12.6).
 *   - The helper is shadow: it never texts. The page says so.
 *
 * At 760px and under everything is one column; the page never scrolls
 * sideways (UI-STANDARDS §11). Styles: money-helper.css, all under .fh-helper.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-helper-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/helper";
  var POLL_MS = 3000;
  var MAX_POLLS = 100;
  var MAX_CHARS = 2000;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SUGGESTIONS = ["What is due this week?", "Which card should I pay first?", "Set a reminder for my next payment"];

  var ACT_WORD = {
    create_reminder: "Reminder set",
    schedule_pin: "Added to your plan",
    create_csm_task: "A person will reach out",
    mark_task_in_progress: "Marked in progress",
    propose_transfer: "Transfer proposal",
    halt: "Helper stopped"
  };
  var ICON = {
    create_reminder: '<path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.5L3 11h10l-1.5-2.5V6A3.5 3.5 0 0 0 8 2.5zM6.5 13a1.5 1.5 0 0 0 3 0"/>',
    schedule_pin: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1.5v3M11 1.5v3"/>',
    create_csm_task: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
    mark_task_in_progress: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    propose_transfer: '<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/>',
    halt: '<circle cx="8" cy="8" r="6"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>'
  };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  function money(cents) {
    if (!isNum(cents)) return null;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (cents < 0 ? "−$" : "$") + dollars + "." + c;
  }

  function icon(name) {
    var body = ICON[name] || '<circle cx="8" cy="8" r="4.5"/>';
    return '<span class="ic" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + body + '</svg></span>';
  }

  /* Relative under 24 hours, a date after (UI-STANDARDS §7). The exact time is
     the tooltip. `now` is passed so the tests are not clock-bound. */
  function relTime(iso, now) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var n = isNum(now) ? now : Date.now();
    var s = Math.max(0, Math.round((n - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    var d = new Date(t);
    var h = d.getHours();
    var m = ("0" + d.getMinutes()).slice(-2);
    return MON[d.getMonth()] + " " + d.getDate() + ", " + ((h % 12) || 12) + ":" + m + (h < 12 ? " AM" : " PM");
  }
  function exact(iso) {
    var t = Date.parse(iso || "");
    return isFinite(t) ? new Date(t).toString() : "";
  }

  function pending(t) { return t && (t.status === "queued" || t.status === "running"); }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderHead() {
    return '<div class="head"><div><h1>Money helper</h1><p class="caption">' +
      'Ask about your bills, cards and plan. It can set reminders and add steps to your plan. It never moves your money.</p></div></div>';
  }

  /* What the helper is right now, in words: texts off (shadow), which brain,
     and — when the AI runs on Fundhub's computer — whether that is on. */
  function renderStatus(d) {
    var h = (d && d.helper) || {};
    var tags = ['<span class="tag">Texts off: answers show here only</span>'];
    if (h.brain === "rules") tags.push('<span class="tag">Rules helper only</span>');
    else if (h.brain === "server") tags.push('<span class="tag">AI on</span>');
    else tags.push(h.bridge_on ? '<span class="tag">AI on</span>' : '<span class="tag">AI off right now: the rules helper answers</span>');
    return '<div class="status" aria-label="Helper status">' + tags.join("") + '</div>';
  }

  /* One thing the helper did. The label and amounts are the server's. */
  function renderAction(a) {
    if (!a || !a.type || a.type === "no_action") return "";
    var word = ACT_WORD[a.type] || "Done";
    var sub = a.label || "";
    var pill = "";
    if (a.type === "propose_transfer") {
      pill = '<span class="pill pill-approve">Needs your approval</span>';
      sub = money(a.amount_cents) && a.from_name && a.to_name
        ? money(a.amount_cents) + " from " + a.from_name + " to " + a.to_name + ". Nothing moves until you approve it."
        : "Nothing moves until you approve it.";
    } else if (a.status === "skipped") {
      pill = '<span class="pill">Already done</span>';
    } else if (a.status === "failed") {
      pill = '<span class="pill pill-warn">Not done</span>';
    } else if (a.status === "would_do") {
      pill = '<span class="pill">Practice run</span>';
    }
    return '<li class="act act-' + esc(a.type) + '">' + icon(a.type) +
      '<span class="act-main"><span class="act-t">' + esc(word) + '</span>' +
      (sub ? '<span class="caption">' + esc(sub) + '</span>' : "") + '</span>' + pill + '</li>';
  }

  function brainWords(t) {
    if (t.brain === "ai") return "AI";
    if (t.brain === "rules") return "Rules";
    return "";
  }

  /* One turn: the person's message, then the helper's answer (or Thinking…). */
  function renderTurn(t, now) {
    var who = t.actor === "staff" ? "Fundhub staff" : "You";
    var ask = t.kind === "task"
      ? '<span class="eyebrow">Do task</span>' + esc(String(t.input || "").replace(/^Do task:\s*/, ""))
      : esc(t.input);
    var mine = '<li class="msg from-client"><div class="bubble">' + ask + '</div>' +
      '<p class="caption meta"><span>' + esc(who) + '</span> · <time datetime="' + esc(t.created_at) + '" title="' + esc(exact(t.created_at)) + '">' +
      esc(relTime(t.created_at, now)) + '</time></p></li>';

    var theirs;
    if (pending(t)) {
      theirs = '<li class="msg from-helper is-thinking" aria-busy="true"><div class="bubble">' +
        '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> Thinking…</div>' +
        '<p class="caption meta">Money helper · waiting for the AI</p></li>';
    } else if (t.status === "failed") {
      theirs = '<li class="msg from-helper is-failed"><div class="bubble">The helper could not answer this one. Try asking again.</div>' +
        '<p class="caption meta">Money helper · not answered</p></li>';
    } else {
      var acts = list(t.actions).map(renderAction).join("");
      var why = t.brain === "rules" && t.reason_words ? ' · <span class="why">' + esc(t.reason_words) + '</span>' : "";
      theirs = '<li class="msg from-helper' + (t.status === "halted" ? " is-halted" : "") + '">' +
        '<div class="bubble">' + esc(t.reply) + '</div>' +
        (acts ? '<ul class="acts" aria-label="What the helper did">' + acts + '</ul>' : "") +
        '<p class="caption meta"><span>Money helper</span> · <span class="brain brain-' + esc(t.brain || "none") + '">' + esc(brainWords(t)) + '</span>' + why +
        (t.answered_at ? ' · <time datetime="' + esc(t.answered_at) + '" title="' + esc(exact(t.answered_at)) + '">' + esc(relTime(t.answered_at, now)) + '</time>' : "") +
        '</p></li>';
    }
    return mine + theirs;
  }

  function renderEmptyThread() {
    return '<div class="empty"><h2>Ask your money helper anything about your money</h2>' +
      '<p>It reads your accounts, cards, bills and plan, and answers with your real numbers. It can set a reminder, add a step to your plan, or get you a person.</p>' +
      '<div class="suggest">' + SUGGESTIONS.map(function (s) {
        return '<button type="button" class="btn" data-act="suggest" data-text="' + esc(s) + '">' + esc(s) + '</button>';
      }).join("") + '</div></div>';
  }

  function renderBanner(d) {
    var h = (d && d.helper) || {};
    if (h.halted) {
      return '<div class="banner" role="status"><strong>The money helper stopped here.</strong> ' +
        (h.halt_reason === "stop" ? "You asked it to stop, so it will not text you. " : "") +
        'A person from Fundhub will follow up.</div>';
    }
    if (h.on === false) return '<div class="banner" role="status"><strong>The money helper is not switched on.</strong> Your advisor can turn it on.</div>';
    return "";
  }

  function canSend(d) {
    var h = (d && d.helper) || {};
    return h.on !== false && !h.halted;
  }

  function renderComposer(opts) {
    var o = opts || {};
    var busy = !!o.sending;
    return '<form class="composer" data-act="send-form" novalidate>' +
      '<label class="sr-only" for="mh-input">Message to your money helper</label>' +
      '<textarea id="mh-input" name="message" rows="2" maxlength="' + MAX_CHARS + '" placeholder="Ask about your money"' + (busy ? " disabled" : "") + '>' +
      esc(o.draft || "") + '</textarea>' +
      '<button type="submit" class="btn-primary"' + (busy ? " disabled" : "") + '>' + (busy ? "Sending…" : "Send") + '</button>' +
      '<p class="send-msg caption" role="status" aria-live="polite">' + esc(o.message || "") + '</p>' +
      '</form>';
  }

  /* The whole section for one answer. */
  function render(d, opts) {
    var o = opts || {};
    var turns = list(d && d.turns);
    var now = isNum(o.now) ? o.now : Date.now();
    var stuck = o.stuck ? '<p class="stuck caption" role="status">Still thinking. <button type="button" class="btn-text" data-act="refresh">Check again</button></p>' : "";
    var thread = turns.length
      ? '<ol class="msgs">' + turns.map(function (t) { return renderTurn(t, now); }).join("") + '</ol>' + stuck
      : renderEmptyThread();
    return renderHead() + renderStatus(d) + renderBanner(d) +
      '<section class="card thread" aria-label="Chat with your money helper" aria-live="polite">' + thread + '</section>' +
      (canSend(d) ? renderComposer(o) : "");
  }

  function renderLoading() {
    var b = function (side, size) { return '<li class="msg from-' + side + '"><div class="bubble skel"><span class="sk sk-' + size + '"></span></div></li>'; };
    return renderHead() +
      '<div class="status"><span class="sk sk-s"></span></div>' +
      '<section class="card thread" aria-busy="true"><ol class="msgs">' +
      b("client", "s") + b("helper", "l") + b("client", "s") + b("helper", "m") +
      '</ol></section>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your money helper. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose money helper to show. Open it from a client's file."
  };

  function renderError(kind) {
    return renderHead() +
      '<section class="card error" role="alert"><h2>We could not load your money helper</h2>' +
      '<p>' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' +
      '<button type="button" class="btn-primary" data-act="retry">Try again</button></section>';
  }

  var SEND_WORDS = {
    message_required: "Type a message first.",
    message_too_long: "That message is too long. Keep it under 2,000 characters.",
    too_many: "That is a lot of messages for one day. Ask again tomorrow, or ask for a person.",
    offline: "Your message did not send. Check your connection and try again.",
    server: "Your message did not send. Try again in a minute."
  };

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
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "server";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true) return "server";
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

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /* ── the section: window.FinanceOS.sections.helper ───────────────────────
     mount(el, ctx) paints this section into `el` and wires its controls. No
     page chrome. ctx = { clientId, apiGet, apiPost, onSignIn }. Missing api
     functions fall back to this file's own fetch. Returns { reload, unmount }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var post = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var setT = root.setTimeout ? root.setTimeout.bind(root) : function () { return 0; };
    var clearT = root.clearTimeout ? root.clearTimeout.bind(root) : function () {};
    var state = { data: null, sending: false, draft: "", message: "", polls: 0, timer: null, stuck: false, loads: 0, gone: false };

    function q(sel) { return el.querySelector ? el.querySelector(sel) : null; }

    function paint(html) {
      var input = q("#mh-input");
      var focused = !!(input && root.document && root.document.activeElement === input);
      el.innerHTML = '<div class="fh-helper">' + html + '</div>';
      var box = q(".thread");
      if (box && "scrollTop" in box) box.scrollTop = box.scrollHeight || 0;
      var again = q("#mh-input");
      if (again && focused && again.focus) again.focus();
    }
    function repaint() {
      if (!state.data) return;
      paint(render(state.data, { sending: state.sending, draft: state.draft, message: state.message, stuck: state.stuck }));
    }

    function schedulePoll() {
      if (state.timer || state.gone) return;
      if (!(state.data && state.data.pending > 0)) { state.polls = 0; state.stuck = false; return; }
      if (state.polls >= MAX_POLLS) { state.stuck = true; repaint(); return; }
      state.timer = setT(function () {
        state.timer = null;
        state.polls += 1;
        load(true);
      }, POLL_MS);
    }

    function load(quiet) {
      var ticket = ++state.loads;
      if (!quiet) paint(renderLoading());
      var path = READ_PATH + (clientId ? "?client_id=" + encodeURIComponent(clientId) : "");
      return get(path).then(function (res) {
        if (ticket !== state.loads || state.gone) return;
        var kind = classify(res);
        if (kind === "signin") {
          if (ctx.onSignIn) ctx.onSignIn(); else if (root.location) root.location.href = signInUrl();
          return;
        }
        if (kind !== "ok") {
          if (quiet && state.data) { schedulePoll(); return; } // a missed poll keeps what is on screen
          state.data = null;
          paint(renderError(kind));
          return;
        }
        state.data = res.body;
        repaint();
        schedulePoll();
      });
    }

    function send(words) {
      var text = String(words == null ? "" : words).trim();
      if (state.sending) return Promise.resolve();
      if (!text) { state.message = SEND_WORDS.message_required; repaint(); return Promise.resolve(); }
      if (text.length > MAX_CHARS) { state.message = SEND_WORDS.message_too_long; repaint(); return Promise.resolve(); }
      state.sending = true;
      state.message = "";
      state.draft = text;
      repaint();
      var body = { action: "send", message: text };
      if (clientId) body.client_id = clientId;
      return post(READ_PATH, body).then(function (res) {
        state.sending = false;
        var ok = res && (res.status === 200 || res.status === 202) && res.body && res.body.ok === true;
        if (ok) {
          state.draft = "";
          state.polls = 0;
          state.stuck = false;
          return load(true);
        }
        var b = (res && res.body) || {};
        if (res && res.status === 401) { if (ctx.onSignIn) ctx.onSignIn(); return; }
        if (b.error === "helper_stopped" || b.error === "helper_off") return load(true);
        state.message = SEND_WORDS[b.error] || b.message || SEND_WORDS[classify(res || { status: 0 }) === "offline" ? "offline" : "server"];
        repaint();
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      var act = t.getAttribute("data-act");
      if (act === "retry") load(false);
      if (act === "refresh") { state.polls = 0; state.stuck = false; load(true); }
      if (act === "suggest") send(t.getAttribute("data-text"));
    }
    function onSubmit(e) {
      if (!e.target || !e.target.getAttribute || e.target.getAttribute("data-act") !== "send-form") return;
      if (e.preventDefault) e.preventDefault();
      var input = q("#mh-input");
      send(input ? input.value : state.draft);
    }
    function onInput(e) {
      if (e.target && e.target.id === "mh-input") state.draft = e.target.value;
    }
    /* Enter sends, Shift+Enter makes a new line — the usual chat keys. */
    function onKey(e) {
      if (!e.target || e.target.id !== "mh-input") return;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        if (e.preventDefault) e.preventDefault();
        send(e.target.value);
      }
    }

    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKey);
    load(false);
    return {
      reload: function () { return load(true); },
      send: send,
      unmount: function () {
        state.gone = true;
        if (state.timer) clearT(state.timer);
        el.removeEventListener("click", onClick);
        el.removeEventListener("submit", onSubmit);
        el.removeEventListener("input", onInput);
        el.removeEventListener("keydown", onKey);
        el.innerHTML = "";
      }
    };
  }

  /* The standalone page: page chrome, then mount the section. */
  function initPage() {
    var el = root.document.getElementById("helper-root");
    if (!el) return;
    var cid = param("client_id");
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    var nav = root.document.getElementById("money-nav");
    if (nav && cid) {
      Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
        var bits = a.getAttribute("href").split("#");
        var href = bits[0] + "?client_id=" + encodeURIComponent(cid);
        a.setAttribute("href", bits.length > 1 ? href + "#" + bits.slice(1).join("#") : href);
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.helper = { title: "Helper", mount: mount, render: render };

  root.FHMoneyHelper = {
    money: money, relTime: relTime, render: render, renderTurn: renderTurn, renderAction: renderAction,
    renderLoading: renderLoading, renderError: renderError, classify: classify, mount: mount,
    POLL_MS: POLL_MS, MAX_POLLS: MAX_POLLS
  };

  /* Auto-start only finds #helper-root on the standalone page. The combined
     FinanceOS page calls FinanceOS.sections.helper.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
