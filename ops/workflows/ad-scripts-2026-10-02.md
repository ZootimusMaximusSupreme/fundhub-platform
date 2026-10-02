# Board — ad-scripts-2026-10-02

Six new ad scripts (3 for the $297 roadmap, 3 for the book-a-call sorting hat), the full ad and VSL inventory, and a B-roll animation kit.

- **Branch:** `ad-scripts-2026-10-02`. Never push (owner-set 2026-09-09). Do not merge to main.
- **Work folder:** `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad-scripts-2026-10-02`. It is a separate checkout of the repo. Other sessions are editing the main folder on `main` right now, so this batch never touches the main folder's branch.
- **Who edits this board:** W1 only. Helpers write their own file in `ops/workflows/ad-scripts-2026-10-02/` and W1 copies status here.
- **Chris said:** "proceed until complete. Dont ask me questions." So no approval stops. The preview PNGs are still made first, and the MP4s render after them.

## Status

| Unit | What it owns | Status | Output |
|---|---|---|---|
| W1 | Reference files, board, Brief, final scripts file, inventory, checker, commit | claimed | this board · `marketing/ads/scripts/2026-10-02.md` · `marketing/ads/INVENTORY-2026-10-02.md` |
| W2 | 3 new $297 roadmap ads | claimed | `ops/workflows/ad-scripts-2026-10-02/w2-slo.md` |
| W3 | 3 new book-a-call (/watch) ads | claimed | `ops/workflows/ad-scripts-2026-10-02/w3-watch.md` |
| W4 | Which ads ran on Meta and their results, plus every VSL | claimed | `ops/workflows/ad-scripts-2026-10-02/w4-findings.md` |
| W5 | B-roll kit in Remotion: license, templates, previews, shot lists, MP4s | claimed (phase 1) | `marketing/broll/` · `ops/workflows/ad-scripts-2026-10-02/w5-status.md` |

## Path corrections (measured 2026-10-02)

- `docs/ads/` does not exist. Every `docs/ads/...` path in the ask is `marketing/ads/...` (the 2026-10-01 "where things live" table in `CLAUDE.md`).
- `docs/ads/fundhub-297/INDEX.md` is `marketing/ads/slo/fundhub-297/INDEX.md`.
- `marketing/ads/scripts/` held only a one-line README. There is no `2026-10-01.md`.
- The two reference files did not exist. W1 saved them from Chris's paste: `marketing/ads/reference/locked-ads-2026-09.md` and `marketing/ads/reference/vsl-scripts-latest.md`.
- The live /roadmap page copy is `marketing/landing-pages/slo/slo-01-sales.html`.
- The checker is `npm run ads:check -- <file>` (`scripts/ads/check-script.mjs`, rules in `marketing/ads/rules-data.mjs`).

## The ask (Chris, 2026-10-02, verbatim)

