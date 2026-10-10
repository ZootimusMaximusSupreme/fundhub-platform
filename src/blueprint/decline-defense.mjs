// Capital Blueprint — decline defense, the storing half.
//
// src/blueprint/decline-analyze.mjs reads a bank's decline (pure). This file
// keeps the answer: the decline row and its plan (migration 470), the ops task
// on the existing queue, the bank's answer on the application, and the outcome.
// api/blueprint/declines.mjs gates and calls it.
//
// WHO MAY DO WHAT
//   client  paste their own decline letter, link a letter they uploaded, read
//           their own status in plain words. Never changes an application.
//   staff   all of that, plus record a decline for an application, mark steps,
//           fill blanks, set the call date, record the outcome.
//   Writes need a paid Capital Blueprint (isCapitalBlueprintBuyer), the same
//   rule api/blueprint/staff-actions.mjs uses; reads do not.
//
// THE APPLICATION ROW STAYS TRUE. applications.status is what the BANK said
// (src/applications/status.mjs). When STAFF record a decline for an application
// it is set to Denied; when staff record "approved on reconsideration" it is set
// to Approved, with the amount if they typed one (blank stays unknown, never 0).
// Both go through setApplicationStatus, so each writes its application_decisions
// row. A client's paste never changes an application — a person confirms first.
// The status change runs AFTER the decline is committed, never inside our
// transaction: setApplicationStatus may re-issue a billed success fee
// (flagBilledFeeDrift → its own withTransaction), and a client already inside a
// transaction cannot open another. A retry heals a status change that failed:
// it runs again on a duplicate record and on every outcome save.
//
// THE OPS TASK, ONCE. One task per decline, on the funding advisor's queue
// (the bank-facing role F-09 and F-11 already use for DENIED bank emails). Its
// body is short on purpose — tasks.body sits in a unique btree index
// (db/schema/006_tasks_idempotency.sql), which refuses entries over ~2.7 KB —
// and it never carries lender-book lines: any staff session can read any task
// (api/tasks.mjs), and the book is ROLE_SETS.LENDERS only.
//
// NEXT FUNDING SEQUENCE. A still-declined or re-apply-later outcome is handed to
// the next funding sequence as a NOTE (declineNotesForNextSequence). It never
// sets the ready date — src/blueprint/next-funding-sequence.mjs owns that.

import { createTask } from "../lib/create-task.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";
import { setApplicationStatus, normalizeApprovedAmount, ApplicationStatusError } from "../applications/status.mjs";
import {
  analyzeDecline, letterHash, maskSensitive, bankKeys, bureausNamed, outcomeWords, staffOutcomeWords,
  nextSequenceNote, dayWords, dayOf, categoryOf, sourceRefText, MAX_LETTER_CHARS, MIN_LETTER_CHARS, OUTCOMES
} from "./decline-analyze.mjs";

export const SOURCE_WORKFLOW = "blueprint-decline-defense";
export const TASK_ROLE = "funding_advisor";
export const TASK_BODY_MAX_BYTES = 1800;
/* A queue guard, not a bank rule: one client's pastes can open at most this many
   new declines (and so ops tasks) in a day. Change it here. */
export const CLIENT_PASTES_PER_DAY = 5;
const BUREAUS = new Set(["experian", "equifax", "transunion"]);
const APPLICATION_COLS = "id, bank, lender_name, lender_id, product_name, status, submitted_date, updated_at";

export class DeclineInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DeclineInputError";
    this.code = code;
    this.status = status;
  }
}

const isUuidish = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

/** YYYY-MM-DD or null; anything else throws the named input error. */
export function parseDay(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const s = String(value).trim();
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime())
    && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
  if (!ok) throw new DeclineInputError(`invalid_${field}`, `The ${field.replace(/_/g, " ")} must be a date like 2026-12-01.`);
  return s;
}

