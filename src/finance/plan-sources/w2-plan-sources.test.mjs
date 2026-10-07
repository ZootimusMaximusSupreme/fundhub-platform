// The two W2 plan sources against the board contract
// (ops/workflows/finance-os-wave5-2026-10-06.md, "Shared contract — plan pins").
// A fake db answers by query; no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as bank from "./bank-strategy.mjs";
import * as rounds from "./funding-rounds.mjs";
import { allPins } from "./index.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const NOW = new Date("2026-10-06T12:00:00Z");
const PIN_KEYS = ["amount_cents", "bank", "container_id", "date", "detail", "id", "kind", "source", "status", "title"];
const KINDS = new Set(["open_account", "deposit", "pay_down", "apply", "due", "checkpoint", "other"]);
const STATUSES = new Set(["planned", "done", "missed"]);

function fakeDb({ client = { custom_fields: {} }, rels = [], deposits = [], book = [], crs = [], fundingRounds = [] } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM clients/.test(sql)) return { rows: client ? [client] : [] };
      if (/FROM blueprint_bank_relationship_todos/.test(sql)) return { rows: rels };
      if (/FROM bank_relationship_deposits/.test(sql)) return { rows: deposits };
      if (/FROM entities/.test(sql)) return { rows: [{ id: "c1", kind: "business", name: "Fundhub LLC" }] };
      if (/FROM lenders/.test(sql)) return { rows: book };
      if (/FROM crs_results/.test(sql)) return { rows: crs };
      if (/FROM funding_rounds/.test(sql)) return { rows: fundingRounds };
      return { rows: [] };
    }
  };
}

const CHASE_BOOK = {
  id: "l-chase", name: "Chase", lender_table: "InBranchBizCC", minimum_deposit: "10000.00",
  requires_account_opening: "yes", stated_requirements: "Business checking account is required. 30+ days of liquidity seasoning strongly improves odds.",
  external_row_id: "LEGACY-INBRANCHBIZCC-CHASE"
};

function assertContract(pins, source) {
  for (const p of pins) {
    assert.deepEqual(Object.keys(p).sort(), PIN_KEYS, p.id);
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(KINDS.has(p.kind), p.kind);
    assert.ok(STATUSES.has(p.status), p.status);
    assert.equal(p.source, source);
    assert.ok(p.amount_cents === null || Number.isInteger(p.amount_cents), "amount is integer cents or null");
  }
}

describe("plan source: bank-strategy", () => {
  test("is named for the registry", () => {
    assert.equal(bank.name, "bank-strategy");
    assert.equal(typeof bank.pins, "function");
  });

  test("a planned bank pins its open day with the book's deposit; ids are stable across calls", async () => {
    const db = fakeDb({
      rels: [{ id: "r1", bank_key: "chase", bank_name: "Chase", account_kind: "business", state: "open", entity_id: "c1",
        planned_open_on: "2026-10-20", planned_deposit_cents: null, opened_on: null, lender_id: null }],
      book: [CHASE_BOOK]
    });
    const pins = await bank.pins(db, { orgId: ORG, clientId: CLIENT, from: "2026-10-01", to: "2026-10-31", now: NOW });
    assertContract(pins, "bank-strategy");
    assert.deepEqual(pins.map((p) => [p.id, p.date, p.title, p.amount_cents, p.status]), [
      ["bank-strategy:plan:r1", "2026-10-20", "Open business checking at Chase and deposit $10,000", 1000000, "planned"]
    ]);
    const again = await bank.pins(db, { orgId: ORG, clientId: CLIENT, from: "2026-10-01", to: "2026-10-31", now: NOW });
    assert.deepEqual(again, pins);
    assert.ok(db.seen.filter((q) => !/FROM clients/.test(q.sql)).every((q) => q.params.includes(ORG)), "every read is pinned to the org");
  });

  test("the next-round date sets the last open day from the bank's own seasoning", async () => {
    const db = fakeDb({
      client: { custom_fields: { blueprint_next_sequence_ready_date: "2026-12-01" } },
      rels: [{ id: "r1", bank_key: "chase", bank_name: "Chase", account_kind: "business", state: "open",
        planned_open_on: null, planned_deposit_cents: "500000", opened_on: null }],
      book: [CHASE_BOOK]
    });
    const [p] = await bank.pins(db, { orgId: ORG, clientId: CLIENT, now: NOW });
    assert.equal(p.date, "2026-11-01");
    assert.equal(p.amount_cents, 500000, "staff's own planned deposit wins over the book");
  });

  test("no plan, no date, no rule: no pins; an unknown client: no pins", async () => {
    const db = fakeDb({ rels: [{ id: "r1", bank_key: "some bank", account_kind: "business", state: "open" }] });
    assert.deepEqual(await bank.pins(db, { orgId: ORG, clientId: CLIENT, now: NOW }), []);
    assert.deepEqual(await bank.pins(fakeDb({ client: null }), { orgId: ORG, clientId: CLIENT, now: NOW }), []);
    assert.deepEqual(await bank.pins(fakeDb(), {}), []);
  });
});

