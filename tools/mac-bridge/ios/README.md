# Mac Bridge — iPhone app

Watch your Claude Code and Codex sessions, and the commands they run, from the iPhone.
Read only in v1. Contract: `docs/specs/mac-bridge-protocol-v1.md`. Mac side: `tools/mac-bridge/agent/`.

SwiftUI, iOS 17+, Swift 5 mode, no third-party packages.
Target `MacBridge`, bundle id `ai.fundhub.macbridge`, display name "Mac Bridge". Tests: `MacBridgeTests`.

## Build and test

```bash
xcrun simctl list devices available | grep iPhone      # pick a simulator name
xcodebuild -project tools/mac-bridge/ios/MacBridge.xcodeproj -scheme MacBridge \
  -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

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

Simulator shortcut for a pairing link:

```bash
xcrun simctl openurl booted 'macbridge://pair?host=127.0.0.1&port=7878&token=<token>&name=Mac'
```

## Where things live

| Folder | What |
|---|---|
| `MacBridge/Core/` | Wire models, pairing link parser, backoff, Keychain + saved Mac, HTTP client, WebSocket, Bonjour |
| `MacBridge/UI/` | App state, Pair screen, QR scanner, session list, session feed |
| `Config/MacBridge-Info.plist` | Local network, Bonjour, camera, ATS local networking, `macbridge://` URL scheme |
| `MacBridgeTests/` | Decode tests (Session, Event, stream messages), pairing link tests, backoff tests |

## Notes

- The token is kept in the Keychain only (this device, never backed up). Host, port and name are in UserDefaults.
- One shared WebSocket. It reconnects with backoff 1s, 2s, 4s, 8s, 16s, then 30s, and re-subscribes after every reconnect.
  A ping every 20 seconds finds a dead link. The app closes the socket in the background and reopens it on return.
- After a reconnect or a gap in `seq`, the feed fetches the missed events with `after=`.
- ATS allows plain `http`/`ws` only to local addresses (`NSAllowsLocalNetworking`). Over Tailscale, use the Mac's
  `100.x.y.z` address, not a MagicDNS name like `mac.tailnet.ts.net`, which ATS would block.
