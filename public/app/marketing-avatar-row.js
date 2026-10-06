/* marketing-avatar-row.js — "Build the avatar" on the flywheel's step-1 row (Today).

   WHAT THIS IS. Design docs/specs/command-center-design-2026-10-05.md §6 slice 5a
   ("the button mounts on the stage-1 row that slice 0 already puts on Today, and moves
   to the Ideas card with no back-end change when slice 5 lands") and §3.2 row 1 (the
   cost sheet, the running words with live spend, Retry). Unit X1.

   It adds ONE block under the "avatar" row of the Flywheel card
   (li.row[data-stage="avatar"] in #flywheelList). It never paints a filled button:
   Today's one filled button stays the page's own (UI-STANDARDS §1). Every control here
   is an outline button that works today.

   WHAT IT READS AND CALLS (owner/admin; same Bearer token as the page).
     GET  /api/marketing/flywheel?campaign=   step 1's words and its newest run
     GET  /api/marketing/costs                the cost line, read before every tap
     POST /api/marketing/flywheel/run         Build the avatar / Retry
     GET  /api/marketing/flywheel/job?id=     the running words, every 8 s while visible

   THE WORDS ARE THE SERVER'S. The run sentence ("Running: step 3 of 10, …", "Stopped
   at the $20 run cap after step 6. …") and the cost line (avatar_line) come back from
   the API as written; this file never builds a cost or a step sentence of its own.

   The rules that turn API answers into words are on window.FHAvatarRow so
   src/ui/marketing-avatar-row.test.mjs can run them in node:vm. */
