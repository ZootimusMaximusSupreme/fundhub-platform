# FundHub 297 ad pack — index (do not regenerate)

**Owner-set:** These ads were written and locked as a batch. Agents **look up** an id here and **edit or variant** — they do **not** rewrite the whole pack from scratch.

**Ad id** = leading digits of `utm_content` (same as `fundhub_ad_id()` in the database). Title slug optional.

---

## Canonical files (keep them in this folder)

| File | What it is |
|---|---|
| **`FundHub-297-Ads-FINAL.pdf`** | Print / share master |
| **`FundHub-LOCKED-ADS.md`** | Locked scripts — source of truth for “already done” |
| **`FundHub-297-Ads-2026-09-18.md`** | Working markdown export (Sep 2026) |
| **`FundHub-297-Ads-v2.md`** | Revision pass |
| **`FundHub-297-Final-Ten.md`** | Last ten picked for shoot |
| **`FundHub-VSL-Scripts.md`** | VSL scripts for this offer batch |

If a file is missing on disk, **stop and ask Chris** to drop it here before writing that ad number again. Do not invent a replacement script and call it “297.”

---

## Agent rules

1. Chris names an **ad number** (or `utm_content` like `42` or `42-ringlights`).
2. Search **`FundHub-LOCKED-ADS.md`** and the other markdown files above for that number.
3. If the script exists → **change only what Chris asked**. Do not “refresh” or “improve” locked copy.
4. If the number is **new** (not in pack) → write under `marketing/ads/scripts/YYYY-MM-DD.md` using `RULES.md` + `VOICE.md`, not by redoing the whole 297 set.
5. **`marketing/ads/registry.json`** only lists a **small seed** of ids with lanes — most ids resolve to sorting default. Missing registry row is **not** a reason to regenerate copy.

---

## Related (not the 297 pack)

| Path | Use |
|---|---|
| `marketing/ads/CONTROLS.md` | Five ads **live** today ($32–36 booked call) — separate lock |
| `marketing/ads/slo/SLO-CHAT-PROMPT.md` | $297 SLO **chat-only** prompt (no repo attach) |
| `marketing/ads/WRITE-ADS-FROM-HERE.md` | Fast path brief for any new ad work |

---

## Commit note

This index belongs in git even when the PDF is too large to commit. Markdown pack files **should** be committed when Chris saves them here so agents stop regenerating.
