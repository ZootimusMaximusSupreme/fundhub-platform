#!/usr/bin/env python3
"""Fundhub ad tonality tool.

Three steps:
  marks    Read the delivery marks from the repo scripts (CAPS = punch, blank line = pause,
           up-arrow = pitch up) and write what each ad SHOULD sound like.
  measure  Measure what each video DOES sound like: pitch, pace, pauses, loudness, accents.
  rate     Compare the two and write a scorecard with suggestions.

Run it from anywhere. Paths are arguments. See README.md.

Needs: ffmpeg, numpy, scipy, soundfile, librosa, sherpa-onnx (+ a whisper base.en model folder).
Pitch is librosa.pyin (Parselmouth/Praat has no wheel for every machine). Pitch tracking makes
mistakes, so read the numbers as a comparison between takes, not as lab truth.
"""
import argparse
import difflib
import json
import os
import re
import statistics
import subprocess
import sys
import time

ARROW = "\u2191"
ACRONYMS = {"LLC", "AI", "CTA", "VSL", "USA", "FICO", "SLO", "IQ", "UK", "US", "CEO", "ROI"}
TAKE_RE = re.compile(r"\s+Take\s+\d+\.mp4$", re.I)


# --------------------------------------------------------------------------------------
# marks: what the script says it should sound like
# --------------------------------------------------------------------------------------
def norm_word(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())


def read_script_block(path, heading):
    """Return the spoken paragraphs of one script section (or the whole file)."""
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    # drop front matter
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
        lines = lines[end + 1:]
    if heading:
        out, inside = [], False
        for ln in lines:
            if ln.startswith("## "):
                if inside:
                    break
                inside = ln.startswith(heading)
                continue
            if inside:
                out.append(ln)
        lines = out
    # drop html comment + fenced blocks
    text = "\n".join(lines)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    paras = []
    for b in blocks:
        first = b.split("\n", 1)[0]
        if re.match(r"^(Shoot|Marks|Note|Notes)\s*:", first):
            continue
        if b.startswith("#"):
            continue
        paras.append(" ".join(b.split("\n")))
    return paras


def parse_marks(paras):
    lines, caps_total, arrows = [], 0, 0
    word_index = 0
    for i, p in enumerate(paras):
        has_arrow = ARROW in p
        arrows += p.count(ARROW)
        clean = p.replace(ARROW, " ")
        toks = clean.split()
        caps = []
        words = []
        for t in toks:
            core = re.sub(r"[^A-Za-z']", "", t)
            nw = norm_word(t)
            if not nw:
                continue
            words.append(nw)
            if len(core) >= 2 and core.isupper() and core not in ACRONYMS:
                caps.append(core)
        caps_total += len(caps)
        lines.append({
            "i": i,
            "text": clean.strip(),
            "words": len(words),
            "first_word_index": word_index,
            "caps": caps,
            "pitch_up": has_arrow,
            "pause_after": i < len(paras) - 1,
        })
        word_index += len(words)
    total_words = word_index
    return {
        "paragraphs": len(paras),
        "words": total_words,
        "caps": caps_total,
        "pitch_ups": arrows,
        "pauses": max(len(paras) - 1, 0),
        "caps_per_100_words": round(100 * caps_total / total_words, 1) if total_words else 0,
        "pitch_ups_per_100_words": round(100 * arrows / total_words, 1) if total_words else 0,
        "has_marks": bool(caps_total or arrows),
        "lines": lines,
    }


def cmd_marks(args):
    with open(args.map, encoding="utf-8") as fh:
        vmap = json.load(fh)
    out = {}
    for name, spec in vmap.items():
        if name.startswith("_"):
            continue
        if not spec.get("script"):
            out[name] = {"script": None}
            continue
        path = os.path.join(args.repo, spec["script"])
        paras = read_script_block(path, spec.get("heading"))
        m = parse_marks(paras)
        m["script"] = spec["script"]
        m["heading"] = spec.get("heading")
        m["seconds_at_150wpm"] = round(m["words"] / 150 * 60, 1)
        m["seconds_at_205wpm"] = round(m["words"] / 205 * 60, 1)
        out[name] = m
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    for name, m in out.items():
        if m.get("script") is None:
            print(f"{name}: no script")
        else:
            print(f"{name}: {m['words']}w {m['paragraphs']}para caps={m['caps']} up={m['pitch_ups']}")


