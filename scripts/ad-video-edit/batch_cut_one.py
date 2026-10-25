#!/usr/bin/env python3
"""One Direct Book ad: whisper → cuts.json → edit.py. For parallel batch runs."""
import json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
WHISPER = os.path.join(ROOT, "credentials/hormozi-kb-work/whisper.cpp/build/bin/whisper-cli")
MODEL = os.path.join(ROOT, "credentials/hormozi-kb-work/models/ggml-small.en.bin")
EDIT = os.path.join(ROOT, "scripts/ad-video-edit/edit.py")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def parse_whisper_json(data):
    """whisper.cpp -ml 1 -sow -oj: one segment per word, offsets in ms."""
    out = []
    for seg in data.get("transcription", []):
        text = (seg.get("text") or "").strip().lower()
        text = re.sub(r"[^\w']", "", text)
        if not text:
            continue
        fr = seg.get("offsets", {}).get("from")
        to = seg.get("offsets", {}).get("to")
        if fr is None or to is None:
            continue
        s, e = float(fr) / 1000, float(to) / 1000
        if e <= s:
            e = s + 0.05
        out.append({"t": text, "start": s, "end": e})
    return out


def word_times(work, prefix):
    for name in (f"{prefix}-dtw.json", f"{prefix}.json"):
        p = os.path.join(work, os.path.basename(name)) if not name.startswith("/") else name
        if not os.path.isfile(p):
            p = name if os.path.isfile(name) else None
        if p and os.path.isfile(p):
            return parse_whisper_json(json.load(open(p)))
    for f in os.listdir(work):
        if f.endswith(".json"):
            w = parse_whisper_json(json.load(open(os.path.join(work, f))))
            if w:
                return w
    return []


def find_mess(words):
    """Cut earlier repeat of same word run or short phrase (mess-up only)."""
    mess = []
    tokens = [w["t"] for w in words]
    n = len(tokens)
    i = 0
    while i < n:
        best = None
        for k in range(1, min(6, n - i)):
            if i + 2 * k > n:
                break
            if tokens[i : i + k] == tokens[i + k : i + 2 * k]:
                best = k
        if best:
            a = words[i]["start"]
            b = words[i + best - 1]["end"]
            if b - a > 0.05:
                mess.append([a, b, f"repeat {best} words"])
            i += best
        else:
            i += 1
    # consecutive duplicate single words
    i = 0
    while i < n - 1:
        if tokens[i] == tokens[i + 1] and len(tokens[i]) > 2:
            mess.append([words[i]["start"], words[i]["end"], "doubled word"])
            i += 2
        else:
            i += 1
    mess.sort()
    merged = []
    for m in mess:
        if merged and m[0] <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], m[1])
        else:
            merged.append(m)
    return merged


def longest_pause_in(path):
    sys.path.insert(0, os.path.join(ROOT, "scripts/ad-video-edit"))
    from edit import silences

    sil = silences(path, 0.05)
    return max([b - a for a, b in sil] or [0.0])


def main():
    label, src, out = sys.argv[1:4]
    work = sys.argv[4] if len(sys.argv) > 4 else os.path.join("/tmp/direct-book-batch", label)
    os.makedirs(work, exist_ok=True)
    if not os.path.isfile(src):
        print(json.dumps({"label": label, "status": "blocked", "error": "no source file"}))
        return 2

    wav = os.path.join(work, "in.wav")
    run([FFMPEG, "-y", "-i", src, "-ar", "16000", "-ac", "1", wav], check=True)
    prefix = os.path.join(work, "words")
    wr = run(
        [
            WHISPER,
            "-m",
            MODEL,
            "-f",
            wav,
            "-l",
            "en",
            "-ml",
            "1",
            "-sow",
            "-oj",
            "-of",
            prefix,
            "-np",
        ]
    )
    dtw_prefix = prefix + "-dtw"
    if wr.returncode != 0:
        wr2 = run(
            [
                WHISPER,
                "-m",
                MODEL,
                "-f",
                wav,
                "-l",
                "en",
                "-dtw",
                "small.en",
                "-nfa",
                "-ojf",
                "-of",
                dtw_prefix,
                "-np",
            ]
        )
        if wr2.returncode != 0:
            print(json.dumps({"label": label, "status": "failed", "error": (wr.stderr or wr2.stderr)[:500]}))
            return 1

    words = word_times(work, os.path.basename(prefix))
    if not words:
        print(json.dumps({"label": label, "status": "failed", "error": "no whisper words"}))
        return 1

    mess = find_mess(words)
    plan = {
        "start": max(0, words[0]["start"] - 0.08),
        "end": words[-1]["end"] + 0.15,
        "mess": mess,
    }
    cuts_path = os.path.join(work, "cuts.json")
    json.dump(plan, open(cuts_path, "w"), indent=2)

    er = run([sys.executable, EDIT, cuts_path, src, out])
    out_txt = (er.stdout or "") + (er.stderr or "")
    pause_cut = len(re.findall(r"^cut ", out_txt, re.M))
    longest = 0.0
    status = "done"
    if er.returncode != 0:
        status = "failed"
    elif os.path.isfile(out):
        m = re.search(r"longest pause ([\d.]+)s", out_txt)
        if m:
            longest = float(m.group(1))
        else:
            longest = longest_pause_in(out)

    print(
        json.dumps(
            {
                "label": label,
                "status": status,
                "mess_cuts": len(mess),
                "pause_cuts": pause_cut,
                "longest_pause": round(longest, 2),
                "out": out,
            }
        )
    )
    return 0 if status == "done" else 1


if __name__ == "__main__":
    sys.exit(main() or 0)
