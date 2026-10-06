# SLO chat prompt — $297 deliverables offer

**COMPLIANCE REVIEW REQUIRED** — credit-repair messaging, fee timing, consent capture, credit-pull type.

Written 2026-09-18. This is the self-contained prompt Chris pastes into a Claude chat to generate
the $297 SLO ads and short VSL without the repo attached. Every rule below is copied from
`marketing/ads/RULES.md`, `marketing/ads/VOICE.md` and `marketing/ads/ANGLE-GENERATOR.md` — nothing here is new.

**Pricing and scope, OWNER-SET 2026-09-18.** $297 buys all six deliverables plus the full six-round
dispute letter program with escalation letters. `src/config/offers.mjs` still prices Capital
Blueprint (`UWIQ_DELIVERABLES`) at $5,000, owner-set 2026-09-03 against the executed contract.
Those two numbers disagree. Recorded here, not resolved here — the catalogue is a separate decision
nobody has made yet.

**It is a product, not a service, OWNER-SET 2026-09-18.** Chris: *"We're not doing credit repair
for them. They're paying for an outcome — they're paying for deliverables."* No contracts. It runs
like an e-commerce offer. The buyer sends their own letters; FundHub sends them for a fee as an
add-on. That distinction IS the offer, and it changes every script: nobody is being sold a service
performed on them, they are buying the finished playbook built on their own file.

**What that does to the compliance screen, mechanically.** `marketing/ads/RULES.md` §1.5: *"The offer
type decides which rules fire. A funding ad is not screened under the credit-repair rules."* The
screen in `src/compliance/screen.mjs` is a plain pattern match keyed on the campaign's offer type.
Classified as a funding/deliverables offer, rules 1–6, 11 and 12 do not fire — so the earlier hard
ban on "upfront" is lifted. Classified as repair, they all fire. The classification set on the
campaign decides it, not the wording in the script. **Rules 7–10 fire on every ad regardless and
are never optional.**

**Said once and dropped, per CLAUDE.md.** The package includes dispute letters, so how an outside
reader classifies it is not settled by what we call it internally. Chris has decided. Logged, not
raised again.

**The rounds are real and capped at six.** Traced in `docs/journeys/dispute-rounds-actual.md` and
`src/repair/analyze.mjs`: rounds run R1–R6 against a program cap, round 2 and later are the
escalation letters, and an escalation asks the bureau HOW it verified the item and names the
specific problem with its answer.

**Two owner calls that override RULES.md, logged as owner-set 2026-09-18:**

1. **Ads run 60–80 seconds.** RULES.md §2.1 sets a 60-second floor, so this is inside the rule. It
   sits in the 60–90s band: **150–200 words**. Noting once, without argument: §2.1's honest
   cross-check records that all five filmed, running ads sit in the 2 min+ band and nothing in the
   60–90s band has ever been filmed. Chris set 60–80. It is set.
2. **The VSL is 1–2 minutes, bullet-driven.** RULES.md §3.8 puts a VSL at 700–900 words and says
   anything under 700 "is a long ad, not a VSL — which is fine, but then write it to Section 1's
   rules." So this piece is written to Section 1, not the sixteen-beat spine in §3.9. Two beats are
   carried over anyway because they are mandatory everywhere: the refusal (§3.10) and the safety
   close (§3.6).

---

## The prompt — copy everything below this line

You're writing direct-response ad copy for FundHub. Follow every rule here exactly. These are not
style suggestions, they are a published SOP and a compliance screen.

### THE OFFER — $297

**This is a product, not a service. Get this right or every script is wrong.**

Nobody is doing credit repair *for* them. They are buying **deliverables** — a finished package
built on their own credit file. They send their own letters. They follow their own roadmap. There
is no contract. It works like buying anything else online: pay, and it's yours.

Everything below is included at $297.

1. **Credit Analysis Report** — their real file, all three bureaus
2. **Dispute Letter Pack** — every letter written for them, ready to send
3. **Credit Optimization Roadmap** — the exact steps, in the exact order, built off their own data
4. **Funding Snapshot** — what their file supports today, what it would support once they work the
   roadmap, and the gap between the two
5. **Bank & Lender Match List** — the specific lenders their file fits right now, and which ones
   need a business entity first
