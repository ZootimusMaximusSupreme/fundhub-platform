/* Map a lender name to an existing public/assets/lenders mark. Never invent a bank. */

import { normalizeName, slugFromName } from "./tips.mjs";

/* LENDER_LOGO_PLACEHOLDER and logoPathOrPlaceholder live in src/pulse/beats/lib/lenders-truth.mjs
   (2026-10-20), beside the lender reads that use them. One copy; re-exported here. */
export { LENDER_LOGO_PLACEHOLDER, logoPathOrPlaceholder } from "../pulse/beats/lib/lenders-truth.mjs";

/* The two exports re-exported above were lost in the 2026-08-27 merge (60c1902b). Two
   branches each ADDED a file at this path — one holding resolveLogoPath, the
   other holding the placeholder helper — so the merge took one whole file and
   dropped the other's contents. Nothing conflicted, because to git this was one
   new file, not two edits.

   src/lenders/store.mjs kept importing logoPathOrPlaceholder from here, which
   made every import chain through the lender store throw at load time and took
   79 tests down with it. Lint and the type check both pass on this, which is the
   trap in CLAUDE.md §12: a missing export is invisible until something runs. */

/** Same institution, different scrape wording → an existing file. */
function aliasPath(rawName) {
  const raw = String(rawName || "");
  const n = normalizeName(raw).toLowerCase();
  if (/amtrust/.test(n)) return "/assets/lenders/amtrust-fnbo.png";
  if (n.startsWith("elan financial")) return "/assets/lenders/elan-financial.png";
  if (n === "ibc bank" || n === "ibc") return "/assets/lenders/ibc.png";
  if (/first national bank of omaha/.test(n) || /\bfnbo\b/i.test(raw)) {
    return "/assets/lenders/fnbo.png";
  }
  if (/centerstate/i.test(raw) && /southstate/i.test(raw)) return "/assets/lenders/southstate-bank.png";
  if (/^the people.?s bank$/i.test(n)) return "/assets/lenders/the-peoples-bank.png";
  return null;
}

/**
 * @param {{ name?: string, externalRowId?: string|null, sidecar?: Record<string, string>, exists: (relPath: string) => boolean }} opts
 * @returns {string|null} site-root path like /assets/lenders/chase.png
 */
export function resolveLogoPath({ name, externalRowId, sidecar, exists }) {
  const fromSidecar = externalRowId && sidecar ? sidecar[externalRowId] : null;
  if (fromSidecar && exists(fromSidecar)) return fromSidecar;

  const alias = aliasPath(name);
  if (alias && exists(alias)) return alias;

  const slug = slugFromName(normalizeName(name));
  const candidates = [slug, `${slug}-0`];
  if (slug.endsWith("-0")) candidates.push(slug.slice(0, -2));
  for (const s of candidates) {
    const rel = `/assets/lenders/${s}.png`;
    if (exists(rel)) return rel;
  }
  return null;
}
