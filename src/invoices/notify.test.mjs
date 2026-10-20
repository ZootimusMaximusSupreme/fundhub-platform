import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { invoiceContext, invoiceKindLabel } from "./notify.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const invoiceSeed = readFileSync(path.join(root, "db/seed/008_contract_messages.sql"), "utf8");
const noticeSeed = readFileSync(path.join(root, "db/seed/013_section4_message_templates.sql"), "utf8");
const deployedCopy = readFileSync(path.join(root, "db/migrations/484_basic_business_consulting_invoice_copy.sql"), "utf8");

test("client invoice email and portal share the exact consulting-fee label", () => {
  const invoice = { id: "invoice-1", source: "funding_success_fee", amount_due: 1250, currency: "USD" };
  assert.equal(invoiceKindLabel(invoice), "basic business consulting fee");
  assert.equal(invoiceKindLabel({ invoice_type: "success_fee" }), "basic business consulting fee");
  assert.equal(invoiceContext({ invoice, client: { first_name: "Client" } }).invoice.kind,
    "basic business consulting fee");
  assert.equal(invoiceKindLabel({ source: "deposit" }), "Deposit", "other invoice kinds keep their existing name");
  assert.match(invoiceSeed, /Your \{\{invoice\.kind\}\} invoice from/);
  assert.match(invoiceSeed, /What it is for: \{\{invoice\.kind\}\}/);
});

test("all six AR notices use the exact buyer label without naming a round", () => {
  const smsKeys = ["SMS-AR-01-FIRST-NOTICE", "SMS-AR-02-REMINDER", "SMS-AR-03-FINAL-NOTICE"];
  const emailKeys = ["EMAIL-AR-01-FIRST-NOTICE", "EMAIL-AR-02-REMINDER", "EMAIL-AR-03-FINAL-NOTICE"];
  for (const key of smsKeys) {
    const start = noticeSeed.indexOf(`('${key}',`);
    assert.ok(start >= 0, `${key} missing from seed`);
    const bodyLine = noticeSeed.indexOf("\n", start) + 1;
    const copy = noticeSeed.slice(start, noticeSeed.indexOf("\n", bodyLine));
    assert.match(copy, /basic business consulting fee/);
    assert.doesNotMatch(copy, /\bround\b/i);
    assert.match(deployedCopy, new RegExp(`template_key = '${key}'`));
  }
  for (const key of emailKeys) {
    const start = noticeSeed.indexOf(`-- ${key}`);
    assert.ok(start >= 0, `${key} missing from seed`);
    const next = noticeSeed.indexOf("\n-- ", start + 4);
    const copy = noticeSeed.slice(start, next < 0 ? undefined : next);
    assert.match(copy, /basic business consulting fee/);
    assert.doesNotMatch(copy, /\bround\b/i);
    assert.match(deployedCopy, new RegExp(`template_key = '${key}'`));
  }
  assert.match(deployedCopy, /template_key = 'INVOICE-SENT-EMAIL'/);
});
