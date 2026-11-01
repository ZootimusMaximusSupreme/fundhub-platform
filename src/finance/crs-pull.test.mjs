import { test } from "node:test";
import assert from "node:assert";

import {
  runCrsPull,
  providerResultIdFor,
  simulationModeFor,
  simulatedBureauResponse,
  CRS_PROVIDER,
  CRS_SIMULATED_PROVIDER
} from "./crs-pull.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function request(id, over = {}) {
  return {
    id,
    org_id: ORG,
    client_id: CLIENT,
    requested_by_kind: "staff",
    requested_by_staff_id: "33333333-3333-4333-8333-333333333333",
    requested_by_account_id: null,
    reason: "paid diagnostic",
    cost_cents: null,
    subscription_id: null,
    crs_result_id: null,
    status: "queued",
    state_reason: null,
    provider: "crs_softview",
    idempotency_key: null,
    requested_at: new Date(),
    resolved_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over
  };
}

function fakeDb(initialRequest) {
  const requests = new Map([[initialRequest.id, initialRequest]]);
  const results = [];
  const events = [];
  const eventKeys = new Set();
  const clients = new Map([[CLIENT, { id: CLIENT, outcome_tier: null }]]);
  let resultNumber = 0;

  return {
    requests,
    results,
    events,
    clients,
    businesses: [],
    async query(sql, params = []) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };

      // loadClientIdentity's lookup. No row means no identity on file, which
      // is the refusal this file's gate tests want.
      if (/FROM clients c/.test(sql)) return { rows: [] };
      if (/FROM businesses/.test(sql)) return { rows: this.businesses };

      if (/FROM soft_pull_requests WHERE id = \$1/.test(sql)) {
        const row = requests.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM crs_results WHERE id = \$1/.test(sql)) {
        const row = results.find((item) => item.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM crs_results\s+WHERE provider = \$1/.test(sql)) {
        const row = results.find(
          (item) => item.provider === params[0] && item.provider_result_id === params[1]
        );
        return { rows: row ? [row] : [] };
      }
      if (/SELECT id FROM soft_pull_requests WHERE crs_result_id/.test(sql)) {
        const row = [...requests.values()].find((item) => item.crs_result_id === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/SET status = 'processing'/.test(sql)) {
        const row = requests.get(params[0]);
        if (!row
            || row.org_id !== params[1]
            || row.client_id !== params[2]
            || row.status !== "queued") {
          return { rows: [] };
        }
        Object.assign(row, { status: "processing", updated_at: new Date() });
        return { rows: [row] };
      }
      if (/INSERT INTO crs_results/.test(sql)) {
        const row = {
          id: `result-${++resultNumber}`,
          org_id: params[0],
          client_id: params[1],
          provider: params[2],
          provider_result_id: params[3],
          result: JSON.parse(params[4]),
          outcome_tier: params[5],
          created_at: new Date()
        };
        results.push(row);
        return { rows: [row] };
      }
      if (/UPDATE clients SET outcome_tier/.test(sql)) {
        const row = clients.get(params[0]) || { id: params[0], outcome_tier: null };
        row.outcome_tier = params[1];
        clients.set(params[0], row);
        return { rows: [row] };
      }
      if (/UPDATE crs_results\s+SET outcome_tier = COALESCE/.test(sql)) {
        const row = results.find((item) => item.id === params[0]);
        if (!row) return { rows: [] };
        if (row.outcome_tier == null) row.outcome_tier = params[1];
        return { rows: [row] };
      }
      if (/SET status = 'fulfilled'/.test(sql)) {
        const row = requests.get(params[0]);
        // $3 is the expected prior status — processing in production, queued only
        // when a legacy caller passes allowQueued.
        if (!row || row.status !== params[2]) return { rows: [] };
        Object.assign(row, {
          status: "fulfilled",
          crs_result_id: params[1],
          resolved_at: new Date(),
          updated_at: new Date()
        });
        return { rows: [row] };
      }
      if (/SET status = \$2, state_reason = \$3/.test(sql)) {
        const row = requests.get(params[0]);
        if (!row || (row.status !== "queued" && row.status !== "processing")) return { rows: [] };
        Object.assign(row, {
          status: params[1],
          state_reason: params[2],
          resolved_at: new Date(),
          updated_at: new Date()
        });
        return { rows: [row] };
      }
      if (/INSERT INTO events/.test(sql)) {
        const key = params[3];
        if (eventKeys.has(key)) return { rows: [] };
        eventKeys.add(key);
        const row = { id: `event-${events.length + 1}`, name: params[1], key, payload: params[5] };
        events.push(row);
        return { rows: [{ id: row.id }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

function report(score, creditor = "TEST BANK") {
  return {
    scores: [{ score, modelName: "FICO9" }],
    tradelines: [],
    inquiries: [{ creditorName: creditor, sourceType: "Experian", inquiryDate: "2026-08-01" }]
  };
}

function fakeClient(outputs) {
  const calls = [];
  return {
    calls,
    host: "api-sandbox.stitchcredit.com",
    config: { missing: [] },
    isConfigured: () => true,
    async orderPrequal({ bureau }) {
      calls.push(bureau);
      return outputs[bureau];
    }
  };
}

test("runCrsPull stores one tri-bureau result and replays without another order", async () => {
  const db = fakeDb(request("request-1"));
  const client = fakeClient({
    TU: { ok: true, requestId: "REQ-Z", report: report(730, "TU BANK") },
    EX: { ok: true, requestId: "REQ-A", report: report(720, "EX BANK") },
    EQ: { ok: true, requestId: "REQ-M", report: report(710, "EQ BANK") }
  });

  const first = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-1", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(db.results.length, 1);
  assert.equal(db.requests.get("request-1").status, "fulfilled");
  assert.deepEqual(db.results[0].result.requestIds, {
    TU: "REQ-Z", EX: "REQ-A", EQ: "REQ-M"
  });

  const expectedIdentity = providerResultIdFor({
    requestIds: { EQ: "REQ-M", TU: "REQ-Z", EX: "REQ-A" }
  });
  assert.equal(db.results[0].provider_result_id, expectedIdentity);
  assert.doesNotMatch(expectedIdentity, /REQ-[AZM]/);

  assert.equal(db.events.length, 2);
  assert.deepEqual(db.events.map((e) => e.name), ["analysis.completed", "decision.rendered"]);
  assert.equal(db.events[0].key, `crs-result:${first.crsResultId}:analysis.completed:v1`);
  assert.equal(db.events[1].key, `crs-result:${first.crsResultId}:decision.rendered:v1`);
  assert.equal(db.events[0].payload.crsResultId, first.crsResultId);
  assert.equal(db.events[0].payload.requestId, "request-1");
  assert.equal(db.events[0].payload.source, "crs");
  assert.ok(db.events[0].payload.scores);
  assert.ok(db.events[0].payload.bureaus);
  /* Pin the key name. c-02-inquiry-created reads `newInquiries`; when this
     emitter said `inquiries` no inquiry was ever logged from a real pull. The
     second assertion keeps the dead name from coming back alongside it. */
  assert.ok(Array.isArray(db.events[0].payload.newInquiries));
  assert.equal("inquiries" in db.events[0].payload, false);
  // c-02 reads `{ bureau, inquiry }` off each entry. Pin that too, so a payload
  // that carries the right key but the wrong item shape still fails here.
  assert.ok(db.events[0].payload.newInquiries.length > 0);
  for (const inq of db.events[0].payload.newInquiries) {
    assert.ok(inq.bureau, "each inquiry carries a bureau");
    assert.ok(inq.inquiry, "each inquiry carries a creditor name");
  }
  assert.ok(first.outcomeTier);
  assert.equal(db.events[0].payload.outcomeTier, first.outcomeTier);
  assert.equal(db.events[1].payload.outcomeTier, first.outcomeTier);
  assert.equal(db.clients.get(CLIENT).outcome_tier, first.outcomeTier);
  assert.equal(db.results[0].outcome_tier, first.outcomeTier);
  assert.equal("softPullRequestId" in db.events[0].payload, false);

  const replay = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-1", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.crsResultId, first.crsResultId);
  assert.equal(replay.event.deduped, true);
  assert.equal(replay.events.decision.deduped, true);
  assert.equal(replay.outcomeTier, first.outcomeTier);
  assert.deepEqual(client.calls, ["TU", "EX", "EQ"], "replay ordered the bureaus again");
  assert.equal(db.results.length, 1);
  assert.equal(db.events.length, 2, "replay must not emit a second analysis/decision pair");
});

test("a second worker cannot order on an active claim while the first stores its result", async () => {
  const db = fakeDb(request("request-concurrent", {
    requested_by_kind: "system", requested_by_staff_id: null
  }));
  let entered, release;
  const providerEntered = new Promise((resolve) => { entered = resolve; });
  const providerRelease = new Promise((resolve) => { release = resolve; });
  const firstClient = fakeClient({ TU: { ok: true, requestId: "FIRST-TU", report: report(700) } });
  const firstOrder = firstClient.orderPrequal;
  firstClient.orderPrequal = async (args) => {
    entered();
    await providerRelease;
    return firstOrder(args);
  };
  const secondClient = fakeClient({ TU: { ok: true, requestId: "SECOND-TU", report: report(710) } });
  const run = (client) => runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-concurrent", client, bureaus: ["TU"]
  }).then((value) => ({ value }), (error) => ({ error }));
  const first = run(firstClient);
  await providerEntered;
  const second = await run(secondClient);
  release();
  const original = await first;
  assert.equal(second.error?.code, "request_already_claimed");
  assert.deepEqual(secondClient.calls, [], "second worker must not contact the bureau");
  assert.equal(original.value?.ok, true, "claim owner still stores the bureau result");
  assert.equal(db.requests.get("request-concurrent").status, "fulfilled");
  assert.equal(db.results.length, 1);
});

test("a claim lost between reading queued and claiming cannot order a bureau", async () => {
  const db = fakeDb(request("request-claim-race", {
    requested_by_kind: "system", requested_by_staff_id: null
  }));
  const query = db.query.bind(db);
  let firstRead = true;
  db.query = async (sql, params) => {
    if (firstRead && /FROM soft_pull_requests WHERE id = \$1/.test(sql)) {
      firstRead = false;
      const snapshot = { ...db.requests.get("request-claim-race") };
      db.requests.get("request-claim-race").status = "processing";
      return { rows: [snapshot] };
    }
    return query(sql, params);
  };
  const client = fakeClient({ TU: { ok: true, requestId: "UNSAFE-TU", report: report(700) } });
  await assert.rejects(() => runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-claim-race", client, bureaus: ["TU"]
  }), (error) => error.code === "request_already_claimed");
  assert.deepEqual(client.calls, []);
});

test("runCrsPull stores a partial bureau result when one RequestID exists", async () => {
  const db = fakeDb(request("request-partial"));
  const client = fakeClient({
    TU: { ok: true, requestId: "REQ-ONLY", report: report(700) },
    EX: { ok: false, error: "Experian unavailable" },
    EQ: { ok: false, error: "Equifax unavailable" }
  });
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-partial", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(out.ok, true);
  assert.equal(db.results.length, 1);
  assert.deepEqual(db.results[0].result.requestIds, { TU: "REQ-ONLY" });
  assert.deepEqual(out.bureauErrors, {
    EX: "Experian unavailable", EQ: "Equifax unavailable"
  });
});

test("runCrsPull refuses reports with zero provider RequestIDs", async () => {
  const db = fakeDb(request("request-no-id"));
  const client = fakeClient({
    TU: { ok: true, report: report(700) },
    EX: { ok: true, report: report(710) },
    EQ: { ok: true, report: report(720) }
  });
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-no-id", client,
    bureaus: ["TU", "EX", "EQ"]
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "provider_result_id_required");
  assert.equal(db.results.length, 0);
  assert.equal(db.requests.get("request-no-id").status, "failed");
});

test("runCrsPull permits a later ledger request for the same client", async () => {
  const db = fakeDb(request("request-first"));
  const firstClient = fakeClient({
    TU: { ok: true, requestId: "FIRST-TU", report: report(700) }
  });
  await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-first", client: firstClient,
    bureaus: ["TU"]
  });

  db.requests.set("request-second", request("request-second"));
  const secondClient = fakeClient({
    TU: { ok: true, requestId: "SECOND-TU", report: report(740) }
  });
  const second = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-second", client: secondClient,
    bureaus: ["TU"]
  });
  assert.equal(second.ok, true);
  assert.equal(db.results.length, 2);
  assert.notEqual(db.results[0].id, db.results[1].id);
  assert.equal(db.requests.get("request-second").status, "fulfilled");
  assert.equal(db.events.length, 4);
  assert.deepEqual(
    db.events.map((e) => e.name),
    ["analysis.completed", "decision.rendered", "analysis.completed", "decision.rendered"]
  );
});

