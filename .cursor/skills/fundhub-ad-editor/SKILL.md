---
name: fundhub-ad-editor
description: Edit one Fundhub talking-head video BEFORE Submagic. Cut real mess-ups only (keep improv), shorten dead pauses, clean and level the sound for Facebook, fix shake only if you can see it. Use when Chris says edit a video, cut dead space, fix the audio, smooth the sound, or prep for Submagic.
---

# Fundhub ad editor

Owner-set 2026-10-23. Chris: Submagic cuts badly. We do the cutting and the sound on the Mac, for free.
Submagic only does captions, clean audio and eye contact.

Proven on Ad 16 (2026-10-23): 80.4 s raw → 69.5 s, 4 mess-ups cut and 16 pauses tightened,
-27.8 → -14.1 LUFS, no word lost.

## The law

- **Never cut a good word.** Cut a word only when it is a mess-up.
- **Improv stays.** Chris goes off script on purpose. A new line that makes sense is improv. Keep it.
- **A mess-up is:** the same words said twice in a row ("before your, before your file"), a false
  start ("getting cap- access"), or a half line he drops and restarts ("so that way, and that's where").
  Keep the LAST, clean try. Cut the earlier one.
- **Hanging tails go.** A hanging tail is a word that trails off, then dead air before the next line
  ("somebody else……and there's"). Chris named these 2026-10-23: they break the flow. The gap often holds a
  breath or room hiss, so a plain silence check misses it. `edit.py` finds them by loudness over 40 ms
  windows (quiet = the room's noise + 9 dB) and cuts the gap down like any other pause. Never cut the word itself.
- **Fix only what you can notice.** Long pauses, quiet sound, room hiss, visible shake. If it is fine, leave it.
- **Never change the raw file.** Write a new `<name> Edited.mp4` next to it.
- **Keep the picture size.** 4K stays 4K.

## Steps

1. **Hear it.** Make a 16 kHz wav and run whisper.cpp with word times:
   ```bash
   ffmpeg -i "<take>.mp4" -ar 16000 -ac 1 in.wav
   credentials/hormozi-kb-work/whisper.cpp/build/bin/whisper-cli -m credentials/hormozi-kb-work/models/ggml-small.en.bin -f in.wav -ml 1 -oj -of words -np
   ```
2. **Read it next to the script.** Script text: the database or `marketing/ads/`. Mark each spot as
   improv (keep) or mess-up (cut). When unsure, keep it.
3. **Pin each cut.** Whisper times are off by up to 0.2 s. For each mess-up, transcribe tiny pieces
   (half a second of quiet in front helps) until you know exactly where the bad try starts and the good try starts.
   Look at loudness every 50 ms; cut in a quiet dip.
4. **Write cuts.json:** `{"start": <first speech - 0.08>, "end": <last word + 0.15>, "mess": [[from, to, "why"], ...]}`
5. **Run it:**
   ```bash
   python3 scripts/ad-video-edit/edit.py cuts.json "<take>.mp4" "<name> Edited.mp4"
   ```
   It shortens every pause and hanging tail over 0.28 s to 0.20 s (pauses only, never words; Chris asked
   for tighter than 0.45 → 0.30). Of the 0.20 s kept, 0.14 s stays after the word so soft endings ("-s")
   are not clipped. It adds 12 ms fades at each cut,
   removes low rumble and light hiss, gently evens the voice, sets -14 LUFS with peaks under -1.5,
   and prints PASS or FAIL.
6. **Check no word is lost.** Transcribe the edited file. Compare word lists before and after.
   The only missing words must be the mess-ups you chose.
7. **Shake.** Measure:
   ```bash
   ffmpeg -i "<take>.mp4" -an -vf "scale=270:480,format=gray" -f rawvideo - | python3 scripts/ad-video-edit/shake.py 270 480
   ```
   Ad 16 measured 1.3–1.7 px jitter at 480p: not visible, not fixed. Only fix clear shake, and fix it
   before Submagic (stabilizing after burns the captions into a wobble). This Mac's ffmpeg vid.stab
   cannot read its own files, so use `deshake` if a fix is needed.
8. **Show Chris** the raw take and the edited file, side by side.

## Sound level for Facebook and online

-14 LUFS loudness, true peak at or under -1.5 dB. This is the common level for social video.
After Submagic, measure again; if it moved more than 1 LU, set it back to -14.

## Submagic gets only this

`cleanAudio: true`, a caption template, `dictionary`. `magicZooms`, `magicBrolls`, `removeBadTakes`,
`autoRender` false. Never send `removeSilencePace`, `aiEditTemplate` or `presetId` — those cut and
add things. Eye contact has no API switch; it is in the Submagic app only.
Code: `src/messaging/providers/submagic.mjs`.