describe("both W2 sources through W1's registry, unchanged", () => {
  test("they run, keep the window, and read 'today' from the registry's one clock", async () => {
    const db = fakeDb({
      client: { custom_fields: { blueprint_next_sequence_ready_date: "2026-10-20" } },
      rels: [{ id: "r1", bank_key: "chase", bank_name: "Chase", account_kind: "business", state: "open",
        planned_open_on: "2026-10-20", planned_deposit_cents: null, opened_on: null }],
      book: [CHASE_BOOK]
    });
    const out = await allPins(db, {
      orgId: ORG, clientId: CLIENT, from: "2026-10-01", to: "2026-10-31", today: "2026-10-21", sources: [bank, rounds]
    });
    assert.deepEqual(out.sources, [{ name: "bank-strategy", ok: true, count: 1 }, { name: "funding-rounds", ok: true, count: 1 }]);
    assert.deepEqual(out.pins.map((p) => [p.source, p.id, p.kind, p.status, p.amount_cents]), [
      ["bank-strategy", "bank-strategy:plan:r1", "open_account", "missed", 1000000],
      ["funding-rounds", `funding-rounds:next:${CLIENT}:2026-10-20`, "apply", "missed", null]
    ]);
    assert.ok(out.pins.every((p) => Array.isArray(p.can_mark) && p.can_mark.length === 0), "no mark() writer: nothing markable from the Plan tab");
  });
});

describe("plan source: funding-rounds", () => {
  test("is named for the registry", () => {
    assert.equal(rounds.name, "funding-rounds");
    assert.equal(typeof rounds.pins, "function");
  });

  test("the next round on the Next Funding Sequence date, with the estimate on file", async () => {
    const db = fakeDb({ client: { custom_fields: { blueprint_next_sequence_ready_date: "2026-12-01", total_funding_estimate: 125000 } } });
    const pins = await rounds.pins(db, { orgId: ORG, clientId: CLIENT, now: NOW });
    assertContract(pins, "funding-rounds");
    assert.deepEqual(pins.map((p) => [p.id, p.date, p.kind, p.amount_cents, p.status]), [
      [`funding-rounds:next:${CLIENT}:2026-12-01`, "2026-12-01", "apply", 12500000, "planned"]
    ]);
  });

  test("past rounds pin on the day they opened with what they funded; no date set means no next pin", async () => {
    const db = fakeDb({
      fundingRounds: [{ id: "fr1", round_number: 1, status: "funded", approved_amount: "60000.00", funded_amount: "50000.00", created_at: "2026-07-01T10:00:00Z" }]
    });
    const pins = await rounds.pins(db, { orgId: ORG, clientId: CLIENT, now: NOW });
    assert.deepEqual(pins.map((p) => [p.id, p.amount_cents, p.status]), [["funding-rounds:round:fr1", 5000000, "done"]]);
    assert.deepEqual(await rounds.pins(db, { orgId: ORG, clientId: CLIENT, from: "2026-10-01", now: NOW }), [], "range filter");
  });

  test("no estimate on file: the amount stays null, never 0", async () => {
    const db = fakeDb({ client: { custom_fields: { blueprint_next_sequence_ready_date: "2026-12-01" } } });
    const [p] = await rounds.pins(db, { orgId: ORG, clientId: CLIENT, now: NOW });
    assert.equal(p.amount_cents, null);
  });
});
