# Fundhub Prompter — iPhone and iPad app

A native teleprompter that films you with the front camera, rolls the
approved scripts in film order, and saves every word change back to the same
script the dashboard shows.

- Swift and SwiftUI, with AVFoundation for the camera. No outside packages.
- Spec: `docs/specs/marketing-machine-2026-10-04.md` §8.1 and §8.5.
- Owner needs: `docs/specs/teleprompter-requirements-2026-10-06.md`.
- Server routes: `docs/specs/marketing-machine-api.md` (§4 Script, §6.2 scripts, §7.1 shoot).
- The web teleprompter (`public/app/teleprompter*`) is separate. This app does not change it.

## Put it on your iPhone (free Apple ID, no $99 account)

Do this once. It takes about 10 minutes.

1. Plug the iPhone into the Mac with a cable. Unlock the phone. Tap **Trust**.
2. On the Mac, open Xcode. Go to **Xcode › Settings › Accounts**. Click **+**, pick **Apple ID**, and sign in with your normal Apple ID.
3. Open `tools/teleprompter-ios/FundhubPrompter.xcodeproj` in Xcode.
4. Click **FundhubPrompter** at the top of the left list. Click the **FundhubPrompter** target, then **Signing & Capabilities**. Turn on **Automatically manage signing**. Set **Team** to **Chris Stanbridge (Personal Team)**.
   - If Xcode says the bundle id is taken, change `ai.fundhub.prompter` to `ai.fundhub.prompter.chris`.
5. At the top of Xcode, pick your iPhone as the place to run. Click **Run** (the ▶ button).
6. The first time, the phone asks for **Developer Mode**: on the phone go to **Settings › Privacy & Security › Developer Mode**, turn it on, and let it restart. Then click **Run** again.
7. The first time, the phone also says the developer is not trusted: on the phone go to **Settings › General › VPN & Device Management**, tap your Apple ID, tap **Trust**.
8. Open **Fundhub Prompter** on the phone. Sign in with your Fundhub login.

**Every 7 days** the app stops opening (a free Apple ID signs apps for 7 days).
Plug the phone in and click **Run** again. Your settings and waiting edits stay.
A free Apple ID can have 3 of these apps on a phone at once. The paid $99
account is only needed for TestFlight or the App Store (spec §8.5).

The iPad works the same way: plug it in, pick it at the top, click **Run**.

## How to test it

1. Sign in. The list shows the open shoot's scripts in film order (or, with no shoot planned, every approved script).
2. Tap a script. The camera box shows in the top corner, then fades to black. Tap the corner to bring it back.
3. Tap **Record**. The words roll. One tap pauses. A tap again rolls on. A double tap is scroll mode (drag the words, tap to roll from there, double tap to leave).
4. Hold a line (or tap **Edit**) to change its words. Tap **Done**. The pulse line says **Saved 12:04**. Open the dashboard's Scripts tab: the new version is there.
5. Tap **Stop**, then **Got it** or **Another take**. Open Photos: the take is named like `SLO Ad 91 — Lenders read two files Take 3.mp4`.
6. Turn on Airplane Mode, change a line: the pulse says **Offline — 1 edit waiting**. Turn it off: it saves by itself.

## What it does

### Camera (front camera, highest quality)

