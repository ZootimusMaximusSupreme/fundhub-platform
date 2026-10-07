// proposeTransfer (src/finance/money-transfer-seam.mjs) — the one way FinanceOS
// asks for money to move. It writes a proposal that waits for the client's OK;
// it never moves money. In-memory db, no Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";

import { proposeTransfer, proposalRefusal, TRANSFER_DESTINATIONS, PROPOSAL_STATUS } from "./money-transfer-seam.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const AMEX = "d6ce2c94-3632-4c63-af98-802fef41ac62";

const base = (over = {}) => ({
  orgId: ORG, clientId: CLIENT, taskKey: `due:${AMEX}:2026-10-15`, kind: "due",
  title: "Pay $135.00 to Business Amex", why: "The minimum on your latest statement.", dueOn: "2026-10-15", source: "dues",
  amountCents: 13500, toKind: "card", toAccountId: AMEX, requestedByKind: "client", requestedByStaffId: null, ...over
});

function memDb({ ownAccounts = [AMEX], openRow = null } = {}) {
  const rows = [];
  const sql = [];
  return {
    rows, sql,
    async query(text, params) {
      sql.push(text);
      if (/FROM bank_accounts/.test(text)) {
        return { rows: ownAccounts.includes(params[0]) && params[1] === CLIENT && params[2] === ORG ? [{ "?column?": 1 }] : [] };
      }
      if (/INSERT INTO money_agent_tasks/.test(text)) {
        if (openRow) return { rows: [] };
        rows.push({ params, text });
        return { rows: [{ id: "m-1" }] };
      }
      if (/SELECT id, status FROM money_agent_tasks/.test(text)) return { rows: openRow ? [openRow] : [] };
      return { rows: [] };
    }
  };
}

test("a proposal is written ONCE as 'needs_approval', moves_money true, the exact amount and the card — never sent", async () => {
  const db = memDb();
  const r = await proposeTransfer(db, base());
  assert.deepEqual(r, { ok: true, created: true, proposalId: "m-1", status: PROPOSAL_STATUS });
  assert.equal(PROPOSAL_STATUS, "needs_approval");
  const ins = db.rows[0];
  assert.match(ins.text, /'agent', 'needs_approval', true/);
  assert.equal(ins.params[8], 13500);
  assert.equal(ins.params[9], "card");
  assert.equal(ins.params[10], AMEX);
  assert.ok(!db.sql.some((s) => /approved_at|from_account_id\s*=|status\s*=\s*'approved'/.test(s) && /UPDATE/.test(s)), "no approval is written");
});

test("money can only go to the client's OWN open account", async () => {
  const db = memDb({ ownAccounts: [] });
  const r = await proposeTransfer(db, base());
  assert.deepEqual(r, { ok: false, reason: "destination_not_found" });
  assert.equal(db.rows.length, 0);
});

test("a payment to Fundhub names no account; one that names an account is refused", async () => {
  const db = memDb();
  const ok = await proposeTransfer(db, base({ taskKey: "clarity:824c8cf7-3885-4570-8e72-4858aca547d5", toKind: "fundhub", toAccountId: null, amountCents: 50000 }));
  assert.equal(ok.ok, true);
  assert.equal(db.rows[0].params[10], null);
  assert.ok(!db.sql.some((s) => /FROM bank_accounts/.test(s)), "no account lookup for Fundhub");
  assert.equal(proposalRefusal(base({ toKind: "fundhub", toAccountId: AMEX })), "bad_destination");
});

test("an open proposal for the same step answers with it — no second row", async () => {
  const db = memDb({ openRow: { id: "m-open", status: "needs_approval" } });
  const r = await proposeTransfer(db, base());
  assert.deepEqual(r, { ok: true, created: false, proposalId: "m-open", status: "needs_approval" });
});

test("refusals: no amount, a fraction, zero, an unknown destination, a missing id", () => {
  assert.equal(proposalRefusal(base({ amountCents: null })), "bad_amount");
  assert.equal(proposalRefusal(base({ amountCents: 135.5 })), "bad_amount");
  assert.equal(proposalRefusal(base({ amountCents: 0 })), "bad_amount");
  assert.equal(proposalRefusal(base({ toKind: "crypto" })), "bad_destination");
  assert.equal(proposalRefusal(base({ toAccountId: "not-a-uuid" })), "bad_destination");
  assert.equal(proposalRefusal(base({ clientId: null })), "missing_ids");
  assert.equal(proposalRefusal(base()), null);
  assert.deepEqual([...TRANSFER_DESTINATIONS], ["bank_account", "card", "loan", "fundhub"]);
});
