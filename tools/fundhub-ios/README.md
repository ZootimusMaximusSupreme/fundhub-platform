# Fundhub iPhone app

This is the **company app**, separate from `tools/teleprompter-ios/`. Its registered bundle ID is `ai.fundhub.app`. One sign-in page for everyone: email and password. The server says whether the person is a client or team member, and the app opens the right home. "Email me a sign-in link" is the backup for clients with no password. Client Home reads the server-scoped file summary in native SwiftUI. Staff Home opens the role's existing work screen. The full client portal or staff workspace stays in an in-app web view for detailed actions.

After the first normal sign-in, the session token is saved in this iPhone's Keychain behind Face ID or device passcode. A returning user unlocks that saved sign-in before the app verifies the session with Fundhub. Canceling the prompt stays at sign-in; the saved-session button retries, and regular sign-in remains available. Signing out removes the saved token. This flow still needs a real Face ID iPhone test; a simulator build alone does not prove the system prompt.

## Build and tests

```sh
xcodebuild -project tools/fundhub-ios/Fundhub.xcodeproj -scheme Fundhub -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test
xcodebuild -project tools/fundhub-ios/Fundhub.xcodeproj -scheme Fundhub -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

An unsigned device build proves compilation only. It cannot be uploaded or installed as the public App Store release. The `ai.fundhub.app` App ID and Fundhub Portal App Store record `6823985032` are registered under Fundhub Apple team `8VDXL37RR6`. A signed iOS 1.0 build 2 was uploaded on 2026-10-17; processing, review submission, and publication require separate proof.

## Store handoff

- App name: **Fundhub**
- Subtitle draft: **Your file. Your work. One app.**
- Category: Finance
- Privacy policy: `https://fundhub.ai/privacy/` (also linked inside the app)
- Support: `https://fundhub.ai/` (links to `support@fundhub.ai`)
- Description draft: **Fundhub keeps your file and your work close. Clients can see their current file stage, advisor, documents and amount due, then open the full portal for their next steps. Fundhub team members can sign in to their role's workspace.**
- Review account: App Store Connect's demo credentials match `client@fundhub.ai`. The password path was verified in the iPhone 17 simulator on 2026-10-21: type the email and password on the first screen and tap **Sign in**, then open native client Home and the full test portal. `chris@fundhub.ai` lands on staff Home the same way. This is not yet a real-iPhone sign-in or push test.
- Screenshots: App Store Connect has a current build 2 high-contrast iPhone 17 sign-in screenshot (`APP_IPHONE_61`, `COMPLETE`). The older image under `ops/workflows/build-evidence/fundhub-ios/` is stale and must not be used for the listing. The `client@fundhub.ai` test account reaches native client Home and the full portal in the simulator, but a signed-in marketing screenshot has not been approved.

**Account access update (2026-10-17):** Chris explicitly authorized App Store Connect use for this Fundhub launch; the earlier saved denial is superseded. The signed iOS build 2 upload has an Apple delivery receipt, but neither the upload nor this source tree proves review submission or a public listing.

## Native iPhone notifications

Client Home can ask for Apple notification permission only after the server reports APNs ready.
Its device token is encrypted and tied to the current client account session. Staff get no client
push card. The dispatcher can send a generic companion alert after an eligible email or SMS
is saved as sent by a real provider. The card's ready state only checks device registration;
no production alert or real-device notification has been verified.

Apple confirms **Push Notifications** is enabled on App ID `ai.fundhub.app`, and the signed
Release build has `aps-environment=production`. APNs server delivery still needs a genuine
APNs Auth Key. Set `APNS_KEY_ID`, `APNS_TEAM_ID`, and
`APNS_PRIVATE_KEY_BASE64` (base64 of the complete `.p8` file) in Netlify; keep the existing
`PUSH_SUB_ENC_KEY`. Do not commit the `.p8` file. Debug signs with
`Fundhub/Fundhub.entitlements` (`development`); Release signs with
`Fundhub/Fundhub.Release.entitlements` (`production`). Before TestFlight, inspect the signed
archive's `aps-environment` with `codesign -d --entitlements :- Fundhub.app` and confirm it
says `production`. A source build or unsigned archive does not prove this. The prior Apple
account-access denial is superseded, but a real APNs signing key is not yet configured.
After the server migration and Apple setup, sign a client in on a real iPhone, turn on the
card, and use `node scripts/push/send-test-native.mjs --client <uuid> --send` from an
authorized environment with the database and APNs variables. The command sends only the
approved test sentence; Apple acceptance and a visible iPhone banner must both be checked.
