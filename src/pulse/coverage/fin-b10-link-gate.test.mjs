// Finish-853 batch 10: the live link-gate check for the Client Control Panel's Closer Deck / Credit Snapshot /
// Quick launch links. This is a practice test: the real shell.js and the real page of this checkout (and
// copies of them with one thing broken), a stand-in GET, no live site.
//
// What it holds: the check RUNS the deployed shell (not a model of it), so it goes red when a link is hidden
// by gate CODE as well as by a list, when a list it was never told about hides a link, when only one role
// (csm, admin, sales manager) loses a link, when the page drops a link or points it at another screen, and it
// goes green by itself once the gate lets the link through. It says "skip" (never PASS, never NOT_PROVED)
// when it cannot read or run the shell. The real browser holds the same answer for every role:
// fin-b10-client-control-panel.test.mjs opens each role in Chromium and compares.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PANEL_PATH,
  SHELL_PATH,
  STAFF_ROLES,
  judgeLinkGate,
  linkGateState,
  parsePageAnchors,
  runDeployedGates,
  screenOfHref,
} from "./fin-b10-link-gate.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, judgeDisplayResult } from "./gap-catalog-display.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REAL_SHELL = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");
const REAL_PAGE = fs.readFileSync(path.join(ROOT, "public/app/client-control-panel.html"), "utf8");

const SNAPSHOT = "More menu: Open Credit Snapshot link";
const QUICK = "Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover";

const contract = (control) => {
  const hit = DISPLAY_TRACKING_CASES.find((entry) => entry.control === control);
  assert.ok(hit, `${control} is not tracked`);
  assert.equal(hit.contract?.mode, "link-gate", `${control} has no link-gate contract`);
  return hit;
};

/** A stand-in GET that serves the two files by path. */
function site({ shell = REAL_SHELL, page = REAL_PAGE, status = {}, seen = [], throwFor = null } = {}) {
  const fn = async (url, init) => {
    seen.push({ url: String(url), init });
    const p = new URL(url).pathname;
    if (throwFor === p) throw new Error("socket hang up");
    if (p === SHELL_PATH) return new Response(shell, { status: status[p] || 200 });
    if (p === PANEL_PATH) return new Response(page, { status: status[p] || 200 });
    return new Response("not found", { status: 404 });
  };
  fn.seen = seen;
  return fn;
}

// Edits to a copy of the real shell. Each one throws if its anchor text has moved, so a stale test says so.
function edit(source, from, to) {
  assert.ok(source.includes(from), `the shell no longer contains: ${from}`);
  return source.replace(from, to);
}
// The shell as it stood before 2026-10-20 (Set A items 21/22): present.html on no list, so the gate hid both
// deck links from every role. Kept as a fixture so the red case is still proved.
const WITHOUT_DECK = edit(REAL_SHELL, '  var CLOSER_DECK = ["present.html"];', "  var CLOSER_DECK = [];");
const WITH_DECK_ON_ALL = edit(WITHOUT_DECK, '  var ALL = [\n', '  var ALL = [\n    "present.html",\n');
const gateOf = async (shell, page = REAL_PAGE) => linkGateState({ fetchImpl: site({ shell, page }) });
const verdict = async (control, shell, page) => judgeLinkGate(contract(control), await gateOf(shell, page));