6. **"How To Use This" mini course**
7. **Six rounds of dispute letters** — R1 through R6, all written for them
8. **Escalation letters from round two on** — these don't re-ask. They demand the bureau explain
   HOW it verified the item, and name the specific problem with that answer.

**Support that comes with it:** advisors they can reach along the way, and the community they're
in from the day they buy.

**Paid add-on, mention only where it fits:** FundHub will mail the letters for them for a fee. It
is not included and it is never the point of an ad.

### THE POSITIONING — the whole argument, do not drift off it

**The enemy is the learning curve.** Not a competitor, not a broker. The six months.

People don't want to learn funding. They want funding. Fast, and the most of it they can get. And
right now there is no clear road to it — so they buy a course, and the course teaches. Modules,
homework, community, trust the process. Six months of trial and error later, they've got skills
they didn't ask for and still no money. The skills are real. They're just not the thing they were
buying.

**The mechanism: download the brain of someone who's done this hundreds of times.** Go from A to Z
without the middle. We're shortcutting the learning curve to zero, because they don't need to know
anything — they just need to follow the instructions.

Chris's own framing, use it or something like it in at least one script: *Frodo doesn't need the
whole journey. Fly straight to the mountain, drop the ring in the lava, done.*

**What they actually do with it:**
- Send the letters
- Work the roadmap to get the file where it needs to be
- Follow the instructions
- See what they pre-qualify for
- See where they are now, where they're going to be, how long it takes, and how fast they get there

That last one is the whole product in one line: **now, next, how long, how fast.**

**Why they buy instead of learning it:** they have a business to run. They're busy. That's not a
weakness to agitate — it's the reason the package exists. Most people don't have time to sit there
and learn this. With the deliverables they don't have to.

**Honesty rail, keep it in:** this doesn't skip the work. The letters still go out, the file still
has to get optimized, and that takes as long as it takes. What gets deleted is the *learning*, not
the work. Say it that way — it's true and it's stronger than pretending otherwise.

### AN EXAMPLE OF WHAT THE PACKAGE OUTPUTS

Use this to show the *shape* of what they receive. Never as a promise, never as a typical result,
never as what the viewer will get:

> "Pre-qualified today: $199,350. Once you work the roadmap: $221,500. That's $22,150 your file
> isn't reaching yet. 15 lenders matched — 6 your file fits right now, 9 that need a business
> entity."

**How to frame that number, every time.** It is what their *file* supports — an estimate off their
own data. It is never what a bank will hand them. Say "pre-qualified", "what your file supports",
"where your file puts you". Never "what you'll get", never "what the bank will give you", never a
guaranteed figure. ("Up to", with the conditions said out loud, is the only other allowed shape —
see the never-say table.)

### AUDIENCE

Business owners and entrepreneurs who want capital and are **busy**. They have a business to run.
They've been declined, gotten the runaround, or simply don't know where they stand and nobody will
tell them straight. Some of them have already bought a course and are months in with nothing to
show. Default credit gate is 600+.

The one thing they all have in common: they do not want to become an expert in this. They want the
money and they want to go back to work.

---

## PART 1 — THE HARD NO'S

### Never say these

| Never say | Why |
|---|---|
| "Your score will go up." | We cannot know it. Banned claim. |
| "We'll get you funded." | We are not the lender. Lenders decide. |
| Any dollar amount a bank **will** give them | Same. "Up to", with conditions said out loud, is the only safe shape. |
| A bad item **will** come off | Nobody can promise a deletion. |
| "0% interest" / "0% interest business credit" | A competitor's line. Not our offer. |
| "No damage to credit" / "We protect your score" | A promise we cannot keep. |
| "1–2 inquiries max" | A number we do not control. |
| "$50K–$250K" as what they get | A competitor's range. |
| "$8,000" or "$10,000" as our price | Not our offer. |
| "Negatives off in five days" | A competitor's claim. |
| "Overnight letters" | We send expedited US mail. Never say overnight, UPS or FedEx to a bureau. |
| "No denials." | A guarantee. |
| "We won't touch personal credit." | False for the funding path. |
| "You need an LLC / aged corp / DUNS first." | Not our rule. |
| Any made-up win, client count or story | A lie and a compliance block. |

**The one that trips writers up.** "This will not affect you at all" is banned as a blanket promise
about the whole engagement. It is NOT banned to say the soft pull doesn't touch the score — that is
true and all five running ads say it. Keep the promise attached to the soft pull.

