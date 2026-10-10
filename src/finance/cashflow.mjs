// Cash in and cash out per posted day, from bank_transactions.
//
// ONE COPY. api/read/finance-command.mjs (the Finance OS roll-up) and
// src/ops/morning-brief.mjs (the morning text) both read cash in / cash out.
// They read it through this function so the morning text can never show a
// different number than the Finance OS screen (CLAUDE.md §8: reuse before
// you build).
//
// Positive amount_cents is money in; negative is money out. Integer cents.
// clientId / entityId are optional filters, exactly as finance-command had them.

export async function loadCashflowByDay(db, { orgId, fromDay, toDay, clientId = null, entityId = null } = {}) {
  const txFilter = [];
  const txParams = [orgId, fromDay, toDay];
  if (clientId) { txParams.push(clientId); txFilter.push(`client_id = $${txParams.length}`); }
  if (entityId) {
    txParams.push(entityId);
    txFilter.push(`bank_account_id IN (SELECT id FROM bank_accounts WHERE entity_id = $${txParams.length})`);
  }
  const txWhere = txFilter.length ? ` AND ${txFilter.join(" AND ")}` : "";

  const r = await db.query(
    `SELECT posted_on::text AS day,
            SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS inflow_cents,
            SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS outflow_cents
       FROM bank_transactions
      WHERE org_id = $1 AND posted_on BETWEEN $2 AND $3${txWhere}
      GROUP BY posted_on ORDER BY posted_on`,
    txParams
  );
  return r.rows;
}

export default loadCashflowByDay;
