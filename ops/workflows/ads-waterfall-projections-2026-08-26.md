# COMPLIANCE REVIEW REQUIRED

Internal money model. Fees, course finance payouts, and credit-score lanes. **Not buyer-facing.** Do not text payout percents to buyers.

# Ads + course-finance projections — band model, $200/day then $500/day

**Date:** 2026-08-26 (rebuilt same day; closer pay re-analyzed 2026-08-27)  
**For:** Chris  
**This file.** Does not replace the two source sheets. Those stay as-is.

**This is a model.** Assumptions are named. They are not live rates. That ad group still had **0** paid closes when the mix was built.

**Merged from**

- Who books (survey traffic): [`ads-revenue-model-2026-08-24.md`](ads-revenue-model-2026-08-24.md)
- Course payout order: [`../company-resources/course-finance-waterfall-2026-08-26.md`](../company-resources/course-finance-waterfall-2026-08-26.md)
- Live prices: `src/config/offers.mjs`
- Cash vs finance rules: [`../company-resources/closer-playbook-2026-08-24.md`](../company-resources/closer-playbook-2026-08-24.md)
- Closer room: 10 sits / day, packed at 90%. Deposit bar 27 / month. One funding advisor per 27 funded files. [`fundhub-conveyor-kpis-2026-08-23.md`](fundhub-conveyor-kpis-2026-08-23.md)
- Alec / Legacy Strong (reference only): [`alec-legacy-strong-kpis-reference-2026-08-23.md`](alec-legacy-strong-kpis-reference-2026-08-23.md) and `credentials/notion-scrape/output/LEGACY-STRONG-KPIS.md`

---

## Update 2026-10-31 — per 100 booked calls, with the slideshow sends and the back-end fee

Chris's numbers from the 2026-10-31 chat replace the older guesses below where they differ. Inputs:

- Cost per booked call: about **$30** (Chris; this file used $33). 100 booked calls = **$3,000** of ads.
- Show rate today: **70 to 75%** with the confirm step (Chris). Model uses 72%.
- Close rate: a high-ticket closer runs **40% to 60-70%**, set by lead quality and how well the lead is set (Chris). Model uses 40% today.
- Money per sale: Funding **$3,000** deposit up front plus **$10,000 to $15,000** on the back end per fundable client (Chris; model uses $12,500). Capital Blueprint **$5,000** default (`src/config/offers.mjs`). Credit optimization $1,000, or the $200 one-round downsell, is left out of the model.
- Assumed mix: half Funding, half Blueprint. Not measured.
- The closer gets 20% of the funding deposit (`.ai/rules/funding-deal-pay.md`), shown as its own line. If the $3,000 deposit is part of the back-end fee and not on top of it, subtract $3,000 per Funding sale.

| Case | Shows | Sales | Up front | Back end | Total | Up front per $1 of ads | Total per $1 of ads | Closer 20% of deposits |
|---|---|---|---|---|---|---|---|---|
| A — today (72% show, 40% close) | 72 | 28.8 | $115,200 | $180,000 | $295,200 | $38 | $98 | $8,640 |
| B — slideshows add 3 show and 5 close points (75%, 45%) | 75 | 33.8 | $135,000 | $210,938 | $345,938 | $45 | $115 | $10,125 |
| C — well set and prepped (75%, 60%) | 75 | 45 | $180,000 | $281,250 | $461,250 | $60 | $154 | $13,500 |

The slideshow sends (board `backend-selling-lanes-2026-10-30.md` 6e.2) move close rate more than show rate. The pixel learning from shows and payments (the Cortana item) moves the cost per booked call. Measure with the touch-point tracking item in `TODO.md`: close rate for leads who opened 2 or more slideshows against leads who opened none.

## Math check — what was wrong, what changed

The old version of this file used one **18%** close on every booked person, then multiplied the Aug 24 **buy mix** (3/17 funding, 5/17 Mastery, and so on). That shape had real errors.

| What | Old file | This rebuild |
|------|----------|--------------|
| Close rate | One **18%** on everyone (band 15–20%) | **Band × cash** rates. Company blend **31.4%**. Floor **30%**. High **35%**. Owner-set: typical is no less than 30%. **18% is dead.** |
| Who buys what | Survey mix treated as **who closes** | Survey is **who books**. Offer is picked **after** they close, by score + cash. |
| Half the books | 17 of 34 had no score. Old mix **ignored them.** | **No-score** is its own bucket (17/34). Cheap / conservative. |
| Course payout | One **72%** blend after the fact | Payout **per band** (85% / 80% / 68.5% / 62% / 42%) |
| Funded size for later 10% | Working **$75k** → later **$4,500** | Owner-set **$100k–$150k** → later **$7,000–$12,000**. Mid **$125k** → **$9,500**. |
| Cash now / close | **$1,931** (rich 17-person mix on every close) | **$1,361** (no-score + cheap lanes pull the average down) |
| Cash now per booked call | **$348** (18% × $1,931) | **$427** (31.4% × $1,361) |

