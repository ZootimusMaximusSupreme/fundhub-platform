# VOICE.md — how Chris actually writes, learned over time

## What this file is

This file holds "before and after" pairs. Each pair shows a generic, AI-sounding line next to the
real line Chris actually uses. The point is to teach the ad-script generator Chris's voice so it
does not have to re-learn it from scratch every time someone runs it.

## Who reads this file

The ad-script generator reads this file as an input, before it writes a word — the same way it
reads `RULES.md`. It never opens this file itself. A small loader piece of code hands the generator
the text inside this file. Today that loader reads this one markdown file. Later it might read a row
out of a database instead. If that happens, only the loader changes — the generator's job (learn
from these pairs) and the shape of the pairs (hook, line 2, body, cta, close) stay the same.

## Where the pairs come from

Every real pair in this file is one AI-written ad line next to the words Chris used in its place.
The "Chris wrote" side is always Chris's own words, copied exactly. Nothing under `# Real pairs` is
invented, and no agent ever writes a "Chris wrote" line or a "Why" line for a real pair. The 9 seed
pairs are different; see "The seed pairs" below.

A real pair comes from Chris's own rewrite of an AI line, in one of two places:

1. **Chat.** An AI wrote an ad line (hook, line 2, body, CTA or close) and Chris replaced it with
   his own words in the same chat. Only a true rewrite counts: the AI's draft of a line, and
   Chris's replacement for that same line. A line Chris wrote with no AI draft before it is not a
   pair.
2. **The app.** Chris edits a machine-written line in the Command Center. The app saves the old
   line and his new line, and a weekly job adds the pair here.

Chris said, of the 83 unfiltered chat scripts: *"we dont want those."* Whole scripts are never
pulled into this file, from a chat or from anywhere else. Only before-and-after line pairs are.
Never `CONCEPTS.md`, never `ASSET-BANK.md`, no matter how good a line looks there.

## How a real pair is written

Each real pair goes at the end of `# Real pairs`, in this exact block, one line per field:

```text
## Pair <N> — <kind>
- **Lane:** <lane, or unknown>
- **Model wrote:** <the AI line>
- **Chris wrote:** "<Chris's exact words>"
- **Why:** <Chris's own stated reason, or the words: not given>
- **Source:** chat YYYY-MM-DD
```

- `<N>` is one more than the highest pair number in this file. Pair numbers never repeat.
- A pair from the app has a different Source line: `app edit YYYY-MM-DD, script <first 8 of its
  id>`. Every other line is the same.
- **Why** is only a reason Chris gave himself. If he gave none, it says `not given`.
- This repo is public. A pair never holds a phone number, an email, a client's name, or a dollar
  amount next to a person's name.

## The seed pairs

The 9 pairs under `# Seed pairs — model side written by hand` came first. They are not real edits
Chris ever typed. The "Chris wrote" line in each one is a real, word-for-word quote from
`marketing/ads/CONTROLS.md`, the five ads that are filmed, running, and booking calls at $32–36
today. But the "Model wrote" line next to it was written by hand for this file, to show what a
generic AI draft of the same idea sounds like, and so were the "Why" lines. No agent sat down,
wrote a draft, and watched Chris rewrite it into the "Chris wrote" line. These are starting
examples only. They stay as they are, and their numbers (1 to 9) stay taken.

---

# Real pairs

Real pairs from Chris's own rewrites go here, in the block above. New pairs are added at the end
of this section.

# Seed pairs — model side written by hand

## Pair 1 — hook
- **Lane:** funding600 — general lane. `CONTROLS.md`'s ads are not sorted into a specific gate
  (uwiq, premium, sorting, wl), so this is the closest real lane, not a guess at a narrower one.
- **Model wrote:** Getting denied for business funding is incredibly frustrating, and it might not
  even be about your credit score at all.
- **Chris wrote:** "If your business got denied for funding, you didn't lose because of your
  credit. You lost because nobody looked at your file the way a bank actually looks at it."
- **Why:** Chris's line names an actual actor doing the harm ("nobody looked at your file") and
  states it as flat fact; the generic line hedges with "might not even be" and blames no one.
- **Source:** CONTROLS.md, Ad 1 — Denial Angle

## Pair 2 — body
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** Unfortunately, many funding consultants take a one-size-fits-all approach when
  submitting your applications to lenders, which can hurt your chances.
- **Chris wrote:** "And then they logged into Experian, pulled up a list of lenders they use for
  every single client, and started blasting out applications."
