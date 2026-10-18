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
import { c as column, judgeCheck, realDay } from "./fin-b06-sql-kit.mjs";
import { loadSchema, schemaProblems } from "./fin-b06-schema.mjs";
import { runPrintedSql } from "./fin-b06-sqlite.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import {
  FIN_B06_DISPLAY_PRACTICE_ALSO_LIVE_CONTROLS, FIN_B06_DISPLAY_PRACTICE_CONTROLS, FIN_B06_DISPLAY_PROOF_CASES
} from "./fin-b06-display-practice.mjs";
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
const buyerTx = (clientId, code = BLUEPRINT, status = "succeeded") => ({ org_id: ORG, client_id: clientId, _product_code: code, status });

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
      "the primary client never bought the Blueprint": (db) => { db.transactions = [buyerTx(db.clients[0].id, "repair-trial")]; },
      "the primary client's only Blueprint order failed": (db) => { db.transactions = [buyerTx(db.clients[0].id, BLUEPRINT, "failed")]; },
      "the primary client's only Blueprint order is pending": (db) => { db.transactions = [buyerTx(db.clients[0].id, BLUEPRINT, "pending")]; }
    }
  },

  "blueprint-ready-date": {
    world() {
      const buyer = client({ updated_at: "2026-10-14T11:00:00Z" });
      // A buyer whose day is well past and whose record has been still for days: the sweep must have made the task.
      const past = client({
        custom_fields: { blueprint_next_sequence_ready_date: "2026-10-01" }, updated_at: "2026-10-05T00:00:00Z"
      });
      return {
        clients: [
          { ...buyer, custom_fields: { blueprint_next_sequence_ready_date: "2026-11-02" } },
          past,
          client({ custom_fields: {} }) // never saved a date: not part of the sample
        ],
        transactions: [buyerTx(buyer.id), buyerTx(past.id)],
        tasks: [
          { id: uid(), org_id: ORG, client_id: past.id, source_workflow: "blueprint-next-funding-sequence", body: `blueprint-next-sequence:${past.id}:2026-10-01` },
          // another workflow's task on the same client is not the sweep's
          { id: uid(), org_id: ORG, client_id: past.id, source_workflow: "blueprint-coach", body: "other" }
        ]
      };
    },
    sample: 3,
    breaks: {
      "the saved day is not a day": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-13-40"; },
      "the saved day is words": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "next week"; },
      "the saved day is 31 February (a JavaScript date rolls it to March, Postgres refuses it)": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-02-31"; },
      "the saved day is 31 April": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-04-31"; },
      "the saved day is 31 June": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-06-31"; },
      "the saved day is 30 February": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2028-02-30"; },
      "the saved day is 29 February of a year that is not a leap year": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2027-02-29"; },
      "the saved day is 29 February of a century that is not a leap year": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2100-02-29"; },
      "the saved day has padding": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = " 2026-11-02"; },
      "the client never bought the Blueprint": (db) => { db.transactions = []; },
      "the client's only Blueprint order failed": (db) => { db.transactions = [buyerTx(db.clients[0].id, BLUEPRINT, "failed")]; },
      "the sweep never made the closer task for a past day": (db) => { db.tasks = []; },
      "the closer task is for another day": (db) => { db.tasks[0].body = `blueprint-next-sequence:${db.clients[1].id}:2026-09-30`; },
      "the closer task is for another client": (db) => { db.tasks[0].client_id = uid(); },
      "the closer task is from another workflow": (db) => { db.tasks[0].source_workflow = "blueprint-coach"; },
      "the closer task is in another company": (db) => { db.tasks[0].org_id = OTHER_ORG; },
      "the closer task body is the day with no client in it": (db) => { db.tasks[0].body = "blueprint-next-sequence:2026-10-01"; }
    },
    stillGreen: {
      "29 February of a leap year": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2028-02-29"; },
      "29 February of a leap century": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2000-02-29"; },
      "31 December": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-12-31"; },
      "30 April": (db) => { db.clients[0].custom_fields.blueprint_next_sequence_ready_date = "2026-04-30"; },
      "a day only one day past, no task yet (the daily sweep has not had a whole run)": (db) => {
        db.clients[1].custom_fields.blueprint_next_sequence_ready_date = "2026-10-13";
        db.tasks = [];
      },
      "a day exactly two days past with its task": (db) => {
        db.clients[1].custom_fields.blueprint_next_sequence_ready_date = "2026-10-12";
        db.tasks[0].body = `blueprint-next-sequence:${db.clients[1].id}:2026-10-12`;
      },
      "a past day, no task, but the record changed 10 hours ago (the save may be that recent)": (db) => {
        db.clients[1].updated_at = "2026-10-14T02:00:00Z";
        db.tasks = [];
      }
    }
  },

  "blueprint-tracker-offered": {
    world() {
      const buyer = client({ custom_fields: { blueprint_bank_tracker_offered: "true" } });
      return { clients: [buyer], transactions: [buyerTx(buyer.id)] };
    },
    sample: 1,
    breaks: {
      "the flagged client never bought the Blueprint": (db) => { db.transactions = []; },
      "the flagged client's only Blueprint order failed": (db) => { db.transactions = [buyerTx(db.clients[0].id, BLUEPRINT, "failed")]; },
      "the flagged client's only Blueprint order is pending": (db) => { db.transactions = [buyerTx(db.clients[0].id, BLUEPRINT, "pending")]; }
    }
  },

  "blueprint-tracker-taken-back": {
    world() {
      const buyer = client({ custom_fields: { blueprint_bank_tracker_offered: "false" } });
      const other = client({ custom_fields: { blueprint_bank_tracker_offered: "true" } }); // offered, not taken back
      return { clients: [buyer, other], transactions: [buyerTx(buyer.id), buyerTx(other.id)] };
    },
    sample: 1,
    breaks: {
      "the client never bought the Blueprint": (db) => { db.transactions = db.transactions.slice(1); },
      "the client's only Blueprint order failed": (db) => { db.transactions[0].status = "failed"; },
      "the client's only Blueprint order is pending": (db) => { db.transactions[0].status = "pending"; }
    }
  },

  "blueprint-bank-todo": {
    world() {
      const offered = client({ custom_fields: { blueprint_bank_tracker_offered: "true" } });
      const takenBack = client({ custom_fields: { blueprint_bank_tracker_offered: "false" } });
      const planned = client({ custom_fields: {} });
      return {
        clients: [offered, takenBack, planned],
        transactions: [buyerTx(offered.id), buyerTx(takenBack.id)],
        blueprint_bank_relationship_todos: [
          // the Add-bank button: no bank_name, on an offered buyer
          { id: uid(), org_id: ORG, client_id: offered.id, bank_key: "us bank", account_kind: "personal", state: "open", bank_name: null, notes: "Call Monday." },
          // the offer was taken back after the row was added: the row stays and is not wrong
          { id: uid(), org_id: ORG, client_id: takenBack.id, bank_key: "chase", account_kind: "business", state: "done", bank_name: null, notes: null },
          // FinanceOS wrote this one (it has a bank name and no offer gate): another control, not judged for the offer
          { id: uid(), org_id: ORG, client_id: planned.id, bank_key: "wells fargo", account_kind: "personal", state: "open", bank_name: "Wells Fargo", notes: "  padded by another writer  " }
        ]
      };
    },
    sample: 3,
    breaks: {
      "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
      "the bank key was saved in capitals": (db) => { db.blueprint_bank_relationship_todos[0].bank_key = "US Bank"; },
      "the bank key has padding": (db) => { db.blueprint_bank_relationship_todos[0].bank_key = " us bank "; },
      "the tracker was never offered to this client (the save is refused with 409)": (db) => { delete db.clients[0].custom_fields.blueprint_bank_tracker_offered; },
      "the tracker flag is empty": (db) => { db.clients[0].custom_fields.blueprint_bank_tracker_offered = null; },
      "the client never bought the Blueprint": (db) => { db.transactions = db.transactions.filter((tx) => tx.client_id !== db.clients[0].id); },
      "the client's only Blueprint order failed": (db) => { db.transactions[0].status = "failed"; }
    },
    stillGreen: {
      "the offer was taken back and a row from before stays": (db) => { db.clients[1].custom_fields.blueprint_bank_tracker_offered = "false"; },
      "no note at all": (db) => { db.blueprint_bank_relationship_todos[0].notes = null; },
      // The handler stores the note as given and never trims it, so a padded note is a result a direct call may
      // legitimately leave. What the page sends is a practice test of the page, not a saved-row clause.
      "a note with padding (a direct call, the handler allows it)": (db) => { db.blueprint_bank_relationship_todos[0].notes = " Call Monday. "; },
      "a note of only spaces (a direct call, the handler allows it)": (db) => { db.blueprint_bank_relationship_todos[0].notes = "   "; }
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

// Upload doors share one world builder. The file the door wrote carries generated_by "<sender>:<id>", a label, the
// sender's id in its metadata, and one docs.received announcement.
const PDF = "application/pdf";
function documentWorld(kind, uploader, { selected }) {
  return () => {
    const person = client();
    const sender = { id: uid(), org_id: ORG, ...(uploader === "client" ? { client_id: person.id } : {}) };
    const version = { id: uid(), org_id: ORG, storage_key: "k/abc", checksum: "sha256:aa", byte_size: 1200, mime_type: PDF };
    const document = {
      id: uid(), org_id: ORG, client_id: person.id, kind, subtype: "bank_statement", is_demo: false,
      created_at: "2026-10-10T10:00:00Z",
      generated_by: `${uploader}:${sender.id}`,
      current_version_id: version.id, storage_key: "k/abc", checksum: "sha256:aa",
      metadata: {
        uploaded_by: { kind: uploader, id: sender.id },
        label: selected ? { given: "bank_statement", filed_as: "bank_statement", source: "given" } : { given: null, filed_as: "other", source: "none_given" }
      }
    };
    if (!selected) document.subtype = "other";
    version.document_id = document.id;
    const other = uploader === "staff" ? "client" : "staff";
    // Another door's file of the same kind: not this door's.
    const elsewhere = { ...document, id: uid(), generated_by: `${other}:y`, metadata: { uploaded_by: { kind: other, id: "y" }, label: { given: "x", filed_as: "other", source: "unrecognised" } }, current_version_id: null };
    // A phone-text intake file: kind client_upload, no label, no uploader prefix. Another control.
    const textIntake = { ...document, id: uid(), generated_by: "inbound-mms", metadata: { uploaded_by: { kind: "client", id: "z" }, classified_by: null }, current_version_id: null };
    return {
      clients: [person],
      documents: [document, elsewhere, textIntake],
      document_versions: [version],
      ...(uploader === "client" ? { accounts: [sender], staff: [] } : { staff: [sender], accounts: [] }),
      client_authorized_reps: [],
      events: [
        { id: uid(), org_id: ORG, name: "docs.received", client_id: person.id, payload: { document_id: document.id, client_id: person.id } },
        // another event on the same client is not this file's announcement
        { id: uid(), org_id: ORG, name: "entry.captured", client_id: person.id, payload: { document_id: document.id } }
      ],
      _sender: sender.id
    };
  };
}
const DOCUMENT_BREAKS = {
  "the current version is missing": (db) => { db.document_versions = []; },
  "the version has no stored object": (db) => { db.document_versions[0].storage_key = ""; },
  "the document row points at a different object": (db) => { db.documents[0].storage_key = "k/other"; },
  "the version has no checksum": (db) => { db.document_versions[0].checksum = null; },
  "the document checksum differs from the version": (db) => { db.documents[0].checksum = "sha256:bb"; },
  "the file is zero bytes": (db) => { db.document_versions[0].byte_size = 0; },
  "the file has no size": (db) => { db.document_versions[0].byte_size = null; },
  "the file is 80 MB (over the 10 MB the door accepts)": (db) => { db.document_versions[0].byte_size = 80_000_000; },
  "the file is an html page that got past the type gate": (db) => { db.document_versions[0].mime_type = "text/html"; },
  "the file has no type": (db) => { db.document_versions[0].mime_type = null; },
  "the file is a plain text page": (db) => { db.document_versions[0].mime_type = "text/plain"; },
  "the client is in another company": (db) => { db.clients[0].org_id = OTHER_ORG; },
  "it was filed under another type than the one labeled": (db) => { db.documents[0].subtype = "tax_return"; },
  "the sender was not recorded in the file's metadata": (db) => { delete db.documents[0].metadata.uploaded_by; },
  "the file names another kind of sender": (db) => { db.documents[0].metadata.uploaded_by.kind = db.documents[0].metadata.uploaded_by.kind === "staff" ? "client" : "staff"; },
  "the sender id is not a login or person of this company": (db) => { db.documents[0].metadata.uploaded_by.id = uid(); },
  "the sender is in another company": (db) => { [...(db.accounts || []), ...(db.staff || [])].forEach((row) => { row.org_id = OTHER_ORG; }); },
  "the label was never written (a file after the label shipped)": (db) => { delete db.documents[0].metadata.label; },
  "the server did not know the type and filed it as other": (db) => {
    Object.assign(db.documents[0].metadata.label, { given: "bureau_letter", filed_as: "other", source: "unrecognised" });
    db.documents[0].subtype = "other";
  },
  "the type the person picked is not the type it was filed under": (db) => {
    db.documents[0].metadata.label.given = "tax_return";
  },
  "the file was stored and never announced (no docs.received event)": (db) => { db.events = db.events.filter((e) => e.name !== "docs.received"); },
  "the announcement is on another client's file": (db) => { db.events[0].client_id = uid(); },
  "the announcement names another document": (db) => { db.events[0].payload.document_id = uid(); },
  "the announcement is in another company": (db) => { db.events[0].org_id = OTHER_ORG; },
  "the only event on the client is another event that names the document": (db) => { db.events = db.events.filter((e) => e.name !== "docs.received"); }
};
const DOOR_STILL_GREEN = {
  "a client sent the file and picked no type (the select is optional): filed as other, nothing was chosen": (db) => {
    Object.assign(db.documents[0].metadata.label, { given: null, filed_as: "other", source: "none_given" });
    db.documents[0].subtype = "other";
  },
  "a file from before the label shipped, with no label": (db) => {
    delete db.documents[0].metadata.label;
    db.documents[0].created_at = "2026-08-20T10:00:00Z";
  },
  "the person picked other and it was filed as other": (db) => {
    Object.assign(db.documents[0].metadata.label, { given: "other", filed_as: "other", source: "given" });
    db.documents[0].subtype = "other";
  },
  "a jpg and a png are accepted types": (db) => { db.document_versions[0].mime_type = "image/jpeg"; },
  "a file of exactly the 10 MB the door accepts": (db) => { db.document_versions[0].byte_size = 10 * 1024 * 1024; }
};
// A client login may file on its own file or on one it is an authorized representative of. A staff door has no such rule.
const CLIENT_DOOR_BREAKS = {
  "a client login filed a paper on ANOTHER client's file": (db) => { db.accounts[0].client_id = uid(); },
  "an authorized representative filed on a file they are not linked to": (db) => {
    db.accounts[0].client_id = null;
    db.client_authorized_reps = [{ id: uid(), org_id: ORG, account_id: db.accounts[0].id, client_id: uid(), removed_at: null }];
  },
  "a representative was linked to another company's file with the same id": (db) => {
    db.accounts[0].client_id = null;
    db.client_authorized_reps = [{ id: uid(), org_id: OTHER_ORG, account_id: db.accounts[0].id, client_id: db.clients[0].id, removed_at: null }];
  }
};
const CLIENT_DOOR_STILL_GREEN = {
  "an authorized representative linked to the file filed on it": (db) => {
    db.accounts[0].client_id = null;
    db.client_authorized_reps = [{ id: uid(), org_id: ORG, account_id: db.accounts[0].id, client_id: db.clients[0].id, removed_at: null }];
  },
  "a representative whose link was taken off afterwards (the file was filed while linked)": (db) => {
    db.accounts[0].client_id = null;
    db.client_authorized_reps = [{ id: uid(), org_id: ORG, account_id: db.accounts[0].id, client_id: db.clients[0].id, removed_at: "2026-10-12T00:00:00Z" }];
  }
};
for (const [key, kind, uploader, selected] of [
  ["documents-staff-dropzone", "client_upload", "staff", false],
  ["documents-door-identity", "client_upload", "client", true],
  ["documents-door-inquiry", "inquiry_doc", "client", true],
  ["documents-door-bureau", "bureau_response", "client", true]
]) {
  const client_ = uploader === "client";
  WORLDS[key] = {
    world: documentWorld(kind, uploader, { selected }),
    sample: 1,
    breaks: { ...DOCUMENT_BREAKS, ...(client_ ? CLIENT_DOOR_BREAKS : {}) },
    stillGreen: { ...DOOR_STILL_GREEN, ...(client_ ? CLIENT_DOOR_STILL_GREEN : {}) }
  };
}

// Every deliverable subtype the portal can hand over (src/documents/kinds.mjs SUBTYPES.deliverable).
const DELIVERABLE_SUBTYPES = [
  "credit_analysis_report", "metro2_dispute_letter_pack", "credit_optimization_roadmap", "funding_snapshot",
  "bank_lender_match_list", "business_duplication_map", "funding_inquiry_removal", "funding_personal_info",
  "cfpb_complaint", "state_ag_complaint", "furnisher_validation"
];

Object.assign(WORLDS, {
  "documents-download-link": {
    world() {
      const versions = [];
      const documents = DELIVERABLE_SUBTYPES.map((subtype) => {
        const version = { id: uid(), org_id: ORG, storage_key: `k/${subtype}`, checksum: `sha256:${subtype.length}a` };
        const document = { id: uid(), org_id: ORG, kind: "deliverable", subtype, is_demo: false, expires_at: null, current_version_id: version.id, storage_key: `k/${subtype}`, checksum: `sha256:${subtype.length}a` };
        version.document_id = document.id;
        versions.push(version);
        return document;
      });
      const unrelated = { id: uid(), org_id: ORG, kind: "invoice_document", subtype: "deposit_invoice", is_demo: false, current_version_id: null, storage_key: "" };
      return { documents: [...documents, unrelated], document_versions: versions };
    },
    sample: DELIVERABLE_SUBTYPES.length,
    breaks: {
      "no current version": (db) => { db.documents[0].current_version_id = null; },
      "the document has no stored object": (db) => { db.documents[0].storage_key = ""; },
      "the version has no stored object": (db) => { db.document_versions[0].storage_key = null; },
      "the document row names a different object than its current version": (db) => { db.documents[0].storage_key = "k/old-version-object"; },
      "the current version has no checksum, so the download is never verified": (db) => { db.document_versions[0].checksum = null; },
      "the current version has a blank checksum": (db) => { db.document_versions[0].checksum = "  "; },
      "the document row's checksum is another file's": (db) => { db.documents[0].checksum = "sha256:ffff"; },
      // Each subtype on its own. The check once judged only the first five; the later subtypes are letters and complaints.
      ...Object.fromEntries(DELIVERABLE_SUBTYPES.map((subtype, index) => [
        `a ${subtype} deliverable has no stored object`,
        (db) => { db.document_versions[index].storage_key = " "; }
      ])),
      "a deliverable that expires later has no stored object": (db) => {
        db.documents[7].expires_at = "2030-01-01T00:00:00Z";
        db.document_versions[7].storage_key = null;
      }
    },
    stillGreen: {
      "an expired deliverable has no stored object (the portal gives an expired file no link on purpose)": (db) => {
        db.documents[7].expires_at = "2026-01-01T00:00:00Z";
        db.document_versions[7].storage_key = null;
        db.documents[7].current_version_id = null;
      }
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
      const staff = { id: uid(), org_id: ORG, role: "admin" };
      const words = "Frozen contract words.";
      const made = "2026-09-01T10:00:00Z";
      const edited = "2026-10-01T10:00:00Z";
      const migrated = "2026-09-20T09:00:01Z";
      const frozen = (status, over = {}) => {
        const version = { id: uid(), org_id: ORG, checksum: sha(words) };
        return {
          version,
          contract: { id: uid(), org_id: ORG, status, rendered_body: words, body_sha: sha(words), document_version_id: version.id, is_demo: false, ...over }
        };
      };
      const sent = frozen("sent"); const signed = frozen("signed"); const voided = frozen("void");
      return {
        staff: [staff],
        // a deploy ran a migration at 09:00 on 20 September
        schema_migrations: [{ key: "db/migrations/288_real_contract_text.sql", applied_at: "2026-09-20T09:00:00Z" }],
        contract_templates: [
          // a text wording a person edited
          { id: uid(), org_id: ORG, source_kind: "text", created_by: staff.id, updated_by: staff.id, created_at: made, updated_at: edited, is_demo: false },
          // an uploaded PDF wording whose boxes were edited
          { id: uid(), org_id: ORG, source_kind: "pdf", created_by: staff.id, updated_by: staff.id, created_at: made, updated_at: edited, is_demo: false },
          // a seeded wording a migration rewrote: updated_at moved at deploy time and no editor is recorded
          { id: uid(), org_id: ORG, source_kind: "text", created_by: staff.id, updated_by: null, created_at: made, updated_at: migrated, is_demo: false },
          // a wording nobody has edited
          { id: uid(), org_id: ORG, source_kind: "text", created_by: staff.id, updated_by: null, created_at: made, updated_at: made, is_demo: false }
        ],
        contracts: [sent.contract, signed.contract, voided.contract,
          // never sent: no frozen words yet
          { id: uid(), org_id: ORG, status: "draft", rendered_body: null, body_sha: null, document_version_id: null, is_demo: false }],
        document_versions: [sent.version, signed.version, voided.version]
      };
    },
    sample: 5,
    breaks: {
      "the editor is not staff in this company": (db) => { db.staff = []; },
      "the editor is staff in another company": (db) => { db.staff[0].org_id = OTHER_ORG; },
      "a closer edited legal wording (the handler refuses every role but owner and admin)": (db) => { db.staff[0].role = "closer"; },
      "an inquiry specialist edited legal wording": (db) => { db.staff[0].role = "inquiry_specialist"; },
      "the editor has no role at all": (db) => { db.staff[0].role = null; },
      "an edit stopped recording who made it (a text wording changed with no editor)": (db) => { db.contract_templates[0].updated_by = null; },
      "an uploaded PDF wording was saved with no editor": (db) => { db.contract_templates[1].updated_by = null; },
      "a wording was changed with no editor and no migration ran near that moment": (db) => {
        db.contract_templates[3].updated_at = "2026-10-05T12:00:00Z";
      },
      "a sent contract's words changed after it was sent": (db) => { db.contracts[0].rendered_body = "Edited after sending."; },
      "a sent contract has no fingerprint": (db) => { db.contracts[0].body_sha = null; },
      // The tamper that the row's own fingerprint cannot see: words and fingerprint rewritten together.
      "a sent contract's words and its row fingerprint were rewritten together": (db) => {
        db.contracts[0].rendered_body = "Quietly rewritten.";
        db.contracts[0].body_sha = sha("Quietly rewritten.");
      },
      "a SIGNED contract's words and its row fingerprint were rewritten together": (db) => {
        db.contracts[1].rendered_body = "Quietly rewritten.";
        db.contracts[1].body_sha = sha("Quietly rewritten.");
      },
      "a voided contract's words and its row fingerprint were rewritten together": (db) => {
        db.contracts[2].rendered_body = "Quietly rewritten.";
        db.contracts[2].body_sha = sha("Quietly rewritten.");
      },
      "a signed contract's row fingerprint no longer matches its words": (db) => { db.contracts[1].body_sha = sha("Another."); },
      "a signed contract has no frozen copy": (db) => { db.contracts[1].document_version_id = null; },
      "a signed contract's frozen copy is gone": (db) => { db.document_versions = db.document_versions.filter((v) => v.id !== db.contracts[1].document_version_id); },
      "a signed contract's frozen copy has no checksum": (db) => { db.document_versions[1].checksum = null; },
      "the frozen copy is in another company": (db) => { db.document_versions[0].org_id = OTHER_ORG; }
    },
    stillGreen: {
      "a seeded wording a migration rewrote has no editor": (db) => { db.contract_templates[2].updated_by = null; },
      "a wording a person made and never edited has no editor": (db) => { db.contract_templates[3].updated_by = null; },
      "a migration ran a few minutes after a staff edit of an unrecorded wording": (db) => {
        db.contract_templates[3].updated_at = "2026-09-20T09:03:00Z";
      },
      "the editor is an owner": (db) => { db.staff[0].role = "owner"; },
      "the editor's role has capitals and padding": (db) => { db.staff[0].role = " Admin "; },
      "a draft with no words has no fingerprint": (db) => { db.contracts[3].body_sha = null; }
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
      const other = client();
      const at = "2026-10-14T10:00:00Z";
      const call = (over = {}) => ({ id: uid(), org_id: ORG, client_id: person.id, kind: "inquiry_bureau", call_id: `call-${uid()}`, created_at: at, ...over });
      const reveal = (over = {}) => ({ id: uid(), org_id: ORG, client_id: person.id, accessed_by: "staff", field: "ssn (bureau_dispute_call)", created_at: "2026-10-14T09:59:58Z", ...over });
      const fired = (over = {}) => ({ id: uid(), org_id: ORG, client_id: person.id, call_fired_at: "2026-10-14T10:00:01Z", ...over });
      return {
        clients: [person, other],
        outbound_calls: [
          call(),
          // another kind of call is not judged here
          { id: uid(), org_id: ORG, client_id: other.id, kind: "other_call", call_id: "call-2", created_at: at }
        ],
        pii_access_log: [reveal()],
        inquiry_removal_cases: [fired()],
        _client: person.id,
        _other: other.id
      };
    },
    sample: 1,
    breaks: {
      "the number-reveal was never logged": (db) => { db.pii_access_log = []; },
      "the log entry is for another reason": (db) => { db.pii_access_log[0].field = "ssn"; },
      "the only reveal log is another client's": (db) => { db.pii_access_log[0].client_id = db._other; },
      "the only reveal log is in another company": (db) => { db.pii_access_log[0].org_id = OTHER_ORG; },
      "the only reveal log is from two days before the call (an old launch answering for this one)": (db) => {
        db.pii_access_log[0].created_at = "2026-10-12T10:00:00Z";
      },
      "the case was never marked fired, so the scheduler would call again": (db) => { db.inquiry_removal_cases[0].call_fired_at = null; },
      "the case is in another company": (db) => { db.inquiry_removal_cases[0].org_id = OTHER_ORG; },
      "the only stamped case is another client's": (db) => { db.inquiry_removal_cases[0].client_id = db._other; },
      // The checker's break: the scheduler stamped case B with no call, then Call bureau was pressed twice on case A.
      "two launches on one case, with another case the scheduler stamped fired and called nobody": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-again", created_at: "2026-10-14T11:30:00Z" });
        db.pii_access_log.push({ id: uid(), org_id: ORG, client_id: db._client, accessed_by: "staff", field: "ssn (bureau_dispute_call)", created_at: "2026-10-14T11:29:58Z" });
        db.inquiry_removal_cases.push({ id: uid(), org_id: ORG, client_id: db._client, call_fired_at: "2026-10-14T08:00:00Z" });
      },
      "a second launch on the same case placed a second call": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-again", created_at: "2026-10-14T11:00:00Z" });
        db.pii_access_log.push({ id: uid(), org_id: ORG, client_id: db._client, accessed_by: "staff", field: "ssn (bureau_dispute_call)", created_at: "2026-10-14T10:59:58Z" });
      },
      "a call was placed for a second case whose fired stamp never landed": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-case-b", created_at: "2026-10-14T11:00:00Z" });
        db.pii_access_log.push({ id: uid(), org_id: ORG, client_id: db._client, accessed_by: "staff", field: "ssn (bureau_dispute_call)", created_at: "2026-10-14T10:59:58Z" });
        db.inquiry_removal_cases.push({ id: uid(), org_id: ORG, client_id: db._client, call_fired_at: null });
      },
      "a second call whose reveal log was dropped (an earlier log exists for this client)": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-case-b", created_at: "2026-10-14T11:00:00Z" });
        db.inquiry_removal_cases.push({ id: uid(), org_id: ORG, client_id: db._client, call_fired_at: "2026-10-14T11:00:01Z" });
      },
      "a bad call from 10 days ago (the window is 30 days, not one)": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-old", created_at: "2026-10-04T11:00:00Z" });
      },
      "the stamp is an hour from the call": (db) => { db.inquiry_removal_cases[0].call_fired_at = "2026-10-14T11:00:00Z"; }
    },
    stillGreen: {
      "two cases, each stamped fired and each called once": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-case-b", created_at: "2026-10-14T11:00:00Z" });
        db.pii_access_log.push({ id: uid(), org_id: ORG, client_id: db._client, accessed_by: "staff", field: "ssn (bureau_dispute_call)", created_at: "2026-10-14T10:59:58Z" });
        db.inquiry_removal_cases.push({ id: uid(), org_id: ORG, client_id: db._client, call_fired_at: "2026-10-14T11:00:01Z" });
      },
      "a case the scheduler stamped fired with no call placed yet": (db) => {
        db.inquiry_removal_cases.push({ id: uid(), org_id: ORG, client_id: db._client, call_fired_at: "2026-10-14T09:00:00Z" });
      },
      "a call whose reveal log was written a few seconds after the call row": (db) => { db.pii_access_log[0].created_at = "2026-10-14T10:00:30Z"; },
      "an old unmatched call from before the 30 day window": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "inquiry_bureau", call_id: "call-old", created_at: "2026-08-01T11:00:00Z" });
      },
      "a call of another kind with no log and no stamp": (db) => {
        db.outbound_calls.push({ id: uid(), org_id: ORG, client_id: db._client, kind: "client_dial", call_id: "call-dial", created_at: "2026-10-14T11:00:00Z" });
      }
    }
  },

  "repair-parse-confirmed": {
    world() {
      const staff = { id: uid(), org_id: ORG };
      const person = client();
      const caseId = uid();
      const row = (over = {}) => ({
        id: uid(), org_id: ORG, client_id: person.id, case_id: caseId, confirmed: true, confidence: 0.99, parse_json: {},
        confirmed_at: "2026-10-01T00:00:00Z", confirmed_by: null, created_at: "2026-10-01T00:00:00Z", ...over
      });
      const confirmRecord = (over = {}) => ({
        id: uid(), org_id: ORG, client_id: person.id, case_id: caseId, decision: "parse.confirmed",
        payload: { confidence: 1, confirmedBy: staff.id, log: [] }, created_at: "2026-10-01T00:00:00Z", ...over
      });
      const stage = (key) => ({ id: uid(), key });
      const stalled = stage("stalled"); const analysis = stage("analysis");
      const optimization = { id: uid(), key: "optimization" }; const sales = { id: uid(), key: "sales" };
      const card = (stageRow, pipeline, over = {}) => ({
        id: uid(), org_id: ORG, client_id: person.id, stage_id: stageRow.id, pipeline_id: pipeline.id, is_demo: false,
        updated_at: "2026-10-14T08:00:00Z", ...over
      });
      return {
        staff: [staff], clients: [person],
        dispute_responses: [
          row({ confidence: 0.6, confirmed_by: staff.id }),
          row({ parse_json: { heldForEscalation: true }, confirmed_by: staff.id, confirmed_at: "2026-10-02T00:00:00Z" }),
          row(), // machine-confirmed, sure: not one that needed a person
          row({ confirmed: false, confirmed_at: null, confidence: 0.5, created_at: "2026-10-14T08:00:00Z" }) // waiting 4 hours: inside the clock
        ],
        // what the button writes: one entry per person-confirmed answer, naming that person
        repair_decision_log: [
          confirmRecord(),
          confirmRecord({ created_at: "2026-10-02T00:00:00Z", payload: { confidence: 1, confirmedBy: staff.id.toUpperCase(), log: [] } })
        ],
        pipeline_stages: [stalled, analysis],
        pipelines: [optimization, sales],
        cards: [
          card(stalled, optimization), // stuck 4 hours: inside the clock
          card(analysis, optimization, { updated_at: "2026-09-01T00:00:00Z" }) // not on Stalled: another check's
        ]
      };
    },
    sample: 6,
    breaks: {
      "no confirm time": (db) => { db.dispute_responses[0].confirmed_at = null; },
      "no confirming person": (db) => { db.dispute_responses[0].confirmed_by = null; },
      "the confirmer is not staff in this company": (db) => { db.staff = []; },
      "a held-for-escalation answer was confirmed by nobody": (db) => { db.dispute_responses[1].confirmed_by = null; },
      "an answer with no confidence at all was confirmed by nobody": (db) => { db.dispute_responses[2].confidence = null; },
      "a low-confidence answer sits unchecked past the 24 hour clock": (db) => { db.dispute_responses[3].created_at = "2026-10-13T08:00:00Z"; },
      "a held answer the list would hide (confident, not stamped held) sits unchecked for days": (db) => {
        Object.assign(db.dispute_responses[3], { confidence: 0.97, parse_json: {}, created_at: "2026-10-10T08:00:00Z" });
      },
      "an unchecked answer whose confirmed flag is empty sits past the clock": (db) => {
        Object.assign(db.dispute_responses[3], { confirmed: null, created_at: "2026-10-01T08:00:00Z" });
      },
      // "Mark as checked" flipped the flag and advanced nothing: no confirm record behind it.
      "a person confirmed an answer and no confirm record exists (nothing was advanced)": (db) => { db.repair_decision_log = []; },
      "only one of two person-confirmed answers has its confirm record": (db) => { db.repair_decision_log.pop(); },
      "the confirm record names another person": (db) => {
        db.repair_decision_log.forEach((r) => { r.payload.confirmedBy = uid(); });
      },
      "the confirm record is an older one by the same person on the same case (this answer's own was never written)": (db) => {
        db.repair_decision_log[1].created_at = "2026-09-15T00:00:00Z";
      },
      "the confirm record is for another case": (db) => { db.repair_decision_log.forEach((r) => { r.case_id = uid(); }); },
      "the confirm record is for another client": (db) => { db.repair_decision_log.forEach((r) => { r.client_id = uid(); }); },
      "the confirm record is in another company": (db) => { db.repair_decision_log.forEach((r) => { r.org_id = OTHER_ORG; }); },
      "the record is a different decision (the parse was only held)": (db) => {
        db.repair_decision_log.forEach((r) => { r.decision = "parse.held_low_confidence"; });
      },
      "a repair card sat on the Stalled stage for three days": (db) => { db.cards[0].updated_at = "2026-10-11T08:00:00Z"; },
      "a repair card sat on the Stalled stage for 25 hours": (db) => { db.cards[0].updated_at = "2026-10-13T10:00:00Z"; }
    },
    stillGreen: {
      "an old unchecked answer on a demo client": (db) => {
        db.clients[0].is_demo = true;
        Object.assign(db.dispute_responses[3], { created_at: "2026-09-01T08:00:00Z" });
      },
      "an unchecked answer 23 hours old": (db) => { db.dispute_responses[3].created_at = "2026-10-13T13:00:00Z"; },
      "a card on Stalled for 23 hours": (db) => { db.cards[0].updated_at = "2026-10-13T13:00:00Z"; },
      "an old card on Stalled that is a demo": (db) => { Object.assign(db.cards[0], { updated_at: "2026-08-01T00:00:00Z", is_demo: true }); },
      "an old card on Stalled whose client is a demo (the card was made before the mark existed)": (db) => {
        db.clients[0].is_demo = true;
        db.cards[0].updated_at = "2026-08-01T00:00:00Z";
        // the answer waiting on the demo client is left out too, so the sample is only the confirms
        db.dispute_responses[3].created_at = "2026-10-14T08:00:00Z";
      },
      "an old card on Stalled in another pipeline": (db) => {
        db.cards[0].pipeline_id = db.pipelines.find((p) => p.key === "sales").id;
        db.cards[0].updated_at = "2026-08-01T00:00:00Z";
      },
      "the confirmer id is written in capitals in the record": (db) => {
        db.repair_decision_log.forEach((r) => { r.payload.confirmedBy = db.staff[0].id.toUpperCase(); });
      }
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
const MARKETING_TEXT = String(disclosureFor("marketing_use", "marketing-use-v1").text).trim();
const SOFT_PULL_V1 = String(disclosureFor("soft_pull_consent", "soft-pull-v1").text).trim();
const SOFT_PULL_V2 = String(disclosureFor("soft_pull_consent", "soft-pull-v2").text).trim();
const SOFT_PULL_V3 = String(disclosureFor("soft_pull_consent", "soft-pull-v3").text).trim();

Object.assign(WORLDS, {
  "consent-wording-matches-server": {
    world() {
      const people = [client(), client(), client(), client()];
      const demo = client({ is_demo: true });
      return {
        clients: [...people, demo],
        client_consents: [
          consentRow({ client_id: people[0].id, consent_text: ` ${DISPUTE_TEXT} ` }),
          consentRow({ client_id: people[1].id, kind: "call_recording", consent_version: "call-recording-v1", consent_text: CALL_TEXT, capture_method: "typed" }),
          consentRow({ client_id: people[2].id, kind: "marketing_use", consent_version: "marketing-use-v1", consent_text: MARKETING_TEXT, capture_method: "typed" }),
          consentRow({ client_id: people[3].id, kind: "soft_pull_consent", consent_version: "soft-pull-v2", consent_text: SOFT_PULL_V2, capture_method: "typed", granted_at: "2026-10-05T00:00:00Z" }),
          // too old to judge: the wording table went in with the consent record, and older rows can predate it
          consentRow({ client_id: people[0].id, kind: "soft_pull_consent", consent_version: null, consent_text: "legacy words", granted_at: "2026-07-20T00:00:00Z" }),
          // a demo client's consent is not a real client's
          consentRow({ client_id: demo.id, kind: "soft_pull_consent", consent_version: "soft-pull-v9", consent_text: "demo words", granted_at: "2026-10-05T00:00:00Z" })
        ]
      };
    },
    sample: 4,
    breaks: {
      "the stored words differ from the server's words": (db) => { db.client_consents[0].consent_text = `${DISPUTE_TEXT} Also anything else.`; },
      "the stored words are the body's own paragraph": (db) => { db.client_consents[1].consent_text = "A paragraph typed into the request body."; },
      "the version is not one the server holds": (db) => { db.client_consents[0].consent_version = "dispute-auth-v99"; },
      "no version was stored": (db) => { db.client_consents[1].consent_version = null; },
      "a marketing use consent carries the caller's words": (db) => { db.client_consents[2].consent_text = "Anything you like, typed by the caller."; },
      "a marketing use consent names a version the server does not hold": (db) => { db.client_consents[2].consent_version = "marketing-use-v7"; },
      "a soft pull consent carries the caller's words": (db) => { db.client_consents[3].consent_text = "I agree to whatever I was shown."; },
      "a soft pull consent holds one version's words under another version's name": (db) => { db.client_consents[3].consent_text = SOFT_PULL_V1; },
      "a soft pull consent names a version the server does not hold": (db) => { db.client_consents[3].consent_version = "soft-pull-v9"; },
      "a recent soft pull consent stored no version": (db) => { db.client_consents[3].consent_version = null; },
      "a soft pull consent was saved with words and a version that disagree by one character": (db) => { db.client_consents[3].consent_text = SOFT_PULL_V2.replace("Fundhub", "Fundhub,"); }
    },
    stillGreen: {
      "a soft pull consent under version 1 carries version 1's words": (db) => { Object.assign(db.client_consents[3], { consent_version: "soft-pull-v1", consent_text: SOFT_PULL_V1 }); },
      "a soft pull consent under version 3 carries version 3's words": (db) => { Object.assign(db.client_consents[3], { consent_version: "soft-pull-v3", consent_text: SOFT_PULL_V3 }); },
      "an old soft pull consent with other words": (db) => { Object.assign(db.client_consents[3], { granted_at: "2026-07-15T00:00:00Z", consent_text: "older words", consent_version: null }); }
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

test("the printed SQL, run for real over the same stand-in rows, counts exactly what the judge counts", () => {
  // Same worlds, same breaks, same "still green" cases. The judge and the SQL are two renderings of one definition,
  // so this is what catches a typo or a wrong NULL rule that only shows in the SQL.
  let runs = 0;
  for (const [key, spec] of Object.entries(WORLDS)) {
    const entry = checkByKey(key);
    const cases = [["good world", (db) => db]];
    for (const [label, mutate] of Object.entries(spec.breaks)) cases.push([`break: ${label}`, (db) => { mutate(db); return db; }]);
    for (const [label, mutate] of Object.entries(spec.stillGreen || {})) cases.push([`still green: ${label}`, (db) => { mutate(db); return db; }]);
    for (const [label, apply] of cases) {
      const db = { now: NOW, ...apply(clone(spec.world())) };
      const judged = judgeCheck(entry.parts, db, ORG);
      const ran = runPrintedSql(entry.contract.sql, db, { orgId: ORG, nowIso: NOW });
      assert.deepEqual(ran, judged, `${key} / ${label}: the SQL counts ${JSON.stringify(ran)}, the judge counts ${JSON.stringify(judged)}`);
      runs += 1;
    }
  }
  assert.ok(runs >= 250, `ran ${runs} cases`);
});

test("a real calendar day is the same answer in JavaScript, in the SQL, and against the calendar itself", () => {
  const judge = realDay(column("c", "v"));
  const days = [];
  for (const year of [1900, 1999, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2099, 2100, 2101]) {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 31; day += 1) {
        const text = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const at = new Date(`${text}T00:00:00Z`);
        const real = !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text;
        days.push([text, real]);
      }
    }
  }
  for (const text of ["0000-01-01", "2026-00-10", "2026-13-01", "2026-01-00", "2026-1-5", "26-01-05", " 2026-01-05", "2026-01-05 ", "2026/01/05", "next week", ""]) {
    days.push([text, false]);
  }
  const entry = checkByKey("blueprint-ready-date");
  const rows = days.filter(([text]) => text !== "").map(([text]) => ({ id: uid(), org_id: ORG, is_demo: false, custom_fields: { blueprint_next_sequence_ready_date: text } }));
  const buyers = rows.map((row) => ({ org_id: ORG, client_id: row.id, _product_code: BLUEPRINT, status: "succeeded" }));
  const db = { now: NOW, clients: rows, transactions: buyers };
  const byId = new Map(rows.map((row) => [row.id, row.custom_fields.blueprint_next_sequence_ready_date]));
  // Judge every day on its own, so one wrong day is named.
  let wrongInJs = 0;
  for (const [text, real] of days) {
    if (text === "") continue;
    assert.equal(judge.ev({ c: { v: text } }, db), real, `JavaScript says ${JSON.stringify(text)} is ${!real}`);
    wrongInJs += real ? 0 : 1;
  }
  assert.ok(wrongInJs > 60, "the sweep includes many impossible days");
  // The SQL over all of them at once: bad rows are exactly the days that are not on the calendar.
  const expectedBad = days.filter(([text, real]) => text !== "" && !real).length;
  const ran = runPrintedSql(entry.contract.sql, db, { orgId: ORG, nowIso: NOW });
  assert.equal(ran.sample_count, byId.size);
  assert.equal(ran.bad_count, expectedBad);
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
  assert.equal(FIN_B06_GAPS.length, 2);
  for (const entry of FIN_B06_GAPS) {
    assert.equal(entry.mode, "always-red");
    assert.equal(entry.sql, null);
    assert.ok(entry.requirement.length > 60, entry.control);
    // The pure judge never touches the network, so it never says "na". Only the lane's live read can.
    const out = judgeDisplayResult({ id: "x", surface: "s", control: entry.control, contract: entry }, { sample_count: 9, bad_count: 0 });
    assert.equal(out.status, "NOT_PROVED");
  }
  const climate = FIN_B06_GAPS.find((entry) => entry.notShipped);
  assert.equal(climate.notShipped.path, "/climate/");
  assert.deepEqual([...climate.notShipped.paths], ["/climate/lender-climate/"]);
  for (const marker of ["climate-match", "climate_match", "website:climate"]) assert.ok(climate.notShipped.markers.includes(marker), marker);
  // The dead Save month/year button: not attachable, and it names the function that is missing.
  const stamp = FIN_B06_GAPS.find((entry) => !entry.notShipped);
  assert.equal(stamp.control, "Businesses cards: Save month/year button (stamp incorporation)");
  assert.match(stamp.requirement, /stampIncorporatedAsStaff/);
  assert.match(stamp.requirement, /ReferenceError/);
});

// ── the words the checks read are the words the product writes ──────────────────────────────────────────
// A check that names a literal the product no longer writes goes quiet: with nothing to judge it is green. These
// pins read the product's own source and fail the day a name is changed on either side.

test("the bureau call check reads the strings the launch writes", () => {
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
  const launch = read("src/inquiry-ops/bureau-call.mjs");
  const sql = checkByKey("inquiry-bureau-call").contract.sql;
  assert.match(launch, /kind:\s*"inquiry_bureau"/, "the launch no longer records its call under kind inquiry_bureau");
  assert.match(sql, /o\.kind = 'inquiry_bureau'/);
  assert.match(launch, /reason:\s*"bureau_dispute_call"/, "the launch no longer reveals the number for bureau_dispute_call");
  assert.match(read("src/pii/index.mjs"), /`ssn \(\$\{reason\}\)`/, "a reveal is no longer logged as ssn (<reason>)");
  assert.match(sql, /p\.field = 'ssn \(bureau_dispute_call\)'/);
  assert.match(launch, /call_fired_at = coalesce\(call_fired_at, now\(\)\)/, "the launch no longer keeps the first stamp");
  // The scheduler stamps without a call: the reason the check ties a call to a stamp by time and not by count.
  assert.match(read("src/inquiry-ops/call-scheduler.mjs"), /SET call_fired_at = \$2::timestamptz/);
});

test("the upload door checks read the strings the upload handler writes", () => {
  const handler = fs.readFileSync(path.join(ROOT, "api/documents-upload.mjs"), "utf8");
  assert.match(handler, /emit\(db, "docs\.received", \{\s*document_id: document\.id/, "the announcement or its document_id changed");
  assert.match(handler, /generatedBy: `\$\{actor\.kind\}:\$\{actor\.id/);
  assert.match(handler, /uploaded_by: actor/);
  assert.match(handler, /: \{ kind: "client", id: principal\.accountId \|\| principal\.clientId \}/, "a client sender is no longer the account id");
  for (const entry of FIN_B06_CHECKS.filter((item) => item.key.startsWith("documents-door") || item.key === "documents-staff-dropzone")) {
    assert.match(entry.contract.sql, /e\.name = 'docs\.received'/);
    // Postgres refuses uuid = text, and SQLite (which runs these in the tests) does not care, so the casts are pinned.
    assert.match(entry.contract.sql, /e\.payload->>'document_id' = d\.id::text/);
    assert.match(entry.contract.sql, /a\.id::text = d\.metadata->'uploaded_by'->>'id'/);
  }
  const validate = fs.readFileSync(path.join(ROOT, "src/documents/upload-validate.mjs"), "utf8");
  assert.match(validate, /ALLOWED_MIME_TYPES = Object\.freeze\(\["image\/jpeg", "image\/png", "application\/pdf"\]\)/);
  assert.match(checkByKey("documents-door-identity").contract.sql, /IN \('image\/jpeg', 'image\/png', 'application\/pdf'\)/);
  assert.match(checkByKey("documents-door-identity").contract.sql, /> 10485760/);
});

test("the ready date check reads the task key and workflow the daily sweep writes", async () => {
  const { nextSequenceAlertKey, SOURCE_WORKFLOW, NEXT_SEQUENCE_READY_DATE_KEY } = await import("../../../blueprint/next-funding-sequence.mjs");
  assert.equal(nextSequenceAlertKey({ clientId: "C", readyDate: "2026-10-01" }), "blueprint-next-sequence:C:2026-10-01");
  const sql = checkByKey("blueprint-ready-date").contract.sql;
  assert.ok(sql.includes("'blueprint-next-sequence:' || c.id::text || ':' ||"));
  assert.ok(sql.includes(`t.source_workflow = '${SOURCE_WORKFLOW}'`));
  assert.ok(sql.includes(`->>'${NEXT_SEQUENCE_READY_DATE_KEY}'`));
});

test("the wording edit check reads the roles the contracts handler lets write wording", () => {
  const handler = fs.readFileSync(path.join(ROOT, "api/contracts.mjs"), "utf8");
  assert.match(handler, /OWNER_ADMIN_ACTIONS = new Set\(\[\s*"create_template", "save_template"/);
  assert.match(handler, /OWNER_ADMIN_ACTIONS\.has\(action\) && !hasRole\(staff, \["admin"\]\)/);
  const sql = checkByKey("contract-wording-edited").contract.sql;
  assert.match(sql, /NOT COALESCE\(lower\(btrim\(s\.role\)\) IN \('owner', 'admin'\), false\)/);
});

test("the answer confirm check reads the record the confirm writes", () => {
  const confirm = fs.readFileSync(path.join(ROOT, "src/metro2/inbound/confirm.mjs"), "utf8");
  assert.match(confirm, /decision: "parse\.confirmed",\s*payload: \{\s*confidence: parseResult\.confidence,\s*confirmedBy: confirmedBy \|\| null/);
  const loop = fs.readFileSync(path.join(ROOT, "src/repair/parse-loop.mjs"), "utf8");
  assert.match(loop, /UPDATE dispute_responses SET confirmed = true, confirmed_at = now\(\), confirmed_by = \$2/);
  const sql = checkByKey("repair-parse-confirmed").contract.sql;
  assert.match(sql, /l\.decision = 'parse\.confirmed'/);
  // uuid columns are cast to text before they are trimmed or compared with json text (SQLite would not notice).
  assert.match(sql, /lower\(btrim\(r\.confirmed_by::text\)\)/);
  assert.match(sql, /lower\(btrim\(l\.payload->>'confirmedBy'\)\)/);
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
  assert.equal(FIN_B06_DISPLAY_CONTRACTS.length, 35);
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

  const redKeys = new Set(["blueprint-credit-partner"]);
  const db = {
    async query(sql) {
      const keys = [...sql.matchAll(/\/\* display-result:([^*\s]+) \*\//g)].map((match) => match[1]);
      assert.ok(keys.length > 0, "the grouped read must contain exact display-result keys");
      return { rows: keys.map((key, probe_index) => ({
        probe_index,
        sample_count: redKeys.has(key) ? 4 : 2,
        bad_count: redKeys.has(key) ? 1 : 0,
      })) };
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
    const key = (/display-result:([^*\s]+)/.exec(entry.contract.sql) || [])[1];
    assert.equal(row.status, redKeys.has(key) ? "FAIL" : "PASS", `${key}: ${row.detail}`);
  }
});

test("the practice-tested controls are direct proofs; the rows that also keep a live check keep it", () => {
  assert.equal(FIN_B06_DISPLAY_PROOF_CASES.length, 16);
  const rows = mapRows();
  const TEST_1 = "src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs";
  const TEST_2 = "src/pulse/catalog/proofs/fin-b06-display-browser-2.test.mjs";
  for (const entry of FIN_B06_DISPLAY_PROOF_CASES) {
    const hits = rows.filter((row) => row.sourceFile === entry.sourceFile && row.surface === entry.surface && row.control === entry.control);
    assert.equal(hits.length, 1, entry.control);
    const kept = DISPLAY_PROOF_CASES.find((item) => item.control === entry.control && item.surface === entry.surface);
    assert.ok(kept.tests.every((file) => [TEST_1, TEST_2].includes(file)), `${entry.control}: names a test file that is not one of ours`);
    for (const file of kept.tests) assert.ok(kept.evidence.includes(file), `${entry.control}: ${file} missing from evidence`);
    assert.equal(kept.depth, "deep");
    if (FIN_B06_DISPLAY_PRACTICE_ALSO_LIVE_CONTROLS.includes(entry.control)) {
      // The saved half is judged on saved rows, and the lane still judges it.
      assert.ok(displaySavedResultContract(hits[0]), `${entry.control}: the live check is kept`);
      assert.ok(DISPLAY_TRACKING_CASES.some((item) => item.control === entry.control), `${entry.control}: still judged by the live lane`);
    } else {
      assert.equal(displaySavedResultContract(hits[0]), null, `${entry.control}: also has a saved-result contract`);
      assert.equal(DISPLAY_TRACKING_CASES.some((item) => item.control === entry.control), false, `${entry.control}: still judged by the live lane`);
    }
  }
  assert.deepEqual([...FIN_B06_DISPLAY_PRACTICE_ALSO_LIVE_CONTROLS].sort(), [
    "Consent wording, version badge and current status banner (read from the server, never typed in the page)",
    "Upload door: ID and personal documents (type select, Upload button, file picker)",
    "Upload door: Inquiry documents (type select, Upload button, file picker)",
    "Upload door: bureau response (type select, Upload button, file picker)",
    "What You Own: Download link per file",
    "Capital Blueprint: Save ready date button",
    "Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs)",
    "Capital Blueprint: Offer bank tracker button",
    "Capital Blueprint: Take the offer back button",
    "'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked' button",
    "Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once fired)"
  ].sort());
  assert.equal(FIN_B06_DISPLAY_PRACTICE_CONTROLS.length, 5);
});