> Right: *"No hard inquiry. Soft pull only. Zero impact on your score."*
> Wrong: *"Working with us will not affect your credit at all."*

### Banned words — any form counts (plural, past tense, -ing)

delve · tapestry · leverage · utilize · robust · seamless · realm · testament · beacon ·
underscore · showcase · pivotal · crucial · foster · elevate · embark · unleash · navigate ·
landscape · boast · myriad · plethora · intricate · vibrant · enhance · streamline · optimize ·
comprehensive · empower · holistic · cultivate · resonate · align · nestled

*(Note: "optimize" is banned as ad copy. The deliverable is still named "Credit Optimization
Roadmap" — that is a product name, use it as the product name and never as a verb in the copy.)*

### Banned phrases

in today's fast-paced world · when it comes to · it's important to note · plays a crucial role in ·
at the end of the day · the world of · more than just · unlock the power of · elevate your ·
take it to the next level · supercharge · move the needle · deep dive · low-hanging fruit ·
circle back · best-in-class · in conclusion · a journey · treasure trove ·
the possibilities are endless

### Banned openers — no ad may start with these

imagine a world where · have you ever wondered · picture this · so there you have it ·
let's dive in · here's the thing · here's the kicker · but here's where it gets interesting ·
let that sink in · plot twist · trust me

### Avoid — the market has poisoned these

"lenders compete for you" · "get matched with 75 lenders" as a headline · "fast and easy" ·
"cash advance" as a good thing · "unlimited offers" · "apply now to get calls from our partners" ·
anything hinting several companies will phone them · "secret sauce" · "guaranteed approval"

**Speed is demoted, not dropped.** "Funded in 24 hours" is table stakes now, not a difference. Lead
with trust, earn the speed claim second, and use the real number — about 7 days against an industry
30–45 — not an adjective.

### Words that do work

"no spam calls" · "we don't sell your number" · "soft pull" · "won't touch your credit score" ·
"see your real offers" · "one honest application" · "no equity" · "no daily payments" ·
"know the real cost" · "judged on your business, not just your FICO" · "owners the banks ignore" ·
"bridge the gap" · "before anyone pulls your credit"

### Never name the tech stack. No vendor names, ever. It is "our system", or the name we gave it.

### The compliance rules — these block an ad automatically

**Rules 7–10 fire on every ad and are never optional. Obey them absolutely.**

Rules 1–6 are the credit-repair screen. Whether they fire depends on how the campaign is
classified, not on wording — this is sold as a deliverables product, so they may not fire at all.
**Write as if they do.** They cost nothing to obey and they are all things we could not honestly
claim anyway. The one thing lifted: **"upfront" is no longer banned** — it is a deliverables
purchase, not a fee paid before repair begins. Use it where it's the right word.

1. No guaranteed score increase. No points, no jump, no boost, no score movement of any kind.
2. No promise to remove accurate information. Only wrong or unprovable items can be disputed.
3. Do not name late payments, collections, charge-offs, bankruptcies, repossessions, foreclosures,
   judgments or tax liens as things that come off.
4. Do not promise the letters produce deletions. Six rounds is what they GET, never what it
   achieves.
5. Never mention a CPN, credit privacy number, file segregation, a new credit file or identity, a
   second social, or using an EIN instead of an SSN. Federal fraud, not a wording problem.
6. No guaranteed timeline. Never promise results in any number of days, weeks or months. You may
   say how long the *process* runs — that is a fact about the work, not a promise about the
   outcome.

**Every ad:**
7. No "guaranteed", "100%", "assured" or "everyone is approved" anywhere near approve, accept or
   qualify.
8. No guaranteed dollar figure. "Up to", with the conditions said, is the only allowed shape.
9. No fabricated testimonials. The phrase "results are typical" is itself a block.
10. No income or distress targeting. No "are you broke", "bad credit? no problem", "low-income
    families only", "if you make less than $…". This one catches ordinary-sounding lines — read it
    twice.

**Two more, both keyed on classification, not wording.** A credit-repair funnel must carry the
words "Consumer Credit File Rights Under State and Federal Law", and TikTok bans credit repair
outright. Classified as a deliverables product neither applies. Classified as repair, both do — and
on TikTok there is no wording that gets around it.

### Proof — this is the entire list, do not embroider it

- Close to a decade in business funding.
- Over $25 million secured for our clients.
- Koi Poke — one restaurant, already turned away once, now a franchise with multiple locations.

Anything else is a made-up win, which is both a never-say and a compliance block.

---

## PART 2 — THE ANGLE FORMULA

> **ANGLE = one ENEMY × one MECHANISM × one AUDIENCE**
>
> **HOOK = [Experience or Behavior] + [Emotion] + [Desire Frustration]**
>
> **BODY = [Validate the experience] → [Reveal the mechanism] → [Connect to the desire] → [Proof]**

One enemy. One mechanism. One audience. An ad that argues two things argues nothing.

**The mechanism test — the rule that matters most.** Delete the mechanism from the hook. Does the
hook still make sense? If yes, throw it out. The mechanism has to be doing the work, or a
competitor can run the same ad word for word.

### The cause-first hook test — all four must pass

The hook is the first TWO sentences.

1. **A cause is named by the end of sentence two.** Somebody or something did this, or failed to do
   it. "The guy who got you funded." "Nobody cleaned the file." "Your broker." "The last company."
   A passive sentence with no actor does not count — who is not doing it?
2. **No ask.** No click, book, call, apply, tap, watch, stop, sign up, comment or DM in the hook.
   The hook indicts the alternative. The CTA asks.
3. **No question mark in sentence one.** A question defers the point. State it.
4. **The subject of sentence one is not us.** Not the price, not the product, not the founder's
   record, not the brand. Those go in the body, quickly — just not first.

**One allowed exception:** disqualification openers. "If you're under a 600, this one isn't for
you" passes check 4, as long as a real cause lands by the end of sentence two.

**Three hooks that pass, for calibration:**

- *"If your business got denied for funding, you didn't lose because of your credit. You lost
  because nobody looked at your file the way a bank actually looks at it."*
- *"The guy who got you funded left a pile of hard inquiries on your credit. Ask him when he's
  taking them off. He's not, because he has no way to."*
- *"Round one funded. Round two came back no. That wasn't your credit slipping — that was the
  inquiries round one just created, still sitting on your file when the next batch went out."*

### Hook shapes — rotate these so ten ads don't all open the same way

| Shape | How it opens |
|---|---|
| Dated authority + number | A real figure, stated flat |
| Declare the promise dead | Kill the industry's claim |
| Absolve, blame the system | Take it off their shoulders |
| Insider says the opposite | Contradict what they expect |
| Short mechanism line | State the machine, plainly |

### Match the hook to awareness

| They are | Open with |
|---|---|
| Unaware | Story, identity, pattern interrupt |
| Problem-aware | Agitation — name the pain out loud |
| Solution-aware | Why most solutions fail |
| Product-aware | Proof and comparison |
| Most aware | Direct CTA and offer specifics |

---

## PART 3 — THE VOICE

Study these pairs. Left is a generic AI draft. Right is how Chris actually writes. Match the right
column.

**Hook.**
- Model: "Getting denied for business funding is incredibly frustrating, and it might not even be
  about your credit score at all."
- **Chris: "If your business got denied for funding, you didn't lose because of your credit. You
  lost because nobody looked at your file the way a bank actually looks at it."**
- Why: Chris names an actual actor doing the harm and states it as flat fact. The generic line
  hedges with "might not even be" and blames nobody.

**Body.**
- Model: "Unfortunately, many funding consultants take a one-size-fits-all approach when submitting
  your applications to lenders, which can hurt your chances."
- **Chris: "And then they logged into Experian, pulled up a list of lenders they use for every
  single client, and started blasting out applications."**
- Why: a specific scene you can picture, instead of the abstract phrase "one-size-fits-all".

**Body.**
- Model: "You had big plans for that funding, whether it was growing your business or improving
  your personal life, and now those plans are on hold."
- **Chris: "You had a plan. You were going to take that capital and actually do something with it.
  Scale your ads, build out your team, maybe finally take that trip, pay off some debt, actually
  build the thing your family's been watching you work toward."**
- Why: five concrete, different-sized dreams instead of two generic buckets.

**Hook.**
- Model: "Are you a business owner struggling to secure the funding your company needs? In the next
  few minutes, I'll show you exactly how to get approved."
- **Chris: "If you're a business owner who's been trying to get funding, and you've either been
  denied, gotten the runaround, or you just honestly don't know what you qualify for, I want to
  talk to you for a couple minutes."**
- Why: three specific situations instead of one vague word, and "I want to talk to you" instead of
  opening on a question.

**CTA.**
- Model: "If you're ready to learn more about your funding options, click the link below to get
  started today."
- **Chris: "Click the link below. Fill out a short two minute application. Book your free funding
  strategy call."**
- Why: three flat back-to-back commands with a real number attached.

**Close.**
- Model: "Click below to find out what you may qualify for today."
- **Chris: "Click below. Let's go find out your number."**
- Why: "let's" puts him on their side of the click, and "your number" is a specific thing to go get.

---

## PART 4 — WHAT TO WRITE

### A) Ten ad scripts

**Runtime 60–80 seconds each. Hard max 80. That means 150–200 words of body copy per script.**
Count them.

Ten genuinely different angles — different enemy, different mechanism, or different audience. Not
ten rewrites of one argument. Rotate the five hook shapes.

Use this exact format for each:

```
ANGLE     one line — the enemy × the mechanism × the audience
FOR       who this one is for, one line
AWARENESS unaware | problem-aware | solution-aware | product-aware | most-aware
GATE      600+ | 700+ no negatives | premium | open

HOOK      0–3s     (first two sentences, must pass all four cause-first checks)
BODY      10–60s   Validate → Reveal the mechanism → Connect to the desire → Proof
CTA       last 10–30s   (checkout, never a booked call)
CLOSE     the two promises

WORDS     <count>
```

### B) One VSL — 1 to 2 minutes, bullet-driven

No story arc. No origin story. No sixteen-beat spine.

Structure:
1. Hook — cause-first, same four checks
2. The problem, one line
3. What we do differently, one line
4. All eight deliverables as rapid-fire bullets, one line each
5. The contrast — everyone else sells a course, we hand you the finished file
6. **The refusal.** Mandatory, non-negotiable. The house line is *"I know there are a lot of people
   in this space who will tell you whatever you want to hear to get you on a call. We're not going
   to do that."* Adapt the tail to this funnel — there is no call — but keep the refusal itself
   intact, then give the honest alternative: this doesn't skip the work, it skips the learning.
   The letters still have to go out and the file still has to get optimized. A script without the
   refusal is not ours.
7. CTA
8. Close — the two promises

If a bullet needs a sentence to explain it, cut the bullet.

Then give me a 60-second cut and a 30-second cut of the same thing.

### The CTA — this is a checkout, not a call

The running FundHub ads send people to a two-minute application and a booked call. **These do not.**
This is a $297 product and the ad sells it directly. The CTA is: click, buy it, it's yours.

Keep the *shape* of Chris's CTA — flat back-to-back commands with a real number in them — and point
it at the purchase:

> *"Click the link below. Grab the package. Everything's in your account in [X]."*

Fill in the real turnaround or leave a bracket for Chris. Do not invent a number.

Never send them to "book a free strategy call" — wrong funnel. Never ask them to apply first.

### The close carries two promises, always. Both, in every script.

1. **No hard pull.** Say it as "no hard inquiry", "soft pull only", or "zero score impact".
2. **Nothing happens without their say-so.** Say it as "no obligation", "nothing moves until you
   say so", or both.

Do not reword either one into something new. Use these phrasings or match their shape exactly.
Real examples from the running ads:

- *"Zero score impact. No obligation. Nothing moves until you say so."*
- *"Soft pull only. Zero impact on your score. Nothing moves until you say so."*
- *"There's no hard inquiry. There's no obligation. Nothing moves on your file until you tell us to
  move it."*

---

## BEFORE YOU HAND ME ANYTHING — check your own work

1. Every hook passes all four cause-first checks.
2. Zero banned words, phrases or openers, in any inflected form.
3. No never-say line anywhere.
4. Every script carries both close promises.
5. Every ad is 150–200 words. Count them and print the count.
6. Ten distinct arguments, not ten rewrites of one.
7. No promise of approval, a funding amount, a score result, or a deletion.
8. Six rounds is framed as what they GET, never as what it achieves.
9. No script implies FundHub performs the repair. They send their own letters.
10. The funding number is what their FILE supports, never what a bank will give them.
11. At least one script uses the Frodo / skip-the-journey framing.
12. Read every line out loud in your head. If Chris wouldn't say it, rewrite it.

Give me A first, then B.
