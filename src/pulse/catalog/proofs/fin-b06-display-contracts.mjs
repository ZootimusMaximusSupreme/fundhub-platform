// Batch 06 display controls (tier 3, customer data). Each check below is a live saved-result contract:
// one read-only SQL that returns sample_count (saved results that exist) and bad_count (how many are wrong),
// run by src/pulse/coverage/gap-catalog-display.mjs against the real company. A control nobody has used yet
// has no results, so it is green ("emptyAs: quiet") and goes red on the first wrong one.
//
// Each check is built from one definition that prints the SQL and also runs as a JavaScript judge over
// stand-in rows (fin-b06-sql-kit.mjs), so the test file can break the data on purpose and see it go red.
// There is no local Postgres on the build Mac: the SQL itself is checked against db/schema and
// db/migrations by fin-b06-schema.mjs, not executed here.

import { createHash } from "node:crypto";

import { OFFERS } from "../../../config/offers.mjs";
import { disclosureFor, versionsFor } from "../../../consent/disclosures.mjs";
import {
  afterNow, and, blank, bodyHash, c, charLength, contract, custom, distinct, elem, eq, equal, exists, existsElement,
  gt, hasBlueprintTransaction, isNull, jsonGet, jtext, jtype, lit, lowerTrim, lt, matches, missing, newerThanDays,
  not, notDemo, notMatches, notNull, notOneOf, numberFrom, olderThanMinutes, oneOf, or, part, trimmed, earlier,
  valuesTable
} from "./fin-b06-sql-kit.mjs";

const sha256Hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const BLUEPRINT = OFFERS.UWIQ_DELIVERABLES.productCode;

export const FIN_B06_CHECKS = [];

function check(key, control, requirement, parts, { quiet = true } = {}) {
  FIN_B06_CHECKS.push(Object.freeze({
    key, control, requirement, parts: Array.isArray(parts) ? parts : [parts],
    contract: contract({ control, requirement, key, parts, quiet })
  }));
}

/** An honest "no saved result can show this". Stays NOT_PROVED and says exactly what is missing. */
export const FIN_B06_GAPS = [];
function gap(control, requirement) {
  FIN_B06_GAPS.push(Object.freeze({ control, mode: "always-red", requirement, sql: null }));
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
  "Every live credit-partner link must point at a real partner client in the same company with a first name, last name, an email and the Blueprint partner tag, on a primary client who bought the Capital Blueprint.",
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
      not(hasBlueprintTransaction(c("l", "primary_client_id"), "l", BLUEPRINT))
    )
  })
);

const READY_DATE = jtext(c("c", "custom_fields"), "blueprint_next_sequence_ready_date");
check(
  "blueprint-ready-date",
  "Capital Blueprint: Save ready date button",
  "Every client with a saved next-funding-sequence ready date must hold a real YYYY-MM-DD day and must be a Capital Blueprint buyer, because the daily closer alert reads that day.",
  part({
    table: "clients", alias: "c",
    where: and(notDemo("c"), not(blank(READY_DATE))),
    bad: or(
      notMatches(READY_DATE, "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"),
      not(hasBlueprintTransaction(c("c", "id"), "c", BLUEPRINT))
    )
  })
);

const TRACKER_FLAG = jtext(c("c", "custom_fields"), "blueprint_bank_tracker_offered");
check(
  "blueprint-tracker-offered",
  "Capital Blueprint: Offer bank tracker button",
  "Every client flagged as offered the bank tracker must be a Capital Blueprint buyer, because the offer is refused for anyone else.",
  part({
    table: "clients", alias: "c",
    where: and(notDemo("c"), eq(TRACKER_FLAG, lit("true"))),
    bad: not(hasBlueprintTransaction(c("c", "id"), "c", BLUEPRINT))
  })
);

