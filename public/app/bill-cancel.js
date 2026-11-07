/* "Cancel it for me" — the repeat bills card on the Strategy screen
 * (FinanceOS.sections.strategy, money-strategy.js mounts it).
 *
 * Finance OS wave 4, unit CANCEL. Each repeat bill has one button: "Cancel it
 * for me" opens a Fundhub team task to cancel it (POST /api/money/strategy
 * {action:"cancel_bill"}). The bill then shows where that ask stands, read from
 * the team task: Requested, Working, Cancelled. A bill that charged again after
 * it was cancelled says so and gets "Ask again". The merchant's own cancel page
 * shows as a link only when a team member saved one; a team member viewing the
 * client saves it here (action "set_cancel_link"). Nothing here cancels a bill
 * through any app or API, and nothing moves money.
 *
 * The data is GET /api/money/strategy's bill_cancel block
 * (src/banking/bill-cancel.mjs). Every render function returns an HTML string
 * and touches no DOM, so src/http/bill-cancel-screen.test.mjs runs them in Node.
 * Status is a word and a shape, never colour alone (UI-STANDARDS §12.6).
 */
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var CADENCE = { weekly: "Every week", biweekly: "Every two weeks", monthly: "Every month", annual: "Every year" };
  var SHOW = 12;
  var ACTS = { "cancel-bill": true, "save-cancel-link": true, "bills-all": true };
  var FAIL = {
    bad_url: "Use the full link. It starts with https://",
    bill_not_found: "That bill is not on file anymore. Reload the page.",
    staff_only: "Only the Fundhub team can save a cancel link.",
    signin: "Sign in again, then try.",
    offline: "We could not reach the server. Try again."
  };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* cents → "$1,234.56". Null → null (the caller leaves it out, never $0.00). */
  function money(cents) {
    if (!isNum(cents)) return null;
    var abs = Math.round(Math.abs(cents));
    return "$" + String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + ("0" + (abs % 100)).slice(-2);
  }
  /* "2026-11-07" → "Nov 7". */
  function shortDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) : "";
  }

  /* One line under the name: how often, how much, which account. */
  function caption(b) {
    var where = (b.account_name || "") + (b.account_mask ? (b.account_name ? " " : "") + "····" + b.account_mask : "");
    return [CADENCE[b.cadence] || "", money(b.amount_cents) || "", where].filter(Boolean).join(" · ");
  }

  /* Where the ask stands, in a word and a shape. */
  function statusHtml(c) {
    c = c || {};
    if (c.state === "requested") {
      return '<span class="tag bill-state">Requested</span>' + (c.asked_on ? '<span class="caption">' + esc(shortDay(c.asked_on)) + '</span>' : "");
    }
    if (c.state === "working") return '<span class="tag bill-state bill-working">Working</span>';
    if (c.state === "cancelled" && c.charged_again_on) {
      return '<span class="warn-word">Charged again</span><span class="caption">' + esc(shortDay(c.charged_again_on)) + '</span>';
    }
    if (c.state === "cancelled") {
      return '<span class="bill-state bill-done">Cancelled</span>' + (c.cancelled_on ? '<span class="caption">' + esc(shortDay(c.cancelled_on)) + '</span>' : "");
    }
    return "";
  }

  function renderRow(b, viewer) {
    var c = b.cancel || {};
    var name = b.name || "Bill";
    var button = c.can_ask
      ? '<button class="btn-line bill-btn" type="button" data-act="cancel-bill" data-bill="' + esc(b.id) + '" aria-label="' +
        esc((c.state === "cancelled" ? "Ask again to cancel " : "Cancel it for me: ") + name) + '">' + (c.state === "cancelled" ? "Ask again" : "Cancel it for me") + '</button>'
      : "";
    var link = b.link && b.link.url && (c.state !== "cancelled" || c.charged_again_on)
      ? '<a class="bill-link" href="' + esc(b.link.url) + '" target="_blank" rel="noopener noreferrer">Cancel on their site</a>'
      : "";
    var staffForm = viewer === "staff"
      ? '<details class="bill-link-form"><summary>Their cancel link</summary>' +
        '<label class="caption" for="bl-' + esc(b.id) + '">Their cancel page</label>' +
        '<div class="bill-link-row"><input id="bl-' + esc(b.id) + '" type="url" inputmode="url" autocomplete="off" placeholder="https://" value="' + esc(b.link && b.link.url ? b.link.url : "") + '">' +
        '<button class="btn-line" type="button" data-act="save-cancel-link" data-bill="' + esc(b.id) + '">Save link</button></div></details>'
      : "";
    return '<li class="bill-row" data-bill-row="' + esc(b.id) + '"><div class="bill-main"><span class="bill-name">' + esc(name) + '</span>' +
      '<span class="caption">' + esc(caption(b)) + '</span></div>' +
      '<div class="bill-side">' + statusHtml(c) + button + link + '</div>' + staffForm +
      '<p class="caption bill-err" data-slot="bill-err" aria-live="polite" hidden></p></li>';
  }

  /** The card. bc = GET /api/money/strategy's bill_cancel. "" when there is nothing to show. */
  function renderCard(bc) {
    if (!bc) return "";
    var open = '<section class="card bills-card" aria-labelledby="s-bills"><h2 class="eyebrow" id="s-bills">Repeat bills</h2>';
    if (bc.ok === false) {
      return open + '<p class="bill-out">We could not load your repeat bills.</p>' +
        '<button class="btn-line bill-btn" type="button" data-act="retry">Try again</button></section>';
    }
    var bills = list(bc.bills);
    if (!bills.length) return "";
    var all = bc.show_all === true || bills.length <= SHOW + 2;
    var shown = all ? bills : bills.slice(0, SHOW);
    var more = all ? "" : '<button class="btn-line bill-btn" type="button" data-act="bills-all">Show all ' + bills.length + '</button>';
    return open + '<p class="caption">Tap Cancel it for me and our team will work on it.</p>' +
      '<ul class="bill-rows">' + shown.map(function (b) { return renderRow(b, bc.viewer); }).join("") + '</ul>' + more + '</section>';
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function rowOf(t) { return t && t.closest ? t.closest("[data-bill-row]") : null; }
  function say(t, words) {
    var row = rowOf(t);
    var slot = row ? row.querySelector('[data-slot="bill-err"]') : null;
    if (!slot) return;
    slot.textContent = words || "";
    slot.hidden = !words;
  }

  /**
   * act(button, name, ctx) — one press. ctx = { data, send(path, body), path,
   * clientId, repaint() }. data is the section's GET; its bill_cancel is
   * replaced with the answer and the section repaints.
   */
  function act(t, name, ctx) {
    var data = ctx && ctx.data;
    if (!data || !data.bill_cancel) return;
    if (name === "bills-all") {
      data.bill_cancel.show_all = true;
      ctx.repaint();
      return;
    }
    var id = t.getAttribute("data-bill");
    if (!id) return;
    var body = { action: name === "cancel-bill" ? "cancel_bill" : "set_cancel_link", bill_id: id };
    if (name === "save-cancel-link") {
      var row = rowOf(t);
      var input = row ? row.querySelector('input[type="url"]') : null;
      body.url = input ? String(input.value || "").trim() : "";
      if (!/^https:\/\/\S+$/.test(body.url)) { say(t, FAIL.bad_url); return; }
    }
    if (ctx.clientId) body.client_id = ctx.clientId;
    var label = t.textContent;
    t.disabled = true;
    t.textContent = name === "cancel-bill" ? "Sending…" : "Saving…";
    say(t, "");
    ctx.send(ctx.path, body).then(function (res) {
      var b = res && res.body;
      if (res && res.status === 200 && b && b.ok === true && b.bill_cancel) {
        var showAll = data.bill_cancel.show_all === true;
        data.bill_cancel = b.bill_cancel;
        if (showAll) data.bill_cancel.show_all = true;
        ctx.repaint();
        return;
      }
      t.disabled = false;
      t.textContent = label;
      var kind = !res || res.status === 0 ? "offline" : res.status === 401 ? "signin" : (b && b.error) || "";
      say(t, FAIL[kind] || (b && b.message) || "That did not go through. Try again.");
    });
  }

  root.FHBillCancel = {
    renderCard: renderCard, renderRow: renderRow, statusHtml: statusHtml, caption: caption,
    handles: function (name) { return ACTS[name] === true; }, act: act, SHOW: SHOW
  };
})(typeof window !== "undefined" ? window : globalThis);
