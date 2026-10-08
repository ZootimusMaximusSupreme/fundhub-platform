// Funding desk breakage for the morning pulse. Report only. Read only.
// Slice 14 watches funding job ids. Slice 28 watches desk doors.
// This file does not repeat those. It reads rows.
//
// One tripwire: Recon (AG-07) on daily-pulse. Do not add another watcher.
// Do not submit a lender application from here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const AGENT_CODE = "AG-07";
export const RECON_WORKFLOW = "daily-pulse";

/** Same end states as card stacking: funded and closed are done. */
export const TERMINAL_ROUND_STATUSES = Object.freeze(["funded", "closed"]);

/** Advisor queue stages that still need a person. Funded and closed are done. */
export const WAITING_STAGE_KEYS = Object.freeze([
  "apply_now",
  "round_submitted",
  "approved",
  "action_required"
]);

export const STUCK_AFTER_MS = 72 * 60 * 60 * 1000;

const BOOK_REL = "docs/legacy-strong/lenders-legacy-strong.csv";

const STUCK_SQL = `
  SELECT count(*)::int AS n
    FROM funding_rounds
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
     AND lower(status) <> ALL($2::text[])
     AND updated_at < $3::timestamptz
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

const QUEUE_SQL = `
  SELECT count(*)::int AS n
    FROM cards c
    JOIN pipeline_stages ps ON ps.id = c.stage_id
    JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'funding_card_stacking'
    JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
   WHERE c.org_id = $1::uuid
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(cl.is_demo, false) = false
     AND ps.key = ANY($2::text[])
     AND btrim(COALESCE(cl.custom_fields->>'employee_next_action', '')) = ''
     AND c.updated_at < $3::timestamptz
`;

const RECON_SQL = `
  SELECT code, status, runtime, runtime_ref
    FROM agents
   WHERE org_id = $1 AND code = $2
   LIMIT 1
`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function skipped() {
  const detail = "no database in this run — funding desk not read";
  return [
    check("funding:round-stuck", "skip", detail),
    check("funding:lender-book", "skip", detail),
    check("funding:submit-path", "skip", detail),
    check("funding:advisor-queue", "skip", detail),
    check("funding:recon", "skip", "no database in this run — Recon status not read")
  ];
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

const RECON_LINE = "Recon (AG-07) is the tripwire. Do not invent a second watchdog. Do not auto-fix from this pulse.";

export function countBookDataRows(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length <= 1) return 0;
  return lines.length - 1;
}

function readBookRows(root) {
  const file = path.join(root, BOOK_REL);
  if (!fs.existsSync(file)) return { ok: false, rows: 0 };
  const text = fs.readFileSync(file, "utf8");
  return { ok: true, rows: countBookDataRows(text) };
}

function applicationsRouteWired(root) {
  const file = path.join(root, "netlify/functions/api.mjs");
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  return /["']applications["']\s*:/.test(text);
}

async function roundStuck(db, orgId, at) {
  const result = await db.query(STUCK_SQL, [orgId, [...TERMINAL_ROUND_STATUSES], at]);
  const n = countOf(result);
  if (n === 0) {
    return check("funding:round-stuck", "PASS", "no open funding round has sat still for 72 hours");
  }
  return check(
    "funding:round-stuck",
    "FAIL",
    `${plural(n, "funding round")} still open after 72 hours`,
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
    if (!book.ok) {
      return check("funding:lender-book", "skip", "lender list is empty and the book file was not on this host");
    }
    bookRows = book.rows;
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

async function submitPath(db, orgId, at, ctx, root) {
  const wired = typeof ctx.submitRouted === "boolean"
    ? ctx.submitRouted
    : applicationsRouteWired(root);
  const result = await db.query(APPLY_SQL, [orgId, at, [...TERMINAL_ROUND_STATUSES]]);
  const n = countOf(result);
  if (wired && n === 0) {
    return check(
      "funding:submit-path",
      "PASS",
      "applications route is wired and no Apply row is sitting past 72 hours"
    );
  }
  const parts = [];
  if (!wired) parts.push("applications route is not wired");
  if (n > 0) parts.push(`${plural(n, "application")} still on Apply with no submit date`);
  return check(
    "funding:submit-path",
    "FAIL",
    parts.join("; "),
    `Fix the applications path. Do not submit a real lender app. ${RECON_LINE}`
  );
}

async function advisorQueue(db, orgId, at) {
  const result = await db.query(QUEUE_SQL, [orgId, [...WAITING_STAGE_KEYS], at]);
  const n = countOf(result);
  if (n === 0) {
    return check("funding:advisor-queue", "PASS", "no funding file has waited 72 hours with no next step");
  }
  return check(
    "funding:advisor-queue",
    "FAIL",
    `${plural(n, "funding file")} waited 72 hours with no next step`,
    `Open the advisor queue and set the next step on the file that has been waiting. ${RECON_LINE}`
  );
}

async function recon(db, orgId) {
  const result = await db.query(RECON_SQL, [orgId, AGENT_CODE]);
  const row = result?.rows?.[0];
  if (!row) {
    return check(
      "funding:recon",
      "FAIL",
      "AG-07 is missing",
      "Re-seed Recon (AG-07). Do not invent a second watchdog."
    );
  }
  if (row.status !== "live" || row.runtime !== "inngest" || row.runtime_ref !== RECON_WORKFLOW) {
    return check(
      "funding:recon",
      "FAIL",
      `AG-07 status=${row.status} runtime=${row.runtime} ref=${row.runtime_ref}`,
      "Turn AG-07 live on inngest / daily-pulse. Leave GHL-RECON retired. Do not invent a second watchdog."
    );
  }
  return check("funding:recon", "PASS", "AG-07 Recon is live on daily-pulse");
}

/**
 * @param {{ db?: { query: Function }, orgId?: string, now?: Date, bookRows?: number, submitRouted?: boolean, root?: string }} [ctx]
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
        String((err && err.message) || err).slice(0, 160),
        `Read the funding desk. ${RECON_LINE}`
      );
    }
  }

  return Promise.all([
    run("funding:round-stuck", () => roundStuck(db, orgId, at)),
    run("funding:lender-book", () => lenderBook(db, orgId, ctx, root)),
    run("funding:submit-path", () => submitPath(db, orgId, at, ctx, root)),
    run("funding:advisor-queue", () => advisorQueue(db, orgId, at)),
    run("funding:recon", () => recon(db, orgId))
  ]);
}
