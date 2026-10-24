# Giovanni's banks — 2026-10-24

Prep only. Nothing in the app was changed. The bank list was not cut. No link was replaced. No logo was put in the app.

Photo: `ops/workflows/giovanni-banks-2026-10-24.jpg`. I read the photo. The list below matches it. One note is cut off. See questions.

Read of the live bank book: 2026-10-24, read-only. **1,106** bank rows. **1,057** have an Apply link. **661** have a logo file. All 1,106 are turned on. None are demo. One company.

## The short answer

- **13 of 18 lines** match a bank row. FNBO is on the list twice. Both lines use the same 3 rows.
- **4 lines have no row:** Intuit, Barclays, Wings, Langley.
- **TCM has no row of its own.** 17 other banks say TCM on the row.
- **9 links are wrong, missing, or dead.** Chase is dead. Citizens is dead. Elan is the wrong kind of page. Navy is a personal loan, not the business card. Intuit, Barclays, Wings, Langley, and TCM have no Apply link of their own.
- **3 more links should be cleaned** when he says go. Wells has extra tracking tags. Flagstar's old link jumps. FNBO's Nebraska link is the home page, not the card page.
- **Logos: 3 look right** (Chase, Bank of America, PNC). **The other 15 are missing or are not the official logo.**
- **Hide count: 1,073 rows.** Keep 33. Hide means turn them off. Do not delete them. Not done.

## The list, as Chris sent it

Nation Wide - Tier 1 Banks:

1. Chase - (Experian)
2. ELAN - (Transunion Mostly)
3. AMEX - (Experian or No Pull)
4. Wells Fargo - (Experian)
5. Truist - (Transunion)
6. Bank Of America - (Transunion)
7. Flagstar (FNBO Underwriting) - (Experian) (AZ, CA, CT, FL, IN, MI, NJ, NY, NC, OH, WI)
8. FNBO - First National Bank of Omaha (EX) (CO, IL, IA, KS, NE, SD, TX , WY) (1)
9. First Arkansas Bank & Trust (National)
10. Intuit (Experian) (Pre-approval)
11. Barclays - (Transunion)
12. Citizens - (Equifax)
13. FNBO - Experian
14. Wings Credit Union (EX)
15. Langley
16. Navy Federal

Recent Problem Banks:

- PNC Bank - (Experian) - Want Checking open for 45 days, if they don't put a certain amou...
- TCM Banks - (Pulls Experian) - Is Requiring 2 Years in Business

Photo notes: on line 8 there is a space before the comma in `TX , WY`, then `(1)`. The PNC note stops at `amou...`.

## Where bank links live today

| Place | Who sees it | What |
|---|---|---|
| `lenders` table | The book | Each row has `application_url` (the Apply link) and `logo_path` (the picture). |
| https://fundhub.ai/app/lenders.html | Staff | The full bank list. Picture and Apply link. |
| https://fundhub.ai/app/client-control-panel.html | Staff, for one client | The banks that match that client. Picture and Apply link. |
| Buyer portal, "Bank and Lender Match List" | The client | Code `bank-lender-match-list`. Built by `src/deliverables/lender-list.mjs` from the banks that match that one client. It is not all 1,106 banks. |
| https://fundhub.ai/app/money-banks.html | Client and staff | The plan for which bank to open. `api/money/banks.mjs` and `public/app/money-banks.js`. It is not the full Apply list. |
| Hourly check `beat-apply-links` | Morning report | Checks each Apply link. Saves the result in `pulse_bank_links`. |
| `gap-bank-links` | Morning report | A different check. It watches bank logins and store connections. It does not check these Apply links. |
| `docs/legacy-strong/lenders-legacy-strong.csv` | Old book | Where the list started. Loaded by `scripts/lenders-import-alec.mjs`. |
| `public/assets/lenders/` | The pictures | Logo files. The row points at a file like `/assets/lenders/chase.png`. If the row is empty, the screen shows `/assets/lenders/placeholder.svg`. No outside logo service. |

Book split: 862 online business cards (836 links), 189 in-branch business cards (166 links), 29 personal cards, 26 personal loans.

## The cut (not done)

If only these banks stay, **keep 33 rows and hide 1,073.**

