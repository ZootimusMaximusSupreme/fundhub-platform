// Real Postgres proof for the Cortana payment feed. Refuses non-local databases
// even when DATABASE_URL exists. Everything runs inside one rolled-back
// transaction, and the sender is a capture, so nothing reaches Cortana.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sweepCortanaPaymentFeed } from "./cortana-payment-feed.mjs";
import { CORTANA_FEED_SQL } from "../pulse/beats/lib/cortana-feed-truth.mjs";

const connectionString = process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no scratch database configured */ }
const options = { skip: safe ? false : "no local test/scratch DATABASE_URL; live databases are refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

const ON = { CORTANA_FEED_ENABLED: "1" };

test("real rows: soft pull, first purchase and later fee each reach the right Cortana buckets exactly once", options, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    const org = (await db.query("SELECT id FROM orgs WHERE is_default ORDER BY id LIMIT 1")).rows[0]?.id;
    assert.ok(org, "scratch migrations must seed the default org");
    const client = (await db.query(
      `INSERT INTO clients (org_id, email, phone, first_name, last_name)
       VALUES ($1, $2, '+15555550123', 'Pat', 'Buyer') RETURNING id`,
      [org, `pat.buyer.${randomUUID().slice(0, 8)}@pgbuyer.net`]
    )).rows[0].id;
    const agent = (await db.query(
      `INSERT INTO clients (org_id, email, first_name) VALUES ($1, $2, 'Staff') RETURNING id`,
      [org, `staff.${randomUUID().slice(0, 8)}@fundhub.ai`]
    )).rows[0].id;
    const txn = async (clientId, amount, payload, minutesAgo) => (await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload, created_at)
       VALUES ($1, $2, 'Consulting Services', $3, 'succeeded', 'commas', $4, $5, now() - make_interval(mins => $6))
       RETURNING id`,
      [org, clientId, amount, `pay_${randomUUID()}`, JSON.stringify(payload), minutesAgo]
    )).rows[0].id;
    const soft = await txn(client, "32.00", { product: "crs" }, 3);
    const first = await txn(client, "1000.00", { productCode: "repair-bundle", product: "unmatched" }, 2);
    const fee = await txn(client, "2500.00", { product: "success_fee" }, 1);
    const staff = await txn(agent, "32.00", { product: "crs" }, 1);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, provider, provider_ref)
       VALUES ($1, $2, 'Consulting Services', 99, 'failed', 'commas', $3)`,
      [org, client, `pay_${randomUUID()}`]
    );

    const mine = new Set([soft, first, fee, staff]);
    const sent = [];
    const send = async (ev) => {
      const id = ev.eventId.replace(/^fh_pay_/, "").replace(/_(soft_pull|first_purchase|all_payments)$/, "");
      if (mine.has(id)) sent.push(`${id}:${ev.bucket}:${ev.amountCents}`);
      return { ok: true };
    };
    await sweepCortanaPaymentFeed(db, { send, env: ON });
    assert.deepEqual(sent.sort(), [
      `${fee}:all_payments:250000`,
      `${first}:all_payments:100000`,
      `${first}:first_purchase:100000`,
      `${soft}:all_payments:3200`,
      `${soft}:soft_pull:3200`
    ].sort());

    const rows = (await db.query(
      `SELECT transaction_id, bucket, status FROM cortana_feed_sends WHERE transaction_id = ANY($1::uuid[])`,
      [[soft, first, fee, staff]]
    )).rows;
    assert.equal(rows.filter((r) => r.status === "sent").length, 5);
    assert.deepEqual(rows.filter((r) => r.transaction_id === staff).map((r) => r.status).sort(), ["skipped", "skipped"]);

    const before = sent.length;
    await sweepCortanaPaymentFeed(db, { send, env: ON });
    assert.equal(sent.length, before, "a second sweep sends none of these again");

    const verdict = (await db.query(CORTANA_FEED_SQL)).rows[0];
    assert.ok(Number.isInteger(verdict.unsent) && Number.isInteger(verdict.failing), "the pulse truth runs on the real schema");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