# --------------------------------------------------------------------------------------
# measure: what the video actually sounds like
# --------------------------------------------------------------------------------------
SR = 16000
FR = 0.02          # one analysis frame = 20 ms
HOP = 320          # 20 ms at 16 kHz (loudness frames)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def extract_wav(video, wav):
    if os.path.exists(wav):
        return
    r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", wav])
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:])


def loudness(video):
    r = run(["ffmpeg", "-nostats", "-hide_banner", "-i", video, "-vn", "-af", "ebur128=peak=true",
             "-f", "null", "-"])
    txt = r.stderr
    i = txt.rfind("Integrated loudness")
    seg = txt[i:] if i >= 0 else ""

    def grab(pat):
        m = re.search(pat, seg)
        return float(m.group(1)) if m else None
    return {"lufs": grab(r"I:\s+(-?[\d.]+) LUFS"), "lra": grab(r"LRA:\s+(-?[\d.]+) LU"),
            "true_peak_db": grab(r"Peak:\s+(-?[\d.]+) dBFS")}


def runs(mask):
    import numpy as np
    m = np.asarray(mask, dtype=int)
    d = np.diff(np.concatenate([[0], m, [0]]))
    starts = np.where(d == 1)[0]
    ends = np.where(d == -1)[0]
    return [[int(a), int(b)] for a, b in zip(starts, ends)]


def otsu(values, bins=128):
    import numpy as np
    hist, edges = np.histogram(values, bins=bins)
    hist = hist.astype(float)
    centers = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    s0 = np.cumsum(hist * centers)
    m0 = s0 / np.maximum(w0, 1)
    m1 = (s0[-1] - s0) / np.maximum(w1, 1)
    between = w0 * w1 * (m0 - m1) ** 2
    return float(centers[int(np.argmax(between))])


def analyze_audio(wav):
    """Pitch contour, loudness contour, speech segments and phrases (all on a 20 ms grid)."""
    import numpy as np
    import soundfile as sf
    import librosa
    from scipy.signal import resample_poly
    y, sr = sf.read(wav, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    assert sr == SR
    y8 = resample_poly(y, 1, 2).astype("float32")
    f0, _, _ = librosa.pyin(y8, fmin=65, fmax=450, sr=8000, frame_length=512, hop_length=160,
                            fill_na=np.nan)
    rms = librosa.feature.rms(y=y, frame_length=640, hop_length=HOP, center=True)[0]
    n = min(len(f0), len(rms))
    f0, rms = f0[:n], rms[:n]
    db = 20 * np.log10(rms + 1e-8)
    loud = float(np.percentile(db, 95))
    floor = float(np.percentile(db, 5))
    thr = otsu(db)
    thr = min(thr, loud - 12)          # at least 12 dB under the loud end
    thr = max(thr, floor + 6)          # at least 6 dB over the floor
    speech = db > thr
    segs = runs(speech)
    merged = []                         # bridge gaps under 120 ms
    for a, b in segs:
        if merged and (a - merged[-1][1]) * FR < 0.12:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    merged = [(a, b) for a, b in merged if (b - a) * FR >= 0.15]
    phrases = []                        # a phrase ends at a gap of 300 ms or more
    for a, b in merged:
        if phrases and (a - phrases[-1][1]) * FR < 0.30:
            phrases[-1][1] = b
        else:
            phrases.append([a, b])
    return {"y": y, "f0": f0, "db": db, "thr": thr,
            "phrases": [(int(a), int(b)) for a, b in phrases], "dur": len(y) / sr}


# ---------------- speech to text (two small models) ----------------
def make_whisper(model_dir, threads):
    import sherpa_onnx
    m = os.path.join(model_dir, "base.en")
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=m + "-encoder.int8.onnx", decoder=m + "-decoder.int8.onnx",
        tokens=m + "-tokens.txt", num_threads=threads, language="en", task="transcribe")


def make_zip(model_dir, threads):
    import sherpa_onnx
    d = model_dir.rstrip("/") + "/"
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=d + "tokens.txt", encoder=d + "encoder-epoch-99-avg-1.int8.onnx",
        decoder=d + "decoder-epoch-99-avg-1.int8.onnx", joiner=d + "joiner-epoch-99-avg-1.int8.onnx",
        num_threads=threads, sample_rate=SR, feature_dim=80, decoding_method="greedy_search",
        enable_endpoint_detection=False)


