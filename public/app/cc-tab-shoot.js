/* Command Center — the Shoot tab.
 *
 * "What do I film today, and where is each clip now?" Plan the shoot, roll it
 * in the teleprompter, watch each ad move toward a finished video.
 *
 * Design docs/specs/command-center-design-2026-10-05.md §3.4 (slice 6); spec
 * docs/specs/marketing-machine-2026-10-04.md §8.2; plug-in contract
 * docs/specs/command-center-tabs.md; UI law docs/rules/UI-STANDARDS.md. Unit X5.
 *
 * READS  GET marketing/shoot?wpm=  (api/marketing/shoot.mjs). The reading
 *        speed is the one the teleprompter on this device saved, so the time
 *        estimate matches the speed Chris films at.
 * WRITES POST marketing/shoot       Save the plan, move a script, close the shoot
 *        POST marketing/shoot/mark  Got it / Another take from a row
 *        All free. Each tap gets its own request_id.
 *
 * WHAT CHRIS SEES, top to bottom: the time estimate (top-left), the one filled
 * button (Save the plan before a shoot, Open the teleprompter after), the plan
 * in film order with each script's ad number, angle name and the exact take
 * file name (marketing/ads/NAMING.md), the checklist, where to share the
 * clips, the progress board, past shoots, and Close the shoot (two taps).
 *
 * Every visible control works. The board's Assign, Retry and hold choices
 * need the Videos routes, which are not built; the board says so in one
 * sentence instead of showing a dead button.
 *
 * The pure helpers are on window.FundhubShootTab so src/ui/cc-tab-shoot.test.mjs
 * can prove them without a browser.
 */
