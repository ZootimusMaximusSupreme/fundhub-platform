// db/migrations/502_bank_apply_links_2026_10_21.sql fixes the two dead bank Apply links the hourly pulse
// found (beat apply-links): Blue Ridge Bank moves to its new card page, Landmark National Bank's address is
// cleared because the bank's site no longer names a credit card. These checks need no database or network:
// they read the migration and run the pulse's own address and page judges on the answers the banks gave on
// 2026-10-20/21. The database half is bank-apply-links-2026-10-21.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkShape, classifyRead } from "../pulse/beats/lib/bank-classify.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = fs.readFileSync(path.join(ROOT, "db/migrations/502_bank_apply_links_2026_10_21.sql"), "utf8");
const STATEMENTS = SQL.replace(/^--.*$/gm, "").trim().split(";").map((s) => s.trim()).filter(Boolean);

const BLUE_RIDGE = {
  id: "b004d840-ff34-4bf5-8188-0eb6461c966e",
  old: "https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html",
  now: "https://www.mybrb.bank/business/credit/cards.html"
};
const LANDMARK = {
  id: "373b7a55-9fb5-46bb-b74c-0b31aae85889",
  old: "https://www.banklandmark.com/business/additional-business-services/business-credit-cards/"
};

const statementFor = (id) => STATEMENTS.find((s) => s.includes(`WHERE id = '${id}'::uuid`));

test("bank links: two UPDATEs, one row each, by id, only while the row still holds the dead address", () => {
  assert.equal(STATEMENTS.length, 2);
  for (const s of STATEMENTS) {
    assert.match(s, /^UPDATE lenders\b/);
    assert.doesNotMatch(s, /\bDELETE\b|\bINSERT\b|\bactive\s*=/i, "it must not delete, add, or switch off a lender");
    assert.match(s, /last_updated_by\s+= 'pulse apply-links fix 2026-10-21'/);
    assert.match(s, /last_updated_date = DATE '2026-10-21'/);
  }
  const br = statementFor(BLUE_RIDGE.id);
  assert.ok(br.includes(`AND application_url = '${BLUE_RIDGE.old}'`));
  assert.ok(br.includes(`SET application_url   = '${BLUE_RIDGE.now}'`));
  const lm = statementFor(LANDMARK.id);
  assert.ok(lm.includes(`AND application_url = '${LANDMARK.old}'`));
  assert.match(lm, /SET application_url\s+= NULL,/);
});

test("bank links PASS: Blue Ridge's new address has the shape the pulse accepts, and the bank's answer reads OK", () => {
  assert.deepEqual(checkShape(BLUE_RIDGE.now), { ok: true, url: BLUE_RIDGE.now, host: "www.mybrb.bank" });
  const answer = classifyRead({
    ok: true, status: 200, finalHost: "www.mybrb.bank",
    body: "<html><head><title>Business Credit Cards | Blue Ridge Bank | Virginia &amp; North Carolina</title></head><body>0% intro APR for 12 months</body></html>"
  });
  assert.equal(answer.cls, "OK");
});

test("bank links FAIL: the banks' answers to the old addresses are the breaks the pulse reported", () => {
  const blueRidge = classifyRead({
    ok: false, status: 404, finalHost: "www.mybrb.bank",
    body: "<html><head><title>Sorry - Page Not Found | Blue Ridge Bank | Virginia &amp; North Carolina</title></head></html>"
  });
  const landmark = classifyRead({
    ok: false, status: 404, finalHost: "www.banklandmark.com",
    body: "<html><head><title>Page not found - Landmark National Bank</title></head></html>"
  });
  assert.equal(blueRidge.cls, "BAD_URL");
  assert.equal(landmark.cls, "BAD_URL");
  assert.notEqual(BLUE_RIDGE.old, BLUE_RIDGE.now);
});
