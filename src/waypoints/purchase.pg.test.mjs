// Paying for the Capital Blueprint creates the client's checklist.
//
// WHY THESE ARE POSTGRES TESTS. Every claim here is a claim about ROWS: that a
// purchase writes client_waypoints, that paying twice leaves ONE set, that a
// buyer with no credit file gets fewer steps rather than invented ones, and
// that a checklist that cannot be built does not cost anyone their entitlement.
// None of that can be proved against a fake db object.
//
// THE PURCHASE IS NOT SIMULATED. These tests emit the real canonical event onto
// the real bus with the real money-chain handlers registered, exactly as
// src/handlers/money-chain.pg.test.mjs does. What is asserted is what a live
// payment does.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12 —
// a skipped pg test is not a green one).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { emit, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle } from "../handlers/client-lifecycle.mjs";
import { register as registerMoneyChain } from "../handlers/money-chain.mjs";
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
import {
  BLUEPRINT_PRODUCT_CODE,
  productCreatesChecklist,
  seedChecklistForPurchase,
  backfillPurchaseChecklists
} from "./purchase.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "blueprint_checklist_pg";
const EMAIL_LIKE = `${MARK}%`;

/* The Commas title the Capital Blueprint checkout carries. Written as the string
   a receipt actually holds, so resolveProductId() has to do the real
   name-to-product resolution rather than being handed a product id. */
const BLUEPRINT_TITLE = "Consulting Services Package";

/* Every child table that points at clients, read out of the catalog rather than
   typed here — the same trick src/waypoints/seed.pg.test.mjs uses, and for the
   same reason: a table that starts pointing at clients next month is cleaned up
   without anybody remembering to come back to this line. A missed child makes
   after() throw AFTER node:test has tallied, so the file prints all-pass and
   exits 1. */
