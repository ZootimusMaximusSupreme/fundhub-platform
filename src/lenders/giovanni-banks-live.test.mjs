import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations/504_giovanni_banks_2026_10_24.sql"),
  "utf8"
);

test("Giovanni bank migration hides rows and does not delete them", () => {
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.match(sql, /SET active = false/);
  assert.match(sql, /https:\/\/creditcards\.chase\.com\/business-credit-cards/);
  assert.match(sql, /https:\/\/www\.citizensbank\.com\/small-business\/business-credit-cards\/overview\.page/);
  assert.match(sql, /https:\/\/www\.navyfederal\.org\/services\/business\/credit-cards\.html/);
  assert.match(sql, /AZ, CA, CT, FL, IN, MI, NJ, NY, NC, OH, WI/);
  assert.match(sql, /CO, IL, IA, KS, NE, SD, TX, WY/);
  assert.match(sql, /Checking account open for 45 days/);
  assert.match(sql, /Requires 2 years in business/);
  assert.match(sql, /QuickBooks Capital/);
  assert.match(sql, /Intuit Business Credit Card/);
});
