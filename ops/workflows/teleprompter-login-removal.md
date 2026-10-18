# Teleprompter login removal — 2026-10-18

| Work | State | Proof |
| --- | --- | --- |
| Remove the native Apple Prompter login screen | DONE | The app root now always opens the script list; the built-in practice shoot starts without an account. |
| Native compile | DONE | `xcodebuild … -destination 'generic/platform=iOS Simulator' … build` passed. |
| Native tests | OPEN | The simulator test result bundle did not finish cleanly, so it is not counted as a pass. |
| iPhone replacement build | READY | Signed release archive: `/private/tmp/fundhub-prompter-loginless.xcarchive`. Xcode sees `CHRIS STANBRIDGE’s iPhone` as unavailable, so installation has not started. |

Change: `tools/teleprompter-ios/` only. The browser teleprompter already had no login page and was not changed.
