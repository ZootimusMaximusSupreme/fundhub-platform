/* Money — the client's Finance Oversight page (/app/money.html).
 *
 * Reads ONE endpoint, GET /api/money/overview, and paints it. The JSON shape is
 * the contract on ops/workflows/finance-os-build-2026-10-06.md. Nothing on this
 * page invents a number: every figure is a field from that read.
 *
 * THE HONESTY RULES (docs/finance/client-finance-os-build-spec-2026-09-19.md §4):
 *   - Money arrives as integer cents. A null is "we do not have this number"
 *     and paints "—", never $0.00.
 *   - is_floor:true means the total has holes in it, so it paints "at least".
 *   - Cash is NEVER added across personal / business / not-sure-yet. Each kind
 *     is its own number. Debt may add up (the server sends total_cents).
 *   - No bank activity means no bars. The chart says so instead.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-screen.test.mjs can run them in Node against a fixture.
 * mount() and init() are the only parts that need a browser.
 *
 * ONE PAGE (owner change 2026-10-06): this file is the Overview section of
 * /app/financeos.html — window.FinanceOS.sections.overview.mount(el, ctx).
 * money.html is now a thin shell that mounts the same section.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/overview";
  var PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var KIND_LABEL = { personal: "Personal", business: "Business", unknown: "Not sure yet" };
  var CONTAINER_LABEL = { personal: "Personal", business: "Business", unknown: "Not sorted yet" };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* cents → "$1,234.56". A null is a hole, so it is a dash, never $0.00. */
  function money(cents, isFloor) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    var s = (neg ? "−$" : "$") + dollars + "." + c;
    return isFloor ? "at least " + s : s;
  }

  /* "2026-10-21" → "Oct 21, 2026". Read as a calendar date, not a moment, so
     no time zone can move it a day. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  /* "2026-09" → "Sep 2026" */
  function monthName(ym, short) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + (short ? "" : " " + m[1]);
  }

  function pct(v) {
    if (!isNum(v)) return "—";
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
  }

  /* as_of is a real moment. Staff screens are Arizona; this follows suit. */
  function stamp(iso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    try {
      return new Date(t).toLocaleString("en-US", {
        timeZone: "America/Phoenix", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function list(v) { return Array.isArray(v) ? v : []; }

  function isCard(a) { return a && (a.type === "credit" || a.subtype === "credit card"); }

  /* A used-% bar as SVG attributes, so no inline style is needed. */
  function usedBar(p) {
    if (!isNum(p)) return '<span class="caption">— used</span>';
    var w = Math.max(0, Math.min(100, p));
    return '<svg class="used-bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="' +
      esc(pct(p)) + ' used"><rect class="used-track" x="0" y="0" width="100" height="8" rx="4"></rect>' +
      '<rect class="used-fill" x="0" y="0" width="' + w + '" height="8" rx="4"></rect></svg>';
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function renderSandbox(d) {
    if (!d || d.sandbox !== true) return "";
    return '<div class="sandbox" role="note"><strong>Test data — Plaid sandbox</strong>' +
      '<span>These accounts are fake test accounts, not a real bank.</span></div>';
  }

  /* CASH — one line per kind. These three numbers are never added together. */
  function cashLine(kind, part) {
    var p = part || {};
    var n = isNum(p.accounts) ? p.accounts : 0;
    if (kind === "unknown" && n === 0 && !isNum(p.cents)) {
      return '<p class="caption cash-none">Not sure yet: — (no accounts waiting to be sorted)</p>';
    }
    return '<div class="cash-line" data-kind="' + esc(kind) + '">' +
      '<span class="caption">' + esc(KIND_LABEL[kind]) + ' cash</span>' +
      '<span class="big">' + esc(money(p.cents, p.is_floor)) + '</span>' +
      '<span class="caption">' + esc(plural(n, "account", "accounts")) + '</span></div>';
  }

  function cardsUsed(cards) {
    var bal = 0, lim = 0, counted = 0, missing = 0;
    list(cards).forEach(function (c) {
      if (isNum(c.balance_cents) && isNum(c.limit_cents) && c.limit_cents > 0) {
        bal += c.balance_cents; lim += c.limit_cents; counted++;
      } else {
        missing++;
      }
    });
    return { pct: counted ? (bal / lim) * 100 : null, bal: counted ? bal : null,
      lim: counted ? lim : null, counted: counted, missing: missing };
  }

  function sortedUpcoming(d) {
    return list(d.upcoming).slice().sort(function (a, b) {
      return String(a.on || "9999").localeCompare(String(b.on || "9999"));
    });
  }

  function renderTiles(d) {
    var cash = d.cash || {};
    var debt = d.debt || {};
    var byKind = debt.by_kind || {};
    var used = cardsUsed(debt.cards);
    var next = sortedUpcoming(d)[0];

    var cashTile = '<section class="card tile tile-cash" aria-labelledby="t-cash">' +
      '<h2 class="eyebrow" id="t-cash">What you have</h2>' +
      cashLine("personal", cash.personal) +
      cashLine("business", cash.business) +
      cashLine("unknown", cash.unknown) +
      '<p class="caption">Each kind is kept apart. They are not added together.</p></section>';

    var debtTile = '<section class="card tile" aria-labelledby="t-debt">' +
      '<h2 class="eyebrow" id="t-debt">What you owe</h2>' +
      '<span class="big">' + esc(money(debt.total_cents, debt.is_floor)) + '</span>' +
      '<p class="caption">All debt we know about</p>' +
      '<ul class="split">' +
      '<li><span>Personal</span><span class="num">' + esc(money(byKind.personal)) + '</span></li>' +
      '<li><span>Business</span><span class="num">' + esc(money(byKind.business)) + '</span></li>' +
      '<li><span>Not sure yet</span><span class="num">' + esc(money(byKind.unknown)) + '</span></li>' +
      '</ul></section>';

    var usedNote;
    if (used.counted) {
      usedNote = money(used.bal) + " of " + money(used.lim) + " in limits";
      if (used.missing) usedNote += " · " + plural(used.missing, "card has", "cards have") + " no limit on file";
    } else {
      usedNote = list(debt.cards).length ? "No card limits on file yet" : "No cards connected";
    }
    var usedTile = '<section class="card tile" aria-labelledby="t-used">' +
      '<h2 class="eyebrow" id="t-used">Cards used</h2>' +
      '<span class="big">' + esc(pct(used.pct)) + '</span>' +
      (used.counted ? usedBar(used.pct) : "") +
      '<p class="caption">' + esc(usedNote) + '</p></section>';

    var nextTile;
    if (next) {
      nextTile = '<section class="card tile" aria-labelledby="t-next">' +
        '<h2 class="eyebrow" id="t-next">Next due</h2>' +
        '<span class="big">' + esc(day(next.on).replace(/, \d{4}$/, "")) + '</span>' +
        '<p class="next-name">' + esc(next.name) + '</p>' +
        '<p class="caption">' + esc(next.type === "card_due" ? "Card payment" : "Bill") + ' · ' +
        esc(money(next.amount_cents)) + (next.type === "card_due" ? " minimum" : "") + '</p></section>';
    } else {
      nextTile = '<section class="card tile" aria-labelledby="t-next">' +
        '<h2 class="eyebrow" id="t-next">Next due</h2>' +
        '<span class="big">—</span><p class="caption">No due dates on file yet</p></section>';
    }

    return '<div class="grid tiles">' + cashTile + debtTile + usedTile + nextTile + '</div>';
  }

  function renderTip(d) {
    if (!d || typeof d.tip !== "string" || !d.tip.trim()) return "";
    return '<p class="tip" role="note"><span class="eyebrow">Tip</span> ' + esc(d.tip) + '</p>';
  }

  function cardFor(d, accountId) {
    var cards = list(d.debt && d.debt.cards);
    for (var i = 0; i < cards.length; i++) if (cards[i].account_id === accountId) return cards[i];
    return null;
  }

  function accountRow(d, a) {
    var card = isCard(a) ? cardFor(d, a.id) : null;
    var sub = [a.institution, a.subtype || a.type].filter(Boolean).join(" · ");
    var html = '<li class="acct">' +
      '<div class="acct-main"><div class="acct-name">' + esc(a.name || "Account") +
      (a.mask ? ' <span class="mask">••' + esc(a.mask) + '</span>' : "") + '</div>' +
      '<div class="caption">' + esc(sub) + '</div></div>' +
      '<div class="acct-num"><span class="num">' +
      esc(money(card ? card.balance_cents : a.current_cents)) + '</span>' +
      '<span class="caption">' + (isCard(a) ? "owed" : "balance") + '</span></div>';
    if (isCard(a)) {
      var c = card || {};
      html += '<dl class="card-facts">' +
        '<div><dt class="caption">Limit</dt><dd class="num">' + esc(money(c.limit_cents != null ? c.limit_cents : a.limit_cents)) + '</dd></div>' +
        '<div><dt class="caption">Room left</dt><dd class="num">' + esc(money(c.room_cents)) + '</dd></div>' +
        '<div class="fact-used"><dt class="caption">Used</dt><dd><span class="num">' + esc(pct(c.used_pct)) + '</span>' + usedBar(c.used_pct) + '</dd></div>' +
        '<div><dt class="caption">Due</dt><dd class="num">' + esc(day(c.due_on)) + '</dd></div>' +
        '<div><dt class="caption">Minimum</dt><dd class="num">' + esc(money(c.min_due_cents)) + '</dd></div>' +
        (isNum(c.past_due_cents) && c.past_due_cents > 0
          ? '<div class="fact-late"><dt class="caption">Past due</dt><dd class="num">' + esc(money(c.past_due_cents)) + '</dd></div>'
          : "") +
        '</dl>';
    }
    return html + '</li>';
  }

  function owedFor(d, c) {
    var rows = list(d.debt && d.debt.by_container);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (c.id ? r.container_id === c.id : (!r.container_id && r.kind === c.kind)) return r;
    }
    return null;
  }

  function inContainer(a, c) {
    return c.id ? a.container_id === c.id : (!a.container_id && a.kind === c.kind);
  }

  function renderContainers(d) {
    var accounts = list(d.accounts);
    var containers = list(d.containers);
    var placed = {};
    var cards = containers.map(function (c) {
      var mine = accounts.filter(function (a) { return inContainer(a, c); });
      mine.forEach(function (a) { placed[a.id] = true; });
      return { c: c, accounts: mine };
    });
    var loose = accounts.filter(function (a) { return !placed[a.id]; });
    if (loose.length) {
      cards.push({ c: { id: null, kind: "unknown", name: "Not sorted yet" }, accounts: loose });
    }
    var html = cards.map(function (x) {
      var c = x.c;
      var owed = owedFor(d, c);
      var label = CONTAINER_LABEL[c.kind] || "Not sorted yet";
      var name = c.name || label;
      return '<section class="card box" data-kind="' + esc(c.kind) + '">' +
        '<header class="box-head"><div><h3 class="box-name">' + esc(name) + '</h3>' +
        (name === label ? "" : '<span class="tag">' + esc(label) + '</span>') + '</div>' +
        '<div class="acct-num"><span class="num">' + esc(owed ? money(owed.owed_cents, owed.is_floor) : "—") + '</span>' +
        '<span class="caption">owed here</span></div></header>' +
        (x.accounts.length
          ? '<ul class="accts">' + x.accounts.map(function (a) { return accountRow(d, a); }).join("") + '</ul>'
          : '<p class="caption">No accounts in this container yet.</p>') +
        '</section>';
    }).join("");
    return '<section class="block" aria-labelledby="h-boxes"><h2 id="h-boxes">Your containers</h2>' +
      '<p class="caption">Each business is its own container. So is each person.</p>' +
      '<div class="grid boxes">' + html + '</div></section>';
  }

  function renderDebt(d) {
    var debt = d.debt || {};
    var rows = list(debt.by_container).map(function (r) {
      return '<li><span>' + esc(r.name || CONTAINER_LABEL[r.kind] || "Container") +
        ' <span class="caption">' + esc(CONTAINER_LABEL[r.kind] || "") + '</span></span>' +
        '<span class="num">' + esc(money(r.owed_cents, r.is_floor)) + '</span></li>';
    }).join("");
    var cards = list(debt.cards).map(function (c) {
      return '<tr><td>' + esc(c.name || "Card") + (c.mask ? ' <span class="mask">••' + esc(c.mask) + '</span>' : "") +
        '<div class="caption">' + esc(KIND_LABEL[c.kind] || "Not sure yet") + '</div></td>' +
        '<td class="r num">' + esc(money(c.balance_cents)) + '</td>' +
        '<td class="r num">' + esc(money(c.limit_cents)) + '</td>' +
        '<td class="r num">' + esc(money(c.room_cents)) + '</td>' +
        '<td class="r"><span class="num">' + esc(pct(c.used_pct)) + '</span>' + usedBar(c.used_pct) + '</td>' +
        '<td class="r num">' + esc(day(c.due_on)) + '</td>' +
        '<td class="r num">' + esc(money(c.min_due_cents)) + '</td>' +
        '<td class="r num">' + esc(money(c.past_due_cents)) + '</td></tr>';
    }).join("");
    return '<section class="block" aria-labelledby="h-debt"><h2 id="h-debt">Debt</h2>' +
      '<div class="grid debt">' +
      '<div class="card"><h3 class="eyebrow">By container</h3>' +
      (rows ? '<ul class="split">' + rows + '</ul>' : '<p class="caption">No debt on file.</p>') +
      '<p class="caption total-line">All debt: <span class="num">' + esc(money(debt.total_cents, debt.is_floor)) + '</span></p></div>' +
      '<div class="card"><h3 class="eyebrow">By card</h3>' +
      (cards
        ? '<div class="scroll-x"><table class="cards"><thead><tr><th>Card</th><th class="r">Owed</th><th class="r">Limit</th>' +
          '<th class="r">Room left</th><th class="r">Used</th><th class="r">Due</th><th class="r">Minimum</th><th class="r">Past due</th></tr></thead>' +
          '<tbody>' + cards + '</tbody></table></div>'
        : '<p class="caption">No cards connected.</p>') +
      '</div></div></section>';
  }

  /* One cashflow chart per kind. Personal and business never share a bar. */
  function chartFor(months, kind) {
    var vals = months.map(function (m) { return (m && m[kind]) || {}; });
    var max = 0;
    vals.forEach(function (v) {
      if (isNum(v.in_cents)) max = Math.max(max, v.in_cents);
      if (isNum(v.out_cents)) max = Math.max(max, v.out_cents);
    });
    var W = 64, H = 120, BW = 20;
    var bars = vals.map(function (v, i) {
      var x = i * W + 10;
      function bar(cents, cls, dx, word) {
        if (!isNum(cents)) {
          return '<text class="chart-dash" x="' + (x + dx + BW / 2) + '" y="' + (H - 4) + '" text-anchor="middle">—</text>';
        }
        var h = max > 0 ? Math.max(1, Math.round((cents / max) * (H - 10))) : 1;
        return '<rect class="' + cls + '" x="' + (x + dx) + '" y="' + (H - h) + '" width="' + BW + '" height="' + h + '">' +
          '<title>' + esc(monthName(months[i].month) + " " + word + ": " + money(cents)) + '</title></rect>';
      }
      return bar(v.in_cents, "bar-in", 0, "in") + bar(v.out_cents, "bar-out", BW + 4, "out") +
        '<text class="chart-label" x="' + (x + BW + 2) + '" y="' + (H + 16) + '" text-anchor="middle">' +
        esc(monthName(months[i].month, true)) + '</text>';
    }).join("");
    var svg = '<svg class="chart" viewBox="0 0 ' + Math.max(W * months.length, W) + ' ' + (H + 22) +
      '" role="img" aria-label="' + esc(KIND_LABEL[kind]) + ' money in and out by month">' +
      '<line class="chart-base" x1="0" y1="' + H + '" x2="' + (W * months.length) + '" y2="' + H + '"></line>' +
      bars + '</svg>';
    var rows = vals.map(function (v, i) {
      var net = isNum(v.in_cents) && isNum(v.out_cents) ? v.in_cents - v.out_cents : null;
      return '<tr><td>' + esc(monthName(months[i].month)) + '</td><td class="r num">' + esc(money(v.in_cents)) +
        '</td><td class="r num">' + esc(money(v.out_cents)) + '</td><td class="r num">' + esc(money(net)) + '</td></tr>';
    }).join("");
    return '<div class="card flow" data-kind="' + esc(kind) + '"><h3 class="eyebrow">' + esc(KIND_LABEL[kind]) + ' cashflow</h3>' +
      '<p class="legend caption"><span class="key key-in"></span>Money in <span class="key key-out"></span>Money out</p>' +
      svg +
      '<div class="scroll-x"><table class="flow-table"><thead><tr><th>Month</th><th class="r">In</th><th class="r">Out</th><th class="r">Left over</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function hasAny(months, kind) {
    return months.some(function (m) {
      var v = (m && m[kind]) || {};
      return isNum(v.in_cents) || isNum(v.out_cents);
    });
  }

  function renderCashflow(d) {
    var cf = d.cashflow || {};
    var months = list(cf.months).slice().sort(function (a, b) {
      return String(a.month).localeCompare(String(b.month));
    });
    var head = '<section class="block" aria-labelledby="h-flow"><h2 id="h-flow">Cashflow</h2>';
    if (cf.has_transactions !== true || !months.length) {
      return head + '<div class="card"><p class="flow-none">No bank activity yet</p>' +
        '<p class="caption">Money in and money out fill in here, month by month, once your bank sends charges and deposits.</p></div></section>';
    }
    var charts = chartFor(months, "personal") + chartFor(months, "business");
    var unknown = hasAny(months, "unknown") ? '<div class="grid one">' + chartFor(months, "unknown") + '</div>' : "";
    return head + '<p class="caption">Personal and business are shown apart, month over month.</p>' +
      '<div class="grid two">' + charts + '</div>' + unknown + '</section>';
  }

  function renderBills(d) {
    var bills = list(d.bills).slice().sort(function (a, b) {
      return String(a.next_on || "9999").localeCompare(String(b.next_on || "9999"));
    });
    var rows = bills.map(function (b) {
      return '<li class="row"><div><div>' + esc(b.name || "Bill") + '</div><div class="caption">' +
        esc([KIND_LABEL[b.kind] || "Not sure yet", b.cadence].filter(Boolean).join(" · ")) + '</div></div>' +
        '<div class="acct-num"><span class="num">' + esc(money(b.amount_cents)) + '</span>' +
        '<span class="caption">next ' + esc(day(b.next_on)) + '</span></div></li>';
    }).join("");
    return '<div class="card"><h3 class="eyebrow">Repeating bills</h3>' +
      (rows ? '<ul class="rows">' + rows + '</ul>' : '<p class="caption">No repeating bills found yet.</p>') + '</div>';
  }

  function renderUpcoming(d) {
    var rows = sortedUpcoming(d).map(function (u) {
      return '<li class="row"><div><div>' + esc(u.name || "") + '</div><div class="caption">' +
        esc(u.type === "card_due" ? "Card payment" : "Bill") + '</div></div>' +
        '<div class="acct-num"><span class="num">' + esc(day(u.on)) + '</span>' +
        '<span class="caption">' + esc(money(u.amount_cents)) + '</span></div></li>';
    }).join("");
    return '<div class="card"><h3 class="eyebrow">Coming up</h3>' +
      (rows ? '<ul class="rows">' + rows + '</ul>' : '<p class="caption">No due dates on file yet.</p>') + '</div>';
  }

  function renderBilling(d) {
    var b = d.billing || {};
    var n = isNum(b.containers) ? b.containers : list(d.containers).length;
    var price = isNum(b.price_per_container_cents)
      ? money(b.price_per_container_cents) + " per container · " + money(b.price_per_container_cents * n) + " a month"
      : "$X per container";
    return '<p class="billing caption">Your plan: ' + esc(plural(n, "container", "containers")) + ' · ' + esc(price) + '</p>';
  }

  /* ── whole states ──────────────────────────────────────────────────────── */

  function isEmpty(d) { return !d || list(d.accounts).length === 0; }

  function renderHead(d, showButton) {
    var who = d && d.client && d.client.name ? d.client.name : "";
    var asOf = d ? stamp(d.as_of) : "";
    return '<div class="head"><div><h1>Money</h1><p class="caption">' +
      esc([who, asOf ? "as of " + asOf : ""].filter(Boolean).join(" · ") || "What you have, what you owe, and what is next") +
      '</p></div>' +
      (showButton ? '<div class="head-act"><button class="btn-primary" type="button" data-act="connect">Connect a bank</button>' +
        '<p class="act-msg caption" aria-live="polite"></p></div>' : "") + '</div>';
  }

  function renderFull(d) {
    return renderSandbox(d) + renderHead(d, true) + renderTiles(d) + renderTip(d) +
      '<div class="grid two">' + renderUpcoming(d) + renderBills(d) + '</div>' +
      renderContainers(d) + renderDebt(d) + renderCashflow(d) + renderBilling(d);
  }

  function renderEmpty(d) {
    return renderSandbox(d) + renderHead(d, false) +
      '<section class="card empty"><h2>No bank accounts yet</h2>' +
      '<p>Connect a bank to see what you have, what you owe, and what is due next. ' +
      'Fundhub only reads your accounts. It never moves money.</p>' +
      '<div class="head-act"><button class="btn-primary" type="button" data-act="connect">Connect a bank</button>' +
      '<p class="act-msg caption" aria-live="polite"></p></div></section>' +
      (d ? renderBilling(d) : "");
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<div class="head"><div><h1>Money</h1><p class="caption">Loading your accounts…</p></div></div>' +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + tile + '</div>' +
      '<div class="grid two"><div class="card skel"><span class="sk sk-m"></span><span class="sk sk-l"></span></div>' +
      '<div class="card skel"><span class="sk sk-m"></span><span class="sk sk-l"></span></div></div>';
  }

  /* Say what failed in the person's words, and what to do next. */
  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your accounts. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this money page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose money to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Money</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your money page</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function render(d) { return isEmpty(d) ? renderEmpty(d) : renderFull(d); }

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

  /* Same split data.js makes: only the database speaking for itself is "nodb". */
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

  /* Who signs in where. Clients get the mail-me-a-link page; staff (a cached
     staff role, or a ?client_id= in the bar) get the password page and come
     back here. Same split shell.js signInUrl() makes. */
  function signInUrl() {
    var role = "";
    try { role = root.localStorage.getItem("fh_role") || ""; } catch (e) {}
    var staffish = (role && role !== "client") || !!param("client_id");
    return staffish
      ? "/login.html?next=" + encodeURIComponent(root.location.pathname + root.location.search)
      : "/portal-login.html";
  }

  function loadPlaid() {
    if (root.Plaid) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = root.document.createElement("script");
      s.src = PLAID_SRC;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("plaid_script")); };
      root.document.head.appendChild(s);
    });
  }

  var LINK_WORDS = {
    signin: "You are signed out. Sign in and try again.",
    forbidden: "This account is not allowed to connect a bank here.",
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Bank connections are not working right now. Try again in a few minutes.",
    needclient: "Open this page from a client's file first.",
    badrequest: "That request was not accepted.",
    notfound: "We could not find that client file."
  };

  function linkWords(res) {
    if (res.status === 503 && res.body && res.body.error === "not_configured") {
      return "Bank connections are not set up yet.";
    }
    return LINK_WORDS[classify(res)] || LINK_WORDS.server;
  }

  /* ── the section ───────────────────────────────────────────────────────────
     window.FinanceOS.sections.overview.mount(el, ctx) — the one-page FinanceOS
     (/app/financeos.html) mounts this into its Overview tab. No header, no
     nav: only the section. ctx = { clientId, apiGet(path), apiPost(path, body) };
     apiGet/apiPost resolve to { status, body }. Any of them may be left out,
     and the section then uses its own fetch and ?client_id= from the URL.
     Returns { reload } so the host can refresh it. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : function (p) { return call("GET", p); };
    var post = typeof ctx.apiPost === "function" ? ctx.apiPost : function (p, b) { return call("POST", p, b); };
    var asked = ctx.clientId || param("client_id") || "";
    var state = { data: null, clientId: asked };

    function paint(html) { el.innerHTML = html; }

    function load() {
      state.clientId = asked;
      paint(renderLoading());
      return Promise.resolve(get(READ_PATH + (asked ? "?client_id=" + encodeURIComponent(asked) : ""))).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        state.data = res.body;
        if (!asked && res.body.client && res.body.client.id) state.clientId = res.body.client.id;
        paint(render(res.body));
      });
    }

    function connect(btn) {
      var msg = btn.parentNode.querySelector(".act-msg");
      function say(t) { if (msg) msg.textContent = t; }
      function done(label) { btn.disabled = false; btn.textContent = label || "Connect a bank"; }
      btn.disabled = true;
      btn.textContent = "Opening your bank…";
      say("");
      var body = state.clientId ? { client_id: state.clientId } : {};
      Promise.resolve(post("/api/banking/link-token", body)).then(function (res) {
        if (classify(res) !== "ok" || !res.body.link_token) { done(); say(linkWords(res)); return; }
        return loadPlaid().then(function () {
          var handler = root.Plaid.create({
            token: res.body.link_token,
            onSuccess: function (publicToken, metadata) {
              btn.textContent = "Saving your bank…";
              var inst = metadata && metadata.institution
                ? { institution_id: metadata.institution.institution_id || null, name: metadata.institution.name || null }
                : null;
              var ex = { public_token: publicToken, institution: inst };
              if (state.clientId) ex.client_id = state.clientId;
              Promise.resolve(post("/api/banking/link-exchange", ex)).then(function (r2) {
                if (classify(r2) !== "ok") { done(); say(linkWords(r2)); return; }
                say("Bank connected. Loading your accounts…");
                load();
              });
            },
            onExit: function (err) {
              done();
              if (err) say("The bank window closed before it finished. Nothing was saved.");
            }
          });
          handler.open();
        }, function () {
          done();
          say("The bank sign-in window did not load. Check your connection and try again.");
        });
      });
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t))) return;
      if (t.getAttribute("data-act") === "connect") connect(t);
      if (t.getAttribute("data-act") === "retry") load();
    });

    load();
    return { reload: load };
  }

  /* Staff carry ?client_id= on a nav link. The query goes before any #tab. */
  function withClientHref(href, cid) {
    var parts = String(href).split("#");
    var base = parts[0].split("?")[0] + "?client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  /* ── the standalone page (/app/money.html) — a thin shell ──────────────── */
  function init() {
    var el = root.document.getElementById("money-root");
    if (!el) return;
    /* Staff open this page with ?client_id=. Carry it on the money nav so the
       next money page opens on the same file instead of asking whose it is. */
    if (param("client_id")) {
      var navLinks = root.document.querySelectorAll(".mnav a[href]");
      for (var i = 0; i < navLinks.length; i++) {
        navLinks[i].setAttribute("href", withClientHref(navLinks[i].getAttribute("href"), param("client_id")));
      }
    }
    var back = root.document.getElementById("money-back");
    if (back && param("client_id")) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(param("client_id")));
      back.textContent = "Back to Finance OS";
    }
    mount(el, { clientId: param("client_id") });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.overview = { title: "Overview", mount: mount };

  root.FHMoney = {
    money: money, day: day, pct: pct, isEmpty: isEmpty, render: render,
    renderFull: renderFull, renderEmpty: renderEmpty, renderError: renderError,
    renderLoading: renderLoading, classify: classify, mount: mount
  };

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
