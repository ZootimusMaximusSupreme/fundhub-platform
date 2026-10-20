import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { renderTemplate } from "../lib/render-template.mjs";
import { invoiceContext } from "./notify.mjs";

const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db");
const migration = readFileSync(join(dbDir, "migrations", "484_basic_business_consulting_invoice_copy.sql"), "utf8");
const contractSeed = readFileSync(join(dbDir, "seed", "008_contract_messages.sql"), "utf8");
const arSeed = readFileSync(join(dbDir, "seed", "013_section4_message_templates.sql"), "utf8");
const arRuntime = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "workflows", "ar-collections.mjs"), "utf8");
const inserts = migration.slice(migration.indexOf("WITH approved("));
const legacyUpdates = migration.slice(0, migration.indexOf("WITH approved("));
function runtimeKey(name) {
  const found = arRuntime.match(new RegExp(`export const ${name} = "([^"]+)"`));
  assert.ok(found, `${name} is registered by AR`);
  return found[1];
}
const emailKeys = [runtimeKey("EMAIL_AR_01"), runtimeKey("EMAIL_AR_02"), runtimeKey("EMAIL_AR_03")];
const smsKeys = [runtimeKey("SMS_AR_01"), runtimeKey("SMS_AR_02"), runtimeKey("SMS_AR_03")];
const allKeys = ["INVOICE-SENT-EMAIL", ...smsKeys, ...emailKeys];

function htmlRow(sql, key) {
  const found = sql.match(new RegExp(`'${key}',\\s*'email',\\s*'([^']+)',\\s*\\$html\\$([\\s\\S]*?)\\$html\\$`));
  assert.ok(found, `missing approved HTML for ${key}`);
  return { subject: found[1], body: found[2] };
}

function smsBody(sql, key, isMigration) {
  const pattern = isMigration
    ? new RegExp(`'${key}',\\s*'sms',\\s*NULL::text,\\s*'([^']*)'`)
    : new RegExp(`\\('${key}',\\s*'([^']*)'\\)`);
  const found = sql.match(pattern);
  assert.ok(found, `missing approved SMS for ${key}`);
  return found[1];
}

function invoiceEmail(sql) {
  const at = sql.indexOf("'INVOICE-SENT-EMAIL',");
  assert.ok(at >= 0, "invoice email insert exists");
  const nextTuple = sql.indexOf("'SMS-AR-01-FIRST-NOTICE',", at);
  const block = sql.slice(at, nextTuple >= 0 ? nextTuple : sql.indexOf("true", at));
  const subject = block.match(/'INVOICE-SENT-EMAIL',\s*'email',\s*'([^']+)'/);
  assert.ok(subject, "invoice email subject exists");
  const body = [...block.matchAll(/E'((?:''|[^'])*)'/g)]
    .map((match) => match[1].replaceAll("''", "'").replaceAll("\\n", "\n"))
    .join("");
  assert.ok(body.startsWith("Hi {{contact.first_name}}"));
  return { subject: subject[1], body };
}

test("migration 484 inserts all seven missing invoice/AR templates only for Fundhub", () => {
  const keys = [...inserts.matchAll(/'(INVOICE-SENT-EMAIL|(?:EMAIL|SMS)-AR-0[123]-(?:FIRST-NOTICE|REMINDER|FINAL-NOTICE))',\s*'(email|sms)'/g)]
    .map((match) => match[1]);
  assert.deepEqual(keys.sort(), [...allKeys].sort());
  assert.match(inserts, /SELECT o\.id, a\.template_key, a\.channel, a\.subject, a\.body, true/);
  assert.match(inserts, /WHERE o\.slug = 'fundhub'/);
  assert.match(inserts, /ON CONFLICT \(org_id, template_key\) DO NOTHING;/);
  assert.doesNotMatch(inserts, /ON CONFLICT[\s\S]*DO UPDATE/i);
});

test("missing-key insert uses the exact approved seed copy, not a new draft", () => {
  assert.deepEqual(invoiceEmail(inserts), invoiceEmail(contractSeed));
  for (const key of smsKeys) {
    assert.equal(smsBody(inserts, key, true), smsBody(arSeed, key, false), key);
  }
  for (const key of emailKeys) {
    assert.deepEqual(htmlRow(inserts, key), htmlRow(arSeed, key), key);
  }
});

test("only Fundhub's exact legacy wording is updated; other orgs and customized rows stay untouched", () => {
  const blocks = legacyUpdates.split(/(?=UPDATE message_templates)/).filter((part) => part.startsWith("UPDATE message_templates"));
  assert.equal(blocks.length, allKeys.length);
  for (const key of allKeys) {
    const block = blocks.find((part) => part.includes(`WHERE template_key = '${key}'`));
    assert.ok(block, `${key} has a legacy update`);
    assert.match(block, new RegExp(`WHERE template_key = '${key}'\\s+AND org_id IN \\(SELECT id FROM orgs WHERE slug = 'fundhub'\\)\\s+AND \\(?strpos\\(`));
    assert.match(block, /strpos\((?:subject|body), '[^']+'\) > 0/);
    assert.doesNotMatch(block, /compliance_passed\s*=/);
  }
});

test("new buyer copy names the fee but never exposes a round", () => {
  for (const key of smsKeys) {
    const body = smsBody(inserts, key, true);
    assert.match(body, /basic business consulting fee/);
    assert.doesNotMatch(body, /\bround\b/i);
    assert.match(body, /Reply STOP to opt out\.$/);
  }
  for (const key of emailKeys) {
    const row = htmlRow(inserts, key);
    assert.match(row.subject, /basic business consulting fee/);
    assert.match(row.body, /basic business consulting fee/);
    assert.doesNotMatch(`${row.subject} ${row.body}`, /\bround\b/i);
  }
  const invoice = invoiceEmail(inserts);
  const context = invoiceContext({
    invoice: { id: "12345678-0000-0000-0000-000000000000", source: "funding_success_fee", amount_due: "150.00", currency: "USD" },
    client: { first_name: "Client" }
  });
  assert.match(renderTemplate(invoice.subject, context), /basic business consulting fee/);
  assert.match(renderTemplate(invoice.body, context), /basic business consulting fee/);
});
