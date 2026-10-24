-- 504_giovanni_banks_2026_10_24.sql
--
-- Giovanni's bank list is the source of truth (photo 2026-10-24).
-- Hide every other lender. Do not delete any row.
-- A full copy of the book before this change is
-- ops/workflows/giovanni-banks-2026-10-24-before.csv.
--
-- A fresh database has no lender rows (they are loaded by script, not by
-- older migrations). These updates then change nothing, and the inserts add
-- the five banks that were missing.

-- Keep these rows on, and turn every other row off.
UPDATE lenders
   SET active = false,
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE NOT (id = ANY (ARRAY[
   '9f4d147d-d1c9-4603-b9e3-60cd2ad7c66c',
   'd1951308-c2d2-4eb9-8890-6a4ad79a22fe',
   'add28c99-6f94-4559-af91-58b99e62f535',
   '97f2ce2d-d996-46ca-80eb-ea2432604aec',
   '764d53ed-d4c8-4cc0-9224-3060d5852acf',
   '612158b4-a71c-4b69-b286-b9930d112ced',
   '2cd3b84c-1a49-4034-9031-1d7bd8e83250',
   'bb1e8cc2-b524-4b50-8d2c-58ee1673b9a4',
   'd9bd0743-5439-4041-bd11-18925ac8ecf3',
   'f16c8dd9-d700-4f68-9d87-e01d4ffdb8de',
   '94de366d-8991-42e2-96a1-f1315e98cd98',
   '628ac256-2f4e-434a-9d6f-8f3ca8278eb0',
   '706b1d71-e6d9-4cc6-bf53-f9bc385df5b4',
   '96c81cce-c429-4b60-9865-afb8d01c4a36',
   'da4b5a4e-30c4-4048-b3d2-a4c87dcab64e',
   '4b881071-259c-462f-a25c-91d645766ed2',
   'c5cc2bbc-152a-4a89-8050-8a78b443b4a9',
   '757f9a3c-d5ca-4ec1-bbc0-5774148235d7',
   '3ed7b3e0-32d2-4008-b373-b571143f119c',
   'e1116896-b321-4970-a04c-22ca5b2eb7a3',
   '6cd24ce2-1505-4f12-904a-0b9339e8ccb2',
   '873f143b-7bcf-4258-8bac-b7725b2029b7',
   '7e869d85-6355-41bd-abca-a1d5cec383fc',
   '9d668dc7-518b-427a-8999-7b1529612197',
   '9f31b59b-ad65-42a6-a8f0-12e119666577',
   '17b5ad5a-c9b2-4450-9eb9-219108d6ad14',
   '05bbd039-8da7-4e51-a698-332231f16fd8',
   '5bbca9fd-d43c-4d44-a4cd-f66f71a3f592',
   '55881e9c-1173-4b2e-b9f8-579c25a9ef5d',
   'cd324887-03aa-4d0e-bbea-5b8f852e8f14',
   '344a38c4-d98c-4a50-b86b-494131af75cc',
   '8b49bfe8-e094-471f-99f9-c03e68bbe940',
   'c2f6da89-9b15-474d-86bd-b322e2344430',
   'acacce99-eca1-46d9-a8dd-c997046531b7',
   '7e51380b-9380-442e-b8d2-3564ace3ce0d',
   '33c088ce-b847-4252-a3b7-8916a4d8411d',
   '21c1ad2a-94bd-4e9d-a3c6-c61fc7e6e20f',
   '8fd5dc51-20c6-44e2-bdca-68510efa1618'
 ]::uuid[]));

-- Chase business. Experian. No state limit on the list.
UPDATE lenders
   SET application_url = 'https://creditcards.chase.com/business-credit-cards',
       bureaus_pulled = 'EX',
       eligible_states = 'All States',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '9f4d147d-d1c9-4603-b9e3-60cd2ad7c66c',
   'd1951308-c2d2-4eb9-8890-6a4ad79a22fe'
 ]::uuid[]);

