/* Fundhub slideshow engine. One slide at a time, with Back and Next at the
   thumb, swipe, and the arrow keys. A link ending in #s3 opens slide 3. It
   reads and sends nothing: no network, no storage, no tracking. Without
   script, every slide stays readable as one long page. */
(function () {
  "use strict";
  var deck = document.querySelector(".ss");
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  if (!slides.length) return;
  var root = document.documentElement;
  var last = slides.length - 1;
  var index = 0;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  var backdrop = el("div", "ss-backdrop gridbg");
  backdrop.setAttribute("aria-hidden", "true");
  document.body.insertBefore(backdrop, document.body.firstChild);

  var top = el("header", "ss-top");
  var logo = el("span", "logo");
  logo.setAttribute("role", "img");
  logo.setAttribute("aria-label", "Fundhub");
  var progress = el("div", "ss-progress");
  progress.setAttribute("aria-hidden", "true");
  var segments = slides.map(function (_, k) {
    var seg = el("i");
    seg.style.setProperty("--k", String(k));
    seg.style.setProperty("--n", String(slides.length));
    progress.appendChild(seg);
    return seg;
  });
  top.appendChild(logo);
  top.appendChild(progress);

  var stage = el("div", "ss-stage");
  slides.forEach(function (slide, k) {
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", (k + 1) + " of " + slides.length);
    stage.appendChild(slide);
  });

  var nav = el("nav", "ss-nav");
  nav.setAttribute("aria-label", "Slides");
  var back = el("button", "ss-btn back", "Back");
  var next = el("button", "ss-btn primary", "Next");
  back.type = "button";
  next.type = "button";
  nav.appendChild(back);
  nav.appendChild(next);

  var live = el("p", "ss-live");
  live.setAttribute("aria-live", "polite");

  var title = deck.querySelector(".ss-title");
  deck.insertBefore(top, title ? title.nextSibling : deck.firstChild);
  deck.appendChild(stage);
  deck.appendChild(nav);
  deck.appendChild(live);
  root.classList.add("ss-js");

  function go(n) {
    index = Math.max(0, Math.min(last, n));
    slides.forEach(function (slide, k) {
      var on = k === index;
      slide.classList.toggle("is-on", on);
      slide.setAttribute("aria-hidden", on ? "false" : "true");
      if (on) slide.removeAttribute("inert");
      else slide.setAttribute("inert", "");
    });
    segments.forEach(function (seg, k) { seg.classList.toggle("on", k <= index); });
    root.setAttribute("data-tone", slides[index].classList.contains("dark") ? "dark" : "light");
    back.hidden = index === 0;
    next.textContent = index === last ? "Start over" : "Next";
    slides[index].scrollTop = 0;
    var heading = slides[index].querySelector("h2");
    live.textContent = (index + 1) + " of " + slides.length + (heading ? ". " + heading.textContent : "");
    try { history.replaceState(null, "", "#s" + (index + 1)); } catch (e) { /* a sandboxed frame may refuse */ }
  }

  back.addEventListener("click", function () { go(index - 1); });
  next.addEventListener("click", function () { go(index === last ? 0 : index + 1); });

  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(last); }
  });

  var x0 = null;
  var y0 = null;
  stage.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse") return;
    x0 = e.clientX;
    y0 = e.clientY;
  });
  stage.addEventListener("pointercancel", function () { x0 = null; });
  stage.addEventListener("pointerup", function (e) {
    if (x0 === null) return;
    var dx = e.clientX - x0;
    var dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  });

  function fromHash() {
    var match = /^#s(\d+)$/.exec(location.hash || "");
    return match ? Number(match[1]) - 1 : null;
  }
  window.addEventListener("hashchange", function () {
    var n = fromHash();
    if (n !== null && n !== index) go(n);
  });
  go(fromHash() || 0);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.add("ss-anim"); });
  });
})();