- **Why:** Chris's version is a specific scene you can picture — logging into Experian, a list,
  blasting applications — instead of the abstract phrase "one-size-fits-all approach."
- **Source:** CONTROLS.md, Ad 2 — Broker Burn Angle

## Pair 3 — cta
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** If you're ready to learn more about your funding options, click the link below
  to get started today.
- **Chris wrote:** "Click the link below. Fill out a short two minute application. Book your free
  funding strategy call."
- **Why:** Chris's CTA is three flat, back-to-back commands with a real number attached (two
  minutes); the generic version is one soft, vague sentence with no specifics to act on.
- **Source:** CONTROLS.md, Ad 3 — Competitor Angle

## Pair 4 — close
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** Click below to find out what you may qualify for today.
- **Chris wrote:** "Click below. Let's go find out your number."
- **Why:** Chris's close uses "let's," putting himself on the reader's side of the click, and calls
  the outcome "your number" — a specific thing to go get — instead of the flat "what you qualify
  for."
- **Source:** CONTROLS.md, Ad 1 — Denial Angle

## Pair 5 — hook
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** Are you a business owner struggling to secure the funding your company needs?
  In the next few minutes, I'll show you exactly how to get approved.
- **Chris wrote:** "If you're a business owner who's been trying to get funding, and you've either
  been denied, gotten the runaround, or you just honestly don't know what you qualify for, I want
  to talk to you for a couple minutes."
- **Why:** Chris names three specific situations (denied, runaround, don't know what you qualify
  for) instead of one vague word ("struggling"), and says "I want to talk to you" instead of
  opening on a question.
- **Source:** CONTROLS.md, The Founder VSL

## Pair 6 — body
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** You had big plans for that funding, whether it was growing your business or
  improving your personal life, and now those plans are on hold.
- **Chris wrote:** "You had a plan. You were going to take that capital and actually do something
  with it. Scale your ads, build out your team, maybe finally take that trip, pay off some debt,
  actually build the thing your family's been watching you work toward."
- **Why:** Chris lists five concrete, different-sized dreams (ads, team, a trip, debt, family
  watching) instead of the two generic buckets "business growth" and "personal life."
- **Source:** CONTROLS.md, The Founder VSL

## Pair 7 — cta
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** Click the link below to apply and schedule a call with our team to discuss your
  funding options.
- **Chris wrote:** "Click the link below. Fill out the short application. And book your free
  funding strategy call."
- **Why:** Chris keeps it as three short steps in the order you'd actually do them; the generic
  line folds all three into one sentence and swaps "book your call" for the vaguer "schedule a
  call... to discuss."
- **Source:** CONTROLS.md, The Founder VSL

## Pair 8 — close
- **Lane:** funding600 — general lane. Same reasoning as Pair 1.
- **Model wrote:** If you've been applying without success, we can help you understand what's
  really going on with your file.
- **Chris wrote:** "If you have been applying and not getting anywhere, the file knows why. Let us
  show you what it says."
- **Why:** Chris gives the file itself a voice ("the file knows why... what it says") instead of
  the generic "we can help you understand."
- **Source:** CONTROLS.md, Ad 4 — Blind Application

## Pair 9 — hook
- **Lane:** funding600 — unclear. Script 8 sits in `CONTROLS.md` but is not one of the five ads on
  the "filmed and running" list at the top of that file (that list is Ad 1–4 and the Founder VSL).
  It is included here only because the task asked for it by name, using `RULES.md` section 2.2,
  which grades this exact hook. Do not treat it as a sixth running ad.
- **Model wrote:** In today's fast-paced world, are you about to submit another funding
  application? Wait — you'll want to see this first.
- **Chris wrote:** "Stop. Before you fill out another funding application... watch this."
- **Why:** This pair is built differently from the other eight, so read this note before using it.
  `RULES.md` section 2.2 grades this exact real Chris line as **failing** the cause-first hook
  test — it asks twice ("watch this") and never names who or what caused the problem, which is
  check 1 and check 2 of that test. This pair is not "here is the good version" the way the other
  eight are. It is here to show a difference in *sound* only: short, blunt commands ("Stop.") next
  to a padded AI-style question with a banned opener phrase ("in today's fast-paced world"). Do
  not use this pair to teach hook structure — for the actual fix to this hook, see `RULES.md`
  section 2.2, which says to lead with why the last application failed, then earn the "stop."
- **Source:** CONTROLS.md, Script 8 — Stop Before You Apply Again; graded in RULES.md section 2.2
