// Same-org identity refusal through real SQL, not an in-memory query fake.
// Runs ONLY against a disposable localhost CI database; TEMP table and ROLLBACK.
// No production/Supabase access, real bank mail, billing, bureau or SMS.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { findClient } from "../handlers/purchase-routing.mjs";
import { handle as f02 } from "./f-02-portal-id-missing.mjs";
import { handle as f03 } from "./f-03-round-submitted.mjs";
import { handle as f04 } from "./f-04-round-approvals.mjs";
import { handle as f07 } from "./f-07-funding-locked.mjs";
import { handle as f08 } from "./f-08-post-funding-monitoring.mjs";
import { handle as f10 } from "./f-10-client-funding-inbox-provisioner.mjs";
import { handle as f06 } from "./f-06-funding-conditions-missing-docs.mjs";
import { handle as f09 } from "./f-09-funding-declined-no-path.mjs";
import { handle as f11 } from "./f-11-bank-email-event-router.mjs";
import { handle as n04 } from "./n-04-post-funding-nurture.mjs";
import { handle as n06 } from "./n-06-renewal-second-wave.mjs";

const databaseUrl = process.env.DATABASE_URL;
let safe = false;
try {
  const parsed = new URL(databaseUrl);
  safe = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) &&
    /^\/(?:fundhub_ci|[a-z_]*(?:test|scratch|_ci)[a-z_]*)$/i.test(parsed.pathname);
} catch { /* Never connect to a missing/remote/production database. */ }
const pool = safe ? new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

const step = { run: (_name, fn) => fn() };

test("F-02 through F-11 and N-04/N-06 refuse foreign or phantom downstream clients (real Postgres)",
  { skip: safe ? false : "disposable localhost CI Postgres only" },
  async () => {
    const conn = await pool.connect();
    const org = randomUUID();
    const foreignOrg = randomUUID();
    const localId = randomUUID();
    const foreignId = randomUUID();
    try {
      await conn.query("BEGIN");
      // A transaction-local fixture shadows public.clients: no persistent test
      // identities are possible even in this disposable CI Postgres database.
      await conn.query(`CREATE TEMP TABLE clients (
        id uuid NOT NULL, org_id uuid NOT NULL, email text
      ) ON COMMIT DROP`);
      await conn.query(
        "INSERT INTO clients (id, org_id, email) VALUES ($1,$2,'local@example.invalid'),($3,$4,'foreign@example.invalid')",
        [localId, org, foreignId, foreignOrg]
      );
      const payloads = [
        [n04, "round.closeout", { stage: "closed", engagementComplete: true }],
        [n06, "round.funded", { fundedAmount: 1000 }],
        [f02, "round.started", { roundNumber: 1 }],
        [f03, "round.submitted", { roundNumber: 1 }],
        [f04, "round.approved", { approvedAmount: 2000 }],
        [f07, "round.funded", { approvedAmount: 2000, feePercent: 10 }],
        [f08, "round.funded", { fundedAmount: 2000 }],
        [f10, "round.started", { roundNumber: 1 }],
        [f06, "mail.response", { classification: "MISSING_DOCS", conditionDescription: "Provide bank statements" }],
        [f06, "docs.received", {}],
        [f09, "mail.response", { classification: "DENIED" }],
        [f11, "mail.response", { classification: "APPROVED" }]
      ];
      // The explicit foreign ID must fail even if an email would match a
      // different local client. It must never fall back to that email.
      for (const [handle, name, payload] of payloads) {
        const foreign = {
          id: randomUUID(), name, orgId: org, clientId: foreignId,
          payload: { ...payload, email: "local@example.invalid" }
        };
        const foreignResult = await handle({ event: foreign, db: conn, step });
        assert.equal(foreignResult.reason, "no_client", name);
        assert.equal(foreignResult.done ?? foreignResult.sent, false, name);
        const unknown = {
          id: randomUUID(), name, orgId: org, clientId: null,
          payload: { ...payload, email: "nobody@example.invalid" }
        };
        const unknownResult = await handle({ event: unknown, db: conn, step });
        assert.equal(unknownResult.reason, "no_client", name);
        assert.equal(unknownResult.done ?? unknownResult.sent, false, name);
      }
      assert.equal(await findClient(conn, {
        orgId: org, clientId: null, payload: { email: " LOCAL@EXAMPLE.INVALID " }
      }), localId, "legitimate email-only customer still resolves");
      assert.equal(await findClient(conn, {
        orgId: org, clientId: foreignId, payload: { email: "local@example.invalid" }
      }), null, "foreign explicit client is never replaced with local email");
      assert.equal((await conn.query("SELECT COUNT(*)::int AS count FROM clients")).rows[0].count, 2,
        "no new client exists after any downstream replay");
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
  }
);
