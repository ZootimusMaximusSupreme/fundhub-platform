// Read-only financial eligibility for human repair mailing.
// Never treat an old signature or a refunded sale as ongoing service authority.
export function activePaidRepairSql(orgPos = 1, clientPos = 2) {
  if (![orgPos, clientPos].every(n => Number.isInteger(n) && n >= 1 && n <= 9))
    throw new TypeError("invalid bind position");
  return `EXISTS (
    SELECT 1 FROM repair_programs rp
     WHERE rp.org_id = $${orgPos}::uuid
       AND rp.client_id = $${clientPos}::uuid
       AND rp.status = 'active'
       AND EXISTS (
         SELECT 1 FROM sales s
          JOIN products pr ON pr.id = s.product_id AND pr.org_id = s.org_id
         WHERE s.org_id = rp.org_id AND s.client_id = rp.client_id
           AND s.status = 'active' AND pr.category = 'repair'
           AND ((rp.program = 'trial' AND pr.code = 'repair-trial')
             OR (rp.program = 'full' AND pr.code <> 'repair-trial'))
           AND (SELECT COALESCE(SUM(CASE
                 WHEN sp.kind IN ('deposit', 'installment') THEN sp.amount
                 WHEN sp.kind = 'refund' THEN -sp.amount
                 ELSE 0 END), 0)
                FROM sale_payments sp
               WHERE sp.org_id = s.org_id AND sp.sale_id = s.id) > 0
       )
  )`;
}
export async function hasActivePaidRepairProgram(db, {orgId, clientId} = {}) {
 if (!db?.query || !orgId || !clientId) return false;
 try {
   const r=await db.query(`SELECT ${activePaidRepairSql(1,2)} AS eligible`,[orgId,clientId]);
   return r.rows?.[0]?.eligible === true;
 } catch { return false; } // unknown financial/program state must fail closed.
}