> Write 6 new ad scripts: 3 for the $297 SLO (/roadmap) and 3 for the sorting hat (/watch book-a-call). Work through these steps in order and save everything in the repo.
>
> STEP 1: GATHER CONTEXT
> - Read CLAUDE.md and everything in docs/ads/: WRITE-ADS-FROM-HERE.md, RULES.md, VOICE.md, NEXT.md, README.md, fundhub-297/INDEX.md, the scripts/ folder, and the reference/ folder. Follow the bridge and open-loop spec exactly for line 2 of every ad.
> - Read docs/ads/reference/locked-ads-2026-09.md (locked ads 1–8, shorts, bullet VSL, house rules) and docs/ads/reference/vsl-scripts-latest.md (the 9/30 /watch VSL and thank-you video, and the old 9/20 SLO VSLs).
> - Where older repo rules conflict with these, the newer rules win: proof is a decade, hundreds of files, thousands of data points, and the million I've funded for myself (no $25 million, no Koi Poke). No "Not another ___, but..." openers. "Credit optimization" is the company term; as a verb, say "fix your file."
> - Find every ad we've written or run: everything in docs/ads/ (including the prop ads 9–20 and docs/ads/scripts/2026-10-01.md if it exists), plus any other ad files in the repo. If Meta Marketing API access is set up, pull which ads actually ran and their results, and mark each script as ran, approved, or draft.
> - Find all of our other VSLs, for both funnels: search the repo for "vsl", "VSL", "video sales letter", "watch", and "roadmap video", and check the videos embedded on the live /roadmap and /watch pages. Check the Google Drive VSL scripts doc (file ID 1Mkxc4eQr54IRC8U3AYR3jtm5ixoHoEqVVBNkqkcr4nY) if you have Drive access. List every VSL with its path or URL, funnel, and status. Both live VSL videos are being replaced: /watch with the 9/30 script, and the SLO with a rewrite.
> - Read the live /roadmap page copy (slo-01-sales.html) and the /watch funnel pages.
> - Write a short summary of every angle, hook, and loop payoff already used, so the new ads don't repeat any of them.
>
> STEP 2: 3 NEW SLO ADS
> - Match the /roadmap page so a click lands on the same promise. Reuse the page's own words: "get funding forever," "you'll never need anyone to fund you again," the 13 hidden data points, apply in the right order, and the deliverables. Don't match the old SLO VSLs.
> - Hook direction to build from: "There are 13 hidden data points that get a 760 file an additional $100,000 in low-interest funding." Sell the outcome as a roadmap that lets them get funded again and again for the rest of their life.
> - One of the three uses the economy angle. Interest rates are going up (the Fed raised rates in September 2026, its first hike since 2023). When rates rise, banks tighten, and money gets harder to get. Having a plan and a strategy for your credit file matters more than ever right now.
> - Each takes an angle no existing ad uses.
> - About 150 words (roughly 1 minute; up to 1:15 is fine).
> - End with the $297 roadmap and "If you're not happy with what you get, email us and we'll refund you." Never state a day count.
>
> STEP 3: 3 NEW SORTING HAT ADS
> - Each speaks to one specific situation, because Andromeda uses the ad's message to find its audience:
>   1. Low score or a file that needs work
>   2. Strong score and income, wanting the maximum amount of funding
>   3. Already funded and wanting the next funding sequence, or unsure where they stand
> - Work the rising-rates point into at least one: when rates go up and banks tighten, knowing exactly where you stand and what to do next matters more than ever.
> - Each ends on: wherever you are in the funding process, Fundhub has a solution for that, so hop on a call and we'll figure it out.
> - 115 to 125 words, no introduction of who I am, plain and direct.
> - Keep it consistent with the 9/30 /watch VSL: the condition of your credit, the small details in your file, removing inquiries between funding rounds, and the three paths.
>
> RULES FOR EVERY SCRIPT
> - Hook on line 1: cause before effect, and it must tell the viewer something insightful they don't already know. Model line: "The condition of your credit determines where you are in the funding process."
> - Line 2 is a bridge built as an open loop: name something the viewer doesn't know yet, hold it across several lines, and pay it off later in the ad. Never resolve the loop in the same sentence. No greeting, re-intro, credentials, or restating the hook.
> - Speak with 100% certainty. Never use "could," "could be worth," "might," "may," "possibly," or "up to." State what the roadmap does and what the data shows as fact.
> - Second person, straight at the viewer. Never make them feel stupid.
> - Natural spoken paragraphs for a teleprompter, with full flowing sentences. No line break after every sentence. No em dashes.
> - Never use: "it's not X, it's Y" lines, describing something by what it isn't, two-sentence parallels, slogans, cute imagery, "credit repair," "your number" or "the number," "carry," "no guarantees," EIN, DUNS, net-30, or "round two" (use "funding sequence").
> - Use "I'm Chris, I run Fundhub" on at most one ad per set.
>
> STEP 4: SAVE AND CHECK
> - Save the 6 scripts to docs/ads/scripts/2026-10-02.md, following the format of the other files in docs/ads/scripts/, with a table listing each ad's angle, hook, loop line, where the loop pays off, and the page section or VSL part it matches.
> - Save the full ad inventory from Step 1 (every ad, its status, and the VSL list) to docs/ads/INVENTORY-2026-10-02.md.
> - Run npm run ads:check, fix anything it flags (except rules that conflict with the newer rules above, which you list instead), re-read every script against the rules, and report the word count for each.
> - Commit everything, including the two reference files, to a new branch named ad-scripts-2026-10-02 and push it. Don't merge to main.
>
> STEP 5: ANIMATIONS (B-ROLL), AFTER THE SCRIPTS ARE SAVED
> - Read every script: the 6 new ones, the locked ads, the prop ads, and the VSLs. List the visual moments that repeat most, like how much they qualify for today and once optimized, items on a credit report, the 13 data points, inquiries coming off between funding rounds, the lender list, approvals, the step-by-step path, and interest rates going up. Pick the 6 to 8 that show up most.
> - Set up a Remotion project in marketing/broll/ and build one reusable template for each of those moments. Check the Remotion license terms and tell me the cost, since Fundhub has more than 3 people.
> - Brand style: lowercase "fundhub." wordmark with the period, Inter font, white background with a faint grid, blue #3D86F0 as the accent, and the small yellow-green-blue gradient dash from the landing page. Vertical 1080x1920. Keep all text out of the top 14% and bottom 35% of the frame, where Instagram and Facebook put their buttons and captions.
> - Motion: smooth and quick, one idea per clip, 2 to 3 seconds each. Premium and clean, never busy.
> - Render a PNG still of each template first and save them in marketing/broll/previews/ so I can approve the look before anything renders as video.
> - Then, for each of the 6 new scripts, write a shot list: which line gets which template, the exact text or number in it, and the approximate timestamp at 150 words per minute so I can drop each clip into Submagic under My B-rolls. Render those clips as MP4s.
> - If PEXELS_API_KEY is in .env, also pull one or two matching free stock clips per script. If it isn't, list search keywords instead.
> - Commit the templates, shot lists, and preview PNGs. Add the rendered MP4s to .gitignore so the repo doesn't get bloated, and tell me the folder they're in.

