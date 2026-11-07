/* This page's sign-in flow stays independent of optional install choices. */
(function () {
  "use strict";
  var policy = window.FHDeviceDestinations;
  var button = document.getElementById("download");
  if (!button || !policy || policy.detect(navigator) !== "iphone" || !window.fetch) return;
  window.fetch("/funnel/fundhub-prompter-download.json", { credentials: "omit", cache: "no-store" })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (config) {
      if (!policy.iphoneUrl(config)) return;
      // This is an optional, deliberate store tap; web sign-in stays available.
      var link = document.createElement("a");
      link.className = "portal-app-download";
      link.href = policy.iphoneUrl(config);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Get the iPhone app";
      button.appendChild(link);
      button.hidden = false;
    })
    .catch(function () { /* The normal web sign-in form remains usable. */ });
})();
