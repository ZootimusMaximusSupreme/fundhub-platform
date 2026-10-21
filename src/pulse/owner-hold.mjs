// Clients the owner put on hold: no contact and no change.
//
// ONE LIST, TWO CLOCKS (2026-10-20). The list and its helpers moved, unchanged, to
// src/pulse/beats/lib/owner-hold.mjs, so the morning lanes and the hourly beat that judges late
// repair files read the same hold. A beat may import only from src/pulse/beats/lib. Every
// importer of this file keeps working through the re-export below. Add or remove a code only
// when Chris says so, in that file.

export * from "./beats/lib/owner-hold.mjs";
