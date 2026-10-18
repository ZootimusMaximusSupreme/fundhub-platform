# Fundhub Portal — Apple physical-iPhone recording checklist

**Status: OPEN — no device recording or device test is proven.**

Apple's 2.1 request is for a recording from a physical iPhone on the latest
iOS, beginning when the app is launched and showing a normal user flow. The
submitted build is Fundhub 1.0 (2). A simulator, an API check, a screenshot,
or a recording from build 3 does not close this request.

## Before recording

1. Use a real iPhone. Record its model and iOS version after confirming iOS is
   up to date. Confirm Fundhub **1.0 (2)** is installed. If another build is
   installed, install build 2 through the available Apple test path, or submit
   that newer build and record the same newer build instead.
2. Use only `client@fundhub.ai`, the isolated review client. Its password is in
   the local-only launch credential file; do not show, speak, or place it in
   this board, the video, or App Store Connect notes.
3. Remove or hide all real customer names, documents, balances, notifications,
   and other apps from the phone before capture. Do not create a payment,
   upload a document, or change live client data for the video.

## One continuous capture

1. Start iPhone Screen Recording from the Home Screen. Launch Fundhub and keep
   the take running.
2. On the first screen, tap **Fundhub team? Use your password**. Sign in as the
   review client without exposing the password.
3. Show the native client Home and its real file status, then tap **Open full
   portal**.
4. In the portal, show **Account & history** and one normal available view in
   **Payments**, **Documents**, or **Messages**. If the review account shows a
   paid item, show the item or payment view only; do not open checkout or make
   a payment. If it does not show one, state that plainly in the reply.
5. Sign out. End the recording only after the signed-out screen is visible.

Do not stage registration, account deletion, or report/block screens. The
current app evidence shows no self-registration, native account-deletion, or
public user-content/report-block feature. The final Apple reply must say that
plainly and direct deletion requests to the published privacy-request route.

## Finish and attach

1. Watch the saved file from start to finish. Confirm it is one take, the app
   launched, the client reached Home and the portal, and sign-out is visible.
2. Name the saved file with the device model, iOS version, and build number.
3. Attach it to the rejected iOS version's App Review response. Enter the
   device model, iOS version, build number, sign-in route, and exactly which
   conditional paid view was shown. Confirm the attachment remains saved
   before resubmitting.

## Access and rights still needed

- A physical iPhone with current iOS and the exact review build installed.
- The isolated review-client login and the local credential file, kept off
  camera.
- App Store Connect access that can edit App Review Information, attach the
  video, reply in Resolution Center, and resubmit the version.
- Owner-confirmed support contact details for the review page.
- Owner-confirmed proof or precise non-applicability explanation for any
  third-party lender material and client-uploaded content shown in this build;
  do not select Content Rights until that is resolved.

## Sources

- `docs/journeys/fundhub-ios-intended.md` — intended review checks; it has
  doors, not a recorded event sequence.
- `ops/workflows/two-ios-apps-launch/app-review-video.md` — Apple's 2.1
  request and current missing-device facts.
- `ops/workflows/two-ios-apps-launch/app-review-response.md` — truthful
  reviewer notes and feature applicability.
- `ops/workflows/two-ios-apps-launch/asc-review-packet.md` and
  `test-logins-push.md` — submitted-build, account, and App Review facts.
