// The daily Whop read (src/finance/whop-plans-sync.mjs): the match is checkout metadata, else
// exactly one email; nothing else is saved; the email is never written. Fakes only: no Whop
// call and no database leave this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncWhopMemberships } from "./whop-plans-sync.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const CLIENT_B = "44444444-4444-4444-8444-444444444444";
const ROW_ID = "55555555-5555-4555-8555-555555555555";
const ACCOUNT = "biz_FundhubTest1";

const membership = (over = {}) => ({
  id: "mem_Alpha1", status: "active", member_id: "mber_Alpha1", user_id: "user_Alpha1",
  product_id: "prod_Pkg1", product: { id: "prod_Pkg1", title: "Consulting Services Package", logo_url: null },
  variant_id: "plan_Monthly1", renewal_price: { amount: "500.00", currency: "usd", decimals: 2, display_decimals: 2 },
  initial_price: { amount: "500.00", currency: "usd", decimals: 2, display_decimals: 2 },
  billing_period_days: 30, split_pay_required_payments: null, split_pay_current_payments: null,
  collection_method: "charge_automatically", cancel_at_period_end: false,
  current_period_start: "2026-10-22T07:00:00Z", current_period_end: "2026-11-21T07:00:00Z",
  canceled_at: null, expires_at: null, metadata: {}, account: { id: ACCOUNT, title: "Fundhub" },
  created_at: "2026-09-22T07:00:00Z", updated_at: "2026-10-22T07:00:00Z", phone_number: "+15555550100", ...over
});

/* A small database that answers the sync's statements and records every write. */
function fakeDb({ clients = [], saved = [], orgSlug = { fundhub: ORG } } = {}) {
  const writes = [];
  const queries = [];
  const store = saved.map((s) => ({ ...s }));
  return {
    writes, queries, store,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM whop_memberships WHERE whop_account_id = \$1/.test(sql)) {
        return { rows: store.filter((s) => s.whop_account_id === params[0]) };
      }
      if (/FROM orgs WHERE slug = \$1/.test(sql)) return { rows: orgSlug[params[0]] ? [{ id: orgSlug[params[0]] }] : [] };
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        return { rows: clients.filter((c) => c.id === params[0] && c.org_id === params[1]).map((c) => ({ id: c.id })) };
      }
      if (/FROM clients\s+WHERE org_id = \$1 AND lower\(btrim\(email\)\) = lower\(btrim\(\$2\)\)/.test(sql)) {
        const want = String(params[1]).trim().toLowerCase();
        return { rows: clients.filter((c) => c.org_id === params[0] && !c.is_demo && String(c.email).trim().toLowerCase() === want).slice(0, 2).map((c) => ({ id: c.id })) };
      }
      if (/^INSERT INTO whop_memberships/.test(sql)) {
        writes.push({ kind: "save", params });
        return { rows: [{ id: ROW_ID }] };
      }
      if (/^UPDATE whop_memberships SET unlinked_at/.test(sql)) {
        const hit = store.filter((s) => s.org_id === params[0] && s.whop_membership_id === params[1] && !s.unlinked_at);
        for (const h of hit) h.unlinked_at = params[2];
        writes.push({ kind: "unlink", params });
        return { rows: hit.map(() => ({ id: ROW_ID })) };
      }
      throw new Error(`fakeDb: unexpected SQL ${sql.slice(0, 80)}`);
    }
  };
}

function fakeWhop({ listed = [], byId = {}, emails = {}, listError = null } = {}) {
  const calls = { list: 0, get: [], email: [] };
  return {
    calls,
    async listMemberships(args) { calls.list += 1; calls.listArgs = args; if (listError) throw listError; return { rows: listed, complete: true }; },
    async getMembership(id) { calls.get.push(id); const r = byId[id]; if (r instanceof Error) throw r; if (!r) throw Object.assign(new Error("404"), { code: "whop_not_found" }); return r; },
    async getMemberEmail(id) { calls.email.push(id); const r = emails[id]; if (r instanceof Error) throw r; return { id, email: r ?? null }; }
  };
}

