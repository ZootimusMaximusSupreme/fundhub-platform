// Fulfillment safety: an explicit dispute letter ID must be claimable in the
// SAME org and for the SAME client before any PostGrid/mail adapter is called.
// GitHub Actions disposable Postgres only; no production writes or provider calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sendRepairLetters } from "./send.mjs";

const DB_URL = process.env.DATABASE_URL || "";
const SCRATCH = (() => {
  if (process.env.CI !== "true" || !DB_URL) return false;
  try {
    const url = new URL(DB_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("an unknown or another client's/org's letter ID never sends mail (disposable PostgreSQL)",
  { skip: !SCRATCH ? "requires local fundhub_ci in CI" : false }, async () => {
    const pool = new pg.Pool({ connectionString: DB_URL, max: 1 });
    let db;
    try {
      db = await pool.connect();
      await db.query("BEGIN");
      // All generated rows and writes stay in this transaction-local shadow.
      await db.query("CREATE TEMP TABLE dispute_letters (LIKE public.dispute_letters INCLUDING ALL) ON COMMIT DROP");
      const ownerOrg = randomUUID();
      const wrongOrg = randomUUID();
      const ownerClient = randomUUID();
      const wrongClient = randomUUID();
      const letterId = randomUUID();
      await db.query(`INSERT INTO dispute_letters
        (id, case_id, org_id, client_id, bureau, round, status, body_text, target)
        VALUES ($1,$2,$3,$4,'EX','R1','ready','Synthetic letter','bureau')`,
      [letterId, randomUUID(), ownerOrg, ownerClient]);

      let adapterCalls = 0;
      const sender = async () => {
        adapterCalls += 1;
        return { ok: true, providerId: "NEVER_CALLED" };
      };
      const attempt = async (orgId, clientId, id) => sendRepairLetters(db, {
        orgId, clientId, staffId: randomUUID(), mail: true,
        letters: [{ bureau: "EX", letterId: id, html: "<p>Synthetic only</p>" }],
        mailSender: sender
      });
      for (const [orgId, clientId, id, label] of [
        [ownerOrg, ownerClient, randomUUID(), "nonexistent letter"],
        [ownerOrg, wrongClient, letterId, "another client"],
        [wrongOrg, ownerClient, letterId, "another org"]
      ]) {
        const result = await attempt(orgId, clientId, id);
        assert.equal(result.ok, false, label);
        assert.equal(result.results[0].error, "letter_not_found_or_not_owned", label);
        assert.equal(adapterCalls, 0, "no real/provider adapter reached for " + label);
      }
      const unchanged = (await db.query(
        "SELECT status, mailed_at, send_claimed_at FROM dispute_letters WHERE id=$1",
        [letterId]
      )).rows[0];
      assert.equal(unchanged.status, "ready");
      assert.equal(unchanged.mailed_at, null);
      assert.equal(unchanged.send_claimed_at, null);
    } finally {
      if (db) {
        await db.query("ROLLBACK").catch(() => {});
        db.release();
      }
      await pool.end();
    }
  });
