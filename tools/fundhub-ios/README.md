# Fundhub iPhone app

This is the **company app**, separate from `tools/teleprompter-ios/`. Its bundle ID is `ai.fundhub.app` (a proposed ID until Apple registers it). Staff sign in with a password; clients request and paste a one-time email link. Client Home reads the server-scoped file summary in native SwiftUI. Staff Home opens the role's existing work screen. The full client portal or staff workspace stays in an in-app web view for detailed actions.

After the first normal sign-in, the session token is saved in this iPhone's Keychain behind Face ID or device passcode. A returning user unlocks that saved sign-in before the app verifies the session with Fundhub. Canceling the prompt stays at sign-in; the saved-session button retries, and regular sign-in remains available. Signing out removes the saved token. This flow still needs a real Face ID iPhone test; a simulator build alone does not prove the system prompt.

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

## Native iPhone notifications

Client Home can ask for Apple notification permission only after the server reports APNs ready.
Its device token is encrypted and tied to the current client account session. Staff get no client
push card. The dispatcher can send a generic companion alert after an eligible email or SMS
is saved as sent by a real provider. The card's ready state only checks device registration;
no production alert or real-device notification has been verified.

Apple-side setup still needed: in Certificates, Identifiers & Profiles, enable **Push
Notifications** on App ID `ai.fundhub.app`, create an APNs Auth Key, then regenerate the
Development and App Store provisioning profiles. Set `APNS_KEY_ID`, `APNS_TEAM_ID`, and
`APNS_PRIVATE_KEY_BASE64` (base64 of the complete `.p8` file) in Netlify; keep the existing
`PUSH_SUB_ENC_KEY`. Do not commit the `.p8` file. Debug signs with
`Fundhub/Fundhub.entitlements` (`development`); Release signs with
`Fundhub/Fundhub.Release.entitlements` (`production`). Before TestFlight, inspect the signed
archive's `aps-environment` with `codesign -d --entitlements :- Fundhub.app` and confirm it
says `production`. A source build or unsigned archive does not prove this. The App Store
record/key capability cannot be completed from this task's saved Apple account permission.
After the server migration and Apple setup, sign a client in on a real iPhone, turn on the
card, and use `node scripts/push/send-test-native.mjs --client <uuid> --send` from an
authorized environment with the database and APNs variables. The command sends only the
approved test sentence; Apple acceptance and a visible iPhone banner must both be checked.
