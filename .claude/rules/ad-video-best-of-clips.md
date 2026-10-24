# Ad video — best of all clips

**Owner law (2026-09-24):** Merging takes is part of the rules. One take shipped alone, when other clips or takes exist for that ad, is wrong.

## Law

For each ad, the pipeline looks at **every clip and every take** that belongs to that ad.

The AI or Submagic ships **one finished video** made from the **best** of those clips — not the first file that showed up, not a single take in isolation.

One video per ad. One video per VSL (and the portal welcome counts as its own long video). Every take that belongs to that video is merged into that one file. The clip order is the script order. Correct order = the order the lines appear in the script. Not camera order, not file-name order, not upload order, not "Take 1 then Take 6" unless that is also the script order.

One video per angle. The angle is the name in `marketing/ads/NAMING.md`. Two files that share an ad number but have different angle names are different videos. Read the words before a join. Do not join them.

Cuts follow `fundhub-ad-editor` (owner-set 2026-10-23): improv stays; filler or a breath goes only when it is a mess-up or a hanging tail.

The finished ad must be the best of all clips and takes, and it must also kill these defects:

- Dead space, long pauses, dead air, hanging tails
- Repeated words and the weaker copy when the same line is said in more than one take
- False starts (he starts, stops, starts over)
- Filler that does not help: um, uh, like, you know
- Loud breaths and mouth noise
- Silence before he speaks and after he finishes
- Half sentences and stumbles
- Captions that use the wrong words or cover his face
- Audio that is too quiet, peaks, or jumps between clips
- Black frames and flash frames
- B-roll that does not match the words being said

Chris never opens Submagic. Agents run merge, trim, upload, captions, and B-roll in the pipeline. B-roll is only our own animations and our own screen recordings (owner-set 2026-10-24). Never Submagic B-roll (`magicBrolls` stays false).

Joining and editorial cuts happen **before** Submagic sees the film (Submagic takes one upload per project). Submagic's job is captions only (and clean audio) on the already-merged master. Our animations and screen recordings go on last, after captions.

## Never

- Ship the first take by itself when other clips or takes exist for that same ad
- Leave any defect above in a finished ad
- Ask Chris to pick takes, name takes, or open Submagic to merge, trim, or export
- Invent a new take file or start a new naming sequence (for example "SLO Ad 3 Take 1") when takes already exist elsewhere for that ad
- Move, rename, or reorganize the raw Drive folder to "help" — leave the raw library alone; the pipeline reads it

## Always

- Gather every take and clip tied to that ad before calling a cut done
- Build one master MP4 from the best moments across those sources, kill every defect above, then send that single file through Submagic
- If merge or trim logic is missing or stubbed, treat that as a gap — the law still applies; do not ship a lone, untrimmed take as a workaround

## Example

```text
Ask: "Run the ad video pipeline on SLO Ad 3."

❌ Poll Raw, grab Take 1 alone, leave a long pause and a doubled hook, export, and ship while Take 2 sits in Drive.
✅ Find every take and clip for Ad 3, keep the best lines once, trim dead air, join the takes in script order into one master, then Submagic once — Chris never touches Submagic.
```
