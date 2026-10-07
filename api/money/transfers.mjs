// GET  /api/money/transfers[?client_id=<uuid>]
// POST /api/money/transfers  { action, client_id?, ... }
//
// FinanceOS money moves (wave 5, unit W7). GET lists the moves waiting for the
// client's yes and the ones already answered, with the limits and whether this
// is the Plaid sandbox. The engine is src/finance/money-transfers.mjs; this file
// gates, reads the body, and answers in plain words.
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT reads and acts on their own file only. client_id comes
//     off the session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) (owner / admin / sales_manager) +
//     requireClientInOrg on client_id. requireAuth drops a `roles` key, so the
//     role check is its own call (CLAUDE.md §12).
//
// POST actions:
//   approve  CLIENT ONLY, and only the account owner (an authorized
//            representative's login is refused). { proposal_id, amount_cents,
//            from_account_id, to_account_id, scheduled_for } — the screen echoes
//            what it showed; the engine refuses any difference. A move dated
//            today is sent at once; a later one waits for its day.
//   cancel   client or staff. { proposal_id } — "Not now" on a proposal, or stop
//            a move that has not reached the bank.
//   propose  STAFF ONLY. { to_kind, to_account_id, amount_cents, due_on, title,
//            suggested_from_account_id? } — writes a proposal through
//            proposeTransfer (src/finance/money-transfer-seam.mjs). Nothing moves.
//
// Staff never approve. The AI money agent and the rules helper never call this
// file; they propose through the seam.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import {
  moneyTransfersView, approveTransfer, executeTransfer, cancelTransfer, transferMode, staffMoveKey, etToday, isSendable
} from "../../src/finance/money-transfers.mjs";
import { storeFor } from "../../src/finance/money-transfers-store.mjs";
import { proposeTransfer } from "../../src/finance/money-transfer-seam.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

