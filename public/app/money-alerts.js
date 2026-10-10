/* File protection alerts — FinanceOS.sections.alerts (/app/money-alerts.html).
 * Capital Blueprint launch, unit B2, the screen
 * (ops/workflows/blueprint-launch-2026-10-06.md, map items 11–14).
 *
 * Four texts guard a client's credit file: pay a card down before its statement
 * closes, a promo rate ending (60 / 30 / 7 days), the cash cushion (6 months of
 * minimum payments), and new credit. The daily job sends them
 * (src/workflows/blueprint-finance-os-alerts.mjs). This screen shows what each
 * one watches, when it texts next and about what, and what already went out. It
 * lets the client (or staff) switch each one on or off, set a card's promo, and
 * tell us the day a hand-entered card's statement closes.
 *
 * ONE READ, THREE WRITES. GET /api/money/alerts — the contract is
 * docs/finance/file-protection-alerts.md, and
 * src/finance/file-alerts/file-alerts.fixture.json is a real answer a test pins.
 * POST /api/money/alerts with action
 *   set_alert                 { kind, enabled }
 *   set_promo                 { account_id, ends_on, apr_pct }  (ends_on null clears it)
 *   set_statement_close_day   { account_id, day }
 * After a promo or close-day save the section reads the GET again, so the dates
 * on the screen are the server's. The one date worked out here is the day of a
 * promo text: the end date minus 60, 30 or 7 days, firing on that day and the
 * two after — the rule the doc states and src/finance/file-alerts/promo.mjs runs.
 *
 * THE HONESTY RULES (same as the other money pages):
 *   - Money arrives as integer cents. A null paints "—" or words, never $0.00.
 *   - Personal and business cash are two checks. Nothing here adds them up.
 *   - Status is a word and a shape, never colour alone (UI-STANDARDS §12.6).
 *   - A text that cannot go (switched off, STOP, not on a plan) says so where its
 *     date would be. The screen never promises a text the daily job will not send.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-alerts-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/alerts";
  var ACCOUNTS_HREF = "/app/financeos.html#accounts";
  var SETUP_HREF = "/app/financeos.html#setup";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY_MS = 86400000;
  var KINDS = ["payment_timing", "promo_end", "cash_reserve", "new_credit"];
  var KIND_FALLBACK = {
    payment_timing: "Pay before the statement closes",
    promo_end: "Promo rate ending",
    cash_reserve: "Cash cushion",
    new_credit: "New credit"
  };
  var CASH_KINDS = ["personal", "business"];
  var TAG = { personal: "Personal", business: "Business", unknown: "Not sorted yet" };
  /* Texts listed per card before "Show all". */
  var SHOW = 3;
  /* The server refuses a promo end date more than 5 years out (PROMO_MAX_YEARS_AHEAD). */
  var PROMO_MAX_DAYS = 5 * 366;
  /* A promo text fires on its day and the two days after (PROMO_WINDOW_DAYS). */
  var PROMO_WINDOW_DAYS = 3;

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function upper(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function andList(arr) {
    var a = list(arr).filter(Boolean);
    if (a.length <= 1) return a.join("");
    return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  }
  /* An id from the API, safe inside an element id and a selector. */
  function domId(id) { return String(id == null ? "" : id).replace(/[^A-Za-z0-9_-]/g, ""); }

  /* cents → "$1,234.56". Null → "—". */
  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }
  function pct(v) { return isNum(v) ? (Math.round(v * 10) / 10) + "%" : "—"; }
  /* A rate as stored, to the hundredth: 3.99%, never rounded to 4%. */
  function rate(v) { return isNum(v) ? (Math.round(v * 100) / 100) + "%" : "—"; }
  function ordinal(n) {
    if (!isNum(n)) return "—";
    var s = ["th", "st", "nd", "rd"];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* Calendar dates, read as text in UTC — the server's "today" is the UTC date
     of the read (src/finance/file-alerts/snapshot.mjs), so this page uses the same. */
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function parseIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    var t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(t);
    if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return t;
  }
  function isoOf(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function addDays(iso, n) { var t = parseIso(iso); return t === null ? null : isoOf(t + n * DAY_MS); }
  function daysBetween(a, b) {
    var x = parseIso(a);
    var y = parseIso(b);
    return x === null || y === null ? null : Math.round((y - x) / DAY_MS);
  }
  /* "2026-12-06" → "Dec 6, 2026". */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }
  /* "Dec 6" in this year, "Jan 6, 2027" in another. */
  function shortDay(iso, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    var same = String(today || "").slice(0, 4) === m[1];
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (same ? "" : ", " + m[1]);
  }
  /* Days from today → words. */
  function inWords(n) {
    if (!isNum(n)) return "";
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    return n > 0 ? "in " + plural(n, "day", "days") : plural(-n, "day", "days") + " ago";
  }
  /* A timestamp's day, said against today: "today", "yesterday", "Oct 7". */
  function relDay(ts, today) {
    var iso = String(ts || "").slice(0, 10);
    var n = daysBetween(iso, today);
    if (n === 0) return "today";
    if (n === 1) return "yesterday";
    return shortDay(iso, today);
  }
  /* The exact time, for the tooltip (UI-STANDARDS §7), in the viewer's own zone. */
  function exactTime(ts) {
    var t = Date.parse(String(ts || ""));
    if (!isFinite(t)) return "";
    try {
      return new Date(t).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
      });
    } catch (e) {
      return String(ts);
    }
  }
  function timeTag(ts, today) {
    return '<time datetime="' + esc(ts) + '" title="' + esc(exactTime(ts)) + '">' + esc(upper(relDay(ts, today))) + '</time>';
  }

  function withClient(href, clientId) {
    if (!clientId) return href;
    var parts = String(href).split("#");
    var sep = parts[0].indexOf("?") === -1 ? "?" : "&";
    var out = parts[0] + sep + "client_id=" + encodeURIComponent(clientId);
    return parts.length > 1 ? out + "#" + parts.slice(1).join("#") : out;
  }

  /* What a card is called — its name and last four, the same words the texts use
     (cardWords in src/finance/file-alerts/common.mjs). Never a guessed lender. */
  function cardName(c) {
    var name = c && typeof c.name === "string" ? c.name.trim() : "";
    var mask = c && c.mask !== null && c.mask !== undefined ? String(c.mask).trim() : "";
    if (name && mask) return name + " ending " + mask;
    if (name) return name;
    if (mask) return "Card ending " + mask;
    return "Credit card";
  }
  function kindTag(k) { return TAG[k] ? ' <span class="tag">' + esc(TAG[k]) + '</span>' : ""; }

  /* ── reading the answer ────────────────────────────────────────────────── */

  function todayOf(data) {
    var m = /^\d{4}-\d{2}-\d{2}/.exec(String((data && data.as_of) || ""));
    return m ? m[0] : isoOf(Date.now());
  }
  function settingsOf(data) { return (data && data.settings) || {}; }
  function leadDays(data) { var n = settingsOf(data).pay_before_close_days; return isNum(n) ? n : 3; }
  function thresholds(data) {
    var t = list(settingsOf(data).promo_thresholds_days).filter(isNum);
    return (t.length ? t : [60, 30, 7]).slice().sort(function (a, b) { return b - a; });
  }
  function thresholdWords(data) { return andList(thresholds(data).map(String)) + " days"; }
  function reserveMonths(data) {
    var r = data && data.reserve;
    var n = r && isNum(r.months) ? r.months : settingsOf(data).reserve_months;
    return isNum(n) ? n : 6;
  }
  /* The kinds in the order the API lists them (settings.kinds), then any it left out. */
  function kindsOf(data) {
    var k = settingsOf(data).kinds;
    var order = k ? Object.keys(k).filter(function (x) { return KINDS.indexOf(x) !== -1; }) : [];
    KINDS.forEach(function (x) { if (order.indexOf(x) === -1) order.push(x); });
    return order;
  }
  /* No settings row means every kind is on (file_protection_settings, migration 471). */
  function kindOn(data, kind) {
    var k = settingsOf(data).kinds;
    return !(k && k[kind] && k[kind].enabled === false);
  }
  function kindLabel(data, kind) {
    var k = settingsOf(data).kinds;
    return (k && k[kind] && k[kind].label) || KIND_FALLBACK[kind] || kind;
  }
  function needsDay(c) { return !!c && (c.statement_close_day === null || c.statement_close_day === undefined); }
  function findAlert(data, id) {
    var hit = null;
    list(data && data.alerts).forEach(function (a) { if (!hit && a && a.id === id) hit = a; });
    return hit;
  }

  /* Why no text can go for this kind right now, or "" when one can. */
  function blockOf(data, kind) {
    if (data && data.enrolled && data.enrolled.any === false) return "plan";
    if (settingsOf(data).texts_blocked) return "stop";
    if (!kindOn(data, kind)) return "off";
    return "";
  }
  function blockWords(data, kind, opts) {
    var b = blockOf(data, kind);
    if (b === "plan") return "These texts come with the Capital Blueprint or FinanceOS.";
    if (b === "stop") {
      var s = opts && opts.staff ? "This client replied STOP." : "You replied STOP.";
      if (kind === "new_credit" && data && data.enrolled && data.enrolled.blueprint) s += " Your Fundhub team still gets a task.";
      return s;
    }
    if (b === "off") return "This alert is off.";
    return "";
  }

  /* ── the promo schedule ────────────────────────────────────────────────── */

  /* One step per threshold (60, 30, 7): its day, and whether it was sent, is
     due now (its day or the two after, still unsent), is still ahead, or passed. */
  function promoSteps(data, card) {
    var p = card && card.promo;
    if (!p) return [];
    var today = todayOf(data);
    var sent = list(p.alerted_thresholds);
    var owes = p.balance_cents !== 0;
    return thresholds(data).map(function (t) {
      var on = addDays(p.ends_on, -t);
      var since = daysBetween(on, today);
      var state;
      if (sent.indexOf(t) !== -1) state = "sent";
      else if (p.ended || since === null) state = "past";
      else if (since < 0) state = "ahead";
      else if (since < PROMO_WINDOW_DAYS && owes && isNum(p.days_left) && p.days_left >= 0) state = "due";
      else state = "past";
      return { t: t, on: on, state: state };
    });
  }
  /* The next promo text for a card: { when: "due" | "date", step }, or null. */
  function promoNext(data, card) {
    var p = card && card.promo;
    if (!p || p.ended || p.balance_cents === 0) return null;
    var steps = promoSteps(data, card);
    for (var i = 0; i < steps.length; i++) if (steps[i].state === "due") return { when: "due", step: steps[i] };
    for (var j = 0; j < steps.length; j++) if (steps[j].state === "ahead") return { when: "date", step: steps[j] };
    return null;
  }

  /* ── the next text for each kind ───────────────────────────────────────── */

  /* { when: "date", on, about } | { when: "soon", about } | { when: "event", text, note }
     | { when: "none", text } | { when: "blocked", text } */
  function nextFor(data, kind, opts) {
    var today = todayOf(data);
    if (blockOf(data, kind)) return { when: "blocked", text: blockWords(data, kind, opts) };
    var cards = list(data && data.cards);

    if (kind === "payment_timing") {
      var dated = cards.filter(function (c) { return c && c.pay_before && c.pay_before.next_close_on; });
      var pending = dated.filter(function (c) {
        return !c.pay_before.texted && c.balance_cents !== 0 && c.pay_before.text_on;
      }).sort(function (a, b) {
        return a.pay_before.text_on < b.pay_before.text_on ? -1 : a.pay_before.text_on > b.pay_before.text_on ? 1 : 0;
      });
      if (pending.length) {
        var c = pending[0];
        var pb = c.pay_before;
        var about = cardName(c) + ": pay it down before " + shortDay(pb.next_close_on, today) + ".";
        return pb.text_on > today ? { when: "date", on: pb.text_on, about: about } : { when: "soon", about: about };
      }
      var sent = dated.filter(function (x) { return x.pay_before.texted; });
      if (sent.length) {
        return { when: "none", text: (sent.length === 1 ? "Sent for the " + shortDay(sent[0].pay_before.next_close_on, today) + " close." : "Sent for each card's coming close.") +
          " The next one goes " + plural(leadDays(data), "day", "days") + " before the close after that." };
      }
      if (cards.some(needsDay)) return { when: "none", text: "None yet. Add a statement day below." };
      if (!cards.length) return { when: "none", text: "None. No credit cards on file." };
      return { when: "none", text: "None. Nothing is owed on your cards right now." };
    }

    if (kind === "promo_end") {
      var best = null;
      cards.forEach(function (card) {
        var n = promoNext(data, card);
        if (!n) return;
        var rank = n.when === "due" ? today : n.step.on;
        if (!best || rank < best.rank) best = { card: card, n: n, rank: rank };
      });
      if (best) {
        var words = cardName(best.card) + ": " + best.n.step.t + " days before its promo ends.";
        return best.n.when === "due" ? { when: "soon", about: words } : { when: "date", on: best.n.step.on, about: words };
      }
      if (cards.some(function (x) { return x && x.promo && !x.promo.ended; })) {
        return { when: "none", text: "No more promo texts are planned." };
      }
      return { when: "none", text: cards.length ? "None. No promo on file. Add one below." : "None. No credit cards on file." };
    }

    if (kind === "cash_reserve") return { when: "event", text: "If your cash drops too low", note: "We check every day." };
    return { when: "event", text: "The day we find new credit", note: "We check every day." };
  }

  /* ── what needs the client ─────────────────────────────────────────────── */

  var REASON_WORDS = {
    no_minimums: "No payments on file yet.",
    minimums_unknown: "Add each card's minimum payment.",
    no_cash_accounts: "No {kind} checking or savings account linked.",
    cash_unknown: "A balance is missing.",
    balance_stale: "That balance is more than 30 days old.",
    cash_is_a_floor: "One balance is missing, so you have at least this much.",
    cash_is_floor: "One balance is missing, so you have at least this much."
  };
  var FIXABLE = { minimums_unknown: true, no_cash_accounts: true, cash_unknown: true, balance_stale: true };
  function reasonWords(reason, kind) {
    return (REASON_WORDS[reason] || "We do not have enough on file to check this.").replace("{kind}", kind);
  }

  function needsOf(data, opts) {
    opts = opts || {};
    var out = [];
    if (settingsOf(data).texts_blocked) {
      out.push({ text: opts.staff
        ? "This client replied STOP, so no texts can go out. They can text START to turn them back on."
        : "You replied STOP, so we cannot text you. Text START to us to turn texts back on." });
    }
    list(data && data.cards).forEach(function (c) {
      if (needsDay(c)) out.push({ text: "Add the statement day for " + cardName(c) + ".", to: "fa-cd-" + domId(c.account_id), label: "Add the day" });
    });
    var r = (data && data.reserve) || {};
    var months = reserveMonths(data);
    CASH_KINDS.forEach(function (k) {
      var v = r[k];
      if (!v) return;
      if (v.state === "below") {
        out.push({
          text: TAG[k] + " cash is " + (isNum(v.short_cents) ? money(v.short_cents) + " " : "") + "short of " + months + " months of minimums.",
          to: "fa-cash-" + k, label: "See it"
        });
      } else if (v.state === "unknown" && v.reason && v.reason !== "no_minimums") {
        out.push({ text: "We cannot check your " + k + " cash yet. " + reasonWords(v.reason, k), to: "fa-cash-" + k, label: "See it" });
      }
    });
    var nc = r.not_counted;
    if (nc && isNum(nc.debts) && nc.debts > 0) {
      out.push({
        text: "Sort " + plural(nc.debts, "card or loan", "cards or loans") + " into personal or business.",
        href: withClient(ACCOUNTS_HREF, opts.clientId), label: "Open Accounts"
      });
    }
    return out;
  }

  /* ── head, notices, tiles ──────────────────────────────────────────────── */

  var TITLE = "File protection alerts";

  function renderHead(data) {
    var who = data && data.client && data.client.name ? data.client.name + " · " : "";
    return '<div class="head"><div><h1>' + TITLE + '</h1><p class="caption">' +
      esc(who + "We text you before something can hurt your credit file. Here is what we watch, and when we text you next.") +
      '</p></div></div>';
  }

  function renderNotices(data, opts) {
    var out = "";
    if (data && data.enrolled && data.enrolled.any === false) {
      out += '<section class="card notice" aria-labelledby="fa-n-plan"><h2 id="fa-n-plan">No texts go out yet</h2><p>' +
        esc(opts.staff
          ? "This client has neither the Capital Blueprint nor a FinanceOS plan, so the daily check skips them. What you set here starts working once one is on the file."
          : "These texts come with the Capital Blueprint or a FinanceOS plan. You can set everything up below, and the texts start once one is on your file.") +
        '</p><a class="btn-line" href="' + esc(withClient(SETUP_HREF, opts.clientId)) + '">Set up FinanceOS</a></section>';
    }
    if (settingsOf(data).texts_blocked) {
      var bp = data && data.enrolled && data.enrolled.blueprint;
      out += '<section class="card notice is-warn" aria-labelledby="fa-n-stop"><h2 id="fa-n-stop">Texts are off for this phone</h2><p>' +
        esc((opts.staff
          ? "This client replied STOP, so we cannot text them. Nothing on this page will be sent until they text START to us."
          : "You replied STOP, so we cannot text you. Nothing on this page will be sent. To turn texts back on, text START to us.") +
          (bp ? " If new credit shows up, your Fundhub team still gets a task." : "")) +
        '</p></section>';
    }
    return out;
  }

  function tile(id, label, big, body) {
    return '<section class="card tile" aria-labelledby="fa-tl-' + id + '"><h2 class="eyebrow" id="fa-tl-' + id + '">' + esc(label) + '</h2>' +
      '<span class="big">' + big + '</span>' + body + '</section>';
  }

  function needItem(n) {
    var act = n.to
      ? ' <button type="button" class="btn-text" data-act="jump" data-to="' + esc(n.to) + '">' + esc(n.label) + '</button>'
      : n.href ? ' <a class="btn-text" href="' + esc(n.href) + '">' + esc(n.label) + '</a>' : "";
    return '<li><span>' + esc(n.text) + '</span>' + act + '</li>';
  }

  function tileNeeds(data, opts) {
    var items = needsOf(data, opts);
    var body = items.length
      ? '<ul class="need-list">' + items.slice(0, 3).map(needItem).join("") + '</ul>' +
        (items.length > 3 ? '<p class="caption">And ' + (items.length - 3) + ' more below.</p>' : "")
      : '<p class="caption">Nothing right now. If something comes up, it shows here.</p>';
    return tile("needs", "Needs you", esc(items.length), body);
  }

  function tileNext(data, opts) {
    var today = todayOf(data);
    var best = null;
    ["payment_timing", "promo_end"].forEach(function (k) {
      var n = nextFor(data, k, opts);
      if (n.when !== "date" && n.when !== "soon") return;
      var rank = n.when === "soon" ? today : n.on;
      if (!best || rank < best.rank) best = { kind: k, n: n, rank: rank };
    });
    if (best) {
      var when = best.n.when === "soon" ? "At our next daily check." : upper(inWords(daysBetween(today, best.n.on))) + ".";
      return tile("next", "Next text", esc(best.n.when === "soon" ? "Within a day" : shortDay(best.n.on, today)),
        '<p class="caption">' + esc(when + " " + kindLabel(data, best.kind) + " · " + best.n.about) + '</p>');
    }
    var b = blockOf(data, "payment_timing");
    if (b === "plan" || b === "stop") {
      return tile("next", "Next text", "None", '<p class="caption">' + esc(blockWords(data, "payment_timing", opts)) + '</p>');
    }
    var watch = [];
    if (!blockOf(data, "cash_reserve")) watch.push("your cash");
    if (!blockOf(data, "new_credit")) watch.push("new credit");
    return tile("next", "Next text", "—", '<p class="caption">' + esc("No dated text is planned." +
      (watch.length ? " We still check " + andList(watch) + " every day." : "")) + '</p>');
  }

  function tileLast(data, opts) {
    var today = todayOf(data);
    var alerts = list(data && data.alerts);
    if (!alerts.length) return tile("last", "Last text", "—", '<p class="caption">No texts sent yet.</p>');
    var first = alerts[0];
    var dayIso = String(first.sent_at || "").slice(0, 10);
    var same = alerts.filter(function (a) { return String(a.sent_at || "").slice(0, 10) === dayIso; });
    var labels = [];
    same.forEach(function (a) {
      var l = a.kind_label || kindLabel(data, a.kind);
      if (labels.indexOf(l) === -1) labels.push(l);
    });
    var words = same.length > 1
      ? plural(same.length, "text", "texts") + ": " + andList(labels) + "."
      : (first.kind_label || kindLabel(data, first.kind)) + (first.label ? " · " + upper(first.label) : "") + ".";
    if (same.some(function (a) { return a.delivery === "task_only"; })) {
      words += " " + (opts.staff ? "Texts were off (STOP), so the team got a task instead." : "Texts were off, so your Fundhub team got a task instead.");
    }
    return tile("last", "Last text", timeTag(first.sent_at, today), '<p class="caption">' + esc(words) + '</p>');
  }

  function renderTiles(data, opts) {
    return '<div class="grid tiles">' + tileNeeds(data, opts) + tileNext(data, opts) + tileLast(data, opts) + '</div>';
  }

  /* ── one protection card ───────────────────────────────────────────────── */

  function renderMsg(ui, key, id) {
    var m = ui.msgs[key];
    if (!m) return "";
    return '<p class="msg' + (m.bad ? " is-bad" : "") + '"' + (id ? ' id="' + esc(id) + '"' : "") + ' tabindex="-1" data-msg="' + esc(key) + '">' + esc(m.text) + '</p>';
  }

  function watchWords(data, kind) {
    if (kind === "payment_timing") {
      return "Each card tells the credit bureaus its balance on the day its statement closes. We text you " +
        plural(leadDays(data), "day", "days") + " before, so you can pay it down first.";
    }
    if (kind === "promo_end") {
      return "When a card's promo rate (like 0%) ends, its normal rate starts. We text you " + thresholdWords(data) +
        " before it ends, with how much to pay each month.";
    }
    if (kind === "cash_reserve") {
      return "We check your cash against " + reserveMonths(data) + " months of your minimum payments. A missed payment can hurt your file before your next funding sequence.";
    }
    return "A new card, loan or credit check (inquiry) can push back your next funding sequence. We watch your linked accounts and your credit pulls.";
  }

  function renderNextLine(n, today) {
    var what;
    if (n.when === "date") {
      what = '<strong>' + esc(shortDay(n.on, today)) + '</strong> <span class="caption">' + esc(inWords(daysBetween(today, n.on)) + " · " + n.about) + '</span>';
    } else if (n.when === "soon") {
      what = '<strong>Within a day</strong> <span class="caption">' + esc("At our next daily check · " + n.about) + '</span>';
    } else if (n.when === "event") {
      what = '<strong>' + esc(n.text) + '</strong> <span class="caption">' + esc(n.note) + '</span>';
    } else if (n.when === "blocked") {
      what = '<strong>None</strong> <span class="caption">' + esc(n.text) + '</span>';
    } else {
      what = '<span>' + esc(n.text) + '</span>';
    }
    return '<div class="next-line' + (n.when === "blocked" ? " is-blocked" : "") + '"><span class="eyebrow">Next text</span><p class="next-what">' + what + '</p></div>';
  }

  function dayOptions(selected) {
    var sel = String(selected == null ? "" : selected);
    var out = '<option value=""' + (sel === "" ? " selected" : "") + '>Pick a day</option>';
    for (var d = 1; d <= 31; d++) out += '<option value="' + d + '"' + (sel === String(d) ? " selected" : "") + '>' + ordinal(d) + '</option>';
    return out;
  }

  function balanceWords(c) {
    if (!isNum(c.balance_cents)) return "Balance — (not on file)";
    var s = "Balance " + money(c.balance_cents);
    if (isNum(c.limit_cents)) s += " of a " + money(c.limit_cents) + " limit";
    if (isNum(c.used_pct)) s += " · " + pct(c.used_pct) + " used";
    else if (!isNum(c.limit_cents)) s += " · limit not on file";
    return s;
  }

  /* — Pay before the statement closes — */

  function renderNeedsDay(data, cards, ui) {
    var many = cards.length > 1;
    var busy = !!ui.busy["save-days"];
    var rows = cards.map(function (c) {
      var id = domId(c.account_id);
      var err = ui.msgs["cd:" + c.account_id];
      return '<div class="nd-card">' +
        '<p class="row-name">' + esc(cardName(c)) + kindTag(c.kind) + '</p>' +
        '<label for="fa-cd-' + id + '">Day of the month its statement closes</label>' +
        '<select id="fa-cd-' + id + '" data-cd="' + esc(c.account_id) + '"' + (err ? ' aria-invalid="true" aria-describedby="fa-cdm-' + id + '"' : "") + '>' +
        dayOptions(ui.drafts["cd:" + c.account_id]) + '</select>' +
        (c.close_day_source === "provider" ? '<p class="caption">This card is linked to your bank. If the bank sends its own day, we use that one.</p>' : "") +
        renderMsg(ui, "cd:" + c.account_id, "fa-cdm-" + id) +
        '</div>';
    }).join("");
    return '<div class="needs-day">' +
      '<p class="nd-ask"><span class="badge word-warn">Needs a day</span> <strong>' +
      esc(many ? "Which day of the month does each statement close?" : "Which day of the month does this card's statement close?") + '</strong></p>' +
      '<p>We need it so we can text you before it reports. <span class="caption">It is on your card statement, often called the closing date.</span></p>' +
      rows +
      '<div class="nd-act"><button type="button" class="btn-primary" data-act="save-days"' + (busy ? ' aria-disabled="true" aria-busy="true"' : "") + '>' +
      (busy ? "Saving…" : many ? "Save days" : "Save day") + '</button>' + renderMsg(ui, "save-days") + '</div>' +
      '</div>';
  }

  function payStatus(data, c) {
    var today = todayOf(data);
    var pb = c.pay_before || {};
    /* What already went out is a fact, so it shows even when no more texts can go. */
    if (pb.texted) {
      return '<p class="status"><span class="badge word-ok">Texted ' + esc(relDay(pb.texted_at, today)) + '</span></p>' +
        (pb.next_close_on ? '<p class="caption">' + esc("For the " + shortDay(pb.next_close_on, today) + " close") + '</p>' : "");
    }
    if (blockOf(data, "payment_timing")) return '<p class="status"><span class="badge word-muted">No text</span></p>';
    if (c.balance_cents === 0) {
      return '<p class="status"><span class="badge word-muted">No text</span></p><p class="caption">Nothing is owed, so there is nothing to pay down.</p>';
    }
    if (!pb.next_close_on || !pb.text_on) return '<p class="caption">We could not work out the next close date.</p>';
    if (pb.text_on > today) {
      return '<p class="status">Next text <strong>' + esc(shortDay(pb.text_on, today)) + '</strong></p>' +
        '<p class="caption">' + esc(plural(leadDays(data), "day", "days") + " before it closes") + '</p>';
    }
    return '<p class="status">Next text <strong>within a day</strong></p><p class="caption">At our next daily check</p>';
  }

  function dayForm(c, ui) {
    var id = domId(c.account_id);
    var busy = !!ui.busy["day:" + c.account_id];
    var err = ui.msgs["day-err:" + c.account_id];
    var draft = ui.drafts["day:" + c.account_id];
    return '<div class="edit">' +
      '<div class="field"><label for="fa-de-' + id + '">Day of the month its statement closes</label>' +
      '<select id="fa-de-' + id + '" data-de="' + esc(c.account_id) + '"' + (err ? ' aria-invalid="true" aria-describedby="fa-dem-' + id + '"' : "") + '>' +
      dayOptions(draft !== undefined ? draft : c.statement_close_day) + '</select></div>' +
      renderMsg(ui, "day-err:" + c.account_id, "fa-dem-" + id) +
      '<div class="edit-act"><button type="button" class="btn-line" data-act="save-day" data-id="' + esc(c.account_id) + '"' +
      (busy ? ' aria-disabled="true" aria-busy="true"' : "") + '>' + (busy ? "Saving…" : "Save day") + '</button>' +
      '<button type="button" class="btn-text" data-act="cancel-day" data-id="' + esc(c.account_id) + '">Cancel</button></div>' +
      '</div>';
  }

  function payRow(data, c, ui) {
    var today = todayOf(data);
    var pb = c.pay_before || {};
    var editing = ui.editDay === c.account_id;
    var close = pb.next_close_on
      ? 'Statement closes <strong>' + esc(shortDay(pb.next_close_on, today)) + '</strong> · ' + esc(inWords(pb.days_to_close))
      : esc("Statement closes on the " + ordinal(c.statement_close_day) + " of each month");
    var typed = c.close_day_source !== "provider";
    var note = "Closes on the " + ordinal(c.statement_close_day) + " · " + (typed ? "typed in" : "from your bank");
    var change = typed && !editing
      ? '<button type="button" class="btn-text" data-act="edit-day" data-id="' + esc(c.account_id) + '" aria-label="' + esc("Change day for " + cardName(c)) + '">Change day</button>'
      : "";
    return '<li class="row">' +
      '<div class="row-main"><p class="row-name">' + esc(cardName(c)) + kindTag(c.kind) + '</p>' +
      '<p>' + close + '</p><p class="caption">' + esc(balanceWords(c)) + '</p></div>' +
      '<div class="row-side">' + payStatus(data, c) + '<p class="caption">' + esc(note) + '</p>' + change + '</div>' +
      (editing ? dayForm(c, ui) : "") + renderMsg(ui, "day:" + c.account_id) +
      '</li>';
  }

  /* The ask for a missing statement day goes first in its card, right under the
     switch: a text cannot go without it, and it holds the screen's one filled button. */
  function renderPayLead(data, ui) {
    var missing = list(data && data.cards).filter(needsDay);
    return missing.length ? renderNeedsDay(data, missing, ui) : "";
  }

  function renderPayBody(data, ui, opts) {
    var cards = list(data && data.cards);
    if (!cards.length) {
      return '<p class="empty-line">No credit cards on file yet. When one is, its statement day shows here.</p>' +
        (opts.quiet ? "" : '<p><a class="btn-text" href="' + esc(withClient(ACCOUNTS_HREF, opts.clientId)) + '">Add a card</a></p>');
    }
    var known = cards.filter(function (c) { return !needsDay(c); });
    return renderMsg(ui, "pay") +
      (known.length ? '<ul class="rows">' + known.map(function (c) { return payRow(data, c, ui); }).join("") + '</ul>' : "");
  }

  /* — Promo rate ending — */

  function payoffWords(p, today) {
    var pay = p.payoff;
    if (pay && isNum(pay.payments) && pay.payments > 1) {
      return 'Pay about <strong>' + esc(money(pay.monthly_cents)) + ' a month</strong> ' +
        esc("for the next " + pay.payments + " months to clear it in time.");
    }
    if (pay && isNum(pay.payments)) {
      return 'Pay all <strong>' + esc(money(pay.total_cents)) + '</strong> ' + esc("before " + shortDay(p.ends_on, today) + " to clear it in time.");
    }
    if (!isNum(p.balance_cents)) return esc("We do not have this card's balance, so we cannot work out a monthly amount.");
    return esc("Nothing is owed on this card, so there is nothing to clear.");
  }

  function sourceWords(p, opts) {
    var by = p.source === "staff"
      ? (opts.staff ? "Added by staff" : "Added by your Fundhub team")
      : p.source === "client" ? (opts.staff ? "Added by the client" : "Added by you") : "Added";
    return by + (p.set_at ? " on " + day(String(p.set_at).slice(0, 10)) : "") + ".";
  }

  function renderSteps(data, card, quietNext) {
    var today = todayOf(data);
    var steps = promoSteps(data, card);
    var n = quietNext ? null : promoNext(data, card);
    return '<ol class="steps" aria-label="' + esc("Promo texts for " + cardName(card)) + '">' + steps.map(function (s) {
      var isNext = !!n && n.step.t === s.t;
      var word = s.state === "sent" ? "Sent" : s.state === "due" ? "Within a day" : s.state === "past" ? "Day passed" : shortDay(s.on, today);
      return '<li class="step is-' + s.state + (isNext ? " is-next" : "") + '"><span class="caption step-t">' + esc(s.t + " days before") + '</span>' +
        '<span class="step-w">' + esc(word) + '</span>' + (isNext ? '<span class="caption step-next">Next text</span>' : "") + '</li>';
    }).join("") + '</ol>';
  }

  function promoFacts(data, c, opts) {
    var today = todayOf(data);
    var p = c.promo;
    var rateWord = p.apr_pct === 0 ? "0% promo" : isNum(p.apr_pct) ? rate(p.apr_pct) + " promo rate" : "Promo rate (rate not given)";
    if (p.ended) {
      return '<p><span class="badge word-muted">Ended</span> ' + esc("Its promo ended on " + day(p.ends_on) + ". No more promo texts for it.") + '</p>' +
        '<p class="caption">' + esc(sourceWords(p, opts)) + '</p>';
    }
    var left = isNum(p.days_left) ? (p.days_left === 0 ? "today" : "in " + plural(p.days_left, "day", "days")) : "";
    var blocked = !!blockOf(data, "promo_end");
    return '<p><strong>' + esc(rateWord) + '</strong> ends <strong>' + esc(day(p.ends_on)) + '</strong>' + (left ? ' · ' + esc(left) : "") + '</p>' +
      '<p>Left to pay: <span class="num">' + esc(money(p.balance_cents)) + '</span></p>' +
      '<p class="payoff">' + payoffWords(p, today) + '</p>' +
      renderSteps(data, c, blocked) +
      '<p class="caption">' + esc(sourceWords(p, opts) + (isNum(p.apr_pct) && p.apr_pct > 0 ? " The monthly amount does not count interest." : "")) + '</p>';
  }

  function removeBlock(c, ui) {
    var id = domId(c.account_id);
    if (ui.askRemove === c.account_id) {
      return '<div class="danger" role="group" aria-labelledby="fa-rq-' + id + '"><p id="fa-rq-' + id + '"><strong>' +
        esc("Remove the promo on " + cardName(c) + "?") + '</strong> Its promo texts stop.</p>' +
        '<div class="edit-act"><button type="button" class="btn-danger" data-act="remove-promo" data-id="' + esc(c.account_id) + '">Yes, remove it</button>' +
        '<button type="button" class="btn-text" data-act="keep-promo" data-id="' + esc(c.account_id) + '">Keep it</button></div></div>';
    }
    return '<div class="danger"><button type="button" class="btn-text" data-act="ask-remove" data-id="' + esc(c.account_id) + '">Remove this promo</button></div>';
  }

  function promoForm(data, c, ui) {
    var id = domId(c.account_id);
    var p = c.promo;
    var today = todayOf(data);
    var key = "promo:" + c.account_id;
    var d = ui.drafts[key] || { ends_on: p && !p.ended ? p.ends_on : "", apr: p && isNum(p.apr_pct) ? String(p.apr_pct) : "" };
    var err = ui.msgs["promo-err:" + c.account_id];
    var field = err && err.field;
    var busy = !!ui.busy[key];
    return '<form class="edit" data-form="promo" data-id="' + esc(c.account_id) + '" novalidate>' +
      '<div class="edit-grid">' +
      '<div class="field"><label for="fa-pe-' + id + '">Promo ends on</label>' +
      '<input id="fa-pe-' + id + '" type="date" min="' + esc(today) + '" max="' + esc(addDays(today, PROMO_MAX_DAYS)) + '" value="' + esc(d.ends_on) + '"' +
      (field === "ends_on" ? ' aria-invalid="true"' : "") + ' aria-describedby="fa-pm-' + id + '"></div>' +
      '<div class="field"><label for="fa-pa-' + id + '">Promo rate (APR)</label>' +
      '<span class="pct-box"><input id="fa-pa-' + id + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(d.apr) + '"' +
      (field === "apr_pct" ? ' aria-invalid="true"' : "") + ' aria-describedby="fa-pah-' + id + ' fa-pm-' + id + '"><span class="pct-sign" aria-hidden="true">%</span></span>' +
      '<p class="caption" id="fa-pah-' + id + '">Use 0 for a 0% promo. Leave it empty if you do not know it.</p></div>' +
      '</div>' +
      '<p class="field-msg" id="fa-pm-' + id + '">' + (err ? esc(err.text) : "") + '</p>' +
      '<div class="edit-act"><button type="submit" class="btn-line" data-act="save-promo" data-id="' + esc(c.account_id) + '"' +
      (busy ? ' aria-disabled="true" aria-busy="true"' : "") + '>' + (busy ? "Saving…" : "Save promo") + '</button>' +
      '<button type="button" class="btn-text" data-act="cancel-promo" data-id="' + esc(c.account_id) + '">Cancel</button></div>' +
      (p ? removeBlock(c, ui) : "") +
      '</form>';
  }

  function promoRank(c) {
    if (!c.promo) return 3e6;
    if (c.promo.ended) return 2e6;
    return isNum(c.promo.days_left) ? c.promo.days_left : 1e6;
  }

  function promoRow(data, c, ui, opts) {
    var p = c.promo;
    var editing = ui.editPromo === c.account_id;
    var label = p ? "Change promo" : "Add a promo";
    var btn = editing ? "" : '<button type="button" class="btn-line" data-act="edit-promo" data-id="' + esc(c.account_id) + '" aria-label="' +
      esc(label + " for " + cardName(c)) + '">' + label + '</button>';
    return '<li class="row">' +
      '<div class="row-main"><p class="row-name">' + esc(cardName(c)) + kindTag(c.kind) + '</p>' +
      (p ? promoFacts(data, c, opts) : '<p class="caption">No promo rate on file. If this card has one, add it so we can text you before it ends.</p>') +
      '</div>' +
      '<div class="row-side">' + btn + '</div>' +
      (editing ? promoForm(data, c, ui) : "") + renderMsg(ui, "promo:" + c.account_id) +
      '</li>';
  }

  function renderPromoBody(data, ui, opts) {
    var cards = list(data && data.cards);
    if (!cards.length) return '<p class="empty-line">No credit cards on file yet. When one is, you can add its promo here.</p>';
    var order = cards.slice().sort(function (a, b) { return promoRank(a) - promoRank(b); });
    return '<ul class="rows">' + order.map(function (c) { return promoRow(data, c, ui, opts); }).join("") + '</ul>';
  }

  /* — Cash cushion — */

  function fact(label, value) {
    return '<div class="fact"><dt class="caption">' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function cashNext(data, kind, v, opts) {
    var today = todayOf(data);
    var blocked = !!blockOf(data, "cash_reserve");
    /* A text that already went out is a fact, so it shows even when no more can go. */
    if (v.state === "below" && v.open_alert_id) {
      var open = findAlert(data, v.open_alert_id);
      var sent = open ? "Texted " + relDay(open.sent_at, today) + ". " : "We already texted you about this. ";
      return sent + (blocked ? "No new text. " + blockWords(data, "cash_reserve", opts) : "We text again only after it is covered again and then drops.");
    }
    if (blocked) return "No text. " + blockWords(data, "cash_reserve", opts);
    if (v.state === "below") return "Next text: at our next daily check.";
    if (v.state === "ok") return isNum(v.need_cents) ? "If it drops below " + money(v.need_cents) + ", we text you." : "If it drops too low, we text you.";
    return "We cannot check this yet, so no text goes out.";
  }

  function cashBox(data, kind, v, opts) {
    v = v || { state: "unknown", reason: null };
    var months = isNum(v.months) ? v.months : reserveMonths(data);
    var word = v.state === "below" ? '<span class="badge word-warn">Short</span>'
      : v.state === "ok" ? '<span class="badge word-ok">Covered</span>'
        : '<span class="badge word-muted">Cannot check yet</span>';
    var floor = function (s) { return "At least " + s; };
    var cash = isNum(v.cash_cents) ? (v.cash_is_floor ? floor(money(v.cash_cents)) : money(v.cash_cents)) : "—";
    var need = v.minimums_is_floor && isNum(v.need_cents) ? floor(money(v.need_cents)) : money(v.need_cents);
    var mins = v.minimums_is_floor && isNum(v.minimums_cents) ? floor(money(v.minimums_cents)) : money(v.minimums_cents);
    var notes = [];
    if (v.state === "unknown") notes.push(reasonWords(v.reason, kind));
    if (isNum(v.clarity_cents)) notes.push("Minimums include " + money(v.clarity_cents) + " a month for your Fundhub payment plan.");
    if (v.minimums_is_floor) notes.push("A card or loan has no minimum on file, so the real need may be higher.");
    if (isNum(v.cash_accounts) && v.cash_accounts > 0) notes.push("Cash counted from " + plural(v.cash_accounts, "account", "accounts") + ".");
    var fix = v.state === "unknown" && FIXABLE[v.reason] && !opts.quiet
      ? '<p><a class="btn-text" href="' + esc(withClient(ACCOUNTS_HREF, opts.clientId)) + '">Open Accounts</a></p>'
      : "";
    return '<section class="cash-box is-' + esc(v.state || "unknown") + '" id="fa-cash-' + kind + '" tabindex="-1" aria-labelledby="fa-cash-' + kind + '-h">' +
      '<h3 class="eyebrow" id="fa-cash-' + kind + '-h">' + esc(TAG[kind] + " cash") + '</h3>' +
      '<span class="big">' + esc(cash) + '</span>' +
      '<p class="verdict">' + word + '</p>' +
      '<dl class="facts">' +
      fact(months + " months of minimums", need) +
      fact("Minimums each month", mins) +
      (v.state === "below" ? fact("Short by", money(v.short_cents)) : "") +
      '</dl>' +
      (notes.length ? '<p class="caption">' + esc(notes.join(" ")) + '</p>' : "") +
      '<p class="cash-next">' + esc(cashNext(data, kind, v, opts)) + '</p>' + fix +
      '</section>';
  }

  function renderCashBody(data, ui, opts) {
    var r = (data && data.reserve) || {};
    var nc = r.not_counted || {};
    var ncLine = isNum(nc.debts) && nc.debts > 0
      ? '<p class="nc-line"><span class="badge word-warn">Not counted</span> ' +
        esc(plural(nc.debts, "card or loan is", "cards or loans are") + " not sorted into personal or business yet, so " +
          (nc.debts === 1 ? "it is" : "they are") + " in neither check" +
          (isNum(nc.minimums_cents) ? " (" + money(nc.minimums_cents) + " a month in minimums)" : "") + ".") +
        (opts.quiet ? "" : ' <a class="btn-text" href="' + esc(withClient(ACCOUNTS_HREF, opts.clientId)) + '">Sort them in Accounts</a>') + '</p>'
      : "";
    return '<div class="cash-grid">' + CASH_KINDS.map(function (k) { return cashBox(data, k, r[k], opts); }).join("") + '</div>' + ncLine +
      '<p class="caption">Personal and business cash are checked on their own. We never add them together.</p>';
  }

  /* — New credit — */

  function renderNewBody(data, ui, opts) {
    var bp = data && data.enrolled && data.enrolled.blueprint;
    return '<p>If one is not yours, reply to the text and tell us.</p>' +
      (bp ? '<p class="caption">' + esc(opts.staff
        ? "This client has the Capital Blueprint, so their Fundhub team gets a task too."
        : "Your Fundhub team gets a task too, so they can help.") + '</p>' : "");
  }

  var BODY = {
    payment_timing: renderPayBody,
    promo_end: renderPromoBody,
    cash_reserve: renderCashBody,
    new_credit: renderNewBody
  };

  /* — Texts sent — */

  function sentItem(data, a, today, opts) {
    var tag = "";
    var notes = [];
    if (a.kind === "cash_reserve") {
      if (a.open) {
        tag = ' <span class="badge word-warn">Still open</span>';
        notes.push("Open until this cash is covered again.");
      } else if (a.cleared_at) {
        tag = ' <span class="badge word-ok">Covered again</span>';
        var rel = relDay(a.cleared_at, today);
        notes.push("Covered again " + (rel === "today" || rel === "yesterday" ? rel : "on " + rel) + ".");
      }
    }
    if (a.delivery === "task_only") notes.push(opts.staff ? "Not texted: texts were off (STOP). The team got a task instead." : "Not texted, because texts were off. Your Fundhub team got a task instead.");
    else if (a.task_id) notes.push(opts.staff ? "The team got a task too." : "Your Fundhub team got a task too.");
    return '<li class="sent-item">' +
      '<p class="sent-meta">' + timeTag(a.sent_at, today) + (a.label ? ' <span class="caption">·</span> <span>' + esc(upper(a.label)) + '</span>' : "") + tag + '</p>' +
      '<p class="sent-body">' + esc(a.body || "") + '</p>' +
      (notes.length ? '<p class="caption">' + esc(notes.join(" ")) + '</p>' : "") +
      '</li>';
  }

  function renderSent(data, kind, ui, opts) {
    var today = todayOf(data);
    var all = list(data && data.alerts).filter(function (a) { return a && a.kind === kind; });
    var head = '<h3 class="eyebrow" id="fa-s-' + kind + '">Texts sent</h3>';
    if (!all.length) return '<div class="sent">' + head + '<p class="caption">None yet.</p></div>';
    var open = !!ui.expanded[kind];
    var shown = open ? all : all.slice(0, SHOW);
    var more = all.length > SHOW
      ? '<button type="button" class="btn-text" data-act="more" data-kind="' + kind + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        (open ? "Show fewer" : "Show all " + all.length + " texts") + '</button>'
      : "";
    return '<div class="sent">' + head + '<ol class="sent-list" aria-labelledby="fa-s-' + kind + '">' +
      shown.map(function (a) { return sentItem(data, a, today, opts); }).join("") + '</ol>' + more + '</div>';
  }

  function renderKind(data, kind, ui, opts) {
    ui = normalUi(ui);
    opts = opts || {};
    var on = kindOn(data, kind);
    var busy = !!ui.busy["toggle:" + kind];
    var sw = '<button type="button" class="switch" role="switch" aria-checked="' + (on ? "true" : "false") + '" aria-labelledby="fa-t-' + kind + '"' +
      ' data-act="toggle" data-kind="' + kind + '"' + (busy ? ' aria-disabled="true" aria-busy="true"' : "") + '>' +
      '<span class="sw-word" aria-hidden="true">' + (busy ? "Saving…" : on ? "On" : "Off") + '</span>' +
      '<span class="track" aria-hidden="true"><span class="thumb"></span></span></button>';
    return '<section class="card prot' + (on ? "" : " is-off") + '" id="fa-k-' + kind + '" aria-labelledby="fa-t-' + kind + '">' +
      '<div class="prot-head"><h2 id="fa-t-' + kind + '">' + esc(kindLabel(data, kind)) + '</h2>' +
      '<div class="sw-wrap">' + sw + renderMsg(ui, "toggle:" + kind) + '</div></div>' +
      (kind === "payment_timing" ? renderPayLead(data, ui) : "") +
      '<p class="watch">' + esc(watchWords(data, kind)) + '</p>' +
      renderNextLine(nextFor(data, kind, opts), todayOf(data)) +
      BODY[kind](data, ui, opts) +
      renderSent(data, kind, ui, opts) +
      '</section>';
  }

  /* ── the whole section, loading, error, empty ──────────────────────────── */

  function normalUi(ui) {
    ui = ui || {};
    return {
      msgs: ui.msgs || {}, busy: ui.busy || {}, drafts: ui.drafts || {}, expanded: ui.expanded || {},
      editPromo: ui.editPromo || null, askRemove: ui.askRemove || null, editDay: ui.editDay || null
    };
  }

  /* Nothing to watch: no cards, no texts, and neither cash check can run. */
  function isEmpty(data) {
    var r = (data && data.reserve) || {};
    function unknown(k) { return !r[k] || r[k].state === "unknown"; }
    return !list(data && data.cards).length && !list(data && data.alerts).length && unknown("personal") && unknown("business");
  }

  function renderEmpty(opts) {
    return '<section class="card empty" aria-labelledby="fa-empty"><h2 id="fa-empty">Nothing to watch yet</h2>' +
      '<p>When a card or bank account is on your file, we can text you before something hurts your credit file: before a statement reports, before a promo ends, and when your cash runs low.</p>' +
      '<a class="btn-primary" href="' + esc(withClient(ACCOUNTS_HREF, opts.clientId)) + '">Add an account</a></section>';
  }

  /** The whole section for one answer: data (the GET), ui (open editors, messages), opts ({ staff, clientId }). */
  function render(data, ui, opts) {
    ui = normalUi(ui);
    opts = opts || {};
    var empty = isEmpty(data);
    var o = { staff: !!opts.staff, clientId: opts.clientId || "", quiet: empty };
    return renderHead(data) + renderNotices(data, o) + (empty ? renderEmpty(o) : renderTiles(data, o)) +
      '<div class="grid prots">' + kindsOf(data).map(function (k) { return renderKind(data, k, ui, o); }).join("") + '</div>';
  }

  function renderLoading() {
    var tileSk = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    var protSk = '<div class="card prot skel"><span class="sk sk-m"></span><span class="sk sk-s"></span><span class="sk sk-l"></span>' +
      '<span class="sk sk-m"></span><span class="sk sk-m"></span><span class="sk sk-s"></span></div>';
    return '<div class="head"><div><h1>' + TITLE + '</h1><p class="caption">Loading your alerts…</p></div></div>' +
      '<div class="grid tiles" aria-busy="true">' + tileSk + tileSk + tileSk + '</div>' +
      '<div class="grid prots" aria-busy="true">' + protSk + protSk + protSk + protSk + '</div>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your alerts. Try again in a few minutes.",
    forbidden: "This login is not allowed to see these alerts. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose alerts to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(kind) {
    return '<div class="head"><div><h1>' + TITLE + '</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your alerts</h2>' +
      '<p>' + esc(ERROR_WORDS[kind] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  /* ── checking what a person typed, and reading the server's answers ────── */

  /* A promo typed into the form → null when it is fine, or { field, text }.
     Same limits as readPromoInput in src/finance/file-alerts/promo.mjs. */
  function checkPromo(endsOn, aprText, today) {
    if (!endsOn) return { field: "ends_on", text: "Pick the day the promo ends." };
    if (parseIso(endsOn) === null) return { field: "ends_on", text: "Pick a real date, like Dec 6, 2026." };
    var left = daysBetween(today, endsOn);
    if (left !== null && left < 0) return { field: "ends_on", text: "That day has passed. Pick today or a later day." };
    if (left !== null && left > PROMO_MAX_DAYS) return { field: "ends_on", text: "That day is more than 5 years away. Check the year." };
    var a = String(aprText == null ? "" : aprText).replace(/[%\s]/g, "");
    if (a !== "") {
      var n = Number(a);
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(a) || !isFinite(n) || n < 0 || n > 100) {
        return { field: "apr_pct", text: "Type the rate as a number from 0 to 100, like 0 or 3.99." };
      }
    }
    return null;
  }

  function fieldWords(field, message) {
    var m = String(message || "");
    if (field === "ends_on") {
      if (/passed/.test(m)) return "That day has passed. Pick today or a later day.";
      if (/years/.test(m)) return "That day is more than 5 years away. Check the year.";
      return "Pick a real date, like Dec 6, 2026.";
    }
    if (field === "apr_pct") return "Type the rate as a number from 0 to 100, like 0 or 3.99.";
    if (field === "day") return "Pick a day from 1 to 31.";
    if (field === "account_id") {
      if (/closed/.test(m)) return "That card is closed, so it cannot get these texts.";
      if (/credit card/.test(m)) return "This only works for a credit card.";
      return "We could not find that card. Reload the page and try again.";
    }
    return "That change was not accepted. Reload the page and try again.";
  }

  /* A POST answer → null when it worked, { signin: true }, or { field, text } in words. */
  function postProblem(res) {
    var s = res && res.status;
    var b = (res && res.body) || {};
    if (s === 401) return { signin: true };
    if (!s) return { text: "We could not reach the server. Check your connection and try again." };
    if (s === 400 && b.error === "invalid_input") return { field: b.field || null, text: fieldWords(b.field, b.message) };
    if (s === 400) return { text: "That change was not accepted. Reload the page and try again." };
    if (s === 403) return { text: "This login is not allowed to change these alerts." };
    if (s === 404) return { field: "account_id", text: "We could not find that card. Reload the page and try again." };
    if (s === 503 || b.db === "down") return { text: "Our database is not answering right now. Try again in a few minutes." };
    if (s >= 200 && s < 300 && b.ok === true) return null;
    return { text: "Something went wrong on our side. Try again in a few minutes." };
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
    var s = res && res.status;
    var b = res && res.body;
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

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /* ── the section: window.FinanceOS.sections.alerts ───────────────────────
     mount(el, ctx) paints this section into `el` and wires its controls. No page
     chrome — no header, no nav. ctx = { clientId, apiGet, apiPost }:
       clientId  staff only; a client session leaves it empty (the server pins a
                 client to their own file)
       apiGet(path) / apiPost(path, body) → Promise of { status, body }
     Missing api functions fall back to this file's own fetch. Section styles:
     money-alerts.css, every rule under .fh-alerts. Returns { ready, reload, unmount }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var clientId = ctx.clientId || "";
    var opts = { staff: !!clientId, clientId: clientId };
    var qs = clientId ? "?client_id=" + encodeURIComponent(clientId) : "";
    var get = ctx.apiGet ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = ctx.apiPost ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var state = { data: null, ui: normalUi(null) };
    var SIGNIN = {};

    function q(sel) { try { return el.querySelector ? el.querySelector(sel) : null; } catch (e) { return null; } }
    function qa(sel) {
      try { return el.querySelectorAll ? Array.prototype.slice.call(el.querySelectorAll(sel)) : []; } catch (e) { return []; }
    }
    function val(sel) { var n = q(sel); return n && typeof n.value === "string" ? n.value : ""; }

    /* The body repaints; the live region outside it stays, so what it says is read out. */
    function paint(html) {
      var body = q(".fa-body");
      if (body) body.innerHTML = html;
      else el.innerHTML = '<div class="fh-alerts"><div class="fa-body">' + html + '</div><p class="fa-live" role="status" aria-live="polite"></p></div>';
    }
    function say(text) {
      var live = q(".fa-live");
      if (live) live.textContent = text;
    }
    function focusOn(sel) {
      var n = sel ? q(sel) : null;
      if (n && n.focus) { try { n.focus({ preventScroll: false }); } catch (e) { n.focus(); } }
    }
    /* Keep what a person typed in an open editor across a repaint. */
    function captureDrafts() {
      var ui = state.ui;
      qa("select[data-cd]").forEach(function (s) { ui.drafts["cd:" + s.getAttribute("data-cd")] = s.value; });
      if (ui.editPromo) {
        var id = domId(ui.editPromo);
        if (q("#fa-pe-" + id)) ui.drafts["promo:" + ui.editPromo] = { ends_on: val("#fa-pe-" + id), apr: val("#fa-pa-" + id) };
      }
      if (ui.editDay) {
        var d = q("#fa-de-" + domId(ui.editDay));
        if (d) ui.drafts["day:" + ui.editDay] = d.value;
      }
    }
    function repaint(focusSel) {
      if (!state.data) return;
      captureDrafts();
      paint(render(state.data, state.ui, opts));
      focusOn(focusSel);
    }
    function leave() {
      if (ctx.onSignIn) ctx.onSignIn();
      else if (root.location) root.location.href = signInUrl();
    }
    function post(body) {
      if (clientId) body.client_id = clientId;
      return send(READ_PATH, body);
    }

    function load() {
      paint(renderLoading());
      return get(READ_PATH + qs).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { leave(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        state.data = res.body;
        state.ui = normalUi(null);
        if (ctx.onData) ctx.onData(res.body);
        paint(render(state.data, state.ui, opts));
      });
    }

    /* A quiet read after a save: the new dates come from the server. */
    function refresh() {
      return get(READ_PATH + qs).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") throw SIGNIN;
        if (kind !== "ok") return false;
        state.data = res.body;
        return true;
      });
    }

    function toggle(btn) {
      var kind = btn.getAttribute("data-kind");
      var key = "toggle:" + kind;
      if (KINDS.indexOf(kind) === -1 || state.ui.busy[key]) return;
      var next = btn.getAttribute("aria-checked") !== "true";
      var sel = '[data-act="toggle"][data-kind="' + kind + '"]';
      state.ui.msgs = {};
      state.ui.busy[key] = true;
      repaint(sel);
      return post({ action: "set_alert", kind: kind, enabled: next }).then(function (res) {
        delete state.ui.busy[key];
        var p = postProblem(res);
        if (p && p.signin) { leave(); return; }
        if (p) {
          state.ui.msgs[key] = { bad: true, text: p.text };
          repaint(sel);
          say(p.text);
          return;
        }
        var saved = res.body && res.body.saved;
        var on = saved && typeof saved.enabled === "boolean" ? saved.enabled : next;
        var s = state.data.settings = state.data.settings || {};
        s.kinds = s.kinds || {};
        s.kinds[kind] = { enabled: on, label: kindLabel(state.data, kind) };
        s.saved = true;
        var text = on ? "Saved. This alert is on." : "Saved. This alert is off. We will not text you about it.";
        state.ui.msgs[key] = { text: text };
        repaint(sel);
        say(kindLabel(state.data, kind) + ": " + text);
      });
    }

    function saveDays() {
      if (state.ui.busy["save-days"]) return;
      var picks = [];
      qa("select[data-cd]").forEach(function (s) {
        var id = s.getAttribute("data-cd");
        state.ui.drafts["cd:" + id] = s.value;
        if (s.value) picks.push({ id: id, day: Number(s.value) });
      });
      state.ui.msgs = {};
      var btnSel = '[data-act="save-days"]';
      if (!picks.length) {
        state.ui.msgs["save-days"] = { bad: true, text: "Pick a day from the list first." };
        repaint(btnSel);
        say("Pick a day from the list first.");
        return;
      }
      state.ui.busy["save-days"] = true;
      repaint(btnSel);
      var done = 0;
      var firstBad = null;
      var chain = Promise.resolve();
      picks.forEach(function (pk) {
        chain = chain.then(function () {
          return post({ action: "set_statement_close_day", account_id: pk.id, day: pk.day }).then(function (res) {
            var p = postProblem(res);
            if (p && p.signin) throw SIGNIN;
            if (p) {
              state.ui.msgs["cd:" + pk.id] = { bad: true, text: p.text };
              if (!firstBad) firstBad = pk.id;
            } else {
              done += 1;
              delete state.ui.drafts["cd:" + pk.id];
            }
          });
        });
      });
      return chain.then(function () { return done ? refresh() : true; }).then(function (fresh) {
        delete state.ui.busy["save-days"];
        var text = "";
        if (done) {
          text = (done === 1 ? "Saved." : "Saved " + done + " days.") + " We will text you " + plural(leadDays(state.data), "day", "days") + " before it closes.";
          if (fresh === false) text += " We could not refresh the page, so reload it to see the new dates.";
          state.ui.msgs.pay = { text: text };
        }
        repaint(firstBad ? "#fa-cd-" + domId(firstBad) : '[data-msg="pay"]');
        say(firstBad ? state.ui.msgs["cd:" + firstBad].text : text);
      }, function (e) {
        delete state.ui.busy["save-days"];
        if (e === SIGNIN) { leave(); return; }
        repaint(btnSel);
      });
    }

    function saveDay(id) {
      var key = "day:" + id;
      if (state.ui.busy[key]) return;
      var v = val("#fa-de-" + domId(id));
      state.ui.msgs = {};
      if (!v) {
        state.ui.msgs["day-err:" + id] = { bad: true, text: "Pick a day from the list first." };
        repaint("#fa-de-" + domId(id));
        return;
      }
      state.ui.drafts[key] = v;
      state.ui.busy[key] = true;
      repaint('[data-act="save-day"][data-id="' + domId(id) + '"]');
      return post({ action: "set_statement_close_day", account_id: id, day: Number(v) }).then(function (res) {
        var p = postProblem(res);
        if (p && p.signin) throw SIGNIN;
        if (p) {
          delete state.ui.busy[key];
          state.ui.msgs["day-err:" + id] = { bad: true, text: p.text };
          repaint("#fa-de-" + domId(id));
          say(p.text);
          return;
        }
        return refresh().then(function (fresh) {
          delete state.ui.busy[key];
          delete state.ui.drafts[key];
          state.ui.editDay = null;
          var text = "Saved. We will text you " + plural(leadDays(state.data), "day", "days") + " before it closes." +
            (fresh ? "" : " Reload the page to see the new date.");
          state.ui.msgs[key] = { text: text };
          repaint('[data-act="edit-day"][data-id="' + domId(id) + '"]');
          say(text);
        });
      }).then(null, function (e) {
        delete state.ui.busy[key];
        if (e === SIGNIN) leave();
      });
    }

    function sendPromo(id, body, doneText) {
      var key = "promo:" + id;
      state.ui.busy[key] = true;
      repaint('[data-act="save-promo"][data-id="' + domId(id) + '"]');
      return post(body).then(function (res) {
        var p = postProblem(res);
        if (p && p.signin) throw SIGNIN;
        if (p) {
          delete state.ui.busy[key];
          state.ui.msgs["promo-err:" + id] = p;
          repaint(p.field === "apr_pct" ? "#fa-pa-" + domId(id) : "#fa-pe-" + domId(id));
          say(p.text);
          return;
        }
        return refresh().then(function (fresh) {
          delete state.ui.busy[key];
          delete state.ui.drafts[key];
          state.ui.editPromo = null;
          state.ui.askRemove = null;
          var text = doneText + (fresh ? "" : " Reload the page to see the new dates.");
          state.ui.msgs[key] = { text: text };
          repaint('[data-act="edit-promo"][data-id="' + domId(id) + '"]');
          say(text);
        });
      }).then(null, function (e) {
        delete state.ui.busy[key];
        if (e === SIGNIN) leave();
      });
    }

    function savePromo(id) {
      if (!id || state.ui.busy["promo:" + id]) return;
      var ends = val("#fa-pe-" + domId(id));
      var apr = val("#fa-pa-" + domId(id));
      state.ui.drafts["promo:" + id] = { ends_on: ends, apr: apr };
      state.ui.msgs = {};
      var bad = checkPromo(ends, apr, todayOf(state.data));
      if (bad) {
        state.ui.msgs["promo-err:" + id] = bad;
        repaint(bad.field === "apr_pct" ? "#fa-pa-" + domId(id) : "#fa-pe-" + domId(id));
        say(bad.text);
        return;
      }
      var a = String(apr || "").replace(/[%\s]/g, "");
      return sendPromo(id, { action: "set_promo", account_id: id, ends_on: ends, apr_pct: a === "" ? null : Number(a) },
        "Saved. The promo texts are set for this card.");
    }

    function removePromo(id) {
      if (!id || state.ui.busy["promo:" + id]) return;
      state.ui.msgs = {};
      return sendPromo(id, { action: "set_promo", account_id: id, ends_on: null }, "Removed. No more promo texts for this card.");
    }

    function jump(to) {
      var doc = root.document;
      var n = doc && doc.getElementById ? doc.getElementById(to) : null;
      if (!n || !el.contains(n)) return;
      var calm = false;
      try { calm = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
      if (n.scrollIntoView) { try { n.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" }); } catch (e) { n.scrollIntoView(); } }
      if (n.focus) { try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || !el.contains(t)) return;
      var act = t.getAttribute("data-act");
      var id = t.getAttribute("data-id");
      if (act === "save-promo" && e.preventDefault) e.preventDefault();
      if (t.getAttribute("aria-disabled") === "true") return;
      if (act === "retry") load();
      else if (act === "toggle") toggle(t);
      else if (act === "save-days") saveDays();
      else if (act === "jump") jump(t.getAttribute("data-to"));
      else if (act === "more") {
        var k = t.getAttribute("data-kind");
        state.ui.expanded[k] = !state.ui.expanded[k];
        repaint('[data-act="more"][data-kind="' + k + '"]');
      } else if (act === "edit-promo") {
        state.ui.msgs = {};
        state.ui.editPromo = id;
        state.ui.askRemove = null;
        delete state.ui.drafts["promo:" + id];
        repaint("#fa-pe-" + domId(id));
      } else if (act === "cancel-promo") {
        state.ui.editPromo = null;
        state.ui.askRemove = null;
        delete state.ui.drafts["promo:" + id];
        state.ui.msgs = {};
        repaint('[data-act="edit-promo"][data-id="' + domId(id) + '"]');
      } else if (act === "save-promo") savePromo(id);
      else if (act === "ask-remove") {
        state.ui.askRemove = id;
        repaint('[data-act="keep-promo"][data-id="' + domId(id) + '"]');
      } else if (act === "keep-promo") {
        state.ui.askRemove = null;
        repaint('[data-act="ask-remove"][data-id="' + domId(id) + '"]');
      } else if (act === "remove-promo") removePromo(id);
      else if (act === "edit-day") {
        state.ui.msgs = {};
        state.ui.editDay = id;
        delete state.ui.drafts["day:" + id];
        repaint("#fa-de-" + domId(id));
      } else if (act === "cancel-day") {
        state.ui.editDay = null;
        delete state.ui.drafts["day:" + id];
        state.ui.msgs = {};
        repaint('[data-act="edit-day"][data-id="' + domId(id) + '"]');
      } else if (act === "save-day") saveDay(id);
    }

    /* Enter in the promo form clicks its Save button (the browser's own implicit
       submit), which onClick handles. This catches any submit that gets past it. */
    function onSubmit(e) {
      var f = e.target;
      if (!f || !f.getAttribute || f.getAttribute("data-form") !== "promo") return;
      if (e.preventDefault) e.preventDefault();
      savePromo(f.getAttribute("data-id"));
    }

    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    var first = load();
    return {
      ready: first,
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
    var doc = root.document;
    var el = doc.getElementById("alerts-root");
    if (!el) return;
    var cid = param("client_id");
    var back = doc.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    var nav = doc.getElementById("money-nav");
    if (nav && cid) {
      Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
        a.setAttribute("href", withClient(a.getAttribute("href"), cid));
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.alerts = { title: "Alerts", mount: mount, render: render };

  root.FHMoneyAlerts = {
    money: money, day: day, shortDay: shortDay, relDay: relDay, inWords: inWords, ordinal: ordinal, cardName: cardName,
    withClient: withClient, classify: classify, postProblem: postProblem, checkPromo: checkPromo,
    needsOf: needsOf, nextFor: nextFor, promoSteps: promoSteps, isEmpty: isEmpty,
    render: render, renderKind: renderKind, renderTiles: renderTiles, renderLoading: renderLoading, renderError: renderError,
    mount: mount
  };

  /* Auto-start only finds #alerts-root on the standalone page. A combined
     FinanceOS page calls FinanceOS.sections.alerts.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
