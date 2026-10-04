# Roadmap marketing — every day, pulled 2026-10-04

Pulled 2026-10-04, about 3:15pm Pacific. Days are UTC.

The raw rows are in `ops/workflows/roadmap-marketing-2026-10-04.json`. No names, no emails, no card data.

## The answer

The $297 ads have spent **$877.63** since September 26. Meta recorded **0 sales**. Our own checkout recorded **0 paid orders**.

The money is not failing to reach the page. It is landing, and then almost nobody presses buy.

Two facts drive that:

1. **SLO2 took $498 of the $878.** On its biggest day, only 22% of plays were still going at 5 seconds. Meta’s rule for that: the opening line is the problem.
2. **On the page, 2 real people pressed the buy step** between October 1 and this afternoon. **0 paid.**

The $147 price (old $297 crossed out) went live at 3:07pm Pacific today. It is not in these results. Every checkout row below is still $297.

## Where the numbers came from

| Source | What it is | How fresh |
|---|---|---|
| Meta ads | Spend, shows, taps, and how far the video played, one row per ad per day | Refreshed today. Morning job also ran at 7:02am. Today is a partial day. |
| Our page tracker | Every real click, scroll, and video mark on /roadmap | Starts October 1. October 1 is missing the funnel name, so that day is counted from the page address. |
| The sales video on the page | How far a person got in the on-page video | From September 26. |
| ClickFunnels | Views, opt-ins, and sales on each funnel step | Fresh 90-day total, pulled today. ClickFunnels does not give one row per day. The nightly job had not written since September 22. |
| Clarity | Last 3 days, split by page, source, and phone vs computer | One pull today. |
| Checkout rows | $297 orders we created | Through today. None are marked paid. |

A tap in Meta is every tap: the video, a like, or the link. It is not “a person opened the page.” The page tracker is the count of people who actually opened it.

## The ads

One live campaign: `oPur: TOF-SLO: $297`. Budget about $100 a day. Four videos. Cold audience. Optimizing for a purchase. Meta has **0 purchases** to learn from, so it keeps spending on the video that does not hold.

An older paused campaign, `oSched: VSL: Funding` (August 17–20), spent **$86.86** for 456 shows and 19 taps. Also 0 sales. It is not this page’s campaign. It is here so the $878 is not mixed with it.

### Totals, September 26 through this afternoon

| Ad | Spent | Shown | Cost per 1,000 shows | Taps | Plays | Still watching at 25% of the video | Halfway | Three quarters | Finished | ThruPlay (15s or the end) | Sales |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SLO1 | $57.30 | 658 | $87.08 | 85 | 479 | 133 (27.8%) | 51 | 17 | 12 | 125 | 0 |
| SLO2 | $498.01 | 2,138 | $232.93 | 106 | 1,958 | 195 (10.0%) | 93 | 69 | 42 | 201 | 0 |
| SLO3 | $103.82 | 2,209 | $47.00 | 114 | 1,389 | 240 (17.3%) | 132 | 54 | 30 | 223 | 0 |
| SLO4 | $218.50 | 1,119 | $195.26 | 63 | 877 | 64 (7.3%) | 29 | 20 | 12 | 67 | 0 |
| **All four** | **$877.63** | **6,124** | **$143.31** | **368** | **4,703** | **632 (13.4%)** | | | | | **0** |

SLO2 is 57% of the spend and the worst hold of the two ads that got real money. SLO4 is the other expensive one (7.3% still there at the quarter). SLO3 is the cheap reach. SLO1 holds the best (27.8%) and has been starved since September 28.

Cost per 1,000 shows of $143 is far above a normal cold video ($10–$40). SLO2 alone is $233. SLO3 is $47, the only one near a normal price.

### Every day

| Day | SLO1 | SLO2 | SLO3 | SLO4 | Plays | Still at 25% |
|---|---:|---:|---:|---:|---:|---:|
| Sep 26 | $23.65 | $10.81 | $22.95 | $39.20 | 1,199 | 168 |
| Sep 27 | $8.19 | $8.94 | $22.85 | $71.63 | 675 | 152 |
| Sep 28 | $3.21 | $16.32 | $18.77 | $62.41 | 445 | 36 |
| Sep 29 | $6.66 | $26.32 | $21.77 | $27.99 | 399 | 62 |
| Sep 30 | $5.31 | $61.34 | $2.78 | $8.82 | 268 | 38 |
| Oct 1 | $2.35 | $123.33 | $3.81 | $1.84 | 565 | 50 |
| Oct 2 | $6.26 | $85.41 | $4.93 | $2.25 | 445 | 57 |
| Oct 3 | $0.95 | $89.53 | $3.09 | $1.61 | 445 | 43 |
| Oct 4 (partial) | $0.72 | $76.01 | $2.87 | $2.75 | 262 | 26 |

