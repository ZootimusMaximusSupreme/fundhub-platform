// A probe tab for the Command Center frame's e2e (U34 review R1).
//
// It is written exactly the way docs/specs/command-center-tabs.md tells a tab
// unit to write one (main's window.FundhubCC spelling), so the frame test can
// prove a real cc-tab-*.js file plugs in: it is served as its own script and
// its <script defer> line is put BEFORE the frame's, so it registers into
// FundhubCC._q and the frame has to drain the queue. Its render reads through
// ctx.api("GET", ...), prints ctx.fmt / ctx.param / ctx.user, and its two
// buttons go through ctx.costSheet and ctx.confirm. Everything it saw is kept
// on window.__probe for the spec to read.
//
// Nothing here is added to public/: the spec answers PROBE_PATH with
// page.route(), and rewrites the page's HTML in the browser only.

export const PROBE_PATH = "/app/cc-tab-e2e-probe.js";
export const PROBE_TAG = '<script defer src="cc-tab-e2e-probe.js"></script>';
export const FRAME_TAG = '<script defer src="marketing-command-center.js"></script>';

export const PROBE_JS = `(function () {
  "use strict";
  var P = window.__probe = { renders: 0, refreshes: 0, hides: 0, answers: [], confirmed: 0, read: null, sent: null };
  var st = { root: null, ctx: null };
  function el(id) { return st.root.querySelector("#" + id); }
  function render(root, ctx) {
    P.renders++;
    st.root = root;
    st.ctx = ctx;
    root.innerHTML =
      '<div class="card"><div class="card-hd"><h2>Probe tab</h2></div>' +
      '<p id="prWord">Loading…</p><p id="prMoney"></p><p id="prNull"></p><p id="prTime"></p>' +
      '<p id="prParam"></p><p id="prRole"></p><p id="prSay" role="status"></p>' +
      '<div class="actions gap-top"><button type="button" class="btn" id="prCost">Write 3 scripts</button>' +
      '<button type="button" class="btn" id="prTurn">Turn on Ad 84</button></div></div>';
    el("prParam").textContent = "View: " + ctx.param;
    el("prRole").textContent = "Role: " + (ctx.user && ctx.user.role);
    el("prNull").textContent = "Null money: " + ctx.fmt.money(null);
    el("prCost").addEventListener("click", function () {
      st.ctx.costSheet({ kind: "script", title: "Write 3 scripts?", lines: ["Spends no ad money."], button: "Write 3",
        onConfirm: function () { P.confirmed++; } }).then(function (yes) { P.answers.push(["cost", yes]); });
    });
    el("prTurn").addEventListener("click", function () {
      st.ctx.confirm({ title: "Turn on Ad 84?", consequence: "Ad 84 starts spending $40.00 a day.", button: "Turn on" })
        .then(function (yes) {
          P.answers.push(["confirm", yes]);
          if (!yes) return null;
          return st.ctx.api("POST", "marketing/probe", { a: 1 }, { version: 3, requestId: "req-probe-1" }).then(function (r) {
            P.sent = r;
            el("prSay").textContent = r.conflict
              ? "Someone saved this first. The saved one is version " + (r.current && r.current.version) + "."
              : "Saved.";
          });
        });
    });
    return ctx.api("GET", "marketing/probe").then(function (r) {
      P.read = r;
      el("prWord").textContent = r.ok ? r.data.word : "The probe did not load.";
      el("prMoney").textContent = "Spend: " + ctx.fmt.money(r.data && r.data.spend_cents);
      el("prTime").textContent = "As of " + ctx.fmt.az(r.data && r.data.as_of);
    });
  }
  function refresh(ctx) { P.refreshes++; st.ctx = ctx; }
  function hide() { P.hides++; }
  (window.FundhubCC = window.FundhubCC || { _q: [], registerTab: function (t) { this._q.push(t); } })
    .registerTab({ id: "probe", label: "Probe", order: 6, render: render, refresh: refresh, hide: hide });
  P.queuedBeforeFrame = !window.FHMarketingCCTabs;
})();
`;

/** Serve the probe and put its script line before the frame's, in this page only. */
export async function withProbe(page) {
  await page.route("**" + PROBE_PATH, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: PROBE_JS }));
  await page.route("**/app/marketing-command-center.html*", async (route) => {
    const res = await route.fetch();
    const html = await res.text();
    if (!html.includes(FRAME_TAG)) throw new Error("the frame's script line moved: " + FRAME_TAG);
    await route.fulfill({ response: res, body: html.replace(FRAME_TAG, PROBE_TAG + "\n" + FRAME_TAG) });
  });
}