test("runCrsPull requires a ledger request before touching the client", async () => {
  const db = fakeDb(request("unused"));
  const client = fakeClient({});
  await assert.rejects(
    () => runCrsPull(db, { orgId: ORG, clientId: CLIENT, client }),
    /requestId is required/
  );
  assert.deepEqual(client.calls, []);
});

/* ── THE SIMULATION FENCE ───────────────────────────────────────────────────
   Finding T3-13: on the live site the host is the CRS production host and live
   pulls are on, so the first tap past the gates is a real bureau request
   against a real person. `simulate: true` rehearses the whole path with the
   vendor call — and only the vendor call — replaced.

   Every client below throws if orderPrequal is reached. "No bureau was
   contacted" is the claim these tests exist to prove, and a client that
   returns a canned answer instead of throwing would prove nothing. */

const PRODUCTION_HOST = "mware.crscreditapi.com";
const SANDBOX_HOST = "api-sandbox.stitchcredit.com";

function forbiddenClient(host = SANDBOX_HOST) {
  const calls = [];
  return {
    calls,
    host,
    config: { missing: [] },
    isConfigured: () => true,
    async orderPrequal({ bureau }) {
      calls.push(bureau);
      throw new Error(`a credit bureau was contacted during a simulated pull (${bureau})`);
    }
  };
}

