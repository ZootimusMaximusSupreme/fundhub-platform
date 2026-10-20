# Heartbeat public-page link proof — 2026-10-18

- Base: `fc0065e00968aa747a10112e9787cbcc4a13fe38`
- Branch: `codex/heartbeat-public-links`
- Scope: the exact 19 saved catalog items where `sourceFile` is `public-pages.json` and `state` is `red`.
- `openBefore`: 19
- `openAfter`: 0 in the in-memory catalog compile
- Saved `src/pulse/catalog/generated.json`: unchanged for final integration regeneration

## Proof added

- Eighteen links are clicked in Chromium from their shipped source pages.
- Internal links must reach the shipped destination page with the exact path, query, title, heading, selected program, or form promised by the row.
- The three external links must make the exact browser GET. SmartCredit must refuse the click until consent is checked. The proof does not claim the remote vendor is live.
- The unsubscribe button must GET state without acting, POST the exact signed fields, and paint the success result. Its existing database test and daily opt-out lane remain attached.
- Mutation proof: a wrong destination page fails the browser proof; lowering one row to L2 makes that exact compiler item red again.

## Checks

- `node --test --test-force-exit src/pulse/catalog/proofs/public-page-link-outcomes.test.mjs src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs src/pulse/catalog/proofs/display-contracts-ef-public-2.test.mjs src/messaging/unsubscribe.test.mjs src/http/unsubscribe-public.pg.test.mjs` — 64 passed, 6 database-only checks skipped because no scratch `DATABASE_URL` was used.
- `FUNDHUB_FULL_SUITE_COVERS_DISPLAY_PROOFS=1 node --test src/pulse/catalog/compiler.test.mjs src/pulse/catalog/display-recipes.test.mjs src/pulse/catalog/proofs/display-proof-cases.test.mjs` — 23 passed.
- `npm run lint` — 3,984 files and inline scripts parse clean.

## Changed files

- `src/pulse/catalog/proofs/public-page-link-outcomes.mjs`
- `src/pulse/catalog/proofs/public-page-link-outcomes.test.mjs`
- `src/pulse/catalog/proofs/display-proof-cases.mjs`
- `src/pulse/catalog/proofs/display-proof-cases.test.mjs`
- `src/pulse/catalog/display-recipes.test.mjs`
- `ops/workflows/heartbeat-public-links-2026-10-18.md`

No row needs a live write, outbound message, purchase, or vendor action. The exact remote-link promise is browser navigation to the named address, and that is what the test proves.
