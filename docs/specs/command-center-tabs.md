# Command Center tabs — the plug-in contract

Owner: the main session, 2026-10-06. Written so tab units can be built at the same time as the frame (U34). The design is `docs/specs/command-center-design-2026-10-05.md`; UI law is `docs/rules/UI-STANDARDS.md`; the API is `docs/specs/marketing-machine-api.md` (+ `src/marketing/api-contract.mjs`).

U34 built the frame (2026-10-06). This page says what that frame really accepts. It takes two spellings of the same thing: `window.FundhubCC` (below, first: the Ideas, Scripts, Launch and Numbers units build on it) and the frame's own `window.FHMarketingCCTabs`. Both put a tab on the same strip, give it the same kind of panel and hand it the same `ctx`.

## Files

- The page: `public/app/marketing-command-center.html`. The frame (U34) owns it and the shared script `public/app/marketing-command-center.js` (that is the frame; there is no `cc-frame.js`).
- One file per tab: `public/app/cc-tab-<id>.js` (and `cc-tab-<id>.css` only if needed), or `public/app/marketing-cc-<id>.js`. Either name works, as long as its `<script defer>` line is on the page after the frame's line. A tab unit never edits another tab's file or the frame's file. The integrator adds each tab's `<script>` tag to the page.
- Today is `public/app/marketing-cc-today.js` and Settings is `public/app/marketing-cc-settings.js` (both U34).
- Tab ids, in this order: `today`, `ideas`, `scripts`, `shoot`, `videos`, `launch`, `numbers`. Settings is `settings` and opens from the gear, not the tab bar.

## Registering a tab (works whether the frame loaded first or not)

```js
(window.FundhubCC = window.FundhubCC || { _q: [], registerTab(t) { this._q.push(t); } })
  .registerTab({
    id: "scripts",            // one of the ids above
    label: "Scripts",         // plain word shown on the tab
    order: 3,                 // position in the bar
    render(root, ctx) {},     // draw into root (an empty element); may be async
    refresh(ctx) {},          // optional: redraw with fresh data (5-minute reload, focus)
    hide() {},                // optional: stop timers when the tab is left
  });
```

The frame drains `FundhubCC._q` on load and replaces `registerTab` with the real one.

What the frame does with it (as built in U34):

- `id` is the tab's key and its address (`#scripts`). `id: "settings"` goes behind the gear, never on the strip. Only one tab sits behind the gear.
- `order` is the slot, 1 (Today) to 7 (Numbers). The frame keeps it times ten (Scripts 3 is slot 30), the same scale as the frame's own spelling below, so tabs from both spellings sort into one strip.
- `render(root, ctx)` runs once, the first time the tab is shown, and never from inside `registerTab`. A buzz link to `#settings` never draws a tab nobody opened. `root` is the tab's own `<section class="cc-panel" id="tab-<id>">`. A `render` that throws, or whose promise fails before it drew anything, leaves one plain sentence: "This tab did not open. Reload the page and try again." The other tabs keep working.
- `hide()` runs when another tab is shown.
- `refresh(ctx)` runs when the tab is shown again after `hide()`, when the page comes back into view after a minute or more away, and every 5 minutes while the tab is open and the page is in view. A tab with no `refresh` keeps its own timers (Today reads `GET marketing/today` every 5 minutes and on focus by itself).
- A tab that registers twice under the same id (for example once in each spelling) counts once: the first one wins.
- `registerTab` answers `true` when the tab was added. A bad shape is refused with a plain reason in `FHMarketingCCTabs.problems()`.

### The frame's own spelling

```js
var TAB = {
  key: "ideas",            // lower-case letters, digits, dashes; it is the URL hash ("id" works too)
  label: "Ideas",          // the word on the strip
  order: 20,               // Today 10, Ideas 20, Scripts 30, Shoot 40, Videos 50,
                           // Launch 60, Numbers 70 (Settings 900, the gear)
  place: "strip",          // "strip" (default) or "gear" (only Settings)
  rules: RULES,            // the pure functions, for node:vm tests
  render: function (panel, ctx) {},  // the first time the tab is shown
  show: function (panel, ctx) {},    // optional: every later time it is shown
  refresh: function (ctx) {},        // optional: as above, when there is no show
  hide: function (panel, ctx) {}     // optional: when another tab is shown
};
if (root.FHMarketingCCTabs && typeof root.FHMarketingCCTabs.register === "function") {
  root.FHMarketingCCTabs.register(TAB);
} else {
  (root.FHMarketingCCTabsQueue = root.FHMarketingCCTabsQueue || []).push(TAB);
}
```

The frame drains `FHMarketingCCTabsQueue` first, then `FundhubCC._q`.

## What `ctx` gives a tab

- `ctx.api(method, path, body?, { version, requestId })` → `{ ok, status, data, error, conflict, current }`. Calls `/api/<path>` with the session. A 409 returns `conflict: true` and `current` (the saved copy), never throws.
  - As built: `path` is `"marketing/today"` (a leading `/` or `/api/` is fine). `ok` is any 2xx. `data` is the answer's JSON. `error` is the answer's `error` word, `"network"` when there was no connection, `"timeout"` when a read took over 20 seconds.
  - A write's body always carries `request_id`: its own wins, else `requestId`, else a fresh one. `version` is put in the body as `version` when the body has none.
