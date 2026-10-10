// Postgres-backed tests for the bank-login repair (src/banking/plaid-relink.mjs),
// the one reconnect text (src/finance/bank-reconnect-notice.mjs) and migration 474.
//
// WHAT ONLY A REAL DATABASE CAN SAY. The unit tests prove the logic against a stand-in
// (plaid-fake-db.mjs). This file proves the SQL itself is right against the real
// tables and constraints:
//   1. plaid_items.reconnect_notified_at is a nullable timestamptz with no default.
//   2. The status read, the claim, the revert and the episode-end write do what the
//      unit tests' stand-in says they do — including the COALESCE that puts a login
//      back with the code and time it had, and the refresh upserting accounts through
//      the real bank_accounts constraints.
//   3. The text job's candidate query, its stamp guard, and the dedupe that makes a
//      retried pass land on the SAME messages row (the real unique index on
//      (org_id, provider_ref)) — with the REAL sendTemplated and the REAL template
//      text out of migration 474.
//
// PLAID IS A STAND-IN FETCH, AND NOTHING IS QUEUED FOR REAL. The only thing sendTemplated
// does is write a `messages` row at status='queued'; the dispatcher is not run.
//
// EACH DESCRIBE RUNS IN ONE TRANSACTION THAT IS ROLLED BACK, on its own connection.
// Nothing this file writes survives it, whatever database it is pointed at. The
// repair code is handed a plain { query } wrapper — no connect() — so
// withTransaction runs inline on that same connection instead of opening a second
// one. A statement that FAILS poisons its transaction, so no test here makes one fail
// on purpose.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12: a skip
// is not a pass — CI runs this against its throwaway database).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { pool, close } from "../db.mjs";
import { startRelink, finishRelink, listBankLoginStatus } from "./plaid-relink.mjs";
import { encryptPlaidToken } from "./plaid.mjs";
import { plaidAccount, stubPlaid } from "./plaid-fake-db.mjs";
import { queueReconnectNotices, planReconnectNotice, TEMPLATE_KEY } from "../finance/bank-reconnect-notice.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SKIP = HAVE_DB ? false : "no DATABASE_URL";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec", PLAID_ENV: "sandbox", ADAPTERS_DRY_RUN: "0",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64")
});
const TOKEN = "access-sandbox-pg-secret";
const ERRORED_AT = "2026-10-05T07:00:02.000Z";
const NOW = new Date("2026-10-07T07:00:00.000Z");
const ASOF = "2026-10-07T12:00:00.000Z";
const LOGIN_REQUIRED = { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in again" };

/* One connection, one transaction, and the fixtures that go in it. */
async function openWorld(label) {
  const c = await pool().connect();
  await c.query("BEGIN");
  const orgId = (await c.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Relink PgTest Org') RETURNING id`,
    [`relink-pg-test-${label}-${process.pid}-${Date.now()}`]
  )).rows[0].id;
  const conn = { query: (sql, params) => c.query(sql, params) }; // no connect(): see the header
  let seq = 0;

  const addClient = async ({ phone = null } = {}) => (await c.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone) VALUES ($1, 'Relink', $2, $3, $4) RETURNING id`,
    [orgId, `Pg${++seq}`, `relink-pg-${label}-${seq}@example.test`, phone]
  )).rows[0].id;

  const addItem = async ({
    clientId, state = "error", code = "ITEM_LOGIN_REQUIRED", errorAt = ERRORED_AT, notifiedAt = null,
    name = "First Platypus Bank", createdAt = "2026-09-20T10:00:00.000Z", consentAt = "2026-09-20T10:00:00.000Z",
    syncedAt = null, token = TOKEN, plaidItemId = `item-pg-${label}-${++seq}`
  }) => ({
    plaidItemId,
    id: (await c.query(
      `INSERT INTO plaid_items
         (org_id, client_id, plaid_item_id, institution_name, encrypted_access_token, link_state,
          consent_granted_at, last_error_code, last_error_at, reconnect_notified_at, transactions_synced_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [orgId, clientId, plaidItemId, name, encryptPlaidToken(token, { itemId: plaidItemId, env: ENV }), state,
        consentAt, state === "error" ? code : null, state === "error" ? errorAt : null, notifiedAt, syncedAt, createdAt]
    )).rows[0].id
  });

  const addAccount = async ({
    clientId, itemId, plaidAcc, name = "Checking", current = 100000, asOf = "2026-10-04T07:00:00.000Z",
    closedAt = null, kind = "unknown"
  }) => (await c.query(
    `INSERT INTO bank_accounts
       (org_id, client_id, plaid_item_id, provider, plaid_account_id, name, mask, account_type,
        current_balance_cents, available_balance_cents, balance_as_of, closed_at, entity_kind, entity_kind_source)
     VALUES ($1,$2,$3,'plaid',$4,$5,'0000','depository',$6,$6,$7,$8,$9,$10) RETURNING id`,
    [orgId, clientId, itemId, plaidAcc, name, current, asOf, closedAt, kind, kind === "unknown" ? null : "client_stated"]
  )).rows[0].id;

  const item = async (id) => (await c.query(
    `SELECT link_state, last_error_code, last_error_at, reconnect_notified_at FROM plaid_items WHERE id = $1`, [id]
  )).rows[0];

  const release = async () => {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  };
  return { c, conn, orgId, addClient, addItem, addAccount, item, release };
}