Those 33 rows are the banks named below. They include 20 business-card rows and 13 personal cards or personal loans for Chase, Amex, Wells Fargo, Bank of America, and Navy Federal.

Recommend: set `active` to false on the other 1,073. Do not delete them.

Not in the 33, so they would be hidden too:

- 17 TCM partner banks (there is no row named TCM Bank).
- 3 Elan partner banks (Central Pacific, Hawaii National, Territorial). Elan's own row stays.
- 7 FNBO partner banks (AmTrust twice, Garden State, New York Community Bank, Ohio Savings, Pacific Premier twice). The 3 FNBO rows stay. Flagstar stays.

If Chris also wants the 13 personal rows hidden, keep 20 and hide 1,086.

If he wants the 3 PNC rows hidden too, keep 30 and hide 1,076. If he wants business cards only and no PNC, keep 17 and hide 1,089.

## Duplicates

- **FNBO is lines 8 and 13.** Three rows, not two banks. States in the book do not match line 8.
- **Flagstar is underwritten by FNBO.** The live Flagstar card page says the card is issued by First National Bank of Omaha. The Apply button goes to an FNBO page. That is a different bank from FNBO's own Evergreen card.
- **Elan and TCM** issue cards for other banks. The list names Elan and TCM themselves. The book mostly has the partner banks.

## Each bank

Status words: **same** means the saved link is the right page and it answered. **different** means a better official page exists. **dead** means the saved link does not open. **wrong** means it opens, but it is not the business-card apply. **missing** means there is no row, or no link.

### 1. Chase — Experian

| | |
|---|---|
| Book bureau | Business rows say Experian, Equifax, and TransUnion. Personal cards say Experian. |
| Book states | Business row is most states. A second row is Nebraska only. |
| Rows | `9f4d147d-d1c9-4603-b9e3-60cd2ad7c66c` Ink cards, in-branch. `d1951308-c2d2-4eb9-8890-6a4ad79a22fe` Chase Bank, Nebraska. Plus 3 personal cards and 1 personal loan. |
| Saved Apply link | `https://www.chase.com/business/credit-cards` — **dead (404)** on both business rows. |
| Right link | `https://creditcards.chase.com/business-credit-cards` — **200**. |
| Saved logo | `/assets/lenders/chase.png` and `chase-bank.png`. Both are the blue Chase octagon. **Looks right.** |
| Official logo | `https://creditcards.chase.com/content/dam/jpmc-marketplace/site-assets/logos/chasebank-logo-text-bluebg_2025.svg` |
| Verdict | Link **dead**. Logo **matches**. |

### 2. ELAN — TransUnion mostly

| | |
|---|---|
| Book bureau | TransUnion. That matches "mostly TransUnion." |
| Book states | Almost every state. Not AK, HI, or TX. |
| Row | `add28c99-6f94-4559-af91-58b99e62f535` Elan Financial. Online business card. On. |
| Saved Apply link | `https://www.elanfinancialservices.com/credit-card/index.html` — **200**, but it is a page for banks that want Elan to run their card program. A person cannot apply there. |
| Right link | **No public apply page.** Elan says people apply at the partner bank. |
| Saved logo | `/assets/lenders/elan-financial.png`. Tiny file. Not the wordmark. |
| Official logo | `https://www.elanfinancialservices.com/etc.clientlibs/ecm-global/clientlibs/clientlib-resources/resources/images/svg/logo_elan_cc.svg` |
| Verdict | Link **wrong page**. Logo **not the official wordmark**. |

### 3. AMEX — Experian or no pull

| | |
|---|---|
| Book bureau | Experian on the business row. Matches. |
| Book states | All states. |
| Row | `97f2ce2d-d996-46ca-80eb-ea2432604aec` Business Gold / Blue Business Cash / Blue Business Plus. Plus 4 personal cards. |
| Saved Apply link | `https://www.americanexpress.com/us/credit-cards/business/` — **200**. |
| Right link | `https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/` — **200**. This is the card list. The saved link is the parent page. Both are official. |
| Saved logo | `/assets/lenders/american-express.png`. Tiny blue box. Not the full wordmark. |
| Official logo | `https://www.aexp-static.com/cdaas/one/statics/axp-static-assets/1.8.0/package/dist/img/logos/dls-logo-bluebox-solid.svg` |
| Verdict | Link **same family, live**. Logo **not the clean official file**. |