- `ctx.costSheet({ kind, title, onConfirm })` — the cost sheet shown before any paid tap. It reads `GET marketing/costs` when that route exists; otherwise it prints "Cost: unknown, not measured yet". `onConfirm` runs only after the tap.
  - As built: it also takes `lines` (more sentences), `button` (the word on the yes button, default "Start") and `onCancel`, prints the month line ("Model spend this month: unknown." until the route ships), keeps the yes button off until the cost has loaded, and answers a promise of `true` (tapped yes) or `false`.
- `ctx.confirm({ title, consequence, button })` — the two-tap confirm for Reject, Turn on, Push live and the like (design safety rule 5).
  - As built: it also takes `onConfirm` and `onCancel` and answers a promise of `true` or `false`. Cancel has the first focus; Escape and a tap outside the sheet are Cancel.
- `ctx.toast(text)`, `ctx.go(tabId, param?)`, `ctx.param` (from `#<id>/<param>`).
- `ctx.fmt.money(cents)` → "$1,234.56" or "unknown" for NULL (never $0 for NULL); `ctx.fmt.az(ts)` → Arizona time; `ctx.fmt.ago(ts)`.
  - As built: `az` prints "Oct 5, 3:05 PM"; `ago` prints "just now", "5 minutes ago", "2 hours ago", "3 days ago"; both print "unknown" for NULL.
- `ctx.user` → `{ role }`.
  - As built: the role the shell last saw for this browser (`fh_role`), or `null`. A hint for the screen only; the server decides what a role may do.

The frame's own helpers are on the same `ctx`:

| Helper | What it does |
|---|---|
| `ctx.api(path, {method, body})` | The same call in the frame's spelling: the full path (`"/api/marketing/today"`), answers `{status, body}` and never throws (`{status:0, transport}` when there is no connection). The frame tells the two spellings apart by the first word: `GET`, `POST`, `PUT`, `PATCH` or `DELETE` is the method. |
| `ctx.post(path, body, requestId?)` | A write in the frame's spelling. It always carries a `request_id`. The caller puts the version guard in the body: `updated_at` for settings and funnels, `version` for scripts and videos. |
| `ctx.requestId()` | A fresh UUID v4. |
| `ctx.costs(force?)`, `ctx.costLine(costs, kind)`, `ctx.monthLine(costs)` | `GET marketing/costs` (read at most once a minute) and the words the cost sheet prints. |
| `ctx.dollars(usd)` | Model bills in dollars. Null is "unknown", never $0. |
| `ctx.plainError(res, what)` | Any failed `{status, body}` answer as one sentence. No status code, no server word. |
| `ctx.style(key, css)` | Add the tab's own CSS once. Scope every rule under `#tab-<key>`. No px font size (the brand throws it away, UI-STANDARDS §12.7), no hand-written shadow (§12.2). |
| `ctx.clock(ms)`, `ctx.fullTime(ms)`, `ctx.tz` | Arizona time: "3:05 PM", "Oct 5, 2026, 3:05 PM". |
| `ctx.esc(text)` | Escape server words before they go into HTML. |
| `ctx.isActive()`, `ctx.sub()`, `ctx.key` | Is this tab shown; its view (the same as `ctx.param`, read now); its id. |

## The address

- `#<id>` opens a tab: `#today`, `#settings`. `#<id>/<view>` is a view inside a tab (`#numbers/ads`); `ctx.param` is the view when `render` or `refresh` runs. A tab owns its own views: the frame does not redraw a tab when only the view changes.
- Every buzz deep-links as `/login.html?next=/app/marketing-command-center.html#<id>`. `?tab=<id>` works too, once, when the link has no hash.
- A link to a tab that is not on the page lands on the viewer's last tab, or Today, and the address is corrected to match.
- The last tab is remembered per viewer in this browser (`localStorage` key `fh_mcc_tab`). Back and forward move between tabs.

## Rules every tab follows

- Plain 4th-grade words. Company name Fundhub.
- Every visible control works. A row whose back end is not built shows one honest sentence ("Not on this page yet: it ships in slice N"), never a dead button and never "Copy the chat command" (owner law: nothing runs from Claude Code).
- No fake numbers; NULL prints "unknown"; every number has its as-of time.
- 390px first: one column, buttons at least 44px tall, no sideways scroll, no inner scroll boxes except a table.
- Loading, empty, error (whole tab and one part) states.

The frame checks a few more (U34):

- One filled button (`btn primary`) per view. The frame paints none on the page; its only one is the yes button inside a sheet, which covers the page while it is open.
- Text sizes only from the brand's list (`.caption`, `.chip`, `.eyebrow`, `label`, `h2`, `.vl`/`.big`), 11px or larger.
- A bar pinned to the bottom uses `bottom: calc(var(--fh-statusbar,0px) + env(safe-area-inset-bottom,0px))` and leaves room for the shell's round Chat button in the bottom-right corner.
- Counts come from the server: the strip's counts and dots, when they come (design slice 2), read `GET marketing/today`.

## Tests every tab ships

- `src/ui/cc-tab-<id>.test.mjs` for its pure render helpers.
- `e2e/cc-tab-<id>.spec.mjs` at 390x844 and 1280 with mocked answers built from the API contract examples. Until the frame lands, a tab's e2e may load the page with a tiny local stub registry that renders the queued tab (keep it in `e2e/helpers/`).

The frame itself is proved by `src/ui/marketing-command-center.test.mjs` (node:vm: both spellings register, the order, the `ctx` answers) and `e2e/marketing-command-center.spec.mjs` (a real browser: only registered tabs show, the gear, the address, Back, the remembered tab, the strip at 390px, a `FundhubCC` tab loaded from its own file, the cost sheet and the confirm).
