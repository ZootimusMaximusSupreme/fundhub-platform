# TODO

## Now — 2026-10-04 (Sunday)

### Today
- [ ] Sauna, then shower at 6:00
- [ ] Canal Club: prep and load all the ads into BigVU
- [ ] Film the 2 VSLs at sunrise (6:23)
- [ ] Film 3 canal ads, then the bank ad, then 2 ads at home
- [ ] Green screen ads: talking points are in `marketing/ads/scripts/book-a-call-final-2026-10-03.md` sections 7 and 8 (branch `all-scripts-2026-10-03`)
- [ ] Edit
- [ ] Mastermind the offer
- [ ] Scrape courses

### Ship the SLO price drop to $197 ($297 crossed out), built on branch slo-197
- [ ] On your Mac, in Terminal: `bash ~/Developer/fundhub-platform/scripts/ship-slo-197.sh` (merges, shows the dry run, waits for "yes", deploys, pushes only the /roadmap page)
- [ ] Open apply.fundhub.ai/roadmap and check that every price says $197 (look only, don't pay)
- [ ] Check whether apply.fundhub.ai/order (native ClickFunnels checkout, $297 product) still gets traffic. If it does, change that product's price in ClickFunnels too
- [ ] Decide on the follow-up texts: they offer $197 as a discount, which now equals the price. Lower it (e.g. $97) or turn that text off
- [ ] Compare conversion for one week at the same daily spend against the last week at $297

### Remove the blocks that stop Claude from shipping on its own (owner ask 2026-10-04)
- [ ] Network: claude.ai → Admin settings → Capabilities → network access → allow all domains (or at least myclickfunnels.com, api.netlify.com, api.supabase.com, api.inngest.com)
- [ ] File deletes: approve Claude deleting files in the fundhub-platform folder (git can't merge from the cloud while deletes are blocked)
- [ ] Give the cloud permanent access to the repo on GitLab, so work keeps going while the Mac is off
- [ ] Add the deploy keys to the cloud environment's secrets, so `npm run ship` runs from the cloud
- [ ] Test: ship one small change end to end from the cloud
- Keep: the "type yes" check before a deploy, and the funnel safety rules in the repo. Those don't slow anything down; the network block does

### This week
- [ ] Lift 2–3x
- [ ] Animation overlays for the new ads. Owner-set order: edit the video first and lock it, then add the animations on top. Animations go in last so no cut ever chops one.
  - [ ] Find the animation templates already built in the repo
  - [ ] Lock the final cut of one ad
  - [ ] Mark the timestamps where each animation lands
  - [ ] Drop the animations in and export
  - [ ] Repeat for the rest of the batch
- [ ] Figure out the low-ticket session funnel
- [ ] Block AI crawlers on every live funnel page
  - [ ] List every live funnel in ClickFunnels
  - [ ] Find where ClickFunnels lets you add head code or SEO settings per page
  - [ ] Add the crawler block to each page
  - [ ] Spot-check one page to confirm it's live
- [ ] Check UnderwriteIQ's math against Chris's (see UI item 9 below)
  - [ ] Chris's math: highest card limit × 5.5 = personal; business ≈ 2× personal; personal loans on top. A $20K card ≈ $110K personal, ≈ $220K business.
  - [ ] `src/underwrite/vendor/underwriter.cjs` lines 196–286 applies 5.5× on each clean bureau and adds all three, so a $20K card shows $330K personal (3× Chris's number)
  - [ ] The same code doubles business only at 2+ years old (1× at 1–2 years, 0.5× under 1 year); Chris's rule is ≈ 2×
  - [ ] Decide whether 5.5× applies once or per bureau
  - [ ] Decide whether business is ≈ 2× or stays tied to business age
  - [ ] Run one real client file through it and compare to the math by hand

- [ ] Move ads from full scripts to bullet points. The 2026-10-04 batch is the last fully scripted set.
  - [ ] Bullet format to stop rambling: hook and line 2 written word for word, then one short cue per point, then the reveal, then the CTA word for word
- [ ] Fix monotone delivery with a simple inflection system (path of least resistance, no new app)
  - [x] Marks in use from 2026-10-04: CAPS = punch the word, blank line = pause (BigVU only pauses on a space), ↑ = pitch up at the end
  - [ ] Mark up one script with them and film it
  - [ ] Watch it back next to an unmarked take and compare
  - [ ] Once the marks feel natural, have every new script delivered with them
  - [ ] Later, if it helps: one short course or app on vocal tonality

- [ ] Curiosity-gap thumbnails, only for certain ads, not every ad. Owner-set: it's a separate thumbnail image (red circle on something that doesn't fully make sense, e.g. a spot near the penthouse) PLUS a strong opening, two separate pieces.
  - [ ] Pull 5 examples of red-circle thumbnails you like
  - [ ] Make the thumbnail for the penthouse ad
  - [ ] Set it as the ad's thumbnail / cover in Meta
  - [ ] Keep the strong spoken opening as is
  - [ ] Compare hook rate against the same ad with the default thumbnail

- [ ] Build a voice file from Chris's own words so scripts sound like him
  - [ ] Pull his voice-dictated messages from the Claude chats
  - [ ] List his go-to phrases and how he builds a sentence
  - [ ] Save it as marketing/ads/VOICE-CHRIS.md
  - [ ] Write every new script against it

- [ ] Examine the reference ad (Scale without your own cash) and reuse how it was built
  - [ ] Read it through once more and mark anything to change
  - [ ] Film it
  - [ ] Use the same build steps (marketing/ads/reference/ad-scale-without-your-own-cash-2026-10-04.md) for the next long ads

- [ ] Visuals for the reference ad (Scale without your own cash): Chris on the bottom of the frame, animations on top. Film, edit and lock first, animations last.
  - [ ] Film it on the phone in BigVU, framed so you sit in the bottom 40% of the frame
  - [ ] Edit and lock the cut
  - [ ] Reuse the Remotion templates in marketing/broll (branch ad-scripts-2026-10-02): FileItems or HiddenDataPoints for step 1, CompanyLine or BankPockets for step 2, LenderMatchScroll or LenderSlots for step 3, BookCall for the CTA
  - [ ] Build 3 new ones: spend up → more data → better ads; $10K / $20K / $50K a month climbing to $100K; rates going up while banks lend less
  - [ ] Leave the family beat as just Chris on camera, no animation
  - [ ] Drop the animations onto the locked cut at each beat and export

- [ ] Lock scripts the night before every filming day (2026-10-04: 3 hours went to rewriting one ad on location)
  - [ ] Pick the ads for tomorrow
  - [ ] Read each one out loud once at home and flag any line that doesn't roll off the tongue
  - [ ] Fix the flagged lines with Claude that night
  - [ ] Load only locked scripts into BigVU
  - [ ] On filming day, film only. Any new idea goes on the list for the next batch

- [ ] Build a private FundHub teleprompter this week (owner decision 2026-10-04: BigVU drifts speed, needs a restart every take, can't pause and resume, and can't start anywhere in the script)
  - [x] Decided: words only (owner, 2026-10-04)
  - [ ] Must-haves: a words-per-minute setting that holds steady and never drifts, a mirror toggle, no filters
  - [ ] Must-haves: pause and resume in place, tap any line to start from there, restart a take with one tap without closing the app
  - [ ] Extras: a blank line becomes a real pause, CAPS words show bold, ↑ shows where the pitch goes up
  - [ ] Scripts load straight from the repo, no copy and paste
  - [x] First version built 2026-10-04 and published as a private Claude artifact (Fundhub Teleprompter), code in tools/teleprompter/
  - [ ] Move it behind your login on fundhub.ai so it saves to the Home Screen
  - [ ] Test it at home on one ad
  - [ ] Fix what feels off, then film a full batch with it
  - [ ] Later: recordings go straight into the editing pipeline

### Next 30 days (launch by about 2026-11-03)
- [ ] Alt finance offer: SBA, hard money and real estate lending
  - [ ] Search the Meta Ad Library for SBA, hard money and fix-and-flip ads
  - [ ] Find the avatar work already in the Drive or the repo
  - [ ] Pick the lending partners for each product
  - [ ] Define the offer and how it routes on the sorting-hat call
  - [ ] Write and film the first batch of ads
  - [ ] Build the funnel and launch

### From Claude chats, Sep 6 – Oct 4 (swept 2026-10-04)
Open items from Claude chats that were not in this file yet. Personal errands went to `TODO-personal.md` (local only, gitignored, never pushed).

#### Filming gear
- [ ] Buy a spare Rode Wireless ME transmitter (about $80)
- [ ] Buy a USB-C power bank for the shoot kit
- [ ] Buy the ZGCINE PS-R30 PRO case

#### Funnel and site
- [ ] Roadmap page audit: finish the 23 remaining fixes (Claude Doc project 0f85c4cd-e73a-4ef5-9a6a-ad5c3dad0f6a)
- [ ] Thank-you page: add the video slot
- [ ] Netlify bandwidth: move the VSL mp4 off Netlify
- [ ] Remove the placeholder testimonial boxes
- [ ] Edit the funnel testimonials, then add the real ones
- [ ] Check the mobile layout
- [ ] Prep the sorting-hat funnel
- [ ] Turn off the free-access system
- [ ] Save the free lead-magnet course outline into the repo (7 lessons, "How to get $100K–$300K in 0% funding off your credit file")
- [ ] Proof cards
- [ ] ClickFunnels API slot with Paul
- [ ] Website migration off ClickFunnels
  - [ ] Merge the open branches first
  - [ ] Restore the shuffle and light-up course section
  - [ ] Put the Canva approval screenshots into the asset stack
  - [ ] Set up Cal.com and the CRM custom fields

#### Ads and video
- [ ] Refine the 11 scripts
- [ ] 20 full ads, plus the short sorting-hat ads
- [ ] Smooth out the VSL with Carly
- [ ] Film 3 long-form B-roll interviews
- [ ] Film 3 testimonials with B-roll
- [ ] Send the B-roll asset request list to the marketing team
- [ ] Gather the ad library materials
- [ ] Build the testimonial thumbnail pipeline
- [ ] Export the 3 Submagic videos: Portal Welcome, SLO Main Page VSL, VSL 2 Booking
- [ ] Film the portal welcome video
- [ ] Film the Credit Mastery System course in Loom (93 slides, one video per module)
- [ ] Background marketing agents: scheduled ad-script drafts you review in one batch (designed 2026-09-06, build not started)

#### Tracking, data and APIs
- [ ] Pixel conditioning on the survey
- [ ] 1% value-based lookalike from about 2,000 leads (760+ credit, $100K–$200K revenue)
- [ ] Clarity tracking check
- [ ] Submagic: check the Business + API plan
- [ ] Video pipeline: Drive Raw → R2 → Submagic / Deepgram
- [ ] Phone alerts through ntfy or Pushover

#### Payments and financing
- [ ] Finish the financing approval
- [ ] Zoom with Justice on financing
- [ ] Sign up with ClarityPay directly for a custom checkout
- [ ] Create the Whop account
- [ ] Whop KYB support issue for FH Consulting LLC
- [ ] FH Consulting BNPL plan: own domain, bank account and checkout (fh-consulting-bnpl-plan.md)

#### Capital Blueprint and portal
- [ ] Monthly soft pull that updates the plan and the letters
- [ ] Accountability agent with a proof-gated checklist
- [ ] Dispute-round waypoints
- [ ] Ready-for-funding trigger that alerts the closer
- [ ] Payment timing guidance
- [ ] Promo alerts at 60, 30 and 7 days
- [ ] Payment reserve tracking
- [ ] Welcome kit
- [ ] Per-letter mailing upsell
- [ ] Credit partner file
- [ ] Bank relationship tracker
- [ ] Next-funding-sequence planner
- [ ] Finance OS: 12 months included, then monthly
- [ ] Optimize the roadmaps
- [ ] Authorized contact access in the credit optimization portal
- [ ] UnderwriteIQ: post-funding inquiry log, with a backfill
- [ ] Repair the partner sample export
- [ ] Finalize the doc-collection agent prompts

#### Sales and outreach
- [ ] Text the 40 old clients (target: 10 sales)
- [ ] Focus group outreach to entrepreneurial women in AZ
- [ ] Get the Telegram contact for the Maria Wendt course

#### Ops and systems
- [ ] Consolidate the conflicting rules across CLAUDE.md and the notes
- [ ] Save the interview research as an SOP
- [ ] Delete the 4 DUPLICATE files in the Drive
- [ ] Company brain: transcribe ACQ, the course and the Hormozi content into it, then add an open-source visualization (low priority; CXL minidegrees after)

### This file
- [ ] Triage: walk each dated section below with Claude (done / keep / kill), move what's left into Today / This week / Next 30 days, and archive the rest

## Now — 2026-09-25

- [ ] **Arizona MLO refinance funnel.** White label is E Mortgage Capital (`https://www.emortgagecapital.com/`). Use the Arizona mortgage-loan-officer license. Pull Arizona leads. Target homes that need a refinance. Then run that funnel. Company NMLS 1416824. Their refi door is `/refinance` (also `/e-refi`).
- [ ] **Film more ads.**
- [ ] **Film more interviews.** Shoot long form, then cut it into short form.

## Tomorrow — 2026-09-26 (Saturday) — lender lists

- [ ] **Owner: Claude Code IDE** (not Cursor Grok, not Composer). Make sure the lender lists are good — the book of banks AND the list a $297 / Capital Blueprint buyer sees in the portal. Book: `docs/legacy-strong/lenders-legacy-strong.csv` (~313 banks), loaded by `scripts/lenders-import-alec.mjs`. Buyer-facing list: built by `src/deliverables/lender-list.mjs` (portal deliverable `bank-lender-match-list` / `lender_match_list.html`) from that book — no separate static buyer CSV found. Do not start this check before Saturday.

## Tomorrow 9/23 — video

- [ ] Run Colin's testimonial through Submagic: `~/Downloads/Fundhub Roadmap Testimonial Colin 1.mp4` (seen 2026-09-22). Copy it into the Drive "SLO Ads" folder (13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ) first so it is not only on this laptop. Submagic key is not in .env yet (Chris pasted it in chat 2026-09-21; the .env write was blocked).

## Marketing walk fixes — open items, 2026-09-17

Full write-up: `ops/workflows/marketing-fixes-2026-09-17-board.md`. F1 (the script
drop-down) is fixed and live. These three are what is left.

- [ ] **Chris — paste the view counter onto the watch page.** The watch page lives in
  ClickFunnels, so no code here can reach it. Open the page for
  `apply.fundhub.ai/watch`, paste `marketing/landing-pages/06-utm-hidden-fields.html`
  at the top and `marketing/landing-pages/07-vsl-watch-beacon.html` at the bottom,
  then Save and Publish. Until then, nobody watching the video is counted.
- [ ] **Chris — is `ANTHROPIC_API_KEY` on the list?** Netlify → site → Site settings
  → Environment variables. Just say whether the name is there; do not show the value.
  Social Studio's "Write 3 posts for me" still writes 0 posts on the live site. The
  starred-out OpenAI key no longer blocks it (`a91a81f8`), so the only thing left is
  whether a working writer key exists. **Never remove a key** — CLAUDE.md §11.
- [x] **Multiple funnels — built, `fb49489e`.** Every viewing now carries a funnel, worked
  out from the page address the counter already saves. No change to the paste above, so
  it is still one paste. The funnel list starts empty on purpose: when a funnel has a name,
  tell an agent its page address and name and it becomes one row. Until then a viewing
  shows under its page address — nothing is lost.

## Personal — errands

More personal errands: `TODO-personal.md` (local only, gitignored).

### DEXA scan, Gilbert AZ — priced 2026-09-26

**The place that does it all: DexaFit Gilbert.**
5656 S. Power Road, Suite 124, Gilbert AZ · (480) 336-9062 · Tue–Sat 8am–4pm ·
no doctor referral needed. One location for the body scan, the treadmill test,
and the metabolism test.

#### What ONE DEXA scan already includes (no extra charge)

* Body fat percent, total and by limb
* Lean muscle mass, total and by limb — this is the athletic benchmark most people want
* Visceral fat — the fat around your organs, the one that matters for health
* **Bone density with a T-score** — yes, bone density is in the same scan. Same price.
  A T-score compares your bones to a healthy young adult.

Takes about 5 minutes. Accurate to within about 1.5%.

#### What is NOT included — separate tests, separate money

| Test | What it tells you | Included in DEXA? |
|---|---|---|
| VO2 max | How well your heart and lungs use oxygen. The real fitness number. Done on a treadmill or bike with a mask. | **No** |
| RMR (resting metabolic rate) | Exactly how many calories you burn doing nothing. Sets your food targets. | **No** |
| Grip strength, jump, sprint benchmarks | Athletic performance testing | **No** — DexaFit does not do these |

#### Prices

Single DEXA, Gilbert area:

| Where | Price |
|---|---|
| RadiologyAssist (Gilbert) | $111.11 — cheapest found, cash, no referral. Scan only. |
| Gilbert body-composition average | from $149 |
| Bone-density-only order | from $199 (insurance often covers THIS one if a doctor writes it as medically necessary) |
| US average, any DEXA | $200–$500 |

Bundles at other DexaFit locations, as a guide to what Gilbert will quote:

| Bundle | Denver | Nashua | Cincinnati |
|---|---|---|---|
| Single DEXA | $99 | $119 | — |
| DEXA + RMR | $179 | $219 | $385 |
| DEXA + VO2 max | $189 | $219 | $399 |
| All three | $289 | $319 | $575 |

So expect Gilbert's all-three bundle somewhere in the $289–$575 range. HSA and FSA
cards are accepted.

**Not verified:** DexaFit Gilbert's own published prices. Their website is blocked
from the agent environment. Do not quote a DexaFit Gilbert number until someone
calls (480) 336-9062.

**Next action:** call (480) 336-9062 and ask for the 3-service bundle price
(DEXA + VO2 max + RMR).

Sources: dexafit.com/locations/arizona/gilbert · phoenix.dexafit.com/gilbert ·
dexascans.com/az/gilbert · radiologyassist.com (Gilbert DEXA rates) ·
denver.dexafit.com · nashua.dexafit.com · cincinnati.dexafit.com ·
bodyspec.com (what a DEXA report contains)

## Google Knowledge Panel for Chris / FundHub — parked 2026-09-28

Not started. Chris saw an Instagram ad for Lindy Panels (lindypanels.com), a service
that sells Google Knowledge Panels — the info box Google shows on the right when you
search a person or company name. He wants it done in-house instead of paying them.
Parked for cost, not cancelled.

**Measured 2026-09-28: this repo has zero structured data.** No JSON-LD, no
schema.org markup, no microdata, anywhere. Grep for `ld+json|schema.org|itemtype=`
returns nothing across the whole tree. That is the first reason Google has nothing
to build a panel from.

**Their site is blocked from the agent environment** — `lindypanels.com` returns a
403 at the egress proxy, same class as `api.netlify.com` in CLAUDE.md §11. What they
sell was read from search results, not from their page. If a teardown of their funnel
is ever wanted, Chris has to paste the page text.

### What a Knowledge Panel actually needs

Three parts. Two are in our control, one is not.

1. **Markup on our own site** — tells Google what the entity is. Repo work.
2. **Matching profiles everywhere else** — LinkedIn, Crunchbase, X, YouTube,
   Instagram, Google Business Profile all agreeing on the same name, title and
   company string. Inconsistency is what stops a panel.
3. **Outside sources that mention Chris by name** — press, podcasts, bylines,
   directory listings. This is the part nobody controls and the part that usually
   stalls the whole thing.

**Nobody can guarantee a panel.** Parts 1 and 2 make the entity eligible. Part 3 is
what fires it.

### The split, when it runs — 4 workflows, no dependencies

Shared board: `ops/workflows/knowledge-panel-<date>.md`. Write the ground brief
(canonical name strings, `@id` URIs, sameAs list, production domain) to the board
BEFORE launching any workflow — A and B both need those exact strings and must not
invent them.

| # | Owns | Writes |
|---|---|---|
| A | FundHub the company | `public/index.html` — Organization + WebSite JSON-LD |
| B | Chris the person | new `public/founder.html` — entity home page + Person JSON-LD |
| C | Off-site audit | `docs/seo/entity-audit.md` — every live profile, name-string diffs, honest third-party source count |
| D | Wikidata + claim | `docs/seo/knowledge-panel-runbook.md` — Wikidata item drafts with a reference per statement, notability verdict, claim procedure |

A and B would collide over shared markup IDs; fixing the `@id` strings on the board
first removes it. C and D touch no code. Full copy-paste prompts for all four were
written in session `claude/lindy-panels-review-9xz9sj` — regenerate them from this
table, they are mechanical.

Model for this work: Opus for the split and the entity design, Sonnet for A–D.

### Blocker before anything starts

**The live production domain FundHub serves on.** Every `@id` and `sameAs` string
hangs off it. Guessing it poisons all four workflows. Ask Chris, do not infer it
from Netlify.

---

## Competitor gaps — MyFundalytics, measured 2026-09-12

Their site is blocked from the agent environment, so this is measured against the
feature list Chris supplied, checked line by line against main at 5f7ad13.

**Correction to the first pass on 2026-09-11.** It reported the lender table empty
and white-label custom domains missing. Both were wrong, from stopping at one grep.
The book holds 313 banks and custom domains are built and routed. What follows is
the measured version.

### What they have that we do not

1. **The bureau each bank pulls is unknown for 237 of 307 banks.**
   This is the real gap and it is data, not code. `src/lenders/match.mjs` already
   ranks by bureau rotation — spreading credit checks so no one bureau gets hit
   twice — and `db/migrations/365_lenders_bureaus_from_datapoints.sql` filled in
   70 rows from Alec's datapoints and the inquiry master. 237 banks stay blank
   because no source names them. 365's own header says that is a data gap and not
   a guess to fill, which is right. So the rotation ranking is running on about
   a quarter of the book.
   *Needs: a source that names the bureau for the other 237. Not a build.*

2. **No minimum credit score on a lender row.**
   `src/lenders/match.mjs` filter 4 is written to skip a bank whose stated minimum
   score is above the client's file — and its own comment says it "reads almost
   nothing today" because there is no `minimum_credit_score` column on `lenders`
   at all. Their "Approval Radar" (odds against a named lender) is mostly this one
   column. Without it we filter on state and bureau but not on score.
   *Needs: a column, a migration, and the numbers to put in it.*

3. **191 of 313 banks have no application link.**
   A match a client cannot act on is half a match.

### What we have that they advertise — verified, not assumed

* 3-bureau ingestion: `src/deliverables/credit-analysis.mjs`, `src/sales/cockpit.mjs`
* Lender matching with real rules: `src/lenders/match.mjs` (state, bureau
  sensitivity, bureau rotation, no business credit card without a business on file)
* 313 banks, loaded by `scripts/lenders-import-alec.mjs` from
  `docs/legacy-strong/lenders-legacy-strong.csv` — four times their advertised 80+
* Funding blueprint: `src/deliverables/roadmap.mjs`, `src/deliverables/lender-list.mjs`
* AI coach, deeper than theirs reads: `src/agents/` — registry, runtime, guardrails,
  model selection, shadow logging
* Intake-to-funded pipeline: `src/http/pipeline.pg.test.mjs`, application status enum
  in `db/migrations/138_lenders.sql`
* Fee, commission split and invoicing: `src/commissions/`
* White-label with real custom domains: `api/partner-brand/verify-domain.mjs` does a
  live DNS TXT check and sets `partner_brand.domain_verified`. Routed in
  `netlify/functions/api.mjs`. Plus `public/app/brand-studio.html`
* Row-level security, unprivileged app role, audit logging: `db/migrations/104_app_role.sql`,
  guarded by `npm run guard:rls`

### The gap that is not technical

They explain their product in eight bullets on one page. We cannot. That is a
positioning problem and it blocks nothing above.

### Company note

MYFUNDALYTICS LLC, Florida, registered 2026-03-03 — six months old. 777 Brickell Ave
Suite 500 is a virtual office. One named principal. A small fast shop that packaged
better, not a funded competitor that out-built us.

## Tomorrow 9/4 — read this first

The 2026-09-03 fix batch shipped overnight. 30 of 37 walkthrough defects fixed,
your real Capital Academy and Capital Blueprint contracts seeded, Blueprint
repriced to $5,000. All live and verified in the production database.

**Do not send a funding-deposit or credit-repair contract.** Those two still carry
"THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS." on purpose, because no
text exists for them. Academy and Blueprint are safe.

### Yours, in the order they unblock things

0a. **PUSH THE STRANDED WORK. Six branches, nineteen commits, zero pull requests.**
   Another session found this on 2026-09-05 and it was right about the shape even where it was
   wrong about the cause. The round-2 batch and wave 1 DID ship and are live — the SMS root fix,
   the reminder timing, the deliverables, the security header, the mail guard are all in main and
   deployed. But six branches carry work with no PR against them, and CLAUDE.md section 8 says an
   unmerged branch with no pull request is not in progress, it is lost.

   Agents in this environment cannot push — `git push` is refused by the permission layer, so
   `gh pr create` is closed too. It has to be you.

   **Safe to push now, documentation only, zero risk:**
   ```
   git push origin handoff/wave3:main
   ```
   That carries the portal plan, the JSON contract, the accountability spec, the handoff and this
   list. Until it lands, every other session is working blind.

   **Held on purpose, each with a real blocker a verifier found. Do NOT merge these yet:**
   * `fix/r2-w10-deliverables` (7 commits) — a client document still prints a made-up number for
     a card with no credit limit, and one committed proof file does not match the code.
   * `fix/r2-w8b-repair-floor` (6 commits) — on rounds 2 to 6 a letter says "this is correct" and
     then demands the bureau prove it. Rounds 1 is fixed; 2 to 6 are not.
   * `feat/letters-all-rounds` (1 commit) — the mixed letter, the common real-client case, still
     asserts things its own items do not support.
   * `fix/r2-w11-notifications` (1 commit) — this is the HELD SMS COPY, deliberately. It is the
     rewritten wording waiting for you to read, in `marketing/ads/sms-copy-2026-09.md`.

   **Dead, safe to delete:** `fix/r2-w8b-fulfillment` — a rejected first attempt, fully superseded.

0b. **Read the rewritten text messages.** `marketing/ads/sms-copy-2026-09.md`. Nine texts plus one
   email subject. They are written and deliberately not seeded, because you said you would read
   the wording before it reaches a real phone. Everything else from that batch shipped without
   them.

0c. **Decide the UnderwriteIQ six-month strategy** — see item 0 below. It blocks the accountability
   layer, because a checklist cannot chase tasks nobody has decided we do.


0. **Finalise the UnderwriteIQ strategy. It is not finalised and it is going out to
   clients right now.** The Credit Optimization Roadmap prints a six-month plan
   generated per client — a paydown table with real balances and targets, the dispute
   rounds, file the LLC, take the personal loan early, and then Month 5: get an EIN,
   register with Dun & Bradstreet for a DUNS number, open net-30 vendor accounts with
   Uline, Quill and Grainger, and build Paydex.

   Chris on 2026-09-05: **"we dont do DUNS"**, and the strategy itself is not settled.

   Nothing in the platform backs the Month 5 half. Searched: no vendor list, no Paydex
   field, no business-credit tracking, no record of whether a client opened anything.
   The Before & After table nonetheless promises "Business Credit Profile: None →
   Active (Paydex building)", which no part of the system can observe or deliver.
   It is prose in `scripts/black-reports/fundhub_gen.py` (lines 1333, 1483, 1524, 1554)
   and in `vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js:392`.

   Two decisions, both yours: which tasks stay in the plan, and for the ones that stay,
   whether the platform tracks them or they remain advice. Until that is settled the
   accountability layer (`ops/workflows/portal-accountability-spec.md`) cannot chase
   Month 5 at all, because nothing knows those tasks exist.


1. **Two contract texts.** FUNDING-AGREEMENT ($3,000 deposit) and
   CREDIT-REPAIR-AGREEMENT ($1,000). Neither is in the packet you supplied —
   Academy, Blueprint and White Label are, and those are handled. Drop them in
   `docs/contracts/source-2026-08-28/` and an agent seeds them.
2. **Two ClickFunnels questions**, in the CF editor. "Annual Business Revenue"
   saves into nothing at all, so that answer never reaches us and cannot be
   recovered. "Can You Verify Revenue?" is saving into the other question's slot.
   Part B of `marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md`.
3. **A Bland phone number.** The account owns none, so every call dials from a
   shared pool line — the likeliest reason a call rings and nobody speaks.
4. **21 ad names.** Ids in `ops/workflows/fix-batch-2026-09-03-remaining.md` §1.2.
   A check now fails while any is blank, so they cannot quietly stay unnamed.
5. **Turn off the Gmail "FS Auto" filter** before the re-walk, or it hides Fundhub
   mail from your Inbox and the walk lies to you again.
6. **Read the new Josh script** before it goes near a phone.

### Four questions, one line each

- Booking confirmations: send-now for the three booking messages only
  (recommended), or run the sweeper every minute for everything?
- What counts as a confirmed booking — the Google calendar Yes, the YES text back,
  or both? Nothing moves Booked → Confirmed today.
- Should "Generate Apps" create application rows, or is the SOP wrong?
- Capital Academy is also $5,000, so the education ladder now has two rungs at one
  price and "step down on a no" has nothing to step down to. Keep both as a choice
  of course, make Blueprint a bridge into Academy, or reprice?

### Known and not fixed

- **No lender in the book records a minimum credit score.** All 313 rows checked.
  The matcher now reads the credit file but screens nobody until that data exists.
- **No personal lenders at all** — 196 + 117 business cards, zero personal, while
  the estimate promises $199,350 of personal money.
- **Bureau rotation is inert** — 310 of 313 lenders have a blank bureaus_pulled.
- **The DIY letter pack fix was deliberately not shipped.** It turns 7 working
  letters into 0. Measurement recorded in `src/metro2/diy/deliver.mjs`.
- **Nothing writes an advisor assignment**, so the portal's advisor line will
  usually show its empty state honestly rather than a name.

### Two honest gaps in what shipped

- **No browser touched the live site.** Every screen fix is unproven until the
  re-walk. Seven agents shared one checkout, so browser proof was skipped on purpose.
- **The database test phase never ran** — no DATABASE_URL, 693 tests skipped. The
  8,594 passing are the unit phase only.

Full detail: `ops/workflows/fix-batch-2026-09-03-remaining.md`.

---

## Chris — launch list, 2026-09-03 (launch Mon 9/7; financing approves Fri 9/4)

### Today 9/3
- [x] Six Sedona ads to Paul (16, 6, 26, 51, 42, 45)
- [x] CRS soft pull live
- [x] Ad attribution + registry (Claude Code, PR #330/#331)
- [ ] Manual walkthrough 1–5pm: one client, ad → call → payment → fulfillment
- [ ] Mail forward at usps.com
- [ ] Calls after 5: credit optimization leads, Brandon Elliot (set Build Clock + First File numbers first; lead with 50% split, no clawback), Smart Start, storage unit
- [ ] Apply: Meta Marketing API, Google Ads API, Partner API
- [ ] If time: tweak 14 ads for Monday, VSL, Capital Blueprint + Capital Academy filming

### Before Fri 9/4
- [ ] Film VSL, send to Paul
- [ ] SLO live: VSL in, SIM MODE off
- [x] Merge #326, #327, #321 (all three on main as of 2026-09-03; #321 landed via #333)
- [ ] Payouts + waterfall walked end to end
- [ ] Quizzes working
- [ ] Closer on the script

### Sat–Sun
- [ ] Lender list optimized and fixed
- [ ] Filter 83 ads → top 30 = source of truth
- [ ] Cut ad 41 (built on a guarantee we don't offer)

### Mon 9/7
- [ ] Launch primary offer
- [ ] Film 14 in Sedona

### White label — not Monday
- [ ] Sell as-is: your brand, your ads, we fulfill; marketing = paid add-on. Drop Meta ad-library dependency.
- [ ] Set Build Clock days + First File count
- [ ] clients.partner_id attribution (0 of 29)
- [ ] Non-circumvention clause, migration

**Friday 2026-09-04 launches the FUNDING offer and the e-products.**
Today is Monday 2026-08-31. Tomorrow is the shoot.

**White label is NOT Friday.** It is ~30 days out and still being built. All the
flywheel output — the Locked Book offer, the 24 scripts, the ad plan — is white
label. It is good work aimed at the wrong date, so it moves down this list.

---

# TOMORROW — Tuesday 2026-09-01

- [ ] **Shoot 60–80 videos.** Different ad variations, one complete ad per angle.
      Ambitious and Chris knows it. Everything else on this page waits behind it.
- [ ] **Assets ready before the camera turns on:**
  - [ ] Copy angles we already hold
  - [ ] The additional angles from **Paul Tancredi**
  - [ ] White-label angles too — Chris wants to shoot those tomorrow even though
        white label launches later. Shooting once beats shooting twice.
- [ ] **Andromeda shape, since this is what the volume is for.** One reason per
      ad, hook and body and close all built for that one reason, filmed start to
      finish. Do NOT film one body and swap hooks onto it — that is the approach
      that stopped working when Meta's algorithm changed. Meta's floor is 15–20
      genuinely different reasons; 60–80 videos clears it easily as long as they
      are different *arguments* and not different *lengths*.

---

# BLOCKS FRIDAY

## The funnel

- [ ] **Push the SLO live for the funding offer. Up, not running.** The pages are
      built at `marketing/landing-pages/slo/` — `slo-01-sales.html`,
      `slo-02-order.html`, `slo-03-thank-you.html`, all ClickFunnels-ready with
      split markers where CF's native checkout and scheduler go.
      Its own README has a **SWAP BEFORE LAUNCH** list that must be cleared:
  - [ ] Video files: `slo-vsl.mp4` + poster, `slo-vsl2-funding.mp4`, `slo-vsl3-repair.mp4`
        — these come out of tomorrow's shoot
  - [ ] CTA hrefs: `/order` → the live order path
  - [ ] Proof: replace the bracket placeholders in Section 5 with real results
        (they auto-hide until then, so the page is safe to put up early)
  - [ ] Turn SIM MODE off
- [ ] **All the other funnels and materials up**, after the offers are refined.

## The offers

- [ ] **Refine the offers before the funnels go up.** Chris's call: each offer
      answers a different market pain, and they need a pass. The e-product
      catalogue is live in `src/config/offers.mjs`: Soft Pull $32 · Decline
      Autopsy $27 · Winner's Board $47 · Live Trial $297 · Repair Trial $200 ·
      Repair DFY $1,000 · UWIQ Deliverables $1,000–5,000 · Funding DFY $3,000 +
      10% · Funding Mastery $5,000.
- [ ] **Winner's Board becomes a subscription.** Owner decision 2026-08-31. It is
      currently one-time in `src/config/offers.mjs:175-184` with no `billing`
      field, and a subscription in `marketing/ads/ascension/ascension-ads.md:114`. The code is
      the half that is wrong. Chris wants it recurring so it sits inside the
      ecosystem rather than beside it.

## APIs — "every single detail is essential"

- [ ] **Meta API fully operational.** The token works today and reads the
      Fundhub.ai ad account. What is not wired: nothing writes campaigns, and
      `ad_metrics_daily` and `ad_platform_connections` are both empty, so no
      spend, impression or click data has ever landed.
- [ ] **Google API**
- [ ] **Google Ads API**
- [ ] **Partner API for Google Ads and YouTube integration**

## The database underneath it

- [ ] **It has to work perfectly.** Chris's words, and it is the foundation
      everything else sits on. Two things already known:
  - [ ] Migrations only run on the production deploy context, so a schema change
        is not live until the branch merges. Check `/api/health` — `pending` is
        the honest answer.
  - [ ] The `.pg.test.mjs` suite skips silently without `DATABASE_URL`. A green
        `npm test` proves nothing about anything that touches the database.

## Merges

- [ ] **[#326](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/326)** — credit repair: the 30-day bureau clock, delivery routing,
      Round 2. **Watch the first week after it lands** — the deadline alarm has
      never fired in the product's life, so new sends will start creating breach
      tasks.
- [ ] **[#327](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/327)** — this file.
- [x] **[#321](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/321)** — the marketing flywheel. Tooling and docs, no product code.
      Not urgent for Friday but harmless to land.

---

# DECIDED — do not re-raise

- **Build guarantee sign-off: Chris.** Owner decision 2026-08-31. `docs/specs/W4-live-trial.md:208`
  wanted a named holder and `:756` recorded that nobody held it. Chris holds it.
- **Winner's Board: subscription.** Owner decision 2026-08-31.
- **Cost ceiling: $42.50 target, $64 hard stop.** Chris repeated these back on
  2026-08-31. If he meant to leave them open, say so — otherwise they are set.
- **The avatar is assumed and that is fine.** Spend is the validation. Never
  attach a "validate this first" rider to anything built on it.
- **No compliance checking in the flywheel.** The product already screens ads
  before they send, in `src/compliance/`.

---

# WHITE LABEL — ~30 days, not Friday

Being built now, launches later. The flywheel produced a complete package for it
and that work stands; it just is not this week's deadline.

## The one that decides whether white label works at all

- [ ] **Nothing ever attributes a lead to a partner.** `clients.partner_id` is
      the column that links a client to the partner who brought them. It is set
      on **0 of 29** clients. Every production writer of `clients` was traced —
      `src/auth/seed-role-accounts.mjs:84`, `src/contracts/upload.mjs:182`,
      `src/journeys/runner/synthetic.mjs:82`, and the event-bus creator
      `src/handlers/client-lifecycle.mjs:184` — and **not one sets it**. The
      public funnel intake `api/public/survey-submit.mjs` does not contain the
      word "partner". The only writer that has ever set it is the demo seeder.

      So a white-label partner sees no leads because **no lead can reach them**.
      Every dashboard complaint below is downstream of this. Fixing the screens
      without fixing this produces a prettier empty page.

## Dashboard findings — traced 2026-09-01, read-only

The back end is in better shape than the screens. Every endpoint checked is
routed, correctly gated with `requirePrincipal`, and scoped server-side. The
accrual writer (`src/partners/revenue.mjs`) is genuinely good: rate frozen at
accrual, no clawback possible, refunds expressed as voids, front and back end
allow-listed to the three right product codes.

- [ ] **The partner home's centrepiece is permanently empty.**
      `partner-galaxy.html:523-532` hardcodes `CLIENTS`/`NODES`/`ROUTES`/`STANDING`
      as empty arrays with no assignment anywhere. The canvas is the largest
      element on the page (`.sky-wrap{flex:1}`, line 188) and ships with a legend
      explaining how to read it and instructions to click things in it. This is
      why it "looks poor" — not thin content, a dressed-up blank.

- [ ] **`partner-training.html` works and nothing links to it.** It renders the
      13 seeded `training_modules` and 4 `training_gates` correctly.
      `grep -rn "partner-training" public/` returns only `shell.js` constants and
      a CSS comment; `partner-galaxy.html` says "training" zero times. Built,
      seeded, unreachable.

- [ ] **Two more endpoints built, routed, and called by nobody:**
      `/api/read/partner-production` and `/api/trials/dashboard`.

- [ ] **The accrued balance is fetched and thrown away.**
      `partner-galaxy.html:1755` asks for it; `data.js:579` drops it.

- [ ] **The affiliate's two most useful tables have no data path.**
      `affiliate.html` declares `var LEADS=[]` (line 398) and `var PAYOUTS=[]`
      (line 477) and never assigns either, so they permanently print "No
      referrals on file" and "not connected to your payout history yet." No
      endpoint anywhere returns `affiliate_referrals` or `affiliate_payouts`
      rows — the file's own comment at 526-529 says so. Not broken; never built.

- [ ] **Two tiles are hardcoded strings.** RATE is the literal "Per agreement"
      and COOKIE is "60d" (`affiliate.html:212-213`), while the real rates —
      direct 20%, downline 5% — sit in `affiliate_commission_rules`.

- [ ] **The payout hold is invisible.** `affiliates.partner_license_signed_at`
      gates every release (`033_affiliates.sql:88-95`) and the endpoint reduces
      it to a bare `license_signed` boolean with no explanation and no route to
      the document.

- [ ] **Nobody can log in as the one affiliate with real numbers.** AFF-000063
      has the only referral and the only payout in the database and has no
      `accounts` row. `affiliate@fundhub.ai` — the account that does work — has
      3 clicks and nothing else. Testing this felt useless because it was.

- [ ] **11 of 13 partners have `agreement_signed_at` NULL**, so the training
      page returns 403 `not_entitled` for them, including the test-role partner
      an auditor would sign in as.

- [ ] **Two stale comments that mislead a reader**, both about the leads path:
      `affiliate.html:817-825` says nothing records clicks (false — 9 rows exist
      and `public/start.html:52,56` POST them), and `api/read/affiliates.mjs:24-27`
      says af-02 has never written a referral row (false — it is registered and
      wired at `src/workflows/index.mjs:5,74`).

- [ ] **Refine the white-label offers.** Chris likes them and wants a pass — each
      one answers a different market pain.
- [ ] **The Locked Book offer** — `marketing/flywheel/partner/03-offer.md`. $10,000
      once, sold on the Owner Lock. Needs its two guarantee numbers:
  - [ ] The Build Clock: how many business days
  - [ ] The First File: how many files in the first 30 days
- [ ] **Non-circumvention clause into the partner license.** A NEW migration —
      never edit 283. Gates the strongest guarantee (The Lock Stands) and any
      copy claiming the protection is contractual.
- [ ] **Three copy fixes before a white-label ad runs.** Word swaps.
  1. Bare "nothing monthly" → "the partner program itself carries no repeating
     charge". There IS a live monthly menu ($297, $2,497, lead flow).
  2. Wherever the ten-clients-a-month floor appears, add the penalty: warning,
     cure window, share drops 50% → 20%.
  3. `PAPER-PROMISE-VS-RULE-LONG` and `NOT-A-COURSE-LONG`: "in their agreement"
     → "on their site".
- [ ] **Seed the initial partner row** — the partners table is empty.
- [ ] Re-run copy stage 4 for Andromeda if the 24 scripts are not replaced by
      tomorrow's shoot. The workflow is already fixed and gates on 15 distinct
      reasons.

---

# VERIFIED WORKING — do not re-fix

Re-checked 2026-08-31 against main at `3b475761`, 161 commits past the 8/29
audit. Three of its four findings were already closed:

- **CC stacking** — approved-dollar-amount inputs exist in three places
  (`65bcaf36`, `11f73101`, PR #294). Billing can fire. Fee basis moved to
  confirmed approvals on 2026-08-30 (`src/funding/success-fee.mjs`).
- **UnderwriteIQ deliverables** — letters persisted (`2dc54e60`), email no longer
  claims attachments it cannot have.
- **Uploads** — `api/documents-download.mjs` mints a fresh link for a saved file,
  staff and owning client, both screens wired.

Also live: message dispatcher on cron, `public/funnel-checkout` routed,
`PARTNER_ENTRY` purchasable.

---

# AFTER FRIDAY

- [ ] **No email follow-up.** 23 of 24 email pieces failed review. Anyone who
      books and does not buy has nothing catching them.
- [ ] **Mailgun bank-inbox → Netlify.** PAUSED, blocked on an unpaid Mailgun
      balance. Route moved, `MAILGUN_SIGNING_KEY` set. After paying: prove one
      forwarded email lands in the CRM, then document the closer latch and
      keyword sorter in `docs/sops/`.
- [ ] **Plaid API key** and environment secrets.
- [ ] **Re-extract `$100M Offers`** — the PDF truncated before the guarantees
      chapter, which is why the first offer run produced one vague guarantee.
- [ ] **Meta Ad Library API access** — may not help, since Meta's docs say non-EU
      ads only return if political. Competitor research already works through
      `r.jina.ai`.
- [ ] **ST-07 Effective permissions** — copy only, role rules live in server code.
- [ ] **Repair system + education** from `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md`.
      **COMPLIANCE REVIEW REQUIRED** before any live letter uses it.
- [ ] UX pass across the Finance OS screens, mobile and tablet included.
- [ ] **Repo hygiene.** 21 agent worktrees, 37 stashes, stranded `vc/save-*`
      branches. Chris raised it and said plainly he was not asking for action.
      After Friday, never during — the commands that clean it are the ones that
      eat another session's uncommitted work.

---

## Where the flywheel output lives

| Stage | File |
|---|---|
| Avatar | `marketing/flywheel/partner/01-avatar.md` |
| Ad research | `marketing/flywheel/partner/02-ad-research.md` |
| Offer | `marketing/flywheel/partner/03-offer.md` |
| Copy | `marketing/flywheel/partner/04-copy.md` |
| Ad strategy | `marketing/flywheel/partner/05-ad-strategy.md` |

`npm run flywheel:status partner`. All of it is white label, and all of it is on
branch `feat/flywheel-runner` until #321 merges.

## Chris — owed to the 2026-09-03 fix batch
- [ ] Real contract text for each agreement (Funding Mastery, FUNDING-AGREEMENT, CREDIT-REPAIR-AGREEMENT; decide whether Capital Blueprint needs one). It may already be in the repo — W3 will search and tell you. See ops/workflows/fix-batch-2026-09-03.md W3.
- [ ] Tell W7 the exact AI setter symptom (call not placed / silent / hangs up / ignores prompt).
- [ ] Tell W4 whether the dispute-letter consent belongs on every client's portal or only repair clients (F35).
- [ ] Turn off the Gmail "FS Auto" filter before the re-walk (F17).
- [ ] Accountability upsell — Chris's idea 2026-09-03, note only. Revisit after the fix batch and fulfillment. See manual-walkthrough-2026-09-03.md.

---

## UI — Client Control Panel, owner-set 2026-09-06

From Chris walking Walk1 Funding live.

### 1. The headline slot is answering the wrong question — move it or cut it

The biggest text on the page reads "Nothing waiting on this file. No bank yes on this
file carries a dollar amount yet." Directly beneath it sits ACTIVE BLOCKERS 5.

Both are true. They answer different questions. That slot is counting **bank answers
that still need a dollar amount typed in** — a bookkeeping counter — while looking like
the file's status. `public/app/client-control-panel.html:3031`.

**Chris: "This English here needs to go."** Delete it from the headline. If the count is
still wanted, it belongs beside the bank rows it describes, not at the top of the file.

### 2. The caveat sentence is not English

> "Counts bank answers we have been told about. Applications still out with a bank are
> not recorded anywhere, so they cannot be counted here."

`client-control-panel.html:680`. The comment above it (lines 674-679) explains why it
exists: nothing records an application at the moment somebody applies, so the count can
only cover answers already received. That reasoning is sound and the sentence is not how
a person talks. Rewrite or delete with the headline.

### 3. Three colours only, and they mean one thing each — owner-set

Operations screens use **green, yellow, red**. Nothing else. Chris: "all this orange and
yellow shit on the side of it needs to be green... hella confusing."

| Colour | Meaning |
|---|---|
| **Green** | Go. Nothing stopping this. |
| **Yellow** | A blocker. Somebody has to do something. |
| **Red** | Hard stop. Something is wrong with the file itself — a negative item on the credit report, for example. |

The five blocker cards currently carry orange/yellow left borders. Those are ordinary
open tasks on a clean file, so they are **green**. Applies across every operations
screen, not just this panel. `docs/rules/UI-STANDARDS.md` is the home for the rule.

### Also found on the same walk (not UI — data and wiring)

- Next action says "Apply for Funding", the record says "Collect Documents". The screen
  prints a paragraph explaining the disagreement instead of resolving it.
- Open Inquiries reads **1**. The credit file has **4** (Capital One, SYNCB/PayPal,
  Navy Federal, Citibank).
- `inquiry_log` is **empty** for this client. The lender matcher builds its avoid-list
  from that table, so bureau avoidance has nothing to work with.
- **Income (Experian) $37,000/yr is not a bureau figure.** The stored credit file
  contains no income data at all. It is an estimate labelled as an Experian fact.
  `client-control-panel.html:1956-1958` reads `income_estimates`.
- The lender list shows **no bureau and no ranking** and is still alphabetical, though
  bureau data for 46 banks and rankings for 37 shipped on 2026-09-05 (PR #337).

### 4. The Apply button cannot open a bank page — CHRIS ONLY

Clicking Apply returns "Could not start Apply proxy. Oxylabs rejected the proxy login
(407)." The bank page never opens, and the dialog correctly warns not to apply from a
normal connection because the bank would see the wrong location.

**The error's advice is wrong.** It says the username is "the account id without the
customer- prefix". Checked 2026-09-06: the stored `OXYLABS_USERNAME` has no such prefix
and is already in the documented shape. So the credential is dead or expired, not
misformatted, and anyone following that hint will change nothing and conclude the code
is broken.

Two things:
1. Chris logs into Oxylabs → Residential Proxies → user credentials, and the real
   `OXYLABS_USERNAME` / `OXYLABS_PASSWORD` get set. Nobody else can reach that dashboard
   (`ops/STILL-MISSING.md:19`).
2. Rewrite that error so it reports what actually happened — the proxy refused the
   login — instead of naming a formatting fix that does not apply.

### Working correctly, do not re-test

- **The lender match narrows properly.** "18 fit" for an Arizona client, down from 313.
- The play dropdown on each bank row works: Card stacking first pull, In-branch visit,
  Online only, Docs first.
- All five tasks, the funding round, the sale and the payment are correct on screen.

### 5. The bank list looks like a spreadsheet, not a product — owner-set 2026-09-06

Chris walking Walk1 Funding: "There's no bank logo, the Apply button is massive, what's
play name." The FUNDING · APPLY DOOR section of `public/app/client-control-panel.html`.

**Confirmed hierarchy, for anyone touching this:** the Client Control Panel IS the main
file. Repair and Inquiry are sub-desks reached from it. Chris's read was right.

**a. The logos exist and this screen was never given them.** 244 PNG files sit in
`public/assets/lenders/`, and 21 wrong ones were corrected on 2026-09-05. But
`src/lenders/match.mjs` does not return `logo_path` in a match row, so the panel cannot
draw one. One field on the match payload, then render it beside the bank name.

**b. The Apply button is the widest thing on the row.** Bank name gets about 90 pixels
and wraps onto two lines ("Bank of / America", "Comerica / Bank"); Apply stretches the
remaining width. Invert it: the bank name and its logo lead, Apply is a normal button.

**c. "Play name" means nothing to anyone.** It records which tactic was used — the
dropdown offers Card stacking first pull, In-branch visit, Online only, Docs first.
Call it what it is. "How did you apply?" or "Approach".

**d. "No URL" is shown where an Apply button would be**, with no explanation. Those banks
take applications in branch or by phone. Say that instead of showing an absence.

### 6. The Specialist screen has no empty state

`public/app/inquiry-remover.html`, Repair tab. With zero rows it spins on "reading the
repair queue..." forever, every tile reading "—". Measured 2026-09-06: there are genuinely
0 dispute cases, so the queue is correctly empty — but an empty queue is indistinguishable
from a broken page, and Chris reasonably read it as broken.

Say "Nothing in the repair queue" and stop the spinner.

### 7. Delete the Generate Apps button — OWNER-SET 2026-09-06

Chris: "I don't think we're gonna need a Generate Apps button. That doesn't make any
fucking sense. Just delete that."

It creates nothing. Pressing it re-reads the lender match list, redraws the same rows,
and prints "apps ready — use Apply on each lender". An application record is only ever
created when somebody presses Bank yes or Bank no on a single lender row
(`src/applications/status.mjs`, `logBankDecision`). So the button promises an action it
does not perform, which is exactly why it reads as nonsense.

Remove the control from `public/app/client-control-panel.html`. The lender list already
loads on page open. Nothing downstream depends on the button.

This also closes the open question from the 2026-09-03 walk — "Should Generate Apps
create application rows?" The answer is no, and the button goes.

### 8. Open Inquiries shows the wrong number, and it changes on its own

Same file, same session, 2026-09-06:

| Time | Open Inquiries | Inquiry Removal |
|---|---|---|
| 3:39 AM | **1** | Blocked |
| 3:51 AM | **0** | Queued |

The credit file has **4**: Capital One (EX), SYNCB/PayPal (EX), Navy Federal (TU),
Citibank (EQ). Neither 1 nor 0 is right, nothing was done to the file between those two
readings, and the Inquiry Removal state moved from Blocked to Queued on its own.

Two things to find: what that tile is actually counting, and what changed the case state
with no human action.

### 9. Three funding numbers, and the client-facing one is 3x too big

Closer Dashboard for Walk1 Funding, 2026-09-06:

| Label | Shows |
|---|---|
| Conservative | $110,000 |
| Realistic · round 1 | **$636,000** |
| Personal + business stacked | **$636,000** |

The Client Control Panel shows **$212,000** for the same client, same moment.

**$636,000 is $212,000 × 3.** There is a `PERSONAL_LOAN_MULTIPLIER = 3.0` in
`vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js`. The closer screen runs
the card estimate through it and prints the result as the headline a closer reads aloud.
Chris: "Nobody gets 600K in funding."

The two right-hand columns are identical because business funding is correctly $0 — no
company on file, so nothing stacks. Two labels, one number.

**Owner-set replacement — three numbers, nothing else:**

```
Personal      what they get on their own credit
Business      what the company adds ($0 with no company on file)
Total         the two added together
```

One source feeding all three. No multiplier presented as a forecast, no "conservative /
realistic" bands. Same numbers must appear on the Client Control Panel and the Closer
Dashboard.

Note this is the F15 defect returning in a new place — a client with no business was
quoted ~$740,000 on 2026-09-03. `src/underwrite/business-funding.mjs` fixed the business
half correctly; the personal half is now the one that is wrong.

2026-10-04: a second likely source of the 3x. `src/underwrite/vendor/underwriter.cjs` applies the 5.5x card multiplier on each clean bureau and adds all three bureaus together. The "Conservative $110,000" above is exactly one bureau ($20K x 5.5), which is Chris's own math. See the UnderwriteIQ check under Now — 2026-10-04.

### 10. No business means no business credit cards — OWNER-SET 2026-09-06

Chris: "When there's only personal funding qualified, they only get personal funding
banks. No business, no business credit cards. Duh."

Nothing in `src/lenders/match.mjs` checks this. Walk1 Funding has **no businesses on
file** and matched **18 business credit cards**.

Worse: all 313 rows in the book are business cards (`InBranchBizCC` 196, `OnlineBizCC`
117). `PersonalCC`, `PersonalLoans`, `PersonalLOC`, `BizLOC_Stated` and
`BizLOC_Documented` are **0 rows each**. So under this rule a personal-only client
currently matches nothing at all.

### 11. The personal card data is already in the repo and was filed under the wrong table

Corrected 2026-09-06. These pages exist in `credentials/notion-scrape/output/`:

```
alec-s-favorite-personal-cards--26a2ec40
high-limit-personal-cards--9cafa36e
best-balance-transfer-cards--f9e698f9
personal-loans--677b0a52
balance-transfers--6aaef26e
```

`LENDERS-REVIEW.md` shows the extractor read them and merged them into **business** rows
as hub enrichment — "High limit personal cards" and "Alec's favorite personal cards" are
listed as sources that enriched American Express, Chase and Capital One's business
entries. The personal cards became notes on business rows instead of `PersonalCC` rows.

Re-extract those five pages into the correct `lender_table` values. The bureau data for
them is already available: the inquiry database carries Navy Federal, Discover, Ally and
hundreds of other personal creditors.

### Not a bug — do not chase

**SMS is off on purpose (owner-set 2026-09-06).** Three texts sit at `attempts=0` and
will never send. Chris: "we turned off the text messages." Email delivers normally. The
portal sign-in link is email, not text.

### 12. Client portal copy — owner-set 2026-09-06

**a. "SALES CONVERSATION" comes off.** Chris: "replace w something less aggressive."
It labels the "Want more funding?" card on the client's own portal. The card itself is
fine — 20 minutes on what a bigger approval would take. The label announces the pitch.

Suggested: **"Talk it through"**, or drop the label and let the card speak. The body copy
already says what it is.

**b. "questions? text us anytime" is in the portal footer and texting is OFF.**
Owner-set 2026-09-06: outbound SMS is disabled. Inbound is built and never replies — a
text lands as an event and sits in Messaging until a human opens it. So the portal
invites every client to text and nothing answers.

Either cut the line, or build the inbound auto-reply (see below). Not both ways.

**c. "YOUR FUNDING ADVISOR — Not assigned yet"** on every client. Nothing in the system
writes an advisor assignment, so this never fills in. The copy underneath is honest about
it, which is the right call for now, but the assignment itself does not exist.

### 13. Inbound texts arrive and nobody answers

`src/adapters/twilio.mjs` handles inbound SMS properly — signature verified, turned into
a `message.inbound` event, threaded into the client's conversation, media URLs carried so
photos come through. Then it sits until a human opens Messaging.

There is no reply of any kind. A client who texts gets silence.

**The fix does not touch the outbound queue Chris turned off.** Twilio accepts a reply in
the webhook response itself and sends it directly. The same file already does this for
voice calls (`VOICE_ANSWER_TWIML`), so it is the identical pattern one level down.

Needs: a short acknowledgement pointing at the right place, plus STOP and HELP branches,
which carriers require regardless. Wording is Chris's call.

### 14. Assign advisors, and fill a pod to capacity

Chris, 2026-09-06: "We need to assign advisors. We basically fill up a role to capacity,
which we track through KPIs."

**Nothing exists.** `pod_assigned` and `pod_name` are fields on the client record and
nothing ever writes them. There is no capacity column anywhere — `src/hiring/booking.mjs:323`
says so outright: *"NO SEAT LIMIT IS ENFORCED, and none is invented."* Every client sees
"YOUR FUNDING ADVISOR — Not assigned yet" and always will.

**The capacity rule is already locked** and does not need re-deciding. From
`ops/workflows/archive/fundhub-conveyor-kpis-2026-08-23.md` §3, owner-set 2026-08-24:

| Seat | Bar | Time-max if they do nothing else |
|---|---|---|
| Closer | **27 deposits / month per pod** | ~213 calls (160h) |
| Funding advisor | **27 funded files / month per pod** | ~54 files; half a desk = 27 |
| Inquiry remover | file clock only — healthy ~15 days, hard stop 30 | **no monthly count. Do not invent one.** |
| Credit repair | same clock | **no monthly count. Do not invent one.** |

**One pod = one closer + one funding advisor.** Company bar = 27 × complete pods.

**So the rule for assignment:** a new funding client goes to the pod with room under 27
funded files this month. No pod with room is the hire signal, and the same doc says which
half to hire — uneven seats, hire the missing half; packed calendar, hire a full pod.

Build order per CLAUDE.md §3a: pods and assignment in the schema first, a read endpoint
that proves the count, then the screen. The client portal advisor line is the last thing
to change, not the first.

---

## Walk findings, 30 agents, 2026-09-06

Every item below was found by one agent and reproduced by a second before it was written
down. Ordered by what costs the most.

### THE CUSTOMER'S SCREEN IS THE WORST OF IT

**15. "See exactly where your file stands" is a dead page.** The main link on the client
portal opens three lines: the header, a back link, and *"We could not load your file just
now. Please refresh in a moment."* Refreshing never helps. This is the customer's primary
"where am I" link.

**16. The customer never sees her $212,000.** Your screens show it. Hers shows no funding
number anywhere — just "Your funding file is open." The number is in the page's own data
and is never drawn.

**17. The Activity tab tells the customer her history is broken.** *"We could not load
your activity just now."* Permanent.

**18. The portal tries to sell her a $32 credit pull she has already had** — and the card
sits a few inches below the three scores that pull produced.

**19. "Yours to keep, always downloadable" has nothing to download.** The Funding Snapshot
reads "ask your advisor in chat for a copy". No link, no button, and the advisor line on
the same page says nobody is assigned.

**20. Two document requests went out and the portal never says which document is missing.**
Two generic upload boxes and a dropdown of every possible type. The page has a slot built
for naming the missing document and nothing fills it.

### MONEY AND STATE DISAGREE ACROSS SCREENS

**21. The Sales board never marks this client won.** $3,000 is paid and the sale is
active. "Closed Won (deposit)" reads **0** and the card sits in "Decision Rendered".

**22. Finance OS cannot open a client at all.** Clicking it in the sidebar always lands on
a blank "Not connected" page. There is no dropdown, no search, no client list — zero
clickable elements. The $3,000 sale, the paid link and the fee appear nowhere on it.

**23. The $212,000 funding estimate is printed on the Inquiry Removal board** as the
column and board total, as though it were inquiry-removal money. Every card on every board
carries the same number.

**24. Two screens count inquiries differently under the same label.** The closer screen
says 4 — real bureau inquiries, correct. The Client Control Panel says 1 — it is counting
something inside one removal case. Neither screen says which it means.

**25. "Derogatories: —" on a clean file.** The system knows the answer is zero. The
summary looks for a field named `derogatories` in the raw bureau data, does not find that
exact name, and prints unknown. On a call where a clean file is the whole pitch, the
screen refuses to say it is clean.

### THE PIPELINE AND THE CALENDAR

**26. The pipeline card shows no credit scores.** 771 / 778 / 766 are on the page's data
and the panel prints "They said —" instead. It does print the invented $37,000 income.

**27. The calendar can only ever show 2 of the 5 tasks.** The other three were created
with no date, and this screen only draws dated work. They are permanently invisible here.

**28. Nothing on the calendar can tick a task off or claim it.** All five tasks have
nobody attached, every row says "unclaimed", and there is no control to change either.

**29. "LEFT TODAY" is not today.** It shows whichever day you clicked. "NO-SHOW" and
"SHOW RATE" are hardcoded dashes and take two of the five tiles in the best spot on the
page.

**30. "ON SHIFT · 370H 28M"** on the closer dashboard. That is 15 and a half days. It
counts from 22 August and never resets.

**31. The "Held only" filter wipes every board, every time**, while the summary directly
above it says the held count is unknown.

**32. "Up next" is not clickable.** The next booked call is plain text with no link, so
between calls you have to navigate back through Pipeline.

### THINGS THAT ARE INVISIBLE RATHER THAN BROKEN

**33. Two Quick Launch buttons are hidden from everyone, owner included.** "Open Closer
Deck" and "Open Credit Snapshot" are in the page with `display:none` written by the shared
menu script, because `present.html` is not on the allowed-screens list for any role. The
page itself loads fine if you type the address. Open Credit Snapshot is the button that
would reach the credit detail missing everywhere else.

**34. Every desk action reports its result under the wrong button.** Generate Apps, and
all three Pull buttons, print their message underneath "Issue Inquiry Removal" — so
pressing Generate Apps looks like the inquiry removal ran.

**35. "NEED ACTION" lists the same client three times** and all three rows link back to
the page you are already on.

## Walkthrough 4 — 2026-09-06 — 28 confirmed defects where the code contradicts a rule the repo states

Detail, rules, and code lines for every item: `ops/workflows/walkthrough-4-2026-09-06.md`.

- [ ] **high** — Credit-score bars on the client-facing deck are coloured by bureau, not by score — Experian's bar is always the red one (`public/app/present.js:350`)
- [ ] **high** — The two contracts stamped "DO NOT SEND THIS" are one click away from a real client (`src/contracts/send.mjs:312-400`)
- [ ] **high** — The affiliate terms page tells partners they earn nothing on the 10% success fee — the opposite of the owner's decision (`public/app/affiliate.html:421`)
- [ ] **high** — Galaxy invents funded/deposit dollars and prints them over real staff names — the owner's "no invented money" ruling was applied to partner-galaxy.html only (`public/app/galaxy.html:626-651`)
- [ ] **high** — A client's portal Payments tab always says "No payments yet" — it is never painted for a client, and the invoice the server now returns is read by nothing (`public/app/client-portal.html:843-852`)
- [ ] **high** — Brand Studio tells a partner their SSL certificate is issued automatically, and stamps "Verified · SSL issued" — nothing issues any certificate (`public/app/brand-studio.html:673`)
- [ ] **high** — Four wide-open public endpoints are documented as "NOT open" and signature-checked (`Detector:`)
- [ ] **high** — Journey pages overstate who can reach three staff endpoints, because the generator only recognises a role list whose name ends in ROLES (`Cause:`)
- [ ] **high** — The browser check that blocks every merge secretly drives the real fundhub.ai site (`playwright.config.mjs:110-111`)
- [ ] **high** — A leftover debugging beacon is live in production, and the guard that promises this is impossible cannot see it (`api/social/oauth.mjs:110-132`)
- [ ] **high** — Two screens print the word "Fundhub" where the standard says the brand logo goes (`public/app/pipeline.html:667`)
- [ ] **medium** — On Social Studio a post that failed and an account whose sign-in has died both paint peach, and the same screen paints that same dead account coral one panel over (`public/app/social-studio.html:859`)
- [ ] **medium** — Affiliate terms promise last-touch attribution with a 60-day window; the system is first-touch, forever (`public/app/affiliate.html:420`)
- [ ] **medium** — Times on staff screens are drawn in the viewer's own clock while the topbar beside them claims Arizona (`public/app/closer-call.js:47`)
- [ ] **medium** — The Journeys simulator reports "Messages sent 4 · Everything went to <your phone>" while sending nothing anywhere (`public/app/journeys.html:830-885`)
- [ ] **medium** — The Documents screen states in capitals that age counts from the last state change; it counts from the day the document was generated (`public/app/documents.html:730`)
- [ ] **medium** — The contract signing page tells the signer they can come back to the link "at any time"; the link stops working 30 days after it was sent (`src/contracts/signed-link.mjs:39`)
- [ ] **medium** — A client's portal Messages tab always says "No messages yet", because the painter only runs for staff (`public/app/client-portal.html:881`)
- [ ] **medium** — The Decline Autopsy journey draws three live routes; all three are commented out of the router and 404 (`netlify/functions/api.mjs:700-709`)
- [ ] **medium** — Two signed, expiring links are printed on every journey page as "genuinely open" and lumped in with the login and health-check routes (`Cause:`)
- [ ] **medium** — The screen-frame guard misses the short way of writing a text size, so the pipeline drawer buttons are the wrong size on its own reference screen (`src/ui/screen-standard.test.mjs:96`)
- [ ] **medium** — The guard against a test permanently repointing live message routing excuses the offence using the offence itself (`src/messaging/routing-restore.guard.test.mjs:81`)
- [ ] **medium** — CLAUDE.md still says outbound calls may only live in the messaging providers folder, but the enforced design puts them all in src/lib/ (`src/lib/outbound-fetch.mjs:1-3`)
- [ ] **medium** — Pipeline shows a "— held" figure that can never be a number (`public/app/pipeline.html:728`)
- [ ] **medium** — The sales presentation deck sets seven text sizes below the standard's floor, including the legal small print (`public/app/present.html:28`)
- [ ] **medium** — Pipeline and Specialist top bars are missing all three rules that stop them overflowing (`public/app/pipeline.html:46`)
- [ ] **low** — A caption tells the owner to read a colour, which the standards file forbids in copy (`public/app/campaign-manager.html:386`)
- [ ] **low** — The client portal writes its own card shadow instead of using the shared one (`public/app/client-portal.html:86`)

Also from the walk: Walk2 and Walk3 need enrolling by hand (Present deck, not the desk button); Walk1 has two duplicate tasks; 237 banks still have no bureau on file.

---

## Open items — 2026-09-23

- [ ] **SLO / marketing video Drive naming strategy.** Chris's system is `SLO Ad N Take M.mp4` (+ specials: Retargeting, Funding Roadmap, Portal Welcome, VSL). Need a written strategy doc + organizer script alignment so agents stop inventing LOCKED-AD / pipeline names. Reference: Riverside list (IMG_0448 email), `scripts/slo-ads-drive-organize.mjs`, `ops/workflows/slo-ads-drive-manifest-2026-09-23.md`.
- [ ] **Local AI models in Cursor.** Add/configure local models in Cursor settings (Ollama/LM Studio or whatever Chris uses); document steps in repo if there's a pattern.
