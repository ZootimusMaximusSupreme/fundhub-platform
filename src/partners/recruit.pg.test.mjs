// The recruit bonus, against real Postgres.
//
// recruit.test.mjs proves the arithmetic. These prove the things only a real
// database can:
//
//   1. THE COLUMN EXISTS AND REFUSES THE OBVIOUS FRAUD. A partner cannot be
//      recorded as recruiting themselves, and a recruiter in another org cannot
//      be recorded at all.
//   2. THE BONUS ACTUALLY FIRES. Before db/migrations/281 and this module, the
//      bonus was correct code that could never run. Every band below drives the
//      real payment.received handler and reads the partner_revenue row back.
//   3. THE FLAT $6,000 IS FLAT AT EVERY LENDER BAND. The entry is usually
//      financed; the remittance moves from 85% to 30% of the $30,000 and the
//      bonus does not move at all (20% of the sticker, owner-set 2026-11-07).
//      That is the sharp edge W1 §5 names, proved band by band rather than
//      described.
//   4. CASH FIRST. Nothing accrues on an approval, a submission or a $0 payment.
//   5. A REPLAY PAYS ONCE. Two deliveries of the same event write one row.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs file.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  setRecruiter, getRecruiter, accrueRecruitBonusForEntry, onEntryFeePaid,
  computeEntryEconomics
} from "./recruit.mjs";
import { ENTRY_FEE_CENTS } from "./revenue.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const REF = "recruit-test";
const SLUGS = ["recruit-test-recruiter", "recruit-test-brought", "recruit-test-stranger"];
const OTHER_ORG_SLUG = "recruit-test-other-org";

/** W1-money-model.md §5, the D5 lender bands, on the $30,000 sticker. Cents, always. */
const BANDS = [
  { name: "prime-85", pct: 85, remitCents: 2_550_000 },
  { name: "lb1-77",   pct: 77, remitCents: 2_310_000 },
  { name: "near-75",  pct: 75, remitCents: 2_250_000 },
  { name: "lb2-72",   pct: 72, remitCents: 2_160_000 },
  { name: "lb3-62",   pct: 62, remitCents: 1_860_000 },
  { name: "lb4-50",   pct: 50, remitCents: 1_500_000 },
  { name: "sub-42",   pct: 42, remitCents: 1_260_000 },
  { name: "lb5-30",   pct: 30, remitCents:   900_000 }
];

