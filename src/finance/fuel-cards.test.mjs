// Business gas cards — src/finance/fuel-cards.mjs. The pure parts on plain
// rows; the reads and the press on a fake database that records every
// statement. No Postgres, no network, no real account.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RISK_LINE, bookLogo, safeLink, statesOf, cardView, buildFuelCards,
  readFuelCards, trackFuelCard, setFuelCard
} from "./fuel-cards.mjs";
import { readHandAccount } from "./money-accounts.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CARD = "f1000000-0000-4000-8000-000000000001";
const LENDER = "87d7af03-247d-4f79-8f5c-f0e1c8adc144";
const BIZ = "e1000000-0000-4000-8000-000000000001";
const BIZ2 = "e2000000-0000-4000-8000-000000000002";
const ACCT = "a1000000-0000-4000-8000-000000000001";

const chevron = (over = {}) => ({
  id: CARD, lender_id: LENDER, name: "CHEVRON", product_name: null, logo_path: "/assets/lenders/chevron.png",
  application_url: "https://www.mycardapply.com/synindex/?ecdma-lc=12456&ecid=OTHE_25940&offertype=0",
  business_bureau_pulled: "D&B/SBFE", eligible_states: null, ...over
});

test("the risk line is word for word", () => {
  assert.equal(RISK_LINE, "Miss a payment and it hurts your business credit.");
});

describe("the bank book's own fields, nothing made up", () => {
  test("logo: only a bank-book file; anything else is the name only", () => {
    assert.equal(bookLogo("/assets/lenders/chevron.png"), "/assets/lenders/chevron.png");
    for (const bad of ["", null, "https://example.com/x.png", "/assets/other/x.png", "/assets/lenders/../x.png", "javascript:x"]) {
      assert.equal(bookLogo(bad), null, String(bad));
    }
  });
  test("apply link: https only", () => {
    assert.match(safeLink(chevron().application_url), /^https:\/\/www\.mycardapply\.com\//);
    assert.equal(safeLink("http://example.com"), null);
    assert.equal(safeLink("javascript:alert(1)"), null);
    assert.equal(safeLink(""), null);
  });
  test("states: every state, a list, or unreadable (treated as not stated)", () => {
    assert.equal(statesOf(null), null);
    assert.equal(statesOf("All States"), null);
    assert.deepEqual([...statesOf("AZ, CA,TX")], ["AZ", "CA", "TX"]);
    assert.equal(statesOf("Arizona and more"), null);
  });
  test("the card view carries the risk line and the lender's own name", () => {
    const v = cardView(chevron());
    assert.equal(v.name, "CHEVRON");
    assert.equal(v.logo, "/assets/lenders/chevron.png");
    assert.equal(v.business_bureaus, "D&B/SBFE");
    assert.equal(v.risk, RISK_LINE);
    assert.equal(cardView(chevron({ product_name: "Business Card" })).name, "CHEVRON Business Card");
  });
});

describe("buildFuelCards — the list under each business", () => {
  test("every open business gets the list; a tracked card says so for that business only", () => {
    const out = buildFuelCards({
      cards: [chevron()],
      tracked: [{ fuel_card_id: CARD, bank_account_id: ACCT, entity_id: BIZ, account_name: "CHEVRON", mask: "4242", payment_due_day: 15 }],
      businesses: [{ container_id: BIZ, state: "AZ" }, { container_id: BIZ2, state: null }],
      viewer: "client"
    });
    assert.equal(out.ok, true);
    assert.equal(out.count, 1);
    assert.equal(out.risk, RISK_LINE);
    assert.deepEqual(out.by_business[BIZ][0].tracked, { bank_account_id: ACCT, name: "CHEVRON", mask: "4242", due_day: 15 });
    assert.equal(out.by_business[BIZ2][0].tracked, null);
  });

  test("a card the bank book does not offer in the business's state is left out there; an unknown state never hides it", () => {
    const out = buildFuelCards({
      cards: [chevron({ eligible_states: "TX, OK" })],
      businesses: [{ container_id: BIZ, state: "AZ" }, { container_id: BIZ2, state: null }]
    });
    assert.deepEqual(out.by_business[BIZ], []);
    assert.equal(out.by_business[BIZ2].length, 1);
  });

  test("no list: nothing for anyone, and the count says zero", () => {
    const out = buildFuelCards({ cards: [], businesses: [{ container_id: BIZ, state: "AZ" }], viewer: "staff" });
    assert.equal(out.count, 0);
    assert.deepEqual(out.by_business[BIZ], []);
    assert.equal(out.viewer, "staff");
  });
});

/* ── the reads and writes, on a fake database ───────────────────────────── */

function fakeDb({ cards = [chevron()], tracked = [], containers = [{ container_id: BIZ }], card = chevron(),
  ent = { id: BIZ, kind: "business", archived_at: null }, already = null, lender = { id: LENDER }, fail = null } = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail && fail.test(sql)) throw new Error("boom");
      if (/FROM business_fuel_cards f\s+JOIN lenders l[\s\S]*f\.active\s+ORDER BY/.test(sql)) return { rows: cards };
      if (/FROM business_fuel_cards f[\s\S]*f\.id = \$2/.test(sql)) return { rows: card ? [card] : [] };
      if (/FROM business_fuel_card_accounts t[\s\S]*fuel_card_id = \$3/.test(sql)) return { rows: already ? [already] : [] };
      if (/FROM business_fuel_card_accounts t/.test(sql)) return { rows: tracked };
      if (/FROM entities e/.test(sql)) return { rows: containers };
      if (/FROM entities WHERE id/.test(sql)) return { rows: ent ? [ent] : [] };
      if (/INSERT INTO business_fuel_card_accounts/.test(sql)) return { rows: [] };
      if (/FROM lenders WHERE id/.test(sql)) return { rows: lender ? [lender] : [] };
      if (/INSERT INTO business_fuel_cards/.test(sql)) return { rows: [{ id: CARD, lender_id: params[1], active: params[2] }] };
      return { rows: [] };
    }
  };
  return db;
}
const inline = { withTransaction: async (db, fn) => fn(db) };
const infos = async () => new Map([[BIZ, { state: "AZ", formation_state: "WY" }]]);

