# Mac Bridge — 2026-10-20

Goal (Chris's note, 2026-10-20): an iPhone app that shows Claude Code and Codex chats, and the commands they run on the Mac, while Chris is away. Public App Store app later.

Contract both sides build to: `docs/specs/mac-bridge-protocol-v1.md`.
Branch: `feat/mac-bridge-v1` in worktree `.claude/worktrees/mac-bridge`.

## Split

| # | Workflow | Owner | Status | Files |
|---|---|---|---|---|
| 0 | Protocol + board | this session | done | `docs/specs/mac-bridge-protocol-v1.md`, this board |
| 1 | Mac helper (Node) | agent: mac-helper | done | `tools/mac-bridge/agent/**` |
| 2 | iPhone app (SwiftUI) | agent: ios-app | done | `tools/mac-bridge/ios/**` |
| 3 | Join test: phone app in Simulator reads the real helper | this session | blocked: Simulator access not granted (app opened, pair prompt shown) | none new |
| 4 | Away mode (hosted relay) | — | later (v2) | — |
| 5 | Send from phone into a session | — | later (v2) | — |

1 and 2 run at the same time. No dependency between them; both read the protocol file. 3 waits for both.

## Copy-paste prompts

### 1 — Mac helper

Work only in `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/mac-bridge`. Build the Mac helper in `tools/mac-bridge/agent/` exactly to `docs/specs/mac-bridge-protocol-v1.md`. Node 22, ES modules, built-in modules only (`node:http`, `node:crypto`, `node:fs`), hand-roll the WebSocket server (RFC 6455 text frames, ping/pong, close). Parse real Claude Code (`~/.claude/projects/**/*.jsonl`) and Codex (`~/.codex/sessions/**/*.jsonl`) files; sample real lines first to learn the shapes. Never write to those folders. Watch for changes with `fs.watch` plus a 2-second poll fallback. Print the pairing link and a terminal QR code (write a tiny QR encoder or skip QR and print the link if that is too big — say which). Add `tools/mac-bridge/agent/README.md` (how to start) and tests run with `node --test tools/mac-bridge/agent/` covering: token reject, session list, event parsing for both tools from fixture lines, seq stability, WebSocket subscribe gets a new event. Run the tests and a live start on port 7878 with curl proof. Do not commit. Write a short manifest under row 1 on `ops/workflows/mac-bridge-2026-10-20.md` when done.

### 2 — iPhone app

Work only in `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/mac-bridge`. Build the iPhone app in `tools/mac-bridge/ios/` exactly to `docs/specs/mac-bridge-protocol-v1.md`. SwiftUI, iOS 17+, no third-party packages. Model the hand-written Xcode project on `tools/teleprompter-ios/FundhubPrompter.xcodeproj` (copy its shape, new names: target `MacBridge`, bundle id `ai.fundhub.macbridge`). QR scan with AVFoundation, Bonjour browse with `NWBrowser`, token in Keychain, WebSocket with `URLSessionWebSocketTask`, reconnect with backoff. Screens: Pair, Session list, Session feed. Include a unit-test target with JSON decode tests for Session and Event. Build with `xcodebuild` for the iOS Simulator and run the tests. Do not commit. Write a short manifest under row 2 on `ops/workflows/mac-bridge-2026-10-20.md` when done.

## Manifests

(agents write here)

### 1 — Mac helper

- **Files (all new, under `tools/mac-bridge/agent/`):** `bin/mac-bridge.mjs` (entry); `src/server.mjs` (HTTP + WebSocket + auth), `src/sessions.mjs` (find files, lazy index, watch, stream), `src/parse.mjs` (Claude and Codex lines to Events), `src/ws.mjs` (hand-written RFC 6455), `src/qr.mjs` (hand-written QR encoder), `src/token.mjs`, `src/bonjour.mjs`; `test/*.test.mjs` plus `test/_helpers.mjs` and `test/index.js` (a 10-line loader: Node 22 cannot take a folder argument without it); `README.md`. Node 22, built-ins only, no package.json anywhere.
- **Run:** `node tools/mac-bridge/agent/bin/mac-bridge.mjs` (port 7878, or `--port` / `MAC_BRIDGE_PORT`). It prints the pairing link and a QR code. Flags `--no-qr`, `--no-bonjour`. Token is made on first run at `~/.mac-bridge/token` (0600, 64 hex).
- **Tests:** `node --test tools/mac-bridge/agent/test/` gives `tests 29, pass 29, fail 0, skipped 0`. They use fake files in a temp folder and never read the real folders. Covered: 401 on missing, wrong and longer tokens; health; session list (both tools, newest first, title, project, count, live, 200 cap); Claude and Codex parsing from fixture lines; seq stable on re-read, on append and on a half-written last line; events `after` / `limit` (capped 500) across a resume point; WebSocket (Node's own client) hello, subscribe gets a new event, unsubscribe, a line written in two pieces streams once, new sessions reach everyone; RFC 6455 frame lengths (7-bit, 16-bit, 64-bit), masking, split chunks; token file mode; folders untouched. I broke the code on purpose twice (accept any token; swallow a half-written line) and the tests failed both times.
- **Live run (real home folders, port 7878):** no token gave `401`; with token `/v1/health` gave `{"ok":true,"name":"CHRISs-Mac-mini.local","version":"1"}`; `/v1/sessions` gave 159 sessions in about 10 ms (47 Claude, 112 Codex). A real Claude session returned 16 events (user, command, output, tool, assistant). A real Codex session returned 478 events including 239 commands with outputs; `after`/`limit` paging worked; an unknown id gave `404 {"error":"not_found"}`. A WebSocket subscribed to a live Claude session received real new events with the right seq while it was being written. The `dns-sd` Bonjour child was running, and was gone after the helper stopped. The process is stopped.
- **QR:** done, hand-written (byte mode, level L, versions 1 to 10). I checked it with Apple's own decoder (CoreImage) at versions 1, 4 to 10: every code decoded to the exact text.
- **Choices to know about (contract not changed):**
  1. **Guardian files hidden.** 379 of 491 Codex files on this Mac are internal safety-review runs (`thread_source: guardian_review`), not chats. Left in, they filled 192 of the 200 list slots. They are hidden by default; `MAC_BRIDGE_SHOW_GUARDIAN=1` shows them. Codex sub-agent chats are kept.
  2. **`exitCode` rides on the `output` event**, not the `command` event, because the code is not known when the command is first seen and `seq` must never change. Claude gives it in the result text; Codex gives it for normal shell calls. Missing means unknown.
  3. **Which results show.** Only shell results become `output`. Results of other tools (Read, Grep and so on) are not shown, only the call as a `tool` event. Thinking blocks, injected context (AGENTS.md text, environment tags, system reminders) and sub-agent side chains are skipped.
  4. **Codex `exec` scripts:** newer Codex runs shell through a JS `exec` wrapper. The helper pulls every `cmd:` string out of it as a `command` event and the script result as one `output`. Code that builds a command in some other way shows as a plain `tool` event.
  5. **`eventCount`:** exact for files up to 1 MB at list time and for any file once the background indexer has read it (newest first, starts at boot). A very large file may show 0 for a few seconds after start.
  6. **WebSocket:** subscribing to an unknown session is ignored (no new message type was invented). HTTP needs the header token; only the WebSocket takes `?token=`.
  7. **Subscribe sends only new events.** History comes from the HTTP events call; reading a long session pages cheaply because the helper resumes from a saved point every 100 events.
- **Not done / not tested:** no iPhone or Simulator join (row 3). No run over Tailscale. The helper listens on all interfaces with a token and no encryption (plain HTTP), as the spec says; do not expose the port to the public internet. Not committed. Note: the live run created `~/.mac-bridge/token` on this Mac (0600); it is real and now paired to nothing.

### 2 — iPhone app

- **Files (all new, under `tools/mac-bridge/ios/`):** `MacBridge.xcodeproj/project.pbxproj` (hand-written, shape of FundhubPrompter, synced folders), `MacBridge.xcodeproj/xcshareddata/xcschemes/MacBridge.xcscheme`, `Config/MacBridge-Info.plist`, `README.md`; `MacBridge/App/MacBridgeApp.swift`; `MacBridge/Core/` Models, PairingLink, Backoff, PairedMac (UserDefaults + Keychain), BridgeAPI, BridgeSocket, BonjourBrowser; `MacBridge/UI/` AppModel, PairView, QRScannerView, StatusPill, SessionListView, FeedModel, SessionFeedView; `MacBridgeTests/` ModelDecodeTests, PairingLinkTests, BackoffTests.
- **App:** target `MacBridge`, bundle id `ai.fundhub.macbridge`, name "Mac Bridge", iOS 17, Swift 5, no packages, automatic signing with no team. Info.plist has local network text, Bonjour `_macbridge._tcp`, camera text, ATS local networking, and the `macbridge://` URL scheme (checked in the built app).
- **Build/test:** `xcodebuild -project tools/mac-bridge/ios/MacBridge.xcodeproj -scheme MacBridge -destination 'platform=iOS Simulator,name=iPhone 17' build test` → `** BUILD SUCCEEDED **`, `Executed 37 tests, with 0 failures`, `** TEST SUCCEEDED **`. Zero compiler warnings.
- **Simulator:** iPhone 17 (Xcode 27.1). The app opened on the Pair screen and already listed `CHRISs-Mac-mini.local` through Bonjour (the helper from row 1 was running).
- **Not done:** no full pair-and-read run against the live helper (that is row 3). QR scan cannot run in the Simulator (no camera); paste-link and typed pairing work there. No app icon yet. Not committed.
- **Contract notes (not changed):** (a) ATS `NSAllowsLocalNetworking` blocks Tailscale MagicDNS names, so away use must type the `100.x` address. (b) The spec has no "last N events" read, so a long session loads every page from `after=0` on open. A `before=`/tail read would fix that in v2.

## Leftovers

- Apple App Store upload needs the App Store Connect API key, which is not saved yet (see memory: apple-developer-account).

## Owner calls — 2026-10-20 (second note)

- **Away mode = Tailscale on the Mac and iPhone.** Owner-set. Row 4 (hosted relay) is not needed for Chris's own use.
- **Bigger goal: a router.** Any local tool (IDE, Claude Code, Codex) plugs in. Tasks get routed to Claude or Codex, and an agent can hand work to another agent. The phone app is the remote for it.
- **Why not Claude Remote Control:** Chris tried it many times. It is janky, the terminal breaks often, and setup does not work.
- **Jev** (TypeSafe AI, released Sept 2026) is a fast decision model, not a chat or coding model. It answers typed questions (pick one, score, yes/no) with a probability. Fit: the router's brain — pick Claude or Codex for a task, and score how risky a command is before it runs. Later, not v1.
- "Tim" was a mic slip. Ignore.
