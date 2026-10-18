// Batch 06 display controls (tier 3, customer data). Each check below is a live saved-result contract:
// one read-only SQL that returns sample_count (saved results that exist) and bad_count (how many are wrong),
// run by src/pulse/coverage/gap-catalog-display.mjs against the real company. A control nobody has used yet
// has no results, so it is green ("emptyAs: quiet") and goes red on the first wrong one.
//
// Each check is built from one definition that prints the SQL and also runs as a JavaScript judge over
// stand-in rows (fin-b06-sql-kit.mjs), so the test file can break the data on purpose and see it go red.
// There is no local Postgres on the build Mac: the SQL is checked against db/schema and db/migrations by
// fin-b06-schema.mjs, and the printed text is also run in SQLite over the same stand-in rows
// (fin-b06-sqlite.mjs). Neither is Postgres: a uuid compared with text, which SQLite accepts, is pinned by the
// tests that read the printed SQL.

import { createHash } from "node:crypto";

import { NEXT_SEQUENCE_READY_DATE_KEY, SOURCE_WORKFLOW as NEXT_SEQUENCE_WORKFLOW } from "../../../blueprint/next-funding-sequence.mjs";
import { OFFERS } from "../../../config/offers.mjs";
import { disclosureFor, versionsFor } from "../../../consent/disclosures.mjs";
import { ALLOWED_MIME_TYPES, DEFAULT_MAX_BYTES } from "../../../documents/upload-validate.mjs";
import { PAID_TRANSACTION_STATUS } from "../../../entitlements/entitlements.mjs";
import { SUPER_ROLES } from "../../../http/middleware/requireRole.mjs";
import { STAGE_SLA } from "../../../repair/sla.mjs";
import {
  afterNow, and, asText, blank, bodyHash, c, charLength, contract, custom, dayNotAfterDaysAgo, distinct, elem, eq,
  exists, existsElement, gt, hasBlueprintTransaction, isNull, jsonGet, jtext, jtype, lit, lowerTrim, lt, matches,
  missing, newerThanDays, not, notDemo, notMatches, notNull, notOneOf, numberFrom, olderThanMinutes, oneOf, or, part,
  realDay, startsWith, trimmed, earlier, valuesTable, onOrAfter, withinMinutes
} from "./fin-b06-sql-kit.mjs";

const sha256Hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const BLUEPRINT = OFFERS.UWIQ_DELIVERABLES.productCode;

/** The handlers' own gate (isCapitalBlueprintBuyer): a Blueprint order whose status is the paid one. */
const boughtBlueprint = (clientExpr, orgAlias) =>
  hasBlueprintTransaction(clientExpr, orgAlias, BLUEPRINT, PAID_TRANSACTION_STATUS);

export const FIN_B06_CHECKS = [];

function check(key, control, requirement, parts, { quiet = true } = {}) {
  FIN_B06_CHECKS.push(Object.freeze({
    key, control, requirement, parts: Array.isArray(parts) ? parts : [parts],
    contract: contract({ control, requirement, key, parts, quiet })
  }));
}

/** An honest "no saved result can show this". Stays NOT_PROVED and says exactly what is missing.
 *  `extra.notShipped` ({ path, markers }) lets the lane read the LIVE page and say "na" while the control is
 *  not on it, and take that back the day it is (src/pulse/coverage/fin-b06-not-shipped.mjs). */
export const FIN_B06_GAPS = [];
function gap(control, requirement, extra = {}) {
  FIN_B06_GAPS.push(Object.freeze({ control, mode: "always-red", requirement, sql: null, ...extra }));
}

const sameClient = (alias, left, right) => ({
  table: "clients", alias,
  on: and(eq(c(alias, "id"), c(left, right)), eq(c(alias, "org_id"), c(left, "org_id")))
});

// ───────────────────────── Capital Blueprint staff controls (client-control-panel.html) ─────────────────────────

const hasPartnerTag = custom(
  "COALESCE('blueprint_credit_partner' = ANY(p.tags), false)",
  (ctx) => Array.isArray(ctx.p && ctx.p.tags) && ctx.p.tags.includes("blueprint_credit_partner")
);

check(
  "blueprint-credit-partner",
  "Capital Blueprint: Add credit partner button and First/Last/Email/Phone inputs",
  "Every live credit-partner link must point at a real partner client in the same company with a first name, last name, an email and the Blueprint partner tag, on a primary client who bought the Capital Blueprint (a paid order; a failed or pending one does not count).",
  part({
    table: "credit_partner_links", alias: "l",
    joins: [
      { table: "clients", alias: "p", on: and(eq(c("p", "id"), c("l", "partner_client_id")), eq(c("p", "org_id"), c("l", "org_id"))) },
      { table: "clients", alias: "m", on: and(eq(c("m", "id"), c("l", "primary_client_id")), eq(c("m", "org_id"), c("l", "org_id"))) }
    ],
    where: isNull(c("l", "removed_at")),
    bad: or(
      isNull(c("p", "id")), isNull(c("m", "id")),
      blank(c("p", "first_name")), blank(c("p", "last_name")),
      notMatches(c("p", "email"), "@"),
      not(hasPartnerTag),
      not(boughtBlueprint(c("l", "primary_client_id"), "l"))
    )
  })
);

const READY_DATE = jtext(c("c", "custom_fields"), NEXT_SEQUENCE_READY_DATE_KEY);
// The daily sweep (src/workflows/blueprint-next-funding-sequence-sweeper.mjs, cron 06:30 UTC) opens one closer task
// for every saved day that has come: source_workflow blueprint-next-funding-sequence, body
// blueprint-next-sequence:<client id>:<day> (nextSequenceAlertKey in src/blueprint/next-funding-sequence.mjs, pinned
// by a test). The save time is not stored, so a client record that changed in the last 36 hours is not judged yet,
// and the day must be at least two days past, which gives a daily sweep a whole run to have happened.
const SWEEP_GRACE_DAYS = 2;
const RECORD_STILL_MINUTES = 36 * 60;
const EXPECTED_SWEEP_TASK_BODY = custom(
  `'blueprint-next-sequence:' || c.id::text || ':' || (${READY_DATE.sql})`,
  (ctx, db) => `blueprint-next-sequence:${ctx.c.id}:${READY_DATE.ev(ctx, db)}`
);
check(
  "blueprint-ready-date",
  "Capital Blueprint: Save ready date button",
  "Every client with a saved next-funding-sequence ready date must hold a REAL calendar day written YYYY-MM-DD (a 31 February is not one, and 29 February needs a leap year) and must be a paying Capital Blueprint buyer. The daily closer alert casts every saved day to a date in the database, and one day that is not on the calendar makes that read fail for the whole company. And the button promises \"the closer gets a task on that day\": once a saved day is two days past and the client record has not changed for 36 hours (the save time is not stored, so a record changed since then is not judged yet), the closer task the daily sweep makes for that day must exist. A dead sweep leaves a past ready date and no task.",
  [
    part({
      table: "clients", alias: "c",
      where: and(notDemo("c"), not(blank(READY_DATE))),
      bad: or(
        not(realDay(READY_DATE)),
        not(boughtBlueprint(c("c", "id"), "c"))
      )
    }),
    part({
      table: "clients", alias: "c",
      where: and(
        notDemo("c"), not(blank(READY_DATE)), realDay(READY_DATE), dayNotAfterDaysAgo(READY_DATE, SWEEP_GRACE_DAYS),
        olderThanMinutes(c("c", "updated_at"), RECORD_STILL_MINUTES), boughtBlueprint(c("c", "id"), "c")
      ),
      bad: missing("tasks", "t", and(
        eq(c("t", "org_id"), c("c", "org_id")), eq(c("t", "client_id"), c("c", "id")),
        eq(c("t", "source_workflow"), lit(NEXT_SEQUENCE_WORKFLOW)), eq(c("t", "body"), EXPECTED_SWEEP_TASK_BODY)
      ))
    })
  ]
);

