// The client fulfillment cycle (Chris, 2026-11-07, unit CYCLE). Only the pieces
// the Blueprint views were missing; everything else is reused as it was built.
//
//   1. Full credit report on every soft pull. src/handlers/crs-full-report.mjs
//      saves the Fundhub-branded "Complete Credit Report" after every real pull:
//      one document per client, one VERSION per pull. This lists each version
//      so the client can open the report for any pull.
//   2. Letters. The exact bureau mailing address comes from the one saved list
//      (src/messaging/providers/mail-letter.mjs BUREAU_MAIL_ADDRESSES, the same
//      address the $97 mailing uses). The client approves each letter version
//      and checks the address; both are saved (migration 589).
//   3. Fundable. A preparation buyer (no funding engine) stops at "Book a call
//      with your CSM"; the press opens the CSM task (src/finance/ready-to-fund.mjs).
//      A full implementation buyer gets an application guide that fills income
//      ONLY from what is on file, never rounded up.
//   4. Inquiries after a funding round. "Call <bureau>" with a short script, the
//      number the Fundhub caller already dials (src/inquiry-ops/bureau-dial-plan.mjs)
//      and what to have ready.
//
// Money is integer cents. Unknown is null, never 0. Personal and business money
// are never added together. Nothing here sends, charges or pulls credit.
import { BUREAU_MAIL_ADDRESSES } from "../messaging/providers/mail-letter.mjs";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

/* The subtype src/handlers/crs-full-report.mjs saves (REPORT_SUBTYPE there;
   fulfillment-cycle.test.mjs pins the two together). Not imported, so the plan
   read does not load the email sender. */
export const FULL_REPORT_SUBTYPE = "crs_full_credit_report";
/* The letters a client mails: the two funding letters (letter-mailing.mjs) and
   the repair round letters (src/repair/persist-generated-letters.mjs). */
export const LETTER_SUBTYPES = Object.freeze(["funding_inquiry_removal", "funding_personal_info", "metro2_dispute_letter_pack"]);
export const LETTER_STEPS = Object.freeze(["approve", "address"]);
/* Deposits are not the same as income: the guide's first step is the client's own check. */
export const GUIDE_RULE = "Confirm your real income before you apply.";
/* Sources read from deposits: an estimate, never an exact income. */
const ESTIMATE_SOURCES = new Set(["bank", "business_bank"]);
export const MAX_FULL_REPORTS = 24;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMES = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });
const ALIASES = Object.freeze({ EX: "EX", EQ: "EQ", TU: "TU", EXPERIAN: "EX", EQUIFAX: "EQ", TRANSUNION: "TU" });

export class FulfillmentCycleError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
function fail(code, message, status) { throw new FulfillmentCycleError(code, message, status); }

const iso = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const cents = (value) => {
  const n = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** "EX", "experian", "Experian" → "EX". Anything else → null. */
export function bureauCode(value) {
  return ALIASES[String(value ?? "").toUpperCase().replace(/[^A-Z]/g, "")] || null;
}

/** The bureau's mailing address, line by line. null for a letter that does not
 *  go to the bureau (a furnisher or complaint letter carries its own address). */
export function mailTo(bureau, target = "bureau") {
  const code = bureauCode(bureau);
  if (!code || (target != null && target !== "bureau")) return null;
  const a = BUREAU_MAIL_ADDRESSES[code];
  return { bureau: code, name: NAMES[code],
    lines: [a.company_name, a.address_line1, a.address_line2, `${a.address_city}, ${a.address_state} ${a.address_zip}`].filter(Boolean) };
}

/** One saved approval row → what the screen shows. */
export function approvalView(row) {
  if (!row) return { approvedAt: null, addressCheckedAt: null };
  return { approvedAt: iso(row.approved_at), addressCheckedAt: iso(row.address_checked_at) };
}

/* ── 1. Full credit reports ───────────────────────────────────────────────── */

/** document_versions rows → newest first, one per pull. */
export function fullReportRows(rows = []) {
  const out = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && UUID.test(String(r.document_id || "")) && Number.isSafeInteger(Number(r.version)) && Number(r.version) >= 1)
    .map((r) => ({ documentId: String(r.document_id), version: Number(r.version), pulledAt: iso(r.generated_at) }))
    .sort((a, b) => String(b.pulledAt || "").localeCompare(String(a.pulledAt || "")) || b.version - a.version)
    .slice(0, MAX_FULL_REPORTS);
  return out.map((r, i) => ({ ...r, newest: i === 0 }));
}

export async function readFullReports(db, { orgId, clientId }) {
  const { rows } = await db.query(
    `SELECT d.id AS document_id, v.version, v.generated_at
       FROM documents d
       JOIN document_versions v ON v.document_id = d.id AND v.org_id = d.org_id
      WHERE d.client_id = $1::uuid AND d.org_id = $2::uuid
        AND d.kind = 'deliverable' AND d.subtype = $3
        AND (d.expires_at IS NULL OR d.expires_at > now())
      ORDER BY v.generated_at DESC, v.version DESC
      LIMIT $4`,
    [clientId, orgId, FULL_REPORT_SUBTYPE, MAX_FULL_REPORTS]
  );
  return fullReportRows(rows);
}

