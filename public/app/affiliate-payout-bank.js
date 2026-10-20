/* The affiliate's payout bank, on affiliate.html's Payouts tab (492).
 *
 * POST /api/affiliates/payout-account { action: "link_token" } → Plaid Link
 * (product "transfer") → { action: "exchange", public_token } saves the bank.
 * The affiliate id comes off the session on the server; nothing here names it.
 * The Plaid access token never reaches the browser.
 */
(function (root) {
  "use strict";
  var PLAID_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
  function $(id) { return document.getElementById(id); }
  function token() { try { return localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }
  function say(t) { var m = $("payBankMsg"); if (m) m.textContent = t || ""; }

  function post(body) {
    return fetch("/api/affiliates/payout-account", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer " + token() },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .catch(function () { return { ok: false, message: "No connection. Check the internet and try again." }; });
  }

  var plaidLoading = null;
  function loadPlaid() {
    if (root.Plaid && typeof root.Plaid.create === "function") return Promise.resolve();
    if (plaidLoading) return plaidLoading;
    plaidLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = PLAID_SRC; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { plaidLoading = null; reject(new Error("plaid script")); };
      document.head.appendChild(s);
    });
    return plaidLoading;
  }

  function paint(bank) {
    var box = $("payBankBox"), text = $("payBankText"), btn = $("payBankLink");
    if (!box || !text || !btn) return;
    box.hidden = false;
    btn.hidden = false;
    if (!bank) {
      text.textContent = "Link the bank account your payouts go to. It takes about a minute with Plaid.";
      btn.textContent = "Link your bank";
      return;
    }
    var label = (bank.institution || "Your bank") + " ··" + (bank.mask || "") + (bank.subtype ? " (" + bank.subtype + ")" : "");
    text.textContent = bank.testData
      ? "Linked: " + label + ". This is Plaid test data, so no real payout can go here. Link your real bank."
      : "Payouts go to " + label + ".";
    btn.textContent = "Change bank";
  }

  function link() {
    var btn = $("payBankLink");
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = "Opening your bank…";
    say("");
    function done() { btn.disabled = false; btn.textContent = label; }
    post({ action: "link_token" }).then(function (res) {
      if (!res || !res.ok || !res.link_token) { done(); say((res && res.message) || "Bank linking is not open right now. Try again later."); return; }
      return loadPlaid().then(function () {
        var handler = root.Plaid.create({
          token: res.link_token,
          onSuccess: function (publicToken, metadata) {
            btn.textContent = "Saving your bank…";
            var inst = metadata && metadata.institution ? { name: metadata.institution.name || null } : null;
            var acct = metadata && metadata.accounts && metadata.accounts.length === 1 ? metadata.accounts[0].id : null;
            post({ action: "exchange", public_token: publicToken, institution: inst, account_id: acct }).then(function (r2) {
              done();
              if (!r2 || !r2.ok) { say((r2 && r2.message) || "The bank did not save. Try again."); return; }
              say("Bank linked. Your next payout goes here.");
              paint(r2.account);
            });
          },
          onExit: function (err) { done(); if (err) say("The bank window closed before it finished. Nothing was saved."); }
        });
        handler.open();
      }, function () { done(); say("The bank sign-in window did not load. Check your connection and try again."); });
    });
  }

  function init() {
    var btn = $("payBankLink");
    if (btn) btn.addEventListener("click", link);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  root.FHPayoutBank = { paint: paint };
})(window);
