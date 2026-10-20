# Live Playwright requirements — teleprompter repair

Scope: the owner-requested teleprompter camera badge, script-history notice, and local video playback/export. This is not a score for other Fundhub journeys or physical camera quality.

Target: `https://fundhub.ai/app/teleprompter.html`. Required checks use the shipped HTML/CSS/JS with synthetic camera input and mocked API responses; no real script edits or Drive uploads are sent.

| ID | Required check | State |
| --- | --- | --- |
| TP01 | Ad badge shows the granted 30 fps honestly | PASS |
| TP02 | Badge follows actual settings across a lens switch | PASS |
| TP03 | Script picker keeps labels and hook separate | PASS |
| TP04 | VSL badge shows a granted 30 fps honestly | PASS |
| TP05 | VSL badge shows a granted 60 fps honestly | PASS |
| TP06 | Unknown camera rate is shown as unavailable | PASS |
| TP07 | Original video can be watched/exported before and after device-first save | PASS |
| TP08 | No leaves no new Watch file or upload | PASS |
| TP09 | Watch stays hidden during recording, including paused words | PASS |
| TP10 | Reopening recovers Watch for a queued device file | PASS |
| TP11 | Quick acceptance/reload preserves the file without a preview error | PASS |
| TP12 | Offline script edit survives reload and sends once | PASS |
| TP13 | Script conflict opens through History without interrupting filming | PASS |
| TP14 | Choosing saved words preserves the exact phone draft in History | PASS |
| TP15 | History shows who changed words, when, and repository status | PASS |

October 13 initial run: **15/15 = 100/100** in WebKit, 40.1 s, no skips or retries. A supplemental Ad granted-60 badge check also passed. Live files matched the GPU/phone-save candidate byte for byte. Earlier evidence is retained in `docs/workflows/teleprompter-video-2026-10-12-evidence/fundhub-live-final-ui-results.json`, `fundhub-live-ad60-results.json`, `fundhub-live-ui-assets-2026-10-13.json`.

Final published `555307ba` proof: **15/15 = 100/100**, 38.0 s, no skips or retries. Ad60 and strengthened rear4K source/badge/GPU/one-file supplements passed **1/1 each**. Exact referenced live HTML/JS/CSS/edits assets match the source. Tagged `fundhub-live-*-555307ba.json` and marked screenshots are in the same evidence folder. Reproduce core UI with `FHTP_WEBKIT_FILES=1 FHTP_LIVE_TAG=555307ba npx playwright test --config=playwright.teleprompter-live.config.mjs`; set `FHTP_LIVE_CASE=ad60` or `rear4k` for the separate required supplements.

This score proves these shipped UI cases with synthetic camera/API input. Actual iPhone preview, microphone, original Drive frame rate, and 60 fps acceptance remain separate **OPEN** checks. The owner was asked for one fresh filming pass after all live checks passed.

## Dashboard polish — separate release scope, 2026-10-19

Target: `https://fundhub.ai`. These seven required cases use shipped assets with intercepted synthetic API responses; no production customer action, send, account connection or payment is allowed. This does not replace the teleprompter score or prove all 61 CRM journeys.

| ID | Required check | State |
| --- | --- | --- |
| DP01 | Fundhub sidebar uses the six official pastel stops | Pending deployment |
| DP02 | F menu beside Calendar opens, closes, restores focus and navigates | Pending deployment |
| DP03 | Other companies retain their custom spectrum and logo | Pending deployment |
| DP04 | Compact sidebar works and 320px phone control fits | Pending deployment |
| DP05 | Failed Kanban read gives recovery help and unknown counts | Pending deployment |
| DP06 | Short Social help fits desktop and phone | Pending deployment |
| DP07 | All seven changed live assets match release bytes | Pending deployment |

Command: `node node_modules/@playwright/test/cli.js test --config=playwright.dashboard-polish-live.config.mjs`. JSON and marked screenshots are saved under `ops/workflows/dashboard-ux-polish/evidence/live-results.json`; screenshots use fictional fixture data. The agent's signed-in live click path follows a 7/7 score.

## Astra CRM rollout — separate UI release scope, 2026-10-20

Target: `https://fundhub.ai`. These36 required checks use actual shipped HTML/JS/CSS and fictional intercepted API data in new no-cookie browser contexts. No local app-asset substitution, customer action, send, account connection or payment is allowed. This is a shipped-UI geometry score, not a59-page end-to-end business-journey score, native-wrapper proof or physical-iPhone test. The pre-existing seven dashboard-polish checks above remain separately required.

| IDs | Required check | State |
| --- | --- | --- |
| AS01 | Every changed public release asset matches this release byte-for-byte against the fixed pre-rollout main baselinef1490ce9d | Not run; awaiting release |
| AS02–AS08 | Team & Access: readable visible text/inputs,44px targets and no page overflow across the seven profiles below | Not run; awaiting release |
| AS09–AS15 | Client portal: same seven-profile geometry requirements | Not run; awaiting release |
| AS16–AS22 | My Money: same seven-profile geometry requirements | Not run; awaiting release |
| AS23–AS29 | Affiliate: same seven-profile geometry requirements | Not run; awaiting release |
| AS30–AS36 | Pipeline: same seven-profile geometry requirements | Not run; awaiting release |

Profiles, in ID order within each group:390px Chromium, Pro Max WebKit440 portrait, Pro Max WebKit landscape,768px Chromium,1024px Chromium,1280px Mac WebKit and1440px Chromium. These are browser profiles, not actual device runs. Expanded-state and authored/independent local checks are recorded on `crm-astra-rollout-2026-10-20.md`, not silently counted here.

Command: `node ops/workflows/crm-astra-rollout/responsive-review.mjs --live-deployed` (without `--pages`, which would only be a partial run). It refuses empty/mismatching release assets before claiming live UI success. Byte receipts, exact per-case results, denied/unexpected-write records and marked screenshots go to `ops/workflows/crm-astra-rollout/evidence/live-responsive/`. All required cases must pass in one complete release run for36/36 =100/100. Final signed-in read-only live navigation follows the scoped live UI checks; it does not prove money/customer event order.
