---
description: All filmed SLO video lives in one Drive folder — SLO Ads root only
alwaysApply: true
---

# SLO filmed video — one folder

**Owner law (2026-09-24):** Chris films ads and VSLs. **One Drive folder** holds every filmed SLO file. That is it.

**SLO only (owner-set 2026-10-24).** This law is for SLO. Direct Book filmed videos go in their own Drive folder (`DIRECT_BOOK_ADS_FOLDER_ID`), never in SLO Ads.

## The folder

**SLO Ads** — Drive id `13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ`

https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ

Phone upload, Riverside export, agent move — **all filmed MP4s land here** with names from `marketing/ads/NAMING.md`.

`DRIVE_RAW_FOLDER_ID` in env **is this same folder** (sweeper watches SLO Ads root). There is no separate “Raw inbox” for Chris to check.

## Never

- Tell Chris to look in a **Raw** subfolder for filmed takes
- Copy the same take into SLO Ads root **and** Raw (one canonical file per md5 in the main folder)
- Run `scripts/ad-video-move-takes-to-raw.mjs` (dead — it moved files **out** of the one folder)
- Trash or dedupe filmed files without Chris naming that file

## Always

- Resolve Drive links from **live** `files.list` on SLO Ads root (or search by name), not stale inventory JSON
- Finished ads for Paul use **`DRIVE_PAUL_FOLDER_ID`** — that is delivery, not filming
- Subfolders under SLO Ads (`broll`, `_md5-duplicates-from-raw`) are not where filmed ads live

## Example

```text
Ask: "Where is Ad 7 Take 1?"

❌ Raw subfolder, Call Pitch Take 1 from Sept inventory, or the SLO Ads duplicate id from an old JSON row.
✅ Search SLO Ads root for `SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4` and paste that file link.
```
