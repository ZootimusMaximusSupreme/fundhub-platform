/* Real approval crops for S-16. Provenance: client-wins/deck.json entries
   u-6500-discover, d-24k-navy and d-70k-loc. Each entry records the original
   Drive screenshot, the amount read from it, a verified PII-blurred crop and
   the already-published ClickFunnels proof deck. The same sanitized crop files
   are packaged under public/app/proof-wall for reliable in-deck display.
   No face, name or quote is supplied. */
(function (root) {
  "use strict";
  var doc = root.document;
  var V = root.FHDeckVisuals || (root.FHDeckVisuals = {});
  var states = {};
  var STYLE_ID = "fhv-proof-wall-style";
  var SOURCES = [
    { id: "u-6500-discover", amount: 6500, alt: "Discover card approval showing a $6,500 credit line", src: "/app/proof-wall/u-6500-discover.jpg" },
    { id: "d-24k-navy", amount: 24000, alt: "Navy Federal Credit Union Platinum Visa credit card approval showing $24,000", src: "/app/proof-wall/d-24k-navy.jpg" },
    { id: "d-70k-loc", amount: 70000, alt: "Business Revolving Line of Credit approval showing $70,000", src: "/app/proof-wall/d-70k-loc.jpg" }
  ];
  var CSS = [
    ".fhv-proof-wall{min-width:0;max-width:100%;padding:16px;background:var(--paper);border:1px solid var(--line);border-radius:var(--astra-radius,10px);box-shadow:var(--panel-shadow);font-family:var(--sans);color:var(--ink)}",
    ".fhv-proof-wall *{box-sizing:border-box;min-width:0}",
    ".fhv-proof-wall-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}",
    ".fhv-proof-wall-label,.fhv-proof-wall-tag{font-size:13px;font-weight:650;line-height:1.3;color:var(--gray)}",
    ".fhv-proof-wall-tag{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--line);border-radius:4px;background:var(--soft)}",
    ".fhv-proof-wall-tag::before{content:' ';width:6px;height:6px;border-radius:50%;background:var(--warn)}",
    ".fhv-proof-wall-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}",
    ".fhv-proof-wall .fh-card{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;padding:12px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:none}",
    ".fhv-proof-wall .fh-eyebrow{margin:0;font-size:13px;font-weight:650;color:var(--gray)}",
    ".fhv-proof-wall .fh-headline{margin:0;font-size:clamp(20px,2vw,28px);font-weight:750;line-height:1.12;letter-spacing:-.03em;color:var(--ink)}",
    ".fhv-proof-wall .fh-amount{font-variant-numeric:tabular-nums}",
    ".fhv-proof-wall .fh-shot{margin:0;min-height:0;aspect-ratio:4/3;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:#fff}",
    ".fhv-proof-wall .fh-shot img{display:block;width:100%;height:100%;object-fit:contain}",
    ".fhv-proof-wall .fh-face,.fhv-proof-wall .fh-quote,.fhv-proof-wall .fh-name,.fhv-proof-wall .fh-rule{display:none}",
    ".fhv-proof-wall .fh-mark{margin-top:auto;font-size:13px;font-weight:750;color:var(--ink)}",
    ".fhv-proof-wall-open{min-height:44px;width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:650 13px/1.3 var(--sans);cursor:pointer;text-align:left}",
    ".fhv-proof-wall-open:hover,.fhv-proof-wall-open:focus-visible{border-color:var(--ink)}",
    ".fhv-proof-wall-open:focus-visible{outline:2px solid var(--ink);outline-offset:2px}",
    ".fhv-proof-wall-basis{margin:12px 0 0;font-size:13px;line-height:1.4;color:var(--gray)}",
    ".fhv-proof-dialog{box-sizing:border-box;width:min(1080px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 24px);margin:auto;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--paper);color:var(--ink);font-family:var(--sans);box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:auto}",
    ".fhv-proof-dialog::backdrop{background:rgba(0,0,0,.7)}",
    ".fhv-proof-dialog *{box-sizing:border-box}",
    ".fhv-proof-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
    ".fhv-proof-dialog-eyebrow{margin:0 0 4px;font-size:13px;font-weight:650;color:var(--gray)}",
    ".fhv-proof-dialog-title{margin:0;font-size:clamp(24px,4vw,40px);line-height:1.1;letter-spacing:-.03em}",
    ".fhv-proof-dialog-source,.fhv-proof-dialog-basis,.fhv-proof-dialog-hint{margin:10px 0;font-size:14px;line-height:1.4;color:var(--gray)}",
    ".fhv-proof-dialog-close,.fhv-proof-dialog-fit{min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:650 14px/1.2 var(--sans);cursor:pointer}",
    ".fhv-proof-dialog-close:focus-visible,.fhv-proof-dialog-fit:focus-visible{outline:2px solid var(--ink);outline-offset:2px}",
    ".fhv-proof-dialog-shot{max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fff}",
    ".fhv-proof-dialog-shot img{display:block;width:max(100%,900px);max-width:none;height:auto}",
    ".fhv-proof-dialog-shot.is-fit img{width:100%}",
    ".fhv-proof-dialog-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}",
    ".fhv-proof-dialog-hint{margin:0}",
    "@media(max-width:680px){.fhv-proof-dialog{padding:12px}.fhv-proof-dialog-head{align-items:start}.fhv-proof-dialog-close{max-width:110px}.fhv-proof-dialog-hint{max-width:230px}}",
    "@media(max-width:680px){.fhv-proof-wall-grid{grid-template-columns:1fr}.fhv-proof-wall .fh-card{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.fhv-proof-wall .fh-eyebrow,.fhv-proof-wall .fh-headline,.fhv-proof-wall .fh-mark,.fhv-proof-wall-open{grid-column:1}.fhv-proof-wall .fh-shot{grid-column:2;grid-row:1/5}.fhv-proof-wall .fh-headline{font-size:20px}}"
  ].join("\n");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function money(n) { return "$" + n.toLocaleString("en-US"); }
  function ensureStyle() {
    if (!doc || !doc.head || !doc.createElement) return;
    if (doc.getElementById && doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    doc.head.appendChild(el);
  }
  // Another client's approval is not a prediction from this client's estimate.
  function ordered() { return SOURCES.slice(); }
  function card(source, i) {
    var amount = money(source.amount);
    return '<article class="fh-card fhv-proof-wall-card" data-layout="win" data-photo="off" data-name="off" data-amount="on" data-proof-id="' + source.id + '">' +
      '<p class="fh-eyebrow">Client approval</p>' +
      '<figure class="fh-face"><img data-slot="face" alt=""></figure>' +
      '<h3 class="fh-headline">Approved for <span class="fh-amount" data-slot="dollar-amount">' + amount + '</span></h3>' +
      '<figure class="fh-shot"><img data-slot="approval-screenshot" src="' + esc(source.src) + '" alt="' + esc(source.alt) + '" width="1200" height="900" loading="lazy" decoding="async"></figure>' +
      '<blockquote class="fh-quote"><p data-slot="quote"></p></blockquote>' +
      '<div class="fh-rule" aria-hidden="true"></div>' +
      '<span class="fh-name" data-slot="name"></span>' +
      '<span class="fh-mark" role="img" aria-label="Fundhub">fundhub.</span>' +
      '<button type="button" class="fhv-proof-wall-open fh-astra-action" data-fhv-proof-act="show:' + i + '" aria-haspopup="dialog">Show this approval</button></article>';
  }
  function render(st) {
    var cards = ordered(st.ctx);
    return '<div class="fhv-proof-wall fh-astra-workspace" data-fhv="proof-wall" data-client="' + esc(st.id) + '">' +
      '<div class="fhv-proof-wall-intro"><span class="fhv-proof-wall-label">Real client approvals</span>' +
      (st.ctx.sample ? '<span class="fhv-proof-wall-tag">Sample file</span>' : '') + '</div>' +
      '<div class="fhv-proof-wall-grid">' + cards.map(card).join('') + '</div>' +
      '<p class="fhv-proof-wall-basis">Their results came from their files. Each lender decides your application.</p></div>';
  }
  function openApproval(source, trigger) {
    if (!doc || !doc.body || !doc.createElement) return;
    var old = doc.getElementById && doc.getElementById("fhv-proof-dialog");
    if (old && typeof old.close === "function") old.close();
    var modal = doc.createElement("dialog");
    modal.id = "fhv-proof-dialog";
    modal.className = "fhv-proof-dialog";
    modal.setAttribute("aria-label", "Approval evidence from another Fundhub client");
    modal.innerHTML = '<div class="fhv-proof-dialog-head"><div><p class="fhv-proof-dialog-eyebrow">Real approval · other client</p>' +
      '<h2 class="fhv-proof-dialog-title">Approved for ' + money(source.amount) + '</h2></div>' +
      '<button type="button" class="fhv-proof-dialog-close" data-fhv-proof-close>Close and return</button></div>' +
      '<p class="fhv-proof-dialog-source">Source: ' + esc(source.alt) + '</p>' +
      '<div class="fhv-proof-dialog-actions"><button type="button" class="fhv-proof-dialog-fit" data-fhv-proof-fit aria-pressed="false">Fit full image</button>' +
      '<p class="fhv-proof-dialog-hint">Zoomed for reading · scroll or swipe the image to read it.</p></div>' +
      '<div class="fhv-proof-dialog-shot"><img src="' + esc(source.src) + '" alt="' + esc(source.alt) + '" width="1200" height="900"></div>' +
      '<p class="fhv-proof-dialog-basis">Their results came from their files. Each lender decides your application.</p>';
    modal.addEventListener("click", function (e) {
      var close = e.target && e.target.closest && e.target.closest("[data-fhv-proof-close]");
      var fit = e.target && e.target.closest && e.target.closest("[data-fhv-proof-fit]");
      if (close || e.target === modal) { modal.close(); return; }
      if (!fit) return;
      var shot = modal.querySelector(".fhv-proof-dialog-shot");
      var fitted = shot.classList.toggle("is-fit");
      fit.setAttribute("aria-pressed", String(fitted));
      fit.textContent = fitted ? "Show readable size" : "Fit full image";
    });
    modal.addEventListener("close", function () {
      modal.remove();
      if (trigger && typeof trigger.focus === "function" && trigger.isConnected !== false) trigger.focus();
    });
    doc.body.appendChild(modal);
    modal.showModal();
  }
  function onTap(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-fhv-proof-act]');
    if (!btn) return;
    var host = btn.closest && btn.closest('[data-fhv="proof-wall"]');
    if (!host) return;
    var id = host.getAttribute("data-client");
    var st = states[id];
    if (!st) return;
    var match = /^show:([0-2])$/.exec(btn.getAttribute("data-fhv-proof-act") || "");
    if (!match) return;
    openApproval(SOURCES[Number(match[1])], btn);
    if (e.preventDefault) e.preventDefault();
  }
  var listening = false;
  V.proofWall = function (ctx) {
    try {
      ensureStyle();
      if (!listening && doc && doc.addEventListener) { doc.addEventListener("click", onTap); listening = true; }
      var id = String(ctx && ctx.clientId != null ? ctx.clientId : "_");
      var st = states[id] || (states[id] = { id: id, ctx: null });
      st.ctx = ctx && typeof ctx === "object" ? ctx : {};
      return render(st);
    } catch (e) {
      return '<div class="fhv-proof-wall fh-astra-state" data-fhv="proof-wall"><p>Client approvals are unavailable right now.</p></div>';
    }
  };
  V._proofWall = { sources: SOURCES, ordered: ordered, states: states };
})(typeof window !== "undefined" ? window : globalThis);
