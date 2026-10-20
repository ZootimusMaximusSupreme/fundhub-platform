# Mac Bridge — 2026-10-20

Goal (Chris's note, 2026-10-20): an iPhone app that shows Claude Code and Codex chats, and the commands they run on the Mac, while Chris is away. Public App Store app later.

Contract both sides build to: `docs/specs/mac-bridge-protocol-v1.md`.
Branch: `feat/mac-bridge-v1` in worktree `.claude/worktrees/mac-bridge`.

## Split

| # | Workflow | Owner | Status | Files |
|---|---|---|---|---|
| 0 | Protocol + board | this session | done | `docs/specs/mac-bridge-protocol-v1.md`, this board |
| 1 | Mac helper (Node) | agent: mac-helper | claimed | `tools/mac-bridge/agent/**` |
| 2 | iPhone app (SwiftUI) | agent: ios-app | claimed | `tools/mac-bridge/ios/**` |
| 3 | Join test: phone app in Simulator reads the real helper | this session | pending (waits on 1 + 2) | none new |
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

## Leftovers

- Apple App Store upload needs the App Store Connect API key, which is not saved yet (see memory: apple-developer-account).
