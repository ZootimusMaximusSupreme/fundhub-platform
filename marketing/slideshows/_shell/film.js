/* Fundhub film board engine. One slide at a time on a 1080 x 960 board, no
   buttons: the right arrow, the space bar or a click moves forward, the left
   arrow moves back, a link ending in #s3 opens slide 3. Chris screen-records
   the board while he reads the talking points, one slide per clip. */
(function () {
  "use strict";
  var deck = document.querySelector(".ss");
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  if (!slides.length) return;
  var root = document.documentElement;
  var last = slides.length - 1;
  var index = 0;

  var board = document.createElement("div");
  board.className = "film-board";
  var stage = document.createElement("div");
  stage.className = "ss-stage";
  slides.forEach(function (slide, k) {
    var n = document.createElement("span");
    n.className = "film-n";
    n.textContent = (k + 1) + " / " + slides.length;
    slide.appendChild(n);
    stage.appendChild(slide);
  });
  board.appendChild(stage);
  deck.appendChild(board);
  root.classList.add("ss-js");

  function go(n) {
    index = Math.max(0, Math.min(last, n));
    slides.forEach(function (slide, k) {
      var on = k === index;
      slide.classList.toggle("is-on", on);
      slide.setAttribute("aria-hidden", on ? "false" : "true");
    });
    root.setAttribute("data-tone", slides[index].classList.contains("dark") ? "dark" : "light");
    try { history.replaceState(null, "", "#s" + (index + 1)); } catch (e) { /* a sandboxed frame may refuse */ }
  }

  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(last); }
  });
  stage.addEventListener("click", function (e) {
    go(index + (e.clientX < window.innerWidth / 4 ? -1 : 1));
  });

  var match = /^#s(\d+)$/.exec(location.hash || "");
  go(match ? Number(match[1]) - 1 : 0);
})();