async function deleteClients(ids) {
  if (!ids.length) return;
  const kids = (await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.confrelid = 'public.clients'::regclass
        AND c.contype = 'f'
        AND array_length(c.conkey, 1) = 1`
  )).rows;
  /* Two tables refuse an ordinary DELETE — a ledger and a grant record both
     carry a no-delete trigger — and they go FIRST, before anything else.
     entitlements.source_transaction_id is ON DELETE SET NULL, so deleting a
     client's transactions while their grants are still there nulls two grants
     down onto the same (org, client, code) key and violates
     idx_entitlements_grant_unique. Measured, not guessed: that is the error
     this ordering fixes. */
  const guarded = ["entitlements", "commission_ledger"];
  const ordered = [
    ...kids.filter((k) => guarded.includes(k.tbl.replace(/^public\./, ""))),
    ...kids.filter((k) => !guarded.includes(k.tbl.replace(/^public\./, "")))
  ];
  for (const k of ordered) {
    const tbl = k.tbl.replace(/^public\./, "");
    if (guarded.includes(tbl)) {
      await db.query(`ALTER TABLE ${tbl} DISABLE TRIGGER USER`);
      try {
        await db.query(`DELETE FROM ${k.tbl} WHERE ${k.col} = ANY($1::uuid[])`, [ids]);
      } finally {
        await db.query(`ALTER TABLE ${tbl} ENABLE TRIGGER USER`);
      }
      continue;
    }
    await db.query(`DELETE FROM ${k.tbl} WHERE ${k.col} = ANY($1::uuid[])`, [ids]);
  }
  await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [ids]);
}

async function purge() {
  const ids = (await db.query(
    `SELECT id FROM clients WHERE email LIKE $1`, [EMAIL_LIKE]
  )).rows.map((r) => r.id);
  await deleteClients(ids);
  await db.query(`DELETE FROM events WHERE payload->>'email' LIKE $1`, [EMAIL_LIKE]);
}

/** A credit file the way a real pull produces one — same builder the seeder's
 *  own tests use, through the real tier engine. Not a hand-written fixture. */
function creditFile(profile) {
  const payload = buildPayload(profile, {
    email: null,
    name: "Blueprint Buyer",
    pulledAt: "2026-09-05T00:00:00.000Z",
    identity: TEST_IDENTITY
  });
  return runTierEngineFromCrsResult(payload, {
    submittedName: "Blueprint Buyer",
    submittedAddress: "100 Test Ave, Denton, TX 76205"
  });
}

const waypointsFor = async (orgId, clientId) => (await db.query(
  `SELECT key, verify_kind, params, state
     FROM client_waypoints WHERE org_id = $1 AND client_id = $2
    ORDER BY position, key`,
  [orgId, clientId]
)).rows;

describe("paying for the Capital Blueprint creates the checklist", {
  skip: !HAS_DB ? "no DATABASE_URL" : false
}, () => {
  let org;

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerLifecycle();
    registerMoneyChain();
    org = await resolveDefaultOrg(db);
    await purge();

    /* Read the shipped catalog rather than seeding one. An empty
       waypoint_definitions table would make every assertion below pass
       vacuously — zero waypoints expected, zero found. */
    const defs = (await db.query(
      `SELECT count(*)::int AS n FROM waypoint_definitions WHERE active`
    )).rows[0].n;
    if (!defs) {
      throw new Error(
        "waypoint_definitions is empty. Apply db/migrations/362_waypoint_definitions_seed.sql " +
        "before running these tests — without it this file proves nothing."
      );
    }
  });

  after(async () => {
    await purge();
    await close();
  });

  const buy = async (email, { ref, amount = 5000, productName = BLUEPRINT_TITLE }) =>
    emit(db, "payment.received", {
      email,
      name: "Blueprint Buyer",
      productName,
      amount,
      providerRef: ref,
      source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:${ref}` });

  const clientByEmail = async (email) => (await db.query(
    `SELECT id FROM clients WHERE email = $1`, [email]
  )).rows[0]?.id;

  test("the product code the checklist hangs off is the Capital Blueprint's", () => {
    assert.equal(BLUEPRINT_PRODUCT_CODE, "consulting-package");
    assert.equal(productCreatesChecklist("consulting-package"), true);
    assert.equal(productCreatesChecklist("CONSULTING-PACKAGE"), true);
    // The $1,000 DIY letter downsell is a different product and buys no checklist.
    assert.equal(productCreatesChecklist("diy-letter-pack"), false);
    assert.equal(productCreatesChecklist("diagnostic"), false);
    assert.equal(productCreatesChecklist(null), false);
  });

  test("a Blueprint purchase writes the client's waypoints", async () => {
    const email = `${MARK}.full@example.com`;
    // The credit file exists BEFORE the payment, which is the ordinary order:
    // the diagnostic pull is what the Blueprint conversation is built on.
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Blueprint','Buyer',$2,$3::jsonb) RETURNING id`,
      [org, email, JSON.stringify({ state: "TX", city: "Denton" })]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, clientId, JSON.stringify(creditFile("repair"))]
    );

    const before = await waypointsFor(org, clientId);
    assert.equal(before.length, 0, "no checklist before the payment");

    await buy(email, { ref: `${MARK}_full_1` });

    const rows = await waypointsFor(org, clientId);
    assert.ok(rows.length > 0, "paying built a checklist");

    // The steps that need no credit file are all there.
    const keys = rows.map((r) => r.key);
    for (const k of [
      "blueprint_dispute_mail_letters",
      "blueprint_dispute_mail_receipt",
      "blueprint_dispute_bureau_response",
      "no_new_credit", "personal_loan", "form_llc", "get_ein", "business_checking"
    ]) {
      assert.ok(keys.includes(k), `expected step ${k}`);
    }
    // And this client, who HAS a file with cards on it, got paydown steps too.
    const paydowns = rows.filter((r) => r.verify_kind === "paydown");
    assert.ok(paydowns.length > 0, "a client with cards gets paydown steps");
    for (const p of paydowns) {
      assert.ok(
        Number.isFinite(Number(p.params?.target_balance_cents)) ||
        Number.isFinite(Number(p.params?.target_cents)) ||
        p.params?.creditor_key,
        "a paydown row is anchored to a real card"
      );
    }

    // The entitlement the Blueprint buys is granted as well — the checklist is
    // added beside it, never instead of it.
    const ents = (await db.query(
      `SELECT entitlement_code FROM entitlements
        WHERE org_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
      [org, clientId]
    )).rows.map((r) => r.entitlement_code);
    assert.ok(
      ents.includes("credit-optimization-roadmap"),
      "the Capital Blueprint entitlement is still granted"
    );
  });

  test("paying twice — and replaying the event — leaves ONE checklist", async () => {
    const email = `${MARK}.twice@example.com`;
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Blueprint','Buyer',$2,$3::jsonb) RETURNING id`,
      [org, email, JSON.stringify({ state: "TX" })]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, clientId, JSON.stringify(creditFile("repair"))]
    );

    await buy(email, { ref: `${MARK}_twice_1` });
    const first = await waypointsFor(org, clientId);
    assert.ok(first.length > 0);

    // The client ticks one off. A re-seed must never re-open it.
    await db.query(
      `UPDATE client_waypoints SET state = 'done', completed_at = now()
        WHERE org_id = $1 AND client_id = $2 AND key = 'form_llc'`,
      [org, clientId]
    );

    // Same payment arriving again (replay), then a second, genuinely separate
    // payment, then the backfill on top of both.
    await buy(email, { ref: `${MARK}_twice_1` });
    await buy(email, { ref: `${MARK}_twice_2` });
    await backfillPurchaseChecklists(db, { orgId: org, clientId });

    const after = await waypointsFor(org, clientId);
    assert.equal(after.length, first.length, "one checklist, not three");
    assert.equal(
      new Set(after.map((r) => r.key)).size, after.length,
      "no duplicate keys"
    );
    assert.equal(
      after.find((r) => r.key === "form_llc").state, "done",
      "a step the client finished stays finished"
    );
  });

  test("a buyer with NO credit file gets fewer steps, never invented ones", async () => {
    const email = `${MARK}.thin@example.com`;
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Blueprint','Buyer',$2) RETURNING id`,
      [org, email]
    )).rows[0].id;
    const files = (await db.query(
      `SELECT count(*)::int AS n FROM crs_results WHERE client_id = $1`, [clientId]
    )).rows[0].n;
    assert.equal(files, 0, "nobody has pulled this client's credit");

    await buy(email, { ref: `${MARK}_thin_1` });

    const rows = await waypointsFor(org, clientId);
    assert.ok(rows.length > 0, "a thin-file buyer still gets a checklist");

    // NOT ONE invented card. Every paydown step is a per-card step, and there
    // are no cards, so there must be none at all.
    assert.equal(
      rows.filter((r) => r.verify_kind === "paydown").length, 0,
      "no card, no paydown step — nothing is invented"
    );

    // The no-new-credit baseline says "we never looked" rather than "no cards".
    // An empty list would later read every card on the first real pull as newly
    // opened and accuse this client of breaking a rule they kept.
    const baseline = rows.find((r) => r.key === "no_new_credit");
    assert.ok(baseline, "the no-new-credit step is still there");
    assert.equal(baseline.params.accounts_at_seed, null, "NULL, not an empty list");
    assert.equal(baseline.params.snapshot_source, "none");

    // And it is strictly fewer steps than the buyer who had a file.
    const withFile = await waypointsFor(org, await clientByEmail(`${MARK}.full@example.com`));
    assert.ok(
      rows.length < withFile.length,
      "thin file means fewer steps than a full file"
    );
  });

  test("buying the $1,000 DIY letter pack does NOT create a checklist", async () => {
    /* The sharpest version of "only the Blueprint". Until 2026-09-17 these two
       products SHARED the code 'consulting-package'
       (db/migrations/384_diy_letter_pack_product.sql), so a rule keyed on the
       code would have handed a letter-pack buyer the Blueprint's checklist.
       They are separate products now and this proves the separation holds. */
    const email = `${MARK}.other@example.com`;
    await buy(email, {
      ref: `${MARK}_other_1`,
      amount: 1000,
      productName: "DIY Dispute Letter Pack"
    });
    const clientId = await clientByEmail(email);
    assert.ok(clientId, "the purchase recorded a client");

    // The purchase really did run — it granted what the DIY pack buys.
    const ents = (await db.query(
      `SELECT entitlement_code FROM entitlements
        WHERE org_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
      [org, clientId]
    )).rows.map((r) => r.entitlement_code);
    assert.ok(ents.includes("metro2-letter-pack"), "the DIY entitlement was granted");
    assert.ok(
      !ents.includes("credit-optimization-roadmap"),
      "and NOT the Blueprint's"
    );

    const rows = await waypointsFor(org, clientId);
    assert.equal(rows.length, 0, "a DIY buyer gets no Blueprint checklist");
  });

  test("a checklist that cannot be built never costs the customer anything", async () => {
    const email = `${MARK}.broken@example.com`;
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Blueprint','Buyer',$2) RETURNING id`,
      [org, email]
    )).rows[0].id;

    /* A db that fails the moment the seeder touches waypoint_definitions. The
       real failure modes are a dropped connection and a locked table; what
       matters is only that SOMETHING throws inside the seeder. */
    const brokenDb = {
      query: async (sql, params) => {
        if (/waypoint_definitions/i.test(String(sql))) {
          throw new Error("connection terminated unexpectedly");
        }
        return db.query(sql, params);
      }
    };
    const res = await seedChecklistForPurchase(brokenDb, {
      orgId: org, clientId, productCode: BLUEPRINT_PRODUCT_CODE
    });
    assert.equal(res.ok, false, "the failure is reported");
    assert.match(res.error, /connection terminated/);
    assert.deepEqual(res.seeded, []);

    // Now the real purchase, on the real db, with money attached. It must
    // succeed regardless.
    await buy(email, { ref: `${MARK}_broken_1` });
    const ents = (await db.query(
      `SELECT entitlement_code FROM entitlements
        WHERE org_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
      [org, clientId]
    )).rows.map((r) => r.entitlement_code);
    assert.ok(
      ents.includes("credit-optimization-roadmap"),
      "the entitlement survives"
    );
  });

  test("the backfill gives a checklist to somebody who already paid", async () => {
    const email = `${MARK}.already@example.com`;
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,'Blueprint','Buyer',$2,$3::jsonb) RETURNING id`,
      [org, email, JSON.stringify({ state: "TX" })]
    )).rows[0].id;
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
       VALUES ($1,$2,$3::jsonb,'repair')`,
      [org, clientId, JSON.stringify(creditFile("repair"))]
    );

    /* THIS IS SIM ELEVEN-BLUEPRINT'S SITUATION, reproduced: a succeeded $5,000
       'Consulting Services Package' transaction written straight to the table,
       with no event and therefore no checklist — which is exactly what every
       payment taken before today looks like. */
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid,
                                status, provider, provider_ref, raw_payload)
       VALUES ($1,$2,$3,5000.00,'succeeded','commas',$4,'{}'::jsonb)`,
      [org, clientId, BLUEPRINT_TITLE, `${MARK}_already_1`]
    );
    assert.equal((await waypointsFor(org, clientId)).length, 0, "no checklist yet");

    // The dry run finds them and writes nothing — that is what the operator
    // script does by default.
    const preview = await backfillPurchaseChecklists(db, { orgId: org, clientId, dryRun: true });
    assert.equal(preview.clients, 1, "the dry run found them");
    assert.equal((await waypointsFor(org, clientId)).length, 0, "and wrote nothing");

    const first = await backfillPurchaseChecklists(db, { orgId: org, clientId });
    assert.equal(first.clients, 1, "one client backfilled");
    assert.equal(first.failed.length, 0);
    const rows = await waypointsFor(org, clientId);
    assert.ok(rows.length > 0, "the backfill built their checklist");

    // Re-runnable: a second pass changes nothing.
    const again = await backfillPurchaseChecklists(db, { orgId: org, clientId });
    assert.equal(again.failed.length, 0);
    const after = await waypointsFor(org, clientId);
    assert.equal(after.length, rows.length, "still one checklist");
  });

  test("the backfill reports a payment it cannot resolve rather than guessing", async () => {
    const email = `${MARK}.unknown@example.com`;
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Blueprint','Buyer',$2) RETURNING id`,
      [org, email]
    )).rows[0].id;
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid,
                                status, provider, provider_ref, raw_payload)
       VALUES ($1,$2,'Some Product Nobody Has Ever Sold',5000.00,'succeeded',
               'commas',$3,'{}'::jsonb)`,
      [org, clientId, `${MARK}_unknown_1`]
    );
    const out = await backfillPurchaseChecklists(db, { orgId: org, clientId });
    assert.equal(out.clients, 0, "nothing was guessed");
    assert.equal(out.unresolved.length, 1, "the gap is reported");
    assert.equal((await waypointsFor(org, clientId)).length, 0);
  });
});