/** A real person, shaped as loadClientIdentity returns one. Never a fixture. */
function realIdentity() {
  return {
    firstName: "DANA",
    middleName: "",
    lastName: "OKONKWO",
    suffix: "",
    birthDate: "1984-03-19",
    ssn: "412556677",
    email: "dana@example.test",
    addresses: [{
      borrowerResidencyType: "Current",
      addressLine1: "88 CEDAR ST",
      addressLine2: "",
      city: "AUSTIN",
      state: "TX",
      postalCode: "78701"
    }]
  };
}

test("simulationModeFor reads exactly three answers and guesses at nothing", () => {
  assert.equal(simulationModeFor(undefined), "real");
  assert.equal(simulationModeFor(null), "real");
  assert.equal(simulationModeFor(false), "real");
  assert.equal(simulationModeFor(true), "simulated");

  // Every near-miss refuses. None of these may be read as a yes OR as a no.
  for (const value of ["true", "TRUE", "1", 1, "yes", "on", "false", "0", 0, {}, [], "" ]) {
    assert.equal(simulationModeFor(value), "refuse", JSON.stringify(value));
  }
});

test("a simulated pull contacts no bureau and is stamped everywhere it lands", async () => {
  const db = fakeDb(request("request-sim"));
  const client = forbiddenClient(PRODUCTION_HOST);

  const out = await runCrsPull(db, {
    orgId: ORG,
    clientId: CLIENT,
    requestId: "request-sim",
    client,
    bureaus: ["TU"],
    simulate: true,
    identity: realIdentity(),
    env: { CRS_ALLOW_LIVE: "1" }
  });

  assert.equal(out.ok, true);
  assert.equal(out.simulated, true);
  assert.deepEqual(client.calls, [], "no bureau may be ordered on a simulated pull");

  // The stored row: provider namespace, bundle identity, and the payload stamp.
  assert.equal(db.results.length, 1);
  const stored = db.results[0];
  assert.equal(stored.provider, CRS_SIMULATED_PROVIDER);
  assert.notEqual(stored.provider, CRS_PROVIDER);
  assert.match(stored.provider_result_id, /^crs-simulated-bundle:/);
  assert.equal(stored.result.simulated, true);
  assert.match(stored.result.simulatedNotice, /SIMULATED/);

  // The word every existing reader already distrusts, plus the true host class
  // beside it. src/http/client-detail.mjs skips on `environment === "sandbox"`.
  assert.equal(stored.result.environment, "sandbox");
  assert.equal(stored.result.hostEnvironment, "production");

  // Nothing was invented. Unknown stays null; it is never defaulted to zero.
  assert.deepEqual(stored.result.scores, { ex: null, eq: null, tu: null });
  assert.deepEqual(stored.result.tradelines, []);
  assert.deepEqual(stored.result.inquiries, []);
  assert.equal(out.tradelinesIngested, 0);

  // The ledger closed for real, and both events fired carrying the stamp.
  assert.equal(db.requests.get("request-sim").status, "fulfilled");
  assert.deepEqual(db.events.map((e) => e.name), ["analysis.completed", "decision.rendered"]);
  assert.equal(db.events[0].payload.simulated, true);
  assert.equal(db.events[1].payload.simulated, true);

  // The tier engine ran for real — but its answer never touched the client.
  assert.ok(out.outcomeTier, "the tier engine must still run");
  assert.equal(stored.outcome_tier, out.outcomeTier);
  assert.equal(db.clients.get(CLIENT).outcome_tier, null,
    "a simulated pull must never overwrite the client's outcome tier");
});

