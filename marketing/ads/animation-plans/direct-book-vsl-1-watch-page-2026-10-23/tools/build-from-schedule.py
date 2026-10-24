"""Lay the see-through clips on Direct Book VSL 1 (2560x1440, 30 fps), using schedule.json. ONE encode, audio copied.
python3 -I tools/build-from-schedule.py <clips_dir> <masks_dir> <out.mp4> <source.mp4> [--t SECONDS] [--ss SECONDS]
Each clip is a 3840x2160 ProRes 4444 render. Per row of schedule.json: trimmed to play_frames, last picture held hold_frames, faded in 0.15 s and out 0.2 s
(the last clip is not faded out: the CTA stays to the last frame), scaled by scale_vs_2560, placed at dx,dy.
His cut-out (masks, white = person, m_%05d.png at 30 fps from tools/matte.swift) is laid back over the finished composite, so a card that reaches behind
his head or shoulder is hidden by him. Captions are part of the original frames and are never drawn over.
--t / --ss render only a piece (for checks). The source is read only. Prints the ffmpeg command."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SCHED = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
FPS, TOTAL = SCHED["fps"], SCHED["video_frames"]
argv = sys.argv[1:]
opt = {}
for o in ("--t", "--ss"):
    if o in argv:
        i = argv.index(o); opt[o] = argv[i + 1]; del argv[i:i + 2]
clips, masks, out, src = argv[:4]
full = os.path.join(masks, "_full"); os.makedirs(full, exist_ok=True)
black = os.path.join(masks, "_black.png")
if not os.path.exists(black):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=2560x1440,format=gray", "-frames:v", "1", black], check=True)
need = set()
for c in SCHED["clips"]:
    need.update(range(c["start_frame"], c["start_frame"] + c["frames"]))
for k in range(TOTAL):
    link, real = os.path.join(full, "m_%05d.png" % k), os.path.join(masks, "m_%05d.png" % k)
    tgt = real if (k in need and os.path.exists(real)) else black
    if os.path.lexists(link):
        if os.readlink(link) == tgt: continue
        os.remove(link)
    os.symlink(tgt, link)
ss = ["-ss", opt["--ss"]] if "--ss" in opt else []
tt = ["-t", opt["--t"]] if "--t" in opt else []
args = [FF, "-hide_banner", "-nostats", "-y", "-i", src]
for c in SCHED["clips"]:
    args += ["-i", os.path.join(clips, c["key"] + ".mov")]
mi = len(SCHED["clips"]) + 1
args += ["-framerate", str(FPS), "-start_number", "0", "-i", os.path.join(full, "m_%05d.png")]
g, prev = [], "0:v"
n_clips = len(SCHED["clips"])
for i, c in enumerate(SCHED["clips"], 1):
    sf, pf, hf = c["start_frame"], c["play_frames"], c["hold_frames"]
    fr = pf + hf
    s = c["scale_vs_2560"] * 1.0
    sw, sh = round(3840 * s), round(2160 * s)
    tp = f"tpad=stop_mode=clone:stop_duration={hf / FPS:.5f}," if hf else ""
    last = (i == n_clips)
    fo = "" if last else f"fade=t=out:st={(fr - 6) / FPS:.4f}:d=0.2:alpha=1,"
    g.append(f"[{i}:v]trim=end_frame={pf},{tp}format=rgba,fade=t=in:st=0:d=0.15:alpha=1,{fo}setpts=PTS-STARTPTS+{sf}/({FPS}*TB),scale={sw}:{sh}:flags=lanczos[a{i}]")
    g.append(f"[{prev}][a{i}]overlay=x={c['dx']}:y={c['dy']}:eof_action=pass:enable='between(t,{(sf - 0.5) / FPS:.6f},{(sf + fr - 0.5) / FPS:.6f})'[v{i}]")
    prev = f"v{i}"
g.append(f"[{mi}:v]format=gray[mk]")
g.append("[0:v]format=yuv420p[ov]")
g.append("[ov][mk]alphamerge[fg]")
g.append(f"[{prev}][fg]overlay=x=0:y=0:eof_action=pass[vfinal]")
args += ss and [] or []
cmd = args + ["-filter_complex", ";".join(g), "-map", "[vfinal]", "-map", "0:a:0",
         "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
         "-color_range", "tv", "-r", str(FPS), "-c:a", "copy", "-movflags", "+faststart"] + tt + [out]
print(" ".join(f'"{a}"' if " " in a else a for a in cmd)[:3000])
subprocess.run(cmd, check=True)