function cleanText(v, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function bureauList(v) {
  const list = Array.isArray(v) ? v : (v ? String(v).split(/[\s,]+/) : []);
  const out = [];
  for (const b of list) {
    const k = String(b || "").trim().toLowerCase().replace(/^ex$/, "experian").replace(/^eq$/, "equifax").replace(/^tu$/, "transunion");
    if (BUREAUS.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

function actorName(by) {
  if (!by) return null;
  if (by.kind === "client") return "client";
  return String(by.name || by.email || by.staffId || "staff").slice(0, 200);
}

/* ── the lender book ─────────────────────────────────────────────────────── */

/** Book rows for a bank: the application's own lender row, or every row whose
 *  name reduces to the same key ("Chase" and "Chase Bank"). */
export async function findBookRows(db, { orgId, bank = null, lenderId = null } = {}) {
  if (!orgId) return [];
  const keys = bankKeys(bank);
  if (!isUuidish(lenderId) && !keys.length) return [];
  const r = await db.query(
    `SELECT id, name, lender_table, product_name, bureaus_pulled, relationship_required,
            requires_account_opening, insider_tips, notes, underwriter_interaction,
            relationship_manager, branch_location_info, minimum_time_in_business_years,
            minimum_revenue_threshold
       FROM lenders
      WHERE org_id = $1::uuid
        AND (id = $2::uuid
             OR (active = true AND regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') = ANY($3::text[])))
      ORDER BY (id = $2::uuid) DESC, priority_tier NULLS LAST, name
      LIMIT 12`,
    [orgId, isUuidish(lenderId) ? lenderId : null, keys]
  );
  return r.rows;
}

/* ── shaping ─────────────────────────────────────────────────────────────── */

function stepRow(s, i) {
  const sources = Array.isArray(s.sources) ? s.sources : [];
  return {
    position: i + 1,
    step_key: s.key,
    who: s.who,
    step_text: s.blank ? null : s.step,
    client_text: s.client_step,
    source_kind: s.blank ? null : (sources[0] && sources[0].kind) || null,
    source_ref: s.blank ? null : ((sourceRefText(sources) || "").slice(0, 400) || null),
    is_blank: !!s.blank,
    blank_label: s.blank ? s.blank_label : null,
    status: s.status === "done" ? "done" : "open",
    filled_text: s.filled || null
  };
}

/** The ops task body: short, stable, no lender-book lines. */
export function taskBody({ decline, analysis, steps }) {
  const lines = [];
  const what = [decline.bank, decline.product].filter(Boolean).join(" · ");
  const when = dayWords(decline.declined_on);
  lines.push("Bank decline — ask for a second look (Capital Blueprint decline defense).");
  lines.push([what, when ? `declined ${when}` : null, decline.source === "client_paste" ? "pasted by the client" : "recorded by staff"].filter(Boolean).join(" · "));
  const reasons = (analysis.reasons || []).map((r) => r.label);
  lines.push(`Likely reasons: ${reasons.length ? reasons.join("; ") : "none found yet"}.`);
  if (analysis.needs_person) lines.push(`Needs a person: ${analysis.needs_person_why}`);
  const open = steps.filter((s) => s.status === "open" && (s.who === "agent" || s.who === "ops"));
  const blanks = open.filter((s) => s.is_blank).length;
  const worded = open.filter((s) => !s.is_blank && s.source_kind !== "book");
  const footer = [
    blanks ? `Blanks to write: ${blanks}.` : null,
    "Full plan, sources, lender-book notes and the outcome: client file → Capital Blueprint → Declines. Record the outcome there, then close this task.",
    `ref blueprint-decline:${decline.id}`
  ].filter(Boolean);
  const head = `${lines.join("\n")}\nOpen steps:\n`;
  let body = head;
  let shown = 0;
  for (const s of worded) {
    const line = `• [${s.who}] ${s.step_text} (${s.source_ref})\n`;
    if (Buffer.byteLength(body + line + footer.join("\n"), "utf8") > TASK_BODY_MAX_BYTES - 80) break;
    body += line;
    shown += 1;
  }
  if (shown < worded.length) body += `• …and ${worded.length - shown} more on the decline.\n`;
  body += footer.join("\n");
  // Hard stop: never past the index's comfort zone, whatever the inputs were.
  while (Buffer.byteLength(body, "utf8") > TASK_BODY_MAX_BYTES) body = body.slice(0, body.length - 64);
  return body;
}

function shapeStep(row, { canSeeBook }) {
  const book = row.source_kind === "book";
  return {
    key: row.step_key,
    position: row.position,
    who: row.who,
    text: book && !canSeeBook ? "A lender-book note for this bank (the funding advisor sees it)." : row.step_text,
    client_text: row.client_text,
    source_kind: row.source_kind,
    source_ref: book && !canSeeBook ? "lender book" : row.source_ref,
    blank: row.is_blank,
    blank_label: row.blank_label,
    status: row.status,
    filled_text: row.step_key === "find_recon_line" && !canSeeBook && /Lender book/.test(String(row.filled_text || ""))
      ? String(row.filled_text).split(" · ").filter((p) => !/^Lender book/.test(p)).join(" · ") || null
      : row.filled_text,
    done_at: row.done_at || null,
    done_by: row.done_by || null
  };
}

/** The full staff view of one decline. Lender-book lines only for LENDERS roles. */
export function staffDecline(row, steps, { canSeeBook = false } = {}) {
  const a = row.analysis || {};
  const facts = a.bank_facts || {};
  return {
    id: row.id,
    application_id: row.application_id,
    bank: row.bank,
    product: row.product,
    declined_on: dayOf(row.declined_on),
    bureaus_pulled: row.bureaus_pulled || [],
    source: row.source,
    recorded_by: row.recorded_by,
    created_at: row.created_at,
    looks_like: row.looks_like,
    looks_like_words: a.looks_like_words || null,
    reasons: (a.reasons || []).map((r) => ({ category: r.category, label: r.label, evidence_quote: r.evidence_quote, sources: r.sources })),
    unknown_parts: a.unknown_parts || [],
    needs_person: row.needs_person,
    needs_person_why: a.needs_person_why || null,
    letter_text: row.letter_text,
    letter_document_id: row.letter_document_id,
    letter_phones: a.letter_phones || [],
    timing: a.timing || null,
    rm_on_file: !!facts.rm_on_file,
    book: canSeeBook
      ? {
          rows_found: facts.rows_found || 0,
          phones: facts.book_phones || [],
          notes: facts.book_notes || [],
          relationship_required: facts.relationship_required ?? null,
          requires_account_opening: facts.requires_account_opening ?? null,
          bureaus_pulled: facts.bureaus_pulled || []
        }
      : null,
    steps: steps.map((s) => shapeStep(s, { canSeeBook })),
    recon_on: dayOf(row.recon_on),
    outcome: row.outcome,
    outcome_words: staffOutcomeWords(row.outcome),
    outcome_approved_amount: row.outcome_approved_amount == null ? null : String(row.outcome_approved_amount),
    reapply_on: dayOf(row.reapply_on),
    outcome_notes: row.outcome_notes,
    outcome_by: row.outcome_by,
    outcome_at: row.outcome_at,
    task_id: row.task_id,
    next_sequence_note: nextSequenceNote({ ...row, reapply_on: dayOf(row.reapply_on) })
  };
}

/** YYYY-MM-DD of a timestamp in America/Phoenix, or null. */
export function arizonaDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" });
}

/** The client's view of one decline: plain words, their own letter's words, no
 *  sources, no lender book, no ops scripts. */
export function clientDecline(row, steps) {
  const a = row.analysis || {};
  const reapply = dayOf(row.reapply_on);
  const callOn = dayOf(row.recon_on);
  const yours = steps.filter((s) => s.who === "client");
  const ours = steps.filter((s) => s.who !== "client");
  return {
    id: row.id,
    application_id: row.application_id,
    bank: row.bank,
    product: row.product,
    declined_on: dayOf(row.declined_on),
    // The calendar day the letter reached us, on the clock the money screens
    // use (America/Phoenix) — a UTC day reads as tomorrow every US evening.
    received_on: arizonaDay(row.created_at),
    looks_like_words: a.looks_like_words || null,
    status_words: outcomeWords(row.outcome, reapply),
    outcome: row.outcome,
    reasons: (a.reasons || []).map((r) => ({ label: r.label, words: r.client_words, quote: r.evidence_quote })),
    unknown_parts: a.unknown_parts || [],
    needs_person: row.needs_person,
    needs_person_why: a.needs_person_why || null,
    your_steps: yours.map((s) => ({ text: s.client_text, status: s.status })),
    fundhub_steps: ours.map((s) => ({ text: s.client_text, status: s.status })),
    fundhub_done: ours.filter((s) => s.status !== "open").length,
    fundhub_total: ours.length,
    when: ((a.timing && a.timing.reapply) || []).map((w) => w.text),
    call_on: callOn,
    reapply_on: reapply,
    has_letter_file: !!row.letter_document_id
  };
}

const APP_WORDS = Object.freeze({
  Apply: "Ready to apply",
  Applied: "Waiting on the bank",
  Approved: "Approved",
  Denied: "Declined",
  "Missing Docs": "The bank needs papers",
  "Action Required": "The bank needs something from you"
});
export function applicationWords(status) { return APP_WORDS[status] || "Status not set"; }

/* ── reads ───────────────────────────────────────────────────────────────── */

async function loadDeclines(db, { orgId, clientId, ids = null }) {
  const d = await db.query(
    `SELECT * FROM blueprint_declines
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
      ORDER BY created_at DESC
      LIMIT 50`,
    [orgId, clientId, ids]
  );
  const declineIds = d.rows.map((r) => r.id);
  const steps = declineIds.length
    ? (await db.query(
      `SELECT * FROM blueprint_decline_steps
        WHERE org_id = $1::uuid AND decline_id = ANY($2::uuid[])
        ORDER BY decline_id, position`,
      [orgId, declineIds]
    )).rows
    : [];
  const byDecline = new Map();
  for (const s of steps) {
    if (!byDecline.has(s.decline_id)) byDecline.set(s.decline_id, []);
    byDecline.get(s.decline_id).push(s);
  }
  return d.rows.map((row) => ({ row, steps: byDecline.get(row.id) || [] }));
}

/* Its own select, not listClientApplications (src/applications/status.mjs):
   that one is the fee screen's read and does not carry product_name, which is
   the half of "Chase · Ink Business Cash" a client recognises. */
async function loadApplications(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT ${APPLICATION_COLS}
       FROM applications
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY updated_at DESC
      LIMIT 100`,
    [orgId, clientId]
  );
  return r.rows;
}

/**
 * Everything one client file shows about declines.
 * viewer: { kind: "client" } | { kind: "staff", canSeeBook }
 * Returns null when the client is not in this org.
 */
export async function readDeclines(db, { orgId, clientId, viewer = { kind: "client" } } = {}) {
  const c = await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`,
    [clientId, orgId]
  );
  const client = c.rows[0];
  if (!client) return null;
  const [eligible, declines, apps] = await Promise.all([
    isCapitalBlueprintBuyer(db, { orgId, clientId }),
    loadDeclines(db, { orgId, clientId }),
    loadApplications(db, { orgId, clientId })
  ]);
  const byApp = new Map(declines.filter((d) => d.row.application_id).map((d) => [d.row.application_id, d.row]));
  const view = {
    client: { id: client.id, name: [client.first_name, client.last_name].filter(Boolean).join(" ") || null },
    eligible,
    can_paste: eligible,
    applications: apps.map((a) => {
      const d = byApp.get(a.id);
      return {
        id: a.id,
        bank: a.lender_name || a.bank || null,
        product: a.product_name || null,
        status_words: applicationWords(a.status),
        decline_id: d ? d.id : null,
        decline_words: d ? outcomeWords(d.outcome, dayOf(d.reapply_on)) : null
      };
    }),
    declines: declines.map((d) => clientDecline(d.row, d.steps))
  };
  if (viewer.kind !== "staff") return { view };

  const emails = await db.query(
    `SELECT id, subject, body_preview, created_at
       FROM bank_inbox
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND classification = 'DENIED'
      ORDER BY created_at DESC
      LIMIT 10`,
    [orgId, clientId]
  );
  return {
    view,
    staff: {
      can_see_book: !!viewer.canSeeBook,
      eligible,
      applications: apps.map((a) => ({
        id: a.id, bank: a.lender_name || a.bank || null, product: a.product_name || null,
        status: a.status, lender_id: a.lender_id, submitted_date: dayOf(a.submitted_date),
        decline_id: byApp.has(a.id) ? byApp.get(a.id).id : null
      })),
      declines: declines.map((d) => staffDecline(d.row, d.steps, { canSeeBook: !!viewer.canSeeBook })),
      bank_emails: emails.rows.map((e) => ({ id: e.id, subject: e.subject, preview: e.body_preview, created_at: e.created_at })),
      next_sequence_notes: declines.map((d) => nextSequenceNote({
        ...d.row, reapply_on: dayOf(d.row.reapply_on)
      })).filter(Boolean)
    }
  };
}

/** The seam for the next funding sequence planner. Notes only — never a date it sets. */
export async function declineNotesForNextSequence(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return [];
  const r = await db.query(
    `SELECT id, bank, product, outcome, reapply_on
       FROM blueprint_declines
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND outcome IN ('still_declined', 'reapply_later')
      ORDER BY COALESCE(reapply_on, outcome_at::date) ASC NULLS LAST`,
    [orgId, clientId]
  );
  return r.rows.map((row) => {
    const reapply = dayOf(row.reapply_on);
    return { decline_id: row.id, bank: row.bank, product: row.product, outcome: row.outcome, reapply_on: reapply,
      note: nextSequenceNote({ ...row, reapply_on: reapply }) };
  });
}

/* ── writes ──────────────────────────────────────────────────────────────── */

async function loadOwnDecline(db, { orgId, clientId, declineId }) {
  if (!isUuidish(declineId)) throw new DeclineInputError("decline_id_required", "Send the decline_id of the decline to change.");
  const r = await db.query(
    `SELECT * FROM blueprint_declines WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
    [declineId, orgId, clientId]
  );
  if (!r.rows[0]) throw new DeclineInputError("not_found", "That decline is not on this client's file.", 404);
  return r.rows[0];
}

async function assertDocumentOfClient(db, { orgId, clientId, documentId }) {
  if (!isUuidish(documentId)) throw new DeclineInputError("invalid_document_id", "The letter file id is not valid.");
  const r = await db.query(
    `SELECT id FROM documents WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
    [documentId, orgId, clientId]
  );
  if (!r.rows[0]) throw new DeclineInputError("document_not_found", "That letter file is not on this client's file.", 404);
}

/**
 * Record a decline and build its plan. One function for both doors:
 *   source "client_paste" — a client pasted their letter (text required).
 *   source "staff"        — staff recorded it (text optional; an application
 *                           link sets that application to Denied).
 *
 * @returns {{ ok: true, created: boolean, duplicate?: boolean, decline_id, analysis, task }}
 *        | {{ ok: false, error }}  (not_blueprint_buyer, too_many_pastes)
 */
export async function recordDecline(db, { orgId, clientId, by, source, input = {}, staff = null, now = new Date(), deps = {} } = {}) {
  const setStatus = deps.setApplicationStatus || setApplicationStatus;
  const makeTask = deps.createTask || createTask;
  if (!orgId || !clientId) throw new DeclineInputError("missing_ids", "client_id is required.");
  if (source !== "staff" && source !== "client_paste") throw new DeclineInputError("invalid_source", "Unknown source.");

  const rawText = input.text == null ? "" : String(input.text);
  if (rawText.length > MAX_LETTER_CHARS) {
    throw new DeclineInputError("letter_too_long", "That is longer than a bank letter. Paste just the letter or email from the bank.");
  }
  const hasText = rawText.replace(/\s+/g, "").length >= MIN_LETTER_CHARS;
  if (source === "client_paste" && !hasText) {
    throw new DeclineInputError("letter_required", "Paste the whole letter or email from the bank.");
  }

  if (!(await isCapitalBlueprintBuyer(db, { orgId, clientId }))) return { ok: false, error: "not_blueprint_buyer" };

  let application = null;
  if (input.application_id) {
    if (!isUuidish(input.application_id)) throw new DeclineInputError("invalid_application_id", "The application id is not valid.");
    const a = await db.query(
      `SELECT ${APPLICATION_COLS} FROM applications WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
      [input.application_id, orgId, clientId]
    );
    application = a.rows[0] || null;
    if (!application) throw new DeclineInputError("application_not_found", "That application is not on this client's file.", 404);
    if (application.status === "Approved") {
      throw new DeclineInputError("application_approved", "That application is marked approved, so a decline cannot be recorded on it.", 409);
    }
  }

  const bank = cleanText(input.bank, 120) || (application && cleanText(application.lender_name || application.bank, 120));
  if (!bank) throw new DeclineInputError("bank_required", "Tell us which bank sent it.");
  const product = cleanText(input.product, 160) || (application && cleanText(application.product_name, 160)) || null;
  const declinedOn = parseDay(input.declined_on, "declined_on");
  const reconOn = source === "staff" ? parseDay(input.recon_on, "recon_on") : null;
  if (input.letter_document_id) await assertDocumentOfClient(db, { orgId, clientId, documentId: input.letter_document_id });

  if (source === "client_paste") {
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const n = await db.query(
      `SELECT count(*)::int AS n FROM blueprint_declines
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND source = 'client_paste' AND created_at >= $3::timestamptz`,
      [orgId, clientId, since]
    );
    if (Number(n.rows[0] && n.rows[0].n) >= CLIENT_PASTES_PER_DAY) return { ok: false, error: "too_many_pastes" };
  }

  const masked = maskSensitive(rawText).text;
  const storedText = hasText ? masked : null;
  const hash = hasText ? letterHash(masked) : null;
  const lenders = await findBookRows(db, { orgId, bank, lenderId: application && application.lender_id });
  // Both doors are a person saying "the bank said no": the client's "got a no"
  // box, or staff recording a decline.
  const analysis = analyzeDecline({ text: storedText || "", bank, product, lenders, declined: true });
  const bureaus = bureauList(input.bureaus_pulled);
  const bureausPulled = bureaus.length ? bureaus : bureausNamed(storedText || "");
  const steps = analysis.recon_steps.map(stepRow);
  const recordedBy = actorName(by);

  const out = await withTransaction(db, async (tx) => {
    const ins = await tx.query(
      `INSERT INTO blueprint_declines (
         org_id, client_id, application_id, lender_id, bank, product, declined_on, bureaus_pulled,
         letter_text, letter_hash, letter_document_id, looks_like, reason_categories, needs_person,
         analysis, source, recorded_by, recon_on
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::date, $8::text[],
         $9, $10, $11::uuid, $12, $13::text[], $14,
         $15::jsonb, $16, $17, $18::date
       )
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        orgId, clientId, application ? application.id : null, application ? application.lender_id : null,
        bank, product, declinedOn, bureausPulled,
        storedText, hash, input.letter_document_id || null, analysis.looks_like,
        analysis.reasons.map((r) => r.category), analysis.needs_person,
        JSON.stringify(analysis), source, recordedBy, reconOn
      ]
    );
    const row = ins.rows[0];
    if (!row) {
      // The same letter, or a decline already on this application.
      const dup = await tx.query(
        `SELECT id FROM blueprint_declines
          WHERE org_id = $1::uuid AND client_id = $2::uuid
            AND (($3::uuid IS NOT NULL AND application_id = $3::uuid) OR ($4::text IS NOT NULL AND letter_hash = $4::text))
          ORDER BY created_at ASC LIMIT 1`,
        [orgId, clientId, application ? application.id : null, hash]
      );
      return { ok: true, created: false, duplicate: true, decline_id: dup.rows[0] ? dup.rows[0].id : null, analysis, task: null };
    }

    for (const s of steps) {
      await tx.query(
        `INSERT INTO blueprint_decline_steps (
           org_id, decline_id, position, step_key, who, step_text, client_text, source_kind, source_ref,
           is_blank, blank_label, status, filled_text, done_at, done_by
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   CASE WHEN $12::text = 'open' THEN NULL ELSE now() END,
                   CASE WHEN $12::text = 'open' THEN NULL ELSE 'agent (rules)' END)`,
        [orgId, row.id, s.position, s.step_key, s.who, s.step_text, s.client_text, s.source_kind, s.source_ref,
          s.is_blank, s.blank_label, s.status, s.filled_text]
      );
    }

    let task = null;
    const needsTask = steps.some((s) => s.status === "open" && (s.who === "agent" || s.who === "ops"));
    if (needsTask) {
      const body = taskBody({ decline: row, analysis, steps });
      task = await makeTask(tx, {
        orgId,
        clientId,
        title: `Decline defense — ask ${bank} for a second look`.slice(0, 140),
        sourceWorkflow: SOURCE_WORKFLOW,
        assigneeRole: TASK_ROLE,
        body,
        dueAt: reconOn ? `${reconOn}T16:00:00Z` : null
      });
      if (task && task.id) {
        await tx.query(`UPDATE blueprint_declines SET task_id = $2::uuid WHERE id = $1::uuid`, [row.id, task.id]);
      }
    }
    return { ok: true, created: true, decline_id: row.id, analysis, task };
  });

  // The bank said no to this application: the application row says so too.
  // Staff only — a client's paste waits for a person. After the commit, and on a
  // duplicate as well, so a retry finishes a status change that failed.
  if (source === "staff" && application && application.status !== "Denied" && out.decline_id) {
    await setStatus(db, {
      orgId, applicationId: application.id, status: "Denied", eventType: "decline_recorded",
      staff, notes: `Decline recorded in decline defense (${out.decline_id}).`
    });
  }
  return out;
}