const TRACKER_FLAG = jtext(c("c", "custom_fields"), "blueprint_bank_tracker_offered");
check(
  "blueprint-tracker-offered",
  "Capital Blueprint: Offer bank tracker button",
  "Every client flagged as offered the bank tracker must be a Capital Blueprint buyer with a paid order, because the offer is refused for anyone else. A failed or pending order does not count.",
  part({
    table: "clients", alias: "c",
    where: and(notDemo("c"), eq(TRACKER_FLAG, lit("true"))),
    bad: not(boughtBlueprint(c("c", "id"), "c"))
  })
);

check(
  "blueprint-tracker-taken-back",
  "Capital Blueprint: Take the offer back button",
  "Every client whose bank tracker offer was taken back must be a Capital Blueprint buyer with a paid order, because the switch is refused for anyone else. A failed or pending order does not count.",
  part({
    table: "clients", alias: "c",
    where: and(notDemo("c"), eq(TRACKER_FLAG, lit("false"))),
    bad: not(boughtBlueprint(c("c", "id"), "c"))
  })
);

// The Add-bank control (api/blueprint/staff-actions.mjs add_bank_todo) writes a row with NO bank_name. FinanceOS
// (src/finance/bank-strategy.mjs planBank / openAccount) writes the same table WITH a bank_name and no offer gate.
// So a row with no bank_name was written by this control, and the offer gate applies to it. The offer can be taken
// back later (flag "false"), which leaves the rows in place, so only a client who was never offered is wrong.
// What the PAGE sends (the Bank box as the bank, the Account choice, the trimmed note) is not a thing a saved row can
// show: addBankRelationshipTodo stores the note as given and never trims it, so a note with padding is something a
// direct call may legitimately store. That half is a practice test of the page (fin-b06-display-browser-2.test.mjs).
const TODO_CLIENT_FLAG = jtext(c("k", "custom_fields"), "blueprint_bank_tracker_offered");
check(
  "blueprint-bank-todo",
  "Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs)",
  "Every bank-list row saved by this button (a row with no FinanceOS bank name) must sit on a client in the same company who was offered the bank tracker and is a paying Capital Blueprint buyer, because the save is refused otherwise; and its bank key must be trimmed lower case, which the handler writes. (A blank bank key and an account kind other than personal or business are refused by database rules, so they are not judged here. What the page sent for the Bank, Account and Notes boxes is a practice test of the page, because the note is stored as given and a saved row cannot tell the page from a direct call.)",
  part({
    table: "blueprint_bank_relationship_todos", alias: "t",
    joins: [sameClient("k", "t", "client_id")],
    bad: or(
      isNull(c("k", "id")),
      distinct(c("t", "bank_key"), lowerTrim(c("t", "bank_key"))),
      and(isNull(c("t", "bank_name")), or(
        isNull(TODO_CLIENT_FLAG),
        not(boughtBlueprint(c("t", "client_id"), "t"))
      ))
    )
  })
);

// ───────────────────────── Declines (client-control-panel.html) ─────────────────────────

check(
  "blueprint-decline-recorded",
  "Declines: Record decline and build the plan button (bank, product, date, bureaus, letter text)",
  "Every staff-recorded decline must have its reconsideration steps, a named recorder, an application that is Denied (or Approved on reconsideration) when one is linked, and an ops task when an agent or ops step is still open.",
  part({
    table: "blueprint_declines", alias: "d",
    joins: [{ table: "applications", alias: "a", on: and(eq(c("a", "id"), c("d", "application_id")), eq(c("a", "org_id"), c("d", "org_id"))) }],
    where: eq(c("d", "source"), lit("staff")),
    bad: or(
      missing("blueprint_decline_steps", "s", and(eq(c("s", "decline_id"), c("d", "id")), eq(c("s", "org_id"), c("d", "org_id")))),
      blank(c("d", "recorded_by")),
      and(notNull(c("d", "application_id")), notOneOf(c("a", "status"), ["Denied", "Approved"])),
      and(isNull(c("d", "task_id")), exists("blueprint_decline_steps", "o", and(
        eq(c("o", "decline_id"), c("d", "id")), eq(c("o", "status"), lit("open")), oneOf(c("o", "who"), ["agent", "ops"])
      )))
    )
  })
);

check(
  "blueprint-decline-steps",
  "Declines: Save and mark done / Skip / Open again step buttons",
  "Every plan step that was touched must sit on a decline in the same company, a reopened step must carry no done time or person, and a step that is done or skipped must name who closed it.",
  part({
    table: "blueprint_decline_steps", alias: "s",
    joins: [{ table: "blueprint_declines", alias: "d", on: and(eq(c("d", "id"), c("s", "decline_id")), eq(c("d", "org_id"), c("s", "org_id"))) }],
    where: earlier(c("s", "created_at"), c("s", "updated_at")),
    bad: or(
      isNull(c("d", "id")),
      and(eq(c("s", "status"), lit("open")), or(notNull(c("s", "done_at")), notNull(c("s", "done_by")))),
      and(distinct(c("s", "status"), lit("open")), blank(c("s", "done_by"))),
      and(eq(c("s", "is_blank"), lit(true)), eq(c("s", "status"), lit("done")), blank(c("s", "filled_text")))
    )
  })
);

