// Real-SQL no-path evidence on disposable CI PostgreSQL ONLY; no external
// provider, bank, bureau, messaging or persistent client writes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { denialDecision, setRoundHoldReason } from "./f-09-funding-declined-no-path.mjs";

const connectionString = process.env.DATABASE_URL;
let safe = false;
try {
  const u = new URL(connectionString);
  safe = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(u.pathname);
} catch { /* never touch production or unknown endpoints */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("a bank denial does not exhaust an empty, pending, future, or foreign round (real Postgres)",
  { skip: safe ? false : "requires a local CI/test/scratch PostgreSQL URL" },
  async () => {
    const db = await pool.connect();
    await db.query("BEGIN");
    try {
      // TEMP tables mask production tables only for this connection and roll back.
      await db.query("CREATE TEMP TABLE funding_rounds AS SELECT * FROM public.funding_rounds WITH NO DATA");
      await db.query("CREATE TEMP TABLE applications AS SELECT * FROM public.applications WITH NO DATA");
      const org = randomUUID();
      const otherOrg = randomUUID();
      const clientId = randomUUID();
      const round1 = randomUUID();
      const round2 = randomUUID();
      const foreignRound = randomUUID();
      const subject = { orgId: org, clientId };

      assert.equal((await denialDecision(db, subject)).reason, "no_funding_round");
      await db.query(
        "INSERT INTO funding_rounds (id,org_id,client_id,round_number,status) VALUES ($1,$2,$3,1,'approved')",
        [round1, org, clientId]
      );
      assert.equal((await denialDecision(db, subject)).reason, "no_tracked_applications");
      await db.query(
        "INSERT INTO applications (id,org_id,funding_round_id,status) VALUES ($1,$2,$3,'Denied')",
        [randomUUID(), org, round1]
      );
      assert.deepEqual(await denialDecision(db, subject), { ok: true, reason: null, roundId: round1 });

      // A pending application prevents no-path even after a genuine DENIED mail.
      const pending = randomUUID();
      await db.query(
        "INSERT INTO applications (id,org_id,funding_round_id,status) VALUES ($1,$2,$3,'Applied')",
        [pending, org, round1]
      );
      assert.equal((await denialDecision(db, subject)).reason, "pending_applications");
      await db.query("UPDATE applications SET status='Denied' WHERE id=$1", [pending]);
      assert.equal((await denialDecision(db, subject)).ok, true);

      // A newly opened round cannot inherit the old round's denials.
      await db.query(
        "INSERT INTO funding_rounds (id,org_id,client_id,round_number,status) VALUES ($1,$2,$3,2,'approved')",
        [round2, org, clientId]
      );
      assert.deepEqual(await denialDecision(db, subject),
        { ok: false, reason: "no_tracked_applications", roundId: round2 });

      // Even an identical client UUID and newer round in another org cannot
      // make this organization's currently empty round appear denied.
      await db.query(
        "INSERT INTO funding_rounds (id,org_id,client_id,round_number,status) VALUES ($1,$2,$3,3,'approved')",
        [foreignRound, otherOrg, clientId]
      );
      await db.query(
        "INSERT INTO applications (id,org_id,funding_round_id,status) VALUES ($1,$2,$3,'Denied')",
        [randomUUID(), otherOrg, foreignRound]
      );
      assert.equal((await denialDecision(db, subject)).reason, "no_tracked_applications");
      assert.equal((await denialDecision(db, { orgId: otherOrg, clientId })).roundId, foreignRound);

      await db.query(
        "INSERT INTO applications (id,org_id,funding_round_id,status) VALUES ($1,$2,$3,'Denied')",
        [randomUUID(), org, round2]
      );
      assert.deepEqual(await denialDecision(db, subject), { ok: true, reason: null, roundId: round2 });

      // Terminal states must block late DENIED email even when all apps are Denied.
      for (const status of ["funded", "closed", "cancelled", "canceled", "completed"]) {
        await db.query("UPDATE funding_rounds SET status=$2, hold_reason=NULL WHERE id=$1", [round2, status]);
        assert.deepEqual(await denialDecision(db, subject),
          { ok: false, reason: "round_terminal", roundId: round2 });
        const hold = await setRoundHoldReason(db, { ...subject, roundId: round2, reason: "Internal Review" });
        assert.equal(hold.updated, false, `late denial must not hold ${status} round`);
        assert.equal((await db.query("SELECT hold_reason FROM funding_rounds WHERE id=$1", [round2])).rows[0].hold_reason, null);
      }
      await db.query("UPDATE funding_rounds SET status='approved' WHERE id=$1", [round2]);
      assert.equal((await setRoundHoldReason(db, { ...subject, roundId: round2, reason: "Internal Review" })).updated, true);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  }
);
