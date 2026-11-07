/* Business gas cards — under each business on the Accounts tab (Finance OS
 * wave 4, unit GAS). money-accounts.js mounts it in every business container.
 *
 * Paints GET /api/money/accounts's `fuel_cards` block
 * (src/finance/fuel-cards.mjs): the staff-set list of gas cards from the bank
 * book, for this business. Each card shows its own bank-book logo (never a
 * drawn mark), its own apply link, the risk line — "Miss a payment and it
 * hurts your business credit." — and either "Tracking" (with its due day) or a
 * short "Track it" form. Track it posts { action: "track_fuel_card" } through
 * the Accounts section's own form handler, which adds the card to this
 * business like any other card, so it gets the same phone alerts.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/fuel-cards-screen.test.mjs runs them in Node. Styles:
 * fuel-cards.css, every rule under .fc-block.
 */
(function (root) {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function logo(c) {
    return c.logo
      ? '<img class="fc-logo" src="' + esc(c.logo) + '" alt="' + esc(c.name) + ' logo" width="28" height="28" loading="lazy">'
      : "";
  }

  function trackForm(c, containerId) {
    var id = "fc-" + esc(containerId) + "-" + esc(c.id);
    return '<details class="fc-track"><summary>Got it? Track it</summary>' +
      '<form data-form="track_fuel_card" data-fuel="' + esc(c.id) + '" data-container="' + esc(containerId) + '">' +
      '<div class="fc-fields"><div class="fc-f"><label for="' + id + '-due">Due day</label>' +
      '<input id="' + id + '-due" name="due_day" inputmode="numeric" maxlength="2" placeholder="15" required></div>' +
      '<div class="fc-f"><label for="' + id + '-lim">Limit</label>' +
      '<input id="' + id + '-lim" name="limit" inputmode="decimal" placeholder="1,500"></div>' +
      '<div class="fc-f"><label for="' + id + '-l4">Last 4</label>' +
      '<input id="' + id + '-l4" name="last4" inputmode="numeric" maxlength="4" placeholder="1234"></div></div>' +
      '<div class="fc-form-act"><button class="fc-btn" type="submit">Track it</button>' +
      '<span class="act-msg caption" aria-live="polite"></span></div></form></details>';
  }

  function row(c, containerId) {
    var t = c.tracked;
    var state = t
      ? '<p class="fc-state"><span class="fc-pill">Tracking</span><span class="caption">' +
        esc([t.mask ? "····" + t.mask : "", t.due_day ? "Due the " + ordinal(t.due_day) : ""].filter(Boolean).join(" · ")) + '</span></p>'
      : (c.apply_url ? '<a class="fc-link" href="' + esc(c.apply_url) + '" target="_blank" rel="noopener">Apply</a>' : "") + trackForm(c, containerId);
    return '<li class="fc-row" data-fuel-card="' + esc(c.id) + '"><div class="fc-head">' + logo(c) +
      '<span class="fc-name">' + esc(c.name) + '</span></div>' +
      '<p class="fc-risk">' + esc(c.risk || "Miss a payment and it hurts your business credit.") + '</p>' + state + '</li>';
  }

  /**
   * renderForBusiness(fc, container) — fc = the read's fuel_cards; container =
   * one business container ({ id, kind }). "" when there is nothing to show.
   */
  function renderForBusiness(fc, container) {
    if (!fc || !container || container.kind !== "business") return "";
    var open = '<div class="fc-block" data-fuel-for="' + esc(container.id) + '"><h3 class="fc-title">Business gas cards</h3>';
    if (fc.ok === false) return open + '<p class="caption">We could not load gas cards right now.</p></div>';
    var rows = list(fc.by_business && fc.by_business[container.id]);
    if (!rows.length) {
      return fc.viewer === "staff" && !fc.count
        ? open + '<p class="caption">No gas cards on the bank book list yet.</p></div>'
        : "";
    }
    return open + '<ul class="fc-rows">' + rows.map(function (c) { return row(c, container.id); }).join("") + '</ul></div>';
  }

  root.FHFuelCards = { renderForBusiness: renderForBusiness, ordinal: ordinal };
})(typeof window !== "undefined" ? window : globalThis);