const EXPECTED_DUE = custom(
  "CASE WHEN d.recon_on IS NULL THEN NULL ELSE (d.recon_on::text || 'T16:00:00Z')::timestamptz END",
  (ctx) => (ctx.d && ctx.d.recon_on ? `${String(ctx.d.recon_on).slice(0, 10)}T16:00:00.000Z` : null)
);
check(
  "blueprint-decline-call-date",
  "Declines: Save call date button",
  "Every decline that has an ops task must still have that task, and while the task is open its due time must be the saved call day at 16:00 UTC (or empty when the day was cleared).",
  part({
    table: "blueprint_declines", alias: "d",
    joins: [{ table: "tasks", alias: "t", on: and(eq(c("t", "id"), c("d", "task_id")), eq(c("t", "org_id"), c("d", "org_id"))) }],
    where: notNull(c("d", "task_id")),
    bad: or(
      isNull(c("t", "id")),
      and(eq(c("t", "done"), lit(false)), distinct(c("t", "due_at"), EXPECTED_DUE))
    )
  })
);

check(
  "blueprint-decline-letter",
  "Declines: Upload letter button",
  "Every decline with a linked letter file must point at a stored document of the same client and company, and its get-the-letter step must no longer be open.",
  part({
    table: "blueprint_declines", alias: "d",
    joins: [
      { table: "documents", alias: "x", on: and(eq(c("x", "id"), c("d", "letter_document_id")), eq(c("x", "org_id"), c("d", "org_id"))) },
      { table: "blueprint_decline_steps", alias: "g", on: and(eq(c("g", "decline_id"), c("d", "id")), eq(c("g", "step_key"), lit("get_letter"))) }
    ],
    where: notNull(c("d", "letter_document_id")),
    bad: or(
      isNull(c("x", "id")),
      distinct(c("x", "client_id"), c("d", "client_id")),
      and(notNull(c("g", "id")), eq(c("g", "status"), lit("open")))
    )
  })
);

// ───────────────────────── Documents: drop zone, upload doors, download link ─────────────────────────

// api/documents-upload.mjs stamps `metadata.label` { given, filed_as, source } on every file since 2026-09-06
// (commit 7d9a80f58). Older files have no label, so the label rules only judge files written after that day.
const LABEL_WRITTEN_SINCE = "2026-09-07T00:00:00Z";
const LABEL = (key) => jtext(c("d", "metadata"), "label", key);

/**
 * One upload door. The door's own files are the ones api/documents-upload.mjs wrote for this kind, and that
 * handler is the only writer that sets generated_by to "<staff|client>:<id>" (the phone-text intake sets
 * "inbound-mms" and is another door). The type select is optional ("What is this? (helps us file it)"), so a
 * file sent with no type is filed as other and is not wrong; what a saved row CAN show is a chosen type the
 * server did not know. Whether the page sends the door's kind and the chosen type, and what it says when the
 * server refuses a file, is a practice test of the page (fin-b06-display-browser.test.mjs), because a dropped
 * choice looks the same as no choice in a saved row.
 *
 * The sender in metadata.uploaded_by.id is the staff id (staff doors) or the login's account id (client doors:
 * requirePrincipal always carries accountId for a client). A client login may file only on its own file or on a
 * file it is an authorized representative of, so the account must belong to this company and to this file; a
 * login filing on another client's file is the wrong-client result no field of the file itself would show.
 * The stored object must be one of the three types the door accepts and not over its size limit (the validator
 * sniffs the bytes; a file that got past it, or a validator that was bypassed, is the break). The handler also
 * announces every file with a docs.received event (it clears the "Missing Documents" hold and wakes the document
 * agent), so a file that was stored and never announced leaves a client told to send what they already sent.
 */
const MAX_UPLOAD_BYTES = DEFAULT_MAX_BYTES;
const SENDER_ID = jtext(c("d", "metadata"), "uploaded_by", "id");
function uploadDoor(key, control, requirement, { kind, uploader }) {
  const staffDoor = uploader === "staff";
  check(key, control, requirement, part({
    table: "documents", alias: "d",
    joins: [
      { table: "document_versions", alias: "v", on: and(eq(c("v", "id"), c("d", "current_version_id")), eq(c("v", "document_id"), c("d", "id"))) },
      sameClient("k", "d", "client_id"),
      {
        table: staffDoor ? "staff" : "accounts", alias: "a",
        on: and(eq(asText(c("a", "id")), SENDER_ID), eq(c("a", "org_id"), c("d", "org_id")))
      }
    ],
    where: and(notDemo("d"), eq(c("d", "kind"), lit(kind)), startsWith(c("d", "generated_by"), `${uploader}:`)),
    bad: or(
      isNull(c("v", "id")),
      blank(c("v", "storage_key")),
      distinct(c("d", "storage_key"), c("v", "storage_key")),
      blank(c("v", "checksum")),
      distinct(c("d", "checksum"), c("v", "checksum")),
      not(oneOf(c("v", "mime_type"), [...ALLOWED_MIME_TYPES])),
      // Above zero: a NULL size is not above zero either, so a file with no size is red here too.
      not(gt(c("v", "byte_size"), lit(0))),
      gt(c("v", "byte_size"), lit(MAX_UPLOAD_BYTES)),
      isNull(c("k", "id")),
      // Who sent it: the handler writes the sender into the file's metadata as well as generated_by, and the
      // sender must be a real person or login of this company.
      distinct(jtext(c("d", "metadata"), "uploaded_by", "kind"), lit(uploader)),
      isNull(c("a", "id")),
      ...(staffDoor ? [] : [
        and(distinct(c("a", "client_id"), c("d", "client_id")), missing("client_authorized_reps", "r", and(
          eq(c("r", "account_id"), c("a", "id")), eq(c("r", "client_id"), c("d", "client_id")), eq(c("r", "org_id"), c("d", "org_id"))
        )))
      ]),
      // The announcement: one docs.received event on this client's file naming this document.
      missing("events", "e", and(
        eq(c("e", "org_id"), c("d", "org_id")), eq(c("e", "name"), lit("docs.received")),
        eq(c("e", "client_id"), c("d", "client_id")), eq(jtext(c("e", "payload"), "document_id"), asText(c("d", "id")))
      )),
      // What it was filed as, against what the person picked. A type the server does not know is filed as
      // "other" (and stamped source "unrecognised"), so what was picked and what was filed differ: a real answer lost.
      and(notNull(LABEL("filed_as")), distinct(c("d", "subtype"), LABEL("filed_as"))),
      and(onOrAfter(c("d", "created_at"), LABEL_WRITTEN_SINCE), or(
        isNull(LABEL("filed_as")),
        and(notNull(LABEL("given")), distinct(LABEL("given"), LABEL("filed_as")))
      ))
    )
  }));
}

