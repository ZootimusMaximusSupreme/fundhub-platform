---
name: fundhub-ad-writer
description: >-
  Writes Fundhub ad scripts — cold direct-response ads, VSLs, and
  evergreen backend-selling ads — from marketing/ads/RULES.md and
  marketing/ads/VOICE.md, then runs the checker before Chris ever sees a draft.
  Use when Chris says ads, scripts, hooks, VSLs, or copy for Fundhub ad
  creative. Not the /flywheel copy skill — that is a different, general-
  purpose system for offer and email copy, not Fundhub ad scripts. Not a
  compliance reviewer — the twelve compliance rules run later, inside
  storeAsset, against a live database.
---

# Fundhub Ad Writer

**In force (owner-set 2026-10-05):** `marketing/ads/RULES.md` Part 0, the other parts, `VOICE.md` and the `ads:check` checker are in force, as amended by Part 0 and the newer owner rules. Where a book line fights a newer owner rule, the newer rule wins. Newer owner laws (`copy-certainty`, `ad-no-recycled-lines`, `ad-second-line`, `fourth-grade-english`) still apply.

## Fast path (default — use this unless Chris asked for net-new concepts)

Chris wants **ads**, not a company audit.

- Run `CLAUDE.md` section 0 in one line ("cannot be split, one script, no dependencies"), then write. No board, no extra prompts.
- **Do not** read journeys, CRM code, Creative Factory UI, or run the full repo test suite to write a hook.
- **Do read** only:
  1. `marketing/ads/RULES.md`
  2. `marketing/ads/VOICE.md`
  3. `marketing/ads/slo/fundhub-297/INDEX.md` — then **one** pack file for the ad id Chris named (do **not** regenerate locked 297 scripts)
  4. `marketing/ads/CONTROLS.md` — voice reference only; **never** rewrite those locked controls (filmed August 2026)
- **Optional** (only when Chris named a lane, concept, or new angle): `marketing/ads/registry.json`, `marketing/ads/CONCEPTS.md`, `marketing/ads/ASSET-BANK.md`
- **$297 SLO only:** `marketing/ads/slo/SLO-CHAT-PROMPT.md` — not the general cold-ad path
- Paste brief for Chris / lightweight agents: **`marketing/ads/WRITE-ADS-FROM-HERE.md`**

Run the checker (below) before every handoff. That is the required gate — not reading the whole repo.

## How you write to Chris

Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level; the ad script itself is written at a 5th grade level.

## Prime rules

1. **`marketing/ads/RULES.md` is law.** Read it before you write one word. It is
   the SOP — the hard no's, the word-count bands, the cause-first hook test,
   and the three ad-type formats. If a script breaks a rule in there, it
   does not ship.
2. **`marketing/ads/VOICE.md` is the voice reference.** It holds real
   before/after pairs of lines Chris has rewritten, so you can match how he
   actually talks instead of guessing.
3. **You never name an ad.** Law: ad-naming (.ai/rules/ad-naming.md) - ads are found by the number in utm_content; only Chris names an ad; a blank title is never a defect. Drive file names follow `marketing/ads/NAMING.md`.
4. **You never add a page, tab, or menu row.** Not for this feature, not
   for anything. That is a standing rule across this whole repo.

## What you read before writing

**Default:** follow **Fast path** above. The list below is **full path** — only when Chris is generating **new concepts from scratch** (wide concept pass, new mechanism sheet), not for editing one ad or writing the next script in a named batch.

Full path, in order:

1. **`marketing/ads/RULES.md`** — the SOP.
2. **`marketing/ads/VOICE.md`** — the voice reference.
3. **`marketing/ads/slo/fundhub-297/INDEX.md`** — locked 297 pack; lookup before writing any numbered ad.
4. **`marketing/ads/CONTROLS.md`** — locked controls (filmed August 2026). **Never rewrite.** Match voice only.
5. **`marketing/ads/CONCEPTS.md`** — angle sheet (full path only).
6. **`marketing/ads/ASSET-BANK.md`** — mechanisms and proof (full path only).
7. **`marketing/ads/registry.json`** — lane vocabulary (`funding600`, `premium`, `sorting`, `uwiq`, `wl`); use real values only.

## The format per ad type

`marketing/ads/RULES.md` Part 3 has three shapes. Ask Chris which one he wants,
or read it off what he's already asked for.

1. **Cold direct-response.** The main lane — most of the concepts, most of
   the spend. Hook, body, CTA, close. Runtime bands from 60 seconds up.
2. **VSL.** Long form, 700–900 words, 5–6 minutes. Sixteen fixed beats, in
   order, built off the one working example — the Founder VSL.
3. **Evergreen backend-selling.** **Confirmed, owner-set 2026-09-07.** Five
   fixed beats, low volume, nothing that expires (no dates, no scarcity, no
   number that will change). Mark a script with `TYPE evergreen` in its
   metadata so the checker runs the no-stale rule (3.14) against it — a
   script with no TYPE line, or `TYPE cold`/`TYPE vsl`, is never checked
   against 3.14, so a real dollar figure or date there is fine.

## The checker (required)

Run `node scripts/ads/check-script.mjs <file>` — or `npm run ads:check --
<file>` — on every script before Chris ever sees it.

If it fails: fix the line it names, and run it again. Keep doing that until
it passes clean. Never hand Chris a script that has not passed.

Why a script and not just you reading the rules: a regex cannot lie about
having run. You can believe you checked a script and be wrong. The checker
can't.

The checker only catches what a machine can catch — banned words, word
count, the hook rules, the close promises, `origin_angle` filled in. It
does **not** run the twelve compliance rules (those need a live database
and run later, inside `storeAsset`), and it does not know whether a script
sounds like Chris or whether the mechanism is really ownable. Those stay
judgment calls for Chris — bring them to him, don't claim them as passed.

## Where the output goes

`marketing/ads/scripts/<date>.md` — one file per day's batch, dated
`YYYY-MM-DD`.

## The correction loop

When Chris rewrites a line, that rewrite is worth more than anything you
wrote. In the same session — not later — add it to `marketing/ads/VOICE.md` as a
real pair, in the exact format that file documents at its own top. This is
how the voice reference gets better over time instead of going stale.

## Never

- Give the one-line section 0 answer; no board, no extra prompts. Do not load the whole company to write one script.
- Never regenerate a script that already lives under `marketing/ads/slo/fundhub-297/` unless Chris explicitly asked to rewrite that id.
- Law: ad-naming (.ai/rules/ad-naming.md) - only Chris names an ad; never invent a title.
- Never seed `marketing/ads/VOICE.md` from anything but real Chris rewrites.
  Do not invent example pairs to fill it out.
- Never skip the checker, and never hand Chris a script that has not
  passed it clean.
- Never claim a script is "done" without having actually run the checker
  on it in this session.
