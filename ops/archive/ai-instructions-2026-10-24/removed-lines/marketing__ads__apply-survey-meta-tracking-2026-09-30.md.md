# Removed from `marketing/ads/apply-survey-meta-tracking-2026-09-30.md` on 2026-10-24

Reason: S39. STALE. The sender is built as `src/messaging/providers/meta-capi.mjs` (live 2026-10-02, `docs/tracking/meta-events.md`). Section 4 is now marked built and uses the real paths.

```
## 4. Proposed CAPI module (future PR)

| Piece | Path | Notes |
|-------|------|-------|
| Send helper | `src/adapters/meta-conversions.mjs` (new) | `sendMetaEvent({ eventName, eventId, eventTime, userData, customData, actionSource })` → POST `https://graph.facebook.com/{META_API_VERSION}/{pixelId}/events` |
| Config | `.env` / Netlify | Reuse `META_ACCESS_TOKEN`, `META_PIXEL_ID` (or repo default pixel id), optional `META_API_VERSION` |
| Idempotency store | `meta_conversion_log` table (new migration) or reuse `events.id` | Prevent double Purchase on `deposit.paid` replay |
| Registration | `src/handlers/meta-conversions.mjs` + `register()` from boot | `on("survey.submitted", …)`, `on("booking.created", …)`, `on("deposit.paid", …)`, etc. |
| Tests | `src/adapters/meta-conversions.test.mjs` | Mock fetch; no live Graph calls in CI |
```