**Old vs new dollars (same ads, same $33 / book)**

| | Old (18% + buy mix + 72% + $75k) | New (band model) |
|--|----------------------------------|------------------|
| $200/day cash now | **$63,300** (exact ~$63,200) | **$77,670** |
| $500/day cash now | **$158,200** (exact ~$158,000) | **$194,175** |
| $200 later if **all** funding clients fund | ~**$26,000** at $75k (they said 6 people) | **$56,150** at $100k / **$96,260** at $150k (**8.0** people) |
| $500 later if all fund | ~**$65,000** at $75k (~15 people) | **$140,370** at $100k / **$240,640** at $150k (**20.1** people) |
| Closers | 1 then 3 | **Still 1 then 3** (hire from weekday **books**, not closes) |

**Other real errors in the old file**

1. **Double-count.** The Aug 24 mix was “what they can pay,” not “who pays.” Putting 18% close **and** that mix on the same people counted the filter twice.
2. **Flat close.** A 750+ person with $5k+ was treated the same as a 500–579 person with under $1k.
3. **People vs dollars.** Example: 33 × 3/17 = **5.82** funding people, but the table said **6** people and **$17,500** (that dollar is 5.82 × $3,000, not 6 × $3,000). This file shows **exact and rounded**.
4. **$75k as the working fund size.** Owner override: average funded deal is **$100,000–$150,000**. $75k is only a thin compare row now.
5. **If we only raised close to 30% and kept the old buy mix**, $200 cash now would jump to ~**$105,000**. That would be wrong. The new **$77,670** is the honest band model (half the books have no score).

Rounding that was **fine**: $6,000 ÷ $33 = 181.8 books (they said 182). 182 ÷ 22 = 8.3 weekday books. 72% blend math was (2×85% + 4.5×75% + 3.5×62%) ÷ 10 ≈ 72.5%. The arithmetic on that old shape mostly held. The **shape** was the problem.

---

## Alec vs us (we undershoot)

We do **not** copy Alec’s shop as our number. We read what he actually wrote, then model **below** him.

| KPI | What Alec recorded | File | What we model |
|-----|--------------------|------|----------------|
| **Close rate** | **No percent.** “Track.” “No setter/closer numeric quotas … found in scrape.” | [`alec-legacy-strong-kpis-reference-2026-08-23.md`](alec-legacy-strong-kpis-reference-2026-08-23.md) §2; `credentials/notion-scrape/output/LEGACY-STRONG-KPIS.md` §2 and §7 | Owner floor **30%**. Working company blend **31%** (exact **31.4%**). High case **35%**. We do **not** invent “Alec is 40–50%.” |
| **Show rate** | **> 90%** ideal, **> 80%** fine | Same two files, sales-call table | **77%** company (band table). Below his “fine” line on purpose. |
| Cost per booked call | **< $100** good, **> $200** problem | Same | We use Chris/Paul **$33** (already under his good line). |
| Deposits | His spoken **20** was a first pass. Our lock is **27 / month** per closer pod. | [`fundhub-employee-ramp-from-alec-2026-08-24.md`](fundhub-employee-ramp-from-alec-2026-08-24.md); conveyor KPIs | 27 is a **win bar**, not a close rate and not a cap. |
| Funding $ per client | Coaches ~**$100k**; a 5-round picture ~$295k | Alec KPI reference §4 | Owner-set average **$100k–$150k**. We do **not** use $295k. |
| Setter | Human setters in his world | Closer playbook / ramp | **AI.** Do not hire. |

Playbook and closer-pack files have **no** Alec close %. They have talk rules, not percents.

**Working read:** Alec never wrote a close %. Chris said typical is no less than **30%**. So the floor is 30%, the working blend is **31%**, and we stay under any “Alec is high-40s” guess we do not have.

---

## 1. Locked inputs

