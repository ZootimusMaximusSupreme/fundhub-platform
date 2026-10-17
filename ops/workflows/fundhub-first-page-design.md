# Fundhub iOS first screen — design direction

## What is wrong now

The captured iPhone 17 screen (`ops/workflows/build-evidence/fundhub-ios/sign-in-iphone17.png`) leads with a 72-point app icon, the placeholder headline “Your Fundhub app,” and a team password form. The client email-link route appears below a divider, with its main action greyed out. The oversized default SwiftUI controls, loose vertical rhythm, and scattered footer links make the screen feel like a prototype. The sign-in code is in `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:184-240`; `BrandMark` is at :362-372.

## One direction: a confident client-first welcome

At 390-point phone width, use a warm near-white canvas (`#FCFCFC`), 24-point side padding, and one column. Keep the existing black `f.` mark but shrink it to a 40-point square beside a bold lowercase **fundhub** wordmark. A thin six-color spectrum line below the wordmark is the only decorative brand accent. This ties to the existing black-and-white icon and the six colors in `public/app/fundhub-brand.css:5-20`; do not add stock photography, fake progress, or invented file data.

The top of the screen is the promise, aligned left:

> **Your file, in focus.**
> See where things stand and what comes next.

Use a strong 34-point title, a 16-point muted sentence, and 32 points before the form. Keep this hero compact enough that the email field, main action, and paste action are visible without scrolling on an iPhone 17. No large floating card around the whole form.

Default client path, in this order:

1. `Email address` label and 52-point high rounded field, with email keyboard and current autofill behavior.
2. One full-width, 52-point black button: **Email me a sign-in link**. An empty-email tap should focus the field and explain what is needed; the opening screen should not feature a lifeless grey primary button.
3. One 52-point outline button: **Paste a sign-in link**. This remains available with an empty email because the user may have copied a link already. Keep the current paste-and-exchange behavior.
4. One compact text row: **Fundhub team? Sign in with password →**. Tapping reveals the password field and **Sign in to workspace** button in place. In the expanded team state, that button becomes the sole prominent action and the link request recedes to a text action. Reuse the same email value.
5. `Privacy policy` and `Need help? support@fundhub.ai` as small footer links with separate 44-point tap areas. Keep existing destinations.

For a saved session, **Unlock with Face ID** or the existing device-passcode label becomes the sole prominent action above the client path. Retain the email-link, paste-link, and staff-password alternatives. Keep the existing session/error copy close to the action that caused it, with an accessible status announcement.

## Source spots and behavior to preserve

- Replace only the `SignInView` layout and supporting small view/style helpers in `tools/fundhub-ios/Fundhub/App/FundhubApp.swift:184-240` and the `BrandMark` size/style at :362-372. `RootView` chooses this screen at :169.
- Keep `FundhubSessionStore.requestLink`, `pasteLink`, `signIn`, and `restore` at :48-80 intact unless a small state-feedback adjustment is needed. The intended journey in `docs/journeys/fundhub-ios-intended.md` requires copying the *full* email link and pasting it, staff password access, and a returning saved-session unlock.
- Keep exactly one filled action in each state. Use 8/16/24/32-point spacing, left alignment, clear 44-point-plus targets, real loading and error feedback, and Dynamic Type. These apply the phone and hierarchy portions of `docs/rules/UI-STANDARDS.md` without copying web-specific shell or card CSS into SwiftUI.
- After building, compare the new 390-point screenshot with the existing evidence and check the installed iPhone. In particular, verify the primary action and paste route remain visible above the fold and the keyboard does not hide the active field or response.
