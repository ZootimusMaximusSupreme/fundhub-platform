// Is this client on the REPAIR path? One answer, one place.
//
// MOVED, ONE COPY (2026-10-20): the code lives in src/pulse/beats/lib/on-repair-path.mjs,
// so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. Every name is re-exported here, so callers import from this file as before.
// Change it there.

export * from "../pulse/beats/lib/on-repair-path.mjs";