| Choice | What it does | Why |
|---|---|---|
| Quality: **4K** or **1080p** | Picks the camera format with that exact size. Default 4K. | Owner law: VSLs, thank-you videos and testimonials are 4K (`.claude/rules/video-4k-unless-ad.md`). Ads may be 1080p. Chris picks the mode. If the camera cannot give 4K, the screen says so in red ("This camera tops out at …"). It never upscales. |
| Frame rate | Locks the highest real frame rate that chosen size has (`activeVideoMinFrameDuration` = `activeVideoMaxFrameDuration`). | A fixed frame rate, at the top the camera really offers for 3840×2160 or 1920×1080. It does not stay at 30 when the phone can go faster. |
| Video format: **H.264** (default) or **HEVC** | Sets the codec on the recording. | Meta's ads guide names "H.264 compression". Reels also accept H.265 (HEVC). H.264 is the safe default for ads. |
| Bitrate | 4K: 50 Mbit/s at 30 fps, 75 at 60. 1080p: 20 at 30, 30 at 60. HEVC uses two thirds of that. | Meta publishes no bitrate number and re-encodes every upload. This is our pick: well above Apple's default so Meta and the editor start from a clean master. Set only when the phone lists the key as allowed. |
| **Record mirrored** (default on) | Saves the picture flipped like the preview. | Owner need. The pipeline's `flip_horizontal` setting flips it back (spec §8.1). |
| **Steady video**: Off, Normal, Extra smooth | Sets video stabilization. | Picks a format that supports it when it can. |
| **Lock brightness** | Locks exposure at what the camera sees now. | Light the room first, then lock it. |
| Take name | Each take is saved to Photos named from the server's `take_file_name` (`{Offer} Ad {n} — {angle} Take {k}.mp4`, `marketing/ads/NAMING.md`). | The camera writes `.mov`; the app copies it into an `.mp4` box with no re-encode (passthrough) so the name and the file agree. If that copy fails, it keeps the `.mov` with the same name. |

Sources:

- Apple, AVCaptureMovieFileOutput `setOutputSettings(_:for:)` (on iOS only keys from `supportedOutputSettingsKeys(for:)` may be set; a sparse compression dictionary is allowed): https://developer.apple.com/documentation/avfoundation/avcapturemoviefileoutput/setoutputsettings(_:for:)
- Apple, `supportedOutputSettingsKeys(for:)`: https://developer.apple.com/documentation/avfoundation/avcapturemoviefileoutput/supportedoutputsettingskeys(for:)
- Apple, `availableVideoCodecTypes`: https://developer.apple.com/documentation/avfoundation/avcapturemoviefileoutput/availablevideocodectypes
- Apple, `AVCaptureDevice.activeFormat`: https://developer.apple.com/documentation/avfoundation/avcapturedevice/activeformat
- Apple, `activeVideoMinFrameDuration`: https://developer.apple.com/documentation/avfoundation/avcapturedevice/activevideominframeduration
- Apple, `AVCaptureConnection.isVideoMirrored`: https://developer.apple.com/documentation/avfoundation/avcaptureconnection/isvideomirrored
- Apple, `preferredVideoStabilizationMode`: https://developer.apple.com/documentation/avfoundation/avcaptureconnection/preferredvideostabilizationmode
- Apple, `exposureMode`: https://developer.apple.com/documentation/avfoundation/avcapturedevice/exposuremode-swift.property
- Apple, `AVCaptureDevice.RotationCoordinator` (keeps the take level in any hold): https://developer.apple.com/documentation/avfoundation/avcapturedevice/rotationcoordinator
- Apple, `PHAssetResourceCreationOptions.originalFilename` (the take name in Photos): https://developer.apple.com/documentation/photos/phassetresourcecreationoptions/originalfilename
- Apple, `AVAssetExportPresetPassthrough`: https://developer.apple.com/documentation/avfoundation/avassetexportpresetpassthrough
- Apple, Enabling Developer Mode on a device: https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device
- Meta, Facebook Ads Guide, video ad specs ("MP4, MOV or GIF"; "H.264 compression, square pixels, fixed frame rate, progressive scan and stereo AAC audio compression at 128kbps+"; max 4 GB): https://www.facebook.com/business/ads-guide/update/video
- Meta for Developers, Reels publishing video specs (MP4; 9:16; 1080×1920 recommended; 24 to 60 fps; H.264 or H.265; AAC 128 kbps+, 48 kHz; fixed frame rate; closed GOP 2–5 s): https://developers.facebook.com/docs/video-api/guides/reels-publishing

Audio uses the phone's default AAC sound. Meta asks for stereo AAC at
128 kbps or more; check one take's sound on a real phone (see below).

### Preview and dark glass

- A small camera box in the top corner, only to line up. It fades to black after 5 seconds (change it in Settings), and when the words start.
- Tap the top corner to bring it back.
- While recording, a small red dot and the time show in the top left.

### Teleprompter

