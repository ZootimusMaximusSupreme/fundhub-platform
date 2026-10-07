/* FinanceOS — the client's one-page CRM for money (/app/financeos.html).
 *
 * Owner call 2026-10-06: "it all should be on 1 page". This file owns only the
 * frame: the header (client name, sandbox banner), the six tabs, the lazy
 * mount of each section, the api calls every section shares, and the sign-in
 * redirect. Each section is another file's
 *   window.FinanceOS.sections.<key> = { mount(el, ctx) → { reload } }
 * with ctx = { clientId, apiGet(path), apiPost(path, body) } and apiGet/apiPost
 * resolving to { status, body }.
 *
 * Rules kept here:
 *   - A tab mounts the first time it opens, never before.
 *   - The open tab lives in the address bar's #hash (#accounts), so a link or a
 *     refresh opens the same tab. Staff keep ?client_id= in front of it.
 *   - A section that is not loaded says "Coming soon" — no error, no blank.
 *   - This frame adds no number. The client name and the sandbox flag come
 *     from the same GET /api/money/overview the Overview tab paints, read once.
 *
 * Pure helpers are exported on window.FHFinanceOS so
 * src/http/financeos-screen.test.mjs can run them in Node.
 */
(function (root) {
  "use strict";

  var TABS = [
    ["overview", "Overview"], ["next", "Next steps"], ["helper", "Money helper"], ["transfers", "Money moves"], ["plan", "Plan"], ["banks", "Banks"], ["strategy", "Strategy"], ["fundability", "Fundability"], ["declines", "Applications"], ["alerts", "Alerts"], ["vault", "Funding papers"], ["accounts", "Accounts"], ["credit", "Credit"],
    ["connections", "Connections"], ["payments", "Payments"], ["setup", "Setup"]
  ];
  /* The old standalone pages, and the tab each one is now. A link inside a
     section to one of these switches tabs instead of leaving the page. */
  var PAGE_TAB = {
    "money.html": "overview", "money-next.html": "next", "money-helper.html": "helper", "money-transfers.html": "transfers", "money-plan.html": "plan", "money-banks.html": "banks", "money-strategy.html": "strategy", "money-fundability.html": "fundability", "money-declines.html": "declines", "money-alerts.html": "alerts", "money-vault.html": "vault", "money-accounts.html": "accounts", "money-credit.html": "credit",
    "money-connections.html": "connections", "money-payments.html": "payments", "money-setup.html": "setup"
  };
  var OVERVIEW = "/api/money/overview";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isTab(k) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === k) return true;
    return false;
  }
  function labelOf(k) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === k) return TABS[i][1];
    return "";
  }

  /* "#accounts" → "accounts". Anything else opens Overview. */
  function tabFromHash(hash) {
    var k = String(hash || "").replace(/^#/, "").toLowerCase();
    return isTab(k) ? k : "overview";
  }

  /* A link to an old money page, or to this page with a #tab, → that tab.
     Anything else (a checkout url, the portal) → "". */
  function tabForHref(href) {
    var h = String(href || "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.indexOf("//") === 0) return "";
    var parts = h.split("#");
    var file = parts[0].split("?")[0];
    if (file.charAt(0) === "/" && file.lastIndexOf("/app/", 0) !== 0) return "";
    file = file.slice(file.lastIndexOf("/") + 1);
    if (file === "" || file === "financeos.html") {
      var k = String(parts[1] || "").toLowerCase();
      return isTab(k) ? k : (file ? "overview" : "");
    }
    return PAGE_TAB[file] || "";
  }

  function renderComingSoon(label) {
    return '<div class="fos-soon"><h2>' + esc(label) + ': coming soon</h2>' +
      '<p>This part of FinanceOS is not ready yet. The other tabs work now.</p></div>';
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }

  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  function call(method, path, body) {
    var headers = { accept: "application/json" };
    var t = token();
    if (t) headers.authorization = "Bearer " + t;
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var started;
    try { started = root.fetch(path, init); } catch (e) { return Promise.resolve({ status: 0, body: null }); }
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; },
        function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }

  /* Same split money.js makes: clients get the mail-me-a-link page; staff (a
     cached staff role, or a ?client_id= in the bar) get the password page and
     come back to this same tab. */
  function signInUrl() {
    var role = "";
    try { role = root.localStorage.getItem("fh_role") || ""; } catch (e) {}
    var staffish = (role && role !== "client") || !!param("client_id");
    return staffish
      ? "/login.html?next=" + encodeURIComponent(root.location.pathname + root.location.search + root.location.hash)
      : "/portal-login.html";
  }

  function init() {
    var doc = root.document;
    var tabsEl = doc.querySelector(".fos-tabs");
    if (!tabsEl || !doc.getElementById("fos-overview")) return;
    var cid = param("client_id");
    var qs = cid ? "?client_id=" + encodeURIComponent(cid) : "";
    var leaving = false;
    var mounted = {};

    /* One 401 → one redirect, then nothing else paints. */
    function guard(p) {
      return Promise.resolve(p).then(function (res) {
        if (res && res.status === 401) {
          if (!leaving) { leaving = true; root.location.href = signInUrl(); }
          return new Promise(function () {});
        }
        return res;
      });
    }

    /* The header needs the overview read, and so does the Overview tab. Read
       it once: the first Overview mount takes this answer instead of asking
       again. */
    var firstOverview = guard(call("GET", OVERVIEW + qs));
    firstOverview.then(function (res) {
      var b = res && res.body;
      if (!b || b.ok !== true) return;
      var who = doc.getElementById("fos-client");
      if (who && b.client && b.client.name) {
        who.textContent = b.client.name;
        who.setAttribute("title", b.client.name);
      }
      if (b.sandbox === true) {
        var banner = doc.getElementById("fos-sandbox");
        if (banner) banner.hidden = false;
        doc.body.classList.add("fos-has-sandbox");
      }
    });

    var ctx = {
      clientId: cid,
      apiGet: function (path) {
        if (firstOverview && String(path).split("?")[0] === OVERVIEW) {
          var once = firstOverview;
          firstOverview = null;
          return once;
        }
        return guard(call("GET", path));
      },
      apiPost: function (path, body) { return guard(call("POST", path, body)); },
      onSignIn: function () { if (!leaving) { leaving = true; root.location.href = signInUrl(); } }
    };

    function panelOf(k) { return doc.getElementById("fos-" + k); }
    function tabOf(k) { return doc.getElementById("tab-" + k); }

    function mountTab(k) {
      var el = panelOf(k);
      var secs = root.FinanceOS && root.FinanceOS.sections;
      var sec = secs && secs[k];
      if (!sec || typeof sec.mount !== "function") {
        el.innerHTML = renderComingSoon(labelOf(k));
        mounted[k] = { soon: true };
        return;
      }
      /* An extra for this tab (window.FinanceOS.extras.<key>, e.g. the sales
         trend line from money-trends.js under Connections) gets its own box
         after the section's, so neither repaint can wipe the other. */
      var extras = root.FinanceOS && root.FinanceOS.extras;
      var extra = extras && extras[k] && typeof extras[k].mount === "function" ? extras[k] : null;
      var target = el;
      if (extra) {
        el.innerHTML = '<div class="fos-sec"></div><div class="fos-extra"></div>';
        target = el.firstChild;
      }
      try {
        mounted[k] = sec.mount(target, ctx) || {};
      } catch (e) {
        el.innerHTML = renderComingSoon(labelOf(k));
        mounted[k] = { soon: true };
        return;
      }
      if (extra) {
        try { extra.mount(el.lastChild, ctx); } catch (e) { el.lastChild.innerHTML = ""; }
      }
    }

    function show(k) {
      for (var i = 0; i < TABS.length; i++) {
        var key = TABS[i][0];
        var on = key === k;
        var t = tabOf(key);
        if (t) {
          t.setAttribute("aria-selected", on ? "true" : "false");
          if (on) t.removeAttribute("tabindex"); else t.setAttribute("tabindex", "-1");
        }
        var p = panelOf(key);
        if (p) p.hidden = !on;
      }
      if (!mounted[k]) mountTab(k);
      doc.title = "Fundhub — FinanceOS · " + labelOf(k);
      var cur = tabOf(k);
      if (cur && cur.scrollIntoView && tabsEl.scrollWidth > tabsEl.clientWidth) {
        try { cur.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
      }
    }

    function go(k) {
      if ("#" + k === root.location.hash) { show(k); return; }
      root.location.hash = k;
    }

    root.addEventListener("hashchange", function () { show(tabFromHash(root.location.hash)); });

    /* Arrow keys move along the tab bar (WAI-ARIA tabs pattern). */
    tabsEl.addEventListener("keydown", function (e) {
      var keys = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
      if (!(e.key in keys)) return;
      var at = 0;
      var now = tabFromHash(root.location.hash);
      for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === now) at = i;
      var step = keys[e.key];
      var next = step === "first" ? 0 : step === "last" ? TABS.length - 1 : (at + step + TABS.length) % TABS.length;
      e.preventDefault();
      go(TABS[next][0]);
      var t = tabOf(TABS[next][0]);
      if (t) t.focus();
    });

    /* A link inside a section to an old money page opens that tab here. */
    doc.querySelector("main").addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.target === "_blank") return;
      var k = tabForHref(a.getAttribute("href"));
      if (!k) return;
      e.preventDefault();
      go(k);
      if (root.scrollTo) root.scrollTo(0, 0);
    });

    var back = doc.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }

    show(tabFromHash(root.location.hash));
  }

  root.FHFinanceOS = {
    TABS: TABS, tabFromHash: tabFromHash, tabForHref: tabForHref, renderComingSoon: renderComingSoon
  };

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
