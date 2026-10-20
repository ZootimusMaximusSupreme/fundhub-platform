import assert from "node:assert/strict";
import test from "node:test";

import { runChase } from "./contract-chaser.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CONTRACT = "33333333-3333-4333-8333-333333333333";
const SIGNER = "44444444-4444-4444-8444-444444444444";
const STAFF = "55555555-5555-4555-8555-555555555555";

function chaseDb() {
  const messages = [];
  const tasks = [];
  const linkUpdates = [];
  const contract = {
    id: CONTRACT,
    org_id: ORG,
    client_id: CLIENT,
    title: "Funding agreement",
    status: "sent",
    signing_order: "sequential",
    sent_at: "2026-10-01T10:00:00.000Z",
    sent_by: STAFF,
    sent_by_name: "Taylor Closer",
  };
  const signer = {
    id: SIGNER,
    org_id: ORG,
    contract_id: CONTRACT,
    signer_index: 0,
    role_label: "Client",
    name: "Jordan Client",
    email: "jordan@example.test",
    client_id: null,
    status: "sent",
  };

  return {
    messages,
    tasks,
    linkUpdates,
    async query(sql, params = []) {
      const text = String(sql);
      if (/SELECT c\.\*, s\.name AS sent_by_name/.test(text)) return { rows: [contract] };
      if (/SELECT count\(\*\)::int AS n, max\(created_at\) AS last/.test(text)) {
        return { rows: [{ n: 0, last: null }] };
      }
      if (/FROM contract_signers/.test(text) && /ORDER BY signer_index/.test(text)) {
        return { rows: [signer] };
      }
      if (/UPDATE contract_signers/.test(text) && /link_expires_at/.test(text)) {
        linkUpdates.push({ kind: "signer", params });
        return { rows: [] };
      }
      if (/UPDATE contracts SET link_expires_at/.test(text)) {
        linkUpdates.push({ kind: "contract", params });
        return { rows: [] };
      }
      if (/FROM message_templates/.test(text)) {
        return { rows: [{
          template_key: "CONTRACT-REMIND-EMAIL",
          channel: "email",
          subject: "Please sign {{contract.title}}",
          body: "Hi {{contact.first_name}}, sign {{contract.title}} here: {{contract.link}}",
          compliance_passed: true,
        }] };
      }
      if (/INSERT INTO messages/.test(text)) {
        messages.push({
          orgId: params[0], clientId: params[1], templateKey: params[2], body: params[3],
          providerRef: params[4], to: params[5], subject: params[6],
        });
        return { rows: [{ id: "66666666-6666-4666-8666-666666666666", created_at: "2026-10-18T10:00:00.000Z" }] };
      }
      if (/FROM messaging_settings/.test(text)) {
        return { rows: [{ org_id: ORG, outbound_enabled: false, daily_send_cap: 500 }] };
      }
      if (/SELECT id FROM tasks/.test(text)) return { rows: [] };
      if (/INSERT INTO tasks/.test(text)) {
        tasks.push({
          orgId: params[0], clientId: params[1], title: params[2], body: params[3],
          sourceWorkflow: params[5], assigneeRole: params[6], assigneeStaffId: params[7],
        });
        return { rows: [{ id: "77777777-7777-4777-8777-777777777777" }] };
      }
      throw new Error(`unexpected contract-chaser proof query: ${text.slice(0, 120)}`);
    },
  };
}

test("contract-chaser mints a fresh link, queues the exact reminder, and gives the sender a task", async () => {
  const db = chaseDb();
  const result = await runChase(db, {
    orgId: ORG,
    now: "2026-10-18T10:00:00.000Z",
    baseUrl: "https://fundhub.test",
    secret: "test-contract-signing-secret-at-least-32-characters",
  });

  assert.deepEqual(result, {
    considered: 1,
    reminded: 1,
    tasked: 1,
    skipped: [],
    errors: [],
  });
  assert.deepEqual(db.linkUpdates.map((row) => row.kind), ["signer", "contract"]);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].templateKey, "CONTRACT-REMIND-EMAIL");
  assert.equal(db.messages[0].providerRef, `contract:${CONTRACT}:${SIGNER}:chase1`);
  assert.equal(db.messages[0].to, "jordan@example.test");
  assert.match(db.messages[0].body, /Hi Jordan/);
  assert.match(db.messages[0].body, /https:\/\/fundhub\.test\/contract\.html\?id=/);
  assert.match(db.messages[0].body, new RegExp(`s=${SIGNER}`));
  assert.match(db.messages[0].body, /&sig=[a-f0-9]{64}$/);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].sourceWorkflow, "contract-chaser");
  assert.equal(db.tasks[0].assigneeRole, "closer");
  assert.equal(db.tasks[0].assigneeStaffId, STAFF);
  assert.match(db.tasks[0].title, /Jordan Client has not signed/);
});
