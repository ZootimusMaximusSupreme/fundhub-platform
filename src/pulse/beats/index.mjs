// Every beat, as a literal import.
//
// A folder scan ships EMPTY (ship trap 4; src/pulse/coverage/modules.mjs:1-11): the
// bundler follows imports it can see, not files it can list. So each beat is one
// literal line below, sorted by id. beats.test.mjs fails if the files on disk and
// this list disagree.
//
// ONLY THE INTEGRATOR EDITS THIS LIST (pulse v1 board). A beat builder tests the
// beat directly and with `node scripts/pulse/run-beat.mjs <id>`.
//
// Entry shape: ["beat-<id>.mjs", () => import("./beat-<id>.mjs")]

import { validateBeat } from "./contract.mjs";

export const BEAT_FILES = Object.freeze([
  ["beat-apply-links.mjs", () => import("./beat-apply-links.mjs")],
  ["beat-auth-links.mjs", () => import("./beat-auth-links.mjs")],
  ["beat-bank-links.mjs", () => import("./beat-bank-links.mjs")],
  ["beat-bank-outreach.mjs", () => import("./beat-bank-outreach.mjs")],
  ["beat-blueprint-delivery.mjs", () => import("./beat-blueprint-delivery.mjs")],
  ["beat-brief-link.mjs", () => import("./beat-brief-link.mjs")],
  ["beat-checkout-doors.mjs", () => import("./beat-checkout-doors.mjs")],
  ["beat-db-health.mjs", () => import("./beat-db-health.mjs")],
  ["beat-doors-live.mjs", () => import("./beat-doors-live.mjs")],
  ["beat-email-path.mjs", () => import("./beat-email-path.mjs")],
  ["beat-engine-alive.mjs", () => import("./beat-engine-alive.mjs")],
  ["beat-funding-trip.mjs", () => import("./beat-funding-trip.mjs")],
  ["beat-invoice-checkout-retirement.mjs", () => import("./beat-invoice-checkout-retirement.mjs")],
  ["beat-invoice-notice-recovery.mjs", () => import("./beat-invoice-notice-recovery.mjs")],
  ["beat-lead-handoff.mjs", () => import("./beat-lead-handoff.mjs")],
  ["beat-lead-pipe.mjs", () => import("./beat-lead-pipe.mjs")],
  ["beat-money-checkout.mjs", () => import("./beat-money-checkout.mjs")],
  ["beat-money-funding.mjs", () => import("./beat-money-funding.mjs")],
  ["beat-money-operations.mjs", () => import("./beat-money-operations.mjs")],
  ["beat-native-push.mjs", () => import("./beat-native-push.mjs")],
  ["beat-partner-trip.mjs", () => import("./beat-partner-trip.mjs")],
  ["beat-pay-links.mjs", () => import("./beat-pay-links.mjs")],
  ["beat-pay-webhook.mjs", () => import("./beat-pay-webhook.mjs")],
  ["beat-repair-trip.mjs", () => import("./beat-repair-trip.mjs")],
  ["beat-text-path.mjs", () => import("./beat-text-path.mjs")],
  ["beat-vendor-keys.mjs", () => import("./beat-vendor-keys.mjs")],
  ["beat-whop-billing.mjs", () => import("./beat-whop-billing.mjs")]
]);

/**
 * Import every beat, validate it, and return the modules. Throws on a bad beat,
 * a duplicate id, or a loader that fails: a broken list must stop the run loudly,
 * never run with fewer beats and say nothing.
 *
 * Reads no file at run time (the live bundle carries none); the disk check
 * (file names, fix-guide paths) lives in beats.test.mjs.
 */
export async function loadBeats(files = BEAT_FILES) {
  const beats = [];
  const seen = new Set();
  const problems = [];
  for (const [file, load] of files) {
    let mod;
    try {
      mod = await load();
    } catch (err) {
      problems.push(`${file}: could not be imported: ${(err && err.message) || err}`);
      continue;
    }
    const found = validateBeat(mod, { file });
    for (const p of found) problems.push(`${file}: ${p}`);
    if (seen.has(mod?.id)) problems.push(`${file}: duplicate beat id "${mod.id}"`);
    seen.add(mod?.id);
    if (!found.length) beats.push(mod);
  }
  if (problems.length) throw new Error(`bad beat list:\n  ${problems.join("\n  ")}`);
  return beats;
}
