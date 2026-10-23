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

## 2026-10-23 — switched to Fundhub Portal, live

- Apple approved **Fundhub Portal** 1.0 (`ai.fundhub.app`, id 6823985032). It sat in Pending Developer Release. Chris said yes; the release was sent through the App Store Connect API and the state became Ready for Sale.
- Listing: https://apps.apple.com/us/app/fundhub-portal/id6823985032 (page title "Fundhub Portal App - App Store").
- The /thank-you card now points at the Portal listing, with words from the Portal's own App Store promo text. Prompter is not on the funnel: its store version was never submitted, and its TestFlight invite still turns people away.
- Footer script added to page 25063539 by `scripts/cf-push-custom-html.mjs push --only=apply-thank-you`. JSON ships with commit d7f94c3d6.