| Knob | Number | Whose |
|------|--------|-------|
| Start spend | **$200 / day** | Chris |
| Scale spend | **$500 / day** | Chris |
| Month | **30 days** | This sheet |
| Ads run | **7 days / week** | This sheet |
| Closer sit-days | **22** weekdays (calendar). Conveyor desk math uses **20** — see staffing. | This sheet |
| Cost per booked call | **$33** | Chris / Paul (Aug 24 ads) |
| Close (booked → paid) | **Band table.** Company **31%** working. Floor **30%**. High **35%**. | MODEL + owner floor |
| Show | Band table. Company **77%**. | MODEL (staffing color only) |
| Traffic mix | **34** booked people (17 scores + 17 blank) | Aug 24 ClickFunnels |
| Offer if they close | Score + cash they said they have | Playbook + Aug 24 rules |
| Course finance only | Yes | Owner-set Aug 24 |
| Funding deposit | **$3,000 cash** + rest of **10%** later. Deposit is **part of** the 10%. | Offer book |
| Average funded deal | **$100,000–$150,000** | Owner-set 2026-08-26 |
| Later cash if they fund | **$7,000** at $100k · **$9,500** at $125k · **$12,000** at $150k | 10% minus the $3,000 |
| 95% of yeses pay | About **5%** leak | Owner-set Aug 24 |
| Closer slots | **10 / day** · packed at **90%** (9.0 books / closer / day) | Ops model |
| Closer bar | **27 deposits / month** | Conveyor (win bar, not a cap) |
| Funding-advisor bar | **27 funded files / month** | Conveyor |
| Setter | **AI** — do not hire | Owner-set |
| Closer — Mastery | **20% of $5,000 list = $1,000** per deal | Owner-set 2026-08-27 |
| Closer — UnderwriteIQ | **20% of paid** = $200 on $1,000 | Owner-set downsell/upsell rule |
| Closer — $3k deposit | **1/6** = **$500** | Owner-set |
| Closer — backend | **0.25%** of funded amount | Owner-set ($250 @ $100k · $375 @ $150k) |
| Close “should be” | **70%** | Owner-said 2026-08-27. Sheet still prints **30%** as the scared case. |

**Not in this sheet:** funding-advisor pay, Commas extra cut, Lender B tier cuts. Repair / trial / $32 closer cut **not** locked — modeled at **$0**.

**Words**

- **Booked** = they set a call.
- **Show** = they pick up.
- **Close** = they pay for any offer.
- **Cash now** = money we keep this month (cash offers at 100%; financed courses at the band payout).
- **Later 10%** = the rest of the success fee after the $3,000. Only funding clients. Only if a lender funds them.

Revenue uses **booked → paid**. Show is for the calendar picture.

---

## 2. Traffic — who books (not who closes)

From the Aug 24 survey. **34** real booked people. **17** typed a score. **17** left it blank.

| Band | People | Share of **all** books | Cash they said they have |
|------|--------|------------------------|---------------------------|
| 750+ | 3 | 3/34 (8.8%) | 2 at $5k–$25k, 1 at $25k–$100k. **All can cash $3k.** |
| 700–749 | 2 | 2/34 (5.9%) | **Both under $1k.** Score says funding. Wallet says no $3k. Thin n=2. |
| 650–699 | 4 | 4/34 (11.8%) | Inside 500–699: 7 of 11 under $1k, 1 at $1k–$5k, 3 at $5k–$25k. Same split applied to each 500–699 score band. **MODEL.** |
| 580–649 | 4 | 4/34 (11.8%) | Same cash split. |
| 500–579 | 3 | 3/34 (8.8%) | Same cash split. |
| Not sure | 1 | 1/34 (2.9%) | Under $1k. Cannot finance. Thin n=1. |
| **No score** | **17** | **17/34 (50%)** | Unknown. Conservative. Cannot assume Prime. |

500–699 cash split used when they close: **7/11** under $1k → UnderwriteIQ. **1/11** at $1k–$5k → repair $1,000 cash. **3/11** at $5k+ → Mastery. That split is from the 11 people at 500–699. We do not have cash by exact score, so each of those three score bands gets the same split. **MODEL.**

---

## 3. Band × income close model (assumed)

Every rate below is **MODEL / assumed**. Not measured. Ad group had **0** paid closes.

**Close** here is of **booked** people (same meaning as the old 18%: booked → paid). Show is a guess for staffing only.

| Band | Share of books | Assumed show | Assumed close of booked | Close of showed (close ÷ show) | If they close, primary offer | Payout we keep |
|------|----------------|--------------|-------------------------|--------------------------------|------------------------------|----------------|
| 750+ and $5k+ | 3/34 | 85% | **50%** | 59% | Funding **$3,000 cash** | **100%** (not on the course waterfall) |
| 700–749 and under $1k | 2/34 | 80% | **40%** | 50% | Mastery **$5,000** finance (they do **not** pay $3k they said they do not have) | **85%** (680+ Lender A Prime) |
| 650–699 | 4/34 | 80% | **36%** | 45% | Cash-poor → UnderwriteIQ $1,000. $1k–$5k → repair $1,000 cash. $5k+ → Mastery $5,000. | Courses **80%** working: half this band treated as 680+ Prime 85%, half as 650–679 Near Prime 75%. **MODEL split.** Repair is cash 100%. |
| 580–649 | 4/34 | 78% | **32%** | 41% | Same cash → offer map as 650–699. | Courses **68.5%** working: half 600+ Near Prime 75%, half 580–599 Lender B Tier 3 **62%**. B cuts are unknown. Tier 3 is the middle. |
| 500–579 | 3/34 | 75% | **28%** | 37% | Same cash → offer map. | Courses **62%** (Lender B Tier 3). All under 600. |
| Not sure | 1/34 | 70% | **22%** | 31% | Cheap cash. **60%** of closes = soft-pull $32. **40%** = trial $200. Cannot finance. | **100%** |
| No score | 17/34 | 75% | **27%** | 36% | Conservative: **45%** UnderwriteIQ, **30%** trial, **25%** soft-pull. **No** funding. **No** Mastery. Cannot assume Prime. | UnderwriteIQ at last-resort **42%**. Cash offers 100%. |

