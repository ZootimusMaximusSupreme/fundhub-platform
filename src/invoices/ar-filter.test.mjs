// The AR table asked for a status that cannot exist. These tests pin the fix.
//
// The bug being locked out (walk, 2026-09-06): ops-admin.html requested
// ?status=open, invoices_status_check has no 'open', the SQL compared a column
// to a literal that matches nothing, and the panel said "No unpaid invoices"
// with a real sent, unpaid $5,000 success fee in the table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { invoiceStatusFilter, INVOICE_STATUSES, OPEN_FILTER } from "./ar-filter.mjs";

const ENDPOINT = readFileSync(new URL("../../api/read/invoices.mjs", import.meta.url), "utf8");

test("the eight statuses here are exactly the eight the CHECK constraint permits", () => {
  const migration = readFileSync(
    new URL("../../db/migrations/031_invoices.sql", import.meta.url),
    "utf8"
  );
  const clause = migration.match(/invoices_status_check CHECK \(\s*status IN \(([^)]*)\)/);
  assert.ok(clause, "031_invoices.sql no longer states invoices_status_check the way this test reads it");
  const permitted = clause[1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
    .sort();
  assert.deepEqual([...INVOICE_STATUSES].sort(), permitted);
});

test("'open' is NOT one of them — that is the whole defect", () => {
  assert.equal(INVOICE_STATUSES.includes(OPEN_FILTER), false);
});

test("no status asked for means no status filter", () => {
  for (const raw of [undefined, null, "", "   "]) {
    const f = invoiceStatusFilter(raw);
    assert.equal(f.kind, "all");
    assert.equal(f.status, null);
    assert.equal(f.openOnly, false);
    assert.equal(f.valid, true);
  }
});

test("'open' becomes a balance filter, never a status comparison", () => {
  const f = invoiceStatusFilter("open");
  assert.equal(f.kind, "open");
  assert.equal(f.openOnly, true);
  assert.equal(f.status, null, "an open filter must not bind a status — no row would match it");
  assert.equal(f.valid, true);
});

test("a real stored status is still an exact match, and is case-insensitive", () => {
  for (const status of INVOICE_STATUSES) {
    const f = invoiceStatusFilter(status);
    assert.equal(f.kind, "exact");
    assert.equal(f.status, status);
    assert.equal(f.openOnly, false);
  }
  assert.equal(invoiceStatusFilter("  SENT ").status, "sent");
});

test("an invented status is a 400 that names the real ones, not an empty table", () => {
  const f = invoiceStatusFilter("unpaid");
  assert.equal(f.valid, false);
  assert.equal(f.openOnly, false);
  assert.match(f.message, /"unpaid" is not an invoice status/);
  assert.match(f.message, /open/);
  for (const status of INVOICE_STATUSES) assert.ok(f.message.includes(status));
});

test("the endpoint binds the open filter as its own parameter and raises BAD_REQUEST", () => {
  assert.match(ENDPOINT, /invoiceStatusFilter/);
  assert.match(ENDPOINT, /err\.code = "BAD_REQUEST"/);
  assert.match(ENDPOINT, /\$6::boolean IS NOT TRUE OR v\.open_balance > 0/);
});

test("the endpoint reads the aging view, so days overdue is not re-derived in the browser", () => {
  assert.match(ENDPOINT, /FROM v_invoice_aging v/);
  assert.match(ENDPOINT, /v\.days_overdue/);
  // The statement itself reads one view. v_invoice_balance is still named in
  // the prose above it, which is why this looks for the aliased FROM clause and
  // not for the bare word.
  assert.doesNotMatch(ENDPOINT, /FROM v_invoice_balance v/);
});

test("the org still comes from the session, and demo rows are still excluded", () => {
  assert.match(ENDPOINT, /v\.org_id = \$5::uuid/);
  assert.match(ENDPOINT, /COALESCE\(i\.is_demo, false\) = false/);
  // This is an ownership gate, not an optional name lookup: an invoice
  // referencing another organization's buyer must be excluded altogether.
  assert.match(ENDPOINT, /JOIN clients c ON c\.id = v\.client_id AND c\.org_id = v\.org_id/);
  assert.doesNotMatch(ENDPOINT, /LEFT JOIN clients c ON c\.id = v\.client_id/);
});

test("a client with no name comes back NULL — the endpoint never invents one", () => {
  assert.match(ENDPOINT, /NULLIF\(BTRIM\(CONCAT_WS\(' ', c\.first_name, c\.last_name\)\), ''\) AS client_name/);
});
