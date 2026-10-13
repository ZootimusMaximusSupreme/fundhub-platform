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
