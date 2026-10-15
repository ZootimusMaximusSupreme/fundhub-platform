// Practice test for the hidden sidebar head check (batch 19). It feeds the check the real public/app/shell.js
// from this checkout, then breaks it on purpose, one edit at a time, and shows the answer change. A reader that
// said "hidden" for everything, or "na" for what it could not read, fails here.
//
// The three heads are Home, Watch and Automation. Every row under them is on NAV_HIDDEN, so shell.js hides
// the whole section for every role. The page half (the head is not drawn, for nine roles, in Chromium) is
// src/pulse/catalog/proofs/fin-b19-shell-sidebar.test.mjs.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B19_HIDDEN_HEADS } from "../catalog/proofs/fin-b19-not-attachable.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, naVerify } from "./gap-catalog-display.mjs";
import {
  HIDDEN_HEAD_CODE,
  applyingCode,
  headClaim,
  judgeHiddenHeads,
  judgeText,
  readHeadState,
  sectionOf,
  sidebarHtml,
  stringList,
  verifyHiddenHead,
} from "./fin-b19-hidden-head.mjs";
import { isNaCode, verifyNa } from "../na-conditions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SHELL = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");

const claimOf = (head) => ({ path: "/app/shell.js", section: head.section, label: head.label });
const stateOf = (text, head) => judgeText(text, claimOf(head));

// The same list as shell.js writes it, with one row taken off it.
function withoutHidden(text, file) {
  const next = text.replace(new RegExp(`(var NAV_HIDDEN = \\[[\\s\\S]*?)"${file.replace(".", "\\.")}",?`), "$1");
  assert.notEqual(next, text, `${file} was not on the list`);
  return next;
}

function serve(text, { status = 200 } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    return new Response(text, { status });
  };
  fetchImpl.seen = seen;
  return fetchImpl;
}

// The retired Decline Autopsy page the same lane also reads, so a whole-lane run is not blind to it.
function lane(shellText, { shellStatus = 200 } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(String(url));
    assert.equal(init.method, "GET");
    const u = String(url);
    if (u.endsWith("/partner/autopsy/")) return new Response(null, { status: 302, headers: { location: "/partner/menu/" } });
    if (u.endsWith("/partner/menu/")) {
      return new Response('<h1>Four Ways In. You Can Start Anywhere.</h1><a href="/partner/">See the Partnership</a>', { status: 200 });
    }
    if (u.endsWith("/app/shell.js")) return new Response(shellText, { status: shellStatus });
    return new Response("", { status: 404 });
  };
  fetchImpl.seen = seen;
  return fetchImpl;
}

const headRows = (rows) => new Map(FIN_B19_HIDDEN_HEADS.map((head) => [head.control, rows.find((row) => row.id === head.id)]));

test("the three rows are tracked, carry their claim, and the claim names the head's key and words", () => {
  assert.equal(FIN_B19_HIDDEN_HEADS.length, 3);
  for (const head of FIN_B19_HIDDEN_HEADS) {
    const entry = DISPLAY_TRACKING_CASES.find((item) => item.id === head.id);
    assert.ok(entry, `${head.label} is not a tracked display row`);
    assert.equal(entry.contract.mode, "always-red");
    assert.deepEqual(headClaim(entry), claimOf(head));
  }
  assert.equal(isNaCode(HIDDEN_HEAD_CODE), true);
});

test("the reader understands the real shell.js: the built-in sidebar, the hidden list, and each head", () => {
  const html = sidebarHtml(SHELL);
  assert.ok(html && html.includes('data-fh-section="home"'));
  const list = stringList(SHELL, "NAV_HIDDEN");
  assert.ok(list.includes("partner-galaxy.html") && list.includes("agent-editor.html"));
  assert.equal(list.includes("pipeline.html"), false);
  for (const head of FIN_B19_HIDDEN_HEADS) {
    const section = sectionOf(html, head.section);
    assert.equal(section.label, head.label);
    assert.deepEqual(section.links, [...head.links]);
  }
});

