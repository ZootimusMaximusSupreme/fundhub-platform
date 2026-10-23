"""Find where each planned animation's anchor line is spoken in Direct Book Ad 16 (1080x1920).

Run from the repo root:  python3 -I marketing/ads/animation-plans/direct-book-ad-16-test-2026-10-23/tools/align-anchors.py

Inputs : words-timeline-from-captions.txt  (one row per caption word: seconds, word, caption line)
         marketing/ads/animation-plans/2026-10-22.json  (the plan for "Direct Book Ad 16")
Output : anchors.json next to this folder's README: for every plan anchor, the first word's time,
         the time the next word starts (about where the phrase ends), and how well the words matched.

The caption times run about 0.15 s ahead of the voice (checked against quiet gaps in the audio).
"""
import difflib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(DIR, "..", "..", "..", ".."))
PLAN = os.path.join(ROOT, "marketing/ads/animation-plans/2026-10-22.json")

NUM = {"1": "ONE", "2": "TWO", "3": "THREE", "6": "SIX", "7": "SEVEN"}

def norm_words(text):
    out = []
    for w in re.split(r"[\s\-/]+", text.upper()):
        w = re.sub(r"[^A-Z0-9']", "", w.replace("$", ""))
        if not w:
            continue
        out.extend(NUM.get(w, w).split())
    return out

def read_timeline():
    rows = []
    for line in open(os.path.join(DIR, "words-timeline-from-captions.txt"), encoding="utf-8"):
        head = line.split("|")[0].split()
        if len(head) < 2:
            continue
        try:
            t = float(head[0])
        except ValueError:
            continue
        for w in norm_words(" ".join(head[1:])):
            rows.append((t, w))
    # a caption word is held for several 0.1 s samples: keep its first time only
    dedup = []
    for t, w in rows:
        if dedup and dedup[-1][1] == w and t - dedup[-1][0] < 0.35:
            continue
        dedup.append((t, w))
    return dedup

def find(tl, phrase):
    want = norm_words(phrase)
    words = [w for _, w in tl]
    best = (0.0, 0, 0)
    for i in range(len(tl)):
        for n in (len(want) - 1, len(want), len(want) + 1, len(want) + 2):
            if n < 1 or i + n > len(tl):
                continue
            r = difflib.SequenceMatcher(None, want, words[i:i + n]).ratio()
            if r > best[0] + 1e-9:
                best = (r, i, n)
    r, i, n = best
    end = tl[i + n][0] if i + n < len(tl) else tl[-1][0] + 0.3
    return {"phrase": phrase, "match": round(r, 2), "start_s": tl[i][0], "end_s": end,
            "heard": " ".join(words[i:i + n])}

def main():
    tl = read_timeline()
    plan = [e for e in json.load(open(PLAN)) if e["video"].startswith("Direct Book Ad 16")][0]
    out = {"video": plan["video"], "caption_lead_s": 0.15, "anchors": []}
    for k, step in enumerate(plan["plan"], 1):
        a = find(tl, step["anchor"]["phrase"])
        a.update({"n": k, "template": step["template"], "clip_seconds": step["seconds"],
                  "planned_start_s": plan["timing"][k - 1]["start_s"]})
        out["anchors"].append(a)
    json.dump(out, open(os.path.join(DIR, "anchors.json"), "w"), indent=1)
    for a in out["anchors"]:
        print(f"{a['n']} {a['template']:22s} real {a['start_s']:5.1f}-{a['end_s']:5.1f}  plan {a['planned_start_s']:5.1f}  match {a['match']}  | {a['heard']}")

main()
