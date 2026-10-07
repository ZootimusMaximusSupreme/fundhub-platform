// The vault's standard list — every line must cite where it came from, name real
// upload subtypes, and expire only by a rule a source gave.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import {
  STANDARD_ITEMS, ITEM_BY_KEY, SCOPE, VAULT_ONLY_SUBTYPES, VAULT_DOCUMENT_KINDS,
  IGNORED_SUBTYPES, vaultSettings, expiryFor, DEFAULT_ASK_EVERY_DAYS
} from "./document-vault-items.mjs";
import { SUBTYPES, SUBTYPE_TITLES } from "../documents/kinds.mjs";
import { DOC_CHECK_TYPES } from "../handlers/doc-check.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");

describe("the standard list", () => {
  test("has the lines the offer names, each once", () => {
    const keys = STANDARD_ITEMS.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, "a key is used twice");
    assert.deepEqual(keys, [
      "id_document", "proof_of_address", "tax_returns_personal",
      "bank_statements_business", "tax_returns_business",
      "articles_of_organization", "ein_letter", "certificate_good_standing"
    ]);
    assert.equal(Object.keys(ITEM_BY_KEY).length, keys.length);
  });

  test("every line is personal or per business, asks for a whole number of papers, and has words for a client", () => {
    for (const item of STANDARD_ITEMS) {
      assert.ok([SCOPE.CLIENT, SCOPE.BUSINESS].includes(item.scope), item.key);
      assert.ok(Number.isInteger(item.need) && item.need >= 1 && item.need <= 24, item.key);
      for (const f of ["title", "ask", "why"]) assert.ok(item[f] && item[f].trim().length > 10, `${item.key}.${f}`);
      assert.ok(item.subtypes.length >= 1, item.key);
    }
  });

  test("EVERY line cites at least one source — an item with no source is staff-added, never standard", () => {
    for (const item of STANDARD_ITEMS) {
      assert.ok(item.sources.length >= 1, `${item.key} has no source`);
      for (const s of item.sources) {
        assert.ok(s.ref && s.note && s.note.length > 10, `${item.key}: a source needs a ref and a note`);
      }
    }
  });

  test("a tracked source is a real file in this repository", () => {
    for (const item of STANDARD_ITEMS) {
      for (const s of item.sources.filter((x) => !x.local)) {
        assert.ok(fs.existsSync(path.join(ROOT, s.ref)), `${item.key} cites ${s.ref}, which is not in the repo`);
      }
    }
  });

  test("a local (Legacy Strong scrape) source names its page folder and its lines", () => {
    let seen = 0;
    for (const item of STANDARD_ITEMS) {
      for (const s of item.sources.filter((x) => x.local)) {
        seen += 1;
        assert.match(s.ref, /^credentials\/notion-scrape\/output\/[a-z0-9-]+--[0-9a-f]{8}\/page\.md$/, `${item.key}: ${s.ref}`);
        assert.match(String(s.lines), /^\d+(?:[-, ]+\d+)*$/, `${item.key}: lines "${s.lines}"`);
      }
    }
    assert.ok(seen >= 6, "the Legacy Strong pages are what the business lines rest on");
  });

  test("every subtype a line files under is a real upload subtype with a title", () => {
    for (const item of STANDARD_ITEMS) {
      for (const t of item.subtypes) {
        assert.ok(SUBTYPES.client_upload.includes(t), `${item.key}: "${t}" is not a client_upload subtype`);
        assert.ok(SUBTYPE_TITLES[t], `${item.key}: "${t}" has no title`);
      }
    }
  });

  test("no line is asked for that no source supports (personal statements, license, P&L stay staff-added)", () => {
    // What a line IS (key, title, ask, subtypes) — not the notes that quote a page.
    const text = STANDARD_ITEMS.map((i) => [i.key, i.title, i.ask, ...i.subtypes].join(" ")).join(" ").toLowerCase();
    for (const banned of ["business_license", "profit", "balance sheet", "pay stub", "personal bank statement"]) {
      assert.ok(!text.includes(banned), `"${banned}" has no standing source — it must be a staff-added line`);
    }
  });

  test("a proof of address accepts a bank statement, the way the identity packet does", () => {
    assert.ok(ITEM_BY_KEY.proof_of_address.subtypes.includes("bank_statement"));
    assert.ok(!ITEM_BY_KEY.bank_statements_business.subtypes.includes("bank_statement"),
      "a personal statement must never count as a business one");
  });

  test("only the two identity lines can be accepted by the document reader", () => {
    const readable = STANDARD_ITEMS.filter((i) => i.docCheck).map((i) => i.key);
    assert.deepEqual(readable, ["id_document", "proof_of_address"]);
  });
});

