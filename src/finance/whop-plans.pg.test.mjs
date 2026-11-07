// Whop plans SQL (migration 584 + the daily read + one client's read), as the real fundhub_app role,
// in an isolated loopback scratch database. Whop itself is a fake: no call leaves. Every row rolls back.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { syncWhopMemberships } from "./whop-plans-sync.mjs";
import { listWhopPlans } from "./whop-plans.mjs";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const scratch = isLocalScratchDatabaseUrl(url);
const migration = readFileSync(new URL("../../db/migrations/584_whop_memberships.sql", import.meta.url), "utf8");
const ACCOUNT = "biz_PgWhopTest1";
const NOW = new Date("2026-11-07T07:00:00Z");

const membership = (over = {}) => ({
  id: "mem_PgAlpha1", status: "active", member_id: "mber_PgAlpha1",
  product_id: "prod_PgPkg1", product: { id: "prod_PgPkg1", title: "Consulting Services Package" },
  variant_id: "plan_PgMonthly1", renewal_price: { amount: "500.00", currency: "usd", decimals: 2 },
  billing_period_days: 30, split_pay_required_payments: null, split_pay_current_payments: null,
  collection_method: "charge_automatically", cancel_at_period_end: false,
  current_period_end: "2026-11-21T07:00:00Z", canceled_at: null, expires_at: null, metadata: {},
  account: { id: ACCOUNT }, created_at: "2026-09-22T07:00:00Z", updated_at: "2026-10-22T07:00:00Z", ...over
});
const reader = ({ listed = [], emails = {}, byId = {} } = {}) => ({
  async listMemberships() { return { rows: listed, complete: true }; },
  async getMembership(id) { if (byId[id]) return byId[id]; throw Object.assign(new Error("404"), { code: "whop_not_found" }); },
  async getMemberEmail(id) { return { id, email: emails[id] ?? null }; }
});

