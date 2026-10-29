// Synthetic funded-result isolation regression. No provider calls or database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findRoundForFundedEvent, onRoundFundedMoney } from "./money-chain.mjs";

const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000a2";
const CLIENT_A = "00000000-0000-4000-8000-0000000000b1";
const CLIENT_B = "00000000-0000-4000-8000-0000000000b2";
const ROUND = "00000000-0000-4000-8000-0000000000c1";
const SALE_B = "00000000-0000-4000-8000-0000000000d2";
const round = { id: ROUND, org_id: ORG_A, client_id: CLIENT_A, round_number: 1, status: "approved", product: "alt_fin" };

function fake() {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      const q = String(sql);
      calls.push({ q, params });
      if (/^SELECT id FROM clients/i.test(q.trim())) {
        return { rows: params[0] === ORG_A && params[1] === "buyer@example.invalid" ? [{ id: CLIENT_A }] : [] };
      }
      if (/SELECT \* FROM funding_rounds/i.test(q)) {
        // Model the real SQL scopes; a query missing org/client would fail the assertion.
        assert.match(q, /org_id\s*=\s*\$/i, "round ownership must be SQL-scoped");
        assert.match(q, /client_id\s*=\s*\$/i, "round buyer must be SQL-scoped");
        return { rows: params.includes(ORG_A) && params.includes(CLIENT_A) &&
          (params.includes(ROUND) || params.includes(1)) ? [round] : [] };
      }
      if (/^SELECT frs.sale_id/i.test(q.trim())) return { rows: [] };
      if (/^SELECT s.id FROM sales/i.test(q.trim())) return { rows: [] };
      throw new Error("Invalid event reached downstream write/read: " + q.slice(0,120));
    }
  };
}
const event = (orgId, clientId, payload) => ({ name:"round.funded", id:"synthetic-event", orgId, clientId, payload });

test("foreign organization cannot use a known funding round ID", async () => {
  const db = fake();
  const result = await onRoundFundedMoney(event(ORG_B, CLIENT_A, { fundingRoundId: ROUND, fundedAmount:10000 }), db);
  assert.equal(result.done,false);
  assert.equal(result.reason,"no_prior_round");
  assert.ok(db.calls.every(x=>!/^UPDATE|^INSERT/i.test(x.q.trim())));
});
test("same-organization different client cannot borrow a round", async () => {
  const db=fake();
  const result=await onRoundFundedMoney(event(ORG_A,CLIENT_B,{fundingRoundId:ROUND,fundedAmount:10000}),db);
  assert.equal(result.reason,"no_prior_round");
});
test("explicit foreign round ID never falls back to a valid round number", async () => {
  const db=fake();
  const result=await onRoundFundedMoney(event(ORG_A,CLIENT_A,{fundingRoundId:"00000000-0000-4000-8000-0000000000fe",roundNumber:1,fundedAmount:10000}),db);
  assert.equal(result.reason,"no_prior_round");
  assert.equal(db.calls.filter(x=>/FROM funding_rounds/i.test(x.q)).length,1);
});
test("unknown email does not create a phantom customer", async () => {
  const db=fake();
  const result=await onRoundFundedMoney(event(ORG_A,null,{fundingRoundId:ROUND,email:"new@example.invalid",fundedAmount:10000}),db);
  assert.equal(result.reason,"no_prior_round");
  assert.equal(db.calls.filter(x=>/FROM funding_rounds/i.test(x.q)).length,0);
});
test("fallback needs an explicit positive round number", async () => {
  const db=fake();
  const result=await onRoundFundedMoney(event(ORG_A,CLIENT_A,{fundedAmount:10000}),db);
  assert.equal(result.reason,"no_prior_round");
  assert.equal(db.calls.length,0);
});
test("valid same-org ID, round-number and existing email resolve deterministically", async () => {
  const db=fake();
  for (const payload of [{fundingRoundId:ROUND,roundNumber:1},{roundNumber:1}]) {
    const result=await findRoundForFundedEvent(db,event(ORG_A,CLIENT_A,payload));
    assert.equal(result.id,ROUND);
  }
  const email=await findRoundForFundedEvent(db,event(ORG_A,null,{fundingRoundId:ROUND,email:"buyer@example.invalid"}));
  assert.equal(email.id,ROUND);
});
test("a round from our buyer with another buyer's sale ID cannot mutate funding", async () => {
  const db=fake();
  const result=await onRoundFundedMoney(event(ORG_A,CLIENT_A,{fundingRoundId:ROUND,fundedAmount:10000,saleId:SALE_B}),db);
  assert.equal(result.reason,"sale_context_conflict");
  assert.ok(db.calls.every(x=>!/^UPDATE|^INSERT/i.test(x.q.trim())));
});