-- Elan. TransUnion mostly. No public customer apply page. This is Elan's own
-- business-card page. A client still applies at a partner bank.
UPDATE lenders
   SET application_url = 'https://www.elanfinancialservices.com/credit-card/what-we-offer/product-suites/business-products.html',
       bureaus_pulled = 'TU',
       eligible_states = 'All States',
       logo_path = '/assets/lenders/elan-wordmark.svg',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: TransUnion mostly. No public customer apply page. This page is Elan''s own business-card page. Apply at a partner bank.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = 'add28c99-6f94-4559-af91-58b99e62f535'::uuid;

-- Amex business. Experian, or no pull if they already have an Amex account.
UPDATE lenders
   SET application_url = 'https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/',
       bureaus_pulled = 'EX',
       eligible_states = 'All States',
       logo_path = '/assets/lenders/amex-bluebox.svg',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian, or no pull if the client already has an Amex account.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = '97f2ce2d-d996-46ca-80eb-ea2432604aec'::uuid;

-- Wells Fargo. The list says Experian. A spoken note also said TransUnion. The list wins.
UPDATE lenders
   SET application_url = 'https://www.wellsfargo.com/biz/business-credit/credit-cards/',
       bureaus_pulled = 'EX',
       eligible_states = 'All States',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian.', NULLIF(stated_requirements, '')),
       notes = concat_ws(E'\n', NULLIF(notes, ''), 'List says Experian. A spoken note also said TransUnion. The list wins.'),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '764d53ed-d4c8-4cc0-9224-3060d5852acf',
   '612158b4-a71c-4b69-b286-b9930d112ced'
 ]::uuid[]);

-- Truist. The list says TransUnion. The old book said Equifax. The list wins.
UPDATE lenders
   SET application_url = 'https://www.truist.com/small-business/credit-cards',
       bureaus_pulled = 'TU',
       eligible_states = 'All States',
       logo_path = '/assets/lenders/truist-wordmark.svg',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: TransUnion.', NULLIF(stated_requirements, '')),
       notes = concat_ws(E'\n', NULLIF(notes, ''), 'Old book said Equifax. The list says TransUnion. The list wins.'),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '2cd3b84c-1a49-4034-9031-1d7bd8e83250',
   'bb1e8cc2-b524-4b50-8d2c-58ee1673b9a4'
 ]::uuid[]);

-- Bank of America. The list says TransUnion. The old book said all three. The list wins.
UPDATE lenders
   SET application_url = 'https://business.bankofamerica.com/en/credit-cards',
       bureaus_pulled = 'TU',
       eligible_states = 'All States',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: TransUnion.', NULLIF(stated_requirements, '')),
       notes = concat_ws(E'\n', NULLIF(notes, ''), 'Old book said Experian, Equifax, and TransUnion. The list says TransUnion. The list wins.'),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   'd9bd0743-5439-4041-bd11-18925ac8ecf3',
   'f16c8dd9-d700-4f68-9d87-e01d4ffdb8de'
 ]::uuid[]);

-- Flagstar. Experian. Issued by FNBO. These 12 states.
UPDATE lenders
   SET application_url = 'https://www.card.fnbo.com/mpp/fi/flagstar/business/web-visa',
       bureaus_pulled = 'EX',
       eligible_states = 'AZ, CA, CT, FL, IN, MI, NJ, NY, NC, OH, WI',
       logo_path = '/assets/lenders/flagstar-wordmark.svg',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian. FNBO underwrites this card. States: AZ, CA, CT, FL, IN, MI, NJ, NY, NC, OH, WI.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '94de366d-8991-42e2-96a1-f1315e98cd98',
   '628ac256-2f4e-434a-9d6f-8f3ca8278eb0'
 ]::uuid[]);

-- FNBO Evergreen rows. Experian. The state list on the photo.
UPDATE lenders
   SET application_url = 'https://www.fnbo.com/small-business/credit-cards/evergreen',
       bureaus_pulled = 'EX',
       eligible_states = 'CO, IL, IA, KS, NE, SD, TX, WY',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian. States: CO, IL, IA, KS, NE, SD, TX, WY.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '706b1d71-e6d9-4cc6-bf53-f9bc385df5b4',
   '96c81cce-c429-4b60-9865-afb8d01c4a36'
 ]::uuid[]);

