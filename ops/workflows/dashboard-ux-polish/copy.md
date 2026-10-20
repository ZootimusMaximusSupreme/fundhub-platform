# Social and marketing copy — 2026-10-19

Lane B is ready for root review. No publish or commit was made by this lane.

## Changed product files

- `public/app/social-studio.html`: shortened setup, composer hints, copy-check preview/disclosure, status legend, stat explanations, empty states and approval instructions.
- `public/app/cc-tab-ideas.js`: shorter form labels, dictation placeholders, funnel setup and publishing hints. Costs, caps, confirmations and stage behavior remain intact.
- `public/app/marketing-cc-settings.js`: shorter script-format, expiry, writing-budget, winner-rule, campaign and funnel hints.
- `public/app/marketing-cc-scripts.js`: shorter edit/rewrite and dictation help, film-order hint, idea-write and saved-rule captions.

`marketing-command-center.html` is a frame. Its visible tab copy is in the existing tab files above, so the HTML frame did not need a change. Today, Shoot, Launch and Numbers copy did not need edits for this pass.

## Review inventory

| Area | Before | After |
| --- | --- | --- |
| Social draft helper | 28 words explaining brand drafts, the waiting list and sending | “Brand-matched drafts. Review them below before sending.” (8 words) |
| Social connection setup | 84 words, including how providers were never built | 20 words: available networks, setup state and private sign-in keys |
| Copy-check disclosure | 165 words | 57 words; still collapsed in the existing disclosure |
| Post-state legend | 88 words including badges | 38 words including the same badges |
| Approval card | Multiple paragraphs explaining the sender internals | Held posts do not send; only owner/admin can approve or refuse; approval releases for send time and refusal stops permanently |
| Marketing funnel helper | Full explanation of address selection, tags, tracking and three pages | “Creates 3 tracked pages with an available address and campaign tags.” |
| Script rewrite helper | Dictation paragraph plus long rewrite explanation | Dictation in placeholder; one rewrite, actual cost, and exact-note meaning retained |

The four measured static Social blocks total **365 → 123 words (66% shorter)**. This is a selected-copy measurement, not a claim that the whole page is 66% smaller. Counts strip HTML and count letter/number words against base `842ebfc6e`.

Key consequences remain visible: a saved send time is not cleared by emptying its box; no send time means no automatic send; failed connections hold posts without using a retry; approval requirements/roles and permanent refusal remain; credit-repair approval/disclosure requirements remain; UTC and eight-day lookup remain; attachments are unavailable and Instagram cannot send. No provider, consent, copy rule, request body, action handler, amount or timer changed.

## Proof

- `node --test --test-reporter=spec src/ui/cc-tab-ideas.test.mjs src/ui/marketing-cc-settings.test.mjs src/ui/marketing-cc-scripts.test.mjs src/http/social-studio-screen.test.mjs`: **109 passed, 0 failed, 0 skipped**.
- `node --test src/pulse/catalog/proofs/display-contracts-teams-social-1.test.mjs`: **passed**. Real local Chromium, controlled API replies, including queue/publish confirmation and body checks. This is local proof, not live-production proof.
- Existing `cc-tab-ideas`, `marketing-cc-settings`, `marketing-cc-scripts` browser suites: **99 passed initially**; the only two failures were exact old-copy expectations. After updating those literals, the two affected tests **both passed**. Thus all 101 distinct cases passed; no functional assertion was removed.
- `git diff --check`: passed.
- Root owns final lint, TypeScript, broader browser checks and release decision.

Only copy expectations changed in `src/ui/cc-tab-ideas.test.mjs`, `src/ui/marketing-cc-scripts.test.mjs`, `e2e/marketing-cc-scripts.spec.mjs`, and `e2e/marketing-cc-settings.spec.mjs`. The controlled Teams/Social proof's count assertions now check actual numbers, and its approval assertion checks both required roles and held-post consequences. Nothing was skipped or relaxed.

## Marked screenshots

Captured by `capture-copy-preview.mjs` with the same invented partner and one unsent draft. All API calls are intercepted, no account is connected, and the script confirms zero API writes and zero page errors. Red boxes mark the before version; green boxes mark the after version, with short captions at each edited help area. Shared branding reflects root's current local changes in both versions.

- [Before — 1440](evidence/social-copy-before-1440-review.webp)
- [After — 1440](evidence/social-copy-after-1440-review.webp)
- [Before — 390](evidence/social-copy-before-390-review.webp)
- [After — 390](evidence/social-copy-after-390-review.webp)
- [After — desktop top viewport, 1440 × 900](evidence/social-copy-after-1440-top-review.webp)

No customer data or production action was used. These are review drafts, not proof of a production release.