- Black glass, white words, CAPS in bold, `↑` in amber, an amber reading line, a progress bar.
- Rolls on v1's clock: 80–260 words a minute (default 150), 35% longer at a sentence end, 15% at a comma, 0.8 s at each blank line. A 3-2-1 countdown at the top.
- Bullets-style scripts roll their parts; each cue holds until a tap or the remote.
- **One tap** pauses. **Tap again** rolls on. **Double tap** = scroll mode (drag or flick; tap to roll from there; double tap to leave). Drag any time to move the words by hand.
- **Hold a line** (or **Edit**) to change its words, even while the camera records.
- Settings: text size, speed, line width, blank-line pause, countdown, flip left-right and flip upside down for an iPad beam-splitter rig. Each device keeps its own.
- Keys (Bluetooth remote, keyboard, foot pedal) — v1's keys: Space, Enter, Page Down play/pause; arrows change speed; Page Up starts over. At the end: play = **Got it**, Page Up = **Another take**. R = record/stop. **Settings › Learn remote** maps any remote's buttons, per device.
- The screen stays awake while rolling.

### Sync with the dashboard

- **Sign in**: `POST /api/auth/login` with the Fundhub staff login. The session token is kept in the iOS Keychain (this device only). Every call sends it as `Authorization: Bearer`.
- **Scripts**: `GET /api/marketing/shoot` every 5 seconds while the app is open. It rolls `shoot.scripts` in the shoot's order, or `plan_candidates` (approved scripts in film order) when no shoot is planned. The last answer is kept on the phone, so it opens with no signal.
- **Edits**: every change goes through `POST /api/marketing/scripts/edit` — the same route the dashboard uses. The server saves a new version and keeps the old one. There is no second store; the phone only holds what has not reached the server yet.
- **Offline**: edits wait on the phone (they survive closing the app). A save cut off mid-way is sent again with the same `request_id`, so the server counts it once.
- **Two versions**: if the dashboard changed the same script first (409), the app shows both texts. Pick **Keep mine** or **Keep the dashboard's**.
- **Signed out**: the waiting list is kept and sent after you sign in again.
- **Got it / Another take**: `POST /api/marketing/shoot/mark`, queued the same way. The next take name moves to the next number.
- **The pulse** never hides: `Saved 12:04`, `Saving…`, `Offline — 2 edits waiting`, `Sign in again — 1 edit waiting`, `Two versions — pick one`.

## Build and test (for agents)

```bash
cd tools/teleprompter-ios
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project FundhubPrompter.xcodeproj -scheme FundhubPrompter \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' test
```

The unit tests cover the words rules (paragraphs, CAPS, take names, edits on
the fly ported from `teleprompter-edits.js`), v1's clock and the smooth
scroll, the tap rules, the remote keys, the camera format pick, the waiting
list (save, offline resend with the same request id, restart, sign-out, 409,
refused saves, take marks) and the request shape.

**Screenshot demo.** Launch with the argument `-FundhubDemo` to skip sign-in
and show the made-up example shoot from `docs/specs/marketing-machine-api.md`
§7.1. It never talks to a server. It is not used on Chris's phone. Extra
demo-only arguments for screenshots: `-FundhubDemoOpen` (open script 1),
`-FundhubDemoRoll` (roll), `-FundhubDemoMirror` (flip), `-FundhubDemoEdit`
(open the edit box), `-FundhubDemoSave` (change one line and save it),
`-FundhubDemoSettings`.

## What only a real phone can prove

The simulator has no camera. These need the iPhone 17 Pro Max:

- The front camera really gives 4K (3840×2160) and 1080p (1920×1080), each at that size's highest frame rate (the app says so in red if the size is missing).
- The bitrate key is accepted (the summary line under the script name shows what the camera is set to).
- Mirrored recording, steady video and the brightness lock look right in a take.
- The take lands in Photos with its take name, as `.mp4`, with sound (AAC; Meta wants stereo 128 kbps+).
- A real Bluetooth remote's buttons, and Learn remote.
- The iPad behind beam-splitter glass reads correctly with Flip left-right on.
