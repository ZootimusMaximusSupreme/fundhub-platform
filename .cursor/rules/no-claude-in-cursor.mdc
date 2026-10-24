---
description: Cursor agents must not invoke Claude or Anthropic models
alwaysApply: true
---

# No Claude in Cursor

**Owner-set (2026-09-18):** Agents in Cursor must not use Claude or Anthropic models.

## Never

- Invoke Claude / Anthropic (`claude-opus`, `claude-sonnet`, Task `claude-*`, etc.)
- Tell Chris to “leave it for Claude” or spawn Claude for screens, copy, or fixes
- Route display or product work to Claude because another rule mentioned it

## Exception (owner-set 2026-09-21 and 2026-10-24)

Display work (`grok-no-displays`) and animation building (`animation-builders-opus-placers-sonnet`) are Claude work. A Cursor agent does not do them and does not spawn Claude for them. It writes the need on the shared board and leaves it for a Claude session.

## Always

- Use Composer, Grok, or other listed non-Claude models in this environment
- Do the work in-session with those models when Chris named the task

## Example

```text
Ask: "Fix the portal button copy."

❌ "Open Claude to edit public/app/…"
✅ Change the copy here with Composer or Grok.
```

See `grok-no-displays.mdc` for display boundaries (no new Claude handoff).
