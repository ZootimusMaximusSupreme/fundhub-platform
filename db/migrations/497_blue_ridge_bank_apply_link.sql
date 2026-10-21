-- 497_blue_ridge_bank_apply_link.sql
--
-- Blue Ridge Bank's Apply link opens a "Page Not Found" page. The bank rebuilt
-- its website ("Say hello to the new and improved mybrb.bank!" on its home
-- page, read 2026-10-20) and the old card page is gone:
--
--   old  https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html   404
--   new  https://www.mybrb.bank/business/credit/cards.html                      200
--
-- The new page is the bank's own Business Credit Cards page, linked from its
-- home page menu (Business & Commercial > Borrow > Business Credit Cards). It
-- still sells the same product our row describes: Small Business Edge and
-- Summit Mastercards with 0% intro APR for 12 months. So this is a new address
-- for the same page, not a bank that stopped offering the card.
--
-- The hourly pulse is red on it: beat apply-links, step confirm,
-- "www.mybrb.bank BAD_URL 404 (lender b004d840)". Last good read 2026-10-19.
--
-- One row, by id, and only while it still holds the old address. A row a person
-- has since fixed by hand is left alone, and a database without this lender
-- (a fresh one: lenders are loaded by scripts, not migrations) changes nothing.
-- Stamps last_updated_by / last_updated_date the same way a save from the
-- Lenders screen does (src/lenders/store.mjs updateLender).
--
-- The Carl Barton source file (docs/legacy-strong/carl-barton-0apr-business-cards.csv)
-- keeps the old address as the record of what Carl sent. Its importer only fills
-- empty cells (scripts/lenders-import-carl-barton.mjs rule 2), so it cannot put
-- the old address back.

UPDATE lenders
   SET application_url   = 'https://www.mybrb.bank/business/credit/cards.html',
       last_updated_by   = 'pulse apply-links fix 2026-10-20',
       last_updated_date = DATE '2026-10-20'
 WHERE id = 'b004d840-ff34-4bf5-8188-0eb6461c966e'::uuid
   AND application_url = 'https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html';
