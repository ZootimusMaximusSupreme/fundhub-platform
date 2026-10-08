# UnderwriteIQ and SLO pack gaps

Lane 20. Read only. Recon (AG-07) is the one tripwire. No second watchdog.

Slice 19 lists SLO job names. Slice 21 lists the underwrite door and the credit jobs. This file does not repeat those lists. It looks for four breaks:

| Check | What it reads |
|---|---|
| `uw-paid-roadmap-no-pack` | A paid roadmap order (`slo_` link, not a demo) older than 2 hours, with none of the four pack files saved |
| `uw-letters-missing` | A credit file is in, and inquiries have no inquiry letter, or a dispute case has no letters |
| `uw-offer-fulfillment-failed` | The pack job is still failed, or the client pack status is Delivery Failed — Retry |
| `uw-read-door` | `GET /api/read/underwrite` answers 500 |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

No credit pull. No charge. No page edits. No change to UnderwriteIQ math.