test("a real pull is unchanged — no stamp anywhere, and the client tier is written", async () => {
  const db = fakeDb(request("request-real"));
  const client = fakeClient({ TU: { ok: true, requestId: "REQ-REAL", report: report(700) } });

  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-real", client, bureaus: ["TU"]
  });

  assert.equal(out.ok, true);
  assert.equal(out.simulated, false);
  assert.deepEqual(client.calls, ["TU"], "a real pull still orders the bureau");

  const stored = db.results[0];
  assert.equal(stored.provider, CRS_PROVIDER);
  assert.match(stored.provider_result_id, /^crs-request-bundle:/);
  assert.equal("simulated" in stored.result, false);
  assert.equal("hostEnvironment" in stored.result, false);
  assert.equal(stored.result.environment, "sandbox", "the host class, as before");
  assert.equal("simulated" in db.events[0].payload, false);
  assert.equal("simulated" in db.events[1].payload, false);
  assert.equal(db.clients.get(CLIENT).outcome_tier, out.outcomeTier);
});

test("simulate: false is a real pull, exactly as omitting it is", async () => {
  const db = fakeDb(request("request-false"));
  const client = fakeClient({ TU: { ok: true, requestId: "REQ-F", report: report(690) } });
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-false", client,
    bureaus: ["TU"], simulate: false
  });
  assert.equal(out.ok, true);
  assert.equal(out.simulated, false);
  assert.deepEqual(client.calls, ["TU"]);
});

