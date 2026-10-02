# B-roll shot lists — 2026-10-02 tool-analogy ads

Two shot lists, one per tool-analogy script in `marketing/ads/notes-green-screen.md` (on local `main`): **Script 3 — Tool analogy, SLO (current)** and **Script 4 — Tool analogy, sorting hat (current)**. Only the spoken paragraphs under each heading count. The Apple Notes ads (Scripts 1 and 2) get no B-roll: Chris talks in front of the note.

- **The idea (Chris, 2026-10-02):** both ads use the tool and hammer picture. The tire story gets the flat tire and hammer, Script 3's jack line gets the jack, and each ad calls back to its tool near the end.
- **The clips:** 12 MP4s, 6 per script, in `marketing/broll/out/script-3/` and `marketing/broll/out/script-4/`. Each is 1080x1920 at 30 fps, H.264 (yuv420p, bt709), 3 to 4 seconds. `marketing/broll/out/` is in `.gitignore`, so the MP4s stay out of git.
- **Rendered now:** the 6 clips on the existing templates (3 per script, 3.7 MB together). **Waiting on Unit F:** the 6 clips on `FlatTireHammer`, `JackFix` and `ToolMatch`. Their props below follow Unit F's contract in `ops/workflows/broll-v2-2026-10-02/unit-f.md`.
- **Submagic:** upload each MP4 under My B-rolls and drop it at its start time. A clip opens on the words it shows, so line it up with the start of its line.
- **Start time:** words spoken before the clip ÷ 2.5 = seconds (150 words a minute). Words are counted with `[A-Za-z0-9'’$%-]+`. Shown as m:ss, rounded down, with the exact seconds after it. Totals: Script 3 is 195 words (1:18), Script 4 is 182 words (1:12). Both match the scripts file.
- **What is on screen:** every word and number comes from the line the clip sits on. The few exceptions come from the sentence just before it, the earlier sentence in the same ad that the line pays off, or the live page for the same idea. Each one is named under its table. No invented amounts, lender names, people or faces: the lender rows stay blank.
- **Lines with no clip** stay on Chris: both hooks and both open-loop lines, "Picture fixing a flat tire with a hammer" (he holds the hammer on camera), the "I've grabbed the hammer" joke (it lands on him), and the refund line.
- **Render one clip** (inside `marketing/broll/`): save its props block below as `props.json`, then run
  `npx remotion render src/index.ts <Template> out/script-N/<file>.mp4 --codec=h264 --props=props.json`.
  Every command is typed at the terminal; no render script is saved.

| Script | Clips | Templates used | Rendered now | Waiting on Unit F |
|---|---|---|---|---|
| 3 (SLO) | 6 | FlatTireHammer, JackFix, FileItems, LenderList, OfferStack, JackFix | 3 | 3 |
| 4 (sorting hat) | 6 | FlatTireHammer, FileItems, FundingRounds, ToolMatch, FlatTireHammer, BookCall | 3 | 3 |

## Script 3 — Tool analogy, SLO

195 words, about 1:18 at 150 words a minute. 6 clips.

| # | Starts | Line it sits on | Template | On screen | Length | MP4 file | Status |
|---|---|---|---|---|---|---|---|
| 1 | 0:16 (16.0 s) | "You swing at it for an hour, the tire's still flat, and now the rim's bent too." | `FlatTireHammer` | Fixing a flat tire with a hammer · You swing at it for an hour · the rim bends | 105 frames (3.5 s) | `out/script-3/s3-01-flat-tire-hammer-0m16s.mp4` | waiting on Unit F |
| 2 | 0:22 (22.8 s) | "A jack and a lug wrench have you back on the road in fifteen minutes." | `JackFix` | A jack and a lug wrench · In fifteen minutes · Back on the road | 105 frames (3.5 s) | `out/script-3/s3-02-jack-fix-0m22s.mp4` | waiting on Unit F |
| 3 | 0:35 (35.2 s) | "Some files need negative items taken off. Some need their names and addresses matched on every report, or their cards paid down." | `FileItems` | Credit works the same way · Some files need · Negative items taken off · Names and addresses matched on every report · Cards paid down (no chips) | 90 frames (3.0 s) | `out/script-3/s3-03-file-items-0m35s.mp4` | rendered |
| 4 | 0:44 (44.0 s) | "Every file needs the right banks in the right order." | `LenderList` | Every file needs · The right banks in the right order · 5 numbered rows, names blank | 90 frames (3.0 s) | `out/script-3/s3-04-lender-list-0m44s.mp4` | rendered |
| 5 | 0:54 (54.4 s) | "For $297, I pull your file, and you get every step in order, with the letters already written, the balances to pay down and the banks that approve files like yours." | `OfferStack` | Built from your own credit · Every step in order · The letters already written · The balances to pay down · The banks that approve files like yours · $297 | 105 frames (3.5 s) | `out/script-3/s3-05-offer-stack-0m54s.mp4` | rendered |
| 6 | 1:06 (66.8 s) | "You use it the way you use a jack, without learning how it's made." | `JackFix` | You use it the way you use a jack · Without learning how it's made · Back on the road | 105 frames (3.5 s) | `out/script-3/s3-06-jack-fix-1m06s.mp4` | waiting on Unit F |