/* ── 3. Which buyer, and fundable ─────────────────────────────────────────── */

/** "implementation" when the $30,000 funding engine is on the file, else
 *  "preparation". null when it could not be read. */
export function offerOf(engagement) {
  if (engagement === undefined) return null;
  return engagement && ["active", "completed"].includes(engagement.status) ? "implementation" : "preparation";
}

/** UnderwriteIQ's own gate, as the plan's path prints it (path.fundability.tier). */
export function fundableOf(path) {
  const tier = path?.fundability?.tier;
  return tier === "fundable" ? true : tier === "not_fundable_yet" ? false : null;
}

/**
 * The cycle fields on GET /api/blueprint/plan. Each part fails alone: a part
 * that cannot be read is null, and the rest still answers.
 */
export async function readBlueprintCycle(db, scope, { path = null, readAccess, readReports = readFullReports } = {}) {
  const { orgId, clientId } = scope || {};
  if (!orgId || !clientId) fail("cycle_scope_required", "Sign in to your client file.", 403);
  let engagement;
  try { engagement = readAccess ? await readAccess(db, scope) : undefined; } catch { engagement = undefined; }
  let fullReports = null;
  try { fullReports = await readReports(db, { orgId, clientId }); } catch { fullReports = null; }
  return { offer: offerOf(engagement), fundable: fundableOf(path), bookCallUrl: BOOK_CALL_URL, fullReports };
}

/* ── 3b. The application guide ────────────────────────────────────────────── */

/**
 * Income for a bank application, ONLY from what is on file:
 *   personal   the monthly income the client saved on their plan
 *   household  repeat pay into their personal bank accounts (src/banking/income.mjs,
 *              counted repeats only; a spouse's pay into a joint account is here)
 *   business   repeat business deposits and merchant payouts, when one business
 *              is on file. Two or more are not split by business yet, so it is
 *              left out rather than overstated.
 * Yearly is monthly × 12. Never rounded up; unknown stays null. Household and
 * business come from deposits, so they are an estimate (estimate: true), and
 * the guide's rule has the client confirm their real income before using one.
 */
export function applicationGuide({ income = null, plan = null, businessCount = 0 } = {}) {
  const kinds = income && income.ok !== false ? (income.by_kind || {}) : {};
  const row = (key, label, monthly, source, reason = null) => {
    const m = cents(monthly);
    return { key, label, monthlyCents: m, yearlyCents: m == null ? null : m * 12,
      source: m == null ? null : source, estimate: m != null && ESTIMATE_SOURCES.has(source),
      reason: m == null ? (reason || "not_on_file") : null };
  };
  const split = Number(businessCount) > 1;
  return {
    rule: GUIDE_RULE,
    asOf: income?.detected_as_of || null,
    rows: [
      row("personal", "Personal income", plan?.monthlyIncomeCents, "plan"),
      row("household", "Household income", kinds.personal?.monthly_cents, "bank"),
      split ? row("business", "Business income", null, null, "split_by_business")
        : row("business", "Business income", kinds.business?.monthly_cents, "business_bank")
    ]
  };
}

export async function readApplicationGuide(db, { orgId, clientId, now = new Date() }, { loadIncome } = {}) {
  const load = loadIncome || (await import("../banking/income.mjs")).loadIncome;
  const [planRow, businessRow, income] = await Promise.all([
    db.query(`SELECT custom_fields->'blueprint_business_plans'->'monthlyIncomeCents' AS monthly
                FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`, [clientId, orgId]),
    db.query(`SELECT count(*)::int AS n FROM businesses WHERE client_id = $1::uuid AND org_id = $2::uuid`, [clientId, orgId]),
    load(db, { orgId, clientId, asOf: now }).catch(() => null)
  ]);
  return applicationGuide({ income, plan: { monthlyIncomeCents: planRow.rows[0]?.monthly ?? null },
    businessCount: Number(businessRow.rows[0]?.n || 0) });
}

/* ── 4. Calling the bureaus about inquiries ───────────────────────────────── */

export function phoneDisplay(number) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(number || ""));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null;
}

/**
 * The "Call <bureau>" step for one open inquiry case. `dial` is
 * bureauDialPlan() (the numbers the Fundhub caller dials). No open inquiry, no
 * call. The script asks the bureau to check the inquiries; it never calls them
 * fraud and never claims anything the client did not say.
 */
