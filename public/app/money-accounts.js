/* Accounts — the client's containers and accounts (/app/money-accounts.html).
 *
 * Reads and writes ONE endpoint, /api/money/accounts. Every POST answers with
 * the whole view, and the page repaints from it. Nothing here invents a
 * number: every figure is a field from that read.
 *
 * Honesty rules, same as money.js:
 *   - Money is integer cents. A null is "we do not have this number" and
 *     paints "—", never $0.00.
 *   - Only the last 4 of an account or an EIN is ever asked for.
 *
 * Business gas cards (wave 4, unit GAS) sit under each business: fuel-cards.js
 * draws the read's fuel_cards, and its "Track it" form posts through onSubmit
 * like every other form here.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-accounts-screen.test.mjs can run them in Node. init() is the
 * only part that needs a browser.
 */
(function (root) {
  "use strict";

  var API = "/api/money/accounts";
  var PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
  var ENTITY_TYPES = [
    ["llc", "LLC"], ["s_corp", "S corporation"], ["c_corp", "C corporation"],
    ["sole_prop", "Sole proprietor"], ["partnership", "Partnership"],
    ["nonprofit", "Nonprofit"], ["other", "Other"]
  ];
  var HAND_TYPES = [["checking", "Checking"], ["savings", "Savings"], ["credit_card", "Credit card"], ["loan", "Loan"]];
  /* "Just record it" (unit TL, POST add_tradeline): the types the server takes
     (src/finance/tradeline-inventory.mjs ENTRY_TYPES), used until the What you
     have card hands over the read's own list. A limit rides only on a card or a line. */
  var RECORD_TYPES = [
    { value: "credit_card", label: "Credit card", limit: true }, { value: "line_of_credit", label: "Line of credit", limit: true },
    { value: "loan", label: "Loan", limit: false }, { value: "checking", label: "Checking", limit: false },
    { value: "savings", label: "Savings", limit: false }
  ];
  /* One add form, two ways to save (unit TL patch 6). */
  var MODE_HELP = { track: "It joins your balances.", record: "It shows in What you have. No balance." };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  function label(pairs, v) {
    for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === v) return pairs[i][1];
    return v == null ? "" : String(v);
  }

  /* "2021-03" or "2021-03-15" → "Mar 2021" */
  function monthYear(v) {
    var m = /^(\d{4})-(\d{2})/.exec(String(v || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : "";
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function phone(v) {
    var d = String(v || "").replace(/\D/g, "");
    return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : String(v || "");
  }

  function isOpen(a) { return a && !a.closed_at; }

  /* The bank's own logo beside the account (bank-logo.js). Nothing when the
     read has none, or when the helper is not on the page. */
  function bankLogo(a) {
    var L = root.FHBankLogo;
    return L && a ? L.html(a.logo, a.institution || a.name) : "";
  }
  function holdings(c) {
    return list(c && c.accounts).concat(list(c && c.cards), list(c && c.loans));
  }
  /* "Fundhub LLC (business)". A name that already says its kind is left alone. */
  function containerLabel(c) {
    var n = String(c.name || "");
    return /\((personal|business)\)\s*$/i.test(n) ? n : n + (c.kind === "business" ? " (business)" : " (personal)");
  }

  function openContainers(d) {
    return list(d && d.containers).filter(function (c) { return !c.archived_at; });
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function moveControl(d, a) {
    if (a.source !== "bank_account") {
      return '<div class="acct-move"><span class="caption">From your credit report. It stays where it is.</span></div>';
    }
    var opts = openContainers(d).map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (String(a.container_id) === String(c.id) ? " selected" : "") + '>' +
        esc(containerLabel(c)) + '</option>';
    }).join("");
    var none = '<option value=""' + (a.container_id ? "" : " selected") + '>Not sorted yet</option>';
    return '<div class="acct-move"><label class="caption" for="mv-' + esc(a.id) + '">Move to…</label>' +
      '<select id="mv-' + esc(a.id) + '" data-act="move" data-account="' + esc(a.id) + '">' + none + opts + '</select>' +
      '<span class="act-msg caption" aria-live="polite"></span></div>';
  }

  function typeWord(a) {
    if (a.type === "credit" || a.subtype === "credit card") return "Credit card";
    if (a.type === "loan" || a.type === "installment") return "Loan";
    if (a.subtype === "savings") return "Savings";
    if (a.subtype === "checking") return "Checking";
    if (a.type === "revolving") return "Card";
    return "Account";
  }

  function accountRow(d, a) {
    var card = a.type === "credit" || a.subtype === "credit card" || a.type === "revolving";
    var loan = a.type === "loan" || a.type === "installment";
    var owed = card || loan;
    var facts = [typeWord(a)];
    if (a.provider === "plaid") facts.push("connected bank");
    else if (a.provider === "manual") facts.push("added by hand");
    var right = '<span class="num">' + esc(money(a.current_cents)) + '</span>' +
      '<span class="caption">' + (owed ? "owed" : "balance") + '</span>';
    var extra = [];
    if (card) extra.push("Limit " + money(a.limit_cents));
    if ((card || loan) && a.source === "bank_account") {
      extra.push(isNum(a.due_day) ? "Due the " + ordinal(a.due_day) : "Due day —");
      extra.push((loan ? "Payment " : "Minimum ") + money(a.min_due_cents));
    }
    return '<li class="acct" data-account="' + esc(a.id) + '"><div>' + bankLogo(a) +
      '<span class="acct-name">' + esc(a.name || "Account") + '</span> ' +
      (a.mask ? '<span class="mask">••' + esc(a.mask) + '</span>' : "") +
      '<p class="caption">' + esc(facts.join(" · ")) + '</p>' +
      (extra.length ? '<p class="caption">' + esc(extra.join(" · ")) + '</p>' : "") +
      '</div><div class="acct-num">' + right + '</div>' + moveControl(d, a) + '</li>';
  }

  function accountList(d, rows, emptyWords) {
    var open = rows.filter(isOpen);
    var closed = rows.length - open.length;
    var body = open.length
      ? '<ul class="accts">' + open.map(function (a) { return accountRow(d, a); }).join("") + '</ul>'
      : '<p class="caption acct-none">' + esc(emptyWords) + '</p>';
    if (closed > 0) body += '<p class="caption">' + esc(plural(closed, "closed account", "closed accounts")) + ' not shown.</p>';
    return body;
  }

  function field(name, text, opts) {
    var o = opts || {};
    var id = (o.prefix || "f") + "-" + name;
    var cls = "f" + (o.wide ? " wide" : "") + (o.full ? " full" : "") + (o.onlyCard || o.onlyDue ? " only-card" : "");
    var input;
    if (o.options) {
      input = '<select id="' + esc(id) + '" name="' + esc(name) + '"' + (o.required ? " required" : "") + '>' +
        (o.blank === false ? "" : '<option value="">' + esc(o.blank || "Choose…") + '</option>') +
        o.options.map(function (p) {
          return '<option value="' + esc(p[0]) + '"' + (String(o.value || "") === String(p[0]) ? " selected" : "") + '>' + esc(p[1]) + '</option>';
        }).join("") + '</select>';
    } else {
      input = '<input id="' + esc(id) + '" name="' + esc(name) + '" type="' + esc(o.type || "text") + '"' +
        (o.value != null && o.value !== "" ? ' value="' + esc(o.value) + '"' : "") +
        (o.inputmode ? ' inputmode="' + esc(o.inputmode) + '"' : "") +
        (o.maxlength ? ' maxlength="' + esc(o.maxlength) + '"' : "") +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") +
        (o.autocomplete ? ' autocomplete="' + esc(o.autocomplete) + '"' : ' autocomplete="off"') +
        (o.required ? " required" : "") +
        (o.help ? ' aria-describedby="' + esc(id) + '-help"' : "") + '>';
    }
    return '<div class="' + cls + '"' + (o.onlyCard ? ' data-only-card="1"' : "") + (o.onlyDue ? ' data-only-due="1"' : "") +
      (o.mode ? ' data-mode="' + esc(o.mode) + '"' : "") + (o.onlyLimit ? ' data-only-limit="1"' : "") + (o.hidden ? " hidden" : "") + '>' +
      '<label for="' + esc(id) + '">' + esc(text) + '</label>' + input +
      (o.help ? '<p class="caption" id="' + esc(id) + '-help">' + esc(o.help) + '</p>' : "") + '</div>';
  }

  /* The business info fields, filled from `b` when editing. */
  function infoFields(prefix, b) {
    var v = b || {};
    var started = v.started ? String(v.started).slice(0, 7) : "";
    return field("legal_name", "Legal name", { prefix: prefix, value: v.legal_name, wide: true, placeholder: "As filed with the state" }) +
      field("dba", "DBA (doing business as)", { prefix: prefix, value: v.dba }) +
      field("ein_last4", "EIN — last 4 only", { prefix: prefix, value: v.ein_last4, inputmode: "numeric", maxlength: 4, placeholder: "1234" }) +
      field("entity_type", "Entity type", { prefix: prefix, value: v.entity_type, options: ENTITY_TYPES }) +
      field("formation_state", "State formed in", { prefix: prefix, value: v.formation_state, maxlength: 2, placeholder: "AZ" }) +
      field("started", "Start date", { prefix: prefix, value: started, type: "month" }) +
      field("industry", "Industry", { prefix: prefix, value: v.industry, wide: true,
        help: "Choose the industry that truly fits what you sell. For example: Professional Services for consulting, Education for courses, or Retail for goods, if accurate. A wrong category can delay approval with Whop or Commas." }) +
      field("address_line1", "Street address", { prefix: prefix, value: v.address_line1, wide: true, autocomplete: "address-line1" }) +
      field("city", "City", { prefix: prefix, value: v.city }) +
      field("state", "State", { prefix: prefix, value: v.state, maxlength: 2, placeholder: "AZ" }) +
      field("postal_code", "ZIP", { prefix: prefix, value: v.postal_code, inputmode: "numeric", maxlength: 10 }) +
      field("phone", "Business phone", { prefix: prefix, value: v.phone, type: "tel", inputmode: "tel" }) +
      field("website", "Website", { prefix: prefix, value: v.website, wide: true, placeholder: "example.com" });
  }

  function infoSummary(b) {
    if (!b) return '<p class="caption info-none">No business info yet. Add it so Fundhub can match you to funding.</p>';
    var rows = [
      ["Legal name", b.legal_name], ["DBA", b.dba], ["EIN", b.ein_last4 ? "••" + b.ein_last4 : ""],
      ["Entity type", b.entity_type ? label(ENTITY_TYPES, b.entity_type) : ""], ["State formed in", b.formation_state],
      ["Started", monthYear(b.started)], ["Industry", b.industry],
      ["Address", [b.address_line1, b.city, [b.state, b.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
      ["Phone", b.phone ? phone(b.phone) : ""], ["Website", b.website]
    ];
    return '<dl class="info">' + rows.map(function (r) {
      return '<div><dt class="caption">' + esc(r[0]) + '</dt><dd>' + esc(r[1] || "—") + '</dd></div>';
    }).join("") + '</dl>';
  }

  function containerCard(d, c) {
    var isBiz = c.kind === "business";
    var rows = holdings(c);
    var head = '<div class="box-head"><div><span class="box-name">' + esc(c.name) + '</span> ' +
      '<span class="tag">' + (isBiz ? "Business" : "Personal") + '</span>' +
      (c.archived_at ? ' <span class="tag">Archived</span>' : "") + '</div>' +
      '<span class="caption">' + esc(plural(rows.filter(isOpen).length, "account", "accounts")) + '</span></div>';
    var info = "";
    if (isBiz) {
      info = infoSummary(c.business) +
        '<details class="form"><summary>' + (c.business ? "Edit business info" : "Add business info") + '</summary>' +
        '<form data-form="save_business" data-container="' + esc(c.id) + '"><div class="fields">' +
        infoFields("b-" + c.id, c.business) +
        '<div class="form-act"><span class="act-msg caption" aria-live="polite"></span>' +
        '<button class="btn-primary" type="submit">Save business info</button></div></div></form></details>';
    }
    return '<section class="card container" data-container="' + esc(c.id) + '" data-kind="' + esc(c.kind) + '">' +
      head + info + accountList(d, rows, "No accounts in here yet. Add one by hand, connect a bank, or move one in.") +
      fuelBlock(d, c) + '</section>';
  }

  /* Business gas cards (wave 4, unit GAS): fuel-cards.js draws d.fuel_cards
     under each business; nothing when that file is not on the page. */
  function fuelBlock(d, c) {
    return root.FHFuelCards && d && c.kind === "business" && !c.archived_at ? root.FHFuelCards.renderForBusiness(d.fuel_cards, c) : "";
  }

  function renderUnsorted(d) {
    var rows = holdings(d && d.unassigned).filter(isOpen);
    if (!rows.length) return "";
    return '<section class="block" id="unsorted"><h2>Not sorted yet</h2>' +
      '<p class="caption">' + esc(plural(rows.length, "account needs", "accounts need")) + ' a home. Pick a business or you.</p>' +
      '<div class="grid one"><div class="card">' + accountList(d, rows, "") + '</div></div></section>';
  }

  function renderBusinesses(d) {
    var biz = list(d && d.containers).filter(function (c) { return c.kind === "business"; });
    var cards = biz.length
      ? '<div class="grid">' + biz.map(function (c) { return containerCard(d, c); }).join("") + '</div>'
      : '<div class="card"><p>No business yet. Add your business below.</p></div>';
    return '<section class="block" id="businesses"><h2>Your businesses</h2>' +
      '<p class="caption">Each business is its own container: its bank accounts and its cards.</p>' + cards +
      renderAddBusiness() + '</section>';
  }

  function renderAddBusiness(open) {
    return '<details class="form card" id="add-business"' + (open ? " open" : "") + '><summary>Add a business</summary>' +
      '<form data-form="create_business"><div class="fields">' +
      field("name", "Business name", { prefix: "nb", wide: true, required: true, placeholder: "Fundhub LLC" }) +
      infoFields("nb", null) +
      '<div class="form-act"><span class="act-msg caption" aria-live="polite"></span>' +
      '<button class="btn-primary" type="submit">Add business</button></div></div></form></details>';
  }

  function renderPersonal(d) {
    var me = list(d && d.containers).filter(function (c) { return c.kind === "personal"; });
    var cards = me.length
      ? '<div class="grid">' + me.map(function (c) { return containerCard(d, c); }).join("") + '</div>'
      : '<div class="card"><p>No personal container yet.</p>' +
        '<form data-form="create_personal" class="fields"><div class="f wide"><label for="np-name">Your name</label>' +
        '<input id="np-name" name="name" required autocomplete="name"></div>' +
        '<div class="form-act"><span class="act-msg caption" aria-live="polite"></span>' +
        '<button class="btn" type="submit">Add personal container</button></div></form></div>';
    return '<section class="block" id="personal"><h2>You</h2>' +
      '<p class="caption">Your personal bank accounts, cards and loans.</p>' + cards + '</section>';
  }

  /* "Just record it": the What you have card's own choices when it has loaded
     (money-tradelines.js hands over its read's `add`), else the server's type
     list and Personal plus each business here. */
  function recordChoices(d) {
    var given = root.FHTradelines && root.FHTradelines.addOptions;
    var types = given && list(given.types).length ? list(given.types) : RECORD_TYPES;
    var owners = given && list(given.belongs_to).length ? list(given.belongs_to) : [{ value: "personal", label: "Personal" }].concat(
      openContainers(d).filter(function (c) { return c.kind === "business"; })
        .map(function (c) { return { value: "entity:" + c.id, label: String(c.name || "Business") }; }));
    return { types: types, owners: owners };
  }

  /* One add form, two ways to save: Track the balance (add_account: it joins
     the balances) or Just record it (add_tradeline: it is listed in What you
     have). Track is the one already picked. */
  function modeChoice() {
    var opt = function (value, words, on) {
      return '<label class="btn"><input type="radio" name="mode" value="' + value + '"' + (on ? " checked" : "") +
        ' aria-describedby="na-mode-help"> ' + esc(words) + '</label>';
    };
    /* Outside the field grid on purpose: a field box's input rules would stretch the radios. */
    return '<div class="add-mode" data-mode="choice" role="radiogroup" aria-labelledby="na-mode-h">' +
      '<span class="caption" id="na-mode-h">How to add it</span>' +
      '<div class="head-act">' + opt("track", "Track the balance", true) + opt("record", "Just record it", false) + '</div>' +
      '<p class="caption" id="na-mode-help">' + esc(MODE_HELP.track) + '</p></div>';
  }

  function recordFields(d) {
    var rc = recordChoices(d);
    return field("creditor", "Bank or lender", { prefix: "na", wide: true, mode: "record", hidden: true, maxlength: 120, placeholder: "Chase" }) +
      field("product", "Card name", { prefix: "na", mode: "record", hidden: true, maxlength: 120, placeholder: "Ink Business Cash" }) +
      field("record_type", "Type", { prefix: "na", mode: "record", hidden: true, blank: false, value: rc.types[0].value,
        options: rc.types.map(function (t) { return [t.value, t.label]; }) }) +
      field("record_limit", "Limit", { prefix: "na", mode: "record", hidden: true, onlyLimit: true, inputmode: "decimal", placeholder: "10,000" }) +
      field("opened", "Opened", { prefix: "na", mode: "record", hidden: true, type: "month" }) +
      field("belongs_to", "Belongs to", { prefix: "na", mode: "record", hidden: true, wide: true, blank: false, value: "personal",
        options: rc.owners.map(function (o) { return [o.value, o.label]; }) });
  }

  function renderAddAccount(d, open) {
    var where = openContainers(d).map(function (c) {
      return [c.id, containerLabel(c)];
    });
    return '<section class="block" id="add"><h2>Add an account</h2>' +
      '<p class="caption">Type it in, or connect your bank and Fundhub fills it in. Fundhub only reads. It never moves money.</p>' +
      '<div class="grid one"><details class="form card" id="add-account"' + (open ? " open" : "") + '><summary>Add an account</summary>' +
      '<form data-form="add_account" novalidate>' + modeChoice() + '<div class="fields">' +
      field("name", "Account name", { prefix: "na", wide: true, required: true, placeholder: "Chase Ink" }) +
      field("type", "Type", { prefix: "na", options: HAND_TYPES, required: true, value: "credit_card", blank: false }) +
      field("container_id", "Belongs to", { prefix: "na", options: where, blank: "Not sorted yet", wide: true }) +
      field("last4", "Last 4 digits", { prefix: "na", inputmode: "numeric", maxlength: 4, placeholder: "1234" }) +
      field("balance", "Balance (owed, for a card or loan)", { prefix: "na", inputmode: "decimal", placeholder: "2,000" }) +
      field("limit", "Credit limit", { prefix: "na", inputmode: "decimal", placeholder: "10,000", onlyCard: true }) +
      field("due_day", "Due day of the month", { prefix: "na", inputmode: "numeric", maxlength: 2, placeholder: "15", onlyDue: true }) +
      field("minimum", "Minimum payment (for a loan, the monthly payment)", { prefix: "na", inputmode: "decimal", placeholder: "35", onlyDue: true }) +
      recordFields(d) +
      '<div class="form-act"><span class="act-msg caption" aria-live="polite"></span>' +
      '<button class="btn-primary" type="submit">Save account</button></div></div></form></details>' +
      '<div class="card"><span class="eyebrow">Connect a bank</span>' +
      '<p>Sign in to your bank once. Fundhub brings in every account and card on it.</p>' +
      '<div class="head-act"><button class="btn" type="button" data-act="connect">Connect a bank</button>' +
      '<p class="act-msg caption" aria-live="polite"></p></div></div></div></section>';
  }

  /* The price line only when the read carries a price (QA23): a price that is
     not set is left out, never shown as "$X". */
  function renderBilling(d) {
    var b = (d && d.billing) || {};
    if (!isNum(b.price_per_container_cents)) return "";
    var n = isNum(b.containers) ? b.containers : 0;
    return '<p class="caption billing">' + esc(plural(n, "container", "containers")) + ' with accounts · ' +
      esc(money(b.price_per_container_cents)) + ' per container a month' +
      (isNum(b.monthly_cents) ? ' · ' + esc(money(b.monthly_cents)) + ' a month' : "") + '. Empty containers are free.</p>';
  }

  function renderHead(d) {
    var n = list(d && d.containers).length;
    return '<div class="head"><div><h2>Accounts</h2><p class="caption">' +
      esc(n ? "Every business and every person is a container. Put each account in the right one." :
        "Start with your business. Then add your accounts.") +
      '</p></div><div class="head-act">' +
      '<button class="btn-primary" type="button" data-act="open-add">Add account</button>' +
      '<button class="btn" type="button" data-act="open-business">Add a business</button>' +
      '<p class="act-msg caption" id="head-msg" aria-live="polite"></p></div></div>';
  }

  /* ── whole states ──────────────────────────────────────────────────────── */

  function isEmpty(d) {
    return !d || (list(d.containers).length === 0 && holdings(d.unassigned).length === 0);
  }

  function renderFull(d) {
    return renderHead(d) + renderUnsorted(d) + renderBusinesses(d) + renderPersonal(d) +
      renderAddAccount(d, false) + renderBilling(d);
  }

  function renderEmpty(d) {
    return '<div class="head"><div><h2>Accounts</h2><p class="caption">Start with your business. Then add your accounts.</p></div></div>' +
      '<section class="card empty"><h2>No businesses or accounts yet</h2>' +
      '<p>Add your business first. Then add each account by hand, or connect a bank and Fundhub fills them in.</p></section>' +
      '<section class="block">' + renderAddBusiness(true) + '</section>' +
      renderPersonal(d || {}) + renderAddAccount(d || {}, false) + (d ? renderBilling(d) : "");
  }

  function renderLoading() {
    var box = '<div class="card skel"><span class="sk sk-s"></span><span class="sk sk-l"></span><span class="sk sk-m"></span><span class="sk sk-m"></span></div>';
    return '<div class="head"><div><h2>Accounts</h2><p class="caption">Loading your accounts…</p></div></div>' +
      '<section class="block" aria-busy="true"><div class="grid">' + box + box + '</div></section>' +
      '<section class="block" aria-busy="true"><div class="grid">' + box + '</div></section>';
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading your accounts. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose accounts to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(source) {
    return '<div class="head"><div><h2>Accounts</h2></div></div>' +
      '<section class="card error" role="alert"><h2>We could not load your accounts</h2>' +
      '<p>' + esc(ERROR_WORDS[source] || ERROR_WORDS.server) + '</p>' +
      '<button class="btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function render(d) { return isEmpty(d) ? renderEmpty(d) : renderFull(d); }

  /* What a refused write says, in the person's words. */
  var WRITE_WORDS = {
    container_not_found: "That business or container was not found. Reload the page and try again.",
    account_not_found: "That account was not found. Reload the page and try again.",
    container_archived: "That container is archived. Pick another one.",
    not_a_business_container: "Business info only goes on a business.",
    invalid_action: "That did not work. Reload the page and try again.",
    fuel_card_not_found: "That gas card is not on the list anymore. Reload the page.",
    already_tracked: "This gas card is already tracked for this business."
  };
  function writeWords(res) {
    var kind = classify(res);
    if (kind === "signin") return "You are signed out. Sign in and try again.";
    if (kind === "offline") return ERROR_WORDS.offline;
    if (kind === "nodb") return ERROR_WORDS.nodb;
    if (kind === "forbidden") return "This login is not allowed to change these accounts.";
    var e = res.body && res.body.error ? String(res.body.error) : "";
    if (WRITE_WORDS[e]) return WRITE_WORDS[e];
    if (res.status === 400 && e) return "Not saved: " + e.replace(/_/g, " ") + ".";
    return "Not saved. Something went wrong on our side. Try again in a few minutes.";
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

  function formBody(form) {
    var out = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (!e.name) continue;
      /* A choice counts only for the one that is picked. */
      if ((e.type === "radio" || e.type === "checkbox") && !e.checked) continue;
      out[e.name] = typeof e.value === "string" ? e.value.trim() : e.value;
    }
    return out;
  }

  var INFO_KEYS = ["legal_name", "dba", "ein_last4", "entity_type", "formation_state", "started",
    "industry", "address_line1", "city", "state", "postal_code", "phone", "website"];
  function pickInfo(v) {
    var info = {};
    INFO_KEYS.forEach(function (k) { if (v[k]) info[k] = v[k]; });
    return info;
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
    if (res.status === 503 && res.body && res.body.error === "not_configured") return "Bank connections are not set up yet.";
    return LINK_WORDS[classify(res)] || LINK_WORDS.server;
  }

  /* ── the section ───────────────────────────────────────────────────────────
     window.FinanceOS.sections.accounts.mount(el, ctx) — the one-page FinanceOS
     (/app/financeos.html) mounts this into its Accounts tab. No header, no nav:
     only the section. ctx = { clientId, apiGet(path), apiPost(path, body) };
     apiGet/apiPost resolve to { status, body }. Any of them may be left out,
     and the section then uses its own fetch and ?client_id= from the URL.
     Returns { reload } so the host can refresh it. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var get = typeof ctx.apiGet === "function" ? ctx.apiGet : function (p) { return call("GET", p); };
    var post = typeof ctx.apiPost === "function" ? ctx.apiPost : function (p, b) { return call("POST", p, b); };
    var st = { data: null, clientId: ctx.clientId || param("client_id") || "" };
    var q = function (sel) { return el.querySelector(sel); };

    function paint(html) { el.innerHTML = html; syncCardFields(); }

    /* The add form shows the fields of the way picked. Track the balance: the
       limit only for a credit card; due day and minimum for a credit card or a
       loan. Just record it: the limit only for a type that has one. A figure a
       type cannot have is cleared, so it is never sent. */
    function syncCardFields() {
      var form = q('form[data-form="add_account"]');
      if (!form) return;
      var picked = form.querySelector('input[name="mode"]:checked');
      var mode = picked && picked.value === "record" ? "record" : "track";
      var help = form.querySelector("#na-mode-help");
      if (help) help.textContent = MODE_HELP[mode];
      var type = form.elements.type ? form.elements.type.value : "";
      var isCard = type === "credit_card";
      var hasDue = isCard || type === "loan";
      var rtype = form.elements.record_type ? form.elements.record_type.value : "";
      var hasLimit = recordChoices(st.data).types.some(function (t) { return t.value === rtype && t.limit; });
      var boxes = form.querySelectorAll(".fields > .f");
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var m = box.getAttribute("data-mode");
        if (m === "choice") continue;
        var inMode = m === "record" ? mode === "record" : mode === "track";
        var fits = true;
        if (m === "record") { if (box.hasAttribute("data-only-limit")) fits = hasLimit; }
        else if (box.hasAttribute("data-only-card")) fits = isCard;
        else if (box.hasAttribute("data-only-due")) fits = hasDue;
        box.hidden = !(inMode && fits);
        var inp = box.querySelector("input");
        if (inp && !fits) inp.value = "";
      }
    }

    /* Another card on the page (What you have, money-tradelines.js) reloads when
       an account is added or moved here. */
    function changed(action) {
      var doc = root.document;
      if (!doc || typeof doc.dispatchEvent !== "function" || typeof root.CustomEvent !== "function") return;
      doc.dispatchEvent(new root.CustomEvent("fh:accounts-changed", { detail: { action: action } }));
    }

    function load() {
      paint(renderLoading());
      return Promise.resolve(get(API + (st.clientId ? "?client_id=" + encodeURIComponent(st.clientId) : ""))).then(function (res) {
        var kind = classify(res);
        if (kind === "signin") { root.location.href = signInUrl(); return; }
        if (kind !== "ok") { paint(renderError(kind)); return; }
        st.data = res.body;
        paint(render(res.body));
      });
    }

    /* One write. On success the section repaints from the answer and says so. */
    function write(body, msgEl, btn, done) {
      if (st.clientId) body.client_id = st.clientId;
      var label0 = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
      if (msgEl) msgEl.textContent = "";
      return Promise.resolve(post(API, body)).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = label0; }
        if (classify(res) === "signin") { root.location.href = signInUrl(); return; }
        if (classify(res) !== "ok") { if (msgEl) msgEl.textContent = writeWords(res); return false; }
        st.data = res.body;
        paint(render(res.body));
        var head = q("#head-msg");
        if (head) head.textContent = done;
        changed(body.action);
        return true;
      });
    }

    /* Just record it: POST add_tradeline. It answers with the What you have view,
       not this section's, so this section stays as it is: the form closes and
       What you have reloads. A refused save uses that card's own words. */
    function writeRecord(body, msgEl, btn) {
      if (st.clientId) body.client_id = st.clientId;
      var label0 = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
      if (msgEl) msgEl.textContent = "";
      return Promise.resolve(post(API, body)).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = label0; }
        if (classify(res) === "signin") { root.location.href = signInUrl(); return; }
        if (classify(res) !== "ok") {
          var T = root.FHTradelines;
          if (msgEl) msgEl.textContent = T && typeof T.writeWords === "function" ? T.writeWords(res) : writeWords(res);
          return false;
        }
        paint(render(st.data));
        var head = q("#head-msg");
        if (head) head.textContent = "Saved. It shows in What you have.";
        changed(body.action);
        return true;
      });
    }

    /* A required field left empty: say so beside Save, and go to the field. */
    function ask(form, name, words) {
      var msg = form.querySelector(".act-msg");
      if (msg) msg.textContent = words;
      var f = form.elements[name];
      if (f && typeof f.focus === "function") f.focus();
      return Promise.resolve(false);
    }

    function onSubmit(form) {
      var kind = form.getAttribute("data-form");
      var v = formBody(form);
      var msg = form.querySelector(".act-msg");
      var btn = form.querySelector('button[type="submit"]');
      if (kind === "create_business") {
        return write({ action: "create_business", name: v.name, info: pickInfo(v) }, msg, btn, "Business added.");
      }
      if (kind === "save_business") {
        return write({ action: "save_business", container_id: form.getAttribute("data-container"), info: pickInfo(v) },
          msg, btn, "Business info saved.");
      }
      if (kind === "create_personal") {
        return write({ action: "create_personal", name: v.name }, msg, btn, "Personal container added.");
      }
      if (kind === "add_account") {
        if (v.mode === "record") {
          if (!v.creditor) return ask(form, "creditor", "Type the bank or lender, like Chase.");
          var rb = { action: "add_tradeline", creditor: v.creditor, type: v.record_type || RECORD_TYPES[0].value, belongs_to: v.belongs_to || "personal" };
          if (v.product) rb.product = v.product;
          if (v.record_limit) rb.limit = v.record_limit;
          if (v.opened) rb.opened = v.opened;
          return writeRecord(rb, msg, btn);
        }
        if (!v.name) return ask(form, "name", "Type the account name, like Chase Ink.");
        var body = { action: "add_account", name: v.name, type: v.type };
        ["last4", "balance", "limit", "due_day", "minimum", "container_id"].forEach(function (k) { if (v[k]) body[k] = v[k]; });
        return write(body, msg, btn, "Account saved.");
      }
      if (kind === "track_fuel_card") {
        var fb = { action: "track_fuel_card", fuel_card_id: form.getAttribute("data-fuel"), container_id: form.getAttribute("data-container") };
        ["due_day", "limit", "last4"].forEach(function (k) { if (v[k]) fb[k] = v[k]; });
        return write(fb, msg, btn, "Gas card added. It is tracked like your other cards.");
      }
    }

    function onMove(sel) {
      var accountId = sel.getAttribute("data-account");
      var to = sel.value;
      var msg = sel.parentNode.querySelector(".act-msg");
      sel.disabled = true;
      if (msg) msg.textContent = "Moving…";
      var body = to ? { action: "assign", account_id: accountId, container_id: to } : { action: "unassign", account_id: accountId };
      write(body, msg, null, to ? "Account moved." : "Account moved to Not sorted yet.").then(function (ok) {
        if (ok === false) sel.disabled = false;
      });
    }

    /* Plaid Link — exactly the money.js flow: link-token, Plaid's window, link-exchange. */
    function connect(btn) {
      var msg = btn.parentNode.querySelector(".act-msg");
      function say(t) { if (msg) msg.textContent = t; }
      function done(label) { btn.disabled = false; btn.textContent = label || "Connect a bank"; }
      btn.disabled = true;
      btn.textContent = "Opening your bank…";
      say("");
      var body = st.clientId ? { client_id: st.clientId } : {};
      if (!root.FHPlaidStepUp) { done(); say("Bank verification did not load. Refresh and try again."); return; }
      root.FHPlaidStepUp.authorize("client_bank").then(function (grantToken) {
        body.plaid_grant_token = grantToken;
        return Promise.resolve(post("/api/banking/link-token", body));
      }).then(function (res) {
        if (classify(res) !== "ok" || !res.body.link_token) { done(); say(linkWords(res)); return; }
        return loadPlaid().then(function () {
          var handler = root.Plaid.create({
            token: res.body.link_token,
            onSuccess: function (publicToken, metadata) {
              btn.textContent = "Saving your bank…";
              var inst = metadata && metadata.institution
                ? { institution_id: metadata.institution.institution_id || null, name: metadata.institution.name || null }
                : null;
              var ex = { public_token: publicToken, institution: inst,
                plaid_grant_token: body.plaid_grant_token };
              if (st.clientId) ex.client_id = st.clientId;
              root.FHPlaidStepUp.verify("client_bank").then(function () {
                return post("/api/banking/link-exchange", ex);
              }).then(function (r2) {
                if (classify(r2) !== "ok") { done(); say(linkWords(r2)); return; }
                say("Bank connected. New accounts show under Not sorted yet.");
                load();
              }).catch(function (err) {
                done();
                if (!err || err.message !== "cancelled") say((err && err.message) || "Bank verification did not work. Try again.");
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
      }).catch(function (err) {
        done();
        if (!err || err.message !== "cancelled") say((err && err.message) || "Bank verification did not work. Try again.");
      });
    }

    function openForm(id, focusName) {
      var det = q("#" + id);
      if (!det) return;
      det.open = true;
      if (det.scrollIntoView) det.scrollIntoView({ behavior: "smooth", block: "start" });
      var f = det.querySelector('[name="' + focusName + '"]');
      if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
    }

    el.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || t.tagName === "SELECT" || !el.contains(t)) return;
      var act = t.getAttribute("data-act");
      if (act === "connect") connect(t);
      if (act === "retry") load();
      if (act === "open-add") openForm("add-account", "name");
      if (act === "open-business") openForm("add-business", "name");
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('select[data-act="move"]')) onMove(t);
      if (t && /^(type|record_type|mode)$/.test(t.name || "") && t.form && t.form.getAttribute("data-form") === "add_account") syncCardFields();
    });
    el.addEventListener("submit", function (e) {
      var f = e.target;
      if (!f || !f.getAttribute || !f.getAttribute("data-form")) return;
      e.preventDefault();
      onSubmit(f);
    });
    /* A note about an empty field goes away once the person types. */
    el.addEventListener("input", function (e) {
      var f = e.target && e.target.form;
      if (!f || !f.getAttribute || f.getAttribute("data-form") !== "add_account") return;
      var m = f.querySelector(".act-msg");
      if (m && m.textContent) m.textContent = "";
    });

    /* What you have (money-tradelines.js) hands over its read's own choices for
       Just record it when it loads; the open form takes them, keeping what is picked. */
    function refill(sel, pairs) {
      if (!sel || !pairs.length) return;
      var keep = sel.value;
      sel.innerHTML = pairs.map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>'; }).join("");
      if (pairs.some(function (p) { return String(p[0]) === keep; })) sel.value = keep;
    }
    function onTradelinesReady() {
      var form = q('form[data-form="add_account"]');
      if (!form) return;
      var rc = recordChoices(st.data);
      refill(form.elements.record_type, rc.types.map(function (t) { return [t.value, t.label]; }));
      refill(form.elements.belongs_to, rc.owners.map(function (o) { return [o.value, o.label]; }));
      syncCardFields();
    }
    var doc = root.document;
    if (doc && typeof doc.addEventListener === "function") doc.addEventListener("fh:tradelines-ready", onTradelinesReady);

    load();
    return {
      reload: load,
      unmount: function () { if (doc && typeof doc.removeEventListener === "function") doc.removeEventListener("fh:tradelines-ready", onTradelinesReady); }
    };
  }

  /* ── the standalone page (/app/money-accounts.html) — a thin shell ──────── */
  function initPage() {
    var el = root.document.getElementById("accounts-root");
    if (!el) return;
    var back = root.document.getElementById("money-back");
    if (back && param("client_id")) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(param("client_id")));
      back.textContent = "Back to Finance OS";
    }
    if (param("client_id")) {
      var links = root.document.querySelectorAll(".mnav a");
      /* The query goes before the #tab: /app/financeos.html?client_id=…#credit. */
      for (var i = 0; i < links.length; i++) {
        var parts = links[i].getAttribute("href").split("#");
        var href = parts[0] + "?client_id=" + encodeURIComponent(param("client_id"));
        links[i].setAttribute("href", parts.length > 1 ? href + "#" + parts.slice(1).join("#") : href);
      }
    }
    mount(el, { clientId: param("client_id") });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.accounts = { title: "Accounts", mount: mount };

  root.FHMoneyAccounts = {
    money: money, isEmpty: isEmpty, render: render, renderFull: renderFull, renderEmpty: renderEmpty,
    renderError: renderError, renderLoading: renderLoading, classify: classify, writeWords: writeWords, mount: mount
  };

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", initPage);
    else initPage();
  }
})(typeof window !== "undefined" ? window : globalThis);