/** Link a letter file (uploaded through /api/documents-upload) to a decline. */
export async function linkLetter(db, { orgId, clientId, declineId, documentId, by } = {}) {
  await loadOwnDecline(db, { orgId, clientId, declineId });
  await assertDocumentOfClient(db, { orgId, clientId, documentId });
  await db.query(
    `UPDATE blueprint_declines SET letter_document_id = $2::uuid WHERE id = $1::uuid`,
    [declineId, documentId]
  );
  await db.query(
    `UPDATE blueprint_decline_steps
        SET status = 'done', done_at = now(), done_by = $3
      WHERE decline_id = $1::uuid AND org_id = $2::uuid AND step_key = 'get_letter' AND status = 'open'`,
    [declineId, orgId, actorName(by)]
  );
  return { ok: true, decline_id: declineId, letter_document_id: documentId };
}

/** Mark one plan step done, skipped or open again. A blank needs its words first. */
export async function setStepStatus(db, { orgId, clientId, declineId, stepKey, status, filledText = null, by } = {}) {
  await loadOwnDecline(db, { orgId, clientId, declineId });
  if (!["open", "done", "skipped"].includes(status)) {
    throw new DeclineInputError("invalid_status", "A step is open, done or skipped.");
  }
  const key = String(stepKey || "").trim();
  const s = await db.query(
    `SELECT id, is_blank, filled_text FROM blueprint_decline_steps
      WHERE decline_id = $1::uuid AND org_id = $2::uuid AND step_key = $3`,
    [declineId, orgId, key]
  );
  const row = s.rows[0];
  if (!row) throw new DeclineInputError("step_not_found", "That step is not on this decline.", 404);
  const words = filledText == null ? null : String(filledText).trim().slice(0, 2000) || null;
  if (row.is_blank && status === "done" && !(words || row.filled_text)) {
    throw new DeclineInputError("blank_needs_words", "Write what goes in this blank before you mark it done.");
  }
  const u = await db.query(
    `UPDATE blueprint_decline_steps
        SET status = $2::text,
            filled_text = COALESCE($3::text, filled_text),
            done_at = CASE WHEN $2::text = 'open' THEN NULL ELSE now() END,
            done_by = CASE WHEN $2::text = 'open' THEN NULL ELSE $4::text END
      WHERE id = $1::uuid
      RETURNING step_key, status, filled_text, done_at, done_by`,
    [row.id, status, words, actorName(by)]
  );
  return { ok: true, step: u.rows[0] };
}

