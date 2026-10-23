"""Word timeline from burned-in captions (portrait 1080x1920 version).
Input : ocr2.jsonl (one row per 0.1 s caption-strip frame: words with boxes, highlight box)
Output: words-timeline-from-captions.txt rows "  t WORD | caption text"   (t = first 0.1 s sample where that word is lit)
The highlight box is matched to the caption word it overlaps most (x AND y, so two-line captions do not mix up).
"""
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'ocr2.jsonl')]
out = []; prev = None
for r in rows:
    t = (r['i'] - 1) / 10.0
    ws, hl = r['words'], r['hl']
    cur = None
    if ws and hl:
        hx0, hx1, hy0, hy1 = hl
        best, ba = None, 0
        for k, w in enumerate(ws):
            ox = max(0, min(hx1, w['x1']) - max(hx0, w['x0']))
            oy = max(0, min(hy1, w['y1']) - max(hy0, w['y0']))
            a = ox * oy
            if a > ba: ba, best = a, k
        if best is not None:
            cur = (r['text'], best, ws[best]['w'])
    # page key: first 3 words of the text (OCR can wobble on the rest)
    key = (' '.join(cur[0].split()[:3]), cur[1]) if cur else None
    if key != prev:
        out.append((t, cur[2] if cur else '-', cur[0] if cur else ''))
        prev = key
for t, w, tx in out:
    print(f"{t:5.1f} {w:14s} | {tx}")
