import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOOR_CONTRACTS_MONEY_CUSTOMER_KEYS,
  DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS,
  doorContractsMoneyCustomerProof,
} from "./door-contracts-money-customer.mjs";
import generated from "../generated.json" with { type: "json" };

const MAP_ROOT = new URL("../../../../ops/workflows/coverage-every-surface-2026-10-10/", import.meta.url);

async function rows(sourceFile) {
  return JSON.parse(await readFile(new URL(sourceFile, MAP_ROOT), "utf8"));
}

test("the six money and customer proofs name exact catalog rows and real-handler tests", async () => {
  assert.equal(DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS.length, 6);
  assert.equal(new Set(DOOR_CONTRACTS_MONEY_CUSTOMER_KEYS).size, 6);

  for (const entry of DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS) {
    const row = (await rows(entry.sourceFile)).find((candidate) =>
      candidate.surface === entry.surface && candidate.control === entry.control
    );
    assert.ok(row, entry.key);
    assert.equal(["money", "customerData", "customerMessage"].includes(row.impact), true, entry.key);
    assert.match(entry.handlerTest, /^src\/http\/.+-handler\.test\.mjs$|^src\/http\/partner-home-tiles\.test\.mjs$/);
    const compiled = generated.items.find((item) => item.id === entry.generatedId);
    assert.equal(compiled?.sourceFile, entry.sourceFile, entry.key);
    assert.equal(compiled?.surface, entry.surface, entry.key);

    const proof = doorContractsMoneyCustomerProof(entry.sourceFile, row);
    assert.equal(proof.depth, "deep");
    assert.equal(proof.asserts, row.control);
    assert.match(proof.evidence, new RegExp(entry.handlerTest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a same-route row with a different result stays unproved", () => {
  const entry = DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS[0];
  const changed = { surface: entry.surface, control: `${entry.control} different result` };
  assert.equal(doorContractsMoneyCustomerProof(entry.sourceFile, changed), null);
  assert.equal(doorContractsMoneyCustomerProof("routes-3.json", changed), null);
});
