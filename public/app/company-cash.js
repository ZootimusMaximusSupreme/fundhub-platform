/* Owner company cash. Client Finance OS and money transfers stay separate. */
(function (root) {
  "use strict";
  var BANK_URL = "/api/owner/company-bank";
  var CASH_URL = "/api/owner/company-cash";
  var PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
  var PAGE_SIZE = 25;
  var state = { bank: null, cash: null, auth: null, loadSeq: 0, obligationPage: 0, transactionPage: 0, recurringPage: 0,
    editing: null, matching: null, matchSeq: 0, matchCursor: null, pendingLink: null, accountMode: null, accountId: null };
  var plaidLoading = null;
  var plaidHandler = null;
  function $(id) { return document.getElementById(id); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function cents(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "number" && !(typeof v === "string" && /^-?\d+$/.test(v))) return null;
    var n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  function money(v) {
    var n = cents(v);
    if (n === null) return "—";
    return (n < 0 ? "−" : "") + "$" + (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function day(v) { return v ? String(v).slice(0, 10) : ""; }
  function monthLabel(v) { var d = /^\d{4}-\d{2}/.exec(String(v || "")); return d ? new Date(d[0] + "-01T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "Current month"; }
  function bearer() { try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }
  function uuid(v) { return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
  function sessionChanged() { var e = new Error("Your sign-in changed. Sign in again to view company cash."); e.code = "session_changed"; return e; }
  function destroyPlaid(forceExit) {
    var handler = plaidHandler;
    plaidHandler = null;
    if (!handler) return;
    if (forceExit && typeof handler.exit === "function") {
      try { handler.exit({ force: true }); } catch (e) { /* Destroy still removes the bank window. */ }
    }
    if (typeof handler.destroy === "function") {
      try { handler.destroy(); } catch (e) { /* The session guard still blocks callbacks. */ }
    }
  }
  function scrubPrivateDom() {
    ["ccBankAccounts", "ccObligations", "ccRecurring", "ccTransactions", "ccAccountOptions", "ccMatchOptions"].forEach(function (id) { $(id).replaceChildren(); });
    ["ccAvailable", "ccBankCash", "ccBankEstimate", "ccCrs", "ccCrsPulls", "ccAd", "ccMetaSpend", "ccTech",
      "ccBankStatus", "ccBankAsOf", "ccProcessor", "ccMissingText", "ccCandidateNote", "ccFormError", "ccAccountError",
      "ccMatchError", "ccObligationPage", "ccRecurringPage", "ccTransactionPage"].forEach(function (id) { $(id).textContent = ""; });
    $("ccObligationForm").reset();
    $("ccMatchMore").hidden = true;
    ["ccBusinessConfirm", "ccReadConsent", "ccAccountConfirm"].forEach(function (id) { $(id).checked = false; });
    ["ccConnect", "ccSync", "ccRefreshBalance", "ccSaveObligation", "ccSaveAccount", "ccSaveMatch", "ccMatchMore"].forEach(function (id) {
      var button = $(id);
      if (button.dataset.oldLabel) { button.textContent = button.dataset.oldLabel; delete button.dataset.oldLabel; }
      button.disabled = id === "ccConnect" || id === "ccSaveAccount";
    });
    $("ccMonth").textContent = "Current month";
  }
  function clearSensitive() {
    state.auth = null; state.bank = null; state.cash = null; state.pendingLink = null;
    state.editing = null; state.matching = null; state.matchSeq += 1; state.matchCursor = null;
    state.accountMode = null; state.accountId = null;
    state.loadSeq += 1;
    destroyPlaid(true);
    ["ccObligationDialog", "ccAccountDialog", "ccMatchDialog"].forEach(function (id) { var d = $(id); if (d && d.open) d.close(); });
    scrubPrivateDom();
    $("ccLoading").hidden = true; $("ccEmpty").hidden = true; $("ccFull").hidden = true;
    $("ccPrimary").hidden = true; $("ccError").hidden = false;
    $("ccErrorText").textContent = "Your sign-in changed. Sign in again to view company cash.";
    $("ccSignIn").hidden = false;
    message("");
  }
  function guard(auth) {
    if (auth && state.auth === auth && bearer() === auth.token) return true;
    if (state.auth) clearSensitive();
    return false;
  }
  async function sessionFor(token) {
    if (!token || bearer() !== token) throw sessionChanged();
    var response = await root.fetch("/api/auth/session", { headers: { accept: "application/json", authorization: "Bearer " + token } });
    var body = await response.json().catch(function () { return null; });
    if (bearer() !== token) throw sessionChanged();
    var staff = body && body.staff;
    if (!response.ok || !body || body.ok !== true || !staff || staff.role !== "owner" || !uuid(staff.id) || !uuid(staff.org_id)) {
      var denied = new Error("This view is for the Fundhub owner."); denied.code = "owner_required"; denied.status = response.status; throw denied;
    }
    return { token: token, staffId: staff.id, orgId: staff.org_id };
  }
  async function revalidate(auth) {
    if (!guard(auth)) throw sessionChanged();
    var principal;
    try { principal = await sessionFor(auth.token); }
    catch (err) { if (guard(auth)) clearSensitive(); throw err; }
    if (principal.staffId !== auth.staffId || principal.orgId !== auth.orgId || !guard(auth)) {
      clearSensitive(); throw sessionChanged();
    }
  }
  function friendly(error) {
    var code = String(error || "");
    if (code === "not_configured") return "Bank connections are not enabled yet.";
    if (code === "realtime_balance_not_enabled") return "Live bank balance refresh is not available yet.";
    if (code === "business_depository_account_required") return "Choose a Fundhub LLC business checking or savings account.";
    if (code === "payment_not_matching_posted_business_debit") return "That payment no longer matches an exact posted debit. Refresh bank data and try again.";
    if (code === "invalid_obligation") return "Check the amount, billing month, and required invoice details.";
    return "That change did not save. Try again.";
  }
  async function request(url, body, auth) {
    if (!guard(auth)) throw sessionChanged();
    var opts = { headers: { accept: "application/json", authorization: "Bearer " + auth.token } };
    if (body) { opts.method = "POST"; opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    var response = await root.fetch(url, opts);
    var data = await response.json().catch(function () { return null; });
    if (!guard(auth)) throw sessionChanged();
    if (!response.ok || !data || data.ok !== true) {
      var code = data && (data.reason || data.error);
      if (response.status === 401 || response.status === 403 || code === "forbidden" || code === "owner_required") {
        clearSensitive(); throw sessionChanged();
      }
      var err = new Error(friendly(data && (data.reason || data.error)));
      err.code = data && (data.reason || data.error);
      err.status = response.status;
      throw err;
    }
    return data;
  }
  function message(text, isError, signIn) {
    var box = $("ccMessage");
    box.textContent = text || "";
    box.classList.toggle("is-error", !!isError);
    if (signIn) { var a = document.createElement("a"); a.href = "/login.html"; a.textContent = "Sign in again"; box.appendChild(document.createTextNode(" ")); box.appendChild(a); }
    box.hidden = !text;
  }
  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) { button.dataset.oldLabel = button.textContent; button.disabled = true; button.textContent = label || "Saving…"; }
    else { button.textContent = button.dataset.oldLabel || button.textContent; button.disabled = false; }
  }
  async function mutate(url, body, button, busyText, successText) {
    var auth = state.auth;
    if (!guard(auth)) return false;
    setBusy(button, true, busyText);
    message("");
    try {
      await revalidate(auth);
      await request(url, body, auth);
      if (!guard(auth)) return false;
      if (!await load(false, auth)) return false;
      if (!guard(auth)) return false;
      message(successText || "Saved."); return true;
    } catch (err) { if (guard(auth)) message(err.message, true); return false; }
    finally { if (guard(auth)) setBusy(button, false); }
  }
  async function load(showSkeleton, expectedAuth) {
    var seq = ++state.loadSeq;
    if (showSkeleton) { $("ccLoading").hidden = false; $("ccEmpty").hidden = true; $("ccError").hidden = true; $("ccSignIn").hidden = true; $("ccFull").hidden = true; }
    try {
      var token = expectedAuth ? expectedAuth.token : bearer();
      var principal = await sessionFor(token);
      if (expectedAuth && (principal.staffId !== expectedAuth.staffId || principal.orgId !== expectedAuth.orgId)) throw sessionChanged();
      if (seq !== state.loadSeq || bearer() !== token) throw sessionChanged();
      var auth = expectedAuth || principal;
      if (!expectedAuth) state.auth = auth;
      if (!guard(auth)) throw sessionChanged();
      var pair = await Promise.all([request(BANK_URL, null, auth), request(CASH_URL, null, auth)]);
      if (seq !== state.loadSeq || !guard(auth)) return false;
      state.bank = pair[0]; state.cash = pair[1];
      render();
      return true;
    } catch (err) {
      if (seq !== state.loadSeq) return false;
      if (err.code === "session_changed") { clearSensitive(); return false; }
      if (err.code === "owner_required") { clearSensitive(); $("ccErrorText").textContent = "This view is for the Fundhub owner."; return false; }
      if (expectedAuth && !guard(expectedAuth)) return false;
      $("ccLoading").hidden = true; $("ccEmpty").hidden = true; $("ccFull").hidden = true; $("ccError").hidden = false;
      $("ccSignIn").hidden = true;
      $("ccErrorText").textContent = err.code === "owner_required" ? "This view is for the Fundhub owner." : "Check the connection and try again.";
      return false;
    }
  }
  var MISSING = {
    business_bank_balance: "Connect and verify a recent Fundhub LLC business bank balance",
    crs_invoice: "enter the exact verified CRS invoice total",
    crs_uncovered_pull_cost: "price CRS pulls after the verified invoice coverage date",
    crs_payment_unverified: "match the CRS payment to a posted debit",
    ad_review: "approve this month's ad funding amount (enter $0 if none)",
    ad_amount: "enter the exact approved ad funding amount",
    tech_review: "approve this month's tech bill review (enter $0 if none)",
    tech_amount: "enter the exact tech bill amount",
    tech_due_date: "enter the tech bill due date",
    payment_unverified: "match paid bills to posted debits"
  };
  function nextMissing() {
    var missing = list(state.cash && state.cash.summary && state.cash.summary.missing);
    if (missing.includes("business_bank_balance")) return "ccBankPanel";
    return "ccObligationPanel";
  }
  function focusMissing() {
    if (!guard(state.auth)) return;
    if ($("ccEmpty") && !$("ccEmpty").hidden) { $("ccEmpty").hidden = true; $("ccFull").hidden = false; }
    var target = $(nextMissing()); if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function render() {
    var bank = state.bank, cash = state.cash, s = cash.summary || {};
    $("ccLoading").hidden = true; $("ccError").hidden = true;
    var isEmpty = !list(bank.accounts).length && !list(cash.obligations).length;
    $("ccEmpty").hidden = !isEmpty; $("ccFull").hidden = isEmpty;
    $("ccEmptyText").textContent = bank.configured
      ? "Connect a Fundhub LLC business bank account to see posted cash. Client Finance OS stays separate."
      : "Bank connections are not enabled yet. Once available, connect the Fundhub LLC business bank here.";
    var exact = cents(s.available_cents);
    $("ccPrimary").hidden = isEmpty;
    $("ccPrimary").textContent = exact === null ? "Finish setup" : "Add bill or reserve";
    $("ccAvailable").textContent = exact === null ? "Finish setup" : money(exact);
    $("ccAvailableNote").textContent = exact === null
      ? "This view needs a recent business bank balance and reviewed costs."
      : "Bank current balance less unpaid CRS, approved ad funding, and due tech bills. Plaid's available estimate is shown separately.";
    $("ccMonth").textContent = monthLabel(s.month);
    $("ccBankAsOf").textContent = s.bank_balance_as_of ? "Bank balance as of " + day(s.bank_balance_as_of) : "Bank balance not yet selected";
    $("ccProcessor").textContent = cents(s.processor_receipts_cents) === null
      ? "Processor receipts: Not reconciled"
      : "Processor receipts recorded separately: " + money(s.processor_receipts_cents);
    $("ccBankCash").textContent = money(s.bank_posted_cents);
    $("ccBankEstimate").textContent = "Plaid available balance estimate: " + money(s.bank_available_cents);
    $("ccCrs").textContent = money(s.crs_reserve_cents);
    $("ccCrsPulls").textContent = (Number(s.crs_fulfilled_pull_count) || 0) + " fulfilled soft pulls; " + (Number(s.crs_unpriced_pull_count) || 0) + " direct costs not recorded";
    $("ccAd").textContent = list(s.missing).some(function (x) { return x === "ad_review" || x === "ad_amount"; }) ? "—" : money(s.ad_approved_unpaid_cents);
    $("ccMetaSpend").textContent = "Meta spend recorded: " + money(s.meta_spend_cents);
    $("ccTech").textContent = list(s.missing).some(function (x) { return x === "tech_review" || x === "tech_amount" || x === "tech_due_date"; }) ? "—" : money(s.tech_due_cents);
    $("ccSetup").hidden = exact !== null;
    $("ccMissingText").textContent = list(s.missing).map(function (key) { return MISSING[key] || "review " + key.replace(/_/g, " "); }).join("; ") + ".";
    renderBank(); renderObligations(); renderRecurring(); renderTransactions();
  }
  function renderBank() {
    var bank = state.bank, items = list(bank.items), accounts = list(bank.accounts);
    $("ccBankNotConfigured").hidden = bank.configured === true;
    $("ccBankConnect").hidden = bank.configured !== true;
    var selected = accounts.find(function (a) { return a.selected_for_cash === true; });
    $("ccBankStatus").textContent = selected ? (selected.name || "Business account") + " ••" + (selected.mask || "") + " selected" : "No business account selected.";
    $("ccSync").hidden = bank.configured !== true || !items.length;
    $("ccRefreshBalance").hidden = bank.configured !== true || bank.realtime_balance_available !== true || !selected;
    $("ccBalanceNotReady").hidden = bank.configured !== true || bank.realtime_balance_available === true || !selected;
    var box = $("ccBankAccounts"); box.innerHTML = "";
    if (!accounts.length) { box.innerHTML = '<p class="cc-empty-list">No business bank accounts connected yet.</p>'; return; }
    accounts.forEach(function (a) {
      var eligible = a.account_type === "depository" && a.holder_category !== "personal" && a.currency_code === "USD";
      var row = document.createElement("div"); row.className = "cc-row";
      row.innerHTML = '<div class="cc-row-main"><strong>' + esc(a.name || "Bank account") + " ••" + esc(a.mask || "") + '</strong><small>' + esc(a.account_subtype || a.account_type || "Account") + (a.selected_for_cash ? " · Selected for company cash" : "") + '</small></div><div class="cc-row-value">' + money(a.current_balance_cents) + '</div>';
      if (!a.selected_for_cash && eligible) {
        var actions = document.createElement("div"); actions.className = "cc-row-actions";
        var btn = document.createElement("button"); btn.type = "button"; btn.className = "fh-astra-action"; btn.textContent = "Use for company cash";
        btn.addEventListener("click", function () { openAccountPicker("saved", [a]); }); actions.appendChild(btn); row.appendChild(actions);
      }
      box.appendChild(row);
    });
  }
  function obligationRows() { return list(state.cash.obligations).filter(function (o) { return o.status !== "cancelled"; }); }
  function renderObligations() {
    var rows = obligationRows(), start = state.obligationPage * PAGE_SIZE;
    if (start >= rows.length) { state.obligationPage = 0; start = 0; }
    var box = $("ccObligations"); box.innerHTML = "";
    if (!rows.length) { box.innerHTML = '<p class="cc-empty-list">No bills or reserves yet. Add the actual monthly CRS invoice, ad amount, and tech review.</p>'; }
    rows.slice(start, start + PAGE_SIZE).forEach(function (o) {
      var row = document.createElement("div"); row.className = "cc-row";
      var title = o.kind === "crs" ? "CRS" : o.kind === "ad" ? "Ad funding" : "Tech bill";
      row.innerHTML = '<div class="cc-row-main"><strong title="' + esc(o.label || title) + '">' + esc(o.label || title) + '</strong><small>' + esc(title) + ' · ' + esc(o.status || "planned") + ' · ' + esc(monthLabel(o.billing_month)) + (o.due_on ? " · Due " + esc(day(o.due_on)) : "") + '</small></div><div class="cc-row-value">' + money(o.amount_cents) + '</div>';
      if (o.status === "planned" || o.status === "approved") {
        var actions = document.createElement("div"); actions.className = "cc-row-actions";
        var edit = document.createElement("button"); edit.type = "button"; edit.className = "fh-astra-action"; edit.textContent = "Edit"; edit.addEventListener("click", function () { openObligation(o); }); actions.appendChild(edit);
        var match = document.createElement("button"); match.type = "button"; match.className = "fh-astra-action"; match.textContent = "Match payment"; match.addEventListener("click", function () { openMatch(o); }); actions.appendChild(match);
        var cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "fh-astra-action"; cancel.textContent = "Cancel";
        cancel.addEventListener("click", async function () {
          if (!guard(state.auth)) return;
          if (!root.confirm("Cancel " + (o.label || title) + "? It will stop counting toward company cash.")) return;
          await mutate(CASH_URL, { action: "cancel_obligation", obligation_id: o.id }, cancel, "Cancelling…", "Bill or reserve cancelled.");
        }); actions.appendChild(cancel); row.appendChild(actions);
      }
      box.appendChild(row);
    });
    pager("ccObligationPager", "ccObligationPage", "ccObligationPrev", "ccObligationNext", state.obligationPage, rows.length, function (n) { state.obligationPage = n; renderObligations(); });
  }
  function recurringTitle(c) { return String(c.merchantDisplay || c.merchant_display || c.merchantCanonical || "Observed charge"); }
  function renderRecurring() {
    var rows = list(state.cash.recurring_candidates), box = $("ccRecurring"); box.innerHTML = "";
    if (!rows.length) { box.innerHTML = '<p class="cc-empty-list">No recurring bank pattern found yet. Add known tech bills yourself.</p>'; return; }
    var start = state.recurringPage * PAGE_SIZE;
    if (start >= rows.length) { state.recurringPage = 0; start = 0; }
    rows.slice(start, start + PAGE_SIZE).forEach(function (c) {
      var row = document.createElement("div"); row.className = "cc-row";
      row.innerHTML = '<div class="cc-row-main"><strong>' + esc(recurringTitle(c)) + '</strong><small>Observed pattern' + (c.cadence ? " · possible " + esc(c.cadence) : "") + ' · confirm the actual bill and due date</small></div><div class="cc-row-value">' + money(c.typicalAmountCents) + '</div>';
      var actions = document.createElement("div"); actions.className = "cc-row-actions";
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "fh-astra-action"; btn.textContent = "Review as tech bill";
      btn.addEventListener("click", function () { openObligation(null, c); }); actions.appendChild(btn); row.appendChild(actions); box.appendChild(row);
    });
    pager("ccRecurringPager", "ccRecurringPage", "ccRecurringPrev", "ccRecurringNext", state.recurringPage, rows.length, function (n) { state.recurringPage = n; renderRecurring(); });
  }
  function selectedTransactions() {
    var selected = list(state.bank.accounts).find(function (a) { return a.selected_for_cash === true; });
    return selected ? list(state.bank.transactions).filter(function (t) { return t.company_bank_account_id === selected.id && !t.is_pending && t.posted_on; }) : [];
  }
  function renderTransactions() {
    var rows = selectedTransactions(), start = state.transactionPage * PAGE_SIZE;
    if (start >= rows.length) { state.transactionPage = 0; start = 0; }
    var box = $("ccTransactions"); box.innerHTML = "";
    if (!rows.length) box.innerHTML = '<p class="cc-empty-list">No posted activity for the selected business account yet.</p>';
    rows.slice(start, start + PAGE_SIZE).forEach(function (t) {
      var row = document.createElement("div"); row.className = "cc-row";
      row.innerHTML = '<div class="cc-row-main"><strong>' + esc(t.merchant_name || "Bank transaction") + '</strong><small>' + esc(day(t.posted_on)) + (t.owner_category ? " · Tagged " + esc(t.owner_category) : "") + '</small></div><div class="cc-row-value">' + money(t.amount_cents) + '</div>';
      var actions = document.createElement("div"); actions.className = "cc-row-actions";
      var select = document.createElement("select"); select.setAttribute("aria-label", "Category for " + (t.merchant_name || "bank transaction"));
      [["", "Choose category"], ["crs", "CRS"], ["ad", "Ad funding"], ["tech", "Tech"], ["other", "Other"]].forEach(function (pair) {
        var option = document.createElement("option"); option.value = pair[0]; option.textContent = pair[1]; select.appendChild(option);
      }); select.value = t.owner_category || ""; actions.appendChild(select);
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "fh-astra-action"; btn.textContent = "Save tag";
      btn.addEventListener("click", function () { if (select.value) mutate(CASH_URL, { action: "tag_transaction", transaction_id: t.id, category: select.value }, btn, "Saving…", "Transaction tag saved."); else message("Choose a category first.", true); });
      actions.appendChild(btn); row.appendChild(actions); box.appendChild(row);
    });
    pager("ccTransactionPager", "ccTransactionPage", "ccTransactionPrev", "ccTransactionNext", state.transactionPage, rows.length, function (n) { state.transactionPage = n; renderTransactions(); });
  }
  function pager(boxId, labelId, prevId, nextId, page, count, setPage) {
    var box = $(boxId); box.hidden = count <= PAGE_SIZE;
    if (box.hidden) return;
    $(labelId).textContent = "Page " + (page + 1) + " of " + Math.ceil(count / PAGE_SIZE);
    $(prevId).disabled = page === 0; $(nextId).disabled = (page + 1) * PAGE_SIZE >= count;
    $(prevId).onclick = function () { setPage(page - 1); }; $(nextId).onclick = function () { setPage(page + 1); };
  }
  function closeDialog(id) { var dialog = $(id); if (dialog.open) dialog.close(); }
  function openObligation(o, candidate) {
    if (!guard(state.auth)) return;
    state.editing = o || null;
    $("ccObligationForm").reset(); $("ccFormError").hidden = true;
    $("ccFormTitle").textContent = o ? "Edit bill or reserve" : "Add bill or reserve";
    $("ccSaveObligation").textContent = o ? "Save changes" : "Save bill or reserve";
    $("ccKind").value = o ? o.kind : candidate ? "tech" : "crs";
    $("ccStatus").value = o ? o.status : "planned";
    $("ccLabel").value = o ? o.label || "" : "";
    $("ccAmount").value = o && cents(o.amount_cents) !== null ? (cents(o.amount_cents) / 100).toFixed(2) : "";
    $("ccBillingMonth").value = (o ? day(o.billing_month) : day(state.cash.summary.month)).slice(0, 7);
    $("ccDue").value = o ? day(o.due_on) : "";
    $("ccSourceRef").value = o ? o.source_ref || "" : "";
    $("ccInvoiceCoverage").value = o ? day(o.invoice_covers_through_on) : "";
    $("ccInvoiceVerified").checked = !!(o && o.invoice_verified_at);
    updateInvoiceFields();
    $("ccCandidateNote").hidden = !candidate;
    if (candidate) $("ccCandidateNote").textContent = "Bank pattern: " + recurringTitle(candidate) + ". Enter the confirmed payee, exact amount, and due date yourself.";
    $("ccObligationDialog").showModal(); $("ccLabel").focus();
  }
  function dollarsToCents(raw) {
    if (raw === "") return null;
    var match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(raw));
    if (!match) return NaN;
    var value = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    return Number.isSafeInteger(value) ? value : NaN;
  }
  async function saveObligation(ev) {
    ev.preventDefault();
    if (!guard(state.auth)) return;
    var kind = $("ccKind").value, status = $("ccStatus").value, amount = dollarsToCents($("ccAmount").value.trim());
    var due = $("ccDue").value || null, ref = $("ccSourceRef").value.trim() || null;
    var coverage = kind === "crs" ? $("ccInvoiceCoverage").value || null : null;
    var error = "";
    if (Number.isNaN(amount)) error = "Enter an exact amount with no more than two decimal places.";
    else if ((kind === "ad" || kind === "tech") && status === "approved" && amount === null) error = "Enter the exact amount before approving this month. Enter 0 if none.";
    else if (kind === "tech" && status === "approved" && amount !== 0 && !due) error = "Enter the actual tech bill due date.";
    else if (kind === "crs" && $("ccInvoiceVerified").checked && (amount === null || !ref || !coverage || coverage.slice(0, 7) !== $("ccBillingMonth").value)) error = "A verified CRS invoice needs its exact total, reference, and a covered-through date in its billing month.";
    if (error) { $("ccFormError").textContent = error; $("ccFormError").hidden = false; return; }
    var payload = { kind: kind, status: status, label: $("ccLabel").value.trim(), amount_cents: amount,
      billing_month: $("ccBillingMonth").value + "-01", due_on: due, source_ref: ref,
      invoice_verified: kind === "crs" && $("ccInvoiceVerified").checked,
      invoice_covers_through_on: coverage };
    var body = { action: state.editing ? "update_obligation" : "create_obligation", obligation: payload };
    if (state.editing) body.obligation_id = state.editing.id;
    var btn = $("ccSaveObligation");
    var ok = await mutate(CASH_URL, body, btn, "Saving…", "Bill or reserve saved.");
    if (ok) closeDialog("ccObligationDialog");
    else { $("ccFormError").textContent = "The bill did not save. Check the details and try again."; $("ccFormError").hidden = false; }
  }
  function openMatch(o) {
    var auth = state.auth;
    if (!guard(auth)) return;
    state.matching = o; state.matchCursor = null;
    var seq = ++state.matchSeq;
    var box = $("ccMatchOptions"); box.replaceChildren();
    $("ccMatchError").hidden = true; $("ccMatchMore").hidden = true;
    var loading = document.createElement("p"); loading.className = "cc-empty-list"; loading.textContent = "Finding exact posted debits…";
    box.appendChild(loading);
    $("ccMatchDialog").showModal();
    if (cents(o.amount_cents) === null || cents(o.amount_cents) <= 0) {
      loading.textContent = "No payment match is needed for an unknown or zero amount."; return;
    }
    loadMatchPage(o, auth, seq, null);
  }
  async function loadMatchPage(o, auth, seq, cursor) {
    if (!guard(auth) || state.matching !== o || state.matchSeq !== seq || !$("ccMatchDialog").open) return;
    var button = $("ccMatchMore"); button.disabled = true; button.textContent = "Loading…";
    var query = new URLSearchParams({ match_obligation_id: o.id });
    if (cursor) { query.set("before_posted_on", cursor.postedOn); query.set("before_id", cursor.id); }
    try {
      var data = await request(BANK_URL + "?" + query.toString(), null, auth);
      if (!guard(auth) || state.matching !== o || state.matchSeq !== seq || !$("ccMatchDialog").open) return;
      if (data.obligation_id !== o.id) throw new Error("The posted payments could not be verified. Try again.");
      var box = $("ccMatchOptions");
      if (!cursor) box.replaceChildren();
      var amount = cents(o.amount_cents);
      list(data.transactions).forEach(function (t) {
        if (!uuid(t.id) || !/^\d{4}-\d{2}-\d{2}$/.test(day(t.posted_on)) || cents(t.amount_cents) !== -amount) return;
        var label = document.createElement("label"); label.className = "cc-option";
        label.innerHTML = '<input type="radio" name="ccPayment" value="' + esc(t.id) + '"><span>' + esc(t.merchant_name || "Bank debit") + '<small>' + esc(day(t.posted_on)) + ' · ' + money(t.amount_cents) + '</small></span>';
        box.appendChild(label);
      });
      if (!box.children.length) {
        var empty = document.createElement("p"); empty.className = "cc-empty-list";
        empty.textContent = "No exact posted debit matches this amount on the selected business account."; box.appendChild(empty);
      }
      var validCursor = data.has_more === true && /^\d{4}-\d{2}-\d{2}$/.test(data.next_before_posted_on || "") && uuid(data.next_before_id);
      state.matchCursor = validCursor ? { postedOn: data.next_before_posted_on, id: data.next_before_id } : null;
      button.hidden = !state.matchCursor;
    } catch (err) {
      if (guard(auth) && state.matching === o && state.matchSeq === seq && $("ccMatchDialog").open) {
        $("ccMatchError").textContent = err.message || "Posted payments did not load. Try again.";
        $("ccMatchError").hidden = false;
      }
    } finally {
      if (guard(auth) && state.matching === o && state.matchSeq === seq) { button.disabled = false; button.textContent = "Load older matches"; }
    }
  }
  function updateInvoiceFields() {
    var crs = $("ccKind").value === "crs";
    $("ccInvoiceCoverageRow").hidden = !crs;
    $("ccInvoiceVerifiedRow").hidden = !crs;
    if (!crs) $("ccInvoiceVerified").checked = false;
  }
  async function saveMatch() {
    if (!guard(state.auth)) return;
    var choice = document.querySelector('input[name="ccPayment"]:checked');
    if (!choice) { $("ccMatchError").textContent = "Choose an exact posted debit."; $("ccMatchError").hidden = false; return; }
    var ok = await mutate(CASH_URL, { action: "match_payment", obligation_id: state.matching.id, transaction_id: choice.value }, $("ccSaveMatch"), "Matching…", "Posted payment matched.");
    if (ok) closeDialog("ccMatchDialog"); else { $("ccMatchError").textContent = "The payment did not match. Refresh bank data and try again."; $("ccMatchError").hidden = false; }
  }
  function loadPlaid() {
    if (root.Plaid && typeof root.Plaid.create === "function") return Promise.resolve();
    if (plaidLoading) return plaidLoading;
    plaidLoading = new Promise(function (resolve, reject) {
      var script = document.createElement("script"); script.src = PLAID_SRC; script.async = true;
      script.onload = resolve; script.onerror = function () { plaidLoading = null; reject(new Error("Plaid did not load. Check the connection and try again.")); };
      document.head.appendChild(script);
    });
    return plaidLoading;
  }
  async function connectBank() {
    var auth = state.auth;
    if (!guard(auth) || plaidHandler || !state.bank.configured || !$("ccBusinessConfirm").checked || !$("ccReadConsent").checked) return;
    var btn = $("ccConnect"); setBusy(btn, true, "Opening bank…"); message("");
    try {
      await revalidate(auth);
      var token = await request(BANK_URL, { action: "link_token" }, auth);
      if (!token.linkToken) throw new Error("Plaid did not return a bank window. Try again.");
      await loadPlaid();
      if (!guard(auth)) return;
      var handler = root.Plaid.create({ token: token.linkToken,
        onSuccess: function (publicToken, metadata) {
          if (!guard(auth) || plaidHandler !== handler) return;
          destroyPlaid(false);
          var accounts = list(metadata && metadata.accounts).filter(function (a) { return a.type === "depository" && (!a.iso_currency_code || a.iso_currency_code === "USD"); });
          if (!accounts.length) { message("Plaid did not return a business checking or savings account. Nothing was saved.", true); return; }
          state.pendingLink = { auth: auth, publicToken: publicToken, institutionName: metadata && metadata.institution && metadata.institution.name || null };
          openAccountPicker("link", accounts);
        },
        onExit: function (error) {
          if (plaidHandler !== handler) return;
          destroyPlaid(false);
          if (guard(auth) && error) message("The bank window closed before it finished. Nothing was saved.", true);
        }
      });
      plaidHandler = handler;
      handler.open();
    } catch (err) { destroyPlaid(true); if (guard(auth)) message(err.message, true); }
    finally { if (guard(auth)) setBusy(btn, false); }
  }
  function openAccountPicker(mode, accounts) {
    if (!guard(state.auth)) return;
    state.accountMode = mode; state.accountId = null;
    $("ccAccountConfirm").checked = false; $("ccSaveAccount").disabled = true; $("ccAccountError").hidden = true;
    var box = $("ccAccountOptions"); box.innerHTML = "";
    accounts.forEach(function (a) {
      var label = document.createElement("label"); label.className = "cc-option";
      var id = mode === "link" ? a.id : a.id;
      label.innerHTML = '<input type="radio" name="ccAccount" value="' + esc(id) + '"><span>' + esc(a.name || "Bank account") + '<small>' + esc(a.subtype || a.account_subtype || "Depository") + ' · ••' + esc(a.mask || "") + '</small></span>';
      box.appendChild(label);
    });
    $("ccAccountDialog").showModal();
  }
  function updateAccountButton() {
    var choice = document.querySelector('input[name="ccAccount"]:checked');
    $("ccSaveAccount").disabled = !(choice && $("ccAccountConfirm").checked);
  }
  async function saveAccount() {
    var auth = state.auth;
    if (!guard(auth)) return;
    var choice = document.querySelector('input[name="ccAccount"]:checked');
    if (!choice || !$("ccAccountConfirm").checked) return;
    if (state.accountMode === "link" && (!state.pendingLink || state.pendingLink.auth !== auth)) { clearSensitive(); return; }
    var body = state.accountMode === "link"
      ? { action: "exchange", public_token: state.pendingLink && state.pendingLink.publicToken, account_id: choice.value,
          institution_name: state.pendingLink && state.pendingLink.institutionName, confirm_business_account: true, consent: true }
      : { action: "select_account", account_id: choice.value, confirm_business_account: true };
    var btn = $("ccSaveAccount"); var ok = await mutate(BANK_URL, body, btn, "Saving bank…", "Business account selected. Refresh bank data for a posted balance.");
    if (!guard(auth)) return;
    if (ok) { state.pendingLink = null; closeDialog("ccAccountDialog"); }
    else { $("ccAccountError").textContent = "The business account did not save. Check the account and try again."; $("ccAccountError").hidden = false; }
  }
  async function syncBank() {
    if (!guard(state.auth)) return;
    var items = list(state.bank.items), selected = list(state.bank.accounts).find(function (a) { return a.selected_for_cash === true; });
    var item = selected && items.find(function (i) { return i.id === selected.company_plaid_item_id; }) || items[0];
    if (!item) return;
    await mutate(BANK_URL, { action: "sync", item_id: item.id }, $("ccSync"), "Syncing…", "Business bank transactions synced. Live balance is separate.");
  }
  async function refreshBalance() {
    if (!guard(state.auth) || state.bank.realtime_balance_available !== true) return;
    var selected = list(state.bank.accounts).find(function (a) { return a.selected_for_cash === true; });
    if (!selected || !uuid(selected.company_plaid_item_id)) return;
    await mutate(BANK_URL, { action: "refresh_balance", item_id: selected.company_plaid_item_id }, $("ccRefreshBalance"), "Refreshing…", "Live business balance refreshed.");
  }
  function init() {
    root.addEventListener("storage", function (event) { if (event.key === "fh_token" || event.key === null) if (state.auth && bearer() !== state.auth.token) clearSensitive(); });
    root.addEventListener("pagehide", clearSensitive);
    root.setInterval(function () { if (state.auth && bearer() !== state.auth.token) clearSensitive(); }, 500);
    $("ccRetry").addEventListener("click", function () { load(true); });
    $("ccEmptyAction").addEventListener("click", focusMissing);
    $("ccPrimary").addEventListener("click", function () { if (!guard(state.auth)) return; if (cents(state.cash.summary.available_cents) === null) focusMissing(); else openObligation(null); });
    $("ccSetupAction").addEventListener("click", focusMissing);
    $("ccAddObligation").addEventListener("click", function () { openObligation(null); });
    $("ccObligationForm").addEventListener("submit", saveObligation);
    $("ccKind").addEventListener("change", updateInvoiceFields);
    ["ccCloseObligation", "ccCancelObligation"].forEach(function (id) { $(id).addEventListener("click", function () { closeDialog("ccObligationDialog"); }); });
    ["ccCloseAccount", "ccCancelAccount"].forEach(function (id) { $(id).addEventListener("click", function () { state.pendingLink = null; closeDialog("ccAccountDialog"); }); });
    $("ccAccountDialog").addEventListener("close", function () { state.pendingLink = null; state.accountMode = null; state.accountId = null; });
    ["ccCloseMatch", "ccCancelMatch"].forEach(function (id) { $(id).addEventListener("click", function () { closeDialog("ccMatchDialog"); }); });
    $("ccMatchDialog").addEventListener("close", function () {
      state.matching = null; state.matchCursor = null; state.matchSeq += 1;
      $("ccMatchOptions").replaceChildren(); $("ccMatchMore").hidden = true;
    });
    $("ccMatchMore").addEventListener("click", function () {
      if (!guard(state.auth) || !state.matching || !state.matchCursor || $("ccMatchMore").disabled) return;
      loadMatchPage(state.matching, state.auth, state.matchSeq, state.matchCursor);
    });
    $("ccSaveAccount").addEventListener("click", saveAccount); $("ccSaveMatch").addEventListener("click", saveMatch);
    $("ccAccountConfirm").addEventListener("change", updateAccountButton);
    $("ccAccountOptions").addEventListener("change", updateAccountButton);
    $("ccBusinessConfirm").addEventListener("change", function () { $("ccConnect").disabled = !($("ccBusinessConfirm").checked && $("ccReadConsent").checked); });
    $("ccReadConsent").addEventListener("change", function () { $("ccConnect").disabled = !($("ccBusinessConfirm").checked && $("ccReadConsent").checked); });
    $("ccConnect").addEventListener("click", connectBank); $("ccSync").addEventListener("click", syncBank); $("ccRefreshBalance").addEventListener("click", refreshBalance);
    load(true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})(window);
