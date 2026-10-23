---
name: fundhub-video-animation-overlay
description: Lay the see-through Fundhub animations (marketing/broll) over a finished, captioned video so each one lands on the words it matches. Use when Chris says animations, overlay, load animations, anchor words, thank-you video, VSL animations, or hands over an edited video "ready for animations". Covers the word timeline, anchor matching, start times, clip lengths, face-safe sides, script-only words, readability, the one-encode build and the checks.
---

# Fundhub video animation overlay

Built 2026-10-23 on the Direct Book Thank You video. Board: `ops/workflows/animation-builds-2026-10-22.md`.
Worked example, tools and numbers: `marketing/ads/animation-plans/thank-you-test-2026-10-23/` (README first).

## What this is, in one line

The video is finished and captioned. The animations go on last, as see-through clips, so each one appears when the words it shows are spoken, and never on the face or the captions. The original file is never changed. Output is a test copy first.

## The order. Do not skip ahead.

1. **Read the plan.** `marketing/ads/animation-plans/2026-10-22.json`, the entry for the video: templates, props, `side`, and each anchor phrase. Read `marketing/broll/README.md` and `marketing/broll/catalog.json` (length range per template).
2. **Get the real word times.** The plan's starts are even-pace estimates and ran 0.5 s to 10.3 s off on the thank-you video. Sources, best first:
   - the script text plus a real transcript, if a speech-to-text tool exists on the machine;
   - the **burned-in captions**: read the caption strip at 10 frames a second, find the highlighted word in each frame (`tools/ocr.swift`, `tools/words.py` in the example folder). This is free and is what was used. Captions run about 0.15 s ahead of the voice.
   - never the plan's estimates, unless you say plainly that they are estimates.
   The repo's transcribers call the paid OpenAI API. Do not use them without Chris saying so. Do not install anything big for this.
3. **Find the anchors.** `tools/align-anchors.py` matches each plan anchor phrase to the timeline and writes `anchors.json` (first word time, next word time, match score). Anything under 0.8 is a failed match: read the words and fix by hand.
4. **Set the schedule.** One row per animation in `schedule.json`: start, frames, side, why. Rules below.
5. **Render the clips.** From `marketing/broll`, one per row: `npx remotion render <Template> <clip>.mov --props=<props file> --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le --scale=<video width / 3840>` (ProofWallWide also needs `--gl=angle`). Keep the props files in the folder.
6. **Lay them on.** `tools/build-from-schedule.py <clips_dir> <out.mp4>`: one encode, audio copied.
7. **Fix the sound (owner-set 2026-10-23).** Submagic downloads come back quiet (measured -27 to -30 LUFS on Ads 4, 11, 14, 16). Every finished video gets set to **-14 LUFS, true peak at or under -1.5 dB**, picture copied, no re-encode of the video. Two-pass `loudnorm` with `I=-14:TP=-2.2:LRA=11:linear=true` (TP -1.5 lands peaks at -1.2 to -1.4, too hot), `-c:v copy -c:a aac -b:a 320k -ar 48000`. Measure the result with `ebur128=peak=true` and write both numbers in the report. A video that is not at -14 is not done.
8. **Check it** (list below), send Chris the video and a contact sheet, and **save every round to the repo**.

**What Chris wants on screen (owner-set 2026-10-23, Ads 11 and 14):**
- **Diagrams, on all of them.** Never numbered "01 02 03" card lists (PathCards, StepPath) or text-only plates. Start from the plan's templates (step 1).
- **Big.** Aim for 70-90% of the frame width. Under 50% was "so small".
- **One animation inside the first 10 seconds,** on the hook.
- **On the word.** Each part pops in on the word he says it, not on a fixed stagger.
- **A CTA graphic** on the closing ask ("click the link below"), held to the last frame.
- **Long is fine.** An animation can ride the whole idea. Mix behind him and in front of him (never the face or captions).

## The rules for the schedule

- **Mode.** See-through clips run in overlay mode. In `src/ad-videos/animations.mjs` the 4 s face gap, 3 s clip cap and 35% share belong to `fullframe` mode only; overlay mode forbids overlaps and nothing else. Do not drop animations for the full-frame limits.
- **Land the payoff on the words.** Do not start every clip at its anchor's first word. Make a frame strip of the clip (3 frames a second) and note when each part appears; start the clip so that moment hits the word. Examples: "Booked / Locked in" at "locked in"; "No impact on your score" at "no impact"; "2 in 3" at "two and three".
- **Stretch to fit the speech.** If his speech is longer than the clip, render the clip longer, inside its catalog range (`min_frames` to `max_frames`), and re-measure the strip. Steps scale with the length.
- **No overlap, and no gaps that look dead.** Two see-through clips never share a frame.
- **First 3 s and the closing ask:** keep clear of them unless Chris says otherwise.

## Behind him (green-screen style) and varied spots (owner-set 2026-10-23)

