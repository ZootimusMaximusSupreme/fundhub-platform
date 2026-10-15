// Batch 17: the server half of the Present soft pull panel. The panel's three lines (consent, paid, pull
// status) are what buildCloserDeck() hands back as `soft_pull`, built from four saved rows: the newest
// consent, the newest 'diagnostic' payment link, the newest soft pull request and the newest stored credit
// result. This runs the real builder over fake rows and judges each field the panel prints.
// (The page half is fin-b17-present.test.mjs.) No database, no network.
//
// Two groups. The first runs the builder over a fake database that answers by table name (fast, judges
// the shape of what the panel gets). The second (repair cycle 1) runs the builder's EXACT SQL text over
// stand-in rows (SQLite, real column names from db/migrations, fin-b17-sql-kit.mjs), so the scope and the
// order of each read are judged by what the database would return: another client's row, another company's
// row and an older row are all on the table, and the panel must paint none of them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCloserDeck } from "../../../sales/closer-deck.mjs";
import { makeStandIn, portableSql } from "./fin-b17-sql-kit.mjs";

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

// ───────────────────────────── the same builder over stand-in rows ─────────────────────────────

const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const OTHER_CLIENT = "44444444-4444-4444-8444-444444444444";
const SQL_TABLES = ["client_consents", "payment_links", "soft_pull_requests", "crs_results"];

/** A database whose four soft pull reads run their exact SQL text over the stand-in rows. */
function standInDb(rows) {
  const standIn = makeStandIn(SQL_TABLES);
  for (const [table, row] of rows) standIn.insert(table, row);
  return {
    close: () => standIn.close(),
    async query(sql, params) {
      const s = String(sql);
      if (/FROM clients c/i.test(s)) return { rows: [CLIENT] };
      if (/FROM (businesses|tradelines|card_liabilities)/i.test(s)) return { rows: [] };
      // the deck's own engine read of the newest result: no engine, so the panel is all that is judged
      if (/SELECT result, outcome_tier/i.test(s)) return { rows: [] };
      if (!/FROM (client_consents|payment_links|soft_pull_requests|crs_results)/i.test(s)) throw new Error("unexpected sql: " + s.slice(0, 80));
      return { rows: standIn.db.prepare(portableSql(s)).all(...params) };
    },
  };
}
async function sqlPanel(rows) {
  const db = standInDb(rows);
  try {
    return (await buildCloserDeck(db, { orgId: ORG, clientId: CID })).soft_pull;
  } finally {
    db.close();
  }
}
const day = (n) => `2026-10-${String(n).padStart(2, "0")}T09:00:00.000Z`;
const linkRow = (id, over = {}) => ["payment_links", {
  id, org_id: ORG, client_id: CID, purpose: "diagnostic", amount_cents: 3200, status: "sent", paid_at: null,
  created_at: day(2), checkout_url: `https://pay.example.test/c/${id}`, ...over,
}];
const requestRow = (id, over = {}) => ["soft_pull_requests", { id, org_id: ORG, client_id: CID, status: "queued", requested_at: day(2), crs_result_id: null, ...over }];
const resultRow = (id, over = {}) => ["crs_results", { id, org_id: ORG, client_id: CID, outcome_tier: "REPAIR_ONLY", created_at: day(2), ...over }];
const consentRow = (id, over = {}) => ["client_consents", { id, org_id: ORG, client_id: CID, kind: "soft_pull_consent", granted_at: day(1), ...over }];

test("sql: the newest diagnostic link of THIS client in THIS company is the one the panel paints", async () => {
  const out = await sqlPanel([
    linkRow("l-old", { created_at: day(2), status: "sent", amount_cents: 3200 }),
    linkRow("l-new", { created_at: day(5), status: "paid", paid_at: day(6), amount_cents: 4200, checkout_url: "https://pay.example.test/c/new" }),
    // each of these is newer than the one that should win, and none is this client's diagnostic link in this company
    linkRow("l-other-client", { client_id: OTHER_CLIENT, created_at: day(9), status: "created", amount_cents: 100 }),
    linkRow("l-other-org", { org_id: OTHER_ORG, created_at: day(10), status: "expired", amount_cents: 900 }),
    linkRow("l-repair", { purpose: "repair", created_at: day(11), status: "void", amount_cents: 700 }),
  ]);
  assert.equal(out.diagnostic_link_status, "paid");
  assert.equal(out.diagnostic_paid, true);
  assert.equal(out.diagnostic_amount_cents, 4200);
  assert.equal(out.diagnostic_checkout_url, "https://pay.example.test/c/new");
});

