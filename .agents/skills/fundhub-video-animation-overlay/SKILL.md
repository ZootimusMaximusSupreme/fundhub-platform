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

**Read the offer first.** Law: ad-know-the-offer (.ai/rules/ad-know-the-offer.md) - before this overlay, read that offer. The pictures show the product steps. They do not come only from the last sentence.

1. **Read the plan.** `marketing/ads/animation-plans/2026-10-22.json`, the entry for the video: templates, props, `side`, and each anchor phrase. The plan is older than the 2026-10-23/24 rules: swap any PathCards or StepPath pick for a diagram, and reword every prop that copies his sentence (no-echo rule below). Read `marketing/broll/README.md` and `marketing/broll/catalog.json` (length range per template).
2. **Get the real word times.** The plan's starts are even-pace estimates and ran 0.5 s to 10.3 s off on the thank-you video. Sources, best first:
   - the script text plus a real transcript, if a speech-to-text tool exists on the machine;
   - the **burned-in captions**: read the caption strip at 10 frames a second, find the highlighted word in each frame (`tools/ocr.swift`, `tools/words.py` in `marketing/ads/animation-plans/thank-you-test-2026-10-23/tools/`). This is free and is what was used. Captions run about 0.15 s ahead of the voice.
   - never the plan's estimates, unless you say plainly that they are estimates.
   The repo's transcribers call the paid OpenAI API. Do not use them without Chris saying so. Do not install anything big for this.
3. **Find the anchors.** `tools/align-anchors.py` matches each plan anchor phrase to the timeline and writes `anchors.json` (first word time, next word time, match score). Anything under 0.8 is a failed match: read the words and fix by hand.
4. **Set the schedule.** One row per animation in `schedule.json`: start, frames, side, why. Rules below.
   **Size check before anything is rendered or laid on (owner-set 2026-10-25).** Law: animation-size-readable (.ai/rules/animation-size-readable.md) - beside clips at scale 0.65 or more, words at least 28 px, a behind clip shows real content where his head does not cover it. Each row carries `mode`, `scale`, `words_on_video_box` or `words_boxes`, `min_text_px_clip`, and for behind clips `content_source` (product and proof beats) and a measured `visible_words_fraction` (`tools/visible-check.py <schedule.json> <masks_dir> --write` in `marketing/ads/animation-plans/capital-blueprint-ad-2-2026-10-25/`). Then `node marketing/broll/scripts/validate-overlay-schedule.mjs <schedule.json>` must say OK. It also fails when the placed box (dx or x, dy or y, clip size times scale) hangs off the picture, or when the clip file is not the full frame and it leaves a black empty side. The whole graphic stays on the screen. Ads are 1080×1920. The hook runs it on every schedule save and on `build-from-schedule.py`. If it fails, Opus fixes the layout (scale, spot, crop, template); a lighter model never shrinks a clip to make it fit. Dashboard beats use `BlueprintDashboardReal` (the real recording behind him), not the empty `BlueprintDashboardOS` card.
5. **Render the clips.** From `marketing/broll`, one per row: `npx remotion render <Template> <clip>.mov --props=<props file> --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le --scale=<video width / 3840>` (ProofWallWide also needs `--gl=angle`). Keep the props files in the folder.
6. **Lay them on.** `tools/build-from-schedule.py <clips_dir> <out.mp4>`: one encode, audio copied (the sound is fixed next, in step 7).
7. **Recheck and fix the sound (owner-set 2026-10-23; smooth 2026-10-25).** Law: ad-sound-level (.ai/rules/ad-sound-level.md) - after Submagic and again after this overlay mux, recheck for clipping, smooth Chris's voice so words and merged clips stay even in loudness and tone, then land at -14 LUFS with true peak at or under -1.5 dB; measure with ebur128=peak=true and write both numbers. Two-pass `loudnorm` with `I=-14:TP=-2.2:LRA=11:linear=true` (TP -1.5 lands peaks at -1.2 to -1.4, too hot), `-c:v copy -c:a aac -b:a 320k -ar 48000`.
8. **Frame review on the final mux (owner-set 2026-10-25).** Law: animation-overlay-frame-review (.ai/rules/animation-overlay-frame-review.md) - before handoff, extract frames at each clip start/mid/end, anchor times, and spot intervals (about every 5–10 s); **view** them (not schedule.json alone). Judge face/hair, captions, readable size, black voids, matte/behind, no-echo, logo-on-Fundhub-only. Verdict: **Acceptable**, **Not acceptable**, or **Acceptable with named timestamp fixes**. Save a contact sheet and/or `frame-review/` plus `frame-review-pass.json` in the plan folder; append one-line learnings to the plan README if it exists. Run `npm run animation:frame-review-check -- <plan-dir>` (warn only).
9. **Check it** (list below), send Chris the video and a contact sheet. Video files go in a scratch folder. Small files (the schedule, the plan, the notes) go in the repo.

