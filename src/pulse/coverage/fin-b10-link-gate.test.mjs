// Finish-853 batch 10: the live link-gate check for the Client Control Panel's Closer Deck / Credit Snapshot /
// Quick launch links. This is a practice test: stand-in shell files and a stand-in GET, no live site.
//
// What it holds: the check lifts the screen lists out of shell.js exactly, works the staff roles out the way
// shell.js does, goes red naming the screen when a role that must see a link cannot, goes green when the
// screen is added, and says "skip" (never PASS, never NOT_PROVED) when the shell cannot be read. The real
// shell is read here only to prove the check is not blind to it; whether a real role sees the link is held
// by the browser test fin-b10-client-control-panel.test.mjs, which opens every role in Chromium.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SHELL_LIST_NAMES,
  STAFF_ROLE_MODE,
  judgeLinkGate,
  linkGateState,
  parseShellLists,
  plainList,
  rolesThatCanOpen,
  screensFor,
} from "./fin-b10-link-gate.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, judgeDisplayResult } from "./gap-catalog-display.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REAL_SHELL = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");

const SNAPSHOT = "More menu: Open Credit Snapshot link";
const QUICK = "Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover";

// A small stand-in shell: the same list names the real one declares, with comments that hold quotes,
// brackets and file names the way the real file's comments do.
function shellText(over = {}) {
  const lists = {
    ALL: ["closer-dashboard.html", "my-numbers.html", "sales-floor.html", "pipeline.html", "client-control-panel.html",
      "messaging.html", "calendar.html", "documents.html", "inquiry-remover.html", "lenders.html", "consent-capture.html",
      "campaign-manager.html", "hiring.html", "client-portal.html", "affiliate.html", "partner-galaxy.html",
      "staff-teams.html", "products-commissions.html", "csm-queue.html"],
    PRINCIPAL_ONLY: ["partner-galaxy.html"],
    OWNER_ADMIN_ONLY: ["campaign-manager.html"],
    CLOSER_DESK_ONLY: ["my-numbers.html"],
    SALES_FLOOR_ONLY: ["sales-floor.html"],
    PORTAL_ONLY: ["client-portal.html", "affiliate.html"],
    HIRING_ONLY: ["hiring.html"],
    FINANCE_ONLY: ["staff-teams.html", "products-commissions.html"],
    ADVISOR_ONLY: ["lenders.html"],
    CONSENT_DESK_ONLY: ["consent-capture.html"],
    STAFF_MONEY: ["financeos.html", "money.html"],
    ADMIN_BLOCKED: ["client-portal.html", "affiliate.html", "partner-galaxy.html"],
    ...over,
  };
  return Object.entries(lists).map(([name, items]) => (
    `  /* ${name} - a note with "quotes", [brackets]; and "present.html" named in prose */\n`
    + `  var ${name} = [\n    // a line note, with a "comma" and ]; in it\n    ${items.map((item) => `"${item}"`).join(", ")}\n  ];\n`
  )).join("\n");
}

function fetchOf(body, { status = 200, seen = [] } = {}) {
  const fn = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(body, { status });
  };
  fn.seen = seen;
  return fn;
}

const contract = (control) => {
  const hit = DISPLAY_TRACKING_CASES.find((entry) => entry.control === control);
  assert.ok(hit, `${control} is not tracked`);
  assert.equal(hit.contract?.mode, "link-gate", `${control} has no link-gate contract`);
  return hit;
};

test("the two rows carry link-gate contracts that name the exact screens and roles", () => {
  const snapshot = contract(SNAPSHOT);
  assert.deepEqual(snapshot.contract.links.map((l) => l.file), ["present.html"]);
  const quick = contract(QUICK);
  assert.deepEqual(quick.contract.links.map((l) => l.file), ["pipeline.html", "present.html", "messaging.html", "inquiry-remover.html"]);
  for (const entry of [snapshot, quick]) {
    assert.equal(entry.contract.sql, null);
    for (const link of entry.contract.links) {
      assert.deepEqual([...link.roles], ["owner", "closer"]);
      for (const role of link.roles) assert.ok(STAFF_ROLE_MODE[role], role);
    }
  }
  assert.equal(DISPLAY_TRACKING_CASES.filter((entry) => entry.contract?.mode === "link-gate").length, 2);
});

