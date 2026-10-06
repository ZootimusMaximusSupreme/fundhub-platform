# Command Center tabs — the contract every tab file follows

Plan unit U34 built the frame. This page is for the units that add a tab (Ideas,
Scripts, Shoot, Videos, Launch, Numbers) so each one plugs in without touching
another tab's file.

Design: `docs/specs/command-center-design-2026-10-05.md` §3.0 (rules for every tab).
Law for every pixel: `docs/rules/UI-STANDARDS.md`.

## The files

| File | Owner | What it is |
|---|---|---|
| `public/app/marketing-command-center.html` | shared | The page: sidebar, topbar, the frame's markup, the shared `<style>` (the frame's rules and Today's cards), one `<script defer>` line per tab. |
| `public/app/marketing-command-center.js` | the frame (U34) | The tab registry, hash routing, the tab strip and the gear, the shared `ctx` helpers. |
| `public/app/marketing-cc-today.js` | Today (U37 after U34) | Today's rules, markup and wiring. |
| `public/app/marketing-cc-settings.js` | Settings (U34) | The gear tab. |
| `public/app/marketing-cc-<tab>.js` | that tab's unit | One file per new tab. |

A new tab adds **one line** to the HTML, after the frame's and before
`marketing-cc-settings.js`:

```html
<script defer src="marketing-cc-ideas.js"></script>
```

Nothing else in the HTML changes. A tab never edits the shared `<style>`: it
brings its own CSS through `ctx.style` (below).

## Registering a tab

At the end of its file, inside its own IIFE:

```js
var TAB = {
  key: "ideas",            // lower-case letters, digits, dashes; it is the URL hash
  label: "Ideas",          // the word on the strip
  order: 20,               // work order: Today 10, Ideas 20, Scripts 30, Shoot 40,
                           // Videos 50, Launch 60, Numbers 70 (Settings 900, the gear)
  place: "strip",          // "strip" (default) or "gear" (only Settings)
  rules: RULES,            // the pure functions, for node:vm tests
  render: function (panel, ctx) { /* draw into panel, wire it, start reads */ },
  show: function (panel, ctx) { /* optional: every later time the tab is shown */ },
  hide: function (panel, ctx) { /* optional: when another tab is shown */ }
};
if (root.FHMarketingCCTabs && typeof root.FHMarketingCCTabs.register === "function") {
  root.FHMarketingCCTabs.register(TAB);
} else {
  (root.FHMarketingCCTabsQueue = root.FHMarketingCCTabsQueue || []).push(TAB);
}
```

- `id` is accepted in place of `key`; `key` is the name to write.
- `register` checks the shape and says why it refused (`FHMarketingCCTabs.problems()`).
  Only one tab may sit behind the gear.
- The queue covers a tab file that runs before the frame. The frame drains it when it starts.
- **A tab shows only when its file is on the page and registered.** A tab with no back end
  does not render, so there is never an empty or "coming soon" tab (UI-STANDARDS §5).
- Also put the rules on `window`, the way Today does (`window.FHMarketingCC`) and Settings
  does (`window.FHMarketingCCSettings`), so `src/ui/<tab>.test.mjs` can run the file in
  `node:vm` with no browser.

## When `render` runs