/** Staff set (or clear) the day to call the reconsideration line. */
export async function scheduleRecon(db, { orgId, clientId, declineId, reconOn } = {}) {
  const d = await loadOwnDecline(db, { orgId, clientId, declineId });
  const day = parseDay(reconOn, "recon_on");
  await db.query(`UPDATE blueprint_declines SET recon_on = $2::date WHERE id = $1::uuid`, [declineId, day]);
  // Keep the ops task's due date in step. Not its done flag — a person closes it.
  if (d.task_id) {
    await db.query(
      `UPDATE tasks SET due_at = $2::timestamptz, updated_at = now() WHERE id = $1::uuid AND done = false`,
      [d.task_id, day ? `${day}T16:00:00Z` : null]
    );
  }
  return { ok: true, decline_id: declineId, recon_on: day };
}

/**
 * The bank's answer after reconsideration.
 *   approved_on_recon  amount optional (blank stays unknown); linked application → Approved
 *   still_declined     linked application → Denied
 *   reapply_later      needs reapply_on; linked application → Denied
 *   open               back to working it
 */
export async function recordOutcome(db, { orgId, clientId, declineId, outcome, approvedAmount = null, reapplyOn = null, notes = null, staff = null, by, deps = {} } = {}) {
  const setStatus = deps.setApplicationStatus || setApplicationStatus;
  const d = await loadOwnDecline(db, { orgId, clientId, declineId });
  if (!OUTCOMES.includes(outcome)) {
    throw new DeclineInputError("invalid_outcome", "The outcome is open, approved_on_recon, still_declined or reapply_later.");
  }
  let dollars = null;
  if (outcome === "approved_on_recon") {
    try { dollars = normalizeApprovedAmount(approvedAmount); } catch (e) {
      if (e instanceof ApplicationStatusError) throw new DeclineInputError("invalid_approved_amount", e.message);
      throw e;
    }
  }
  const reapply = outcome === "reapply_later" ? parseDay(reapplyOn, "reapply_on") : null;
  if (outcome === "reapply_later" && !reapply) {
    throw new DeclineInputError("reapply_on_required", "Pick the day to apply again.");
  }
  const note = notes == null ? null : String(notes).trim().slice(0, 2000) || null;

  const u = await db.query(
      `UPDATE blueprint_declines
          SET outcome = $2::text,
              outcome_approved_amount = $3::numeric,
              reapply_on = $4::date,
              outcome_notes = COALESCE($5::text, outcome_notes),
              outcome_by = CASE WHEN $2::text = 'open' THEN NULL ELSE $6::text END,
              outcome_at = CASE WHEN $2::text = 'open' THEN NULL ELSE now() END
        WHERE id = $1::uuid
        RETURNING *`,
      [declineId, outcome, dollars, reapply, note, actorName(by)]
  );
  const row = u.rows[0];

  // The bank's answer on the application too — after the outcome is saved, so a
  // billed fee that moves can be re-issued in its own transaction.
  let application = null;
  if (d.application_id && outcome !== "open") {
    const a = await db.query(`SELECT id, status FROM applications WHERE id = $1::uuid AND org_id = $2::uuid`, [d.application_id, orgId]);
    const current = a.rows[0];
    if (current) {
      if (outcome === "approved_on_recon") {
        application = await setStatus(db, {
          orgId, applicationId: current.id, status: "Approved", eventType: "reconsideration",
          staff, notes: `Approved on reconsideration (decline ${declineId}).`,
          patch: dollars != null ? { approved_amount: dollars } : null
        });
      } else if (current.status !== "Denied") {
        application = await setStatus(db, {
          orgId, applicationId: current.id, status: "Denied", eventType: "reconsideration",
          staff, notes: `Still declined after reconsideration (decline ${declineId}).`
        });
      }
    }
  }
  return {
    ok: true,
    decline_id: declineId,
    outcome: row.outcome,
    outcome_words: staffOutcomeWords(row.outcome),
    approved_amount: row.outcome_approved_amount == null ? null : String(row.outcome_approved_amount),
    reapply_on: dayOf(row.reapply_on),
    application_status: application ? application.status : null,
    next_sequence_note: nextSequenceNote({ ...row, reapply_on: reapply })
  };
}

/** For a client's own paste result: the client-safe slice of an analysis. */
export function clientAnalysis(analysis) {
  if (!analysis) return null;
  return {
    looks_like_words: analysis.looks_like_words,
    reasons: (analysis.reasons || []).map((r) => ({ label: r.label, words: r.client_words, quote: r.evidence_quote })),
    unknown_parts: analysis.unknown_parts || [],
    needs_person: !!analysis.needs_person,
    needs_person_why: analysis.needs_person_why || null,
    your_steps: (analysis.recon_steps || []).filter((s) => s.who === "client").map((s) => ({ text: s.client_step, status: s.status })),
    fundhub_steps: (analysis.recon_steps || []).filter((s) => s.who !== "client").map((s) => ({ text: s.client_step, status: s.status })),
    when: ((analysis.timing && analysis.timing.reapply) || []).map((w) => w.text)
  };
}

export { categoryOf };
