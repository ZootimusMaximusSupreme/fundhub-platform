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
    var owed = card || a.type === "loan" || a.type === "installment";
    var facts = [typeWord(a)];
    if (a.provider === "plaid") facts.push("connected bank");
    else if (a.provider === "manual") facts.push("added by hand");
    var right = '<span class="num">' + esc(money(a.current_cents)) + '</span>' +
      '<span class="caption">' + (owed ? "owed" : "balance") + '</span>';
    var extra = [];
    if (card) extra.push("Limit " + money(a.limit_cents));
    if (card && a.source === "bank_account") {
      extra.push(isNum(a.due_day) ? "Due the " + ordinal(a.due_day) : "Due day —");
      extra.push("Minimum " + money(a.min_due_cents));
    }
    return '<li class="acct" data-account="' + esc(a.id) + '"><div>' +
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
    var cls = "f" + (o.wide ? " wide" : "") + (o.full ? " full" : "") + (o.onlyCard ? " only-card" : "");
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
        (o.required ? " required" : "") + '>';
    }
    return '<div class="' + cls + '"' + (o.onlyCard ? ' data-only-card="1"' : "") + '>' +
      '<label for="' + esc(id) + '">' + esc(text) + '</label>' + input + '</div>';
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
      field("industry", "Industry", { prefix: prefix, value: v.industry, wide: true }) +
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
      head + info + accountList(d, rows, "No accounts in here yet. Add one by hand, connect a bank, or move one in.") + '</section>';
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

  function renderAddAccount(d, open) {
    var where = openContainers(d).map(function (c) {
      return [c.id, containerLabel(c)];
    });
    return '<section class="block" id="add"><h2>Add an account</h2>' +
      '<p class="caption">Type it in, or connect your bank and Fundhub fills it in. Fundhub only reads. It never moves money.</p>' +
      '<div class="grid one"><details class="form card" id="add-account"' + (open ? " open" : "") + '><summary>Add account by hand</summary>' +
      '<form data-form="add_account"><div class="fields">' +
      field("name", "Account name", { prefix: "na", wide: true, required: true, placeholder: "Chase Ink" }) +
      field("type", "Type", { prefix: "na", options: HAND_TYPES, required: true, value: "credit_card", blank: false }) +
      field("container_id", "Belongs to", { prefix: "na", options: where, blank: "Not sorted yet", wide: true }) +
      field("last4", "Last 4 digits", { prefix: "na", inputmode: "numeric", maxlength: 4, placeholder: "1234" }) +
      field("balance", "Balance (owed, for a card or loan)", { prefix: "na", inputmode: "decimal", placeholder: "2,000" }) +
      field("limit", "Credit limit", { prefix: "na", inputmode: "decimal", placeholder: "10,000", onlyCard: true }) +
      field("due_day", "Due day of the month", { prefix: "na", inputmode: "numeric", maxlength: 2, placeholder: "15", onlyCard: true }) +
      field("minimum", "Minimum payment", { prefix: "na", inputmode: "decimal", placeholder: "35", onlyCard: true }) +
      '<div class="form-act"><span class="act-msg caption" aria-live="polite"></span>' +
      '<button class="btn-primary" type="submit">Save account</button></div></div></form></details>' +
      '<div class="card"><span class="eyebrow">Connect a bank</span>' +
      '<p>Sign in to your bank once. Fundhub brings in every account and card on it.</p>' +
      '<div class="head-act"><button class="btn" type="button" data-act="connect">Connect a bank</button>' +
      '<p class="act-msg caption" aria-live="polite"></p></div></div></div></section>';
  }

  function renderBilling(d) {
    var b = (d && d.billing) || {};
    var n = isNum(b.containers) ? b.containers : 0;
    var price = isNum(b.price_per_container_cents) ? money(b.price_per_container_cents) : "$X";
    var monthly = isNum(b.monthly_cents) ? money(b.monthly_cents) : "$X";
    return '<p class="caption billing">' + esc(plural(n, "container", "containers")) + ' with accounts · ' +
      esc(price) + ' per container a month · ' + esc(monthly) + ' a month. Empty containers are free.</p>';
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
    invalid_action: "That did not work. Reload the page and try again."
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

    /* Limit, due day and minimum only show for a credit card. */
    function syncCardFields() {
      var form = q('form[data-form="add_account"]');
      if (!form) return;
      var isCard = form.elements.type && form.elements.type.value === "credit_card";
      var bits = form.querySelectorAll("[data-only-card]");
      for (var i = 0; i < bits.length; i++) {
        bits[i].hidden = !isCard;
        var inp = bits[i].querySelector("input");
        if (inp && !isCard) inp.value = "";
      }
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
        return true;
      });
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
        var body = { action: "add_account", name: v.name, type: v.type };
        ["last4", "balance", "limit", "due_day", "minimum", "container_id"].forEach(function (k) { if (v[k]) body[k] = v[k]; });
        return write(body, msg, btn, "Account saved.");
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
              if (st.clientId) ex.client_id = st.clientId;
              Promise.resolve(post("/api/banking/link-exchange", ex)).then(function (r2) {
                if (classify(r2) !== "ok") { done(); say(linkWords(r2)); return; }
                say("Bank connected. New accounts show under Not sorted yet.");
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
      if (t && t.name === "type" && t.form && t.form.getAttribute("data-form") === "add_account") syncCardFields();
    });
    el.addEventListener("submit", function (e) {
      var f = e.target;
      if (!f || !f.getAttribute || !f.getAttribute("data-form")) return;
      e.preventDefault();
      onSubmit(f);
    });

    load();
    return { reload: load };
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