**What Chris wants on screen (owner-set 2026-10-23, Ads 11 and 14):**
- Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - what Chris wants on screen: big, diagrams only, one in the first 10 seconds, on the word, never in front of his face.
- Law: animation-no-echo (.ai/rules/animation-no-echo.md) - anchors come from the script; labels are about 5 words, said a new way; never repeat his sentence.
- Law: animation-builders-opus-placers-sonnet (.ai/rules/animation-builders-opus-placers-sonnet.md) - a Sonnet placer never edits marketing/broll/src/; missing templates go in new-animations-needed.md.

## The rules for the schedule

- Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - see-through clips run in overlay mode; only overlaps are forbidden; the 4 s gap, 3 s cap and 35% share are full-frame limits.
- **Land the payoff on the words.** Do not start every clip at its anchor's first word. Make a frame strip of the clip (3 frames a second) and note when each part appears; start the clip so that moment hits the word. Examples: "Booked / Locked in" at "locked in"; "No impact on your score" at "no impact"; "2 in 3" at "two and three".
- **Stretch to fit the speech.** If his speech is longer than the clip, render the clip longer, inside its catalog range (`min_frames` to `max_frames`), and re-measure the strip. Steps scale with the length.
- **First 3 s:** keep clear unless Chris says otherwise. **Closing ask:** the closing ask can carry a CTA animation, but not every ad needs one, and it is never big by default (owner-set 2026-10-24). A closing diagram can hold to the end instead.

## Where the overlay sits (owner law 2026-10-25)

Law: animation-rules (.ai/rules/animation-rules.md) section 2. Read the frame. Do not use one face box for the whole clip.

