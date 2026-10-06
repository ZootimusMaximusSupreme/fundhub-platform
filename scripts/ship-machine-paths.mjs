// @ts-check
// scripts/ship-machine-paths.mjs — the folders only the marketing machine writes.
//
// ONE LIST, TWO READERS (spec docs/specs/marketing-machine-2026-10-04.md, M0 step 8):
//   - scripts/ship.mjs: a change that touches only these folders is "nothing to ship".
//   - scripts/netlify-ignore-machine-only.mjs: a GitHub-started Netlify build whose
//     whole change is in these folders is skipped.
// Both import this file. Neither keeps its own copy, so the two can never disagree.
//
// WHY. Once the repo outbox is live (spec M0 step 2), every save Chris makes in the
// Command Center or the teleprompter is a commit on GitHub's main. Script drafts, ideas,
// video notes, brain notes and page requests are data the app reads back through
// GitHub, not code the site runs, so a commit made only of them must not cost a
// production build (the 2026-08-06 lesson: per-change deploys burned the month's
// build credits and paused the site).
//
// NOT on this list, on purpose: marketing/ads/RULES.md, VOICE.md, registry.json,
// banned-live.json and angles.json. The outbox writes those too, but they change how
// the machine writes, so they still ship (spec M0 step 8: "Rule, voice and registry
// changes still ship").
//
// Node built-ins only: Netlify runs the ignore script before it installs packages.

/** Folder prefixes, each ending in "/", relative to the repo root. */
export const MACHINE_ONLY_PATHS = Object.freeze([
  "marketing/ads/scripts/machine/",
  "marketing/ads/ideas/",
  "marketing/ads/videos/",
  "marketing/brain/",
  "ops/page-requests/"
]);

/**
 * True when one repo path (as git prints it: relative to the top, "/" between
 * folders) is a file inside one of the machine-only folders. Anything odd — a
 * "..", ".", empty folder name, backslash, or a non-string — is NOT machine-only,
 * so an odd path always counts as a real change.
 * @param {unknown} p
 * @returns {boolean}
 */
export function isMachinePath(p) {
  if (typeof p !== "string" || !p) return false;
  const rel = p.startsWith("./") ? p.slice(2) : p;
  if (rel.includes("\\") || rel.includes("\0")) return false;
  const parts = rel.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  return MACHINE_ONLY_PATHS.some((prefix) => rel.startsWith(prefix));
}

/**
 * True only when at least one path changed and every changed path is machine-only.
 * An empty list is false: "nothing changed" is not a machine-only change, and each
 * caller decides what nothing means for it.
 * @param {readonly unknown[]} paths
 * @returns {boolean}
 */
export function isMachineOnlyChange(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  return paths.every(isMachinePath);
}

/**
 * git pathspecs that leave the machine-only folders out of a diff, for
 * `git diff ... -- . <these>`.
 * @returns {string[]}
 */
export function skipDiffPathspecs() {
  return MACHINE_ONLY_PATHS.map((p) => `:(exclude)${p}`);
}
