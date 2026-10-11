# Fundhub Offers (2026-10-10)

Client-facing offer breakdown. Live doc: https://claude.ai/code/artifact/d5e6442b-0944-46be-84b1-32dc566f4e33
This file is the repo copy of that doc. PDF with the five diagrams: `marketing/offers/fundhub-offers-2026-10-10.pdf` (diagrams live in the doc: four phases, starter to full program, six rounds, the Blueprint loop, the seven funding steps). Capital Academy (the full course) is left out until it launches. Owner-set 2026-10-10: complete sentences, plain tone, 5th grade reading level, every sentence new (nothing reused from the funnels) and none repeated inside the doc. Sources (2026-10-10): offer reasons from the closer deck and Blueprint research in this repo; objections from the closer playbook section 9 and the sales manager sheet (Alec Dupesh's Align, Educate, Reframe, Close, in Fundhub words); pains from the Capital Blueprint avatar in fundhub-platform `marketing/flywheel/capital-blueprint/01-avatar.md` (draft; pains only, no quotes).

**Internal only, not in the client doc (owner-set 2026-10-10):** financing goes only to Capital Blueprint, credit optimization for files at 600+ FICO, and funding deposits for clients who check every box (verifiable income and high credit). Everyone else pays cash. Finance OS becomes an extra monthly fee once it launches; the 12 free months are the buy-now incentive (owner still deciding). When a client pre-qualifies high (for example $200K), push them onto a higher fee on a finance plan (for example $10K) so they pay it right then.

**Internal, Capital Blueprint as the code runs it (read from fundhub-platform main, 2026-10-11).** The Blueprint section above describes only what the code does. Gaps between the offer and the code, for Chris to decide:
- The soft pull runs once per 12-month billing period, not every 30 days (`src/workflows/finance-os-pull-sweeper.mjs`, `src/subscriptions/billing-store.mjs`), and it is simulated until `FINANCE_OS_SYSTEM_PULL_LIVE` and `CRS_ALLOW_LIVE` are both on.
- FinanceOS turns on at payment with no end date, so it never stops at 12 months (`src/finance/finance-os-entitlement.mjs`). The doc still says "coming soon" because Chris set that on 2026-10-10.
- No documents are built at payment. The report pages and letters come from a credit pull or the closer's "Send deliverables package now" button.
- The credit partner's own checklist is never created (`ensurePartnerChecklistIfConsented` has no caller in `src/blueprint/credit-partner.mjs`).
- The closer alert waits on every step except "no new credit", including the bureau-answers upload, and dispute steps are seeded even on a clean file (`src/blueprint/closer-ready.mjs`, `src/waypoints/purchase.mjs`).
- The "How To Use This" mini course is five "Coming soon" modules. The welcome kit is a task for the funding advisor, and nothing ships it.
- The paydown simulator, credit partner and bank tracker are staff-run screens. The decline paste is the only Blueprint-only screen a client uses. Decline reading and the money helper run on rules until AI is switched on.
- Client texts and emails only go out when `MESSAGING_DRY_RUN` is set to an off value in the live settings.

## How this document works

This document explains the four things Fundhub sells. Each section tells you what the offer is, what problem it fixes, what you get, and why it is worth the money. The table at the end helps you pick where to start.

What is on your credit report decides which offer fits you right now. If something on the report is hurting you, Fundhub fixes that first. If the report is already in good shape, Fundhub moves you straight to funding.

Chris, who runs Fundhub, has done this work for about ten years. He has gotten a little over $1,000,000 in funding for himself. Every client file at Fundhub goes through UnderwriteIQ, which is software Fundhub built from what it learned on hundreds of client files.

*Diagram: A credit file moves through these four phases from left to right.*

## Credit optimization starter: $200

The starter costs $200 and covers the first two rounds of credit optimization. A round means Fundhub mails dispute letters about items on your credit report and then waits for the credit bureaus to answer.

### What it solves

If you paid for credit help before and never saw what was done, the starter fixes that, because every letter and every answer shows up in your client portal. If you feel unsure about starting, the low price lets you try the work before you spend more.

### What you get

- Fundhub mails two rounds of dispute letters for you.
- The letters use Metro 2, which is the format the credit bureaus use to report accounts, and Fundhub mails them with its own method for getting items removed faster.
- Your client portal lets you watch each letter go out and each answer come back.

### Why it's worth it

For $200, you see real changes on your own report before you commit to more. If you like the results, your $200 goes toward the full program, and the rest of it costs $800.

*Diagram: The two starter rounds come first, and four more rounds finish the full program.*

## Full credit optimization: $1,000

The full program costs $1,000 and gives you up to six rounds of disputes. Its goal is to get your credit file ready to apply for funding.

### What it solves

When you apply, a bank looks at more than your score. It also checks your inquiries, your old addresses, and negative items like late payments, and any of those can get you turned down even with a good score. The six rounds go after those items one round at a time.

### What you get

- Fundhub mails up to six rounds of dispute letters for you.
- Some letters go to the credit bureaus, and others go straight to the company that reported the item.
- The work covers negative items, inquiries, and old addresses on your report.
- Your portal shows where each round stands, and the team keeps you posted.
- If your credit score is 600 or higher, you can pay for the program over time.

### Why it's worth it

A cleaner file gets approved for more money, so this program raises how much funding you can get later. Every month a messy file stays the same, it keeps getting smaller approvals. The letters follow the Fair Credit Reporting Act, and any item that stays on your report gets sent up to the Consumer Financial Protection Bureau and your state attorney general. Once your file is ready, the same team moves you into funding.

*Diagram: Six rounds of disputes take a file to the point where it is ready to apply.*

## Capital Blueprint: $5,000 to $10,000

Capital Blueprint gives you a written funding plan built from your credit report, a checklist that turns the plan into tasks, and a team that follows up until the tasks are done. When your file is ready, the Blueprint hands you to a closer for done-for-you funding. After the first 12 months, a monthly member fee keeps the program running.

### What it solves

If a bank turned you down and never told you why, the plan shows you what a lender sees when it looks at your file. If you bought a plan before and it felt generic, this one is written from your own report. If you are not sure which bank to try next, the plan names the banks to use and the order to use them in. If you have started plans before and stopped partway, the checklist reminders and your CSM keep you moving.

### What you get

**Your plan, built from your credit report**

- A credit analysis report breaks down everything on your report today.
- A roadmap lists each step you need to take and the order to take them in.
- A dispute letter pack has letters written for the items on your report, ready for you to print and mail.
- A funding snapshot estimates the funding you can get today and after your file is fixed.
- A bank and lender match list names the banks that approve files with a profile like yours.

**Your checklist**

Your plan turns into a checklist in your portal, and each task has a due date.

- For each credit card, a task asks you to pay the balance down to 10% of the card's limit within 30 days. The task checks itself off when a new credit pull shows the lower balance.
- A standing task asks you not to open new credit while your file is being worked on. If a new card shows up on your report, the task gets flagged.
- Three dispute tasks ask you to mail your letters within 14 days, upload your proof of mailing within 21 days, and upload the credit bureaus' answers within 45 days. The proof task and the answers task close only when you upload the matching document.
- Other tasks cover setting up your business, such as filing your LLC and opening a business checking account, plus a talk with your advisor about a personal loan. You check these off yourself when they are done.

**Follow-up when a task runs late**

- On the day a task is due, you get a text. If it is still open 2 days later, you get an email, and at 5 days late, you get another text.
- At 9 days late, your CSM gets a task to reach out to you personally.
- Reminders only go out between 8 in the morning and 8 at night in your time zone.
- If you reply STOP to the texts, the texts end, and your CSM calls or emails you instead.

**Your team**

- A client success manager, called your CSM, is assigned to you when you join.
- When the system sees that your file can get funded and your tasks are done, your CSM sets up a prep call with you. After that call, a closer reaches out to start your done-for-you funding.
- A funding papers checklist asks for your bank statements, tax returns, and ID one item at a time, about every 3 days, so your file is complete before funding starts.
- If a bank turns you down, you paste the decline letter into your portal. You get the likely reasons and the steps to ask the bank for a second look, and your funding advisor takes the case.
- Your team can add one spouse or business partner to your file as a second applicant.
- Your team tracks the accounts you open at the banks on your match list and the deposits you make there.
- After you get funded, the system picks a date when your file should be ready for the next funding sequence, and your closer is told on that date.
- Whenever Fundhub runs a new soft pull on your file, your tasks are checked again and your letters are rebuilt from the new report.

**Tools for your money**

- FinanceOS is coming soon. It will show all of your accounts, cards, and due dates on one page. Anyone who buys now gets the first 12 months free.
- Your team can build a paydown plan with you that shows which cards to pay down first and by how much.
- A money helper in your portal answers questions about what to pay and when.
- File protection alerts send you a text before each card's statement date, at 60, 30, and 7 days before a 0% promo rate ends, when your cash drops below six months of minimum payments, and when a new card or inquiry appears. A new card or inquiry also alerts your CSM.
- You can pay for Capital Blueprint over time.

### Why it's worth it

Studies of self-paced courses show that most people never finish them, so the Blueprint is built around getting every task done. Each task has a due date, a reminder, and a person behind it when you fall behind. The proof tasks only close when the document is uploaded, so nothing gets skipped. The funding snapshot shows how much money stays on the table until the file is fixed. When the file is ready, your closer takes over and runs your funding.

*Diagram: The Blueprint loop repeats until your file is ready, and then it hands you off to funding.*

## Funding, done for you: $1,000 to $3,000 down

With this offer, Fundhub runs your whole funding process for you. You pay the upfront fee only after Fundhub confirms that you qualify for funding.

### What it solves

Each bank application adds a hard inquiry to your report. When you apply to one bank after another on your own, the denials and inquiries stack up fast. Fundhub sends your applications only to banks that fit your file, and it sends them in planned rounds. Years of client results tell Fundhub which banks fit which files.

### What you get

- Fundhub gets your file ready to qualify for the maximum amount of funding.
- If you need a business, Fundhub opens one for you.
- Fundhub chooses the bank for every application.
- A funding sequence is one full push for funding, and yours has 3 to 6 rounds of applications that go out in a set order.
- Between rounds, a specialist works on removing the new inquiries.
- Funding can come in your own name, in your business's name, or both.
- Your portal tracks every round, and the team updates you along the way.
- You pay $1,000 to $3,000 down plus a success fee based on the funding you receive, and your closer sets that fee with you on the call. If you have income you can prove and strong credit, you can pay the deposit over time.

### Why it's worth it

The banks you use and the order you use them in decide how much money you get, and that is the part Fundhub handles for you. Your deposit goes toward your success fee. The average Fundhub client gets $100,000 to $300,000 in funding.

### Getting funded more than once

You can get funded again after your first funding sequence ends. Each company you own applies for its own business credit, so every company you add brings in more funding. The company can be a new one that Fundhub opens for you or an LLC you already have. Fundhub can run a new funding sequence about every 3 months. Chris used this approach to get $100,000 credit lines for four different companies off one personal credit file.

*Diagram: Steps 6 and 7 repeat once for every round in a funding sequence.*

## What you may have heard about other offers

Before you talked to Fundhub, you may have heard bad stories about funding companies. This table lists those stories and explains what Fundhub does about each one.

| What you may have heard | What Fundhub does |
| --- | --- |
| You pay a large fee before anyone checks whether you qualify. | Fundhub confirms you qualify before it charges the upfront fee. |
| The ad shows a big amount, and you end up with much less. | Fundhub studies your credit report first and tells you what to expect before you pay. |
| Your file gets sent to every bank at once, and your score drops. | Fundhub applies in small rounds to banks picked for your file and clears inquiries between rounds. |
| You pay for a course and then do all of the work by yourself. | Credit optimization and funding are done for you, and Capital Blueprint comes with an agent and a CSM who keep you on track. |
| Nobody calls you back after you pay. | After you pay, you have a portal and a team you can reach. |
| The price stays a secret until the call. | This document lists every Fundhub price. |
| You are told you must own a business to get funded. | Fundhub funds people with or without a business, and it can set up a business for you. |
| Someone cuts corners with your file and puts you at risk. | Fundhub disputes only items that really show on your report, and every application uses your true information. |

## Questions people ask

**Is Fundhub legit?**
Fundhub's team has worked on hundreds of credit files over the years. During your call, your closer looks at your own file with you before you decide anything.

**How do I know you won't take my money and disappear?**
Your closer goes over the agreement with you on screen before you get a payment link. Once you pay, you can log in to your portal and meet the next person on your team, such as your funding advisor.

**I applied before and got denied. Why would this go differently?**
A denial is based on how your file looked that day and which bank you chose. Fundhub looks at your file as it is now and picks banks that match it.

**Will this put a lot of inquiries on my report?**
The first check Fundhub runs is a soft pull, and only you can see a soft pull on your report. After that, applications go out in planned rounds, and the team works to clear new inquiries after each round.

**Do I need a business?**
You can get funded with only your personal credit. If you want business funding and do not have a company yet, Fundhub can set one up for you.

**Can I finance it?**
Capital Blueprint can always be paid over time. Credit optimization can be paid over time when your score is at least 600. The funding deposit can be paid over time when you have provable income and strong credit.

**What if I don't get funded?**
Fundhub charges the upfront funding fee only after it confirms you qualify. Before that point, you also get an estimate of how much funding to expect.

**Can my spouse or partner join?**
Yes, they are welcome on your call. Capital Blueprint also lets you add them as a second applicant.

**Can you prove it works before I pay for the bigger offers?**
You can start with the $32 soft pull on your call or with the $200 starter. Either one shows you the work on your own file before you spend more.

**Other companies charge $8,000 to $10,000. What's the catch?**
You can see all of Fundhub's costs in this document before your call. The funding deposit is $1,000 to $3,000, and it counts toward your success fee.

**I already have cards. Why would I need this?**
Your call figures out what you want next, whether that is more credit, better terms, or a cleaner file.

**I don't want more debt.**
Funding gives you real credit in your name, and you decide how much of it to use. If you would rather wait on new credit, credit optimization and Capital Blueprint fix your file first without opening any new accounts.

**Do I have to personally guarantee the credit?**
Each bank has its own rules about personal guarantees. Bring that question to your call so your closer can go over the banks that fit you.

**I need to think about it.**
That makes sense. Tell your closer which part is still unclear, whether it is your file, the price, or trust, and they will answer that part directly.

## Where to start

Find the row that sounds most like your file today. Your closer will look at your file on the call and confirm the right starting point.

| Your file today | Start with | Price |
| --- | --- | --- |
| You want to test the process on your own report first. | Credit optimization starter | $200 |
| Items like late payments, inquiries, or old addresses are hurting your file. | Full credit optimization | $1,000 |
| Your score is between the 550s and the 700s, and you want a plan with people checking on you. | Capital Blueprint | $5,000 to $10,000 |
| Your score is 600 or higher, and you want to get funded now. | Funding, done for you | $1,000 to $3,000 down, plus a success fee |