uploadDoor(
  "documents-staff-dropzone",
  "Documents toggle, drop zone, file input, drag and drop upload",
  "Every file staff dropped on a client file must have a current version with a stored object and checksum that match the document row, be a jpg, png or pdf of a size the door accepts, sit on a client in the same company, name a staff member of this company as the sender, have its docs.received announcement on that client's file, and be filed under the type it was labeled with (the drop zone sends no type, so it files as other; a file that names a type the server does not know is wrong).",
  { kind: "client_upload", uploader: "staff" }
);
uploadDoor(
  "documents-door-identity",
  "Upload door: ID and personal documents (type select, Upload button, file picker)",
  "Every file a client sent through the ID and personal documents door must have a current version with a stored object and checksum that match the document row, be a jpg, png or pdf of a size the door accepts, sit on a file the sending login belongs to (its own file, or one it is an authorized representative of), name that client login as the sender, have its docs.received announcement on that file, and be filed under EXACTLY the type chosen in the select. A chosen type the server does not know (it would be filed as other) is wrong; a file sent with no type chosen is filed as other and is not.",
  { kind: "client_upload", uploader: "client" }
);
uploadDoor(
  "documents-door-inquiry",
  "Upload door: Inquiry documents (type select, Upload button, file picker)",
  "Every file a client sent through the inquiry documents door must be an inquiry document with a current version, stored object and checksum that match the document row, be a jpg, png or pdf of a size the door accepts, sit on a file the sending login belongs to (its own file, or one it is an authorized representative of), be named as sent by that client login, have its docs.received announcement on that file, and be filed under EXACTLY the type chosen in the select. A chosen type the server does not know is wrong; a file sent with no type chosen is filed as other and is not.",
  { kind: "inquiry_doc", uploader: "client" }
);
uploadDoor(
  "documents-door-bureau",
  "Upload door: bureau response (type select, Upload button, file picker)",
  "Every file a client sent through the bureau response door must be a bureau response with a current version, stored object and checksum that match the document row, be a jpg, png or pdf of a size the door accepts, sit on a file the sending login belongs to (its own file, or one it is an authorized representative of), be named as sent by that client login, have its docs.received announcement on that file, and be filed under EXACTLY the type chosen in the select. A chosen type the server does not know is wrong; a file sent with no type chosen is filed as other and is not.",
  { kind: "bureau_response", uploader: "client" }
);

// The portal paints a Download link for EVERY document of kind "deliverable" (client-portal.html ownRows: kind
// is the whole filter), whatever its subtype. An expired one is given no link on purpose
// (api/read/portal-summary.mjs: "an expired document gets no link"), so only a deliverable that is still
// valid must have an object to hand over. The signed link carries the current version id, and the download route
// (api/documents/[id].mjs resolveStorageTarget) reads that version's object, or the document row's own copy when the
// link names no version, and verifies the bytes against the stored checksum when it holds one. So the two copies of
// the key must be the same object, and the checksum must exist and agree, or a link opens a different file or
// opens one that nothing verified. Which file each link opens on the page is a practice test of the page.
check(
  "documents-download-link",
  "What You Own: Download link per file",
  "Every deliverable document a client can own, of any type (the five reports and packs, the dispute letters, complaints and validation letters, the duplication map), that has not expired must point at a current version with a stored object, the document row's copy of that object must be the same object and checksum, and the checksum must be there, because the signed download link reads exactly that object and checks its bytes against that checksum.",
  part({
    table: "documents", alias: "d",
    joins: [{ table: "document_versions", alias: "v", on: and(eq(c("v", "id"), c("d", "current_version_id")), eq(c("v", "document_id"), c("d", "id"))) }],
    where: and(
      notDemo("d"), eq(c("d", "kind"), lit("deliverable")),
      or(isNull(c("d", "expires_at")), afterNow(c("d", "expires_at")))
    ),
    bad: or(
      isNull(c("v", "id")), blank(c("d", "storage_key")), blank(c("v", "storage_key")),
      distinct(c("d", "storage_key"), c("v", "storage_key")),
      blank(c("v", "checksum")), distinct(c("d", "checksum"), c("v", "checksum"))
    )
  })
);

// ───────────────────────── Identity, consent and signing ─────────────────────────

// The Identity-on-file state line and the approval link box + Copy link (client-control-panel.html) are display
// only: GET /api/consent/capture builds the line from readIdentity() and mints the link, and neither is written
// anywhere, so there is no saved result of THIS control to read. It is a practice test of the page instead
// (fin-b06-display-browser.test.mjs). The data question "did every typed approval leave an identity on file" belongs
// to the client's approval page, not to this control.

// Words the server holds. Consents that name a version the server holds, and carry exactly its words (the server
// stores its own text, never the caller's), are right. Soft pull consents are judged for the last 60 days only:
// the wording table went in with the consent record on 2026-07-31 and older rows can predate it.
const WORDS_KINDS = ["dispute_authorization", "call_recording", "marketing_use"];
const SOFT_PULL_KIND = "soft_pull_consent";
const SOFT_PULL_WINDOW_DAYS = 60;
function wordsTable(kinds = [...WORDS_KINDS, SOFT_PULL_KIND]) {
  const rows = [];
  for (const kind of kinds) {
    for (const version of versionsFor(kind)) {
      const found = disclosureFor(kind, version);
      if (found && found.text) rows.push([kind, version, String(found.text).trim()]);
    }
  }
  return valuesTable("w", ["kind", "version", "words"], rows,
    and(eq(c("w", "kind"), c("k", "kind")), eq(c("w", "version"), c("k", "consent_version"))));
}

check(
  "consent-wording-matches-server",
  "Consent wording, version badge and current status banner (read from the server, never typed in the page)",
  "Every stored soft pull (last 60 days), dispute authorization, call recording and marketing use consent on a real client must name a wording version the server holds and carry exactly that version's words, because the screen shows the server's words and never the caller's. The status banner is worked out from these same rows each time the screen opens and leaves no saved result of its own, so it is not judged separately.",
  part({
    table: "client_consents", alias: "k",
    joins: [wordsTable(), sameClient("cl", "k", "client_id")],
    where: and(
      notDemo("cl"),
      or(
        oneOf(c("k", "kind"), WORDS_KINDS),
        and(eq(c("k", "kind"), lit(SOFT_PULL_KIND)), newerThanDays(c("k", "granted_at"), SOFT_PULL_WINDOW_DAYS))
      )
    ),
    bad: or(isNull(c("w", "words")), distinct(trimmed(c("k", "consent_text")), c("w", "words")))
  })
);