describe("Whop plans SQL with the real fundhub_app role", {
  skip: scratch ? false : "requires a loopback ci/test/scratch PostgreSQL database"
}, () => {
  let pool;
  before(() => { pool = new pg.Pool({ connectionString: url, max: 1 }); });
  after(async () => { await pool?.end(); });

  test("save by checkout metadata and by one email, update, read per client, unlink, and refuse bad facts", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      if (!(await db.query("SELECT to_regclass('public.whop_memberships') AS found")).rows[0].found) {
        await db.query(migration);
      }
      const slug = "whop-pg-" + crypto.randomUUID();
      const orgA = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id", [slug])).rows[0].id;
      const orgB = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id", [slug + "-b"])).rows[0].id;
      const byCheckout = (await db.query(`INSERT INTO clients (org_id, first_name, last_name, email)
        VALUES ($1, 'Checkout', 'PgTest', $2) RETURNING id`, [orgA, `checkout-${slug}@example.test`])).rows[0].id;
      const byEmail = (await db.query(`INSERT INTO clients (org_id, first_name, last_name, email)
        VALUES ($1, 'Email', 'PgTest', $2) RETURNING id`, [orgA, `client-${slug}@example.test`])).rows[0].id;
      await db.query(`INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1, 'Other', 'PgTest', $2)`,
        [orgB, `client-${slug}@example.test`]);
      await db.query("SET LOCAL ROLE fundhub_app");
      const role = (await db.query(`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
      assert.deepEqual(role, { name: "fundhub_app", rolsuper: false, rolbypassrls: false });
      const env = { WHOP_API_KEY: "pg-test-key-not-real", WHOP_ACCOUNT_ID: ACCOUNT, DEFAULT_ORG_SLUG: slug };

      const first = await syncWhopMemberships(db, { env, now: NOW, read: reader({
        listed: [
          membership({ id: "mem_PgCheckout1", member_id: "mber_PgCheckout1", metadata: { fh_org_id: orgA, fh_client_id: byCheckout } }),
          membership({ id: "mem_PgEmail1", member_id: "mber_PgEmail1", split_pay_required_payments: 6, split_pay_current_payments: 2 }),
          membership({ id: "mem_PgNobody1", member_id: "mber_PgNobody1" })
        ],
        emails: { mber_PgEmail1: ` CLIENT-${slug}@example.test `, mber_PgNobody1: "nobody@example.test" }
      }) });
      assert.deepEqual(first.matched, { fundhub_checkout: 1, email: 1 });
      assert.equal(first.unmatched.no_client, 1);

      const mine = await listWhopPlans(db, { orgId: orgA, clientId: byEmail });
      assert.equal(mine.length, 1);
      assert.equal(mine[0].product_title, "Consulting Services Package");
      assert.equal(Number(mine[0].renewal_cents), 50000);
      assert.equal(mine[0].period_end_on, "2026-11-21");
      assert.deepEqual([mine[0].split_pay_required, mine[0].split_pay_paid], [6, 2]);
      assert.equal(mine[0].matched_by, "email");
      assert.equal((await listWhopPlans(db, { orgId: orgA, clientId: byCheckout }))[0].matched_by, "fundhub_checkout");
      // No email, name or phone column exists to hold one.
      const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'whop_memberships'`)).rows.map((r) => r.column_name);
      assert.ok(!cols.some((c) => /email|name|phone|card/.test(c)), cols.join(","));

      // The next day: the email plan went past due; the checkout plan ended (read once by id).
      const second = await syncWhopMemberships(db, { env, now: new Date("2026-11-08T07:00:00Z"), read: reader({
        listed: [membership({ id: "mem_PgEmail1", member_id: "mber_PgEmail1", status: "past_due", split_pay_required_payments: 6, split_pay_current_payments: 2 })],
        emails: { mber_PgEmail1: `client-${slug}@example.test` },
        byId: { mem_PgCheckout1: membership({ id: "mem_PgCheckout1", status: "canceled", metadata: { fh_org_id: orgA, fh_client_id: byCheckout } }) }
      }) });
      assert.equal(second.refreshed, 1);
      assert.equal((await listWhopPlans(db, { orgId: orgA, clientId: byEmail }))[0].status, "past_due");
      assert.deepEqual(await listWhopPlans(db, { orgId: orgA, clientId: byCheckout }), [], "an ended plan is not shown");

      // The email no longer names a client: the link is dropped, never deleted.
      await syncWhopMemberships(db, { env, now: new Date("2026-11-09T07:00:00Z"), read: reader({
        listed: [membership({ id: "mem_PgEmail1", member_id: "mber_PgEmail1" })], emails: { mber_PgEmail1: "changed@example.test" }
      }) });
      assert.deepEqual(await listWhopPlans(db, { orgId: orgA, clientId: byEmail }), []);
      const kept = (await db.query(`SELECT unlinked_at FROM whop_memberships WHERE org_id = $1 AND whop_membership_id = 'mem_PgEmail1'`, [orgA])).rows;
      assert.equal(kept.length, 1);
      assert.ok(kept[0].unlinked_at);

      // Another company's read sees none of it.
      assert.deepEqual(await listWhopPlans(db, { orgId: orgB, clientId: byEmail }), []);

      // The database refuses facts that are not facts.
      for (const [sql, params] of [
        [`INSERT INTO whop_memberships (org_id, client_id, whop_membership_id, status, matched_by) VALUES ($1,$2,'not-a-mem','active','email')`, [orgA, byEmail]],
        [`INSERT INTO whop_memberships (org_id, client_id, whop_membership_id, status, matched_by, renewal_cents) VALUES ($1,$2,'mem_PgNeg1','active','email',-1)`, [orgA, byEmail]],
        [`INSERT INTO whop_memberships (org_id, client_id, whop_membership_id, status, matched_by) VALUES ($1,$2,'mem_PgGuess1','active','guessed')`, [orgA, byEmail]],
        [`INSERT INTO whop_memberships (org_id, client_id, whop_membership_id, status, matched_by, split_pay_required, split_pay_paid) VALUES ($1,$2,'mem_PgOver1','active','email',3,4)`, [orgA, byEmail]]
      ]) {
        await db.query("SAVEPOINT bad_fact");
        await assert.rejects(() => db.query(sql, params), (error) => error.code === "23514");
        await db.query("ROLLBACK TO SAVEPOINT bad_fact");
      }
      await db.query("SAVEPOINT no_delete");
      await assert.rejects(() => db.query(`DELETE FROM whop_memberships WHERE org_id = $1`, [orgA]), (error) => error.code === "42501");
      await db.query("ROLLBACK TO SAVEPOINT no_delete");
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      db.release();
    }
  });
});
