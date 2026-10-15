# Capital Blueprint and customer dashboard: launch board

Launch night: Thursday 2026-10-15. Board written 2026-10-15 by the oversight agent.
Chris asked for the Capital Blueprint offer and the customer dashboard to be 100% right.

## The verdict

**Not ready yet. It can be ready tonight with a short list of exceptions written down.**

The money road works. A payment turns on the files, the checklist, the helper (CSM) and 12 months of FinanceOS.

But today a $5,000 buyer would hit these problems:

1. The paper they sign says a different thing than what the call sold them.
2. Nobody sends them a sign-in link after they pay.
3. FinanceOS may tell them to pay a $497 setup fee they already paid for. **Fixed on a branch.**
4. Some buyers could get a fake $5,000 bill from an old do-it-yourself letters rule. **Fixed on a branch.**
5. Every text fails, because the Twilio account is off.
6. The 5-minute site alarm only texts, so Chris would not hear about a break. **Fixed on a branch.**

Agents fixed 9 bugs tonight. Each fix has a test that goes red when the bug comes back. The oversight agent checked all 9 again by hand.

The rest are calls only Chris can make. They are listed below, each with a safe default.

## Launch blockers

What the status words mean:

- **Fixed on branch** means the code fix is done and tested. It is not live until it ships.
- **Needs Chris** means only Chris can make this call.
- **Needs data** means live saved records must be read or fixed first.
- **Needs copy approval** means the words a customer sees must change, so Chris sees a marked draft first.
- **Open** means it is a code job that nobody has started.

### Must fix before the first sale (P0)

| # | What is wrong, in plain words | Status |
|---|---|---|
| R01 | The signed agreement says "one written plan, no subscription, nothing said on the call counts." The call sells FinanceOS, a helper, a monthly fee and a guarantee. | Needs Chris |
| R02 | After paying $5,000, the buyer gets no automatic sign-in link, receipt or welcome. | Needs Chris (depends on R04) |
| R03 | An old rule thinks the Blueprint is the do-it-yourself letters product. Some buyers get a fake $5,000 bill and a "letters ready" email. | **Fixed on branch lp/r03-ds-02.** Left over: a payment made with no link of ours still matches the old rule. Old fake bills already saved need Chris. |
| R04 | The email that sends the agreement may be missing on the live site. The sign-in email may be missing too. | Needs data and needs Chris (he put those emails on hold) |
| R05 | The Twilio account is off. Every promised text goes nowhere. | Needs Chris |
| R06 | The 5-minute site alarm only texts through Twilio. With Twilio off, Chris hears nothing. | **Fixed on branch lp/r06-instant-watch-email.** Now it also emails. The email only arrives if the alert email settings are set on the live site, the same ones the morning report uses. |
| R07 | A Blueprint buyer who already has FinanceOS is told to pay the $497 setup fee. | **Fixed on branch lp/r07-fos-01.** No Pay button, and a second payment is refused. Left over: the step still reads "Pay setup fee ($497.00)" with "Done", and the price card still shows $497. Needs copy approval. |
| R08 | The call says "a new soft pull every 30 days." The code does one practice pull a year, with no real data. | Needs Chris (real pulls cost money). The two code parts are R18 and R19, both fixed. |
| R09 | Ad scripts that are ready to film say GUARANTEE and promise things the product does not do. | Needs copy approval |
| R10 | FinanceOS is sold as "watches your money every day", but bank linking runs in test mode and shows fake test banks. | Needs Chris |
| R11 | The first card on the dashboard tells a paid buyer "Your advisor is working your file" and shows 8 funding steps that never move. | Needs copy approval |
| R12 | Old reds on the heartbeat. One paying client has been locked out for 8 days. 7 documents will not open. 1 signed contract was not saved. | Needs data (read live first; any message to the client needs Chris) |

### Should fix this week (P1)