def zip_words(rec, y):
    """Rough words with times. Text is poor; times are what we use."""
    import numpy as np
    s = rec.create_stream()
    s.accept_waveform(SR, y)
    s.accept_waveform(SR, np.zeros(SR, dtype="float32"))
    s.input_finished()
    while rec.is_ready(s):
        rec.decode_stream(s)
    r = rec.get_result_all(s)
    words, cur = [], None
    for tok, t in zip(r.tokens, r.timestamps):
        if cur is None or tok.startswith(" "):
            if cur:
                words.append(cur)
            cur = [tok.strip(), float(t)]
        else:
            cur[0] += tok
    if cur:
        words.append(cur)
    return [[norm_word(w), t] for w, t in words if norm_word(w)]


def make_chunks(phrases, max_s=26.0):
    chunks = []
    for a, b in phrases:
        t0, t1 = a * FR, b * FR
        if chunks and t1 - chunks[-1][0] <= max_s:
            chunks[-1][1] = t1
        else:
            chunks.append([t0, t1])
    return chunks


def whisper_chunks(rec, y, chunks, cache, budget_end):
    import numpy as np
    pad = np.zeros(int(0.25 * SR), dtype="float32")
    for k, (t0, t1) in enumerate(chunks):
        key = str(k)
        if key in cache:
            continue
        if time.time() > budget_end:
            return False
        seg = y[max(0, int((t0 - 0.1) * SR)): int((t1 + 0.1) * SR)]
        texts = []
        for p in range(0, len(seg), 28 * SR):
            part = seg[p:p + 28 * SR]
            if len(part) < int(0.3 * SR):
                continue
            st = rec.create_stream()
            st.accept_waveform(SR, np.concatenate([pad, part, pad]))
            rec.decode_stream(st)
            texts.append(st.result.text.strip())
        cache[key] = " ".join(t for t in texts if t)
    return True


def word_times(zw, chunk_text, chunks, phrases):
    """Give every whisper word a time by anchoring it to the rough model's words."""
    import numpy as np
    ww, w_chunk = [], []
    for k, t in enumerate(chunk_text):
        for w in t.split():
            nw = norm_word(w)
            if nw:
                ww.append(nw)
                w_chunk.append(k)
    if not ww or not zw:
        return ww, w_chunk, [], 0.0
    # the rough model reports a token a little after it starts: measure that lag from phrase onsets
    deltas = []
    for a, b in phrases:
        t0 = a * FR
        cand = [t for _, t in zw if t0 - 0.3 <= t <= t0 + 1.0]
        if cand:
            deltas.append(min(cand) - t0)
    lag = float(np.median(deltas)) if deltas else 0.0
    zt = [(w, max(0.0, t - lag)) for w, t in zw]
    sm = difflib.SequenceMatcher(None, [w for w, _ in zt], ww, autojunk=False)
    anchors = {}
    for blk in sm.get_matching_blocks():
        for d in range(blk.size):
            anchors[blk.b + d] = zt[blk.a + d][1]
    if 0 not in anchors:
        anchors[0] = chunks[0][0]
    last = len(ww) - 1
    if last not in anchors:
        anchors[last] = chunks[-1][1] - 0.2
    idx = sorted(anchors)
    ts = np.maximum.accumulate([anchors[i] for i in idx])
    times = np.interp(np.arange(len(ww)), idx, ts)
    return ww, w_chunk, [float(t) for t in times], lag


