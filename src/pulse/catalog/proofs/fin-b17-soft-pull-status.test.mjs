// Batch 17: the server half of the Present soft pull panel. The panel's three lines (consent, paid, pull
// status) are what buildCloserDeck() hands back as `soft_pull`, built from four saved rows: the newest
// consent, the newest 'diagnostic' payment link, the newest soft pull request and the newest stored credit
// result. This runs the real builder over fake rows and judges each field the panel prints.
// (The page half is fin-b17-present.test.mjs.) No database, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCloserDeck } from "../../../sales/closer-deck.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";
const CLIENT = { id: CID, first_name: "Sam", last_name: "Sample", email: "sam@example.test", phone: "5550100", outcome_tier: "REPAIR_ONLY", custom_fields: {} };

/** A fake database that answers the closer deck's reads. */
function fakeDb({ consent = null, link = null, request = null, result = null } = {}) {
  const asked = [];
  return {
    asked,
    async query(sql, params) {
      const s = String(sql);
      asked.push({ sql: s, params });
      if (/FROM clients c/i.test(s)) return { rows: [CLIENT] };
      if (/FROM client_consents/i.test(s)) return { rows: consent ? [{ granted_at: "2026-10-01T00:00:00Z", kind: "soft_pull_consent", ...consent }] : [] };
      if (/FROM payment_links/i.test(s)) return { rows: link ? [link] : [] };
      if (/FROM soft_pull_requests/i.test(s)) return { rows: request ? [request] : [] };
      if (/FROM crs_results/i.test(s)) return { rows: result ? [{ result: {}, ...result }] : [] };
      if (/FROM (businesses|tradelines|card_liabilities)/i.test(s)) return { rows: [] };
      throw new Error("unexpected sql: " + s.slice(0, 80));
    },
  };
}
const panel = async (rows) => (await buildCloserDeck(fakeDb(rows), { orgId: ORG, clientId: CID })).soft_pull;

test("nothing saved: consent waiting, not paid, no pull started, and the reads are scoped to this client", async () => {
  const db = fakeDb();
  const out = (await buildCloserDeck(db, { orgId: ORG, clientId: CID })).soft_pull;
  assert.equal(out.consent_valid, false);
  assert.equal(out.diagnostic_paid, false);
  assert.equal(out.diagnostic_link_status, null);
  assert.equal(out.diagnostic_amount_cents, null);
  assert.equal(out.pull_status, null);
  assert.equal(out.pull_status_source, null);
  assert.equal(out.outcome_tier, null);
  const reads = db.asked.filter((q) => /FROM (payment_links|soft_pull_requests|crs_results|client_consents)/i.test(q.sql));
  for (const table of ["payment_links", "soft_pull_requests", "crs_results", "client_consents"]) {
    assert.ok(reads.some((q) => new RegExp(`FROM ${table}`, "i").test(q.sql)), `${table} is read`);
  }
  for (const q of reads) assert.deepEqual([...q.params.slice(0, 2)].sort(), [ORG, CID].sort(), q.sql.slice(0, 60));
  assert.match(reads.find((q) => /payment_links/.test(q.sql)).sql, /purpose = 'diagnostic'/);
});

test("consent says on file only when the newest consent row is valid", async () => {
  assert.equal((await panel({ consent: { is_valid: true } })).consent_valid, true);
  assert.equal((await panel({ consent: { is_valid: false, revoked_at: "2026-10-02T00:00:00Z" } })).consent_valid, false);
});

test("paid says yes for a link marked paid, and for one with a paid time; an unpaid link says its status and amount", async () => {
  const link = (over) => ({ id: "l1", amount_cents: 3200, status: "sent", paid_at: null, created_at: "2026-10-01T00:00:00Z", checkout_url: "https://pay.example.test/c/1", ...over });
  const byStatus = await panel({ link: link({ status: "paid" }) });
  assert.equal(byStatus.diagnostic_paid, true);
  assert.equal(byStatus.diagnostic_link_status, "paid");
  assert.equal(byStatus.diagnostic_amount_cents, 3200);
  const byTime = await panel({ link: link({ status: "sent", paid_at: "2026-10-02T00:00:00Z" }) });
  assert.equal(byTime.diagnostic_paid, true, "a paid time is a payment, whatever the status word says");
  const unpaid = await panel({ link: link({ status: "sent", amount_cents: 100 }) });
  assert.equal(unpaid.diagnostic_paid, false);
  assert.equal(unpaid.diagnostic_link_status, "sent");
  assert.equal(unpaid.diagnostic_amount_cents, 100);
  assert.equal(unpaid.diagnostic_checkout_url, "https://pay.example.test/c/1");
  // a link row that carries no amount comes back as 0, which the panel prints as $0.00 (the live check guards that)
  assert.equal((await panel({ link: link({ amount_cents: null }) })).diagnostic_amount_cents, 0);
});

test("pull status: a pending request says pending; a stored result makes it complete; a finished request keeps its own word", async () => {
  const request = (status) => ({ id: "r1", status, requested_at: "2026-10-01T00:00:00Z", resolved_at: null, crs_result_id: null });
  const result = { id: "crs-1", outcome_tier: "FULL_FUNDING", created_at: "2026-10-03T00:00:00Z" };

  const pending = await panel({ request: request("pending") });
  assert.equal(pending.pull_status, "pending");
  assert.equal(pending.pull_status_source, "soft_pull_request");
  assert.equal(pending.outcome_tier, null);

  const stored = await panel({ request: request("pending"), result });
  assert.equal(stored.pull_status, "complete", "a stored credit result is a finished pull whatever the request row says");
  assert.equal(stored.pull_status_source, "crs_result");
  assert.equal(stored.outcome_tier, "FULL_FUNDING");
  assert.equal(stored.crs_result_id, "crs-1");

  const settled = await panel({ request: request("completed"), result });
  assert.equal(settled.pull_status, "completed", "a request that says it finished keeps its own word");
  assert.equal(settled.pull_status_source, "soft_pull_request");
  assert.equal(settled.outcome_tier, "FULL_FUNDING", "the tier still comes from the stored result");

  const noRequest = await panel({ result });
  assert.equal(noRequest.pull_status, "complete");
  assert.equal(noRequest.pull_status_source, "crs_result");

  const linked = await panel({ request: { ...request("pending"), crs_result_id: "crs-9" } });
  assert.equal(linked.crs_result_id, "crs-9", "no stored result: the request's own link is kept");
});