### 4. Wells Fargo — Experian

| | |
|---|---|
| Book bureau | Experian, Equifax, and TransUnion. The list says Experian only. |
| Book states | Online row is many states. In-branch row is NE, SD, TX. |
| Rows | `764d53ed-d4c8-4cc0-9224-3060d5852acf` online. `612158b4-a71c-4b69-b286-b9930d112ced` in-branch. Plus 1 personal card and 1 personal loan. |
| Saved Apply link | Signify card URL with `utm_medium` and `utm_source` tags. The page **answers 200**. |
| Right link | `https://www.wellsfargo.com/biz/business-credit/credit-cards/` — **200**. Wells then sends you to the Signify card and adds its own tags. |
| Saved logo | `/assets/lenders/wells-fargo.png`. A red "WF" box. **Not** the Wells Fargo wordmark. |
| Official logo | On `https://www.wellsfargo.com/`. A clean file was not saved (the site did not hand one over from this computer). |
| Verdict | Link **different** (extra tracking, but live). Logo **wrong**. |

### 5. Truist — TransUnion

| | |
|---|---|
| Book bureau | Equifax. The list says TransUnion. These do not match. |
| Book states | Online: many Southeast and mid-Atlantic states. In-branch: Texas only. |
| Rows | `2cd3b84c-1a49-4034-9031-1d7bd8e83250` online. `bb1e8cc2-b524-4b50-8d2c-58ee1673b9a4` Texas, in-branch. |
| Saved Apply link | `https://www.truist.com/small-business/credit-cards/business-card` — **200**. |
| Right link | `https://www.truist.com/small-business/credit-cards` — **200**. The Apply button goes to `https://businesscreditcard.digitalcommerce.truist.com/product/SBC` (still Truist). |
| Saved logo | `/assets/lenders/truist.png`. Tiny mark. Not the Truist wordmark. |
| Official logo | `https://static.truist.com/content/dam/global-images/truist-logo.svg` |
| Verdict | Link **live**. Logo **not the official wordmark**. Bureau does not match the list. |

### 6. Bank of America — TransUnion

| | |
|---|---|
| Book bureau | Experian, Equifax, and TransUnion. The list says TransUnion only. |
| Book states | Online row is most states. In-branch row is CA, MO, NE, RI, SD, TX. |
| Rows | `d9bd0743-5439-4041-bd11-18925ac8ecf3` online. `f16c8dd9-d700-4f68-9d87-e01d4ffdb8de` in-branch. Plus 1 personal card and 1 personal loan. |
| Saved Apply link | `https://business.bankofamerica.com/en/credit-cards` — HEAD got 403, GET got **200**. |
| Right link | Same page. **same**. The Apply buttons add campaign codes. Do not save those. |
| Saved logo | `/assets/lenders/bank-of-america.png`. The flag. **Looks right.** |
| Official logo | `https://www.bankofamerica.com/content/images/ContextualSiteGraphics/Logos/en_US/logos/colored_flagscape-v2.png` |
| Verdict | Link **same, live**. Logo **matches**. |

### 7. Flagstar (FNBO underwriting) — Experian — AZ, CA, CT, FL, IN, MI, NJ, NY, NC, OH, WI

| | |
|---|---|
| Book bureau | One row says Equifax. One says Experian and Equifax. The list says Experian. |
| Book states | Old row is Michigan only. Other row says all states. The list is 12 states. |
| Rows | `94de366d-8991-42e2-96a1-f1315e98cd98` Flagstar Bank, in-branch, Michigan. `628ac256-2f4e-434a-9d6f-8f3ca8278eb0` Flagstar Bank, National Association, online. |
| Saved Apply link | Old row: `https://www.flagstar.com/business/business-credit-cards.html` jumps to `https://www.flagstar.com/small-business/bank/credit-cards.html` (**200**). That page's Apply button goes to the FNBO link below. New row: `https://www.card.fnbo.com/mpp/fi/flagstar/business/web-visa` — **200**. |
| Right link | `https://www.card.fnbo.com/mpp/fi/flagstar/business/web-visa`. The Flagstar page says the card is issued by FNBO. |
| Saved logo | Old row: `/assets/lenders/flagstar-bank.png` (an old star). New row: **no logo**. |
| Official logo | On the FNBO apply page: `https://s7d1.scene7.com/is/content/fnnistage/flagstar-logo` |
| Verdict | The FNBO link is **right**. The old link is **different** (it jumps). One logo is the old star. One logo is **missing**. States do not match the list. |

