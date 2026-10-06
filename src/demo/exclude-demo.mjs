export function andNotDemo(alias = "c") {
  return `AND COALESCE(${alias}.is_demo, false) = false`;
}
export async function orgDemoModeEnabled(db, orgId) {
  if (!orgId) return false;
  const r = await db.query(`SELECT demo_mode_enabled FROM orgs WHERE id = $1`, [orgId]);
  return r.rows[0]?.demo_mode_enabled === true;
}
export function crmDemoFilterSQL(alias = "c", { demoMode = false } = {}) {
  if (demoMode) return "";
  return `AND COALESCE(${alias}.is_demo, false) = false`;
}
export function demoClause(alias = "", { includeDemo = false } = {}) {
  if (includeDemo) return "";
  const col = alias ? `${alias}.is_demo` : "is_demo";
  return `AND COALESCE(${col}, false) = false`;
}

/* andNotTestAddress — leave out client rows whose email says a test run or one
   of us made them. The SQL twin of the email half of classifyVisitor() in
   src/slo/visitor.mjs (same domains, same local-part tags), so a report and
   the page tracker agree on who is a real person.

   Why it exists: e2e and hand-walk runs on production write clients without
   is_demo (only a +fhtest address sets it). Measured 2026-10-05, Ops & Admin
   "New clients", last 7 days: 23 shown, 4 real — 19 were @fundhub.ai,
   @example.com or e2e/sim/test addresses. A row with no email is kept. */
export function andNotTestAddress(alias = "c") {
  const e = `lower(coalesce(${alias}.email, ''))`;
  return `AND NOT (split_part(${e}, '@', 2) IN ('fundhub.ai', 'example.com', 'example.net', 'example.org')
            OR split_part(${e}, '@', 1) ~ '(^|[.+_-])(e2e|sim|test)([.+_-]|$)')`;
}
