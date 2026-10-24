# Giovanni banks went live — 2026-10-24

Chris said go live. Giovanni's list is the source of truth.

Undo file: `ops/workflows/giovanni-banks-2026-10-24-before.csv` (1,106 rows, all on, taken before the change).

The change is migration `db/migrations/504_giovanni_banks_2026_10_24.sql`. It turns rows off. It does not delete any row.

## Conflicts (the list won)

- Wells Fargo: the list says Experian. A spoken note also said TransUnion. Saved as Experian.
- Truist: the old book said Equifax. The list says TransUnion. Saved as TransUnion.
- Bank of America: the old book said all three bureaus. The list says TransUnion. Saved as TransUnion.

## Personal cards turned off

These banks have a business card, so the personal products were turned off:

- Chase Freedom, Chase Sapphire Preferred, Chase Sapphire Reserve, Chase personal loan
- Amex Blue Cash, Amex Delta Gold, Amex Hilton, Amex Marriott
- Wells Fargo Reflect, Wells Fargo personal loan
- Bank of America cash card, Bank of America personal loan

Navy Federal's only row was a personal loan. That row was changed into the business card. It was not turned off.

## Still not fully verified

- Elan has no public customer apply page. The saved link is Elan's own business-card page.
- Wings business card: no online form. The page says call or visit a branch.
- Langley Federal: the business-card page is up. No separate apply button was found. No bureau on the list.
- QuickBooks Capital page was read and it is real. A direct check from this computer timed out. Apply happens inside QuickBooks.
- PNC's page was read earlier today. A later direct check from this computer timed out. The saved link was already that page.
- TCM has no customer apply page on tcmbank.com. The 17 partner rows stay on, with the 2-year rule. Franklin's link was a 404 page, so that link was cleared. The other partner links were not each opened again.
- Logos not replaced, because no clean official file was saved: Wells Fargo, FNBO, First Arkansas, Navy Federal, Intuit, QuickBooks Capital, Langley.
- Logos replaced from the bank's own site: Elan, Amex, Truist, Flagstar, Citizens, Barclays, Wings.
- Chase, Bank of America, and PNC logos were already the right marks. Left as they were.