const ENV = { WHOP_API_KEY: "test-key", WHOP_ACCOUNT_ID: ACCOUNT };
const NOW = new Date("2026-11-07T07:00:00Z");
const saveParams = (w) => ({ orgId: w.params[0], clientId: w.params[1], membership: w.params[2], status: w.params[7], matchedBy: w.params[19] });

test("not configured: no Whop call, no database write", async () => {
  const db = fakeDb();
  const read = fakeWhop();
  const out = await syncWhopMemberships(db, { env: {}, now: NOW, read });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, "whop_not_configured");
  assert.equal(read.calls.list, 0);
  assert.equal(db.queries.length, 0);
});

test("the open list could not be read: the sync throws, so the job's receipt says error", async () => {
  const db = fakeDb();
  const read = fakeWhop({ listError: Object.assign(new Error("Whop did not accept the API key (401)"), { code: "whop_unauthorized" }) });
  await assert.rejects(syncWhopMemberships(db, { env: ENV, now: NOW, read }), { code: "whop_unauthorized" });
  assert.equal(db.writes.length, 0);
});

test("a Fundhub checkout's metadata ties the plan to that client, with no email read", async () => {
  const db = fakeDb({ clients: [{ id: CLIENT, org_id: OTHER_ORG, email: "x@example.com" }] });
  const read = fakeWhop({ listed: [membership({ metadata: { fh_org_id: OTHER_ORG, fh_client_id: CLIENT } })] });
  const out = await syncWhopMemberships(db, { env: ENV, now: NOW, read });
  assert.deepEqual(read.calls.listArgs.statuses, ["trialing", "active", "past_due"]);
  assert.equal(read.calls.listArgs.accountId, ACCOUNT);
  assert.deepEqual(read.calls.email, []);
  assert.equal(out.matched.fundhub_checkout, 1);
  assert.deepEqual(db.writes.map((w) => w.kind === "save" && saveParams(w)),
    [{ orgId: OTHER_ORG, clientId: CLIENT, membership: "mem_Alpha1", status: "active", matchedBy: "fundhub_checkout" }]);
});

test("exactly one real client with that email in the default org: tied; the email is never written", async () => {
  const db = fakeDb({ clients: [
    { id: CLIENT, org_id: ORG, email: " Client@Example.com " },
    { id: CLIENT_B, org_id: OTHER_ORG, email: "client@example.com" }
  ] });
  const read = fakeWhop({ listed: [membership()], emails: { mber_Alpha1: "client@example.com" } });
  const out = await syncWhopMemberships(db, { env: ENV, now: NOW, read });
  assert.equal(out.matched.email, 1);
  assert.deepEqual(saveParams(db.writes[0]), { orgId: ORG, clientId: CLIENT, membership: "mem_Alpha1", status: "active", matchedBy: "email" });
  for (const w of db.writes) assert.doesNotMatch(JSON.stringify(w.params), /example\.com/);
  assert.equal(db.writes[0].params[8], 50000);
  assert.equal(db.writes[0].params[16], "2026-11-21");
});

test("no client, two clients, or no email: nothing is saved", async () => {
  for (const [clients, email, reason] of [
    [[], "nobody@example.com", "no_client"],
    [[{ id: CLIENT, org_id: ORG, email: "twin@example.com" }, { id: CLIENT_B, org_id: ORG, email: "twin@example.com" }], "twin@example.com", "two_clients"],
    [[{ id: CLIENT, org_id: ORG, email: "client@example.com" }], null, "no_email"],
    [[{ id: CLIENT, org_id: ORG, email: "demo@example.com", is_demo: true }], "demo@example.com", "no_client"]
  ]) {
    const db = fakeDb({ clients });
    const out = await syncWhopMemberships(db, { env: ENV, now: NOW, read: fakeWhop({ listed: [membership()], emails: { mber_Alpha1: email } }) });
    assert.equal(db.writes.length, 0, reason);
    assert.equal(out.unmatched[reason], 1, reason);
  }
});

