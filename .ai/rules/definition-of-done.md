---
description: What must pass before a task is reported complete.
alwaysApply: true
---

# Definition of done

Never report a task complete until all of these pass:

1. `npm run lint`
2. TypeScript (`npx tsc --noEmit`) only when TypeScript is installed.
3. The relevant automated tests. Name any check that could not run here and say how many database tests skipped. Database tests that skip without `DATABASE_URL` are not proof. Do not delete, skip, or weaken a test to make a suite pass.
4. Playwright check on any UI change
5. `-actual.md` journeys updated, changelog appended
6. Change manifest emitted

If something fails and you cannot fix it, say so plainly. Do not report partial work as finished. Do not make a suite pass by removing the test that failed.