check(
  "dispute-authorization-signed",
  "Sign to authorize dispute letters: submit button",
  "Every dispute authorization a client signed must carry the server's exact words for its version and be signed from the client's own login or from an authorized representative linked to that file.",
  part({
    table: "client_consents", alias: "k",
    joins: [
      { table: "accounts", alias: "a", on: and(eq(c("a", "id"), c("k", "granted_by_account_id")), eq(c("a", "org_id"), c("k", "org_id"))) },
      wordsTable(["dispute_authorization"])
    ],
    where: and(eq(c("k", "kind"), lit("dispute_authorization")), eq(c("k", "granted_by_kind"), lit("client")), eq(c("k", "capture_method"), lit("signature"))),
    bad: or(
      isNull(c("a", "id")),
      and(distinct(c("a", "client_id"), c("k", "client_id")), missing("client_authorized_reps", "r", and(
        eq(c("r", "account_id"), c("k", "granted_by_account_id")), eq(c("r", "client_id"), c("k", "client_id"))
      ))),
      isNull(c("w", "words")),
      distinct(trimmed(c("k", "consent_text")), c("w", "words"))
    )
  })
);

// ───────────────────────── Authorized representative ─────────────────────────

check(
  "authorized-rep-removed",
  "Authorized rep: Take them off this file button",
  "After a representative is taken off a file, no live session of that login may still be acting on that file unless the person was linked to it again.",
  part({
    table: "client_authorized_reps", alias: "r",
    where: notNull(c("r", "removed_at")),
    bad: and(
      exists("account_sessions", "s", and(
        eq(c("s", "account_id"), c("r", "account_id")), eq(c("s", "active_client_id"), c("r", "client_id")),
        isNull(c("s", "revoked_at")), afterNow(c("s", "expires_at"))
      )),
      missing("client_authorized_reps", "n", and(
        eq(c("n", "account_id"), c("r", "account_id")), eq(c("n", "client_id"), c("r", "client_id")), isNull(c("n", "removed_at"))
      ))
    )
  })
);

check(
  "authorized-rep-file-switch",
  "Authorized-rep file switcher buttons (one per file)",
  "Every live login session that is acting on a client file must belong to a representative who is linked to that same file in the same company.",
  part({
    table: "account_sessions", alias: "s",
    where: and(notNull(c("s", "active_client_id")), isNull(c("s", "revoked_at")), afterNow(c("s", "expires_at"))),
    bad: missing("client_authorized_reps", "r", and(
      eq(c("r", "account_id"), c("s", "account_id")), eq(c("r", "client_id"), c("s", "active_client_id")),
      eq(c("r", "org_id"), c("s", "org_id")), isNull(c("r", "removed_at"))
    ))
  })
);

// ───────────────────────── Client file: applications, proxy, inquiry, notes, business ─────────────────────────

check(
  "bank-decision-pending",
  "Lender row: Pending button",
  "Every Pending bank decision must link to the exact application, carry its decision time and name the staff member who recorded it.",
  part({
    table: "application_decisions", alias: "d",
    joins: [{ table: "applications", alias: "a", on: and(eq(c("a", "id"), c("d", "application_id")), eq(c("a", "org_id"), c("d", "org_id"))) }],
    where: and(eq(c("d", "event_type"), lit("bank_decision")), eq(c("d", "status"), lit("Applied"))),
    bad: or(isNull(c("a", "id")), isNull(c("d", "application_id")), isNull(c("d", "decided_at")), blank(c("d", "created_by")))
  })
);

check(
  "proxy-apply-session",
  "Lender row: Apply button (proxy launch, opens bank page)",
  "Every Apply proxy session must be consistent: an active one has an exit address and a targeting level, a failed or mismatched one has an error and an end time, an ended one has an end time, and none sits at verifying for over 30 minutes.",
  part({
    table: "proxy_sessions", alias: "p",
    joins: [
      sameClient("k", "p", "client_id"),
      { table: "lenders", alias: "l", on: and(eq(c("l", "id"), c("p", "lender_id")), eq(c("l", "org_id"), c("p", "org_id"))) }
    ],
    bad: or(
      isNull(c("k", "id")),
      and(notNull(c("p", "lender_id")), isNull(c("l", "id"))),
      and(oneOf(c("p", "status"), ["failed", "mismatch"]), or(blank(c("p", "error_code")), isNull(c("p", "ended_at")))),
      and(eq(c("p", "status"), lit("active")), or(blank(c("p", "exit_ip")), isNull(c("p", "targeting_level")))),
      and(eq(c("p", "status"), lit("ended")), isNull(c("p", "ended_at"))),
      and(oneOf(c("p", "status"), ["verifying", "active"]), notNull(c("p", "ended_at"))),
      and(eq(c("p", "status"), lit("verifying")), olderThanMinutes(c("p", "started_at"), 30))
    )
  })
);

check(
  "inquiry-removal-case-opened",
  "Issue Inquiry Removal button (opens a case, goes to Inquiry Remover)",
  "Every inquiry removal case opened from the client file must sit on a client in the same company with a case number, a status, who asked and when.",
  part({
    table: "inquiry_removal_cases", alias: "r",
    joins: [sameClient("k", "r", "client_id")],
    where: and(notDemo("r"), eq(c("r", "request_source"), lit("client_control_panel"))),
    bad: or(isNull(c("k", "id")), blank(c("r", "case_id")), isNull(c("r", "case_status")), blank(c("r", "requested_by")), isNull(c("r", "requested_at")))
  })
);

const NOTES = jsonGet(c("k", "custom_fields"), "notes");
const STAFF_NOTES = jsonGet(c("k", "custom_fields"), "staff_notes");
const NOTES_KIND = jtype(NOTES);
const STAFF_NOTES_KIND = jtype(STAFF_NOTES);
// A key that is present and not JSON null. An empty imported field is JSON null and is not a saved note.
const has = (kind) => and(notNull(kind), distinct(kind, lit("null")));
check(
  "client-notes-saved",
  "Notes textarea and Save notes button",
  "Every saved staff note on a client file must be plain text no longer than the 20,000 character limit the save enforces.",
  part({
    table: "clients", alias: "k",
    where: and(notDemo("k"), or(has(NOTES_KIND), has(STAFF_NOTES_KIND))),
    bad: or(
      and(has(NOTES_KIND), distinct(NOTES_KIND, lit("string"))),
      and(has(STAFF_NOTES_KIND), distinct(STAFF_NOTES_KIND, lit("string"))),
      gt(charLength(jtext(c("k", "custom_fields"), "notes")), lit(20000)),
      gt(charLength(jtext(c("k", "custom_fields"), "staff_notes")), lit(20000))
    )
  })
);

// ───────────────────────── Contracts and wordings ─────────────────────────