# ---------------- numbers from the sound ----------------
def contour_metrics(A):
    """Everything that comes straight from pitch and loudness."""
    import numpy as np
    from scipy.signal import medfilt
    f0, db, phrases = A["f0"], A["db"], A["phrases"]
    speech_frames = sum(b - a for a, b in phrases)
    allf = np.concatenate([f0[a:b] for a, b in phrases]) if phrases else np.array([])
    allf = allf[np.isfinite(allf)]
    out = {}
    if len(allf) < 50:
        out["pitch_ok"] = False
        return out, [], None
    med = float(np.median(allf))
    st_all = 12 * np.log2(f0 / med)           # whole video, NaN where unvoiced
    stv = st_all[np.isfinite(st_all)]
    sp_mask = np.zeros(len(f0), dtype=bool)
    for a, b in phrases:
        sp_mask[a:b] = True
    stv = st_all[sp_mask & np.isfinite(st_all)]
    out.update({
        "pitch_ok": True,
        "f0_median_hz": round(med, 1),
        "pitch_sd_st": round(float(np.std(stv)), 2),
        "pitch_p10_p90_st": round(float(np.percentile(stv, 90) - np.percentile(stv, 10)), 2),
        "voiced_pct_of_speech": round(100 * len(stv) / max(speech_frames, 1), 1),
    })
    meta = []
    for k, (a, b) in enumerate(phrases):
        seg = st_all[a:b]
        v = np.isfinite(seg)
        dseg = db[a:b]
        row = {"k": k, "t0": round(a * FR, 2), "t1": round(b * FR, 2), "loud_db": float(np.mean(dseg)),
               "level_st": None, "range_st": None, "accents": 0}
        if v.sum() >= 8:
            level = float(np.nanmedian(seg))
            row["level_st"] = level
            row["range_st"] = float(np.nanpercentile(seg, 90) - np.nanpercentile(seg, 10))
            fill = np.where(v, seg, level)
            sm = medfilt(fill, 5)
            dsm = medfilt(dseg, 5)
            dmed = float(np.median(dseg))
            hit = ((sm - level) >= 3.0) & v
            hit = np.logical_or(hit, (dsm - dmed) >= 5.0)
            acc = [r for r in runs(hit) if (r[1] - r[0]) >= 5]
            merged = []
            for r in acc:
                if merged and (r[0] - merged[-1][1]) * FR < 0.15:
                    merged[-1][1] = r[1]
                else:
                    merged.append(list(r))
            row["accents"] = len(merged)
        meta.append(row)
    good = [p for p in meta if p["level_st"] is not None]
    out["phrases"] = len(phrases)
    out["phrase_level_sd_st"] = round(float(np.std([p["level_st"] for p in good])), 2) if good else None
    out["phrase_range_mean_st"] = round(float(np.mean([p["range_st"] for p in good])), 2) if good else None
    sp = np.concatenate([db[a:b] for a, b in phrases])
    out["loud_sd_db"] = round(float(np.std(sp)), 2)
    out["loud_p10_p90_db"] = round(float(np.percentile(sp, 90) - np.percentile(sp, 10)), 2)
    out["phrase_loud_sd_db"] = round(float(np.std([p["loud_db"] for p in meta])), 2)
    out["accents_total"] = int(sum(p["accents"] for p in meta))
    return out, meta, st_all


def window_slope(st_all, t_end, back=0.45, fwd=0.10):
    """Pitch change over the last stretch before t_end: second half minus first half, in semitones."""
    import numpy as np
    a = max(0, int((t_end - back) / FR))
    b = min(len(st_all), int((t_end + fwd) / FR) + 1)
    seg = st_all[a:b]
    idx = np.where(np.isfinite(seg))[0]
    if len(idx) < 6:
        return None
    half = len(idx) // 2
    return float(np.mean(seg[idx[half:]]) - np.mean(seg[idx[:half]]))


def timing_metrics(A, nwords):
    import numpy as np
    phrases = A["phrases"]
    dur = A["dur"]
    if not phrases:
        return {"timing_ok": False}
    t_first, t_last = phrases[0][0] * FR, phrases[-1][1] * FR
    gaps = [(phrases[i + 1][0] - phrases[i][1]) * FR for i in range(len(phrases) - 1)]
    speak = sum((b - a) * FR for a, b in phrases)
    span = t_last - t_first
    plen = [(b - a) * FR for a, b in phrases]
    return {
        "timing_ok": True,
        "duration_s": round(dur, 1),
        "lead_silence_s": round(t_first, 2),
        "trail_silence_s": round(dur - t_last, 2),
        "words": nwords,
        "wpm_overall": round(nwords / span * 60) if span > 0 else None,
        "wpm_speaking": round(nwords / speak * 60) if speak > 0 else None,
        "pauses": len(gaps),
        "pauses_per_min": round(len(gaps) / (span / 60), 1) if span > 0 else None,
        "pause_total_s": round(sum(gaps), 1),
        "pause_pct_of_span": round(100 * sum(gaps) / span, 1) if span > 0 else None,
        "pause_median_s": round(float(np.median(gaps)), 2) if gaps else None,
        "pause_max_s": round(max(gaps), 2) if gaps else None,
        "pauses_over_1s": int(sum(g >= 1.0 for g in gaps)),
        "pauses_over_1_5s": int(sum(g >= 1.5 for g in gaps)),
        "phrase_len_mean_s": round(float(np.mean(plen)), 2),
        "phrase_len_sd_s": round(float(np.std(plen)), 2),
        "gaps": [round(g, 2) for g in gaps],
    }


FILLER_RE = re.compile(r"\b(um+|uh+|uhm|erm|er|ah|hmm+)\b", re.I)


