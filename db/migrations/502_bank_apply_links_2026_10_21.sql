-- 502_bank_apply_links_2026_10_21.sql
--
-- Two bank Apply links open a "Page Not Found" page. The hourly pulse is red on both:
-- beat apply-links, step confirm, "www.banklandmark.com BAD_URL 404 (lender 373b7a55);
-- www.mybrb.bank BAD_URL 404 (lender b004d840)".
--
-- 1. BLUE RIDGE BANK (b004d840, OnlineBizCC). The bank rebuilt its website ("Say hello to the new
--    and improved mybrb.bank!" on its home page, read 2026-10-20) and the old card page is gone:
--
--      old  https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html   404
--      new  https://www.mybrb.bank/business/credit/cards.html                      200
--
--    The new page is the bank's own Business Credit Cards page, linked from its home page menu
--    (Business & Commercial > Borrow > Business Credit Cards). It still sells the product our row
--    describes: Small Business Edge and Summit Mastercards with 0% intro APR for 12 months. So this
--    is a new address for the same page. Last good read 2026-10-19.
--
-- 2. LANDMARK NATIONAL BANK (373b7a55, InBranchBizCC, Kansas). The old card page is gone:
--
--      old  https://www.banklandmark.com/business/additional-business-services/business-credit-cards/   404
--
--    The bank's home page (read 2026-10-21) no longer names any credit card. Its card links are
--    Business Debit Card, Payroll Cards and VISA Debit Cards only. So there is no page to point the
--    Apply button at. The lender rule for this case (src/pulse/beats/beat-apply-links.mjs fix guide):
--    "If the bank no longer takes online applications, clear application_url. Do not delete the
--    lender." The row stays, still active: it is an in-branch card, and whether the branch still
--    offers it is not something a web page can tell us. The Lenders screen shows "No URL" for it,
--    the same as 48 other active banks. Last good read 2026-10-20.
--
-- Each row by id, and only while it still holds the dead address. A row a person has since fixed
-- by hand is left alone, and a database without these lenders (a fresh one: lenders are loaded by
-- scripts, not migrations) changes nothing. Stamps last_updated_by / last_updated_date the same
-- way a save from the Lenders screen does (src/lenders/store.mjs updateLender).
--
-- The old addresses stay on record in the source files (docs/legacy-strong/carl-barton-0apr-business-cards.csv
-- and docs/legacy-strong/lenders-legacy-strong.csv) and here.

UPDATE lenders
   SET application_url   = 'https://www.mybrb.bank/business/credit/cards.html',
       last_updated_by   = 'pulse apply-links fix 2026-10-21',
       last_updated_date = DATE '2026-10-21'
 WHERE id = 'b004d840-ff34-4bf5-8188-0eb6461c966e'::uuid
   AND application_url = 'https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html';

UPDATE lenders
   SET application_url   = NULL,
       last_updated_by   = 'pulse apply-links fix 2026-10-21',
       last_updated_date = DATE '2026-10-21'
 WHERE id = '373b7a55-9fb5-46bb-b74c-0b31aae85889'::uuid
   AND application_url = 'https://www.banklandmark.com/business/additional-business-services/business-credit-cards/';