- **Once, the first time the tab is shown.** Never while the page loads a tab nobody opened
  (a buzz link to `#settings` never reads Today's numbers).
- **Never from inside `register`.** The frame waits until the tab's file has finished running,
  so `render` can use anything the file defines after its `register` call.
- `panel` is the tab's own `<section class="cc-panel" id="tab-<key>">`, a flex column with
  the shared 24px gap. Draw into it and wire events on it (or below it). The frame shows and
  hides it.
- The frame does not repaint a tab. A tab that reloads on a timer keeps its own timer
  (Today reads `GET marketing/today` every 5 minutes and on focus).
- A `render` that throws leaves one plain sentence in the panel: "This tab did not open.
  Reload the page and try again." The other tabs keep working.

## The address

- `#<key>` opens a tab: `#today`, `#settings`. `#<key>/<view>` is for a view inside a tab
  (`#numbers/ads`); `ctx.sub()` reads the view.
- Every buzz deep-links as `/login.html?next=/app/marketing-command-center.html#<key>`.
- `?tab=<key>` works too, once, when the link has no hash.
- A link to a tab that is not on the page (`#ideas` today) lands on the viewer's last tab, or
  Today, and the address is corrected to match.
- The last tab is remembered per viewer in this browser (`localStorage` key `fh_mcc_tab`,
  wrapped in try/catch; a private window just lands on Today).
- Back and forward move between tabs.

## `ctx` — what the frame hands every tab

| Helper | What it does |
|---|---|
| `ctx.api(path, {method, body})` | Fetch with the session (Bearer from `fh_token`, else the cookie). Answers `{status, body}` and never throws: no connection is `{status:0, transport}`. A GET gives up after 20 seconds (`transport:"timeout"`). |
| `ctx.post(path, body, requestId?)` | A write. It always carries a `request_id` (a fresh UUID unless the caller passes one; a retry of the same tap passes the same one). The caller puts the version guard in the body: `updated_at` for settings and funnels, `version` for scripts and videos. |
| `ctx.requestId()` | A fresh UUID v4. |
| `ctx.costs(force?)` | `GET marketing/costs`, read at most once a minute, as `{state:"ok"|"missing"|"error", kinds, month}`. Until that route ships the state is `"missing"`. |
| `ctx.costLine(costs, kind)` | The cost words under a button that calls a model (design safety rule 3): "About $0.67 and about 4 minutes (last run)." or "Cost: unknown, not measured yet." Never a guess. |
| `ctx.monthLine(costs)` | "Model spend this month: $12.48 of $300.00." or "...: unknown." |
| `ctx.dollars(usd)` | Model bills in dollars. Null is "unknown", never $0. |
| `ctx.plainError(res, what)` | Any failed answer as one sentence. No status code, no server word. |
| `ctx.toast(text, tone)` | One short answer in the corner, above the status strip; `tone` is `ok` or `err`. Use the answer line next to the button first ("where the person is looking"); the toast is for answers with no better place. |
| `ctx.style(key, css)` | Add the tab's own CSS once. Scope every rule under `#tab-<key>`. No px font size (the brand throws it away, UI-STANDARDS §12.7), no hand-written shadow (§12.2). |
| `ctx.clock(ms)`, `ctx.fullTime(ms)`, `ctx.tz` | Arizona time: "3:05 PM", "Oct 5, 2026, 3:05 PM". |
| `ctx.esc(text)` | Escape server words before they go into HTML. |
| `ctx.go(key, view?)` | Open another tab (sets the hash). |
| `ctx.isActive()`, `ctx.sub()`, `ctx.key` | Is this tab shown; its view; its key. |

## Rules every tab keeps (design §3.0, UI-STANDARDS)

- **One filled button per view** (`btn primary`). The frame paints none. Today's is Write ad
  copy; Settings' is Save. A unit test counts them in each tab file.
- **Four states** on every card: a skeleton in the real layout while loading, a plain empty
  line, an error per part ("The video list did not load. The rest of this page is current."),
  and full.
- **Disabled with the reason printed**, never hidden, never a blind yes.
- **Null is "unknown"**, never $0. A measured zero prints 0.
- **Text from the brand's whitelist only** (`.caption`, `.chip`, `.eyebrow`, `label`, `h2`,
  `.vl`/`.big`), 11px or larger.
- **Phone first:** one column at 390px, 44px taps, no sideways scroll, no inner scroll box
  except a table. A bar pinned to the bottom uses
  `bottom: calc(var(--fh-statusbar,0px) + env(safe-area-inset-bottom,0px))` and leaves room
  for the shell's round Chat button in the bottom-right corner.
- **Counts come from the server.** The strip's counts and dots, when they come (design slice 2),
  read `pipeline` and `waiting` from `GET marketing/today`; no tab adds things up itself.
- **Plain words**, 4th-grade. The company is Fundhub.

## Tests a tab unit adds

- `src/ui/marketing-cc-<tab>.test.mjs`: load the frame then the tab file in `node:vm`; assert it
  registers (key, label, order), its rules, one filled button, no px font size in its CSS, and
  that null prints "unknown". Mock every route from `src/marketing/api-contract.mjs`
  (`exampleResponse`).
- `e2e/marketing-cc-<tab>.spec.mjs`: open `/app/marketing-command-center.html#<tab>` at 390x844
  with the contract's examples, prove the four states, every tap's request body (with
  `assertRequestMatchesContract`), no sideways scroll, 44px taps, 11px text, and mark up the
  screenshots (red boxes, numbered, legend).
- `e2e/marketing-command-center.spec.mjs` already proves the frame: only registered tabs show,
  the gear, hash routing, Back, the remembered tab, the strip at 390px.