describe("readFuelCards", () => {
  test("the list, the business's state from its saved info, bound to the org and the client", async () => {
    const db = fakeDb();
    const r = await readFuelCards(db, { orgId: ORG, clientId: CLIENT, viewer: "client", deps: { listBusinessInfo: infos } });
    assert.equal(r.ok, true);
    assert.equal(r.by_business[BIZ].length, 1);
    const list = db.calls.find((c) => /f\.active\s+ORDER BY/.test(c.sql));
    assert.deepEqual(list.params, [ORG]);
    const trackedRead = db.calls.find((c) => /FROM business_fuel_card_accounts t/.test(c.sql));
    assert.deepEqual(trackedRead.params, [ORG, CLIENT]);
    const ents = db.calls.find((c) => /FROM entities e/.test(c.sql));
    assert.deepEqual(ents.params, [ORG, CLIENT]);
  });
  test("an empty list reads nothing else", async () => {
    const db = fakeDb({ cards: [] });
    const r = await readFuelCards(db, { orgId: ORG, clientId: CLIENT, deps: { listBusinessInfo: infos } });
    assert.equal(r.count, 0);
    assert.equal(db.calls.length, 1);
  });
  test("a failed read is ok:false, never a throw", async () => {
    const r = await readFuelCards(fakeDb({ fail: /FROM entities e/ }), { orgId: ORG, clientId: CLIENT, deps: { listBusinessInfo: infos } });
    assert.deepEqual(r, { ok: false, reason: "read_failed" });
  });
});

