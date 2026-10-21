/* Repair desk lens — pure. Row facts in → chip + due words out.
 *
 * No database. No clock unless the caller passes `asOf`.
 * Spec: ops/workflows/repair-build-spec-2026-08-21.md §8–§9.
 * The API ships facts; this module draws conclusions (same split as
 * src/fulfillment/next-action.mjs).
 *
 * THE LENS LIVES IN src/pulse/beats/lib/repair-lens.mjs (2026-10-20), moved
 * whole and unchanged, so the progress timeline the hourly pulse reads renders
 * its lines with the same timelineLine() (a beat may import only from the beat
 * library). Every caller imports from here as before. Change the lens there.
 * public/app/inquiry-remover.html still carries its own mirrored copy of the
 * pure helpers (FH-REPAIR-LENS-BEGIN), as it did before this move.
 */

export * from "../pulse/beats/lib/repair-lens.mjs";