**Company blend (people-weighted)**

```text
Close of booked  =  (3×50% + 2×40% + 4×36% + 4×32% + 3×28% + 1×22% + 17×27%) ÷ 34
                 =  10.67 ÷ 34
                 =  31.38%   →  working 31%
Show             =  77%
Close of showed  =  31.4% ÷ 77%  ≈  41%
```

Higher score + cash → higher close, more $3k funding. 700–749 with no cash finance Mastery. 500–699 cash-poor finance UnderwriteIQ more than Mastery. No-score stays cheap. The weighted average does **not** sneak back to 18%.

**Lender B:** tier cuts are not locked. Working = **Tier 3 at 62%** on 390–599 course files. Kind case (Tier 1, 77%) and harsh case (last resort 42%) are knobs. They move $200 cash now by only a few thousand. The big hole is still **no-score**.

---

## 4. Cash we keep if one person in that band closes

List price × that band’s payout. Funding is never on the course waterfall.

| Band | What they buy if they close | List | We keep now | Later 10% if a lender funds them |
|------|-----------------------------|------|-------------|----------------------------------|
| 750+ cash | Funding $3,000 | $3,000 | **$3,000** | **$7,000** at $100k · **$9,500** at $125k · **$12,000** at $150k |
| 700–749 poor | Mastery | $5,000 | **$4,250** (85%) | $0 |
| 650–699 (mix) | 7/11 UW · 1/11 repair · 3/11 Mastery | $2,091 | **$1,691** | $0 |
| 580–649 (mix) | Same mix | $2,091 | **$1,461** | $0 |
| 500–579 (mix) | Same mix | $2,091 | **$1,331** | $0 |
| Not sure | 60% $32 / 40% $200 | $99 | **$99** | $0 |
| No score | 45% UW @ 42% / 30% $200 / 25% $32 | $519 | **$257** | $0 |

Then × that band’s close rate = cash now **per booked person** in the band:

| Band | Close | Keep if close | Cash now per booked person |
|------|-------|---------------|----------------------------|
| 750+ cash | 50% | $3,000 | **$1,500** |
| 700–749 poor | 40% | $4,250 | **$1,700** |
| 650–699 | 36% | $1,691 | **$609** |
| 580–649 | 32% | $1,461 | **$467** |
| 500–579 | 28% | $1,331 | **$373** |
| Not sure | 22% | $99 | **$22** |
| No score | 27% | $257 | **$69** |
| **All books together** | **31.4%** | **$1,361** / close | **$427** / booked call |

**One booked call (working)**

| KPI | Exact |
|-----|-------|
| Cash now | **$427.19** |
| Ad cost | $33 |
| Cash after ads | **$394.19** |
| Return on ads | **12.9 ×** |
| Cost per close | **$105** ($33 ÷ 31.4%) |
| Cost per show (77% show) | **$43** |
| Funding closes per 100 books | **4.4** (only the 750+ cash lane) |

Old file: $348 cash per book, 10.5 × ads, $183 per close. Close rate went up. Cash per close went down (no-score + honest offers). Net cash per book is **higher**.

**5% don’t-pay leak:** multiply cash now by **0.95** if you want it in. Tables below leave it off. At $200 that is about **−$3,880**. At $500 about **−$9,710**.

**Thin $75k compare (not the scoreboard):** rest of 10% = $4,500. Use only to see the old habit. Scoreboard uses **$100k–$150k**.

---

## 5. Stage A — $200 a day

```text
$200 × 30 days                 =  $6,000 ads
$6,000 ÷ $33                   =  181.818 booked calls   →  rounded 182
Band close 31.38%              =  57.059 people pay      →  rounded 57
Weekday books (22 sit-days)    =  181.818 ÷ 22  =  8.26 / workday
Weekday books (20 desk-days)   =  181.818 ÷ 20  =  9.09 / workday  ← packed line
```

### Money (30 days, band payouts)

