/* Tests that every screen the shell will open can actually be reached, and
 * that every screen it opens has a way back out.
 *
 * THE DEFECT THIS FILE EXISTS FOR (audit M20). finance-os.html and
 * banking-surface.html were added to the allowed list in public/app/shell.js
 * and to nothing else. No sidebar on any screen linked to either one, so the
 * only way in was typing the path by hand; and neither screen carried a single
 * link of its own, so the only way out was the browser Back button. Two
 * delivered screens that a signed-in employee could not see or leave.
 *
 * The rules under test:
 *   1. Every screen the shell lists is offered by the shared sidebar (the one
 *      partner screen the shell documents as deliberately unlinked excepted).
 *   2. The sidebar is the same on every screen that has one — it is copied
 *      inline into each file, so a row added to some and not others is a
 *      sidebar that changes as you walk around the app.
 *   3. Every screen the shell gates links back out to another screen.
 *   4. The tab count the session chip prints for a staff role is the number of
 *      sidebar rows that role is actually left looking at.
 *
 * It reads shell.js as text rather than executing it: shell.js is an IIFE that
 * redirects on load and exports nothing. The three lists are lifted out of the
 * source, so this goes red if a screen is added to the shell and nowhere else,
 * which is exactly how M20 happened.
 *
 * It lives under src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (see the traps section of CLAUDE.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SHELL_SRC = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const SIDEBAR_CSS = fs.readFileSync(path.join(APP, "crm-sidebar.css"), "utf8");

/* ── the shell's own lists, lifted from the source ────────────────────────── */

