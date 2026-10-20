# Heartbeat finish — Lane E staff/plumbing report

Branch: `codex/heartbeat-plumbing-e`

## Result

- Original assigned rows: **20 broken before, 20 broken after**.
- No production row was changed, no message was sent, and no external setting was guessed.
- One local proof gap was repaired: `gap-door-batch-keys:door-batch:keys-live-proof` now reads all 114 compiled sensitive key names and reports missing, masked, or malformed names without returning values. It remains red in this Mac's verification environment because 82 names need attention.
- Four PostgreSQL gate failures were repaired at the CI fixture boundary. Fixture setup/cleanup now uses `MIGRATION_DATABASE_URL`; RLS assertions still use `APP_DATABASE_URL` through `src/testing/rls-pool.mjs`. The app role received no ownership or extra grant.

## Exact unresolved blockers

### Outside configuration or human review

- `live-playwright:desks`: the last saved sweep passed 41/41 but is about 254 hours old. No nightly Mac launchd/cron is installed.
- `meta-sync`: the saved Meta token cannot be decrypted (`Invalid initialization vector` / malformed auth tag). It needs the existing connection/token repaired; changing encryption keys or data was out of scope.
- `clickfunnels-night-job`: there is no active ClickFunnels connection.
- `gap-door-batch-jobs:door-batch:ad-video-worker-result` and `gap-door-batch-webhooks:door-batch:webhook-ad-video-worker`: four upload spend claims are stuck; the oldest is 2026-09-24. Existing code deliberately requires human review before clearing or retrying them.
- `gap-records:bureau-config:complete`: EX, EQ, and TU each lack both a real service number and menu path.
- `wf:af-02-referral-ownership-capture`, `wf:at-01-first-touch-capture`, and `wf:s-02-incomplete-survey-nudge`: one `entry.captured` event from 2026-10-16 has no matching start receipt for each function. Current registration, middleware, and focused tests pass; Inngest run history must decide whether the event was lost or only the receipt was lost. The event was not replayed.

### Existing live rows that require an authorized data decision

- Creative summary/run: one failed fixture-shaped generation job from 2026-10-12 has no finish time and attempt 0. Current failure code stamps both.
- Script write/save: four fixture-shaped scripts from 2026-10-12 have missing dictionary links involving `adspine_alpha`, `adspine_beta`, `adspine_nonumber`, `adspine_h1`, `adspine_offer`, `denial_angle`, `they_said_no`, and `funding`.
- Brand approve: one 2026-08-01 approved brand was never submitted for review.
- Social queue: one 2026-08-26 queue row has no send time.
- Social approve: one 2026-10-12 post has no valid approver, scheduled mirror, or send time.
- Staff reset: two old reset rows used a seven-day lifetime; one one-hour row was used after expiry. Current reset code uses one hour.

### Owned by the catalog/proof integration lanes

- `catalog:proof-linked`: 3,919 of 3,942 items are wired; 23 remain red.
- `audit:na-verified`: the fresh full rerun found one stale N/A (`05-funnels:clarity-insights-sweeper`). This changed from the earlier two consulting rows and was left for the owning proof/integration lane.

## Key names from the local verification environment

No values were printed or saved.

- Missing (71): `APPLY_PAGE_URL`, `AUTOPSY_REPORT_SECRET`, `BANKING_PROVIDER`, `BLAND_VOICE`, `BLAND_VOICE_FEMALE`, `BLAND_VOICE_MALE`, `BLAND_WEBHOOK_URL`, `BLOB_READ_WRITE_TOKEN`, `BOOKING_URL`, `CLICKFUNNELS_WORKSPACE_ID`, `CLIENT_PORTAL_URL`, `COMMAS_API_BASE`, `COMMAS_CHECKOUT_BASE_URL`, `COMMAS_CHECKOUT_SECRET`, `COMMAS_ENV`, `COMMAS_PAYMENT_SECRET`, `COMMAS_SIGNATURE_HEADER`, `COMMAS_SUCCESS_URL`, `CONSUMER_DIRECT_AFFILIATE_URL`, `CONSUMER_DIRECT_CANCEL_URL`, `CONSUMER_DIRECT_CLIENT_KEY`, `CONSUMER_DIRECT_ENV`, `CONSUMER_DIRECT_PID`, `CONTEXT_FETCHER_SECRET`, `CONTRACT_URL_SECRET`, `FANBASIS_CHECKOUT_API_BASE`, `FANBASIS_CHECKOUT_BASE_URL`, `FANBASIS_ENVIRONMENT`, `FILE_ALERT_PAY_BEFORE_CLOSE_DAYS`, `FINANCE_OS_PRICE_PER_CONTAINER_CENTS`, `FINANCE_OS_SYSTEM_PULL_LIVE`, `FINANCE_OS_TRANSFERS_LIVE`, `FUNDING_ACTIVE_SMS_TEMPLATE`, `GHL_API_KEY`, `GHL_PIT`, `GHL_PRIVATE_API_KEY`, `GHL_RELAY_API_KEY`, `INSIGHT_MEET_BOOKING_URL`, `LENDFLOW_API_BASE`, `LENDFLOW_API_KEY`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_INBOUND_DOMAIN`, `MAILGUN_INBOUND_SECRET`, `MAILGUN_SEND_BASE_URL`, `META_ACCESS_TOKEN`, `META_API_VERSION`, `META_INSTAGRAM_USER_ID`, `META_PAGE_ID`, `PLAID_TOKEN_ENC_KEY_V2`, `PORTAL_BASE_URL`, `POSTGRID_API_BASE`, `PUBLIC_BASE_URL`, `PUBLIC_SITE_URL`, `RESEND_BASE_URL`, `SALES_MEET_BOOKING_URL`, `SESSION_SECRET`, `SETTER_VOICE`, `SLO_DEMO_PAY`, `SLO_POST_PURCHASE_ENABLED`, `SMART_CREDIT_AFFILIATE_URL`, `SMART_CREDIT_CLIENT_KEY`, `SMART_CREDIT_ENV`, `SMART_CREDIT_PID`, `STITCH_CREDIT_API_BASE`, `STITCH_CREDIT_EMAIL`, `STITCH_CREDIT_PASSWORD`, `STITCH_CREDIT_USERNAME`, `SUBSCRIPTION_BILLING_ENABLED`, `TWILIO_SEND_BASE_URL`, `UNDERWRITE_IQ_VISION_KEY`.
- Masked (11): `BLAND_API_KEY`, `COMMAS_API_KEY`, `CRS_LIVE_API_HOST`, `CRS_LIVE_API_PASSWORD`, `CRS_LIVE_API_USERNAME`, `FUNDHUB_REP_NUMBER`, `MAILGUN_SEND_FROM`, `META_APP_SECRET`, `MIGRATION_DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`.

## Verification

- Fresh full heartbeat rerun: rollback-only database transaction, no sends, all 20 original checks re-read. The full returned list folded out the three workflow rows, so those three were also rerun directly through `checkWorkflowRuns`.
- Targeted tests: 93 passed, 0 failed.
- Final key/CI guard tests: 4 passed, 0 failed.
- Catalog check: 3,975 mapped, 3,942 unique, 3,919 wired, 23 red; generated file current.
- Lint: 3,964 files and inline scripts parse clean.
- PostgreSQL execution was not available locally (`docker` and `pg_isready` are absent). The new source guard proves the intended owner/app split; the four real PG suites must execute in the repository's scratch-Postgres CI gate.