(function (root) {
  "use strict";

  var DRIVE_SLO_ADS = "https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ";
  var TELEPROMPTER = "/app/teleprompter.html";
  var CHECKS = [
    { key: "rig", label: "Rig set" },
    { key: "mirror", label: "Mirror on" },
    { key: "remote", label: "Remote paired" },
    { key: "phone", label: "Phone charged, with storage free" }
  ];

  /* ── pure helpers ───────────────────────────────────────────────────── */

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /** "0:22" */
  function readClock(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  /** The top-left line: how many scripts, about how long. */
  function headline(page) {
    if (!page) return { title: "Shoot", sub: "" };
    var wpm = page.wpm || 150;
    var sub = "At " + wpm + " words a minute, plus 2 minutes an ad for takes and resets.";
    if (page.shoot) {
      var n = (page.shoot.scripts || []).length;
      return { title: "Today's shoot: " + plural(n, "script", "scripts") + ", about " + plural(page.shoot.estimated_minutes || 0, "minute", "minutes"), sub: sub };
    }
    var c = (page.plan_candidates || []).length;
    if (!c) return { title: "Nothing to film yet", sub: "" };
    return { title: "Ready to film: " + plural(c, "script", "scripts") + ", about " + plural(page.plan_estimated_minutes || 0, "minute", "minutes"), sub: sub };
  }

  /** The ids with one moved up (dir -1) or down (dir +1). */
  function moveId(ids, id, dir) {
    var out = ids.slice();
    var i = out.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= out.length) return out;
    out[i] = out[j]; out[j] = id;
    return out;
  }

  /** The ids with one moved to the top. */
  function filmFirst(ids, id) {
    var out = ids.filter(function (x) { return x !== id; });
    if (out.length === ids.length) return ids.slice();
    out.unshift(id);
    return out;
  }

  /** Labels for a script row: retake / first line only / Got it / takes. */
  function chipsFor(s) {
    var out = [];
    if (s.got_it) out.push({ cls: "on", word: "Got it" });
    else if (s.takes > 0) out.push({ cls: "wip", word: plural(s.takes, "take", "takes") });
    if (s.first_line_only) out.push({ cls: "wip", word: "First line only" });
    else if (s.needs_retake) out.push({ cls: "wip", word: "Retake" });
    return out;
  }

  /** The words for a row's first line: "Ad 91 · Lenders read two files". */
  function rowName(s) {
    return "Ad " + (s.ad_id || "?") + " · " + (s.angle_name || s.title || "Untitled script");
  }

  /** The file-name line: the name, or why there is none. */
  function fileLine(s) {
    if (s.take_file_name) return { ok: true, text: s.take_file_name };
    return { ok: false, text: "File name unknown: " + (s.take_name_problem || "a part of the name is missing.") };
  }

  /** Board chip class for a step. */
  function stepClass(step) {
    if (step === "failed") return "bad";
    if (step === "approved" || step === "loaded") return "on";
    return "wip";
  }

  /** Shoot status in words. */
  function statusWord(st) {
    return { planned: "Planned", filming: "Filming", uploaded: "Clips shared", done: "Closed" }[st] || "Planned";
  }

  /**
   * The plan as drawn: with a shoot, its scripts in its order, plus the
   * approved scripts not on it; without one, every candidate in the order
   * Chris has set on this screen, each on or off the plan.
   */
  function planView(page, local) {
    if (!page) return { rows: [], extra: [] };
    var cands = page.plan_candidates || [];
    if (page.shoot) {
      var on = {};
      (page.shoot.root_script_ids || []).forEach(function (id) { on[id] = true; });
      return {
        rows: (page.shoot.scripts || []).slice(),
        extra: cands.filter(function (s) { return !on[s.root_script_id]; })
      };
    }
    var byId = {};
    cands.forEach(function (s) { byId[s.root_script_id] = s; });
    var order = (local && local.order && local.order.length ? local.order : cands.map(function (s) { return s.root_script_id; }))
      .filter(function (id) { return byId[id]; });
    cands.forEach(function (s) { if (order.indexOf(s.root_script_id) < 0) order.push(s.root_script_id); });
    return { rows: order.map(function (id) { return byId[id]; }), extra: [] };
  }

  /**
   * The teleprompter link. The Shoot tab's film.path already has the key.
   * A path that is not this page is ignored, so the button cannot leave the site.
   */
  function filmHref(page, scriptId) {
    var path = TELEPROMPTER;
    var given = page && page.film && page.film.path;
    if (typeof given === "string" && given.indexOf("/app/teleprompter.html?k=") === 0 && given.indexOf(" ") < 0) path = given;
    if (!scriptId) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "script=" + encodeURIComponent(scriptId);
  }

  /** A fresh request id for one tap. */
  function requestId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) { /* fall through */ }
    return "shoot-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  var api = {
    headline: headline, moveId: moveId, filmFirst: filmFirst, filmHref: filmHref, chipsFor: chipsFor, rowName: rowName,
    fileLine: fileLine, stepClass: stepClass, statusWord: statusWord, planView: planView, readClock: readClock,
    requestId: requestId, CHECKS: CHECKS, DRIVE_SLO_ADS: DRIVE_SLO_ADS
  };
  root.FundhubShootTab = api;

  /* The page's document. Absent in the unit test's bare VM, where only the
     helpers above and the registration below run. */
  var doc = root.document;

  /* ── styles, once, scoped to .cc-shoot ──────────────────────────────── */

  /* No px font sizes: the brand file forces sizes inside a shell
     (UI-STANDARDS §12.7). Sizes come from its whitelist only: h2 (title),
     .big (the hero line), .caption/.chip/.eyebrow/.mono (caption), body.
     Containers are .card, which is on the brand's shadow list (§12.2). */
  function styles() {
    if (doc.getElementById("cc-shoot-css")) return;
    var css = [
      ".cc-shoot{display:flex;flex-direction:column;gap:24px;min-width:0}",
      ".cc-shoot .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;min-width:0}",
      ".cc-shoot .hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin-bottom:16px}",
      ".cc-shoot h2{margin:0;font-weight:600;letter-spacing:-.01em}",
      ".cc-shoot .big{font-weight:600;letter-spacing:-.02em;line-height:1.15;margin:8px 0}",
      ".cc-shoot .muted{color:var(--gray)}",
      ".cc-shoot .rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}",
      ".cc-shoot .row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:16px 0;border-top:1px solid var(--line);align-items:start}",
      ".cc-shoot .row:first-child{border-top-color:transparent;padding-top:0}",
      ".cc-shoot .row .nm{font-weight:600;min-width:0;overflow-wrap:anywhere}",
      ".cc-shoot .row .chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}",
      ".cc-shoot .row .body{grid-column:1 / -1;min-width:0;display:flex;flex-direction:column;gap:8px}",
      ".cc-shoot .file{font-family:var(--mono);overflow-wrap:anywhere;color:var(--ink)}",
      ".cc-shoot .file.unknown{font-family:var(--sans);color:#6B4A12}",
      ".cc-shoot .acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".cc-shoot .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--ink2);border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer;background:#fff;color:var(--ink2);min-height:44px;text-decoration:none}",
      ".cc-shoot .btn:hover{border-color:var(--ink)}",
      ".cc-shoot .btn.primary{background:var(--ink2);color:var(--paper);min-height:56px;padding:8px 24px}",
      ".cc-shoot .btn.arrow{min-width:44px;padding:8px}",
      ".cc-shoot .btn[disabled],.cc-shoot .btn[aria-disabled=true]{opacity:.45;cursor:not-allowed}",
      ".cc-shoot .btn.text{border-color:var(--line);color:var(--gray)}",
      ".cc-shoot .chip{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:4px 8px;white-space:nowrap}",
      ".cc-shoot .chip .cd{width:8px;height:8px;border-radius:50%;background:var(--gray2)}",
      ".cc-shoot .chip.on .cd{background:var(--ok)}",
      ".cc-shoot .chip.wip .cd{background:var(--warn)}",
      ".cc-shoot .chip.bad .cd{background:var(--alert)}",
      ".cc-shoot .check{display:flex;align-items:center;gap:16px;min-height:44px;padding:8px 0;border-top:1px solid var(--line);cursor:pointer}",
      ".cc-shoot .check:first-child{border-top:0}",
      ".cc-shoot .check input{width:24px;height:24px;accent-color:var(--ink2);flex-shrink:0}",
      ".cc-shoot .say{margin-top:8px;color:var(--gray)}",
      ".cc-shoot .say.err{color:#6E2A22}",
      ".cc-shoot .lead{display:flex;flex-direction:column;gap:16px;align-items:flex-start}",
      ".cc-shoot .lead .btn.primary{width:100%;max-width:420px}",
      ".cc-shoot .apart{margin-top:32px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
      ".cc-shoot .sk{background:var(--soft);border-radius:8px;height:16px;margin:8px 0}",
      ".cc-shoot .sk.w60{width:60%}.cc-shoot .sk.w40{width:40%}.cc-shoot .sk.w80{width:80%}",
      ".cc-shoot .on-plan{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}",
      ".cc-shoot .on-plan input{width:24px;height:24px;accent-color:var(--ink2)}",
      ".cc-shoot .row.off .nm,.cc-shoot .row.off .file{opacity:.5}",
      "@media (max-width:600px){.cc-shoot .card{padding:16px}.cc-shoot .lead .btn.primary{max-width:none}}"
    ].join("\n");
    var el = doc.createElement("style");
    el.id = "cc-shoot-css";
    el.textContent = css;
    doc.head.appendChild(el);
  }

  /* ── DOM helpers ─────────────────────────────────────────────────────── */

  function h(tag, attrs, kids) {
    var el = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") el.textContent = v;
      else if (k === "cls") el.className = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) el.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
    return el;
  }
  function chip(cls, word) { return h("span", { cls: "chip " + cls }, [h("span", { cls: "cd", "aria-hidden": "true" }), word]); }

  function wpmHere() {
    try {
      var s = JSON.parse(root.localStorage.getItem("fhtp.settings") || "{}");
      var w = Number(s.wpm);
      return w >= 80 && w <= 260 ? Math.round(w) : 150;
    } catch (e) { return 150; }
  }
  function checkKey(shootId) { return "fhcc.shoot.check." + (shootId || "next"); }
  function readChecks(shootId) { try { return JSON.parse(root.localStorage.getItem(checkKey(shootId)) || "{}") || {}; } catch (e) { return {}; } }
  function saveChecks(shootId, v) { try { root.localStorage.setItem(checkKey(shootId), JSON.stringify(v)); } catch (e) { /* private mode */ } }

  function azTime(ctx, ts) {
    if (!ts) return "unknown";
    if (ctx && ctx.fmt && typeof ctx.fmt.az === "function") return ctx.fmt.az(ts);
    try {
      return new Date(ts).toLocaleString("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return String(ts); }
  }
  function azDay(d) {
    if (!d) return "unknown";
    try { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); } catch (e) { return d; }
  }

  /* ── the tab ─────────────────────────────────────────────────────────── */

  function mount(rootEl, ctx) {
    styles();
    var st = { page: null, order: [], off: {}, busy: false, say: null, sayErr: false, confirmClose: false };

    function toast(msg) { if (ctx && typeof ctx.toast === "function") ctx.toast(msg); }
    function call(method, path, body) {
      if (!ctx || typeof ctx.api !== "function") return Promise.resolve({ ok: false, status: 0, error: "The page is not ready. Reload it." });
      return Promise.resolve(ctx.api(method, path, body, { requestId: body && body.request_id })).then(function (r) { return r || { ok: false, status: 0 }; },
        function () { return { ok: false, status: 0, error: "No connection. Nothing was saved. Try again." }; });
    }
    function words(r, fallback) {
      if (r && r.status === 401) return "You are signed out. Sign in again, then try once more.";
      if (r && r.status === 0) return "No connection. Nothing was saved. Try again.";
      var d = r && r.data;
      return (d && d.message) || (typeof r.error === "string" && /\s/.test(r.error) ? r.error : "") || fallback;
    }

    function skeleton() {
      rootEl.innerHTML = "";
      rootEl.appendChild(h("div", { cls: "cc-shoot", "aria-busy": "true" }, [
        h("section", { cls: "card" }, [h("div", { cls: "sk w60" }), h("div", { cls: "sk w40" })]),
        h("section", { cls: "card" }, [h("div", { cls: "sk w80" }), h("div", { cls: "sk w80" }), h("div", { cls: "sk w60" })])
      ]));
    }

    function load() {
      return call("GET", "marketing/shoot?wpm=" + wpmHere()).then(function (r) {
        if (r.ok && r.data) {
          st.page = r.data;
          draw();
          return;
        }
        rootEl.innerHTML = "";
        var msg = r.status === 401 ? "You are signed out. Sign in again to see the shoot."
          : r.status === 403 ? "The Shoot tab is for the owner and admins."
          : r.status === 503 && r.data && r.data.message ? r.data.message
          : "The shoot did not load. The rest of this page is current. Try again.";
        rootEl.appendChild(h("div", { cls: "cc-shoot" }, [h("section", { cls: "card", role: "alert" }, [
          h("h2", { text: "Shoot" }),
          h("p", { cls: "say err", text: msg }),
          r.status === 403 ? null : h("div", { cls: "acts" }, [h("button", { type: "button", cls: "btn", text: "Try again", onclick: function () { skeleton(); load(); } })])
        ])]));
      });
    }

    function saying() {
      return st.say ? h("p", { cls: "say" + (st.sayErr ? " err" : ""), role: st.sayErr ? "alert" : "status", text: st.say }) : null;
    }
    function setSay(msg, err) { st.say = msg; st.sayErr = !!err; }

    function save(body, done) {
      if (st.busy) return;
      st.busy = true; setSay(null); draw();
      body.request_id = requestId();
      body.wpm = wpmHere();
      call("POST", "marketing/shoot", body).then(function (r) {
        st.busy = false;
        if (r.ok && r.data && r.data.shoot) {
          setSay(done(r.data.shoot));
          toast(st.say);
          return load();
        }
        setSay(words(r, "That did not save. Nothing changed. Try again."), true);
        draw();
      });
    }

    function markRow(s, mark) {
      if (st.busy || !st.page || !st.page.shoot) return;
      st.busy = true; setSay(null); draw();
      call("POST", "marketing/shoot/mark", { request_id: requestId(), shoot_id: st.page.shoot.id, root_script_id: s.root_script_id, mark: mark }).then(function (r) {
        st.busy = false;
        if (r.ok) {
          setSay(mark === "got_it" ? "Got it. Ad " + s.ad_id + " is marked." : "Another take counted for Ad " + s.ad_id + ".");
          toast(st.say);
          return load();
        }
        setSay(words(r, "That mark did not save. Try again."), true);
        draw();
      });
    }

    /* ── drawing ─────────────────────────────────────────────────────── */

    function draw() {
      var page = st.page;
      var view = planView(page, { order: st.order });
      var shoot = page && page.shoot;
      var included = view.rows.filter(function (s) { return !st.off[s.root_script_id]; });
      rootEl.innerHTML = "";
      var wrap = h("div", { cls: "cc-shoot" });
      wrap.appendChild(lead(page, shoot, included));
      wrap.appendChild(planCard(page, shoot, view));
      wrap.appendChild(checklist(shoot));
      if (shoot) {
        wrap.appendChild(shareCard(shoot));
        wrap.appendChild(boardCard(shoot));
      }
      if (page && (page.past_shoots || []).length) wrap.appendChild(pastCard(page.past_shoots));
      rootEl.appendChild(wrap);
    }

    function lead(page, shoot, included) {
      var hl = headline(page);
      var kids = [h("span", { cls: "eyebrow", text: shoot ? "Shoot · " + statusWord(shoot.status) + " · " + azDay(shoot.shoot_date) : "Shoot" }),
        h("p", { cls: "big", text: hl.title })];
      if (hl.sub) kids.push(h("p", { cls: "caption muted", text: hl.sub + " As of " + azTime(ctx, page && page.as_of) + "." }));
      var actions = h("div", { cls: "lead" });
      if (shoot) {
        var got = (shoot.scripts || []).filter(function (s) { return s.got_it; }).length;
        actions.appendChild(h("a", { cls: "btn primary", href: filmHref(page), text: "Open the teleprompter" }));
        actions.appendChild(h("p", { cls: "caption muted", text: got + " of " + (shoot.scripts || []).length + " marked Got it." }));
      } else {
        var n = included.length;
        actions.appendChild(h("button", {
          type: "button", cls: "btn primary", disabled: !n || st.busy,
          text: st.busy ? "Saving…" : "Save the plan",
          onclick: function () {
            var ids = included.map(function (s) { return s.root_script_id; });
            save({ root_script_ids: ids }, function () { return "Saved. " + plural(ids.length, "script", "scripts") + " in this order."; });
          }
        }));
        actions.appendChild(h("button", { type: "button", cls: "btn", disabled: true, "aria-disabled": "true", text: "Open the teleprompter" }));
        actions.appendChild(h("p", { cls: "caption muted", text: n ? "Save a plan first. Free." : "Approve some scripts in Scripts first." }));
      }
      kids.push(actions);
      var s = saying();
      if (s) kids.push(s);
      return h("section", { cls: "card", "aria-label": "Shoot summary" }, kids);
    }

    function planCard(page, shoot, view) {
      var kids = [h("div", { cls: "hd" }, [h("h2", { text: shoot ? "The plan, in film order" : "Approved scripts, in film order" })])];
      if (!view.rows.length) {
        kids.push(h("p", { cls: "muted", text: "No approved scripts to film. Approve some in Scripts first." }));
        return h("section", { cls: "card" }, kids);
      }
      var ids = view.rows.map(function (s) { return s.root_script_id; });
      var list = h("ol", { cls: "rows", "aria-label": "Film order" });
      view.rows.forEach(function (s, i) { list.appendChild(planRow(s, i, ids, shoot)); });
      kids.push(list);
      if (shoot && view.extra.length) {
        kids.push(h("div", { cls: "hd", style: "margin-top:24px" }, [h("h2", { text: "Approved, not on this shoot" })]));
        var more = h("ul", { cls: "rows" });
        view.extra.forEach(function (s) {
          more.appendChild(scriptRow(s, [h("button", {
            type: "button", cls: "btn", disabled: st.busy, text: "Add to the plan",
            onclick: function () { save({ id: shoot.id, root_script_ids: ids.concat([s.root_script_id]) }, function () { return "Added Ad " + s.ad_id + " to the end of the plan."; }); }
          })]));
        });
        kids.push(more);
      }
      return h("section", { cls: "card", "aria-label": "The plan" }, kids);
    }

    function scriptRow(s, actions, extraCls) {
      var f = fileLine(s);
      var chips = chipsFor(s).map(function (c) { return chip(c.cls, c.word); });
      return h("li", { cls: "row" + (extraCls ? " " + extraCls : ""), "data-root": s.root_script_id }, [
        h("div", { cls: "nm", text: rowName(s) }),
        h("div", { cls: "chips" }, chips),
        h("div", { cls: "body" }, [
          h("span", { cls: "caption muted", text: [s.script_format || "script", "read " + readClock(s.read_seconds), plural(s.words || 0, "word", "words")].join(" · ") }),
          h("span", { cls: "file" + (f.ok ? " mono" : " caption unknown"), "data-file": f.ok ? f.text : null, text: f.text }),
          actions && actions.length ? h("div", { cls: "acts" }, actions) : null
        ])
      ]);
    }

    function planRow(s, i, ids, shoot) {
      var acts = [];
      var move = function (next, msg) {
        if (shoot) save({ id: shoot.id, root_script_ids: next }, function () { return msg; });
        else { st.order = next; setSay(null); draw(); }
      };
      acts.push(h("button", { type: "button", cls: "btn arrow", "aria-label": "Move Ad " + s.ad_id + " up", disabled: i === 0 || st.busy, text: "↑",
        onclick: function () { move(moveId(ids, s.root_script_id, -1), "Moved Ad " + s.ad_id + " up."); } }));
      acts.push(h("button", { type: "button", cls: "btn arrow", "aria-label": "Move Ad " + s.ad_id + " down", disabled: i === ids.length - 1 || st.busy, text: "↓",
        onclick: function () { move(moveId(ids, s.root_script_id, 1), "Moved Ad " + s.ad_id + " down."); } }));
      acts.push(h("button", { type: "button", cls: "btn", disabled: i === 0 || st.busy, text: "Film first",
        onclick: function () { move(filmFirst(ids, s.root_script_id), "Ad " + s.ad_id + " is filmed first."); } }));
      if (shoot) {
        if (!s.got_it) {
          acts.push(h("a", { cls: "btn", href: filmHref(st.page, s.root_script_id), text: "Roll it" }));
          acts.push(h("button", { type: "button", cls: "btn", disabled: st.busy, text: "Got it", onclick: function () { markRow(s, "got_it"); } }));
          acts.push(h("button", { type: "button", cls: "btn", disabled: st.busy, text: "Another take", onclick: function () { markRow(s, "another_take"); } }));
          if (ids.length > 1) {
            acts.push(h("button", { type: "button", cls: "btn text", disabled: st.busy, text: "Take off the plan",
              onclick: function () { save({ id: shoot.id, root_script_ids: ids.filter(function (x) { return x !== s.root_script_id; }) }, function () { return "Ad " + s.ad_id + " is off this shoot. It stays approved."; }); } }));
          }
        }
        return scriptRow(s, acts);
      }
      var off = !!st.off[s.root_script_id];
      acts.push(h("label", { cls: "on-plan" }, [
        h("input", { type: "checkbox", checked: !off, onchange: function (e) { st.off[s.root_script_id] = !e.target.checked; draw(); } }),
        "On the plan"
      ]));
      return scriptRow(s, acts, off ? "off" : null);
    }

    function checklist(shoot) {
      var id = shoot ? shoot.id : null;
      var done = readChecks(id);
      var box = h("div", { role: "group", "aria-label": "Before you roll" });
      CHECKS.forEach(function (c) {
        box.appendChild(h("label", { cls: "check" }, [
          h("input", { type: "checkbox", checked: !!done[c.key], onchange: function (e) { done[c.key] = e.target.checked; saveChecks(id, done); } }),
          c.label
        ]));
      });
      return h("section", { cls: "card" }, [h("div", { cls: "hd" }, [h("h2", { text: "Before you roll" }), h("span", { cls: "caption muted", text: "Saved on this device." })]), box]);
    }

    function shareCard(shoot) {
      var kids = [
        h("div", { cls: "hd" }, [h("h2", { text: "After filming" })]),
        h("p", { text: "Share all the clips to SLO Ads in one step: select them in Photos, tap Share, pick Drive, pick SLO Ads." }),
        h("div", { cls: "acts", style: "margin-top:16px" }, [h("a", { cls: "btn", href: DRIVE_SLO_ADS, target: "_blank", rel: "noopener", text: "Open SLO Ads in Drive" })])
      ];
      if (shoot.landed_unmatched > 0) kids.push(h("p", { cls: "say", text: plural(shoot.landed_unmatched, "clip", "clips") + " landed, matching." }));
      return h("section", { cls: "card" }, kids);
    }

    function boardCard(shoot) {
      var kids = [h("div", { cls: "hd" }, [h("h2", { text: "Where each clip is" })])];
      var rows = shoot.board || [];
      if (!rows.length) {
        kids.push(h("p", { cls: "muted", text: "No clips have landed yet. Share them to SLO Ads; they show here within 5 minutes." }));
      } else {
        var list = h("ul", { cls: "rows", "aria-label": "Progress board" });
        var anyStopped = false;
        rows.forEach(function (b) {
          if (b.step === "failed") anyStopped = true;
          list.appendChild(h("li", { cls: "row" }, [
            h("div", { cls: "nm", text: "Ad " + (b.ad_id || "?") + " · " + (b.angle || "Untitled") }),
            h("div", { cls: "chips" }, [chip(stepClass(b.step), b.step_word || b.step)]),
            h("div", { cls: "body" }, [
              b.reason ? h("span", { cls: "muted", text: b.reason }) : null,
              h("span", { cls: "caption muted", text: (b.needs_you ? "Needs you. " : "") + "Since " + azTime(ctx, b.since) + "." })
            ])
          ]));
        });
        kids.push(list);
        if (anyStopped) kids.push(h("p", { cls: "caption muted", text: "Retry, Assign and the hold choices are not on this page yet: they ship with the Videos tab." }));
      }
      kids.push(h("div", { cls: "apart" }, closeControls(shoot)));
      return h("section", { cls: "card", "aria-label": "Progress board" }, kids);
    }

    function closeControls(shoot) {
      var consequence = "Close this shoot? Scripts not marked Got it stay on the next plan.";
      var doClose = function () { save({ id: shoot.id, status: "done" }, function () { return "Shoot closed. Scripts not marked Got it are on the next plan."; }); };
      if (ctx && typeof ctx.confirm === "function") {
        return [h("button", { type: "button", cls: "btn text", disabled: st.busy, text: "Close the shoot", onclick: function () {
          var once = false;
          var run = function () { if (once) return; once = true; doClose(); };
          var out = ctx.confirm({ title: "Close the shoot", consequence: consequence, button: "Close it", onConfirm: run });
          if (out && typeof out.then === "function") out.then(function (yes) { if (yes === true) run(); });
        } })];
      }
      if (!st.confirmClose) {
        return [h("button", { type: "button", cls: "btn text", disabled: st.busy, text: "Close the shoot", onclick: function () { st.confirmClose = true; draw(); } })];
      }
      return [
        h("p", { role: "alert", text: consequence }),
        h("div", { cls: "acts" }, [
          h("button", { type: "button", cls: "btn", text: "Close it", onclick: function () { st.confirmClose = false; doClose(); } }),
          h("button", { type: "button", cls: "btn text", text: "Keep it open", onclick: function () { st.confirmClose = false; draw(); } })
        ])
      ];
    }

    function pastCard(past) {
      var list = h("ul", { cls: "rows" });
      past.forEach(function (p) {
        list.appendChild(h("li", { cls: "row" }, [
          h("div", { cls: "nm", text: azDay(p.shoot_date) }),
          h("div", { cls: "chips" }, [chip("on", plural(p.filmed, "filmed", "filmed")), chip(p.finished ? "on" : "", (p.finished || 0) + " finished")]),
          h("div", { cls: "body" }, [h("span", { cls: "caption muted", text: plural(p.scripts, "script", "scripts") + " planned, " + p.filmed + " marked Got it, " + (p.finished || 0) + " finished. Closed " + azTime(ctx, p.finished_at) + "." })])
        ]));
      });
      return h("section", { cls: "card" }, [h("div", { cls: "hd" }, [h("h2", { text: "Past shoots" })]), list]);
    }

    skeleton();
    return { load: load };
  }

  var mounted = null;
  (root.FundhubCC = root.FundhubCC || { _q: [], registerTab: function (t) { this._q.push(t); } }).registerTab({
    id: "shoot",
    label: "Shoot",
    order: 4,
    render: function (rootEl, ctx) { mounted = mount(rootEl, ctx); return mounted.load(); },
    refresh: function () { return mounted ? mounted.load() : undefined; },
    hide: function () {}
  });
})(typeof window !== "undefined" ? window : globalThis);