/** shellList — the string array declared as `var <name> = [ ... ];` in shell.js. */
function shellList(name) {
  const m = SHELL_SRC.match(new RegExp("var\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
  assert.ok(m, `shell.js no longer declares ${name} — this test cannot read the shell`);
  const items = (m[1].match(/"[^"]*"/g) || []).map((s) => JSON.parse(s));
  assert.ok(items.length, `shell.js ${name} parsed as empty`);
  return items;
}

const ALL = shellList("ALL");
const PRINCIPAL_ONLY = shellList("PRINCIPAL_ONLY");
const OWNER_ADMIN_ONLY = shellList("OWNER_ADMIN_ONLY");
const CLOSER_DESK_ONLY = shellList("CLOSER_DESK_ONLY");
const SALES_FLOOR_ONLY = shellList("SALES_FLOOR_ONLY");
const PORTAL_ONLY = shellList("PORTAL_ONLY");
const HIRING_ONLY = shellList("HIRING_ONLY");
const FINANCE_ONLY = shellList("FINANCE_ONLY");
const ADVISOR_ONLY = shellList("ADVISOR_ONLY");
const CONSENT_DESK_ONLY = shellList("CONSENT_DESK_ONLY");
const ADMIN_BLOCKED = shellList("ADMIN_BLOCKED");
const NAV_HIDDEN = shellList("NAV_HIDDEN");

const KEEP_ON_MENU = [
  "pipeline.html",
  "client-control-panel.html",
  "closer-dashboard.html",
  "my-numbers.html",
  "sales-floor.html",
  "calendar.html",
  "messaging.html",
  "documents.html",
  "contracts.html",
  "inquiry-remover.html",
  "products-commissions.html",
  "staff-teams.html"
];

function menuTabs(allowed) {
  return allowed.filter((s) => !NAV_HIDDEN.includes(s));
}

/** staffTabs — shell.js's own staffTabs(), the shared employee surface.
    Role-narrow extras stack on top in allowedFor(). */
const STAFF_TABS = ALL.filter(
  (s) =>
    !PRINCIPAL_ONLY.includes(s) &&
    !OWNER_ADMIN_ONLY.includes(s) &&
    !CLOSER_DESK_ONLY.includes(s) &&
    !SALES_FLOOR_ONLY.includes(s) &&
    !PORTAL_ONLY.includes(s) &&
    !HIRING_ONLY.includes(s) &&
    !FINANCE_ONLY.includes(s) &&
    !ADVISOR_ONLY.includes(s) &&
    !CONSENT_DESK_ONLY.includes(s)
);

const CLOSER_TABS = [...STAFF_TABS, ...CLOSER_DESK_ONLY, ...CONSENT_DESK_ONLY];
const SALES_MANAGER_TABS = [...STAFF_TABS, ...SALES_FLOOR_ONLY, ...FINANCE_ONLY];
const ADVISOR_TABS = [...STAFF_TABS, ...ADVISOR_ONLY, ...CONSENT_DESK_ONLY];

/* Owner still gets everything ("*"); admin does not. allowedFor() subtracts
   ADMIN_BLOCKED on the admin branch, so the two roles no longer see the same
   rail and this file can no longer describe them in one test.

   Both are modelled the way allowedFor() actually builds them — from ALL, not
   from a filter this file invented — so a role-level change cannot slip past
   the way it did while one test covered both. */
const OWNER_TABS = [...ALL];
const ADMIN_TABS = ALL.filter((s) => !ADMIN_BLOCKED.includes(s));

/* ── the screens on disk ──────────────────────────────────────────────────── */

const FILES = fs.readdirSync(APP).filter((f) => f.endsWith(".html")).sort();
const HTML = new Map(FILES.map((f) => [f, fs.readFileSync(path.join(APP, f), "utf8")]));

/** gated — the pages that load the shell, so the shell decides who sees them. */
const GATED = FILES.filter((f) => /<script(?:\s+defer)?\s+src="shell\.js">/.test(HTML.get(f)));

/** navHrefs — the sidebar rows in one file, in document order. */
function navHrefs(text) {
  const out = [];
  const re = /<a\s+class="navitem[^"]*"\s+href="([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].replace(/^\.\//, ""));
  return out;
}

/** screenLinks — every link in one file that points at another screen file. */
function screenLinks(text) {
  const out = new Set();
  const re = /<a\s[^>]*href="\.?\/?([a-z0-9-]+\.html)"/gi;
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

const WITH_SIDEBAR = GATED.filter((f) => navHrefs(HTML.get(f)).length > 0);

/* client-portal.html is the only screen ROLE_TABS.client may open (shell.js
   ROLE_TABS), so there is nowhere for it to link to. Every other gated screen
   has somewhere to go and must offer it. */
const SOLE_SCREEN_FOR_ITS_ROLE = ["client-portal.html"];

/* ── the fixture has to be honest ─────────────────────────────────────────── */

describe("app shell — the lists this test reads", () => {
  test("the shell still declares its lists and screens on disk back them", () => {
    assert.ok(ALL.length >= 20, `ALL parsed as only ${ALL.length} screens`);
    for (const s of ALL) {
      assert.ok(HTML.has(s), `shell.js lists ${s} but public/app/${s} does not exist`);
    }
    assert.deepEqual(CLOSER_DESK_ONLY, ["my-numbers.html"]);
    assert.deepEqual(SALES_FLOOR_ONLY, ["sales-floor.html"]);
    assert.deepEqual([...PORTAL_ONLY].sort(), ["affiliate.html", "client-portal.html"].sort());
    assert.deepEqual(HIRING_ONLY, ["hiring.html"]);
    assert.deepEqual(ADVISOR_ONLY, ["lenders.html"]);
    assert.deepEqual(CONSENT_DESK_ONLY, ["consent-capture.html"]);
    assert.ok(OWNER_ADMIN_ONLY.includes("contracts.html"),
      "the contract wording screen must stay owner/admin-only");
    /* ADMIN_BLOCKED is written out as a literal so shellList() can read it, which
       means it could drift from PORTAL_ONLY. It must still contain all of it:
       a client portal is not an employee desk for an admin any more than for a
       setter. partner-galaxy.html is the third member, matching gateLinks()'s
       own partner-only rule for that row. */
    for (const s of PORTAL_ONLY) {
      assert.ok(ADMIN_BLOCKED.includes(s),
        `ADMIN_BLOCKED lost ${s}, which PORTAL_ONLY still calls a principal-only screen`);
    }
    assert.ok(ADMIN_BLOCKED.includes("partner-galaxy.html"));
    assert.deepEqual(
      [...NAV_HIDDEN].sort(),
      [
        "affiliate.html",
        "agent-editor.html",
        "automations.html",
        "brand-studio.html",
        /* company-brain.html was here until 2026-08-27, when the owner put the
           row back. Removed from this fixture rather than the assertion being
           loosened: the point of the list is that a row cannot appear or vanish
           from the sidebar without someone editing this line on purpose. */
        /* campaign-manager.html, content-admin.html, creative-factory.html and
           social-studio.html were here until 2026-09-07, when the owner unhid
           the Marketing menu heading so owner/admin/partner logins can click
           to these screens instead of typing the address. Removed from this
           fixture the same way company-brain.html was, on purpose, not by
           loosening the assertion. */
        "consent-capture.html",
        "finance-os.html",
        "galaxy.html",
        "hiring.html",
        "journeys.html",
        "ops-admin.html",
        "partner-galaxy.html",
        /* The partner classroom (docs/specs/W7-curriculum.md). Like
           partner-galaxy.html it is a principal screen no employee sidebar
           offers; unlike it, there is no row in the markup at all. */
        "partner-training.html"
      ].sort()
    );
    for (const s of NAV_HIDDEN) {
      assert.ok(ALL.includes(s), `${s} left the menu but is missing from ALL — typing the URL would bounce`);
      assert.match(
        SIDEBAR_CSS,
        new RegExp(`\\[href=["']${s.replace(".", "\\.")}["']\\]`),
        `${s} is runtime-hidden but missing from the first-paint CSS — its menu row can flash before shell.js runs`
      );
    }
    /* And the other direction, which is the one that actually bit. The loop
       above proves every runtime-hidden row is also hidden at first paint. It
       says nothing about a row hidden in CSS that is NO LONGER in NAV_HIDDEN —
       so on 2026-08-27 company-brain.html came off NAV_HIDDEN, this file was
       updated, the suite went green, and the row stayed invisible on the live
       site because crm-sidebar.css was still hiding it. Two lists, one of them
       unwatched. Both directions are checked now. */
    const hideBlock = SIDEBAR_CSS.match(/\.navitem:is\(([\s\S]*?)\)\s*\{/);
    assert.ok(hideBlock, "crm-sidebar.css lost its .navitem:is(...) first-paint hide block");
    const cssHidden = [...hideBlock[1].matchAll(/\[href=["']([a-z0-9-]+\.html)["']\]/g)].map((m) => m[1]);
    assert.ok(cssHidden.length > 0, "the first-paint hide block parsed as empty");
    for (const s of new Set(cssHidden)) {
      assert.ok(
        NAV_HIDDEN.includes(s),
        `crm-sidebar.css still hides ${s} but shell.js NAV_HIDDEN does not list it — ` +
        `the row is invisible with nothing in the runtime saying so. Remove it from the CSS too.`
      );
    }

    for (const s of KEEP_ON_MENU) {
      assert.ok(!NAV_HIDDEN.includes(s), `${s} must stay on the menu`);
      assert.ok(ALL.includes(s), `${s} must stay a reachable screen`);
    }
    assert.deepEqual(
      [...FINANCE_ONLY].sort(),
      ["bank-outreach.html", "products-commissions.html", "staff-teams.html"].sort()
    );
    assert.ok(WITH_SIDEBAR.length >= 20,
      `only ${WITH_SIDEBAR.length} screens were found to carry a sidebar`);
  });
});

/* ── the defect ───────────────────────────────────────────────────────────── */

describe("app shell — every screen it opens can be reached", () => {
  test("the sidebar offers every screen the shell lists", () => {
    // partner-galaxy.html is documented in shell.js as the one screen no
    // sidebar links to: employees get the real Galaxy instead.
    const expected = ALL.filter((s) => !PRINCIPAL_ONLY.includes(s));
    const offered = new Set(navHrefs(HTML.get(WITH_SIDEBAR[0])));
    const missing = expected.filter((s) => !offered.has(s));
    assert.deepEqual(missing, [],
      `no sidebar row links to ${missing.join(", ")} — the only way in is typing ` +
        `the path by hand. Add a .navitem for each, in every screen's sidebar.`);
  });

  test("the sidebar is the same on every screen that has one", () => {
    const first = navHrefs(HTML.get(WITH_SIDEBAR[0]));
    for (const f of WITH_SIDEBAR) {
      assert.deepEqual(navHrefs(HTML.get(f)), first,
        `${f}'s sidebar differs from ${WITH_SIDEBAR[0]}'s — the nav must not ` +
          `change as you walk around the app`);
    }
  });

  test("no sidebar row points at a screen the shell has never heard of", () => {
    const stray = navHrefs(HTML.get(WITH_SIDEBAR[0])).filter((h) => !ALL.includes(h));
    assert.deepEqual(stray, [],
      `the sidebar links to ${stray.join(", ")}, which shell.js will not open`);
  });
});

describe("app shell — every screen it opens has a way out", () => {
  for (const f of GATED) {
    if (SOLE_SCREEN_FOR_ITS_ROLE.includes(f)) continue;
    if (!ALL.includes(f)) continue;      // /app/index.html is the router, not a screen

    test(`${f} links to at least one other screen`, () => {
      const out = [...screenLinks(HTML.get(f))].filter((h) => h !== f && ALL.includes(h));
      assert.ok(out.length > 0,
        `${f} contains no link to another screen — once you are on it the only ` +
          `way out is the browser Back button`);
    });
  }
});

describe("app shell — the chip's tab count matches what the sidebar shows", () => {
  const nav = () => navHrefs(HTML.get(WITH_SIDEBAR[0]));

  function visibleFor(allowed) {
    return nav().filter((h) => menuTabs(allowed).includes(h));
  }

  test("a generic staff role sees the shared staff surface only", () => {
    // setter / inquiry_specialist — no closer desk, no floor, no lender database.
    const visible = visibleFor(STAFF_TABS);
    assert.deepEqual([...visible].sort(), [...menuTabs(STAFF_TABS)].sort());
    for (const h of [...CLOSER_DESK_ONLY, ...SALES_FLOOR_ONLY, ...OWNER_ADMIN_ONLY, ...FINANCE_ONLY, ...ADVISOR_ONLY, ...CONSENT_DESK_ONLY, ...NAV_HIDDEN]) {
      assert.ok(!visible.includes(h), `generic staff must not see ${h}`);
    }
    /* api/consent/capture.mjs CONSENT_ROLES refuses setter, inquiry_specialist
       and sales_manager. Offering them the row would be a Save button that 403s
       the person looking at it. */
    assert.ok(!visible.includes("consent-capture.html"));
    assert.ok(!visible.includes("automations.html"));
  });

  /* Owner decision 2026-08-17: the lender database is the funding advisor's and
     the owner's. ROLE_SETS.LENDERS at the API, ADVISOR_ONLY in the nav — the
     two moved in the same commit so the row cannot outlive the gate. */
  test("a funding advisor sees the staff surface plus the lender database", () => {
    const visible = visibleFor(ADVISOR_TABS);
    assert.deepEqual([...visible].sort(), [...menuTabs(ADVISOR_TABS)].sort());
    assert.ok(visible.includes("lenders.html"));
    assert.ok(!visible.includes("consent-capture.html"));
    assert.ok(!visible.includes("sales-floor.html"));
  });

  test("a closer sees the closer desk, not contract wording or the sales floor", () => {
    const visible = visibleFor(CLOSER_TABS);
    assert.deepEqual([...visible].sort(), [...menuTabs(CLOSER_TABS)].sort());
    assert.ok(visible.includes("closer-dashboard.html"));
    assert.ok(visible.includes("my-numbers.html"));
    assert.ok(!visible.includes("contracts.html"));
    assert.ok(!visible.includes("consent-capture.html"));
    assert.ok(!visible.includes("sales-floor.html"));
    assert.ok(!visible.includes("lenders.html"));
  });

  test("a sales manager sees the staff surface plus sales floor, not closer desk", () => {
    const visible = visibleFor(SALES_MANAGER_TABS);
    assert.deepEqual([...visible].sort(), [...menuTabs(SALES_MANAGER_TABS)].sort());
    assert.ok(visible.includes("sales-floor.html"));
    assert.ok(visible.includes("staff-teams.html"));
    assert.ok(visible.includes("products-commissions.html"));
    assert.ok(!visible.includes("my-numbers.html"));
    assert.ok(!visible.includes("ops-admin.html"));
    assert.ok(!visible.includes("lenders.html"));
    assert.ok(!visible.includes("consent-capture.html"));
  });

  test("the owner menu is every allowed sidebar row except the kill list", () => {
    const visible = visibleFor(OWNER_TABS);
    assert.deepEqual([...visible].sort(), [...menuTabs(OWNER_TABS)].sort());
    for (const s of NAV_HIDDEN) {
      assert.ok(!visible.includes(s), `owner menu still offers ${s}`);
    }
    for (const s of KEEP_ON_MENU) {
      assert.ok(visible.includes(s), `owner menu lost ${s}`);
    }
  });

  test("killed screens leave every role menu", () => {
    for (const allowed of [STAFF_TABS, CLOSER_TABS, ADVISOR_TABS, SALES_MANAGER_TABS, OWNER_TABS, ADMIN_TABS]) {
      const visible = visibleFor(allowed);
      for (const s of NAV_HIDDEN) {
        assert.ok(!visible.includes(s), `${s} is still on a role menu`);
      }
    }
  });

  /* THE DEFECT THIS CASE EXISTS FOR (live walk 2026-08-18, admin@fundhub.ai).
     An admin was offered a Client Portal row and clicking it opened a client's
     own portal; typing /app/partner-galaxy.html opened partner Home even though
     its row was hidden. Both came from ROLE_TABS.admin being "*", which
     allowedFor() resolved to every screen with nothing subtracted.

     This case is deliberately NOT merged back with the owner's. Merging them is
     what let the old single test stay green while describing an admin rail that
     no longer exists — it derived its expectation from ALL rather than from the
     role, so it could not see a role-level change at all. */
  test("an admin does not keep the client-facing portals or partner Home", () => {
    const visible = visibleFor(ADMIN_TABS);
    assert.deepEqual([...visible].sort(), [...menuTabs(ADMIN_TABS)].sort());
    assert.ok(visible.includes("contracts.html"),
      "an admin must keep the contract wording screen");
    for (const s of ADMIN_BLOCKED) {
      assert.ok(!visible.includes(s),
        `an admin must not be offered ${s} — it is a principal's screen, not an employee desk`);
    }
    assert.ok(!visible.includes("brand-studio.html"),
      "brand-studio.html left the admin menu in the 2026-08-19 kill pass");
  });
});

/* ── ported from the second copy of this file ─────────────────────────────────
   claude/finance-os-dashboard-311v7j wrote its own app-nav-reachability.test.mjs
   without seeing this one — an add/add conflict on merge, two files with the
   same path and different assertions. Its one case that does not restate what
   is above is carried over rather than lost with the file: a link whose TARGET
   does not exist (this file only ever looked at links to screens the shell
   already knows, so a typo'd href was invisible to it).

   The companion case this section used to carry — "the Money Map is in ALL, on
   disk, and offered by every sidebar" — is gone with money-map.html itself.
   Finance OS consolidated eleven Finance screens (money-map, banking-surface,
   card-stack, bank-accounts, bills-cashflow, banking-entry, finance-command,
   finance-add, alerts, deal-model) into one, and Subscriptions moved to Setup —
   an owner decision, not a regression this file should still be guarding. */

describe("app shell — every link points at a file that is really there", () => {
  /* A SCREEN MAY LINK OUT OF /app/, AND THAT IS NOT A BROKEN LINK.
     public/ holds the pages a CUSTOMER opens — contract.html, portal-login.html,
     progress.html — and they deliberately live at the site root rather than
     under /app/, because every file in /app/ loads shell.js (which grants a
     client principal one screen) and data.js (which attaches a staff token to
     every request). public/contract.html:14-24 spells that out.

     This check used to compare every href against the /app/ listing alone, so a
     link to one of those root pages was reported as going nowhere. It now
     resolves against both directories — so a root page is still CHECKED, and a
     typo in one is still caught; what changed is that being at the root is no
     longer itself the failure. */
  const ROOT = path.resolve(HERE, "../../public");
  const ROOT_FILES = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();
  const REACHABLE = new Set([...FILES, ...ROOT_FILES]);

  test("no screen links to an .html file that does not exist", () => {
    const broken = [];
    for (const f of FILES) {
      const hrefs = [...HTML.get(f).matchAll(/href="\.?\/?([a-z0-9-]+\.html)"/gi)].map((m) => m[1]);
      for (const to of new Set(hrefs)) {
        if (!REACHABLE.has(to)) broken.push(`${f} -> ${to}`);
      }
    }
    assert.deepEqual(broken, [], "these links go nowhere:\n  " + broken.join("\n  "));
  });

  test("the customer-facing root pages link nowhere that does not exist either", () => {
    // The same check, applied to the pages the old one could not see at all.
    const broken = [];
    for (const f of ROOT_FILES) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      const hrefs = [...src.matchAll(/href="\.?\/?(?:app\/)?([a-z0-9-]+\.html)"/gi)].map((m) => m[1]);
      for (const to of new Set(hrefs)) {
        if (!REACHABLE.has(to)) broken.push(`${f} -> ${to}`);
      }
    }
    assert.deepEqual(broken, [], "these links go nowhere:\n  " + broken.join("\n  "));
  });
});
