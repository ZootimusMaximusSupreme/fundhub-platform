/* Shared client/affiliate consent step before Plaid Link. */
(function (root) {
  "use strict";
  function authToken() { try { return localStorage.getItem("fh_token") || ""; } catch (_) { return ""; } }
  function sessionFlow() {
    var token = authToken(), stopped = false, listeners = [], rejectCancelled;
    var cancelled = new Promise(function (_resolve, reject) { rejectCancelled = reject; });
    function current() { return !stopped && !!token && authToken() === token; }
    function dispose() {
      root.clearInterval(timer);
      root.removeEventListener("storage", changed);
      root.removeEventListener("pagehide", cancel);
      stopped = true; listeners = [];
    }
    function cancel() {
      if (stopped) return;
      stopped = true;
      listeners.slice().forEach(function (close) { close(); });
      rejectCancelled(new Error("cancelled"));
      dispose();
    }
    function changed() { if (!current()) cancel(); }
    function guard() { if (!current()) { cancel(); throw new Error("cancelled"); } }
    root.addEventListener("storage", changed);
    root.addEventListener("pagehide", cancel);
    // Same-tab storage writes emit no storage event. Watch only while this
    // one flow is open; no auth/network polling or persistent global timer.
    var timer = root.setInterval(changed, 200);
    return { token: token, cancelled: cancelled, current: current, guard: guard,
      cancel: cancel, dispose: dispose, onCancel: function (close) {
        listeners.push(close);
        return function () { listeners = listeners.filter(function (item) { return item !== close; }); };
      } };
  }
  function removeDialog(dialog) {
    dialog.querySelectorAll("input").forEach(function (input) { input.value = ""; input.checked = false; });
    dialog.close(); dialog.remove();
  }
  function post(body, flow) {
    return Promise.resolve().then(function () {
      flow.guard();
      return fetch("/api/auth/plaid-mfa", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json",
        authorization: "Bearer " + flow.token },
      body: JSON.stringify(body)
      });
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (result) { flow.guard(); return result; });
  }
  function words(result) {
    if (result && result.error === "consent_required") return "Check the consent box to connect your bank.";
    if (result && result.error === "forbidden") return "The client needs to connect their own bank from their portal.";
    return "Bank consent did not save. Try again.";
  }
  function makeDialog(setup, flow) {
    flow.guard();
    var dialog = document.createElement("dialog");
    dialog.className = "fh-plaid-stepup";
    dialog.innerHTML = '<form method="dialog" class="fh-plaid-stepup-box">' +
      '<h2>Connect your bank</h2>' +
      '<label class="fh-plaid-stepup-consent"><input name="consent" type="checkbox" required><span></span></label>' +
      '<p class="fh-plaid-stepup-error" role="alert" aria-live="polite"></p>' +
      '<div class="fh-plaid-stepup-actions"><button type="button" data-cancel>Cancel</button>' +
      '<button type="submit" data-continue>Agree and connect</button></div></form>';
    var consentWords = dialog.querySelector(".fh-plaid-stepup-consent span");
    consentWords.textContent = setup.consent_text + " Read our ";
    var privacy = document.createElement("a");
    privacy.href = setup.privacy_url || "/privacy/";
    privacy.target = "_blank";
    privacy.rel = "noopener noreferrer";
    privacy.textContent = "Privacy Policy";
    consentWords.appendChild(privacy);
    consentWords.appendChild(document.createTextNode("."));
    document.body.appendChild(dialog);
    return dialog;
  }
  function authorize(targetKind) {
    var flow = sessionFlow();
    var run = post({ action: "consent_details", target_kind: targetKind }, flow).then(function (setup) {
      if (!setup || !setup.ok) throw new Error(words(setup));
      return setup;
    }).then(function (setup) {
      flow.guard();
      return new Promise(function (resolve, reject) {
        var dialog = makeDialog(setup, flow), busy = false, done = false, unwatch = function () {};
        function finish(value, error) {
          if (done) return;
          done = true; unwatch(); removeDialog(dialog);
          if (error) reject(error); else resolve(value);
        }
        unwatch = flow.onCancel(function () { finish(null, new Error("cancelled")); });
        dialog.querySelector("[data-cancel]").addEventListener("click", function () { finish(null, new Error("cancelled")); });
        dialog.addEventListener("cancel", function (e) { e.preventDefault(); finish(null, new Error("cancelled")); });
        dialog.querySelector("form").addEventListener("submit", function (e) {
          e.preventDefault();
          if (busy) return;
          busy = true;
          var button = dialog.querySelector("[data-continue]");
          button.disabled = true; button.textContent = "Checking…";
          var consent = dialog.querySelector("[name=consent]").checked;
          post({ action: "authorize", target_kind: targetKind, consent: consent }, flow)
            .then(function (result) {
              if (done) return;
              if (!flow.current()) { flow.cancel(); return; }
              if (!result || !result.ok || !result.grant_token) {
                dialog.querySelector(".fh-plaid-stepup-error").textContent = words(result);
                busy = false; button.disabled = false; button.textContent = "Agree and connect";
                return;
              }
              finish(result.grant_token);
            }, function () {
              if (done) return;
              if (!flow.current()) { flow.cancel(); return; }
              dialog.querySelector(".fh-plaid-stepup-error").textContent = "No connection. Try again.";
              busy = false; button.disabled = false; button.textContent = "Agree and connect";
            });
        });
        dialog.showModal();
        dialog.querySelector("[name=consent]").focus();
      });
    });
    return Promise.race([run, flow.cancelled]).then(function (grant) {
      flow.guard(); return grant;
    }).finally(flow.dispose);
  }
  root.FHPlaidStepUp = { authorize: authorize };
})(window);
