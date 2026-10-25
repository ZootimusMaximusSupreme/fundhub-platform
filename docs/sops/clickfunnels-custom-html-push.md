# ClickFunnels Custom HTML push (operator)

**API ground truth:** https://developers.myclickfunnels.com/

Custom HTML Pages + SDK went **GA 2026-09-18**:
https://changelog.myclickfunnels.com/2026-09-18-the-clickfunnels-sdk-and-custom-html-pages-are-here

Agents push FundHub HTML and tracking with **`scripts/cf-push-custom-html.mjs`**. Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - if the API key is missing, report the env name and stop; never ask Chris to paste.

## Env names (values in `.env` / Netlify only)

| Name | Purpose |
|------|---------|
| `CLICKFUNNELS_API_KEY` | Bearer token for CF API v2 (**required to push**) |
| `CLICKFUNNELS_SUBDOMAIN` | Workspace subdomain (`chrisstanbridgestea3f77f`) |
| `CLICKFUNNELS_WORKSPACE_ID` | Optional — skip team/workspace walk |
| `META_PIXEL_ID` | Optional override for Meta pixel (aliases: `FACEBOOK_PIXEL_ID`, `FB_PIXEL_ID`, `PIXEL_ID`) |
| `CLARITY_PROJECT_ID` | Optional — omit if empty |

Webhook ingress uses **`CLICKFUNNELS_WEBHOOK_SECRET`** — that is **not** the HTML push API key.

DB fallback: `analytics_connections` where `platform = 'clickfunnels'`.

## Commands

```bash
node scripts/cf-push-custom-html.mjs list
node scripts/cf-push-custom-html.mjs push --dry-run
node scripts/cf-push-custom-html.mjs push
node scripts/cf-push-custom-html.mjs push --only=apply-book
```

## Live apply funnel (do not break)

| URL | Headline (2026-09-20) | Push mode |
|-----|------------------------|-----------|
| https://apply.fundhub.ai/watch | Get $50,000 to $1,000,000… | Tracking inject or custom HTML if page type allows |
| https://apply.fundhub.ai/apply | Let's See What You Qualify For | Custom HTML (apply survey), pushed by manifest key `apply-survey` |
| https://apply.fundhub.ai/funding-book-call | You Are Qualified | **Inject only** — native calendar |
| https://apply.fundhub.ai/thank-you | You're All Set | Custom HTML or inject |

$297 slo fragments (`clickfunnels-fragments/slo/slo-01-sales.html`, etc.) target the **297 funnel**, not the apply calendar step.

## Two funnels on apply.fundhub.ai (split 2026-10-01)

`/watch` used to sit in the same ClickFunnels funnel as `/roadmap`. They are now two funnels on the one domain. Each manifest row names its funnel in `funnelId`.

| URL | Funnel | Page id | Type |
|-----|--------|---------|------|
| `/watch` | **Fundhub Funnel** `968281` | 25061160 | builder, tracking by footer scripts |
| `/apply` | Fundhub Funnel `968281` | 25515671 | custom HTML (apply survey) |
| `/funding-book-call` | Fundhub Funnel `968281` | 25062844 | builder, native calendar |
| `/thank-you` | Fundhub Funnel `968281` | 25063539 | builder |
| `/roadmap` | **Fundhub $297 Roadmap** `984178` | 25516164 | custom HTML |
| `/roadmap-book` | Fundhub $297 Roadmap `984178` | 25516165 | custom HTML |
| `/roadmap-thank-you` | Fundhub $297 Roadmap `984178` | 25516166 | custom HTML |

How it was done (API only): one `POST /workspaces/{id}/funnels` (domain `apply.fundhub.ai`, live mode on); the three roadmap pages copied as new custom HTML pages in it (`POST .../pages/custom_html`, CF token swapped in); each old page's step path moved to `-retired` and the new page moved onto the live path (`PUT /pages/{id}` `current_path`, about one second per page); the old pages were then replaced with a redirect to the live path. Before-split HTML of the three old pages: `docs/workflows/cf-push-snapshots/page-<id>-before-funnel-split.html`.

