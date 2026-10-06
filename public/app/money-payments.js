/* Payments — Clarity Payments + the money helper (/app/money-payments.html).
 *
 * Reads ONE endpoint, GET /api/money/payments, and paints it. Every figure is a
 * field from that read; nothing here invents a number.
 *
 * THE HONESTY RULES (same as money.js):
 *   - Money arrives as integer cents. A null paints "—", never $0.00.
 *   - Late is said in words ("Late 4 days"), never by colour alone.
 *   - The helper's log says what it did. It never says it moved money.
 *
 * Staff (a ?client_id= in the bar, FINANCE role on the server) also see plan
 * controls: add a plan, record a payment, mark settled. A client never does —
 * and the server refuses those actions for a client session anyway.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-payments-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/payments";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var KIND_LABEL = { clarity: "Clarity Payment", bnpl: "Buy now, pay later", other: "Other balance" };
  var UPCOMING_LABEL = { clarity: "Payment to Fundhub", card_due: "Card payment", bill: "Bill" };
  var HELD_WORDS = {
    opted_out: "you asked us not to text you",
    escalation_on_file: "a person on our team is handling your file",
    a_person_has_this: "a person on our team already has this"
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
  function cap(s) { s = String(s == null ? "" : s); return s.charAt(0).toUpperCase() + s.slice(1); }

  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  /* "2026-10-21" → "Oct 21, 2026", read as a calendar date. */
  function day(iso, noYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (noYear ? "" : ", " + m[1]);
  }

  /* "500" / "500.5" / "1,500.00" → cents, no float maths. null when not money. */
  function toCents(text) {
    var s = String(text == null ? "" : text).replace(/[$,\s]/g, "");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var frac = (m[2] || "") + "00";
    return Number(m[1]) * 100 + Number(frac.slice(0, 2));
  }

  /* "2026-10-01, 500" per line → [{ due_on, amount_cents }] or an error string. */
  function parseSchedule(text) {
    var lines = String(text || "").split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { error: "Add at least one payment: a date and an amount on each line." };
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var m = /^(\d{4}-\d{2}-\d{2})\s*[,\s]\s*(.+)$/.exec(lines[i]);
      var cents = m ? toCents(m[2]) : null;
      if (!m || !cents) return { error: "Line " + (i + 1) + " needs a date and an amount, like 2026-11-01, 500.00" };
      out.push({ due_on: m[1], amount_cents: cents });
    }
    return { installments: out };
  }

  function bar(paid, total) {
    if (!isNum(paid) || !isNum(total) || total <= 0) return "";
    var w = Math.max(0, Math.min(100, (paid / total) * 100));
    return '<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="' +
      esc(Math.round(w) + "% paid") + '"><rect class="bar-track" x="0" y="0" width="100" height="8" rx="4"></rect>' +
      '<rect class="bar-fill" x="0" y="0" width="' + w + '" height="8" rx="4"></rect></svg>';
  }

  function lateBadge(days) {
    return '<span class="late">Late ' + esc(plural(days, "day", "days")) + '</span>';
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function openPlans(d) { return list(d && d.plans).filter(function (p) { return p.status === "open"; }); }

  function renderHead(d) {
    var who = d && d.client && d.client.name ? d.client.name : "";
    return '<div class="head"><div><h1>Payments</h1><p class="caption">' +
      esc(who ? who + " · Money you owe Fundhub, what is coming up, and what your money helper did"
        : "Money you owe Fundhub, what is coming up, and what your money helper did") + '</p></div></div>';
  }

  function renderTiles(d) {
    var o = (d && d.owed) || {};
    var plans = openPlans(d);
    var next = null;
    plans.forEach(function (p) {
      if (p.next && p.next.state !== "late" && (!next || String(p.next.due_on) < String(next.due_on))) next = { due_on: p.next.due_on, left_cents: p.next.left_cents, name: p.name };
    });
    var owe = '<section class="card tile" aria-labelledby="t-owe"><h2 class="eyebrow" id="t-owe">You owe Fundhub</h2>' +
      '<span class="big">' + esc(money(o.left_cents)) + '</span>' +
      '<p class="caption">' + esc(plural(o.open_count || 0, "open plan", "open plans")) + '</p></section>';
    var late = '<section class="card tile" aria-labelledby="t-late"><h2 class="eyebrow" id="t-late">Late now</h2>' +
      '<span class="big">' + esc(money(o.late_cents || 0)) + '</span>' +
      '<p class="caption">' + (o.late_count ? lateBadge(maxLate(plans)) + ' ' + esc(plural(o.late_count, "plan", "plans")) : "Nothing late. Nice work.") + '</p></section>';
    var nx = next
      ? '<section class="card tile" aria-labelledby="t-next"><h2 class="eyebrow" id="t-next">Next payment</h2>' +
        '<span class="big">' + esc(day(next.due_on, true)) + '</span>' +
        '<p class="caption">' + esc(money(next.left_cents) + " · " + cap(next.name)) + '</p></section>'
      : '<section class="card tile" aria-labelledby="t-next"><h2 class="eyebrow" id="t-next">Next payment</h2>' +
        '<span class="big">—</span><p class="caption">No payment coming up</p></section>';
    return '<div class="grid tiles">' + owe + late + nx + '</div>';
  }

  function maxLate(plans) {
    return plans.reduce(function (m, p) { return Math.max(m, p.days_late || 0); }, 0);
  }

  function stateWord(i) {
    if (i.state === "paid") return '<span class="paid-word">Paid</span>' + (i.paid_at ? ' <span class="caption">' + esc(day(i.paid_at, true)) + '</span>' : "");
    if (i.state === "late") return lateBadge(i.days_late);
    if (i.state === "due_soon") return "Due soon";
    return "Coming up";
  }

  function renderPlan(p, staff) {
    var rows = list(p.installments).map(function (i) {
      return '<tr' + (i.state === "late" ? ' class="is-late"' : "") + '><td>' + esc(i.seq) + '</td><td>' + esc(day(i.due_on)) + '</td>' +
        '<td class="r num">' + esc(money(i.amount_cents)) + '</td><td class="r num">' + esc(money(i.paid_cents)) + '</td>' +
        '<td>' + stateWord(i) + '</td></tr>';
    }).join("");
    var status = p.status === "settled" ? '<span class="paid-word">Paid off</span>'
      : p.is_late ? lateBadge(p.days_late) : '<span class="tag">On track</span>';
    var next = p.next
      ? esc(money(p.next.left_cents)) + ' on ' + esc(day(p.next.due_on, true))
      : "—";
    var controls = staff && p.status === "open" ? renderPlanControls(p) : "";
    return '<article class="card plan" data-plan="' + esc(p.id) + '">' +
      '<div class="plan-head"><div><p class="plan-name">' + esc(cap(p.name)) + '</p>' +
      '<p class="caption">' + esc(KIND_LABEL[p.kind] || "Balance") + ' · owed to ' + esc(p.owed_to) + '</p></div>' +
      '<div>' + status + '</div></div>' +
      '<dl class="facts"><div><dt class="caption">Left to pay</dt><dd class="big">' + esc(money(p.left_cents)) + '</dd></div>' +
      '<div><dt class="caption">Paid so far</dt><dd class="num">' + esc(money(p.paid_cents)) + ' of ' + esc(money(p.original_cents)) + '</dd></div>' +
      '<div><dt class="caption">Next payment</dt><dd class="num">' + next + '</dd></div></dl>' +
      bar(p.paid_cents, p.original_cents) +
      '<div class="scroll-x"><table><caption class="caption">Payment schedule</caption><thead><tr><th>#</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th>Status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' + controls + '</article>';
  }

  function renderPlanControls(p) {
    return '<div class="staff"><span class="eyebrow">Staff only</span>' +
      '<form data-form="record" data-plan="' + esc(p.id) + '">' +
      '<label class="field"><span class="caption">Payment received ($)</span><input name="amount" inputmode="decimal" placeholder="500.00" required></label>' +
      '<button class="btn-line" type="submit">Record payment</button>' +
      '<button class="btn-text" type="button" data-act="settle" data-plan="' + esc(p.id) + '" data-name="' + esc(cap(p.name)) + '">Mark settled</button>' +
      '</form><p class="act-msg caption" aria-live="polite"></p></div>';
  }

  function renderOwed(d, staff) {
    var plans = list(d && d.plans);
    var body = plans.length
      ? '<div class="plans">' + plans.map(function (p) { return renderPlan(p, staff); }).join("") + '</div>'
      : '<section class="card empty"><h2>You do not owe Fundhub anything right now</h2>' +
        '<p>When you pay Fundhub over time — a Clarity Payment or a buy now, pay later plan — each plan shows up here with its due dates.</p></section>';
    return '<section class="block" aria-labelledby="b-owe"><h2 id="b-owe">What you owe Fundhub</h2>' +
      '<p class="caption">Each plan, the next payment, and anything late.</p>' + body +
      (staff ? renderAddPlan() : "") + '</section>';
  }

  function renderAddPlan() {
    return '<section class="card staff addplan" aria-labelledby="b-add"><h3 class="eyebrow" id="b-add">Staff only · Add a payment plan</h3>' +
      '<form data-form="add">' +
      '<label class="field f3"><span class="caption">Kind</span><select name="kind">' +
      '<option value="clarity">Clarity Payment</option><option value="bnpl">Buy now, pay later</option><option value="other">Other</option></select></label>' +
      '<label class="field f3"><span class="caption">Owed to</span><input name="owed_to" value="Fundhub LLC"></label>' +
      '<label class="field f3"><span class="caption">Name the client sees</span><input name="label" placeholder="Funding program balance"></label>' +
      '<label class="field f12"><span class="caption">Payments — one per line: date, amount</span>' +
      '<textarea name="schedule" placeholder="2026-11-01, 500.00&#10;2026-12-01, 500.00"></textarea></label>' +
      '<div class="f3"><button class="btn-line" type="submit">Add payment plan</button></div>' +
      '</form><p class="act-msg caption" aria-live="polite"></p></section>';
  }

  function renderUpcoming(d) {
    var items = list(d && d.upcoming);
    var body = items.length
      ? '<ul class="rows">' + items.slice(0, 12).map(function (u) {
        return '<li class="row"><span class="row-main"><span class="row-name">' + esc(cap(u.name)) + '</span>' +
          '<span class="caption">' + esc(UPCOMING_LABEL[u.type] || "Due") + '</span></span>' +
          '<span class="row-amt"><span class="num">' + esc(money(u.amount_cents)) + '</span><br><span class="caption">' + esc(day(u.on, true)) + '</span></span></li>';
      }).join("") + '</ul>'
      : '<p class="caption">Nothing due in the next 30 days.</p>';
    return '<section class="card" aria-labelledby="b-up"><h2 class="eyebrow" id="b-up">Coming up</h2>' + body + '</section>';
  }

  /* One plain sentence per thing the helper (or a person) did. */
  function logSentence(e) {
    var what = e.item_label || "a payment";
    var notSent = e.message_status && e.message_status !== "queued" ? " (the text was not sent)" : "";
    switch (e.action) {
      case "reminder": return "Sent you a reminder about " + what + "." + notSent;
      case "late_check_in": return "Checked in about " + what + ". It looks late." + notSent;
      case "second_check_in": return "Checked in again about " + what + "." + notSent;
      case "csm_task": return "Asked a person on our team to reach out about " + what + ".";
      case "held": return "Did not text you about " + what + ", because " + (HELD_WORDS[e.reason] || "texts are paused") + ".";
      case "plan_added": return "Fundhub added a payment plan" + (isNum(e.amount_cents) ? " of " + money(e.amount_cents) : "") + ".";
      case "payment_recorded": return "Recorded your payment" + (isNum(e.amount_cents) ? " of " + money(e.amount_cents) : "") + ". Thank you.";
      case "plan_settled": return "Marked a payment plan as paid off.";
      case "asked_for_person": return "You asked for a person. Our team will reach out.";
      default: return "Updated your payments.";
    }
  }

  function renderLog(d) {
    var items = list(d && d.agent_log);
    var body = items.length
      ? '<ul class="log">' + items.map(function (e) {
        return '<li><span class="when">' + esc(day(e.decided_on, true)) + '</span><span>' + esc(logSentence(e)) + '</span></li>';
      }).join("") + '</ul>'
      : '<p class="caption">Nothing yet. Your money helper will remind you before a payment is due and check in if one is late.</p>';
    return '<section class="card" aria-labelledby="b-log"><h2 class="eyebrow" id="b-log">What your money helper did</h2>' + body +
      '<p class="caption">Your money helper runs on simple rules. It reminds and checks in. It never moves money.</p></section>';
  }

  function renderHelp() {
    return '<section class="card help" aria-labelledby="b-help"><h2 class="eyebrow" id="b-help">Need help?</h2>' +
      '<p>Can\'t make a payment, or something looks wrong? A person on our team will reach out. The money helper stops texting while they do.</p>' +
      '<button class="btn-primary" type="button" data-act="person">Talk to a person</button>' +
      '<p class="act-msg caption" aria-live="polite"></p></section>';
  }

  function isEmpty(d) { return !d || list(d.plans).length === 0; }

  function render(d, opts) {
    var staff = !!(opts && opts.staff);
    return renderHead(d) + (isEmpty(d) ? "" : renderTiles(d)) + renderOwed(d, staff) +
      '<div class="grid two">' + renderUpcoming(d) + renderLog(d) + '</div>' + renderHelp();
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<div class="head"><div><h1>Payments</h1><p class="caption">Loading your payments…</p></div></div>' +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + '</div>' +
      '<div class="grid two"><div class="card skel"><span class="sk sk-m"></span><span class="sk sk-l"></span></div>' +
      '<div class="card skel"><span class="sk sk-m"></span><span class="sk sk-l"></span></div></div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your payments. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose payments to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Payments</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your payments</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
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

  /* ── the section: window.FinanceOS.sections.payments ─────────────────────
     mount(el, ctx) paints this section into `el` and wires its buttons. No
     page chrome — no header, no nav. ctx = { clientId, apiGet, apiPost }:
       clientId  staff only (a staff desk passes it; a client session leaves it
                 empty — the server pins a client to their own file)
       apiGet(path) / apiPost(path, body)
                 → Promise of { status, body } (or of the parsed body alone).
     Missing api functions fall back to this file's own fetch. The standalone
     page (/app/money-payments.html) is a thin shell that calls mount().
     Section styles: money-payments.css, every rule under .fh-payments. */

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var staff = !!clientId;
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };

    function paint(html) { el.innerHTML = '<div class="fh-payments">' + html + '</div>'; }

    function load() {
      paint(renderLoading());
      return get(READ_PATH + (clientId ? "?client_id=" + encodeURIComponent(clientId) : "")).then(function (res) {
        var kind = classify(res);
        if (kind === "signin" && root.location) { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        paint(render(res.body, { staff: staff }));
      });
    }

    function post(body, msgEl, btn, doneText) {
      function say(t) { if (msgEl) msgEl.textContent = t; }
      if (clientId) body.client_id = clientId;
      var label = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
      say("");
      return send(READ_PATH, body).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (classify(res) !== "ok") {
          say((res.body && res.body.message) || ERROR_WORDS[classify(res)] || ERROR_WORDS.server);
          return false;
        }
        say(doneText);
        return true;
      });
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !el.contains(t)) return;
      var act = t.getAttribute("data-act");
      if (act === "retry") load();
      if (act === "person") {
        post({ action: "ask_for_person" }, t.parentNode.querySelector(".act-msg"), t,
          "Done. A person on our team will reach out soon.");
      }
      if (act === "settle") {
        var name = t.getAttribute("data-name") || "this plan";
        if (!root.confirm("Mark " + name + " as settled? The money helper will stop all reminders for it.")) return;
        var msg = t.closest(".staff").querySelector(".act-msg");
        post({ action: "mark_settled", plan_id: t.getAttribute("data-plan") }, msg, t, "Marked settled.").then(function (ok) { if (ok) load(); });
      }
    }

    function onSubmit(e) {
      var f = e.target;
      if (!f || !f.getAttribute || !f.getAttribute("data-form")) return;
      e.preventDefault();
      var kind = f.getAttribute("data-form");
      var msg = f.parentNode.querySelector(".act-msg");
      var btn = f.querySelector('button[type="submit"]');
      if (kind === "record") {
        var cents = toCents(f.elements.amount.value);
        if (!cents) { msg.textContent = "Type the amount received, like 500.00"; return; }
        post({ action: "record_payment", plan_id: f.getAttribute("data-plan"), amount_cents: cents }, msg, btn, "Payment recorded.")
          .then(function (ok) { if (ok) load(); });
      }
      if (kind === "add") {
        var sched = parseSchedule(f.elements.schedule.value);
        if (sched.error) { msg.textContent = sched.error; return; }
        post({
          action: "add_plan", kind: f.elements.kind.value, owed_to: f.elements.owed_to.value,
          label: f.elements.label.value, installments: sched.installments
        }, msg, btn, "Plan added.").then(function (ok) { if (ok) load(); });
      }
    }

    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    load();
    return {
      reload: load,
      unmount: function () {
        el.removeEventListener("click", onClick);
        el.removeEventListener("submit", onSubmit);
        el.innerHTML = "";
      }
    };
  }

  /* The standalone page: page chrome, then mount the section. */
  function initPage() {
    var el = root.document.getElementById("payments-root");
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
        a.setAttribute("href", a.getAttribute("href") + "?client_id=" + encodeURIComponent(cid));
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.payments = { mount: mount, render: render };

  root.FHMoneyPayments = {
    money: money, day: day, toCents: toCents, parseSchedule: parseSchedule, logSentence: logSentence,
    isEmpty: isEmpty, render: render, renderError: renderError, renderLoading: renderLoading, classify: classify,
    mount: mount
  };

  /* Auto-start only finds #payments-root on the standalone page. A combined
     FinanceOS page calls FinanceOS.sections.payments.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
