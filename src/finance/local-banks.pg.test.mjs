// Local banks (Finance OS unit LOC) against a real Postgres: the three address
// reads pull the ZIP, city and state of the home and each business, in order,
// for this org and this client only, and never the street.
//
// Skips without DATABASE_URL. Scratch databases only — it writes test rows
// (two clients with "+sim" emails, one identity row, one business) and removes them.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { readPlaces, HOME_SQL } from "./local-banks.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = randomUUID().slice(0, 8);
const EMAIL = `local_banks_pg+sim-${RUN}@example.com`;
const OTHER_EMAIL = `local_banks_pg+sim-${RUN}-other@example.com`;

let orgId = null;
let clientId = null;
let otherId = null;

async function wipe() {
  for (const email of [EMAIL, OTHER_EMAIL]) {
    await db.query(`DELETE FROM businesses WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [email]);
    await db.query(`DELETE FROM pii_identity WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [email]);
    await db.query(`DELETE FROM clients WHERE email = $1`, [email]);
  }
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, custom_fields)
     VALUES ($1, $2, 'Local', 'Banks', $3::jsonb) RETURNING id`,
    [orgId, EMAIL, JSON.stringify({ blueprint_business_plans: { postalCode: "99999", homeState: "AK" } })]
  )).rows[0].id;
  otherId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, custom_fields)
     VALUES ($1, $2, 'Other', 'Client', $3::jsonb) RETURNING id`,
    [orgId, OTHER_EMAIL, JSON.stringify({ blueprint_business_plans: { postalCode: "85003", homeState: "AZ" } })]
  )).rows[0].id;
  await db.query(
    `INSERT INTO pii_identity (org_id, client_id, ssn_enc, dob, addresses) VALUES ($1, $2, NULL, NULL, $3::jsonb)`,
    [orgId, clientId, JSON.stringify([{ addressLine1: "1 Sample St", city: "Phoenix", state: "AZ", postalCode: "85004" }])]
  );
  await db.query(
    `INSERT INTO businesses (org_id, client_id, name, entity_data) VALUES ($1, $2, 'Cedar Grove LLC', $3::jsonb)`,
    [orgId, clientId, JSON.stringify({ address_line1: "2 Sample Ave", city: "Tempe", state: "AZ", postal_code: "85281" })]
  );
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

describe("readPlaces", () => {
  test("home from the identity address, then each business; ZIP, city and state only", { skip: !HAS_DB }, async () => {
    const places = await readPlaces(db, { orgId, clientId });
    assert.deepEqual(places, [
      { kind: "home", label: "Home", zip: "85004", city: "PHOENIX", state: "AZ" },
      { kind: "business", label: "Cedar Grove LLC", zip: "85281", city: "TEMPE", state: "AZ" }
    ], "the identity address wins over the Blueprint setup ZIP");
    const raw = (await db.query(HOME_SQL, [orgId, clientId])).rows;
    assert.deepEqual(Object.keys(raw[0]).sort(), ["city", "state", "zip"], "the street never leaves the database");
  });

  test("another client in the same org reads only their own places", { skip: !HAS_DB }, async () => {
    const places = await readPlaces(db, { orgId, clientId: otherId });
    assert.deepEqual(places, [{ kind: "home", label: "Home", zip: "85003", city: null, state: "AZ" }]);
  });

  test("a client id from another org reads nothing", { skip: !HAS_DB }, async () => {
    const places = await readPlaces(db, { orgId: randomUUID(), clientId });
    assert.deepEqual(places, []);
  });
});
