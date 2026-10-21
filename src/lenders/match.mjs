/* Match lenders to a client's underwrite profile.

   THE MATCHER LIVES IN src/pulse/beats/lib/lender-match.mjs (2026-10-20), so the hourly beat lender-book
   runs the same matcher as the client control panel and the round planner (a beat may import only from
   the beat library). Every caller imports from here as before. Change the matcher there. */

export * from "../pulse/beats/lib/lender-match.mjs";