The three redirect stubs (25426320 `/roadmap-retired`, 25426722 `/roadmap-book-retired`, 25428615 `/roadmap-thank-you-retired`) are already gone (API 404, public 404). `/order` (25426768, step path `/order`, product "Complete Funding Diagnostic") stays: it is still a live checkout step. Fundhub Funnel 2 (`984159`) is empty, not on the domain, and the funnel update has no archive field, so it stays.

Do not full-replace any builder page. Do not point an ad at a `-retired` path.

## What gets tracked, and where it lands

Video watch depth goes to `POST /api/public/vsl-watch` (`public/funnel/vsl-watch-beacon.js`, table `vsl_watch_sessions`). Step opens and button presses go to `POST /api/public/slo-interest` (`public/funnel/fh-events.js`) as events rows `funnel.page` (one per session per step) and `funnel.click` (first press of each button per session, 60 per session at most). Both doors are already routed and in the pulse registry. Clarity is `public/js/clarity.js` (project id in the file), and each press is also sent to Clarity as a custom event. There is no GA4 on either funnel.

| Step | attribution | events script | Clarity | video beacon |
|------|-------------|---------------|---------|--------------|
| `/watch` | yes | yes | yes (footer) | yes |
| `/apply` | yes | yes | yes (added at push) | no film |
| `/funding-book-call` | yes | yes | yes (footer) | no film |
| `/thank-you` | yes | yes | yes (footer) | no film |
| `/roadmap` | yes | yes | yes (head) | yes (VSL + 3 testimonials) |
| `/roadmap-book` | yes | yes | yes (head) | yes (VSL 2) |
| `/roadmap-thank-you` | yes | yes | yes (head) | no film |

The calendar page also loads inside the `/roadmap-book` frame; `fh-events.js` and `clarity.js` stay quiet when framed so the step is not counted twice.

## Tracking (must be on pushed pages)

- Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - tracking goes on every pushed page; fh-attribution.js everywhere, vsl-watch-beacon.js on watch only, Meta pixel.
- `clickfunnels-fragments/06-utm-hidden-fields.html` — **do not** duplicate if `fh-attribution.js` is loaded
- `07-vsl-watch-beacon.html` — same as beacon script on watch

Meta pixel ground truth (if env empty): `docs/workflows/archive/ads-revenue-model-2026-08-24.md`.

## Calendar rule

Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - never full-replace /funding-book-call; a custom-HTML page removes the native booking calendar.

The $297 booking page (`/roadmap-book`) shows this same calendar in a frame. Its frame-only look lives in
`clickfunnels-fragments/04c-book-framed.html`, pushed as one marked block into the calendar page's
`head_code` (manifest key `apply-book-framed`, strategy `code_block_upsert`: reads the live head code with
`expand[]=head_code`, snapshots it, appends the block or swaps only that block, then re-reads to verify). It
does nothing when the page is not in a frame, so `/funding-book-call` itself looks the same.

```bash
node scripts/cf-push-custom-html.mjs push --dry-run --only=apply-book-framed
node scripts/cf-push-custom-html.mjs push --only=apply-book-framed
```

The standalone page's own fit lives in `clickfunnels-fragments/04d-book-fit.html` (manifest key
`apply-book-fit`, marker `fh-book-fit`, same page, same `head_code`, same upsert). Every rule is
`html:not(.fh-framed)`: the scheduler's big logo stays inside its panel at every width, and on phones
(under 640px) the card runs full width minus 16px gutters. It never matches inside the frame.

```bash
node scripts/cf-push-custom-html.mjs push --dry-run --only=apply-book-fit
node scripts/cf-push-custom-html.mjs push --only=apply-book-fit
```

## Skills / rules

- Skill: `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` (linked at `.cursor/skills/` and `.claude/skills/`).
- Rule: `.ai/rules/chris-never-clickfunnels.md`.

## Prove

Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - prove by view-source on each live URL; look at the calendar only; no pay, no SSN. Look for `fbq('init'` and `fh-attribution.js`.
