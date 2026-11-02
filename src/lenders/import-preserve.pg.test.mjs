// Disposable Postgres only: all import writes target a transaction-local TEMP lenders
// table that shadows public.lenders, then ROLLBACK. Never run against live Supabase.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { importLendersCsv, updateLender } from "./store.mjs";

let IS_CI = false;
try {
  const u = new URL(process.env.DATABASE_URL);
  IS_CI = ["127.0.0.1", "localhost", "::1"].includes(u.hostname) &&
    u.pathname === "/fundhub_ci";
} catch { /* no disposable CI connection */ }

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const staff = { name: "Synthetic CI Operator" };

test("same-org partial CSV cannot erase Apply URL/reactivate inactive; other org is isolated", {
  skip: !IS_CI && "requires disposable localhost fundhub_ci"
}, async () => {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    // The importer uses unqualified 'lenders' and therefore reads/writes ONLY
    // this temporary table, never the actual database lender catalog.
    await c.query("CREATE TEMP TABLE lenders (LIKE public.lenders INCLUDING DEFAULTS) ON COMMIT DROP");
    await c.query(
      "INSERT INTO lenders (id, org_id, lender_table, name, external_row_id, application_url, active) " +
      "VALUES ($1,$2,'OnlineBizCC','Example A','legacy-1','https://example.test/a',false), " +
      "($3,$4,'OnlineBizCC','Example B','legacy-1','https://example.test/b',true)",
      [ID_A, A, ID_B, B]
    );
    const read = async (id) => (await c.query(
      "SELECT application_url, active FROM lenders WHERE id = $1::uuid", [id]
    )).rows[0];
    const csv = (url = "", active = "") =>
      "lender_table,name,external_row_id,application_url,active\n" +
      "OnlineBizCC,Example A,legacy-1," + url + "," + active + "\n";

    let r = await importLendersCsv(c, { orgId: A, text: csv(), staff });
    assert.equal(r.updated, 1);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(await read(ID_A), { application_url: "https://example.test/a", active: false });
    assert.deepEqual(await read(ID_B), { application_url: "https://example.test/b", active: true });

    r = await importLendersCsv(c, {
      orgId: A, text: "lender_table,name,external_row_id\nOnlineBizCC,Example A,legacy-1\n", staff
    });
    assert.equal(r.updated, 1);
    assert.deepEqual(await read(ID_A), { application_url: "https://example.test/a", active: false });

    r = await importLendersCsv(c, { orgId: A, text: csv("https://example.test/a-new", "true"), staff });
    assert.equal(r.updated, 1);
    assert.deepEqual(await read(ID_A), { application_url: "https://example.test/a-new", active: true });
    assert.deepEqual(await read(ID_B), { application_url: "https://example.test/b", active: true });

    r = await importLendersCsv(c, { orgId: A, text: csv(), staff });
    assert.equal(r.updated, 1);
    assert.deepEqual(await read(ID_A), { application_url: "https://example.test/a-new", active: true });

    // A deliberate staff edit remains capable of clearing the address.
    await updateLender(c, { orgId: A, id: ID_A, patch: { application_url: null }, staff });
    assert.deepEqual(await read(ID_A), { application_url: null, active: true });
    assert.deepEqual(await read(ID_B), { application_url: "https://example.test/b", active: true });

    // Brand-new lender without active or URL is still active by default.
    const created = await importLendersCsv(c, {
      orgId: A,
      text: "lender_table,name,external_row_id,application_url\nOnlineBizCC,New Bank,new-row,\n",
      staff
    });
    assert.equal(created.imported, 1);
    assert.deepEqual(created.errors, []);
    const inserted = (await c.query(
      "SELECT application_url, active FROM lenders WHERE org_id=$1::uuid AND external_row_id='new-row'",
      [A]
    )).rows[0];
    assert.deepEqual(inserted, { application_url: null, active: true });
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
});

after(async () => { if (IS_CI) await close(); });
