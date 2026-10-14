import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_IDS as W1 } from "../../coverage/gap-money-funding.mjs";
import { CHECK_IDS as CHECKOUT } from "../../coverage/gap-checkout.mjs";
import { CHECK_IDS as SETUP } from "../../coverage/gap-finance-os-setup.mjs";
import { CHECK_IDS as UNMATCHED } from "../../coverage/gap-payments-unmatched.mjs";
import { CHECK_IDS as SUBSCRIPTIONS } from "../../coverage/gap-subscriptions.mjs";
import { CHECK_IDS as MOVES } from "../../coverage/gap-money-moves.mjs";
import { CHECK_IDS as ADS } from "../../coverage/gap-ads-meta.mjs";
import {
  MONEY_CHECKOUT_LANES, MONEY_FUNDING_LANES, MONEY_OPERATIONS_LANES,
  fakeLaneRead, DEFAULT_ORG_SQL, SELF_TEST_ORG
} from "./money-hourly.mjs";

test("the hourly money descriptors cover every W1 and W2 check exactly once", () => {
  const expected = [...W1, ...CHECKOUT, ...SETUP, ...UNMATCHED, ...SUBSCRIPTIONS, ...MOVES, ...ADS].sort();
  const actual = [
    ...MONEY_FUNDING_LANES.checks,
    ...MONEY_CHECKOUT_LANES.checks,
    ...MONEY_OPERATIONS_LANES.checks
  ].map((check) => check.id).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, 19);
});

test("the fake reader answers the default company and leaves all other reads empty", async () => {
  const read = fakeLaneRead();
  assert.deepEqual(await read(DEFAULT_ORG_SQL), { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 });
  assert.deepEqual(await read("SELECT 1"), { rows: [], rowCount: 0 });
});
