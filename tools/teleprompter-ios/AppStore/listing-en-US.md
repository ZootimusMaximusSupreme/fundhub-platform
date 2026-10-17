# Fundhub Prompter — App Store listing draft (English U.S.)

Prepared for version 1.0, build 2. This is a local draft. Nothing here has been entered in App Store Connect.

## Product page

| Field | Copy or value |
| --- | --- |
| Name | Fundhub Prompter |
| Subtitle | Read scripts while you film |
| Primary category | Productivity |
| Keywords | teleprompter,filming,scripts,camera,video,remote |
| Support URL | https://fundhub.ai/ (support@fundhub.ai is on the page) |
| Privacy Policy URL | https://fundhub.ai/privacy/ |
| Marketing URL | Leave blank for this release |
| Copyright | 2026 FUNDHUB LLC |
| Price | Free proposed; set and confirm in App Store Connect |
| Distribution | Public proposed; set and confirm in App Store Connect |

### Description

Fundhub Prompter helps Fundhub staff read approved scripts while filming. Sign in with a Fundhub staff account to see scripts in shoot order.

Read from a dark prompter screen. Set the word size and speed, mirror the text for a glass rig, and control playback on screen or with a paired keyboard or remote. Edit a paragraph when the words change; edits sync to the Fundhub dashboard. Edits made without a connection wait on the device and retry later.

On a device with a supported camera, record a take while reading and save it to Photos. This release records at 1080p. Camera, microphone, and Photos access are requested only for filming and saving a take.

A Fundhub staff account is required. Fundhub Prompter does not include the Fundhub customer app.

### App Review notes draft

Fundhub Prompter is a staff filming tool. Use the dedicated review account entered in the Sign-In Required fields. That account must have an approved sample shoot before submission. Sign in, open a script, tap Play, and use Edit to change a sample paragraph. On a physical device, allow Camera, Microphone, and Add Photos access; tap Record, then Stop, and check the saved take in Photos. The simulator cannot prove recording. The customer Fundhub app is separate. There is no purchase or sign-up in this app.

Do not submit these notes until the review account and sample shoot have been created and tested. Enter its credentials only in App Store Connect, never in this repository.

## Assets and checks

- Use the real simulator captures listed in `ops/workflows/build-evidence/fundhub-prompter-appstore/README.md`. Keep the iPhone and 13-inch iPad originals separate. Do not use a screenshot showing a recording or camera image from the simulator.
- The product page copy does not claim 4K, Drive upload, a customer portal, or a funnel link.
- Complete App Privacy answers from the app and service's actual data handling. The iOS source sends staff sign-in and script edits to Fundhub; Photos saving is local. Check the service's data handling before choosing Apple's categories.
- Confirm the public privacy policy describes this app's staff sign-in, script data, on-device filming, and data requests before submission. The current policy URL is live, but it is a general Fundhub policy.

Apple references: [version fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [screenshot sizes](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [privacy setup](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy), [review guidelines](https://developer.apple.com/app-store/review/guidelines/).
