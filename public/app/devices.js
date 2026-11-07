/* Public device-transfer link only. Never share the current URL or session. */
(function () {
  "use strict";
  var PUBLIC_URL = "https://fundhub.ai/devices.html";
  var PORTAL_PATH = "/app/client-portal.html";
  var CONFIG_URL = "/funnel/fundhub-prompter-download.json";
  var policy = window.FHDeviceDestinations;
  var device = "unknown";
  try { if (policy && typeof policy.detect === "function") device = policy.detect(navigator); }
  catch (_e) { /* An uncertain device gets only the ordinary browser route. */ }

  var link = document.getElementById("device-link");
  var copy = document.getElementById("copy-link");
  var share = document.getElementById("share-link");
  var status = document.getElementById("transfer-status");
  var qrWrap = document.getElementById("qr-wrap");
  var qr = document.getElementById("device-qr");
  var install = document.getElementById("iphone-install");
  var choice = document.getElementById("iphone-choice");
  var appStatus = document.getElementById("app-status");
  var appSlot = document.getElementById("iphone-link-slot");
  var retry = document.getElementById("retry-app");
  if (!link || !copy || !share || !status) return;
  link.value = PUBLIC_URL;
  document.getElementById("open-browser").setAttribute("href", PORTAL_PATH);

  /* Stay inside the existing portal session, including native workspace views.
     Only use history for a same-origin workspace entry; otherwise use Home. */
  var back = document.getElementById("back-fundhub");
  try {
    var previous = new URL(document.referrer);
    if (back && previous.origin === window.location.origin &&
        (previous.pathname.indexOf("/app/") === 0 || previous.pathname === "/progress.html")) {
      back.addEventListener("click", function (event) {
        if (window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      });
    }
  } catch (_e) { /* Empty/foreign referrers keep the ordinary portal link. */ }
  document.body.setAttribute("data-device", device);

  if (device === "iphone" || device === "android") {
    document.getElementById("transfer-title").textContent = "Use Fundhub on your computer.";
    document.getElementById("transfer-copy").textContent = "Share this link to your computer, or copy it and open it there.";
    qrWrap.hidden = true;
  }
  function qrFailed() {
    qrWrap.hidden = true;
    document.getElementById("qr-error").hidden = false;
  }
  if (qr) {
    qr.addEventListener("error", qrFailed);
    if (qr.complete && !qr.naturalWidth) qrFailed();
  }

  function selectLink() {
    try { link.focus(); link.select(); link.setSelectionRange(0, PUBLIC_URL.length); return true; }
    catch (_e) { return false; }
  }
  function manualCopy() {
    status.textContent = selectLink()
      ? "Link selected. Copy it, then open it on your other device."
      : "Copy the link above, then open it on your other device.";
  }

  copy.addEventListener("click", function () {
    copy.disabled = true;
    status.textContent = "Copying link…";
    Promise.resolve().then(function () {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("clipboard unavailable");
      return navigator.clipboard.writeText(PUBLIC_URL);
    }).then(function () {
      copy.textContent = "Link copied";
      status.textContent = "Link copied. Open it on your other device.";
    }).catch(manualCopy).then(function () { copy.disabled = false; });
  });
  copy.hidden = false;

  if (typeof navigator.share === "function") {
    share.addEventListener("click", function () {
      share.disabled = true;
      status.textContent = "Opening share options…";
      Promise.resolve().then(function () {
        return navigator.share({ title: "Fundhub", text: "Open Fundhub on your other device.", url: PUBLIC_URL });
      }).then(function () {
        status.textContent = "Share options closed. You can also copy the link.";
      }).catch(function (error) {
        if (error && error.name === "AbortError") {
          status.textContent = "Sharing cancelled. Your link is still here.";
          return;
        }
        status.textContent = "Sharing could not open here. Copy the link instead.";
        selectLink();
      }).then(function () { share.disabled = false; });
    });
    share.hidden = false;
  }

  /* App downloads require a clear supported iPhone AND a deliberate choice.
     No Apple link is created for any other platform or before that choice. */
  if (device !== "iphone" || !policy || typeof policy.iphoneUrl !== "function" || !install || !choice || !retry) return;
  var iphoneUrl = "";
  var requestId = 0;
  install.hidden = false;
  choice.addEventListener("click", function () {
    if (!iphoneUrl) return;
    var appLink = document.createElement("a");
    appLink.className = "fh-astra-action";
    appLink.id = "iphone-download";
    appLink.textContent = "Open the iPhone App Store ↗";
    appLink.href = iphoneUrl;
    appLink.target = "_blank";
    appLink.rel = "noopener noreferrer";
    appSlot.replaceChildren(appLink);
    choice.hidden = true;
    appStatus.textContent = "The iPhone download is ready.";
    appLink.focus();
  });

  function loadApp() {
    var id = ++requestId;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = window.setTimeout(function () {
      if (id !== requestId) return;
      requestId++;
      if (controller) controller.abort();
      appFailed();
    }, 8000);
    iphoneUrl = "";
    choice.hidden = true;
    retry.hidden = true;
    appSlot.replaceChildren();
    install.setAttribute("data-app-state", "loading");
    appStatus.textContent = "Checking the app option…";
    Promise.resolve().then(function () {
      if (typeof window.fetch !== "function") throw new Error("fetch unavailable");
      return window.fetch(CONFIG_URL, { credentials: "omit", cache: "no-store", signal: controller ? controller.signal : undefined });
    }).then(function (response) {
      if (!response.ok) throw new Error("app option unavailable");
      return response.json();
    }).then(function (config) {
      if (id !== requestId) return;
      window.clearTimeout(timer);
      iphoneUrl = policy.iphoneUrl(config);
      if (!iphoneUrl) {
        install.setAttribute("data-app-state", "empty");
        appStatus.textContent = "You can use the browser portal on this device.";
        return;
      }
      install.setAttribute("data-app-state", "full");
      appStatus.textContent = "Prefer the app on this iPhone?";
      choice.hidden = false;
    }).catch(function () {
      if (id !== requestId) return;
      window.clearTimeout(timer);
      appFailed();
    });
  }
  function appFailed() {
    iphoneUrl = "";
    install.setAttribute("data-app-state", "error");
    appStatus.textContent = "The app option could not load. You can still use the browser portal.";
    choice.hidden = true;
    retry.hidden = false;
  }
  retry.addEventListener("click", loadApp);
  loadApp();
})();
