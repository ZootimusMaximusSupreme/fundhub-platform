-- 021_funding_mastery_agreement.sql — Mastery contract wording for Present.
--
-- THE NARRATIVE TERMS ARE NOT THE REAL AGREEMENT AND NO LONGER PRETEND TO BE.
-- They are one loudly marked block for Chris to paste the executed Fundhub
-- Education enrollment agreement into. Everything around it is finished: the
-- parties, the date, the program fee, the no-promise paragraph and the
-- signature block.
--
-- THE SELLER IS WRITTEN INTO THE WORDS, NEVER TYPED. This template used to open
-- "Between: {{field.company_name}} ("we")", filled by a staff member at send
-- time. On 2026-09-03 a closer typed the CLIENT's own company into that box and
-- a $5,000 Fundhub education agreement went out saying the client's company was
-- selling the program to the client. Full reasoning:
-- db/migrations/287_contract_seller_signature_and_real_text.sql.
--
-- 287 IS THE OTHER HALF OF THIS FILE AND BOTH ARE NEEDED. db/ is applied
-- schema → migrations → seed, so this file creates the row on a FRESH database
-- and 287 corrects it on one that already ran the old version — db/migrate.mjs
-- never re-reads an applied file, so editing here alone fixes nothing live.
--
-- Idempotent per org+key.
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): fee timing / consent. No credit
-- outcome claims. This is an education program, not a funding promise.

