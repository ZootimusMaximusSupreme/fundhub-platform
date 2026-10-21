---
name: fundhub-testimonial-thumbnails
description: Turn raw testimonial videos into live cards on a Fundhub page — a thumbnail with the client's own hook on it, a caption underneath, and a Play button that matches the VSL. Use when Chris says testimonial, client video, add a testimonial, thumbnail, video poster, or hands over new testimonial footage. Covers hook picking, the copy rules, burned-in captions, making a sideways video vertical, and the live push.
---

# Fundhub testimonial thumbnails and captions

Built 2026-09-27 from Colin, Gene and Sarah. Board: `ops/workflows/testimonial-thumbnails-2026-09-27.md`.
Prompt of record: `docs/prompts/testimonial-thumbnails.md`.

## The problem this solves

A testimonial that shows only a face gives nobody a reason to press play. Every
testimonial card gets the client's own strongest line printed on the picture,
and a one-line caption under the video saying who they are and what happened.

## The order. Do not skip ahead.

Back end first, per `CLAUDE.md` §3a. The data file exists before a single pixel
is rendered.

### 1. Ask for the words before you transcribe

**Ask Chris whether he already has the scripts or transcripts.** He usually does.
Transcribing first wasted a run on 2026-09-27 and he stopped it.

If he does not have them, transcribe locally. Note two things that bite:
`pip install openai-whisper --break-system-packages` does **not** work on this
Mac — the system python is 3.9.6 from Apple CommandLineTools and its pip has no
such flag. Make a venv. And **there is no `ffprobe` here**; `ffmpeg -i <file>`
prints the stream line to stderr and exits 1, which is the read, not a failure.

### 2. `marketing/testimonials/testimonials.json` is the source of record

One record per video. The page is generated from this file — never the other way
round. Fields beyond the obvious:

| Field | What it is for |
|---|---|
| `hook_source_quote` | The client's exact line. The headline must be a tightening of this. |
| `hook_source_timestamp` | Where to find that line in the video. |
| `thumbnail_accent_words` | A literal slice of the headline; it gets the accent colour. |
| `best_frame_timestamp` | Which frame the poster came from. |
| `thumbnail_band_top` / `_band_bottom` | Where the dark wash sits. Set from the measured caption band — see step 4. |
| `thumbnail_foot_top` | Where the bottom fade starts. Just under that person's chin. |
| `status` | Only `approved` records reach the page. |
| `sort_order` | Strongest proof first. |

### 3. Pick the hook, then check it against the copy rules

Read the whole transcript. Take whatever that person says that would make a
stranger click — a number, a timeframe, a before and after, a surprising
admission. Vary the shape across the set so three cards do not read the same.

**The headline may tighten their words. It may never add a number, a result or a
claim they did not say.** Sarah had not been funded yet, so hers says "set to be
approved", not "got".

Never write: "credit repair" (it is credit optimization), "it's not X, it's Y",
slogans, metaphors ("game changer" is out even when the client says it), a
two-sentence setup with the punchline second, "your number", "the number", EIN,
DUNS, net-30 vendors, "no guarantees". Cause before effect. **Fundhub**, never
FundHub.

Caption format: `Name, business type. One sentence about what happened, in their
own terms.`

**Show Chris a table of video → their line → the hook, and wait, before
rendering anything.**

### 4. Burned-in captions are the hard part

Every video Chris films comes back with Submagic's word-by-word captions **burned
into the picture**. A thumbnail is one frame, so those words land next to your
headline and it reads as broken.

Do not assume a clean frame exists. Gene had a caption on **every frame of two
minutes**. Scan the caption band end to end before you count on a gap:

```bash
~/.local/bin/ffmpeg -i "video.mp4" \
  -vf "fps=2,crop=720:190:0:1060,scale=180:48,tile=8x30:margin=4:padding=2:color=red" \
  -frames:v 1 band-scan.jpg
```

So: **measure where that video's caption band sits, as a percentage of frame
height, and put the dark wash exactly there.** Measured on the first three —
colin 78-93%, gene 84-87%, sarah 64-76%. The wash goes fully opaque across it.
A 97% wash is not enough; bold white text still ghosts through.

The bottom fade starts just under the chin so the wash never eats the face.

### 5. Sideways video has to become tall

Every slot is 9:16. A 1920×1080 source crops to **608×1080** — that is the widest
true 9:16 a 1080-tall frame allows. Centre it on the face, sample frames across
the whole runtime, and look at them before you encode.

**Never upscale.** 608 wide is correct; stretching to 720 is not. Never call
1080p 4K. And per `.claude/rules/video-4k-unless-ad.md`, a non-ad video that
comes back under 4K is a defect to report, not to quietly fix.

Cropping chops the burned-in captions mid-word. That is expected and it is why
the wash exists.

### 6. Render, wire, prove

```bash
node scripts/testimonials/render-thumbnails.mjs         # posters
node scripts/testimonials/build-slots.mjs               # writes the page slots
node scripts/testimonials/proof-slots.mjs               # PASS/FAIL at 1280 and 390
```

`thumbnail.html` is the editable template — it opens in a browser on its own,
uses the page's real Inter and JetBrains Mono, and the real `fundhub.` wordmark
pulled out of the sales fragment rather than redrawn. `1rem` is 1% of canvas
width so one template serves any size.

**The play button copies the VSL's unmute pill** — `#188bf6`, mono caps, pill
radius (owner 2026-09-27: "same setup as the VSL... same colour"). Testimonials
**never autoplay**; the VSL is the only video on the page that starts by itself.
Starting one testimonial pauses the others.

### 7. Ship

Assets go to `public/funnel/` and reach `fundhub.ai/funnel/*` through Netlify, so
**`npm run ship` has to land before the ClickFunnels push**, or a new video 404s
on a live page. Then
`node scripts/cf-push-custom-html.mjs push --only=slo-297-sales` (page `25426320`),
then prove the live URL with a cache bust.

## Traps already paid for

- **Screenshotting this page is unreliable.** `slo-01-sales.html` is over 8000px
  tall; element screenshots that far down get stitched from strips and smear, and
  `<video>` layers capture at stale positions. Park the grid at the top of the
  viewport, take one clipped viewport shot, and swap posters in as `<img>` first.
- **A smear in a screenshot may be a real bug.** On 2026-09-27 an apparent
  artifact was an orphaned `.vslot` left outside the grid by a bad rewrite,
  painting at 720×1280 across the page. Four rounds went by before hit-testing
  the pixels found it. `document.elementFromPoint` settles it in one call.
- **When rewriting a block in the page, count div depth.** Taking the first
  `</div>` after `<div class="proofgrid">` closes the first slot, not the grid.
- **`URLSearchParams.get()` already decodes.** Decoding again throws on the `%`
  in a value like `"62%"` and the template silently falls back to its defaults.
- **Chromium will not load a `file://` image from a `file://` page** without
  `--allow-file-access-from-files`, and will not load one into a `setContent`
  page at all — inline it as a data URI there.
- **A blank render looks fine at a glance.** The renderer now refuses to ship a
  thumbnail whose frame did not load or whose headline fell back off Inter.

## Never

- Render before Chris has signed off on the hooks
- Put a number, lender, quote or name on a card that the client did not say
- Upscale, or letterbox a sideways video into a 9:16 slot
- Ship a poster with someone else's burned-in caption showing through
- Autoplay a testimonial
- Push the page before the videos are live
