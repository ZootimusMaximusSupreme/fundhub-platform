/* Repair desk — THE READ LAYER for src/repair/lens.mjs.
 *
 * READ ONLY. SELECT only. No money columns from repair_programs (§2.11 / §9).
 * Spec: ops/workflows/repair-build-spec-2026-08-21.md §8–§9.
 *
 * The API ships facts; lens.mjs draws conclusions. Same split as
 * src/fulfillment/read-signals.mjs.
 *
 * THE READS LIVE IN src/pulse/beats/lib/repair-signals.mjs (2026-10-20), moved
 * whole and unchanged, so the progress timeline the hourly pulse reads runs the
 * same SQL (a beat may import only from the beat library). Every caller imports
 * from here as before: DISPUTE_AUTH_KIND, gatherRepairSignals,
 * gatherRepairDetailSignals. Change the reads there.
 */

export * from "../pulse/beats/lib/repair-signals.mjs";
