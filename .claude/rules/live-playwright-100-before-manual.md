# Live Playwright gate before manual review

**Owner law (2026-08-25):** Chris does **no** manual QA / visual review until an **AI-run Playwright suite against the deployed site** scores **100/100**. After that score, Chris does **exactly one** manual pass. **Owner override (2026-08-25):** do not ask him. Agent walks it. Only if he *offers* a pass, then he does one.

## Live targets

- App / CRM: `https://fundhub.ai`
- Funnel: `https://apply.fundhub.ai`

Not the local static harness. Harness specs may exist for offline UI, but they do **not** count toward the 100.

## Score

```
score = (passed_required / required) * 100
```

Required ids live on `ops/workflows/live-playwright-100.md`. Report the score after every run. Fix and re-run until 100 — do not dump a long failure list on Chris and stop.

## Agent duties

- Prefer `npm run test:e2e:live` (or the board’s current live command).
- Credentials from gitignored `.env` / env only — never ask Chris to paste passwords.
- No key-rotation nags (see `secrets-env-law.md`).
- Commit evidence/docs when the score moves; do not ask Chris to “check the site” until 100/100.
- A 100 score is still a script. After it, walk the same path in a browser like a person (see `test-means-human-click.md`).