test("sql: the newest soft pull request of THIS client in THIS company is the one the panel paints", async () => {
  const out = await sqlPanel([
    requestRow("r-old", { requested_at: day(2), status: "cancelled", resolved_at: day(3) }),
    requestRow("r-new", { requested_at: day(5), status: "processing" }),
    requestRow("r-other-client", { client_id: OTHER_CLIENT, requested_at: day(9), status: "failed", resolved_at: day(9) }),
    requestRow("r-other-org", { org_id: OTHER_ORG, requested_at: day(10), status: "cancelled", resolved_at: day(10) }),
  ]);
  assert.equal(out.pull_status, "processing");
  assert.equal(out.pull_status_source, "soft_pull_request");
  assert.equal(out.pull_id, "r-new");
});

test("sql: the newest stored credit result of THIS client in THIS company gives the tier and the pull time", async () => {
  const out = await sqlPanel([
    resultRow("x-old", { created_at: day(2), outcome_tier: "REPAIR_ONLY" }),
    resultRow("x-new", { created_at: day(5), outcome_tier: "FULL_FUNDING" }),
    resultRow("x-other-client", { client_id: OTHER_CLIENT, created_at: day(9), outcome_tier: "FUNDING_PLUS_REPAIR" }),
    resultRow("x-other-org", { org_id: OTHER_ORG, created_at: day(10), outcome_tier: "FUNDING_PLUS_REPAIR" }),
  ]);
  assert.equal(out.outcome_tier, "FULL_FUNDING");
  assert.equal(out.crs_result_id, "x-new");
  assert.equal(out.last_pull_at, day(5));
  assert.equal(out.pull_status, "complete");
  assert.equal(out.pull_status_source, "crs_result");
});

test("sql: the consent line reads only THIS client's soft pull consent in THIS company, and says waiting when that is all that is missing", async () => {
  // another client's valid consent, another company's valid consent, and this client's valid consent of ANOTHER kind
  const others = [
    consentRow("k-other-client", { client_id: OTHER_CLIENT }),
    consentRow("k-other-org", { org_id: OTHER_ORG }),
    consentRow("k-other-kind", { kind: "marketing_use" }),
  ];
  assert.equal((await sqlPanel(others)).consent_valid, false);
  assert.equal((await sqlPanel([...others, consentRow("k-mine")])).consent_valid, true);
  // this client's own newest soft pull consent is the one that counts: revoked is waiting, even beside an older valid one
  const revoked = await sqlPanel([consentRow("k-1", { granted_at: day(1) }), consentRow("k-2", { granted_at: day(4), revoked_at: day(5) })]);
  assert.equal(revoked.consent_valid, true, "a valid consent is the one that counts, valid rows rank first");
  const onlyRevoked = await sqlPanel([consentRow("k-2", { granted_at: day(4), revoked_at: day(5) })]);
  assert.equal(onlyRevoked.consent_valid, false);
  assert.equal(onlyRevoked.consent_reason, "revoked");
  const expired = await sqlPanel([consentRow("k-3", { granted_at: day(1), expires_at: day(3) })]);
  assert.equal(expired.consent_valid, false);
});

test("sql: the three lines together, from one client's rows with another client's and another company's beside them", async () => {
  const out = await sqlPanel([
    consentRow("k-mine"),
    linkRow("l-mine", { status: "paid", paid_at: day(3), created_at: day(2) }),
    requestRow("r-mine", { status: "fulfilled", crs_result_id: "x-mine", requested_at: day(3), resolved_at: day(4) }),
    resultRow("x-mine", { created_at: day(4), outcome_tier: "FULL_FUNDING" }),
    linkRow("l-theirs", { client_id: OTHER_CLIENT, status: "created", created_at: day(8) }),
    requestRow("r-theirs", { client_id: OTHER_CLIENT, status: "failed", requested_at: day(8), resolved_at: day(8) }),
    resultRow("x-theirs", { client_id: OTHER_CLIENT, created_at: day(8), outcome_tier: "REPAIR_ONLY" }),
    linkRow("l-else", { org_id: OTHER_ORG, status: "void", created_at: day(9) }),
    requestRow("r-else", { org_id: OTHER_ORG, status: "cancelled", requested_at: day(9), resolved_at: day(9) }),
    resultRow("x-else", { org_id: OTHER_ORG, created_at: day(9), outcome_tier: "REPAIR_ONLY" }),
  ]);
  assert.deepEqual(
    { consent: out.consent_valid, paid: out.diagnostic_paid, link: out.diagnostic_link_status, pull: out.pull_status, source: out.pull_status_source, tier: out.outcome_tier },
    { consent: true, paid: true, link: "paid", pull: "fulfilled", source: "soft_pull_request", tier: "FULL_FUNDING" },
  );
});
