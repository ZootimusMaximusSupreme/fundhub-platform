/* Fundhub Portal download card for the apply.fundhub.ai /thank-you builder page.
 * The card only renders after the live App Store URL is placed in the
 * adjacent JSON file. That keeps the live funnel free of dead download links. */
(function () {
  var CONFIG_URL = "https://fundhub.ai/funnel/fundhub-prompter-download.json";
  var LINK = /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[^?#/]+\/)?id6823985032\/?$/;

  function addStyles() {
    if (document.getElementById("fh-prompter-download-css")) return;
    var style = document.createElement("style");
    style.id = "fh-prompter-download-css";
    style.textContent =
      ".fh-prompter-download{box-sizing:border-box;width:min(100% - 32px,680px);margin:28px auto 0;padding:20px;border:1px solid #202024;border-radius:18px;background:#0c0c0d;color:#fff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 18px 42px -24px rgba(0,0,0,.55)}" +
      ".fh-prompter-download *{box-sizing:border-box}.fh-prompter-download__top{display:flex;align-items:center;gap:14px;text-align:left}.fh-prompter-download__icon{width:54px;height:54px;flex:0 0 54px;border-radius:13px;background:#0c0c0d}.fh-prompter-download__eyebrow{margin:0 0 3px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#b9b9c0}.fh-prompter-download__title{margin:0;font-size:20px;line-height:1.1;letter-spacing:-.03em;color:#fff}.fh-prompter-download__copy{margin:16px 0 0;max-width:51ch;font-size:15px;line-height:1.55;color:#d0d0d4;text-align:left}.fh-prompter-download__button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;margin-top:18px;padding:0 18px;border-radius:10px;background:#fff;color:#0c0c0d;font-size:15px;font-weight:750;line-height:1;text-decoration:none;transition:transform .18s ease,background .18s ease}.fh-prompter-download__button:hover{background:#f0f0f2;transform:translateY(-1px)}.fh-prompter-download__button:focus-visible{outline:3px solid #9b9ba3;outline-offset:3px}.fh-prompter-download__note{margin:11px 0 0;font-size:12px;line-height:1.45;color:#aaaab1;text-align:left}@media(max-width:480px){.fh-prompter-download{width:calc(100% - 24px);padding:17px}.fh-prompter-download__title{font-size:18px}.fh-prompter-download__copy{font-size:14px}}";
    (document.head || document.documentElement).appendChild(style);
  }

  function card(url) {
    if (document.getElementById("fh-prompter-download")) return;
    var root = document.querySelector(".fh-root");
    var hero = root && root.querySelector(".hero");
    if (!hero || !hero.parentNode) return;
    addStyles();
    var section = document.createElement("section");
    section.id = "fh-prompter-download";
    section.className = "fh-prompter-download";
    section.setAttribute("aria-label", "Fundhub Portal for iPhone");
    section.innerHTML =
      '<div class="fh-prompter-download__top">' +
      '<img class="fh-prompter-download__icon" src="https://fundhub.ai/apple-touch-icon.png" alt="Fundhub" width="54" height="54">' +
      '<div><p class="fh-prompter-download__eyebrow">Fundhub mobile app</p><h2 class="fh-prompter-download__title">Fundhub Portal</h2></div>' +
      '</div><p class="fh-prompter-download__copy">Keep your Fundhub file close. See where things stand and open your portal for the next step.</p>' +
      '<a class="fh-prompter-download__button" href="' + url + '" target="_blank" rel="noopener noreferrer">Get it on the App Store <span aria-hidden="true">→</span></a>' +
      '<p class="fh-prompter-download__note">Sign in with your Fundhub account. Opens the official Apple App Store listing.</p>';
    hero.parentNode.insertBefore(section, hero.nextSibling);
  }

  function run() {
    if (!window.fetch) return;
    window.fetch(CONFIG_URL, { credentials: "omit", cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (config) {
        var url = String(config && config.app_store_url || "").trim();
        if (LINK.test(url)) card(url);
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
