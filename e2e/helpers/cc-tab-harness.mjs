// A tiny stand-in for the Command Center frame, so a tab's browser test can run
// before the frame (plan unit U34) is on main. docs/specs/command-center-tabs.md
// on main says: "Until the frame lands, a tab's e2e may load the page with a
// tiny local stub registry that renders the queued tab (keep it in e2e/helpers/)."
//
// Two frames exist tonight, so the stub speaks either one:
//
//   flavor "u34" (default) — U34's frame (branch mm-u34-frame,
//     public/app/marketing-command-center.js there):
//       window.FHMarketingCCTabs.register(tab) / FHMarketingCCTabsQueue,
//       render(panel, ctx), show(panel, ctx), hide(panel, ctx);
//       ctx.api(path, {method, body}) and ctx.post(path, body, requestId) answer
//       {status, body} (path is "/api/..."); ctx.requestId, ctx.costs,
//       ctx.costLine, ctx.monthLine, ctx.style, ctx.toast, ctx.sub, ctx.go.
//   flavor "fundhubcc" — main's contract: window.FundhubCC.registerTab(tab),
//       ctx.api(method, path, body, opts) -> {ok, status, data, error, conflict, current},
//       ctx.costSheet({kind, title, onConfirm}), ctx.confirm, ctx.toast, ctx.go, ctx.param.
//
// Neither stub knows any tab's words. Cost words are the frames' own: U34's
// costLine reads GET marketing/costs and says "Cost: unknown, not measured yet."
// until that route answers; main's sheet prints the same words.
//
// The page is served at a made-up address (HARNESS_PATH) with page.route, so
// nothing is added to public/. The tab's script tag comes BEFORE the stub on
// purpose: the tab queues itself and the stub drains the queue, the same path
// a real frame takes when it loads second. The panel sits inside .app > .main,
// so the brand file's type snap (UI-STANDARDS §12.7: every px font size inside a
// shell is thrown away) applies here exactly as on the real page.

export const HARNESS_PATH = "/app/__cc-tab-harness.html";

const STUB_U34 = `
(function () {
  var Q = window.FHMarketingCCTabsQueue || [];
  var tabs = {};
  window.FHMarketingCCTabs = { register: function (t) { tabs[t.key || t.id] = t; return true; } };
  window.FHMarketingCCTabsQueue = [];
  Q.forEach(function (t) { tabs[t.key || t.id] = t; });
  var stub = window.__stub = { flavor: "u34", sheets: [], confirms: [], toasts: [], went: [], calls: [] };
  function api(path, init) {
    init = init || {};
    stub.calls.push({ path: path, method: init.method || "GET", body: init.body === undefined ? null : init.body });
    var opts = { method: init.method || "GET", headers: { accept: "application/json" }, credentials: "same-origin" };
    if (init.body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(init.body); }
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; }, function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null, transport: "network error" }; });
  }
  function requestId() { return crypto.randomUUID(); }
  var ctx = {
    key: "%TAB%",
    api: api,
    post: function (path, body, rid) {
      var out = Object.assign({}, body || {});
      if (!out.request_id) out.request_id = rid || requestId();
      return api(path, { method: "POST", body: out });
    },
    requestId: requestId,
    costs: function () {
      return api("/api/marketing/costs").then(function (r) {
        return r.status === 200 && r.body && r.body.kinds ? { state: "ok", kinds: r.body.kinds, month: null } : { state: "missing", kinds: {}, month: null };
      });
    },
    costLine: function (c, kind) {
      var k = c && c.state === "ok" && c.kinds ? c.kinds[kind] : null;
      return k && k.last_cost_usd != null ? "About $" + Number(k.last_cost_usd).toFixed(2) + " (last run)." : "Cost: unknown, not measured yet.";
    },
    monthLine: function () { return "Model spend this month: unknown."; },
    plainError: function () { return "That did not work."; },
    toast: function (t) { stub.toasts.push(t); document.getElementById("stub-toast").textContent = t; },
    style: function (key, css) {
      var id = "cc-style-" + key;
      if (document.getElementById(id)) return;
      var el = document.createElement("style"); el.id = id; el.textContent = css; document.head.appendChild(el);
    },
    esc: function (s) { return String(s); },
    tz: "America/Phoenix",
    sub: function () { return %PARAM%; },
    isActive: function () { return !panel.hidden; },
    go: function (to, sub) { stub.went.push([to, sub == null ? null : sub]); }
  };
  stub.ctx = ctx;
  var tab = tabs["%TAB%"];
  var panel = document.getElementById("tab-root");
  stub.tab = tab || null;
  stub.hide = function () { panel.hidden = true; if (tab && tab.hide) tab.hide(panel, ctx); };
  stub.show = function () { panel.hidden = false; if (tab && tab.show) return tab.show(panel, ctx); };
  if (tab) stub.rendered = Promise.resolve(tab.render(panel, ctx));
  else panel.textContent = "No tab registered with key %TAB%.";
})();`;

