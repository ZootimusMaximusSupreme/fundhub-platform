# Social Studio dynamic empty copy — named repair

2026-10-20. Local repair and proof only; root owns review, commit, release and fresh live proof.

## Exact repair

The original live DP06 check was red: static `#vWhat` contained the approved short sentence, but `renderVerdict()` replaced it during initialization with the older long sentence.

Changed only `public/app/social-studio.html:1341`:

```diff
- Write a post and choose what it is about to preview the check.
+ Write a post to preview its copy check.
```

A byte-for-byte comparison with checkout HEAD confirms the entire file equals its previous content with that one string replaced exactly once. The approved sentence now occurs twice: initial HTML and dynamic empty branch. Every other byte, including validators, topic selection, approval defaults, send gates, handlers, IDs, requests and connections, is unchanged. No journey step changed.

Read the fixer skill, minimal-diff owner rule, original approved copy inventory, relevant Social Studio section of `docs/journeys/white-label-intended.md`, and the actual composer/reset/read code. The intended file records existing behavior rather than owner-authored full screen acceptance; this repair does not amend it.

## Proof

| Check | Result |
| --- | --- |
| `node --test src/http/social-studio-screen.test.mjs` | 8 passed, 0 failed, 0 skipped |
| Unchanged `src/pulse/catalog/proofs/display-contracts-teams-social-1.test.mjs` | 1 passed, 0 failed, 0 skipped; 4.1 seconds; real local Chromium with controlled APIs |
| New `e2e/astra-social-empty-copy.spec.mjs` plus unchanged Social cases in `e2e/integration-round.spec.mjs` | Final 6/6 passed in 9.2 seconds; four new cases plus two existing cases |
| `npm run lint` | 4,006 files/inline scripts parse clean |
| `npx tsc --noEmit` | Exit 0 |
| New spec syntax and scoped `git diff --check` | Passed |

The new regression runs at **1440 × 900 and 390 × 900**, each with no partner (the exact original DP06 fixture state) and with one fictional partner/account. It retains DP06's exact three copy assertions and no-page-overflow assertion. It waits for page initialization and relevant fixture reads, checks the initial empty state, explicitly clicks **Check the wording**, types a caption, verifies the missing-topic refusal, chooses Funding, enters a future send time, and clicks **Clear the form**.

After reset it asserts empty caption/topic/asset/time, unchanged account selection, the exact short sentence, em-dash verdict, “nothing checked yet,” no reasons and “0 letters.” Rechecking wording preserves the empty state. No-partner queue/send stay disabled; fictional-partner queue/send remain enabled; writing and attachments stay disabled for this fixture. No queue, send, generate or connect action is invoked by the new test.

All four persistent JSON receipts show **zero write attempts and zero page errors**. Only localhost static GETs reach a server; all APIs are intercepted with fictional responses and the Google Fonts request is blocked. This is not a real sign-in, provider, database, send, real-device or full Social journey proof. The unchanged broad Teams/Social proof separately exercises simulated write bodies against its controlled API replies, not production.

## Preserved failed proof

- Original deployed `f78f6b8…` DP result remains **6/7, not green**: [original error](evidence/live-polish-first-f78/live-deployed-Social-Studi-5abd3-r-help-on-desktop-and-phone-chromium/error-context.md), [original results](evidence/live-polish-first-f78/results.json). Local success does not clear that production receipt.
- The first new local test run was **4 passed / 2 failed**. Its no-partner cases incorrectly expected “Looks fine” after choosing Funding. The unchanged `approveBeforeLaunch()` defaults an unread setting to approval required (`social-studio.html:1112–1115`). Corrected only the **new** test to require the exact existing “Someone must approve it” and owner/admin text in that state; the fictional saved-false fixture must still show “Looks fine.” No existing test, app gate or validator was changed. Both authoring reds are retained in [first run](evidence/social-live-copy/local-after/).
- The corrected run was 6/6 in 6.6 seconds. The final 6/6 run added persistent JSON output only; all assertions stayed identical. Both result folders remain.

## Marked evidence

Eight final screenshots cover settled initial and empty reset in all four states. Red boxes mark the exact copy; captions identify localhost/fictional proof.

- [390, no partner, reset](evidence/social-live-copy/final-receipts/astra-social-empty-copy-So-ad8e0-ear-at-390-no-partner-DP06--chromium/empty-reset-MARKED.png)
- [1440, fictional partner, initial](evidence/social-live-copy/final-receipts/astra-social-empty-copy-So-0b807-r-at-1440-fictional-partner-chromium/settled-initial-MARKED.png)
- [390 fictional partner receipt](evidence/social-live-copy/final-receipts/astra-social-empty-copy-So-07a24-ar-at-390-fictional-partner-chromium/local-read-only-receipt.json)
- [1440 no-partner receipt](evidence/social-live-copy/final-receipts/astra-social-empty-copy-So-ae37c-ar-at-1440-no-partner-DP06--chromium/local-read-only-receipt.json)

Root's remaining steps: review the exact one-string script-contract exception, integrate this narrow repair with the separately owned Team startup fix, then rerun the original live proof after deployment. No fresh live pass is claimed here.
