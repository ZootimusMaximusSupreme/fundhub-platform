// Sync soft-pull on diagnostic.paid.
//
// C-00 is an Inngest function. Until INNGEST_EVENT_KEY is on, that path never
// runs — money clears, the board stays empty, and nobody pulls credit. Same
// reason entry.captured places the sales card in-process: the CRM must update
// when the bytes land, not when a separate engine wakes up.
//
// Reuses C-00's handle() so consent, ledger, and CRS order stay one code path.
// Idempotency keys on the soft-pull ledger collapse double-fires if Inngest
// also runs later.

import { on } from "../events/registry.mjs";
import { handle as runC00 } from "../workflows/c-00-crs-soft-pull-request.mjs";

function syncStep() {
  return {
    run: async (_name, fn) => fn()
  };
}

export async function onDiagnosticPaidSoftPull(event, db, env = process.env) {
  if (!event?.orgId) return { ok: false, reason: "no_org" };
  return runC00({
    event,
    db,
    step: syncStep(),
    env
  });
}

// The payment webhook may arrive before the client authorizes. Resume that
// SAME verified payment event after consent, so C-00 keeps its original ledger
// idempotency key and cannot order a second pull for one payment.
export async function paidDiagnosticEventForClient(db, { orgId, clientId, amountCents }) {
  const rows = (await db.query(
    `SELECT id, org_id, client_id, payload
       FROM events
      WHERE org_id = $1 AND client_id = $2 AND name = 'diagnostic.paid'
        AND payload->>'source' = 'commas'
        AND payload->>'product' = 'crs'
      ORDER BY created_at DESC LIMIT 50`,
    [orgId, clientId]
  )).rows;
  const paid = rows.map((row) => ({
    event: { id: row.id, orgId: row.org_id, clientId: row.client_id, payload: row.payload },
    amountCents: Math.round(Number(row.payload?.amount) * 100)
  })).filter((row) => Number.isFinite(row.amountCents) && row.amountCents > 0);
  return paid.find((row) => row.amountCents === amountCents) || paid[0] || null;
}

export async function resumePaidDiagnosticSoftPull(db, {
  orgId, clientId, amountCents, env = process.env, runPaidPull = onDiagnosticPaidSoftPull
}) {
  const paid = await paidDiagnosticEventForClient(db, { orgId, clientId, amountCents });
  if (!paid) return { paid: false, pull: null };
  if (paid.amountCents !== amountCents) {
    return { paid: true, pull: null, reason: "paid_amount_mismatch" };
  }
  try {
    const pull = await runPaidPull(paid.event, db, env);
    return { paid: true, pull };
  } catch (err) {
    // Payment stays paid even if the provider is down. Never show another till.
    return { paid: true, pull: null, error: String(err?.message || err).slice(0, 160) };
  }
}

export function register() {
  on("diagnostic.paid", onDiagnosticPaidSoftPull);
}
