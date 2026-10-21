// Clients the owner put on hold: no contact and no change.
//
// Owner call 2026-10-09 (ops/workflows/fix-batch-2026-10-09.md), said again 2026-10-20:
// Braum, FH-000507, gets no email, no sign-in link, no call and no data step. He is the
// only real client (owner fact 2026-10-20).
//
// A check that would tell staff to reach out to one of these clients has nothing a person
// may do about it. When EVERY client such a check names is on this list, the check says
// "nothing to judge" with the code owner-hold-client (src/pulse/na-conditions.mjs), and the
// lane that made the row reads the database again on every audit to prove that is still
// true. The day any other client is waiting, the row is red again, by name.
//
// The list is client codes, owner-set. Add or remove a code only when Chris says so.
//
// WHY THIS FILE IS IN THE BEAT LIBRARY (2026-10-20): the hourly beat client-portal reads
// the same list as the morning lane gap-portal.mjs, and a beat may import only from
// src/pulse/beats/lib. src/pulse/owner-hold.mjs re-exports everything here, so every
// other caller imports from there unchanged. There is ONE list.

export const OWNER_HOLD_CLIENTS = Object.freeze([
  Object.freeze({
    clientCode: "FH-000507",
    setOn: "2026-10-09",
    why: "Owner: do not contact. No email, sign-in link, call or data step."
  })
]);

const CODES = new Set(OWNER_HOLD_CLIENTS.map((c) => c.clientCode));

/** True when this client code is on the owner's no-contact hold. */
export function onOwnerHold(clientCode) {
  return typeof clientCode === "string" && CODES.has(clientCode);
}
