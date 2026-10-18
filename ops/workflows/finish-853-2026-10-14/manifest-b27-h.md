# Workflow H — flow and read proof finish

Date: 2026-10-18 Arizona

Scope: the one open flow ID and two open read IDs assigned to Workflow H. No messages were sent, no production data was written, and no product or generated catalog file was changed.

## Results

| ID | Outcome | Exact result |
| --- | --- | --- |
| `catalog-read:climate-map` | live check | Bound to the existing GET-only climate reader. It reads `/api/climate`, `/climate/`, and the scripts/map file loaded by that page. It can pass on 51 real outlines, fail on missing or placeholder shapes, and skip on a failed read. The shipped files currently return **FAIL** because the page draws 5 of 51 outlines. |
| `catalog-read:present-send-lock` | not-attachable | The current rendered test proves four controls and only the in-flight half of two controls. `Generate letters and email now` reads the response wrapper at the wrong level, so a delivered pack gets no sent line or cooldown. `Send soft pull` is not rendered with the shared send-button result UI, so it has no Sending line, sent line, or count. An honest final-result test cannot pass until those product controls change. Product files were outside Workflow H. |
| `flow:message:script:one-off senders in scripts/` | not-attachable | The aggregate names three run-by-hand senders. They do not share one durable, script-tagged final receipt. In particular, `scripts/prove-soft-pull-live.mjs` calls the Resend provider directly and only prints the returned result; it does not save a message/receipt row that a read-only pulse can identify later. A safe exact read needs a durable source tag/receipt (or the scripts need injectable fake sinks for a practice test). Script/product files were outside Workflow H. |

## Counts

`node scripts/pulse/count-not-proved.mjs`

- `openBefore`: **57 total** — routes 9, display 45, flow 1, reads 2.
- `openAfter`: **56 total** — routes 9, display 45, flow 1, reads 1.
- Workflow H: **3 → 2**. The climate row left `NOT_PROVED` and is now a measured live red. The two rows above remain open with exact not-attachable reasons.

## Files

Added:

- `src/pulse/catalog/proofs/fin-b27-h-read-contracts.mjs`
- `src/pulse/catalog/proofs/fin-b27-h-read-contracts.test.mjs`

Shared proof files changed:

- `src/pulse/coverage/gap-catalog-reads.mjs`
- `src/pulse/coverage/gap-catalog-reads.test.mjs`
- `src/pulse/catalog/proofs/read-proof-cases.mjs`
- `src/pulse/catalog/proofs/read-proof-cases.test.mjs`
- `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`

Intentionally untouched:

- `src/pulse/catalog/generated.json`
- all display and route proof files
- `.env`, production data, messaging sends, and unrelated iOS/auth work

## Checks

| Command | Result |
| --- | --- |
| `node --test src/pulse/catalog/proofs/fin-b27-h-read-contracts.test.mjs src/pulse/coverage/gap-catalog-reads.test.mjs src/pulse/catalog/proofs/flow-read-contracts.test.mjs` | 8 passed, 0 failed |
| `node --test src/pulse/catalog/proofs/read-proof-cases.test.mjs` | 3 passed, 0 failed; all 77 proved read rows ran their focused tests |
| `node --test src/pulse/coverage/gap-catalog-flow.test.mjs` | 20 passed, 0 failed |
| `node scripts/pulse/count-not-proved.mjs /tmp/heartbeat-h-after-2026-10-18.json` | 56 total; flow 1, reads 1 |
| `npm run lint` | 3,965 files and inline scripts parse clean |
| `git diff --check` | clean |

## Follow-up product repair — 2026-10-18

The integration lane repaired `catalog-read:present-send-lock` after Workflow H
identified its two exact product causes. `Generate letters and email now` now
reads the delivered result from `FHData.write()`'s `data` wrapper, and `Send
soft pull` now renders through the shared send button state. The rendered proof
checks all six client-facing send controls for one in-flight request, visible
`Sending…`, a four-second cooldown, persistent `Sent at`, repeat counts, and an
immediate retry after failure.

- `node --test src/pulse/catalog/proofs/fin-b23-present-send-lock.test.mjs`: 8 passed, 0 failed.
- `node --test src/pulse/coverage/gap-catalog-reads.test.mjs`: 3 passed, 0 failed.
- `node scripts/pulse/count-not-proved.mjs /tmp/heartbeat-integration-after-present.json`: 53 total; display 45, routes 7, flow 1, reads 0.
