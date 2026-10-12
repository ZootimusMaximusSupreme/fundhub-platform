import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { clearRuleCache } from "../../../compliance/screen.mjs";
import { CADENCE, queueStep } from "../../../hiring/outreach.mjs";
import { dispatchOne, OUTCOME } from "../../../messaging/dispatch.mjs";

const ORG = "10000000-0000-4000-8000-000000000001";
const CANDIDATE = "10000000-0000-4000-8000-000000000002";
const APPLICATION = "10000000-0000-4000-8000-000000000003";
const MIDDAY = () => new Date("2026-10-11T17:00:00Z");

afterEach(() => clearRuleCache());

function candidateOutreachDb() {
  const queued = [];
  const updates = [];
  return {
    queued,
    updates,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("SELECT * FROM candidates")) {
        return { rows: [{
          id: CANDIDATE,
          full_name: "Fake Candidate",
          email: "candidate@example.test",
          phone: "+15551234567",
          sms_consent: true,
          sms_opt_out_at: null,
          email_opt_out_at: null,
        }] };
      }
      if (text.includes("JOIN hiring_roles")) {
        return { rows: [{
          id: "10000000-0000-4000-8000-000000000004",
          key: "closer",
          name: "Closer",
          interview_booking_url: "https://example.test/book",
        }] };
      }
      if (text.includes("FROM message_templates")) {
        const key = params[1];
        const channel = String(key).startsWith("SMS-") ? "sms" : "email";
        return { rows: [{
          template_key: key,
          channel,
          subject: channel === "email" ? "Interview for {{role.name}}" : null,
          body: "Hi {{candidate.first_name}}, book {{role.booking_url}}",
          compliance_passed: true,
        }] };
      }
      if (text.includes("INSERT INTO messages")) {
        const row = {
          id: `10000000-0000-4000-8000-${String(queued.length + 10).padStart(12, "0")}`,
          org_id: params[0],
          client_id: null,
          direction: "outbound",
          channel: params[1],
          template_key: params[2],
          rendered_body: params[3],
          provider_ref: params[4],
          status: "queued",
          compliance_check_passed: true,
          to_address: params[5],
          subject: params[6],
          attempts: 1,
        };
        queued.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (text.includes("FROM compliance_rules")) return { rows: [] };
      if (text.includes("UPDATE messages")) {
        updates.push({ sql: text, params });
        return { rows: [] };
      }
      throw new Error(`unexpected candidate-outreach query: ${text.slice(0, 100)}`);
    },
  };
}

test("candidate outreach queues every real cadence template, then the gate blocks final delivery", async () => {
  const db = candidateOutreachDb();
  const outreach = { candidate_id: CANDIDATE, application_id: APPLICATION };

  for (const { step } of CADENCE) {
    const result = await queueStep(db, { orgId: ORG, outreach, step });
    assert.equal(result.queued, 2, `step ${step}`);
  }

  const expectedKeys = CADENCE.flatMap((step) => [step.emailKey, step.smsKey]).sort();
  assert.deepEqual(db.queued.map((row) => row.template_key).sort(), expectedKeys);

  for (const message of db.queued) {
    const result = await dispatchOne(db, message, { env: {}, now: MIDDAY });
    assert.equal(result.outcome, OUTCOME.BLOCKED, message.template_key);
    assert.deepEqual(result.detail, ["recipient_unknown"], message.template_key);
  }

  assert.equal(
    db.updates.filter((entry) => entry.sql.includes("status = 'blocked'")).length,
    expectedKeys.length,
  );
  assert.equal(
    db.updates.some((entry) => entry.sql.includes("provider_message_id")),
    false,
    "a blocked candidate message must never record a provider delivery",
  );
});
