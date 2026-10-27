/* Fundhub Portal download card for the apply.fundhub.ai /thank-you builder page.
 * The card only renders after the live App Store URL is placed in the
 * adjacent JSON file. That keeps the live funnel free of dead download links. */
(function () {
  var CONFIG_URL = "https://fundhub.ai/funnel/fundhub-prompter-download.json";
  var LINK = /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[^?#/]+\/)?id[0-9]+\/?$/;

  function addStyles() {
    if (document.getElementById("fh-prompter-download-css")) return;
    var style = document.createElement("style");
    style.id = "fh-prompter-download-css";
    /* .fh-root rules on the page (margin/padding 0, links inherit color) load after this; the .fh-root prefix outranks them. */
    style.textContent = ".fh-root .fh-prompter-download{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;width:100%;max-width:660px;margin:30px auto 0;padding:20px 22px;border:1px solid #E4E4E7;border-radius:12px;background:#FFFFFF;color:#0A0A0A;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left;box-shadow:0 1px 3px rgba(10,10,10,.05)}.fh-root .fh-prompter-download *{box-sizing:border-box}.fh-root .fh-prompter-download__top{display:flex;align-items:flex-start;gap:14px;min-width:0}.fh-root .fh-prompter-download__icon{display:block;width:52px;height:52px;flex:0 0 52px;border-radius:12px;background:#0A0A0A}.fh-root .fh-prompter-download__eyebrow{margin:0 0 4px;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;font-size:10.5px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#8A8A93}.fh-root .fh-prompter-download__title{margin:0;font-size:19px;font-weight:700;line-height:1.2;letter-spacing:-.02em;color:#0A0A0A}.fh-root .fh-prompter-download__copy{margin:6px 0 0;font-size:15px;line-height:1.6;color:#52525B}.fh-root .fh-prompter-download__button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;padding:0 20px;border:1px solid #0A0A0A;border-radius:9px;background:#FFFFFF;color:#0A0A0A;font-size:15px;font-weight:600;line-height:1;text-decoration:none;white-space:nowrap;transition:background .15s}.fh-root .fh-prompter-download__button:hover{background:#F4F4F5}.fh-root .fh-prompter-download__button:focus-visible{outline:2px solid #0A0A0A;outline-offset:3px}.fh-root .fh-prompter-download__note{margin:0;padding-top:14px;border-top:1px solid #E4E4E7;font-size:13px;line-height:1.5;color:#71717A}@media(min-width:640px){.fh-root .fh-prompter-download{grid-template-columns:minmax(0,1fr) auto;column-gap:24px;align-items:center}.fh-root .fh-prompter-download__note{grid-column:1 / -1}}@media(max-width:639.98px){.fh-root .fh-prompter-download{padding:20px 18px}.fh-root .fh-prompter-download__button{width:100%}}";
    style.textContent += ".fh-root .fh-prompter-download__button{background:#0A0A0A;color:#fff}.fh-root .fh-prompter-download__button:hover{background:#27272A}.fh-root .fh-prompter-download__note a{color:#0A0A0A;text-decoration:underline;text-underline-offset:2px}";
    (document.head || document.documentElement).appendChild(style);
  }

  function card(url) {
    if (document.getElementById("fh-prompter-download")) return;
    var root = document.querySelector(".fh-root");
    if (!root) return;
    /* The app is the first action after booking. Older bodies without a hero
       can still place the card in their existing slot. */
    var slot = document.getElementById("fh-ty-app-slot");
    var hero = root.querySelector(".hero");
    if (!slot && (!hero || !hero.parentNode)) return;
    addStyles();
    var section = document.createElement("section");
    section.id = "fh-prompter-download";
    section.className = "fh-prompter-download";
    section.setAttribute("aria-label", "Fundhub Portal for iPhone");
    section.innerHTML =
      '<div class="fh-prompter-download__top">' +
      '<img class="fh-prompter-download__icon" src="https://fundhub.ai/apple-touch-icon.png" alt="Fundhub" width="52" height="52">' +
      '<div><p class="fh-prompter-download__eyebrow">Next step</p><h2 class="fh-prompter-download__title">Get Fundhub Portal</h2>' +
      '<p class="fh-prompter-download__copy">Download the iPhone app and confirm your call there.</p></div>' +
      '</div>' +
      '<a class="fh-prompter-download__button" href="' + url + '" target="_blank" rel="noopener noreferrer">Download for iPhone <span aria-hidden="true">→</span></a>' +
      '<p class="fh-prompter-download__note">On Android or a computer? <a href="https://fundhub.ai/portal-login.html">Use the web portal</a> to confirm your call.</p>';
    if (hero && hero.parentNode) hero.parentNode.insertBefore(section, hero.nextSibling);
    else slot.appendChild(section);
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
