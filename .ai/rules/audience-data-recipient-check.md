---
description: Check what a platform accepts before giving it a customer list or audience insight
alwaysApply: true
---

# Check audience data before sharing

**Owner rule (2026-11-02), corrected oversight ~2 PM Arizona:** Before uploading, syncing, or creating an audience from a customer list, read the actual source and check the destination platform's current allowed data. Check **how people were selected**, the **uploaded fields**, the **audience name and description**, and any metadata that tells the platform why the list exists. A hash on email or phone does not hide forbidden field columns, does not erase credit- or income-based selection, and does not make a neutral title safe when the list was built on financial status.

## What to check

1. **Selection** — If the list was filtered on credit score, income band, subprime/prime tier, or similar consumer financial status, that criteria is part of what you send the platform even when only hashed email and phone are uploaded. Neutral Batch A/B/C names do not change who is on the list.
2. **Uploaded fields** — Send only fields the platform allows. No credit score, income, consumer-report, or revenue columns in the upload payload unless the platform explicitly allows them. On Fundhub's Meta path, uploads are hashed email and phone only; still verify selection first.
3. **Names and metadata** — Do not put credit, score bands, income hints, or tier words in audience names or descriptions. That is necessary but not sufficient. Naming alone does not fix a financially filtered list.

## Meta (Fundhub)

For Meta, do not build or use Custom Audiences or lookalike seeds selected by credit score, income, financial status, or consumer-report data. Keep those insights local.

Do not upload customer lists to Meta when selection used credit score or income rules, including gitignored tier splits for Blueprint, Funding, or Prime, unless Chris explicitly approves a policy Meta accepts for this offer. Nov 2026: mislabeled audiences hit operation_status 471. Neutral-named batches built from the same credit/income filters remain under oversight: do not target them, do not seed lookalikes from them, and do not wire them into ad sets without new owner direction.

**Frozen (2026-11-02 ~2 PM):** `scripts/meta-audience-segment-repair.mjs`, `scripts/meta-create-batch-lookalikes.mjs`, and `scripts/meta-replace-audience-users.mjs` exit immediately on every run — no environment bypass. Chris has not approved new audience writes; deletion of the nine Batch audiences awaits his explicit decision.

If a platform rejects or restricts an audience, stop. Do not rename, repackage, or retry the same disallowed segment with a new financial keyword or a neutral name only. Keep it out of ad sets. Record what was sent. Ask Chris before deleting uploaded data on the platform.

## Never assume

- Terms accepted, "Ready," or "Populating" in Ads Manager proves safe targeting or lookalike seeds.
- Keeping segmentation in gitignored `credentials/` authorizes uploading that segment to Meta.
- A lookalike below Meta's size guidance is ready to use in ad sets.
