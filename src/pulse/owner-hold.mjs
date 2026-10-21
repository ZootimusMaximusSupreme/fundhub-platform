// Clients the owner put on hold: no contact and no change.
//
// Owner call 2026-10-09 (ops/workflows/fix-batch-2026-10-09.md), said again 2026-10-20:
// Braum, FH-000507, gets no email, no sign-in link, no call and no data step. He is the
// only real client (owner fact 2026-10-20).
//
// THE LIST AND ITS HELPERS LIVE IN src/pulse/beats/lib/owner-hold.mjs (2026-10-20), so the
// hourly beats and the morning lanes read ONE list (a beat may import only from the beat
// library). This file re-exports all of it, so every caller imports from here as before.
// Add or remove a code there, and only when Chris says so.

export * from "./beats/lib/owner-hold.mjs";
