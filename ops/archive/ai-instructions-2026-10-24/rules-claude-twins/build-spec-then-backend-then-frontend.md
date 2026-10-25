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