const STAFF_JOIN = (alias, left, right) => ({
  table: "staff", alias,
  on: and(eq(c(alias, "id"), c(left, right)), eq(c(alias, "org_id"), c(left, "org_id")))
});

check(
  "contract-wording-created",
  "Save (create a new wording)",
  "Every text wording a staff member created must have a short name in the allowed shape, a name, words, a signature sentence, a kind of contract or authorization, and a creator who is staff in the same company.",
  part({
    table: "contract_templates", alias: "t",
    joins: [STAFF_JOIN("s", "t", "created_by")],
    where: and(notDemo("t"), eq(c("t", "source_kind"), lit("text")), notNull(c("t", "created_by"))),
    bad: or(
      notMatches(c("t", "template_key"), "^[A-Z0-9][A-Z0-9-]{1,62}$"),
      blank(c("t", "name")), blank(c("t", "body")), blank(c("t", "signature_statement")),
      notOneOf(c("t", "kind"), ["contract", "authorization"]),
      isNull(c("s", "id"))
    )
  })
);

const FROZEN_HASH = bodyHash(c("k", "rendered_body"), sha256Hex);
// A wording the screen edited is one that names an editor, or one whose updated_at moved past created_at with
// no migration having run near that moment. A migration that rewrote a seeded wording (273, 287 and 288 do)
// moves updated_at and records no editor, because a migration is not a person; schema_migrations.applied_at
// says when each one ran, so those rows are left out. Everything else that moved and names nobody is an edit
// that stopped recording who made it. The editor must be staff in this company AND an owner or an admin: the
// handler refuses every wording write from any other role (api/contracts.mjs OWNER_ADMIN_ACTIONS, hasRole), so a
// closer's name on a wording is a write the gate let through. The role read is the person's role today: an
// editor who was an admin then and is not now reads as wrong until the wording is saved again. A blank name,
// blank words or a blank signature sentence are refused by database rules (124, 125), so they are not judged here.
const MIGRATION_SLACK_MINUTES = 5;
const WORDING_EDITOR_ROLES = [...SUPER_ROLES, "admin"];
const notRewrittenByMigration = custom(
  `NOT EXISTS (SELECT 1 FROM schema_migrations m WHERE m.applied_at >= t.updated_at - interval '${MIGRATION_SLACK_MINUTES} minutes' AND m.applied_at <= t.updated_at + interval '${MIGRATION_SLACK_MINUTES} minutes')`,
  (ctx, db) => !(db.schema_migrations || []).some((row) =>
    Math.abs(new Date(row.applied_at).getTime() - new Date(ctx.t.updated_at).getTime()) <= MIGRATION_SLACK_MINUTES * 60_000)
);
check(
  "contract-wording-edited",
  "Save (edit an existing wording)",
  "Every wording that was edited must name a staff editor in the same company who is an owner or an admin (an edit that stopped recording who made it is wrong, whether the wording is text or an uploaded PDF, and so is a closer or any other role changing legal wording, which the handler refuses). And every contract already sent, viewed, signed or voided must still hold the words whose fingerprint was stored in its frozen copy (document_versions.checksum, the one the contract row cannot rewrite), and the contract row's own fingerprint must agree with it, so rewriting the words and the row's fingerprint together is seen. Wordings that only a migration rewrote are left out, and a blank name or blank words are refused by database rules, so they are not judged here.",
  [
    part({
      table: "contract_templates", alias: "t",
      joins: [STAFF_JOIN("s", "t", "updated_by")],
      where: and(notDemo("t"), or(
        notNull(c("t", "updated_by")),
        and(earlier(c("t", "created_at"), c("t", "updated_at")), notRewrittenByMigration)
      )),
      bad: or(isNull(c("s", "id")), notOneOf(lowerTrim(c("s", "role")), WORDING_EDITOR_ROLES))
    }),
    part({
      table: "contracts", alias: "k",
      joins: [{ table: "document_versions", alias: "v", on: and(eq(c("v", "id"), c("k", "document_version_id")), eq(c("v", "org_id"), c("k", "org_id"))) }],
      where: and(notDemo("k"), oneOf(c("k", "status"), ["sent", "viewed", "signed", "void"]), notNull(c("k", "rendered_body"))),
      bad: or(
        isNull(c("k", "document_version_id")), isNull(c("v", "id")), isNull(c("v", "checksum")),
        distinct(FROZEN_HASH, c("v", "checksum")),
        isNull(c("k", "body_sha")), distinct(c("k", "body_sha"), FROZEN_HASH)
      )
    })
  ]
);

check(
  "contract-voided",
  "Contract cell: Void button (asks for a reason in a prompt; owner/admin only)",
  "Every voided contract must carry its void time, a reason and a staff member in the same company who voided it, and a signed contract must never be voided.",
  part({
    table: "contracts", alias: "k",
    joins: [STAFF_JOIN("s", "k", "voided_by")],
    where: and(notDemo("k"), eq(c("k", "status"), lit("void"))),
    bad: or(isNull(c("k", "voided_at")), blank(c("k", "void_reason")), isNull(c("s", "id")), notNull(c("k", "signed_at")))
  })
);

check(
  "contract-sign-link",
  "Agreements tab: Review & sign link per contract",
  "Every contract that is sent or viewed must be signable: a frozen copy with a matching fingerprint and a signer who can sign now, so the Review and sign link opens a contract that works.",
  part({
    table: "contracts", alias: "k",
    joins: [{ table: "document_versions", alias: "v", on: eq(c("v", "id"), c("k", "document_version_id")) }],
    where: and(notDemo("k"), oneOf(c("k", "status"), ["sent", "viewed"])),
    bad: or(
      isNull(c("k", "document_version_id")), isNull(c("v", "id")), isNull(c("v", "checksum")),
      isNull(c("k", "rendered_body")), isNull(c("k", "body_sha")),
      and(eq(c("k", "source_kind"), lit("pdf")), isNull(c("k", "source_document_id"))),
      distinct(FROZEN_HASH, c("v", "checksum")), distinct(FROZEN_HASH, c("k", "body_sha")),
      missing("contract_signers", "s", and(
        eq(c("s", "contract_id"), c("k", "id")), oneOf(c("s", "status"), ["pending", "sent", "viewed"]),
        or(
          eq(c("k", "signing_order"), lit("parallel")),
          missing("contract_signers", "h", and(
            eq(c("h", "contract_id"), c("k", "id")), lt(c("h", "signer_index"), c("s", "signer_index")), distinct(c("h", "status"), lit("signed"))
          ))
        )
      ))
    )
  })
);