check(
  "blueprint-tracker-taken-back",
  "Capital Blueprint: Take the offer back button",
  "Every client whose bank tracker offer was taken back must be a Capital Blueprint buyer, because the switch is refused for anyone else.",
  part({
    table: "clients", alias: "c",
    where: and(notDemo("c"), eq(TRACKER_FLAG, lit("false"))),
    bad: not(hasBlueprintTransaction(c("c", "id"), "c", BLUEPRINT))
  })
);

check(
  "blueprint-bank-todo",
  "Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs)",
  "Every saved bank-list row must sit on a client in the same company, with the bank key trimmed to lower case and an account kind of personal or business.",
  part({
    table: "blueprint_bank_relationship_todos", alias: "t",
    joins: [sameClient("k", "t", "client_id")],
    bad: or(
      isNull(c("k", "id")),
      blank(c("t", "bank_key")),
      distinct(c("t", "bank_key"), lowerTrim(c("t", "bank_key"))),
      notOneOf(c("t", "account_kind"), ["personal", "business"])
    )
  })
);

gap(
  "Capital Blueprint: Bank list state buttons",
  "The state is one of open, done or skipped, which the database already refuses to break, and the click saves no receipt of who moved it or when. No saved row can tell a right click from a wrong one."
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

function uploadDoor(key, control, requirement, { kind, uploader }) {
  check(key, control, requirement, part({
    table: "documents", alias: "d",
    joins: [
      { table: "document_versions", alias: "v", on: and(eq(c("v", "id"), c("d", "current_version_id")), eq(c("v", "document_id"), c("d", "id"))) },
      sameClient("k", "d", "client_id")
    ],
    where: and(notDemo("d"), eq(c("d", "kind"), lit(kind)), eq(jtext(c("d", "metadata"), "uploaded_by", "kind"), lit(uploader))),
    bad: or(
      isNull(c("v", "id")),
      blank(c("v", "storage_key")),
      distinct(c("d", "storage_key"), c("v", "storage_key")),
      blank(c("v", "checksum")),
      distinct(c("d", "checksum"), c("v", "checksum")),
      and(notNull(c("v", "byte_size")), not(gt(c("v", "byte_size"), lit(0)))),
      isNull(c("k", "id")),
      and(notNull(jtext(c("d", "metadata"), "label", "filed_as")), distinct(jtext(c("d", "metadata"), "label", "filed_as"), c("d", "subtype")))
    )
  }));
}

uploadDoor(
  "documents-staff-dropzone",
  "Documents toggle, drop zone, file input, drag and drop upload",
  "Every file staff dropped on a client file must have a current version with a stored object and checksum that match the document row, sit on a client in the same company, and be filed under the type it was labeled with.",
  { kind: "client_upload", uploader: "staff" }
);
uploadDoor(
  "documents-door-identity",
  "Upload door: ID and personal documents (type select, Upload button, file picker)",
  "Every file a client sent through the ID and personal documents door must have a current version with a stored object and checksum that match the document row, sit on that client, and be filed under the type chosen in the select.",
  { kind: "client_upload", uploader: "client" }
);
uploadDoor(
  "documents-door-inquiry",
  "Upload door: Inquiry documents (type select, Upload button, file picker)",
  "Every file a client sent through the inquiry documents door must be an inquiry document with a current version, stored object and checksum that match the document row, on that client, filed under the chosen type.",
  { kind: "inquiry_doc", uploader: "client" }
);
uploadDoor(
  "documents-door-bureau",
  "Upload door: bureau response (type select, Upload button, file picker)",
  "Every file a client sent through the bureau response door must be a bureau response with a current version, stored object and checksum that match the document row, on that client, filed under the chosen type.",
  { kind: "bureau_response", uploader: "client" }
);

check(
  "documents-download-link",
  "What You Own: Download link per file",
  "Every deliverable document a client can own must point at a current version and a stored object, because the signed download link reads exactly that object.",
  part({
    table: "documents", alias: "d",
    joins: [{ table: "document_versions", alias: "v", on: and(eq(c("v", "id"), c("d", "current_version_id")), eq(c("v", "document_id"), c("d", "id"))) }],
    where: and(
      notDemo("d"), eq(c("d", "kind"), lit("deliverable")),
      oneOf(c("d", "subtype"), [
        "credit_analysis_report", "credit_optimization_roadmap", "funding_snapshot", "bank_lender_match_list", "metro2_dispute_letter_pack"
      ])
    ),
    bad: or(isNull(c("v", "id")), blank(c("d", "storage_key")), blank(c("v", "storage_key")))
  })
);

// ───────────────────────── Identity, consent and signing ─────────────────────────

check(
  "identity-on-file-after-approval",
  "Identity-on-file state line and client approval link box + Copy link",
  "Every soft-pull approval a client typed through the approval link in the last year must have left an identity on file with the encrypted number, because the state line reads that row.",
  part({
    table: "client_consents", alias: "k",
    joins: [{ table: "pii_identity", alias: "i", on: and(eq(c("i", "client_id"), c("k", "client_id")), eq(c("i", "org_id"), c("k", "org_id"))) }],
    where: and(
      eq(c("k", "kind"), lit("soft_pull_consent")), eq(c("k", "granted_by_kind"), lit("client")),
      eq(c("k", "capture_method"), lit("typed")), isNull(c("k", "revoked_at")), newerThanDays(c("k", "granted_at"), 365)
    ),
    bad: or(isNull(c("i", "id")), isNull(c("i", "ssn_enc")))
  })
);

const WORDS_KINDS = ["dispute_authorization", "call_recording", "marketing_use"];
function wordsTable() {
  const rows = [];
  for (const kind of WORDS_KINDS) {
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
  "Every stored dispute authorization, call recording and marketing use consent must name a wording version the server holds and carry exactly that version's words, because the screen shows the server's words and never the caller's.",
  part({
    table: "client_consents", alias: "k",
    joins: [wordsTable()],
    where: oneOf(c("k", "kind"), WORDS_KINDS),
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
      wordsTable()
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

gap(
  "Sign to authorize dispute letters: signature pad (draw)",
  "The page checks that ink was drawn, then sends only the typed name and the word signature. The drawing is never sent or saved, so no saved row can show whether the pad was drawn on."
);
gap(
  "Sign to authorize dispute letters: legal name input",
  "The typed name is saved as granted_name, and the database already refuses a signature with no name. It is saved nowhere else and compared with nothing, so no saved row can show a wrong name."
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
check(
  "client-notes-saved",
  "Notes textarea and Save notes button",
  "Every saved staff note on a client file must be plain text no longer than the 20,000 character limit the save enforces.",
  part({
    table: "clients", alias: "k",
    where: and(notDemo("k"), or(notNull(NOTES), notNull(STAFF_NOTES))),
    bad: or(
      and(notNull(NOTES), distinct(jtype(NOTES), lit("string"))),
      and(notNull(STAFF_NOTES), distinct(jtype(STAFF_NOTES), lit("string"))),
      gt(charLength(jtext(c("k", "custom_fields"), "notes")), lit(20000)),
      gt(charLength(jtext(c("k", "custom_fields"), "staff_notes")), lit(20000))
    )
  })
);

const INCORPORATED = jtext(c("b", "entity_data"), "incorporated_date");
const MONTHS_OLD = custom(
  `CASE WHEN ${INCORPORATED.sql} ~ '^[0-9]{4}-(0[1-9]|1[0-2])' THEN (extract(year from now())::int - substr(${INCORPORATED.sql}, 1, 4)::int) * 12 + (extract(month from now())::int - substr(${INCORPORATED.sql}, 6, 2)::int) END`,
  (ctx, db) => {
    const v = INCORPORATED.ev(ctx, db);
    if (v === null || !/^[0-9]{4}-(0[1-9]|1[0-2])/.test(v)) return null;
    const now = new Date(db.now);
    return (now.getUTCFullYear() - Number(v.slice(0, 4))) * 12 + (now.getUTCMonth() + 1 - Number(v.slice(5, 7)));
  }
);
check(
  "business-incorporated-stamp",
  "Businesses cards: Save month/year button (stamp incorporation)",
  "Every business with a saved incorporation month must hold it as YYYY-MM or YYYY-MM-DD, belong to a client in the same company, and carry an age in months that is not negative and not older than the date allows.",
  part({
    table: "businesses", alias: "b",
    joins: [sameClient("k", "b", "client_id")],
    where: not(blank(INCORPORATED)),
    bad: or(
      isNull(c("k", "id")),
      notMatches(INCORPORATED, "^[0-9]{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?$"),
      isNull(c("b", "age_months")),
      lt(c("b", "age_months"), lit(0)),
      gt(c("b", "age_months"), MONTHS_OLD)
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
check(
  "contract-wording-edited",
  "Save (edit an existing wording)",
  "Every wording that was edited must still have a name, words and a signature sentence and name a staff editor in the same company, and every contract already sent must still hold words that match its stored fingerprint.",
  [
    part({
      table: "contract_templates", alias: "t",
      joins: [STAFF_JOIN("s", "t", "updated_by")],
      where: and(notDemo("t"), notNull(c("t", "updated_by"))),
      bad: or(blank(c("t", "name")), blank(c("t", "body")), blank(c("t", "signature_statement")), isNull(c("s", "id")))
    }),
    part({
      table: "contracts", alias: "k",
      where: and(notDemo("k"), oneOf(c("k", "status"), ["sent", "viewed", "signed"]), notNull(c("k", "rendered_body"))),
      bad: or(isNull(c("k", "body_sha")), distinct(c("k", "body_sha"), FROZEN_HASH))
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

gap(
  "Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too)",
  "The switch saves one true or false in entitlement_catalog.active with no receipt of what was submitted. Both values are valid, so no saved row can tell a right flip from a wrong one."
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

check(
  "inquiry-bureau-call",
  "Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once fired)",
  "Every bureau call that was placed must have left its number-reveal log entry for that client and a case marked as fired, so the call is neither unlogged nor repeated.",
  part({
    table: "outbound_calls", alias: "o",
    where: eq(c("o", "kind"), lit("inquiry_bureau")),
    bad: or(
      missing("pii_access_log", "p", and(
        eq(c("p", "client_id"), c("o", "client_id")), eq(c("p", "org_id"), c("o", "org_id")),
        eq(c("p", "field"), lit("ssn (bureau_dispute_call)"))
      )),
      missing("inquiry_removal_cases", "r", and(
        eq(c("r", "client_id"), c("o", "client_id")), eq(c("r", "org_id"), c("o", "org_id")), notNull(c("r", "call_fired_at"))
      ))
    )
  })
);

check(
  "repair-parse-confirmed",
  "'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked' button",
  "Every bureau answer that needed a person (low confidence or held for escalation) and is marked checked must carry the confirm time and a staff member in the same company who confirmed it.",
  part({
    table: "dispute_responses", alias: "r",
    joins: [STAFF_JOIN("s", "r", "confirmed_by")],
    where: and(
      eq(c("r", "confirmed"), lit(true)),
      or(lt(c("r", "confidence"), lit(0.85)), eq(jtext(c("r", "parse_json"), "heldForEscalation"), lit("true")))
    ),
    bad: or(isNull(c("r", "confirmed_at")), isNull(c("r", "confirmed_by")), isNull(c("s", "id")))
  })
);

// ───────────────────────── Public climate page ─────────────────────────

gap(
  "See how many banks in our book fit your state: scrolls to the form (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
  "The button only moves the page down to the form. It sends no request and saves no row, and the page is a compiled bundle with no source contract, so no saved row can show the scroll happened."
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
