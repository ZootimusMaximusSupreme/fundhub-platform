# Mac Bridge — iPhone app

Watch your Claude Code, Codex and Cursor sessions, and the commands they run, from the iPhone.
v2 also sends tasks: start a new one, or reply inside a session. They run on the Mac in the repo folder.
Contracts: `docs/specs/mac-bridge-protocol-v1.md` (watch) and `docs/specs/mac-bridge-protocol-v2-tasks.md` (send).
Mac side: `tools/mac-bridge/agent/`.

SwiftUI, iOS 17+, Swift 5 mode, no third-party packages.
Target `MacBridge`, bundle id `ai.fundhub.macbridge`, display name "Mac Bridge". Tests: `MacBridgeTests`.

## Build and test

```bash
xcrun simctl list devices available | grep iPhone      # pick a simulator name
xcodebuild -project tools/mac-bridge/ios/MacBridge.xcodeproj -scheme MacBridge \
  -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

The project uses synced folders. A new `.swift` file under `MacBridge/` or `MacBridgeTests/` joins its target
by itself. Do not add it to `project.pbxproj` by hand, or it builds twice.

## Run

1. Start the Mac helper (see `tools/mac-bridge/agent/README.md`). It prints a pairing link and a QR code.
2. Open `MacBridge.xcodeproj` in Xcode, pick a simulator or your iPhone, press Run.
   For a real iPhone, set your team under Signing & Capabilities first (signing is automatic, no team saved yet).
3. Pair one of three ways:
   - **Scan the QR code** (real iPhone only — the Simulator has no camera).
   - **Paste a pairing link** (`macbridge://pair?host=…&port=…&token=…&name=…`). Opening that link on the phone also works; the app asks before it pairs.
   - **Pick a Mac nearby** (Bonjour `_macbridge._tcp`), then paste the token. Or type host, port and token by hand.

   Every way checks `GET /v1/health` with the token before anything is saved.
4. Sessions list: pull down to refresh. New and changed sessions arrive live over the WebSocket.
   Tap one to see its feed. Menu (•••) › Forget this Mac to pair again.
5. **New task** (pencil button, top right): type the task in the big box, pick **Claude**, **Codex**, **Cursor** or **Auto**
   ("Uses the repo rules": the Mac picks the tool), press Send. The screen shows the task status, and opens the
   live feed by itself as soon as the Mac knows the session id.
6. **Reply** (box at the bottom of any feed): sends a task that resumes this session with the same tool.
   While a task for this session runs, the box is off and shows "working…". If the Mac writes the reply into a
   new session, a link under the box opens it.
7. **Running** (top of the session list): every task that is starting or working, with its tool, the first line of
   the prompt and its status. Tap to open its feed. **Stop** asks first, then the Mac stops it
   (asks nicely, then ends it after 5 seconds).
   When the Mac picked the tool (Auto), the row and the task screen show who picked it and why.

Simulator shortcut for a pairing link:

```bash
xcrun simctl openurl booted 'macbridge://pair?host=127.0.0.1&port=7878&token=<token>&name=Mac'
```

## Where things live

| Folder | What |
|---|---|
| `MacBridge/Core/` | Wire models, pairing link parser, backoff, Keychain + saved Mac, HTTP client, WebSocket, Bonjour. `Tasks.swift`: v2 task model (`BridgeTask`), request body, live list rules |
| `MacBridge/UI/` | App state, Pair screen, QR scanner, session list, session feed. `TaskViews.swift`: New task sheet, Running rows, reply bar |
| `Config/MacBridge-Info.plist` | Local network, Bonjour, camera, ATS local networking, `macbridge://` URL scheme |
| `MacBridgeTests/` | Decode tests (Session, Event, stream messages), pairing link tests, backoff tests. `TaskTests`: task decode, request bodies, error mapping, task stream message, live list |

## Notes

- The token is kept in the Keychain only (this device, never backed up). Host, port and name are in UserDefaults.
- One shared WebSocket. It reconnects with backoff 1s, 2s, 4s, 8s, 16s, then 30s, and re-subscribes after every reconnect.
  A ping every 20 seconds finds a dead link. The app closes the socket in the background and reopens it on return.
- After a reconnect or a gap in `seq`, the feed fetches the missed events with `after=`.
- ATS allows plain `http`/`ws` only to local addresses (`NSAllowsLocalNetworking`). Over Tailscale, use the Mac's
  `100.x.y.z` address, not a MagicDNS name like `mac.tailnet.ts.net`, which ATS would block.
- v2 errors in plain words: 401 → pair again; 429 → "The Mac is already running 3 tasks"; anything else shows the
  error code. An older v1 helper has no `/v1/tasks`; the app then just shows no Running strip.
- The Swift type is `BridgeTask`, not `Task`, so it never clashes with Swift's own `Task`.
- A session a task just started may not be on the Mac's list for a moment, and the helper ignores a subscribe to a
  session it does not know. So a brand-new feed (0 events) waits up to 30 seconds, re-subscribing each second.
