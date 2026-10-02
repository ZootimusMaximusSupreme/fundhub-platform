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
| W2 | 3 new $297 roadmap ads | pending (waits on the Brief) | `ops/workflows/ad-scripts-2026-10-02/w2-slo.md` |
| W3 | 3 new book-a-call (/watch) ads | pending (waits on the Brief) | `ops/workflows/ad-scripts-2026-10-02/w3-watch.md` |
| W4 | Which ads ran on Meta and their results, plus every VSL | pending | `ops/workflows/ad-scripts-2026-10-02/w4-findings.md` |
| W5 | B-roll kit in Remotion: license, templates, previews, shot lists, MP4s | pending | `marketing/broll/` · `ops/workflows/ad-scripts-2026-10-02/w5-status.md` |

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

## Brief (W1) — status: pending

Written after W1 reads every rule book and every existing ad. W2 and W3 draft only after this says DONE.

## Manifests

(Each unit adds its manifest here when done: files touched, what was made.)

## Leftovers

(One line each. Things tripped over that nobody asked about. Not fixed, not verified.)

## Blockers

None.
