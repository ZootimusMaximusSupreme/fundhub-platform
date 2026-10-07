/* Banks — FinanceOS bank strategy (/app/money-banks.html, FinanceOS wave 5 W2).
 *
 * Reads ONE endpoint, GET /api/money/banks, and paints four parts:
 *   Banks near you · Card stacking order · Next funding round · Your bank relationships
 * Every figure and every rule is a field from that read. Each rule carries the
 * source it came from (the bank book row, the bank match, the funding order,
 * Next Funding Sequence, UnderwriteIQ) and the screen prints it beside the rule.
 *
 * THE HONESTY RULES (same as money.js):
 *   - Money arrives as integer cents. A null paints "Not set" or "—", never $0.00.
 *   - Status is said in words ("Planned", "Open · 12 of 30 days seasoned"),
 *     never by colour alone.
 *   - A value with no rule behind it says "Not set". Nothing is filled in.
 *   - Nothing here moves money. Staff write down what they saw happen.
 *
 * Staff (a ?client_id= in the bar, FINANCE role on the server) also see the
 * plan controls: add a bank to the plan, mark it opened, add a deposit, skip it,
 * set the next-round date. A client never does — and the server refuses every
 * POST from a client session anyway.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-banks-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var READ_PATH = "/api/money/banks";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var KIND_WORD = { business: "Business", personal: "Personal" };

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
    return (neg ? "−$" : "$") + dollars + (c === "00" ? "" : "." + c);
  }

  /* "2026-10-21" → "Oct 21, 2026", read as a calendar date. */
  function day(iso, noYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (noYear ? "" : ", " + m[1]);
  }

  /* "500" / "1,500.50" → cents, no float maths. null when not money. */
  function toCents(text) {
    var s = String(text == null ? "" : text).replace(/[$,\s]/g, "");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var frac = (m[2] || "") + "00";
    return Number(m[1]) * 100 + Number(frac.slice(0, 2));
  }

  /* cents → "5000.00" for an input's starting value. */
  function centsToInput(cents) {
    if (!isNum(cents)) return "";
    return (cents / 100).toFixed(2);
  }

  /* The source of a rule, printed beside it. Hover shows the exact book row. */
  function src(s) {
    if (!s || !s.label) return "";
    return ' <span class="src caption" title="' + esc(s.ref || "") + '">Source: ' + esc(s.label) + "</span>";
  }

  function notSet(textWords) {
    return '<span class="not-set">' + esc(textWords || "Not set") + "</span>";
  }

  /* ── head + tiles ──────────────────────────────────────────────────────── */

  function where(d) {
    var loc = (d && d.location) || {};
    return loc.text || (list(loc.states).length ? list(loc.states).join(" and ") : "");
  }

  function renderHead(d) {
    var who = d && d.client && d.client.name ? d.client.name : "";
    var place = where(d);
    var line = (place ? "Banks to open near " + place : "Banks to open near you") +
      ", the order to apply for cards, and your next funding round";
    return '<div class="head"><div><h1>Banks</h1><p class="caption">' + esc(who ? who + " · " + line : line) + "</p></div></div>";
  }

  function renderTiles(d) {
    var nr = (d && d.next_round) || {};
    var rels = list(d && d.relationships).filter(function (r) { return r.status !== "skipped"; });
    var opened = rels.filter(function (r) { return !!r.opened_on; }).length;
    var round = '<section class="card tile" aria-labelledby="bk-t-round"><h2 class="eyebrow" id="bk-t-round">Next funding round</h2>' +
      '<span class="big">' + (nr.date ? esc(day(nr.date)) : "Not set") + "</span>" +
      '<p class="caption">' + (nr.date ? esc(plural(list(nr.readiness_gaps).length, "thing", "things") + " left to do") : "Staff set this date") + "</p></section>";
    var amount = '<section class="card tile" aria-labelledby="bk-t-amt"><h2 class="eyebrow" id="bk-t-amt">Estimated amount</h2>' +
      '<span class="big">' + (isNum(nr.estimated_amount_cents) ? esc(money(nr.estimated_amount_cents)) : "Not worked out yet") + "</span>" +
      '<p class="caption">' + (nr.amount_source ? esc(nr.amount_source.label) : "Needs a credit pull on file") + "</p></section>";
    var near = list(d && d.recommended_banks).length;
    var relTile = '<section class="card tile" aria-labelledby="bk-t-rel"><h2 class="eyebrow" id="bk-t-rel">Bank relationships</h2>' +
      '<span class="big">' + esc(opened + " open") + "</span>" +
      '<p class="caption">' + esc("of " + plural(rels.length, "bank", "banks") + " on your plan · " + plural(near, "bank", "banks") + " near you") + "</p></section>";
    return '<div class="grid tiles">' + round + amount + relTile + "</div>";
  }

  /* ── banks near you ────────────────────────────────────────────────────── */

  function onPlan(d, name) {
    var key = String(name || "").trim().toLowerCase();
    return list(d && d.relationships).filter(function (r) { return r.bank_key === key && r.status !== "skipped"; })[0] || null;
  }

  function containerSelect(d, kind) {
    var opts = list(d && d.containers).filter(function (c) { return !kind || c.kind === kind; });
    if (!opts.length) return "";
    return '<label class="field"><span class="caption">Container</span><select name="container_id">' +
      opts.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") +
      "</select></label>";
  }

  /* The deposit box starts empty. Left empty, the plan uses the bank book's own
     minimum (and says so); a typed amount is staff's own number. Either way the
     source of the amount stays true. */
  function renderPlanForm(d, b) {
    var dep = isNum(b.minimum_deposit_cents) ? b.minimum_deposit_cents : null;
    return '<div class="staff"><span class="eyebrow">Staff only · Add to plan</span>' +
      '<form data-form="plan" data-lender="' + esc(b.lender_id || "") + '" data-bank="' + esc(b.name) + '">' +
      containerSelect(d, "business") +
      '<label class="field"><span class="caption">Day to open</span><input name="planned_open_on" type="date"></label>' +
      '<label class="field"><span class="caption">' + esc(dep !== null ? "Deposit ($) · blank = book's " + money(dep) : "Deposit ($)") + "</span>" +
      '<input name="deposit" inputmode="decimal" placeholder="' + esc(dep !== null ? centsToInput(dep) : "Not set") + '"></label>' +
      '<button class="btn-line" type="submit">Add to plan</button>' +
      '</form><p class="act-msg caption" aria-live="polite"></p></div>';
  }

  function renderBank(d, b, staff) {
    var why = list(b.why).map(function (w) { return "<li>" + esc(w.text) + src(w.source) + "</li>"; }).join("");
    var steps = list(b.relationship_steps).map(function (s) {
      var how = s.how ? '<span class="how caption">' + esc(s.how.text) + src(s.how.source) + "</span>" : "";
      return '<li class="' + (s.not_set ? "is-not-set" : "") + '"><span>' + esc(s.text) + src(s.source) + "</span>" + how + "</li>";
    }).join("");
    var rel = onPlan(d, b.name);
    var planLine = rel
      ? '<p class="on-plan"><span class="tag">On your plan</span> <span class="caption">' + esc(rel.status_text) + "</span></p>"
      : (staff ? renderPlanForm(d, b) : "");
    return '<article class="card bank" data-bank="' + esc(b.name) + '">' +
      '<div class="bank-head"><div><p class="bank-name">' + esc(b.name) + "</p>" +
      '<p class="caption">' + esc(list(b.products).join(" · ")) + "</p></div>" +
      (b.tier != null ? '<span class="tag">Tier ' + esc(b.tier) + "</span>" : "") + "</div>" +
      '<dl class="facts"><div><dt class="caption">Deposit</dt><dd class="num">' +
      (isNum(b.minimum_deposit_cents) ? esc(money(b.minimum_deposit_cents)) : notSet()) + "</dd></div>" +
      '<div><dt class="caption">Season it</dt><dd class="num">' +
      (isNum(b.seasoning_days) ? esc(b.seasoning_days + "+ days") : notSet("Not in the book")) + "</dd></div>" +
      '<div><dt class="caption">Serves</dt><dd>' + esc(b.serves_state || "—") + "</dd></div></dl>" +
      '<div><h3 class="eyebrow">Steps</h3><ol class="steps">' + steps + "</ol></div>" +
      '<div><h3 class="eyebrow">Why this bank</h3><ul class="why">' + why + "</ul></div>" +
      planLine + "</article>";
  }

  function renderBanks(d, staff) {
    var banks = list(d && d.recommended_banks);
    var loc = (d && d.location) || {};
    var place = where(d);
    var head = '<section class="block" aria-labelledby="bk-near"><h2 id="bk-near">Banks near you</h2>' +
      '<p class="caption">' + esc(place ? "Banks in our bank book that serve " + place + " and want an account before you apply." :
        "Banks in our bank book that want an account before you apply.") + src(loc.source) + "</p>";
    var body;
    if (!list(loc.states).length) {
      body = '<section class="card empty"><h3>We do not know your state yet</h3>' +
        '<p>Banks near you need a state. Add your business address under Accounts, or your home address when you set up.</p>' +
        '<a class="btn-line" href="/app/financeos.html#accounts">Add business info</a></section>';
    } else if (!banks.length) {
      body = '<section class="card empty"><h3>No bank near you asks for an account first</h3>' +
        "<p>None of the banks in our bank book that serve " + esc(place) + " list an account, a deposit or seasoning before you apply. " +
        "The card list below still applies.</p></section>";
    } else {
      body = '<div class="banks">' + banks.map(function (b) { return renderBank(d, b, staff); }).join("") + "</div>";
    }
    var left = list(d && d.banks_left_out);
    var leftLine = left.length
      ? '<p class="caption left-out">Not listed here: ' + esc(left.map(function (x) { return x.name; }).join(", ")) +
        ". The bank book says no account is needed there, so they are in the card list instead.</p>"
      : "";
    return head + body + leftLine + "</section>";
  }

  /* ── card stacking ─────────────────────────────────────────────────────── */

  function renderStackItem(it) {
    var others = list(it.other_cards);
    var why = list(it.why).map(function (w) { return "<li>" + esc(w.text) + src(w.source) + "</li>"; }).join("");
    var gate = it.relationship_gate ? '<p class="gate">' + esc(it.relationship_gate.text) + src(it.relationship_gate.source) + "</p>" : "";
    var spacing = it.spacing_rule
      ? esc(it.spacing_rule.text) + src(it.spacing_rule.source)
      : notSet("Not set for this bank");
    return '<li class="card stack-row">' +
      '<span class="stack-n num" aria-label="' + esc("Step " + it.order) + '">' + esc(it.order) + "</span>" +
      '<div class="stack-main"><p class="bank-name">' + esc(it.issuer) + ' <span class="tag">' + esc(KIND_WORD[it.kind] || "") + "</span></p>" +
      '<p class="caption">' + esc(it.card) + (others.length ? esc(" · also " + others.join(", ")) : "") + "</p>" +
      (why ? '<ul class="why">' + why + "</ul>" : "") + gate + "</div>" +
      '<dl class="stack-side"><div><dt class="caption">Spacing</dt><dd>' + spacing + "</dd></div>" +
      '<div><dt class="caption">Inquiry</dt><dd>' + esc(it.inquiry_impact ? it.inquiry_impact.text : "—") +
      (it.inquiry_impact ? src(it.inquiry_impact.source) : "") + "</dd></div></dl></li>";
  }

  function renderStacking(d) {
    var s = (d && d.card_stacking) || {};
    var items = list(s.items);
    var rule = s.order_rule || {};
    var ruleSrc = list(rule.sources).map(src).join("");
    var engine = s.engine || {};
    var inq = s.inquiries || {};
    var counts = (isNum(s.personal_banks) || isNum(s.business_banks))
      ? "Showing " + items.length + " of " + plural((s.personal_banks || 0) + (s.business_banks || 0), "bank", "banks") +
        " the bank match keeps for you (" + plural(s.total_cards || 0, "card", "cards") + " in all)."
      : "";
    var body = items.length
      ? '<ol class="stack">' + items.map(renderStackItem).join("") + "</ol>"
      : '<section class="card empty"><h3>No cards fit your file yet</h3><p>No card in our bank book serves your state. When your state is on file, the order shows here.</p></section>';
    return '<section class="block" aria-labelledby="bk-stack"><h2 id="bk-stack">Card stacking order</h2>' +
      '<p class="caption">' + esc(rule.text || "") + ruleSrc + "</p>" +
      '<div class="grid two notes">' +
      '<div class="card note-card"><h3 class="eyebrow">Can you card stack?</h3><p>' +
      (engine.can_card_stack === true ? "Yes. " : engine.can_card_stack === false ? "Not yet. " : "") + esc(engine.rule || "") + src(engine.source) + "</p>" +
      (isNum(engine.card_funding_cents) ? '<p class="caption">UnderwriteIQ card funding: ' + esc(money(engine.card_funding_cents)) + "</p>" : "") + "</div>" +
      '<div class="card note-card"><h3 class="eyebrow">Inquiries</h3><p>' + esc(inq.text || "") + src(inq.source) + "</p>" +
      (inq.rule ? "<p>" + esc(inq.rule.text) + src(inq.rule.source) + "</p>" : "") + "</div>" +
      "</div>" +
      (s.spacing ? '<div class="card spacing"><h3 class="eyebrow">Spacing</h3><p>' + esc(s.spacing.text) + src(s.spacing.source) + "</p>" +
        (s.spacing.days_text ? '<p class="caption">' + esc(s.spacing.days_text) + "</p>" : "") + "</div>" : "") +
      body + (counts ? '<p class="caption">' + esc(counts) + "</p>" : "") + "</section>";
  }

  /* ── next funding round ────────────────────────────────────────────────── */

  function renderRound(d, staff) {
    var nr = (d && d.next_round) || {};
    var gaps = list(nr.readiness_gaps);
    var gapList = gaps.length
      ? '<ul class="gaps">' + gaps.map(function (g) { return "<li><span>" + esc(g.text) + src(g.source) + "</span></li>"; }).join("") + "</ul>"
      : '<p class="caption">Nothing left on the list.</p>';
    var dateForm = staff && nr.can_set_date
      ? '<div class="staff"><span class="eyebrow">Staff only · Next round date</span>' +
        '<form data-form="round"><label class="field"><span class="caption">Ready date</span><input name="ready_date" type="date" value="' + esc(nr.date || "") + '" required></label>' +
        '<button class="btn-line" type="submit">Save date</button></form><p class="act-msg caption" aria-live="polite"></p></div>'
      : (staff ? '<p class="caption">The next-round date is part of the Capital Blueprint. This client has not bought it, so it stays not set.</p>' : "");
    return '<section class="block" aria-labelledby="bk-round"><h2 id="bk-round">Next funding round</h2>' +
      '<p class="caption">When your file is ready for the next round, how much, and what is left to do.</p>' +
      '<div class="card round">' +
      '<dl class="facts"><div><dt class="caption">Date</dt><dd class="big">' + (nr.date ? esc(day(nr.date)) : "Not set") + "</dd>" +
      (nr.date_source ? "<dd>" + src(nr.date_source) + "</dd>" : '<dd class="caption">Staff set it (Next Funding Sequence).</dd>') + "</div>" +
      '<div><dt class="caption">Estimated amount</dt><dd class="big">' + (isNum(nr.estimated_amount_cents) ? esc(money(nr.estimated_amount_cents)) : "Not worked out yet") + "</dd>" +
      (nr.amount_source ? "<dd>" + src(nr.amount_source) + "</dd>" : '<dd class="caption">UnderwriteIQ works it out from a credit pull.</dd>') + "</div>" +
      '<div><dt class="caption">Step you are on</dt><dd>' + esc(nr.step && nr.step.title ? nr.step.title : "—") + "</dd>" +
      (nr.step ? "<dd>" + src(nr.step.source) + "</dd>" : "") + "</div></dl>" +
      '<div><h3 class="eyebrow">What is left to do</h3>' + gapList + "</div>" + dateForm + "</div></section>";
  }

  /* ── your bank relationships ───────────────────────────────────────────── */

  function statusPill(r) {
    return '<span class="status st-' + esc(r.status) + '">' + esc(r.status_text) + "</span>";
  }

  function rowControls(r) {
    if (r.status === "skipped") return "";
    if (!r.opened_on) {
      /* Planned: mark it opened, or skip it. Marked done with no day: record the day. */
      var skip = r.status === "planned"
        ? '<button class="btn-text" type="button" data-act="skip" data-rel="' + esc(r.id) + '" data-name="' + esc(r.bank) + '">Skip this bank</button>'
        : "";
      return '<div class="staff row-staff"><form data-form="open" data-rel="' + esc(r.id) + '">' +
        '<label class="field"><span class="caption">Day opened</span><input name="opened_on" type="date" required></label>' +
        '<button class="btn-line" type="submit">' + (r.status === "planned" ? "Mark opened" : "Save the day opened") + "</button>" +
        skip + '</form><p class="act-msg caption" aria-live="polite"></p></div>';
    }
    return '<div class="staff row-staff"><form data-form="deposit" data-rel="' + esc(r.id) + '">' +
      '<label class="field"><span class="caption">Deposit ($)</span><input name="amount" inputmode="decimal" placeholder="5000.00" required></label>' +
      '<label class="field"><span class="caption">Day</span><input name="deposited_on" type="date" required></label>' +
      '<button class="btn-line" type="submit">Add deposit</button>' +
      '</form><p class="act-msg caption" aria-live="polite"></p></div>';
  }

  function renderRelationship(r, staff) {
    var deps = list(r.deposits);
    var plan = r.opened_on
      ? (isNum(r.deposits_total_cents) ? esc(money(r.deposits_total_cents)) + ' <span class="caption">' + esc(plural(deps.length, "deposit", "deposits")) + "</span>" : '<span class="caption">None recorded yet</span>')
      : (isNum(r.deposit_plan_cents) ? esc(money(r.deposit_plan_cents)) + (r.deposit_plan_source ? src(r.deposit_plan_source) : "") : notSet());
    var opened = r.opened_on ? esc(day(r.opened_on)) : (r.planned_open_on ? "Plan: " + esc(day(r.planned_open_on)) : notSet("Day not set"));
    var history = isNum(r.months_of_history) ? esc(plural(r.months_of_history, "month", "months")) : "—";
    var season = r.seasoning
      ? '<span class="caption">' + esc(r.seasoning.days + "+ days") + src(r.seasoning.source) + "</span>"
      : '<span class="caption">Not in the bank book</span>';
    return '<tr data-rel="' + esc(r.id) + '"><td><span class="bank-name">' + esc(r.bank) + "</span><br>" +
      '<span class="caption">' + esc((KIND_WORD[r.account_kind] || "") + (r.container_name ? " · " + r.container_name : "")) + "</span></td>" +
      "<td>" + statusPill(r) + "</td><td>" + opened + '</td><td class="r num">' + history + "</td>" +
      '<td class="r">' + plan + "</td><td>" + season + "</td></tr>" +
      (staff && r.status !== "skipped" ? '<tr class="ctl-row"><td colspan="6">' + rowControls(r) + "</td></tr>" : "");
  }

  function renderAddBank(d) {
    return '<section class="card staff addbank" aria-labelledby="bk-add"><h3 class="eyebrow" id="bk-add">Staff only · Add a bank to the plan</h3>' +
      '<form data-form="plan">' +
      '<label class="field"><span class="caption">Bank</span><input name="bank" placeholder="Bank name" required></label>' +
      '<label class="field"><span class="caption">Kind</span><select name="account_kind"><option value="business">Business</option><option value="personal">Personal</option></select></label>' +
      containerSelect(d, null) +
      '<label class="field"><span class="caption">Day to open</span><input name="planned_open_on" type="date"></label>' +
      '<label class="field"><span class="caption">Deposit ($)</span><input name="deposit" inputmode="decimal" placeholder="Not set"></label>' +
      '<button class="btn-line" type="submit">Add bank to plan</button>' +
      '</form><p class="act-msg caption" aria-live="polite"></p></section>';
  }

  function renderRelationships(d, staff) {
    var rels = list(d && d.relationships);
    var body = rels.length
      ? '<div class="card"><div class="scroll-x"><table><caption class="caption">Each bank on your plan, what is done, and the money you put in.</caption>' +
        '<thead><tr><th>Bank</th><th>Status</th><th>Opened</th><th class="r">History</th><th class="r">Deposits / plan</th><th>Seasoning</th></tr></thead>' +
        "<tbody>" + rels.map(function (r) { return renderRelationship(r, staff); }).join("") + "</tbody></table></div></div>"
      : '<section class="card empty"><h3>No banks on your plan yet</h3>' +
        "<p>When a bank is added to your plan, it shows here with the day to open it, the deposit, and how long your history there is.</p>" +
        (staff ? "" : "<p>Your advisor adds banks to your plan.</p>") + "</section>";
    return '<section class="block" aria-labelledby="bk-rel"><h2 id="bk-rel">Your bank relationships</h2>' +
      '<p class="caption">Accounts you open and keep money in build your banking history before you apply.</p>' +
      body + (staff ? renderAddBank(d) : "") + "</section>";
  }

  function renderNotSet(d) {
    var items = list(d && d.not_set);
    if (!items.length) return "";
    return '<section class="card notset" aria-labelledby="bk-ns"><h2 class="eyebrow" id="bk-ns">Not set yet</h2>' +
      '<p class="caption">No Fundhub rule sets these. Staff set them, and until then they stay blank.</p>' +
      '<ul class="ns-list">' + items.map(function (x) { return "<li>" + esc(x.text) + "</li>"; }).join("") + "</ul></section>";
  }

  function render(d, opts) {
    var staff = !!(opts && opts.staff);
    return renderHead(d) + renderTiles(d) + renderBanks(d, staff) + renderStacking(d) +
      renderRound(d, staff) + renderRelationships(d, staff) + renderNotSet(d);
  }

  function renderLoading() {
    var tile = '<div class="card tile skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    var bank = '<div class="card bank skel"><span class="sk sk-m"></span><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span></div>';
    return '<div class="head"><div><h1>Banks</h1><p class="caption">Loading your bank plan…</p></div></div>' +
      '<div class="grid tiles" aria-busy="true">' + tile + tile + tile + "</div>" +
      '<div class="banks" aria-busy="true">' + bank + bank + "</div>";
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your bank plan. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose bank plan to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h1>Banks</h1></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your bank plan</h2>' +
      "<p>" + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + "</p>" +
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

  /* ── the section: window.FinanceOS.sections.banks ────────────────────────
     mount(el, ctx) paints this section into `el` and wires its buttons. No
     page chrome — no header, no nav. ctx = { clientId, apiGet, apiPost }:
       clientId  staff only (a staff desk passes it; a client session leaves it
                 empty — the server pins a client to their own file)
       apiGet(path) / apiPost(path, body)
                 → Promise of { status, body } (or of the parsed body alone).
     Missing api functions fall back to this file's own fetch. The standalone
     page (/app/money-banks.html) is a thin shell that calls mount().
     Section styles: money-banks.css, every rule under .fh-banks. */

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

    function paint(html) { el.innerHTML = '<div class="fh-banks">' + html + "</div>"; }

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
      if (act === "skip") {
        var name = t.getAttribute("data-name") || "this bank";
        if (!root.confirm("Take " + name + " off the plan? You can add it back later.")) return;
        var msg = t.closest(".staff").querySelector(".act-msg");
        post({ action: "set_state", relationship_id: t.getAttribute("data-rel"), state: "skipped" }, msg, t, "Taken off the plan.")
          .then(function (ok) { if (ok) load(); });
      }
    }

    function onSubmit(e) {
      var f = e.target;
      if (!f || !f.getAttribute || !f.getAttribute("data-form")) return;
      e.preventDefault();
      var kind = f.getAttribute("data-form");
      var msg = f.parentNode.querySelector(".act-msg");
      var btn = f.querySelector('button[type="submit"]');
      var els = f.elements;
      if (kind === "plan") {
        var depText = els.deposit ? String(els.deposit.value || "").trim() : "";
        var cents = depText ? toCents(depText) : null;
        if (depText && cents === null) { msg.textContent = "Type the deposit like 5000.00, or leave it blank."; return; }
        var body = {
          action: "plan_bank",
          bank: f.getAttribute("data-bank") || (els.bank ? els.bank.value : ""),
          account_kind: els.account_kind ? els.account_kind.value : "business",
          planned_open_on: els.planned_open_on && els.planned_open_on.value ? els.planned_open_on.value : null,
          planned_deposit_cents: cents
        };
        if (f.getAttribute("data-lender")) body.lender_id = f.getAttribute("data-lender");
        if (els.container_id && els.container_id.value) body.container_id = els.container_id.value;
        post(body, msg, btn, "Added to the plan.").then(function (ok) { if (ok) load(); });
      }
      if (kind === "open") {
        post({ action: "open_account", relationship_id: f.getAttribute("data-rel"), opened_on: els.opened_on.value },
          msg, btn, "Marked opened.").then(function (ok) { if (ok) load(); });
      }
      if (kind === "deposit") {
        var amt = toCents(els.amount.value);
        if (!amt) { msg.textContent = "Type the amount deposited, like 5000.00"; return; }
        post({ action: "record_deposit", relationship_id: f.getAttribute("data-rel"), amount_cents: amt, deposited_on: els.deposited_on.value },
          msg, btn, "Deposit recorded.").then(function (ok) { if (ok) load(); });
      }
      if (kind === "round") {
        post({ action: "set_next_round_date", ready_date: els.ready_date.value }, msg, btn, "Date saved.")
          .then(function (ok) { if (ok) load(); });
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
    var el = root.document.getElementById("banks-root");
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
        var parts = a.getAttribute("href").split("#");
        var href = parts[0] + "?client_id=" + encodeURIComponent(cid);
        a.setAttribute("href", parts.length > 1 ? href + "#" + parts.slice(1).join("#") : href);
      });
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.banks = { title: "Banks", mount: mount, render: render };

  root.FHMoneyBanks = {
    money: money, day: day, toCents: toCents, render: render, renderError: renderError,
    renderLoading: renderLoading, classify: classify, mount: mount
  };

  /* Auto-start only finds #banks-root on the standalone page. A combined
     FinanceOS page calls FinanceOS.sections.banks.mount() itself. */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