(function (root) {
  "use strict";

  var POLL_MS = 8000;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }

  /* A request_id the server takes: 8 to 200 letters, numbers, - _ . : */
  function newKey() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "av-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* rowModel(flywheelBody, costsBody) → what the block shows and what it lets Chris do,
     or null when the answer is not a flywheel read (no block is drawn then: a control
     with nothing true behind it does not render, UI-STANDARDS §5). */
  function rowModel(fw, costs) {
    var f = obj(fw);
    if (!Array.isArray(f.stages) || !f.stages.length || obj(f.stages[0]).key !== "avatar") return null;
    var stage = obj(f.stages[0]);
    var run = stage.run && typeof stage.run === "object" ? stage.run : null;
    var status = run ? String(run.status || "") : "";
    var running = status === "queued" || status === "running";
    var stopped = status === "failed";
    var model = {
      campaign: typeof f.campaign === "string" ? f.campaign : "partner",
      words: typeof f.campaign_words === "string" ? f.campaign_words : "this campaign",
      // The run's own sentence. With no server run yet the page's row already says where step 1 stands, so nothing is repeated here.
      sentence: run && run.sentence ? String(run.sentence) : "",
      costLine: costLineOf(costs),
      running: running,
      jobId: run ? run.id : null,
      canStart: !running,
      startWhy: running ? "It is running now. This row shows each step as it goes." : "",
      canRetry: !!(run && stopped),
      retryLabel: run && run.stopped_at_cap ? "Retry (keeps what it found)" : "Retry",
      serviceDefault: typeof f.service_description_default === "string" ? f.service_description_default : "",
      ownerNotes: typeof f.owner_notes_stage_1 === "string" ? f.owner_notes_stage_1 : "",
      costsRead: !!costs
    };
    return model;
  }

  /* The server's cost line, or the honest unknown. */
  function costLineOf(costs) {
    var c = obj(costs);
    return typeof c.avatar_line === "string" && c.avatar_line ? c.avatar_line : "Cost: unknown, not measured yet.";
  }

  /* answerWords(status, body) → { tone, text } for a POST marketing/flywheel/run answer. */
  function answerWords(status, body) {
    var b = obj(body);
    if (status === 202 && b.already_running) return { tone: "wip", text: b.message || "The avatar is already being built. This is that run." };
    if (status === 202 && b.retried) return { tone: "ok", text: "Running again from where it stopped. Nothing it already found is paid for twice." };
    if (status === 202) return { tone: "ok", text: "Started. It runs on the server in 10 steps; this row shows each one." };
    if (status === 0) return { tone: "err", text: "No connection. Nothing was started. Try again when you are back online." };
    if (status === 401) return { tone: "err", text: "Your sign-in ran out. Sign in again, then tap Build the avatar." };
    if (b.message) return { tone: "err", text: String(b.message) };
    return { tone: "err", text: "It did not start, and the server did not say why. Nothing was charged. Try again." };
  }

  function startBody(model, service, retryJobId) {
    var body = { campaign: model.campaign, stage: 1, request_id: newKey() };
    var s = String(service || "").replace(/\s+/g, " ").trim();
    if (s) body.service_description = s;
    if (retryJobId) body.retry_job_id = retryJobId;
    return body;
  }

  function renderAct(model) {
    return '<div class="av-act" data-avatar-act>' +
      (model.sentence ? '<p class="row-why av-run" role="status" aria-live="polite">' + esc(model.sentence) + "</p>" : "") +
      '<p class="caption muted">' + esc(model.costLine) + "</p>" +
      '<div class="av-btns">' +
        '<button type="button" class="btn av-btn" data-av="start"' + (model.canStart ? "" : " disabled") + ">Build the avatar</button>" +
        (model.canRetry ? '<button type="button" class="btn av-btn" data-av="retry">' + esc(model.retryLabel) + "</button>" : "") +
      "</div>" +
      (model.startWhy ? '<p class="caption muted">' + esc(model.startWhy) + "</p>" : "") +
      '<p class="caption av-say" data-av="say"></p>' +
    "</div>";
  }

  function renderSheet(model) {
    return '<form method="dialog" class="av-form">' +
      '<h2 class="av-h">Build the avatar for ' + esc(model.words) + "?</h2>" +
      '<p class="caption">' + esc(model.costLine) + "</p>" +
      '<label class="caption" for="avService">What we sell</label>' +
      '<textarea id="avService" class="av-text" rows="4">' + esc(model.serviceDefault) + "</textarea>" +
      '<p class="caption">Your notes for this step (read only; they go into the run):</p>' +
      '<p class="caption muted av-notes">' + (model.ownerNotes ? esc(model.ownerNotes).replace(/\n/g, "<br>") : "No notes for step 1.") + "</p>" +
      '<p class="caption muted">It spends no ad money. Nothing goes live: it saves files to the repo for you to read.</p>' +
      '<div class="av-btns">' +
        '<button type="submit" class="btn av-btn" value="go" data-av="go">Start building</button>' +
        '<button type="submit" class="btn av-btn" value="no">Not now</button>' +
      "</div>" +
    "</form>";
  }

  var API = {
    POLL_MS: POLL_MS,
    rowModel: rowModel,
    costLineOf: costLineOf,
    answerWords: answerWords,
    startBody: startBody,
    renderAct: renderAct,
    renderSheet: renderSheet,
    newKey: newKey
  };
  root.FHAvatarRow = API;

  /* ── the page ────────────────────────────────────────────────────────── */

  var doc = root.document;
  if (!doc || typeof doc.getElementById !== "function") return;

  var STYLE =
    ".av-act{flex:1 1 100%;display:flex;flex-direction:column;gap:8px;padding-left:40px}" +
    ".av-btns{display:flex;gap:16px;flex-wrap:wrap}" +
    ".av-btn{min-height:44px}" +
    ".av-sheet{margin:auto;border:1px solid var(--line);border-radius:12px;padding:24px;width:calc(100% - 32px);max-width:560px}" +
    ".av-form{display:flex;flex-direction:column;gap:16px}" +
    ".av-h{font-weight:600}" +
    ".av-text{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;min-height:96px}" +
    "@media (max-width:600px){.av-act{padding-left:0}.av-btn{flex:1 1 100%}}";

  function boot() {
    var list = doc.getElementById("flywheelList");
    if (!list) return;

    function api(path, init) {
      init = init || {};
      var headers = { accept: "application/json" };
      try {
        var t = root.localStorage.getItem("fh_token") || "";
        if (t && t !== "demo" && t !== "demo-token") headers.authorization = "Bearer " + t;
      } catch (e) { /* storage blocked: the cookie still works */ }
      var opts = { method: init.method || "GET", headers: headers, credentials: "same-origin" };
      if (init.body !== undefined) {
        headers["content-type"] = "application/json";
        opts.body = JSON.stringify(init.body);
      }
      return root.fetch(path, opts).then(
        function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }, function () { return { status: r.status, body: null }; }); },
        function () { return { status: 0, body: null }; }
      );
    }

    var style = doc.createElement("style");
    style.textContent = STYLE;
    doc.head.appendChild(style);

    var state = { model: null, say: null, timer: null };

    function load() {
      return Promise.all([api("/api/marketing/flywheel"), api("/api/marketing/costs")]).then(function (rs) {
        var fw = rs[0], costs = rs[1];
        if (fw.status !== 200) { state.model = null; return; }
        state.model = rowModel(fw.body, costs.status === 200 ? costs.body : null);
        if (!state.model) return;
        if (state.model.running) poll(state.model.jobId);
        paint();
      });
    }

    function paint() {
      var row = list.querySelector('li.row[data-stage="avatar"]');
      if (!row || !state.model) return;
      var old = row.querySelector("[data-avatar-act]");
      var html = renderAct(state.model);
      if (old) {
        if (old.outerHTML === html && !state.say) return;
        old.remove();
      }
      row.insertAdjacentHTML("beforeend", html);
      var act = row.querySelector("[data-avatar-act]");
      if (state.say) {
        var s = act.querySelector('[data-av="say"]');
        s.textContent = state.say.text;
        s.setAttribute("role", state.say.tone === "err" ? "alert" : "status");
      }
      var start = act.querySelector('[data-av="start"]');
      if (start) start.addEventListener("click", openSheet);
      var retry = act.querySelector('[data-av="retry"]');
      if (retry) retry.addEventListener("click", function () { send(null, state.model.jobId, retry); });
    }

    function openSheet() {
      var m = state.model;
      if (!m || !m.canStart) return;
      // Cost before every tap: read the costs again so the sheet is never stale.
      api("/api/marketing/costs").then(function (c) {
        if (c.status === 200) m.costLine = costLineOf(c.body);
        var dlg = doc.createElement("dialog");
        dlg.className = "av-sheet";
        dlg.innerHTML = renderSheet(m);
        doc.body.appendChild(dlg);
        dlg.addEventListener("close", function () {
          var go = dlg.returnValue === "go";
          var text = dlg.querySelector("#avService").value;
          dlg.remove();
          if (go) send(text, null, null);
        });
        if (typeof dlg.showModal === "function") dlg.showModal();
        else dlg.setAttribute("open", "");
      });
    }

    function send(service, retryJobId, btn) {
      var m = state.model;
      if (!m) return;
      if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
      api("/api/marketing/flywheel/run", { method: "POST", body: startBody(m, service, retryJobId) }).then(function (r) {
        state.say = answerWords(r.status, r.body);
        if (r.status === 202 && r.body && r.body.job) {
          m.running = true; m.canStart = false; m.canRetry = false;
          m.startWhy = "It is running now. This row shows each step as it goes.";
          m.sentence = r.body.job.sentence || m.sentence;
          m.jobId = r.body.job.id;
          poll(m.jobId);
        }
        paint();
      });
    }

    function poll(id) {
      if (state.timer || !id) return;
      state.timer = root.setInterval(function () {
        if (doc.visibilityState && doc.visibilityState !== "visible") return;
        api("/api/marketing/flywheel/job?id=" + encodeURIComponent(id)).then(function (r) {
          if (r.status !== 200 || !r.body || !r.body.job) return;
          var j = r.body.job;
          state.model.sentence = j.sentence || state.model.sentence;
          if (j.status === "done" || j.status === "failed") {
            root.clearInterval(state.timer);
            state.timer = null;
            state.say = null;
            load();
            return;
          }
          paint();
        });
      }, POLL_MS);
    }

    // The page re-draws the Flywheel card (on focus and every 5 minutes): put the block back.
    if (typeof root.MutationObserver === "function") {
      new root.MutationObserver(function () { paint(); }).observe(list, { childList: true, subtree: false });
    }
    load();
  }

  /* Wave 2b merge (U34's frame): Today is drawn by its tab script the first time the
     frame shows it, so #flywheelList may not exist yet (another tab opened first).
     Wait for it, once, then boot. */
  function whenListThere() {
    if (doc.getElementById("flywheelList")) { boot(); return; }
    if (typeof root.MutationObserver !== "function" || !doc.body) return;
    var watch = new root.MutationObserver(function () {
      if (!doc.getElementById("flywheelList")) return;
      watch.disconnect();
      boot();
    });
    watch.observe(doc.body, { childList: true, subtree: true });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", whenListThere);
  else whenListThere();
})(typeof window !== "undefined" ? window : globalThis);