test("an unreadable simulate refuses the pull and closes the ledger row", async () => {
  for (const value of ["true", 1, "yes", {}]) {
    const id = `request-ambiguous-${JSON.stringify(value)}`;
    const db = fakeDb(request(id));
    const client = forbiddenClient(PRODUCTION_HOST);

    const out = await runCrsPull(db, {
      orgId: ORG, clientId: CLIENT, requestId: id, client, bureaus: ["TU"], simulate: value
    });

    assert.equal(out.ok, false, JSON.stringify(value));
    assert.equal(out.code, "simulate_ambiguous");
    assert.equal(out.simulated, false);
    assert.deepEqual(client.calls, [], "an unreadable flag must never reach a bureau");
    assert.equal(db.results.length, 0, "and must store nothing");
    assert.equal(db.requests.get(id).status, "failed",
      "the row must close, or it blocks every later pull for this client");
  }
});

test("no environment variable can turn a simulation on", async () => {
  const db = fakeDb(request("request-env"));
  const client = fakeClient({ TU: { ok: true, requestId: "REQ-ENV", report: report(710) } });

  // Every spelling somebody might reach for. The pull is real regardless: the
  // only input that simulates is the `simulate` argument on this call.
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-env", client, bureaus: ["TU"],
    env: {
      CRS_SIMULATE: "1", SIMULATE: "true", CRS_DRY_RUN: "1",
      CRS_SANDBOX: "on", ADAPTERS_DRY_RUN: "1", NODE_ENV: "test"
    }
  });

  assert.equal(out.simulated, false);
  assert.equal(db.results[0].result.simulated, undefined);
  assert.deepEqual(client.calls, ["TU"]);
});

