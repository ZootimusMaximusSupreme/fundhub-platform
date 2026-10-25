# When Chris says test, click like a human

Owner-set. Do not re-raise.

Chris is not asking for a code script when he says test. He wants the agent to go through every motion a person would: open the live site, type, click, look at the screen.

## Required order

1. Run the automated checks (unit tests, lint, live Playwright). Those still matter.
2. Then open the real system (`https://fundhub.ai` or the page he named) and walk the path by hand in a browser.
3. Only then say it was tested.

## What does not count as a UI test

- Hitting an API or writing a prove script and calling that the test
- A green `npm test` alone
- A green Playwright run alone, if nobody opened the page and clicked like a person

Playwright against the live site is the score gate. It is still a script. After it is 100/100, the agent still does the human click path. Then Chris does exactly one manual pass.

Fake e2e emails only: `e2e+aff-*@`, `e2e+wl-*@`. Never print passwords.