def text_metrics(text, phrase_words):
    fillers = FILLER_RE.findall(text)
    restarts = 0
    for i in range(1, len(phrase_words)):
        cur = phrase_words[i]
        if len(cur) < 3:
            continue
        for j in (i - 1, i - 2):
            if j >= 0 and phrase_words[j][:3] == cur[:3]:
                restarts += 1
                break
    return {"fillers_heard": len(fillers), "restarts": restarts}


def script_metrics(marks, ww, times, st_all, db, A):
    """Line the script up with what he said, then check each mark."""
    import numpy as np
    if not marks or not marks.get("lines") or not ww:
        return {}
    s_words, s_line, s_caps = [], [], []
    for ln in marks["lines"]:
        capset = set(ln["caps"])
        for w in ln["text"].split():
            nw = norm_word(w)
            if nw:
                s_words.append(nw)
                s_line.append(ln["i"])
                core = re.sub(r"[^A-Za-z']", "", w)
                s_caps.append(bool(len(core) >= 2 and core.isupper() and core in capset))
    sm = difflib.SequenceMatcher(None, s_words, ww, autojunk=False)
    s_to_w = {}
    for blk in sm.get_matching_blocks():
        for d in range(blk.size):
            s_to_w[blk.a + d] = blk.b + d
    matched = len(s_to_w)
    res = {
        "script_words": len(s_words), "said_words": len(ww),
        "script_covered_pct": round(100 * matched / len(s_words), 1),
        "said_off_script_pct": round(100 * (len(ww) - matched) / len(ww), 1),
    }
    # ---- where each script line ends, in seconds
    speech = np.zeros(len(db), dtype=bool)
    for a, b in A["phrases"]:
        speech[a:b] = True
    phr = A["phrases"]
    gap_starts = [(phr[i][1] * FR, (phr[i + 1][0] - phr[i][1]) * FR) for i in range(len(phr) - 1)]
    rows = []
    last_line = marks["lines"][-1]["i"]
    for ln in marks["lines"]:
        idxs = [i for i, l in enumerate(s_line) if l == ln["i"]]
        hit = next((s_to_w[i] for i in reversed(idxs[-4:]) if i in s_to_w), None)
        if hit is None or hit >= len(times):
            rows.append({"line": ln["i"], "found": False, "pitch_up": ln["pitch_up"]})
            continue
        t_end = times[hit] + 0.30                       # a word takes about 0.3 s
        # snap to a real end of speech if one is close
        near = [(abs(g0 - t_end), g0, g) for g0, g in gap_starts if abs(g0 - t_end) <= 0.6]
        pause = 0.0
        if near:
            _, g0, g = min(near)
            t_end = g0
            pause = g
        rows.append({
            "line": ln["i"], "found": True, "pitch_up": ln["pitch_up"], "t_end": round(t_end, 2),
            "end_slope_st": window_slope(st_all, t_end), "pause_after_s": round(pause, 2),
            "is_last": ln["i"] == last_line,
        })
    res["line_ends"] = rows
    inner = [r for r in rows if r["found"] and not r["is_last"]]
    ups = [r for r in inner if r["pitch_up"] and r["end_slope_st"] is not None]
    others = [r for r in inner if not r["pitch_up"] and r["end_slope_st"] is not None]
    res["up_lines_checked"] = len(ups)
    res["up_lines_rising"] = sum(r["end_slope_st"] >= 1.5 for r in ups)
    res["up_slope_mean_st"] = round(float(np.mean([r["end_slope_st"] for r in ups])), 2) if ups else None
    res["other_slope_mean_st"] = round(float(np.mean([r["end_slope_st"] for r in others])), 2) if others else None
    res["other_lines_rising_pct"] = round(100 * sum(r["end_slope_st"] >= 1.5 for r in others) / len(others), 1) if others else None
    res["breaks_checked"] = len(inner)
    res["breaks_paused"] = sum(r["pause_after_s"] >= 0.30 for r in inner)
    res["break_pause_mean_s"] = round(float(np.mean([r["pause_after_s"] for r in inner])), 2) if inner else None
    # ---- punch words: how much louder / higher than the words around them
    def lift(t):
        a, b = int(max(0, t - 0.05) / FR), int((t + 0.45) / FR) + 1
        lo, hi = int(max(0, t - 1.5) / FR), int((t + 1.95) / FR) + 1
        win = speech[lo:hi]
        if win.sum() < 10 or b - a < 5:
            return None
        base_db = float(np.median(db[lo:hi][win]))
        d_db = float(np.mean(db[a:b])) - base_db
        local = st_all[lo:hi][win]
        local = local[np.isfinite(local)]
        mine = st_all[a:b]
        mine = mine[np.isfinite(mine)]
        d_st = float(np.percentile(mine, 90) - np.median(local)) if len(mine) >= 3 and len(local) >= 8 else None
        return d_st, d_db
    caps_l, other_l = [], []
    for i, w in enumerate(s_words):
        if i not in s_to_w or s_to_w[i] >= len(times):
            continue
        L = lift(times[s_to_w[i]])
        if L is None:
            continue
        (caps_l if s_caps[i] else other_l).append(L)
    def avg(rows, j):
        vals = [r[j] for r in rows if r[j] is not None]
        return round(float(np.mean(vals)), 2) if vals else None
    res["caps_matched"] = len(caps_l)
    res["caps_lift_st"] = avg(caps_l, 0)
    res["caps_lift_db"] = avg(caps_l, 1)
    res["other_lift_st"] = avg(other_l, 0)
    res["other_lift_db"] = avg(other_l, 1)
    return res


