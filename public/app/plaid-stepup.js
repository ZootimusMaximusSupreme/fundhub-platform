/* Shared, session-bound passkey verification and consent before Plaid Link. */
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
  function postAt(url, body, flow) {
    return Promise.resolve().then(function () {
      flow.guard();
      return fetch(url, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json",
        authorization: "Bearer " + flow.token },
      body: JSON.stringify(body)
      });
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (result) { flow.guard(); return result; });
  }
  function post(body, flow) { return postAt("/api/auth/plaid-mfa", body, flow); }
  function passkeyPost(targetKind, body, flow) {
    return postAt("/api/auth/passkey", Object.assign({}, body, { target_kind: targetKind }), flow);
  }
  function binary(value) {
    var raw = root.atob(String(value).replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function encoded(value) {
    var bytes = new Uint8Array(value), raw = "";
    for (var i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
    return root.btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function publicKeyOptions(options) {
    var result = Object.assign({}, options, { challenge: binary(options.challenge) });
    if (options.user) result.user = Object.assign({}, options.user, { id: binary(options.user.id) });
    ["allowCredentials", "excludeCredentials"].forEach(function (key) {
      if (Array.isArray(options[key])) result[key] = options[key].map(function (item) {
        return Object.assign({}, item, { id: binary(item.id) });
      });
    });
    return result;
  }
  function credentialResponse(credential) {
    if (!credential || credential.type !== "public-key" || !credential.response) throw new Error("passkey_not_completed");
    if (typeof credential.toJSON === "function") return credential.toJSON();
    var response = { clientDataJSON: encoded(credential.response.clientDataJSON) };
    ["attestationObject", "authenticatorData", "signature", "userHandle"].forEach(function (key) {
      if (credential.response[key]) response[key] = encoded(credential.response[key]);
    });
    if (typeof credential.response.getTransports === "function") response.transports = credential.response.getTransports();
    var result = { id: credential.id, rawId: encoded(credential.rawId), type: credential.type,
      response: response, clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {} };
    if (credential.authenticatorAttachment) result.authenticatorAttachment = credential.authenticatorAttachment;
    return result;
  }
  function passkeyWords(result) {
    var code = result && (result.error || result.code || result.message);
    if (code === "fresh_login_required") return "Sign in again, then return here to set up your passkey.";
    if (code === "rate_limited" || code === "too_many_passkey_attempts") return "Too many attempts. Wait a moment and try again.";
    if (code === "forbidden" || code === "unauthorized") return "Sign in to your own account to verify this bank connection.";
    if (code === "invalid_recovery_code") return "That recovery code did not work. Enter an unused code.";
    if (code === "NotAllowedError" || code === "AbortError" || code === "passkey_not_completed") return "The passkey check was not completed. Try again when you are ready.";
    return "The passkey check did not finish. Try again with a saved passkey.";
  }
  async function verifyInFlow(targetKind, flow) {
    var status = await passkeyPost(targetKind, { action: "status" }, flow);
    if (!status || !status.ok) throw new Error(passkeyWords(status));
    if (status.assured === true) return status;
    var supported = !!(root.PublicKeyCredential && root.navigator.credentials && root.isSecureContext);
    flow.guard();
    return new Promise(function (resolve, reject) {
      var dialog = document.createElement("dialog"), enrolled = status.enrolled === true, recoveryRequired = status.recovery_required === true;
      var busy = false, done = false, recoveryToken = null, verified = null, controller = null, unwatch = function () {};
      dialog.className = "fh-plaid-stepup";
      dialog.innerHTML = '<form method="dialog" class="fh-plaid-stepup-box">' +
        '<h2 data-passkey-title></h2><p data-passkey-description></p>' +
        '<p class="fh-plaid-stepup-error" role="alert" aria-live="polite"></p>' +
        '<a data-passkey-signin hidden>Sign in again</a>' +
        '<p class="fh-plaid-stepup-browser">If passkeys are unavailable here, <a data-passkey-browser target="_blank" rel="noopener noreferrer">use a browser instead</a>. Sign in and return to your bank connection. On Mac, open fundhub.ai in Safari or Chrome.</p>' +
        '<details data-passkey-recovery><summary>Use a recovery code</summary>' +
        '<label>Unused recovery code<input name="recovery" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
        '<button type="button" data-recover>Recover passkey access</button></details>' +
        '<div data-passkey-codes hidden><p>Save these one-use recovery codes somewhere private. They let you set up a new passkey if you lose access to this one. They will not appear again.</p>' +
        '<label>Recovery codes<textarea readonly spellcheck="false" rows="7"></textarea></label></div>' +
        '<div class="fh-plaid-stepup-actions"><button type="button" data-cancel>Cancel</button>' +
        '<button type="submit" data-continue></button></div></form>';
      var title = dialog.querySelector("[data-passkey-title]"), description = dialog.querySelector("[data-passkey-description]");
      var button = dialog.querySelector("[data-continue]"), recovery = dialog.querySelector("[data-passkey-recovery]");
      var recoverButton = dialog.querySelector("[data-recover]"), error = dialog.querySelector(".fh-plaid-stepup-error");
      var signin = dialog.querySelector("[data-passkey-signin]");
      signin.href = targetKind === "client_bank" ? "/portal-login.html" : "/login.html?next=" +
        encodeURIComponent(targetKind === "affiliate_payout" ? "/app/affiliate.html" : "/app/company-cash.html");
      // The verified www alias redirects to the canonical sign-in. Existing
      // iOS shells open it in the system browser, where passkeys work even
      // before the newly entitled app version is available. Transfer no token.
      dialog.querySelector("[data-passkey-browser]").href = "https://www.fundhub.ai" + signin.getAttribute("href");
      function render() {
        if (!supported) {
          title.textContent = "Verify in a browser";
          description.textContent = "Use Safari or Chrome to set up or verify your passkey, then connect your bank.";
          button.hidden = true; recovery.hidden = true;
          return;
        }
        button.hidden = recoveryRequired;
        if (recoveryRequired) {
          title.textContent = "Recover your passkey";
          description.textContent = "Use an unused recovery code to set up a replacement passkey, then verify it before connecting your bank.";
          recovery.hidden = false; recovery.open = true;
          return;
        }
        title.textContent = enrolled ? "Verify your bank connection" : "Set up a passkey";
        description.textContent = enrolled
          ? "Use your saved passkey. Your device may use Face ID, a fingerprint, or its unlock code."
          : "Your Fundhub account is ready. Set up a passkey to protect bank connections using Face ID, a fingerprint, or your device unlock code.";
        button.textContent = enrolled ? "Verify and continue" : "Set up passkey";
        recovery.hidden = !enrolled;
      }
      function finish(value, failure) {
        if (done) return;
        done = true; unwatch();
        if (controller) controller.abort();
        var codes = dialog.querySelector("textarea"); codes.value = "";
        recoveryToken = null; verified = null; removeDialog(dialog);
        if (failure) reject(failure); else {
          var safe = Object.assign({}, value); delete safe.recovery_codes; resolve(safe);
        }
      }
      function showError(result) {
        error.textContent = passkeyWords(result);
        signin.hidden = !result || result.error !== "fresh_login_required";
      }
      async function execute() {
        if (verified) { finish(verified); return; }
        if (!supported || busy || done) return;
        busy = true; button.disabled = true; recoverButton.disabled = true;
        button.textContent = "Checking…"; error.textContent = ""; signin.hidden = true;
        try {
          var action = enrolled ? "authenticate" : "register";
          var request = { action: action + "_options" };
          if (recoveryToken) request.recovery_token = recoveryToken;
          var setup = await passkeyPost(targetKind, request, flow);
          if (!setup || !setup.ok) { showError(setup); return; }
          controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
          var credentialRequest = { publicKey: publicKeyOptions(setup.options) };
          if (controller) credentialRequest.signal = controller.signal;
          var credential = await root.navigator.credentials[enrolled ? "get" : "create"](credentialRequest);
          flow.guard();
          var result = await passkeyPost(targetKind, { action: action + "_verify", challenge_token: setup.challenge_token,
            response: credentialResponse(credential) }, flow);
          if (done) return;
          if (!result || !result.ok) { showError(result); return; }
          if (!enrolled) {
            if (result.registered !== true) { showError(result); return; }
            enrolled = true; recoveryToken = null; render();
            description.textContent = "Your passkey is saved. Verify it now before connecting your bank.";
            return;
          }
          if (result.assured !== true) { showError(result); return; }
          if (Array.isArray(result.recovery_codes) && result.recovery_codes.length) {
            verified = result;
            dialog.querySelector("[data-passkey-codes]").hidden = false;
            dialog.querySelector("textarea").value = result.recovery_codes.join("\n");
            recovery.hidden = true;
            title.textContent = "Save your recovery codes";
            description.textContent = "Your bank connection is verified.";
            button.textContent = "I saved these codes";
            return;
          }
          finish(result);
        } catch (failure) {
          if (done) return;
          if (!flow.current()) { flow.cancel(); return; }
          showError({ error: failure && (failure.name || failure.message) });
        } finally {
          if (!done) { busy = false; button.disabled = false; recoverButton.disabled = false;
            if (!verified && button.textContent === "Checking…") button.textContent = enrolled ? "Verify and continue" : "Set up passkey"; }
        }
      }
      dialog.querySelector("form").addEventListener("submit", function (event) { event.preventDefault(); execute(); });
      recoverButton.addEventListener("click", async function () {
        if (!supported || busy || done) return;
        var input = dialog.querySelector("[name=recovery]"), code = input.value.trim();
        if (!code) { error.textContent = "Enter an unused recovery code."; return; }
        busy = true; button.disabled = true; recoverButton.disabled = true; error.textContent = "";
        try {
          var result = await passkeyPost(targetKind, { action: "recover", recovery_code: code }, flow);
          input.value = "";
          if (done) return;
          if (!result || !result.ok || !result.recovery_token) { showError(result); return; }
          recoveryToken = result.recovery_token; enrolled = false; recoveryRequired = false; recovery.open = false; render();
          description.textContent = "Set up a new passkey, then verify it before connecting your bank.";
        } catch (_) { if (!done && flow.current()) showError(null); }
        finally { input.value = ""; if (!done) { busy = false; button.disabled = false; recoverButton.disabled = false; } }
      });
      unwatch = flow.onCancel(function () { finish(null, new Error("cancelled")); });
      dialog.querySelector("[data-cancel]").addEventListener("click", function () { finish(null, new Error("cancelled")); });
      dialog.addEventListener("cancel", function (event) { event.preventDefault(); finish(null, new Error("cancelled")); });
      render(); document.body.appendChild(dialog); dialog.showModal();
      (supported && !recoveryRequired ? button : dialog.querySelector(!supported ? "[data-passkey-browser]" : "[name=recovery]")).focus();
    });
  }
  function verify(targetKind) {
    var flow = sessionFlow();
    return Promise.race([verifyInFlow(targetKind, flow), flow.cancelled]).then(function (result) {
      flow.guard(); return result;
    }).finally(flow.dispose);
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
    var run = verifyInFlow(targetKind, flow).then(function () {
      return post({ action: "consent_details", target_kind: targetKind }, flow);
    }).then(function (setup) {
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
  root.FHPlaidStepUp = { authorize: authorize, verify: verify };
})(window);
