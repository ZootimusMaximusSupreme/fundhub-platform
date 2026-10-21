// Is Demo Mode on for this company? One read of orgs.demo_mode_enabled. Read only.
//
// ONE COPY (2026-10-20). This function used to live in src/demo/exclude-demo.mjs. It moved here,
// unchanged, because the lender reads (listLenders and matchForClient in ./lenders-truth.mjs) ask it
// first and the hourly beat lender-book runs those reads; a beat may import only from
// src/pulse/beats/lib. src/demo/exclude-demo.mjs re-exports it, so every caller imports from there as
// before. (./pipeline-boards-truth.mjs still holds its own older copy, held equal by its test.)

export async function orgDemoModeEnabled(db, orgId) {
  if (!orgId) return false;
  const r = await db.query(`SELECT demo_mode_enabled FROM orgs WHERE id = $1`, [orgId]);
  return r.rows[0]?.demo_mode_enabled === true;
}
