-- A/R A60: client-level receivables are ISSUED outstanding debt, not draft
-- preparation or a stale paid status. Preserve the original view's column
-- names/order/types and zero rows for clients with draft-only history.
--
-- The 031 invoice view computes open_balance for drafts on purpose, for internal
-- invoice inspection. The client-level receivables aggregate must not treat it
-- as an amount collectible. The legacy invoice FK permits an invoice org to
-- disagree with its buyer's org; refuse those rows before grouping.
--
-- This only changes a read view. No invoice, payment, status, due date, or
-- provider is written. Production role/merchant receipt proof is separate.
CREATE OR REPLACE VIEW v_client_ar_balance AS
SELECT
  a.org_id,
  a.client_id,
  a.client_code,
  COUNT(*) FILTER (
    WHERE a.open_balance > 0
      AND a.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  ) AS open_invoices,
  COUNT(*) FILTER (
    WHERE a.is_overdue
      AND a.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  ) AS overdue_invoices,
  COALESCE(SUM(a.open_balance) FILTER (
    WHERE a.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  ), 0) AS balance_due,
  COALESCE(SUM(a.open_balance) FILTER (
    WHERE a.is_overdue
      AND a.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  ), 0) AS overdue_balance,
  MAX(a.days_overdue) FILTER (
    WHERE a.open_balance > 0
      AND a.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  ) AS max_days_overdue,
  MIN(a.due_at) FILTER (
    WHERE a.open_balance > 0
      AND a.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  ) AS oldest_due_at
FROM v_invoice_aging a
JOIN clients c ON c.id = a.client_id AND c.org_id = a.org_id
WHERE a.status NOT IN ('void', 'written_off')
GROUP BY a.org_id, a.client_id, a.client_code;
