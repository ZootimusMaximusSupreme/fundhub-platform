# Asset Bank — everything the ads are built from

One file. Everything that used to be scattered across seven documents, two Drive folders and a
closer pack. If you're writing an ad, this is the only file you need open besides
`ANGLE-GENERATOR.md`.

**Rules for this file:** nothing gets invented here. Every line traces to something Chris said, wrote,
or shipped. If a fact is missing, that absence is the finding — leave the gap, don't fill it.

**Part 0 of `RULES.md` (Chris's rules) wins over anything in this file.** The names and labels here
are ours. Ad copy follows Part 0.

---

## 1. The offer

**Underwrite IQ™ — The White-Glove Funding System.**

> "We help online entrepreneurs unlock 6–7 figures in capital using our AI-Driven Underwrite IQ™
> System — in as little as 72 hours — so they can scale fast, stress less, and win big."

**The one job every ad has: get them on the call.** The call sorts them.

### Prices — live, from `src/config/offers.mjs`

| Offer | Price | Finance? |
|---|---|---|
| UnderwriteIQ soft-pull assessment | **$32** | no |
| Funding, done-for-you | **$3,000** deposit + **10%** success fee | no |
| Credit repair, done-for-you | **$1,000** | yes |
| Repair test run (first round) | **$200** | yes |
| UnderwriteIQ Deliverables Package | **$1,000–$5,000** | yes |
| Funding Mastery (A–Z course) | **$5,000** | yes |
| White-label partner program | $10,000 | **NOT LED WITH — next month, 2 concepts max** |

The $3,000 is a **deposit on the system**, not a fee for labour, and it **counts toward** the 10% —
it is not extra on top. **Funding is cash. It does not finance.** That part is not in dispute.

### ⚠️ UNRESOLVED — what actually finances

The code and the closer pack disagree, and no ad should state repair financing terms until Chris
settles it.

| | Repair $1,000 | Repair trial $200 | UWIQ pack | Funding Mastery |
|---|---|---|---|---|
| **`src/config/offers.mjs`** (live) | `financing: true` | `financing: true` | `financing: true` | `financing: true` |
| **Closer pack, objection #17** | **cash only** | **cash only** | finances | finances |

They agree on the two courses and they agree funding is cash. They contradict each other on repair
and the trial.

**Until Chris answers:** ads may say the two courses finance. Ads may say funding is cash. Ads must
**not** state whether repair or the $200 trial can go on payments. Pull the current answer from
`src/config/offers.mjs` on the day, not from any write-up including this one.

### The Sorting Hat — four doors off one call

The offers stack so the sort is easy. Nobody gets turned away, they get routed.

| Door | Who lands here | What they buy |
|---|---|---|
| **Funded** | Clean file, real income | Funding DFY $3,000 + 10% |
| **Fixed** | Negatives blocking the file | Repair $1,000, or the $200 trial |
| **Educated** | Wants to run it themselves, or can't afford DFY | UWIQ pack $1,000–$5,000, Funding Mastery $5,000 |
| **Their own company** | Wants to run a funding business | White-label $10,000 — *not yet, next month* |

**Not every ad is a Sorting Hat ad.** Most lead with one door. The Sorting Hat ads are the wide-net
ones that say "you might not even need funding" and let the call decide.

---

## 2. The mechanisms — what only Fundhub has

### Mechanism 1 — The Conveyor Belt ← the hero, and it has never run in an ad

The single strongest asset in this entire file. Not in any control.

"The Conveyor Belt" is our name for it, not ad copy. An ad never says "the belt" (Part 0 rule 13).
It says what happens to the file.

1. **Soft pull, tri-bureau.** No handing over an Experian login. No hard pull. Instant pre-approval,
   zero score impact, no friction at the starting line.
2. **The lender matrix.** Cross-references the real profile, filters out banks with incompatible
   rules — state restrictions, bureau sensitivities — and lines up **30–50 matched lenders**.
3. **Step A — Clean.** Existing hard inquiries attacked and removed first.
4. **Step B — Apply.** The first round of matched applications fires only once the file is clean.
5. **Step C — Sweep & Repeat.** The new inquiries those banks just created are **removed before the
   next batch goes out.**

**The file gets scrubbed while it's moving down the belt, so the score holds through the entire
funding sprint.** That's how a stack reaches **$100K–$200K** instead of dying at round two.
Up to **12 funding rounds**.

**Why this matters more than anything else here:** it answers *"this takes too long and ruins my
credit"* — their #1 objection — with a mechanism instead of a promise. Everyone else says "we protect
your score." Only Fundhub can say *how*.

### Mechanism 2 — The Event-Driven Engine

The software manages the people, not the other way around. A traditional CRM makes humans remember
to check reports, cross-reference lenders on a spreadsheet, dispute inquiries, drag pipeline cards.
At volume, humans drop it and the commission evaporates.

This one reacts to events. An inquiry gets removed, the system recalculates readiness on its own and
fires the next batch. **50–75 complex multi-round files running simultaneously.** Nothing falls
through.

**Chris built it himself. 1,000+ hours.** In his own words: *"I built this myself because I was tired
of letting my clients down and saw this as my only REAL solution."*

⚠️ **Never name the tech stack in copy.** No vendor names, ever. It is "our system."

### Mechanism 3 — Speed

The industry funds a deal in **30–45 days**. Underwrite IQ closes a capital stack in about **7**, by
compressing application windows to get in front of more banks. Roughly **2x the approvals, faster.**

### Mechanism 4 — The Sorting Hat

The call assesses and routes instead of qualifying people out. See §1.

### Mechanism 5 — The Guarantee

- A funding advisor reviews and begins optimizing the file within **24 business hours**.
- Applications go to approved lenders within **72 business hours**.
- **If those don't happen, no upfront fee.**
- **Funding Execution Guarantee:** full execution of the roadmap and credit optimization plan. If the
  targeted objective isn't reached after full execution, work continues at no additional cost until
  it is or no further options exist — otherwise the retainer comes back.

---

## 3. The enemy — 18 things the industry does wrong

Chris's own words, plus the avatar's complaints. Every one of these is an ad.

**What competitors are:**
1. Busted, janky systems held together with duct tape
2. Running on an off-the-shelf CRM they didn't build
3. No automated inquiry removal
4. No automated credit repair
5. No conveyor belt — no sequencing at all
6. No soft-pull system
7. No underwriting algorithm
8. No comprehensive lender list
9. Bad at asset funding
10. No support system behind the sale
11. **Ripped somebody else's course and rebranded it as their own**
12. Not ten years in — most are new
13. **Committing fraud on your behalf** on applications
14. No follow-through once they've been paid

**What the avatar says, verbatim:**
15. *"Everyone is a scammer."*
16. *"I've paid for this before and got nothing."*
17. *"This takes too long and ruins my credit."*
18. Brokers who log into Experian, blast a generic lender list, and hand back a lower score

---

## 4. The audiences

### Core avatar — "Growth-Stalled Gary"

> "A sharp, successful online entrepreneur who is an expert in his domain but a frustrated novice in
> the world of capital acquisition. He's hit a growth ceiling and knows a significant capital
> injection is the only way to break through. He's been burned by shady brokers and ineffective DIY
> funding attempts, leaving him deeply skeptical and angry at the entire industry."

- **Who:** online business — ecommerce, coaching, digital marketing. Team of 1–10. **$50K–$500K/yr.**
  **720+** credit. Has money, ready to invest.
- **Core desire:** *"To feel the power, status, and security of a well-capitalized CEO, not the
  vulnerability of a capital-constrained entrepreneur."*
- **In his words:** *"I need 6- or 7-figures so I can finally scale this thing properly."* ·
  *"I want capital without worrying about it destroying my credit score."* · *"I need someone I can
  actually trust who isn't going to rip me off."* · *"I want to stop doing the heavy lifting and get
  back to what I'm actually good at."*
- **Primary emotion — anger:** at the industry, and at himself for being duped before.
- **Fear:** that the business stagnates and he misses his window.
- ⚠️ **"Secret sauce" is a massive red flag for him.** Legit sauce is never a secret. The mechanism
  gets published, never teased.
- **Core message:** *"You are a CEO, not a loan processor."*

### Four sub-avatars

| # | Name | Experience + emotion | The line that lands |
|---|---|---|---|
| **A** | **The Bank-Rejected Builder** | Bank decline, embarrassment, researches before reapplying | "Judged on your business performance, not just your FICO" |
| **B** | **The MCA Survivor** | Merchant cash advance regret, fear, anti-daily-payment | "No daily payments. Know the real cost." |
| **C** | **The Spam-Scarred Skeptic** | Marketplace spam, distrust, screens every call | "We don't sell your phone number." *Strongest on Meta — this trauma is universal.* |
| **D** | **The Credit-Protective Planner** | Watched the score drop from inquiries, abandons at the hard pull | "Before anyone pulls your credit." *Cleanest fit for the Conveyor Belt.* |

### The sixth — The Unsorted

Doesn't know what they need. Might need funding, might need repair, might need to learn it. This is
who the Sorting Hat ads are for.

### Real customer language — use these words, they're not ours

> *"Over 250 phone calls and about as many text messages"* — in six days
> *"I receive 6-12 calls per day… It's been 2 years and 4 months. I've received 1000s of calls."*
> *"Within seconds of providing info… my phone started ringing. Nonstop."*
> *"They sell your phone number to Lenders. They're not lenders. They're lead generators."*
> *"You fill out an application… then get 3-6 different hard hits on your credit which lowers your score."*
> *"I've already paid over $16,000, yet somehow owe more than I originally borrowed — locked into $810 a week."*
> *"One Merchant Cash Advance turned into two, then three. I was borrowing from Peter to pay Paul, and then Paul sued me."*
> *"Would I lose my personal home and retirement savings?"*

And the one positive — the after-state worth selling:

> *"Best of all I did not receive a lot of spam calls and texts from unwanted 3rd party lenders."*

---

## 5. The gates

The gate in code (`src/config/survey-qualification.mjs`):
**PASS** = FICO 700–749 or 750+ **and no negatives**. **DOWNSELL** = 650–699, or any score carrying
negatives. Bands: 500-579 · 580-649 · 650-699 · 700-749 · 750+ · Not sure.

**Chris's operating floor sits under that: 600.**

| Gate | Use it when | Why |
|---|---|---|
| **600+** — the default | Main lane, most ads | Where the lender waterfall works and the courses can finance. 600 with negatives is the sweet spot: fast to clean, usually has cash. |
| **700+, no negatives** | Straight funding ads | PASS in the code. Cleanest path to the $3,000. |
| **Premium / strict** | A handful, deliberately | "Wants a lot of capital quickly. Verifiable income. 800 FICO. Not desperate, not broke." Expensive to acquire, best clients, least fulfillment drag. |
| **Open, no gate** | Volume ads | Cheapest leads. They buy the e-products. |

**Under 600 wastes closer time** — but the open ads still bring them in, because those people convert
on courses and repair rather than funding.

**Disqualification is a hook device, not just a filter.** Telling someone who this *isn't* for makes
the ones who do fit lean in. "If you're under 600, this isn't for you" is a hook.

---

## 6. Proof

The proof Chris allows is Part 0 of `RULES.md`, rules 35–38. Use only that. The proof table that
sat here was dropped on 2026-10-05 because it broke Part 0.

---

## 7. Objections — 18, in Fundhub words

From the closer pack. Shape is **Align → Educate → Reframe → Close**. An objection is usually a
question — listen, ask one follow-up, don't argue.

Every one of these is also an ad. The best pre-handled objection makes a better hook than any claim.

1. **"I don't want a bunch of inquiries."** → The $32 read is a soft look, not a bank app. Apps come
   later, on a plan, not as a spray. *This is the Conveyor Belt ad.*
2. **"I already applied and got told no."** → A past no is a fact. It doesn't tell me this file can't
   get a later yes.
3. **"I don't want to personally guarantee anything."** → Banks set their own rules. If a guarantee
   is a hard no, we may not be the funding path — we can still talk a course or a file read.
4. **"I don't have a business."** → You do not need a business to work with us.
5. **"I've been burned by a funding company."** → I'll show you the fee in dollars before you pay.
   You get a portal and a team, not just me.
6. **"This sounds too good to be true."** → I'm not promising a fund. I'm telling you our prices.
7. **"How do I know you won't take my money and vanish?"** → After you pay you get the portal and the
   next seat — a funding advisor or repair — not just one person.
8. **"Can you prove this works?"** → If we don't have a matching win, the honest proof step is the
   $32 file read or the $200 trial.
9. **"What if I can't pay it back?"** → If a lender gives you a line, their rules are yours. If you
   can't take on a new line, I won't sell you funding.
10. **"I already have cards / lines."** → We don't have to stack more. Is the gap more room, better
    terms, or a messy file? Only the last two might be us.
11. **"I don't want more debt."** → Then I won't talk you into funding. Funding, a course, and repair
    are three different things and none of them is free money.
12. **"I'd rather use my own cash."** → Using your own money is a real choice. A $32 read or a course
    can still be useful.
13. **"I need to think about it."** → What most people need isn't more days. It's the one unclear
    piece. What's the piece?
14. **"I'll do it later."** → Later is allowed. If a small step would help you decide, that's the $32
    read.
15. **"$3,000 is a lot."** → It is real money. It's cash, and it counts toward the 10% — it's not
    extra on top.
16. **"Other companies want $8,000 or $10,000."** → That's their price. Ours is $3,000 plus 10% later
    if a lender funds you.
17. **"Can I finance repair or the trial?"** → No. Those are cash. Only the two courses finance.
18. **"What if you don't get me funded?"** → I can't promise a fund. If you need a guarantee of
    money, I won't take your $3,000.

---

## 8. Words

### Use these

"no spam calls" · "we don't sell your phone number" · "soft pull" · "won't touch your credit score" ·
"see your real offers" · "one honest application" · "no equity" · "no daily payments" ·
"know the real cost" · "judged on your business, not just your FICO" · "owners the banks ignore" ·
"bridge the gap" · **"before anyone pulls your credit"**

### Avoid these

"lenders compete for you" (sounds like the spam swarm) · "get matched with 75 lenders" as a headline
(negatively associated) · generic "fast and easy" (invisible, everyone says it) · "cash advance" as a
positive (MCA-tainted) · "unlimited offers" · "apply now to get calls from our partners" ·
**anything implying multiple parties will phone them** · "secret sauce" · guaranteed approval

**Speed is demoted, not dropped.** "Funded in 24 hours" is exhausted table stakes, not a
differentiator. Lead with trust language, earn the speed claim second — and when you use it, use the
real number (7 days vs 30–45), not an adjective.

---

## 9. The voice

From the controls, which are working at $32–36 a booked call. Don't drift from this.

- **First person. Chris talking.** Never brand voice.
- **Short, full sentences. One idea each.** Plain paragraphs, not line-broken fragments. A blank
  line is a pause (Part 0 rules 17, 39 and 40).
- **Name the cost before the fix.** Spend real time on what the problem already took from them.
- **Absolution.** *"That's not on you."* The system failed them.
- **The refusal.** *"I know there are a lot of people in this space who will tell you whatever you
  want to hear to get you on a call. We're not going to do that."*
- **Same close, every time.** No hard inquiry. No obligation. Nothing moves until you say so.
- **Never sound like an AI wrote it.** Plain, structured, natural. If a sentence needs a second read,
  rewrite it.

---

## 10. Where the assets live

**Repo:** `docs/copy/Copywriting-Reference.md` (avatars §1.9–1.10, craft §3.1–3.8) ·
`docs/workflows/fundhub-closer-pack-from-alec-2026-08-24.md` (objections §5) ·
`src/config/offers.mjs` (prices) · `src/config/survey-qualification.mjs` (gates) ·
`public/app/present.js` (live proof claims)

**Drive:** `FundHub-Ad-Scripts-Batch-1` · `Fundhub_Closer_FAQ_Objections` · `Fundhub_Closer_Avatar` ·
`Fundhub_Closer_Script_FINAL` · `Fundhub-VSL-FrontEnd-Funding-StrategyCall` ·
`FUNDHUB.AI™ MASTER LIST` · `Ravi Abuvulas Ad System Idea` · `Fundhub Brand Guidelines (DirectROAS)`
· folders `AVATAR`, `OFFER`, `VSL`, `3.✍️ Ad Briefs & Scripts`

**Mentors referenced:** Alec Dupesh (objection shape: Align → Educate → Reframe → Close) ·
Evan Roegan (the Sorting Hat) · Jeremy Haynes (ad strategy, creative diversification) ·
Scaling With Systems (offer construction)
