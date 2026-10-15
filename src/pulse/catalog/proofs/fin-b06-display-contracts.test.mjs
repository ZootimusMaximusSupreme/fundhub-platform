// Batch 06 display checks. Three kinds of test:
//   1. The SQL: read-only, scoped to one company, every table and column exists in the migrations.
//   2. Each check run as a judge over stand-in rows: green on a good world, red on each deliberate break.
//      (There is no local Postgres on the build Mac, so the same definition that prints the SQL is run in
//      JavaScript. A check that stays green when the data is broken fails here.)
//   3. The wiring: each control text matches exactly one screen row, and the lane judges it end to end.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B06_CHECKS, FIN_B06_GAPS, FIN_B06_DISPLAY_CONTRACTS } from "./fin-b06-display-contracts.mjs";
import { judgeCheck } from "./fin-b06-sql-kit.mjs";
import { loadSchema, schemaProblems } from "./fin-b06-schema.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import { FIN_B06_DISPLAY_PROOF_CASES } from "./fin-b06-display-practice.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { disclosureFor } from "../../../consent/disclosures.mjs";
import { DISPLAY_RESULT_CASES, DISPLAY_TRACKING_CASES, gapChecks, judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-10-14T12:00:00.000Z";
const BLUEPRINT = "consulting-package";
const sha = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

let counter = 0;
const uid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const clone = (value) => structuredClone(value);
const without = (list, pick) => list.filter((row) => !pick(row));

function checkByKey(key) {
  const found = FIN_B06_CHECKS.find((entry) => entry.key === key);
  assert.ok(found, `no check named ${key}`);
  return found;
}

function run(key, db) {
  return judgeCheck(checkByKey(key).parts, { now: NOW, ...db }, ORG);
}

// ── stand-in worlds. Each returns fresh rows; a break edits them in place. ────────────────────────────

const client = (over = {}) => ({ id: uid(), org_id: ORG, first_name: "Pat", last_name: "Lee", email: "pat@example.test", tags: [], custom_fields: {}, is_demo: false, ...over });
const buyerTx = (clientId, code = BLUEPRINT) => ({ org_id: ORG, client_id: clientId, _product_code: code });

const WORLDS = {
  "blueprint-credit-partner": {
    world() {
      const primary = client({ first_name: "Main" });
      const partner = client({ first_name: "Part", tags: ["blueprint_credit_partner"] });
      const goneLinkPartner = uid();
      return {
        clients: [primary, partner],
        transactions: [buyerTx(primary.id)],
        credit_partner_links: [
          { id: uid(), org_id: ORG, primary_client_id: primary.id, partner_client_id: partner.id, removed_at: null },
          // a removed link to a client that no longer exists is history, not a wrong result
          { id: uid(), org_id: ORG, primary_client_id: primary.id, partner_client_id: goneLinkPartner, removed_at: "2026-09-01T00:00:00Z" }
        ]
      };
    },
    sample: 1,
    breaks: {
      "the partner client row is gone": (db) => { db.clients = db.clients.filter((c) => c.first_name !== "Part"); },
      "the partner is in another company": (db) => { db.clients.find((c) => c.first_name === "Part").org_id = OTHER_ORG; },
      "the partner has no last name": (db) => { db.clients.find((c) => c.first_name === "Part").last_name = "  "; },
      "the partner email has no at sign": (db) => { db.clients.find((c) => c.first_name === "Part").email = "pat.example.test"; },
      "the partner lost the Blueprint tag": (db) => { db.clients.find((c) => c.first_name === "Part").tags = []; },
      "the primary client never bought the Blueprint": (db) => { db.transactions = [buyerTx(db.clients[0].id, "repair-trial")]; }
    }
  },

  "blueprint-ready-date": {
    world() {
      const buyer = client();
      return {
        clients: [
          { ...buyer, custom_fields: { blueprint_next_sequence_ready_date: "2026-11-02" } },
          client({ custom_fields: {} }) // never saved a date: not part of the sample
        ],
        transactions: [buyerTx(buyer.id)]
      };
    },
    sample: 1,
    breaks: {
      "the saved day is not a day": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-13-40"; },
      "the saved day is words": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "next week"; },
      "the client never bought the Blueprint": (db) => { db.transactions = []; }
    }
  },

  "blueprint-tracker-offered": {
    world() {
      const buyer = client({ custom_fields: { blueprint_bank_tracker_offered: "true" } });
      return { clients: [buyer], transactions: [buyerTx(buyer.id)] };
    },
    sample: 1,
    breaks: { "the flagged client never bought the Blueprint": (db) => { db.transactions = []; } }
  },

  "blueprint-tracker-taken-back": {
    world() {
      const buyer = client({ custom_fields: { blueprint_bank_tracker_offered: "false" } });
      const other = client({ custom_fields: { blueprint_bank_tracker_offered: "true" } }); // offered, not taken back
      return { clients: [buyer, other], transactions: [buyerTx(buyer.id), buyerTx(other.id)] };
    },
    sample: 1,
    breaks: { "the client never bought the Blueprint": (db) => { db.transactions = db.transactions.slice(1); } }
  },

  "blueprint-bank-todo": {
    world() {
      const person = client();
      return {
        clients: [person],
        blueprint_bank_relationship_todos: [{ id: uid(), org_id: ORG, client_id: person.id, bank_key: "us bank", account_kind: "personal", state: "open" }]
      };
    },
    sample: 1,
    breaks: {
      "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
      "the bank key was saved in capitals": (db) => { db.blueprint_bank_relationship_todos[0].bank_key = "US Bank"; },
      "the bank key has padding": (db) => { db.blueprint_bank_relationship_todos[0].bank_key = " us bank "; },
      "the bank key is blank": (db) => { db.blueprint_bank_relationship_todos[0].bank_key = " "; },
      "the account kind is not personal or business": (db) => { db.blueprint_bank_relationship_todos[0].account_kind = "joint"; }
    }
  },

  "blueprint-decline-recorded": {
    world() {
      const person = client();
      const app = { id: uid(), org_id: ORG, status: "Denied" };
      const decline = { id: uid(), org_id: ORG, client_id: person.id, source: "staff", application_id: app.id, recorded_by: "Sam Ops", task_id: uid() };
      return {
        clients: [person], applications: [app],
        blueprint_declines: [
          decline,
          { id: uid(), org_id: ORG, client_id: person.id, source: "client_paste", application_id: null, recorded_by: null, task_id: null } // a client paste is another control
        ],
        blueprint_decline_steps: [{ id: uid(), org_id: ORG, decline_id: decline.id, status: "open", who: "ops" }]
      };
    },
    sample: 1,
    breaks: {
      "no plan steps were built": (db) => { db.blueprint_decline_steps = []; },
      "nobody is named as the recorder": (db) => { db.blueprint_declines[0].recorded_by = ""; },
      "the application was left Applied": (db) => { db.applications[0].status = "Applied"; },
      "an open ops step has no task": (db) => { db.blueprint_declines[0].task_id = null; }
    }
  },

  "blueprint-decline-steps": {
    world() {
      const decline = { id: uid(), org_id: ORG };
      const touched = { id: uid(), org_id: ORG, decline_id: decline.id, status: "done", done_at: "2026-10-01T10:00:00Z", done_by: "Sam Ops", is_blank: false, filled_text: null, created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T10:00:00Z" };
      const untouched = { id: uid(), org_id: ORG, decline_id: decline.id, status: "open", done_at: null, done_by: null, is_blank: false, filled_text: null, created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:00:00Z" };
      return { blueprint_declines: [decline], blueprint_decline_steps: [touched, untouched] };
    },
    sample: 1,
    breaks: {
      "the decline is gone": (db) => { db.blueprint_declines = []; },
      "a reopened step kept its done time": (db) => { db.blueprint_decline_steps[0].status = "open"; },
      "a reopened step kept its done person": (db) => { Object.assign(db.blueprint_decline_steps[0], { status: "open", done_at: null }); },
      "a closed step names nobody": (db) => { db.blueprint_decline_steps[0].done_by = null; },
      "a blank was closed with no words": (db) => { Object.assign(db.blueprint_decline_steps[0], { is_blank: true, filled_text: "" }); }
    }
  },

  "blueprint-decline-call-date": {
    world() {
      const task = { id: uid(), org_id: ORG, done: false, due_at: "2026-10-20T16:00:00.000Z" };
      const decline = { id: uid(), org_id: ORG, task_id: task.id, recon_on: "2026-10-20" };
      const noTask = { id: uid(), org_id: ORG, task_id: null, recon_on: "2026-10-22" };
      return { tasks: [task], blueprint_declines: [decline, noTask] };
    },
    sample: 1,
    breaks: {
      "the ops task is gone": (db) => { db.tasks = []; },
      "the task due time is another day": (db) => { db.tasks[0].due_at = "2026-10-21T16:00:00.000Z"; },
      "the call day was cleared but the task kept a due time": (db) => { db.blueprint_declines[0].recon_on = null; }
    }
  },

  "blueprint-decline-letter": {
    world() {
      const person = client();
      const doc = { id: uid(), org_id: ORG, client_id: person.id };
      const decline = { id: uid(), org_id: ORG, client_id: person.id, letter_document_id: doc.id };
      return {
        documents: [doc], blueprint_declines: [decline],
        blueprint_decline_steps: [{ id: uid(), org_id: ORG, decline_id: decline.id, step_key: "get_letter", status: "done" }]
      };
    },
    sample: 1,
    breaks: {
      "the letter file is in another company": (db) => { db.documents[0].org_id = OTHER_ORG; },
      "the letter file belongs to another client": (db) => { db.documents[0].client_id = uid(); },
      "the get-the-letter step is still open": (db) => { db.blueprint_decline_steps[0].status = "open"; }
    }
  }
};

// Upload doors share one world builder.
function documentWorld(kind, uploader) {
  return () => {
    const person = client();
    const version = { id: uid(), org_id: ORG, storage_key: "k/abc", checksum: "sha256:aa", byte_size: 1200 };
    const document = {
      id: uid(), org_id: ORG, client_id: person.id, kind, subtype: "bank_statement", is_demo: false,
      current_version_id: version.id, storage_key: "k/abc", checksum: "sha256:aa",
      metadata: { uploaded_by: { kind: uploader, id: "x" }, label: { filed_as: "bank_statement", source: "given" } }
    };
    version.document_id = document.id;
    const elsewhere = { ...document, id: uid(), metadata: { uploaded_by: { kind: uploader === "staff" ? "client" : "staff", id: "y" } }, current_version_id: null };
    return { clients: [person], documents: [document, elsewhere], document_versions: [version] };
  };
}
const DOCUMENT_BREAKS = {
  "the current version is missing": (db) => { db.document_versions = []; },
  "the version has no stored object": (db) => { db.document_versions[0].storage_key = ""; },
  "the document row points at a different object": (db) => { db.documents[0].storage_key = "k/other"; },
  "the version has no checksum": (db) => { db.document_versions[0].checksum = null; },
  "the document checksum differs from the version": (db) => { db.documents[0].checksum = "sha256:bb"; },
  "the file is zero bytes": (db) => { db.document_versions[0].byte_size = 0; },
  "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
  "it was filed under another type than the one labeled": (db) => { db.documents[0].subtype = "other"; }
};
for (const [key, kind, uploader] of [
  ["documents-staff-dropzone", "client_upload", "staff"],
  ["documents-door-identity", "client_upload", "client"],
  ["documents-door-inquiry", "inquiry_doc", "client"],
  ["documents-door-bureau", "bureau_response", "client"]
]) {
  WORLDS[key] = { world: documentWorld(kind, uploader), sample: 1, breaks: DOCUMENT_BREAKS };
}

Object.assign(WORLDS, {
  "documents-download-link": {
    world() {
      const version = { id: uid(), org_id: ORG, storage_key: "k/roadmap" };
      const document = { id: uid(), org_id: ORG, kind: "deliverable", subtype: "funding_snapshot", is_demo: false, current_version_id: version.id, storage_key: "k/roadmap" };
      version.document_id = document.id;
      const unrelated = { id: uid(), org_id: ORG, kind: "invoice_document", subtype: "deposit_invoice", is_demo: false, current_version_id: null, storage_key: "" };
      return { documents: [document, unrelated], document_versions: [version] };
    },
    sample: 1,
    breaks: {
      "no current version": (db) => { db.documents[0].current_version_id = null; },
      "the document has no stored object": (db) => { db.documents[0].storage_key = ""; },
      "the version has no stored object": (db) => { db.document_versions[0].storage_key = null; }
    }
  },

  "identity-on-file-after-approval": {
    world() {
      const person = client();
      return {
        clients: [person],
        pii_identity: [{ id: uid(), org_id: ORG, client_id: person.id, ssn_enc: "ciphertext" }],
        client_consents: [
          { id: uid(), org_id: ORG, client_id: person.id, kind: "soft_pull_consent", granted_by_kind: "client", capture_method: "typed", revoked_at: null, granted_at: "2026-09-30T00:00:00Z" },
          // old, or recorded by staff on a call: not this control
          { id: uid(), org_id: ORG, client_id: uid(), kind: "soft_pull_consent", granted_by_kind: "client", capture_method: "typed", revoked_at: null, granted_at: "2024-01-01T00:00:00Z" },
          { id: uid(), org_id: ORG, client_id: uid(), kind: "soft_pull_consent", granted_by_kind: "staff", capture_method: "typed", revoked_at: null, granted_at: "2026-09-30T00:00:00Z" }
        ]
      };
    },
    sample: 1,
    breaks: {
      "no identity row": (db) => { db.pii_identity = []; },
      "the identity row has no encrypted number": (db) => { db.pii_identity[0].ssn_enc = null; }
    }
  }
});

const DISPUTE_WORDS = "I authorize Fundhub to prepare dispute letters for me.";
const ACCOUNT = uid();
const consentRow = (over = {}) => ({
  id: uid(), org_id: ORG, client_id: uid(), kind: "dispute_authorization", granted_by_kind: "client", granted_by_account_id: ACCOUNT,
  capture_method: "signature", consent_version: "dispute-auth-v1", consent_text: "", ...over
});

Object.assign(WORLDS, {
  "authorized-rep-removed": {
    world() {
      const account = uid(); const file = uid();
      return {
        client_authorized_reps: [
          { id: uid(), org_id: ORG, account_id: account, client_id: file, removed_at: "2026-10-01T00:00:00Z" },
          { id: uid(), org_id: ORG, account_id: account, client_id: uid(), removed_at: null }
        ],
        account_sessions: [{ id: uid(), org_id: ORG, account_id: account, active_client_id: null, revoked_at: null, expires_at: "2026-11-01T00:00:00Z" }],
        _account: account, _file: file
      };
    },
    sample: 1,
    breaks: {
      "a live session still acts on the removed file": (db) => { db.account_sessions[0].active_client_id = db._file; }
    },
    stillGreen: {
      "the session is already signed out": (db) => { Object.assign(db.account_sessions[0], { active_client_id: db._file, revoked_at: "2026-10-02T00:00:00Z" }); },
      "the same person was linked to the file again": (db) => {
        db.account_sessions[0].active_client_id = db._file;
        db.client_authorized_reps.push({ id: uid(), org_id: ORG, account_id: db._account, client_id: db._file, removed_at: null });
      }
    }
  },

  "authorized-rep-file-switch": {
    world() {
      const account = uid(); const file = uid();
      return {
        client_authorized_reps: [{ id: uid(), org_id: ORG, account_id: account, client_id: file, removed_at: null }],
        account_sessions: [
          { id: uid(), org_id: ORG, account_id: account, active_client_id: file, revoked_at: null, expires_at: "2026-11-01T00:00:00Z" },
          { id: uid(), org_id: ORG, account_id: uid(), active_client_id: null, revoked_at: null, expires_at: "2026-11-01T00:00:00Z" } // a client session
        ]
      };
    },
    sample: 1,
    breaks: {
      "the session acts on a file the login is not linked to": (db) => { db.account_sessions[0].active_client_id = uid(); },
      "the link was taken off but the session still points at the file": (db) => { db.client_authorized_reps[0].removed_at = "2026-10-01T00:00:00Z"; },
      "the link is in another company": (db) => { db.client_authorized_reps[0].org_id = OTHER_ORG; }
    },
    stillGreen: { "the session expired": (db) => { Object.assign(db.account_sessions[0], { active_client_id: uid(), expires_at: "2026-10-01T00:00:00Z" }); } }
  },

  "bank-decision-pending": {
    world() {
      const app = { id: uid(), org_id: ORG };
      return {
        applications: [app],
        application_decisions: [
          { id: uid(), org_id: ORG, application_id: app.id, event_type: "bank_decision", status: "Applied", decided_at: "2026-10-01T00:00:00Z", created_by: "Sam Closer" },
          { id: uid(), org_id: ORG, application_id: null, event_type: "status_change", status: "Applied", decided_at: null, created_by: null } // another door
        ]
      };
    },
    sample: 1,
    breaks: {
      "the application is gone": (db) => { db.applications = []; },
      "the decision has no time": (db) => { db.application_decisions[0].decided_at = null; },
      "the decision names nobody": (db) => { db.application_decisions[0].created_by = " "; }
    }
  },

  "proxy-apply-session": {
    world() {
      const person = client(); const lender = { id: uid(), org_id: ORG };
      const base = { org_id: ORG, client_id: person.id, lender_id: lender.id, started_at: "2026-10-14T11:50:00Z", ended_at: null, error_code: null, exit_ip: null, targeting_level: null };
      return {
        clients: [person], lenders: [lender],
        proxy_sessions: [
          { id: uid(), ...base, status: "active", exit_ip: "203.0.113.5", targeting_level: "city" },
          { id: uid(), ...base, status: "ended", exit_ip: "203.0.113.5", targeting_level: "city", ended_at: "2026-10-14T11:55:00Z" },
          { id: uid(), ...base, status: "failed", error_code: "geo_unavailable", ended_at: "2026-10-14T11:51:00Z" }
        ]
      };
    },
    sample: 3,
    breaks: {
      "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
      "the lender is gone": (db) => { db.lenders = []; },
      "an active session has no exit address": (db) => { db.proxy_sessions[0].exit_ip = ""; },
      "an active session has no targeting level": (db) => { db.proxy_sessions[0].targeting_level = null; },
      "an ended session has no end time": (db) => { db.proxy_sessions[1].ended_at = null; },
      "a failed session has no error": (db) => { db.proxy_sessions[2].error_code = " "; },
      "a failed session was never ended": (db) => { db.proxy_sessions[2].ended_at = null; },
      "an active session has an end time": (db) => { db.proxy_sessions[0].ended_at = "2026-10-14T11:59:00Z"; },
      "a session sat at verifying for an hour": (db) => { Object.assign(db.proxy_sessions[0], { status: "verifying", exit_ip: null, started_at: "2026-10-14T10:50:00Z" }); }
    }
  },

  "inquiry-removal-case-opened": {
    world() {
      const person = client();
      return {
        clients: [person],
        inquiry_removal_cases: [
          { id: uid(), org_id: ORG, client_id: person.id, request_source: "client_control_panel", case_id: "IRC-1", case_status: "Queued", requested_by: "Sam Ops", requested_at: "2026-10-14T10:00:00Z", is_demo: false },
          { id: uid(), org_id: ORG, client_id: person.id, request_source: "ghl_webhook", case_id: "", case_status: null, requested_by: null, requested_at: null, is_demo: false } // not this button
        ]
      };
    },
    sample: 1,
    breaks: {
      "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
      "no case number": (db) => { db.inquiry_removal_cases[0].case_id = ""; },
      "no status": (db) => { db.inquiry_removal_cases[0].case_status = null; },
      "nobody is named as the asker": (db) => { db.inquiry_removal_cases[0].requested_by = null; },
      "no request time": (db) => { db.inquiry_removal_cases[0].requested_at = null; }
    }
  },

  "client-notes-saved": {
    world() {
      return {
        clients: [
          client({ custom_fields: { staff_notes: "Call back Tuesday." } }),
          client({ custom_fields: { notes: "Old imported note." } }),
          client({ custom_fields: { notes: null, staff_notes: null } }), // empty imported fields are not notes
          client({ custom_fields: {} })
        ]
      };
    },
    sample: 2,
    breaks: {
      "a staff note was saved as a list": (db) => { db.clients[0].custom_fields.staff_notes = ["a", "b"]; },
      "a note was saved as an object": (db) => { db.clients[1].custom_fields.notes = { text: "x" }; },
      "a staff note is over the limit": (db) => { db.clients[0].custom_fields.staff_notes = "x".repeat(20001); },
      "a note is over the limit": (db) => { db.clients[1].custom_fields.notes = "y".repeat(20001); }
    }
  },

  "business-incorporated-stamp": {
    world() {
      const person = client();
      return {
        clients: [person],
        businesses: [
          { id: uid(), org_id: ORG, client_id: person.id, entity_data: { incorporated_date: "2021-03" }, age_months: 66 },
          { id: uid(), org_id: ORG, client_id: person.id, entity_data: {}, age_months: null } // no date saved: not this control
        ]
      };
    },
    sample: 1,
    breaks: {
      "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
      "the month is not a month": (db) => { db.businesses[0].entity_data.incorporated_date = "2021-13"; },
      "the date was saved as words": (db) => { db.businesses[0].entity_data.incorporated_date = "March 2021"; },
      "the age was never saved": (db) => { db.businesses[0].age_months = null; },
      "the age is negative": (db) => { db.businesses[0].age_months = -1; },
      "the age is older than the date allows": (db) => { db.businesses[0].age_months = 400; }
    }
  }
});

Object.assign(WORLDS, {
  "contract-wording-created": {
    world() {
      const staff = { id: uid(), org_id: ORG };
      return {
        staff: [staff],
        contract_templates: [
          { id: uid(), org_id: ORG, source_kind: "text", created_by: staff.id, template_key: "FUNDING-AGREEMENT", name: "Funding agreement", body: "Words.", signature_statement: "I agree.", kind: "contract", is_demo: false },
          { id: uid(), org_id: ORG, source_kind: "text", created_by: null, template_key: "seeded", name: "", body: "", signature_statement: "", kind: "x", is_demo: false } // a seed, no person behind it
        ]
      };
    },
    sample: 1,
    breaks: {
      "the short name has a space": (db) => { db.contract_templates[0].template_key = "Funding agreement"; },
      "no name": (db) => { db.contract_templates[0].name = " "; },
      "no words": (db) => { db.contract_templates[0].body = ""; },
      "no signature sentence": (db) => { db.contract_templates[0].signature_statement = null; },
      "an unknown kind": (db) => { db.contract_templates[0].kind = "invoice"; },
      "the creator is not staff in this company": (db) => { db.staff = []; }
    }
  },

  "contract-wording-edited": {
    world() {
      const staff = { id: uid(), org_id: ORG };
      const words = "Frozen contract words.";
      return {
        staff: [staff],
        contract_templates: [{ id: uid(), org_id: ORG, updated_by: staff.id, name: "Funding agreement", body: "New words.", signature_statement: "I agree.", is_demo: false }],
        contracts: [{ id: uid(), org_id: ORG, status: "sent", rendered_body: words, body_sha: sha(words), is_demo: false }]
      };
    },
    sample: 2,
    breaks: {
      "the edited wording lost its name": (db) => { db.contract_templates[0].name = ""; },
      "the edited wording lost its words": (db) => { db.contract_templates[0].body = ""; },
      "the editor is not staff in this company": (db) => { db.staff = []; },
      "a sent contract's words changed after it was sent": (db) => { db.contracts[0].rendered_body = "Edited after sending."; },
      "a sent contract has no fingerprint": (db) => { db.contracts[0].body_sha = null; }
    }
  },

  "contract-voided": {
    world() {
      const staff = { id: uid(), org_id: ORG };
      return {
        staff: [staff],
        contracts: [
          { id: uid(), org_id: ORG, status: "void", voided_at: "2026-10-01T00:00:00Z", void_reason: "Wrong client.", voided_by: staff.id, signed_at: null, is_demo: false },
          { id: uid(), org_id: ORG, status: "sent", voided_at: null, void_reason: null, voided_by: null, signed_at: null, is_demo: false }
        ]
      };
    },
    sample: 1,
    breaks: {
      "no void time": (db) => { db.contracts[0].voided_at = null; },
      "no reason": (db) => { db.contracts[0].void_reason = " "; },
      "the voider is not staff in this company": (db) => { db.staff = []; },
      "a signed contract was voided": (db) => { db.contracts[0].signed_at = "2026-09-30T00:00:00Z"; }
    }
  },

  "contract-sign-link": {
    world() {
      const words = "Sign this.";
      const contract = { id: uid(), org_id: ORG, status: "sent", is_demo: false, document_version_id: uid(), rendered_body: words, body_sha: sha(words), source_kind: "text", source_document_id: null, signing_order: "parallel" };
      return {
        contracts: [contract, { ...contract, id: uid(), status: "signed", document_version_id: null, rendered_body: null }],
        document_versions: [{ id: contract.document_version_id, org_id: ORG, checksum: sha(words) }],
        contract_signers: [
          { id: uid(), org_id: ORG, contract_id: contract.id, signer_index: 0, status: "sent" },
          { id: uid(), org_id: ORG, contract_id: contract.id, signer_index: 1, status: "pending" }
        ]
      };
    },
    sample: 1,
    breaks: {
      "no frozen copy": (db) => { db.contracts[0].document_version_id = null; },
      "the frozen copy row is gone": (db) => { db.document_versions = []; },
      "the frozen copy has no checksum": (db) => { db.document_versions[0].checksum = null; },
      "no words": (db) => { db.contracts[0].rendered_body = null; },
      "no fingerprint": (db) => { db.contracts[0].body_sha = null; },
      "the words changed after sending": (db) => { db.contracts[0].rendered_body = "Changed."; },
      "a PDF contract has no source file": (db) => { Object.assign(db.contracts[0], { source_kind: "pdf", source_document_id: null }); },
      "nobody can sign": (db) => { db.contract_signers.forEach((s) => { s.status = "signed"; }); },
      "the only open signer is stuck behind an earlier signer who has not signed": (db) => {
        db.contracts[0].signing_order = "sequential";
        db.contract_signers[0].status = "declined";
        db.contract_signers[1].status = "pending";
      }
    }
  },

  "contract-pdf-boxes": {
    world() {
      return {
        contract_templates: [{
          id: uid(), org_id: ORG, source_kind: "pdf", page_count: 2, is_demo: false,
          fields: [
            { id: "f1", page: 0, type: "text", signer: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.05, source: "manual" },
            { id: "f2", page: 1, type: "signature", signer: 0, x: 0.5, y: 0.8, w: 0.4, h: 0.1, source: "manual" }
          ]
        }, {
          id: uid(), org_id: ORG, source_kind: "text", page_count: null, is_demo: false, fields: []
        }]
      };
    },
    sample: 1,
    breaks: {
      "a box has no width": (db) => { delete db.contract_templates[0].fields[0].w; },
      "a box has zero height": (db) => { db.contract_templates[0].fields[0].h = 0; },
      "a box starts off the page": (db) => { db.contract_templates[0].fields[0].x = 1.4; },
      "a box has a negative position": (db) => { db.contract_templates[0].fields[0].y = -0.1; },
      "a box runs off the right edge": (db) => { Object.assign(db.contract_templates[0].fields[1], { x: 0.8, w: 0.4 }); },
      "a box runs off the bottom edge": (db) => { Object.assign(db.contract_templates[0].fields[1], { y: 0.95, h: 0.2 }); },
      "a box is on a page the file does not have": (db) => { db.contract_templates[0].fields[0].page = 2; },
      "a signature box is filled by the system": (db) => { db.contract_templates[0].fields[1].source = "today"; },
      "a position is words": (db) => { db.contract_templates[0].fields[0].x = "left"; }
    }
  }
});

Object.assign(WORLDS, {
  "content-tile-name": {
    world() {
      return { entitlement_catalog: [
        { id: uid(), org_id: ORG, code: "funding-snapshot", name: "Funding Snapshot", description: "See what you qualify for.", active: true },
        { id: uid(), org_id: ORG, code: "hidden-one", name: "", description: null, active: false } // hidden: clients never see it
      ] };
    },
    sample: 1,
    breaks: { "a showing tile has no name": (db) => { db.entitlement_catalog[0].name = "  "; } }
  },

  "content-tile-copy": {
    world() {
      return { entitlement_catalog: [
        { id: uid(), org_id: ORG, name: "A", description: "One clear line.", active: true },
        { id: uid(), org_id: ORG, name: "B", description: null, active: true } // no copy at all is allowed
      ] };
    },
    sample: 1,
    breaks: { "the copy is only spaces": (db) => { db.entitlement_catalog[0].description = "   "; } }
  },

  "content-save-changes": {
    world() {
      const video = { id: uid(), org_id: ORG, title: "Welcome", storage_key: "videos/welcome" };
      return {
        entitlement_catalog: [{ id: uid(), org_id: ORG, name: "Funding Snapshot", active: true }],
        content_videos: [video],
        content_tier_map: [{ org_id: ORG, tier_code: "default", video_id: video.id }]
      };
    },
    sample: 2,
    breaks: {
      "a showing tile has no name": (db) => { db.entitlement_catalog[0].name = ""; },
      "a tier points at a video that is gone": (db) => { db.content_videos = []; },
      "a tier points at a video in another company": (db) => { db.content_videos[0].org_id = OTHER_ORG; },
      "the video has no title": (db) => { db.content_videos[0].title = " "; },
      "the video has no stored object": (db) => { db.content_videos[0].storage_key = null; }
    }
  },

  "inquiry-bureau-call": {
    world() {
      const person = client();
      return {
        outbound_calls: [
          { id: uid(), org_id: ORG, client_id: person.id, kind: "inquiry_bureau", call_id: "call-1" },
          { id: uid(), org_id: ORG, client_id: uid(), kind: "other_call", call_id: "call-2" }
        ],
        pii_access_log: [{ id: uid(), org_id: ORG, client_id: person.id, field: "ssn (bureau_dispute_call)" }],
        inquiry_removal_cases: [{ id: uid(), org_id: ORG, client_id: person.id, call_fired_at: "2026-10-14T10:00:00Z" }],
        _client: person.id
      };
    },
    sample: 1,
    breaks: {
      "the number-reveal was never logged": (db) => { db.pii_access_log = []; },
      "the log entry is for another reason": (db) => { db.pii_access_log[0].field = "ssn"; },
      "the case was never marked fired, so the scheduler would call again": (db) => { db.inquiry_removal_cases[0].call_fired_at = null; },
      "the case is in another company": (db) => { db.inquiry_removal_cases[0].org_id = OTHER_ORG; }
    }
  },

  "repair-parse-confirmed": {
    world() {
      const staff = { id: uid(), org_id: ORG };
      return {
        staff: [staff],
        dispute_responses: [
          { id: uid(), org_id: ORG, confirmed: true, confidence: 0.6, parse_json: {}, confirmed_at: "2026-10-01T00:00:00Z", confirmed_by: staff.id },
          { id: uid(), org_id: ORG, confirmed: true, confidence: 0.99, parse_json: { heldForEscalation: true }, confirmed_at: "2026-10-01T00:00:00Z", confirmed_by: staff.id },
          { id: uid(), org_id: ORG, confirmed: true, confidence: 0.99, parse_json: {}, confirmed_at: null, confirmed_by: null } // machine-confirmed, sure
        ]
      };
    },
    sample: 2,
    breaks: {
      "no confirm time": (db) => { db.dispute_responses[0].confirmed_at = null; },
      "no confirming person": (db) => { db.dispute_responses[0].confirmed_by = null; },
      "the confirmer is not staff in this company": (db) => { db.staff = []; },
      "a held-for-escalation answer was confirmed by nobody": (db) => { db.dispute_responses[1].confirmed_by = null; }
    }
  },

  "climate-lead-saved": {
    world() {
      const person = client({ custom_fields: { home_state: "AZ" } });
      const event = (name, over = {}) => ({ id: uid(), org_id: ORG, name, client_id: person.id, payload: { source: "website:climate" }, is_demo: false, ...over });
      return {
        clients: [person],
        events: [event("entry.captured"), event("survey.submitted"), event("entry.captured", { payload: { source: "website:home" }, client_id: null })]
      };
    },
    sample: 1,
    breaks: {
      "the entry event has no client": (db) => { db.events[0].client_id = null; },
      "the client row is gone": (db) => { db.clients = []; },
      "the survey event is missing": (db) => { db.events = db.events.filter((e) => e.name !== "survey.submitted"); },
      "the survey event is for another source": (db) => { db.events[1].payload.source = "website:home"; },
      "the home state was never merged onto the client": (db) => { delete db.clients[0].custom_fields.home_state; },
      "the home state is a state name": (db) => { db.clients[0].custom_fields.home_state = "Arizona"; }
    }
  }
});

// Consent worlds (the words come from the server's own wording table, read here so the test follows it).
const DISPUTE_TEXT = String(disclosureFor("dispute_authorization", "dispute-auth-v1").text).trim();
const CALL_TEXT = String(disclosureFor("call_recording", "call-recording-v1").text).trim();

Object.assign(WORLDS, {
  "consent-wording-matches-server": {
    world() {
      return { client_consents: [
        consentRow({ consent_text: ` ${DISPUTE_TEXT} ` }),
        consentRow({ kind: "call_recording", consent_version: "call-recording-v1", consent_text: CALL_TEXT, capture_method: "typed" }),
        consentRow({ kind: "soft_pull_consent", consent_version: "soft-pull-v9", consent_text: "anything" }) // not a kind this check judges
      ] };
    },
    sample: 2,
    breaks: {
      "the stored words differ from the server's words": (db) => { db.client_consents[0].consent_text = `${DISPUTE_TEXT} Also anything else.`; },
      "the stored words are the body's own paragraph": (db) => { db.client_consents[1].consent_text = "A paragraph typed into the request body."; },
      "the version is not one the server holds": (db) => { db.client_consents[0].consent_version = "dispute-auth-v99"; },
      "no version was stored": (db) => { db.client_consents[1].consent_version = null; }
    }
  },

  "dispute-authorization-signed": {
    world() {
      const person = client();
      const own = { id: ACCOUNT, org_id: ORG, client_id: person.id };
      return {
        clients: [person], accounts: [own],
        client_consents: [consentRow({ client_id: person.id, consent_text: DISPUTE_TEXT }), consentRow({ client_id: person.id, granted_by_kind: "staff", granted_by_account_id: null, consent_text: "staff entered" })],
        client_authorized_reps: []
      };
    },
    sample: 1,
    breaks: {
      "the signing login is not in this company": (db) => { db.accounts[0].org_id = OTHER_ORG; },
      "the signer is another client's login": (db) => { db.accounts[0].client_id = uid(); },
      "the stored words are not the server's": (db) => { db.client_consents[0].consent_text = "A different paragraph."; },
      "the version is unknown": (db) => { db.client_consents[0].consent_version = "dispute-auth-v7"; }
    },
    stillGreen: {
      "an authorized representative linked to the file signed": (db) => {
        const rep = uid();
        db.accounts[0] = { id: ACCOUNT, org_id: ORG, client_id: null };
        db.client_authorized_reps.push({ id: uid(), org_id: ORG, account_id: ACCOUNT, client_id: db.clients[0].id, removed_at: null });
        void rep;
      }
    }
  }
});

test("every check has a stand-in world and a break list", () => {
  const keys = FIN_B06_CHECKS.map((entry) => entry.key).sort();
  assert.deepEqual(Object.keys(WORLDS).sort(), keys);
  for (const [key, spec] of Object.entries(WORLDS)) {
    assert.ok(Object.keys(spec.breaks).length >= 1, `${key}: needs at least one break`);
  }
});

test("each check is green on a good world and the sample is real, not vacuous", () => {
  for (const [key, spec] of Object.entries(WORLDS)) {
    const out = run(key, spec.world());
    assert.equal(out.bad_count, 0, `${key}: good world must not be red`);
    assert.equal(out.sample_count, spec.sample, `${key}: expected ${spec.sample} saved results in the good world`);
  }
});

test("each check goes red on every deliberate break, and only that break", () => {
  let breaks = 0;
  for (const [key, spec] of Object.entries(WORLDS)) {
    for (const [label, mutate] of Object.entries(spec.breaks)) {
      const db = clone(spec.world());
      mutate(db);
      const out = run(key, db);
      assert.ok(out.bad_count >= 1, `${key}: stayed green when "${label}"`);
      breaks += 1;
    }
    for (const [label, mutate] of Object.entries(spec.stillGreen || {})) {
      const db = clone(spec.world());
      mutate(db);
      const out = run(key, db);
      assert.equal(out.bad_count, 0, `${key}: wrongly red when "${label}"`);
    }
  }
  assert.ok(breaks >= 150, `expected a broad set of breaks, ran ${breaks}`);
});

test("another company's rows are never counted", () => {
  for (const [key, spec] of Object.entries(WORLDS)) {
    const db = clone(spec.world());
    for (const [table, rows] of Object.entries(db)) {
      if (Array.isArray(rows)) rows.forEach((row) => { if (row && row.org_id === ORG) row.org_id = OTHER_ORG; });
      void table;
    }
    assert.equal(run(key, db).sample_count, 0, `${key}: counted another company's rows`);
  }
});

test("a control nobody has used yet is green and says so", () => {
  for (const entry of FIN_B06_CHECKS) {
    const empty = judgeCheck(entry.parts, { now: NOW }, ORG);
    assert.deepEqual(empty, { sample_count: 0, bad_count: 0 }, entry.key);
    const out = judgeDisplayResult({ id: entry.key, surface: "s", control: entry.control, contract: entry.contract }, empty);
    assert.equal(out.status, "PASS", entry.key);
    assert.match(out.detail, /no saved results yet/);
    const red = judgeDisplayResult({ id: entry.key, surface: "s", control: entry.control, contract: entry.contract }, { sample_count: 3, bad_count: 1 });
    assert.equal(red.status, "FAIL", entry.key);
    assert.match(red.detail, /1 of 3/);
  }
});

test("every SQL is one read-only select scoped to one company, with real tables and columns", () => {
  const schema = loadSchema();
  assert.ok(schema.size > 200, "the schema reader found the migrations");
  const seen = new Set();
  for (const entry of FIN_B06_CHECKS) {
    const sql = entry.contract.sql;
    assert.ok(!seen.has(sql), `${entry.key}: duplicate SQL`);
    seen.add(sql);
    assert.match(sql, new RegExp(`/\\* display-result:${entry.key} \\*/`));
    assert.match(sql, /sample_count/);
    assert.match(sql, /bad_count/);
    assert.match(sql, /\$1::uuid/);
    assert.doesNotMatch(sql.replace(/\/\*[\s\S]*?\*\//g, ""), /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|SET)\b(?!\s*\()/i);
    assert.ok(/^\/\*[^*]*\*\/\s*SELECT\b/.test(sql), `${entry.key}: must start with a select`);
    // Every base table is filtered to the company in $1.
    for (const p of entry.parts) {
      assert.ok(sql.includes(` WHERE ${p.alias}.org_id = $1::uuid`), `${entry.key}: ${p.table} must be scoped to the company`);
    }
    assert.deepEqual(schemaProblems(sql, schema), [], `${entry.key}: names a table or column that does not exist`);
  }
});

test("the schema reader refuses a made-up column and a made-up table", () => {
  const schema = loadSchema();
  assert.deepEqual(schemaProblems("SELECT 1 FROM clients c WHERE c.no_such_column = 1", schema), ["clients (c) has no column no_such_column"]);
  assert.deepEqual(schemaProblems("SELECT 1 FROM no_such_table t WHERE t.id = 1", schema), ["table no_such_table is not in db/schema or db/migrations"]);
});

test("a wrong column in a check would be caught before it ships", () => {
  const schema = loadSchema();
  const broken = checkByKey("proxy-apply-session").contract.sql.replace("p.exit_ip", "p.exit_address");
  assert.ok(schemaProblems(broken, schema).some((line) => /exit_address/.test(line)));
});

test("the not-attachable controls say exactly what is missing and stay not proved without the live page", () => {
  assert.equal(FIN_B06_GAPS.length, 1);
  for (const entry of FIN_B06_GAPS) {
    assert.equal(entry.mode, "always-red");
    assert.equal(entry.sql, null);
    assert.ok(entry.requirement.length > 60, entry.control);
    // The pure judge never touches the network, so it never says "na". Only the lane's live read can.
    const out = judgeDisplayResult({ id: "x", surface: "s", control: entry.control, contract: entry }, { sample_count: 9, bad_count: 0 });
    assert.equal(out.status, "NOT_PROVED");
    assert.equal(entry.notShipped.path, "/climate/");
    assert.ok(entry.notShipped.markers.includes("climate-match"));
  }
});

// ── wiring ─────────────────────────────────────────────────────────────────────────────────────────────

function mapRows() {
  const out = [];
  for (const file of ["desks-a.json", "desks-b.json", "desks-c.json", "public-pages.json"]) {
    for (const row of JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8"))) {
      if (!row.repeats_row_in) out.push({ ...row, sourceFile: file });
    }
  }
  return out;
}

test("each control text matches exactly one screen row, and the registry hands back its contract", () => {
  const rows = mapRows();
  assert.equal(FIN_B06_DISPLAY_CONTRACTS.length, 36);
  for (const entry of FIN_B06_DISPLAY_CONTRACTS) {
    const hits = rows.filter((row) => row.control === entry.control);
    assert.equal(hits.length, 1, `${entry.control.slice(0, 60)}: matched ${hits.length} rows`);
    assert.equal(hits[0].impact, "customerData");
    assert.equal(displaySavedResultContract(hits[0]), entry);
  }
});

test("the lane judges every check from the saved catalog: green, red on a wrong result, and not proved for the gaps", async () => {
  const mine = new Map(FIN_B06_DISPLAY_CONTRACTS.map((entry) => [entry.control, entry]));
  const cases = DISPLAY_TRACKING_CASES.filter((entry) => mine.has(entry.control));
  assert.equal(cases.length, FIN_B06_DISPLAY_CONTRACTS.length);
  assert.equal(DISPLAY_RESULT_CASES.filter((entry) => mine.has(entry.control)).length, FIN_B06_DISPLAY_CONTRACTS.length);

  const bySql = (sql) => (/display-result:([^*\s]+)/.exec(sql) || [])[1];
  const redKeys = new Set(["blueprint-credit-partner"]);
  const db = {
    async query(sql) {
      const key = bySql(sql);
      return { rows: [{ sample_count: redKeys.has(key) ? 4 : 2, bad_count: redKeys.has(key) ? 1 : 0 }] };
    }
  };
  // The real shipped files under public/ stand in for the live site (GET only, redirects not followed).
  const publicDir = path.join(ROOT, "public");
  const liveSite = async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    let p = decodeURIComponent(new URL(url).pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(publicDir, p);
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? new Response(fs.readFileSync(file, "utf8"), { status: 200 })
      : new Response("not found", { status: 404 });
  };
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: liveSite });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const entry of cases) {
    const row = byId.get(entry.id);
    assert.ok(row, entry.control);
    if (entry.contract.mode === "always-red") {
      // The climate button is on no page that ships: the lane reads the live page and says "na", and the audit
      // re-checks that every run (see src/pulse/coverage/fin-b06-not-shipped.test.mjs). A contract with no claim
      // would stay NOT_PROVED.
      assert.equal(row.status, entry.contract.notShipped ? "na" : "NOT_PROVED", `${entry.control}: ${row.detail}`);
      continue;
    }
    const key = bySql(entry.contract.sql);
    assert.equal(row.status, redKeys.has(key) ? "FAIL" : "PASS", `${key}: ${row.detail}`);
  }
});

test("the four practice-tested controls are direct proofs: not in the live lane, and no contract claims them twice", () => {
  assert.equal(FIN_B06_DISPLAY_PROOF_CASES.length, 4);
  const rows = mapRows();
  for (const entry of FIN_B06_DISPLAY_PROOF_CASES) {
    const hits = rows.filter((row) => row.sourceFile === entry.sourceFile && row.surface === entry.surface && row.control === entry.control);
    assert.equal(hits.length, 1, entry.control);
    assert.equal(displaySavedResultContract(hits[0]), null, `${entry.control}: also has a saved-result contract`);
    assert.equal(DISPLAY_TRACKING_CASES.some((item) => item.control === entry.control), false, `${entry.control}: still judged by the live lane`);
    const kept = DISPLAY_PROOF_CASES.find((item) => item.control === entry.control && item.surface === entry.surface);
    assert.equal(kept.evidence, "src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs");
    assert.equal(kept.depth, "deep");
  }
});