// A second, independent way to know who may open a screen: lift the lists out of the source and do the same
// arithmetic as staffTabs() / allowedFor(). It is only an oracle for this file.
function listsOf(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const get = (name) => {
    const m = stripped.match(new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    assert.ok(m, name);
    return (m[1].replace(/^\s*\/\/.*$/gm, "").match(/"[^"]*"/g) || []).map((s) => JSON.parse(s));
  };
  return Object.fromEntries(["ALL", "PRINCIPAL_ONLY", "OWNER_ADMIN_ONLY", "CLOSER_DESK_ONLY", "SALES_FLOOR_ONLY", "PORTAL_ONLY",
    "HIRING_ONLY", "FINANCE_ONLY", "ADVISOR_ONLY", "CONSENT_DESK_ONLY", "STAFF_MONEY", "ADMIN_BLOCKED", "CLOSER_DECK"].map((n) => [n, get(n)]));
}
function mayOpen(lists, role, screen) {
  const off = new Set([...lists.PRINCIPAL_ONLY, ...lists.OWNER_ADMIN_ONLY, ...lists.CLOSER_DESK_ONLY, ...lists.SALES_FLOOR_ONLY,
    ...lists.PORTAL_ONLY, ...lists.HIRING_ONLY, ...lists.FINANCE_ONLY, ...lists.ADVISOR_ONLY, ...lists.CONSENT_DESK_ONLY]);
  const staff = lists.ALL.filter((s) => !off.has(s));
  const by = {
    owner: [...lists.ALL, ...lists.STAFF_MONEY, ...lists.CLOSER_DECK],
    admin: [...lists.ALL.filter((s) => !lists.ADMIN_BLOCKED.includes(s)), ...lists.STAFF_MONEY, ...lists.CLOSER_DECK],
    closer: [...staff, ...lists.CLOSER_DESK_ONLY, ...lists.CONSENT_DESK_ONLY, ...lists.STAFF_MONEY, ...lists.CLOSER_DECK],
    funding_advisor: [...staff, ...lists.ADVISOR_ONLY, ...lists.CONSENT_DESK_ONLY],
    sales_manager: [...staff, ...lists.SALES_FLOOR_ONLY, ...lists.FINANCE_ONLY, ...lists.STAFF_MONEY, ...lists.CLOSER_DECK],
    csm: [...staff, ...lists.CONSENT_DESK_ONLY],
    setter: staff,
    inquiry_specialist: staff,
  };
  return by[role].includes(screen);
}

test("the two rows carry link-gate contracts that name the exact links, screens and roles", () => {
  const snapshot = contract(SNAPSHOT);
  assert.deepEqual(snapshot.contract.links.map((l) => [l.id, l.file, l.label]), [["ccp-link-present2", "present.html", "Open Credit Snapshot"]]);
  assert.deepEqual([...snapshot.contract.links[0].roles], ["owner", "admin", "closer"]);
  const quick = contract(QUICK);
  assert.deepEqual(quick.contract.links.map((l) => [l.id, l.file]), [
    ["ccp-link-pipeline", "pipeline.html"], ["ccp-link-present", "present.html"],
    ["ccp-link-messaging", "messaging.html"], ["ccp-link-ir", "inquiry-remover.html"],
  ]);
  for (const link of quick.contract.links) {
    assert.deepEqual([...link.roles], link.file === "present.html" ? ["owner", "admin", "closer"] : [...STAFF_ROLES], link.id);
  }
  for (const entry of [snapshot, quick]) {
    assert.equal(entry.contract.sql, null);
    for (const link of entry.contract.links) for (const role of link.roles) assert.ok(STAFF_ROLES.includes(role), role);
  }
  assert.equal(DISPLAY_TRACKING_CASES.filter((entry) => entry.contract?.mode === "link-gate").length, 2);
});

test("parsePageAnchors lifts each link with its address, id and the boxes it sits in, and skips prose and scripts", () => {
  const html = `
    <!-- <a id="in-comment" href="comment.html">no</a> -->
    <ul><li class="row"><a id="one" class="btn big" href="pipeline.html?x=1">One</a></li></ul>
    <div class="card top"><div class="inner"><a id="two" href='present.html' hidden>Two</a></div></div>
    <a id="three" href=messaging.html>Three</a>
    <a name="no-href">No</a>
    <script>var t = '<a id="in-script" href="script.html">x</a>';</script>
    <style>a[href]{color:red}</style>
    <a id="four" title="a > b" href="inquiry-remover.html">Four</a>`;
  const rows = parsePageAnchors(html);
  assert.deepEqual(rows.map((r) => r.id), ["one", "two", "three", "four"]);
  assert.equal(rows[0].href, "pipeline.html?x=1");
  assert.equal(rows[0].cls, "btn big");
  assert.deepEqual(rows[0].ancestors, [{ name: "ul", cls: "" }, { name: "li", cls: "row" }]);
  assert.deepEqual(rows[1].ancestors.map((a) => a.name), ["div", "div"]);
  assert.equal(rows[1].hidden, true);
  assert.equal(rows[0].hidden, false);
  assert.equal(rows[3].href, "inquiry-remover.html", "a > inside a quoted attribute does not end the tag");
  // The real page carries the links the contracts name, once each.
  const real = parsePageAnchors(REAL_PAGE);
  for (const id of ["ccp-link-pipeline", "ccp-link-present", "ccp-link-present2", "ccp-link-messaging", "ccp-link-ir"]) {
    assert.equal(real.filter((a) => a.id === id).length, 1, id);
  }
});

test("screenOfHref reads the screen file out of an address", () => {
  assert.equal(screenOfHref("present.html?contact=abc#x"), "present.html");
  assert.equal(screenOfHref("./pipeline.html"), "pipeline.html");
  assert.equal(screenOfHref("/app/messaging.html?client_id=1"), "messaging.html");
  assert.equal(screenOfHref("/contract.html"), "", "a root page is not an app screen");
  assert.equal(screenOfHref("/elsewhere/a.html"), "", "a path outside /app/ is not a screen");
  assert.equal(screenOfHref(""), "");
  assert.equal(screenOfHref(null), "");
});

test("the real shell runs for every staff role, and its answer matches an independent reading of its lists", async () => {
  const state = await gateOf(REAL_SHELL);
  assert.ok(!state.error, state.error);
  assert.deepEqual(Object.keys(state.roles), [...STAFF_ROLES]);
  const lists = listsOf(REAL_SHELL);
  const links = { "ccp-link-pipeline": "pipeline.html", "ccp-link-present": "present.html", "ccp-link-present2": "present.html",
    "ccp-link-messaging": "messaging.html", "ccp-link-ir": "inquiry-remover.html", "ccp-link-lenders": "lenders.html" };
  for (const role of STAFF_ROLES) {
    assert.equal(state.roles[role].replaced, null, `${role} is not sent away from the control panel`);
    for (const [id, screen] of Object.entries(links)) {
      const got = state.roles[role].links[id];
      assert.ok(got, `${role}: ${id} is read`);
      // Shown and pressable exactly when the lists say the role may open the screen.
      assert.equal(got.shown && !got.blocked, mayOpen(lists, role, screen), `${role}: ${id} (${screen})`);
    }
  }
  // The funding advisor is the only role that sees the lender link among the staff roles; a closer does not.
  assert.equal(state.roles.funding_advisor.links["ccp-link-lenders"].shown, true);
  assert.equal(state.roles.closer.links["ccp-link-lenders"].shown, false);
});

test("green today: the real shell shows both deck links to owner, admin, closer and sales manager, and to no one else", async () => {
  const state = await gateOf(REAL_SHELL);
  for (const control of [SNAPSHOT, QUICK]) {
    const out = judgeLinkGate(contract(control), state);
    assert.equal(out.status, "PASS", `${control}: ${out.detail}`);
  }
  for (const role of STAFF_ROLES) {
    const may = ["owner", "admin", "closer", "sales_manager"].includes(role);
    for (const id of ["ccp-link-present", "ccp-link-present2"]) {
      const link = state.roles[role].links[id];
      assert.equal(link.shown && !link.blocked, may, `${role}: ${id}`);
    }
  }
});

test("red when present.html is on no list (the shell before 2026-10-20): no role sees either Closer Deck link, and the words name it", async () => {
  const state = await gateOf(WITHOUT_DECK);
  for (const control of [SNAPSHOT, QUICK]) {
    const entry = contract(control);
    const out = judgeLinkGate(entry, state);
    assert.equal(out.status, "FAIL", control);
    assert.equal(out.id, entry.id);
    assert.match(out.detail, /\(present\.html\) is hidden from owner, admin and closer \(it shows for no staff role\)/);
    assert.match(out.suggestedFix, /public\/app\/shell\.js/);
    assert.match(out.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
  }
  // The compound row names only the link that is wrong, not the three that work.
  const quick = judgeLinkGate(contract(QUICK), state);
  const broken = quick.detail.split("today: ")[1].split(" Required:")[0];
  assert.equal(broken, "Open Closer Deck (present.html) is hidden from owner, admin and closer (it shows for no staff role).");
});

test("green by itself once the screen is on the list, for both rows", async () => {
  const state = await gateOf(WITH_DECK_ON_ALL);
  for (const control of [SNAPSHOT, QUICK]) {
    const out = judgeLinkGate(contract(control), state);
    assert.equal(out.status, "PASS", `${control}: ${out.detail}`);
    assert.match(out.detail, /present\.html/);
  }
  // Each role's own answer is the lists' answer, and the three the contract names can press it.
  const lists = listsOf(WITH_DECK_ON_ALL);
  for (const role of STAFF_ROLES) {
    const link = state.roles[role].links["ccp-link-present"];
    assert.equal(link.shown && !link.blocked, mayOpen(lists, role, "present.html"), role);
  }
  for (const role of ["owner", "admin", "closer"]) {
    const link = state.roles[role].links["ccp-link-present2"];
    assert.equal(link.shown && !link.blocked, true, role);
  }
});

test("red when the gate hides the link in CODE and the lists are untouched (breaks a list model cannot see)", async () => {
  // I. ALL is reassigned after its literal: the list text still holds present.html, the running list does not.
  const reassigned = edit(WITH_DECK_ON_ALL, "  var ROLE_TABS = {", '  ALL = ALL.filter(function (s) { return s !== "present.html"; });\n  var ROLE_TABS = {');
  // J. gateLinks forces this one screen off, whatever the role may open.
  const forced = edit(WITH_DECK_ON_ALL, 'var allowed = ok.indexOf(file) !== -1;', 'var allowed = ok.indexOf(file) !== -1 && file !== "present.html";');
  // K. allowedFor() gives the closer nothing at all.
  const noCloser = edit(WITH_DECK_ON_ALL, 'if (m === "closer") return staffTabs()', 'if (m === "closer") return []; if (m === "closer") return staffTabs()');
  for (const [label, shell, hiddenFrom] of [
    ["list reassigned in code", reassigned, /hidden from owner, admin and closer/],
    ["gateLinks forces the screen off", forced, /hidden from owner, admin and closer/],
    ["the closer branch returns nothing", noCloser, /closer is signed out by the gate \(it has no screens at all\)/],
  ]) {
    for (const control of [SNAPSHOT, QUICK]) {
      const out = await verdict(control, shell);
      assert.equal(out.status, "FAIL", `${label}: ${control}: ${out.detail}`);
      assert.match(out.detail, hiddenFrom, label);
    }
  }
});

test("red when a list the check was never told about hides a working link", async () => {
  // A brand new list, applied inside staffTabs() only. No list name is shared with the old model.
  const shell = edit(WITH_DECK_ON_ALL, "  function staffTabs() {\n    return ALL.filter(function (s) {\n      return ",
    '  var NEW_QUIET_SCREENS = ["messaging.html"];\n  function staffTabs() {\n    return ALL.filter(function (s) {\n      return NEW_QUIET_SCREENS.indexOf(s) === -1 && ');
  const out = await verdict(QUICK, shell);
  assert.equal(out.status, "FAIL", out.detail);
  assert.match(out.detail, /Open Messaging \(messaging\.html\) is hidden from sales_manager, closer, funding_advisor, csm, setter and inquiry_specialist/);
  assert.match(out.detail, /it shows for owner and admin/);
  // The Credit Snapshot row does not judge Messaging.
  assert.equal((await verdict(SNAPSHOT, shell)).status, "PASS");
});

test("red when only one role loses a link (csm alone, then admin alone)", async () => {
  const csmOnly = edit(WITH_DECK_ON_ALL, 'if (m === "csm") return staffTabs().concat(CONSENT_DESK_ONLY);',
    'if (m === "csm") return staffTabs().concat(CONSENT_DESK_ONLY).filter(function (s) { return s !== "pipeline.html"; });');
  const csm = await verdict(QUICK, csmOnly);
  assert.equal(csm.status, "FAIL");
  assert.match(csm.detail, /Open Pipeline \(pipeline\.html\) is hidden from csm \(it shows for owner, admin, sales_manager, closer, funding_advisor, setter and inquiry_specialist\)/);
  const adminOnly = edit(WITH_DECK_ON_ALL, 'if (m === "admin") {\n      return ALL.filter(function (s) { return ADMIN_BLOCKED.indexOf(s) === -1; })',
    'if (m === "admin") {\n      return ALL.filter(function (s) { return ADMIN_BLOCKED.indexOf(s) === -1 && s !== "inquiry-remover.html"; })');
  const admin = await verdict(QUICK, adminOnly);
  assert.equal(admin.status, "FAIL");
  assert.match(admin.detail, /Open Inquiry Remover \(inquiry-remover\.html\) is hidden from admin/);
  // A role that is sent away from the page entirely is named as such, not as a hidden link.
  const gone = edit(WITH_DECK_ON_ALL, 'if (m === "csm") return staffTabs().concat(CONSENT_DESK_ONLY);',
    'if (m === "csm") return staffTabs().concat(CONSENT_DESK_ONLY).filter(function (s) { return s !== "client-control-panel.html"; });');
  const away = await verdict(QUICK, gone);
  assert.equal(away.status, "FAIL");
  assert.match(away.detail, /csm is sent away from the Client Control Panel/);
});

test("red when the deployed page drops a link or points it at another screen", async () => {
  const dropped = REAL_PAGE.replace(/<a class="link-btn" id="ccp-link-messaging"[^>]*>[\s\S]*?<\/a>/, "");
  assert.notEqual(dropped, REAL_PAGE);
  const out = await verdict(QUICK, WITH_DECK_ON_ALL, dropped);
  assert.equal(out.status, "FAIL");
  assert.match(out.detail, /Open Messaging \(messaging\.html\) is no longer on the deployed page \(id ccp-link-messaging\)/);

  const moved = REAL_PAGE.replace('id="ccp-link-ir" href="inquiry-remover.html"', 'id="ccp-link-ir" href="inquiry-removal.html"');
  assert.notEqual(moved, REAL_PAGE);
  const out2 = await verdict(QUICK, WITH_DECK_ON_ALL, moved);
  assert.equal(out2.status, "FAIL");
  assert.match(out2.detail, /Open Inquiry Remover \(inquiry-remover\.html\) points at inquiry-removal\.html on the deployed page, not at inquiry-remover\.html/);

  const twice = REAL_PAGE.replace("</body>", '<a id="ccp-link-ir" href="inquiry-remover.html">again</a></body>');
  const out3 = await verdict(QUICK, WITH_DECK_ON_ALL, twice);
  assert.equal(out3.status, "FAIL");
  assert.match(out3.detail, /on the page more than once/);
});

// Hide the Closer Deck link from everybody WHILE the gate still lets the screen through (so the click guard
// is not what turns the verdict red), and choose HOW the box is hidden.
function hidingDeckBy(how) {
  const forced = edit(WITH_DECK_ON_ALL, "if (!allowed || hideNav) {", 'if (!allowed || hideNav || file === "present.html") {');
  return edit(forced, '        box.style.display = "none";\n        box.setAttribute("data-fh-gated", "1");', how);
}
const BY_MARK = '        box.setAttribute("data-fh-gated", "1");';
const BY_DISPLAY = '        box.style.display = "none";';
const BY_FLAG = "        box.hidden = true;";
const BY_BOTH = '        box.style.display = "none";\n        box.setAttribute("data-fh-gated", "1");';

test("red when the gate hides a link by another means than display, and when the page itself hides it", async () => {
  // Same shell, same screen allowed, only HOW the box is hidden changes: every way counts as hidden.
  for (const [label, how] of [["the mark alone", BY_MARK], ["display alone", BY_DISPLAY], ["the hidden flag", BY_FLAG], ["both", BY_BOTH]]) {
    const out = await verdict(QUICK, hidingDeckBy(how));
    assert.equal(out.status, "FAIL", `${label}: ${out.detail}`);
    assert.match(out.detail, /Open Closer Deck \(present\.html\) is hidden from owner, admin and closer/, label);
    assert.doesNotMatch(out.detail, /press on it is blocked/, `${label}: it is the hiding that is reported, not the click guard`);
  }
  // The page writes the link with the hidden attribute (nothing in the check's reach would unhide it).
  const pageHidden = REAL_PAGE.replace('<a class="link-btn" id="ccp-link-messaging" href="messaging.html">', '<a class="link-btn" id="ccp-link-messaging" href="messaging.html" hidden>');
  assert.notEqual(pageHidden, REAL_PAGE);
  const hid = await verdict(QUICK, WITH_DECK_ON_ALL, pageHidden);
  assert.equal(hid.status, "FAIL", hid.detail);
  assert.match(hid.detail, /Open Messaging \(messaging\.html\) is hidden from owner/);
});

test("a link inside a list item or a card is hidden with its box, and a hidden link inside one is hidden too", async () => {
  // A small stand-in page: the shell is loaded, and each link sits in a different kind of box.
  const page = [
    '<html><body><script src="shell.js"></script>',
    '<ul><li><a id="in-li" href="present.html">Deck</a></li></ul>',
    '<div class="card"><p><a id="in-card" href="present.html">Deck</a></p></div>',
    '<ul><li><a id="hidden-in-li" href="present.html" hidden>Deck</a></li></ul>',
    '<a id="bare" href="present.html">Deck</a>',
    '</body></html>',
  ].join("\n");
  const entry = (id) => ({ id: "x", control: "stand-in", contract: { requirement: "R.", links: [{ id, file: "present.html", label: id, roles: ["owner"] }] } });
  // With the deck on the list and nothing else changed, each link is shown, pressable and passes...
  const fixed = await gateOf(WITH_DECK_ON_ALL, page);
  for (const id of ["in-li", "in-card", "bare"]) {
    const out = judgeLinkGate(entry(id), fixed);
    assert.equal(out.status, "PASS", `${id}: ${out.detail}`);
  }
  // ...a link the page itself hides, inside a list item the gate leaves alone, is still hidden...
  const hid = judgeLinkGate(entry("hidden-in-li"), fixed);
  assert.equal(hid.status, "FAIL", hid.detail);
  assert.match(hid.detail, /hidden from owner/);
  // ...and when the gate hides the BOX, however it does it, the link inside the box is hidden.
  for (const [label, how] of [["the mark alone", BY_MARK], ["display alone", BY_DISPLAY], ["the hidden flag", BY_FLAG], ["both", BY_BOTH]]) {
    const state = await gateOf(hidingDeckBy(how), page);
    for (const id of ["in-li", "in-card", "bare"]) {
      const out = judgeLinkGate(entry(id), state);
      assert.equal(out.status, "FAIL", `${label}: ${id}: ${out.detail}`);
      assert.match(out.detail, /is hidden from owner/, `${label}: ${id}`);
    }
  }
});

test("a shell that does not reach the end of its gating pass is skip, not a pass on the links it never touched", async () => {
  // gateLinks() visits every link but never reaches revealNav(): the run did not finish.
  const shell = edit(WITH_DECK_ON_ALL, "    // The nav is now telling the truth, so it can be seen.\n    revealNav();", "");
  const state = await gateOf(shell);
  assert.match(state.error || "", /did not finish gating for owner/);
  assert.equal(judgeLinkGate(contract(QUICK), state).status, "skip");
});

test("red when a shown link is blocked by the click guard", async () => {
  // The guard that holds every press until the role is known drops a press on the screen.
  const shell = edit(WITH_DECK_ON_ALL, "    if (allowedNow.indexOf(file) === -1) e.preventDefault();",
    '    if (allowedNow.indexOf(file) === -1 || file === "messaging.html") e.preventDefault();');
  const out = await verdict(QUICK, shell);
  assert.equal(out.status, "FAIL");
  assert.match(out.detail, /Open Messaging \(messaging\.html\) is shown to .* but a press on it is blocked/);
});

test("the GETs are two plain GETs, and anything unreadable or unrunnable is skip, never PASS or NOT_PROVED", async () => {
  const seen = [];
  const good = await linkGateState({ fetchImpl: site({ seen }) });
  assert.ok(!good.error, good.error);
  assert.deepEqual(seen.map((c) => new URL(c.url).pathname).sort(), [PANEL_PATH, SHELL_PATH]);
  for (const call of seen) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.init.body, undefined);
    assert.equal(new URL(call.url).origin, "https://fundhub.ai");
  }
  const other = [];
  await linkGateState({ fetchImpl: site({ seen: other }), baseUrl: "https://staging.example.test/path?x=1" });
  assert.ok(other.every((c) => new URL(c.url).origin === "https://staging.example.test"));

  const bad = [
    ["shell 404", { fetchImpl: site({ status: { [SHELL_PATH]: 404 } }) }, /deployed shell answered 404/],
    ["page 500", { fetchImpl: site({ status: { [PANEL_PATH]: 500 } }) }, /deployed Client Control Panel answered 500/],
    ["redirect", { fetchImpl: site({ status: { [SHELL_PATH]: 302 } }) }, /answered 302/],
    ["network", { fetchImpl: site({ throwFor: PANEL_PATH }) }, /could not be read by GET: socket hang up/],
    ["no client", { fetchImpl: null }, /no GET client/],
    ["not the panel", { fetchImpl: site({ page: "<html><body><a id='ccp-link-ir' href='inquiry-remover.html'>x</a></body></html>" }) }, /does not load the link gate/],
    ["empty page", { fetchImpl: site({ page: "" }) }, /does not load the link gate/],
    ["page without links", { fetchImpl: site({ page: '<script src="shell.js"></script>' }) }, /no links the check can read/],
    ["invalid base", { fetchImpl: site(), baseUrl: "not a url" }, /could not be read by GET/],
    ["shell throws", { fetchImpl: site({ shell: "throw new Error('boom');" }) }, /could not be run for owner: boom/],
    ["shell never gates", { fetchImpl: site({ shell: "/* an empty shell */" }) }, /did not take the session branch for owner/],
    ["shell is a login page", { fetchImpl: site({ shell: "<html>login</html>" }) }, /could not be run for owner/],
  ];
  for (const [label, ctx, words] of bad) {
    const state = await linkGateState(ctx);
    assert.match(state.error, words, label);
    for (const control of [SNAPSHOT, QUICK]) {
      const out = judgeLinkGate(contract(control), state);
      assert.equal(out.status, "skip", `${label}: ${control}`);
      assert.match(out.detail, /was not read/);
    }
  }
});

test("a shell that gates only some of the page's links is skip, because the run did not finish", async () => {
  // gateLinks stops after its first link: the rest would look 'shown' only because nothing touched them.
  const shell = edit(WITH_DECK_ON_ALL, "      var h = a.getAttribute(\"data-fh-href\").replace(/^\\.\\//, \"\");",
    "      if (i > 0) return;\n      var h = a.getAttribute(\"data-fh-href\").replace(/^\\.\\//, \"\");");
  const state = await gateOf(shell);
  assert.match(state.error || "", /gated only \d+ of \d+ links of the page for owner/);
  assert.equal(judgeLinkGate(contract(QUICK), state).status, "skip");
});

test("the deployed file runs isolated: no host objects, a time limit, and nothing it does reaches the host", async () => {
  const anchors = parsePageAnchors(REAL_PAGE);
  // Host objects are not there, and no constructor chain leads to one. A leak would end the worker with
  // exit code 7 ("the deployed shell run ended early (exit 7)"), not an error from the shell's own context.
  const probes = [
    "process.exit(7)",
    "require('fs')",
    "this.constructor.constructor('return process')().exit(7)",
    "globalThis.constructor.constructor('return process')().exit(7)",
    "Object.getPrototypeOf(globalThis).constructor.constructor('return process')().exit(7)",
    "(function () {}).constructor('return process')().exit(7)",
    "(async function () {}).constructor('return process')().exit(7)",
    "fetch.constructor('return process')().exit(7)",
    "localStorage.getItem.constructor('return process')().exit(7)",
    "document.createElement.constructor('return process')().exit(7)",
    "[].constructor.constructor('return process')().exit(7)",
    "new Promise(function () {}).constructor.constructor('return process')().exit(7)",
    "try { null.x; } catch (e) { e.constructor.constructor('return process')().exit(7); }",
    "try { undefinedName; } catch (e) { e.constructor.constructor('return process')().exit(7); }",
  ];
  for (const probe of probes) {
    await assert.rejects(
      () => runDeployedGates({ shell: probe, anchors, roles: ["owner"] }),
      (error) => {
        assert.match(error.message, /could not be run for owner/, probe);
        assert.doesNotMatch(error.message, /ended early|exit \d/, probe);
        return true;
      },
      probe,
    );
  }
  // A shell that never ends, and one that never stops queueing work, are cut off in bounded time.
  for (const spin of ["for (;;) {}", "function again() { Promise.resolve().then(again); } again();"]) {
    const started = Date.now();
    await assert.rejects(() => runDeployedGates({ shell: spin, anchors, roles: ["owner"] }), /could not be run for owner/, spin);
    assert.ok(Date.now() - started < 9000, `the time limit held for ${spin}`);
  }
  // The hard stop stops the thread: with a limit far under the shell's own run time, the call ends at the
  // limit (plus the time to stop the thread), not when the spin finally ends by itself.
  const spinning = "var until = Date.now() + 2500; while (Date.now() < until) {}";
  const stopStart = Date.now();
  let gone = false;
  await assert.rejects(() => runDeployedGates({
    shell: spinning, anchors, roles: ["owner"], timeoutMs: 100,
    onWorker: (worker) => worker.once("exit", () => { gone = true; }),
  }), /took too long and was stopped/);
  assert.equal(gone, true, "the thread is gone by the time the call answers");
  assert.ok(Date.now() - stopStart < 1500, `the thread was stopped at the limit (${Date.now() - stopStart} ms)`);
  // A promise nobody catches stays inside the worker: this process lives on, and the run still answers.
  const rejects = `Promise.reject(new Error("nobody catches this")); (async function () { throw new Error("nor this"); })();\n${REAL_SHELL}`;
  const ran = await runDeployedGates({ shell: rejects, anchors, roles: ["owner"] });
  assert.ok(ran.owner.links.length > 5);
  // A real run answers per role and leaves this process untouched.
  const two = await runDeployedGates({ shell: REAL_SHELL, anchors, roles: ["owner", "closer"] });
  assert.deepEqual(Object.keys(two), ["owner", "closer"]);
  assert.equal(typeof globalThis.__fh, "undefined");
  assert.equal(typeof globalThis.document, "undefined");
});

test("the display lane judges both rows from the live shell and page with no database, and leaves every other row alone", async () => {
  const ids = [contract(SNAPSHOT).id, contract(QUICK).id];

  const seen = [];
  const red = await gapChecks({ fetchImpl: site({ shell: WITHOUT_DECK, seen }) });
  assert.deepEqual(red.filter((r) => ids.includes(r.id)).map((r) => r.status), ["FAIL", "FAIL"]);
  assert.ok(seen.every((call) => call.init.method === "GET"), "only GET");
  assert.equal(seen.filter((call) => call.url.endsWith(SHELL_PATH)).length, 3,
    "one link-gate read, one retired-control read, and one hidden-head read of the live shell");
  assert.equal(seen.filter((call) => call.url.endsWith(PANEL_PATH)).length, 1, "one read of the page for both rows");

  const green = await gapChecks({ fetchImpl: site({ shell: WITH_DECK_ON_ALL }) });
  assert.deepEqual(green.filter((r) => ids.includes(r.id)).map((r) => r.status), ["PASS", "PASS"]);

  // The shape count-not-proved.mjs uses: a stub that answers 200 with an empty body. Neither row is
  // NOT_PROVED, because both have a contract; they are skip, the honest word for "could not read it".
  const stub = await gapChecks({ fetchImpl: async () => new Response("", { status: 200 }) });
  assert.deepEqual(stub.filter((r) => ids.includes(r.id)).map((r) => r.status), ["skip", "skip"]);

  // The other rows answer the same whether the gate is red or green.
  const rest = (rows) => rows.filter((r) => !ids.includes(r.id)).map((r) => `${r.id}:${r.status}`);
  assert.deepEqual(rest(red), rest(green));

  // Asked straight, with the gate state as the second argument, the judge is the same function.
  const entry = contract(SNAPSHOT);
  assert.equal(judgeDisplayResult(entry, await gateOf(WITHOUT_DECK)).status, "FAIL");
  assert.equal(judgeDisplayResult(entry, await gateOf(REAL_SHELL)).status, "PASS", "the real shell today");
  assert.equal(judgeDisplayResult(entry, await gateOf(WITH_DECK_ON_ALL)).status, "PASS");
});
