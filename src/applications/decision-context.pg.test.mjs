import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { logBankDecision, setApplicationStatus, setApprovalExclusion } from "./status.mjs";

const SCRATCH_URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

describe("immutable application decision context (scratch PostgreSQL)", {
  skip: !isLocalScratchDatabaseUrl(SCRATCH_URL)
}, () => {
  let pool;
  let cleanupPool;
  const orgIds = [];

  before(async () => {
    pool = new pg.Pool({ connectionString: SCRATCH_URL, max: 8 });
    const role = (await pool.query(
      "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
    )).rows[0];
    assert.equal(role.name, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    const cleanupUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
    assert.equal(isLocalScratchDatabaseUrl(cleanupUrl), true,
      "fixture cleanup needs a local scratch owner connection");
    const appTarget = new URL(SCRATCH_URL);
    const cleanupTarget = new URL(cleanupUrl);
    assert.deepEqual(
      [cleanupTarget.hostname, cleanupTarget.port || "5432", decodeURIComponent(cleanupTarget.pathname)],
      [appTarget.hostname, appTarget.port || "5432", decodeURIComponent(appTarget.pathname)],
      "cleanup owner must target exactly the same local host, port and database"
    );
    cleanupPool = new pg.Pool({ connectionString: cleanupUrl, max: 1 });
    assert.equal((await cleanupPool.query(
      "SELECT has_table_privilege(current_user,'public.offersiq_requests','DELETE') AS allowed"
    )).rows[0].allowed, true, "owner cleanup must not loosen fundhub_app grants");
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='application_decisions'
          AND column_name='decision_context'`
    )).rows[0].n, 1, "migration 554 must be installed on the scratch database");
  });

  after(async () => {
    if (!pool) return;
    try {
      // Only the synthetic organizations created by this test file are removed.
      // The owner is used only here: fundhub_app deliberately cannot delete OffersIQ receipts.
      if (cleanupPool && orgIds.length) {
        for (const table of ["application_decisions", "offersiq_requests", "crs_results",
          "applications", "funding_rounds", "clients", "lenders", "staff", "orgs"]) {
          const column = table === "orgs" ? "id" : "org_id";
          await cleanupPool.query(`DELETE FROM ${table} WHERE ${column}=ANY($1::uuid[])`, [orgIds]);
        }
      }
    } finally {
      await pool.end();
      if (cleanupPool) await cleanupPool.end();
    }
  });

  async function fixture({ makeApplication = true, makeRound = true } = {}) {
    const orgId = (await pool.query(
      "INSERT INTO orgs(slug,name) VALUES($1,'Synthetic decision context') RETURNING id",
      [`decision-context-${randomUUID()}`]
    )).rows[0].id;
    orgIds.push(orgId);
    const staffId = (await pool.query(
      "INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic advisor','funding_advisor','active') RETURNING id",
      [orgId]
    )).rows[0].id;
    const clients = (await pool.query(
      `INSERT INTO clients(org_id,first_name,last_name,email,is_demo)
       VALUES($1,'Synthetic','Applicant',$2,true),($1,'Synthetic','Other',$3,true) RETURNING id`,
      [orgId, `context+${randomUUID()}@example.test`, `context+${randomUUID()}@example.test`]
    )).rows;
    const lenderId = (await pool.query(
      `INSERT INTO lenders(org_id,lender_table,name,product_name,is_demo)
       VALUES($1,'OnlineBizCC','Synthetic context bank','Synthetic card',true) RETURNING id`, [orgId]
    )).rows[0].id;
    const f = { orgId, clientId: clients[0].id, otherClientId: clients[1].id, lenderId,
      staff: { id: staffId, name: "Synthetic advisor" }, roundId: null, applicationId: null };
    if (makeRound) {
      f.roundId = (await pool.query(
        `INSERT INTO funding_rounds(org_id,client_id,round_number,status,product,is_demo)
         VALUES($1,$2,1,'open','card_stacking',true) RETURNING id`, [orgId, f.clientId]
      )).rows[0].id;
    }
    if (makeApplication) {
      assert.ok(f.roundId);
      f.applicationId = (await pool.query(
        `INSERT INTO applications(org_id,client_id,lender_id,funding_round_id,bank,lender_name,
           lender_table,status,requested_amount,is_demo)
         VALUES($1,$2,$3,$4,'Synthetic context bank','Synthetic context bank','OnlineBizCC','Apply',20000,true)
         RETURNING id`, [orgId, f.clientId, lenderId, f.roundId]
      )).rows[0].id;
    }
    f.baseTime = new Date((await pool.query("SELECT clock_timestamp() AS at")).rows[0].at);
    return f;
  }

  const relativeTime = (f, minutes) => new Date(f.baseTime.getTime() + minutes * 60_000).toISOString();

  async function offer(f, overrides = {}) {
    const data = {
      orgId: f.orgId, clientId: f.clientId, staffId: f.staff.id,
      environment: "production", status: "matched",
      createdAt: relativeTime(f, -20), finishedAt: relativeTime(f, -10), ...overrides
    };
    return (await pool.query(
      `INSERT INTO offersiq_requests(org_id,client_id,requester_staff_id,operation_id,rule_set_id,
         environment,identity_fingerprint,identity_source,address_confirmed_at,
         consent_terms_url,consent_version,consent_accepted_at,status,provider_request_id,
         normalized_response,created_at,finished_at)
       VALUES($1,$2,$3,$4,1677,$5,$6,'setter_confirmed',$7,
         'https://example.test/terms','synthetic-v1',$7,$8,$9,$10::jsonb,$11,$12) RETURNING id`,
      [data.orgId, data.clientId, data.staffId, randomUUID(), data.environment,
        (randomUUID() + randomUUID()).replaceAll("-", ""), relativeTime(f, -30),
        data.status, randomUUID(), JSON.stringify({ outcome: data.status, credit_score: 790,
          offers_iq_summary: { availableCredit: 12345 }, name: "IDENTITY_SHOULD_NOT_COPY" }),
        data.createdAt, data.finishedAt]
    )).rows[0].id;
  }

  async function report(f, overrides = {}) {
    const data = { orgId: f.orgId, clientId: f.clientId, environment: "production",
      isDemo: false, createdAt: relativeTime(f, -10), ...overrides };
    return (await pool.query(
      `INSERT INTO crs_results(org_id,client_id,result,is_demo,created_at)
       VALUES($1,$2,$3::jsonb,$4,$5) RETURNING id`,
      [data.orgId, data.clientId, JSON.stringify({ environment: data.environment,
        personal: { name: "REPORT_IDENTITY_SHOULD_NOT_COPY" }, scores: { equifax: 790 } }),
      data.isDemo, data.createdAt]
    )).rows[0].id;
  }

  async function decide(f, { status = "Approved", amount, playName = null, staff = f.staff } = {}) {
    return setApplicationStatus(pool, {
      orgId: f.orgId, applicationId: f.applicationId, status, eventType: "bank_decision", staff, playName,
      patch: amount === undefined ? null : { approved_amount: amount }
    });
  }

  async function decisions(f) {
    return (await pool.query(
      "SELECT * FROM application_decisions WHERE org_id=$1 AND application_id=$2 ORDER BY decided_at,id",
      [f.orgId, f.applicationId]
    )).rows;
  }

  test("unknown amount stays null; later amounts and receipts cannot rewrite the first decision", async () => {
    const f = await fixture();
    await decide(f);
    const first = (await decisions(f))[0];
    assert.equal(first.decision_context.approved_amount, null);
    assert.equal(first.decision_context.requested_amount, "20000.00");
    assert.equal(first.decision_context.offersiq, null);
    assert.equal(first.decision_context.crs_result, null);
    assert.equal(first.decision_context.client_id, f.clientId);
    const receipt = await offer(f);
    await decide(f, { amount: "12500.50" });
    const rows = await decisions(f);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].decision_context, first.decision_context);
    assert.equal(rows[1].decision_context.approved_amount, "12500.50");
    assert.equal(rows[1].decision_context.offersiq.ledger_id, receipt);
    await assert.rejects(pool.query(
      "UPDATE application_decisions SET decision_context='{}'::jsonb WHERE id=$1", [first.id]
    ), error => error.code === "23514" && /immutable/.test(error.message));
  });

  test("latest completed production no-hit/error wins; other tenants, people, sandbox, future and pending are excluded", async () => {
    const f = await fixture();
    const foreign = await fixture();
    await offer(f, { finishedAt: relativeTime(f, -15) });
    const noHit = await offer(f, { status: "needs_review", finishedAt: relativeTime(f, -6) });
    await decide(f);
    assert.equal((await decisions(f))[0].decision_context.offersiq.ledger_id, noHit);
    const latest = await offer(f, { status: "error", finishedAt: relativeTime(f, -5) });
    await offer(f, { clientId: f.otherClientId, finishedAt: relativeTime(f, -1) });
    // A deliberately inconsistent foreign-org row proves the org predicate independently of client_id.
    await offer(foreign, { clientId: f.clientId, finishedAt: relativeTime(foreign, -1) });
    await offer(f, { environment: "sandbox", finishedAt: relativeTime(f, -1) });
    await offer(f, { createdAt: relativeTime(f, 10), finishedAt: relativeTime(f, 11) });
    await offer(f, { finishedAt: relativeTime(f, 10) });
    await offer(f, { status: "in_flight", finishedAt: null });
    await decide(f);
    const context = (await decisions(f))[1].decision_context;
    assert.equal(context.offersiq.ledger_id, latest);
    assert.equal(context.offersiq.status, "error");
    assert.equal(context.offersiq.rule_set_id, 1677);
    assert.equal(context.offersiq.method, "latest_completed_production_as_of_decision");
    assert.doesNotMatch(JSON.stringify(context), /IDENTITY_SHOULD_NOT_COPY|credit_score|availableCredit/);
  });

  test("only same-person non-demo explicit-production report metadata is captured", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const expected = await report(f, { createdAt: relativeTime(f, -8) });
    await report(f, { clientId: f.otherClientId, createdAt: relativeTime(f, -1) });
    await report(foreign, { clientId: f.clientId, createdAt: relativeTime(foreign, -1) });
    await report(f, { environment: "sandbox", createdAt: relativeTime(f, -1) });
    await report(f, { environment: null, createdAt: relativeTime(f, -1) });
    await report(f, { isDemo: true, createdAt: relativeTime(f, -1) });
    await report(f, { createdAt: relativeTime(f, 10) });
    await decide(f);
    const context = (await decisions(f))[0].decision_context;
    assert.equal(context.crs_result.result_id, expected);
    assert.equal(context.crs_result.environment, "production");
    assert.doesNotMatch(JSON.stringify(context), /REPORT_IDENTITY_SHOULD_NOT_COPY|scores|equifax/);
  });

  test("past decision cutoff is preserved and caller-supplied context is ignored", async () => {
    const f = await fixture();
    const older = await offer(f, { createdAt: relativeTime(f, -30), finishedAt: relativeTime(f, -25) });
    await offer(f, { finishedAt: relativeTime(f, -5) });
    const decidedAt = relativeTime(f, -20);
    const row = (await pool.query(
      `INSERT INTO application_decisions(org_id,application_id,event_type,status,decided_at,decision_context)
       VALUES($1,$2,'status_change','Apply',$3,$4::jsonb) RETURNING *`,
      [f.orgId, f.applicationId, decidedAt, JSON.stringify({ schema_version: 999,
        client_id: f.otherClientId, approved_amount: "999999.00", secret: "FORGED_CONTEXT" })]
    )).rows[0];
    assert.equal(new Date(row.decided_at).toISOString(), decidedAt);
    assert.equal(row.decision_context.schema_version, 1);
    assert.equal(row.decision_context.client_id, f.clientId);
    assert.equal(row.decision_context.approved_amount, null);
    assert.equal(row.decision_context.offersiq.ledger_id, older);
    assert.doesNotMatch(JSON.stringify(row.decision_context), /FORGED_CONTEXT|999999/);
  });

  test("an audit cannot attach another organization's application", async () => {
    const f = await fixture();
    const foreign = await fixture();
    await assert.rejects(pool.query(
      `INSERT INTO application_decisions(org_id,application_id,event_type,status)
       VALUES($1,$2,'status_change','Approved')`, [foreign.orgId, f.applicationId]
    ), error => error.code === "23514" && /same organization/.test(error.message));
    assert.equal((await decisions(f)).length, 0);
  });

  test("failed audit FK rolls back the status and amount using the real pool transaction", async () => {
    const f = await fixture();
    await assert.rejects(decide(f, { amount: "15000.00",
      staff: { id: randomUUID(), name: "Missing synthetic staff" } }), error => error.code === "23503");
    const application = (await pool.query("SELECT status,approved_amount FROM applications WHERE id=$1", [f.applicationId])).rows[0];
    assert.equal(application.status, "Apply");
    assert.equal(application.approved_amount, null);
    assert.equal((await decisions(f)).length, 0);
  });

  test("failed audit FK also rolls back newly created application and round", async () => {
    const f = await fixture({ makeApplication: false, makeRound: false });
    await assert.rejects(logBankDecision(pool, {
      orgId: f.orgId, clientId: f.clientId, lenderId: f.lenderId, status: "Approved",
      approvedAmount: "15000.00", staff: { id: randomUUID(), name: "Missing synthetic staff" }
    }), error => error.code === "23503");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM applications WHERE org_id=$1", [f.orgId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM funding_rounds WHERE org_id=$1", [f.orgId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM application_decisions WHERE org_id=$1", [f.orgId])).rows[0].n, 0);
  });

  test("concurrent decisions hold the application lock and retain their own amounts", async () => {
    const f = await fixture();
    const updated = deferred();
    const release = deferred();
    const secondSent = deferred();
    let secondPid;
    const instrumented = ({ afterUpdate, beforeUpdate, connected } = {}) => ({
      async query(sql, params) {
        // Preserve autocommit for an old direct-query writer while observing the same checkpoints.
        const client = await this.connect();
        try {
          return await client.query(sql, params);
        } finally {
          client.release();
        }
      },
      async connect() {
        const client = await pool.connect();
        if (connected) connected((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        return {
          async query(sql, params) {
            const appUpdate = /UPDATE\s+(?:public\.)?applications\s+SET[\s\S]*RETURNING/i.test(sql);
            if (appUpdate && beforeUpdate) beforeUpdate();
            const result = await client.query(sql, params);
            if (appUpdate && afterUpdate) await afterUpdate();
            return result;
          },
          release: () => client.release()
        };
      }
    });
    let first;
    let second;
    let failure;
    try {
      first = setApplicationStatus(instrumented({ afterUpdate: async () => {
        updated.resolve();
        await release.promise;
      } }), { orgId: f.orgId, applicationId: f.applicationId, status: "Approved",
        eventType: "bank_decision", staff: f.staff, playName: "context-first", patch: { approved_amount: "10000.00" } });
      await Promise.race([updated.promise, pause(2000).then(() => { throw new Error("first update did not reach lock checkpoint"); })]);
      second = setApplicationStatus(instrumented({ connected: pid => { secondPid = pid; },
        beforeUpdate: () => secondSent.resolve() }), {
        orgId: f.orgId, applicationId: f.applicationId, status: "Approved", eventType: "bank_decision",
        staff: f.staff, playName: "context-second", patch: { approved_amount: "20000.00" }
      });
      await Promise.race([secondSent.promise, pause(2000).then(() => { throw new Error("second update was not dispatched"); })]);
      let waiting = false;
      for (let attempt = 0; attempt < 30 && !waiting; attempt++) {
        waiting = (await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [secondPid])).rows[0]?.wait_event_type === "Lock";
        if (!waiting) await pause(10);
      }
      assert.equal(waiting, true, "the second writer must wait until the first audit commits");
    } catch (error) {
      failure = error;
    } finally {
      release.resolve();
      const results = await Promise.allSettled([first, second].filter(Boolean));
      if (!failure) failure = results.find(result => result.status === "rejected")?.reason;
    }
    if (failure) throw failure;
    const rows = await decisions(f);
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.play_name === "context-first").decision_context.approved_amount, "10000.00");
    assert.equal(rows.find(row => row.play_name === "context-second").decision_context.approved_amount, "20000.00");
  });

  test("approval exclusion captures state without creating another bank yes/no outcome", async () => {
    const f = await fixture();
    await decide(f, { amount: "12000.00" });
    await setApprovalExclusion(pool, { orgId: f.orgId, applicationId: f.applicationId,
      excluded: true, reason: "Synthetic approval not used", staff: f.staff });
    const rows = await decisions(f);
    const excluded = rows.find(row => row.event_type === "approval_excluded");
    assert.equal(excluded.status, null);
    assert.equal(excluded.decision_context.application_status, "Approved");
    assert.equal(excluded.decision_context.approval_excluded, true);
    assert.equal(excluded.decision_context.approved_amount, "12000.00");
    assert.equal(rows[0].decision_context.approval_excluded, false);
    assert.equal(rows.filter(row => row.status === "Approved").length, 1);
  });
});
