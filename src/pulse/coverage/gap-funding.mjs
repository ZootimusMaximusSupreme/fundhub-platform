// Funding desk breakage for the morning pulse. Report only. Read only.
// Slice 14 watches funding job ids. Slice 28 watches desk doors.
// This file does not repeat those. It reads rows.
//
// Recon (AG-07) is the one tripwire, and daily-pulse already reads it. This file
// does not read Recon again and does not add a watcher.
// Do not submit a lender application from here.
//
// Claude review 2026-10-08: dropped the Recon copy (daily-pulse checkRecon does
// the same read), dropped the file-text route check (the registry pings that
// door, and the file is not in the live bundle), counted application movement as
// round movement, and made the advisor queue read the step the screen shows.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** Same end states as card stacking: funded and closed are done. */
export const TERMINAL_ROUND_STATUSES = Object.freeze(["funded", "closed"]);

/** Advisor queue stages that still need a person. Funded and closed are done. */
export const WAITING_STAGE_KEYS = Object.freeze([
  "apply_now",
  "round_submitted",
  "approved",
  "action_required"
]);

/** 72 hours. Same no-progress line as DPC-05 and the pipeline:clients check. */
export const STUCK_AFTER_MS = 72 * 60 * 60 * 1000;

/** The most funding files whose step is read in one run. */
export const MAX_FILES_READ = 25;

export const CHECK_IDS = Object.freeze([
  "funding:round-stuck",
  "funding:lender-book",
  "funding:submit-path",
  "funding:advisor-queue"
]);

const BOOK_REL = "docs/legacy-strong/lenders-legacy-strong.csv";

// A round moves when the round row moves OR when one of its bank rows moves.
// Changing an application only stamps applications.updated_at, so the round row
// alone looks frozen while staff are working it.
const STUCK_SQL = `
  SELECT count(*)::int AS n
    FROM funding_rounds fr
   WHERE fr.org_id = $1::uuid
     AND COALESCE(fr.is_demo, false) = false
     AND lower(fr.status) <> ALL($2::text[])
     AND GREATEST(
           fr.updated_at,
           COALESCE(
             (SELECT max(a.updated_at)
                FROM applications a
               WHERE a.funding_round_id = fr.id
                 AND a.org_id = fr.org_id),
             fr.updated_at
           )
         ) < $3::timestamptz
`;

const LENDER_SQL = `
  SELECT count(*)::int AS n
    FROM lenders
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
     AND COALESCE(active, true) = true
`;

const APPLY_SQL = `
  SELECT count(*)::int AS n
    FROM applications a
    JOIN funding_rounds fr
      ON fr.id = a.funding_round_id
     AND fr.org_id = a.org_id
   WHERE a.org_id = $1::uuid
     AND COALESCE(a.is_demo, false) = false
     AND a.status = 'Apply'
     AND a.submitted_date IS NULL
     AND a.updated_at < $2::timestamptz
     AND lower(fr.status) <> ALL($3::text[])
`;

// Files that have sat in a waiting stage past the line. The step they show is
// read next, from the same work-out the Client Control Panel uses.
const QUEUE_SQL = `
  SELECT c.id::text AS card_id,
         c.client_id::text AS client_id,
         ps.key AS stage_key,
         count(*) OVER ()::int AS total
    FROM cards c
    JOIN pipeline_stages ps ON ps.id = c.stage_id
    JOIN pipelines p
      ON p.id = c.pipeline_id
     AND p.org_id = c.org_id
     AND p.key = 'funding_card_stacking'
    JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
   WHERE c.org_id = $1::uuid
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(cl.is_demo, false) = false
     AND ps.key = ANY($2::text[])
     AND COALESCE(c.entered_at, c.updated_at) < $3::timestamptz
   ORDER BY COALESCE(c.entered_at, c.updated_at) ASC
   LIMIT ${MAX_FILES_READ}
`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function skipped() {
  const detail = "no database in this run — funding desk not read";
  return CHECK_IDS.map((id) => check(id, "skip", detail));
}

function cutoff(now) {
  return new Date(now.getTime() - STUCK_AFTER_MS);
}

function countOf(result) {
  return Number(result?.rows?.[0]?.n || 0);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

const RECON_LINE =
  "Recon (AG-07) is the tripwire. Do not invent a second watchdog. Do not auto-fix from this pulse.";

export function countBookDataRows(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length <= 1) return 0;
  return lines.length - 1;
}

/** { ok:false } when the book file is not on this host (the live bundle has none). */
function readBookRows(root) {
  const file = path.join(root, BOOK_REL);
  if (!fs.existsSync(file)) return { ok: false, rows: 0 };
  const text = fs.readFileSync(file, "utf8");
  return { ok: true, rows: countBookDataRows(text) };
}

/** True when the screen shows this file a next step. */
export function showsNextStep(fulfillment) {
  if (!fulfillment || typeof fulfillment !== "object") return false;
  if (fulfillment.degraded === true) return false;
  const label = fulfillment.next_action && fulfillment.next_action.label;
  return typeof label === "string" && label.trim() !== "";
}

// The Client Control Panel's own work-out (api/dashboard/client.mjs reads the
// same two functions). Reads only. Literal import so the live bundle carries it.
async function readShownStep(db, orgId, clientId) {
  const step = await import("../../fulfillment/client-step.mjs");
  const rows = await step.readClientStepRows(db, { orgId, clientId });
  if (!rows || !rows.client) return { found: false, fulfillment: null };
  const inquiryCase = await step.readActiveInquiryCase(db, { orgId, clientId });
  const out = await step.workOutClientStep(db, { orgId, clientId, rows, inquiryCase });
  return { found: true, fulfillment: out ? out.fulfillment : null };
}