- The space goes left, right, or top. The whole graphic stays inside the video frame. The readable part cannot be clipped off the left, right, top, or bottom.
- A big long visual that is a multi-step explanation must go in the top one-third. If it is long, put it in the top one-third. The overlay may be full width inside that band.
- Shorter visuals go left, right, or top, or wherever his head is not.
- You can go slightly behind his head for authenticity, but only slightly. The words stay readable. Do not park the point in his hair. If the head moves into the words, move the graphic.
- If there is space, the visual can blast into the bottom two-thirds, or into the top one-third plus the second third where his shoulders are, so it becomes a huge screen.
- If his head is not that big, the sizes change. It is not black and white. Head size and position vary. Discern.
- The face stays clear except that slight overlap. Captions stay clear. The shirt is a bad spot when captions are there. An animation is never unreadable.
- **Cut him out** when a graphic needs that slight overlap. `swiftc -O tools/matte.swift -o matte`, then `./matte <video> <masks_dir> "start,end;start,end"` (windows from `schedule.json`). It writes `m_%05d.png` (white = person) for the frames inside the windows only. It uses Apple Vision person segmentation, no network, no API.
- **Lay him back on top.** `tools/build-from-schedule.py <clips_dir> <out.mp4> --behind <masks_dir>`: the graphic goes on the video, then his cut-out goes over it. Captions are part of the original frames and are not touched. Words that would be hidden by the head do not belong there.
- Per clip in `schedule.json`: `side`, `dx`, `dy`. Mix left, right, and top. A card sitting in his hair is not a normal spot. `tools/face.swift` and `tools/matte.swift` help. Run the frame layout scan (head, hair, shoulders, chest, caption band) on every frame in the clip window.
- A person who sits off-center leaves one side narrow. If that side cannot hold a readable short visual, use the other side or the top one-third. Do not shrink the words into the hair.
- Do not run `rm -rf` (denied in this repo's settings). Use new folders.

## The rules for what is on screen

- **Face.** Place from the frame layout scan (section 2 of `animation-rules`), not from one sample frame. On the thank-you video Chris sits right of center: a short visual can use `left`. A right panel covered his temple and ear. A long visual still goes in the top one-third. Re-check at the middle and ends of every clip with `tools/face.swift`, matte masks, or by eye. The face stays clear except a slight overlap behind the head.
- **Captions.** Nothing is drawn in the caption band or below y 1007 on a 1440-high video. Compare the caption band to the original; the numbers must match the first pass.
- Law: animation-no-echo (.ai/rules/animation-no-echo.md) - props carry facts from the script in short new words; never his sentence copied. Template defaults that print words or numbers the script never says must be changed or the animation dropped:
  - `ProofWallWide`: set `proofLines` to what he says ("Ten years of my own funding", "Hundreds of client files").
  - `QualifyTodayWide`: its amounts come from the one sample client (UnderwriteIQ on the roadmap sample file). Label it: eyebrow "Sample file: how much you qualify for". Never present those amounts as the viewer's.
  - `BookCallWide`: a generic calendar by design (generic month, no name). Leave it.
  - Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - never invent a number, bank, name or claim; label sample-client numbers as a sample. Company name is Fundhub.
- **Readable over film.** Words that float outside a card sit on a white plate in see-through mode (`brand/ReadPlate.tsx`, used by `Eyebrow` and the LenderMatch closing line). If a new template floats words, wrap them in `ReadPlate`. Check readability on real frames, not on the proof sheet.
- **Logo.** Only `FundhubLogo*`, only where the script says "Fundhub". Rule: `animation-logo-only-on-fundhub` (owner-set 2026-10-23).

## Portrait ads (1080x1920), learned on Direct Book Ad 4 and Ad 16 (2026-10-23)

Worked examples: `marketing/ads/animation-plans/direct-book-ad-4-test-2026-10-23/` and `direct-book-ad-16-test-2026-10-23/` (each has its README, schedule, props and tools).

- **Use vertical template ids** (no `Wide`), 1080x1920, render at scale 1. Each vertical see-through clip is one white plate about 1000 px wide inside the words band y 269-1248. Captions sit below that band (Ad 16: y 1480-1740; Ad 4: from y 1560).
- **A close selfie: read the head.** Head size and position vary. A long visual goes in the top one-third at a size you can read. A short visual uses the open left, right, or top. Do not plan on scale 0.4–0.7, and do not shrink the words into the hair. Find the real outline with the person cut-out (union of his outline over the clip's window; `tools/person-union-maps.py`, `tools/fit-search.py` in the Ad 16 folder), not with the face box (the Vision face box was 90 px wider than his real outline).
- **Words stay readable.** A slight overlap behind the head is allowed. Do not park the point in his hair. Do not put the plate on the shirt when captions are there. Words stay clear of the captions.
- **Re-read the numbers from the captions.** Filmed words differ from the written script ("7 to 30 days" not "15 to 30", "800K" not "a lot more than $200,000"). Rewrite the props from the word timeline. The caption reader can mis-hear ("media" for Meta, "funny companies" for funding companies): never print a word the captions get wrong.
- **Fade the plates.** Plate templates are fully opaque on their first and last frame. Fade each clip in and out over about 0.2 s so it does not pop.
- **A scale near 0.4 makes chips unreadable** (eyebrows 6-8 px, sublines about 11 px). Do not use it. Keep the main words big (stamps, numbers, titles). An animation is never unreadable.
- **Two-line captions:** use `ocr2.swift` (adds the highlight's height) and dedupe repeats. Run the Python tools without `-I` when they need Pillow.
- **Compare frames by index.** ffmpeg's `psnr` filter pairs frames by timestamp on these files and shows false misses; use `tools/band-compare.py` (Ad 16) or `setpts=N/(30*TB)`.
- **Length caps bite.** Templates clamp to their catalog range (MoneyClimb steps top out at 4 s). `REMOTION_UNCLAMP=1` lifts the cap so a clip can ride the whole idea; otherwise hold the last frame. Pick the start by the payoff beat and write down which step is late.
- If a template cannot be read in the top one-third, or in the open left or right, stop that animation and write the need in `marketing/ads/animation-plans/new-animations-needed.md`. Do not shrink it into the hair and ship it.

## Checks before you say it works

- Law: animation-overlay-frame-review (.ai/rules/animation-overlay-frame-review.md) - frame review on the **final mux** completed with a written verdict and saved evidence; never "looks good" from code alone.
- Output duration within 0.1 s of the original, same frame count, same fps.
- Before step 7: the audio stream is a bit-for-bit copy (`ffmpeg -i out.mp4 -map 0:a:0 -c copy -f md5 -` equals the same on the original). After step 7: smooth pass ran, voice even across merged clips, -14 LUFS (±0.5), true peak at or under -1.5 dB.
- Caption band (y 1100-1360 on 2560x1440) compared with the first pass: same numbers.
- A contact sheet with one frame per animation taken at its anchor line, captions visible. Look at it.
- Face clear in every animation window.
- `cd marketing/broll && npx tsc --noEmit`, `npm run lint`, and the see-through tests (`node --test src/marketing/catalog.test.mjs src/marketing/broll-see-through.test.mjs`).

## Never

- Open, edit or overwrite the original video. Video outputs go in a scratch folder, not the repo (a test copy is about 250 MB). Small files (the schedule, the plan, the notes) go in the repo.
- Say "the rule requires dropping animations" without reading which mode the rule is in.
- Wire this into the pipeline without Chris saying so. `src/ad-videos/animations.mjs` still only handles 1080x1920 ads and skips wide clips; `build-from-schedule.py` stands in for it.
- Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md) - if a rule settles the choice, make it, finish the work and say what you did.

## Known gaps (2026-10-23)

- The overlay code cannot place wide clips on a 2560x1440 video.
- The SoftPull chip ("You pay $32") shows with the headline, about 1.5 s after he says it.
- On the Mac, use the whisper step from `fundhub-ad-editor`. Keep `align-anchors.py`. Caption reading stays the fallback when whisper is not on the machine.