### 8. FNBO — First National Bank of Omaha — Experian — CO, IL, IA, KS, NE, SD, TX, WY — (1)

| | |
|---|---|
| Book bureau | Experian. Matches. |
| Book states | Evergreen row: CO, IA, IL, KS, OK, SD, WA. Texas is its own row. Nebraska is a third row. The list also has WY. The book has OK and WA, which the list does not. |
| Rows | `706b1d71-e6d9-4cc6-bf53-f9bc385df5b4` FNBO Evergreen. `96c81cce-c429-4b60-9865-afb8d01c4a36` FNBO Evergreen, Texas. `da4b5a4e-30c4-4048-b3d2-a4c87dcab64e` First National Bank of Omaha, Nebraska. |
| Saved Apply link | Evergreen rows: `https://www.fnbo.com/small-business/credit-cards/evergreen` — **200**. Nebraska row: `https://www.fnbo.com/small-business` — **200**, but it is the small-business home, not the card page. |
| Right link | Card list: `https://www.fnbo.com/small-business/credit-cards/` — **200**. Evergreen card: the saved Evergreen link. |
| Saved logo | `/assets/lenders/fnbo.png` and `fnbo-evergreen.png`. Green circle. Not the FNBO wordmark. |
| Official logo | `https://s7d1.scene7.com/is/content/fnnistage/fnbo-white` (white, for a dark header, from FNBO's own page). |
| Verdict | Evergreen link **same, live**. Nebraska link **different**. Logo **not the wordmark**. States do not match. The `(1)` on the photo is not explained. |

### 9. First Arkansas Bank & Trust — National

| | |
|---|---|
| Book name | `FAB&T`. That is this bank. |
| Book bureau | Equifax. The list does not name a bureau. |
| Book states | Arkansas only. The list says National. The bank's own report says the credit-card office lends nationwide. |
| Row | `4b881071-259c-462f-a25c-91d645766ed2`. Online business card. On. |
| Saved Apply link | `https://www.fabandt.bank/business/credit-cards` — **200**. **same**. |
| Apply button on that page | `https://app.thecardservicescenter.com/Selection/Selection?finumber=3002`. That is the form the bank's own button opens. It is not an affiliate. Prefer the bank page as the saved link. |
| Saved logo | `/assets/lenders/fab-and-t.png`. Tiny. Not their wordmark. |
| Official logo | `https://www.fabandt.bank/assets/img/fabandt-logo.svg` |
| Verdict | Link **same, live**. Logo **not the official wordmark**. States in the book say Arkansas, not National. |

### 10. Intuit — Experian — pre-approval

| | |
|---|---|
| Book | **No row.** Not under Intuit, QuickBooks, or Capital. |
| What the official site is | Intuit Business Credit Card. Product page `https://www.intuit.com/credit-card/` answered **200** once, then **429** when asked again (too many asks). Apply start `https://card.intuit.com/apply` answered **200**. No form was sent. |
| Issuer | WebBank. Intuit's help page says the check is soft and does not hit the personal score. The list says Experian pre-approval. Those may be the same idea. Not confirmed. |
| Logo | **Missing.** No review file saved. |
| Verdict | Link **missing**. Logo **missing**. |

### 11. Barclays — TransUnion

| | |
|---|---|
| Book | **No row.** |
| Right link | `https://cards.barclaycardus.com/banking/Business/` — **200**. It jumps to the business-card list and adds a `referrerid`. There is no single Barclays business card. The list is co-brand cards (JetBlue, GM, Wyndham, and others). |
| Official logo | `https://cards.barclaycardus.com/content/dam/bcuspublic/rebrand/logos/barclays_155x34.svg` |
| Verdict | Link **missing**. Logo **missing**. |

### 12. Citizens — Equifax

| | |
|---|---|
| Book bureau | Equifax. Matches. |
| Book states | AR, CT, DE, FL, MA, MD, MI, NH, NJ, NY, OH, OK, PA, RI, VA, VT. |
| Live page states | CT, DE, FL, MD, MA, MI, NH, NJ, NY, OH, PA, RI, VT, VA, and Washington, D.C. The book has Arkansas and Oklahoma. The live page does not. |
| Row | `c5cc2bbc-152a-4a89-8050-8a78b443b4a9` Citizens Bank. Online business card. On. |
| Saved Apply link | `https://www.citizensbank.com/small-business/credit-cards.aspx` — **dead (404)**. |
| Right link | `https://www.citizensbank.com/small-business/business-credit-cards/overview.page` — **200**. |
| Saved logo | `/assets/lenders/citizens-bank.png`. A small green mark. Not the full wordmark. |
| Official logo | `https://www.citizensbank.com/assets/CB_resources/images/cbds-logos/logo-citizens__horz-green.svg` |
| Verdict | Link **dead**. Logo **not the full wordmark**. |

### 13. FNBO — Experian

Same three rows as line 8. There is no second national FNBO row. The Evergreen link is live and pulls Experian in the book. See line 8.

Verdict: **not a separate bank.** Link for this line is the Evergreen URL, which is **live**.

### 14. Wings Credit Union — Experian

| | |
|---|---|
| Book | **No row** for Wings. |
| Right page | `https://www.ent.com/business/borrow/ent-business-rewards-visa-credit-card/` — **200**. The page says Wings, previously Ent. It says apply by phone at 800-525-9623 or in a branch. You must be a member. |
| Other page | `https://www.wingscu.com/business` — **200**, but that is business accounts, not the card. Accounts open in a branch. The business must be in an eligible county, or half the owners must already qualify. |
| Official logo | `https://www.ent.com/globalassets/logos/wingslogosvg.svg` |
| Verdict | Link **missing**. Logo **missing**. No online apply. |

### 15. Langley

| | |
|---|---|
| Book | **No row.** |
| Best match | Langley Federal Credit Union. Page `https://www.langleyfcu.org/business-credit-cards` — **200**. The menu calls it Platinum Visa Business. I did not see an Apply button for the card. Join is `https://www.langleyfcu.org/apply`. Membership is required. |
| Card terms PDF | `https://www.langleyfcu.org/doc/visa-business_platinum.pdf` |
| Logo | The site draws the logo as an icon, not a file I could save. |
| Verdict | Link **missing**. Logo **missing**. Confirm this is the Langley he means. |

### 16. Navy Federal

| | |
|---|---|
| Book bureau | TransUnion. The list does not name one. |
| Row | `757f9a3c-d5ca-4ec1-bbc0-5774148235d7`. **Personal loan**, not a business card. All states. On. |
| Saved Apply link | `https://www.navyfederal.org/loans-cards/personal-loans.html` — **200**, but it is the personal loan. **wrong product**. |
| Right link | `https://www.navyfederal.org/services/business/credit-cards.html` — **200**. GO BIZ Rewards. Every owner must already be a Navy Federal member. |
| Saved logo | `/assets/lenders/navy-federal-credit-union.png`. It looks like a globe, not the Navy Federal name. **Wrong.** |
| Official logo | `https://www.navyfederal.org/assets/images/nfcu-logo-bluegrad-800.jpg` (named on their card page). The file did not download from this computer. |
| Verdict | Link **wrong product**. Logo **wrong**. |

### 17. PNC — Experian — problem bank

| | |
|---|---|
| Book bureau | Experian and Equifax. The list says Experian. |
| Book states | Online: AL, FL, IA, IL, IN, KY, MD, MI, NC, NJ, OH, PA, VA. In-branch: DE, GA, MO. A third row is California, balance-transfer only. |
| Rows | `3ed7b3e0-32d2-4008-b373-b571143f119c` online. `e1116896-b321-4970-a04c-22ca5b2eb7a3` in-branch. `6cd24ce2-1505-4f12-904a-0b9339e8ccb2` California. |
| Saved Apply link | `https://www.pnc.com/en/small-business/borrowing/business-credit-cards.html`. A direct check from this computer timed out. A page fetch returned the live business-card page. **Treat as live.** |
| Right link | That same page. Cash Rewards can be started online. The other card says visit a branch. |
| Saved logo | `/assets/lenders/pnc-bank.png`. The orange PNC triangle. **Looks right.** |
| Official logo | The live page. A separate wordmark file was not saved. |
| The cut-off rule | The photo stops at "if they don't put a certain amou..." The full rule is not in the book. |
| Verdict | Link **same, live**. Logo **matches**. Keep or hide is a question. |

### 18. TCM — pulls Experian — 2 years in business — problem bank

| | |
|---|---|
| Book | **No row named TCM Bank.** |
| What TCM is | TCM Bank issues cards for community banks. `https://www.tcmbank.com/` — **200**. That site is for banks, not for a person to apply. |
| Partner rows | 17 rows have TCM in the name or the product. 14 have a link. 3 do not (BSNB, Eagle Bank, New Field National Bank). Bureaus are mixed. Only some say Experian. |
| Verdict | Link **missing** for TCM itself. Logo **missing**. The 2-year rule is not on the public TCM page. It is only in the photo. |

Review copies of official logos (not in the app) are in `ops/workflows/giovanni-banks-2026-10-24-logos/`. Wells, Navy, and PNC files are not in that folder. Intuit has no file. Langley's logo is an icon on their site, not a file.

## Questions for Chris

1. **Elan.** There is no public apply page. Which partner bank link should we use?
2. **Intuit.** Is this the Intuit Business Credit Card (soft check, issued by WebBank), or QuickBooks Capital?
3. **Barclays.** Which business card? There are several.
4. **Langley.** Is this Langley Federal Credit Union?
5. **Wings.** The business card has no online apply. Phone or branch, and you must be a member. Save that page anyway?
6. **Navy Federal.** The only row is a personal loan. Add the business card, or change this row? Owners must already be members.
7. **First Arkansas.** The book says Arkansas and Equifax. You said National, and no bureau. Which is right?
8. **Flagstar states.** The list is 12 states. The FNBO Flagstar row says all states. Show it only in those 12 states?
9. **FNBO states.** The list is CO, IL, IA, KS, NE, SD, TX, WY. The book splits that across 3 rows and also has OK and WA. It does not have WY on those rows. What does the `(1)` mean? Is line 13 the same card as line 8?
10. **Truist and Bank of America bureaus.** The book does not say TransUnion only. Truist says Equifax. Bank of America says all three. Change the book, or leave it?
11. **Chase and Wells bureaus.** The list says Experian. The business rows say more than one bureau. Leave them?
12. **PNC.** The photo cuts off at "if they don't put a certain amou..." What is the full rule?
13. **PNC and TCM.** Keep them on the list with a warning, or hide them?
14. **TCM.** Which partner link, if any? Hide the other 17?
15. **Personal cards.** 13 of the 33 keep rows are personal cards or personal loans. Hide those too, or keep them because the bank is on the list?
16. **FNBO and Elan partners.** Hide the other banks that only say "FNBO" or "Elan" in the name? The plan above hides them.

## Ready to apply when Chris says go

Do not run this until he says go. Weekend rule: nothing in the app changes until then.

**Hide, do not delete.** Set `active` to false on every `lenders` row whose id is not in the keep list. That is 1,073 rows. Leave the 33 on.

**Keep these rows** (all are on today):

| Id | Name | Kind |
|---|---|---|
| `9f4d147d-d1c9-4603-b9e3-60cd2ad7c66c` | Chase Ink | Business |
| `d1951308-c2d2-4eb9-8890-6a4ad79a22fe` | Chase Bank | Business |
| `6827726a-26cd-40b4-862d-d9cf115717cd` | Chase Freedom | Personal card |
| `3ebb004f-f77b-4daf-8300-437c0aed9b9f` | Chase Sapphire Preferred | Personal card |
| `2ad3f706-b12e-4e14-bc8e-43b394f447ac` | Chase Sapphire Reserve | Personal card |
| `5bac268b-d169-4005-be85-f12f7cd319fc` | Chase | Personal loan |
| `add28c99-6f94-4559-af91-58b99e62f535` | Elan Financial | Business |
| `97f2ce2d-d996-46ca-80eb-ea2432604aec` | American Express business | Business |
| `9f89e730-90c9-4889-a651-48ad856e9be2` | Amex Blue Cash | Personal card |
| `25fec8c4-3242-4fb8-977e-9fba6eb8c7ce` | Amex Delta Gold | Personal card |
| `865099c7-4be2-4978-97b1-9b29c5752788` | Amex Hilton | Personal card |
| `b89aff2a-44fa-4cc7-b155-c44c1f0f234a` | Amex Marriott | Personal card |
| `764d53ed-d4c8-4cc0-9224-3060d5852acf` | Wells Fargo | Business |
| `612158b4-a71c-4b69-b286-b9930d112ced` | Wells Fargo | Business |
| `09026649-39fe-4393-9823-3f15a4928be6` | Wells Fargo Reflect | Personal card |
| `130473d0-7a63-4696-ba67-5460f4726a1c` | Wells Fargo | Personal loan |
| `2cd3b84c-1a49-4034-9031-1d7bd8e83250` | Truist | Business |
| `bb1e8cc2-b524-4b50-8d2c-58ee1673b9a4` | Truist | Business |
| `d9bd0743-5439-4041-bd11-18925ac8ecf3` | Bank of America | Business |
| `f16c8dd9-d700-4f68-9d87-e01d4ffdb8de` | Bank of America | Business |
| `e1b3d656-dc46-4f06-beba-8e12b6f97205` | Bank of America cash card | Personal card |
| `c36bffde-dfe0-4547-93f9-52457c95d62e` | Bank of America | Personal loan |
| `94de366d-8991-42e2-96a1-f1315e98cd98` | Flagstar Bank | Business |
| `628ac256-2f4e-434a-9d6f-8f3ca8278eb0` | Flagstar Bank, National Association | Business |
| `706b1d71-e6d9-4cc6-bf53-f9bc385df5b4` | FNBO Evergreen | Business |
| `96c81cce-c429-4b60-9865-afb8d01c4a36` | FNBO Evergreen, Texas | Business |
| `da4b5a4e-30c4-4048-b3d2-a4c87dcab64e` | First National Bank of Omaha | Business |
| `4b881071-259c-462f-a25c-91d645766ed2` | FAB&T | Business |
| `c5cc2bbc-152a-4a89-8050-8a78b443b4a9` | Citizens Bank | Business |
| `757f9a3c-d5ca-4ec1-bbc0-5774148235d7` | Navy Federal | Personal loan |
| `3ed7b3e0-32d2-4008-b373-b571143f119c` | PNC Bank | Business |
| `e1116896-b321-4970-a04c-22ca5b2eb7a3` | PNC Bank | Business |
| `6cd24ce2-1505-4f12-904a-0b9339e8ccb2` | PNC Bank, California | Business |

**Links to replace** (only these, and only after he says go):

| Row | Put this link |
|---|---|
| Both Chase business rows | `https://creditcards.chase.com/business-credit-cards` |
| Citizens `c5cc2bbc-152a-4a89-8050-8a78b443b4a9` | `https://www.citizensbank.com/small-business/business-credit-cards/overview.page` |
| Both Wells business rows | `https://www.wellsfargo.com/biz/business-credit/credit-cards/` |
| Flagstar `94de366d-8991-42e2-96a1-f1315e98cd98` | `https://www.card.fnbo.com/mpp/fi/flagstar/business/web-visa` |
| FNBO Nebraska `da4b5a4e-30c4-4048-b3d2-a4c87dcab64e` | `https://www.fnbo.com/small-business/credit-cards/` |

Do not change Elan, Navy, Intuit, Barclays, Wings, Langley, or TCM until he answers the questions. Do not change states or bureaus until he answers.

**Logos to replace** when he says go. Copy the review file into `public/assets/lenders/` and point `logo_path` at it. Do not do that in this prep.

- Elan, Amex, Truist, Wells, FNBO, FAB&T, Citizens, Flagstar (both rows), Navy.
- New rows, if he adds them: Intuit, Barclays, Wings, Langley, TCM.
- Leave Chase, Bank of America, and PNC logos. They already look right.

**New rows, only if he says yes:** Intuit Business Credit Card, one Barclays card, Wings, Langley Federal, Navy Federal business card, and one TCM partner. No row exists for those today.