DO $$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped Mastery agreement seed: no org fundhub';
    RETURN;
  END IF;

  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped Mastery agreement seed: no staff';
    RETURN;
  END IF;

  -- The program fee stays OUTSIDE the marked block: it is held against
  -- src/config/offers.mjs to the cent by src/contracts/offer-fee-language.test.mjs,
  -- and a price moved into free legal text is a price nothing is checking.
  --
  -- The no-promise paragraph also stays outside it. The walk log of 2026-09-03
  -- records it as the one thing the old placeholder got right and which must
  -- survive any rewrite — it is also the paragraph that contradicts the closer's
  -- spoken wrap script on the same sale (F23).
  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, active, created_by)
  VALUES (
    v_org,
    'FUNDING-MASTERY-AGREEMENT',
    'Funding Mastery Program Agreement',
    'contract',
    'funding_mastery',
    -- CHRIS'S EXECUTED TEXT, COPIED VERBATIM, not written here.
    -- Source: docs/contracts/source-2026-08-28/Fundhub-Capital-Academy-Enrollment-Agreement.docx
    -- (put in the repo by Chris on 2026-09-03). Extracted by reading the text of
    -- each <w:p> in word/document.xml in order. Nothing summarised, reordered or
    -- softened. See db/migrations/288_real_contract_text.sql for the full note.
    --
    -- BOTH HALVES ARE NEEDED, and this is the half that actually fires on a fresh
    -- database. The runner applies migrations/ and THEN seed/, so 288's UPDATE runs
    -- before this INSERT has created the row and matches nothing; on an existing
    -- database the reverse is true and the UPDATE is what lands. Change one without
    -- the other and a new environment silently keeps the placeholder.
    --
    -- The document names Fundhub LLC as "we" in its own first sentence and ends in
    -- its own STUDENT / FUNDHUB EDUCATION signature block, so F28 and F29 are
    -- answered by the words themselves. The three merge lines below are only how
    -- this system addresses the contract to a person; the agreement proper still
    -- begins with Chris's first line.
    E'Date: {{today}}\n' ||
    E'Prepared for: {{contact.full_name}}\n' ||
    E'Email: {{contact.email}}\n\n' ||
    E'CAPITAL ACADEMY\n' ||
    E'Enrollment and Service Agreement\n' ||
    E'Fundhub Education — a program of Fundhub LLC\n' ||
    E'\n' ||
    E'This Agreement is between you, the person enrolling (“you” or “Student”), and Fundhub LLC, a Florida limited liability company doing business as Fundhub Education, of 218 Bostick Rd 64, Bowling Green, FL 33834 (“Fundhub Education,” “we,” or “us”).\n' ||
    E'By signing below or by purchasing the program, you agree to these terms. Please read Section 3 and Section 7 carefully.\n' ||
    E'At a glance\n' ||
    E'What you get\n' ||
    E'• Ten modules of self-paced video lessons, released in full on enrollment\n' ||
    E'• Downloadable workbooks and worksheets for every module\n' ||
    E'• Document and letter templates for your own personal use\n' ||
    E'• Reference materials on lender criteria and underwriting basics\n' ||
    E'• Student portal access for the lifetime of the program\n' ||
    E'• All future updates to the curriculum at no additional charge\n' ||
    E'What this is not\n' ||
    E'• We do not contact any credit bureau, creditor, or lender for you\n' ||
    E'• We do not prepare, sign, or submit any document on your behalf\n' ||
    E'• We do not apply for funding for you or broker any loan\n' ||
    E'• We are not your financial advisor, accountant, or attorney\n' ||
    E'• No credit score, dispute result, or funding approval is promised\n' ||
    E'• No income or business result is promised\n' ||
    E'This box is a plain-language summary. The numbered sections below are the actual terms and control if there is any difference.\n' ||
    E'1. What this program is\n' ||
    E'1.1 Capital Academy is Fundhub Education’s full financial education suite: a self-paced, ten-module video curriculum covering personal and business credit fundamentals, business entity and banking setup, financial statement literacy, lender criteria, and funding readiness, together with the templates and workbooks that accompany each module.\n' ||
    E'1.2 Capital Academy teaches you how to do the work. You do the work. Every letter, application, or other document you prepare using our materials is drafted, reviewed, signed, and submitted by you, in your own name, at your own discretion.\n' ||
    E'1.3 The tuition for this program is five thousand United States dollars ($5,000).\n' ||
    E'2. What we are not\n' ||
    E'2.1 Fundhub Education is not a lender, loan broker, financing company, financial advisor, investment advisor, accountant, law firm, or credit repair organization. Nothing in this program is lending, brokering, financial advice, legal advice, tax advice, or credit repair services.\n' ||
    E'2.2 We do not contact credit bureaus, creditors, lenders, or any other third party on your behalf, and we do not act as your agent with any of them.\n' ||
    E'2.3 Because we perform no service on your behalf with any third party, we do not hold ourselves out as, and do not act as, a credit repair organization.\n' ||
    E'3. No guarantees\n' ||
    E'3.1 We make no representation or guarantee about credit scores, score increases, dispute outcomes, the removal of any information from a credit report, lending or credit approval, funding amounts, income, or business results.\n' ||
    E'3.2 Results depend entirely on your own circumstances and your own actions. Any example, figure, or case used in the materials illustrates a concept. It is not a promise of a result, and it is not typical.\n' ||
    E'3.3 Accurate and timely information cannot be removed from a credit report. Any material that appears to suggest otherwise is superseded by this section.\n' ||
    E'4. Eligibility and your account\n' ||
    E'4.1 You must be at least 18 years old and able to enter a binding contract.\n' ||
    E'4.2 You are responsible for keeping your login credentials confidential and for all activity under your account.\n' ||
    E'4.3 Your access is personal to you. It may not be shared, resold, or transferred, and it may not be used to provide services to anyone else.\n' ||
    E'5. Tuition and payment\n' ||
    E'5.1 Tuition is five thousand dollars ($5,000), charged one time. There is no recurring billing and no subscription.\n' ||
    E'5.2 Payments are processed by independent third-party payment providers.\n' ||
    E'5.3 If an installment or financing option is offered at checkout, that option comes from an independent third-party provider under its own terms and its own approval criteria. Fundhub Education is not the lender and is not a party to that financing agreement. If that provider approves you, your obligation to repay it is separate from this Agreement and continues even if this Agreement ends.\n' ||
    E'6. Delivery\n' ||
    E'6.1 Program access is delivered digitally. On successful payment, student portal credentials are issued and every module, video lesson, template, and workbook included in Capital Academy is made available immediately. Access is self-paced and continues for the lifetime of the program, including future curriculum updates, subject to this Agreement.\n' ||
    E'7. Your right to cancel\n' ||
    E'7.1 You may cancel this Agreement for any reason, without penalty and without giving a reason, by notifying us in writing at any time before midnight of the third business day after the date you signed it. If you cancel within that period, we will refund everything you have paid within fifteen (15) days of receiving your notice.\n' ||
    E'7.2 To cancel, send written notice to support@tryfundhub.com, or by mail to Fundhub Education, 218 Bostick Rd 64, Bowling Green, FL 33834. Your notice is effective on the date you send it. Keep a copy.\n' ||
    E'7.3 You do not have to give a reason and we will not ask you to complete any form or speak to anyone to exercise this right.\n' ||
    E'8. Refunds after the cancellation period\n' ||
    E'8.1 After the period in Section 7.1 ends, tuition is non-refundable, because the program is delivered in full at that point and its materials can be copied and retained.\n' ||
    E'8.2 Section 8.1 does not limit any right you have under applicable law, and it does not apply where we fail to deliver the program.\n' ||
    E'8.3 We may suspend or end your access without refund if you breach Section 10, and only for that reason.\n' ||
    E'9. Intellectual property\n' ||
    E'9.1 All videos, curriculum, templates, workbooks, text, and design elements are owned by Fundhub LLC or its licensors and are protected by copyright and other laws.\n' ||
    E'9.2 You receive a limited, personal, non-exclusive, non-transferable licence to use the materials for your own education.\n' ||
    E'9.3 You may not copy, distribute, resell, publish, or create derivative works from the materials, or use them to provide services to anyone else.\n' ||
    E'10. Acceptable use\n' ||
    E'10.1 You will use the program only for lawful purposes.\n' ||
    E'10.2 You will not use any template or material to submit information you know to be false or inaccurate to any credit bureau, creditor, lender, or other party, and you will not misrepresent your identity or engage in any deceptive practice. Doing so may be a crime. It is also a breach of this Agreement.\n' ||
    E'11. Your information\n' ||
    E'11.1 We handle the information you give us in line with applicable privacy law and our published privacy notice.\n' ||
    E'11.2 We collect what we need to deliver the program and support you. We do not sell your personal information.\n' ||
    E'11.3 You choose what you share with us. If you decline to provide information we ask for, we may be unable to deliver part of the program.\n' ||
    E'12. Disclaimers\n' ||
    E'12.1 The program is provided “as is” and “as available,” without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.\n' ||
    E'12.2 Laws, credit reporting practices, and lending criteria change. We work to keep the curriculum current, but we do not warrant that every material is error-free or up to date at all times.\n' ||
    E'13. Limitation of liability\n' ||
    E'13.1 To the maximum extent permitted by law, Fundhub LLC and its members, managers, employees, and contractors will not be liable for indirect, incidental, consequential, special, or punitive damages, or for lost profits, revenue, or data, arising from or related to the program.\n' ||
    E'13.2 Our total aggregate liability arising out of or relating to this Agreement will not exceed the tuition you actually paid.\n' ||
    E'13.3 Nothing in this Agreement limits liability that cannot be limited by law, including liability for fraud.\n' ||
    E'14. Governing law and disputes\n' ||
    E'14.1 This Agreement is governed by the laws of the State of Florida, without regard to its conflict of laws rules.\n' ||
    E'14.2 We will first try to resolve any dispute informally. Contact us at support@tryfundhub.com and we will work with you in good faith for thirty (30) days.\n' ||
    E'14.3 If we cannot resolve it, the dispute will be settled by binding arbitration before a single arbitrator administered by the American Arbitration Association under its Consumer Arbitration Rules. Either of us may instead bring an individual claim in small claims court if it qualifies.\n' ||
    E'14.4 Arbitration is on an individual basis. Class and representative proceedings are not permitted.\n' ||
    E'15. General\n' ||
    E'15.1 This Agreement is the entire agreement between us about this program and replaces any prior discussion, proposal, or statement, including anything said on a sales call that is not written here.\n' ||
    E'15.2 Any change must be in writing and signed by both of us.\n' ||
    E'15.3 If a provision is held unenforceable, it is modified to the least extent needed to be enforceable, or severed, and the rest stays in effect.\n' ||
    E'15.4 You may not assign this Agreement. We may assign it to a successor in a merger or sale of substantially all assets.\n' ||
    E'15.5 Sections 3, 8, 9, 12, 13, 14, and 15 survive the end of this Agreement.\n' ||
    E'15.6 This Agreement may be signed in counterparts and by electronic signature.\n' ||
    E'Acknowledgement\n' ||
    E'By signing, you confirm that you have read this Agreement, that you understand this program is educational, that no credit, funding, or financial result has been promised to you, and that you have received a copy of it.\n' ||
    E'STUDENT\n' ||
    E'\n' ||
    E'Signature\n' ||
    E'\n' ||
    E'Print name\n' ||
    E'\n' ||
    E'Date\n' ||
    E'FUNDHUB EDUCATION\n' ||
    E'\n' ||
    E'Signature\n' ||
    E'\n' ||
    E'Print name and title\n' ||
    E'\n' ||
    E'Date\n' ||
    E'Fundhub Education is a program of Fundhub LLC  |  tryfundhub.com  |  support@tryfundhub.com',

    -- Empty on purpose: the real agreement states its own tuition in its own words
    -- (section 1.3, "five thousand United States dollars ($5,000)"), so there is no
    -- blank left to fill and send is one click (F27).
    '[]'::jsonb,
    true,
    'I have read this program agreement and I agree to it. Typing my name here is my signature.',
    false, -- Decommissioned; retained for existing agreements and later owner review.
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'Funding Mastery agreement seeded (or already present) for org %', v_org;
END $$;