| | Exact | Rounded |
|--|-------|---------|
| Cash now | **$77,670** | **$77,700** |
| After ads | **$71,670** | **$71,700** |
| Funding people (750+ closes) | **8.02** | **8** |
| Later if **all 8** fund at **$100k** ($7,000 each) | **$56,150** | **$56,200** |
| Later if all 8 fund at **$125k** ($9,500 each) | **$76,200** | **$76,200** |
| Later if all 8 fund at **$150k** ($12,000 each) | **$96,260** | **$96,300** |
| Later if **half** fund at $100k | **$28,070** | **$28,100** |
| Later if **half** fund at $150k | **$48,130** | **$48,100** |
| Later if all 8 fund at old $75k (thin) | $36,100 | — |

We do **not** know the fund rate. Half vs all is a what-if.

**Company-wide close sensitivity** (same offer-if-close mix, flat rate — not the main table)

| Close | Closes | Cash now | After ads | Later all @ $100k | Later all @ $150k |
|-------|--------|----------|-----------|-------------------|-------------------|
| **30%** floor | 54.5 | **$74,250** | $68,250 | $53,680 | $92,020 |
| **31%** band (working) | 57.1 | **$77,670** | $71,670 | $56,150 | $96,260 |
| **32%** | 58.2 | **$79,200** | $73,200 | $57,250 | $98,150 |
| **35%** high | 63.6 | **$86,620** | $80,620 | $62,620 | $107,350 |

No 15%. No 18%. No 20%.

### What those 57 people bought (band model)

| Offer | Exact people | Rounded people | Cash we keep (exact) |
|-------|--------------|----------------|----------------------|
| Funding $3,000 | 8.02 | 8 | $24,064 |
| Mastery (financed, band payouts) | 9.47 | 9 | $36,774 |
| UnderwriteIQ (financed, band payouts) | 23.16 | 23 | $13,315 |
| Repair $1,000 | 1.73 | 2 | $1,731 |
| Trial $200 | 7.83 | 8 | $1,567 |
| Soft-pull $32 | 6.84 | 7 | $219 |
| **Total** | **57.06** | **57** | **$77,670** |

Dollars are exact. People rounded to whole people. Do not multiply rounded people × price and expect $77,670.

### Cash now by traffic band — $200/day

| Band | Exact books | Exact closes | Cash now |
|------|-------------|--------------|----------|
| 750+ cash | 16.0 | 8.0 | $24,064 |
| 700–749 poor | 10.7 | 4.3 | $18,182 |
| 650–699 | 21.4 | 7.7 | $13,021 |
| 580–649 | 21.4 | 6.8 | $10,000 |
| 500–579 | 16.0 | 4.5 | $5,978 |
| Not sure | 5.3 | 1.2 | $117 |
| No score | 90.9 | 24.5 | $6,308 |
| **Total** | **181.8** | **57.1** | **$77,670** |

Half the books are no-score. They add only ~$6,300. If those 91 people later look like the 17 who typed a score, cash now almost **doubles**. Working model does **not** do that. See knobs.

### People on the floor — $200/day

| Seat | Count | Why |
|------|-------|-----|
| **Closer** | **1** | 8.26 books / workday vs 10 slots. **83% full.** Packed starts at 90% (9.0). |
| **Funding advisor** | **1** | ~8 funding closes. Bar is 27 **funded** files. One advisor is plenty. |
| Setter | 0 (AI) | Count the 182 books. Do not hire. |
| Sales manager | 1 if you already have one | Not sized from ads. |

**Do not hire a second closer at $200/day** unless weekday books stay over ~9 / day for a week.

**20 desk-day caution:** 181.8 ÷ 20 = **9.09** books / day. That is already over the 90% packed line. Calendar hire uses **22** sit-days. If your closers only sit 20 days, you are at the hire line now.

Deposits vs bar: **57 vs 27**. One closer is **beating** the 27 bar. That is fine. The bar is a target, not a cap. Time-max is ~213 calls. 182 books fit.

---

## 6. Stage B — $500 a day

```text
$500 × 30 days                 =  $15,000 ads
$15,000 ÷ $33                  =  454.545 booked calls   →  rounded 455
Band close 31.38%              =  142.647 people pay     →  rounded 143
Weekday books (22 sit-days)    =  454.545 ÷ 22  =  20.66 / workday
Weekday books (20 desk-days)   =  454.545 ÷ 20  =  22.73 / workday
```

Everything is **2.5 ×** the $200 row (same rates).

### Money (30 days, band payouts)

