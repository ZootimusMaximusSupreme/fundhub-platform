// Regression contract for shared-shell SOP shortcuts. No database/provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/app");
const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const brain = fs.readFileSync(path.join(APP, "company-brain.html"), "utf8");

function objectBetween(text, begin, end) {
  const i = text.indexOf(begin);
  const j = text.indexOf(end, i + begin.length);
  assert.ok(i >= 0 && j > i, "SOP map anchor missing");
  const result = vm.runInNewContext("(" + text.slice(i + begin.length, j).trim() + ")", Object.create(null));
  return JSON.parse(JSON.stringify(result));
}
const pages = objectBetween(shell, "var SOP_CONTEXT_BY_SCREEN = ", ";\n  var SOP_STAFF_ROLES");
const guides = objectBetween(brain, "var SOP_GUIDES = ", ";\n  var sopTopic");
const roles = objectBetween(shell, "var SOP_STAFF_ROLES = ", ";\n\n  function mountSopShortcut");

test("every named staff working desk has a matching Company Brain SOP topic and real shell", () => {
  const expected = [
    "setter-dashboard.html", "closer-dashboard.html", "bank-outreach.html",
    "lenders.html", "inquiry-remover.html", "client-control-panel.html",
    "csm-queue.html", "pipeline.html", "sales-floor.html", "ops-admin.html",
    "finance-os.html", "messaging.html"
  ];
  assert.deepEqual(Object.keys(pages).sort(), expected.sort());
  for (const [screen, topic] of Object.entries(pages)) {
    assert.ok(fs.existsSync(path.join(APP, screen)), "missing screen " + screen);
    assert.ok(guides[topic], "no matching Company Brain guide for " + topic);
    assert.match(fs.readFileSync(path.join(APP, screen), "utf8"), /src=["'](?:\/app\/)?shell\.js["']/);
    assert.ok(guides[topic].title && guides[topic].description && guides[topic].prompt);
  }
  assert.equal(new Set(Object.values(pages)).size, Object.keys(pages).length, "ambiguous shared SOP keys");
});

test("shortcut is gated to the exact existing Company Brain STAFF roles, never external principals", () => {
  const expected = ["owner", "admin", "funding_advisor", "closer",
    "inquiry_specialist", "setter", "sales_manager", "csm"];
  assert.deepEqual([...roles].sort(), expected.sort());
  for (const x of ["client", "affiliate", "partner", "outbound_rep"]) assert.ok(!roles.includes(x));
  assert.match(shell, /permittedPages\.indexOf\("company-brain\.html"\) === -1/);
  assert.match(shell, /SOP_STAFF_ROLES\.indexOf\(role\) === -1/);
  assert.match(shell, /SOP_CONTEXT_BY_SCREEN\[PAGE\]/);
  assert.match(shell, /mountSopShortcut\(role, ok\)/);
});

test("shortcut uses a real anchor, safe finite URL, accessible focus, same-tab back navigation", () => {
  assert.match(shell, /a\.href = "company-brain\.html\?sop=" \+ encodeURIComponent\(topic\)/);
  assert.match(shell, /a\.setAttribute\("aria-label", "Open scripts and SOPs in Company Brain"\)/);
  assert.match(shell, /min-width:44px;min-height:44px/);
  assert.match(shell, /#fh-sop-shortcut:focus-visible/);
  assert.match(shell, /tools\.appendChild\(a\)/);
  assert.doesNotMatch(shell.slice(shell.indexOf("function mountSopShortcut"), shell.indexOf("function mountWorkspaceHeader")), /_blank|localStorage\.setItem|fetch\(/);
});

test("Company Brain does not POST on navigation, opens its existing documents and sends only after explicit Find", () => {
  assert.match(brain, /new URLSearchParams\(location\.search\)\.get\("sop"\)/);
  assert.match(brain, /Object\.prototype\.hasOwnProperty\.call\(SOP_GUIDES, sopTopic\)/);
  assert.match(brain, /sopCard\.hidden = false/);
  assert.match(brain, /openDocs\(true\)/);
  assert.match(brain, /getElementById\("fh-sop-find"\)\.addEventListener\("click"/);
  assert.match(brain, /grow\(\);\s*send\(\);/);
  assert.match(brain, /id="fh-sop-context" hidden/);
  assert.match(brain, /\/api\/read\/company-brain/);
  assert.match(brain, /\/api\/company-brain\/upload/);
});