export function inquiryCall({ bureau, inquiries = [], missing = [], name = null, dial = [] } = {}) {
  const code = bureauCode(bureau);
  if (!code) return null;
  const open = (Array.isArray(inquiries) ? inquiries : [])
    .filter((i) => i && i.state !== "removed_verified")
    .map((i) => String(i.name || "").trim()).filter(Boolean);
  if (!open.length) return null;
  const line = (Array.isArray(dial) ? dial : []).find((d) => d && d.code === code);
  const number = line && line.numberOk ? line.number : null;
  const who = String(name || "").trim();
  return {
    bureau: code, name: NAMES[code], number, display: phoneDisplay(number),
    numberFrom: number ? line.numberFrom : null,
    script: [
      who ? `Hi, my name is ${who}.` : "Hi, I'm calling about my credit report.",
      "I want to review the hard inquiries on my report.",
      `Please check: ${open.join(", ")}.`,
      "If you can't verify one, please remove it.",
      "May I have a confirmation number?"
    ],
    haveReady: ["Photo ID", "Your Social Security number", "Your address and ZIP code", "This list of inquiries"],
    uploadFirst: (Array.isArray(missing) ? missing : [])
      .map((m) => (typeof m === "string" ? m : m?.label)).filter(Boolean)
  };
}

/* ── 2. Letter approval and the address check ─────────────────────────────── */

/** Approvals on file for this client, keyed by document version. A database
 *  without migration 589 answers an empty map, never an error. */
export async function readLetterApprovals(db, { orgId, clientId }) {
  try {
    const { rows } = await db.query(
      `SELECT document_id, document_version_id, approved_at, address_checked_at
         FROM blueprint_letter_approvals WHERE client_id = $1::uuid AND org_id = $2::uuid`,
      [clientId, orgId]
    );
    return new Map(rows.map((r) => [String(r.document_version_id), r]));
  } catch {
    return new Map();
  }
}

/** The fields each letter row gains: where it goes and what the client did. */
export function letterCycle({ bureau, target = "bureau", versionId = null, approvals = new Map() } = {}) {
  return { to: mailTo(bureau, target), versionId: versionId ? String(versionId) : null,
    approval: approvalView(versionId ? approvals.get(String(versionId)) : null) };
}

/**
 * saveLetterStep — the client approves the letter version they opened, then
 * checks its mailing address. Address before approval is refused. Replays are
 * no-ops. Only the client's own current letter versions.
 */
export async function saveLetterStep(db, scope, { documentId, step } = {}) {
  if (![scope?.orgId, scope?.clientId, scope?.accountId].every((v) => UUID.test(String(v || "")))) {
    fail("forbidden", "Sign in with your client account.", 403);
  }
  if (!UUID.test(String(documentId || ""))) fail("invalid_letter", "Choose one of your saved letters.", 400);
  if (!LETTER_STEPS.includes(step)) fail("invalid_step", "Choose approve or check the address.", 400);
  const at = scope.now ? new Date(scope.now) : new Date();
  return withTransaction(db, async (tx) => {
    const doc = (await tx.query(
      `SELECT d.id, d.current_version_id, d.subtype, d.metadata
         FROM documents d
        WHERE d.id = $1::uuid AND d.org_id = $2::uuid AND d.client_id = $3::uuid
          AND d.kind = 'deliverable' AND d.subtype = ANY($4::text[])
          AND d.current_version_id IS NOT NULL AND (d.expires_at IS NULL OR d.expires_at > $5)
        FOR SHARE`,
      [documentId, scope.orgId, scope.clientId, LETTER_SUBTYPES, at]
    )).rows[0];
    if (!doc) fail("letter_unavailable", "That letter is not on your file.", 404);
    const bureau = bureauCode(doc.metadata?.bureau);
    if (!bureau) fail("letter_bureau_unknown", "Ask the Fundhub team which bureau this letter is for.", 409);
    const target = doc.metadata?.target ?? "bureau";
    const prior = (await tx.query(
      `SELECT * FROM blueprint_letter_approvals
        WHERE document_version_id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid FOR UPDATE`,
      [doc.current_version_id, scope.orgId, scope.clientId]
    )).rows[0];
    let row = prior;
    if (step === "approve" && !prior) {
      row = (await tx.query(
        `INSERT INTO blueprint_letter_approvals
           (org_id, client_id, document_id, document_version_id, bureau, approved_at, approved_by_account_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid) RETURNING *`,
        [scope.orgId, scope.clientId, doc.id, doc.current_version_id, bureau, at, scope.accountId]
      )).rows[0];
    } else if (step === "address") {
      if (!prior?.approved_at) fail("approve_first", "Approve the letter first.", 409);
      if (!prior.address_checked_at) {
        row = (await tx.query(
          `UPDATE blueprint_letter_approvals SET address_checked_at = $4, address_checked_by_account_id = $5::uuid
            WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid RETURNING *`,
          [prior.id, scope.orgId, scope.clientId, at, scope.accountId]
        )).rows[0];
      }
    }
    return { ok: true, documentId: doc.id, step,
      ...letterCycle({ bureau, target, versionId: doc.current_version_id,
        approvals: new Map([[String(doc.current_version_id), row]]) }) };
  });
}