| | Exact | Rounded |
|--|-------|---------|
| Cash now | **$194,175** | **$194,200** |
| After ads | **$179,175** | **$179,200** |
| Funding people | **20.05** | **20** |
| Later if **all 20** fund at **$100k** | **$140,370** | **$140,400** |
| Later if all 20 fund at **$125k** | **$190,510** | **$190,500** |
| Later if all 20 fund at **$150k** | **$240,640** | **$240,600** |
| Later if **half** fund at $100k | **$70,190** | **$70,200** |
| Later if **half** fund at $150k | **$120,320** | **$120,300** |
| Later if all 20 fund at old $75k (thin) | $90,240 | — |

**Company-wide close sensitivity** (same mix-if-close)

| Close | Closes | Cash now | After ads | Later all @ $100k | Later all @ $150k |
|-------|--------|----------|-----------|-------------------|-------------------|
| **30%** floor | 136.4 | **$185,620** | $170,620 | $134,190 | $230,040 |
| **31%** band (working) | 142.6 | **$194,175** | $179,175 | $140,370 | $240,640 |
| **32%** | 145.5 | **$198,000** | $183,000 | $143,140 | $245,380 |
| **35%** high | 159.1 | **$216,560** | $201,560 | $156,560 | $268,380 |

### What those 143 people bought (band model)

| Offer | Exact people | Rounded people | Cash we keep (exact) |
|-------|--------------|----------------|----------------------|
| Funding $3,000 | 20.05 | 20 | $60,160 |
| Mastery (financed) | 23.68 | 24 | $91,935 |
| UnderwriteIQ (financed) | 57.90 | 58 | $33,289 |
| Repair $1,000 | 4.33 | 4 | $4,327 |
| Trial $200 | 19.59 | 20 | $3,917 |
| Soft-pull $32 | 17.11 | 17 | $547 |
| **Total** | **142.65** | **143** | **$194,175** |

### People on the floor — $500/day

20.66 weekday books.

| Closers | Slots | Fill | Packed? (90%) |
|---------|-------|------|----------------|
| 2 | 20 | **103%** | **Yes — over.** |
| **3** | 30 | **69%** | No. Room. |

**Hire 3 closers before you hold $500/day.** Two closers are already over the packed line if ads run all week and sits land Mon–Fri.

| Seat | Count | Why |
|------|-------|-----|
| **Closer** | **3** | 20.66 books / workday. |
| **Funding advisor** | **1** now, **2** when funded files near 27 | ~20 funding closes. If they all fund, still under 27. One advisor can take that. A second FA is coverage. |
| Setter | 0 (AI) | |
| Repair / inquiry | Watch the clock (~15 / 30 day file) | ~4 full repair + ~20 trials. No monthly headcount lock. |

Deposits per closer at 3 seats: **142.6 ÷ 3 = 47.5** vs the 27 bar. They are winning. Do **not** hire 6 closers just to make 27 look even. That would starve the calendar (20.7 books on 60 slots).

**Lean vs pod rule**

- **This sheet (volume):** 3 closers + 1 funding advisor at $500/day.
- **Pod rule (1 FA per closer):** 3 + 3. That overstaffs funding at this mix (~14% of closes are the $3k path). Use it when you want a pair per closer, not because the 27-file bar needs it.

---

## 7. Side by side

| KPI | $200 / day | $500 / day |
|-----|------------|------------|
| Ad spend / month | $6,000 | $15,000 |
| Booked calls | 181.8 (round 182) | 454.5 (round 455) |
| Booked / workday (22) | 8.26 | 20.66 |
| Booked / workday (20) | 9.09 — packed | 22.73 |
| Shows / workday @ 77% *MODEL* | 6.4 | 15.9 |
| Closes @ 31.4% | 57.1 (round 57) | 142.6 (round 143) |
| Closes / workday (22) | 2.6 | 6.5 |
| **Closers** | **1** | **3** |
| Slots used (22-day) | 83% | 69% (of 3) |
| Deposits per closer | 57 (over 27 bar) | 48 (over 27 bar) |
| Funding advisors | 1 | 1 (2 for coverage) |
| **Front (cash now)** | **$77,670** | **$194,175** |
| Cash after ads (front only) | $71,670 | $179,175 |
| Return on ads (front only) | 12.9 × | 12.9 × |
| Cost per close | $105 | $105 |
| Cost per booked | $33 | $33 |
| Funding clients | 8.0 | 20.1 |
| **Backend (rest of 10%) if all fund @ $100k** | **$56,150** | **$140,370** |
| **Backend if all fund @ $150k** | **$96,260** | **$240,640** |
| Backend if half fund @ $100k | $28,070 | $70,190 |
| Backend if half fund @ $150k | $48,130 | $120,320 |
| **Total revenue (front + backend) if all fund @ $100k** | **$133,820** | **$334,545** |
| **Total revenue if all fund @ $150k** | **$173,930** | **$434,815** |
| Cost per funding close (ads) | ~$750 | ~$750 |
| Cost per funded if half fund | ~$1,500 | ~$1,500 |