test("the identity gate still refuses first on a simulated pull", async () => {
  // No identity on file. The refusal must come from the gate, not from the fence.
  const db = fakeDb(request("request-no-identity"));
  const client = forbiddenClient(PRODUCTION_HOST);
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-no-identity", client,
    bureaus: ["TU"], simulate: true, env: { CRS_ALLOW_LIVE: "1" }
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "identity_required");
  assert.equal(out.simulated, true);
  assert.equal(db.results.length, 0);
  assert.equal(db.requests.get("request-no-identity").status, "failed");
});

test("a simulated pull does not relax CRS_ALLOW_LIVE or the sandbox fixture rule", async () => {
  // Production host with the live switch off is still refused. The fence makes
  // the vendor call skippable; it does not make any gate skippable.
  const off = fakeDb(request("request-live-off"));
  const offOut = await runCrsPull(off, {
    orgId: ORG, clientId: CLIENT, requestId: "request-live-off",
    client: forbiddenClient(PRODUCTION_HOST), bureaus: ["TU"],
    simulate: true, identity: realIdentity(), env: {}
  });
  assert.equal(offOut.ok, false);
  assert.equal(offOut.code, "production_host_refused");
  assert.equal(off.results.length, 0);

  // A vendor test fixture offered to the production host is still refused.
  const fixture = fakeDb(request("request-fixture"));
  const fixtureOut = await runCrsPull(fixture, {
    orgId: ORG, clientId: CLIENT, requestId: "request-fixture",
    client: forbiddenClient(PRODUCTION_HOST), bureaus: ["TU"],
    simulate: true,
    identity: { ...realIdentity(), ssn: "666321120" },
    env: { CRS_ALLOW_LIVE: "1" }
  });
  assert.equal(fixtureOut.ok, false);
  assert.equal(fixtureOut.code, "test_identity_on_production");
  assert.equal(fixture.results.length, 0);
});

test("a simulated pull is not configuration-exempt", async () => {
  const db = fakeDb(request("request-unconfigured"));
  const client = {
    host: PRODUCTION_HOST,
    config: { missing: ["CRS_API_USERNAME"] },
    isConfigured: () => false,
    async orderPrequal() { throw new Error("must not be reached"); }
  };
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-unconfigured", client,
    bureaus: ["TU"], simulate: true
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "not_configured");
  assert.equal(out.simulated, true);
});

