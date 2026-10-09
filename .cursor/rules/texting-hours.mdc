---
description: Any text to Chris goes out only 6 a.m. to 10 p.m. Mountain Standard Time
alwaysApply: true
---

# Texting hours — 6 a.m. to 10 p.m. Mountain Standard Time

**Owner law (2026-10-09):** Any text to Chris goes out only from **6:00 a.m. to 10:00 p.m. Mountain Standard Time**, 100%. Mountain Standard Time is Arizona time (UTC-7, no daylight saving), the same clock the app already calls `America/Phoenix`.

This covers every text and buzz to Chris's own number: the morning and evening brief, the hourly pulse alerts, the 5-minute watch, the finished-ad text, and any text an agent sends through `/api/ops/notify-owner`. It does not change texts to customers (those follow the messaging gate's own quiet hours).

## How it works

- One rule, one function: `inTextWindow(now)` in `src/pulse/quiet-hours.mjs`. 6:00:00 is in, 22:00:00 is out.
- Outside the window nothing is sent. A break found overnight is saved as an open incident and goes out in the first text of the next window (the 6:07 a.m. pulse, or the 5-minute watch if a critical door is still down). It is not dropped.
- A break that opened and healed overnight, with no text ever sent about it, gets no "fixed" text.

## Never

- Text Chris at night, for any reason, including a brand-new break. The 6 a.m. report and the next window carry it.
- Add a new path that texts Chris without calling `inTextWindow`. `src/pulse/quiet-hours.test.mjs` fails the build if a file that texts Chris's number does not.
- Set a different window, or a "critical exception", without Chris saying so.

## Example

```text
2:10 a.m. the payment door stops answering.

❌ Text Chris at 2:10.
✅ Save the incident. At 6:07 a.m. one text: what broke, when, the fix line. The 6 a.m. report lists it too.
```