From September 30 on, SLO2 is the campaign. The other three are getting pocket change. October 1 was the worst day: $123 on SLO2, and only 50 plays out of 565 reached the quarter of the video.

### Second by second

Meta’s curve is “of the people who pressed play, what percent are still there at this second.” These are the biggest play-days for each ad.

SLO2 on October 1 (504 plays, the day it spent $123):

| Second | 0 | 1 | 2 | 3 | 4 | 5 | 10 | 14 | 15–20s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Still watching | 100% | 71% | 46% | 36% | 28% | 22% | 13% | 10% | 6% |

More than half are gone by 2 seconds. About 4 out of 5 are gone by 5 seconds.

SLO4 on September 26 (339 plays): 46% left at 2 seconds, 20% at 5 seconds, 7% at 14 seconds.

SLO3 on September 26 (506 plays): 39% left at 2 seconds, 16% at 5 seconds. It dies early too, but each show is cheap.

SLO1 on September 26 (281 plays): 67% left at 2 seconds, 46% at 5 seconds, 33% at 14 seconds. This is the only opening that holds.

The 2-second count column in our database was blank for these days (not zero). The curve above is the real second-by-second. There is no separate 3-second field.

## The page

Our own tracker. Real people only. Bots and our own test browsers are left out. October 1 through this afternoon.

### Who opened /roadmap, by ad

Some links arrived with the ad name encoded (`oVid%3A+SLO2`). Those are the same ads. They are added in.

| Who sent them | People | Scrolled a quarter down the page | Pressed play on the page video | Reached 25% of that video | Pressed the buy step | Paid |
|---|---:|---:|---:|---:|---:|---:|
| SLO2 | 67 | 19 | 29 | 12 | 1 | 0 |
| No ad tag | 27 | 9 | 6 | 1 | 1 | 0 |
| SLO1 | 21 | 3 | 11 | 0 | 0 | 0 |
| SLO3 | 10 | 1 | 0 | 0 | 0 | 0 |
| SLO4 | 9 | 3 | 2 | 1 | 0 | 0 |
| Ad, no video name | 1 | 0 | 1 | 1 | 0 | 0 |

One extra visit was our own audit tag. It is not in the table.

135 real people are in that table. One more visit was our own audit, so 136 opened the page. 108 of the 135 came from an ad. **2 pressed the buy step. 0 paid. 0 booked a call.**

SLO2 is also the page. 67 of the ad visits are SLO2. One of those pressed buy.

### What they did on the page, by day

A session is one person’s visit. “Saw the sales page” can be lower than sessions when the same person also hit the booking page under a new session.

| Day | People | Saw the sales page | Scrolled 25% | Scrolled to the bottom | Played the video | Turned sound on | Video 25% | Video halfway | Pressed buy | Saw the booking page | Picked a time | Booked |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Oct 2 | 39 | 31 | 21 | 11 | 25 | 7 | 8 | 5 | 2 | 4 | 0 | 0 |
| Oct 3 | 25 | 22 | 9 | 4 | 16 | 6 | 5 | 4 | 0 | 0 | 0 | 0 |
| Oct 4 | 22 | 22 | 11 | 4 | 11 | 1 | 4 | 1 | 0 | 0 | 0 | 0 |

October 1 had 40 real people on /roadmap, but that day’s rows do not carry the step flags, so they are in the ad table above and not in this day table.

Time on the page, when we recorded it: about 66 seconds on October 2, 124 seconds on October 3, 69 seconds on October 4. That is the longest mark we stored, not a stopwatch on every second.

### How far down the page

Section counts are people, October 2–4 (the section marks start October 2).

| Section | People |
|---|---:|
| Top (hero) | 73 |
| Video | 48 |
| How it works | 36 |
| Testimonials | 30 |
| FAQ | 27 |
| Order box | 27 |
| Guarantee | 27 |
| The form | 23 |
| Footer | 20 |

About 1 in 3 people who hit the top also reached the order box. Reaching it is not the same as pressing buy.

### What they tapped

Real people, October 1 through today. A person can tap more than once.

| What they tapped | Taps | People |
|---|---:|---:|
| Something with no name | 33 | 11 |
| Turn the video sound on | 13 | 13 |
| Close a sample | 12 | 5 |
| See a sample (several cards) | 38 | up to 5 per card |
| “Get my $297 funding roadmap” (the buttons that jump down) | 3 | 3 |
| Sticky bar | 3 | 3 |
| Guarantee button | 2 | 2 |
| The form’s own “Get my funding roadmap” | 2 | 2 |
| Soft pull step | 1 | 1 |

The buttons that jump down the page got a few taps. The button that actually starts checkout got **2 people**. Nobody reached a card charge. There is no payment-attempt row and no failed-card row.