after(async () => { await close(); });

/* ── 1 + 2: the repair, against the real tables ───────────────────────────────── */

describe("bank-login repair on real tables (migration 474)", { skip: SKIP }, () => {
  let w;
  before(async () => { w = await openWorld("repair"); });
  after(async () => { if (w) await w.release(); });

  test("reconnect_notified_at is a nullable timestamptz with no default — NULL means 'not texted' for every row that already exists", async () => {
    const col = (await w.c.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'plaid_items' AND column_name = 'reconnect_notified_at'`
    )).rows[0];
    assert.deepEqual(col, { data_type: "timestamp with time zone", is_nullable: "YES", column_default: null });
  });

  test("the status read: one client's logins, oldest first, real counts, the later of the two read times, no credential", async () => {
    const client = await w.addClient();
    const other = await w.addClient();
    const old = await w.addItem({ clientId: client, state: "active", name: "Chase", createdAt: "2026-09-10T10:00:00.000Z", syncedAt: "2026-10-06T07:00:05.000Z" });
    const broken = await w.addItem({ clientId: client, createdAt: "2026-09-20T10:00:00.000Z" });
    await w.addAccount({ clientId: client, itemId: old.id, plaidAcc: "o1", asOf: "2026-10-05T07:00:00.000Z" });
    await w.addAccount({ clientId: client, itemId: broken.id, plaidAcc: "b1", asOf: "2026-10-04T07:00:00.000Z" });
    await w.addAccount({ clientId: client, itemId: broken.id, plaidAcc: "b2", asOf: "2026-10-03T07:00:00.000Z" });
    await w.addAccount({ clientId: client, itemId: broken.id, plaidAcc: "b3", asOf: "2026-10-09T07:00:00.000Z", closedAt: "2026-10-01T00:00:00.000Z" });
    await w.addItem({ clientId: other });

    const rows = await listBankLoginStatus(w.conn, { orgId: w.orgId, clientId: client });
    assert.deepEqual(rows.map((r) => r.item_id), [old.id, broken.id], "oldest first, and only this client's");
    assert.equal(rows[0].state, "active");
    assert.equal(rows[0].institution, "Chase");
    assert.equal(rows[0].account_count, 1);
    assert.equal(rows[0].last_good_refresh_at, "2026-10-06T07:00:05.000Z", "the transactions read is later than the balance read");
    assert.equal(rows[1].state, "needs_reconnect");
    assert.equal(rows[1].account_count, 2, "a closed account is not counted");
    assert.equal(rows[1].last_good_refresh_at, "2026-10-04T07:00:00.000Z", "a closed account's later balance is not 'the last good read'");
    assert.deepEqual(rows[1].error, {
      code: "ITEM_LOGIN_REQUIRED", plain: "Your bank needs you to sign in again.", fix: "reconnect", at: ERRORED_AT
    });
    assert.equal(typeof rows[1].account_count, "number");
    assert.equal(JSON.stringify(rows).includes("v1:"), false, "the ciphertext came back");

    const one = await listBankLoginStatus(w.conn, { orgId: w.orgId, clientId: client, itemRowId: broken.id });
    assert.deepEqual(one.map((r) => r.item_id), [broken.id]);
    assert.deepEqual(await listBankLoginStatus(w.conn, { orgId: w.orgId, clientId: other, itemRowId: broken.id }), [],
      "another client's item id finds nothing");
  });

  test("start: a link token in update mode for the client's own login; another client's login is not found", async () => {
    const client = await w.addClient();
    const other = await w.addClient();
    const mine = await w.addItem({ clientId: client });
    const theirs = await w.addItem({ clientId: other });
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ link_token: "link-sandbox-pg", expiration: "e", request_id: "r" }), { status: 200 });
    };
    const ok = await startRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: mine.id, env: ENV, fetchImpl });
    assert.equal(ok.ok, true);
    assert.equal(ok.linkToken, "link-sandbox-pg");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.access_token, TOKEN, "the token read from the real column decrypts with Plaid's item id");
    assert.equal("products" in sent[0].body, false);

    const nope = await startRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: theirs.id, env: ENV, fetchImpl });
    assert.equal(nope.ok, false);
    assert.equal(nope.reason, "no_such_login");
    assert.equal(sent.length, 1, "Plaid was asked about another client's login");
  });

  test("finish, fixed: claimed, read, accounts upserted through the real constraints, error and marker cleared", async () => {
    const client = await w.addClient();
    const login = await w.addItem({ clientId: client, notifiedAt: "2026-10-05T07:05:00.000Z" });
    const kept = await w.addAccount({ clientId: client, itemId: login.id, plaidAcc: "p-chk", name: "Business Checking", current: 1875000, kind: "business" });
    const plaid = stubPlaid({
      [TOKEN]: [
        plaidAccount({ id: "p-chk", name: "Business Checking", mask: "2202", current: 20000.5, available: 19000 }),
        plaidAccount({ id: "p-new", name: "Savings", mask: "9009", subtype: "savings", current: 50, available: 50 })
      ]
    });
    const r = await finishRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: login.id, asOf: ASOF, env: ENV, fetchImpl: plaid.fetch });

    assert.equal(r.ok, true);
    assert.equal(r.alreadyActive, false);
    assert.equal(r.written, 2);
    assert.deepEqual(r.created.map((a) => a.name), ["Savings"]);

    const after = await w.item(login.id);
    assert.equal(after.link_state, "active");
    assert.equal(after.last_error_code, null);
    assert.equal(after.last_error_at, null);
    assert.equal(after.reconnect_notified_at, null, "the episode is over");

    const rows = (await w.c.query(
      `SELECT id, name, current_balance_cents, balance_as_of, entity_kind, closed_at
         FROM bank_accounts WHERE plaid_item_id = $1 ORDER BY plaid_account_id`, [login.id]
    )).rows;
    assert.equal(rows.length, 2);
    const chk = rows.find((a) => a.id === kept);
    assert.equal(chk.current_balance_cents, "2000050", "bigint comes back as text from pg");
    assert.equal(chk.balance_as_of.toISOString(), ASOF);
    assert.equal(chk.entity_kind, "business", "a repair must never reset whose money an account is");
    assert.equal(rows.find((a) => a.name === "Savings").entity_kind, "unknown");

    // Done twice: the second tap is a no-op and Plaid is not asked again.
    const again = await finishRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: login.id, asOf: ASOF, env: ENV, fetchImpl: plaid.fetch });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyActive, true);
    assert.equal(plaid.requests.length, 1);

    const view = (await listBankLoginStatus(w.conn, { orgId: w.orgId, clientId: client, itemRowId: login.id }))[0];
    assert.equal(view.state, "active");
    assert.equal(view.error, null);
    assert.equal(view.account_count, 2);
    assert.equal(view.last_good_refresh_at, ASOF);
  });

  test("finish, still broken: back in 'error' with the new time, and the marker is left exactly as it was", async () => {
    const client = await w.addClient();
    const login = await w.addItem({ clientId: client, notifiedAt: "2026-10-05T07:05:00.000Z" });
    const plaid = stubPlaid({ [TOKEN]: LOGIN_REQUIRED });
    const r = await finishRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: login.id, asOf: ASOF, env: ENV, fetchImpl: plaid.fetch });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "still_needs_reconnect");
    const after = await w.item(login.id);
    assert.equal(after.link_state, "error");
    assert.equal(after.last_error_code, "ITEM_LOGIN_REQUIRED");
    assert.ok(after.last_error_at, "the failure is recorded");
    assert.equal(after.reconnect_notified_at.toISOString(), "2026-10-05T07:05:00.000Z", "a failed try must not start a new text episode");
  });

  test("finish, a call the fence holds: the login goes back to 'error' with the code and the exact time it had", async () => {
    const client = await w.addClient();
    const login = await w.addItem({ clientId: client, errorAt: "2026-10-05T07:00:02.123Z" });
    const r = await finishRelink(w.conn, {
      orgId: w.orgId, clientId: client, itemRowId: login.id, asOf: ASOF,
      env: { ...ENV, ADAPTERS_DRY_RUN: "1" }, fetchImpl: async () => assert.fail("must not transmit")
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "held");
    const after = await w.item(login.id);
    assert.equal(after.link_state, "error", "nothing was read, so nothing is proved");
    assert.equal(after.last_error_code, "ITEM_LOGIN_REQUIRED");
    assert.equal(after.last_error_at.toISOString(), "2026-10-05T07:00:02.123Z");
  });

  test("finish, the bank is busy: the NEWEST failure is the one kept, and the login is back in 'error'", async () => {
    const client = await w.addClient();
    const login = await w.addItem({ clientId: client });
    const plaid = stubPlaid({ [TOKEN]: { error_type: "RATE_LIMIT_EXCEEDED", error_code: "ACCOUNTS_LIMIT", error_message: "slow down" } });
    const r = await finishRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: login.id, asOf: ASOF, env: ENV, fetchImpl: plaid.fetch });
    assert.equal(r.ok, false);
    assert.equal(r.fix, "check_again");
    const after = await w.item(login.id);
    assert.equal(after.link_state, "error");
    assert.equal(after.last_error_code, "ACCOUNTS_LIMIT");
  });

  test("a login that is not the client's, or not repairable, is refused without a write", async () => {
    const client = await w.addClient();
    const other = await w.addClient();
    const theirs = await w.addItem({ clientId: other });
    const revoked = await w.addItem({ clientId: client, state: "revoked" });
    const plaid = stubPlaid({ [TOKEN]: [plaidAccount({ id: "p" })] });
    const a = await finishRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: theirs.id, asOf: ASOF, env: ENV, fetchImpl: plaid.fetch });
    assert.equal(a.reason, "no_such_login");
    const b = await finishRelink(w.conn, { orgId: w.orgId, clientId: client, itemRowId: revoked.id, asOf: ASOF, env: ENV, fetchImpl: plaid.fetch });
    assert.equal(b.reason, "not_reconnectable");
    assert.equal(plaid.requests.length, 0);
    assert.equal((await w.item(theirs.id)).link_state, "error");
    assert.equal((await w.item(revoked.id)).link_state, "revoked");
  });
});

/* ── 3: the one text, end to end, with the real template and the real sendTemplated ─ */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, "..", "..", "db", "migrations", "474_bank_reconnect_notice.sql"), "utf8");
const TEMPLATE_BODY = /\$c\$([\s\S]*?)\$c\$/.exec(MIGRATION)[1];

describe("the reconnect text, end to end (real template, real sendTemplated, real messages index)", { skip: SKIP }, () => {
  let w;
  let a, b, c3;       // clients: texted, opted out, never subscribed
  let itemA, itemB, itemC, itemNoFix;

  before(async () => {
    w = await openWorld("notice");
    await w.c.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1, $2, 'sms', NULL, $3, true)`,
      [w.orgId, TEMPLATE_KEY, TEMPLATE_BODY]
    );
    a = await w.addClient({ phone: "+15555550141" });
    b = await w.addClient({ phone: "+15555550142" });
    c3 = await w.addClient({ phone: "+15555550143" });
    for (const id of [a, b]) {
      await w.c.query(
        `INSERT INTO subscriptions (org_id, client_id, tier, status, effective_from) VALUES ($1, $2, 'finance-os', 'active', '2026-01-01T00:00:00Z')`,
        [w.orgId, id]
      );
    }
    await recordOptOut(w.conn, b, w.orgId, "sms");
    itemA = await w.addItem({ clientId: a });
    itemB = await w.addItem({ clientId: b });
    itemC = await w.addItem({ clientId: c3 });
    itemNoFix = await w.addItem({ clientId: a, code: "ITEM_NOT_FOUND" });
  });
  after(async () => { if (w) await w.release(); });

  const messagesFor = async (clientId) => (await w.c.query(
    `SELECT template_key, rendered_body, status, provider, provider_ref, to_address, channel, direction
       FROM messages WHERE org_id = $1 AND client_id = $2 ORDER BY created_at, provider_ref`, [w.orgId, clientId]
  )).rows;

  test("one pass: the subscriber is texted; the opted-out client, the non-subscriber and the unfixable login are kept out by the query itself", async () => {
    const r = await queueReconnectNotices(w.conn, { now: NOW });
    // The candidate query carries the opt-out read and the audience (finance-os subscriber or
    // paid Blueprint), so a pile of logins that will never be texted cannot fill the batch.
    assert.equal(r.checked, 1, "only A: B opted out, C never subscribed, and ITEM_NOT_FOUND is not a reconnect code");
    assert.equal(r.queued, 1);
    assert.equal(r.notEntitled, 0);
    assert.deepEqual(r.notQueued, []);
    assert.deepEqual(r.errored, []);

    const msgs = await messagesFor(a);
    assert.equal(msgs.length, 1);
    const expected = planReconnectNotice({
      id: itemA.id, institution_name: "First Platypus Bank", last_error_code: "ITEM_LOGIN_REQUIRED", last_error_at: new Date(ERRORED_AT)
    });
    assert.equal(msgs[0].template_key, TEMPLATE_KEY);
    assert.equal(msgs[0].rendered_body, `${expected.body} Reply STOP to opt out.`, "the real template renders to the sentence the planner stores");
    assert.equal(msgs[0].status, "queued", "queued, not sent — the dispatcher is not run here");
    assert.equal(msgs[0].channel, "sms");
    assert.equal(msgs[0].direction, "outbound");
    assert.equal(msgs[0].to_address, "+15555550141");
    assert.equal(msgs[0].provider_ref, `workflow:${TEMPLATE_KEY}:${expected.eventId}`);
    assert.deepEqual(await messagesFor(b), []);
    assert.deepEqual(await messagesFor(c3), []);

    assert.equal((await w.item(itemA.id)).reconnect_notified_at.toISOString(), NOW.toISOString());
    assert.equal((await w.item(itemB.id)).reconnect_notified_at, null, "an opted-out client is not marked as told");
    assert.equal((await w.item(itemC.id)).reconnect_notified_at, null);
    assert.equal((await w.item(itemNoFix.id)).reconnect_notified_at, null);
  });

  test("the next morning: nothing more — A is marked as told, and B (opted out) and C (never subscribed) are still not candidates", async () => {
    const r = await queueReconnectNotices(w.conn, { now: new Date("2026-10-08T07:00:00.000Z") });
    assert.equal(r.checked, 0);
    assert.equal(r.queued, 0);
    assert.equal((await messagesFor(a)).length, 1);
  });

  test("a pass that died between the text and the marker lands on the SAME messages row — the real unique index, not a stand-in", async () => {
    await w.c.query(`UPDATE plaid_items SET reconnect_notified_at = NULL WHERE id = $1`, [itemA.id]);
    const r = await queueReconnectNotices(w.conn, { now: new Date("2026-10-08T07:30:00.000Z") });
    assert.equal(r.queued, 1, "the retry reports the text as queued");
    assert.equal((await messagesFor(a)).length, 1, "and there is still ONE message row");
    assert.equal((await w.item(itemA.id)).reconnect_notified_at.toISOString(), "2026-10-08T07:30:00.000Z");
  });

  test("the client reconnects, then the bank asks again months later: a SECOND text, on its own message row", async () => {
    const fixed = await finishRelink(w.conn, {
      orgId: w.orgId, clientId: a, itemRowId: itemA.id, asOf: "2026-10-09T12:00:00.000Z", env: ENV,
      fetchImpl: stubPlaid({ [TOKEN]: [plaidAccount({ id: "p1" })] }).fetch
    });
    assert.equal(fixed.ok, true);
    assert.equal((await w.item(itemA.id)).reconnect_notified_at, null, "a read that worked ends the episode");

    // Months later. The daily refresh marks it again (here: the same two columns it writes).
    await w.c.query(
      `UPDATE plaid_items SET link_state = 'error', last_error_code = 'ITEM_LOGIN_REQUIRED', last_error_at = '2026-12-01T06:59:50.000Z' WHERE id = $1`,
      [itemA.id]
    );
    const r = await queueReconnectNotices(w.conn, { now: new Date("2026-12-01T07:00:00.000Z") });
    assert.equal(r.queued, 1);
    const msgs = await messagesFor(a);
    assert.equal(msgs.length, 2, "the second break was told to the client");
    assert.notEqual(msgs[0].provider_ref, msgs[1].provider_ref);
  });
});