describe("trackFuelCard — one press adds it to the business like any other card", () => {
  test("a hand-entered credit card named for the list card, in that business, with its due day; then the link", async () => {
    const db = fakeDb();
    const added = [];
    const addHandAccount = async (_tx, args) => { added.push(args); return { ok: true, account_id: ACCT }; };
    const r = await trackFuelCard(db, {
      orgId: ORG, clientId: CLIENT, fuelCardId: CARD, containerId: BIZ,
      input: { due_day: "15", limit: "1,500", last4: "4242", name: "something else", type: "loan" },
      by: { kind: "client", id: "acc-1" }, deps: { ...inline, addHandAccount }
    });
    assert.deepEqual(r, { ok: true, account_id: ACCT });
    assert.equal(added.length, 1);
    const input = added[0].input;
    assert.equal(input.name, "CHEVRON", "the list card's own name, never the browser's");
    assert.equal(input.type, "credit_card", "always a card");
    assert.equal(input.dueDay, 15);
    assert.equal(input.limit, 150000);
    assert.equal(input.mask, "4242");
    assert.equal(input.containerId, BIZ);
    assert.equal(added[0].clientId, CLIENT);
    const link = db.calls.find((c) => /INSERT INTO business_fuel_card_accounts/.test(c.sql));
    assert.deepEqual(link.params, [ORG, CLIENT, CARD, ACCT, BIZ]);
  });

  test("no due day: refused before anything is written (nothing to alert on)", async () => {
    const db = fakeDb();
    let added = 0;
    await assert.rejects(() => trackFuelCard(db, { orgId: ORG, clientId: CLIENT, fuelCardId: CARD, containerId: BIZ,
      input: {}, deps: { ...inline, addHandAccount: async () => { added += 1; return { ok: true, account_id: ACCT }; } } }), /due day is required/);
    assert.equal(added, 0);
    assert.equal(db.calls.some((c) => /INSERT/.test(c.sql)), false);
  });

  test("not on the list, not this client's business, not a business, archived, or already tracked: refused", async () => {
    const base = { orgId: ORG, clientId: CLIENT, fuelCardId: CARD, containerId: BIZ, input: { due_day: 5 }, deps: inline };
    assert.deepEqual(await trackFuelCard(fakeDb({ card: null }), base), { ok: false, reason: "fuel_card_not_found" });
    assert.deepEqual(await trackFuelCard(fakeDb({ ent: null }), base), { ok: false, reason: "container_not_found" });
    assert.deepEqual(await trackFuelCard(fakeDb({ ent: { id: BIZ, kind: "personal", archived_at: null } }), base), { ok: false, reason: "not_a_business_container" });
    assert.deepEqual(await trackFuelCard(fakeDb({ ent: { id: BIZ, kind: "business", archived_at: new Date() } }), base), { ok: false, reason: "container_archived" });
    assert.deepEqual(await trackFuelCard(fakeDb({ already: { id: "x" } }), base), { ok: false, reason: "already_tracked" });
    assert.deepEqual(await trackFuelCard(fakeDb(), { ...base, fuelCardId: "nope" }), { ok: false, reason: "fuel_card_not_found" });
  });

  test("every client statement is bound to the org and the client", async () => {
    const db = fakeDb();
    await trackFuelCard(db, { orgId: ORG, clientId: CLIENT, fuelCardId: CARD, containerId: BIZ, input: { due_day: 5 },
      deps: { ...inline, addHandAccount: async () => ({ ok: true, account_id: ACCT }) } });
    const ent = db.calls.find((c) => /FROM entities WHERE id/.test(c.sql));
    assert.deepEqual(ent.params, [BIZ, ORG, CLIENT]);
    const dup = db.calls.find((c) => /fuel_card_id = \$3/.test(c.sql));
    assert.deepEqual(dup.params, [ORG, CLIENT, CARD, BIZ]);
  });

  test("the real hand-account reader still guards the fields (a full account number is refused)", async () => {
    await assert.rejects(() => trackFuelCard(fakeDb(), { orgId: ORG, clientId: CLIENT, fuelCardId: CARD, containerId: BIZ,
      input: { due_day: 5, last4: "4111111111111111" }, deps: { ...inline, readHandAccount } }), /last 4 only/);
  });
});

describe("setFuelCard — staff put a bank-book row on the list or take it off", () => {
  test("only a row of this org's bank book", async () => {
    assert.deepEqual(await setFuelCard(fakeDb({ lender: null }), { orgId: ORG, lenderId: LENDER }), { ok: false, reason: "lender_not_found" });
    assert.deepEqual(await setFuelCard(fakeDb(), { orgId: ORG, lenderId: "nope" }), { ok: false, reason: "lender_not_found" });
  });
  test("on or off, never deleted", async () => {
    const db = fakeDb();
    const r = await setFuelCard(db, { orgId: ORG, lenderId: LENDER, active: false, staffId: "5aff0000-0000-4000-8000-000000000001" });
    assert.equal(r.ok, true);
    const up = db.calls.find((c) => /INSERT INTO business_fuel_cards/.test(c.sql));
    assert.equal(up.params[0], ORG);
    assert.equal(up.params[2], false);
    assert.equal(db.calls.some((c) => /DELETE/i.test(c.sql)), false);
  });
});