describe("expiry rules", () => {
  test("only bank statements and the good-standing certificate age out", () => {
    const aging = STANDARD_ITEMS.filter((i) => i.expires).map((i) => i.key);
    assert.deepEqual(aging, ["bank_statements_business", "certificate_good_standing"]);
  });

  test("statements: three months, from the sources; certificate: 60 days", () => {
    assert.deepEqual(
      { kind: expiryFor(ITEM_BY_KEY.bank_statements_business, {}).kind, value: expiryFor(ITEM_BY_KEY.bank_statements_business, {}).value },
      { kind: "months", value: 3 }
    );
    const gs = expiryFor(ITEM_BY_KEY.certificate_good_standing, {});
    assert.deepEqual({ kind: gs.kind, value: gs.value }, { kind: "days", value: 60 });
  });

  test("the owner can move either window with a whole number of days, and junk is ignored", () => {
    const env = { DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS: "45", DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS: "30" };
    assert.equal(expiryFor(ITEM_BY_KEY.bank_statements_business, env).value, 45);
    assert.equal(expiryFor(ITEM_BY_KEY.bank_statements_business, env).kind, "days");
    assert.equal(expiryFor(ITEM_BY_KEY.certificate_good_standing, env).value, 30);
    const junk = { DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS: "soon", DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS: "-5" };
    assert.equal(expiryFor(ITEM_BY_KEY.bank_statements_business, junk).kind, "months");
    assert.equal(expiryFor(ITEM_BY_KEY.certificate_good_standing, junk).value, 60);
    assert.equal(expiryFor(ITEM_BY_KEY.id_document, env), null);
  });

  test("vaultSettings: ask window defaults to 3 days, takes a whole number from 1 to 30, ignores the rest", () => {
    assert.equal(vaultSettings({}).ask_every_days, DEFAULT_ASK_EVERY_DAYS);
    assert.equal(vaultSettings({}).ask_every_days_source, "default");
    assert.equal(vaultSettings({ DOCUMENT_VAULT_ASK_EVERY_DAYS: "5" }).ask_every_days, 5);
    assert.equal(vaultSettings({ DOCUMENT_VAULT_ASK_EVERY_DAYS: "5" }).ask_every_days_source, "DOCUMENT_VAULT_ASK_EVERY_DAYS");
    for (const bad of ["0", "31", "2.5", "x", ""]) {
      assert.equal(vaultSettings({ DOCUMENT_VAULT_ASK_EVERY_DAYS: bad }).ask_every_days, 3, bad);
    }
    assert.equal(vaultSettings({}).statement_window_months, 3);
    assert.equal(vaultSettings({}).good_standing_max_age_days, 60);
    assert.equal(vaultSettings({}).statement_max_age_days, null);
  });
});

describe("what the vault reads and leaves alone", () => {
  test("vault-only subtypes are real subtypes and are NOT ones the identity reader already handles", () => {
    for (const t of VAULT_ONLY_SUBTYPES) {
      assert.ok(SUBTYPES.client_upload.includes(t), t);
      assert.ok(!DOC_CHECK_TYPES.includes(t), `${t} is read by DOC-CHECK today — it cannot be vault-only`);
    }
  });

  test("it reads client uploads and the inquiry door, and skips mailing proofs and the like", () => {
    assert.deepEqual([...VAULT_DOCUMENT_KINDS], ["client_upload", "inquiry_doc"]);
    assert.ok(IGNORED_SUBTYPES.includes("dispute_mail_receipt"));
    for (const t of IGNORED_SUBTYPES) {
      for (const item of STANDARD_ITEMS) assert.ok(!item.subtypes.includes(t), `${t} is ignored but ${item.key} files it`);
    }
  });
});
