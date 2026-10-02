# TOOL TEMPLATES READY

`FlatTireHammer`, `JackFix` and `ToolMatch` are committed on `ad-scripts-2026-10-02` (commit `b1f3ae1d`). Unit G can render its six waiting clips with the props in its shot list; no `--gl=angle` needed.

# Unit F — tool-analogy animations (FlatTireHammer, JackFix, ToolMatch)

**Status: DONE (2026-10-02).** Commits: `b1f3ae1d` (templates, previews, this file) and the one that adds the heading above.

## Contract (Unit G writes shot lists against this; it did not change)

| Composition id | Props | Length |
|---|---|---|
| `FlatTireHammer` | `eyebrow` ("Wrong tool"), `caption` ("An hour with a hammer"), `bendRim` (true), `durationInFrames` | 75–105 frames, default 90 |
| `JackFix` | `eyebrow` ("Right tool"), `caption` ("Fifteen minutes with a jack"), `doneLabel` ("Back on the road"), `durationInFrames` | 75–105 frames, default 90 |
| `ToolMatch` | `eyebrow`, `rows` (2–4 of `{situation, tool}`), `highlight` (row index or null), `highlightLabel` (optional chip), `finalCard` (optional `{title, subtitle}`), `durationInFrames` | 75–120 frames, default 105 |

All three also take `showSafeZones` (preview guide lines), like every other template. A length outside the range is clamped to it.

**One thing to know about ToolMatch defaults.** Remotion lays a shot list's props over the defaults. So the defaults hold only the safe parts: `eyebrow` "Credit works the same way", the four Script 3 rows, and `highlight: null`. There is **no default final card and no default chip**, so a price can never show up on a clip that did not ask for it. Leave `finalCard` / `highlightLabel` out (or pass `null`) for none. Unit G's shot list passes every prop explicitly, so it is not affected.

## What each one shows

All three: white page with the faint grid, the "fundhub." wordmark, eyebrow with the spectrum dash, Inter, accent #3D86F0, the kit's slow camera drift. Drawn in code (SVG + CSS 3D). No WebGL, no new package.

**FlatTireHammer** (the wrong tool). The lower corner of a white car (body side with its wheel arch, a real wheel well behind) sits on a flat tire on a light road. A steel claw hammer, held off the right edge, swings at the tire three times. Each hit bounces off (motion smear on the way down, impact strokes, the tire jiggles, the car jolts) and the tire stays flat. The third swing winds up higher, holds with a little tremble, and lands: the rim dents at the upper right (lip pushed in, dark crease), the rim sits crooked in the tire and the whole wheel wobbles, and two bills fly off. `bendRim: false` makes the third hit bounce off like the others. The little clock next to the caption runs one full turn: an hour.

**JackFix** (the right tool). The same car on the same flat. A blue scissor jack slides in and cranks the car up; a blue cross lug wrench spins the nuts off; the flat is tossed aside (it shrinks away, still in frame) and a fresh full tire drops in and goes on; the wrench spins the nuts back; the jack lets the car down and slides out. A "Back on the road" check pops (green check, white pill), the wheel turns and the lane dashes slide by, and a few bills drift down at the sides. The clock only gets a quarter of the way round: fifteen minutes.

**ToolMatch** (the tool board). A white pegboard leaning back a little. Row by row: the situation slides in on the left, a blue tool badge pops on the line between, and the tool's card hangs on the board at the right. Then the `highlight` row lifts off the board with a blue edge while the others dim (cards stay solid, only their words fade), with the optional `highlightLabel` chip on it. The optional `finalCard` lands in front at the end (title; a short subtitle like "$297" shows big in blue, a longer one in gray). Text shrinks to fit (44 px down to 26 px). Faint bills drift in the side gutters; more rise when the final card lands.

Long words from a shot list: the caption under the car shrinks from 58 px to 44 px to stay on one line, and wraps to two lines (eyebrow moves up) only past that. A too-long eyebrow scales down instead of running off the side.

## Truth

