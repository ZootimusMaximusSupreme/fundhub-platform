// Clients the owner put on hold: no contact and no change.
//
// Owner call 2026-10-09 (ops/workflows/fix-batch-2026-10-09.md), said again 2026-10-20:
// Braum, FH-000507, gets no email, no sign-in link, no call and no data step. He is the
// only real client (owner fact 2026-10-20).
//
// THE LIST LIVES IN src/pulse/beats/lib/owner-hold.mjs (2026-10-20), so the hourly beat
// client-portal and the morning lane gap-portal.mjs read ONE list (a beat may import only
// from the beat library). This file re-exports it, so every caller imports from here as
// before. Add or remove a code there, and only when Chris says so.

export { OWNER_HOLD_CLIENTS, onOwnerHold } from "./beats/lib/owner-hold.mjs";
