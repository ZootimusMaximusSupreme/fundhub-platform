// The plain words for a broken bank login. Pure: no database, no network.
//
// What these guard is the sentence a CLIENT reads about their own bank, and the
// button the screen offers. A wrong row here sends someone to "sign in again" for a
// login Plaid cannot repair, or texts them about a bank that is only down.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ITEM_ERRORS, NOTIFY_CODES, FIX, describeItemError } from "./plaid-item-errors.mjs";

const FIXES = new Set(Object.values(FIX));

describe("the table", () => {
  test("every row has a sentence, a known action and a notify flag that follows the action", () => {
    for (const [code, row] of Object.entries(ITEM_ERRORS)) {
      assert.ok(typeof row.plain === "string" && row.plain.length > 10, `${code} has words`);
      assert.ok(FIXES.has(row.fix), `${code} names an action the screen knows: ${row.fix}`);
      assert.equal(row.notify, row.fix === FIX.RECONNECT, `${code}: only a reconnect is texted`);
      assert.equal(typeof row.firstAtBank, "boolean");
    }
  });

  test("the sentences are short, plain and never leak a code or a vendor's name", () => {
    for (const [code, row] of Object.entries(ITEM_ERRORS)) {
      assert.ok(row.plain.length <= 120, `${code} is a short sentence (${row.plain.length} chars)`);
      assert.ok(row.plain.endsWith("."), `${code} ends like a sentence`);
      assert.doesNotMatch(row.plain, /plaid|token|api\b|error code|webhook|item\b|institution/i, `${code} has jargon: ${row.plain}`);
      assert.doesNotMatch(row.plain, /[A-Z]{3,}_[A-Z_]+/, `${code} shows a code to the client`);
    }
  });

  test("the company is spelled Fundhub wherever it appears", () => {
    for (const row of Object.values(ITEM_ERRORS)) {
      assert.doesNotMatch(row.plain, /FundHub|Fund Hub|FUNDHUB/);
    }
  });

  test("the table is frozen: a screen cannot change what a client is told", () => {
    assert.ok(Object.isFrozen(ITEM_ERRORS));
    assert.ok(Object.isFrozen(ITEM_ERRORS.ITEM_LOGIN_REQUIRED));
    assert.ok(Object.isFrozen(NOTIFY_CODES));
  });
});