test("a sure no-match drops the old link; an unsure one keeps the client and refreshes the facts", async () => {
  const before = [{ org_id: ORG, client_id: CLIENT, whop_membership_id: "mem_Alpha1", matched_by: "email", status: "active", unlinked_at: null, whop_account_id: ACCOUNT }];
  const sure = fakeDb({ clients: [], saved: before });
  await syncWhopMemberships(sure, { env: ENV, now: NOW, read: fakeWhop({ listed: [membership()], emails: { mber_Alpha1: "gone@example.com" } }) });
  assert.deepEqual(sure.writes.map((w) => w.kind), ["unlink"]);

  const unsure = fakeDb({ clients: [], saved: before });
  const read = fakeWhop({ listed: [membership({ status: "past_due" })], emails: { mber_Alpha1: Object.assign(new Error("x"), { code: "whop_read_failed" }) } });
  const out = await syncWhopMemberships(unsure, { env: ENV, now: NOW, read });
  assert.equal(out.unmatched.email_read_failed, 1);
  assert.deepEqual(unsure.writes.map((w) => w.kind), ["save"]);
  assert.deepEqual(saveParams(unsure.writes[0]), { orgId: ORG, clientId: CLIENT, membership: "mem_Alpha1", status: "past_due", matchedBy: "email" });
});

test("a saved plan Whop no longer lists as open is read once, so it stops showing", async () => {
  const saved = [
    { org_id: ORG, client_id: CLIENT, whop_membership_id: "mem_Ended1", matched_by: "fundhub_checkout", status: "active", unlinked_at: null, whop_account_id: ACCOUNT },
    { org_id: ORG, client_id: CLIENT, whop_membership_id: "mem_Gone1", matched_by: "email", status: "active", unlinked_at: null, whop_account_id: ACCOUNT },
    { org_id: ORG, client_id: CLIENT, whop_membership_id: "mem_Old1", matched_by: "email", status: "canceled", unlinked_at: null, whop_account_id: ACCOUNT }
  ];
  const db = fakeDb({ clients: [{ id: CLIENT, org_id: ORG, email: "c@example.com" }], saved });
  const read = fakeWhop({
    listed: [],
    byId: { mem_Ended1: membership({ id: "mem_Ended1", status: "canceled", metadata: { fh_org_id: ORG, fh_client_id: CLIENT } }) }
  });
  const out = await syncWhopMemberships(db, { env: ENV, now: NOW, read });
  assert.deepEqual(read.calls.get, ["mem_Ended1", "mem_Gone1"]);
  assert.equal(out.refreshed, 1);
  assert.equal(out.unlinked, 1);
  const kinds = db.writes.map((w) => (w.kind === "save" ? `save ${w.params[2]} ${w.params[7]}` : `unlink ${w.params[1]}`));
  assert.deepEqual(kinds.sort(), ["save mem_Ended1 canceled", "unlink mem_Gone1"]);
});

test("a membership on another Whop account, or in a shape this code does not know, is skipped", async () => {
  const db = fakeDb({ clients: [{ id: CLIENT, org_id: ORG, email: "c@example.com" }] });
  const read = fakeWhop({ listed: [
    membership({ id: "mem_Other1", account: { id: "biz_SomeoneElse" }, metadata: { fh_org_id: ORG, fh_client_id: CLIENT } }),
    membership({ id: "mem_Odd1", status: "paused" })
  ] });
  const out = await syncWhopMemberships(db, { env: ENV, now: NOW, read });
  assert.equal(out.unmatched.other_account, 1);
  assert.equal(out.unmatched.unknown_shape, 1);
  assert.equal(db.writes.length, 0);
});
