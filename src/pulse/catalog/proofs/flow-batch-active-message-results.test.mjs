import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  notifySigners,
  REMIND_TEMPLATE_KEY,
  SEND_TEMPLATE_KEY,
} from "../../../contracts/notify.mjs";
import { sendInviteForApplication, EEO_EMAIL_KEY } from "../../../hiring/eeo-selfid.mjs";
import { emailInvoice, INVOICE_TEMPLATE_KEY } from "../../../invoices/notify.mjs";
import { recorded, reset } from "../../../messaging/providers/memory.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const ORG = "41000000-0000-4000-8000-000000000001";
const CLIENT = "41000000-0000-4000-8000-000000000002";
const APPLICATION = "41000000-0000-4000-8000-000000000003";
const INVOICE = "41000000-0000-4000-8000-000000000004";
const MIDDAY = () => new Date("2026-10-12T17:00:00Z");

const TEMPLATES = Object.freeze({
  [SEND_TEMPLATE_KEY]: {
    subject: "Please sign: {{contract.title}}",
    body: "Hi {{contact.first_name}}, {{contract.sender}} sent {{contract.title}}. Open {{contract.link}}",
  },
  [REMIND_TEMPLATE_KEY]: {
    subject: "Still waiting on your signature: {{contract.title}}",
    body: "Hi {{contact.first_name}}, reminder for {{contract.title}}. Open {{contract.link}}",
  },
  [EEO_EMAIL_KEY]: {
    subject: "Optional equal-opportunity survey — Fundhub",
    body: "Hi {{candidate.first_name}}, open the optional survey: {{survey.url}}",
  },
  [INVOICE_TEMPLATE_KEY]: {
    subject: "Your invoice from {{invoice.company}} — {{invoice.amount}}",
    body: "Hi {{contact.first_name}}, {{invoice.kind}} is {{invoice.amount}}, due {{invoice.due}}. Ref {{invoice.reference}}.",
  },
});

function proofDb() {
  const messages = [];
  const invites = [];
  const updates = [];
  let sequence = 0;

  return {
    messages,
    invites,
    updates,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("FROM candidate_applications a") && text.includes("JOIN candidates")) {
        return { rows: [{
          id: APPLICATION,
          org_id: ORG,
          stage_key: "applied",
          full_name: "Fake Candidate",
          email: "candidate@example.test",
          email_opt_out_at: null,
        }] };
      }
      if (text.includes("FROM eeo_survey_invites") && text.includes("application_id")) {
        return { rows: [] };
      }
      if (text.includes("INSERT INTO eeo_survey_invites")) {
        const row = {
          id: `invite-${++sequence}`,
          survey_token: "fake-survey-token-that-is-long-enough-1234567890",
          consumed_at: null,
        };
        invites.push(row);
        return { rows: [row] };
      }
      if (text.includes("FROM invoices i") && text.includes("JOIN clients")) {
        return { rows: [{
          id: INVOICE,
          org_id: ORG,
          client_id: CLIENT,
          first_name: "Fake",
          last_name: "Client",
          client_email: "client@example.test",
          org_name: "Fundhub",
          amount_due: "497.00",
          currency: "USD",
          source: "setup_fee",
          status: "sent",
          due_at: "2026-10-15T00:00:00Z",
        }] };
      }
      // Invoice email now checks canonical receipt rows before demanding money.
      // This fixture has no applied payments; keep the real SQL path in scope
      // rather than letting the fake throw and falsely mark email delivery red.
      if (text.includes("FROM invoice_payments") && text.includes("SUM(CASE")) {
        assert.equal(params[0], INVOICE, "read the intended buyer invoice receipts");
        return { rows: [{ paid: "0.00" }] };
      }
      if (text.includes("FROM client_authorized_reps")) return { rows: [] };
      if (text.includes("FROM message_templates")) {
        const key = params[1];
        const template = TEMPLATES[key];
        return { rows: template ? [{ template_key: key, channel: "email", ...template, compliance_passed: true }] : [] };
      }
      if (text.includes("INSERT INTO messages")) {
        const eeo = text.includes("VALUES ($1, NULL");
        const row = eeo
          ? {
              id: `message-${++sequence}`,
              org_id: params[0], client_id: null, channel: "email",
              template_key: params[1], rendered_body: params[2], provider_ref: params[3],
              to_address: params[4], subject: params[5], attempts: 1,
            }
          : {
              id: `message-${++sequence}`,
              org_id: params[0], client_id: params[1], channel: "email",
              template_key: params[2], rendered_body: params[3], provider_ref: params[4],
              to_address: params[5], subject: params[6], attempts: 1,
            };
        messages.push(row);
        return { rows: [{ id: row.id, created_at: "2026-10-12T17:00:00Z" }] };
      }
      if (text.includes("INSERT INTO conversations")) {
        return { rows: [{ id: `conversation-${sequence}` }] };
      }
      if (text.includes("UPDATE messages m") && text.includes("conversation_id")) {
        return { rows: [{ id: params[0] }] };
      }
      if (text.includes("UPDATE invoices")) {
        updates.push({ kind: "invoice", sql: text, params });
        return { rows: [] };
      }
      if (text.includes("FROM messaging_settings")) {
        return { rows: [{ org_id: ORG, outbound_enabled: true, daily_send_cap: 0 }] };
      }
      if (text.includes("UPDATE messages m") && text.includes("FOR UPDATE SKIP LOCKED")) {
        return { rows: messages.filter((row) => !row.claimed).map((row) => ({ ...row, claimed: true })) };
      }
      if (text.includes("SET status = 'sending'") && text.includes("WHERE id = $1::uuid")) {
        const row = messages.find((candidate) => candidate.id === params[0]);
        if (!row || row.claimed) return { rows: [] };
        row.claimed = true;
        return { rows: [{ ...row }] };
      }
      if (text.includes("FROM opt_outs")) return { rows: [] };
      if (text.includes("FROM compliance_rules")) return { rows: [] };
      if (text.includes("FROM message_channel_routing")) {
        return { rows: [{ provider: "memory", enabled: true }] };
      }
      if (text.includes("SELECT custom_fields FROM clients")) return { rows: [{ custom_fields: {} }] };
      if (text.includes("UPDATE messages")) {
        updates.push({ kind: "message", sql: text, params });
        return { rows: [] };
      }
      throw new Error(`unexpected active-message proof query: ${text.slice(0, 140)}`);
    },
  };
}

