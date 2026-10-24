# PERF-STANDARDS.md — Fundhub SPEED LAW
### Ground truth for how fast every surface must be. Read before building. Audited by fundhub-perf-auditor.

---

## 1. BUDGETS (fail = finding)

| Surface | LCP | INP | CLS | TTFB | Total JS | Total page |
|---|---|---|---|---|---|---|
| Funnel (VSL, apply, book) | < 2.0s | < 200ms | < 0.1 | < 600ms | < 300KB | < 1.5MB |
| CRM screens | < 2.5s | < 200ms | < 0.1 | < 600ms | < 500KB | < 2MB |
| Login / portal entry | < 1.5s | < 200ms | < 0.1 | < 400ms | < 200KB | < 1MB |

Measured on **mobile, Slow 4G, 4x CPU throttle** — not on your Mac on wifi. Desktop numbers are vanity.

**Why the funnel budget is tighter:** every 1s of load costs roughly 7-10% of conversions, and at $141 CPM you already paid for those clicks. A slow VSL page is a direct ad-spend leak, and Meta's own delivery penalizes slow destinations.

## 2. RULES

**Requests**
- No render-blocking JS in `<head>`. Scripts are `defer` or `async`, or moved to body end.
- Fonts: `font-display: swap`, preconnect to the font host, subset to used weights only. Never block first paint on a font.
- No more than 2 font families, no more than 4 weights total across the app.
- Every third-party script (pixels, chat, analytics) loads async and is listed in a manifest with its measured cost. Anything over 50KB needs a reason.

**Images**
- Explicit `width` and `height` on every image (kills CLS).
- `loading="lazy"` on everything below the fold, `fetchpriority="high"` on the LCP image only.
- WebP or AVIF. No 2000px images rendered at 300px.

**CSS**
- One shared stylesheet, cached across screens. Inline `style="..."` attributes are a finding — they can't cache, and they force style recalc per element.
- Design tokens (spacing, type scale, color) live in CSS custom properties in the shared sheet, not repeated inline per screen.

**JS**
- No library loaded for one function. No chart library on a screen with no chart.
- Data fetches for below-the-fold panels fire after first paint, not during.
- Debounce every input-triggered fetch (300ms minimum).

**Server**
- API responses that render above the fold return in < 300ms or the screen shows a skeleton (never a blank).
- Paginate anything that could exceed 100 rows. No unbounded list fetches.
- Cache headers on all static assets: `max-age=31536000, immutable` for hashed files.

**Perceived speed**
- Skeleton in the real layout beats a spinner. A spinner beats blank. Blank is a finding.
- Never block the whole screen on the slowest panel. Render what's ready.

## 3. THE ONE RULE THAT MATTERS MOST

Measure before optimizing. Every perf ticket cites a Lighthouse number or a network waterfall entry. "This feels slow" is not a finding; "LCP 4.1s, blocked 1.9s on font load" is.
