/* Bank logo — one shared helper for every screen that shows a bank.
 *
 * Owner rule (Chris, 2026-11-07): every bank the product shows carries that
 * bank's own logo, and the logo comes from Plaid. The reads hand each bank a
 * `logo` field (src/banking/institution-logos.mjs): Plaid's logo as a PNG data
 * URI first, then the bank book's own file under /assets/lenders/, else null.
 *
 *   FHBankLogo.html(logo, bankName) → '<img …>' or "" (nothing for null)
 *
 * It never draws, guesses or swaps in a logo. A null, or anything that is not a
 * Plaid PNG or a bank-book file, renders nothing — the bank's name stands alone.
 * The alt text names the bank. The image is lazy and fixed-size, so a slow logo
 * never moves the text. Styles: bank-logo.css (.fh-bank-logo).
 *
 * No DOM work here, so the screen tests run it in Node.
 */
(function (root) {
  "use strict";

  var SAFE = /^(data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+\/]*={0,2}|\/assets\/lenders\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|svg|jpe?g|webp))$/i;
  var PLACEHOLDER = "/assets/lenders/placeholder.svg";
  var SANDBOX_TAIL = /\s*\(Plaid sandbox — test data\)\s*$/;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isLogo(logo) {
    return typeof logo === "string" && logo !== PLACEHOLDER && logo.indexOf("..") === -1 && SAFE.test(logo);
  }

  function altFor(name) {
    var n = String(name == null ? "" : name).replace(SANDBOX_TAIL, "").replace(/\s+/g, " ").trim();
    return n ? n + " logo" : "Bank logo";
  }

  function html(logo, name) {
    if (!isLogo(logo)) return "";
    return '<img class="fh-bank-logo" src="' + esc(logo) + '" alt="' + esc(altFor(name)) + '"' +
      ' width="28" height="28" loading="lazy" decoding="async">';
  }

  root.FHBankLogo = { html: html, isLogo: isLogo, altFor: altFor };
})(typeof window !== "undefined" ? window : globalThis);
