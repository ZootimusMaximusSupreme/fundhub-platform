# Ad tonality tool

Measures how a filmed ad sounds, checks it against the script's delivery marks, writes a scorecard.
Marks: CAPS = punch, blank line = pause, up arrow = pitch up (`marketing/ads/RULES.md` 1.8).

Needs ffmpeg and Python with numpy, scipy, soundfile, librosa, sherpa-onnx. Two models:
whisper base.en (int8) and the streaming zipformer 20M (word times). Models are not in the repo.

```bash
# 1. what each script asks for
python3 scripts/ad-tonality/ad_tonality.py marks --repo . --map scripts/ad-tonality/video_map.json --out marks.json
# 2. what each video does (re-run until PENDING is 0; add --shard 0/2 and 1/2 to run two at once)
python3 scripts/ad-tonality/ad_tonality.py measure --videos <folder of mp4> --cache <cache> --out <metrics> \
  --model <whisper base.en folder> --zip-model <zipformer folder> --marks marks.json --budget 120
# 3. scorecard
python3 scripts/ad-tonality/ad_tonality.py rate --metrics <metrics> --marks marks.json --out report.md
```

`video_map.json` maps each ad name to its script section. Add a line for every new ad.
