# Landing page conversion — why no sales on the $297 SLO offer

Date: 2026-09-28. Numbers pulled live from the production database
(`ad_metrics_daily`, `funnel_page_stats`) — not estimates.

---

## The short answer

Zero sales on $208 of spend is **normal**. The money did not buy enough people.

But two things in the numbers are not normal, and both cost real money:

1. **It costs $70 to show the ad to 1,000 people.** Normal is $10–$40. You are
   paying about double for the same eyeballs.
2. **Eight out of ten people who start the video quit before the quarter mark.**
   Meta's own rule for that: the opening line is the problem, not the ending.

---

## W1 — Meta (DONE)

Campaign `oPur: TOF-SLO: $297`, objective SALES. Ran 2 days: Sept 26–27.

| | |
|---|---|
| Spend | **$207.89** |
| People it was shown to (impressions) | 2,949 |
| Cost per 1,000 shows (CPM) | **$70.49** |
| Clicks (all kinds) | 183 |
| Video plays started | 1,872 |
| Still watching at the quarter mark | 320 — **17%** |
| Sales, leads, sign-ups Meta recorded | **0** |

### Per ad

| Ad | Spend | Shown to | CPM | Clicks | Plays | Still there at 25% |
|---|---|---|---|---|---|---|
| SLO4 | **$110.73** | 736 | **$150** | 42 | 546 | **7%** |
| SLO3 | $45.57 | 1,595 | **$29** | 70 | 876 | 19% |
| SLO1 | $31.84 | 457 | $70 | 67 | 314 | **32%** |
| SLO2 | $19.75 | 161 | $123 | 4 | 136 | 8% |

**SLO4 ate 53% of the budget at the worst price and the worst hold.**
**SLO3 is the cheapest reach. SLO1 holds people best.**

### Older campaign, for contrast
`oSched: VSL: Funding`, PAUSED. Aug 17–20, $86.86, 456 shows, 19 clicks, 0 sales.
Same story, smaller.

---

## W2 — ClickFunnels (DONE — and the data is missing)

**The nightly ClickFunnels sync has not recorded anything since 2026-09-22.**
That is four days *before* the ads started. So there is **no funnel data at all**
covering this spend. Nobody can say how many of the 183 clicks reached the page.

Why it stopped: the nightly job asks the database for active ClickFunnels
accounts using a plain connection. Row-level security hides the row from that
connection, so the job sees **zero accounts** and quietly does nothing. Measured
today: plain connection sees 0 rows, staff connection sees 1 active row.
`src/workflows/clickfunnels-analytics-sweeper.mjs:11`.

Last real numbers, from the manual Sept 22 pull (before any SLO ad ran):

| Page | Views | Conversions |
|---|---|---|
| VSL | 352 | 0 |
| Thank You | 228 | 0 |
| Funding Book Call | 140 | 46 |
| Apply | 127 | 326 |
| **$297 Roadmap Sales** | **27** | **0** |
| **$297 Roadmap Order** | **2** | 0 |
| $297 Roadmap Book | 0 | 0 |
| $297 Roadmap Thank You | 0 | 0 |

NOT A FINDING ABOUT THE ADS — this is all pre-campaign traffic.

---

## W4 — Tracking (PARTIAL)

- Meta connection is live and synced today at 07:02. Token stored, account
  `act_982103620742368`.
- Meta's own count of purchases, leads and sign-ups is **0** for every day.
  So the zero is real on Meta's side, not a reporting hole.
- **Blind spot:** we store `clicks` (all clicks — includes likes, expands and
  video taps) but we do **not** store link clicks or landing page views. So we
  cannot tell from our own data how many of the 183 clicks actually landed on
  the sales page. Pulling those two fields live from Meta was blocked by this
  session's safety classifier (it refused to decrypt the stored ad token).

---

## What the numbers say to do

1. **Turn SLO4 off.** It took half the budget at $150 per 1,000 shows and lost
   93% of viewers before the quarter mark.
2. **Rewrite the first line of SLO4 and SLO2. Keep the body.** Meta's rule:
   people leaving before 25% is an opening problem.
3. **Put the budget on SLO3 (cheapest reach) and SLO1 (best hold).**
4. **$208 is not a verdict.** Budget $1,500–$3,000 before judging the offer.
5. **Price is not the problem.** $297 is locked (`f441f41`) and correct for this
   buyer. Do not re-open it.

## Leftover — not fixed, not asked for