Return on ads does not change with spend. Headcount does.

---

## 7b. Closer monthly pay (re-analyzed 2026-08-27)

Owner-set: **Mastery pays 20%** ($1,000 on a $5,000 finance deal). An earlier read of the pay-link code (first-sale Mastery stamps no `sale_motion`) was **wrong for this model**. Use 20%.

**One closer’s cut per deal**

| Deal | Closer gets |
|------|-------------|
| Funding Mastery $5,000 | **$1,000** |
| UnderwriteIQ $1,000 | **$200** |
| Funding deposit $3,000 | **$500** |
| That file funds at $100k / $150k | **+$250 / +$375** |
| Repair / trial / $32 | **$0** (not locked) |

**Monthly pay — this mix, this calendar**

| | **30% close (scared)** | **70% close (owner “should be”)** |
|--|------------------------|-----------------------------------|
| **$200/day · 1 closer** | **$20k–$21k** | **$45k–$47k** |
| **$500/day · 3 closers** (each) | **$17k–$18k** | **$37k–$39k** |
| **$20k ads · 4 closers** (each) | **$17k–$18k** | **$37k–$39k** |
| **10 closers at their $2,178/day cap** (each) | **$22k–$23k** | **$49k–$51k** |

Range is backend: all funding clients fund at $100k (low) vs $150k (high).

The **$11k** number was the bug: it left Mastery at $0. Mastery is most of closer cash (~$9,500 of the $20k at $200/day / 30%).

**$2k/day closer** (owner picture: 2–3 Mastery / day × $1,000) = **$44k–$66k/mo**. This survey mix does **not** print 2–3 Mastery sits a day on one calendar. At 30% you get ~**0.4** Mastery / workday at $200 ads. At 70% ~**1.0** / workday. Hitting 2/day needs more books or a richer mix.

---

## 8. Company 8 + extra KPIs

These eight are already the company dashboard. Track them on each spend stage.

| # | KPI | How to read it | $200 working | $500 working |
|---|-----|----------------|--------------|--------------|
| 1 | New clients | Paid any offer | 57 | 143 |
| 2 | Booked calls | Ads ÷ $33 | 182 | 455 |
| 3 | Show rate | Showed ÷ booked | **Measure. 77% is MODEL. Alec wrote 80–90%.** | same |
| 4 | Close rate | Paid ÷ booked | **31% working (band). Floor 30%.** | same |
| 5 | Cash | Band payouts, same month | **$78k** | **$194k** |
| 6 | Funded count | Files a lender funded | unknown (0 from this ad group) | unknown |
| 7 | Funded dollars | Sum of those files | unknown. Model uses **$100k–$150k** each **if** they fund | same |
| 8 | Cost per funded | Ads ÷ funded count | unknown until someone funds | unknown |

**Extra KPIs this model adds**

| KPI | Why | $200 | $500 |
|-----|-----|------|------|
| Cost per show | Ads quality after the book | $33 ÷ show rate | same |
| Close of **showed** | Closer skill, not setter | 31% ÷ show (≈41% if 77% show) | same |
| Cash per close | Band offers + per-band payout | $1,361 | $1,361 |
| List vs kept | Course waterfall leak | $1,719 list → $1,361 kept | same |
| Finance share of cash | Courses vs cash offers | ~$50k of $78k is financed courses (~65%) | same |
| Calendar fill | Hire trigger | 83% → watch | 2 closers = packed; need **3** |
| Deposits / closer vs 27 | Seat is winning | 57 | 48 |
| Funding files / FA vs 27 | FA is winning | 8 | 20 |
| 5% unpaid | Yeses that never pay | ~3 people | ~7 people |
| Course approval rate | Commas / lender yes vs 500+ on the form | **not measured** | not measured |
| Prime vs Near vs B mix | Changes course cash | rebuild monthly from real scores | same |
| No-score share | Half the books today | 50% of traffic | same — get scores on the form |

---

## 9. Ramp (200, then 500)

Do not jump to $500/day until the $200 week proves three things:

1. **Cost per booked call stays near $33** (or you redo every table).
2. **Weekday books stay under ~9 / closer** (or you already have the next closer hired).
3. **Someone pays.** The mix is from scores, not from closes. First paid week is the first real close rate. Do not treat 0 paid as 0% forever — and do not stay on 18%.

