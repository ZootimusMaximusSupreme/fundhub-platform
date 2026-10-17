# Fundhub iPhone app

This is the **company app**, separate from `tools/teleprompter-ios/`. Its bundle ID is `ai.fundhub.app` (a proposed ID until Apple registers it). The app signs in clients and staff with the existing Fundhub API. Client Home reads the server-scoped file summary in native SwiftUI. Staff Home opens the role's existing work screen. The full client portal or staff workspace stays in an in-app web view for detailed actions.

## Build and tests

```sh
xcodebuild -project tools/fundhub-ios/Fundhub.xcodeproj -scheme Fundhub -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test
xcodebuild -project tools/fundhub-ios/Fundhub.xcodeproj -scheme Fundhub -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

An unsigned device build proves compilation only. It cannot be uploaded or installed as the public App Store release. Use the Fundhub Apple team `8VDXL37RR6` after the separate App ID, signing and App Store record are registered.

## Store handoff

- App name: **Fundhub**
- Subtitle draft: **Your file. Your work. One app.**
- Category: Finance
- Privacy policy: `https://fundhub.ai/privacy/` (also linked inside the app)
- Support: `https://fundhub.ai/` (links to `support@fundhub.ai`)
- Description draft: **Fundhub keeps your file and your work close. Clients can see their current file stage, advisor, documents and amount due, then open the full portal for their next steps. Fundhub team members can sign in to their role's workspace.**
- Review account: **not provisioned**. Live demo logins were checked and are disabled. Do not enter guessed credentials or submit as if this were complete.
- Screenshots: the logged-out iPhone screen is captured under `ops/workflows/build-evidence/fundhub-ios/`. Logged-in client and staff screenshots require non-customer review accounts.

The App Store Connect origin is denied by a saved permission for this task. Do not try another UI, API or CLI to perform the same account action. Neither this project nor its source build proves Apple review or a public listing.
