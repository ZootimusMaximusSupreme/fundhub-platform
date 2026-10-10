// FinanceOS for staff (wave 3 G1): the portal's FinanceOS card shows for the
// staff who may read a client's money (owner, admin, sales_manager —
// ROLE_SETS.FINANCE on api/money/*) and carries ?client_id= for them.
// Runs the real allowedFor() out of public/app/shell.js in a vm.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ROLE_SETS } from "./read-api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "../../public/app");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const PORTAL = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");

/** The source of `var NAME = …;` or `function NAME(…) {…}`, brackets matched
 *  with comments and strings skipped. */
function grab(src, head) {
  const start = src.indexOf(head);
  assert.ok(start !== -1, `shell.js has no "${head}"`);
  const isFn = head.startsWith("function");
  let i = src.indexOf(isFn ? "{" : "=", start);
  let depth = 0;
  let opened = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === "\"" || c === "'") {
      for (i++; src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "[" || c === "{" || c === "(") { depth++; opened = true; }
    if (c === "]" || c === "}" || c === ")") depth--;
    if (opened && depth === 0) {
      if (isFn) return src.slice(start, i + 1);
      return src.slice(start, src.indexOf(";", i) + 1);
    }
  }
  throw new Error(`unterminated ${head}`);
}

const LISTS = ["ALL", "PRINCIPAL_ONLY", "OWNER_ADMIN_ONLY", "FINANCE_ONLY", "CLOSER_DESK_ONLY",
  "SALES_FLOOR_ONLY", "PORTAL_ONLY", "HIRING_ONLY", "ADVISOR_ONLY", "CONSENT_DESK_ONLY",
  "STAFF_MONEY", "ADMIN_BLOCKED", "ROLE_TABS"];
const code = LISTS.map((n) => grab(SHELL, `var ${n} =`)).join("\n")
  + "\n" + grab(SHELL, "function staffTabs(")
  + "\n" + grab(SHELL, "function allowedFor(")
  + "\nthis.allowedFor = allowedFor; this.ALL = ALL;";
const box = {};
vm.runInNewContext(code, box);
const { allowedFor } = box;

const MONEY = ["financeos.html", "money.html", "money-accounts.html", "money-credit.html",
  "money-connections.html", "money-payments.html", "money-setup.html", "money-plan.html", "money-banks.html",
  "money-strategy.html", "money-fundability.html", "money-next.html", "money-transfers.html", "money-declines.html", "money-alerts.html", "money-vault.html"];

test("owner, admin, sales_manager and closer may follow the FinanceOS card", () => {
  for (const role of ["owner", "admin", "sales_manager", "closer"]) {
    const ok = allowedFor(role);
    for (const page of MONEY) assert.ok(ok.includes(page), `${role} is missing ${page}`);
  }
});

test("those roles are exactly ROLE_SETS.FINANCE_OS, the api/money/* gate (closer added 2026-10-07, owner)", () => {
  assert.deepEqual([...ROLE_SETS.FINANCE_OS].sort(), ["admin", "closer", "owner", "sales_manager"]);
  assert.ok(!ROLE_SETS.FINANCE.has("closer"), "FINANCE (invoices, staff records, payouts) stays closed to closers");
});

test("no other staff role gets the money pages, and the client keeps them", () => {
  for (const role of ["funding_advisor", "setter", "inquiry_specialist", "csm", "affiliate", "partner"]) {
    assert.ok(!allowedFor(role).includes("financeos.html"), `${role} should not see FinanceOS`);
  }
  for (const page of MONEY) assert.ok(allowedFor("client").includes(page), `client lost ${page}`);
});

test("the money pages stay off the sidebar list (ALL)", () => {
  for (const page of MONEY) assert.ok(!box.ALL.includes(page), `${page} leaked into ALL`);
});

test("a staff viewer's FinanceOS card carries the client they are looking at", () => {
  const block = PORTAL.match(/if \(STAFF_ROLES\[roleHint\(\)\]\) \{[\s\S]*?\n {2}\}/);
  assert.ok(block, "staff block in client-portal.html");
  assert.match(block[0], /getElementById\("money-link"\)/);
  assert.match(block[0], /"\/app\/financeos\.html\?client_id=" \+ encodeURIComponent\(clientId\)/);
  assert.match(block[0], /setAttribute\("data-fh-href", moneyHref\)/, "gateLinks rebuilds hrefs from data-fh-href");
});
