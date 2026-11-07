// The recruit bonus arithmetic and its refusals. No database.
//
// The band table below is W1-money-model.md §5's D5 remittance bands, applied
// to the $30,000 sticker (owner-set 2026-11-07; it was $10,000). It is the whole
// point of the unit: the bonus is a FLAT $6,000 — 20% of the $30,000 STICKER —
// at every band, so FundHub's net moves with the lender and the promise does
// not. The 30% row is the worst case on record and it still nets $3,000 —
// positive, thin, and deliberate.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  computeEntryEconomics, checkRecruitPair, isEntryFeeProduct, cashLanded,
  ENTRY_FEE_PRODUCT_CODES
} from "./recruit.mjs";
import { ENTRY_FEE_CENTS, RECRUIT_BONUS_PCT, computeRecruitBonus } from "./revenue.mjs";
import { OFFERS } from "../config/offers.mjs";

/** W1-money-model.md §5, the D5 band table, on the $30,000 sticker. Cents, always. */
const BANDS = [
  { name: "Prime 680+",      pct: 85, remitCents: 2_550_000, netCents: 1_950_000 },
  { name: "Lender B tier 1", pct: 77, remitCents: 2_310_000, netCents: 1_710_000 },
  { name: "Near prime 600+", pct: 75, remitCents: 2_250_000, netCents: 1_650_000 },
  { name: "Lender B tier 2", pct: 72, remitCents: 2_160_000, netCents: 1_560_000 },
  { name: "Lender B tier 3", pct: 62, remitCents: 1_860_000, netCents: 1_260_000 },
  { name: "Lender B tier 4", pct: 50, remitCents: 1_500_000, netCents:   900_000 },
  { name: "Sub Prime A",     pct: 42, remitCents: 1_260_000, netCents:   660_000 },
  { name: "Lender B tier 5", pct: 30, remitCents:   900_000, netCents:   300_000 }
];

describe("the locked numbers", () => {
  test("entry fee is $30,000 in cents and the bonus rule is 20%", () => {
    assert.equal(ENTRY_FEE_CENTS, 3_000_000);
    assert.equal(RECRUIT_BONUS_PCT, 20);
  });

  test("the bonus is $6,000 flat", () => {
    assert.equal(computeRecruitBonus().shareCents, 600_000);
  });

  test("the bonus is 20% of the entry fee, whatever the fee is (owner-set 2026-11-07)", () => {
    // The fee base is the catalogue's own entry price, and the bonus is a fifth
    // of it. Either half moving alone fails here.
    assert.equal(ENTRY_FEE_CENTS, OFFERS.PARTNER_ENTRY.priceCents, "the bonus base is the catalogue entry fee");
    assert.equal(computeRecruitBonus().shareCents, (OFFERS.PARTNER_ENTRY.priceCents * 20) / 100);
    for (const fee of [1_000_000, 3_000_000, 4_500_000]) {
      assert.equal(computeRecruitBonus({ entryFeeCents: fee }).shareCents, (fee * 20) / 100, `20% of ${fee}`);
    }
  });

  test("cash paid in full: FundHub nets $24,000", () => {
    const e = computeEntryEconomics({ remittedCents: 3_000_000 });
    assert.equal(e.bonusCents, 600_000);
    assert.equal(e.fundhubNetCents, 2_400_000);
    assert.equal(e.negative, false);
  });
});

describe("every lender band pays the same flat $6,000", () => {
  for (const band of BANDS) {
    test(`${band.name} (${band.pct}%): $${band.remitCents / 100} in, $6,000 out, $${band.netCents / 100} kept`, () => {
      // The band's own arithmetic, so a typo in the fixture fails too.
      assert.equal(band.remitCents, (ENTRY_FEE_CENTS * band.pct) / 100);

      const e = computeEntryEconomics({ remittedCents: band.remitCents });
      assert.equal(e.entryFeeCents, ENTRY_FEE_CENTS, "the sticker never moves");
      assert.equal(e.bonusCents, 600_000, "the bonus never moves");
      assert.equal(e.fundhubNetCents, band.netCents);
      assert.equal(e.negative, false, "no band is negative");
    });
  }

  test("the worst band on record still leaves FundHub $3,000", () => {
    const worst = BANDS[BANDS.length - 1];
    assert.equal(worst.pct, 30);
    assert.equal(computeEntryEconomics({ remittedCents: worst.remitCents }).fundhubNetCents, 300_000);
  });

  test("a band below 20% would go negative — the arithmetic says so, it is not hidden", () => {
    const e = computeEntryEconomics({ remittedCents: 450_000 });
    assert.equal(e.fundhubNetCents, -150_000);
    assert.equal(e.negative, true);
  });
});

