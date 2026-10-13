# Heartbeat and tripwire repair — 2026-10-13

Owner request: make the existing heartbeat show the truth for broken code, pages, CRM steps, customer paths, and money paths. Do not touch LNR. Do not deploy, send messages, change secrets, or write customer data.

| Lane | Owner | Scope | State |
| --- | --- | --- | --- |
| Display monitor | root | `gap-catalog-display` deployed-safe catalog data and retired-page live check | PROVED — REVIEW BRANCH |
| Catalog proof | catalog_proof | 23 catalog items without proof; honest checks or red evidence | REVIEWED — 23 RED |
| Older-path migration | catalog_proof + root | older route inventory and 111 missing hourly checks | IN CURRENT CATALOG — 111 RED |
| Product truths | product_truths | ClickFunnels call join-link source and unapproved pipeline age limits | LIVE READ COMPLETE — SOURCE/DECISIONS MISSING |
| Integration and proof | root | focused tests, lint, scheduled pulse proof, safe live reads | COMPLETE — BUSINESS REDS PRESERVED |

## Guardrails

- Preserve all unrelated uncommitted work. LNR is out of scope.
- Read-only live checks only. No deploy, sends, secret changes, or customer-data writes.
- A missing source or decision remains red. Never fake a green result.

## Results

### Fixed in the review branch (not deployed)

- `gap-catalog-display.mjs` imports only compiled data from `src/pulse/catalog/generated.json`. Its old direct and transitive work-folder reads are gone.
- Build output holds 45 exact saved-result cases and 1,123 tracking cases. The original 1,121 checks remain; the documents Remind and Void controls now also appear and stay red because their exact action receipts do not exist.
- The retired Decline Autopsy page is judged by real GETs: it must redirect to the same site's offer menu, and the menu must open with its actual heading and partnership link. A wrong redirect/dead menu fails; an unread page is unchecked. The N/A verifier rechecks the same live truth.
- Live read on October 13: `/partner/autopsy/` returns the expected redirect to `/partner/menu/`; that menu opens. This verifies the existing live redirect, not deployment of this repair.
- All 75 older money/customer route names already have current catalog entries. The exact 111 backlog is `src/pulse/beats/legacy-unbeaten-tripwires.json`; all 111 still lack hourly proof. The compiler now derives the current missing list from real tripwires and beat coverage. The existing morning lane reports `catalog:hourly-proof-linked` red until real hourly checks cover them. No unrelated beat was relabeled.
- Catalog counts remain 3,975 mapped / 33 repeats / 3,942 unique / 3,919 linked / 23 red. “Linked” does not mean the business result passed. Exact 23 missing-proof reasons and all 111 hourly surfaces are in `ops/workflows/heartbeat-tripwire-reds-2026-10-13.md`.

### Still red: booked calls have no sales meeting source

Production read-only proof found 26 saved ClickFunnels bookings with zero meeting links. The newest five real bookings have none. All 58 saved original appointment posts parsed and contained no meeting/join/conference/location/URL field. The current provider read returned 20 records; its newest five also contained none. Existing event, booking and task sources are already judged by `calls:booked-no-join-link`. Hiring staff rooms are not sales-call rooms.

Missing: a real sales-call meeting URL attached to each appointment and exposed to the booking adapter. The existing check stays red. Both production read boxes rolled back, remained read-only, and sent zero commits. No customer rows were changed.

### Owner decisions: stage clocks

No stage age limits were invented. These 34 live, nonfinished keys lack an approved board clock:

| Board | Stage keys |
| --- | --- |
| Sales | `new_lead`, `survey_complete`, `booked`, `confirmed`, `showed`, `diagnostic_paid`, `decision_rendered` |
| Funding / card stacking | `apply_now`, `round_submitted`, `approved`, `action_required` |
| Alt-Fin (parked) | `app_created`, `docs_stips`, `underwriting`, `offers`, `offer_accepted` |
| Inquiry removal | `requested`, `specialist_assigned`, `awaiting_documents`, `letters_sent`, `calls_in_progress` |
| AR | `invoice_sent`, `reminder`, `escalation` |
| Partners / white label | `recruiting`, `invited`, `agreement_signed` |
| Hiring | `applied`, `screening`, `group_interview`, `one_on_one`, `offer`, `onboarding`, `ramp` |

Repair uses eight existing written clocks. `round_complete`, `on_hold`, and `stalled` need a clock or an explicit leave-off choice. Retired Repair keys `round_sent`, `bureau_processing`, `portal_updated`, and `upgrade_invite` still exist but are watched by dead-stage proof.

### Checks and limits

- Focused catalog/display/morning-audit/workflow/beat guard tests: 190 passed, zero failed, zero skipped. Product-truth focused tests: 74 passed, zero failed, zero skipped. Unit fixtures are not production evidence.
- Catalog freshness passed; no count or proof claim was weakened.
- Hourly built proof passed its runner checks: all ten scheduled beats loaded from real bundles, zero deadlines, zero SQL errors, zero commits, read-only rollback confirmed, nothing sent outside fake sinks. Business outcomes: four red (`apply-links`, `brief-link`, `email-path`, `text-path`). Some vendor/paid-door steps lacked local secrets and were skipped; these are not production passes.
- The hourly reds are a broken bank Apply address, an overdue brief, missing email templates, and missing text templates. They are separate leftovers, not repaired in this scope.
- Final clean-branch lint passed: 3,418 files and inline scripts parse. The 190 focused tests were rerun after the last code change: all passed, none skipped.
- Final clean-branch `pulse:prove` passed its execution guards (exit zero): 75 steps; all 72 gap lanes answered; all 2,906 expected checks appeared. Slowest step was 15.3 seconds. No SQL errors, refused writes, or sends. The final morning fold took 16.1 seconds and reported 2,629 rows: 712 green, 1,677 red, 205 verified nothing-to-judge, 35 unchecked. These totals are not an all-green company claim.
- Of the 35 unchecked rows, seven are local-runner limits, 21 lack workflow run receipts, and seven are other unresolved reads/conditions. The latter are Meta test/company-only events, checkout no-sale verification, two lead conditions, sender verification, pipeline dead-stage verification, and social stats verification. The heartbeat audit keeps them red.
- Independent review found a wrong-page false pass in the retired menu check. It was repaired and rechecked: a sign-in page or a page missing the partnership link stays red even when it answers; the real live menu passed. No further actionable review findings.
- TypeScript fails at `src/marketing/filmed-receive.mjs:159` with TS2345 (Promise resolve callback type). That file is outside this repair and was not changed by this session.
- No UI file changed in this repair; no browser click or real-device acceptance is claimed. No deploy, send, secret change, or customer-data write occurred. No LNR file was touched.

### Release

Draft PR: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/37

Review branch: `codex/heartbeat-tripwire-review-2026-10-13`, based directly on `origin/main`. The managed review checkout is `/Users/chrisstanbridge/.codex/worktrees/heartbeat-tripwire-review/fundhub-platform`. Only this repair was cherry-picked there, so the unrelated local commit and uncommitted work are absent from the PR. Main was not pushed. GitHub's broader test jobs were still running at the last check; skipped database tests are not evidence.

After Chris approves a release, the GitHub merge can use the existing main ship workflow; verify that workflow and the live display/catalog rows before calling this deployed. The existing type error remains a separate failed gate. This task did not deploy or run the ship command.

