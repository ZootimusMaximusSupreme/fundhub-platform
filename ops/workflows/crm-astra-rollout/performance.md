# Astra live-static speed proof — preparation

Status: **PREPARATION READY; WAITING FOR ROOT'S FINAL LIVE RELEASE CONFIRMATION. No production performance measurement has started.**

This read-only lane uses `fundhub-perf-auditor`, the full `docs/rules/PERF-STANDARDS.md`, and the audit-versus-fix rule. Findings stay findings; no app/config/test/dependency/environment/Git/database/deployment changes are authorized here.

## Scope and priority

The general performance priority is funnel pages first because they cost money per visitor, then CRM screens; rank measured findings by estimated seconds saved, not ease of repair. This assignment is narrower: it contains no ad funnel. Run the portal entry first, then the five named CRM/client screens. Do not expand this into a 59-page or funnel certification.

| Page | Production URL | State to prove inside the measured navigation |
| --- | --- | --- |
| Portal login | `https://fundhub.ai/portal-login.html` | Ordinary signed-out email form; no token exchange or form submission |
| Client portal | `https://fundhub.ai/app/client-portal.html?id=aaaaaaaa-1111-4111-8111-111111111111` | Fictional client, canonical “Credit pull received” stage and next action |
| My Money | `https://fundhub.ai/app/money.html` | Fictional populated overview, balances and next due payment |
| Affiliate | `https://fundhub.ai/app/affiliate.html` | Fictional enrolled client/affiliate, explicit fixture code and 27 referrals |
| Team & access | `https://fundhub.ai/app/staff-teams.html` | Fictional owner and populated 27-person roster |
| Pipeline | `https://fundhub.ai/app/pipeline.html` | Fictional owner and 27 cards across the canonical New Lead/Booked stages |

Each page gets three independent cold browser contexts. Report the median of each metric, not the best run. Source is the existing isolated Lighthouse **13.5.0** installation at `/private/tmp/fundhub-outreach-lighthouse.ApQVDL`; its Bank runner and all Bank files remain untouched.

Viewport: **390×844 CSS pixels**, mobile emulation, DPR 1, 4× CPU. Network: Lighthouse's own `mobileSlow4G` preset in DevTools mode — modeled RTT 150ms/throughput 1638.4Kbps; adjusted DevTools request latency **562.5ms**, download **1474.56Kbps**, upload **675Kbps**. These are not unthrottled desktop/Wi-Fi numbers or physical-iPhone measurements.

## Safe execution contract

Durable runner: `ops/workflows/crm-astra-rollout/live-performance.mjs`. Fixture, source and output paths resolve from this file's repository location, not the caller's working directory. External tools stay outside the app: provide an absolute existing `LIGHTHOUSE_TOOL_ROOT` (or `--lighthouse-tool-root=`) and existing `CHROME_PATH` (or `--chrome-path=`). The runner installs nothing and rejects a Lighthouse version other than the reviewed **13.5.0**.

Validated setup command from the repository root; replace `--selftest` with `--fixture-preflight` for the six local fixture checks:

```sh
node ops/workflows/crm-astra-rollout/live-performance.mjs \
  --lighthouse-tool-root=/private/tmp/fundhub-outreach-lighthouse.ApQVDL \
  '--chrome-path=/Users/chrisstanbridge/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
  --selftest
```

- Fresh temporary Chrome profile and fresh isolated browser context for each run; no real account cookies, saved session, credentials or customer records.
- Lighthouse receives the **same pre-guarded Puppeteer page** as its fourth argument. It must not silently create a different unguarded audit target.
- Every `/api/` and Netlify-function request is intercepted. Explicit GET fixtures return fictional in-memory responses; unmapped reads return a local failure and invalidate the run. All writes are blocked before network.
- Only actual same-origin static files may reach production. No local HTML, JS, CSS, fonts or images are substituted into a live run. Embedded inert images/fonts remain embedded, not network requests.
- External requests and background network constructors are blocked; workers/service-worker registration are disabled in the audit context. Those restrictions are an explicit scope gap, not a claim that these features work.
- Fake auth headers are removed from permitted static requests. Production API calls, messages, analytics writes, downloads with side effects and login actions are not exercised.
- Actual returned static bytes are saved with SHA-256, content type, cache header and local-release comparison. A mismatch, wrong URL, missing Astra class, incomplete fixture, wrong measured viewport, unmapped API, page exception, guard error or Lighthouse runtime error invalidates the run.
- A mutation-observed readiness mark records the intended full fixture **during the audited navigation**. A separate post-audit tab is not accepted as proof of what Lighthouse measured.

The runner requires both explicit `--release-confirmed=<exact 40-character SHA>` from root and the matching successful root receipt at `evidence/live-responsive/asset-bytes.json`. It refuses final execution before that gate. Root's message—not polling—will trigger measurement.

## Evidence and reporting

Final outputs are reserved under `evidence/performance/<release-sha>/<page>/run-{1,2,3}/`:

