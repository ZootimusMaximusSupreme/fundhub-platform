/* Company Fundhub app card for apply.fundhub.ai/thank-you.
 * Nothing is shown until the separate company listing has been verified.
 */
(function () {
  var CONFIG_URL = "https://fundhub.ai/funnel/fundhub-app-download.json";
  var APP_STORE_LINK = /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?app\/(?:[a-z0-9][a-z0-9-]*\/)?id([0-9]{6,20})\/?$/i;
  var PROMPTER_APP_ID = "6823825669";

  function officialCompanyUrl(config) {
    if (!config || config.listing_verified !== true || typeof config.app_store_url !== "string") return "";
    var url = config.app_store_url.trim();
    var match = APP_STORE_LINK.exec(url);
    return match && match[1] !== PROMPTER_APP_ID ? url : "";
  }

  function addStyles() {
    if (document.getElementById("fh-app-download-css")) return;
    var style = document.createElement("style");
    style.id = "fh-app-download-css";
    style.textContent = [
      ".fh-app-download{position:relative;box-sizing:border-box;overflow:hidden;width:min(calc(100% - 48px),760px);margin:32px auto 0;padding:24px;border:1px solid #26262b;border-radius:16px;background:#111113;color:#fff;font-family:var(--sans,Inter,system-ui,sans-serif);text-align:left}",
      ".fh-app-download *{box-sizing:border-box}.fh-app-download::before{content:'';position:absolute;inset:0 0 auto;height:4px;background:var(--spectrum,linear-gradient(90deg,#f2a69b,#f5ce8f,#a8d8b0,#a9c6e8,#c4b3e5))}",
      ".fh-app-download__row{display:flex;align-items:center;gap:24px}.fh-app-download__mark{display:grid;place-items:center;flex:0 0 64px;width:64px;height:64px;border-radius:16px;background:#fff;color:#111113;font-size:38px;font-weight:800;letter-spacing:-.12em;line-height:1;padding-right:5px}",
      ".fh-app-download__body{min-width:0}.fh-app-download__eyebrow{margin:0 0 8px;color:#b9b9c0;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.fh-app-download__title{margin:0;color:#fff;font-size:26px;font-weight:700;letter-spacing:-.04em;line-height:1.1}.fh-app-download__copy{margin:8px 0 0;color:#d0d0d4;font-size:15px;line-height:1.5}",
      ".fh-app-download__button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;margin-top:24px;padding:0 20px;border-radius:10px;background:#fff;color:#111113!important;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none!important;transition:background .18s ease,transform .18s ease}.fh-app-download__button:hover{background:#f2f2f4;transform:translateY(-1px)}.fh-app-download__button:focus-visible{outline:3px solid #fff;outline-offset:3px}.fh-app-download__note{margin:8px 0 0;color:#aaaab1;font-size:12px;line-height:1.4}",
      "@media(max-width:480px){.fh-app-download{width:calc(100% - 24px);margin-top:24px;padding:24px 16px}.fh-app-download__row{align-items:flex-start;gap:16px}.fh-app-download__mark{flex-basis:48px;width:48px;height:48px;border-radius:12px;font-size:30px}.fh-app-download__title{font-size:21px}.fh-app-download__copy{font-size:14px}.fh-app-download__button{width:100%;margin-top:24px}}",
      "@media(prefers-reduced-motion:reduce){.fh-app-download__button{transition:none}.fh-app-download__button:hover{transform:none}}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function showCard(url) {
    if (document.getElementById("fh-app-download")) return;
    var root = document.querySelector(".fh-root");
    var hero = root && root.querySelector(".hero");
    if (!hero || !hero.parentNode) return;
    addStyles();
    var section = document.createElement("section");
    section.id = "fh-app-download";
    section.className = "fh-app-download";
    section.setAttribute("aria-label", "Fundhub app for iPhone");
    section.innerHTML =
      '<div class="fh-app-download__row">' +
      '<div class="fh-app-download__mark" aria-hidden="true">f.</div>' +
      '<div class="fh-app-download__body"><p class="fh-app-download__eyebrow">The Fundhub app</p>' +
      '<h2 class="fh-app-download__title">Take Fundhub with you.</h2>' +
      '<p class="fh-app-download__copy">Open the official Fundhub app on your iPhone.</p></div></div>' +
      '<a class="fh-app-download__button" target="_blank" rel="noopener noreferrer">View Fundhub on the App Store <span aria-hidden="true">→</span></a>' +
      '<p class="fh-app-download__note">Opens the official Apple App Store listing.</p>';
    section.querySelector(".fh-app-download__button").href = url;
    hero.parentNode.insertBefore(section, hero.nextSibling);
  }

  function run() {
    if (!window.fetch) return;
    window.fetch(CONFIG_URL, { credentials: "omit", cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (config) {
        var url = officialCompanyUrl(config);
        if (url) showCard(url);
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
