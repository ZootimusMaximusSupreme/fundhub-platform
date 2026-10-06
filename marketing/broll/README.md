# Fundhub B-roll kit — render notes

Remotion templates for the animation clips in our ads. Vertical 1080x1920 at
30 fps for ads; two templates also have a wide 3840x2160 (4K) version for the
horizontal VSL (`BankPocketsWide`, `ProofFloodWide`).

- Templates: `src/templates/` (the 8 in `registry.tsx`, the rest registered
  from their own files in `src/Root.tsx`).
- Brand look: `src/brand/` (colors, grid, wordmark, depth kit, money).
- The list the script writer picks from: `catalog.json`. Rebuild it after any
  change to a template's props, length or registration:
  `node marketing/broll/scripts/catalog.mjs` (from the repo root).
  `src/marketing/catalog.test.mjs` fails when it is stale.

Every command below runs from this folder after `npm ci`. Renders go to `out/`
(gitignored) or a scratch folder, never into git.

**License.** Every render here is one command typed by hand. A pipeline that
renders by itself is an automation and needs the Remotion company license
(spec `docs/specs/marketing-machine-2026-10-04.md` §16.5).

## Normal renders (white page)

```sh
npm run studio                      # live preview in the browser
npx tsc --noEmit                    # type check the kit

# a still
npx remotion still src/index.ts QualifyToday out/qualify-today.png --frame=72

# a clip (H.264 MP4, the look every ad has used so far)
npx remotion render src/index.ts QualifyToday out/qualify-today.mp4 --props='{"durationInFrames":75}'
```

`ProofWall` and `ProofFlood` need `--gl=angle` to draw every frame whole.

## See-through renders (alpha)

Every template takes `transparent` (default `false`). Spec §9.4: animations go
on last, over Submagic's captioned export, so a clip can be laid over the film.

**With `"transparent":true`:**
- no white page and no grid;
- cards, words, money and shadows stay exactly where they are;
- words stay inside the text-safe band: nothing in the top 14% (y 0–269) or the
  bottom 35% (y 1248–1920) of the vertical frame
  (`ops/workflows/broll-v2-2026-10-02.md`, line 36). The wide versions keep
  their words inside the 5% title-safe margin;
- money decoration (the bills drifting behind) still fades to about a third of
  its strength in those zones, as it does on the white page.

**With `false` (or left out):** nothing changes. Every frame is the same as
before the switch existed.

Marked proof sheet (off, on over a checkerboard, on over a stand-in film):
`previews/see-through-marked.png`.

The kit's config renders JPEG frames, which have no alpha, so every see-through
render must say `--image-format=png`.

```sh
# ProRes 4444 .mov (best for editing; large: about 45 MB for 2.5 s)
npx remotion render src/index.ts QualifyToday out/qualify-today-alpha.mov --props='{"transparent":true}' --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le

# VP9 .webm (small: about 0.9 MB for 2.5 s)
npx remotion render src/index.ts QualifyToday out/qualify-today-alpha.webm --props='{"transparent":true}' --codec=vp9 --image-format=png --pixel-format=yuva420p

# a see-through still (PNG keeps the alpha)
npx remotion still src/index.ts QualifyToday out/qualify-today-alpha.png --frame=72 --props='{"transparent":true}'
```

Other props go in the same JSON: `--props='{"transparent":true,"durationInFrames":75}'`.

**Check the alpha is really there:**

```sh
npx remotion ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt:stream_tags=alpha_mode -of compact=p=0 out/qualify-today-alpha.mov
#   codec_name=prores|pix_fmt=yuva444p12le        <- "yuva" = alpha
npx remotion ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt:stream_tags=alpha_mode -of compact=p=0 out/qualify-today-alpha.webm
#   codec_name=vp9|pix_fmt=yuv420p|tag:alpha_mode=1   <- VP9 keeps alpha beside the picture; alpha_mode=1 means it is there
```

To read the VP9 alpha back, decode with `libvpx-vp9` (ffmpeg's own VP9 decoder
drops it): `ffmpeg -c:v libvpx-vp9 -i clip.webm ...`. The same goes for an
ffmpeg overlay step that lays a `.webm` over the film.

**Check the words stay in the safe band:** render with `checkTextOnly` too.
That drops every piece of decoration, so any drawn pixel left in the top 14% or
bottom 35% is a word or a card in the wrong place.

```sh
npx remotion still src/index.ts QualifyToday out/check.png --frame=72 --props='{"transparent":true,"checkTextOnly":true}'
```

**Which mode the pipeline uses** is the `animation_mode` setting in the
Command Center: `fullframe` (default; the clip covers the frame, white page
and all) or `overlay` (the see-through clip over the film). It stays
`fullframe` until the overlay step is built and Chris picks `overlay`.