describe("NULL is unknown and survives", () => {
  test("no remittance figure yields a null net, never 0", () => {
    const e = computeEntryEconomics({});
    assert.equal(e.remittedCents, null);
    assert.equal(e.fundhubNetCents, null);
    assert.equal(e.bonusCents, 600_000, "the promise is known even when the cash is not");
  });

  test("a non-numeric remittance throws rather than guessing", () => {
    assert.throws(() => computeEntryEconomics({ remittedCents: "lots" }), RangeError);
  });
});

describe("cashLanded", () => {
  test("dollars on the payload convert to cents", () => {
    assert.deepEqual(cashLanded({ amount: "4200.00" }), {
      landed: true, reason: null, amountCents: 420_000
    });
  });

  test("explicit cents win over dollars", () => {
    assert.equal(cashLanded({ amount: "1.00", amountCents: 300_000 }).amountCents, 300_000);
  });

  test("a missing amount is unknown, not zero", () => {
    assert.equal(cashLanded({}).reason, "unknown_amount");
    assert.equal(cashLanded({ amount: null }).reason, "unknown_amount");
    assert.equal(cashLanded({ amount: "" }).reason, "unknown_amount");
    assert.equal(cashLanded({}).amountCents, null);
  });

  test("zero and negative are cash that did not land", () => {
    assert.equal(cashLanded({ amount: "0" }).reason, "no_cash_landed");
    assert.equal(cashLanded({ amount: "0" }).landed, false);
    assert.equal(cashLanded({ amountCents: -1 }).landed, false);
  });

  test("garbage is unknown, not zero", () => {
    assert.equal(cashLanded({ amount: "abc" }).reason, "unknown_amount");
  });
});

describe("checkRecruitPair", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  test("a partner cannot recruit themselves", () => {
    assert.deepEqual(checkRecruitPair({ partnerId: A, recruiterPartnerId: A }),
      { ok: false, reason: "self_recruit" });
  });

  test("two different partners are fine", () => {
    assert.deepEqual(checkRecruitPair({ partnerId: A, recruiterPartnerId: B }),
      { ok: true, reason: null });
  });

  test("missing either side is a reason, not a crash", () => {
    assert.equal(checkRecruitPair({ recruiterPartnerId: B }).reason, "no_partner");
    assert.equal(checkRecruitPair({ partnerId: A }).reason, "no_recruiter");
  });
});

describe("isEntryFeeProduct", () => {
  test("the entry fee code matches, cased and padded however it arrives", () => {
    assert.equal(isEntryFeeProduct("partner-entry"), true);
    assert.equal(isEntryFeeProduct("  PARTNER-ENTRY "), true);
    assert.equal(isEntryFeeProduct("partner_entry"), true);
  });

  test("an add-on is not the entry fee — no recruit bonus is owed on one", () => {
    for (const code of ["creative-intelligence", "dfy-marketing", "lead-flow",
                        "winners-board", "card-stacking-dfy", "repair-bundle",
                        "live-trial"]) {
      assert.equal(isEntryFeeProduct(code), false, code);
    }
  });

  test("nothing and empty are not the entry fee", () => {
    assert.equal(isEntryFeeProduct(null), false);
    assert.equal(isEntryFeeProduct(undefined), false);
    assert.equal(isEntryFeeProduct(""), false);
    assert.equal(isEntryFeeProduct("   "), false);
  });
});

/* THE SEAM. src/trials/constants.mjs is owned by the live-trial unit and declares
   the same products.code for the same $30,000 sale. Two numbers that disagree is
   the bug; two that must agree with a test holding them is a seam. If that module
   is not present in this checkout the assertion is skipped rather than faked —
   an absent file is not evidence of agreement. */
test("the entry-fee product code agrees with the live-trial unit", async (t) => {
  let constants;
  try {
    constants = await import("../trials/constants.mjs");
  } catch {
    t.skip("src/trials/constants.mjs is not in this checkout");
    return;
  }
  assert.equal(
    constants.PARTNER_ENTRY_PRODUCT_CODE,
    ENTRY_FEE_PRODUCT_CODES[0],
    "the partner entry products.code forked — one of these two is now wrong"
  );
  assert.equal(
    constants.PARTNER_ENTRY_PRICE_CENTS,
    ENTRY_FEE_CENTS,
    "the $30,000 entry fee forked"
  );
});