- Every word on screen comes from props. Defaults use the scripts' own words (Notes doc on main, Scripts 3 and 4) and the brief's own defaults.
- No dollar figure anywhere unless a shot list passes one. The ToolMatch preview shows "$297" from Script 3's line ("For $297") and the live /roadmap page.
- Bills and coins carry no numbers and no faces (the kit's money pieces). No people, no names, no lenders.
- The badge icons in ToolMatch (wrench, cross wrench, screwdriver, jack) are decoration; the words carry the meaning.
- The "The hammer" chip marks the row it sits on. Put it only on a row whose tool is the wrong one in the script. Script 4's hammer is "applying, before their file is ready for it"; its three tool rows are all right tools.

## Files

- `marketing/broll/src/templates/toolScene.tsx` — shared pieces: car corner, wheel (tire, rim, lug nuts), road, hammer, scissor jack, cross lug wrench, tossed bill, caption clock, eyebrow + caption block, timing helpers
- `marketing/broll/src/templates/FlatTireHammer.tsx`, `JackFix.tsx`, `ToolMatch.tsx`
- `marketing/broll/src/templates/toolAnalogy.tsx` — the three compositions (own length ranges, so not in the 2–3 s registry)
- `marketing/broll/src/Root.tsx` — two lines: the import and `<ToolAnalogyCompositions />`
- Previews: `marketing/broll/previews/flat-tire-hammer.png` (frame 84: rim bent, bills flying), `jack-fix.png` (frame 86: new tire on, check up), `tool-match.png` (frame 75 with the preview props: four Script 3 rows, row 4 lifted; the "$297" final card lands right after)
- Samples (gitignored): `marketing/broll/out/samples/flat-tire-hammer.mp4`, `jack-fix.mp4`, `tool-match.mp4` (preview props), `tool-match-sorting-hat.mp4` (Script 4's three rows, no highlight). 3.95 MB together.

## Render commands (inside `marketing/broll/`)

```
npx remotion still src/index.ts FlatTireHammer previews/flat-tire-hammer.png --frame=84
npx remotion still src/index.ts JackFix previews/jack-fix.png --frame=86
npx remotion still src/index.ts ToolMatch previews/tool-match.png --frame=75 --props=<preview props>
npx remotion render src/index.ts FlatTireHammer out/samples/flat-tire-hammer.mp4
```

Preview props for ToolMatch (also exported as `toolMatchPreviewProps`): the defaults plus `"highlight": 3, "finalCard": {"title": "A roadmap built from your own credit", "subtitle": "$297"}`.

**`--gl=angle` is not needed.** The default renderer draws every frame of all three whole (checked, below).

## Checks run

- **Turned 3D parts, every frame, default renderer vs `--gl=angle`:** FlatTireHammer 90 frames, JackFix 90, ToolMatch 105 (preview props) and 105 (Script 4 rows). Each pixel may match within 2 px (renderers place 3D layers a couple of px apart); then any solid 6x6 block that still differs is flagged. **0 flagged blocks in all 390 frames.**
  - Fixed on the way (all measured with the default renderer): the car body and road were drawing only partly (wide 3D layers lose pieces; Unit B hit the same) — now cut into 220 px strips. A wheel crossing the frame edge lost slices (JackFix frames 46 and 48) — the swap now keeps both wheels inside the frame. A drop-shadow filter on a tumbling bill drew a dark smear — the tossed bills have no filter.
  - Also fixed after looking: the raised hammer was cut off by the band top and covered the eyebrow (pivot moved lower, eyebrow + caption moved under the scene); the dropping tire crossed the wordmark (starts lower now); entering ToolMatch cards dipped behind the board (they come from in front now); the ToolMatch board shadow was cut at the band's bottom edge (board shorter, softer shadow); a stair-step gap inside the tire at steep angles (inner tire slices close in behind the barrel); the bent rim's lip broke up when tilted (tilt reduced).
- **Text safe zones:** every frame rendered with `--props '{"checkTextOnly":true}'` (money drops out) and scanned with `scripts/offer-cta-zone-scan.py`: FlatTireHammer (defaults and Unit G's "That's the hammer on the flat tire" props), JackFix (defaults and Unit G's s3-06 props), ToolMatch (preview props, Script 4 rows, Unit G's s4-04 props). **0 drawn pixels in the top 14% or bottom 35% in every frame.** Words, the car, the tools and the board run from y 303 (the wordmark) to y 1236 at most; nothing is cut at either band edge (largest step across the bottom edge: 3 gray levels, one ToolMatch frame).
- **Money over words:** compared the normal render with the text-only render in every word box. No bill lands on the wordmark, eyebrow or caption. In JackFix a bill shows through the check pill for about two frames while the pill fades in.
- **Unit G's six waiting clips:** rendered stills of every props block in `marketing/broll/shot-lists/2026-10-02-tool-analogy.md` that uses these templates; all fit (the long caption shrinks, the long chip fits on its row).
- **Lengths:** rendered FlatTireHammer at 75, JackFix at 105, ToolMatch at 120, and `bendRim: false`; each MP4 has the right frame count and the joke lands before the end.
- **MP4s:** all four samples H.264, 1080x1920, 30 fps, yuv420p, bt709; 90 / 90 / 105 / 105 frames. Looked at 10 frames of each.
- **Looked at:** all three previews and frame strips of every clip at each change.
- `cd marketing/broll && npx tsc --noEmit`: exit 0 (also clean with no-unused checks). Root `npm run lint`: "2314 file(s) and inline script(s) parse clean".
- Did not run `npm run ads:check` or apply `marketing/ads/RULES.md` (Chris set them aside).

## Leftovers

None found outside this unit.
