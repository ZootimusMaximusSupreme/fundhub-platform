"""Turn the OCR of the burned-in caption strip into a word timeline.

Run from the folder that holds ocr.jsonl (one JSON line per 0.1 s frame, made by ocr.swift):
  python3 -I words.py ocr.jsonl > words-timeline-from-captions.txt

Portrait version: captions are one or two lines, so the highlighted (blue) word is found by x AND y.
Output rows: "<seconds> <word> | <caption text>" for each frame where the highlighted word changes.
"""
import json, sys

rows = [json.loads(l) for l in open(sys.argv[1])]
out, prev = [], None
for r in rows:
    t = (r["i"] - 1) / 10.0
    ws, hl = r["words"], r["hl"]
    cur = None
    if ws and hl:
        cx, cy = (hl[0] + hl[1]) / 2, hl[2]
        best, bd = None, 1e9
        for k, w in enumerate(ws):
            if "y" not in w:
                continue
            inside = w["x0"] - 30 <= cx <= w["x1"] + 30
            d = abs(w["y"] - cy) * 4 + abs((w["x0"] + w["x1"]) / 2 - cx) + (0 if inside else 400)
            if d < bd:
                bd, best = d, k
        if best is not None:
            cur = (r["text"], best, ws[best]["w"])
    key = (cur[0][:14], cur[1]) if cur else None
    if key != prev:
        out.append((t, cur[2] if cur else "-", cur[0] if cur else ""))
        prev = key
for t, w, tx in out:
    print(f"{t:5.1f} {w:14s} | {tx}")
