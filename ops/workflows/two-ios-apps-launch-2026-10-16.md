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

## 2026-10-16 add-on — submit the company app first

Owner call: get the company app into Apple review as soon as it is genuinely submit-ready. CRM phone polish follows submission; it does not hold up the first upload. Face ID is part of the company app's first build.

### Face ID plan gate (owner already said go)

1. **Role:** Returning client or employee, both using the same local unlock before their role-scoped Home.
2. **One job:** Unlock a saved Fundhub sign-in on this iPhone with Face ID or device passcode.
3. **First question:** “Can I get into my Fundhub account quickly?”
4. **Reuse:** Existing `SessionKeychain`, `FundhubSessionStore.restore()`, server session check, and manual sign-in paths. No new auth service.
5. **Data:** Existing bearer token. No new server route or database data.
6. **Files:** `tools/fundhub-ios/Fundhub/App/FundhubApp.swift`, `tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift`, `tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj`, `tools/fundhub-ios/FundhubTests/FundhubTests.swift`, `tools/fundhub-ios/README.md`, `docs/journeys/fundhub-ios-intended.md`, and this board.
7. **Risk and proof:** Canceling Face ID must not open the app, and sign-out must remove the saved session. Prove simulator tests, unsigned iPhone Release build, and later a real-iPhone Face ID sign-in before claiming device proof.

### Parallel work now

| Track | Owner | Output | Dependency |
| --- | --- | --- | --- |
| Face ID for company app | This session | Tested native change in company app PR | None |
| Apple submission checklist | Read-only agent | Only true submission blockers vs later polish | No App Store Connect access via this task |
| CRM phone to-do list | Read-only agent | Prioritized 390px fixes with screen/file names | Work starts after company app submission |

The App Store Connect permission remains denied. Do not route around it. If that state remains, prepare the exact submission handoff and report the remaining account action; do not claim a submission receipt.

### Company app submission queue

1. Face ID quick sign-in: Keychain entry now requires device-owner presence, with manual sign-in fallback. Final iPhone 17 simulator run: 8 tests passed, 0 failed (`/tmp/fundhub-faceid-final-tests-20261016.xcresult`). Unsigned iPhone Release build, repository lint, and TypeScript check passed. The Face ID system prompt has **not** been proved on a real iPhone.
2. Apple account step: verify/register the separate `ai.fundhub.app` App ID and App Store record, sign and upload the company build. The saved App Store Connect permission denies this task account access, and the unsigned build is not an upload.
3. Review access: provision non-customer client and staff accounts, use a real iPhone to complete both sign-in journeys, then capture signed-in screenshots. Do not use real customer data as a reviewer sample.
4. In App Store Connect, finish the company listing, privacy answers, age rating, review access, and screenshots; select the processed build and submit it. Record Apple's receipt before calling the app submitted.
5. After submission, work through the CRM 390px to-do list. The funnel download card still waits for a **public company App Store URL**, not submission or TestFlight.

### CRM phone to-do list — after company submission

Read-only local demo check at 390×844: 33 employee CRM/Present pages had no page-wide sideways scroll and the shared rail started off-screen. Populated real-client workflows were not proved, and this pass did not save the marked screenshots required for a formal UI audit.

1. **Compact the shared phone header.** It consumed about 200px on Pipeline, 209px on Closer Dashboard, and 261px on Staff & Teams. Start with `public/app/shell.js` and `public/app/crm-sidebar.css`.
2. **Fix small touch targets.** Present's “Back to Closer Dashboard” link measured 13px high in `public/app/present.js`; the Client Success fallback link measured 36px high in `public/app/csm-queue.html`. The phone standard is 40px minimum.
3. **Check Messaging with a populated inbox.** Its phone list, thread, and client context can each occupy up to 60vh, pushing the composer far below the list. Start with `public/app/messaging.html`.
4. **Test actual phone tasks.** Add 390px click-path checks for Pipeline, Closer Dashboard, Messaging, and Calendar; `ops/workflows/mobile-check.mjs` currently checks overflow and rail position, not populated work.

**Prompter:** In `fundhub-platform`, finish the separate `ai.fundhub.prompter` App Store readiness track. Build and test, prepare screenshots and truthful store copy. Do not edit the company app or funnel. Do not access App Store Connect by any workaround. Report exactly what Apple account action remains.

**Company app (this session):** In `fundhub-platform`, build a separate native Fundhub iOS app for clients and employees. Reuse the existing sign-in, client summary, and role-based web workspace; keep client and staff data apart. Test on simulator and real iPhone where available. Prepare the company app for App Store submission, but do not claim Apple acceptance without proof.

**Funnel (this session, dependent):** Prepare a branded company-app download card for `apply.fundhub.ai/thank-you` through the safe ClickFunnels footer-script flow. Only release it after the company's exact, working App Store listing URL is known and the website release passes. Verify the live page and destination.
