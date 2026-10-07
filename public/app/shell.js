/* Fundhub CRM shell — auth + role gating over the wireframe suite.
   The screens are the product; this file only decides who sees which tabs.
   Session: real API first, demo session (set by /login.html) as fallback.
   Change who sees what in ROLE_TABS — one map, nothing else to edit.

   This file runs from <head>, before the screen paints, and that placement is
   load-bearing. It used to run as the last script in <body>: a screen the role
   may not open was parsed, painted and only then bounced away, once the session
   fetch came back. That is the "it opens the page and then throws me back"
   behaviour. With a cached role the gate still decides first. Without one we
   no longer blank the whole page waiting on the network (owner-set 2026-08-05)
   — nav stays hidden and clicks stay blocked until the session answers. */
(function () {
  // "" when the URL is /app/ — the router page, which is not a screen and is
  // never in ALL. Anything not in the role's list gets sent to its home.
  var PAGE = location.pathname.split("/").pop();

  /* Single source of truth for "not on the money path yet": every screen here
     gets a BETA badge on its nav row (mountSidebar) and a dismissible banner
     on the page itself (mountBetaBanner). Add or remove a screen by editing
     this one list — nothing else to touch, no per-page edits. */
  var BETA_PAGES = [];

  /* ==SIDEBAR_HTML_START== */
  var SIDEBAR_HTML = "<aside class=\"side\" id=\"side\">\n  <div class=\"side-top\"><a class=\"logo inv\" href=\"pipeline.html\" aria-label=\"fundhub\"></a><button class=\"burger\" id=\"burger\" type=\"button\" title=\"Collapse sidebar\">‹‹</button></div>\n  <nav class=\"side-scroll\" id=\"fh-side-nav\">\n\n<div class=\"navgroup\" data-fh-section=\"home\"><button class=\"navhead\" type=\"button\">Home<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"partner-galaxy.html\"><span class=\"ico\">⌂</span><span class=\"lbl\">Home</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"sales\"><button class=\"navhead\" type=\"button\">Sales<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"pipeline.html\"><span class=\"ico\">▤</span><span class=\"lbl\">Pipeline</span></a>\n        <a class=\"navitem\" href=\"closer-dashboard.html\"><span class=\"ico\">★</span><span class=\"lbl\">Closer Dashboard</span></a>\n        <a class=\"navitem\" href=\"my-numbers.html\"><span class=\"ico\">＃</span><span class=\"lbl\">My numbers</span></a>\n        <a class=\"navitem\" href=\"sales-floor.html\"><span class=\"ico\">▣</span><span class=\"lbl\">Sales floor</span></a>\n        <a class=\"navitem\" href=\"calendar.html\"><span class=\"ico\">▦</span><span class=\"lbl\">Calendar</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"funding\"><button class=\"navhead\" type=\"button\">Funding<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"lenders.html\"><span class=\"ico\">⬡</span><span class=\"lbl\">Lenders</span></a>\n        <a class=\"navitem\" href=\"client-control-panel.html\"><span class=\"ico\">◎</span><span class=\"lbl\">Client Control Panel</span></a>\n        <a class=\"navitem\" href=\"finance-os.html\"><span class=\"ico\">▩</span><span class=\"lbl\">Finance OS</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"client-ops\"><button class=\"navhead\" type=\"button\">Client ops<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"csm-queue.html\"><span class=\"ico\">☎</span><span class=\"lbl\">Client Success</span></a>\n        <a class=\"navitem\" href=\"consent-capture.html\"><span class=\"ico\">☑</span><span class=\"lbl\">Consent</span></a>\n        <a class=\"navitem\" href=\"messaging.html\"><span class=\"ico\">✉</span><span class=\"lbl\">Messaging</span></a>\n        <a class=\"navitem\" href=\"documents.html\"><span class=\"ico\">▧</span><span class=\"lbl\">Documents</span></a>\n        <a class=\"navitem\" href=\"inquiry-remover.html\"><span class=\"ico\">⊘</span><span class=\"lbl\">Specialist</span></a>\n        <a class=\"navitem\" href=\"company-brain.html\"><span class=\"ico\">◎</span><span class=\"lbl\">Company Brain</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"watch\"><button class=\"navhead\" type=\"button\">Watch<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"galaxy.html\"><span class=\"ico\">✷</span><span class=\"lbl\">Galaxy</span></a>\n        <a class=\"navitem\" href=\"ops-admin.html\"><span class=\"ico\">⚙</span><span class=\"lbl\">Ops &amp; Admin</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"automation\"><button class=\"navhead\" type=\"button\">Automation<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"agent-editor.html\"><span class=\"ico\">◈</span><span class=\"lbl\">Agent Editor</span></a>\n        <a class=\"navitem\" href=\"automations.html\"><span class=\"ico\">⇄</span><span class=\"lbl\">Workflows</span></a>\n        <a class=\"navitem\" href=\"journeys.html\"><span class=\"ico\">⇝</span><span class=\"lbl\">Journeys</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"marketing\"><button class=\"navhead\" type=\"button\">Marketing<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"marketing-command-center.html\"><span class=\"ico\">⚑</span><span class=\"lbl\">Command Center</span></a>\n        <a class=\"navitem\" href=\"campaign-manager.html\"><span class=\"ico\">◇</span><span class=\"lbl\">Campaigns</span></a>\n        <a class=\"navitem\" href=\"social-studio.html\"><span class=\"ico\">◉</span><span class=\"lbl\">Social Studio</span></a>\n        <a class=\"navitem\" href=\"creative-factory.html\"><span class=\"ico\">✳</span><span class=\"lbl\">Creative Factory</span></a>\n        <a class=\"navitem\" href=\"content-admin.html\"><span class=\"ico\">▭</span><span class=\"lbl\">Content</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"admin\"><button class=\"navhead\" type=\"button\">Admin<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"staff-teams.html\"><span class=\"ico\">⚇</span><span class=\"lbl\">Staff &amp; Teams</span></a>\n        <a class=\"navitem\" href=\"hiring.html\"><span class=\"ico\">⊕</span><span class=\"lbl\">Hiring</span></a>\n        <a class=\"navitem\" href=\"products-commissions.html\"><span class=\"ico\">⛁</span><span class=\"lbl\">Products &amp; Commissions</span></a>\n        <a class=\"navitem\" href=\"contracts.html\"><span class=\"ico\">✒</span><span class=\"lbl\">Contract templates</span></a>\n        <a class=\"navitem\" href=\"brand-studio.html\"><span class=\"ico\">◆</span><span class=\"lbl\">Brand Studio</span></a>\n</div></div>\n\n<div class=\"navgroup\" data-fh-section=\"portals\"><button class=\"navhead\" type=\"button\">Portals<span class=\"chev\">▾</span></button><div class=\"navlist\">\n        <a class=\"navitem\" href=\"client-portal.html\"><span class=\"ico\">◐</span><span class=\"lbl\">Client Portal</span></a>\n        <a class=\"navitem\" href=\"affiliate.html\"><span class=\"ico\">⇗</span><span class=\"lbl\">Affiliate</span></a>\n</div></div>\n\n  </nav>\n  <div class=\"side-foot\"><span class=\"pulse\"></span><span class=\"who\">fundhub</span></div>\n</aside>";
  /* ==SIDEBAR_HTML_END== */

  var ALL = [
    "closer-dashboard.html", "my-numbers.html", "sales-floor.html",
    "pipeline.html", "client-control-panel.html",
    "messaging.html", "calendar.html", "documents.html", "company-brain.html",
    "ops-admin.html", "galaxy.html",
    "agent-editor.html", "automations.html", "products-commissions.html",
    "staff-teams.html",
    /* The CSM's own desk. /api/read/csm-queue has always returned their day —
       who to call, what they owe, what they already have — and until
       2026-09-17 no page in the app had ever asked it for anything, so the
       role's home was the pick-a-client Client Control Panel and the queue was
       invisible (live walk, GAP 34). It stays on the shared STAFF rail rather
       than getting a CSM-only list: the endpoint gates on ROLE_SETS.STAFF, so
       every staff role can genuinely use the row and none of them gets a 403
       (UI-STANDARDS §4). */
    "csm-queue.html",
    "inquiry-remover.html", "affiliate.html", "client-portal.html", "partner-galaxy.html", "brand-studio.html",
    /* The $10,000 curriculum (docs/specs/W7-curriculum.md). A partner screen,
       reachable by URL, offered by no sidebar — see PRINCIPAL_ONLY below. */
    "partner-training.html",
    "campaign-manager.html", "social-studio.html", "creative-factory.html", "hiring.html",
    /* The Marketing Command Center (docs/specs/marketing-machine-2026-10-04.md
       §8.3, slice 1 in docs/specs/marketing-dashboard-plan-2026-10-05.md).
       Owner/admin only — see OWNER_ADMIN_ONLY below — because GET
       marketing/today gates on owner and admin. First row of the Marketing
       group in sidebar.fragment.html. */
    "marketing-command-center.html",
    /* Finance OS is one screen now, not twelve. money-map.html,
       banking-surface.html, card-stack.html, bank-accounts.html,
       bills-cashflow.html, banking-entry.html, finance-command.html and
       finance-add.html — the six-screen write surface plus the two read-only
       roll-ups that came after it — are gone. finance-os.html absorbed all of
       it: one client's whole money picture, read from
       read/money-map, read/underwrite and finance/alerts live, with the same
       /api/finance/* writes those six screens used wired directly into it.
       An owner decision, not a regression — src/http/app-nav-reachability
       .test.mjs no longer has eleven Finance rows to account for, it has one. */
    "finance-os.html",
    /* journeys.html is the SMS/email/pipeline automation editor — it writes
       live message copy and stage wiring, so it is owner/admin only (see
       OWNER_ADMIN_ONLY below). Same treatment as every other addition on
       this list: in ALL, and therefore in every sidebar. */
    "journeys.html",
    /* template-editor.html (Message Copy) — REMOVED 2026-08-21 owner
       decommission. Screen deleted. message-templates APIs stay for send. */
    /* contracts.html is the owner/admin contract-wording library. Ordinary
       staff still send contracts from the client flow; they do not open the
       screen that creates, uploads or changes the wording. */
    "contracts.html",
    /* lenders.html — funding advisor maintenance surface for the seven spreadsheet
       lender product tables (+ bureau mismatch review). ROLE_SETS.LENDERS at
       the API — owner, admin, funding_advisor — narrowed from ROLE_SETS.STAFF
       by owner decision 2026-08-17: the Lenders list is the funding advisor's
       and the owner's, and nobody else sees or touches it.

       MOVE A GATE AND MOVE ITS ROW. The gate moved in src/http/read-api.mjs,
       so the row moved with it — see ADVISOR_ONLY below, which is what keeps
       closer / setter / inquiry_specialist / sales_manager from being offered
       a screen whose API now 403s them. Lives under the Funding sidebar
       group. */
    "lenders.html",
    /* content-admin.html is the screen that edits the client portal's tiles and
       its welcome video. It was built, wired and routed
       (netlify/functions/api.mjs routes content/tiles and content/upload) and then
       left out of this array, so the guard in pass 2 bounced EVERY role —
       including the owner — to their home about 0.1s after the page painted.
       Nobody could use the upload box, the save buttons or the portal-tile
       switches. Proven live on https://fundhub.ai 2026-08-18 as owner.

       Its reads are ROLE_SETS.OPS (owner, admin) — api/content/tiles.mjs, whose
       own comment already named the Content nav item as its audience before
       any such row existed. So it goes in OWNER_ADMIN_ONLY below and gets a
       Content row under Marketing. Partners keep no Content row:
       ROLE_TABS.partner is an explicit array, which never consults this list —
       docs/journeys/white-label-intended.md — Content Admin is not this. */
    "content-admin.html",
    /* consent-capture.html is where staff record a client's permission before a
       credit pull. Same defect, higher stakes: it was absent from this array, so
       it bounced everyone, and no screen in the CRM linked to it either
       (grep public/ found only comments). A closer could not reach the page that
       records the consent requestSoftPull() refuses to run without.

       Its gate is NARROWER than the shared staff surface —
       api/consent/capture.mjs CONSENT_ROLES = owner, admin, closer,
       funding_advisor — so it is not on staffTabs(). See CONSENT_DESK_ONLY
       below, which is that set expressed as a nav list. */
    "consent-capture.html"
  ];

  /* Screens that are not part of the shared employee rail. partner-galaxy is
     deliberately unlinked for staff (employees use galaxy.html). brand-studio
     is a partner brand tool — owner/admin still reach it via "*".
     partner-training is the partner's own classroom (docs/specs/W7-curriculum.md);
     staff record against it through /api/training-progress, not through this
     screen, so no employee sidebar links to it either. */
  var PRINCIPAL_ONLY = ["partner-galaxy.html", "brand-studio.html", "partner-training.html"];

  /* NOT PART OF THE SHARED STAFF SURFACE — waiting on a human approval, not on
     a nav decision, or gated narrower than STAFF at the API itself.

     finance-os.html is DELIBERATELY NOT in this list, even though it now reads
     and writes several things that individually gate on ROLE_SETS.FINANCE
     (adding a bank account, editing a bill, saving cash-flow thresholds,
     changing an alert trigger). Most of what it shows — read/money-map,
     read/underwrite, finance/liabilities, finance/alerts' queue, finance/model —
     is ROLE_SETS.STAFF, the same set that already reads a client's tradelines
     everywhere else in this app, so the SCREEN stays on the shared staff
     surface and the finance-os.html wiring itself hides the FINANCE-only
     controls (Load sample data, add/edit an account, edit a bill, save cash-
     flow settings, change a trigger) from anyone who is not owner or admin —
     matching this list's own rule one level down, inside a single screen
     instead of across several.

     subscriptions.html IS here, unchanged by the Finance OS consolidation.
     /api/finance/subscriptions and /api/finance/cards both gate on
     ROLE_SETS.FINANCE — a subscription row carries a price and a payment
     instrument, which is the narrowest thing that API serves. It moved to the
     Setup group in the sidebar (next to products-commissions.html, since this
     is Fundhub billing the client rather than the client's own money), but the
     role gate that put it here never changed.

     MOVE A GATE AND MOVE ITS ROW. If a build agent widens or narrows a role set
     in api/finance/*, this list has to follow in the same commit, or the app
     goes back to offering screens that 403. */
  var OWNER_ADMIN_ONLY = [
    /* journeys.html — api/journeys/ask.mjs and api/journeys/store.mjs both
       gate on requireRole("owner", "admin"); the nav row matches. */
    "journeys.html",
    "contracts.html",
    /* Beta screens stay off the shared STAFF rail (owner decision 2026-08-17).
       This list is subtracted inside staffTabs() and NOWHERE ELSE, so it says
       nothing about the three principal roles, whose ROLE_TABS entries are
       explicit arrays. social-studio.html and creative-factory.html have been in
       both this list and ROLE_TABS.partner since the commit that wrote the
       decision. The sentence that
       used to sit here claimed staff, partners and affiliates all miss these
       rows; that was never true of partners — corrected rather than deleted so
       the next reader does not re-derive it. */
    "campaign-manager.html",
    /* marketing-command-center.html — GET marketing/today is owner/admin only
       (ROLE_SETS.MARKETING), so the row matches the gate. */
    "marketing-command-center.html",
    "galaxy.html",
    "finance-os.html",
    "company-brain.html",
    "social-studio.html",
    "creative-factory.html",
    "agent-editor.html",
    /* ops-admin.html — its reads are owner/admin (failed-events is ROLE_SETS.OPS)
       or finance (staff, invoices). Every non-owner who opened it got a 403
       and a sample footer that blamed "not signed in". Hide the row. Do not
       widen those gates. (Fable board 2026-08-16, restamp 2026-08-17.) */
    "ops-admin.html",
    /* content-admin.html — /api/content/tiles and /api/content/upload both gate
       on ROLE_SETS.OPS (owner, admin), so the row matches the gate exactly. */
    "content-admin.html"
  ];

  /* Screens whose reads are ROLE_SETS.FINANCE (owner, admin, sales_manager).
     staff-teams calls /api/read/staff; products-commissions calls
     /api/read/commissions. Closer / advisor / inquiry got 403 and a
     "not signed in" footer while signed in. Nav matches the gate. */
  var FINANCE_ONLY = [
    "staff-teams.html",
    "products-commissions.html"
  ];

  /* Closer desk — personal numbers. The call tools now live on the shared
     Closer Dashboard, so My numbers is the only closer-only extra row. */
  var CLOSER_DESK_ONLY = ["my-numbers.html"];

  /* Sales floor — manager roll-up. Same pattern: in every sidebar, visible to
     sales_manager (and owner/admin via "*"). Matches ROLE_SETS.FINANCE at the
     /api/read/sales-floor gate. */
  var SALES_FLOOR_ONLY = ["sales-floor.html"];

  /* External principal portals — not an employee desk. ROLE_TABS.client /
     .affiliate name the only openers; staffTabs() drops them. */
  var PORTAL_ONLY = ["client-portal.html", "affiliate.html"];

  /* ROLE_SETS.HIRING — applicant PII. owner/admin only (via "*" or this list
     added for those roles — "*" already covers owner/admin). */
  var HIRING_ONLY = ["hiring.html"];

  /* Lender database — the funding advisor's maintenance surface. Same pattern:
     in every sidebar, visible to funding_advisor (and owner/admin via "*").
     Matches ROLE_SETS.LENDERS at the /api/read/lenders gate — owner, admin,
     funding_advisor. Closer / setter / inquiry_specialist / sales_manager lost
     the row because they lost the data (owner decision 2026-08-17). */
  var ADVISOR_ONLY = ["lenders.html"];

  /* The client's money pages (FinanceOS, 2026-10-06), for the staff who may
     read a client's money: owner, admin, sales_manager — ROLE_SETS.FINANCE,
     the gate on api/money/overview.mjs and api/money/setup.mjs. NOT in ALL on
     purpose: no sidebar row opens them and they load no shell.js. This list
     only stops gateLinks() hiding the portal's FinanceOS card from those three
     when they open a client's portal. Navigation, not a gate. */
  var STAFF_MONEY = ["financeos.html", "money.html", "money-accounts.html", "money-credit.html",
    "money-connections.html", "money-payments.html", "money-setup.html", "money-plan.html", "money-banks.html",
    "money-strategy.html", "money-fundability.html", "money-next.html", "money-transfers.html"];

  /* Consent desk — the credit-pull permission screen. api/consent/capture.mjs
     gates on CONSENT_ROLES = owner, admin, closer, funding_advisor, and that
     set has to stay identical to SOFT_PULL_ROLES in api/finance/soft-pull.mjs
     (capture.mjs says so in its own comment). No list already here has that
     shape: CLOSER_DESK_ONLY drops the funding advisor, ADVISOR_ONLY drops the
     closer. So this is a new list rather than a reused one.

     MOVE A GATE AND MOVE ITS ROW. Widen or narrow CONSENT_ROLES and this list
     moves with it in the same commit, or the rail offers a screen whose save
     button 403s the person looking at it. setter, inquiry_specialist and
     sales_manager are the three roles the API refuses, and they are exactly the
     three staffTabs() drops it for. */
  var CONSENT_DESK_ONLY = ["consent-capture.html"];

  /* Screens an admin may not open. A star used to mean literally every screen, and
     that produced two proven defects at once (live walk 2026-08-18, evidence in
     ops/workflows/fix-2026-08-18/evidence/T0/before/admin.json):

       1. The admin's rail carried a Client Portal row, and clicking it opened a
          client's own portal page. PORTAL_ONLY right above says "not an employee
          desk ... ROLE_TABS.client / .affiliate name the only openers — but
          that list is subtracted inside staffTabs(), and the star branch never
          calls staffTabs(). So the sentence was already untrue for admin.
       2. Partner Home was HIDDEN from the admin's rail — gateLinks() refuses
          that row to every non-partner — and yet opened when the address was
          typed, because allowedFor() had never heard of the same rule. Hiding a
          row is not blocking a page. Those were two gates disagreeing.

     Both close with one filter, because allowedFor() is the only producer of
     the ok list that gateLinks() and BOTH bounce checks read.

     OWNER IS DELIBERATELY NOT TREATED THE SAME. Asked and answered:
     OWNER-SET 2026-08-18 — "leave owner alone, keep the owner walk. Admin
     blocked is correct." Settled; do not re-raise it. shell.js's own mountChatWidget comment
     and client-portal.html's STAFF_ROLES were written for an "owner walk" of a
     client's portal, so removing it from the owner would delete a documented
     feature on an agent's judgment. The two audit findings both name admin.
     brand-studio.html is deliberately absent: PRINCIPAL_ONLY records owner and
     admin keeping it via the star, and no finding disputes that.

     Written out as a plain array rather than PORTAL_ONLY.concat(...) so
     src/http/app-nav-reachability.test.mjs can lift it — that file reads this
     one as TEXT and only understands a literal. The test asserts this list
     still contains all of PORTAL_ONLY, so the two cannot drift apart. */
  var ADMIN_BLOCKED = ["client-portal.html", "affiliate.html", "partner-galaxy.html"];

  /* NAV_HIDDEN — leave the menu, keep the URL.
     Owner-set 2026-08-19 kill pass. These screens stay in ALL and in
     allowedFor(), so typing the address still opens them. gateLinks() hides
     only the .navitem rows. In-page links and background jobs are untouched.
     No Retired flyout (owner picked nothing).

     company-brain.html came OFF this list 2026-08-27, owner-set, superseding
     the 2026-08-19 entry. The screen is live and answering, and the class
     quizzes (ramp-quizzes.js) are only reachable from it — with the row
     hidden the only way in was typing the address, so nobody found either.

     THE FOUR MARKETING ROWS CAME OFF THIS LIST 2026-09-06, owner-set, for the
     same reason: Campaigns, Social Studio, Creative Factory and Content were
     built and finished, and the only way to open one was to type its address.
     Nobody types addresses. They are back on the menu.
     Taking them off this list is only one third of the job — read the note on
     the Marketing section in crm-sidebar.css before you touch any of this, or
     you will "fix" it twice and see no change.
     Who sees them is NOT decided here. OWNER_ADMIN_ONLY still keeps all four
     off every staff rail, and ROLE_TABS.partner still hands a partner only
     Social Studio and Creative Factory. This list only ever answered "does the
     row paint at all", never "who may open it". */
  var NAV_HIDDEN = [
    "finance-os.html",
    "consent-capture.html",
    "galaxy.html",
    "partner-galaxy.html",
    "ops-admin.html",
    "automations.html",
    "journeys.html",
    "brand-studio.html",
    "hiring.html",
    "affiliate.html",
    "agent-editor.html",
    /* partner-training.html — the $10,000 curriculum. It is a PARTNER screen and
       there is no sidebar row for it at all (see PRINCIPAL_ONLY), so it sits here
       for the same reason partner-galaxy.html does: an employee typing the
       address still reaches it, and no staff menu offers it. */
    "partner-training.html"
  ];

  function menuFor(ok) {
    return ok.filter(function (s) { return NAV_HIDDEN.indexOf(s) === -1; });
  }

  /* staffTabs — every screen a signed-in employee may open, which is every row
     the shared sidebar leaves them looking at — except the role-narrow
     screens above, which closer / sales_manager / funding_advisor pick up in
     allowedFor().

     The sidebar markup itself carries more rows than this: subscriptions
     .html, closer-call, my-numbers, and sales-floor sit in the markup so
     every screen's sidebar stays identical, and gateLinks() hides the ones
     the role may not open. partner-galaxy.html is in no sidebar at all, per
     the note above. Adding a screen to ALL and to nothing else gives it no way
     in — src/http/app-nav-reachability.test.mjs fails when that happens. */
  function staffTabs() {
    return ALL.filter(function (s) {
      return PRINCIPAL_ONLY.indexOf(s) === -1
        && OWNER_ADMIN_ONLY.indexOf(s) === -1
        && CLOSER_DESK_ONLY.indexOf(s) === -1
        && SALES_FLOOR_ONLY.indexOf(s) === -1
        && PORTAL_ONLY.indexOf(s) === -1
        && HIRING_ONLY.indexOf(s) === -1
        && FINANCE_ONLY.indexOf(s) === -1
        && ADVISOR_ONLY.indexOf(s) === -1
        && CONSENT_DESK_ONLY.indexOf(s) === -1;
    });
  }

  /* "staff" = the full employee surface; "*" = that plus the partner screen.
     Every staff role gets the whole sidebar deliberately.

     These lists used to be narrow — a setter had 3 of 19 tabs, a closer 6 —
     while all 19 tabs were rendered on every screen regardless. Every tab
     outside your list was a link that loaded the screen and threw you back,
     which is the bug this file exists to have fixed. Narrowing the nav to
     match the map (which is what the gate now does) traded that for a sidebar
     that silently loses two thirds of its contents.

     And it bought no security to begin with: /api/dashboard/* and /api/tasks
     gate on a valid session, not on a role, so a staff member who could not
     see a tab could still read every row behind it. Withholding the screen
     withheld nothing but the screen.

     So the boundary that is real is kept — the three external principals stay
     on their own surface, because a client must not see the CRM — and the
     internal one, which was costing navigation and protecting nothing, is
     dropped. To put a role back on rails, replace "staff" with an explicit
     list here; the gate handles narrow roles correctly now. If the concern is
     specifically commission rates and staff comp (products-commissions.html,
     staff-teams.html), gate those in the API first — that is where the data
     actually is. */
  var ROLE_TABS = {
    owner: "*",
    /* Not "*". An admin is an employee, so the two client-facing portals and
       partner Home are off their surface — resolved in allowedFor(). */
    admin: "admin",
    /* Funding advisor gets the shared staff surface plus the lender database.
       "funding_advisor" is resolved in allowedFor() — staffTabs() +
       ADVISOR_ONLY. Owner and admin already reach it through "*". */
    funding_advisor: "funding_advisor",
    /* Closer gets the shared staff surface plus the closer desk screens.
       "closer" is resolved in allowedFor() — staffTabs() + CLOSER_DESK_ONLY. */
    closer: "closer",
    inquiry_specialist: "staff",
    setter: "staff",
    /* Sales manager gets the shared staff surface plus the sales floor
       and the finance-gated screens (staff-teams, agent-editor,
       products-commissions). "sales_manager" resolves in allowedFor(). */
    sales_manager: "sales_manager",
    /* Client Success Manager gets the shared staff surface plus the consent
       desk. They run recorded check-in and interview calls, so capturing
       call_recording and marketing_use consent (291) is the one thing they
       cannot do their job without — same reason closer and funding_advisor
       carry it. They also get csm-queue.html, their own call list, which is
       added to the shared staff tabs above. "csm" resolves in allowedFor(). */
    csm: "csm",
    /* Principal types, not staff roles — they are gated here on staff.role only
       because no principals table exists yet. 'partner' is seeded into the
       staff_roles catalog by db/migrations/036_partner_role.sql purely to make
       brand-studio.html reachable; 'client' and 'affiliate' have no catalog row
       and nothing issues them a session. When the accounts table and its own
       auth land, these three move out of ROLE_TABS and 036 is reverted. */
    /* A CLIENT MAY NOW OPEN THE AFFILIATE SCREEN, and only because the owner
       decided it. ops/workflows/portal-rebuild-plan.md section 4 (2026-09-05)
       says pressing "Refer a friend" in the portal "instantly provisions their
       access to affiliate.html". Their principal kind stays `client`
       (db/migrations/340_client_light_affiliate.sql), so without this row the
       screen they were just given would bounce them straight back out.

       THIS ROW IS NAVIGATION, NOT A GATE, and the difference matters here. The
       real gate is on the endpoint: /api/read/affiliate-portal returns rows for
       the caller's OWN affiliate id, taken from their session and never from the
       address bar. A client who has not pressed the button holds no affiliate
       id, so they reach the screen and it tells them they are not enrolled —
       which is the state the screen is written to show. Nothing about what any
       client can READ changes by adding this line. */
    /* THE MONEY PAGES (Finance OS, 2026-10-06). The portal's FinanceOS card
       links to financeos.html (the one page with tabs), and gateLinks() hides a
       card whose link this list does not name. Same as affiliate.html above: NAVIGATION, NOT A GATE. The money
       pages load no shell.js; each endpoint behind them pins a client session to
       its own file (api/money/overview.mjs, api/money/setup.mjs). */
    client: ["client-portal.html", "affiliate.html",
      "financeos.html", "money.html", "money-accounts.html", "money-credit.html",
      "money-connections.html", "money-payments.html", "money-setup.html", "money-plan.html", "money-banks.html",
      "money-strategy.html", "money-fundability.html", "money-next.html", "money-transfers.html"],
    affiliate: ["affiliate.html"],
    /* NO CAMPAIGNS ROW YET, AND THAT IS AN OPEN QUESTION, NOT AN OVERSIGHT.
       A partner cannot reach campaign-manager.html from any screen (proven live
       2026-08-18: 4 rows offered, typing the address bounced them home). The
       API would let them in — every route under api/campaigns/ gates on
       requirePrincipal(["partner","staff"]) with no requireRole — and the
       screen has a real partner mode (isPartnerLogin(), which skips the
       pick-a-partner step because the server pins their own book). So the row
       looks like the only missing piece.

       It was added on 2026-08-18 and taken back out the same hour. OWNER-SET
       the same day: no Campaigns row for partners. Settled — do not re-file
       this as a missing feature. The two reasons, recorded so the next audit
       does not have to re-derive them:

       1. THE CITATION DOES NOT SAY WHAT IT LOOKS LIKE IT SAYS. The line
          docs/journeys/white-label-intended.md:67 reads "Campaigns (6 routes) —
          should be reachable". The byte-identical sentence also sits in the
          closer, inquiry-remover, funding-advisor, sales-manager and owner
          intended files — and four of those roles are DELIBERATELY refused this
          row by the 2026-08-17 owner decision that put campaign-manager.html in
          OWNER_ADMIN_ONLY. So the sentence counts routes, which a partner
          already reaches; it is not a statement about a nav row.
       2. IT WOULD WALK PAST THE OWNER SWITCH. white-label-intended.md says the
          marketing suite is off per partner until the owner turns it on, and
          that a screen in the off state says so rather than sitting live and
          failing. social-studio.html asks (/api/partner-marketing/usage);
          campaign-manager.html asks nothing, so this row would hand every
          partner a live campaigns desk whether their suite is on or off. */
    /* THE FIFTH ROW, AND WHY IT IS NOT A BREACH OF "FOUR SCREENS".
       docs/specs/W6-pricing-menu.md lists what the $10,000 buys as six separate
       lines, and TWO of them are on this list: "Their portal — Brand Studio,
       Social Studio, Creative Factory, Partner Home — four screens. NOT the CRM"
       and, on its own line above it, "Training — curriculum per the curriculum
       spec". The four is a statement about the PORTAL, which is unchanged: a
       partner still cannot see or move a client file, a pipeline card, a
       contract, a payment link or a lender match, and partner-training.html
       reads none of those. The classroom is the other line item, and until now
       it had nowhere to live (W7's gap list: "THERE IS NO COURSE DELIVERY
       SYSTEM").
       IT IS STILL A COUNT THAT MOVED. docs/specs/W7-curriculum.md M10 teaches
       partners "the four screens a partner can open" by name, so that module's
       wording is now one behind the product. Flagged in the unit report rather
       than reconciled here — editing a spec to match code is the one thing
       CLAUDE.md §4 forbids most plainly. */
    partner: ["partner-galaxy.html", "brand-studio.html", "social-studio.html", "creative-factory.html", "partner-training.html"]
  };

  /* Where each role lands when it arrives at /app/ with no screen named, or
     asks for one it may not see. Falls back to the first tab the role has, so
     a role added to ROLE_TABS without a HOME entry still lands somewhere. */
  var HOME = {
    owner: "pipeline.html",
    admin: "pipeline.html",
    funding_advisor: "client-control-panel.html",
    closer: "closer-dashboard.html",
    inquiry_specialist: "inquiry-remover.html",
    setter: "pipeline.html",
    // The Sales pipeline is the thing they own, so it is where they land.
    sales_manager: "sales-floor.html",
    /* The call list, not the client chooser. A CSM opening the app used to land
       on client-control-panel.html and be asked to pick somebody, with no way
       to see who was actually waiting for a call. */
    csm: "csm-queue.html",
    client: "client-portal.html",
    affiliate: "affiliate.html",
    partner: "partner-galaxy.html"
  };

  /* A role this map has never heard of still has to be able to work.
     staff.role is free text (db/schema/001_init.sql:386) with no constraint,
     and 020_auth.sql backfills its own catalog from whatever staff.role
     already holds — so a role created by hand, spelled differently, or added
     to the catalog later reaches this file as an unknown string. It used to
     resolve to no screens at all, which meant signOut(), which meant the
     login page, which signs straight back in and signs straight back out. A
     lockout loop, on a typo.

     Anyone who reaches this file has authenticated through /api/auth/login,
     which is the staff table — the three principal roles are unbuilt (B4) and
     nothing issues them a session yet. So an unknown role is a staff role
     spelled unexpectedly, and it gets the staff surface. The chip still marks
     it unrecognised, so a genuinely wrong value stays visible rather than
     silently inheriting access. */
  function isKnownRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_TABS, role);
  }

  function allowedFor(role) {
    if (!role) return [];
    var m = ROLE_TABS[role];
    if (m === "*") return ALL.concat(STAFF_MONEY);
    if (m === "admin") {
      return ALL.filter(function (s) { return ADMIN_BLOCKED.indexOf(s) === -1; }).concat(STAFF_MONEY);
    }
    if (m === "closer") return staffTabs().concat(CLOSER_DESK_ONLY).concat(CONSENT_DESK_ONLY);
    if (m === "funding_advisor") return staffTabs().concat(ADVISOR_ONLY).concat(CONSENT_DESK_ONLY);
    if (m === "sales_manager") return staffTabs().concat(SALES_FLOOR_ONLY).concat(FINANCE_ONLY).concat(STAFF_MONEY);
    if (m === "csm") return staffTabs().concat(CONSENT_DESK_ONLY);
    if (m === "staff" || !m) return staffTabs();
    return m.slice();
  }

  function homeFor(role, ok) {
    var h = HOME[role];
    if (!h) return ok[0];
    /* An absolute home is a landing page outside /app/, not a gated tab — do
       not require it in the role's screen list. No role uses one today; the
       branch stays as a guard so a future absolute home does not fall through
       to ok[0]. */
    if (h.charAt(0) === "/") return h;
    return ok.indexOf(h) !== -1 ? h : ok[0];
  }

  function homeUrl(role, ok) {
    var h = homeFor(role, ok);
    return h && h.charAt(0) === "/" ? h : "/app/" + h;
  }

  /* screenOf — the screen file a link points at, or "" if it does not point at
     one. It STRIPS A QUERY STRING AND A HASH, and that is a fix, not tidying.

     The old isScreen() tested the whole href against /^[a-z0-9-]+\.html$/, so
     "card-stack.html?client_id=..." was not a screen as far as this file was
     concerned. Two things followed from that, both live on the deployed app:

       1. THE GATE HAD A HOLE. Every link a screen builds in JavaScript carries a
          query — card-stack.html builds finance-os.html?client_id=, deal-model
          builds card-stack.html?client_id=, alerts builds alerts.html?client_id=
          — so the click interceptor below skipped all of them and gateLinks()
          never hid one. A role that may not open a screen could still be handed
          a working link to it by another screen, click it, and be bounced back
          out by pass 2. That bounce is the exact behaviour the header of this
          file says the gate exists to have fixed.
       2. THE CLIENT COULD NOT BE CARRIED. Appending ?client_id= to a sidebar row
          would have taken that row out of the gate entirely, for the same
          reason. Carrying the client safely required fixing this first. */
  function screenOf(href) {
    var h = String(href == null ? "" : href).replace(/^\.\//, "");
    h = h.split("#")[0].split("?")[0];
    /* A LEADING PATH IS STRIPPED TOO, and that is not cosmetic. The redirect
       targets this file builds are absolute — "/app/" + homeFor(...) — so
       without this, withClient() looked at "/app/closer-dashboard.html", failed
       to recognise a screen in it, and silently carried nothing. The bounce-home
       path is exactly where losing the client hurts most: you were sent
       somewhere you did not ask to go, and arriving with nobody open makes it
       look like the app forgot what you were doing. */
    /* AN ABSOLUTE HREF THAT IS NOT UNDER /app/ IS NOT AN APP SCREEN, and that
       correction is why the progress page can be reached at all.

       public/ holds the pages a CUSTOMER opens at the site root —
       contract.html, portal-login.html, progress.html. They do not load this
       file, they are not in ALL, and they are in no role's tab list, so before
       this line every one of them looked to the gate like a screen nobody may
       open. Both gates then fired on the single link to one:

         * gateLinks() hid the whole card the link sat in, and
         * the capture-phase click interceptor called preventDefault(), so an
           ordinary left click did nothing at all.

       Measured in Chromium on 2026-09-05: the address bar did not change.
       Adding progress.html to a role's tab list would have been the wrong fix —
       it is not a tab, it has no sidebar row, and its own endpoint does the real
       gating. What was wrong was calling a root page an /app/ screen.

       The redirect targets this file builds are still recognised: they are
       "/app/" + homeFor(...), which passes the /app/ test above. A bare or
       relative href ("pipeline.html", "./pipeline.html") is untouched. */
    if (h.charAt(0) === "/" && h.lastIndexOf("/app/", 0) !== 0) return "";
    h = h.slice(h.lastIndexOf("/") + 1);
    return /^[a-z0-9-]+\.html$/i.test(h) ? h : "";
  }

  function isScreen(href) {
    return screenOf(href) !== "";
  }

  /* ── carrying the client from screen to screen ────────────────────────────

     THE PROBLEM THIS SOLVES. Seven screens in this app are about ONE named
     client and every one of them takes that client from the address bar. Until
     this pass nothing put it there: you typed a uuid by hand, and the moment you
     used the sidebar to walk to the next screen it was gone and you typed it
     again. That is what made a finished product feel like a pile of separate
     pages rather than one thing.

     WHAT THIS DOES. gateLinks() appends the current client to every link that
     points at a screen which actually reads one. It never guesses: the id has to
     be a uuid, and a link that already names its own client is left exactly as
     it is, so a "see this other client's alert" link still goes where it says.

     WHAT IT DELIBERATELY DOES NOT DO. It does not decide what any screen SHOWS.
     Screens read their own address bar and nothing else; this only changes where
     links point. And it touches nothing but the screens listed below — putting
     ?client_id= on a link to Hiring or Brand Studio would be noise on a URL that
     means nothing to the page receiving it.

     THE ONE ODD ENTRY. client-control-panel.html calls the same thing `id`, not
     `client_id` (its wiring reads FHData.param("id")). Renaming its parameter
     would break every link and bookmark anybody has to it, so the mapping is
     written here instead — once, where every link in the app is already being
     rewritten — and reported as an inconsistency rather than hidden.
     closer-dashboard.html already accepts either spelling and takes client_id. */
  var CLIENT_SCREENS = {
    "finance-os.html":           "client_id",
    "closer-dashboard.html":     "client_id",
    "client-control-panel.html": "id",
    /* consent-capture.html reads param("client_id") and, with none, paints
       "No client selected" with Save disabled. It is in this map so a click on
       the Consent rail row carries the client the user is already working —
       currentClient() remembers it — instead of opening a dead screen. */
    "consent-capture.html":      "client_id"
  };

  /* ENTITY_SCREENS — which screens additionally read an entity (personal vs. a
     business, 106_entities.sql) off the URL, and under what key. Same shape and
     same reasoning as CLIENT_SCREENS one block up: keep it here, once, rather
     than duplicated per screen. A screen absent from this map does not filter
     by entity even if a client is carried. */
  var ENTITY_SCREENS = {
    "finance-os.html": "entity_id"
  };

  var CLIENT_KEY = "fh_client";
  var ENTITY_KEY = "fh_entity";
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* urlClient — the client this page was opened on, if it is a real id.

     A junk value is treated as no client at all rather than propagated: spraying
     a typo across ten links turns one 400 into ten. `id` is read ONLY on the
     control panel, where `id` IS the client — on agent-editor.html or
     brand-studio.html `id` means something else entirely, and remembering an
     agent's id as a client would send the next click to the wrong record. */
  /* READING is permissive; WRITING stays per-screen.

     Hole 10 taught client-control-panel.html, closer-dashboard.html and
     present.js to open a file from ?id=, ?client_id=, ?client= or ?contact=,
     because links into this product come from ClickFunnels, from email, and
     from staff pasting a URL, and they do not agree on one name. urlClient()
     was left reading only client_id (plus "id" on the control panel), so the
     PAGE would open the right client while the SHELL around it thought no
     client was selected - the rail rows then pointed at a different file, or
     at none.

     "client" and "contact" are safe on every screen: nothing else in the app
     uses those names.

     "id" IS NOT, and stays gated to CLIENT_SCREENS. agent-editor.html?id= is an
     AGENT id; reading it as a client would remember a record that is not a
     person and send the next click there. src/http/app-client-carry.test.mjs
     "an ?id= on some other screen is NOT read as a client" pins that, and it is
     the reason this function cannot simply take every spelling everywhere.

     CLIENT_SCREENS is unchanged and still governs which name we WRITE when
     building a link, so nothing about outgoing URLs changes here.

     Known duplication, left alone deliberately: this same alias list exists in
     four places with four different orderings (present.js:91,
     client-control-panel.html:1474/2050/2128/2130, closer-dashboard.html:225).
     Unifying them is a refactor across four files, not part of closing this
     gap. */
  var CLIENT_ID_ALIASES = ["client_id", "client", "contact"];

  function urlClient() {
    try {
      var q = new URLSearchParams(location.search);
      var names = CLIENT_ID_ALIASES.slice();
      if (CLIENT_SCREENS[PAGE] === "id") names.push("id");
      var v = "";
      for (var i = 0; i < names.length && !v; i++) {
        var raw = q.get(names[i]);
        raw = String(raw == null ? "" : raw).trim();
        /* Only a real uuid wins, so a junk ?client=foo cannot shadow a good
           ?client_id=<uuid> further down the list. */
        if (UUID_RE.test(raw)) v = raw;
      }
      return v;
    } catch (e) { return ""; }
  }

  /* currentClient — the client to point links at.

     The address bar wins and is remembered; the memory is the fallback so that a
     detour through a screen with no client on it (Command Center, Documents)
     does not lose the person you were working on. The memory NEVER decides what
     a screen displays — only where a link goes — so the worst a stale value can
     do is offer a link to the client you had open last, which is visible in the
     link and in the hub's own "currently open" line. It is cleared on sign-out,
     because the next person at a shared machine must not inherit it. */
  function currentClient() {
    var fromUrl = urlClient();
    if (fromUrl) {
      try { localStorage.setItem(CLIENT_KEY, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try {
      var v = String(localStorage.getItem(CLIENT_KEY) || "").trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  /* withClient — one href, with the client on it if that screen reads one.
     `key` is optional; only withPortalClient() below passes it. */
  function withClient(href, cid, key) {
    key = key || CLIENT_SCREENS[screenOf(href)];
    if (!cid || !key) return href;
    var h = String(href);
    var hash = "";
    var i = h.indexOf("#");
    if (i !== -1) { hash = h.slice(i); h = h.slice(0, i); }
    // A link that names its own client already answered this question. The hub
    // builds its cards that way, and an alert row links to the client the alert
    // is about — neither must be rewritten to whoever is "current".
    if (new RegExp("[?&]" + key + "=").test(h)) return href;
    return h + (h.indexOf("?") === -1 ? "?" : "&") +
           key + "=" + encodeURIComponent(cid) + hash;
  }

  /* withPortalClient — hole N15 (live, 2026-09-18). On a client's control
     panel the rail's Client Portal row opened client-portal.html with no
     client, so the owner landed on "We could not load your file". gateLinks()
     hands this the control panel's OWN client — its address bar only, never
     the remembered one — and the portal link carries it as ?client_id= (the
     portal reads ?id= or ?client_id=).

     Deliberately NOT a CLIENT_SCREENS entry. That map also carries the
     remembered client onto every other screen's rail and into the client
     role's bounce-home redirect; the portal row everywhere else must behave
     exactly as it did. A link that already names its client (either spelling)
     is left alone, same rule as withClient(). */
  function withPortalClient(href, cid) {
    if (!cid || screenOf(href) !== "client-portal.html") return href;
    if (/[?&]id=/.test(String(href).split("#")[0])) return href;
    return withClient(href, cid, "client_id");
  }

  /* urlEntity/currentEntity/withEntity — the entity (personal vs. a business)
     equivalent of urlClient/currentClient/withClient directly above. Same
     rules: a junk value is no entity at all, the address bar wins and is
     remembered, and a link naming its own entity already answered the
     question. Kept as a genuinely separate id/key pair rather than folded into
     "client" — a client can have several entities open in different tabs, and
     conflating the two would make switching entities silently switch clients. */
  function urlEntity() {
    try {
      var q = new URLSearchParams(location.search);
      var v = String(q.get("entity_id") || "").trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  function currentEntity() {
    var fromUrl = urlEntity();
    if (fromUrl) {
      try { localStorage.setItem(ENTITY_KEY, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try {
      var v = String(localStorage.getItem(ENTITY_KEY) || "").trim();
      return UUID_RE.test(v) ? v : "";
    } catch (e) { return ""; }
  }

  function withEntity(href, eid) {
    var key = ENTITY_SCREENS[screenOf(href)];
    if (!eid || !key) return href;
    var h = String(href);
    var hash = "";
    var i = h.indexOf("#");
    if (i !== -1) { hash = h.slice(i); h = h.slice(0, i); }
    if (new RegExp("[?&]" + key + "=").test(h)) return href;
    return h + (h.indexOf("?") === -1 ? "?" : "&") +
           key + "=" + encodeURIComponent(eid) + hash;
  }


  /* normRole — the one place a role string is folded to a map key. Matching
     020_auth.sql, which keys its catalog on lower(btrim(staff.role)): the
     column is free text filled by hand (scripts/create-staff.mjs passes argv
     straight through), so "Owner" and "owner " are the same role and only
     trimming makes them resolve as one. Lowercasing alone demoted a trailing
     space to an unrecognised role. */
  function normRole(v) {
    return String(v == null ? "" : v).trim().toLowerCase();
  }

  /* ---------------------------------------------------------------------
     Cached role — the hint that lets the gate answer before the network does.

     The session is the server's to decide, but a role only changes when
     somebody edits a staff record, so the last known one is a safe hint for
     the length of one page load. With it the gate is synchronous: a forbidden
     URL redirects before anything paints, and the nav is drawn already gated.
     It is never the authority — the real session resolves underneath and
     rewrites the cache, so a role changed server-side costs one stale load and
     corrects itself on the next.
     --------------------------------------------------------------------- */
  var ROLE_KEY = "fh_role";

  function readCachedRole() {
    try { return normRole(localStorage.getItem(ROLE_KEY)); }
    catch (e) { return ""; }
  }

  function writeCachedRole(role) {
    try {
      if (role) localStorage.setItem(ROLE_KEY, role);
      else localStorage.removeItem(ROLE_KEY);
    } catch (e) {}
  }

  // routeAway — the screen this role may not open, and where it belongs
  // instead. null when the page is fine, or when the role has no screens at
  // all (that is a config error; only the resolved session acts on it).
  function routeAway(role) {
    var ok = allowedFor(role);
    if (!ok.length) return null;
    if (ok.indexOf(PAGE) !== -1) return null;
    // Bounced off a screen you may not open — but you were working on somebody,
    // and arriving home having silently lost them is the loss this pass exists
    // to stop. currentClient() reads the bar of the page being left.
    return withClient(homeUrl(role, ok), currentClient());
  }

  /* allowedNow is null until we know the role. Every click on a screen link is
     held until then and dropped if the target is forbidden, so a link the user
     can still see during a cold load cannot start a navigation that would only
     bounce back. */
  var allowedNow = null;
  var pendingHref = null;

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    var a = t && t.closest ? t.closest("a[href]") : null;
    if (!a || a.target === "_blank") return;
    var h = (a.getAttribute("href") || "").replace(/^\.\//, "");
    // screenOf(), not isScreen() on the raw href: a link carrying ?client_id=
    // is still a link to a screen and still has to be gated. See screenOf().
    var file = screenOf(h);
    if (!file) return;
    if (allowedNow === null) {
      // Session still in flight: remember where they wanted to go and take
      // them there the moment we know they may. The WHOLE href is remembered,
      // query and all, so the client on it survives the wait.
      e.preventDefault();
      pendingHref = h;
      return;
    }
    if (allowedNow.indexOf(file) === -1) e.preventDefault();
  }, true);

  function settleClicks(ok) {
    allowedNow = ok;
    var want = pendingHref;
    pendingHref = null;
    if (want && ok.indexOf(screenOf(want)) !== -1) location.href = want;
  }

  /* Without a hint the gate cannot answer before paint. Owner-set 2026-08-05:
     do NOT blank the whole document while /api/auth/session is in flight — that
     was a multi-second empty screen on every cold load. The layers that remain
     are enough for the gate: nav rows stay hidden until gateLinks() runs, and
     clicks on screen links are blocked until the role is known. A cold load
     may briefly show page chrome before a bounce; a blank wait is worse. */
  var navStyle = document.createElement("style");
  navStyle.id = "fh-gate-style";
  navStyle.textContent = ".navitem{visibility:hidden}";
  (document.head || document.documentElement).appendChild(navStyle);

  function revealNav() {
    if (navStyle && navStyle.parentNode) navStyle.parentNode.removeChild(navStyle);
  }

  /* ---- sidebar: one markup, one geometry, owned here ---- */
  function ensureSidebarCss() {
    if (document.getElementById("fh-crm-sidebar-css")) return;
    var link = document.createElement("link");
    link.id = "fh-crm-sidebar-css";
    link.rel = "stylesheet";
    link.href = (location.pathname.indexOf("/app/") === 0 ? "" : "/app/") + "crm-sidebar.css";
    if (location.pathname.indexOf("/app/") === 0) link.href = "crm-sidebar.css";
    (document.head || document.documentElement).appendChild(link);
    var lock = document.createElement("style");
    lock.id = "fh-side-lock";
    lock.textContent =
      "aside.side,.side{position:fixed!important;top:0!important;left:0!important;" +
      "bottom:0!important;width:var(--fh-side-w,228px)!important;flex:none!important;" +
      "margin:0!important;max-height:none!important;z-index:400!important}" +
      ".side.mini{width:var(--fh-side-w-mini,60px)!important}" +
      ".app,.app-shell{padding-left:var(--fh-side-w,228px)!important;box-sizing:border-box}" +
      "html.fh-side-mini .app,html.fh-side-mini .app-shell{padding-left:var(--fh-side-w-mini,60px)!important}" +
      /* MOBILE. This block has to live here, not in crm-sidebar.css.
         This stylesheet is injected at runtime and appended to <head>, so it
         comes after the linked crm-sidebar.css. Both sides use !important at
         the same specificity, so source order decides and this one wins. The
         mobile rules were first written in crm-sidebar.css and silently lost:
         every screen kept 228px of left padding on a 390px phone, leaving
         162px of usable width. Measured, not guessed — the layout check reports
         it. Keep the mobile override in the same sheet as the rule it beats. */
      "@media (max-width:860px){" +
        "aside.side,.side{width:var(--fh-side-w,228px)!important;" +
          "transform:translateX(-100%);transition:transform .22s ease}" +
        "aside.side.open,.side.open{transform:translateX(0)}" +
        ".side.mini{width:var(--fh-side-w,228px)!important}" +
        ".app,.app-shell,html.fh-side-mini .app,html.fh-side-mini .app-shell{" +
          "padding-left:0!important}" +
        /* see setDrawer() — floating chrome outranks the rail on z-index */
        "html.fh-drawer-open #fh-shell-chip," +
        "html.fh-drawer-open #fh-shell-chip-show," +
        "html.fh-drawer-open #fh-shell-search-btn{display:none!important}" +
        /* The menu button is fixed at top-left, which is exactly where a page
           title sits. Without this the ☰ lands on top of "Hiring", "Pipeline"
           and so on. 58px = 10 left + 40 button + 8 gap. */
        ".topbar,.top,.page-hd,body>header,.app>header,.app-shell>header{" +
          "padding-left:58px!important;flex-wrap:wrap!important}" +
        /* The 58px above is real width taken out of a 390px row, which pushed
           the right-hand action group (.topbar-right) off the edge on
           inquiry-remover and ops-admin. Wrapping lets that group drop to a
           second line instead of overflowing. Harmless on a topbar that is not
           a flex row. */
        /* The session chip is NOT positioned from here. It owns its own
           breakpoints in CHIP_BREAKPOINT_CSS — see the note there about why
           setting bottom from a second stylesheet stretches it instead of
           moving it. */
      "}";
    (document.head || document.documentElement).appendChild(lock);
  }

  /* Wide data tables — mobile.
     Ten screens render a <table class="grid"> that is 450-1340px wide. On a
     390px phone each one dragged the whole page sideways.

     Cards were the stated preference and are not used here, deliberately: the
     card pattern needs data-label="" on every <td> to keep the value labelled,
     no cell in the app has one, and most of these rows are built inside JS
     template strings across ten files. Editing all of that to reflow a grid
     nobody reads column-by-column on a phone is a poor trade. Contained
     sideways scroll keeps the columns intact and stops the PAGE moving, which
     is the actual complaint.

     Done here rather than per page because the rows arrive after shell.js runs
     — the observer catches tables that do not exist yet. */
  /* THIS IS AN ALLOW-LIST OF DATA TABLES, AND IT HAS TO STAY ONE.
     UI-STANDARDS §11 says a table that must stay a table may scroll inside its
     own box; this builds that box. A screen whose table carries none of these
     classes gets no box and pushes the whole page sideways on a phone — which
     is what consent-capture.html's <table class="cc-hist"> was doing (measured
     2026-08-18: 453px inside a 390px viewport), so it is named here.

     DO NOT REPLACE THIS WITH querySelectorAll("table"). It was tried on
     2026-08-18 and reverted the same hour. crm-sidebar.css pairs the box with
     `.fh-scroll-x > table{min-width:max-content}`, which is right for a data
     grid and wrong for a LAYOUT table — Closer Dashboard's live-call panels use
     class-less tables to position facts, and forcing them to max-content
     took that screen from 390px to 754px on a phone. Nine other class-less or
     oddly-classed tables are in the same position. Add a class here when a new
     DATA table appears; that is the deliberate cost of not breaking the rest. */
  function wrapWideTables(root) {
    var tables = (root || document).querySelectorAll("table.grid,table.queue,table.cc-hist");
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var p = t.parentNode;
      if (!p || (p.classList && p.classList.contains("fh-scroll-x"))) continue;
      var w = document.createElement("div");
      w.className = "fh-scroll-x";
      p.insertBefore(w, t);
      w.appendChild(t);
    }
  }

  function watchWideTables() {
    if (window.__fhTableWatch) return;
    window.__fhTableWatch = 1;
    wrapWideTables(document);
    if (!window.MutationObserver) return;
    var queued = false;
    var obs = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        queued = false;
        wrapWideTables(document);
      }, 0);
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function mountSidebar() {
    ensureSidebarCss();
    if (!SIDEBAR_HTML) return;
    var existing = document.getElementById("side") || document.querySelector("aside.side");
    if (!existing) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = SIDEBAR_HTML;
    var fresh = wrap.firstElementChild;
    if (!fresh) return;
    existing.parentNode.replaceChild(fresh, existing);
    var page = PAGE || "";
    var links = fresh.querySelectorAll("a.navitem");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = (a.getAttribute("href") || "").split("?")[0];
      if (href === page) a.classList.add("on");
      else a.classList.remove("on");
    }
    setGroupDefault(fresh);
    wireSidebarChrome(fresh);
  }

  /* UI-STANDARDS §4 — max 7 top-level nav items, two levels deep.
     The rail is already two levels: the group headers are the first, their rows
     the second. But every group shipped open, so what a role actually faced was
     one flat list — 21 rows for a staff role, 31 for the owner, all at once.
     Start with only the group you are standing in open. The headers still
     toggle (wireSidebarChrome), so every other group is one click away (§9),
     and the group you are in stays open so "where am I" is still answered on
     sight (§4). Deliberately not remembered between pages: a stored open set
     would drift back to "everything open" one click at a time. */
  function setGroupDefault(side) {
    var groups = side.querySelectorAll(".navgroup");
    /* Some pages carry the rail without being a row on it — partner-galaxy,
       plus anything opened from outside /app/. (consent-capture used to be on
       this list; it has had a Consent row under Client ops since 2026-08-18.)
       Closing every group there would leave a rail of headings and nothing else, and
       for a partner the single row they may open (Brand Studio) would be the
       thing hidden. No active row means no group to keep open, so open them
       all: this default narrows a long rail, it never empties one. */
    if (!side.querySelector("a.navitem.on")) return openAllGroups(side);
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].querySelector("a.navitem.on")) groups[i].classList.remove("closed");
      else groups[i].classList.add("closed");
    }
  }

  function openAllGroups(side) {
    var groups = side.querySelectorAll(".navgroup");
    for (var i = 0; i < groups.length; i++) groups[i].classList.remove("closed");
  }

  function wireSidebarChrome(side) {
    if (!side || side.getAttribute("data-fh-wired") === "1") return;
    side.setAttribute("data-fh-wired", "1");
    var burger = side.querySelector("#burger") || document.getElementById("burger");

    function isMobile() {
      return !!(window.matchMedia && window.matchMedia("(max-width:860px)").matches);
    }

    /* The scrim used to be looked up as "side-scrim" while the ten pages that
       shipped one called it "sideScrim", so getElementById always returned null
       and the backdrop never appeared. The other 27 pages had no scrim element
       at all. Own it here instead: one element, created on demand, present on
       every screen. */
    function getScrim() {
      var scrim = document.getElementById("side-scrim") ||
                  document.getElementById("sideScrim") ||
                  document.querySelector(".side-scrim");
      if (!scrim) {
        scrim = document.createElement("div");
        scrim.className = "side-scrim";
        document.body.appendChild(scrim);
      }
      scrim.id = "side-scrim";
      if (!scrim.getAttribute("data-fh-wired")) {
        scrim.setAttribute("data-fh-wired", "1");
        scrim.addEventListener("click", function () { closeMobile(); });
      }
      return scrim;
    }

    /* Below 860px the rail is off-canvas, so it needs a way back in. */
    function getMenuBtn() {
      var btn = document.getElementById("fh-menu-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "fh-menu-btn";
        btn.className = "fh-menu-btn";
        btn.type = "button";
        btn.setAttribute("aria-label", "Open menu");
        btn.setAttribute("aria-controls", "side");
        btn.textContent = "☰";
        btn.addEventListener("click", function () { openMobile(); });
        if (side.parentNode) side.parentNode.insertBefore(btn, side.nextSibling);
        else document.body.appendChild(btn);
      }
      return btn;
    }

    /* The session chip and the search button are position:fixed at z-index
       ~2147483000, three orders of magnitude above the rail's 400, so with the
       drawer open they sit on top of the navigation and cover menu entries.
       Raising the rail above them would start a z-index war with the search
       overlay, which legitimately has to cover everything. Hiding the two
       floating controls while the drawer is open is the smaller change: they
       are chrome for the screen underneath, which you cannot interact with
       anyway while the scrim is up. */
    function setDrawer(open) {
      side.classList.toggle("open", open);
      getScrim().classList.toggle("show", open);
      getMenuBtn().setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.classList.toggle("fh-drawer-open", open);
    }
    function openMobile() { setDrawer(true); }
    function closeMobile() { setDrawer(false); }

    function syncMini() {
      var mini = side.classList.contains("mini");
      document.documentElement.classList.toggle("fh-side-mini", mini && !isMobile());
      /* The 60px icon rail hides every label, group headers included, so a
         closed group there is a row with nothing left to open it. Open them all
         while the rail is mini; put the one-group-open default back when it is
         not. */
      if (mini && !isMobile()) openAllGroups(side);
      else setGroupDefault(side);
      if (burger) burger.textContent = isMobile() ? "✕" : (mini ? "››" : "‹‹");
      getMenuBtn();
      if (!isMobile()) closeMobile();
    }

    if (burger) {
      burger.addEventListener("click", function () {
        /* On a phone the same control closes the drawer; on desktop it still
           collapses the rail to the icon strip. */
        if (isMobile()) { closeMobile(); return; }
        side.classList.toggle("mini");
        syncMini();
      });
    }

    /* Tapping a destination should not leave the drawer sitting over it. */
    side.addEventListener("click", function (ev) {
      if (isMobile() && ev.target && ev.target.closest && ev.target.closest("a.navitem")) closeMobile();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && side.classList.contains("open")) closeMobile();
    });
    var heads = side.querySelectorAll(".navhead");
    for (var h = 0; h < heads.length; h++) {
      heads[h].addEventListener("click", function (ev) {
        var g = ev.currentTarget.closest(".navgroup");
        if (g) g.classList.toggle("closed");
      });
    }
    if (window.matchMedia) {
      var mq = window.matchMedia("(max-width:860px)");
      function onMq() {
        /* Was: force .mini below 860, which left a 60px unlabelled glyph rail
           permanently docked on a 390px phone. Now the rail is off-canvas and
           starts closed; the ☰ button brings it in. */
        if (mq.matches) {
          /* Drop .mini so a rail collapsed on desktop does not carry over as a
             60px glyph strip after a resize or rotate. Mobile is one state:
             off-canvas, full labels. */
          side.classList.remove("mini");
          document.documentElement.classList.remove("fh-side-mini");
          closeMobile();
        }
        syncMini();
      }
      if (mq.addEventListener) mq.addEventListener("change", onMq);
      else if (mq.addListener) mq.addListener(onMq);
      onMq();
    } else {
      syncMini();
    }
  }

  /* Mount before first paint when possible — head script + documentElement. */
  ensureSidebarCss();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      mountSidebar();
      watchWideTables();
    });
  } else {
    mountSidebar();
    watchWideTables();
  }

  function getSession() {
    var t = localStorage.getItem("fh_token") || "";
    var real = fetch("/api/auth/session", {
      headers: t ? { authorization: "Bearer " + t } : {}
    }).then(function (r) {
      if (!r.ok) throw 0;
      return r.json();
    }).then(function (d) {
      if (d && d.ok && d.staff) {
        try {
          localStorage.removeItem("fh_demo");
          localStorage.removeItem("fh_demo_staff");
        } catch (e) {}
        return { staff: d.staff, demo: false };
      }
      throw 0;
    });
    return real.catch(function () {
      try {
        var s = JSON.parse(localStorage.getItem("fh_demo_staff") || "null");
        if (s) return { staff: s, demo: true };
      } catch (e) {}
      return null;
    });
  }

  /* Kick the session off as soon as this file can. Sidebar mount and the role
     hint still run below; overlapping them with the network is free speed. */
  var sessionPromise = getSession();

  /* backendState — what is actually answering, as opposed to what the screen
     is drawing. Three distinct failures used to look identical from the
     browser: no function deployed, function up but no DATABASE_URL, and a
     database that is refusing connections. /api/health separates them, so the
     chip can name the real one instead of saying DEMO for all three. */
  function backendState() {
    return fetch("/api/health", { headers: { accept: "application/json" } })
      .then(function (r) {
        if (r.status === 404) return { code: "offline", label: "NO API", hint: "/api/* is not deployed" };
        return r.json().then(function (d) {
          if (d && d.ok && d.db === "up") {
            return { code: "live", label: "LIVE", hint: (d.migrations || 0) + " migrations applied" };
          }
          return { code: "nodb", label: "NO DB", hint: String((d && d.message) || "The database is not reachable right now.") };
        }).catch(function () {
          return { code: "offline", label: "NO API", hint: "/api/health did not return JSON" };
        });
      })
      .catch(function () {
        return { code: "offline", label: "NO API", hint: "/api/health unreachable" };
      });
  }

  /* signInUrl — WHICH sign-in page this person can actually use.

     /login.html is the staff password form. A real client has no password to
     type: src/auth/magic-link.mjs provisions a client account with
     unguessableHash(), a hash of 32 discarded random bytes, so the password box
     can never be satisfied. Their sign-in page is /portal-login.html, which
     mails them a link. Sending a signed-out client to /login.html was a dead end
     on the one screen client-portal.html exists for.

     KEYED ON THE ROLE, AND THE PAGE IS ONLY THE FALLBACK. Keying on the page
     alone looks equivalent and is not: routeAway() proves that a cached CLIENT
     can only be on this page, not that everyone on this page is a client. The
     owner is the counterexample — the owner walk of a client's portal is a
     supported thing (see ADMIN_BLOCKED above, which deliberately leaves the
     owner able to open it), so an owner whose session expires there would have
     been sent to the client's mail-me-a-link page, which cannot sign a staff
     member in. That would have removed one dead end by building the same one
     for somebody else.
     The caller passes the last role it knew, because both call sites clear the
     cache before redirecting. With no cached role at all — a cold load on this
     page — the client is the right guess: they are who the screen is for.

     NO ?next= ON THE PORTAL BRANCH. public/portal-login.html reads only "email"
     and "t", and api/auth/magic-link-verify.mjs answers with a hardcoded
     next of /app/client-portal.html. A next= appended here would be dropped at
     every step, so it is not added — a parameter that does nothing reads as a
     promise the page does not keep.

     BUT ?email= IS CARRIED, and that is the same rule, not an exception to it.
     portal-login.html reads exactly two parameters and this is one of them:
     prefillEmailFromQuery() drops it straight into the address box. Owner-set
     2026-08-29, the DIY letters email stopped pointing at portal-login.html and
     started pointing at the portal itself ({{portal_url}} in
     src/workflows/messaging.mjs), so this bounce is now the ONLY thing standing
     between a signed-out client and a sign-in form they have to fill in by
     hand. Dropping the address here would have made the new link worse than the
     one it replaced. Carried only when it is actually there — a cold visit with
     no parameter still gets the bare page, exactly as before.

     AFFILIATES ARE NOT CLIENTS and must keep /login.html. src/auth/magic-link.mjs
     refuses any kind other than "client" as not_eligible, and affiliate accounts
     do carry a real password — routing them to the portal page would invent a
     second dead end rather than remove one. */
  function signInUrl(withNext, lastRole) {
    var staffish = lastRole && lastRole !== "client";
    if (PAGE === "client-portal.html" && !staffish) {
      var email = "";
      try {
        email = new URLSearchParams(location.search).get("email") || "";
      } catch (e) { email = ""; }
      email = String(email).trim();
      return email
        ? "/portal-login.html?email=" + encodeURIComponent(email)
        : "/portal-login.html";
    }
    return withNext ? "/login.html?next=/app/" + PAGE : "/login.html";
  }

  function signOut() {
    /* Tell the SERVER first. This used to clear localStorage and redirect,
       which logs the browser out and leaves the session row live until it
       expires — so "Sign out" did not revoke anything, and a token captured
       from that machine kept working afterwards. /api/auth/logout has existed
       the whole time; nothing called it.

       The local clear happens either way: a network failure must never strand
       someone signed in on a shared machine. */
    var token = "";
    try { token = localStorage.getItem("fh_token") || ""; } catch (e) { token = ""; }

    function finish() {
      try {
        localStorage.removeItem("fh_token");
        localStorage.removeItem("fh_demo");
        localStorage.removeItem("fh_demo_staff");
        // The remembered client goes too. It is not a credential, but it is the
        // name of a real person's file and the next person to sign in at a
        // shared machine must not be handed it on every link.
        localStorage.removeItem(CLIENT_KEY);
        localStorage.removeItem(ENTITY_KEY);
      } catch (e) { /* private mode — the redirect still happens */ }
      /* Read before the wipe on the next line, or signInUrl() gets "" and a
         signing-out owner is sent to the client's sign-in page. */
      var lastRole = readCachedRole();
      writeCachedRole("");
      location.href = signInUrl(false, lastRole);
    }

    if (!token) { finish(); return; }
    var done = false;
    var once = function () { if (!done) { done = true; finish(); } };
    // Never hang on the redirect if the API is slow or gone.
    setTimeout(once, 1500);
    try {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { authorization: "Bearer " + token, accept: "application/json" }
      }).then(once, once);
    } catch (e) { once(); }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* gateLinks runs twice — once on the cached hint, once on the real session —
     so it has to be idempotent in both directions. A link the hint hid must
     come back if the session turns out to allow it. The original href is kept
     on the element the first time through, because the logo's is rewritten. */
  function gateLinks(ok, role) {
    var home = homeUrl(role, ok);
    /* Read ONCE per pass, not once per link: currentClient() writes the address
       bar's client back to localStorage, and doing that inside the loop would
       repeat the same write for every anchor on the page. */
    var cid = currentClient();
    var eid = currentEntity();
    /* Hole N15: the client this control panel is open on, for its Client
       Portal link. Empty on every other screen — see withPortalClient(). */
    var panelCid = PAGE === "client-control-panel.html" ? urlClient() : "";
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!a.hasAttribute("data-fh-href")) {
        a.setAttribute("data-fh-href", a.getAttribute("href") || "");
      }
      /* EVERY REWRITE BELOW STARTS FROM data-fh-href, THE ORIGINAL. That is what
         makes this idempotent across the two passes — the hint pass and the
         session pass — and it is what stops the client being appended twice. */
      var h = a.getAttribute("data-fh-href").replace(/^\.\//, "");
      var file = screenOf(h);
      if (!file) continue;
      var allowed = ok.indexOf(file) !== -1;
      /* Partner Home is for partners. Owner and staff use Galaxy. */
      if (file === "partner-galaxy.html" && role !== "partner") allowed = false;
      /* Kill pass: hide the menu row only. allowedFor() still opens the URL. */
      var hideNav = a.classList.contains("navitem") && NAV_HIDDEN.indexOf(file) !== -1;
      // The sidebar logo is chrome, not a tab. Every screen points it at
      // pipeline.html, which some roles may not treat as home, so
      // hiding it took the logo off the page for them. Send it home instead.
      if (a.classList.contains("logo")) {
        a.setAttribute("href", withClient(allowed ? h : home, cid));
        continue;
      }
      // THE CLIENT RIDES ALONG. Only on links this role may follow, and only to
      // screens that read a client — see CLIENT_SCREENS. The entity rides the
      // same way, one step later, so a link ends up with both query params
      // when the target screen reads both.
      if (allowed) a.setAttribute("href", withPortalClient(withEntity(withClient(h, cid), eid), panelCid));
      var box = a.closest("li") || a.closest(".card") || a;
      if (!allowed || hideNav) {
        box.style.display = "none";
        box.setAttribute("data-fh-gated", "1");
      } else if (box.hasAttribute("data-fh-gated")) {
        box.style.display = "";
        box.removeAttribute("data-fh-gated");
      }
    }
    /* Hide a nav group whose every .navitem is gated — otherwise the section
       header sits over an empty list (closer desk / sales floor / Setup). */
    var groups = document.querySelectorAll(".navgroup");
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var items = group.querySelectorAll(".navitem");
      if (!items.length) continue;
      var any = false;
      for (var j = 0; j < items.length; j++) {
        if (items[j].style.display !== "none" && !items[j].hasAttribute("data-fh-gated")) {
          any = true;
          break;
        }
      }
      if (!any) {
        group.style.display = "none";
        group.setAttribute("data-fh-gated-group", "1");
      } else if (group.hasAttribute("data-fh-gated-group")) {
        group.style.display = "";
        group.removeAttribute("data-fh-gated-group");
      }
    }
    // The nav is now telling the truth, so it can be seen.
    revealNav();
    if (role === "owner") {
      var links = document.querySelectorAll("a.navitem");
      for (var b = 0; b < links.length; b++) {
        var href = (links[b].getAttribute("href") || "").split("?")[0];
        if (BETA_PAGES.indexOf(href) !== -1 && !links[b].querySelector(".beta-badge")) {
          var badge = document.createElement("span");
          badge.className = "beta-badge";
          badge.textContent = "BETA";
          links[b].appendChild(badge);
        }
      }
    }
  }

  /* The chip is ~337px wide and sits position:fixed over the top-right corner.
     Every editor screen puts its own header buttons in that same corner
     (justify-content:space-between), and below 1200px there isn't 337px of
     clearance left, so the chip sat on top of them — clickable but invisible.
     This was "half-fixed" per-page (headers got z-index:14, which does nothing
     against a fixed element whose own z-index is astronomically higher and
     which doesn't reserve layout space either way). The real fix has to live
     here, once: below 1200px the chip drops beneath the header instead of
     sitting inside it, so the two can never occupy the same row. */
  // A second step at phone width: several screens have more than just the
  // 44-57px header to clear by then — pipeline.html's rail tabs, messaging
  // .html's search bar, agent-editor.html's wrapped two-row header — and the
  // chip's own ~337px width no longer fits with 10px to spare on a ~390px
  // screen either. 135px clears the tallest of those (agent-editor's header,
  // 125px) with a little to spare; pinned to both edges so it wraps to the
  // available width instead of running off it.
  /* The chip can be dismissed. It is fixed above everything on screens with no
     top bar, and on a 390px phone it is furniture the owner may not want during
     a call. Hidden state persists per browser, same key shape as CLIENT_KEY /
     ENTITY_KEY / ROLE_KEY above.

     Hiding it must never strand Sign out, so hiding swaps in a restore pill that
     brings the whole chip back. Both controls are 40px hit areas per
     UI-STANDARDS.md §5 and §11. */
  var CHIP_HIDDEN_KEY = "fh_chip_hidden";

  function readChipHidden() {
    try { return localStorage.getItem(CHIP_HIDDEN_KEY) === "1"; }
    catch (e) { return false; }
  }

  function writeChipHidden(hidden) {
    try {
      if (hidden) localStorage.setItem(CHIP_HIDDEN_KEY, "1");
      else localStorage.removeItem(CHIP_HIDDEN_KEY);
    } catch (e) {}
  }

  /* Always injected, unlike CHIP_BREAKPOINT_CSS which only goes in when the chip
     could not be placed in a header.

     The 40px target is grown with a transparent ::before rather than padding so
     the chip does not get taller — it sits inside real topbars whose height is
     set by the page, and on phones it wraps. 16px of separation from Sign out is
     deliberate: UI-STANDARDS §5 keeps a consequential action away from a safe
     one, and 40px of invisible target either side of a 20px glyph would
     otherwise reach into the Sign out box. */
  var CHIP_CONTROL_CSS =
    "#fh-shell-chip-hide{position:relative;pointer-events:auto;flex-shrink:0;" +
      "background:none;border:0;color:#A1A1AA;font:inherit;font-size:14px;line-height:1;" +
      "cursor:pointer;padding:0;margin-left:16px;width:20px;height:20px;" +
      "display:flex;align-items:center;justify-content:center;border-radius:6px;" +
      "-webkit-tap-highlight-color:transparent}" +
    "#fh-shell-chip-hide::before{content:'';position:absolute;left:50%;top:50%;" +
      "width:40px;height:40px;transform:translate(-50%,-50%)}" +
    "#fh-shell-chip-hide:hover{color:#fff;background:#26262B}" +
    "#fh-shell-chip-hide:focus-visible{color:#fff;outline:2px solid #A1A1AA;outline-offset:2px}" +
    "#fh-shell-chip-show{pointer-events:auto;display:none;align-items:center;" +
      "justify-content:center;min-width:40px;height:40px;padding:0 14px;flex-shrink:0;" +
      "margin-left:8px;background:#0A0A0A;color:#A1A1AA;border:1px solid #26262B;" +
      "border-radius:10px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.06em;" +
      "cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    "#fh-shell-chip-show:hover{color:#fff}" +
    "#fh-shell-chip-show:focus-visible{color:#fff;outline:2px solid #A1A1AA;outline-offset:2px}" +
    /* No header to sit in: the pill takes the chip's own fixed corner, and the
       same two breakpoints, so it never lands on page content. */
    "#fh-shell-chip-show[data-fh-fixed]{position:fixed;top:12px;right:14px;" +
      "z-index:2147483000;margin-left:0}" +
    "@media (max-width:1200px){#fh-shell-chip-show[data-fh-fixed]{top:66px;right:10px}}" +
    "@media (max-width:480px){#fh-shell-chip-show[data-fh-fixed]{top:auto;bottom:10px;right:110px}}";

  var CHIP_BREAKPOINT_CSS =
    "@media (max-width:1200px){#fh-shell-chip{top:66px !important;right:10px !important}}" +
    /* Phones: dock it to the bottom instead of hanging it at top:135px.
       135px was picked to clear the tallest page header, but it only clears
       the HEADER — on any screen whose content starts right below one (the
       Lenders tab strip, the first row of KPI cards on Hiring) the chip lands
       squarely on top of it. There is nothing at the bottom of these screens.

       top:auto has to be stated here, in this rule. Setting bottom from
       another stylesheet while this rule still pins top:135px !important does
       not move the chip, it STRETCHES it — top 135 and bottom 10 together
       resolve to a ~700px-tall black panel over most of the screen. That was
       tried and reverted before landing here.

       right:110px keeps it clear of the chat launcher in the bottom corner. */
    "@media (max-width:480px){#fh-shell-chip{top:auto !important;bottom:10px !important;" +
    "left:10px !important;right:110px !important;" +
    "flex-wrap:wrap;gap:6px !important;padding:6px 9px !important;font-size:var(--fs-caption) !important}}";

  /* Search sits fixed to the LEFT of the Sign-out chip. Pages that put action
     buttons in the topbar (agent editor "+ New", products "+ Add product") must
     clear BOTH. A hard-coded right:360px left Search overlapping those buttons
     after global search shipped — Playwright caught clicks landing on Search.
     layoutShellChrome() measures the real widths and publishes
     --fh-shell-top-clearance so topbars can pad once and stay clear.

     Medium screens used to park Search and the chip on the SAME top/right
     corner (both top:66 right:10) — they stacked and ate clicks. Search now
     sits left of the chip at every breakpoint, measured in layoutShellChrome. */
  function layoutShellChrome() {
    var chip = document.getElementById("fh-shell-chip");
    var search = document.getElementById("fh-shell-search-btn");
    if ((chip && chip.getAttribute("data-fh-in-header")) ||
        (search && search.getAttribute("data-fh-in-header"))) {
      try { document.documentElement.style.setProperty("--fh-shell-top-clearance", "14px"); } catch (e) {}
      return;
    }
    var gap = 10;
    var edge = 14;
    var clear = edge;
    var narrow = window.matchMedia && window.matchMedia("(max-width:1200px)").matches;
    var phone = window.matchMedia && window.matchMedia("(max-width:480px)").matches;
    /* A hidden chip is not 337px of anything. offsetWidth reads 0 while it is
       display:none and `|| 337` would silently restore the old reservation,
       leaving every topbar padded for a bar that is not on screen and parking
       Search a chip-width from the edge. Measure the restore pill instead —
       that is what actually occupies the corner once the chip is dismissed. */
    var showPill = document.getElementById("fh-shell-chip-show");
    var chipHidden = !!(chip && chip.style.display === "none");
    var chipW = 0;
    if (chip) {
      chipW = chipHidden
        ? ((showPill && showPill.offsetWidth) || 74)
        : (chip.offsetWidth || 337);
    }
    if (chip) {
      clear += chipW + gap;
    }
    if (search && chip) {
      // Always dock Search immediately left of the chip (same row), never on
      // top of it. Phone: chip wraps full width lower; Search stays above chip
      // on the right so it does not cover sidebar / topbar actions.
      if (phone) {
        /* The chip is docked to the bottom on phones now (CHIP_BREAKPOINT_CSS),
           so Search no longer has to sit above it. top:135px put this pill on
           top of whatever the screen renders below its header — the Lenders
           notice box, for one. Park it bottom-right, above the chat launcher,
           where the chip and the launcher already live and nothing else does.
           clear stays at the edge: neither control is beside the topbar any
           more, so topbars need no horizontal clearance from them. */
        search.style.top = "auto";
        search.style.bottom = "78px";
        search.style.left = "auto";
        search.style.right = edge + "px";
        clear = edge;
      } else if (narrow) {
        search.style.top = "66px";
        search.style.left = "auto";
        search.style.right = (edge + (chipW || 200) + gap) + "px";
        clear += (search.offsetWidth || 110) + gap;
      } else {
        search.style.top = "";
        search.style.left = "auto";
        search.style.right = (edge + (chipW || 337) + gap) + "px";
        clear += (search.offsetWidth || 110) + gap;
      }
    } else if (search) {
      search.style.right = edge + "px";
      search.style.left = "auto";
      clear += (search.offsetWidth || 110) + gap;
    }
    try {
      document.documentElement.style.setProperty("--fh-shell-top-clearance", clear + "px");
      // Pages with a topbar of action buttons: pad the right so Search/chip
      // never cover "+ New" / Save. Harmless if a page has no .topbar.
      var styleId = "fh-shell-clearance-style";
      var st = document.getElementById(styleId);
      if (!st) {
        st = document.createElement("style");
        st.id = styleId;
        (document.head || document.documentElement).appendChild(st);
      }
      st.textContent =
        ".topbar,.top,.page-hd,.hdr-actions,.screen-actions{" +
        "padding-right:max(16px,var(--fh-shell-top-clearance,360px)) !important}" +
        /* The clearance above reserves room for the floating Search + client
           chip, which is ~360px. On a 390px phone that padding alone is wider
           than the screen, and every topbar on every screen overflowed
           sideways because of it. Below 860px the chip wraps to its own row
           instead of sitting beside the actions, so no clearance is needed. */
        "@media (max-width:860px){" +
        ".topbar,.top,.page-hd,.hdr-actions,.screen-actions{" +
        "padding-right:16px !important}}";
    } catch (e) { /* ignore */ }
  }

  /* External principals stay on their own surface — search is staff CRM chrome. */
  var SEARCH_SKIP_ROLES = { client: 1, affiliate: 1, partner: 1 };

  /* FH-SEARCH-BEGIN */
  /* Pure helpers for the global search overlay. Extracted so src/http/search-
     screen.test.mjs can drive them without a browser. */
  function searchGroupLabels() {
    return {
      clients: "Clients",
      contracts: "Contracts",
      documents: "Documents",
      conversations: "Conversations",
      cards: "Pipeline"
    };
  }

  function searchGroupOrder() {
    return ["clients", "contracts", "documents", "conversations", "cards"];
  }

  function searchEmptyCopy(q) {
    var term = String(q == null ? "" : q).trim();
    if (!term) return "Type a name, email, phone, or anything else you remember.";
    return "No matches for \u201c" + term + "\u201d.";
  }

  function searchTotal(groups) {
    var g = groups || {};
    var n = 0;
    var order = searchGroupOrder();
    for (var i = 0; i < order.length; i++) {
      var rows = g[order[i]];
      if (Array.isArray(rows)) n += rows.length;
    }
    return n;
  }

  function searchRenderGroups(groups, escFn) {
    var g = groups || {};
    var labels = searchGroupLabels();
    var order = searchGroupOrder();
    var html = "";
    var total = 0;
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var rows = Array.isArray(g[key]) ? g[key] : [];
      if (!rows.length) continue;
      total += rows.length;
      html += '<div class="fh-search-group" data-group="' + escFn(key) + '">' +
        '<div class="fh-search-ghead">' + escFn(labels[key] || key) +
        ' <span class="fh-search-n">' + rows.length + "</span></div>";
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j] || {};
        html += '<a class="fh-search-hit" href="' + escFn(row.href || "#") + '">' +
          '<span class="fh-search-title">' + escFn(row.title || "Untitled") + "</span>" +
          '<span class="fh-search-sub">' + escFn(row.subtitle || "") + "</span>" +
          "</a>";
      }
      html += "</div>";
    }
    return { html: html, total: total };
  }

  if (typeof window !== "undefined") {
    window.FHSearch = {
      groupLabels: searchGroupLabels,
      groupOrder: searchGroupOrder,
      emptyCopy: searchEmptyCopy,
      total: searchTotal,
      renderGroups: searchRenderGroups
    };
  }
  /* FH-SEARCH-END */

  function mountSearch(staff, demo) {
    var role = normRole(staff && staff.role);
    if (SEARCH_SKIP_ROLES[role]) return;

    var style = document.createElement("style");
    style.id = "fh-shell-search-style";
    style.textContent =
      "#fh-shell-search-btn{display:flex;align-items:center;gap:8px;background:#fff;color:#0A0A0A;" +
      "border:1px solid #E4E4E7;border-radius:10px;padding:8px 12px;" +
      "font:500 12px/1 Inter,system-ui,sans-serif;cursor:pointer;flex-shrink:0;margin-left:8px}" +
      /* top/right overwritten by layoutShellChrome() once the chip is measured */
      "#fh-shell-search-btn .fh-k{font:600 10px/1 'JetBrains Mono',monospace;" +
      "letter-spacing:.04em;color:#71717A;border:1px solid #E4E4E7;border-radius:5px;" +
      "padding:3px 5px;background:#FAFAFA}" +
      "#fh-shell-search-overlay{position:fixed;inset:0;z-index:2147483600;" +
      "background:rgba(10,10,10,.45);display:none;align-items:flex-start;" +
      "justify-content:center;padding:12vh 16px 24px}" +
      "#fh-shell-search-overlay.open{display:flex}" +
      "#fh-shell-search-panel{width:min(560px,100%);background:#fff;color:#0A0A0A;" +
      "border:1px solid #E4E4E7;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.28);" +
      "overflow:hidden}" +
      "#fh-shell-search-panel .fh-search-bar{display:flex;align-items:center;gap:10px;" +
      "padding:14px 16px;border-bottom:1px solid #E4E4E7}" +
      "#fh-shell-search-panel input{flex:1;border:0;outline:0;background:transparent;" +
      "font:500 16px/1.3 Inter,system-ui,sans-serif;color:#0A0A0A}" +
      "#fh-shell-search-panel .fh-search-body{max-height:min(52vh,420px);overflow:auto}" +
      "#fh-shell-search-panel .fh-search-empty{padding:28px 18px;color:#71717A;" +
      "font:500 13px/1.45 Inter,system-ui,sans-serif;text-align:center}" +
      "#fh-shell-search-panel .fh-search-group{padding:8px 0 4px;" +
      "border-bottom:1px solid #F4F4F5}" +
      "#fh-shell-search-panel .fh-search-ghead{padding:6px 16px 4px;" +
      "font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.12em;" +
      "text-transform:uppercase;color:#71717A}" +
      "#fh-shell-search-panel .fh-search-n{opacity:.7}" +
      "#fh-shell-search-panel .fh-search-hit{display:block;padding:9px 16px;" +
      "text-decoration:none;color:inherit}" +
      "#fh-shell-search-panel .fh-search-hit:hover," +
      "#fh-shell-search-panel .fh-search-hit:focus{background:#F4F4F5;outline:0}" +
      "#fh-shell-search-panel .fh-search-title{display:block;font:600 13.5px/1.3 Inter,system-ui,sans-serif}" +
      "#fh-shell-search-panel .fh-search-sub{display:block;margin-top:2px;" +
      "font:500 11.5px/1.35 Inter,system-ui,sans-serif;color:#71717A}";
    (document.head || document.documentElement).appendChild(style);

    var mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
    var chord = mac ? "\u2318K" : "Ctrl K";

    var btn = document.createElement("button");
    btn.id = "fh-shell-search-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Search the CRM");
    btn.innerHTML = "<span>Search</span><span class=\"fh-k\">" + esc(chord) + "</span>";
    if (!placeInHeader(btn)) document.body.appendChild(btn);

    var overlay = document.createElement("div");
    overlay.id = "fh-shell-search-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Search");
    overlay.innerHTML =
      '<div id="fh-shell-search-panel">' +
        '<div class="fh-search-bar">' +
          '<span aria-hidden="true">\u2315</span>' +
          '<input id="fh-shell-search-input" type="search" autocomplete="off" ' +
            'spellcheck="false" placeholder="Search clients, contracts, messages\u2026">' +
        "</div>" +
        '<div class="fh-search-body" id="fh-shell-search-results">' +
          '<div class="fh-search-empty">' + esc(searchEmptyCopy("")) + "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    var input = document.getElementById("fh-shell-search-input");
    var results = document.getElementById("fh-shell-search-results");
    var timer = null;
    var seq = 0;

    function openSearch() {
      overlay.classList.add("open");
      if (input && input.focus) input.focus();
      if (input && input.select) input.select();
    }
    function closeSearch() {
      overlay.classList.remove("open");
    }

    function paintEmpty(q, note) {
      results.innerHTML = '<div class="fh-search-empty">' +
        esc(note || searchEmptyCopy(q)) + "</div>";
    }

    function runSearch(q) {
      var term = String(q || "").trim();
      if (!term) {
        paintEmpty("");
        return;
      }
      var my = ++seq;
      results.innerHTML = '<div class="fh-search-empty">Searching\u2026</div>';

      function done(res) {
        if (my !== seq) return;
        if (!res || !res.ok) {
          var why = (res && res.source === "demo")
            ? "Demo session — search needs a real sign-in."
            : (res && res.source === "unauthorized")
              ? "Not signed in — search needs a real session."
              : "Search could not run. Try again in a moment.";
          paintEmpty(term, why);
          return;
        }
        var groups = (res.data && res.data.groups) || {};
        var painted = searchRenderGroups(groups, esc);
        if (!painted.total) {
          paintEmpty(term);
          return;
        }
        results.innerHTML = painted.html;
      }

      if (window.FHData && typeof window.FHData.search === "function") {
        window.FHData.search({ q: term }).then(done);
        return;
      }
      var t = "";
      try { t = localStorage.getItem("fh_token") || ""; } catch (e) { t = ""; }
      if (demo || t === "demo") {
        done({ ok: false, source: "demo" });
        return;
      }
      fetch("/api/read/search?q=" + encodeURIComponent(term), {
        headers: t
          ? { accept: "application/json", authorization: "Bearer " + t }
          : { accept: "application/json" }
      }).then(function (r) {
        return r.json().then(function (d) {
          if (r.status === 401 || r.status === 403) {
            return { ok: false, source: "unauthorized" };
          }
          if (!d || d.ok !== true) return { ok: false, source: "server", error: d && d.error };
          return { ok: true, source: "api", data: d };
        });
      }).then(done).catch(function () {
        done({ ok: false, source: "offline" });
      });
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openSearch();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeSearch();
    });
    input.addEventListener("input", function () {
      var q = input.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { runSearch(q); }, 180);
    });

    document.addEventListener("keydown", function (e) {
      var key = e.key || "";
      if ((e.metaKey || e.ctrlKey) && (key === "k" || key === "K")) {
        e.preventDefault();
        if (overlay.classList.contains("open")) closeSearch();
        else openSearch();
        return;
      }
      if (key === "Escape" && overlay.classList.contains("open")) {
        e.preventDefault();
        closeSearch();
      }
    });
  }

  function placeInHeader(el) {
    var right = document.querySelector(".topbar-right");
    var bar = document.querySelector(
      ".topbar, .top, .page-hd, body > header, .app > header, .app-shell > header"
    );
    if (right) {
      right.appendChild(el);
      el.setAttribute("data-fh-in-header", "1");
      return true;
    }
    if (bar) {
      bar.appendChild(el);
      el.setAttribute("data-fh-in-header", "1");
      return true;
    }
    /* Some surviving screens have no named top bar. Their account chip used
       to fall back to position:fixed and cover page content on phones. Give
       those screens one shared, in-flow account row instead. Search and the
       chip reuse the same row, so it reserves real space exactly once. */
    var row = document.getElementById("fh-shell-account-row");
    if (!row) {
      /* Try each host IN ORDER, innermost first — do NOT put these back into one
         grouped querySelector. A selector list returns the first match in
         DOCUMENT order, not in list order, and .app is an ANCESTOR of .shell, so
         the grouped form always resolved to .app and never to the content column
         it was written to prefer.
         That is invisible while .app is display:block (the row is just a
         full-width block, which is what my-numbers and sales-floor get). On the
         screens that set .app{display:flex} it is not: the row becomes a flex
         ITEM and takes horizontal space away from the content beside it.
         Measured on journeys at 3440 on 2026-08-27 — the row sat between the
         rail and the content and ate 718px, so the screen never reached the
         left edge no matter how wide the window got. */
      var host = null;
      var hostSel = [".shell", ".main", ".content", "main", ".app-shell", ".app"];
      for (var hi = 0; hi < hostSel.length && !host; hi++) {
        host = document.querySelector(hostSel[hi]);
      }
      if (!host) return false;
      row = document.createElement("div");
      row.id = "fh-shell-account-row";
      row.className = "fh-shell-account-row";
      host.insertBefore(row, host.firstChild);
    }
    row.appendChild(el);
    el.setAttribute("data-fh-in-header", "1");
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     THE CLOCK — ON EVERY STAFF SCREEN, IN ARIZONA TIME (owner-set 2026-08-28)

     Two separate faults, one fix.

     1. Fourteen screens were built without a clock at all. Nothing was hiding
        it; there was never one in the markup.
     2. The screens that DO have one hide it under 1600px (pipeline), 1560px
        (client control panel) and at phone width (messaging, automations). On
        a laptop the pipeline topbar therefore showed no time whatsoever — which
        is the screenshot the owner sent. A clock that vanishes on the machine
        the owner actually uses is the same as no clock.

     So: the shell mounts one where a page has none, and un-hides the ones a
     page hides, shrinking to a time-only face on a narrow bar rather than
     disappearing. It stays hidden below 900px, where the topbar genuinely has
     no room and the date is not what anybody opened the phone for.

     ZONE: America/Phoenix. Not Eastern, and deliberately NOT the viewer's own
     machine — everyone reading these screens is reading about work done on
     Arizona time, and a laptop still set to Eastern would quietly disagree with
     the server. Arizona does not observe daylight saving, so the label reads MST
     all year and the hour never jumps. Every per-page tickClock moved to the
     same zone in the same change.

     OWNERSHIP: this ticks only the element it created. Pages that already drive
     their own clock keep driving it, so no element has two writers competing at
     one-second intervals. ══════════════════════════════════════════════════ */
  var CLOCK_TZ = "America/Phoenix";
  var CLOCK_WIDE_AT = 1200;

  /* Below this the clock is not shown at all.

     It was 900px, chosen by eye. Measured: at 1024 the clock added 58px to the
     agent-editor and products-commissions top bars and 50px to lenders — those
     bars have already wrapped to two rows at that width, and the clock pushed
     them to three, which shoves the page down under them. At 1440 and 1920 it
     adds exactly nothing on every screen checked, measured with the same page
     loaded twice and only this one call switched off.

     So the cut-off is where the bars start wrapping, not where the text stops
     fitting. Nobody runs the CRM in a 1024px window to read the date. */
  var CLOCK_HIDE_AT = 1100;

  /* The face. Wide bars get the weekday and date the closer dashboard has
     always shown; narrow ones get the time alone, because the date is the part
     you can drop without losing the answer to "what time is it". */
  function clockFace(now, wide) {
    var opts = {
      hour: "numeric", minute: "2-digit", second: "2-digit",
      timeZone: CLOCK_TZ, timeZoneName: "short"
    };
    if (wide) {
      opts.weekday = "short";
      opts.month = "short";
      opts.day = "numeric";
    }
    try {
      return now.toLocaleString("en-US", opts);
    } catch (e) {
      /* No Intl, or a build without the zone. An empty clock is honest; a clock
         showing the browser's own zone while claiming to be Arizona is not. */
      return "";
    }
  }

  /* Screens that are a CUSTOMER's view, whoever happens to be signed in.
     An office clock belongs on a staff desk, not on the page a client reads.

     This was `role === "client"` and that was the wrong question. Role is who
     is LOOKING; these are about WHICH SCREEN. Consent capture is only ever
     opened by a staff member, so the role test never fired and it got a clock —
     measured on the deployed site, not guessed. The client portal has the
     mirror-image hole: a staff member opening it to check on somebody would
     have put a clock on a customer surface too. */
  var CUSTOMER_SCREENS = ["client-portal.html", "consent-capture.html"];

  function mountClock(role) {
    if (role === "client") return;
    if (CUSTOMER_SCREENS.indexOf(PAGE) !== -1) return;

    /* Un-hide whatever the page already has, and give every clock on every
       screen one size. !important is required twice over: once to beat the
       page's own display:none media queries, and once to beat
       fundhub-brand.css's `:is(.app,...) * {font-size:inherit !important}`,
       which is why the per-page `.clock{font-size:var(--fs-caption)}` rules
       have been painting nothing for months. */
    if (!document.getElementById("fh-shell-clock-css")) {
      var css = document.createElement("style");
      css.id = "fh-shell-clock-css";
      css.textContent =
        ".clock,#clock,#fh-shell-clock{" +
          "display:inline-block!important;" +
          "font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace!important;" +
          "font-size:12px!important;letter-spacing:.02em;line-height:1;" +
          "white-space:nowrap;flex-shrink:0;opacity:.78;" +
        "}" +
        "@media (max-width:" + CLOCK_HIDE_AT + "px){.clock,#clock,#fh-shell-clock{display:none!important;}}";
      document.head.appendChild(css);
    }

    /* A page that already has a clock keeps it — including lenders.html, whose
       clock is a bare `<span id="clock">` with no class on it. */
    if (document.querySelector(".clock, #clock")) return;

    var bar = document.querySelector(
      ".topbar, .top, .page-hd, body > header, .app > header, .app-shell > header"
    );
    /* No top bar means no "top part" to put it in. Those screens (my-numbers,
       sales-floor, journeys) get the shared account row instead, and a clock
       floating in the content column is not what was asked for. */
    if (!bar) return;

    var el = document.createElement("div");
    el.id = "fh-shell-clock";
    el.className = "clock";

    var right = bar.querySelector(".topbar-right");
    if (right) {
      /* First child: the same position it holds on the screens that shipped
         with one, so the topbars match each other. */
      right.insertBefore(el, right.firstChild);
    } else {
      /* No right-hand group. margin-left:auto makes the clock the start of the
         right-hand side, and Search and the account chip mount after it into
         the same bar, so they line up beside it instead of beside the title. */
      el.style.marginLeft = "auto";
      bar.appendChild(el);
    }

    function tick() {
      /* Read the width every tick rather than caching it. A resize listener
         would be a second thing to unregister, and this costs one layout read
         per second on a bar that is already being repainted. */
      var wide = !window.matchMedia ||
        window.matchMedia("(min-width:" + CLOCK_WIDE_AT + "px)").matches;
      el.textContent = clockFace(new Date(), wide);
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------------------------------------------------------------------
     The employee's own photo, at the head of the account chip.

     WHO GETS IT: employees, and nobody else. api/auth/session.mjs projects a
     client, affiliate or partner principal into this same staff shape, so the
     chip cannot tell them apart from a role string alone — but
     /api/staff/avatar gates on requireAuth, which accepts staff sessions only.
     Offering the control to those three would be offering a button whose only
     possible outcome is a 401: they have no staff row for a photo to hang on.
     Named here rather than derived from ROLE_TABS, because that map lists the
     three deliberately (see its own comment) and reading "external" out of it
     would be inferring a second meaning from one list.
     --------------------------------------------------------------------- */
  var AVATAR_EXTERNAL_ROLES = ["client", "affiliate", "partner"];

  /* avatarChipHtml — TWO SHAPES, ONE ID.

     A photo renders as a 22px circle. No photo renders as a small "+". Both
     carry id="fh-shell-avatar", so wireAvatarUpload() binds one selector and
     never branches on which one is on screen — including after an upload swaps
     the "+" for the photo in place.

     pointer-events:auto for the same reason Sign out sets it: the chip body is
     deliberately click-through (see mountChip), so a control inside it has to
     turn its own back on or it is dead. */
  function avatarChipHtml(avatarUrl) {
    var common = "pointer-events:auto;flex-shrink:0;cursor:pointer;padding:0;" +
      "-webkit-tap-highlight-color:transparent";
    if (avatarUrl) {
      return '<img id="fh-shell-avatar" src="' + esc(avatarUrl) + '" alt="Your photo" ' +
        'title="Change your photo" style="' + common + ';display:block;width:22px;height:22px;' +
        'border-radius:50%;object-fit:cover;border:1px solid #3F3F46">';
    }
    return '<button id="fh-shell-avatar" type="button" aria-label="Add your photo" ' +
      'title="Add your photo" style="' + common + ';display:flex;align-items:center;' +
      'justify-content:center;width:16px;height:16px;border-radius:50%;' +
      'border:1px dashed #52525B;background:none;color:#A1A1AA;font:inherit;' +
      'font-size:11px;line-height:1">+</button>';
  }

  /* wireAvatarUpload — the click, the POST, and the swap in place.

     THE FILE INPUT IS OURS. It is built here and hidden, so no screen carries
     markup for it and nothing in a page's own DOM can collide with it.

     A DEMO SESSION CANNOT UPLOAD. Demo is a localStorage object
     (fh_demo_staff), not a staff row, so there is no id to attach a photo to
     and the POST would 401. Saying so inline is the honest answer; opening a
     file picker that can only end in an error is not.

     THE AUTH HEADER IS getSession()'s, unchanged — the bearer token from
     localStorage when there is one. content-type is deliberately NOT set: the
     browser has to write the multipart boundary itself, and naming the type by
     hand omits the boundary and makes the body unparseable at the other end.
     This is also why the fetch is written here rather than through
     FHData.uploadFiles — that helper hardcodes the field name "file", this
     endpoint reads "photo", and data.js is not loaded on every screen the chip
     renders on. */
  function wireAvatarUpload(el, demo) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
    el.appendChild(input);

    /* The chip is the positioning context for the error bubble. When the chip
       could not be placed in a header it is already position:fixed, which is
       also a positioned ancestor — so only the in-header case needs this. */
    if (!el.style.position) el.style.position = "relative";

    var busy = false;
    var errTimer = null;

    function avatarEl() { return document.getElementById("fh-shell-avatar"); }

    function showError(msg) {
      var box = document.getElementById("fh-shell-avatar-err");
      if (!box) {
        box = document.createElement("div");
        box.id = "fh-shell-avatar-err";
        box.setAttribute("role", "status");
        box.style.cssText = "position:absolute;top:100%;left:0;margin-top:6px;max-width:260px;" +
          "background:#F2A69B;color:#0A0A0A;border-radius:6px;padding:5px 8px;" +
          "font:500 10px/1.35 'JetBrains Mono',monospace;letter-spacing:.04em;" +
          "pointer-events:none;z-index:1";
        el.appendChild(box);
      }
      box.textContent = msg;
      box.style.display = "block";
      if (errTimer) clearTimeout(errTimer);
      errTimer = setTimeout(function () { box.style.display = "none"; }, 4000);
    }

    function setBusy(on) {
      busy = on;
      var a = avatarEl();
      if (!a) return;
      a.style.opacity = on ? "0.45" : "";
      a.style.cursor = on ? "progress" : "pointer";
    }

    function onClick(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (busy) return;
      if (demo) {
        showError("Demo session — sign in for real to add a photo.");
        return;
      }
      /* Cleared first so picking the SAME file twice in a row still fires
         change — otherwise a retry after a failed upload does nothing. */
      input.value = "";
      input.click();
    }

    function bind() {
      var a = avatarEl();
      if (a) a.addEventListener("click", onClick);
    }

    /* swap — replace the avatar element only, never the chip around it.

       ?v= is a cache-buster. The photo lives at ONE fixed path
       (/api/staff/avatar), so a browser holding the previous one would keep
       drawing it after a replacement upload even though the bytes changed. */
    function swap(url) {
      var a = avatarEl();
      if (!a) return;
      var busted = url ? url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now() : null;
      a.outerHTML = avatarChipHtml(busted);
      bind();
      /* The two shapes are different widths (16px "+" vs 22px photo), and
         Search is positioned off the chip's MEASURED width — remeasure, same
         as setChipHidden() does for the same reason. */
      try { layoutShellChrome(); } catch (e) {}
    }

    function upload(file) {
      setBusy(true);
      var t = "";
      try { t = localStorage.getItem("fh_token") || ""; } catch (e) { t = ""; }
      var form = new FormData();
      form.append("photo", file, file.name || "photo");
      fetch("/api/staff/avatar", {
        method: "POST",
        headers: t ? { authorization: "Bearer " + t } : {},
        body: form
      }).then(function (r) {
        return r.json().then(
          function (d) { return { ok: r.ok, body: d }; },
          function () { return { ok: r.ok, body: null }; }
        );
      }).then(function (res) {
        if (!res.ok || !res.body || !res.body.ok) {
          throw new Error((res.body && (res.body.message || res.body.error)) || "could not save that photo");
        }
        /* Ask the server what the session says now rather than trusting the
           POST's own reply. The chip has to show what /api/auth/session will
           report on the next page load, not a value only this tab believes. */
        return getSession();
      }).then(function (sess) {
        swap(sess && sess.staff ? sess.staff.avatarUrl : null);
        setBusy(false);
      }).catch(function (err) {
        setBusy(false);
        showError(String((err && err.message) || "could not save that photo").slice(0, 120));
      });
    }

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (file) upload(file);
    });

    bind();
  }

  function mountChip(staff, demo) {
    var el = document.createElement("div");
    el.id = "fh-shell-chip";
    /* pointer-events:none — the chip is a label, not a control surface. It is
       fixed at z-index 2147483000, above everything a screen can draw, and it
       is ~337px wide, so anything under it stopped receiving clicks: the beta
       banner's Dismiss (dead on company-brain, ops-admin; "not
       receiving pointer events" on journeys and creative-factory), header rows
       on client-control-panel and inquiry-remover, the New-person drawer's
       title and close on staff-teams, and at phone width whatever sits at the
       bottom of the screen. Clicks now pass straight through the chip's body
       to the control underneath. The one thing inside it that IS a control —
       Sign out — turns pointer events back on for itself below, so it still
       works and nothing else in here eats a click.
       Trade-off, deliberate: title tooltips on the two spans no longer appear
       on hover, because a pointer-events:none element is never hovered. The
       labels themselves are still visible. */
    el.style.cssText = "display:flex;gap:10px;align-items:center;background:#0A0A0A;color:#fff;border:1px solid #26262B;border-radius:10px;padding:8px 12px;font:500 11px/1 'JetBrains Mono',monospace;letter-spacing:.06em;flex-shrink:0;margin-left:8px";
    /* The chip names who you are and what role you hold — nothing else. It used
       to append the tab count ("closer · 6 tabs"); that number is chrome the
       owner reads past, and the sidebar in front of him already IS the list.
       The count still rides in the hover tooltip below, where it costs no
       pixels. An unrecognised role still says so outright, in amber, because
       that one is a real warning and not decoration. */
    var role = normRole(staff.role);
    var ok = allowedFor(role);
    var menu = menuFor(ok);
    var known = isKnownRole(role);
    var roleText = role;
    var roleTitle = known
      ? "role " + role + " — " + menu.length + " of " + ALL.length + " screens. Change the map in shell.js ROLE_TABS."
      : "role \"" + role + "\" is not in shell.js ROLE_TABS — falling back to the shared Work tabs. Add it to the map.";
    /* Employees only — see AVATAR_EXTERNAL_ROLES above. Everything else in the
       chip is unchanged for all three principal kinds. */
    var canAvatar = AVATAR_EXTERNAL_ROLES.indexOf(role) === -1;
    el.innerHTML =
      (canAvatar ? avatarChipHtml(staff.avatarUrl) : "") +
      '<span title="' + esc(roleTitle) + '" style="color:' + (known ? "#A1A1AA" : "#F5CE8F") + '">' +
        esc(staff.name || staff.email) + " · " + esc(roleText) + (known ? "" : " ?") + "</span>" +
      '<span id="fh-shell-src" title="checking the backend…" style="background:#3F3F46;color:#E4E4E7;border-radius:6px;padding:3px 7px;font-weight:700">···</span>' +
      '<button id="fh-shell-out" style="pointer-events:auto;background:none;border:1px solid #3F3F46;color:#E4E4E7;border-radius:6px;padding:4px 9px;font:inherit;cursor:pointer">Sign out</button>' +
      /* pointer-events:auto, same reason Sign out sets it: the chip body is
         deliberately click-through, so a control inside it has to turn its own
         back on or it is dead. Set in CHIP_CONTROL_CSS with the hit area. */
      '<button id="fh-shell-chip-hide" type="button" aria-label="Hide this bar" ' +
        'title="Hide this bar. A small ‘account’ button brings it back.">×</button>';
    var ctrlStyle = document.createElement("style");
    ctrlStyle.id = "fh-shell-chip-control-style";
    ctrlStyle.textContent = CHIP_CONTROL_CSS;
    (document.head || document.documentElement).appendChild(ctrlStyle);

    /* The way back. Sign out lives in the chip and nowhere else, so the chip may
       never become unreachable — hiding it swaps this in. */
    var showBtn = document.createElement("button");
    showBtn.id = "fh-shell-chip-show";
    showBtn.type = "button";
    showBtn.textContent = "account";
    showBtn.setAttribute("aria-label", "Show the account bar");
    showBtn.title = "Show the account bar — Sign out lives there.";

    var inHeader = placeInHeader(el);
    if (!inHeader) {
      var style = document.createElement("style");
      style.id = "fh-shell-chip-style";
      style.textContent = CHIP_BREAKPOINT_CSS;
      (document.head || document.documentElement).appendChild(style);
      el.style.position = "fixed";
      el.style.top = "12px";
      el.style.right = "14px";
      el.style.zIndex = "2147483000";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
    }
    /* Follow the chip: in the header it sits in that same row and takes real
       space, so nothing reflows when the two swap. Fixed only when the chip is
       fixed, on the chip's own corner and breakpoints. */
    if (inHeader && el.parentNode) {
      el.parentNode.insertBefore(showBtn, el.nextSibling);
    } else {
      showBtn.setAttribute("data-fh-fixed", "1");
      document.body.appendChild(showBtn);
    }

    function setChipHidden(hidden) {
      el.style.display = hidden ? "none" : "flex";
      showBtn.style.display = hidden ? "flex" : "none";
      el.setAttribute("aria-hidden", hidden ? "true" : "false");
      writeChipHidden(hidden);
      // Search is positioned off the chip's measured width — remeasure both ways.
      try { layoutShellChrome(); } catch (e) {}
    }

    document.getElementById("fh-shell-out").addEventListener("click", signOut);
    if (canAvatar) wireAvatarUpload(el, demo);
    document.getElementById("fh-shell-chip-hide").addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setChipHidden(true);
      showBtn.focus();
    });
    showBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setChipHidden(false);
    });
    setChipHidden(readChipHidden());

    /* One badge, the truth about this screen's data. A screen drawing its
       built-in sample rows must not look like one reading the database. */
    var TONE = {
      live:    { bg: "#A8D8B0", fg: "#0A0A0A" },   // mint  — real data
      nodb:    { bg: "#F5CE8F", fg: "#0A0A0A" },   // peach — API up, no database
      offline: { bg: "#F2A69B", fg: "#0A0A0A" }    // rose  — no API at all
    };
    backendState().then(function (st) {
      var b = document.getElementById("fh-shell-src");
      if (!b) return;
      // Signed in from localStorage means these rows are sample data whatever
      // the backend says, so demo wins the label.
      var code = demo ? (st.code === "live" ? "nodb" : st.code) : st.code;
      var label = demo ? "DEMO" : st.label;
      var tone = TONE[code] || TONE.offline;
      b.style.background = tone.bg;
      b.style.color = tone.fg;
      b.textContent = label;
      b.title = (demo ? "demo session — screens show built-in sample data. " : "") + st.hint;
    });
  }

  /* applyBrand — this company's CRM tokens over the CSS custom properties, at
     boot. See docs/specs/BRAND-THEMING-SPEC.md.

     CRM chrome comes from /api/org-brand, and WHOSE brand that endpoint answers
     with now depends on who is asking. A partner gets their own partner_brand
     row; staff, affiliates and clients get the org row.

     SUPERSEDED, KEPT SO NOBODY RE-READS THE OLD RULE AS CURRENT. Until
     2026-08-31 this comment said "CRM chrome comes from /api/org-brand, never
     from partner_brand. A partner editing their funnel tokens must not recolor
     Fundhub staff screens." The second half is still true and still enforced —
     a partner writes partner_brand only, and the org row they cannot touch is
     what Fundhub staff paint from. What the owner reversed is the first half: a
     white-label partner used to sign in and see Fundhub's colours, type and
     wordmark on every CRM screen, which is the thing white-label exists to
     prevent. The branch lives in api/org-brand.mjs, not here. See
     docs/specs/BRAND-THEMING-SPEC.md.

     FALLS BACK TO FUNDHUB. No session, no row, or a failed request leave the
     stylesheet untouched — the default brand is what the page already has, so
     doing nothing IS the fallback.

     Applies ink, paper, spectrum and accent (from the six-stop ramp), Google
     Font faces, and the wordmark. NOT the four status colours — see paintBrand
     for why they are now left alone. */
  function rampToSpectrum(ramp) {
    return "linear-gradient(90deg," + ramp.map(function (c, i) {
      return c + " " + Math.round(i * 100 / (ramp.length - 1)) + "%";
    }).join(",") + ")";
  }

  function safeWordmark(url) {
    var s = String(url || "").trim();
    if (!s) return null;
    if (/^https:\/\/[^\s"'<>()]+$/i.test(s)) return s;
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
    return null;
  }

  function injectFonts(display, mono) {
    var FACE = /^[A-Za-z0-9 \-]{1,60}$/;
    var d = FACE.test(String(display || "")) ? display : null;
    var m = FACE.test(String(mono || "")) ? mono : null;
    if (!d && !m) return;
    var fams = [];
    if (d) fams.push(d.replace(/ /g, "+") + ":wght@400;600");
    if (m) fams.push(m.replace(/ /g, "+") + ":wght@400;500");
    var link = document.getElementById("fh-brand-fonts");
    if (!link) {
      link = document.createElement("link");
      link.id = "fh-brand-fonts";
      link.rel = "stylesheet";
      (document.head || document.documentElement).appendChild(link);
    }
    link.href = "https://fonts.googleapis.com/css2?family=" + fams.join("&family=") + "&display=swap";
  }

  function paintBrand(b) {
    if (!b) return;
    var root = document.documentElement;
    var HEX = /^#[0-9a-fA-F]{6}$/;
    // Re-validated here even though the table has a CHECK: a custom property
    // accepts url() and expressions, so this is the last gate before the
    // value reaches the stylesheet.
    if (HEX.test(String(b.ink || ""))) root.style.setProperty("--ink", b.ink);
    if (HEX.test(String(b.paper || ""))) root.style.setProperty("--paper", b.paper);
    if (Array.isArray(b.ramp) && b.ramp.length === 6 &&
        b.ramp.every(function (s) { return HEX.test(String(s)); })) {
      root.style.setProperty("--spectrum", rampToSpectrum(b.ramp));
      // --accent is decoration, so it follows the brand.
      root.style.setProperty("--accent", b.ramp[5]);
      /* --alert / --warn / --ok / --info ARE DELIBERATELY NOT SET HERE.
         (owner-set 2026-08-31, replacing "status stops follow the Fundhub
         pastel order".)

         Those four are read in 374 places across 43 files under public/
         (measured 2026-08-31), and every one of them is a STATE SIGNAL in a
         regulated consumer-finance product: blocked, behind, healthy.

         Nothing constrains a brand ramp to semantically sane stops, and a real
         brand guideline is very often a single-hue gradient — which painted
         stops 0, 1, 3 and 4 as four shades of one colour and made "stop, this
         is blocked" look like "all good". It already did: a test tenant's
         screens went entirely blue.

         While only Fundhub's own sensibly-chosen ramp reached the CRM, that was
         theoretical. Partners paint the CRM now, so it is not, and it would land
         on the partner's own staff — who have nobody to walk around it.

         A brand is carried by ground, ink, logo and type. Nobody experiences a
         brand through the colour of a warning badge. So these four stay
         semantic, at their fundhub-brand.css values, for everybody.

         src/ui/status-tokens-are-semantic.test.mjs fails if they come back. */
    }
    var FACE = /^[A-Za-z0-9 \-]{1,60}$/;
    if (FACE.test(String(b.display_face || ""))) {
      root.style.setProperty("--sans", "'" + b.display_face + "', system-ui, -apple-system, sans-serif");
    }
    if (FACE.test(String(b.mono_face || ""))) {
      root.style.setProperty("--mono", "'" + b.mono_face + "', ui-monospace, SFMono-Regular, monospace");
    }
    injectFonts(b.display_face, b.mono_face);
    var wm = safeWordmark(b.wordmark_url);
    if (wm) root.style.setProperty("--logo", "url(\"" + wm.replace(/"/g, "") + "\")");
    var chip = document.getElementById("fh-shell-chip");
    if (chip && b.entity_name) chip.setAttribute("data-brand", b.entity_name);
  }

  function applyBrand(/* staff */) {
    var t = "";
    try { t = localStorage.getItem("fh_token") || ""; } catch (e) { t = ""; }
    var headers = { accept: "application/json" };
    if (t) headers.authorization = "Bearer " + t;

    fetch("/api/org-brand", { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.brand) return;
        paintBrand(d.brand);
      })
      .catch(function () { /* fundhub default stays — see the comment above */ });
  }

  /* Chat widget — Ask / Knowledge / Message. Spec: docs/CRM-CHAT-WIDGET-SPEC.md.
     Affiliates and partners do not get it in v1 (owner call C-3). */
  var CHAT_SKIP_ROLES = { affiliate: 1, partner: 1 };

  function mountChatWidget(staff, demo) {
    var role = normRole(staff && staff.role);
    if (CHAT_SKIP_ROLES[role]) return;
    /* Portal chat is for a CLIENT session only. Staff opening client-portal.html
       (owner walk / prove client) still use the staff Ask/Knowledge/Message
       modes — otherwise "Message staff" posts to /api/chat/portal-message and
       gets 403 forbidden (requires principal kind client). */
    var isPortal = role === "client";
    function go() {
      if (window.FHChat && typeof window.FHChat.mount === "function") {
        var hadCall = !!(staff && staff.had_call);
        window.FHChat.mount({
          portal: isPortal,
          demo: !!demo,
          hadCall: hadCall,
          autoOpenPrecall: isPortal && !hadCall
        });
      }
    }
    if (window.FHChat) { go(); return; }
    var s = document.createElement("script");
    s.src = (location.pathname.indexOf("/app/") === 0 ? "" : "/app/") + "chat-widget.js";
    if (location.pathname.indexOf("/app/") !== 0) s.src = "/app/chat-widget.js";
    else s.src = "chat-widget.js";
    s.async = true;
    s.onload = go;
    (document.head || document.documentElement).appendChild(s);
  }

  /* Where a full-width bar may be inserted so it renders as a BAR and not as a
     COLUMN. The bar is width:100%;flex:0 0 auto, so it is only safe inside a
     container that stacks its children vertically.

     .app is a flex ROW on 30 of these screens (sidebar beside content column).
     Dropping the bar in as its first child made it a third row-item: the bar
     became a tall brown column and the real content was squeezed into a ~60px
     strip, one word per line, until the user clicked Dismiss. That was the
     Finance OS and Subscriptions collapse.

     So: use the content column (.shell or .main — every screen has one of the
     two, both are flex-column). If a screen has neither and its .app is a row,
     sit ABOVE .app rather than inside it, which is correct for any future
     screen too. Only fall back to inserting inside when .app is not a row. */
  function isRowBox(el) {
    if (!el || !window.getComputedStyle) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display !== "flex" && cs.display !== "inline-flex") return false;
    var dir = cs.flexDirection || "row";
    return dir === "row" || dir === "row-reverse";
  }

  function mountFullWidthBar(bar) {
    var col = document.querySelector(".app > .shell") || document.querySelector(".shell") ||
      document.querySelector(".app > .main") || document.querySelector(".main");
    if (col && !isRowBox(col)) { col.insertBefore(bar, col.firstChild); return; }
    var app = document.querySelector(".app");
    if (app && app.parentNode && isRowBox(app)) { app.parentNode.insertBefore(bar, app); return; }
    var host = app || document.body;
    host.insertBefore(bar, host.firstChild);
  }

  /* Driven by BETA_PAGES above — nothing else decides this. No storage: the
     dismiss button just removes the element, so it is gone for the rest of
     this page view and back the moment the page reloads or is reopened. */
  function mountBetaBanner(role) {
    if (normRole(role) !== "owner") return;
    if (BETA_PAGES.indexOf(PAGE) === -1) return;
    if (document.getElementById("fh-beta-banner")) return;
    var bar = document.createElement("div");
    bar.id = "fh-beta-banner";
    bar.setAttribute("role", "status");
    bar.setAttribute("data-fh-beta-banner", "1");
    bar.style.cssText = [
      "position:relative", "top:0", "z-index:2147482990", "width:100%",
      "flex:0 0 auto", "box-sizing:border-box", "padding:10px 16px",
      "background:#3A2A0A", "color:#FDE9C4",
      /* §3 four-step type scale. This bar used a literal 13px, a size no other
         element on the page uses, so every one of the 16 beta screens carried
         one extra text size purely because of the banner. Read the token
         instead; the literal is only the fallback if a screen has not loaded
         fundhub-brand.css. */
      "font-weight:600", "font-size:var(--fs-body,14px)", "line-height:1.35",
      "font-family:'JetBrains Mono',ui-monospace,monospace",
      "letter-spacing:.04em", "text-align:center",
      "border-bottom:2px solid var(--warn,#F5CE8F)",
      "display:flex", "gap:12px", "align-items:center", "justify-content:center",
      "flex-wrap:wrap"
    ].join(";");
    bar.innerHTML =
      "<span>Beta \u2014 under development. Data may be incomplete or inaccurate. Do not use for client decisions.</span>" +
      "<button type=\"button\" data-fh-beta-dismiss=\"1\" aria-label=\"Dismiss\" style=\"" +
      "background:none;border:1px solid var(--warn,#F5CE8F);color:#FDE9C4;border-radius:3px;" +
      "font:700 11px/1 'JetBrains Mono',ui-monospace,monospace;padding:3px 8px;cursor:pointer\">Dismiss</button>";
    mountFullWidthBar(bar);
    var dismiss = bar.querySelector("[data-fh-beta-dismiss]");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        bar.remove();
        try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
      });
    }
    try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
  }

  // Expose for Brand Studio live preview of CRM chrome.
  window.FHApplyBrand = paintBrand;

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  /* ---- pass 1: the hint, synchronous, before the screen paints ---- */
  var hinted = readCachedRole();
  if (hinted) {
    var away = routeAway(hinted);
    if (away) { location.replace(away); return; }
    var hintedOk = allowedFor(hinted);
    if (hintedOk.length) {
      settleClicks(hintedOk);
      onReady(function () { gateLinks(hintedOk, hinted); });
    }
  }
  /* No document hold on a cold load (owner-set 2026-08-05). Nav stays gated
     and clicks stay blocked until pass 2 settles the role. */

  /* ---- pass 2: the session, authoritative ---- */
  sessionPromise.then(function (sess) {
    if (!sess) {
      writeCachedRole("");
      location.href = signInUrl(true, hinted);
      return;
    }
    var role = normRole(sess.staff.role);
    var ok = allowedFor(role);
    writeCachedRole(ok.length ? role : "");
    // A role with no screens at all is a config error, not a blank page:
    // sign out rather than loop the router forever.
    if (!ok.length) { signOut(); return; }
    if (ok.indexOf(PAGE) === -1) {
      // replace(), not href: the router page must not sit in history, or
      // Back from a screen bounces straight forward again. The client rides
      // along for the same reason routeAway() carries it.
      location.replace(withClient(homeUrl(role, ok), currentClient()));
      return;
    }
    document.documentElement.classList.add("fh-page-access-confirmed");
    settleClicks(ok);
    onReady(function () {
      gateLinks(ok, role);
      mountClock(role);
      mountSearch(sess.staff, sess.demo);
      mountChip(sess.staff, sess.demo);
      mountBetaBanner(role);
      layoutShellChrome();
      if (window.addEventListener) {
        window.addEventListener("resize", layoutShellChrome);
      }
      applyBrand(sess.staff);
      mountChatWidget(sess.staff, sess.demo);
    });
  }).catch(function () {
    // Never leave nav permanently gated on an unexpected failure.
    settleClicks(allowedNow || ALL.slice());
    revealNav();
  });
})();
