// trip:roadmap: the SQL itself, on a real Postgres. Read only. Skips unless DATABASE_URL is set.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-trip-roadmap.pg.test.mjs
//
// Same harness as gap-trip-funding.pg.test.mjs: BEGIN READ ONLY, always rolled back, every table
// shadowed by the made-up rows of the scenario with its columns pinned to the real table.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { COUNT_SQL, TRIP_SQL, judgeRoadmap, tripParams } from "./gap-trip-roadmap.mjs";
import { PACK_EMAIL_TEMPLATE, PACK_SUBTYPES } from "./gap-underwrite.mjs";
import { NUDGE_KEYS } from "./gap-soft-pull.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, emptyWorld, runWorld, uid } from "./trip-test-kit.mjs";

const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const TABLES = [
  "clients", "payment_links", "crs_results", "messages", "events", "documents", "accounts",
  "account_magic_links", "entitlements"
];

after(async () => {
  if (HAS_DB) await closeShadowDb();
});

function addBuyer(w, over = {}, link = {}) {
  const id = uid();
  w.clients.rows.push({
    id, org_id: ORG, client_code: `FH-${String(w.clients.rows.length + 1).padStart(6, "0")}`,
    email: `buyer${w.clients.rows.length}@gmail.com`, is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(90 * DAY), updated_at: ago(DAY), partner_id: null, ...over
  });
  w.payment_links.rows.push({
    org_id: ORG, client_id: id, purpose: "diagnostic", status: "paid", link_ref: "slo_abc", paid_at: ago(5 * DAY),
    updated_at: ago(5 * DAY), identity_stored_at: null, is_demo: false, ...link
  });
  return id;
}

function pack(w, c, subtypes, at, over = {}) {
  for (const subtype of subtypes) {
    w.documents.rows.push({
      org_id: ORG, client_id: c, kind: "deliverable", subtype, created_at: at, generated_at: at, byte_size: 1000,
      metadata: {}, generated_by: "slo-pack", is_demo: false, ...over
    });
  }
}

async function judge(w) {
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  const p = tripParams(ORG, NOW);
  const count = await runWorld(COUNT_SQL, w, [p[0], p[1], p[2]]);
  assert.equal(count.rows[0].n, out.rows.length, "COUNT_SQL and TRIP_SQL must find the same customers");
  return { rows: out.rows, verdict: judgeRoadmap({ rows: out.rows, now: NOW }) };
}

const FULL = [...PACK_SUBTYPES, "funding_summary", "business_duplication_map"];
const skip = HAS_DB ? false : "DATABASE_URL is not set";

function world() {
  return emptyWorld(TABLES);
}

test("SQL: nobody paid for the roadmap is a nothing-to-judge", { skip }, async () => {
  const w = world();
  w.clients.rows.push({
    id: uid(), org_id: ORG, client_code: "FH-1", email: "a@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(DAY), updated_at: ago(DAY), partner_id: null
  });
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 0);
  assert.equal(verdict.status, "na");
});