**Words from outside the line:**

- Clip 1: Eyebrow is the sentence just before ("Picture fixing a flat tire with a hammer").
- Clip 3: Eyebrow is the sentence just before ("Credit works the same way"), 2 seconds earlier in the same paragraph.
- Clip 5: Eyebrow is the sentence just before ("a roadmap built from your own credit"). The four small pages are the live /roadmap page's own "See a sample" pages (Unit C's renders: Credit Optimization Roadmap, Dispute Letter Pack, Credit Analysis Report, Bank & Lender Match List). They show the one /roadmap sample client only, at thumbnail size.
- Clip 6: "Back on the road" is the jack line (0:22) this line calls back to.

**Props (exact):**

`s3-01-flat-tire-hammer-0m16s` → `FlatTireHammer`
```json
{
  "eyebrow": "Fixing a flat tire with a hammer",
  "caption": "You swing at it for an hour",
  "bendRim": true,
  "durationInFrames": 105
}
```
`s3-02-jack-fix-0m22s` → `JackFix`
```json
{
  "eyebrow": "A jack and a lug wrench",
  "caption": "In fifteen minutes",
  "doneLabel": "Back on the road",
  "durationInFrames": 105
}
```
`s3-03-file-items-0m35s` → `FileItems`
```json
{
  "eyebrow": "Credit works the same way",
  "docTitle": "Some files need",
  "docSubtitle": "",
  "items": [
    {"label": "Negative items taken off"},
    {"label": "Names and addresses matched on every report"},
    {"label": "Cards paid down"}
  ],
  "tag": null,
  "durationInFrames": 90
}
```
`s3-04-lender-list-0m44s` → `LenderList`
```json
{
  "eyebrow": "Every file needs",
  "headline": "The right banks in the right order",
  "footer": null,
  "rows": 5,
  "names": [],
  "durationInFrames": 90
}
```
`s3-05-offer-stack-0m54s` → `OfferStack`
```json
{
  "eyebrow": "Built from your own credit",
  "items": [
    {"title": "Every step in order", "visual": "offer-stack/roadmap.png"},
    {"title": "The letters already written", "visual": "offer-stack/pack.png"},
    {"title": "The balances to pay down", "visual": "offer-stack/analysis.png"},
    {"title": "The banks that approve files like yours", "visual": "offer-stack/lenders.png"}
  ],
  "price": "$297",
  "footer": null,
  "durationInFrames": 105
}
```
`s3-06-jack-fix-1m06s` → `JackFix`
```json
{
  "eyebrow": "You use it the way you use a jack",
  "caption": "Without learning how it's made",
  "doneLabel": "Back on the road",
  "durationInFrames": 105
}
```

**No clip:** the hook (0:00), the open loop "There's one tool that works on every file from a 600 to an 800" (0:04), "Picture fixing a flat tire with a hammer" (0:12, Chris holds the hammer), the hammer joke (0:28), "Credit works the same way" (0:33, it is clip 3's eyebrow), the payoff "The one tool that handles all of it is a roadmap built from your own credit" (0:48, on Chris's face; clip 5 follows), and the refund line (1:12).

## Script 4 — Tool analogy, sorting hat

182 words, about 1:12 at 150 words a minute. 6 clips.

| # | Starts | Line it sits on | Template | On screen | Length | MP4 file | Status |
|---|---|---|---|---|---|---|---|
| 1 | 0:22 (22.0 s) | "You swing at it for an hour, the tire's still flat, and now the rim's bent too." | `FlatTireHammer` | Fixing a flat tire with a hammer · You swing at it for an hour · the rim bends | 105 frames (3.5 s) | `out/script-4/s4-01-flat-tire-hammer-0m22s.mp4` | waiting on Unit F |
| 2 | 0:35 (35.2 s) | "If something's holding your file back, like collections or maxed-out cards, the tool is optimizing your credit first." | `FileItems` | Holding your file back · Your file · Collections · Maxed-out cards · green chip on each row: Optimizing your credit first | 90 frames (3.0 s) | `out/script-4/s4-02-file-items-0m35s.mp4` | rendered |
| 3 | 0:42 (42.4 s) | "If your file's ready, the tool is applying in rounds to the banks that fit it." | `FundingRounds` | If your file's ready · Round 1 · Round 2 · Round 3 · Inquiries chip struck between rounds · Hard inquiries (struck) removed between rounds | 105 frames (3.5 s) | `out/script-4/s4-03-funding-rounds-0m42s.mp4` | rendered |
| 4 | 0:56 (56.4 s) | "The tool almost everybody grabs first is applying, before their file is ready for it." | `ToolMatch` | Credit works the same way · Holding your file back → Optimizing your credit first · Your file's ready → Applying in rounds · You want to do it yourself → A step-by-step plan · row 2 highlighted: Almost everybody grabs first · final card: Applying / Before their file is ready for it | 120 frames (4.0 s) | `out/script-4/s4-04-tool-match-0m56s.mp4` | waiting on Unit F |
| 5 | 1:02 (62.4 s) | "That's the hammer on the flat tire." | `FlatTireHammer` | Almost everybody grabs first · That's the hammer on the flat tire · the rim bends | 90 frames (3.0 s) | `out/script-4/s4-05-flat-tire-hammer-1m02s.mp4` | waiting on Unit F |
| 6 | 1:09 (69.2 s) | "Hop on a call and we'll figure it out." | `BookCall` | Wherever you are · Hop on a call · calendar, day 15, 2:30 PM · Booked · Wed 15 · 2:30 PM · We'll figure it out | 90 frames (3.0 s) | `out/script-4/s4-06-book-call-1m09s.mp4` | rendered |

