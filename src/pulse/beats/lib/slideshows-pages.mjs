// The hourly beat keeps this list literal so it can run inside the isolated read box.
// Its test compares the list with the deployed page registry.
export const SLIDESHOW_PAGES = Object.freeze([
  "slideshows/after-you-say-yes.html",
  "slideshows/apply-yourself.html",
  "slideshows/bank-said-no.html",
  "slideshows/blueprint-12-months.html",
  "slideshows/blueprint-in-action.html",
  "slideshows/blueprint-value.html",
  "slideshows/business-one-two.html",
  "slideshows/card-paydown.html",
  "slideshows/cost-of-waiting.html",
  "slideshows/credit-optimization.html",
  "slideshows/credit-partner.html",
  "slideshows/funding-sequence.html",
  "slideshows/money-on-the-table.html",
  "slideshows/pre-underwriting.html",
  "slideshows/soft-pull.html",
  "slideshows/the-call.html",
  "slideshows/the-maximum.html",
  "slideshows/the-money-talk.html",
  "slideshows/thirteen-points.html",
  "slideshows/tried-before.html",
  "slideshows/who-we-are.html",
  "slideshows/your-data-is-safe.html"
]);

export function hasDeckStart(body) {
  const text = String(body || "");
  return /<title>Fundhub\b/.test(text) && /<main\s+class="ss"\s+data-deck=/.test(text) && /<section\s+class="slide\b/.test(text);
}