| Week | Spend / day | Ads that week | Books (at $33) | Closers on the desk |
|------|-------------|----------------|----------------|---------------------|
| 1–2 | $200 | $1,400 | ~42 | 1 |
| 3–4 | $200, if cost/book holds | $1,400 | ~42 | 1 (hire #2 if fill > 90%) |
| 5+ | $500, only after closer #2 and #3 are on the calendar | $3,500 | ~106 | **3** |

A week at $500 with only 1 closer dumps ~21 sits onto 10 slots. That is how close rate dies.

The old Aug 24 **$20,000 / month** question is ~**$667/day** — above Stage B. **4 closers** (27.5 weekday books on 22 days).

**$20,000 ads — total revenue = front + backend**

The $3,000 deposit is the **front** of the 10%. **Backend** is the rest after a lender funds them ($7,000 at $100k / $12,000 at $150k). Do not add a full extra 10% on top of the $3,000.

| Piece | $100k average fund | $150k average fund |
|-------|--------------------|--------------------|
| Front — courses, repair, trial, $32, and $3k deposits | **$258,900** | **$258,900** |
| Backend — rest of 10% if **all ~27** funding clients fund | **$187,200** | **$320,800** |
| **Total revenue** | **$446,100** | **$579,700** |
| Backend if **half** fund | $93,600 | $160,400 |
| **Total if half fund** | **$352,500** | **$419,300** |

Front split inside that $258,900: Mastery ~$123k · UnderwriteIQ ~$44k · $3k deposits ~$80k · repair / trial / $32 ~$12k. **606** books, **190** closes.

---

## 10. What this sheet did not do

- Did not use Alec prices or “20 deposits” as a close rate
- Did not invent an Alec close % (none is recorded)
- Did not invent a live Fundhub close rate or fund rate (still 0 paid from that ad group)
- Did not keep 15 / 18 / 20% as a working band
- Did not apply the Aug 24 buy mix to every close
- Did not finance the $3k, repair, or trial
- Did not invent a combo %
- Did not name Lender A / B in buyer copy
- Did not put closer or FA payroll in the profit line
- Did not assume Commas keeps a second cut on top of the waterfall
- Did not lock Lender B tier cuts (only 390+ is recorded)
- Did not use $50k or $75k as the working funded size

---

## 11. What is still a guess

1. **Every close rate in the band table** — assumed. Floor 30% is owner-set, not measured.
2. **Show rate** — 77% is MODEL. Alec wrote 80–90%. We undershoot. Revenue does not use show.
3. **Fund rate** — later 10% is a what-if. Average funded size is owner-set **$100k–$150k** if they fund.
4. **Lender B tiers** — 62% working on 390–599.
5. **650–699 split** at 680 vs 650 — half/half. MODEL.
6. **500–699 cash split** copied onto each score band — we lack cash by exact score.
7. **No-score half** — conservative cheap mix. Biggest hole in the model.
8. **Commas yes vs the score they typed.**
9. **Prime down-payment dollar** — we keep 85% of contract; the down payment amount is unknown.
10. **UnderwriteIQ** priced at **$1,000** (catalog allows up to $5,000).
11. **$33 per book** — from a thin Aug 24 sample. If this goes to $50, every cash number drops by a third and you need more ads for the same calendar.

---

## 12. Knobs Chris can change

1. Daily spend ($200 → $500)
2. Cost per booked call (now $33)
3. **Any band close rate** — company blend must stay **≥ 30%**
4. Company-wide close (30 / 32 / 35%) if you want a flat overlay
5. No-score mix — cheap (working) vs “they look like the 17 who typed a score” (cash now about **2×**)
6. Do the two 700–749 people with under $1k still put $3k on a card? Working = **no**, they finance Mastery. If **yes**: $200 cash now drops about **$5,300**, funding people rise from 8 to **12**, later 10% jumps
7. Lender B tier (62% working). Kind 77% or last-resort 42% moves $200 cash now by about **$2k–$3k**
8. UnderwriteIQ price ($1,000 vs up to $5,000)
9. How many funding clients fund, and **$100k vs $150k**
10. 5% unpaid on or off
11. Hire 1 FA vs 1 FA per closer
12. Sit-days 22 vs 20 (20 already packs $200)

---

## Related

- [`ads-revenue-model-2026-08-24.md`](ads-revenue-model-2026-08-24.md) — survey traffic and $20k math at 100% list (old close band — do not use 18% from there)
- [`../company-resources/course-finance-waterfall-2026-08-26.md`](../company-resources/course-finance-waterfall-2026-08-26.md) — lender try-order
- [`../company-resources/closer-playbook-2026-08-24.md`](../company-resources/closer-playbook-2026-08-24.md) — cash vs finance
- [`fundhub-conveyor-kpis-2026-08-23.md`](fundhub-conveyor-kpis-2026-08-23.md) — 27/27 bars and 10 slots
- [`alec-legacy-strong-kpis-reference-2026-08-23.md`](alec-legacy-strong-kpis-reference-2026-08-23.md) — Alec KPIs, reference only
