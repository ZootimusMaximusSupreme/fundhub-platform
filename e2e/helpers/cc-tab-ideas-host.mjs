// A tiny stand-in for the Command Center frame, so the Ideas tab can be
// driven in a real browser before the frame (build unit U34) lands.
// docs/specs/command-center-tabs.md allows exactly this: "Until the frame
// lands, a tab's e2e may load the page with a tiny local stub registry that
// renders the queued tab (keep it in e2e/helpers/)."
//
// What it gives the tab is the contract's ctx and nothing more:
//   ctx.api(method, path, body, opts) -> {ok, status, data, error, conflict, current}
//   ctx.costSheet({kind, title, lines, button, onConfirm})   the sheet before a paid tap
//   ctx.confirm({title, consequence, button, onConfirm})     the two-tap confirm
//   ctx.toast, ctx.go, ctx.param, ctx.fmt, ctx.user
//
// The API answers come from the contract examples in
// docs/specs/marketing-machine-api.md (U26, U23, U32, X4) and, for the routes
// still being built (X1, X2, X3: marketing/flywheel*, marketing/research*,
// marketing/costs), from the shapes in docs/specs/command-center-design-2026-10-05.md
// §3.1 and §3.2. A route with no answer gets the router's own 404
// ({ok:false, error:'not_found', path}), which is what an undeployed route
// says on the live site.

export const HOST_PATH = "/app/cc-host-ideas.html";
export const HOUSE = "11111111-2222-4333-8444-555555555555";

