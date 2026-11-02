// Funding Agreement section 2 credits the deposit once toward the success fee.

export function dealMath({
  orgId,
  deposit = 0,
  feePercent = 0,
  debts = 0,
  minPercent = 3,
  drawn = 0
} = {}) {
  if (!orgId) throw new TypeError("dealMath: orgId required");

  const depositN = Math.max(0, Number(deposit) || 0);
  const fee = Math.max(0, Number(feePercent) || 0);
  const debtsN = Math.max(0, Number(debts) || 0);
  const min = Math.max(0.25, Number(minPercent) || 3);
  const drawnN = Math.max(0, Number(drawn) || 0);
  const fees = depositN + Math.max(0, drawnN * fee / 100 - depositN);
  const net = drawnN - fees - debtsN;
  const monthly = drawnN * min / 100;

  return {
    deposit: depositN,
    fee_percent: fee,
    debts: debtsN,
    min_percent: min,
    drawn: drawnN,
    fees,
    net,
    monthly
  };
}
