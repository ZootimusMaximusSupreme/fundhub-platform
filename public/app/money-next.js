/* What to do next — FinanceOS's next steps, "Do task", and "Ready to get funded"
 * (/app/money-next.html; FinanceOS wave 5, unit W5).
 *
 * Reads TWO endpoints and paints them. Every figure is a field from them;
 * nothing here invents a number, a step or a date.
 *   GET /api/money/tasks           the client's next steps, who can do each
 *                                  (agent | person | self), and what "Do task"
 *                                  already did (src/finance/money-tasks.mjs)
 *   GET /api/money/ready-to-fund   "Ready to get funded" status + which of the
 *                                  two doors (Capital Blueprint, FinanceOS) the
 *                                  client owns (src/finance/ready-to-fund.mjs)
 * and posts to the same two: { action: "do_task", task_id } and the ready press.
 *
 * THE HONESTY RULES (same as money.js and money-payments.js):
 *   - Money arrives as integer cents. A null paints "—", never $0.00.
 *   - Late is said in words ("Late 4 days"), never by colour alone.
 *   - A payment the money helper sets up is a PROPOSAL. The page says nothing
 *     moves until the client says yes to that exact amount. It never says
 *     money moved.
 *   - A step only the client can do has no "Do task" button.
 *
 * ONE PRIMARY BUTTON: "I'm ready to get funded". "Do task" is an outline
 * button on each row; "Book a call" (the Capital Blueprint card, shown only to
 * a client who does not have it) is an outline link.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-next-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var TASKS_PATH = "/api/money/tasks";
  var READY_PATH = "/api/money/ready-to-fund";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* Who can do a step (can_do on GET /api/money/tasks). */
  var WHO = {
    agent: "Your money helper can set this up",
    person: "A person on our team can do this",
    self: "Only you can do this"
  };
  var SOURCE_WORDS = {
    clarity: "payments to Fundhub", dues: "card and loan due dates", late_cards: "late card payments",
    waypoints: "your checklist", plan: "your plan", underwriteiq: "your funding tip"
  };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  /* "2026-10-21" (or an ISO timestamp) → "Oct 21, 2026", read as a calendar date. */
  function day(iso, noYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (noYear ? "" : ", " + m[1]);
  }

  function withClient(href, clientId) {
    if (!clientId) return href;
    var parts = String(href).split("#");
    var sep = parts[0].indexOf("?") === -1 ? "?" : "&";
    var out = parts[0] + sep + "client_id=" + encodeURIComponent(clientId);
    return parts.length > 1 ? out + "#" + parts.slice(1).join("#") : out;
  }

  function lateBadge(days) {
    return '<span class="late">Late ' + esc(plural(days, "day", "days")) + '</span>';
  }

  /* ── one step ──────────────────────────────────────────────────────────── */

  /* What "Do task" already did, in words. "" when nothing has. */
  function statusWords(t) {
    var a = t && t.assignment;
    if (!a) return "";
    var person = a.assignee === "person";
    switch (a.status) {
      case "needs_approval":
        return "Your money helper set this up: " + money(a.amount_cents) +
          ". Nothing moves until you say yes to this exact amount. You can say yes here once money moving is turned on.";
      case "approved": return "You said yes. Your money helper will send it.";
      case "claimed": return "Your money helper is working on it.";
      case "queued": return person ? "A person on our team has this. They will reach out." : "Your money helper has this.";
      case "done": return person ? "Our team finished this" + (a.done_at ? " on " + day(a.done_at, true) : "") + "." : "Done.";
      case "failed": return "Your money helper could not do this." + (a.message ? " " + a.message : "");
      case "cancelled": return "This was stopped." + (a.message ? " " + a.message : "");
      default: return "";
    }
  }

  /* "Do task" shows for a step someone else can do, unless it is already
     handed over — or it is a payment already finished for this due date. */
  function canPress(t) {
    var a = t && t.assignment;
    if (!t || (t.can_do !== "agent" && t.can_do !== "person")) return false;
    if (a && (a.open || (a.moves_money && a.status === "done"))) return false;
    return true;
  }

  function dueLine(t) {
    if (t.late_days) return lateBadge(t.late_days) + (t.due_on ? ' <span class="caption">Was due ' + esc(day(t.due_on, true)) + '</span>' : "");
    if (t.due_on) return '<span class="caption">Due ' + esc(day(t.due_on, true)) + '</span>';
    return "";
  }

  function renderTask(t, opts) {
    var clientId = opts && opts.clientId;
    var press = canPress(t)
      ? '<button class="btn-line" type="button" data-act="do" data-task="' + esc(t.id) + '">Do task</button>'
      : "";
    var link = t.can_do === "self" && t.link
      ? '<a class="btn-text" href="' + esc(withClient(t.link, clientId)) + '">Open your checklist</a>'
      : "";
    var st = statusWords(t);
    var meta = dueLine(t);
    return '<li class="task' + (t.late_days ? " is-late" : "") + '" data-task-row="' + esc(t.id) + '">' +
      '<div class="t-main">' +
        '<p class="t-title">' + esc(t.title) + '</p>' +
        '<p class="t-meta">' + meta + (t.from ? (meta ? ' <span class="caption">·</span> ' : "") + '<span class="caption">From ' + esc(t.from) + '</span>' : "") + '</p>' +
        (t.why ? '<p class="t-why">' + esc(t.why) + '</p>' : "") +
        '<p class="caption t-who">' + esc(WHO[t.can_do] || "") + '</p>' +
      '</div>' +
      '<div class="t-act">' + press + link +
        (st ? '<p class="t-status caption" role="status">' + esc(st) + '</p>' : "") +
        '<p class="act-msg caption" aria-live="polite"></p>' +
      '</div>' +
    '</li>';
  }

  /* ── the blocks ────────────────────────────────────────────────────────── */

  function renderHead(d) {
    var who = d && d.client && d.client.name ? d.client.name : "";
    return '<div class="head"><div><h1>What to do next</h1><p class="caption">' +
      esc((who ? who + " · " : "") + "Your next steps, from your payments, your checklist and your credit file") +
      '</p></div></div>';
  }

  function isEmpty(d) { return !d || list(d.tasks).length === 0; }

  function renderTasks(d, opts) {
    var items = list(d && d.tasks);
    var failed = list(d && d.sources).filter(function (s) { return s && s.ok === false; });
    var note = failed.length
      ? '<p class="caption warn-note">Some steps could not load just now (' +
        esc(failed.map(function (s) { return SOURCE_WORDS[s.name] || "one part of your file"; }).join(", ")) +
        '). Try again in a few minutes.</p>'
      : "";
    var windowDays = d && isNum(d.window_days) ? d.window_days : 14;
    if (!items.length) {
      return '<section class="card tasks empty" aria-labelledby="nx-tasks"><h2 class="eyebrow" id="nx-tasks">Your next steps</h2>' + note +
        '<p class="empty-t">Nothing to do right now.</p>' +
        '<p>When a payment comes due in the next ' + esc(plural(windowDays, "day", "days")) +
        ', or your checklist has a step, it shows up here.</p>' +
        '<a class="btn-line" href="' + esc(withClient("/app/financeos.html#accounts", opts && opts.clientId)) + '">Check your accounts</a></section>';
    }
    var more = d && isNum(d.more) && d.more > 0
      ? '<p class="caption">' + esc(plural(d.more, "more step comes", "more steps come")) + ' after these.</p>'
      : "";
    return '<section class="card tasks" aria-labelledby="nx-tasks"><h2 class="eyebrow" id="nx-tasks">Your next steps</h2>' + note +
      '<ol class="task-list">' + items.map(function (t) { return renderTask(t, opts); }).join("") + '</ol>' + more +
      '<p class="caption">Your money helper never moves money on its own. A payment it sets up waits for your yes.</p></section>';
  }

  /* "Ready to get funded" — r is the GET/POST ready-to-fund body, or null when
     that read failed. */
  function renderReady(r) {
    var head = '<h2 class="eyebrow" id="nx-ready">Ready to get funded?</h2>';
    if (!r || r.ok !== true) {
      return '<section class="card ready" aria-labelledby="nx-ready">' + head +
        '<p>We could not check your funding request just now.</p>' +
        '<button class="btn-line" type="button" data-act="ready-retry">Try again</button></section>';
    }
    var s = r.status;
    var text;
    var button = '<button class="btn-primary" type="button" data-act="ready">I\'m ready to get funded</button>';
    var tag = "";
    if (s === "requested" || s === "csm_assigned") {
      tag = '<span class="tag">' + (s === "csm_assigned" ? "A person has it" : "Sent to our team") + '</span>';
      text = "You asked on " + day(r.requested_at) + ". " + (s === "csm_assigned"
        ? "A person on our team has your request and will reach out to plan your funding."
        : "Your request is with our team. A person will reach out soon.");
      button = "";
    } else if (s === "done") {
      tag = '<span class="tag">Prep call done</span>';
      text = "Your funding prep call is done" + (r.done_at ? " (" + day(r.done_at) + ")" : "") +
        ". Ready for another round? Ask again any time.";
    } else {
      text = "When your file is ready, press the button. A person on our team will reach out to plan your funding. It is the same closing prep call our Capital Blueprint clients get.";
    }
    return '<section class="card ready" aria-labelledby="nx-ready">' + head + tag + '<p>' + esc(text) + '</p>' + button +
      '<p class="act-msg caption" aria-live="polite"></p></section>';
  }

  /* The Capital Blueprint card — only when the client does not have it, and
     only with the way it is sold today (offers.blueprint.sell: a call). */
  function renderBlueprint(r) {
    var o = r && r.ok === true && r.offers && r.offers.blueprint;
    if (!o || o.owned || !o.sell || !o.sell.url) return "";
    return '<section class="card upsell" aria-labelledby="nx-bp"><h2 class="eyebrow" id="nx-bp">' + esc(o.name || "Capital Blueprint") + '</h2>' +
      '<p class="up-t">Want us to do it with you?</p>' +
      '<p>With the Capital Blueprint, a person on our team works your plan with you and gets your file ready for funding. Pricing is set on your call.</p>' +
      '<a class="btn-line" href="' + esc(o.sell.url) + '" target="_blank" rel="noopener">Book a call</a></section>';
  }

  function renderSide(r) {
    return '<div class="nx-side">' + renderReady(r) + renderBlueprint(r) + '</div>';
  }

  function render(d, r, opts) {
    return renderHead(d) + '<div class="nx-grid"><div class="nx-main">' + renderTasks(d, opts) + '</div>' + renderSide(r) + '</div>';
  }

  function renderLoading() {
    var row = '<div class="skel"><span class="sk sk-m"></span><span class="sk sk-s"></span></div>';
    return '<div class="head"><div><h1>What to do next</h1><p class="caption">Loading your next steps…</p></div></div>' +
      '<div class="nx-grid" aria-busy="true"><div class="nx-main"><div class="card tasks">' + row + row + row + '</div></div>' +
      '<div class="nx-side"><div class="card"><div class="skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div></div></div></div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your next steps. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose steps to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  /* The steps failed to load. The side still shows when its own read worked. */
  function renderError(source, r) {
    return '<div class="head"><div><h1>What to do next</h1></div></div>' +
      '<div class="nx-grid"><div class="nx-main"><section class="card error" role="alert"><h2>We could not load your next steps</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-line" type="button" data-act="retry">Try again</button></section></div>' +
      (r && r.ok === true ? renderSide(r) : "") + '</div>';
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
    var s = res && res.status, b = res && res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (!s) return "offline";
    if (s === 404) return (b && b.error === "not_found" && typeof b.path === "string") ? "offline" : "notfound";
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "badrequest";
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

  /* ── the section: window.FinanceOS.sections.next ─────────────────────────
     mount(el, ctx) paints this section into `el` and wires its buttons. No
     page chrome — no header, no nav. ctx = { clientId, apiGet, apiPost }:
       clientId  staff only (a staff desk passes it; a client session leaves it
                 empty — the server pins a client to their own file)
       apiGet(path) / apiPost(path, body)
                 → Promise of { status, body } (or of the parsed body alone).
     Missing api functions fall back to this file's own fetch. The standalone
     page (/app/money-next.html) is a thin shell that calls mount().
     Section styles: money-next.css, every rule under .fh-next. It leans on the
     same base rules money-payments.css does (.card, .head, .eyebrow, .caption,
     .btn-primary, .tag, skeletons). */

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var opts = { clientId: clientId };
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var state = { d: null, r: null };
    var qs = clientId ? "?client_id=" + encodeURIComponent(clientId) : "";

    function paint(html) { el.innerHTML = '<div class="fh-next">' + html + '</div>'; }
    function repaint() { paint(state.d ? render(state.d, state.r, opts) : renderError("server", state.r)); }
    function leave() { if (root.location) root.location.href = signInUrl(); }

    function load() {
      paint(renderLoading());
      return Promise.all([get(TASKS_PATH + qs), get(READY_PATH + qs)]).then(function (res) {
        var kt = classify(res[0]);
        var kr = classify(res[1]);
        if (kt === "signin" || kr === "signin") { leave(); return; }
        state.r = kr === "ok" ? res[1].body : null;
        if (kt !== "ok") { state.d = null; paint(renderError(kt, state.r)); return; }
        state.d = res[0].body;
        repaint();
      });
    }

    function loadReady() {
      return get(READY_PATH + qs).then(function (res) {
        var k = classify(res);
        if (k === "signin") { leave(); return; }
        state.r = k === "ok" ? res.body : null;
        repaint();
      });
    }

    function rowMsg(btn) {
      var row = btn && btn.closest ? btn.closest("[data-task-row], .ready") : null;
      return row ? row.querySelector(".act-msg") : null;
    }

    function doTask(btn) {
      var id = btn.getAttribute("data-task");
      var msg = rowMsg(btn);
      btn.disabled = true;
      btn.textContent = "Handing it over…";
      if (msg) msg.textContent = "";
      var body = { action: "do_task", task_id: id };
      if (clientId) body.client_id = clientId;
      return send(TASKS_PATH, body).then(function (res) {
        var k = classify(res);
        if (k === "signin") { leave(); return; }
        if (k !== "ok" || !res.body.task) {
          btn.disabled = false;
          btn.textContent = "Do task";
          if (msg) msg.textContent = (res.body && res.body.message) || ERROR_WORDS[k] || ERROR_WORDS.server;
          return;
        }
        var fresh = res.body.task;
        state.d.tasks = list(state.d.tasks).map(function (x) { return x.id === fresh.id ? fresh : x; });
        repaint();
        var st = el.querySelector('[data-task-row="' + String(fresh.id).replace(/"/g, "") + '"] .t-status');
        if (st && st.focus) { st.setAttribute("tabindex", "-1"); st.focus(); }
      });
    }

    function ready(btn) {
      var msg = rowMsg(btn);
      btn.disabled = true;
      btn.textContent = "Sending…";
      var body = {};
      if (clientId) body.client_id = clientId;
      return send(READY_PATH, body).then(function (res) {
        var k = classify(res);
        if (k === "signin") { leave(); return; }
        if (k !== "ok") {
          btn.disabled = false;
          btn.textContent = "I'm ready to get funded";
          if (msg) msg.textContent = (res.body && res.body.message) || ERROR_WORDS[k] || ERROR_WORDS.server;
          return;
        }
        state.r = res.body;
        repaint();
        /* The card itself now says it was sent; move focus there for screen readers. */
        var card = el.querySelector(".ready");
        if (card && card.focus) { card.setAttribute("tabindex", "-1"); card.focus(); }
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !el.contains(t)) return;
      var act = t.getAttribute("data-act");
      if (act === "retry") load();
      if (act === "ready-retry") loadReady();
      if (act === "do") doTask(t);
      if (act === "ready") ready(t);
    }

    el.addEventListener("click", onClick);
    load();
    return {
      reload: load,
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.innerHTML = "";
      }
    };
  }

  /* The standalone page: page chrome, then mount the section. */
  function initPage() {
    var el = root.document.getElementById("next-root");
    if (!el) return;
    var cid = param("client_id");
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    /* Staff carry the client across the money pages. */
    var nav = root.document.getElementById("money-nav");
    if (nav && cid) {
      Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
        a.setAttribute("href", withClient(a.getAttribute("href"), cid));
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.next = { title: "Next steps", mount: mount };

  root.FHMoneyNext = {
    money: money, day: day, withClient: withClient, statusWords: statusWords, canPress: canPress,
    isEmpty: isEmpty, render: render, renderTask: renderTask, renderTasks: renderTasks, renderReady: renderReady,
    renderBlueprint: renderBlueprint, renderError: renderError, renderLoading: renderLoading, classify: classify,
    mount: mount
  };

  /* Auto-start only finds #next-root on the standalone page. A combined
     FinanceOS page calls FinanceOS.sections.next.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