test("SQL: a link that is only sent, or is not a roadmap link, does not start the trip", { skip }, async () => {
  const w = world();
  addBuyer(w, {}, { status: "sent", paid_at: null });
  addBuyer(w, {}, { link_ref: "other_x" });
  addBuyer(w, {}, { purpose: "custom" });
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL RED: paid 3 hours ago, form empty, no reminder", { skip }, async () => {
  const w = world();
  addBuyer(w, {}, { paid_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "filled the pull form"/);
});

test("SQL GREEN: the same buyer after a reminder went out", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { paid_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) });
  w.messages.rows.push({ org_id: ORG, client_id: c, template_key: NUDGE_KEYS[0], status: "delivered", created_at: ago(HOUR) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: the reminder was only a message that failed", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { paid_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) });
  w.messages.rows.push({ org_id: ORG, client_id: c, template_key: NUDGE_KEYS[0], status: "failed", created_at: ago(HOUR) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
});

test("SQL RED: a reminder from before the payment does not count", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { paid_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) });
  w.messages.rows.push({ org_id: ORG, client_id: c, template_key: NUDGE_KEYS[0], status: "delivered", created_at: ago(2 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
});

test("SQL RED: the form was filled 4 hours ago and no pack exists", { skip }, async () => {
  const w = world();
  addBuyer(w, {}, { paid_at: ago(5 * HOUR), updated_at: ago(5 * HOUR), identity_stored_at: ago(4 * HOUR) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "pack saved whole and the pack-ready email queued"/);
});

test("SQL GREEN: a whole pack, its email queued, and the buyer signed in", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { identity_stored_at: ago(5 * DAY) });
  w.events.rows.push({
    org_id: ORG, client_id: c, name: "analysis.completed", created_at: ago(5 * DAY - 20 * MIN), is_demo: false,
    idempotency_key: "k1", payload: { source: "crs" }
  });
  pack(w, c, FULL, ago(5 * DAY - 40 * MIN));
  w.messages.rows.push({ org_id: ORG, client_id: c, template_key: PACK_EMAIL_TEMPLATE, status: "delivered", created_at: ago(5 * DAY - 41 * MIN) });
  w.accounts.rows.push({ id: uid(), org_id: ORG, kind: "client", email: "x@gmail.com", client_id: c, affiliate_id: null, last_login_at: ago(4 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 finished/);
});

test("SQL RED: a pack with one core file missing", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { identity_stored_at: ago(5 * DAY) });
  pack(w, c, ["credit_analysis_report", "funding_snapshot", "bank_lender_match_list", "funding_summary", "business_duplication_map"], ago(5 * DAY));
  w.accounts.rows.push({ id: uid(), org_id: ORG, kind: "client", email: "x@gmail.com", client_id: c, affiliate_id: null, last_login_at: ago(4 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /the saved pack is missing the Credit Optimization Roadmap/);
});

test("SQL RED: a whole pack and no pack-ready email", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { identity_stored_at: ago(5 * DAY) });
  pack(w, c, FULL, ago(5 * DAY));
  w.accounts.rows.push({ id: uid(), org_id: ORG, kind: "client", email: "x@gmail.com", client_id: c, affiliate_id: null, last_login_at: ago(4 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /no pack-ready email was queued/);
});

test("SQL RED: access held 5 days and never signed in", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { identity_stored_at: ago(5 * DAY) });
  pack(w, c, FULL, ago(5 * DAY));
  w.messages.rows.push({ org_id: ORG, client_id: c, template_key: PACK_EMAIL_TEMPLATE, status: "delivered", created_at: ago(5 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "signed in to the portal"/);
});

test("SQL GREEN: a consumed magic link counts as signed in", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { identity_stored_at: ago(5 * DAY) });
  pack(w, c, FULL, ago(5 * DAY));
  w.messages.rows.push({ org_id: ORG, client_id: c, template_key: PACK_EMAIL_TEMPLATE, status: "delivered", created_at: ago(5 * DAY) });
  w.account_magic_links.rows.push({ org_id: ORG, client_id: c, account_id: null, consumed_at: ago(4 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 finished/);
});

test("SQL: an entitlement starts the access clock too", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { identity_stored_at: ago(5 * DAY) });
  w.entitlements.rows.push({ org_id: ORG, client_id: c, granted_at: ago(4 * DAY), revoked_at: null, expires_at: null, is_demo: false });
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  assert.ok(out.rows[0].access_since);
});

test("SQL: demo clients, test addresses, other companies and old orders are left out", { skip }, async () => {
  const w = world();
  addBuyer(w, { is_demo: true });
  addBuyer(w, { email: "walk@example.com" });
  addBuyer(w, { custom_fields: { crm_archived_at: ago(DAY) } });
  addBuyer(w, {}, { paid_at: ago(61 * DAY), updated_at: ago(61 * DAY) });
  addBuyer(w, {}, { is_demo: true });
  const other = uid();
  w.clients.rows.push({
    id: other, org_id: OTHER_ORG, client_code: "OTHER", email: "o@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(90 * DAY), updated_at: ago(DAY), partner_id: null
  });
  w.payment_links.rows.push({
    org_id: OTHER_ORG, client_id: other, purpose: "diagnostic", status: "paid", link_ref: "slo_z", paid_at: ago(DAY),
    updated_at: ago(DAY), identity_stored_at: null, is_demo: false
  });
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL: the newest paid roadmap link is the trip", { skip }, async () => {
  const w = world();
  const c = addBuyer(w, {}, { paid_at: ago(20 * DAY), updated_at: ago(20 * DAY), identity_stored_at: ago(20 * DAY) });
  w.payment_links.rows.push({
    org_id: ORG, client_id: c, purpose: "diagnostic", status: "paid", link_ref: "slo_new", paid_at: ago(HOUR),
    updated_at: ago(HOUR), identity_stored_at: null, is_demo: false
  });
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].form_filled_at, null);
});
