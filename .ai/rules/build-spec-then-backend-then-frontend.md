---
description: New work is spec → review → backend → front end. Never HTML first.
alwaysApply: true
---

# Build spec, then backend, then front end

**Owner law (2026-09-19):** New work always uses this order. Do not skip a step. Do not reverse it.

1. **Build spec** — write what the thing does. Spec is not code.
2. **Review / perfect** — Chris reviews and perfects the spec. Wait. Do not start backend in the same turn. If Chris already gave GO for this build, record the spec on the board and continue to backend. Wait only when the spec holds a decision only he can make (`owner-go-no-repeat-approval`, 2026-10-19).
3. **Backend / revise perfect** — prove the data path. If truth moved, revise the spec. Then stop.
4. **Front end** — last. Only after backend is proven and the spec matches truth.

## Never

- Skip the spec
- Start HTML, CSS, or `public/app/` first
- “While I was in the backend also ship a screen”
- Treat the spec as code, routes, or a migration
- Build front end against a stale spec after backend truth moved

## Always

- Spec first. Words Chris can read. Not a handler.
- Review / perfect the spec **with Chris** before backend
- Backend proven, then revise the spec if truth moved, then front end
- Front end last

## Example

```text
Ask: "Build Client Finance OS."

❌ Open public/app/ and draw the desk.
❌ Write api/finance/* and the HTML in the same pass.
✅ Spec → Chris perfects it → backend only → revise spec if needed → front end last.
```

Reinforces CLAUDE.md §3a (back end first, front end last).

## Section 3a detail (owner rule, 2026-09-03)

For anything new, this order, no exceptions:

0. **Spec first (owner-set 2026-09-19).** Write the build spec in words Chris can read, have him perfect it, then go to the back end. If he already gave GO, record the spec on the board and continue; wait only for a decision only he can make. Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md).
1. **Workflow first.** Unless a rule already settles it or he already gave GO (`owner-go-no-repeat-approval`, 2026-10-23), ask Chris one question at a time until you are 95% confident you understand the workflow — how it works today, what data and entities it creates, what state a record moves through. Then propose the schema. Do not propose a schema before the questions.
2. **Schema → migration.** Constraints, enums, and guards live in the database, not in the UI.
3. **Read endpoint → test that proves it.** Green tests must run against a real `DATABASE_URL`; a skipped `.pg.test.mjs` is not green.
4. **Diagram it.** One page: the states a record moves through and the event that fires each transition. Save to `docs/journeys/<feature>-flow.md`. The front end is a window onto this diagram.
5. **Front end last.** Treat it as throwaway. If the data is right it can be rebuilt in an hour. Never let a screen drive the data model.

Rule of thumb from Chris: "work backwards" — back end proven, then visualize how it should function, then build the screen.
