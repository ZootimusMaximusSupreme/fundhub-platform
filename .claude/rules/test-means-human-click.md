# Test means click like a human

**Owner law (2026-08-16):** When Chris says test, he wants every motion a person would make. Open the live page. Type. Click. Look at the screen.

Automated checks still run. They are not the finish.

## Order

1. Run the code checks (`npm test`, lint, live Playwright).
2. Open the real site (`https://fundhub.ai` or the page he named) and walk the path in a browser.
3. Only then say it was tested.

## Does not count as a UI test

- An API call or a prove script
- A green `npm test` alone
- A green Playwright run alone, if nobody clicked the page like a person

Live Playwright is the score gate (see `live-playwright-100-before-manual.md`). It is still a script. After **100/100**, the agent still does the human click path. **Owner override (2026-08-25):** do not ask him. Agent walks it. Only if he *offers* a pass, then he does one.

Fake e2e emails only: `e2e+aff-*@`, `e2e+wl-*@`. Never print passwords.