The ClickFunnels nightly sync is a no-op because of the row-level-security
scope. One leftover card, per the hard lock. Not touched.

---

# Campaign structure — what is there vs what it should be (2026-09-28)

Measured from the database, not assumed.

## What the media buyer built

```
Campaign: oPur: TOF-SLO: $297          objective = SALES (purchase)
  └─ Ad set: oPur: TOF-SLO: 25-55M: SBOs: 2.5M   (2.5M people, ACTIVE)
       ├─ oVid: SLO1   ├─ oVid: SLO2
       ├─ oVid: SLO3   └─ oVid: SLO4
```

One campaign. One ad set. Four videos. ~$100/day. Cold audience only.

This is the standard consolidated setup. It is the right shape for a big budget
with a pixel that has already seen hundreds of sales. It is the wrong shape for
a pixel that has seen **zero**.

## The three problems

**1. It asks Meta to find buyers using an example of zero.**
The ad set optimizes for Purchase. Meta needs **50 purchases in 7 days** to stop
guessing. At $297 that is about $15,000 a week in sales. At $100/day it will
never get there, so it guesses forever. That is exactly what "Learning Limited"
means. It is also why the worst ad (SLO4) ate 53% of the budget — with no sales
to learn from, there is nothing to steer by.

**2. Four videos is not enough any more.**
Meta's Andromeda algorithm (fully rolled out July 2025) rewards creative
*volume and variety*. The current bar is **15–20 genuinely different videos a
week**, or 50+ if repurposing. Four is 2024 thinking. And it has to be different
*reasons to buy*, not four ways of saying the same line. This is the most likely
single cause of the $70 CPM.

**3. Every impression is bought ice cold.**
Cold traffic is the most expensive traffic there is. There is no warm-audience
layer, so you pay top price for every single view.

## What it should look like

Three campaigns, not one. Same ~$100/day.

| Campaign | Optimizes for | Structure | Budget |
|---|---|---|---|
| **A. Content bin (cold)** | Engagement, then ThruPlay | 5–12 ad sets, **one video each**, same cold audience, ad-set budget optimization | $5–10/day per ad set |
| **B. Direct response (warm)** | Purchase | One ad set. Audience = anyone who watched 10 sec of a bin video or touched the FB/IG page, 365-day window | The rest |
| **C. Cyclic copies of B** | Initiate Checkout, then View Content / Landing Page View | Duplicate B, change only the event | Small |

**Why A works:** engagement costs about **$0.01** a person. You build a warm
list cheaply, and warm traffic has a far lower CPM than cold. That is the direct
fix for the $70 CPM.

**Why C works:** it is Haynes' fix for Learning Limited. Nobody buys 50 times a
week at $297, but plenty of people will hit checkout or land on the page. Those
cheaper events fire often enough to feed the algorithm real data, and the
purchase campaign gets smarter off the back of it.

**Content bin rule:** one video per ad set, all ad sets in one campaign, same
audience in every ad set. It is a spider web, not a sequence — let Meta pick
who sees what.

## Order of operations

1. **Film more videos.** 15–20 different angles, different reasons to buy. This
   is the number one lever and nothing else matters as much.
2. **Stand up Campaign A** with those videos. Cheap.
3. **Move direct response to the warm audience** once A has run 3–5 days.
4. **Add the cyclic copies** for the cheaper events.
5. **Then** spend $1,500–$3,000 and read the result.

## Not changing

- The $297 price. Locked (`f441f41`). Correct for this buyer.
- Nothing in the live account. This is a recommendation, not an action.

---

# Can we diagnose the problem at $1,000? (measured 2026-09-28)

**No. Two of the five steps are dark.**

| Step | Lives in | Working? |
|---|---|---|
| How many people saw the ad | Meta → our database | **Yes** |
| How many clicked the link / cost per page view | Meta Ads Manager | **Yes, but only in Ads Manager.** We do not store it. Paul can read it. |
| How many reached the sales page | ClickFunnels | **No** — frozen since 2026-09-22 |
| How many started checkout | ClickFunnels / pixel | **No** — same freeze |
| Which ad brought the person | our database (UTMs) | **No** — see below |

## What is actually in the database

- **3 new client records since the ads started** (Sept 26–28). The funnel is
  alive; people are arriving.
- **1 of those 3 has an ad-attribution row, and every UTM on it is NULL.**
  `lane = unknown`, `ad_id = NULL`, `utm_source/campaign/content/term` all NULL.
  Only `landing_path = /roadmap/` came through — so we know they hit the $297
  sales page, and nothing about which ad sent them.
