// @ts-check
// proposeTransfer — the ONE way FinanceOS asks for money to move.
//
// FinanceOS wave 5, unit W5. Contract: docs/finance/money-agent-tasks.md.
//
// IT NEVER MOVES MONEY. It writes a PROPOSAL: one money_agent_tasks row
// (migration 464) with status 'needs_approval', the exact amount, and where the
// money goes. Nothing happens to that row until the client approves THAT amount
// from an exact account of their own. The database enforces it
// (money_agent_tasks_money_needs_ok_ck): a money row cannot be 'approved',
// 'claimed' or 'done' without approved_at and from_account_id.
//
// W7 (Plaid sandbox Transfer) builds the other half against this row:
//   approveTransfer — the client's yes on the exact amount and their own
//                     account → status 'approved', approved_at, from_account_id
//   the engine       — sends an approved row inside the set limits → 'done' / 'failed'
// The money agent (W6) may claim an 'approved' row and call that engine. Until
// W7 lands, a proposal waits at 'needs_approval' and the client is told so.
//
// W7 may change what happens inside proposeTransfer (e.g. also open its own
// transfer intent), but not its signature or its promise: no money moves here,
// and the row it returns is the one the client approves.

/** @typedef {"bank_account" | "card" | "loan" | "fundhub"} TransferDestination */

/**
 * @typedef {Object} TransferProposal
 * @property {string} orgId
 * @property {string} clientId
 * @property {string} taskKey             the task's id on GET /api/money/tasks
 * @property {string} kind                due | pay_down | deposit | open_account | apply | checkpoint | other
 * @property {string} title               what the client reads
 * @property {string | null} why
 * @property {string | null} dueOn        'YYYY-MM-DD'
 * @property {string} source              which reader the task came from
 * @property {number} amountCents         exact, whole cents, above 0
 * @property {TransferDestination} toKind
 * @property {string | null} toAccountId  the client's own open bank_accounts.id; null only for 'fundhub'
 * @property {"client" | "staff"} requestedByKind
 * @property {string | null} requestedByStaffId
 * @property {Record<string, unknown> | null} [detail]
 */

/**
 * @typedef {Object} ProposalResult
 * @property {boolean} ok
 * @property {boolean} [created]          false when an open proposal for this task already existed
 * @property {string} [proposalId]        money_agent_tasks.id — the row the client approves
 * @property {string} [status]          'needs_approval' for a new proposal; an open one's own status otherwise
 * @property {string} [reason]            when ok is false: bad_amount | bad_destination | destination_not_found | missing_ids
 */

/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} Queryable */

export const TRANSFER_DESTINATIONS = Object.freeze(["bank_account", "card", "loan", "fundhub"]);
export const PROPOSAL_STATUS = "needs_approval";
export const OPEN_STATUSES = Object.freeze(["queued", "needs_approval", "approved", "claimed"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks a proposal without touching the database. Returns a reason word, or
 * null when it may be written.
 * @param {Partial<TransferProposal>} p
 * @returns {string | null}
 */
export function proposalRefusal(p) {
  if (!p || !p.orgId || !p.clientId || !p.taskKey) return "missing_ids";
  if (typeof p.amountCents !== "number" || !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) return "bad_amount";
  if (!p.toKind || !TRANSFER_DESTINATIONS.includes(p.toKind)) return "bad_destination";
  if (p.toKind === "fundhub") return p.toAccountId ? "bad_destination" : null;
  return typeof p.toAccountId === "string" && UUID.test(p.toAccountId) ? null : "bad_destination";
}

/**
 * proposeTransfer(db, proposal) — write the proposal, once.
 * @param {Queryable} db
 * @param {TransferProposal} p
 * @returns {Promise<ProposalResult>}
 */
export async function proposeTransfer(db, p) {
  const refusal = proposalRefusal(p);
  if (refusal) return { ok: false, reason: refusal };

  // The money can only go to the client's OWN open account (or to Fundhub).
  if (p.toKind !== "fundhub") {
    const own = await db.query(
      `SELECT 1 FROM bank_accounts
        WHERE id = $1::uuid AND client_id = $2::uuid AND org_id = $3::uuid AND closed_at IS NULL`,
      [p.toAccountId, p.clientId, p.orgId]
    );
    if (!own.rows.length) return { ok: false, reason: "destination_not_found" };
  }

  const ins = await db.query(
    `INSERT INTO money_agent_tasks
       (org_id, client_id, task_key, kind, title, why, due_on, source,
        assignee, status, moves_money, amount_cents, to_kind, to_account_id,
        requested_by_kind, requested_by_staff_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8,
             'agent', 'needs_approval', true, $9, $10, $11,
             $12, $13, $14::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      p.orgId, p.clientId, p.taskKey, p.kind, p.title, p.why ?? null, p.dueOn ?? null, p.source,
      p.amountCents, p.toKind, p.toKind === "fundhub" ? null : p.toAccountId,
      p.requestedByKind === "staff" ? "staff" : "client", p.requestedByStaffId ?? null,
      p.detail ? JSON.stringify(p.detail) : null
    ]
  );
  if (ins.rows[0]) return { ok: true, created: true, proposalId: String(ins.rows[0].id), status: PROPOSAL_STATUS };

  // The one-open-row index absorbed it: a proposal for this task is already open.
  const open = await db.query(
    `SELECT id, status FROM money_agent_tasks
      WHERE org_id = $1 AND client_id = $2 AND task_key = $3 AND status = ANY($4::text[])
      ORDER BY created_at DESC LIMIT 1`,
    [p.orgId, p.clientId, p.taskKey, [...OPEN_STATUSES]]
  );
  if (open.rows[0]) {
    return { ok: true, created: false, proposalId: String(open.rows[0].id), status: String(open.rows[0].status) };
  }
  return { ok: false, reason: "missing_ids" };
}

export default proposeTransfer;
