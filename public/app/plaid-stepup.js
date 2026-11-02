/* Shared client/affiliate authenticator and consent step before Plaid Link. */
(function (root) {
  "use strict";
  function authToken() { try { return localStorage.getItem("fh_token") || ""; } catch (_) { return ""; } }
  function post(body) {
    return fetch("/api/auth/plaid-mfa", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json",
        authorization: "Bearer " + authToken() },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  function words(result) {
    if (result && result.error === "invalid_mfa_code") return "That code did not match. Try the current code in your authenticator.";
    if (result && result.error === "mfa_locked") return "Too many codes were tried. Wait 15 minutes and try again.";
    if (result && result.error === "consent_required") return "Check the consent box to connect your bank.";
    if (result && result.error === "mfa_unavailable") return "Bank verification is not ready. Try again later.";
    if (result && result.error === "forbidden") return "The client needs to connect their own bank from their portal.";
    return "Bank verification did not work. Try again.";
  }
  function makeDialog(setup) {
    var dialog = document.createElement("dialog");
    dialog.className = "fh-plaid-stepup";
    dialog.innerHTML = '<form method="dialog" class="fh-plaid-stepup-box">' +
      '<h2>Verify before connecting your bank</h2>' +
      '<p class="fh-plaid-stepup-help"></p>' +
      '<div class="fh-plaid-stepup-setup" hidden><p>Add Fundhub to your authenticator app with this setup key:</p>' +
      '<code class="fh-plaid-stepup-secret"></code></div>' +
      '<label class="fh-plaid-stepup-code">Authenticator code<input name="code" type="text" inputmode="numeric" ' +
      'autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>' +
      '<label class="fh-plaid-stepup-consent"><input name="consent" type="checkbox" required><span></span></label>' +
      '<p class="fh-plaid-stepup-error" role="alert" aria-live="polite"></p>' +
      '<div class="fh-plaid-stepup-actions"><button type="button" data-cancel>Cancel</button>' +
      '<button type="submit" data-continue>Verify and connect</button></div></form>';
    dialog.querySelector(".fh-plaid-stepup-help").textContent = setup.enrolled
      ? "Enter the code from the authenticator you use for Fundhub."
      : "Set up an authenticator app first, then enter its current six-digit code.";
    if (!setup.enrolled) {
      dialog.querySelector(".fh-plaid-stepup-setup").hidden = false;
      dialog.querySelector(".fh-plaid-stepup-secret").textContent = setup.secret;
    }
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
    return post({ action: "setup", target_kind: targetKind }).then(function (setup) {
      if (!setup || !setup.ok) throw new Error(words(setup));
      return new Promise(function (resolve, reject) {
        var dialog = makeDialog(setup), busy = false, done = false;
        function finish(value, error) {
          if (done) return;
          done = true;
          dialog.close(); dialog.remove();
          if (error) reject(error); else resolve(value);
        }
        dialog.querySelector("[data-cancel]").addEventListener("click", function () { finish(null, new Error("cancelled")); });
        dialog.addEventListener("cancel", function (e) { e.preventDefault(); finish(null, new Error("cancelled")); });
        dialog.querySelector("form").addEventListener("submit", function (e) {
          e.preventDefault();
          if (busy) return;
          busy = true;
          var button = dialog.querySelector("[data-continue]");
          button.disabled = true; button.textContent = "Checking…";
          var code = dialog.querySelector("[name=code]").value.trim();
          var consent = dialog.querySelector("[name=consent]").checked;
          post({ action: "authorize", target_kind: targetKind, code: code, consent: consent })
            .then(function (result) {
              if (!result || !result.ok || !result.grant_token) {
                dialog.querySelector(".fh-plaid-stepup-error").textContent = words(result);
                busy = false; button.disabled = false; button.textContent = "Verify and connect";
                return;
              }
              finish(result.grant_token);
            }, function () {
              dialog.querySelector(".fh-plaid-stepup-error").textContent = "No connection. Try again.";
              busy = false; button.disabled = false; button.textContent = "Verify and connect";
            });
        });
        dialog.showModal();
        dialog.querySelector("[name=code]").focus();
      });
    });
  }
  root.FHPlaidStepUp = { authorize: authorize };
})(window);
