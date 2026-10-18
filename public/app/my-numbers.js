/* my-numbers.js — closer personal performance from /api/read/my-numbers */
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
  function text(el, v) { if (el) el.textContent = v == null || v === "" ? "—" : String(v); }
  function money(cents) {
    if (cents == null || !Number.isFinite(Number(cents))) return "—";
    return (Number(cents) / 100).toLocaleString("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    });
  }
  function pct(r) {
    if (r == null || !Number.isFinite(Number(r))) return "—";
    return Math.round(Number(r) * 100) + "%";
  }
  function elapsed(ms) {
    if (!ms) return "";
    var m = Math.floor(ms / 60000);
    var h = Math.floor(m / 60);
    m = m % 60;
    return h ? (h + "h " + m + "m") : (m + "m");
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // A count or a cent value that comes back null means NOT KNOWN. The endpoint
  // sends a sentence saying why — show the sentence. Never a $0 stand-in for an
  // unknown, never a bare dash with nothing next to it. A real zero is a zero.
  function known(v) { return v != null && Number.isFinite(Number(v)); }
  function why(reason, label) {
    return '<span class="why" data-l="' + label + '">' +
      esc(reason || "Not known — no reason was given.") + "</span>";
  }
  function cash(cents, display, reason, label) {
    if (!known(cents)) return why(reason, label);
    return '<span class="num" data-l="' + label + '">' + esc(display || money(cents)) + "</span>";
  }

  function stackRow(row, reason, isTotal) {
    var first = isTotal
      ? "<span><b>All products</b></span>"
      : "<span><b>" + esc(row.name || row.code || "—") + "</b>" +
        (row.active === false ? "<em>retired product</em>" : "") + "</span>";
    var units = known(row.units)
      ? '<span class="num" data-l="Units sold">' + Number(row.units) + "</span>"
      : why(row.units_reason || reason, "Units sold");
    var collected = cash(row.collected_cents, row.collected_display,
      row.collected_reason || reason, "Cash collected");
    if (known(row.collected_cents) && known(row.refunded_cents) && Number(row.refunded_cents) > 0) {
      collected = collected.replace("</span>",
        "<em>after " + esc(money(row.refunded_cents)) + " refunded</em></span>");
    }
    return '<div class="st-row' + (isTotal ? " tot" : "") + '">' + first + units +
      cash(row.sold_cents, row.sold_display, row.sold_reason || reason, "Amount sold") +
      collected + "</div>";
  }

  function paintOfferStack(d) {
    var body = document.getElementById("stackBody");
    if (!body) return;
    var periodNote = document.getElementById("stackPeriod");
    var scopeNote = document.getElementById("stackScope");
    var head = '<div class="st-row hd"><span>Product</span><span class="num">Units sold</span>' +
      '<span class="num">Amount sold</span><span class="num">Cash collected</span></div>';
    var os = d.offer_stack;

    if (scopeNote) {
      scopeNote.textContent = (d.offer_stack_scope && d.offer_stack_scope.note) || "";
    }
    if (!os) {
      body.innerHTML = head +
        '<div class="st-msg">The offer details could not be loaded. Try again in a moment.</div>';
      return;
    }
    if (periodNote) periodNote.textContent = "every product you sell" +
      (os.period && os.period.label ? " · " + os.period.label : "");
    if (os.available === false || !Array.isArray(os.items) || !os.items.length) {
      body.innerHTML = head + '<div class="st-msg">' +
        esc(os.reason || "The offer stack could not be read.") + "</div>";
      return;
    }
    var rows = os.items.map(function (it) { return stackRow(it, os.reason, false); }).join("");
    body.innerHTML = head + rows + (os.totals ? stackRow(os.totals, os.reason, true) : "");
  }

  function paint(d) {
    var period = document.getElementById("numbersPeriod");
    if (period && d.period && d.period.start) {
      var date = new Date(d.period.start);
      if (Number.isFinite(date.getTime())) {
        period.textContent = date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) +
          " · Your sales, follow-ups and commissions";
      }
    }
    var shiftChip = $("#shiftChip") || $("header .hl .chip");
    if (shiftChip) {
      if (d.shift && d.shift.on_shift) {
        shiftChip.className = "chip on";
        shiftChip.innerHTML = '<span class="cd"></span>On shift · ' + elapsed(d.shift.elapsed_ms);
      } else {
        shiftChip.className = "chip";
        shiftChip.innerHTML = '<span class="cd"></span>Off shift';
      }
    }

    var pace = d.pace || {};
    var bigs = document.querySelectorAll(".pace .big");
    if (bigs[0]) bigs[0].textContent = pace.cash_display || money(pace.cash_cents);
    if (bigs[1]) {
      bigs[1].innerHTML = esc(pace.rank != null ? pace.rank : "—") +
        (pace.team_size > 0 || pace.rank != null ? '<span>/' + esc(pace.team_size != null ? pace.team_size : "—") + "</span>" : "");
    }
    var subs = document.querySelectorAll(".pace .sub");
    if (subs[0]) {
      subs[0].textContent = pace.target_display
        ? ("Target " + pace.target_display)
        : (pace.target_reason || "No monthly target set");
    }
    if (subs[1]) subs[1].textContent = pace.team_size === 0 ? "0 closers this month" : "This month";
    var bar = $(".pace .bar i");
    if (bar && pace.target_deposits) {
      var pctFill = Math.min(100, Math.round((pace.deposits || 0) / pace.target_deposits * 100));
      bar.style.width = pctFill + "%";
      bar.parentElement.setAttribute("aria-valuenow", String(pctFill));
      bar.parentElement.setAttribute("aria-valuetext", (pace.deposits || 0) + " of " + pace.target_deposits + " deposits");
    } else if (bar) {
      bar.style.width = "0%";
      bar.parentElement.removeAttribute("aria-valuenow");
      bar.parentElement.setAttribute("aria-valuetext", pace.target_reason || "No monthly target set");
    }
    var markTarget = document.querySelector(".pace .marks span:nth-child(2)");
    if (markTarget) markTarget.textContent = pace.target_display ? "Target " + pace.target_display : "Target —";

    paintOfferStack(d);

    var month = d.month || {};
    var cells = document.querySelectorAll(".grid .m");
    function mset(i, label, val, cmp) {
      var el = cells[i]; if (!el) return;
      var lb = el.querySelector(".lb"); var vl = el.querySelector(".vl"); var c = el.querySelector(".cmp");
      if (lb) lb.textContent = label;
      if (vl) vl.textContent = val;
      if (c) c.textContent = cmp || "";
    }
    var prior = month.prior || {};
    var depCmp = prior.deposits != null && Number.isFinite(Number(prior.deposits))
      ? ("was " + prior.deposits) : "";
    var closeCmp = prior.close_rate != null && Number.isFinite(Number(prior.close_rate))
      ? ("was " + pct(prior.close_rate)) : "";
    mset(0, "Deposits closed", String(month.deposits_closed != null ? month.deposits_closed : "—"), depCmp);
    mset(1, "Close rate", pct(month.close_rate), closeCmp);
    mset(2, "Show rate", pct(month.show_rate), "");
    mset(3, "Downsells", String(month.downsells != null ? month.downsells : "—"), "");
    mset(4, "Deposit → funded", pct(month.deposit_to_funded), "Deposits that reached funding");
    mset(5, "Avg funded", money(month.avg_funded_cents), month.avg_funded_reason || "");
    mset(6, "Calls held", String(month.calls_held != null ? month.calls_held : "—"),
      (month.no_shows != null ? month.no_shows : "—") + " no-shows");
    mset(7, "Unlogged", String(month.unlogged != null ? month.unlogged : "—"),
      month.unlogged > 0 ? "Log before the next call" : "");
    if (cells[7]) cells[7].classList.toggle("is-unlogged", month.unlogged > 0);

    var moneyBox = d.money || {};
    var mos = document.querySelectorAll(".money .mo");
    function mo(i, label, val, sb) {
      var el = mos[i]; if (!el) return;
      text(el.querySelector(".lb"), label);
      text(el.querySelector(".vl"), val);
      text(el.querySelector(".sb"), sb);
    }
    mo(0, "Paid out", moneyBox.paid_display || money(moneyBox.paid_cents), "Commission paid from the ledger");
    mo(1, "Pending funding", moneyBox.pending_display || money(moneyBox.pending_cents), "Earned or approved commission");
    mo(2, "At risk", "—", moneyBox.at_risk_reason || "Not computed yet");

    var streakNote = document.querySelectorAll(".sec .note");
    streakNote.forEach(function (n) {
      if (/last 9|record of|streak is not stored/i.test(n.textContent || "")) {
        n.textContent = (d.streak && d.streak.reason) || "Daily close streak is not stored yet.";
      }
    });
    var days = document.querySelector(".days");
    if (days) {
      days.innerHTML = '<div class="d">' +
        esc((d.streak && d.streak.reason) || "Streak needs a working-day calendar — not built") + "</div>";
    }

    var team = d.team || [];
    var panel = document.getElementById("teamPanel");
    if (panel) {
      var rows = team.map(function (t, i) {
        var me = t.staff_id === d.staff_id;
        return '<div class="lb-row' + (me ? " me" : "") + '">' +
          '<span class="rk' + (i === 0 ? " one" : "") + '">' + esc(t.rank != null ? String(t.rank).padStart(2, "0") : "—") + "</span>" +
          '<span class="nm"><b>' + esc(me ? "You" : (t.name || "—")) + "</b><em>" +
          esc(t.deposits != null ? t.deposits : "—") + " deposits</em></span>" +
          '<span class="num">' + esc(t.cash_display || money(t.cash_cents)) + "</span>" +
          '<span class="num hide" aria-label="Close rate ' + pct(t.close_rate) + '">' + pct(t.close_rate) + "</span></div>";
      }).join("") || '<p class="note">No closer dispositions logged this month yet.</p>';
      panel.querySelectorAll(".lb-row").forEach(function (n) { n.remove(); });
      panel.querySelectorAll(".note").forEach(function (n) { n.remove(); });
      var h = panel.querySelector("h3");
      if (h) h.insertAdjacentHTML("afterend", rows);
    }

    var qualPanel = document.getElementById("qualityPanel");
    if (qualPanel) {
      var reason = (d.call_quality && d.call_quality.reason) ||
        "Call recording and transcription do not exist yet.";
      qualPanel.innerHTML = '<h3 id="qualityTitle">Call quality</h3><p class="note">' + esc(reason) + "</p>" +
        '<p class="note">' + esc((d.compliance && d.compliance.reason) || "Compliance checks need call recordings before they can be measured.") + "</p>";
    }

    document.querySelectorAll(".todo").forEach(function (n) { n.remove(); });
    var owed = d.owed || [];
    var owedHost = document.getElementById("owedSection");
    if (owedHost) {
      var html = owed.map(function (o) {
        var body = '<span class="t">' + esc(o.urgency || "—") + "</span><div><b>" +
          esc(o.title || "") + "</b><em>" + esc(o.detail || "") + "</em></div>";
        if (o.client_id) {
          var href = "closer-dashboard.html?client_id=" + encodeURIComponent(o.client_id);
          if (o.task_id) href += "&task_id=" + encodeURIComponent(o.task_id);
          return '<a class="todo" href="' + href + '">' + body + "</a>";
        }
        return '<div class="todo">' + body + "</div>";
      }).join("") || '<div class="todo"><span class="t">—</span><div><b>Nothing owed</b><em>Unlogged calls and quiet deposits will land here</em></div></div>';
      var p = owedHost.querySelector(".panel");
      if (p) p.innerHTML = html;
      var owedNote = owedHost.querySelector(".sech .note");
      if (owedNote) {
        owedNote.textContent = (month.unlogged > owed.length)
          ? ("Showing " + owed.length + " of " + month.unlogged)
          : "clears automatically when done";
      }
    }
  }

  function paintWho() {
    var nameChip = document.getElementById("staffChip") || $("header .hr .chip");
    if (!nameChip) return;
    var token = "";
    try { token = localStorage.getItem("fh_token") || ""; } catch (e) {}
    fetch("/api/auth/session", {
      headers: token
        ? { accept: "application/json", authorization: "Bearer " + token }
        : { accept: "application/json" }
    }).then(function (r) { return r.json(); }).then(function (s) {
      var name = (s && s.staff && s.staff.name) || "";
      nameChip.textContent = name || "—";
    }).catch(function () {
      nameChip.textContent = "—";
    });
  }

  var loading = false;
  var hasLoaded = false;
  async function load() {
    if (loading) return;
    loading = true;
    var status = document.getElementById("numbersStatus");
    var statusText = document.getElementById("numbersStatusText");
    var content = document.getElementById("numbersContent");
    var retry = document.getElementById("numbersRetry");
    var refresh = document.getElementById("numbersRefresh");
    if (status) { status.hidden = false; status.dataset.state = "loading"; }
    if (statusText) statusText.textContent = hasLoaded ? "Refreshing your numbers…" : "Loading your numbers…";
    if (content) content.setAttribute("aria-busy", "true");
    if (retry) retry.hidden = true;
    if (refresh) refresh.disabled = true;
    try {
      var r = window.FHData ? await window.FHData.read("my-numbers") : { ok: false };
      if (!r.ok || !r.data) {
        var reason = r.error && (r.error.message || r.error);
        if (status) status.dataset.state = "error";
        if (statusText) statusText.textContent = (typeof reason === "string" && /\s/.test(reason) ? reason : "Your numbers could not be loaded. Try again.") +
          (hasLoaded ? " Last loaded values remain below." : "");
        if (retry) retry.hidden = false;
        return;
      }
      paint(r.data);
      hasLoaded = true;
      if (status) status.hidden = true;
    } catch (e) {
      if (status) status.dataset.state = "error";
      if (statusText) statusText.textContent = "Your numbers could not be loaded. Try again.";
      if (retry) retry.hidden = false;
    } finally {
      loading = false;
      if (content) content.setAttribute("aria-busy", "false");
      if (refresh) refresh.disabled = false;
    }
  }

  function boot() {
    paintWho();
    var retry = document.getElementById("numbersRetry");
    var refresh = document.getElementById("numbersRefresh");
    if (retry) retry.addEventListener("click", load);
    if (refresh) refresh.addEventListener("click", load);
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