const BOX = (axis) => numberFrom(jtext(elem("f"), axis));
const FIELD_ARRAY = c("t", "fields");
check(
  "contract-pdf-boxes",
  "PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner to resize",
  "Every saved PDF box must have a position and size as fractions of the page: all four numbers present, at least 0 and at most 1, a size above zero, and the box not running off the page edge or onto a page the file does not have.",
  part({
    table: "contract_templates", alias: "t",
    where: and(notDemo("t"), eq(c("t", "source_kind"), lit("pdf"))),
    bad: existsElement(FIELD_ARRAY, "f", or(
      isNull(BOX("x")), isNull(BOX("y")), isNull(BOX("w")), isNull(BOX("h")),
      gt(BOX("x"), lit(1)), gt(BOX("y"), lit(1)), gt(BOX("w"), lit(1)), gt(BOX("h"), lit(1)),
      lt(BOX("w"), lit(0.0000001)), lt(BOX("h"), lit(0.0000001)),
      gt(custom(`${BOX("x").sql} + ${BOX("w").sql}`, (ctx, db) => (BOX("x").ev(ctx, db) ?? 0) + (BOX("w").ev(ctx, db) ?? 0)), lit(1.0001)),
      gt(custom(`${BOX("y").sql} + ${BOX("h").sql}`, (ctx, db) => (BOX("y").ev(ctx, db) ?? 0) + (BOX("h").ev(ctx, db) ?? 0)), lit(1.0001)),
      and(matches(jtext(elem("f"), "page"), "^[0-9]+$"), gt(numberFrom(jtext(elem("f"), "page")), custom("(t.page_count - 1)", (ctx) => Number(ctx.t.page_count) - 1))),
      and(oneOf(jtext(elem("f"), "type"), ["signature", "initials"]), distinct(jtext(elem("f"), "source"), lit("manual")), notNull(jtext(elem("f"), "source")))
    ))
  })
);

// ───────────────────────── Content screen (tiles and welcome videos) ─────────────────────────

check(
  "content-tile-name",
  "Locked tile editor: client-facing name box",
  "Every locked tile that clients can see must have a name, because the portal prints that name on the Unlock More card.",
  part({
    table: "entitlement_catalog", alias: "e",
    where: eq(c("e", "active"), lit(true)),
    bad: blank(c("e", "name"))
  })
);

check(
  "content-tile-copy",
  "Locked tile editor: outcome copy box (one line shown to the client)",
  "Every locked tile that has outcome copy must hold real words: the save writes nothing for an empty box, so a blank-only line is a broken save.",
  part({
    table: "entitlement_catalog", alias: "e",
    where: notNull(c("e", "description")),
    bad: blank(c("e", "description"))
  })
);

check(
  "content-save-changes",
  "Save changes button (saves tiles and the tier-to-video map)",
  "After a Content save, every locked tile that clients can see must have a name and every welcome video choice must point at a video in the same company with a title and a stored object.",
  [
    part({
      table: "entitlement_catalog", alias: "e",
      where: eq(c("e", "active"), lit(true)),
      bad: blank(c("e", "name"))
    }),
    part({
      table: "content_tier_map", alias: "m",
      joins: [{ table: "content_videos", alias: "v", on: and(eq(c("v", "id"), c("m", "video_id")), eq(c("v", "org_id"), c("m", "org_id"))) }],
      bad: or(isNull(c("v", "id")), blank(c("v", "title")), blank(c("v", "storage_key")))
    })
  ]
);

// ───────────────────────── Inquiry remover and repair desk ─────────────────────────

// outbound_calls stores no case id (call_id, client_id, org_id, kind, created_at only), and the launch writes the call
// row and stamps the case in two separate steps (src/inquiry-ops/bureau-call.mjs). So a call is tied to its case by
// TIME: the stamp (call_fired_at = coalesce(call_fired_at, now())) lands within moments of the call row, because
// recordDispatch and the stamp run back to back in one request. Each call must have a case of the same client whose
// stamp sits within five minutes of it, and a reveal log entry ("ssn (bureau_dispute_call)", written by revealSsn
// before the call is placed) within five minutes of it too.
//   * A second launch on a case that is already stamped keeps the first stamp (coalesce), so the second call has no
//     stamp near it and is seen, even when the client has other cases the scheduler stamped fired with no call
//     (call-scheduler.mjs stamps call_fired_at and ai_call_status 'queued' and places nothing).
//   * A call whose stamp never landed has no stamp near it and is seen.
//   * Any earlier reveal log no longer answers for a later call: the log must be near the call itself.
// What this cannot see, said in the requirement as well: a repeat launched within five minutes of another launch on
// ANOTHER case of the same client (its time matches that case's stamp), and a call that was placed but whose
// dispatch record failed to write (the launch swallows that error, so nothing is left to read). Calls older than 30
// days are not judged. The strings it tests are the ones the launch writes; a test reads the handler and fails if
// either one is renamed.
const BUREAU_CALL_WINDOW_DAYS = 30;
const BUREAU_CALL_MATCH_MINUTES = 5;
check(
  "inquiry-bureau-call",
  "Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once fired)",
  "Every bureau call placed in the last 30 days must have, for that client, a number-reveal log entry and a case stamped as fired, each within five minutes of the call itself. A second launch on a case that was already stamped (the button is disabled by the page only, the server does not refuse it) has no new stamp and is seen, and so is a call whose case was never stamped; a case the scheduler stamped without placing a call does not answer for a call. What this cannot see: a repeat placed within five minutes of a launch on another case of the same client, and a call placed whose dispatch record failed to write.",
  part({
    table: "outbound_calls", alias: "o",
    where: and(eq(c("o", "kind"), lit("inquiry_bureau")), newerThanDays(c("o", "created_at"), BUREAU_CALL_WINDOW_DAYS)),
    bad: or(
      missing("pii_access_log", "p", and(
        eq(c("p", "org_id"), c("o", "org_id")), eq(c("p", "client_id"), c("o", "client_id")),
        eq(c("p", "field"), lit("ssn (bureau_dispute_call)")),
        withinMinutes(c("p", "created_at"), c("o", "created_at"), BUREAU_CALL_MATCH_MINUTES)
      )),
      missing("inquiry_removal_cases", "r", and(
        eq(c("r", "org_id"), c("o", "org_id")), eq(c("r", "client_id"), c("o", "client_id")),
        withinMinutes(c("r", "call_fired_at"), c("o", "created_at"), BUREAU_CALL_MATCH_MINUTES)
      ))
    )
  })
);