- Chris: "get the animations behind the body and face, like greenscreen" and "they don't have to always be in the same spot."
- **Cut him out.** `swiftc -O tools/matte.swift -o matte`, then `./matte <video> <masks_dir> "start,end;start,end"` (windows from `schedule.json`). It writes `m_%05d.png` (white = person) for the frames inside the windows only. It uses Apple Vision person segmentation, no network, no API.
- **Lay him back on top.** `tools/build-from-schedule.py <clips_dir> <out.mp4> --behind <masks_dir>`: animations go on the video, then his cut-out goes over them. A card that reaches behind his head is hidden by him. Captions are part of the original frames and are not touched.
- **Vary the spot.** Per clip in `schedule.json`: `side`, `dx`, `dy`. Mix left and right, upper and lower, and tuck a card behind his head now and then. Find his face box first (`tools/face.swift` on a few frames). Words stay clear of the face box and above the caption band; only decoration (cash stacks, card margins) goes behind him. Never hide the start or end of a line.
- A person who sits off-center leaves one side narrow. Check the narrow side's room before putting a full-width panel there.
- Do not run `rm -rf` (denied in this repo's settings). Use new folders.

## The rules for what is on screen

- **Face.** Pick `side` by where the face is. On the thank-you video Chris sits right of center: use `left`. A right panel covered his temple and ear. Check frames with the face tool (`tools/face.swift`) or by eye at the middle of every clip.
- **Captions.** Nothing is drawn in the caption band or below y 1007 on a 1440-high video. Compare the caption band to the original; the numbers must match the first pass.
- **Script words only.** Props carry the words. Use the script's own words for eyebrows, chips and lines. Template defaults that print words or numbers the script never says must be changed or the animation dropped:
  - `ProofWallWide`: set `proofLines` to what he says ("Ten years of my own funding", "Hundreds of client files").
  - `QualifyTodayWide`: its amounts come from the one sample client (UnderwriteIQ on the roadmap sample file). Label it: eyebrow "Sample file: how much you qualify for". Never present those amounts as the viewer's.
  - `BookCallWide`: a generic calendar by design (generic month, no name). Leave it.
  - Never invent a number, bank, name or claim. Company name is Fundhub. Certain words only.
- **Readable over film.** Words that float outside a card sit on a white plate in see-through mode (`brand/ReadPlate.tsx`, used by `Eyebrow` and the LenderMatch closing line). If a new template floats words, wrap them in `ReadPlate`. Check readability on real frames, not on the proof sheet.
- **Logo.** Only `FundhubLogo*`, only where the script says "Fundhub".

## Portrait ads (1080x1920), learned on Direct Book Ad 4 and Ad 16 (2026-10-23)

Worked examples: `marketing/ads/animation-plans/direct-book-ad-4-test-2026-10-23/` and `direct-book-ad-16-test-2026-10-23/` (each has its README, schedule, props and tools).

- **Use vertical template ids** (no `Wide`), 1080x1920, render at scale 1. Each vertical see-through clip is one white plate about 1000 px wide inside the words band y 269-1248. Captions sit below that band (Ad 16: y 1480-1740; Ad 4: from y 1560).
- **A close selfie leaves almost no room.** His head and hair fill the middle and his shoulders cover the full width from about y 1100. Free room: the top corners, the sky above his hair, and thin side strips. Expect clip scales of 0.4-0.7. Find the room with the person cut-out (union of his outline over the clip's window; `tools/person-union-maps.py`, `tools/fit-search.py` in the Ad 16 folder), not with the face box (the Vision face box was 90 px wider than his real outline).
- **Words clear, plates may go behind him.** Give each clip a word box. Plates, list rows and money may go behind him. Words stay at least 10-20 px outside his outline and above the captions.
- **Re-read the numbers from the captions.** Filmed words differ from the written script ("7 to 30 days" not "15 to 30", "800K" not "a lot more than $200,000"). Rewrite the props from the word timeline. The caption reader can mis-hear ("media" for Meta, "funny companies" for funding companies): never print a word the captions get wrong.
- **Fade the plates.** Plate templates are fully opaque on their first and last frame. Fade each clip in and out over about 0.2 s so it does not pop.
- **Short chips are unreadable at 0.4 scale** (eyebrows 6-8 px, sublines about 11 px). Prefer clips whose main words are big (stamps, numbers, titles), or shorten or drop the chips.
- **Two-line captions:** use `ocr2.swift` (adds the highlight's height) and dedupe repeats. Run the Python tools without `-I` when they need Pillow.
- **Compare frames by index.** ffmpeg's `psnr` filter pairs frames by timestamp on these files and shows false misses; use `tools/band-compare.py` (Ad 16) or `setpts=N/(30*TB)`.
- **Length caps bite.** MoneyClimb steps tops out at 4 s and PathCards at 4.5 s, so a step can land late on a slow talker. Pick the start by the payoff beat and write down which step is late.
- **Open design question:** a close portrait selfie needs narrower, portrait-first layouts to show bigger animations. Until they exist, scale and place the plan's diagrams as big as the free space allows (owner wants big), and say which ones fall under 70%.

## Checks before you say it works

- Output duration within 0.1 s of the original, same frame count, same fps.
- Before step 7: the audio stream is a bit-for-bit copy (`ffmpeg -i out.mp4 -map 0:a:0 -c copy -f md5 -` equals the same on the original). After step 7: -14 LUFS (±0.5), true peak at or under -1.5 dB.
- Caption band (y 1100-1360 on 2560x1440) compared with the first pass: same numbers.
- A contact sheet with one frame per animation taken at its anchor line, captions visible. Look at it.
- Face clear in every animation window.
- `cd marketing/broll && npx tsc --noEmit`, `npm run lint`, and the see-through tests (`node --test src/marketing/catalog.test.mjs src/marketing/broll-see-through.test.mjs`).

## Never

- Open, edit or overwrite the original video. Outputs go in a scratch folder, not the repo (a test copy is about 250 MB).
- Say "the rule requires dropping animations" without reading which mode the rule is in.
- Wire this into the pipeline without Chris saying so. `src/ad-videos/animations.mjs` still only handles 1080x1920 ads and skips wide clips; `build-from-schedule.py` stands in for it.
- Ask Chris to confirm a choice a rule here already settles. Do it, and say what you did.

## Known gaps (2026-10-23)

- The overlay code cannot place wide clips on a 2560x1440 video.
- The SoftPull chip ("You pay $32") shows with the headline, about 1.5 s after he says it.
- No local speech-to-text. If Chris approves an API or a local tool later, replace step 2's caption reading and keep `align-anchors.py`.