| # | What is wrong, in plain words | Status |
|---|---|---|
| R13 | The "Send agreement + pay link" button sends only the pay link. The call screen says the agreement was sent even when no email went out. | Needs Chris |
| R14 | Nobody has ever seen a real Blueprint payment come in. If it looks different, the buyer pays and nothing happens. | Needs Chris (one $1 test) |
| R15 | The helper picker can pick a demo staff account that nobody reads. | **Fix held back.** Branch lp/r15-csm-picker-no-demo is correct and tested. But it fixes only half: with no real helper on staff, buyers get no helper and nobody is told. Ship it together with a real helper account (Chris) and a check that goes red when a buyer has no helper. |
| R16 | The $147/$297 roadmap buyer and the $5,000 buyer both see a "Capital Blueprint" tile as owned. The call closes into the old letters wrap-up. | Needs Chris |
| R17 | The owned Blueprint tile shows 5 "Coming soon" lessons and says "Pricing is set on your call." | Needs Chris |
| R18 | A practice credit pull can wipe saved credit scores to blank. It can also hide the real report from the letter pack. | **Fixed on branch lp/r18-cb-11.** |
| R19 | FinanceOS setup counts a practice pull as done. The Credit tab says "No credit pull yet." | **Fixed on branch lp/r19-fos-02.** |
| R20 | The Payments tab shows "147.00succeeded", with no dollar sign and no space. | **Fixed on branch lp/r20-cp-02-payments-usd.** Now "$147.00 succeeded". Left over: the product name ("Consulting Services Assessment") and the word "succeeded" need copy approval. |
| R21 | While the page loads, or when a read fails, a paid buyer is told "Nothing is missing" and offered the $32 add-on. | Needs copy approval |
| R22 | A client could sign the dispute form even when the legal words never showed up. | **Fixed on branch lp/r22-cp-07.** They cannot sign until the words are on screen, and the server refuses a signature with no words. |
| R23 | The upload button offers iPhone photo files (.heic) the server will not take. Every failure only says "Try again." | **Fixed on branch lp/r23-cp06-upload-heic.** Now it says why the file was refused. Left over: the progress page has the same upload problem. |
| R24 | FinanceOS "Cards used" counts overpaid cards as minus, so it can show 20% when the truth is 45%. | **Fixed on branch lp/r24-fos-04.** |
| R25 | FinanceOS Overview charges for empty account boxes that other tabs call free. | Open (small code fix, safe; no agent took it tonight) |
| R26 | No check watches that a Blueprint buyer got FinanceOS, the right files, a signed agreement or the letter pack. | Open (new heartbeat checks) |
| R27 | Some timed jobs say "ok" even when every client in the run had an error. | Open (small code fix) |
| R28 | The Blueprint chain is checked only at 6 a.m. Old reds can hide new ones. | Open (too big for tonight) |
| R29 | The closer is not told a buyer is ready until the business setup steps are done, even for personal-credit buyers. | Needs Chris |
| R30 | Price is "$5,000 to $10,000" in the offer doc and ads, but $5,000 flat in the catalog, the call slides and the agreement. | Needs Chris |
| R31 | Public pages say "you don't pay unless funded." The apply.fundhub.ai home page is a template with fake reviews. There are 3 different refund windows. | Needs copy approval and needs Chris |
| R32 | The call promises a credit partner checklist that nothing creates. | Needs Chris |
| R33 | The client offer doc link points to a private doc. | Needs Chris |
| R34 | The "your package is being built" email goes out when the call is logged, not when the buyer pays. | Needs Chris |
| R35 | Every press of the pay link button makes a new live $5,000 checkout. | Needs Chris |
| R36 | "FundHub" is spelled wrong on the home-screen icon, the offline page and push titles. | Needs copy approval |
| R37 | "$X" price placeholders and "another round" wording show on money screens. | Needs copy approval and needs Chris (price) |
| R38 | Heartbeat blind spots: the money helper runs only on the Mac, nothing loads the dashboard in a real browser, and 220 controls are not proved yet. | Open (big) |

### Polish (P2)

| # | What is wrong | Status |
|---|---|---|
| R39 | Small download button, upload breaks if a saved login value is missing, iPhone toolbar covers the bottom. | Open (small code fix) |
| R40 | Money screens use the wrong time zone, so a "Late" badge shows in the evening. A price of 0 is allowed. | Open (small code fix) |
| R41 | The signed-agreement task has no plain name for staff. | Open (small code fix) |
| R42 | Smaller polish, access and doc items. | Mixed. None of them blocks the first sale. |

## Decisions only Chris can make

Each one has a safe default. Saying "use the defaults" makes all nine calls.

1. **Agreement vs. what we sell.** Default: keep the agreement for now. Take "Monthly member fee", "every 30 days" and "watches your money every day" off the call slides. Take GUARANTEE out of the ads. Write a new agreement next week.
2. **Monthly soft pull: real (costs money each time) or practice.** Default: keep practice. Change the slide line so it is true.
3. **FinanceOS and "Connect a bank" while bank linking is in test mode.** Default: hide the FinanceOS card, the side offer and "Connect a bank" for launch. Keep "Add an account."
4. **Lift the hold on the agreement email and the sign-in email.** Send the sign-in email once when a Blueprint is paid. Default: bring back those two emails with their old approved words.
5. **Twilio.** Default: fund it and turn it back on. Until it works, closers say "email", not "text."
6. **One real $1 test payment through a Blueprint link.** Default: yes, tomorrow morning. Then agents read the saved records without changing them.
7. **Who is the real helper (CSM).** Default: make one real staff account the helper before the first sale. Then ship R15.
8. **The "Send agreement + pay link" button.** Default for launch: closers press "Send contract" first, then the pay button. Rename the button next week.
9. **"Coming soon" lessons on the Blueprint tile.** Default: hide them and drop "mini course" from the tile until the videos exist.

