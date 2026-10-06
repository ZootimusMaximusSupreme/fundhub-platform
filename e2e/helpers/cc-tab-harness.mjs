// A tiny stand-in for the Command Center frame (plan unit U34), so a tab's
// browser test can run before the frame lands. docs/specs/command-center-tabs.md
// says: "Until the frame lands, a tab's e2e may load the page with a tiny local
// stub registry that renders the queued tab (keep it in e2e/helpers/)."
//
// What it gives the tab is exactly the contract's ctx and nothing more:
//   ctx.api(method, path, body?, {version, requestId}) -> {ok, status, data, error, conflict, current}
//   ctx.costSheet({kind, title, onConfirm})   a sheet that prints "Cost: unknown, not measured yet"
//   ctx.confirm({title, consequence, button}) a promise of true / false
//   ctx.toast(text), ctx.go(tabId, param?), ctx.param, ctx.fmt, ctx.user
//
// The page is served at a made-up address (/app/__cc-tab-harness.html) with
// page.route, so nothing is added to public/. The tab's script tag comes
// BEFORE the stub frame on purpose: the tab queues itself on
// window.FundhubCC._q, and the stub drains the queue, the same path the real
// frame takes when it loads second.
//
// The root sits inside .app > .main, so the brand file's type snap
// (UI-STANDARDS §12.7: every px font size inside a shell is thrown away) applies
// here exactly as it will on the real page.

export const HARNESS_PATH = "/app/__cc-tab-harness.html";

/**
 * @param {{tab?: string, scripts?: string[], param?: string}} [opts]
 */
export function harnessHtml({ tab = "scripts", scripts = ["/app/cc-tab-scripts.js"], param = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fundhub — Command Center tab harness</title>
<link rel="stylesheet" href="/app/fundhub-brand.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%}
body{background:var(--field,#F4F4F5);color:var(--ink);font-family:var(--sans);line-height:1.5}
.app{display:flex;min-height:100vh}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.content{padding:16px;display:flex;flex-direction:column;gap:16px}
.stub-sheet{position:fixed;inset:auto 0 0 0;background:#fff;border-top:1px solid var(--line);padding:16px;display:flex;flex-direction:column;gap:16px;z-index:50}
.stub-sheet[hidden]{display:none}
.stub-sheet .btn{min-height:44px;border:1px solid var(--ink2);border-radius:8px;padding:8px 16px;background:#fff;font-weight:600}
.stub-sheet .btn.primary{background:var(--ink2);color:var(--paper)}
</style>
</head><body>
<div class="app"><main class="main"><div class="content"><div id="tab-root"></div></div></main></div>
<div class="shell"><div id="stub-sheet" class="stub-sheet" role="dialog" aria-modal="true" aria-labelledby="stub-sheet-title" hidden>
  <p id="stub-sheet-title"><b></b></p><p class="caption" id="stub-sheet-line"></p>
  <div><button type="button" class="btn primary" id="stub-sheet-yes">Yes, go ahead</button> <button type="button" class="btn" id="stub-sheet-no">Cancel</button></div>
</div>
<p id="stub-toast" role="status" aria-live="polite"></p></div>
${scripts.map((s) => `<script src="${s}"></script>`).join("\n")}
<script>
(function () {
  var Q = (window.FundhubCC && window.FundhubCC._q) || [];
  var tabs = {};
  window.FundhubCC = { registerTab: function (t) { tabs[t.id] = t; } };
  Q.forEach(function (t) { tabs[t.id] = t; });

  var stub = window.__stub = { sheets: [], confirms: [], toasts: [], went: [], calls: [] };
  var sheet = document.getElementById("stub-sheet");
  var pending = null;
  function openSheet(title, line, done) {
    sheet.querySelector("#stub-sheet-title b").textContent = title;
    document.getElementById("stub-sheet-line").textContent = line;
    sheet.hidden = false;
    pending = done;
  }
  document.getElementById("stub-sheet-yes").addEventListener("click", function () { sheet.hidden = true; var d = pending; pending = null; if (d) d(true); });
  document.getElementById("stub-sheet-no").addEventListener("click", function () { sheet.hidden = true; var d = pending; pending = null; if (d) d(false); });

  var ctx = {
    param: ${JSON.stringify(param)},
    user: { role: "owner" },
    api: async function (method, path, body, opts) {
      stub.calls.push({ method: method, path: path, body: body || null, opts: opts || null });
      var res;
      try {
        res = await fetch("/api/" + path, {
          method: method,
          headers: body ? { "content-type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
          credentials: "same-origin"
        });
      } catch (e) {
        return { ok: false, status: 0, data: null, error: "network", conflict: false, current: null };
      }
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      return {
        ok: res.ok, status: res.status, data: data,
        error: res.ok ? null : ((data && (data.message || data.error)) || "error"),
        conflict: res.status === 409,
        current: res.status === 409 && data ? data.current || null : null
      };
    },
    costSheet: function (o) {
      stub.sheets.push({ kind: o.kind, title: o.title });
      openSheet(o.title, "Cost: unknown, not measured yet.", function (yes) { if (yes && o.onConfirm) o.onConfirm(); });
    },
    confirm: function (o) {
      stub.confirms.push(o);
      return new Promise(function (resolve) { openSheet(o.title, o.consequence || "", resolve); });
    },
    toast: function (t) { stub.toasts.push(t); document.getElementById("stub-toast").textContent = t; },
    go: function (id, p) { stub.went.push([id, p == null ? null : p]); },
    fmt: {
      money: function (c) { return c == null ? "unknown" : "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      az: function (ts) { return new Date(ts).toLocaleString("en-US", { timeZone: "America/Phoenix" }); },
      ago: function (ts) { return String(ts); }
    }
  };
  stub.ctx = ctx;
  var tab = tabs[${JSON.stringify(tab)}];
  stub.tab = tab || null;
  stub.hide = function () { if (tab && tab.hide) tab.hide(); };
  stub.refresh = function () { if (tab && tab.refresh) return tab.refresh(ctx); };
  if (tab) stub.rendered = Promise.resolve(tab.render(document.getElementById("tab-root"), ctx));
  else document.getElementById("tab-root").textContent = "No tab registered with id ${tab}.";
})();
</script>
</body></html>`;
}

/**
 * Serve the harness at HARNESS_PATH and open it.
 * @param {import('@playwright/test').Page} page
 * @param {{tab?: string, scripts?: string[], param?: string}} [opts]
 */
export async function openTabHarness(page, opts = {}) {
  await page.route(`**${HARNESS_PATH}*`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: harnessHtml(opts) }));
  await page.goto(HARNESS_PATH);
}
