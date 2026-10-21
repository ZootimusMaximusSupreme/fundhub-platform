/* Affiliate payouts tab on products-commissions.html (495).
 *
 * Reads GET /api/read/affiliate-payouts; acts through POST /api/affiliates/payouts.
 * Finance staff only (owner, admin, sales manager): the tab stays hidden for
 * anyone else, and both doors refuse them anyway.
 * Flow: docs/journeys/affiliate-payout-flow.md.
 */
(function () {
  "use strict";
  var FINANCE = { owner: 1, admin: 1, sales_manager: 1 };
  var STATUS_WORDS = { pending: "Ready to pay", held: "Held", processing: "Sending", paid: "Paid", void: "Cancelled" };
  var HOLD_WORDS = { partner_license_unsigned: "partner license not signed", tax_form_missing: "no tax form on file", no_bank_linked: "affiliate has not linked a bank" };
  var current = null;

  function $(id) { return document.getElementById(id); }
  function token() { try { return localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function usd(n) { return n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function day(v) {
    if (!v) return "—";
    var d = new Date(String(v).length === 10 ? v + "T12:00:00Z" : v);
    return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function month(v) {
    if (!v) return "—";
    var d = new Date(v);
    return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  function say(text, bad) {
    var m = $("apMsg"); if (!m) return;
    m.hidden = !text; m.textContent = text || "";
    m.style.color = bad ? "var(--alert)" : "";
  }
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || "GET",
      headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer " + token() },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "The server did not answer." }; })
        .then(function (b) { b.httpStatus = r.status; return b; });
    }).catch(function () { return { ok: false, error: "No connection. Check the internet and try again." }; });
  }

  function railLine(rail) {
    if (!rail) return "";
    if (rail.live) return "Payouts go out by themselves through Plaid as soon as the client's payment clears.";
    if (rail.environment === "sandbox") return "Plaid is on test money, so only test affiliates are paid by themselves. Pay real affiliates by hand and use Mark paid until Plaid gives live access.";
    return "Plaid payouts are off. Pay by hand and use Mark paid.";
  }

  function actionsFor(p) {
    var b = [];
    var plaidOk = p.status === "pending" && p.bank && p.gates.license && p.gates.tax;
    if (p.status === "pending") {
      if (plaidOk) b.push('<button class="btn sm dark mono" data-act="send" style="min-height:44px">Send now</button>');
      b.push('<button class="btn sm mono" data-act="mark_paid" style="min-height:44px">Mark paid…</button>');
      b.push('<button class="btn sm mono" data-act="hold" style="min-height:44px">Hold…</button>');
    }
    if (p.status === "held") b.push('<button class="btn sm mono" data-act="release" style="min-height:44px">Release</button>');
    if (p.status === "pending" || p.status === "held") b.push('<button class="btn sm mono" data-act="void" style="min-height:44px;margin-left:12px">Cancel…</button>');
    return b.join(" ");
  }

  function render(view) {
    current = view;
    var rows = (view && view.payouts) || [];
    var c = (view && view.counts) || {};
    $("apSummary").textContent = (c.pending || 0) + " ready · " + (c.held || 0) + " held · " + (c.processing || 0) + " sending";
    $("apHint").textContent = (c.overdue ? c.overdue + " past the due day. " : "Nothing past the due day. ") + "Paid as soon as the client's payment clears. Due the next day.";
    $("apRail").textContent = railLine(view && view.rail);
    var body = $("apBody");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">No affiliate payouts yet. The payout run builds them on the 1st of each month from last month’s earned commission.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (p) {
      var status = STATUS_WORDS[p.status] || p.status;
      if (p.status === "held" && p.holdReason) status += " — " + (HOLD_WORDS[p.holdReason] || p.holdReason);
      if (p.overdue) status += " · past due";
      var bank = p.bank
        ? esc((p.bank.institution || "Bank") + " ··" + (p.bank.mask || "")) + (p.bank.testData ? " (test data)" : "")
        : "Not linked";
      var proof = p.reference ? esc(p.method + " · " + p.reference) : "—";
      if (p.plaid && p.plaid.failure) proof += '<div class="note" style="color:var(--alert)">' + (p.status === "pending" ? "Waiting: " : "") + esc(p.plaid.failure) + "</div>";
      else if (p.plaid && p.plaid.status && p.status === "processing") proof = "Plaid: " + esc(p.plaid.status);
      return '<tr data-id="' + esc(p.id) + '">' +
        "<td>" + esc(p.affiliate.name || p.affiliate.code || "Affiliate") + (p.affiliate.test ? ' <span class="note">(test)</span>' : "") + "</td>" +
        "<td>" + esc(month(p.periodStart)) + "</td>" +
        "<td>" + esc(day(p.dueOn)) + "</td>" +
        '<td class="money" style="text-align:right">' + esc(usd(p.amount)) + "</td>" +
        "<td>" + esc(status) + "</td>" +
        "<td>" + bank + "</td>" +
        "<td>" + proof + "</td>" +
        '<td style="white-space:nowrap">' + actionsFor(p) + "</td></tr>";
    }).join("");
  }

  function load() {
    var f = $("apFilter");
    var q = f && f.value ? "?status=" + encodeURIComponent(f.value) : "";
    $("apRail").textContent = "Loading payouts…";
    return api("/api/read/affiliate-payouts" + q).then(function (res) {
      if (!res.ok) {
        $("apRail").textContent = "";
        $("apBody").innerHTML = '<tr><td colspan="8" class="empty">' + esc(res.message || res.error || "Payouts could not be loaded. Try again.") + "</td></tr>";
        return;
      }
      render(res);
    });
  }

  function find(id) {
    return ((current && current.payouts) || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function act(action, payout, extra, btn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Working…"; }
    var body = { action: action, payout_id: payout.id };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return api("/api/affiliates/payouts", { method: "POST", body: body }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
      if (!res.ok) { say(res.message || res.error || "That did not work.", true); return res; }
      var done = { send: "Sent to Plaid. It shows paid when Plaid says the money landed.", mark_paid: "Recorded as paid.", hold: "Put on hold.", release: "Released. Ready to pay.", void: "Cancelled. The commission goes back to owed." };
      say(done[action] || "Done.", false);
      load();
      return res;
    });
  }

  function onClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var tr = btn.closest("tr");
    var p = tr && find(tr.dataset.id);
    if (!p) return;
    var a = btn.dataset.act;
    var who = (p.affiliate.name || "this affiliate") + " · " + usd(p.amount);
    if (a === "send") {
      if (!window.confirm("Send " + usd(p.amount) + " to " + (p.affiliate.name || "this affiliate") + "'s bank ··" + ((p.bank && p.bank.mask) || "") + " through Plaid? Once sent it cannot be cancelled here.")) return;
      act("send", p, {}, btn);
    } else if (a === "mark_paid") {
      openPaid(p, who);
    } else if (a === "hold") {
      var why = window.prompt("Why is this payout on hold? (" + who + ")");
      if (why == null) return;
      if (!String(why).trim()) { say("A hold needs a reason.", true); return; }
      act("hold", p, { reason: String(why).trim() }, btn);
    } else if (a === "release") {
      act("release", p, {}, btn);
    } else if (a === "void") {
      var r = window.prompt("Cancel this payout (" + who + ")? The commission goes back to owed and joins next month's run. Say why:");
      if (r == null) return;
      if (!String(r).trim()) { say("Cancelling needs a reason.", true); return; }
      act("void", p, { reason: String(r).trim() }, btn);
    }
  }

  var paidFor = null;
  function openPaid(p, who) {
    paidFor = p;
    $("apPaidWho").textContent = who;
    $("apRef").value = "";
    $("apDate").value = new Date().toISOString().slice(0, 10);
    $("apPaidErr").hidden = true;
    var d = $("apPaidDialog");
    if (d && typeof d.showModal === "function") d.showModal();
  }

  function init() {
    var tab = $("affPayTab");
    if (!tab) return;
    fetch("/api/auth/session", { headers: { accept: "application/json", authorization: "Bearer " + token() } })
      .then(function (r) { return r.json(); })
      .then(function (sess) {
        var role = String(sess && sess.staff && sess.staff.role || "").toLowerCase();
        if (!FINANCE[role]) return;
        tab.hidden = false;
        tab.addEventListener("click", load);
        if (location.hash === "#affiliate-payouts") tab.click();
      }).catch(function () {});
    $("apFilter").addEventListener("change", load);
    $("apBody").addEventListener("click", onClick);
    $("apPaidCancel").addEventListener("click", function () { $("apPaidDialog").close(); });
    $("apPaidForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var ref = $("apRef").value.trim();
      if (!ref) { $("apPaidErr").textContent = "Add the bank trace, wire or check number."; $("apPaidErr").hidden = false; return; }
      var btn = $("apPaidSave");
      act("mark_paid", paidFor, { method: $("apMethod").value, reference: ref, paid_at: $("apDate").value || null }, btn).then(function (res) {
        if (res && res.ok) $("apPaidDialog").close();
        else { $("apPaidErr").textContent = (res && (res.message || res.error)) || "That did not work."; $("apPaidErr").hidden = false; }
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