// The repair program's own clock for an answer that needs a person: STAGE_SLA.response_received, 24 hours
// ("owner_reviews_parse", src/repair/sla.mjs). api/repair/exceptions.mjs lists answers that are unconfirmed AND
// (confidence under 0.85 or held for escalation). An answer the list hides, or one nobody reads, sits unconfirmed
// past that clock.
//
// The other half of the list is the cards the repair program parked on its Stalled stage ("the only human queue",
// src/repair/sla.mjs STALLED_STAGE; the morning pulse already reds any card there). The program sets no clock for
// that stage, so a stuck file is read against the one human-read clock it does have, the same 24 hours, and the
// requirement text says so. A card is not judged by what the list printed (the list is a read and saves nothing):
// it is judged by the fact the list exists to change, a person has moved it.
//
// What "Mark as checked" does (confirmHeldParse in src/repair/parse-loop.mjs): confirmParse advances the case's
// items and writes a repair_decision_log row "parse.confirmed" carrying the confirmer's id, and only then is the
// answer flagged confirmed with its confirmer. A flag flipped with nothing behind it has no log row.
const READ_WITHIN_MINUTES = STAGE_SLA.response_received.hours * 60;
const STUCK_CARD_MINUTES = STAGE_SLA.response_received.hours * 60;
const CONFIRM_RECORD_MATCH_MINUTES = 5;
check(
  "repair-parse-confirmed",
  "'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked' button",
  "Every bureau answer that needed a person (no confidence at all, low confidence, or held for escalation) and is marked checked must carry the confirm time and a staff member in the same company who confirmed it; every answer a person confirmed must have the confirm record the button writes (a parse.confirmed entry for that client and case, written within five minutes of the confirm, naming that same person), so a flag flipped with nothing advanced is seen; no bureau answer on a real client may sit unchecked past the repair program's own 24 hour clock, which is how a list that hides an answer shows up; and no real client's repair card may sit on the Stalled stage past that same 24 hour human-read clock (the program sets no clock for Stalled, so this is the one it has), because the list exists so a person moves it.",
  [
    part({
      table: "dispute_responses", alias: "r",
      joins: [STAFF_JOIN("s", "r", "confirmed_by")],
      where: and(
        eq(c("r", "confirmed"), lit(true)),
        or(isNull(c("r", "confidence")), lt(c("r", "confidence"), lit(0.85)), eq(jtext(c("r", "parse_json"), "heldForEscalation"), lit("true")))
      ),
      bad: or(isNull(c("r", "confirmed_at")), isNull(c("r", "confirmed_by")), isNull(c("s", "id")))
    }),
    part({
      table: "dispute_responses", alias: "r",
      joins: [sameClient("k", "r", "client_id")],
      where: and(distinct(c("r", "confirmed"), lit(true)), notDemo("k")),
      bad: olderThanMinutes(c("r", "created_at"), READ_WITHIN_MINUTES)
    }),
    part({
      table: "dispute_responses", alias: "r",
      where: and(eq(c("r", "confirmed"), lit(true)), notNull(c("r", "confirmed_by"))),
      bad: missing("repair_decision_log", "l", and(
        eq(c("l", "org_id"), c("r", "org_id")), eq(c("l", "client_id"), c("r", "client_id")),
        eq(c("l", "case_id"), c("r", "case_id")), eq(c("l", "decision"), lit("parse.confirmed")),
        eq(lowerTrim(jtext(c("l", "payload"), "confirmedBy")), lowerTrim(asText(c("r", "confirmed_by")))),
        // The record is written an instant before the flag, so it is tied to THIS confirm by time: an older record
        // by the same person on the same case does not answer for a later flag flipped with nothing behind it.
        withinMinutes(c("l", "created_at"), c("r", "confirmed_at"), CONFIRM_RECORD_MATCH_MINUTES)
      ))
    }),
    part({
      table: "cards", alias: "ca",
      joins: [
        { table: "pipeline_stages", alias: "ps", on: eq(c("ps", "id"), c("ca", "stage_id")) },
        { table: "pipelines", alias: "p", on: and(eq(c("p", "id"), c("ca", "pipeline_id")), eq(c("p", "key"), lit("optimization"))) },
        sameClient("k", "ca", "client_id")
      ],
      // A demo card is marked, and so is a demo client; a card made before the mark existed has only its client's.
      where: and(notDemo("ca"), notDemo("k"), notNull(c("p", "id")), eq(c("ps", "key"), lit("stalled"))),
      bad: olderThanMinutes(c("ca", "updated_at"), STUCK_CARD_MINUTES)
    })
  ]
);

// ───────────────────────── Public climate page ─────────────────────────

gap(
  "See how many banks in our book fit your state: scrolls to the form (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
  "The shipped page public/climate/index.html is a lending-climate dashboard with no such button, and no page in public/ calls the climate match door. The control is not on any page that ships, and a scroll saves no row, so there is nothing to click and nothing saved to read. The live page is read again on every run, so this goes back to not proved the day the control ships.",
  {
    notShipped: Object.freeze({
      path: "/climate/",
      // The words the journey gives the button, and the lead door the form behind it would call.
      markers: Object.freeze([
        "See how many banks in our book fit your state", "climate-match", "climate_match", "website:climate"
      ]),
      // The other route under /climate/ is read too: the button could ship there.
      paths: Object.freeze(["/climate/lender-climate/"])
    })
  }
);

check(
  "climate-lead-saved",
  "Four answers (home state required, business state, do you have a business, your credit guess) plus name, email, phone: POST /api/public/climate-match returns the count, lane counts and five bank names, and saves the lead (clients row, entry.captured, survey.submitted) (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
  "Every lead the climate page filed must have a client row in the same company, both the entry and survey events on that client, and the home state kept as two letters.",
  part({
    table: "events", alias: "e",
    joins: [sameClient("k", "e", "client_id")],
    where: and(notDemo("e"), eq(c("e", "name"), lit("entry.captured")), eq(jtext(c("e", "payload"), "source"), lit("website:climate"))),
    bad: or(
      isNull(c("e", "client_id")), isNull(c("k", "id")),
      missing("events", "s", and(
        eq(c("s", "org_id"), c("e", "org_id")), eq(c("s", "name"), lit("survey.submitted")), eq(c("s", "client_id"), c("e", "client_id")),
        eq(jtext(c("s", "payload"), "source"), lit("website:climate"))
      )),
      notMatches(jtext(c("k", "custom_fields"), "home_state"), "^[A-Z]{2}$")
    )
  })
);

export const FIN_B06_DISPLAY_CONTRACTS = Object.freeze([
  ...FIN_B06_CHECKS.map((entry) => entry.contract),
  ...FIN_B06_GAPS
]);

/** Controls whose old not-proved placeholder in display-saved-result.mjs is replaced by a check above. */
export const FIN_B06_REPLACED_CONTROLS = Object.freeze(
  FIN_B06_DISPLAY_CONTRACTS.map((entry) => entry.control)
);