test("a replay must answer the question that was asked, both ways round", async () => {
  const db = fakeDb(request("request-replay"));
  const client = forbiddenClient(PRODUCTION_HOST);
  const env = { CRS_ALLOW_LIVE: "1" };

  const first = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-replay", client,
    bureaus: ["TU"], simulate: true, identity: realIdentity(), env
  });
  assert.equal(first.ok, true);

  // Same ledger row, now asked for a REAL pull. Handing back the rehearsal
  // would tell the caller a bureau answered when none did.
  const asReal = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-replay", client,
    bureaus: ["TU"], identity: realIdentity(), env
  });
  assert.equal(asReal.ok, false);
  assert.equal(asReal.code, "simulation_mismatch");
  assert.deepEqual(client.calls, []);

  // Replayed as a simulation, it is the same rehearsal and stays stamped.
  const asSim = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-replay", client,
    bureaus: ["TU"], simulate: true, identity: realIdentity(), env
  });
  assert.equal(asSim.ok, true);
  assert.equal(asSim.simulated, true);
  assert.equal(asSim.replayed, true);
  assert.equal(asSim.crsResultId, first.crsResultId);
  assert.equal(db.results.length, 1);
  assert.equal(db.clients.get(CLIENT).outcome_tier, null);

  // And the mirror: a real result cannot be replayed as a simulation.
  db.requests.set("request-real-replay", request("request-real-replay"));
  const realClient = fakeClient({ TU: { ok: true, requestId: "REQ-RR", report: report(705) } });
  await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-real-replay", client: realClient,
    bureaus: ["TU"]
  });
  const mirrored = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-real-replay", client: realClient,
    bureaus: ["TU"], simulate: true
  });
  assert.equal(mirrored.ok, false);
  assert.equal(mirrored.code, "simulation_mismatch");
});

test("two rehearsals of the same client do not collide", async () => {
  const db = fakeDb(request("request-sim-a"));
  db.requests.set("request-sim-b", request("request-sim-b"));
  const env = { CRS_ALLOW_LIVE: "1" };

  const a = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-sim-a",
    client: forbiddenClient(PRODUCTION_HOST), bureaus: ["TU"],
    simulate: true, identity: realIdentity(), env
  });
  const b = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-sim-b",
    client: forbiddenClient(PRODUCTION_HOST), bureaus: ["TU"],
    simulate: true, identity: realIdentity(), env
  });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(db.results.length, 2);
  assert.notEqual(db.results[0].provider_result_id, db.results[1].provider_result_id);
});

test("the canned answer carries no bureau data and no vendor request id", () => {
  const out = simulatedBureauResponse({ bureau: "EX", requestId: "request-1" });
  assert.equal(out.ok, true);
  assert.equal(out.bureau, "EX");
  assert.match(out.requestId, /^SIMULATED:/);
  assert.equal(out.report.simulated, true);
  assert.deepEqual(out.report.scores, []);
  assert.deepEqual(out.report.tradelines, []);
  assert.deepEqual(out.report.inquiries, []);
  assert.deepEqual(out.report.publicRecords, []);

  // The bundle identity a simulation stores announces itself in plain text.
  const identity = providerResultIdFor({ requestIds: { EX: out.requestId }, simulated: true });
  assert.match(identity, /^crs-simulated-bundle:/);
  assert.notEqual(identity, providerResultIdFor({ requestIds: { EX: out.requestId } }));
});

test("two saved companies add both business amounts onto one personal total", async () => {
  const db = fakeDb(request("request-biz"));
  db.businesses.push(
    { name: "Older LLC", age_months: 30, entity_data: { state: "CA" } },
    { name: "Newer LLC", age_months: 6, entity_data: { state: "TX" } }
  );
  const seen = [];
  const client = fakeClient({
    EX: { ok: true, requestId: "REQ-EX", report: report(720) },
    EQ: { ok: true, requestId: "REQ-EQ", report: report(710) }
  });
  client.orderBusinessReport = async ({ name }) => {
    seen.push(name);
    return { ok: true, bin: name, report: { dollars: name === "Older LLC" ? 80000 : 20000 } };
  };
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-biz", client,
    bureaus: ["EX", "EQ"],
    runTierEngine(_merged, opts) {
      const business = opts.businessReport?.dollars || 0;
      return {
        ok: true,
        outcome: "FULL_FUNDING",
        preapprovals: {
          totalPersonal: 100000,
          totalBusiness: business,
          totalCombined: 100000 + business
        }
      };
    }
  });
  assert.equal(out.ok, true);
  assert.deepEqual(seen, ["Older LLC", "Newer LLC"]);
  assert.equal(out.fundingEstimate, 200000);
  assert.equal(db.results[0].result.businessReports.length, 2);
  assert.equal(out.outcomeTier, "FULL_FUNDING");
});