- **`funnel_page_stats` last recorded 2026-09-22**, four days before the first
  SLO ad ran.

A pixel and a UTM are two different things. The pixel tells **Meta** what
happened. The UTM tells **us** which ad did it. The pixel side is Chris's call
and logged as fine. The UTM side is measurably empty: one row, all nulls.

## What $1,000 would and would not tell you

**Would:** which video holds attention (video curve already works), and the
top-line funnel shape *if Paul reads it out of Ads Manager by hand.*

**Would not:** whether people reach the page and bounce, or never reach it at
all. Those two have opposite fixes — one is a page problem, one is an ad
problem — and nothing recording today can tell them apart. It also cannot say
which ad produced a buyer, so "cut the losers" has no sales data to cut on.

## Verdict

At $1,000 you get a number with no explanation. The cheapest thing that changes
that is the ClickFunnels step data and the UTMs, not more spend.

**Not fixed. Not asked for. One leftover card, per the hard lock.**

## Owner correction (merged from branch 2026-09-28)

Chris confirmed the live site works and the pixels are set up. Repo-only teardown items
(no pixel in fragment files, `FH_SIM`, bare `/order` hrefs) describe the **repo copy** unless
someone re-checks live. Still open: ad id on the SLO order path and real proof cards on the
sales page.


## W4 — re-checked 2026-10-05 (W3 of `finish-builds-2026-10-05`)

Read only: the live page, the live database (SELECT only) and the repo. Nothing changed live.

### Ad id on the SLO order path — the order path is done; the ad's number never arrives

- **Done and live:** the ad's tags now ride from the ad to the order. The two real Meta clicks that started a $297 checkout both carry them in `client_ad_attribution`: 2026-10-01 19:50 UTC (`/roadmap/`, then `payment.failed`) and 2026-10-02 22:43 UTC (`/roadmap`). Both: `utm_source=fb_ad`, `utm_campaign=oPur: TOF-SLO: $297`, `utm_content=oVid: SLO2`, `utm_term=120253626444640264`, event `slo.checkout_started`. Code: the buy box sends `utm_*` and `api/public/slo-checkout.mjs` writes them on every checkout (2026-09-25). The 09-28 finding (all tags NULL, bare `/order` buttons) is gone: the live page has no `href="/order"`.
- **Still empty:** the database's own `ad_id` column is NULL on both rows. The live Meta ads put the ad's **name** in `utm_content` (`oVid: SLO2`), and the database only reads a leading **number** there (`db/migrations/286_client_ad_attribution.sql`, wire format owner-set 2026-09-03). `utm_term` holds the **ad set** id (`120253626444640264` = ad set `oPur: TOF-SLO: 25-55M: SBOs: 2.5M` in `ad_sets`), not the ad id. The four SLO ads have no Fundhub ad number (`v_ad_label_spine.fundhub_ad_number` NULL), so `api/read/ad-spine.mjs` cannot tie a buyer to an SLO ad.
- The ad *can* be found by hand: ad set `120253626444640264` + name `oVid: SLO2` = Meta ad `120253626574340264`.
- Closing it is a Chris call, either way (live ad change, or a new matching rule in our reports). Yes/no question on `ops/workflows/finish-builds-2026-10-05.md`.

### Real proof cards on the sales page — the empty cards are gone; the approval cards were cut on purpose

- Live https://apply.fundhub.ai/roadmap (fetched 2026-10-05): no `CLIENT RESULT` placeholder, no "Sample data" bar, no `FH_SIM`. Three real video testimonials: Colin Schmidt, Gene, Sarah.
- No approval cards on the page. The approvals deck was cut when Chris pushed the shorter page on 2026-10-01 (`marketing/ads/roadmap-page-changes.md`, row 2026-10-01: "Cut: … Approvals"). Only its leftover CSS is still in the page.
- The 40 real, branded approval crops exist: `marketing/landing-pages/slo/client-wins/deck/win-*.png`, provenance in `approvals-manifest.json`. Putting them back on the page is a Chris call (yes/no on the finish-builds board). If yes, it goes through a marked draft first.
- Note: `TODO.md` "Checked 10/4 … Proof cards are on /roadmap" is true only of the three testimonials, not of approval cards.

**W4 status:** done for everything that needs no owner call. Two yes/no questions left.