describe("what Plaid's docs say each code needs", () => {
  /* https://plaid.com/docs/errors/item/ and https://plaid.com/docs/link/update-mode/ */
  test("ITEM_LOGIN_REQUIRED is the reconnect case: Link in update mode", () => {
    const d = describeItemError("ITEM_LOGIN_REQUIRED");
    assert.equal(d.fix, FIX.RECONNECT);
    assert.equal(d.notify, true);
    assert.equal(d.known, true);
    assert.equal(d.plain, "Your bank needs you to sign in again.");
  });

  test("consent expiring and a pending disconnect (webhook codes) also say reconnect", () => {
    // https://plaid.com/docs/api/items/#webhooks — fixed by going through update mode.
    for (const code of ["PENDING_EXPIRATION", "PENDING_DISCONNECT"]) {
      const d = describeItemError(code);
      assert.equal(d.fix, FIX.RECONNECT, code);
      assert.equal(d.notify, true, code);
      assert.match(d.plain, /reconnect/i, code);
    }
  });

  test("codes that need something done at the bank FIRST still say reconnect, and say what to do first", () => {
    for (const code of ["PASSWORD_RESET_REQUIRED", "USER_SETUP_REQUIRED", "ITEM_LOCKED"]) {
      const d = describeItemError(code);
      assert.equal(d.fix, FIX.RECONNECT, code);
      assert.equal(d.firstAtBank, true, code);
      assert.match(d.plain, /first/i, `${code} says to do the bank step first`);
    }
    assert.equal(describeItemError("ITEM_LOGIN_REQUIRED").firstAtBank, false);
  });

  test("a bank that is down, a rate limit and a login still getting ready are 'check again' — never a reconnect, never a text", () => {
    for (const code of [
      "INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "INSTITUTION_NOT_AVAILABLE",
      "RATE_LIMIT_EXCEEDED", "PRODUCT_NOT_READY", "upstream_error", "held"
    ]) {
      const d = describeItemError(code);
      assert.equal(d.fix, FIX.CHECK_AGAIN, code);
      assert.equal(d.notify, false, `${code} must not text anyone`);
    }
  });

  test("a rate limit is stored under its endpoint's code (ACCOUNTS_LIMIT…) and still reads as busy, never as a reconnect", () => {
    for (const code of ["ACCOUNTS_LIMIT", "TRANSACTIONS_LIMIT", "ITEM_GET_LIMIT", "RATE_LIMIT", "TRANSACTIONS_SYNC_LIMIT"]) {
      const d = describeItemError(code);
      assert.equal(d.fix, FIX.CHECK_AGAIN, code);
      assert.equal(d.notify, false, code);
      assert.equal(d.known, true, code);
      assert.equal(d.code, code, "the code that was stored is the code that is reported");
      assert.match(d.plain, /too many times/);
    }
    // Only the naming rule counts: a code that merely mentions a limit is not one.
    for (const code of ["LIMIT", "limit_exceeded", "LIMIT_REACHED", "accounts_limit", "ACCOUNTS-LIMIT"]) {
      assert.equal(describeItemError(code).known, false, code);
    }
  });

  test("a login Plaid says cannot be repaired is 'connect again' — and is never texted", () => {
    for (const code of [
      "ITEM_NOT_FOUND", "ITEM_CONCURRENTLY_DELETED", "ITEM_NOT_SUPPORTED", "MFA_NOT_SUPPORTED",
      "NO_ACCOUNTS", "INSTITUTION_NO_LONGER_SUPPORTED", "PRODUCT_NOT_ENABLED", "PRODUCTS_NOT_SUPPORTED"
    ]) {
      const d = describeItemError(code);
      assert.equal(d.fix, FIX.CONNECT_AGAIN, code);
      assert.equal(d.notify, false, `${code}: a reconnect would not work, so no text`);
    }
  });
});

describe("describeItemError is total", () => {
  test("a code nobody mapped, null, empty and a non-string all get the generic words and are not texted", () => {
    for (const input of ["SOME_NEW_PLAID_CODE", null, undefined, "", "   ", 42, {}]) {
      const d = describeItemError(input);
      assert.equal(d.known, false, String(input));
      assert.equal(d.fix, FIX.RECONNECT, "the screen may still try the reconnect");
      assert.equal(d.notify, false, "nobody checked it is fixable, so nobody is texted");
      assert.match(d.plain, /stopped working/);
    }
    assert.equal(describeItemError("SOME_NEW_PLAID_CODE").code, "SOME_NEW_PLAID_CODE");
    assert.equal(describeItemError(null).code, null);
  });

  test("a code is matched as an own key: prototype names are unknown codes, not objects off the prototype", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const d = describeItemError(name);
      assert.equal(d.known, false, name);
      assert.equal(typeof d.plain, "string", name);
    }
  });

  test("surrounding spaces do not hide a real code", () => {
    assert.equal(describeItemError("  ITEM_LOGIN_REQUIRED ").known, true);
  });
});

describe("NOTIFY_CODES", () => {
  test("is exactly the codes whose action is reconnect", () => {
    const expected = Object.keys(ITEM_ERRORS).filter((c) => ITEM_ERRORS[c].fix === FIX.RECONNECT).sort();
    assert.deepEqual([...NOTIFY_CODES].sort(), expected);
    assert.ok(NOTIFY_CODES.includes("ITEM_LOGIN_REQUIRED"));
    assert.ok(!NOTIFY_CODES.includes("ITEM_NOT_FOUND"));
    assert.ok(!NOTIFY_CODES.includes("INSTITUTION_DOWN"));
  });
});
