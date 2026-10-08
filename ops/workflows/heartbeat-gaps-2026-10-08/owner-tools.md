# Owner tools

Lane only. Read only. One tripwire: Recon (AG-07) on the morning pulse. No second watchdog.

Did not change brand assets. Did not start a teleprompter session. Did not edit a page.

These tools are not on the other gap lanes. Galaxy here is the staff Galaxy, not Partner Galaxy. Slice 30 only checks that Ops Admin is on the morning list. Slice 31 only checks that Creative Factory is on that list.

The registry already pings all seven desk pages and all seven read doors for a plain up or down. This lane does not repeat that. Each row reads the data behind its tool.

## Seven checks

Each row is `{ id, status, detail, suggestedFix }`.

Status is PASS, FAIL, or skip.

| id | Tool | What it reads, the way the tool reads it | FAIL when |
|---|---|---|---|
| owner-tools:galaxy | Galaxy | `companyActivity` (the code behind `/api/read/company-activity`) under the staff scope | It throws, or nobody is on the board |
| owner-tools:ops-admin | Ops Admin | `computePulse` for today (the code behind `/api/read/ops-pulse`) under the staff scope | It throws, or comes back with no numbers |
| owner-tools:teleprompter | Teleprompter | GET `/api/marketing/shoot` (open to a GET on purpose), body read | Not a 200 shoot, or a script in the open shoot has no teleprompter text |
| owner-tools:brand-studio | Brand Studio | `v_org_brand_effective` for the company (what `/api/org-brand` reads) | No brand row, or no usable ink and paper |
| owner-tools:content-admin | Content | The tiles, videos, tier map and products selects the Content screen loads | A read fails, or the company has no tiles |
| owner-tools:creative-factory | Creative Factory | `fetchRows` from `api/creative/jobs.mjs`, one row, under the staff scope | It throws or does not return a list |
| owner-tools:journeys | Journeys editor | The journeys select the editor loads | It fails, or a saved journey has steps that are not a list |

A missing database skips the database rows. A missing fetch skips the teleprompter row. No check uses POST or PUT. Brand Studio is not saved. The teleprompter is not started. The journeys editor is not run.

The sign-in is in front of every read except the teleprompter, so this lane cannot run the web door itself. It runs the same code the door runs, in process, with the pulse's staff scope. It cannot prove the sign-in works. The registry shows a 401 for that.

## Files

- `src/pulse/coverage/gap-owner-tools.mjs`
- `src/pulse/coverage/gap-owner-tools.test.mjs`

## Test

`node --test src/pulse/coverage/gap-owner-tools.test.mjs`

12 tests. 12 pass. 0 fail.

## Review — Claude, 2026-10-08

What was wrong:

- Every row was a copy of the registry. The old rows opened the same 7 desks and the same 7 read doors, and called a 2xx, 400, 401, 403 or 405 "up". The registry does exactly that, so a 404 would have shown twice.
- A 401 only says the sign-in is in front of the tool. It does not say the tool can read its data. Six of the seven reads answer 401 with no login. So six rows could pass while the tool was broken.
- The old test returned the same fake answer for every address.

What changed:

- Each row now reads the data behind its tool, the same way the tool does. A dropped column, a lost grant, or an empty brand row now shows as FAIL. A 401 could never show that.
- The teleprompter row reads the body and checks that every script in the open shoot has text to roll.
- The reads run under the staff scope. They have to. The plain role sees 0 generation jobs. The staff role sees 3. A plain read would have been a blind PASS.
- Code for each tool loads when its row runs. One that will not load fails its own row only.

Live result after (production, read only): prod 7 PASS, 0 FAIL, 0 skip. Staff-access run: same. No write was tried. The seven rows take about 7 to 11 seconds from the Mac, where every query crosses the internet at about 100 to 200 ms. 38 queries run in all. Ops Admin runs about 24 of them and is the slowest row. The pulse gives each lane its own step with a 26 second limit, so this fits.

Broke one thing per run on the live data to prove each row can FAIL: brand row gone gave FAIL. Tiles gone gave FAIL. Shoot answers 500 gave FAIL. Scripts with no teleprompter text gave FAIL. Staff table refused gave FAIL for Galaxy. A renamed jobs column gave FAIL for Creative Factory.

Tests: 12 pass, 0 fail. The old file had 8 tests.
