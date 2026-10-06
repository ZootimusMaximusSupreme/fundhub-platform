// A tiny stand-in for the Command Center frame (U34), so the Launch tab can be
// tested in a real browser before the frame lands. docs/specs/command-center-tabs.md
// says a tab's e2e may do this until then, and keeps the stub in e2e/helpers/.
//
// It loads the tab's own file the way the real page will (a plain <script>),
// then drains window.FundhubCC._q exactly as the frame does, and hands the tab
// a ctx with the contract's shape: api, confirm (the two-tap sheet), toast, go,
// fmt and user. The page itself is served by page.route() at STUB_PATH on the
// static server's origin, so /app/* loads from public/ and /api/** is mocked.
//
// Nothing here is shipped: it lives under e2e/ and is never served by Netlify.

export const STUB_PATH = "/__stub/cc-launch.html";

export function stubHtml(tabId = "launch") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fundhub — Command Center tab stub</title>
<link rel="stylesheet" href="/app/fundhub-brand.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--field,#F4F4F5);color:var(--ink);font-family:var(--sans);line-height:1.5}
.app{display:flex;min-height:100vh}
.main{flex:1;min-width:0}
.content{padding:24px}
@media (max-width:720px){.content{padding:16px}}
.stub-sheet{position:fixed;left:0;right:0;bottom:calc(var(--fh-statusbar) + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--line);padding:16px;display:flex;flex-direction:column;gap:8px;z-index:50}
.stub-sheet .row{display:flex;gap:16px;flex-wrap:wrap}
.stub-sheet button{min-height:44px;padding:8px 16px;border:1px solid var(--ink2);border-radius:8px;background:#fff;font-weight:600}
.stub-toast{position:fixed;top:8px;right:8px;background:var(--ink);color:var(--paper);padding:8px 16px;border-radius:8px;z-index:60}
</style>
<script src="/app/cc-tab-${tabId}.js"></script>
</head>
<body>
<div class="app"><div class="main"><div class="content" id="tab-root"></div></div></div>
<script>
(function () {
  var tabs = [];
  var q = (window.FundhubCC && window.FundhubCC._q) || [];
  window.FundhubCC = { registerTab: function (t) { tabs.push(t); } };
  q.forEach(function (t) { window.FundhubCC.registerTab(t); });
  window.__stub = { toasts: [], gone: [], confirms: [] };

  async function api(method, path, body, opts) {
    var init = { method: method, headers: {} };
    if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    try {
      var r = await fetch("/api/" + path, init);
      var data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      return { ok: r.ok, status: r.status, data: data, error: data && data.error, conflict: r.status === 409, current: data && data.current };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: "network" };
    }
  }

  function confirmSheet(o) {
    window.__stub.confirms.push({ title: o.title, consequence: o.consequence, button: o.button });
    return new Promise(function (resolve) {
      var el = document.createElement("div");
      el.className = "stub-sheet";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", o.title);
      el.innerHTML = '<b class="t"></b><p class="c"></p><div class="row"><button type="button" data-x="no">Cancel</button><button type="button" data-x="yes"></button></div>';
      el.querySelector(".t").textContent = o.title;
      el.querySelector(".c").textContent = o.consequence;
      el.querySelector('[data-x="yes"]').textContent = o.button;
      el.addEventListener("click", function (ev) {
        var x = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-x");
        if (!x) return;
        el.remove();
        if (x === "yes") { if (o.onConfirm) o.onConfirm(); resolve(true); }
        else { if (o.onCancel) o.onCancel(); resolve(false); }
      });
      document.body.appendChild(el);
    });
  }

  var ctx = {
    api: api,
    confirm: confirmSheet,
    costSheet: function (o) { return confirmSheet({ title: o.title, consequence: "Cost: unknown, not measured yet", button: "Go", onConfirm: o.onConfirm }); },
    toast: function (t) {
      window.__stub.toasts.push(t);
      var el = document.createElement("div"); el.className = "stub-toast"; el.textContent = t;
      document.body.appendChild(el); setTimeout(function () { el.remove(); }, 1500);
    },
    go: function (id, param) { window.__stub.gone.push(param ? id + "/" + param : id); },
    param: null,
    fmt: {
      money: function (c) { return c == null ? "unknown" : "$" + (c / 100).toFixed(2); },
      az: function (ts) {
        if (!ts) return null;
        return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ts)) + " Arizona time";
      },
      ago: function () { return "just now"; }
    },
    user: { role: "owner" }
  };

  var tab = tabs.filter(function (t) { return t.id === ${JSON.stringify(tabId)}; })[0];
  window.__stub.registered = tabs.map(function (t) { return t.id; });
  if (tab) tab.render(document.getElementById("tab-root"), ctx);
})();
</script>
</body>
</html>`;
}
