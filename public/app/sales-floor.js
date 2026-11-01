/* sales-floor.js — manager floor from /api/read/sales-floor + marketing flag */
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
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
  function count(n) {
    return n == null || !Number.isFinite(Number(n)) ? "—" : String(Number(n));
  }
  function elapsed(ms) {
    if (!ms) return "";
    var m = Math.floor(ms / 60000);
    var h = Math.floor(m / 60);
    m = m % 60;
    return h ? (h + "h " + m + "m") : (m + "m");
  }

  function safeDriveUrl(u) {
    if (!u) return "";
    try {
      var x = new URL(u);
      if (x.protocol !== "https:") return "";
      var host = String(x.hostname || "").toLowerCase();
      if (host === "drive.google.com" || host === "docs.google.com") return x.href;
      return "";
    } catch (e) {
      return "";
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Offer stack cells. A null cents value is an UNKNOWN, never a zero — the
     endpoint sends a sentence saying why, and that sentence is what a person
     reads. Reasons are collected once per table and printed under it, because
     a whole sentence does not fit in a right-aligned money column. */
  function stackAmount(display, cents, reason, unknowns) {
    if (display) return esc(display);
    if (cents != null && Number.isFinite(Number(cents))) return money(cents);
    var why = reason || "";
    if (why && unknowns.indexOf(why) === -1) unknowns.push(why);
    return '<em class="unk"' + (why ? ' title="' + esc(why) + '"' : "") + ">Not recorded</em>";
  }

  function stackCount(units, reason, unknowns) {
    if (units != null && Number.isFinite(Number(units))) return String(Number(units));
    var why = reason || "";
    if (why && unknowns.indexOf(why) === -1) unknowns.push(why);
    return '<em class="unk">Not recorded</em>';
  }

  function stackTable(stack, missingNote) {
    if (!stack) return '<p class="note">' + esc(missingNote) + "</p>";
    if (stack.available === false) {
      return '<p class="note">' + esc(stack.reason || missingNote) + "</p>";
    }
    var items = stack.items || [];
    if (!items.length) return '<p class="note">' + esc(stack.reason || missingNote) + "</p>";
    var unknowns = [];
    var rows = items.map(function (it) {
      return '<div class="rrow">' +
        '<span class="nm"><b>' + esc(it.name || it.code || "Offer") + "</b><em>" +
        esc(it.code || "") + (it.active === false ? " · retired" : "") + "</em></span>" +
        '<span class="num">' + stackCount(it.units, stack.reason, unknowns) + "</span>" +
        '<span class="num">' + stackAmount(it.sold_display, it.sold_cents, it.sold_reason || stack.reason, unknowns) + "</span>" +
        '<span class="num">' + stackAmount(it.collected_display, it.collected_cents, it.collected_reason || stack.reason, unknowns) + "</span>" +
        "</div>";
    }).join("");
    var t = stack.totals || {};
    rows += '<div class="rrow tot"><span class="nm"><b>All offers</b></span>' +
      '<span class="num">' + stackCount(t.units, stack.reason, unknowns) + "</span>" +
      '<span class="num">' + stackAmount(t.sold_display, t.sold_cents, t.sold_reason || stack.reason, unknowns) + "</span>" +
      '<span class="num">' + stackAmount(t.collected_display, t.collected_cents, t.collected_reason || stack.reason, unknowns) + "</span></div>";
    var why = unknowns.length
      ? '<p class="say"><b>Why some numbers say Not recorded.</b> ' +
        unknowns.map(esc).join(" ") + "</p>"
      : "";
    return '<div class="ostack" role="region" aria-label="Offer sales and collections" tabindex="0"><div class="rhead">' +
      '<span>Offer</span><span class="num">Units</span><span class="num">Sold</span>' +
      '<span class="num">Collected</span></div>' + rows + "</div>" + why;
  }

  /* The whole floor's stack, plus the sales no closer can be credited for.
     The unattributed block is why the floor total can beat the closers added
     up. It is shown on its own, never spread across people. */
  function paintOfferStack(d) {
    var body = $("#fh-offer-stack .ostbody");
    if (!body) return;
    var html = stackTable(d.offer_stack, "Offer details are not available yet.");
    var un = d.offer_stack_unattributed;
    if (un && (un.items || []).length) {
      html += '<div class="sech" style="margin-top:24px"><span class="eyebrow">' +
        "Sold, but not credited to any closer</span></div>" +
        (un.reason
          ? '<div class="flagbox" style="background:rgba(245,206,143,.14);' +
            'border-left-color:var(--warn);margin-top:0;margin-bottom:12px">' +
            esc(un.reason) + "</div>"
          : "") +
        stackTable(un, "Not credited to a closer.");
    }
    body.innerHTML = html;
  }

  var state = { data: null, closer: 0, loading: false };

  function paintSetterRoster(d) {
    var body = $("#fh-floor-setters .setter-body");
    if (!body) return;
    var setters = d.setters || [];
    body.innerHTML = setters.map(function (s) {
      return '<div class="setter-row">' +
        '<span class="setter-name">' + esc(s.name || "Setter") + '</span>' +
        '<span class="num" data-label="Logged dials">' + count(s.dials) + '</span>' +
        '<span class="num" data-label="Opt-in booked">' + count(s.booked) + '</span>' +
        '<span class="num" data-label="Shows">' + count(s.showed) + '</span>' +
        '<span class="num" data-label="No-shows">' + count(s.no_shows) + '</span>' +
        '<span class="num" data-label="Show rate">' + pct(s.show_rate) + '</span>' +
        '</div>';
    }).join("") || '<p class="note setter-empty">No active setters yet. Add a setter in Team &amp; access to track their work here.</p>';
  }

  /* One closer at a time. Everything here comes out of closers[i] on the floor
     response that is already loaded — picking a name makes no second request. */
  function paintCloserFocus() {
    var body = $("#fh-closer-focus .focusbody");
    if (!body) return;
    var list = (state.data && state.data.closers) || [];
    if (!list.length) {
      body.innerHTML = '<p class="note">No closers on this board yet.</p>';
      return;
    }
    if (state.closer >= list.length) state.closer = 0;
    if (state.closer < 0) state.closer = list.length - 1;
    var c = list[state.closer];

    var picks = list.map(function (p, i) {
      return '<button type="button" class="pickb' + (i === state.closer ? " on" : "") +
        '" data-fh-closer="' + i + '" aria-pressed="' + (i === state.closer ? "true" : "false") + '">' + esc(p.name || "Closer") + "</button>";
    }).join("");

    var cash = c.cash_display
      ? esc(c.cash_display)
      : (c.cash_cents != null && Number.isFinite(Number(c.cash_cents))
        ? money(c.cash_cents)
        : '<span class="unk">Not recorded</span>');

    // Four tiles, not five — fundhub-brand.css pins .funnel to four columns.
    var tiles =
      '<div class="f"><div class="lb">Deposits</div><div class="vl">' +
        (c.deposits != null ? esc(c.deposits) : '<span class="unk">Not recorded</span>') +
        '</div><div class="cv">' +
        (c.calls != null ? ("Off " + esc(c.calls) + " calls") : "Calls not recorded") +
        "</div></div>" +
      '<div class="f"><div class="lb">Close rate</div><div class="vl">' + pct(c.close_rate) +
        '</div><div class="cv">Of calls held</div></div>' +
      '<div class="f"><div class="lb">Funded rate</div><div class="vl">' + pct(c.funded_rate) +
        '</div><div class="cv">Of deposits taken</div></div>' +
      '<div class="f"><div class="lb">Cash</div><div class="vl">' + cash +
        '</div><div class="cv">This month</div></div>';

    body.innerHTML =
      '<div class="picks">' +
      '<button type="button" class="pickb" id="fh-closer-prev" aria-label="Previous closer">‹</button>' +
      '<div class="closer-list" role="group" aria-label="Choose a closer">' + picks + '</div>' +
      '<button type="button" class="pickb" id="fh-closer-next" aria-label="Next closer">›</button>' +
      "</div>" +
      '<div class="picks" style="justify-content:space-between"><span class="pickwho">' +
      esc(c.name || "Closer") + "<em>" +
      (c.on_shift ? ("On shift · " + esc(elapsed(c.shift_elapsed_ms))) : "Off shift") +
      '</em></span><span class="note">Closer ' + (state.closer + 1) + " of " + list.length +
      "</span></div>" +
      '<div class="funnel">' + tiles + "</div>" +
      '<p class="say"><b>Do this.</b> ' + esc(c.action || "Nothing assigned") + "</p>" +
      '<div style="margin-top:16px">' +
      stackTable(c.offer_stack, "This closer's offer details are not available yet.") +
      "</div>";

    var prev = $("#fh-closer-prev");
    if (prev) prev.addEventListener("click", function () { selectCloser(state.closer - 1); });
    var next = $("#fh-closer-next");
    if (next) next.addEventListener("click", function () { selectCloser(state.closer + 1); });
    body.querySelectorAll(".pickb[data-fh-closer]").forEach(function (b) {
      b.addEventListener("click", function () {
        selectCloser(Number(b.getAttribute("data-fh-closer")));
      });
    });

    document.querySelectorAll(".rost .rrow.pick").forEach(function (row) {
      var selected = Number(row.getAttribute("data-fh-closer")) === state.closer;
      row.classList.toggle("on", selected);
      row.setAttribute("aria-pressed", String(selected));
    });
  }

  function selectCloser(i, scroll) {
    var list = (state.data && state.data.closers) || [];
    if (!list.length) return;
    var focused = document.activeElement;
    var focusId = focused && focused.id;
    var focusIndex = focused && focused.getAttribute("data-fh-closer");
    state.closer = ((i % list.length) + list.length) % list.length;
    paintCloserFocus();
    // Rebuilding the picker must retain keyboard position.
    if (!scroll && focused && focused.classList.contains("pickb")) {
      var replacement = focusId ? document.getElementById(focusId)
        : $("#fh-closer-focus .pickb[data-fh-closer='" + focusIndex + "']");
      if (replacement) replacement.focus({ preventScroll: true });
    }
    // Picking from the roster answers back by moving to the panel it filled.
    // Picking inside the panel does not, or the page would jump under the click.
    if (!scroll) return;
    var sec = document.getElementById("fh-closer-focus");
    if (sec) {
      sec.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      var title = document.getElementById("fh-floor-focus-title");
      if (title) title.focus({ preventScroll: true });
    }
  }

  function paint(d) {
    state.data = d;
    paintSetterRoster(d);
    var onShift = (d.closers || []).filter(function (c) { return c.on_shift; }).length;
    var chip = $("header .hl .chip");
    if (chip) {
      chip.className = "chip on";
      chip.innerHTML = '<span class="cd"></span>' + onShift + " closers on shift";
    }

    var hero = d.hero || {};
    var today = d.today || {};
    var hl2s = document.querySelectorAll(".hero .hl2");
    if (hl2s[0]) hl2s[0].textContent = "Deposits today";
    var bigs = document.querySelectorAll(".hero .big");
    if (bigs[0]) {
      bigs[0].textContent = today.deposits != null ? String(today.deposits) : "—";
    }
    if (bigs[1]) bigs[1].textContent = pct(hero.deposit_to_funded);
    var dailyTarget = Number(today.target_deposits);
    var hasDailyTarget = Number.isFinite(dailyTarget) && dailyTarget > 0;
    var targetLabel = hasDailyTarget
      ? "Target " + dailyTarget + " deposit" + (dailyTarget === 1 ? "" : "s")
      : (today.target_reason || "No daily target");
    var subs = document.querySelectorAll(".hero .sub");
    if (subs[0]) {
      subs[0].textContent = "Booked " + (today.booked != null ? today.booked : "—") +
        " · Held " + (today.held != null ? today.held : "—") +
        " · " + targetLabel;
    }
    if (subs[1]) {
      var n = hero.deposit_to_funded_n || {};
      subs[1].textContent = (n.funded != null ? n.funded + " of " + n.deposits + " deposits funded" : "Of deposits taken this period");
    }
    var bar = $(".hero .bar i");
    var targetProgress = hasDailyTarget && today.deposits != null
      ? Math.max(0, Math.min(100, Number(today.deposits) / dailyTarget * 100))
      : 0;
    if (bar) bar.style.width = Math.round(targetProgress) + "%";
    var marks = document.querySelectorAll(".hero .marks span");
    if (marks[1]) marks[1].textContent = targetLabel;

    var funnel = d.funnel || {};
    var fs = document.querySelectorAll(".funnel .f");
    function fset(i, label, val, cv) {
      var el = fs[i]; if (!el) return;
      var lb = el.querySelector(".lb"); var vl = el.querySelector(".vl"); var c = el.querySelector(".cv");
      if (lb) lb.textContent = label;
      if (vl) vl.textContent = val;
      if (c) c.innerHTML = cv || "&nbsp;";
    }
    fset(0, "Booked", String(funnel.booked != null ? funnel.booked : "—"), "");
    fset(1, "Held", String(funnel.held != null ? funnel.held : "—"),
      funnel.show_rate != null ? ('<span class="' + (funnel.show_rate < 0.75 ? "dn" : "") + '">' + pct(funnel.show_rate) + " show</span>") : "");
    fset(2, "Deposits", String(funnel.deposits != null ? funnel.deposits : "—"),
      funnel.close_rate != null ? (pct(funnel.close_rate) + " of held") : "");
    fset(3, "Funded", String(funnel.funded != null ? funnel.funded : "—"),
      funnel.funded_of_deposits != null ? ('<span class="' + (funnel.funded_of_deposits < 0.7 ? "dn" : "") + '">' + pct(funnel.funded_of_deposits) + " of deposits</span>") : "");
    fset(4, "Downsells", String(funnel.downsells != null ? funnel.downsells : "—"),
      funnel.downsell_cash_display || money(funnel.downsell_cash_cents));

    var say = document.querySelector(".sec .say");
    if (say && funnel.deposits != null && funnel.funded != null) {
      var gap = funnel.deposits - funnel.funded;
      if (funnel.deposits === 0) {
        say.innerHTML = "<b>No deposits this month.</b> The funnel above is the month so far.";
      } else if (gap > 0) {
        say.innerHTML = "<b>Follow through on deposits.</b> " + gap +
          (gap === 1 ? " deposit still needs funding." : " deposits still need funding.");
      } else {
        say.innerHTML = "<b>Deposits are funding.</b> Keep pressure on show rate and belief spikes below.";
      }
    }

    // Roster
    var rost = $(".rost");
    if (rost) {
      var head = rost.querySelector(".rhead");
      var rows = (d.closers || []).map(function (c, i) {
        return '<div class="rrow pick" data-fh-closer="' + i + '" role="button" tabindex="0" ' +
          'title="Show this closer on their own">' +
          '<span class="nm"><b>' + esc(c.name || "Closer") + "</b><em>" +
          (c.on_shift ? ("On shift · " + elapsed(c.shift_elapsed_ms)) : "Off shift") +
          "</em></span>" +
          '<span class="num c2" data-label="Calls">' + (c.calls != null ? c.calls : "—") + "</span>" +
          '<span class="num" data-label="Close rate">' + pct(c.close_rate) + "</span>" +
          '<span class="num c4" data-label="Funded rate">' + pct(c.funded_rate) + "</span>" +
          '<span class="num c5" data-label="Cash">' + (c.cash_display || money(c.cash_cents)) + "</span>" +
          '<span class="act"><b>' + esc(c.action || "Nothing assigned") + "</b></span></div>";
      }).join("") || '<div class="rrow"><span class="nm"><b>No closers on this board</b><em>Live staff only</em></span></div>';
      rost.querySelectorAll(".rrow").forEach(function (n) { n.remove(); });
      if (head) head.insertAdjacentHTML("afterend", rows);
      // Delegated once — paint() rebuilds the rows but never the container.
      if (!rost.getAttribute("data-fh-pick")) {
        rost.setAttribute("data-fh-pick", "1");
        rost.addEventListener("click", function (e) {
          var row = e.target && e.target.closest && e.target.closest(".rrow.pick");
          if (row) selectCloser(Number(row.getAttribute("data-fh-closer")), true);
        });
        rost.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== " ") return;
          var row = e.target && e.target.closest && e.target.closest(".rrow.pick");
          if (!row) return;
          e.preventDefault();
          selectCloser(Number(row.getAttribute("data-fh-closer")), true);
        });
      }
    }

    paintOfferStack(d);
    paintCloserFocus();

    // Beliefs
    var beliefs = (d.beliefs && d.beliefs.beliefs) || [];
    var beliefPanel = null;
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (/belief failed/i.test(h.textContent || "")) beliefPanel = h.parentElement;
    });
    if (beliefPanel) {
      var max = Math.max(1, ...beliefs.map(function (b) { return b.this_count || 0 }));
      var html = beliefs.map(function (b) {
        var hot = (b.this_count || 0) > (b.last_count || 0) && (b.this_count || 0) >= 3;
        var w = Math.round(((b.this_count || 0) / max) * 100);
        return '<div class="ob"><div class="obt"><span>' + (b.label || b.belief) +
          "</span><em>" + (b.this_count || 0) + " · was " + (b.last_count || 0) +
          '</em></div><div class="obb' + (hot ? " hot" : "") + '"><i style="width:' + w + '%"></i></div></div>';
      }).join("") || '<p class="note">No objections logged this month. Objections recorded on calls will appear here.</p>';
      beliefPanel.querySelectorAll(".ob, .say, p.note").forEach(function (n) { n.remove(); });
      beliefPanel.insertAdjacentHTML("beforeend", html);
      beliefPanel.insertAdjacentHTML("beforeend",
        '<p class="say"><b>This period vs last period.</b> A count alone is not a trend — the second number is last period.</p>');
    }

    // Sources
    var sourcePanel = null;
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (/coming from/i.test(h.textContent || "")) sourcePanel = h.parentElement;
    });
    if (sourcePanel) {
      var sources = (d.beliefs && d.beliefs.sources) || [];
      var headHtml = '<div class="rhead">' +
        "<span>Source</span><span class=\"num\">Held</span><span class=\"num\">Close</span><span class=\"num\">Desire</span></div>";
      var rowsHtml = sources.slice(0, 8).map(function (s) {
        return '<div class="rrow">' +
          '<span class="nm"><b>' + (s.lead_source || "unknown") + "</b><em>setter " + (s.setter_key || "—") +
          "</em></span>" +
          '<span class="num">' + (s.held || 0) + "</span>" +
          '<span class="num">' + pct(s.close_rate) + "</span>" +
          '<span class="num">' + (s.desire || 0) + "</span></div>";
      }).join("") || '<p class="note">No source activity yet. Calls linked to a lead source will appear here.</p>';
      // Clear dynamic bits but keep flag button area rebuilt
      sourcePanel.querySelectorAll(".rhead, .rrow, .flagbox, button, p.note, p.say").forEach(function (n) {
        if (n.tagName === "H3") return;
        n.remove();
      });
      // Remove everything after h3
      while (sourcePanel.children.length > 1) sourcePanel.removeChild(sourcePanel.lastChild);
      sourcePanel.insertAdjacentHTML("beforeend", '<div class="source-table" role="region" aria-label="Lead sources" tabindex="0">' + headHtml + rowsHtml + "</div>");
      var beliefs = (d.beliefs && d.beliefs.beliefs) || [];
      var top = beliefs[0];
      var canFlag = top && top.belief && ((top.this_count || 0) > 0 || (top.last_count || 0) > 0);
      var flagLabel = canFlag ? ("Flag " + String(top.label || top.belief)) : "";
      sourcePanel.insertAdjacentHTML("beforeend",
        '<div class="flagbox" style="background:rgba(245,206,143,.14);border-left-color:var(--warn)">' +
        "<b>Flag a belief × source pattern for marketing review.</b> Nothing is sent externally.</div>" +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
        (canFlag
          ? '<button type="button" id="fh-flag-mkt" class="sf-primary"></button>'
          : "") +
        '<button type="button" id="fh-recordings-jump">Today\'s recordings</button>' +
        "</div>");
      var btn = $("#fh-flag-mkt");
      if (btn) {
        btn.textContent = flagLabel;
        btn.addEventListener("click", flagMarketing);
      }
      var jump = $("#fh-recordings-jump");
      if (jump) jump.addEventListener("click", function () {
        var el = document.getElementById("fh-recordings");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    // Today's recordings (Google Drive / Meet Record)
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/Today'?s recordings/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var rec = d.recordings || {};
      var items = rec.items || [];
      var rows = items.map(function (it) {
        var when = it.when ? new Date(it.when) : null;
        var whenLabel = when && !isNaN(when.getTime())
          ? (it.is_today ? "Today · " : "") + when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" })
          : (it.is_today ? "Today" : "This week");
        var who = it.client_name || (it.attached ? "Client" : "Not matched yet");
        var href = safeDriveUrl(it.url);
        var open = href
          ? '<a href="' + href + '" target="_blank" rel="noopener">Open in Drive</a>'
          : "<em>No link</em>";
        var words = it.has_words ? " · Words ready" : " · Waiting for words";
        var snippet = it.excerpt
          ? "<em>" + esc(String(it.excerpt).slice(0, 160)) + "</em>"
          : "";
        return '<div class="row"><span class="l"><b>' + (it.name || "Recording") +
          "</b><em>" + who + " · " + whenLabel + words + "</em>" + snippet +
          "</span><span class=\"r\">" + open + "</span></div>";
      }).join("");
      var note = items.length
        ? ""
        : '<p class="note">' + (rec.reason || "No Meet recordings in the last 7 days.") + "</p>";
      var refreshLabel = "Sync recordings from Drive";
      panel.innerHTML = "<h3>Today's recordings</h3>" + (rows || "") + note +
        '<div style="margin-top:12px"><button type="button" id="fh-drive-refresh">' +
        refreshLabel + "</button></div>";
      var refresh = panel.querySelector("#fh-drive-refresh");
      if (refresh) refresh.addEventListener("click", refreshDrive);
    });
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/Compliance/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var reason = (d.compliance && d.compliance.reason) ||
        "Call recording and transcription do not exist yet.";
      panel.innerHTML = "<h3>Compliance</h3><p class=\"note\">" + reason + "</p>";
    });

    // Cold deals
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/going cold/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var cold = d.cold_deals || [];
      var rows = cold.map(function (c) {
        return '<div class="row"><span class="l"><b>' + (c.name || "Client") +
          "</b><em>" + (c.detail || "") + '</em></span><span class="r">' +
          (c.quiet_days || "?") + "d</span></div>";
      }).join("") || '<p class="note">No cold deposits (7+ days quiet, not funded).</p>';
      panel.innerHTML = "<h3>Deals going cold</h3>" + rows;
    });

    // Discipline
    document.querySelectorAll(".panel h3").forEach(function (h) {
      if (!/Floor discipline/i.test(h.textContent || "")) return;
      var panel = h.parentElement;
      var disc = d.discipline || {};
      panel.innerHTML = "<h3>Floor discipline</h3>" +
        '<div class="row"><span class="l"><b>Calls not logged</b><em>Past-due closer tasks without a disposition</em></span>' +
        '<span class="r"><span class="chip ' + ((disc.unlogged_calls || 0) > 0 ? "bad" : "on") +
        '"><span class="cd"></span>' + (disc.unlogged_calls != null ? disc.unlogged_calls : "—") +
        "</span></span></div>" +
        '<div class="row"><span class="l"><b>Calls not recorded</b><em>Logged sales calls with no recording and no transcript</em></span>' +
        '<span class="r"><span class="chip ' + ((disc.unrecorded_calls || 0) > 0 ? "bad" : "on") +
        '"><span class="cd"></span>' + (disc.unrecorded_calls != null ? disc.unrecorded_calls : "—") +
        "</span></span></div>" +
        '<div class="row"><span class="l"><b>Shifts started late</b><em>' +
        (disc.shifts_detail && disc.shifts_detail.reason ? disc.shifts_detail.reason :
          (typeof disc.shifts_started_late === "number" ? "" : (disc.shifts_started_late === null ?
            "Scheduled shift times are not available." : ""))) +
        '</em></span><span class="r">—</span></div>' +
        '<div class="row"><span class="l"><b>Follow-ups overdue</b><em>' +
        (disc.followups_reason || "") + '</em></span><span class="r">—</span></div>' +
        '<div class="row"><span class="l"><b>Avg time to log after a call</b><em>' +
        (disc.avg_log_lag_reason || "") + '</em></span><span class="r">—</span></div>';
    });
  }

  async function flagMarketing() {
    var d = state.data;
    if (!d || !window.FHData) return;
    var beliefs = (d.beliefs && d.beliefs.beliefs) || [];
    var top = beliefs[0];
    var sources = (d.beliefs && d.beliefs.sources) || [];
    var src = sources[0];
    if (!top || !top.belief) {
      alert("No belief data to flag yet.");
      return;
    }
    var body = {
      belief: top.belief,
      lead_source: src && src.lead_source,
      setter_label: src && src.setter_key,
      outcome_count: top.this_count || 0,
      period_start: d.period && d.period.start,
      period_end: d.period && d.period.end,
      note: "Flagged from sales floor — " + (top.label || top.belief) +
        " this period " + (top.this_count || 0) + " vs last " + (top.last_count || 0)
    };
    var r = await window.FHData.write("/api/marketing-flags", body);
    if (!r.ok) {
      alert((r.error && (r.error.message || r.error)) || "Could not store flag");
      return;
    }
    alert("Stored for marketing routing. Nothing was sent externally.");
  }

  async function refreshDrive() {
    var btn = $("#fh-drive-refresh");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking Drive…";
    }
    if (!window.FHData) return;
    var r = await window.FHData.write("/api/company-brain/sync", {});
    if (!r.ok) {
      alert((r.error && (r.error.message || r.error)) || "Could not refresh Drive");
    } else if (r.data && r.data.reason === "not_configured") {
      alert("Google Drive is not connected yet. Recordings stay in Meet Recordings until Drive is turned on.");
    }
    await boot();
    // A failed reload retains the current panel, so release its sync control.
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.textContent = "Sync recordings from Drive";
    }
  }

  function loadState(kind, message) {
    var main = document.getElementById("fh-floor-main");
    var status = document.getElementById("fh-floor-status");
    var refresh = document.getElementById("fh-floor-refresh");
    if (main) {
      main.setAttribute("aria-busy", String(kind === "loading"));
      main.setAttribute("data-state", kind);
      main.classList.toggle("sf-no-data", !state.data);
    }
    if (refresh) {
      refresh.disabled = kind === "loading";
      refresh.textContent = kind === "loading" ? "Refreshing…" : "Refresh floor";
    }
    if (!status) return;
    status.hidden = kind === "ready";
    status.setAttribute("data-state", kind);
    status.removeAttribute("data-fh-gate");
    status.textContent = message || "";
    if (kind === "error") {
      status.setAttribute("data-fh-gate", "sales-floor");
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sf-button";
      retry.textContent = "Try again";
      retry.addEventListener("click", boot);
      status.appendChild(retry);
    }
  }

  async function boot() {
    if (state.loading) return;
    state.loading = true;
    loadState("loading", state.data ? "Refreshing sales floor…" : "Loading sales floor…");
    if (!window.FHData) {
      state.loading = false;
      loadState("error", "The sales floor could not start. Refresh the page to try again.");
      return;
    }
    var r = await window.FHData.read("sales-floor");
    state.loading = false;
    if (!r.ok) {
      var message = r.source === "unauthorized"
        ? "Forbidden — the sales floor is for sales managers and owners. Closers are refused."
        : "Could not load the sales floor. " + ((r.error && (r.error.message || r.error)) || "Try again in a moment.");
      if (state.data) message += " The last loaded numbers are still shown below.";
      loadState("error", message);
      return;
    }
    paint(r.data);
    loadState("ready");
  }

  var refreshFloor = document.getElementById("fh-floor-refresh");
  if (refreshFloor) refreshFloor.addEventListener("click", boot);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