test("on the real file each of the three heads is hidden, and the heads that are drawn are not", () => {
  for (const head of FIN_B19_HIDDEN_HEADS) {
    const got = stateOf(SHELL, head);
    assert.equal(got.state, "hidden", `${head.label}: ${got.reason || got.open}`);
    assert.deepEqual(got.links, [...head.links]);
    assert.deepEqual(got.open, []);
  }
  // Sales, Funding, Client ops, Marketing, Admin and Portals each have a row that is not hidden.
  for (const [section, label] of [["sales", "Sales"], ["funding", "Funding"], ["client-ops", "Client ops"],
    ["marketing", "Marketing"], ["admin", "Admin"], ["portals", "Portals"]]) {
    const got = judgeText(SHELL, { path: "/app/shell.js", section, label });
    assert.equal(got.state, "shown", label);
    assert.ok(got.open.length > 0, label);
  }
});

test("take one row off the hidden list: that head, and only that head, comes back as shown", () => {
  for (const head of FIN_B19_HIDDEN_HEADS) {
    for (const file of head.links) {
      const text = withoutHidden(SHELL, file);
      const broken = stateOf(text, head);
      assert.equal(broken.state, "shown", `${head.label} without ${file} on the list`);
      assert.deepEqual(broken.open, [file]);
      for (const other of FIN_B19_HIDDEN_HEADS.filter((item) => item !== head)) {
        assert.equal(stateOf(text, other).state, "hidden", `${other.label} is untouched by ${file}`);
      }
    }
  }
});

test("a head that is renamed, re-keyed, or left with no rows is not hidden, and is never read as nothing to judge", () => {
  const [home] = FIN_B19_HIDDEN_HEADS;
  const reKeyed = SHELL.replace('data-fh-section=\\"home\\"', 'data-fh-section=\\"start\\"');
  assert.notEqual(reKeyed, SHELL);
  assert.equal(stateOf(reKeyed, home).state, "changed");

  const reworded = SHELL.replace('type=\\"button\\">Home<span', 'type=\\"button\\">Start<span');
  assert.notEqual(reworded, SHELL);
  const reread = stateOf(reworded, home);
  assert.equal(reread.state, "changed");
  assert.match(reread.reason, /Start/);

  const emptied = SHELL.replace(/<a class=\\"navitem\\" href=\\"partner-galaxy\.html\\">.*?<\/a>/, "");
  assert.notEqual(emptied, SHELL);
  assert.equal(stateOf(emptied, home).state, "shown", "a head with no rows is not hidden by the chrome");
});

test("what cannot be read is unread, not hidden", async () => {
  const [home] = FIN_B19_HIDDEN_HEADS;
  const claim = claimOf(home);
  const cases = [
    ["no GET client", { fetchImpl: null }],
    ["not found", { fetchImpl: serve("nope", { status: 404 }) }],
    ["a page that is not the shared chrome", { fetchImpl: serve("<html><h1>Four Ways In</h1></html>") }],
    ["a stub that answers 200 with nothing", { fetchImpl: serve("") }],
    ["the network is down", { fetchImpl: async () => { throw new Error("offline"); } }],
    ["a base address that is not an address", { fetchImpl: serve(SHELL), baseUrl: "not a URL" }],
    ["a sidebar string with a JS-only escape", { fetchImpl: serve(SHELL.replace('var SIDEBAR_HTML = "<aside', 'var SIDEBAR_HTML = "\\x41<aside')) }],
    ["a hidden list built by a call, not written out", { fetchImpl: serve(SHELL.replace("var NAV_HIDDEN = [", "var NAV_HIDDEN = build([")) }],
    ["no hidden list at all", { fetchImpl: serve(SHELL.replace("var NAV_HIDDEN = [", "var NAV_HIDDEN_RENAMED = [")) }],
  ];
  for (const [name, ctx] of cases) {
    const got = await readHeadState(claim, ctx);
    assert.equal(got.state, "unread", `${name}: ${JSON.stringify(got)}`);
    assert.ok(got.reason, name);
  }
  // And through the judge: "skip" with the reason, never "na".
  const entry = DISPLAY_TRACKING_CASES.find((item) => item.id === home.id);
  for (const [name, ctx] of cases) {
    const row = (await judgeHiddenHeads([entry], ctx)).get(entry.id);
    assert.equal(row.status, "skip", name);
    assert.equal(row.na, undefined, name);
    assert.match(row.detail, /was not read/, name);
  }
});

