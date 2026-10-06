// Capital Blueprint dispute-round waypoints — seed scope and document proof verify.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { buildPayload } from "../../scripts/sim/push-credit.mjs";

/* A test identity, so the simulator never reads the owner's gitignored file
   (credentials/sim-identity/owner-identity.local.json). That file exists only
   on Chris's Mac, so in CI every test here died in its hook with "identity file
   not found" (2026-10-05). Same pattern as
   src/deliverables/business-duplication-map.test.mjs. */
const TEST_IDENTITY = Object.freeze({
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
});
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { seedClientWaypoints } from "./seed.mjs";
import { evaluateWaypoints } from "./verify.mjs";
import { listWaypoints } from "./store.mjs";
import { seedChecklistForPurchase, BLUEPRINT_PRODUCT_CODE } from "./purchase.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL_LIKE = "waypoint.blueprint.dispute.pg.%@example.com";
const ENROLLED_AT = new Date("2026-09-29T12:00:00.000Z");

async function deleteClients(ids) {
  if (!ids.length) return;
  const kids = (await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.confrelid = 'public.clients'::regclass
        AND c.contype = 'f'
        AND c.confdeltype <> 'c'
        AND array_length(c.conkey, 1) = 1`
  )).rows;
  for (const k of kids) {
    await db.query(`DELETE FROM ${k.tbl} WHERE ${k.col} = ANY($1::uuid[])`, [ids]);
  }
  await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
}

async function purge() {
  const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [EMAIL_LIKE]))
    .rows.map((r) => r.id);
  await deleteClients(ids);
}

function creditFile(profile) {
  const payload = buildPayload(profile, {
    email: null,
    name: "Blueprint Dispute Subject",
    pulledAt: "2026-09-05T00:00:00.000Z",
    identity: TEST_IDENTITY
  });
  return runTierEngineFromCrsResult(payload, {
    submittedName: "Blueprint Dispute Subject",
    submittedAddress: "100 Test Ave, Denton, TX 76205"
  });
}

describe("Capital Blueprint dispute waypoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let client;

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Dispute','Seed',$2,$3::jsonb) RETURNING id`,
      [org, "waypoint.blueprint.dispute.pg.subject@example.com", JSON.stringify({ state: "TX" })]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, client, JSON.stringify(creditFile("repair"))]
    );
  });

  after(async () => {
    await purge();
    await close();
  });

  test("repair-style seed omits Blueprint dispute rows", async () => {
    await seedClientWaypoints(db, { orgId: org, clientId: client, now: ENROLLED_AT });
    const keys = (await listWaypoints(db, { orgId: org, clientId: client })).map((r) => r.key);
    for (const k of [
      "blueprint_dispute_mail_letters",
      "blueprint_dispute_mail_receipt",
      "blueprint_dispute_bureau_response"
    ]) {
      assert.ok(!keys.includes(k), `repair seed must not include ${k}`);
    }
  });

  test("Blueprint purchase seed includes dispute rows", async () => {
    await db.query(`DELETE FROM client_waypoints WHERE client_id = $1`, [client]);
    const res = await seedChecklistForPurchase(db, {
      orgId: org,
      clientId: client,
      productCode: BLUEPRINT_PRODUCT_CODE,
      now: ENROLLED_AT
    });
    assert.equal(res.ok, true);
    const keys = (await listWaypoints(db, { orgId: org, clientId: client })).map((r) => r.key);
    for (const k of [
      "blueprint_dispute_mail_letters",
      "blueprint_dispute_mail_receipt",
      "blueprint_dispute_bureau_response"
    ]) {
      assert.ok(keys.includes(k), `Blueprint seed must include ${k}`);
    }
  });

  test("upload proof closes document-verify waypoints without a credit re-pull", async () => {
    await db.query(
      `INSERT INTO documents
         (org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type, generated_at)
       VALUES ($1,$2,$3,'client_upload','dispute_mail_receipt','Mailing proof',
               'test/blueprint/mail.jpg','image/jpeg','2026-09-29T00:00:00Z')`,
      [org, client, `client_upload|dispute_mail_receipt|${client}`]
    );

    const out = await evaluateWaypoints(db, { orgId: org, clientId: client, now: ENROLLED_AT });
    assert.ok(
      out.completed.some((c) => c.key === "blueprint_dispute_mail_receipt"),
      "mail receipt upload closes the step"
    );

    await db.query(
      `INSERT INTO documents
         (org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type, generated_at)
       VALUES ($1,$2,$3,'bureau_response','bureau_letter','Bureau reply',
               'test/blueprint/bureau.pdf','application/pdf','2026-10-01T00:00:00Z')`,
      [org, client, `bureau_response|bureau_letter|${client}`]
    );

    const out2 = await evaluateWaypoints(db, { orgId: org, clientId: client, now: ENROLLED_AT });
    assert.ok(
      out2.completed.some((c) => c.key === "blueprint_dispute_bureau_response"),
      "bureau response upload closes the step"
    );
  });
});
