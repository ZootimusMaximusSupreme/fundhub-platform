-- 493_funding_and_repair_agreement_text.sql
--
-- The last two placeholder client agreements get their real words.
--
-- FUNDING-AGREEMENT. Owner-approved 2026-10-20 ("Keep text as is. Send it. Put
-- it in the ready to send file"). The words are docs/agreements/
-- FUNDING-AGREEMENT-ready-to-send.txt (Codex's draft from Chris's terms, sections
-- 1-8 including the consent section from 492), with the system's own SIGNATURES
-- block kept so the e-signing page still shows who signs. The blanks the send
-- panel fills stay: {{field.deposit}} and {{field.success_fee}} (filled from the
-- offer by defaultContractValues, typed over per call when Justice agrees a
-- different figure), and {{contact.full_name}}, {{contact.email}},
-- {{contact.phone}}, {{today}}. The signature sentence column is not touched.
--
-- CREDIT-REPAIR-AGREEMENT. Only the marked placeholder block is replaced; the
-- parties, the date, WHAT YOU PAY ({{field.one_time_fee}}), the no-promise
-- paragraph, the consent section from 492 and the signature block stay. Where
-- each fact in the new terms comes from:
--   * service and refund trigger wording: docs/funding-repair-agreement-drafts-2026-10-20.md
--     (Codex draft from Chris's terms) and the owner answer Q4 in
--     ops/workflows/heartbeat-finish-2026-10-18.md (missed first-round start or
--     agreed rounds not done on schedule -> refund);
--   * "Round one goes out today", "30 to 45 days to answer each round", "watch every
--     dispute and every response": public/app/present.js (REPAIR_DFY wrap);
--   * up to six rounds: docs/finance/fundhub-offers-review-2026-10-11.md;
--   * each round waits on the answer to the one before it: public/optimize-plan.html;
--   * six to nine months: six rounds x 30 to 45 days, from the two lines above;
--   * fee not charged until all services are performed: the after-service
--     structure Codex recorded in the drafts file (owner direction in the
--     heartbeat-finish ledger);
--   * right to cancel: Chris's executed agreements, section 7.1-7.3
--     (db/migrations/288_real_contract_text.sql), with the seller named Fundhub LLC.
--
-- CREDIT-FILE-RIGHTS-DISCLOSURE (new wording). The written statement 15 U.S.C.
-- 1679c(a) requires a credit repair organization to give the consumer before any
-- agreement is executed, as a separate document (1679c(b)), with a signed
-- receipt kept for 2 years (1679c(c)). The statement is copied word for word from
-- the official text, fetched 2026-10-20 from
--   https://www.govinfo.gov/content/pkg/USCODE-2023-title15/html/USCODE-2023-title15-chap41-subchapII-A-sec1679c.htm
-- (uscode.house.gov was down for maintenance at the time). Same file in the repo:
-- docs/agreements/CREDIT-FILE-RIGHTS-DISCLOSURE.txt. It is an ordinary wording on
-- the Send contract panel; the client signs a receipt on the normal signing page.
-- Kind 'authorization', subtype 'credit_file_rights_disclosure' (never the
-- soft-pull pair, so signing it unlocks nothing).
--
-- Guarded: each statement only touches a wording that still carries the
-- placeholder marker, so an edit made on the Contracts screen is never
-- overwritten. Contracts already sent, viewed or signed hold their own frozen
-- copy and are never touched. db/seed/036_funding_and_repair_agreement_text.sql
-- repeats both statements for a fresh database (seeds run after migrations).

UPDATE contract_templates
   SET body = E'FUNDING AGREEMENT\n\nDate: {{today}}\nBetween: Fundhub LLC, a Florida limited liability company operating in Arizona, 218 Bostick Rd 64, Bowling Green, FL 33834 ("Fundhub," "we")\nAnd: {{contact.full_name}} ("Client," "you")\nClient email: {{contact.email}}\nClient phone: {{contact.phone}}\n\n1. ONE-TIME ENGAGEMENT\n\nFundhub will review the information you provide, analyze your personal and business funding profile, identify suitable financing sources, prepare and submit applications you authorize, and coordinate responses. The products covered are personal and business credit cards, personal and business lines of credit, other business credit, merchant cash advances, and SBA products. This is one engagement. A later engagement requires a new agreement and may have different terms.\n\n2. YOUR AGREED PRICE\n\nThe deposit agreed on your sales call is {{field.deposit}}. It is a one-time payment toward Fundhub''s work and is credited once, dollar for dollar, against the success fee for this engagement. It is not a fee added on top of the success fee.\n\nIf funding is secured, the success fee is {{field.success_fee}}. The fee base is the total of confirmed approved limits or amounts, not only what you draw from a credit line. A confirmed approval means a financing source approved a positive dollar amount that Fundhub has recorded. The agreed rate applies to all covered products. We calculate the fee for each funded round, credit the deposit against the total fee once, and give you the approval and payment record used for that calculation. The remaining fee is due as approved funds or credit access are received. If no funding is secured, no back-end success fee is due.\n\nIf an amount properly due remains unpaid after notice, Fundhub may use lawful collection methods and seek a court judgment. Collection against assets requires applicable process and reaches only assets that may lawfully be reached. This agreement does not create an automatic lien or give Fundhub ownership of your assets.\n\n3. THE TWO ACTION GUARANTEES AND DEPOSIT RETURN\n\nThe guarantee clocks begin when you sign this agreement. A Fundhub funding advisor will begin working your file within 24 business hours (G-01). Fundhub will submit your first authorized applications within 72 business hours (G-02). Your delay or error does not pause either clock. If Fundhub misses either action deadline, you may request return of the deposit. If Fundhub meets both deadlines, lack of approval or funding alone does not return the deposit. A change to your credit reports that Fundhub did not cause does not itself trigger a deposit return. No back-end success fee is due without funding. These terms do not limit a cancellation, refund, or dispute right that cannot lawfully be waived.\n\nFundhub does not promise approval, a funding amount, a lender rate, or a particular financial outcome. Financing sources decide application results. Fundhub is not responsible for how you use proceeds, a financing source''s decision, or a credit-report change Fundhub did not cause. This does not excuse Fundhub''s action guarantees or liability that law does not permit it to exclude.\n\n4. LIMITED AUTHORITY AND INFORMATION\n\nYou authorize Fundhub during this engagement to prepare and submit financing applications on your behalf using accurate information you supply and to communicate with financing sources about those applications. If you ask Fundhub to apply for a business, you represent that you have authority to authorize applications for that business. You authorize Fundhub to review your business profile and records in its system, request available LexisNexis information, perform soft credit inquiries, and use analytics, fraud checks, and compliance checks needed for this engagement. A hard inquiry or another action that needs separate consent still requires that consent. Fundhub will use and protect your information for the service and related security checks.\n\nThis limited authority does not let Fundhub sign a loan or credit agreement, accept funds, change your account, or make a false statement for you. New applications stop when this engagement ends or you withdraw the authority in writing. For up to 60 days afterward, Fundhub may verify the status and legitimacy of applications it made during the engagement and investigate delayed account reporting; that follow-up is not authority to submit a new application. Withdrawal does not undo an application already submitted.\n\n5. YOUR COOPERATION; CONFIDENTIAL METHODS\n\nYou will provide complete, accurate, current information, promptly correct errors, and tell Fundhub when approved funds or credit access arrive. Fundhub may ask for reasonable records to reconcile approvals and fees. Knowingly false information or misuse is a material breach. Fundhub may stop work and retain payment for work already performed, subject to the action guarantees and rights that cannot lawfully be waived.\n\nFundhub''s non-public methods, pricing, lender introductions, materials, and business information are confidential. During this engagement, you will not disclose, copy, or use them to bypass Fundhub or compete with Fundhub in the covered funding and credit-repair product lines. This restriction ends when this engagement ends. It does not restrict public information, ordinary knowledge, or lawful communication with a financing source, card issuer, bureau, regulator, or adviser. A client-facing operating rule binds you only if it is provided to you in writing as part of this agreement; private or later-changed repository files are not silently incorporated.\n\n6. ASK FUNDHUB FIRST\n\nWE ASK YOU TO CONTACT FUNDHUB FIRST ABOUT A PAYMENT CONCERN, A CHARGEBACK CONCERN, AN APPLICATION PROBLEM, OR A FINANCING-COMPANY ISSUE SO WE CAN TRY TO RESOLVE IT WITH YOU. BY SIGNING, YOU AGREE TO ASK FUNDHUB FOR HELP FIRST WHEN PRACTICAL AND TO SHARE RELATED NOTICES PROMPTLY SO WE CAN COORDINATE. THIS IS A REQUEST, NOT A WAIVER: YOU MAY CONTACT YOUR FINANCING SOURCE, CARD ISSUER, CREDIT BUREAU, REGULATOR, OR OTHER LAWFUL CHANNEL DIRECTLY. YOU DO NOT NEED TO WAIT FOR FUNDHUB IF WAITING COULD MISS A DEADLINE OR PROTECT A RIGHT.\n\nFundhub may help prepare disputes about inaccurate negative items or personal information on your credit report when you separately authorize that work. Fundhub will not submit an inaccurate claim or prevent you from making your own dispute.\n\n7. GENERAL TERMS\n\nArizona law governs this agreement to the extent permitted by law. An action concerning it may be brought in a court of competent jurisdiction in Arizona unless applicable law requires another forum. This agreement and its agreed price above are the entire agreement for this one-time engagement. A change to price, scope, or guarantees must be in writing and accepted by both parties. If one provision cannot be enforced, the rest remains in effect to the extent lawful.\n\n8. CALLS, AI AND YOUR STORY\n\nRecorded calls. Calls between you and Fundhub may be recorded and kept. Fundhub uses the recordings to keep an accurate record of what was said, to deliver and check its service, and to train its team.\n\nArtificial intelligence. Fundhub uses artificial intelligence (AI) in its service. AI tools analyze your credit file, your funding file and the documents you give us. AI agents work on your file. AI may call you and text you for Fundhub, within your contact preferences.\n\nYour words in our marketing. Fundhub may use your words, your results and your testimonial in its marketing and advertising. That includes what you say on a recorded call or video, your name, your voice and your picture, on its website, on social media and in paid ads.\n\nBy signing, you agree to all three: recorded calls, the use of AI by Fundhub, and the use of your words, results and testimonial in Fundhub marketing.\n\nSIGNATURES\n\nFundhub LLC\n218 Bostick Rd 64, Bowling Green, FL 33834\nSigned by: an authorised signer of Fundhub LLC\nDate: {{today}}\n\n{{contact.full_name}}\n{{contact.email}}\nSigned by: ______________________________\nDate: ______________________________\n\nYou sign by typing your name and ticking the box on the signing page. Your typed name, the date and time you signed, and the exact wording above are saved together as the signed record, and you can ask us for a copy at any time.',
       updated_at = now()
 WHERE template_key = 'FUNDING-AGREEMENT'
   AND strpos(body, 'NOT THE REAL AGREEMENT TEXT') > 0;

UPDATE contract_templates
   SET body = replace(body, '>>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<<

Replace this block, and only this block, with the executed Fundhub LLC credit repair agreement. Everything outside it is already finished and must not change: the parties, the date, the fee, the no-promise paragraph and the signature block. Open Contracts, choose this wording, paste the real text over these lines, and save.

>>> END OF PLACEHOLDER <<<', '1. WHAT FUNDHUB DOES

Fundhub will review your credit files; identify potentially inaccurate, incomplete, or unverifiable negative items and personal information; prepare appropriate dispute materials; and carry out the dispute rounds in section 2. Fundhub will give you copies of the work and the responses, or access to them in your dashboard. Accurate, current information may remain; no score change, deletion, or particular result is promised.

2. THE ROUNDS AND HOW LONG THEY TAKE

Round one goes out the day you sign this agreement. Fundhub then carries out up to six dispute rounds. Each round waits on the answer to the one before it: the bureaus have 30 to 45 days to answer each round, and Fundhub sends the next round once they answer or their time to answer has passed. You watch every dispute and every response in your dashboard. Because each round waits 30 to 45 days on the bureaus, six rounds take about six to nine months. The real time depends on how fast the bureaus and creditors answer.

3. WHEN THE FEE IS CHARGED, AND YOUR REFUND

The fee in WHAT YOU PAY below is not charged or received until all services specified in this agreement have been fully performed. If Fundhub does not send round one on the day you sign, or does not carry out an agreed round on the schedule in section 2, you may request return of any fee paid. A bureau''s response or failure to remove an item is not itself a breach of this service guarantee.

4. YOUR RIGHT TO CANCEL

YOU MAY CANCEL THIS AGREEMENT FOR ANY REASON, WITHOUT PENALTY AND WITHOUT GIVING A REASON, BY NOTIFYING US IN WRITING AT ANY TIME BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER THE DATE YOU SIGNED IT. If you cancel within that period, we will refund everything you have paid within fifteen (15) days of receiving your notice.

To cancel, send written notice to support@tryfundhub.com, or by mail to Fundhub LLC, 218 Bostick Rd 64, Bowling Green, FL 33834. Your notice is effective on the date you send it. Keep a copy.

You do not have to give a reason and we will not ask you to complete any form or speak to anyone to exercise this right.

5. YOUR DISPUTE AUTHORITY AND YOUR RIGHTS

You may authorize Fundhub to prepare disputes about inaccurate negative items and personal information. Any submission on your behalf remains subject to required identity verification, your separate dispute authorization, truthful supporting facts, and any required signature from you. You may withdraw that authority. You keep the right to dispute directly with a bureau or furnisher and to contact a card issuer, lender, regulator, or other lawful channel.

WE ASK YOU TO CONTACT FUNDHUB FIRST ABOUT A PAYMENT OR SERVICE CONCERN SO WE CAN TRY TO RESOLVE IT. BY SIGNING, YOU AGREE TO ASK FUNDHUB FOR HELP FIRST WHEN PRACTICAL. THIS REQUEST DOES NOT DELAY OR WAIVE ANY DIRECT DISPUTE, CANCELLATION, BILLING-ERROR, OR COMPLAINT RIGHT.'),
       updated_at = now()
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND strpos(body, 'NOT THE REAL AGREEMENT TEXT') > 0;

DO $croa$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped credit file rights disclosure: no org fundhub';
    RETURN;
  END IF;
  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped credit file rights disclosure: no staff';
    RETURN;
  END IF;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'CREDIT-FILE-RIGHTS-DISCLOSURE',
    'Consumer Credit File Rights (send before the Credit Repair Agreement)',
    'authorization',
    'credit_file_rights_disclosure',
    E'Consumer Credit File Rights Under State and Federal Law\n\nDate: {{today}}\nName: {{contact.full_name}}\nEmail: {{contact.email}}\n\nFundhub LLC gives you this statement before you sign any credit repair agreement with it. Federal law (15 U.S.C. 1679c) requires it, word for word, as a document separate from the agreement. The statement follows.\n\nYou have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly. However, neither you nor any ''credit repair'' company or credit repair organization has the right to have accurate, current, and verifiable information removed from your credit report. The credit bureau must remove accurate, negative information from your report only if it is over 7 years old. Bankruptcy information can be reported for 10 years.\n\nYou have a right to obtain a copy of your credit report from a credit bureau. You may be charged a reasonable fee. There is no fee, however, if you have been turned down for credit, employment, insurance, or a rental dwelling because of information in your credit report within the preceding 60 days. The credit bureau must provide someone to help you interpret the information in your credit file. You are entitled to receive a free copy of your credit report if you are unemployed and intend to apply for employment in the next 60 days, if you are a recipient of public welfare assistance, or if you have reason to believe that there is inaccurate information in your credit report due to fraud.\n\nYou have a right to sue a credit repair organization that violates the Credit Repair Organization Act. This law prohibits deceptive practices by credit repair organizations.\n\nYou have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.\n\nCredit bureaus are required to follow reasonable procedures to ensure that the information they report is accurate. However, mistakes may occur.\n\nYou may, on your own, notify a credit bureau in writing that you dispute the accuracy of information in your credit file. The credit bureau must then reinvestigate and modify or remove inaccurate or incomplete information. The credit bureau may not charge any fee for this service. Any pertinent information and copies of all documents you have concerning an error should be given to the credit bureau.\n\nIf the credit bureau''s reinvestigation does not resolve the dispute to your satisfaction, you may send a brief statement to the credit bureau, to be kept in your file, explaining why you think the record is inaccurate. The credit bureau must include a summary of your statement about disputed information with any report it issues about you.\n\nThe Federal Trade Commission regulates credit bureaus and credit repair organizations. For more information contact:\n\nThe Public Reference Branch\nFederal Trade Commission\nWashington, D.C. 20580\n\nSIGNATURES\n\nFundhub LLC\n218 Bostick Rd 64, Bowling Green, FL 33834\nSigned by: an authorised signer of Fundhub LLC\nDate: {{today}}\n\n{{contact.full_name}}\n{{contact.email}}\nSigned by: ______________________________\nDate: ______________________________\n\nYou sign by typing your name and ticking the box on the signing page. Your typed name, the date and time you signed, and the exact wording above are saved together as the signed record, and you can ask us for a copy at any time.',
    '[]'::jsonb,
    true,
    'I received this statement before signing any credit repair agreement with Fundhub LLC. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;
END
$croa$;
