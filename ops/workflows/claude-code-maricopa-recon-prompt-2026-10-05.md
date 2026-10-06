# Claude Code prompt — course ↔ your filings (local only)

Paste everything below the line into Claude Code.

---

You are in `/Users/chrisstanbridge/Developer/fundhub-platform`.

## What this job is

Build **one solid process** from Bryan Stay Strong’s **scraped Thinkific course**: lesson order, what he says to do at each step, what **document types** belong to that step, and how to tell DONE vs still missing — **for any property / any state** (Bryan’s Texas examples stay examples; the doc says “use your state and your recorder” the way he does).

Then **map Chris’s real filings** onto that process using local INDEX and Drive extracts — as a **worked example only**, not as if the whole SOP is about one address.

**7137 E Rancho Vista Dr Unit 4011, Scottsdale AZ** is the **sample case** in INDEX and in the alignment board. The main playbook is **the method + checklist**, not a single-house manual.

This is **info and filing inventory**, not legal advice and not you deciding whether the method is valid.

## Hard stops

- **NO research online.** No Google. No blogs. No Thinkific login. No YouTube. No legal sites. **No county recorder websites.** No web fetch except what the export script already does for fonts/PDF.
- **NO prejudgment.** Do not argue with the course or add “this won’t work.” Quote Bryan from local transcripts; state filing facts from INDEX for the example only.
- **NO outbound actions.** Do not mail, record, file, notarize, or upload anything except the finished playbook PDF via the export script at the end.

## Read these local sources only (in this order)

1. **Course scrape (primary 37-lesson track):**
   - `credentials/drive-course-docs-temp/thinkific-export/course-material/mortgage-re-con-veyance-course-lessons.json`
   - `credentials/drive-course-docs-temp/thinkific-export/course-material/mortgage-re-con-veyance-course/` (per-lesson `.md` with transcripts)
   - `credentials/drive-course-docs-temp/thinkific-export/course-material/COMPLETE-STUDY-GUIDE.md` (lookup only — prefer per-lesson files)
2. **Extra tracks when Bryan points to them:**  
   `warranty-deep-acceptance/`, `re-verse-overlay-mortgage-re-con-veyance-the-stand-strong-way/` (+ `004-webinar-chunks/`), `mortgage-re-con-veyance-webinar/`, `mers-fraud-x-posed/`
3. **Template text pulled from Drive (generic forms):** `credentials/drive-course-docs-temp/*.txt`
4. **Example property index (do not treat as the scope of the whole job):** `credentials/drive-course-docs-temp/INDEX.txt`
5. **Example alignment draft:** `ops/workflows/mortgage-recon-course-alignment-2026-10-05.md`
6. **Playbook to restructure:** `docs/sops/mortgage-reconveyance-playbook-2026-10-05.md`
7. **Example recorded PDFs on disk:** `credentials/mortgage-recon-playbook/maricopa/`

## What to write

Rewrite `docs/sops/mortgage-reconveyance-playbook-2026-10-05.md` in **two parts**:

### Part A — The process (any property)

For **each lesson in course order** (intro → disclaimer → MOD1 … → MERS optional):

1. **Lesson # and title** (from JSON)
2. **What Bryan says to do** — bullets from **local transcript** only
3. **Your state** — one line when he uses Texas: look up the same idea in **your** state/recorder (no online statute research; repeat his instruction)
4. **Documents this step produces or needs** — generic names (warranty deed acceptance packet, UCC-1, signed SOA, presentment, notary chain, recorded release, etc.)
5. **Done when** — observable checklist (filed, mailed with receipt, recorded copy in folder, etc.)
6. **Templates in repo** — point to `credentials/drive-course-docs-temp/*.txt` or Drive folder names when a local `.txt` exists

Include: one **master flowchart** (Mermaid), course order only — no single address in the diagram title.

### Part B — Worked example (Scottsdale #4011 only)

Short section or appendix: map Part A steps to **INDEX.txt** — recorder numbers, folder names, DONE/PARTIAL/GAP. Facts for the example:

- Loan **#6000041372**, bridge **Acct 68846**; Maricopa recordings listed in INDEX
- **County recorded REL D/T:** INDEX says **not found** for that unit unless a local `maricopa/` PDF proves otherwise
- **Dissolution of Deed of Trust 2** = draft, **not** a county REL D/T
- **Florida** deed acceptance in Drive = different property; label it when mapping MOD1

Do **not** bake “4011” into Part A step titles. Part B can use the address once in the heading.

Update `ops/workflows/mortgage-recon-course-alignment-2026-10-05.md`: header must say **example property #4011**; table is **illustration** of Part B, synced with the playbook appendix.

Fix `credentials/drive-course-docs-temp/INDEX.txt` only for typos — do not invent filings.

## Style

Plain English. Short sentences. Do not delete Bryan’s sequence — **course order is the spine**; filings are overlays on the example appendix.

## Finish

1. `node --env-file=.env scripts/mortgage-recon-playbook-export-drive.mjs` (rename PDF title in the script output if it still says only “4011” — use a generic title + “example: Unit 4011” subtitle if you touch the script constant `PDF_NAME`)
2. Reply with: Part A outline (lesson count), Part B GAP list for the example only, file paths changed. No lecture.