-- FNBO home row. Same bureau and states. Point it at the card list, not the home page.
UPDATE lenders
   SET application_url = 'https://www.fnbo.com/small-business/credit-cards/',
       bureaus_pulled = 'EX',
       eligible_states = 'CO, IL, IA, KS, NE, SD, TX, WY',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian. States: CO, IL, IA, KS, NE, SD, TX, WY.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = 'da4b5a4e-30c4-4048-b3d2-a4c87dcab64e'::uuid;

-- First Arkansas Bank & Trust. National. No bureau on the list. Do not invent one.
UPDATE lenders
   SET application_url = 'https://www.fabandt.bank/business/credit-cards',
       bureaus_pulled = NULL,
       business_bureau_pulled = NULL,
       eligible_states = 'All States',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: national. No bureau stated.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = '4b881071-259c-462f-a25c-91d645766ed2'::uuid;

-- Citizens. Equifax. The old link is a dead page.
UPDATE lenders
   SET application_url = 'https://www.citizensbank.com/small-business/business-credit-cards/overview.page',
       bureaus_pulled = 'EQ',
       eligible_states = 'CT, DE, FL, MD, MA, MI, NH, NJ, NY, OH, PA, RI, VT, VA, DC',
       logo_path = '/assets/lenders/citizens-wordmark.svg',
       active = true,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Equifax.', NULLIF(stated_requirements, '')),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = 'c5cc2bbc-152a-4a89-8050-8a78b443b4a9'::uuid;

-- Navy Federal. This row was a personal loan. It is now the business card.
-- Many clients are already members. Every owner must be a member.
UPDATE lenders
   SET lender_table = 'OnlineBizCC',
       product_name = 'GO BIZ Rewards Business Credit Card',
       application_url = 'https://www.navyfederal.org/services/business/credit-cards.html',
       bureaus_pulled = 'TU',
       eligible_states = 'All States',
       active = true,
       stated_requirements = 'Giovanni list: TransUnion. Business credit card. Every owner must already be a Navy Federal member.',
       notes = concat_ws(E'\n', NULLIF(notes, ''), 'Was a personal loan. Replaced with the business card on 2026-10-24. No official logo file was saved.'),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = '757f9a3c-d5ca-4ec1-bbc0-5774148235d7'::uuid;

-- PNC. Problem bank. Keep it visible. Experian. Checking open 45 days.
UPDATE lenders
   SET bureaus_pulled = 'EX',
       active = true,
       requires_account_opening = 'Checking account open for 45 days.',
       stated_requirements = concat_ws(E'\n', 'Giovanni list: Experian. Problem bank. Wants a checking account open for 45 days.', NULLIF(stated_requirements, '')),
       documentation_required = concat_ws(E'\n', 'Checking account open for 45 days.', NULLIF(documentation_required, '')),
       notes = concat_ws(E'\n', NULLIF(notes, ''), 'Problem bank. Experian. Checking account open for 45 days. The photo cut off after that.'),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '3ed7b3e0-32d2-4008-b373-b571143f119c',
   'e1116896-b321-4970-a04c-22ca5b2eb7a3',
   '6cd24ce2-1505-4f12-904a-0b9339e8ccb2'
 ]::uuid[]);

-- TCM partner rows stay visible. There is no public customer apply page on
-- tcmbank.com. The 2-year rule and Experian go on these rows.
-- Franklin's saved link is a 404 page. Clear that one link. Do not delete the row.
UPDATE lenders
   SET application_url = NULL
 WHERE id = '5bbca9fd-d43c-4d44-a4cd-f66f71a3f592'::uuid
   AND application_url = 'https://www.franklinbnk.com/home/diFiles/skins/wcErrors/404.html';

