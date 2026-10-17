# Two Fundhub iOS apps — 2026-10-16

Owner call: two separate App Store apps. The public thank-you page advertises the company app, never the staff Prompter. Chris approved the parallel build and asked for no more routine questions.

## Split and ownership

| Track | Owner | State | Exit proof |
| --- | --- | --- | --- |
| Fundhub Prompter public App Store listing | Prompter agent | Build 2 prepared in draft [PR #55](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/55); not uploaded | Native build, review assets, Apple submission receipt, public listing |
| Fundhub company app for clients and staff | This session | Native draft in [PR #56](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/56); not uploaded | Separate bundle, role-scoped sign-in and working screens, device build, Apple submission receipt, public listing |
| Thank-you-page company download | Funnel agent, then this session after company listing | Prepared in draft [PR #54](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/54); hidden | Live card on `/thank-you`; button opens the exact installable Apple URL |

Prompter and company app work can run at once. The funnel release waits for the **company** listing. No TestFlight or guessed App Store URL goes on the funnel.

## Company app plan gate

1. **Role:** Client and employee in one binary, with separate role-scoped screens. A client sees only their own file; an employee sees their assigned workspace.
2. **One job:** Client home answers where their file stands. Staff home opens their role's work. The full existing portal/workspace remains available for detailed actions.
3. **First question:** Client: “Where is my file?” Staff: “What needs me today?”
4. **Reuse:** `/api/auth/login`, `/api/auth/session`, `/api/read/portal-summary`, existing role-to-home mapping in `public/app/shell.js`, `public/app/client-portal.html`, and the approved Fundhub `f.` icon.
5. **Data:** Existing endpoints provide the login principal, role, client stage, advisor, documents, and invoice status. No new server route or database change is planned. The existing web pages retain complex workflow controls.
6. **Files:** New `tools/fundhub-ios/` native project and App Store handoff, `docs/journeys/fundhub-ios-intended.md`; new company download script/config under `public/funnel/`; `marketing/landing-pages/tracking-manifest.mjs` and its focused test; this board. The old Prompter funnel card is superseded, not made public.
7. **Risk and proof:** Client/staff sessions must stay separate; no sample data can appear as live. Prove native build and tests, real API contract tests, and phone UI. Apple may reject a mere web wrapper, so the client status screen must be truly native and useful. Do not call either app live until an installable Apple listing is verified.

## Account and release boundary

The saved permission for `appstoreconnect.apple.com` denies agent access. Do not use another browser, API, CLI, or raw connection to achieve the same account action. Apple registration, review submission, and publication remain unverified until the owner completes that account step or the permission changes. The website ship is also red on the production pulse bundle proof. Keep the funnel card hidden until the actual company app URL and a clean release exist.

## Evidence so far

- Company app project: `tools/fundhub-ios/Fundhub.xcodeproj`, bundle `ai.fundhub.app`, distinct from Prompter. Debug simulator build and unsigned Release iPhone build pass.
- Simulator iPhone 17 XCTest: **7 passed, 0 failed** in `/tmp/fundhub-company-ios-tests-7.xcresult`, including bearer-token reads, native logout, server-error retry, and web sign-out routing. Login screen captured at `ops/workflows/build-evidence/fundhub-ios/sign-in-iphone17.png`.
- Public `fundhub.ai` health, staff login, portal login, and client portal all returned 200 on 2026-10-16. This is door proof, not a signed-in journey test.
- Live demo logins are disabled. No non-customer App Review account exists yet. Physical iPhones were listed as unavailable by Xcode; no real-iPhone sign-in or camera/document test has been claimed.
- Apple App Store record, signing profile, review submission, approval, and public company link are still unverified. The company App Store card remains hidden.
- Prompter build 2 fixes a simulator startup crash, removes a 4K option the code did not provide, and adds privacy links. Its agent reports 56 passing simulator tests and an unsigned Release build; real-device filming and App Review are still open. Do **not** submit TestFlight build 1 for public review.
- A separate native-app review found logout, retry, and photo-permission gaps. These are patched and covered by the seven passing tests. The unsigned Release build includes the camera and photo-library purpose strings.

## Parallel prompts

**Prompter:** In `fundhub-platform`, finish the separate `ai.fundhub.prompter` App Store readiness track. Build and test, prepare screenshots and truthful store copy. Do not edit the company app or funnel. Do not access App Store Connect by any workaround. Report exactly what Apple account action remains.

**Company app (this session):** In `fundhub-platform`, build a separate native Fundhub iOS app for clients and employees. Reuse the existing sign-in, client summary, and role-based web workspace; keep client and staff data apart. Test on simulator and real iPhone where available. Prepare the company app for App Store submission, but do not claim Apple acceptance without proof.

**Funnel (this session, dependent):** Prepare a branded company-app download card for `apply.fundhub.ai/thank-you` through the safe ClickFunnels footer-script flow. Only release it after the company's exact, working App Store listing URL is known and the website release passes. Verify the live page and destination.
