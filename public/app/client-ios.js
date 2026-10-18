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
      sampleText.textContent = session.portal_sample ? 'Sample view · Fictional data' : 'Your real account · Original records';
      sampleText.title = session.portal_sample ? 'Fictional sample data. Referral activity still uses your real account.' : 'Your original records and actions.';
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
    nav.innerHTML = '<a class="client-ios-brand" href="/app/client-portal.html" aria-label="Client portal home"><span class="client-ios-brand-logo" aria-hidden="true"></span></a><div class="client-ios-nav-label">Your workspace</div><div class="client-ios-links"></div><div class="client-ios-nav-foot">Your team. Your progress.<br>Always within reach.</div>';
    var links = nav.querySelector(".client-ios-links");
    var routes = [
      ["/app/client-portal.html", "Home", "M3 10 12 3l9 7v11h-6v-7H9v7H3Z"],
      ["/progress.html", "Progress", "M4 18 10 12l4 3 6-10M15 5h5v5"],
      ["/app/financeos.html", "Money", "M3 6h18v14H3ZM3 10h18M15 15h3", "money"],
      ["/app/client-portal.html?view=documents#acct", "Documents", "M6 3h8l4 4v14H6ZM14 3v5h5M9 12h6M9 16h6", "documents"],
      ["/app/affiliate.html", "Referrals", "M5 19 19 5M9 5h10v10", "affiliate"]
    ];
    routes.forEach(function (r, i) {
      var a = document.createElement("a");
      a.href = r[0];
      a.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' + r[2] + '"></path></svg><span></span>';
      a.querySelector("span").textContent = r[1];
      var view = new URLSearchParams(location.search).get("view");
      var onDocuments = location.pathname === "/app/client-portal.html" && /^(documents|agreements)$/.test(view || "");
      if ((location.pathname === r[0] && !(i === 0 && onDocuments)) ||
          (r[3] === "money" && /\/money[^/]*\.html$/.test(location.pathname)) ||
          (r[3] === "documents" && onDocuments)) a.setAttribute("aria-current", "page");
      if (r[3] === "money") a.setAttribute("aria-label", "Money · FinanceOS");
      if (r[3] === "affiliate") { affiliateLink = a; a.hidden = true; a.setAttribute("aria-label", "Affiliate Dashboard"); }
      links.appendChild(a);
    });
    body.appendChild(nav);
    // Older Money URLs remain usable pages. Give every one the same complete
    // section picker rather than a different short, horizontally hidden menu.
    if (/\/app\/money(?:-[^/]*)?\.html$/.test(location.pathname)) {
      var localNav = body.querySelector('.mnav');
      if (localNav) {
        var moneyGroups = [
          ['Your money', [['money','Overview'],['money-accounts','Accounts'],['money-connections','Connections'],['money-payments','Payments'],['money-transfers','Money moves']]],
          ['Credit & funding', [['money-credit','Credit'],['money-fundability','Fundability'],['money-declines','Applications'],['money-banks','Banks'],['money-next','Next steps'],['money-plan','Funding plan'],['money-strategy','Payment strategy']]],
          ['Tools & documents', [['money-helper','Money helper'],['money-alerts','Alerts'],['money-vault','Funding papers'],['money-setup','Setup']]]
        ];
        var jumpLabel = document.createElement('label');
        jumpLabel.className = 'client-money-jump';
        var jumpText = document.createElement('span');
        jumpText.textContent = 'Money section';
        var jump = document.createElement('select');
        jump.setAttribute('aria-label', 'Money section');
        moneyGroups.forEach(function (group) {
          var optgroup = document.createElement('optgroup');
          optgroup.label = group[0];
          group[1].forEach(function (section) {
            var option = document.createElement('option');
            option.value = '/app/' + section[0] + '.html';
            option.textContent = section[1];
            option.selected = location.pathname === option.value;
            optgroup.appendChild(option);
          });
          jump.appendChild(optgroup);
        });
        jump.addEventListener('change', function () { location.assign(jump.value); });
        jumpLabel.appendChild(jumpText); jumpLabel.appendChild(jump);
        var frameLink = document.createElement('a');
        frameLink.className = 'client-money-frame';
        var sectionKey = location.pathname.split('/').pop().replace(/^money-?/, '').replace(/\.html$/, '') || 'overview';
        frameLink.href = '/app/financeos.html#' + sectionKey;
        frameLink.textContent = 'Money workspace ↗';
        frameLink.setAttribute('aria-label', 'Open Money workspace');
        localNav.replaceChildren(jumpLabel, frameLink);
        frameLink.classList.add('client-ios-workspace-link');
        localNav.classList.add('client-money-navigation');
        localNav.setAttribute('aria-label', 'Money sections');
      }
    }
    var header = body.querySelector("header.topbar,header.mbar,.main>.topbar,header");
    if (header) {
      // Keep page-owned identities and IDs for their real data updates. The
      // verified client gets one common workspace header on every surface.
      var originalHeader = header;
      if (location.pathname === '/progress.html') {
        header = document.createElement('div');
        originalHeader.parentNode.insertBefore(header, originalHeader);
        originalHeader.classList.add('client-ios-page-intro');
      } else {
        var legacy = document.createElement('div');
        legacy.className = 'client-ios-header-legacy';
        legacy.hidden = true;
        while (header.firstChild) legacy.appendChild(header.firstChild);
        header.appendChild(legacy);
      }
      header.classList.add('client-ios-header');
      var locationLabel = document.createElement('span');
      locationLabel.className = 'client-ios-location';
      var area = /\/(?:money[^/]*|financeos)\.html$/.test(location.pathname) ? 'Money' : /affiliate\.html$/.test(location.pathname) ? 'Referrals' : location.pathname === '/progress.html' ? 'Progress' : 'Your workspace';
      locationLabel.textContent = area;
      var tools = document.createElement('div');
      tools.className = 'client-ios-header-tools';
      var account = document.createElement('details');
      account.className = 'client-ios-account';
      var accountSummary = document.createElement('summary');
      accountSummary.setAttribute('aria-label', 'Account');
      var accountIcon = document.createElement('span');
      accountIcon.className = 'client-ios-account-icon';
      accountIcon.setAttribute('aria-hidden', 'true');
      accountIcon.textContent = String(session.staff && session.staff.name || 'Account').trim().charAt(0).toUpperCase();
      var accountLabel = document.createElement('span');
      accountLabel.textContent = 'Account';
      accountSummary.append(accountIcon, accountLabel);
      var accountPanel = document.createElement('div');
      accountPanel.className = 'client-ios-account-panel';
      var accountName = document.createElement('p');
      accountName.className = 'client-ios-account-name';
      accountName.textContent = session.staff && session.staff.name || 'Your account';
      accountPanel.appendChild(accountName);
      var back = document.getElementById('money-back');
      if (back) accountPanel.appendChild(back);

      var license = document.getElementById('affLicenseChip');
      if (license) accountPanel.appendChild(license);
      account.append(accountSummary, accountPanel);
      tools.appendChild(account);
      var mobileBrand = document.createElement('a');
      mobileBrand.className = 'client-ios-mobile-brand';
      mobileBrand.href = '/app/client-portal.html';
      mobileBrand.setAttribute('aria-label', 'Open portal home');
      var mobileLogo = document.createElement('span');
      mobileLogo.className = 'client-ios-mobile-logo';
      mobileLogo.setAttribute('aria-hidden', 'true');
      mobileBrand.appendChild(mobileLogo);
      header.append(mobileBrand, locationLabel, tools);
      function dockChat() {
        var fab = document.getElementById('fh-chat-fab');
        if (fab && fab.parentElement !== tools) {
          tools.insertBefore(fab, account);
          fab.addEventListener('click', function () { account.open = false; });
          var close = document.getElementById('fh-chat-close');
          if (close) close.addEventListener('click', function () { fab.focus(); });
        }
      }
      dockChat();
      // Money and root progress pages deliberately do not load the staff shell.
      // Reuse its real client-only chat rather than creating a second chat flow.
      if (!document.querySelector('script[src$="shell.js"]') && !window.FHChat) {
        var chatScript = document.createElement('script');
        chatScript.src = '/app/chat-widget.js';
        chatScript.async = true;
        chatScript.onload = function () {
          if (window.FHChat && !document.getElementById('fh-chat-fab')) {
            window.FHChat.mount({portal:true,hadCall:!!(session.staff && session.staff.had_call),autoOpenPrecall:false});
            dockChat();
          }
        };
        document.head.appendChild(chatScript);
      }
      new MutationObserver(dockChat).observe(body, {childList:true, subtree:true});
      document.addEventListener('click', function (event) {
        if (account.open && !account.contains(event.target)) account.open = false;
      });
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (account.open) { account.open = false; accountSummary.focus(); }
        var chatPanel = document.getElementById('fh-chat-panel');
        var chatClose = document.getElementById('fh-chat-close');
        if (chatPanel && chatPanel.classList.contains('open') && chatClose) { event.preventDefault(); chatClose.click(); }
      });
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
      accountPanel.appendChild(out);
    }
    refreshAffiliate();
    window.addEventListener("focus", refreshAffiliate);
    window.addEventListener("pageshow", refreshAffiliate);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshAffiliate(); });
  });
})();
