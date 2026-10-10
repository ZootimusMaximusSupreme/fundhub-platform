// Owner-set 2026-10-07: "closers should have access to everything" in FinanceOS.
// Every FinanceOS door gates staff on ROLE_SETS.FINANCE_OS (owner, admin,
// sales_manager, closer). FINANCE itself — invoices, staff records, payouts —
// stays closed to closers. This file fails if a FinanceOS door drifts back.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_SETS } from "./read-api.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOORS = [
  ...fs.readdirSync(path.join(ROOT, "api/money")).filter((f) => f.endsWith(".mjs")).map((f) => "api/money/" + f),
  "api/banking/link-token.mjs", "api/banking/link-exchange.mjs",
  "api/banking/sync-transactions.mjs", "api/banking/sync-liabilities.mjs"
];

test("FINANCE_OS is FINANCE plus closer; FINANCE stays closed to closers", () => {
  assert.deepEqual([...ROLE_SETS.FINANCE_OS].sort(), ["admin", "closer", "owner", "sales_manager"]);
  assert.ok(!ROLE_SETS.FINANCE.has("closer"));
});

test("every FinanceOS door gates staff on FINANCE_OS, never the narrower FINANCE", () => {
  for (const rel of DOORS) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.doesNotMatch(src, /ROLE_SETS\.FINANCE\b(?!_OS)/, `${rel} still gates on ROLE_SETS.FINANCE`);
  }
});