Also waiting on Chris, not blocking tonight: the wording for the FinanceOS setup step and price card (R07), the product name and "Paid" word on the Payments tab (R20), and the old fake $5,000 letter bills already saved (R03).

## What was checked and is OK

- All 26 public pages answered. Every link on the home, roadmap, thank-you and book-call pages works. The health check says the site and database are up, with no waiting database changes.
- The $32 soft pull is the same price everywhere.
- The Blueprint is $5,000 in the catalog, the agreement and the call slides. The slides say "Financing available."
- A Blueprint payment turns on the right files, the 3 dispute steps, a helper (when a real one exists), a welcome-kit task and 12 months of FinanceOS.
- The payment door is wired, is checked every minute, and is watched every hour. A Blueprint is not mixed up with the letters pack when it was paid through our own link.
- The reminder ladder matches the offer doc. Texts to clients wait for 8 a.m. to 8 p.m. in their own time zone.
- The call slides say there is no promise of scores, removals, approvals or funding amounts.
- The live dashboard page is exactly the same as the code in the repo.
- Every dashboard data door refuses visitors who are not signed in. A signed-out visitor is sent to the login page.
- Each client sees only their own file.
- The offline helper in the dashboard never saves money data.
- No sideways scrolling on a phone (390 wide) or a desktop, on the dashboard or on all 16 FinanceOS tabs.
- Dashboard tests: 56 of 56 browser checks pass on fake answers. FinanceOS: 83 of 83 browser checks and 2,183 unit tests pass on fake answers. These test the buttons and wiring with fake data. They do not prove live data.
- The 9 fix branches, checked again by the oversight agent: each test passes with the fix and goes red when the old code is put back. Stacked together on the main line, they apply with no clashes and pass 266 of 266 tests.

## What could not be checked, and why

- **Live saved data.** By rule, no agent read or wrote the live database tonight. Still unknown: whether the Blueprint agreement and the emails exist live, whether a real helper exists, and which old reds are still red.
- **A real signed-in buyer.** Agents may not log in or buy. Every dashboard view was drawn from fake answers shaped like the real ones.
- **A real payment.** No real Blueprint payment has ever been seen. See decision 6.
- **Twilio today.** We did not call Twilio. The "off" status comes from the 10-14 morning report.
- **Whether the new alarm email arrives.** That needs the live alert email settings. The first real test is the next alarm or the 6 a.m. report.
- **A real iPhone.** No device test of photo uploads, push alerts, add-to-home-screen or the bottom toolbar.
- **The offers PDF.** No PDF tool was installed. Only the written copy was read.
- **Ad landing links.** The Blueprint ads are not filmed yet and have no link.
- **Whole-repo checks.** The full code style check was finished on some fix branches but not all, because the Mac was overloaded. The full heartbeat build check was not run for these fixes. No browser test was run for the stacked fixes except the one upload test (R23).

## The order to ship the fixes

Each branch is one commit on top of the current main line. Put them in this order. Then ship once at the end, because one push to main is one deploy.

1. lp/r03-ds-02 (fake $5,000 letters bill)
2. lp/r06-instant-watch-email (5-minute alarm now emails)
3. lp/r07-fos-01 (no $497 fee for Blueprint buyers)
4. lp/r19-fos-02 (practice pull not counted as done; same file as step 3, so it goes right after)
5. lp/r18-cb-11 (practice pull cannot wipe scores)
6. lp/r24-fos-04 (Cards used percent)
7. lp/r20-cp-02-payments-usd (dollar sign on Payments)
8. lp/r22-cp-07 (no signature without the legal words)
9. lp/r23-cp06-upload-heic (upload says why it failed)

Steps 7, 8 and 9 all change the dashboard page. They were stacked in this order and did not clash.

Held back: lp/r15-csm-picker-no-demo. Ship it after Chris names a real helper (decision 7).

Two notes for whoever ships:

- Put the fixes on GitHub's main line, not on this Mac's own copy of main. That copy has drifted from GitHub: 6 commits ahead and 5 behind.
- The script that started the fixers made broken branch names. So each fixer picked a real name, and the names above are the true ones.

## Shipped at 01:43 Arizona, 2026-10-15 (build 14c11a84)

Nine launch fixes are live: R03, R06, R07, R18, R19, R20, R22, R23, R24. Related tests 266 of 266, portal browser
specs 18 of 18, type check clean. Held back: R15 (the CSM picker; needs a real CSM named first).

## Leftover card (not part of this launch pass, not fixed)

`e2e/teleprompter-take-flow.spec.mjs:1419` "recording still paints and rolls on a browser without video-frame
callbacks" fails on untouched main as well as on the launch build. Found while testing; nobody asked for it.
