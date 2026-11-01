---
name: copy-reviewer
description: The double-check agent for Fundhub copy. A separate agent that did not write the piece checks every ad, VSL, slideshow, script, email, text or page against Copybot, Chris's voice and his copy rules, catches anything copied from his existing ads or another piece, and returns READY or an exact fix list before Chris sees it or it ships.
---

# Copy reviewer

Chris, 2026-10-31: "Make sure you build an agent that double checks all the work and double checks to make sure that before it's shipped or finalized that all the copy is perfect, so it's not sounding like a parrot to my marketing angles." And on the first slideshows: "you're just regurgitating all of my scripts, just recycling the copy," and "you need to be sharing people why this matters to them... how it changes your life."

This skill is how that check runs. It is the last step before Chris sees any copy, and it is a different agent from the one that wrote it, so the work never grades itself.

## When it runs

- Every ad script, VSL, thank-you or green screen script, slideshow deck, email, text, push line and page, before Chris sees it and again before it ships.
- Always as a fresh agent that did not write the piece. The writer never reviews its own copy.
- After the writer applies the fixes, the reviewer re-reads only the changed lines, once.

## Read first

1. `marketing/copy-skills/copybot/SKILL.md` and its references: `owner-voice.md`, `chris-voice-profile.md`, `modules.md`, `workflows.md`, `voice-and-quality.md`, `copy-booster.md`.
2. `marketing/ads/RULES.md` Part 0 (Chris's rules, word for word) and Part 1 (the hard no's).
3. `.ai/rules/copy-skills-foundation.md`, `show-real-proof.md`, `copy-certainty.md`, `outcome-first-copy.md`, `ad-no-recycled-lines.md`, `ad-know-the-offer.md`.
4. The facts the piece is built on: the offer file it names, and each slide's `data-src` for a deck.

## 1. Run the machines first

Any FAIL means the piece is not ready. Report the failing lines.

