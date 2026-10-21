// db/migrations/497_blue_ridge_bank_apply_link.sql moves Blue Ridge Bank's Apply link to the bank's new
// Business Credit Cards page. These checks need no database or network: they run the pulse's own address
// and page judges (beat apply-links) on the old and new address and on the two answers the bank gave on
// 2026-10-20. The database half is blue-ridge-apply-link.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkShape, classifyRead } from "../pulse/beats/lib/bank-classify.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = fs.readFileSync(path.join(ROOT, "db/migrations/497_blue_ridge_bank_apply_link.sql"), "utf8");
const STATEMENTS = SQL.replace(/^--.*$/gm, "").trim();

const LENDER_ID = "b004d840-ff34-4bf5-8188-0eb6461c966e";
const OLD = "https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html";
const NEW = "https://www.mybrb.bank/business/credit/cards.html";

test("blue ridge: the migration changes one row, by id, only while it still holds the old address", () => {
  assert.match(STATEMENTS, /^UPDATE lenders\b/);
  assert.equal((STATEMENTS.match(/;/g) || []).length, 1, "one statement only");
  assert.doesNotMatch(STATEMENTS, /\bDELETE\b|\bINSERT\b|\bactive\s*=/i, "it must not delete, add, or switch off a lender");
  assert.ok(STATEMENTS.includes(`WHERE id = '${LENDER_ID}'::uuid`));
  assert.ok(STATEMENTS.includes(`AND application_url = '${OLD}'`));
  assert.ok(STATEMENTS.includes(`SET application_url   = '${NEW}'`));
  assert.match(STATEMENTS, /last_updated_by\s+= '[^']+'/);
  assert.match(STATEMENTS, /last_updated_date = DATE '2026-10-20'/);
});

test("blue ridge PASS: the new address has the shape the pulse accepts, and the bank's answer to it reads OK", () => {
  assert.deepEqual(checkShape(NEW), { ok: true, url: NEW, host: "www.mybrb.bank" });
  const answer = classifyRead({
    ok: true, status: 200, finalHost: "www.mybrb.bank",
    body: "<html><head><title>Business Credit Cards | Blue Ridge Bank | Virginia &amp; North Carolina</title></head><body>0% intro APR for 12 months</body></html>"
  });
  assert.equal(answer.cls, "OK");
});

test("blue ridge FAIL: the bank's answer to the old address is the break the pulse reported", () => {
  const answer = classifyRead({
    ok: false, status: 404, finalHost: "www.mybrb.bank",
    body: "<html><head><title>Sorry - Page Not Found | Blue Ridge Bank | Virginia &amp; North Carolina</title></head></html>"
  });
  assert.equal(answer.cls, "BAD_URL");
  assert.notEqual(OLD, NEW);
});