async function roundStuck(db, orgId, at) {
  const result = await db.query(STUCK_SQL, [orgId, [...TERMINAL_ROUND_STATUSES], at]);
  const n = countOf(result);
  if (n === 0) {
    return check(
      "funding:round-stuck",
      "PASS",
      "no open funding round, or bank row on it, has moved less than 72 hours ago"
    );
  }
  return check(
    "funding:round-stuck",
    "FAIL",
    `${plural(n, "funding round")} still open with no movement for 72 hours`,
    `Open the funding board and move the round that has sat still. ${RECON_LINE}`
  );
}

async function lenderBook(db, orgId, ctx, root) {
  const result = await db.query(LENDER_SQL, [orgId]);
  const n = countOf(result);
  if (n > 0) {
    return check("funding:lender-book", "PASS", `lender list has ${plural(n, "bank")}`);
  }
  let bookRows = ctx.bookRows;
  if (bookRows == null || bookRows === "") {
    const book = readBookRows(root);
    bookRows = book.ok ? book.rows : null;
  }
  if (bookRows == null) {
    // The live bundle carries no book file. An empty list still means no match
    // can run, so it is a FAIL and not a skip.
    return check(
      "funding:lender-book",
      "FAIL",
      "lender list is empty (the book file is not on this host, so its size is not known)",
      `Load the lender book into the lender list. Do not invent bank names. ${RECON_LINE}`
    );
  }
  const rows = Number(bookRows);
  if (!Number.isFinite(rows) || rows <= 0) {
    return check("funding:lender-book", "skip", "lender list is empty and the book has no rows to load");
  }
  return check(
    "funding:lender-book",
    "FAIL",
    `lender list is empty and the book has ${plural(Math.floor(rows), "bank")} to load`,
    `Load the lender book into the lender list. Do not invent bank names. ${RECON_LINE}`
  );
}

async function submitPath(db, orgId, at) {
  const result = await db.query(APPLY_SQL, [orgId, at, [...TERMINAL_ROUND_STATUSES]]);
  const n = countOf(result);
  if (n === 0) {
    return check(
      "funding:submit-path",
      "PASS",
      "no application has sat on Apply for 72 hours with no submit date"
    );
  }
  return check(
    "funding:submit-path",
    "FAIL",
    `${plural(n, "application")} still on Apply with no submit date for 72 hours`,
    `Open the file and finish or close the application. Do not submit a real lender app from here. ${RECON_LINE}`
  );
}

async function advisorQueue(db, orgId, at, ctx) {
  const id = "funding:advisor-queue";
  const result = await db.query(QUEUE_SQL, [orgId, [...WAITING_STAGE_KEYS], at]);
  const files = Array.isArray(result?.rows) ? result.rows : [];
  if (files.length === 0) {
    return check(id, "PASS", "no funding file has waited 72 hours in the advisor queue");
  }
  const total = Number(files[0]?.total) || files.length;
  const readStep = typeof ctx.readShownStep === "function" ? ctx.readShownStep : readShownStep;
  const noStep = [];
  let unread = 0;
  let lastError = "";
  for (const file of files) {
    try {
      const seen = await readStep(db, orgId, file.client_id);
      if (!seen || seen.found === false) {
        unread += 1;
        lastError = "client not found";
      } else if (!showsNextStep(seen.fulfillment)) {
        noStep.push(file);
      }
    } catch (err) {
      unread += 1;
      lastError = clip(err);
    }
  }
  if (noStep.length > 0) {
    const shown = noStep.slice(0, 5).map((f) => f.client_id).join(", ");
    const more = noStep.length > 5 ? ` and ${noStep.length - 5} more` : "";
    return check(
      id,
      "FAIL",
      `${plural(noStep.length, "funding file")} waited 72 hours and the screen shows no next step. Look at ${shown}${more}.`,
      `Open the advisor queue and set the next step on the file that has been waiting. ${RECON_LINE}`
    );
  }
  if (unread > 0) {
    return check(
      id,
      "skip",
      `${plural(unread, "waiting funding file")} could not be read for a next step (${lastError})`
    );
  }
  const more = total > files.length ? ` (read the oldest ${files.length} of ${total})` : "";
  return check(
    id,
    "PASS",
    `${plural(files.length, "funding file")} waited 72 hours and every one shows a next step${more}`
  );
}

/**
 * @param {{ db?: { query: Function }, orgId?: string, now?: Date, bookRows?: number, root?: string, readShownStep?: Function }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = ctx.orgId;
  if (!db || typeof db.query !== "function" || !orgId) return skipped();

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const at = cutoff(now);
  const root = ctx.root || REPO_ROOT;

  async function run(id, fn) {
    try {
      return await fn();
    } catch (err) {
      return check(
        id,
        "FAIL",
        `could not read the funding desk: ${clip(err)}`,
        `Read the funding desk. ${RECON_LINE}`
      );
    }
  }

  return Promise.all([
    run("funding:round-stuck", () => roundStuck(db, orgId, at)),
    run("funding:lender-book", () => lenderBook(db, orgId, ctx, root)),
    run("funding:submit-path", () => submitPath(db, orgId, at)),
    run("funding:advisor-queue", () => advisorQueue(db, orgId, at, ctx))
  ]);
}
