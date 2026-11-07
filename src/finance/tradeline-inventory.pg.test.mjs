// The tradeline inventory against a real Postgres (migration 590): an account
// the client adds persists, comes back only for that client in that org, and
// the table's own checks refuse what the screen would refuse.
//
// Skips without DATABASE_URL. Scratch databases only — it writes test rows
// (two clients and one business container, all named "tl_pg_<run>") and
// removes them.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { readTradelineEntry, addTradelineEntry, readTradelineInventory } from "./tradeline-inventory.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = randomUUID().slice(0, 8);
const EMAIL_A = `tl_pg_${RUN}_a@example.com`;
const EMAIL_B = `tl_pg_${RUN}_b@example.com`;

let orgId = null;
let clientA = null;
let clientB = null;
let bizA = null;

async function wipe() {
  const ids = (await db.query(`SELECT id FROM clients WHERE email = ANY($1::text[])`, [[EMAIL_A, EMAIL_B]])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db.query(`DELETE FROM finance_tradeline_entries WHERE client_id = ANY($1::uuid[])`, [ids]);
  await db.query(`DELETE FROM entities WHERE client_id = ANY($1::uuid[])`, [ids]);
  await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  const add = (email) => db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1, $2, 'Tradeline', 'Tester') RETURNING id`,
    [orgId, email]
  ).then((r) => r.rows[0].id);
  clientA = await add(EMAIL_A);
  clientB = await add(EMAIL_B);
  bizA = (await db.query(
    `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1, $2, 'business', $3) RETURNING id`,
    [orgId, clientA, `tl_pg_${RUN} LLC`]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

describe("finance_tradeline_entries", () => {
  test("a manual add persists and reads back for that client only", { skip: !HAS_DB }, async () => {
    const input = readTradelineEntry({ creditor: "Chase", product: "Ink Business Cash", type: "credit_card", limit: "10,000",
      opened: "2021-03", belongs_to: `entity:${bizA}` });
    const r = await addTradelineEntry(db, { orgId, clientId: clientA, input, by: { kind: "client", id: null } });
    assert.equal(r.ok, true);
    const row = (await db.query(`SELECT * FROM finance_tradeline_entries WHERE id = $1`, [r.entry_id])).rows[0];
    assert.equal(row.client_id, clientA);
    assert.equal(row.entity_id, bizA);
    assert.equal(Number(row.limit_cents), 1000000);
    assert.equal(row.opened_month, "2021-03");

    const mine = await readTradelineInventory(db, { orgId, clientId: clientA });
    const ink = mine.items.find((i) => i.entry_id === r.entry_id);
    assert.ok(ink, "the added account is in the inventory");
    assert.deepEqual(ink.sources, ["you"]);
    const theirs = await readTradelineInventory(db, { orgId, clientId: clientB });
    assert.ok(!theirs.items.some((i) => i.entry_id === r.entry_id), "another client never sees it");
  });

  test("another client's business container is refused", { skip: !HAS_DB }, async () => {
    const input = readTradelineEntry({ creditor: "Chase", type: "credit_card", belongs_to: `entity:${bizA}` });
    const r = await addTradelineEntry(db, { orgId, clientId: clientB, input });
    assert.deepEqual(r, { ok: false, reason: "business_not_found" });
  });

  test("the table refuses a limit on a checking account, a zero limit, a bad month and a business with no owner", { skip: !HAS_DB }, async () => {
    const insert = (over) => db.query(
      `INSERT INTO finance_tradeline_entries (org_id, client_id, creditor, account_type, limit_cents, opened_month, scope, entity_id, business_name, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'client')`,
      [orgId, clientA, over.creditor ?? "Chase", over.type ?? "credit_card", over.limit ?? null, over.opened ?? null,
        over.scope ?? "personal", over.entity ?? null, over.business ?? null]
    );
    await assert.rejects(insert({ type: "checking", limit: 1000 }), /check constraint/i);
    await assert.rejects(insert({ limit: 0 }), /check constraint/i);
    await assert.rejects(insert({ opened: "2021-13" }), /check constraint/i);
    await assert.rejects(insert({ scope: "business" }), /check constraint/i, "a business entry names its business");
    await assert.rejects(insert({ scope: "personal", business: "Acme LLC" }), /check constraint/i);
    await assert.rejects(insert({ creditor: " " }), /check constraint/i);
  });

  test("row security is on and forced", { skip: !HAS_DB }, async () => {
    const t = (await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'finance_tradeline_entries'`)).rows[0];
    assert.equal(t.relrowsecurity, true);
    assert.equal(t.relforcerowsecurity, true);
    const p = (await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'finance_tradeline_entries'`)).rows[0];
    assert.ok(p.n >= 1, "a table with row security and no policy is locked shut");
  });
});
