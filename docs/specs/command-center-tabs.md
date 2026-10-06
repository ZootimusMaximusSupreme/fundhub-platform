# Command Center tabs — the plug-in contract

Owner: the main session, 2026-10-06. Written so tab units can be built at the same time as the frame (U34). The design is `docs/specs/command-center-design-2026-10-05.md`; UI law is `docs/rules/UI-STANDARDS.md`; the API is `docs/specs/marketing-machine-api.md` (+ `src/marketing/api-contract.mjs`).

## Files

- The page: `public/app/marketing-command-center.html`. The frame (U34) owns it and the shared script `public/app/cc-frame.js`.
- One file per tab: `public/app/cc-tab-<id>.js` (and `cc-tab-<id>.css` only if needed). A tab unit never edits another tab's file or the frame's file. The integrator adds each tab's `<script>` tag to the page.
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

## What `ctx` gives a tab

- `ctx.api(method, path, body?, { version, requestId })` → `{ ok, status, data, error, conflict, current }`. Calls `/api/<path>` with the session. A 409 returns `conflict: true` and `current` (the saved copy), never throws.
- `ctx.costSheet({ kind, title, onConfirm })` — the cost sheet shown before any paid tap. It reads `GET marketing/costs` when that route exists; otherwise it prints "Cost: unknown, not measured yet". `onConfirm` runs only after the tap.
- `ctx.confirm({ title, consequence, button })` — the two-tap confirm for Reject, Turn on, Push live and the like (design safety rule 5).
- `ctx.toast(text)`, `ctx.go(tabId, param?)`, `ctx.param` (from `#<id>/<param>`).
- `ctx.fmt.money(cents)` → "$1,234.56" or "unknown" for NULL (never $0 for NULL); `ctx.fmt.az(ts)` → Arizona time; `ctx.fmt.ago(ts)`.
- `ctx.user` → `{ role }`.

## Rules every tab follows

- Plain 4th-grade words. Company name Fundhub.
- Every visible control works. A row whose back end is not built shows one honest sentence ("Not on this page yet: it ships in slice N"), never a dead button and never "Copy the chat command" (owner law: nothing runs from Claude Code).
- No fake numbers; NULL prints "unknown"; every number has its as-of time.
- 390px first: one column, buttons at least 44px tall, no sideways scroll, no inner scroll boxes except a table.
- Loading, empty, error (whole tab and one part) states.

## Tests every tab ships

- `src/ui/cc-tab-<id>.test.mjs` for its pure render helpers.
- `e2e/cc-tab-<id>.spec.mjs` at 390x844 and 1280 with mocked answers built from the API contract examples. Until the frame lands, a tab's e2e may load the page with a tiny local stub registry that renders the queued tab (keep it in `e2e/helpers/`).