const STUB_FUNDHUBCC = `
(function () {
  var Q = (window.FundhubCC && window.FundhubCC._q) || [];
  var tabs = {};
  window.FundhubCC = { registerTab: function (t) { tabs[t.id] = t; } };
  Q.forEach(function (t) { tabs[t.id] = t; });
  var stub = window.__stub = { flavor: "fundhubcc", sheets: [], confirms: [], toasts: [], went: [], calls: [] };
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
    param: %PARAM%,
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
      money: function (c) { return c == null ? "unknown" : "$" + (c / 100).toFixed(2); },
      az: function (ts) { return new Date(ts).toLocaleString("en-US", { timeZone: "America/Phoenix" }); },
      ago: function (ts) { return String(ts); }
    }
  };
  stub.ctx = ctx;
  var tab = tabs["%TAB%"];
  var root = document.getElementById("tab-root");
  stub.tab = tab || null;
  stub.hide = function () { root.hidden = true; if (tab && tab.hide) tab.hide(); };
  stub.show = function () { root.hidden = false; if (tab && tab.refresh) return tab.refresh(ctx); };
  if (tab) stub.rendered = Promise.resolve(tab.render(root, ctx));
  else root.textContent = "No tab registered with id %TAB%.";
})();`;

/**
 * @param {{tab?: string, scripts?: string[], param?: string, flavor?: 'u34'|'fundhubcc'}} [opts]
 */
export function harnessHtml({ tab = "scripts", scripts = ["/app/marketing-cc-scripts.js"], param = "", flavor = "u34" } = {}) {
  const stub = (flavor === "fundhubcc" ? STUB_FUNDHUBCC : STUB_U34)
    .split("%TAB%").join(tab)
    .split("%PARAM%").join(JSON.stringify(param));
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
.cc-panel{display:flex;flex-direction:column;gap:24px;min-width:0}
.stub-sheet{position:fixed;inset:auto 0 0 0;background:#fff;border-top:1px solid var(--line);padding:16px;display:flex;flex-direction:column;gap:16px;z-index:50}
.stub-sheet[hidden]{display:none}
.stub-sheet .btn{min-height:44px;border:1px solid var(--ink2);border-radius:8px;padding:8px 16px;background:#fff;font-weight:600}
.stub-sheet .btn.primary{background:var(--ink2);color:var(--paper)}
</style>
</head><body>
<div class="app"><main class="main"><div class="content"><section class="cc-panel" id="tab-root"></section></div></main></div>
<div class="shell"><div id="stub-sheet" class="stub-sheet" role="dialog" aria-modal="true" aria-labelledby="stub-sheet-title" hidden>
  <p id="stub-sheet-title"><b></b></p><p class="caption" id="stub-sheet-line"></p>
  <div><button type="button" class="btn primary" id="stub-sheet-yes">Yes, go ahead</button> <button type="button" class="btn" id="stub-sheet-no">Cancel</button></div>
</div>
<p id="stub-toast" role="status" aria-live="polite"></p></div>
${scripts.map((s) => `<script src="${s}"></script>`).join("\n")}
<script>${stub}</script>
</body></html>`;
}

/**
 * Serve the harness at HARNESS_PATH and open it.
 * @param {import('@playwright/test').Page} page
 * @param {{tab?: string, scripts?: string[], param?: string, flavor?: 'u34'|'fundhubcc'}} [opts]
 */
export async function openTabHarness(page, opts = {}) {
  await page.route(`**${HARNESS_PATH}*`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: harnessHtml(opts) }));
  await page.goto(HARNESS_PATH);
}
