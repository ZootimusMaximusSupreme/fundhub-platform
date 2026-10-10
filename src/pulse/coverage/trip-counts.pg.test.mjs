// The shared light count of the five trip lanes, on a real Postgres. Read only. Skips without DATABASE_URL.
//
// trip-kit.mjs builds ONE statement from the five lanes' light counts so the audit's re-check of
// "nothing to judge" costs one read. This proves the one statement is valid SQL on the real schema (the
// placeholders moved past each other, every cast typed) and that each column is the same answer the
// lane's own count gives, on made-up people.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import "./gap-trip-funding.mjs";
import "./gap-trip-inquiry.mjs";
import "./gap-trip-partner.mjs";
import "./gap-trip-repair.mjs";
import "./gap-trip-roadmap.mjs";
import { buildSharedCount } from "./trip-kit.mjs";
import { HAS_DB, ORG, closeShadowDb, emptyWorld, runWorld, uid } from "./trip-test-kit.mjs";

const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const ALL_TABLES = [
  "clients", "payment_links", "events", "sales", "products", "funding_rounds", "repair_programs", "inquiry_removal_cases",
  "affiliates", "accounts", "partners"
];

after(async () => {
  if (HAS_DB) await closeShadowDb();
});

const skip = HAS_DB ? false : "DATABASE_URL is not set";

test("the shared count is one valid statement with a column per trip", { skip }, async () => {
  const built = buildSharedCount(ORG, NOW);
  assert.deepEqual([...built.ids].sort(), ["trip:funding", "trip:inquiry", "trip:partner", "trip:repair", "trip:roadmap"]);
  const w = emptyWorld(ALL_TABLES);
  const out = await runWorld(built.sql, w, built.params);
  assert.equal(out.rows.length, 1);
  for (const id of built.ids) assert.equal(out.rows[0][id], 0, `${id} is 0 on an empty world`);
});

test("each column counts its own trip", { skip }, async () => {
  const w = emptyWorld(ALL_TABLES);
  const client = uid();
  w.clients.rows.push({
    id: client, org_id: ORG, client_code: "FH-1", email: "buyer@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(90 * DAY), updated_at: ago(DAY), partner_id: null
  });
  // a paid roadmap link and a paid diagnostic start two trips for the same client
  w.payment_links.rows.push({
    org_id: ORG, client_id: client, purpose: "diagnostic", status: "paid", link_ref: "slo_a", paid_at: ago(DAY),
    updated_at: ago(DAY), identity_stored_at: null, is_demo: false
  });
  // an affiliate with a login who applied last week
  const aff = uid();
  w.affiliates.rows.push({
    id: aff, org_id: ORG, name: "Pat Referrer", tracking_id: "PAT1", status: "active", created_at: ago(7 * DAY),
    activated_at: null, is_demo: false, tier_level: "tier1", partner_license_signed_at: null, tax_form_received_at: null
  });
  w.accounts.rows.push({ id: uid(), org_id: ORG, kind: "affiliate", email: "pat@gmail.com", client_id: null, affiliate_id: aff, last_login_at: null });
  const built = buildSharedCount(ORG, NOW);
  const out = await runWorld(built.sql, w, built.params);
  const row = out.rows[0];
  assert.equal(row["trip:funding"], 1);
  assert.equal(row["trip:roadmap"], 1);
  assert.equal(row["trip:partner"], 1);
  assert.equal(row["trip:repair"], 0);
  assert.equal(row["trip:inquiry"], 0);
});
