/* closer-call.js — wire Closer Dashboard's live-call tools to the fixed read + disposition POST. */
(function () {
  "use strict";

  var clientId = window.__FH_CLIENT_ID;
  var state = {
    outcome: null,
    belief: null,
    taskId: null,
    saving: false,
    data: null,
    offers: [],
    payWatch: null
  };

  function $(sel) { return document.querySelector(sel); }
  function text(el, v) { if (el) el.textContent = v == null || v === "" ? "—" : String(v); }
  function paintStaff(staff) {
    var staffName = (staff && staff.name) || "";
    var initials = staffName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join("") || "—";
    text(document.getElementById("whoAv"), initials);
    text(document.getElementById("whoName"), staffName);
    text(document.getElementById("whoRole"), (staff && staff.role) || "closer");
  }
  function loadSessionStaff() {
    return fetch("/api/auth/session", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (body) { if (body && body.ok) paintStaff(body.staff || {}); })
      .catch(function () {});
  }
  function money(cents) {
    if (cents == null || !Number.isFinite(Number(cents))) return "—";
    return (Number(cents) / 100).toLocaleString("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    });
  }
  /* A bare clock time is only true on today. upcomingCalls() keeps THIS
     client's tasks from `date_trunc('day', now())` onward, not from today
     only, so a deep link to somebody booked next Tuesday used to render a flat
     "2:00 PM" with nothing to say which day. The date goes on the front the
     moment the call is not today. */
  function whenText(iso, now) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    /* Arizona, like the topbar clock beside it — never the viewer's own zone
       (walkthrough-4 defect 14). "Today" is the Arizona day too. */
    var PHX = "America/Phoenix";
    var clock = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: PHX });
    var ref = now ? new Date(now) : new Date();
    var today = d.toLocaleDateString("en-US", { timeZone: PHX }) ===
      ref.toLocaleDateString("en-US", { timeZone: PHX });
    if (today) return clock;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: PHX }) + " " + clock;
  }
  /* "in 25m" / "35m ago" — the only place the back-to-back rhythm is said out
     loud. Never a bare number: a signed minute count with no word is unreadable
     at a glance mid-call. */
  function untilText(iso, now) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var mins = Math.round((d.getTime() - (now || Date.now())) / 60000);
    var abs = Math.abs(mins);
    var span = abs < 60 ? (abs + "m") : (Math.floor(abs / 60) + "h " + (abs % 60) + "m");
    if (mins > 1) return "in " + span;
    if (mins < -1) return span + " ago";
    return "now";
  }

  /* ONE primary control at a time (UI-STANDARDS §5). The screen used to paint
     Join filled and disabled at the same time, so its loudest element was a
     dead button. `k` is the filled style; this moves it, never duplicates it. */
  function setPrimary(id) {
    var ids = ["fh-join", "fh-present", "fh-send-contract", "fh-pay-link"];
    ids.forEach(function (candidate) {
      var el = document.getElementById(candidate);
      if (!el) return;
      if (candidate === id && !el.disabled) el.classList.add("k");
      else el.classList.remove("k");
    });
    var save = document.getElementById("fh-save-next");
    if (save) {
      if (id === "fh-save-next") save.classList.add("k");
      else save.classList.remove("k");
    }
  }

  function elapsed(ms) {
    if (!ms) return "";
    var m = Math.floor(ms / 60000);
    var h = Math.floor(m / 60);
    m = m % 60;
    return h ? (h + "h " + m + "m") : (m + "m");
  }

  /* PRESENT IS NOT A LIVE CONTROL ANY MORE (owner-set 2026-08-27).
     It used to be hidden until a call had loaded, so a closer could not open
     the deck to rehearse it, or to walk someone through it with no file on the
     screen. The owner asked for it to be there at all times. It is therefore
     absent from both functions below and is handled by wirePresent(). */
  function hideLiveControls() {
    var logbar = document.querySelector(".logbar");
    if (logbar) logbar.hidden = true;
    ["fh-send-contract", "fh-pay-link"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  function showLiveControls() {
    var logbar = document.querySelector(".logbar");
    if (logbar) logbar.hidden = false;
    ["fh-send-contract", "fh-pay-link"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = false;
    });
  }

  /* Reveals Present and attaches its click, once.

     WHY THIS RUNS FIRST, BEFORE ANYTHING ELSE IN boot(): every no-call path in
     boot returns early — no FHData, no current call, a failed cockpit read —
     and the old wiring sat AFTER all of them. So the moment the button stopped
     being hidden it would have been a dead control on exactly the screens the
     owner wants it on. UI-STANDARDS §5: every visible control works.

     The markup keeps its `hidden` attribute and this is what clears it, so the
     button is on the screen if and only if its handler is attached. It can
     never paint as a dead control because a later script failed.

     The client id is read at CLICK time rather than now, so a button wired
     before resolveClient() still opens the right deck once a call lands. With
     no client it opens present.html bare, which has its own gate for that. */
  function wirePresent() {
    var present = document.getElementById("fh-present");
    if (!present || present.getAttribute("data-fh-wired")) return;
    present.setAttribute("data-fh-wired", "1");
    present.hidden = false;
    present.addEventListener("click", function () {
      var id = window.__FH_CLIENT_ID || clientId;
      /* Written as two whole URLs rather than one concatenation on purpose:
         src/http/closer-deck-present.test.mjs greps this file for the literal
         "present.html?contact=" to prove the deck is still deep-linked, and a
         split string silently defeats it. It also just reads better. */
      var href = id
        ? "present.html?contact=" + encodeURIComponent(id)
        : "present.html";
      // New tab so the closer keeps the cockpit and can split-screen the deck.
      window.open(href, "_blank", "noopener,noreferrer");
    });
  }

  function setEmpty(reason, kind) {
    hideLiveControls();
    var h1 = document.getElementById("ccp-who-name");
    var meta = document.getElementById("ccp-who-meta");
    if (h1) h1.textContent = kind === "error" ? "Could not load" : "No call right now";
    if (meta) meta.textContent = reason || "No booked call right now.";
    var gone = ["fh-send-contract", "fh-contract-panel", "fh-pay-link", "fh-pay-panel"];
    gone.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    var when = document.getElementById("ccp-call-when");
    if (when) when.hidden = true;
    var note = document.getElementById("fh-money-note");
    if (note) { note.hidden = true; note.textContent = ""; }
  }

  /* THE TIME OF THIS CALL, beside the name.
     `current_call` is a real field on the payload (src/sales/cockpit.mjs) and is
     null when this client has no booked task — the screen used to infer it from
     the head of up_next, which on a deep link showed somebody else's time. */
  function paintWhen(data) {
    var el = document.getElementById("ccp-call-when");
    if (!el) return;
    var cur = data.current_call || null;
    var at = cur ? whenText(cur.due_at) : null;
    if (!at) {
      el.hidden = false;
      el.textContent = "no booked time";
      return;
    }
    var bits = [at];
    var rel = untilText(cur.due_at);
    if (rel) bits.push(rel);
    /* The gap to the call AFTER this one. THIS IS NOT READ OFF up_next.
       That array is ordered client-first, not by the clock, and is cut at five
       rows, so picking from it named a time four hours BEFORE this call, or
       skipped the closer's real next appointment, or said "nothing after this"
       over a call the LIMIT had dropped. next_call is the server's own
       one-row answer (src/sales/cockpit.mjs nextCallAfter). */
    var next = data.next_call || null;
    var nextAt = next ? whenText(next.due_at) : null;
    el.hidden = false;
    el.textContent = bits.join(" · ") + (nextAt ? "  ·  next " + nextAt : "  ·  nothing after this");
  }

  /* The four ad lines: gate / entry / primary / secondary. One read of
     /api/read/ad-attribution after the cockpit paints. Hidden until it
     answers, and left hidden when it cannot, so the closer never reads a
     guess. The wording is the owner's rule, said once here:
     Direct = sell what they were promised. Sorting = lead with the primary
     if there is one; every road is open. */
  var OFFER_WORDS = {
    funding_dfy: "Funding, done-for-you",
    credit_optimization: "Credit optimization",
    capital_blueprint: "Capital Blueprint",
    capital_academy: "Capital Academy",
    white_label: "White-label partner",
    none: "None"
  };
  function offerWord(k) { return OFFER_WORDS[k] || k; }
  function paintAd(cid) {
    var box = document.getElementById("ccp-ad");
    if (!box || !cid || !window.FHData) return;
    window.FHData.read("ad-attribution", { client_id: cid }).then(function (r) {
      var v = r && r.ok && r.data && r.data.resolved;
      if (!v) { box.hidden = true; return; }
      var known = r.data.registry && r.data.registry.known;
      var adId = r.data.attribution && r.data.attribution.ad_id;
      text(document.getElementById("ccp-ad-gate"), v.gate === "none" ? "No FICO gate" : v.gate + "+");
      text(document.getElementById("ccp-ad-entry"), v.entry === "direct"
        ? "Direct \u00b7 sell what they were promised"
        : "Sorting \u00b7 every road is open" + (adId && !known ? " (ad " + adId + " not in the registry)" : (adId ? "" : " (no ad on file)")));
      text(document.getElementById("ccp-ad-primary"), offerWord(v.primary_offer) +
        (v.entry === "sorting" && v.primary_offer !== "none" ? " \u00b7 lead with it" : ""));
      var sec = v.secondary_offers === "all" ? "All" :
        (v.secondary_offers && v.secondary_offers.length ? v.secondary_offers.map(offerWord).join(", ") : "None");
      text(document.getElementById("ccp-ad-secondary"), sec);
      box.hidden = false;
    });
  }

  function paint(data) {
    state.data = data;
    var staff = data.staff || {};
    var client = data.client || {};
    var credit = data.credit || {};
    var precall = data.precall || {};
    var deal = data.deal || {};

    text($("[data-fh-call-head] .eyebrow"), "Live call");
    var shiftChip = $("[data-fh-call-head] .chip");
    if (shiftChip) {
      if (staff.shift && staff.shift.on_shift) {
        shiftChip.className = "chip on";
        shiftChip.innerHTML = '<span class="cd"></span>On shift · ' + elapsed(staff.shift.elapsed_ms);
      } else {
        shiftChip.className = "chip";
        shiftChip.innerHTML = '<span class="cd"></span>' + (staff.shift && staff.shift.reason ? staff.shift.reason : "Off shift");
      }
    }
    var nameChip = $("[data-fh-call-staff]");
    if (nameChip) nameChip.innerHTML = '<span class="cd" style="background:var(--info)"></span>' + (staff.name || "Closer");
    paintStaff(staff);

    text($(".who h1"), client.name);
    paintWhen(data);
    state.offers = Array.isArray(data.offers) ? data.offers : [];
    var meta = client.business_name || "";
    if (client.age_months != null) meta += (meta ? " · " : "") + client.age_months + " mo in business";
    if (client.pipeline) meta += (meta ? " · " : "") + (client.pipeline.stage_name || client.pipeline.stage_key);
    text($(".who .meta"), meta || "—");
    var calcClient = document.getElementById("calcClientName");
    if (calcClient) {
      text(calcClient, client.name);
      calcClient.hidden = false;
    }
    /* The topbar subtitle is NOT rewritten with the client's name any more.
       It duplicated the 32px h1 four inches below it, it had no truncation, and
       in a bar that already carries eight things it is what pushed the screen's
       own name into an ellipsis at 1440px. UI-STANDARDS §12.8. */

    // Funding bands come from this same canonical cockpit payload.
    var bands = document.querySelectorAll(".bands .band");
    bands.forEach(function (b) {
      var bv = b.querySelector(".bv");
      var bn = b.querySelector(".bn");
      if (bv) bv.textContent = "—";
      if (bn) bn.textContent = "Waiting on UnderwriteIQ";
    });
    var lever = $(".lever");
    if (lever) {
      /* F10, owner-set: no credit pull on file, no lender count. Not 307, not
         zero, not any number. This line used to read "307 lenders match this
         file" three rows under "No credit pull on file yet", on a screen a
         closer reads out loud. The server now sends matched_lenders null with
         the reason why, and the reason is what shows. */
      var uw = data.underwrite || {};
      var n = uw.matched_lenders;
      lever.textContent = (n == null)
        ? (uw.lenders_reason || "Funding bands stay a dash until the report has a number.")
        : (n === 0
          ? "No lenders match this file yet."
          : n + " lender" + (n === 1 ? "" : "s") + " match this file.");
    }
    paintUnderwrite(data.underwrite || {}, credit);

    // Credit panel
    var tables = document.querySelectorAll(".panel table");
    if (tables[0]) {
      if (!credit.available) {
        tables[0].innerHTML = "<tr><td colspan='2'>" + (credit.reason || "No credit pull") + "</td></tr>";
      } else {
        var rows = "";
        if (credit.scores && typeof credit.scores === "object") {
          var ex = credit.scores.experian != null ? credit.scores.experian : credit.scores.EX;
          var eq = credit.scores.equifax != null ? credit.scores.equifax : credit.scores.EQ;
          var tu = credit.scores.transunion != null ? credit.scores.transunion : credit.scores.TU;
          if (ex != null || eq != null || tu != null) {
            rows += "<tr><td>Scores</td><td class='hi'>EX " + (ex == null ? "—" : ex) +
              " · EQ " + (eq == null ? "—" : eq) +
              " · TU " + (tu == null ? "—" : tu) + "</td></tr>";
            /* A sample report says it is a sample (live hole 23). */
            if (credit.sample === true) {
              rows += "<tr><td>Sample</td><td>Sample scores. Not a real credit pull.</td></tr>";
            }
          } else {
            rows += "<tr><td>Scores</td><td class='hi'>—</td></tr>";
          }
        } else {
          rows += "<tr><td>Scores</td><td class='hi'>—</td></tr>";
        }
        rows += "<tr><td>Utilization</td><td>" + (credit.utilization != null ? credit.utilization + "%" : "—") + "</td></tr>";
        rows += "<tr><td>Inquiries · 6mo</td><td>" + (credit.inquiries_6mo != null ? credit.inquiries_6mo : "—") + "</td></tr>";
        rows += "<tr><td>Derogatories</td><td>" + (credit.derogatories != null ? credit.derogatories : "—") + "</td></tr>";
        rows += "<tr><td>" + (credit.sample === true ? "Sample report loaded" : "Pulled") + "</td><td>" + (credit.pulled_at ? new Date(credit.pulled_at).toLocaleString("en-US", { timeZone: "America/Phoenix" }) : "—") + "</td></tr>";
        tables[0].innerHTML = rows;
      }
    }
    if (tables[1]) {
      /* The transaction id is deliberately NOT kept. It used to be stored here
         and posted with the outcome, and buildCockpit's payment query has no
         time bound — so a repeat client who paid four months ago had that old
         payment attached to today's call, and the closer's cash was logged as
         the old amount. The server resolves the payment itself inside its own
         48-hour window (src/sales/call-outcomes.mjs resolveCashCollected). */
      var pay = deal.latest_payment;
      var paidWhen = pay && pay.created_at ? new Date(pay.created_at) : null;
      var paidLabel = paidWhen && !isNaN(paidWhen.getTime())
        ? paidWhen.toLocaleDateString("en-US", { timeZone: "America/Phoenix" }) : null;
      /* A fraction on the payload (0.10 = 10%), and "default" is said out loud
         where no closeout row exists yet — the screen used to print a flat 10%
         whatever the file held. */
      var feePct = deal.success_fee_percent;
      var feeText = feePct == null || !Number.isFinite(Number(feePct))
        ? "—"
        : (Math.round(Number(feePct) * 1000) / 10) + "%" +
          (deal.success_fee_source === "default" ? " · default" : "");
      tables[1].innerHTML =
        "<tr><td>Latest payment on file</td><td class='hi'>" + (pay ? pay.amount_display : "—") + "</td></tr>" +
        "<tr><td>Paid on</td><td>" + (paidLabel || "—") + "</td></tr>" +
        "<tr><td>Product</td><td>" + (pay && pay.product_name ? pay.product_name : "—") + "</td></tr>" +
        "<tr><td>Success fee</td><td>" + feeText + "</td></tr>" +
        "<tr><td colspan='2' style='text-align:left;color:var(--gray)'>" + (deal.success_fee_note || "") + "</td></tr>";
    }

    // Precall
    var ctx = $(".ctx");
    if (ctx) {
      var h3 = ctx.querySelector("h3");
      if (h3) h3.textContent = (precall.conversation_count || 0) + " messages on file";
      var p = ctx.querySelector("p");
      if (p) p.textContent = precall.summary || "No conversation summary on file yet.";
      var cells = ctx.querySelectorAll(".ctxg div b");
      if (cells[0]) cells[0].textContent = precall.wants != null ? String(precall.wants) : "—";
      if (cells[1]) cells[1].textContent = precall.purpose || "—";
      if (cells[2]) cells[2].textContent = precall.guessed_fico || "—";
      if (cells[3]) cells[3].textContent = precall.last_message_at
        ? new Date(precall.last_message_at).toLocaleString("en-US", { timeZone: "America/Phoenix" }) : "—";
      var flag = ctx.querySelector(".flag");
      if (flag) {
        flag.textContent = precall.lead_source
          ? ("Lead source: " + precall.lead_source + (precall.setter_key ? " · setter " + precall.setter_key : ""))
          : "Lead source not on file.";
      }
    }

    // Up next
    var upNextSection = document.querySelector("aside.rail [data-fh-up-next], aside.rail section[data-fh-up-next]");
    if (upNextSection) {
      var next = (data.up_next || []).map(function (u) {
        var t = u.due_at ? new Date(u.due_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }) : "—";
        return '<div class="q"><span class="t">' + t + "</span><div><b>" + (u.name || "Client") +
          "</b><em>" + (u.title || "") + "</em></div></div>";
      }).join("") || '<div class="q"><span class="t">—</span><div><b>No upcoming booked calls</b><em>Calendar tasks with due times will show here</em></div></div>';
      upNextSection.querySelectorAll(".q").forEach(function (n) { n.remove(); });
      upNextSection.insertAdjacentHTML("beforeend", next);
    }

    // Remap objection row to seven beliefs
    var logrows = document.querySelectorAll(".logbar .logrow");
    if (logrows[1]) {
      logrows[1].innerHTML =
        '<span class="lbl">Belief failed</span>' +
        ["pain", "doubt", "cost", "desire", "money", "support", "trust"].map(function (b) {
          return '<button type="button" data-belief="' + b + '">' + b + "</button>";
        }).join("") +
        '<button type="button" data-belief="none">None</button>';
    }
    // Outcome hotkeys
    var outcomes = ["deposit", "downsell", "callback", "no_show", "not_a_fit"];
    var labels = ["Deposit", "Downsell", "Callback", "No show", "Not a fit"];
    if (logrows[0]) {
      logrows[0].innerHTML = '<span class="lbl">Outcome</span>' +
        outcomes.map(function (o, i) {
          return '<button type="button" data-outcome="' + o + '"><span class="hk">' + (i + 1) +
            "</span>" + labels[i] + "</button>";
        }).join("");
    }
    if (logrows.length < 3) {
      var extra = document.createElement("div");
      extra.className = "logrow";
      extra.innerHTML = '<span class="lbl">Repair referral</span>' +
        '<label for="fh-repair-referral"><input type="checkbox" id="fh-repair-referral"> Yes — send to credit repair</label>';
      var logbar = document.querySelector(".logbar");
      var footEl = logbar && logbar.querySelector(".foot");
      if (logbar && footEl) logbar.insertBefore(extra, footEl);
      else if (logbar) logbar.appendChild(extra);
    }
    var foot = $(".logbar .foot");
    if (foot) {
      foot.innerHTML = "<span>Cash comes from the payment record — never typed. Recording/transcript not available yet.</span>" +
        '<button class="k" type="button" id="fh-save-next">Save · next call</button>';
    }

    wireDisposition();
    loadSaid();
  }

  function paintSaid(words) {
    var said = String(words || "").trim();
    if (!said) return;
    var ctx = $(".ctx");
    if (ctx) {
      var el = ctx.querySelector("[data-fh-said]");
      if (!el) {
        el = document.createElement("p");
        el.setAttribute("data-fh-said", "");
        ctx.appendChild(el);
      }
      el.textContent = "said: " + said;
    }
    var note = $(".logbar .foot span");
    if (note) note.textContent = "Cash comes from the payment record — never typed.";
  }

  function loadSaid() {
    if (!window.FHData || !clientId) return;
    FHData.read("agent-context", { client_id: clientId }).then(function (res) {
      var block = res && res.data && res.data.context && res.data.context.as_prompt_block;
      if (!block) return;
      var idx = String(block).indexOf("said:");
      if (idx < 0) return;
      paintSaid(String(block).slice(idx).split("\n")[0].replace(/^said:\s*/, ""));
    });
  }

  function wireDisposition() {
    document.querySelectorAll("[data-outcome]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.outcome = btn.getAttribute("data-outcome");
        document.querySelectorAll("[data-outcome]").forEach(function (b) { b.classList.remove("k"); });
        btn.classList.add("k");
      });
    });
    document.querySelectorAll("[data-belief]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.belief = btn.getAttribute("data-belief");
        document.querySelectorAll("[data-belief]").forEach(function (b) { b.classList.remove("k"); });
        btn.classList.add("k");
      });
    });
    var save = $("#fh-save-next");
    if (save) save.addEventListener("click", saveOutcome);
    document.addEventListener("keydown", function (ev) {
      if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
      var n = Number(ev.key);
      if (n >= 1 && n <= 5) {
        var btn = document.querySelector('[data-outcome]')
          ? document.querySelectorAll("[data-outcome]")[n - 1] : null;
        if (btn) btn.click();
      }
    });
  }

  function wireContractSend() {
    var btn = document.getElementById("fh-send-contract");
    var panel = document.getElementById("fh-contract-panel");
    var sel = document.getElementById("fh-contract-tpl");
    var blanks = document.getElementById("fh-contract-blanks");
    var go = document.getElementById("fh-contract-go");
    var copy = document.getElementById("fh-contract-copy");
    var link = document.getElementById("fh-contract-link");
    var msg = document.getElementById("fh-contract-msg");
    if (!btn || !panel) return;
    if (!clientId) {
      btn.remove();
      panel.remove();
      return;
    }
    var wordings = [];
    var lastLink = "";
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function setMsg(t) { if (msg) msg.textContent = t || ""; }

    function selected() {
      var id = sel && sel.value;
      for (var i = 0; i < wordings.length; i++) if (wordings[i].id === id) return wordings[i];
      return null;
    }

    function paintBlanks() {
      if (!blanks) return;
      var t = selected();
      var fields = (t && t.manual_fields) || [];
      if (!fields.length) { blanks.innerHTML = ""; return; }
      blanks.innerHTML = fields.map(function (f) {
        return '<div class="sp-field"><label for="fh-blank-' + esc(f.key) + '">' +
          esc(f.label || f.key) + (f.required ? " *" : "") + "</label>" +
          '<input id="fh-blank-' + esc(f.key) + '" data-blank="' + esc(f.key) + '" type="text"></div>';
      }).join("");
      if (window.FHContractSend && window.FHContractSend.fillBlankInputs) {
        var picked = selected();
        window.FHContractSend.fillBlankInputs(
          window.FHContractSend.defaultBlankValues
            ? window.FHContractSend.defaultBlankValues(picked && picked.template_key)
            : { company_name: "Fundhub", company_email: "support@fundhub.ai", consent_days: "90" }
        );
      }
    }

    function blankValues() {
      var out = {};
      if (!blanks) return out;
      Array.prototype.forEach.call(blanks.querySelectorAll("[data-blank]"), function (el) {
        out[el.getAttribute("data-blank")] = el.value;
      });
      return out;
    }

    function fillSelect(items) {
      wordings = items || [];
      if (!sel) return;
      if (!wordings.length) {
        sel.innerHTML = '<option value="">No wordings in use</option>';
        return;
      }
      sel.innerHTML = wordings.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name || t.template_key || "Wording") + "</option>";
      }).join("");
      paintBlanks();
    }

    btn.addEventListener("click", function () {
      var open = panel.hasAttribute("hidden");
      if (!open) { panel.setAttribute("hidden", ""); return; }
      panel.removeAttribute("hidden");
      setMsg("Loading wordings…");
      if (!window.FHContractSend) { setMsg("Send helper failed to load."); return; }
      window.FHContractSend.listWordings().then(function (r) {
        if (!r.ok) { setMsg(r.error || "Could not load wordings."); return; }
        fillSelect(r.items);
        setMsg(r.items.length ? "Pick a wording, then Send. Copy the link after." : "No wordings in use. Make one on the Contracts page.");
      });
    });
    if (sel) sel.addEventListener("change", paintBlanks);
    if (go) go.addEventListener("click", function () {
      var t = selected();
      if (!t) { setMsg("Pick a wording first."); return; }
      go.disabled = true;
      setMsg("Sending…");
      var values = blankValues();
      var defaults = window.FHContractSend.defaultBlankValues
        ? window.FHContractSend.defaultBlankValues(t.template_key)
        : {};
      Object.keys(defaults).forEach(function (k) {
        if (values[k] == null || values[k] === "") values[k] = defaults[k];
      });
      window.FHContractSend.sendToClient({
        clientId: clientId, templateId: t.id, values: values
      }).then(function (r) {
        go.disabled = false;
        if (!r.ok) { setMsg(r.error || "Could not send."); return; }
        lastLink = r.link || "";
        if (link) {
          link.value = lastLink;
          link.hidden = !lastLink;
        }
        if (copy) copy.disabled = !lastLink;
        setMsg(r.message || "Sent. Copy the link and give it to them.");
        setPrimary("fh-pay-link");
        if (lastLink) window.FHContractSend.copyText(lastLink);
      });
    });
    if (copy) copy.addEventListener("click", function () {
      if (!lastLink) return;
      window.FHContractSend.copyText(lastLink).then(function (ok) {
        copy.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(function () { copy.textContent = "Copy link"; }, 1400);
      });
    });
  }

  /* -------------------------------------------------------------------------
     THE PAY LINK, ON THIS SCREEN.

     Taking money used to mean leaving this tab, opening the 24-slide deck and
     paging to slide 23. This is the SAME write the deck does - POST
     /api/closer-deck {action:"send_pay_link"} - so there is one send path, not
     two, and no new endpoint. Offers ride on the one fixed closer-call read.

     COMPLIANCE REVIEW REQUIRED - this control mints a payment link.
     ------------------------------------------------------------------------- */
  var PRIMARY_PAY_OFFERS = ["FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"];

  function wirePayLink() {
    var btn = document.getElementById("fh-pay-link");
    var panel = document.getElementById("fh-pay-panel");
    var sel = document.getElementById("fh-pay-offer");
    var motionField = document.getElementById("fh-pay-motion-field");
    var motion = document.getElementById("fh-pay-motion");
    var go = document.getElementById("fh-pay-go");
    var msg = document.getElementById("fh-pay-msg");
    if (!btn || !panel || !sel || !go) return;
    if (!clientId) { btn.remove(); panel.remove(); return; }

    function setMsg(t) { if (msg) msg.textContent = t || ""; }
    function esc(v) {
      return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function paintMotion() {
      if (!motionField) return;
      /* The server refuses an alternate-ladder link without a motion
         (src/sales/closer-deck.mjs). Asking here beats a 400 mid-call. */
      motionField.hidden = PRIMARY_PAY_OFFERS.indexOf(sel.value) !== -1;
    }

    var offers = state.offers || [];
    if (!offers.length) {
      sel.innerHTML = '<option value="">No offers in the catalog</option>';
      go.disabled = true;
      setMsg("No offers came back with this call, so no link can be made.");
    } else {
      sel.innerHTML = offers.map(function (o) {
        return '<option value="' + esc(o.key) + '">' + esc(o.name) +
          (o.priceDisplay ? " \u00b7 " + esc(o.priceDisplay) : "") + "</option>";
      }).join("");
      paintMotion();
    }
    sel.addEventListener("change", paintMotion);

    btn.hidden = false;
    btn.addEventListener("click", function () {
      if (!panel.hasAttribute("hidden")) { panel.setAttribute("hidden", ""); return; }
      panel.removeAttribute("hidden");
      setMsg("Pick the offer, then send. They get it by email and text.");
    });

    go.addEventListener("click", async function () {
      var key = sel.value;
      if (!key) { setMsg("Pick an offer first."); return; }
      if (motionField && !motionField.hidden && !(motion && motion.value)) {
        setMsg("Choose downsell or upsell for this offer.");
        return;
      }
      go.disabled = true;
      setMsg("Sending\u2026");
      var r = await window.FHData.write("/api/closer-deck", {
        action: "send_pay_link",
        client_id: clientId,
        offer_key: key,
        sale_motion: (motionField && motionField.hidden) ? null : (motion ? motion.value : null)
      });
      go.disabled = false;
      if (!r.ok) {
        setMsg((r.error && (r.error.message || r.error)) || "Could not send the pay link.");
        return;
      }
      setMsg("Sent. Stay on the call until it posts.");
      watchForPayment();
    });
  }

  /* -------------------------------------------------------------------------
     MOVE WITH THE CALL.

     The rhythm is: send the link, keep them on the line, watch it land. The
     screen read its data once at boot and then could not tell the closer
     anything, so they sat looking at a page that had stopped listening.

     This re-reads the SAME fixed read (GET /api/read/closer-call) - no second
     client read, so the merge spec's one-data-path rule still holds. It is
     bounded on purpose: every 20 seconds, at most 5 minutes, and it stops the
     moment a payment that was not there before appears.
     ------------------------------------------------------------------------- */
  function payNote(cls, words) {
    var el = document.getElementById("fh-money-note");
    if (!el) return;
    el.className = "money-note" + (cls ? " " + cls : "");
    el.textContent = words;
    el.hidden = false;
  }

  function watchForPayment() {
    if (state.payWatch || !clientId || !window.FHData) return;
    var before = state.data && state.data.deal && state.data.deal.latest_payment;
    var beforeId = before ? before.transaction_id : null;
    var tries = 0;
    payNote("watching", "Watching for the payment. This checks every 20 seconds.");
    state.payWatch = setInterval(async function () {
      tries += 1;
      if (tries > 15) {
        clearInterval(state.payWatch);
        state.payWatch = null;
        payNote("", "No payment yet after 5 minutes. Reload the page to check again.");
        return;
      }
      var r = await window.FHData.read("closer-call", { client_id: clientId });
      if (!r || !r.ok) return;
      var now = r.data && r.data.deal && r.data.deal.latest_payment;
      if (!now || (beforeId && now.transaction_id === beforeId)) return;
      clearInterval(state.payWatch);
      state.payWatch = null;
      payNote("posted", "Payment posted \u00b7 " + (now.amount_display || "amount on file") +
        (now.product_name ? " \u00b7 " + now.product_name : ""));
      paint(r.data);
      /* The money is in. The next thing they do is log it and take the next
         call, so that is what the one primary button becomes. */
      setPrimary("fh-save-next");
    }, 20000);
  }

  async function saveOutcome() {
    if (state.saving) return;
    if (!clientId) { alert("No client on this call."); return; }
    if (!state.outcome) { alert("Pick an outcome (keys 1–5) before the next call."); return; }
    state.saving = true;
    try {
      var body = {
        client_id: clientId,
        outcome: state.outcome,
        belief_failed: state.belief === "none" ? null : state.belief,
        task_id: state.taskId,
        /* transaction_id is deliberately absent. See the note in paint(): the
           server picks the payment inside its own 48-hour window, which is what
           "money from this call" means. Sending an id from here bypassed it. */
        checklist: {
          call_recorded: !!(document.getElementById("d1") && document.getElementById("d1").checked),
          personal_guarantee: !!(document.getElementById("d2") && document.getElementById("d2").checked),
          month_14_cliff: !!(document.getElementById("d3") && document.getElementById("d3").checked),
          bank_decides: !!(document.getElementById("d4") && document.getElementById("d4").checked),
          incorporation_verified: !!(document.getElementById("d5") && document.getElementById("d5").checked)
        },
        repair_referral: !!(document.getElementById("fh-repair-referral") && document.getElementById("fh-repair-referral").checked)
      };
      var r = await window.FHData.write("/api/call-outcomes", body);
      if (!r.ok) {
        alert((r.error && r.error.message) || r.error || "Could not save outcome");
        return;
      }
      try { sessionStorage.removeItem("fh_pending_disposition"); } catch (e) {}
      var next = (state.data && state.data.up_next && state.data.up_next[0]);
      if (next && next.client_id) {
        location.href = "closer-dashboard.html?client_id=" + encodeURIComponent(next.client_id) +
          (next.task_id ? "&task_id=" + encodeURIComponent(next.task_id) : "");
      } else {
        location.href = "my-numbers.html";
      }
    } finally {
      state.saving = false;
    }
  }

  /* THE THREE MONEY BANDS — the biggest numbers on the screen.
     ZERO IS NOT UNKNOWN. The engine returns total_personal_funding and
     total_combined_funding as the NUMBER 0 when it has nothing to work with
     (src/underwrite/vendor/underwriter.cjs, src/underwrite/business-funding.mjs),
     never null. money() treated 0 as a real figure, so a client with no credit
     pull showed "Realistic $0 · After optimization $0" and a closer read that as
     "this person can get nothing." It meant "nobody has pulled their credit."
     CLAUDE.md §12: NULL means unknown and must survive.

     Three states, kept apart, and the third one is said in words rather than as
     a bare $0 so it can never be mistaken for the second:
       no pull on file            → dash + the reason
       pull on file, engine blank → dash + "not in the answer"
       pull on file, computes 0   → "None yet" + why */
  function paintUnderwrite(uw, credit) {
    var bands = document.querySelectorAll(".bands .band");
    var personal = uw.personal || {};
    var totals = uw.totals || {};
    var pullOnFile = !!(credit && credit.available);
    var noPullReason = (credit && credit.reason && !/crs_results|row|table|column/i.test(credit.reason))
      ? credit.reason
      : "No credit pull on file yet";
    function dollarsToCents(v) {
      if (v == null || !Number.isFinite(Number(v))) return null;
      return Math.round(Number(v) * 100);
    }
    var cons = dollarsToCents(uw.lite_banner_funding);
    var realDollars = totals.total_personal_funding != null
      ? totals.total_personal_funding
      : personal.total_personal_funding;
    var real = dollarsToCents(realDollars);
    /* No fallback to the realistic figure. The old one printed the SAME number
       under two different labels, one of which was then wrong. */
    var opt = dollarsToCents(totals.total_combined_funding);
    function setBand(i, cents, note) {
      var b = bands[i];
      if (!b) return;
      var bv = b.querySelector(".bv");
      var bn = b.querySelector(".bn");
      var value, reason;
      if (!pullOnFile) {
        value = "—";
        reason = noPullReason;
      } else if (cents == null) {
        value = "—";
        reason = "Not in the UnderwriteIQ answer";
      } else if (cents === 0) {
        value = "None yet";
        reason = "Pull is on file — the report finds nothing fundable";
      } else {
        value = money(cents);
        reason = note;
      }
      if (bv) bv.textContent = value;
      if (bn) bn.textContent = reason;
    }
    setBand(0, cons, "Conservative");
    setBand(1, real, "Realistic · round 1");
    /* Label matches the arithmetic. total_combined_funding is personal funding
       PLUS business stacking (src/underwrite/business-funding.mjs) — it is not
       the engine's own `optimization` block, which this screen never reads.
       "After optimization" over that sum was a wrong label on a real number. */
    setBand(2, opt, "Personal + business stacked");
  }

  async function resolveClient() {
    if (clientId) return clientId;
    var nowR = await window.FHData.read("closer-now");
    if (!nowR.ok) {
      window.FHData.explain(nowR, "the next call");
      setEmpty("The bar along the bottom of the screen says why.", "error");
      return null;
    }
    var cur = nowR.data && nowR.data.current;
    if (!cur || !cur.client_id) {
      setEmpty("No booked call right now.");
      return null;
    }
    clientId = cur.client_id;
    window.__FH_CLIENT_ID = clientId;
    if (cur.task_id && !state.taskId) state.taskId = cur.task_id;
    return clientId;
  }

  async function boot() {
    wirePresent();
    if (!window.FHData) { setEmpty("data.js failed to load", "error"); return; }
    loadSessionStaff();
    hideLiveControls();
    var q = new URLSearchParams(location.search);
    state.taskId = q.get("task_id") || null;
    var who = await resolveClient();
    if (!who) return;
    try { sessionStorage.setItem("fh_pending_disposition", clientId); } catch (e) {}

    var r = await window.FHData.read("closer-call", { client_id: clientId });
    if (!r.ok) {
      /* FHData.explain is the house wording for a failed read - one sentence,
         written once, for all nineteen screens. The old line pasted the read's
         internal source name straight into the closer's field of view: a word
         they do not know, attached to a system they cannot check. */
      window.FHData.explain(r, "this call");
      setEmpty("The bar along the bottom of the screen says why.", "error");
      return;
    }
    paint(r.data);
    showLiveControls();
    paintAd(clientId);

    var join = document.getElementById("fh-join");
    var hasJoinUrl = false;
    if (join) {
      var url = (r.data && r.data.join_url) || "";
      if (url) {
        hasJoinUrl = true;
        join.disabled = false;
        join.removeAttribute("title");
        join.addEventListener("click", function () {
          /* The call has started, so the next thing they will reach for is the
             money, not this button. */
          setPrimary("fh-pay-link");
          window.open(url, "_blank", "noopener");
        });
      } else {
        join.disabled = true;
        join.title = "No call link on this appointment";
      }
    }
    wireContractSend();
    wirePayLink();
    /* One filled button, and it is never a disabled one. With no meeting link
       on the appointment the loudest thing on the screen used to be a grey
       Join button that could not be pressed. */
    setPrimary(hasJoinUrl ? "fh-join" : "fh-pay-link");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