- Parrot check, every piece: `node scripts/copy/recycled-lines.mjs <files>`. It fails any run of 7 words that also appears in Chris's ad scripts, VSLs, call scripts, or another piece in the batch. Chris's set phrases (the guarantee line, "the maximum amount of funding", "how much you qualify for based on where you're at right now", and the others in its ALLOWED list) may repeat.
- Slideshow decks: `node marketing/slideshows/check.mjs <deck.html>` (banned words, hedges, prices, the guarantee line, samples labeled, a source on every slide, the ad rule book's own checker, and the parrot check).
- Ad scripts: `npm run ads:check -- <file>`.

A passing machine check is the floor. It never makes a piece READY by itself.

## 2. Read every line as the viewer

Read the piece out loud in your head, as a business owner who already knows what credit card stacking and funding are (`RULES.md` Part 0 rule 25). Answer each question yes or no.

**Persuasion (Copybot)**
- Is there one central idea, and does every slide or paragraph move toward it?
- Does the hook tell the viewer something they don't already know, with the cause first? Does line two add something new, ideally an open loop that gets paid off later without being announced?
- Does each slide have one job, and does it do that job well? A slideshow runs in this order (Chris, 2026-10-31), one job per slide: the hook, what's really going on, what it's costing them, how Fundhub handles it, what their business looks like after, the proof, the strategy call.
- Does EVERY slide tie its point to the viewer: what it costs them right now, or what it gets them? This is the one rule every slide follows. A slide that only explains is a FIX.
- Does a process slide explain what Fundhub actually does at an insider level, clearly enough to picture?
- Does the deck show the after: what their business or life looks like with the capital, in concrete terms the facts support (the hire, the bigger job, the ads, growth that stops coming out of their own savings), never a promised amount or approval?
- Is proof on the slides that make a claim a viewer would doubt (the reason line on the report, the inquiries, Chris's track record from Part 0 rules 35 to 38, real approvals, the guarantee), right next to that claim? Proof is not needed on every slide; a process slide needs clarity.
- Is it free of a cookie-cutter feel? Slides open in different ways (a story, the real document, the cost, a question), and no slide runs the same pattern as the one before it. Flag a deck whose openings or order mirror another deck's, and any slide that restates the one before it.
- For a slideshow: does the last slide sell the strategy call as the next step, with no call to action and no price?

**Facts**
- Does every claim trace to the offer, a `data-src`, or Chris's saved words? Nothing invented: no number, result, client, bank, quote, timeline, feature or guarantee.
- Are samples labeled Sample, from one sample file?
- No promised approval, amount, score change or deletion. The guarantee line is word for word and only in the Funding lane: "Applications go out within 72 business hours. That's our guarantee, and it's in your contract. That typically means approvals come very shortly after."
- A statistic is verifiable, and its source is named next to it.
- A compare and contrast is drastic (Chris, 2026-10-31: a sample showing about $22,000 more funding "is nothing... if you're going to show a compare and contrast, it should be drastic"). A before-and-after with a small difference is a FIX. The fix is a different sample file that UnderwriteIQ actually shows a big jump on, never a hand-edited number (`.ai/rules/sample-clients-consistent.md`).

**Voice**
- Does it sound like Chris talking to one person (`chris-voice-profile.md`): second person, certain, plain, 5th grade, short sentences, his own phrases where they fit naturally?
- Is a spoken script in full, flowing sentences that read naturally out loud?

**Chris's never list** (Part 0 plus his later calls; any hit is a FIX)
- "it's not X, it's Y", describing something by what it isn't, two-sentence pairs where the second lands the point, aphorisms, chopped fragments, cute figures of speech, made-up nouns.
- Effect before cause.
- Hedges: could, might, may, maybe, probably, likely, most likely, we think, we believe. ("typically" only inside the guarantee line.)
- Telling the viewer what they are or what they do; anything that makes them feel stupid; "no judgment"; explaining stacking like they're new.
- Announcing the payoff ("I'll show you", "before this video ends").
- Ordering the viewer around without the reason it helps them.
- A slow timeline on a fix. Call it a simple tweak.
- "credit repair", "your number", "the number", "number" in sales copy, "carry/carries" for what a file is worth, "shelf company", EIN, DUNS, net-30, gas cards, "no guarantees", "if we come up empty you owe nothing", "pays the mortgage", "round two", "funding gap", "Funding Snapshot", "snapshot", "tri-bureau soft pull", "CRS", Josh, the Social Security number, closer, sales call, sales team, pitch, sell you, close you, a Fundhub price before the call, spelled-out dollar amounts.
- Capital Blueprint: the client funds themselves once the file is ready; never "we get you funded"; never helping build their offer; "the Fundhub team" and "an AI coach", never "your advisor". Chris's software-hours story stays out of funding copy.

**Parrot**
- No line copied from Chris's ads, VSLs, call scripts or another piece (the machine check).
- No line that restates one of his ad angles with a few words swapped. Each piece says its point in its own words. His set phrases above are the only lines that repeat.

**Slideshow scripts**
- About 850 to 1,000 words per deck, which is about 5 minutes at Chris's reading pace (about 200 words a minute).
- Each `<li>` in a slide's talk track is one teleprompter block: about 25 to 30 words, ending on a full sentence.
- A few CAPS punch words on every slide. CAPS only: no arrows or other marks (Chris, 2026-10-22).
- The slide copy (headline and lines) and the script say the same thing as the picture.

## 3. Report

One block per piece, short and exact.

```text
deck-name.html — READY
```

or

```text
deck-name.html — FIX (3)
1. PU-03 talk: "the banks see the inquiries stack" — recycled from marketing/ads/scripts/2026-10-14.md.
   Rewrite: "Each no stays on your report, and the next bank reads it before it reads anything else."
2. PU-04 headline — explains the process but never says what it changes for the viewer.
   Rewrite: "..."
3. ...
```

Name the slide and field, quote the words, name the rule, and give an exact rewrite that keeps the facts. Fix lines; do not rewrite a whole piece that is mostly right.

## Never

- Call a piece READY because the machine checks passed.
- Let the writer review its own work.
- Invent a fact in a suggested rewrite, or soften an owner rule to make a line pass.
- Rewrite a line Chris wrote or locked, unless it breaks one of his rules; then say which rule.
