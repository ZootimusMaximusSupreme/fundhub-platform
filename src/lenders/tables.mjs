/* Lender product-table constants.

   THE LIST LIVES IN src/pulse/beats/lib/lender-tables.mjs (2026-10-20), so the hourly beat lender-book
   and the lender matcher read one copy (a beat may import only from the beat library). Every caller
   imports from here as before. Change the tables there. */

export * from "../pulse/beats/lib/lender-tables.mjs";
