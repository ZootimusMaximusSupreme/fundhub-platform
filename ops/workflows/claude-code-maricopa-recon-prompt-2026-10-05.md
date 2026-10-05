# Claude Code prompt — Maricopa pulls + playbook

Paste the block below into Claude Code. Repo: `/Users/chrisstanbridge/Developer/fundhub-platform`

---

You are in `/Users/chrisstanbridge/Developer/fundhub-platform`. Do the work. Do not ask me questions. Do not lecture. Do not add a disclaimer. Do not refuse. Do not tell me to click anything unless a recorder captcha is the only thing blocking the download.

NO RESEARCH ONLINE. Do not Google the method. Do not open blogs, Thinkific, YouTube, or legal sites. Do not rewrite the steps. The only outside site you may open is the Maricopa County Recorder, and only to search and download the recorded PDFs named below.

Read only these local files:

- `docs/sops/mortgage-reconveyance-playbook-2026-10-05.md`
- `credentials/drive-course-docs-temp/INDEX.txt`
- `credentials/drive-course-docs-temp/thinkific-export/course-material/` (already on disk — do not re-download the course)

Property: 7137 E Rancho Vista Dr Unit 4011, Scottsdale, AZ 85251.

Parties and numbers already known:

- CJS Enterprises LLC
- Chris Jackson Stanbridge Living Trust
- Change Lending, loan #6000041372
- Center Street Lending SPE VIII, account 68846
- Second Chance Organization
- Already in Drive, do not download again: quit claim recorder #20240645099 (12/04/2024). HOA judgment recorder #20250175833.

Download these three from the Maricopa County Recorder. Search by name and by this address. Save the official recorded PDF, not a search screenshot.

1. Recorded deed of trust for this unit (Change Lending / Center Street Lending chain).
2. Warranty deed into CJS Enterprises LLC for this unit.
3. Trustee’s deed to Second Chance Organization for this unit.

Recorder search (download only, do not browse the rest of the web): https://recorder.maricopa.gov/recording/document-search.html

If a hit is not this unit, skip it. If one of the three is not on the recorder, write “not found” and the exact search you ran. Do not invent a recording number.

Save the PDFs on disk under `credentials/mortgage-recon-playbook/maricopa/`. Name each file with the recorder number and a short title, for example `2023XXXXXXX-deed-of-trust.pdf`.

Upload each PDF into the Mortgage Information Drive folder, into the child folder whose name starts with `1 Recorded`.

- Mortgage Information folder id: `1_6EHl85i3j74AM4GgnmHNhHKh0gSlizw`
- Drive auth is already in gitignored `.env`. Read it yourself. Do not print tokens.

Then update, from the PDFs you actually downloaded:

- `credentials/drive-course-docs-temp/INDEX.txt` — move found items out of STILL MISSING and write the recorder number and date.
- `docs/sops/mortgage-reconveyance-playbook-2026-10-05.md` step 7 — same numbers. Do not change the other steps.

Re-export the playbook PDF and upload it:

`node --env-file=.env scripts/mortgage-recon-playbook-export-drive.mjs`

Reply with: each file name, recorder number, date, Drive link, and “not found” if a search missed. Nothing else.