**Words from outside the line:**

- Clip 1: Eyebrow is the sentence just before ("Picture fixing a flat tire with a hammer").
- Clip 2: Eyebrow is the line's own "holding your file back", cut short to fit (the full "If something's holding your file back" ran past the side margin). Card title "Your file" is the line's "your file".
- Clip 3: The round labels, the struck "Inquiries" chip and the caption "Hard inquiries removed between rounds" come from the 9/30 /watch VSL for the same path ("If your file is ready, we go get the capital in funding rounds and keep your credit clean between each round"; "removing the hard inquiries between each funding round"). Three rounds is the low end of that VSL's "three to six rounds". No amounts.
- Clip 4: The rows are the credit paragraph (0:33 to 0:56) that this line pays off, cut short: "Holding your file back" (from "If something's holding your file back"), "Applying in rounds" (from "applying in rounds to the banks that fit it"), "A step-by-step plan" (from "a step-by-step plan with someone keeping you accountable"). The eyebrow is that paragraph's first sentence.
- Clip 5: Eyebrow is the sentence just before ("The tool almost everybody grabs first").
- Clip 6: Eyebrow is the sentence just before ("Wherever you are, Fundhub has a solution for that phase"). Day 15 and the four times are BookCall's generic calendar (no month, no year, no name).

**Props (exact):**

`s4-01-flat-tire-hammer-0m22s` → `FlatTireHammer`
```json
{
  "eyebrow": "Fixing a flat tire with a hammer",
  "caption": "You swing at it for an hour",
  "bendRim": true,
  "durationInFrames": 105
}
```
`s4-02-file-items-0m35s` → `FileItems`
```json
{
  "eyebrow": "Holding your file back",
  "docTitle": "Your file",
  "docSubtitle": "",
  "items": [
    {"label": "Collections"},
    {"label": "Maxed-out cards"}
  ],
  "tag": "Optimizing your credit first",
  "tagTone": "ok",
  "durationInFrames": 90
}
```
`s4-03-funding-rounds-0m42s` → `FundingRounds`
```json
{
  "eyebrow": "If your file's ready",
  "rounds": 3,
  "roundLabel": "Round",
  "inquiryChip": "Inquiries",
  "captionStruck": "Hard inquiries",
  "captionRest": "removed between rounds",
  "amounts": null,
  "durationInFrames": 105
}
```
`s4-04-tool-match-0m56s` → `ToolMatch`
```json
{
  "eyebrow": "Credit works the same way",
  "rows": [
    {"situation": "Holding your file back", "tool": "Optimizing your credit first"},
    {"situation": "Your file's ready", "tool": "Applying in rounds"},
    {"situation": "You want to do it yourself", "tool": "A step-by-step plan"}
  ],
  "highlight": 1,
  "highlightLabel": "Almost everybody grabs first",
  "finalCard": {"title": "Applying", "subtitle": "Before their file is ready for it"},
  "durationInFrames": 120
}
```
`s4-05-flat-tire-hammer-1m02s` → `FlatTireHammer`
```json
{
  "eyebrow": "Almost everybody grabs first",
  "caption": "That's the hammer on the flat tire",
  "bendRim": true,
  "durationInFrames": 90
}
```
`s4-06-book-call-1m09s` → `BookCall`
```json
{
  "eyebrow": "Wherever you are",
  "line": "Hop on a call",
  "pickDay": 15,
  "times": ["9:00 AM", "11:30 AM", "2:30 PM", "4:00 PM"],
  "pickTime": 2,
  "booked": "Booked",
  "detail": "We'll figure it out",
  "durationInFrames": 90
}
```

**No clip:** the hook (0:00), the open loop "There's one tool almost everybody grabs first..." (0:07) and "I'll show you which one" (0:16), "Picture fixing a flat tire with a hammer" (0:18, Chris holds the hammer), the hammer joke (0:28), "Credit works the same way" (0:33), the do-it-yourself line (0:48: no template shows a step-by-step plan without making up step names; clip 4's third row recaps it), and "Wherever you are, Fundhub has a solution for that phase" (1:05, it is clip 6's eyebrow).
