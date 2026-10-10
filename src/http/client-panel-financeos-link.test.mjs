/* Tests for the "Open FinanceOS" row on public/app/client-control-panel.html
 * (FinanceOS wave 4, unit H3, 2026-10-06).
 *
 * WHAT IT IS FOR. The client's money page (/app/financeos.html) was only
 * reachable from the FinanceOS card on client-portal.html, and admin and
 * sales_manager cannot open the portal page (PORTAL_ONLY in shell.js — kept on
 * purpose). /api/money/* already lets owner, admin and sales_manager in with
 * ?client_id=, so the staff side needed one door: a row in the panel's Quick
 * launch that opens financeos.html on the client the panel is showing.
 *
 * WHAT THESE PROVE.
 *   1. The row exists, starts hidden, and has its own [hidden] CSS line
 *      (.action-btn sets display, which beats the browser's [hidden]).
 *   2. Run for real against a fake node: owner/admin/sales_manager see it with
 *      ?client_id=<this client> on both href and data-fh-href; every other
 *      role, and no client, keeps it hidden.
 *   3. The page's role list matches ROLE_SETS.FINANCE (the /api/money gate)
 *      and the roles shell.js hands STAFF_MONEY to — so the link, the nav gate
 *      and the endpoint cannot drift apart silently.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ROLE_SETS } from "./read-api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_HTML = fs.readFileSync(path.resolve(HERE, "../../public/app/client-control-panel.html"), "utf8");
const SHELL_JS = fs.readFileSync(path.resolve(HERE, "../../public/app/shell.js"), "utf8");

const ROLES_ALL = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter",
  "inquiry_specialist", "staff", "client", "affiliate", "partner", ""];

function wiring() {
  const a = PANEL_HTML.indexOf("function wireFinanceOsLink(id) {");
  assert.ok(a !== -1, "wireFinanceOsLink is gone from client-control-panel.html");
  const b = PANEL_HTML.indexOf("\n  }\n", a);
  assert.ok(b > a, "wireFinanceOsLink no longer closes where it used to");
  return PANEL_HTML.slice(a, b + 4);
}

function run(role, clientId) {
  const attrs = { href: "financeos.html" };
  const node = {
    hidden: true,
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; }
  };
  const sandbox = {
    $: (domId) => (domId === "ccp-link-financeos" ? node : null),
    localStorage: { getItem: (k) => (k === "fh_role" ? role : null) },
    encodeURIComponent
  };
  vm.createContext(sandbox);
  vm.runInContext(wiring() + "\nwireFinanceOsLink(" + JSON.stringify(clientId) + ");", sandbox);
  return { hidden: node.hidden, href: attrs.href, fhHref: attrs["data-fh-href"] };
}

describe("client control panel — Open FinanceOS row", () => {
  test("the row is in Quick launch, starts hidden, and [hidden] really hides it", () => {
    const m = PANEL_HTML.match(/<a class="action-btn" id="ccp-link-financeos" href="financeos\.html" hidden>Open FinanceOS/);
    assert.ok(m, "the Open FinanceOS row is missing or no longer starts hidden");
    const quick = PANEL_HTML.indexOf('<div class="group-title card-title">Quick launch</div>');
    const more = PANEL_HTML.indexOf('<details class="more" id="more-menu">', quick);
    assert.ok(quick !== -1 && more > quick && m.index > quick && m.index < more,
      "the Open FinanceOS row moved out of the Quick launch group");
    assert.match(PANEL_HTML, /#ccp-link-financeos\[hidden\]\{display:none;\}/,
      ".action-btn sets display — without its own [hidden] line the row shows to every role");
    assert.match(PANEL_HTML, /wireLinks\(id\);\s*\n\s*wireFinanceOsLink\(id\);/,
      "wireFinanceOsLink(id) is no longer called with the panel's client");
  });

  for (const role of ["owner", "admin", "sales_manager", "closer"]) {
    test(role + " sees it, opening financeos.html on this client", () => {
      const r = run(role, "11111111-2222-4333-8444-555555555555");
      assert.strictEqual(r.hidden, false);
      assert.strictEqual(r.href, "financeos.html?client_id=11111111-2222-4333-8444-555555555555");
      assert.strictEqual(r.fhHref, r.href, "data-fh-href must match, or gateLinks() puts the bare link back");
    });
  }

  test("the client id is URL-encoded", () => {
    assert.strictEqual(run("owner", "a b&c").href, "financeos.html?client_id=a%20b%26c");
  });

  test("an upper-case or padded cached role still counts", () => {
    assert.strictEqual(run(" Sales_Manager ", "c-1").hidden, false);
  });

  for (const role of ROLES_ALL.filter((r) => !["owner", "admin", "sales_manager", "closer"].includes(r))) {
    test("role '" + (role || "(none)") + "' never sees it", () => {
      const r = run(role, "c-1");
      assert.strictEqual(r.hidden, true);
      assert.strictEqual(r.href, "financeos.html", "a refused role must not be handed a client link");
    });
  }

  test("no client open → hidden, even for the owner", () => {
    assert.strictEqual(run("owner", "").hidden, true);
    assert.strictEqual(run("owner", null).hidden, true);
  });

  test("the page's roles are exactly ROLE_SETS.FINANCE_OS, the /api/money gate", () => {
    const shown = ROLES_ALL.filter((r) => run(r, "c-1").hidden === false).sort();
    assert.deepStrictEqual(shown, [...ROLE_SETS.FINANCE_OS].sort());
  });

  test("shell.js hands STAFF_MONEY (which names financeos.html) to the same roles", () => {
    const list = SHELL_JS.match(/var STAFF_MONEY = \[([\s\S]*?)\];/);
    assert.ok(list && /"financeos\.html"/.test(list[1]), "STAFF_MONEY no longer names financeos.html");
    const fn = SHELL_JS.match(/function allowedFor\(role\) \{([\s\S]*?)\n  \}/);
    assert.ok(fn, "allowedFor() moved");
    const lines = fn[1].split("\n").filter((l) => l.includes("STAFF_MONEY"));
    assert.strictEqual(lines.length, 4, "STAFF_MONEY should reach exactly four branches: '*', admin, sales_manager, closer");
    assert.ok(lines.some((l) => /m === "\*"/.test(l)));
    assert.ok(lines.some((l) => /m === "admin"/.test(l)) || /m === "admin"\) \{\s*\n\s*return[^\n]*STAFF_MONEY/.test(fn[1]));
    assert.ok(lines.some((l) => /m === "sales_manager"/.test(l)));
    assert.ok(lines.some((l) => /m === "closer"/.test(l)));
  });
});