describe("partner recruit bonus", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, otherOrg, recruiterId, broughtId, strangerId, entryProductId, addOnProductId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    otherOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Recruit Test Other Org') RETURNING id`,
      [OTHER_ORG_SLUG])).rows[0].id;

    entryProductId = (await db.query(
      `INSERT INTO products (org_id, code, name, category, default_price, price_is_variable)
       VALUES ($1,'partner-entry','Recruit Test Partner Entry','partner','30000.00',false)
       RETURNING id`, [org])).rows[0].id;
    addOnProductId = (await db.query(
      `INSERT INTO products (org_id, code, name, category, default_price, price_is_variable)
       VALUES ($1,'recruit-test-addon','Recruit Test Add On','partner','297.00',false)
       RETURNING id`, [org])).rows[0].id;

    [recruiterId, broughtId, strangerId] = await Promise.all(SLUGS.map(async (slug, i) => (
      await db.query(
        `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at, revenue_share_pct)
         VALUES ($1,$2,$3,'active',now(),50) RETURNING id`,
        [org, `Recruit Test ${i}`, slug])).rows[0].id
    ));
  });

  async function cleanup() {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM partner_revenue WHERE partner_id IN
         (SELECT id FROM partners WHERE slug LIKE $1)`, [`${REF}%`]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`DELETE FROM payment_links WHERE link_ref LIKE $1`, [`${REF}%`]);
    await db.query(`DELETE FROM transactions WHERE provider_ref LIKE $1`, [`${REF}%`]);
    await db.query(`DELETE FROM events WHERE idempotency_key LIKE $1`, [`${REF}%`]);
    // Recruiters before the recruited: partners_recruiter_fk is ON DELETE RESTRICT.
    await db.query(`UPDATE partners SET recruited_by_partner_id = NULL WHERE slug LIKE $1`,
      [`${REF}%`]);
    await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [`${REF}%`]);
    await db.query(`DELETE FROM products WHERE code IN ('partner-entry','recruit-test-addon')
                      AND name LIKE 'Recruit Test%'`);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [OTHER_ORG_SLUG]);
  }

  beforeEach(async () => {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`DELETE FROM partner_revenue WHERE partner_id = ANY($1)`,
      [[recruiterId, broughtId, strangerId]]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`UPDATE partners SET recruited_by_partner_id = NULL WHERE org_id = $1 AND slug LIKE $2`,
      [org, `${REF}%`]);
  });

  after(async () => { await cleanup(); await close(); });

  let seq = 0;

  /** A partner who paid the entry fee, wired the way the money chain wires it:
   *  a transactions row for the cash that actually arrived, an events row behind
   *  it, and a payment_links row carrying the partner identity. */
  async function seedEntryPayment({
    partnerId, amountCents = ENTRY_FEE_CENTS, productId = entryProductId
  } = {}) {
    const tag = `${REF}-${++seq}`;
    // amount_paid is WHAT ARRIVED. The $30,000 sticker lives in raw_payload.
    await db.query(
      `INSERT INTO transactions (org_id, product_name, amount_paid, status, provider,
                                 provider_ref, raw_payload)
       VALUES ($1,'partner-entry',$2,'paid','test',$3,$4::jsonb)`,
      [org, (amountCents / 100).toFixed(2), tag,
       JSON.stringify({ stickerCents: ENTRY_FEE_CENTS })]);
    const eventId = (await db.query(
      `INSERT INTO events (org_id, name, payload, idempotency_key)
       VALUES ($1,'payment.received','{}'::jsonb,$2) RETURNING id`, [org, tag])).rows[0].id;
    await db.query(
      `INSERT INTO payment_links (org_id, partner_id, product_id, purpose, amount_cents,
                                  link_ref, checkout_url, status, provider)
       VALUES ($1,$2,$3,'custom',$4,$5,'https://example.invalid/x','paid','test')`,
      [org, partnerId, productId, amountCents, tag]);

    return {
      id: eventId,
      orgId: org,
      name: "payment.received",
      payload: {
        ref: tag,
        providerRef: tag,
        amount: (amountCents / 100).toFixed(2),
        product: "partner_entry"
      }
    };
  }

  async function accrualsFor(partnerId) {
    const { rows } = await db.query(
      `SELECT gross_amount, share_pct_applied, share_amount, status, client_id
         FROM partner_revenue WHERE partner_id = $1 ORDER BY created_at`, [partnerId]);
    return rows;
  }

  // ------------------------------------------------------------------
  describe("the column, and what the database refuses", () => {
    test("a partner cannot recruit themselves — the CHECK raises", async () => {
      await assert.rejects(
        () => db.query(`UPDATE partners SET recruited_by_partner_id = id WHERE id = $1`,
          [broughtId]),
        /partners_no_self_recruit_ck/
      );
    });

    test("a recruiter in another org cannot be recorded — the composite FK raises", async () => {
      const foreign = (await db.query(
        `INSERT INTO partners (org_id, name, slug, status)
         VALUES ($1,'Recruit Test Foreign','recruit-test-foreign','active') RETURNING id`,
        [otherOrg])).rows[0].id;
      await assert.rejects(
        () => db.query(`UPDATE partners SET recruited_by_partner_id = $2 WHERE id = $1`,
          [broughtId, foreign]),
        /partners_recruiter_fk/
      );
      await db.query(`DELETE FROM partners WHERE id = $1`, [foreign]);
    });

    test("NULL is the normal state and means nobody is owed", async () => {
      const r = await getRecruiter(db, { orgId: org, partnerId: strangerId });
      assert.equal(r.found, true);
      assert.equal(r.recruiterPartnerId, null);
    });
  });

  // ------------------------------------------------------------------
  describe("setRecruiter", () => {
    test("records who brought whom", async () => {
      const res = await setRecruiter(db, {
        orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId
      });
      assert.equal(res.set, true);
      const back = await getRecruiter(db, { orgId: org, partnerId: broughtId });
      assert.equal(back.recruiterPartnerId, recruiterId);
    });

    test("writing the same recruiter twice is a no-op, not an error", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const again = await setRecruiter(db, {
        orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId
      });
      assert.equal(again.set, false);
      assert.equal(again.reason, "already_set");
    });

    test("moving the bonus to somebody else is refused", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const moved = await setRecruiter(db, {
        orgId: org, partnerId: broughtId, recruiterPartnerId: strangerId
      });
      assert.equal(moved.set, false);
      assert.equal(moved.reason, "recruiter_conflict");
      assert.equal(moved.recruiterPartnerId, recruiterId, "it names who really holds it");
      const back = await getRecruiter(db, { orgId: org, partnerId: broughtId });
      assert.equal(back.recruiterPartnerId, recruiterId);
    });

    test("self-recruit is refused before it reaches the database", async () => {
      const res = await setRecruiter(db, {
        orgId: org, partnerId: broughtId, recruiterPartnerId: broughtId
      });
      assert.equal(res.reason, "self_recruit");
    });

    test("a direct loop is refused — one sale cannot pay two bonuses", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const loop = await setRecruiter(db, {
        orgId: org, partnerId: recruiterId, recruiterPartnerId: broughtId
      });
      assert.equal(loop.set, false);
      assert.equal(loop.reason, "cycle");
    });

    test("a recruiter in another org is simply not found", async () => {
      const foreign = (await db.query(
        `INSERT INTO partners (org_id, name, slug, status)
         VALUES ($1,'Recruit Test Foreign2','recruit-test-foreign2','active') RETURNING id`,
        [otherOrg])).rows[0].id;
      const res = await setRecruiter(db, {
        orgId: org, partnerId: broughtId, recruiterPartnerId: foreign
      });
      assert.equal(res.set, false);
      assert.equal(res.reason, "no_recruiter");
      await db.query(`DELETE FROM partners WHERE id = $1`, [foreign]);
    });
  });

  // ------------------------------------------------------------------
  describe("the flat $6,000 at every lender band", () => {
    for (const band of BANDS) {
      test(`${band.pct}% band: $${band.remitCents / 100} arrives, the recruiter still earns exactly $6,000`,
        async () => {
          await setRecruiter(db, {
            orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId
          });
          const event = await seedEntryPayment({
            partnerId: broughtId, amountCents: band.remitCents
          });

          const res = await onEntryFeePaid(event, db);
          assert.equal(res.accrued, true, `band ${band.name} did not accrue`);
          assert.equal(res.recruiterPartnerId, recruiterId);

          const rows = await accrualsFor(recruiterId);
          assert.equal(rows.length, 1, "exactly one bonus row");
          const row = rows[0];
          assert.equal(Number(row.share_amount), 6000, "the bonus is $6,000 flat");
          assert.equal(Number(row.gross_amount), 30000, "against the $30,000 STICKER, not the remittance");
          assert.equal(Number(row.share_pct_applied), 20);
          assert.equal(row.status, "accrued");
          assert.equal(row.client_id, null, "a recruited partner is not a client");

          // Nothing accrued to the partner who was brought in — they are not owed.
          assert.equal((await accrualsFor(broughtId)).length, 0);

          // And FundHub's own net for this band, stated rather than implied.
          const econ = computeEntryEconomics({ remittedCents: band.remitCents });
          assert.equal(econ.fundhubNetCents, band.remitCents - 600_000);
          assert.equal(econ.negative, false, "no band on the D5 table is negative");
        });
    }

    test("the bonus does not scale with the band — 30% and 85% pay identically", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const worst = await seedEntryPayment({ partnerId: broughtId, amountCents: 900_000 });
      await onEntryFeePaid(worst, db);
      const low = (await accrualsFor(recruiterId))[0];

      await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
      await db.query(`DELETE FROM partner_revenue WHERE partner_id = $1`, [recruiterId]);
      await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);

      const best = await seedEntryPayment({ partnerId: broughtId, amountCents: 2_550_000 });
      await onEntryFeePaid(best, db);
      const high = (await accrualsFor(recruiterId))[0];

      assert.equal(Number(low.share_amount), Number(high.share_amount));
      assert.equal(Number(low.share_amount), 6000);
    });
  });

  // ------------------------------------------------------------------
  describe("cash first, and once only", () => {
    test("a replayed event pays the bonus once", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const event = await seedEntryPayment({ partnerId: broughtId, amountCents: 1_260_000 });

      const first = await onEntryFeePaid(event, db);
      const second = await onEntryFeePaid(event, db);

      assert.equal(first.accrued, true);
      assert.equal(second.accrued, false);
      assert.equal(second.reason, "already_accrued");
      assert.equal((await accrualsFor(recruiterId)).length, 1);
    });

    test("a $0 payment accrues nothing — approval is not cash", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const event = await seedEntryPayment({ partnerId: broughtId, amountCents: 100 });
      event.payload.amount = "0.00";

      const res = await onEntryFeePaid(event, db);
      assert.equal(res.accrued, false);
      assert.equal(res.reason, "no_cash_landed");
      assert.equal((await accrualsFor(recruiterId)).length, 0);
    });

    test("an unknown amount is unknown — it does not read as zero and it does not pay", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const event = await seedEntryPayment({ partnerId: broughtId });
      delete event.payload.amount;

      const res = await onEntryFeePaid(event, db);
      assert.equal(res.reason, "unknown_amount");
      assert.equal((await accrualsFor(recruiterId)).length, 0);
    });

    test("nobody recruited them, so nobody is paid", async () => {
      const event = await seedEntryPayment({ partnerId: strangerId });
      const res = await onEntryFeePaid(event, db);
      assert.equal(res.accrued, false);
      assert.equal(res.reason, "no_recruiter");
      assert.equal((await accrualsFor(recruiterId)).length, 0);
    });

    test("an add-on is not the entry fee — no second bonus on a recurring product", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const event = await seedEntryPayment({
        partnerId: broughtId, amountCents: 29_700, productId: addOnProductId
      });
      event.payload.product = "creative_intelligence";

      const res = await onEntryFeePaid(event, db);
      assert.equal(res.accrued, false);
      assert.equal(res.reason, "not_the_entry_fee");
      assert.equal((await accrualsFor(recruiterId)).length, 0);
    });

    test("a client's ordinary payment passes straight through without throwing", async () => {
      const res = await onEntryFeePaid({
        id: null,
        orgId: org,
        name: "payment.received",
        payload: { amount: "3000.00", product: "funding", providerRef: `${REF}-none` }
      }, db);
      assert.equal(res.accrued, false);
      assert.equal(res.reason, "not_a_partner_entry");
    });
  });

  // ------------------------------------------------------------------
  describe("accrueRecruitBonusForEntry, driven directly", () => {
    test("a replay-safe key is required — no transaction and no event writes nothing", async () => {
      await setRecruiter(db, { orgId: org, partnerId: broughtId, recruiterPartnerId: recruiterId });
      const res = await accrueRecruitBonusForEntry(db, {
        orgId: org, partnerId: broughtId, transactionId: null, sourceEventId: null
      });
      assert.equal(res.accrued, false);
      assert.equal(res.reason, "no_idempotency_key");
      assert.equal((await accrualsFor(recruiterId)).length, 0);
    });

    test("an unknown partner is a reason, not a crash", async () => {
      const res = await accrueRecruitBonusForEntry(db, {
        orgId: org, partnerId: "00000000-0000-4000-8000-000000000000"
      });
      assert.equal(res.accrued, false);
      assert.equal(res.reason, "no_partner");
    });
  });
});