def load_audio_cache(apath):
    import numpy as np
    z = np.load(apath, allow_pickle=True)
    return {"y": z["y"], "f0": z["f0"], "db": z["db"], "thr": float(z["thr"]),
            "phrases": [tuple(p) for p in z["phrases"].tolist()], "dur": float(z["dur"])}


def cmd_measure(args):
    import numpy as np
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    budget_end = time.time() + args.budget
    marks = {}
    if args.marks and os.path.exists(args.marks):
        marks = json.load(open(args.marks, encoding="utf-8"))
    files = sorted(f for f in os.listdir(args.videos) if f.lower().endswith(".mp4"))
    if args.only:
        files = [f for f in files if args.only.lower() in f.lower()]
    if args.shard:
        i, n = [int(x) for x in args.shard.split("/")]
        files = [f for k, f in enumerate(files) if k % n == i]
    threads = 4 if not args.shard else 2
    whisper = zrec = None
    pending = []
    for f in files:
        base = f[:-4]
        outp = os.path.join(args.out, base + ".json")
        if os.path.exists(outp) and not args.redo:
            continue
        if time.time() > budget_end:
            pending.append(f)
            continue
        video = os.path.join(args.videos, f)
        wav = os.path.join(args.cache, base + ".wav")
        lap = time.time()
        extract_wav(video, wav)
        print(f"  wav {time.time() - lap:.1f}s", flush=True)
        lap = time.time()
        apath = os.path.join(args.cache, base + ".audio.npz")
        if os.path.exists(apath):
            A = load_audio_cache(apath)
        else:
            A = analyze_audio(wav)
            np.savez(apath, y=A["y"], f0=A["f0"], db=A["db"], thr=A["thr"],
                     phrases=np.array(A["phrases"], dtype=int), dur=A["dur"])
            print(f"[audio] {base} ({A['dur']:.0f}s, {len(A['phrases'])} phrases) {time.time() - lap:.1f}s", flush=True)
        lap = time.time()
        # rough model: word times
        zpath = os.path.join(args.cache, base + ".zip.json")
        if os.path.exists(zpath):
            zw = json.load(open(zpath))
        else:
            if zrec is None:
                zrec = make_zip(args.zip_model, threads)
            zw = zip_words(zrec, A["y"])
            json.dump(zw, open(zpath, "w"))
            print(f"  zip {time.time() - lap:.1f}s", flush=True)
        lap = time.time()
        # whisper: the words
        chunks = make_chunks(A["phrases"])
        tpath = os.path.join(args.cache, base + ".whisper.json")
        tcache = json.load(open(tpath)) if os.path.exists(tpath) else {}
        if len(tcache) < len(chunks):
            if whisper is None:
                whisper = make_whisper(args.model, threads)
            done = whisper_chunks(whisper, A["y"], chunks, tcache, budget_end)
            json.dump(tcache, open(tpath, "w"))
            print(f"  whisper {len(chunks)} chunks {time.time() - lap:.1f}s", flush=True)
            if not done:
                pending.append(f)
                print(f"[partial] {base}: {len(tcache)}/{len(chunks)} chunks", flush=True)
                continue
        chunk_text = [tcache.get(str(k), "") for k in range(len(chunks))]
        ww, w_chunk, times, lag = word_times(zw, chunk_text, chunks, A["phrases"])
        cm, meta, st_all = contour_metrics(A)
        res = {"file": f, "ad": TAKE_RE.sub("", f)}
        lap = time.time()
        res.update(loudness(video))
        print(f"  loudness {time.time() - lap:.1f}s", flush=True)
        res.update(timing_metrics(A, len(ww)))
        res.update(cm)
        # words per phrase (by time) for restarts
        pw = [[] for _ in A["phrases"]]
        for w, t in zip(ww, times):
            k = min(range(len(A["phrases"])),
                    key=lambda j: 0 if A["phrases"][j][0] * FR - 0.1 <= t <= A["phrases"][j][1] * FR + 0.1
                    else min(abs(t - A["phrases"][j][0] * FR), abs(t - A["phrases"][j][1] * FR)))
            pw[k].append(w)
        res.update(text_metrics(" ".join(chunk_text), pw))
        res["silence_threshold_db"] = round(A["thr"], 1)
        res["word_time_lag_s"] = round(lag, 2)
        if st_all is not None:
            res["script"] = script_metrics(marks.get(res["ad"]), ww, times, st_all, A["db"], A)
        res["transcript"] = " ".join(chunk_text)
        res["phrase_meta"] = meta
        json.dump(res, open(outp, "w"), indent=1, ensure_ascii=False)
        print(f"[done] {base}: {res.get('words')}w {res.get('wpm_overall')}wpm "
              f"sd={res.get('pitch_sd_st')}st pauses={res.get('pauses')}", flush=True)
    print("PENDING", len(pending), pending)
    return 0


