// Rounds 4 and 5 — the two regulator complaints — in three states.
//
// MOVED, ONE COPY (2026-10-20): the code lives in src/pulse/beats/lib/progress-escalations.mjs,
// so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. Every name is re-exported here, so callers import from this file as before.
// Change it there.

export * from "../pulse/beats/lib/progress-escalations.mjs";
