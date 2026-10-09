// Tripwire map — which deep check goes red when a money or customer surface breaks.
//
// Owner law (2026-10-09, .claude/rules/heartbeat-on-every-build.md): anything that touches money
// or a paying customer gets a tripwire, a deep check that goes red when the customer's result is
// wrong. A ping (reg:…, job:…) proves a door answers or a clock ran. It is not a tripwire.
//
// Every surface sits in exactly one place:
//   TRIPWIRES                 money or customer — names the deep check ids that go red on its break
//   NOT_CUSTOMER_FACING       staff-only or internal — a written reason, 40 characters or more
//   tripwires-baseline.json   surfaces that existed on 2026-10-09 and are not sorted yet.
//                             This list only shrinks. Sort an entry by moving it into one of the two maps.
//
// src/pulse/tripwires.test.mjs fails any build that adds a surface to none of them, names a check
// id that does not exist, or calls a ping a tripwire. That is how a new page, route, job or send
// cannot ship without someone deciding its tripwire.
//
// Surface keys:
//   route:<ROUTES key in netlify/functions/api.mjs>
//   desk:<file in public/app>
//   page:<path under public, outside app>
//   job:<Inngest function id in src/workflows/index.mjs>
//   send:<file named in SEND_PATHS in src/pulse/registry.mjs>
//
// Check ids are the ids the lanes write (src/pulse/coverage/gap-*.mjs, slice-*.mjs) or the pulse's
// own checks (src/pulse/daily-pulse.mjs). The pulse may prefix a gap id with its lane on the
// scorecard; the id named here is the one written in the lane file.

export const TRIPWIRE_IMPACTS = Object.freeze(["money", "customer"]);

/** Ids that only prove a door answers or a clock ran. Never enough on their own. */
export function isPingId(id) {
  return /^(reg|job):/.test(String(id)) || ["health", "login", "apply"].includes(String(id));
}

export const TRIPWIRES = Object.freeze({});

export const NOT_CUSTOMER_FACING = Object.freeze({});
