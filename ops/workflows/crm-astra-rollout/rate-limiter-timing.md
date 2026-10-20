# RateLimiter timing — read-only diagnostic

Lane A, 2026-10-20. Separate existing-utility finding, not a CRM presentation repair. Root owns Ship/live UI; B owns remote CI observation; C owns the later Lighthouse run. Only this report and temporary diagnostics were written. No source, test, workflow, environment, Git state, database, deployment or remote rerun was changed.

## Finding

The limiter's stated floor is not rechecked after its timer returns. An early timer return can release a request before the configured interval and becomes the starting point for the next interval. This is a demonstrable gap in the existing implementation, not proof that Astra changed it.

| Check | Expected | Observed / evidence |
| --- | --- | --- |
| Actual main CI, no-DB shard2 | Three waits at120ms require elapsed≥240ms | **239ms**, test duration239.679123ms; **3906 passed /1 failed /2 skipped**. [Job118549593512, run39399262837](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593512). Exact result retained in `ci-triage.md`; not waived. |
| Pre-rollout source comparison | Determine whether the utility/test changed | Both files are **byte-identical** to canonical pre-rollout `f1490ce9d`. Local inspected candidate is `7dcb0aa315b80bc9dadc93426c33a1587f1ba040`. SHA-256 receipts: `/private/tmp/astra-rate-limiter.O3UlwB/source.json`. |
| Pure-clock counterexample using actual class text | A single early wake must not permit early release | Requested sleeps120/120; clock advances119/120; resolutions0/119/239 relative to start. The floor is violated at239ms. Two early119ms wakes give238ms. Exact120/120 gives240ms. **Three controlled scenarios: one meets the floor, two violate it.** `/private/tmp/astra-rate-limiter.O3UlwB/deterministic.json`. |
| Bounded native-clock sample, Mac Node22.23.2 | Record every sample, not a best rerun | **20 samples:20 meet floor /0 violate; elapsed241–243ms;0 individual gaps below120ms.** No natural early timer reproduced locally. All40 timer measurements and20 complete samples retained in `/private/tmp/astra-rate-limiter.O3UlwB/native.json`. |
| Complete unchanged target test file | All existing downloader checks run without external traffic | `node --test scripts/marketing/lib/fetch.test.mjs`: **9/9 passed,0 skipped**,9.482s, one run. All HTTP fixtures bind127.0.0.1; file fixtures are temporary. Full TAP, stderr and exit receipt: `/private/tmp/astra-rate-limiter.O3UlwB/unchanged-fetch-test.*`. |

## Exact logic and limits

Ground truth is the pre-existing **Politeness** section of `scripts/marketing/README.md` (configurable minimum request gap, default1000ms), the class contract at `fetch.mjs:24–28`, and unchanged `fetch.test.mjs:151–156`. No dedicated journey document names this internal downloader utility; this is a narrow timing diagnostic under root's explicit prompt, not certification of an ingest journey.

At `fetch.mjs:40–43`, the queued turn reads `Date.now() - _last` once, calculates what remains, sleeps once, and then assigns `_last = Date.now()` unconditionally. It does not verify that the promised gap has elapsed. The deterministic diagnostic evaluates that exact unchanged class/sleep source in a private VM clock context; it does not substitute a corrected implementation.

The CI log has no per-timer or clock trace. Therefore the **specific cause of that Linux timer returning early is unproved**: scheduler/timer precision and wall-clock behavior are not distinguishable from that log alone. The20 clean local samples do not establish a Linux pass or erase the observed239ms failure. Earlier candidate durations241.518171ms /240.418042ms and current-main real-PG duration241.928117ms are separate case durations reported by B, not evidence that the failed assertion is harmless.

Hashes, both equal to `f1490ce9d`:

- `scripts/marketing/lib/fetch.mjs`: `6c0edecc1f6d1dff08a6d8c9175fcd023831f473542956d2f46c53913129e28e`
- `scripts/marketing/lib/fetch.test.mjs`: `17851c0e3c8dffe6bf237b63d3970574c74a0e15a8564a1c04ef5e132fab9dbc`

## Smallest separately reviewable repair recommendation

Inside the existing serialized turn, recompute the remaining interval after each sleep and continue waiting while it is positive; set `_last` only once the floor is satisfied. Keep the chain, configured interval, first-request behavior, downloader API, retry logic and existing≥240ms assertion unchanged. Add a deterministic regression that wakes one timer1ms early and requires a further wait before release; also cover queued callers. This is a recommendation only: **no fix or test was authored**.

If a follow-on task chooses a monotonic clock to protect real elapsed time against wall-clock adjustments, review that as an explicit clock-contract change rather than silently expanding this minimal repair. Do not lower the threshold, add a tolerance, skip the case or substitute repeated reruns for a fix.

Temporary diagnostic source: `/private/tmp/astra-rate-limiter.O3UlwB/diagnose.mjs`. It ran one three-scenario VM check, one bounded20-sample mostly-sleeping probe, and one unchanged9-test loopback suite. No browser, CPU load generator, external downloader request or production credential was used. Root decides the separate repair/release scope.
