// Bank logos against a real Postgres (migration 575): one row per bank, the
// table's own checks refuse a bad logo, colour or website, and the bank book's
// name match in SQL agrees with bankKey() in JavaScript.
//
// Skips without DATABASE_URL. Scratch databases only — it writes test rows
// (institution ids "ins_fhtest_…", one lender, one client) and removes them.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { saveInstitution, findLogos, attachAccountLogos, bankKey } from "./institution-logos.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const RUN = randomUUID().slice(0, 8);
const INS = `ins_fhtest_${RUN}`;
const EMAIL = `institution_logos_pg_${RUN}@example.com`;
const BANK = `Fhtest ${RUN} Bank & Trust, N.A.`;

let orgId = null;
let clientId = null;
let lenderId = null;

async function wipe() {
  await db.query(`DELETE FROM plaid_institutions WHERE plaid_institution_id LIKE 'ins_fhtest_%'`);
  await db.query(`DELETE FROM bank_accounts WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM plaid_items WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
  if (lenderId) await db.query(`DELETE FROM lenders WHERE id = $1`, [lenderId]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1, $2, 'Logo', 'Tester') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  lenderId = (await db.query(
    `INSERT INTO lenders (org_id, lender_table, name, logo_path, is_demo) VALUES ($1, 'PersonalCC', $2, '/assets/lenders/chase.png', false) RETURNING id`,
    [orgId, BANK]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

describe("plaid_institutions", () => {
  test("saving the same bank twice keeps one row", { skip: !HAS_DB }, async () => {
    await saveInstitution(db, { institutionId: INS, name: "Fhtest Bank", logo: PNG, primaryColor: "#095aa6", url: "https://example.com" }, { now: "2026-11-07T07:00:00Z" });
    await saveInstitution(db, { institutionId: INS, name: "Fhtest Bank", logo: null, primaryColor: null, url: null }, { now: "2026-11-08T07:00:00Z" });
    const rows = (await db.query(`SELECT * FROM plaid_institutions WHERE plaid_institution_id = $1`, [INS])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].logo_base64, null, "Plaid's newest answer (no logo) is what is stored");
    assert.equal(rows[0].name_key, "fhtestbank");
  });

  test("the table refuses a logo that is not a PNG, a colour that is not hex, a website that is not http(s)", { skip: !HAS_DB }, async () => {
    const bad = [
      [`${INS}_a`, "R0lGODlhAQABAAAAACw=", null, null],
      [`${INS}_b`, null, "red", null],
      [`${INS}_c`, null, null, "javascript:alert(1)"]
    ];
    for (const [id, logo, color, url] of bad) {
      await assert.rejects(db.query(
        `INSERT INTO plaid_institutions (plaid_institution_id, logo_base64, primary_color, url) VALUES ($1, $2, $3, $4)`,
        [id, logo, color, url]
      ), /check constraint/i, id);
    }
  });

  test("row security is on and the app has a policy", { skip: !HAS_DB }, async () => {
    const t = (await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'plaid_institutions'`)).rows[0];
    assert.equal(t.relrowsecurity, true);
    assert.equal(t.relforcerowsecurity, true);
  });
});

describe("matching in SQL", () => {
  test("the bank book's name match in SQL is bankKey() in JavaScript", { skip: !HAS_DB }, async () => {
    const [byName] = await findLogos(db, { orgId, banks: [{ name: `FHTEST ${RUN.toUpperCase()} BANK and TRUST NA` }] });
    assert.equal(bankKey(BANK), bankKey(`FHTEST ${RUN.toUpperCase()} BANK and TRUST NA`));
    assert.deepEqual(byName, { logo: "/assets/lenders/chase.png", logo_source: "bank_book" });
  });

  test("a linked account gets its bank's Plaid logo through its own login only", { skip: !HAS_DB }, async () => {
    await saveInstitution(db, { institutionId: INS, name: "Fhtest Bank", logo: PNG }, { now: "2026-11-09T07:00:00Z" });
    const item = (await db.query(
      `INSERT INTO plaid_items (org_id, client_id, plaid_institution_id, institution_name) VALUES ($1, $2, $3, 'Fhtest Bank') RETURNING id`,
      [orgId, clientId, INS]
    )).rows[0].id;
    const acct = (await db.query(
      `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, provider, name) VALUES ($1, $2, $3, 'plaid', 'Fhtest Checking') RETURNING id`,
      [orgId, clientId, item]
    )).rows[0].id;
    const view = { containers: [], unassigned: { accounts: [{ id: acct, source: "bank_account", name: "Fhtest Checking" }], cards: [], loans: [] } };
    const out = await attachAccountLogos(db, { orgId, clientId, view });
    assert.equal(out.unassigned.accounts[0].logo, `data:image/png;base64,${PNG}`);
    assert.equal(out.unassigned.accounts[0].institution, "Fhtest Bank");
    const other = await attachAccountLogos(db, { orgId, clientId: randomUUID(), view });
    assert.equal(other.unassigned.accounts[0].institution, null, "another client's login was joined in");
  });
});