test("the read is one GET with redirects left alone, and one GET answers every head", async () => {
  const fetchImpl = serve(SHELL);
  const entries = FIN_B19_HIDDEN_HEADS.map((head) => DISPLAY_TRACKING_CASES.find((item) => item.id === head.id));
  const rows = await judgeHiddenHeads(entries, { fetchImpl, baseUrl: "https://fundhub.ai" });
  assert.equal(fetchImpl.seen.length, 1);
  assert.equal(fetchImpl.seen[0].url, "https://fundhub.ai/app/shell.js");
  assert.equal(fetchImpl.seen[0].init.method, "GET");
  assert.equal(fetchImpl.seen[0].init.redirect, "manual");
  assert.equal(rows.size, 3);
  for (const row of rows.values()) {
    assert.equal(row.status, "na");
    assert.equal(row.na.code, HIDDEN_HEAD_CODE);
    assert.deepEqual(Object.keys(row.na.args).sort(), ["control", "sourceFile", "surface"]);
  }
});

test("through the whole lane: three rows say nothing to judge; take one row off the list and only its head goes back to not proved", async () => {
  const clean = headRows(await gapChecks({ fetchImpl: lane(SHELL) }));
  for (const head of FIN_B19_HIDDEN_HEADS) {
    const row = clean.get(head.control);
    assert.equal(row.status, "na", head.label);
    assert.equal(row.na.code, HIDDEN_HEAD_CODE);
    assert.match(row.detail, /no role is shown this head/);
  }

  const shown = withoutHidden(SHELL, "ops-admin.html");
  const broken = headRows(await gapChecks({ fetchImpl: lane(shown) }));
  const [home, watch, automation] = FIN_B19_HIDDEN_HEADS;
  assert.equal(broken.get(watch.control).status, "NOT_PROVED");
  assert.match(broken.get(watch.control).detail, /ops-admin\.html is not on the hidden list/);
  assert.equal(broken.get(watch.control).na, undefined);
  assert.equal(broken.get(home.control).status, "na");
  assert.equal(broken.get(automation.control).status, "na");
});

test("the morning audit asks again: true while the head is hidden, false the day a row is shown, false for a row that is not one of the three", async () => {
  const [home, watch] = FIN_B19_HIDDEN_HEADS;
  const args = (head) => ({ sourceFile: head.sourceFile, surface: head.surface, control: head.control });
  const verify = naVerify[HIDDEN_HEAD_CODE];
  assert.equal(await verify(args(home), { fetchImpl: serve(SHELL) }), true);
  assert.equal(await verify(args(watch), { fetchImpl: serve(withoutHidden(SHELL, "galaxy.html")) }), false);
  assert.equal(await verify(args(home), { fetchImpl: serve(withoutHidden(SHELL, "galaxy.html")) }), true, "Watch's change does not touch Home");
  assert.equal(await verify(args(home), { fetchImpl: serve("", { status: 200 }) }), false, "unread is not true");
  assert.equal(await verify(args(home), { fetchImpl: null }), false);
  assert.equal(await verify({ ...args(home), control: "invented" }, { fetchImpl: serve(SHELL) }), false);
  assert.equal(await verifyHiddenHead(DISPLAY_TRACKING_CASES, args(home), { fetchImpl: serve(SHELL) }), true);
});

test("the audit's own door (verifyNa) lets the row stay na while it holds, and turns it into a red row the day it does not", async () => {
  const [, watch] = FIN_B19_HIDDEN_HEADS;
  const rows = await gapChecks({ fetchImpl: lane(SHELL) });
  const row = rows.find((item) => item.id === watch.id);
  assert.equal(row.status, "na");

  const laneNaVerify = (served) => async (sliceId, code, args) => {
    assert.equal(sliceId, "catalog-display");
    return naVerify[code](args, { fetchImpl: served });
  };
  const held = await verifyNa(row, { laneNaVerify: laneNaVerify(serve(SHELL)) });
  assert.equal(held.ok, true, held.reason);
  const gone = await verifyNa(row, { laneNaVerify: laneNaVerify(serve(withoutHidden(SHELL, "galaxy.html"))) });
  assert.equal(gone.ok, false);

  // A proof copied onto a row of another kind, or with its facts cut away, is refused.
  const missing = await verifyNa({ ...row, na: { code: HIDDEN_HEAD_CODE, args: { sourceFile: "desks-e.json" } } }, { laneNaVerify: laneNaVerify(serve(SHELL)) });
  assert.equal(missing.ok, false);
});

// ---- the code that APPLIES the list (a right list and a broken gate must not read as "hidden") -------------

function mutate(text, from, to) {
  const next = text.split(from).join(to);
  assert.notEqual(next, text, `"${from.slice(0, 60)}" is not in shell.js`);
  return next;
}

