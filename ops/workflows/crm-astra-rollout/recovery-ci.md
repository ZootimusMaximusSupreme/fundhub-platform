# Required PR84 CI observation — 2026-10-20

Final observation at 12:02:30 UTC: **required run completed successfully; all 14 jobs succeeded.** The original source head is unchanged. No job was rerun or waived by this lane.

Required run: [39417394553](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39417394553), `tests`, run number 1297. [PR84](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/84) reports exact head `cec0e64da6a8061855c6c1c087f2bea26fa9a57a`, base `2111e0424e7b3b403fdad3830b0c608aee7454f1`, open/unmerged. The commit-filtered PR workflow lookup returns this retained run.

Root requested cancellation only of duplicate push run `39417225291`. That run is excluded from pass counts; a cancelled duplicate is not a successful check.

## Observed job inventory

All 14 expected jobs are present in the retained run:

| Job | Job ID | Actual result; pass / fail / skip |
|---|---|---|
| screens (real browser) | 118609631663 | Success; Playwright reports 1,693 passed / zero unexpected failures / three skipped; expected-failure limitation below |
| suite (real Postgres — unit shard 0/6) | 118609632107 | Success; 5,811 / 0 / 0 |
| suite (real Postgres — unit shard 1/6) | 118609632159 | Success; 4,633 / 0 / 0 |
| suite (real Postgres — unit shard 2/6) | 118609632092 | Success; 3,970 / 0 / 2 |
| suite (real Postgres — unit shard 3/6) | 118609632256 | Success; 5,372 / 0 / 0 |
| suite (real Postgres — unit shard 4/6) | 118609631853 | Success; 3,919 / 0 / 0 |
| suite (real Postgres — unit shard 5/6) | 118609631893 | Success; 4,781 / 0 / 0 |
| suite (real Postgres — blocks) | 118609631964 | Success; serial PG 4,054 / 0 / 4, plus separate proofs below |
| suite (no database — unit shard 0/6) | 118609632021 | Success; 5,631 / 0 / 2, plus named guards 73 / 0 / 0 |
| suite (no database — unit shard 1/6) | 118609631991 | Success; 4,599 / 0 / 0 |
| suite (no database — unit shard 2/6) | 118609632254 | Success; 3,907 / 0 / 2 |
| suite (no database — unit shard 3/6) | 118609632006 | Success; 5,346 / 0 / 0 |
| suite (no database — unit shard 4/6) | 118609632061 | Success; 3,832 / 0 / 2 |
| suite (no database — unit shard 5/6) | 118609632542 | Success; 4,741 / 0 / 17 |

All 14 completed job logs were read. Each confirms checkout `4a6d62cc561b9d02921586f825f4d829f095d73f`, GitHub's test merge of exact head `cec0e64da6a8061855c6c1c087f2bea26fa9a57a` into base `2111e0424e7b3b403fdad3830b0c608aee7454f1`. This is the expected pull-request merge context, not a production merge. Final commit-filtered workflow metadata confirms run 39417394553 `completed/success`; PR84 remains open/unmerged with the same exact head at this observation.

The six no-database TAP summaries total 28,056 passed / zero failed / 23 skipped (28,079 collected); their additional named-guard step is 73/73. Lint reports 4,006 parsed files/inline scripts. The six real-Postgres unit summaries total 28,486 passed / zero failed / two skipped (28,488 collected). These are separate executions, not distinct-case counts to combine into one coverage claim. All seven Postgres jobs completed migration/application-role setup and manifest checks.

## Completed database-block proof

[PG blocks job 118609631964](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39417394553/job/118609631964) succeeded:

- Call/Present context chain: 3 passed, zero failed/skipped.
- Serial database suite: 4,054 passed, zero failed, four skipped; 4,058 collected, 448.432 seconds.
- Runtime-role guard: 3 passed, zero failed/skipped. The log confirms a real `fundhub_app` connection without superuser, bypass-RLS, role/database creation, replication or public-schema creation.
- Partner isolation: 102 passed, zero failed/skipped. Log confirms owner fixtures with `fundhub_app` assertions.
- Migration application and migration-manifest checks succeeded.

The four serial-PG skips remain unproved: two Meta-copy fixtures are not built by that database test; the scratch database has no `anon` / `authenticated` roles; the data-layer journey harness refuses the owner/superuser connection by design. The last skip does not become a full journey pass merely because separate isolation checks succeeded.

Real-PG unit shard 2 explicitly skips the owner-connection privilege assertion (`ALLOW_SUPERUSER_DB=1`) and a PDF-printer test because WeasyPrint is unavailable. The independent runtime-role step above is the actual privilege proof.

No-database unit logs also contain database-dependent suite skip markers, including in shards whose TAP leaf summary reports zero skipped tests. Those markers are retained as a scope limitation; no-database pass counts are not database proof.

## Completed browser proof and retained limitations

[Browser job 118609631663](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39417394553/job/118609631663) reports 1,696 collected cases using two workers, **1,693 passed and three skipped in 12.3 minutes**, with its final summary at 12:00:20 UTC. Chromium and WebKit installation succeeded. No unexpected failure or retry was reported; the failure-only artifact upload was skipped because the job succeeded.

The three skips are `e2e/mac-rounded-reference.spec.mjs` at 1440px, 390px and 320px. Its unchanged platform guard excludes non-macOS runners. This Ubuntu run therefore does not prove actual macOS font selection or native-device behavior.

One existing expected-failure case visibly ran as `✘`: `e2e/fin-b15-cc-controls.spec.mjs:433`, “FINDING: a failed Rules read waits for Try again and is not started again on every repaint.” The unchanged source declares `test.fail()` and documents the repeated-read finding. Playwright includes expected failures in its successful-outcome summary; the reported 1,693 is not a claim that this known defect was fixed. The job log does not emit its exact failed assertion payload. This lane added no expected-failure marker and made no source/test change.

No-database skip markers remain across all six shards (10 / 4 / 9 / 3 / 6 / 20 respectively), covering absent-database SQL/row-lock/provider-routing checks and unavailable WeasyPrint. Suite skip markers and TAP leaf skip totals are different counts; neither is promoted to passing proof.

## Observation boundary

This lane only reads remote PR/run/job logs and writes this report. It does not rerun, cancel, waive, alter source/tests/workflows/rules, perform Git mutations, run local browsers/heavy checks, or change customer/database/provider state. Root owns release coordination. The Bank lane owns its separate Pipeline/teleprompter diagnosis; any fresh failure here is reported exactly without duplicating that repair.