- Actual `lighthouse.json` and `lighthouse.html`, audited final screenshot, guard log, source-byte files/manifest, and per-run summary.
- Median score, LCP, TBT **proxy**, CLS, Speed Index, navigation TTFB, total/JS bytes and first-party static transfer bytes.
- LCP node from the actual Lighthouse 13.5 nested insight structure; if absent, explicitly **unmeasured**.
- Top five render-blocking resources with Lighthouse durations/savings; request durations and long main-thread tasks kept separate.
- Head blocking-script/stylesheet counts, inline-style count, and third-party script sizes when actually measured.
- `medians.json` records explicit PASS/FAIL/UNMEASURED per budget; `findings.json` retains all misses, measured causes/resources and evidence. A score is not an INP pass.

Budgets from PERF-STANDARDS:

| Surface | LCP | Field INP | CLS | TTFB | JS | Total page |
| --- | --- | --- | --- | --- | --- | --- |
| Portal entry | <1500ms | <200ms, **not measured here** | <0.1 | <400ms | <200KB | <1MB |
| Five CRM/client pages | <2500ms | <200ms, **not measured here** | <0.1 | <600ms | <500KB | <2MB |

TBT is only a laboratory diagnostic; it cannot satisfy the INP budget. Navigation TTFB measures the production static document, not authenticated API/DB latency. Total-page figures include the explicitly fictional response payloads; first-party static bytes are listed separately. No backend, live authenticated journey, field INP, whole-CRM, future-fold or physical-device claim is allowed.

## Preparation receipts and gaps

The same-page Lighthouse guard canary passed on a harmless local page: its API response was intercepted, POST and external requests were refused, and no API/write reached the local server. Evidence: `evidence/performance/preflight-only/safety-receipt.json` plus full local-only Lighthouse reports. These numbers are **not live speed evidence**.

Final local preparation: **6/6 intended screens rendered at 390×844**, with 27 affiliate rows, 27 staff rows and 27 Pipeline cards; zero unmapped APIs, page/guard errors or network escapes. Receipt: `evidence/performance/local-fixture-preflight/checks.json`. The Lighthouse canary independently recorded 390×844 inside the audited navigation, extracted an actual LCP node, and saved complete JSON/HTML reports. `node --check` passed. Calling final mode without a release SHA was also tested: it stopped before launching Chrome with `STOP: requires root-confirmed exact live release SHA`.

Initial tooling receipts are retained: `preflight-first-favicon-check/` caught a permitted automatic favicon GET in an overly strict canary assertion; the canary now uses an inert embedded icon. `local-fixture-preflight/first-navigation-idle-checks.json` records initial readiness waits that timed out on polling pages and unmapped background fixtures. Preparation now uses the intended DOM/fixture condition instead of waiting for perpetual network idleness. These are tooling setup findings, not app performance findings.

`local-fixture-preflight/first-source-capture-lifecycle-checks.json` retains early closure of a late favicon response; local setup now settles source capture before closing. `preflight-network-idle-check/` retains the failed post-Lighthouse idle check: Lighthouse's CDP source-code re-request leaves Puppeteer's counter open. Audit mode now checks actual Lighthouse network records instead: every successful HTTP request must be an explicit fixture or permitted static request, and every audited static URL must have captured source bytes. The final canary passed this stronger source-coverage check. Actual exceptions and guard/source errors still invalidate the run.

The local fixture setup exposed a legacy Google Fonts request on app pages. It remains blocked by the external-request guard and must be listed as a limitation in live reports if it persists. A guarded first-party score cannot be presented as unrestricted full-production performance. Final live rendering and source-byte checks remain pending.

## Durable retention — 2026-10-20 09:10 UTC

**READY, setup only.** The durable file passed syntax, the same-tab Lighthouse canary and **6/6 local fixture checks** at 390×844. The canary saved real JSON/HTML, an actual LCP node and zero page/guard errors. Local fixtures retained counts **1/1/1/27/27/27**, with zero unmapped reads, errors, source mismatches or network escapes. Missing-release execution still stopped before Chrome launch. Receipt: `evidence/performance/durable-retention.json`.

Only bootstrap wiring changed from the working temporary runner: repository-relative paths, explicitly configured existing tools/browser, and an exact tool-version check. Its remaining **341 lines are byte-identical**, SHA-256 `49afba47bddbb0eb80dadc8d6dfdcb1ff34341958e4f6b93ebde86dd1a1ef4cd`; all interception, source/error assertions, cold-run count, medians, budgets and scope limits are retained. The canary's meaningful safety result matches the temporary runner. Prior successful setup receipts are copied intact to `temporary-runner-preflight/` and `temporary-runner-fixture/`; all earlier red receipts remain.

No live run was started, no Bank file or app/test/workflow/dependency/environment/Git/DB/deployment file was edited, and no release polling was added. Root's exact final live SHA and matching successful live-byte receipt are still required.