const ACTIONS = new Set(["approve", "cancel", "propose"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** reason → [http status, words for the person]. */
const REFUSALS = {
  transfers_disabled: [409, "Money moves are off right now."],
  sandbox_only: [409, "Money moves are off right now."],
  owner_only: [403, "Only the account owner can say yes to a money move."],
  missing_ids: [400, "That request was missing a part. Reload the page and try again."],
  bad_amount: [400, "Type the amount like 20.00."],
  bad_actor: [400, "That request was not accepted."],
  not_found: [404, "That money move is not on your list. Reload the page."],
  not_waiting: [409, "That money move was already answered. Reload the page."],
  destination_not_supported: [409, "FinanceOS can't send money to a card or a loan yet. Pay it in your card or loan app."],
  amount_changed: [409, "That money move changed. Reload the page and look again."],
  destination_changed: [409, "That money move changed. Reload the page and look again."],
  date_changed: [409, "That money move changed. Reload the page and look again."],
  over_transfer_limit: [409, "That is more than one money move can be."],
  over_daily_limit: [409, "That would go over the money move limit for that day."],
  from_not_sendable: [409, "Pick a checking or savings account that is connected."],
  destination_not_sendable: [409, "The account the money goes to is not connected."],
  same_account: [409, "Pick a different account to send from."],
  already_at_bank: [409, "It already went to the bank, so it can't be stopped now."],
  finished: [409, "That money move is already finished."],
  moved: [409, "That money move changed. Reload the page and look again."],
  provider_error: [502, "The bank connection did not answer. Try again in a few minutes."],
  destination_not_found: [409, "The account the money goes to is not on this client's file."],
  bad_destination: [400, "Pick where the money goes."],
  bad_title: [400, "Say what the move is for, in a few words."],
  bad_date: [400, "Pick a date like 2026-10-20, today or later."]
};

function refusal(res, reason, extra = {}) {
  const [code, message] = REFUSALS[reason] || [409, "That was not saved. Reload the page and try again."];
  return res.status(code).json({ ok: false, error: reason || "not_saved", message, ...extra });
}

/** Who is asking, and for which file. Same block as api/money/banks.mjs. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return {
      orgId, clientId, kind: "client", staffId: null,
      accountId: isUuid(principal.accountId) ? principal.accountId : null,
      authorizedRep: principal.authorizedRep === true || principal.accountKind === "authorized_rep"
    };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff", staffId: isUuid(staff.id) ? staff.id : null, accountId: null, authorizedRep: false };
}

const cents = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const uuidOrNull = (v) => (isUuid(v) ? v : null);

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const engine = {
    view: deps.moneyTransfersView || moneyTransfersView,
    approve: deps.approveTransfer || approveTransfer,
    execute: deps.executeTransfer || executeTransfer,
    cancel: deps.cancelTransfer || cancelTransfer,
    propose: deps.proposeTransfer || proposeTransfer,
    store: deps.store || null,
    provider: deps.provider || null
  };

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = null;
  if (method === "POST") {
    body = readBody(req.body);
    if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const who = await scope(req, res, { database, gate, body });
  if (!who) return;
  const { orgId, clientId } = who;
  const now = clock();
  const store = engine.store || database;

  try {
    if (method === "GET") {
      const payload = await engine.view(store, { orgId, clientId, env, now });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: "unknown_action" });

    if (action === "approve") {
      if (who.kind !== "client") {
        return res.status(403).json({ ok: false, error: "forbidden", message: "Only the client can say yes to a money move. Staff can set one up or stop it." });
      }
      const r = await engine.approve(store, {
        orgId, clientId,
        proposalId: uuidOrNull(body.proposal_id),
        amountCents: cents(body.amount_cents),
        fromAccountId: uuidOrNull(body.from_account_id),
        toAccountId: body.to_account_id === null || body.to_account_id === undefined ? null : uuidOrNull(body.to_account_id),
        scheduledFor: typeof body.scheduled_for === "string" ? body.scheduled_for : null,
        approvedByAccountId: who.accountId,
        authorizedRep: who.authorizedRep
      }, { env, now });
      if (!r || !r.ok) return refusal(res, r && r.reason, r && r.date ? { date: r.date } : {});

      /* Dated today: send it now, so the client sees it move. If the bank does
         not answer, the yes still stands and the scheduled pass tries again. */
      let sent = null;
      if (r.transfer.scheduled_for <= etToday(now)) {
        try {
          sent = await engine.execute(store, { transferId: r.transfer.id }, { env, now, provider: engine.provider });
        } catch (e) {
          sent = { ok: false, reason: "provider_error" };
          console.error(`money/transfers: send after approval failed for ${r.transfer.id}: ${String(e && e.message).slice(0, 200)}`);
        }
      }
      const t = (sent && sent.transfer) || r.transfer;
      return res.status(200).json({
        ok: true, action, words: r.words,
        transfer: { id: t.id, status: t.status, debit_status: t.debit_status ?? null, credit_status: t.credit_status ?? null, scheduled_for: t.scheduled_for },
        sent: sent ? { ok: !!sent.ok, step: sent.step ?? null, reason: sent.reason ?? null } : null
      });
    }

    if (action === "cancel") {
      const r = await engine.cancel(store, {
        orgId, clientId, proposalId: uuidOrNull(body.proposal_id),
        by: { kind: who.kind, id: who.kind === "staff" ? who.staffId : who.accountId }
      }, { env, now, provider: engine.provider });
      if (!r || !r.ok) return refusal(res, r && r.reason);
      return res.status(200).json({ ok: true, action, stage: r.stage });
    }

    // propose — staff only.
    if (who.kind !== "staff") {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Your money helper or your advisor sets up money moves. You say yes or not now." });
    }
    const mode = transferMode(env);
    if (!mode.enabled) return refusal(res, "transfers_disabled", { why: mode.reason });
    const toKind = body.to_kind === "fundhub" ? "fundhub" : body.to_kind === "bank_account" ? "bank_account" : null;
    if (!toKind) return refusal(res, "bad_destination");
    const amount = cents(body.amount_cents);
    if (!amount) return refusal(res, "bad_amount");
    if (amount > mode.perTransferCents) return refusal(res, "over_transfer_limit");
    const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (!title) return refusal(res, "bad_title");
    const today = etToday(now);
    const dueOn = typeof body.due_on === "string" && ISO_DAY.test(body.due_on) ? body.due_on : null;
    if (!dueOn || dueOn < today) return refusal(res, "bad_date");
    const toAccountId = toKind === "fundhub" ? null : uuidOrNull(body.to_account_id);
    if (toKind === "bank_account") {
      const to = toAccountId ? await storeFor(store).account(orgId, clientId, toAccountId) : null;
      if (!to) return refusal(res, "destination_not_found");
      if (!isSendable(to)) return refusal(res, "destination_not_sendable");
    }
    const suggested = uuidOrNull(body.suggested_from_account_id);
    const r = await engine.propose(database, {
      orgId, clientId, taskKey: staffMoveKey(), kind: toKind === "fundhub" ? "other" : "deposit",
      title, why: null, dueOn, source: "staff", amountCents: amount, toKind, toAccountId,
      requestedByKind: "staff", requestedByStaffId: who.staffId,
      detail: { proposed_by: "staff", ...(suggested && suggested !== toAccountId ? { suggested_from_account_id: suggested } : {}) }
    });
    if (!r || !r.ok) return refusal(res, (r && r.reason) || "not_saved");
    return res.status(201).json({ ok: true, action, proposal_id: r.proposalId, status: r.status });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
