// A tiny stand-in for the Command Center frame, so the Numbers tab can be
// proven in a real browser before the frame (U34's cc-frame.js) lands.
// docs/specs/command-center-tabs.md says a tab's e2e may do exactly this, with
// the stub kept in e2e/helpers/.
//
// The stub page is answered by page.route(), so nothing is added to public/.
// It loads the real brand stylesheet and the real tab script from the static
// server, wraps the tab in .app > .main the way the frame does (so the brand
// file's type rules apply), drains window.FundhubCC._q the way the contract
// says the frame does, and hands the tab a ctx with the contract's api, go,
// toast, fmt and param. Every go() and toast() is recorded on window for the
// spec to read.

export const STUB_PATH = "/app/__cc-numbers-stub.html";

export const STUB_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fundhub — Numbers tab (test stub)</title>
<link rel="stylesheet" href="/app/fundhub-brand.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--field,#F4F4F5);color:var(--ink);font-family:var(--sans);line-height:1.5}
button,input,select,textarea{font:inherit;color:inherit}
.app{display:flex;min-height:100vh}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.content{padding:24px;display:flex;flex-direction:column;gap:24px}
@media (max-width:720px){.content{padding:16px}}
</style>
<script>
window.__ccGo = [];
window.__ccToasts = [];
window.FundhubCC = window.FundhubCC || { _q: [], registerTab(t) { this._q.push(t); } };
function stubCtx() {
  const fmtAz = (ts) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(new Date(ts));
  const hash = String(location.hash || "");
  return {
    param: hash.indexOf("#numbers/") === 0 ? hash.slice(9) : "",
    user: { role: "owner" },
    async api(method, path, body, opts) {
      try {
        const r = await fetch("/api/" + path, {
          method,
          headers: { "content-type": "application/json", authorization: "Bearer e2e-token" },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = null;
        try { data = await r.json(); } catch (e) { data = null; }
        return { ok: r.ok, status: r.status, data, error: data && data.error, conflict: r.status === 409,
                 current: data && data.current };
      } catch (e) {
        return { ok: false, status: 0, data: null, error: "network" };
      }
    },
    go(tab, param) { window.__ccGo.push([tab, param === undefined ? null : param]); },
    toast(text) { window.__ccToasts.push(text); },
    fmt: {
      az: fmtAz,
      money: (c) => c == null ? "unknown" : "$" + (c / 100).toFixed(2),
      ago: (ts) => fmtAz(ts)
    },
    costSheet() {},
    confirm() {}
  };
}
document.addEventListener("DOMContentLoaded", () => {
  const tab = (window.FundhubCC._q || []).find((t) => t.id === "numbers");
  const root = document.getElementById("tab-root");
  if (!tab) { root.textContent = "The numbers tab did not register."; return; }
  window.__ccTab = tab;
  tab.render(root, stubCtx());
});
</script>
<script defer src="/app/cc-tab-numbers.js"></script>
</head>
<body>
<div class="app"><div class="main"><div class="content" id="tab-root"></div></div></div>
</body>
</html>`;

/**
 * Serve the stub page through page.route() (call before page.goto).
 * @param {import('@playwright/test').Page} page
 */
export async function routeStub(page) {
  await page.route(`**${STUB_PATH}*`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: STUB_HTML }));
}