function assertNoMergeTags(message, key) {
  assert.doesNotMatch(message.body, /{{[^}]+}}/, key);
  assert.doesNotMatch(message.subject || "", /{{[^}]+}}/, key);
}

test("contract send and chase render their real placeholders and finish at the fake provider", async () => {
  const seed = fs.readFileSync(new URL("db/seed/008_contract_messages.sql", ROOT), "utf8");
  for (const key of [SEND_TEMPLATE_KEY, REMIND_TEMPLATE_KEY]) {
    assert.match(seed, new RegExp(`'${key}'`));
  }
  for (const tag of ["contact.first_name", "contract.title", "contract.link", "contract.sender"]) {
    assert.match(seed, new RegExp(`{{${tag.replace(".", "\\.")}}}`));
  }

  reset();
  const db = proofDb();
  for (const [index, key] of [SEND_TEMPLATE_KEY, REMIND_TEMPLATE_KEY].entries()) {
    const result = await notifySigners(db, {
      orgId: ORG,
      contract: { id: `contract-${index}`, title: "Setup Agreement", signing_order: "parallel" },
      signers: [{
        id: `signer-${index}`, client_id: CLIENT, signer_index: 0, status: "pending",
        name: "Fake Client", email: "client@example.test", role_label: "Client",
      }],
      links: [{ signer_id: `signer-${index}`, url: `https://example.test/sign/${index}` }],
      purpose: index ? "chase1" : "send",
      staffName: "Chris",
      templateKey: key,
      dispatchOptions: { env: {}, now: MIDDAY, fetchImpl: async () => { throw new Error("memory must not use network"); } },
    });
    assert.equal(result.delivery.sent, 1, key);
  }

  const receipts = recorded();
  assert.equal(receipts.length, 2);
  assert.deepEqual(db.messages.map((row) => row.template_key), [SEND_TEMPLATE_KEY, REMIND_TEMPLATE_KEY]);
  assertNoMergeTags(receipts[0], SEND_TEMPLATE_KEY);
  assertNoMergeTags(receipts[1], REMIND_TEMPLATE_KEY);
  assert.match(receipts[0].body, /Chris sent Setup Agreement/);
  assert.match(receipts[1].body, /reminder for Setup Agreement/);
});

test("the hiring apply trigger queues the EEO copy and reaches a fake receipt", async () => {
  const migration = fs.readFileSync(new URL("db/migrations/300_eeo_invite_template_and_submit_outcome.sql", ROOT), "utf8");
  assert.match(migration, /EMAIL-CANDIDATE-EEO-INVITE/);
  assert.match(migration, /{{candidate\.first_name}}/);
  assert.match(migration, /{{survey\.url}}/);

  reset();
  const db = proofDb();
  const trigger = await sendInviteForApplication(db, {
    orgId: ORG,
    applicationId: APPLICATION,
    baseUrl: "https://example.test",
  });
  assert.deepEqual(
    { ok: trigger.ok, created: trigger.created, queued: trigger.queued },
    { ok: true, created: true, queued: true },
  );

  const queued = db.messages[0];
  const { dispatchOne, OUTCOME } = await import("../../../messaging/dispatch.mjs");
  const result = await dispatchOne(db, queued, { env: {}, now: MIDDAY });
  assert.equal(result.outcome, OUTCOME.SENT);
  const receipt = recorded()[0];
  assert.equal(queued.template_key, EEO_EMAIL_KEY);
  assertNoMergeTags(receipt, EEO_EMAIL_KEY);
  assert.match(receipt.body, /Hi Fake/);
  assert.match(receipt.body, /https:\/\/example\.test\/eeo-survey\.html\?token=/);
});

test("the invoice action renders every money placeholder and finishes at the fake provider", async () => {
  const seed = fs.readFileSync(new URL("db/seed/008_contract_messages.sql", ROOT), "utf8");
  assert.match(seed, /'INVOICE-SENT-EMAIL'/);
  for (const tag of ["contact.first_name", "invoice.company", "invoice.kind", "invoice.amount", "invoice.due", "invoice.reference"]) {
    assert.match(seed, new RegExp(`{{${tag.replace(".", "\\.")}}}`));
  }

  reset();
  const db = proofDb();
  const result = await emailInvoice(db, { orgId: ORG, invoiceId: INVOICE, now: MIDDAY() });
  assert.equal(result.ok, true);
  assert.equal(result.delivery.sent, 1);
  const receipt = recorded()[0];
  assert.equal(db.messages[0].template_key, INVOICE_TEMPLATE_KEY);
  assertNoMergeTags(receipt, INVOICE_TEMPLATE_KEY);
  assert.match(receipt.subject, /Fundhub — \$497\.00/);
  assert.match(receipt.body, /Setup fee is \$497\.00, due 2026-10-15/);
  assert.equal(db.updates.some((entry) => entry.kind === "invoice"), true);
});