// Each edit is one a person could make by hand. The list and the sidebar are untouched in every one: only the
// code that reads the list is changed, which is what the first version of this check could not see.
const GATE_BREAKS = [
  ["the hide condition stops reading the hidden mark", (t) => mutate(t, "if (!allowed || hideNav) {", "if (!allowed) {")],
  ["the section is never put away", (t) => mutate(t, "if (!any) {", "if (false) {")],
  ["the list is emptied after it is written", (t) => mutate(t, '    "partner-training.html"\n  ];', '    "partner-training.html"\n  ];\n  NAV_HIDDEN = [];')],
  ["the list is emptied at run time", (t) => mutate(t, "function menuFor(ok) {", "NAV_HIDDEN.length = 0;\n  function menuFor(ok) {")],
  ["the list is cut with splice", (t) => mutate(t, "function menuFor(ok) {", "NAV_HIDDEN.splice(0, 99);\n  function menuFor(ok) {")],
  ["a row is never marked hidden", (t) => mutate(t, 'var hideNav = a.classList.contains("navitem") && NAV_HIDDEN.indexOf(file) !== -1;', "var hideNav = false;")],
  ["a hidden row is put away with no mark", (t) => mutate(t, 'box.style.display = "none";\n        box.setAttribute("data-fh-gated", "1");', 'box.style.display = "";\n        box.setAttribute("data-fh-gated", "1");')],
  ["a section counts a put-away row as shown", (t) => mutate(t, 'items[j].style.display !== "none" && !items[j].hasAttribute("data-fh-gated")', "items[j].style.display !== \"none\"")],
  ["the session pass never runs the gate", (t) => mutate(t, "      gateLinks(ok, role);\n", "")],
  ["the sidebar is no longer the built-in one", (t) => mutate(t, "wrap.innerHTML = SIDEBAR_HTML;", "wrap.innerHTML = '';")],
];

test("a gate that no longer applies the list is not hidden: every break goes back to not proved, for all three heads", () => {
  for (const [name, edit] of GATE_BREAKS) {
    const text = edit(SHELL);
    for (const head of FIN_B19_HIDDEN_HEADS) {
      const got = stateOf(text, head);
      assert.equal(got.state, "changed", `${name}: ${head.label} read as ${got.state}`);
      assert.match(got.reason, /the code that applies the hidden list changed/, name);
    }
    // The list and the sidebar are still exactly right in each of these: this is the hole.
    assert.deepEqual(stringList(text.replace(/NAV_HIDDEN\s*=\s*\[\];|NAV_HIDDEN\.(?:length = 0|splice\(0, 99\));/g, ""), "NAV_HIDDEN"), stringList(SHELL, "NAV_HIDDEN"), name);
  }
  assert.equal(GATE_BREAKS.length, 10);
});

test("the shapes in a comment above the gate do not stand in for the gate", () => {
  const stripped = mutate(SHELL, "if (!any) {", "if (false) {");
  const decoy = stripped.replace("function gateLinks(", `/* if (!any) { group.style.display = "none"; group.setAttribute("data-fh-gated-group", "1"); } */\n  function gateLinks(`);
  assert.notEqual(decoy, stripped);
  for (const head of FIN_B19_HIDDEN_HEADS) assert.equal(stateOf(decoy, head).state, "changed", head.label);
  // And the shapes found before the function are not read at all.
  assert.equal(applyingCode(decoy).ok, false);
  assert.deepEqual(applyingCode(SHELL), { ok: true });
});

test("through the lane: a broken gate turns the three rows back to not proved, and the morning audit refuses the na", async () => {
  const broken = mutate(SHELL, "if (!allowed || hideNav) {", "if (!allowed) {");
  const rows = headRows(await gapChecks({ fetchImpl: lane(broken) }));
  for (const head of FIN_B19_HIDDEN_HEADS) {
    const row = rows.get(head.control);
    assert.equal(row.status, "NOT_PROVED", head.label);
    assert.equal(row.na, undefined, head.label);
    assert.match(row.detail, /the code that applies the hidden list changed/, head.label);
  }
  const verify = naVerify[HIDDEN_HEAD_CODE];
  for (const head of FIN_B19_HIDDEN_HEADS) {
    const args = { sourceFile: head.sourceFile, surface: head.surface, control: head.control };
    assert.equal(await verify(args, { fetchImpl: serve(broken) }), false, head.label);
    assert.equal(await verify(args, { fetchImpl: serve(SHELL) }), true, head.label);
  }
});
