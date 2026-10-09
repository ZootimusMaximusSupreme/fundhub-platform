/* Stub-db tests for src/repair/read-repair-signals.mjs.
 * Assert §9 fields gather and that money columns are never selected.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  gatherRepairSignals,
  gatherRepairDetailSignals,
  DISPUTE_AUTH_KIND
} from "./read-repair-signals.mjs";
import { deriveChip } from "./lens.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fakeDb(handlers = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      for (const [re, rows] of Object.entries(handlers)) {
        if (new RegExp(re, "i").test(text)) {
          if (typeof rows === "function") return rows(text, params);
          return { rows: rows || [] };
        }
      }
      return { rows: [] };
    }
  };
}

describe("gatherRepairSignals", () => {
  test("selects program/rounds_cap/status and never money columns", async () => {
    const db = fakeDb({
      "FROM repair_programs": [{
        client_id: CLIENT,
        program: "trial",
        rounds_cap: 2,
        status: "upsell_pending"
      }],
      "FROM client_consents": [{ client_id: CLIENT, is_valid: true }],
      "FROM pii_identity": [{ client_id: CLIENT, address_ok: true }],
      "FROM dispute_cases": [{ client_id: CLIENT, response_due_at: "2026-08-24T00:00:00Z" }],
      "FROM dispute_responses": [{ client_id: CLIENT, n: 0 }]
    });
    const map = await gatherRepairSignals(db, {
      orgId: ORG,
      clientIds: [CLIENT],
      files: [{ client_id: CLIENT, stage_key: "ready_to_send", entered_at: "2026-08-21T00:00:00Z" }]
    });
    const s = map.get(CLIENT);
    assert.equal(s.program, "trial");
    assert.equal(s.rounds_cap, 2);
    assert.equal(s.upsell_pending, true);
    assert.equal(s.authorization_ok, true);
    assert.equal(s.address_ok, true);
    assert.ok(s.response_due_at);

    const programSql = db.seen.find((c) => /FROM repair_programs/i.test(c.sql)).sql;
    assert.ok(!/price_total/i.test(programSql), "must not select price_total");
    assert.ok(!/amount_paid/i.test(programSql), "must not select amount_paid");
    assert.match(programSql, /\bprogram\b/);
    assert.match(programSql, /\brounds_cap\b/);
    assert.match(programSql, /\bstatus\b/);
  });

  test("authorization uses dispute_authorization kind", async () => {
    const db = fakeDb();
    await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] });
    const auth = db.seen.find((c) => /FROM client_consents/i.test(c.sql));
    assert.ok(auth);
    assert.equal(auth.params[2], DISPUTE_AUTH_KIND);
    assert.match(auth.sql, /revoked_at IS NULL/);
  });

  test("missing consent row is authorization_ok false", async () => {
    const db = fakeDb({ "FROM client_consents": [] });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, false);
  });

  /* CHANGED 2026-10-09 (ZU-P). This test used to be "enrolled repair program is
     authorization_ok without consent" and it asserted the shortcut that is now
     gone. An enrolled program is not a signature. The letter writer refuses a
     paid client who has signed nothing, so the desk has to say so too. */
  test("an enrolled repair program with nothing signed is NOT authorized", async () => {
    const db = fakeDb({
      "FROM client_consents": [],
      "FROM repair_programs": [{
        client_id: CLIENT,
        program: "full",
        rounds_cap: 6,
        status: "active"
      }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, false);
    assert.equal(s.program, "full", "the program is still shown; only the authorization changed");
    assert.equal(deriveChip({ ...s, stage_key: "analysis" }).key, "needs_agreement");
  });

  test("an enrolled program PLUS a live dispute authorization is authorized (twin)", async () => {
    const db = fakeDb({
      "FROM client_consents": [{ client_id: CLIENT, is_valid: true }],
      "FROM repair_programs": [{
        client_id: CLIENT,
        program: "full",
        rounds_cap: 6,
        status: "active"
      }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, true);
    assert.notEqual(deriveChip({ ...s, stage_key: "analysis" }).key, "needs_agreement");
  });

  test("an enrolled program PLUS a signed repair agreement is authorized (twin)", async () => {
    const db = fakeDb({
      "FROM client_consents": [],
      "FROM contracts": [{ client_id: CLIENT }],
      "FROM repair_programs": [{
        client_id: CLIENT,
        program: "full",
        rounds_cap: 6,
        status: "active"
      }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, true);
  });

  test("a revoked consent does not authorize an enrolled program", async () => {
    const db = fakeDb({
      "FROM client_consents": [{ client_id: CLIENT, is_valid: false }],
      "FROM repair_programs": [{
        client_id: CLIENT,
        program: "full",
        rounds_cap: 6,
        status: "active"
      }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, false);
  });

  test("cancelled program alone is not agreement", async () => {
    const db = fakeDb({
      "FROM client_consents": [],
      "FROM repair_programs": [{
        client_id: CLIENT,
        program: "trial",
        rounds_cap: 2,
        status: "cancelled"
      }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, false);
  });

  test("signed repair contract is authorization_ok without consent", async () => {
    const db = fakeDb({
      "FROM client_consents": [],
      "FROM contracts": [{ client_id: CLIENT }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.authorization_ok, true);
  });

  test("company street is address_ok when pii has none", async () => {
    const db = fakeDb({
      "FROM pii_identity": [],
      "FROM businesses": [{ client_id: CLIENT }]
    });
    const s = (await gatherRepairSignals(db, { orgId: ORG, clientIds: [CLIENT] })).get(CLIENT);
    assert.equal(s.address_ok, true);
    const biz = db.seen.find((c) => /FROM businesses/i.test(c.sql));
    assert.ok(biz);
    assert.match(biz.sql, /address_line1/);
  });

  test("unconfirmed parse flag and SLA breach", async () => {
    const db = fakeDb({
      "FROM dispute_responses": [{ client_id: CLIENT, n: 2 }],
      "FROM dispute_cases": []
    });
    const s = (await gatherRepairSignals(db, {
      orgId: ORG,
      clientIds: [CLIENT],
      files: [{
        client_id: CLIENT,
        stage_key: "awaiting_response",
        entered_at: "2026-07-01T00:00:00Z",
        response_due_at: "2026-07-10T00:00:00Z"
      }]
    })).get(CLIENT);
    assert.equal(s.has_unconfirmed_parse, true);
    assert.equal(s.sla_breached, true);
  });
});

describe("gatherRepairDetailSignals", () => {
  test("returns timeline words and signer fields", async () => {
    const db = fakeDb({
      "FROM repair_decision_log": [{
        ts: "2026-08-21T10:00:00Z",
        action: "letters_generated",
        payload: {}
      }],
      "FROM contracts": [{
        signer_name: "Pat Lee",
        signed_at: "2026-08-19T12:00:00Z"
      }]
    });
    const d = await gatherRepairDetailSignals(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(d.signer_name, "Pat Lee");
    assert.ok(d.signed_at);
    assert.equal(d.timeline.length, 1);
    assert.match(d.timeline[0].words, /letters generated/i);
  });
});
