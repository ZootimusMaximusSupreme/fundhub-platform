import assert from "node:assert/strict";
import test from "node:test";

import { handleInbound } from "../../../agents/runtime.mjs";
import { launchBureauCallForCase } from "../../../inquiry-ops/bureau-call.mjs";
import { encryptSsn } from "../../../pii/index.mjs";

const ORG = "30000000-0000-4000-8000-000000000001";
const CLIENT = "30000000-0000-4000-8000-000000000002";
const CASE = "30000000-0000-4000-8000-000000000003";
const STAFF = "30000000-0000-4000-8000-000000000004";

const NON_RUNNING_AGENTS = Object.freeze([
  { code: "VF-LIVE", status: "draft", runtime: "anthropic", channel: "sms" },
  { code: "VF-SHADOW", status: "draft", runtime: "anthropic", channel: "sms" },
  { code: "GHL-A1", status: "retired", runtime: "ghl", channel: "sms_email" },
  { code: "GHL-A2", status: "retired", runtime: "ghl", channel: "sms_email" },
  { code: "GHL-A3", status: "retired", runtime: "ghl", channel: "sms_email" },
  { code: "GHL-A4", status: "retired", runtime: "ghl", channel: "sms_email" },
  { code: "GHL-A5", status: "retired", runtime: "ghl", channel: "sms_email" },
  { code: "GHL-A7", status: "retired", runtime: "ghl", channel: "sms_email" },
  { code: "GHL-DOC", status: "retired", runtime: "ghl", channel: "internal" },
  { code: "GHL-RECON", status: "retired", runtime: "ghl", channel: "internal" },
]);

function runtimeDb(agent) {
  const runs = [];
  return {
    runs,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM conversations")) return { rows: [] };
      if (text.includes("SELECT * FROM agents") && text.includes("status IN")) {
        return { rows: [{
          ...agent,
          org_id: ORG,
          agent_class: "client_facing",
          prompt: "Fake prompt that must never run.",
          guardrails: {},
        }] };
      }
      if (text.includes("INSERT INTO agent_runs")) {
        runs.push(params);
        return { rows: [{ id: `run-${agent.code}`, agent_code: params[1], outcome: params[8] }] };
      }
      throw new Error(`unexpected agent-runtime query: ${text.slice(0, 120)}`);
    },
  };
}

test("draft and retired registry agents finish as no-send runs", async () => {
  let modelCalls = 0;
  let networkCalls = 0;

  for (const agent of NON_RUNNING_AGENTS) {
    const db = runtimeDb(agent);
    const result = await handleInbound({
      id: `event-${agent.code}`,
      name: "message.inbound",
      orgId: ORG,
      clientId: CLIENT,
      payload: { channel: "sms", body: "hello" },
    }, db, {
      env: {},
      callModelFn: async () => {
        modelCalls += 1;
        return { mode: "live", text: "must not run" };
      },
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("a non-running agent must not use the network");
      },
    });

    assert.equal(result.reason, "no_eligible_agent", agent.code);
    assert.equal(db.runs.length, 1, agent.code);
    assert.equal(db.runs[0][8], "no_eligible_agent", agent.code);
  }

  assert.equal(modelCalls, 0);
  assert.equal(networkCalls, 0);
});
function bureauCallDb(env) {
  const ssnEnc = encryptSsn("123456789", { clientId: CLIENT, env });
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM inquiry_removal_cases") && text.includes("SELECT")) {
        return { rows: [{
          id: CASE,
          client_id: CLIENT,
          selected_bureaus_raw: "EX",
          case_status: "Queued",
          call_fired_at: null,
        }] };
      }
      if (text.includes("FROM clients")) {
        return { rows: [{ id: CLIENT, first_name: "Fake", last_name: "Client", phone: "+15550004444" }] };
      }
      if (text.includes("SELECT dob, addresses") && text.includes("FROM pii_identity")) {
        return { rows: [{
          dob: "1990-01-15",
          addresses: [{ line1: "123 Test Ave", city: "Phoenix", state: "AZ", zip: "85001" }],
        }] };
      }
      if (text.includes("SELECT org_id, ssn_enc FROM pii_identity")) {
        return { rows: [{ org_id: ORG, ssn_enc: ssnEnc }] };
      }
      if (text.includes("INSERT INTO pii_access_log")) {
        writes.push({ kind: "pii-log", params });
        return { rows: [] };
      }
      if (text.includes("FROM inquiry_log")) {
        return { rows: [{ inquiry: "FAKE BANK", created_at: "2026-01-01" }] };
      }
      if (text.includes("INSERT INTO outbound_calls")) {
        writes.push({ kind: "dispatch", params });
        return { rows: [] };
      }
      if (text.includes("UPDATE inquiry_removal_cases")) {
        writes.push({ kind: "case", params });
        return { rows: [] };
      }
      throw new Error(`unexpected bureau-call query: ${text.slice(0, 120)}`);
    },
  };
}

test("the inquiry voice runtime reaches a final fake delivered call with no live request", async () => {
  const env = {
    PII_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
    FUNDHUB_REP_NUMBER: "+15550005555",
  };
  const db = bureauCallDb(env);
  const placements = [];
  let networkCalls = 0;

  const result = await launchBureauCallForCase(db, {
    orgId: ORG,
    caseId: CASE,
    staffId: STAFF,
    env,
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("the fake placeCall result must not use the network");
    },
    placeCallImpl: async (request) => {
      placements.push(request);
      return { status: "sent", callId: "fake-call-1" };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    callId: "fake-call-1",
    bureau: "EX",
    caseId: CASE,
    clientId: CLIENT,
  });
  assert.equal(placements.length, 1);
  assert.equal(placements[0].metadata.case_id, CASE);
  assert.equal(placements[0].requestData.client_zip, "85001");
  assert.equal(networkCalls, 0);
  assert.deepEqual(db.writes.map((row) => row.kind), ["pii-log", "dispatch", "case"]);
});