test("a business report that fails does not fail the personal pull", async () => {
  const db = fakeDb(request("request-biz-miss"));
  db.businesses.push({ name: "Ghost LLC", age_months: 24, entity_data: { state: "NV" } });
  const client = fakeClient({
    EX: { ok: true, requestId: "REQ-EX", report: report(720) }
  });
  client.orderBusinessReport = async () => {
    throw new Error("vendor down");
  };
  const out = await runCrsPull(db, {
    orgId: ORG, clientId: CLIENT, requestId: "request-biz-miss", client,
    bureaus: ["EX"]
  });
  assert.equal(out.ok, true);
  assert.equal(db.results[0].result.businessReports, undefined);
});


test("two workers reading queued concurrently order a bureau only for the successful claim", async () => {
  const requestId = "request-exclusive-claim";
  const raceDb = fakeDb(request(requestId));
  const originalQuery = raceDb.query.bind(raceDb);
  let readCount = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  raceDb.query = async (sql, params) => {
    if (String(sql).includes("FROM soft_pull_requests WHERE id = $1") && readCount < 2) {
      const snapshot = (await originalQuery(sql, params)).rows.map((row) => ({ ...row }));
      if (++readCount === 2) releaseReads();
      await bothRead;
      return { rows: snapshot };
    }
    return originalQuery(sql, params);
  };

  let releaseProvider;
  const providerHold = new Promise((resolve) => { releaseProvider = resolve; });
  let signalProviderStarted;
  const providerStarted = new Promise((resolve) => { signalProviderStarted = resolve; });
  const bureau = fakeClient({ TU: { ok: true, requestId: "REQ-CLAIM-ONLY", report: report(717) } });
  bureau.orderPrequal = async ({ bureau: name }) => {
    bureau.calls.push(name);
    if (bureau.calls.length === 1) {
      signalProviderStarted();
      await providerHold;
    }
    return { ok: true, requestId: "REQ-CLAIM-ONLY", report: report(717) };
  };
  const opts = { orgId: ORG, clientId: CLIENT, requestId, client: bureau, bureaus: ["TU"] };
  const promises = [runCrsPull(raceDb, opts), runCrsPull(raceDb, opts)];
  const settled = promises.map((p) => p.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  ));
  try {
    await providerStarted;
    const loser = await Promise.race(settled);
    assert.equal(loser.ok, false, "the second worker must lose the claim, not call the bureau");
    assert.equal(loser.error.status, 409);
  } finally {
    releaseProvider?.();
  }
  const outcomes = await Promise.all(settled);
  assert.equal(readCount, 2, "both workers had the same queued snapshot");
  assert.equal(outcomes.filter((out) => out.ok).length, 1);
  assert.equal(outcomes.filter((out) => !out.ok && out.error.status === 409).length, 1);
  assert.deepEqual(bureau.calls, ["TU"], "provider must receive exactly one order");
  assert.equal(raceDb.results.length, 1);
  assert.equal(raceDb.requests.get(requestId).status, "fulfilled");
  assert.deepEqual(raceDb.events.map((event) => event.name), ["analysis.completed", "decision.rendered"]);
});

test("a pre-claimed processing request never starts another bureau order", async () => {
  const requestId = "request-previously-processing";
  const raceDb = fakeDb(request(requestId, { status: "processing" }));
  const bureau = fakeClient({ TU: { ok: true, requestId: "SHOULD-NOT-ORDER", report: report(710) } });
  await assert.rejects(
    () => runCrsPull(raceDb, {
      orgId: ORG, clientId: CLIENT, requestId, client: bureau, bureaus: ["TU"]
    }),
    (error) => error.status === 409 && error.code === null && /processing/.test(error.message)
  );
  assert.deepEqual(bureau.calls, []);
  assert.equal(raceDb.requests.get(requestId).status, "processing", "preserve manual reconciliation evidence");
  assert.equal(raceDb.results.length, 0);
  assert.equal(raceDb.events.length, 0);
});
