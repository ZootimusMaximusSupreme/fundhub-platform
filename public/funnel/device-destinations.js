/* Public install choices. Signals suggest a device; they never move a session. */
(function (root) {
  "use strict";
  var publicUrl = "https://fundhub.ai/devices.html";
  var webUrl = "https://fundhub.ai/portal-login.html";

  function detect(nav) {
    try {
      nav = nav || {};
      var ua = String(nav.userAgent || "");
      var hint = String(nav.userAgentData && nav.userAgentData.platform || "").toLowerCase();
      var platform = String(nav.platform || "");
      var touch = Number(nav.maxTouchPoints || 0);
      var uaKind = /Android/i.test(ua) ? "android" :
        /Windows|Win32|Win64/i.test(ua) ? "windows" :
        /iPad|iPod/i.test(ua) ? "unknown" :
        /iPhone/i.test(ua) ? "iphone" :
        /Macintosh|Mac OS X/i.test(ua) ? "mac" :
        /Linux|CrOS|X11/i.test(ua) ? "other" : "unknown";
      var hintKind = hint === "android" ? "android" : hint === "windows" ? "windows" :
        hint === "macos" ? "mac" : hint === "ios" ? "iphone" :
        /^(linux|chrome os|chromium os)$/.test(hint) ? "other" : "unknown";
      if (uaKind !== "unknown" && hintKind !== "unknown" && uaKind !== hintKind) return "unknown";
      // iPad can advertise the same UA/platform as a Mac. Touch is an ambiguity
      // guard, never an assertion that this hardware is an iPad or a Mac.
      if (/iPad|iPod/i.test(ua) || ((uaKind === "mac" || hintKind === "mac" || /Mac/i.test(platform)) && touch > 1)) return "unknown";
      var kind = uaKind !== "unknown" ? uaKind : hintKind;
      // A contradictory legacy platform is another reason to stay in the
      // browser. Never use platform alone to grant an Apple app choice.
      if (kind === "iphone" && /^(Win|Mac|Linux|CrOS|X11)/i.test(platform)) return "unknown";
      if (kind === "mac" && /^(Win|Linux|CrOS|X11|iPhone|iPad|iPod)/i.test(platform)) return "unknown";
      if (kind === "iphone") {
        // The published app requires iOS17. Missing/reduced version stays web.
        var version = ua.match(/(?:CPU iPhone OS|iPhone OS|CPU OS)\s+(\d+)[_\.]/i);
        if (!/iPhone/i.test(ua) || !version || Number(version[1]) < 17) return "unknown";
      }
      return kind;
    } catch (_err) {
      return "unknown";
    }
  }

  function iphoneUrl(config) {
    var value = String(config && config.app_store_url || "").trim();
    // Only the existing Fundhub Portal listing, never an arbitrary config URL.
    return /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[^/?#]+\/)?id6823985032\/?$/.test(value) ? value : "";
  }

  root.FHDeviceDestinations = Object.freeze({
    detect: detect,
    publicUrl: publicUrl,
    webUrl: webUrl,
    iphoneUrl: iphoneUrl
  });
})(window);
