# Ad tonality (2026-10-14)

Chris asked for a small system that measures how each filmed ad sounds, rates it, and says what it
should sound like. Tool: `scripts/ad-tonality/`. Full scorecard: `report.md`. Raw numbers: `data/`.

## What the 17 videos show

- **The up arrow is not showing up.** 1 of 14 marked lines went up (Direct Book Ad 4). The rest ended
  flat or falling, about 1 to 4 semitones down, no different from lines with no arrow.
- **CAPS words are not standing out.** Across the 11 scripted takes with CAPS, those words are on
  average about 1 dB quieter and 0.15 st lower than the words around them.
  Best punches: Capital Blueprint Ad 2 Take 2, Direct Book Ad 5, Capital Blueprint Ad 1 Take 3.
- **He does pause at blank lines** in most takes (Capital Blueprint Ad 2: 16 of 17, Ad 10: 14 of 17).
- **Dead air is the biggest fix.** Pauses over 1.5 s per take: VSL 20, Ad 10 9, Ad 12 9,
  Capital Blueprint Ad 1 Take 4 9 (longest 8.6 s). Cut these in the merge step.
- **Pace runs fast on four ads.** Capital Blueprint Ad 2 (221, 224 wpm), Direct Book Ad 5 (225),
  Direct Book Ad 4 (211), Penthouse Take 3 (210). Most of the rest sit at 169 to 200.
- **Pitch spread is steady,** 2.0 to 3.4 semitones. Flattest: Penthouse Take 2 (2.05). Widest: Ad 4 (3.38).
- **Volume differs by up to 16 dB between videos.** Capital Blueprint Ad 2 is about -17 LUFS; most
  others are -26 to -33 LUFS. Level them in the edit.
- **Capital Blueprint Ad 1 Take 1 could not be measured.** The audio never goes quiet, so no pauses
  were found. Ignore its row.
- **Best take picks on tonality alone:** Capital Blueprint Ad 2 Take 2, Penthouse Take 3, Thank You Take 2.
  Capital Blueprint Ad 1: Take 3 is the tightest, Take 4 covers the most script.

## What it should sound like (from the scripts)

- Pause at every blank line. Scripts are written so a blank line is a pause (`RULES.md` 1.8).
- Up arrow only on the setup line before a reveal or a question. 2 to 4 per ad.
- CAPS 5 to 10 per ad on numbers and the word that carries the claim.
- Scripts with no marks (Ad 9, Penthouse, VSL, Ad 12): apply the same pattern, pause at paragraph
  breaks, one up arrow on the line before the reveal.
- Pace: 160 to 200 wpm. One study of audio ads compared 160, 180 and 200 wpm and found 180
  best (Journal of Advertising Research, 200 adults, via the ARF). It is audio ads, not video.
  The repo plans at 150 wpm; Chris reads at about 205.
- No published pass or fail number was found for pitch variety. The tool compares each take to
  Chris's own median (2.59 st).

## Limits

- Pitch is `librosa.pyin` (Parselmouth has no build for the Mac VM). Pitch tracking makes errors.
- Word times are estimated by lining up two small speech models, about 0.2 s off. Punch and
  up-arrow checks are flags. Check by ear before recutting.
- Whisper drops "um" and "uh", so filler counts read zero. Not a finding.
- Script match is lower on ads full of dollar amounts because digits and spoken numbers differ.
- Direct Book Ad 12 (Industry slam) has no script in the repo, so it has no mark checks.
