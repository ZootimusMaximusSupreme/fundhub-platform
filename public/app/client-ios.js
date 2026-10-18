/* Presentation only. Every data/action API still verifies the real session. */
(function () {
  "use strict";
  var body = document.body;
  if (!body || !body.hasAttribute("data-client-page")) return;
  var client = false;
  var affiliateLink;
  function token() { try { return localStorage.getItem("fh_token") || ""; } catch (_) { return ""; } }
  function read(path) {
    var headers = { accept: "application/json" }, t = token();
    if (t) headers.authorization = "Bearer " + t;
    return fetch(path, { headers: headers, credentials: "same-origin" }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }
  function refreshAffiliate() {
    if (!client || !affiliateLink) return Promise.resolve(false);
    return read("/api/read/affiliate-portal").then(function (d) {
      var enrolled = !!(d && d.ok === true && d.enrolled === true && d.affiliate && d.affiliate.id);
      affiliateLink.hidden = !enrolled;
      return enrolled;
    });
  }
  window.FHClientIOS = { refreshAffiliate: refreshAffiliate };
  function activate() { body.setAttribute("data-client-ios", ""); }
  if (body.hasAttribute("data-client-public")) { activate(); body.setAttribute("data-client-ready", ""); return; }
  read("/api/auth/session").then(function (session) {
    body.setAttribute("data-client-ready", "");
    if (!session || session.ok !== true || session.principal !== "client") return;
    client = true;
    activate();
    if (session.portal_sample_available === true && !/\/affiliate\.html$/.test(location.pathname)) {
      var sampleBar = document.createElement('aside');
      sampleBar.className = 'client-ios-sample';
      sampleBar.setAttribute('aria-label', 'Account data view');
      var sampleText = document.createElement('span');
      sampleText.textContent = session.portal_sample ? 'Sample view · Fictional data. Referral activity stays real.' : 'Your real account · Original records and actions';
      var sampleSwitch = document.createElement('button');
      sampleSwitch.type = 'button';
      sampleSwitch.textContent = session.portal_sample ? 'View real account' : 'View samples';
      sampleSwitch.addEventListener('click', function () {
        document.cookie = 'fh_portal_data=' + (session.portal_sample ? 'real' : 'sample') + '; Path=/; SameSite=Lax';
        location.reload();
      });
      sampleBar.appendChild(sampleText); sampleBar.appendChild(sampleSwitch);
      var sampleHost = body.querySelector('#portal-home .page') || body.querySelector('main,.main,.money-main,.wrap') || body;
      sampleHost.classList.add('client-ios-sample-host');
      sampleHost.insertBefore(sampleBar,sampleHost.firstChild);
    }
    body.setAttribute("data-client-nav", "");
    var nav = document.createElement("nav");
    nav.className = "client-ios-nav";
    nav.setAttribute("aria-label", "Client portal");
    nav.innerHTML = '<a class="client-ios-brand" href="/app/client-portal.html"><span class="client-ios-mark" aria-hidden="true">f.</span>fundhub</a><div class="client-ios-nav-label">Your workspace</div><div class="client-ios-links"></div><div class="client-ios-nav-foot">Your file. Your next step.<br>All in one place.</div>';
    var links = nav.querySelector(".client-ios-links");
    var routes = [
      ["/app/client-portal.html", "Home", "M3 10 12 3l9 7v11h-6v-7H9v7H3Z"],
      ["/progress.html", "Progress", "M4 18 10 12l4 3 6-10M15 5h5v5"],
      ["/app/financeos.html", "FinanceOS", "M3 6h18v14H3ZM3 10h18M15 15h3"],
      ["/app/affiliate.html", "Affiliate Dashboard", "M5 19 19 5M9 5h10v10"]
    ];
    routes.forEach(function (r, i) {
      var a = document.createElement("a");
      a.href = r[0];
      a.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' + r[2] + '"></path></svg><span></span>';
      a.querySelector("span").textContent = r[1];
      if (location.pathname === r[0] || (i === 2 && /\/money[^/]*\.html$/.test(location.pathname))) a.setAttribute("aria-current", "page");
      if (i === 3) { affiliateLink = a; a.hidden = true; }
      links.appendChild(a);
    });
    body.appendChild(nav);
    var header = body.querySelector("header.topbar,header.mbar,.main>.topbar,header");
    if (header) {
      var out = document.createElement("button");
      out.type = "button";
      out.className = "client-ios-signout";
      out.textContent = "Sign out";
      out.addEventListener("click", function () {
        var existing = document.getElementById("fh-shell-out");
        if (existing) { existing.click(); return; }
        out.disabled = true;
        out.textContent = "Signing out…";
        var headers = { accept: "application/json" }, t = token();
        if (t) headers.authorization = "Bearer " + t;
        fetch("/api/auth/logout", { method: "POST", headers: headers, credentials: "same-origin" }).then(function (r) {
          if (!r.ok) throw new Error("logout_failed");
          ["fh_token", "fh_account", "fh_role", "fh_demo", "fh_demo_staff"].forEach(function (key) { try { localStorage.removeItem(key); } catch (_) { /* cookie remains server-owned */ } });
          location.replace("/portal-login.html");
        }).catch(function () {
          out.disabled = false;
          out.textContent = "Retry sign out";
          var message = body.querySelector(".client-ios-session-error");
          if (!message) { message = document.createElement("p"); message.className = "client-ios-session-error"; message.setAttribute("role", "alert"); header.insertAdjacentElement("afterend", message); }
          message.textContent = "We could not confirm sign-out. Check your connection and try again.";
        });
      });
      header.appendChild(out);
    }
    refreshAffiliate();
    window.addEventListener("focus", refreshAffiliate);
    window.addEventListener("pageshow", refreshAffiliate);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshAffiliate(); });
  });
})();