# --------------------------------------------------------------------------------------
# rate: compare what the script asks for with what the video does
# --------------------------------------------------------------------------------------
def band(v, cuts, labels):
    for c, lab in zip(cuts, labels):
        if v <= c:
            return lab
    return labels[-1]


def rate_one(r, set_sd):
    """Returns list of (topic, light, note, fix). light: OK / WATCH / FIX / n/a."""
    out = []
    if (r.get("phrases") or 0) <= 2:
        return [("Measurement", "n/a", "silence was never detected (constant noise), so pauses and pitch are not trustworthy", "")]
    wpm = r.get("wpm_overall")
    if wpm:
        light = "OK" if 160 <= wpm <= 200 else ("WATCH" if wpm <= 215 else "FIX")
        if wpm < 160:
            light = "WATCH"
        fix = ""
        if wpm > 200:
            fix = "Slow the teleprompter 10 to 20 wpm. Fast reads drop the pauses first."
        elif wpm < 160:
            fix = "Raise the teleprompter speed 10 to 20 wpm."
        out.append(("Pace", light, f"{wpm:.0f} wpm", fix))
    dead = r.get("pauses_over_1_5s", 0)
    edge = (r.get("lead_silence_s") or 0) > 1.0 or (r.get("trail_silence_s") or 0) > 1.5
    light = "OK" if dead <= 2 and not edge else ("WATCH" if dead <= 6 else "FIX")
    out.append(("Dead air", light, f"{dead} pauses over 1.5 s, longest {r.get('pause_max_s')} s, "
                f"start {r.get('lead_silence_s')} s, end {r.get('trail_silence_s')} s",
                "Cut every pause over 1.5 s and trim the head and tail." if light != "OK" else ""))
    if r.get("pitch_ok"):
        d = r["pitch_sd_st"] - set_sd
        light = "WATCH" if d < -0.3 else "OK"
        out.append(("Pitch variety", light, f"pitch spread {r['pitch_sd_st']} st (your median {set_sd:.2f})",
                    "Flatter than your usual. Re-read with the punch words higher, not just louder." if light == "WATCH" else ""))
    s = r.get("script") or {}
    if s.get("up_lines_checked"):
        k, n = s["up_lines_rising"], s["up_lines_checked"]
        light = "OK" if k == n else ("WATCH" if k else "FIX")
        out.append(("Pitch-up lines", light, f"{k} of {n} marked lines went up (avg {s['up_slope_mean_st']} st)",
                    "Lift the last 2 words of every line with the up arrow." if light != "OK" else ""))
    if s.get("caps_matched"):
        dst = (s["caps_lift_st"] or 0) - (s["other_lift_st"] or 0)
        ddb = (s["caps_lift_db"] or 0) - (s["other_lift_db"] or 0)
        light = "OK" if dst >= 0.5 or ddb >= 1.0 else ("WATCH" if dst > -0.5 else "FIX")
        out.append(("Punch words", light, f"CAPS words vs other words: {dst:+.1f} st, {ddb:+.1f} dB",
                    "CAPS words are not standing out. Hit them harder and leave a beat before the biggest ones." if light != "OK" else ""))
    if s.get("breaks_checked"):
        k, n = s["breaks_paused"], s["breaks_checked"]
        light = "OK" if k / n >= 0.8 else "WATCH"
        out.append(("Pauses on blank lines", light, f"{k} of {n} paused (avg {s['break_pause_mean_s']} s)",
                    "Stop at each blank line. The pause is part of the line." if light != "OK" else ""))
    if s.get("script_covered_pct") is not None:
        c = s["script_covered_pct"]
        light = "OK" if c >= 90 else ("WATCH" if c >= 75 else "FIX")
        out.append(("Script covered", light, f"{c}% of script words heard",
                    "Lines were skipped or changed. Check the script against this take." if light != "OK" else ""))
    return out


