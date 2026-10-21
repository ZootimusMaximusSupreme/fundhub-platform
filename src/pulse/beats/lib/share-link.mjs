// The public share link that credits a signup to an affiliate code. ONE COPY (2026-10-20).
//
// This rule used to be the body of shareUrlFor in src/affiliates/share-link.mjs. It moved here unchanged so the
// hourly beat client-progress builds the referral link the same way GET /api/read/client-progress does (a beat may
// import only from src/pulse/beats/lib). The env is handed in: share-link.mjs passes process.env, a beat passes
// ctx.env. Pure.

/**
 * shareUrlFor(code, env) -> the public URL that attributes a signup to `code`.
 * Returns null for a missing code rather than a link with an empty ref, which
 * would attribute a real signup to nobody and read as a working link.
 */
export function shareUrlFor(code, env = {}) {
  const c = code == null ? "" : String(code).trim();
  if (!c) return null;
  const base = String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  return `${base}/start.html?ref=${encodeURIComponent(c)}`;
}
