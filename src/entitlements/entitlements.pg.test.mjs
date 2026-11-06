// Postgres-backed tests for entitlements. Skipped without DATABASE_URL.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  forClient, has, grant, grantFromTransaction, revoke, catalog, unmappedProducts,
  reconcileFromTransactions
} from "./entitlements.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CODE = "metro2-letter-pack";

/* FIXTURE PRODUCT CODES, and why the tests stopped borrowing a real one.
   These tests used 'repair-bundle' as their scratch product and wiped
   product_entitlements for the whole org between tests. Both stopped being safe
   the moment 180_product_entitlements_seed.sql put real configuration in that
   table: the wipe would delete shipped config from whatever database
   DATABASE_URL points at, and the inserts would collide with the seeded row.
   Fixture rows now carry an 'ent-fixture' prefix, and the wipe only removes
   those. Nothing this file writes can touch a real mapping. */
const FIXTURE_PRODUCT = "ent-fixture-product";
const FIXTURE_UNMAPPED = "ent-fixture-unmapped";

describe("entitlements", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, clientId, otherClient, staffId, txA, txB, fixtureProductId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ent','One') RETURNING id`,
      [org])).rows[0].id;
    otherClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Ent','Two') RETURNING id`,
      [org])).rows[0].id;
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,'ent-fixture@x.io','Ent Fixture','admin','active') RETURNING id`,
      [org])).rows[0].id;
    txA = (await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
       VALUES ($1,$2,'Credit Repair Bundle',1500,'paid') RETURNING id`,
      [org, clientId])).rows[0].id;
    txB = (await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
       VALUES ($1,$2,'Credit Repair Bundle',1500,'paid') RETURNING id`,
      [org, clientId])).rows[0].id;
    // A sellable product that no migration maps, so the "which products grant
    // nothing yet" report has something of ours to find and lose.
    fixtureProductId = (await db.query(
      `INSERT INTO products (org_id, code, name, category, price_is_variable, sort_order)
       VALUES ($1,$2,'Entitlement fixture product','diagnostic',true,999) RETURNING id`,
      [org, FIXTURE_UNMAPPED])).rows[0].id;
  });

  /* Scoped to this file's own rows, deliberately. The org-wide DELETEs that
     used to live here would have wiped every real client's grants and the
     shipped product→entitlement configuration. */
  const wipe = async () => {
    await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`);
    await db.query(
      `DELETE FROM entitlements WHERE org_id = $1 AND client_id = ANY($2)`,
      [org, [clientId, otherClient].filter(Boolean)]);
    await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`);
    await db.query(
      `DELETE FROM product_entitlements WHERE org_id = $1 AND product_code LIKE 'ent-fixture%'`,
      [org]);
  };

  beforeEach(wipe);

  after(async () => {
    await wipe();
    await db.query(`DELETE FROM products WHERE id = $1`, [fixtureProductId]);
    await db.query(`DELETE FROM transactions WHERE id = ANY($1)`, [[txA, txB]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [[clientId, otherClient]]);
    await db.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await close();
  });

  // ── the catalog is what makes a locked tile representable ──

  /* WAS "the five deliverables". The portal ships SIX tiles
     (public/app/client-portal.html) and the catalog held five codes, so the
     sixth — the Funding Mastery course — had no code to gate on and could never
     open. 180_product_entitlements_seed.sql adds it. This assertion moved from
     five to six on purpose. */
  test("the catalog holds a code for every deliverable tile the portal renders", async () => {
    const rows = await catalog(db, { orgId: org, kind: "deliverable" });
    assert.deepEqual(rows.map((r) => r.code).sort(), [
      "bank-lender-match-list", "credit-analysis-report",
      "credit-optimization-roadmap", "funding-mastery-course",
      "funding-snapshot", "metro2-letter-pack"
    ]);
    assert.ok(rows.every((r) => r.kind === "deliverable"));
    const allKinds = await catalog(db, { orgId: org });
    assert.equal(allKinds.find(r => r.code === "blueprint-client-fulfillment")?.kind, "service");
  });

  test("a client with no grants gets six locked tiles, not an empty screen", async () => {
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 0);
    assert.equal(r.locked.length, 6, "the portal must be able to render the upsell");
    assert.equal(r.all.length, 6);
  });

  // ── grant, and the re-delivery guarantee ──

  test("a grant shows up as held and moves out of locked", async () => {
    const g = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(g.granted, true);

    const r = await forClient(db, { orgId: org, clientId });
    assert.deepEqual(r.held.map((h) => h.code), [CODE]);
    assert.equal(r.locked.length, 5);
    assert.equal(r.held[0].entitlement_name ?? r.held[0].name, "Metro 2 Dispute Letter Pack");
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("re-delivering the same transaction grants nothing new", async () => {
    const a = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const b = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(a.granted, true);
    assert.equal(b.granted, false);
    assert.equal(b.reason, "already_granted");
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1 AND entitlement_code = $2`,
      [clientId, CODE]);
    assert.equal(rows[0].n, 1);
  });

  test("a genuine second purchase is a second row", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const b = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txB });
    assert.equal(b.granted, true, "a different transaction must grant again");
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1 AND entitlement_code = $2`,
      [clientId, CODE]);
    assert.equal(rows[0].n, 2);
  });

  test("repeated manual grants collapse rather than stacking", async () => {
    // source_transaction_id NULL on both; NULLS NOT DISTINCT is what saves this.
    const a = await grant(db, { orgId: org, clientId, code: CODE, grantedBy: staffId,
      reason: "comped" });
    const b = await grant(db, { orgId: org, clientId, code: CODE, grantedBy: staffId,
      reason: "comped again" });
    assert.equal(a.granted, true);
    assert.equal(b.granted, false);
  });

  /* ONE PURCHASE, ONE GRANT. Measured on production 2026-09-06: a $200 repair
     client held metro2-letter-pack twice — once from the payment, carrying a
     transaction id, and once from the enrolment behind it, carrying none.
     Because the unique index treats NULL as distinct from every real id,
     nothing collided and the portal drew the letter pack twice. */

  test("a sourceless grant adds nothing to a code the client already holds", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const second = await grant(db, { orgId: org, clientId, code: CODE, reason: "repair_enroll:full" });
    assert.equal(second.granted, false);
    assert.equal(second.reason, "already_active");
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1 AND entitlement_code = $2`,
      [clientId, CODE]);
    assert.equal(rows[0].n, 1, "the enrolment granted the letter pack a second time");
  });

  test("a sourceless grant still works when they do not hold it yet", async () => {
    const g = await grant(db, { orgId: org, clientId, code: CODE, grantedBy: staffId, reason: "comped" });
    assert.equal(g.granted, true);
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("a sourceless grant is not blocked by a REVOKED one — that is the reinstate path", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "chargeback" });
    const g = await grant(db, { orgId: org, clientId, code: CODE, reason: "re-enrolled by hand" });
    assert.equal(g.granted, true, "a revoked client could never be re-granted by hand");
  });

  test("the portal shows one tile per code even when two live grants exist", async () => {
    // Force the shape production was in: two live rows, one code.
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txB });
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1 AND entitlement_code = $2`,
      [clientId, CODE]);
    assert.equal(rows[0].n, 2, "the ledger rule changed — two purchases must still be two rows");

    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.all.filter((x) => x.code === CODE).length, 1,
      "the client's screen listed the same entitlement twice");
    assert.equal(r.held.filter((x) => x.code === CODE).length, 1);
    assert.equal(r.all.length, 6);
  });

  test("grants are scoped per client", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
    assert.equal(await has(db, { orgId: org, clientId: otherClient, code: CODE }), false);
  });

  test("the code is folded, so mixed case and whitespace are one grant", async () => {
    const a = await grant(db, { orgId: org, clientId, code: "  Metro2-Letter-Pack  ",
      sourceTransactionId: txA });
    const b = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(a.granted, true);
    assert.equal(b.granted, false, "the folded form must collide with the canonical one");

    const { rows } = await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1`, [clientId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entitlement_code, CODE);
    assert.equal(await has(db, { orgId: org, clientId, code: "METRO2-LETTER-PACK" }), true);
  });

  // ── expiry and revocation, and the no-delete rule ──

  test("an expired grant is not active but the row survives", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA,
      durationDays: 1, now: new Date(Date.now() - 3 * 86_400_000) });
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 0);
    const row = r.all.find((x) => x.code === CODE);
    assert.ok(row.granted_at, "the grant history must still be visible");
    assert.ok(row.expires_at);
  });

  test("a perpetual grant never expires", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA,
      durationDays: null });
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 1);
    assert.equal(r.held[0].expires_at, null);
  });

  test("revoke stamps the row instead of deleting it", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    const out = await revoke(db, { orgId: org, clientId, code: CODE, by: staffId,
      reason: "chargeback" });
    assert.equal(out.revoked, 1);
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);

    const { rows } = await db.query(
      `SELECT revoked_at, revoke_reason FROM entitlements WHERE client_id = $1`, [clientId]);
    assert.equal(rows.length, 1, "the row must survive revocation");
    assert.ok(rows[0].revoked_at);
    assert.equal(rows[0].revoke_reason, "chargeback");
  });

  /* This test was called "re-purchasing after a revocation reinstates" but used
     txA for BOTH grants — the same transaction, i.e. a REPLAY, not a
     re-purchase. It encoded the same confusion the code had, and asserted the
     harmful behaviour: a redelivered webhook resurrecting access that had been
     revoked after a chargeback. Split into the three cases that actually
     differ. */

  test("REPLAYING the same transaction does NOT resurrect a revoked grant", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "chargeback" });
    const replay = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal(replay.granted, false, "a replayed webhook un-revoked a chargeback");
    assert.equal(replay.reason, "revoked");
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);
  });

  test("a genuine RE-PURCHASE grants again — a different transaction is a new row", async () => {
    // This is the case the old comment claimed to protect, and it never needed
    // the reinstate branch: a different source_transaction_id does not conflict.
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "chargeback" });
    const repurchase = await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txB });
    assert.equal(repurchase.granted, true);
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("reinstating is possible, but only when a caller explicitly asks", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await revoke(db, { orgId: org, clientId, code: CODE, by: staffId, reason: "mistake" });
    const back = await grant(db, {
      orgId: org, clientId, code: CODE, sourceTransactionId: txA, reinstate: true
    });
    assert.equal(back.granted, true);
    assert.equal(back.reason, "reinstated");
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("revoking twice is a no-op, not a second stamp", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    assert.equal((await revoke(db, { orgId: org, clientId, code: CODE })).revoked, 1);
    assert.equal((await revoke(db, { orgId: org, clientId, code: CODE })).revoked, 0);
  });

  test("rows cannot be deleted — a delivered document stays delivered", async () => {
    await grant(db, { orgId: org, clientId, code: CODE, sourceTransactionId: txA });
    await assert.rejects(
      () => db.query(`DELETE FROM entitlements WHERE client_id = $1`, [clientId]),
      /not deletable/
    );
  });

  test("deleting the client still cascades — only direct deletes are blocked", async () => {
    const tmp = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Tmp','Cascade') RETURNING id`,
      [org])).rows[0].id;
    await grant(db, { orgId: org, clientId: tmp, code: CODE });
    await db.query(`DELETE FROM clients WHERE id = $1`, [tmp]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1`, [tmp]);
    assert.equal(rows[0].n, 0);
  });

  // ── the purchase path, and the gap 032 deliberately leaves open ──

  test("an unmapped product grants nothing and says so — no guessed mapping", async () => {
    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: FIXTURE_PRODUCT
    });
    assert.equal(out.unmapped, true);
    // WAS: unmapped:true and nothing else. A caller could not tell "no mapping"
    // from "no client" or "no product", so the refusal was unreportable.
    assert.equal(out.reason, "no_mapping");
    assert.deepEqual(out.granted, []);
    assert.equal((await forClient(db, { orgId: org, clientId })).held.length, 0);
  });

  test("once configured, a purchase grants the mapped entitlements", async () => {
    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES ($1,$3,$2), ($1,$3,'credit-analysis-report')`,
      [org, CODE, FIXTURE_PRODUCT]);

    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: FIXTURE_PRODUCT
    });
    assert.equal(out.unmapped, false);
    assert.equal(out.reason, null);
    assert.deepEqual(out.granted.sort(), ["credit-analysis-report", CODE].sort());

    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 2);
    assert.equal(r.locked.length, 4);
  });

  /* THE POINT OF MIGRATION 180. Everything above proves the machinery works
     once someone fills the table in. These prove the table is now filled in for
     the products shipped code can defend — which is what "money landed and
     nothing opened" actually needed. */
  test("the seeded mapping turns a real repair purchase into the letter pack", async () => {
    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "repair-bundle"
    });
    assert.equal(out.unmapped, false, "180_product_entitlements_seed.sql not applied?");
    assert.deepEqual(out.granted, [CODE]);
    assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
  });

  test("the seeded mapping covers diagnostic, funding and the DIY package too", async () => {
    const cases = [
      ["diagnostic", "credit-analysis-report"],
      ["card-stacking-dfy", "funding-snapshot"],
      ["consulting-package", "metro2-letter-pack"]
    ];
    for (const [productCode, code] of cases) {
      const out = await grantFromTransaction(db, {
        orgId: org, clientId, transactionId: txA, productCode
      });
      assert.equal(out.unmapped, false, `${productCode} is unmapped`);
      assert.ok(out.granted.includes(code), `${productCode} did not grant ${code}`);
    }
  });

  /* GAP 10, live walk 2026-09-16. A client paid $5,000 for the Capital Blueprint
     ("Consulting Services Package") and the Capital Blueprint tile in their
     portal still read LOCKED, while two tiles they had not bought read
     "Included". The tile gates on `credit-optimization-roadmap`
     (public/app/client-portal.html MAP, UWIQ_DELIVERABLES) and nothing mapped
     the product to that code. db/migrations/383_blueprint_entitlement.sql adds
     the one missing row; this fails if it is not applied. */
  test("a paid Capital Blueprint grants the roadmap its portal tile gates on", async () => {
    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "consulting-package"
    });
    assert.equal(out.unmapped, false, "consulting-package is unmapped");
    assert.ok(
      out.granted.includes("credit-optimization-roadmap"),
      "383_blueprint_entitlement.sql not applied — the Capital Blueprint tile stays locked for a paying client"
    );
    assert.equal(
      await has(db, { orgId: org, clientId, code: "credit-optimization-roadmap" }),
      true
    );
    // The letter pack 180 already granted is still granted. Nothing was taken away.
    assert.ok(out.granted.includes("metro2-letter-pack"));
  });

  /* ── THE RECONCILE PATH ───────────────────────────────────────────────────
     WHY THIS EXISTS. product_entitlements is a LOOKUP, read once when a payment
     is processed. Adding a row to it afterwards unlocks nobody who has already
     paid. Measured on production 2026-09-17:
     383_blueprint_entitlement.sql mapped 'consulting-package' to
     'credit-optimization-roadmap' at 23:13; Sim Eleven-Blueprint's $5,000 payment
     had been granted at 17:46; the row was in the table and his tile was still
     locked. reconcileFromTransactions() is what closes that gap.

     EVERY CALL BELOW PASSES clientId. Left out, reconcile walks the WHOLE org,
     which is right in production and wrong in a test file that may be pointed at
     a database holding real clients. Keep the scope. */
  describe("reconcileFromTransactions", () => {
    let paidTx, unknownTx;

    before(async () => {
      paidTx = (await db.query(
        `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
         VALUES ($1,$2,'Credit Repair Bundle',1000,'succeeded') RETURNING id`,
        [org, clientId])).rows[0].id;
      // A product string that matches no product and no alias. It must grant
      // nothing and be REPORTED, never guessed at.
      unknownTx = (await db.query(
        `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
         VALUES ($1,$2,'ent-fixture nothing sells this',999,'succeeded') RETURNING id`,
        [org, clientId])).rows[0].id;
    });

    after(async () => {
      await db.query(`DELETE FROM transactions WHERE id = ANY($1)`, [[paidTx, unknownTx]]);
    });

    test("a client who paid before the mapping existed ends up unlocked", async () => {
      assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);
      const out = await reconcileFromTransactions(db, { orgId: org, clientId });
      assert.ok(
        out.granted.some((g) => g.entitlementCode === CODE),
        `reconcile granted nothing: ${JSON.stringify(out)}`
      );
      assert.equal(await has(db, { orgId: org, clientId, code: CODE }), true);
    });

    test("running it twice adds nothing the first run did not", async () => {
      const first = await reconcileFromTransactions(db, { orgId: org, clientId });
      const again = await reconcileFromTransactions(db, { orgId: org, clientId });
      assert.ok(first.granted.length > 0);
      assert.deepEqual(again.granted, [], "a second run wrote grants — it is not idempotent");
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM entitlements
          WHERE client_id = $1 AND entitlement_code = $2 AND source_transaction_id = $3`,
        [clientId, CODE, paidTx]);
      assert.equal(rows[0].n, 1);
    });

    /* THE ONE THING A BACKFILL MUST NEVER DO. A grant somebody deliberately
       revoked after a refund or a chargeback must stay revoked. The revoked row
       still occupies the unique key, so the insert conflicts and does nothing —
       the same rule grant() enforces, which reinstates only when a caller asks
       it to in so many words. */
    test("a deliberately revoked grant is not resurrected", async () => {
      await reconcileFromTransactions(db, { orgId: org, clientId });
      await revoke(db, { orgId: org, clientId, code: CODE, reason: "chargeback" });
      assert.equal(await has(db, { orgId: org, clientId, code: CODE }), false);

      const out = await reconcileFromTransactions(db, { orgId: org, clientId });
      assert.deepEqual(out.granted, []);
      assert.equal(
        await has(db, { orgId: org, clientId, code: CODE }), false,
        "reconcile brought back access that had been revoked"
      );
    });

    test("a product string nothing sells is reported, never guessed", async () => {
      const out = await reconcileFromTransactions(db, { orgId: org, clientId });
      assert.ok(
        out.unresolved.some((u) => String(u.transactionId) === String(unknownTx)),
        `the unmatchable transaction was not reported: ${JSON.stringify(out.unresolved)}`
      );
    });

    test("a failed payment unlocks nothing", async () => {
      const failed = (await db.query(
        `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status)
         VALUES ($1,$2,'Card Stacking DFY',3000,'failed') RETURNING id`,
        [org, clientId])).rows[0].id;
      try {
        const out = await reconcileFromTransactions(db, { orgId: org, clientId });
        assert.ok(
          !out.granted.some((g) => g.entitlementCode === "funding-snapshot"),
          "a FAILED payment granted the funding deliverable"
        );
        assert.equal(await has(db, { orgId: org, clientId, code: "funding-snapshot" }), false);
      } finally {
        await db.query(`DELETE FROM transactions WHERE id = $1`, [failed]);
      }
    });
  });

  test("replaying a real purchase grants once, not twice", async () => {
    const first = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "diagnostic" });
    const again = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "diagnostic" });
    assert.deepEqual(first.granted, ["credit-analysis-report"]);
    assert.deepEqual(again.granted, []);
    assert.deepEqual(again.skipped, ["credit-analysis-report"]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements
        WHERE client_id = $1 AND entitlement_code = 'credit-analysis-report'`,
      [clientId]);
    assert.equal(rows[0].n, 1);
  });

  test("the offers we could not defend stay unmapped — nothing was guessed", async () => {
    // inquiry-removal is a real product with no shipped code saying what it
    // delivers. 180 leaves it blank on purpose. If someone maps it later they
    // should have to change this line and say why.
    const out = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: "inquiry-removal"
    });
    assert.equal(out.unmapped, true);
    assert.deepEqual(out.granted, []);
  });

  test("replaying a purchase is idempotent", async () => {
    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES ($1,$3,$2)`, [org, CODE, FIXTURE_PRODUCT]);
    const first = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: FIXTURE_PRODUCT });
    const again = await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: FIXTURE_PRODUCT });
    assert.deepEqual(first.granted, [CODE]);
    assert.deepEqual(again.granted, []);
    assert.deepEqual(again.skipped, [CODE]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM entitlements WHERE client_id = $1`, [clientId]);
    assert.equal(rows[0].n, 1);
  });

  test("a term-limited mapping produces an expiring grant", async () => {
    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code, duration_days)
       VALUES ($1,$3,$2,30)`, [org, CODE, FIXTURE_PRODUCT]);
    await grantFromTransaction(db, {
      orgId: org, clientId, transactionId: txA, productCode: FIXTURE_PRODUCT });
    const r = await forClient(db, { orgId: org, clientId });
    assert.equal(r.held.length, 1);
    assert.ok(r.held[0].expires_at, "duration_days must produce an expiry");
  });

  test("unmappedProducts reports every product that grants nothing yet", async () => {
    const before = await unmappedProducts(db, { orgId: org });
    assert.ok(before.some((p) => p.code === FIXTURE_UNMAPPED), JSON.stringify(before));
    // The four products 180 mapped must NOT be in this report any more.
    for (const mapped of ["diagnostic", "card-stacking-dfy", "repair-bundle", "consulting-package"]) {
      assert.ok(!before.some((p) => p.code === mapped), `${mapped} still reports as unmapped`);
    }
    const n = before.length;

    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES ($1,$3,$2)`, [org, CODE, FIXTURE_UNMAPPED]);
    const after = await unmappedProducts(db, { orgId: org });
    assert.equal(after.length, n - 1);
    assert.ok(!after.some((p) => p.code === FIXTURE_UNMAPPED));
  });

  // ── argument guards ──

  test("required arguments are enforced", async () => {
    await assert.rejects(() => forClient(db, { orgId: org }), /required/);
    await assert.rejects(() => grant(db, { orgId: org, clientId }), /required/);
    await assert.rejects(
      () => grantFromTransaction(db, { orgId: org, clientId }), /required/);
    assert.equal(await has(db, { orgId: org, clientId }), false);
  });

  test("the database rejects an uppercase code even if the helper is bypassed", async () => {
    await assert.rejects(
      () => db.query(
        `INSERT INTO entitlements (org_id, client_id, entitlement_code)
         VALUES ($1,$2,'Metro2-Letter-Pack')`, [org, clientId]),
      /entitlements_code_ck/
    );
  });
});