UPDATE lenders
   SET bureaus_pulled = 'EX',
       active = true,
       minimum_time_in_business_years = 2,
       stated_requirements = concat_ws(E'\n', 'Giovanni list: pulls Experian. Requires 2 years in business. Problem bank.', NULLIF(stated_requirements, '')),
       documentation_required = concat_ws(E'\n', '2 years in business.', NULLIF(documentation_required, '')),
       notes = concat_ws(E'\n', NULLIF(notes, ''), 'Problem bank. TCM. Pulls Experian. Requires 2 years in business.'),
       last_updated_by = 'giovanni list 2026-10-24',
       last_updated_date = DATE '2026-10-24'
 WHERE id = ANY (ARRAY[
   '873f143b-7bcf-4258-8bac-b7725b2029b7',
   '7e869d85-6355-41bd-abca-a1d5cec383fc',
   '9d668dc7-518b-427a-8999-7b1529612197',
   '9f31b59b-ad65-42a6-a8f0-12e119666577',
   '17b5ad5a-c9b2-4450-9eb9-219108d6ad14',
   '05bbd039-8da7-4e51-a698-332231f16fd8',
   '5bbca9fd-d43c-4d44-a4cd-f66f71a3f592',
   '55881e9c-1173-4b2e-b9f8-579c25a9ef5d',
   'cd324887-03aa-4d0e-bbea-5b8f852e8f14',
   '344a38c4-d98c-4a50-b86b-494131af75cc',
   '8b49bfe8-e094-471f-99f9-c03e68bbe940',
   'c2f6da89-9b15-474d-86bd-b322e2344430',
   'acacce99-eca1-46d9-a8dd-c997046531b7',
   '7e51380b-9380-442e-b8d2-3564ace3ce0d',
   '33c088ce-b847-4252-a3b7-8916a4d8411d',
   '21c1ad2a-94bd-4e9d-a3c6-c61fc7e6e20f',
   '8fd5dc51-20c6-44e2-bdca-68510efa1618'
 ]::uuid[]);

-- Banks that had no row. Add them only when that name is not already there.
INSERT INTO lenders (
  org_id, lender_table, name, product_name, application_url, logo_path,
  eligible_states, bureaus_pulled, stated_requirements, notes, active,
  last_updated_by, last_updated_date, is_demo
)
SELECT l.org_id, 'OnlineBizCC'::lender_table, v.name, v.product_name, v.application_url, v.logo_path,
       'All States', v.bureaus_pulled, v.stated_requirements, v.notes, true,
       'giovanni list 2026-10-24', DATE '2026-10-24', false
  FROM lenders l
  JOIN (VALUES
    ('Intuit', 'Intuit Business Credit Card', 'https://www.intuit.com/credit-card/', NULL::text,
     'Giovanni list: Experian pre-approval. Soft check. Issued by WebBank.',
     'Added 2026-10-24. No official logo file was saved.'),
    ('QuickBooks Capital', 'QuickBooks Line of Credit', 'https://quickbooks.intuit.com/business-banking/loans/', NULL::text,
     'Giovanni list: Experian pre-approval. Soft check. Apply inside QuickBooks. Issued by WebBank.',
     'Added 2026-10-24. No official logo file was saved.'),
    ('Barclays', 'Business credit cards', 'https://cards.barclaycardus.com/banking/Business/', '/assets/lenders/barclays-wordmark.svg',
     'Giovanni list: TransUnion. This is the business-card list. There is no single Barclays business card.',
     'Added 2026-10-24.'),
    ('Wings Credit Union', 'Wings Business Rewards Visa', 'https://www.ent.com/business/borrow/ent-business-rewards-visa-credit-card/', '/assets/lenders/wings-wordmark.svg',
     'Giovanni list: Experian. No online business-card form was found. Apply by phone at 800-525-9623 or in a branch. Membership is required.',
     'Added 2026-10-24. The business page says phone or branch. Personal cards on wingscu.com have an online form. This row uses the business page.'),
    ('Langley Federal Credit Union', 'Platinum Visa Business', 'https://www.langleyfcu.org/business-credit-cards', NULL::text,
     'Giovanni list: no bureau stated. Membership is required. No separate online card form was found on this page.',
     'Added 2026-10-24. No official logo file was saved.')
  ) AS v(name, product_name, application_url, logo_path, stated_requirements, notes) ON true
 WHERE l.id = '97f2ce2d-d996-46ca-80eb-ea2432604aec'::uuid
   AND NOT EXISTS (
     SELECT 1 FROM lenders x
      WHERE x.org_id = l.org_id AND x.name = v.name AND x.product_name = v.product_name
   );