Sample previews were opened. They did not turn into a buy. The one SLO2 buyer-step press did not open a sample first.

### The video on the page

Separate from the ad. This is the video that plays on the sales page. Real people, page address contains roadmap but not the booking page or the thank-you page. Since September 26.

The file is about **1 minute 50 seconds** long (average length the player reported: 110 seconds).

| | Count |
|---|---:|
| Times the player showed up | 696 |
| Of those, never reported a single second watched | 612 |
| Reported a real position | 84 |
| Middle of those 84 | 12 seconds |
| Average of those 84 | 35 seconds |
| Reached a quarter of the video | 23 |
| Reached halfway | 13 |
| Reached three quarters | 12 |
| Turned the sound on | 18 |

Most “plays” are the player appearing. The people who actually started it quit around 12 seconds. That matches the ads: the opening is where they leave.

## Clarity — last 3 days

One export. Split by page, where they came from, and device. This is Microsoft’s own session count, not ours.

| Page | Source | Device | Sessions | Bots |
|---|---|---|---|---:|
| /roadmap | the ads (`fb_ad`) | Phone | 50 | 0 |
| /roadmap | not tagged | Phone | 13 | 1 |
| /roadmap/ | the ads | Phone | 11 | 0 |
| /roadmap | the ads | Computer | 4 | 0 |
| /roadmap-book | not tagged | Phone | 3 | 0 |
| /roadmap | the ads | Tablet | 2 | 0 |
| /roadmap/ | the ads | Tablet | 1 | 0 |

This is a phone page. The ads are the source.

On a phone, people got about **40% of the way down** /roadmap. On a computer it was about 57%, and almost nobody was on a computer.

Across those /roadmap sessions Clarity counted **17 dead clicks** (a tap that did nothing), **1 rage click**, **3 quick backs**, and **0 script errors**. The page is not throwing errors. People are not hammering a broken button. They are leaving.

Active time on /roadmap was 3,686 seconds across about 69 sessions. That is about **53 seconds of real attention** per session.

## ClickFunnels

ClickFunnels returns one total for the dates you ask for. It does not return a day-by-day list. This pull is the **last 90 days**, taken today. Sales here means a ClickFunnels sale. Our card form does not run through that, so a ClickFunnels sale of 0 was expected. Our own checkout, below, is the money.

| Page | Views | Unique people | Opt-ins | Sales | Sales dollars |
|---|---:|---:|---:|---:|---:|
| $297 Roadmap sales | 161 | 111 | 0 | 0 | $0 |
| $297 Roadmap book | 10 | 8 | 0 | 0 | $0 |
| $297 Roadmap thank-you | 6 | 6 | 0 | 0 | $0 |
| Old roadmap order step | 7 | 6 | 0 | 0 | $0 |

On September 22, a shorter pull (not the same 90 days) showed 27 views on the sales page, 2 on the old order step, and 0 on the book and thank-you pages. The nightly ClickFunnels job then wrote nothing until this pull. Those September 22 numbers are not “before the ads” in a clean way and they are not a daily trend.

The older watch / apply / book-a-call funnel is a different offer. It is not in the verdict above. Over the same 90 days that funnel’s watch page had 642 views and the apply page had 184 views. Neither recorded a ClickFunnels sale either.

## Checkout

Every $297 checkout row since September 1. Status “sent” means we opened a checkout. It does not mean they paid.

| Day | Rows | Amount | Status | Paid? |
|---|---:|---:|---|---|
| Sep 27 | 1 | $297 | sent | no |
| Sep 29 | 12 | $297 | sent | no |
| Oct 1 | 1 | $297 | sent | no |
| Oct 2 | 1 | $297 | sent | no |

**15 checkouts opened. $0 paid.** September 29 is the day the card form moved onto the page, which is why that day has 12 rows. None of them are marked paid.

Two client records carry an ad name. Both are SLO2 (October 1 and October 2). The other roadmap client records have no ad tag. The page tracker is the better ad count. The client file is mostly empty.

## What to change

The purchase is the score. It is zero. Watch time says where to film next.

1. **Change the first line of SLO2.** Same body. People are gone before 5 seconds, and that video is where the $100 a day is going. SLO4 has the same opening problem. Do not recut the ending first.
2. **SLO1 is the only opening that holds, and it is getting under a dollar a day.** SLO3 is the only cheap reach. The account is doing the opposite: it is buying the video people leave.
3. **The page is not the broken-button problem.** Phones, about 40% down the page, about a minute of attention, 2 people pressing buy, 0 paying. The ads are delivering visits. The visit is not becoming a card.

Do not read $878 as a verdict on the $297 price. There are not enough buys to judge a price. There are enough plays to judge the opening.