const HOST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fundhub — Ideas tab (test host)</title>
<link rel="stylesheet" href="fundhub-brand.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--field,#F4F4F5);color:var(--ink);font-family:var(--sans);line-height:1.5}
button,input,select,textarea{font:inherit;color:inherit}
.app{display:flex;min-height:100vh}
.main{flex:1;min-width:0}
.content{padding:24px}
@media (max-width:720px){.content{padding:16px}}
.host-sheet{position:fixed;inset:0;z-index:80;background:rgba(10,10,10,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px}
.host-box{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;width:100%;max-width:560px;display:flex;flex-direction:column;gap:8px}
.host-box button{min-height:48px;border-radius:8px;border:1px solid var(--ink2);padding:8px 16px;font-weight:600;background:#fff}
.host-box .host-yes{background:var(--ink2);color:var(--paper)}
.host-actions{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
</style>
</head>
<body>
<div class="app"><div class="main"><div class="content" id="tab-root"></div></div></div>
<script>
window.__sheets = [];
window.__toasts = [];
window.__went = null;
window.FundhubCC = { _q: [], registerTab: function (t) { this._q.push(t); } };
function hostApi(method, path, body, opts) {
  var headers = { accept: "application/json", authorization: "Bearer test-token" };
  var init = { method: method, headers: headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  return fetch("/api/" + path, init).then(function (r) {
    return r.json().then(function (b) { return b; }, function () { return null; }).then(function (data) {
      return { ok: r.ok, status: r.status, data: data, error: data && data.error || null, conflict: r.status === 409, current: data && data.current || null };
    });
  }, function () { return { ok: false, status: 0, data: null, error: "network" }; });
}
function hostSheet(o, kind) {
  var el = document.createElement("div");
  el.className = "host-sheet";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", o.title);
  el.setAttribute("data-kind", kind);
  var box = document.createElement("div");
  box.className = "host-box";
  var h = document.createElement("h2"); h.textContent = o.title; box.appendChild(h);
  (o.lines || []).forEach(function (l) { var p = document.createElement("p"); p.textContent = l; box.appendChild(p); });
  var acts = document.createElement("div"); acts.className = "host-actions";
  var yes = document.createElement("button"); yes.type = "button"; yes.className = "host-yes"; yes.textContent = o.button || "Start";
  var no = document.createElement("button"); no.type = "button"; no.className = "host-no"; no.textContent = "Cancel";
  acts.appendChild(yes); acts.appendChild(no); box.appendChild(acts); el.appendChild(box);
  yes.addEventListener("click", function () { el.remove(); if (o.onConfirm) o.onConfirm(); });
  no.addEventListener("click", function () { el.remove(); });
  document.body.appendChild(el);
  window.__sheets.push({ kind: kind, title: o.title, lines: o.lines || [] });
}
window.__ctx = {
  api: hostApi,
  costSheet: function (o) { hostSheet({ title: o.title, lines: o.lines, button: o.button, onConfirm: o.onConfirm }, "cost"); },
  confirm: function (o) { hostSheet({ title: o.title, lines: [o.consequence], button: o.button, onConfirm: o.onConfirm }, "confirm"); },
  toast: function (t) { window.__toasts.push(t); },
  go: function (id, p) { window.__went = [id, p || null]; },
  param: (location.hash.split("/")[1] || ""),
  fmt: {
    money: function (c) { return c == null ? "unknown" : "$" + (c / 100).toFixed(2); },
    az: function (t) { return t; },
    ago: function (t) { return t; }
  },
  user: { role: "owner" }
};
</script>
<script src="cc-tab-ideas.js"></script>
<script>
(function () {
  var tab = window.FundhubCC._q.filter(function (t) { return t.id === "ideas"; })[0];
  window.__tab = tab;
  window.__done = Promise.resolve(tab.render(document.getElementById("tab-root"), window.__ctx)).then(function () { window.__ready = true; });
})();
</script>
</body>
</html>`;

const NOW = "2026-10-06T15:00:00.000Z";

export function fixtures() {
  return {
    "GET marketing/costs": {
      ok: true,
      kinds: {
        offer: { last_cost_usd: 0.67, last_minutes: 4.5, measured_at: "2026-10-04T22:00:00.000Z" },
        script: { last_cost_usd: 0.42, last_minutes: 3, measured_at: "2026-10-05T14:00:00.000Z" },
        avatar: null, ad_research: null, research: null, quick_copy: null, funnel: null, copy: null, ad_strategy: null
      },
      month: { used_usd: 12.34, cap_usd: 300 },
      run_caps: { avatar: 20, ad_research: 40 }
    },
    "GET marketing/ideas": {
      ok: true,
      ideas: [
        { id: "00000000-0000-4000-8000-000000000402", source: "chris", kind: "script", raw_points: "Lenders check the business file too. Show what a clean business file looks like next to a messy one.", topic: null, script_format: "standard", funnel_key: "roadmap_147", angle_key: null, status: "new", script_id: null, created_at: "2026-10-05T15:10:00.000Z" },
        { id: "00000000-0000-4000-8000-000000000401", source: "chris", kind: "script", raw_points: "Lenders look at two files. People only ever fix one.", topic: "Lenders read two files", script_format: "standard", funnel_key: "roadmap_147", angle_key: "two-files", status: "written", script_id: "00000000-0000-4000-8000-000000000101", created_at: "2026-10-04T19:30:00.000Z" }
      ]
    },
    "GET marketing/batches": { ok: true, batches: [], write_now_ready: true },
    "GET marketing/batches/next": {
      ok: true,
      next: {
        release_at: "2026-10-12T14:00:00.000Z", week_key: "2026-W42", enabled: false, total: 21, size_rule: "total", funnels: [], slots: [],
        suggestions: [
          { angle_key: "two-files", name: "Lenders read two files", why: "Most spend and most leads last week.", numbers: { spend_7d_cents: 41200, leads: 9, cpl_cents: 4578 } },
          { angle_key: "inquiries-off", name: "Inquiries off first", why: "Cheapest clicks last week, no leads yet.", numbers: { spend_7d_cents: 11150, leads: 0, cpl_cents: null } },
          { angle_key: "rates-rising", name: "Rates rising", why: "Not run in 30 days.", numbers: { spend_7d_cents: null, leads: null, cpl_cents: null } }
        ],
        unmapped_spend_cents: 9150, overrides: null
      },
      saved: null,
      as_of: "2026-10-06T07:01:50.000Z"
    },
    "GET marketing/angles": {
      ok: true,
      rows: [
        { angle_key: "two-files", name: "Lenders read two files", spend_cents: 41200, ads: 1, leads: 9, booked: 3, sales: 0, cash_cents: 29400, roas: 0.71 },
        { angle_key: "inquiries-off", name: "Inquiries off first", spend_cents: 11150, ads: 1, leads: 0, booked: 0, sales: 0, cash_cents: 0, roas: 0 }
      ],
      as_of: "2026-10-06T07:01:50.000Z"
    },
    "GET marketing/research": {
      ok: true,
      runs: [
        { id: "r-done", question: "What do banks check before a business credit line?", depth: "quick", status: "done", step_word: "done",
          progress: { round: 2, findings: 37, searches_used: 41, cost_usd_so_far: 1.12 },
          report: { key_verified: 11, key_killed: 3, stopped_at_cap: false, rounds: 2, cost_usd: 1.12, minutes: 9, repo_path: null, approved_at: null },
          created_at: "2026-10-05T18:00:00.000Z" },
        { id: "r-failed", question: "Which lenders skip personal guarantees?", depth: "quick", status: "failed", error: "Anthropic's reader could not open any page. Nothing was researched", created_at: "2026-10-04T18:00:00.000Z" }
      ],
      settings: { max_research_cost_usd: null, research_shares_month_cap: true, month_used_usd: 12.34, month_cap_usd: 300, measured: false }
    },
    "GET marketing/research?id=r-done": {
      ok: true,
      job: { id: "r-done", status: "done" },
      report: {
        markdown: "# What banks check\n\n- They read the **business** file first. [Bank guide](https://example.com/bank-guide)\n- Time in business matters.\n\nTreat with caution: one source was a forum.",
        unreachable: ["https://blocked.example.com (robots.txt said no)"],
        key_verified: 11, key_killed: 3
      }
    },
    "GET marketing/flywheel": flywheel({}),
    "GET marketing/funnels": {
      ok: true,
      funnels: [
        { id: "00000000-0000-4000-8000-000000000601", key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch", offer_key: "funding_dfy", lane: "sorting", kind: null, url: "https://apply.fundhub.ai/watch", path: null, tag: null, status: "live", pages: [], events_seen: null },
        blueprintFunnel({})
      ],
      campaigns: [], ad_sets: [], as_of: "2026-10-06T07:01:50.000Z"
    },
    "GET marketing/funnel": funnelDetail({}),
    "GET marketing/today": {
      ok: true,
      copy: {
        partner_id: HOUSE,
        pieces: [
          { id: "a1", copy_text: "Your bank said no. Here is what it read first.", compliance_state: "passed", created_at: "2026-10-05T18:00:00.000Z", model: "claude-opus-5-5" },
          { id: "a2", copy_text: "Guaranteed approval in 24 hours!", compliance_state: "blocked", blocked_reasons: [{ code: "guarantee", message: "Funding ads may not promise approval." }], created_at: "2026-10-04T18:00:00.000Z" }
        ]
      },
      copy_ready: { ready: true, partner_id: HOUSE, checks: [], missing: [] }
    }
  };
}

export function flywheel({ running = false, approved2 = false } = {}) {
  return {
    ok: true,
    campaign: "partner",
    campaign_words: "Partner offer",
    campaigns: [{ name: "partner", words: "Partner offer" }, { name: "capital-blueprint", words: "Capital Blueprint" }],
    offers: [{ key: "UWIQ_DELIVERABLES", name: "Capital Blueprint", campaign: "capital-blueprint" }, { key: "FUNDING_DFY", name: "Funding, done-for-you", campaign: "funding-dfy" }],
    advice: "Step 3 needs a redo first.",
    stages: [
      running
        ? { n: 1, key: "avatar", state: "MISSING", approved: false, sentence: "", source: "github",
            run: { job_id: "job-avatar", status: "running", step: "quotes", step_n: 3, steps_total: 10, step_word: "searching the web for buyer quotes", round: 2, counts_so_far: { added: 58, kept: 455 }, searches_so_far: 23, fetches_so_far: 0, cost_so_far_usd: 1.9, shrunk: [], resumable: false, started_at: NOW, finished_at: null, error: null } }
        : { n: 1, key: "avatar", state: "MISSING", approved: false, sentence: "Not started.", source: "github", run: null },
      { n: 2, key: "ad-research", state: "READY", approved: approved2, sentence: "Done. 361 findings, 8 checked, 160 competitors.", source: "github",
        review_card_md: "## What this decided\nThe market sells funding as fast cash.\n\n## Three things to check\n- The price band\n- The worn-out angles\n- The 8 checked claims",
        document_md: "# Ad research\nThe whole document.",
        files: [{ path: "marketing/flywheel/partner/02-ad-research.md", github_url: "https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/main/marketing/flywheel/partner/02-ad-research.md" }],
        run: null },
      { n: 3, key: "offer", state: "FAILED", approved: false, sentence: "Needs a redo: the offer file has no guarantee section.", source: "github", run: null },
      { n: 4, key: "copy", state: "FAILED", approved: false, sentence: "Needs a redo: it did not count its reasons.", source: "github", run: null,
        can_run: { ok: false, reason: "Approve step 3 first (the offer)." }, can_approve: true },
      { n: 5, key: "ad-strategy", state: "BLOCKED", approved: false, state_word: "Waiting on steps 3 and 4", sentence: "Waiting on steps 3 and 4.", source: "github", run: null,
        can_run: { ok: false, reason: "Approve steps 3 and 4 first (the offer and the copy)." }, can_approve: false },
      { n: 6, key: "spend", state: "MISSING", approved: false, sentence: "Not run yet.", source: "github", run: null }
    ]
  };
}

const PAGES = (base, status) => [
  { id: "p1", position: 1, role: "landing", path: base, url: "https://apply.fundhub.ai" + base, status, built_at: status === "empty" ? null : NOW, pushed_at: null, proved_at: null, live_url: null, events_seen: 0, last_event_at: null },
  { id: "p2", position: 2, role: "booking", path: base + "-book", url: "https://apply.fundhub.ai" + base + "-book", status, built_at: status === "empty" ? null : NOW, pushed_at: null, proved_at: null, live_url: null, events_seen: 0, last_event_at: null },
  { id: "p3", position: 3, role: "thank_you", path: base + "-thank-you", url: "https://apply.fundhub.ai" + base + "-thank-you", status, built_at: status === "empty" ? null : NOW, pushed_at: null, proved_at: null, live_url: null, events_seen: 0, last_event_at: null }
];

export function blueprintFunnel({ path = "/blueprint", status = "draft", pages = "built", id = "00000000-0000-4000-8000-000000000603", key = "blueprint" } = {}) {
  return {
    id, key, name: "Capital Blueprint book a call", landing_url: "https://apply.fundhub.ai" + path, offer_key: "capital_blueprint", lane: "uwiq",
    book_call: true, format_mix: {}, cta_type: "LEARN_MORE", meta_campaign_ids: [], default_ad_set_external_id: null, weight: 1,
    active: status === "live", created_at: NOW, updated_at: NOW, kind: "book_a_call", url: "https://apply.fundhub.ai" + path, path,
    tag: "fnl-" + key, utm_campaign: "uwiq", utm_template: "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
    campaign: null, status, live_at: null, created_by: "staff-1", pages: PAGES(path, pages), events_seen: 0
  };
}

export function funnelDetail({ path = "/blueprint" } = {}) {
  const f = blueprintFunnel({ path });
  const html = (h) => "<!doctype html><html><head><title>" + h + "</title></head><body style=\"font-family:sans-serif;padding:24px\"><h1>" + h + "</h1><p>Book your call.</p></body></html>";
  return {
    ok: true,
    funnel: f,
    pages: f.pages.map((p, i) => ({ ...p, copy: { headline: ["Know exactly what stands between you and funding", "Pick the time that works for you", "Your call is on the calendar"][i] }, html: html(["Know exactly what stands between you and funding", "Pick the time that works for you", "Your call is on the calendar"][i]) })),
    jobs: [{ id: "job-f1", kind: "funnel", status: "done", attempts: 0, error: null, result: { checks: "passed" }, created_at: NOW, claimed_at: NOW, finished_at: NOW, run_after: NOW }],
    as_of: NOW
  };
}

/* mountIdeas — serve the host page, answer /api/**, and record every write.
   `answers` overrides fixtures by "METHOD path" (path with its query for
   GETs that have one, else without). A value may be a body (200), an object
   {status, body}, or a function(req) returning either. null = the router's 404. */
export async function mountIdeas(page, answers = {}) {
  const table = { ...fixtures(), ...answers };
  const posts = [];
  await page.route("**" + HOST_PATH + "*", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HOST_HTML }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\//, "");
    const method = req.method();
    let body = null;
    if (method !== "GET") {
      try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
      posts.push({ path, body });
    }
    const keys = [method + " " + path + url.search, method + " " + path];
    let ans;
    for (const k of keys) if (Object.prototype.hasOwnProperty.call(table, k)) { ans = table[k]; break; }
    if (typeof ans === "function") ans = ans({ path, body, query: url.searchParams, posts });
    if (ans === undefined || ans === null) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found", path: "/api/" + path }) });
    }
    const status = ans && typeof ans === "object" && "status" in ans && "body" in ans ? ans.status : (method === "GET" ? 200 : 200);
    const out = ans && typeof ans === "object" && "status" in ans && "body" in ans ? ans.body : ans;
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(out) });
  });
  await page.goto(HOST_PATH);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 10_000 });
  return { posts, table };
}