def cmd_rate(args):
    import statistics as stt
    rs = []
    for f in sorted(os.listdir(args.metrics)):
        if f.endswith(".json"):
            rs.append(json.load(open(os.path.join(args.metrics, f), encoding="utf-8")))
    marks = json.load(open(args.marks, encoding="utf-8"))
    good = [r["pitch_sd_st"] for r in rs if r.get("pitch_ok") and (r.get("pauses") or 0) > 0]
    set_sd = stt.median(good)
    L = []
    L.append("# Ad tonality report\n")
    L.append(f"Measured {len(rs)} videos. Your own median pitch spread is {set_sd:.2f} semitones (st). "
             "Lights: OK, WATCH, FIX. Method and limits are at the bottom.\n")
    L.append("## Scorecard\n")
    L.append("| Video | Pace | Dead air | Pitch | Pitch-up | Punch | Blank-line pauses | Script |")
    L.append("|---|---|---|---|---|---|---|---|")
    notes = []
    for r in rs:
        rows = {t: (l, n, fx) for t, l, n, fx in rate_one(r, set_sd)}
        name = r["file"][:-4]
        def cell(t):
            return rows[t][0] if t in rows else "-"
        L.append(f"| {name} | {cell('Pace')} | {cell('Dead air')} | {cell('Pitch variety')} | "
                 f"{cell('Pitch-up lines')} | {cell('Punch words')} | {cell('Pauses on blank lines')} | {cell('Script covered')} |")
        fixes = [f"{t}: {n}. {fx}" for t, (l, n, fx) in rows.items() if fx]
        notes.append((name, fixes))
    L.append("\n## Suggestions per take\n")
    for name, fixes in notes:
        L.append(f"**{name}**")
        L.extend(f"- {x}" for x in fixes[:4]) if fixes else L.append("- Nothing to fix on these checks.")
        L.append("")
    L.append("## What each script asks for\n")
    L.append("| Script | Words | Blank-line pauses | CAPS punches | Pitch-up marks | Runtime at 150 wpm | at 205 wpm |")
    L.append("|---|---|---|---|---|---|---|")
    for name, m in marks.items():
        if m.get("script"):
            L.append(f"| {name} | {m['words']} | {m['pauses']} | {m['caps']} | {m['pitch_ups']} | "
                     f"{m['seconds_at_150wpm']:.0f} s | {m['seconds_at_205wpm']:.0f} s |")
        else:
            L.append(f"| {name} | no script in repo | | | | | |")
    open(args.out, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("wrote", args.out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("marks")
    m.add_argument("--repo", required=True, help="repo root (the folder with marketing/)")
    m.add_argument("--map", required=True)
    m.add_argument("--out", required=True)
    m.set_defaults(fn=cmd_marks)
    me = sub.add_parser("measure")
    me.add_argument("--videos", required=True)
    me.add_argument("--cache", required=True, help="folder for wav/audio/text cache")
    me.add_argument("--out", required=True, help="folder for per-video metric json")
    me.add_argument("--model", required=True, help="whisper base.en folder (base.en-*.int8.onnx + tokens)")
    me.add_argument("--zip-model", required=True, help="streaming zipformer 20M folder (word times)")
    me.add_argument("--marks")
    me.add_argument("--budget", type=float, default=150, help="seconds to work before stopping")
    me.add_argument("--only")
    me.add_argument("--shard", help="i/n: handle every n-th video, for running in parallel")
    me.add_argument("--redo", action="store_true")
    me.set_defaults(fn=cmd_measure)
    ra = sub.add_parser("rate")
    ra.add_argument("--metrics", required=True)
    ra.add_argument("--marks", required=True)
    ra.add_argument("--out", required=True)
    ra.set_defaults(fn=cmd_rate)
    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
