# Lead source attribution — 2026-10-13

## Owner request

Make sure leads from Blake Evertsen, Fundhub Funnel, and iCloud show their source correctly. Check the lead at `https://fundhub.ai/leads/c01cb7592c8bb994130158e897e99bf1/` and double-check the work.

## Work split

| Workflow | Owner | State | Scope |
| --- | --- | --- | --- |
| Source rules | agent | DONE | Find existing mappings, docs, and tests. No edits. |
| Live record check | agent | DONE | Check the named live lead and available records. No edits. |
| Repair and proof | root | DONE | Blake, Funnel, and verified iPhone-contact sources are labelled and published. |

## Prompts

### Source rules

Find all repository rules, mappings, docs, and tests that define how leads from Blake Evertsen, Fundhub Funnel, and iCloud are identified or labelled. Search `src/`, `scripts/`, `db/`, and `docs/`. Report exact files and expected values. Do not edit.

### Live record check

Inspect the lead at `https://fundhub.ai/leads/c01cb7592c8bb994130158e897e99bf1/` and any safe available source data for Blake Evertsen, Fundhub Funnel, and iCloud. Verify displayed source attribution. Record evidence only. Do not edit.

### Repair and proof

Using the confirmed source rules and observed lead behavior, make the smallest correct repair, add or update focused tests, and verify it. Do not change unrelated lead handling.

## Evidence

- Live `https://fundhub.ai/leads/c01cb7592c8bb994130158e897e99bf1/` loads one inline, local-only list of 84 leads. It has no API request or persisted source field.
- The list has 20 rows labelled `clickfunnels` (L065-L084), 41 `Phone contact` rows, 14 `Credit repair lead` rows, and 9 distinct one-off tags.
- The list has no Blake, Evertsen, iCloud, Apple, or `Fundhub Funnel` string.
- `src/adapters/clickfunnels.mjs` sets ClickFunnels leads to `source: 'clickfunnels'`; its client handler saves that value as `clients.channel_source`.
- `src/staff/blake-lead.mjs` only detects a referral email and makes an SMS. It does not create a lead record. The watcher labels Gmail as `fundhub-blake-lead`.
- The repository's Gmail OAuth path is live and read-only for this check. It found 36 Blake-related messages, parsed 16 referrals, and matched 15 of them to the list by normalized phone number. Those matches cover L001-L014; one phone number appears twice under Joe/Joseph Evans. The one unmatched referral is not on this lead page.
- No source mapping for iCloud, Blake, or the requested visible `Fundhub Funnel` label exists in `src/`, `scripts/`, `db/`, or `docs/`.
- The served page is intentionally git-excluded: `.git/info/exclude` excludes `public/leads/`. It cannot be committed or made GitHub-visible in its current form.

## Change manifest

The page now derives the shown source without changing the original private lead rows:

- L001-L014 show `Blake Evertsen`, based on Gmail referral-phone matches.
- The 20 rows whose stored tag is `clickfunnels` show `Fundhub Funnel`.
- The verified iPhone export is Drive file `All Contacts.vcf`, uploaded on 2026-10-13. It has 1,190 contacts.
- The scan checked contact name, company, title, and note fields for Credit, Funding, Lead, Repair, Client, Business, Finance, Capital, Lending, Loan, Merchant, LLC, Inc, Corp, and Company.
- It found 293 matching contacts; 40 already match existing private-lead phone numbers and show `iCloud`, while 253 new unique contacts were added with the source `iCloud`.

Local source proof passed: 14 Blake referrals and 20 Fundhub Funnel leads.

## Live proof

- Netlify production deploy `6ace2b5e005be44dc216ba80` reached `ready` at 2026-10-13 06:02 Arizona time.
- A fresh live-page reload showed L001-L014 as `Blake Evertsen` and L065-L084 as `Fundhub Funnel`.
- The file `Funding Leads Fundub LLC Pre Validated.csv` is reserved for Facebook uploads and was not used as a source for this page.
- The iPhone import results in 337 total private leads. Blake retains precedence if a contact matches both Blake and iCloud, so Blake-labelled referrals remain visible as Blake.
