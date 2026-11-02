// F-00 / F-07: synthetic round.started tenant and replay boundaries. No external providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureFundingRound, ensureFundingRoundSaleLink } from "./money-chain.mjs";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const CA = "00000000-0000-4000-8000-0000000000b1";
const CB = "00000000-0000-4000-8000-0000000000b2";
const CC = "00000000-0000-4000-8000-0000000000b3";
const RA = "00000000-0000-4000-8000-0000000000c1";
const RB = "00000000-0000-4000-8000-0000000000c2";
const E = "00000000-0000-4000-8000-0000000000e1";
const rounds = [
  { id: RA, org_id: A, client_id: CA, round_number: 1, status: "started", source_event_id: E },
  { id: RB, org_id: A, client_id: CB, round_number: 1, status: "started", source_event_id: null }
];
const clients = [{ id: CA, org_id: A }, { id: CB, org_id: A }, { id: CC, org_id: B }];
const evt = (orgId, clientId, payload = {}, id = undefined) =>
  ({ name: "round.started", id, orgId, clientId, payload });

function fakeDb() {
  const queries = [];
  let writes = 0;
  return {
    queries, get writes() { return writes; },
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ q, params });
      if (q.startsWith("SELECT 1 FROM clients")) {
        return { rows: clients.filter(c => c.id === params[0] && c.org_id === params[1]).map(() => ({ "?column?": 1 })) };
      }
      if (q.startsWith("SELECT id, ghl_contact_id, email")) {
        return { rows: clients.filter(c => c.id === params[0] && c.org_id === params[1])
          .map(c => ({ ...c, ghl_contact_id: "synthetic-ghl-id" })) };
      }
      if (q.startsWith("SELECT * FROM funding_rounds")) {
        return { rows: rounds.filter(r =>
          (!/WHERE id = \$1\b/.test(q) || r.id === params[0]) &&
          (!/source_event_id = \$\d+/.test(q) || params.includes(r.source_event_id)) &&
          (!/round_number = \$\d+/.test(q) || params.includes(r.round_number)) &&
          (!/org_id = \$\d+/.test(q) || params.includes(r.org_id)) &&
          (!/client_id = \$\d+/.test(q) || params.includes(r.client_id))
        ) };
      }
      if (q.startsWith("INSERT INTO funding_rounds")) {
        writes++;
        return { rows: [{ id: "new-round", org_id: params[0], client_id: params[1], round_number: params[2] }] };
      }
      throw new Error("unexpected query " + q.slice(0, 140));
    }
  };
}

test("foreign org cannot attach an explicit round.started ID", async () => {
  const db = fakeDb();
  const result = await ensureFundingRound(db, evt(B, CC, { fundingRoundId: RA }));
  assert.equal(result.round, null);
  assert.equal(db.writes, 0);
  assert.match(db.queries.find(x => /FROM funding_rounds WHERE id = \$1\b/.test(x.q)).q, /org_id = \$2 AND client_id = \$3/);
});
test("same org different client cannot borrow a round ID", async () => {
  const db = fakeDb();
  const result = await ensureFundingRound(db, evt(A, CB, { fundingRoundId: RA }));
  assert.equal(result.round, null);
  assert.equal(db.writes, 0);
});
test("unknown explicit round ID is refusal, not fallback to the same round number", async () => {
  const db = fakeDb();
  const result = await ensureFundingRound(db, evt(A, CA,
    { fundingRoundId: "00000000-0000-4000-8000-0000000000ff", roundNumber: 1 }));
  assert.equal(result.round, null);
  assert.equal(db.writes, 0);
  assert.equal(db.queries.filter(x => /FROM funding_rounds/.test(x.q)).length, 1);
});
test("event dedupe lookup cannot attach another client's round", async () => {
  const db = fakeDb();
  const result = await ensureFundingRound(db, evt(A, CB, { roundNumber: 1 }, E));
  assert.equal(result.round?.id, RB, "must take client's own round rather than matching another client's event");
  assert.equal(db.writes, 0);
});
test("valid exact owned round and number-only replay keep same row", async () => {
  const db = fakeDb();
  const exact = await ensureFundingRound(db, evt(A, CA, { fundingRoundId: RA, roundNumber: 1 }));
  const numbered = await ensureFundingRound(db, evt(A, CA, { roundNumber: 1 }));
  assert.equal(exact.round?.id, RA);
  assert.equal(numbered.round?.id, RA);
  assert.equal(db.writes, 0);
});
test("fractional, zero, negative, or nonsensical round numbers cannot write", async () => {
  for (const roundNumber of [0, -1, 1.5, "not-a-number"]) {
    const db = fakeDb();
    const result = await ensureFundingRound(db, evt(A, CA, { roundNumber }));
    assert.equal(result.round, null);
    assert.equal(result.reason, "invalid_round_number");
    assert.equal(db.writes, 0);
  }
});


test("round sale link refuses foreign buyer/org, non-funding and replays only existing owned link", async () => {
  const saleIds = { own: "own-sale", other: "buyer-b-sale", foreign: "foreign-sale", repair: "repair-sale" };
  const sales = [
    { id: saleIds.own, orgId: A, clientId: CA, category: "funding" },
    { id: saleIds.other, orgId: A, clientId: CB, category: "funding" },
    { id: saleIds.foreign, orgId: B, clientId: CC, category: "funding" },
    { id: saleIds.repair, orgId: A, clientId: CA, category: "repair" }
  ];
  let linked = null;
  const queries = [];
  const db = { query: async (sql, params) => {
    queries.push(sql);
    if (/^SELECT frs.sale_id/.test(sql)) return { rows: linked ? [{ sale_id: linked }] : [] };
    if (/^INSERT INTO funding_round_sales/.test(sql)) {
      const found = sales.find(s => s.id === params[3] && s.orgId === params[0]
        && s.clientId === params[1] && s.category === "funding");
      if (found && !linked && params[2] === RA) { linked = found.id; return { rows: [{ sale_id: linked }] }; }
      return { rows: [] };
    }
    throw Error("unexpected SQL");
  }};
  const args = { orgId: A, clientId: CA, roundId: RA };
  assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: saleIds.other }), null);
  assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: saleIds.foreign }), null);
  assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: saleIds.repair }), null);
  assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: saleIds.own }), saleIds.own);
  assert.equal(await ensureFundingRoundSaleLink(db, { ...args, explicitSaleId: saleIds.other }), saleIds.own);
  assert.equal(linked, saleIds.own);
  const insert = queries.find(sql => /^INSERT INTO funding_round_sales/.test(sql));
  assert.match(insert, /s.org_id = fr.org_id/);
  assert.match(insert, /s.client_id = fr.client_id/);
  assert.match(insert, /p.category = 'funding'/);
});
