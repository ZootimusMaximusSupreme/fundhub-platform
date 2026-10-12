# Coverage deep proof — 2026-10-12

Owner approved the full build. This batch upgrades the 1,762 honest red catalog rows from shallow monitoring to result proof.

## Shared rules

- A green check must prove the stated result, not just a file, route, page load, or HTTP 200.
- Use read-only checks or fake providers. Do not send, charge, call, mail, or change a live client.
- Keep a row red when the result cannot be proved honestly. Write the exact missing proof.
- Reuse proof helpers. Do not create one-off copies when one shared recipe can cover a class.
- Touch only the lane you claimed. Leave unrelated dirty files alone.
- Add focused tests for every proof recipe changed.
- Write changed paths, test commands, counts, and honest leftovers in the lane manifest.

## Workflows

| Lane | Owner | Scope | Status |
|---|---|---:|---|
| Display proof | Agent 1 | 427 buttons, 385 screens, 259 forms, 172 links | pending |
| Door proof | Agent 2 | 339 routes, 13 jobs, 4 webhooks | pending |
| Flow proof | Agent 3 | 105 journeys, 17 messages, 1 agent | pending |
| Read proof | Agent 4 | 40 reads | pending |
| Integration and ship | This session | review, combine, full proof, commit, push, live check | claimed |

## Shared context

- Catalog: `src/pulse/catalog/generated.json`
- Proof recipes: `src/pulse/catalog/proofs/`
- Coverage modules: `src/pulse/coverage/`
- Proof command: `npm run pulse:prove`
- Beat proof: `npm run pulse:prove -- --beats`
- System map: `ops/workflows/system-map-2026-08-26.md`
- Intended journey files are source truth and must not be edited.

## Lane manifests

### Display proof

Pending.

### Door proof

Pending.

### Flow proof

Pending.

### Read proof

Pending.

### Integration and ship

Claimed by this session. Waiting for the four independent lanes before full proof and ship.
