/* pw-toggle.js — a Show / Hide button on every password box (owner ask 2026-10-06).
   Anyone typing a password (sign in, set a new password from an invite or a
   reset) can tap Show to check what they typed, and Hide to cover it again.

   One shared file, loaded by every page with a password box. The box stays a
   real password input (only its type flips), so autofill and password managers
   keep working. It flips back to hidden when the form is sent, so the browser
   never offers to save a box that was left showing as plain text.

   src/http/pw-toggle.test.mjs fails if a page gains a password box without
   loading this file. */
(function () {
  if (window.__fhPwToggle) return;
  window.__fhPwToggle = true;

  var css =
    ".fh-pw{position:relative;display:block}" +
    ".fh-pw>input{width:100%;box-sizing:border-box;padding-right:64px}" +
    ".fh-pw-btn{position:absolute;top:50%;right:6px;transform:translateY(-50%);" +
    "border:0;background:none;padding:6px 8px;min-height:32px;cursor:pointer;" +
    "font:600 12px/1 Inter,system-ui,sans-serif;color:#52525B;border-radius:6px}" +
    ".fh-pw-btn:hover{color:#18181B}" +
    ".fh-pw-btn:focus-visible{outline:2px solid #2563EB;outline-offset:1px}";

  function addStyle() {
    var s = document.createElement("style");
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function wire(input) {
    if (input.getAttribute("data-fh-pw")) return;
    input.setAttribute("data-fh-pw", "1");

    var wrap = document.createElement("span");
    wrap.className = "fh-pw";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fh-pw-btn";
    wrap.appendChild(btn);

    function paint(showing) {
      input.type = showing ? "text" : "password";
      btn.textContent = showing ? "Hide" : "Show";
      btn.setAttribute("aria-label", showing ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", showing ? "true" : "false");
    }
    paint(false);

    btn.addEventListener("click", function () {
      paint(input.type === "password");
      input.focus();
    });

    if (input.form) {
      input.form.addEventListener("submit", function () { paint(false); }, true);
    }
  }

  function run() {
    addStyle();
    var boxes = document.querySelectorAll('input[type="password"]');
    for (var i = 0; i < boxes.length; i++) wire(boxes[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
