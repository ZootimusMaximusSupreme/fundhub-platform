---
description: Audit canvases and fix order — redundancy first, UI polish last
alwaysApply: true
---

# Redundancy first, polish last

**Owner law (2026-08-20):** Visual CRM cleanup has a fixed order. Do not reverse it.

## Thesis

Never polish a control that may die in a redundancy pass. Example: do not restyle or re-space a button that the simplify review might **KILL**.

## Order of work

1. **Redundancy / simplify decisions** — display, button, action, data homes (KEEP / KILL / WIRE-UP / FIX). Chris decides on marked screenshots.
2. **Apply those decisions** — Fixer only for named KILL / WIRE-UP / FIX rows.
3. **UI standards polish** — spacing, type, top-left hierarchy, phone chip, etc. Only on screens and controls that **survived** step 1–2.

## Protected core flow — closer context + Present

**Owner law (2026-08-20):** The sales-rep presentation flow is core company infrastructure.

Do not remove, merge, hide, demote, or simplify:
- Present / screen-share deck
- Call cockpit → Present handoff
- Closer context reads and fetchers
- Contract, pay-link, credit, offer, and disposition actions used in that flow

The shared context fetcher must be **wired and proven end-to-end before launch**:

`closer outcome / Present disposition → call_outcomes → fetchContext → agent prompt`

It is currently wired in code. A live/database proof is still required. If that proof fails, fix the context path. Do not redesign the presentation flow unless Chris names that exact defect.

## Canvases

Build review canvases the same way:

- Redundancy / simplify canvas first when both exist.
- UI-standards canvas second — label it **polish / after redundancy**.
- Suggested fix order on any UI audit canvas must say: redundancy kills first, shared shell polish after survivors are known.

## Never

- Start UI Fixer on a screen still awaiting simplify decisions.
- “While polishing, also kill…” or “while killing, also polish…”
- Treat CRITICAL UI findings as higher priority than an open KILL decision on the same control.