test("plainList lifts a list out exactly and refuses anything that is not a plain list of names", () => {
  assert.deepEqual(plainList('var A = [ "a.html", /* "x.html" ] ; */ \'b.html\', // "y.html" ]\n "c.html" ];', "A"), ["a.html", "b.html", "c.html"]);
  assert.equal(plainList('var A = [ "a.html", B.concat(["c.html"]) ];', "A"), null, "a call is not a plain list");
  assert.equal(plainList('var A = [ "a.html" + "b" ];', "A"), null, "a concatenation is not a plain list");
  assert.equal(plainList('var A = [ "a.html", /* never closed', "A"), null);
  assert.equal(plainList('var A = [ "a.html"', "A"), null);
  assert.equal(plainList("var B = [];", "A"), null, "a missing list is null");
  assert.deepEqual(plainList("var A = [];", "A"), []);
  // The name must be the whole name: ALL is not found inside OWNER_ADMIN_ONLY or MY_ALL.
  assert.equal(plainList('var MY_ALL = [ "a.html" ];', "ALL"), null);
});

test("the real shell.js is read: every list is found, and the lists match an independent reading of the file", () => {
  const lists = parseShellLists(REAL_SHELL);
  assert.ok(lists, "the real shell's lists are readable");
  for (const name of SHELL_LIST_NAMES) assert.ok(Array.isArray(lists[name]), name);
  for (const screen of ["pipeline.html", "messaging.html", "inquiry-remover.html", "closer-dashboard.html", "client-control-panel.html"]) {
    assert.ok(lists.ALL.includes(screen), `${screen} is on ALL`);
  }
  // A second way to read the same list: drop every block comment first, then take the quoted names up to the
  // first closing bracket (the way src/http/app-nav-reachability.test.mjs lifts them).
  for (const name of SHELL_LIST_NAMES) {
    const stripped = REAL_SHELL.replace(/\/\*[\s\S]*?\*\//g, "");
    const m = stripped.match(new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    assert.ok(m, name);
    const independent = (m[1].replace(/^\s*\/\/.*$/gm, "").match(/"[^"]*"/g) || []).map((s) => JSON.parse(s));
    assert.deepEqual(lists[name], independent, name);
  }
});

test("the role model matches the shell's own rules on a stand-in shell, role by role", () => {
  const lists = parseShellLists(shellText());
  const expect = {
    owner: ["pipeline.html", "my-numbers.html", "sales-floor.html", "lenders.html", "campaign-manager.html", "financeos.html", "client-portal.html"],
    admin: ["pipeline.html", "my-numbers.html", "campaign-manager.html", "financeos.html"],
    closer: ["pipeline.html", "my-numbers.html", "consent-capture.html", "financeos.html"],
    funding_advisor: ["pipeline.html", "lenders.html", "consent-capture.html"],
    sales_manager: ["pipeline.html", "sales-floor.html", "staff-teams.html", "financeos.html"],
    csm: ["pipeline.html", "consent-capture.html", "csm-queue.html"],
    setter: ["pipeline.html", "csm-queue.html"],
    inquiry_specialist: ["pipeline.html", "csm-queue.html"],
  };
  const never = {
    admin: ["client-portal.html", "affiliate.html", "partner-galaxy.html"],
    closer: ["lenders.html", "sales-floor.html", "campaign-manager.html", "staff-teams.html", "hiring.html"],
    funding_advisor: ["my-numbers.html", "financeos.html", "sales-floor.html"],
    sales_manager: ["my-numbers.html", "lenders.html", "consent-capture.html"],
    csm: ["my-numbers.html", "lenders.html", "financeos.html"],
    setter: ["my-numbers.html", "consent-capture.html", "lenders.html", "financeos.html"],
    inquiry_specialist: ["my-numbers.html", "consent-capture.html", "lenders.html", "financeos.html"],
  };
  assert.deepEqual(Object.keys(expect).sort(), Object.keys(STAFF_ROLE_MODE).sort());
  for (const [role, screens] of Object.entries(expect)) {
    const got = screensFor(lists, role);
    for (const screen of screens) assert.ok(got.includes(screen), `${role} opens ${screen}`);
    for (const screen of never[role] || []) assert.ok(!got.includes(screen), `${role} does not open ${screen}`);
  }
  assert.deepEqual(rolesThatCanOpen(lists, "lenders.html"), ["owner", "admin", "funding_advisor"]);
  assert.deepEqual(rolesThatCanOpen(lists, "my-numbers.html"), ["owner", "admin", "closer"]);
  assert.throws(() => screensFor(lists, "janitor"), /unknown staff role/);
});

test("red when a screen the link opens is on no list, and the words name the screen and the fix", () => {
  const gate = { lists: parseShellLists(shellText()) };
  for (const control of [SNAPSHOT, QUICK]) {
    const entry = contract(control);
    const out = judgeLinkGate(entry, gate);
    assert.equal(out.status, "FAIL", control);
    assert.match(out.detail, /present\.html is hidden from every staff role/);
    assert.match(out.detail, /owner, closer cannot press it/);
    assert.match(out.suggestedFix, /public\/app\/shell\.js/);
    assert.match(out.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
    assert.equal(out.id, entry.id);
  }
  // The compound row names only the screen that is wrong, not the three that work.
  const quick = judgeLinkGate(contract(QUICK), gate);
  assert.doesNotMatch(quick.detail, /pipeline\.html is hidden|messaging\.html is hidden|inquiry-remover\.html is hidden/);
});

test("green by itself once the screen is on the lists", () => {
  const gate = { lists: parseShellLists(shellText({ ALL: [...parseShellLists(shellText()).ALL, "present.html"] })) };
  for (const control of [SNAPSHOT, QUICK]) {
    const out = judgeLinkGate(contract(control), gate);
    assert.equal(out.status, "PASS", control);
    assert.match(out.detail, /present\.html/);
  }
});

test("every named link counts: the Quick launch row goes red for a working screen that is taken off the lists", () => {
  const base = parseShellLists(shellText({ ALL: [...parseShellLists(shellText()).ALL, "present.html"] }));
  assert.equal(judgeLinkGate(contract(QUICK), { lists: base }).status, "PASS");
  for (const screen of ["pipeline.html", "messaging.html", "inquiry-remover.html"]) {
    const without = { ...base, ALL: base.ALL.filter((s) => s !== screen) };
    const out = judgeLinkGate(contract(QUICK), { lists: without });
    assert.equal(out.status, "FAIL", screen);
    assert.match(out.detail, new RegExp(`${screen.replace(".", "\\.")} is hidden from every staff role`));
    // The Credit Snapshot row does not judge those screens.
    assert.equal(judgeLinkGate(contract(SNAPSHOT), { lists: without }).status, "PASS", screen);
  }
});

test("a role that must see the link is named when only some roles may open the screen", () => {
  const base = parseShellLists(shellText());
  // On ALL but taken off the shared staff surface for owner/admin only: the closer cannot, the owner can.
  const ownerOnly = { ...base, ALL: [...base.ALL, "present.html"], OWNER_ADMIN_ONLY: [...base.OWNER_ADMIN_ONLY, "present.html"] };
  const out = judgeLinkGate(contract(SNAPSHOT), { lists: ownerOnly });
  assert.equal(out.status, "FAIL");
  assert.match(out.detail, /present\.html is hidden from closer \(it opens for owner, admin\)/);
  // On the closer desk list but not on ALL: the closer can, the owner (who is handed ALL) cannot.
  const closerOnly = { ...base, CLOSER_DESK_ONLY: [...base.CLOSER_DESK_ONLY, "present.html"] };
  const out2 = judgeLinkGate(contract(SNAPSHOT), { lists: closerOnly });
  assert.equal(out2.status, "FAIL");
  assert.match(out2.detail, /present\.html is hidden from owner \(it opens for closer\)/);
  // On ALL and the closer desk list (the way my-numbers.html is): both can.
  const both = { ...base, ALL: [...base.ALL, "present.html"], CLOSER_DESK_ONLY: [...base.CLOSER_DESK_ONLY, "present.html"] };
  assert.equal(judgeLinkGate(contract(SNAPSHOT), { lists: both }).status, "PASS");
});

test("the GET is one plain GET of the deployed shell, and anything unreadable is skip, never PASS or NOT_PROVED", async () => {
  const seen = [];
  const good = await linkGateState({ fetchImpl: fetchOf(shellText(), { seen }) });
  assert.ok(good.lists);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://fundhub.ai/app/shell.js");
  assert.equal(seen[0].init.method, "GET");
  assert.equal(seen[0].init.redirect, "manual");
  assert.equal(seen[0].init.body, undefined);
  const other = await linkGateState({ fetchImpl: fetchOf(shellText(), { seen: [] }), baseUrl: "https://staging.example.test/path?x=1" });
  assert.ok(other.lists);

  const bad = [
    ["404", { fetchImpl: fetchOf("nope", { status: 404 }) }, /answered 404/],
    ["redirect", { fetchImpl: fetchOf("", { status: 302 }) }, /answered 302/],
    ["network", { fetchImpl: async () => { throw new Error("socket hang up"); } }, /could not be read by GET: socket hang up/],
    ["no client", { fetchImpl: null }, /no GET client/],
    ["not the shell", { fetchImpl: fetchOf("<html>login</html>") }, /plain lists/],
    ["empty body", { fetchImpl: fetchOf("") }, /plain lists/],
    ["invalid base", { fetchImpl: fetchOf(shellText()), baseUrl: "not a url" }, /could not be read by GET/],
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

test("the display lane judges both rows from the live shell with no database, and leaves every other row alone", async () => {
  const withPresent = shellText({ ALL: [...parseShellLists(shellText()).ALL, "present.html"] });
  const ids = [contract(SNAPSHOT).id, contract(QUICK).id];

  const seen = [];
  const red = await gapChecks({ fetchImpl: fetchOf(shellText(), { seen }) });
  assert.deepEqual(red.filter((r) => ids.includes(r.id)).map((r) => r.status), ["FAIL", "FAIL"]);
  assert.ok(seen.every((call) => call.init.method === "GET"), "only GET");
  assert.equal(seen.filter((call) => call.url.endsWith("/app/shell.js")).length, 1, "one read of the shell for both rows");

  const green = await gapChecks({ fetchImpl: fetchOf(withPresent) });
  assert.deepEqual(green.filter((r) => ids.includes(r.id)).map((r) => r.status), ["PASS", "PASS"]);

  // The shape count-not-proved.mjs uses: a stub that answers 200 with an empty body. Neither row is
  // NOT_PROVED, because both have a contract; they are skip, the honest word for "could not read it".
  const stub = await gapChecks({ fetchImpl: async () => new Response("", { status: 200 }) });
  assert.deepEqual(stub.filter((r) => ids.includes(r.id)).map((r) => r.status), ["skip", "skip"]);

  // The other rows answer the same whether the shell is red or green.
  const rest = (rows) => rows.filter((r) => !ids.includes(r.id)).map((r) => `${r.id}:${r.status}`);
  assert.deepEqual(rest(red), rest(green));

  // Asked straight, with the gate state as the second argument, the judge is the same function.
  const entry = contract(SNAPSHOT);
  assert.equal(judgeDisplayResult(entry, { lists: parseShellLists(shellText()) }).status, "FAIL");
  assert.equal(judgeDisplayResult(entry, { lists: parseShellLists(withPresent) }).status, "PASS");
});

test("the check is not blind to the real shell: it reads it and gives a real answer, never skip", async () => {
  const rows = await gapChecks({ fetchImpl: fetchOf(REAL_SHELL) });
  for (const control of [SNAPSHOT, QUICK]) {
    const row = rows.find((r) => r.id === contract(control).id);
    assert.ok(["PASS", "FAIL"].includes(row.status), `${control}: ${row.status} ${row.detail}`);
  }
});
