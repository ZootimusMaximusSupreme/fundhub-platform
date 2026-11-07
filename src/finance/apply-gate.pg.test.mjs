// Apply gate against a real scratch Postgres, as the unprivileged app role:
// migration 577's table is append only, the newest staff decision wins, and the
// approvals read takes only this client's bank yes (not another client's, not a
// denial). Every write is rolled back. Skips without a local scratch database
// (src/verification/scratch-guard.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { setApplyOverride, readOverrides, readApprovals, applyGate } from "./apply-gate.mjs";

const URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

test("apply gate: append-only overrides, newest wins, and only this client's card approvals count", {
  skip: !isLocalScratchDatabaseUrl(URL)
}, async () => {
  const pool = new pg.Pool({ connectionString: URL });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const role = (await db.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.current_user, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);

    const org = (await db.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic apply gate') RETURNING id", [`apply-gate-${randomUUID()}`])).rows[0].id;
    const client = (await db.query("INSERT INTO clients(org_id,first_name,last_name,is_demo) VALUES($1,'Synthetic','Gate',true) RETURNING id", [org])).rows[0].id;
    const other = (await db.query("INSERT INTO clients(org_id,first_name,last_name,is_demo) VALUES($1,'Other','Gate',true) RETURNING id", [org])).rows[0].id;
    const boa = (await db.query(`INSERT INTO lenders(org_id,lender_table,name,stated_requirements,requires_account_opening,active)
      VALUES($1,'OnlineBizCC','Bank of America','Max of 2 card approvals within 30 days.','yes',true) RETURNING id`, [org])).rows[0].id;

    /* Overrides: two decisions; the newest is the answer, and nobody else's file sees it. */
    const first = await setApplyOverride(db, { orgId: org, clientId: client, input: { bank: "bank of america", allow_more: true, note: "Large deposit" } });
    assert.equal(first.ok, true);
    assert.equal(first.bank_key, "bank of america");
    await setApplyOverride(db, { orgId: org, clientId: client, input: { bank: "Bank of America", allow_more: false } });
    const latest = await readOverrides(db, { orgId: org, clientId: client });
    assert.equal(latest.length, 1);
    assert.equal(latest[0].allow_more, false);
    assert.equal(latest[0].bank_name, "Bank of America");
    assert.deepEqual(await readOverrides(db, { orgId: org, clientId: other }), []);
    assert.deepEqual(await setApplyOverride(db, { orgId: org, clientId: client, input: { bank: "Made Up Bank", allow_more: true } }),
      { ok: false, error: "not_found" });

    /* Append only: the app role can never change or remove a decision. */
    for (const sql of ["UPDATE apply_gate_overrides SET allow_more = true WHERE id = $1", "DELETE FROM apply_gate_overrides WHERE id = $1"]) {
      await db.query("SAVEPOINT append_only");
      await assert.rejects(db.query(sql, [first.id]), (e) => e.code === "42501");
      await db.query("ROLLBACK TO SAVEPOINT append_only");
    }

    /* Approvals: two yeses for this client, one denial, one yes for another client. */
    const round = (await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status) VALUES($1,$2,1,'started') RETURNING id", [org, client])).rows[0].id;
    const otherRound = (await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status) VALUES($1,$2,1,'started') RETURNING id", [org, other])).rows[0].id;
    const app = (r, c, status, daysAgo) => db.query(
      `INSERT INTO applications(org_id,funding_round_id,client_id,lender_id,lender_name,lender_table,status,status_updated_date)
       VALUES($1,$2,$3,$4,'Bank of America','OnlineBizCC',$5, now() - make_interval(days => $6::int))`, [org, r, c, boa, status, daysAgo]);
    await app(round, client, "Approved", 9);
    await app(round, client, "Approved", 3);
    await app(round, client, "Denied", 2);
    await app(otherRound, other, "Approved", 1);
    const today = new Date().toISOString().slice(0, 10);
    const approvals = await readApprovals(db, { orgId: org, clientId: client, today });
    assert.equal(approvals.length, 2);
    assert.ok(approvals.every((a) => a.lender_table === "OnlineBizCC" && /^\d{4}-\d{2}-\d{2}$/.test(a.decided_on)));

    /* End to end with a seasoned Bank of America account: the book's limit is
       reached and staff's newest decision says no more, so the bank waits. */
    await db.query(`INSERT INTO blueprint_bank_relationship_todos(org_id,client_id,bank_key,account_kind,bank_name,lender_id,opened_on,state)
      VALUES($1,$2,'bank of america','business','Bank of America',$3,(now() - interval '45 days')::date,'done')`, [org, client, boa]);
    const fund = { ok: true, has_pull: true, client: { id: client, name: "Synthetic Gate" },
      now: { tier: "fundable", factors: [{ key: "no_inquiries", label: "No hard inquiries", passed: true, value: 0 }] } };
    const out = await applyGate(db, { orgId: org, clientId: client, viewer: "staff",
      fundability: async () => fund,
      match: async () => ({ matches: [{ id: boa, name: "Bank of America", lender_table: "OnlineBizCC",
        stated_requirements: "Max of 2 card approvals within 30 days." }] }) });
    assert.equal(out.gate.status, "open");
    assert.equal(out.seasoning[0].milestone, "seasoned");
    const line = out.odds[0];
    assert.equal(line.wants_account, true);
    assert.equal(line.status, "wait");
    assert.equal(line.limits[0].in_window, 2);
    assert.equal(line.override.allow_more, false);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
    await pool.end();
  }
});
