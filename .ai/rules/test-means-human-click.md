---
description: When Chris says test: live Playwright to 100/100, then the agent clicks the live site like a person
alwaysApply: true
---

# Test means click like a human

**Owner law (2026-08-16):** When Chris says test, he wants every motion a person would make. Open the live page. Type. Click. Look at the screen.

**Owner law (2026-08-25):** Chris does no manual QA or visual review until an AI-run Playwright suite against the deployed site scores 100/100. The agent then walks the same path itself. Chris does a manual pass only if he offers one, and then exactly one.

Automated checks still run. They are not the finish.

## Order

1. Run the code checks (`npm test`, lint).
2. Run live Playwright against the deployed site until it scores 100/100 (see Live Playwright gate).
3. Open the real site (`https://fundhub.ai` or the page he named) and walk the path in a browser like a person: type, click, look at the screen.
4. Only then say it was tested.

## Does not count as a UI test

- An API call or a prove script
- A green `npm test` alone
- A green Playwright run alone, if nobody clicked the page like a person

Fake e2e emails only: `e2e+aff-*@`, `e2e+wl-*@`. Never print passwords. Outbound prove sends go to Chris / prove addresses only. Never production client records.

## Live Playwright gate

- Live targets: the app and CRM at `https://fundhub.ai`; the funnel at `https://apply.fundhub.ai`. Not the local static harness. Harness specs may exist for offline UI, but they do not count toward the 100.
- Score: `score = (passed_required / required) * 100`. Required ids live on the batch's own board (for example `ops/workflows/live-playwright-100.md` for the teleprompter repair). Report the score after every run. Fix and re-run until 100; do not dump a long failure list on Chris and stop.
- Prefer `npm run test:e2e:live` (or the board's current live command).
- Credentials come from gitignored `.env` / env only; never ask Chris to paste passwords. No key-rotation nags (`secrets-env-law`).
- Commit evidence and docs when the score moves. Do not ask Chris to 'check the site' until 100/100.
- A 100 score is still a script. After it, walk the same path in a browser like a person.
- One exception to 'Chris does no QA' (owner-set 2026-10-13): Chris checks the shipped teleprompter on a real iPhone.