**Push:** the standing rule (owner-set 2026-09-09) says never push. This batch commits to the branch and does not push.

## Brief (W1) — status: DONE

Read by W1: `CLAUDE.md`, `marketing/ads/` (WRITE-ADS-FROM-HERE, RULES, VOICE, SECOND-LINE, NEXT, README, CONTROLS, CONCEPTS, ASSET-BANK headings, rules-data.mjs, scripts/README, slo/fundhub-297/* , slo/trigger-maps, ascension), both reference files, `scripts/ads/check-script.mjs`, the live /roadmap page (repo copy matches live on every key phrase, checked 2026-10-02), the /watch funnel pages, the Haynes Drive SOP "Bridge from Hook to CTA", and Chris's saved copy decisions.

### B1. Exact paths

| What | Path |
|---|---|
| Ad rules (prose) | `marketing/ads/RULES.md`, `marketing/ads/VOICE.md` |
| Line 2 spec | `marketing/ads/SECOND-LINE.md` |
| What the checker really enforces | `marketing/ads/rules-data.mjs`, `scripts/ads/check-script.mjs` |
| Locked $297 ads 1–8, shorts, bullet VSL, house rules | `marketing/ads/reference/locked-ads-2026-09.md` |
| 9/30 /watch VSL + thank-you video; old 9/20 SLO VSLs | `marketing/ads/reference/vsl-scripts-latest.md` |
| Live /roadmap page | `marketing/landing-pages/slo/slo-01-sales.html` → https://apply.fundhub.ai/roadmap/ |
| /watch funnel pages | `marketing/landing-pages/01-vsl.html` (hero), `02a-apply-top.html`, `04a-book-top.html`, `05-thank-you.html` |
| Older $297 drafts (not locked) | `marketing/ads/slo/fundhub-297/FundHub-297-Ads-2026-09-18.md`, `FundHub-297-Ads-v2.md`, `FundHub-297-Final-Ten.md` |
| Live book-a-call ads + 48 concepts | `marketing/ads/CONTROLS.md`, `marketing/ads/CONCEPTS.md` |
| Prop ads 9–20 | **Not found.** Not in the repo, any branch's history, the Claude Doc the locked ads came from, or Google Drive (searched 2026-10-02). |

### B2. The rule set for these six (Chris's 2026-10-02 rules sit on top and win)

1. **Line 1 hook.** Cause before effect. It tells the viewer something true they do not already know. Model: "The condition of your credit determines where you are in the funding process." Also from RULES.md 2.2: no question mark in sentence one, no ask in the first two sentences, sentence one is not about us (not the price, the product, Chris, or Fundhub).
2. **Line 2 is a bridge built as an open loop.** Name one thing the viewer does not know yet. Hold it across several lines. Pay it off later in the ad, by name. Never resolve it in the same sentence or the next one. Line 2 never carries a greeting, a name, credentials, a restated hook, or an ask (SECOND-LINE.md). Haynes' SOP: the bridge reassures them you can deliver on the bold first line.
3. **Full certainty.** Never: could, could be worth, might, may, maybe, possibly, potentially, up to, or any other hedge. State what the roadmap does and what the data shows as fact.
4. **Second person, straight at the viewer.** "You", never "most business owners". Never make them feel stupid. Blame the industry, never the owner.
5. **Teleprompter paragraphs.** Full flowing sentences, three to five paragraphs. No line break after every sentence. No em dashes, no " -- ".
6. **Never write:** "it's not X, it's Y"; describing a thing by what it isn't ("there's no call here", "nobody pitches you", "this isn't a course"); two-sentence parallels ("Sometimes it's one item. Sometimes it's twelve." as two sentences); slogans; cute imagery ("road to riches", "green light to shovel money", "conveyor belt"); "Not another ___, but…"; credit repair (or "repair"); your number / the number / any use of "number"; carry (any form); no guarantees; EIN; DUNS; net-30; vendor accounts; gas cards; round two (say "funding sequence"); Social Security number or SSN; "funding gap" (say "left on the table"); "0% interest".
7. **Proof is only:** a decade (or ten years), hundreds of files, thousands of data points, and the million Chris funded for himself (9/30 VSL wording: "a little over a million dollars for myself"). No $25 million. No Koi Poke. No "tens of thousands".
8. **"Credit optimization"** is the company term (noun). As a verb, say "fix your file". Never "optimize/optimized/optimizing" — the checker bans every form.
9. **"I'm Chris, I run Fundhub"** on at most one $297 ad. Never on the sorting-hat ads (Chris: no introduction).
10. **Company name:** Fundhub. Product name UnderwriteIQ is allowed (it is ours). No vendor names.
11. **Lead with funding, never the score going up.** The $297 roadmap is not credit repair. "Unlimited funding" is allowed (owner).
12. **Approved phrases:** maximum amount of funding, maximum fundability, 10x your file, left on the table, funding sequence, fix your file, credit optimization, get funding forever, you'll never need anyone to fund you again.

### B3. What the checker will flag (run `npm run ads:check -- <file>` from the work folder)

- A script is found only under a `## Ad <digit> …` heading. Everything under that heading until the next heading is read as spoken words. Keep notes under a separate heading that does not start with "Ad" and does not contain the letters VSL.
- **Close promises (both must appear somewhere in the script):** one of `soft pull only` / `zero impact on your score` / `zero score impact` / `no hard inquiry`, and one of `nothing moves until you say so` / `no obligation`. Put both in one plain sentence, e.g. "We pull your credit with a soft pull only, zero impact on your score, and nothing moves until you say so."
- **Never-say patterns:** a `$` amount followed by "will" in the same sentence (e.g. "The $297 roadmap will…" fails); "will/’ll … come off"; the literal "$10,000" and "$8,000"; "we'll get you funded"; "your score will go up".
- **Banned words, any form:** optimize, navigate, landscape, leverage, crucial, pivotal, enhance, streamline, comprehensive, align, unleash, elevate, empower, robust, seamless, foster, boast, realm, delve, showcase, underscore, utilize, embark, myriad, plethora, intricate, vibrant, holistic, cultivate, resonate, nestled, tapestry, testament, beacon. **Phrases:** when it comes to, at the end of the day, more than just, the world of, a journey, move the needle, take it to the next level, deep dive, low-hanging fruit, circle back, best-in-class, in conclusion, treasure trove, unlock the power of, elevate your, supercharge, it's important to note, plays a crucial role in. **Openers:** imagine a world where, have you ever wondered, picture this, here's the thing, here's the kicker, trust me, let that sink in, plot twist, let's dive in.
- **Floor:** 135 words (60 seconds at 150 wpm, minus 10%). The sorting-hat ads at 115–125 words will be flagged "too short". That flag conflicts with Chris's newer rule. Keep his word count and list the flag. Do not pad.
- Word count = the checker's own count (`[A-Za-z0-9'’$%-]+`). Count with: `node -e 'const t=require("fs").readFileSync(0,"utf8");console.log((t.match(/[A-Za-z0-9\x27’$%-]+/g)||[]).length)' < file.txt`

### B4. The /roadmap page promise (match this so a click lands on the same promise)

- **Hero:** "I'll Show You How to Get Funding Forever!" / "You'll never need anyone to fund you again." Button: "Get My $297 Funding Roadmap". Under it: "Soft pull only. Score doesn't move."
- **How It Works:** "Get Every Dollar Your File Can Get. Then Do It Again, On Your Own."
  1. **See what you qualify for today** — "Know what you can get before a bank ever sees your file." Soft pull; roadmap in your portal; "Even with perfect credit, your roadmap reveals the 13 hidden data points that transform a decent file into one that can secure an additional $100,000+ in low-interest funding."
  2. **Find the gap and optimize your personal credit** — "Stop losing money to items nobody told you about." "$100,000 to $300,000 in fundability" left on the table; every item costing money on all three bureaus: "inquiries, names and addresses that don't match, and your business info"; send the letters.
  3. **Build the trust in the business** — "Lenders fund businesses that look solid." Experian Business report: liens, bad marks, high card balances, business score, name, address, NAICS code; the exact fix for each, website included.
  4. **Set up the businesses** — "Never need anyone to fund you again." Open and set up a business the right way with all the right data points, so lenders approve you instead of asking for income verification; repeat company after company.
  5. **Apply in the right order** — "Get approved, not declined." The banks that approve files like yours, in order, for every business; stack approvals across multiple businesses.
- **The six deliverables (checkout):** How Much You Qualify For (today and once your file is fixed) · Credit Analysis Report (what's hurting your file, item by item, all three bureaus) · Credit Optimization Roadmap (what to do first and what comes after, month by month) · Dispute Letter Pack (every letter written for your accounts, all six rounds, ready to mail) · Bank & Lender Match List (the banks most likely to approve you where you live, and the order to apply) · FREE BONUS Business Duplication Map (how you go from one company to five or ten, each one funded).
- **FAQ line worth echoing:** "Even an 800 file has hidden data points that cap how much you get. Your roadmap finds all 13 and gives you the fix for each one. Then you repeat it with every company you open."
- **The 13 data points:** the repo never lists all 13. Name only the examples the page names: hard inquiries, names and addresses that don't match across the bureaus, business info (business score, liens, bad marks, high business card balances, business name and address, NAICS code, website). Never invent a fourteenth or a list of 13.
- The page's refund line says "within 7 days". Ads never state a day count.

### B5. The /watch funnel and the 9/30 VSL (match this for the sorting hat)

- **Page hero:** "For Business Owners Who Need Real, High Volume Funding" · "Find out exactly what your business qualifies for in one call" · "10-second application · Soft pull · Zero score impact". Book page: "a live Google Meet, and we run a soft credit pull on the call — zero score impact." Thank-you: "You get one of three roads."
- **9/30 VSL parts (name these in the match column):**
  - **P1 Open** — the condition of your credit decides $10,000–$50,000 versus $100,000–$1,000,000 across multiple businesses; small details (personal data, business codes) hold back even an 800; one step most people miss.
  - **P2 Scenarios** — bank denied you and nobody said why; someone sent your file to every lender on their list; you never applied because you didn't want a hard pull.
  - **P3 Common cause** — nobody reviewed your credit the way a lender does before applications went out.
  - **P4 UnderwriteIQ** — reviews your file like a lender, catches the small details, matches thousands of lenders to the thirty to fifty that fit, applies in funding rounds in the order that protects your score.
  - **P5 The missed step** — removing the hard inquiries between each funding round; inquiries left on make the next lender approve less; one good round, then a wall.
  - **P6 Funding sequence** — inquiries removed between rounds keep a funding sequence going three to six rounds.
  - **P7 Three paths** — file ready: we go get the capital (advisor starts within 24 business hours, first applications within 72, upfront fee only once confirmed qualified); something holding it back: we show you what, fix your file, fund you once it's ready; do it yourself: the steps in order to a prime file, fix how your companies are set up, open or age companies, a detailed accountability system, and we fund with you when it's ready.
  - **P8 Data** — hundreds of files, thousands of data points on what lenders approve.
  - **P9 Next step** — ten-second application, pick a time, Google Meet, tri-bureau soft pull with your advisor, zero impact on your score; you see what you qualify for now, what's holding it back, the fastest way to the maximum amount of funding.
- Most people aim for $250,000 to $400,000; some files are ready today and many aren't, which is normal.

### B6. Angles, hooks and loop payoffs already used — do not reuse any

**Locked $297 ads (approved; Ad 1–7 filmed as SLO Ads 1–7, registry ids 84–90):**
Ad 1 full offer read (no loop; offer first) · Ad 2 declined and nobody told you why → "I'll tell you exactly why" · Ad 3 you don't know what your file is worth → "I'll tell you what yours is worth" · Ad 4 one card holding the file down → which card and the paydown balance · Ad 5 max fundability, two sides of the file → personal and business, resolved in the next sentence · Ad 6 you already know your file decides funding → the gap is a couple hundred thousand (card too high, items, personal data mismatch) · Ad 7 the call that was never a roadmap → "the roadmap was never the product" · Ad 8 abandoned cart → four questions (what you get, what you do, how long, risk), first round was $11,000 in Chase cards.
**Shorts:** tired of people who don't know what they're talking about · everybody gatekeeps this · worth two or three hundred thousand and you're getting fifty · declined, nobody told you why · call was a pitch · one card · ten years in a $297 package.
**Old 9/20 SLO VSLs:** "your file could be worth a million" → what it's worth, small tweaks nobody told you, $297 vs a five-figure course; VSL 2: run it yourself or we run it with you, funding stops being something you chase once.
**Older $297 drafts (never locked):** price anchor (course costs $5–20k) · disqualifier (clean credit, book a call) · callout (getting ready for funding) · thirty-second cut · circumstance (no time to learn credit) · disputing with a template · 700+ came back small · still scrolling · ten seconds · the hours · wrong sequence of fixes · the data · timeline was a sales answer · one payment vs monthly billing · you hold the receipts · the levers on a 700 file · where you live (geography of the lender list) · $297 against the course · the call was a sales call · the shotgun · two moves away · the read without the call · pull it and find out.
**Live book-a-call ads (CONTROLS):** denial (nobody looked at your file the way a bank does → "it comes down to one thing: nobody ran your file through the same system a bank uses") · broker burn · competitor ("it's not talent") · blind application (what a bank sees vs Credit Karma) · insider access · stop before you apply · why I built this · the Founder VSL.
**48 concepts (CONCEPTS.md):** who takes the inquiries off · the wrong item first · nobody can promise a deletion · the no is still talking (last year's inquiry) · the handoff · Experian login · you don't need a business (unused LLC) · four exits · built to bring you back · one shot or twelve · price after forty minutes · nobody types your revenue · 24 and 72 hours · under 600 not for you · the same twelve banks · the order you apply in · learning on your file · they took the swing anyway · seven days · a card on his board · what a clean file buys · one cell number · ask them how they protect credit · merchant advance · nobody remembers forty files · my own file first · which bureau they pull · round one funded, round two came back no · the application you never sent · speed of your bank account · twenty-five on a 720 · nobody ran it · not a loan processor · seven hundred and clean · seventy-five files at once · a thousand hours · the clock on us · I turn most people down · thirty days is a bank · an 800 survives two rounds · two answers end the call · nobody stacks $200K in one shot · nobody gets your login · thirty-two dollars · somebody else's credit file · nobody teaches the order · two hundred first · thirty days by law.
**9/30 /watch VSL loop:** "one step most people miss… I'll show you in a couple of minutes" → removing hard inquiries between funding rounds. A sorting-hat ad may state inquiry removal as a fact, but must not reuse this loop.

### B7. Open lanes nobody has run (suggestions, not orders)

- **$297 set — all three sell the page's promise (the 13 hidden data points, and a roadmap that gets you funded again and again for life):**
  - A strong file still leaves money on the table — open on Chris's hook direction nearly word for word: "There are 13 hidden data points that get a 760 file an additional $100,000 in low-interest funding." Loop on one data point the page names, paid off later.
  - The economy angle (required in one ad): rates are going up; when rates rise, banks tighten and money gets harder to get; the files that still get the low-interest money are the ones set up right; a plan for your file matters more than ever now.
  - Funding forever, company after company: how a business is set up on paper decides whether a lender approves it or asks for income verification; the Business Duplication Map; one company to five or ten, each funded; you'll never need anyone to fund you again.
- **Sorting hat — one situation per ad (Andromeda finds the audience from the message):** (1) low score or a file that needs work; (2) strong score and income, wants the maximum amount of funding; (3) already funded and wants the next funding sequence, or unsure where they stand. Rising rates go into at least one. Every one ends: "Wherever you are in the funding process, Fundhub has a solution for that, so hop on a call and we'll figure it out."
- Unused reasons from the locked doc's open items: a charge-off they think is permanent; personal data mismatch across bureaus; already paid somebody and got nothing; funding a second business; quoted six months and don't believe it; closer than they think; inquiries scaring them off applying.

### B8. Draft format for W2 and W3 (W1 assembles the final file from this)

```
## Ad 21 — SLO, <angle in a few words>

<the script, three to five teleprompter paragraphs>

### Notes for ad 21
- Angle:
- Hook (line 1):
- Loop line (line 2):
- Where the loop pays off:
- Matches: <page section, or 9/30 VSL part P1–P9>
- origin_angle: <lower_case_slug>
- Words: <checker count>
- Shoot: Chris seated, face to camera, a location that looks expensive (vary per ad)
- Checker flags kept on purpose: <flag and the newer rule it conflicts with, or "none">
```

Working numbers: $297 ads are **Ad 21, 22, 23** (after the missing prop ads 9–20). Sorting-hat ads are **Ad 24, 25, 26**. These are labels for this file only; the real ad id is set at upload (utm_content), and Chris names angles.

## Manifests

(Each unit adds its manifest here when done: files touched, what was made.)

## Leftovers

(One line each. Things tripped over that nobody asked about. Not fixed, not verified.)

## Blockers

None.
