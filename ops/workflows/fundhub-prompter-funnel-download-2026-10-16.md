# Fundhub Prompter funnel download — 2026-10-16

## Owner

Chris asked for an end-to-end Fundhub Prompter download route from the funnel thank-you page.

## Workflows

| Workflow | Owner | Status | Next action |
| --- | --- | --- | --- |
| TestFlight invite | Chris in App Store Connect | Fundhub Team internal group has 1 tester and build 1 | Create the Fundhub Customers external group, add build 1, submit for beta review, then share the approved public invite link. |
| Thank-you page | This session | Ready but hidden | Branded card is ready through the builder page's safe footer slot. It stays hidden until the real TestFlight invite URL is saved. |

## Intended result

After a funnel conversion, a user sees a legitimate Fundhub Prompter download card on the thank-you page. The card opens the approved TestFlight invite link once build 1 is ready.

## Release note

The website release was stopped by a stale pulse coverage assertion in `src/pulse/catalog/door-recipes.test.mjs`. The assertion now requires the real FIN-B26 route proof; the focused test passes locally. The site still serves a 404 for the new script until a clean release runs. The card has not been injected into ClickFunnels, so no visitor sees a dead download button.

App Store Connect browser access was denied by a saved permission. Chris supplied a screenshot showing build 1 is ready to submit, plus a later screenshot showing Fundhub Team with 1 tester and 1 build. The automation must not claim to finish Apple account actions without a verified public TestFlight link.
