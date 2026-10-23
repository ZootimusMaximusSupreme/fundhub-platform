"""Lay the see-through clips on the finished Direct Book Ad 11 (53.84 s cut) video using schedule.json. ONE encode, audio copied.
  python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <source.mp4> --behind <masks_dir>   (absolute paths)
- Each clip is trimmed to total_frames; if the rendered clip is shorter, its LAST FRAME is held (tpad clone) so the animation rides the whole idea.
- No fade-in (the cards pop on their own, timed to the word); 0.2 s fade-out unless the clip is the CTA (stays to the end).
- mode "behind": clip under his person cut-out, plus the words box (+10 px) again on top (hair only).  mode "front": whole clip on top.
The source is read only."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SCHED = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
W, H, FPS = SCHED["width"], SCHED["height"], SCHED["fps"]
argv = sys.argv[1:]
behind = None
if "--behind" in argv:
    i = argv.index("--behind"); behind = argv[i + 1]; del argv[i:i + 2]
clips, out, src = argv[0], argv[1], argv[2]
C = SCHED["clips"]
args = [FF, "-hide_banner", "-nostats", "-y", "-i", src]
for c in C:
    args += ["-i", os.path.join(clips, c["clip"])]
total = round(SCHED["video_seconds"] * FPS)
full = os.path.join(behind, "_full"); os.makedirs(full, exist_ok=True)
black = os.path.join(behind, "_black.png")
if not os.path.exists(black):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H},format=gray", "-frames:v", "1", black], check=True)
for k in range(total):
    link, real = os.path.join(full, "m_%05d.png" % k), os.path.join(behind, "m_%05d.png" % k)
    if os.path.lexists(link): os.remove(link)
    os.symlink(real if os.path.exists(real) else black, link)
args += ["-framerate", str(FPS), "-start_number", "0", "-i", os.path.join(full, "m_%05d.png")]
g, prev, tops, rects = [], "0:v", [], []
for i, c in enumerate(C, 1):
    sf, tf, rf, sc = c["start_frame"], c["total_frames"], c["render_frames"], c["scale"]
    sw, sh = round(W * sc), round(H * sc)
    chain = f"[{i}:v]trim=end_frame={min(rf, tf)},format=rgba"
    if tf > rf:
        chain += f",tpad=stop_mode=clone:stop_duration={(tf - rf) / FPS:.4f}"
    if c["fade_out"]:
        chain += f",fade=t=out:st={(tf - 6) / FPS:.4f}:d=0.2:alpha=1"
    chain += f",setpts=PTS-STARTPTS+{sf}/({FPS}*TB),scale={sw}:{sh}:flags=lanczos,split[a{i}][b{i}]"
    g.append(chain)
    en = f"between(t,{(sf - 0.5) / FPS:.6f},{(sf + tf - 0.5) / FPS:.6f})"
    if c["mode"] == "behind":
        g.append(f"[{prev}][a{i}]overlay=x={c['dx']}:y={c['dy']}:eof_action=pass:enable='{en}'[v{i}]")
        prev = f"v{i}"
        x0, y0, x1, y1 = c["front_rect"]
        g.append(f"[b{i}]crop={x1 - x0}:{y1 - y0}:{x0 - c['dx']}:{y0 - c['dy']}[c{i}]")
        rects.append((f"[c{i}]", x0, y0, en))
        g.append(f"[a{i}]nullsink") if False else None
    else:
        tops.append((f"[a{i}]", c["dx"], c["dy"], en))
        g.append(f"[b{i}]nullsink")
mi = len(C) + 1
g.append(f"[{mi}:v]format=gray[mk]")
g.append("[0:v]format=yuv420p[ov]")
g.append("[ov][mk]alphamerge[fg]")
g.append(f"[{prev}][fg]overlay=x=0:y=0:eof_action=pass[vm]")
prev = "vm"
n = 0
for lab, x, y, en in rects + tops:
    n += 1
    g.append(f"[{prev}]{lab}overlay=x={x}:y={y}:eof_action=pass:enable='{en}'[w{n}]")
    prev = f"w{n}"
# a-streams of "behind" clips are consumed above; a-streams of front clips are consumed in tops; b-streams of behind clips in rects
g = [x for x in g if x]
args += ["-filter_complex", ";".join(g), "-map", f"[{prev}]", "-map", "0:a:0",
         "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
         "-color_range", "tv", "-r", str(FPS), "-c:a", "copy", "-movflags", "+faststart", out]
print(" ".join(f'"{a}"' if " " in a else a for a in args))
subprocess.run(args, check=True)
